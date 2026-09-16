import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, cloud, migration, moderationMigration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../cloud-data.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/033_caregiver_reputation_marketing.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/034_review_moderation_integrity.sql", import.meta.url), "utf8"),
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

const scoreSummaryStart = moderationMigration.indexOf("left join lateral (\n    select\n      round(avg(review.rating)");
const scoreSummaryEnd = moderationMigration.indexOf(") score_summary on true", scoreSummaryStart);
assert.ok(scoreSummaryStart >= 0 && scoreSummaryEnd > scoreSummaryStart, "verified score summary query is missing");
const scoreSummarySql = moderationMigration.slice(scoreSummaryStart, scoreSummaryEnd);
assert.ok(scoreSummarySql.includes("from public.caregiver_reviews review"), "public ratings must originate from verified customer reviews");
assert.ok(scoreSummarySql.includes("publication.validity_status = 'VALID'"), "policy-invalid customer reviews must be excluded from ratings");
assert.ok(scoreSummarySql.includes("public.care_assignment_has_delivered_history(review.assignment_id)"), "ratings must require delivered service history");
assert.ok(!scoreSummarySql.includes("caregiver_historical_reviews"), "administrator-imported historical ratings must never affect the verified average");
assert.ok(!scoreSummarySql.includes("ADMIN_LEGACY"), "legacy review sources must never affect the verified average");

const publicReviewListStart = moderationMigration.indexOf("left join lateral (\n    select jsonb_agg(", scoreSummaryEnd);
const publicReviewListEnd = moderationMigration.indexOf(") public_review_list on true", publicReviewListStart);
assert.ok(publicReviewListStart >= 0 && publicReviewListEnd > publicReviewListStart, "public review copy query is missing");
const publicReviewListSql = moderationMigration.slice(publicReviewListStart, publicReviewListEnd);
assert.ok(publicReviewListSql.includes("publication.customer_public_consent"), "public customer copy must require consent");
assert.ok(publicReviewListSql.includes("publication.status = 'PUBLISHED'"), "homepage copy must require administrator selection");
assert.ok(publicReviewListSql.includes("publication.validity_status = 'VALID'"), "policy-invalid copy must never be public");
assert.ok(publicReviewListSql.includes("'ADMIN_LEGACY'::text as source"), "administrator-imported copy must keep a transparent source marker");
assert.ok(moderationMigration.includes("from public.caregivers caregiver"), "active caregivers must be the public-directory base set");
assert.ok(moderationMigration.includes("left join public.caregiver_public_profiles public_profile"), "a missing marketing profile must not hide an active caregiver");
assert.ok(moderationMigration.includes("where coalesce(public_profile.is_published, true)"), "active caregivers without a marketing profile must use the safe public fallback");

assert.ok(cloud.includes('supabase.rpc("submit_caregiver_review"'), "customer reviews must use the atomic RPC");
assert.ok(!cloud.includes('supabase.from("caregiver_reviews").insert'), "browser must not directly insert caregiver reviews");
assert.ok(cloud.includes('supabase.rpc("public_caregiver_directory"'), "public caregiver directory must be loaded from the sanitized RPC");
assert.ok(cloud.includes('from("caregiver-public-photos").upload'), "public profile photo upload is missing");
assert.ok(cloud.includes('supabase.rpc("admin_set_caregiver_review_validity"'), "audited review validity RPC wrapper is missing");
assert.ok(!cloud.includes('supabase.rpc("withdraw_caregiver_review_public_consent"'), "self-service public-consent withdrawal must remain removed");
assert.ok(cloud.includes('`${caregiverId}/profile`'), "public profile photos must replace one stable object instead of leaving old extensions public");

assert.ok(app.includes("function assignmentHasDeliveredCare"), "delivered-care eligibility guard is missing");
assert.ok(app.includes("clientCompletedReviewCenterMarkup(client)"), "completed-service review route is missing");
assert.ok(app.includes('name="publicConsent"'), "customer public-review consent is missing");
assert.ok(!app.includes("data-withdraw-review-consent"), "customer public-review consent withdrawal control must remain removed");
assert.ok(app.includes("data-invalidate-client-review"), "administrator policy-invalidation control is missing");
assert.ok(app.includes("data-restore-client-review"), "administrator review-restoration control is missing");
assert.ok(app.includes("이전 서비스 후기 · 관리자 등록"), "administrator-imported reviews must remain visibly attributed");
assert.ok(!app.includes('rating === 5 ? "checked"'), "five-star default selection must not be restored");
assert.ok(app.includes('publicProfile.isPublished === true ? "checked"'), "new public caregiver profiles must default to private");
assert.ok(app.includes("const easternToday = easternDateKey()"), "historical review dates must use the server business timezone");
assert.ok(app.includes("data-add-historical-review"), "administrator historical review entry point is missing");
assert.ok(app.includes("publicCaregiverDirectoryMarkup()"), "homepage caregiver directory is missing");

const average = (ratings) => ratings.length
  ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1))
  : null;
assert.equal(average([5, 4, 5, 3]), 4.3);
assert.equal(average([]), null);
assert.equal([1, 2, 3, 4, 5].every((rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5), true);

console.log("Caregiver reputation checks passed.");
