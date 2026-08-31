-- K-Wellness CareOS core schema draft
-- Run in a new Supabase project only after reviewing retention, consent,
-- healthcare-data obligations, and the exact staff access model.

create extension if not exists pgcrypto;

create type public.app_role as enum (
  'OWNER', 'ADMIN', 'CARE_MANAGER', 'CAREGIVER', 'CLIENT', 'RETAIL_STAFF'
);
create type public.contract_status as enum ('DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');
create type public.session_status as enum ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
create type public.report_status as enum ('DRAFT', 'REVIEWED', 'PUBLISHED');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  preferred_language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  status text not null default 'ACTIVE' check (status in ('LEAD', 'ACTIVE', 'INACTIVE')),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_members (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  relationship text not null default 'PARENT',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

create table public.babies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  first_name text not null,
  birth_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.caregivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'ON_LEAVE')),
  hourly_rate numeric(10,2),
  certifications jsonb not null default '[]'::jsonb,
  service_area jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_type text not null default 'POSTPARTUM',
  description text,
  default_rate numeric(10,2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.care_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  baby_id uuid references public.babies(id),
  service_package_id uuid references public.service_packages(id),
  start_date date not null,
  end_date date not null,
  agreed_rate numeric(10,2),
  status public.contract_status not null default 'DRAFT',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_contract_dates check (end_date >= start_date)
);

create table public.care_assignments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.care_contracts(id) on delete cascade,
  caregiver_id uuid not null references public.caregivers(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'CONFIRMED' check (status in ('PROPOSED', 'CONFIRMED', 'CANCELLED', 'COMPLETED')),
  assigned_by uuid not null references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  constraint valid_assignment_times check (ends_at > starts_at)
);

create table public.care_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.care_assignments(id),
  status public.session_status not null default 'SCHEDULED',
  started_at timestamptz,
  ended_at timestamptz,
  started_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_session_times check (ended_at is null or started_at is null or ended_at >= started_at)
);

create table public.care_events (
  id uuid primary key default gen_random_uuid(),
  care_session_id uuid not null references public.care_sessions(id) on delete cascade,
  event_type text not null check (event_type in ('FEEDING', 'DIAPER', 'SLEEP', 'TEMPERATURE', 'BATH', 'MOTHER_CARE', 'NOTE')),
  event_time timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  notes text,
  unusual_observation boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.care_reports (
  id uuid primary key default gen_random_uuid(),
  care_session_id uuid not null unique references public.care_sessions(id) on delete cascade,
  status public.report_status not null default 'DRAFT',
  summary text,
  structured_summary jsonb not null default '{}'::jsonb,
  generated_by_ai boolean not null default false,
  reviewed_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  consent_type text not null,
  version text not null,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text not null,
  record_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index care_contracts_client_idx on public.care_contracts(client_id, status);
create index care_assignments_caregiver_time_idx on public.care_assignments(caregiver_id, starts_at);
create index care_events_session_time_idx on public.care_events(care_session_id, event_time);
create index client_members_user_idx on public.client_members(user_id);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id, occurred_at desc);

create or replace function public.has_role(requested_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = requested_role
  );
$$;

create or replace function public.is_care_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('OWNER')
      or public.has_role('ADMIN')
      or public.has_role('CARE_MANAGER');
$$;

create or replace function public.is_client_member(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.client_members
    where client_id = target_client_id and user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.babies enable row level security;
alter table public.caregivers enable row level security;
alter table public.service_packages enable row level security;
alter table public.care_contracts enable row level security;
alter table public.care_assignments enable row level security;
alter table public.care_sessions enable row level security;
alter table public.care_events enable row level security;
alter table public.care_reports enable row level security;
alter table public.consents enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles: self or staff read" on public.profiles
for select to authenticated using (id = auth.uid() or public.is_care_staff());
create policy "profiles: self update" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "roles: self or staff read" on public.user_roles
for select to authenticated using (user_id = auth.uid() or public.is_care_staff());
create policy "roles: staff manage" on public.user_roles
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "clients: member or staff read" on public.clients
for select to authenticated using (public.is_care_staff() or public.is_client_member(id));
create policy "clients: staff manage" on public.clients
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "client members: self or staff read" on public.client_members
for select to authenticated using (user_id = auth.uid() or public.is_care_staff());
create policy "client members: staff manage" on public.client_members
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "babies: family or staff read" on public.babies
for select to authenticated using (public.is_care_staff() or public.is_client_member(client_id));
create policy "babies: staff manage" on public.babies
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "caregivers: self or staff read" on public.caregivers
for select to authenticated using (user_id = auth.uid() or public.is_care_staff());
create policy "caregivers: staff manage" on public.caregivers
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "service packages: authenticated read" on public.service_packages
for select to authenticated using (true);
create policy "service packages: staff manage" on public.service_packages
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "contracts: family or staff read" on public.care_contracts
for select to authenticated using (public.is_care_staff() or public.is_client_member(client_id));
create policy "contracts: staff manage" on public.care_contracts
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "assignments: assigned caregiver or staff read" on public.care_assignments
for select to authenticated using (
  public.is_care_staff()
  or exists (select 1 from public.caregivers c where c.id = caregiver_id and c.user_id = auth.uid())
);
create policy "assignments: staff manage" on public.care_assignments
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "sessions: assigned caregiver or staff read" on public.care_sessions
for select to authenticated using (
  public.is_care_staff()
  or exists (
    select 1 from public.care_assignments a
    join public.caregivers c on c.id = a.caregiver_id
    where a.id = assignment_id and c.user_id = auth.uid()
  )
);
create policy "sessions: assigned caregiver update" on public.care_sessions
for update to authenticated using (
  public.is_care_staff()
  or exists (
    select 1 from public.care_assignments a
    join public.caregivers c on c.id = a.caregiver_id
    where a.id = assignment_id and c.user_id = auth.uid()
  )
);

create policy "events: care team read" on public.care_events
for select to authenticated using (
  public.is_care_staff()
  or created_by = auth.uid()
  or exists (
    select 1 from public.care_sessions s
    join public.care_assignments a on a.id = s.assignment_id
    join public.caregivers c on c.id = a.caregiver_id
    where s.id = care_session_id and c.user_id = auth.uid()
  )
);
create policy "events: assigned caregiver insert" on public.care_events
for insert to authenticated with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.care_sessions s
    join public.care_assignments a on a.id = s.assignment_id
    join public.caregivers c on c.id = a.caregiver_id
    where s.id = care_session_id and c.user_id = auth.uid()
  )
);
create policy "events: author or staff update" on public.care_events
for update to authenticated using (created_by = auth.uid() or public.is_care_staff())
with check (created_by = auth.uid() or public.is_care_staff());

create policy "reports: care team read" on public.care_reports
for select to authenticated using (public.is_care_staff() or reviewed_by = auth.uid());
create policy "reports: staff manage" on public.care_reports
for all to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "consents: family or staff read" on public.consents
for select to authenticated using (public.is_care_staff() or public.is_client_member(client_id));
create policy "consents: family create" on public.consents
for insert to authenticated with check (granted_by = auth.uid() and public.is_client_member(client_id));

create policy "audit logs: staff read" on public.audit_logs
for select to authenticated using (public.is_care_staff());

-- Intentionally omitted at this stage:
-- 1) direct client access to raw care_events (publish only reviewed client-safe data),
-- 2) audit log insertion triggers (define exact sensitive fields before logging),
-- 3) Storage policies, retention jobs, and hard-delete workflows.
