-- Make an administrator-granted CLIENT role immediately usable and give the
-- member a safe, self-service family profile before the first care request.

alter table public.clients
  add column if not exists service_address text,
  add column if not exists allergy_notes text,
  add column if not exists household_extra_people integer not null default 0,
  add column if not exists emergency_contact text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass
      and conname = 'clients_household_extra_people_check'
  ) then
    alter table public.clients
      add constraint clients_household_extra_people_check
      check (household_extra_people between 0 and 30);
  end if;
end;
$$;

with latest_request as (
  select distinct on (request.client_id)
    request.client_id,
    request.service_address,
    request.allergy_notes,
    request.household_extra_people,
    request.special_notes
  from public.client_service_requests request
  order by request.client_id, request.created_at desc, request.id desc
)
update public.clients client
set service_address = coalesce(client.service_address, latest_request.service_address),
    allergy_notes = coalesce(client.allergy_notes, latest_request.allergy_notes),
    household_extra_people = coalesce(latest_request.household_extra_people, client.household_extra_people, 0),
    notes = coalesce(client.notes, latest_request.special_notes),
    updated_at = now()
from latest_request
where latest_request.client_id = client.id
  and (
    client.service_address is null
    or client.allergy_notes is null
    or client.notes is null
    or client.household_extra_people = 0
  );

create or replace function public.ensure_client_workspace_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  target_name text;
  target_language text;
begin
  if new.role <> 'CLIENT'::public.app_role then
    return new;
  end if;

  select member.client_id into target_client_id
  from public.client_members member
  where member.user_id = new.user_id
  order by member.is_primary desc, member.created_at, member.client_id
  limit 1;

  if target_client_id is null then
    select client.id into target_client_id
    from public.clients client
    where client.created_by = new.user_id
    order by client.created_at, client.id
    limit 1;
  end if;

  if target_client_id is null then
    select profile.full_name, profile.preferred_language
    into target_name, target_language
    from public.profiles profile
    where profile.id = new.user_id
      and profile.account_status <> 'REJECTED'
      and profile.deleted_at is null;

    if not found then
      raise exception 'An active member profile is required for client access';
    end if;

    insert into public.clients (display_name, status, created_by)
    values (target_name, 'LEAD', new.user_id)
    returning id into target_client_id;
  else
    select profile.full_name, profile.preferred_language
    into target_name, target_language
    from public.profiles profile
    where profile.id = new.user_id;

    update public.clients
    set status = case when status = 'INACTIVE' then 'LEAD' else status end,
        display_name = coalesce(nullif(trim(target_name), ''), display_name),
        updated_at = now()
    where id = target_client_id;
  end if;

  insert into public.client_members (client_id, user_id, relationship, is_primary)
  values (target_client_id, new.user_id, 'PARENT', true)
  on conflict (client_id, user_id) do update set is_primary = true;

  update public.profiles
  set account_status = 'ACTIVE', updated_at = now()
  where id = new.user_id
    and account_status = 'PENDING'
    and deleted_at is null;

  insert into public.client_management_profiles (
    client_id, lifecycle_status, preferred_language, updated_by
  ) values (
    target_client_id, 'LEAD', coalesce(nullif(trim(target_language), ''), 'ko'), new.user_id
  )
  on conflict (client_id) do nothing;

  return new;
end;
$$;

drop trigger if exists ensure_client_workspace_profile_on_role on public.user_roles;
create trigger ensure_client_workspace_profile_on_role
after insert or update of role on public.user_roles
for each row
when (new.role = 'CLIENT'::public.app_role)
execute function public.ensure_client_workspace_profile();

-- Repair any client role that predates this trigger. Setting the enum to its
-- current value intentionally fires the idempotent trigger.
update public.user_roles
set role = role
where role = 'CLIENT'::public.app_role;

