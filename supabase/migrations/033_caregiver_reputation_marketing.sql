-- Public caregiver reputation and marketing directory.
--
-- Public biography data is intentionally separated from private HR records.
-- Customer review text is published only with the customer's explicit consent
-- and a subsequent administrator moderation decision. Star aggregates contain
-- no customer identifiers and include every valid delivered-service score.

begin;

create table public.caregiver_public_profiles (
  caregiver_id uuid primary key references public.caregivers(id) on delete cascade,
  display_name text not null
    check (char_length(trim(display_name)) between 2 and 80),
  headline text
    check (headline is null or char_length(trim(headline)) between 1 and 120),
  biography text
    check (biography is null or char_length(trim(biography)) between 1 and 1500),
  photo_path text
    check (
      photo_path is null
      or (
        char_length(photo_path) between 38 and 500
        and position('..' in photo_path) = 0
      )
    ),
  photo_alt text
    check (photo_alt is null or char_length(trim(photo_alt)) between 1 and 160),
  career_years numeric(4,1) not null default 0
    check (career_years between 0 and 60),
  specialties text[] not null default '{}'
    check (cardinality(specialties) <= 12),
  credentials text[] not null default '{}'
    check (cardinality(credentials) <= 12),
  languages text[] not null default '{}'
    check (cardinality(languages) <= 8),
  service_area text
    check (service_area is null or char_length(trim(service_area)) between 1 and 240),
  featured boolean not null default false,
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  is_published boolean not null default false,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.caregiver_historical_reviews (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references public.caregivers(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  tags text[] not null default '{}' check (cardinality(tags) <= 5),
  comment text not null check (char_length(trim(comment)) between 1 and 500),
  service_type public.care_service_type,
  service_date date not null,
  reviewer_alias text not null default '이전 서비스 고객'
    check (char_length(trim(reviewer_alias)) between 1 and 80),
  is_published boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  archived_reason text
    check (archived_reason is null or char_length(trim(archived_reason)) between 2 and 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (archived_at is null and archived_by is null and archived_reason is null)
    or (archived_at is not null and archived_by is not null)
  ),
  check (archived_at is null or not is_published)
);

create table public.caregiver_review_publications (
  review_id uuid primary key references public.caregiver_reviews(id) on delete cascade,
  customer_public_consent boolean not null default false,
  status text not null default 'PRIVATE'
    check (status in ('PRIVATE', 'PENDING', 'PUBLISHED', 'HIDDEN')),
  moderated_by uuid references public.profiles(id),
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'PUBLISHED' or customer_public_consent),
  check (
    (moderated_at is null and moderated_by is null)
    or (moderated_at is not null and moderated_by is not null)
  )
);

create index caregiver_public_profiles_directory_idx
  on public.caregiver_public_profiles(is_published, featured desc, sort_order, caregiver_id);
create index caregiver_historical_reviews_caregiver_date_idx
  on public.caregiver_historical_reviews(caregiver_id, service_date desc, created_at desc)
  where archived_at is null;
create index caregiver_historical_reviews_public_idx
  on public.caregiver_historical_reviews(caregiver_id, created_at desc)
  where is_published and archived_at is null;
create index caregiver_review_publications_status_idx
  on public.caregiver_review_publications(status, review_id);

alter table public.caregiver_public_profiles enable row level security;
alter table public.caregiver_historical_reviews enable row level security;
alter table public.caregiver_review_publications enable row level security;

create policy "caregiver public profiles: admin or self read"
on public.caregiver_public_profiles for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.caregivers caregiver
    where caregiver.id = caregiver_public_profiles.caregiver_id
      and caregiver.user_id = auth.uid()
      and caregiver.status = 'ACTIVE'
      and public.account_is_active()
      and public.has_role_for_user(auth.uid(), 'CAREGIVER')
  )
);

create policy "historical caregiver reviews: admin or caregiver read"
on public.caregiver_historical_reviews for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.caregivers caregiver
    where caregiver.id = caregiver_historical_reviews.caregiver_id
      and caregiver.user_id = auth.uid()
      and public.account_is_active()
  )
);

