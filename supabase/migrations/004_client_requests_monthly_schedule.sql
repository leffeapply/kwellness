-- Client onboarding requests, schedule approval, and auditable assignment changes.
-- Apply after 001_core.sql, 002_retail.sql, and 003_auth_approvals_access.sql.

create type public.client_request_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

create table public.client_service_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  baby_id uuid references public.babies(id),
  birth_or_due_date date not null,
  requested_weeks integer not null check (requested_weeks in (2, 3, 4)),
  desired_start_date date not null,
  daily_start_time time not null,
  daily_end_time time not null,
  service_address text not null,
  household_extra_people integer not null default 0 check (household_extra_people >= 0),
  allergy_notes text not null default '없음',
  special_notes text,
  status public.client_request_status not null default 'PENDING',
  approved_assignment_id uuid references public.care_assignments(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_requested_visit_time check (daily_end_time > daily_start_time)
);

alter table public.care_assignments
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references public.profiles(id),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id),
  add column cancellation_reason text;

create index client_service_requests_status_idx
  on public.client_service_requests(status, desired_start_date, created_at);
create index care_assignments_month_calendar_idx
  on public.care_assignments(starts_at, ends_at, status);

create or replace function public.caregiver_is_available(
  target_caregiver_id uuid,
  requested_start timestamptz,
  requested_end timestamptz,
  excluded_assignment_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.care_assignments a
    where a.caregiver_id = target_caregiver_id
      and a.status not in ('CANCELLED', 'COMPLETED')
      and (excluded_assignment_id is null or a.id <> excluded_assignment_id)
      and tstzrange(a.starts_at, a.ends_at, '[]') && tstzrange(requested_start, requested_end, '[]')
  );
$$;

create or replace function public.approve_client_service_request(
  request_id uuid,
  selected_caregiver_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  contract_id uuid;
  assignment_id uuid;
  requested_start timestamptz;
  requested_end timestamptz;
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can approve client requests';
  end if;

  select * into request_row
  from public.client_service_requests
  where id = request_id and status = 'PENDING'
  for update;

  if not found then
    raise exception 'Pending client request not found';
  end if;

  requested_start := request_row.desired_start_date + request_row.daily_start_time;
  requested_end := (request_row.desired_start_date + request_row.daily_end_time)
    + ((request_row.requested_weeks * 7 - 1) * interval '1 day');

  if not exists (
    select 1 from public.caregivers
    where id = selected_caregiver_id and status = 'ACTIVE'
  ) then
    raise exception 'Selected caregiver is not active';
  end if;

  if not public.caregiver_is_available(selected_caregiver_id, requested_start, requested_end) then
    raise exception 'The selected caregiver is no longer available for this period';
  end if;

  insert into public.care_contracts (
    client_id, baby_id, start_date, end_date, status, created_by
  ) values (
    request_row.client_id,
    request_row.baby_id,
    request_row.desired_start_date,
    request_row.desired_start_date + (request_row.requested_weeks * 7 - 1),
    'ACTIVE',
    auth.uid()
  ) returning id into contract_id;

  insert into public.care_assignments (
    contract_id, caregiver_id, starts_at, ends_at, status, assigned_by,
    service_address, daily_start_time, daily_end_time, household_extra_people,
    allergy_notes, client_request_note, contract_weeks
  ) values (
    contract_id, selected_caregiver_id, requested_start, requested_end, 'CONFIRMED', auth.uid(),
    request_row.service_address, request_row.daily_start_time, request_row.daily_end_time,
    request_row.household_extra_people, request_row.allergy_notes,
    request_row.special_notes, request_row.requested_weeks
  ) returning id into assignment_id;

  update public.client_service_requests
  set status = 'APPROVED', approved_assignment_id = assignment_id,
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = request_id;

  update public.clients set status = 'ACTIVE', updated_at = now()
  where id = request_row.client_id;

  insert into public.user_roles(user_id, role)
  values (request_row.requested_by, 'CLIENT')
  on conflict do nothing;

  return assignment_id;
end;
$$;

alter table public.client_service_requests enable row level security;

create policy "client requests: applicant create" on public.client_service_requests
for insert to authenticated
with check (requested_by = auth.uid() and status = 'PENDING');

create policy "client requests: applicant or staff read" on public.client_service_requests
for select to authenticated
using (requested_by = auth.uid() or public.is_care_staff());

create policy "client requests: staff review" on public.client_service_requests
for update to authenticated
using (public.is_care_staff()) with check (public.is_care_staff());

drop policy if exists "clients: member or staff read" on public.clients;
create policy "clients: approved member or staff read" on public.clients
for select to authenticated
using (public.is_care_staff() or (status = 'ACTIVE' and public.is_client_member(id)));

drop policy if exists "babies: family or staff read" on public.babies;
create policy "babies: approved family or staff read" on public.babies
for select to authenticated
using (
  public.is_care_staff()
  or exists (
    select 1 from public.clients c
    where c.id = client_id and c.status = 'ACTIVE' and public.is_client_member(c.id)
  )
);

-- Production onboarding should create the new client with status='LEAD', create
-- its client_member and baby rows, then insert one PENDING client_service_request.
-- The customer receives no CLIENT role until approve_client_service_request()
-- commits the contract and assignment in the same transaction.