create or replace function public.update_my_client_profile(
  p_full_name text,
  p_phone text,
  p_preferred_language text,
  p_baby_id uuid,
  p_baby_name text,
  p_baby_birth_date date,
  p_service_address text,
  p_allergy_notes text,
  p_household_extra_people integer,
  p_emergency_contact text,
  p_request_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  saved_baby_id uuid;
  normalized_baby_name text := trim(coalesce(p_baby_name, ''));
  normalized_address text := trim(coalesce(p_service_address, ''));
  normalized_language text := lower(trim(coalesce(p_preferred_language, '')));
begin
  if auth.uid() is null or not public.account_is_active() or not public.has_role('CLIENT') then
    raise exception 'An active authenticated client account is required';
  end if;
  if length(normalized_baby_name) not between 1 and 80 then
    raise exception 'Baby name must contain between 1 and 80 characters';
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
  if p_baby_birth_date is null then
    raise exception 'Birth or due date is required';
  end if;
  if length(normalized_address) not between 5 and 500 then
    raise exception 'A complete service address is required';
  end if;
  if coalesce(p_household_extra_people, 0) not between 0 and 30 then
    raise exception 'Household count is outside the supported range';
  end if;
  if length(trim(coalesce(p_allergy_notes, ''))) > 500
     or length(trim(coalesce(p_emergency_contact, ''))) > 300
     or length(trim(coalesce(p_request_note, ''))) > 2000 then
    raise exception 'Client profile text is too long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('care-session-starter:' || auth.uid()::text, 0));

  select member.client_id into target_client_id
  from public.client_members member
  where member.user_id = auth.uid()
  order by member.is_primary desc, member.created_at, member.client_id
  limit 1;

  if target_client_id is null then
    raise exception 'Client membership not found';
  end if;

  perform 1
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.account_status = 'ACTIVE'
    and profile.deleted_at is null
  for update;

  if not found then
    raise exception 'The client profile is no longer active';
  end if;

  perform 1
  from public.clients client
  where client.id = target_client_id
  for update;

  if not found then
    raise exception 'Client record not found';
  end if;

  if p_baby_id is not null then
    select baby.id into saved_baby_id
    from public.babies baby
    where baby.id = p_baby_id
      and baby.client_id = target_client_id
    for update;

    if saved_baby_id is null then
      raise exception 'Baby does not belong to this client';
    end if;
  else
    select baby.id into saved_baby_id
    from public.babies baby
    where baby.client_id = target_client_id
      and lower(trim(baby.first_name)) = lower(normalized_baby_name)
    order by baby.created_at, baby.id
    limit 1
    for update;
  end if;

  if saved_baby_id is null then
    insert into public.babies (client_id, first_name, birth_date)
    values (target_client_id, normalized_baby_name, p_baby_birth_date)
    returning id into saved_baby_id;
  else
    update public.babies
    set first_name = normalized_baby_name,
        birth_date = p_baby_birth_date,
        updated_at = now()
    where id = saved_baby_id;
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = nullif(trim(p_phone), ''),
      preferred_language = normalized_language,
      updated_at = now()
  where id = auth.uid();

  update public.clients
  set display_name = trim(p_full_name),
      service_address = normalized_address,
      allergy_notes = coalesce(nullif(trim(p_allergy_notes), ''), '없음'),
      household_extra_people = coalesce(p_household_extra_people, 0),
      emergency_contact = nullif(trim(p_emergency_contact), ''),
      notes = nullif(trim(p_request_note), ''),
      updated_at = now()
  where id = target_client_id;

  insert into public.client_management_profiles (
    client_id, lifecycle_status, preferred_language, emergency_contact, updated_by
  ) values (
    target_client_id, 'LEAD', normalized_language, nullif(trim(p_emergency_contact), ''), auth.uid()
  )
  on conflict (client_id) do update set
    preferred_language = excluded.preferred_language,
    emergency_contact = excluded.emergency_contact,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'UPDATE_MY_CLIENT_PROFILE', 'clients', target_client_id,
    jsonb_build_object('baby_id', saved_baby_id, 'profile_complete', true)
  );

  return jsonb_build_object('client_id', target_client_id, 'baby_id', saved_baby_id);
end;
$$;

revoke all on function public.update_my_client_profile(text, text, text, uuid, text, date, text, text, integer, text, text) from public;
revoke all on function public.update_my_client_profile(text, text, text, uuid, text, date, text, text, integer, text, text) from anon;
grant execute on function public.update_my_client_profile(text, text, text, uuid, text, date, text, text, integer, text, text) to authenticated;

create or replace function public.sync_client_profile_from_service_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clients
  set service_address = new.service_address,
      allergy_notes = new.allergy_notes,
      household_extra_people = new.household_extra_people,
      notes = coalesce(new.special_notes, notes),
      updated_at = now()
  where id = new.client_id;
  return new;
end;
$$;

drop trigger if exists sync_client_profile_from_service_request_insert on public.client_service_requests;
create trigger sync_client_profile_from_service_request_insert
after insert on public.client_service_requests
for each row execute function public.sync_client_profile_from_service_request();

select pg_notify('pgrst', 'reload schema');
