-- Review moderation integrity.
--
-- Public review copy is curated independently from rating eligibility:
--   * only consented, administrator-selected customer copy is public;
--   * every policy-valid, delivered-service customer score contributes to the
--     public average, whether or not its text is published;
--   * a score may be excluded only through an audited policy decision and can
--     be restored without deleting or editing the original customer review;
--   * administrator-imported historical reviews remain visibly identified and
--     never influence the verified-customer aggregate.

begin;

alter table public.caregiver_review_publications
  add column if not exists validity_status text not null default 'VALID',
  add column if not exists validity_reason_code text,
  add column if not exists validity_reason_note text,
  add column if not exists validity_moderated_by uuid references public.profiles(id),
  add column if not exists validity_moderated_at timestamptz,
  add column if not exists status_before_invalidation text;

alter table public.caregiver_review_publications
  drop constraint if exists caregiver_review_publications_validity_check;

alter table public.caregiver_review_publications
  add constraint caregiver_review_publications_validity_check
  check (
    (
      validity_status = 'VALID'
      and validity_reason_code is null
      and validity_reason_note is null
      and status_before_invalidation is null
    )
    or (
      validity_status = 'INVALID'
      and status = 'HIDDEN'
      and validity_reason_code is not null
      and validity_reason_code in (
        'SPAM',
        'FRAUD_OR_IMPERSONATION',
        'DUPLICATE'
      )
      and validity_reason_note is not null
      and char_length(trim(validity_reason_note)) between 10 and 500
      and validity_moderated_by is not null
      and validity_moderated_at is not null
      and status_before_invalidation in ('PRIVATE', 'PENDING', 'PUBLISHED', 'HIDDEN')
    )
  );

create index if not exists caregiver_review_publications_validity_status_idx
  on public.caregiver_review_publications(validity_status, review_id);

-- Append-only moderation evidence. No browser role receives insert, update, or
-- delete privileges; the SECURITY DEFINER RPC below is the sole write path.
create table public.caregiver_review_moderation_events (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.caregiver_reviews(id) on delete restrict,
  action text not null check (action in ('EXCLUDE', 'RESTORE')),
  reason_code text,
  reason_note text,
  previous_publication_status text not null
    check (previous_publication_status in ('PRIVATE', 'PENDING', 'PUBLISHED', 'HIDDEN')),
  actor_id uuid not null references public.profiles(id),
  occurred_at timestamptz not null default now(),
  check (
    (
      action = 'EXCLUDE'
      and reason_code in (
        'SPAM',
        'FRAUD_OR_IMPERSONATION',
        'DUPLICATE'
      )
      and char_length(trim(reason_note)) between 10 and 500
    )
    or (
      action = 'RESTORE'
      and reason_code is null
      and reason_note is null
    )
  )
);

create index caregiver_review_moderation_events_review_idx
  on public.caregiver_review_moderation_events(review_id, occurred_at desc, id desc);

alter table public.caregiver_review_moderation_events enable row level security;

create policy "caregiver review moderation events: administrators read"
on public.caregiver_review_moderation_events for select to authenticated
using (public.is_admin());

revoke all on table public.caregiver_review_moderation_events
  from public, anon, authenticated;
grant select on table public.caregiver_review_moderation_events to authenticated;

-- Customer text publication and rating eligibility are intentionally separate.
-- An invalid review cannot be selected for public display, and changing public
-- copy selection never changes whether a valid score contributes to the mean.
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
  if target_publication.validity_status = 'INVALID'
     and normalized_status <> 'HIDDEN' then
    raise exception 'A policy-excluded review must be restored before it can be selected for publication';
  end if;
  if normalized_status = 'PUBLISHED'
     and not target_publication.customer_public_consent then
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
      'customer_public_consent', target_publication.customer_public_consent,
      'validity_status', target_publication.validity_status
    )
  );

  return jsonb_build_object(
    'review_id', p_review_id,
    'status', normalized_status,
    'validity_status', target_publication.validity_status
  );
end;
$$;

