import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildObjectiveReportModel,
  celsiusFrom,
  fahrenheitFromCelsius,
  formatDualTemperature,
  formatDualVolume,
  formatDualWeight,
  kilogramsFrom,
  objectiveDistributionLabel,
  objectiveEventDateKey,
  objectiveEventTimeZone,
  objectiveEventValue,
  objectiveTimeLabel,
  ouncesFromMl,
  poundsFromKilograms,
  volumeToMl,
} from "../objective-report.js";

const postpartumAssignment = {
  id: "postpartum",
  serviceType: "POSTPARTUM",
  startAt: "2020-09-01T13:00:00Z",
  endAt: "2020-09-07T21:00:00Z",
  contractStartDate: "2020-08-01",
  contractEndDate: "2020-09-30",
  daysOfWeek: ["월", "화", "수", "목", "금"],
};
const postpartumEvents = [
  { assignmentId: "postpartum", type: "feeding", at: "2020-09-01T14:00:00Z", data: { method: "pumped", amount: 80 } },
  { assignmentId: "postpartum", type: "feeding", at: "2020-09-01T15:00:00Z", data: { method: "breast", duration: 15, side: "both" } },
  { assignmentId: "postpartum", type: "temperature", at: "2020-09-01T16:00:00Z", data: { value: 36.8 } },
  { assignmentId: "postpartum", type: "weight", at: "2020-09-01T17:00:00Z", data: { value: 4.1 } },
  { assignmentId: "postpartum", type: "weight", at: "2020-09-01T18:00:00Z", data: { value: 4.2 } },
  { assignmentId: "postpartum", type: "note", at: "2020-09-06T18:00:00Z", data: { text: "예외 일요일 소급 보완 기록" } },
  { assignmentId: "postpartum", type: "note", at: "2020-08-31T18:00:00Z", data: { text: "배치 시작 전 기록" } },
  { assignmentId: "postpartum", type: "note", at: "2020-09-08T18:00:00Z", data: { text: "배치 종료 후 기록" } },
  { assignmentId: "postpartum", type: "meal", at: "2020-09-05T18:00:00Z", data: { mealType: "점심" } },
  { assignmentId: "different-assignment", type: "temperature", at: "2020-09-05T18:00:00Z", data: { value: 37.1 } },
];
const postpartumSessions = [
  { assignmentId: "postpartum", serviceDate: "2020-09-01", serviceTimeZone: "America/New_York", status: "COMPLETED", startedAt: "2020-09-01T13:00:00Z", endedAt: "2020-09-01T21:00:00Z" },
  { assignmentId: "postpartum", serviceDate: "2020-09-02", serviceTimeZone: "America/New_York", status: "IN_PROGRESS", startedAt: "2020-09-02T13:00:00Z", endedAt: null },
  { assignmentId: "postpartum", serviceDate: "2020-09-05", serviceTimeZone: "America/New_York", status: "SCHEDULED", startedAt: null, endedAt: null },
  { assignmentId: "postpartum", serviceDate: "2020-09-05", serviceTimeZone: "America/New_York", status: "CANCELLED", startedAt: "2020-09-05T13:00:00Z", endedAt: null },
  { assignmentId: "postpartum", serviceDate: "2020-08-31", serviceTimeZone: "America/New_York", status: "COMPLETED", startedAt: "2020-08-31T13:00:00Z", endedAt: "2020-08-31T21:00:00Z" },
  { assignmentId: "different-assignment", serviceDate: "2020-09-05", status: "COMPLETED", startedAt: "2020-09-05T13:00:00Z", endedAt: "2020-09-05T21:00:00Z" },
];
const postpartum = buildObjectiveReportModel({
  assignment: postpartumAssignment,
  events: postpartumEvents,
  sessions: postpartumSessions,
});

