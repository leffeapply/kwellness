-- Auditable service-balance ledger and administrator-only receipt recording.
-- Reservation deposits remain in deposit_transactions because their amount and
-- cancellation policy are service-specific. This ledger records only payments
-- collected after the reservation deposit.

create table if not exists public.service_balance_transactions (
  id uuid primary key default gen_random_uuid(),
  client_service_request_id uuid not null
    references public.client_service_requests(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'CAPTURED'
    check (status in ('CAPTURED', 'REFUNDED', 'VOIDED', 'FAILED')),
  payment_method text not null check (length(trim(payment_method)) between 2 and 40),
  external_reference text not null check (length(trim(external_reference)) between 3 and 255),
  idempotency_key text not null unique,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  captured_at timestamptz,
  refund_reference text,
  refunded_amount numeric(10,2) not null default 0 check (refunded_amount >= 0),
  refunded_at timestamptz,
  refunded_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_balance_reference_unique unique (payment_method, external_reference),
  constraint service_balance_status_evidence check (
    (status = 'CAPTURED' and captured_at is not null and refunded_amount = 0)
    or (status = 'REFUNDED'
      and captured_at is not null
      and refunded_at is not null
      and refunded_by is not null
      and nullif(trim(refund_reference), '') is not null
      and refunded_amount > 0
      and refunded_amount <= amount)
    or (status in ('VOIDED', 'FAILED') and refunded_amount = 0)
  )
);

create index if not exists service_balance_request_created_idx
  on public.service_balance_transactions(client_service_request_id, created_at desc);
create index if not exists service_balance_captured_idx
  on public.service_balance_transactions(captured_at desc)
  where status in ('CAPTURED', 'REFUNDED');

alter table public.service_balance_transactions enable row level security;

drop policy if exists "service balance transactions: client or admin read"
  on public.service_balance_transactions;
create policy "service balance transactions: client or admin read"
on public.service_balance_transactions for select to authenticated
using (public.is_admin() or public.is_client_member(client_id));

revoke all on table public.service_balance_transactions from public;
revoke all on table public.service_balance_transactions from anon;
revoke all on table public.service_balance_transactions from authenticated;
grant select on table public.service_balance_transactions to authenticated;

comment on table public.service_balance_transactions is
  'Auditable service-balance receipts. Browser clients can only read rows allowed by RLS; writes occur through administrator RPCs.';

create or replace function public.enforce_service_balance_transaction_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_request public.client_service_requests%rowtype;
begin
  select request.* into target_request
  from public.client_service_requests request
  where request.id = new.client_service_request_id;

  if not found then
    raise exception 'Service request not found';
  end if;
  if target_request.client_id <> new.client_id then
    raise exception 'Balance payment client does not match the service request';
  end if;

  new.payment_method := upper(trim(new.payment_method));
  new.external_reference := trim(new.external_reference);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists enforce_service_balance_transaction_target_trigger
  on public.service_balance_transactions;
create trigger enforce_service_balance_transaction_target_trigger
before insert or update of client_service_request_id, client_id, amount, currency,
  payment_method, external_reference, status, refunded_amount
on public.service_balance_transactions
for each row execute function public.enforce_service_balance_transaction_target();

create or replace function public.record_service_balance_payment(
  p_request_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_reference text
)
returns public.service_balance_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  result_row public.service_balance_transactions%rowtype;
  normalized_method text := upper(trim(coalesce(p_payment_method, '')));
  normalized_reference text := trim(coalesce(p_payment_reference, ''));
  normalized_amount numeric(10,2) := round(coalesce(p_amount, 0)::numeric, 2);
  expected_total numeric(10,2);
  deposit_net numeric(10,2);
  balance_net numeric(10,2);
  outstanding numeric(10,2);
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can record service payments';
  end if;
  if length(normalized_method) not between 2 and 40 then
    raise exception 'A valid payment method is required';
  end if;
  if length(normalized_reference) not between 3 and 255 then
    raise exception 'A valid external payment reference is required';
  end if;
  if normalized_amount <= 0 then
    raise exception 'The received amount must be greater than zero';
  end if;

  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found';
  end if;
  if request_row.status <> 'APPROVED' then
    raise exception 'Only an approved service request can receive a balance payment';
  end if;

  expected_total := round(coalesce(request_row.estimated_total, 0)::numeric, 2);
  if expected_total <= 0 then
    raise exception 'The approved request does not have a valid service total';
  end if;

  select coalesce(sum(
    case
      when deposit.status = 'CAPTURED' then deposit.amount
      when deposit.status = 'REFUNDED' then greatest(deposit.amount - coalesce(deposit.refunded_amount, 0), 0)
      else 0
    end
  ), 0)::numeric(10,2)
  into deposit_net
  from public.deposit_transactions deposit
  where deposit.client_service_request_id = request_row.id;

  if deposit_net <= 0 then
    raise exception 'Captured reservation-deposit evidence is required before recording a balance payment';
  end if;

  select coalesce(sum(
    case
      when balance.status = 'CAPTURED' then balance.amount
      when balance.status = 'REFUNDED' then greatest(balance.amount - balance.refunded_amount, 0)
      else 0
    end
  ), 0)::numeric(10,2)
  into balance_net
  from public.service_balance_transactions balance
  where balance.client_service_request_id = request_row.id;

  outstanding := greatest(expected_total - deposit_net - balance_net, 0);
  if outstanding <= 0 then
    raise exception 'This service request has no outstanding balance';
  end if;
  if normalized_amount > outstanding then
    raise exception 'The received amount exceeds the outstanding balance';
  end if;

  insert into public.service_balance_transactions (
    client_service_request_id,
    client_id,
    amount,
    currency,
    status,
    payment_method,
    external_reference,
    idempotency_key,
    recorded_by,
    captured_at
  ) values (
    request_row.id,
    request_row.client_id,
    normalized_amount,
    'USD',
    'CAPTURED',
    normalized_method,
    normalized_reference,
    'service-balance:' || request_row.id::text || ':' || encode(digest(normalized_method || ':' || normalized_reference, 'sha256'), 'hex'),
    auth.uid(),
    now()
  )
  returning * into result_row;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'RECORD_SERVICE_BALANCE_PAYMENT',
    'service_balance_transactions',
    result_row.id,
    jsonb_build_object(
      'client_service_request_id', request_row.id,
      'amount', result_row.amount,
      'currency', result_row.currency,
      'payment_method', result_row.payment_method,
      'outstanding_before_payment', outstanding,
      'outstanding_after_payment', greatest(outstanding - result_row.amount, 0)
    )
  );

  return result_row;
exception
  when unique_violation then
    raise exception 'This payment reference has already been recorded';
end;
$$;

revoke all on function public.record_service_balance_payment(uuid, numeric, text, text) from public;
revoke all on function public.record_service_balance_payment(uuid, numeric, text, text) from anon;
grant execute on function public.record_service_balance_payment(uuid, numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
