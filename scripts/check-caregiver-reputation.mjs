import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, cloud, migration, moderationMigration, photoMigration, profileSyncMigration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../cloud-data.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/033_caregiver_reputation_marketing.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/034_review_moderation_integrity.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/035_verified_external_reviews_and_photos.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/036_caregiver_public_profile_sync.sql", import.meta.url), "utf8"),
]);

const requiredSql = [
  "create table public.caregiver_public_profiles",
  "create table public.caregiver_historical_reviews",
  "create table public.caregiver_review_publications",
  "create or replace function public.submit_caregiver_review",
  "public.care_assignment_has_delivered_history(target_assignment.id)",
  "public.care_assignment_is_administratively_removed(target_assignment.id)",
  "create or replace function public.public_caregiver_directory()",
  "publication.customer_public_consent",
  "publication.status = 'PUBLISHED'",
  "revoke insert, update, delete on table public.caregiver_reviews",
  "'ADMIN_LEGACY'::text as source",
];

requiredSql.forEach((snippet) => assert.ok(migration.includes(snippet), `migration is missing: ${snippet}`));
assert.ok(!/returns table\s*\(\s*caregiver_id uuid,\s*user_id uuid/i.test(migration), "public directory must not expose profile user UUIDs");
assert.ok(migration.includes("grant execute on function public.public_caregiver_directory() to anon, authenticated"), "anonymous directory execute grant is required");
assert.ok(!migration.includes("Every currently employable caregiver receives"), "private HR prose must not be automatically backfilled to the public directory");

const requiredModerationSql = [
  "add column if not exists validity_status text not null default 'VALID'",
  "create table public.caregiver_review_moderation_events",
  "create or replace function public.admin_set_caregiver_review_validity",
  "'CAREGIVER_REVIEW_POLICY_EXCLUDED'",
  "'CAREGIVER_REVIEW_POLICY_RESTORED'",
  "publication.customer_public_consent",
  "publication.status = 'PUBLISHED'",
  "publication.validity_status = 'VALID'",
  "drop function if exists public.withdraw_caregiver_review_public_consent(uuid)",
  "'ADMIN_LEGACY'::text as source",
];

requiredModerationSql.forEach((snippet) => assert.ok(
  moderationMigration.includes(snippet),
  `review moderation migration is missing: ${snippet}`,
));

[
  "'SPAM'",
  "'FRAUD_OR_IMPERSONATION'",
  "'DUPLICATE'",
].forEach((reasonCode) => assert.ok(
  moderationMigration.includes(reasonCode),
  `review moderation migration is missing policy reason: ${reasonCode}`,
));
[
  "'ABUSIVE_CONTENT'",
  "'PERSONAL_DATA'",
  "'OFF_TOPIC'",
].forEach((reasonCode) => assert.ok(
  !moderationMigration.includes(reasonCode),
  `text-only policy issue must not suppress a verified score: ${reasonCode}`,
));

assert.ok(
  moderationMigration.includes("A supported policy reason is required; rating value is not a valid reason"),
  "a low rating must never be accepted as an exclusion reason",
);
assert.ok(
  moderationMigration.includes("char_length(normalized_reason_note) not between 10 and 500"),
  "policy exclusions must require a meaningful written reason",
);
assert.ok(
  moderationMigration.includes("status_before_invalidation = target_publication.status"),
  "review moderation must preserve the prior publication status for restoration",
);

const requiredPhotoSql = [
  "add column if not exists photo_paths text[] not null default '{}'::text[]",
  "add column if not exists verification_status text not null default 'UNVERIFIED'",
  "'caregiver-review-photos'",
  "array['image/jpeg', 'image/png', 'image/webp']",
  "create or replace function public.attach_caregiver_review_photos",
  "create or replace function public.admin_verify_historical_caregiver_review",
  "publication.customer_public_consent",
  "historical.verification_status = 'VERIFIED'",
  "'VERIFIED_CUSTOMER'::text as source",
  "'VERIFIED_EXTERNAL'::text",
  "'photo_paths', visible_review.photo_paths",
  "cardinality(photo_paths) between 0 and 3",
  "char_length(trim(verification_note)) between 10 and 500",
  "'CAREGIVER_EXTERNAL_REVIEW_VERIFIED'",
];

requiredPhotoSql.forEach((snippet) => assert.ok(
  photoMigration.includes(snippet),
  `verified review photo migration is missing: ${snippet}`,
));
assert.ok(
  !photoMigration.includes("^customer/' || auth.uid()::text"),
  "public customer review photo paths must not expose the authentication user UUID",
);

const scoreSummaryStart = photoMigration.indexOf("left join lateral (\n    select\n      round(avg(score.rating)");
const scoreSummaryEnd = photoMigration.indexOf(") score_summary on true", scoreSummaryStart);
assert.ok(scoreSummaryStart >= 0 && scoreSummaryEnd > scoreSummaryStart, "combined verified score summary query is missing");
const scoreSummarySql = photoMigration.slice(scoreSummaryStart, scoreSummaryEnd);
assert.ok(scoreSummarySql.includes("from public.caregiver_reviews review"), "public ratings must include verified customer reviews");
assert.ok(scoreSummarySql.includes("publication.validity_status = 'VALID'"), "policy-invalid customer reviews must be excluded from ratings");
assert.ok(scoreSummarySql.includes("public.care_assignment_has_delivered_history(review.assignment_id)"), "customer ratings must require delivered service history");
assert.ok(scoreSummarySql.includes("from public.caregiver_historical_reviews historical"), "verified off-platform reviews must contribute to the combined average");
assert.ok(scoreSummarySql.includes("historical.verification_status = 'VERIFIED'"), "unverified administrator-entered reviews must not affect the combined average");
assert.ok(scoreSummarySql.includes("historical.archived_at is null"), "archived external reviews must not affect the combined average");

const publicReviewListStart = photoMigration.indexOf("left join lateral (\n    select jsonb_agg(", scoreSummaryEnd);
const publicReviewListEnd = photoMigration.indexOf(") public_review_list on true", publicReviewListStart);
assert.ok(publicReviewListStart >= 0 && publicReviewListEnd > publicReviewListStart, "public review copy query is missing");
const publicReviewListSql = photoMigration.slice(publicReviewListStart, publicReviewListEnd);
assert.ok(publicReviewListSql.includes("publication.customer_public_consent"), "public customer copy must require consent");
assert.ok(publicReviewListSql.includes("publication.status = 'PUBLISHED'"), "homepage copy must require administrator selection");
assert.ok(publicReviewListSql.includes("publication.validity_status = 'VALID'"), "policy-invalid copy must never be public");
assert.ok(!publicReviewListSql.includes("'ADMIN_LEGACY'::text as source"), "unverified administrator-entered copy must not be public");
assert.ok(publicReviewListSql.includes("'VERIFIED_EXTERNAL'::text as source"), "verified external copy must keep a transparent source marker");
assert.ok(publicReviewListSql.includes("historical.verification_status = 'VERIFIED'"), "public external-review copy must retain a verified source state");
assert.ok(photoMigration.includes("from public.caregivers caregiver"), "active caregivers must be the public-directory base set");
assert.ok(photoMigration.includes("left join public.caregiver_public_profiles public_profile"), "a missing marketing profile must not hide an active caregiver");
assert.ok(photoMigration.includes("where coalesce(public_profile.is_published, true)"), "active caregivers without a marketing profile must use the safe public fallback");

[
  "create or replace function public.sync_caregiver_public_profile_shared_fields()",
  "create trigger caregiver_public_profile_name_sync",
  "create trigger caregiver_public_profile_hr_sync",
  "after update of full_name on public.profiles",
  "after insert or update of career_years, career_summary, specialties, service_area_notes",
  "update public.caregiver_public_profiles public_profile",
].forEach((snippet) => assert.ok(
  profileSyncMigration.includes(snippet),
  `caregiver public-profile synchronization migration is missing: ${snippet}`,
));
assert.ok(
  profileSyncMigration.includes("new.display_name := left(trim(canonical_name), 80)"),
  "homepage names must be sourced from the canonical account profile",
);
assert.ok(
  profileSyncMigration.includes("new.credentials := public.caregiver_profile_text_list(canonical_credentials, 12, 120)"),
  "homepage qualifications must be sourced from the canonical HR profile",
);

assert.ok(cloud.includes('supabase.rpc("submit_caregiver_review"'), "customer reviews must use the atomic RPC");
assert.ok(!cloud.includes('supabase.from("caregiver_reviews").insert'), "browser must not directly insert caregiver reviews");
assert.ok(cloud.includes('supabase.rpc("public_caregiver_directory"'), "public caregiver directory must be loaded from the sanitized RPC");
assert.ok(cloud.includes('from("caregiver-public-photos").upload'), "public profile photo upload is missing");
assert.ok(cloud.includes('supabase.rpc("admin_set_caregiver_review_validity"'), "audited review validity RPC wrapper is missing");
assert.ok(!cloud.includes('supabase.rpc("withdraw_caregiver_review_public_consent"'), "self-service public-consent withdrawal must remain removed");
assert.ok(cloud.includes('`${caregiverId}/profile`'), "public profile photos must replace one stable object instead of leaving old extensions public");
assert.ok(cloud.includes('storage.from("caregiver-review-photos").upload'), "review photo storage upload is missing");
assert.ok(cloud.includes('supabase.rpc("attach_caregiver_review_photos"'), "customer review photo attachment RPC wrapper is missing");
assert.ok(cloud.includes('supabase.rpc("admin_verify_historical_caregiver_review"'), "external-review verification RPC wrapper is missing");
assert.ok(cloud.includes('`customer/${reviewId}`'), "customer review photo paths must use the review ID without exposing the auth user ID");
assert.ok(cloud.includes("values.fullName ?? values.publicDisplayName"), "public profile saves must prefer the canonical caregiver name");
assert.ok(cloud.includes("values.certification ?? values.publicCredentials"), "public profile saves must prefer canonical caregiver qualifications");

assert.ok(app.includes("function assignmentHasDeliveredCare"), "delivered-care eligibility guard is missing");
assert.ok(app.includes("clientCompletedReviewCenterMarkup(client)"), "completed-service review route is missing");
assert.ok(app.includes('name="publicConsent"'), "customer public-review consent is missing");
assert.ok(!app.includes("data-withdraw-review-consent"), "customer public-review consent withdrawal control must remain removed");
assert.ok(app.includes("data-invalidate-client-review"), "administrator policy-invalidation control is missing");
assert.ok(app.includes("data-restore-client-review"), "administrator review-restoration control is missing");
assert.ok(app.includes("외부 경로 확인 후기"), "verified off-platform reviews must remain visibly attributed");
assert.ok(!app.includes('rating === 5 ? "checked"'), "five-star default selection must not be restored");
assert.ok(app.includes('publicProfile.isPublished === true ? "checked"'), "new public caregiver profiles must default to private");
assert.ok(app.includes("const easternToday = easternDateKey()"), "historical review dates must use the server business timezone");
assert.ok(app.includes("data-add-historical-review"), "administrator historical review entry point is missing");
assert.ok(app.includes("publicCaregiverDirectoryMarkup()"), "homepage caregiver directory is missing");
assert.ok(app.includes('name="reviewPhotos"'), "review photo selection controls are missing");
assert.ok(app.includes("data-add-review-photos"), "customer review photo follow-up control is missing");
assert.ok(app.includes("data-verify-historical-review"), "administrator external-review evidence control is missing");
assert.ok(app.includes("reviewPhotoGalleryMarkup(review)"), "public caregiver reviews must render their attached photos");
assert.ok(app.includes("syncSharedHomepageFields"), "caregiver HR edits must be mirrored into the homepage profile form");

const average = (ratings) => ratings.length
  ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1))
  : null;
assert.equal(average([5, 4, 5, 3]), 4.3);
assert.equal(average([]), null);
assert.equal([1, 2, 3, 4, 5].every((rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5), true);

console.log("Caregiver reputation checks passed.");
