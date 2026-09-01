-- Live authentication, onboarding, operational writes, and administrator member management.
-- Apply after 017_private_storage.sql.

alter table public.profiles
  add column if not exists email text,
  add column if not exists requested_role text not null default 'CLIENT'
    check (requested_role in ('CLIENT', 'CAREGIVER', 'ADMIN', 'RETAIL_STAFF')),
  add column if not exists account_status text not null default 'ACTIVE'
    check (account_status in ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'));

create unique index if not exists profiles_email_lower_idx
  on public.profiles (lower(email)) where email is not null;

create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status = 'ACTIVE'
  );
$$;

create or replace function public.is_care_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active() and (
    public.has_role('OWNER')
    or public.has_role('ADMIN')
    or public.has_role('CARE_MANAGER')
  );
$$;

create or replace function public.is_client_member(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active() and exists (
    select 1 from public.client_members
    where client_id = target_client_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_assigned_caregiver_for_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active() and exists (
    select 1
    from public.care_assignments a
    join public.care_contracts cc on cc.id = a.contract_id
    join public.caregivers cg on cg.id = a.caregiver_id
    where cc.client_id = target_client_id
      and cg.user_id = auth.uid()
      and cg.status = 'ACTIVE'
      and a.status = 'CONFIRMED'
      and now() <= a.ends_at
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role text := upper(coalesce(new.raw_user_meta_data ->> 'requested_role', 'CLIENT'));
  created_client_id uuid;
  consent_version text := coalesce(new.raw_user_meta_data ->> 'consent_version', '2026-08-29');
begin
  if desired_role not in ('CLIENT', 'CAREGIVER') then
    desired_role := 'CLIENT';
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
      (created_client_id, 'SERVICE_TERMS', consent_version, new.id, '{}'::jsonb),
      (created_client_id, 'PRIVACY', consent_version, new.id, '{}'::jsonb),
      (created_client_id, 'SENSITIVE_CARE_DATA', consent_version, new.id, '{}'::jsonb),
      (created_client_id, 'MARKETING', consent_version, new.id,
        jsonb_build_object('granted', coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false)));
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_care_staff() then
    new.email := old.email;
    new.requested_role := old.requested_role;
    new.account_status := old.account_status;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_profile_security_fields_trigger on public.profiles;
create trigger protect_profile_security_fields_trigger
before update on public.profiles
for each row execute function public.protect_profile_security_fields();

drop policy if exists "profiles: staff update" on public.profiles;
create policy "profiles: staff update" on public.profiles
for update to authenticated using (public.is_care_staff()) with check (public.is_care_staff());

drop policy if exists "clients: approved member or staff read" on public.clients;
drop policy if exists "clients: member or staff read" on public.clients;
create policy "clients: member or staff read" on public.clients
for select to authenticated using (
  public.is_care_staff()
  or public.is_client_member(id)
  or public.is_assigned_caregiver_for_client(id)
);

drop policy if exists "babies: approved family or staff read" on public.babies;
drop policy if exists "babies: family or staff read" on public.babies;
create policy "babies: family or staff read" on public.babies
for select to authenticated using (
  public.is_care_staff()
  or public.is_client_member(client_id)
  or public.is_assigned_caregiver_for_client(client_id)
);

drop policy if exists "babies: family insert" on public.babies;
create policy "babies: family insert" on public.babies
for insert to authenticated with check (public.is_client_member(client_id));

drop policy if exists "babies: family update" on public.babies;
create policy "babies: family update" on public.babies
for update to authenticated using (public.is_client_member(client_id))
with check (public.is_client_member(client_id));

drop policy if exists "assignments: assigned caregiver or staff read" on public.care_assignments;
create policy "assignments: care team or family read" on public.care_assignments
for select to authenticated using (
  public.is_care_staff()
  or (
    public.account_is_active()
    and exists (
      select 1 from public.caregivers c
      where c.id = caregiver_id and c.user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.care_contracts cc
    where cc.id = contract_id and public.is_client_member(cc.client_id)
  )
);

drop policy if exists "sessions: assigned caregiver or staff read" on public.care_sessions;
create policy "sessions: care team or family read" on public.care_sessions
for select to authenticated using (
  public.is_care_staff()
  or (
    public.account_is_active()
    and exists (
      select 1 from public.care_assignments a
      join public.caregivers c on c.id = a.caregiver_id
      where a.id = assignment_id and c.user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.care_assignments a
    join public.care_contracts cc on cc.id = a.contract_id
    where a.id = assignment_id and public.is_client_member(cc.client_id)
  )
);

drop policy if exists "events: care team read" on public.care_events;
create policy "events: care team or family read" on public.care_events
for select to authenticated using (
  public.is_care_staff()
  or (public.account_is_active() and created_by = auth.uid())
  or (
    public.account_is_active()
    and exists (
      select 1 from public.care_sessions s
      join public.care_assignments a on a.id = s.assignment_id
      join public.caregivers c on c.id = a.caregiver_id
      where s.id = care_session_id and c.user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.care_sessions s
    join public.care_assignments a on a.id = s.assignment_id
    join public.care_contracts cc on cc.id = a.contract_id
    where s.id = care_session_id and public.is_client_member(cc.client_id)
  )
);

drop policy if exists "events: assigned caregiver insert" on public.care_events;
create policy "events: active assigned caregiver insert" on public.care_events
for insert to authenticated with check (
  public.account_is_active()
  and created_by = auth.uid()
  and exists (
    select 1 from public.care_sessions s
    join public.care_assignments a on a.id = s.assignment_id
    join public.caregivers c on c.id = a.caregiver_id
    where s.id = care_session_id
      and s.status = 'IN_PROGRESS'
      and c.user_id = auth.uid()
      and a.status = 'CONFIRMED'
      and now() between a.starts_at and a.ends_at
  )
);

drop policy if exists "contracts: family or staff read" on public.care_contracts;
create policy "contracts: family care team or staff read" on public.care_contracts
for select to authenticated using (
  public.is_care_staff()
  or public.is_client_member(client_id)
  or public.is_assigned_caregiver_for_client(client_id)
);

drop policy if exists "client requests: applicant create" on public.client_service_requests;
create policy "client requests: applicant create" on public.client_service_requests
for insert to authenticated with check (
  requested_by = auth.uid()
  and status = 'PENDING'
  and public.is_client_member(client_id)
);

drop policy if exists "client requests: applicant or staff read" on public.client_service_requests;
create policy "client requests: active applicant or staff read" on public.client_service_requests
for select to authenticated using (
  public.is_care_staff()
  or (public.account_is_active() and requested_by = auth.uid())
);

create or replace function public.submit_client_service_request(
  p_service_type public.care_service_type,
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
  p_special_notes text default null,
  p_maternal_notes text default null,
  p_meal_instructions text default null,
  p_routine_notes text default null,
  p_pickup_notes text default null,
  p_request_kind text default 'NEW'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  target_baby_id uuid;
  created_request_id uuid;
begin
  select cm.client_id into target_client_id
  from public.client_members cm
  where cm.user_id = auth.uid()
  order by cm.is_primary desc, cm.created_at
  limit 1;

  if target_client_id is null then
    raise exception 'Client membership not found';
  end if;

  if exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status <> 'ACTIVE'
  ) then
    raise exception 'This account is not active';
  end if;

  select id into target_baby_id
  from public.babies
  where client_id = target_client_id and lower(first_name) = lower(trim(p_baby_name))
  order by created_at
  limit 1;

  if target_baby_id is null then
    insert into public.babies (client_id, first_name, birth_date)
    values (target_client_id, trim(p_baby_name), p_birth_or_due_date)
    returning id into target_baby_id;
  else
    update public.babies
    set birth_date = coalesce(birth_date, p_birth_or_due_date), updated_at = now()
    where id = target_baby_id;
  end if;

  insert into public.client_service_requests (
    client_id, requested_by, baby_id, birth_or_due_date, requested_weeks,
    desired_start_date, daily_start_time, daily_end_time, service_address,
    household_extra_people, allergy_notes, special_notes, service_type,
    requested_days, maternal_notes, meal_instructions, routine_notes,
    pickup_notes, request_kind, deposit_amount, deposit_status,
    sequence_policy_accepted, insured_staffing_acknowledged
  ) values (
    target_client_id, auth.uid(), target_baby_id, p_birth_or_due_date, p_requested_weeks,
    p_desired_start_date, p_daily_start_time, p_daily_end_time, trim(p_service_address),
    greatest(coalesce(p_household_extra_people, 0), 0),
    coalesce(nullif(trim(p_allergy_notes), ''), '없음'), nullif(trim(p_special_notes), ''),
    p_service_type, coalesce(p_requested_days, array['월','화','수','목','금']),
    nullif(trim(p_maternal_notes), ''), nullif(trim(p_meal_instructions), ''),
    nullif(trim(p_routine_notes), ''), nullif(trim(p_pickup_notes), ''),
    coalesce(p_request_kind, 'NEW'),
    case p_service_type when 'POSTPARTUM' then 500.00 else 128.00 end,
    'DUE_ON_APPROVAL', true, true
  ) returning id into created_request_id;

  return created_request_id;
end;
$$;

create or replace function public.review_client_service_request(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  target_service_type public.care_service_type;
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can review client requests';
  end if;

  select client_id, service_type into target_client_id, target_service_type
  from public.client_service_requests
  where id = p_request_id and status = 'PENDING'
  for update;

  if target_client_id is null then
    raise exception 'Pending client request not found';
  end if;

  update public.client_service_requests
  set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      deposit_amount = case target_service_type when 'POSTPARTUM' then 500.00 else 128.00 end,
      deposit_status = case when p_approve then 'PAID' else deposit_status end,
      deposit_paid_at = case when p_approve then now() else deposit_paid_at end,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_review_note,
      updated_at = now()
  where id = p_request_id;

  if p_approve then
    update public.clients set status = 'ACTIVE', updated_at = now()
    where id = target_client_id;
  end if;
end;
$$;

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
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can schedule client requests';
  end if;

  select * into request_row
  from public.client_service_requests
  where id = p_request_id and status = 'APPROVED' and approved_assignment_id is null
  for update;

  if not found then
    raise exception 'Approved unscheduled client request not found';
  end if;

  if not exists (select 1 from public.caregivers where id = p_caregiver_id and status = 'ACTIVE') then
    raise exception 'Selected caregiver is not active';
  end if;

  requested_start := (request_row.desired_start_date + request_row.daily_start_time)
    at time zone 'America/New_York';
  requested_end := (
    request_row.desired_start_date + (request_row.requested_weeks * 7 - 1)
    + request_row.daily_end_time
  ) at time zone 'America/New_York';

  if not public.caregiver_is_available(p_caregiver_id, requested_start, requested_end) then
    raise exception 'The selected caregiver is no longer available for this period';
  end if;

  insert into public.care_contracts (
    client_id, baby_id, start_date, end_date, agreed_rate, status, created_by
  ) values (
    request_row.client_id, request_row.baby_id, request_row.desired_start_date,
    request_row.desired_start_date + (request_row.requested_weeks * 7 - 1),
    request_row.estimated_total, 'ACTIVE', auth.uid()
  ) returning id into created_contract_id;

  insert into public.care_assignments (
    contract_id, caregiver_id, starts_at, ends_at, status, assigned_by,
    service_address, daily_start_time, daily_end_time, household_extra_people,
    allergy_notes, client_request_note, contract_weeks, service_type, service_days,
    maternal_notes, meal_instructions, routine_notes, pickup_notes, weekly_rate,
    contract_value, deposit_amount, deposit_status, deposit_paid_at, updated_by
  ) values (
    created_contract_id, p_caregiver_id, requested_start, requested_end, 'CONFIRMED', auth.uid(),
    request_row.service_address, request_row.daily_start_time, request_row.daily_end_time,
    request_row.household_extra_people, request_row.allergy_notes, request_row.special_notes,
    request_row.requested_weeks, request_row.service_type, request_row.requested_days,
    request_row.maternal_notes, request_row.meal_instructions, request_row.routine_notes,
    request_row.pickup_notes, request_row.weekly_rate, request_row.estimated_total,
    request_row.deposit_amount, request_row.deposit_status, request_row.deposit_paid_at, auth.uid()
  ) returning id into created_assignment_id;

  insert into public.care_sessions (assignment_id, status)
  values (created_assignment_id, 'SCHEDULED');

  update public.client_service_requests
  set approved_assignment_id = created_assignment_id, updated_at = now()
  where id = p_request_id;

  return created_assignment_id;
end;
$$;

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
  allowed boolean;
begin
  select public.is_care_staff() or exists (
    select 1 from public.care_assignments a
    join public.caregivers c on c.id = a.caregiver_id
    where a.id = p_assignment_id
      and c.user_id = auth.uid()
      and a.status = 'CONFIRMED'
      and now() between a.starts_at and a.ends_at
  ) into allowed;

  if not allowed then
    raise exception 'You cannot operate this care session';
  end if;

  insert into public.care_sessions (assignment_id, status, started_at, started_by)
  values (
    p_assignment_id, p_status,
    case when p_status = 'IN_PROGRESS' then now() else null end,
    case when p_status = 'IN_PROGRESS' then auth.uid() else null end
  )
  on conflict (assignment_id) do update set
    status = excluded.status,
    started_at = case
      when excluded.status = 'IN_PROGRESS' then coalesce(public.care_sessions.started_at, now())
      else public.care_sessions.started_at
    end,
    ended_at = case when excluded.status = 'COMPLETED' then now() else null end,
    started_by = coalesce(public.care_sessions.started_by, excluded.started_by),
    updated_at = now()
  returning id into target_session_id;

  return target_session_id;
end;
$$;

create or replace function public.approve_caregiver(
  applicant_user_id uuid,
  approval_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can approve caregivers';
  end if;

  update public.caregiver_applications
  set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = approval_note
  where user_id = applicant_user_id and status = 'PENDING';

  if not found then
    raise exception 'Pending caregiver application not found';
  end if;

  insert into public.user_roles(user_id, role)
  values (applicant_user_id, 'CAREGIVER')
  on conflict do nothing;

  insert into public.caregivers(user_id, status)
  values (applicant_user_id, 'ACTIVE')
  on conflict (user_id) do update set status = 'ACTIVE', updated_at = now();

  update public.profiles
  set account_status = 'ACTIVE', updated_at = now()
  where id = applicant_user_id;
end;
$$;

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
  if not public.is_care_staff() then
    raise exception 'Only care administrators can manage member access';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REJECTED') then
    raise exception 'Invalid account status';
  end if;
  if p_user_id = auth.uid() and p_status <> 'ACTIVE' then
    raise exception 'Administrators cannot suspend their own account';
  end if;
  update public.profiles set account_status = p_status, updated_at = now()
  where id = p_user_id;
  update public.caregivers
  set status = case when p_status = 'ACTIVE' then 'ACTIVE' else 'INACTIVE' end, updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function public.claim_initial_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  verified_email text;
  is_confirmed boolean;
begin
  select lower(email), email_confirmed_at is not null
  into verified_email, is_confirmed
  from auth.users where id = auth.uid();

  if verified_email not in ('parksiyoo9@gmail.com', 'leffeapply@gmail.com')
     or not coalesce(is_confirmed, false) then
    raise exception 'This verified account is not eligible for initial administrator access';
  end if;

  insert into public.profiles (
    id, email, full_name, phone, preferred_language, requested_role, account_status
  )
  select
    u.id,
    lower(u.email),
    coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)),
    nullif(trim(u.raw_user_meta_data ->> 'phone'), ''),
    coalesce(nullif(trim(u.raw_user_meta_data ->> 'preferred_language'), ''), 'ko'),
    'ADMIN',
    'ACTIVE'
  from auth.users u
  where u.id = auth.uid()
  on conflict (id) do update set
    email = excluded.email,
    requested_role = 'ADMIN',
    account_status = 'ACTIVE',
    updated_at = now();

  insert into public.user_roles(user_id, role) values (auth.uid(), 'ADMIN')
  on conflict do nothing;
  delete from public.user_roles where user_id = auth.uid() and role = 'CLIENT';
  delete from public.clients c
  where c.created_by = auth.uid()
    and c.status = 'LEAD'
    and not exists (
      select 1 from public.client_service_requests r where r.client_id = c.id
    );
  update public.profiles
  set requested_role = 'ADMIN', account_status = 'ACTIVE', updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.submit_client_service_request(
  public.care_service_type, text, date, integer, date, time, time, text[], text,
  integer, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.review_client_service_request(uuid, boolean, text) to authenticated;
grant execute on function public.schedule_approved_client_request(uuid, uuid) to authenticated;
grant execute on function public.set_care_session_status(uuid, public.session_status) to authenticated;
grant execute on function public.approve_caregiver(uuid, text) to authenticated;
grant execute on function public.set_member_account_status(uuid, text) to authenticated;
grant execute on function public.claim_initial_admin() to authenticated;

comment on function public.claim_initial_admin() is
  'Allows only a verified K-Wellness operator email to claim the initial ADMIN role.';
