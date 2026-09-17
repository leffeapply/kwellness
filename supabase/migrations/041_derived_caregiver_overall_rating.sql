-- The overall review rating is derived from the six required competency scores.
-- Existing legacy ratings remain valid, while all new reviews store a one-decimal
-- arithmetic mean and never accept an independently selected overall score.

begin;

drop function if exists public.submit_caregiver_review(uuid, integer, text[], text, boolean, jsonb);
drop function if exists public.submit_caregiver_review(uuid, text[], text, boolean, jsonb);
drop function if exists public.admin_create_historical_caregiver_review(
  uuid, integer, text[], text, public.care_service_type, date, text, boolean, jsonb
);
drop function if exists public.admin_create_historical_caregiver_review(
  uuid, text[], text, public.care_service_type, date, text, boolean, jsonb
);

alter table public.caregiver_reviews
  drop constraint if exists caregiver_reviews_rating_check;
alter table public.caregiver_reviews
  alter column rating type numeric(2,1) using rating::numeric(2,1);
alter table public.caregiver_reviews
  add constraint caregiver_reviews_rating_check check (rating between 1 and 5);

alter table public.caregiver_historical_reviews
  drop constraint if exists caregiver_historical_reviews_rating_check;
alter table public.caregiver_historical_reviews
  alter column rating type numeric(2,1) using rating::numeric(2,1);
alter table public.caregiver_historical_reviews
  add constraint caregiver_historical_reviews_rating_check check (rating between 1 and 5);

