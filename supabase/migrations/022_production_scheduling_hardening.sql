-- Production scheduling and governance hardening.
-- Apply after 021_independent_babysitting_overlap_rules.sql.

-- Keep schedule changes structurally separate from cancellation penalties.
update public.service_adjustment_requests
set policy_code = 'SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY', updated_at = now()
where action = 'CHANGE'
  and policy_code is distinct from 'SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY';

alter table public.service_adjustment_requests
  drop constraint if exists service_adjustment_requests_policy_code_check;
alter table public.service_adjustment_requests
  add constraint service_adjustment_requests_policy_code_check
  check (policy_code in (
    'SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY',
    'DEPOSIT_REFUNDABLE',
    'DEPOSIT_NON_REFUNDABLE',
    'POSTPARTUM_ACTIVE_PRORATED',
    'BABYSITTING_DEPOSIT_REFUNDABLE',
    'BABYSITTING_DEPOSIT_NON_REFUNDABLE',
    'STANDARD_NOTICE',
    'LATE_NOTICE',
    'SHORT_NOTICE'
  ));

alter table public.service_adjustment_requests
  drop constraint if exists change_adjustment_has_no_deposit_penalty;
alter table public.service_adjustment_requests
  add constraint change_adjustment_has_no_deposit_penalty
  check (
    action <> 'CHANGE'
    or policy_code = 'SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY'
  );

-- A review decision must go through review_service_adjustment so the request
-- row cannot be approved without applying the corresponding service mutation.
drop policy if exists "service adjustments: staff review"
  on public.service_adjustment_requests;
drop policy if exists "service adjustments: family create pending"
  on public.service_adjustment_requests;
revoke update on table public.service_adjustment_requests from authenticated;
revoke update on table public.service_adjustment_requests from anon;
revoke update on table public.service_adjustment_requests from public;
revoke insert on table public.service_adjustment_requests from authenticated;
revoke insert on table public.service_adjustment_requests from anon;
revoke insert on table public.service_adjustment_requests from public;

-- Immutable evidence that a reservation deposit was actually captured. A
-- request can have one captured deposit, and a provider reference cannot be
-- reused for a different request under the same payment method.
create table if not exists public.deposit_transactions (
  id uuid primary key default gen_random_uuid(),
  client_service_request_id uuid not null
    references public.client_service_requests(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'USD'
    check (currency = upper(currency) and length(currency) = 3),
  status text not null
    check (status in ('CAPTURED', 'REFUNDED', 'VOIDED', 'FAILED')),
  payment_method text not null check (length(trim(payment_method)) between 2 and 40),
  external_reference text not null
    check (length(trim(external_reference)) between 3 and 255),
  idempotency_key text not null unique,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_capture_has_timestamp check (
    status <> 'CAPTURED' or captured_at is not null
  ),
  constraint deposit_payment_reference_unique
    unique (payment_method, external_reference)
);

create unique index if not exists one_captured_deposit_per_service_request
  on public.deposit_transactions(client_service_request_id)
  where status = 'CAPTURED';

create index if not exists deposit_transactions_client_created_idx
  on public.deposit_transactions(client_id, created_at desc);

alter table public.deposit_transactions enable row level security;

drop policy if exists "deposit transactions: client or admin read"
  on public.deposit_transactions;
create policy "deposit transactions: client or admin read"
on public.deposit_transactions for select to authenticated
using (public.is_admin() or public.is_client_member(client_id));

revoke all on table public.deposit_transactions from public;
revoke all on table public.deposit_transactions from anon;
revoke all on table public.deposit_transactions from authenticated;
grant select on table public.deposit_transactions to authenticated;

comment on table public.deposit_transactions is
  'Auditable reservation-deposit evidence. Browser clients have read-only RLS access; writes occur only through payment-aware RPCs.';

create or replace function public.enforce_deposit_transaction_target()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  request_client_id uuid;
  request_service_type public.care_service_type;
  required_deposit numeric(10,2);
begin
  select request.client_id, request.service_type
  into request_client_id, request_service_type
  from public.client_service_requests request
  where request.id = new.client_service_request_id;

  if request_client_id is null or request_client_id <> new.client_id then
    raise exception 'Deposit transaction client does not match the service request';
  end if;

  required_deposit := case request_service_type
    when 'POSTPARTUM' then 500.00
    when 'BABYSITTING' then 128.00
    else null
  end;

  if required_deposit is null
     or new.amount <> required_deposit
     or new.currency <> 'USD' then
    raise exception 'Deposit transaction amount or currency does not match the service policy';
  end if;

  new.payment_method := upper(trim(new.payment_method));
  new.external_reference := trim(new.external_reference);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists enforce_deposit_transaction_target_trigger
  on public.deposit_transactions;
create trigger enforce_deposit_transaction_target_trigger
before insert or update of client_service_request_id, client_id, amount, currency,
  payment_method, external_reference, status
on public.deposit_transactions
for each row execute function public.enforce_deposit_transaction_target();

-- One session represents one local service day, not the entire multi-week
-- assignment. Existing events/reports keep their care_session_id references.
alter table public.care_sessions
  add column if not exists service_date date;

update public.care_sessions session
set service_date = (
  coalesce(session.started_at, assignment.starts_at)
    at time zone 'America/New_York'
)::date
from public.care_assignments assignment
where assignment.id = session.assignment_id
  and session.service_date is null;

alter table public.care_sessions
  alter column service_date set not null;

alter table public.care_sessions
  drop constraint if exists care_sessions_assignment_id_key;
alter table public.care_sessions
  drop constraint if exists care_sessions_assignment_service_date_key;
alter table public.care_sessions
  add constraint care_sessions_assignment_service_date_key
  unique (assignment_id, service_date);

create index if not exists care_sessions_service_date_idx
  on public.care_sessions(service_date, status);

comment on column public.care_sessions.service_date is
  'The assignment workday in America/New_York. Each assignment has at most one session per local date.';

drop policy if exists "sessions: assigned caregiver update" on public.care_sessions;
drop policy if exists "sessions: active assigned caregiver update" on public.care_sessions;
revoke insert, update, delete on table public.care_sessions from public;
revoke insert, update, delete on table public.care_sessions from anon;
revoke insert, update, delete on table public.care_sessions from authenticated;

-- Match the weekday tokens currently stored by the Korean web application while
-- remaining compatible with ISO/English tokens if an integration writes them.
create or replace function public.service_weekday_matches(
  p_date date,
  p_service_days text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case extract(isodow from p_date)::integer
    when 1 then coalesce(p_service_days, '{}'::text[]) && array['월', 'MON', 'MONDAY', '1']
    when 2 then coalesce(p_service_days, '{}'::text[]) && array['화', 'TUE', 'TUESDAY', '2']
    when 3 then coalesce(p_service_days, '{}'::text[]) && array['수', 'WED', 'WEDNESDAY', '3']
    when 4 then coalesce(p_service_days, '{}'::text[]) && array['목', 'THU', 'THURSDAY', '4']
    when 5 then coalesce(p_service_days, '{}'::text[]) && array['금', 'FRI', 'FRIDAY', '5']
    when 6 then coalesce(p_service_days, '{}'::text[]) && array['토', 'SAT', 'SATURDAY', '6']
    when 7 then coalesce(p_service_days, '{}'::text[]) && array['일', 'SUN', 'SUNDAY', '7']
    else false
  end;
$$;

-- Canonicalize all supported Korean, English and ISO weekday spellings so
-- aliases for the same weekday cannot be counted twice for billing.
create or replace function public.canonical_service_days(p_service_days text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(canonical_day order by day_number), '{}'::text[])
  from (
    select distinct
      case
        when upper(trim(day_token)) in ('월', 'MON', 'MONDAY', '1') then 1
        when upper(trim(day_token)) in ('화', 'TUE', 'TUESDAY', '2') then 2
        when upper(trim(day_token)) in ('수', 'WED', 'WEDNESDAY', '3') then 3
        when upper(trim(day_token)) in ('목', 'THU', 'THURSDAY', '4') then 4
        when upper(trim(day_token)) in ('금', 'FRI', 'FRIDAY', '5') then 5
        when upper(trim(day_token)) in ('토', 'SAT', 'SATURDAY', '6') then 6
        when upper(trim(day_token)) in ('일', 'SUN', 'SUNDAY', '7') then 7
      end as day_number,
      case
        when upper(trim(day_token)) in ('월', 'MON', 'MONDAY', '1') then '월'
        when upper(trim(day_token)) in ('화', 'TUE', 'TUESDAY', '2') then '화'
        when upper(trim(day_token)) in ('수', 'WED', 'WEDNESDAY', '3') then '수'
        when upper(trim(day_token)) in ('목', 'THU', 'THURSDAY', '4') then '목'
        when upper(trim(day_token)) in ('금', 'FRI', 'FRIDAY', '5') then '금'
        when upper(trim(day_token)) in ('토', 'SAT', 'SATURDAY', '6') then '토'
        when upper(trim(day_token)) in ('일', 'SUN', 'SUNDAY', '7') then '일'
      end as canonical_day
    from unnest(coalesce(p_service_days, '{}'::text[])) day_token
  ) normalized
  where day_number is not null;
$$;

-- A legacy caregivers row must never grant access after the member has moved
-- to another role or left active employment. Centralize the full identity
-- check so every caregiver read/write boundary uses the same fail-closed rule.
create or replace function public.current_user_is_active_caregiver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active()
    and public.has_role('CAREGIVER')
    and exists (
      select 1
      from public.caregivers caregiver
      join public.profiles profile on profile.id = caregiver.user_id
      join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
      where caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and profile.account_status = 'ACTIVE'
        and profile.deleted_at is null
        and hr.employment_status = 'ACTIVE'
    );
$$;

revoke all on function public.current_user_is_active_caregiver() from public;
revoke all on function public.current_user_is_active_caregiver() from anon;
grant execute on function public.current_user_is_active_caregiver() to authenticated;

create or replace function public.company_care_compliance_is_current()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from unnest(array[
      'GENERAL_LIABILITY', 'WORKERS_COMP', 'W2_EMPLOYMENT'
    ]::text[]) required_control(control_key)
    where not exists (
      select 1
      from public.company_compliance_controls control
      where control.control_key = required_control.control_key
        and control.status = 'ACTIVE'
        and control.verified_at is not null
        and nullif(trim(control.evidence_reference), '') is not null
        and (
          control.expires_at is null
          or control.expires_at >= (now() at time zone 'America/New_York')::date
        )
    )
  );
$$;

revoke all on function public.company_care_compliance_is_current() from public;
revoke all on function public.company_care_compliance_is_current() from anon;
grant execute on function public.company_care_compliance_is_current() to authenticated;

-- Persist the four pre-shift confirmations independently for every local
-- service day. The row remains when unchecked so the most recent actor/time is
-- auditable rather than disappearing from storage.
create table if not exists public.care_shift_checks (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null
    references public.care_assignments(id) on delete cascade,
  service_date date not null,
  check_key text not null
    check (check_key in ('arrival', 'safety', 'request', 'scope')),
  checked boolean not null default false,
  checked_by uuid not null references public.profiles(id) on delete restrict,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_shift_checks_assignment_date_key_unique
    unique (assignment_id, service_date, check_key)
);

create index if not exists care_shift_checks_date_idx
  on public.care_shift_checks(service_date, assignment_id);

alter table public.care_shift_checks enable row level security;

drop policy if exists "shift checks: assigned caregiver or staff read"
  on public.care_shift_checks;
create policy "shift checks: assigned caregiver or staff read"
on public.care_shift_checks for select to authenticated
using (
  public.is_care_staff()
  or exists (
    select 1
    from public.care_assignments assignment
    join public.caregivers caregiver
      on caregiver.id = assignment.caregiver_id
    where assignment.id = care_shift_checks.assignment_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and public.current_user_is_active_caregiver()
  )
);

revoke all on table public.care_shift_checks from public;
revoke all on table public.care_shift_checks from anon;
revoke all on table public.care_shift_checks from authenticated;
grant select on table public.care_shift_checks to authenticated;

create or replace function public.set_care_shift_check(
  p_assignment_id uuid,
  p_check_key text,
  p_checked boolean
)
returns public.care_shift_checks
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_check_key text := lower(trim(coalesce(p_check_key, '')));
  local_today date := (now() at time zone 'America/New_York')::date;
  target_assignment public.care_assignments%rowtype;
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

  perform pg_advisory_xact_lock(
    hashtextextended('assignment-session:' || p_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || auth.uid()::text, 0)
  );

  select assignment.* into target_assignment
  from public.care_assignments assignment
  where assignment.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Care assignment not found or not accessible';
  end if;

  select caregiver.* into target_caregiver
  from public.caregivers caregiver
  where caregiver.id = target_assignment.caregiver_id;

  if not found
     or target_caregiver.user_id <> auth.uid()
     or target_caregiver.status <> 'ACTIVE'
     or not public.current_user_is_active_caregiver() then
    raise exception 'Only the assigned caregiver can update this checklist';
  end if;
  if target_assignment.status <> 'CONFIRMED'
     or local_today not between
       (target_assignment.starts_at at time zone 'America/New_York')::date
       and (target_assignment.ends_at at time zone 'America/New_York')::date
     or not public.service_weekday_matches(
       local_today,
       target_assignment.service_days
     ) then
    raise exception 'Checklist updates are allowed only for today''s confirmed service day';
  end if;
  if exists (
    select 1 from public.care_sessions session
    where session.assignment_id = target_assignment.id
      and session.service_date = local_today
      and (
        session.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')
        or session.started_at is not null
        or exists (select 1 from public.care_events event where event.care_session_id = session.id)
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
    local_today,
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

comment on table public.care_shift_checks is
  'Daily pre-shift confirmations. Only the assigned caregiver may write the current confirmed service day through set_care_shift_check.';

-- Consolidate permissive legacy event policies into assignment-bound access.
-- Families see only their own contract, and caregivers see only the assignment
-- currently associated with their caregiver record.
drop policy if exists "events: care team read" on public.care_events;
drop policy if exists "events: authorized care data read" on public.care_events;
drop policy if exists "events: care team or family read" on public.care_events;
drop policy if exists "events: assignment participants read" on public.care_events;
create policy "events: assignment participants read"
on public.care_events for select to authenticated
using (
  public.is_care_staff()
  or exists (
    select 1
    from public.care_sessions session
    join public.care_assignments assignment
      on assignment.id = session.assignment_id
    join public.caregivers caregiver
      on caregiver.id = assignment.caregiver_id
      where session.id = care_session_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and public.current_user_is_active_caregiver()
  )
  or exists (
    select 1
    from public.care_sessions session
    join public.care_assignments assignment
      on assignment.id = session.assignment_id
    join public.care_contracts contract
      on contract.id = assignment.contract_id
    where session.id = care_session_id
      and public.is_client_member(contract.client_id)
  )
);

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
    join public.caregivers caregiver
      on caregiver.id = assignment.caregiver_id
    where session.id = care_session_id
      and session.status = 'IN_PROGRESS'
      and session.service_date = (
        event_time at time zone 'America/New_York'
      )::date
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and public.current_user_is_active_caregiver()
      and assignment.status = 'CONFIRMED'
      and public.account_is_active()
      and session.service_date between
        (assignment.starts_at at time zone 'America/New_York')::date
        and (assignment.ends_at at time zone 'America/New_York')::date
      and public.service_weekday_matches(
        session.service_date,
        assignment.service_days
      )
      and (event_time at time zone 'America/New_York') >= (
        session.service_date
          + coalesce(
              assignment.daily_start_time,
              (assignment.starts_at at time zone 'America/New_York')::time
            )
          - interval '30 minutes'
      )
      and (event_time at time zone 'America/New_York') <= (
        session.service_date
          + coalesce(
              assignment.daily_end_time,
              (assignment.ends_at at time zone 'America/New_York')::time
            )
          + interval '60 minutes'
      )
  )
);

-- While the session remains in progress, the author may correct a factual
-- entry no later than 24 hours after that service day's scheduled end. The
-- corrected event must remain attached to the same authorized daily-session
-- boundary. Care staff retains the RLS author-identity override, while the
-- lifecycle guard below freezes every writer after completion/publication.
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
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and public.current_user_is_active_caregiver()
        and now() <= (
          (
            session.service_date
              + coalesce(
                  assignment.daily_end_time,
                  (assignment.ends_at at time zone 'America/New_York')::time
                )
          ) at time zone 'America/New_York'
        ) + interval '24 hours'
    )
  )
)
with check (
  public.is_care_staff()
  or (
    created_by = auth.uid()
    and event_time <= now() + interval '15 minutes'
    and exists (
      select 1
      from public.care_sessions session
      join public.care_assignments assignment
        on assignment.id = session.assignment_id
      join public.caregivers caregiver
        on caregiver.id = assignment.caregiver_id
      where session.id = care_session_id
        and session.status = 'IN_PROGRESS'
        and session.service_date = (
          event_time at time zone 'America/New_York'
        )::date
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and public.current_user_is_active_caregiver()
        and assignment.status = 'CONFIRMED'
        and public.account_is_active()
        and public.service_weekday_matches(
          session.service_date,
          assignment.service_days
        )
        and (event_time at time zone 'America/New_York') >= (
          session.service_date
            + coalesce(
                assignment.daily_start_time,
                (assignment.starts_at at time zone 'America/New_York')::time
              )
            - interval '30 minutes'
        )
        and (event_time at time zone 'America/New_York') <= (
          session.service_date
            + coalesce(
                assignment.daily_end_time,
                (assignment.ends_at at time zone 'America/New_York')::time
              )
            + interval '60 minutes'
        )
        and now() <= (
          (
            session.service_date
              + coalesce(
                  assignment.daily_end_time,
                  (assignment.ends_at at time zone 'America/New_York')::time
                )
          ) at time zone 'America/New_York'
        ) + interval '24 hours'
    )
  )
);

-- Freeze the daily event ledger as part of the same assignment/session lock
-- protocol used by set_care_session_status. RLS continues to decide who may
-- write; this trigger closes the time-of-check/time-of-use gap between that
-- authorization check, session completion, and immutable report publication.
create or replace function public.guard_care_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_session_id uuid;
  new_session_id uuid;
  target_session_ids uuid[];
  locked_assignment_ids uuid[];
  lock_assignment_id uuid;
  session_row public.care_sessions%rowtype;
  locked_session_count integer := 0;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_session_id := old.care_session_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_session_id := new.care_session_id;
  end if;

  select coalesce(array_agg(distinct requested.session_id order by requested.session_id), array[]::uuid[])
  into target_session_ids
  from unnest(array[old_session_id, new_session_id]::uuid[]) as requested(session_id)
  where requested.session_id is not null;

  select coalesce(array_agg(distinct session.assignment_id order by session.assignment_id), array[]::uuid[])
  into locked_assignment_ids
  from public.care_sessions session
  where session.id = any(target_session_ids);

  if cardinality(locked_assignment_ids) = 0 then
    raise exception 'Care session not found';
  end if;

  -- Deterministic ordering also covers a staff correction that moves an event
  -- between sessions, without inverting the assignment -> session lock order.
  foreach lock_assignment_id in array locked_assignment_ids loop
    perform pg_advisory_xact_lock(
      hashtextextended('assignment-session:' || lock_assignment_id::text, 0)
    );
  end loop;

  for session_row in
    select session.*
    from public.care_sessions session
    where session.id = any(target_session_ids)
    order by session.id
    for update
  loop
    locked_session_count := locked_session_count + 1;

    -- The assignment id was read before the advisory lock. Direct session
    -- reassignment is not exposed, but fail safely if a privileged concurrent
    -- transaction changed it rather than taking locks in the reverse order.
    if not (session_row.assignment_id = any(locked_assignment_ids)) then
      raise exception 'Care session assignment changed; retry the event update';
    end if;

    if session_row.status <> 'IN_PROGRESS' then
      raise exception 'Care events may be changed only while the care session is in progress';
    end if;

    if exists (
      select 1
      from public.care_reports report
      where report.care_session_id = session_row.id
        and (report.status = 'PUBLISHED' or report.published_at is not null)
    ) then
      raise exception 'Published care report events are immutable';
    end if;
  end loop;

  if locked_session_count <> cardinality(target_session_ids) then
    raise exception 'Care session not found or changed; retry the event update';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists care_events_mutation_guard_trigger
  on public.care_events;
create trigger care_events_mutation_guard_trigger
before insert or update or delete
on public.care_events
for each row execute function public.guard_care_event_mutation();

revoke all on function public.guard_care_event_mutation() from public;
revoke all on function public.guard_care_event_mutation() from anon;
revoke all on function public.guard_care_event_mutation() from authenticated;

create or replace function public.enforce_started_postpartum_start_date()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  assignment_start timestamptz;
  assignment_local_start_date date;
begin
  if new.service_type = 'POSTPARTUM'
     and new.action = 'CHANGE'
     and new.care_assignment_id is not null then
    select starts_at into assignment_start
    from public.care_assignments
    where id = new.care_assignment_id;

    assignment_local_start_date := (
      assignment_start at time zone 'America/New_York'
    )::date;

    if assignment_start <= now()
       and new.proposed_start_date is distinct from assignment_local_start_date then
      raise exception 'A started postpartum service cannot change its original start date';
    end if;
  end if;
  return new;
end;
$$;

