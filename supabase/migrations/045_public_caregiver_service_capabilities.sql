begin;

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
    array['POSTPARTUM', 'BABYSITTING']::text[]
      || case
        when coalesce(hr.is_massage_therapist, false) then array['MASSAGE']::text[]
        else '{}'::text[]
      end as service_capabilities
  from public.caregivers caregiver
  join public.profiles profile on profile.id = caregiver.user_id
  join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
  left join public.caregiver_public_profiles public_profile on public_profile.caregiver_id = caregiver.id
  where coalesce(public_profile.is_published, true)
    and caregiver.status = 'ACTIVE'
    and profile.account_status = 'ACTIVE'
    and profile.deleted_at is null
    and hr.employment_status = 'ACTIVE'
    and public.has_role_for_user(caregiver.user_id, 'CAREGIVER')
  order by caregiver.id;
$$;

revoke all on function public.public_caregiver_service_capabilities() from public;
grant execute on function public.public_caregiver_service_capabilities() to anon, authenticated;

comment on function public.public_caregiver_service_capabilities() is
  'Returns only public service badges derived from active administrator-granted caregiver and massage-therapist permissions.';

select pg_notify('pgrst', 'reload schema');

commit;
