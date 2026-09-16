import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, cloud, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../cloud-data.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/033_caregiver_reputation_marketing.sql", import.meta.url), "utf8"),
]);

const requiredSql = [
  "create table public.caregiver_public_profiles",
  "create table public.caregiver_historical_reviews",
  "create table public.caregiver_review_publications",
  "create or replace function public.submit_caregiver_review",
  "create or replace function public.withdraw_caregiver_review_public_consent",
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
assert.ok(migration.match(/historical\.is_published/g)?.length >= 2, "hidden historical reviews must be excluded from public scores and text");

assert.ok(cloud.includes('supabase.rpc("submit_caregiver_review"'), "customer reviews must use the atomic RPC");
assert.ok(!cloud.includes('supabase.from("caregiver_reviews").insert'), "browser must not directly insert caregiver reviews");
assert.ok(cloud.includes('supabase.rpc("public_caregiver_directory"'), "public caregiver directory must be loaded from the sanitized RPC");
assert.ok(cloud.includes('from("caregiver-public-photos").upload'), "public profile photo upload is missing");
assert.ok(cloud.includes('supabase.rpc("withdraw_caregiver_review_public_consent"'), "customer consent withdrawal RPC is missing");
assert.ok(cloud.includes('`${caregiverId}/profile`'), "public profile photos must replace one stable object instead of leaving old extensions public");

assert.ok(app.includes("function assignmentHasDeliveredCare"), "delivered-care eligibility guard is missing");
assert.ok(app.includes("clientCompletedReviewCenterMarkup(client)"), "completed-service review route is missing");
assert.ok(app.includes('name="publicConsent"'), "customer public-review consent is missing");
assert.ok(app.includes("data-withdraw-review-consent"), "customer public-review consent withdrawal control is missing");
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
