-- Remove the manual pre-shift/start/end workflow. A care session is now an
-- internal daily record container that is opened and completed atomically
-- whenever the assigned caregiver saves a care event.

begin;

-- Preserve legacy checklist rows for audit history, but remove every
-- operational entry point and all client access to the retired feature.
drop function if exists public.save_care_shift_checklist(uuid, jsonb, date, text);
drop function if exists public.set_care_shift_check(uuid, text, boolean, date, text);
drop function if exists public.set_care_session_status(uuid, public.session_status, date, text);

revoke all on table public.care_shift_checks from public, anon, authenticated;
comment on table public.care_shift_checks is
  'Legacy pre-shift confirmations retained only as historical audit data. The workflow was retired in migration 049.';

-- No open sessions remain after the manual clock-in/out workflow is retired.
-- The recorded event range is the best available objective boundary; sessions
-- with no events retain their original timestamps.
update public.care_sessions session
set status = 'COMPLETED',
    started_at = coalesce(
      session.started_at,
      (select min(event.event_time) from public.care_events event where event.care_session_id = session.id),
      session.created_at
    ),
    ended_at = greatest(
      coalesce(
        (select max(event.event_time) from public.care_events event where event.care_session_id = session.id),
        session.started_at,
        session.updated_at,
        session.created_at
      ),
      coalesce(session.started_at, session.created_at)
    ),
    updated_at = now()
where session.status = 'IN_PROGRESS';