create policy "caregiver review publications: related parties read"
on public.caregiver_review_publications for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.caregiver_reviews review
    where review.id = caregiver_review_publications.review_id
      and (
        review.created_by = auth.uid()
        or public.is_client_member(review.client_id)
        or exists (
          select 1
          from public.caregivers caregiver
          where caregiver.id = review.caregiver_id
            and caregiver.user_id = auth.uid()
            and public.account_is_active()
        )
      )
  )
);

revoke all on table public.caregiver_public_profiles from public, anon, authenticated;
revoke all on table public.caregiver_historical_reviews from public, anon, authenticated;
revoke all on table public.caregiver_review_publications from public, anon, authenticated;
grant select on table public.caregiver_public_profiles to authenticated;
grant select on table public.caregiver_historical_reviews to authenticated;
grant select on table public.caregiver_review_publications to authenticated;

-- Previously submitted reviews did not include a public-display consent. They
-- remain private by default, while their non-identifying scores can still form
-- part of the caregiver's average rating.
insert into public.caregiver_review_publications (
  review_id,
  customer_public_consent,
  status
)
select review.id, false, 'PRIVATE'
from public.caregiver_reviews review
on conflict (review_id) do nothing;

-- Public profiles are intentionally not backfilled from private HR prose.
-- An administrator creates each draft through the audited RPC and explicitly
-- opts in to publication after reviewing the marketing copy.

-- A customer review now has one server-owned write path. The RPC derives the
-- client and caregiver from the assignment, requires objective delivery
-- evidence, and serializes the one-review-per-assignment rule.
create or replace function public.submit_caregiver_review(
  p_assignment_id uuid,
  p_rating integer,
  p_tags text[],
  p_comment text,
  p_public_consent boolean default false
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
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'An active customer account is required';
  end if;
  if p_assignment_id is null then
    raise exception 'A service assignment is required';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
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
      '세심한 케어',
      '정확한 기록',
      '친절한 소통',
      '시간 준수',
      '전문적인 지원'
    ]::text[])
  ) then
    raise exception 'Unsupported review tag';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('caregiver-review:' || p_assignment_id::text, 0)
  );

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
     and not (
       target_assignment.status = 'CONFIRMED'
       and target_assignment.ends_at <= now()
     ) then
    raise exception 'A review can be submitted only after the service has ended';
  end if;
  if public.care_assignment_is_administratively_removed(target_assignment.id) then
    raise exception 'An administratively removed service cannot be reviewed';
  end if;
  if not public.care_assignment_has_delivered_history(target_assignment.id) then
    raise exception 'A review requires a recorded delivered-care history';
  end if;
  if exists (
    select 1
    from public.caregiver_reviews review
    where review.assignment_id = target_assignment.id
  ) then
    raise exception 'This service assignment already has a review';
  end if;

  insert into public.caregiver_reviews (
    assignment_id,
    client_id,
    caregiver_id,
    rating,
    tags,
    comment,
    created_by
  ) values (
    target_assignment.id,
    target_client_id,
    target_assignment.caregiver_id,
    p_rating,
    normalized_tags,
    normalized_comment,
    auth.uid()
  )
  returning id into saved_review_id;

  publication_status := case
    when coalesce(p_public_consent, false) then 'PENDING'
    else 'PRIVATE'
  end;

  insert into public.caregiver_review_publications (
    review_id,
    customer_public_consent,
    status
  ) values (
    saved_review_id,
    coalesce(p_public_consent, false),
    publication_status
  );

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_REVIEW_SUBMITTED',
    'caregiver_reviews',
    saved_review_id,
    jsonb_build_object(
      'assignment_id', target_assignment.id,
      'caregiver_id', target_assignment.caregiver_id,
      'rating', p_rating,
      'tag_count', cardinality(normalized_tags),
      'public_consent', coalesce(p_public_consent, false)
    )
  );

  return jsonb_build_object(
    'review_id', saved_review_id,
    'publication_status', publication_status
  );
end;
$$;

