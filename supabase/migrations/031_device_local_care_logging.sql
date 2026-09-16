-- Care work may be performed outside the business timezone. Scheduled weekdays
-- and clock times remain useful planning information, but the assigned caregiver
-- records care against the device-local service date for the session they start.

begin;

alter table public.care_sessions
  add column if not exists service_time_zone text;

update public.care_sessions
set service_time_zone = 'America/New_York'
where service_time_zone is null
   or trim(service_time_zone) = '';

alter table public.care_sessions
  alter column service_time_zone set default 'America/New_York',
  alter column service_time_zone set not null;

alter table public.care_sessions
  drop constraint if exists care_sessions_service_time_zone_nonempty;
alter table public.care_sessions
  add constraint care_sessions_service_time_zone_nonempty
  check (
    length(trim(service_time_zone)) between 1 and 128
  );

comment on column public.care_sessions.service_time_zone is
  'IANA timezone captured when the caregiver starts the daily session. Legacy sessions default to America/New_York.';
comment on column public.care_sessions.service_date is
  'The caregiver device-local calendar date for this session. Each assignment has at most one session per local date.';
comment on table public.care_shift_checks is
  'Per-session pre-care confirmations keyed by the caregiver device-local service date.';

-- Drop the exact legacy routines before adding optional parameters. Keeping the
-- old overloads would make PostgREST calls that omit the new parameters
-- ambiguous. Defaults preserve existing two-argument/three-argument clients.
drop function if exists public.set_care_session_status(
  uuid, public.session_status
);
drop function if exists public.set_care_shift_check(
  uuid, text, boolean
);

create or replace function public.set_care_shift_check(
  p_assignment_id uuid,
  p_check_key text,
  p_checked boolean,
  p_service_date date default null,
  p_time_zone text default 'America/New_York'
)
returns public.care_shift_checks
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_check_key text := lower(trim(coalesce(p_check_key, '')));
  requested_time_zone text := trim(coalesce(nullif(p_time_zone, ''), 'America/New_York'));
  effective_time_zone text;
  local_today date;
  effective_service_date date;
  target_assignment public.care_assignments%rowtype;
  target_contract public.care_contracts%rowtype;
  target_caregiver public.caregivers%rowtype;
  saved_check public.care_shift_checks%rowtype;
begin
  if auth.uid() is null or not public.current_user_is_active_caregiver() then
    raise exception 'An active caregiver account is required';
  end if;
  if normalized_check_key not in ('arrival', 'safety', 'request', 'scope') then
    raise exception 'Unsupported shift checklist item';
  end if;
  if p_checked is null then
    raise exception 'Checklist state is required';
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
  effective_service_date := coalesce(p_service_date, local_today);

  if effective_service_date <> local_today then
    raise exception 'The checklist service date must match the device-local current date';
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
    raise exception 'Care assignment not found or not accessible';
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
  where caregiver.id = target_assignment.caregiver_id;

  if not found
     or target_caregiver.user_id <> auth.uid()
     or target_caregiver.status <> 'ACTIVE'
     or not public.current_user_is_active_caregiver() then
    raise exception 'Only the active assigned caregiver can update this checklist';
  end if;

  if target_assignment.status <> 'CONFIRMED'
     or effective_service_date not between
       target_contract.start_date and target_contract.end_date then
    raise exception 'Checklist updates are allowed only during the confirmed contract period';
  end if;

  if exists (
    select 1
    from public.care_sessions session
    where session.assignment_id = target_assignment.id
      and session.service_date = effective_service_date
      and (
        session.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')
        or session.started_at is not null
        or exists (
          select 1
          from public.care_events event
          where event.care_session_id = session.id
        )
      )
  ) then
    raise exception 'Safety checks are locked after the care session starts';
  end if;

  insert into public.care_shift_checks (
    assignment_id,
    service_date,
    check_key,
    checked,
    checked_by,
    checked_at
  ) values (
    target_assignment.id,
    effective_service_date,
    normalized_check_key,
    p_checked,
    auth.uid(),
    now()
  )
  on conflict (assignment_id, service_date, check_key) do update set
    checked = excluded.checked,
    checked_by = excluded.checked_by,
    checked_at = excluded.checked_at,
    updated_at = now()
  returning * into saved_check;

  return saved_check;
end;
$$;

