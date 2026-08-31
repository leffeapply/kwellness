-- Administrator-only client CRM and caregiver HR records.
-- Kept in separate tables so internal notes are not exposed through family or caregiver RLS.

create table public.client_management_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  lifecycle_status text not null default 'LEAD'
    check (lifecycle_status in ('LEAD', 'ACTIVE', 'PAUSED', 'COMPLETED')),
  maternal_status text,
  preferred_language text,
  emergency_contact text,
  next_contact_date date,
  internal_memo text,
  baby_admin_notes text,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.caregiver_hr_profiles (
  caregiver_id uuid primary key references public.caregivers(id) on delete cascade,
  hire_date date,
  career_years numeric(4,1) not null default 0 check (career_years >= 0),
  employment_status text not null default 'APPLICANT'
    check (employment_status in ('APPLICANT', 'ACTIVE', 'ON_LEAVE', 'INACTIVE')),
  career_summary text,
  specialties text,
  residential_area text,
  service_area_notes text,
  hr_notes text,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_management_profiles enable row level security;
alter table public.caregiver_hr_profiles enable row level security;

create policy "client management profiles: staff read" on public.client_management_profiles
for select to authenticated using (public.is_care_staff());
create policy "client management profiles: staff create" on public.client_management_profiles
for insert to authenticated with check (public.is_care_staff() and updated_by = auth.uid());
create policy "client management profiles: staff update" on public.client_management_profiles
for update to authenticated using (public.is_care_staff())
with check (public.is_care_staff() and updated_by = auth.uid());

create policy "caregiver hr profiles: staff read" on public.caregiver_hr_profiles
for select to authenticated using (public.is_care_staff());
create policy "caregiver hr profiles: staff create" on public.caregiver_hr_profiles
for insert to authenticated with check (public.is_care_staff() and updated_by = auth.uid());
create policy "caregiver hr profiles: staff update" on public.caregiver_hr_profiles
for update to authenticated using (public.is_care_staff())
with check (public.is_care_staff() and updated_by = auth.uid());

create index client_management_lifecycle_idx
  on public.client_management_profiles(lifecycle_status, next_contact_date);
create index caregiver_hr_employment_idx
  on public.caregiver_hr_profiles(employment_status, hire_date);

-- Production writes should also add an audit_logs row for CRM_MEMO_UPDATED,
-- CLIENT_PROFILE_UPDATED, or CAREGIVER_HR_UPDATED without copying memo contents.