-- Customers keep control of future homepage use of their review text. The
-- immutable service rating and original review remain available to the family,
-- caregiver and administrators, but the public copy is withdrawn immediately.
create or replace function public.withdraw_caregiver_review_public_consent(
  p_review_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_review public.caregiver_reviews%rowtype;
  target_publication public.caregiver_review_publications%rowtype;
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'An active customer account is required';
  end if;

  select review.*
  into target_review
  from public.caregiver_reviews review
  where review.id = p_review_id;

  if not found then
    raise exception 'Caregiver review not found';
  end if;
  if target_review.created_by <> auth.uid()
     and not public.is_client_member(target_review.client_id) then
    raise exception 'Only the serviced family may withdraw public consent';
  end if;

  select publication.*
  into target_publication
  from public.caregiver_review_publications publication
  where publication.review_id = p_review_id
  for update;

  if not found then
    raise exception 'Caregiver review publication record not found';
  end if;

  update public.caregiver_review_publications
  set customer_public_consent = false,
      status = 'PRIVATE',
      moderated_by = null,
      moderated_at = null,
      updated_at = now()
  where review_id = p_review_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_REVIEW_PUBLIC_CONSENT_WITHDRAWN',
    'caregiver_reviews',
    p_review_id,
    jsonb_build_object('previous_status', target_publication.status)
  );

  return jsonb_build_object('review_id', p_review_id, 'status', 'PRIVATE');
end;
$$;