create or replace function public.set_care_session_status(
  p_assignment_id uuid,
  p_status public.session_status,
  p_service_date date default null,
  p_time_zone text default 'America/New_York'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session_id uuid;
  target_session public.care_sessions%rowtype;
  target_assignment public.care_assignments%rowtype;
  target_contract public.care_contracts%rowtype;
  assigned_caregiver_user_id uuid;
  assigned_caregiver_status text;
  assigned_profile_status text;
  assigned_profile_deleted_at timestamptz;
  requested_time_zone text := trim(coalesce(nullif(p_time_zone, ''), 'America/New_York'));
  effective_time_zone text;
  local_today date;
  effective_service_date date;
begin
  if auth.uid() is null
     or not public.current_user_is_active_caregiver()
     or p_status is null
     or p_status not in ('IN_PROGRESS', 'COMPLETED') then
    raise exception 'An authenticated caregiver may only start or complete care';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment-session:' || p_assignment_id::text, 0)
  );

  select caregiver.user_id
  into assigned_caregiver_user_id
  from public.care_assignments assignment
  join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
  where assignment.id = p_assignment_id;

  if assigned_caregiver_user_id is null then
    raise exception 'Care assignment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || assigned_caregiver_user_id::text, 0)
  );

  select assignment.*
  into target_assignment
  from public.care_assignments assignment
  where assignment.id = p_assignment_id
  for update;

  select contract.*
  into target_contract
  from public.care_contracts contract
  where contract.id = target_assignment.contract_id;

  if not found then
    raise exception 'Care contract not found';
  end if;

  select caregiver.user_id, caregiver.status, profile.account_status, profile.deleted_at
  into assigned_caregiver_user_id, assigned_caregiver_status,
       assigned_profile_status, assigned_profile_deleted_at
  from public.caregivers caregiver
  join public.profiles profile on profile.id = caregiver.user_id
  where caregiver.id = target_assignment.caregiver_id;

  if assigned_caregiver_user_id is distinct from auth.uid()
     or assigned_caregiver_status <> 'ACTIVE'
     or assigned_profile_status <> 'ACTIVE'
     or assigned_profile_deleted_at is not null
     or not public.has_role_for_user(auth.uid(), 'CAREGIVER')
     or not exists (
       select 1
       from public.caregiver_hr_profiles hr
       where hr.caregiver_id = target_assignment.caregiver_id
         and hr.employment_status = 'ACTIVE'
     )
     or target_assignment.status <> 'CONFIRMED' then
    raise exception 'Only the active assigned caregiver can operate this care session';
  end if;

  if p_status = 'COMPLETED' then
    select session.*
    into target_session
    from public.care_sessions session
    where session.assignment_id = p_assignment_id
      and session.status = 'IN_PROGRESS'
      and session.started_by = auth.uid()
    order by session.started_at desc nulls last, session.service_date desc
    limit 1
    for update;

    if not found then
      raise exception 'Only the person who started an open care session may complete it';
    end if;

    if p_service_date is not null
       and target_session.service_date <> p_service_date then
      raise exception 'The completion date does not match the open care session';
    end if;

    update public.care_sessions
    set status = 'COMPLETED',
        ended_at = now(),
        updated_at = now()
    where id = target_session.id
    returning id into target_session_id;

    return target_session_id;
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
  effective_service_date := coalesce(p_service_date, local_today);

  if effective_service_date <> local_today then
    raise exception 'The session service date must match the device-local current date';
  end if;

  if effective_service_date not between
       target_contract.start_date and target_contract.end_date then
    raise exception 'Care may start only during the contract period';
  end if;

  if (
    select count(distinct shift_check.check_key)
    from public.care_shift_checks shift_check
    where shift_check.assignment_id = p_assignment_id
      and shift_check.service_date = effective_service_date
      and shift_check.checked
      and shift_check.checked_by = auth.uid()
      and shift_check.check_key in ('arrival', 'safety', 'request', 'scope')
  ) <> 4 then
    raise exception 'Complete all four safety checks before starting care';
  end if;

  if exists (
    select 1
    from public.care_sessions session
    where session.assignment_id = p_assignment_id
      and session.service_date = effective_service_date
      and session.status in ('COMPLETED', 'CANCELLED')
  ) then
    raise exception 'A completed or cancelled care session cannot be restarted';
  end if;

  if exists (
    select 1
    from public.care_sessions session
    where session.started_by = auth.uid()
      and (
        session.assignment_id <> p_assignment_id
        or session.service_date <> effective_service_date
      )
      and session.status = 'IN_PROGRESS'
  ) then
    raise exception 'Complete the open care session before starting another';
  end if;

  insert into public.care_sessions (
    assignment_id,
    service_date,
    service_time_zone,
    status,
    started_at,
    started_by
  ) values (
    p_assignment_id,
    effective_service_date,
    effective_time_zone,
    'IN_PROGRESS',
    now(),
    auth.uid()
  )
  on conflict (assignment_id, service_date) do update set
    status = excluded.status,
    service_time_zone = case
      when public.care_sessions.status = 'SCHEDULED'
        then excluded.service_time_zone
      else public.care_sessions.service_time_zone
    end,
    started_at = coalesce(public.care_sessions.started_at, excluded.started_at),
    ended_at = null,
    started_by = coalesce(public.care_sessions.started_by, excluded.started_by),
    updated_at = now()
  returning id into target_session_id;

  return target_session_id;
