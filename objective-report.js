export const OBJECTIVE_REPORT_TIME_ZONE = "America/New_York";

export const OBJECTIVE_REPORT_RANGES = Object.freeze({
  day: { days: 1, label: "1일" },
  week: { days: 7, label: "7일" },
  month: { days: 30, label: "30일" },
});

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const DATE_KEY_FORMATTERS = new Map();
const TIME_LABEL_FORMATTERS = new Map();

export function normalizedReportTimeZone(value = OBJECTIVE_REPORT_TIME_ZONE) {
  const candidate = String(value || OBJECTIVE_REPORT_TIME_ZONE);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (_error) {
    return OBJECTIVE_REPORT_TIME_ZONE;
  }
}

function dateKeyFormatter(timeZone) {
  const normalized = normalizedReportTimeZone(timeZone);
  if (!DATE_KEY_FORMATTERS.has(normalized)) {
    DATE_KEY_FORMATTERS.set(normalized, new Intl.DateTimeFormat("en-US", {
      timeZone: normalized,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }));
  }
  return DATE_KEY_FORMATTERS.get(normalized);
}

function timeLabelFormatter(timeZone) {
  const normalized = normalizedReportTimeZone(timeZone);
  if (!TIME_LABEL_FORMATTERS.has(normalized)) {
    TIME_LABEL_FORMATTERS.set(normalized, new Intl.DateTimeFormat("ko-KR", {
      timeZone: normalized,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }));
  }
  return TIME_LABEL_FORMATTERS.get(normalized);
}

function numericValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function measuredFeedingAmount(event) {
  const amount = numericValue(event?.data?.amount);
  if (amount === null || amount < 0) return null;
  // The entry form stores 0 as the sentinel for an unmeasured direct
  // breastfeeding session. It must never be reported as a measured 0 ml.
  if (event?.data?.method === "breast" && amount <= 0) return null;
  return amount;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values, digits = 1) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, digits);
}

function partsToDateKey(parts) {
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function objectiveDateKey(value, timeZone = OBJECTIVE_REPORT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return partsToDateKey(dateKeyFormatter(timeZone).formatToParts(date));
}

export function objectiveDateLabel(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return "날짜 미등록";
  return DATE_LABEL_FORMATTER.format(new Date(`${dateKey}T12:00:00Z`));
}

export function objectiveTimeLabel(value, timeZone = OBJECTIVE_REPORT_TIME_ZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 미등록";
  return timeLabelFormatter(timeZone).format(date);
}

export function objectiveEventTimeZone(event) {
  return normalizedReportTimeZone(event?.serviceTimeZone || event?.data?.recordedTimeZone);
}

export function objectiveEventDateKey(event) {
  const recordedDate = String(event?.data?.recordedLocalDate || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(recordedDate)
    ? recordedDate
    : objectiveDateKey(event?.at, objectiveEventTimeZone(event));
}

function normalizedAnchorDate(anchorDate, events = []) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(anchorDate || ""))) return anchorDate;
  const latestEvent = [...events]
    .filter((event) => event?.at && !Number.isNaN(new Date(event.at).getTime()))
    .sort((first, second) => new Date(second.at) - new Date(first.at))[0];
  return latestEvent ? objectiveEventDateKey(latestEvent) : objectiveDateKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function dateKeysEndingAt(anchorDate, days) {
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCDate(anchor.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

function countBy(values) {
  return values.reduce((counts, rawValue) => {
    const value = String(rawValue || "미입력").trim() || "미입력";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

export function objectiveDistributionLabel(distribution) {
  const entries = Object.entries(distribution || {}).sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], "ko"));
  return entries.length ? entries.map(([label, count]) => `${label} ${count}건`).join(" · ") : "기록 없음";
}

function sessionMinutesForDate(sessions, assignmentId, dateKey) {
  const durations = sessions
    .filter((session) => session.assignmentId === assignmentId && session.serviceDate === dateKey && session.status === "COMPLETED" && session.startedAt && session.endedAt)
    .map((session) => Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 60000))
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);
  return durations.length ? durations.reduce((sum, minutes) => sum + minutes, 0) : null;
}