-- Availability is a three-axis comparison: contract dates, recurring weekdays,
-- and daily care time. Adjacent shifts do not overlap because time intervals are
-- treated as half-open [start, end) ranges.
create or replace function public.caregiver_schedule_is_available(
  p_caregiver_id uuid,
  p_start_date date,
  p_end_date date,
  p_daily_start_time time,
  p_daily_end_time time,
  p_service_days text[],
  p_excluded_assignment_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_start_date is null
     or p_end_date is null
     or p_end_date < p_start_date
     or p_daily_start_time is null
     or p_daily_end_time is null
     or p_daily_end_time <= p_daily_start_time
     or coalesce(cardinality(p_service_days), 0) = 0 then
    return false;
  end if;

  return not exists (
    select 1
    from public.care_assignments existing_assignment
    where existing_assignment.caregiver_id = p_caregiver_id
      and existing_assignment.status in ('PROPOSED', 'CONFIRMED')
      and (
        p_excluded_assignment_id is null
        or existing_assignment.id <> p_excluded_assignment_id
      )
      and daterange(
            (existing_assignment.starts_at at time zone 'America/New_York')::date,
            (existing_assignment.ends_at at time zone 'America/New_York')::date,
            '[]'
          ) && daterange(p_start_date, p_end_date, '[]')
      and coalesce(
            existing_assignment.daily_start_time,
            (existing_assignment.starts_at at time zone 'America/New_York')::time
          ) < p_daily_end_time
      and p_daily_start_time < coalesce(
            existing_assignment.daily_end_time,
            (existing_assignment.ends_at at time zone 'America/New_York')::time
          )
      and exists (
        select 1
        from generate_series(
          greatest(
            p_start_date,
            (existing_assignment.starts_at at time zone 'America/New_York')::date
          )::timestamp,
          least(
            p_end_date,
            (existing_assignment.ends_at at time zone 'America/New_York')::date
          )::timestamp,
          interval '1 day'
        ) as overlap_day
        where public.service_weekday_matches(overlap_day::date, p_service_days)
          and public.service_weekday_matches(
            overlap_day::date,
            existing_assignment.service_days
          )
      )
  );
end;
$$;

-- Schedule an approved request using recurrence-aware caregiver availability.
create or replace function public.schedule_approved_client_request(
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
  requested_start timestamptz;
  requested_end timestamptz;
  requested_end_date date;
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can schedule client requests';
  end if;

  select * into request_row
  from public.client_service_requests
  where id = p_request_id
    and status = 'APPROVED'
    and approved_assignment_id is null
  for update;

  if not found then
    raise exception 'Approved unscheduled client request not found';
  end if;

  if exists (
    select 1
    from public.service_adjustment_requests pending_adjustment
    where pending_adjustment.client_service_request_id = request_row.id
      and pending_adjustment.status = 'PENDING'
  ) then
    raise exception 'This service has a pending change or cancellation request';
  end if;

  if not exists (
    select 1
    from public.caregivers
    where id = p_caregiver_id and status = 'ACTIVE'
  ) then
    raise exception 'Selected caregiver is not active';
  end if;

  requested_end_date := request_row.desired_start_date
    + (request_row.requested_weeks * 7 - 1);
  requested_start := (
    request_row.desired_start_date + request_row.daily_start_time
  ) at time zone 'America/New_York';
  requested_end := (
    requested_end_date + request_row.daily_end_time
  ) at time zone 'America/New_York';

  if requested_start <= now() then
    raise exception 'An elapsed approved request cannot be scheduled';
  end if;
  if request_row.request_kind = 'EXTENSION'
     and request_row.service_type <> 'BABYSITTING' then
    raise exception 'Only babysitting requests can be extended';
  end if;

  if not public.caregiver_schedule_is_available(
    p_caregiver_id,
    request_row.desired_start_date,
    requested_end_date,
    request_row.daily_start_time,
    request_row.daily_end_time,
    request_row.requested_days,
    null
  ) then
    raise exception 'The selected caregiver has an overlapping service-day schedule';
  end if;

  insert into public.care_contracts (
    client_id, baby_id, start_date, end_date, agreed_rate, status, created_by
  ) values (
    request_row.client_id, request_row.baby_id, request_row.desired_start_date,
    requested_end_date, request_row.estimated_total, 'ACTIVE', auth.uid()
  ) returning id into created_contract_id;

  insert into public.care_assignments (
    contract_id, caregiver_id, starts_at, ends_at, status, assigned_by,
    service_address, daily_start_time, daily_end_time, household_extra_people,
    allergy_notes, client_request_note, contract_weeks, service_type, service_days,
    maternal_notes, meal_instructions, routine_notes, pickup_notes, weekly_rate,
    contract_value, deposit_amount, deposit_status, deposit_paid_at, updated_by
  ) values (
    created_contract_id, p_caregiver_id, requested_start, requested_end,
    'CONFIRMED', auth.uid(), request_row.service_address,
    request_row.daily_start_time, request_row.daily_end_time,
    request_row.household_extra_people, request_row.allergy_notes,
    request_row.special_notes, request_row.requested_weeks,
    request_row.service_type, request_row.requested_days,
    request_row.maternal_notes, request_row.meal_instructions,
    request_row.routine_notes, request_row.pickup_notes,
    request_row.weekly_rate, request_row.estimated_total,
    request_row.deposit_amount, request_row.deposit_status,
    request_row.deposit_paid_at, auth.uid()
  ) returning id into created_assignment_id;

  update public.client_service_requests
  set approved_assignment_id = created_assignment_id,
      updated_at = now()
  where id = p_request_id;

  return created_assignment_id;
end;
$$;

-- Caregivers may start a session only on one of the assignment's recurring
-- service days in the business timezone. Care staff retains an override for
-- corrections. A caregiver may complete only a session they started.
create or replace function public.set_care_session_status(
  p_assignment_id uuid,
  p_status public.session_status
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session_id uuid;
  target_assignment public.care_assignments%rowtype;
  assigned_caregiver_user_id uuid;
  assigned_caregiver_status text;
  assigned_profile_status text;
  assigned_profile_deleted_at timestamptz;
  local_today date := (now() at time zone 'America/New_York')::date;
  local_now timestamp := now() at time zone 'America/New_York';
begin
  if auth.uid() is null
     or not public.current_user_is_active_caregiver()
     or p_status not in ('IN_PROGRESS', 'COMPLETED') then
    raise exception 'An authenticated caregiver may only start or complete care';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment-session:' || p_assignment_id::text, 0)
  );

  select caregiver.user_id into assigned_caregiver_user_id
  from public.care_assignments assignment
  join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
  where assignment.id = p_assignment_id;

  if assigned_caregiver_user_id is null then
    raise exception 'Care assignment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || assigned_caregiver_user_id::text, 0)
  );

  select assignment.* into target_assignment
  from public.care_assignments assignment
  where assignment.id = p_assignment_id
  for update;

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

  if p_status = 'IN_PROGRESS' then
    perform pg_advisory_xact_lock(
      hashtextextended('company-compliance-scheduling', 0)
    );
    if not public.company_care_compliance_is_current() then
      raise exception 'Current liability, workers compensation, and W-2 evidence must be verified before care starts';
    end if;

    if local_today not between
         (target_assignment.starts_at at time zone 'America/New_York')::date
         and (target_assignment.ends_at at time zone 'America/New_York')::date
       or not public.service_weekday_matches(local_today, target_assignment.service_days) then
      raise exception 'Care may start only on a configured service day';
    end if;

    if local_now < (
         local_today
         + coalesce(target_assignment.daily_start_time,
             (target_assignment.starts_at at time zone 'America/New_York')::time)
         - interval '30 minutes'
       )
       or local_now > (
         local_today
         + coalesce(target_assignment.daily_end_time,
             (target_assignment.ends_at at time zone 'America/New_York')::time)
       ) then
      raise exception 'Care may start from 30 minutes before the scheduled start until the scheduled end';
    end if;

    if (
      select count(distinct shift_check.check_key)
      from public.care_shift_checks shift_check
      where shift_check.assignment_id = p_assignment_id
        and shift_check.service_date = local_today
        and shift_check.checked
        and shift_check.checked_by = auth.uid()
        and shift_check.check_key in ('arrival', 'safety', 'request', 'scope')
    ) <> 4 then
      raise exception 'Complete all four safety checks before starting care';
    end if;

    if exists (
      select 1 from public.care_sessions session
      where session.assignment_id = p_assignment_id
        and session.service_date = local_today
        and session.status in ('COMPLETED', 'CANCELLED')
    ) then
      raise exception 'A completed or cancelled care session cannot be restarted';
    end if;

    if exists (
      select 1 from public.care_sessions session
      where session.started_by = auth.uid()
        and (session.assignment_id <> p_assignment_id or session.service_date <> local_today)
        and session.status = 'IN_PROGRESS'
    ) then
      raise exception 'Complete the open care session before starting another';
    end if;
  end if;

  if p_status = 'COMPLETED' then
    select session.id
    into target_session_id
    from public.care_sessions session
    where session.assignment_id = p_assignment_id
      and session.status = 'IN_PROGRESS'
      and session.started_by = auth.uid()
    order by session.started_at desc nulls last, session.service_date desc
    limit 1
    for update;

    if target_session_id is null then
      raise exception 'Only the person who started an open care session may complete it';
    end if;

    update public.care_sessions
    set status = 'COMPLETED',
        ended_at = now(),
        updated_at = now()
    where id = target_session_id;

    return target_session_id;
  end if;

  insert into public.care_sessions (
    assignment_id, service_date, status, started_at, started_by
  )
  values (
    p_assignment_id,
    local_today,
    p_status,
    case when p_status = 'IN_PROGRESS' then now() else null end,
    case when p_status = 'IN_PROGRESS' then auth.uid() else null end
  )
  on conflict (assignment_id, service_date) do update set
    status = excluded.status,
    started_at = case
      when excluded.status = 'IN_PROGRESS'
        then coalesce(public.care_sessions.started_at, now())
      else public.care_sessions.started_at
    end,
    ended_at = case
      when excluded.status = 'COMPLETED' then now()
      when excluded.status = 'IN_PROGRESS' then null
      else public.care_sessions.ended_at
    end,
    started_by = case
      when excluded.status = 'IN_PROGRESS'
        then coalesce(public.care_sessions.started_by, excluded.started_by)
      else public.care_sessions.started_by
    end,
    updated_at = now()
  returning id into target_session_id;

  return target_session_id;
end;
$$;

-- A service request can be approved only when a captured deposit transaction is
-- recorded in the same database transaction. Retries with the same request and
-- payment evidence return the already-approved row without double-capturing.
create or replace function public.review_service_request_with_deposit(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text default null,
  p_payment_method text default null,
  p_payment_reference text default null
)
returns public.client_service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  required_deposit numeric(10,2);
  normalized_payment_method text := upper(trim(coalesce(p_payment_method, '')));
  normalized_payment_reference text := trim(coalesce(p_payment_reference, ''));
  derived_idempotency_key text;
  existing_transaction public.deposit_transactions%rowtype;
  normalized_days text[];
  daily_duration interval;
  recalculated_total numeric(10,2);
  requester_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only authorized administrators can review service requests';
  end if;
  if p_approve is null then
    raise exception 'An explicit approval decision is required';
  end if;

  select requested_by into requester_user_id
  from public.client_service_requests
  where id = p_request_id;

  if not found then
    raise exception 'Service request not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || requester_user_id::text, 0)
  );

  select * into request_row
  from public.client_service_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found';
  end if;

  required_deposit := case request_row.service_type
    when 'POSTPARTUM' then 500.00
    when 'BABYSITTING' then 128.00
    else null
  end;

  if required_deposit is null then
    raise exception 'The service has no configured reservation deposit';
  end if;

  if p_approve then
    if not exists (
      select 1
      from public.client_members member
      join public.profiles profile on profile.id = member.user_id
      join public.user_roles role
        on role.user_id = member.user_id and role.role = 'CLIENT'
      where member.client_id = request_row.client_id
        and member.user_id = request_row.requested_by
        and profile.account_status = 'ACTIVE'
        and profile.deleted_at is null
    ) then
      raise exception 'The requesting client account is no longer active';
    end if;
    if length(trim(coalesce(request_row.service_address, ''))) not between 5 and 500
       or coalesce(request_row.household_extra_people, -1) not between 0 and 30 then
      raise exception 'The request must contain a valid service address and household count';
    end if;
    if request_row.baby_id is null or not exists (
      select 1
      from public.babies baby
      where baby.id = request_row.baby_id
        and baby.client_id = request_row.client_id
    ) then
      raise exception 'The request must identify a baby belonging to the client before payment';
    end if;
    if request_row.sequence_policy_accepted is distinct from true
       or request_row.insured_staffing_acknowledged is distinct from true then
      raise exception 'The request is missing its required service consent';
    end if;
    if request_row.request_kind = 'EXTENSION'
       and request_row.service_type <> 'BABYSITTING' then
      raise exception 'Only babysitting requests can be extended';
    end if;
    if (
      (request_row.desired_start_date + request_row.daily_start_time)
        at time zone 'America/New_York'
    ) <= now() then
      raise exception 'An elapsed service request cannot be approved or charged';
    end if;
    if request_row.requested_weeks not in (2, 3, 4) then
      raise exception 'Service duration must be two, three, or four weeks';
    end if;
    if coalesce(cardinality(request_row.requested_days), 0) not between 1 and 7
       or exists (
         select 1
         from unnest(request_row.requested_days) requested_day
         where requested_day is null
           or trim(requested_day) = ''
           or upper(trim(requested_day)) not in (
             '월', '화', '수', '목', '금', '토', '일',
             'MON', 'MONDAY', 'TUE', 'TUESDAY', 'WED', 'WEDNESDAY',
             'THU', 'THURSDAY', 'FRI', 'FRIDAY', 'SAT', 'SATURDAY',
             'SUN', 'SUNDAY', '1', '2', '3', '4', '5', '6', '7'
           )
       ) then
      raise exception 'The request contains unsupported recurring service days';
    end if;

    normalized_days := public.canonical_service_days(request_row.requested_days);
    if cardinality(normalized_days) = 0 then
      raise exception 'At least one recurring service day is required';
    end if;

    daily_duration := request_row.daily_end_time - request_row.daily_start_time;
    if request_row.service_type = 'POSTPARTUM' then
      if request_row.daily_start_time > time '14:29'
         or daily_duration <> interval '9 hours 30 minutes' then
        raise exception 'Postpartum care requires an 8-hour care day plus fixed meal and rest breaks';
      end if;
      recalculated_total := 1800.00 * request_row.requested_weeks;
    elsif request_row.service_type = 'BABYSITTING' then
      if request_row.daily_start_time > time '19:45'
         or daily_duration not between interval '4 hours' and interval '12 hours' then
        raise exception 'Babysitting requires between four and twelve same-day care hours';
      end if;
      recalculated_total := round(
        (extract(epoch from daily_duration) / 3600.0)
          * 32.00 * cardinality(normalized_days) * request_row.requested_weeks,
        2
      );
    else
      raise exception 'Unsupported service type';
    end if;
  end if;

  -- A network retry after a committed approval is safe and returns the same
  -- result only when the supplied evidence matches the captured transaction.
  if request_row.status = 'APPROVED' and p_approve then
    select deposit_row.* into existing_transaction
    from public.deposit_transactions deposit_row
    where deposit_row.client_service_request_id = request_row.id
      and deposit_row.status = 'CAPTURED'
    order by deposit_row.created_at
    limit 1;

    if found
       and existing_transaction.amount = required_deposit
       and existing_transaction.currency = 'USD'
       and existing_transaction.payment_method = normalized_payment_method
       and existing_transaction.external_reference = normalized_payment_reference then
      return request_row;
    end if;

    raise exception 'This request was approved with different payment evidence';
  end if;

  if request_row.status <> 'PENDING' then
    raise exception 'Only a pending service request can be reviewed';
  end if;

  if p_approve then
    if length(normalized_payment_method) not between 2 and 40 then
      raise exception 'A valid payment method is required for approval';
    end if;
    if length(normalized_payment_reference) not between 3 and 255 then
      raise exception 'A valid payment reference is required for approval';
    end if;

    derived_idempotency_key := 'service-deposit:' || request_row.id::text;

    insert into public.deposit_transactions (
      client_service_request_id,
      client_id,
      amount,
      currency,
      status,
      payment_method,
      external_reference,
      idempotency_key,
      recorded_by,
      captured_at
    ) values (
      request_row.id,
      request_row.client_id,
      required_deposit,
      'USD',
      'CAPTURED',
      normalized_payment_method,
      normalized_payment_reference,
      derived_idempotency_key,
      auth.uid(),
      now()
    )
    on conflict (idempotency_key) do nothing;

    select deposit_row.* into existing_transaction
    from public.deposit_transactions deposit_row
    where deposit_row.idempotency_key = derived_idempotency_key
    for update;

    if not found
       or existing_transaction.client_service_request_id <> request_row.id
       or existing_transaction.client_id <> request_row.client_id
       or existing_transaction.amount <> required_deposit
       or existing_transaction.currency <> 'USD'
       or existing_transaction.status <> 'CAPTURED'
       or existing_transaction.payment_method <> normalized_payment_method
       or existing_transaction.external_reference <> normalized_payment_reference then
      raise exception 'Deposit evidence does not match this service request';
    end if;

    update public.client_service_requests
    set status = 'APPROVED'::public.client_request_status,
        requested_days = normalized_days,
        weekly_rate = case when request_row.service_type = 'POSTPARTUM' then 1800.00 else null end,
        estimated_total = recalculated_total,
        deposit_amount = required_deposit,
        deposit_status = 'PAID',
        deposit_paid_at = existing_transaction.captured_at,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = nullif(trim(p_review_note), ''),
        updated_at = now()
    where id = request_row.id
    returning * into request_row;

    update public.clients
    set status = 'ACTIVE', updated_at = now()
    where id = request_row.client_id;

    insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(), 'APPROVE_SERVICE_REQUEST_WITH_DEPOSIT',
      'client_service_requests', request_row.id,
      jsonb_build_object(
        'service_type', request_row.service_type,
        'deposit_transaction_id', existing_transaction.id,
        'amount', existing_transaction.amount,
        'currency', existing_transaction.currency,
        'payment_method', existing_transaction.payment_method
      )
    );
  else
    if length(trim(coalesce(p_review_note, ''))) < 3 then
      raise exception 'A rejection reason is required';
    end if;
    if normalized_payment_method <> '' or normalized_payment_reference <> '' then
      raise exception 'Payment evidence must not be supplied when rejecting a request';
    end if;
    if exists (
      select 1
      from public.deposit_transactions deposit_row
      where deposit_row.client_service_request_id = request_row.id
    ) then
      raise exception 'A request with a deposit transaction cannot be rejected';
    end if;

    update public.client_service_requests
    set status = 'REJECTED'::public.client_request_status,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = trim(p_review_note),
        updated_at = now()
    where id = request_row.id
    returning * into request_row;

    insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(), 'REJECT_SERVICE_REQUEST',
      'client_service_requests', request_row.id,
      jsonb_build_object('service_type', request_row.service_type)
    );
  end if;

  return request_row;
exception
  when unique_violation then
    raise exception 'This payment reference has already been recorded';
end;
$$;

-- Create a customer change/cancellation request from authoritative database
-- records. The caller supplies only the target, requested schedule, and reason;
-- ownership, policy, deposit, contract value, and settlement are server-derived.
create or replace function public.submit_service_adjustment(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text,
  p_proposed_start_date date default null,
  p_proposed_daily_start_time time default null,
  p_proposed_daily_end_time time default null,
  p_proposed_weeks integer default null
)
returns public.service_adjustment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_target_type text := upper(trim(coalesce(p_target_type, '')));
  normalized_action text := upper(trim(coalesce(p_action, '')));
  request_row public.client_service_requests%rowtype;
  assignment_row public.care_assignments%rowtype;
  contract_row public.care_contracts%rowtype;
  target_client_id uuid;
  target_service_type public.care_service_type;
  target_request_id uuid;
  target_assignment_id uuid;
  related_request_id uuid;
  effective_start_at timestamptz;
  effective_contract_start_at timestamptz;
  effective_start_date date;
  effective_end_date date;
  effective_daily_start_time time;
  effective_daily_end_time time;
  effective_service_days text[];
  effective_deposit_amount numeric(10,2);
  effective_contract_value numeric(10,2);
  effective_assignment_started boolean := false;
  local_now timestamp := now() at time zone 'America/New_York';
  remaining_count_start date;
  remaining_care_days integer;
  cancellation_settlement numeric(10,2);
  derived_policy_code text;
  derived_policy_snapshot jsonb;
  proposed_end_date date;
  has_assignment_history boolean := false;
  latest_session_service_date date;
  created_adjustment public.service_adjustment_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || auth.uid()::text, 0)
  );
  if normalized_target_type not in ('REQUEST', 'ASSIGNMENT') then
    raise exception 'Adjustment target type must be REQUEST or ASSIGNMENT';
  end if;
  if normalized_action not in ('CHANGE', 'CANCEL') then
    raise exception 'Adjustment action must be CHANGE or CANCEL';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please provide a specific adjustment reason';
  end if;

  if normalized_target_type = 'REQUEST' then
    select * into request_row
    from public.client_service_requests
    where id = p_target_id
    for update;

    if not found or not public.is_client_member(request_row.client_id) then
      raise exception 'Service request not found or not accessible';
    end if;
    if request_row.status <> 'APPROVED' then
      raise exception 'Only an approved service request can be adjusted';
    end if;
    if request_row.approved_assignment_id is not null then
      raise exception 'A scheduled service must be adjusted through its assignment';
    end if;

    target_client_id := request_row.client_id;
    target_service_type := request_row.service_type;
    target_request_id := request_row.id;
    related_request_id := request_row.id;
    effective_start_date := request_row.desired_start_date;
    effective_end_date := request_row.desired_start_date
      + (request_row.requested_weeks * 7 - 1);
    effective_daily_start_time := request_row.daily_start_time;
    effective_daily_end_time := request_row.daily_end_time;
    effective_service_days := request_row.requested_days;
    effective_start_at := (
      effective_start_date + effective_daily_start_time
    ) at time zone 'America/New_York';
    effective_deposit_amount := request_row.deposit_amount;
    effective_contract_value := request_row.estimated_total;
  else
    perform pg_advisory_xact_lock(
      hashtextextended('assignment-session:' || p_target_id::text, 0)
    );

    select assignment.* into assignment_row
    from public.care_assignments assignment
    where assignment.id = p_target_id
    for update;

    if not found then
      raise exception 'Care assignment not found or not accessible';
    end if;

    select contract.* into contract_row
    from public.care_contracts contract
    where contract.id = assignment_row.contract_id
    for update;

    if not found or not public.is_client_member(contract_row.client_id) then
      raise exception 'Care assignment not found or not accessible';
    end if;
    if assignment_row.status not in ('PROPOSED', 'CONFIRMED')
       or contract_row.status not in ('PENDING', 'ACTIVE', 'PAUSED') then
      raise exception 'The related care contract cannot be adjusted';
    end if;

    target_client_id := contract_row.client_id;
    target_service_type := assignment_row.service_type;
    target_assignment_id := assignment_row.id;
    effective_start_at := assignment_row.starts_at;
    effective_start_date := (
      assignment_row.starts_at at time zone 'America/New_York'
    )::date;
    effective_end_date := (
      assignment_row.ends_at at time zone 'America/New_York'
    )::date;
    effective_daily_start_time := coalesce(
      assignment_row.daily_start_time,
      (assignment_row.starts_at at time zone 'America/New_York')::time
    );
    effective_daily_end_time := coalesce(
      assignment_row.daily_end_time,
      (assignment_row.ends_at at time zone 'America/New_York')::time
    );
    effective_contract_start_at := (
      contract_row.start_date + effective_daily_start_time
    ) at time zone 'America/New_York';
    effective_service_days := assignment_row.service_days;
    effective_deposit_amount := assignment_row.deposit_amount;
    effective_contract_value := coalesce(
      assignment_row.contract_value,
      contract_row.agreed_rate,
      assignment_row.weekly_rate * assignment_row.contract_weeks
    );
    effective_assignment_started := (
      (contract_row.start_date + effective_daily_start_time)
        at time zone 'America/New_York'
    ) <= now();

    select exists (
      select 1 from public.care_sessions session
      join public.care_assignments history_assignment
        on history_assignment.id = session.assignment_id
      where history_assignment.contract_id = assignment_row.contract_id
        and (
          session.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')
          or session.started_at is not null
          or exists (select 1 from public.care_events event where event.care_session_id = session.id)
          or exists (select 1 from public.care_reports report where report.care_session_id = session.id)
        )
    ), max(session.service_date) filter (where
      session.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')
      or session.started_at is not null
      or exists (select 1 from public.care_events event where event.care_session_id = session.id)
      or exists (select 1 from public.care_reports report where report.care_session_id = session.id)
    )
    into has_assignment_history, latest_session_service_date
    from public.care_sessions session
    join public.care_assignments history_assignment
      on history_assignment.id = session.assignment_id
    where history_assignment.contract_id = assignment_row.contract_id;

    select request.id into related_request_id
    from public.client_service_requests request
    where request.approved_assignment_id = assignment_row.id
    order by request.created_at desc
    limit 1
    for update;
  end if;

  if not public.is_client_member(target_client_id) then
    raise exception 'You do not own this client service';
  end if;

  if exists (
    select 1
    from public.service_adjustment_requests pending_adjustment
    where pending_adjustment.status = 'PENDING'
      and (
        (target_request_id is not null
          and pending_adjustment.client_service_request_id = target_request_id)
        or
        (target_assignment_id is not null
          and pending_adjustment.care_assignment_id = target_assignment_id)
        or
        (related_request_id is not null
          and pending_adjustment.client_service_request_id = related_request_id)
      )
  ) then
    raise exception 'A pending adjustment already exists for this service';
  end if;

  if normalized_action = 'CHANGE' then
    if p_proposed_start_date is null
       or p_proposed_daily_start_time is null
       or p_proposed_daily_end_time is null
       or p_proposed_weeks is null then
      raise exception 'A schedule change requires a start date, daily time, and duration';
    end if;
    if p_proposed_weeks not in (2, 3, 4) then
      raise exception 'Service duration must be two, three, or four weeks';
    end if;
    if p_proposed_daily_end_time <= p_proposed_daily_start_time then
      raise exception 'Daily end time must be after daily start time';
    end if;
    if coalesce(cardinality(effective_service_days), 0) = 0 then
      raise exception 'The service has no configured care days';
    end if;

    if target_service_type = 'POSTPARTUM' then
      if p_proposed_daily_start_time > time '14:29'
         or p_proposed_daily_end_time - p_proposed_daily_start_time
            <> interval '9 hours 30 minutes' then
        raise exception 'Postpartum care requires an 8-hour care day plus fixed meal and rest breaks';
      end if;
      if effective_assignment_started
         and p_proposed_start_date is distinct from effective_start_date then
        raise exception 'A started postpartum service cannot change its original start date';
      end if;
    elsif p_proposed_daily_start_time > time '19:45'
       or p_proposed_daily_end_time - p_proposed_daily_start_time
          not between interval '4 hours' and interval '12 hours' then
      raise exception 'Babysitting requires between four and twelve same-day care hours';
    end if;

    if not effective_assignment_started
       and (
         (p_proposed_start_date + p_proposed_daily_start_time)
           at time zone 'America/New_York'
       ) < now() then
      raise exception 'A future service cannot be changed to a past start time';
    end if;

    proposed_end_date := case
      when has_assignment_history and target_assignment_id is not null
        then contract_row.start_date + (p_proposed_weeks * 7 - 1)
      else p_proposed_start_date + (p_proposed_weeks * 7 - 1)
    end;

    if has_assignment_history and (
      p_proposed_start_date is distinct from effective_start_date
      or p_proposed_daily_start_time is distinct from effective_daily_start_time
      or p_proposed_daily_end_time is distinct from effective_daily_end_time
    ) then
      raise exception 'A service with care-session history cannot change its start date or daily times';
    end if;

    if has_assignment_history
       and proposed_end_date
         < greatest(latest_session_service_date, local_now::date, effective_start_date) then
      raise exception 'A changed service period cannot exclude an existing care-session date';
    end if;

    if effective_assignment_started and proposed_end_date < local_now::date then
      raise exception 'A started service cannot be shortened to an already elapsed end date';
    end if;

    if target_assignment_id is not null and not public.caregiver_schedule_is_available(
      assignment_row.caregiver_id,
      p_proposed_start_date,
      proposed_end_date,
      p_proposed_daily_start_time,
      p_proposed_daily_end_time,
      effective_service_days,
      target_assignment_id
    ) then
      raise exception 'The assigned caregiver has an overlapping service-day schedule';
    end if;

    derived_policy_code := 'SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY';
    derived_policy_snapshot := jsonb_build_object(
      'version', '2026-09-11',
      'timezone', 'America/New_York',
      'evaluated_at', now(),
      'action', normalized_action,
      'deposit_amount', effective_deposit_amount,
      'deposit_disposition', 'UNCHANGED',
      'original_start_date', effective_start_date,
      'proposed_start_date', p_proposed_start_date,
      'proposed_end_date', proposed_end_date,
      'proposed_daily_start_time', p_proposed_daily_start_time,
      'proposed_daily_end_time', p_proposed_daily_end_time,
      'proposed_weeks', p_proposed_weeks,
      'service_days', effective_service_days
    );
  else
    if effective_deposit_amount is null or effective_deposit_amount <= 0 then
      raise exception 'The approved service is missing its reservation deposit';
    end if;

    if target_service_type = 'POSTPARTUM' and effective_assignment_started then
      if effective_contract_value is null or effective_contract_value <= 0 then
        raise exception 'The postpartum assignment is missing its original contract value';
      end if;

      derived_policy_code := 'POSTPARTUM_ACTIVE_PRORATED';
      remaining_count_start := case
        when local_now::time >= effective_daily_end_time then local_now::date + 1
        else local_now::date
      end;

      select count(*)::integer into remaining_care_days
      from generate_series(
        greatest(remaining_count_start, effective_start_date)::timestamp,
        effective_end_date::timestamp,
        interval '1 day'
      ) as remaining_day
      where public.service_weekday_matches(
        remaining_day::date,
        effective_service_days
      )
        and not exists (
          select 1 from public.care_sessions session
          where session.assignment_id = target_assignment_id
            and session.service_date = remaining_day::date
            and session.status in ('COMPLETED', 'CANCELLED')
        );

      if coalesce(remaining_care_days, 0) < 1 then
        raise exception 'No remaining postpartum care days are available to cancel';
      end if;

      cancellation_settlement := round(
        greatest(
          coalesce(effective_contract_value, 0)
            - coalesce(effective_deposit_amount, 0),
          0
        ) / remaining_care_days,
        2
      );
    elsif target_service_type = 'POSTPARTUM' then
      if coalesce(effective_contract_start_at, effective_start_at) - now()
           > interval '30 days' then
        derived_policy_code := 'DEPOSIT_REFUNDABLE';
      else
        derived_policy_code := 'DEPOSIT_NON_REFUNDABLE';
      end if;
    else
      if coalesce(effective_contract_start_at, effective_start_at) - now()
           > interval '72 hours' then
        derived_policy_code := 'BABYSITTING_DEPOSIT_REFUNDABLE';
      else
        derived_policy_code := 'BABYSITTING_DEPOSIT_NON_REFUNDABLE';
      end if;
    end if;

    derived_policy_snapshot := jsonb_build_object(
      'version', '2026-09-11',
      'timezone', 'America/New_York',
      'evaluated_at', now(),
      'action', normalized_action,
      'service_start_at', coalesce(effective_contract_start_at, effective_start_at),
      'service_end_date', effective_end_date,
      'service_days', effective_service_days,
      'deposit_amount', effective_deposit_amount,
      'deposit_refundable', derived_policy_code in (
        'DEPOSIT_REFUNDABLE', 'BABYSITTING_DEPOSIT_REFUNDABLE'
      ),
      'notice_seconds', greatest(
        extract(epoch from (
          coalesce(effective_contract_start_at, effective_start_at) - now()
        ))::bigint,
        0
      ),
      'original_contract_value', effective_contract_value,
      'remaining_care_days', remaining_care_days,
      'cancellation_settlement_amount', cancellation_settlement,
      'cancellation_formula', case
        when derived_policy_code = 'POSTPARTUM_ACTIVE_PRORATED'
          then '(original_contract_value - deposit_amount) / remaining_care_days'
        else null
      end
    );
  end if;

  insert into public.service_adjustment_requests (
    client_id,
    requested_by,
    service_type,
    client_service_request_id,
    care_assignment_id,
    action,
    proposed_start_date,
    proposed_daily_start_time,
    proposed_daily_end_time,
    proposed_weeks,
    reason,
    policy_code,
    policy_snapshot,
    original_contract_value,
    remaining_care_days,
    cancellation_settlement_amount,
    cancellation_formula,
    status
  ) values (
    target_client_id,
    auth.uid(),
    target_service_type,
    target_request_id,
    target_assignment_id,
    normalized_action,
    case when normalized_action = 'CHANGE' then p_proposed_start_date else null end,
    case when normalized_action = 'CHANGE' then p_proposed_daily_start_time else null end,
    case when normalized_action = 'CHANGE' then p_proposed_daily_end_time else null end,
    case when normalized_action = 'CHANGE' then p_proposed_weeks else null end,
    trim(p_reason),
    derived_policy_code,
    derived_policy_snapshot,
    effective_contract_value,
    remaining_care_days,
    cancellation_settlement,
    case
      when derived_policy_code = 'POSTPARTUM_ACTIVE_PRORATED'
        then '(original_contract_value - deposit_amount) / remaining_care_days'
      else null
    end,
    'PENDING'
  )
  returning * into created_adjustment;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'SUBMIT_SERVICE_ADJUSTMENT',
    'service_adjustment_requests', created_adjustment.id,
    jsonb_build_object(
      'action', created_adjustment.action,
      'policy_code', created_adjustment.policy_code,
      'target_type', normalized_target_type,
      'target_id', p_target_id
    )
  );

  return created_adjustment;