assert.equal(postpartum.version, "objective-batch-v1");
assert.equal(postpartum.range, "batch");
assert.equal(postpartum.rangeLabel, "서비스 배치 전체");
assert.equal(postpartum.fromDate, "2020-09-01");
assert.equal(postpartum.toDate, "2020-09-07");
assert.equal(postpartum.serviceFromDate, "2020-09-01");
assert.equal(postpartum.serviceToDate, "2020-09-07");
assert.deepEqual(postpartum.dateKeys, ["2020-09-01", "2020-09-02", "2020-09-03", "2020-09-04", "2020-09-06", "2020-09-07"]);
assert.equal(postpartum.daily.find((day) => day.dateKey === "2020-09-03")?.eventCount, 0);
assert.equal(postpartum.daily.find((day) => day.dateKey === "2020-09-03")?.feedingCount, 0);
assert.equal(postpartum.daily.find((day) => day.dateKey === "2020-09-03")?.sessionCount, 0);
assert.equal(postpartum.daily.find((day) => day.dateKey === "2020-09-03")?.isScheduledServiceDay, true);
assert.equal(postpartum.daily.some((day) => day.dateKey === "2020-09-05"), false);
assert.equal(postpartum.daily.find((day) => day.dateKey === "2020-09-06")?.isExceptionServiceDay, true);
assert.equal(postpartum.daily.find((day) => day.dateKey === "2020-09-06")?.sessionCount, 0);
assert.equal(postpartum.totals.serviceDays, 6);
assert.equal(postpartum.totals.scheduledServiceDays, 5);
assert.equal(postpartum.totals.providedSessionDays, 2);
assert.equal(postpartum.totals.recordOnlyDays, 1);
assert.equal(postpartum.totals.unrecordedScheduledDays, 3);
assert.equal("careMinutes" in postpartum.totals, false);
assert.equal("careMinutes" in postpartum.daily[0], false);
assert.equal(postpartum.events.length, 6);
assert.equal(postpartum.totals.feedingMl, 80);
assert.equal(postpartum.totals.feedingMeasuredCount, 1);
assert.equal(postpartum.totals.breastfeedingDurationCount, 1);
assert.equal(postpartum.totals.breastfeedingMinutes, 15);
assert.equal(postpartum.totals.feedingUnmeasuredCount, 0);
assert.equal(postpartum.totals.temperatureAverage, 36.8);
assert.equal(postpartum.totals.weightDelta, 0.1);
assert.match(postpartum.facts.join(" "), /직접 모유수유 1건의 합계 15분/);
assert.match(postpartum.facts.join(" "), /서비스일 6일 중 2일/);
assert.match(postpartum.facts.join(" "), /예정 서비스일은 3일이며, 해당 날짜는 관리사 기록 0건/);
assert.doesNotMatch(postpartum.facts.join(" "), /근무시간|시작·종료 시간/);
assert.doesNotMatch(postpartum.facts.join(" "), /정상|위험|호전|악화|건강/);
assert.equal(objectiveEventValue(postpartumEvents[2]), "36.8℃ (98.2℉)");
assert.equal(objectiveEventValue(postpartumEvents[1]), "직접 모유수유 · 15분");
assert.equal(formatDualVolume(80), "80 ml (2.71 oz)");
assert.equal(formatDualVolume(80, "oz"), "2.71 oz (80 ml)");
assert.equal(formatDualTemperature(36.8), "36.8℃ (98.2℉)");
assert.equal(formatDualWeight(4.1), "4.1 kg (9.04 lb)");
assert.equal(objectiveEventValue({ type: "bath", data: { bathType: "전신 목욕", waterTemperature: 38 } }), "전신 목욕 · 물 온도 38℃ (100.4℉)");
assert.equal(volumeToMl(2.71, "oz"), 80.14);
assert.equal(celsiusFrom(98.6, "f"), 37);
assert.ok(Math.abs(kilogramsFrom(9.04, "lb") - 4.1) < 0.01);
assert.equal(ouncesFromMl(80), 2.7051);
assert.equal(fahrenheitFromCelsius(36.8), 98.24);
assert.equal(poundsFromKilograms(4.1), 9.039);

const babysittingAssignment = { id: "babysitting", serviceType: "BABYSITTING" };
const babysittingEvents = [
  { assignmentId: "babysitting", type: "meal", at: "2026-09-15T16:00:00Z", data: { mealType: "점심", appetite: "보통", menu: "야채죽" } },
  { assignmentId: "babysitting", type: "sitter_note", at: "2026-09-15T18:00:00Z", data: { category: "산책", text: "25분 산책" } },
];
const babysitting = buildObjectiveReportModel({
  assignment: babysittingAssignment,
  events: babysittingEvents,
  sessions: [],
});

