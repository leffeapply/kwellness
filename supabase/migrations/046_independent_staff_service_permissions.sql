begin;

-- Caregiving is an employment umbrella role. Actual services are granted
-- independently so a worker can provide postpartum care, babysitting, massage,
-- or any intentional combination of those services.
alter table public.caregiver_hr_profiles
  add column if not exists can_provide_postpartum boolean not null default true,
  add column if not exists can_provide_babysitting boolean not null default true;

comment on column public.caregiver_hr_profiles.can_provide_postpartum is
  'Administrator-granted permission to receive postpartum care assignments.';
comment on column public.caregiver_hr_profiles.can_provide_babysitting is
  'Administrator-granted permission to receive babysitting assignments.';

create or replace function public.admin_configure_member_service_access(
  p_user_id uuid,
  p_roles public.app_role[],
  p_postpartum boolean,
  p_babysitting boolean,
  p_massage boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_caregiver_id uuid;
  professional_access_requested boolean;
  caregiver_role_requested boolean;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can configure member service access';
  end if;
  if p_postpartum is null or p_babysitting is null or p_massage is null then
    raise exception 'Explicit service capability values are required';
  end if;

  professional_access_requested := p_postpartum or p_babysitting or p_massage;
  caregiver_role_requested := 'CAREGIVER'::public.app_role = any(coalesce(p_roles, array[]::public.app_role[]));
  if professional_access_requested is distinct from caregiver_role_requested then
    raise exception 'The internal caregiver role must match the selected professional services';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('member-service-access:' || p_user_id::text, 0));

  select caregiver.id into target_caregiver_id
  from public.caregivers caregiver
  where caregiver.user_id = p_user_id;

  if target_caregiver_id is not null then
    if not p_postpartum and exists (
      select 1 from public.care_assignments assignment
      where assignment.caregiver_id = target_caregiver_id
        and assignment.service_type::text = 'POSTPARTUM'
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.ends_at >= now()
    ) then
      raise exception 'Active or future postpartum assignments must be completed or reassigned before removing postpartum permission';
    end if;
    if not p_babysitting and exists (
      select 1 from public.care_assignments assignment
      where assignment.caregiver_id = target_caregiver_id
        and assignment.service_type::text = 'BABYSITTING'
        and assignment.status in ('PROPOSED', 'CONFIRMED')
        and assignment.ends_at >= now()
    ) then
      raise exception 'Active or future babysitting assignments must be completed or reassigned before removing babysitting permission';
    end if;
    if not p_massage and (
      exists (
        select 1 from public.care_assignments assignment
        where assignment.caregiver_id = target_caregiver_id
          and assignment.service_type::text = 'MASSAGE'
          and assignment.status in ('PROPOSED', 'CONFIRMED')
          and assignment.ends_at >= now()
      )
      or exists (
        select 1 from public.massage_booking_sessions booking
        where booking.caregiver_id = target_caregiver_id
          and booking.status in ('PENDING', 'CONFIRMED')
          and booking.ends_at >= now()
      )
    ) then
      raise exception 'Active or future massage bookings must be completed or reassigned before removing massage permission';
    end if;
  end if;

  -- The existing access function provisions/reactivates the caregiver identity,
  -- protects active records, and writes its own role audit entry. Calling it
  -- here keeps the role and the three service flags in one database transaction.
  perform public.admin_set_member_access_roles(p_user_id, p_roles);

  select caregiver.id into target_caregiver_id
  from public.caregivers caregiver
  where caregiver.user_id = p_user_id;

  if professional_access_requested and target_caregiver_id is null then
    raise exception 'Professional staff identity could not be provisioned';
  end if;

  if target_caregiver_id is not null then
    insert into public.caregiver_hr_profiles (
      caregiver_id,
      employment_status,
      can_provide_postpartum,
      can_provide_babysitting,
      is_massage_therapist,
      updated_by
    ) values (
      target_caregiver_id,
      case when professional_access_requested then 'ACTIVE' else 'INACTIVE' end,
      p_postpartum,
      p_babysitting,
      p_massage,
      auth.uid()
    )
    on conflict (caregiver_id) do update set
      employment_status = case
        when professional_access_requested and caregiver_hr_profiles.employment_status in ('APPLICANT', 'INACTIVE') then 'ACTIVE'
        when not professional_access_requested then 'INACTIVE'
        else caregiver_hr_profiles.employment_status
      end,
      can_provide_postpartum = excluded.can_provide_postpartum,
      can_provide_babysitting = excluded.can_provide_babysitting,
      is_massage_therapist = excluded.is_massage_therapist,
      updated_by = auth.uid(),
      updated_at = now();

    insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(),
      'CONFIGURE_STAFF_SERVICE_PERMISSIONS',
      'caregiver_hr_profiles',
      target_caregiver_id,
      jsonb_build_object(
        'user_id', p_user_id,
        'postpartum', p_postpartum,
        'babysitting', p_babysitting,
        'massage', p_massage
      )
    );
  end if;
