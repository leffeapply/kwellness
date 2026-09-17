-- External review photos are optional. Administrator attestation and a written
-- verification note remain required before an off-platform review is verified.

begin;

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
      and cardinality(photo_paths) between 0 and 3
      and verification_note is not null
      and char_length(trim(verification_note)) between 10 and 500
      and verified_by is not null
      and verified_at is not null
    )
  );

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

comment on column public.caregiver_historical_reviews.verification_status is
  'VERIFIED after an administrator records an attestation note; optional evidence photos may also be attached.';

comment on function public.admin_verify_historical_caregiver_review(uuid, text[], text) is
  'Verifies an off-platform review from an administrator attestation note and optionally attaches up to three evidence photos.';

select pg_notify('pgrst', 'reload schema');

commit;