-- Public marketing profiles are independent of private HR records. Administrators
-- may prepare a profile while employment is inactive, but only an active,
-- non-archived caregiver may be marked published.
create or replace function public.admin_upsert_caregiver_public_profile(
  p_caregiver_id uuid,
  p_display_name text,
  p_headline text,
  p_biography text,
  p_photo_path text,
  p_photo_alt text,
  p_career_years numeric,
  p_specialties text[],
  p_credentials text[],
  p_languages text[],
  p_service_area text,
  p_featured boolean,
  p_sort_order integer,
  p_is_published boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  target_is_eligible boolean;
  normalized_display_name text := trim(coalesce(p_display_name, ''));
  normalized_headline text := nullif(trim(p_headline), '');
  normalized_biography text := nullif(trim(p_biography), '');
  normalized_photo_path text := nullif(trim(p_photo_path), '');
  normalized_photo_alt text := nullif(trim(p_photo_alt), '');
  normalized_service_area text := nullif(trim(p_service_area), '');
  normalized_specialties text[];
  normalized_credentials text[];
  normalized_languages text[];
begin
  if not public.is_admin() then
    raise exception 'Only administrators can manage caregiver public profiles';
  end if;
  if p_caregiver_id is null then
    raise exception 'A caregiver is required';
  end if;
  if char_length(normalized_display_name) not between 2 and 80 then
    raise exception 'Public display name must contain between 2 and 80 characters';
  end if;
  if normalized_headline is not null and char_length(normalized_headline) > 120 then
    raise exception 'Public headline may contain at most 120 characters';
  end if;
  if normalized_biography is not null and char_length(normalized_biography) > 1500 then
    raise exception 'Public biography may contain at most 1500 characters';
  end if;
  if normalized_photo_alt is not null and char_length(normalized_photo_alt) > 160 then
    raise exception 'Photo description may contain at most 160 characters';
  end if;
  if normalized_service_area is not null and char_length(normalized_service_area) > 240 then
    raise exception 'Public service area may contain at most 240 characters';
  end if;
  if p_career_years is null or p_career_years not between 0 and 60 then
    raise exception 'Career years must be between 0 and 60';
  end if;
  if p_sort_order is null or p_sort_order not between 0 and 10000 then
    raise exception 'Sort order must be between 0 and 10000';
  end if;
  if normalized_photo_path is not null and (
    char_length(normalized_photo_path) > 500
    or position('..' in normalized_photo_path) > 0
    or split_part(normalized_photo_path, '/', 1) <> p_caregiver_id::text
  ) then
    raise exception 'The public photo must be stored under the caregiver profile path';
  end if;

  select coalesce(array_agg(item_value order by first_position), '{}'::text[])
  into normalized_specialties
  from (
    select trim(item_input) as item_value, min(item_position) as first_position
    from unnest(coalesce(p_specialties, '{}'::text[])) with ordinality
      as submitted(item_input, item_position)
    where nullif(trim(item_input), '') is not null
    group by trim(item_input)
  ) unique_items;

  select coalesce(array_agg(item_value order by first_position), '{}'::text[])
  into normalized_credentials
  from (
    select trim(item_input) as item_value, min(item_position) as first_position
    from unnest(coalesce(p_credentials, '{}'::text[])) with ordinality
      as submitted(item_input, item_position)
    where nullif(trim(item_input), '') is not null
    group by trim(item_input)
  ) unique_items;

  select coalesce(array_agg(item_value order by first_position), '{}'::text[])
  into normalized_languages
  from (
    select trim(item_input) as item_value, min(item_position) as first_position
    from unnest(coalesce(p_languages, '{}'::text[])) with ordinality
      as submitted(item_input, item_position)
    where nullif(trim(item_input), '') is not null
    group by trim(item_input)
  ) unique_items;

  if cardinality(normalized_specialties) > 12
     or exists (select 1 from unnest(normalized_specialties) value where char_length(value) > 60) then
    raise exception 'Up to 12 specialties of 60 characters each may be saved';
  end if;
  if cardinality(normalized_credentials) > 12
     or exists (select 1 from unnest(normalized_credentials) value where char_length(value) > 120) then
    raise exception 'Up to 12 credentials of 120 characters each may be saved';
  end if;
  if cardinality(normalized_languages) > 8
     or exists (select 1 from unnest(normalized_languages) value where char_length(value) > 40) then
    raise exception 'Up to 8 languages of 40 characters each may be saved';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('caregiver-public-profile:' || p_caregiver_id::text, 0)
  );

  select
    caregiver.user_id,
    caregiver.status = 'ACTIVE'
      and profile.account_status = 'ACTIVE'
      and profile.deleted_at is null
      and public.has_role_for_user(caregiver.user_id, 'CAREGIVER')
      and exists (
        select 1
        from public.caregiver_hr_profiles hr
        where hr.caregiver_id = caregiver.id
          and hr.employment_status = 'ACTIVE'
      )
  into target_user_id, target_is_eligible
  from public.caregivers caregiver
  join public.profiles profile on profile.id = caregiver.user_id
  where caregiver.id = p_caregiver_id
  for update of caregiver;

  if target_user_id is null then
    raise exception 'Caregiver not found';
  end if;
  if coalesce(p_is_published, false) and not target_is_eligible then
    raise exception 'Only an active caregiver with active employment may be published';
  end if;

  insert into public.caregiver_public_profiles (
    caregiver_id,
    display_name,
    headline,
    biography,
    photo_path,
    photo_alt,
    career_years,
    specialties,
    credentials,
    languages,
    service_area,
    featured,
    sort_order,
    is_published,
    created_by,
    updated_by
  ) values (
    p_caregiver_id,
    normalized_display_name,
    normalized_headline,
    normalized_biography,
    normalized_photo_path,
    normalized_photo_alt,
    p_career_years,
    normalized_specialties,
    normalized_credentials,
    normalized_languages,
    normalized_service_area,
    coalesce(p_featured, false),
    p_sort_order,
    coalesce(p_is_published, false),
    auth.uid(),
    auth.uid()
  )
  on conflict (caregiver_id) do update set
    display_name = excluded.display_name,
    headline = excluded.headline,
    biography = excluded.biography,
    photo_path = excluded.photo_path,
    photo_alt = excluded.photo_alt,
    career_years = excluded.career_years,
    specialties = excluded.specialties,
    credentials = excluded.credentials,
    languages = excluded.languages,
    service_area = excluded.service_area,
    featured = excluded.featured,
    sort_order = excluded.sort_order,
    is_published = excluded.is_published,
    updated_by = auth.uid(),
    updated_at = now();

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_PUBLIC_PROFILE_UPDATED',
    'caregiver_public_profiles',
    p_caregiver_id,
    jsonb_build_object(
      'profile_user_id', target_user_id,
      'published', coalesce(p_is_published, false),
      'featured', coalesce(p_featured, false),
      'sort_order', p_sort_order,
      'photo_configured', normalized_photo_path is not null
    )
  );

  return jsonb_build_object(
    'caregiver_id', p_caregiver_id,
    'published', coalesce(p_is_published, false)
  );