end;
$$;

revoke all on function public.admin_configure_member_service_access(uuid, public.app_role[], boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_configure_member_service_access(uuid, public.app_role[], boolean, boolean, boolean) to authenticated;

comment on function public.admin_configure_member_service_access(uuid, public.app_role[], boolean, boolean, boolean) is
  'Atomically configures general workspaces and independent postpartum, babysitting, and massage staff permissions.';

create or replace function public.my_caregiver_service_capabilities()
returns table (
  caregiver_id uuid,
  can_provide_postpartum boolean,
  can_provide_babysitting boolean,
  is_massage_therapist boolean,
  employment_status text,
  has_hr_profile boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    caregiver.id,
    coalesce(hr.can_provide_postpartum, true),
    coalesce(hr.can_provide_babysitting, true),
    coalesce(hr.is_massage_therapist, false),
    coalesce(hr.employment_status, 'APPLICANT'),
    hr.caregiver_id is not null
  from public.caregivers caregiver
  left join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
  where caregiver.user_id = auth.uid()
    and public.has_role_for_user(auth.uid(), 'CAREGIVER');
$$;

revoke all on function public.my_caregiver_service_capabilities() from public, anon;
grant execute on function public.my_caregiver_service_capabilities() to authenticated;

create or replace function public.public_caregiver_service_capabilities()
returns table (
  caregiver_id uuid,
  service_capabilities text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    caregiver.id as caregiver_id,
    array(
      select capability
      from unnest(array[
        case when hr.can_provide_postpartum then 'POSTPARTUM' end,
        case when hr.can_provide_babysitting then 'BABYSITTING' end,
        case when hr.is_massage_therapist then 'MASSAGE' end
      ]) capability
      where capability is not null
    )::text[] as service_capabilities
  from public.caregivers caregiver
  join public.profiles profile on profile.id = caregiver.user_id
  join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
  left join public.caregiver_public_profiles public_profile on public_profile.caregiver_id = caregiver.id
  where coalesce(public_profile.is_published, true)
    and caregiver.status = 'ACTIVE'
    and profile.account_status = 'ACTIVE'
    and profile.deleted_at is null
    and hr.employment_status = 'ACTIVE'
    and (hr.can_provide_postpartum or hr.can_provide_babysitting or hr.is_massage_therapist)
    and public.has_role_for_user(caregiver.user_id, 'CAREGIVER')
  order by caregiver.id;
$$;

revoke all on function public.public_caregiver_service_capabilities() from public;
grant execute on function public.public_caregiver_service_capabilities() to anon, authenticated;

create or replace function public.enforce_assignment_service_capability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('PROPOSED', 'CONFIRMED') and not exists (
    select 1
    from public.caregivers caregiver
    join public.profiles profile on profile.id = caregiver.user_id
    join public.user_roles role on role.user_id = caregiver.user_id and role.role = 'CAREGIVER'
    join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
    where caregiver.id = new.caregiver_id
      and caregiver.status = 'ACTIVE'
      and profile.account_status = 'ACTIVE'
      and profile.deleted_at is null
      and hr.employment_status = 'ACTIVE'
      and case new.service_type::text
        when 'POSTPARTUM' then hr.can_provide_postpartum
        when 'BABYSITTING' then hr.can_provide_babysitting
        when 'MASSAGE' then hr.is_massage_therapist
        else false
      end
  ) then
    raise exception 'Selected staff member is not authorized for the assigned service type';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_assignment_service_capability_trigger on public.care_assignments;
create trigger enforce_assignment_service_capability_trigger
before insert or update of caregiver_id, service_type, status
on public.care_assignments
for each row execute function public.enforce_assignment_service_capability();

select pg_notify('pgrst', 'reload schema');

commit;
