-- Assignment-scoped objective report history.
--
-- A cancelled assignment is still a legitimate service batch when care was
-- actually delivered. Exact family members and the exact assigned caregiver
-- may continue to read that retained history. A cancellation with no delivery
-- evidence, or a service soft-removed by an administrator, is never reopened.

begin;

-- This partial index keeps the administrative-removal guard inexpensive when
-- participant RLS evaluates many assignments at once.
create index if not exists client_service_requests_removed_assignment_idx
  on public.client_service_requests(approved_assignment_id)
  where approved_assignment_id is not null
    and administratively_removed_at is not null;

-- These helpers intentionally run as SECURITY DEFINER. They inspect tables
-- whose policies call the helpers themselves (sessions, events, and reports),
-- so invoker-security queries would recurse through RLS.
create or replace function public.care_assignment_is_administratively_removed(
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_assignment_id is not null and exists (
    select 1
    from public.care_assignments target_assignment
    join public.care_assignments approved_assignment
      on approved_assignment.contract_id = target_assignment.contract_id
    join public.client_service_requests request
      on request.approved_assignment_id = approved_assignment.id
    where target_assignment.id = p_assignment_id
      and request.administratively_removed_at is not null
  );
$$;

create or replace function public.care_assignment_has_delivered_history(
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_assignment_id is not null and exists (
    select 1
    from public.care_sessions session
    where session.assignment_id = p_assignment_id
      and (
        session.status in ('IN_PROGRESS', 'COMPLETED')
        or session.started_at is not null
        or exists (
          select 1
          from public.care_events event
          where event.care_session_id = session.id
        )
        or exists (
          select 1
          from public.care_reports report
          where report.care_session_id = session.id
        )
      )
  );
$$;

create or replace function public.care_assignment_is_participant_reportable(
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_assignment_id is not null and exists (
    select 1
    from public.care_assignments assignment
    where assignment.id = p_assignment_id
      and not public.care_assignment_is_administratively_removed(assignment.id)
      and (
        assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
        or (
          assignment.status = 'CANCELLED'
          and public.care_assignment_has_delivered_history(assignment.id)
        )
      )
  );
$$;

-- Historical report access is intentionally separate from the live client
-- briefing permission. It exposes the assignment's retained care records, not
-- the customer's current address, emergency contact, or management profile.
create or replace function public.caregiver_can_read_assignment_report(
  p_assignment_id uuid
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
    where assignment.id = p_assignment_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and public.care_assignment_is_participant_reportable(assignment.id)
      and public.care_assignment_has_delivered_history(assignment.id)
  );
$$;

-- The existing seven-day pre-service rule remains the authority for current
-- client briefing data. Cancelled and administratively removed batches never
-- reopen that live operational profile.
create or replace function public.caregiver_client_briefing_is_open(
  p_assignment_id uuid
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
    where assignment.id = p_assignment_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and assignment.status in ('PROPOSED', 'CONFIRMED')
      and not public.care_assignment_is_administratively_removed(assignment.id)
      and (assignment.starts_at at time zone 'America/New_York')::date
        <= (now() at time zone 'America/New_York')::date + 7
      and (assignment.ends_at at time zone 'America/New_York')::date
        >= (now() at time zone 'America/New_York')::date
  );
$$;

create or replace function public.caregiver_can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.care_contracts contract
    join public.care_assignments assignment on assignment.contract_id = contract.id
    where contract.client_id = p_client_id
      and public.caregiver_client_briefing_is_open(assignment.id)
  );
$$;

create or replace function public.caregiver_can_access_baby(p_baby_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.care_contracts contract
    join public.care_assignments assignment on assignment.contract_id = contract.id
    where contract.baby_id = p_baby_id
      and public.caregiver_client_briefing_is_open(assignment.id)
  );
$$;

create or replace function public.caregiver_can_access_contract(
  p_contract_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.care_assignments assignment
    where assignment.contract_id = p_contract_id
      and public.caregiver_client_briefing_is_open(assignment.id)
  );
$$;

create or replace function public.can_read_care_assignment(
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_care_staff()
  or (
    public.care_assignment_is_participant_reportable(p_assignment_id)
    and exists (
      select 1
      from public.care_assignments assignment
      join public.care_contracts contract on contract.id = assignment.contract_id
      where assignment.id = p_assignment_id
        and public.is_client_member(contract.client_id)
    )
  )
  or public.caregiver_client_briefing_is_open(p_assignment_id)
  or public.caregiver_can_read_assignment_report(p_assignment_id);
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
      and public.care_assignment_is_participant_reportable(assignment.id)
      and public.is_client_member(contract.client_id)
  )
  or exists (
    select 1
    from public.care_sessions session
    where session.id = p_session_id
      and (
        public.caregiver_client_briefing_is_open(session.assignment_id)
        or public.caregiver_can_read_assignment_report(session.assignment_id)
      )
  );
$$;

-- Keep the participant metadata RPC aligned with the same assignment boundary.
-- This lets the UI label a retained cancelled batch without revealing empty
-- cancellations or administratively removed services.
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
  client_display_name text,
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
    client.display_name,
    case
      when public.is_care_staff()
        or public.is_client_member(contract.client_id)
        or public.caregiver_client_briefing_is_open(assignment.id)
      then coalesce(client_management.preferred_language, primary_client_profile.preferred_language)
      else null
    end,
    case
      when public.is_care_staff()
        or public.is_client_member(contract.client_id)
        or public.caregiver_client_briefing_is_open(assignment.id)
      then client_management.emergency_contact
      else null
    end
  from public.care_assignments assignment
  join public.care_contracts contract on contract.id = assignment.contract_id
  join public.clients client on client.id = contract.client_id
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
    where member.client_id = contract.client_id
      and member.is_primary
    order by member.created_at
    limit 1
  ) primary_client_profile on true
  where contract.status in ('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')
    and (
      public.is_care_staff()
      or public.care_assignment_is_participant_reportable(assignment.id)
    )
    and (
      public.is_care_staff()
      or public.is_client_member(contract.client_id)
      or public.caregiver_client_briefing_is_open(assignment.id)
      or public.caregiver_can_read_assignment_report(assignment.id)
    );
$$;

-- Assignment/session/event policies already delegate to the replaced boolean
-- helpers. Reports had an inline historical-window test, so replace that one
-- policy explicitly to keep all four care-record tables on the same boundary.
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
        and public.care_assignment_is_participant_reportable(assignment.id)
        and public.is_client_member(contract.client_id)
    )
  )
  or exists (
    select 1
    from public.care_sessions session
    where session.id = care_reports.care_session_id
      and public.caregiver_can_read_assignment_report(session.assignment_id)
  )
);

