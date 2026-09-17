import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const cloud = readFileSync(new URL("../cloud-data.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/043_service_packages_and_massage_booking.sql", import.meta.url), "utf8");

const appRules = [
  "const POSTPARTUM_WEEKLY_RATE = 1800",
  "const POSTPARTUM_LIVE_IN_WEEKLY_RATE = 2100",
  "const BABYSITTING_HOURLY_RATE = 32",
  "POSTPARTUM_CLIENT: Object.freeze({ 60: 135, 90: 190, PACKAGE_4: 520 })",
  "GENERAL: Object.freeze({ 60: 150, 90: 210 })",
  "data-postpartum-mode=\"LIVE_IN\"",
  "data-massage-book",
  "name=\"massageTherapist\"",
  "massageTherapistIsAvailable",
  "(Math.max(1, sessionCount) - 1) * 7",
  "MASSAGE_CHANGE_NOTICE_HOURS = 24",
];
appRules.forEach((rule) => assert.ok(app.includes(rule), `app.js is missing: ${rule}`));

assert.ok(css.includes("grid-auto-flow: column"), "service cards must flow horizontally");
assert.ok(css.includes("scroll-snap-type: x mandatory"), "service cards must use horizontal snap scrolling");
assert.ok(css.includes(".massage-plan-options"), "massage product selector styles are missing");

[
  "submit_promoms_service_request",
  "review_promoms_service_request",
  "schedule_promoms_service_request",
  "admin_set_massage_therapist_capability",
  "submit_massage_adjustment",
  "review_massage_adjustment",
].forEach((rpc) => assert.ok(cloud.includes(`\"${rpc}\"`), `cloud-data.js is missing RPC ${rpc}`));

[
  "alter type public.care_service_type add value if not exists 'MASSAGE'",
  "is_massage_therapist",
  "client_has_postpartum_member_rate",
  "massage_therapist_schedule_is_available",
  "existing_contract.client_id <> p_client_id or existing_assignment.service_type::text = 'MASSAGE'",
  "interval '24 hours'",
  "when p_pricing_tier = 'POSTPARTUM_CLIENT' and p_session_count = 4",
  "new.weekly_rate := 2100.00",
].forEach((rule) => assert.ok(migration.includes(rule), `migration is missing: ${rule}`));

console.log("Service package, pricing, therapist capability, scheduling, and 24-hour massage policy checks passed.");
