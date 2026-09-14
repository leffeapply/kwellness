-- Allow one authenticated person to hold several operational roles without
-- destroying the records that belong to another workspace.

create or replace function public.admin_set_member_access_roles(
  p_user_id uuid,
  p_roles public.app_role[]
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
  normalized_roles public.app_role[];
  existing_roles public.app_role[];
  actor_is_owner boolean := public.has_role('OWNER');
  actor_is_admin boolean := public.is_admin();
  adding_caregiver boolean;
  removing_caregiver boolean;
  adding_client boolean;
  removing_client boolean;
begin
  if not actor_is_admin then
    raise exception 'Only administrators can configure member access roles';
  end if;

  select array_agg(candidate.role order by candidate.role::text)
  into normalized_roles
  from (
    select distinct unnest(p_roles) as role
  ) candidate;

  if coalesce(cardinality(normalized_roles), 0) = 0 then
    raise exception 'At least one member access role is required';
  end if;

  if exists (
    select 1 from unnest(normalized_roles) role
    where role not in ('OWNER', 'ADMIN', 'CARE_MANAGER', 'CAREGIVER', 'CLIENT', 'RETAIL_STAFF')
  ) then
    raise exception 'Unsupported member access role';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owner-governance', 0));
  perform pg_advisory_xact_lock(hashtextextended('member-access:' || p_user_id::text, 0));

  select * into target_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Member not found';
  end if;
  if target_profile.account_status = 'REJECTED' or target_profile.deleted_at is not null then
    raise exception 'Archived or rejected accounts must be restored before configuring access';
  end if;

  select coalesce(array_agg(role order by role::text), array[]::public.app_role[])
  into existing_roles
  from public.user_roles
  where user_id = p_user_id;

  -- OWNER can never be introduced or removed through ordinary member tooling.
  if ('OWNER'::public.app_role = any(existing_roles)) is distinct from
     ('OWNER'::public.app_role = any(normalized_roles)) then
    raise exception 'Owner access cannot be added or removed here';
  end if;

  -- Only an OWNER may add or remove administrative access. An ADMIN may still
  -- add CLIENT/CAREGIVER access to their own account while ADMIN is preserved.
  if not actor_is_owner and (
    (('ADMIN'::public.app_role = any(existing_roles)) is distinct from
      ('ADMIN'::public.app_role = any(normalized_roles)))
    or (('CARE_MANAGER'::public.app_role = any(existing_roles)) is distinct from
        ('CARE_MANAGER'::public.app_role = any(normalized_roles)))
    or (('RETAIL_STAFF'::public.app_role = any(existing_roles)) is distinct from
        ('RETAIL_STAFF'::public.app_role = any(normalized_roles)))
  ) then
    raise exception 'Only an owner can add or remove administrative access';
  end if;

  if not actor_is_owner
     and p_user_id <> auth.uid()
     and ('ADMIN'::public.app_role = any(existing_roles)) then
    raise exception 'Only an owner can configure another administrator account';
  end if;

  adding_caregiver := not ('CAREGIVER'::public.app_role = any(existing_roles))
    and 'CAREGIVER'::public.app_role = any(normalized_roles);
  removing_caregiver := 'CAREGIVER'::public.app_role = any(existing_roles)
    and not ('CAREGIVER'::public.app_role = any(normalized_roles));
  adding_client := not ('CLIENT'::public.app_role = any(existing_roles))
    and 'CLIENT'::public.app_role = any(normalized_roles);
  removing_client := 'CLIENT'::public.app_role = any(existing_roles)
    and not ('CLIENT'::public.app_role = any(normalized_roles));

  if adding_caregiver and exists (
    select 1
    from (
      values ('SERVICE_TERMS'::text), ('PRIVACY'::text), ('SENSITIVE_CARE_DATA'::text)
    ) required_consent(consent_type)
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

  if removing_client and exists (
    select 1
    from public.client_members member
    where member.user_id = p_user_id
      and (
        exists (
          select 1 from public.client_service_requests request
          where request.client_id = member.client_id
            and (request.status = 'PENDING'
              or (request.status = 'APPROVED' and request.approved_assignment_id is null))
        )
        or exists (
          select 1 from public.care_contracts contract
          where contract.client_id = member.client_id
            and contract.status in ('DRAFT', 'PENDING', 'ACTIVE', 'PAUSED')
            and contract.end_date >= (now() at time zone 'America/New_York')::date
        )
      )
  ) then
    raise exception 'Finish or cancel the client active service records before removing client access';
  end if;

  select caregiver.id into target_caregiver_id
  from public.caregivers caregiver
  where caregiver.user_id = p_user_id;

  if target_caregiver_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('caregiver:' || target_caregiver_id::text, 0));
  end if;

  if removing_caregiver and exists (
    select 1
    from public.care_assignments assignment
    where assignment.caregiver_id = target_caregiver_id
      and assignment.status in ('PROPOSED', 'CONFIRMED')
      and assignment.ends_at >= now()
  ) then
    raise exception 'Reassign or complete the caregiver active schedule before removing caregiver access';
  end if;

  if removing_caregiver and exists (
    select 1
    from public.care_assignments assignment
    join public.care_sessions session on session.assignment_id = assignment.id
    where assignment.caregiver_id = target_caregiver_id
      and session.status = 'IN_PROGRESS'
  ) then
    raise exception 'Complete the caregiver open care session before removing caregiver access';
  end if;

  if adding_client then
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
  elsif removing_client then
    delete from public.client_members where user_id = p_user_id;
  end if;

  if adding_caregiver then
    insert into public.caregiver_applications (
      user_id, certification_summary, status, reviewed_by, reviewed_at, review_note
    ) values (
      p_user_id, '관리자 다중 권한 구성으로 생성', 'APPROVED',
      auth.uid(), now(), '관리자 직접 승인'
    )
    on conflict (user_id) do update set
      status = 'APPROVED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = '관리자 다중 권한 구성으로 승인';

    insert into public.caregivers (user_id, status)
    values (p_user_id, 'ACTIVE')
    on conflict (user_id) do update set status = 'ACTIVE', updated_at = now();
  elsif removing_caregiver then
    update public.caregivers
    set status = 'INACTIVE', updated_at = now()
    where user_id = p_user_id;
  end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role)
  select p_user_id, role from unnest(normalized_roles) role;

  update public.profiles
  set requested_role = case
        when 'OWNER'::public.app_role = any(normalized_roles)
          or 'ADMIN'::public.app_role = any(normalized_roles)
          or 'CARE_MANAGER'::public.app_role = any(normalized_roles) then 'ADMIN'
        when 'CAREGIVER'::public.app_role = any(normalized_roles) then 'CAREGIVER'
        when 'CLIENT'::public.app_role = any(normalized_roles) then 'CLIENT'
        else 'RETAIL_STAFF'
      end,
      updated_at = now()
  where id = p_user_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'CONFIGURE_MEMBER_ACCESS_ROLES', 'user_roles', p_user_id,
    jsonb_build_object('old_roles', existing_roles, 'new_roles', normalized_roles)
  );
end;
$$;

revoke all on function public.admin_set_member_access_roles(uuid, public.app_role[]) from public;
revoke all on function public.admin_set_member_access_roles(uuid, public.app_role[]) from anon;
grant execute on function public.admin_set_member_access_roles(uuid, public.app_role[]) to authenticated;

comment on function public.admin_set_member_access_roles(uuid, public.app_role[]) is
  'Atomically configures combined member workspaces while preserving active client and caregiver records.';

select pg_notify('pgrst', 'reload schema');
