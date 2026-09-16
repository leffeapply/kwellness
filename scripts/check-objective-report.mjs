import assert from "node:assert/strict";
import {
  buildObjectiveReportModel,
  objectiveDistributionLabel,
  objectiveEventValue,
} from "../objective-report.js";

const postpartumAssignment = { id: "postpartum", serviceType: "POSTPARTUM" };
const postpartumEvents = [
  { assignmentId: "postpartum", type: "feeding", at: "2026-09-15T14:00:00Z", data: { method: "pumped", amount: 80 } },
  { assignmentId: "postpartum", type: "feeding", at: "2026-09-15T15:00:00Z", data: { method: "breast", amount: 0 } },
  { assignmentId: "postpartum", type: "temperature", at: "2026-09-15T16:00:00Z", data: { value: 36.8 } },
  { assignmentId: "postpartum", type: "weight", at: "2026-09-15T17:00:00Z", data: { value: 4.1 } },
  { assignmentId: "postpartum", type: "weight", at: "2026-09-16T17:00:00Z", data: { value: 4.2 } },
];
const postpartum = buildObjectiveReportModel({
  assignment: postpartumAssignment,
  events: postpartumEvents,
  sessions: [],
  range: "week",
  anchorDate: "2026-09-16",
});

assert.equal(postpartum.totals.feedingMl, 80);
assert.equal(postpartum.totals.feedingMeasuredCount, 1);
assert.equal(postpartum.totals.feedingUnmeasuredCount, 1);
assert.equal(postpartum.totals.temperatureAverage, 36.8);
assert.equal(postpartum.totals.weightDelta, 0.1);
assert.match(postpartum.facts.join(" "), /수유량이 없는 1건은 합계에 넣지 않았습니다/);
assert.doesNotMatch(postpartum.facts.join(" "), /정상|위험|호전|악화|건강/);
assert.equal(objectiveEventValue(postpartumEvents[2]), "36.8℃");
assert.equal(objectiveEventValue(postpartumEvents[1]), "직접 수유 · 양 미입력");

const babysittingAssignment = { id: "babysitting", serviceType: "BABYSITTING" };
const babysittingEvents = [
  { assignmentId: "babysitting", type: "meal", at: "2026-09-15T16:00:00Z", data: { mealType: "점심", appetite: "보통", menu: "야채죽" } },
  { assignmentId: "babysitting", type: "sitter_note", at: "2026-09-15T18:00:00Z", data: { category: "산책", text: "25분 산책" } },
];
const babysitting = buildObjectiveReportModel({
  assignment: babysittingAssignment,
  events: babysittingEvents,
  sessions: [],
  range: "day",
  anchorDate: "2026-09-15",
});

assert.equal(babysitting.totals.mealCount, 1);
assert.equal(babysitting.totals.activityCount, 1);
assert.equal(objectiveDistributionLabel(babysitting.totals.activityDistribution), "산책 1건");
assert.doesNotMatch(babysitting.facts.join(" "), /25분/);
assert.match(babysitting.facts.join(" "), /직접 작성한 메모에서 횟수·시간·양을 임의로 계산하지 않았습니다/);

console.log("Objective report checks passed.");