function invalidMetricCount(events) {
  return events.reduce((count, event) => {
    const data = event.data || {};
    if (event.type === "feeding") {
      const amountInvalid = data.amount !== "" && data.amount !== null && data.amount !== undefined && (numericValue(data.amount) === null || numericValue(data.amount) < 0);
      const durationInvalid = data.duration !== "" && data.duration !== null && data.duration !== undefined && (numericValue(data.duration) === null || numericValue(data.duration) < 0);
      return count + Number(amountInvalid) + Number(durationInvalid);
    }
    if (event.type === "sleep") return count + Number(numericValue(data.duration) === null || numericValue(data.duration) < 0);
    if (event.type === "temperature" || event.type === "weight") return count + Number(numericValue(data.value) === null);
    if (event.type === "bath" && data.waterTemperature !== "" && data.waterTemperature !== null && data.waterTemperature !== undefined) {
      return count + Number(numericValue(data.waterTemperature) === null);
    }
    return count;
  }, 0);
}

function aggregateDay(dateKey, events, sessions, assignmentId, serviceType) {
  const dayEvents = events.filter((event) => objectiveEventDateKey(event) === dateKey);
  const feeding = dayEvents.filter((event) => event.type === "feeding");
  const measuredFeeding = feeding.map((event) => measuredFeedingAmount(event)).filter((value) => value !== null);
  const diapers = dayEvents.filter((event) => event.type === "diaper");
  const sleepValues = dayEvents.filter((event) => event.type === "sleep").map((event) => numericValue(event.data?.duration)).filter((value) => value !== null && value >= 0);
  const temperatureValues = dayEvents.filter((event) => event.type === "temperature").map((event) => numericValue(event.data?.value)).filter((value) => value !== null);
  const weightEvents = dayEvents.filter((event) => event.type === "weight").map((event) => ({ at: event.at, value: numericValue(event.data?.value) })).filter((item) => item.value !== null).sort((first, second) => new Date(first.at) - new Date(second.at));
  const meals = dayEvents.filter((event) => event.type === "meal");
  const sitterNotes = dayEvents.filter((event) => event.type === "sitter_note");
  return {
    dateKey,
    dateLabel: objectiveDateLabel(dateKey),
    events: dayEvents,
    eventCount: dayEvents.length,
    careMinutes: sessionMinutesForDate(sessions, assignmentId, dateKey),
    feedingCount: feeding.length,
    feedingMeasuredCount: measuredFeeding.length,
    feedingUnmeasuredCount: feeding.length - measuredFeeding.length,
    feedingMl: measuredFeeding.length ? round(measuredFeeding.reduce((sum, value) => sum + value, 0), 1) : null,
    urineCount: diapers.filter((event) => event.data?.urine && event.data.urine !== "none").length,
    stoolCount: diapers.filter((event) => event.data?.stool && event.data.stool !== "none").length,
    diaperCount: diapers.length,
    sleepCount: sleepValues.length,
    sleepMinutes: sleepValues.length ? round(sleepValues.reduce((sum, value) => sum + value, 0), 1) : null,
    temperatureCount: temperatureValues.length,
    temperatureMin: temperatureValues.length ? Math.min(...temperatureValues) : null,
    temperatureAverage: average(temperatureValues, 1),
    temperatureMax: temperatureValues.length ? Math.max(...temperatureValues) : null,
    weightCount: weightEvents.length,
    lastWeight: weightEvents.length ? weightEvents.at(-1).value : null,
    bathCount: dayEvents.filter((event) => event.type === "bath").length,
    motherCareCount: dayEvents.filter((event) => event.type === "mother").length,
    noteCount: dayEvents.filter((event) => event.type === "note").length,
    mealCount: meals.length,
    mealTypeDistribution: countBy(meals.map((event) => event.data?.mealType)),
    appetiteDistribution: countBy(meals.map((event) => event.data?.appetite)),
    activityCount: sitterNotes.length,
    activityDistribution: countBy(sitterNotes.map((event) => event.data?.category)),
    safetyCount: sitterNotes.filter((event) => event.data?.category === "안전 확인").length,
    serviceType,
  };
}

