-- Started postpartum cancellation settlement and fixed daily schedule.
-- Daily visit span: 8 hours of care + 60-minute meal + 30-minute rest = 9.5 hours.

alter table public.service_adjustment_requests
  add column if not exists original_contract_value numeric(10,2),
  add column if not exists remaining_care_days integer check (remaining_care_days is null or remaining_care_days > 0),
  add column if not exists cancellation_settlement_amount numeric(10,2) check (cancellation_settlement_amount is null or cancellation_settlement_amount >= 0),
  add column if not exists cancellation_formula text;

alter table public.care_assignments
  add column if not exists care_minutes integer not null default 480 check (care_minutes = 480),
  add column if not exists meal_break_minutes integer not null default 60 check (meal_break_minutes = 60),
  add column if not exists rest_break_minutes integer not null default 30 check (rest_break_minutes = 30),
  add column if not exists cancellation_settlement_amount numeric(10,2),
  add column if not exists remaining_care_days_at_cancellation integer;

alter table public.client_service_requests
  add column if not exists care_minutes integer not null default 480 check (care_minutes = 480),
  add column if not exists meal_break_minutes integer not null default 60 check (meal_break_minutes = 60),
  add column if not exists rest_break_minutes integer not null default 30 check (rest_break_minutes = 30),
  add column if not exists cancellation_settlement_amount numeric(10,2),
  add column if not exists remaining_care_days_at_cancellation integer;

update public.client_service_requests
set daily_start_time = least(daily_start_time, time '14:29'),
    daily_end_time = (least(daily_start_time, time '14:29') + interval '9 hours 30 minutes')::time
where service_type = 'POSTPARTUM';

update public.care_assignments
set daily_start_time = least(daily_start_time, time '14:29'),
    daily_end_time = (least(daily_start_time, time '14:29') + interval '9 hours 30 minutes')::time
where service_type = 'POSTPARTUM'
  and daily_start_time is not null;

update public.service_adjustment_requests
set proposed_daily_start_time = least(proposed_daily_start_time, time '14:29'),
    proposed_daily_end_time = (least(proposed_daily_start_time, time '14:29') + interval '9 hours 30 minutes')::time
where service_type = 'POSTPARTUM'
  and action = 'CHANGE'
  and proposed_daily_start_time is not null;

alter table public.client_service_requests
  drop constraint if exists postpartum_fixed_daily_schedule;
alter table public.client_service_requests
  add constraint postpartum_fixed_daily_schedule check (
    service_type <> 'POSTPARTUM'
    or (
      daily_start_time <= time '14:29'
      and daily_end_time - daily_start_time = interval '9 hours 30 minutes'
    )
  );

alter table public.care_assignments
  drop constraint if exists postpartum_fixed_assignment_schedule;
alter table public.care_assignments
  add constraint postpartum_fixed_assignment_schedule check (
    service_type <> 'POSTPARTUM'
    or daily_start_time is null
    or (
      daily_start_time <= time '14:29'
      and daily_end_time - daily_start_time = interval '9 hours 30 minutes'
    )
  );

alter table public.service_adjustment_requests
  drop constraint if exists postpartum_fixed_adjustment_schedule;
alter table public.service_adjustment_requests
  add constraint postpartum_fixed_adjustment_schedule check (
    action = 'CANCEL'
    or service_type <> 'POSTPARTUM'
    or (
      proposed_daily_start_time <= time '14:29'
      and proposed_daily_end_time - proposed_daily_start_time = interval '9 hours 30 minutes'
    )
  );

alter table public.service_adjustment_requests
  drop constraint if exists service_adjustment_requests_policy_code_check;
alter table public.service_adjustment_requests
  add constraint service_adjustment_requests_policy_code_check
  check (policy_code in (
    'DEPOSIT_REFUNDABLE',
    'DEPOSIT_NON_REFUNDABLE',
    'POSTPARTUM_ACTIVE_PRORATED',
    'BABYSITTING_DEPOSIT_REFUNDABLE',
    'BABYSITTING_DEPOSIT_NON_REFUNDABLE',
    'STANDARD_NOTICE',
    'LATE_NOTICE',
    'SHORT_NOTICE'
  ));

create or replace function public.enforce_started_postpartum_start_date()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  assignment_start timestamptz;
begin
  if new.service_type = 'POSTPARTUM'
     and new.action = 'CHANGE'
     and new.care_assignment_id is not null then
    select starts_at into assignment_start
    from public.care_assignments
    where id = new.care_assignment_id;

    if assignment_start <= now()
       and new.proposed_start_date is distinct from assignment_start::date then
      raise exception 'A started postpartum service cannot change its original start date';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_started_postpartum_start_date_trigger
  on public.service_adjustment_requests;
create trigger enforce_started_postpartum_start_date_trigger
before insert or update of proposed_start_date, action
on public.service_adjustment_requests
for each row execute function public.enforce_started_postpartum_start_date();

comment on column public.service_adjustment_requests.cancellation_settlement_amount is
  'For a started postpartum service: (original contract value - deposit) / remaining scheduled care days.';