end;
$$;

create or replace function public.admin_create_historical_caregiver_review(
  p_caregiver_id uuid,
  p_rating integer,
  p_tags text[],
  p_comment text,
  p_service_type public.care_service_type,
  p_service_date date,
  p_reviewer_alias text,
  p_is_published boolean
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
begin
  if not public.is_admin() then
    raise exception 'Only administrators can add historical caregiver reviews';
  end if;
  if not exists (select 1 from public.caregivers where id = p_caregiver_id) then
    raise exception 'Caregiver not found';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
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
  if exists (
    select 1
    from unnest(normalized_tags) tag_value
    where char_length(tag_value) > 40
  ) then
    raise exception 'Historical review tags may contain at most 40 characters each';
  end if;

  insert into public.caregiver_historical_reviews (
    caregiver_id,
    rating,
    tags,
    comment,
    service_type,
    service_date,
    reviewer_alias,
    is_published,
    created_by
  ) values (
    p_caregiver_id,
    p_rating,
    normalized_tags,
    normalized_comment,
    p_service_type,
    p_service_date,
    normalized_alias,
    coalesce(p_is_published, false),
    auth.uid()
  )
  returning id into saved_review_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_HISTORICAL_REVIEW_CREATED',
    'caregiver_historical_reviews',
    saved_review_id,
    jsonb_build_object(
      'caregiver_id', p_caregiver_id,
      'rating', p_rating,
      'service_type', p_service_type,
      'service_date', p_service_date,
      'published', coalesce(p_is_published, false),
      'tag_count', cardinality(normalized_tags)
    )
  );

  return jsonb_build_object(
    'review_id', saved_review_id,
    'published', coalesce(p_is_published, false)
  );
end;
$$;

create or replace function public.admin_set_caregiver_review_publication(
  p_review_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := upper(trim(coalesce(p_status, '')));
  target_publication public.caregiver_review_publications%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can moderate caregiver reviews';
  end if;
  if normalized_status not in ('PRIVATE', 'PENDING', 'PUBLISHED', 'HIDDEN') then
    raise exception 'Unsupported caregiver review publication status';
  end if;

  select publication.*
  into target_publication
  from public.caregiver_review_publications publication
  where publication.review_id = p_review_id
  for update;

  if not found then
    raise exception 'Caregiver review publication record not found';
  end if;
  if normalized_status = 'PUBLISHED' and not target_publication.customer_public_consent then
    raise exception 'Review text cannot be published without customer consent';
  end if;

  update public.caregiver_review_publications
  set status = normalized_status,
      moderated_by = auth.uid(),
      moderated_at = now(),
      updated_at = now()
  where review_id = p_review_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_REVIEW_PUBLICATION_UPDATED',
    'caregiver_reviews',
    p_review_id,
    jsonb_build_object(
      'old_status', target_publication.status,
      'new_status', normalized_status,
      'customer_public_consent', target_publication.customer_public_consent
    )
  );

  return jsonb_build_object('review_id', p_review_id, 'status', normalized_status);
end;
$$;

create or replace function public.admin_set_historical_review_publication(
  p_review_id uuid,
  p_is_published boolean,
  p_archived boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_review public.caregiver_historical_reviews%rowtype;
  normalized_reason text := nullif(trim(p_reason), '');
  effective_published boolean := coalesce(p_is_published, false)
    and not coalesce(p_archived, false);
begin
  if not public.is_admin() then
    raise exception 'Only administrators can manage historical caregiver reviews';
  end if;
  if coalesce(p_archived, false)
     and (normalized_reason is null or char_length(normalized_reason) < 2) then
    raise exception 'An archive reason is required';
  end if;
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'Archive reason may contain at most 500 characters';
  end if;

  select review.*
  into target_review
  from public.caregiver_historical_reviews review
  where review.id = p_review_id
  for update;

  if not found then
    raise exception 'Historical caregiver review not found';
  end if;

  update public.caregiver_historical_reviews
  set is_published = effective_published,
      archived_at = case when coalesce(p_archived, false) then now() else null end,
      archived_by = case when coalesce(p_archived, false) then auth.uid() else null end,
      archived_reason = case when coalesce(p_archived, false) then normalized_reason else null end,
      updated_at = now()
  where id = p_review_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_HISTORICAL_REVIEW_STATUS_UPDATED',
    'caregiver_historical_reviews',
    p_review_id,
    jsonb_build_object(
      'caregiver_id', target_review.caregiver_id,
      'old_published', target_review.is_published,
      'new_published', effective_published,
      'archived', coalesce(p_archived, false),
      'reason_supplied', normalized_reason is not null
    )
  );

  return jsonb_build_object(
    'review_id', p_review_id,
    'published', effective_published,
    'archived', coalesce(p_archived, false)
  );
