-- Verified external reviews and optional public review photos.
--
-- Customer reviews remain tied to delivered ProMoms assignments. Administrators may
-- also preserve legitimate off-platform reviews, but an external rating contributes
-- to the public aggregate only after evidence images and an attestation are recorded.

begin;

alter table public.caregiver_reviews
  add column if not exists photo_paths text[] not null default '{}'::text[];

alter table public.caregiver_reviews
  drop constraint if exists caregiver_reviews_photo_paths_check;
alter table public.caregiver_reviews
  add constraint caregiver_reviews_photo_paths_check
  check (cardinality(photo_paths) between 0 and 3);

alter table public.caregiver_historical_reviews
  add column if not exists photo_paths text[] not null default '{}'::text[],
  add column if not exists verification_status text not null default 'UNVERIFIED',
  add column if not exists verification_note text,
  add column if not exists verified_by uuid references public.profiles(id),
  add column if not exists verified_at timestamptz;

alter table public.caregiver_historical_reviews
  drop constraint if exists caregiver_historical_reviews_photo_paths_check;
alter table public.caregiver_historical_reviews
  add constraint caregiver_historical_reviews_photo_paths_check
  check (cardinality(photo_paths) between 0 and 3);

alter table public.caregiver_historical_reviews
  drop constraint if exists caregiver_historical_reviews_verification_check;
alter table public.caregiver_historical_reviews
  add constraint caregiver_historical_reviews_verification_check
  check (
    (
      verification_status = 'UNVERIFIED'
      and verification_note is null
      and verified_by is null
      and verified_at is null
    )
    or (
      verification_status = 'VERIFIED'
      and cardinality(photo_paths) between 1 and 3
      and verification_note is not null
      and char_length(trim(verification_note)) between 10 and 500
      and verified_by is not null
      and verified_at is not null
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'caregiver-review-photos',
  'caregiver-review-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "caregiver review photos: public read" on storage.objects;
create policy "caregiver review photos: public read"
on storage.objects for select to public
using (bucket_id = 'caregiver-review-photos');

drop policy if exists "caregiver review photos: authorized insert" on storage.objects;
create policy "caregiver review photos: authorized insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'caregiver-review-photos'
  and (
    (
      split_part(name, '/', 1) = 'customer'
      and exists (
        select 1
        from public.caregiver_reviews review
        join public.caregiver_review_publications publication
          on publication.review_id = review.id
        where review.id::text = split_part(name, '/', 2)
          and review.created_by = auth.uid()
          and publication.customer_public_consent
      )
    )
    or (
      split_part(name, '/', 1) = 'external'
      and public.is_admin()
      and exists (
        select 1
        from public.caregiver_historical_reviews historical
        where historical.caregiver_id::text = split_part(name, '/', 2)
          and historical.id::text = split_part(name, '/', 3)
      )
    )
  )
);

drop policy if exists "caregiver review photos: cleanup" on storage.objects;
create policy "caregiver review photos: cleanup"
on storage.objects for delete to authenticated
using (
  bucket_id = 'caregiver-review-photos'
  and (
    public.is_admin()
    or (
      split_part(name, '/', 1) = 'customer'
      and not exists (
        select 1
        from public.caregiver_reviews review
        where name = any(review.photo_paths)
      )
    )
  )
);

create or replace function public.attach_caregiver_review_photos(
  p_review_id uuid,
  p_photo_paths text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_review public.caregiver_reviews%rowtype;
  target_publication public.caregiver_review_publications%rowtype;
  normalized_paths text[];
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'An active customer account is required';
  end if;

  select review.*
  into target_review
  from public.caregiver_reviews review
  where review.id = p_review_id
  for update;

  if not found then
    raise exception 'Caregiver review not found';
  end if;
  if target_review.created_by <> auth.uid() then
    raise exception 'Only the review author may attach photos';
  end if;

  select publication.*
  into target_publication
  from public.caregiver_review_publications publication
  where publication.review_id = p_review_id;

  if not target_publication.customer_public_consent then
    raise exception 'Public review consent is required for public review photos';
  end if;

  select coalesce(array_agg(path_value order by first_position), '{}'::text[])
  into normalized_paths
  from (
    select trim(path_input) as path_value, min(path_position) as first_position
    from unnest(coalesce(p_photo_paths, '{}'::text[])) with ordinality
      as submitted(path_input, path_position)
    where nullif(trim(path_input), '') is not null
    group by trim(path_input)
  ) unique_paths;

  if cardinality(normalized_paths) < 1 then
    raise exception 'At least one review photo is required';
  end if;
  if cardinality(target_review.photo_paths) + cardinality(normalized_paths) > 3 then
    raise exception 'No more than three review photos may be attached';
  end if;
  if exists (
    select 1
    from unnest(normalized_paths) path_value
    where path_value !~ ('^customer/' || p_review_id::text || '/[0-9a-f-]+[.](jpg|png|webp)$')
      or path_value = any(target_review.photo_paths)
      or not exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'caregiver-review-photos'
          and object.name = path_value
      )
  ) then
    raise exception 'One or more review photos are invalid';
  end if;

  update public.caregiver_reviews
  set photo_paths = photo_paths || normalized_paths
  where id = p_review_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_REVIEW_PHOTOS_ATTACHED',
    'caregiver_reviews',
    p_review_id,
    jsonb_build_object('photo_count', cardinality(normalized_paths))
  );

  return jsonb_build_object(
    'review_id', p_review_id,
    'photo_count', cardinality(target_review.photo_paths) + cardinality(normalized_paths)
  );