end;
$$;

-- Scheduled clock times and recurring weekdays are intentionally absent from
-- these policies. The session-local date, confirmed contract, active caregiver,
-- and immutable lifecycle remain authoritative.
drop policy if exists "events: assigned caregiver insert" on public.care_events;
drop policy if exists "events: active caregiver insert" on public.care_events;
drop policy if exists "events: active assigned caregiver insert" on public.care_events;
drop policy if exists "events: daily assigned caregiver insert" on public.care_events;
create policy "events: daily assigned caregiver insert"
on public.care_events for insert to authenticated
with check (
  created_by = auth.uid()
  and event_time <= now() + interval '15 minutes'
  and exists (
    select 1
    from public.care_sessions session
    join public.care_assignments assignment
      on assignment.id = session.assignment_id
    join public.care_contracts contract
      on contract.id = assignment.contract_id
    join public.caregivers caregiver
      on caregiver.id = assignment.caregiver_id
    where session.id = care_session_id
      and session.status = 'IN_PROGRESS'
      and session.service_date = (
        event_time at time zone session.service_time_zone
      )::date
      and session.service_date between contract.start_date and contract.end_date
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and public.current_user_is_active_caregiver()
      and assignment.status = 'CONFIRMED'
      and public.account_is_active()
  )
);

drop policy if exists "events: author or staff update" on public.care_events;
drop policy if exists "events: active author or staff update" on public.care_events;
drop policy if exists "events: daily author or staff update" on public.care_events;
create policy "events: daily author or staff update"
on public.care_events for update to authenticated
using (
  public.is_care_staff()
  or (
    created_by = auth.uid()
    and exists (
      select 1
      from public.care_sessions session
      join public.care_assignments assignment
        on assignment.id = session.assignment_id
      join public.caregivers caregiver
        on caregiver.id = assignment.caregiver_id
      where session.id = care_session_id
        and session.status = 'IN_PROGRESS'
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and public.current_user_is_active_caregiver()
        and assignment.status = 'CONFIRMED'
        and public.account_is_active()
    )
  )
)
with check (
  event_time <= now() + interval '15 minutes'
  and exists (
    select 1
    from public.care_sessions session
    join public.care_assignments assignment
      on assignment.id = session.assignment_id
    join public.care_contracts contract
      on contract.id = assignment.contract_id
    join public.caregivers caregiver
      on caregiver.id = assignment.caregiver_id
    where session.id = care_session_id
      and session.status = 'IN_PROGRESS'
      and session.service_date = (
        event_time at time zone session.service_time_zone
      )::date
      and session.service_date between contract.start_date and contract.end_date
      and assignment.status = 'CONFIRMED'
      and (
        public.is_care_staff()
        or (
          created_by = auth.uid()
          and caregiver.user_id = auth.uid()
          and caregiver.status = 'ACTIVE'
          and public.current_user_is_active_caregiver()
          and public.account_is_active()
        )
      )
  )
);

revoke all on function public.set_care_shift_check(
  uuid, text, boolean, date, text
) from public;
revoke all on function public.set_care_shift_check(
  uuid, text, boolean, date, text
) from anon;
revoke all on function public.set_care_shift_check(
  uuid, text, boolean, date, text
) from authenticated;
grant execute on function public.set_care_shift_check(
  uuid, text, boolean, date, text
) to authenticated;

revoke all on function public.set_care_session_status(
  uuid, public.session_status, date, text
) from public;
revoke all on function public.set_care_session_status(
  uuid, public.session_status, date, text
) from anon;
revoke all on function public.set_care_session_status(
  uuid, public.session_status, date, text
) from authenticated;
grant execute on function public.set_care_session_status(
  uuid, public.session_status, date, text
) to authenticated;

comment on function public.set_care_shift_check(
  uuid, text, boolean, date, text
) is
  'Upserts one pre-care checklist item for the assigned caregiver on the current device-local date during the confirmed contract period. Scheduled hours and weekdays are advisory.';

comment on function public.set_care_session_status(
  uuid, public.session_status, date, text
) is
  'Starts care on the current device-local date and captures its IANA timezone, or completes the caregiver-owned open session. Scheduled hours and weekdays are advisory.';

comment on policy "events: daily assigned caregiver insert"
  on public.care_events is
  'Allows the active assigned caregiver to record facts throughout an in-progress session on its captured local date; scheduled hours and weekdays are advisory.';

comment on policy "events: daily author or staff update"
  on public.care_events is
  'Allows corrections while a session is in progress when the event remains on the session-local date and inside the contract period.';

notify pgrst, 'reload schema';

commit;