-- "Delete" in the administrative UI is implemented as a reversible policy
-- exclusion. The original review and every decision remain immutable. A low
-- score is deliberately not an accepted reason code.
create or replace function public.admin_set_caregiver_review_validity(
  p_review_id uuid,
  p_is_valid boolean,
  p_reason_code text default null,
  p_reason_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason_code text := upper(trim(coalesce(p_reason_code, '')));
  normalized_reason_note text := nullif(trim(p_reason_note), '');
  target_review public.caregiver_reviews%rowtype;
  target_publication public.caregiver_review_publications%rowtype;
  last_exclusion public.caregiver_review_moderation_events%rowtype;
  restored_publication_status text;
  saved_event_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can apply review policy decisions';
  end if;
  if p_is_valid is null then
    raise exception 'Review validity decision is required';
  end if;

  select review.*
  into target_review
  from public.caregiver_reviews review
  where review.id = p_review_id;

  if not found then
    raise exception 'Caregiver review not found';
  end if;

  select publication.*
  into target_publication
  from public.caregiver_review_publications publication
  where publication.review_id = p_review_id
  for update;

  if not found then
    raise exception 'Caregiver review publication record not found';
  end if;

  if not p_is_valid then
    if target_publication.validity_status = 'INVALID' then
      raise exception 'Caregiver review is already excluded';
    end if;
    if normalized_reason_code not in (
      'SPAM',
      'FRAUD_OR_IMPERSONATION',
      'DUPLICATE'
    ) then
      raise exception 'A supported policy reason is required; rating value is not a valid reason';
    end if;
    if normalized_reason_note is null
       or char_length(normalized_reason_note) not between 10 and 500 then
      raise exception 'A policy explanation between 10 and 500 characters is required';
    end if;

    insert into public.caregiver_review_moderation_events (
      review_id,
      action,
      reason_code,
      reason_note,
      previous_publication_status,
      actor_id
    ) values (
      p_review_id,
      'EXCLUDE',
      normalized_reason_code,
      normalized_reason_note,
      target_publication.status,
      auth.uid()
    )
    returning id into saved_event_id;

    update public.caregiver_review_publications
    set validity_status = 'INVALID',
        validity_reason_code = normalized_reason_code,
        validity_reason_note = normalized_reason_note,
        validity_moderated_by = auth.uid(),
        validity_moderated_at = now(),
        status_before_invalidation = target_publication.status,
        status = 'HIDDEN',
        moderated_by = auth.uid(),
        moderated_at = now(),
        updated_at = now()
    where review_id = p_review_id;

    insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(),
      'CAREGIVER_REVIEW_POLICY_EXCLUDED',
      'caregiver_reviews',
      p_review_id,
      jsonb_build_object(
        'moderation_event_id', saved_event_id,
        'caregiver_id', target_review.caregiver_id,
        'assignment_id', target_review.assignment_id,
        'rating', target_review.rating,
        'reason_code', normalized_reason_code,
        'reason_note', normalized_reason_note,
        'previous_publication_status', target_publication.status
      )
    );

    return jsonb_build_object(
      'review_id', p_review_id,
      'validity_status', 'INVALID',
      'publication_status', 'HIDDEN'
    );
  end if;

  if target_publication.validity_status <> 'INVALID' then
    raise exception 'Caregiver review is not currently excluded';
  end if;
  if normalized_reason_code <> '' or normalized_reason_note is not null then
    raise exception 'Restore does not accept a new policy reason';
  end if;

  select event.*
  into last_exclusion
  from public.caregiver_review_moderation_events event
  where event.review_id = p_review_id
    and event.action = 'EXCLUDE'
  order by event.occurred_at desc, event.id desc
  limit 1;

  if not found then
    raise exception 'The exclusion history required for restoration is missing';
  end if;

  restored_publication_status := case
    when target_publication.status_before_invalidation = 'PUBLISHED'
      and target_publication.customer_public_consent
      then 'PUBLISHED'
    when target_publication.status_before_invalidation = 'PENDING'
      and target_publication.customer_public_consent
      then 'PENDING'
    when target_publication.status_before_invalidation = 'PRIVATE'
      then 'PRIVATE'
    else 'HIDDEN'
  end;

  insert into public.caregiver_review_moderation_events (
    review_id,
    action,
    reason_code,
    reason_note,
    previous_publication_status,
    actor_id
  ) values (
    p_review_id,
    'RESTORE',
    null,
    null,
    target_publication.status,
    auth.uid()
  )
  returning id into saved_event_id;

  update public.caregiver_review_publications
  set validity_status = 'VALID',
      validity_reason_code = null,
      validity_reason_note = null,
      validity_moderated_by = auth.uid(),
      validity_moderated_at = now(),
      status_before_invalidation = null,
      status = restored_publication_status,
      moderated_by = auth.uid(),
      moderated_at = now(),
      updated_at = now()
  where review_id = p_review_id;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CAREGIVER_REVIEW_POLICY_RESTORED',
    'caregiver_reviews',
    p_review_id,
    jsonb_build_object(
      'moderation_event_id', saved_event_id,
      'caregiver_id', target_review.caregiver_id,
      'assignment_id', target_review.assignment_id,
      'rating', target_review.rating,
      'restored_publication_status', restored_publication_status,
      'exclusion_reason_code', last_exclusion.reason_code,
      'exclusion_event_id', last_exclusion.id
    )
  );

  return jsonb_build_object(
    'review_id', p_review_id,
    'validity_status', 'VALID',
    'publication_status', restored_publication_status
  );
