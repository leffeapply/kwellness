-- Keep homepage caregiver identity and qualifications synchronized with the
-- canonical account and HR profile. Marketing-only copy remains curated in
-- caregiver_public_profiles, while shared facts can no longer drift.

begin;

create or replace function public.caregiver_profile_text_list(
  p_value text,
  p_max_items integer,
  p_max_item_length integer
)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(left(item_value, p_max_item_length) order by first_position), '{}'::text[])
  from (
    select trim(submitted.item_input) as item_value,
           min(submitted.item_position) as first_position
    from unnest(
      regexp_split_to_array(coalesce(p_value, ''), E'\\s*[,·\\n]\\s*')
    ) with ordinality as submitted(item_input, item_position)
    where nullif(trim(submitted.item_input), '') is not null
    group by trim(submitted.item_input)
    order by min(submitted.item_position)
    limit greatest(0, least(coalesce(p_max_items, 0), 100))
  ) normalized_items;
$$;

create or replace function public.sync_caregiver_public_profile_shared_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_name text;
  canonical_career_years numeric;
  canonical_specialties text;
  canonical_credentials text;
  canonical_service_area text;
begin
  select
    profile.full_name,
    hr.career_years,
    hr.specialties,
    hr.career_summary,
    hr.service_area_notes
  into
    canonical_name,
    canonical_career_years,
    canonical_specialties,
    canonical_credentials,
    canonical_service_area
  from public.caregivers caregiver
  join public.profiles profile on profile.id = caregiver.user_id
  left join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
  where caregiver.id = new.caregiver_id;

  if found then
    new.display_name := left(trim(canonical_name), 80);
    new.career_years := coalesce(canonical_career_years, 0);
    new.specialties := public.caregiver_profile_text_list(canonical_specialties, 12, 60);
    new.credentials := public.caregiver_profile_text_list(canonical_credentials, 12, 120);
    new.service_area := nullif(left(trim(coalesce(canonical_service_area, '')), 240), '');
    if new.photo_alt is null or nullif(trim(new.photo_alt), '') is null then
      new.photo_alt := left(trim(canonical_name) || ' 관리사 프로필 사진', 160);
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists caregiver_public_profile_shared_fields_sync
  on public.caregiver_public_profiles;
create trigger caregiver_public_profile_shared_fields_sync
before insert or update on public.caregiver_public_profiles
for each row execute function public.sync_caregiver_public_profile_shared_fields();

create or replace function public.sync_caregiver_public_profile_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name is distinct from old.full_name then
    update public.caregiver_public_profiles public_profile
    set display_name = new.full_name,
        photo_alt = case
          when public_profile.photo_alt is null
            or trim(public_profile.photo_alt) = ''
            or trim(public_profile.photo_alt) = trim(old.full_name) || ' 관리사 프로필 사진'
          then left(trim(new.full_name) || ' 관리사 프로필 사진', 160)
          else public_profile.photo_alt
        end,
        updated_by = coalesce(auth.uid(), public_profile.updated_by),
        updated_at = now()
    from public.caregivers caregiver
    where caregiver.user_id = new.id
      and public_profile.caregiver_id = caregiver.id;
  end if;

  return new;
end;
$$;

drop trigger if exists caregiver_public_profile_name_sync on public.profiles;
create trigger caregiver_public_profile_name_sync
after update of full_name on public.profiles
for each row execute function public.sync_caregiver_public_profile_from_profile();

create or replace function public.sync_caregiver_public_profile_from_hr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.caregiver_public_profiles public_profile
  set career_years = new.career_years,
      specialties = public.caregiver_profile_text_list(new.specialties, 12, 60),
      credentials = public.caregiver_profile_text_list(new.career_summary, 12, 120),
      service_area = nullif(left(trim(coalesce(new.service_area_notes, '')), 240), ''),
      updated_by = coalesce(auth.uid(), public_profile.updated_by),
      updated_at = now()
  where public_profile.caregiver_id = new.caregiver_id;

  return new;
end;
$$;

drop trigger if exists caregiver_public_profile_hr_sync
  on public.caregiver_hr_profiles;
create trigger caregiver_public_profile_hr_sync
after insert or update of career_years, career_summary, specialties, service_area_notes
on public.caregiver_hr_profiles
for each row execute function public.sync_caregiver_public_profile_from_hr();

-- Repair profiles that drifted before synchronization was introduced.
update public.caregiver_public_profiles public_profile
set display_name = profile.full_name,
    career_years = hr.career_years,
    specialties = public.caregiver_profile_text_list(hr.specialties, 12, 60),
    credentials = public.caregiver_profile_text_list(hr.career_summary, 12, 120),
    service_area = nullif(left(trim(coalesce(hr.service_area_notes, '')), 240), ''),
    photo_alt = case
      when public_profile.photo_alt is null or trim(public_profile.photo_alt) = ''
      then left(trim(profile.full_name) || ' 관리사 프로필 사진', 160)
      else public_profile.photo_alt
    end,
    updated_at = now()
from public.caregivers caregiver
join public.profiles profile on profile.id = caregiver.user_id
join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
where public_profile.caregiver_id = caregiver.id;

revoke all on function public.caregiver_profile_text_list(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.sync_caregiver_public_profile_shared_fields()
  from public, anon, authenticated;
revoke all on function public.sync_caregiver_public_profile_from_profile()
  from public, anon, authenticated;
revoke all on function public.sync_caregiver_public_profile_from_hr()
  from public, anon, authenticated;

comment on function public.sync_caregiver_public_profile_shared_fields() is
  'Makes the canonical account and caregiver HR record authoritative for shared homepage profile facts.';

select pg_notify('pgrst', 'reload schema');

commit;
