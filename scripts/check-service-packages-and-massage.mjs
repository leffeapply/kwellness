import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const cloud = readFileSync(new URL("../cloud-data.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const enumMigration = readFileSync(new URL("../supabase/migrations/043_add_massage_service_type.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/044_service_packages_and_massage_booking.sql", import.meta.url), "utf8");
const permissionMigration = readFileSync(new URL("../supabase/migrations/046_independent_staff_service_permissions.sql", import.meta.url), "utf8");
const massageProfileMigration = readFileSync(new URL("../supabase/migrations/047_massage_only_profile_without_reviews.sql", import.meta.url), "utf8");

const appRules = [
  "const POSTPARTUM_WEEKLY_RATE = 1800",
  "const POSTPARTUM_LIVE_IN_WEEKLY_RATE = 2100",
  "const BABYSITTING_HOURLY_RATE = 32",
  "POSTPARTUM_CLIENT: Object.freeze({ 60: 135, 90: 190, PACKAGE_4: 520 })",
  "GENERAL: Object.freeze({ 60: 150, 90: 210 })",
  "data-postpartum-mode=\"LIVE_IN\"",
  "data-massage-book",
  'serviceOption("postpartumCaregiver"',
  'serviceOption("babysittingCaregiver"',
  'serviceOption("massageTherapist"',
  "therapistAvailabilityPage",
  "therapistMassageCalendar",
  "data-massage-slot",
  "data-massage-session-change",
  "massage-day-summary",
  "therapist-massage-calendar-card",
  "MASSAGE_CHANGE_NOTICE_HOURS = 24",
  "전문 자격이 부여된 마사지 테라피스트의 산후/산전 마사지 서비스",
  "LMT(주 정부 라이센스) 보유 테라피스트",
];
appRules.forEach((rule) => assert.ok(app.includes(rule), `app.js is missing: ${rule}`));

assert.ok(css.includes("grid-auto-flow: column"), "service cards must flow horizontally");
assert.ok(css.includes("scroll-snap-type: x mandatory"), "service cards must use horizontal snap scrolling");
assert.ok(css.includes(".massage-plan-options"), "massage product selector styles are missing");
assert.ok(css.includes(".massage-slot-grid"), "massage availability slot styles are missing");
assert.ok(css.includes(".massage-calendar .month-weekdays"), "massage calendar mobile grid override is missing");
assert.ok(css.includes("grid-template-columns: repeat(7, minmax(0, 1fr))"), "massage calendar must fit seven days within the mobile viewport");
assert.ok(css.includes(".massage-day-summary"), "massage calendar mobile day summary styles are missing");
assert.ok(css.includes(".service-request-columns.three-service-columns { grid-template-columns: 1fr; }"), "service approval sections must stack as full-width horizontal cards");
assert.ok(css.includes(".request-service-column .client-request-row { grid-template-columns: minmax(210px, 1.2fr)"), "service approval request details must use a wide row layout");
assert.ok(css.includes(".public-service-card { position: relative; display: flex;"), "public service cards must use a vertical flex layout");
assert.ok(css.includes("margin-top: auto; margin-bottom: 25px;"), "service prices and application buttons must share a bottom alignment");

[
  "available_massage_slots",
  "save_my_massage_availability",
  "submit_massage_service_request",
  "submit_massage_booking_change",
  "review_massage_booking_change",
  "submit_promoms_service_request",
  "review_promoms_service_request",
  "schedule_promoms_service_request",
  "admin_set_massage_therapist_capability",
  "submit_massage_adjustment",
  "review_massage_adjustment",
].forEach((rpc) => assert.ok(cloud.includes(`\"${rpc}\"`), `cloud-data.js is missing RPC ${rpc}`));

[
  "is_massage_therapist",
  "massage_therapist_availability",
  "massage_booking_sessions",
  "interval '1 hour'",
  "time '09:00'",
  "time '20:00'",
  "client_has_postpartum_member_rate",
  "massage_therapist_schedule_is_available",
  "existing_contract.client_id <> p_client_id or existing_assignment.service_type::text = 'MASSAGE'",
  "interval '24 hours'",
  "when p_pricing_tier = 'POSTPARTUM_CLIENT' and p_session_count = 4",
  "new.weekly_rate := 2100.00",
].forEach((rule) => assert.ok(migration.includes(rule), `migration is missing: ${rule}`));

assert.ok(enumMigration.includes("alter type public.care_service_type add value if not exists 'MASSAGE'"), "MASSAGE enum migration is missing");
[
  "can_provide_postpartum",
  "can_provide_babysitting",
  "admin_configure_member_service_access",
  "my_caregiver_service_capabilities",
  "enforce_assignment_service_capability",
].forEach((rule) => assert.ok(permissionMigration.includes(rule), `independent permission migration is missing: ${rule}`));
assert.ok(app.includes("마사지 테라피스트\", \"다른 관리사 권한 없이 단독으로 부여"), "massage-only staff access must be supported");
assert.ok(!app.includes("마사지 테라피스트 자격은 관리사 권한과 함께 부여"), "massage access must not require postpartum or babysitting permission");
assert.ok(app.includes("function isMassageOnlyProfessional"), "massage-only public profile detection is missing");
assert.ok(app.includes("massageProfessionalHighlightsMarkup(profile"), "massage-only career and specialty panel is missing");
assert.ok(app.includes("마사지 전용 테라피스트는 평점·후기 대신 이력과 전문 분야"), "massage-only review UI guard is missing");
assert.ok(cloud.includes("hideReputationForMassageOnlyProfile"), "public massage-only ratings must be sanitized");
assert.ok(massageProfileMigration.includes("caregiver_accepts_reputation_reviews"), "massage-only database review guard is missing");
assert.ok(massageProfileMigration.includes("enforce_caregiver_review_eligibility_trigger"), "customer review trigger is missing");
assert.ok(massageProfileMigration.includes("enforce_historical_review_eligibility_trigger"), "historical review trigger is missing");
assert.ok(!app.includes("매주 같은 요일·시간"), "massage packages must not force a recurring weekday and time");
assert.ok(!app.includes("<span>변경·취소</span><strong>24시간"), "massage card must show therapist licensing instead of the change notice");

console.log("Service packages, therapist weekly availability, buffered slots, dedicated calendars, and approval workflow checks passed.");
