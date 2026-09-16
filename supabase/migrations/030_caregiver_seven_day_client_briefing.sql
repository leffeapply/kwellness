-- Caregiver client briefing window.
-- Assigned caregivers can read the customer's operational care brief from
-- midnight (America/New_York) seven calendar days before the service starts.
-- Administrators, care managers, owners, and the family retain their existing
-- access. Historical assignment access remains available for late reports.

begin;

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
      and assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
      and (assignment.starts_at at time zone 'America/New_York')::date
        <= (now() at time zone 'America/New_York')::date + 7
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

create or replace function public.caregiver_can_access_contract(p_contract_id uuid)
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
  or public.caregiver_client_briefing_is_open(p_assignment_id);
$$;

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
  where assignment.status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
    and contract.status in ('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED')
    and (
      public.is_care_staff()
      or public.is_client_member(contract.client_id)
      or public.caregiver_client_briefing_is_open(assignment.id)
    );
$$;

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

revoke all on function public.my_assignment_briefs() from public;
revoke all on function public.my_assignment_briefs() from anon;
grant execute on function public.my_assignment_briefs() to authenticated;

comment on function public.caregiver_client_briefing_is_open(uuid) is
  'Allows the exact assigned active caregiver to read a client care brief beginning seven New York calendar days before service start, including historical assignments.';
comment on function public.my_assignment_briefs() is
  'Returns minimum assigned-client briefing fields to caregivers only during the seven-day pre-service window or later; care staff and the family retain normal access.';

commit;
