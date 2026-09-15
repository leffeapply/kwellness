-- Retrospective operations support.
-- Administrators may place approved work after its service start has passed,
-- assigned caregivers may add audited late reports, and payment ledgers retain
-- both the real receipt date and the later data-entry timestamp.

begin;

do $migration$
declare
  existing_definition text;
  patched_definition text;
  future_only_guard text := E'  if requested_start <= now() then\n    raise exception ''The approved service start must still be in the future'';\n  end if;\n';
begin
  select pg_get_functiondef(
    'public.schedule_approved_client_request(uuid, uuid)'::regprocedure
  ) into existing_definition;

  if existing_definition is null then
    raise exception 'schedule_approved_client_request is missing';
  end if;

  patched_definition := replace(existing_definition, future_only_guard, '');
  if patched_definition <> existing_definition then
    execute patched_definition;
  elsif position(
    'The approved service start must still be in the future'
    in existing_definition
  ) > 0 then
    raise exception 'The obsolete future-only scheduling guard was not found';
  end if;
end;
$migration$;

comment on function public.schedule_approved_client_request(uuid, uuid) is
  'Schedules approved requests on past, current, or future dates. Exact caregiver/baby overlap, deposit, employment, and company-compliance checks remain mandatory.';

-- Historical records stay scoped to the exact assigned caregiver, but no
-- arbitrary 30-day window hides work that needs a late operational report.
create or replace function public.caregiver_can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_active_caregiver() and exists (
    select 1
    from public.care_contracts contract
    join public.care_assignments assignment on assignment.contract_id = contract.id
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where contract.client_id = p_client_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
  );
$$;

