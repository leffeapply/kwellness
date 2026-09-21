import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  careEventMatchesAssignment,
  careEventTypeAllowedForService,
  normalizeCareServiceType,
} from "../care-service-scope.js";
import { buildObjectiveReportModel } from "../objective-report.js";

const postpartum = { id: "assignment-postpartum", serviceType: "POSTPARTUM", clientId: "client-one", babyId: "baby-one", startAt: "2026-09-01T09:00:00-04:00", endAt: "2026-09-14T17:00:00-04:00", daysOfWeek: ["월", "화", "수", "목", "금"] };
const babysitting = { id: "assignment-babysitting", serviceType: "BABYSITTING", clientId: "client-one", babyId: "baby-one", startAt: "2026-09-01T09:00:00-04:00", endAt: "2026-09-14T17:00:00-04:00", daysOfWeek: ["월", "화", "수", "목", "금"] };
const sessions = [
  { id: "session-postpartum", assignmentId: postpartum.id, serviceDate: "2026-09-08", status: "COMPLETED", startedAt: "2026-09-08T09:00:00-04:00", endedAt: "2026-09-08T17:00:00-04:00" },
  { id: "session-babysitting", assignmentId: babysitting.id, serviceDate: "2026-09-08", status: "COMPLETED", startedAt: "2026-09-08T09:00:00-04:00", endedAt: "2026-09-08T17:00:00-04:00" },
];
const events = [
  { id: "feeding-correct", careSessionId: "session-postpartum", assignmentId: postpartum.id, clientId: "client-one", babyId: "baby-one", type: "feeding", at: "2026-09-08T10:00:00-04:00", data: { method: "formula", amount: 60 } },
  { id: "meal-correct", careSessionId: "session-babysitting", assignmentId: babysitting.id, clientId: "client-one", babyId: "baby-one", type: "meal", at: "2026-09-08T12:00:00-04:00", data: { mealType: "식사" } },
  { id: "wrong-type", careSessionId: "session-postpartum", assignmentId: postpartum.id, clientId: "client-one", babyId: "baby-one", type: "meal", at: "2026-09-08T12:00:00-04:00", data: {} },
  { id: "wrong-session", careSessionId: "session-postpartum", assignmentId: babysitting.id, clientId: "client-one", babyId: "baby-one", type: "meal", at: "2026-09-08T13:00:00-04:00", data: {} },
];

assert.equal(normalizeCareServiceType("babysitting"), "BABYSITTING");
assert.equal(normalizeCareServiceType("unknown"), null);
assert.equal(careEventTypeAllowedForService("POSTPARTUM", "feeding"), true);
assert.equal(careEventTypeAllowedForService("POSTPARTUM", "meal"), false);
assert.equal(careEventTypeAllowedForService("BABYSITTING", "meal"), true);
assert.equal(careEventTypeAllowedForService("BABYSITTING", "feeding"), false);
assert.equal(careEventMatchesAssignment(events[0], postpartum, sessions), true);
assert.equal(careEventMatchesAssignment(events[0], babysitting, sessions), false);
assert.equal(careEventMatchesAssignment(events[2], postpartum, sessions), false);
assert.equal(careEventMatchesAssignment(events[3], babysitting, sessions), false);

const postpartumReport = buildObjectiveReportModel({ assignment: postpartum, events, sessions });
const babysittingReport = buildObjectiveReportModel({ assignment: babysitting, events, sessions });
assert.deepEqual(postpartumReport.events.map((event) => event.id), ["feeding-correct"]);
assert.deepEqual(babysittingReport.events.map((event) => event.id), ["meal-correct"]);

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const automaticSessionMigration = await readFile(new URL("../supabase/migrations/049_automatic_care_event_sessions.sql", import.meta.url), "utf8");
assert.doesNotMatch(appSource, /assignmentOverride \|\| activeAssignmentContext/);
assert.match(appSource, /careEventMatchesAssignment\(event, assignment, state\.careSessions \|\| \[\]\)/);
assert.match(appSource, /saveCareEventCloud\(\{ assignmentId: form\.dataset\.assignmentId/);
assert.match(automaticSessionMigration, /target_assignment\.service_type::text = 'BABYSITTING'/);
assert.match(automaticSessionMigration, /target_assignment\.service_type::text = 'POSTPARTUM'/);

console.log("Care service boundary checks passed.");