revoke all on function public.care_assignment_is_administratively_removed(uuid) from public;
revoke all on function public.care_assignment_is_administratively_removed(uuid) from anon;
grant execute on function public.care_assignment_is_administratively_removed(uuid) to authenticated;

revoke all on function public.care_assignment_has_delivered_history(uuid) from public;
revoke all on function public.care_assignment_has_delivered_history(uuid) from anon;
grant execute on function public.care_assignment_has_delivered_history(uuid) to authenticated;

revoke all on function public.care_assignment_is_participant_reportable(uuid) from public;
revoke all on function public.care_assignment_is_participant_reportable(uuid) from anon;
grant execute on function public.care_assignment_is_participant_reportable(uuid) to authenticated;

revoke all on function public.caregiver_can_read_assignment_report(uuid) from public;
revoke all on function public.caregiver_can_read_assignment_report(uuid) from anon;
grant execute on function public.caregiver_can_read_assignment_report(uuid) to authenticated;

revoke all on function public.caregiver_client_briefing_is_open(uuid) from public;
revoke all on function public.caregiver_client_briefing_is_open(uuid) from anon;
grant execute on function public.caregiver_client_briefing_is_open(uuid) to authenticated;

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

revoke all on function public.my_assignment_briefs() from public;
revoke all on function public.my_assignment_briefs() from anon;
grant execute on function public.my_assignment_briefs() to authenticated;

comment on function public.care_assignment_is_administratively_removed(uuid) is
  'Returns whether the assignment belongs to a service request soft-removed by an administrator.';
comment on function public.care_assignment_has_delivered_history(uuid) is
  'Returns whether an assignment has objective delivery evidence: an in-progress/completed/started session, event, or report.';
comment on function public.care_assignment_is_participant_reportable(uuid) is
  'Allows normal assignment states plus cancelled assignments with delivery evidence, while excluding administratively removed services.';
comment on function public.caregiver_can_read_assignment_report(uuid) is
  'Allows the exact assigned active caregiver to read a participant-reportable service batch with delivery evidence without granting current client-profile access.';
comment on function public.caregiver_client_briefing_is_open(uuid) is
  'Allows only the exact assigned active caregiver from seven New York calendar days before a proposed or confirmed, non-removed service starts through its final New York service date; later history uses report-only access.';
comment on function public.caregiver_can_access_client(uuid) is
  'Checks exact-caregiver access to a client through a participant-reportable assignment.';
comment on function public.caregiver_can_access_baby(uuid) is
  'Checks exact-caregiver access to a baby through a participant-reportable assignment.';
comment on function public.caregiver_can_access_contract(uuid) is
  'Checks exact-caregiver access to a contract through a participant-reportable assignment.';
comment on function public.can_read_care_assignment(uuid) is
  'Allows care staff, the exact family, or the exact assigned caregiver to read participant-reportable assignments while keeping report history separate from live client-profile access.';
comment on function public.can_read_care_session(uuid) is
  'Allows care staff, the exact family, or the exact assigned caregiver to read sessions for participant-reportable assignments.';
comment on function public.my_assignment_briefs() is
  'Returns assignment labels for reportable batches; current briefing fields stay null unless the actor separately has live client-briefing access.';
comment on policy "reports: exact participants read" on public.care_reports is
  'Care staff may read all reports; family sees published reports and the exact caregiver sees assigned reports only for participant-reportable service batches.';

notify pgrst, 'reload schema';

commit;