create or replace function public.submit_caregiver_review(
  p_assignment_id uuid,
  p_tags text[],
  p_comment text,
  p_public_consent boolean default false,
  p_competency_scores jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_assignment public.care_assignments%rowtype;
  target_client_id uuid;
  saved_review_id uuid;
  normalized_tags text[];
  normalized_comment text := trim(coalesce(p_comment, ''));
  publication_status text;
  derived_rating numeric(2,1);
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'An active customer account is required';
  end if;
  if p_assignment_id is null then
    raise exception 'A service assignment is required';
  end if;
  if p_competency_scores is null or jsonb_typeof(p_competency_scores) <> 'object' then
    raise exception 'All six competency scores must be integers between 1 and 5';
  end if;
  if (select count(*) from jsonb_object_keys(p_competency_scores)) <> 6
     or not (p_competency_scores ?& array[
       'meal_preparation', 'attentiveness', 'punctuality',
       'professionalism', 'communication', 'hygiene_safety'
     ])
     or exists (
       select 1
       from jsonb_each_text(p_competency_scores) score
       where score.key <> all(array[
         'meal_preparation', 'attentiveness', 'punctuality',
         'professionalism', 'communication', 'hygiene_safety'
       ])
       or score.value !~ '^[1-5]$'
     ) then
    raise exception 'All six competency scores must be integers between 1 and 5';
  end if;

  derived_rating := round((
    (p_competency_scores ->> 'meal_preparation')::numeric
    + (p_competency_scores ->> 'attentiveness')::numeric
    + (p_competency_scores ->> 'punctuality')::numeric
    + (p_competency_scores ->> 'professionalism')::numeric
    + (p_competency_scores ->> 'communication')::numeric
    + (p_competency_scores ->> 'hygiene_safety')::numeric
  ) / 6, 1);

  if char_length(normalized_comment) not between 1 and 500 then
    raise exception 'Review comment must contain between 1 and 500 characters';
  end if;

  select coalesce(array_agg(tag_value order by first_position), '{}'::text[])
  into normalized_tags
  from (
    select trim(tag_input) as tag_value, min(tag_position) as first_position
    from unnest(coalesce(p_tags, '{}'::text[])) with ordinality
      as submitted(tag_input, tag_position)
    where nullif(trim(tag_input), '') is not null
    group by trim(tag_input)
  ) unique_tags;

  if cardinality(normalized_tags) > 5 then
    raise exception 'No more than five review tags may be selected';
  end if;
  if exists (
    select 1
    from unnest(normalized_tags) tag_value
    where tag_value <> all(array[
      '세심한 케어', '정확한 기록', '친절한 소통', '시간 준수', '전문적인 지원'
    ]::text[])
  ) then
    raise exception 'Unsupported review tag';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('caregiver-review:' || p_assignment_id::text, 0));

  select assignment.*
  into target_assignment
  from public.care_assignments assignment
  where assignment.id = p_assignment_id
  for update of assignment;

  if not found then
    raise exception 'Service assignment not found';
  end if;

  select contract.client_id
  into target_client_id
  from public.care_contracts contract
  where contract.id = target_assignment.contract_id;

  if target_client_id is null then
    raise exception 'Service contract not found';
  end if;
  if not public.is_client_member(target_client_id) then
    raise exception 'Only a member of the serviced family may submit this review';
  end if;
  if target_assignment.status not in ('COMPLETED', 'CANCELLED')
     and not (target_assignment.status = 'CONFIRMED' and target_assignment.ends_at <= now()) then
    raise exception 'A review can be submitted only after the service has ended';
  end if;
  if public.care_assignment_is_administratively_removed(target_assignment.id) then
    raise exception 'An administratively removed service cannot be reviewed';
  end if;
  if not public.care_assignment_has_delivered_history(target_assignment.id) then
    raise exception 'A review requires a recorded delivered-care history';
  end if;
  if exists (select 1 from public.caregiver_reviews review where review.assignment_id = target_assignment.id) then
    raise exception 'This service assignment already has a review';
  end if;

  insert into public.caregiver_reviews (
    assignment_id, client_id, caregiver_id, rating,
    meal_preparation_score, attentiveness_score, punctuality_score,
    professionalism_score, communication_score, hygiene_safety_score,
    tags, comment, created_by
  ) values (
    target_assignment.id, target_client_id, target_assignment.caregiver_id, derived_rating,
    (p_competency_scores ->> 'meal_preparation')::smallint,
    (p_competency_scores ->> 'attentiveness')::smallint,
    (p_competency_scores ->> 'punctuality')::smallint,
    (p_competency_scores ->> 'professionalism')::smallint,
    (p_competency_scores ->> 'communication')::smallint,
    (p_competency_scores ->> 'hygiene_safety')::smallint,
    normalized_tags, normalized_comment, auth.uid()
  ) returning id into saved_review_id;

  publication_status := case when coalesce(p_public_consent, false) then 'PENDING' else 'PRIVATE' end;

  insert into public.caregiver_review_publications(review_id, customer_public_consent, status)
  values (saved_review_id, coalesce(p_public_consent, false), publication_status);

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'CAREGIVER_REVIEW_SUBMITTED', 'caregiver_reviews', saved_review_id,
    jsonb_build_object(
      'assignment_id', target_assignment.id,
      'caregiver_id', target_assignment.caregiver_id,
      'rating', derived_rating,
      'rating_source', 'COMPETENCY_AVERAGE',
      'competency_scores', p_competency_scores,
      'tag_count', cardinality(normalized_tags),
      'public_consent', coalesce(p_public_consent, false)
    )
  );

  return jsonb_build_object(
    'review_id', saved_review_id,
    'publication_status', publication_status,
    'overall_rating', derived_rating
  );
end;
$$;