assert.equal(babysitting.totals.mealCount, 1);
assert.equal(babysitting.totals.activityCount, 1);
assert.equal(objectiveDistributionLabel(babysitting.totals.activityDistribution), "산책 1건");
assert.doesNotMatch(babysitting.facts.join(" "), /25분/);
assert.match(babysitting.facts.join(" "), /직접 작성한 메모에서 횟수·시간·양을 임의로 계산하지 않았습니다/);

const emptyBatch = buildObjectiveReportModel({
  assignment: { id: "empty", serviceType: "POSTPARTUM", startAt: "2099-10-01T13:00:00Z", endAt: "2099-10-14T21:00:00Z", contractStartDate: "2099-09-01", contractEndDate: "2099-11-30", daysOfWeek: ["월", "화", "수", "목", "금"] },
  events: postpartumEvents,
  sessions: postpartumSessions,
});

assert.deepEqual(emptyBatch.dateKeys, []);
assert.deepEqual(emptyBatch.daily, []);
assert.equal(emptyBatch.fromDate, "2099-10-01");
assert.equal(emptyBatch.toDate, "2099-10-14");
assert.equal(emptyBatch.serviceFromDate, null);
assert.equal(emptyBatch.serviceToDate, null);
assert.equal(emptyBatch.totals.serviceDays, 0);

const legacyStartedBatch = buildObjectiveReportModel({
  assignment: { id: "legacy-started", serviceType: "POSTPARTUM" },
  events: [],
  sessions: [
    { assignmentId: "legacy-started", serviceDate: null, serviceTimeZone: "America/New_York", status: "SCHEDULED", startedAt: "2020-09-08T13:00:00Z", endedAt: null },
    { assignmentId: "legacy-started", serviceDate: "2020-09-09", serviceTimeZone: "America/New_York", status: "CANCELLED", startedAt: "2020-09-09T13:00:00Z", endedAt: null },
    { assignmentId: "legacy-started", serviceDate: "2020-09-10", serviceTimeZone: "America/New_York", status: "SCHEDULED", startedAt: null, endedAt: null },
  ],
});

assert.deepEqual(legacyStartedBatch.dateKeys, ["2020-09-08"]);
assert.equal(legacyStartedBatch.daily[0].sessionCount, 1);
assert.equal(legacyStartedBatch.fromDate, "2020-09-08");
assert.equal(legacyStartedBatch.toDate, "2020-09-08");

const reassignedOldBatch = buildObjectiveReportModel({
  assignment: {
    id: "reassigned-old",
    serviceType: "POSTPARTUM",
    startAt: "2020-09-01T13:00:00Z",
    endAt: "2020-09-04T12:59:59Z",
    dailyStart: "09:00",
    dailyEnd: "17:00",
    daysOfWeek: ["월", "화", "수", "목", "금"],
  },
  events: [],
  sessions: [],
});

assert.deepEqual(reassignedOldBatch.dateKeys, ["2020-09-01", "2020-09-02", "2020-09-03"]);
assert.equal(reassignedOldBatch.toDate, "2020-09-04");

const lateStartBatch = buildObjectiveReportModel({
  assignment: {
    id: "late-start",
    serviceType: "POSTPARTUM",
    startAt: "2020-09-04T21:01:00Z",
    endAt: "2020-09-07T21:00:00Z",
    dailyStart: "09:00",
    dailyEnd: "17:00",
    daysOfWeek: ["월", "화", "수", "목", "금"],
  },
  events: [],
  sessions: [],
});

assert.deepEqual(lateStartBatch.dateKeys, ["2020-09-07"]);

const koreaAssignment = { id: "korea-postpartum", serviceType: "POSTPARTUM" };
const koreaEvents = [
  {
    assignmentId: "korea-postpartum",
    serviceTimeZone: "Asia/Seoul",
    type: "temperature",
    at: "2026-09-15T14:30:00Z",
    data: { value: 36.7, recordedTimeZone: "Asia/Seoul" },
  },
  {
    assignmentId: "korea-postpartum",
    serviceTimeZone: "Asia/Seoul",
    type: "temperature",
    at: "2026-09-15T15:30:00Z",
    data: { value: 36.8, recordedLocalDate: "2026-09-16", recordedLocalTime: "00:30", recordedTimeZone: "Asia/Seoul" },
  },
];
const koreaReport = buildObjectiveReportModel({
  assignment: koreaAssignment,
  events: koreaEvents,
  sessions: [],
});