exception
  when unique_violation then
    raise exception 'A pending adjustment already exists for this service';
end;
$$;

-- Atomically approve/reject a customer change or cancellation. Policy outcomes
-- are recalculated from authoritative service records instead of trusting the
-- request-time policy snapshot supplied by the browser.
create or replace function public.review_service_adjustment(
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
  effective_assignment_id uuid;
  linked_request_id uuid;
  effective_start_at timestamptz;
  effective_contract_start_at timestamptz;
  effective_start_date date;
  effective_end_date date;
  replacement_start_date date;
  replacement_end_date date;
  replacement_start_at timestamptz;
  replacement_end_at timestamptz;
  replacement_contract_value numeric(10,2);
  computed_policy_code text;
  computed_deposit_status text;
  computed_contract_value numeric(10,2);
  computed_deposit_amount numeric(10,2);
  computed_remaining_days integer;
  computed_settlement numeric(10,2);
  assignment_caregiver_user_id uuid;
  has_assignment_history boolean := false;
  latest_session_service_date date;
  local_today date := (now() at time zone 'America/New_York')::date;
  local_now timestamp := now() at time zone 'America/New_York';
  policy_evaluation_at timestamptz;
  requester_user_id uuid;
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can review service adjustments';
  end if;
  if p_approve is null then
    raise exception 'An explicit approval decision is required';
  end if;

  select adjustment.requested_by into requester_user_id
  from public.service_adjustment_requests adjustment
  where adjustment.id = p_adjustment_id
    and adjustment.status = 'PENDING';

  if not found then
    raise exception 'Pending service adjustment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || requester_user_id::text, 0)
  );

  select * into adjustment_row
  from public.service_adjustment_requests
  where id = p_adjustment_id and status = 'PENDING'
  for update;

  if not found then
    raise exception 'Pending service adjustment not found';
  end if;

  -- Cancellation eligibility belongs to the customer request instant. An
  -- administrator reviewing later must not move a request across the 30-day or
  -- 72-hour cutoff, or turn a pre-service cancellation into an active-service
  -- cancellation. Operational remaining-day calculations still use the actual
  -- review time and completed/cancelled sessions below.
  policy_evaluation_at := adjustment_row.created_at;

  if not p_approve then
    update public.service_adjustment_requests
    set status = 'REJECTED',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = nullif(trim(p_review_note), ''),
        updated_at = now()
    where id = p_adjustment_id
    returning * into adjustment_row;

    insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(), 'REJECT_SERVICE_ADJUSTMENT',
      'service_adjustment_requests', p_adjustment_id,
      jsonb_build_object('action', adjustment_row.action)
    );

    return adjustment_row;
  end if;

  if adjustment_row.client_service_request_id is not null then
    select * into request_row
    from public.client_service_requests
    where id = adjustment_row.client_service_request_id
    for update;

    if not found
       or request_row.client_id <> adjustment_row.client_id
       or request_row.service_type <> adjustment_row.service_type then
      raise exception 'Adjustment target does not match the service request';
    end if;
    if request_row.status <> 'APPROVED' then
      raise exception 'Only an approved service request can be adjusted';
    end if;

    effective_assignment_id := request_row.approved_assignment_id;
    linked_request_id := request_row.id;
    effective_start_date := request_row.desired_start_date;
    effective_end_date := request_row.desired_start_date
      + (request_row.requested_weeks * 7 - 1);
    effective_start_at := (
      request_row.desired_start_date + request_row.daily_start_time
    ) at time zone 'America/New_York';
    computed_contract_value := request_row.estimated_total;
    computed_deposit_amount := request_row.deposit_amount;
  else
    effective_assignment_id := adjustment_row.care_assignment_id;
  end if;

  if effective_assignment_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('assignment-session:' || effective_assignment_id::text, 0)
    );

    select caregiver.user_id into assignment_caregiver_user_id
    from public.care_assignments assignment
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where assignment.id = effective_assignment_id;

    if assignment_caregiver_user_id is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('care-session-starter:' || assignment_caregiver_user_id::text, 0)
      );
    end if;

    select assignment.* into assignment_row
    from public.care_assignments assignment
    where assignment.id = effective_assignment_id
    for update;

    if not found or assignment_row.service_type <> adjustment_row.service_type then
      raise exception 'Adjustment target does not match the care assignment';
    end if;
    if assignment_row.status in ('CANCELLED', 'COMPLETED') then
      raise exception 'This care assignment can no longer be adjusted';
    end if;

    select contract.* into contract_row
    from public.care_contracts contract
    where contract.id = assignment_row.contract_id
    for update;

    if not found or contract_row.client_id <> adjustment_row.client_id then
      raise exception 'Adjustment client does not match the care contract';
    end if;

    perform public.lock_care_schedule(
      assignment_row.caregiver_id,
      contract_row.baby_id,
      contract_row.client_id
    );

    if linked_request_id is null then
      select request.* into request_row
      from public.client_service_requests request
      where request.approved_assignment_id = assignment_row.id
      order by request.created_at desc
      limit 1
      for update;

      if found then
        linked_request_id := request_row.id;
      end if;
    end if;

    effective_start_at := assignment_row.starts_at;
    effective_start_date := (
      assignment_row.starts_at at time zone 'America/New_York'
    )::date;
    effective_end_date := (
      assignment_row.ends_at at time zone 'America/New_York'
    )::date;
    effective_contract_start_at := (
      contract_row.start_date
        + coalesce(
            assignment_row.daily_start_time,
            (assignment_row.starts_at at time zone 'America/New_York')::time
          )
    ) at time zone 'America/New_York';
    computed_contract_value := coalesce(
      assignment_row.contract_value,
      contract_row.agreed_rate,
      assignment_row.weekly_rate * assignment_row.contract_weeks
    );
    computed_deposit_amount := assignment_row.deposit_amount;

    select exists (
      select 1 from public.care_sessions session
      join public.care_assignments history_assignment
        on history_assignment.id = session.assignment_id
      where history_assignment.contract_id = assignment_row.contract_id
        and (
          session.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')
          or session.started_at is not null
          or exists (select 1 from public.care_events event where event.care_session_id = session.id)
          or exists (select 1 from public.care_reports report where report.care_session_id = session.id)
        )
    ), max(session.service_date) filter (where
      session.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')
      or session.started_at is not null
      or exists (select 1 from public.care_events event where event.care_session_id = session.id)
      or exists (select 1 from public.care_reports report where report.care_session_id = session.id)
    )
    into has_assignment_history, latest_session_service_date
    from public.care_sessions session
    join public.care_assignments history_assignment
      on history_assignment.id = session.assignment_id
    where history_assignment.contract_id = assignment_row.contract_id;
  end if;

  if adjustment_row.action = 'CHANGE' and effective_assignment_id is null then
    if request_row.baby_id is null then
      raise exception 'An unscheduled request change must identify the baby';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended('baby:' || request_row.baby_id::text, 0)
    );
  end if;

  if adjustment_row.action = 'CHANGE' then
    if not exists (
      select 1
      from public.client_members member
      join public.profiles profile on profile.id = member.user_id
      join public.user_roles role
        on role.user_id = member.user_id and role.role = 'CLIENT'
      where member.client_id = adjustment_row.client_id
        and member.user_id = adjustment_row.requested_by
        and profile.account_status = 'ACTIVE'
        and profile.deleted_at is null
    ) then
      raise exception 'The requesting client account is no longer active';
    end if;

    computed_policy_code := 'SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY';

    if effective_assignment_id is not null then
      if not exists (
        select 1
        from public.caregivers caregiver
        join public.profiles profile on profile.id = caregiver.user_id
        join public.user_roles role
          on role.user_id = caregiver.user_id and role.role = 'CAREGIVER'
        join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
        where caregiver.id = assignment_row.caregiver_id
          and caregiver.status = 'ACTIVE'
          and profile.account_status = 'ACTIVE'
          and profile.deleted_at is null
          and hr.employment_status = 'ACTIVE'
      ) then
        raise exception 'The assigned caregiver is no longer eligible for a schedule change';
      end if;

      perform pg_advisory_xact_lock(
        hashtextextended('company-compliance-scheduling', 0)
      );
      if not public.company_care_compliance_is_current() then
        raise exception 'Current liability, workers compensation, and W-2 evidence must be verified before changing a schedule';
      end if;

      replacement_start_date := adjustment_row.proposed_start_date;

      if adjustment_row.service_type = 'POSTPARTUM'
         and (effective_contract_start_at <= now() or has_assignment_history)
         and replacement_start_date is distinct from effective_start_date then
        raise exception 'A started postpartum service cannot change its original start date';
      end if;

      if adjustment_row.service_type = 'POSTPARTUM'
         and (effective_contract_start_at <= now() or has_assignment_history) then
        replacement_start_date := effective_start_date;
      end if;

      replacement_end_date := case
        when has_assignment_history
          then contract_row.start_date + (adjustment_row.proposed_weeks * 7 - 1)
        else replacement_start_date + (adjustment_row.proposed_weeks * 7 - 1)
      end;
      replacement_start_at := case
        when has_assignment_history then assignment_row.starts_at
        else (
          replacement_start_date + adjustment_row.proposed_daily_start_time
        ) at time zone 'America/New_York'
      end;
      replacement_end_at := (
        replacement_end_date + adjustment_row.proposed_daily_end_time
      ) at time zone 'America/New_York';

      if exists (
        select 1 from public.care_sessions session
        where session.assignment_id = assignment_row.id
          and session.status = 'IN_PROGRESS'
      ) then
        raise exception 'Complete or close the active care session before changing the schedule';
      end if;

      if has_assignment_history and (
        replacement_start_date is distinct from effective_start_date
        or adjustment_row.proposed_daily_start_time is distinct from assignment_row.daily_start_time
        or adjustment_row.proposed_daily_end_time is distinct from assignment_row.daily_end_time
      ) then
        raise exception 'A service with care-session history cannot change its start date or daily times';
      end if;

      if has_assignment_history
         and replacement_end_date
           < greatest(latest_session_service_date, local_today, effective_start_date) then
        raise exception 'A changed service period cannot exclude an existing care-session date';
      end if;

      if effective_start_at > now() and replacement_start_at <= now() then
        raise exception 'An unstarted service cannot be changed to a past start time';
      end if;
      replacement_contract_value := case
        when adjustment_row.service_type = 'POSTPARTUM'
          then assignment_row.weekly_rate * adjustment_row.proposed_weeks
        else round(
          (extract(epoch from (
            adjustment_row.proposed_daily_end_time
              - adjustment_row.proposed_daily_start_time
          )) / 3600.0)
            * 32.00
            * cardinality(assignment_row.service_days)
            * adjustment_row.proposed_weeks,
          2
        )
      end;

      if not public.caregiver_schedule_is_available(
        assignment_row.caregiver_id,
        replacement_start_date,
        replacement_end_date,
        adjustment_row.proposed_daily_start_time,
        adjustment_row.proposed_daily_end_time,
        assignment_row.service_days,
        assignment_row.id
      ) then
        raise exception 'The assigned caregiver has an overlapping service-day schedule';
      end if;

      update public.care_contracts
      set start_date = case
            when has_assignment_history then contract_row.start_date
            else replacement_start_date
          end,
          end_date = replacement_end_date,
          agreed_rate = replacement_contract_value,
          updated_at = now()
      where id = contract_row.id;

      update public.care_assignments
      set starts_at = replacement_start_at,
          ends_at = replacement_end_at,
          daily_start_time = adjustment_row.proposed_daily_start_time,
          daily_end_time = adjustment_row.proposed_daily_end_time,
          contract_weeks = adjustment_row.proposed_weeks,
          contract_value = replacement_contract_value,
          updated_by = auth.uid(),
          updated_at = now()
      where id = assignment_row.id;

      if linked_request_id is not null then
      update public.client_service_requests
        set desired_start_date = case
              when has_assignment_history then contract_row.start_date
              else replacement_start_date
            end,
            daily_start_time = adjustment_row.proposed_daily_start_time,
            daily_end_time = adjustment_row.proposed_daily_end_time,
            requested_weeks = adjustment_row.proposed_weeks,
            estimated_total = replacement_contract_value,
            updated_at = now()
        where id = linked_request_id;
      end if;
    else
      replacement_start_at := (
        adjustment_row.proposed_start_date
          + adjustment_row.proposed_daily_start_time
      ) at time zone 'America/New_York';

      if replacement_start_at <= now() then
        raise exception 'An unscheduled request must retain a future start time';
      end if;

      update public.client_service_requests
      set desired_start_date = adjustment_row.proposed_start_date,
          daily_start_time = adjustment_row.proposed_daily_start_time,
          daily_end_time = adjustment_row.proposed_daily_end_time,
          requested_weeks = adjustment_row.proposed_weeks,
          estimated_total = case
            when adjustment_row.service_type = 'POSTPARTUM'
              then request_row.weekly_rate * adjustment_row.proposed_weeks
            else round(
              (extract(epoch from (
                adjustment_row.proposed_daily_end_time
                  - adjustment_row.proposed_daily_start_time
              )) / 3600.0)
                * 32.00
                * cardinality(request_row.requested_days)
                * adjustment_row.proposed_weeks,
              2
            )
          end,
          updated_at = now()
      where id = request_row.id;
    end if;

  elsif adjustment_row.action = 'CANCEL' then
    if adjustment_row.service_type = 'POSTPARTUM'
       and effective_assignment_id is not null
       and effective_contract_start_at <= policy_evaluation_at then
      computed_policy_code := 'POSTPARTUM_ACTIVE_PRORATED';
      computed_deposit_status := 'NON_REFUNDABLE';

      select count(*)::integer into computed_remaining_days
      from generate_series(
        greatest(
          case
            when local_now::time >= assignment_row.daily_end_time
              then local_today + 1
            else local_today
          end,
          effective_start_date
        )::timestamp,
        effective_end_date::timestamp,
        interval '1 day'
      ) as remaining_day
      where public.service_weekday_matches(
        remaining_day::date,
        assignment_row.service_days
      )
        and not exists (
          select 1 from public.care_sessions session
          where session.assignment_id = assignment_row.id
            and session.service_date = remaining_day::date
            and session.status in ('COMPLETED', 'CANCELLED')
        );

      if coalesce(computed_remaining_days, 0) < 1 then
        raise exception 'No remaining postpartum care days are available to cancel';
      end if;

      computed_settlement := round(
        greatest(
          coalesce(computed_contract_value, 0)
            - coalesce(computed_deposit_amount, 0),
          0
        ) / computed_remaining_days,
        2
      );
    elsif adjustment_row.service_type = 'POSTPARTUM' then
      if policy_evaluation_at
           < coalesce(effective_contract_start_at, effective_start_at) - interval '30 days' then
        computed_policy_code := 'DEPOSIT_REFUNDABLE';
        computed_deposit_status := 'REFUND_DUE';
      else
        computed_policy_code := 'DEPOSIT_NON_REFUNDABLE';
        computed_deposit_status := 'NON_REFUNDABLE';
      end if;
    else
      if policy_evaluation_at
           < coalesce(effective_contract_start_at, effective_start_at) - interval '72 hours' then
        computed_policy_code := 'BABYSITTING_DEPOSIT_REFUNDABLE';
        computed_deposit_status := 'REFUND_DUE';
      else
        computed_policy_code := 'BABYSITTING_DEPOSIT_NON_REFUNDABLE';
        computed_deposit_status := 'NON_REFUNDABLE';
      end if;
    end if;

    if effective_assignment_id is not null then
      update public.care_assignments
      set status = 'CANCELLED',
          deposit_status = computed_deposit_status,
          cancellation_settlement_amount = computed_settlement,
          remaining_care_days_at_cancellation = computed_remaining_days,
          cancelled_at = now(),
          cancelled_by = auth.uid(),
          cancellation_reason = adjustment_row.reason,
          updated_by = auth.uid(),
          updated_at = now()
      where id = assignment_row.id;

      update public.care_contracts
      set status = 'CANCELLED', updated_at = now()
      where id = contract_row.id;

      update public.care_sessions
      set status = 'CANCELLED',
          ended_at = case when started_at is not null then now() else ended_at end,
          updated_at = now()
      where assignment_id = assignment_row.id
        and status <> 'COMPLETED';
    end if;

    if linked_request_id is not null then
      update public.client_service_requests
      set status = 'CANCELLED',
          deposit_status = computed_deposit_status,
          cancellation_settlement_amount = computed_settlement,
          remaining_care_days_at_cancellation = computed_remaining_days,
          updated_at = now()
      where id = linked_request_id;
    end if;

    update public.service_adjustment_requests
    set policy_code = computed_policy_code,
        original_contract_value = computed_contract_value,
        remaining_care_days = computed_remaining_days,
        cancellation_settlement_amount = computed_settlement,
        cancellation_formula = case
          when computed_policy_code = 'POSTPARTUM_ACTIVE_PRORATED'
            then '(original_contract_value - deposit_amount) / remaining_care_days'
          else null
        end,
        updated_at = now()
    where id = adjustment_row.id;
  else
    raise exception 'Unsupported service adjustment action';
  end if;

  update public.service_adjustment_requests
  set policy_code = computed_policy_code,
      status = 'APPROVED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(p_review_note), ''),
      updated_at = now()
  where id = p_adjustment_id
  returning * into adjustment_row;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'APPROVE_SERVICE_ADJUSTMENT',
    'service_adjustment_requests', p_adjustment_id,
    jsonb_build_object(
      'action', adjustment_row.action,
      'policy_code', adjustment_row.policy_code,
      'client_service_request_id', adjustment_row.client_service_request_id,
      'care_assignment_id', adjustment_row.care_assignment_id
    )
  );

  return adjustment_row;
end;
$$;

-- Populate only the operational signup metadata that is intentionally retained.
-- Service address remains on the first service request rather than being copied
-- into an unrestricted notes field.
create or replace function public.initialize_new_client_management_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  desired_role text := upper(coalesce(new.raw_user_meta_data ->> 'requested_role', 'CLIENT'));
begin
  if desired_role = 'CAREGIVER' then
    return new;
  end if;

  select member.client_id into target_client_id
  from public.client_members member
  where member.user_id = new.id and member.is_primary
  order by member.created_at
  limit 1;

  if target_client_id is not null then
    insert into public.client_management_profiles (
      client_id, preferred_language, emergency_contact, updated_by
    ) values (
      target_client_id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'preferred_language'), ''), 'ko'),
      nullif(trim(new.raw_user_meta_data ->> 'emergency_contact'), ''),
      new.id
    )
    on conflict (client_id) do update set
      preferred_language = coalesce(
        public.client_management_profiles.preferred_language,
        excluded.preferred_language
      ),
      emergency_contact = coalesce(
        public.client_management_profiles.emergency_contact,
        excluded.emergency_contact
      ),
      updated_at = now();

    update public.clients
    set notes = null, updated_at = now()
    where id = target_client_id and created_by = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_sync_new_client_management_profile on auth.users;
create trigger zz_sync_new_client_management_profile
after insert on auth.users
for each row execute function public.initialize_new_client_management_profile();

insert into public.client_management_profiles (
  client_id, preferred_language, emergency_contact, updated_by
)
select distinct on (member.client_id)
  member.client_id,
  profile.preferred_language,
  nullif(trim(auth_user.raw_user_meta_data ->> 'emergency_contact'), ''),
  profile.id
from public.client_members member
join public.profiles profile on profile.id = member.user_id
join auth.users auth_user on auth_user.id = member.user_id
where member.is_primary
order by member.client_id, member.created_at
on conflict (client_id) do update set
  preferred_language = coalesce(
    public.client_management_profiles.preferred_language,
    excluded.preferred_language
  ),
  emergency_contact = coalesce(
    public.client_management_profiles.emergency_contact,
    excluded.emergency_contact
  ),
  updated_at = case
    when public.client_management_profiles.preferred_language is null
      or public.client_management_profiles.emergency_contact is null
      then now()
    else public.client_management_profiles.updated_at
  end;

