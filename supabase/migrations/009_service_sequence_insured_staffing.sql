-- Enforce sequential postpartum -> babysitting service delivery and prepare insured premium add-ons.
-- Apply after 008_public_site_service_types.sql.

update public.service_packages
set default_rate = 1800.00,
    description = concat_ws(' · ', nullif(description, ''), 'Weekly rate; insured W-2 employee staffing')
where service_type = 'POSTPARTUM';

alter table public.client_service_requests
  add column weekly_rate numeric(10,2),
  add column estimated_total numeric(10,2),
  add column sequence_policy_accepted boolean not null default false,
  add column insured_staffing_acknowledged boolean not null default false;

alter table public.care_assignments
  add column weekly_rate numeric(10,2),
  add column contract_value numeric(10,2),
  add column insured_staffing boolean not null default true,
  add column employee_classification text not null default 'W-2';

alter table public.care_assignments
  add constraint postpartum_weekly_rate_check
  check (
    service_type <> 'POSTPARTUM'
    or (weekly_rate is not null and weekly_rate >= 0)
  );

create table public.company_compliance_controls (
  id uuid primary key default gen_random_uuid(),
  control_key text not null unique,
  display_name text not null,
  status text not null check (status in ('ACTIVE', 'REVIEW_REQUIRED', 'INACTIVE')),
  verified_at timestamptz,
  expires_at date,
  evidence_reference text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.company_compliance_controls(control_key, display_name, status, notes)
values
  ('GENERAL_LIABILITY', '책임보상보험', 'ACTIVE', 'Customer-facing proof should be linked before production launch.'),
  ('WORKERS_COMP', '근로자재해보험', 'ACTIVE', 'Applies to company employees assigned to customer homes.'),
  ('W2_EMPLOYMENT', 'W-2 정식 직원 운영', 'ACTIVE', 'Payroll, withholding and employment obligations are handled by the company.'),
  ('MASSAGE_LIABILITY_RIDER', '마사지 업무 보험 범위', 'REVIEW_REQUIRED', 'Required before the massage add-on can be enabled.')
on conflict (control_key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    notes = excluded.notes,
    updated_at = now();

create table public.service_add_ons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  parent_service_type public.care_service_type not null,
  enabled boolean not null default false,
  license_type text,
  license_required boolean not null default false,
  insurance_control_key text references public.company_compliance_controls(control_key),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_add_ons(
  code,
  name,
  parent_service_type,
  enabled,
  license_type,
  license_required,
  insurance_control_key,
  description
)
values (
  'PREMIUM_MATERNAL_MASSAGE',
  '프리미엄 산모 마사지',
  'POSTPARTUM',
  false,
  'Georgia Massage Therapist License',
  true,
  'MASSAGE_LIABILITY_RIDER',
  'Postpartum add-on delivered only by a Georgia-licensed massage therapist after license and insurance verification.'
)
on conflict (code) do update
set name = excluded.name,
    parent_service_type = excluded.parent_service_type,
    license_type = excluded.license_type,
    license_required = excluded.license_required,
    insurance_control_key = excluded.insurance_control_key,
    description = excluded.description,
    updated_at = now();

create or replace function public.enforce_assignment_service_sequence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_client_id uuid;
  target_baby_id uuid;
begin
  if new.status = 'CANCELLED' then
    return new;
  end if;

  select client_id, baby_id
  into target_client_id, target_baby_id
  from public.care_contracts
  where id = new.contract_id;

  if exists (
    select 1
    from public.care_assignments existing_assignment
    join public.care_contracts existing_contract
      on existing_contract.id = existing_assignment.contract_id
    where existing_assignment.id <> new.id
      and existing_assignment.status <> 'CANCELLED'
      and (
        (target_baby_id is not null and existing_contract.baby_id = target_baby_id)
        or (target_baby_id is null and existing_contract.client_id = target_client_id)
      )
      and tstzrange(existing_assignment.starts_at, existing_assignment.ends_at, '[]')
          && tstzrange(new.starts_at, new.ends_at, '[]')
  ) then
    raise exception 'The baby already has a service assignment during the requested period';
  end if;

  if new.service_type = 'BABYSITTING' and exists (
    select 1
    from public.care_assignments postpartum_assignment
    join public.care_contracts postpartum_contract
      on postpartum_contract.id = postpartum_assignment.contract_id
    where postpartum_assignment.id <> new.id
      and postpartum_assignment.status <> 'CANCELLED'
      and postpartum_assignment.service_type = 'POSTPARTUM'
      and (
        (target_baby_id is not null and postpartum_contract.baby_id = target_baby_id)
        or (target_baby_id is null and postpartum_contract.client_id = target_client_id)
      )
      and new.starts_at::date <= postpartum_assignment.ends_at::date
  ) then
    raise exception 'Babysitting must start on the day after postpartum care ends';
  end if;

  if new.service_type = 'POSTPARTUM' and exists (
    select 1
    from public.care_assignments babysitting_assignment
    join public.care_contracts babysitting_contract
      on babysitting_contract.id = babysitting_assignment.contract_id
    where babysitting_assignment.id <> new.id
      and babysitting_assignment.status <> 'CANCELLED'
      and babysitting_assignment.service_type = 'BABYSITTING'
      and (
        (target_baby_id is not null and babysitting_contract.baby_id = target_baby_id)
        or (target_baby_id is null and babysitting_contract.client_id = target_client_id)
      )
      and new.ends_at::date >= babysitting_assignment.starts_at::date
  ) then
    raise exception 'Postpartum care must finish before babysitting begins';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_assignment_service_sequence_trigger
  on public.care_assignments;

create trigger enforce_assignment_service_sequence_trigger
before insert or update of contract_id, service_type, starts_at, ends_at, status
on public.care_assignments
for each row execute function public.enforce_assignment_service_sequence();

create or replace function public.enforce_request_service_sequence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  request_end_date date;
begin
  if new.status in ('REJECTED', 'CANCELLED') then
    return new;
  end if;

  request_end_date := new.desired_start_date + (new.requested_weeks * 7 - 1);

  if exists (
    select 1
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.status <> 'CANCELLED'
      and contract.client_id = new.client_id
      and (new.baby_id is null or contract.baby_id = new.baby_id)
      and daterange(assignment.starts_at::date, assignment.ends_at::date, '[]')
          && daterange(new.desired_start_date, request_end_date, '[]')
  ) then
    raise exception 'The requested service period overlaps an existing assignment';
  end if;

  if new.service_type = 'BABYSITTING' and exists (
    select 1
    from public.care_assignments postpartum_assignment
    join public.care_contracts postpartum_contract
      on postpartum_contract.id = postpartum_assignment.contract_id
    where postpartum_assignment.status <> 'CANCELLED'
      and postpartum_assignment.service_type = 'POSTPARTUM'
      and postpartum_contract.client_id = new.client_id
      and (new.baby_id is null or postpartum_contract.baby_id = new.baby_id)
      and new.desired_start_date <= postpartum_assignment.ends_at::date
  ) then
    raise exception 'Babysitting must start on the day after postpartum care ends';
  end if;

  if new.service_type = 'POSTPARTUM' and exists (
    select 1
    from public.care_assignments babysitting_assignment
    join public.care_contracts babysitting_contract
      on babysitting_contract.id = babysitting_assignment.contract_id
    where babysitting_assignment.status <> 'CANCELLED'
      and babysitting_assignment.service_type = 'BABYSITTING'
      and babysitting_contract.client_id = new.client_id
      and (new.baby_id is null or babysitting_contract.baby_id = new.baby_id)
      and request_end_date >= babysitting_assignment.starts_at::date
  ) then
    raise exception 'Postpartum care must finish before babysitting begins';
  end if;

  if new.service_type = 'POSTPARTUM' then
    new.weekly_rate := 1800.00;
    new.estimated_total := 1800.00 * new.requested_weeks;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_request_service_sequence_trigger
  on public.client_service_requests;

create trigger enforce_request_service_sequence_trigger
before insert or update of client_id, baby_id, service_type, desired_start_date, requested_weeks, status
on public.client_service_requests
for each row execute function public.enforce_request_service_sequence();

comment on table public.company_compliance_controls is
  'Administrative evidence register for liability insurance, workers compensation, employment and licensed add-on readiness.';

comment on table public.service_add_ons is
  'Future premium add-ons. Disabled offerings must never be selectable by customers.';