create or replace function public.caregiver_can_access_baby(p_baby_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_active_caregiver() and exists (
    select 1
    from public.care_contracts contract
    join public.care_assignments assignment on assignment.contract_id = contract.id
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where contract.baby_id = p_baby_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
  );
$$;

create or replace function public.caregiver_can_access_contract(p_contract_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_is_active_caregiver() and exists (
    select 1
    from public.care_assignments assignment
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where assignment.contract_id = p_contract_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
  );
$$;

create or replace function public.can_read_care_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_care_staff()
  or exists (
    select 1
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.id = p_assignment_id
      and public.is_client_member(contract.client_id)
  )
  or (
    public.current_user_is_active_caregiver() and exists (
      select 1
      from public.care_assignments assignment
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where assignment.id = p_assignment_id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
    )
  );
$$;

create or replace function public.can_read_care_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_care_staff()
  or exists (
    select 1
    from public.care_sessions session
    join public.care_assignments assignment on assignment.id = session.assignment_id
    join public.care_contracts contract on contract.id = assignment.contract_id
    where session.id = p_session_id
      and public.is_client_member(contract.client_id)
  )
  or (
    public.current_user_is_active_caregiver() and exists (
      select 1
      from public.care_sessions session
      join public.care_assignments assignment on assignment.id = session.assignment_id
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where session.id = p_session_id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
    )
  );
$$;

-- A late report creates (or supplements) one completed visit for the selected
-- historical service date. The report remains publishable by an administrator,
-- while an already-published immutable report cannot be silently changed.
create or replace function public.record_retrospective_care_report(
  p_assignment_id uuid,
  p_service_date date,
  p_started_time time,
  p_ended_time time,
  p_summary text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_row public.care_assignments%rowtype;
  session_row public.care_sessions%rowtype;
  session_id uuid;
  actual_started_at timestamptz;
  actual_ended_at timestamptz;
  prior_ended_at timestamptz;
  event_kind text;
  event_payload jsonb;
  local_today date := (now() at time zone 'America/New_York')::date;
  normalized_summary text := trim(coalesce(p_summary, ''));
begin
  if auth.uid() is null or not public.current_user_is_active_caregiver() then
    raise exception 'Only an active caregiver can add a retrospective care report';
  end if;
  if p_assignment_id is null or p_service_date is null
     or p_started_time is null or p_ended_time is null then
    raise exception 'Assignment, service date, and actual work times are required';
  end if;
  if length(normalized_summary) not between 5 and 3000 then
    raise exception 'The retrospective report must contain between 5 and 3000 characters';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment-session:' || p_assignment_id::text, 0)
  );

  select assignment.*
  into assignment_row
  from public.care_assignments assignment
  join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
  join public.profiles profile on profile.id = caregiver.user_id
  join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
  where assignment.id = p_assignment_id
    and caregiver.user_id = auth.uid()
    and caregiver.status = 'ACTIVE'
    and profile.account_status = 'ACTIVE'
    and profile.deleted_at is null
    and hr.employment_status = 'ACTIVE'
    and assignment.status in ('CONFIRMED', 'COMPLETED')
  for update of assignment;

  if not found then
    raise exception 'Only the active assigned caregiver can report this service';
  end if;
  if p_service_date > local_today then
    raise exception 'A retrospective report cannot be entered for a future date';
  end if;
  if p_service_date not between
       (assignment_row.starts_at at time zone 'America/New_York')::date
       and (assignment_row.ends_at at time zone 'America/New_York')::date
     or not public.service_weekday_matches(p_service_date, assignment_row.service_days) then
    raise exception 'The report date must be one of the assigned service days';
  end if;

  actual_started_at := (p_service_date + p_started_time) at time zone 'America/New_York';
  actual_ended_at := (p_service_date + p_ended_time) at time zone 'America/New_York';
  if actual_ended_at <= actual_started_at then
    raise exception 'The actual end time must be later than the actual start time';
  end if;
  if actual_ended_at - actual_started_at < interval '30 minutes'
     or actual_ended_at - actual_started_at > interval '18 hours' then
    raise exception 'The reported work duration must be between 30 minutes and 18 hours';
  end if;
  if actual_ended_at > now() + interval '15 minutes' then
    raise exception 'A retrospective report cannot end in the future';
  end if;

  if exists (
    select 1
    from public.care_sessions open_session
    where open_session.started_by = auth.uid()
      and open_session.status = 'IN_PROGRESS'
  ) then
    raise exception 'Complete the active care session before adding a retrospective report';
  end if;

  select session.* into session_row
  from public.care_sessions session
  where session.assignment_id = p_assignment_id
    and session.service_date = p_service_date
  for update;

  if found then
    if session_row.status = 'CANCELLED' then
      raise exception 'A cancelled visit cannot receive a retrospective report';
    end if;
    if session_row.status = 'IN_PROGRESS' then
      raise exception 'Complete the active care session before adding a retrospective report';
    end if;
    if exists (
      select 1
      from public.care_reports report
      where report.care_session_id = session_row.id
        and (report.status = 'PUBLISHED' or report.published_at is not null)
    ) then
      raise exception 'The published care report is immutable';
    end if;
    session_id := session_row.id;
    prior_ended_at := session_row.ended_at;
    update public.care_sessions
    set status = 'IN_PROGRESS',
        started_at = least(coalesce(started_at, actual_started_at), actual_started_at),
        ended_at = null,
        started_by = coalesce(started_by, auth.uid()),
        updated_at = now()
    where id = session_id;
  else
    insert into public.care_sessions (
      assignment_id, service_date, status, started_at, started_by
    ) values (
      p_assignment_id, p_service_date, 'IN_PROGRESS', actual_started_at, auth.uid()
    ) returning id into session_id;
  end if;

  if assignment_row.service_type = 'BABYSITTING' then
    event_kind := 'SITTER_NOTE';
    event_payload := jsonb_build_object(
      'category', '소급 리포트',
      'text', normalized_summary,
      'retrospective', true,
      'reported_service_date', p_service_date
    );
  else
    event_kind := 'NOTE';
    event_payload := jsonb_build_object(
      'text', normalized_summary,
      'retrospective', true,
      'reported_service_date', p_service_date
    );
  end if;

  insert into public.care_events (
    care_session_id, event_type, event_time, payload, notes,
    unusual_observation, created_by
  ) values (
    session_id, event_kind, actual_ended_at, event_payload, normalized_summary,
    false, auth.uid()
  );

  update public.care_sessions
  set status = 'COMPLETED',
      started_at = least(coalesce(started_at, actual_started_at), actual_started_at),
      ended_at = greatest(coalesce(prior_ended_at, actual_ended_at), actual_ended_at),
      started_by = coalesce(started_by, auth.uid()),
      updated_at = now()
  where id = session_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'RECORD_RETROSPECTIVE_CARE_REPORT', 'care_sessions', session_id,
    jsonb_build_object(
      'assignment_id', p_assignment_id,
      'service_date', p_service_date,
      'actual_started_at', actual_started_at,
      'actual_ended_at', actual_ended_at,
      'entered_at', now()
    )
  );

  return session_id;
end;
$$;

revoke all on function public.record_retrospective_care_report(
  uuid, date, time, time, text
) from public;
revoke all on function public.record_retrospective_care_report(
  uuid, date, time, time, text
) from anon;
grant execute on function public.record_retrospective_care_report(
  uuid, date, time, time, text
) to authenticated;

create or replace function public.payment_effective_timestamp(p_received_on date)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  local_today date := (now() at time zone 'America/New_York')::date;
begin
  if p_received_on is null then
    raise exception 'The actual payment date is required';
  end if;
  if p_received_on > local_today then
    raise exception 'The payment date cannot be in the future';
  end if;
  if p_received_on = local_today then
    return now();
  end if;
  return (p_received_on + time '12:00') at time zone 'America/New_York';
end;
$$;

revoke all on function public.payment_effective_timestamp(date) from public;
revoke all on function public.payment_effective_timestamp(date) from anon;
revoke all on function public.payment_effective_timestamp(date) from authenticated;

create or replace function public.review_service_request_with_dated_deposit(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text,
  p_payment_method text,
  p_payment_reference text,
  p_received_on date
)
returns public.client_service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_request public.client_service_requests%rowtype;
  effective_at timestamptz;
begin
  if p_approve then
    effective_at := public.payment_effective_timestamp(p_received_on);
  end if;

  saved_request := public.review_service_request_with_deposit(
    p_request_id, p_approve, p_review_note, p_payment_method, p_payment_reference
  );

  if p_approve then
    update public.deposit_transactions
    set captured_at = effective_at,
        updated_at = now()
    where client_service_request_id = p_request_id
      and status = 'CAPTURED';

    update public.client_service_requests
    set deposit_paid_at = effective_at,
        updated_at = now()
    where id = p_request_id
    returning * into saved_request;

    insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(), 'SET_DEPOSIT_EFFECTIVE_DATE', 'client_service_requests', p_request_id,
      jsonb_build_object('received_on', p_received_on, 'entered_at', now())
    );
  end if;

  return saved_request;