-- A deliberately narrow projection for assignment participants. It exposes the
-- caregiver identity/certification summary and the client's safety contact, but
-- never internal CRM or HR notes.
drop function if exists public.my_assignment_briefs();
create or replace function public.my_assignment_briefs()
returns table (
  assignment_id uuid,
  caregiver_user_id uuid,
  caregiver_display_name text,
  caregiver_certification_summary text,
  client_id uuid,
  preferred_language text,
  emergency_contact text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    assignment.id,
    caregiver.user_id,
    caregiver_profile.full_name,
    caregiver_application.certification_summary,
    contract.client_id,
    coalesce(client_management.preferred_language, primary_client_profile.preferred_language),
    client_management.emergency_contact
  from public.care_assignments assignment
  join public.care_contracts contract on contract.id = assignment.contract_id
  join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
  join public.profiles caregiver_profile on caregiver_profile.id = caregiver.user_id
  left join public.caregiver_applications caregiver_application
    on caregiver_application.user_id = caregiver.user_id
  left join public.client_management_profiles client_management
    on client_management.client_id = contract.client_id
  left join lateral (
    select profile.preferred_language
    from public.client_members member
    join public.profiles profile on profile.id = member.user_id
    where member.client_id = contract.client_id and member.is_primary
    order by member.created_at
    limit 1
  ) primary_client_profile on true
  where assignment.status in ('PROPOSED', 'CONFIRMED')
    and contract.status in ('PENDING', 'ACTIVE', 'PAUSED')
    and assignment.ends_at >= now()
    and (
      public.is_care_staff()
      or (
        caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and public.account_is_active()
      )
      or public.is_client_member(contract.client_id)
    );
$$;

-- Profile updates from the browser are limited at the privilege layer to safe
-- self-service fields. Governance fields can be changed only through the
-- SECURITY DEFINER RPCs below, so staff cannot bypass their authorization rules
-- with a direct table update.
drop trigger if exists protect_profile_security_fields_trigger on public.profiles;
drop policy if exists "profiles: staff update" on public.profiles;

revoke update on table public.profiles from authenticated;
revoke update on table public.profiles from anon;
revoke update on table public.profiles from public;
grant update (full_name, phone, preferred_language) on public.profiles to authenticated;

-- Remove the legacy broad staff write paths for the records now maintained by
-- atomic management RPCs. Existing family baby policies remain in place, but
-- being care staff alone no longer authorizes an unaudited partial CRM/HR edit.
drop policy if exists "clients: staff manage" on public.clients;
drop policy if exists "babies: staff manage" on public.babies;
drop policy if exists "caregivers: staff manage" on public.caregivers;
drop policy if exists "client management profiles: staff create"
  on public.client_management_profiles;
drop policy if exists "client management profiles: staff update"
  on public.client_management_profiles;
drop policy if exists "caregiver hr profiles: staff create"
  on public.caregiver_hr_profiles;
drop policy if exists "caregiver hr profiles: staff update"
  on public.caregiver_hr_profiles;

drop policy if exists "roles: staff manage" on public.user_roles;
drop policy if exists "roles: administrators manage" on public.user_roles;
revoke insert, update, delete on table public.user_roles from authenticated;
revoke insert, update, delete on table public.user_roles from anon;
revoke insert, update, delete on table public.user_roles from public;

create or replace function public.update_my_profile(
  p_full_name text,
  p_phone text,
  p_preferred_language text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Full name must contain at least two characters';
  end if;
  if lower(trim(coalesce(p_preferred_language, ''))) not in ('ko', 'en') then
    raise exception 'Unsupported preferred language';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = nullif(trim(p_phone), ''),
      preferred_language = lower(trim(p_preferred_language)),
      updated_at = now()
  where id = auth.uid()
  returning * into updated_profile;

  if not found then
    raise exception 'Profile not found';
  end if;

  update public.clients client
  set display_name = trim(p_full_name), updated_at = now()
  from public.client_members member
  where member.client_id = client.id
    and member.user_id = auth.uid()
    and member.is_primary;

  insert into public.client_management_profiles (
    client_id, preferred_language, updated_by
  )
  select member.client_id, lower(trim(p_preferred_language)), auth.uid()
  from public.client_members member
  where member.user_id = auth.uid() and member.is_primary
  on conflict (client_id) do update set
    preferred_language = excluded.preferred_language,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'UPDATE_MY_PROFILE', 'profiles', auth.uid(),
    jsonb_build_object('preferred_language', updated_profile.preferred_language)
  );

  return updated_profile;
end;
$$;

-- CRM edits touch several protected tables. Keep them in one transaction and
-- derive the member/profile relationship on the server so a browser cannot
-- redirect a safe contact update to an unrelated account.
create or replace function public.admin_update_client_management(
  p_client_id uuid,
  p_baby_id uuid,
  p_full_name text,
  p_phone text,
  p_lifecycle_status text,
  p_request_note text,
  p_baby_name text,
  p_baby_birth_date date,
  p_baby_admin_notes text,
  p_maternal_status text,
  p_preferred_language text,
  p_emergency_contact text,
  p_next_contact_date date,
  p_internal_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_lifecycle text := upper(trim(coalesce(p_lifecycle_status, '')));
  target_client public.clients%rowtype;
  target_profile_id uuid;
  saved_baby_id uuid;
begin
  if not public.is_care_staff() then
    raise exception 'Only care managers or administrators can update client management data';
  end if;
  if normalized_lifecycle not in ('LEAD', 'ACTIVE', 'PAUSED', 'COMPLETED') then
    raise exception 'Unsupported client lifecycle status';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Client name must contain at least two characters';
  end if;
  if length(trim(coalesce(p_baby_name, ''))) < 1 then
    raise exception 'Baby name is required';
  end if;
  if p_baby_birth_date is null then
    raise exception 'Birth or due date is required';
  end if;

  if not exists (
    select 1 from public.clients client where client.id = p_client_id
  ) then
    raise exception 'Client not found';
  end if;

  -- Match update_my_profile's profile -> client row-lock order so a family
  -- self-edit and an administrator edit cannot deadlock each other.
  select member.user_id into target_profile_id
  from public.client_members member
  where member.client_id = p_client_id
    and member.is_primary
  order by member.created_at, member.user_id
  limit 1;

  if target_profile_id is null then
    raise exception 'Client has no primary member profile';
  end if;

  perform 1
  from public.profiles profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'Primary member profile not found';
  end if;

  select client.* into target_client
  from public.clients client
  where client.id = p_client_id
  for update;

  if not found or not exists (
    select 1
    from public.client_members member
    where member.client_id = target_client.id
      and member.user_id = target_profile_id
      and member.is_primary
  ) then
    raise exception 'Client membership changed while the profile was being updated';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = nullif(trim(p_phone), ''),
      updated_at = now()
  where id = target_profile_id;

  update public.clients
  set display_name = trim(p_full_name),
      status = case
        when normalized_lifecycle = 'LEAD' then 'LEAD'
        when normalized_lifecycle = 'COMPLETED' then 'INACTIVE'
        else 'ACTIVE'
      end,
      notes = nullif(trim(p_request_note), ''),
      updated_at = now()
  where id = target_client.id;

  if p_baby_id is not null then
    select baby.id into saved_baby_id
    from public.babies baby
    where baby.id = p_baby_id
      and baby.client_id = target_client.id
    for update;

    if saved_baby_id is null then
      raise exception 'Baby does not belong to this client';
    end if;

    update public.babies
    set first_name = trim(p_baby_name),
        birth_date = p_baby_birth_date,
        notes = nullif(trim(p_baby_admin_notes), ''),
        updated_at = now()
    where id = saved_baby_id;
  else
    insert into public.babies (
      client_id, first_name, birth_date, notes
    ) values (
      target_client.id,
      trim(p_baby_name),
      p_baby_birth_date,
      nullif(trim(p_baby_admin_notes), '')
    )
    returning id into saved_baby_id;
  end if;

  insert into public.client_management_profiles (
    client_id,
    lifecycle_status,
    maternal_status,
    preferred_language,
    emergency_contact,
    next_contact_date,
    internal_memo,
    baby_admin_notes,
    updated_by
  ) values (
    target_client.id,
    normalized_lifecycle,
    nullif(trim(p_maternal_status), ''),
    nullif(trim(p_preferred_language), ''),
    nullif(trim(p_emergency_contact), ''),
    p_next_contact_date,
    nullif(trim(p_internal_memo), ''),
    nullif(trim(p_baby_admin_notes), ''),
    auth.uid()
  )
  on conflict (client_id) do update set
    lifecycle_status = excluded.lifecycle_status,
    maternal_status = excluded.maternal_status,
    preferred_language = excluded.preferred_language,
    emergency_contact = excluded.emergency_contact,
    next_contact_date = excluded.next_contact_date,
    internal_memo = excluded.internal_memo,
    baby_admin_notes = excluded.baby_admin_notes,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CLIENT_MANAGEMENT_UPDATED',
    'clients',
    target_client.id,
    jsonb_build_object(
      'profile_id', target_profile_id,
      'baby_id', saved_baby_id,
      'lifecycle_status', normalized_lifecycle
    )
  );

  return jsonb_build_object(
    'client_id', target_client.id,
    'profile_id', target_profile_id,
    'baby_id', saved_baby_id,
    'lifecycle_status', normalized_lifecycle
  );
end;
$$;

-- HR records include private management notes and therefore require the
-- narrower ADMIN/OWNER boundary rather than the general care-staff boundary.
create or replace function public.admin_update_caregiver_management(
  p_caregiver_id uuid,
  p_full_name text,
  p_phone text,
  p_hire_date date,
  p_career_years numeric,
  p_employment_status text,
  p_career_summary text,
  p_specialties text,
  p_residential_area text,
  p_service_area_notes text,
  p_hr_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_employment text := upper(trim(coalesce(p_employment_status, '')));
  target_caregiver public.caregivers%rowtype;
  target_caregiver_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can update caregiver HR data';
  end if;
  if normalized_employment not in ('APPLICANT', 'ACTIVE', 'ON_LEAVE', 'INACTIVE') then
    raise exception 'Unsupported caregiver employment status';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Caregiver name must contain at least two characters';
  end if;
  if p_career_years is null or p_career_years < 0 or p_career_years > 60 then
    raise exception 'Career years must be between 0 and 60';
  end if;

  select caregiver.user_id into target_caregiver_user_id
  from public.caregivers caregiver
  where caregiver.id = p_caregiver_id;

  if target_caregiver_user_id is null then
    raise exception 'Caregiver not found';
  end if;

  -- Always lock a caregiver's session-start lane before their scheduling lane.
  -- Eligibility changes then serialize with both session creation and booking.
  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || target_caregiver_user_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('caregiver:' || p_caregiver_id::text, 0)
  );

  select caregiver.* into target_caregiver
  from public.caregivers caregiver
  where caregiver.id = p_caregiver_id
  for update;

  if not found then
    raise exception 'Caregiver not found';
  end if;
  if not public.has_role_for_user(target_caregiver.user_id, 'CAREGIVER') then
    raise exception 'Caregiver HR data can be changed only for a current caregiver member';
  end if;

  if normalized_employment <> 'ACTIVE' and (
    exists (
      select 1
      from public.care_assignments assignment
      where assignment.caregiver_id = target_caregiver.id
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.ends_at >= now()
    )
    or exists (
      select 1
      from public.care_sessions session
      join public.care_assignments assignment on assignment.id = session.assignment_id
      where assignment.caregiver_id = target_caregiver.id
        and session.status = 'IN_PROGRESS'
    )
  ) then
    raise exception 'Reassign or cancel the caregiver active schedule before changing employment status';
  end if;

  perform 1
  from public.profiles profile
  where profile.id = target_caregiver.user_id
  for update;

  if not found then
    raise exception 'Caregiver profile not found';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = nullif(trim(p_phone), ''),
      updated_at = now()
  where id = target_caregiver.user_id;

  update public.caregivers
  set status = case normalized_employment
        when 'ON_LEAVE' then 'ON_LEAVE'
        when 'INACTIVE' then 'INACTIVE'
        else 'ACTIVE'
      end,
      updated_at = now()
  where id = target_caregiver.id;

  insert into public.caregiver_hr_profiles (
    caregiver_id,
    hire_date,
    career_years,
    employment_status,
    career_summary,
    specialties,
    residential_area,
    service_area_notes,
    hr_notes,
    updated_by
  ) values (
    target_caregiver.id,
    p_hire_date,
    p_career_years,
    normalized_employment,
    nullif(trim(p_career_summary), ''),
    nullif(trim(p_specialties), ''),
    nullif(trim(p_residential_area), ''),
    nullif(trim(p_service_area_notes), ''),
    nullif(trim(p_hr_notes), ''),
    auth.uid()
  )
  on conflict (caregiver_id) do update set
    hire_date = excluded.hire_date,
    career_years = excluded.career_years,
    employment_status = excluded.employment_status,
    career_summary = excluded.career_summary,
    specialties = excluded.specialties,
    residential_area = excluded.residential_area,
    service_area_notes = excluded.service_area_notes,
    hr_notes = excluded.hr_notes,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_HR_UPDATED',
    'caregivers',
    target_caregiver.id,
    jsonb_build_object(
      'profile_id', target_caregiver.user_id,
      'employment_status', normalized_employment
    )
  );

  return jsonb_build_object(
    'caregiver_id', target_caregiver.id,
    'profile_id', target_caregiver.user_id,
    'employment_status', normalized_employment
  );
end;
$$;

-- Only an OWNER may grant an elevated ADMIN or OWNER role. Existing OWNER
-- accounts remain protected from all role changes through this RPC.
create or replace function public.admin_change_member_role(
  p_user_id uuid,
  p_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles%rowtype;
  target_client_id uuid;
  target_caregiver_id uuid;
  actor_is_owner boolean;
  target_is_administrator boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('owner-governance', 0));
  actor_is_owner := public.has_role('OWNER');
  target_is_administrator := public.has_role_for_user(p_user_id, 'ADMIN');

  if not public.is_admin() then
    raise exception 'Only administrators can change member roles';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Administrators cannot change their own role';
  end if;
  if target_is_administrator and not actor_is_owner then
    raise exception 'Only an owner can change an administrator account';
  end if;
  if p_role not in ('CLIENT', 'CAREGIVER', 'ADMIN', 'OWNER') then
    raise exception 'Unsupported member role';
  end if;
  if p_role in ('ADMIN', 'OWNER') and not actor_is_owner then
    raise exception 'Only an owner can grant administrator or owner access';
  end if;
  if public.has_role_for_user(p_user_id, 'OWNER') then
    raise exception 'Owner roles cannot be changed here';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || p_user_id::text, 0)
  );

  select caregiver.id into target_caregiver_id
  from public.caregivers caregiver
  where caregiver.user_id = p_user_id;

  if target_caregiver_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('caregiver:' || target_caregiver_id::text, 0)
    );
  end if;

  select * into target_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Member not found';
  end if;

  if target_profile.account_status = 'REJECTED'
     or target_profile.deleted_at is not null then
    raise exception 'Archived or rejected accounts must be restored through a dedicated recovery workflow';
  end if;

  if p_role = 'CAREGIVER' and exists (
    select 1
    from (
      values ('SERVICE_TERMS'::text), ('PRIVACY'::text), ('SENSITIVE_CARE_DATA'::text)
    ) as required_consent(consent_type)
    where not exists (
      select 1
      from public.member_consents consent
      where consent.user_id = p_user_id
        and consent.consent_type = required_consent.consent_type
        and consent.version = public.current_consent_version()
        and consent.granted
        and consent.revoked_at is null
    )
  ) then
    raise exception 'Current required consents must be recorded before granting the caregiver role';
  end if;

  if p_role <> 'CLIENT' and public.has_role_for_user(p_user_id, 'CLIENT') and exists (
    select 1
    from public.client_members member
    where member.user_id = p_user_id
      and (
        exists (
          select 1
          from public.client_service_requests request
          where request.client_id = member.client_id
            and (
              request.status = 'PENDING'
              or (
                request.status = 'APPROVED'
                and request.approved_assignment_id is null
              )
            )
        )
        or exists (
          select 1
          from public.care_contracts contract
          where contract.client_id = member.client_id
            and contract.status in ('DRAFT', 'PENDING', 'ACTIVE', 'PAUSED')
            and contract.end_date >= (now() at time zone 'America/New_York')::date
        )
      )
  ) then
    raise exception 'Finish or cancel the client active service records before changing roles';
  end if;

  if p_role <> 'CAREGIVER' and public.has_role_for_user(p_user_id, 'CAREGIVER') and exists (
    select 1
    from public.caregivers caregiver
    join public.care_assignments assignment on assignment.caregiver_id = caregiver.id
    where caregiver.user_id = p_user_id
      and assignment.status in ('PROPOSED', 'CONFIRMED')
      and assignment.ends_at >= now()
  ) then
    raise exception 'Reassign or complete the caregiver active schedule before changing roles';
  end if;

  if p_role <> 'CAREGIVER' and public.has_role_for_user(p_user_id, 'CAREGIVER') and exists (
    select 1
    from public.caregivers caregiver
    join public.care_assignments assignment on assignment.caregiver_id = caregiver.id
    join public.care_sessions session on session.assignment_id = assignment.id
    where caregiver.user_id = p_user_id
      and session.status = 'IN_PROGRESS'
  ) then
    raise exception 'Complete the caregiver open care session before changing roles';
  end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role) values (p_user_id, p_role);

  update public.profiles
  set requested_role = case when p_role = 'OWNER' then 'ADMIN' else p_role::text end,
      updated_at = now()
  where id = p_user_id;

  if p_role = 'CLIENT' then
    update public.caregivers
    set status = 'INACTIVE', updated_at = now()
    where user_id = p_user_id;

    select member.client_id into target_client_id
    from public.client_members member
    where member.user_id = p_user_id
    order by member.is_primary desc, member.created_at
    limit 1;

    if target_client_id is null then
      select client.id into target_client_id
      from public.clients client
      where client.created_by = p_user_id
      order by client.created_at
      limit 1;
    end if;

    if target_client_id is null then
      insert into public.clients (display_name, status, created_by)
      values (target_profile.full_name, 'LEAD', p_user_id)
      returning id into target_client_id;
    end if;

    insert into public.client_members (client_id, user_id, relationship, is_primary)
    values (target_client_id, p_user_id, 'PARENT', true)
    on conflict (client_id, user_id) do update set is_primary = true;

  elsif p_role = 'CAREGIVER' then
    delete from public.client_members where user_id = p_user_id;

    insert into public.caregiver_applications (
      user_id, certification_summary, status, reviewed_by, reviewed_at, review_note
    ) values (
      p_user_id, '관리자 회원 종류 변경으로 생성', 'APPROVED',
      auth.uid(), now(), '관리자 직접 승인'
    )
    on conflict (user_id) do update set
      status = 'APPROVED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = '관리자 회원 종류 변경으로 승인';

    insert into public.caregivers (user_id, status)
    values (p_user_id, 'ACTIVE')
    on conflict (user_id) do update
      set status = 'ACTIVE', updated_at = now();

  else
    delete from public.client_members where user_id = p_user_id;
    update public.caregivers
    set status = 'INACTIVE', updated_at = now()
    where user_id = p_user_id;
  end if;
end;
$$;

-- Account-state changes are also RPC-only. Administrators can manage ordinary
-- members; only an OWNER may act on an OWNER, and the last active OWNER can
-- never be suspended or rejected.
create or replace function public.set_member_account_status(
  p_user_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_is_owner boolean;
  target_is_administrator boolean;
  actor_is_owner boolean;
  other_active_owner_count integer;
  target_account_status text;
  target_caregiver_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('owner-governance', 0));
  target_is_owner := public.has_role_for_user(p_user_id, 'OWNER');
  target_is_administrator := public.has_role_for_user(p_user_id, 'ADMIN');
  actor_is_owner := public.has_role('OWNER');

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || p_user_id::text, 0)
  );

  select caregiver.id into target_caregiver_id
  from public.caregivers caregiver
  where caregiver.user_id = p_user_id;

  if target_caregiver_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('caregiver:' || target_caregiver_id::text, 0)
    );
  end if;

  select profile.account_status
  into target_account_status
  from public.profiles profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception 'Member not found';
  end if;

  if not public.is_admin() then
    raise exception 'Only administrators can manage member access';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REJECTED') then
    raise exception 'Invalid account status';
  end if;
  if target_account_status = 'REJECTED' and p_status <> 'REJECTED' then
    raise exception 'Archived accounts cannot be reactivated without a complete membership restoration workflow';
  end if;
  if p_user_id = auth.uid() and p_status <> 'ACTIVE' then
    raise exception 'Administrators cannot suspend their own account';
  end if;
  if target_is_administrator and not actor_is_owner then
    raise exception 'Only an owner can manage an administrator account';
  end if;
  if target_is_owner and not actor_is_owner then
    raise exception 'Only an owner can manage another owner account';
  end if;

  if target_is_owner and p_status <> 'ACTIVE' then
    select count(*)::integer into other_active_owner_count
    from public.user_roles role_row
    join public.profiles profile on profile.id = role_row.user_id
    where role_row.role = 'OWNER'
      and role_row.user_id <> p_user_id
      and profile.account_status = 'ACTIVE';

    if other_active_owner_count < 1 then
      raise exception 'The last active owner account cannot be suspended or rejected';
    end if;
  end if;

  -- An emergency suspension must not strand an IN_PROGRESS session that the
  -- caregiver can no longer close after access is revoked. Preserve the
  -- timestamps and events, close it as cancelled, and leave an audit record so
  -- an administrator can safely reassign the remaining schedule.
  if p_status <> 'ACTIVE' then
    insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
    select
      auth.uid(),
      'FORCE_CLOSE_CARE_SESSION_ACCOUNT_STATUS',
      'care_sessions',
      session.id,
      jsonb_build_object(
        'caregiver_user_id', p_user_id,
        'new_account_status', p_status,
        'started_at', session.started_at,
        'forced_ended_at', now()
      )
    from public.care_sessions session
    join public.care_assignments assignment on assignment.id = session.assignment_id
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where caregiver.user_id = p_user_id
      and session.status = 'IN_PROGRESS';

    update public.care_sessions session
    set status = 'CANCELLED',
        ended_at = now(),
        updated_at = now()
    from public.care_assignments assignment
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where session.assignment_id = assignment.id
      and caregiver.user_id = p_user_id
      and session.status = 'IN_PROGRESS';
  end if;

  update public.profiles
  set account_status = p_status,
      deleted_at = case
        when p_status = 'REJECTED' then coalesce(deleted_at, now())
        else null
      end,
      deleted_by = case
        when p_status = 'REJECTED' then coalesce(deleted_by, auth.uid())
        else null
      end,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Member not found';
  end if;

  update public.caregivers caregiver
  set status = case
        when p_status <> 'ACTIVE'
          or not public.has_role_for_user(p_user_id, 'CAREGIVER')
          then 'INACTIVE'
        when exists (
          select 1 from public.caregiver_hr_profiles hr
          where hr.caregiver_id = caregiver.id
            and hr.employment_status = 'ACTIVE'
        ) then 'ACTIVE'
        when exists (
          select 1 from public.caregiver_hr_profiles hr
          where hr.caregiver_id = caregiver.id
            and hr.employment_status = 'ON_LEAVE'
        ) then 'ON_LEAVE'
        else 'INACTIVE'
      end,
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function public.admin_archive_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_caregiver_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('owner-governance', 0));

  if not public.is_admin() then
    raise exception 'Only administrators can archive members';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Administrators cannot archive their own account';
  end if;
  if public.has_role_for_user(p_user_id, 'ADMIN') and not public.has_role('OWNER') then
    raise exception 'Only an owner can archive an administrator account';
  end if;
  if public.has_role_for_user(p_user_id, 'OWNER') then
    raise exception 'Owner accounts cannot be archived';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || p_user_id::text, 0)
  );

  select caregiver.id into target_caregiver_id
  from public.caregivers caregiver
  where caregiver.user_id = p_user_id;

  if target_caregiver_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('caregiver:' || target_caregiver_id::text, 0)
    );
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found';
  end if;
  if exists (
    select 1
    from public.caregivers caregiver
    join public.care_assignments assignment on assignment.caregiver_id = caregiver.id
    where caregiver.user_id = p_user_id
      and assignment.status in ('PROPOSED', 'CONFIRMED')
      and assignment.ends_at >= now()
  ) or exists (
    select 1
    from public.client_members member
    where member.user_id = p_user_id
      and (
        exists (
          select 1 from public.client_service_requests request
          where request.client_id = member.client_id
            and (
              request.status = 'PENDING'
              or (
                request.status = 'APPROVED'
                and request.approved_assignment_id is null
              )
            )
        )
        or exists (
          select 1 from public.care_contracts contract
          where contract.client_id = member.client_id
            and contract.status in ('DRAFT', 'PENDING', 'ACTIVE', 'PAUSED')
            and contract.end_date >= (now() at time zone 'America/New_York')::date
        )
      )
  ) or exists (
    select 1
    from public.caregivers caregiver
    join public.care_assignments assignment on assignment.caregiver_id = caregiver.id
    join public.care_sessions session on session.assignment_id = assignment.id
    where caregiver.user_id = p_user_id
      and session.status = 'IN_PROGRESS'
  ) then
    raise exception 'Finish, cancel, or reassign active service records before archiving this member';
  end if;

  update public.profiles
  set account_status = 'REJECTED',
      deleted_at = now(),
      deleted_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;

  update public.caregivers
  set status = 'INACTIVE', updated_at = now()
  where user_id = p_user_id;

  update public.caregiver_applications
  set status = 'REJECTED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = '계정 보관으로 신청 종료'
  where user_id = p_user_id
    and status = 'PENDING';

  delete from public.client_members where user_id = p_user_id;
  delete from public.user_roles where user_id = p_user_id;
