-- ProMoms 2026 service catalog: commute/live-in postpartum care, babysitting,
-- and conflict-aware prenatal/postpartum massage booking.

alter type public.care_service_type add value if not exists 'MASSAGE';

alter table public.caregiver_hr_profiles
  add column if not exists is_massage_therapist boolean not null default false;

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
  if p_service_type is null or p_service_type not in ('POSTPARTUM', 'BABYSITTING', 'MASSAGE') then raise exception 'Unsupported service type'; end if;
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
    return request_row;
  end if;

  if payment_method = '' or length(payment_reference) < 3 then raise exception 'Payment evidence is required for approval'; end if;
  effective_at := public.payment_effective_timestamp(p_received_on);
  latest_tier := case when public.client_has_postpartum_member_rate(request_row.client_id) then 'POSTPARTUM_CLIENT' else 'GENERAL' end;
  latest_price := public.promoms_massage_price(latest_tier, request_row.massage_duration_minutes, request_row.massage_session_count);
  if latest_price is null then raise exception 'Massage price could not be verified'; end if;

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
revoke all on function public.submit_massage_adjustment(text, uuid, text, text, date, time, time, integer) from public, anon;
grant execute on function public.submit_massage_adjustment(text, uuid, text, text, date, time, time, integer) to authenticated;
revoke all on function public.review_massage_adjustment(uuid, boolean, text) from public, anon;
grant execute on function public.review_massage_adjustment(uuid, boolean, text) to authenticated;

comment on column public.caregiver_hr_profiles.is_massage_therapist is
  'Administrative capability flag. Only active caregivers with this flag can receive massage bookings.';
comment on function public.massage_therapist_schedule_is_available(uuid, uuid, date, date, time, time, text[], uuid) is
  'Rejects conflicts with other clients and all massage bookings; permits massage during the same client caregiving assignment.';

select pg_notify('pgrst', 'reload schema');