create or replace function public.admin_create_historical_caregiver_review(
  p_caregiver_id uuid,
  p_tags text[],
  p_comment text,
  p_service_type public.care_service_type,
  p_service_date date,
  p_reviewer_alias text,
  p_is_published boolean,
  p_competency_scores jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_review_id uuid;
  normalized_tags text[];
  normalized_comment text := trim(coalesce(p_comment, ''));
  normalized_alias text := coalesce(nullif(trim(p_reviewer_alias), ''), '이전 서비스 고객');
  derived_rating numeric(2,1);
begin
  if not public.is_admin() then
    raise exception 'Only administrators can add historical caregiver reviews';
  end if;
  if not exists (select 1 from public.caregivers where id = p_caregiver_id) then
    raise exception 'Caregiver not found';
  end if;
  if p_competency_scores is null or jsonb_typeof(p_competency_scores) <> 'object' then
    raise exception 'All six competency scores must be integers between 1 and 5';
  end if;
  if (select count(*) from jsonb_object_keys(p_competency_scores)) <> 6
     or not (p_competency_scores ?& array[
       'meal_preparation', 'attentiveness', 'punctuality',
       'professionalism', 'communication', 'hygiene_safety'
     ])
     or exists (
       select 1
       from jsonb_each_text(p_competency_scores) score
       where score.key <> all(array[
         'meal_preparation', 'attentiveness', 'punctuality',
         'professionalism', 'communication', 'hygiene_safety'
       ])
       or score.value !~ '^[1-5]$'
     ) then
    raise exception 'All six competency scores must be integers between 1 and 5';
  end if;

  derived_rating := round((
    (p_competency_scores ->> 'meal_preparation')::numeric
    + (p_competency_scores ->> 'attentiveness')::numeric
    + (p_competency_scores ->> 'punctuality')::numeric
    + (p_competency_scores ->> 'professionalism')::numeric
    + (p_competency_scores ->> 'communication')::numeric
    + (p_competency_scores ->> 'hygiene_safety')::numeric
  ) / 6, 1);

  if char_length(normalized_comment) not between 1 and 500 then
    raise exception 'Review comment must contain between 1 and 500 characters';
  end if;
  if char_length(normalized_alias) > 80 then
    raise exception 'Reviewer label may contain at most 80 characters';
  end if;
  if p_service_date is null or p_service_date > (now() at time zone 'America/New_York')::date then
    raise exception 'Historical review date must not be in the future';
  end if;

  select coalesce(array_agg(tag_value order by first_position), '{}'::text[])
  into normalized_tags
  from (
    select trim(tag_input) as tag_value, min(tag_position) as first_position
    from unnest(coalesce(p_tags, '{}'::text[])) with ordinality
      as submitted(tag_input, tag_position)
    where nullif(trim(tag_input), '') is not null
    group by trim(tag_input)
  ) unique_tags;

  if cardinality(normalized_tags) > 5 then
    raise exception 'No more than five review tags may be selected';
  end if;
  if exists (select 1 from unnest(normalized_tags) tag_value where char_length(tag_value) > 40) then
    raise exception 'Historical review tags may contain at most 40 characters each';
  end if;

  insert into public.caregiver_historical_reviews (
    caregiver_id, rating,
    meal_preparation_score, attentiveness_score, punctuality_score,
    professionalism_score, communication_score, hygiene_safety_score,
    tags, comment, service_type, service_date, reviewer_alias, is_published, created_by
  ) values (
    p_caregiver_id, derived_rating,
    (p_competency_scores ->> 'meal_preparation')::smallint,
    (p_competency_scores ->> 'attentiveness')::smallint,
    (p_competency_scores ->> 'punctuality')::smallint,
    (p_competency_scores ->> 'professionalism')::smallint,
    (p_competency_scores ->> 'communication')::smallint,
    (p_competency_scores ->> 'hygiene_safety')::smallint,
    normalized_tags, normalized_comment, p_service_type, p_service_date,
    normalized_alias, coalesce(p_is_published, false), auth.uid()
  ) returning id into saved_review_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'CAREGIVER_HISTORICAL_REVIEW_CREATED', 'caregiver_historical_reviews', saved_review_id,
    jsonb_build_object(
      'caregiver_id', p_caregiver_id,
      'rating', derived_rating,
      'rating_source', 'COMPETENCY_AVERAGE',
      'competency_scores', p_competency_scores,
      'service_type', p_service_type,
      'service_date', p_service_date,
      'published', coalesce(p_is_published, false),
      'tag_count', cardinality(normalized_tags)
    )
  );

  return jsonb_build_object(
    'review_id', saved_review_id,
    'published', coalesce(p_is_published, false),
    'overall_rating', derived_rating
  );
end;
$$;