end;
$$;

revoke all on function public.caregiver_schedule_is_available(
  uuid, date, date, time, time, text[], uuid
) from public;
revoke all on function public.caregiver_schedule_is_available(
  uuid, date, date, time, time, text[], uuid
) from anon;
grant execute on function public.caregiver_schedule_is_available(
  uuid, date, date, time, time, text[], uuid
) to authenticated;

revoke all on function public.schedule_approved_client_request(uuid, uuid) from public;
revoke all on function public.schedule_approved_client_request(uuid, uuid) from anon;
grant execute on function public.schedule_approved_client_request(uuid, uuid) to authenticated;

-- Retire the pre-deposit one-step approval RPC. Production uses separate
-- review_client_service_request and schedule_approved_client_request calls.
revoke all on function public.approve_client_service_request(uuid, uuid) from public;
revoke all on function public.approve_client_service_request(uuid, uuid) from anon;
revoke all on function public.approve_client_service_request(uuid, uuid) from authenticated;

revoke all on function public.set_care_session_status(
  uuid, public.session_status
) from public;
revoke all on function public.set_care_session_status(
  uuid, public.session_status
) from anon;
grant execute on function public.set_care_session_status(
  uuid, public.session_status
) to authenticated;

revoke all on function public.set_care_shift_check(
  uuid, text, boolean
) from public;
revoke all on function public.set_care_shift_check(
  uuid, text, boolean
) from anon;
grant execute on function public.set_care_shift_check(
  uuid, text, boolean
) to authenticated;

-- The legacy review RPC marked deposits paid without payment evidence.
revoke all on function public.review_client_service_request(
  uuid, boolean, text
) from public;
revoke all on function public.review_client_service_request(
  uuid, boolean, text
) from anon;
revoke all on function public.review_client_service_request(
  uuid, boolean, text
) from authenticated;

revoke all on function public.review_service_request_with_deposit(
  uuid, boolean, text, text, text
) from public;
revoke all on function public.review_service_request_with_deposit(
  uuid, boolean, text, text, text
) from anon;
grant execute on function public.review_service_request_with_deposit(
  uuid, boolean, text, text, text
) to authenticated;

revoke all on function public.submit_service_adjustment(
  text, uuid, text, text, date, time, time, integer
) from public;
revoke all on function public.submit_service_adjustment(
  text, uuid, text, text, date, time, time, integer
) from anon;
grant execute on function public.submit_service_adjustment(
  text, uuid, text, text, date, time, time, integer
) to authenticated;

revoke all on function public.review_service_adjustment(
  uuid, boolean, text
) from public;
revoke all on function public.review_service_adjustment(
  uuid, boolean, text
) from anon;
grant execute on function public.review_service_adjustment(
  uuid, boolean, text
) to authenticated;

revoke all on function public.admin_change_member_role(
  uuid, public.app_role
) from public;
revoke all on function public.admin_change_member_role(
  uuid, public.app_role
) from anon;
grant execute on function public.admin_change_member_role(
  uuid, public.app_role
) to authenticated;

revoke all on function public.update_my_profile(text, text, text) from public;
revoke all on function public.update_my_profile(text, text, text) from anon;
grant execute on function public.update_my_profile(text, text, text) to authenticated;

revoke all on function public.admin_update_client_management(
  uuid, uuid, text, text, text, text, text, date, text, text, text, text, date, text
) from public;
revoke all on function public.admin_update_client_management(
  uuid, uuid, text, text, text, text, text, date, text, text, text, text, date, text
) from anon;
grant execute on function public.admin_update_client_management(
  uuid, uuid, text, text, text, text, text, date, text, text, text, text, date, text
) to authenticated;

revoke all on function public.admin_update_caregiver_management(
  uuid, text, text, date, numeric, text, text, text, text, text, text
) from public;
revoke all on function public.admin_update_caregiver_management(
  uuid, text, text, date, numeric, text, text, text, text, text, text
) from anon;
grant execute on function public.admin_update_caregiver_management(
  uuid, text, text, date, numeric, text, text, text, text, text, text
) to authenticated;

revoke all on function public.initialize_new_client_management_profile() from public;
revoke all on function public.initialize_new_client_management_profile() from anon;
revoke all on function public.initialize_new_client_management_profile() from authenticated;

revoke all on function public.my_assignment_briefs() from public;
revoke all on function public.my_assignment_briefs() from anon;
grant execute on function public.my_assignment_briefs() to authenticated;

revoke all on function public.set_member_account_status(uuid, text) from public;
revoke all on function public.set_member_account_status(uuid, text) from anon;
grant execute on function public.set_member_account_status(uuid, text) to authenticated;

revoke all on function public.admin_archive_member(uuid) from public;
revoke all on function public.admin_archive_member(uuid) from anon;
grant execute on function public.admin_archive_member(uuid) to authenticated;

-- The retired browser bootstrap endpoint remains a deliberate error function
-- for migration compatibility, but no web role needs permission to call it.
revoke all on function public.claim_initial_admin() from public;
revoke all on function public.claim_initial_admin() from anon;
revoke all on function public.claim_initial_admin() from authenticated;

comment on function public.caregiver_schedule_is_available(
  uuid, date, date, time, time, text[], uuid
) is 'Returns false only when dates, recurring service days, and daily times overlap.';

comment on function public.review_service_adjustment(uuid, boolean, text) is
  'Atomically applies or rejects a service change/cancellation and records server-calculated deposit policy and audit history.';

comment on function public.submit_service_adjustment(
  text, uuid, text, text, date, time, time, integer
) is 'Creates a client-owned adjustment with server-derived cancellation policy, deposit treatment, and settlement.';

comment on function public.admin_change_member_role(uuid, public.app_role) is
  'Changes a member role atomically; only OWNER may grant ADMIN or OWNER access.';

comment on function public.update_my_profile(text, text, text) is
  'Updates only the authenticated member profile fields and synchronizes primary-client display metadata.';

comment on function public.set_care_shift_check(uuid, text, boolean) is
  'Upserts one checklist item for the assigned caregiver on today''s confirmed local service day.';

comment on function public.admin_update_client_management(
  uuid, uuid, text, text, text, text, text, date, text, text, text, text, date, text
) is 'Atomically updates safe contact, client, baby, and CRM fields for a care-manager-authorized client.';

comment on function public.admin_update_caregiver_management(
  uuid, text, text, date, numeric, text, text, text, text, text, text
) is 'Atomically updates safe contact, caregiver status, and private HR fields for an administrator-authorized caregiver.';

comment on function public.review_service_request_with_deposit(
  uuid, boolean, text, text, text
) is 'Approves a request only when a unique captured deposit transaction is recorded atomically.';

comment on function public.my_assignment_briefs() is
  'Returns the minimum caregiver identity and client safety-contact fields authorized for active assignment participants.';

comment on function public.set_member_account_status(uuid, text) is
  'Changes account status through governance checks and preserves at least one active OWNER.';

-- Release closure: make the production data boundary match the web application's
-- final multi-child, payment, consent, and role model.

-- Account-scoped consent evidence covers both family and caregiver signups.
-- The explicit granted flag distinguishes an initial opt-out from a later
-- revocation; editable auth metadata is never treated as the consent ledger.
create table if not exists public.member_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null check (
    consent_type in ('SERVICE_TERMS', 'PRIVACY', 'SENSITIVE_CARE_DATA', 'MARKETING')
  ),
  version text not null check (length(trim(version)) between 1 and 40),
  granted boolean not null,
  granted_at timestamptz,
  revoked_at timestamptz,
  source text not null default 'SIGNUP' check (length(trim(source)) between 1 and 40),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_consent_timestamps_match_state check (
    (granted and granted_at is not null and revoked_at is null)
    or (not granted and granted_at is null)
  ),
  constraint member_consent_version_unique unique (user_id, consent_type, version)
);

create index if not exists member_consents_user_created_idx
  on public.member_consents(user_id, created_at desc);

alter table public.member_consents enable row level security;
drop policy if exists "member consents: self or admin read" on public.member_consents;
create policy "member consents: self or admin read"
on public.member_consents for select to authenticated
using (user_id = auth.uid() or public.is_admin());
revoke all on table public.member_consents from public;
revoke all on table public.member_consents from anon;
revoke insert, update, delete on table public.member_consents from authenticated;
grant select on table public.member_consents to authenticated;

create or replace function public.current_consent_version()
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select '2026-09-13'::text;
$$;

revoke all on function public.current_consent_version() from public;
revoke all on function public.current_consent_version() from anon;
grant execute on function public.current_consent_version() to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role text := upper(coalesce(new.raw_user_meta_data ->> 'requested_role', 'CLIENT'));
  created_client_id uuid;
  consent_version text := public.current_consent_version();
  service_terms_accepted boolean := lower(coalesce(new.raw_user_meta_data ->> 'service_terms_consent', 'false')) = 'true';
  privacy_accepted boolean := lower(coalesce(new.raw_user_meta_data ->> 'privacy_consent', 'false')) = 'true';
  sensitive_care_accepted boolean := lower(coalesce(new.raw_user_meta_data ->> 'sensitive_care_consent', 'false')) = 'true';
  marketing_accepted boolean := lower(coalesce(new.raw_user_meta_data ->> 'marketing_consent', 'false')) = 'true';
begin
  if desired_role not in ('CLIENT', 'CAREGIVER') then
    desired_role := 'CLIENT';
  end if;
  if not service_terms_accepted or not privacy_accepted or not sensitive_care_accepted then
    raise exception 'Required service, privacy, and sensitive-care consents must be accepted';
  end if;
  if new.email is null or position('@' in new.email) < 2 then
    raise exception 'A valid email address is required';
  end if;

  insert into public.profiles (
    id, email, full_name, phone, preferred_language, requested_role, account_status
  ) values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'preferred_language'), ''), 'ko'),
    desired_role,
    case when desired_role = 'CAREGIVER' then 'PENDING' else 'ACTIVE' end
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    preferred_language = excluded.preferred_language,
    requested_role = excluded.requested_role,
    account_status = excluded.account_status,
    updated_at = now();

  insert into public.member_consents (
    user_id, consent_type, version, granted, granted_at, revoked_at, source, metadata
  ) values
    (new.id, 'SERVICE_TERMS', consent_version, true, now(), null, 'SIGNUP',
      jsonb_build_object('requested_role', desired_role)),
    (new.id, 'PRIVACY', consent_version, true, now(), null, 'SIGNUP',
      jsonb_build_object('requested_role', desired_role)),
    (new.id, 'SENSITIVE_CARE_DATA', consent_version, true, now(), null, 'SIGNUP',
      jsonb_build_object('requested_role', desired_role)),
    (new.id, 'MARKETING', consent_version, marketing_accepted,
      case when marketing_accepted then now() else null end,
      null, 'SIGNUP', jsonb_build_object('requested_role', desired_role))
  on conflict (user_id, consent_type, version) do update set
    granted = excluded.granted,
    granted_at = excluded.granted_at,
    revoked_at = excluded.revoked_at,
    source = excluded.source,
    metadata = excluded.metadata,
    updated_at = now();

  if desired_role = 'CAREGIVER' then
    insert into public.caregiver_applications (user_id, certification_summary, status)
    values (
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'certification_summary'), ''), '관리자 확인 필요'),
      'PENDING'
    )
    on conflict (user_id) do nothing;
  else
    insert into public.user_roles (user_id, role)
    values (new.id, 'CLIENT')
    on conflict do nothing;

    insert into public.clients (display_name, status, notes, created_by)
    values (
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
      'LEAD',
      concat_ws(' · ',
        nullif(trim(new.raw_user_meta_data ->> 'address'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'emergency_contact'), '')
      ),
      new.id
    ) returning id into created_client_id;

    insert into public.client_members (client_id, user_id, relationship, is_primary)
    values (created_client_id, new.id, 'PARENT', true);

    insert into public.consents (client_id, consent_type, version, granted_by, metadata)
    values
      (created_client_id, 'SERVICE_TERMS', consent_version, new.id,
        jsonb_build_object('granted', true, 'source', 'SIGNUP')),
      (created_client_id, 'PRIVACY', consent_version, new.id,
        jsonb_build_object('granted', true, 'source', 'SIGNUP')),
      (created_client_id, 'SENSITIVE_CARE_DATA', consent_version, new.id,
        jsonb_build_object('granted', true, 'source', 'SIGNUP'));

    if marketing_accepted then
      insert into public.consents (
        client_id, consent_type, version, granted_by, metadata
      ) values (
        created_client_id, 'MARKETING', consent_version, new.id,
        jsonb_build_object('granted', true, 'source', 'SIGNUP')
      );
    end if;
  end if;

  return new;
end;
$$;

-- Existing members created before the account consent ledger can explicitly
-- accept the current terms themselves. No administrator or editable metadata
-- can silently manufacture this evidence.
create or replace function public.record_my_current_consents(
  p_service_terms boolean,
  p_privacy boolean,
  p_sensitive_care boolean,
  p_marketing boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  consent_version text := public.current_consent_version();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_service_terms is distinct from true
     or p_privacy is distinct from true
     or p_sensitive_care is distinct from true then
    raise exception 'All required current consents must be accepted';
  end if;
  if p_marketing is null then
    raise exception 'An explicit marketing preference is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || auth.uid()::text, 0)
  );

  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.account_status in ('PENDING', 'ACTIVE')
      and profile.deleted_at is null
  ) then
    raise exception 'A pending or active member account is required';
  end if;

  insert into public.member_consents (
    user_id, consent_type, version, granted, granted_at, revoked_at, source, metadata
  ) values
    (auth.uid(), 'SERVICE_TERMS', consent_version, true, now(), null,
      'LEGACY_RECONSENT', '{}'::jsonb),
    (auth.uid(), 'PRIVACY', consent_version, true, now(), null,
      'LEGACY_RECONSENT', '{}'::jsonb),
    (auth.uid(), 'SENSITIVE_CARE_DATA', consent_version, true, now(), null,
      'LEGACY_RECONSENT', '{}'::jsonb),
    (auth.uid(), 'MARKETING', consent_version, p_marketing,
      case when p_marketing then now() else null end,
      null, 'LEGACY_RECONSENT', '{}'::jsonb)
  on conflict (user_id, consent_type, version) do update set
    granted = excluded.granted,
    granted_at = excluded.granted_at,
    revoked_at = excluded.revoked_at,
    source = excluded.source,
    metadata = excluded.metadata,
    updated_at = now();

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'RECORD_CURRENT_MEMBER_CONSENTS', 'member_consents', auth.uid(),
    jsonb_build_object(
      'version', consent_version,
      'marketing_granted', p_marketing,
      'source', 'LEGACY_RECONSENT'
    )
  );
end;
$$;

revoke all on function public.record_my_current_consents(
  boolean, boolean, boolean, boolean
) from public;
revoke all on function public.record_my_current_consents(
  boolean, boolean, boolean, boolean
) from anon;
grant execute on function public.record_my_current_consents(
  boolean, boolean, boolean, boolean
) to authenticated;

create or replace function public.is_retail_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active() and (
    public.has_role('OWNER')
    or public.has_role('ADMIN')
    or public.has_role('RETAIL_STAFF')
  );
$$;

create or replace function public.lock_care_schedule(
  p_caregiver_id uuid,
  p_baby_id uuid,
  p_client_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  caregiver_lock_key bigint;
  care_recipient_lock_key bigint;
begin
  if p_caregiver_id is null or p_client_id is null then
    raise exception 'A caregiver and client are required for schedule locking';
  end if;

  caregiver_lock_key := hashtextextended('caregiver:' || p_caregiver_id::text, 0);
  care_recipient_lock_key := hashtextextended(
    case
      when p_baby_id is null then 'legacy-client:' || p_client_id::text
      else 'baby:' || p_baby_id::text
    end,
    0
  );

  perform pg_advisory_xact_lock(least(caregiver_lock_key, care_recipient_lock_key));
  if caregiver_lock_key <> care_recipient_lock_key then
    perform pg_advisory_xact_lock(greatest(caregiver_lock_key, care_recipient_lock_key));
  end if;
end;
$$;

create or replace function public.prevent_overlapping_client_contracts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status not in ('CANCELLED', 'COMPLETED') and exists (
    select 1
    from public.care_contracts existing
    where existing.id <> new.id
      and existing.status not in ('CANCELLED', 'COMPLETED')
      and existing.client_id = new.client_id
      and (
        existing.baby_id is null
        or new.baby_id is null
        or existing.baby_id = new.baby_id
      )
      and daterange(existing.start_date, existing.end_date, '[]')
          && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'The selected baby already has a contract during the requested period';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_overlapping_client_contracts_trigger
  on public.care_contracts;
create trigger prevent_overlapping_client_contracts_trigger
before insert or update of client_id, baby_id, start_date, end_date, status
on public.care_contracts
for each row execute function public.prevent_overlapping_client_contracts();

create or replace function public.enforce_babysitting_extension_weekday()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  latest_end_date date;
  required_start_date date;
begin
  if new.request_kind <> 'EXTENSION'
     or new.service_type <> 'BABYSITTING'
     or new.status in ('REJECTED', 'CANCELLED') then
    return new;
  end if;
  if new.baby_id is null then
    raise exception 'A babysitting extension must identify the baby';
  end if;

  select max(existing_booking.end_date)
  into latest_end_date
  from (
    select request.desired_start_date + (request.requested_weeks * 7 - 1) as end_date
    from public.client_service_requests request
    where request.client_id = new.client_id
      and request.baby_id = new.baby_id
      and request.id <> new.id
      and request.service_type = 'BABYSITTING'
      and request.status in ('PENDING', 'APPROVED')
      and request.approved_assignment_id is null

    union all

    select (assignment.ends_at at time zone 'America/New_York')::date as end_date
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where contract.client_id = new.client_id
      and contract.baby_id = new.baby_id
      and assignment.service_type = 'BABYSITTING'
      and assignment.status <> 'CANCELLED'
      and (new.approved_assignment_id is null or assignment.id <> new.approved_assignment_id)
  ) existing_booking;

  if latest_end_date is null then
    raise exception 'A babysitting extension requires an existing booking for the selected baby';
  end if;

  required_start_date := latest_end_date + 1;
  while extract(isodow from required_start_date) in (6, 7) loop
    required_start_date := required_start_date + 1;
  end loop;

  if new.desired_start_date <> required_start_date then
    raise exception 'Babysitting extension must start on the first weekday after the selected baby''s booking ends: %', required_start_date;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_babysitting_extension_weekday_trigger
  on public.client_service_requests;
create trigger enforce_babysitting_extension_weekday_trigger
before insert or update of client_id, baby_id, request_kind, service_type,
  desired_start_date, requested_weeks, status
on public.client_service_requests
for each row execute function public.enforce_babysitting_extension_weekday();

-- The compliance register contains evidence references and internal notes.
-- It is never writable through a browser table endpoint.
alter table public.company_compliance_controls enable row level security;
alter table public.service_add_ons enable row level security;

drop policy if exists "company compliance: administrators read"
  on public.company_compliance_controls;
create policy "company compliance: administrators read"
on public.company_compliance_controls for select to authenticated
using (public.is_admin());

drop policy if exists "service add ons: authenticated catalog read"
  on public.service_add_ons;
create policy "service add ons: authenticated catalog read"
on public.service_add_ons for select to authenticated
using (public.is_admin() or (public.account_is_active() and enabled));

revoke all on table public.company_compliance_controls from public;
revoke all on table public.company_compliance_controls from anon;
revoke all on table public.company_compliance_controls from authenticated;
grant select on table public.company_compliance_controls to authenticated;

revoke all on table public.service_add_ons from public;
revoke all on table public.service_add_ons from anon;
revoke all on table public.service_add_ons from authenticated;
grant select on table public.service_add_ons to authenticated;

update public.company_compliance_controls
set status = 'REVIEW_REQUIRED', updated_at = now()
where control_key in ('GENERAL_LIABILITY', 'WORKERS_COMP', 'W2_EMPLOYMENT')
  and (
    verified_at is null
    or nullif(trim(evidence_reference), '') is null
    or (expires_at is not null and expires_at < (now() at time zone 'America/New_York')::date)
  );

drop function if exists public.submit_client_service_request(
  public.care_service_type, text, date, integer, date, time, time,
  text[], text, integer, text, text, text, text, text, text, text
);
drop function if exists public.submit_client_service_request(
  public.care_service_type, uuid, text, date, integer, date, time, time,
  text[], text, integer, text, text, text, text, text, text, text, boolean, boolean
);

create function public.submit_client_service_request(
  p_service_type public.care_service_type,
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
  p_special_notes text,
  p_maternal_notes text,
  p_meal_instructions text,
  p_routine_notes text,
  p_pickup_notes text,
  p_request_kind text,
  p_sequence_policy_accepted boolean,
  p_insured_staffing_acknowledged boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  target_baby_id uuid;
  normalized_baby_name text := trim(coalesce(p_baby_name, ''));
  normalized_request_kind text := upper(trim(coalesce(p_request_kind, 'NEW')));
  normalized_days text[];
  daily_duration interval;
  created_request_id uuid;
  calculated_total numeric(10,2);
begin
  if auth.uid() is null then
    raise exception 'An active authenticated client account is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || auth.uid()::text, 0)
  );

  if not public.account_is_active() then
    raise exception 'An active authenticated client account is required';
  end if;

  select member.client_id into target_client_id
  from public.client_members member
  where member.user_id = auth.uid()
  order by member.is_primary desc, member.created_at, member.client_id
  limit 1;

  if target_client_id is null then
    raise exception 'Client membership not found';
  end if;
  if not public.has_role('CLIENT') then
    raise exception 'Only client accounts can submit service requests';
  end if;

  -- Foreign keys on the request need the member profile and client rows. Take
  -- those locks before the baby row, matching the management RPC's
  -- profile -> client -> baby order and avoiding a row-lock inversion.
  perform 1
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.account_status = 'ACTIVE'
    and profile.deleted_at is null
  for key share;

  if not found then
    raise exception 'The client profile is no longer active';
  end if;

  perform 1
  from public.clients client
  where client.id = target_client_id
  for key share;

  if not found then
    raise exception 'Client record not found';
  end if;
  if p_service_type is null then
    raise exception 'A supported service type is required';
  end if;
  if length(normalized_baby_name) not between 1 and 80 then
    raise exception 'Baby name must contain between 1 and 80 characters';
  end if;
  if p_birth_or_due_date is null then
    raise exception 'Birth or due date is required';
  end if;
  if p_requested_weeks is null or p_requested_weeks not in (2, 3, 4) then
    raise exception 'Service length must be 2, 3, or 4 weeks';
  end if;
  if p_desired_start_date is null
     or p_desired_start_date < (now() at time zone 'America/New_York')::date then
    raise exception 'The requested start date cannot be in the past';
  end if;
  if p_daily_start_time is null
     or p_daily_end_time is null
     or p_daily_end_time <= p_daily_start_time then
    raise exception 'A valid same-day care time is required';
  end if;
  if (
    (p_desired_start_date + p_daily_start_time)
      at time zone 'America/New_York'
  ) <= now() then
    raise exception 'The requested service start time must be in the future';
  end if;
  if length(trim(coalesce(p_service_address, ''))) not between 5 and 500 then
    raise exception 'A complete service address is required';
  end if;
  if coalesce(p_household_extra_people, 0) not between 0 and 30 then
    raise exception 'Household count is outside the supported range';
  end if;
  if normalized_request_kind not in ('NEW', 'EXTENSION') then
    raise exception 'Unsupported request kind';
  end if;
  if normalized_request_kind = 'EXTENSION'
     and (p_service_type <> 'BABYSITTING' or p_baby_id is null) then
    raise exception 'Only babysitting can be extended, using an existing baby profile';
  end if;
  if coalesce(cardinality(p_requested_days), 0) not between 1 and 7 then
    raise exception 'At least one recurring service day is required';
  end if;
  if exists (
    select 1
    from unnest(p_requested_days) requested_day
    where requested_day is null
      or trim(requested_day) = ''
      or upper(trim(requested_day)) not in (
      '월', '화', '수', '목', '금', '토', '일',
      'MON', 'MONDAY', 'TUE', 'TUESDAY', 'WED', 'WEDNESDAY',
      'THU', 'THURSDAY', 'FRI', 'FRIDAY', 'SAT', 'SATURDAY',
      'SUN', 'SUNDAY', '1', '2', '3', '4', '5', '6', '7'
    )
  ) then
    raise exception 'Unsupported recurring service day';
  end if;
  if p_sequence_policy_accepted is distinct from true
     or p_insured_staffing_acknowledged is distinct from true then
    raise exception 'The service application consent must be accepted';
  end if;

  normalized_days := public.canonical_service_days(p_requested_days);

  daily_duration := p_daily_end_time - p_daily_start_time;
  if p_service_type = 'POSTPARTUM' then
    if daily_duration <> interval '9 hours 30 minutes' then
      raise exception 'Postpartum visits require an 8-hour care shift plus the scheduled 90-minute meal and rest period';
    end if;
    calculated_total := 1800.00 * p_requested_weeks;
  elsif p_service_type = 'BABYSITTING' then
    if daily_duration < interval '4 hours' or daily_duration > interval '12 hours' then
      raise exception 'Babysitting care time must be between 4 and 12 hours per day';
    end if;
    calculated_total := round(
      (extract(epoch from daily_duration) / 3600.0)
        * 32.00 * cardinality(normalized_days) * p_requested_weeks,
      2
    );
  else
    raise exception 'Unsupported service type';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'client-baby-name:' || target_client_id::text || ':' || lower(normalized_baby_name),
    0
  ));

  if p_baby_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('baby:' || p_baby_id::text, 0)
    );

    select baby.id into target_baby_id
    from public.babies baby
    where baby.id = p_baby_id
      and baby.client_id = target_client_id
    for update;

    if target_baby_id is null then
      raise exception 'The selected baby does not belong to this client';
    end if;
    if not exists (
      select 1 from public.babies baby
      where baby.id = target_baby_id
        and lower(trim(baby.first_name)) = lower(normalized_baby_name)
    ) then
      raise exception 'The selected baby name does not match the saved profile';
    end if;

    if exists (
      select 1 from public.babies baby
      where baby.id = target_baby_id
        and baby.birth_date is not null
        and baby.birth_date <> p_birth_or_due_date
    ) then
      raise exception 'The birth or due date does not match the selected baby profile';
    end if;

    update public.babies
    set birth_date = coalesce(birth_date, p_birth_or_due_date), updated_at = now()
    where id = target_baby_id;
  else
    if exists (
      select 1 from public.babies baby
      where baby.client_id = target_client_id
        and lower(trim(baby.first_name)) = lower(normalized_baby_name)
    ) then
      raise exception 'Select the existing baby instead of creating a duplicate profile';
    end if;

    insert into public.babies (client_id, first_name, birth_date)
    values (target_client_id, normalized_baby_name, p_birth_or_due_date)
    returning id into target_baby_id;

    perform pg_advisory_xact_lock(
      hashtextextended('baby:' || target_baby_id::text, 0)
    );
  end if;

  insert into public.client_service_requests (
    client_id, requested_by, baby_id, birth_or_due_date, requested_weeks,
    desired_start_date, daily_start_time, daily_end_time, service_address,
    household_extra_people, allergy_notes, special_notes, service_type,
    requested_days, maternal_notes, meal_instructions, routine_notes,
    pickup_notes, request_kind, deposit_amount, deposit_status, weekly_rate,
    estimated_total, sequence_policy_accepted, insured_staffing_acknowledged
  ) values (
    target_client_id, auth.uid(), target_baby_id, p_birth_or_due_date, p_requested_weeks,
    p_desired_start_date, p_daily_start_time, p_daily_end_time, trim(p_service_address),
    coalesce(p_household_extra_people, 0),
    coalesce(nullif(trim(p_allergy_notes), ''), '없음'),
    nullif(trim(p_special_notes), ''), p_service_type, normalized_days,
    nullif(trim(p_maternal_notes), ''), nullif(trim(p_meal_instructions), ''),
    nullif(trim(p_routine_notes), ''), nullif(trim(p_pickup_notes), ''),
    normalized_request_kind,
    case p_service_type when 'POSTPARTUM' then 500.00 else 128.00 end,
    'DUE_ON_APPROVAL',
    case when p_service_type = 'POSTPARTUM' then 1800.00 else null end,
    calculated_total,
    true,
    true
  ) returning id into created_request_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'SUBMIT_SERVICE_REQUEST', 'client_service_requests', created_request_id,
    jsonb_build_object(
      'service_type', p_service_type,
      'baby_id', target_baby_id,
      'requested_weeks', p_requested_weeks,
      'request_kind', normalized_request_kind
    )
  );

  return created_request_id;