end;
$$;

create or replace function public.admin_verify_historical_caregiver_review(
  p_review_id uuid,
  p_photo_paths text[],
  p_verification_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_review public.caregiver_historical_reviews%rowtype;
  normalized_paths text[];
  normalized_note text := nullif(trim(p_verification_note), '');
begin
  if not public.is_admin() then
    raise exception 'Only administrators can verify external caregiver reviews';
  end if;

  select review.*
  into target_review
  from public.caregiver_historical_reviews review
  where review.id = p_review_id
  for update;

  if not found then
    raise exception 'Historical caregiver review not found';
  end if;
  if target_review.archived_at is not null then
    raise exception 'An archived review cannot be verified';
  end if;
  if normalized_note is null or char_length(normalized_note) not between 10 and 500 then
    raise exception 'A verification note between 10 and 500 characters is required';
  end if;

  select coalesce(array_agg(path_value order by first_position), '{}'::text[])
  into normalized_paths
  from (
    select trim(path_input) as path_value, min(path_position) as first_position
    from unnest(coalesce(p_photo_paths, '{}'::text[])) with ordinality
      as submitted(path_input, path_position)
    where nullif(trim(path_input), '') is not null
    group by trim(path_input)
  ) unique_paths;

  if cardinality(normalized_paths) < 1 then
    raise exception 'At least one external review evidence photo is required';
  end if;
  if cardinality(target_review.photo_paths) + cardinality(normalized_paths) > 3 then
    raise exception 'No more than three review photos may be attached';
  end if;
  if exists (
    select 1
    from unnest(normalized_paths) path_value
    where path_value !~ ('^external/' || target_review.caregiver_id::text || '/' || p_review_id::text || '/[0-9a-f-]+[.](jpg|png|webp)$')
      or path_value = any(target_review.photo_paths)
      or not exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'caregiver-review-photos'
          and object.name = path_value
      )
  ) then
    raise exception 'One or more external review evidence photos are invalid';
  end if;

  update public.caregiver_historical_reviews
  set photo_paths = photo_paths || normalized_paths,
      verification_status = 'VERIFIED',
      verification_note = normalized_note,
      verified_by = auth.uid(),
      verified_at = now(),
      updated_at = now()
  where id = p_review_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_EXTERNAL_REVIEW_VERIFIED',
    'caregiver_historical_reviews',
    p_review_id,
    jsonb_build_object(
      'caregiver_id', target_review.caregiver_id,
      'rating', target_review.rating,
      'photo_count', cardinality(normalized_paths),
      'verification_note', normalized_note
    )
  );

  return jsonb_build_object(
    'review_id', p_review_id,
    'verification_status', 'VERIFIED',
    'photo_count', cardinality(target_review.photo_paths) + cardinality(normalized_paths)
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
    case
      when public_profile.photo_path is null then null
      else '/storage/v1/object/public/caregiver-public-photos/' || public_profile.photo_path
    end as photo_url,
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
  left join public.caregiver_public_profiles public_profile
    on public_profile.caregiver_id = caregiver.id
  left join lateral (
    select
      round(avg(score.rating)::numeric, 2) as average_rating,
      count(*)::bigint as review_count,
      jsonb_build_object(
        '1', count(*) filter (where score.rating = 1),
        '2', count(*) filter (where score.rating = 2),
        '3', count(*) filter (where score.rating = 3),
        '4', count(*) filter (where score.rating = 4),
        '5', count(*) filter (where score.rating = 5)
      ) as rating_distribution
    from (
      select review.rating::integer as rating
      from public.caregiver_reviews review
      join public.caregiver_review_publications publication
        on publication.review_id = review.id
      where review.caregiver_id = caregiver.id
        and publication.validity_status = 'VALID'
        and not public.care_assignment_is_administratively_removed(review.assignment_id)
        and public.care_assignment_has_delivered_history(review.assignment_id)

      union all

      select historical.rating::integer
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
        'tags', visible_review.tags,
        'comment', visible_review.comment,
        'service_type', visible_review.service_type,
        'service_date', visible_review.service_date,
        'reviewer_label', visible_review.reviewer_label,
        'photo_paths', visible_review.photo_paths,
        'created_at', visible_review.created_at
      )
      order by visible_review.service_date desc nulls last, visible_review.created_at desc
    ) as reviews
    from (
      select combined.*
      from (
        select
          review.id,
          'VERIFIED_CUSTOMER'::text as source,
          review.rating::integer as rating,
          review.tags,
          review.comment,
          assignment.service_type::text as service_type,
          (assignment.ends_at at time zone 'America/New_York')::date as service_date,
          '서비스 이용 고객'::text as reviewer_label,
          review.photo_paths,
          review.created_at
        from public.caregiver_reviews review
        join public.caregiver_review_publications publication
          on publication.review_id = review.id
        join public.care_assignments assignment
          on assignment.id = review.assignment_id
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
          historical.rating::integer,
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

revoke all on function public.attach_caregiver_review_photos(uuid, text[]) from public, anon;
grant execute on function public.attach_caregiver_review_photos(uuid, text[]) to authenticated;

revoke all on function public.admin_verify_historical_caregiver_review(uuid, text[], text) from public, anon;
grant execute on function public.admin_verify_historical_caregiver_review(uuid, text[], text) to authenticated;

revoke all on function public.public_caregiver_directory() from public;
grant execute on function public.public_caregiver_directory() to anon, authenticated;

comment on column public.caregiver_reviews.photo_paths is
  'Optional public review photos attached by the verified customer after explicit homepage publication consent.';
comment on column public.caregiver_historical_reviews.verification_status is
  'VERIFIED only after an administrator records evidence photos and an attestation for a legitimate off-platform review.';
comment on function public.admin_verify_historical_caregiver_review(uuid, text[], text) is
  'Attaches evidence and makes an off-platform review eligible for the transparent combined public rating.';
comment on function public.public_caregiver_directory() is
  'Sanitized active-caregiver directory whose aggregate combines valid delivered-service ratings with evidence-verified off-platform ratings; displayed review copy keeps a transparent source label.';

select pg_notify('pgrst', 'reload schema');

commit;