end;
$$;

-- Anonymous callers receive one deliberately sanitized directory row per
-- active caregiver. A missing marketing profile uses neutral public defaults
-- so a newly activated caregiver is not silently absent from the homepage;
-- administrators can still opt a completed profile out with is_published.
-- The displayed average is based exclusively on
-- policy-valid reviews written through the verified completed-service flow.
-- Administrator-imported historical reviews may supply curated public copy,
-- but never change that verified-customer average or its distribution.
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
      round(avg(review.rating)::numeric, 2) as average_rating,
      count(*)::bigint as review_count,
      jsonb_build_object(
        '1', count(*) filter (where review.rating = 1),
        '2', count(*) filter (where review.rating = 2),
        '3', count(*) filter (where review.rating = 3),
        '4', count(*) filter (where review.rating = 4),
        '5', count(*) filter (where review.rating = 5)
      ) as rating_distribution
    from public.caregiver_reviews review
    join public.caregiver_review_publications publication
      on publication.review_id = review.id
    where review.caregiver_id = caregiver.id
      and publication.validity_status = 'VALID'
      and not public.care_assignment_is_administratively_removed(review.assignment_id)
      and public.care_assignment_has_delivered_history(review.assignment_id)
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
        where review.caregiver_id = caregiver.id
          and publication.customer_public_consent
          and publication.status = 'PUBLISHED'
          and publication.validity_status = 'VALID'
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
        where historical.caregiver_id = caregiver.id
          and historical.is_published
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

-- Consent is captured once when the customer submits a review. There is no
-- longer a browser self-service withdrawal mutation. An administrator can
-- still hide the public copy without changing the verified score.
revoke all on function public.withdraw_caregiver_review_public_consent(uuid)
  from public, anon, authenticated;
drop function if exists public.withdraw_caregiver_review_public_consent(uuid);

revoke all on function public.admin_set_caregiver_review_validity(
  uuid, boolean, text, text
) from public, anon;
grant execute on function public.admin_set_caregiver_review_validity(
  uuid, boolean, text, text
) to authenticated;

revoke all on function public.admin_set_caregiver_review_publication(uuid, text)
  from public, anon;
grant execute on function public.admin_set_caregiver_review_publication(uuid, text)
  to authenticated;

revoke all on function public.public_caregiver_directory() from public;
grant execute on function public.public_caregiver_directory() to anon, authenticated;

comment on column public.caregiver_review_publications.validity_status is
  'VALID unless an administrator records a reversible, policy-based invalidation; independent from public-copy selection.';
comment on table public.caregiver_review_moderation_events is
  'Append-only evidence for policy-based score exclusions and restorations. Low ratings alone are never a supported exclusion reason.';
comment on function public.admin_set_caregiver_review_validity(uuid, boolean, text, text) is
  'Audited, reversible policy moderation for verified customer reviews; never edits or deletes the submitted review.';
comment on function public.public_caregiver_directory() is
  'Sanitized active-caregiver directory with neutral fallbacks when no marketing profile exists; verified averages exclude policy-invalid reviews and never mix administrator-imported historical ratings.';

select pg_notify('pgrst', 'reload schema');

commit;
