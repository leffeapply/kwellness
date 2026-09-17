-- Recalculate every existing six-axis review with the same arithmetic-mean rule
-- used by the new review RPCs. Reviews without competency data keep their legacy
-- overall rating unchanged.

begin;

update public.caregiver_reviews
set rating = round((
  meal_preparation_score::numeric
  + attentiveness_score::numeric
  + punctuality_score::numeric
  + professionalism_score::numeric
  + communication_score::numeric
  + hygiene_safety_score::numeric
) / 6, 1)
where num_nonnulls(
  meal_preparation_score,
  attentiveness_score,
  punctuality_score,
  professionalism_score,
  communication_score,
  hygiene_safety_score
) = 6;

update public.caregiver_historical_reviews
set rating = round((
  meal_preparation_score::numeric
  + attentiveness_score::numeric
  + punctuality_score::numeric
  + professionalism_score::numeric
  + communication_score::numeric
  + hygiene_safety_score::numeric
) / 6, 1),
    updated_at = now()
where num_nonnulls(
  meal_preparation_score,
  attentiveness_score,
  punctuality_score,
  professionalism_score,
  communication_score,
  hygiene_safety_score
) = 6;

select pg_notify('pgrst', 'reload schema');

commit;