create or replace function public.public_caregiver_directory()
returns table (
  caregiver_id uuid,
  display_name text,
  headline text,
  biography text,
  photo_path text,
  photo_url text,
  photo_alt text,
  career_years numeric,
  specialties text[],
  credentials text[],
  languages text[],
  service_area text,
  featured boolean,
  sort_order integer,
  average_rating numeric,
  review_count bigint,
  rating_distribution jsonb,
  reviews jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    caregiver.id as caregiver_id,
    coalesce(nullif(trim(public_profile.display_name), ''), profile.full_name, 'ProMoms 관리사') as display_name,
    coalesce(public_profile.headline, 'ProMoms 돌봄 전문가') as headline,
    coalesce(public_profile.biography, '가족의 돌봄 필요를 세심하게 살피는 ProMoms 관리사입니다.') as biography,
    public_profile.photo_path,
    case when public_profile.photo_path is null then null
      else '/storage/v1/object/public/caregiver-public-photos/' || public_profile.photo_path end as photo_url,
    coalesce(public_profile.photo_alt, coalesce(profile.full_name, 'ProMoms 관리사') || ' 프로필 사진') as photo_alt,
    coalesce(public_profile.career_years, hr.career_years, 0)::numeric as career_years,
    coalesce(public_profile.specialties, '{}'::text[]) as specialties,
    coalesce(public_profile.credentials, '{}'::text[]) as credentials,
    coalesce(public_profile.languages, '{}'::text[]) as languages,
    public_profile.service_area,
    coalesce(public_profile.featured, false) as featured,
    coalesce(public_profile.sort_order, 100) as sort_order,
    score_summary.average_rating,
    score_summary.review_count,
    score_summary.rating_distribution,
    coalesce(public_review_list.reviews, '[]'::jsonb) as reviews
  from public.caregivers caregiver
  join public.profiles profile on profile.id = caregiver.user_id
  join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
  left join public.caregiver_public_profiles public_profile on public_profile.caregiver_id = caregiver.id
  left join lateral (
    select
      round(avg(score.rating)::numeric, 2) as average_rating,
      count(*)::bigint as review_count,
      jsonb_build_object(
        '1', count(*) filter (where round(score.rating)::integer = 1),
        '2', count(*) filter (where round(score.rating)::integer = 2),
        '3', count(*) filter (where round(score.rating)::integer = 3),
        '4', count(*) filter (where round(score.rating)::integer = 4),
        '5', count(*) filter (where round(score.rating)::integer = 5),
        'competency_review_count', count(*) filter (where score.meal_preparation_score is not null),
        'competencies', jsonb_build_object(
          'meal_preparation', round(avg(score.meal_preparation_score)::numeric, 2),
          'attentiveness', round(avg(score.attentiveness_score)::numeric, 2),
          'punctuality', round(avg(score.punctuality_score)::numeric, 2),
          'professionalism', round(avg(score.professionalism_score)::numeric, 2),
          'communication', round(avg(score.communication_score)::numeric, 2),
          'hygiene_safety', round(avg(score.hygiene_safety_score)::numeric, 2)
        )
      ) as rating_distribution
    from (
      select
        review.rating::numeric as rating,
        review.meal_preparation_score, review.attentiveness_score, review.punctuality_score,
        review.professionalism_score, review.communication_score, review.hygiene_safety_score
      from public.caregiver_reviews review
      join public.caregiver_review_publications publication on publication.review_id = review.id
      where review.caregiver_id = caregiver.id
        and publication.validity_status = 'VALID'
        and not public.care_assignment_is_administratively_removed(review.assignment_id)
        and public.care_assignment_has_delivered_history(review.assignment_id)
      union all
      select
        historical.rating::numeric,
        historical.meal_preparation_score, historical.attentiveness_score, historical.punctuality_score,
        historical.professionalism_score, historical.communication_score, historical.hygiene_safety_score
      from public.caregiver_historical_reviews historical
      where historical.caregiver_id = caregiver.id
        and historical.verification_status = 'VERIFIED'
        and historical.archived_at is null
    ) score
  ) score_summary on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', visible_review.id,
        'source', visible_review.source,
        'rating', visible_review.rating,
        'competency_scores', visible_review.competency_scores,
        'tags', visible_review.tags,
        'comment', visible_review.comment,
        'service_type', visible_review.service_type,
        'service_date', visible_review.service_date,
        'reviewer_label', visible_review.reviewer_label,
        'photo_paths', visible_review.photo_paths,
        'created_at', visible_review.created_at
      ) order by visible_review.service_date desc nulls last, visible_review.created_at desc
    ) as reviews
    from (
      select combined.*
      from (
        select
          review.id,
          'VERIFIED_CUSTOMER'::text as source,
          review.rating::numeric as rating,
          case when review.meal_preparation_score is null then null else jsonb_build_object(
            'meal_preparation', review.meal_preparation_score,
            'attentiveness', review.attentiveness_score,
            'punctuality', review.punctuality_score,
            'professionalism', review.professionalism_score,
            'communication', review.communication_score,
            'hygiene_safety', review.hygiene_safety_score
          ) end as competency_scores,
          review.tags,
          review.comment,
          assignment.service_type::text as service_type,
          (assignment.ends_at at time zone 'America/New_York')::date as service_date,
          '서비스 이용 고객'::text as reviewer_label,
          review.photo_paths,
          review.created_at
        from public.caregiver_reviews review
        join public.caregiver_review_publications publication on publication.review_id = review.id
        join public.care_assignments assignment on assignment.id = review.assignment_id
        where review.caregiver_id = caregiver.id
          and publication.customer_public_consent
          and publication.status = 'PUBLISHED'
          and publication.validity_status = 'VALID'
          and not public.care_assignment_is_administratively_removed(review.assignment_id)
          and public.care_assignment_has_delivered_history(review.assignment_id)
        union all
        select
          historical.id,
          'VERIFIED_EXTERNAL'::text as source,
          historical.rating::numeric,
          case when historical.meal_preparation_score is null then null else jsonb_build_object(
            'meal_preparation', historical.meal_preparation_score,
            'attentiveness', historical.attentiveness_score,
            'punctuality', historical.punctuality_score,
            'professionalism', historical.professionalism_score,
            'communication', historical.communication_score,
            'hygiene_safety', historical.hygiene_safety_score
          ) end,
          historical.tags,
          historical.comment,
          historical.service_type::text,
          historical.service_date,
          historical.reviewer_alias,
          historical.photo_paths,
          historical.created_at
        from public.caregiver_historical_reviews historical
        where historical.caregiver_id = caregiver.id
          and historical.is_published
          and historical.verification_status = 'VERIFIED'
          and historical.archived_at is null
      ) combined
      order by combined.service_date desc nulls last, combined.created_at desc
      limit 12
    ) visible_review
  ) public_review_list on true
  where coalesce(public_profile.is_published, true)
    and caregiver.status = 'ACTIVE'
    and profile.account_status = 'ACTIVE'
    and profile.deleted_at is null
    and hr.employment_status = 'ACTIVE'
    and public.has_role_for_user(caregiver.user_id, 'CAREGIVER')
  order by coalesce(public_profile.featured, false) desc,
           coalesce(public_profile.sort_order, 100),
           score_summary.average_rating desc nulls last,
           coalesce(nullif(trim(public_profile.display_name), ''), profile.full_name, 'ProMoms 관리사');
$$;

revoke all on function public.submit_caregiver_review(uuid, text[], text, boolean, jsonb) from public, anon;
grant execute on function public.submit_caregiver_review(uuid, text[], text, boolean, jsonb) to authenticated;

revoke all on function public.admin_create_historical_caregiver_review(
  uuid, text[], text, public.care_service_type, date, text, boolean, jsonb
) from public, anon;
grant execute on function public.admin_create_historical_caregiver_review(
  uuid, text[], text, public.care_service_type, date, text, boolean, jsonb
) to authenticated;

revoke all on function public.public_caregiver_directory() from public;
grant execute on function public.public_caregiver_directory() to anon, authenticated;

comment on column public.caregiver_reviews.rating is
  'One-decimal overall rating derived by the database from the six required competency scores for new reviews.';
comment on column public.caregiver_historical_reviews.rating is
  'One-decimal overall rating derived by the database from the six required competency scores for new external reviews.';
comment on function public.public_caregiver_directory() is
  'Sanitized caregiver directory whose overall rating uses the six-score arithmetic mean for new reviews while preserving legacy ratings.';

select pg_notify('pgrst', 'reload schema');

commit;