create or replace function public.record_care_event(
  p_assignment_id uuid,
  p_event_type text,
  p_event_time timestamptz,
  p_payload jsonb,
  p_notes text default null,
  p_time_zone text default 'America/New_York'
)
returns public.care_events
language plpgsql
security definer
set search_path = public
as $$
declare
  target_assignment public.care_assignments%rowtype;
  target_contract public.care_contracts%rowtype;
  target_caregiver public.caregivers%rowtype;
  target_session public.care_sessions%rowtype;
  saved_event public.care_events%rowtype;
  requested_time_zone text := trim(coalesce(nullif(p_time_zone, ''), 'America/New_York'));
  effective_time_zone text;
  local_today date;
  event_service_date date;
  normalized_event_type text := upper(trim(coalesce(p_event_type, '')));
  normalized_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'An active signed-in account is required';
  end if;
  if p_assignment_id is null or p_event_time is null then
    raise exception 'Assignment and recorded time are required';
  end if;
  if not public.current_user_is_active_caregiver() then
    raise exception 'An active caregiver account is required';
  end if;
  if jsonb_typeof(normalized_payload) <> 'object' then
    raise exception 'Care record details must be a JSON object';
  end if;
  if normalized_event_type not in (
    'FEEDING', 'DIAPER', 'SLEEP', 'TEMPERATURE', 'BATH',
    'WEIGHT', 'MOTHER_CARE', 'NOTE', 'MEAL', 'SITTER_NOTE'
  ) then
    raise exception 'Unsupported care record type';
  end if;
  if p_event_time > now() + interval '15 minutes' then
    raise exception 'Care record time cannot be more than 15 minutes in the future';
  end if;

  select zone.name
  into effective_time_zone
  from pg_catalog.pg_timezone_names zone
  where lower(zone.name) = lower(requested_time_zone)
  order by (zone.name = requested_time_zone) desc, zone.name
  limit 1;

  if effective_time_zone is null then
    raise exception 'Unsupported device time zone';
  end if;

  local_today := (now() at time zone effective_time_zone)::date;
  event_service_date := (p_event_time at time zone effective_time_zone)::date;
  if event_service_date <> local_today then
    raise exception 'Care records may be added only to the current device-local date';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment-session:' || p_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || auth.uid()::text, 0)
  );

  select assignment.*
  into target_assignment
  from public.care_assignments assignment
  where assignment.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Care assignment not found';
  end if;

  select contract.*
  into target_contract
  from public.care_contracts contract
  where contract.id = target_assignment.contract_id;

  if not found then
    raise exception 'Care contract not found';
  end if;

  select caregiver.*
  into target_caregiver
  from public.caregivers caregiver
  join public.profiles profile on profile.id = caregiver.user_id
  join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
  where caregiver.id = target_assignment.caregiver_id
    and caregiver.user_id = auth.uid()
    and caregiver.status = 'ACTIVE'
    and profile.account_status = 'ACTIVE'
    and profile.deleted_at is null
    and hr.employment_status = 'ACTIVE';

  if not found
     or target_assignment.status <> 'CONFIRMED'
     or event_service_date not between target_contract.start_date and target_contract.end_date then
    raise exception 'Only the active assigned caregiver can record care during the confirmed service period';
  end if;

  if target_assignment.service_type::text = 'BABYSITTING'
     and normalized_event_type not in ('MEAL', 'SITTER_NOTE') then
    raise exception 'Babysitting sessions accept only meal and activity-note events';
  elsif target_assignment.service_type::text = 'POSTPARTUM'
     and normalized_event_type not in (
       'FEEDING', 'DIAPER', 'SLEEP', 'TEMPERATURE',
       'BATH', 'WEIGHT', 'MOTHER_CARE', 'NOTE'
     ) then
    raise exception 'Postpartum sessions do not accept babysitting event types';
  elsif target_assignment.service_type::text not in ('POSTPARTUM', 'BABYSITTING') then
    raise exception 'This service type does not accept care log events';
  end if;

  -- Clean up any legacy open sessions silently. No user action is required.
  update public.care_sessions session
  set status = 'COMPLETED',
      ended_at = greatest(
        coalesce(
          (select max(event.event_time) from public.care_events event where event.care_session_id = session.id),
          session.started_at,
          session.updated_at,
          session.created_at
        ),
        coalesce(session.started_at, session.created_at)
      ),
      updated_at = now()
  where session.started_by = auth.uid()
    and session.status = 'IN_PROGRESS'
    and (session.assignment_id <> p_assignment_id or session.service_date <> event_service_date);

  select session.*
  into target_session
  from public.care_sessions session
  where session.assignment_id = p_assignment_id
    and session.service_date = event_service_date
  for update;

  if found then
    if target_session.status = 'CANCELLED' then
      raise exception 'A cancelled service date cannot receive care records';
    end if;
    if (p_event_time at time zone target_session.service_time_zone)::date <> target_session.service_date then
      raise exception 'The recorded time must remain within the existing service date';
    end if;
    effective_time_zone := target_session.service_time_zone;
    if exists (
      select 1
      from public.care_reports report
      where report.care_session_id = target_session.id
        and (report.status = 'PUBLISHED' or report.published_at is not null)
    ) then
      raise exception 'Published care report events cannot be added';
    end if;

    update public.care_sessions
    set status = 'IN_PROGRESS',
        started_at = least(coalesce(started_at, p_event_time), p_event_time),
        ended_at = null,
        started_by = auth.uid(),
        updated_at = now()
    where id = target_session.id
    returning * into target_session;
  else
    insert into public.care_sessions (
      assignment_id,
      service_date,
      service_time_zone,
      status,
      started_at,
      started_by
    ) values (
      p_assignment_id,
      event_service_date,
      effective_time_zone,
      'IN_PROGRESS',
      p_event_time,
      auth.uid()
    )
    returning * into target_session;
  end if;

  insert into public.care_events (
    care_session_id,
    event_type,
    event_time,
    payload,
    notes,
    unusual_observation,
    created_by
  ) values (
    target_session.id,
    normalized_event_type,
    p_event_time,
    normalized_payload,
    nullif(trim(coalesce(p_notes, '')), ''),
    false,
    auth.uid()
  )
  returning * into saved_event;

  update public.care_sessions session
  set status = 'COMPLETED',
      started_at = coalesce(
        (select min(event.event_time) from public.care_events event where event.care_session_id = session.id),
        session.started_at,
        p_event_time
      ),
      ended_at = coalesce(
        (select max(event.event_time) from public.care_events event where event.care_session_id = session.id),
        p_event_time
      ),
      updated_at = now()
  where session.id = target_session.id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'RECORD_CARE_EVENT_AUTOMATIC_SESSION',
    'care_events',
    saved_event.id,
    jsonb_build_object(
      'assignment_id', p_assignment_id,
      'care_session_id', target_session.id,
      'service_date', event_service_date,
      'service_time_zone', effective_time_zone,
      'event_type', normalized_event_type
    )
  );

  return saved_event;
end;
$$;

revoke all on function public.record_care_event(uuid, text, timestamptz, jsonb, text, text) from public;
revoke all on function public.record_care_event(uuid, text, timestamptz, jsonb, text, text) from anon;
grant execute on function public.record_care_event(uuid, text, timestamptz, jsonb, text, text) to authenticated;

comment on function public.record_care_event(uuid, text, timestamptz, jsonb, text, text) is
  'Atomically creates or reuses the assigned caregiver daily record container, saves one event, and completes the container without manual safety-check, clock-in, or clock-out steps.';

notify pgrst, 'reload schema';

commit;