end;
$$;

drop policy if exists "client requests: applicant create" on public.client_service_requests;
drop policy if exists "client requests: staff review" on public.client_service_requests;
revoke insert, update, delete on table public.client_service_requests from public;
revoke insert, update, delete on table public.client_service_requests from anon;
revoke insert, update, delete on table public.client_service_requests from authenticated;

drop policy if exists "contracts: staff manage" on public.care_contracts;
drop policy if exists "assignments: staff manage" on public.care_assignments;
revoke insert, update, delete on table public.care_contracts from public;
revoke insert, update, delete on table public.care_contracts from anon;
revoke insert, update, delete on table public.care_contracts from authenticated;
revoke insert, update, delete on table public.care_assignments from public;
revoke insert, update, delete on table public.care_assignments from anon;
revoke insert, update, delete on table public.care_assignments from authenticated;

drop policy if exists "caregiver applications: applicant create" on public.caregiver_applications;
drop policy if exists "caregiver applications: staff review" on public.caregiver_applications;
drop policy if exists "caregiver applications: applicant read" on public.caregiver_applications;
drop policy if exists "caregiver applications: applicant or admin read" on public.caregiver_applications;
create policy "caregiver applications: applicant or admin read"
on public.caregiver_applications for select to authenticated
using (
  public.is_admin()
  or (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.account_status in ('PENDING', 'ACTIVE')
    )
  )
);
revoke insert, update, delete on table public.caregiver_applications from public;
revoke insert, update, delete on table public.caregiver_applications from anon;
revoke insert, update, delete on table public.caregiver_applications from authenticated;

drop policy if exists "consents: family create" on public.consents;
revoke insert, update, delete on table public.consents from public;
revoke insert, update, delete on table public.consents from anon;
revoke insert, update, delete on table public.consents from authenticated;

revoke all on function public.submit_client_service_request(
  public.care_service_type, uuid, text, date, integer, date, time, time,
  text[], text, integer, text, text, text, text, text, text, text, boolean, boolean
) from public;
revoke all on function public.submit_client_service_request(
  public.care_service_type, uuid, text, date, integer, date, time, time,
  text[], text, integer, text, text, text, text, text, text, text, boolean, boolean
) from anon;
grant execute on function public.submit_client_service_request(
  public.care_service_type, uuid, text, date, integer, date, time, time,
  text[], text, integer, text, text, text, text, text, text, text, boolean, boolean
) to authenticated;

create or replace function public.approve_caregiver(
  applicant_user_id uuid,
  approval_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  application_id uuid;
  existing_caregiver_id uuid;
  applicant_profile public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can approve caregivers';
  end if;
  if applicant_user_id is null then
    raise exception 'A caregiver applicant is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owner-governance', 0));
  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || applicant_user_id::text, 0)
  );

  select caregiver.id into existing_caregiver_id
  from public.caregivers caregiver
  where caregiver.user_id = applicant_user_id;

  if existing_caregiver_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('caregiver:' || existing_caregiver_id::text, 0)
    );
  end if;

  select profile.* into applicant_profile
  from public.profiles profile
  where profile.id = applicant_user_id
  for update;

  if not found
     or applicant_profile.account_status not in ('PENDING', 'ACTIVE')
     or applicant_profile.deleted_at is not null then
    raise exception 'Active caregiver applicant profile not found';
  end if;
  if applicant_profile.requested_role <> 'CAREGIVER' then
    raise exception 'The member is no longer registered as a caregiver applicant';
  end if;
  if exists (
    select 1 from public.user_roles role
    where role.user_id = applicant_user_id
      and role.role <> 'CAREGIVER'
  ) then
    raise exception 'Use the owner-controlled member role workflow before approving this caregiver application';
  end if;
  if exists (
    select 1 from public.client_members member
    where member.user_id = applicant_user_id
  ) then
    raise exception 'A client member cannot be approved as a caregiver without completing the controlled role transition';
  end if;
  if exists (
    select 1
    from unnest(array[
      'SERVICE_TERMS', 'PRIVACY', 'SENSITIVE_CARE_DATA'
    ]::text[]) required_consent(consent_type)
    where not exists (
      select 1
      from public.member_consents consent
      where consent.user_id = applicant_user_id
        and consent.consent_type = required_consent.consent_type
        and consent.version = public.current_consent_version()
        and consent.granted
        and consent.granted_at is not null
        and consent.revoked_at is null
    )
  ) then
    raise exception 'Verified caregiver signup consent evidence is required before approval';
  end if;

  select application.id into application_id
  from public.caregiver_applications application
  where application.user_id = applicant_user_id
    and application.status = 'PENDING'
  for update;

  if application_id is null then
    raise exception 'Pending caregiver application not found';
  end if;

  update public.caregiver_applications
  set status = 'APPROVED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(approval_note), '')
  where id = application_id;

  insert into public.user_roles(user_id, role)
  values (applicant_user_id, 'CAREGIVER')
  on conflict do nothing;

  insert into public.caregivers(user_id, status)
  values (applicant_user_id, 'ACTIVE')
  on conflict (user_id) do update
  set status = 'ACTIVE', updated_at = now();

  insert into public.caregiver_hr_profiles(
    caregiver_id, employment_status, updated_by
  )
  select caregiver.id, 'APPLICANT', auth.uid()
  from public.caregivers caregiver
  where caregiver.user_id = applicant_user_id
  on conflict (caregiver_id) do nothing;

  update public.profiles
  set requested_role = 'CAREGIVER', account_status = 'ACTIVE', updated_at = now()
  where id = applicant_user_id;

  if not found then
    raise exception 'Caregiver profile not found';
  end if;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'APPROVE_CAREGIVER', 'caregiver_applications', application_id,
    jsonb_build_object('applicant_user_id', applicant_user_id)
  );
end;
$$;

revoke all on function public.approve_caregiver(uuid, text) from public;
revoke all on function public.approve_caregiver(uuid, text) from anon;
grant execute on function public.approve_caregiver(uuid, text) to authenticated;

create or replace function public.update_my_profile(
  p_full_name text,
  p_phone text,
  p_preferred_language text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.profiles%rowtype;
  normalized_language text := lower(trim(coalesce(p_preferred_language, '')));
begin
  if auth.uid() is null then
    raise exception 'An authenticated, non-suspended account is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || auth.uid()::text, 0)
  );

  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.account_status in ('PENDING', 'ACTIVE')
      and profile.deleted_at is null
  ) then
    raise exception 'An authenticated, non-suspended account is required';
  end if;
  if length(trim(coalesce(p_full_name, ''))) not between 2 and 100 then
    raise exception 'Full name must contain between 2 and 100 characters';
  end if;
  if p_phone is not null and length(trim(p_phone)) > 40 then
    raise exception 'Phone number is too long';
  end if;
  if normalized_language not in ('ko', 'en', 'ko,en') then
    raise exception 'Unsupported preferred language';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = nullif(trim(p_phone), ''),
      preferred_language = normalized_language,
      updated_at = now()
  where id = auth.uid()
  returning * into updated_profile;

  if not found then
    raise exception 'Profile not found';
  end if;

  update public.clients client
  set display_name = trim(p_full_name), updated_at = now()
  from public.client_members member
  where member.client_id = client.id
    and member.user_id = auth.uid()
    and member.is_primary;

  insert into public.client_management_profiles (
    client_id, preferred_language, updated_by
  )
  select member.client_id, normalized_language, auth.uid()
  from public.client_members member
  where member.user_id = auth.uid() and member.is_primary
  on conflict (client_id) do update set
    preferred_language = excluded.preferred_language,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'UPDATE_MY_PROFILE', 'profiles', auth.uid(),
    jsonb_build_object('preferred_language', updated_profile.preferred_language)
  );

  return updated_profile;
end;
$$;

drop policy if exists "profiles: self update" on public.profiles;
revoke update on table public.profiles from public;
revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;
revoke all on function public.update_my_profile(text, text, text) from public;
revoke all on function public.update_my_profile(text, text, text) from anon;
grant execute on function public.update_my_profile(text, text, text) to authenticated;

drop function if exists public.my_assignment_briefs();
create function public.my_assignment_briefs()
returns table (
  assignment_id uuid,
  baby_id uuid,
  baby_name text,
  caregiver_user_id uuid,
  caregiver_display_name text,
  caregiver_certification_summary text,
  client_id uuid,
  preferred_language text,
  emergency_contact text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    assignment.id,
    contract.baby_id,
    baby.first_name,
    caregiver.user_id,
    caregiver_profile.full_name,
    caregiver_application.certification_summary,
    contract.client_id,
    coalesce(client_management.preferred_language, primary_client_profile.preferred_language),
    client_management.emergency_contact
  from public.care_assignments assignment
  join public.care_contracts contract on contract.id = assignment.contract_id
  left join public.babies baby on baby.id = contract.baby_id
  join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
  join public.profiles caregiver_profile on caregiver_profile.id = caregiver.user_id
  left join public.caregiver_applications caregiver_application
    on caregiver_application.user_id = caregiver.user_id
  left join public.client_management_profiles client_management
    on client_management.client_id = contract.client_id
  left join lateral (
    select profile.preferred_language
    from public.client_members member
    join public.profiles profile on profile.id = member.user_id
    where member.client_id = contract.client_id and member.is_primary
    order by member.created_at
    limit 1
  ) primary_client_profile on true
  where assignment.status in ('PROPOSED', 'CONFIRMED')
    and contract.status in ('PENDING', 'ACTIVE', 'PAUSED')
    and assignment.starts_at <= now() + interval '180 days'
    and assignment.ends_at >= now() - interval '30 days'
    and (
      public.is_care_staff()
      or (
        caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and caregiver_profile.account_status = 'ACTIVE'
        and public.current_user_is_active_caregiver()
      )
      or public.is_client_member(contract.client_id)
    );
$$;

revoke all on function public.my_assignment_briefs() from public;
revoke all on function public.my_assignment_briefs() from anon;
grant execute on function public.my_assignment_briefs() to authenticated;

drop policy if exists "caregiver reviews: client submits once after care"
  on public.caregiver_reviews;
drop policy if exists "caregiver reviews: client submits after completed assignment"
  on public.caregiver_reviews;
create policy "caregiver reviews: client submits after completed assignment"
on public.caregiver_reviews for insert to authenticated
with check (
  created_by = auth.uid()
  and public.is_client_member(client_id)
  and exists (
    select 1
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.id = caregiver_reviews.assignment_id
      and assignment.caregiver_id = caregiver_reviews.caregiver_id
      and contract.client_id = caregiver_reviews.client_id
      and (
        assignment.status = 'COMPLETED'
        or (
          assignment.status = 'CONFIRMED'
          and assignment.ends_at < now()
        )
      )
  )
);

drop policy if exists "caregiver hr profiles: staff read"
  on public.caregiver_hr_profiles;
drop policy if exists "caregiver hr profiles: administrators read"
  on public.caregiver_hr_profiles;
create policy "caregiver hr profiles: administrators read"
on public.caregiver_hr_profiles for select to authenticated
using (public.is_admin());

revoke update, delete on table public.caregiver_reviews from public;
revoke update, delete on table public.caregiver_reviews from anon;
revoke update, delete on table public.caregiver_reviews from authenticated;
grant select, insert on table public.caregiver_reviews to authenticated;

create or replace function public.schedule_approved_client_request(
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
  requested_start timestamptz;
  requested_end timestamptz;
  requested_end_date date;
  required_deposit numeric(10,2);
  requester_user_id uuid;
begin
  if not public.is_care_staff() then
    raise exception 'Only authorized care staff can schedule client requests';
  end if;
  if p_request_id is null or p_caregiver_id is null then
    raise exception 'A service request and caregiver are required';
  end if;

  select request.requested_by into requester_user_id
  from public.client_service_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'Approved unscheduled client request not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || requester_user_id::text, 0)
  );

  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id
    and request.status = 'APPROVED'
    and request.approved_assignment_id is null
  for update;

  if not found then
    raise exception 'Approved unscheduled client request not found';
  end if;
  if not exists (
    select 1
    from public.client_members member
    join public.profiles profile on profile.id = member.user_id
    join public.user_roles role
      on role.user_id = member.user_id and role.role = 'CLIENT'
    where member.client_id = request_row.client_id
      and member.user_id = request_row.requested_by
      and profile.account_status = 'ACTIVE'
      and profile.deleted_at is null
  ) then
    raise exception 'The requesting client account is no longer active';
  end if;
  if length(trim(coalesce(request_row.service_address, ''))) not between 5 and 500
     or coalesce(request_row.household_extra_people, -1) not between 0 and 30 then
    raise exception 'The request must contain a valid service address and household count';
  end if;
  if request_row.baby_id is null
     or not exists (
       select 1 from public.babies baby
       where baby.id = request_row.baby_id
         and baby.client_id = request_row.client_id
     ) then
    raise exception 'The request must identify a baby belonging to the client';
  end if;
  if request_row.sequence_policy_accepted is distinct from true
     or request_row.insured_staffing_acknowledged is distinct from true then
    raise exception 'The request is missing its required service consent';
  end if;
  if exists (
    select 1
    from public.service_adjustment_requests pending_adjustment
    where pending_adjustment.client_service_request_id = request_row.id
      and pending_adjustment.status = 'PENDING'
  ) then
    raise exception 'This service has a pending change or cancellation request';
  end if;

  perform public.lock_care_schedule(
    p_caregiver_id,
    request_row.baby_id,
    request_row.client_id
  );

  if not exists (
    select 1
    from public.caregivers caregiver
    join public.profiles profile on profile.id = caregiver.user_id
    join public.user_roles role
      on role.user_id = caregiver.user_id and role.role = 'CAREGIVER'
    join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
    where caregiver.id = p_caregiver_id
      and caregiver.status = 'ACTIVE'
      and profile.account_status = 'ACTIVE'
      and profile.deleted_at is null
      and hr.employment_status = 'ACTIVE'
  ) then
    raise exception 'Selected caregiver is not an active approved caregiver';
  end if;

  required_deposit := case request_row.service_type
    when 'POSTPARTUM' then 500.00
    when 'BABYSITTING' then 128.00
    else null
  end;

  if required_deposit is null
     or request_row.deposit_amount <> required_deposit
     or request_row.deposit_status <> 'PAID'
     or request_row.deposit_paid_at is null
     or not exists (
       select 1
       from public.deposit_transactions deposit
       where deposit.client_service_request_id = request_row.id
         and deposit.client_id = request_row.client_id
         and deposit.status = 'CAPTURED'
         and deposit.amount = required_deposit
         and deposit.currency = 'USD'
         and deposit.captured_at is not null
     ) then
    raise exception 'A matching captured reservation deposit is required before scheduling';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('company-compliance-scheduling', 0)
  );

  if not public.company_care_compliance_is_current() then
    raise exception 'Current liability, workers compensation, and W-2 evidence must be verified before scheduling';
  end if;

  requested_end_date := request_row.desired_start_date
    + (request_row.requested_weeks * 7 - 1);
  requested_start := (
    request_row.desired_start_date + request_row.daily_start_time
  ) at time zone 'America/New_York';
  requested_end := (
    requested_end_date + request_row.daily_end_time
  ) at time zone 'America/New_York';

  if request_row.request_kind = 'EXTENSION'
     and request_row.service_type <> 'BABYSITTING' then
    raise exception 'Only babysitting requests can extend an existing service';
  end if;
  if requested_start <= now() then
    raise exception 'The approved service start must still be in the future';
  end if;

  if not public.caregiver_schedule_is_available(
    p_caregiver_id,
    request_row.desired_start_date,
    requested_end_date,
    request_row.daily_start_time,
    request_row.daily_end_time,
    request_row.requested_days,
    null
  ) then
    raise exception 'The selected caregiver has an overlapping service-day schedule';
  end if;

  insert into public.care_contracts (
    client_id, baby_id, start_date, end_date, agreed_rate, status, created_by
  ) values (
    request_row.client_id, request_row.baby_id, request_row.desired_start_date,
    requested_end_date, request_row.estimated_total, 'ACTIVE', auth.uid()
  ) returning id into created_contract_id;

  insert into public.care_assignments (
    contract_id, caregiver_id, starts_at, ends_at, status, assigned_by,
    service_address, daily_start_time, daily_end_time, household_extra_people,
    allergy_notes, client_request_note, contract_weeks, service_type, service_days,
    maternal_notes, meal_instructions, routine_notes, pickup_notes, weekly_rate,
    contract_value, deposit_amount, deposit_status, deposit_paid_at, updated_by,
    insured_staffing, employee_classification
  ) values (
    created_contract_id, p_caregiver_id, requested_start, requested_end,
    'CONFIRMED', auth.uid(), request_row.service_address,
    request_row.daily_start_time, request_row.daily_end_time,
    request_row.household_extra_people, request_row.allergy_notes,
    request_row.special_notes, request_row.requested_weeks,
    request_row.service_type, request_row.requested_days,
    request_row.maternal_notes, request_row.meal_instructions,
    request_row.routine_notes, request_row.pickup_notes,
    request_row.weekly_rate, request_row.estimated_total,
    request_row.deposit_amount, request_row.deposit_status,
    request_row.deposit_paid_at, auth.uid(), true, 'W-2'
  ) returning id into created_assignment_id;

  update public.client_service_requests
  set approved_assignment_id = created_assignment_id,
      updated_at = now()
  where id = request_row.id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'SCHEDULE_SERVICE_REQUEST', 'care_assignments', created_assignment_id,
    jsonb_build_object(
      'request_id', request_row.id,
      'client_id', request_row.client_id,
      'baby_id', request_row.baby_id,
      'caregiver_id', p_caregiver_id,
      'service_type', request_row.service_type
    )
  );

  return created_assignment_id;
end;
$$;

revoke all on function public.schedule_approved_client_request(uuid, uuid) from public;
revoke all on function public.schedule_approved_client_request(uuid, uuid) from anon;
grant execute on function public.schedule_approved_client_request(uuid, uuid) to authenticated;

revoke all on function public.caregiver_schedule_is_available(
  uuid, date, date, time, time, text[], uuid
) from public;
revoke all on function public.caregiver_schedule_is_available(
  uuid, date, date, time, time, text[], uuid
) from anon;
revoke all on function public.caregiver_schedule_is_available(
  uuid, date, date, time, time, text[], uuid
) from authenticated;
revoke all on function public.lock_care_schedule(uuid, uuid, uuid) from public;
revoke all on function public.lock_care_schedule(uuid, uuid, uuid) from anon;
revoke all on function public.lock_care_schedule(uuid, uuid, uuid) from authenticated;

create or replace function public.admin_update_company_compliance(
  p_control_key text,
  p_status text,
  p_verified_at timestamptz,
  p_expires_at date,
  p_evidence_reference text,
  p_notes text
)
returns public.company_compliance_controls
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := upper(trim(coalesce(p_status, '')));
  saved_control public.company_compliance_controls%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can update compliance evidence';
  end if;
  if normalized_status not in ('ACTIVE', 'REVIEW_REQUIRED', 'INACTIVE') then
    raise exception 'Unsupported compliance status';
  end if;
  if normalized_status = 'ACTIVE' and (
    p_verified_at is null
    or p_verified_at > now() + interval '5 minutes'
    or nullif(trim(coalesce(p_evidence_reference, '')), '') is null
    or (
      p_expires_at is not null
      and p_expires_at < (now() at time zone 'America/New_York')::date
    )
  ) then
    raise exception 'Active compliance controls require current verification evidence';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('company-compliance-scheduling', 0)
  );

  update public.company_compliance_controls
  set status = normalized_status,
      verified_at = p_verified_at,
      expires_at = p_expires_at,
      evidence_reference = nullif(trim(p_evidence_reference), ''),
      notes = nullif(trim(p_notes), ''),
      updated_by = auth.uid(),
      updated_at = now()
  where control_key = upper(trim(coalesce(p_control_key, '')))
  returning * into saved_control;

  if not found then
    raise exception 'Compliance control not found';
  end if;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'UPDATE_COMPANY_COMPLIANCE', 'company_compliance_controls', saved_control.id,
    jsonb_build_object(
      'control_key', saved_control.control_key,
      'status', saved_control.status,
      'expires_at', saved_control.expires_at
    )
  );

  return saved_control;
end;
$$;

revoke all on function public.admin_update_company_compliance(
  text, text, timestamptz, date, text, text
) from public;
revoke all on function public.admin_update_company_compliance(
  text, text, timestamptz, date, text, text
) from anon;
grant execute on function public.admin_update_company_compliance(
  text, text, timestamptz, date, text, text
) to authenticated;

