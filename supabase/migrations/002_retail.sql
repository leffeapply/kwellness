-- K-Wellness CareOS retail extension
-- Inventory is movement-based: never store a mutable current_stock value on products.

create type public.product_category as enum ('K_BEAUTY', 'BABY_CARE');
create type public.inventory_movement_type as enum ('RECEIPT', 'SALE', 'RETURN', 'DISPOSAL', 'SAMPLE', 'ADJUSTMENT');
create type public.order_channel as enum ('CLIENT_APP', 'STORE_POS', 'CARE_CRM');
create type public.order_status as enum ('DRAFT', 'PAYMENT_PENDING', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'REFUNDED');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text unique,
  name text not null,
  category public.product_category not null,
  description text,
  cost_price numeric(10,2) not null check (cost_price >= 0),
  selling_price numeric(10,2) not null check (selling_price >= 0),
  safety_stock integer not null default 5 check (safety_stock >= 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_type text not null default 'STORE' check (location_type in ('STORE', 'WAREHOUSE', 'MOBILE')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.retail_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  client_id uuid references public.clients(id),
  channel public.order_channel not null,
  status public.order_status not null default 'DRAFT',
  currency text not null default 'USD',
  subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(10,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(10,2) not null default 0 check (tax_total >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  external_payment_reference text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text
);

create table public.retail_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.retail_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  unit_cost_snapshot numeric(10,2) not null check (unit_cost_snapshot >= 0),
  line_total numeric(10,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  location_id uuid not null references public.inventory_locations(id),
  movement_type public.inventory_movement_type not null,
  quantity integer not null check (quantity <> 0),
  order_id uuid references public.retail_orders(id),
  reason text,
  created_by uuid not null references public.profiles(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint movement_sign_matches_type check (
    (movement_type in ('RECEIPT', 'RETURN') and quantity > 0)
    or (movement_type in ('SALE', 'DISPOSAL', 'SAMPLE') and quantity < 0)
    or movement_type = 'ADJUSTMENT'
  )
);

create view public.inventory_on_hand
with (security_invoker = true)
as
select
  product_id,
  location_id,
  sum(quantity)::integer as quantity_on_hand
from public.inventory_movements
group by product_id, location_id;

create index products_category_active_idx on public.products(category, active);
create index retail_orders_client_created_idx on public.retail_orders(client_id, created_at desc);
create index retail_orders_status_created_idx on public.retail_orders(status, created_at desc);
create index retail_order_items_order_idx on public.retail_order_items(order_id);
create index inventory_movements_product_location_idx on public.inventory_movements(product_id, location_id, occurred_at desc);

create or replace function public.is_retail_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('OWNER')
      or public.has_role('ADMIN')
      or public.has_role('RETAIL_STAFF');
$$;

alter table public.products enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.retail_orders enable row level security;
alter table public.retail_order_items enable row level security;
alter table public.inventory_movements enable row level security;

create policy "products: authenticated active read" on public.products
for select to authenticated using (active or public.is_retail_staff());
create policy "products: retail staff manage" on public.products
for all to authenticated using (public.is_retail_staff()) with check (public.is_retail_staff());

create policy "locations: retail staff read" on public.inventory_locations
for select to authenticated using (public.is_retail_staff());
create policy "locations: retail staff manage" on public.inventory_locations
for all to authenticated using (public.is_retail_staff()) with check (public.is_retail_staff());

create policy "orders: customer or staff read" on public.retail_orders
for select to authenticated using (
  public.is_retail_staff()
  or public.is_care_staff()
  or (client_id is not null and public.is_client_member(client_id))
);
create policy "orders: retail staff manage" on public.retail_orders
for all to authenticated using (public.is_retail_staff()) with check (public.is_retail_staff());

create policy "order items: customer or staff read" on public.retail_order_items
for select to authenticated using (
  exists (
    select 1 from public.retail_orders o
    where o.id = order_id
      and (
        public.is_retail_staff()
        or public.is_care_staff()
        or (o.client_id is not null and public.is_client_member(o.client_id))
      )
  )
);
create policy "order items: retail staff manage" on public.retail_order_items
for all to authenticated using (public.is_retail_staff()) with check (public.is_retail_staff());

create policy "inventory: retail staff read" on public.inventory_movements
for select to authenticated using (public.is_retail_staff());
create policy "inventory: retail staff create" on public.inventory_movements
for insert to authenticated with check (public.is_retail_staff() and created_by = auth.uid());

-- Client checkout is intentionally not opened through direct table INSERT policies.
-- A server-side function/Edge Function must validate current prices, tax, inventory,
-- idempotency, and the external payment result before it inserts an order and movements.