function metricTotals(daily, events, serviceType) {
  const measuredFeeding = daily.reduce((sum, day) => sum + day.feedingMeasuredCount, 0);
  const feedingCount = daily.reduce((sum, day) => sum + day.feedingCount, 0);
  const feedingMlValues = daily.map((day) => day.feedingMl).filter((value) => value !== null);
  const careMinuteValues = daily.map((day) => day.careMinutes).filter((value) => value !== null);
  const temperatureValues = events.filter((event) => event.type === "temperature").map((event) => numericValue(event.data?.value)).filter((value) => value !== null);
  const weights = events.filter((event) => event.type === "weight").map((event) => ({ at: event.at, value: numericValue(event.data?.value) })).filter((item) => item.value !== null).sort((first, second) => new Date(first.at) - new Date(second.at));
  const meals = events.filter((event) => event.type === "meal");
  const sitterNotes = events.filter((event) => event.type === "sitter_note");
  const sleepValues = events.filter((event) => event.type === "sleep").map((event) => numericValue(event.data?.duration)).filter((value) => value !== null && value >= 0);
  return {
    serviceType,
    eventCount: events.length,
    recordedDays: daily.filter((day) => day.eventCount > 0).length,
    sessionDays: careMinuteValues.length,
    careMinutes: careMinuteValues.length ? careMinuteValues.reduce((sum, value) => sum + value, 0) : null,
    feedingCount,
    feedingMeasuredCount: measuredFeeding,
    feedingUnmeasuredCount: feedingCount - measuredFeeding,
    feedingMl: feedingMlValues.length ? round(feedingMlValues.reduce((sum, value) => sum + value, 0), 1) : null,
    diaperCount: daily.reduce((sum, day) => sum + day.diaperCount, 0),
    urineCount: daily.reduce((sum, day) => sum + day.urineCount, 0),
    stoolCount: daily.reduce((sum, day) => sum + day.stoolCount, 0),
    sleepCount: sleepValues.length,
    sleepMinutes: sleepValues.length ? round(sleepValues.reduce((sum, value) => sum + value, 0), 1) : null,
    sleepAverage: average(sleepValues, 1),
    temperatureCount: temperatureValues.length,
    temperatureMin: temperatureValues.length ? Math.min(...temperatureValues) : null,
    temperatureAverage: average(temperatureValues, 1),
    temperatureMax: temperatureValues.length ? Math.max(...temperatureValues) : null,
    weightCount: weights.length,
    firstWeight: weights.length ? weights[0].value : null,
    lastWeight: weights.length ? weights.at(-1).value : null,
    weightDelta: weights.length >= 2 ? round(weights.at(-1).value - weights[0].value, 2) : null,
    bathCount: daily.reduce((sum, day) => sum + day.bathCount, 0),
    motherCareCount: daily.reduce((sum, day) => sum + day.motherCareCount, 0),
    noteCount: daily.reduce((sum, day) => sum + day.noteCount, 0),
    mealCount: meals.length,
    appetiteDistribution: countBy(meals.map((event) => event.data?.appetite)),
    mealTypeDistribution: countBy(meals.map((event) => event.data?.mealType)),
    activityCount: sitterNotes.length,
    activityDistribution: countBy(sitterNotes.map((event) => event.data?.category)),
    safetyCount: sitterNotes.filter((event) => event.data?.category === "안전 확인").length,
  };
}