-- Narrow family and caregiver reads to the exact assignment and baby. Care
-- managers keep operational schedule access, while HR and governance remain at
-- the ADMIN/OWNER boundary.
drop policy if exists "clients: active assigned caregiver read" on public.clients;
drop policy if exists "clients: approved member or staff read" on public.clients;
drop policy if exists "clients: member or staff read" on public.clients;
drop policy if exists "clients: family staff exact caregiver read" on public.clients;
create policy "clients: family staff exact caregiver read"
on public.clients for select to authenticated
using (
  public.is_care_staff()
  or public.is_client_member(id)
  or (
    public.account_is_active()
    and exists (
      select 1
      from public.care_contracts contract
      join public.care_assignments assignment on assignment.contract_id = contract.id
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where contract.client_id = clients.id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.starts_at <= now() + interval '180 days'
        and assignment.ends_at >= now() - interval '30 days'
    )
  )
);

drop policy if exists "babies: active assigned caregiver read" on public.babies;
drop policy if exists "babies: approved family or staff read" on public.babies;
drop policy if exists "babies: family or staff read" on public.babies;
drop policy if exists "babies: family staff exact caregiver read" on public.babies;
create policy "babies: family staff exact caregiver read"
on public.babies for select to authenticated
using (
  public.is_care_staff()
  or public.is_client_member(client_id)
  or (
    public.account_is_active()
    and exists (
      select 1
      from public.care_contracts contract
      join public.care_assignments assignment on assignment.contract_id = contract.id
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where contract.baby_id = babies.id
        and contract.client_id = babies.client_id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.starts_at <= now() + interval '180 days'
        and assignment.ends_at >= now() - interval '30 days'
    )
  )
);

drop policy if exists "babies: family insert" on public.babies;
drop policy if exists "babies: family update" on public.babies;
revoke insert, update, delete on table public.babies from public;
revoke insert, update, delete on table public.babies from anon;
revoke insert, update, delete on table public.babies from authenticated;

drop policy if exists "contracts: active assigned caregiver read" on public.care_contracts;
drop policy if exists "contracts: family or staff read" on public.care_contracts;
drop policy if exists "contracts: family care team or staff read" on public.care_contracts;
drop policy if exists "contracts: family staff exact caregiver read" on public.care_contracts;
create policy "contracts: family staff exact caregiver read"
on public.care_contracts for select to authenticated
using (
  public.is_care_staff()
  or public.is_client_member(client_id)
  or (
    public.account_is_active()
    and exists (
      select 1
      from public.care_assignments assignment
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where assignment.contract_id = care_contracts.id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.starts_at <= now() + interval '180 days'
        and assignment.ends_at >= now() - interval '30 days'
    )
  )
);

drop policy if exists "assignments: assigned caregiver or staff read" on public.care_assignments;
drop policy if exists "assignments: care team or family read" on public.care_assignments;
drop policy if exists "assignments: exact participants read" on public.care_assignments;
create policy "assignments: exact participants read"
on public.care_assignments for select to authenticated
using (
  public.is_care_staff()
  or (
    public.current_user_is_active_caregiver()
    and exists (
      select 1 from public.caregivers caregiver
      where caregiver.id = care_assignments.caregiver_id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
    )
    and care_assignments.status in ('PROPOSED', 'CONFIRMED')
    and care_assignments.starts_at <= now() + interval '180 days'
    and care_assignments.ends_at >= now() - interval '30 days'
  )
  or exists (
    select 1 from public.care_contracts contract
    where contract.id = care_assignments.contract_id
      and public.is_client_member(contract.client_id)
  )
);

drop policy if exists "sessions: assigned caregiver or staff read" on public.care_sessions;
drop policy if exists "sessions: active care team or staff read" on public.care_sessions;
drop policy if exists "sessions: care team or family read" on public.care_sessions;
drop policy if exists "sessions: exact participants read" on public.care_sessions;
create policy "sessions: exact participants read"
on public.care_sessions for select to authenticated
using (
  public.is_care_staff()
  or (
    public.account_is_active()
    and exists (
      select 1
      from public.care_assignments assignment
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where assignment.id = care_sessions.assignment_id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.starts_at <= now() + interval '180 days'
        and assignment.ends_at >= now() - interval '30 days'
    )
  )
  or exists (
    select 1
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.id = care_sessions.assignment_id
      and public.is_client_member(contract.client_id)
  )
);

drop policy if exists "events: assignment participants read" on public.care_events;
create policy "events: assignment participants read"
on public.care_events for select to authenticated
using (
  public.is_care_staff()
  or exists (
    select 1
    from public.care_sessions session
    join public.care_assignments assignment on assignment.id = session.assignment_id
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where session.id = care_events.care_session_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and public.account_is_active()
      and assignment.starts_at <= now() + interval '180 days'
      and assignment.ends_at >= now() - interval '30 days'
  )
  or exists (
    select 1
    from public.care_sessions session
    join public.care_assignments assignment on assignment.id = session.assignment_id
    join public.care_contracts contract on contract.id = assignment.contract_id
    where session.id = care_events.care_session_id
      and public.is_client_member(contract.client_id)
  )
);

drop policy if exists "caregiver reviews: related parties read" on public.caregiver_reviews;
drop policy if exists "caregiver reviews: active related parties read" on public.caregiver_reviews;
create policy "caregiver reviews: active related parties read"
on public.caregiver_reviews for select to authenticated
using (
  public.is_care_staff()
  or public.is_client_member(client_id)
  or (
    public.account_is_active()
    and exists (
      select 1 from public.caregivers caregiver
      where caregiver.id = caregiver_reviews.caregiver_id
        and caregiver.user_id = auth.uid()
    )
  )
);

drop policy if exists "consents: family or staff read" on public.consents;
drop policy if exists "consents: family or admin read" on public.consents;
create policy "consents: family or admin read"
on public.consents for select to authenticated
using (public.is_admin() or public.is_client_member(client_id));

drop policy if exists "audit logs: staff read" on public.audit_logs;
drop policy if exists "audit logs: administrators read" on public.audit_logs;
create policy "audit logs: administrators read"
on public.audit_logs for select to authenticated
using (public.is_admin());

drop policy if exists "client members: staff manage" on public.client_members;
revoke insert, update, delete on table public.client_members from public;
revoke insert, update, delete on table public.client_members from anon;
revoke insert, update, delete on table public.client_members from authenticated;

comment on function public.submit_client_service_request(
  public.care_service_type, uuid, text, date, integer, date, time, time,
  text[], text, integer, text, text, text, text, text, text, text, boolean, boolean
) is 'Creates a consent-bound, baby-owned service request through the only browser write path.';
comment on function public.schedule_approved_client_request(uuid, uuid) is
  'Serializes caregiver and baby scheduling and requires matching deposit and current employment/insurance evidence.';
comment on function public.my_assignment_briefs() is
  'Returns minimum baby, caregiver, and client safety fields for exact active assignment participants.';

-- SECURITY DEFINER boolean helpers keep cross-table RLS checks exact without
-- creating recursive policy evaluation between contracts and assignments.
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
      and assignment.status in ('PROPOSED', 'CONFIRMED')
      and assignment.starts_at <= now() + interval '180 days'
      and assignment.ends_at >= now() - interval '30 days'
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
      and assignment.status in ('PROPOSED', 'CONFIRMED')
      and assignment.starts_at <= now() + interval '180 days'
      and assignment.ends_at >= now() - interval '30 days'
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
      and assignment.status in ('PROPOSED', 'CONFIRMED')
      and assignment.starts_at <= now() + interval '180 days'
      and assignment.ends_at >= now() - interval '30 days'
  );
$$;

create or replace function public.can_read_care_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_care_staff() or exists (
    select 1
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.id = p_assignment_id
      and public.is_client_member(contract.client_id)
  ) or (
    public.current_user_is_active_caregiver() and exists (
      select 1
      from public.care_assignments assignment
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where assignment.id = p_assignment_id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.starts_at <= now() + interval '180 days'
        and assignment.ends_at >= now() - interval '30 days'
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
  select public.is_care_staff() or exists (
    select 1
    from public.care_sessions session
    join public.care_assignments assignment on assignment.id = session.assignment_id
    join public.care_contracts contract on contract.id = assignment.contract_id
    where session.id = p_session_id
      and public.is_client_member(contract.client_id)
  ) or (
    public.current_user_is_active_caregiver() and exists (
      select 1
      from public.care_sessions session
      join public.care_assignments assignment on assignment.id = session.assignment_id
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where session.id = p_session_id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.starts_at <= now() + interval '180 days'
        and assignment.ends_at >= now() - interval '30 days'
    )
  );
$$;

drop policy if exists "clients: family staff exact caregiver read" on public.clients;
create policy "clients: family staff exact caregiver read"
on public.clients for select to authenticated
using (
  public.is_care_staff()
  or public.is_client_member(id)
  or public.caregiver_can_access_client(id)
);

drop policy if exists "babies: family staff exact caregiver read" on public.babies;
create policy "babies: family staff exact caregiver read"
on public.babies for select to authenticated
using (
  public.is_care_staff()
  or public.is_client_member(client_id)
  or public.caregiver_can_access_baby(id)
);

drop policy if exists "contracts: family staff exact caregiver read" on public.care_contracts;
create policy "contracts: family staff exact caregiver read"
on public.care_contracts for select to authenticated
using (
  public.is_care_staff()
  or public.is_client_member(client_id)
  or public.caregiver_can_access_contract(id)
);

drop policy if exists "assignments: exact participants read" on public.care_assignments;
create policy "assignments: exact participants read"
on public.care_assignments for select to authenticated
using (public.can_read_care_assignment(id));

drop policy if exists "sessions: exact participants read" on public.care_sessions;
create policy "sessions: exact participants read"
on public.care_sessions for select to authenticated
using (public.can_read_care_session(id));

drop policy if exists "events: assignment participants read" on public.care_events;
create policy "events: assignment participants read"
on public.care_events for select to authenticated
using (public.can_read_care_session(care_session_id));

revoke all on function public.caregiver_can_access_client(uuid) from public;
revoke all on function public.caregiver_can_access_client(uuid) from anon;
grant execute on function public.caregiver_can_access_client(uuid) to authenticated;
revoke all on function public.caregiver_can_access_baby(uuid) from public;
revoke all on function public.caregiver_can_access_baby(uuid) from anon;
grant execute on function public.caregiver_can_access_baby(uuid) to authenticated;
revoke all on function public.caregiver_can_access_contract(uuid) from public;
revoke all on function public.caregiver_can_access_contract(uuid) from anon;
grant execute on function public.caregiver_can_access_contract(uuid) to authenticated;
revoke all on function public.can_read_care_assignment(uuid) from public;
revoke all on function public.can_read_care_assignment(uuid) from anon;
grant execute on function public.can_read_care_assignment(uuid) to authenticated;
revoke all on function public.can_read_care_session(uuid) from public;
revoke all on function public.can_read_care_session(uuid) from anon;
grant execute on function public.can_read_care_session(uuid) to authenticated;

-- Legacy rows without a baby identifier are treated conservatively as
-- client-wide conflicts. New rows always carry an exact baby identifier.
create or replace function public.enforce_assignment_service_sequence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_client_id uuid;
  target_baby_id uuid;
begin
  if new.status in ('CANCELLED', 'COMPLETED') then
    return new;
  end if;

  select contract.client_id, contract.baby_id
  into target_client_id, target_baby_id
  from public.care_contracts contract
  where contract.id = new.contract_id;

  if target_client_id is null then
    raise exception 'Assignment contract not found';
  end if;

  if exists (
    select 1
    from public.care_assignments existing_assignment
    join public.care_contracts existing_contract
      on existing_contract.id = existing_assignment.contract_id
    where existing_assignment.id <> new.id
      and existing_assignment.status not in ('CANCELLED', 'COMPLETED')
      and existing_contract.client_id = target_client_id
      and (
        target_baby_id is null
        or existing_contract.baby_id is null
        or existing_contract.baby_id = target_baby_id
      )
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
  if new.status in ('REJECTED', 'CANCELLED') then
    return new;
  end if;

  request_end_date := new.desired_start_date + (new.requested_weeks * 7 - 1);

  if new.service_type = 'BABYSITTING'
     and (tg_op = 'INSERT' or old.service_type is distinct from new.service_type)
     and exists (
       select 1
       from public.care_assignments postpartum_assignment
       join public.care_contracts postpartum_contract
         on postpartum_contract.id = postpartum_assignment.contract_id
       where postpartum_assignment.status not in ('CANCELLED', 'COMPLETED')
         and postpartum_assignment.service_type = 'POSTPARTUM'
         and postpartum_contract.client_id = new.client_id
         and (
           new.baby_id is null
           or postpartum_contract.baby_id is null
           or postpartum_contract.baby_id = new.baby_id
         )
         and now() between postpartum_assignment.starts_at and postpartum_assignment.ends_at
     ) then
    raise exception 'The selected baby cannot begin babysitting while postpartum care is active';
  end if;

  if exists (
    select 1
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.status not in ('CANCELLED', 'COMPLETED')
      and (new.approved_assignment_id is null or assignment.id <> new.approved_assignment_id)
      and contract.client_id = new.client_id
      and (
        new.baby_id is null
        or contract.baby_id is null
        or contract.baby_id = new.baby_id
      )
      and daterange(
            (assignment.starts_at at time zone 'America/New_York')::date,
            (assignment.ends_at at time zone 'America/New_York')::date,
            '[]'
          ) && daterange(new.desired_start_date, request_end_date, '[]')
  ) then
    raise exception 'The requested period overlaps another service for the selected baby';
  end if;

  if exists (
    select 1
    from public.client_service_requests existing_request
    where existing_request.id <> new.id
      and existing_request.client_id = new.client_id
      and existing_request.status in ('PENDING', 'APPROVED')
      and existing_request.approved_assignment_id is null
      and (
        new.baby_id is null
        or existing_request.baby_id is null
        or existing_request.baby_id = new.baby_id
      )
      and daterange(
            existing_request.desired_start_date,
            existing_request.desired_start_date
              + (existing_request.requested_weeks * 7 - 1),
            '[]'
          ) && daterange(new.desired_start_date, request_end_date, '[]')
  ) then
    raise exception 'The requested period overlaps another pending request for the selected baby';
  end if;

  if new.service_type = 'POSTPARTUM' then
    new.weekly_rate := 1800.00;
    new.estimated_total := 1800.00 * new.requested_weeks;
  end if;

  return new;
end;
$$;

-- Service-specific event types are enforced in the database, not only in the UI.
create or replace function public.enforce_care_event_service_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_service_type public.care_service_type;
begin
  select assignment.service_type
  into target_service_type
  from public.care_sessions session
  join public.care_assignments assignment on assignment.id = session.assignment_id
  where session.id = new.care_session_id;

  if target_service_type is null then
    raise exception 'Care session assignment not found';
  end if;

  if target_service_type = 'BABYSITTING'
     and new.event_type not in ('MEAL', 'SITTER_NOTE') then
    raise exception 'Babysitting sessions accept only meal and activity-note events';
  end if;
  if target_service_type = 'POSTPARTUM'
     and new.event_type not in (
       'FEEDING', 'DIAPER', 'SLEEP', 'TEMPERATURE',
       'BATH', 'WEIGHT', 'MOTHER_CARE', 'NOTE'
     ) then
    raise exception 'Postpartum sessions do not accept babysitting event types';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_care_event_service_scope_trigger
  on public.care_events;
create trigger enforce_care_event_service_scope_trigger
before insert or update of care_session_id, event_type
on public.care_events
for each row execute function public.enforce_care_event_service_scope();

revoke all on function public.enforce_care_event_service_scope() from public;
revoke all on function public.enforce_care_event_service_scope() from anon;
revoke all on function public.enforce_care_event_service_scope() from authenticated;

-- Storage access follows active-account boundaries. Client-scoped documents
-- remain limited to the owning family and administrative care staff until the
-- upload UI adopts an assignment-scoped path; a caregiver must never inherit
-- access to every document belonging to the same family.
create or replace function public.caregiver_has_active_assignment(
  target_client_id uuid
)
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
    join public.profiles profile on profile.id = caregiver.user_id
    join public.care_contracts contract on contract.id = assignment.contract_id
    where caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and profile.account_status = 'ACTIVE'
      and profile.deleted_at is null
      and contract.client_id = target_client_id
      and assignment.status = 'CONFIRMED'
      and now() between assignment.starts_at and assignment.ends_at
  );
$$;

revoke all on function public.caregiver_has_active_assignment(uuid) from public;
revoke all on function public.caregiver_has_active_assignment(uuid) from anon;
grant execute on function public.caregiver_has_active_assignment(uuid) to authenticated;

drop policy if exists "profile photos: owner or staff read" on storage.objects;
create policy "profile photos: owner or staff read"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    public.is_care_staff()
    or (
      public.account_is_active()
      and split_part(name, '/', 1) = auth.uid()::text
    )
  )
);

drop policy if exists "profile photos: owner or staff insert" on storage.objects;
create policy "profile photos: owner or staff insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (
    public.is_care_staff()
    or (
      public.account_is_active()
      and split_part(name, '/', 1) = auth.uid()::text
    )
  )
);

drop policy if exists "profile photos: owner or staff update" on storage.objects;
create policy "profile photos: owner or staff update"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    public.is_care_staff()
    or (
      public.account_is_active()
      and split_part(name, '/', 1) = auth.uid()::text
    )
  )
)
with check (
  bucket_id = 'profile-photos'
  and (
    public.is_care_staff()
    or (
      public.account_is_active()
      and split_part(name, '/', 1) = auth.uid()::text
    )
  )
);

drop policy if exists "profile photos: owner or staff delete" on storage.objects;
create policy "profile photos: owner or staff delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    public.is_care_staff()
    or (
      public.account_is_active()
      and split_part(name, '/', 1) = auth.uid()::text
    )
  )
);

drop policy if exists "caregiver certificates: owner or staff read" on storage.objects;
create policy "caregiver certificates: owner or staff read"
on storage.objects for select to authenticated
using (
  bucket_id = 'caregiver-certificates'
  and (
    public.is_admin()
    or (
      public.account_is_active()
      and split_part(name, '/', 1) = auth.uid()::text
    )
  )
);

drop policy if exists "caregiver certificates: owner or staff insert" on storage.objects;
create policy "caregiver certificates: owner or staff insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'caregiver-certificates'
  and (
    public.is_admin()
    or (
      public.account_is_active()
      and split_part(name, '/', 1) = auth.uid()::text
    )
  )
);

drop policy if exists "caregiver certificates: staff update" on storage.objects;
create policy "caregiver certificates: staff update"
on storage.objects for update to authenticated
using (bucket_id = 'caregiver-certificates' and public.is_admin())
with check (bucket_id = 'caregiver-certificates' and public.is_admin());

drop policy if exists "caregiver certificates: staff delete" on storage.objects;
create policy "caregiver certificates: staff delete"
on storage.objects for delete to authenticated
using (bucket_id = 'caregiver-certificates' and public.is_admin());

drop policy if exists "client documents: authorized read" on storage.objects;
create policy "client documents: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id in ('contracts', 'care-reports', 'attachments')
  and (
    public.is_care_staff()
    or public.is_client_member(public.storage_client_id(name))
  )
);

drop policy if exists "client uploads: family or staff insert" on storage.objects;
create policy "client uploads: family or staff insert"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('contracts', 'attachments')
  and (
    public.is_care_staff()
    or public.is_client_member(public.storage_client_id(name))
  )
);

drop policy if exists "care reports: staff insert" on storage.objects;
create policy "care reports: staff insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'care-reports' and public.is_care_staff());

drop policy if exists "client documents: staff update" on storage.objects;
create policy "client documents: staff update"
on storage.objects for update to authenticated
using (
  bucket_id in ('contracts', 'care-reports', 'attachments')
  and public.is_care_staff()
)
with check (
  bucket_id in ('contracts', 'care-reports', 'attachments')
  and public.is_care_staff()
);

drop policy if exists "client documents: staff delete" on storage.objects;
create policy "client documents: staff delete"
on storage.objects for delete to authenticated
using (
  bucket_id in ('contracts', 'care-reports', 'attachments')
  and public.is_care_staff()
);

-- Reports are published only from a completed daily care session. The RPC
-- derives the client and service type server-side and writes an audit event.
create or replace function public.publish_care_report(
  p_care_session_id uuid,
  p_title text
)
returns public.care_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.care_sessions%rowtype;
  target_client_id uuid;
  target_service_type public.care_service_type;
  report_snapshot jsonb;
  saved_report public.care_reports%rowtype;
begin
  if not public.is_care_staff() then
    raise exception 'Only authorized care staff can publish reports';
  end if;
  if length(trim(coalesce(p_title, ''))) not between 3 and 200 then
    raise exception 'A report title must contain between 3 and 200 characters';
  end if;

  select session.* into session_row
  from public.care_sessions session
  where session.id = p_care_session_id
  for update;

  if not found then
    raise exception 'Care session not found';
  end if;
  if session_row.status <> 'COMPLETED' or session_row.ended_at is null then
    raise exception 'Only a completed care session can be published';
  end if;

  select
    contract.client_id,
    assignment.service_type,
    jsonb_build_object(
      'version', 1,
      'care_session_id', session_row.id,
      'assignment_id', assignment.id,
      'service_type', assignment.service_type,
      'service_date', session_row.service_date,
      'session_status', session_row.status,
      'session_started_by', session_row.started_by,
      'started_at', session_row.started_at,
      'ended_at', session_row.ended_at,
      'client_id', contract.client_id,
      'client_name', client.display_name,
      'baby_id', contract.baby_id,
      'baby_name', baby.first_name,
      'caregiver_id', assignment.caregiver_id,
      'caregiver_name', caregiver_profile.full_name,
      'published_at', now(),
      'events', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', care_event.id,
              'care_session_id', care_event.care_session_id,
              'event_type', care_event.event_type,
              'event_time', care_event.event_time,
              'payload', care_event.payload,
              'notes', care_event.notes,
              'unusual_observation', care_event.unusual_observation,
              'created_by', care_event.created_by,
              'created_at', care_event.created_at,
              'updated_at', care_event.updated_at
            )
            order by care_event.event_time, care_event.created_at
          )
          from public.care_events care_event
          where care_event.care_session_id = session_row.id
        ),
        '[]'::jsonb
      )
    )
  into target_client_id, target_service_type, report_snapshot
  from public.care_assignments assignment
  join public.care_contracts contract on contract.id = assignment.contract_id
  join public.clients client on client.id = contract.client_id
  left join public.babies baby on baby.id = contract.baby_id
  left join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
  left join public.profiles caregiver_profile on caregiver_profile.id = caregiver.user_id
  where assignment.id = session_row.assignment_id;

  if not found then
    raise exception 'Care session assignment not found';
  end if;

  insert into public.care_reports (
    care_session_id,
    status,
    summary,
    structured_summary,
    generated_by_ai,
    reviewed_by,
    published_to_client,
    published_at,
    updated_at
  ) values (
    session_row.id,
    'PUBLISHED',
    trim(p_title),
    report_snapshot,
    false,
    auth.uid(),
    true,
    now(),
    now()
  )
  on conflict (care_session_id) do update set
    status = excluded.status,
    summary = excluded.summary,
    structured_summary = excluded.structured_summary,
    generated_by_ai = excluded.generated_by_ai,
    reviewed_by = excluded.reviewed_by,
    published_to_client = excluded.published_to_client,
    published_at = excluded.published_at,
    updated_at = excluded.updated_at
  where public.care_reports.status = 'DRAFT'
    and public.care_reports.published_at is null
  returning * into saved_report;

  if saved_report.id is null then
    raise exception 'This care session already has an immutable published report';
  end if;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'PUBLISH_CARE_REPORT',
    'care_reports',
    saved_report.id,
    jsonb_build_object(
      'care_session_id', session_row.id,
      'client_id', target_client_id,
      'service_type', target_service_type
    )
  );

  return saved_report;
end;
$$;

-- Reports published before immutable snapshots were introduced cannot recover
-- their original publication-time state. Preserve them explicitly as a
-- migration-time legacy snapshot instead of leaving an ambiguous empty JSON
-- object that can neither be viewed nor republished.
update public.care_reports report
set structured_summary = jsonb_build_object(
      'version', 0,
      'legacy_backfill', true,
      'snapshot_captured_at', now(),
      'original_published_at', report.published_at,
      'care_session_id', session.id,
      'assignment_id', assignment.id,
      'service_type', assignment.service_type,
      'service_date', session.service_date,
      'session_status', session.status,
      'session_started_by', session.started_by,
      'started_at', session.started_at,
      'ended_at', session.ended_at,
      'client_id', contract.client_id,
      'client_name', client.display_name,
      'baby_id', contract.baby_id,
      'baby_name', baby.first_name,
      'caregiver_id', assignment.caregiver_id,
      'caregiver_name', caregiver_profile.full_name,
      'events', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', care_event.id,
              'care_session_id', care_event.care_session_id,
              'event_type', care_event.event_type,
              'event_time', care_event.event_time,
              'payload', care_event.payload,
              'notes', care_event.notes,
              'unusual_observation', care_event.unusual_observation,
              'created_by', care_event.created_by,
              'created_at', care_event.created_at,
              'updated_at', care_event.updated_at
            ) order by care_event.event_time, care_event.created_at
          )
          from public.care_events care_event
          where care_event.care_session_id = session.id
        ),
        '[]'::jsonb
      )
    ),
    updated_at = now()
