-- Authentication, caregiver approval, assignment-scoped access, reports, and shipping.
-- Passwords are never stored in public tables. Admin/Retail seed accounts must be
-- created through Supabase Auth and required to change their temporary password.

create type public.caregiver_approval_status as enum ('PENDING', 'APPROVED', 'REJECTED');
create type public.shipment_status as enum ('ORDER_RECEIVED', 'PREPARING', 'SHIPPED', 'DELIVERED');

create table public.caregiver_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  certification_summary text not null,
  status public.caregiver_approval_status not null default 'PENDING',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

alter table public.care_assignments
  add column service_address text,
  add column daily_start_time time,
  add column daily_end_time time,
  add column household_extra_people integer not null default 0 check (household_extra_people >= 0),
  add column allergy_notes text,
  add column client_request_note text,
  add column contract_weeks integer check (contract_weeks in (2, 3, 4));

alter table public.care_reports
  add column pdf_storage_path text,
  add column published_to_client boolean not null default false;

create table public.retail_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.retail_orders(id) on delete cascade,
  status public.shipment_status not null default 'ORDER_RECEIVED',
  carrier text,
  tracking_number text,
  updated_by uuid not null references public.profiles(id),
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.caregiver_has_active_assignment(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.care_assignments a
    join public.caregivers cg on cg.id = a.caregiver_id
    join public.care_contracts cc on cc.id = a.contract_id
    where cg.user_id = auth.uid()
      and cc.client_id = target_client_id
      and a.status = 'CONFIRMED'
      and now() between a.starts_at and a.ends_at
  );
$$;

create or replace function public.approve_caregiver(applicant_user_id uuid, approval_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can approve caregivers';
  end if;

  update public.caregiver_applications
  set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = approval_note
  where user_id = applicant_user_id and status = 'PENDING';

  if not found then
    raise exception 'Pending caregiver application not found';
  end if;

  insert into public.user_roles(user_id, role)
  values (applicant_user_id, 'CAREGIVER')
  on conflict do nothing;

  insert into public.caregivers(user_id, status)
  values (applicant_user_id, 'ACTIVE')
  on conflict (user_id) do update set status = 'ACTIVE';
end;
$$;

alter table public.caregiver_applications enable row level security;
alter table public.retail_shipments enable row level security;

create policy "caregiver applications: applicant read" on public.caregiver_applications
for select to authenticated using (user_id = auth.uid() or public.is_care_staff());
create policy "caregiver applications: applicant create" on public.caregiver_applications
for insert to authenticated with check (user_id = auth.uid() and status = 'PENDING');
create policy "caregiver applications: staff review" on public.caregiver_applications
for update to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

create policy "clients: active assigned caregiver read" on public.clients
for select to authenticated using (public.caregiver_has_active_assignment(id));
create policy "babies: active assigned caregiver read" on public.babies
for select to authenticated using (public.caregiver_has_active_assignment(client_id));
create policy "contracts: active assigned caregiver read" on public.care_contracts
for select to authenticated using (public.caregiver_has_active_assignment(client_id));

drop policy if exists "assignments: assigned caregiver or staff read" on public.care_assignments;
create policy "assignments: assigned caregiver or staff read" on public.care_assignments
for select to authenticated using (
  public.is_care_staff()
  or exists (
    select 1 from public.caregivers c
    where c.id = caregiver_id and c.user_id = auth.uid()
  )
);

drop policy if exists "sessions: assigned caregiver or staff read" on public.care_sessions;
drop policy if exists "sessions: assigned caregiver update" on public.care_sessions;
create policy "sessions: active care team or staff read" on public.care_sessions
for select to authenticated using (
  public.is_care_staff()
  or exists (
    select 1 from public.care_assignments a
    join public.caregivers c on c.id = a.caregiver_id
    where a.id = assignment_id
      and c.user_id = auth.uid()
      and now() between a.starts_at and a.ends_at
  )
);
create policy "sessions: active assigned caregiver update" on public.care_sessions
for update to authenticated using (
  public.is_care_staff()
  or exists (
    select 1 from public.care_assignments a
    join public.caregivers c on c.id = a.caregiver_id
    where a.id = assignment_id
      and c.user_id = auth.uid()
      and now() between a.starts_at and a.ends_at
  )
) with check (
  public.is_care_staff()
  or exists (
    select 1 from public.care_assignments a
    join public.caregivers c on c.id = a.caregiver_id
    where a.id = assignment_id
      and c.user_id = auth.uid()
      and now() between a.starts_at and a.ends_at
  )
);

drop policy if exists "events: care team read" on public.care_events;
drop policy if exists "events: assigned caregiver insert" on public.care_events;
drop policy if exists "events: author or staff update" on public.care_events;
create policy "events: authorized care data read" on public.care_events
for select to authenticated using (
  public.is_care_staff()
  or exists (
    select 1
    from public.care_sessions s
    join public.care_assignments a on a.id = s.assignment_id
    join public.caregivers c on c.id = a.caregiver_id
    where s.id = care_session_id
      and c.user_id = auth.uid()
      and now() between a.starts_at and a.ends_at
  )
  or exists (
    select 1
    from public.care_sessions s
    join public.care_assignments a on a.id = s.assignment_id
    join public.care_contracts cc on cc.id = a.contract_id
    where s.id = care_session_id and public.is_client_member(cc.client_id)
  )
);
create policy "events: active caregiver insert" on public.care_events
for insert to authenticated with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.care_sessions s
    join public.care_assignments a on a.id = s.assignment_id
    join public.caregivers c on c.id = a.caregiver_id
    where s.id = care_session_id
      and c.user_id = auth.uid()
      and now() between a.starts_at and a.ends_at
      and s.status = 'IN_PROGRESS'
  )
);
create policy "events: active author or staff update" on public.care_events
for update to authenticated using (
  public.is_care_staff()
  or (
    created_by = auth.uid()
    and exists (
      select 1 from public.care_sessions s
      join public.care_assignments a on a.id = s.assignment_id
      where s.id = care_session_id and now() between a.starts_at and a.ends_at
    )
  )
);

drop policy if exists "reports: care team read" on public.care_reports;
create policy "reports: staff caregiver or client read" on public.care_reports
for select to authenticated using (
  public.is_care_staff()
  or reviewed_by = auth.uid()
  or exists (
    select 1
    from public.care_sessions s
    join public.care_assignments a on a.id = s.assignment_id
    join public.care_contracts cc on cc.id = a.contract_id
    where s.id = care_session_id
      and published_to_client
      and public.is_client_member(cc.client_id)
  )
);

create policy "shipments: customer or retail staff read" on public.retail_shipments
for select to authenticated using (
  public.is_retail_staff()
  or exists (
    select 1 from public.retail_orders o
    where o.id = order_id
      and o.client_id is not null
      and public.is_client_member(o.client_id)
  )
);
create policy "shipments: retail staff manage" on public.retail_shipments
for all to authenticated using (public.is_retail_staff()) with check (public.is_retail_staff());

create index caregiver_applications_status_idx on public.caregiver_applications(status, created_at);
create index retail_shipments_status_idx on public.retail_shipments(status, updated_at);

-- Production signup flow:
-- 1) Supabase Auth creates the user and profile.
-- 2) CLIENT receives CLIENT role and creates a client_member relationship.
-- 3) CAREGIVER creates a PENDING caregiver_application but receives no caregiver access.
-- 4) An administrator calls approve_caregiver(), which grants the CAREGIVER role.
-- 5) PDF generation runs server-side, stores the file in a private bucket, and writes
--    care_reports.pdf_storage_path. The client receives a short-lived signed URL.