function buildPostpartumFacts(totals) {
  const facts = [
    `선택한 기간 중 ${totals.recordedDays}일에 관리사가 총 ${totals.eventCount}건의 케어 기록을 남겼습니다.`,
  ];
  if (totals.careMinutes !== null) facts.push(`완료된 근무 ${totals.sessionDays}일의 시작·종료 시간을 더하면 총 ${totals.careMinutes}분입니다.`);
  else facts.push("선택한 기간에는 시작 시간과 종료 시간이 모두 입력된 완료 근무가 없어 총 근무시간을 계산하지 않았습니다.");
  if (totals.feedingCount) {
    facts.push(`수유 기록 ${totals.feedingCount}건 중 수유량이 입력된 ${totals.feedingMeasuredCount}건의 합계는 ${totals.feedingMl ?? 0}ml입니다. 수유량이 없는 ${totals.feedingUnmeasuredCount}건은 합계에 넣지 않았습니다.`);
  } else facts.push("선택 기간에 수유 기록이 없습니다.");
  if (totals.sleepCount) facts.push(`수면 기록 ${totals.sleepCount}건을 더하면 총 ${totals.sleepMinutes}분이며, 기록 1건당 평균은 ${totals.sleepAverage}분입니다.`);
  else facts.push("선택 기간에 수면시간 기록이 없습니다.");
  if (totals.temperatureCount) facts.push(`체온은 ${totals.temperatureCount}회 측정했으며, 가장 낮은 값은 ${totals.temperatureMin.toFixed(1)}℃, 가장 높은 값은 ${totals.temperatureMax.toFixed(1)}℃, 측정값 평균은 ${totals.temperatureAverage.toFixed(1)}℃입니다.`);
  else facts.push("선택 기간에 체온 측정 기록이 없습니다.");
  if (totals.weightCount >= 2) facts.push(`체중은 ${totals.weightCount}회 측정했으며, 첫 측정값은 ${totals.firstWeight.toFixed(2)}kg, 마지막 측정값은 ${totals.lastWeight.toFixed(2)}kg입니다. 두 값의 차이는 ${totals.weightDelta > 0 ? "+" : ""}${totals.weightDelta.toFixed(2)}kg입니다.`);
  else if (totals.weightCount === 1) facts.push(`체중은 ${totals.lastWeight.toFixed(2)}kg으로 1회 측정되어 변화량을 계산하지 않았습니다.`);
  else facts.push("선택 기간에 체중 기록이 없습니다.");
  facts.push(`기저귀 확인 ${totals.diaperCount}건 중 소변 표시 ${totals.urineCount}건, 대변 표시 ${totals.stoolCount}건이 입력되었습니다.`);
  facts.push(`목욕 ${totals.bathCount}건, 산모 케어 ${totals.motherCareCount}건, 일반 메모 ${totals.noteCount}건이 기록되었습니다.`);
  return facts;
}

function buildBabysittingFacts(totals) {
  const facts = [
    `선택한 기간 중 ${totals.recordedDays}일에 관리사가 총 ${totals.eventCount}건의 시팅 기록을 남겼습니다.`,
  ];
  if (totals.careMinutes !== null) facts.push(`완료된 근무 ${totals.sessionDays}일의 시작·종료 시간을 더하면 총 ${totals.careMinutes}분입니다.`);
  else facts.push("선택한 기간에는 시작 시간과 종료 시간이 모두 입력된 완료 근무가 없어 총 근무시간을 계산하지 않았습니다.");
  facts.push(totals.mealCount
    ? `식사·간식 기록은 ${totals.mealCount}건이며, 관리사가 입력한 섭취량은 ${objectiveDistributionLabel(totals.appetiteDistribution)}입니다.`
    : "선택 기간에 식사·간식 기록이 없습니다.");
  facts.push(totals.activityCount
    ? `놀이·산책 등 생활 기록은 ${totals.activityCount}건이며, 기록 종류는 ${objectiveDistributionLabel(totals.activityDistribution)}입니다.`
    : "선택 기간에 놀이·산책 등 생활 기록이 없습니다.");
  facts.push(`‘안전 확인’으로 입력된 기록은 ${totals.safetyCount}건입니다. 관리사가 직접 작성한 메모에서 횟수·시간·양을 임의로 계산하지 않았습니다.`);
  return facts;
}

