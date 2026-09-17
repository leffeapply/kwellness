-- ProMoms 2026 service catalog: commute/live-in postpartum care, babysitting,
-- and conflict-aware prenatal/postpartum massage booking.

alter table public.caregiver_hr_profiles
  add column if not exists is_massage_therapist boolean not null default false;

create table if not exists public.massage_therapist_availability (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references public.caregivers(id) on delete cascade,
  available_date date not null,
  start_time time not null,
  end_time time not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint massage_availability_business_hours check (
    start_time >= time '09:00' and end_time <= time '20:00' and end_time > start_time
  ),
  unique (caregiver_id, available_date, start_time, end_time)
);

create table if not exists public.massage_booking_sessions (
  id uuid primary key default gen_random_uuid(),
  client_service_request_id uuid not null references public.client_service_requests(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  caregiver_id uuid not null references public.caregivers(id),
  session_number integer not null check (session_number between 1 and 4),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED')),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint massage_booking_session_time_check check (ends_at > starts_at),
  unique (client_service_request_id, session_number)
);

create table if not exists public.massage_booking_changes (
  id uuid primary key default gen_random_uuid(),
  massage_booking_session_id uuid not null references public.massage_booking_sessions(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  action text not null check (action in ('CHANGE', 'CANCEL')),
  proposed_caregiver_id uuid references public.caregivers(id),
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint massage_booking_change_payload_check check (
    (action = 'CANCEL' and proposed_caregiver_id is null and proposed_starts_at is null and proposed_ends_at is null)
    or (action = 'CHANGE' and proposed_caregiver_id is not null and proposed_starts_at is not null and proposed_ends_at > proposed_starts_at)
  )
);

create index if not exists massage_availability_lookup_idx
  on public.massage_therapist_availability(available_date, caregiver_id, start_time, end_time);
create index if not exists massage_booking_sessions_calendar_idx
  on public.massage_booking_sessions(caregiver_id, starts_at, ends_at, status);
create index if not exists massage_booking_sessions_client_idx
  on public.massage_booking_sessions(client_id, starts_at, status);

alter table public.client_service_requests
  alter column birth_or_due_date drop not null,
  add column if not exists postpartum_mode text,
  add column if not exists massage_duration_minutes integer,
  add column if not exists massage_session_count integer,
  add column if not exists massage_pricing_tier text,
  add column if not exists massage_linked_postpartum_assignment_id uuid
    references public.care_assignments(id) on delete set null;

update public.client_service_requests
set postpartum_mode = 'COMMUTE'
where service_type::text = 'POSTPARTUM' and postpartum_mode is null;

alter table public.client_service_requests
  drop constraint if exists client_service_requests_requested_weeks_check;
alter table public.client_service_requests
  add constraint client_service_requests_requested_weeks_check check (
    (service_type::text = 'POSTPARTUM' and postpartum_mode = 'COMMUTE' and requested_weeks in (2, 3, 4))
    or (service_type::text = 'POSTPARTUM' and postpartum_mode = 'LIVE_IN' and requested_weeks = 4)
    or (service_type::text = 'BABYSITTING' and requested_weeks in (2, 3, 4))
    or (service_type::text = 'MASSAGE' and requested_weeks in (1, 4))
  );
alter table public.client_service_requests
  add constraint client_service_requests_service_subject_check check (
    (service_type::text = 'MASSAGE' and baby_id is null and birth_or_due_date is null)
    or (service_type::text <> 'MASSAGE' and baby_id is not null and birth_or_due_date is not null)
  ) not valid,
  add constraint client_service_requests_postpartum_mode_check check (
    (service_type::text = 'POSTPARTUM' and postpartum_mode in ('COMMUTE', 'LIVE_IN'))
    or (service_type::text <> 'POSTPARTUM' and postpartum_mode is null)
  ),
  add constraint client_service_requests_massage_product_check check (
    (service_type::text <> 'MASSAGE'
      and massage_duration_minutes is null
      and massage_session_count is null
      and massage_pricing_tier is null)
    or (service_type::text = 'MASSAGE'
      and massage_duration_minutes in (60, 90)
      and massage_session_count in (1, 4)
      and requested_weeks = massage_session_count
      and massage_pricing_tier in ('GENERAL', 'POSTPARTUM_CLIENT')
      and (massage_session_count = 1
        or (massage_session_count = 4 and massage_duration_minutes = 60 and massage_pricing_tier = 'POSTPARTUM_CLIENT')))
  );

alter table public.care_assignments
  add column if not exists postpartum_mode text,
  add column if not exists massage_duration_minutes integer,
  add column if not exists massage_session_count integer,
  add column if not exists massage_pricing_tier text,
  add column if not exists massage_linked_postpartum_assignment_id uuid
    references public.care_assignments(id) on delete set null;

update public.care_assignments
set postpartum_mode = 'COMMUTE'
where service_type::text = 'POSTPARTUM' and postpartum_mode is null;

alter table public.care_assignments
  drop constraint if exists care_assignments_contract_weeks_check;
alter table public.care_assignments
  drop constraint if exists care_assignments_minimum_two_weeks;
alter table public.care_assignments
  add constraint care_assignments_service_duration_check check (
    (service_type::text = 'POSTPARTUM' and coalesce(postpartum_mode, 'COMMUTE') = 'COMMUTE' and contract_weeks in (2, 3, 4))
    or (service_type::text = 'POSTPARTUM' and postpartum_mode = 'LIVE_IN' and contract_weeks = 4)
    or (service_type::text = 'BABYSITTING' and contract_weeks in (2, 3, 4))
    or (service_type::text = 'MASSAGE' and contract_weeks in (1, 4))
  ),
  add constraint care_assignments_postpartum_mode_check check (
    (service_type::text = 'POSTPARTUM' and (postpartum_mode is null or postpartum_mode in ('COMMUTE', 'LIVE_IN')))
    or (service_type::text <> 'POSTPARTUM' and postpartum_mode is null)
  ),
  add constraint care_assignments_massage_product_check check (
    (service_type::text <> 'MASSAGE'
      and massage_duration_minutes is null
      and massage_session_count is null
      and massage_pricing_tier is null)
    or (service_type::text = 'MASSAGE'
      and massage_duration_minutes in (60, 90)
      and massage_session_count in (1, 4)
      and contract_weeks = massage_session_count
      and massage_pricing_tier in ('GENERAL', 'POSTPARTUM_CLIENT'))
  );

alter table public.service_adjustment_requests
  drop constraint if exists service_adjustment_requests_proposed_weeks_check;
alter table public.service_adjustment_requests
  add constraint service_adjustment_requests_proposed_weeks_check
  check (proposed_weeks is null or proposed_weeks in (1, 2, 3, 4));
alter table public.service_adjustment_requests
  drop constraint if exists service_adjustment_requests_policy_code_check;
alter table public.service_adjustment_requests
  add constraint service_adjustment_requests_policy_code_check check (policy_code in (
    'SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY',
    'DEPOSIT_REFUNDABLE', 'DEPOSIT_NON_REFUNDABLE', 'POSTPARTUM_ACTIVE_PRORATED',
    'BABYSITTING_DEPOSIT_REFUNDABLE', 'BABYSITTING_DEPOSIT_NON_REFUNDABLE',
    'STANDARD_NOTICE', 'LATE_NOTICE', 'SHORT_NOTICE',
    'MASSAGE_STANDARD_24H', 'MASSAGE_LATE_24H'
  ));
alter table public.service_adjustment_requests
  drop constraint if exists change_adjustment_has_no_deposit_penalty;
alter table public.service_adjustment_requests
  add constraint change_adjustment_has_no_deposit_penalty check (
    action <> 'CHANGE'
    or policy_code in ('SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY', 'MASSAGE_STANDARD_24H')
  );

create index if not exists massage_therapist_schedule_idx
  on public.care_assignments(caregiver_id, service_type, starts_at, ends_at);

create or replace function public.promoms_massage_price(
  p_pricing_tier text,
  p_duration_minutes integer,
  p_session_count integer
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_pricing_tier = 'POSTPARTUM_CLIENT' and p_session_count = 4 and p_duration_minutes = 60 then 520.00
    when p_pricing_tier = 'POSTPARTUM_CLIENT' and p_session_count = 1 and p_duration_minutes = 60 then 135.00
    when p_pricing_tier = 'POSTPARTUM_CLIENT' and p_session_count = 1 and p_duration_minutes = 90 then 190.00
    when p_pricing_tier = 'GENERAL' and p_session_count = 1 and p_duration_minutes = 60 then 150.00
    when p_pricing_tier = 'GENERAL' and p_session_count = 1 and p_duration_minutes = 90 then 210.00
    else null
  end;
$$;

create or replace function public.client_has_postpartum_member_rate(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where contract.client_id = p_client_id
      and assignment.service_type::text = 'POSTPARTUM'
      and assignment.status not in ('CANCELLED', 'COMPLETED')
      and (assignment.ends_at at time zone 'America/New_York')::date >= (now() at time zone 'America/New_York')::date
  ) or exists (
    select 1
    from public.client_service_requests request
    where request.client_id = p_client_id
      and request.service_type::text = 'POSTPARTUM'
      and request.status = 'APPROVED'
      and request.desired_start_date + (request.requested_weeks * 7 - 1) >= (now() at time zone 'America/New_York')::date
  );
$$;

create or replace function public.massage_slot_is_available(
  p_caregiver_id uuid,
  p_client_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_excluded_session_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_starts_at > now()
    and p_ends_at > p_starts_at
    and (p_starts_at at time zone 'America/New_York')::date = (p_ends_at at time zone 'America/New_York')::date
    and (p_starts_at at time zone 'America/New_York')::time >= time '09:00'
    and (p_ends_at at time zone 'America/New_York')::time <= time '20:00'
    and exists (
      select 1
      from public.caregiver_hr_profiles hr
      join public.caregivers caregiver on caregiver.id = hr.caregiver_id
      join public.profiles profile on profile.id = caregiver.user_id
      join public.massage_therapist_availability availability on availability.caregiver_id = caregiver.id
      where caregiver.id = p_caregiver_id
        and caregiver.status = 'ACTIVE'
        and profile.account_status = 'ACTIVE' and profile.deleted_at is null
        and hr.employment_status = 'ACTIVE' and hr.is_massage_therapist
        and availability.available_date = (p_starts_at at time zone 'America/New_York')::date
        and availability.start_time <= (p_starts_at at time zone 'America/New_York')::time
        and availability.end_time >= (p_ends_at at time zone 'America/New_York')::time
    )
    and not exists (
      select 1
      from public.care_assignments assignment
      join public.care_contracts contract on contract.id = assignment.contract_id
      where assignment.caregiver_id = p_caregiver_id
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and contract.client_id <> p_client_id
        and public.service_weekday_matches((p_starts_at at time zone 'America/New_York')::date, assignment.service_days)
        and tstzrange(
              ((p_starts_at at time zone 'America/New_York')::date + coalesce(assignment.daily_start_time, (assignment.starts_at at time zone 'America/New_York')::time)) at time zone 'America/New_York',
              ((p_starts_at at time zone 'America/New_York')::date + coalesce(assignment.daily_end_time, (assignment.ends_at at time zone 'America/New_York')::time)) at time zone 'America/New_York',
              '[)'
            ) && tstzrange(p_starts_at, p_ends_at, '[)')
        and (p_starts_at at time zone 'America/New_York')::date between
            (assignment.starts_at at time zone 'America/New_York')::date and
            (assignment.ends_at at time zone 'America/New_York')::date
    )
    and not exists (
      select 1
      from public.massage_booking_sessions booked
      where booked.caregiver_id = p_caregiver_id
        and booked.status in ('PENDING', 'CONFIRMED')
        and (p_excluded_session_id is null or booked.id <> p_excluded_session_id)
        and tstzrange(booked.starts_at - interval '1 hour', booked.ends_at + interval '1 hour', '[)')
            && tstzrange(p_starts_at, p_ends_at, '[)')
    );
$$;

create or replace function public.save_my_massage_availability(
  p_week_start date,
  p_weekdays integer[],
  p_start_time time,
  p_end_time time
)
returns setof public.massage_therapist_availability
language plpgsql
security definer
set search_path = public
as $$
declare
  target_caregiver_id uuid;
  target_date date;
begin
  select caregiver.id into target_caregiver_id
  from public.caregivers caregiver
  join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
  where caregiver.user_id = auth.uid() and caregiver.status = 'ACTIVE'
    and hr.employment_status = 'ACTIVE' and hr.is_massage_therapist;
  if target_caregiver_id is null then raise exception 'Active massage therapist access is required'; end if;
  if extract(isodow from p_week_start) <> 1 then raise exception 'Week start must be a Monday'; end if;
  if p_weekdays is null or cardinality(p_weekdays) = 0
     or exists (select 1 from unnest(p_weekdays) day_number where day_number not between 1 and 7) then
    raise exception 'At least one valid weekday is required';
  end if;
  if p_start_time < time '09:00' or p_end_time > time '20:00' or p_end_time <= p_start_time then
    raise exception 'Massage availability must be between 09:00 and 20:00';
  end if;

  for target_date in
    select p_week_start + (day_number - 1) from unnest(p_weekdays) day_number
  loop
    if target_date < (now() at time zone 'America/New_York')::date then
      raise exception 'Past availability cannot be registered';
    end if;
    delete from public.massage_therapist_availability
    where caregiver_id = target_caregiver_id and available_date = target_date;
    insert into public.massage_therapist_availability(
      caregiver_id, available_date, start_time, end_time, created_by
    ) values (
      target_caregiver_id, target_date, p_start_time, p_end_time, auth.uid()
    );
  end loop;

  return query
  select availability.*
  from public.massage_therapist_availability availability
  where availability.caregiver_id = target_caregiver_id
    and availability.available_date between p_week_start and p_week_start + 6
  order by availability.available_date, availability.start_time;
end;
$$;

create or replace function public.delete_my_massage_availability(p_availability_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.massage_therapist_availability availability
  using public.caregivers caregiver
  where availability.id = p_availability_id
    and caregiver.id = availability.caregiver_id
    and caregiver.user_id = auth.uid();
  if not found then raise exception 'Massage availability was not found'; end if;
end;
$$;

create or replace function public.available_massage_slots(
  p_duration_minutes integer,
  p_date_from date,
  p_date_to date
)
returns table (
  availability_id uuid,
  caregiver_id uuid,
  caregiver_user_id uuid,
  therapist_name text,
  slot_starts_at timestamptz,
  slot_ends_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
begin
  if p_duration_minutes not in (60, 90) then raise exception 'Unsupported massage duration'; end if;
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from or p_date_to > p_date_from + 62 then
    raise exception 'Massage slot search must cover 1 to 63 days';
  end if;
  select member.client_id into target_client_id
  from public.client_members member
  where member.user_id = auth.uid()
  order by member.is_primary desc, member.created_at
  limit 1;
  if target_client_id is null then raise exception 'Active client membership not found'; end if;

  return query
  select availability.id, caregiver.id, caregiver.user_id, profile.full_name,
    slot.local_start at time zone 'America/New_York',
    (slot.local_start + make_interval(mins => p_duration_minutes)) at time zone 'America/New_York'
  from public.massage_therapist_availability availability
  join public.caregivers caregiver on caregiver.id = availability.caregiver_id
  join public.profiles profile on profile.id = caregiver.user_id
  cross join lateral generate_series(
    availability.available_date + availability.start_time,
    availability.available_date + availability.end_time - make_interval(mins => p_duration_minutes),
    interval '30 minutes'
  ) slot(local_start)
  where availability.available_date between p_date_from and p_date_to
    and slot.local_start at time zone 'America/New_York' > now() + interval '24 hours'
    and public.massage_slot_is_available(
      caregiver.id, target_client_id,
      slot.local_start at time zone 'America/New_York',
      (slot.local_start + make_interval(mins => p_duration_minutes)) at time zone 'America/New_York',
      null
    )
  order by slot.local_start, profile.full_name;
end;
$$;

create or replace function public.submit_massage_service_request(
  p_duration_minutes integer,
  p_service_address text,
  p_special_notes text,
  p_slots jsonb,
  p_policy_accepted boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  created_request_id uuid;
  pricing_tier text;
  service_price numeric(10,2);
  selected_count integer;
  slot_row jsonb;
  availability_row public.massage_therapist_availability%rowtype;
  slot_start timestamptz;
  slot_end timestamptz;
  first_start timestamptz;
  last_end timestamptz;
  session_index integer := 0;
begin
  if p_policy_accepted is distinct from true then raise exception 'Massage booking policy must be accepted'; end if;
  if p_duration_minutes not in (60, 90) then raise exception 'Unsupported massage duration'; end if;
  if length(trim(coalesce(p_service_address, ''))) not between 5 and 500 then raise exception 'A valid service address is required'; end if;
  if jsonb_typeof(p_slots) <> 'array' then raise exception 'Massage slots must be an array'; end if;
  selected_count := jsonb_array_length(p_slots);
  if selected_count not in (1, 4) or (selected_count = 4 and p_duration_minutes <> 60) then
    raise exception 'Select one appointment or four 60-minute appointments';
  end if;

  select member.client_id into target_client_id
  from public.client_members member
  join public.profiles profile on profile.id = member.user_id
  join public.user_roles role on role.user_id = member.user_id and role.role = 'CLIENT'
  where member.user_id = auth.uid() and profile.account_status = 'ACTIVE' and profile.deleted_at is null
  order by member.is_primary desc, member.created_at limit 1;
  if target_client_id is null then raise exception 'Active client membership not found'; end if;

  pricing_tier := case when public.client_has_postpartum_member_rate(target_client_id) then 'POSTPARTUM_CLIENT' else 'GENERAL' end;
  if selected_count = 4 and pricing_tier <> 'POSTPARTUM_CLIENT' then
    raise exception 'The four-session package is available only to current or booked postpartum clients';
  end if;
  service_price := public.promoms_massage_price(pricing_tier, p_duration_minutes, selected_count);
  if service_price is null then raise exception 'Massage price could not be determined'; end if;

  select min((item->>'starts_at')::timestamptz), max((item->>'starts_at')::timestamptz + make_interval(mins => p_duration_minutes))
  into first_start, last_end from jsonb_array_elements(p_slots) item;
  if first_start <= now() + interval '24 hours' then raise exception 'Massage requests must be made more than 24 hours before the appointment'; end if;
  if (select count(distinct item->>'starts_at') from jsonb_array_elements(p_slots) item) <> selected_count then
    raise exception 'Duplicate massage slots are not allowed';
  end if;

  insert into public.client_service_requests (
    client_id, requested_by, baby_id, birth_or_due_date, requested_weeks,
    desired_start_date, daily_start_time, daily_end_time, service_address,
    household_extra_people, allergy_notes, special_notes, service_type,
    requested_days, request_kind, deposit_amount, deposit_status,
    sequence_policy_accepted, insured_staffing_acknowledged,
    massage_duration_minutes, massage_session_count, massage_pricing_tier,
    weekly_rate, estimated_total
  ) values (
    target_client_id, auth.uid(), null, null, selected_count,
    (first_start at time zone 'America/New_York')::date,
    (first_start at time zone 'America/New_York')::time,
    (first_start at time zone 'America/New_York')::time + make_interval(mins => p_duration_minutes),
    trim(p_service_address), 0, '없음', nullif(trim(p_special_notes), ''),
    'MASSAGE'::public.care_service_type,
    array[case extract(dow from first_start at time zone 'America/New_York')
      when 0 then '일' when 1 then '월' when 2 then '화' when 3 then '수'
      when 4 then '목' when 5 then '금' else '토' end],
    'NEW', service_price, 'DUE_ON_APPROVAL', true, true,
    p_duration_minutes, selected_count, pricing_tier, null, service_price
  ) returning id into created_request_id;

  for slot_row in select value from jsonb_array_elements(p_slots) loop
    session_index := session_index + 1;
    select * into availability_row
    from public.massage_therapist_availability
    where id = (slot_row->>'availability_id')::uuid
    for update;
    if not found then raise exception 'Selected therapist availability no longer exists'; end if;
    slot_start := (slot_row->>'starts_at')::timestamptz;
    slot_end := slot_start + make_interval(mins => p_duration_minutes);
    if date_trunc('minute', slot_start) <> slot_start
       or extract(minute from slot_start at time zone 'America/New_York') not in (0, 30) then
      raise exception 'Massage appointments must start on a 30-minute boundary';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('massage-slot:' || availability_row.caregiver_id::text || ':' || slot_start::text, 0));
    if availability_row.available_date <> (slot_start at time zone 'America/New_York')::date
       or availability_row.start_time > (slot_start at time zone 'America/New_York')::time
       or availability_row.end_time < (slot_end at time zone 'America/New_York')::time
       or not public.massage_slot_is_available(availability_row.caregiver_id, target_client_id, slot_start, slot_end, null) then
      raise exception 'One or more selected massage slots are no longer available';
    end if;
    insert into public.massage_booking_sessions(
      client_service_request_id, client_id, caregiver_id, session_number, starts_at, ends_at
    ) values (
      created_request_id, target_client_id, availability_row.caregiver_id, session_index, slot_start, slot_end
    );
  end loop;

  return created_request_id;
end;
$$;

create or replace function public.enforce_deposit_transaction_target()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  request_client_id uuid;
  request_service_type text;
  request_deposit numeric(10,2);
  required_deposit numeric(10,2);
begin
  select request.client_id, request.service_type::text, request.deposit_amount
  into request_client_id, request_service_type, request_deposit
  from public.client_service_requests request
  where request.id = new.client_service_request_id;

  if request_client_id is null or request_client_id <> new.client_id then
    raise exception 'Deposit transaction client does not match the service request';
  end if;

  required_deposit := case request_service_type
    when 'POSTPARTUM' then 500.00
    when 'BABYSITTING' then 128.00
    when 'MASSAGE' then request_deposit
    else null
  end;

  if required_deposit is null or new.amount <> required_deposit or new.currency <> 'USD' then
    raise exception 'Deposit transaction amount or currency does not match the service policy';
  end if;

  new.payment_method := upper(trim(new.payment_method));
  new.external_reference := trim(new.external_reference);
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_assignment_service_sequence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_client_id uuid;
  target_baby_id uuid;
begin
  if new.status in ('CANCELLED', 'COMPLETED') or new.service_type::text = 'MASSAGE' then
    return new;
  end if;

  select contract.client_id, contract.baby_id
  into target_client_id, target_baby_id
  from public.care_contracts contract
  where contract.id = new.contract_id;

  if target_client_id is null then raise exception 'Assignment contract not found'; end if;

  if exists (
    select 1
    from public.care_assignments existing_assignment
    join public.care_contracts existing_contract on existing_contract.id = existing_assignment.contract_id
    where existing_assignment.id <> new.id
      and existing_assignment.status not in ('CANCELLED', 'COMPLETED')
      and existing_assignment.service_type::text <> 'MASSAGE'
      and existing_contract.client_id = target_client_id
      and (target_baby_id is null or existing_contract.baby_id is null or existing_contract.baby_id = target_baby_id)
      and tstzrange(existing_assignment.starts_at, existing_assignment.ends_at, '[]')
          && tstzrange(new.starts_at, new.ends_at, '[]')
  ) then
    raise exception 'The selected baby already has a service assignment during this period';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_request_service_sequence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  request_end_date date;
begin
  if new.status in ('REJECTED', 'CANCELLED') then return new; end if;
  if new.service_type::text = 'MASSAGE' then return new; end if;

  request_end_date := new.desired_start_date + (new.requested_weeks * 7 - 1);

  if new.service_type::text = 'BABYSITTING'
     and (tg_op = 'INSERT' or old.service_type is distinct from new.service_type)
     and exists (
       select 1 from public.care_assignments postpartum_assignment
       join public.care_contracts postpartum_contract on postpartum_contract.id = postpartum_assignment.contract_id
       where postpartum_assignment.status not in ('CANCELLED', 'COMPLETED')
         and postpartum_assignment.service_type::text = 'POSTPARTUM'
         and postpartum_contract.client_id = new.client_id
         and (new.baby_id is null or postpartum_contract.baby_id is null or postpartum_contract.baby_id = new.baby_id)
         and now() between postpartum_assignment.starts_at and postpartum_assignment.ends_at
     ) then
    raise exception 'The selected baby cannot begin babysitting while postpartum care is active';
  end if;

  if exists (
    select 1 from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.status not in ('CANCELLED', 'COMPLETED')
      and assignment.service_type::text <> 'MASSAGE'
      and (new.approved_assignment_id is null or assignment.id <> new.approved_assignment_id)
      and contract.client_id = new.client_id
      and (new.baby_id is null or contract.baby_id is null or contract.baby_id = new.baby_id)
      and daterange((assignment.starts_at at time zone 'America/New_York')::date,
                    (assignment.ends_at at time zone 'America/New_York')::date, '[]')
          && daterange(new.desired_start_date, request_end_date, '[]')
  ) then
    raise exception 'The requested period overlaps another service for the selected baby';
  end if;

  if exists (
    select 1 from public.client_service_requests existing_request
    where existing_request.id <> new.id
      and existing_request.client_id = new.client_id
      and existing_request.status in ('PENDING', 'APPROVED')
      and existing_request.approved_assignment_id is null
      and existing_request.service_type::text <> 'MASSAGE'
      and (new.baby_id is null or existing_request.baby_id is null or existing_request.baby_id = new.baby_id)
      and daterange(existing_request.desired_start_date,
                    existing_request.desired_start_date + (existing_request.requested_weeks * 7 - 1), '[]')
          && daterange(new.desired_start_date, request_end_date, '[]')
  ) then
    raise exception 'The requested period overlaps another pending request for the selected baby';
  end if;

  if new.service_type::text = 'POSTPARTUM' then
    new.postpartum_mode := coalesce(new.postpartum_mode, 'COMMUTE');
    if new.postpartum_mode = 'LIVE_IN' then
      if new.requested_weeks <> 4 then raise exception 'Live-in postpartum care starts with a four-week contract'; end if;
      new.weekly_rate := 2100.00;
    else
      new.weekly_rate := 1800.00;
    end if;
    new.estimated_total := new.weekly_rate * new.requested_weeks;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_massage_therapist_capability(
  p_user_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_caregiver_id uuid;
begin
  if not public.is_admin() then raise exception 'Only administrators can configure massage therapists'; end if;
  if p_enabled is null then raise exception 'An explicit capability value is required'; end if;

  select caregiver.id into target_caregiver_id
  from public.caregivers caregiver
  join public.user_roles role on role.user_id = caregiver.user_id and role.role = 'CAREGIVER'
  where caregiver.user_id = p_user_id and caregiver.status = 'ACTIVE';

  if target_caregiver_id is null then
    if p_enabled then raise exception 'Caregiver access must be granted before massage therapist capability'; end if;
    return;
  end if;

  insert into public.caregiver_hr_profiles (
    caregiver_id, employment_status, is_massage_therapist, updated_by
  ) values (
    target_caregiver_id, 'ACTIVE', p_enabled, auth.uid()
  )
  on conflict (caregiver_id) do update set
    is_massage_therapist = excluded.is_massage_therapist,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'SET_MASSAGE_THERAPIST_CAPABILITY', 'caregiver_hr_profiles', target_caregiver_id,
    jsonb_build_object('user_id', p_user_id, 'enabled', p_enabled));
end;
$$;

create or replace function public.submit_promoms_service_request(
  p_service_type text,
  p_baby_id uuid,
  p_baby_name text,
  p_birth_or_due_date date,
  p_requested_weeks integer,
  p_desired_start_date date,
  p_daily_start_time time,
  p_daily_end_time time,
  p_requested_days text[],
  p_service_address text,
  p_household_extra_people integer,
  p_allergy_notes text,
  p_special_notes text default null,
  p_maternal_notes text default null,
  p_meal_instructions text default null,
  p_routine_notes text default null,
  p_pickup_notes text default null,
  p_request_kind text default 'NEW',
  p_sequence_policy_accepted boolean default false,
  p_insured_staffing_acknowledged boolean default false,
  p_postpartum_mode text default null,
  p_massage_duration_minutes integer default null,
  p_massage_session_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  created_request_id uuid;
  normalized_days text[];
  pricing_tier text;
  service_price numeric(10,2);
begin
  if p_service_type is null or p_service_type not in ('POSTPARTUM', 'BABYSITTING') then
    raise exception 'Massage requests must use therapist availability slots';
  end if;
  if p_sequence_policy_accepted is distinct from true or p_insured_staffing_acknowledged is distinct from true then
    raise exception 'Service terms must be accepted';
  end if;
  if length(trim(coalesce(p_service_address, ''))) not between 5 and 500 then raise exception 'A valid service address is required'; end if;
  if p_daily_end_time <= p_daily_start_time then raise exception 'Service end time must be after start time'; end if;

  select member.client_id into target_client_id
  from public.client_members member
  join public.profiles profile on profile.id = member.user_id
  join public.user_roles role on role.user_id = member.user_id and role.role = 'CLIENT'
  where member.user_id = auth.uid()
    and profile.account_status = 'ACTIVE' and profile.deleted_at is null
  order by member.is_primary desc, member.created_at
  limit 1;
  if target_client_id is null then raise exception 'Active client membership not found'; end if;

  if p_service_type <> 'MASSAGE' then
    if p_baby_id is not null and not exists (
      select 1 from public.babies where id = p_baby_id and client_id = target_client_id
    ) then raise exception 'Selected baby does not belong to this client'; end if;
    if length(trim(coalesce(p_baby_name, ''))) < 1 or p_birth_or_due_date is null then raise exception 'Baby information is required'; end if;
    if p_service_type = 'POSTPARTUM' then
      if coalesce(p_postpartum_mode, 'COMMUTE') = 'LIVE_IN' and p_requested_weeks <> 4 then
        raise exception 'Live-in postpartum care starts with a four-week contract';
      end if;
      if coalesce(p_postpartum_mode, 'COMMUTE') not in ('COMMUTE', 'LIVE_IN') then raise exception 'Unsupported postpartum care mode'; end if;
    end if;

    created_request_id := public.submit_client_service_request(
      p_service_type::public.care_service_type, trim(p_baby_name), p_birth_or_due_date,
      p_requested_weeks, p_desired_start_date, p_daily_start_time, p_daily_end_time,
      p_requested_days, trim(p_service_address), p_household_extra_people,
      p_allergy_notes, p_special_notes, p_maternal_notes, p_meal_instructions,
      p_routine_notes, p_pickup_notes, p_request_kind
    );
    update public.client_service_requests
    set postpartum_mode = case when p_service_type = 'POSTPARTUM' then coalesce(p_postpartum_mode, 'COMMUTE') else null end,
        sequence_policy_accepted = p_sequence_policy_accepted,
        insured_staffing_acknowledged = p_insured_staffing_acknowledged,
        updated_at = now()
    where id = created_request_id;
    return created_request_id;
  end if;

  if p_desired_start_date + p_daily_start_time <= (now() at time zone 'America/New_York') + interval '24 hours' then
    raise exception 'Massage requests must be made more than 24 hours before the appointment';
  end if;
  if p_massage_duration_minutes not in (60, 90) or p_massage_session_count not in (1, 4) then
    raise exception 'Unsupported massage product';
  end if;
  pricing_tier := case when public.client_has_postpartum_member_rate(target_client_id) then 'POSTPARTUM_CLIENT' else 'GENERAL' end;
  if p_massage_session_count = 4 and (pricing_tier <> 'POSTPARTUM_CLIENT' or p_massage_duration_minutes <> 60) then
    raise exception 'The four-session package is available only to postpartum clients as 60-minute sessions';
  end if;
  service_price := public.promoms_massage_price(pricing_tier, p_massage_duration_minutes, p_massage_session_count);
  if service_price is null then raise exception 'Massage price could not be determined'; end if;
  normalized_days := coalesce(p_requested_days, array[case extract(dow from p_desired_start_date)
    when 0 then '일' when 1 then '월' when 2 then '화' when 3 then '수'
    when 4 then '목' when 5 then '금' else '토' end]);

  insert into public.client_service_requests (
    client_id, requested_by, baby_id, birth_or_due_date, requested_weeks,
    desired_start_date, daily_start_time, daily_end_time, service_address,
    household_extra_people, allergy_notes, special_notes, service_type,
    requested_days, request_kind, deposit_amount, deposit_status,
    sequence_policy_accepted, insured_staffing_acknowledged,
    massage_duration_minutes, massage_session_count, massage_pricing_tier,
    weekly_rate, estimated_total
  ) values (
    target_client_id, auth.uid(), null, null, p_massage_session_count,
    p_desired_start_date, p_daily_start_time, p_daily_end_time, trim(p_service_address),
    0, '없음', nullif(trim(p_special_notes), ''), 'MASSAGE'::public.care_service_type,
    normalized_days, 'NEW', service_price, 'DUE_ON_APPROVAL',
    true, true, p_massage_duration_minutes, p_massage_session_count, pricing_tier,
    null, service_price
  ) returning id into created_request_id;
  return created_request_id;
end;
$$;

create or replace function public.review_promoms_service_request(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text default null,
  p_payment_method text default null,
  p_payment_reference text default null,
  p_received_on date default null
)
returns public.client_service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  effective_at timestamptz;
  payment_method text := upper(trim(coalesce(p_payment_method, '')));
  payment_reference text := trim(coalesce(p_payment_reference, ''));
  latest_tier text;
  latest_price numeric(10,2);
  session_row public.massage_booking_sessions%rowtype;
begin
  if not public.is_admin() then raise exception 'Only administrators can review service requests'; end if;
  select * into request_row from public.client_service_requests where id = p_request_id for update;
  if not found then raise exception 'Service request not found'; end if;
  if request_row.service_type::text <> 'MASSAGE' then
    return public.review_service_request_with_dated_deposit(
      p_request_id, p_approve, p_review_note, p_payment_method, p_payment_reference, p_received_on
    );
  end if;
  if request_row.status <> 'PENDING' then raise exception 'Massage request has already been reviewed'; end if;

  if not p_approve then
    update public.client_service_requests set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(trim(p_review_note), ''), updated_at = now()
    where id = p_request_id returning * into request_row;
    update public.massage_booking_sessions set status = 'CANCELLED', cancelled_by = auth.uid(),
      cancelled_at = now(), cancellation_reason = coalesce(nullif(trim(p_review_note), ''), '관리자 신청 반려'), updated_at = now()
    where client_service_request_id = p_request_id and status = 'PENDING';
    return request_row;
  end if;

  if payment_method = '' or length(payment_reference) < 3 then raise exception 'Payment evidence is required for approval'; end if;
  effective_at := public.payment_effective_timestamp(p_received_on);
  latest_tier := case when public.client_has_postpartum_member_rate(request_row.client_id) then 'POSTPARTUM_CLIENT' else 'GENERAL' end;
  latest_price := public.promoms_massage_price(latest_tier, request_row.massage_duration_minutes, request_row.massage_session_count);
  if latest_price is null then raise exception 'Massage price could not be verified'; end if;
  if (select count(*) from public.massage_booking_sessions where client_service_request_id = p_request_id and status = 'PENDING')
     <> request_row.massage_session_count then
    raise exception 'The selected massage appointments are incomplete';
  end if;
  for session_row in
    select * from public.massage_booking_sessions
    where client_service_request_id = p_request_id and status = 'PENDING'
    order by starts_at for update
  loop
    if session_row.starts_at <= now() then
      raise exception 'One or more selected massage appointments have already started';
    end if;
    if not public.massage_slot_is_available(
      session_row.caregiver_id, session_row.client_id, session_row.starts_at, session_row.ends_at, session_row.id
    ) then raise exception 'One or more selected massage slots are no longer available'; end if;
  end loop;

  update public.client_service_requests set
    massage_pricing_tier = latest_tier, estimated_total = latest_price, deposit_amount = latest_price,
    deposit_status = 'PAID', deposit_paid_at = effective_at,
    status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = nullif(trim(p_review_note), ''), updated_at = now()
  where id = p_request_id returning * into request_row;

  insert into public.deposit_transactions (
    client_service_request_id, client_id, amount, currency, status,
    payment_method, external_reference, idempotency_key, recorded_by, captured_at
  ) values (
    request_row.id, request_row.client_id, latest_price, 'USD', 'CAPTURED',
    payment_method, payment_reference, 'massage-approval:' || request_row.id::text,
    auth.uid(), effective_at
  );
  update public.massage_booking_sessions set status = 'CONFIRMED', confirmed_by = auth.uid(),
    confirmed_at = now(), updated_at = now()
  where client_service_request_id = p_request_id and status = 'PENDING';
  update public.clients set status = 'ACTIVE', updated_at = now() where id = request_row.client_id;
  return request_row;
end;
$$;

create or replace function public.massage_therapist_schedule_is_available(
  p_caregiver_id uuid,
  p_client_id uuid,
  p_start_date date,
  p_end_date date,
  p_daily_start_time time,
  p_daily_end_time time,
  p_service_days text[],
  p_excluded_assignment_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.care_assignments existing_assignment
    join public.care_contracts existing_contract on existing_contract.id = existing_assignment.contract_id
    where existing_assignment.caregiver_id = p_caregiver_id
      and existing_assignment.status in ('PROPOSED', 'CONFIRMED')
      and (p_excluded_assignment_id is null or existing_assignment.id <> p_excluded_assignment_id)
      and (existing_contract.client_id <> p_client_id or existing_assignment.service_type::text = 'MASSAGE')
      and daterange((existing_assignment.starts_at at time zone 'America/New_York')::date,
                    (existing_assignment.ends_at at time zone 'America/New_York')::date, '[]')
          && daterange(p_start_date, p_end_date, '[]')
      and coalesce(existing_assignment.daily_start_time,
                   (existing_assignment.starts_at at time zone 'America/New_York')::time) < p_daily_end_time
      and p_daily_start_time < coalesce(existing_assignment.daily_end_time,
                                        (existing_assignment.ends_at at time zone 'America/New_York')::time)
      and exists (
        select 1 from generate_series(
          greatest(p_start_date, (existing_assignment.starts_at at time zone 'America/New_York')::date)::timestamp,
          least(p_end_date, (existing_assignment.ends_at at time zone 'America/New_York')::date)::timestamp,
          interval '1 day'
        ) overlap_day
        where public.service_weekday_matches(overlap_day::date, p_service_days)
          and public.service_weekday_matches(overlap_day::date, existing_assignment.service_days)
      )
  );
$$;

create or replace function public.schedule_promoms_service_request(
  p_request_id uuid,
  p_caregiver_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  created_contract_id uuid;
  created_assignment_id uuid;
  requested_end_date date;
  requested_start timestamptz;
  requested_end timestamptz;
begin
  if not public.is_care_staff() then raise exception 'Only authorized care staff can schedule requests'; end if;
  select * into request_row from public.client_service_requests
  where id = p_request_id and status = 'APPROVED' and approved_assignment_id is null for update;
  if not found then raise exception 'Approved unscheduled request not found'; end if;
  if request_row.service_type::text = 'MASSAGE' then
    raise exception 'Massage appointments are confirmed from the customer-selected session slots';
  end if;
  if request_row.service_type::text <> 'MASSAGE' then
    created_assignment_id := public.schedule_approved_client_request(p_request_id, p_caregiver_id);
    update public.care_assignments
    set postpartum_mode = case when request_row.service_type::text = 'POSTPARTUM' then coalesce(request_row.postpartum_mode, 'COMMUTE') else null end,
        updated_at = now(), updated_by = auth.uid()
    where id = created_assignment_id;
    return created_assignment_id;
  end if;

  if not exists (
    select 1 from public.caregivers caregiver
    join public.profiles profile on profile.id = caregiver.user_id
    join public.user_roles role on role.user_id = caregiver.user_id and role.role = 'CAREGIVER'
    join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
    where caregiver.id = p_caregiver_id and caregiver.status = 'ACTIVE'
      and profile.account_status = 'ACTIVE' and profile.deleted_at is null
      and hr.employment_status = 'ACTIVE' and hr.is_massage_therapist
  ) then raise exception 'Selected caregiver is not an active massage therapist'; end if;
  if request_row.deposit_status <> 'PAID' or request_row.deposit_paid_at is null
     or not exists (
       select 1 from public.deposit_transactions deposit
       where deposit.client_service_request_id = request_row.id and deposit.status = 'CAPTURED'
         and deposit.amount = request_row.deposit_amount and deposit.captured_at is not null
     ) then raise exception 'Captured massage payment evidence is required before scheduling'; end if;

  requested_end_date := request_row.desired_start_date
    + case when request_row.massage_session_count = 4 then 21 else 0 end;
  requested_start := (request_row.desired_start_date + request_row.daily_start_time) at time zone 'America/New_York';
  requested_end := (requested_end_date + request_row.daily_end_time) at time zone 'America/New_York';

  if not public.massage_therapist_schedule_is_available(
    p_caregiver_id, request_row.client_id, request_row.desired_start_date, requested_end_date,
    request_row.daily_start_time, request_row.daily_end_time, request_row.requested_days, null
  ) then raise exception 'The massage therapist has an overlapping caregiving or massage booking'; end if;

  insert into public.care_contracts (
    client_id, baby_id, start_date, end_date, agreed_rate, status, created_by
  ) values (
    request_row.client_id, null, request_row.desired_start_date, requested_end_date,
    request_row.estimated_total, 'ACTIVE', auth.uid()
  ) returning id into created_contract_id;

  insert into public.care_assignments (
    contract_id, caregiver_id, starts_at, ends_at, status, assigned_by,
    service_address, daily_start_time, daily_end_time, household_extra_people,
    allergy_notes, client_request_note, contract_weeks, service_type, service_days,
    weekly_rate, contract_value, deposit_amount, deposit_status, deposit_paid_at, updated_by,
    postpartum_mode, massage_duration_minutes, massage_session_count, massage_pricing_tier,
    massage_linked_postpartum_assignment_id
  ) values (
    created_contract_id, p_caregiver_id, requested_start, requested_end, 'CONFIRMED', auth.uid(),
    request_row.service_address, request_row.daily_start_time, request_row.daily_end_time, 0,
    '없음', request_row.special_notes, request_row.massage_session_count,
    request_row.service_type, request_row.requested_days, null, request_row.estimated_total,
    request_row.deposit_amount, request_row.deposit_status, request_row.deposit_paid_at, auth.uid(),
    null, request_row.massage_duration_minutes, request_row.massage_session_count,
    request_row.massage_pricing_tier, request_row.massage_linked_postpartum_assignment_id
  ) returning id into created_assignment_id;

  update public.client_service_requests set approved_assignment_id = created_assignment_id, updated_at = now()
  where id = request_row.id;
  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'SCHEDULE_MASSAGE_SERVICE', 'care_assignments', created_assignment_id,
    jsonb_build_object('request_id', request_row.id, 'caregiver_id', p_caregiver_id));
  return created_assignment_id;
end;
$$;

create or replace function public.submit_massage_adjustment(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text,
  p_proposed_start_date date default null,
  p_proposed_daily_start_time time default null,
  p_proposed_daily_end_time time default null,
  p_proposed_weeks integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  target_service_type text;
  target_start timestamptz;
  target_duration integer;
  target_sessions integer;
  created_id uuid;
begin
  if p_target_type = 'ASSIGNMENT' then
    select contract.client_id, assignment.service_type::text, assignment.starts_at,
           assignment.massage_duration_minutes, assignment.massage_session_count
    into target_client_id, target_service_type, target_start, target_duration, target_sessions
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.id = p_target_id and assignment.status not in ('CANCELLED', 'COMPLETED');
  elsif p_target_type = 'REQUEST' then
    select request.client_id, request.service_type::text,
           (request.desired_start_date + request.daily_start_time) at time zone 'America/New_York',
           request.massage_duration_minutes, request.massage_session_count
    into target_client_id, target_service_type, target_start, target_duration, target_sessions
    from public.client_service_requests request
    where request.id = p_target_id and request.status in ('PENDING', 'APPROVED') and request.approved_assignment_id is null;
  else
    raise exception 'Unsupported adjustment target';
  end if;
  if target_client_id is null or target_service_type <> 'MASSAGE' then raise exception 'Active massage service not found'; end if;
  if not public.is_client_member(target_client_id) then raise exception 'You cannot change this massage service'; end if;
  if target_start <= now() + interval '24 hours' then raise exception 'Massage changes and cancellations close 24 hours before the appointment'; end if;
  if p_action not in ('CHANGE', 'CANCEL') or length(trim(coalesce(p_reason, ''))) < 1 then raise exception 'Action and reason are required'; end if;
  if p_action = 'CHANGE' then
    if p_proposed_start_date is null or p_proposed_daily_start_time is null or p_proposed_daily_end_time is null then
      raise exception 'The requested new massage schedule is incomplete';
    end if;
    if p_proposed_daily_end_time - p_proposed_daily_start_time <> make_interval(mins => target_duration) then
      raise exception 'The massage duration cannot be changed in a schedule-change request';
    end if;
    if (p_proposed_start_date + p_proposed_daily_start_time) at time zone 'America/New_York' <= now() then
      raise exception 'The new massage appointment must be in the future';
    end if;
  end if;

  insert into public.service_adjustment_requests (
    client_id, requested_by, service_type, client_service_request_id, care_assignment_id,
    action, proposed_start_date, proposed_daily_start_time, proposed_daily_end_time,
    proposed_weeks, reason, policy_code, policy_snapshot
  ) values (
    target_client_id, auth.uid(), 'MASSAGE'::public.care_service_type,
    case when p_target_type = 'REQUEST' then p_target_id else null end,
    case when p_target_type = 'ASSIGNMENT' then p_target_id else null end,
    p_action,
    case when p_action = 'CHANGE' then p_proposed_start_date else null end,
    case when p_action = 'CHANGE' then p_proposed_daily_start_time else null end,
    case when p_action = 'CHANGE' then p_proposed_daily_end_time else null end,
    case when p_action = 'CHANGE' then target_sessions else null end,
    trim(p_reason), 'MASSAGE_STANDARD_24H',
    jsonb_build_object('title', '24시간 이전 요청 가능',
      'detail', '마사지 시작 24시간 이전에 접수된 변경·취소 요청입니다.',
      'cutoff_hours', 24, 'original_start', target_start)
  ) returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.review_massage_adjustment(
  p_adjustment_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns public.service_adjustment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  adjustment_row public.service_adjustment_requests%rowtype;
  request_row public.client_service_requests%rowtype;
  assignment_row public.care_assignments%rowtype;
  contract_row public.care_contracts%rowtype;
  new_end_date date;
  new_start timestamptz;
  new_end timestamptz;
  new_days text[];
begin
  if not public.is_admin() then raise exception 'Only administrators can review massage changes'; end if;
  select * into adjustment_row from public.service_adjustment_requests
  where id = p_adjustment_id and status = 'PENDING' and service_type::text = 'MASSAGE' for update;
  if not found then raise exception 'Pending massage adjustment not found'; end if;

  if not p_approve then
    update public.service_adjustment_requests set status = 'REJECTED', reviewed_by = auth.uid(),
      reviewed_at = now(), review_note = nullif(trim(p_review_note), ''), updated_at = now()
    where id = adjustment_row.id returning * into adjustment_row;
    return adjustment_row;
  end if;

  if adjustment_row.client_service_request_id is not null then
    select * into request_row from public.client_service_requests
    where id = adjustment_row.client_service_request_id for update;
  else
    select * into assignment_row from public.care_assignments
    where id = adjustment_row.care_assignment_id for update;
    select * into contract_row from public.care_contracts where id = assignment_row.contract_id for update;
    select * into request_row from public.client_service_requests
    where approved_assignment_id = assignment_row.id for update;
  end if;

  if adjustment_row.action = 'CANCEL' then
    if adjustment_row.client_service_request_id is not null then
      update public.client_service_requests set status = 'CANCELLED', deposit_status = 'REFUND_DUE',
        review_note = adjustment_row.reason, updated_at = now()
      where id = request_row.id;
    else
      update public.care_assignments set status = 'CANCELLED', cancelled_at = now(),
        cancelled_by = auth.uid(), cancellation_reason = adjustment_row.reason,
        updated_at = now(), updated_by = auth.uid()
      where id = assignment_row.id;
      update public.care_contracts set status = 'CANCELLED', updated_at = now() where id = contract_row.id;
      update public.client_service_requests set status = 'CANCELLED', deposit_status = 'REFUND_DUE',
        review_note = adjustment_row.reason, updated_at = now()
      where approved_assignment_id = assignment_row.id;
    end if;
  else
    new_end_date := adjustment_row.proposed_start_date
      + case when coalesce(request_row.massage_session_count, assignment_row.massage_session_count) = 4 then 21 else 0 end;
    new_start := (adjustment_row.proposed_start_date + adjustment_row.proposed_daily_start_time) at time zone 'America/New_York';
    new_end := (new_end_date + adjustment_row.proposed_daily_end_time) at time zone 'America/New_York';
    new_days := array[case extract(dow from adjustment_row.proposed_start_date)
      when 0 then '일' when 1 then '월' when 2 then '화' when 3 then '수'
      when 4 then '목' when 5 then '금' else '토' end];

    if adjustment_row.care_assignment_id is not null and not public.massage_therapist_schedule_is_available(
      assignment_row.caregiver_id, contract_row.client_id, adjustment_row.proposed_start_date,
      new_end_date, adjustment_row.proposed_daily_start_time, adjustment_row.proposed_daily_end_time,
      new_days, assignment_row.id
    ) then raise exception 'The assigned massage therapist is not available for the changed schedule'; end if;

    if adjustment_row.client_service_request_id is not null then
      update public.client_service_requests set desired_start_date = adjustment_row.proposed_start_date,
        daily_start_time = adjustment_row.proposed_daily_start_time,
        daily_end_time = adjustment_row.proposed_daily_end_time, requested_days = new_days, updated_at = now()
      where id = request_row.id;
    else
      update public.care_assignments set starts_at = new_start, ends_at = new_end,
        daily_start_time = adjustment_row.proposed_daily_start_time,
        daily_end_time = adjustment_row.proposed_daily_end_time, service_days = new_days,
        updated_at = now(), updated_by = auth.uid()
      where id = assignment_row.id;
      update public.care_contracts set start_date = adjustment_row.proposed_start_date,
        end_date = new_end_date, updated_at = now() where id = contract_row.id;
      update public.client_service_requests set desired_start_date = adjustment_row.proposed_start_date,
        daily_start_time = adjustment_row.proposed_daily_start_time,
        daily_end_time = adjustment_row.proposed_daily_end_time, requested_days = new_days, updated_at = now()
      where approved_assignment_id = assignment_row.id;
    end if;
  end if;

  update public.service_adjustment_requests set status = 'APPROVED', reviewed_by = auth.uid(),
    reviewed_at = now(), review_note = nullif(trim(p_review_note), ''), updated_at = now()
  where id = adjustment_row.id returning * into adjustment_row;
  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'REVIEW_MASSAGE_ADJUSTMENT', 'service_adjustment_requests', adjustment_row.id,
    jsonb_build_object('approved', true, 'action', adjustment_row.action));
  return adjustment_row;
end;
$$;

create or replace function public.submit_massage_booking_change(
  p_session_id uuid,
  p_action text,
  p_reason text,
  p_availability_id uuid default null,
  p_starts_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.massage_booking_sessions%rowtype;
  availability_row public.massage_therapist_availability%rowtype;
  duration_minutes integer;
  proposed_end timestamptz;
  created_change_id uuid;
begin
  select * into session_row from public.massage_booking_sessions
  where id = p_session_id and status in ('PENDING', 'CONFIRMED') for update;
  if not found or not public.is_client_member(session_row.client_id) then
    raise exception 'Massage appointment was not found';
  end if;
  if session_row.starts_at <= now() + interval '24 hours' then
    raise exception 'Massage changes and cancellations close 24 hours before the appointment';
  end if;
  if p_action not in ('CHANGE', 'CANCEL') or length(trim(coalesce(p_reason, ''))) < 1 then
    raise exception 'Action and reason are required';
  end if;
  if exists (
    select 1 from public.massage_booking_changes change_request
    where change_request.massage_booking_session_id = p_session_id and change_request.status = 'PENDING'
  ) then raise exception 'This appointment already has a pending change request'; end if;

  if p_action = 'CHANGE' then
    if p_availability_id is null or p_starts_at is null or p_starts_at <= now() + interval '24 hours' then
      raise exception 'Select an available appointment more than 24 hours ahead';
    end if;
    select * into availability_row from public.massage_therapist_availability
    where id = p_availability_id for update;
    if not found then raise exception 'Selected therapist availability no longer exists'; end if;
    duration_minutes := round(extract(epoch from (session_row.ends_at - session_row.starts_at)) / 60);
    proposed_end := p_starts_at + make_interval(mins => duration_minutes);
    if date_trunc('minute', p_starts_at) <> p_starts_at
       or extract(minute from p_starts_at at time zone 'America/New_York') not in (0, 30) then
      raise exception 'Massage appointments must start on a 30-minute boundary';
    end if;
    if availability_row.available_date <> (p_starts_at at time zone 'America/New_York')::date
       or availability_row.start_time > (p_starts_at at time zone 'America/New_York')::time
       or availability_row.end_time < (proposed_end at time zone 'America/New_York')::time
       or not public.massage_slot_is_available(
         availability_row.caregiver_id, session_row.client_id, p_starts_at, proposed_end, session_row.id
       ) then raise exception 'Selected massage slot is no longer available'; end if;
  end if;

  insert into public.massage_booking_changes(
    massage_booking_session_id, requested_by, action, proposed_caregiver_id,
    proposed_starts_at, proposed_ends_at, reason
  ) values (
    session_row.id, auth.uid(), p_action,
    case when p_action = 'CHANGE' then availability_row.caregiver_id else null end,
    case when p_action = 'CHANGE' then p_starts_at else null end,
    case when p_action = 'CHANGE' then proposed_end else null end,
    trim(p_reason)
  ) returning id into created_change_id;
  return created_change_id;
end;
$$;

create or replace function public.review_massage_booking_change(
  p_change_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns public.massage_booking_changes
language plpgsql
security definer
set search_path = public
as $$
declare
  change_row public.massage_booking_changes%rowtype;
  session_row public.massage_booking_sessions%rowtype;
  active_session_count integer;
begin
  if not public.is_admin() then raise exception 'Only administrators can review massage changes'; end if;
  select * into change_row from public.massage_booking_changes
  where id = p_change_id and status = 'PENDING' for update;
  if not found then raise exception 'Pending massage change was not found'; end if;
  select * into session_row from public.massage_booking_sessions
  where id = change_row.massage_booking_session_id for update;
  if not found or session_row.status not in ('PENDING', 'CONFIRMED') then
    raise exception 'Active massage appointment was not found';
  end if;

  if not p_approve then
    update public.massage_booking_changes set status = 'REJECTED', reviewed_by = auth.uid(),
      reviewed_at = now(), review_note = nullif(trim(p_review_note), ''), updated_at = now()
    where id = change_row.id returning * into change_row;
    return change_row;
  end if;

  if change_row.action = 'CHANGE' then
    if change_row.proposed_starts_at <= now() + interval '24 hours'
       or not public.massage_slot_is_available(
         change_row.proposed_caregiver_id, session_row.client_id,
         change_row.proposed_starts_at, change_row.proposed_ends_at, session_row.id
       ) then raise exception 'The requested massage slot is no longer available'; end if;
    update public.massage_booking_sessions set caregiver_id = change_row.proposed_caregiver_id,
      starts_at = change_row.proposed_starts_at, ends_at = change_row.proposed_ends_at,
      updated_at = now()
    where id = session_row.id;
  else
    update public.massage_booking_sessions set status = 'CANCELLED', cancelled_by = auth.uid(),
      cancelled_at = now(), cancellation_reason = change_row.reason, updated_at = now()
    where id = session_row.id;
    select count(*) into active_session_count from public.massage_booking_sessions
    where client_service_request_id = session_row.client_service_request_id and status in ('PENDING', 'CONFIRMED');
    if active_session_count = 0 then
      update public.client_service_requests set status = 'CANCELLED', deposit_status = 'REFUND_DUE',
        review_note = change_row.reason, updated_at = now()
      where id = session_row.client_service_request_id;
    end if;
  end if;

  update public.massage_booking_changes set status = 'APPROVED', reviewed_by = auth.uid(),
    reviewed_at = now(), review_note = nullif(trim(p_review_note), ''), updated_at = now()
  where id = change_row.id returning * into change_row;
  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'REVIEW_MASSAGE_BOOKING_CHANGE', 'massage_booking_changes', change_row.id,
    jsonb_build_object('approved', true, 'action', change_row.action, 'session_id', session_row.id));
  return change_row;
end;
$$;

alter table public.massage_therapist_availability enable row level security;
alter table public.massage_booking_sessions enable row level security;
alter table public.massage_booking_changes enable row level security;

create policy "massage availability: admin or own therapist read"
on public.massage_therapist_availability for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.caregivers caregiver
    where caregiver.id = massage_therapist_availability.caregiver_id
      and caregiver.user_id = auth.uid()
  )
);

create policy "massage bookings: role scoped read"
on public.massage_booking_sessions for select to authenticated
using (
  public.is_admin()
  or public.is_client_member(massage_booking_sessions.client_id)
  or exists (
    select 1 from public.caregivers caregiver
    where caregiver.id = massage_booking_sessions.caregiver_id
      and caregiver.user_id = auth.uid()
  )
);

create policy "massage changes: role scoped read"
on public.massage_booking_changes for select to authenticated
using (
  public.is_admin()
  or massage_booking_changes.requested_by = auth.uid()
  or exists (
    select 1
    from public.massage_booking_sessions session
    join public.caregivers caregiver on caregiver.id = session.caregiver_id
    where session.id = massage_booking_changes.massage_booking_session_id
      and caregiver.user_id = auth.uid()
  )
);

revoke all on table public.massage_therapist_availability from public, anon, authenticated;
revoke all on table public.massage_booking_sessions from public, anon, authenticated;
revoke all on table public.massage_booking_changes from public, anon, authenticated;
grant select on table public.massage_therapist_availability to authenticated;
grant select on table public.massage_booking_sessions to authenticated;
grant select on table public.massage_booking_changes to authenticated;

revoke all on function public.promoms_massage_price(text, integer, integer) from public, anon;
grant execute on function public.promoms_massage_price(text, integer, integer) to authenticated;
revoke all on function public.client_has_postpartum_member_rate(uuid) from public, anon;
grant execute on function public.client_has_postpartum_member_rate(uuid) to authenticated;
revoke all on function public.admin_set_massage_therapist_capability(uuid, boolean) from public, anon;
grant execute on function public.admin_set_massage_therapist_capability(uuid, boolean) to authenticated;
revoke all on function public.submit_promoms_service_request(text, uuid, text, date, integer, date, time, time, text[], text, integer, text, text, text, text, text, text, text, boolean, boolean, text, integer, integer) from public, anon;
grant execute on function public.submit_promoms_service_request(text, uuid, text, date, integer, date, time, time, text[], text, integer, text, text, text, text, text, text, text, boolean, boolean, text, integer, integer) to authenticated;
revoke all on function public.review_promoms_service_request(uuid, boolean, text, text, text, date) from public, anon;
grant execute on function public.review_promoms_service_request(uuid, boolean, text, text, text, date) to authenticated;
revoke all on function public.massage_therapist_schedule_is_available(uuid, uuid, date, date, time, time, text[], uuid) from public, anon;
grant execute on function public.massage_therapist_schedule_is_available(uuid, uuid, date, date, time, time, text[], uuid) to authenticated;
revoke all on function public.schedule_promoms_service_request(uuid, uuid) from public, anon;
grant execute on function public.schedule_promoms_service_request(uuid, uuid) to authenticated;
revoke all on function public.submit_massage_adjustment(text, uuid, text, text, date, time, time, integer) from public, anon, authenticated;
revoke all on function public.review_massage_adjustment(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.massage_slot_is_available(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.massage_slot_is_available(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;
revoke all on function public.save_my_massage_availability(date, integer[], time, time) from public, anon;
grant execute on function public.save_my_massage_availability(date, integer[], time, time) to authenticated;
revoke all on function public.delete_my_massage_availability(uuid) from public, anon;
grant execute on function public.delete_my_massage_availability(uuid) to authenticated;
revoke all on function public.available_massage_slots(integer, date, date) from public, anon;
grant execute on function public.available_massage_slots(integer, date, date) to authenticated;
revoke all on function public.submit_massage_service_request(integer, text, text, jsonb, boolean) from public, anon;
grant execute on function public.submit_massage_service_request(integer, text, text, jsonb, boolean) to authenticated;
revoke all on function public.submit_massage_booking_change(uuid, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.submit_massage_booking_change(uuid, text, text, uuid, timestamptz) to authenticated;
revoke all on function public.review_massage_booking_change(uuid, boolean, text) from public, anon;
grant execute on function public.review_massage_booking_change(uuid, boolean, text) to authenticated;

comment on column public.caregiver_hr_profiles.is_massage_therapist is
  'Administrative capability flag. Only active caregivers with this flag can receive massage bookings.';
comment on function public.massage_therapist_schedule_is_available(uuid, uuid, date, date, time, time, text[], uuid) is
  'Rejects conflicts with other clients and all massage bookings; permits massage during the same client caregiving assignment.';

select pg_notify('pgrst', 'reload schema');
