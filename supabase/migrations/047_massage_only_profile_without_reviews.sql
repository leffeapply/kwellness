begin;

-- Massage-only employees are marketed by verified career and specialty data,
-- not by the six care-service competencies used for postpartum/babysitting.
create or replace function public.caregiver_accepts_reputation_reviews(p_caregiver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(hr.can_provide_postpartum, false)
      or coalesce(hr.can_provide_babysitting, false)
  from public.caregiver_hr_profiles hr
  where hr.caregiver_id = p_caregiver_id;
$$;

revoke all on function public.caregiver_accepts_reputation_reviews(uuid) from public, anon, authenticated;

create or replace function public.enforce_reputation_review_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.caregiver_accepts_reputation_reviews(new.caregiver_id), false) then
    raise exception 'Massage-only therapists do not use caregiver ratings or reviews';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_reputation_review_eligibility() from public, anon, authenticated;

drop trigger if exists enforce_caregiver_review_eligibility_trigger on public.caregiver_reviews;
create trigger enforce_caregiver_review_eligibility_trigger
before insert or update of caregiver_id
on public.caregiver_reviews
for each row execute function public.enforce_reputation_review_eligibility();

drop trigger if exists enforce_historical_review_eligibility_trigger on public.caregiver_historical_reviews;
create trigger enforce_historical_review_eligibility_trigger
before insert or update of caregiver_id
on public.caregiver_historical_reviews
for each row execute function public.enforce_reputation_review_eligibility();

comment on function public.caregiver_accepts_reputation_reviews(uuid) is
  'Returns true only when the employee currently provides postpartum care or babysitting; massage-only profiles do not use reputation reviews.';

select pg_notify('pgrst', 'reload schema');

commit;