end;
$$;

-- Anonymous callers receive one deliberately sanitized directory row per
-- published, currently active caregiver. No email, phone, residential area,
-- client identity, assignment identifier, or HR data leaves this boundary.
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
    public_profile.caregiver_id,
    public_profile.display_name,
    public_profile.headline,
    public_profile.biography,
    public_profile.photo_path,
    case
      when public_profile.photo_path is null then null
      else '/storage/v1/object/public/caregiver-public-photos/' || public_profile.photo_path
    end as photo_url,
    public_profile.photo_alt,
    public_profile.career_years,
    public_profile.specialties,
    public_profile.credentials,
    public_profile.languages,
    public_profile.service_area,
    public_profile.featured,
    public_profile.sort_order,
    score_summary.average_rating,
    score_summary.review_count,
    score_summary.rating_distribution,
    coalesce(public_review_list.reviews, '[]'::jsonb) as reviews
  from public.caregiver_public_profiles public_profile
  join public.caregivers caregiver on caregiver.id = public_profile.caregiver_id
  join public.profiles profile on profile.id = caregiver.user_id
  join public.caregiver_hr_profiles hr on hr.caregiver_id = caregiver.id
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
      where review.caregiver_id = public_profile.caregiver_id
        and not public.care_assignment_is_administratively_removed(review.assignment_id)
        and public.care_assignment_has_delivered_history(review.assignment_id)
      union all
      select historical.rating::integer
      from public.caregiver_historical_reviews historical
      where historical.caregiver_id = public_profile.caregiver_id
        and historical.is_published
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
          review.created_at
        from public.caregiver_reviews review
        join public.caregiver_review_publications publication
          on publication.review_id = review.id
        join public.care_assignments assignment
          on assignment.id = review.assignment_id
        where review.caregiver_id = public_profile.caregiver_id
          and publication.customer_public_consent
          and publication.status = 'PUBLISHED'
          and not public.care_assignment_is_administratively_removed(review.assignment_id)
          and public.care_assignment_has_delivered_history(review.assignment_id)

        union all

        select
          historical.id,
          'ADMIN_LEGACY'::text as source,
          historical.rating::integer,
          historical.tags,
          historical.comment,
          historical.service_type::text,
          historical.service_date,
          historical.reviewer_alias,
          historical.created_at
        from public.caregiver_historical_reviews historical
        where historical.caregiver_id = public_profile.caregiver_id
          and historical.is_published
          and historical.archived_at is null
      ) combined
      order by combined.service_date desc nulls last, combined.created_at desc
      limit 12
    ) visible_review
  ) public_review_list on true
  where public_profile.is_published
    and caregiver.status = 'ACTIVE'
    and profile.account_status = 'ACTIVE'
    and profile.deleted_at is null
    and hr.employment_status = 'ACTIVE'
    and public.has_role_for_user(caregiver.user_id, 'CAREGIVER')
  order by public_profile.featured desc,
           public_profile.sort_order,
           score_summary.average_rating desc nulls last,
           public_profile.display_name;
$$;

-- Public portraits use a dedicated public bucket. Private account avatars and
-- HR evidence remain in their existing private buckets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'caregiver-public-photos',
  'caregiver-public-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "caregiver public photos: public read" on storage.objects;
