-- Unified member governance for the K-Wellness web app.
-- CLIENT and CAREGIVER are public signup paths. ADMIN is provisioned internally.

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active() and (
    public.has_role('OWNER') or public.has_role('ADMIN')
  );
$$;

create or replace function public.has_role_for_user(
  p_user_id uuid,
  p_role public.app_role
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = p_role
  );
$$;

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
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change member roles';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Administrators cannot change their own role';
  end if;
  if p_role not in ('CLIENT', 'CAREGIVER', 'RETAIL_STAFF', 'ADMIN') then
    raise exception 'Unsupported member role';
  end if;
  if public.has_role_for_user(p_user_id, 'OWNER') then
    raise exception 'Owner roles cannot be changed here';
  end if;

  select * into target_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Member not found';
  end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role) values (p_user_id, p_role);

  update public.profiles
  set requested_role = p_role::text,
      account_status = 'ACTIVE',
      deleted_at = null,
      deleted_by = null,
      updated_at = now()
  where id = p_user_id;

  if p_role = 'CLIENT' then
    update public.caregivers
    set status = 'INACTIVE', updated_at = now()
    where user_id = p_user_id;

    select cm.client_id into target_client_id
    from public.client_members cm
    where cm.user_id = p_user_id
    order by cm.is_primary desc, cm.created_at
    limit 1;

    if target_client_id is null then
      select c.id into target_client_id
      from public.clients c
      where c.created_by = p_user_id
      order by c.created_at
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
      p_user_id, '관리자 회원 종류 변경으로 생성', 'APPROVED', auth.uid(), now(), '관리자 직접 승인'
    )
    on conflict (user_id) do update set
      status = 'APPROVED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = '관리자 회원 종류 변경으로 승인';

    insert into public.caregivers (user_id, status)
    values (p_user_id, 'ACTIVE')
    on conflict (user_id) do update set status = 'ACTIVE', updated_at = now();

  else
    delete from public.client_members where user_id = p_user_id;
    update public.caregivers
    set status = 'INACTIVE', updated_at = now()
    where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.admin_archive_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can archive members';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Administrators cannot archive their own account';
  end if;
  if public.has_role_for_user(p_user_id, 'OWNER') then
    raise exception 'Owner accounts cannot be archived here';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found';
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

  delete from public.client_members where user_id = p_user_id;
  delete from public.user_roles where user_id = p_user_id;
end;
$$;

-- Keep role changes limited to real administrators, not general care managers.
create or replace function public.set_member_account_status(
  p_user_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can manage member access';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REJECTED') then
    raise exception 'Invalid account status';
  end if;
  if p_user_id = auth.uid() and p_status <> 'ACTIVE' then
    raise exception 'Administrators cannot suspend their own account';
  end if;

  update public.profiles
  set account_status = p_status,
      deleted_at = case when p_status = 'REJECTED' then coalesce(deleted_at, now()) else null end,
      deleted_by = case when p_status = 'REJECTED' then coalesce(deleted_by, auth.uid()) else null end,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Member not found';
  end if;

  update public.caregivers
  set status = case when p_status = 'ACTIVE' then 'ACTIVE' else 'INACTIVE' end,
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

-- No email can promote itself from the browser.
create or replace function public.claim_initial_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Self-service administrator claiming is disabled';
end;
$$;

revoke all on function public.admin_change_member_role(uuid, public.app_role) from public;
revoke all on function public.admin_archive_member(uuid) from public;
grant execute on function public.admin_change_member_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_archive_member(uuid) to authenticated;

drop policy if exists "roles: staff manage" on public.user_roles;
create policy "roles: administrators manage" on public.user_roles
for all to authenticated using (public.is_admin()) with check (public.is_admin());

comment on function public.admin_change_member_role(uuid, public.app_role) is
  'Atomically changes a member type and resets family/caregiver access boundaries.';
comment on function public.admin_archive_member(uuid) is
  'Soft-deletes a member by blocking access while preserving operational records.';

-- One-time cleanup: former email-based operator accounts become normal clients.
delete from public.user_roles ur
using public.profiles p
where ur.user_id = p.id
  and lower(p.email) in ('parksiyoo9@gmail.com', 'leffeapply@gmail.com')
  and ur.role in ('ADMIN', 'CARE_MANAGER', 'OWNER');

insert into public.user_roles (user_id, role)
select p.id, 'CLIENT'::public.app_role
from public.profiles p
where lower(p.email) in ('parksiyoo9@gmail.com', 'leffeapply@gmail.com')
on conflict do nothing;

delete from public.client_members cm
using public.profiles p
where cm.user_id = p.id
  and lower(p.email) = 'admin@kwellness.test';

delete from public.clients c
using public.profiles p
where c.created_by = p.id
  and lower(p.email) = 'admin@kwellness.test'
  and c.status = 'LEAD'
  and not exists (select 1 from public.care_contracts cc where cc.client_id = c.id)
  and not exists (select 1 from public.client_service_requests sr where sr.client_id = c.id);

-- The internal Auth user must already exist before this migration is applied.
delete from public.user_roles ur
using public.profiles p
where ur.user_id = p.id
  and lower(p.email) = 'admin@kwellness.test';

insert into public.user_roles (user_id, role)
select p.id, 'ADMIN'::public.app_role
from public.profiles p
where lower(p.email) = 'admin@kwellness.test'
on conflict do nothing;

alter table public.profiles disable trigger protect_profile_security_fields_trigger;
update public.profiles
set requested_role = case
      when lower(email) = 'admin@kwellness.test' then 'ADMIN'
      else 'CLIENT'
    end,
    account_status = 'ACTIVE',
    deleted_at = null,
    deleted_by = null,
    updated_at = now()
where lower(email) in (
  'admin@kwellness.test',
  'parksiyoo9@gmail.com',
  'leffeapply@gmail.com'
);
alter table public.profiles enable trigger protect_profile_security_fields_trigger;

do $$
declare
  operator_profile record;
  operator_client_id uuid;
begin
  for operator_profile in
    select id, full_name
    from public.profiles
    where lower(email) in ('parksiyoo9@gmail.com', 'leffeapply@gmail.com')
  loop
    if not exists (select 1 from public.client_members where user_id = operator_profile.id) then
      select id into operator_client_id
      from public.clients
      where created_by = operator_profile.id
      order by created_at
      limit 1;

      if operator_client_id is null then
        insert into public.clients (display_name, status, created_by)
        values (operator_profile.full_name, 'LEAD', operator_profile.id)
        returning id into operator_client_id;
      end if;

      insert into public.client_members (client_id, user_id, relationship, is_primary)
      values (operator_client_id, operator_profile.id, 'PARENT', true)
      on conflict do nothing;
    end if;
    operator_client_id := null;
  end loop;
end;
$$;