end;
$$;

create or replace function public.record_approved_request_deposit_evidence_dated(
  p_request_id uuid,
  p_payment_method text,
  p_payment_reference text,
  p_received_on date
)
returns public.deposit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_deposit public.deposit_transactions%rowtype;
  effective_at timestamptz := public.payment_effective_timestamp(p_received_on);
begin
  saved_deposit := public.record_approved_request_deposit_evidence(
    p_request_id, p_payment_method, p_payment_reference
  );

  update public.deposit_transactions
  set captured_at = effective_at,
      updated_at = now()
  where id = saved_deposit.id
  returning * into saved_deposit;

  update public.client_service_requests
  set deposit_paid_at = effective_at,
      updated_at = now()
  where id = p_request_id;

  update public.care_assignments assignment
  set deposit_paid_at = effective_at,
      updated_at = now(),
      updated_by = auth.uid()
  from public.client_service_requests request
  where request.id = p_request_id
    and request.approved_assignment_id = assignment.id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'SET_DEPOSIT_EFFECTIVE_DATE', 'deposit_transactions', saved_deposit.id,
    jsonb_build_object('request_id', p_request_id, 'received_on', p_received_on, 'entered_at', now())
  );

  return saved_deposit;
end;
$$;

create or replace function public.record_service_balance_payment_dated(
  p_request_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_reference text,
  p_received_on date
)
returns public.service_balance_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_payment public.service_balance_transactions%rowtype;
  effective_at timestamptz := public.payment_effective_timestamp(p_received_on);
begin
  saved_payment := public.record_service_balance_payment(
    p_request_id, p_amount, p_payment_method, p_payment_reference
  );

  update public.service_balance_transactions
  set captured_at = effective_at,
      updated_at = now()
  where id = saved_payment.id
  returning * into saved_payment;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'SET_BALANCE_EFFECTIVE_DATE', 'service_balance_transactions', saved_payment.id,
    jsonb_build_object('request_id', p_request_id, 'received_on', p_received_on, 'entered_at', now())
  );

  return saved_payment;
end;
$$;

revoke all on function public.review_service_request_with_dated_deposit(
  uuid, boolean, text, text, text, date
) from public;
revoke all on function public.review_service_request_with_dated_deposit(
  uuid, boolean, text, text, text, date
) from anon;
grant execute on function public.review_service_request_with_dated_deposit(
  uuid, boolean, text, text, text, date
) to authenticated;

revoke all on function public.record_approved_request_deposit_evidence_dated(
  uuid, text, text, date
) from public;
revoke all on function public.record_approved_request_deposit_evidence_dated(
  uuid, text, text, date
) from anon;
grant execute on function public.record_approved_request_deposit_evidence_dated(
  uuid, text, text, date
) to authenticated;

revoke all on function public.record_service_balance_payment_dated(
  uuid, numeric, text, text, date
) from public;
revoke all on function public.record_service_balance_payment_dated(
  uuid, numeric, text, text, date
) from anon;
grant execute on function public.record_service_balance_payment_dated(
  uuid, numeric, text, text, date
) to authenticated;

notify pgrst, 'reload schema';

commit;