create policy "caregiver public photos: public read"
on storage.objects for select to public
using (bucket_id = 'caregiver-public-photos');

drop policy if exists "caregiver public photos: administrators insert" on storage.objects;
create policy "caregiver public photos: administrators insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'caregiver-public-photos'
  and public.is_admin()
  and exists (
    select 1
    from public.caregivers caregiver
    where caregiver.id::text = split_part(name, '/', 1)
  )
);

drop policy if exists "caregiver public photos: administrators update" on storage.objects;
create policy "caregiver public photos: administrators update"
on storage.objects for update to authenticated
using (bucket_id = 'caregiver-public-photos' and public.is_admin())
with check (
  bucket_id = 'caregiver-public-photos'
  and public.is_admin()
  and exists (
    select 1
    from public.caregivers caregiver
    where caregiver.id::text = split_part(name, '/', 1)
  )
);

drop policy if exists "caregiver public photos: administrators delete" on storage.objects;
create policy "caregiver public photos: administrators delete"
on storage.objects for delete to authenticated
using (bucket_id = 'caregiver-public-photos' and public.is_admin());

-- Close the legacy direct insert path. SECURITY DEFINER RPCs above are the only
-- browser mutation boundaries for reviews, publication state, and public bios.
drop policy if exists "caregiver reviews: client submits once after care"
  on public.caregiver_reviews;
drop policy if exists "caregiver reviews: client submits after completed assignment"
  on public.caregiver_reviews;
revoke insert, update, delete on table public.caregiver_reviews from public, anon, authenticated;
grant select on table public.caregiver_reviews to authenticated;

revoke all on function public.submit_caregiver_review(uuid, integer, text[], text, boolean)
  from public, anon;
grant execute on function public.submit_caregiver_review(uuid, integer, text[], text, boolean)
  to authenticated;

revoke all on function public.withdraw_caregiver_review_public_consent(uuid)
  from public, anon;
grant execute on function public.withdraw_caregiver_review_public_consent(uuid)
  to authenticated;

revoke all on function public.admin_upsert_caregiver_public_profile(
  uuid, text, text, text, text, text, numeric, text[], text[], text[], text,
  boolean, integer, boolean
) from public, anon;
grant execute on function public.admin_upsert_caregiver_public_profile(
  uuid, text, text, text, text, text, numeric, text[], text[], text[], text,
  boolean, integer, boolean
) to authenticated;

revoke all on function public.admin_create_historical_caregiver_review(
  uuid, integer, text[], text, public.care_service_type, date, text, boolean
) from public, anon;
grant execute on function public.admin_create_historical_caregiver_review(
  uuid, integer, text[], text, public.care_service_type, date, text, boolean
) to authenticated;

revoke all on function public.admin_set_caregiver_review_publication(uuid, text)
  from public, anon;
grant execute on function public.admin_set_caregiver_review_publication(uuid, text)
  to authenticated;

revoke all on function public.admin_set_historical_review_publication(
  uuid, boolean, boolean, text
) from public, anon;
grant execute on function public.admin_set_historical_review_publication(
  uuid, boolean, boolean, text
) to authenticated;

revoke all on function public.public_caregiver_directory() from public;
grant execute on function public.public_caregiver_directory() to anon, authenticated;

comment on table public.caregiver_public_profiles is
  'Administrator-curated, non-sensitive caregiver biographies for the public ProMoms directory.';
comment on table public.caregiver_historical_reviews is
  'Audited administrator-imported prior caregiver reviews; never represented as an in-app verified customer review.';
comment on table public.caregiver_review_publications is
  'Customer consent and administrator moderation state for publishing immutable service review text.';
comment on function public.submit_caregiver_review(uuid, integer, text[], text, boolean) is
  'Creates one immutable customer review after objectively recorded care has ended; derives all ownership fields server-side.';
comment on function public.withdraw_caregiver_review_public_consent(uuid) is
  'Allows the serviced family to withdraw future anonymous homepage publication while retaining the immutable service review.';
comment on function public.public_caregiver_directory() is
  'Returns a sanitized anonymous caregiver directory with aggregate ratings and moderated public review text.';

select pg_notify('pgrst', 'reload schema');

commit;