from public.care_sessions session
join public.care_assignments assignment on assignment.id = session.assignment_id
join public.care_contracts contract on contract.id = assignment.contract_id
join public.clients client on client.id = contract.client_id
left join public.babies baby on baby.id = contract.baby_id
left join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
left join public.profiles caregiver_profile on caregiver_profile.id = caregiver.user_id
where report.care_session_id = session.id
  and report.status = 'PUBLISHED'
  and report.structured_summary = '{}'::jsonb;

drop policy if exists "reports: care team read" on public.care_reports;
drop policy if exists "reports: staff caregiver or client read" on public.care_reports;
drop policy if exists "reports: staff manage" on public.care_reports;
drop policy if exists "reports: exact participants read" on public.care_reports;
create policy "reports: exact participants read"
on public.care_reports for select to authenticated
using (
  public.is_care_staff()
  or (
    published_to_client
    and exists (
      select 1
      from public.care_sessions session
      join public.care_assignments assignment on assignment.id = session.assignment_id
      join public.care_contracts contract on contract.id = assignment.contract_id
      where session.id = care_reports.care_session_id
        and public.is_client_member(contract.client_id)
    )
  )
  or (
    public.current_user_is_active_caregiver()
    and exists (
      select 1
      from public.care_sessions session
      join public.care_assignments assignment on assignment.id = session.assignment_id
      join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
      where session.id = care_reports.care_session_id
        and caregiver.user_id = auth.uid()
        and caregiver.status = 'ACTIVE'
        and assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
        and assignment.starts_at <= now() + interval '180 days'
        and assignment.ends_at >= now() - interval '30 days'
    )
  )
);

revoke insert, update, delete on table public.care_reports from public;
revoke insert, update, delete on table public.care_reports from anon;
revoke insert, update, delete on table public.care_reports from authenticated;
grant select on table public.care_reports to authenticated;
revoke all on function public.publish_care_report(uuid, text) from public;
revoke all on function public.publish_care_report(uuid, text) from anon;
grant execute on function public.publish_care_report(uuid, text) to authenticated;

-- An active or future assignment can be atomically moved to another verified
-- W-2 caregiver before an account is suspended or employment status changes.
create or replace function public.admin_reassign_caregiver(
  p_assignment_id uuid,
  p_caregiver_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_row public.care_assignments%rowtype;
  contract_row public.care_contracts%rowtype;
  previous_caregiver_id uuid;
  assignment_start_date date;
  assignment_end_date date;
  replacement_assignment_id uuid;
  replacement_starts_at timestamptz;
  has_historical_sessions boolean;
  previous_caregiver_user_id uuid;
  requester_user_id uuid;
  local_today date := (now() at time zone 'America/New_York')::date;
  local_now_time time := (now() at time zone 'America/New_York')::time;
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can reassign caregivers';
  end if;
  if p_assignment_id is null or p_caregiver_id is null then
    raise exception 'An assignment and replacement caregiver are required';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'A reassignment reason must contain between 3 and 500 characters';
  end if;

  select request.requested_by into requester_user_id
  from public.client_service_requests request
  where request.approved_assignment_id = p_assignment_id
  order by request.created_at desc
  limit 1;

  if requester_user_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('care-session-starter:' || requester_user_id::text, 0)
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment-session:' || p_assignment_id::text, 0)
  );

  select caregiver.user_id into previous_caregiver_user_id
  from public.care_assignments assignment
  join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
  where assignment.id = p_assignment_id;

  if previous_caregiver_user_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('care-session-starter:' || previous_caregiver_user_id::text, 0)
    );
  end if;

  select assignment.* into assignment_row
  from public.care_assignments assignment
  where assignment.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found';
  end if;
  if assignment_row.status not in ('PROPOSED', 'CONFIRMED')
     or assignment_row.ends_at < now() then
    raise exception 'Only an active or future assignment can be reassigned';
  end if;
  if assignment_row.caregiver_id = p_caregiver_id then
    raise exception 'Select a different caregiver';
  end if;
  if exists (
    select 1
    from public.service_adjustment_requests adjustment
    where adjustment.care_assignment_id = assignment_row.id
      and adjustment.status = 'PENDING'
  ) or exists (
    select 1
    from public.client_service_requests request
    join public.service_adjustment_requests adjustment
      on adjustment.client_service_request_id = request.id
    where request.approved_assignment_id = assignment_row.id
      and adjustment.status = 'PENDING'
  ) then
    raise exception 'Review the pending service change or cancellation before reassignment';
  end if;
  if exists (
    select 1 from public.care_sessions session
    where session.assignment_id = assignment_row.id
      and session.status = 'IN_PROGRESS'
  ) then
    raise exception 'Complete or close the active care session before reassignment';
  end if;

  select contract.* into contract_row
  from public.care_contracts contract
  where contract.id = assignment_row.contract_id
  for share;

  if not found or contract_row.baby_id is null then
    raise exception 'Assignment contract must identify a baby';
  end if;

  perform public.lock_care_schedule(
    p_caregiver_id,
    contract_row.baby_id,
    contract_row.client_id
  );

  if not exists (
    select 1
    from public.caregivers caregiver
    join public.profiles profile on profile.id = caregiver.user_id
    join public.user_roles role
      on role.user_id = caregiver.user_id and role.role = 'CAREGIVER'
    join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
    where caregiver.id = p_caregiver_id
      and caregiver.status = 'ACTIVE'
      and profile.account_status = 'ACTIVE'
      and profile.deleted_at is null
      and hr.employment_status = 'ACTIVE'
  ) then
    raise exception 'Replacement caregiver is not active and HR-cleared';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('company-compliance-scheduling', 0)
  );
  if not public.company_care_compliance_is_current() then
    raise exception 'Current liability, workers compensation, and W-2 evidence must be verified before reassignment';
  end if;

  assignment_start_date :=
    (assignment_row.starts_at at time zone 'America/New_York')::date;
  assignment_end_date :=
    (assignment_row.ends_at at time zone 'America/New_York')::date;

  select exists (
    select 1
    from public.care_sessions session
    where session.assignment_id = assignment_row.id
      and (
        session.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')
        or session.started_at is not null
        or exists (
          select 1 from public.care_events event
          where event.care_session_id = session.id
        )
        or exists (
          select 1 from public.care_reports report
          where report.care_session_id = session.id
        )
      )
  ) into has_historical_sessions;

  if has_historical_sessions then
    assignment_start_date := greatest(assignment_start_date, local_today);

    if exists (
      select 1
      from public.care_sessions session
      where session.assignment_id = assignment_row.id
        and session.service_date >= assignment_start_date
        and (
          session.status in ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')
          or session.started_at is not null
          or exists (
            select 1 from public.care_events event
            where event.care_session_id = session.id
          )
          or exists (
            select 1 from public.care_reports report
            where report.care_session_id = session.id
          )
        )
    ) or (
      assignment_start_date = local_today
      and local_now_time >= coalesce(
        assignment_row.daily_start_time,
        (assignment_row.starts_at at time zone 'America/New_York')::time
      )
    ) then
      assignment_start_date := assignment_start_date + 1;
    end if;

    while assignment_start_date <= assignment_end_date
      and not public.service_weekday_matches(
        assignment_start_date,
        assignment_row.service_days
      )
    loop
      assignment_start_date := assignment_start_date + 1;
    end loop;

    if assignment_start_date > assignment_end_date then
      raise exception 'No future service day remains to reassign';
    end if;
  end if;

  replacement_starts_at := (
    assignment_start_date
      + coalesce(
          assignment_row.daily_start_time,
          (assignment_row.starts_at at time zone 'America/New_York')::time
        )
  ) at time zone 'America/New_York';

  if not public.caregiver_schedule_is_available(
    p_caregiver_id,
    assignment_start_date,
    assignment_end_date,
    assignment_row.daily_start_time,
    assignment_row.daily_end_time,
    assignment_row.service_days,
    assignment_row.id
  ) then
    raise exception 'Replacement caregiver has an overlapping service-day schedule';
  end if;

  previous_caregiver_id := assignment_row.caregiver_id;

  if has_historical_sessions then
    update public.care_assignments
    set ends_at = replacement_starts_at - interval '1 second',
        status = 'COMPLETED',
        updated_by = auth.uid(),
        updated_at = now(),
        notes = concat_ws(
          E'\n',
          nullif(notes, ''),
          '관리사 재배정으로 기존 구간 종료: ' || trim(p_reason)
        )
    where id = assignment_row.id;

    insert into public.care_assignments (
      contract_id, caregiver_id, starts_at, ends_at, status, assigned_by,
      notes, updated_by, service_address, daily_start_time, daily_end_time,
      household_extra_people, allergy_notes, client_request_note, contract_weeks,
      service_type, service_days, maternal_notes, meal_instructions, routine_notes,
      pickup_notes, weekly_rate, contract_value, insured_staffing,
      employee_classification, deposit_amount, deposit_status, deposit_paid_at,
      care_minutes, meal_break_minutes, rest_break_minutes
    ) values (
      assignment_row.contract_id, p_caregiver_id, replacement_starts_at,
      assignment_row.ends_at, 'CONFIRMED', auth.uid(),
      '관리자 재배정: ' || trim(p_reason), auth.uid(),
      assignment_row.service_address, assignment_row.daily_start_time,
      assignment_row.daily_end_time, assignment_row.household_extra_people,
      assignment_row.allergy_notes, assignment_row.client_request_note,
      assignment_row.contract_weeks, assignment_row.service_type,
      assignment_row.service_days, assignment_row.maternal_notes,
      assignment_row.meal_instructions, assignment_row.routine_notes,
      assignment_row.pickup_notes, assignment_row.weekly_rate,
      assignment_row.contract_value, assignment_row.insured_staffing,
      assignment_row.employee_classification, assignment_row.deposit_amount,
      assignment_row.deposit_status, assignment_row.deposit_paid_at,
      assignment_row.care_minutes, assignment_row.meal_break_minutes,
      assignment_row.rest_break_minutes
    ) returning id into replacement_assignment_id;

    update public.client_service_requests
    set approved_assignment_id = replacement_assignment_id,
        updated_at = now()
    where approved_assignment_id = assignment_row.id;
  else
    update public.care_assignments
    set caregiver_id = p_caregiver_id,
        assigned_by = auth.uid(),
        notes = concat_ws(
          E'\n',
          nullif(notes, ''),
          '관리자 재배정: ' || trim(p_reason)
        ),
        updated_by = auth.uid(),
        updated_at = now()
    where id = assignment_row.id;

    replacement_assignment_id := assignment_row.id;
  end if;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'REASSIGN_CAREGIVER',
    'care_assignments',
    replacement_assignment_id,
    jsonb_build_object(
      'source_assignment_id', assignment_row.id,
      'previous_caregiver_id', previous_caregiver_id,
      'replacement_caregiver_id', p_caregiver_id,
      'replacement_starts_at', replacement_starts_at,
      'history_preserved_by_split', has_historical_sessions,
      'reason', trim(p_reason)
    )
  );

  return replacement_assignment_id;
end;
$$;

revoke all on function public.admin_reassign_caregiver(uuid, uuid, text) from public;
revoke all on function public.admin_reassign_caregiver(uuid, uuid, text) from anon;
grant execute on function public.admin_reassign_caregiver(uuid, uuid, text) to authenticated;

-- Upgrades an already-approved pre-ledger request only after an administrator
-- enters real external receipt evidence. No synthetic payment rows are created.
create or replace function public.record_approved_request_deposit_evidence(
  p_request_id uuid,
  p_payment_method text,
  p_payment_reference text
)
returns public.deposit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  deposit_row public.deposit_transactions%rowtype;
  linked_assignment public.care_assignments%rowtype;
  linked_contract public.care_contracts%rowtype;
  prelinked_assignment_id uuid;
  linked_caregiver_user_id uuid;
  requester_user_id uuid;
  required_deposit numeric(10,2);
  normalized_payment_method text := upper(trim(coalesce(p_payment_method, '')));
  normalized_payment_reference text := trim(coalesce(p_payment_reference, ''));
  normalized_days text[];
  normalized_assignment_days text[];
  daily_duration interval;
  recalculated_total numeric(10,2);
  expected_end_date date;
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can record deposit evidence';
  end if;
  if length(normalized_payment_method) not between 2 and 40 then
    raise exception 'A valid payment method is required';
  end if;
  if length(normalized_payment_reference) not between 3 and 255 then
    raise exception 'A valid payment reference is required';
  end if;

  -- Read only the current link first, serialize the requesting member, then use
  -- the shared assignment/session lock order. The authoritative request row is
  -- locked only after its linked assignment and contract.
  select request.approved_assignment_id, request.requested_by
  into prelinked_assignment_id, requester_user_id
  from public.client_service_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'An approved service request is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || requester_user_id::text, 0)
  );

  if prelinked_assignment_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('assignment-session:' || prelinked_assignment_id::text, 0)
    );

    select caregiver.user_id into linked_caregiver_user_id
    from public.care_assignments assignment
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where assignment.id = prelinked_assignment_id;

    if linked_caregiver_user_id is null then
      raise exception 'The approved request links to an invalid care assignment';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('care-session-starter:' || linked_caregiver_user_id::text, 0)
    );

    select assignment.* into linked_assignment
    from public.care_assignments assignment
    where assignment.id = prelinked_assignment_id
    for update;

    if not found then
      raise exception 'The approved request links to a missing care assignment';
    end if;

    select contract.* into linked_contract
    from public.care_contracts contract
    where contract.id = linked_assignment.contract_id
    for update;

    if not found then
      raise exception 'The approved request links to a missing care contract';
    end if;
  end if;

  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id
  for update;

  if not found
     or request_row.status <> 'APPROVED'
     or request_row.approved_assignment_id is distinct from prelinked_assignment_id then
    raise exception 'The approved service request changed while deposit evidence was being recorded';
  end if;
  if not exists (
    select 1
    from public.client_members member
    join public.profiles profile on profile.id = member.user_id
    join public.user_roles role
      on role.user_id = member.user_id and role.role = 'CLIENT'
    where member.client_id = request_row.client_id
      and member.user_id = request_row.requested_by
      and profile.account_status = 'ACTIVE'
      and profile.deleted_at is null
  ) then
    raise exception 'The requesting client account is no longer active';
  end if;
  if exists (
    select 1 from public.deposit_transactions deposit
    where deposit.client_service_request_id = request_row.id
      and deposit.status = 'CAPTURED'
  ) then
    raise exception 'Captured deposit evidence already exists for this request';
  end if;
  if request_row.baby_id is null or not exists (
    select 1 from public.babies baby
    where baby.id = request_row.baby_id
      and baby.client_id = request_row.client_id
  ) then
    raise exception 'The approved request must identify a baby belonging to the client';
  end if;
  if length(trim(coalesce(request_row.service_address, ''))) not between 5 and 500
     or coalesce(request_row.household_extra_people, -1) not between 0 and 30 then
    raise exception 'The approved request must contain a valid service address and household count';
  end if;
  if request_row.requested_weeks not in (2, 3, 4) then
    raise exception 'Service duration must be two, three, or four weeks';
  end if;
  if coalesce(cardinality(request_row.requested_days), 0) not between 1 and 7
     or exists (
       select 1 from unnest(request_row.requested_days) requested_day
       where requested_day is null
         or trim(requested_day) = ''
         or upper(trim(requested_day)) not in (
           '월', '화', '수', '목', '금', '토', '일',
           'MON', 'MONDAY', 'TUE', 'TUESDAY', 'WED', 'WEDNESDAY',
           'THU', 'THURSDAY', 'FRI', 'FRIDAY', 'SAT', 'SATURDAY',
           'SUN', 'SUNDAY', '1', '2', '3', '4', '5', '6', '7'
         )
     ) then
    raise exception 'The approved request contains unsupported recurring service days';
  end if;

  normalized_days := public.canonical_service_days(request_row.requested_days);
  daily_duration := request_row.daily_end_time - request_row.daily_start_time;
  expected_end_date := request_row.desired_start_date
    + (request_row.requested_weeks * 7 - 1);
  required_deposit := case request_row.service_type
    when 'POSTPARTUM' then 500.00
    when 'BABYSITTING' then 128.00
    else null
  end;

  if request_row.service_type = 'POSTPARTUM' then
    if request_row.daily_start_time > time '14:29'
       or daily_duration <> interval '9 hours 30 minutes' then
      raise exception 'Postpartum care requires an 8-hour care day plus fixed meal and rest breaks';
    end if;
    recalculated_total := 1800.00 * request_row.requested_weeks;
  elsif request_row.service_type = 'BABYSITTING' then
    if request_row.daily_start_time > time '19:45'
       or daily_duration not between interval '4 hours' and interval '12 hours' then
      raise exception 'Babysitting requires between four and twelve same-day care hours';
    end if;
    recalculated_total := round(
      (extract(epoch from daily_duration) / 3600.0)
        * 32.00 * cardinality(normalized_days) * request_row.requested_weeks,
      2
    );
  else
    raise exception 'Unsupported service type';
  end if;

  if prelinked_assignment_id is not null then
    normalized_assignment_days := public.canonical_service_days(
      linked_assignment.service_days
    );

    if linked_contract.client_id <> request_row.client_id
       or linked_contract.baby_id is distinct from request_row.baby_id
       or linked_assignment.service_type <> request_row.service_type
       or not (
         (linked_assignment.starts_at at time zone 'America/New_York')::date
           between linked_contract.start_date and linked_contract.end_date
       )
       or (linked_assignment.starts_at at time zone 'America/New_York')::time
          is distinct from request_row.daily_start_time
       or (linked_assignment.ends_at at time zone 'America/New_York')::date
          <> expected_end_date
       or linked_contract.start_date <> request_row.desired_start_date
       or linked_contract.end_date <> expected_end_date
       or linked_assignment.daily_start_time is distinct from request_row.daily_start_time
       or linked_assignment.daily_end_time is distinct from request_row.daily_end_time
       or linked_assignment.contract_weeks is distinct from request_row.requested_weeks
       or normalized_assignment_days is distinct from normalized_days then
      raise exception 'Legacy scheduled service data conflicts with the approved request; reconcile the schedule before recording payment evidence';
    end if;

    perform public.lock_care_schedule(
      linked_assignment.caregiver_id,
      linked_contract.baby_id,
      linked_contract.client_id
    );
  end if;

  insert into public.deposit_transactions (
    client_service_request_id, client_id, amount, currency, status,
    payment_method, external_reference, idempotency_key, recorded_by, captured_at
  ) values (
    request_row.id, request_row.client_id, required_deposit, 'USD', 'CAPTURED',
    normalized_payment_method, normalized_payment_reference,
    'service-deposit:' || request_row.id::text, auth.uid(), now()
  )
  returning * into deposit_row;

  update public.client_service_requests
  set requested_days = normalized_days,
      weekly_rate = case when service_type = 'POSTPARTUM' then 1800.00 else null end,
      estimated_total = recalculated_total,
      deposit_amount = required_deposit,
      deposit_status = 'PAID',
      deposit_paid_at = deposit_row.captured_at,
      updated_at = now()
  where id = request_row.id;

  if prelinked_assignment_id is not null then
    -- Canonical aliases (for example MON/MONDAY) are collapsed before any
    -- future duration change, and all financial copies are brought back to the
    -- server-calculated request value in this same transaction.
    update public.care_contracts
    set agreed_rate = recalculated_total,
        updated_at = now()
    where id = linked_contract.id;

    update public.care_assignments
    set service_days = normalized_days,
        weekly_rate = case
          when request_row.service_type = 'POSTPARTUM' then 1800.00
          else null
        end,
        contract_value = recalculated_total,
        deposit_amount = required_deposit,
        deposit_status = 'PAID',
        deposit_paid_at = deposit_row.captured_at,
        updated_by = auth.uid(),
        updated_at = now()
    where id = linked_assignment.id;
  end if;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'RECORD_LEGACY_DEPOSIT_EVIDENCE',
    'deposit_transactions', deposit_row.id,
    jsonb_build_object(
      'client_service_request_id', request_row.id,
      'amount', required_deposit,
      'currency', 'USD',
      'payment_method', normalized_payment_method,
      'external_reference', normalized_payment_reference
    )
  );

  return deposit_row;
exception
  when unique_violation then
    raise exception 'This payment reference has already been recorded';
end;
$$;

revoke all on function public.record_approved_request_deposit_evidence(uuid, text, text) from public;
revoke all on function public.record_approved_request_deposit_evidence(uuid, text, text) from anon;
grant execute on function public.record_approved_request_deposit_evidence(uuid, text, text) to authenticated;

-- Refund completion records the external provider reference and updates every
-- linked service record in one audited transaction.
alter table public.deposit_transactions
  add column if not exists refund_reference text,
  add column if not exists refunded_amount numeric(10,2),
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_by uuid references public.profiles(id) on delete restrict;

alter table public.deposit_transactions
  drop constraint if exists deposit_refund_has_evidence;
alter table public.deposit_transactions
  add constraint deposit_refund_has_evidence check (
    status <> 'REFUNDED'
    or (
      refunded_at is not null
      and refunded_by is not null
      and nullif(trim(refund_reference), '') is not null
      and refunded_amount = amount
    )
  );

create unique index if not exists deposit_refund_reference_unique
  on public.deposit_transactions(payment_method, refund_reference)
  where refund_reference is not null;

create or replace function public.record_deposit_refund(
  p_request_id uuid,
  p_refund_reference text
)
returns public.deposit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  deposit_row public.deposit_transactions%rowtype;
  linked_assignment public.care_assignments%rowtype;
  prelinked_assignment_id uuid;
  linked_caregiver_user_id uuid;
  requester_user_id uuid;
  normalized_reference text := trim(coalesce(p_refund_reference, ''));
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can record refunds';
  end if;
  if length(normalized_reference) not between 3 and 255 then
    raise exception 'A valid external refund reference is required';
  end if;

  select request.approved_assignment_id, request.requested_by
  into prelinked_assignment_id, requester_user_id
  from public.client_service_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'Service request not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('care-session-starter:' || requester_user_id::text, 0)
  );

  if prelinked_assignment_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('assignment-session:' || prelinked_assignment_id::text, 0)
    );

    select caregiver.user_id into linked_caregiver_user_id
    from public.care_assignments assignment
    join public.caregivers caregiver on caregiver.id = assignment.caregiver_id
    where assignment.id = prelinked_assignment_id;

    if linked_caregiver_user_id is null then
      raise exception 'Refund target links to an invalid care assignment';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('care-session-starter:' || linked_caregiver_user_id::text, 0)
    );

    select assignment.* into linked_assignment
    from public.care_assignments assignment
    where assignment.id = prelinked_assignment_id
    for update;

    if not found then
      raise exception 'Refund target links to a missing care assignment';
    end if;
  end if;

  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id
  for update;

  if not found
     or request_row.approved_assignment_id is distinct from prelinked_assignment_id then
    raise exception 'The refund target changed while it was being processed';
  end if;
  if request_row.status <> 'CANCELLED'
     or request_row.deposit_status <> 'REFUND_DUE' then
    raise exception 'This cancelled request does not have a refund due';
  end if;

  select deposit.* into deposit_row
  from public.deposit_transactions deposit
  where deposit.client_service_request_id = request_row.id
    and deposit.status = 'CAPTURED'
  order by deposit.created_at
  limit 1
  for update;

  if not found then
    raise exception 'Captured deposit transaction not found';
  end if;

  update public.deposit_transactions
  set status = 'REFUNDED',
      refund_reference = normalized_reference,
      refunded_amount = amount,
      refunded_at = now(),
      refunded_by = auth.uid(),
      updated_at = now()
  where id = deposit_row.id
  returning * into deposit_row;

  update public.client_service_requests
  set deposit_status = 'REFUNDED', updated_at = now()
  where id = request_row.id;

  if prelinked_assignment_id is not null then
    update public.care_assignments
    set deposit_status = 'REFUNDED', updated_at = now()
    where id = prelinked_assignment_id;
  end if;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'RECORD_DEPOSIT_REFUND',
    'deposit_transactions',
    deposit_row.id,
    jsonb_build_object(
      'client_service_request_id', request_row.id,
      'amount', deposit_row.amount,
      'currency', deposit_row.currency,
      'refund_reference', normalized_reference
    )
  );

  return deposit_row;
end;
$$;

revoke all on function public.record_deposit_refund(uuid, text) from public;
revoke all on function public.record_deposit_refund(uuid, text) from anon;
grant execute on function public.record_deposit_refund(uuid, text) to authenticated;

-- Membership is necessary but never sufficient for family access: a suspended
-- or archived profile must immediately lose every client-scoped table, report,
-- and Storage permission even while its historical membership row is retained.
create or replace function public.is_client_member(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active() and exists (
    select 1
    from public.client_members member
    where member.client_id = target_client_id
      and member.user_id = auth.uid()
  );
$$;

revoke all on function public.is_client_member(uuid) from public;
revoke all on function public.is_client_member(uuid) from anon;
grant execute on function public.is_client_member(uuid) to authenticated;

notify pgrst, 'reload schema';