assert.equal(objectiveEventTimeZone(koreaEvents[1]), "Asia/Seoul");
assert.equal(objectiveEventDateKey(koreaEvents[0]), "2026-09-15");
assert.equal(objectiveEventDateKey(koreaEvents[1]), "2026-09-16");
assert.equal(objectiveTimeLabel(koreaEvents[0].at, objectiveEventTimeZone(koreaEvents[0])), "오후 11:30");
assert.equal(objectiveTimeLabel(koreaEvents[1].at, objectiveEventTimeZone(koreaEvents[1])), "오전 12:30");
assert.equal(koreaReport.daily.find((day) => day.dateKey === "2026-09-15")?.eventCount, 1);
assert.equal(koreaReport.daily.find((day) => day.dateKey === "2026-09-16")?.eventCount, 1);
assert.equal(koreaReport.timeZone, "Asia/Seoul");
assert.equal(koreaReport.totals.temperatureAverage, 36.8);

const koreaBoundaryReport = buildObjectiveReportModel({
  assignment: {
    id: "korea-boundary",
    serviceType: "POSTPARTUM",
    startAt: "2026-09-14T13:00:00Z",
    endAt: "2026-09-14T21:00:00Z",
    dailyStart: "09:00",
    dailyEnd: "17:00",
    daysOfWeek: ["월"],
  },
  events: [{
    assignmentId: "korea-boundary",
    serviceTimeZone: "Asia/Seoul",
    type: "temperature",
    at: "2026-09-14T15:30:00Z",
    data: { value: 36.6, recordedLocalDate: "2026-09-15", recordedLocalTime: "00:30", recordedTimeZone: "Asia/Seoul" },
  }],
  sessions: [],
});

assert.equal(koreaBoundaryReport.totals.eventCount, 1);
assert.equal(koreaBoundaryReport.daily.find((day) => day.dateKey === "2026-09-15")?.temperatureCount, 1);

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
assert.doesNotMatch(appSource, /<h2>서비스일별 기록<\/h2>/, "daily record table must not appear in the report");
assert.doesNotMatch(appSource, /측정·지원 기록/, "measurement/support table must not appear in the report");
assert.doesNotMatch(appSource, /<h2>시간별 상세 기록<\/h2>/, "hourly detail table must not appear in the report");
assert.doesNotMatch(appSource, /data-objective-report-granularity/, "removed report density controls must not return");
assert.match(appSource, /function assignmentCareEvents\(assignment\)/, "assignment-wide care events must be available");
assert.match(appSource, /function assignmentTimelineMarkup\(assignment\)/, "babysitting history must be grouped for readability");
assert.match(appSource, /배치 전체 시팅 기록/, "babysitting history heading must describe the full batch");
assert.match(appSource, /function objectiveTodaySummaryMarkup\(assignment, client, model, viewerRole = state\.role\)/, "today summary report must exist");
assert.match(appSource, /viewerRole === "client" \? \[\] : \[/, "client babysitting summary must omit operational safety and work-time cards");

const objectiveReportPageSource = appSource.slice(
  appSource.indexOf("function objectiveReportPage("),
  appSource.indexOf("function careSessionReportPreviewMarkup("),
);
assert.ok(
  objectiveReportPageSource.indexOf("objectiveTodaySummaryMarkup(assignment, client, model, role)")
    < objectiveReportPageSource.indexOf("objectiveReportBuilderMarkup(role"),
  "client and caregiver reports must show the dashboard before batch controls",
);

const adminReportsSource = appSource.slice(
  appSource.indexOf("function adminReports("),
  appSource.indexOf("function publicProductMarkup("),
);
assert.ok(
  adminReportsSource.indexOf('objectiveReportBuilderMarkup("admin"')
    < adminReportsSource.indexOf('objectiveTodaySummaryMarkup(assignment, client, objectiveModel, "admin")'),
  "admin reports must show customer and batch controls before the dashboard",
);
assert.match(appSource, /오늘의 요약 리포트/, "today summary report heading must be visible");
assert.doesNotMatch(appSource, /완료된 근무시간|완료 근무시간/, "care reports must not display removed work-duration metrics");
assert.match(stylesSource, /\.today-summary-metrics/, "today summary must have responsive metric styling");
assert.match(stylesSource, /\.batch-timeline-day/, "batch timeline must have readable day-group styling");

console.log("Objective report checks passed.");