export function buildObjectiveReportModel({ assignment, events = [], sessions = [], range = "week", anchorDate = "" }) {
  const serviceType = assignment?.serviceType === "BABYSITTING" ? "BABYSITTING" : "POSTPARTUM";
  const allowedTypes = serviceType === "BABYSITTING"
    ? new Set(["meal", "sitter_note"])
    : new Set(["feeding", "diaper", "sleep", "temperature", "bath", "weight", "mother", "note"]);
  const assignmentEvents = events.filter((event) => event.assignmentId === assignment?.id && allowedTypes.has(event.type));
  const normalizedRange = OBJECTIVE_REPORT_RANGES[range] ? range : "week";
  const normalizedAnchor = normalizedAnchorDate(anchorDate, assignmentEvents);
  const dateKeys = dateKeysEndingAt(normalizedAnchor, OBJECTIVE_REPORT_RANGES[normalizedRange].days);
  const dateKeySet = new Set(dateKeys);
  const periodEvents = assignmentEvents.filter((event) => dateKeySet.has(objectiveEventDateKey(event))).sort((first, second) => new Date(first.at) - new Date(second.at));
  const daily = dateKeys.map((dateKey) => aggregateDay(dateKey, periodEvents, sessions, assignment?.id, serviceType));
  const totals = metricTotals(daily, periodEvents, serviceType);
  return {
    version: "objective-v1",
    timeZone: [...new Set(periodEvents.map(objectiveEventTimeZone))].join(", ") || OBJECTIVE_REPORT_TIME_ZONE,
    serviceType,
    range: normalizedRange,
    rangeLabel: OBJECTIVE_REPORT_RANGES[normalizedRange].label,
    anchorDate: normalizedAnchor,
    fromDate: dateKeys[0],
    toDate: dateKeys.at(-1),
    dateKeys,
    daily,
    events: periodEvents,
    totals,
    dataQuality: {
      invalidMetricCount: invalidMetricCount(periodEvents),
      freeTextExcludedFromMetrics: periodEvents.filter((event) => ["note", "sitter_note"].includes(event.type) || event.data?.note || event.data?.text).length,
    },
    facts: serviceType === "BABYSITTING" ? buildBabysittingFacts(totals) : buildPostpartumFacts(totals),
  };
}

export function objectiveEventValue(event) {
  const data = event?.data || {};
  const text = (value, fallback = "미입력") => String(value ?? "").trim() || fallback;
  switch (event?.type) {
    case "feeding": {
      const method = { breast: "직접 수유", pumped: "유축 모유", formula: "분유" }[data.method] || text(data.method, "수유 방식 미입력");
      const amount = measuredFeedingAmount(event);
      const duration = numericValue(data.duration);
      return amount !== null ? `${method} · ${amount} ml` : duration !== null ? `${method} · ${duration}분` : `${method} · 양 미입력`;
    }
    case "diaper":
      return `소변 ${text(data.urine)} · 대변 ${text(data.stool)}${data.color ? ` · 색상 ${text(data.color)}` : ""}`;
    case "sleep": {
      const duration = numericValue(data.duration);
      return duration === null ? "수면시간 미입력" : `${duration}분`;
    }
    case "temperature": {
      const value = numericValue(data.value);
      return value === null ? "측정값 미입력" : `${value.toFixed(1)}℃`;
    }
    case "bath": {
      const water = numericValue(data.waterTemperature);
      return `${text(data.bathType, "목욕")}${water === null ? "" : ` · 물 온도 ${water.toFixed(1)}℃`}${data.note ? ` · 입력 메모: ${text(data.note)}` : ""}`;
    }
    case "weight": {
      const value = numericValue(data.value);
      return value === null ? "측정값 미입력" : `${value.toFixed(2)}kg`;
    }
    case "mother":
      return `${text(data.care, "산모 케어")}${data.note ? ` · 입력 메모: ${text(data.note)}` : ""}`;
    case "meal":
      return `${text(data.mealType, "식사")}${data.menu ? ` · 메뉴 ${text(data.menu)}` : ""}${data.appetite ? ` · 섭취 상태 ${text(data.appetite)}` : ""}${data.note ? ` · 입력 메모: ${text(data.note)}` : ""}`;
    case "sitter_note":
      return `${text(data.category, "생활 기록")} · 입력 메모: ${text(data.text)}`;
    case "note":
      return `입력 메모: ${text(data.text)}`;
    default:
      return "입력 내용 없음";
  }
}
