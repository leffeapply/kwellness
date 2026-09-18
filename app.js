import { backendStatus, supabase } from "./supabase-client.js";
import proMomsLogoUrl from "./assets/promoms-logo.png";
import {
  buildObjectiveReportModel,
  celsiusFrom,
  fahrenheitFromCelsius,
  formatDualTemperature,
  formatDualVolume,
  formatDualWeight,
  kilogramsFrom,
  OBJECTIVE_REPORT_TIME_ZONE,
  objectiveDateKey,
  objectiveDateLabel,
  objectiveEventDateKey,
  objectiveEventTimeZone,
  objectiveTimeLabel,
  ouncesFromMl,
  poundsFromKilograms,
  volumeToMl,
} from "./objective-report.js";
import {
  approveCaregiverCloud,
  addHistoricalReviewEvidenceCloud,
  addServiceReviewPhotosCloud,
  archiveMemberCloud,
  archiveServiceRequestCloud,
  cloudEnabled,
  createHistoricalCaregiverReviewCloud,
  currentCloudSession,
  deleteMassageAvailabilityCloud,
  loadCloudState,
  loadMassageAvailableSlotsCloud,
  loadPublicCaregiverDirectoryCloud,
  publishCareReportCloud,
  reassignCaregiverCloud,
  recordApprovedRequestDepositEvidenceCloud,
  recordRetrospectiveCareReportCloud,
  recordServiceBalancePaymentCloud,
  recordServiceRefundCloud,
  recordMyCurrentConsentsCloud,
  requestPasswordResetCloud,
  reviewServiceAdjustmentCloud,
  reviewServiceRequestCloud,
  saveServiceReviewCloud,
  saveCareEventCloud,
  scheduleServiceRequestCloud,
  saveCareShiftChecklistCloud,
  setCareSessionStatusCloud,
  configureMemberServiceAccessCloud,
  setMemberStatusCloud,
  setCaregiverReviewPublicationCloud,
  setCaregiverReviewValidityCloud,
  setHistoricalReviewPublicationCloud,
  signInCloud,
  signOutCloud,
  signUpCloud,
  submitServiceRequestCloud,
  submitMassageServiceRequestCloud,
  submitServiceAdjustmentCloud,
  submitMassageAdjustmentCloud,
  reviewMassageAdjustmentCloud,
  reviewMassageBookingChangeCloud,
  saveMassageAvailabilityCloud,
  updateCaregiverManagementCloud,
  updateCaregiverPublicProfileCloud,
  updateCareEventCloud,
  updateClientManagementCloud,
  updateMyClientProfileCloud,
  updateMyProfileCloud,
  updatePasswordCloud,
  uploadCaregiverPublicPhotoCloud,
  submitMassageBookingChangeCloud,
} from "./cloud-data.js";

(function () {
  "use strict";

  function brandLogoMarkup(full = false) {
    const viewBox = full ? "145 290 955 800" : "300 295 650 465";
    return `<svg class="promoms-logo ${full ? "promoms-logo-full" : "promoms-logo-symbol"}" viewBox="${viewBox}" ${full ? 'role="img" aria-label="ProMoms 프로맘스 — 엄마 곁의 전문가"' : 'aria-hidden="true" focusable="false"'}><image href="${proMomsLogoUrl}" width="1254" height="1254" /></svg>`;
  }

  const STORAGE_KEY = "promoms-care-preview-v1";
  const CLOUD_PREFS_KEY = "promoms-care-preferences-v1";

  const ROLE_META = {
    admin: { label: "관리자", name: "운영 관리자", initials: "운" },
    caregiver: { label: "관리사", name: "관리사", initials: "관" },
    therapist: { label: "마사지 테라피스트", name: "마사지 테라피스트", initials: "마" },
    client: { label: "고객", name: "고객", initials: "고" },
    retail: { label: "리테일 직원", name: "리테일 직원", initials: "리" },
  };

  const SERVICE_META = {
    POSTPARTUM: { label: "산후조리", shortLabel: "산후조리", icon: "♡", tone: "postpartum", description: "산모 회복과 신생아 일상 케어" },
    BABYSITTING: { label: "베이비시팅", shortLabel: "베이비시팅", icon: "☆", tone: "babysitting", description: "식사·놀이·생활 중심 돌봄" },
    MASSAGE: { label: "산전·산후 마사지", shortLabel: "마사지", icon: "✦", tone: "massage", description: "전문 테라피스트의 산전·산후 회복 관리" },
  };

  const POSTPARTUM_WEEKLY_RATE = 1800;
  const POSTPARTUM_LIVE_IN_WEEKLY_RATE = 2100;
  const MIN_SERVICE_WEEKS = 2;
  const MIN_BABYSITTING_HOURS = 4;
  const POSTPARTUM_DEFAULT_WEEKS = 2;
  const POSTPARTUM_DEPOSIT = 500;
  const POSTPARTUM_REFUND_DAYS = 30;
  const POSTPARTUM_CARE_MINUTES = 8 * 60;
  const POSTPARTUM_MEAL_MINUTES = 60;
  const POSTPARTUM_REST_MINUTES = 30;
  const POSTPARTUM_VISIT_MINUTES = POSTPARTUM_CARE_MINUTES + POSTPARTUM_MEAL_MINUTES + POSTPARTUM_REST_MINUTES;
  const BABYSITTING_HOURLY_RATE = 32;
  const BABYSITTING_DEPOSIT = BABYSITTING_HOURLY_RATE * MIN_BABYSITTING_HOURS;
  const BABYSITTING_STANDARD_NOTICE_HOURS = 72;
  const MASSAGE_CHANGE_NOTICE_HOURS = 24;
  const MASSAGE_PRICES = Object.freeze({
    GENERAL: Object.freeze({ 60: 150, 90: 210 }),
    POSTPARTUM_CLIENT: Object.freeze({ 60: 135, 90: 190, PACKAGE_4: 520 }),
  });
  const CURRENT_CONSENT_VERSION = "2026-09-13";

  const REVIEW_COMPETENCIES = Object.freeze([
    { key: "meal_preparation", label: "식사", formLabel: "식사준비", icon: "🍳", description: "식사 품질, 메뉴 구성, 조리 능력" },
    { key: "attentiveness", label: "세심함", formLabel: "세심성", icon: "🔍", description: "산모·아기의 작은 변화와 요구 파악" },
    { key: "punctuality", label: "시간준수", formLabel: "일정준수", icon: "⏰", description: "출퇴근, 예약시간과 일정 준수" },
    { key: "professionalism", label: "전문성", formLabel: "전문성", icon: "🎓", description: "산후조리·신생아 케어 지식과 숙련도" },
    { key: "communication", label: "소통", formLabel: "소통능력", icon: "💬", description: "요청사항 이해, 상태 전달과 피드백" },
    { key: "hygiene_safety", label: "위생안전", formLabel: "위생·안전", icon: "🛡️", description: "손 위생, 주변 청결과 안전수칙 준수" },
  ]);

  const PREMIUM_ADD_ONS = {
    MASSAGE: {
      label: "산전·산후 마사지",
      icon: "✦",
      status: "ACTIVE",
      enabled: true,
      addOnOnly: false,
      licenseRequirement: "Georgia Licensed Massage Therapist",
      description: "일반 고객과 ProMoms 산후조리 예약·이용 고객 모두 신청할 수 있는 전문 회복 서비스",
    },
  };

  const NAV = {
    admin: [
      { id: "overview", label: "운영 현황", icon: "◫" },
      { id: "schedule", label: "일정·배정", icon: "◷" },
      { id: "massage", label: "마사지 일정", icon: "✦" },
      { id: "requests", label: "서비스 신청·승인", icon: "✓" },
      { id: "finance", label: "수납·수익 관리", icon: "$" },
      { id: "history", label: "서비스 히스토리", icon: "≡" },
      { id: "people", label: "고객·관리사", icon: "♙" },
      { id: "reports", label: "차트·리포트", icon: "▤" },
      { id: "retail", label: "리테일", icon: "◇" },
      { id: "analytics", label: "통합 분석", icon: "↗" },
    ],
    caregiver: [
      { id: "caregiving", label: "케어기빙 현황", icon: "⌂" },
      { id: "postpartum", label: "나의 산후조리 케어기빙", icon: "♡" },
      { id: "babysitting", label: "나의 베이비시팅 케어기빙", icon: "☆" },
      { id: "reports", label: "케어 리포트", icon: "▤" },
      { id: "profile", label: "내 정보", icon: "♙" },
    ],
    therapist: [
      { id: "availability", label: "근무 가능시간", icon: "◷" },
      { id: "calendar", label: "마사지 예약 캘린더", icon: "✦" },
    ],
    client: [
      { id: "services", label: "나의 서비스", icon: "⌂" },
      { id: "postpartum", label: "나의 산후조리", icon: "♡" },
      { id: "babysitting", label: "나의 베이비시팅", icon: "☆" },
      { id: "reports", label: "케어 리포트", icon: "▤" },
      { id: "shop", label: "ProMoms 스토어", icon: "◇" },
      { id: "purchases", label: "구매 내역", icon: "▤" },
    ],
    retail: [
      { id: "pos", label: "POS 판매", icon: "▣" },
      { id: "products", label: "상품", icon: "◇" },
      { id: "inventory", label: "재고", icon: "≋" },
      { id: "orders", label: "주문", icon: "▤" },
    ],
  };

  const EVENT_META = {
    feeding: { label: "수유", icon: "🍼", subtitle: "Feeding" },
    diaper: { label: "기저귀", icon: "🚼", subtitle: "Diaper" },
    sleep: { label: "수면", icon: "☾", subtitle: "Sleep" },
    temperature: { label: "체온", icon: "🌡️", subtitle: "Temperature" },
    bath: { label: "목욕", icon: "🫧", subtitle: "Bath" },
    weight: { label: "체중", icon: "⚖️", subtitle: "Weight" },
    mother: { label: "산모 케어", icon: "🤱", subtitle: "Mother care" },
    note: { label: "메모", icon: "✎", subtitle: "Note" },
    meal: { label: "식사", icon: "🍽️", subtitle: "Meal" },
    sitter_note: { label: "이벤트 메모", icon: "☆", subtitle: "Activity note" },
  };

  const POSTPARTUM_QUICK_ACTIONS = Object.freeze([
    { type: "feeding", preset: "breast", label: "직접 모유수유", icon: "🤱", tone: "sky" },
    { type: "feeding", preset: "pumped", label: "유축 모유", icon: "🫙", tone: "lilac" },
    { type: "feeding", preset: "formula", label: "분유", icon: "🍼", tone: "rose" },
    { type: "diaper", label: "기저귀", icon: "🚼", tone: "sand" },
    { type: "sleep", label: "수면", icon: "🌙", tone: "mint" },
    { type: "temperature", label: "체온", icon: "🌡️", tone: "coral" },
    { type: "bath", label: "목욕", icon: "🫧", tone: "sky" },
    { type: "weight", label: "체중", icon: "⚖️", tone: "sand" },
    { type: "mother", label: "산모 케어", icon: "🌿", tone: "mint" },
    { type: "note", label: "메모", icon: "✎", tone: "lilac" },
  ]);

  const BABYSITTING_QUICK_ACTIONS = Object.freeze([
    { type: "meal", label: "식사·간식", icon: "🥣", tone: "sand" },
    { type: "sitter_note", preset: "놀이", label: "놀이", icon: "🧸", tone: "sky" },
    { type: "sitter_note", preset: "산책", label: "산책", icon: "🚶", tone: "mint" },
    { type: "sitter_note", preset: "낮잠", label: "낮잠", icon: "😴", tone: "lilac" },
    { type: "sitter_note", preset: "배변", label: "배변", icon: "🚼", tone: "sand" },
    { type: "sitter_note", preset: "등원·하원", label: "등원·하원", icon: "🎒", tone: "rose" },
    { type: "sitter_note", preset: "안전 확인", label: "안전 확인", icon: "✓", tone: "mint" },
    { type: "sitter_note", preset: "기타", label: "기타", icon: "✎", tone: "coral" },
  ]);

  const DATABASE_EVENT_TO_APP = Object.freeze({
    FEEDING: "feeding",
    DIAPER: "diaper",
    SLEEP: "sleep",
    TEMPERATURE: "temperature",
    BATH: "bath",
    WEIGHT: "weight",
    MOTHER_CARE: "mother",
    NOTE: "note",
    MEAL: "meal",
    SITTER_NOTE: "sitter_note",
  });

  const TODAY_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  function atTime(hours, minutes) {
    const value = new Date();
    value.setHours(hours, minutes, 0, 0);
    return value.toISOString();
  }

  function dateOffset(days, hours = 9) {
    const value = new Date();
    value.setDate(value.getDate() + days);
    value.setHours(hours, 0, 0, 0);
    return value.toISOString();
  }

  function atDayOffset(days, hours, minutes = 0) {
    const value = new Date();
    value.setDate(value.getDate() + days);
    value.setHours(hours, minutes, 0, 0);
    return value.toISOString();
  }

  function historicalCareEvents() {
    const families = [
      { key: "emma", serviceType: "POSTPARTUM", assignmentId: "assignment-emma", clientId: "client-sarah", babyId: "baby-emma", author: "Mina Kim", baseWeight: 3.72, feedBase: 72, sleepBase: 295, tempBase: 36.65 },
      { key: "ava", serviceType: "BABYSITTING", assignmentId: "assignment-ava", clientId: "client-sophia", babyId: "baby-ava", author: "Jane Lee", baseWeight: 3.28, feedBase: 64, sleepBase: 315, tempBase: 36.72 },
    ];
    return families.flatMap((family, familyIndex) => Array.from({ length: 30 }, (_, index) => {
      const dayOffset = index - 29;
      if (family.serviceType === "BABYSITTING") {
        return [
          { id: `hist-${family.key}-${index}-meal`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "meal", at: atDayOffset(dayOffset, 12, 10), author: family.author, data: { mealType: index % 2 ? "점심" : "간식", menu: index % 2 ? "닭고기 야채죽" : "바나나와 요거트", appetite: index % 3 ? "잘 먹음" : "보통", note: "알러지 유발 식품을 확인했습니다." } },
          { id: `hist-${family.key}-${index}-sitter-note`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "sitter_note", at: atDayOffset(dayOffset, 15, 20), author: family.author, data: { category: index % 2 ? "놀이" : "산책", text: index % 2 ? "그림책을 읽고 블록 놀이를 했습니다." : "유모차로 25분 산책하고 손 씻기를 완료했습니다." } },
        ];
      }
      const breastAmount = family.feedBase + ((index * 7 + familyIndex * 3) % 22);
      const formulaAmount = Math.max(35, family.feedBase - 18 + ((index * 5 + familyIndex * 4) % 24));
      const sleepMinutes = family.sleepBase + ((index * 17 + familyIndex * 11) % 95);
      const temperature = Number((family.tempBase + ((index % 5) - 2) * 0.06).toFixed(1));
      const events = [
        { id: `hist-${family.key}-${index}-breast`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "feeding", at: atDayOffset(dayOffset, 9, 20), author: family.author, data: { method: "pumped", amount: breastAmount } },
        { id: `hist-${family.key}-${index}-formula`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "feeding", at: atDayOffset(dayOffset, 13, 10), author: family.author, data: { method: "formula", amount: formulaAmount } },
        { id: `hist-${family.key}-${index}-sleep`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "sleep", at: atDayOffset(dayOffset, 15, 5), author: family.author, data: { duration: sleepMinutes } },
        { id: `hist-${family.key}-${index}-temp`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "temperature", at: atDayOffset(dayOffset, 16, 15), author: family.author, data: { value: temperature } },
      ];
      if (index % 3 === 0 || index === 29) events.push({ id: `hist-${family.key}-${index}-weight`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "weight", at: atDayOffset(dayOffset, 10, 5), author: family.author, data: { value: Number((family.baseWeight + index * 0.018).toFixed(2)) } });
      if (index % 5 === 2) events.push({ id: `hist-${family.key}-${index}-bath`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "bath", at: atDayOffset(dayOffset, 14, 25), author: family.author, data: { bathType: "전신 목욕", waterTemperature: 38, note: "피부와 배꼽 주변 상태를 함께 확인했습니다." } });
      if (index % 4 === 1) events.push({ id: `hist-${family.key}-${index}-mother`, assignmentId: family.assignmentId, clientId: family.clientId, babyId: family.babyId, type: "mother", at: atDayOffset(dayOffset, 12, 30), author: family.author, data: { care: "Rest support", note: "수분 섭취와 충분한 휴식을 도왔습니다." } });
      return events;
    }).flat());
  }

  function buildCloudShellState() {
    return {
      version: 18,
      role: "client",
      adminSelectedClientId: null,
      adminSelectedAssignmentId: null,
      selectedClientAssignmentId: null,
      calendarMonthOffset: 0,
      adminScheduleFilter: "ALL",
      financeFilters: { period: "MONTH", year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1) },
      serviceHistoryFilters: { query: "", serviceType: "ALL", status: "ALL", sort: "newest" },
      serviceTabs: {
        client: { POSTPARTUM: "summary", BABYSITTING: "summary" },
        caregiver: { POSTPARTUM: "today", BABYSITTING: "today" },
      },
      peopleDirectory: {
        activeSection: "members",
        memberQuery: "",
        memberSort: "newest",
        memberPage: 1,
        memberPageSize: 10,
        clientQuery: "",
        clientSort: "mother-asc",
        clientPage: 1,
        clientPageSize: 5,
        caregiverQuery: "",
        caregiverSort: "name-asc",
        caregiverPage: 1,
        caregiverPageSize: 5,
      },
      chartRangeByRole: { admin: "week", caregiver: "week", client: "week" },
      objectiveReportByRole: {
        admin: { assignmentId: null, customerQuery: "" },
        caregiver: { assignmentId: null, customerQuery: "" },
        client: { assignmentId: null, customerQuery: "" },
      },
      adminSelectedReportSessionId: null,
      shiftChecklists: {},
      serviceCatalog: { MASSAGE: { ...PREMIUM_ADD_ONS.MASSAGE } },
      views: { admin: "overview", caregiver: "caregiving", therapist: "availability", client: "services", retail: "pos" },
      auth: { currentUserId: null, screen: "public", termsVersion: CURRENT_CONSENT_VERSION },
      users: [],
      clients: [],
      assignments: [],
      massageAvailability: [],
      massageBookings: [],
      massageBookingChanges: [],
      serviceRequests: [],
      depositTransactions: [],
      balanceTransactions: [],
      refundTransactions: [],
      serviceAdjustments: [],
      reports: [],
      careSessions: [],
      reviews: [],
      publicCaregivers: [],
      events: [],
      session: { id: null, assignmentId: null, clientId: null, babyId: null, serviceDate: null, serviceTimeZone: null, active: false, startedAt: null, endedAt: null, clientName: "", babyName: "", babyInitial: "", caregiverName: "", schedule: "", address: "" },
      retail: { selectedCategory: "ALL", posCategory: "ALL", cart: [], carts: {}, products: [], inventoryMovements: [], orders: [] },
    };
  }

  function buildSeedState() {
    if (!import.meta.env.DEV) return buildCloudShellState();
    return {
      version: 18,
      role: "caregiver",
      adminSelectedClientId: "client-sarah",
      selectedClientAssignmentId: null,
      calendarMonthOffset: 0,
      adminScheduleFilter: "ALL",
      financeFilters: { period: "MONTH", year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1) },
      serviceHistoryFilters: { query: "", serviceType: "ALL", status: "ALL", sort: "newest" },
      serviceTabs: {
        client: { POSTPARTUM: "summary", BABYSITTING: "summary" },
        caregiver: { POSTPARTUM: "today", BABYSITTING: "today" },
      },
      peopleDirectory: {
        activeSection: "members",
        memberQuery: "",
        memberSort: "newest",
        memberPage: 1,
        memberPageSize: 10,
        clientQuery: "",
        clientSort: "mother-asc",
        clientPage: 1,
        clientPageSize: 5,
        caregiverQuery: "",
        caregiverSort: "name-asc",
        caregiverPage: 1,
        caregiverPageSize: 5,
      },
      chartRangeByRole: { admin: "week", caregiver: "week", client: "week" },
      objectiveReportByRole: {
        admin: { assignmentId: null, customerQuery: "" },
        caregiver: { assignmentId: null, customerQuery: "" },
        client: { assignmentId: null, customerQuery: "" },
      },
      adminSelectedReportSessionId: null,
      shiftChecklists: {},
      serviceCatalog: { MASSAGE: { ...PREMIUM_ADD_ONS.MASSAGE } },
      views: { admin: "overview", caregiver: "caregiving", therapist: "availability", client: "services", retail: "pos" },
      auth: { currentUserId: null, screen: "public", termsVersion: CURRENT_CONSENT_VERSION },
      users: [
        { id: "user-admin", login: "admin-preview@localhost.invalid", email: "admin-preview@localhost.invalid", password: null, role: "admin", status: "approved", fullName: "운영 관리자", initials: "운", mustChangePassword: false, createdAt: dateOffset(-120) },
        { id: "user-retail", login: "retail-preview@localhost.invalid", email: "retail-preview@localhost.invalid", password: null, role: "retail", status: "approved", fullName: "리테일 담당자", initials: "리", mustChangePassword: false, createdAt: dateOffset(-90) },
        { id: "user-caregiver-mina", caregiverId: "caregiver-mina", login: "caregiver-one@localhost.invalid", email: "caregiver-one@localhost.invalid", password: null, role: "caregiver", status: "approved", fullName: "Mina Kim", initials: "MK", phone: "470-555-0142", certification: "Newborn Care Specialist · CPR", hireDate: dateOffset(-58), careerYears: 6, employmentStatus: "ACTIVE", canProvidePostpartum: true, canProvideBabysitting: true, specialties: "신생아 수면, 모유수유 지원", residentialArea: "Duluth, GA", serviceArea: "Duluth · Johns Creek · Suwanee", hrNotes: "야간 근무는 사전 협의 필요", createdAt: dateOffset(-60) },
        { id: "user-caregiver-jane", caregiverId: "caregiver-jane", login: "caregiver-two@localhost.invalid", email: "caregiver-two@localhost.invalid", password: null, role: "caregiver", status: "approved", fullName: "Jane Lee", initials: "JL", phone: "470-555-0188", certification: "Postpartum Doula · Infant CPR", hireDate: dateOffset(-42), careerYears: 4, employmentStatus: "ACTIVE", canProvidePostpartum: true, canProvideBabysitting: true, isMassageTherapist: true, specialties: "산모 회복, 식사 지원", residentialArea: "Sandy Springs, GA", serviceArea: "Atlanta · Sandy Springs · Marietta", hrNotes: "주 4일 근무 선호", createdAt: dateOffset(-45) },
        { id: "user-caregiver-soo", caregiverId: "caregiver-soo", login: "caregiver-three@localhost.invalid", email: "caregiver-three@localhost.invalid", password: null, role: "caregiver", status: "approved", fullName: "Soo Choi", initials: "SC", phone: "470-555-0194", certification: "Infant Care · CPR", hireDate: dateOffset(-28), careerYears: 3, employmentStatus: "ACTIVE", canProvidePostpartum: true, canProvideBabysitting: true, specialties: "영아 놀이, 생활 루틴, 안전 돌봄", residentialArea: "Kennesaw, GA", serviceArea: "Kennesaw · Marietta · Acworth", hrNotes: "오후 베이비시팅 일정 선호", createdAt: dateOffset(-30) },
        { id: "user-client-sarah", login: "client-one@localhost.invalid", email: "client-one@localhost.invalid", password: null, role: "client", status: "approved", fullName: "Sarah Kim", initials: "SK", phone: "470-555-0109", createdAt: dateOffset(-30) },
        { id: "user-client-sophia", login: "client-two@localhost.invalid", email: "client-two@localhost.invalid", password: null, role: "client", status: "approved", fullName: "Sophia Park", initials: "SP", phone: "470-555-0166", createdAt: dateOffset(-18) },
      ],
      clients: [
        { id: "client-sarah", userId: "user-client-sarah", motherName: "Sarah Kim", maternalStatus: "회복 양호", clientStatus: "ACTIVE", preferredLanguage: "한국어 · English", emergencyContact: "David Kim · 470-555-0128", nextContactDate: dateOffset(3), internalMemo: "둘째 출산 고객. 오전 연락 선호. 서비스 종료 1주 전 연장 상담 예정.", babyAdminNotes: "최근 수유량과 수면 패턴을 주간 리포트에서 함께 확인.", babyId: "baby-emma", babyName: "Emma Kim", babyBirthDate: dateOffset(-34), address: "Duluth, Georgia", allergies: "없음", extraHouseholdMembers: 1, requestNote: "수유 후 트림과 수면 패턴을 자세히 기록해 주세요." },
        { id: "client-sophia", userId: "user-client-sophia", motherName: "Sophia Park", maternalStatus: "휴식 필요", clientStatus: "ACTIVE", preferredLanguage: "English", emergencyContact: "Daniel Park · 470-555-0173", nextContactDate: dateOffset(2), internalMemo: "견과류 알러지 관련 식사 준비 지침 전달 완료.", babyAdminNotes: "식사와 활동 변화가 있을 경우 보호자에게 우선 알림.", babyId: "baby-ava", babyName: "Ava Park", babyBirthDate: dateOffset(-18), address: "Sandy Springs, Georgia", allergies: "견과류", extraHouseholdMembers: 2, requestNote: "식사 준비 시 견과류 알러지를 확인해 주세요." },
      ],
      assignments: [
        { id: "assignment-emma", serviceRequestId: "request-sarah", serviceType: "POSTPARTUM", clientId: "client-sarah", babyId: "baby-emma", caregiverUserId: "user-caregiver-mina", weeks: 4, weeklyRate: POSTPARTUM_WEEKLY_RATE, contractValue: POSTPARTUM_WEEKLY_RATE * 4, depositAmount: POSTPARTUM_DEPOSIT, depositStatus: "PAID", depositPaidAt: dateOffset(-36), startAt: dateOffset(-2, 10), endAt: dateOffset(25, 18), dailyStart: "10:00", dailyEnd: "18:00", address: "Duluth, Georgia", extraHouseholdMembers: 1, allergies: "없음", requestNote: "수유 후 트림과 수면 패턴을 자세히 기록해 주세요.", status: "ACTIVE" },
        { id: "assignment-ava", serviceRequestId: "request-sophia", serviceType: "BABYSITTING", clientId: "client-sophia", babyId: "baby-ava", caregiverUserId: "user-caregiver-jane", weeks: 3, depositAmount: BABYSITTING_DEPOSIT, depositStatus: "PAID", depositPaidAt: dateOffset(-25), startAt: dateOffset(-10, 9), endAt: dateOffset(10, 17), dailyStart: "09:00", dailyEnd: "17:00", address: "Sandy Springs, Georgia", extraHouseholdMembers: 2, allergies: "견과류", requestNote: "식사 전 알러지 확인과 오후 그림책 놀이를 부탁드립니다.", mealInstructions: "견과류 완전 제외 · 점심 12시 · 간식 3시", routineNotes: "식후 양치, 오후 1시 낮잠", pickupNotes: "보호자에게 식사량과 활동을 인계", status: "ACTIVE" },
        { id: "assignment-next-mina", serviceType: "BABYSITTING", clientId: "client-sophia", babyId: "baby-ava", caregiverUserId: "user-caregiver-mina", weeks: 2, depositAmount: BABYSITTING_DEPOSIT, depositStatus: "PAID", depositPaidAt: dateOffset(-2), startAt: dateOffset(28, 9), endAt: dateOffset(41, 17), dailyStart: "09:00", dailyEnd: "17:00", address: "Sandy Springs, Georgia", extraHouseholdMembers: 2, allergies: "견과류", requestNote: "대체 베이비시팅 일정", status: "SCHEDULED" },
      ],
      massageAvailability: [],
      massageBookings: [],
      massageBookingChanges: [],
      serviceRequests: [
        { id: "request-sarah", serviceType: "POSTPARTUM", clientId: "client-sarah", userId: "user-client-sarah", status: "APPROVED", weeks: 4, weeklyRate: POSTPARTUM_WEEKLY_RATE, estimatedTotal: POSTPARTUM_WEEKLY_RATE * 4, depositAmount: POSTPARTUM_DEPOSIT, depositStatus: "PAID", depositPaidAt: dateOffset(-36), desiredStartDate: dateOffset(-2, 10), dailyStart: "10:00", dailyEnd: "18:00", daysOfWeek: ["월", "화", "수", "목", "금"], address: "Duluth, Georgia", extraHouseholdMembers: 1, allergies: "없음", specialNotes: "수유 후 트림과 수면 패턴을 자세히 기록해 주세요.", birthOrDueDate: dateOffset(-34), approvedAssignmentId: "assignment-emma", createdAt: dateOffset(-35) },
        { id: "request-sarah-sitting", serviceType: "BABYSITTING", clientId: "client-sarah", userId: "user-client-sarah", status: "APPROVED", weeks: 3, depositAmount: BABYSITTING_DEPOSIT, depositStatus: "PAID", depositPaidAt: dateOffset(-1), desiredStartDate: dateOffset(28, 14), dailyStart: "14:00", dailyEnd: "18:00", daysOfWeek: ["화", "목", "토"], address: "Duluth, Georgia", extraHouseholdMembers: 1, allergies: "없음", specialNotes: "놀이와 간식 중심의 베이비시팅을 희망합니다.", mealInstructions: "오후 3시 간식 · 새로운 식품은 보호자 확인 후 제공", routineNotes: "그림책과 바닥 놀이, 오후 4시 짧은 휴식", pickupNotes: "보호자에게 간식량과 놀이 활동을 인계", birthOrDueDate: dateOffset(-34), approvedAssignmentId: null, approvedAt: dateOffset(-1), createdAt: dateOffset(-7) },
        { id: "request-sophia", serviceType: "BABYSITTING", clientId: "client-sophia", userId: "user-client-sophia", status: "APPROVED", weeks: 3, depositAmount: BABYSITTING_DEPOSIT, depositStatus: "PAID", depositPaidAt: dateOffset(-25), desiredStartDate: dateOffset(-10, 9), dailyStart: "09:00", dailyEnd: "17:00", daysOfWeek: ["월", "수", "금"], address: "Sandy Springs, Georgia", extraHouseholdMembers: 2, allergies: "견과류", specialNotes: "식사 준비 시 견과류 알러지를 확인해 주세요.", mealInstructions: "견과류 제외 · 점심 12시", routineNotes: "오후 그림책 놀이", pickupNotes: "보호자에게 활동 내용 인계", birthOrDueDate: dateOffset(-18), approvedAssignmentId: "assignment-ava", createdAt: dateOffset(-24) },
      ],
      depositTransactions: [],
      balanceTransactions: [],
      refundTransactions: [],
      serviceAdjustments: [],
      reports: [],
      careSessions: [],
      reviews: [
        { id: "historical-review-mina", assignmentId: null, clientId: null, caregiverId: "caregiver-mina", caregiverUserId: "user-caregiver-mina", rating: 5, tags: ["세심한 케어"], comment: "아기의 수면과 수유 기록을 꼼꼼하게 공유해 주셔서 안심할 수 있었습니다.", serviceDate: dateInputValue(dateOffset(-120)), serviceType: "POSTPARTUM", reviewerAlias: "이전 서비스 고객", source: "ADMIN_LEGACY", publicationStatus: "PUBLISHED", archived: false, createdAt: dateOffset(-100) },
        { id: "historical-review-jane", assignmentId: null, clientId: null, caregiverId: "caregiver-jane", caregiverUserId: "user-caregiver-jane", rating: 5, tags: ["친절한 소통"], comment: "매일 돌봄 내용을 차분하게 설명해 주시고 요청사항도 정확하게 반영해 주셨습니다.", serviceDate: dateInputValue(dateOffset(-90)), serviceType: "BABYSITTING", reviewerAlias: "이전 서비스 고객", source: "ADMIN_LEGACY", publicationStatus: "PUBLISHED", archived: false, createdAt: dateOffset(-80) },
      ],
      publicCaregivers: [
        { caregiverId: "caregiver-mina", caregiverUserId: "user-caregiver-mina", displayName: "Mina Kim", headline: "신생아의 편안한 리듬과 산모의 회복을 함께 살핍니다.", biography: "신생아 수면과 수유 지원을 중심으로 가정마다 다른 생활 리듬을 세심하게 존중합니다.", photoPath: "", photoUrl: "", photoAlt: "Mina Kim 관리사", careerYears: 6, serviceCapabilities: ["POSTPARTUM", "BABYSITTING"], specialties: ["신생아 수면", "모유수유 지원"], credentials: ["Newborn Care Specialist", "CPR"], languages: ["한국어", "English"], serviceArea: "Duluth · Johns Creek · Suwanee", featured: true, sortOrder: 10, isPublished: true, averageRating: null, reviewCount: 0, ratingDistribution: {}, reviews: [{ id: "public-review-mina", source: "ADMIN_LEGACY", rating: 5, tags: ["세심한 케어"], comment: "아기의 수면과 수유 기록을 꼼꼼하게 공유해 주셔서 안심할 수 있었습니다.", serviceType: "POSTPARTUM", serviceDate: dateInputValue(dateOffset(-120)), reviewerLabel: "이전 서비스 고객", createdAt: dateOffset(-100) }] },
        { caregiverId: "caregiver-jane", caregiverUserId: "user-caregiver-jane", displayName: "Jane Lee", headline: "산모의 휴식과 아기의 안전한 일상을 차분하게 돕습니다.", biography: "산후 회복기 식사와 휴식 지원, 영아 돌봄 경험을 바탕으로 가족과 명확하게 소통합니다.", photoPath: "", photoUrl: "", photoAlt: "Jane Lee 관리사", careerYears: 4, serviceCapabilities: ["POSTPARTUM", "BABYSITTING", "MASSAGE"], specialties: ["산모 회복", "식사 지원"], credentials: ["Postpartum Doula", "Infant CPR"], languages: ["한국어", "English"], serviceArea: "Atlanta · Sandy Springs · Marietta", featured: true, sortOrder: 20, isPublished: true, averageRating: null, reviewCount: 0, ratingDistribution: {}, reviews: [{ id: "public-review-jane", source: "ADMIN_LEGACY", rating: 5, tags: ["친절한 소통"], comment: "매일 돌봄 내용을 차분하게 설명해 주시고 요청사항도 정확하게 반영해 주셨습니다.", serviceType: "BABYSITTING", serviceDate: dateInputValue(dateOffset(-90)), reviewerLabel: "이전 서비스 고객", createdAt: dateOffset(-80) }] },
        { caregiverId: "caregiver-soo", caregiverUserId: "user-caregiver-soo", displayName: "Soo Choi", headline: "놀이와 생활 루틴을 아이의 눈높이에 맞춰 기록합니다.", biography: "영아 놀이와 산책, 식사와 생활 이벤트를 보호자가 이해하기 쉽게 공유합니다.", photoPath: "", photoUrl: "", photoAlt: "Soo Choi 관리사", careerYears: 3, serviceCapabilities: ["POSTPARTUM", "BABYSITTING"], specialties: ["영아 놀이", "생활 루틴", "안전 돌봄"], credentials: ["Infant Care", "CPR"], languages: ["한국어"], serviceArea: "Kennesaw · Marietta · Acworth", featured: false, sortOrder: 30, isPublished: true, averageRating: null, reviewCount: 0, ratingDistribution: {}, reviews: [] },
      ],
      session: {
        id: "session-emma-today",
        assignmentId: "assignment-emma",
        clientId: "client-sarah",
        babyId: "baby-emma",
        serviceDate: localDateKey(new Date()),
        active: true,
        startedAt: atTime(10, 0),
        endedAt: null,
        clientName: "Sarah Kim",
        babyName: "Emma Kim",
        babyInitial: "E",
        caregiverName: "Mina Kim",
        schedule: "10:00 AM – 6:00 PM",
        address: "Duluth, Georgia",
      },
      events: [
        { id: "evt-1", assignmentId: "assignment-emma", clientId: "client-sarah", babyId: "baby-emma", type: "feeding", at: atTime(10, 22), author: "Mina Kim", data: { method: "pumped", amount: 80 } },
        { id: "evt-2", assignmentId: "assignment-emma", clientId: "client-sarah", babyId: "baby-emma", type: "diaper", at: atTime(11, 5), author: "Mina Kim", data: { urine: "medium", stool: "normal", color: "yellow" } },
        { id: "evt-3", assignmentId: "assignment-emma", clientId: "client-sarah", babyId: "baby-emma", type: "sleep", at: atTime(11, 20), author: "Mina Kim", data: { duration: 48 } },
        { id: "evt-4", assignmentId: "assignment-emma", clientId: "client-sarah", babyId: "baby-emma", type: "feeding", at: atTime(12, 40), author: "Mina Kim", data: { method: "formula", amount: 70 } },
        { id: "evt-5", assignmentId: "assignment-emma", clientId: "client-sarah", babyId: "baby-emma", type: "temperature", at: atTime(13, 15), author: "Mina Kim", data: { value: 36.8 } },
        { id: "evt-6", assignmentId: "assignment-emma", clientId: "client-sarah", babyId: "baby-emma", type: "mother", at: atTime(13, 35), author: "Mina Kim", data: { care: "Light stretching", note: "가벼운 스트레칭과 수분 섭취를 도왔습니다." } },
        { id: "evt-7", assignmentId: "assignment-ava", clientId: "client-sophia", babyId: "baby-ava", type: "meal", at: atTime(12, 10), author: "Jane Lee", data: { mealType: "점심", menu: "닭고기 야채죽", appetite: "잘 먹음", note: "견과류 미포함 확인" } },
        { id: "evt-8", assignmentId: "assignment-ava", clientId: "client-sophia", babyId: "baby-ava", type: "sitter_note", at: atTime(14, 35), author: "Jane Lee", data: { category: "놀이", text: "그림책 두 권을 읽고 블록 놀이를 했습니다." } },
        ...historicalCareEvents(),
      ],
      schedules: [
        { time: "9:00 AM", client: "Ava Park", caregiver: "Jane Lee · 베이비시팅", status: "진행 중", tone: "mint" },
        { time: "10:00 AM", client: "Emma Kim", caregiver: "Mina Kim · 산후조리", status: "진행 중", tone: "mint" },
        { time: "배정 준비", client: "Emma Kim", caregiver: "관리사 배정 대기 · 베이비시팅", status: "승인 완료", tone: "gold" },
      ],
      people: [
        { name: "Sarah Kim", detail: "고객 · Emma의 보호자", status: "서비스 진행 중", initials: "SK" },
        { name: "Mina Kim", detail: "산후관리사 · 오늘 1건", status: "근무 중", initials: "MK" },
        { name: "Jane Lee", detail: "산후관리사 · 오늘 1건", status: "근무 중", initials: "JL" },
        { name: "Olivia Choi", detail: "고객 · 8월 31일 시작", status: "배정 완료", initials: "OC" },
      ],
      retail: {
        selectedCategory: "ALL",
        posCategory: "ALL",
        cart: [],
        carts: {},
        cartCustomer: "Sarah Kim",
        products: [
          { id: "beauty-1", sku: "KB-RL-001", name: "Round Lab Dokdo Toner", category: "BEAUTY", price: 24, cost: 12, emoji: "💧", badge: "BEST", description: "민감한 피부를 위한 순한 수분 토너" },
          { id: "beauty-2", sku: "KB-BJ-002", name: "Beauty of Joseon Serum", category: "BEAUTY", price: 19, cost: 8, emoji: "✨", badge: "NEW", description: "윤기와 보습을 더하는 데일리 세럼" },
          { id: "beauty-3", sku: "KB-AN-003", name: "Anua Heartleaf Ampoule", category: "BEAUTY", price: 28, cost: 14, emoji: "🌿", badge: "", description: "편안한 스킨케어를 위한 어성초 앰플" },
          { id: "beauty-4", sku: "KB-LN-004", name: "Laneige Lip Sleeping Mask", category: "BEAUTY", price: 22, cost: 10, emoji: "🌙", badge: "", description: "밤 사이 촉촉하게 관리하는 립 마스크" },
          { id: "baby-1", sku: "BB-MU-101", name: "Organic Muslin Swaddle", category: "BABY", price: 32, cost: 15, emoji: "☁️", badge: "BEST", description: "부드럽고 통기성 좋은 오가닉 속싸개" },
          { id: "baby-2", sku: "BB-BT-102", name: "Gentle Baby Bath", category: "BABY", price: 18, cost: 7, emoji: "🫧", badge: "", description: "신생아를 위한 무향 저자극 워시" },
          { id: "baby-3", sku: "BB-BC-103", name: "Baby Care Essentials Kit", category: "BABY", price: 46, cost: 22, emoji: "🧸", badge: "GIFT", description: "체온계·브러시·네일 케어 구성" },
          { id: "baby-4", sku: "BB-BL-104", name: "Bamboo Baby Blanket", category: "BABY", price: 38, cost: 18, emoji: "🌱", badge: "", description: "사계절 사용 가능한 대나무 섬유 블랭킷" },
        ],
        inventoryMovements: [
          { id: "mv-1", productId: "beauty-1", type: "RECEIPT", quantity: 5, at: atTime(8, 0) },
          { id: "mv-2", productId: "beauty-2", type: "RECEIPT", quantity: 19, at: atTime(8, 0) },
          { id: "mv-3", productId: "beauty-3", type: "RECEIPT", quantity: 11, at: atTime(8, 0) },
          { id: "mv-4", productId: "beauty-4", type: "RECEIPT", quantity: 10, at: atTime(8, 0) },
          { id: "mv-5", productId: "baby-1", type: "RECEIPT", quantity: 17, at: atTime(8, 0) },
          { id: "mv-6", productId: "baby-2", type: "RECEIPT", quantity: 22, at: atTime(8, 0) },
          { id: "mv-7", productId: "baby-3", type: "RECEIPT", quantity: 7, at: atTime(8, 0) },
          { id: "mv-8", productId: "baby-4", type: "RECEIPT", quantity: 13, at: atTime(8, 0) },
          { id: "mv-9", productId: "beauty-1", type: "SALE", quantity: -1, at: atTime(9, 12) },
          { id: "mv-10", productId: "baby-1", type: "SALE", quantity: -1, at: atTime(9, 12) },
          { id: "mv-11", productId: "baby-3", type: "SALE", quantity: -1, at: atTime(8, 44) },
          { id: "mv-12", productId: "beauty-2", type: "SALE", quantity: -1, at: atTime(8, 18) },
          { id: "mv-13", productId: "beauty-4", type: "SALE", quantity: -1, at: atTime(8, 18) },
        ],
        orders: [
          { id: "KW-1048", clientId: "client-sarah", customer: "Sarah Kim", channel: "CARE_CRM", status: "배송 완료", total: 56, createdAt: atTime(9, 12), items: [{ productId: "beauty-1", quantity: 1 }, { productId: "baby-1", quantity: 1 }] },
          { id: "KW-1047", clientId: null, customer: "Walk-in", channel: "STORE_POS", status: "배송 완료", total: 46, createdAt: atTime(8, 44), items: [{ productId: "baby-3", quantity: 1 }] },
          { id: "KW-1046", clientId: "client-sophia", customer: "Sophia Park", channel: "CLIENT_APP", status: "주문 접수", total: 41, createdAt: atTime(8, 18), items: [{ productId: "beauty-2", quantity: 1 }, { productId: "beauty-4", quantity: 1 }] },
        ],
      },
    };
  }

  function loadState() {
    if (cloudEnabled) {
      const seed = buildCloudShellState();
      let preferences = {};
      try {
        preferences = JSON.parse(localStorage.getItem(CLOUD_PREFS_KEY) || "{}") || {};
      } catch (_error) {
        preferences = {};
      }
      return {
        ...seed,
        role: preferences.role || "client",
        selectedClientAssignmentId: preferences.selectedClientAssignmentId || null,
        adminSelectedAssignmentId: preferences.adminSelectedAssignmentId || null,
        adminSelectedClientId: preferences.adminSelectedClientId || null,
        financeFilters: { ...seed.financeFilters, ...(preferences.financeFilters || {}) },
        serviceHistoryFilters: { ...seed.serviceHistoryFilters, ...(preferences.serviceHistoryFilters || {}) },
        objectiveReportByRole: {
          admin: { ...seed.objectiveReportByRole.admin, ...(preferences.objectiveReportByRole?.admin || {}) },
          caregiver: { ...seed.objectiveReportByRole.caregiver, ...(preferences.objectiveReportByRole?.caregiver || {}) },
          client: { ...seed.objectiveReportByRole.client, ...(preferences.objectiveReportByRole?.client || {}) },
        },
        views: { ...seed.views, ...(preferences.views || {}) },
        auth: { ...seed.auth, currentUserId: null, screen: preferences.screen || "public" },
      };
    }
    if (!import.meta.env.DEV) return buildCloudShellState();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.events)) {
        const seed = buildSeedState();
        if (saved.version >= 3 && Array.isArray(saved.users) && saved.auth) {
          const mergeById = (defaults, current) => {
            const merged = new Map((defaults || []).map((item) => [item.id, { ...item }]));
            (current || []).forEach((item) => merged.set(item.id, { ...(merged.get(item.id) || {}), ...item }));
            return [...merged.values()];
          };
          return {
            ...seed,
            ...saved,
            version: 18,
            users: mergeById(seed.users, saved.users),
            clients: mergeById(seed.clients, saved.clients),
            assignments: mergeById(seed.assignments, saved.assignments),
            serviceRequests: mergeById(seed.serviceRequests, saved.serviceRequests),
            serviceAdjustments: mergeById(seed.serviceAdjustments, saved.serviceAdjustments || []),
            events: mergeById(seed.events, saved.events),
            reviews: mergeById(seed.reviews, saved.reviews || []),
            publicCaregivers: Array.isArray(saved.publicCaregivers) && saved.publicCaregivers.length ? saved.publicCaregivers : seed.publicCaregivers,
            views: { ...seed.views, ...(saved.views || {}) },
            serviceTabs: {
              client: { ...seed.serviceTabs.client, ...(saved.serviceTabs?.client || {}) },
              caregiver: { ...seed.serviceTabs.caregiver, ...(saved.serviceTabs?.caregiver || {}) },
            },
            peopleDirectory: { ...seed.peopleDirectory, ...(saved.peopleDirectory || {}) },
            financeFilters: { ...seed.financeFilters, ...(saved.financeFilters || {}) },
            serviceHistoryFilters: { ...seed.serviceHistoryFilters, ...(saved.serviceHistoryFilters || {}) },
            chartRangeByRole: { ...seed.chartRangeByRole, ...(saved.chartRangeByRole || {}) },
            objectiveReportByRole: {
              admin: { ...seed.objectiveReportByRole.admin, ...(saved.objectiveReportByRole?.admin || {}) },
              caregiver: { ...seed.objectiveReportByRole.caregiver, ...(saved.objectiveReportByRole?.caregiver || {}) },
              client: { ...seed.objectiveReportByRole.client, ...(saved.objectiveReportByRole?.client || {}) },
            },
            shiftChecklists: { ...seed.shiftChecklists, ...(saved.shiftChecklists || {}) },
            serviceCatalog: { ...seed.serviceCatalog, ...(saved.serviceCatalog || {}) },
            auth: { ...seed.auth, ...(saved.auth || {}), screen: saved.version >= 8 ? (saved.auth?.screen || "public") : "public" },
            retail: { ...seed.retail, ...(saved.retail || {}) },
          };
        }
        const upgradedEvents = saved.events.map((event) => ({
          assignmentId: event.assignmentId || "assignment-emma",
          clientId: event.clientId || "client-sarah",
          babyId: event.babyId || "baby-emma",
          ...event,
        }));
        const upgradedRetail = saved.retail
          ? {
              ...seed.retail,
              ...saved.retail,
              orders: (saved.retail.orders || seed.retail.orders).map((order) => ({
                ...order,
                clientId: order.clientId ?? (order.customer === "Sarah Kim" ? "client-sarah" : order.customer === "Sophia Park" ? "client-sophia" : null),
                status: order.status === "완료" ? "배송 완료" : order.status === "준비 중" ? "주문 접수" : order.status,
              })),
            }
          : seed.retail;
        return {
          ...seed,
          ...saved,
          version: 18,
          auth: seed.auth,
          users: seed.users,
          clients: seed.clients,
          assignments: seed.assignments,
          serviceRequests: seed.serviceRequests,
          serviceAdjustments: saved.serviceAdjustments || [],
          reports: saved.reports || [],
          reviews: saved.reviews || [],
          publicCaregivers: Array.isArray(saved.publicCaregivers) && saved.publicCaregivers.length ? saved.publicCaregivers : seed.publicCaregivers,
          events: upgradedEvents,
          views: { ...seed.views, ...(saved.views || {}) },
          serviceTabs: seed.serviceTabs,
          peopleDirectory: { ...seed.peopleDirectory, ...(saved.peopleDirectory || {}) },
          financeFilters: { ...seed.financeFilters, ...(saved.financeFilters || {}) },
          serviceHistoryFilters: { ...seed.serviceHistoryFilters, ...(saved.serviceHistoryFilters || {}) },
          chartRangeByRole: { ...seed.chartRangeByRole, ...(saved.chartRangeByRole || {}) },
          objectiveReportByRole: {
            admin: { ...seed.objectiveReportByRole.admin, ...(saved.objectiveReportByRole?.admin || {}) },
            caregiver: { ...seed.objectiveReportByRole.caregiver, ...(saved.objectiveReportByRole?.caregiver || {}) },
            client: { ...seed.objectiveReportByRole.client, ...(saved.objectiveReportByRole?.client || {}) },
          },
          retail: upgradedRetail,
        };
      }
    } catch (_error) {
      // Corrupt demo data falls back to a known-good sample.
    }
    return buildSeedState();
  }

  const usingCloudData = () => cloudEnabled;
  let state = loadState();
  let cloudLoading = cloudEnabled;
  let cloudLoadError = "";
  [...state.assignments, ...state.serviceRequests].forEach((item) => {
    if (assignmentServiceType(item) === "POSTPARTUM" && item.dailyStart) item.dailyEnd = postpartumEndTime(item.dailyStart);
  });
  state.version = 18;
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");
  const initialUrl = new URL(window.location.href);
  if (import.meta.env.DEV) {
    const previewRole = initialUrl.searchParams.get("preview-role");
    const previewUserByRole = { admin: "user-admin", caregiver: "user-caregiver-mina", client: "user-client-sarah", retail: "user-retail" };
    if (previewUserByRole[previewRole]) {
      state.role = previewRole;
      state.auth.currentUserId = previewUserByRole[previewRole];
      state.auth.screen = "portal";
      if (initialUrl.searchParams.get("preview-view")) state.views[previewRole] = initialUrl.searchParams.get("preview-view");
    }
  }
  const initialHashParams = new URLSearchParams(initialUrl.hash.replace(/^#/, ""));
  let passwordRecoveryRequested = (initialHashParams.get("type") === "recovery" && Boolean(initialHashParams.get("access_token")))
    || (initialUrl.searchParams.get("password-recovery") === "1" && Boolean(initialUrl.searchParams.get("code")));
  let authSubscription = null;
  let shellEventController = null;

  function clearPasswordRecoveryUrl() {
    const cleanUrl = new URL(window.location.href);
    ["password-recovery", "code", "token", "type"].forEach((key) => cleanUrl.searchParams.delete(key));
    const hashParams = new URLSearchParams(cleanUrl.hash.replace(/^#/, ""));
    ["access_token", "refresh_token", "expires_at", "expires_in", "provider_token", "token_type", "type"].forEach((key) => hashParams.delete(key));
    cleanUrl.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }

  function saveState() {
    if (usingCloudData()) {
      localStorage.setItem(CLOUD_PREFS_KEY, JSON.stringify({
        role: state.role,
        selectedClientAssignmentId: state.selectedClientAssignmentId || null,
        adminSelectedAssignmentId: state.adminSelectedAssignmentId || null,
        adminSelectedClientId: state.adminSelectedClientId || null,
        financeFilters: state.financeFilters,
        serviceHistoryFilters: state.serviceHistoryFilters,
        objectiveReportByRole: state.objectiveReportByRole,
        screen: state.auth.screen,
        views: state.views,
      }));
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  async function refreshCloudState(sessionOverride = undefined) {
    if (!usingCloudData()) return;
    cloudLoading = true;
    cloudLoadError = "";
    render();
    try {
      const session = sessionOverride === undefined ? await currentCloudSession() : sessionOverride;
      if (!session) {
        const clean = loadState();
        let publicCaregivers = [];
        try {
          publicCaregivers = await loadPublicCaregiverDirectoryCloud();
        } catch (publicDirectoryError) {
          console.warn("Public caregiver directory unavailable", publicDirectoryError);
        }
        state = { ...clean, publicCaregivers, auth: { ...clean.auth, screen: "public", currentUserId: null } };
        return;
      }
      const preferredWorkspace = state.role;
      const live = await loadCloudState(session);
      Object.assign(state, live);
      state.auth.currentUserId = live.currentUser.id;
      const availableWorkspaces = availableWorkspaceRoles(live.currentUser);
      state.role = availableWorkspaces.includes(preferredWorkspace)
        ? preferredWorkspace
        : availableWorkspaces.includes(live.currentUser.role) ? live.currentUser.role : availableWorkspaces[0];
      if (passwordRecoveryRequested) state.auth.screen = "reset-password";
      else if (state.auth.screen === "reset-password") state.auth.screen = "portal";
      else if (!["public", "login", "signup", "forgot-password", "reset-password", "portal"].includes(state.auth.screen)) state.auth.screen = "portal";
      saveState();
    } catch (error) {
      cloudLoadError = friendlyErrorMessage(error, "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      cloudLoading = false;
      render();
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function friendlyErrorMessage(error, fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.") {
    console.error(error);
    const message = String(error?.message || error?.cause?.message || "").toLowerCase();
    if (message.includes("invalid login credentials")) return "이메일 또는 비밀번호를 확인해 주세요.";
    if (message.includes("user already registered") || message.includes("already been registered")) return "이미 가입된 이메일입니다.";
    if (message.includes("email rate limit")) return "이메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.";
    if (message.includes("password") && (message.includes("short") || message.includes("least"))) return "비밀번호는 8자 이상으로 입력해 주세요.";
    if (message.includes("failed to fetch") || message.includes("network")) return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
    if (message.includes("requesting client account is no longer active")) return "이 신청자의 고객 권한 또는 고객 연결이 해제되어 증빙을 저장할 수 없습니다. 회원 유형과 고객 연결을 먼저 복구해 주세요.";
    if (message.includes("captured reservation-deposit evidence is required")) return "실제 예약금 수납 증빙을 먼저 등록해 주세요.";
    if (message.includes("exceeds the outstanding balance")) return "입력한 수납액이 현재 잔금보다 큽니다.";
    if (message.includes("no outstanding balance")) return "이 신청은 미수 잔금이 없습니다.";
    if (message.includes("payment reference has already been recorded")) return "이미 사용된 거래·영수증 번호입니다. 실제 결제 내역의 다른 고유 번호를 입력해 주세요.";
    if (message.includes("payment date cannot be in the future")) return "실제 수납일은 오늘 또는 지난 날짜로 입력해 주세요.";
    if (message.includes("refund amount exceeds")) return "환불액이 이 서비스의 실제 환불 가능 수납액보다 큽니다.";
    if (message.includes("no refundable collected amount")) return "이 서비스에는 추가로 환불할 수 있는 수납액이 없습니다.";
    if (message.includes("refund date cannot be in the future")) return "환불 처리일은 오늘 또는 지난 날짜로 입력해 주세요.";
    if (message.includes("refund reference has already been recorded")) return "이미 사용된 환불 참조번호입니다. 실제 환불 거래의 다른 고유 번호를 입력해 주세요.";
    if (message.includes("a complete service address is required")) return "기본 서비스 주소를 5자 이상 입력해 주세요.";
    if (message.includes("in-progress care session")) return "진행 중인 케어 세션을 먼저 종료하거나 취소한 뒤 서비스를 삭제해 주세요.";
    if (message.includes("detailed service removal reason")) return "서비스 삭제 사유를 5자 이상 구체적으로 입력해 주세요.";
    if (message.includes("unsupported device time zone")) return "휴대폰의 현재 시간대를 확인하지 못했습니다. 기기의 날짜·시간 자동 설정을 켠 뒤 다시 시도해 주세요.";
    if (message.includes("device-local current date")) return "기기 날짜가 변경되었습니다. 화면을 새로고침한 뒤 오늘 근무를 다시 시작해 주세요.";
    if (message.includes("only during the confirmed contract period") || message.includes("only during the contract period")) return "확정된 서비스 계약기간 안에서만 케어를 시작하고 기록할 수 있습니다.";
    if (message.includes("complete all four safety checks")) return "근무 전 안전 확인 4개를 모두 완료한 뒤 케어를 시작해 주세요.";
    if (message.includes("completion date does not match")) return "현재 열린 케어의 현지 날짜가 일치하지 않습니다. 화면을 새로고침한 뒤 종료해 주세요.";
    if (message.includes("assigned service days")) return "선택한 날짜는 해당 배정의 서비스 요일이 아닙니다.";
    if (message.includes("retrospective report cannot be entered for a future date") || message.includes("retrospective report cannot end in the future")) return "지난 근무 리포트에는 완료된 오늘 또는 과거 근무만 입력할 수 있습니다.";
    if (message.includes("published care report is immutable")) return "이미 고객에게 발행된 보관 리포트는 변경할 수 없습니다. 관리자에게 정정 절차를 요청해 주세요.";
    if (message.includes("active care session before adding a retrospective")) return "현재 진행 중인 근무를 먼저 종료한 뒤 지난 근무 리포트를 입력해 주세요.";
    if (message.includes("only the active assigned caregiver can report")) return "본인에게 실제 배정된 서비스만 소급 기록할 수 있습니다.";
    if (message.includes("matching captured reservation deposit is required")) return "일정 배치 전에 해당 서비스의 예약금 수납 확인을 완료해 주세요.";
    if (message.includes("overlapping service-day schedule")) return "선택한 관리사에게 같은 요일·시간의 중복 일정이 있습니다.";
    if (message.includes("required consents must be recorded")) return "관리사 권한을 추가하려면 해당 계정에서 최신 필수 약관 동의를 먼저 저장해야 합니다.";
    if (message.includes("client active service records")) return "진행 중인 고객 신청·계약이 있어 고객 권한을 제거할 수 없습니다. 고객 권한을 유지하거나 관련 서비스를 먼저 종료해 주세요.";
    if (message.includes("caregiver active schedule")) return "진행 중이거나 예정된 배정이 있어 관리사 권한을 제거할 수 없습니다. 관리사 권한을 유지하거나 배정을 먼저 완료·재배정해 주세요.";
    if (message.includes("caregiver open care session")) return "진행 중인 케어 세션을 종료한 뒤 관리사 권한을 제거해 주세요.";
    if (message.includes("postpartum assignments")) return "진행 중이거나 예정된 산후조리 배정을 먼저 완료하거나 다른 관리사에게 재배정해 주세요.";
    if (message.includes("babysitting assignments")) return "진행 중이거나 예정된 베이비시팅 배정을 먼저 완료하거나 다른 관리사에게 재배정해 주세요.";
    if (message.includes("massage bookings")) return "진행 중이거나 예정된 마사지 예약을 먼저 완료하거나 다른 테라피스트에게 재배정해 주세요.";
    if (message.includes("not authorized for the assigned service type")) return "선택한 직원에게 해당 서비스의 배정 권한이 없습니다. 회원 권한 구성에서 서비스 권한을 확인해 주세요.";
    if (message.includes("Massage-only therapists do not use caregiver ratings or reviews")) return "마사지 전용 테라피스트는 평점·후기 대신 이력과 전문 분야를 사용합니다.";
    if (message.includes("only an owner")) return "소유자만 관리자 권한을 추가하거나 제거할 수 있습니다.";
    if (message.includes("duplicate") || message.includes("already exists")) return "이미 처리 중이거나 저장된 항목입니다.";
    if (message.includes("recorded delivered-care history")) return "실제 케어 제공 기록이 확인된 서비스에만 후기를 작성할 수 있습니다.";
    if (message.includes("service has ended")) return "서비스가 종료된 뒤 후기를 작성할 수 있습니다.";
    if (message.includes("customer consent")) return "고객의 홈페이지 공개 동의가 없어 후기 원문을 공개할 수 없습니다.";
    if (message.includes("already excluded")) return "이미 정책 위반으로 평점 집계에서 제외된 후기입니다.";
    if (message.includes("supported policy reason")) return "평점과 무관한 운영정책 위반 사유를 선택해 주세요.";
    if (message.includes("policy explanation")) return "정책 위반 근거를 10자 이상 500자 이하로 구체적으로 입력해 주세요.";
    if (message.includes("must be restored")) return "평점 제외 상태를 먼저 복원한 뒤 홈페이지 공개 여부를 변경해 주세요.";
    if (message.includes("permission") || message.includes("row-level security") || message.includes("not authorized")) return "이 작업을 수행할 권한이 없습니다.";
    return fallback;
  }

  const REVIEW_INVALID_REASON_LABELS = Object.freeze({
    SPAM: "스팸·광고성 내용",
    FRAUD_OR_IMPERSONATION: "사기·사칭·조작 정황",
    DUPLICATE: "중복 등록",
  });

  function reviewInvalidReasonLabel(code) {
    return REVIEW_INVALID_REASON_LABELS[code] || "운영정책 위반";
  }

  function todayLabel() {
    return TODAY_FORMATTER.format(new Date());
  }

  function timeLabel(value) {
    return TIME_FORMATTER.format(new Date(value));
  }

  function serviceTimeZoneLabel(timeZone) {
    const normalized = String(timeZone || OBJECTIVE_REPORT_TIME_ZONE);
    if (normalized === "Asia/Seoul") return "한국시간";
    if (normalized === "America/New_York") return "미국 동부시간";
    return normalized.replaceAll("_", " ");
  }

  function careEventTimeParts(event) {
    const timeZone = objectiveEventTimeZone(event);
    return {
      time: objectiveTimeLabel(event.at, timeZone),
      zone: serviceTimeZoneLabel(timeZone),
    };
  }

  function authUser() {
    return state.users.find((user) => user.id === state.auth.currentUserId) || null;
  }

  function hasDatabaseRole(role) {
    const user = authUser();
    if (!usingCloudData()) return user?.role === "admin";
    return Boolean(user?.databaseRoles?.includes(role));
  }

  function availableWorkspaceRoles(user = authUser()) {
    if (!user) return [];
    if (!usingCloudData()) return [user.role];
    const roles = new Set(user.databaseRoles || []);
    const workspaces = [];
    if (["OWNER", "ADMIN", "CARE_MANAGER"].some((role) => roles.has(role))) workspaces.push("admin");
    if (roles.has("CAREGIVER") && (user.canProvidePostpartum || user.canProvideBabysitting)) workspaces.push("caregiver");
    if (user.isMassageTherapist) workspaces.push("therapist");
    if (roles.has("CLIENT")) workspaces.push("client");
    if (roles.has("RETAIL_STAFF")) workspaces.push("retail");
    return workspaces.length ? workspaces : [user.role];
  }

  function userHasAccessRole(user, databaseRole) {
    if (!user) return false;
    if (usingCloudData()) return Boolean(user.databaseRoles?.includes(databaseRole));
    return DATABASE_ROLE_BY_APP_ROLE[user.role] === databaseRole;
  }

  function workspaceSwitcherMarkup(location = "sidebar") {
    const workspaces = availableWorkspaceRoles();
    if (workspaces.length < 2) return "";
    return `<div class="workspace-switcher workspace-switcher-${location}" aria-label="작업공간 전환"><span>작업공간 전환</span><div>${workspaces.map((role) => `<button type="button" class="${state.role === role ? "active" : ""}" data-switch-role="${role}" aria-pressed="${state.role === role}">${escapeHtml(ROLE_META[role]?.label || role)}</button>`).join("")}</div></div>`;
  }

  function canManageMemberAccounts() {
    return !usingCloudData() || hasDatabaseRole("OWNER") || hasDatabaseRole("ADMIN");
  }

  function canGrantAdministrativeRole() {
    return !usingCloudData() || hasDatabaseRole("OWNER");
  }

  function canManageCaregiverHr() {
    return !usingCloudData() || hasDatabaseRole("OWNER") || hasDatabaseRole("ADMIN");
  }

  function canReviewServiceRequests() {
    return !usingCloudData() || hasDatabaseRole("OWNER") || hasDatabaseRole("ADMIN");
  }

  function clientForUser(userId) {
    return state.clients.find((client) => client.userId === userId || client.memberUserIds?.includes(userId)) || null;
  }

  function clientById(clientId) {
    return state.clients.find((client) => client.id === clientId) || null;
  }

  function normalizedBabyName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
  }

  function babiesForClient(client) {
    if (!client) return [];
    const babies = Array.isArray(client.babies) ? client.babies.filter(Boolean) : [];
    if (babies.length) return babies;
    return client.babyId || client.babyName
      ? [{ id: client.babyId || null, name: client.babyName || "", birthDate: client.babyBirthDate || null }]
      : [];
  }

  function clientProfileComplete(client) {
    if (!client || String(client.address || "").trim().length < 5) return false;
    return babiesForClient(client).some((baby) => String(baby?.name || "").trim() && baby?.birthDate);
  }

  function findClientBaby(client, babyName = "", babyId = null) {
    const babies = babiesForClient(client);
    if (babyId) {
      const byId = babies.find((baby) => baby.id === babyId);
      if (byId) return byId;
    }
    const normalizedName = normalizedBabyName(babyName);
    return normalizedName ? babies.find((baby) => normalizedBabyName(baby.name) === normalizedName) || null : null;
  }

  function babyNameFor(item, client = clientById(item?.clientId)) {
    if (item?.babyName) return item.babyName;
    return findClientBaby(client, "", item?.babyId)?.name || client?.babyName || "";
  }

  function itemMatchesBaby(item, client, babyId = null, babyName = "") {
    const itemId = item?.babyId || null;
    const itemName = normalizedBabyName(babyNameFor(item, client));
    const requestedName = normalizedBabyName(babyName);
    if (babyId && itemId) return babyId === itemId;
    if (requestedName && itemName) return requestedName === itemName;
    // Legacy rows without a baby identity remain conservatively scoped to the client.
    return true;
  }

  function deviceTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || OBJECTIVE_REPORT_TIME_ZONE;
  }

  function assignmentStartDateKey(assignment) {
    return assignment?.contractStartDate || objectiveDateKey(assignment?.startAt, OBJECTIVE_REPORT_TIME_ZONE);
  }

  function assignmentEndDateKey(assignment) {
    return assignment?.contractEndDate || objectiveDateKey(assignment?.endAt, OBJECTIVE_REPORT_TIME_ZONE);
  }

  function assignmentCoversDeviceDate(assignment, value = new Date()) {
    if (!assignment || assignment.status === "CANCELLED") return false;
    const deviceDate = localDateKey(value);
    const startDate = assignmentStartDateKey(assignment);
    const endDate = assignmentEndDateKey(assignment);
    return Boolean(startDate && endDate && startDate <= deviceDate && deviceDate <= endDate);
  }

  function isAssignmentCurrent(assignment) {
    return assignmentCoversDeviceDate(assignment);
  }

  const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const DEFAULT_SERVICE_DAYS = ["월", "화", "수", "목", "금"];

  function assignmentOccursOnDate(assignment, value = new Date()) {
    const date = parseLocalDateValue(value);
    if (Number.isNaN(date.getTime())) return false;
    const scheduledDays = Array.isArray(assignment?.daysOfWeek) && assignment.daysOfWeek.length
      ? assignment.daysOfWeek
      : DEFAULT_SERVICE_DAYS;
    return scheduledDays.includes(KOREAN_WEEKDAYS[date.getDay()]);
  }

  function assignmentIsScheduledToday(assignment) {
    return assignmentCoversDeviceDate(assignment, new Date()) && assignmentOccursOnDate(assignment, new Date());
  }

  function assignmentAcceptsCareEntriesToday(assignment) {
    return assignmentCoversDeviceDate(assignment, new Date());
  }

  function assignmentServiceType(assignment) {
    return ["POSTPARTUM", "BABYSITTING", "MASSAGE"].includes(assignment?.serviceType) ? assignment.serviceType : "POSTPARTUM";
  }

  function serviceMetaFor(value) {
    return SERVICE_META[["POSTPARTUM", "BABYSITTING", "MASSAGE"].includes(value) ? value : "POSTPARTUM"];
  }

  function serviceBadgeMarkup(value) {
    const meta = serviceMetaFor(value);
    return `<span class="service-type-badge ${meta.tone}">${meta.icon} ${meta.label}</span>`;
  }

  function canonicalCurrentAssignment(clientId) {
    const current = state.assignments.filter((assignment) => assignment.clientId === clientId && isAssignmentCurrent(assignment));
    return current.find((assignment) => assignmentServiceType(assignment) === "POSTPARTUM") || current[0] || null;
  }

  function assignmentForClient(clientId, serviceType = null) {
    const assignments = state.assignments
      .filter((item) => item.clientId === clientId && item.status !== "CANCELLED" && (!serviceType || assignmentServiceType(item) === serviceType))
      .sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    return assignments.find(isAssignmentCurrent) || assignments.find((item) => new Date(item.startAt) > new Date()) || assignments[0] || null;
  }

  function currentAndUpcomingAssignmentsForClient(clientId, serviceType = null) {
    const now = new Date();
    return state.assignments
      .filter((assignment) => assignment.clientId === clientId
        && assignment.status !== "CANCELLED"
        && new Date(assignment.endAt) >= now
        && (!serviceType || assignmentServiceType(assignment) === serviceType))
      .sort((first, second) => {
        const firstCurrent = isAssignmentCurrent(first) ? 0 : 1;
        const secondCurrent = isAssignmentCurrent(second) ? 0 : 1;
        return firstCurrent - secondCurrent || new Date(first.startAt) - new Date(second.startAt);
      });
  }

  function clientHasApprovedService(clientId, serviceType = null) {
    const now = new Date();
    return state.assignments.some((assignment) => assignment.clientId === clientId && assignment.status !== "CANCELLED" && new Date(assignment.endAt) >= now && (!serviceType || assignmentServiceType(assignment) === serviceType));
  }

  function selectedClientAssignment(clientId, serviceType = null) {
    const selected = state.assignments.find((assignment) => assignment.id === state.selectedClientAssignmentId
      && assignment.clientId === clientId
      && assignment.status !== "CANCELLED"
      && (!serviceType || assignmentServiceType(assignment) === serviceType));
    return selected || assignmentForClient(clientId, serviceType);
  }

  function clientCurrentService(clientId) {
    const current = canonicalCurrentAssignment(clientId);
    return current ? assignmentServiceType(current) : null;
  }

  function defaultServiceApplicationType(client) {
    if (!client) return "POSTPARTUM";
    const hasCurrentOrUpcomingPostpartum = state.assignments.some((assignment) => assignment.clientId === client.id && assignment.status !== "CANCELLED" && assignmentServiceType(assignment) === "POSTPARTUM" && new Date(assignment.endAt) >= new Date());
    return hasCurrentOrUpcomingPostpartum ? "BABYSITTING" : "POSTPARTUM";
  }

  function requestWindow(request) {
    return serviceWindow(request, dateInputValue(request.desiredStartDate), request.dailyStart, request.dailyEnd, request.weeks);
  }

  function serviceWindow(source, startDate, dailyStart, dailyEnd, weeks) {
    if (assignmentServiceType(source) !== "MASSAGE") return assignmentWindow(startDate, dailyStart, dailyEnd, weeks);
    const sessions = (state.massageBookings || []).filter((booking) => booking.requestId === source?.id && booking.status !== "CANCELLED");
    if (sessions.length) {
      return {
        startAt: new Date(Math.min(...sessions.map((booking) => new Date(booking.startsAt).getTime()))),
        endAt: new Date(Math.max(...sessions.map((booking) => new Date(booking.endsAt).getTime()))),
      };
    }
    return {
      startAt: new Date(`${startDate}T${dailyStart}:00`),
      endAt: new Date(`${startDate}T${dailyEnd}:00`),
    };
  }

  function postpartumModeFor(item) {
    return item?.postpartumMode === "LIVE_IN" ? "LIVE_IN" : "COMMUTE";
  }

  function postpartumWeeklyRate(item) {
    return postpartumModeFor(item) === "LIVE_IN" ? POSTPARTUM_LIVE_IN_WEEKLY_RATE : POSTPARTUM_WEEKLY_RATE;
  }

  function clientQualifiesForMassageMemberRate(clientId) {
    const today = startOfLocalDay();
    return state.assignments.some((assignment) => assignment.clientId === clientId
      && assignment.status !== "CANCELLED"
      && assignmentServiceType(assignment) === "POSTPARTUM"
      && startOfLocalDay(assignment.endAt) >= today)
      || state.serviceRequests.some((request) => request.clientId === clientId
        && request.status === "APPROVED"
        && assignmentServiceType(request) === "POSTPARTUM"
        && startOfLocalDay(requestWindow(request).endAt) >= today);
  }

  function massagePrice({ pricingTier = "GENERAL", durationMinutes = 60, sessionCount = 1 } = {}) {
    if (pricingTier === "POSTPARTUM_CLIENT" && Number(sessionCount) === 4) return MASSAGE_PRICES.POSTPARTUM_CLIENT.PACKAGE_4;
    const tier = MASSAGE_PRICES[pricingTier] || MASSAGE_PRICES.GENERAL;
    return Number(tier[Number(durationMinutes)] || MASSAGE_PRICES.GENERAL[60]);
  }

  function serviceLifecycleIssue(clientId, serviceType, startAt, endAt, excludedAssignmentId = null, excludedRequestId = null, babyId = null, babyName = "") {
    const requestedStart = startOfLocalDay(startAt);
    const requestedEnd = new Date(endAt);
    requestedEnd.setHours(23, 59, 59, 999);
    const client = clientById(clientId);
    const assignments = state.assignments.filter((assignment) => assignment.clientId === clientId && assignment.id !== excludedAssignmentId && assignment.status !== "CANCELLED" && itemMatchesBaby(assignment, client, babyId, babyName));
    const requests = state.serviceRequests.filter((request) => request.clientId === clientId && request.id !== excludedRequestId && ["PENDING", "APPROVED"].includes(request.status) && !request.approvedAssignmentId && itemMatchesBaby(request, client, babyId, babyName));
    const assignmentOverlap = assignments.find((assignment) => new Date(assignment.startAt) <= requestedEnd && new Date(assignment.endAt) >= requestedStart);
    if (assignmentOverlap) {
      const existingType = assignmentServiceType(assignmentOverlap);
      return {
        code: existingType === serviceType ? "SAME_SERVICE_OVERLAP" : "CROSS_SERVICE_OVERLAP",
        message: existingType === serviceType
          ? `선택한 기간에 이미 ${serviceMetaFor(existingType).label} 계약·배정이 있습니다.`
          : `${serviceMetaFor(existingType).label} 기간에는 ${serviceMetaFor(serviceType).label}을 동시에 배정할 수 없습니다. 같은 아기의 두 서비스는 날짜가 겹치지 않아야 합니다.`,
      };
    }
    const requestOverlap = requests.find((request) => {
      const window = requestWindow(request);
      return window.startAt <= requestedEnd && window.endAt >= requestedStart;
    });
    if (requestOverlap) {
      const existingType = assignmentServiceType(requestOverlap);
      return {
        code: existingType === serviceType ? "SAME_SERVICE_REQUEST" : "CROSS_SERVICE_REQUEST",
        message: existingType === serviceType
          ? `같은 기간에 처리 중인 ${serviceMetaFor(existingType).label} 신청이 있습니다.`
          : `처리 중인 ${serviceMetaFor(existingType).label} 신청과 기간이 겹칩니다. 두 서비스의 날짜가 겹치지 않도록 조정해 주세요.`,
      };
    }
    return null;
  }

  function minimumBabysittingStartDate(clientId) {
    void clientId;
    return startOfLocalDay(new Date());
  }

  function activePostpartumForClient(client, babyId = client?.babyId || null, babyName = client?.babyName || "") {
    if (!client) return null;
    const now = new Date();
    return state.assignments.find((assignment) => {
      if (assignment.clientId !== client.id || assignment.status === "CANCELLED" || assignmentServiceType(assignment) !== "POSTPARTUM") return false;
      if (!itemMatchesBaby(assignment, client, babyId, babyName)) return false;
      return new Date(assignment.startAt) <= now && new Date(assignment.endAt) >= now;
    }) || null;
  }

  function currentAssignmentFor(userId, serviceType = null) {
    const recoveredAssignment = state.session.active
      ? state.assignments.find((assignment) => assignment.id === state.session.assignmentId && assignment.caregiverUserId === userId && assignment.status !== "CANCELLED" && (serviceType ? assignmentServiceType(assignment) === serviceType : assignmentServiceType(assignment) !== "MASSAGE"))
      : null;
    if (recoveredAssignment) return recoveredAssignment;
    const todaysAssignments = state.assignments
      .filter((assignment) => assignment.caregiverUserId === userId && assignmentAcceptsCareEntriesToday(assignment) && (serviceType ? assignmentServiceType(assignment) === serviceType : assignmentServiceType(assignment) !== "MASSAGE"))
      .sort((a, b) => String(a.dailyStart).localeCompare(String(b.dailyStart)));
    return todaysAssignments.find((assignment) => state.session.active && state.session.assignmentId === assignment.id)
      || todaysAssignments.find((assignment) => assignment.todayCareSessionStatus !== "COMPLETED" && !(state.session.assignmentId === assignment.id && state.session.endedAt))
      || todaysAssignments.at(-1)
      || null;
  }

  function assignmentCompletedToday(assignment) {
    return assignment?.todayCareSessionStatus === "COMPLETED"
      || (!usingCloudData()
        && state.session.assignmentId === assignment?.id
        && state.session.serviceDate === localDateKey(new Date())
        && Boolean(state.session.endedAt));
  }

  function nextAssignmentFor(userId, serviceType = null) {
    const now = new Date();
    return state.assignments
      .filter((assignment) => assignment.caregiverUserId === userId && new Date(assignment.startAt) > now && assignment.status !== "CANCELLED" && (serviceType ? assignmentServiceType(assignment) === serviceType : assignmentServiceType(assignment) !== "MASSAGE"))
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0] || null;
  }

  const CAREGIVER_CLIENT_BRIEF_DAYS = 7;

  function caregiverClientBriefOpensAt(assignment) {
    if (!assignment?.startAt) return null;
    const opensAt = startOfLocalDay(assignment.startAt);
    if (Number.isNaN(opensAt.getTime())) return null;
    opensAt.setDate(opensAt.getDate() - CAREGIVER_CLIENT_BRIEF_DAYS);
    return opensAt;
  }

  function caregiverCanViewClientBrief(assignment, referenceDate = new Date()) {
    const opensAt = caregiverClientBriefOpensAt(assignment);
    return Boolean(opensAt && startOfLocalDay(referenceDate).getTime() >= opensAt.getTime());
  }

  function caregiverClientBriefAccessText(assignment) {
    const opensAt = caregiverClientBriefOpensAt(assignment);
    return opensAt
      ? `고객 정보는 ${formatDate(opensAt)}부터 확인할 수 있습니다.`
      : "고객 정보 공개일을 확인할 수 없습니다.";
  }

  function selectedServiceTypeForRole(role = state.role) {
    const view = state.views[role];
    if (view === "postpartum") return "POSTPARTUM";
    if (view === "babysitting") return "BABYSITTING";
    return null;
  }

  function activeAssignmentContext() {
    const user = authUser();
    const serviceType = selectedServiceTypeForRole();
    if (!user) return null;
    if (state.role === "client") {
      const client = clientForUser(user.id);
      return client ? selectedClientAssignment(client.id, serviceType) : null;
    }
    if (state.role === "caregiver") return currentAssignmentFor(user.id, serviceType);
    if (state.role === "admin") return assignmentForClient(state.adminSelectedClientId, serviceType);
    return null;
  }

  function isDateOnlyValue(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function parseLocalDateValue(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (isDateOnlyValue(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(year, month - 1, day, 12, 0, 0, 0);
    }
    return new Date(value);
  }

  function localDateKey(value) {
    if (isDateOnlyValue(value)) return value;
    const date = parseLocalDateValue(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dateKeyInTimeZone(value, timeZone) {
    const date = parseLocalDateValue(value);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  function easternDateKey(value = new Date()) {
    return dateKeyInTimeZone(value, "America/New_York");
  }

  function formatDate(value, options = undefined) {
    if (!value) return "";
    return parseLocalDateValue(value).toLocaleDateString("ko-KR", options);
  }

  function formatDateTime(value) {
    if (!value) return "";
    return parseLocalDateValue(value).toLocaleString("ko-KR", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function startOfLocalDay(value = new Date()) {
    const date = parseLocalDateValue(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  let calendarPickerInput = null;
  let calendarPickerCursor = null;
  let calendarPickerReturnFocus = null;
  let calendarPickerPreviousInert = null;
  let enhancedDateInputSequence = 0;

  function dateSelectionLabel(value) {
    if (!value) return "날짜를 선택해 주세요";
    const date = parseLocalDateValue(value);
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${KOREAN_WEEKDAYS[date.getDay()]})`;
  }

  function refreshEnhancedDateInput(input) {
    const wrapper = input.closest(".date-enhancement");
    if (!wrapper) return;
    const trigger = wrapper.querySelector("[data-date-picker-trigger]");
    const summary = wrapper.querySelector(".date-summary");
    const label = dateSelectionLabel(input.value);
    if (trigger) {
      trigger.disabled = input.disabled || input.readOnly;
      trigger.setAttribute("aria-disabled", String(input.disabled || input.readOnly));
      trigger.innerHTML = `<span>${escapeHtml(label)}</span><b aria-hidden="true">▣</b>`;
    }
    if (summary) summary.textContent = input.value ? `선택: ${label}` : "";
  }

  function enhanceDateInputs(root = document) {
    root.querySelectorAll?.('input[type="date"]:not([data-date-enhanced])').forEach((input) => {
      input.dataset.dateEnhanced = "true";
      input.classList.add("native-date-input");
      input.tabIndex = -1;
      input.setAttribute("aria-hidden", "true");
      const wrapper = document.createElement("div");
      wrapper.className = "date-enhancement";
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);
      wrapper.insertAdjacentHTML("beforeend", '<button class="date-picker-trigger" type="button" data-date-picker-trigger></button><div class="date-summary" aria-live="polite"></div>');
      const trigger = wrapper.querySelector("[data-date-picker-trigger]");
      const sequence = ++enhancedDateInputSequence;
      const sourceId = input.id || `enhanced-date-${sequence}`;
      const triggerId = `${sourceId}-picker`;
      const summary = wrapper.querySelector(".date-summary");
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      trigger.id = triggerId;
      summary.id = `${triggerId}-summary`;
      trigger.setAttribute("aria-describedby", summary.id);
      if (label) {
        label.id ||= `${triggerId}-label`;
        label.htmlFor = triggerId;
        trigger.setAttribute("aria-labelledby", label.id);
      } else {
        trigger.setAttribute("aria-label", input.getAttribute("aria-label") || "날짜 선택");
      }
      trigger.addEventListener("click", () => openCalendarPicker(input));
      input.addEventListener("change", () => refreshEnhancedDateInput(input));
      input.addEventListener("invalid", (event) => {
        event.preventDefault();
        openCalendarPicker(input);
      });
      refreshEnhancedDateInput(input);
    });
  }

  function calendarDateAllowed(input, value) {
    return (!input.min || value >= input.min) && (!input.max || value <= input.max);
  }

  function addCalendarDays(value, amount) {
    const date = parseLocalDateValue(value);
    date.setDate(date.getDate() + amount);
    return localDateKey(date);
  }

  function nextWeekdayDate(value) {
    const date = parseLocalDateValue(value);
    do date.setDate(date.getDate() + 1); while ([0, 6].includes(date.getDay()));
    return localDateKey(date);
  }

  function openCalendarPicker(input) {
    if (input.disabled || input.readOnly) {
      showToast("이 날짜는 현재 일정 정책에 따라 변경할 수 없습니다.", "info");
      return;
    }
    calendarPickerInput = input;
    calendarPickerReturnFocus = input.closest(".date-enhancement")?.querySelector("[data-date-picker-trigger]") || document.activeElement;
    calendarPickerPreviousInert = { app: app.inert, modal: modalRoot.inert };
    const baseValue = input.value || input.min || localDateKey(new Date());
    const baseDate = parseLocalDateValue(baseValue);
    calendarPickerCursor = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1, 12, 0, 0, 0);
    renderCalendarPicker();
  }

  function renderCalendarPicker() {
    document.querySelector("[data-calendar-picker-root]")?.remove();
    if (!calendarPickerInput || !calendarPickerCursor) return;
    const firstDay = new Date(calendarPickerCursor.getFullYear(), calendarPickerCursor.getMonth(), 1, 12, 0, 0, 0);
    const gridStart = new Date(firstDay);
    gridStart.setDate(gridStart.getDate() - firstDay.getDay());
    const todayKey = localDateKey(new Date());
    const selectedKey = calendarPickerInput.value;
    const dayButtons = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const key = localDateKey(date);
      const outside = date.getMonth() !== calendarPickerCursor.getMonth();
      const allowed = calendarDateAllowed(calendarPickerInput, key);
      return `<button type="button" role="gridcell" tabindex="-1" class="calendar-day ${outside ? "outside" : ""} ${key === todayKey ? "today" : ""} ${key === selectedKey ? "selected" : ""}" data-calendar-day="${key}" aria-label="${dateSelectionLabel(key)}" aria-selected="${key === selectedKey}" ${key === todayKey ? 'aria-current="date"' : ""} ${allowed ? "" : "disabled aria-disabled=\"true\""}>${date.getDate()}</button>`;
    }).join("");
    const quickCandidates = [
      ["오늘", todayKey],
      ["1주 후", addCalendarDays(todayKey, 7)],
      ["다음 평일", nextWeekdayDate(todayKey)],
    ].filter(([, value], index, entries) => calendarDateAllowed(calendarPickerInput, value) && entries.findIndex((item) => item[1] === value) === index);
    const currentYear = new Date().getFullYear();
    const minimumYear = calendarPickerInput.min ? parseLocalDateValue(calendarPickerInput.min).getFullYear() : currentYear - 100;
    const maximumYear = calendarPickerInput.max ? parseLocalDateValue(calendarPickerInput.max).getFullYear() : currentYear + 10;
    const cursorYear = calendarPickerCursor.getFullYear();
    const yearStart = Math.min(minimumYear, cursorYear);
    const yearEnd = Math.max(maximumYear, cursorYear);
    const yearOptions = Array.from({ length: yearEnd - yearStart + 1 }, (_, index) => yearStart + index)
      .map((year) => `<option value="${year}" ${year === cursorYear ? "selected" : ""}>${year}년</option>`)
      .join("");
    const monthOptions = Array.from({ length: 12 }, (_, index) => index)
      .map((month) => `<option value="${month}" ${month === calendarPickerCursor.getMonth() ? "selected" : ""}>${month + 1}월</option>`)
      .join("");
    const root = document.createElement("div");
    root.dataset.calendarPickerRoot = "true";
    root.className = "calendar-picker-backdrop";
    root.innerHTML = `<section class="calendar-picker" role="dialog" aria-modal="true" aria-label="날짜 선택"><header class="calendar-picker-header"><button type="button" data-calendar-month="-1" aria-label="이전 달">‹</button><div class="calendar-period-selectors"><label><span class="sr-only">연도</span><select data-calendar-year aria-label="연도 선택">${yearOptions}</select></label><label><span class="sr-only">월</span><select data-calendar-month-select aria-label="월 선택">${monthOptions}</select></label></div><button type="button" data-calendar-month="1" aria-label="다음 달">›</button></header><div class="calendar-picker-grid" role="grid" aria-label="${cursorYear}년 ${calendarPickerCursor.getMonth() + 1}월"><span role="columnheader">일</span><span role="columnheader">월</span><span role="columnheader">화</span><span role="columnheader">수</span><span role="columnheader">목</span><span role="columnheader">금</span><span role="columnheader">토</span>${dayButtons}</div>${quickCandidates.length ? `<div class="calendar-quick-actions">${quickCandidates.map(([label, value]) => `<button type="button" data-calendar-quick="${value}">${label}</button>`).join("")}</div>` : ""}<div class="calendar-quick-actions"><button type="button" data-close-calendar>닫기</button></div></section>`;
    document.body.appendChild(root);
    app.inert = true;
    modalRoot.inert = true;
    root.addEventListener("click", (event) => { if (event.target === root) closeCalendarPicker(); });
    root.querySelectorAll("[data-calendar-month]").forEach((button) => button.addEventListener("click", () => {
      calendarPickerCursor.setMonth(calendarPickerCursor.getMonth() + Number(button.dataset.calendarMonth));
      renderCalendarPicker();
    }));
    root.querySelector("[data-calendar-year]")?.addEventListener("change", (event) => {
      calendarPickerCursor.setFullYear(Number(event.target.value));
      renderCalendarPicker();
    });
    root.querySelector("[data-calendar-month-select]")?.addEventListener("change", (event) => {
      calendarPickerCursor.setMonth(Number(event.target.value));
      renderCalendarPicker();
    });
    root.querySelectorAll("[data-calendar-day]").forEach((button) => button.addEventListener("click", () => selectCalendarDate(button.dataset.calendarDay)));
    root.querySelectorAll("[data-calendar-quick]").forEach((button) => button.addEventListener("click", () => selectCalendarDate(button.dataset.calendarQuick)));
    root.querySelector("[data-close-calendar]").addEventListener("click", closeCalendarPicker);
    const initialDay = root.querySelector('.calendar-day[aria-selected="true"]:not([disabled])') || root.querySelector(".calendar-day:not([disabled])");
    if (initialDay) initialDay.tabIndex = 0;
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.stopPropagation(); closeCalendarPicker(); return; }
      const focusables = focusableElements(root);
      if (event.key === "Tab" && focusables.length) {
        const first = focusables[0];
        const last = focusables.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      const day = event.target.closest?.("[data-calendar-day]");
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
      if (!day || !step) return;
      event.preventDefault();
      const days = [...root.querySelectorAll("[data-calendar-day]")];
      let index = days.indexOf(day) + step;
      while (days[index]?.disabled) index += Math.sign(step);
      if (days[index]) {
        day.tabIndex = -1;
        days[index].tabIndex = 0;
        days[index].focus();
      }
    });
    window.setTimeout(() => initialDay?.focus(), 0);
  }

  function selectCalendarDate(value) {
    if (!calendarPickerInput || !calendarDateAllowed(calendarPickerInput, value)) return;
    calendarPickerInput.value = value;
    calendarPickerInput.dispatchEvent(new Event("input", { bubbles: true }));
    calendarPickerInput.dispatchEvent(new Event("change", { bubbles: true }));
    refreshEnhancedDateInput(calendarPickerInput);
    closeCalendarPicker();
  }

  function closeCalendarPicker() {
    document.querySelector("[data-calendar-picker-root]")?.remove();
    const returnFocus = calendarPickerReturnFocus;
    calendarPickerInput = null;
    calendarPickerCursor = null;
    calendarPickerReturnFocus = null;
    app.inert = calendarPickerPreviousInert?.app || false;
    modalRoot.inert = calendarPickerPreviousInert?.modal || false;
    calendarPickerPreviousInert = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  function daysFromToday(value) {
    return Math.round((startOfLocalDay(value) - startOfLocalDay()) / 86400000);
  }

  function hoursUntil(value) {
    return (new Date(value).getTime() - Date.now()) / 3600000;
  }

  function adjustmentTarget(targetType, targetId) {
    return targetType === "ASSIGNMENT"
      ? state.assignments.find((item) => item.id === targetId)
      : state.serviceRequests.find((item) => item.id === targetId);
  }

  function adjustmentTargetStart(target) {
    return target?.startAt || target?.desiredStartDate;
  }

  function pendingAdjustment(targetType, targetId) {
    return state.serviceAdjustments.find((item) => item.targetType === targetType && item.targetId === targetId && item.status === "PENDING") || null;
  }

  function adjustmentPolicy(serviceType, startAt, target = null, action = "CANCEL") {
    if (serviceType === "MASSAGE") {
      const hours = hoursUntil(startAt);
      const allowed = hours >= MASSAGE_CHANGE_NOTICE_HOURS;
      return {
        code: allowed ? "MASSAGE_STANDARD_24H" : "MASSAGE_LATE_24H",
        tone: allowed ? "success" : "warning",
        allowed,
        title: allowed ? `마사지 ${action === "CHANGE" ? "변경" : "취소"} 가능` : `마사지 ${action === "CHANGE" ? "변경" : "취소"} 가능 시간 경과`,
        detail: allowed ? `예약 시작까지 ${Math.floor(hours)}시간 남았습니다. 24시간 이전 요청이므로 관리자에게 접수할 수 있습니다.` : "마사지 변경·취소는 예약 시작 24시간 이전까지만 가능합니다.",
      };
    }
    if (action === "CHANGE") return { code: "SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY", tone: "success", title: "일정 변경 예약금 페널티 없음", detail: "기간·시간 변경은 서비스 취소가 아니므로 예약금 차감이나 환불 페널티가 없습니다. 관리자 승인 후 변경 일정만 반영됩니다." };
    if (serviceType === "POSTPARTUM") {
      if (target && isPostpartumServiceStarted(target)) {
        const settlement = postpartumCancellationSettlement(target);
        return {
          code: "POSTPARTUM_ACTIVE_PRORATED",
          tone: "warning",
          title: `중도 취소 정산금 ${money(settlement.settlementAmount)}`,
          detail: `(당초 총 서비스 예정비용 ${money(settlement.originalTotal)} - 예약금 ${money(settlement.deposit)}) ÷ 잔여 케어일수 ${settlement.remainingCareDays}일로 계산합니다. 서비스 시작 후 예약금은 환불되지 않습니다.`,
          ...settlement,
        };
      }
      const hours = hoursUntil(startAt);
      const displayHours = Math.max(0, Math.floor(hours));
      const refundCutoffHours = POSTPARTUM_REFUND_DAYS * 24;
      return hours > refundCutoffHours
        ? { code: "DEPOSIT_REFUNDABLE", tone: "success", title: `$${POSTPARTUM_DEPOSIT} 예약금 환불 가능`, detail: `실제 서비스 시작시각까지 ${displayHours}시간 남았습니다. 30일(720시간)을 초과해 남은 취소이므로 예약금 전액 환불 대상입니다.` }
        : { code: "DEPOSIT_NON_REFUNDABLE", tone: "warning", title: `$${POSTPARTUM_DEPOSIT} 예약금 환불 불가`, detail: `실제 서비스 시작시각까지 ${displayHours}시간 남았습니다. 30일(720시간) 이내 취소 규정이 적용됩니다.` };
    }
    const hours = hoursUntil(startAt);
    const displayHours = Math.max(0, Math.floor(hours));
    if (hours > BABYSITTING_STANDARD_NOTICE_HOURS) return { code: "BABYSITTING_DEPOSIT_REFUNDABLE", tone: "success", title: `$${BABYSITTING_DEPOSIT} 예약금 환불 가능`, detail: `서비스 시작 ${displayHours}시간 전입니다. 72시간 이전 취소이므로 4시간분 예약금 전액 환불 대상입니다.` };
    return { code: "BABYSITTING_DEPOSIT_NON_REFUNDABLE", tone: "warning", title: `$${BABYSITTING_DEPOSIT} 예약금 환불 불가`, detail: `서비스 시작까지 ${displayHours}시간 남아 72시간 이내 취소 규정이 적용됩니다. 노쇼도 예약금 환불이 불가합니다.` };
  }

  function latestServiceEnd(clientId, serviceType, babyId = null, babyName = "") {
    const client = clientById(clientId);
    const dates = state.assignments
      .filter((item) => item.clientId === clientId && item.status !== "CANCELLED" && assignmentServiceType(item) === serviceType && itemMatchesBaby(item, client, babyId, babyName))
      .map((item) => new Date(item.endAt));
    state.serviceRequests
      .filter((item) => item.clientId === clientId && ["PENDING", "APPROVED"].includes(item.status) && !item.approvedAssignmentId && assignmentServiceType(item) === serviceType && itemMatchesBaby(item, client, babyId, babyName))
      .forEach((item) => dates.push(requestWindow(item).endAt));
    return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
  }

  function nextWeekdayAfter(value) {
    const date = startOfLocalDay(value);
    date.setDate(date.getDate() + 1);
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    return date;
  }

  function assignmentCountdown(assignment) {
    const untilStart = daysFromToday(assignment.startAt);
    if (untilStart > 0) return `D-${untilStart}`;
    if (untilStart === 0) return "D-Day";
    const untilEnd = daysFromToday(assignment.endAt);
    return untilEnd >= 0 ? `종료 D-${untilEnd}` : "종료";
  }

  function isProfessionalStaffActive(user) {
    const hasCaregiverAccess = usingCloudData() ? user?.databaseRoles?.includes("CAREGIVER") : user?.role === "caregiver";
    const caregiverStatus = user?.caregiverStatus || user?.status;
    if (!hasCaregiverAccess || caregiverStatus !== "approved" || user.employmentStatus !== "ACTIVE") return false;
    return !usingCloudData() || user.hasHrProfile === true;
  }

  function caregiverHasServiceCapability(user, serviceType) {
    if (serviceType === "POSTPARTUM") return user?.canProvidePostpartum !== false;
    if (serviceType === "BABYSITTING") return user?.canProvideBabysitting !== false;
    if (serviceType === "MASSAGE") return Boolean(user?.isMassageTherapist);
    return Boolean(user?.canProvidePostpartum !== false || user?.canProvideBabysitting !== false);
  }

  function isCaregiverAssignable(user, serviceType = null) {
    return isProfessionalStaffActive(user) && caregiverHasServiceCapability(user, serviceType);
  }

  function isCaregiverPendingApproval(user) {
    const hasCaregiverAccess = usingCloudData() ? user?.databaseRoles?.includes("CAREGIVER") : user?.role === "caregiver";
    return Boolean(
      hasCaregiverAccess
      && (user.caregiverStatus || user.status) === "pending"
      && (!usingCloudData() || !["SUSPENDED", "REJECTED"].includes(user.accountStatus)),
    );
  }

  function accessibleClientIds() {
    const user = authUser();
    if (!user) return [];
    if (state.role === "admin") return state.clients.map((client) => client.id);
    if (state.role === "client") return state.clients.filter((client) => client.userId === user.id || client.memberUserIds?.includes(user.id)).map((client) => client.id);
    if (state.role === "caregiver") {
      const latestVisible = startOfLocalDay();
      latestVisible.setDate(latestVisible.getDate() + CAREGIVER_CLIENT_BRIEF_DAYS);
      return state.assignments
        .filter((assignment) => assignment.caregiverUserId === user.id
          && assignment.status !== "CANCELLED"
          && new Date(assignment.startAt) <= latestVisible)
        .map((assignment) => assignment.clientId);
    }
    return [];
  }

  function canAccessClient(clientId) {
    return accessibleClientIds().includes(clientId);
  }

  function activeClientId() {
    const user = authUser();
    if (!user) return null;
    if (state.role === "client") return clientForUser(user.id)?.id || null;
    if (state.role === "caregiver") return activeAssignmentContext()?.clientId || null;
    if (state.role === "admin") return canAccessClient(state.adminSelectedClientId) ? state.adminSelectedClientId : accessibleClientIds()[0] || null;
    return null;
  }

  function visibleCareEvents(assignmentOverride = null) {
    const allowed = accessibleClientIds();
    const contextId = activeClientId();
    const assignment = assignmentOverride || activeAssignmentContext() || (contextId ? assignmentForClient(contextId) : null);
    const sessionMatchesAssignment = state.session.assignmentId === assignment?.id;
    const sessionId = sessionMatchesAssignment ? state.session.id : null;
    const sessionDateKey = sessionMatchesAssignment && state.session.serviceDate
      ? state.session.serviceDate
      : localDateKey(new Date());
    const allowedEventTypes = assignmentServiceType(assignment) === "BABYSITTING" ? ["meal", "sitter_note"] : ["feeding", "diaper", "sleep", "temperature", "bath", "weight", "mother", "note"];
    return state.events.filter((event) => allowed.includes(event.clientId)
      && (!contextId || event.clientId === contextId)
      && (!assignment || event.assignmentId === assignment.id)
      && (sessionId ? event.careSessionId === sessionId : objectiveEventDateKey(event) === sessionDateKey)
      && allowedEventTypes.includes(event.type));
  }

  function assignmentCareEvents(assignment) {
    if (!assignment?.id) return [];
    const allowed = accessibleClientIds();
    const contextId = activeClientId();
    const allowedEventTypes = assignmentServiceType(assignment) === "BABYSITTING"
      ? ["meal", "sitter_note"]
      : ["feeding", "diaper", "sleep", "temperature", "bath", "weight", "mother", "note"];
    return state.events.filter((event) => allowed.includes(event.clientId)
      && (!contextId || event.clientId === contextId)
      && event.assignmentId === assignment.id
      && allowedEventTypes.includes(event.type));
  }

  function activeSessionIsStale(assignment = null) {
    return Boolean(
      state.session.active
      && state.session.serviceDate
      && state.session.serviceDate !== localDateKey(new Date())
      && (!assignment || state.session.assignmentId === assignment.id),
    );
  }

  function staleSessionBannerMarkup() {
    if (!activeSessionIsStale()) return "";
    return `<div class="status-banner warning stale-session-banner"><strong>${formatDate(`${state.session.serviceDate}T12:00:00`)} 근무가 아직 종료되지 않았습니다.</strong><span>기록은 날짜 무결성을 위해 잠겼습니다. 기존 기록을 확인한 뒤 먼저 ‘케어 종료’를 눌러 주세요.</span></div>`;
  }

  function currentView() {
    const available = navItemsForRole(state.role);
    const requested = state.views[state.role];
    const fallback = available.find((item) => item.id !== "sitehome") || available[0];
    return available.some((item) => item.id === requested && item.id !== "sitehome") ? requested : fallback.id;
  }

  function navItemsForRole(role) {
    let items = NAV[role] || [];
    if (usingCloudData()) {
      const liveViews = {
        admin: new Set(["overview", "schedule", "massage", "requests", "finance", "history", "people", "reports"]),
        caregiver: new Set(["caregiving", "postpartum", "babysitting", "reports", "profile"]),
        therapist: new Set(["availability", "calendar"]),
        client: new Set(["services", "postpartum", "babysitting", "reports"]),
        retail: new Set(["pos"]),
      };
      items = items.filter((item) => liveViews[role]?.has(item.id));
      if (role === "admin" && hasDatabaseRole("CARE_MANAGER") && !hasDatabaseRole("OWNER") && !hasDatabaseRole("ADMIN")) {
        items = items.filter((item) => ["overview", "schedule", "reports"].includes(item.id));
      }
      if (role === "retail") items = items.map((item) => ({ ...item, label: "리테일 준비 중" }));
    }
    if (role === "caregiver") {
      const user = authUser();
      if (user && user.canProvidePostpartum === false) items = items.filter((item) => item.id !== "postpartum");
      if (user && user.canProvideBabysitting === false) items = items.filter((item) => item.id !== "babysitting");
    }
    if (role === "client") {
      return [{ id: "sitehome", label: "홈페이지", icon: "⌂" }, ...items];
    }
    return items;
  }

  function roleOptions(selectedRole) {
    return Object.entries(ROLE_META)
      .map(([key, value]) => `<option value="${key}" ${key === selectedRole ? "selected" : ""}>${value.label}</option>`)
      .join("");
  }

  function navMarkup(location) {
    const active = currentView();
    return navItemsForRole(state.role)
      .map(
        (item) => `
          <button class="nav-item ${item.id === active ? "active" : ""}" data-nav="${item.id}" aria-current="${item.id === active ? "page" : "false"}">
            <span class="nav-icon" aria-hidden="true">${item.icon}</span>
            <span>${item.label}</span>
          </button>`,
      )
      .join("");
  }

  function pageTitle() {
    const view = state.views[state.role];
    const serviceType = selectedServiceTypeForRole();
    const roleTitles = {
      admin: ["Operations", "오늘의 운영 흐름을 한눈에 확인하세요."],
      caregiver: [view === "caregiving" ? "My Caregiving" : view === "reports" ? "Care Reports" : serviceType === "BABYSITTING" ? "Babysitting Caregiving" : "Postpartum Caregiving", view === "caregiving" ? "두 서비스의 현재·다음 배정을 한눈에 확인하세요." : view === "reports" ? "내가 입력한 케어 기록을 기간별로 확인하세요." : serviceType === "BABYSITTING" ? "식사와 생활 이벤트를 간결하게 기록하세요." : "산모와 신생아의 케어 기록에 집중하세요."],
      therapist: [view === "availability" ? "My Availability" : "Massage Calendar", view === "availability" ? "이번 주와 다음 주의 마사지 가능시간을 간편하게 등록하세요." : "확정된 마사지 방문 일정만 분리해 확인하세요."],
      client: [view === "services" ? "My Services" : view === "reports" ? "Care Reports" : serviceType === "BABYSITTING" ? "My Babysitting" : "My Postpartum Care", view === "services" ? "이용 중인 서비스와 신청·배정 상태를 한눈에 확인하세요." : view === "reports" ? "나와 아이의 케어 기록을 기간별로 확인하세요." : "선택한 서비스의 일정과 돌봄 기록만 안전하게 표시됩니다."],
      retail: ["Retail Workspace", "판매·재고·고객 관계를 하나의 흐름으로 관리하세요."],
    };
    return roleTitles[state.role];
  }

  function shellMarkup(content) {
    const [title, subtitle] = pageTitle();
    const profile = authUser() || ROLE_META[state.role];
    return `
      <div class="app-shell">
        <aside class="sidebar">
          <button class="brand brand-home-button" type="button" data-public-home aria-label="ProMoms 홈페이지 메인으로 이동" title="홈페이지 메인으로 이동">
            <span class="brand-mark">${brandLogoMarkup()}</span>
            <span class="brand-copy"><strong>ProMoms</strong><small>CARE · BABY · BEAUTY</small></span>
          </button>
          ${workspaceSwitcherMarkup("sidebar")}
          <div class="side-section-label">Menu</div>
          <nav class="side-nav" aria-label="주요 메뉴">${navMarkup("side")}</nav>
          <div class="sidebar-footer">
            <div class="privacy-note"><span>◈</span><span>민감한 케어 정보는 역할별 권한으로 보호됩니다.</span></div>
          </div>
        </aside>

        <main class="main-area">
          <header class="mobile-header">
            <button class="mobile-brand mobile-brand-home-button" type="button" data-public-home aria-label="ProMoms 홈페이지 메인으로 이동"><span class="brand-mark">${brandLogoMarkup()}</span><strong>ProMoms</strong></button>
            <details class="mobile-account-menu"><summary>${escapeHtml(ROLE_META[state.role]?.label || "계정")}</summary><div class="mobile-account-actions">${workspaceSwitcherMarkup("mobile")}${state.role === "client" ? `<button class="mobile-logout" data-public-home>일반 사이트</button>` : ""}<button class="mobile-logout" data-edit-profile>프로필 수정</button><button class="mobile-logout" data-change-password>비밀번호 변경</button><button class="mobile-logout" data-logout>로그아웃</button></div></details>
          </header>
          <header class="topbar">
            <div class="topbar-title"><h1>${title}</h1><p>${subtitle}</p></div>
            <div class="top-actions">
              ${profile.mustChangePassword ? `<span class="status-chip coral">초기 비밀번호 변경 필요</span>` : ""}
              ${state.role === "client" ? `<button class="account-button" data-public-home>일반 사이트</button>` : ""}<button class="account-button" data-edit-profile>프로필 수정</button><button class="account-button" data-change-password>비밀번호 변경</button>
              <button class="account-button" data-logout>로그아웃</button>
              <div class="avatar" title="${escapeHtml(profile.fullName || profile.name)}">${escapeHtml(profile.initials)}</div>
            </div>
          </header>
          ${content}
          <nav class="bottom-nav items-${navItemsForRole(state.role).length}" aria-label="모바일 주요 메뉴">${navMarkup("bottom")}</nav>
        </main>
      </div>`;
  }

  function demoBanner() {
    if (usingCloudData()) return "";
    return `
      <div class="demo-banner">
        <span>로컬 데이터 모드입니다. 입력한 내용은 이 브라우저에만 저장됩니다.</span>
        <button data-reset-demo>로컬 데이터 초기화</button>
      </div>`;
  }

  function pageHeading(eyebrow, title, description) {
    return `
      <div class="page-heading">
        <div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${description}</p></div>
        <div class="date-chip">◷ ${todayLabel()}</div>
      </div>`;
  }

  function statCard(label, value, foot, icon) {
    return `
      <article class="card stat-card">
        <div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span></div>
        <div class="stat-value">${value}</div><div class="stat-foot">${foot}</div>
      </article>`;
  }

  function postpartumEstimate(weeks, mode = "COMMUTE") {
    const normalizedWeeks = mode === "LIVE_IN" ? 4 : Math.max(MIN_SERVICE_WEEKS, Number(weeks || MIN_SERVICE_WEEKS));
    return (mode === "LIVE_IN" ? POSTPARTUM_LIVE_IN_WEEKLY_RATE : POSTPARTUM_WEEKLY_RATE) * normalizedWeeks;
  }

  function todayScheduleItems() {
    return state.assignments
      .filter(assignmentIsScheduledToday)
      .sort((first, second) => String(first.dailyStart).localeCompare(String(second.dailyStart)))
      .map((assignment) => {
        const client = clientById(assignment.clientId);
        const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId);
        const inProgress = state.session.active && state.session.assignmentId === assignment.id;
        return {
          time: assignment.dailyStart,
          client: client ? `${client.motherName} · ${babyNameFor(assignment, client) || "아이"}` : "고객 정보 확인 필요",
          caregiver: `${caregiver?.fullName || "관리사 미배정"} · ${serviceMetaFor(assignment.serviceType).label}`,
          status: inProgress ? "진행 중" : "오늘 예정",
          tone: inProgress ? "mint" : "gold",
        };
      });
  }

  function adminOverview() {
    const activeAssignments = state.assignments.filter(isAssignmentCurrent);
    const caregivers = state.users.filter(isCaregiverAssignable);
    const pendingRequests = state.serviceRequests.filter((request) => request.status === "PENDING");
    const babysittingQueue = state.serviceRequests.filter((request) => request.status === "APPROVED" && !request.approvedAssignmentId && assignmentServiceType(request) === "BABYSITTING");
    const pendingCaregivers = state.users.filter(isCaregiverPendingApproval);
    const todaySchedules = todayScheduleItems();
    const attentionCount = Number(babysittingQueue.length > 0) + Number(pendingRequests.length > 0) + Number(pendingCaregivers.length > 0);
    const administratorName = authUser()?.fullName || "관리자";
    return `
      <section class="page">
        ${demoBanner()}
        ${pageHeading("ProMoms OPERATIONS", `${escapeHtml(administratorName)}님, 안녕하세요.`, "오늘의 실제 케어 일정과 확인이 필요한 운영 항목입니다.")}
        <div class="grid stats">
          ${statCard("Active Care", activeAssignments.length, `${activeAssignments.filter((item) => assignmentServiceType(item) === "POSTPARTUM").length} 산후조리 · ${activeAssignments.filter((item) => assignmentServiceType(item) === "BABYSITTING").length} 베이비시팅`, "♡")}
          ${statCard("Active Caregivers", caregivers.length, "승인·배정 가능 상태", "♙")}
          ${statCard("Babysitting Queue", babysittingQueue.length, "승인 완료·배정 대기", "☆")}
          ${statCard("Pending Requests", pendingRequests.length, "신청 검토 필요", "+")}
        </div>
        <div class="grid two" style="margin-top:18px">
          <article class="card card-pad">
            <div class="section-header"><div><h3>오늘의 일정</h3><p>관리사 배정과 방문 상태</p></div><button class="text-button" data-nav="schedule">전체 보기 →</button></div>
            <div class="schedule-list">${todaySchedules.length ? scheduleRows(todaySchedules.slice(0, 3)) : `<div class="empty-state compact"><strong>오늘 배정된 일정이 없습니다.</strong><span>승인된 신청을 일정·배정 메뉴에서 배치할 수 있습니다.</span></div>`}</div>
          </article>
          <article class="card card-pad">
            <div class="section-header"><div><h3>확인이 필요해요</h3><p>실제 승인·배정 후속 조치</p></div><span class="status-chip coral">${attentionCount} items</span></div>
            <div class="attention-list">
              ${babysittingQueue.length ? attentionItem("☆", "베이비시팅 일정 배정", `${babysittingQueue.length}건 · 신청 희망일과 관리사 일정 확인`) : ""}
              ${pendingRequests.length ? attentionItem("+", "서비스 신청 검토", `${pendingRequests.length}건 · 예약금과 일정 중복 확인`) : ""}
              ${pendingCaregivers.length ? attentionItem("♙", "관리사 가입 승인", `${pendingCaregivers.length}건 · 자격 및 고용정보 확인`) : ""}
              ${attentionCount ? "" : `<div class="empty-state compact"><strong>대기 중인 후속 조치가 없습니다.</strong></div>`}
            </div>
          </article>
        </div>
      </section>`;
  }

  function scheduleRows(schedules) {
    return schedules
      .map(
        (item) => `
          <div class="schedule-row">
            <div class="schedule-time">${item.time}</div>
            <div class="schedule-person"><strong>${escapeHtml(item.client)}</strong><span>${escapeHtml(item.caregiver)} · Home care</span></div>
            <span class="status-chip ${item.tone === "gold" ? "gold" : ""}">${item.status}</span>
          </div>`,
      )
      .join("");
  }

  function attentionItem(icon, title, detail) {
    return `<div class="attention-item"><div class="attention-icon">${icon}</div><div><strong>${title}</strong><span>${detail}</span></div></div>`;
  }

  function adminAssignmentActionsMarkup(assignment) {
    if (usingCloudData()) {
      const request = state.serviceRequests.find((item) => item.id === assignment.serviceRequestId || item.approvedAssignmentId === assignment.id);
      const paymentAction = request && canReviewServiceRequests()
        ? requestDepositNet(request) <= 0
          ? `<button class="primary-button mini-button" data-record-approved-deposit="${request.id}">${assignmentServiceType(request) === "MASSAGE" ? "서비스 결제" : "예약금"} 확인</button>`
          : requestOutstandingBalance(request) > 0
            ? `<button class="primary-button mini-button" data-record-service-balance="${request.id}">잔금 확인</button>`
            : '<span class="status-chip">수납 완료</span>'
        : "";
      return `<button class="secondary-button mini-button" data-edit-assignment="${assignment.id}">상세 보기</button>${paymentAction}`;
    }
    return `<button class="secondary-button mini-button" data-edit-assignment="${assignment.id}">변경</button><button class="danger-button mini-button" data-cancel-assignment="${assignment.id}">삭제</button>`;
  }

  function massageBookingStatusLabel(status) {
    return { PENDING: "관리자 승인 대기", CONFIRMED: "예약 확정", CANCELLED: "취소", COMPLETED: "완료" }[status] || status;
  }

  function massageBookingDateTime(booking) {
    const start = new Date(booking.startsAt);
    const end = new Date(booking.endsAt);
    return `${start.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })} · ${timeLabel(start)}–${timeLabel(end)}`;
  }

  function pendingMassageBookingChange(sessionId) {
    return (state.massageBookingChanges || []).find((change) => change.sessionId === sessionId && change.status === "PENDING") || null;
  }

  function massageBookingCardMarkup(booking, context = "admin") {
    const client = clientById(booking.clientId);
    const therapist = state.users.find((user) => user.caregiverId === booking.caregiverId || user.id === booking.caregiverUserId);
    const change = pendingMassageBookingChange(booking.id);
    const adjustable = booking.status === "CONFIRMED" && hoursUntil(booking.startsAt) > MASSAGE_CHANGE_NOTICE_HOURS && !change;
    const actions = context === "client" && booking.status === "CONFIRMED"
      ? `<button type="button" class="secondary-button mini-button" data-massage-session-change="${booking.id}" ${adjustable ? "" : "disabled"}>${change ? "변경·취소 검토 중" : adjustable ? "변경·취소" : "24시간 이내 변경 불가"}</button>`
      : "";
    return `<article id="massage-booking-${escapeHtml(booking.id)}" class="massage-booking-card ${String(booking.status).toLowerCase()}"><div class="massage-booking-date"><strong>${escapeHtml(massageBookingDateTime(booking))}</strong><span>${booking.durationMinutes || 60}분 · ${booking.sessionNumber}회차</span></div><div><strong>${escapeHtml(context === "therapist" ? client?.motherName || "고객" : therapist?.fullName || "테라피스트")}</strong><span>${context === "therapist" ? escapeHtml(booking.address || "방문 주소 확인") : "마사지 테라피스트"}</span></div><div><span class="status-chip ${booking.status === "PENDING" ? "gold" : booking.status === "CANCELLED" ? "coral" : ""}">${massageBookingStatusLabel(booking.status)}</span>${change ? `<small>${change.action === "CHANGE" ? "일정 변경" : "취소"} 요청 검토 중</small>` : ""}</div>${actions}</article>`;
  }

  function massageMonthCalendarMarkup(bookings) {
    const viewMonth = new Date(new Date().getFullYear(), new Date().getMonth() + state.calendarMonthOffset, 1);
    const gridStart = new Date(viewMonth);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(gridStart); day.setDate(day.getDate() + index); return day; });
    const weekdayHeader = ["일", "월", "화", "수", "목", "금", "토"].map((day) => `<div>${day}</div>`).join("");
    return `<div class="month-calendar massage-calendar" aria-label="${calendarMonthLabel()} 마사지 일정"><div class="month-weekdays">${weekdayHeader}</div><div class="month-grid">${days.map((day) => { const dateKey = localDateKey(day); const daily = bookings.filter((booking) => localDateKey(booking.startsAt) === dateKey && booking.status !== "CANCELLED"); const firstBooking = daily[0]; const dayClass = `${day.getMonth() !== viewMonth.getMonth() ? "outside" : ""} ${dateKey === localDateKey(new Date()) ? "today" : ""} ${daily.length ? "has-events" : ""}`; const mobileSummary = firstBooking ? `<a class="massage-day-summary" href="#massage-booking-${escapeHtml(firstBooking.id)}" aria-label="${day.getMonth() + 1}월 ${day.getDate()}일 마사지 예약 ${daily.length}건, 일정으로 이동"><span class="massage-day-dots" aria-hidden="true">${Array.from({ length: Math.min(daily.length, 3) }, () => "<i></i>").join("")}</span><strong>${daily.length}건</strong></a>` : ""; return `<div class="month-day ${dayClass.trim()}"><header>${day.getDate()}</header><div class="month-events">${daily.slice(0, 4).map((booking) => { const client = clientById(booking.clientId); return `<div class="month-event massage"><strong>✦ ${escapeHtml(client?.motherName || "고객")}</strong><span>${timeLabel(booking.startsAt)} · ${massageBookingStatusLabel(booking.status)}</span></div>`; }).join("")}${daily.length > 4 ? `<small>+${daily.length - 4}개</small>` : ""}${mobileSummary}</div></div>`; }).join("")}</div></div>`;
  }

  function adminMassageCalendar() {
    const bookings = [...(state.massageBookings || [])].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    const upcoming = bookings.filter((booking) => booking.status !== "CANCELLED" && new Date(booking.endsAt) >= new Date());
    const pendingChanges = (state.massageBookingChanges || []).filter((change) => change.status === "PENDING");
    return `<section class="page massage-operations-page">${demoBanner()}${pageHeading("MASSAGE OPERATIONS", "마사지 전용 일정", "고객이 선택한 슬롯과 관리자 승인 후 확정된 방문 일정을 돌봄 캘린더와 분리해 관리합니다.")}<div class="grid stats">${statCard("Pending", bookings.filter((item) => item.status === "PENDING").length, "신청 승인 대기 슬롯", "◷")}${statCard("Confirmed", upcoming.filter((item) => item.status === "CONFIRMED").length, "예정된 마사지", "✦")}${statCard("Changes", pendingChanges.length, "변경·취소 검토", "↺")}${statCard("Therapists", state.users.filter((user) => user.isMassageTherapist).length, "활성 테라피스트", "♙")}</div><article class="card calendar-card" style="margin-top:18px"><div class="section-header calendar-head"><div><h3>마사지 월간 캘린더</h3><p>${calendarMonthLabel()} · 이동시간 버퍼는 예약 전후 1시간입니다.</p></div><div class="calendar-actions"><button class="secondary-button mini-button" data-calendar-month="-1">← 이전 달</button><button class="secondary-button mini-button" data-calendar-today>이번 달</button><button class="secondary-button mini-button" data-calendar-month="1">다음 달 →</button></div></div>${massageMonthCalendarMarkup(bookings)}</article>${pendingChanges.length ? `<article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">CHANGE REQUESTS</p><h3>마사지 변경·취소 요청</h3></div><span class="status-chip gold">${pendingChanges.length}건</span></div><div class="massage-booking-list">${pendingChanges.map((change) => { const booking = bookings.find((item) => item.id === change.sessionId); const client = clientById(booking?.clientId); return `<div class="massage-change-row"><div><strong>${escapeHtml(client?.motherName || "고객")} · ${change.action === "CHANGE" ? "일정 변경" : "취소"}</strong><span>${booking ? massageBookingDateTime(booking) : "기존 일정 확인 필요"}</span><small>${escapeHtml(change.reason)}</small></div><div><strong>${change.action === "CHANGE" && change.proposedStartsAt ? massageBookingDateTime({ startsAt: change.proposedStartsAt, endsAt: change.proposedEndsAt }) : "예약 취소"}</strong></div><div class="management-actions"><button class="secondary-button mini-button" data-review-massage-change="${change.id}:reject">반려</button><button class="primary-button mini-button" data-review-massage-change="${change.id}:approve">승인</button></div></div>`; }).join("")}</div></article>` : ""}<article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>전체 마사지 방문 일정</h3><p>신청 슬롯과 확정 슬롯을 시간순으로 확인합니다.</p></div><span class="status-chip">${bookings.length}건</span></div><div class="massage-booking-list">${bookings.length ? bookings.map((booking) => massageBookingCardMarkup(booking, "admin")).join("") : `<div class="empty-state"><strong>등록된 마사지 일정이 없습니다.</strong></div>`}</div></article></section>`;
  }

  function therapistAvailabilityPage() {
    const user = authUser();
    const monday = startOfLocalDay(new Date());
    monday.setDate(monday.getDate() + (monday.getDay() === 1 ? 0 : (8 - monday.getDay()) % 7));
    const weekStart = localDateKey(monday);
    const ownAvailability = (state.massageAvailability || []).filter((item) => item.caregiverUserId === user?.id && item.availableDate >= localDateKey(new Date())).sort((a, b) => `${a.availableDate}${a.startTime}`.localeCompare(`${b.availableDate}${b.startTime}`));
    return `<section class="page therapist-availability-page">${demoBanner()}${pageHeading("THERAPIST AVAILABILITY", "주간 근무 가능시간", "매주 가능한 날짜와 시간을 등록하면 고객에게 실제 예약 가능한 슬롯만 표시됩니다.")}<div class="status-banner info"><strong>운영 가능시간 09:00–20:00</strong><span>확정된 마사지 전후 1시간은 이동시간으로 자동 차단되며, 다른 고객의 케어 일정과 겹치는 슬롯도 고객에게 표시되지 않습니다.</span></div><article class="card card-pad availability-editor"><form data-massage-availability-form><div class="form-grid three"><div class="field"><label for="massage-week-start">등록할 주</label><input id="massage-week-start" name="weekStart" type="date" value="${weekStart}" required/><small>해당 주의 월요일을 선택합니다.</small></div><div class="field"><label for="massage-available-start">시작시간</label><input id="massage-available-start" name="startTime" type="time" min="09:00" max="19:30" value="09:00" required/></div><div class="field"><label for="massage-available-end">종료시간</label><input id="massage-available-end" name="endTime" type="time" min="09:30" max="20:00" value="20:00" required/></div></div><div class="field"><span class="field-label">근무 가능한 요일</span><div class="weekday-options">${[1,2,3,4,5,6,7].map((day, index) => `<label><input type="checkbox" name="weekday" value="${day}" ${day <= 5 ? "checked" : ""}/><span>${["월","화","수","목","금","토","일"][index]}</span></label>`).join("")}</div></div><div class="form-actions"><button type="submit" class="primary-button">이 주의 가능시간 저장</button></div></form></article><article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>등록된 가능시간</h3><p>같은 날짜를 다시 저장하면 해당 날짜의 시간이 새 값으로 교체됩니다.</p></div><span class="status-chip">${ownAvailability.length}개</span></div><div class="availability-list">${ownAvailability.length ? ownAvailability.map((item) => `<div class="availability-row"><div><strong>${formatDate(`${item.availableDate}T12:00:00`)}</strong><span>${item.startTime}–${item.endTime}</span></div><button type="button" class="danger-button mini-button" data-delete-massage-availability="${item.id}">삭제</button></div>`).join("") : `<div class="empty-state"><strong>등록된 근무 가능시간이 없습니다.</strong><span>다음 주 일정을 먼저 등록해 주세요.</span></div>`}</div></article></section>`;
  }

  function therapistMassageCalendar() {
    const user = authUser();
    const bookings = (state.massageBookings || []).filter((booking) => booking.caregiverUserId === user?.id && booking.status === "CONFIRMED").sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    return `<section class="page therapist-calendar-page">${demoBanner()}${pageHeading("MASSAGE CALENDAR", "나의 마사지 예약", "관리자 승인이 완료된 마사지 일정만 일반 케어기빙과 분리해 표시합니다.")}<article class="card calendar-card therapist-massage-calendar-card"><div class="section-header calendar-head"><div><h3>월간 예약</h3><p>${calendarMonthLabel()} · 날짜의 예약 건수를 누르면 상세 일정으로 이동합니다.</p></div><div class="calendar-actions" aria-label="캘린더 월 이동"><button class="secondary-button mini-button" data-calendar-month="-1" aria-label="이전 달">← 이전 달</button><button class="secondary-button mini-button" data-calendar-today>이번 달</button><button class="secondary-button mini-button" data-calendar-month="1" aria-label="다음 달">다음 달 →</button></div></div>${massageMonthCalendarMarkup(bookings)}</article><article class="card card-pad therapist-massage-agenda" style="margin-top:18px"><div class="section-header"><div><h3>예약 상세</h3><p>고객·방문 주소·예약시간을 확인하세요.</p></div><span class="status-chip">${bookings.length}건</span></div><div class="massage-booking-list">${bookings.length ? bookings.map((booking) => massageBookingCardMarkup(booking, "therapist")).join("") : `<div class="empty-state"><strong>확정된 마사지 예약이 없습니다.</strong></div>`}</div></article></section>`;
  }

  function adminSchedule() {
    const caregivers = state.users.filter(isCaregiverAssignable);
    const approvedUnscheduled = state.serviceRequests.filter((request) => request.status === "APPROVED" && !request.approvedAssignmentId && assignmentServiceType(request) !== "MASSAGE" && clientById(request.clientId));
    const approvedQueue = approvedUnscheduled.filter(requestHasCapturedDepositEvidence);
    const depositEvidenceQueue = approvedUnscheduled.filter((request) => !requestHasCapturedDepositEvidence(request));
    const filter = ["POSTPARTUM", "BABYSITTING"].includes(state.adminScheduleFilter) ? state.adminScheduleFilter : "ALL";
    const assignments = state.assignments.filter((item) => item.status !== "CANCELLED" && assignmentServiceType(item) !== "MASSAGE" && (filter === "ALL" || assignmentServiceType(item) === filter));
    return `
      <section class="page">
        ${demoBanner()}
        ${pageHeading("SCHEDULE & ASSIGNMENTS", "승인 신청 기반 일정·배정", "승인된 고객 서비스 신청을 불러와 관리사만 선택하고 월간 캘린더에 배치합니다.")}
        <div class="grid stats">${statCard("Active", state.assignments.filter(isAssignmentCurrent).length, "현재 진행 중", "◷")}${statCard("Postpartum", state.assignments.filter((item) => isAssignmentCurrent(item) && assignmentServiceType(item) === "POSTPARTUM").length, "산후조리 진행", "♡")}${statCard("Babysitting", state.assignments.filter((item) => isAssignmentCurrent(item) && assignmentServiceType(item) === "BABYSITTING").length, "베이비시팅 진행", "☆")}${statCard("Ready to schedule", approvedQueue.length, "승인·예약금 확인 완료", "→")}</div>
        <article class="card card-pad schedule-source-card" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">APPROVED SERVICE REQUESTS</p><h3>일정 배치 대기</h3><p>승인과 예약금 수납이 확인된 신청을 캘린더에 배치할 수 있습니다.</p></div><span class="status-chip gold">${approvedQueue.length} ready</span></div>${depositEvidenceQueue.length ? `<div class="status-banner warning"><strong>${depositEvidenceQueue.length}건의 예약금 증빙을 먼저 보완해 주세요.</strong><span>실제 수납 근거가 없는 기존 승인 건은 일정 배치에서 제외됩니다.</span></div><div class="approved-schedule-strip evidence-schedule-strip">${depositEvidenceQueue.map((request) => { const client = clientById(request.clientId); return `<button type="button" class="approved-schedule-card ${serviceMetaFor(request.serviceType).tone}" data-record-approved-deposit="${request.id}">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyNameFor(request, client) || "아이")}</strong><span>${money(Number(request.depositAmount || (assignmentServiceType(request) === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT)))} 수납 증빙 필요</span><em>증빙 보완 →</em></button>`; }).join("")}</div>` : ""}<div class="approved-schedule-strip">${approvedQueue.length ? approvedQueue.map((request) => { const client = clientById(request.clientId); return `<button type="button" class="approved-schedule-card ${serviceMetaFor(request.serviceType).tone}" data-open-assignment data-request-id="${request.id}">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyNameFor(request, client) || "아이")}</strong><span>${formatDate(request.desiredStartDate)} · ${request.dailyStart}–${request.dailyEnd} · ${request.weeks}주</span><em>일정 배치 →</em></button>`; }).join("") : `<div class="empty-state"><strong>배치 가능한 승인 신청이 없습니다.</strong><span>${depositEvidenceQueue.length ? "위 승인 건의 실제 예약금 증빙을 보완해 주세요." : "서비스 신청·승인 메뉴에서 먼저 고객 신청을 승인해 주세요."}</span></div>`}</div></article>
        <div class="schedule-filter-bar" role="group" aria-label="돌봄 서비스 필터"><span>돌봄 서비스</span>${[["ALL", "전체"], ["POSTPARTUM", "♡ 산후조리"], ["BABYSITTING", "☆ 베이비시팅"]].map(([value, label]) => `<button type="button" class="${filter === value ? "active" : ""}" data-schedule-filter="${value}">${label}</button>`).join("")}</div>
        <article class="card calendar-card" style="margin-top:12px"><div class="section-header calendar-head"><div><h3>${filter === "ALL" ? "전체 관리사" : serviceMetaFor(filter).label} 월간 일정</h3><p>${calendarMonthLabel()} · ${assignments.length}개 계약·배정</p></div><div class="calendar-actions"><button class="secondary-button mini-button" data-calendar-month="-1">← 이전 달</button><button class="secondary-button mini-button" data-calendar-today>이번 달</button><button class="secondary-button mini-button" data-calendar-month="1">다음 달 →</button><button class="primary-button" data-open-assignment ${approvedQueue.length ? "" : "disabled"}>+ 승인 신청에서 배치</button></div></div>${assignmentMonthCalendarMarkup()}</article>
        <article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>${filter === "ALL" ? "전체" : serviceMetaFor(filter).label} 계약·배정 목록</h3><p>${usingCloudData() ? "확정 일정은 고객 변경·취소 요청 승인 절차를 통해서만 바뀌며, 기록 보존을 위해 직접 삭제하지 않습니다." : "로컬 데이터의 일정 수정·삭제가 캘린더와 연동됩니다."}</p></div><span class="status-chip">${assignments.length} records</span></div><div class="assignment-list">${assignments.sort((a,b) => new Date(a.startAt)-new Date(b.startAt)).map((assignment) => { const client = clientById(assignment.clientId); const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId); const status = isAssignmentCurrent(assignment) ? "진행 중" : new Date(assignment.startAt) > new Date() ? "예정" : "종료"; return `<div class="assignment-row"><div>${serviceBadgeMarkup(assignment.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 정보 확인 필요")} · ${escapeHtml(babyNameFor(assignment, client) || "아이 미등록")}</strong><span>${formatDate(assignment.startAt)} – ${formatDate(assignment.endAt)} · ${assignment.weeks}주</span></div><div><strong>${escapeHtml(caregiver?.fullName || assignment.caregiverName || "관리사 미배정")}</strong><span>${assignment.dailyStart} – ${assignment.dailyEnd}</span></div><div><strong>${escapeHtml(assignment.address)}</strong><span>알러지: ${escapeHtml(assignment.allergies)}</span></div><span class="status-chip ${status === "진행 중" ? "" : "gold"}">${status}</span><div class="assignment-actions">${adminAssignmentActionsMarkup(assignment)}</div></div>`; }).join("")}</div></article>
      </section>`;
  }

  function assignmentMonthCalendarMarkup() {
    const viewMonth = new Date(new Date().getFullYear(), new Date().getMonth() + state.calendarMonthOffset, 1);
    const gridStart = new Date(viewMonth);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(gridStart); day.setDate(day.getDate() + index); return day; });
    const weekdayHeader = ["일", "월", "화", "수", "목", "금", "토"].map((day) => `<div>${day}</div>`).join("");
    return `<div class="month-calendar"><div class="month-weekdays">${weekdayHeader}</div><div class="month-grid">${days.map((day) => { const dayStart = new Date(day); dayStart.setHours(0,0,0,0); const dayEnd = new Date(day); dayEnd.setHours(23,59,59,999); const assignments = state.assignments.filter((item) => item.status !== "CANCELLED" && (state.adminScheduleFilter === "ALL" || !state.adminScheduleFilter || assignmentServiceType(item) === state.adminScheduleFilter) && new Date(item.startAt) <= dayEnd && new Date(item.endAt) >= dayStart && assignmentOccursOnDate(item, day)); const outside = day.getMonth() !== viewMonth.getMonth(); const today = day.toDateString() === new Date().toDateString(); return `<div class="month-day ${outside ? "outside" : ""} ${today ? "today" : ""}"><header>${day.getDate()}</header><div class="month-events">${assignments.slice(0,3).map((assignment) => { const client = clientById(assignment.clientId); const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId); const type = assignmentServiceType(assignment); return `<button class="month-event ${type.toLowerCase()}" data-edit-assignment="${assignment.id}" title="${escapeHtml(serviceMetaFor(assignment.serviceType).label)} · ${escapeHtml(client?.motherName || "고객")} / ${escapeHtml(caregiver?.fullName || "관리사")}"><strong>${type === "MASSAGE" ? "✦" : type === "BABYSITTING" ? "☆" : "♡"} ${escapeHtml(type === "MASSAGE" ? client?.motherName || "고객" : babyNameFor(assignment, client) || client?.motherName || "고객")}</strong><span>${escapeHtml(caregiver?.fullName || "관리사 미배정")} · ${assignment.dailyStart}</span></button>`; }).join("")}${assignments.length > 3 ? `<small>+${assignments.length - 3}개 일정</small>` : ""}</div></div>`; }).join("")}</div></div>`;
  }

  function calendarMonthLabel() {
    const viewMonth = new Date(new Date().getFullYear(), new Date().getMonth() + state.calendarMonthOffset, 1);
    return viewMonth.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
  }

  function peopleRows() {
    return state.people
      .map(
        (person) => `
          <div class="person-row">
            <div class="mini-avatar">${person.initials}</div>
            <div class="person-copy"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.detail)}</span></div>
            <span class="status-chip">${escapeHtml(person.status)}</span>
          </div>`,
      )
      .join("");
  }

  function normalizeDirectorySearch(value) {
    return String(value || "").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
  }

  function directoryClientAssignment(clientId) {
    const assignments = state.assignments
      .filter((item) => item.clientId === clientId && item.status !== "CANCELLED")
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    const current = assignments.find(isAssignmentCurrent);
    const upcoming = assignments.find((item) => new Date(item.startAt).getTime() > Date.now());
    return current || upcoming || assignments[assignments.length - 1] || null;
  }

  function compareDirectoryDate(first, second, newestFirst) {
    const firstTime = first ? new Date(first).getTime() : null;
    const secondTime = second ? new Date(second).getTime() : null;
    if (firstTime === null && secondTime === null) return 0;
    if (firstTime === null) return 1;
    if (secondTime === null) return -1;
    return newestFirst ? secondTime - firstTime : firstTime - secondTime;
  }

  function compareDirectoryText(first, second, descending = false) {
    const firstValue = String(first || "").trim();
    const secondValue = String(second || "").trim();
    if (!firstValue && !secondValue) return 0;
    if (!firstValue) return 1;
    if (!secondValue) return -1;
    return descending ? secondValue.localeCompare(firstValue, "ko-KR") : firstValue.localeCompare(secondValue, "ko-KR");
  }

  function paginateDirectory(items, requestedPage, requestedPageSize) {
    const pageSize = Math.max(1, Number(requestedPageSize) || 5);
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(Math.max(1, Number(requestedPage) || 1), totalPages);
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      totalItems: items.length,
      totalPages,
    };
  }

  function directoryPaginationMarkup(scope, pagination) {
    const pageItems = [];
    for (let page = 1; page <= pagination.totalPages; page += 1) {
      const isVisible = pagination.totalPages <= 7 || page === 1 || page === pagination.totalPages || Math.abs(page - pagination.page) <= 2;
      if (isVisible) pageItems.push(page);
      else if (pageItems[pageItems.length - 1] !== null) pageItems.push(null);
    }
    const scopeLabel = scope === "client" ? "고객" : scope === "caregiver" ? "관리사" : "회원";
    return `<footer class="directory-pagination"><span class="directory-count">총 ${pagination.totalItems}명 · ${pagination.page}/${pagination.totalPages} 페이지</span><nav class="pagination-pages" aria-label="${scopeLabel} 목록 페이지"><button type="button" class="page-button page-arrow" data-directory-page="${scope}" data-page="${pagination.page - 1}" ${pagination.page === 1 ? "disabled" : ""} aria-label="이전 페이지">‹</button>${pageItems.map((page, index) => page === null ? `<span class="page-ellipsis" aria-hidden="true" data-ellipsis-index="${index}">…</span>` : `<button type="button" class="page-button ${page === pagination.page ? "current" : ""}" data-directory-page="${scope}" data-page="${page}" ${page === pagination.page ? 'aria-current="page"' : ""}>${page}</button>`).join("")}<button type="button" class="page-button page-arrow" data-directory-page="${scope}" data-page="${pagination.page + 1}" ${pagination.page === pagination.totalPages ? "disabled" : ""} aria-label="다음 페이지">›</button></nav></footer>`;
  }

  function directoryToolbarMarkup(scope, query, sort, pageSize) {
    const isClient = scope === "client";
    const isMember = scope === "member";
    const directoryLabel = isClient ? "고객·아기" : isMember ? "회원" : "관리사";
    const sortOptions = isMember
      ? [["newest", "최근 가입순"], ["oldest", "오래된 가입순"], ["name-asc", "회원 이름 가나다순"], ["name-desc", "회원 이름 역순"]]
      : isClient
      ? [["mother-asc", "고객 이름 가나다순"], ["mother-desc", "고객 이름 역순"], ["baby-asc", "아기 이름 가나다순"], ["baby-desc", "아기 이름 역순"], ["care-newest", "관리 년월 최신순"], ["care-oldest", "관리 년월 오래된순"]]
      : [["name-asc", "관리사 이름 가나다순"], ["name-desc", "관리사 이름 역순"], ["hire-newest", "입사년월 최신순"], ["hire-oldest", "입사년월 오래된순"], ["residence-asc", "거주지역 가나다순"], ["residence-desc", "거주지역 역순"]];
    const searchPlaceholder = isClient ? "고객·아기 이름, 연락처 검색" : isMember ? "이름, 이메일, 권한, 상태 검색" : "이름, 지역, 자격 검색";
    const pageSizes = isMember ? [5, 10, 20, 50] : [2, 5, 10, 20];
    return `<div class="directory-toolbar"><form class="directory-search-form" data-directory-search="${scope}"><label class="sr-only" for="${scope}-directory-search">${directoryLabel} 검색</label><input id="${scope}-directory-search" name="query" type="search" value="${escapeHtml(query)}" placeholder="${searchPlaceholder}" /><button type="submit" class="secondary-button mini-button">검색</button>${query ? `<button type="button" class="text-button directory-clear" data-clear-directory-search="${scope}">초기화</button>` : ""}</form><div class="directory-filter-group"><label for="${scope}-directory-sort">정렬</label><select id="${scope}-directory-sort" data-directory-sort="${scope}">${sortOptions.map(([value, label]) => `<option value="${value}" ${value === sort ? "selected" : ""}>${label}</option>`).join("")}</select><label for="${scope}-directory-size">표시</label><select id="${scope}-directory-size" data-directory-size="${scope}">${pageSizes.map((size) => `<option value="${size}" ${Number(pageSize) === size ? "selected" : ""}>${size}명</option>`).join("")}</select></div></div>`;
  }

  function clientManagementRowMarkup(client) {
    const clientUser = state.users.find((user) => user.id === client.userId);
    const pending = clientUser?.status === "pending";
    const assignment = directoryClientAssignment(client.id);
    const lifecycle = pending ? "승인 대기" : client.clientStatus === "PAUSED" ? "일시 중지" : client.clientStatus === "COMPLETED" ? "서비스 종료" : "관리 중";
    const suspended = clientUser?.accountStatus === "SUSPENDED";
    const archived = clientUser?.accountStatus === "REJECTED";
    const accountStatusLabel = archived ? "보관됨" : suspended ? "계정 정지" : lifecycle;
    const accountAction = !clientUser || archived
      ? ""
      : `<button class="${suspended ? "primary-button" : "text-button danger-text"} mini-button" data-member-status="${suspended ? "ACTIVE" : "SUSPENDED"}" data-member-user-id="${clientUser.id}" data-member-name="${escapeHtml(client.motherName)}">${suspended ? "계정 활성화" : "계정 정지"}</button>`;
    const babyNames = babiesForClient(client).map((baby) => baby.name).filter(Boolean).join(" · ") || "아기정보 미등록";
    return `<div class="management-row client-management-row"><div class="management-identity"><div class="mini-avatar">${escapeHtml((client.motherName || "고")[0])}</div><div><strong>${escapeHtml(client.motherName)}</strong><span>${escapeHtml(clientUser?.email || "이메일 미등록")} · ${escapeHtml(clientUser?.phone || "전화 미등록")}</span></div></div><div class="management-cell"><span>아기·출산정보</span><strong>${escapeHtml(babyNames)}</strong><small>${client.babyBirthDate ? formatDate(client.babyBirthDate) : "출산(예정)일 미등록"} · ${escapeHtml(client.maternalStatus || "산모 상태 미등록")}</small></div><div class="management-cell"><span>관리 년월·주의사항</span><strong>${assignment ? `${formatDate(assignment.startAt, { year: "numeric", month: "long" })} · ${formatDate(assignment.startAt)}–${formatDate(assignment.endAt)}` : "배정 일정 없음"}</strong><small>${escapeHtml(client.address || "주소 미등록")} · 알러지 ${escapeHtml(client.allergies || "없음")}</small></div><div class="management-cell memo-cell"><span>관리자 메모</span><strong>${escapeHtml(client.internalMemo || "메모 없음")}</strong><small>다음 연락 ${client.nextContactDate ? formatDate(client.nextContactDate) : "미정"}</small></div><div class="management-actions"><span class="status-chip ${pending || suspended || archived ? "coral" : ""}">${accountStatusLabel}</span><button class="secondary-button mini-button" data-manage-client="${client.id}">상세·수정</button>${accountAction}</div></div>`;
  }

  function caregiverManagementRowMarkup(user) {
    const assignment = currentAssignmentFor(user.id);
    const client = assignment ? clientById(assignment.clientId) : null;
    const hrSetupRequired = user.status === "approved" && user.hasHrProfile === false;
    const employmentLabel = user.status === "pending" ? "승인 대기" : hrSetupRequired ? "인사정보 설정 필요" : user.employmentStatus === "ON_LEAVE" ? "휴직" : user.employmentStatus === "INACTIVE" ? "퇴사·비활성" : "재직";
    const suspended = user.accountStatus === "SUSPENDED";
    const archived = user.accountStatus === "REJECTED";
    const accountStatusLabel = archived ? "보관됨" : suspended ? "계정 정지" : employmentLabel;
    const accountAction = user.status === "pending" || archived
      ? ""
      : `<button class="${suspended ? "primary-button" : "text-button danger-text"} mini-button" data-member-status="${suspended ? "ACTIVE" : "SUSPENDED"}" data-member-user-id="${user.id}" data-member-name="${escapeHtml(user.fullName)}">${suspended ? "계정 활성화" : "계정 정지"}</button>`;
    const assignedBabyName = assignment && client ? babyNameFor(assignment, client) : "";
    const publicProfile = user.publicProfile || (state.publicCaregivers || []).find((item) => item.caregiverUserId === user.id || item.caregiverId === user.caregiverId);
    const validReviews = state.reviews.filter((review) => review.caregiverUserId === user.id && review.source === "CLIENT" && review.validityStatus !== "INVALID" && !review.archived && !state.assignments.find((item) => item.id === review.assignmentId)?.administrativelyRemovedAt);
    const average = publicProfile?.averageRating != null ? Number(publicProfile.averageRating).toFixed(1) : validReviews.length ? (validReviews.reduce((sum, review) => sum + Number(review.rating), 0) / validReviews.length).toFixed(1) : null;
    const reviewCount = publicProfile?.averageRating != null ? Number(publicProfile.reviewCount || 0) : validReviews.length;
    const massageOnly = isMassageOnlyProfessional(user);
    const serviceBadges = [
      user.canProvidePostpartum !== false ? "산후조리" : null,
      user.canProvideBabysitting !== false ? "베이비시팅" : null,
      user.isMassageTherapist ? "마사지" : null,
    ].filter(Boolean).map((label) => `<span class="member-role-badge">${label}</span>`).join("");
    return `<div class="management-row caregiver-management-row"><div class="management-identity"><div class="mini-avatar">${escapeHtml(user.initials)}</div><div><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email)} · ${escapeHtml(user.phone || "전화 미등록")}</span><div class="member-role-badges">${serviceBadges}</div></div></div><div class="management-cell"><span>경력·입사년월</span><strong>${Number(user.careerYears || 0)}년 경력</strong><small>${user.hireDate ? `${formatDate(user.hireDate, { year: "numeric", month: "long" })} 입사` : "입사일 미등록"}</small></div><div class="management-cell"><span>${massageOnly ? "홈페이지·전문 정보" : "홈페이지·평점"}</span><strong>${massageOnly ? escapeHtml(user.specialties || "전문 분야 미등록") : average ? `★ ${average} · 후기 ${reviewCount}건` : "후기 없음"}</strong><small>${publicProfile?.isPublished !== false && publicProfile ? "홈페이지 공개 중" : "홈페이지 비공개"} · ${escapeHtml(publicProfile?.headline || user.specialties || "공개 소개 미등록")}</small></div><div class="management-cell memo-cell"><span>현재 배정·인사메모</span><strong>${client ? `${escapeHtml(client.motherName)} · ${escapeHtml(assignedBabyName || "아이")}` : "현재 배정 없음"}</strong><small>${escapeHtml(hrSetupRequired ? "인사정보를 저장하고 근무상태를 재직으로 설정해야 배정할 수 있습니다." : user.hrNotes || "인사 메모 없음")}</small></div><div class="management-actions"><span class="status-chip ${user.status === "pending" || user.employmentStatus === "INACTIVE" || hrSetupRequired || suspended || archived ? "coral" : ""}">${accountStatusLabel}</span><button class="secondary-button mini-button" data-manage-caregiver="${user.id}">${hrSetupRequired ? "인사정보 설정" : massageOnly ? "테라피스트 프로필 관리" : "프로필·후기 관리"}</button>${accountAction}</div></div>`;
  }

  const DATABASE_ROLE_BY_APP_ROLE = {
    admin: "ADMIN",
    client: "CLIENT",
    caregiver: "CAREGIVER",
    retail: "RETAIL_STAFF",
  };

  const DATABASE_ROLE_LABELS = {
    OWNER: "소유자",
    ADMIN: "관리자",
    CARE_MANAGER: "일정 관리자",
    RETAIL_STAFF: "리테일 직원",
    CAREGIVER: "관리사",
    CLIENT: "고객",
  };

  function requestHasCapturedDepositEvidence(request) {
    return !usingCloudData() || request?.depositTransaction?.status === "CAPTURED";
  }

  function requestClientLinkIssue(request) {
    const client = clientById(request?.clientId);
    if (!client) return "고객 데이터가 존재하지 않습니다.";
    if (!usingCloudData()) return "";
    const requester = state.users.find((user) => user.id === request?.userId);
    if (!requester) return "신청자 계정을 조회할 수 없습니다.";
    if (requester.accountStatus !== "ACTIVE") return "신청자 계정이 활성 상태가 아닙니다.";
    if (!requester.databaseRoles?.includes("CLIENT")) return "신청자의 회원 유형이 고객이 아닙니다.";
    if (!client.memberUserIds?.includes(requester.id)) return "신청자와 고객 프로필의 연결이 해제되었습니다.";
    return "";
  }

  function requestServiceTotal(request) {
    const stored = Number(request?.estimatedTotal || 0);
    if (stored > 0) return stored;
    if (assignmentServiceType(request) === "POSTPARTUM") {
      return Number(request?.weeks || 0) * Number(request?.weeklyRate || postpartumWeeklyRate(request));
    }
    if (assignmentServiceType(request) === "MASSAGE") return massagePrice(request);
    const [startHour = 0, startMinute = 0] = String(request?.dailyStart || "00:00").split(":").map(Number);
    const [endHour = 0, endMinute = 0] = String(request?.dailyEnd || "00:00").split(":").map(Number);
    const hours = Math.max(0, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60);
    return hours * Number(request?.daysOfWeek?.length || 0) * Number(request?.weeks || 0) * BABYSITTING_HOURLY_RATE;
  }

  function transactionNetAmount(transaction) {
    if (!transaction || ["VOIDED", "FAILED"].includes(transaction.status)) return 0;
    const amount = Number(transaction.amount || 0);
    if (transaction.status === "REFUNDED") return Math.max(0, amount - Number(transaction.refundedAmount ?? transaction.refunded_amount ?? 0));
    return transaction.status === "CAPTURED" ? amount : 0;
  }

  function requestDepositNet(request) {
    return transactionNetAmount(request?.depositTransaction);
  }

  function requestBalanceNet(request) {
    return (request?.balanceTransactions || []).reduce((sum, transaction) => sum + transactionNetAmount(transaction), 0);
  }

  function requestOwnerDiscount(request) {
    return Math.max(0, Number(request?.ownerDiscountAmount ?? request?.owner_discount_amount ?? 0));
  }

  function requestServiceRefundTotal(request) {
    return (request?.refundTransactions || []).reduce((sum, transaction) => {
      if (transaction?.status !== "COMPLETED") return sum;
      return sum + Number(transaction.amount || 0);
    }, 0);
  }

  function requestLegacyRefundTotal(request) {
    const depositRefund = Number(request?.depositTransaction?.refundedAmount ?? request?.depositTransaction?.refunded_amount ?? 0);
    const balanceRefunds = (request?.balanceTransactions || []).reduce((sum, transaction) => (
      sum + Number(transaction?.refundedAmount ?? transaction?.refunded_amount ?? 0)
    ), 0);
    return depositRefund + balanceRefunds;
  }

  function requestRefundTotal(request) {
    return requestLegacyRefundTotal(request) + requestServiceRefundTotal(request);
  }

  function requestRefundableCollectedAmount(request) {
    return Math.max(0, requestDepositNet(request) + requestBalanceNet(request) - requestServiceRefundTotal(request));
  }

  function requestNetCollectedAmount(request) {
    return requestDepositNet(request) + requestBalanceNet(request) - requestServiceRefundTotal(request);
  }

  function requestOutstandingBalance(request) {
    if (request?.status !== "APPROVED") return 0;
    return Math.max(0, requestServiceTotal(request) - requestOwnerDiscount(request) - requestDepositNet(request) - requestBalanceNet(request));
  }

  function memberAccountRowMarkup(user) {
    const isSelf = user.id === authUser()?.id;
    const archived = user.accountStatus === "REJECTED";
    const pending = user.accountStatus === "PENDING";
    const currentRoles = user.databaseRoles?.length ? user.databaseRoles : [DATABASE_ROLE_BY_APP_ROLE[user.role] || "CLIENT"];
    const targetIsAdministrator = currentRoles.some((role) => ["OWNER", "ADMIN"].includes(role));
    const protectedAdministrator = targetIsAdministrator && !canGrantAdministrativeRole() && !isSelf;
    const roleBadges = currentRoles
      .filter((role) => role !== "CAREGIVER")
      .map((role) => `<span class="member-role-badge ${["OWNER", "ADMIN"].includes(role) ? "administrative" : ""}">${escapeHtml(DATABASE_ROLE_LABELS[role] || role)}</span>`)
      .join("");
    const serviceBadges = currentRoles.includes("CAREGIVER") ? [
      user.canProvidePostpartum !== false ? "산후조리" : null,
      user.canProvideBabysitting !== false ? "베이비시팅" : null,
      user.isMassageTherapist ? "마사지" : null,
    ].filter(Boolean).map((label) => `<span class="member-role-badge">${label}</span>`).join("") : "";
    const accountAction = isSelf || currentRoles.includes("OWNER")
      ? `<span class="status-chip">${isSelf ? "현재 계정" : "보호된 소유자"}</span>`
      : archived
        ? `<span class="status-chip coral">보관됨</span>`
        : `<button class="text-button danger-text mini-button" data-archive-member="${user.id}" data-member-name="${escapeHtml(user.fullName)}">계정 보관</button>`;
    return `<div class="management-row member-account-row ${archived ? "is-archived" : ""}"><div class="management-identity"><div class="mini-avatar">${escapeHtml(user.initials || initialsFor(user.fullName))}</div><div><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email || "이메일 미등록")}</span></div></div><div class="management-cell"><span>접근 권한</span><div class="member-role-badges">${roleBadges}${serviceBadges}</div><button class="secondary-button mini-button member-access-button" type="button" data-configure-member-roles="${user.id}" ${archived || protectedAdministrator ? "disabled" : ""}>권한 구성</button><small>${protectedAdministrator ? "소유자만 다른 관리자 권한을 변경할 수 있습니다." : "서비스 권한을 각각 독립적으로 부여할 수 있습니다."}</small></div><div class="management-cell"><span>가입일</span><strong>${user.createdAt ? formatDate(user.createdAt) : "미등록"}</strong><small>${escapeHtml(user.phone || "전화 미등록")}</small></div><div class="management-cell"><span>계정 상태</span><strong>${archived ? "보관됨" : pending ? "승인 대기" : user.accountStatus === "SUSPENDED" ? "접근 정지" : "정상"}</strong><small>${archived ? "로그인 및 데이터 접근 차단" : `${currentRoles.length}개 권한 연결됨`}</small></div><div class="management-actions">${accountAction}</div></div>`;
  }

  function openMemberRoleAccessModal(userId) {
    const member = state.users.find((item) => item.id === userId);
    if (!member) return showToast("회원 정보를 찾을 수 없습니다.", "error");
    const currentRoles = new Set(member.databaseRoles?.length ? member.databaseRoles : [DATABASE_ROLE_BY_APP_ROLE[member.role] || "CLIENT"]);
    const adminLocked = !canGrantAdministrativeRole();
    const fixedRoles = ["OWNER", "CARE_MANAGER", "RETAIL_STAFF"].filter((role) => currentRoles.has(role));
    const roleOption = (role, label, detail, disabled = false) => `<label class="member-access-option ${disabled ? "locked" : ""}"><input type="checkbox" name="accessRole" value="${role}" ${currentRoles.has(role) ? "checked" : ""} ${disabled ? "disabled" : ""}/><span><strong>${label}</strong><small>${detail}</small></span></label>`;
    const postpartumCapability = member.canProvidePostpartum ?? currentRoles.has("CAREGIVER");
    const babysittingCapability = member.canProvideBabysitting ?? currentRoles.has("CAREGIVER");
    const serviceOption = (name, label, detail, checked) => `<label class="member-access-option"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}/><span><strong>${label}</strong><small>${detail}</small></span></label>`;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal member-access-modal" role="dialog" aria-modal="true" aria-labelledby="member-access-title"><header class="modal-header"><div><p class="eyebrow">MEMBER ACCESS</p><h3 id="member-access-title">회원 권한 구성</h3><p>${escapeHtml(member.fullName)} · ${escapeHtml(member.email || "이메일 미등록")}</p></div><button class="close-button" type="button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-member-access-form><div class="status-banner"><strong>독립 서비스 권한</strong><span>고객·관리자 작업공간과 직원별 제공 가능 서비스를 각각 선택합니다. 산후조리, 베이비시팅, 마사지는 서로 독립적으로 부여할 수 있습니다.</span></div><fieldset class="member-access-options"><legend>일반 작업공간</legend>${roleOption("CLIENT", "고객", "본인의 서비스 신청·일정·케어 기록을 확인합니다.")}${roleOption("ADMIN", "관리자", adminLocked ? "현재 관리자 권한은 유지되며 소유자만 변경할 수 있습니다." : "회원·일정·결제·운영 정보를 관리합니다.", adminLocked)}${fixedRoles.length ? `<div class="fixed-access-note"><strong>보호된 기존 권한</strong><div class="member-role-badges">${fixedRoles.map((role) => `<span class="member-role-badge administrative">${escapeHtml(DATABASE_ROLE_LABELS[role])}</span>`).join("")}</div><small>소유자 및 기존 특수 권한은 이 화면에서 제거되지 않습니다.</small></div>` : ""}</fieldset><fieldset class="member-access-options"><legend>제공 가능 서비스</legend>${serviceOption("postpartumCaregiver", "산후조리 관리사", "산후조리 신청의 배정 후보와 산후조리 케어기빙 화면을 사용합니다.", postpartumCapability)}${serviceOption("babysittingCaregiver", "베이비시팅 관리사", "베이비시팅 신청의 배정 후보와 베이비시팅 기록 화면을 사용합니다.", babysittingCapability)}${serviceOption("massageTherapist", "마사지 테라피스트", "다른 관리사 권한 없이 단독으로 부여할 수 있으며 마사지 전용 일정 화면을 사용합니다.", member.isMassageTherapist)}</fieldset><div class="privacy-boundary-note"><strong>마사지 중복 배정 예외</strong><span>해당 고객을 직접 케어 중인 테라피스트는 그 고객의 케어 시간 안에도 마사지가 배정될 수 있습니다. 다른 고객의 일정 또는 다른 마사지와 겹치면 배정되지 않습니다.</span></div><div class="privacy-boundary-note"><strong>고객 작업공간 자동 준비</strong><span>고객 권한을 추가하면 고객 레코드와 계정 연결을 즉시 생성하고 계정을 활성화합니다. 회원은 고객 화면에서 아기·주소 정보를 직접 작성한 뒤 바로 서비스를 신청할 수 있습니다.</span></div><div class="privacy-boundary-note"><strong>관리자 예외 승인</strong><span>관리자 또는 소유자가 직원 서비스 권한을 추가하면 회원의 사전 약관 동의가 없어도 즉시 활성화됩니다. 승인자와 서비스별 권한은 감사 로그에 남깁니다.</span></div><div class="privacy-boundary-note"><strong>활성 기록 보호</strong><span>진행 중이거나 예정된 해당 서비스 배정이 있으면 그 서비스 권한은 제거할 수 없습니다. 다른 서비스 권한을 추가하는 것은 가능합니다.</span></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">권한 저장</button></div></form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-member-access-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const selectedRoles = [...form.querySelectorAll('input[name="accessRole"]:checked')].map((input) => input.value);
      fixedRoles.forEach((role) => { if (!selectedRoles.includes(role)) selectedRoles.push(role); });
      const capabilities = {
        postpartum: form.elements.postpartumCaregiver.checked,
        babysitting: form.elements.babysittingCaregiver.checked,
        massage: form.elements.massageTherapist.checked,
      };
      const hasProfessionalService = Object.values(capabilities).some(Boolean);
      if (hasProfessionalService && !selectedRoles.includes("CAREGIVER")) selectedRoles.push("CAREGIVER");
      if (!selectedRoles.length) return showToast("최소 한 개의 접근 권한을 선택해 주세요.", "error");
      const addingCaregiver = selectedRoles.includes("CAREGIVER") && !currentRoles.has("CAREGIVER");
      const addingClient = selectedRoles.includes("CLIENT") && !currentRoles.has("CLIENT");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "저장 중…";
      try {
        if (usingCloudData()) {
          await configureMemberServiceAccessCloud(member.id, selectedRoles, capabilities);
          closeModal();
          await refreshCloudState();
        } else {
          member.databaseRoles = selectedRoles;
          member.canProvidePostpartum = capabilities.postpartum;
          member.canProvideBabysitting = capabilities.babysitting;
          member.isMassageTherapist = capabilities.massage;
          const publicProfile = (state.publicCaregivers || []).find((profile) => profile.caregiverUserId === member.id || profile.caregiverId === member.caregiverId);
          if (publicProfile) publicProfile.serviceCapabilities = [
            capabilities.postpartum ? "POSTPARTUM" : null,
            capabilities.babysitting ? "BABYSITTING" : null,
            capabilities.massage ? "MASSAGE" : null,
          ].filter(Boolean);
          member.role = selectedRoles.some((role) => ["OWNER", "ADMIN", "CARE_MANAGER"].includes(role))
            ? "admin"
            : capabilities.postpartum || capabilities.babysitting ? "caregiver"
              : capabilities.massage ? "therapist"
              : selectedRoles.includes("CLIENT") ? "client" : "retail";
          if (addingCaregiver) {
            member.status = "approved";
            member.caregiverStatus = "approved";
            member.employmentStatus = "ACTIVE";
          }
          if (addingClient) {
            member.status = "approved";
            member.accountStatus = "ACTIVE";
            if (!clientForUser(member.id)) {
              state.clients.push({
                id: `client-${Date.now()}`,
                userId: member.id,
                memberUserIds: [member.id],
                motherName: member.fullName,
                maternalStatus: "서비스 신청 전",
                clientStatus: "LEAD",
                preferredLanguage: member.preferredLanguage || "ko",
                emergencyContact: "",
                babies: [],
                babyId: null,
                babyName: "",
                babyBirthDate: null,
                address: "",
                allergies: "",
                extraHouseholdMembers: 0,
                requestNote: "",
              });
            }
          }
          saveState();
          closeModal();
          render();
        }
        showToast(`${member.fullName} 계정의 작업공간 권한을 저장했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "회원 접근 권한을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "권한 저장";
      }
    });
  }

  function requestManagementRowMarkup(request, mode) {
    const client = clientById(request.clientId);
    const isApprovedQueue = mode === "approved";
    const detail = assignmentServiceType(request) === "BABYSITTING" ? request.mealInstructions || request.routineNotes || request.specialNotes : request.maternalNotes || request.specialNotes;
    const window = requestWindow(request);
    const serviceType = assignmentServiceType(request);
    const issue = serviceType === "MASSAGE" ? null : serviceLifecycleIssue(request.clientId, serviceType, window.startAt, window.endAt, null, request.id, request.babyId, request.babyName);
    const price = serviceType === "POSTPARTUM" ? `${money(requestServiceTotal(request))} 예상 · 주 ${money(postpartumWeeklyRate(request))}` : serviceType === "MASSAGE" ? `${money(requestServiceTotal(request))} · ${request.durationMinutes || 60}분 × ${request.sessionCount || 1}회` : `시간당 $${BABYSITTING_HOURLY_RATE} · 독립 신청 서비스`;
    const clientLinkIssue = requestClientLinkIssue(request);
    const depositEvidenceMissing = isApprovedQueue && !requestHasCapturedDepositEvidence(request);
    const queueTitle = clientLinkIssue
      ? "고객 계정 연결 복구 필요"
      : depositEvidenceMissing
        ? "예약금 수납 증빙 보완 필요"
        : "승인 완료 · 일정 배정 대기";
    const queueAction = depositEvidenceMissing
      ? `<button class="primary-button mini-button" data-record-approved-deposit="${request.id}" ${clientLinkIssue ? "disabled" : ""}>예약금 증빙 보완</button>`
      : `<button class="primary-button mini-button" data-open-assignment data-request-id="${request.id}" ${issue || clientLinkIssue ? "disabled" : ""}>캘린더 일정 배치</button>`;
    const issueDetail = clientLinkIssue
      ? `${clientLinkIssue} 회원 관리에서 고객 권한과 고객 프로필 연결을 복구한 뒤 처리해 주세요.`
      : issue?.message || (depositEvidenceMissing ? "실제 수납 내역의 결제수단과 거래·영수증 번호를 기록한 뒤 일정 배치가 열립니다." : detail || "별도 요청 없음");
    return `<div class="client-request-row service-request-management-row ${issue || clientLinkIssue || depositEvidenceMissing ? "has-lifecycle-issue" : ""}"><div><div class="request-title-line">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 연결 확인 필요")}${serviceType === "MASSAGE" ? "" : ` · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}`}</strong></div><span>${serviceType === "MASSAGE" ? `${request.durationMinutes || 60}분 · ${request.sessionCount || 1}회` : `${request.weeks}주`} · ${formatDate(request.desiredStartDate)} · ${request.dailyStart}–${request.dailyEnd}</span><small>${price}</small></div><div><strong>${escapeHtml(request.address)}</strong><span>${serviceType === "MASSAGE" ? (request.pricingTier === "POSTPARTUM_CLIENT" ? "산후조리 고객 우대가" : "일반 고객가") : `알러지 ${escapeHtml(request.allergies || "없음")} · 추가인원 ${request.extraHouseholdMembers || 0}명`}</span></div><div><strong>${clientLinkIssue ? "고객 계정 연결 오류" : issue ? "일정 중복 확인 필요" : isApprovedQueue ? queueTitle : "신청 내용"}</strong><span>${escapeHtml(issueDetail)}</span></div>${isApprovedQueue ? queueAction : `<button class="primary-button mini-button" data-review-client-request="${request.id}" ${clientLinkIssue ? "disabled" : ""}>신청 검토·승인</button>`}</div>`;
  }

  function adjustmentManagementMarkup(adjustments) {
    return `<article class="card card-pad adjustment-review-card" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">CHANGE & CANCELLATION QUEUE</p><h3>변경·취소 승인 요청</h3><p>기존 일정은 유지한 채 정책과 관리사 일정을 검토한 뒤 승인합니다.</p></div><span class="status-chip coral">${adjustments.length} pending</span></div><div class="request-list">${adjustments.length ? adjustments.map((adjustment) => {
      const client = clientById(adjustment.clientId);
      const target = adjustmentTarget(adjustment.targetType, adjustment.targetId);
      const proposed = adjustment.action === "CHANGE"
        ? `${new Date(`${adjustment.proposedStartDate}T12:00:00`).toLocaleDateString("ko-KR")} · ${adjustment.serviceType === "MASSAGE" ? `${target?.durationMinutes || 60}분` : `${adjustment.proposedWeeks}주`} · ${adjustment.proposedDailyStart}–${adjustment.proposedDailyEnd}`
        : "전체 서비스 취소";
      const brokenLink = !client || !target;
      return `<div class="client-request-row adjustment-management-row ${brokenLink ? "has-lifecycle-issue" : ""}"><div><div class="request-title-line">${serviceBadgeMarkup(adjustment.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${adjustment.action === "CANCEL" ? "취소" : "일정 변경"}</strong></div><span>${target ? `현재 ${new Date(adjustmentTargetStart(target)).toLocaleDateString("ko-KR")} 시작` : "연결된 서비스 없음"}</span><small>${escapeHtml(adjustment.reason)}</small></div><div><strong>요청 내용</strong><span>${proposed}</span></div><div><strong>${escapeHtml(brokenLink ? "데이터 연결 복구 필요" : adjustment.policyTitle)}</strong><span>${escapeHtml(brokenLink ? "연결된 고객·서비스를 확인한 뒤 처리해 주세요." : adjustment.policyDetail)}</span></div><div class="management-actions"><button class="secondary-button mini-button" data-reject-adjustment="${adjustment.id}">반려</button><button class="primary-button mini-button" data-approve-adjustment="${adjustment.id}" ${brokenLink ? "disabled" : ""}>승인·반영</button></div></div>`;
    }).join("") : `<div class="empty-state"><strong>검토 대기 중인 변경·취소 요청이 없습니다.</strong></div>`}</div></article>`;
  }

  function depositRefundQueueMarkup(requests) {
    if (!requests.length) return "";
    return `<article class="card card-pad deposit-refund-card" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">DEPOSIT REFUND QUEUE</p><h3>예약금 환불 대기</h3><p>실제 환불이 완료된 뒤 결제사·은행의 환불 참조번호를 기록합니다.</p></div><span class="status-chip coral">${requests.length} pending</span></div><div class="request-list">${requests.length ? requests.map((request) => {
      const client = clientById(request.clientId);
      const originalReference = request.depositTransaction?.external_reference || request.depositTransaction?.externalReference || "원거래 참조 미등록";
      return `<div class="client-request-row deposit-refund-row"><div><div class="request-title-line">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</strong></div><span>${formatDate(request.desiredStartDate)} 시작 예정 · 취소 승인 완료</span><small>원거래 ${escapeHtml(originalReference)}</small></div><div><strong>${money(Number(request.depositAmount || request.depositTransaction?.amount || 0))}</strong><span>환불 예정 예약금</span></div><div><strong>환불 실행 후 기록</strong><span>환불 참조번호는 중복 사용할 수 없습니다.</span></div><button class="primary-button mini-button" data-record-deposit-refund="${request.id}">환불 완료 기록</button></div>`;
    }).join("") : ""}</div></article>`;
  }

  function adminRequests() {
    const pending = state.serviceRequests.filter((request) => request.status === "PENDING");
    const approvedQueue = state.serviceRequests.filter((request) => request.status === "APPROVED" && !request.approvedAssignmentId && assignmentServiceType(request) !== "MASSAGE");
    const refundDueRequests = state.serviceRequests.filter((request) => request.status === "CANCELLED" && request.depositStatus === "REFUND_DUE");
    const pendingPostpartum = pending.filter((request) => assignmentServiceType(request) === "POSTPARTUM");
    const pendingBabysitting = pending.filter((request) => assignmentServiceType(request) === "BABYSITTING");
    const pendingMassage = pending.filter((request) => assignmentServiceType(request) === "MASSAGE");
    return `<section class="page admin-request-page">${demoBanner()}${pageHeading("SERVICE REQUEST CONTROL", "서비스 신청·승인", "산후조리·베이비시팅·마사지 신청을 검토하고 가격과 일정 충돌 여부를 확인합니다.")}<div class="grid stats">${statCard("Pending review", pending.length, "신청 검토 필요", "!")}${statCard("Postpartum", pendingPostpartum.length, "산후조리 검토 대기", "♡")}${statCard("Babysitting", pendingBabysitting.length, "베이비시팅 검토 대기", "☆")}${statCard("Massage", pendingMassage.length, "마사지 검토 대기", "✦")}</div><div class="service-request-columns three-service-columns" style="margin-top:18px"><article class="card card-pad request-service-column postpartum"><div class="section-header"><div>${serviceBadgeMarkup("POSTPARTUM")}<h3>산후조리 신청</h3><p>출퇴근형 주 $1,800 · 입주형 주 $2,100</p></div><span class="status-chip coral">${pendingPostpartum.length}</span></div><div class="request-list">${pendingPostpartum.length ? pendingPostpartum.map((request) => requestManagementRowMarkup(request, "pending")).join("") : `<div class="empty-state"><strong>검토 대기 신청이 없습니다.</strong></div>`}</div></article><article class="card card-pad request-service-column babysitting"><div class="section-header"><div>${serviceBadgeMarkup("BABYSITTING")}<h3>베이비시팅 신청</h3><p>시간당 $32 · 희망 일정과 생활 루틴을 검토합니다.</p></div><span class="status-chip coral">${pendingBabysitting.length}</span></div><div class="request-list">${pendingBabysitting.length ? pendingBabysitting.map((request) => requestManagementRowMarkup(request, "pending")).join("") : `<div class="empty-state"><strong>검토 대기 신청이 없습니다.</strong></div>`}</div></article><article class="card card-pad request-service-column massage"><div class="section-header"><div>${serviceBadgeMarkup("MASSAGE")}<h3>마사지 신청</h3><p>고객 가격 등급과 자격 테라피스트 일정을 확인합니다.</p></div><span class="status-chip coral">${pendingMassage.length}</span></div><div class="request-list">${pendingMassage.length ? pendingMassage.map((request) => requestManagementRowMarkup(request, "pending")).join("") : `<div class="empty-state"><strong>검토 대기 신청이 없습니다.</strong></div>`}</div></article></div><article class="card card-pad approved-request-queue" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">APPROVED QUEUE</p><h3>일정 배치 가능한 승인 신청</h3><p>돌봄은 동일 아기 일정, 마사지는 자격 테라피스트의 전체 케어기빙 일정을 확인해 배치합니다.</p></div><span class="status-chip gold">${approvedQueue.length} ready</span></div><div class="request-list">${approvedQueue.length ? approvedQueue.map((request) => requestManagementRowMarkup(request, "approved")).join("") : `<div class="empty-state"><strong>일정 배치 대기 신청이 없습니다.</strong><span>신청을 승인하면 이 목록으로 이동합니다.</span></div>`}</div></article>${canReviewServiceRequests() ? depositRefundQueueMarkup(refundDueRequests) : ""}</section>`;
  }

  function serviceRequestStatusLabel(request) {
    const labels = {
      PENDING: "승인 대기",
      APPROVED: request.approvedAssignmentId ? "승인·배정 완료" : "승인·배정 대기",
      REJECTED: "반려",
      CANCELLED: "취소",
    };
    return labels[request.status] || request.status || "상태 미정";
  }

  function financeTransactions() {
    const deposits = state.depositTransactions?.length
      ? state.depositTransactions
      : state.serviceRequests.map((request) => request.depositTransaction).filter(Boolean);
    const balances = state.balanceTransactions?.length
      ? state.balanceTransactions
      : state.serviceRequests.flatMap((request) => request.balanceTransactions || []);
    const refunds = state.refundTransactions?.length
      ? state.refundTransactions
      : state.serviceRequests.flatMap((request) => request.refundTransactions || []);
    return { deposits, balances, refunds };
  }

  function financeRevenueEvents() {
    const { deposits, balances, refunds } = financeTransactions();
    const toEvents = (transactions, category) => transactions.flatMap((transaction) => {
      const events = [];
      const amount = Number(transaction.amount || 0);
      const capturedAt = transaction.capturedAt || transaction.captured_at;
      const refundedAt = transaction.refundedAt || transaction.refunded_at;
      const refundedAmount = Number(transaction.refundedAmount ?? transaction.refunded_amount ?? 0);
      if (capturedAt && amount > 0 && ["CAPTURED", "REFUNDED"].includes(transaction.status)) {
        events.push({ requestId: transaction.requestId || transaction.client_service_request_id, category, kind: "CAPTURE", amount, at: capturedAt });
      }
      if (refundedAt && refundedAmount > 0) {
        events.push({ requestId: transaction.requestId || transaction.client_service_request_id, category, kind: "REFUND", amount: -refundedAmount, at: refundedAt });
      }
      return events;
    });
    const explicitRefundEvents = refunds
      .filter((transaction) => transaction.status === "COMPLETED" && Number(transaction.amount || 0) > 0)
      .map((transaction) => ({
        requestId: transaction.requestId || transaction.client_service_request_id,
        category: "REFUND",
        kind: "REFUND",
        amount: -Number(transaction.amount || 0),
        at: transaction.refundedAt || transaction.refunded_at,
      }));
    return [...toEvents(deposits, "DEPOSIT"), ...toEvents(balances, "BALANCE"), ...explicitRefundEvents]
      .filter((event) => Number.isFinite(new Date(event.at).getTime()))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function financeEventMatches(event, filters) {
    if (filters.period === "ALL") return true;
    const date = new Date(event.at);
    if (date.getFullYear() !== Number(filters.year)) return false;
    return filters.period !== "MONTH" || date.getMonth() + 1 === Number(filters.month);
  }

  function financeApplicationRowMarkup(request) {
    const client = clientById(request.clientId);
    const serviceType = assignmentServiceType(request);
    const clientLinkIssue = requestClientLinkIssue(request);
    const total = requestServiceTotal(request);
    const deposit = requestDepositNet(request);
    const balancePaid = requestBalanceNet(request);
    const ownerDiscount = requestOwnerDiscount(request);
    const outstanding = requestOutstandingBalance(request);
    const depositReference = request.depositTransaction?.externalReference || request.depositTransaction?.external_reference || "";
    const depositReceivedAt = request.depositTransaction?.capturedAt || request.depositTransaction?.captured_at || request.depositPaidAt;
    const latestBalancePayment = [...(request.balanceTransactions || [])]
      .filter((transaction) => transaction.status === "CAPTURED")
      .sort((first, second) => new Date(second.capturedAt || second.captured_at || 0) - new Date(first.capturedAt || first.captured_at || 0))[0];
    const depositLabel = deposit > 0
      ? `${money(deposit)} 수납`
      : request.depositTransaction?.status === "REFUNDED"
        ? "전액 환불"
        : request.status === "APPROVED"
          ? clientLinkIssue ? "고객 연결 복구 필요" : "증빙 미등록"
          : "미수납";
    const canRecordBalance = usingCloudData() && request.status === "APPROVED" && deposit > 0 && outstanding > 0 && !clientLinkIssue;
    const canRecordDeposit = usingCloudData() && request.status === "APPROVED" && deposit <= 0 && !clientLinkIssue;
    const statusTone = ["REJECTED", "CANCELLED"].includes(request.status) || clientLinkIssue ? "coral" : request.status === "PENDING" ? "gold" : "";
    const actionMarkup = canRecordDeposit
      ? `<button class="primary-button mini-button" data-record-approved-deposit="${request.id}">${serviceType === "MASSAGE" ? "서비스 결제" : "예약금"} 확인·기록</button>`
      : canRecordBalance
        ? `<button class="primary-button mini-button" data-record-service-balance="${request.id}">잔금 확인·기록</button>`
        : request.status === "APPROVED" && clientLinkIssue
          ? '<span class="status-chip coral">연결 복구 필요</span>'
          : outstanding === 0 && request.status === "APPROVED"
            ? '<span class="status-chip">수납 완료</span>'
            : "";
    const subject = serviceType === "MASSAGE"
      ? (client?.motherName || "고객 연결 확인 필요")
      : `${client?.motherName || "고객 연결 확인 필요"} · ${babyNameFor(request, client) || "아이 정보 없음"}`;
    const schedule = serviceType === "MASSAGE"
      ? `${formatDate(request.desiredStartDate)} · ${request.durationMinutes || 60}분 × ${request.sessionCount || 1}회`
      : `${formatDate(request.desiredStartDate)} 시작 · ${request.weeks}주`;
    const pricing = ownerDiscount > 0
      ? `오너 할인 -${money(ownerDiscount)} · 정산액 ${money(total - ownerDiscount)}`
      : serviceType === "POSTPARTUM"
        ? `주 ${money(Number(request.weeklyRate || postpartumWeeklyRate(request)))}`
        : serviceType === "MASSAGE"
          ? `${request.pricingTier === "POSTPARTUM_CLIENT" ? "산후조리 고객 우대가" : "일반 고객가"} · ${request.durationMinutes || 60}분`
          : `시간당 ${money(BABYSITTING_HOURLY_RATE)}`;
    return `<div class="finance-ledger-row ${clientLinkIssue ? "has-lifecycle-issue" : ""}"><div class="finance-ledger-primary"><div class="request-title-line">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(subject)}</strong></div><span>${schedule}</span><small>신청 ${request.createdAt ? formatDate(request.createdAt) : "일자 미등록"}</small></div><div><span>신청 상태</span><strong class="status-chip ${statusTone}">${escapeHtml(serviceRequestStatusLabel(request))}</strong><small>${escapeHtml(clientLinkIssue || (request.approvedAssignmentId ? "일정 배정 연결됨" : ""))}</small></div><div><span>총 예정금액</span><strong>${total > 0 ? money(total) : "계산 필요"}</strong><small>${pricing}</small></div><div><span>${serviceType === "MASSAGE" ? "서비스 결제" : "예약금"}</span><strong>${depositLabel}</strong><small>${escapeHtml(depositReference ? `거래 ${depositReference}` : "실제 증빙 기준")}${depositReceivedAt ? ` · ${formatDate(depositReceivedAt)}` : ""}</small></div><div><span>${serviceType === "MASSAGE" ? "추가 수납" : "잔금"}</span><strong>${money(balancePaid)} 수납</strong><small>${request.status === "APPROVED" ? `${money(outstanding)} 미수` : "승인 건만 미수 계산"}${latestBalancePayment ? ` · 최근 ${formatDate(latestBalancePayment.capturedAt || latestBalancePayment.captured_at)}` : ""}</small></div><div class="finance-ledger-action">${actionMarkup}</div></div>`;
  }

  function financeCollectionQueueItemMarkup(request) {
    const client = clientById(request.clientId);
    const clientLinkIssue = requestClientLinkIssue(request);
    const total = requestServiceTotal(request);
    const deposit = requestDepositNet(request);
    const balancePaid = requestBalanceNet(request);
    const ownerDiscount = requestOwnerDiscount(request);
    const outstanding = requestOutstandingBalance(request);
    const requiredDeposit = Number(request.depositAmount || (assignmentServiceType(request) === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT));
    const needsDeposit = deposit <= 0;
    const collected = deposit + balancePaid;
    const settled = collected + ownerDiscount;
    const progress = total > 0 ? Math.min(100, Math.max(0, settled / total * 100)) : 0;
    const actionMarkup = !usingCloudData()
      ? '<span class="status-chip gold">클라우드 연결 필요</span>'
      : clientLinkIssue
        ? '<span class="status-chip coral">고객 연결 복구 필요</span>'
        : needsDeposit
          ? `<button type="button" class="primary-button" data-record-approved-deposit="${request.id}">예약금 ${money(requiredDeposit)} 수납 확인</button>`
          : `<button type="button" class="primary-button" data-record-service-balance="${request.id}">본 금액 ${money(outstanding)} 수납 확인</button>`;
    const nextStep = needsDeposit
      ? `예약금 ${money(requiredDeposit)} 수납을 먼저 기록하면 본 금액 입력 단계가 열립니다.`
      : "전액 또는 실제 받은 일부 금액을 입력할 수 있으며, 저장 즉시 해당 수납월에 반영됩니다.";
    return `<article class="finance-collection-item ${clientLinkIssue ? "has-lifecycle-issue" : ""}"><div class="finance-collection-identity"><div>${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</strong></div><span>${formatDate(request.desiredStartDate)} 시작 · ${request.weeks}주</span></div><div class="finance-collection-amounts"><div><span>총액${ownerDiscount > 0 ? " / 오너 할인" : ""}</span><strong>${money(total)}${ownerDiscount > 0 ? ` / -${money(ownerDiscount)}` : ""}</strong></div><div><span>예약금 수납</span><strong>${money(deposit)}</strong></div><div><span>본 금액 수납</span><strong>${money(balancePaid)}</strong></div><div class="outstanding"><span>현재 미수금</span><strong>${money(outstanding)}</strong></div></div><div class="finance-collection-progress" aria-label="총 예정금액 중 수납과 할인으로 ${Math.round(progress)}% 정산"><span style="width:${progress.toFixed(2)}%"></span></div><div class="finance-collection-footer"><small>${escapeHtml(clientLinkIssue || nextStep)}</small>${actionMarkup}</div></article>`;
  }

  function financeRefundQueueItemMarkup(request) {
    const client = clientById(request.clientId);
    const deposit = requestDepositNet(request);
    const balancePaid = requestBalanceNet(request);
    const refunded = requestRefundTotal(request);
    const refundable = requestRefundableCollectedAmount(request);
    const removed = Boolean(request.administrativelyRemovedAt);
    return `<article class="finance-collection-item finance-refund-item"><div class="finance-collection-identity"><div>${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</strong></div><span>${formatDate(request.desiredStartDate)} 시작 · ${removed ? "삭제된 서비스" : serviceRequestStatusLabel(request)}</span></div><div class="finance-collection-amounts"><div><span>예약금 수납</span><strong>${money(deposit)}</strong></div><div><span>본 금액 수납</span><strong>${money(balancePaid)}</strong></div><div><span>누적 환불</span><strong>${money(refunded)}</strong></div><div class="refundable"><span>추가 환불 가능</span><strong>${money(refundable)}</strong></div></div><div class="finance-collection-footer"><small>실제 환불 완료 후 환불액·처리일·참조번호·사유를 기록하세요.</small><button type="button" class="secondary-button" data-record-service-refund="${request.id}">환불 입력</button></div></article>`;
  }

  function financeRefundQueueMarkup() {
    const requests = state.serviceRequests
      .filter((request) => requestRefundableCollectedAmount(request) > 0)
      .sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));
    const refundableTotal = requests.reduce((sum, request) => sum + requestRefundableCollectedAmount(request), 0);
    return `<article class="card card-pad finance-refund-card"><div class="section-header"><div><p class="eyebrow">REFUND CONTROL</p><h3>서비스별 환불 처리</h3><p>관리자만 실제 환불 완료 내역을 입력할 수 있으며, 처리일 기준 수납·수익 집계에서 자동 차감됩니다.</p></div><span class="status-chip coral">${requests.length}건 · ${money(refundableTotal)} 환불 가능</span></div><div class="finance-collection-list">${requests.length ? requests.map(financeRefundQueueItemMarkup).join("") : `<div class="empty-state"><strong>환불 가능한 수납액이 없습니다.</strong><span>실제 수납이 등록된 서비스가 여기에 표시됩니다.</span></div>`}</div></article>`;
  }

  function adminFinance() {
    const events = financeRevenueEvents();
    const now = new Date();
    const filters = {
      period: ["MONTH", "YEAR", "ALL"].includes(state.financeFilters?.period) ? state.financeFilters.period : "MONTH",
      year: String(Number(state.financeFilters?.year) || now.getFullYear()),
      month: String(Math.min(12, Math.max(1, Number(state.financeFilters?.month) || now.getMonth() + 1))),
    };
    const years = [...new Set([now.getFullYear(), ...events.map((event) => new Date(event.at).getFullYear())])].sort((a, b) => b - a);
    const filteredEvents = events.filter((event) => financeEventMatches(event, filters));
    const sum = (items) => items.reduce((total, item) => total + Number(item.amount || 0), 0);
    const netRevenue = sum(filteredEvents);
    const depositReceipts = sum(filteredEvents.filter((event) => event.category === "DEPOSIT" && event.amount > 0));
    const balanceReceipts = sum(filteredEvents.filter((event) => event.category === "BALANCE" && event.amount > 0));
    const refunds = Math.abs(sum(filteredEvents.filter((event) => event.amount < 0)));
    const outstanding = state.serviceRequests.reduce((total, request) => total + requestOutstandingBalance(request), 0);
    const collectionQueue = state.serviceRequests
      .filter((request) => request.status === "APPROVED" && requestOutstandingBalance(request) > 0)
      .sort((first, second) => new Date(first.desiredStartDate || 0) - new Date(second.desiredStartDate || 0));
    const periodLabel = filters.period === "ALL" ? "전체 기간" : filters.period === "YEAR" ? `${filters.year}년` : `${filters.year}년 ${filters.month}월`;
    const monthlyRows = Array.from({ length: 12 }, (_, monthIndex) => {
      const monthEvents = events.filter((event) => {
        const date = new Date(event.at);
        return date.getFullYear() === Number(filters.year) && date.getMonth() === monthIndex;
      });
      return `<div class="revenue-summary-row ${Number(filters.month) === monthIndex + 1 && filters.period === "MONTH" ? "active" : ""}"><span>${monthIndex + 1}월</span><strong>${money(sum(monthEvents))}</strong><small>수납 ${monthEvents.filter((item) => item.amount > 0).length}건 · 환불 ${monthEvents.filter((item) => item.amount < 0).length}건</small></div>`;
    }).join("");
    const yearlyRows = years.map((year) => {
      const yearEvents = events.filter((event) => new Date(event.at).getFullYear() === year);
      return `<div class="revenue-summary-row ${String(year) === filters.year && filters.period === "YEAR" ? "active" : ""}"><span>${year}년</span><strong>${money(sum(yearEvents))}</strong><small>거래 ${yearEvents.length}건</small></div>`;
    }).join("");
    const applications = [...state.serviceRequests].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return `<section class="page admin-finance-page">${demoBanner()}${pageHeading("SERVICE FINANCE", "수납·수익 관리", "신청별 예약금과 본 금액을 실제 거래 기준으로 관리하고 수납일 기준 실수납 순액을 확인합니다.")}<form class="card finance-filter-bar" data-finance-filter><div><label for="finance-period">조회 단위</label><select id="finance-period" name="period"><option value="MONTH" ${filters.period === "MONTH" ? "selected" : ""}>월별</option><option value="YEAR" ${filters.period === "YEAR" ? "selected" : ""}>연도별</option><option value="ALL" ${filters.period === "ALL" ? "selected" : ""}>전체 기간</option></select></div><div><label for="finance-year">연도</label><select id="finance-year" name="year" ${filters.period === "ALL" ? "disabled" : ""}>${years.map((year) => `<option value="${year}" ${String(year) === filters.year ? "selected" : ""}>${year}년</option>`).join("")}</select></div><div><label for="finance-month">월</label><select id="finance-month" name="month" ${filters.period !== "MONTH" ? "disabled" : ""}>${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}" ${Number(filters.month) === index + 1 ? "selected" : ""}>${index + 1}월</option>`).join("")}</select></div><button type="submit" class="primary-button">조회</button><span>${periodLabel} · 실제 수납/환불 발생일 기준</span></form><div class="grid stats finance-stats">${statCard("Net collected", money(netRevenue), `${periodLabel} 실수납 순액`, "$ ")}${statCard("Deposits", money(depositReceipts), "예약금 수납", "◈")}${statCard("Service payments", money(balanceReceipts), "본 금액 수납", "✓")}${statCard("Outstanding", money(outstanding), `전체 승인 건 미수 · 환불 ${money(refunds)}`, "!")}</div><div class="finance-reconciliation-note"><div><strong>미수금 ${money(outstanding)}은 아직 수익에 포함되지 않습니다.</strong><span>실제로 받은 금액을 아래에서 확인·저장하면 선택한 실제 수납일의 월별·연도별 실수납 순액에 자동 반영됩니다.</span></div><span>실수납 순액 = 예약금 + 본 금액 − 환불액</span></div><article class="card card-pad finance-collection-card"><div class="section-header"><div><p class="eyebrow">OUTSTANDING COLLECTION</p><h3>미수금 수납 처리</h3><p>예약금과 그 외 본 금액을 단계별로 확인합니다. 본 금액은 전액 또는 분할 수납할 수 있습니다.</p></div><span class="status-chip gold">${collectionQueue.length}건 · ${money(outstanding)}</span></div><div class="finance-collection-list">${collectionQueue.length ? collectionQueue.map(financeCollectionQueueItemMarkup).join("") : `<div class="empty-state"><strong>현재 미수금이 없습니다.</strong><span>모든 승인 건의 수납 확인이 완료되었습니다.</span></div>`}</div></article><div class="grid two finance-summary-grid"><article class="card card-pad"><div class="section-header"><div><p class="eyebrow">MONTHLY COLLECTION</p><h3>${filters.year}년 월별 실수납 순액</h3><p>실제 수납액에서 같은 달의 환불액을 차감합니다.</p></div></div><div class="revenue-summary-list">${monthlyRows}</div></article><article class="card card-pad"><div class="section-header"><div><p class="eyebrow">YEARLY COLLECTION</p><h3>연도별 실수납 순액</h3><p>저장된 실제 거래 전체를 연도 단위로 합산합니다.</p></div></div><div class="revenue-summary-list">${yearlyRows || `<div class="empty-state"><strong>수납 거래가 없습니다.</strong></div>`}</div></article></div><article class="card card-pad finance-ledger-card"><div class="section-header"><div><p class="eyebrow">APPLICATION & PAYMENT LEDGER</p><h3>신청·예약금·본 금액 원장</h3><p>모든 서비스 신청과 실제 수납 내역을 최신순으로 표시합니다. 예약금 수납 후 본 금액을 기록할 수 있습니다.</p></div><span class="status-chip">${applications.length}건</span></div><div class="finance-ledger-scroll"><div class="finance-ledger-head"><span>신청</span><span>상태</span><span>총 예정금액</span><span>예약금</span><span>본 금액</span><span>관리</span></div><div class="finance-ledger-list">${applications.length ? applications.map(financeApplicationRowMarkup).join("") : `<div class="empty-state"><strong>서비스 신청 내역이 없습니다.</strong></div>`}</div></div></article></section>`;
  }

  function serviceHistoryAssignment(request) {
    return state.assignments.find((assignment) => assignment.id === request.approvedAssignmentId)
      || state.assignments.find((assignment) => assignment.serviceRequestId === request.id)
      || null;
  }

  function serviceHistoryLifecycle(request) {
    if (request.administrativelyRemovedAt) return { code: "REMOVED", label: "관리자 삭제", tone: "coral" };
    const assignment = serviceHistoryAssignment(request);
    const assignmentStatus = assignment?.databaseStatus || assignment?.status;
    if (assignmentStatus === "COMPLETED") return { code: "COMPLETED", label: "서비스 완료", tone: "" };
    if (assignmentStatus === "CANCELLED" || request.status === "CANCELLED") return { code: "CANCELLED", label: "서비스 취소", tone: "coral" };
    if (assignment && new Date(assignment.endAt) < new Date()) return { code: "COMPLETED", label: "기간 종료", tone: "" };
    if (assignment && new Date(assignment.startAt) <= new Date()) return { code: "ACTIVE", label: "서비스 진행", tone: "gold" };
    if (request.status === "APPROVED") return { code: "APPROVED", label: assignment ? "서비스 예정" : "배정 대기", tone: "gold" };
    if (request.status === "PENDING") return { code: "PENDING", label: "승인 대기", tone: "gold" };
    if (request.status === "REJECTED") return { code: "REJECTED", label: "신청 반려", tone: "coral" };
    return { code: request.status || "UNKNOWN", label: serviceRequestStatusLabel(request), tone: "" };
  }

  function serviceHistoryPeriod(request, assignment = serviceHistoryAssignment(request)) {
    const start = assignment?.startAt || request.desiredStartDate;
    const end = assignment?.endAt || request.desiredEndDate;
    return `${start ? formatDate(start) : "미정"}${end ? ` – ${formatDate(end)}` : ""}`;
  }

  function serviceHistoryRowMarkup(request) {
    const client = clientById(request.clientId);
    const requester = state.users.find((user) => user.id === request.userId);
    const assignment = serviceHistoryAssignment(request);
    const caregiver = state.users.find((user) => user.id === assignment?.caregiverUserId);
    const lifecycle = serviceHistoryLifecycle(request);
    const total = requestServiceTotal(request);
    const refunded = requestRefundTotal(request);
    const outstanding = requestOutstandingBalance(request);
    return `<div class="service-history-row ${lifecycle.code === "REMOVED" ? "removed" : ""}"><div class="service-history-person"><strong>${escapeHtml(client?.motherName || requester?.fullName || "고객 연결 확인 필요")}</strong><span>${escapeHtml(babyNameFor(request, client) || "아이 정보 미등록")}</span></div><div>${serviceBadgeMarkup(request.serviceType)}<small>${request.requestKind === "EXTENSION" ? "기간 연장" : "일반 신청"}</small></div><div><strong>${serviceHistoryPeriod(request, assignment)}</strong><span>${escapeHtml(assignment ? `${assignment.dailyStart}–${assignment.dailyEnd}` : `${request.dailyStart || "--:--"}–${request.dailyEnd || "--:--"}`)}</span></div><div><span class="status-chip ${lifecycle.tone}">${lifecycle.label}</span><small>${escapeHtml(caregiver?.fullName ? `${caregiver.fullName} 관리사` : assignment ? "관리사 연결 확인" : "미배정")}</small></div><div><strong>${money(requestNetCollectedAmount(request))} 순수납</strong><span>예정 ${money(total)} · 환불 ${money(refunded)}</span><small>${outstanding > 0 ? `미수 ${money(outstanding)}` : ""}</small></div><div class="service-history-actions"><button type="button" class="secondary-button mini-button" data-view-service-history="${request.id}">상세</button>${!request.administrativelyRemovedAt ? `<button type="button" class="danger-button mini-button" data-archive-service-request="${request.id}">서비스 삭제</button>` : ""}</div></div>`;
  }

  function archivedServiceAuditRowMarkup(request) {
    const client = clientById(request.clientId);
    const requester = state.users.find((user) => user.id === request.userId);
    const removedBy = state.users.find((user) => user.id === request.administrativelyRemovedBy);
    return `<div class="service-archive-audit-row"><div><strong>${escapeHtml(client?.motherName || requester?.fullName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 미등록")}</strong><span>${serviceMetaFor(request.serviceType).label} · ${serviceHistoryPeriod(request)}</span></div><div><span>삭제 처리</span><strong>${request.administrativelyRemovedAt ? formatDateTime(request.administrativelyRemovedAt) : "시각 미등록"}</strong></div><div><span>처리 관리자</span><strong>${escapeHtml(removedBy?.fullName || "관리자 계정")}</strong></div><div><span>삭제 사유</span><strong>${escapeHtml(request.administrativeRemovalReason || "사유 미등록")}</strong></div><button type="button" class="secondary-button mini-button" data-view-service-history="${request.id}">보존 기록 보기</button></div>`;
  }

  function adminServiceHistory() {
    const filters = {
      query: String(state.serviceHistoryFilters?.query || "").trim(),
      serviceType: ["ALL", "POSTPARTUM", "BABYSITTING", "MASSAGE"].includes(state.serviceHistoryFilters?.serviceType) ? state.serviceHistoryFilters.serviceType : "ALL",
      status: ["ALL", "PENDING", "APPROVED", "ACTIVE", "COMPLETED", "CANCELLED", "REJECTED", "REMOVED"].includes(state.serviceHistoryFilters?.status) ? state.serviceHistoryFilters.status : "ALL",
      sort: ["newest", "oldest", "service-newest", "service-oldest"].includes(state.serviceHistoryFilters?.sort) ? state.serviceHistoryFilters.sort : "newest",
    };
    const normalizedQuery = normalizeDirectorySearch(filters.query);
    const rows = state.serviceRequests
      .filter((request) => {
        if (filters.serviceType !== "ALL" && assignmentServiceType(request) !== filters.serviceType) return false;
        if (filters.status !== "ALL" && serviceHistoryLifecycle(request).code !== filters.status) return false;
        if (!normalizedQuery) return true;
        const client = clientById(request.clientId);
        const requester = state.users.find((user) => user.id === request.userId);
        return normalizeDirectorySearch([
          client?.motherName,
          babyNameFor(request, client),
          requester?.fullName,
          requester?.email,
          request.id,
        ].join(" ")).includes(normalizedQuery);
      })
      .sort((first, second) => {
        const firstDate = filters.sort.startsWith("service-") ? serviceHistoryAssignment(first)?.startAt || first.desiredStartDate : first.createdAt;
        const secondDate = filters.sort.startsWith("service-") ? serviceHistoryAssignment(second)?.startAt || second.desiredStartDate : second.createdAt;
        const direction = ["oldest", "service-oldest"].includes(filters.sort) ? 1 : -1;
        return direction * (new Date(firstDate || 0) - new Date(secondDate || 0));
      });
    const counts = state.serviceRequests.reduce((result, request) => {
      const code = serviceHistoryLifecycle(request).code;
      result[code] = (result[code] || 0) + 1;
      return result;
    }, {});
    const archivedServices = state.serviceRequests
      .filter((request) => request.administrativelyRemovedAt)
      .sort((first, second) => new Date(second.administrativelyRemovedAt) - new Date(first.administrativelyRemovedAt));
    return `<section class="page service-history-page">${demoBanner()}${pageHeading("SERVICE HISTORY", "서비스 히스토리 관리", "발생한 모든 서비스의 신청·배정·수납·환불 상태를 한 줄 원장으로 확인합니다.")}<div class="grid stats">${statCard("All services", state.serviceRequests.length, "전체 발생 서비스", "≡")}${statCard("In operation", Number(counts.ACTIVE || 0) + Number(counts.APPROVED || 0), "진행·예정·배정 대기", "◷")}${statCard("Completed", Number(counts.COMPLETED || 0), "완료·기간 종료", "✓")}${statCard("Archived", archivedServices.length, "관리자 삭제·감사 보관", "×")}</div><form class="card service-history-filter" data-service-history-filter><div class="field"><label for="history-query">고객명·아이명·이메일</label><input id="history-query" name="query" value="${escapeHtml(filters.query)}" placeholder="예: Sarah Kim" autocomplete="off"/></div><div class="field"><label for="history-service-type">서비스</label><select id="history-service-type" name="serviceType"><option value="ALL" ${filters.serviceType === "ALL" ? "selected" : ""}>전체 서비스</option><option value="POSTPARTUM" ${filters.serviceType === "POSTPARTUM" ? "selected" : ""}>산후조리</option><option value="BABYSITTING" ${filters.serviceType === "BABYSITTING" ? "selected" : ""}>베이비시팅</option></select></div><div class="field"><label for="history-status">상태</label><select id="history-status" name="status"><option value="ALL" ${filters.status === "ALL" ? "selected" : ""}>전체 상태</option><option value="PENDING" ${filters.status === "PENDING" ? "selected" : ""}>승인 대기</option><option value="APPROVED" ${filters.status === "APPROVED" ? "selected" : ""}>예정·배정 대기</option><option value="ACTIVE" ${filters.status === "ACTIVE" ? "selected" : ""}>진행</option><option value="COMPLETED" ${filters.status === "COMPLETED" ? "selected" : ""}>완료</option><option value="CANCELLED" ${filters.status === "CANCELLED" ? "selected" : ""}>취소</option><option value="REJECTED" ${filters.status === "REJECTED" ? "selected" : ""}>반려</option><option value="REMOVED" ${filters.status === "REMOVED" ? "selected" : ""}>관리자 삭제</option></select></div><div class="field"><label for="history-sort">정렬</label><select id="history-sort" name="sort"><option value="newest" ${filters.sort === "newest" ? "selected" : ""}>최근 신청순</option><option value="oldest" ${filters.sort === "oldest" ? "selected" : ""}>오래된 신청순</option><option value="service-newest" ${filters.sort === "service-newest" ? "selected" : ""}>최근 서비스일순</option><option value="service-oldest" ${filters.sort === "service-oldest" ? "selected" : ""}>오래된 서비스일순</option></select></div><div class="service-history-filter-actions"><button type="submit" class="primary-button">조회</button><button type="button" class="secondary-button" data-clear-service-history>초기화</button></div></form><article class="card card-pad service-history-ledger"><div class="section-header"><div><p class="eyebrow">AUDITABLE SERVICE LEDGER</p><h3>전체 서비스 원장</h3><p>신청 이후 발생한 모든 서비스 상태를 표시합니다. 각 행의 상세 보기와 서비스 삭제 기능을 사용할 수 있습니다.</p></div><span class="status-chip">${rows.length}건 표시</span></div><div class="service-history-scroll"><div class="service-history-head"><span>고객·아이</span><span>서비스</span><span>기간·시간</span><span>상태·관리사</span><span>수납·환불</span><span>관리</span></div><div class="service-history-list">${rows.length ? rows.map(serviceHistoryRowMarkup).join("") : `<div class="empty-state"><strong>조건에 맞는 서비스가 없습니다.</strong><span>검색어 또는 필터를 변경해 주세요.</span></div>`}</div></div></article><article class="card card-pad service-archive-audit-card"><div class="section-header"><div><p class="eyebrow">REMOVAL AUDIT TRAIL</p><h3>서비스 삭제·감사 보존 기록</h3><p>운영 목록에서 삭제된 서비스의 처리 관리자·처리 시각·삭제 사유를 별도로 보존합니다.</p></div><span class="status-chip coral">${archivedServices.length}건 보존</span></div><div class="service-archive-audit-scroll"><div class="service-archive-audit-head"><span>고객·서비스</span><span>삭제 시각</span><span>처리 관리자</span><span>삭제 사유</span><span>보존 기록</span></div><div class="service-archive-audit-list">${archivedServices.length ? archivedServices.map(archivedServiceAuditRowMarkup).join("") : `<div class="empty-state"><strong>삭제된 서비스가 없습니다.</strong><span>서비스를 안전 삭제하면 처리 관리자·시각·사유가 이 목록에 보존됩니다.</span></div>`}</div></div></article></section>`;
  }

  function adminPeople() {
    const pendingCaregivers = state.users.filter(isCaregiverPendingApproval);
    const caregivers = state.users.filter((user) => usingCloudData() ? user.databaseRoles?.includes("CAREGIVER") : user.role === "caregiver");
    const activeClients = state.clients.filter((client) => (client.clientStatus || "ACTIVE") === "ACTIVE");
    const directory = state.peopleDirectory || {};
    const activeSection = ["members", "clients", "caregivers"].includes(directory.activeSection) ? directory.activeSection : "members";
    const memberQuery = normalizeDirectorySearch(directory.memberQuery);
    const clientQuery = normalizeDirectorySearch(directory.clientQuery);
    const caregiverQuery = normalizeDirectorySearch(directory.caregiverQuery);
    const members = [...state.users]
      .filter((user) => {
        if (!memberQuery) return true;
        const searchable = [user.fullName, user.email, user.login, user.phone, user.role, ...(user.databaseRoles || []), user.status, user.accountStatus].join(" ");
        return normalizeDirectorySearch(searchable).includes(memberQuery);
      })
      .sort((first, second) => {
        if (directory.memberSort === "oldest") return compareDirectoryDate(first.createdAt, second.createdAt, false);
        if (directory.memberSort === "name-asc") return compareDirectoryText(first.fullName, second.fullName);
        if (directory.memberSort === "name-desc") return compareDirectoryText(first.fullName, second.fullName, true);
        return compareDirectoryDate(first.createdAt, second.createdAt, true);
      });
    const clients = state.clients
      .filter((client) => {
        if (!clientQuery) return true;
        const user = state.users.find((item) => item.id === client.userId);
        const assignment = directoryClientAssignment(client.id);
        const searchable = [client.motherName, ...babiesForClient(client).map((baby) => baby.name), user?.email, user?.phone, client.address, client.allergies, client.maternalStatus, client.internalMemo, assignment?.startAt ? new Date(assignment.startAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long" }) : ""].join(" ");
        return normalizeDirectorySearch(searchable).includes(clientQuery);
      })
      .sort((first, second) => {
        if (directory.clientSort === "mother-desc") return compareDirectoryText(first.motherName, second.motherName, true);
        if (directory.clientSort === "baby-asc") return compareDirectoryText(first.babyName, second.babyName);
        if (directory.clientSort === "baby-desc") return compareDirectoryText(first.babyName, second.babyName, true);
        if (directory.clientSort === "care-newest") return compareDirectoryDate(directoryClientAssignment(first.id)?.startAt, directoryClientAssignment(second.id)?.startAt, true);
        if (directory.clientSort === "care-oldest") return compareDirectoryDate(directoryClientAssignment(first.id)?.startAt, directoryClientAssignment(second.id)?.startAt, false);
        return compareDirectoryText(first.motherName, second.motherName);
      });
    const sortedCaregivers = caregivers
      .filter((user) => {
        if (!caregiverQuery) return true;
        return normalizeDirectorySearch([user.fullName, user.email, user.phone, user.residentialArea, user.serviceArea, user.certification, user.specialties].join(" ")).includes(caregiverQuery);
      })
      .sort((first, second) => {
        if (directory.caregiverSort === "name-desc") return compareDirectoryText(first.fullName, second.fullName, true);
        if (directory.caregiverSort === "hire-newest") return compareDirectoryDate(first.hireDate, second.hireDate, true);
        if (directory.caregiverSort === "hire-oldest") return compareDirectoryDate(first.hireDate, second.hireDate, false);
        if (directory.caregiverSort === "residence-asc") return compareDirectoryText(first.residentialArea, second.residentialArea);
        if (directory.caregiverSort === "residence-desc") return compareDirectoryText(first.residentialArea, second.residentialArea, true);
        return compareDirectoryText(first.fullName, second.fullName);
      });
    const memberPage = paginateDirectory(members, directory.memberPage, directory.memberPageSize || 10);
    const clientPage = paginateDirectory(clients, directory.clientPage, directory.clientPageSize);
    const caregiverPage = paginateDirectory(sortedCaregivers, directory.caregiverPage, directory.caregiverPageSize);
    const memberCount = memberQuery ? `${members.length} / ${state.users.length} members` : `${state.users.length} members`;
    const clientCount = clientQuery ? `${clients.length} / ${state.clients.length} families` : `${state.clients.length} families`;
    const caregiverCount = caregiverQuery ? `${sortedCaregivers.length} / ${caregivers.length} people` : `${caregivers.length} people`;
    const activeMemberCount = state.users.filter((user) => user.accountStatus !== "REJECTED").length;
    const sectionTabs = [
      { id: "members", icon: "◎", label: "회원 데이터베이스", description: "권한·계정 상태", count: state.users.length },
      { id: "clients", icon: "♡", label: "고객·아기 관리", description: "프로필·상담 정보", count: state.clients.length },
      { id: "caregivers", icon: "♙", label: "관리사 관리", description: "인사·공개 프로필", count: caregivers.length },
    ];
    const sectionNav = `<nav class="people-section-tabs" role="tablist" aria-label="회원과 고객, 관리사 관리 메뉴">${sectionTabs.map((tab) => `<button type="button" id="people-tab-${tab.id}" class="people-section-tab ${activeSection === tab.id ? "active" : ""}" role="tab" aria-selected="${activeSection === tab.id}" aria-controls="people-panel" data-people-section="${tab.id}"><span class="people-section-tab-icon" aria-hidden="true">${tab.icon}</span><span><strong>${tab.label}</strong><small>${tab.description}</small></span><em>${tab.count}</em></button>`).join("")}</nav>`;
    const memberPanel = `<article class="card card-pad management-directory member-governance"><div class="section-header"><div><p class="eyebrow">MEMBER DATABASE</p><h3>웹앱 회원 데이터베이스 관리</h3><p>회원 검색, 작업공간 권한 구성, 로그인 상태 관리를 이 화면에서 처리합니다.</p></div><span class="status-chip">${activeMemberCount} active · ${memberCount}</span></div>${directoryToolbarMarkup("member", directory.memberQuery || "", directory.memberSort || "newest", directory.memberPageSize || 10)}<div class="management-list">${memberPage.items.length ? memberPage.items.map(memberAccountRowMarkup).join("") : `<div class="directory-empty"><strong>검색 결과가 없습니다.</strong><span>회원 이름이나 이메일을 다시 확인해 주세요.</span></div>`}</div>${directoryPaginationMarkup("member", memberPage)}</article>`;
    const clientPanel = `<article class="card card-pad management-directory"><div class="section-header"><div><p class="eyebrow">CLIENT CRM</p><h3>고객·아기 관리</h3><p>고객·아기 이름 또는 관리 년월로 찾고 상담·계약 정보를 관리합니다.</p></div><span class="status-chip">${clientCount}</span></div>${directoryToolbarMarkup("client", directory.clientQuery || "", directory.clientSort || "mother-asc", directory.clientPageSize || 5)}<div class="management-list">${clientPage.items.length ? clientPage.items.map(clientManagementRowMarkup).join("") : `<div class="directory-empty"><strong>검색 결과가 없습니다.</strong><span>검색어를 바꾸거나 초기화해 주세요.</span></div>`}</div>${directoryPaginationMarkup("client", clientPage)}</article>`;
    const approvalPanel = pendingCaregivers.length ? `<article class="card card-pad approval-panel"><div class="section-header"><div><h3>승인 대기 관리사</h3><p>자격·경력 정보를 검토하고 인사정보를 보완한 후 승인하세요.</p></div><span class="status-chip coral">${pendingCaregivers.length} pending</span></div><div class="people-list">${pendingCaregivers.map((user) => `<div class="person-row pending-caregiver-row"><div class="mini-avatar">${escapeHtml(user.initials)}</div><div class="person-copy"><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email)} · ${escapeHtml(user.certification || "자격 정보 미입력")}</span></div><div class="management-actions"><button class="secondary-button mini-button" data-manage-caregiver="${user.id}">프로필 검토</button><button class="primary-button mini-button" data-approve-user="${user.id}">관리사 승인</button></div></div>`).join("")}</div></article>` : `<div class="status-banner success compact-status">✓ 현재 승인 대기 중인 관리사가 없습니다.</div>`;
    const caregiverPanel = `${approvalPanel}<article class="card card-pad management-directory"><div class="section-header"><div><p class="eyebrow">CAREGIVER HR</p><h3>관리사 인사관리</h3><p>이름, 입사년월, 거주지역 기준으로 관리사를 빠르게 찾고 정렬합니다.</p></div><span class="status-chip">${caregiverCount}</span></div>${directoryToolbarMarkup("caregiver", directory.caregiverQuery || "", directory.caregiverSort || "name-asc", directory.caregiverPageSize || 5)}<div class="management-list">${caregiverPage.items.length ? caregiverPage.items.map(caregiverManagementRowMarkup).join("") : `<div class="directory-empty"><strong>검색 결과가 없습니다.</strong><span>검색어를 바꾸거나 초기화해 주세요.</span></div>`}</div>${directoryPaginationMarkup("caregiver", caregiverPage)}</article>`;
    const activePanel = activeSection === "clients" ? clientPanel : activeSection === "caregivers" ? caregiverPanel : memberPanel;
    return `
      <section class="page people-admin-page">
        ${demoBanner()}
        ${pageHeading("PEOPLE OPERATIONS", "회원·고객·관리사 관리", "필요한 관리 항목만 선택해 집중해서 처리할 수 있습니다.")}
        <div class="grid stats people-stats">${statCard("Clients", state.clients.length, `${activeClients.length}명 서비스 관리 중`, "♡")}${statCard("Caregivers", caregivers.length, `${caregivers.filter((user) => user.status === "approved").length}명 승인됨`, "♙")}${statCard("Active assignments", state.assignments.filter(isAssignmentCurrent).length, "현재 진행 중", "◷")}${statCard("Caregiver approvals", pendingCaregivers.length, "관리사 계정 검토 필요", "!")}</div>
        ${sectionNav}
        <div id="people-panel" class="people-section-panel" role="tabpanel" aria-labelledby="people-tab-${activeSection}">${activePanel}</div>
      </section>`;
  }

  function serviceWorkspaceTabsMarkup(role, serviceType, activeTab) {
    const tabs = role === "client"
      ? (serviceType === "BABYSITTING" ? [["summary", "오늘의 시팅"], ["timeline", "시팅 타임라인"], ["report", "기간 리포트"]] : [["summary", "오늘의 요약"], ["timeline", "케어 타임라인"], ["charts", "관리 차트"], ["report", "기간 리포트"]])
      : (serviceType === "BABYSITTING" ? [["today", "오늘의 시팅"], ["timeline", "시팅 기록"], ["report", "기간 리포트"]] : [["today", "오늘의 케어"], ["timeline", "케어 기록"], ["charts", "관리 차트"], ["report", "기간 리포트"]]);
    return `<div class="service-workspace-nav ${serviceMetaFor(serviceType).tone}"><div>${serviceBadgeMarkup(serviceType)}<strong>${role === "client" ? "나의 서비스 상세" : "나의 케어기빙 상세"}</strong></div><div role="tablist" aria-label="${serviceMetaFor(serviceType).label} 상세 메뉴">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${activeTab === id}" class="${activeTab === id ? "active" : ""}" data-service-tab="${id}" data-service-type="${serviceType}">${label}</button>`).join("")}</div></div>`;
  }

  function caregiverServiceOverviewCard(user, serviceType) {
    const current = currentAssignmentFor(user.id, serviceType);
    const next = nextAssignmentFor(user.id, serviceType);
    const meta = serviceMetaFor(serviceType);
    const primary = current || next;
    if (!primary) return `<article class="card service-overview-card empty ${meta.tone}"><div class="service-overview-icon">${meta.icon}</div><div>${serviceBadgeMarkup(serviceType)}<h3>현재 담당 중인 ${meta.label} 케어기빙이 없습니다.</h3><p>관리자가 승인된 고객 신청을 배정하면 이 영역에 표시됩니다.</p></div><button class="secondary-button" data-enter-caregiver-service="${serviceType}">작업공간 확인</button></article>`;
    if (!caregiverCanViewClientBrief(primary)) return `<article class="card service-overview-card empty ${meta.tone}"><div class="service-overview-icon">${meta.icon}</div><div>${serviceBadgeMarkup(serviceType)}<h3>다음 배정이 예정되어 있습니다.</h3><p>${formatDate(primary.startAt)} 시작 · ${caregiverClientBriefAccessText(primary)}</p></div><button class="secondary-button" type="button" disabled>고객 정보 공개 대기</button></article>`;
    const client = clientById(primary.clientId);
    if (!client) return `<article class="card service-overview-card empty ${meta.tone}"><div class="service-overview-icon">!</div><div>${serviceBadgeMarkup(serviceType)}<h3>배정 고객 정보를 확인할 수 없습니다.</h3><p>개인정보 보호 또는 데이터 연결 상태를 관리자가 확인해야 합니다.</p></div></article>`;
    const babyName = babyNameFor(primary, client) || "아이";
    return `<article class="card service-overview-card ${meta.tone}"><div class="service-overview-top"><div>${serviceBadgeMarkup(serviceType)}<h3>${current ? "현재 담당 중" : "다음 배정 예정"}</h3></div><span class="status-chip ${current ? "" : "gold"}">${assignmentCountdown(primary)}</span></div><strong class="service-overview-family">${escapeHtml(client.motherName)} · ${escapeHtml(babyName)}</strong><p>${formatDate(assignmentStartDateKey(primary))}–${formatDate(assignmentEndDateKey(primary))} · 고객 요청 참고시간 ${primary.dailyStart}–${primary.dailyEnd}</p><div class="service-overview-actions"><button class="primary-button" data-enter-caregiver-service="${serviceType}">${meta.label} 작업공간</button><button class="secondary-button" data-caregiver-assignment-detail="${primary.id}">고객 정보</button></div></article>`;
  }

  function caregiverMassageOverviewCard(user) {
    if (!user.isMassageTherapist) return "";
    const current = currentAssignmentFor(user.id, "MASSAGE");
    const next = nextAssignmentFor(user.id, "MASSAGE");
    const booking = current || next;
    if (!booking) return `<article class="card service-overview-card empty massage"><div class="service-overview-icon">✦</div><div>${serviceBadgeMarkup("MASSAGE")}<h3>예정된 마사지 예약이 없습니다.</h3><p>관리자가 예약을 확정하면 이곳에서 일정을 확인할 수 있습니다.</p></div></article>`;
    const client = clientById(booking.clientId);
    if (!client) return `<article class="card service-overview-card empty massage"><div class="service-overview-icon">!</div><div>${serviceBadgeMarkup("MASSAGE")}<h3>예약 고객 연결 확인이 필요합니다.</h3><p>관리자에게 예약 데이터 연결을 확인해 달라고 요청해 주세요.</p></div></article>`;
    const canSeeBrief = caregiverCanViewClientBrief(booking);
    return `<article class="card service-overview-card massage"><div class="service-overview-top"><div>${serviceBadgeMarkup("MASSAGE")}<h3>${current ? "현재 마사지 일정" : "다음 마사지 예약"}</h3></div><span class="status-chip ${current ? "" : "gold"}">${assignmentCountdown(booking)}</span></div><strong class="service-overview-family">${canSeeBrief ? escapeHtml(client.motherName) : "고객 정보 공개 대기"}</strong><p>${formatDate(booking.startAt)} · ${booking.dailyStart}–${booking.dailyEnd} · ${booking.durationMinutes || 60}분${Number(booking.sessionCount || 1) > 1 ? ` × ${booking.sessionCount}회` : ""}</p><div class="service-overview-actions">${canSeeBrief ? `<button class="secondary-button" data-caregiver-assignment-detail="${booking.id}">예약·방문 정보</button>` : `<button class="secondary-button" type="button" disabled>${caregiverClientBriefAccessText(booking)}</button>`}</div></article>`;
  }

  function caregiverCaregivingHub() {
    const user = authUser();
    const activeAssignments = state.assignments.filter((assignment) => assignment.caregiverUserId === user.id && isAssignmentCurrent(assignment));
    const upcomingAssignments = state.assignments.filter((assignment) => assignment.caregiverUserId === user.id && assignment.status !== "CANCELLED" && new Date(assignment.startAt) > new Date());
    const retrospectiveAssignments = retrospectiveAssignmentsFor(user.id);
    const enabledCareServices = [
      user.canProvidePostpartum !== false ? "POSTPARTUM" : null,
      user.canProvideBabysitting !== false ? "BABYSITTING" : null,
    ].filter(Boolean);
    const serviceStats = enabledCareServices.map((serviceType) => {
      const meta = serviceMetaFor(serviceType);
      return statCard(meta.shortLabel, activeAssignments.filter((item) => assignmentServiceType(item) === serviceType).length, `${meta.shortLabel} 진행 중`, meta.icon);
    }).join("");
    const serviceCards = enabledCareServices.map((serviceType) => caregiverServiceOverviewCard(user, serviceType)).join("");
    return `<section class="page service-hub-page">${demoBanner()}${pageHeading("MY CAREGIVING", "나의 서비스 일정", "관리자가 부여한 산후조리·베이비시팅 권한과 실제 배정 일정을 확인합니다.")}<div class="grid stats">${statCard("Current", activeAssignments.filter((item) => assignmentServiceType(item) !== "MASSAGE").length, "현재 진행 중인 케어 배정", "◷")}${serviceStats}</div><div class="service-overview-grid" style="margin-top:18px">${serviceCards}</div><article class="card card-pad retrospective-entry-card" style="margin-top:18px"><div><p class="eyebrow">RETROSPECTIVE CARE RECORD</p><h3>지난 근무 리포트 보완</h3><p>웹 기록을 놓친 실제 돌봄 근무를 소급 입력할 수 있습니다. 서비스 날짜와 실제 근무시간은 그대로 기록되고, 입력자와 뒤늦게 입력한 시각은 감사 이력에 별도로 남습니다.</p></div><button type="button" class="primary-button" data-open-retrospective-report ${retrospectiveAssignments.length ? "" : "disabled"}>지난 근무 리포트 입력</button></article><article class="card card-pad service-boundary-note" style="margin-top:18px"><strong>서비스별 기록·업무 범위</strong><p>부여받은 서비스만 메뉴와 배정 후보에 표시됩니다. 산후조리에는 산모·신생아 케어 차트, 베이비시팅에는 식사·생활 이벤트를 기록하며 마사지는 별도 테라피스트 작업공간에서 관리합니다.</p></article></section>`;
  }

  function retrospectiveAssignmentsFor(userId) {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    return state.assignments
      .filter((assignment) => assignment.caregiverUserId === userId
        && assignment.status !== "CANCELLED"
        && assignmentServiceType(assignment) !== "MASSAGE"
        && new Date(assignment.startAt) <= todayEnd)
      .sort((first, second) => new Date(second.endAt) - new Date(first.endAt));
  }

  function latestRetrospectiveServiceDate(assignment) {
    const assignmentStart = startOfLocalDay(assignment.startAt);
    const assignmentEnd = startOfLocalDay(assignment.endAt);
    const today = startOfLocalDay(new Date());
    const cursor = new Date(Math.min(assignmentEnd.getTime(), today.getTime()));
    while (cursor >= assignmentStart && !assignmentOccursOnDate(assignment, cursor)) cursor.setDate(cursor.getDate() - 1);
    return cursor >= assignmentStart ? localDateKey(cursor) : localDateKey(assignmentStart);
  }

  function caregiverAssignmentPeekMarkup(assignment, label) {
    if (!assignment) return `<div class="assignment-peek-card empty"><span class="peek-label">${label}</span><strong>배정된 일정이 없습니다.</strong><small>관리자가 일정을 확정하면 표시됩니다.</small></div>`;
    if (!caregiverCanViewClientBrief(assignment)) return `<div class="assignment-peek-card empty"><span class="peek-label">${label}</span>${serviceBadgeMarkup(assignment.serviceType)}<strong>${formatDate(assignment.startAt)} 시작 예정</strong><small>${caregiverClientBriefAccessText(assignment)}</small></div>`;
    const client = clientById(assignment.clientId);
    if (!client) return `<div class="assignment-peek-card empty"><span class="peek-label">${label}</span><strong>고객 정보 확인 필요</strong><small>관리자에게 배정 데이터 연결 상태를 문의해 주세요.</small></div>`;
    const babyName = babyNameFor(assignment, client) || "아이";
    return `<button type="button" class="assignment-peek-card ${serviceMetaFor(assignment.serviceType).tone}" data-caregiver-assignment-detail="${assignment.id}"><span class="peek-top"><span class="peek-label">${label}</span><span class="status-chip ${new Date(assignment.startAt) > new Date() ? "gold" : ""}">${assignmentCountdown(assignment)}</span></span>${serviceBadgeMarkup(assignment.serviceType)}<strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyName)}</strong><small>${formatDate(assignmentStartDateKey(assignment))}–${formatDate(assignmentEndDateKey(assignment))} · 고객 요청 참고시간 ${assignment.dailyStart}–${assignment.dailyEnd}</small><span class="peek-link">고객 정보 확인 →</span></button>`;
  }

  function caregiverSafetyChecklistMarkup(assignment) {
    const saved = state.shiftChecklists[assignment.id] || {};
    const babysitting = assignmentServiceType(assignment) === "BABYSITTING";
    const items = [
      ["arrival", "도착·출입 확인", "주소, 출입 방법과 보호자 인계자를 확인했습니다."],
      ["safety", "알러지·비상연락 확인", "알러지와 비상연락처, 긴급 대응 원칙을 확인했습니다."],
      ["request", "오늘의 요청 확인", babysitting ? "식사·놀이·인계 지침을 확인했습니다." : "산모 회복 요청과 신생아 케어 지침을 확인했습니다."],
      ["scope", "업무 범위 확인", babysitting ? "의료행위 없이 승인된 베이비시팅 범위만 수행합니다." : "의료행위·무면허 마사지 없이 승인된 산후조리 범위만 수행합니다."],
    ];
    const completed = items.filter(([id]) => saved[id]).length;
    const allSaved = completed === items.length;
    return `<article class="card card-pad shift-checklist-card" style="margin-top:18px" data-shift-checklist="${assignment.id}"><div class="section-header"><div><p class="eyebrow">PRE-SHIFT CHECK</p><h3>근무 전 안전 체크</h3><p>네 항목을 모두 확인한 뒤 한 번만 저장합니다. 확인한 항목은 실수로 다시 눌러도 해제되지 않습니다.</p></div><span class="status-chip ${allSaved ? "" : "gold"}" data-shift-check-progress>${completed}/${items.length} 완료</span></div><div class="shift-check-list">${items.map(([id, title, detail]) => `<label class="${saved[id] ? "is-checked" : ""}"><input type="checkbox" data-shift-check="${assignment.id}" data-check-id="${id}" ${saved[id] ? "checked disabled" : ""}/><span>✓</span><div><strong>${title}</strong><small>${detail}</small></div></label>`).join("")}</div><div class="shift-checklist-actions"><small>현재 기기의 현지 날짜(${escapeHtml(formatDate(localDateKey(new Date())))}) 기준으로 저장됩니다.</small><button type="button" class="primary-button" data-save-shift-checks="${assignment.id}" ${allSaved ? "disabled" : "disabled"}>${allSaved ? "오늘 안전 체크 저장 완료" : "4개 항목 확인 후 저장"}</button></div></article>`;
  }

  function quickActionEvents(action, events) {
    return events.filter((event) => event.type === action.type
      && (!action.preset
        || (action.type === "feeding" ? event.data?.method === action.preset : event.data?.category === action.preset)));
  }

  function quickActionMetric(action, events) {
    const matching = quickActionEvents(action, events);
    if (action.type === "feeding" && action.preset === "breast") {
      const minutes = matching.reduce((sum, event) => sum + (Number(event.data?.duration) || 0), 0);
      return minutes ? `${matching.length}회 · ${minutes}분` : `${matching.length}회`;
    }
    if (action.type === "feeding" && ["pumped", "formula"].includes(action.preset)) {
      const milliliters = matching.reduce((sum, event) => sum + (Number(event.data?.amount) || 0), 0);
      return milliliters ? `${matching.length}회 · ${formatDualVolume(milliliters)}` : `${matching.length}회`;
    }
    return `${matching.length}회`;
  }

  function instantRecordDockMarkup(assignment, serviceType, canLog, lockedReason) {
    const actions = serviceType === "BABYSITTING" ? BABYSITTING_QUICK_ACTIONS : POSTPARTUM_QUICK_ACTIONS;
    const events = visibleCareEvents(assignment);
    const dateLabel = TODAY_FORMATTER.format(new Date());
    return `<article class="card instant-record-dock" aria-label="${serviceType === "BABYSITTING" ? "베이비시팅" : "산후조리"} 바로 기록"><div class="instant-record-heading"><div><p class="eyebrow">QUICK RECORD</p><h3>${escapeHtml(dateLabel)} 바로 기록</h3><p>아이콘을 누르면 해당 기록 화면이 바로 열립니다.</p></div><span class="status-chip ${canLog ? "" : "gold"}">${canLog ? `오늘 ${events.length}건` : lockedReason}</span></div><div class="instant-record-scroll" role="group" aria-label="기록 종류">${actions.map((action) => `<button type="button" class="instant-record-action tone-${action.tone}" data-log-type="${action.type}"${action.preset ? ` data-log-preset="${escapeHtml(action.preset)}"` : ""} ${canLog ? "" : "disabled"} aria-label="${escapeHtml(action.label)} 기록 열기"><span class="instant-record-icon" aria-hidden="true">${action.icon}</span><strong>${escapeHtml(action.label)}</strong><small>${quickActionMetric(action, events)}</small></button>`).join("")}</div>${canLog ? "" : `<p class="instant-record-hint">${escapeHtml(lockedReason)} · 근무를 시작하면 아이콘이 활성화됩니다.</p>`}</article>`;
  }

  function caregiverBabysittingToday(user, assignment, nextAssignment, workspaceNav = "") {
    const client = clientById(assignment.clientId);
    if (!client) return `<section class="page">${demoBanner()}${workspaceNav}${pageHeading("BABYSITTING WORKSPACE", "배정 정보를 확인할 수 없습니다.", "관리자가 고객·아이 데이터 연결 상태를 확인해야 합니다.")}<article class="card"><div class="empty-state"><strong>고객 정보가 연결되지 않았습니다.</strong><span>정보가 복구될 때까지 시팅 시작과 기록 저장은 차단됩니다.</span></div></article></section>`;
    const active = state.session.active && state.session.assignmentId === assignment.id;
    const staleSession = active && activeSessionIsStale(assignment);
    const canLog = active && !staleSession;
    const completedToday = assignmentCompletedToday(assignment);
    const sitterEvents = visibleCareEvents(assignment).filter((event) => ["meal", "sitter_note"].includes(event.type));
    const babyName = babyNameFor(assignment, client) || "아이";
    const lockedReason = staleSession ? "이전 근무 종료 필요" : completedToday ? "오늘 시팅 완료" : "시팅 시작 필요";
    return `<section class="page babysitting-workspace">
      ${demoBanner()}${workspaceNav}
      ${pageHeading("BABYSITTING WORKSPACE", `안녕하세요, ${escapeHtml(user.fullName)}님.`, `${escapeHtml(client.motherName)} 보호자의 ${escapeHtml(babyName)} 아이에게 배정된 베이비시팅 화면입니다. 계약 기간에는 요청 시간과 관계없이 기록할 수 있습니다.`)}
      ${instantRecordDockMarkup(assignment, "BABYSITTING", canLog, lockedReason)}
      <article class="card babysitting-hero"><div><div class="hero-care-top"><div>${serviceBadgeMarkup("BABYSITTING")}<p class="eyebrow">TODAY'S SITTING</p><h3>${escapeHtml(babyName)}</h3><p>고객 요청 참고시간 ${assignment.dailyStart}–${assignment.dailyEnd} · ${escapeHtml(assignment.address)}</p></div><div class="live-pill"><span class="live-dot"></span>${staleSession ? "CLOSE PREVIOUS SESSION" : active ? "SITTING IN PROGRESS" : completedToday ? "TODAY COMPLETED" : "SESSION READY"}</div></div><div class="assignment-brief"><span>보호자 ${escapeHtml(client.motherName)}</span><span>알러지 ${escapeHtml(assignment.allergies)}</span><span>추가인원 ${assignment.extraHouseholdMembers}명</span><span>${assignment.weeks}주 일정</span></div><div class="care-actions">${active ? `<button class="primary-button" data-notice="${sitterEvents.length}개의 해당 근무일 시팅 기록이 저장되어 있습니다.">시팅 진행 중 · ${timeLabel(state.session.startedAt)}</button><button class="secondary-button" data-end-care>시팅 종료</button>` : completedToday ? '<button class="secondary-button" disabled>오늘 시팅 완료</button>' : `<button class="primary-button" data-start-care data-assignment-id="${assignment.id}">시팅 시작하기</button>`}<button class="secondary-button" data-caregiver-assignment-detail="${assignment.id}">아이 상세정보</button></div></div></article>
      ${staleSessionBannerMarkup()}
      <div class="assignment-peek-grid" style="margin-top:18px">${caregiverAssignmentPeekMarkup(assignment, "현재 시팅")}${caregiverAssignmentPeekMarkup(nextAssignment, "다음 일정")}</div>
      ${staleSession ? "" : caregiverSafetyChecklistMarkup(assignment)}
      <article class="card card-pad babysitting-instructions-card" style="margin-top:18px"><div class="section-header"><div><h3>식사·안전 지침</h3><p>보호자가 신청 시 전달한 내용</p></div><span class="status-chip coral">확인 필수</span></div><dl class="sitting-instructions"><div><dt>알러지</dt><dd>${escapeHtml(assignment.allergies || "없음")}</dd></div><div><dt>식사·간식</dt><dd>${escapeHtml(assignment.mealInstructions || "별도 지침 없음")}</dd></div><div><dt>생활 루틴</dt><dd>${escapeHtml(assignment.routineNotes || "별도 지침 없음")}</dd></div><div><dt>인계·출입</dt><dd>${escapeHtml(assignment.pickupNotes || "별도 지침 없음")}</dd></div></dl></article>
      <article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>${staleSession ? "미종료 근무일" : "오늘의"} 식사·이벤트</h3><p>${sitterEvents.length}개의 베이비시팅 기록</p></div><button class="text-button" data-service-tab="timeline" data-service-type="BABYSITTING">전체 보기 →</button></div>${timelineMarkup(6, assignment)}</article>
    </section>`;
  }

  function caregiverToday(serviceType = "POSTPARTUM", workspaceNav = "") {
    const user = authUser();
    const openAssignment = state.session.active
      ? state.assignments.find((item) => item.id === state.session.assignmentId && item.caregiverUserId === user.id)
      : null;
    if (openAssignment && assignmentServiceType(openAssignment) !== serviceType) {
      const openType = assignmentServiceType(openAssignment);
      const openClient = clientById(openAssignment.clientId);
      const openBabyName = babyNameFor(openAssignment, openClient) || "아이";
      const stale = activeSessionIsStale(openAssignment);
      return `<section class="page">${demoBanner()}${workspaceNav}${pageHeading("OPEN CARE SESSION", "다른 서비스의 근무가 진행 중입니다.", "한 관리사는 동시에 두 근무를 열 수 없습니다. 현재 세션을 먼저 확인해 주세요.")} ${staleSessionBannerMarkup()}<article class="card card-pad blocking-session-card"><div class="section-header"><div>${serviceBadgeMarkup(openType)}<h3>${escapeHtml(openClient?.motherName || "고객")} · ${escapeHtml(openBabyName)}</h3><p>${stale ? "이전 날짜에 시작한 세션입니다. 새 기록은 잠겼으며 종료만 가능합니다." : `${timeLabel(state.session.startedAt)}에 시작한 근무가 아직 진행 중입니다.`}</p></div><span class="status-chip coral">${stale ? "미종료 근무" : "진행 중"}</span></div><div class="form-actions"><button type="button" class="secondary-button" data-enter-caregiver-service="${openType}">${serviceMetaFor(openType).label} 작업공간으로 이동</button><button type="button" class="primary-button" data-end-care>현재 근무 종료</button></div></article></section>`;
    }
    const assignment = currentAssignmentFor(user.id, serviceType);
    const nextAssignment = nextAssignmentFor(user.id, serviceType);
    if (!assignment) {
      return `<section class="page">${demoBanner()}${workspaceNav}${pageHeading(`${serviceMetaFor(serviceType).label.toUpperCase()} CAREGIVING`, `나의 ${serviceMetaFor(serviceType).label} 케어기빙`, "선택한 서비스 유형의 배정만 표시됩니다.")}<div class="assignment-peek-grid">${caregiverAssignmentPeekMarkup(null, "현재 일정")}${caregiverAssignmentPeekMarkup(nextAssignment, "다음 일정")}</div><article class="card card-pad" style="margin-top:18px"><div class="empty-state"><span class="empty-icon">${serviceMetaFor(serviceType).icon}</span><strong>현재 담당 중인 ${serviceMetaFor(serviceType).label} 서비스가 없습니다.</strong><span>${nextAssignment ? `${assignmentCountdown(nextAssignment)} 일정의 고객 정보를 미리 확인해 주세요.` : "관리자가 승인된 서비스 신청을 배정하면 이곳에 표시됩니다."}</span></div></article></section>`;
    }
    if (assignmentServiceType(assignment) === "BABYSITTING") return caregiverBabysittingToday(user, assignment, nextAssignment, workspaceNav);
    const client = clientById(assignment.clientId);
    if (!client) return `<section class="page">${demoBanner()}${workspaceNav}${pageHeading("CAREGIVER WORKSPACE", "배정 정보를 확인할 수 없습니다.", "관리자가 고객·아이 데이터 연결 상태를 확인해야 합니다.")}<article class="card"><div class="empty-state"><strong>고객 정보가 연결되지 않았습니다.</strong><span>정보가 복구될 때까지 케어 시작과 기록 저장은 차단됩니다.</span></div></article></section>`;
    const active = state.session.active && state.session.assignmentId === assignment.id;
    const staleSession = active && activeSessionIsStale(assignment);
    const canLog = active && !staleSession;
    const completedToday = assignmentCompletedToday(assignment);
    const babyName = babyNameFor(assignment, client) || "아이";
    return `
      <section class="page">
        ${demoBanner()}
        ${workspaceNav}
        ${pageHeading("CAREGIVER WORKSPACE", `안녕하세요, ${escapeHtml(user.fullName)}님.`, `배정된 ${escapeHtml(client.motherName)} 산모와 ${escapeHtml(babyName)} 아기의 정보만 접근할 수 있습니다. 계약 기간에는 요청 시간과 관계없이 기록할 수 있습니다.`)}
        ${instantRecordDockMarkup(assignment, "POSTPARTUM", canLog, staleSession ? "이전 근무 종료 필요" : completedToday ? "오늘 케어 완료" : "케어 시작 필요")}
        <article class="card hero-care">
          <div class="hero-care-top">
            <div><p class="eyebrow">TODAY'S ASSIGNMENT</p><h3>${escapeHtml(babyName)}</h3><p>고객 요청 참고시간 ${assignment.dailyStart} – ${assignment.dailyEnd} · ${escapeHtml(assignment.address)}</p></div>
            <div class="live-pill"><span class="live-dot"></span>${staleSession ? "CLOSE PREVIOUS SESSION" : active ? "CARE IN PROGRESS" : completedToday ? "TODAY COMPLETED" : "SESSION READY"}</div>
          </div>
          <div class="assignment-brief"><span>산모 ${escapeHtml(client.motherName)}</span><span>알러지 ${escapeHtml(assignment.allergies)}</span><span>가정 내 추가인원 ${assignment.extraHouseholdMembers}명</span><span>${assignment.weeks}주 계약</span></div>
          <div class="care-actions">
            ${
              active
                ? `<button class="primary-button" data-notice="현재 고객에게 ${visibleCareEvents(assignment).length}개의 케어 기록이 저장되어 있습니다.">케어 진행 중 · ${timeLabel(state.session.startedAt)}</button><button class="secondary-button" data-end-care>케어 종료</button>`
                : completedToday
                  ? '<button class="secondary-button" disabled>오늘 케어 완료</button>'
                  : `<button class="primary-button" data-start-care data-assignment-id="${assignment.id}">케어 시작하기</button><span style="font-size:11px;color:rgba(255,255,255,.6)">배정 기간 종료 후에는 이 고객의 입력 권한이 자동 종료됩니다.</span>`
            }
            <button class="secondary-button" data-caregiver-assignment-detail="${assignment.id}">고객 상세정보</button>
          </div>
        </article>
        ${staleSessionBannerMarkup()}

        <div class="assignment-peek-grid" style="margin-top:18px">${caregiverAssignmentPeekMarkup(assignment, "현재 일정")}${caregiverAssignmentPeekMarkup(nextAssignment, "다음 일정")}</div>${staleSession ? "" : caregiverSafetyChecklistMarkup(assignment)}

        <article class="card card-pad request-card" style="margin-top:18px"><div class="section-header"><div><h3>고객 요청 및 주의사항</h3><p>관리자가 일정 배정 시 저장한 정보</p></div><span class="status-chip coral">확인 필수</span></div><p>${escapeHtml(assignment.requestNote || "별도 요청사항 없음")}</p></article>

        <article class="card card-pad" style="margin-top:18px">
          <div class="section-header"><div><h3>최근 기록</h3><p>${staleSession ? "미종료 근무일" : "오늘"} ${escapeHtml(babyName)}에게 기록된 케어 이벤트</p></div><button class="text-button" data-service-tab="timeline" data-service-type="POSTPARTUM">전체 보기 →</button></div>
          ${timelineMarkup(4, assignment)}
        </article>
      </section>`;
  }

  function eventDescription(event) {
    const data = event.data || {};
    switch (event.type) {
      case "feeding": {
        const methods = { breast: "직접 모유수유", pumped: "유축 모유", formula: "분유" };
        const amount = Number.isFinite(Number(data.amount)) && data.amount !== "" && data.amount !== null
          ? ` · ${formatDualVolume(Number(data.amount), data.inputUnit)}`
          : data.duration ? ` · ${data.duration}분` : "";
        return `${methods[data.method] || "수유"}${amount}`;
      }
      case "diaper": {
        const urine = { none: "소변 없음", small: "소변 소량", medium: "소변 보통", large: "소변 많음" };
        const stool = { none: "대변 없음", normal: "정상변", loose: "묽은 변", hard: "단단한 변" };
        return `${urine[data.urine] || "기저귀 확인"} · ${stool[data.stool] || "대변 확인"}`;
      }
      case "sleep":
        return `${data.duration || 0}분 수면`;
      case "temperature":
        return formatDualTemperature(Number(data.value), data.inputUnit);
      case "bath":
        return `${data.bathType || "목욕"}${data.waterTemperature ? ` · 물 온도 ${formatDualTemperature(Number(data.waterTemperature), data.inputUnit)}` : ""}${data.note ? ` · ${data.note}` : ""}`;
      case "weight":
        return `${formatDualWeight(Number(data.value), data.inputUnit)} · 성장 기록`;
      case "mother":
        return `${data.care || "산모 케어"}${data.note ? ` · ${data.note}` : ""}`;
      case "note":
        return data.text || "메모가 기록되었습니다.";
      case "meal":
        return `식사 · ${data.menu || "메뉴 기록"} · ${data.appetite || "식사량 확인"}${data.note ? ` · ${data.note}` : ""}`;
      case "sitter_note":
        return `${data.category || "이벤트"} · ${data.text || "활동 내용을 기록했습니다."}`;
      default:
        return "케어 이벤트";
    }
  }

  function sortedEvents(assignment = null) {
    return [...visibleCareEvents(assignment)].sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function timelineMarkup(limit, assignment = null) {
    const events = typeof limit === "number" ? sortedEvents(assignment).slice(0, limit) : sortedEvents(assignment);
    if (!events.length) return `<div class="empty-state"><span class="empty-icon">♡</span><strong>아직 기록이 없어요</strong><span>첫 케어 이벤트를 간단히 남겨보세요.</span></div>`;
    return `<div class="timeline">${events
      .map((event) => {
        const meta = EVENT_META[event.type] || EVENT_META.note;
        const recordedTime = careEventTimeParts(event);
        return `
          <div class="timeline-item">
            <div class="timeline-time">${escapeHtml(recordedTime.time)}<small>${escapeHtml(recordedTime.zone)}</small></div>
            <div class="timeline-icon">${meta.icon}</div>
            <div class="timeline-copy"><strong>${meta.label}</strong><span>${escapeHtml(eventDescription(event))}</span></div>
            <div class="timeline-meta"><span class="timeline-author">${escapeHtml(event.author)}</span>${canEditCareEvent(event) ? `<button type="button" class="timeline-edit-button" data-edit-care-event="${event.id}" aria-label="${escapeHtml(meta.label)} 기록 수정">수정</button>` : ""}</div>
          </div>`;
      })
      .join("")}</div>`;
  }

  function assignmentTimelineMarkup(assignment) {
    const events = [...assignmentCareEvents(assignment)].sort((first, second) => new Date(second.at) - new Date(first.at));
    if (!events.length) return `<div class="empty-state"><span class="empty-icon">☆</span><strong>이 배치에 저장된 시팅 기록이 없어요</strong><span>식사나 놀이·산책 기록을 남기면 날짜별로 이곳에 쌓입니다.</span></div>`;
    const groups = events.reduce((result, event) => {
      const dateKey = objectiveEventDateKey(event) || "undated";
      if (!result.has(dateKey)) result.set(dateKey, []);
      result.get(dateKey).push(event);
      return result;
    }, new Map());
    const meals = events.filter((event) => event.type === "meal").length;
    const activities = events.filter((event) => event.type === "sitter_note").length;
    const safetyChecks = events.filter((event) => event.type === "sitter_note" && event.data?.category === "안전 확인").length;
    const summary = `<div class="batch-event-summary" aria-label="배치 시팅 기록 요약"><div><span>전체 기록</span><strong>${events.length}건</strong></div><div><span>기록한 날짜</span><strong>${groups.size}일</strong></div><div><span>식사·간식</span><strong>${meals}건</strong></div><div><span>놀이·생활</span><strong>${activities}건</strong><small>안전 확인 ${safetyChecks}건</small></div></div>`;
    const groupedTimeline = [...groups.entries()].map(([dateKey, dayEvents], index) => `<section class="batch-timeline-day" aria-labelledby="batch-timeline-day-${index}"><header><div><p class="eyebrow">SITTING DAY ${String(groups.size - index).padStart(2, "0")}</p><h3 id="batch-timeline-day-${index}">${dateKey === "undated" ? "날짜 미등록" : escapeHtml(objectiveDateLabel(dateKey))}</h3></div><span class="status-chip">${dayEvents.length}건</span></header><div class="timeline">${dayEvents.map((event) => { const meta = EVENT_META[event.type] || EVENT_META.note; const recordedTime = careEventTimeParts(event); return `<div class="timeline-item"><div class="timeline-time">${escapeHtml(recordedTime.time)}<small>${escapeHtml(recordedTime.zone)}</small></div><div class="timeline-icon">${meta.icon}</div><div class="timeline-copy"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(eventDescription(event))}</span></div><div class="timeline-meta"><span class="timeline-author">${escapeHtml(event.author || "ProMoms")}</span>${canEditCareEvent(event) ? `<button type="button" class="timeline-edit-button" data-edit-care-event="${event.id}" aria-label="${escapeHtml(meta.label)} 기록 수정">수정</button>` : ""}</div></div>`; }).join("")}</div></section>`).join("");
    return `${summary}<div class="batch-timeline-groups">${groupedTimeline}</div>`;
  }

  function canEditCareEvent(event) {
    const user = authUser();
    if (!user || !event?.id) return false;
    if (state.role === "admin" && canReviewServiceRequests()) return true;
    if (state.role !== "caregiver") return false;
    const assignment = state.assignments.find((item) => item.id === event.assignmentId);
    return Boolean(assignment && assignment.caregiverUserId === user.id);
  }

  function caregiverTimeline(serviceType = "POSTPARTUM", workspaceNav = "") {
    const assignment = currentAssignmentFor(authUser().id, serviceType);
    const client = assignment ? clientById(assignment.clientId) : null;
    const babysitting = serviceType === "BABYSITTING";
    const babyName = assignment && client ? babyNameFor(assignment, client) : "";
    const events = babysitting ? assignmentCareEvents(assignment) : visibleCareEvents(assignment);
    const recordedDays = new Set(events.map(objectiveEventDateKey).filter(Boolean)).size;
    const period = assignment ? objectiveReportAssignmentPeriod(assignment) : "배정 대기";
    return `
      <section class="page">
        ${demoBanner()}
        ${workspaceNav}
        ${pageHeading(babysitting ? "SITTING HISTORY" : "CARE EVENTS", babysitting ? "배치 전체 시팅 기록" : "오늘의 케어 기록", babysitting ? "현재 서비스 배치 기간에 관리사가 남긴 식사와 놀이·산책·생활 기록을 날짜별로 확인합니다." : "수유·기저귀·수면처럼 반복되는 활동을 각각의 시간 기반 이벤트로 기록합니다.")}
        <article class="card card-pad ${babysitting ? "batch-history-card" : ""}">
          <div class="section-header"><div><h3>${escapeHtml(babyName || "배정 대기")}</h3><p>${babysitting ? `${escapeHtml(period)} · 기록 ${events.length}건 · ${recordedDays}일` : `${events.length}개의 접근 가능한 이벤트 · ${todayLabel()}`}</p></div><span class="status-chip">배정 권한 적용</span></div>
          ${babysitting ? assignmentTimelineMarkup(assignment) : timelineMarkup(undefined, assignment)}
        </article>
      </section>`;
  }

  function caregiverUpcomingAssignmentRowMarkup(item, index) {
    if (!caregiverCanViewClientBrief(item)) {
      return `<div class="assignment-row"><div>${serviceBadgeMarkup(item.serviceType)}<strong>${formatDate(item.startAt)} 시작 예정</strong><span>${formatDate(assignmentStartDateKey(item))}–${formatDate(assignmentEndDateKey(item))} · ${item.weeks}주</span></div><div><strong>${item.dailyStart}–${item.dailyEnd}</strong><span>고객 요청 참고시간</span></div><div><strong>고객 정보 공개 대기</strong><span>${caregiverClientBriefAccessText(item)}</span></div><span class="status-chip gold">${assignmentCountdown(item)}</span></div>`;
    }
    const upcomingClient = clientById(item.clientId);
    if (!upcomingClient) return `<div class="assignment-row"><div><strong>고객 정보 연결 확인 필요</strong><span>${formatDate(item.startAt)} 시작 예정</span></div><span class="status-chip coral">관리자 확인</span></div>`;
    const upcomingBabyName = babyNameFor(item, upcomingClient);
    return `<button type="button" class="assignment-row caregiver-upcoming-row assignment-detail-button" data-caregiver-assignment-detail="${item.id}"><span>${serviceBadgeMarkup(item.serviceType)}<strong>${escapeHtml(upcomingClient.motherName)} · ${escapeHtml(upcomingBabyName || "아이")}</strong><span>${formatDate(assignmentStartDateKey(item))}–${formatDate(assignmentEndDateKey(item))} · ${item.weeks}주</span></span><span><strong>${item.dailyStart}–${item.dailyEnd}</strong><span>고객 요청 참고시간</span></span><span><strong>${escapeHtml(item.address)}</strong><span>${index === 0 ? "가장 가까운 다음 일정" : "클릭하여 고객 준비정보 확인"}</span></span><span class="status-chip gold">${assignmentCountdown(item)}</span></button>`;
  }

  function caregiverProfile() {
    const user = authUser();
    const assignment = currentAssignmentFor(user.id);
    const client = assignment ? clientById(assignment.clientId) : null;
    const currentBabyName = assignment && client ? babyNameFor(assignment, client) : "";
    const upcoming = state.assignments.filter((item) => item.caregiverUserId === user.id && item.status !== "CANCELLED" && new Date(item.startAt) > new Date()).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    const shownUpcoming = upcoming.slice(0, 5);
    const caregiverReviews = state.reviews.filter((review) => review.caregiverUserId === user.id && review.source === "CLIENT" && review.validityStatus !== "INVALID" && !review.archived && !state.assignments.find((item) => item.id === review.assignmentId)?.administrativelyRemovedAt);
    const publicProfile = user.publicProfile || (state.publicCaregivers || []).find((item) => item.caregiverUserId === user.id || item.caregiverId === user.caregiverId);
    const reviewAverage = publicProfile?.averageRating != null ? Number(publicProfile.averageRating).toFixed(1) : caregiverReviews.length ? (caregiverReviews.reduce((sum, review) => sum + Number(review.rating), 0) / caregiverReviews.length).toFixed(1) : null;
    const reviewCount = publicProfile?.averageRating != null ? Number(publicProfile.reviewCount || 0) : caregiverReviews.length;
    return `
      <section class="page">
        ${demoBanner()}
        ${pageHeading("CAREGIVER PROFILE", escapeHtml(user.fullName), "관리사에게 필요한 오늘의 정보만 간결하게 제공합니다.")}
        <div class="grid two">
          <article class="card card-pad"><div class="section-header"><div><h3>오늘의 근무</h3><p>방문 서비스 정보</p></div><span class="status-chip">${assignment ? 1 : 0} session</span></div>
            <div class="people-list">
              ${assignment && client ? `<button type="button" class="person-row assignment-detail-button" data-caregiver-assignment-detail="${assignment.id}"><span class="mini-avatar">${escapeHtml((currentBabyName || "B")[0])}</span><span class="person-copy"><strong>${escapeHtml(client.motherName)} · ${escapeHtml(currentBabyName || "아이")}</strong><span>${assignment.dailyStart}–${assignment.dailyEnd} · ${escapeHtml(assignment.address)}</span></span><span class="status-chip">${assignmentCountdown(assignment)}</span></button>` : assignment ? `<div class="empty-state"><strong>고객 정보 연결 확인 필요</strong><span>관리자에게 배정 상태를 문의해 주세요.</span></div>` : `<div class="empty-state"><strong>현재 배정 없음</strong></div>`}
            </div>
          </article>
          <article class="card card-pad"><div class="section-header"><div><h3>서비스 품질</h3><p>기록과 고객 피드백</p></div></div>
            <div class="quality-metrics"><div><span>이번 주 리포트</span><strong>4/4</strong><small>모든 리포트 제출 완료</small></div><div><span>고객 후기</span><strong>${reviewAverage ? `${reviewAverage} / 5.0` : "후기 대기"}</strong><small>${reviewCount}건의 완료 서비스 후기</small></div></div>
          </article>
        </div>
        <article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>예정된 배정</h3><p>고객 준비정보는 확정 배정의 시작 7일 전부터 확인할 수 있습니다.</p></div><span class="status-chip gold">${shownUpcoming.length} / ${upcoming.length} upcoming</span></div><div class="assignment-list">${shownUpcoming.length ? shownUpcoming.map(caregiverUpcomingAssignmentRowMarkup).join("") : `<div class="empty-state"><strong>예정된 배정이 없습니다.</strong></div>`}</div></article>
      </section>`;
  }

  function summaryStats(assignment = null) {
    const visibleEvents = visibleCareEvents(assignment);
    const feeding = visibleEvents.filter((event) => event.type === "feeding");
    const diapers = visibleEvents.filter((event) => event.type === "diaper");
    const sleeps = visibleEvents.filter((event) => event.type === "sleep");
    const temperatures = visibleEvents.filter((event) => event.type === "temperature");
    const latestTemperature = temperatures.length ? [...temperatures].sort((a, b) => new Date(b.at) - new Date(a.at))[0] : null;
    return {
      feedCount: feeding.length,
      feedAmount: feeding.reduce((sum, event) => sum + (Number(event.data.amount) || 0), 0),
      sleepMinutes: sleeps.reduce((sum, event) => sum + (Number(event.data.duration) || 0), 0),
      urineCount: diapers.filter((event) => event.data.urine && event.data.urine !== "none").length,
      stoolCount: diapers.filter((event) => event.data.stool && event.data.stool !== "none").length,
      latestTemp: latestTemperature?.data?.value ?? null,
      latestTempUnit: latestTemperature?.data?.inputUnit || "c",
    };
  }

  function durationLabel(minutes) {
    if (!minutes) return "0분";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours}시간 ${rest}분` : `${rest}분`;
  }

  function summaryCard(icon, label, value, foot) {
    return `<article class="card summary-card"><div class="summary-icon">${escapeHtml(icon)}</div><h4>${escapeHtml(label)}</h4><strong>${escapeHtml(value)}</strong><p>${escapeHtml(foot)}</p></article>`;
  }

  function assignmentHasDeliveredCare(assignment) {
    if (!assignment || assignment.administrativelyRemovedAt) return false;
    const sessionIds = new Set(state.careSessions.filter((session) => session.assignmentId === assignment.id).map((session) => session.id));
    return state.careSessions.some((session) => session.assignmentId === assignment.id && (session.status === "COMPLETED" || session.startedAt))
      || state.events.some((event) => event.assignmentId === assignment.id || sessionIds.has(event.careSessionId))
      || state.reports.some((report) => report.assignmentId === assignment.id || sessionIds.has(report.careSessionId));
  }

  function assignmentHasCompletedCare(assignment) {
    if (!assignment || !assignmentHasDeliveredCare(assignment)) return false;
    const ended = assignment.endAt && new Date(assignment.endAt) < new Date();
    return assignment.status === "COMPLETED" || assignment.status === "CANCELLED" || ended;
  }

  function clientServiceReviewMarkup(client, serviceType = null, assignmentOverride = null) {
    if (!client) return "";
    const assignments = state.assignments.filter((assignment) => {
      const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId);
      return assignment.clientId === client.id
        && !assignment.administrativelyRemovedAt
        && new Date(assignment.startAt) <= new Date()
        && (!serviceType || assignmentServiceType(assignment) === serviceType)
        && (!assignmentOverride || assignment.id === assignmentOverride.id)
        && !isMassageOnlyProfessional(caregiver);
    }).sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    if (!assignments.length) return "";
    const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
    const existingReviews = state.reviews.filter((review) => review.clientId === client.id && assignmentIds.has(review.assignmentId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const reviewable = assignments.find((assignment) => assignmentHasCompletedCare(assignment) && !state.reviews.some((review) => review.assignmentId === assignment.id));
    const assignment = reviewable || assignments[0];
    const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId);
    const existing = state.reviews.find((review) => review.assignmentId === assignment.id) || existingReviews[0];
    if (existing) {
      const reviewedCaregiver = state.users.find((user) => user.id === existing.caregiverUserId);
      const consentControl = existing.publicConsent
        ? `<small>${existing.publicationStatus === "PUBLISHED" ? "관리자 선정 후 홈페이지에 익명 공개 중입니다." : "홈페이지 익명 공개 검토 중입니다."}</small>`
        : `<small>홈페이지 후기 원문은 공개되지 않습니다.</small>`;
      const canAddPhotos = existing.publicConsent && (existing.photoUrls || []).length < 3;
      return `<article class="card service-review-card completed"><div class="review-icon">✓</div><div><p class="eyebrow">SERVICE REVIEW COMPLETED</p><h3>${escapeHtml(reviewedCaregiver?.fullName || "담당 관리사")} 관리사 후기</h3>${reviewOverallRatingMarkup(existing)}${reviewCompetencySummaryMarkup(existing.competencyScores)}<p>${escapeHtml(existing.comment || "소중한 후기가 등록되었습니다.")}</p>${reviewPhotoGalleryMarkup(existing, "내 후기 사진")}<small>${new Date(existing.createdAt).toLocaleDateString("ko-KR")} 작성 · 동일 배정에는 후기를 한 번만 작성할 수 있습니다.</small>${consentControl}${canAddPhotos ? `<button type="button" class="secondary-button compact-button" data-add-review-photos="${existing.id}" data-photo-slots="${3 - (existing.photoUrls || []).length}">후기 사진 추가</button>` : ""}</div></article>`;
    }
    const available = assignmentHasCompletedCare(assignment);
    const waitingForDelivery = !assignmentHasDeliveredCare(assignment);
    return `<article class="card service-review-card ${available ? "ready" : "locked"}"><div class="review-icon">${available ? "♡" : "◷"}</div><div><p class="eyebrow">SERVICE REVIEW</p><h3>${escapeHtml(caregiver?.fullName || "담당 관리사")} 관리사 후기를 남겨주세요.</h3><p>${available ? "실제 제공이 확인된 종료 서비스의 경험을 바탕으로 후기를 한 번 작성할 수 있습니다." : waitingForDelivery ? "실제 케어 기록이 확인되고 서비스가 종료된 뒤 후기 작성이 활성화됩니다." : "서비스 계약·배정 기간이 종료되면 담당 관리사에 대한 후기 작성이 활성화됩니다."}</p></div>${available ? `<button type="button" class="primary-button" data-open-review="${assignment.id}">후기 작성</button>` : `<span class="status-chip gold">서비스 완료 후 가능</span>`}</article>`;
  }

  function clientCompletedReviewCenterMarkup(client) {
    const assignments = state.assignments
      .filter((assignment) => assignment.clientId === client?.id
        && assignmentHasCompletedCare(assignment)
        && !isMassageOnlyProfessional(state.users.find((user) => user.id === assignment.caregiverUserId)))
      .sort((a, b) => new Date(b.endAt) - new Date(a.endAt));
    if (!assignments.length) return "";
    return `<section class="completed-review-center"><div class="section-header"><div><p class="eyebrow">COMPLETED SERVICE REVIEWS</p><h3>완료 서비스 후기</h3><p>서비스가 끝난 뒤에도 배치별 담당 관리사의 후기 작성 여부를 확인할 수 있습니다.</p></div><span class="status-chip">${assignments.length}건</span></div><div class="completed-review-list">${assignments.map((assignment) => clientServiceReviewMarkup(client, null, assignment)).join("")}</div></section>`;
  }

  function clientServiceGateMarkup(client, serviceType, workspaceNav = "") {
    const request = [...state.serviceRequests].filter((item) => item.clientId === client?.id && assignmentServiceType(item) === serviceType).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const pending = request?.status === "PENDING";
    const approvedWaiting = request?.status === "APPROVED" && !request.approvedAssignmentId;
    const meta = serviceMetaFor(serviceType);
    const statusTitle = pending ? `${meta.label} 신청을 확인하고 있습니다.` : approvedWaiting ? `${meta.label} 신청이 승인되었습니다.` : `현재 이용중인 ${meta.label} 서비스가 없습니다.`;
    const statusDescription = pending ? "관리자가 신청 내용과 희망 일정을 검토하고 있습니다." : approvedWaiting ? "관리자가 승인된 신청 목록에서 관리사와 일정을 배치하면 서비스 화면이 활성화됩니다." : "필요한 서비스를 신청하면 승인과 일정 배치 과정을 이곳에서 확인할 수 있습니다.";
    return `<section class="page client-service-gate">${demoBanner()}${workspaceNav}<article class="card service-gate-card ${meta.tone}"><div class="service-gate-art"><span>${pending || approvedWaiting ? "◷" : meta.icon}</span></div><div>${serviceBadgeMarkup(serviceType)}<p class="eyebrow">MY ${serviceType === "BABYSITTING" ? "BABYSITTING" : "POSTPARTUM CARE"}</p><h2>${statusTitle}</h2><p>${statusDescription}</p>${request ? `<div class="gate-request-summary"><span>${request.weeks}주</span><span>${formatDate(request.desiredStartDate)} 시작</span><span>${request.dailyStart}–${request.dailyEnd}</span><span>${pending ? "승인 검토 중" : approvedWaiting ? "일정 배정 대기" : "처리 완료"}</span></div>` : ""}${serviceType === "BABYSITTING" ? `<div class="privacy-boundary-note"><strong>독립적으로 신청 가능한 서비스</strong><span>산후조리 이용 이력이 없어도 신청할 수 있습니다. 단, 동일 아기의 산후조리 이용 기간과 동시에 진행할 수 없습니다.</span></div>` : ""}<div class="service-gate-actions">${pending || approvedWaiting ? "" : `<button class="primary-button" data-service-apply="${serviceType}">${meta.label} 신청</button>`}<button class="secondary-button" data-nav="services">나의 서비스로</button>${usingCloudData() ? "" : '<button class="secondary-button" data-nav="shop">ProMoms 스토어</button>'}</div></div></article></section>`;
  }

  function clientServiceOverviewCard(client, serviceType, assignmentOverride = null, requestOverride = null) {
    const assignment = requestOverride ? null : assignmentOverride || assignmentForClient(client.id, serviceType);
    const requests = [...state.serviceRequests].filter((item) => item.clientId === client.id && assignmentServiceType(item) === serviceType).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const scopedRequests = assignment ? requests.filter((item) => itemMatchesBaby(item, client, assignment.babyId, assignment.babyName)) : requests;
    const request = requestOverride || scopedRequests.find((item) => item.status === "APPROVED" && !item.approvedAssignmentId) || scopedRequests[0];
    const extensionPending = scopedRequests.find((item) => item.requestKind === "EXTENSION" && ["PENDING", "APPROVED"].includes(item.status) && !item.approvedAssignmentId);
    const meta = serviceMetaFor(serviceType);
    // The overview is family-wide; the exact child is chosen in the application form.
    // Blocking here would incorrectly prevent a sibling's independent request.
    const babysittingBlocked = false;
    if (!assignment) {
      const requestStatus = request?.status === "PENDING" ? "관리자 승인 검토 중" : request?.status === "APPROVED" && !request.approvedAssignmentId ? "승인 완료 · 일정 배정 대기" : null;
      const canAdjustRequest = request?.status === "APPROVED" && !request.approvedAssignmentId;
      const adjustment = canAdjustRequest ? pendingAdjustment("REQUEST", request.id) : null;
      const requestBabyName = request ? babyNameFor(request, client) || "아이" : "";
      const summary = requestStatus
        ? (serviceType === "MASSAGE" ? `${request.durationMinutes || 60}분 · ${request.sessionCount || 1}회 · ${formatDate(request.desiredStartDate)} ${request.dailyStart}` : `${request.weeks}주 · ${formatDate(request.desiredStartDate)} 시작 희망 · ${request.dailyStart}–${request.dailyEnd}`)
        : (babysittingBlocked ? "동일 아기가 산후조리를 이용 중인 동안에는 베이비시팅을 신청할 수 없습니다." : serviceType === "BABYSITTING" ? "산후조리 이용 여부와 관계없이 별도의 서비스로 신청할 수 있습니다." : "필요한 경우 별도의 서비스 신청서를 접수할 수 있습니다.");
      const applyButton = serviceType === "MASSAGE" ? `<button class="primary-button" data-massage-book>마사지 예약</button>` : `<button class="primary-button" data-service-apply="${serviceType}" ${babysittingBlocked ? "disabled" : ""}>${babysittingBlocked ? "산후조리 이용 중 신청 불가" : `${meta.label} 신청`}</button>`;
      return `<article class="card service-overview-card empty ${meta.tone}"><div class="service-overview-icon">${meta.icon}</div><div>${serviceBadgeMarkup(serviceType)}<h3>${requestStatus ? `${serviceType === "MASSAGE" ? "마사지" : escapeHtml(requestBabyName)} · ${requestStatus}` : `현재 이용중인 ${meta.label} 서비스가 없습니다.`}</h3><p>${summary}</p>${adjustment ? `<small class="adjustment-state">변경·취소 요청 관리자 검토 중</small>` : ""}${extensionPending ? `<small class="adjustment-state">기간 연장 신청 관리자 검토 중</small>` : ""}</div><div class="service-overview-actions">${requestStatus ? `<span class="status-chip ${request.status === "PENDING" ? "gold" : ""}">${requestStatus}</span>${canAdjustRequest ? `<button class="secondary-button" data-service-adjust="REQUEST:${request.id}" ${adjustment ? "disabled" : ""}>${adjustment ? "요청 검토 중" : "신청 변경·취소"}</button>` : ""}` : applyButton}</div></article>`;
    }
    const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId);
    const status = isAssignmentCurrent(assignment) ? "이용 중" : new Date(assignment.startAt) > new Date() ? "시작 예정" : "이용 완료";
    const adjustment = pendingAdjustment("ASSIGNMENT", assignment.id);
    return `<article class="card service-overview-card ${meta.tone}"><div class="service-overview-top"><div>${serviceBadgeMarkup(serviceType)}<h3>${status}</h3></div><span class="status-chip ${status === "이용 중" ? "" : "gold"}">${assignmentCountdown(assignment)}</span></div><strong class="service-overview-family">${escapeHtml(client.motherName)}${serviceType === "MASSAGE" ? "" : ` · ${escapeHtml(babyNameFor(assignment, client) || "아이")}`}</strong><p>${new Date(assignment.startAt).toLocaleDateString("ko-KR")}–${new Date(assignment.endAt).toLocaleDateString("ko-KR")} · ${assignment.dailyStart}–${assignment.dailyEnd}</p><div class="service-overview-meta"><span>담당 ${escapeHtml(caregiver?.fullName || "배정 대기")}</span><span>${escapeHtml(assignment.address)}</span>${serviceType === "POSTPARTUM" ? `<span>예약금 $${Number(assignment.depositAmount || POSTPARTUM_DEPOSIT).toLocaleString("en-US")} 납부 · 계약 $${Number(assignment.contractValue || requestServiceTotal(assignment)).toLocaleString("en-US")}</span>` : serviceType === "MASSAGE" ? `<span>${assignment.durationMinutes || 60}분 · ${assignment.sessionCount || 1}회 · ${money(assignment.contractValue || massagePrice(assignment))}</span>` : ""}</div>${adjustment ? `<small class="adjustment-state">변경·취소 요청 관리자 검토 중</small>` : ""}${extensionPending ? `<small class="adjustment-state">기간 연장 신청 관리자 검토 중</small>` : ""}<div class="service-overview-actions">${serviceType === "MASSAGE" ? "" : `<button class="primary-button" data-enter-client-service="${serviceType}" data-assignment-id="${assignment.id}">${serviceType === "BABYSITTING" ? "나의 베이비시팅" : "나의 산후조리"} 보기</button>`}<button class="secondary-button" data-service-adjust="ASSIGNMENT:${assignment.id}" ${adjustment ? "disabled" : ""}>${adjustment ? "요청 검토 중" : "일정 변경·취소"}</button>${serviceType === "BABYSITTING" ? `<button class="secondary-button" data-service-extend="${assignment.id}" ${extensionPending ? "disabled" : ""}>${extensionPending ? "연장 검토 중" : "기간 연장 신청"}</button>` : ""}</div></article>`;
  }

  function clientMassageAppointmentsMarkup(client) {
    const bookings = (state.massageBookings || []).filter((booking) => booking.clientId === client.id && booking.status !== "CANCELLED").sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    if (!bookings.length) return "";
    return `<article class="card card-pad client-massage-appointments"><div class="section-header"><div>${serviceBadgeMarkup("MASSAGE")}<h3>선택한 마사지 일정</h3><p>고객이 선택한 슬롯은 관리자 승인 후 확정됩니다. 각 방문은 시작 24시간 전까지만 변경·취소를 요청할 수 있습니다.</p></div><span class="status-chip">${bookings.length}회</span></div><div class="massage-booking-list">${bookings.map((booking) => massageBookingCardMarkup(booking, "client")).join("")}</div></article>`;
  }

  function clientServicesHub() {
    const client = clientForUser(authUser().id);
    if (!client) return `<section class="page">${demoBanner()}<div class="empty-state"><strong>고객 정보를 찾을 수 없습니다.</strong></div></section>`;
    const currentService = clientCurrentService(client.id);
    const activeCount = state.assignments.filter((assignment) => assignment.clientId === client.id && isAssignmentCurrent(assignment)).length;
    const pendingCount = state.serviceRequests.filter((request) => request.clientId === client.id && (request.status === "PENDING" || (request.status === "APPROVED" && !request.approvedAssignmentId && assignmentServiceType(request) !== "MASSAGE"))).length;
    const postpartumAssignments = currentAndUpcomingAssignmentsForClient(client.id, "POSTPARTUM");
    const babysittingAssignments = currentAndUpcomingAssignmentsForClient(client.id, "BABYSITTING");
    const massageAssignments = currentAndUpcomingAssignmentsForClient(client.id, "MASSAGE");
    const openRequests = state.serviceRequests.filter((request) => request.clientId === client.id && ["PENDING", "APPROVED"].includes(request.status) && !request.approvedAssignmentId);
    const postpartumRequests = openRequests.filter((request) => assignmentServiceType(request) === "POSTPARTUM");
    const babysittingRequests = openRequests.filter((request) => assignmentServiceType(request) === "BABYSITTING");
    const massageRequests = openRequests.filter((request) => assignmentServiceType(request) === "MASSAGE" && request.status === "PENDING");
    const postpartumCards = [...postpartumAssignments.map((assignment) => clientServiceOverviewCard(client, "POSTPARTUM", assignment)), ...postpartumRequests.map((request) => clientServiceOverviewCard(client, "POSTPARTUM", null, request))];
    const babysittingCards = [...babysittingAssignments.map((assignment) => clientServiceOverviewCard(client, "BABYSITTING", assignment)), ...babysittingRequests.map((request) => clientServiceOverviewCard(client, "BABYSITTING", null, request))];
    const massage = state.serviceCatalog.MASSAGE;
    const massageTier = clientQualifiesForMassageMemberRate(client.id) ? "POSTPARTUM_CLIENT" : "GENERAL";
    const massageStatusCards = [...massageAssignments.map((assignment) => clientServiceOverviewCard(client, "MASSAGE", assignment)), ...massageRequests.map((request) => clientServiceOverviewCard(client, "MASSAGE", null, request))];
    const profileSetup = clientProfileComplete(client) ? "" : `<article class="card client-profile-onboarding"><div><p class="eyebrow">PROFILE SETUP</p><h3>서비스 신청 전에 가족 프로필을 완성해 주세요.</h3><p>아기 이름·출생일 또는 예정일과 기본 서비스 주소를 한 번 저장하면 신청서에 자동으로 불러옵니다.</p></div><button class="primary-button" type="button" data-edit-profile>고객·아기 프로필 작성</button></article>`;
    return `<section class="page service-hub-page">${demoBanner()}${pageHeading("MY SERVICES", `${escapeHtml(client.motherName)}님의 서비스`, "돌봄과 마사지 신청·배정 상태를 한눈에 확인하세요.")}${profileSetup}<div class="grid stats">${statCard("Active service", activeCount, "현재 진행 중인 전체 배정", "✓")}${statCard("Current service", activeCount > 1 ? `${activeCount}건 이용 중` : currentService ? serviceMetaFor(currentService).label : "대기", "현재 케어", currentService === "BABYSITTING" ? "☆" : "♡")}${statCard("Pending requests", pendingCount ? `${pendingCount}건` : "없음", "승인·일정 배정 대기", "◷")}</div><div class="service-overview-grid" style="margin-top:18px">${postpartumCards.length ? postpartumCards.join("") : clientServiceOverviewCard(client, "POSTPARTUM")}${babysittingCards.length ? babysittingCards.join("") : clientServiceOverviewCard(client, "BABYSITTING")}</div>${massageStatusCards.length ? `<div class="service-overview-grid" style="margin-top:18px">${massageStatusCards.join("")}</div>` : ""}${clientMassageAppointmentsMarkup(client)}${clientCompletedReviewCenterMarkup(client)}<div style="margin-top:18px">${clientPublishedReportsMarkup(client.id, null, true)}</div><article class="card premium-addon-card" style="margin-top:18px"><div class="premium-addon-icon">${massage.icon}</div><div><p class="eyebrow">PRENATAL · POSTPARTUM MASSAGE</p><h3>${massage.label}</h3><p>${massage.description}</p><div class="premium-addon-tags"><span>${massageTier === "POSTPARTUM_CLIENT" ? "산후조리 고객 우대가 자동 적용" : "일반 고객 요금"}</span><span>60분·90분</span><span>24시간 전까지 변경·취소</span></div></div><div class="public-service-card-actions"><button type="button" class="secondary-button" data-public-service-detail="MASSAGE">자세히</button><button type="button" class="primary-button" data-massage-book>마사지 예약</button></div></article><article class="card card-pad service-boundary-note" style="margin-top:18px"><strong>돌봄과 마사지는 일정 충돌을 자동으로 확인합니다.</strong><p>마사지 테라피스트가 해당 고객의 담당 관리사인 경우에만 그 고객의 케어 시간 안에 마사지를 배정할 수 있습니다. 다른 고객 일정이나 다른 마사지 예약과 겹치면 선택할 수 없습니다.</p></article></section>`;
  }

  function clientBabysittingSummary(client, assignment, workspaceNav = "") {
    const babyName = babyNameFor(assignment, client) || "아이";
    const caregiver = state.users.find((item) => item.id === assignment.caregiverUserId);
    const events = visibleCareEvents(assignment).filter((event) => ["meal", "sitter_note"].includes(event.type));
    const meals = events.filter((event) => event.type === "meal");
    const notes = events.filter((event) => event.type === "sitter_note");
    return `<section class="page babysitting-client-page">${demoBanner()}${workspaceNav}<article class="card client-hero babysitting-client-hero"><div class="client-hero-copy">${serviceBadgeMarkup("BABYSITTING")}<p class="eyebrow">${escapeHtml(babyName).toUpperCase()}'S SITTING · ${todayLabel()}</p><h3>${escapeHtml(babyName)}의 오늘 시팅 기록이 업데이트되었습니다. ☆</h3><p>담당 관리사가 공유한 식사와 놀이·산책·생활 이벤트를 간결하게 확인하세요.</p></div><div class="client-hero-art"><div class="baby-monogram">${escapeHtml(babyName[0] || "B")}</div></div></article><div class="grid three sitter-summary-grid" style="margin-top:18px">${summaryCard("🍽️", "식사·간식", `${meals.length}회`, meals.at(-1) ? eventDescription(meals.at(-1)) : "기록 전")}${summaryCard("☆", "생활 이벤트", `${notes.length}건`, notes.at(-1) ? eventDescription(notes.at(-1)) : "기록 전")}${summaryCard("♙", "담당 관리사", caregiver?.fullName || "배정 완료", `${assignment.dailyStart}–${assignment.dailyEnd}`)}</div>${clientServiceReviewMarkup(client, "BABYSITTING", assignment)}<article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>오늘의 시팅 기록</h3><p>식사와 주요 활동이 시간순으로 표시됩니다.</p></div><button class="text-button" data-service-tab="timeline" data-service-type="BABYSITTING">전체 보기 →</button></div>${timelineMarkup(undefined, assignment)}</article><div style="margin-top:18px">${clientPublishedReportsMarkup(client.id, "BABYSITTING")}</div></section>`;
  }

  function clientSummary(serviceType = "POSTPARTUM", workspaceNav = "") {
    const client = clientForUser(authUser().id);
    if (!client || !clientHasApprovedService(client.id, serviceType)) return clientServiceGateMarkup(client, serviceType, workspaceNav);
    const assignment = selectedClientAssignment(client.id, serviceType);
    if (serviceType === "BABYSITTING") return clientBabysittingSummary(client, assignment, workspaceNav);
    const babyName = babyNameFor(assignment, client) || "아기";
    const stats = summaryStats(assignment);
    return `
      <section class="page">
        ${demoBanner()}
        ${workspaceNav}
        <article class="card client-hero">
          <div class="client-hero-copy">
            <p class="eyebrow">${escapeHtml(babyName).toUpperCase()}'S DAY · ${todayLabel()}</p>
            <h3>${escapeHtml(babyName)}의 오늘 케어 기록이 업데이트되었습니다. ♡</h3>
            <p>관리사가 기록한 케어 활동을 이해하기 쉬운 요약으로 보여드립니다. 모든 수치는 오늘의 기록을 기준으로 자동 계산됩니다.</p>
          </div>
          <div class="client-hero-art"><div class="baby-monogram">${escapeHtml(babyName[0] || "B")}</div></div>
        </article>

        <div class="grid stats" style="margin-top:18px">
          ${summaryCard("🍼", "수유", `${stats.feedCount}회`, `총 ${formatDualVolume(stats.feedAmount)}`)}
          ${summaryCard("☾", "수면", durationLabel(stats.sleepMinutes), "기록된 수면 시간")}
          ${summaryCard("🚼", "기저귀", `${stats.urineCount}회`, `대변 ${stats.stoolCount}회`)}
          ${summaryCard("🌡️", "체온", stats.latestTemp === null ? "기록 전" : formatDualTemperature(Number(stats.latestTemp), stats.latestTempUnit), "최근 측정 기록")}
        </div>

        ${clientServiceReviewMarkup(client, "POSTPARTUM", assignment)}

        <div class="grid two" style="margin-top:18px">
          <article class="card card-pad"><div class="section-header"><div><h3>오늘의 케어</h3><p>최근 활동 타임라인</p></div><button class="text-button" data-service-tab="timeline" data-service-type="POSTPARTUM">전체 보기 →</button></div>${timelineMarkup(5, assignment)}</article>
          <article class="card report-note"><p>${escapeHtml(babyName)}의 오늘 수유와 휴식 기록을 요약한 내용입니다. 체온과 활동 기록은 배정된 관리사가 입력한 데이터만 표시됩니다.</p><span>— ProMoms approved care record</span></article>
        </div>
      </section>`;
  }

  function clientTimeline(serviceType = "POSTPARTUM", workspaceNav = "") {
    const client = clientForUser(authUser().id);
    if (!client || !clientHasApprovedService(client.id, serviceType)) return clientServiceGateMarkup(client, serviceType, workspaceNav);
    const assignment = selectedClientAssignment(client.id, serviceType);
    const babysitting = serviceType === "BABYSITTING";
    const babyName = babyNameFor(assignment, client) || "아기";
    const events = babysitting ? assignmentCareEvents(assignment) : visibleCareEvents(assignment);
    const recordedDays = new Set(events.map(objectiveEventDateKey).filter(Boolean)).size;
    const period = assignment ? objectiveReportAssignmentPeriod(assignment) : "배정 대기";
    return `
      <section class="page">
        ${demoBanner()}
        ${workspaceNav}
        ${pageHeading(`${escapeHtml(babyName).toUpperCase()}'S ${babysitting ? "SITTING HISTORY" : "CARE TIMELINE"}`, babysitting ? "배치 전체 시팅 기록" : "오늘의 소중한 기록", babysitting ? `${escapeHtml(babyName)}의 서비스 배치 기간 동안 기록된 식사와 생활 이벤트를 날짜별로 확인합니다.` : `시간순으로 정리된 ${escapeHtml(babyName)}의 수유, 수면, 기저귀와 케어 활동입니다.`)}
        <article class="card card-pad ${babysitting ? "batch-history-card" : ""}"><div class="section-header"><div><h3>${babysitting ? escapeHtml(period) : todayLabel()}</h3><p>${babysitting ? `배정 관리사가 남긴 ${events.length}개 기록 · ${recordedDays}일` : `배정 관리사가 남긴 ${events.length}개의 기록`}</p></div><span class="status-chip">본인 정보만 표시</span></div>${babysitting ? assignmentTimelineMarkup(assignment) : timelineMarkup(undefined, assignment)}</article>
      </section>`;
  }

  function clientMessages() {
    return `
      <section class="page">
        ${demoBanner()}
        ${pageHeading("CARE MESSAGES", "관리사와 안심하고 소통하세요", "민감한 케어 정보가 포함될 수 있어 실제 메시지는 인증·권한 기능과 함께 연결됩니다.")}
        <div class="grid two">
          <article class="card card-pad"><div class="section-header"><div><h3>Mina Kim</h3><p>Emma's caregiver · 현재 케어 중</p></div><span class="status-chip">Online</span></div>
            <div class="report-note"><p>Emma는 방금 수유를 잘 마쳤고 편안하게 쉬고 있습니다. 오늘의 케어 리포트도 종료 후 확인하실 수 있어요.</p><span>${timeLabel(atTime(13, 45))}</span></div>
            <button class="secondary-button" style="width:100%;margin-top:14px" disabled>메시징 기능 준비 중</button>
          </article>
          <article class="card card-pad"><div class="section-header"><div><h3>연락 원칙</h3><p>응급 상황에는 앱이 아닌 지정 연락처 사용</p></div></div>
            <div class="attention-list">${attentionItem("♡", "일상 케어 문의", "앱 메시지로 편하게 남겨주세요.")}${attentionItem("!", "긴급한 건강 우려", "의료진 또는 긴급 연락처로 연락하세요.")}</div>
          </article>
        </div>
      </section>`;
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
  }

  function productById(productId) {
    return state.retail.products.find((product) => product.id === productId);
  }

  function stockFor(productId) {
    return state.retail.inventoryMovements
      .filter((movement) => movement.productId === productId)
      .reduce((total, movement) => total + Number(movement.quantity), 0);
  }

  function categoryLabel(category) {
    return category === "BEAUTY" ? "맘스 뷰티" : "Baby Care";
  }

  function retailTotals() {
    const completed = state.retail.orders.filter((order) => order.status !== "취소");
    const revenue = completed.reduce((sum, order) => sum + Number(order.total), 0);
    const cogs = completed.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + (productById(item.productId)?.cost || 0) * item.quantity, 0),
      0,
    );
    return {
      revenue,
      cogs,
      margin: revenue ? Math.round(((revenue - cogs) / revenue) * 100) : 0,
      items: completed.reduce((sum, order) => sum + order.items.reduce((count, item) => count + item.quantity, 0), 0),
      lowStock: state.retail.products.filter((product) => stockFor(product.id) <= 5).length,
    };
  }

  function categoryFilters(activeCategory, scope) {
    return `<div class="category-tabs" role="group" aria-label="상품 카테고리">
      ${[["ALL", "전체"], ["BEAUTY", "맘스 뷰티"], ["BABY", "유아용품"]]
        .map(([value, label]) => `<button class="category-tab ${activeCategory === value ? "active" : ""}" data-retail-category="${value}" data-category-scope="${scope}">${label}</button>`)
        .join("")}
    </div>`;
  }

  function productGrid(category, context) {
    const products = state.retail.products.filter((product) => category === "ALL" || product.category === category);
    return `<div class="product-grid">${products
      .map((product) => {
        const stock = stockFor(product.id);
        return `<article class="product-card">
          <div class="product-art ${product.category.toLowerCase()}"><span>${product.emoji}</span>${product.badge ? `<em>${product.badge}</em>` : ""}</div>
          <div class="product-body">
            <div class="product-meta"><span>${categoryLabel(product.category)}</span><span class="stock-text ${stock <= 5 ? "low" : ""}">${stock} in stock</span></div>
            <h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(product.description)}</p>
            <div class="product-foot"><strong>${money(product.price)}</strong><button class="add-button" data-add-product="${product.id}" data-add-context="${context}" ${stock <= 0 ? "disabled" : ""}>${stock <= 0 ? "품절" : "+ 담기"}</button></div>
          </div>
        </article>`;
      })
      .join("")}</div>`;
  }

  function cartTotal() {
    return activeCart().reduce((sum, item) => sum + (productById(item.productId)?.price || 0) * item.quantity, 0);
  }

  function cartKey() {
    return state.role === "client" ? authUser()?.id : "retail-pos";
  }

  function activeCart() {
    if (!state.retail.carts) state.retail.carts = {};
    if (!state.retail.carts[cartKey()]) state.retail.carts[cartKey()] = [];
    return state.retail.carts[cartKey()];
  }

  function cartMarkup(context) {
    const cartItems = activeCart();
    return `<aside class="card cart-panel">
      <div class="section-header"><div><h3>${context === "client" ? "내 장바구니" : "현재 판매"}</h3><p>${cartItems.reduce((sum, item) => sum + item.quantity, 0)}개 상품</p></div><span class="status-chip">${context === "client" ? "K-Store" : "POS"}</span></div>
      ${
        cartItems.length
          ? `<div class="cart-items">${cartItems
              .map((item) => {
                const product = productById(item.productId);
                return `<div class="cart-row"><div class="cart-emoji">${product.emoji}</div><div class="cart-copy"><strong>${escapeHtml(product.name)}</strong><span>${money(product.price)} each</span></div><div class="quantity-control"><button data-cart-change="${item.productId}" data-delta="-1" aria-label="수량 줄이기">−</button><span>${item.quantity}</span><button data-cart-change="${item.productId}" data-delta="1" aria-label="수량 늘리기">+</button></div></div>`;
              })
              .join("")}</div>
            ${context === "pos" ? `<div class="field cart-customer"><label for="cart-customer">고객 연결</label><select id="cart-customer" data-cart-customer><option ${state.retail.cartCustomer === "Sarah Kim" ? "selected" : ""}>Sarah Kim</option><option ${state.retail.cartCustomer === "Sophia Park" ? "selected" : ""}>Sophia Park</option><option ${state.retail.cartCustomer === "Walk-in" ? "selected" : ""}>Walk-in</option></select><small>고객을 연결하면 CRM 구매 이력에 저장됩니다.</small></div>` : ""}
            <div class="cart-summary"><span>Subtotal</span><strong>${money(cartTotal())}</strong></div>
            <button class="primary-button checkout-button" data-checkout="${context}">${context === "client" ? "로컬 주문 접수" : "로컬 판매 완료"}</button>
            <p class="payment-note">이 브라우저의 로컬 데이터에만 기록되며 실제 결제는 발생하지 않습니다.</p>`
          : `<div class="empty-state"><span class="empty-icon">◇</span><strong>장바구니가 비어 있어요</strong><span>상품의 ‘담기’ 버튼을 눌러 시작하세요.</span></div>`
      }
    </aside>`;
  }

  function orderRows(limit) {
    const orders = [...state.retail.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const shown = typeof limit === "number" ? orders.slice(0, limit) : orders;
    return `<div class="order-list">${shown
      .map(
        (order) => `<div class="order-row"><div><strong>${order.id}</strong><span>${timeLabel(order.createdAt)} · ${order.channel.replaceAll("_", " ")}</span></div><div><strong>${escapeHtml(order.customer)}</strong><span>${order.items.reduce((sum, item) => sum + item.quantity, 0)} items</span></div><strong class="order-total">${money(order.total)}</strong><div class="order-status-cell"><span class="status-chip ${order.status !== "배송 완료" ? "gold" : ""}">${order.status}</span>${state.role === "retail" && order.status !== "배송 완료" ? `<button class="text-button" data-advance-order="${order.id}">${nextOrderStatus(order.status)} 처리 →</button>` : ""}</div></div>`,
      )
      .join("")}</div>`;
  }

  function nextOrderStatus(status) {
    return ({ "주문 접수": "배송 준비", "배송 준비": "배송 중", "배송 중": "배송 완료" })[status] || "배송 완료";
  }

  function adminRetail() {
    const totals = retailTotals();
    return `<section class="page">
      ${demoBanner()}
      ${pageHeading("RETAIL OPERATIONS", "맘스 뷰티 & Baby Retail", "상품 판매를 고객 CRM과 연결하고 재고는 입출고 이동의 합으로 관리합니다.")}
      <div class="grid stats">
        ${statCard("Retail Revenue", money(totals.revenue), `${totals.items} items sold`, "◇")}
        ${statCard("Gross Margin", `${totals.margin}%`, `COGS ${money(totals.cogs)}`, "↗")}
        ${statCard("Orders", state.retail.orders.length, "All connected channels", "▤")}
        ${statCard("Low Stock", totals.lowStock, "Safety stock ≤ 5", "!")}
      </div>
      <div class="grid two" style="margin-top:18px">
        <article class="card card-pad"><div class="section-header"><div><h3>최근 주문</h3><p>Care CRM, 고객 앱, 오프라인 POS 통합</p></div><span class="status-chip">Read only</span></div>${orderRows(4)}</article>
        <article class="card card-pad"><div class="section-header"><div><h3>Care → Retail</h3><p>고객 생애주기 기반의 관련 제안</p></div><span class="status-chip coral">CRM</span></div>
          <div class="attention-list">${attentionItem("♡", "Emma 100일 준비", "Baby Care Essentials Kit · 일반적 행사 알림")}${attentionItem("◇", "산후 케어 종료 고객", "감사 혜택과 맘스 뷰티 방문 제안")}${attentionItem("↗", "케어 고객 구매 전환", "이번 달 31% · 목표 35%")}</div>
        </article>
      </div>
    </section>`;
  }

  function adminAnalytics() {
    const totals = retailTotals();
    const serviceRevenue = 2640;
    const combinedRevenue = serviceRevenue + totals.revenue;
    const serviceShare = combinedRevenue ? Math.round((serviceRevenue / combinedRevenue) * 100) : 0;
    return `<section class="page">
      ${demoBanner()}
      ${pageHeading("UNIFIED ANALYTICS", "Care, Customer & Retail", "서비스 운영과 고객 관계, 상품 판매를 하나의 경영 관점으로 연결합니다.")}
      <div class="analytics-hero card">
        <div><p class="eyebrow">TODAY'S BUSINESS PULSE</p><h3>${money(combinedRevenue)}</h3><p>Today's Service + Retail Revenue</p></div>
        <div class="pulse-split"><div><span>CARE</span><strong>${money(serviceRevenue)}</strong><small>${serviceShare}% of revenue</small></div><div><span>RETAIL</span><strong>${money(totals.revenue)}</strong><small>${totals.margin}% gross margin</small></div></div>
      </div>
      <div class="grid three" style="margin-top:18px">
        <article class="card card-pad metric-story"><span class="metric-kicker">SERVICE</span><strong>84%</strong><h3>Caregiver utilization</h3><p>배정 가능한 근무 시간 대비 실제 케어 시간</p></article>
        <article class="card card-pad metric-story"><span class="metric-kicker coral">CUSTOMER</span><strong>78%</strong><h3>90-day retention</h3><p>케어 종료 후에도 ProMoms 관계를 유지한 고객</p></article>
        <article class="card card-pad metric-story"><span class="metric-kicker gold">RETAIL</span><strong>31%</strong><h3>Care-to-retail conversion</h3><p>케어 고객 중 관련 상품을 구매한 고객 비율</p></article>
      </div>
      <article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>AI Assistant 준비 영역</h3><p>의료 판단이 아닌 요약과 운영 지원에 집중</p></div><span class="status-chip">Phase 6</span></div><div class="insight-grid"><div><span>CARE SUMMARY</span><strong>이벤트 → 승인 가능한 일일 리포트 초안</strong></div><div><span>OPERATIONS</span><strong>미배정 일정과 주의 기록의 우선순위 요약</strong></div><div><span>CRM</span><strong>고객 생애주기 기반 후속 연락 제안</strong></div></div></article>
    </section>`;
  }

  function retailPos() {
    return `<section class="page retail-page">
      ${demoBanner()}
      ${pageHeading("CONNECTED POS", "판매와 고객 관계를 함께", "상품 판매를 고객 프로필에 연결해 Care → Beauty 여정을 완성합니다.")}
      <div class="retail-layout"><div><div class="retail-toolbar">${categoryFilters(state.retail.posCategory, "pos")}<span class="status-chip">${state.retail.products.length} products</span></div>${productGrid(state.retail.posCategory, "pos")}</div>${cartMarkup("pos")}</div>
    </section>`;
  }

  function retailProducts() {
    return `<section class="page">
      ${demoBanner()}
      ${pageHeading("PRODUCT CATALOG", "Beauty & Baby Products", "SKU, 원가, 판매가와 고객 친화적 설명을 한 곳에서 관리합니다.")}
      <article class="card table-card"><div class="section-header table-head"><div><h3>상품 마스터</h3><p>${state.retail.products.length}개의 활성 상품</p></div><button class="primary-button" data-demo-action="상품 등록 폼은 Supabase CRUD 연결 단계에서 활성화됩니다.">+ 새 상품</button></div>
        <div class="product-table">${state.retail.products.map((product) => `<div class="product-table-row"><div class="product-table-name"><span>${product.emoji}</span><div><strong>${escapeHtml(product.name)}</strong><small>${product.sku}</small></div></div><span>${categoryLabel(product.category)}</span><span>${money(product.cost)} cost</span><strong>${money(product.price)}</strong><span class="status-chip ${stockFor(product.id) <= 5 ? "coral" : ""}">${stockFor(product.id)} stock</span></div>`).join("")}</div>
      </article>
    </section>`;
  }

  function retailInventory() {
    return `<section class="page">
      ${demoBanner()}
      ${pageHeading("INVENTORY MOVEMENTS", "재고는 이력으로 관리합니다", "입고·판매·반품·폐기 등 모든 이동을 합산해 현재 재고를 계산합니다.")}
      <div class="grid stats">${statCard("On Hand", state.retail.products.reduce((sum, product) => sum + stockFor(product.id), 0), "Across all products", "≋")}${statCard("Low Stock", retailTotals().lowStock, "Reorder recommended", "!")}${statCard("Movements", state.retail.inventoryMovements.length, "Immutable ledger entries", "↕")}${statCard("Locations", 1, "Kennesaw Store", "⌂")}</div>
      <article class="card table-card" style="margin-top:18px"><div class="section-header table-head"><div><h3>현재 재고</h3><p>상품별 이동 합계</p></div><span class="status-chip">Kennesaw</span></div><div class="product-table">${state.retail.products.map((product) => `<div class="product-table-row inventory-row"><div class="product-table-name"><span>${product.emoji}</span><div><strong>${escapeHtml(product.name)}</strong><small>${product.sku}</small></div></div><span>${categoryLabel(product.category)}</span><strong class="${stockFor(product.id) <= 5 ? "danger-text" : ""}">${stockFor(product.id)} units</strong><span>${stockFor(product.id) <= 5 ? "재주문 필요" : "정상"}</span><button class="secondary-button mini-button" data-restock="${product.id}">+5 로컬 입고</button></div>`).join("")}</div></article>
    </section>`;
  }

  function retailOrders() {
    return `<section class="page">
      ${demoBanner()}
      ${pageHeading("OMNICHANNEL ORDERS", "모든 주문을 한 곳에서", "고객 앱, 케어 CRM, 오프라인 POS 주문을 동일한 고객 이력으로 연결합니다.")}
      <article class="card card-pad"><div class="section-header"><div><h3>주문 내역</h3><p>${state.retail.orders.length} orders · ${money(retailTotals().revenue)} revenue</p></div><span class="status-chip">로컬 데이터</span></div>${orderRows()}</article>
    </section>`;
  }

  function clientShop() {
    return `<section class="page retail-page">
      ${demoBanner()}
      ${pageHeading("ProMoms STORE", "Everyday care, thoughtfully selected.", "맘스 뷰티와 유아용품을 한 곳에서 둘러보세요. 건강 상태 기반 추천이나 의료적 주장은 사용하지 않습니다.")}
      <div class="retail-layout"><div><div class="retail-toolbar">${categoryFilters(state.retail.selectedCategory, "shop")}<span class="status-chip coral">Member Benefits</span></div>${productGrid(state.retail.selectedCategory, "client")}</div>${cartMarkup("client")}</div>
    </section>`;
  }

  function clientPurchases() {
    const client = clientForUser(authUser().id);
    const customerOrders = state.retail.orders.filter((order) => order.clientId === client?.id);
    return `<section class="page">
      ${demoBanner()}
      ${pageHeading("PURCHASE HISTORY", `${escapeHtml(client?.motherName || "고객")}님의 구매 내역`, "케어 서비스와 상품 구매 이력이 하나의 고객 관계 안에서 관리됩니다.")}
      <article class="card card-pad"><div class="section-header"><div><h3>최근 주문</h3><p>${customerOrders.length} orders linked to your profile</p></div><span class="status-chip">CRM Connected</span></div><div class="order-list">${customerOrders.length ? customerOrders.map((order) => `<div class="purchase-card"><div class="purchase-top"><div><strong>${order.id}</strong><span>${todayLabel()} · ${order.status}</span></div><strong>${money(order.total)}</strong></div><div class="purchase-items">${order.items.map((item) => { const product = productById(item.productId); return `<span>${product.emoji} ${escapeHtml(product.name)} × ${item.quantity}</span>`; }).join("")}</div></div>`).join("") : `<div class="empty-state"><span class="empty-icon">◇</span><strong>아직 구매 내역이 없어요</strong><span>K-Store에서 필요한 상품을 둘러보세요.</span></div>`}</div></article>
    </section>`;
  }

  function clientEvents(clientId, assignmentId = null) {
    return state.events.filter((event) => event.clientId === clientId && (!assignmentId || event.assignmentId === assignmentId)).sort((a, b) => new Date(a.at) - new Date(b.at));
  }

  function careChartBuckets(events, days) {
    const today = startOfLocalDay();
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (days - 1 - index));
      const key = localDateKey(date);
      return {
        date,
        key,
        events: events.filter((event) => localDateKey(event.at) === key),
        shortLabel: days === 7 ? date.toLocaleDateString("ko-KR", { weekday: "short" }) : `${date.getMonth() + 1}/${date.getDate()}`,
        fullLabel: date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }),
      };
    });
  }

  function chartLineSvg(buckets, values, options) {
    const valid = values.map((value, index) => ({ value, index })).filter((item) => Number.isFinite(item.value));
    if (!valid.length) return `<div class="chart-empty">${options.empty}</div>`;
    const width = Math.max(720, buckets.length * 42);
    const height = 205;
    const chartLeft = 48;
    const chartRight = width - 24;
    const chartTop = 20;
    const chartBottom = 160;
    const observedMin = Math.min(...valid.map((item) => item.value));
    const observedMax = Math.max(...valid.map((item) => item.value));
    const min = options.min ?? Math.floor((observedMin - 0.2) * 10) / 10;
    const max = options.max ?? Math.ceil((observedMax + 0.2) * 10) / 10;
    const span = Math.max(0.1, max - min);
    const pointFor = (item) => {
      const x = buckets.length === 1 ? (chartLeft + chartRight) / 2 : chartLeft + (item.index * (chartRight - chartLeft)) / (buckets.length - 1);
      const y = chartBottom - ((item.value - min) / span) * (chartBottom - chartTop);
      return { ...item, x, y: Math.max(chartTop, Math.min(chartBottom, y)) };
    };
    const points = valid.map(pointFor);
    const labelStep = buckets.length > 7 ? 5 : 1;
    const gridValues = [min, min + span / 2, max];
    return `<div class="trend-chart-scroll"><svg class="trend-line-chart" viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="${escapeHtml(options.ariaLabel)}">${gridValues.map((value) => { const y = chartBottom - ((value - min) / span) * (chartBottom - chartTop); return `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}"/><text x="4" y="${y + 3}">${value.toFixed(options.decimals ?? 1)}${options.unit}</text>`; }).join("")}${options.warning !== undefined ? `<line class="warning-line" x1="${chartLeft}" y1="${chartBottom - ((options.warning - min) / span) * (chartBottom - chartTop)}" x2="${chartRight}" y2="${chartBottom - ((options.warning - min) / span) * (chartBottom - chartTop)}"/>` : ""}<polyline points="${points.map((point) => `${point.x},${point.y}`).join(" ")}"/>${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4"><title>${buckets[point.index].fullLabel} ${point.value.toFixed(options.decimals ?? 1)}${options.unit}</title></circle>`).join("")}${buckets.map((bucket, index) => index % labelStep === 0 || index === buckets.length - 1 ? `<text class="axis-label" x="${buckets.length === 1 ? (chartLeft + chartRight) / 2 : chartLeft + (index * (chartRight - chartLeft)) / (buckets.length - 1)}" y="190" text-anchor="middle">${bucket.shortLabel}</text>` : "").join("")}</svg></div>`;
  }

  function feedingTrendMarkup(buckets) {
    const daily = buckets.map((bucket) => {
      const feeding = bucket.events.filter((event) => event.type === "feeding");
      const breast = feeding.filter((event) => event.data.method !== "formula").reduce((sum, event) => sum + (Number(event.data.amount) || 0), 0);
      const formula = feeding.filter((event) => event.data.method === "formula").reduce((sum, event) => sum + (Number(event.data.amount) || 0), 0);
      return { ...bucket, breast, formula, total: breast + formula };
    });
    const max = Math.max(100, ...daily.map((day) => day.total));
    return `<div class="chart-legend"><span><i class="legend-swatch breast"></i>유축·기존 모유량</span><span><i class="legend-swatch formula"></i>분유</span><small>수유량은 ml/oz로 함께 표시하며, 직접 모유수유는 수유 시간으로 요약합니다.</small></div><div class="trend-chart-scroll"><div class="daily-bar-chart" style="--chart-days:${buckets.length};min-width:${Math.max(700, buckets.length * 42)}px">${daily.map((day) => `<div class="daily-bar-column" aria-label="${day.fullLabel} 유축·기존 모유량 ${formatDualVolume(day.breast)}, 분유 ${formatDualVolume(day.formula)}"><span class="chart-value">${day.total ? escapeHtml(formatDualVolume(day.total)) : ""}</span><div class="stacked-bar-shell"><div class="stacked-bar ${day.total ? "" : "no-data"}" style="height:${day.total ? Math.max(4, (day.total / max) * 100) : 2}%">${day.total ? `<i class="bar-segment formula" style="flex:${day.formula}"></i><i class="bar-segment breast" style="flex:${day.breast}"></i>` : ""}</div></div><small>${day.shortLabel}</small></div>`).join("")}</div></div>`;
  }

  function sleepTrendMarkup(buckets) {
    const daily = buckets.map((bucket) => ({ ...bucket, minutes: bucket.events.filter((event) => event.type === "sleep").reduce((sum, event) => sum + (Number(event.data.duration) || 0), 0) }));
    const max = Math.max(480, ...daily.map((day) => day.minutes));
    return `<div class="trend-chart-scroll"><div class="daily-bar-chart sleep-bars" style="--chart-days:${buckets.length};min-width:${Math.max(700, buckets.length * 42)}px">${daily.map((day) => `<div class="daily-bar-column" aria-label="${day.fullLabel} ${durationLabel(day.minutes)}"><span class="chart-value">${day.minutes ? `${(day.minutes / 60).toFixed(1)}h` : ""}</span><div class="stacked-bar-shell"><div class="sleep-bar ${day.minutes ? "" : "no-data"}" style="height:${day.minutes ? Math.max(4, (day.minutes / max) * 100) : 2}%"></div></div><small>${day.shortLabel}</small></div>`).join("")}</div></div>`;
  }

  function careChartSummaryMarkup(periodEvents) {
    const feedings = periodEvents.filter((event) => event.type === "feeding");
    const breast = feedings.filter((event) => event.data.method !== "formula").reduce((sum, event) => sum + (Number(event.data.amount) || 0), 0);
    const formula = feedings.filter((event) => event.data.method === "formula").reduce((sum, event) => sum + (Number(event.data.amount) || 0), 0);
    const breastfeedingMinutes = feedings.filter((event) => event.data.method === "breast").reduce((sum, event) => sum + (Number(event.data.duration) || 0), 0);
    const temperatures = periodEvents.filter((event) => event.type === "temperature").map((event) => Number(event.data.value)).filter(Number.isFinite);
    const sleeps = periodEvents.filter((event) => event.type === "sleep").reduce((sum, event) => sum + (Number(event.data.duration) || 0), 0);
    const weights = periodEvents.filter((event) => event.type === "weight").sort((a, b) => new Date(a.at) - new Date(b.at));
    return `<div class="chart-kpi-grid"><div><span>직접 모유수유</span><strong>${breastfeedingMinutes ? durationLabel(breastfeedingMinutes) : "기록 전"}</strong></div><div><span>유축·기존 모유량</span><strong>${formatDualVolume(breast)}</strong></div><div><span>분유</span><strong>${formatDualVolume(formula)}</strong></div><div><span>평균 체온</span><strong>${temperatures.length ? formatDualTemperature(temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length) : "기록 전"}</strong></div><div><span>총 수면</span><strong>${durationLabel(sleeps)}</strong></div><div><span>최근 체중</span><strong>${weights.length ? formatDualWeight(Number(weights.at(-1).data.value), weights.at(-1).data.inputUnit) : "기록 전"}</strong></div></div>`;
  }

  function careChartsMarkup(clientId, assignmentId = null) {
    if (!canAccessClient(clientId)) return `<div class="access-denied"><strong>접근 권한이 없습니다.</strong><span>본인 또는 현재 배정된 고객의 기록만 볼 수 있습니다.</span></div>`;
    const client = clientById(clientId);
    const assignment = assignmentId ? state.assignments.find((item) => item.id === assignmentId) : null;
    const chartBabyName = babyNameFor(assignment, client) || client?.babyName || "아기";
    const events = clientEvents(clientId, assignmentId);
    const range = state.chartRangeByRole[state.role] || "week";
    const days = range === "month" ? 30 : 7;
    const buckets = careChartBuckets(events, days);
    const periodEvents = buckets.flatMap((bucket) => bucket.events).sort((a, b) => new Date(a.at) - new Date(b.at));
    const temperaturesByDay = buckets.map((bucket) => { const values = bucket.events.filter((event) => event.type === "temperature").map((event) => Number(event.data.value)).filter(Number.isFinite); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; });
    const weightsByDay = buckets.map((bucket) => { const weights = bucket.events.filter((event) => event.type === "weight").sort((a, b) => new Date(a.at) - new Date(b.at)); return weights.length ? Number(weights.at(-1).data.value) : null; });
    const motherCare = periodEvents.filter((event) => event.type === "mother").sort((a, b) => new Date(b.at) - new Date(a.at));
    const temperatureEvents = periodEvents.filter((event) => event.type === "temperature");
    const latestWeight = periodEvents.filter((event) => event.type === "weight").at(-1);
    return `<div class="care-chart-suite"><section class="card chart-suite-header"><div><p class="eyebrow">CARE DATA OVERVIEW</p><h3>${escapeHtml(client.motherName)} · ${escapeHtml(chartBabyName)}</h3><p>같은 기간 기준으로 수유, 체온, 수면, 체중과 산모 케어 기록을 비교합니다.</p></div><div class="chart-range-tabs" role="group" aria-label="차트 조회 기간"><button type="button" class="${range === "week" ? "active" : ""}" data-chart-range="week">최근 1주일</button><button type="button" class="${range === "month" ? "active" : ""}" data-chart-range="month">최근 1개월</button></div></section>${careChartSummaryMarkup(periodEvents)}<div class="care-chart-grid">
      <article class="card chart-card wide"><div class="section-header"><div><h3>수유 기록</h3><p>일별 유축·기존 모유량과 분유 섭취량 · ml/oz 병기</p></div><span class="status-chip">${periodEvents.filter((event) => event.type === "feeding").length}회</span></div>${feedingTrendMarkup(buckets)}</article>
      <article class="card chart-card wide"><div class="section-header"><div><h3>체온 추이</h3><p>일별 평균 관찰 기록 · ℃/℉ 병기 · 상태 판정 없음</p></div><span class="status-chip">${temperatureEvents.length ? formatDualTemperature(Number(temperatureEvents.at(-1).data.value), temperatureEvents.at(-1).data.inputUnit) : "기록 전"}</span></div>${chartLineSvg(buckets, temperaturesByDay, { min: 35.5, max: 38, unit: "℃", decimals: 1, ariaLabel: `${chartBabyName} 체온 추이`, empty: "체온 기록이 아직 없습니다." })}</article>
      <article class="card chart-card wide"><div class="section-header"><div><h3>하루 수면 시간</h3><p>날짜별 기록된 총 수면 시간</p></div><span class="status-chip">${durationLabel(periodEvents.filter((event) => event.type === "sleep").reduce((sum, event) => sum + (Number(event.data.duration) || 0), 0))}</span></div>${sleepTrendMarkup(buckets)}</article>
      <article class="card chart-card wide"><div class="section-header"><div><h3>몸무게</h3><p>성장 추이 · kg/lb 병기</p></div><span class="status-chip">${latestWeight ? formatDualWeight(Number(latestWeight.data.value), latestWeight.data.inputUnit) : "기록 전"}</span></div>${chartLineSvg(buckets, weightsByDay, { unit: "kg", decimals: 2, ariaLabel: `${chartBabyName} 몸무게 추이`, empty: "체중 기록이 아직 없습니다." })}</article>
      <article class="card chart-card wide mother-care-chart"><div class="section-header"><div><h3>산모 케어</h3><p>${escapeHtml(client.motherName)} · ${escapeHtml(client.maternalStatus)} · 선택 기간 최근 기록</p></div><span class="status-chip">${motherCare.length}건</span></div><div class="mother-chart-list">${motherCare.length ? motherCare.slice(0, 6).map((event) => `<div><span>${new Date(event.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}<br/>${timeLabel(event.at)}</span><strong>${escapeHtml(event.data.care || "산모 케어")}</strong><small>${escapeHtml(event.data.note || "기록 완료")}</small></div>`).join("") : `<div class="chart-empty">산모 케어 기록이 아직 없습니다.</div>`}</div></article>
    </div><p class="care-data-note">차트는 케어 관찰 기록을 이해하기 쉽게 정리한 것으로 의료 진단이나 성장 판정을 대신하지 않습니다.</p></div>`;
  }

  function caregiverCharts(serviceType = "POSTPARTUM", workspaceNav = "") {
    const assignment = currentAssignmentFor(authUser().id, serviceType);
    const client = assignment ? clientById(assignment.clientId) : null;
    if (serviceType === "BABYSITTING") return caregiverTimeline(serviceType, workspaceNav);
    return `<section class="page">${demoBanner()}${workspaceNav}${pageHeading("CARE CHARTS", "산모·아기 관리 차트", "현재 산후조리 배정에 해당하는 고객의 케어 데이터만 차트로 확인할 수 있습니다.")}${client ? careChartsMarkup(client.id, assignment.id) : `<article class="card"><div class="empty-state"><strong>현재 담당 중인 산후조리 서비스가 없습니다.</strong></div></article>`}</section>`;
  }

  function archivedReportEventMarkup(snapshotEvent) {
    const type = DATABASE_EVENT_TO_APP[snapshotEvent.event_type] || "note";
    const meta = EVENT_META[type] || EVENT_META.note;
    const description = eventDescription({ type, data: snapshotEvent.payload || {} });
    const notes = String(snapshotEvent.notes || "").trim();
    return `<div class="archived-report-event"><time>${snapshotEvent.event_time ? new Date(snapshotEvent.event_time).toLocaleString("ko-KR") : "시간 미등록"}</time><span class="archived-report-event-icon">${meta.icon}</span><div><strong>${escapeHtml(meta.label)}</strong><p>${escapeHtml(description)}${notes && !description.includes(notes) ? ` · ${escapeHtml(notes)}` : ""}</p>${snapshotEvent.unusual_observation ? '<small>특이 관찰 기록</small>' : ""}</div></div>`;
  }

  function openArchivedReportModal(reportId) {
    const report = state.reports.find((item) => item.id === reportId && item.status === "published");
    if (!report || !canAccessClient(report.clientId)) return showToast("접근 가능한 보관 리포트를 찾을 수 없습니다.", "error");
    const snapshot = report.structuredSummary || {};
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const serviceType = snapshot.service_type || report.serviceType || "POSTPARTUM";
    const startedAt = snapshot.started_at ? new Date(snapshot.started_at).toLocaleString("ko-KR") : "기록 없음";
    const endedAt = snapshot.ended_at ? new Date(snapshot.ended_at).toLocaleString("ko-KR") : "기록 없음";
    modalRoot.innerHTML = `<div class="modal-backdrop archived-report-backdrop" data-modal-backdrop><section class="modal archived-report-print" role="dialog" aria-modal="true" aria-labelledby="archived-report-title"><header class="modal-header"><div>${brandLogoMarkup()}<p class="eyebrow">PUBLISHED CARE REPORT</p><h3 id="archived-report-title">${escapeHtml(report.title)}</h3><p>서비스가 끝난 뒤 관리자가 발행한 당시 기록</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><div class="modal-form"><div class="request-review-grid"><div><span>서비스</span><strong>${escapeHtml(serviceMetaFor(serviceType).label)}</strong></div><div><span>서비스 날짜</span><strong>${snapshot.service_date ? formatDate(snapshot.service_date) : "기록 없음"}</strong></div><div><span>고객·아이</span><strong>${escapeHtml(snapshot.client_name || "고객")} · ${escapeHtml(snapshot.baby_name || "아이")}</strong></div><div><span>담당 관리사</span><strong>${escapeHtml(snapshot.caregiver_name || "관리사 정보 없음")}</strong></div><div><span>시작</span><strong>${escapeHtml(startedAt)}</strong></div><div><span>종료</span><strong>${escapeHtml(endedAt)}</strong></div></div><div class="privacy-boundary-note"><strong>수정되지 않는 보관본</strong><span>아래 내용은 관리자가 리포트를 발행했을 때 해당 근무일에 저장되어 있던 케어 기록입니다.</span></div><section class="archived-report-events"><div class="section-header"><div><h3>케어 기록</h3><p>${events.length}개의 발행 시점 기록</p></div></div>${events.length ? events.map(archivedReportEventMarkup).join("") : '<div class="empty-state"><strong>발행할 당시 저장된 케어 기록이 없습니다.</strong></div>'}</section><footer class="archived-report-meta">발행일 ${report.publishedAt ? new Date(report.publishedAt).toLocaleString("ko-KR") : "기록 없음"} · 리포트 번호 ${escapeHtml(report.id)}</footer><div class="form-actions archived-report-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="button" class="primary-button" data-print-archived-report>보관 리포트 인쇄</button></div></div></section></div>`;
    document.body.classList.add("report-print-active");
    bindModalFrame();
    modalRoot.querySelector("[data-print-archived-report]")?.addEventListener("click", () => window.print());
  }

  function clientPublishedReportsMarkup(clientId, serviceType = null, showEmpty = false) {
    const reports = state.reports
      .filter((report) => report.clientId === clientId && report.status === "published" && (!serviceType || report.serviceType === serviceType))
      .sort((first, second) => new Date(second.publishedAt || 0) - new Date(first.publishedAt || 0));
    if (!reports.length && !showEmpty) return "";
    return `<article class="card card-pad published-reports"><div class="section-header"><div><h3>${serviceType ? `${serviceMetaFor(serviceType).label} ` : ""}보관 리포트</h3><p>발행 시점의 케어 기록이 바뀌지 않는 보관본입니다.</p></div><span class="status-chip">${reports.length}건</span></div>${reports.length ? reports.map((report) => { const snapshot = report.structuredSummary || {}; return `<div class="person-row"><div class="mini-avatar">${report.serviceType === "BABYSITTING" ? "☆" : "♡"}</div><div class="person-copy"><strong>${escapeHtml(report.title)}</strong><span>${escapeHtml(snapshot.baby_name || "아이")} · ${report.publishedAt ? new Date(report.publishedAt).toLocaleString("ko-KR") : "발행일 기록 없음"}</span></div><button class="secondary-button mini-button" data-print-care-report="${report.id}">보관본 보기·인쇄</button></div>`; }).join("") : '<div class="empty-state compact"><strong>아직 발행된 보관 리포트가 없습니다.</strong><span>관리자가 완료된 방문 기록을 검토해 발행하면 이곳에 표시됩니다.</span></div>'}</article>`;
  }

  function clientCharts(serviceType = "POSTPARTUM", workspaceNav = "") {
    const client = clientForUser(authUser().id);
    if (!client || !clientHasApprovedService(client.id, serviceType)) return clientServiceGateMarkup(client, serviceType, workspaceNav);
    const assignment = selectedClientAssignment(client.id, serviceType);
    if (serviceType === "BABYSITTING") return clientBabysittingSummary(client, assignment, workspaceNav);
    const chartBabyName = babyNameFor(assignment, client) || "아기";
    return `<section class="page report-page">${demoBanner()}${workspaceNav}${pageHeading("MY CARE CHARTS", "나와 아기의 관리 차트", "본인의 산후조리 배정에 연결된 케어 기록만 안전하게 표시됩니다.")}<header class="print-report-header"><div class="brand-mark">${brandLogoMarkup()}</div><div><strong>ProMoms CARE REPORT</strong><span>${todayLabel()} · ${escapeHtml(client?.motherName || "고객")} / ${escapeHtml(chartBabyName)}</span></div></header>${client ? careChartsMarkup(client.id, assignment.id) : ""}${clientPublishedReportsMarkup(client.id, "POSTPARTUM")}</section>`;
  }

  function clientServiceWorkspace(serviceType) {
    const allowedTabs = serviceType === "BABYSITTING" ? ["summary", "timeline", "report"] : ["summary", "timeline", "charts", "report"];
    const requested = state.serviceTabs.client[serviceType] || "summary";
    const activeTab = allowedTabs.includes(requested) ? requested : "summary";
    const workspaceNav = serviceWorkspaceTabsMarkup("client", serviceType, activeTab);
    if (activeTab === "timeline") return clientTimeline(serviceType, workspaceNav);
    if (activeTab === "charts") return clientCharts(serviceType, workspaceNav);
    if (activeTab === "report") return objectiveReportPage("client", serviceType, workspaceNav);
    return clientSummary(serviceType, workspaceNav);
  }

  function caregiverServiceWorkspace(serviceType) {
    const allowedTabs = serviceType === "BABYSITTING" ? ["today", "timeline", "report"] : ["today", "timeline", "charts", "report"];
    const requested = state.serviceTabs.caregiver[serviceType] || "today";
    const activeTab = allowedTabs.includes(requested) ? requested : "today";
    const workspaceNav = serviceWorkspaceTabsMarkup("caregiver", serviceType, activeTab);
    if (activeTab === "timeline") return caregiverTimeline(serviceType, workspaceNav);
    if (activeTab === "charts") return caregiverCharts(serviceType, workspaceNav);
    if (activeTab === "report") return objectiveReportPage("caregiver", serviceType, workspaceNav);
    return caregiverToday(serviceType, workspaceNav);
  }

  function babysittingReportMarkup(client, assignment = null) {
    const events = state.events.filter((event) => event.clientId === client.id && (!assignment || event.assignmentId === assignment.id) && ["meal", "sitter_note"].includes(event.type)).sort((a, b) => new Date(b.at) - new Date(a.at));
    const mealCount = events.filter((event) => event.type === "meal").length;
    const noteCount = events.filter((event) => event.type === "sitter_note").length;
    return `<div class="babysitting-report">${serviceBadgeMarkup("BABYSITTING")}<div class="grid stats sitter-report-stats">${statCard("식사 기록", mealCount, "식사·간식 기록", "🍽️")}${statCard("놀이·생활 기록", noteCount, "놀이·산책·생활", "☆")}${statCard("최근 기록", events.slice(0, 7).length, "최근 7일 요약", "◷")}${statCard("안전 확인", events.filter((event) => event.data?.category === "안전 확인").length, "안전 확인 기록", "✓")}</div><article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>베이비시팅 식사·생활 리포트</h3><p>보호자에게 필요한 식사와 놀이·산책 등 생활 기록을 보여줍니다.</p></div><span class="status-chip">관리사 기록 ${events.length}건</span></div>${events.length ? `<div class="timeline">${events.slice(0, 12).map((event) => { const meta = EVENT_META[event.type]; return `<div class="timeline-item"><div class="timeline-time">${new Date(event.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}<br/>${timeLabel(event.at)}</div><div class="timeline-icon">${meta.icon}</div><div class="timeline-copy"><strong>${meta.label}</strong><span>${escapeHtml(eventDescription(event))}</span></div><div class="timeline-meta"><span class="timeline-author">${escapeHtml(event.author)}</span>${canEditCareEvent(event) ? `<button type="button" class="timeline-edit-button" data-edit-care-event="${event.id}">수정</button>` : ""}</div></div>`; }).join("")}</div>` : `<div class="empty-state"><strong>베이비시팅 기록이 아직 없습니다.</strong></div>`}</article></div>`;
  }

  function objectiveReportPreferences(role = state.role) {
    state.objectiveReportByRole ||= {};
    const current = state.objectiveReportByRole[role] || {};
    state.objectiveReportByRole[role] = {
      assignmentId: current.assignmentId || null,
      customerQuery: role === "admin" ? String(current.customerQuery || "") : "",
    };
    return state.objectiveReportByRole[role];
  }

  function assignmentHasReportHistory(assignment) {
    if (!assignment?.id) return false;
    const hasProvidedSession = (state.careSessions || []).some((session) => session.assignmentId === assignment.id
      && (["IN_PROGRESS", "COMPLETED"].includes(String(session.status || "").toUpperCase()) || Boolean(session.startedAt)));
    return hasProvidedSession
      || state.events.some((event) => event.assignmentId === assignment.id)
      || state.reports.some((report) => report.assignmentId === assignment.id);
  }

  function assignmentReportPeriodHasStarted(assignment, referenceDate = new Date()) {
    const startsAt = new Date(adjustmentTargetStart(assignment));
    return !Number.isNaN(startsAt.getTime()) && startsAt.getTime() <= referenceDate.getTime();
  }

  function assignmentCanProduceObjectiveReport(assignment, role) {
    const hasHistory = assignmentHasReportHistory(assignment);
    const removed = Boolean(assignmentAdministrativeRemovalDate(assignment));
    if (removed) return role === "admin" && hasHistory;
    if (String(assignment?.status || "").toUpperCase() === "CANCELLED") return hasHistory;
    return hasHistory || assignmentReportPeriodHasStarted(assignment);
  }

  function assignmentAdministrativeRemovalDate(assignment) {
    if (!assignment) return null;
    return assignment.administrativelyRemovedAt
      || state.serviceRequests.find((request) => request.id === assignment.serviceRequestId)?.administrativelyRemovedAt
      || null;
  }

  function objectiveReportAssignments(role, serviceType = null) {
    const user = authUser();
    if (!user) return [];
    return state.assignments
      .filter((assignment) => {
        if (!clientById(assignment.clientId)) return false;
        if (!assignmentCanProduceObjectiveReport(assignment, role)) return false;
        if (serviceType && assignmentServiceType(assignment) !== serviceType) return false;
        if (role === "admin") return true;
        if (role === "caregiver") {
          return assignment.caregiverUserId === user.id
            && caregiverCanViewClientBrief(assignment);
        }
        if (role === "client") {
          const client = clientForUser(user.id);
          return Boolean(client && assignment.clientId === client.id);
        }
        return false;
      })
      .sort((first, second) => new Date(second.startAt) - new Date(first.startAt));
  }

  function objectiveReportSearchAssignments(assignments, query = "") {
    const normalizedQuery = normalizeDirectorySearch(query);
    if (!normalizedQuery) return assignments;
    return assignments.filter((assignment) => {
      const client = clientById(assignment.clientId);
      const account = client ? state.users.find((user) => user.id === client.userId || client.memberUserIds?.includes(user.id)) : null;
      const searchable = [
        client?.motherName,
        babyNameFor(assignment, client),
        account?.email,
        assignment.caregiverName,
        serviceMetaFor(assignmentServiceType(assignment)).label,
        assignment.id,
      ].filter(Boolean).join(" ");
      return normalizeDirectorySearch(searchable).includes(normalizedQuery);
    });
  }

  function objectiveReportAssignment(role, serviceType = null, candidateAssignments = null) {
    const assignments = candidateAssignments || objectiveReportAssignments(role, serviceType);
    const preferences = objectiveReportPreferences(role);
    const preferredId = role === "admin" ? (preferences.assignmentId || state.adminSelectedAssignmentId) : preferences.assignmentId;
    if (preferredId) {
      const selected = assignments.find((assignment) => assignment.id === preferredId);
      if (selected) return selected;
    }
    if (role === "client") {
      const client = clientForUser(authUser().id);
      const selected = client ? selectedClientAssignment(client.id, serviceType) : null;
      if (selected && assignments.some((assignment) => assignment.id === selected.id)) return selected;
    }
    if (role === "caregiver") {
      const current = currentAssignmentFor(authUser().id, serviceType);
      if (current && assignments.some((assignment) => assignment.id === current.id)) return current;
    }
    return assignments[0] || null;
  }

  function reportDurationValue(minutes) {
    if (minutes === null || minutes === undefined) return "기록 없음";
    return durationLabel(Math.round(minutes));
  }

  function reportNumber(value, unit = "", digits = 0) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "기록 없음";
    return `${Number(value).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`;
  }

  function objectiveBarChartSvg(daily, valueAccessor, options) {
    const values = daily.map((day) => {
      const value = valueAccessor(day);
      if (value === null || value === undefined || value === "") return null;
      return Number.isFinite(Number(value)) ? Number(value) : null;
    });
    const finiteValues = values.filter((value) => value !== null);
    if (!finiteValues.length) return `<div class="objective-report-empty">${escapeHtml(options.empty)}</div>`;
    const width = 680;
    const height = 220;
    const left = 48;
    const right = 18;
    const top = 25;
    const bottom = 48;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const max = Math.max(...finiteValues, Number(options.minimumMax || 0), 1);
    const slot = innerWidth / daily.length;
    const barWidth = Math.max(5, Math.min(32, slot * 0.58));
    const labelStep = daily.length > 14 ? 5 : daily.length > 7 ? 2 : 1;
    const grid = [0, max / 2, max];
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.ariaLabel)}">
      ${grid.map((value) => { const y = top + innerHeight - (value / max) * innerHeight; return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#dbe7e0" stroke-width="1"/><text x="${left - 7}" y="${y + 4}" text-anchor="end" fill="#60776d" font-size="10">${escapeHtml(options.axisFormat ? options.axisFormat(value) : String(Math.round(value)))}</text>`; }).join("")}
      ${daily.map((day, index) => {
        const value = values[index];
        const x = left + slot * index + (slot - barWidth) / 2;
        const barHeight = value === null ? 0 : Math.max(2, (value / max) * innerHeight);
        const y = top + innerHeight - barHeight;
        const shortDate = `${Number(day.dateKey.slice(5, 7))}/${Number(day.dateKey.slice(8, 10))}`;
        return `${value === null ? `<rect x="${x}" y="${top + innerHeight - 2}" width="${barWidth}" height="2" rx="1" fill="none" stroke="#aebfb6" stroke-dasharray="3 2"><title>${escapeHtml(day.dateLabel)} · 기록 없음</title></rect>` : `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${options.color || "#2b6c63"}"><title>${escapeHtml(day.dateLabel)} · ${escapeHtml(options.valueFormat(value))}</title></rect>`}${index % labelStep === 0 || index === daily.length - 1 ? `<text x="${x + barWidth / 2}" y="${height - 18}" text-anchor="middle" fill="#60776d" font-size="10">${shortDate}</text>` : ""}`;
      }).join("")}
    </svg>`;
  }

  function objectiveLineChartSvg(daily, valueAccessor, options) {
    const values = daily.map((day) => {
      const value = valueAccessor(day);
      if (value === null || value === undefined || value === "") return null;
      return Number.isFinite(Number(value)) ? Number(value) : null;
    });
    const finiteValues = values.filter((value) => value !== null);
    if (!finiteValues.length) return `<div class="objective-report-empty">${escapeHtml(options.empty)}</div>`;
    const width = 680;
    const height = 220;
    const left = 58;
    const right = 20;
    const top = 25;
    const bottom = 48;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const observedMin = Math.min(...finiteValues);
    const observedMax = Math.max(...finiteValues);
    const padding = Math.max((observedMax - observedMin) * 0.2, Number(options.minimumPadding || 0.1));
    const min = observedMin - padding;
    const max = observedMax + padding;
    const span = max - min;
    const slot = daily.length === 1 ? innerWidth : innerWidth / (daily.length - 1);
    const points = values.map((value, index) => value === null ? null : {
      x: left + slot * index,
      y: top + innerHeight - ((value - min) / span) * innerHeight,
      value,
    });
    const labelStep = daily.length > 14 ? 5 : daily.length > 7 ? 2 : 1;
    const segments = points.slice(0, -1).map((point, index) => point && points[index + 1]
      ? `<line x1="${point.x}" y1="${point.y}" x2="${points[index + 1].x}" y2="${points[index + 1].y}" stroke="${options.color || "#2b6c63"}" stroke-width="3" stroke-linecap="round"/>`
      : "").join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.ariaLabel)}">
      ${[min, (min + max) / 2, max].map((value) => { const y = top + innerHeight - ((value - min) / span) * innerHeight; return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#dbe7e0" stroke-width="1"/><text x="${left - 8}" y="${y + 4}" text-anchor="end" fill="#60776d" font-size="10">${escapeHtml(options.axisFormat(value))}</text>`; }).join("")}
      ${segments}
      ${points.map((point, index) => point ? `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#fffefa" stroke="${options.color || "#2b6c63"}" stroke-width="3"><title>${escapeHtml(daily[index].dateLabel)} · ${escapeHtml(options.valueFormat(point.value))}</title></circle>` : `<line x1="${left + slot * index - 6}" y1="${top + innerHeight}" x2="${left + slot * index + 6}" y2="${top + innerHeight}" stroke="#aebfb6" stroke-width="2" stroke-dasharray="3 2"><title>${escapeHtml(daily[index].dateLabel)} · 기록 없음</title></line>`).join("")}
      ${daily.map((day, index) => index % labelStep === 0 || index === daily.length - 1 ? `<text x="${left + slot * index}" y="${height - 18}" text-anchor="middle" fill="#60776d" font-size="10">${Number(day.dateKey.slice(5, 7))}/${Number(day.dateKey.slice(8, 10))}</text>` : "").join("")}
    </svg>`;
  }

  function objectiveReportKpisMarkup(model) {
    const totals = model.totals;
    const exceptionDays = Math.max(0, Number(totals.serviceDays || 0) - Number(totals.scheduledServiceDays || 0));
    const common = [
      ["리포트 표시일", `${model.dateKeys.length}일`, `예정 서비스일 ${totals.scheduledServiceDays || 0}일 · 추가·소급 ${exceptionDays}일`],
      ["관리사의 기록 횟수", `${totals.eventCount}건`, "선택한 서비스 배치의 전체 기록"],
      ["완료된 근무시간", reportDurationValue(totals.careMinutes), totals.sessionDays ? `완료된 근무 ${totals.sessionDays}일 기준 · 케어 확인 ${totals.providedSessionDays || 0}일` : `완료 시간 없음 · 케어 확인 ${totals.providedSessionDays || 0}일`],
    ];
    const serviceKpis = model.serviceType === "BABYSITTING"
      ? [["식사·간식 기록", `${totals.mealCount}건`, "관리사가 입력한 횟수"], ["놀이·생활 기록", `${totals.activityCount}건`, "놀이·산책·안전 확인 등"]]
      : [["직접 모유수유 시간", reportDurationValue(totals.breastfeedingMinutes), `${totals.breastfeedingDurationCount}건을 더한 시간`], ["입력된 유축·분유량", totals.feedingMl === null ? "기록 없음" : formatDualVolume(totals.feedingMl), `수유량 입력 ${totals.feedingMeasuredCount}건 · 수치 미입력 ${totals.feedingUnmeasuredCount}건`], ["입력된 수면시간", reportDurationValue(totals.sleepMinutes), `${totals.sleepCount}건을 더한 시간`]];
    return `<div class="objective-report-kpis">${[...common, ...serviceKpis].map(([label, value, note]) => `<div class="objective-report-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`).join("")}</div>`;
  }

  function objectiveSummaryDateLabel(dateKey) {
    const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[2])}/${Number(match[3])}` : "날짜 없음";
  }

  function objectiveSummaryDelta(current, previous, formatter, emptyLabel = "오늘 기록 없음") {
    if (!Number.isFinite(current)) return emptyLabel;
    if (!Number.isFinite(previous)) return "이전 서비스일 비교 기록 없음";
    const difference = Math.round((current - previous) * 100) / 100;
    if (Math.abs(difference) < 0.01) return "이전 서비스일과 동일";
    return `이전 서비스일 대비 ${difference > 0 ? "+" : "−"}${formatter(Math.abs(difference))}`;
  }

  function objectiveSummaryTrendMarkup(days, accessor, formatter) {
    const values = days.map((day) => accessor(day)).filter(Number.isFinite);
    const maximum = values.length ? Math.max(...values) : 0;
    const minimum = values.length ? Math.min(...values) : 0;
    const compactRange = maximum > 0 && maximum - minimum < maximum * 0.25;
    const baseline = compactRange ? minimum - Math.max((maximum - minimum) * 0.5, maximum * 0.02, 0.1) : 0;
    const range = Math.max(maximum - baseline, 0.01);
    return `<div class="today-summary-trend" aria-label="최근 서비스일 기록 추이">${days.map((day) => { const value = accessor(day); const height = Number.isFinite(value) ? Math.max(14, Math.min(100, Math.round(((value - baseline) / range) * 82) + 18)) : 8; return `<div><span class="today-summary-bar"><i style="height:${height}%"></i></span><small>${escapeHtml(objectiveSummaryDateLabel(day.dateKey))}</small><strong>${Number.isFinite(value) ? escapeHtml(formatter(value)) : "—"}</strong></div>`; }).join("")}</div>`;
  }

  function objectiveTodayMetricMarkup({ label, value, comparison, tone, days, accessor, formatter }) {
    return `<article class="today-summary-metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><p>${escapeHtml(comparison)}</p>${objectiveSummaryTrendMarkup(days, accessor, formatter)}</article>`;
  }

  function objectiveTodaySummaryMarkup(assignment, client, model) {
    const todayKey = localDateKey(new Date());
    const emptyDay = { dateKey: todayKey, eventCount: 0, feedingMl: null, breastfeedingMinutes: null, sleepMinutes: null, temperatureAverage: null, diaperCount: 0, mealCount: 0, activityCount: 0, safetyCount: 0, careMinutes: null };
    const today = model.daily.find((day) => day.dateKey === todayKey) || emptyDay;
    const previous = model.daily.filter((day) => day.dateKey < todayKey && day.eventCount > 0).at(-1) || null;
    const recentDays = [...model.daily.filter((day) => day.dateKey < todayKey && day.eventCount > 0).slice(-2), today];
    const countFormatter = (value) => `${Math.round(value)}건`;
    const minuteFormatter = (value) => durationLabel(Math.round(value));
    const temperatureFormatter = (value) => formatDualTemperature(value);
    const temperatureDeltaFormatter = (value) => `${Number(value.toFixed(1))}℃`;
    const serviceType = assignmentServiceType(assignment);
    const metrics = serviceType === "BABYSITTING"
      ? [
          { label: "식사·간식", tone: "mint", accessor: (day) => Number(day.mealCount || 0), formatter: countFormatter },
          { label: "놀이·생활", tone: "blue", accessor: (day) => Number(day.activityCount || 0), formatter: countFormatter },
          { label: "안전 확인", tone: "peach", accessor: (day) => Number(day.safetyCount || 0), formatter: countFormatter },
          { label: "완료 근무시간", tone: "cream", accessor: (day) => Number.isFinite(day.careMinutes) ? day.careMinutes : null, formatter: minuteFormatter, emptyLabel: "오늘 완료 근무 기록 없음" },
        ]
      : [
          { label: "입력된 수유량", tone: "mint", accessor: (day) => Number.isFinite(day.feedingMl) ? day.feedingMl : null, formatter: formatDualVolume, emptyLabel: "오늘 수유량 기록 없음" },
          { label: "수면 시간", tone: "blue", accessor: (day) => Number.isFinite(day.sleepMinutes) ? day.sleepMinutes : null, formatter: minuteFormatter, emptyLabel: "오늘 수면 기록 없음" },
          { label: "평균 체온", tone: "peach", accessor: (day) => Number.isFinite(day.temperatureAverage) ? day.temperatureAverage : null, formatter: temperatureFormatter, deltaFormatter: temperatureDeltaFormatter, emptyLabel: "오늘 체온 측정 없음" },
          { label: "기저귀 확인", tone: "cream", accessor: (day) => Number(day.diaperCount || 0), formatter: countFormatter },
        ];
    const babyName = babyNameFor(assignment, client) || "아이";
    return `<section class="today-summary-report report-screen-only" aria-labelledby="today-summary-report-title"><header><div><p class="eyebrow">TODAY AT A GLANCE</p><h2 id="today-summary-report-title">오늘의 요약 리포트</h2><p>${escapeHtml(babyName)} · ${escapeHtml(serviceMetaFor(serviceType).label)} · 관리사가 입력한 객관적 기록만 표시합니다.</p></div><span class="today-summary-date">${escapeHtml(objectiveDateLabel(todayKey))}</span></header><div class="today-summary-metrics">${metrics.map((metric) => { const current = metric.accessor(today); const previousValue = previous ? metric.accessor(previous) : null; return objectiveTodayMetricMarkup({ ...metric, value: Number.isFinite(current) ? metric.formatter(current) : "기록 없음", comparison: objectiveSummaryDelta(current, previousValue, metric.deltaFormatter || metric.formatter, metric.emptyLabel), days: recentDays }); }).join("")}</div><div class="today-summary-foot"><p><strong>오늘 관리사 기록 ${today.eventCount || 0}건</strong><span>${previous ? `비교 기준: ${objectiveDateLabel(previous.dateKey)}의 이전 서비스 기록` : "비교할 이전 서비스일 기록이 없습니다."}</span></p><a class="secondary-button" href="#batch-report">배치 전체 리포트 보기</a></div></section>`;
  }

  function objectiveReportTimeBasisLabel(model) {
    const timeZones = [...new Set(String(model?.timeZone || "")
      .split(",")
      .map((timeZone) => timeZone.trim())
      .filter(Boolean))];
    if (!timeZones.length) return "기록 기기의 현지시간";
    const labels = timeZones.map(serviceTimeZoneLabel);
    return labels.length === 1 ? `${labels[0]} 기준` : `기록별 현지시간 (${labels.join(" · ")})`;
  }

  function objectiveReportChartsMarkup(model) {
    const babysitting = model.serviceType === "BABYSITTING";
    const charts = babysitting
      ? [
          { title: "날짜별 식사·간식 기록", subtitle: "관리사가 입력한 횟수 · 메모 내용에서 양을 임의로 계산하지 않음", accessor: (day) => day.mealCount, formatter: (value) => `${value}건`, color: "#2b6c63", empty: "식사·간식 기록이 없습니다.", type: "bar" },
          { title: "날짜별 놀이·생활 기록", subtitle: "놀이·산책·안전 확인 등으로 입력된 기록 횟수", accessor: (day) => day.activityCount, formatter: (value) => `${value}건`, color: "#d88f73", empty: "놀이·생활 기록이 없습니다.", type: "bar" },
        ]
      : [
          { title: "날짜별 직접 모유수유 시간", subtitle: "관리사가 입력한 직접 모유수유 시간을 날짜별로 더한 값 · 분", accessor: (day) => day.breastfeedingMinutes, formatter: (value) => `${Math.round(value)}분`, color: "#5790a8", empty: "직접 모유수유 시간 기록이 없습니다.", type: "bar" },
          { title: "날짜별 입력 수유량", subtitle: "수유량이 숫자로 입력된 기록만 더한 값 · ml/oz 병기", accessor: (day) => day.feedingMl, formatter: (value) => formatDualVolume(value), color: "#2b6c63", empty: "수유량이 입력된 기록이 없습니다.", type: "bar" },
          { title: "날짜별 수면시간", subtitle: "관리사가 입력한 수면시간을 날짜별로 더한 값 · 분", accessor: (day) => day.sleepMinutes, formatter: (value) => `${Math.round(value)}분`, color: "#6d9188", empty: "수면시간 기록이 없습니다.", type: "bar" },
          { title: "날짜별 평균 체온", subtitle: "해당 날짜에 측정한 체온의 평균 · ℃/℉ 병기", accessor: (day) => day.temperatureAverage, formatter: (value) => formatDualTemperature(value), axisFormat: (value) => value.toFixed(1), minimumPadding: 0.1, color: "#d88f73", empty: "체온 측정 기록이 없습니다.", type: "line" },
          { title: "날짜별 마지막 체중", subtitle: "해당 날짜에 마지막으로 측정한 체중 · kg/lb 병기", accessor: (day) => day.lastWeight, formatter: (value) => formatDualWeight(value), axisFormat: (value) => value.toFixed(2), minimumPadding: 0.02, color: "#9a765d", empty: "체중 측정 기록이 없습니다.", type: "line" },
        ];
    return `<div class="objective-report-charts">${charts.map((chart) => `<article class="objective-report-chart"><h3>${escapeHtml(chart.title)}</h3><p class="objective-report-legend">${escapeHtml(chart.subtitle)} · 표시 없음은 기록 없음</p>${chart.type === "line" ? objectiveLineChartSvg(model.daily, chart.accessor, { ariaLabel: chart.title, valueFormat: chart.formatter, axisFormat: chart.axisFormat, minimumPadding: chart.minimumPadding, color: chart.color, empty: chart.empty }) : objectiveBarChartSvg(model.daily, chart.accessor, { ariaLabel: chart.title, valueFormat: chart.formatter, color: chart.color, empty: chart.empty })}</article>`).join("")}</div>`;
  }

  function objectiveReportCustomerSearchMarkup(preferences, resultCount, totalCount) {
    const query = String(preferences.customerQuery || "");
    return `<form class="objective-report-customer-search" data-objective-report-customer-search><div class="field"><label for="objective-report-customer-query">고객 검색</label><div class="objective-report-search-control"><input id="objective-report-customer-query" name="customerQuery" type="search" value="${escapeHtml(query)}" placeholder="고객명·아기 이름·이메일 검색" autocomplete="off"/><button type="submit" class="secondary-button mini-button">검색</button>${query ? '<button type="button" class="text-button" data-clear-objective-report-search>초기화</button>' : ""}</div><small>${query ? `검색 결과 ${resultCount}개 배치 · 전체 ${totalCount}개` : `조회 가능한 전체 서비스 배치 ${totalCount}개`}</small></div></form>`;
  }

  function objectiveReportSearchEmptyMarkup(preferences, totalCount) {
    return `<section class="objective-report-builder report-screen-only" aria-label="케어 리포트 고객 검색"><div class="section-header"><div><p class="eyebrow">CARE REPORT</p><h3>고객별 서비스 배치 찾기</h3><p>고객명, 아기 이름 또는 이메일로 서비스 기록을 빠르게 찾을 수 있습니다.</p></div><span class="status-chip">관리자 전체 조회</span></div>${objectiveReportCustomerSearchMarkup(preferences, 0, totalCount)}<div class="empty-state compact"><strong>검색 조건에 맞는 서비스 배치가 없습니다.</strong><span>검색어를 바꾸거나 초기화한 뒤 다시 확인해 주세요.</span></div></section>`;
  }

  function objectiveReportAssignmentPeriod(assignment) {
    const startDate = objectiveDateKey(assignment.startAt, OBJECTIVE_REPORT_TIME_ZONE) || assignment.contractStartDate;
    const endDate = objectiveDateKey(assignment.endAt, OBJECTIVE_REPORT_TIME_ZONE) || assignment.contractEndDate;
    return `${objectiveDateLabel(startDate)}–${objectiveDateLabel(endDate)}`;
  }

  function objectiveReportBuilderMarkup(role, serviceType, assignment, assignments, model, options = {}) {
    const preferences = objectiveReportPreferences(role);
    const totalCount = Number(options.totalCount ?? assignments.length);
    const assignmentOptions = assignments.map((item) => {
      const itemClient = clientById(item.clientId);
      const itemBaby = babyNameFor(item, itemClient) || "아이";
      const period = objectiveReportAssignmentPeriod(item);
      const auditLabel = assignmentAdministrativeRemovalDate(item) ? " · 삭제 이력" : "";
      return `<option value="${item.id}" ${item.id === assignment.id ? "selected" : ""}>${escapeHtml(itemClient?.motherName || "고객")} / ${escapeHtml(itemBaby)} · ${escapeHtml(serviceMetaFor(item.serviceType).label)} · ${escapeHtml(period)}${auditLabel}</option>`;
    }).join("");
    const batchPeriod = objectiveReportAssignmentPeriod(assignment);
    const administrativeRemovalDate = assignmentAdministrativeRemovalDate(assignment);
    const auditNotice = role === "admin" && administrativeRemovalDate
      ? `<div class="status-banner warning"><strong>삭제 이력 배치</strong><span>${formatDateTime(administrativeRemovalDate)} 관리자 삭제 처리 후 감사 목적으로 보존된 리포트입니다.</span></div>`
      : "";
    const adminSearch = role === "admin" ? objectiveReportCustomerSearchMarkup(preferences, assignments.length, totalCount) : "";
    return `<section class="objective-report-builder report-screen-only" aria-label="케어 리포트 설정"><div class="section-header"><div><p class="eyebrow">CARE REPORT</p><h3>서비스 배치별 케어 리포트</h3><p>선택한 배치의 서비스 요일과 실제 케어·기록이 있는 날짜만 정리합니다. 비서비스일은 표시하지 않습니다.</p></div><span class="status-chip">${escapeHtml(serviceMetaFor(serviceType).label)}</span></div>${adminSearch}${auditNotice}<div class="report-builder-fields"><div class="field report-batch-selector"><label for="objective-report-assignment">서비스 배치 선택</label><select id="objective-report-assignment" data-objective-report-assignment>${assignmentOptions}</select><small>고객과 관리사는 본인에게 연결된 배치만 볼 수 있습니다.</small></div><div class="field"><label>배치 서비스 기간</label><div class="report-batch-summary"><strong>${escapeHtml(batchPeriod)}</strong><span>배치 ${escapeHtml(String(assignment.id).slice(0, 8).toUpperCase())}</span></div></div><div class="field"><label>리포트 표시일</label><div class="report-batch-summary"><strong>${model.dateKeys.length}일</strong><span>서비스 요일·실제 케어 기록 기준</span></div></div></div><div class="report-builder-fields"><div class="field"><label>기록 시간 기준</label><div class="status-chip">${escapeHtml(objectiveReportTimeBasisLabel(model))}</div></div><div class="report-builder-actions"><button type="button" class="primary-button" data-print-objective-report="${escapeHtml(assignment.id)}">PDF로 저장·인쇄</button></div></div></section>`;
  }

  function caregiverDisplayNameForAssignment(assignment) {
    const caregiver = state.users.find((user) => user.id === assignment?.caregiverUserId);
    return caregiver?.fullName || assignment?.caregiverName || "담당 관리사";
  }

  function assignmentCaregiverHistory(assignment) {
    const relatedAssignments = assignment?.contractId
      ? state.assignments.filter((item) => item.contractId === assignment.contractId && assignmentServiceType(item) === assignmentServiceType(assignment))
      : [assignment];
    return relatedAssignments
      .filter(Boolean)
      .sort((first, second) => new Date(first.startAt || 0) - new Date(second.startAt || 0))
      .map((item) => ({
        assignmentId: item.id,
        caregiverId: item.caregiverId || item.caregiverUserId || caregiverDisplayNameForAssignment(item),
        caregiverName: caregiverDisplayNameForAssignment(item),
        fromDate: objectiveDateKey(item.startAt, OBJECTIVE_REPORT_TIME_ZONE) || item.contractStartDate || "",
        toDate: objectiveDateKey(item.endAt, OBJECTIVE_REPORT_TIME_ZONE) || item.contractEndDate || "",
      }))
      .reduce((history, segment) => {
        const previous = history.at(-1);
        if (previous?.caregiverId === segment.caregiverId && previous?.caregiverName === segment.caregiverName) {
          previous.toDate = segment.toDate || previous.toDate;
          previous.assignmentIds.push(segment.assignmentId);
          return history;
        }
        history.push({ ...segment, assignmentIds: [segment.assignmentId] });
        return history;
      }, []);
  }

  function objectiveReportCaregiverHistoryMarkup(assignment) {
    const history = assignmentCaregiverHistory(assignment);
    const current = history.find((segment) => segment.assignmentIds.includes(assignment.id)) || history.at(-1);
    if (!current) return "";
    return `<section class="objective-report-caregiver-history"><div><span>서비스 담당 관리사</span><strong>${escapeHtml(current.caregiverName)}</strong><small>${history.length > 1 ? `서비스 중 관리사 변경 ${history.length - 1}회` : "해당 서비스 배치 담당"}</small></div><ol>${history.map((segment, index) => `<li><span>${index + 1}</span><div><strong>${escapeHtml(segment.caregiverName)}</strong><small>${escapeHtml(objectiveDateLabel(segment.fromDate))}–${escapeHtml(objectiveDateLabel(segment.toDate))}</small></div></li>`).join("")}</ol></section>`;
  }

  function objectiveReportMarkup(assignment, client, model) {
    const babyName = babyNameFor(assignment, client) || "아이";
    const generatedAtDate = new Date();
    const reportFrom = model.fromDate || objectiveDateKey(assignment.startAt);
    const reportTo = model.toDate || objectiveDateKey(assignment.endAt);
    const reportId = `BATCH-${String(assignment.id).slice(0, 8).toUpperCase()}-${String(reportFrom).replaceAll("-", "")}-${String(reportTo).replaceAll("-", "")}-${generatedAtDate.getTime().toString(36).toUpperCase()}`;
    const generatedAtTimeZone = deviceTimeZone();
    const generatedAt = generatedAtDate.toLocaleString("ko-KR", { timeZone: generatedAtTimeZone });
    const reportTimeBasis = objectiveReportTimeBasisLabel(model);
    return `<article class="objective-report" aria-labelledby="objective-report-title"><header class="objective-report-banner"><div class="report-print-only">${brandLogoMarkup(true)}</div><p class="eyebrow">PROMOMS CARE REPORT</p><h1 id="objective-report-title">${escapeHtml(serviceMetaFor(model.serviceType).label)} 서비스 배치 리포트</h1><p>${escapeHtml(client.motherName)} · ${escapeHtml(babyName)} · ${escapeHtml(objectiveDateLabel(reportFrom))}–${escapeHtml(objectiveDateLabel(reportTo))}</p><small>배치 ${escapeHtml(String(assignment.id).slice(0, 8).toUpperCase())} · 리포트 번호 ${escapeHtml(reportId)} · 기록 시간 ${escapeHtml(reportTimeBasis)} · 생성 ${escapeHtml(generatedAt)} (${escapeHtml(serviceTimeZoneLabel(generatedAtTimeZone))})</small></header>${objectiveReportCaregiverHistoryMarkup(assignment)}<div class="objective-report-banner"><strong>선택한 서비스 배치와 기록</strong><p>표시된 서비스일 ${model.dateKeys.length}일 · 기록이 있는 날 ${model.totals.recordedDays}일 · 관리사 기록 ${model.totals.eventCount}건 · 완료된 근무시간 ${model.totals.careMinutes === null ? "기록 없음" : reportDurationValue(model.totals.careMinutes)}</p><small>배치 안의 서비스 요일과 실제 케어·기록 날짜만 표시하며 비서비스일은 제외합니다. 날짜와 시간은 각 기록을 입력한 기기의 현지시간 기준입니다. ‘기록 없음’은 숫자 0과 다릅니다. 메모가 포함된 ${model.dataQuality.freeTextExcludedFromMetrics}건의 메모 속 숫자는 합계·평균에 사용하지 않았습니다. 숫자로 읽을 수 없는 입력 ${model.dataQuality.invalidMetricCount}건.</small></div>${objectiveReportKpisMarkup(model)}<section class="objective-report-section"><h2>서비스 배치 기록 요약</h2><div class="objective-report-facts">${model.facts.map((fact) => `<p class="objective-report-fact">${escapeHtml(fact)}</p>`).join("")}</div></section><section class="objective-report-section"><h2>서비스일별 변화</h2><p class="objective-report-legend">선택한 배치의 서비스일만 각 기록 기기의 현지날짜 기준으로 표시합니다. 정상·위험·호전·악화 여부를 판단하지 않습니다.</p>${objectiveReportChartsMarkup(model)}</section><p class="objective-report-disclaimer"><strong>중요:</strong> 이 문서는 관리사가 입력한 내용을 합계·평균으로 정리한 리포트입니다. 의료 진단, 성장 판정, 건강 상태 평가 또는 원인 추정을 제공하지 않습니다. 판단이 필요한 경우 해당 분야의 자격을 갖춘 전문가에게 문의하세요.</p><footer class="objective-report-footer"><p>ProMoms · 엄마 곁의 전문가</p><p>${escapeHtml(reportId)} · 계산 기준 1.1 · ${escapeHtml(reportFrom)}–${escapeHtml(reportTo)}</p></footer></article>`;
  }

  function objectiveReportPage(role, serviceType, workspaceNav = "") {
    const assignments = objectiveReportAssignments(role, serviceType);
    const assignment = objectiveReportAssignment(role, serviceType, assignments);
    if (!assignment) {
      const client = role === "client" ? clientForUser(authUser()?.id) : null;
      return `<section class="page">${demoBanner()}${workspaceNav}${pageHeading("CARE REPORT", "서비스 배치별 케어 리포트", "본인에게 연결된 서비스 배치의 객관적 요약과 변화 그래프를 확인합니다.")}<article class="card card-pad"><div class="empty-state"><strong>리포트를 만들 수 있는 서비스 배치가 없습니다.</strong><span>서비스 기간이 시작되면 이곳에서 배치를 선택할 수 있습니다.</span></div></article>${client ? clientPublishedReportsMarkup(client.id, serviceType) : ""}</section>`;
    }
    const client = clientById(assignment.clientId);
    if (!client || !objectiveReportAssignments(role, serviceType).some((item) => item.id === assignment.id)) return `<section class="page">${demoBanner()}${workspaceNav}<div class="access-denied"><strong>접근 권한이 없습니다.</strong><span>본인 또는 권한이 확인된 배정의 기록만 볼 수 있습니다.</span></div></section>`;
    const model = buildObjectiveReportModel({ assignment, events: state.events, sessions: state.careSessions || [] });
    return `<section class="page report-page">${demoBanner()}${workspaceNav}${pageHeading("CARE REPORT", "서비스 배치별 케어 기록", "선택한 서비스 배치의 요약 지표와 객관적인 변화 그래프를 확인합니다.")}${objectiveTodaySummaryMarkup(assignment, client, model)}${objectiveReportBuilderMarkup(role, assignmentServiceType(assignment), assignment, assignments, model)}<span id="batch-report" class="report-scroll-anchor" aria-hidden="true"></span>${objectiveReportMarkup(assignment, client, model)}${role === "client" ? clientPublishedReportsMarkup(client.id, serviceType) : ""}</section>`;
  }

  function careSessionReportPreviewMarkup(client, assignment, session) {
    const serviceType = assignmentServiceType(assignment);
    const allowedTypes = serviceType === "BABYSITTING" ? ["meal", "sitter_note"] : ["feeding", "diaper", "sleep", "temperature", "bath", "weight", "mother", "note"];
    const events = state.events
      .filter((event) => event.careSessionId === session.id && allowedTypes.includes(event.type))
      .sort((first, second) => new Date(first.at) - new Date(second.at));
    const serviceDate = session.serviceDate ? formatDate(`${session.serviceDate}T12:00:00`) : "날짜 미등록";
    const babyName = babyNameFor(assignment, client) || "아이";
    const eventList = events.length
      ? `<div class="timeline">${events.map((event) => { const meta = EVENT_META[event.type] || EVENT_META.note; return `<div class="timeline-item"><div class="timeline-time">${timeLabel(event.at)}</div><div class="timeline-icon">${meta.icon}</div><div class="timeline-copy"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(eventDescription(event))}</span></div><div class="timeline-meta"><span class="timeline-author">${escapeHtml(event.author || "ProMoms")}</span>${canEditCareEvent(event) ? `<button type="button" class="timeline-edit-button" data-edit-care-event="${event.id}">수정</button>` : ""}</div></div>`; }).join("")}</div>`
      : '<div class="empty-state"><strong>선택한 근무일에 저장된 케어 기록이 없습니다.</strong><span>기록이 없는 근무일도 완료 이력은 보관됩니다.</span></div>';
    const summary = serviceType === "BABYSITTING"
      ? `<div class="grid stats sitter-report-stats">${statCard("식사 기록", events.filter((event) => event.type === "meal").length, "식사·간식 기록", "🍽️")}${statCard("놀이·생활 기록", events.filter((event) => event.type === "sitter_note").length, "놀이·산책·생활", "☆")}${statCard("관리사의 기록 횟수", events.length, "선택한 근무일 전체", "◷")}${statCard("안전 확인", events.filter((event) => event.data?.category === "안전 확인").length, "안전 확인 기록", "✓")}</div>`
      : careChartSummaryMarkup(events);
    return `<div class="care-session-report-preview">${serviceBadgeMarkup(serviceType)}<article class="card card-pad"><div class="section-header"><div><p class="eyebrow">WORKDAY REPORT</p><h3>${escapeHtml(babyName)} · ${serviceDate}</h3><p>담당 관리사 ${escapeHtml(caregiverDisplayNameForAssignment(assignment))} · 선택한 근무일의 기록만 보여줍니다. 고객에게 발행되는 보관본에도 같은 내용이 들어갑니다.</p></div><span class="status-chip">관리사 기록 ${events.length}건</span></div>${summary}<div class="section-header session-event-header"><div><h3>근무일 상세 기록</h3><p>${session.startedAt ? `${new Date(session.startedAt).toLocaleString("ko-KR")} 시작` : "시작시간 기록 없음"}${session.endedAt ? ` · ${new Date(session.endedAt).toLocaleString("ko-KR")} 종료` : ""}</p></div></div>${eventList}</article></div>`;
  }

  function adminReports() {
    const reportPreferences = objectiveReportPreferences("admin");
    const allReportAssignments = objectiveReportAssignments("admin");
    const reportAssignments = objectiveReportSearchAssignments(allReportAssignments, reportPreferences.customerQuery);
    const assignment = reportAssignments.find((item) => item.id === (reportPreferences.assignmentId || state.adminSelectedAssignmentId))
      || reportAssignments.find((item) => item.clientId === state.adminSelectedClientId)
      || reportAssignments[0];
    const client = assignment ? clientById(assignment.clientId) : null;
    if (allReportAssignments.length && !reportAssignments.length) {
      return `<section class="page report-page">${demoBanner()}${pageHeading("CARE REPORTS", "전체 고객 서비스 배치 리포트", "고객을 검색해 서비스 배치를 선택하고 해당 배치의 서비스일 기록을 확인합니다.")}${objectiveReportSearchEmptyMarkup(reportPreferences, allReportAssignments.length)}</section>`;
    }
    if (!assignment || !client) {
      return `<section class="page report-page">${demoBanner()}${pageHeading("CARE REPORTS", "전체 고객 서비스 배치 리포트", "서비스 고객과 케어 기록이 생성되면 배치별 리포트를 검토하고 전달할 수 있습니다.")}<article class="card card-pad"><div class="empty-state"><span class="empty-icon">◇</span><strong>리포트를 생성할 서비스 배치가 없습니다.</strong><span>서비스 기간이 시작된 배치가 이곳에 표시됩니다.</span></div></article></section>`;
    }
    const babysitting = assignmentServiceType(assignment) === "BABYSITTING";
    const reportBabyName = babyNameFor(assignment, client) || "아이";
    const completedSessions = (state.careSessions || [])
      .filter((session) => session.assignmentId === assignment.id && session.status === "COMPLETED")
      .sort((first, second) => String(second.serviceDate || second.endedAt || "").localeCompare(String(first.serviceDate || first.endedAt || "")));
    if (!completedSessions.length && assignment.careSessionId && assignment.careSessionStatus === "COMPLETED") {
      completedSessions.push({ id: assignment.careSessionId, assignmentId: assignment.id, serviceDate: assignment.careSessionDate, status: "COMPLETED", endedAt: assignment.lastCompletedCareAt });
    }
    const reportSession = completedSessions.find((session) => session.id === state.adminSelectedReportSessionId) || completedSessions[0] || null;
    const publishedReport = reportSession ? state.reports.find((report) => report.careSessionId === reportSession.id && report.status === "published") || null : null;
    const reportSessionOptions = completedSessions.length
      ? `<div class="field"><label for="report-session">완료된 근무일 선택</label><select id="report-session" data-admin-report-session>${completedSessions.map((session) => { const alreadyPublished = state.reports.some((report) => report.careSessionId === session.id && report.status === "published"); return `<option value="${session.id}" ${session.id === reportSession?.id ? "selected" : ""}>${session.serviceDate ? formatDate(`${session.serviceDate}T12:00:00`) : "날짜 미등록"}${alreadyPublished ? " · 발행 완료" : " · 발행 대기"}</option>`; }).join("")}</select></div>`
      : '<div class="status-chip gold">완료된 근무 기록이 없습니다.</div>';
    const reportAction = publishedReport
      ? `<button class="primary-button" data-print-care-report="${publishedReport.id}">발행 완료 · 보관본 보기</button>`
      : reportSession
        ? `<button class="primary-button" data-publish-report="${assignment.id}" data-care-session-id="${reportSession.id}">리포트 생성·고객에게 보내기</button>`
        : '<span class="status-chip gold">완료된 케어 세션에서만 발행 가능</span>';
    const objectiveModel = buildObjectiveReportModel({ assignment, events: state.events, sessions: state.careSessions || [] });
    return `<section class="page report-page">${demoBanner()}${pageHeading("CARE REPORTS", "서비스 배치 기록과 방문별 보관본", "고객을 검색해 배치별 기록을 확인·PDF로 저장하고, 완료된 근무 1건은 수정되지 않는 보관본으로 발행합니다.")}
      ${objectiveTodaySummaryMarkup(assignment, client, objectiveModel)}
      ${objectiveReportBuilderMarkup("admin", assignmentServiceType(assignment), assignment, reportAssignments, objectiveModel, { totalCount: allReportAssignments.length })}
      <span id="batch-report" class="report-scroll-anchor" aria-hidden="true"></span>${objectiveReportMarkup(assignment, client, objectiveModel)}
      <section class="card card-pad visit-report-panel report-screen-only" style="margin-top:22px"><div class="section-header"><div><p class="eyebrow">WORKDAY CARE REPORT</p><h3>근무일별 보관본 확인·발행</h3><p>기간별 리포트와 별도로, 완료된 근무일 1건의 기록을 고객에게 전달합니다. 발행 후 내용은 바뀌지 않습니다.</p></div>${serviceBadgeMarkup(assignmentServiceType(assignment))}</div><div class="report-toolbar">${reportSessionOptions}<div class="report-actions">${reportAction}</div></div>
      <header class="print-report-header"><div class="brand-mark">${brandLogoMarkup()}</div><div><strong>ProMoms CARE REPORT</strong><span>${reportSession?.serviceDate ? formatDate(`${reportSession.serviceDate}T12:00:00`) : "완료된 근무일 선택 필요"} · ${escapeHtml(client.motherName)} / ${escapeHtml(reportBabyName)}</span></div></header>
      ${reportSession ? careSessionReportPreviewMarkup(client, assignment, reportSession) : '<div class="empty-state"><strong>발행할 완료 근무 기록이 없습니다.</strong><span>관리사가 근무를 종료하면 근무일별 확인 화면이 만들어집니다.</span></div>'}
      <article class="report-note" style="margin-top:18px"><p>${babysitting ? `${escapeHtml(reportBabyName)}의 식사와 놀이·생활 기록을 바탕으로 만든 근무일 보관본입니다.` : `${escapeHtml(reportBabyName)}의 수유·수면·체온 기록과 ${escapeHtml(client.motherName)}님의 산모 케어 기록을 바탕으로 만든 근무일 보관본입니다. 의료 진단이나 판정을 제공하지 않습니다.`}</p><span>ProMoms 관리자 확인</span></article></section>
    </section>`;
  }

  function publicProductMarkup() {
    return state.retail.products.slice(0, 6).map((product) => `<article class="public-product-card"><div class="public-product-art ${product.category.toLowerCase()}"><span>${product.emoji}</span>${product.badge ? `<em>${product.badge}</em>` : ""}</div><div><small>${categoryLabel(product.category)}</small><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><strong>${money(product.price)}</strong></div></article>`).join("");
  }

  function publicServiceStatusMarkup(user) {
    if (!userHasAccessRole(user, "CLIENT")) return "";
    const client = clientForUser(user.id);
    const currentAssignment = client ? canonicalCurrentAssignment(client.id) : null;
    const upcomingAssignment = client ? state.assignments.filter((assignment) => assignment.clientId === client.id && assignment.status !== "CANCELLED" && new Date(assignment.startAt) > new Date()).sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0] : null;
    const waiting = state.serviceRequests.filter((request) => request.userId === user.id && (request.status === "PENDING" || (request.status === "APPROVED" && !request.approvedAssignmentId)));
    if (currentAssignment || upcomingAssignment) {
      const assignment = currentAssignment || upcomingAssignment;
    const status = currentAssignment ? "이용 중" : `${formatDate(assignment.startAt)} 시작 예정`;
      return `<div class="public-status-card approved"><span>✓</span><div><strong>${serviceMetaFor(assignment.serviceType).label} ${status}입니다.</strong><small>한 아기에게 한 가지 돌봄 단계만 활성화됩니다.${waiting.length ? ` · 다음 서비스 ${waiting.length}건 승인/배정 대기` : ""}</small></div><button class="primary-button" data-my-service>나의 서비스</button></div>`;
    }
    if (waiting.length) return `<div class="public-status-card pending"><span>◷</span><div><strong>${waiting.length}건의 서비스 신청을 처리하고 있습니다.</strong><small>승인과 일정 배치가 완료되면 각 서비스 전용 화면이 활성화됩니다.</small></div><button class="secondary-button" data-my-service>진행 상태 보기</button></div>`;
    return `<div class="public-status-card"><span>♡</span><div><strong>필요한 돌봄 서비스를 신청해 보세요.</strong><small>산후조리와 베이비시팅은 각각 독립적으로 신청할 수 있으며, 같은 아기의 이용 기간만 겹치지 않게 운영합니다.</small></div><button class="primary-button" data-service-apply>서비스 신청</button></div>`;
  }

  function publicAccountActionsMarkup(user, clientUser, defaultApplicationType, defaultApplicationLabel) {
    if (clientUser) return `<span class="public-welcome">${escapeHtml(user.fullName)}님</span><button class="secondary-button" data-service-apply="${defaultApplicationType}">${defaultApplicationLabel}</button><button class="primary-button" data-my-service>나의 서비스</button><button class="public-text-button" data-logout>로그아웃</button>`;
    if (user) return '<button class="primary-button" data-enter-portal>관리 화면</button><button class="public-text-button" data-logout>로그아웃</button>';
    return '<button class="public-text-button" data-auth-screen="signup">회원가입</button><button class="primary-button" data-auth-screen="login">로그인</button>';
  }

  function normalizedCompetencyScores(scores) {
    if (!scores || typeof scores !== "object") return null;
    const normalized = {};
    for (const competency of REVIEW_COMPETENCIES) {
      const value = Number(scores[competency.key]);
      if (!Number.isFinite(value) || value < 1 || value > 5) return null;
      normalized[competency.key] = value;
    }
    return normalized;
  }

  function competencyScoresFromFormData(formData) {
    return normalizedCompetencyScores(Object.fromEntries(
      REVIEW_COMPETENCIES.map((competency) => [competency.key, formData.get(`competency_${competency.key}`)]),
    ));
  }

  function reviewOverallRating(competencyScores, fallbackRating = null) {
    const normalized = normalizedCompetencyScores(competencyScores);
    if (!normalized) {
      const fallback = Number(fallbackRating);
      return Number.isFinite(fallback) && fallback >= 1 && fallback <= 5 ? Number(fallback.toFixed(1)) : null;
    }
    const total = REVIEW_COMPETENCIES.reduce((sum, competency) => sum + normalized[competency.key], 0);
    return Number((total / REVIEW_COMPETENCIES.length).toFixed(1));
  }

  function reviewOverallRatingMarkup(review) {
    const rating = reviewOverallRating(review?.competencyScores, review?.rating);
    if (rating == null) return "";
    return `<div class="review-stars calculated" aria-label="6개 전문 역량 평균 종합평점 ${rating.toFixed(1)}점"><b aria-hidden="true">★</b><strong>${rating.toFixed(1)}</strong><small>/ 5.0 · 6개 역량 평균</small></div>`;
  }

  function reviewCompetencySurveyMarkup(idPrefix = "review") {
    return `<section class="review-competency-survey"><div class="review-competency-heading"><div><p class="eyebrow">PROFESSIONAL CARE SKILLS</p><h4>전문 역량 평가</h4><p>6개 항목을 1~5점으로 평가하면 산술평균이 종합평점으로 자동 계산됩니다.</p></div><span>6개 항목 필수</span></div><div class="review-competency-grid">${REVIEW_COMPETENCIES.map((competency) => `<article class="review-competency-item"><div class="review-competency-label"><span aria-hidden="true">${competency.icon}</span><div><strong>${competency.formLabel}</strong><small>${competency.description}</small></div></div><div class="competency-score-options" role="radiogroup" aria-label="${competency.formLabel} 점수">${[1, 2, 3, 4, 5].map((score) => `<label title="${competency.formLabel} ${score}점"><input type="radio" id="${idPrefix}-${competency.key}-${score}" name="competency_${competency.key}" value="${score}" required/><span>${score}</span></label>`).join("")}</div></article>`).join("")}</div><div class="competency-scale-guide"><span>1 개선 필요</span><span>3 기대 충족</span><span>5 매우 우수</span></div><div class="privacy-boundary-note review-average-note"><strong>종합평점 자동 계산</strong><span>별도의 종합 별점 선택 없이 위 6개 점수의 평균이 소수점 한 자리 종합평점으로 저장됩니다.</span></div></section>`;
  }

  function reviewCompetencySummaryMarkup(scores, compact = false) {
    const normalized = normalizedCompetencyScores(scores);
    if (!normalized) return "";
    return `<div class="review-competency-summary ${compact ? "compact" : ""}" aria-label="전문 역량 평가">${REVIEW_COMPETENCIES.map((competency) => `<span><i aria-hidden="true">${competency.icon}</i><small>${competency.label}</small><strong>${Number(normalized[competency.key]).toFixed(1)}</strong></span>`).join("")}</div>`;
  }

  function caregiverCompetencyRadarMarkup(scores, reviewCount = 0, compact = false) {
    const normalized = normalizedCompetencyScores(scores);
    if (!normalized || Number(reviewCount) <= 0) {
      return compact ? "" : `<div class="caregiver-competency-empty"><strong>전문 역량 평가는 새 후기부터 표시됩니다.</strong><span>식사·세심함·시간준수·전문성·소통·위생안전의 평균을 별도로 제공합니다.</span></div>`;
    }
    const centerX = 180;
    const centerY = 154;
    const radius = 100;
    const point = (index, ratio = 1) => {
      const angle = ((-90 + index * 60) * Math.PI) / 180;
      return `${(centerX + Math.cos(angle) * radius * ratio).toFixed(2)},${(centerY + Math.sin(angle) * radius * ratio).toFixed(2)}`;
    };
    const grid = [1, 2, 3, 4, 5].map((level) => `<polygon points="${REVIEW_COMPETENCIES.map((_, index) => point(index, level / 5)).join(" ")}"/>`).join("");
    const axes = REVIEW_COMPETENCIES.map((_, index) => `<line x1="${centerX}" y1="${centerY}" x2="${point(index).split(",")[0]}" y2="${point(index).split(",")[1]}"/>`).join("");
    const scorePointList = REVIEW_COMPETENCIES.map((competency, index) => point(index, normalized[competency.key] / 5));
    const scorePoints = scorePointList.join(" ");
    const scoreDots = scorePointList.map((coordinates) => {
      const [cx, cy] = coordinates.split(",");
      return `<circle class="competency-radar-point" cx="${cx}" cy="${cy}" r="4"/>`;
    }).join("");
    const labelPositions = [
      [180, 22], [316, 91], [316, 239], [180, 309], [44, 239], [44, 91],
    ];
    const labels = REVIEW_COMPETENCIES.map((competency, index) => `<text x="${labelPositions[index][0]}" y="${labelPositions[index][1]}" text-anchor="middle"><tspan>${competency.label}</tspan><tspan x="${labelPositions[index][0]}" dy="15">${Number(normalized[competency.key]).toFixed(1)}</tspan></text>`).join("");
    const averageLabel = Number(reviewCount).toLocaleString("ko-KR");
    return `<figure class="caregiver-competency-radar ${compact ? "compact" : ""}"><figcaption><strong>6개 전문 역량</strong><span>${averageLabel}건의 항목 평가 평균</span></figcaption><svg viewBox="0 0 360 330" role="img" aria-label="식사 ${normalized.meal_preparation.toFixed(1)}점, 세심함 ${normalized.attentiveness.toFixed(1)}점, 시간준수 ${normalized.punctuality.toFixed(1)}점, 전문성 ${normalized.professionalism.toFixed(1)}점, 소통 ${normalized.communication.toFixed(1)}점, 위생안전 ${normalized.hygiene_safety.toFixed(1)}점"><g class="competency-radar-grid">${grid}${axes}</g><polygon class="competency-radar-score" points="${scorePoints}"/>${scoreDots}${labels}</svg></figure>`;
  }

  function caregiverPublicRatingMarkup(profile, compact = false) {
    if (!profile.reviewCount || profile.averageRating == null) {
      return `<div class="caregiver-public-rating empty"><span aria-hidden="true">☆☆☆☆☆</span><strong>첫 후기를 기다리고 있어요</strong></div>`;
    }
    const rounded = Math.max(1, Math.min(5, Math.round(Number(profile.averageRating))));
    return `<div class="caregiver-public-rating" aria-label="평균 별점 ${Number(profile.averageRating).toFixed(1)}점, 후기 ${profile.reviewCount}건"><span aria-hidden="true">${"★".repeat(rounded)}${"☆".repeat(5 - rounded)}</span><strong>${Number(profile.averageRating).toFixed(1)}</strong>${compact ? "" : `<small>후기 ${Number(profile.reviewCount)}건</small>`}</div>`;
  }

  function caregiverReviewScorecardMarkup(profile) {
    if (!profile.reviewCount || profile.averageRating == null) {
      return `<div class="caregiver-review-scorecard empty"><p class="eyebrow">OVERALL RATING</p><strong>평점 준비 중</strong><span>첫 전문 역량 후기가 등록되면 종합평점이 표시됩니다.</span></div>`;
    }
    const rating = Number(profile.averageRating);
    const rounded = Math.max(1, Math.min(5, Math.round(rating)));
    return `<div class="caregiver-review-scorecard" aria-label="6개 전문 역량 종합평점 ${rating.toFixed(1)}점, 후기 ${Number(profile.reviewCount)}건"><p class="eyebrow">OVERALL RATING</p><div class="caregiver-review-score"><span aria-hidden="true">★</span><strong>${rating.toFixed(1)}</strong><small>/ 5.0</small></div><div class="caregiver-review-stars" aria-hidden="true">${"★".repeat(rounded)}${"☆".repeat(5 - rounded)}</div><p>6개 전문 역량의 평균으로 계산한 종합평점</p><span>후기 ${Number(profile.reviewCount).toLocaleString("ko-KR")}건</span></div>`;
  }

  function reviewPhotoGalleryMarkup(review, label = "후기 첨부 사진") {
    const photoUrls = Array.isArray(review?.photoUrls) ? review.photoUrls.filter(Boolean).slice(0, 3) : [];
    if (!photoUrls.length) return "";
    return `<div class="review-photo-gallery" aria-label="${escapeHtml(label)}">${photoUrls.map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)} ${index + 1} 크게 보기"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)} ${index + 1}" loading="lazy" decoding="async"/></a>`).join("")}</div>`;
  }

  function publicReviewSourceLabel(review) {
    if (review?.source === "VERIFIED_EXTERNAL") return "외부 경로 확인 후기";
    if (review?.source === "ADMIN_LEGACY") return "이전 후기 자료";
    return "ProMoms 이용 후기";
  }

  function selectedReviewPhotoFiles(form) {
    return Array.from(form?.querySelector('[name="reviewPhotos"]')?.files || []).filter((file) => file.size > 0);
  }

  function validateReviewPhotoSelection(files) {
    if (files.length > 3) return "후기 사진은 최대 3장까지 등록할 수 있습니다.";
    if (files.some((file) => !/^image\/(jpeg|png|webp)$/.test(file.type))) return "후기 사진은 JPG·PNG·WebP 형식만 등록할 수 있습니다.";
    if (files.some((file) => file.size > 5 * 1024 * 1024)) return "후기 사진은 장당 5MB 이하만 등록할 수 있습니다.";
    return "";
  }

  function bindReviewPhotoPreview(form) {
    const input = form?.querySelector('[name="reviewPhotos"]');
    const preview = form?.querySelector("[data-review-photo-preview]");
    if (!input || !preview) return;
    input.addEventListener("change", () => {
      const files = selectedReviewPhotoFiles(form);
      const error = validateReviewPhotoSelection(files);
      if (error) {
        input.value = "";
        preview.innerHTML = "";
        return showToast(error, "error");
      }
      preview.innerHTML = files.map((file, index) => `<div><img src="${URL.createObjectURL(file)}" alt="선택한 후기 사진 ${index + 1}"/><span>${escapeHtml(file.name)}</span></div>`).join("");
    });
  }

  async function reviewFilesToDataUrls(files) {
    return Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(reader.error || new Error("후기 사진을 읽지 못했습니다.")));
      reader.readAsDataURL(file);
    })));
  }

  function caregiverPublicPortraitMarkup(profile, detail = false) {
    if (profile.photoUrl) return `<img src="${escapeHtml(profile.photoUrl)}" alt="${escapeHtml(profile.photoAlt || `${profile.displayName} 관리사`)}" loading="lazy" decoding="async"/>`;
    return `<div class="caregiver-public-initials" aria-label="${escapeHtml(profile.displayName)} 관리사 사진 미등록">${escapeHtml(initialsFor(profile.displayName) || "PM")}</div>`;
  }

  function caregiverServiceBadgesMarkup(profile) {
    const allowed = new Set(["POSTPARTUM", "BABYSITTING", "MASSAGE"]);
    const capabilities = Array.isArray(profile?.serviceCapabilities)
      ? profile.serviceCapabilities.filter((serviceType) => allowed.has(serviceType))
      : ["POSTPARTUM", "BABYSITTING"];
    const uniqueCapabilities = [...new Set(capabilities)];
    if (!uniqueCapabilities.length) return "";
    const labels = {
      POSTPARTUM: { icon: "♡", label: "산후조리", tone: "postpartum" },
      BABYSITTING: { icon: "☆", label: "베이비시팅", tone: "babysitting" },
      MASSAGE: { icon: "✦", label: "마사지 테라피스트", tone: "massage" },
    };
    return `<div class="caregiver-service-badges" aria-label="관리자로부터 부여된 제공 가능 서비스">${uniqueCapabilities.map((serviceType) => { const meta = labels[serviceType]; return `<span class="${meta.tone}"><i aria-hidden="true">${meta.icon}</i>${meta.label}</span>`; }).join("")}</div>`;
  }

  function isMassageOnlyProfessional(profileOrUser) {
    if (!profileOrUser) return false;
    if (Array.isArray(profileOrUser.serviceCapabilities)) {
      const capabilities = [...new Set(profileOrUser.serviceCapabilities.filter((serviceType) => ["POSTPARTUM", "BABYSITTING", "MASSAGE"].includes(serviceType)))];
      return capabilities.length === 1 && capabilities[0] === "MASSAGE";
    }
    return Boolean(profileOrUser.isMassageTherapist)
      && profileOrUser.canProvidePostpartum === false
      && profileOrUser.canProvideBabysitting === false;
  }

  function massageProfessionalHighlightsMarkup(profile, compact = false) {
    const careerYears = Number(profile?.careerYears || 0);
    const credentials = (profile?.credentials || []).filter(Boolean).slice(0, compact ? 3 : 8);
    const specialties = (profile?.specialties || []).filter(Boolean).slice(0, compact ? 4 : 10);
    const careerItems = [careerYears > 0 ? `총 경력 ${careerYears.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}년` : null, ...credentials].filter(Boolean);
    const listMarkup = (items, emptyText) => items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p>${escapeHtml(emptyText)}</p>`;
    return `<section class="massage-professional-highlights ${compact ? "compact" : ""}" aria-label="마사지 테라피스트 이력과 전문 분야"><div><span>CAREER</span><h4>주요 이력</h4>${listMarkup(careerItems, "주요 이력을 준비하고 있습니다.")}</div><div><span>SPECIALTIES</span><h4>전문 분야</h4>${listMarkup(specialties, "전문 분야를 준비하고 있습니다.")}</div></section>`;
  }

  function publicCaregiverCardMarkup(profile) {
    const massageOnly = isMassageOnlyProfessional(profile);
    const specialties = (profile.specialties || []).slice(0, 3);
    const professionalPanel = massageOnly
      ? massageProfessionalHighlightsMarkup(profile, true)
      : caregiverCompetencyRadarMarkup(profile.competencyAverages, profile.competencyReviewCount, true)
        || `<div class="caregiver-competency-empty compact"><strong>전문 역량 후기 준비 중</strong><span>첫 후기가 등록되면 6개 역량 평균이 표시됩니다.</span></div>`;
    const ratingMarkup = massageOnly ? `<span class="massage-professional-label">LMT PROFESSIONAL</span>` : caregiverPublicRatingMarkup(profile, true);
    return `<article class="public-caregiver-profile-card ${profile.featured ? "featured" : ""} ${massageOnly ? "massage-only" : ""}"><div class="caregiver-public-card-top"><div class="caregiver-public-photo">${caregiverPublicPortraitMarkup(profile)}</div><div class="caregiver-public-card-summary"><div class="caregiver-public-name"><div><small>${profile.featured ? "FEATURED CARE PROFESSIONAL" : "CARE PROFESSIONAL"}</small><h3>${escapeHtml(profile.displayName)}</h3></div>${ratingMarkup}</div><p class="caregiver-public-headline">${escapeHtml(profile.headline)}</p>${caregiverServiceBadgesMarkup(profile)}</div></div><div class="caregiver-public-card-copy"><div class="caregiver-public-facts"><span>경력 ${Number(profile.careerYears || 0).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}년</span>${profile.serviceArea ? `<span>${escapeHtml(profile.serviceArea)}</span>` : ""}</div>${massageOnly ? "" : `<div class="caregiver-public-tags">${specialties.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`}<div class="caregiver-public-radar-slot">${professionalPanel}</div><p class="caregiver-public-bio">${escapeHtml(profile.biography || (massageOnly ? "산전·산후 회복을 전문적으로 지원하는 ProMoms 마사지 테라피스트입니다." : "가족의 돌봄 필요를 세심하게 살피는 ProMoms 관리사입니다."))}</p><button type="button" class="secondary-button" data-public-caregiver-detail="${profile.caregiverId}">${massageOnly ? "테라피스트 프로필 보기" : "프로필·후기 보기"}</button></div></article>`;
  }

  function publicCaregiverDirectoryMarkup() {
    const caregivers = (state.publicCaregivers || []).filter((profile) => profile.isPublished !== false);
    if (caregivers.length) return `<div class="public-caregiver-carousel"><div class="public-caregiver-carousel-toolbar"><div><strong>${caregivers.length}명의 관리사</strong><span>카드를 좌우로 넘겨 비교해 보세요.</span></div><div class="public-caregiver-carousel-controls" aria-label="관리사 카드 이동"><button type="button" data-caregiver-carousel="-1" aria-label="이전 관리사">←</button><button type="button" data-caregiver-carousel="1" aria-label="다음 관리사">→</button></div></div><div class="public-caregiver-profile-grid" data-caregiver-carousel-track tabindex="0" aria-label="ProMoms 관리사 소개 카드 목록">${caregivers.map(publicCaregiverCardMarkup).join("")}</div><p class="public-caregiver-carousel-hint" aria-hidden="true"><span>↔</span> 가로로 밀어서 더 많은 관리사를 확인할 수 있습니다.</p></div>`;
    return `<div class="public-caregiver-grid trust-fallback"><article><div class="public-person-art mint">✓</div><h3>신원·경력 확인</h3><span>IDENTITY & EXPERIENCE</span><p>지원 서류와 경력 정보를 확인하고 승인된 계정만 배정 후보에 포함합니다.</p></article><article><div class="public-person-art blush">CPR</div><h3>자격·안전 기준</h3><span>CREDENTIALS & SAFETY</span><p>서비스에 필요한 교육과 자격, 만료일을 확인한 뒤 업무 범위를 구분합니다.</p></article><article><div class="public-person-art mint">↔</div><h3>일정·가정 맞춤 배정</h3><span>SCHEDULE & FAMILY FIT</span><p>서비스 유형, 지역, 요일과 시간의 실제 가용성을 확인해 중복 없이 배정합니다.</p></article></div>`;
  }

  const PUBLIC_SERVICE_DETAILS = Object.freeze({
    POSTPARTUM_COMMUTE: {
      eyebrow: "POSTPARTUM · COMMUTE",
      icon: "♡",
      tone: "postpartum",
      title: "산후조리 출퇴근형",
      summary: "정해진 시간에 가정을 방문해 산모의 일상 회복과 신생아 돌봄을 함께 지원하는 비의료 생활 케어입니다.",
      facts: ["2·3·4주 선택", "하루 8시간", "주당 $1,800"],
      prices: ["2주 $3,600", "3주 $5,400", "4주 $7,200", "예약금 $500"],
      sections: [
        { title: "산모 일상 회복 지원", items: ["산모의 휴식 시간을 확보할 수 있도록 일상 동선과 케어 순서를 조율합니다.", "산모 중심의 간단한 식사 준비와 수분 섭취, 생활 리듬을 지원합니다.", "출산 후 적응 과정의 정서적 지지와 필요한 지역 전문기관 안내를 제공합니다."] },
        { title: "신생아 케어", items: ["보호자가 정한 방식에 따라 수유 보조, 트림, 기저귀 교체, 달래기와 수면 환경 정돈을 돕습니다.", "목욕·배꼽·피부 케어는 보호자 지침과 관리사의 교육 범위 안에서 시행합니다.", "수유·수면·배변·체온 등 객관적인 일상 기록을 앱으로 공유합니다."] },
        { title: "아기 중심 가정 지원", items: ["젖병·수유용품 세척과 소독, 아기 의류 및 산모 관련 가벼운 세탁·정리를 포함합니다.", "산모와 아기가 사용하는 공간의 가벼운 정돈을 지원합니다.", "가족 전체 식사, 대청소, 이사 정리와 전문 청소는 기본 서비스에 포함되지 않습니다."] },
        { title: "전문 서비스 경계", items: ["진단·처방·상처 처치·투약 판단 등 의료행위는 제공하지 않습니다.", "산모 또는 아기에게 발열, 호흡곤란, 출혈 등 우려 증상이 있으면 보호자에게 즉시 알리고 의료기관 이용을 권합니다.", "형제자매 돌봄, 반려동물 관리, 장거리 운전과 심부름은 사전 계약 없이 제공하지 않습니다."] },
      ],
      rules: ["기본 2주이며 2주·3주·4주 중 선택합니다.", "하루 8시간 기준이며 식사 1시간과 휴식 30분이 포함됩니다.", "일정 변경은 취소가 아니므로 예약금 페널티가 없으며 관리자 승인 후 반영됩니다.", "시작 30일 전까지 취소하면 $500 예약금 환불 대상이며, 시작 30일 이내에는 예약금이 환불되지 않습니다.", "서비스 시작 후 취소 시 정산 단가는 (당초 총 서비스 예정비용 − 예약금) ÷ 잔여 케어일수로 산정하며 예약금은 환불되지 않습니다."],
      note: "ProMoms 산후조리는 의료 서비스가 아닙니다. 관리사는 관찰된 사실을 기록하고, 의료적 판단이 필요한 상황은 고객의 담당 의료진에게 연결하도록 안내합니다.",
    },
    POSTPARTUM_LIVE_IN: {
      eyebrow: "POSTPARTUM · LIVE-IN",
      icon: "⌂",
      tone: "live-in",
      title: "산후조리 입주형",
      summary: "관리사가 가정에 머물며 합의된 근무표에 따라 산모와 신생아의 생활 리듬을 집중적으로 지원하는 장기 케어입니다.",
      facts: ["기본 4주", "주당 $2,100", "입주 일정 협의"],
      prices: ["4주 $8,400", "연장 시 주당 $2,100", "예약금 $500"],
      sections: [
        { title: "집중 산후 케어", items: ["산모의 휴식·식사·회복 루틴과 신생아 수유·수면·배변 흐름을 함께 관리합니다.", "가족의 선호와 아기의 반응을 반영해 일별 케어 계획을 조정합니다.", "근무 중 확인한 객관적 기록을 보호자에게 인계하고 앱에 저장합니다."] },
        { title: "신생아·수유 지원", items: ["모유·유축모유·분유 등 보호자가 선택한 수유 방식을 존중해 비의료적 보조를 제공합니다.", "젖병과 수유용품 세척·소독, 트림, 달래기와 안전한 수면 환경 정돈을 지원합니다.", "수유 어려움이나 건강 우려가 있으면 소아과·산부인과·IBCLC 등 적절한 전문가 상담을 권합니다."] },
        { title: "입주 운영 기준", items: ["입주형은 24시간 연속 근무를 의미하지 않으며 근무·휴식·수면시간과 휴무일을 계약서에 명확히 정합니다.", "고객은 관리사가 안전하게 쉴 수 있는 독립적이고 위생적인 수면 공간을 제공합니다.", "가족 구성, 출입 방식, 주차, 식사와 주거 규칙은 배정 확정 전에 관리자와 협의합니다."] },
        { title: "포함하지 않는 업무", items: ["의료행위, 전문 간호, 야간 무제한 호출, 가족 전체 가사와 전문 청소는 포함되지 않습니다.", "형제자매의 단독 돌봄과 반려동물 관리는 별도 서비스 협의가 필요합니다.", "계약 범위를 넘는 추가 업무는 관리자 승인 없이 관리사에게 직접 요청할 수 없습니다."] },
      ],
      rules: ["기본 계약은 4주이며 관리사 가용 일정과 가정의 입주 조건을 확인한 뒤 확정합니다.", "일정 변경에는 예약금 페널티가 없으며 근무표·휴무일 변경은 관리자 승인이 필요합니다.", "시작 30일 전까지 취소하면 $500 예약금 환불 대상이며, 시작 30일 이내에는 예약금이 환불되지 않습니다.", "서비스 시작 후 취소 시 정산 단가는 (당초 총 서비스 예정비용 − 예약금) ÷ 잔여 케어일수로 산정하며 예약금은 환불되지 않습니다.", "응급상황에서는 관리사가 의료 판단을 대신하지 않으며 911 또는 지정 의료진·보호자 연락 절차를 따릅니다."],
      note: "입주형 서비스의 세부 근무시간, 휴게·수면시간, 휴무일과 제공 공간은 가정별 계약서에 최종 확정됩니다.",
    },
    BABYSITTING: {
      eyebrow: "BABYSITTING",
      icon: "☆",
      tone: "babysitting",
      title: "베이비시팅",
      summary: "보호자의 생활 지침에 따라 아이의 식사·놀이·휴식과 안전을 돌보고 주요 일상을 기록해 인계하는 방문 서비스입니다.",
      facts: ["시간당 $32", "하루 최소 4시간", "산후조리와 별도 신청"],
      prices: ["최소 4시간 $128", "추가 시간당 $32", "예약금 $128"],
      sections: [
        { title: "아이 일상 케어", items: ["보호자가 준비한 식사·간식 지침에 따른 식사 보조와 정리를 지원합니다.", "연령에 맞는 놀이, 책 읽기, 산책, 낮잠과 등원·하원 인계를 지원합니다.", "기저귀·배변, 식사, 수면과 활동 이벤트를 객관적으로 기록합니다."] },
        { title: "안전과 인계", items: ["알레르기, 비상연락처, 출입·픽업 권한과 가정별 안전수칙을 서비스 전에 확인합니다.", "보호자가 지정한 사람에게만 아이를 인계하며 변경 사항은 확인 가능한 방식으로 전달받습니다.", "사고·이상 증상이 발생하면 보호자에게 즉시 알리고 합의된 응급 절차를 따릅니다."] },
        { title: "가정 내 업무 범위", items: ["아이에게 사용한 식기·장난감·놀이 공간의 가벼운 정리를 포함합니다.", "가족 전체 식사 준비, 대청소, 반려동물 관리와 서비스 대상이 아닌 아동의 돌봄은 포함되지 않습니다.", "약 투여, 의료 판단과 침습적 처치는 제공하지 않습니다."] },
        { title: "신청과 배정", items: ["산후조리 이용 이력이 없어도 베이비시팅만 별도로 신청할 수 있습니다.", "동일 아기가 산후조리 서비스를 진행 중인 시간에는 중복 신청할 수 없습니다.", "고객 신청 후 관리자가 아이 정보, 일정과 가능한 관리사를 확인해 최종 배정합니다."] },
      ],
      rules: ["한 번의 방문은 최소 4시간이며 예약금은 4시간분인 $128입니다.", "서비스 시작 72시간 이전 취소 시 예약금은 환불 대상입니다.", "시작 72시간 이내 취소와 노쇼는 예약금이 환불되지 않습니다.", "연장 요청은 관리사의 다음 일정과 보호자 승인을 모두 확인한 뒤 확정합니다.", "예약 시간, 서비스 대상 아동 수 또는 주소가 달라지면 요금과 배정 가능 여부를 다시 확인할 수 있습니다."],
      note: "베이비시팅은 보호자의 양육 결정을 대신하지 않습니다. 아이의 식사·수면·외출 방식은 사전에 저장된 보호자 지침을 우선합니다.",
    },
    MASSAGE: {
      eyebrow: "PRENATAL · POSTPARTUM MASSAGE",
      icon: "✦",
      tone: "massage",
      title: "산전·산후 마사지",
      summary: "주 정부 면허를 보유하고 산전·산후 전문 권한을 부여받은 테라피스트가 고객 상태를 확인한 뒤 제공하는 비의료적 맞춤 마사지입니다.",
      facts: ["60분·90분", "LMT 배정", "관리자 승인 후 확정"],
      prices: ["일반 60분 $150 · 90분 $210", "산후조리 고객 60분 $135 · 90분 $190", "산후조리 고객 60분 4회 $520"],
      sections: [
        { title: "산전 마사지", items: ["임신 주수와 담당 의료진의 주의사항을 확인하고 옆으로 눕는 자세 등 편안한 체위를 사용합니다.", "목·어깨·등·골반 주변과 다리 등 임신 중 긴장되기 쉬운 부위를 고객 동의 범위에서 부드럽게 관리합니다.", "고위험 임신이나 의학적 우려가 있으면 예약 전 담당 산부인과의 확인을 요청할 수 있습니다."] },
        { title: "산후 회복 마사지", items: ["출산 방식, 회복 단계, 수술·상처 상태와 고객이 불편하게 느끼는 부위를 사전에 확인합니다.", "목·어깨·등·팔·다리 등 육아와 수유 자세로 긴장되기 쉬운 부위를 중심으로 강도를 조절합니다.", "제왕절개 또는 산후 합병증이 있거나 의료진의 제한이 있는 경우 담당 의료진의 허용 범위 안에서 진행합니다."] },
        { title: "수유기 편안함 케어", items: ["한국의 맞춤형 유방관리 서비스에서 강조하는 1:1 상태 확인 방식을 참고해 수유 자세와 상체 긴장 부위를 먼저 확인합니다.", "ProMoms LMT 서비스는 등·어깨·목·팔 등 주변부 이완을 중심으로 하며 유방 직접 관리나 유선 막힘·유선염 치료는 제공하지 않습니다.", "유방 통증, 붉음, 열감, 멍울 또는 발열이 있으면 산부인과·주치의·IBCLC 상담을 우선 안내합니다."] },
        { title: "안전 확인과 제외 기준", items: ["혈전 의심 증상, 발열·감염, 활동성 출혈, 조절되지 않는 고혈압, 급성 피부질환이나 의료진의 마사지 제한이 있으면 서비스를 연기합니다.", "테라피스트는 사전 문진과 당일 상태에 따라 부위·압력·자세를 변경하거나 안전상 서비스를 중단할 수 있습니다.", "마사지는 진단·치료·산후 의료관리 또는 모유수유 전문상담을 대신하지 않습니다."] },
      ],
      rules: ["마사지 테라피스트가 매주 등록한 09:00–20:00 근무 가능시간에서 고객이 희망 슬롯을 선택합니다.", "이동 시간을 고려해 확정된 예약 전후 1시간은 같은 테라피스트의 다른 고객에게 표시되지 않습니다.", "고객 신청 후 관리자가 테라피스트의 전체 돌봄 일정을 확인하고 승인해야 확정됩니다.", "변경·취소는 시작 24시간 이전까지 요청할 수 있으며 관리자 승인 후 반영됩니다.", "산후조리 우대 가격은 승인된 산후조리 예약 또는 이용 상태가 확인된 고객에게 적용됩니다."],
      note: "마사지 전 건강 문진에 정확한 정보를 입력해 주세요. 급성 통증이나 질환이 의심되면 마사지 예약보다 의료기관 상담이 우선입니다.",
    },
  });

  function openPublicServiceDetail(serviceKey) {
    const detail = PUBLIC_SERVICE_DETAILS[serviceKey];
    if (!detail) return showToast("서비스 상세정보를 찾을 수 없습니다.", "error");
    const sectionMarkup = detail.sections.map((section) => `<section class="public-service-detail-section"><h4>${escapeHtml(section.title)}</h4><ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`).join("");
    const rulesMarkup = detail.rules.map((rule, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(rule)}</p></li>`).join("");
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal public-service-detail-modal ${detail.tone}" role="dialog" aria-modal="true" aria-labelledby="public-service-detail-title"><header class="modal-header"><div class="modal-title-wrap"><span class="public-service-detail-icon" aria-hidden="true">${detail.icon}</span><div><p class="eyebrow">${escapeHtml(detail.eyebrow)}</p><h3 id="public-service-detail-title">${escapeHtml(detail.title)}</h3><p>${escapeHtml(detail.summary)}</p></div></div><button class="close-button" type="button" data-close-modal aria-label="서비스 상세정보 닫기">×</button></header><div class="public-service-detail-body"><div class="public-service-detail-summary"><div class="public-service-detail-facts">${detail.facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}</div><div class="public-service-detail-prices">${detail.prices.map((price) => `<strong>${escapeHtml(price)}</strong>`).join("")}</div></div><div class="public-service-detail-grid">${sectionMarkup}</div><section class="public-service-detail-rules"><div><p class="eyebrow">BOOKING & SERVICE RULES</p><h4>예약·변경·이용 규칙</h4></div><ol>${rulesMarkup}</ol></section><div class="public-service-detail-note"><strong>서비스 범위 안내</strong><p>${escapeHtml(detail.note)}</p></div></div><div class="public-service-detail-footer"><button type="button" class="primary-button" data-close-modal>내용 확인</button></div></section></div>`;
    bindModalFrame();
  }

  function publicSiteMarkup() {
    const user = authUser();
    const clientUser = userHasAccessRole(user, "CLIENT");
    const publicClient = clientUser ? clientForUser(user.id) : null;
    const defaultApplicationType = defaultServiceApplicationType(publicClient);
    const defaultApplicationLabel = defaultApplicationType === "BABYSITTING" ? "베이비시팅 미리 신청" : "서비스 신청";
    const accountActions = publicAccountActionsMarkup(user, clientUser, defaultApplicationType, defaultApplicationLabel);
    return `<div class="public-site">
      <header class="public-header"><a class="public-brand" href="#home" data-public-anchor="home"><span class="promoms-mark">${brandLogoMarkup()}</span><div><strong>ProMoms</strong><small>엄마 곁의 전문가</small></div></a><button class="public-menu-toggle" type="button" data-public-menu-toggle aria-expanded="false" aria-controls="public-site-nav" aria-label="메뉴 열기">☰</button><nav class="public-nav" id="public-site-nav" aria-label="사이트 주요 메뉴"><button data-public-anchor="about">회사 소개</button><button data-public-anchor="services">서비스</button><button data-public-anchor="caregivers">관리사 안내</button><button data-public-anchor="shop-preview">스토어</button><button data-public-anchor="location">서비스 지역</button><button data-public-anchor="contact">Contact</button><div class="public-nav-account">${accountActions}</div></nav><div class="public-account-actions">${accountActions}</div></header>
      <main>
        <section class="public-hero" id="home"><div class="public-hero-copy"><p class="eyebrow">ProMoms PROFESSIONAL FAMILY CARE</p><h1>회복의 시간부터<br/><em>아이의 일상까지.</em></h1><p>전문가의 믿음직한 손길과 엄마의 따뜻한 마음. 산후조리 케어, 베이비 케어, 맘스 뷰티를 ProMoms에서 만나보세요.</p><div class="public-hero-actions"><button class="primary-button public-cta" data-service-apply="${defaultApplicationType}">${defaultApplicationType === "BABYSITTING" ? "베이비시팅 미리 신청" : "서비스 신청하기"}</button><button class="secondary-button public-cta" data-public-anchor="services">서비스 살펴보기</button></div></div><div class="public-hero-visual promoms-hero">${brandLogoMarkup(true)}<p class="promoms-brand-lines">POSTPARTUM CARE · BABY CARE · MOMS BEAUTY</p></div></section>
        <div class="public-content">${publicServiceStatusMarkup(user)}
          <section class="public-section public-about" id="about"><div class="public-section-heading"><p class="eyebrow">ABOUT ProMoms</p><h2>가족에게 필요한 케어를<br/>더 투명하고 책임 있게.</h2></div><div class="about-story"><p>ProMoms는 조지아 애틀랜타 메트로 지역의 가족을 중심으로 산모의 회복, 아이의 안전한 돌봄, 생활에 필요한 제품까지 연결하는 패밀리 웰니스 서비스입니다. W-2 직접 고용과 회사 차원의 책임보상보험·근로자재해보험 운영을 원칙으로 삼아 고객에게 고용 및 업무상 재해 리스크를 전가하지 않는 체계를 지향합니다.</p><div class="about-metrics"><div><strong>W-2</strong><span>직접 고용 운영 원칙</span></div><div><strong>Company</strong><span>보험 책임 회사 관리</span></div><div><strong>Atlanta</strong><span>메트로 지역 방문 케어</span></div></div></div></section>
          <section class="public-section" id="services"><div class="public-section-heading centered"><p class="eyebrow">OUR SERVICES</p><h2 class="services-heading-title">원하시는 돌봄 서비스를 확인하세요</h2><p>산후조리, 베이비시팅, 마사지 서비스의 기준과 가격을 확인할 수 있습니다. 상품에 대한 자세한 설명은 '자세히' 버튼을 눌러주세요.</p></div><div class="public-service-scroll-shell"><div class="public-service-grid" aria-label="ProMoms 서비스 패키지"><article class="public-service-card featured"><span class="service-number">01</span><div class="service-symbol">♡</div><p class="eyebrow">POSTPARTUM · COMMUTE</p><h3>산후조리 출퇴근형</h3><p>정해진 시간에 방문하여 산모 회복과 신생아 일상 케어를 제공합니다.</p><ul><li>기본 2주부터 시작</li><li>2주 · 3주 · 4주 선택</li><li>하루 케어 8시간 기준</li><li>식사 1시간·휴식 30분 포함</li></ul><div class="service-price"><span>주당</span><strong>$1,800<small> · 2주 $3,600</small></strong></div><div class="public-service-card-actions"><button type="button" class="secondary-button" data-public-service-detail="POSTPARTUM_COMMUTE">자세히</button><button type="button" class="primary-button" data-service-apply="POSTPARTUM" data-postpartum-mode="COMMUTE">출퇴근형 신청</button></div></article><article class="public-service-card live-in"><span class="service-number">02</span><div class="service-symbol">⌂</div><p class="eyebrow">POSTPARTUM · LIVE-IN</p><h3>산후조리 입주형</h3><p>집중적인 회복과 신생아 케어가 필요한 가족을 위한 입주형 서비스입니다.</p><ul><li>기본 4주부터 시작</li><li>입주 일정·휴무일 관리자 협의</li><li>산모·신생아 통합 케어</li><li>관리사 일정 확인 후 확정</li></ul><div class="service-price"><span>주당</span><strong>$2,100<small> · 4주 $8,400</small></strong></div><div class="public-service-card-actions"><button type="button" class="secondary-button" data-public-service-detail="POSTPARTUM_LIVE_IN">자세히</button><button type="button" class="primary-button" data-service-apply="POSTPARTUM" data-postpartum-mode="LIVE_IN">입주형 신청</button></div></article><article class="public-service-card"><span class="service-number">03</span><div class="service-symbol">☆</div><p class="eyebrow">BABYSITTING</p><h3>베이비시팅</h3><p>식사, 놀이, 산책과 생활 이벤트를 보호자에게 정확하게 공유합니다.</p><ul><li>시간당 단일 요금</li><li>하루 최소 4시간</li><li>산후조리와 별개 신청 가능</li><li>4시간분 예약금 $128</li></ul><div class="service-price"><span>시간당</span><strong>$32<small> · 최소 4시간</small></strong></div><div class="public-service-card-actions"><button type="button" class="secondary-button" data-public-service-detail="BABYSITTING">자세히</button><button type="button" class="primary-button" data-service-apply="BABYSITTING">베이비시팅 신청</button></div></article><article class="public-service-card massage"><span class="service-number">04</span><div class="service-symbol">✦</div><p class="eyebrow">PRENATAL · POSTPARTUM MASSAGE</p><h3>산전·산후 마사지</h3><p>전문 자격이 부여된 테라피스트의 산후/산전 마사지 서비스</p><div class="massage-price-table"><div><span>일반 고객</span><strong>60분 $150 · 90분 $210</strong></div><div><span>산후조리 예약·이용 고객</span><strong>60분 $135 · 90분 $190</strong></div><div><span>산후조리 고객 4회권</span><strong>60분 × 4회 $520</strong></div></div><div class="service-price massage-license"><strong>LMT(주 정부 면허) 보유 테라피스트</strong></div><div class="public-service-card-actions"><button type="button" class="secondary-button" data-public-service-detail="MASSAGE">자세히</button><button type="button" class="primary-button" data-massage-book>마사지 예약</button></div></article></div><p class="horizontal-scroll-hint" aria-hidden="true">← 좌우로 넘겨 모든 패키지 보기 →</p></div></section>
          <section class="public-section public-caregiver-section" id="caregivers"><div class="public-section-heading"><p class="eyebrow">MEET OUR CARE PROFESSIONALS</p><h2>경력과 고객 경험이 풍부한 최고의 ProMoms 관리사를 소개합니다.</h2></div>${publicCaregiverDirectoryMarkup()}</section>
          <section class="public-section" id="shop-preview"><div class="public-section-heading public-shop-heading"><div><p class="eyebrow">ProMoms SELECT · COMING SOON</p><h2>Beauty & Baby Store</h2><p>상품·결제·재고 운영 체계가 준비된 뒤 별도 스토어로 선보일 예정입니다.</p></div><button class="secondary-button" disabled>출시 준비 중</button></div><div class="store-readiness-note"><strong>지금은 돌봄 서비스 신청과 기록 기능만 운영합니다.</strong><span>샘플 상품이나 재고를 실제 판매 상품처럼 표시하지 않습니다.</span></div></section>
          <section class="public-section public-location" id="location"><div class="location-card"><p class="eyebrow">SERVICE AREA</p><h2>Atlanta Metro 방문 케어</h2><p>고객의 서비스 주소와 일정, 관리사 이동 가능 범위를 확인한 뒤 방문 가능 여부를 안내합니다.</p><dl><div><dt>기본 지역</dt><dd>Atlanta Metro, Georgia</dd></div><div><dt>상담 방식</dt><dd>전화 상담 후 일정·주소 확인</dd></div><div><dt>방문 안내</dt><dd>신청 승인 전 최종 서비스 가능 지역을 확인합니다.</dd></div></dl><a class="primary-button public-link-button" href="tel:+14704049467">전화로 가능 지역 문의</a></div><div class="location-map" role="img" aria-label="Atlanta Metro 방문 서비스 지역 안내"><div class="map-road road-one"></div><div class="map-road road-two"></div><div class="map-pin"><span class="promoms-mark">${brandLogoMarkup()}</span><strong>ProMoms</strong></div><small>Atlanta Metro · Georgia</small></div></section>
          <section class="public-section public-contact" id="contact"><div><p class="eyebrow">CONTACT US</p><h2>돌봄이 필요한 순간,<br/>편하게 이야기해 주세요.</h2></div><div class="contact-methods"><a href="tel:+14704049467"><span>☎</span><div><small>전화 상담</small><strong>470-404-9467</strong></div></a><button data-notice="이메일 문의 채널은 운영 주소 확정 후 안내합니다. 현재는 전화로 문의해 주세요."><span>✉</span><div><small>이메일 문의</small><strong>채널 준비 중</strong></div></button><button data-notice="Atlanta Metro 내 상세 방문 가능 여부는 서비스 주소와 일정을 확인한 뒤 안내합니다."><span>GA</span><div><small>서비스 지역</small><strong>Atlanta Metro</strong></div></button></div></section>
        </div>
      </main><footer class="public-footer"><div class="public-brand inverse"><span class="promoms-mark">${brandLogoMarkup()}</span><div><strong>ProMoms</strong><small>엄마 곁의 전문가</small></div></div><p>© 2026 ProMoms. All rights reserved.</p><div><button data-auth-screen="login">직원 로그인</button></div></footer>
    </div>`;
  }

  function openPublicCaregiverDetail(caregiverId) {
    const profile = (state.publicCaregivers || []).find((item) => item.caregiverId === caregiverId && item.isPublished !== false);
    if (!profile) return showToast("공개된 관리사 프로필을 찾을 수 없습니다.", "error");
    const massageOnly = isMassageOnlyProfessional(profile);
    const reviews = (profile.reviews || []).slice(0, 8);
    const reviewsMarkup = reviews.length
      ? reviews.map((review) => `<article><div>${reviewOverallRatingMarkup(review)}<span>${escapeHtml(review.reviewerLabel || "서비스 이용 고객")} · ${publicReviewSourceLabel(review)}</span></div>${reviewCompetencySummaryMarkup(review.competencyScores)}<p>${escapeHtml(review.comment)}</p>${reviewPhotoGalleryMarkup(review)}${review.tags?.length ? `<div class="caregiver-public-tags">${review.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}<small>${review.serviceType ? serviceMetaFor(review.serviceType).label : "돌봄 서비스"}${review.serviceDate ? ` · ${formatDate(review.serviceDate)}` : ""}</small></article>`).join("")
      : `<div class="empty-state"><strong>아직 선정된 공개 후기가 없습니다.</strong><span>유효한 ProMoms 이용 후기와 근거가 확인된 외부 경로 후기는 원문 공개 여부와 별개로 통합 평균에 반영됩니다.</span></div>`;
    const professionalSection = massageOnly
      ? `<section class="massage-professional-detail"><div class="caregiver-review-insights-heading"><p class="eyebrow">MASSAGE PROFESSIONAL</p><h4>이력과 전문 분야</h4><p>평점이 아닌 전문 자격, 경력과 마사지 서비스 분야를 안내합니다.</p></div>${massageProfessionalHighlightsMarkup(profile)}</section>`
      : `<section class="caregiver-review-insights"><div class="caregiver-review-insights-heading"><p class="eyebrow">CARE SKILLS</p><h4>전문 역량</h4><p>후기에 입력된 식사·세심함·시간준수·전문성·소통·위생안전 점수를 한눈에 비교합니다.</p></div><div class="caregiver-review-radar-stage">${caregiverCompetencyRadarMarkup(profile.competencyAverages, profile.competencyReviewCount)}</div>${caregiverReviewScorecardMarkup(profile)}</section>`;
    const profileDetails = massageOnly
      ? `<section class="caregiver-public-profile-details massage-only-details"><div><h4>사용 언어</h4><p>${escapeHtml((profile.languages || []).join(" · ") || "등록 준비 중")}</p></div><div><h4>서비스 지역</h4><p>${escapeHtml(profile.serviceArea || "등록 준비 중")}</p></div></section>`
      : `<section class="caregiver-public-profile-details"><div><h4>전문분야</h4><div class="caregiver-public-tags">${(profile.specialties || []).length ? profile.specialties.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : "<span>등록 준비 중</span>"}</div></div><div><h4>자격·교육</h4><ul class="caregiver-credential-list">${(profile.credentials || []).length ? profile.credentials.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>등록 준비 중</li>"}</ul></div><div><h4>사용 언어</h4><p>${escapeHtml((profile.languages || []).join(" · ") || "등록 준비 중")}</p></div></section>`;
    const reviewSection = massageOnly ? "" : `<section class="caregiver-public-reviews"><div class="section-header"><div><p class="eyebrow">CUSTOMER REVIEWS</p><h4>공개 후기</h4></div></div>${reviewsMarkup}</section>`;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal caregiver-public-detail-modal ${massageOnly ? "massage-only" : ""}" role="dialog" aria-modal="true" aria-labelledby="caregiver-public-detail-title"><header class="modal-header"><div><p class="eyebrow">${massageOnly ? "MASSAGE THERAPIST" : "CARE PROFESSIONAL"}</p><h3 id="caregiver-public-detail-title">${escapeHtml(profile.displayName)} ${massageOnly ? "테라피스트" : "관리사"}</h3><p>${escapeHtml(profile.headline)}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><div class="caregiver-public-detail-body"><div class="caregiver-public-detail-hero"><div class="caregiver-public-detail-photo">${caregiverPublicPortraitMarkup(profile, true)}</div><div><h4>${escapeHtml(profile.displayName)}</h4><p>${escapeHtml(profile.biography || (massageOnly ? "산전·산후 회복을 전문적으로 지원하는 ProMoms 마사지 테라피스트입니다." : "가족의 돌봄 필요를 세심하게 살피는 ProMoms 관리사입니다."))}</p><div class="caregiver-public-facts"><span>경력 ${Number(profile.careerYears || 0).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}년</span>${profile.serviceArea ? `<span>${escapeHtml(profile.serviceArea)}</span>` : ""}</div><div class="caregiver-public-detail-services"><small>제공 가능한 서비스</small>${caregiverServiceBadgesMarkup(profile)}</div></div></div>${professionalSection}${profileDetails}${reviewSection}</div><div class="modal-footer"><button type="button" class="primary-button" data-close-modal>확인</button></div></section></div>`;
    bindModalFrame();
  }

  function bindPublicEvents() {
    bindAuthEvents();
    const menuToggle = document.querySelector("[data-public-menu-toggle]");
    const publicNav = document.querySelector("#public-site-nav");
    const setPublicMenuOpen = (open) => {
      publicNav?.classList.toggle("is-open", open);
      menuToggle?.setAttribute("aria-expanded", String(open));
      menuToggle?.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
      if (menuToggle) menuToggle.textContent = open ? "×" : "☰";
    };
    menuToggle?.addEventListener("click", () => {
      setPublicMenuOpen(!publicNav?.classList.contains("is-open"));
    });
    document.querySelectorAll("[data-public-anchor]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); const target = document.getElementById(button.dataset.publicAnchor); setPublicMenuOpen(false); target?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    const publicSite = document.querySelector(".public-site");
    publicSite?.addEventListener("keydown", (event) => { if (event.key === "Escape") setPublicMenuOpen(false); });
    publicSite?.addEventListener("click", (event) => { if (publicNav?.classList.contains("is-open") && !event.target.closest(".public-header")) setPublicMenuOpen(false); });
    document.querySelectorAll("[data-public-service-detail]").forEach((button) => button.addEventListener("click", () => openPublicServiceDetail(button.dataset.publicServiceDetail)));
    document.querySelectorAll("[data-service-apply]").forEach((button) => button.addEventListener("click", () => { const user = authUser(); if (!user) { state.auth.screen = "signup"; saveState(); render(); return; } if (!userHasAccessRole(user, "CLIENT")) return showToast("서비스 신청은 고객 권한이 있는 계정에서 이용할 수 있습니다."); openServiceApplicationModal(button.dataset.serviceApply || null, "NEW", null, button.dataset.postpartumMode || "COMMUTE"); }));
    document.querySelectorAll("[data-massage-book]").forEach((button) => button.addEventListener("click", openMassageBookingModal));
    document.querySelectorAll("[data-my-service]").forEach((button) => button.addEventListener("click", enterClientPortal));
    document.querySelectorAll("[data-enter-portal]").forEach((button) => button.addEventListener("click", () => { state.auth.screen = "portal"; saveState(); render(); }));
    document.querySelectorAll("[data-public-caregiver-detail]").forEach((button) => button.addEventListener("click", () => openPublicCaregiverDetail(button.dataset.publicCaregiverDetail)));
    document.querySelectorAll("[data-caregiver-carousel]").forEach((button) => button.addEventListener("click", () => {
      const track = document.querySelector("[data-caregiver-carousel-track]");
      const card = track?.querySelector(".public-caregiver-profile-card");
      if (!track) return;
      const distance = (card?.getBoundingClientRect().width || track.clientWidth * 0.82) + 20;
      track.scrollBy({ left: Number(button.dataset.caregiverCarousel) * distance, behavior: "smooth" });
    }));
    document.querySelectorAll("[data-open-client-shop]").forEach((button) => button.addEventListener("click", () => { state.views.client = "shop"; state.auth.screen = "portal"; saveState(); render(); }));
    document.querySelectorAll("[data-notice], [data-demo-action]").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.notice || button.dataset.demoAction, "info")));
  }

  function enterClientPortal() {
    const user = authUser();
    if (!user) { state.auth.screen = "login"; saveState(); render(); return; }
    if (!userHasAccessRole(user, "CLIENT")) return showToast("고객 작업공간에 접근할 권한이 없습니다.", "error");
    state.role = "client";
    state.views.client = "services";
    state.auth.screen = "portal";
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function authMarkup() {
    if (state.auth.screen === "public") return publicSiteMarkup();
    if (state.auth.screen === "signup") return signupMarkup();
    if (state.auth.screen === "forgot-password") return forgotPasswordMarkup();
    if (state.auth.screen === "reset-password") return resetPasswordMarkup();
    return loginMarkup();
  }

  function loginMarkup() {
    return `<main class="auth-page">
      <section class="auth-brand-panel">
        <div class="auth-brand"><div class="brand-mark">${brandLogoMarkup()}</div><div><strong>ProMoms</strong><span>CARE · BABY · BEAUTY</span></div></div>
        <div class="auth-story"><p class="eyebrow">CARE · FAMILY · TRUST</p><h1>Care that connects<br/>every moment.</h1><p>케어 기록부터 가족의 안심과 운영까지 하나의 안전한 플랫폼에서 연결합니다.</p></div>
        <div class="auth-security">◈ 계정 역할과 배정 관계에 따라 접근 가능한 정보가 제한됩니다.</div>
      </section>
      <section class="auth-form-panel">
        <div class="auth-card"><p class="eyebrow">WELCOME BACK</p><h2>로그인</h2><p class="auth-lead">가입한 이메일과 비밀번호로 안전하게 로그인하세요.</p>
          <form data-login-form class="auth-form">
            <div class="field"><label for="login-id">이메일</label><input id="login-id" name="identifier" type="email" inputmode="email" autocomplete="username" placeholder="name@email.com" required /></div>
            <div class="field"><label for="login-password">비밀번호</label><input id="login-password" name="password" type="password" autocomplete="current-password" required /></div>
            <button class="auth-inline-action" type="button" data-auth-screen="forgot-password">비밀번호를 잊으셨나요?</button>
            <button class="primary-button auth-submit" type="submit">로그인</button>
          </form>
          ${cloudEnabled ? `<div class="cloud-auth-note"><strong>보안 로그인</strong><span>계정 역할과 서비스 배정에 따라 필요한 화면만 표시됩니다.</span></div>` : `<div class="cloud-auth-note"><strong>로그인 연결 대기</strong><span>로그인은 연결된 운영 데이터베이스에서만 사용할 수 있습니다.</span></div>`}
          <div class="auth-switch"><span>처음 이용하시나요?</span><button data-auth-screen="signup">회원가입</button></div><button class="auth-home-link" data-auth-screen="public">← ProMoms 사이트로 돌아가기</button>
        </div>
      </section>
    </main>`;
  }

  function forgotPasswordMarkup() {
    return `<main class="auth-page"><section class="auth-brand-panel"><div class="auth-brand"><div class="brand-mark">${brandLogoMarkup()}</div><div><strong>ProMoms</strong><span>CARE · BABY · BEAUTY</span></div></div><div class="auth-story"><p class="eyebrow">ACCOUNT RECOVERY</p><h1>다시 안전하게<br/>로그인하세요.</h1><p>가입한 이메일로 비밀번호 재설정 링크를 보내드립니다.</p></div><div class="auth-security">보안을 위해 가입 여부와 관계없이 동일한 완료 안내를 표시합니다.</div></section><section class="auth-form-panel"><div class="auth-card"><p class="eyebrow">RESET PASSWORD</p><h2>비밀번호 찾기</h2><p class="auth-lead">가입할 때 사용한 이메일을 입력해 주세요.</p><form data-forgot-password-form class="auth-form"><div class="field"><label for="recovery-email">이메일</label><input id="recovery-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="name@email.com" required /></div><button class="primary-button auth-submit" type="submit">재설정 링크 받기</button></form><div class="auth-switch"><span>비밀번호가 기억나셨나요?</span><button data-auth-screen="login">로그인</button></div><button class="auth-home-link" data-auth-screen="public">← ProMoms 사이트로 돌아가기</button></div></section></main>`;
  }

  function resetPasswordMarkup() {
    return `<main class="auth-page"><section class="auth-brand-panel"><div class="auth-brand"><div class="brand-mark">${brandLogoMarkup()}</div><div><strong>ProMoms</strong><span>CARE · BABY · BEAUTY</span></div></div><div class="auth-story"><p class="eyebrow">SECURE UPDATE</p><h1>새 비밀번호를<br/>설정하세요.</h1><p>다른 서비스에서 사용하지 않는 8자 이상의 비밀번호를 권장합니다.</p></div><div class="auth-security">재설정이 끝나면 새 비밀번호로 다시 로그인합니다.</div></section><section class="auth-form-panel"><div class="auth-card"><p class="eyebrow">NEW PASSWORD</p><h2>비밀번호 재설정</h2><p class="auth-lead">새 비밀번호를 두 번 입력해 주세요.</p><form data-reset-password-form class="auth-form"><div class="field"><label for="recovery-password">새 비밀번호</label><input id="recovery-password" name="password" type="password" minlength="8" autocomplete="new-password" required /><small>특수문자 없이도 가능하며, 8자 이상으로 입력해 주세요.</small></div><div class="field"><label for="recovery-password-confirm">새 비밀번호 확인</label><input id="recovery-password-confirm" name="passwordConfirm" type="password" minlength="8" autocomplete="new-password" required /></div><button class="primary-button auth-submit" type="submit">새 비밀번호 저장</button></form><button class="auth-home-link" data-auth-screen="login">로그인으로 돌아가기</button></div></section></main>`;
  }

  function signupMarkup() {
    return `<main class="auth-page signup-page">
      <section class="auth-brand-panel"><div class="auth-brand"><div class="brand-mark">${brandLogoMarkup()}</div><div><strong>ProMoms</strong><span>CARE · BABY · BEAUTY</span></div></div><div class="auth-story"><p class="eyebrow">JOIN ProMoms</p><h1>함께 만드는<br/>안심 케어.</h1><p>회원가입은 본인의 기본정보만 입력합니다. 아기 정보와 희망 일정은 가입 후 ‘서비스 신청’에서 접수합니다.</p></div><div class="auth-security">관리사 계정은 관리자 승인 후 배정된 고객의 화면만 이용할 수 있습니다.</div></section>
      <section class="auth-form-panel"><div class="auth-card signup-card"><p class="eyebrow">CREATE ACCOUNT</p><h2>회원가입</h2><p class="auth-lead">계정 유형과 본인의 기본 정보를 입력해 주세요.</p>
        <form data-signup-form class="auth-form">
          <div class="field"><span class="field-label">가입 유형</span><div class="option-grid two">${radioOptions("role", [["client", "고객 / 보호자"], ["caregiver", "관리사"]], "client")}</div></div>
          <div class="form-grid two"><div class="field"><label for="signup-name">이름</label><input id="signup-name" name="fullName" autocomplete="name" required /></div><div class="field"><label for="signup-phone">전화번호</label><input id="signup-phone" name="phone" autocomplete="tel" required /></div></div>
          <div class="field"><label for="signup-email">이메일</label><input id="signup-email" name="email" type="email" autocomplete="email" required /></div>
          <div class="field"><label for="signup-password">비밀번호</label><input id="signup-password" name="password" type="password" minlength="8" autocomplete="new-password" required /><small>특수문자 없이도 가능하며, 8자 이상으로 입력해 주세요.</small></div>
          <div data-client-signup-fields>
            <div class="client-request-fields basic-profile-fields"><h3>고객 기본정보</h3><p>아기 정보, 주소, 비상 연락처와 돌봄 일정은 가입 후 서비스 신청 단계에서 필요한 범위만 입력합니다.</p><div class="field"><label for="signup-language">선호 언어 <span class="optional-label">선택</span></label><select id="signup-language" name="preferredLanguage"><option value="ko">한국어</option><option value="en">English</option><option value="ko,en">한국어 · English</option></select></div></div>
          </div>
          <div data-caregiver-signup-fields hidden>
            <div class="field"><label for="caregiver-cert">자격·경력 요약</label><textarea id="caregiver-cert" name="certification" placeholder="관련 자격과 경력을 간단히 입력해 주세요."></textarea><small>관리자 승인 시 확인하는 정보입니다.</small></div>
          </div>
          <section class="terms-box"><h3>정보 취급 및 서비스 이용 동의</h3>
            <label class="consent-row"><input type="checkbox" name="termsService" required /><span><strong>[필수] 서비스 이용약관 동의</strong><small>계정 운영, 서비스 제공, 이용 제한 및 책임에 관한 기본 약관에 동의합니다.</small></span></label>
            <details><summary>서비스 이용약관 요약 보기</summary><p>사용자는 정확한 정보를 제공하고 본인 계정을 안전하게 관리해야 합니다. 앱은 케어 기록과 운영 지원을 제공하며 의료 진단이나 응급 서비스를 대신하지 않습니다.</p></details>
            <label class="consent-row"><input type="checkbox" name="termsPrivacy" required /><span><strong>[필수] 개인정보 수집·이용 동의</strong><small>이름, 이메일, 전화번호, 계정 역할 및 서비스 이용 기록을 계정 운영 목적으로 처리합니다.</small></span></label>
            <details><summary>개인정보 처리 요약 보기</summary><p>수집 정보는 회원 관리, 일정 배정, 고객 지원 및 보안 감사에 사용합니다. 법적 의무와 보관 정책에 따라 보관하며 권한 없는 제3자에게 제공하지 않습니다.</p></details>
            <label class="consent-row"><input type="checkbox" name="termsSensitive" required /><span><strong>[필수] 민감 케어정보 처리 동의</strong><small>산모·아기의 수유, 수면, 체온 및 케어 기록 처리를 이해하고 동의합니다.</small></span></label>
            <details><summary>민감정보 처리 요약 보기</summary><p>민감 케어정보는 배정된 관리사, 본인 고객 및 권한 있는 관리자만 접근합니다. 보관·삭제 또는 개인정보 관련 요청은 ProMoms 고객지원으로 접수할 수 있습니다.</p></details>
            <label class="consent-row optional"><input type="checkbox" name="termsMarketing" /><span><strong>[선택] 혜택·마케팅 정보 수신</strong><small>맘스 뷰티와 유아용품 혜택 및 행사 알림을 받을 수 있습니다.</small></span></label>
          </section>
          <button class="primary-button auth-submit" type="submit">동의하고 가입하기</button>
        </form>
        <div class="auth-switch"><span>이미 계정이 있나요?</span><button data-auth-screen="login">로그인</button></div><button class="auth-home-link" data-auth-screen="public">← ProMoms 사이트로 돌아가기</button>
      </div></section>
    </main>`;
  }

  function pendingApprovalMarkup(user) {
    return `<main class="pending-page"><section class="pending-card card"><div class="pending-icon">◷</div><p class="eyebrow">APPROVAL PENDING</p><h1>관리자 승인을 기다리고 있습니다.</h1><p>${escapeHtml(user.fullName)}님의 관리사 가입 신청이 접수되었습니다. 관리자가 자격 정보를 확인하고 승인하면 배정된 고객의 전용 케어 화면에 접근할 수 있습니다.</p><div class="pending-detail"><span>가입 이메일</span><strong>${escapeHtml(user.email)}</strong></div>${usingCloudData() ? `<aside class="pending-consent-callout" aria-labelledby="pending-consent-title"><strong id="pending-consent-title">승인 전 필수 약관 확인</strong><span>최신 필수 약관을 아직 확인하지 않았다면 동의 내용을 저장해 주세요. 이 기록이 없으면 관리사 승인이 진행되지 않습니다.</span><button class="primary-button" type="button" data-current-consents>필수 약관 확인·저장</button></aside>` : ""}<button class="secondary-button pending-logout-button" data-logout>로그아웃</button></section></main>`;
  }

  function openCurrentConsentsModal() {
    const user = authUser();
    if (!usingCloudData() || user?.role !== "caregiver" || user.status === "approved") {
      return showToast("승인 대기 중인 관리사 계정에서만 이용할 수 있습니다.", "error");
    }
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal current-consents-modal" role="dialog" aria-modal="true" aria-labelledby="current-consents-title" aria-describedby="current-consents-description"><header class="modal-header"><div><p class="eyebrow">REQUIRED CONSENTS</p><h3 id="current-consents-title">필수 약관 확인</h3><p id="current-consents-description">관리사 승인에 필요한 최신 동의 내용을 확인하고 저장합니다.</p></div><button class="close-button" type="button" data-close-modal aria-label="필수 약관 확인 창 닫기">×</button></header><form class="modal-form" data-current-consents-form><fieldset class="terms-box consent-recovery-fieldset"><legend>정보 취급 및 서비스 이용 동의</legend><label class="consent-row"><input type="checkbox" name="termsService" required/><span><strong>[필수] 서비스 이용약관 동의</strong><small>계정 운영, 서비스 제공, 이용 제한 및 책임에 관한 기본 약관에 동의합니다.</small></span></label><details><summary>서비스 이용약관 요약 보기</summary><p>사용자는 정확한 정보를 제공하고 본인 계정을 안전하게 관리해야 합니다. 앱은 케어 기록과 운영 지원을 제공하며 의료 진단이나 응급 서비스를 대신하지 않습니다.</p></details><label class="consent-row"><input type="checkbox" name="termsPrivacy" required/><span><strong>[필수] 개인정보 수집·이용 동의</strong><small>이름, 이메일, 전화번호, 계정 역할 및 서비스 이용 기록을 계정 운영 목적으로 처리합니다.</small></span></label><details><summary>개인정보 처리 요약 보기</summary><p>수집 정보는 회원 관리, 일정 배정, 고객 지원 및 보안 감사에 사용합니다. 법적 의무와 보관 정책에 따라 보관하며 권한 없는 제3자에게 제공하지 않습니다.</p></details><label class="consent-row"><input type="checkbox" name="termsSensitive" required/><span><strong>[필수] 민감 케어정보 처리 동의</strong><small>산모·아기의 수유, 수면, 체온 및 케어 기록 처리를 이해하고 동의합니다.</small></span></label><details><summary>민감정보 처리 요약 보기</summary><p>민감 케어정보는 배정된 관리사, 본인 고객 및 권한 있는 관리자만 접근합니다. 보관·삭제 또는 개인정보 관련 요청은 ProMoms 고객지원으로 접수할 수 있습니다.</p></details><label class="consent-row optional"><input type="checkbox" name="termsMarketing"/><span><strong>[선택] 혜택·마케팅 정보 수신</strong><small>맘스 뷰티와 유아용품 혜택 및 행사 알림을 받을 수 있습니다.</small></span></label></fieldset><p class="consent-version-note">동의 버전 ${escapeHtml(state.auth.termsVersion || "현재 버전")}</p><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>나중에</button><button type="submit" class="primary-button">동의 내용 저장</button></div></form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-current-consents-form]")?.addEventListener("submit", saveCurrentConsents);
  }

  async function saveCurrentConsents(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.termsService !== "on" || values.termsPrivacy !== "on" || values.termsSensitive !== "on") {
      return showToast("필수 동의 3가지를 모두 확인해 주세요.", "error");
    }
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "저장 중…";
    try {
      await recordMyCurrentConsentsCloud({
        serviceTerms: true,
        privacy: true,
        sensitiveCare: true,
        marketing: values.termsMarketing === "on",
      });
      closeModal();
      showToast("필수 약관 동의를 저장했습니다. 관리자가 승인 절차를 계속 진행할 수 있습니다.");
    } catch (error) {
      showToast(friendlyErrorMessage(error, "필수 동의를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."), "error");
      submitButton.disabled = false;
      submitButton.textContent = "동의 내용 저장";
    }
  }

  function bindAuthEvents() {
    document.querySelectorAll("[data-auth-screen]").forEach((button) => button.addEventListener("click", async () => {
      const targetScreen = button.dataset.authScreen;
      const leavingRecovery = targetScreen !== "reset-password" && (passwordRecoveryRequested || state.auth.screen === "reset-password");
      if (leavingRecovery) {
        button.disabled = true;
        passwordRecoveryRequested = false;
        clearPasswordRecoveryUrl();
        if (usingCloudData()) await signOutCloud().catch(() => {});
        state.auth.currentUserId = null;
      }
      state.auth.screen = targetScreen;
      saveState();
      render();
    }));
    document.querySelector("[data-login-form]")?.addEventListener("submit", handleLogin);
    document.querySelector("[data-forgot-password-form]")?.addEventListener("submit", handleForgotPassword);
    document.querySelector("[data-reset-password-form]")?.addEventListener("submit", handleResetPassword);
    const signupForm = document.querySelector("[data-signup-form]");
    signupForm?.addEventListener("submit", handleSignup);
    signupForm?.querySelectorAll('input[name="role"]').forEach((radio) => radio.addEventListener("change", () => toggleSignupFields(signupForm)));
    if (signupForm) toggleSignupFields(signupForm);
    document.querySelector("[data-current-consents]")?.addEventListener("click", openCurrentConsentsModal);
    document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", logout));
  }

  async function handleForgotPassword(event) {
    event.preventDefault();
    if (!usingCloudData()) return showToast("비밀번호 재설정은 운영 데이터베이스 연결 후 사용할 수 있습니다.", "info");
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const email = new FormData(form).get("email");
    submitButton.disabled = true;
    submitButton.textContent = "안내 메일 보내는 중…";
    try {
      await requestPasswordResetCloud(String(email));
      state.auth.screen = "login";
      saveState();
      render();
      showToast("계정이 존재하면 비밀번호 재설정 링크를 이메일로 보내드립니다.", "info");
    } catch (error) {
      showToast(friendlyErrorMessage(error, "재설정 안내를 보내지 못했습니다. 잠시 후 다시 시도해 주세요."), "error");
      submitButton.disabled = false;
      submitButton.textContent = "재설정 링크 받기";
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.password !== values.passwordConfirm) return showToast("새 비밀번호 확인이 일치하지 않습니다.", "error");
    if (String(values.password).length < 8) return showToast("비밀번호는 8자 이상으로 입력해 주세요.", "error");
    if (!usingCloudData()) return showToast("비밀번호 재설정은 운영 데이터베이스 연결 후 사용할 수 있습니다.", "error");
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "저장 중…";
    try {
      await updatePasswordCloud(values.password);
      passwordRecoveryRequested = false;
      clearPasswordRecoveryUrl();
      await signOutCloud();
      const clean = loadState();
      state = { ...clean, auth: { ...clean.auth, currentUserId: null, screen: "login" } };
      saveState();
      render();
      showToast("새 비밀번호를 저장했습니다. 다시 로그인해 주세요.");
    } catch (error) {
      showToast(friendlyErrorMessage(error, "비밀번호를 변경하지 못했습니다. 재설정 링크를 다시 요청해 주세요."), "error");
      submitButton.disabled = false;
      submitButton.textContent = "새 비밀번호 저장";
    }
  }

  function toggleSignupFields(form) {
    const role = form.elements.role.value;
    form.querySelector("[data-client-signup-fields]").hidden = role !== "client";
    form.querySelector("[data-caregiver-signup-fields]").hidden = role !== "caregiver";
    form.elements.certification.required = role === "caregiver";
  }

  function initialsFor(name) {
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (cloudEnabled) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "로그인 중…";
      try {
        const authData = await signInCloud(values.identifier, values.password);
        await refreshCloudState(authData.session);
        const user = authUser();
        if (!user) throw new Error("회원 정보를 불러오지 못했습니다.");
        const availableWorkspaces = availableWorkspaceRoles(user);
        state.role = availableWorkspaces.includes(user.role) ? user.role : availableWorkspaces[0];
        state.auth.screen = availableWorkspaces.length === 1 && state.role === "client" ? "public" : "portal";
        saveState();
        render();
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        showToast(`${user.fullName}님, 로그인되었습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "이메일 또는 비밀번호를 확인해 주세요."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "로그인";
      }
      return;
    }
    showToast("로그인은 운영 데이터베이스가 연결된 환경에서만 사용할 수 있습니다.", "info");
  }

  async function handleSignup(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (cloudEnabled) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "계정 생성 중…";
      try {
        const authData = await signUpCloud(values, state.auth.termsVersion);
        if (authData.session) {
          await refreshCloudState(authData.session);
          const user = authUser();
          state.auth.screen = user?.role === "client" ? "public" : "portal";
          saveState();
          render();
          showToast(values.role === "caregiver" ? "관리사 가입 신청이 접수되었습니다." : "회원가입이 완료되었습니다.");
        } else {
          state.auth.screen = "login";
          saveState();
          render();
          showToast("회원가입이 완료되었습니다. 입력한 이메일과 비밀번호로 로그인해 주세요.");
        }
      } catch (error) {
        showToast(friendlyErrorMessage(error, "회원가입을 완료하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "동의하고 가입하기";
      }
      return;
    }
    const email = values.email.trim().toLowerCase();
    if (state.users.some((user) => user.email.toLowerCase() === email || user.login.toLowerCase() === email)) {
      showToast("이미 가입된 이메일입니다.");
      return;
    }
    const id = `user-${Date.now()}`;
    const user = {
      id,
      login: email,
      email,
      password: values.password,
      role: values.role,
      status: values.role === "client" ? "approved" : "pending",
      fullName: values.fullName.trim(),
      initials: initialsFor(values.fullName),
      phone: values.phone.trim(),
      dateOfBirth: values.dateOfBirth ? new Date(`${values.dateOfBirth}T12:00:00`).toISOString() : null,
      address: values.address?.trim() || "",
      certification: values.certification || "",
      hireDate: null,
      careerYears: 0,
      employmentStatus: values.role === "caregiver" ? "APPLICANT" : null,
      specialties: "",
      residentialArea: "",
      serviceArea: "",
      hrNotes: "",
      createdAt: new Date().toISOString(),
      consents: { service: true, privacy: true, sensitive: true, marketing: values.termsMarketing === "on", version: state.auth.termsVersion, agreedAt: new Date().toISOString() },
    };
    state.users.push(user);
    if (user.role === "client") {
      const clientId = `client-${Date.now()}`;
      state.clients.push({ id: clientId, userId: id, approvalStatus: "ACCOUNT_ACTIVE", clientStatus: "LEAD", motherName: user.fullName, maternalStatus: "서비스 신청 전", preferredLanguage: values.preferredLanguage?.trim() || "", emergencyContact: values.emergencyContact?.trim() || "", nextContactDate: null, internalMemo: "", babyAdminNotes: "", babyId: null, babyName: "", babyBirthDate: null, address: values.address?.trim() || "", allergies: "", extraHouseholdMembers: 0, requestNote: "" });
    }
    state.auth.currentUserId = id;
    state.auth.screen = user.role === "client" ? "public" : "portal";
    state.role = user.role;
    saveState();
    render();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    showToast(user.role === "caregiver" ? "관리사 가입 신청이 접수되었습니다." : "회원가입이 완료되었습니다. 필요한 돌봄은 서비스 신청 메뉴에서 접수해 주세요.");
  }

  async function logout() {
    if (cloudEnabled) {
      try {
        await signOutCloud();
      } catch (error) {
        showToast(friendlyErrorMessage(error, "로그아웃 중 오류가 발생했습니다."), "error");
      }
      const clean = loadState();
      state = { ...clean, auth: { ...clean.auth, currentUserId: null, screen: "public" } };
      closeModal();
      saveState();
      render();
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }
    state.auth.currentUserId = null;
    state.auth.screen = "public";
    saveState();
    closeModal();
    render();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function pageMarkup() {
    if (usingCloudData() && state.role === "retail") {
      return `<section class="page">${pageHeading("RETAIL", "리테일 백엔드 연결 준비 중", "결제·주문·재고 데이터가 운영 시스템과 안전하게 연결된 후 제공됩니다.")}<article class="card card-pad"><div class="empty-state"><span>◇</span><strong>주문·결제·재고 백엔드 연결 준비 중입니다.</strong><p>연결이 완료될 때까지 조회와 변경 기능은 비활성화됩니다.</p></div></article></section>`;
    }
    const operationalPages = {
      admin: { overview: adminOverview, schedule: adminSchedule, massage: adminMassageCalendar, requests: adminRequests, finance: adminFinance, history: adminServiceHistory, people: adminPeople, reports: adminReports },
      caregiver: { caregiving: caregiverCaregivingHub, postpartum: () => caregiverServiceWorkspace("POSTPARTUM"), babysitting: () => caregiverServiceWorkspace("BABYSITTING"), reports: () => objectiveReportPage("caregiver", null), profile: caregiverProfile },
      therapist: { availability: therapistAvailabilityPage, calendar: therapistMassageCalendar },
      client: { services: clientServicesHub, postpartum: () => clientServiceWorkspace("POSTPARTUM"), babysitting: () => clientServiceWorkspace("BABYSITTING"), reports: () => objectiveReportPage("client", null) },
      retail: {},
    };
    const previewPages = import.meta.env.DEV ? {
      admin: { ...operationalPages.admin, retail: adminRetail, analytics: adminAnalytics },
      caregiver: operationalPages.caregiver,
      therapist: operationalPages.therapist,
      client: { ...operationalPages.client, shop: clientShop, purchases: clientPurchases },
      retail: { pos: retailPos, products: retailProducts, inventory: retailInventory, orders: retailOrders },
    } : operationalPages;
    const renderer = previewPages[state.role]?.[currentView()];
    return renderer ? renderer() : `<section class="page"><article class="card card-pad"><div class="empty-state"><strong>사용 가능한 화면을 찾을 수 없습니다.</strong><span>메뉴에서 다른 화면을 선택하거나 다시 로그인해 주세요.</span></div></article></section>`;
  }

  function render() {
    shellEventController?.abort();
    shellEventController = null;
    if (cloudLoading) {
      app.innerHTML = `<main class="cloud-loading-page"><section class="card cloud-loading-card"><div class="loading-ring" aria-hidden="true"></div><p class="eyebrow">SECURE CLOUD</p><h1>안전하게 데이터를 불러오고 있습니다.</h1><p>계정 권한과 배정 범위를 확인하는 중입니다.</p></section></main>`;
      return;
    }
    if (cloudLoadError) {
      app.innerHTML = `<main class="cloud-loading-page"><section class="card cloud-loading-card error"><p class="eyebrow">CONNECTION NOTICE</p><h1>데이터를 불러오지 못했습니다.</h1><p>${escapeHtml(cloudLoadError)}</p><button class="primary-button" data-retry-cloud>다시 시도</button><button class="secondary-button" data-cloud-signout>로그아웃</button></section></main>`;
      document.querySelector("[data-retry-cloud]")?.addEventListener("click", () => refreshCloudState());
      document.querySelector("[data-cloud-signout]")?.addEventListener("click", logout);
      return;
    }
    const user = authUser();
    if (!user || ["public", "login", "signup", "forgot-password", "reset-password"].includes(state.auth.screen)) {
      app.innerHTML = authMarkup();
      if (state.auth.screen === "public") bindPublicEvents(); else bindAuthEvents();
      if (state.auth.screen !== "public") {
        const authHeading = document.querySelector(".auth-card h2");
        if (authHeading) { authHeading.tabIndex = -1; window.requestAnimationFrame(() => authHeading.focus()); }
      }
      return;
    }
    const workspaces = availableWorkspaceRoles(user);
    if (!workspaces.includes(state.role)) state.role = workspaces.includes(user.role) ? user.role : workspaces[0];
    if (state.role === "caregiver" && (user.caregiverStatus || user.status) !== "approved") {
      app.innerHTML = pendingApprovalMarkup(user);
      bindAuthEvents();
      return;
    }
    app.innerHTML = shellMarkup(pageMarkup());
    if (state.role === "admin" && currentView() === "finance" && canReviewServiceRequests()) {
      document.querySelector(".finance-collection-card")?.insertAdjacentHTML("afterend", financeRefundQueueMarkup());
    }
    bindShellEvents();
  }

  function bindShellEvents() {
    shellEventController = new AbortController();
    const shellEventOptions = { signal: shellEventController.signal };
    const mobileAccountMenu = document.querySelector(".mobile-account-menu");
    document.addEventListener("pointerdown", (event) => {
      if (mobileAccountMenu?.open && !mobileAccountMenu.contains(event.target)) mobileAccountMenu.open = false;
    }, shellEventOptions);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && mobileAccountMenu?.open) {
        mobileAccountMenu.open = false;
        mobileAccountMenu.querySelector("summary")?.focus();
      }
    }, shellEventOptions);
    if (state.role === "admin" && !canManageCaregiverHr()) {
      document.querySelectorAll("[data-manage-caregiver], [data-approve-user]").forEach((control) => control.remove());
      document.querySelector(".approval-panel")?.remove();
    }
    if (state.role === "admin" && !canManageMemberAccounts()) {
      document.querySelector(".member-governance")?.remove();
      document.querySelectorAll("[data-member-status], [data-archive-member], [data-configure-member-roles]").forEach((control) => control.remove());
    } else if (state.role === "admin" && !canGrantAdministrativeRole()) {
      state.users.filter((user) => user.databaseRoles?.includes("OWNER")).forEach((owner) => {
        document.querySelectorAll(`[data-member-status][data-member-user-id="${owner.id}"], [data-archive-member="${owner.id}"]`).forEach((control) => control.remove());
      });
    }
    if (state.role === "admin" && !canReviewServiceRequests()) {
      document.querySelectorAll("[data-review-client-request], [data-record-deposit-refund], [data-record-service-refund], [data-archive-service-request]").forEach((control) => control.remove());
    }
    if (state.role === "admin" && currentView() === "requests") {
      const adjustments = state.serviceAdjustments.filter((item) => item.status === "PENDING");
      const refunds = canReviewServiceRequests() ? state.serviceRequests.filter((item) => item.status === "CANCELLED" && item.depositStatus === "REFUND_DUE") : [];
      const stats = document.querySelector(".admin-request-page .stats");
      if (stats) stats.insertAdjacentHTML("afterend", adjustmentManagementMarkup(adjustments));
      const firstStat = document.querySelector(".admin-request-page .stats .stat-card:first-child");
      if (firstStat) {
        firstStat.querySelector(".stat-value").textContent = String(state.serviceRequests.filter((item) => item.status === "PENDING").length + adjustments.length + refunds.length);
        firstStat.querySelector(".stat-foot").textContent = "신청·변경·환불 처리 필요";
      }
      const pageDescription = document.querySelector(".admin-request-page .page-heading > div > p:last-child");
      if (pageDescription) pageDescription.textContent = "고객 신청과 변경·취소 요청을 검토하고 승인된 일정만 배정에 반영합니다.";
      document.querySelectorAll("[data-review-client-request], [data-open-assignment][data-request-id]").forEach((button) => {
        const requestId = button.dataset.reviewClientRequest || button.dataset.requestId;
        const request = state.serviceRequests.find((item) => item.id === requestId);
        const title = button.closest(".service-request-management-row")?.querySelector(".request-title-line strong");
        if (request?.requestKind === "EXTENSION" && title && !title.textContent.startsWith("기간 연장")) title.textContent = `기간 연장 · ${title.textContent}`;
      });
    }
    document.querySelectorAll("[data-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.nav === "sitehome") {
          state.auth.screen = "public";
          saveState();
          render();
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        state.views[state.role] = button.dataset.nav;
        saveState();
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    document.querySelectorAll("[data-enter-client-service]").forEach((button) => button.addEventListener("click", () => {
      state.selectedClientAssignmentId = button.dataset.assignmentId || null;
      state.views.client = button.dataset.enterClientService === "BABYSITTING" ? "babysitting" : "postpartum";
      saveState();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));

    document.querySelectorAll("[data-enter-caregiver-service]").forEach((button) => button.addEventListener("click", () => {
      state.views.caregiver = button.dataset.enterCaregiverService === "BABYSITTING" ? "babysitting" : "postpartum";
      saveState();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));

    document.querySelectorAll("[data-service-tab]").forEach((button) => button.addEventListener("click", () => {
      const serviceType = button.dataset.serviceType === "BABYSITTING" ? "BABYSITTING" : "POSTPARTUM";
      state.serviceTabs[state.role][serviceType] = button.dataset.serviceTab;
      saveState();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));

    document.querySelectorAll("[data-shift-check]").forEach((checkbox) => checkbox.addEventListener("change", () => {
      const assignmentId = checkbox.dataset.shiftCheck;
      const checkId = checkbox.dataset.checkId;
      if (!checkbox.checked) {
        checkbox.checked = true;
        return;
      }
      state.shiftChecklists[assignmentId] = state.shiftChecklists[assignmentId] || {};
      state.shiftChecklists[assignmentId][checkId] = true;
      checkbox.disabled = true;
      checkbox.closest("label")?.classList.add("is-checked");
      const card = checkbox.closest("[data-shift-checklist]");
      const checkboxes = [...(card?.querySelectorAll("[data-shift-check]") || [])];
      const completed = checkboxes.filter((item) => item.checked).length;
      const progress = card?.querySelector("[data-shift-check-progress]");
      const saveButton = card?.querySelector("[data-save-shift-checks]");
      if (progress) {
        progress.textContent = `${completed}/${checkboxes.length} 완료`;
        progress.classList.toggle("gold", completed !== checkboxes.length);
      }
      if (saveButton) {
        saveButton.disabled = completed !== checkboxes.length;
        saveButton.textContent = completed === checkboxes.length ? "안전 체크 한 번에 저장" : "4개 항목 확인 후 저장";
      }
    }));

    document.querySelectorAll("[data-save-shift-checks]").forEach((button) => button.addEventListener("click", async () => {
      const assignmentId = button.dataset.saveShiftChecks;
      const requiredCheckIds = ["arrival", "safety", "request", "scope"];
      const checks = state.shiftChecklists[assignmentId] || {};
      if (!requiredCheckIds.every((checkId) => checks[checkId] === true)) {
        return showToast("네 가지 안전 항목을 모두 확인해 주세요.", "error");
      }
      button.disabled = true;
      button.textContent = "안전 체크 저장 중…";
      try {
        if (usingCloudData()) {
          await saveCareShiftChecklistCloud(assignmentId, {
            arrival: true,
            safety: true,
            request: true,
            scope: true,
          }, {
            serviceDate: localDateKey(new Date()),
            timeZone: deviceTimeZone(),
          });
          await refreshCloudState();
        } else {
          saveState();
          render();
        }
        showToast("오늘의 근무 전 안전 체크 4개 항목을 한 번에 저장했습니다.");
      } catch (error) {
        button.disabled = false;
        button.textContent = "안전 체크 다시 저장";
        showToast(friendlyErrorMessage(error, "근무 전 안전 체크를 저장하지 못했습니다."), "error");
      }
    }));

    document.querySelectorAll("[data-public-home]").forEach((button) => button.addEventListener("click", () => { state.auth.screen = "public"; saveState(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
    document.querySelectorAll("[data-service-apply]").forEach((button) => button.addEventListener("click", () => openServiceApplicationModal(button.dataset.serviceApply || null, "NEW", null, button.dataset.postpartumMode || "COMMUTE")));
    document.querySelectorAll("[data-public-service-detail]").forEach((button) => button.addEventListener("click", () => openPublicServiceDetail(button.dataset.publicServiceDetail)));
    document.querySelectorAll("[data-massage-book]").forEach((button) => button.addEventListener("click", openMassageBookingModal));
    document.querySelectorAll("[data-service-adjust]").forEach((button) => button.addEventListener("click", () => openServiceAdjustmentModal(button.dataset.serviceAdjust)));
    document.querySelectorAll("[data-service-extend]").forEach((button) => button.addEventListener("click", () => openServiceApplicationModal("BABYSITTING", "EXTENSION", button.dataset.serviceExtend || null)));

    document.querySelectorAll("[data-log-type]").forEach((button) => {
      button.addEventListener("click", () => openLogModal(button.dataset.logType, button.dataset.logPreset || null));
    });
    document.querySelectorAll("[data-edit-care-event]").forEach((button) => {
      button.addEventListener("click", () => openCareEventEditModal(button.dataset.editCareEvent));
    });

    document.querySelectorAll("[data-chart-range]").forEach((button) => button.addEventListener("click", () => {
      state.chartRangeByRole[state.role] = button.dataset.chartRange;
      saveState();
      render();
    }));

    document.querySelectorAll("[data-objective-report-assignment]").forEach((select) => select.addEventListener("change", () => {
      const preferences = objectiveReportPreferences(state.role);
      preferences.assignmentId = select.value;
      if (state.role === "admin") {
        state.adminSelectedAssignmentId = select.value;
        state.adminSelectedReportSessionId = null;
        const assignment = state.assignments.find((item) => item.id === select.value);
        if (assignment) state.adminSelectedClientId = assignment.clientId;
      }
      if (state.role === "client") state.selectedClientAssignmentId = select.value;
      saveState();
      render();
    }));

    document.querySelectorAll("[data-objective-report-customer-search]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const preferences = objectiveReportPreferences("admin");
      preferences.customerQuery = String(new FormData(form).get("customerQuery") || "").trim();
      preferences.assignmentId = null;
      state.adminSelectedAssignmentId = null;
      state.adminSelectedClientId = null;
      saveState();
      render();
    }));

    document.querySelectorAll("[data-clear-objective-report-search]").forEach((button) => button.addEventListener("click", () => {
      const preferences = objectiveReportPreferences("admin");
      preferences.customerQuery = "";
      saveState();
      render();
    }));

    document.querySelectorAll("[data-print-objective-report]").forEach((button) => button.addEventListener("click", () => {
      const previousTitle = document.title;
      document.title = `ProMoms-Care-Report-${button.dataset.printObjectiveReport || localDateKey(new Date())}`;
      window.print();
      window.setTimeout(() => { document.title = previousTitle; }, 500);
    }));

    document.querySelectorAll("[data-caregiver-assignment-detail]").forEach((button) => button.addEventListener("click", () => openCaregiverAssignmentDetailModal(button.dataset.caregiverAssignmentDetail)));
    document.querySelectorAll("[data-open-retrospective-report]").forEach((button) => button.addEventListener("click", () => openRetrospectiveCareReportModal(button.dataset.assignmentId || null)));
    document.querySelectorAll("[data-open-review]").forEach((button) => button.addEventListener("click", () => openServiceReviewModal(button.dataset.openReview)));
    document.querySelectorAll("[data-add-review-photos]").forEach((button) => button.addEventListener("click", () => openServiceReviewPhotoModal(button.dataset.addReviewPhotos, Number(button.dataset.photoSlots || 1))));

    document.querySelectorAll("[data-start-care]").forEach((button) => {
      button.addEventListener("click", async () => {
        const assignment = state.assignments.find((item) => item.id === button.dataset.assignmentId);
        if (!assignment) return showToast("시작할 배정 정보를 찾을 수 없습니다.", "error");
        if (usingCloudData()) {
          button.disabled = true;
          try {
            await setCareSessionStatusCloud(assignment.id, "IN_PROGRESS", {
              serviceDate: localDateKey(new Date()),
              timeZone: deviceTimeZone(),
            });
            await refreshCloudState();
            showToast("케어 세션을 시작했습니다. 지금부터 기록이 실제 데이터베이스에 저장됩니다.");
          } catch (error) {
            showToast(friendlyErrorMessage(error, "케어 세션을 시작하지 못했습니다."), "error");
            button.disabled = false;
          }
          return;
        }
        const client = clientById(assignment.clientId);
        if (!client) return showToast("배정된 고객 정보를 확인할 수 없어 케어를 시작하지 않았습니다.", "error");
        state.session.active = true;
        state.session.assignmentId = assignment.id;
        state.session.clientId = assignment.clientId;
        state.session.babyId = assignment.babyId;
        state.session.serviceDate = localDateKey(new Date());
        state.session.serviceTimeZone = deviceTimeZone();
        state.session.clientName = client.motherName;
        state.session.babyName = babyNameFor(assignment, client) || client.babyName;
        state.session.caregiverName = authUser().fullName;
        state.session.address = assignment.address;
        state.session.schedule = `${assignment.dailyStart} – ${assignment.dailyEnd}`;
        state.session.startedAt = new Date().toISOString();
        state.session.endedAt = null;
        saveState();
        render();
        showToast("케어 세션을 시작했습니다.");
      });
    });

    document.querySelectorAll("[data-end-care]").forEach((button) => {
      button.addEventListener("click", async () => {
        const assignment = state.assignments.find((item) => item.id === state.session.assignmentId);
        if (!assignment) return showToast("종료할 배정 정보를 찾을 수 없습니다. 화면을 새로고침해 주세요.", "error");
        if (usingCloudData()) {
          button.disabled = true;
          const completedEventCount = visibleCareEvents(assignment).length;
          const completedServiceLabel = activeSessionIsStale(assignment) && state.session.serviceDate
            ? formatDate(`${state.session.serviceDate}T12:00:00`)
            : "오늘";
          try {
            await setCareSessionStatusCloud(assignment.id, "COMPLETED", {
              serviceDate: state.session.serviceDate || localDateKey(new Date()),
              timeZone: state.session.serviceTimeZone || deviceTimeZone(),
            });
            await refreshCloudState();
            showToast(`케어 세션을 종료했습니다. ${completedServiceLabel} ${completedEventCount}개의 기록이 저장되었습니다.`);
          } catch (error) {
            showToast(friendlyErrorMessage(error, "케어 세션을 종료하지 못했습니다."), "error");
            button.disabled = false;
          }
          return;
        }
        state.session.active = false;
        state.session.endedAt = new Date().toISOString();
        if (assignment) assignment.lastCompletedCareAt = state.session.endedAt;
        const completedEventCount = visibleCareEvents(assignment).length;
        saveState();
        render();
        showToast(`케어 세션을 종료했습니다. 오늘 ${completedEventCount}개의 기록이 저장되었습니다.`);
      });
    });

    document.querySelectorAll("[data-notice]").forEach((button) => {
      button.addEventListener("click", () => showToast(button.dataset.notice, "info"));
    });

    if (import.meta.env.DEV && !usingCloudData()) {
      document.querySelectorAll("[data-reset-demo]").forEach((button) => {
        button.addEventListener("click", () => {
          const role = state.role;
          state = buildSeedState();
          state.role = role;
          saveState();
          render();
          showToast("로컬 데이터를 처음 상태로 되돌렸습니다.");
        });
      });
      document.querySelectorAll("[data-demo-action]").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.demoAction, "info")));
      document.querySelectorAll("[data-retail-category]").forEach((button) => button.addEventListener("click", () => {
        const key = button.dataset.categoryScope === "pos" ? "posCategory" : "selectedCategory";
        state.retail[key] = button.dataset.retailCategory;
        saveState();
        render();
      }));
      document.querySelectorAll("[data-add-product]").forEach((button) => button.addEventListener("click", () => addProductToCart(button.dataset.addProduct)));
      document.querySelectorAll("[data-cart-change]").forEach((button) => button.addEventListener("click", () => changeCartQuantity(button.dataset.cartChange, Number(button.dataset.delta))));
      document.querySelectorAll("[data-cart-customer]").forEach((select) => select.addEventListener("change", () => {
        state.retail.cartCustomer = select.value;
        saveState();
      }));
      document.querySelectorAll("[data-checkout]").forEach((button) => button.addEventListener("click", () => completeDemoCheckout(button.dataset.checkout)));
      document.querySelectorAll("[data-restock]").forEach((button) => button.addEventListener("click", () => {
        const product = productById(button.dataset.restock);
        if (!product) return;
        state.retail.inventoryMovements.push({ id: `mv-${Date.now()}`, productId: product.id, type: "RECEIPT", quantity: 5, at: new Date().toISOString() });
        saveState();
        render();
        showToast(`${product.name} 5개 입고 이동을 기록했습니다.`);
      }));
      document.querySelectorAll("[data-advance-order]").forEach((button) => button.addEventListener("click", () => {
        const order = state.retail.orders.find((item) => item.id === button.dataset.advanceOrder);
        if (!order) return;
        order.status = nextOrderStatus(order.status);
        order.statusUpdatedAt = new Date().toISOString();
        saveState();
        render();
        showToast(`${order.id} 주문을 '${order.status}' 상태로 변경했습니다.`);
      }));
    }

    document.querySelectorAll("[data-approve-user]").forEach((button) => {
      button.addEventListener("click", async () => {
        const user = state.users.find((item) => item.id === button.dataset.approveUser);
        if (!user || !isCaregiverPendingApproval(user)) {
          return showToast("현재 승인 가능한 관리사 신청이 아닙니다. 계정 상태를 새로고침해 확인해 주세요.", "error");
        }
        if (usingCloudData()) {
          button.disabled = true;
          try {
            await approveCaregiverCloud(user.id, "관리자 화면에서 자격·경력 확인 후 승인");
            await refreshCloudState();
            showToast(`${user.fullName} 관리사 계정을 승인했습니다. 배정 전에 인사정보를 저장하고 근무상태를 재직으로 설정해 주세요.`, "info");
          } catch (error) {
            showToast(friendlyErrorMessage(error, "관리사 승인을 저장하지 못했습니다."), "error");
            button.disabled = false;
          }
          return;
        }
        user.status = "approved";
        user.approvedAt = new Date().toISOString();
        user.approvedBy = authUser().id;
        user.employmentStatus = "ACTIVE";
        user.hireDate = user.hireDate || new Date().toISOString();
        saveState();
        render();
        showToast(`${user.fullName} 관리사 계정을 승인했습니다.`);
      });
    });

    document.querySelectorAll("[data-member-status]").forEach((button) => {
      button.addEventListener("click", async () => {
        const nextStatus = button.dataset.memberStatus;
        const memberName = button.dataset.memberName || "선택한 회원";
        const actionLabel = nextStatus === "ACTIVE" ? "활성화" : "정지";
        if (!window.confirm(`${memberName} 계정을 ${actionLabel}하시겠습니까?${nextStatus === "SUSPENDED" ? "\n정지 즉시 예약·기록 등 보호 데이터 접근이 차단됩니다." : ""}`)) return;
        button.disabled = true;
        if (!usingCloudData()) {
          const member = state.users.find((item) => item.id === button.dataset.memberUserId);
          if (member) {
            member.accountStatus = nextStatus;
            if (member.role === "caregiver") member.employmentStatus = nextStatus === "ACTIVE" ? "ACTIVE" : "INACTIVE";
          }
          saveState();
          render();
          showToast(`${memberName} 로컬 계정을 ${actionLabel}했습니다.`);
          return;
        }
        try {
          await setMemberStatusCloud(button.dataset.memberUserId, nextStatus);
          await refreshCloudState();
          showToast(`${memberName} 계정을 ${actionLabel}했습니다.`);
        } catch (error) {
          showToast(friendlyErrorMessage(error, `회원 계정을 ${actionLabel}하지 못했습니다.`), "error");
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll("[data-configure-member-roles]").forEach((button) => {
      button.addEventListener("click", () => openMemberRoleAccessModal(button.dataset.configureMemberRoles));
    });

    document.querySelectorAll("[data-archive-member]").forEach((button) => {
      button.addEventListener("click", async () => {
        const memberName = button.dataset.memberName || "선택한 회원";
        if (!window.confirm(`${memberName} 계정을 보관하시겠습니까?\n로그인과 웹앱 데이터 접근은 즉시 차단되고, 법적·운영상 필요한 기존 기록은 보관됩니다.`)) return;
        button.disabled = true;
        if (!usingCloudData()) {
          const member = state.users.find((item) => item.id === button.dataset.archiveMember);
          if (member) member.accountStatus = "REJECTED";
          saveState();
          render();
          showToast(`${memberName} 계정을 보관했습니다.`);
          return;
        }
        try {
          await archiveMemberCloud(button.dataset.archiveMember);
          await refreshCloudState();
          showToast(`${memberName} 계정을 보관했습니다.`);
        } catch (error) {
          button.disabled = false;
          showToast(friendlyErrorMessage(error, "계정을 보관하지 못했습니다."), "error");
        }
      });
    });

    document.querySelectorAll("[data-admin-client]").forEach((select) => {
      select.addEventListener("change", () => {
        state.adminSelectedClientId = select.value;
        saveState();
        render();
      });
    });

    document.querySelectorAll("[data-admin-assignment]").forEach((select) => {
      select.addEventListener("change", () => {
        state.adminSelectedAssignmentId = select.value;
        state.adminSelectedReportSessionId = null;
        const assignment = state.assignments.find((item) => item.id === select.value);
        if (assignment) state.adminSelectedClientId = assignment.clientId;
        saveState();
        render();
      });
    });

    document.querySelectorAll("[data-admin-report-session]").forEach((select) => {
      select.addEventListener("change", () => {
        state.adminSelectedReportSessionId = select.value;
        saveState();
        render();
      });
    });

    document.querySelectorAll("[data-publish-report]").forEach((button) => {
      button.addEventListener("click", async () => {
        const assignment = state.assignments.find((item) => item.id === button.dataset.publishReport);
        if (!assignment) return showToast("리포트를 만들 서비스 배정을 찾을 수 없습니다.", "error");
        const careSessionId = button.dataset.careSessionId || assignment.careSessionId;
        const careSession = (state.careSessions || []).find((item) => item.id === careSessionId)
          || (assignment.careSessionId === careSessionId ? { id: careSessionId, status: assignment.careSessionStatus, serviceDate: assignment.careSessionDate } : null);
        if (!careSessionId || careSession?.status !== "COMPLETED") {
          return showToast("완료된 케어 세션에 연결된 배정에서만 리포트를 발행할 수 있습니다.", "error");
        }
        if (state.reports.some((report) => report.careSessionId === careSessionId && report.status === "published")) {
          return showToast("이 방문 기록은 이미 발행되어 보관본으로 잠겼습니다.", "info");
        }
        const client = clientById(assignment.clientId);
        if (!client) return showToast("리포트 대상 고객 정보를 찾을 수 없습니다.", "error");
        const reportDate = careSession?.serviceDate ? formatDate(`${careSession.serviceDate}T12:00:00`) : todayLabel();
        const title = `${babyNameFor(assignment, client) || "Baby"} ${assignmentServiceType(assignment) === "BABYSITTING" ? "Babysitting" : "Care"} Report · ${reportDate}`;
        if (usingCloudData()) {
          button.disabled = true;
          button.textContent = "발행 중…";
          try {
            await publishCareReportCloud({ careSessionId, title });
            await refreshCloudState();
            showToast(`${client.motherName} 고객 화면으로 리포트를 보냈습니다.`);
          } catch (error) {
            showToast(friendlyErrorMessage(error, "리포트를 발행하지 못했습니다."), "error");
            button.disabled = false;
            button.textContent = "리포트 생성·고객에게 보내기";
          }
          return;
        }
        state.reports.push({ id: `report-${Date.now()}`, careSessionId, clientId: client.id, assignmentId: assignment.id, serviceType: assignmentServiceType(assignment), title, status: "published", publishedAt: new Date().toISOString(), publishedBy: authUser().id });
        saveState();
        render();
        showToast(`${client.motherName} 고객 화면으로 리포트를 보냈습니다.`);
      });
    });

    document.querySelectorAll("[data-print-report]").forEach((button) => button.addEventListener("click", () => window.print()));
    document.querySelectorAll("[data-print-care-report]").forEach((button) => button.addEventListener("click", () => openArchivedReportModal(button.dataset.printCareReport)));

    document.querySelectorAll("[data-switch-role]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextWorkspace = button.dataset.switchRole;
        if (!availableWorkspaceRoles().includes(nextWorkspace)) return showToast("이 작업공간에 접근할 권한이 없습니다.", "error");
        state.role = nextWorkspace;
        if (button.dataset.switchView) state.views[state.role] = button.dataset.switchView;
        saveState();
        render();
      });
    });

    document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", logout));
    document.querySelectorAll("[data-edit-profile]").forEach((button) => button.addEventListener("click", openProfileModal));
    document.querySelectorAll("[data-change-password]").forEach((button) => button.addEventListener("click", openPasswordModal));
    document.querySelectorAll("[data-open-assignment]").forEach((button) => button.addEventListener("click", () => openAssignmentModal(null, button.dataset.requestId || null)));
    document.querySelectorAll("[data-edit-assignment]").forEach((button) => button.addEventListener("click", () => openAssignmentModal(button.dataset.editAssignment)));
    document.querySelectorAll("[data-cancel-assignment]").forEach((button) => button.addEventListener("click", () => openDeleteAssignmentModal(button.dataset.cancelAssignment)));
    document.querySelectorAll("[data-review-client-request]").forEach((button) => button.addEventListener("click", () => openClientRequestModal(button.dataset.reviewClientRequest)));
    document.querySelectorAll("[data-record-deposit-refund]").forEach((button) => button.addEventListener("click", () => openDepositRefundModal(button.dataset.recordDepositRefund)));
    document.querySelectorAll("[data-record-service-refund]").forEach((button) => button.addEventListener("click", () => openServiceRefundModal(button.dataset.recordServiceRefund)));
    document.querySelectorAll("[data-view-service-history]").forEach((button) => button.addEventListener("click", () => openServiceHistoryDetailModal(button.dataset.viewServiceHistory)));
    document.querySelectorAll("[data-archive-service-request]").forEach((button) => button.addEventListener("click", () => openArchiveServiceRequestModal(button.dataset.archiveServiceRequest)));
    document.querySelectorAll("[data-record-approved-deposit]").forEach((button) => button.addEventListener("click", () => openApprovedDepositEvidenceModal(button.dataset.recordApprovedDeposit)));
    document.querySelectorAll("[data-record-service-balance]").forEach((button) => button.addEventListener("click", () => openServiceBalancePaymentModal(button.dataset.recordServiceBalance)));
    document.querySelectorAll("[data-massage-session-change]").forEach((button) => button.addEventListener("click", () => openMassageSessionChangeModal(button.dataset.massageSessionChange)));
    document.querySelectorAll("[data-review-massage-change]").forEach((button) => button.addEventListener("click", () => {
      const [changeId, decision] = button.dataset.reviewMassageChange.split(":");
      reviewMassageBookingChange(changeId, decision === "approve");
    }));
    document.querySelectorAll("[data-massage-availability-form]").forEach((form) => form.addEventListener("submit", saveMassageAvailability));
    document.querySelectorAll("[data-delete-massage-availability]").forEach((button) => button.addEventListener("click", () => deleteMassageAvailability(button.dataset.deleteMassageAvailability)));
    document.querySelectorAll("[data-finance-filter]").forEach((form) => {
      const periodSelect = form.elements.period;
      const yearSelect = form.elements.year;
      const monthSelect = form.elements.month;
      const allPeriodOption = periodSelect?.querySelector('option[value="ALL"]');
      if (allPeriodOption) {
        allPeriodOption.disabled = false;
        allPeriodOption.selected = state.financeFilters?.period === "ALL";
      }
      periodSelect?.addEventListener("change", () => {
        yearSelect.disabled = periodSelect.value === "ALL";
        monthSelect.disabled = periodSelect.value !== "MONTH";
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form).entries());
        state.financeFilters = {
          period: values.period || state.financeFilters?.period || "MONTH",
          year: values.year || state.financeFilters?.year || String(new Date().getFullYear()),
          month: values.month || state.financeFilters?.month || String(new Date().getMonth() + 1),
        };
        saveState();
        render();
      });
    });
    document.querySelectorAll("[data-service-history-filter]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      state.serviceHistoryFilters = {
        query: String(values.query || "").trim(),
        serviceType: values.serviceType || "ALL",
        status: values.status || "ALL",
        sort: values.sort || "newest",
      };
      saveState();
      render();
    }));
    document.querySelectorAll("[data-clear-service-history]").forEach((button) => button.addEventListener("click", () => {
      state.serviceHistoryFilters = { query: "", serviceType: "ALL", status: "ALL", sort: "newest" };
      saveState();
      render();
    }));
    document.querySelectorAll("[data-approve-adjustment]").forEach((button) => button.addEventListener("click", () => reviewServiceAdjustment(button.dataset.approveAdjustment, "APPROVE")));
    document.querySelectorAll("[data-reject-adjustment]").forEach((button) => button.addEventListener("click", () => reviewServiceAdjustment(button.dataset.rejectAdjustment, "REJECT")));
    document.querySelectorAll("[data-manage-client]").forEach((button) => button.addEventListener("click", () => openClientManagementModal(button.dataset.manageClient)));
    document.querySelectorAll("[data-manage-caregiver]").forEach((button) => button.addEventListener("click", () => openCaregiverManagementModal(button.dataset.manageCaregiver)));
    document.querySelectorAll("[data-people-section]").forEach((button) => button.addEventListener("click", () => {
      state.peopleDirectory = state.peopleDirectory || {};
      state.peopleDirectory.activeSection = button.dataset.peopleSection;
      saveState();
      render();
      window.requestAnimationFrame(() => document.querySelector(".people-section-tabs")?.scrollIntoView({ block: "start" }));
    }));
    document.querySelectorAll("[data-directory-search]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const scope = form.dataset.directorySearch;
      const values = Object.fromEntries(new FormData(form).entries());
      state.peopleDirectory[`${scope}Query`] = String(values.query || "").trim();
      state.peopleDirectory[`${scope}Page`] = 1;
      saveState();
      render();
    }));
    document.querySelectorAll("[data-clear-directory-search]").forEach((button) => button.addEventListener("click", () => {
      const scope = button.dataset.clearDirectorySearch;
      state.peopleDirectory[`${scope}Query`] = "";
      state.peopleDirectory[`${scope}Page`] = 1;
      saveState();
      render();
    }));
    document.querySelectorAll("[data-directory-sort]").forEach((select) => select.addEventListener("change", () => {
      const scope = select.dataset.directorySort;
      state.peopleDirectory[`${scope}Sort`] = select.value;
      state.peopleDirectory[`${scope}Page`] = 1;
      saveState();
      render();
    }));
    document.querySelectorAll("[data-directory-size]").forEach((select) => select.addEventListener("change", () => {
      const scope = select.dataset.directorySize;
      state.peopleDirectory[`${scope}PageSize`] = Number(select.value);
      state.peopleDirectory[`${scope}Page`] = 1;
      saveState();
      render();
    }));
    document.querySelectorAll("[data-directory-page]").forEach((button) => button.addEventListener("click", () => {
      const scope = button.dataset.directoryPage;
      state.peopleDirectory[`${scope}Page`] = Number(button.dataset.page);
      saveState();
      render();
    }));
    document.querySelectorAll("[data-calendar-month]").forEach((button) => button.addEventListener("click", () => { state.calendarMonthOffset += Number(button.dataset.calendarMonth); saveState(); render(); }));
    document.querySelectorAll("[data-calendar-today]").forEach((button) => button.addEventListener("click", () => { state.calendarMonthOffset = 0; saveState(); render(); }));
    document.querySelectorAll("[data-schedule-filter]").forEach((button) => button.addEventListener("click", () => { state.adminScheduleFilter = button.dataset.scheduleFilter; saveState(); render(); }));
  }

  function addProductToCart(productId) {
    if (usingCloudData()) return showToast("리테일 주문 백엔드 연결 준비 중입니다.", "info");
    const product = productById(productId);
    const cart = activeCart();
    const existing = cart.find((item) => item.productId === productId);
    const currentQuantity = existing?.quantity || 0;
    if (currentQuantity >= stockFor(productId)) {
      showToast("현재 재고보다 많이 담을 수 없습니다.");
      return;
    }
    if (existing) existing.quantity += 1;
    else cart.push({ productId, quantity: 1 });
    saveState();
    render();
    showToast(`${product.name}을 장바구니에 담았습니다.`);
  }

  function changeCartQuantity(productId, delta) {
    if (usingCloudData()) return showToast("리테일 주문 백엔드 연결 준비 중입니다.", "info");
    const cart = activeCart();
    const item = cart.find((entry) => entry.productId === productId);
    if (!item) return;
    if (delta > 0 && item.quantity >= stockFor(productId)) {
      showToast("현재 재고보다 많이 담을 수 없습니다.");
      return;
    }
    item.quantity += delta;
    if (item.quantity <= 0) state.retail.carts[cartKey()] = cart.filter((entry) => entry.productId !== productId);
    saveState();
    render();
  }

  function completeDemoCheckout(context) {
    if (usingCloudData()) return showToast("리테일 결제 백엔드 연결 준비 중입니다.", "info");
    const cart = activeCart();
    if (!cart.length) return;
    const orderNumber = 1050 + state.retail.orders.length;
    const clientRecord = context === "client" ? clientForUser(authUser().id) : state.clients.find((client) => client.motherName === state.retail.cartCustomer) || null;
    const customer = context === "client" ? clientRecord?.motherName || authUser().fullName : state.retail.cartCustomer;
    const order = {
      id: `KW-${orderNumber}`,
      clientId: clientRecord?.id || null,
      customer,
      channel: context === "client" ? "CLIENT_APP" : "STORE_POS",
      status: context === "client" || clientRecord ? "주문 접수" : "배송 완료",
      total: cartTotal(),
      createdAt: new Date().toISOString(),
      items: cart.map((item) => ({ ...item })),
    };
    order.items.forEach((item, index) => {
      state.retail.inventoryMovements.push({ id: `mv-${Date.now()}-${index}`, productId: item.productId, type: "SALE", quantity: -item.quantity, at: order.createdAt, orderId: order.id });
    });
    state.retail.orders.push(order);
    state.retail.carts[cartKey()] = [];
    state.views[state.role] = context === "client" ? "purchases" : "orders";
    saveState();
    render();
    showToast(`${order.id} ${context === "client" ? "로컬 주문을 접수" : "로컬 판매를 완료"}했습니다.`);
  }

  function localDateTimeInputValue(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return `${localDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function deviceUtcOffsetLabel(value = new Date()) {
    const minutes = -(value instanceof Date ? value : new Date(value)).getTimezoneOffset();
    const sign = minutes >= 0 ? "+" : "-";
    const absolute = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  }

  function radioOptions(name, options, selected) {
    const minimumTwoWeekField = name === "weeks" || name === "requestedWeeks";
    return options
      .filter(([value]) => !minimumTwoWeekField || Number(value) >= MIN_SERVICE_WEEKS)
      .map(
        ([value, label]) => `<label class="radio-option"><input type="radio" name="${name}" value="${value}" ${value === selected ? "checked" : ""} required /><span>${label}</span></label>`,
      )
      .join("");
  }

  function openCaregiverAssignmentDetailModal(assignmentId) {
    const user = authUser();
    const assignment = state.assignments.find((item) => item.id === assignmentId && item.status !== "CANCELLED");
    if (!assignment || user?.role !== "caregiver" || assignment.caregiverUserId !== user.id) return showToast("본인에게 배정된 일정 정보만 확인할 수 있습니다.");
    if (!caregiverCanViewClientBrief(assignment)) return showToast(caregiverClientBriefAccessText(assignment));
    const client = clientById(assignment.clientId);
    if (!client) return showToast("배정된 고객 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.", "error");
    const massage = assignmentServiceType(assignment) === "MASSAGE";
    if (massage) {
      modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal assignment-detail-modal" role="dialog" aria-modal="true" aria-labelledby="caregiver-assignment-detail-title"><header class="modal-header"><div>${serviceBadgeMarkup("MASSAGE")}<p class="eyebrow">MASSAGE APPOINTMENT BRIEF</p><h3 id="caregiver-assignment-detail-title">마사지 예약·방문 정보</h3><p>${assignmentCountdown(assignment)} · ${formatDate(assignment.startAt)} ${assignment.dailyStart}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><div class="modal-form"><div class="profile-summary"><div class="profile-summary-person"><div class="profile-avatar">✦</div><div><strong>${escapeHtml(client.motherName)}</strong><span>${assignment.durationMinutes || 60}분 · ${assignment.sessionCount || 1}회 ${serviceMetaFor("MASSAGE").label}</span></div></div><div class="profile-summary-tags"><span>${assignment.pricingTier === "POSTPARTUM_CLIENT" ? "산후조리 고객 우대" : "일반 고객"}</span><span>${new Date(assignment.startAt) > new Date() ? "예약 예정" : "진행 일정"}</span></div></div><div class="request-review-grid"><div><span>예약 구성</span><strong>${assignment.durationMinutes || 60}분 × ${assignment.sessionCount || 1}회</strong></div><div><span>예약 시간</span><strong>${assignment.dailyStart}–${assignment.dailyEnd}</strong></div><div class="wide"><span>방문 주소</span><strong>${escapeHtml(assignment.address || client.address || "미등록")}</strong></div><div><span>선호 언어</span><strong>${escapeHtml(client.preferredLanguage || "미등록")}</strong></div><div><span>비상 연락처</span><strong>${escapeHtml(client.emergencyContact || "미등록")}</strong></div><div class="wide"><span>고객 요청사항</span><strong>${escapeHtml(assignment.requestNote || client.requestNote || "별도 요청사항 없음")}</strong></div></div><div class="privacy-boundary-note"><strong>마사지 예약 전용 정보</strong><span>예약 수행에 필요한 방문 정보만 표시됩니다. 산후조리·베이비시팅 케어 기록 화면과는 분리되어 있습니다.</span></div><div class="form-actions"><button type="button" class="primary-button" data-close-modal>확인 완료</button></div></div></section></div>`;
      bindModalFrame();
      return;
    }
    const babysitting = assignmentServiceType(assignment) === "BABYSITTING";
    const babyName = babyNameFor(assignment, client) || "아이";
    const baby = findClientBaby(client, babyName, assignment.babyId);
    const babyBirthDate = baby?.birthDate || client.babyBirthDate;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal assignment-detail-modal" role="dialog" aria-modal="true" aria-labelledby="caregiver-assignment-detail-title"><header class="modal-header"><div>${serviceBadgeMarkup(assignment.serviceType)}<p class="eyebrow">ASSIGNED CLIENT BRIEF</p><h3 id="caregiver-assignment-detail-title">배정 고객 준비정보</h3><p>${assignmentCountdown(assignment)} · ${formatDate(assignment.startAt)} 시작</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><div class="modal-form"><div class="profile-summary"><div class="profile-summary-person"><div class="profile-avatar">${escapeHtml((babyName || "B")[0])}</div><div><strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyName)}</strong><span>${assignment.dailyStart}–${assignment.dailyEnd} · ${assignment.weeks}주 ${serviceMetaFor(assignment.serviceType).label}</span></div></div><div class="profile-summary-tags"><span>${assignmentCountdown(assignment)}</span><span>${new Date(assignment.startAt) > new Date() ? "예정된 배정" : "현재 배정"}</span></div></div><div class="request-review-grid"><div><span>${babysitting ? "아이 출생일" : "출산일·예정일"}</span><strong>${babyBirthDate ? formatDate(babyBirthDate) : "미등록"}</strong></div>${babysitting ? `<div><span>생활 루틴</span><strong>${escapeHtml(assignment.routineNotes || "별도 지침 없음")}</strong></div>` : `<div><span>산모 상태</span><strong>${escapeHtml(client.maternalStatus || "기록 전")}</strong></div>`}<div class="wide"><span>방문 주소</span><strong>${escapeHtml(assignment.address || client.address || "미등록")}</strong></div><div><span>알러지·주의사항</span><strong>${escapeHtml(assignment.allergies || client.allergies || "없음")}</strong></div><div><span>가정 내 추가인원</span><strong>${Number(assignment.extraHouseholdMembers || 0)}명</strong></div><div><span>선호 언어</span><strong>${escapeHtml(client.preferredLanguage || "미등록")}</strong></div><div><span>방문 시간</span><strong>${assignment.dailyStart}–${assignment.dailyEnd}</strong></div>${babysitting ? `<div class="wide"><span>식사·간식 지침</span><strong>${escapeHtml(assignment.mealInstructions || "별도 지침 없음")}</strong></div><div class="wide"><span>인계·출입 지침</span><strong>${escapeHtml(assignment.pickupNotes || "별도 지침 없음")}</strong></div>` : ""}<div class="wide"><span>고객 요청 메모</span><strong>${escapeHtml(assignment.requestNote || client.requestNote || "별도 요청사항 없음")}</strong></div></div><div class="privacy-boundary-note"><strong>접근 범위 안내</strong><span>확정 배정의 시작 7일 전부터 준비에 필요한 고객 정보만 표시됩니다. 기록 입력은 실제 배정 기간에만 활성화됩니다.</span></div><div class="form-actions"><button type="button" class="primary-button" data-close-modal>확인 완료</button></div></div></section></div>`;
    bindModalFrame();
  }

  function openServiceReviewPhotoModal(reviewId, availableSlots = 1) {
    const user = authUser();
    const client = state.role === "client" ? clientForUser(user?.id) : null;
    const review = state.reviews.find((item) => item.id === reviewId && item.clientId === client?.id && item.source === "CLIENT");
    if (!review || !review.publicConsent) return showToast("공개 동의가 있는 본인 후기만 사진을 추가할 수 있습니다.", "error");
    const slots = Math.max(0, Math.min(3, Number(availableSlots || 0)));
    if (!slots) return showToast("후기 사진은 최대 3장까지 등록할 수 있습니다.", "info");
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="review-photo-title"><header class="modal-header"><div><p class="eyebrow">REVIEW PHOTOS</p><h3 id="review-photo-title">후기 사진 추가</h3><p>이 후기에는 사진을 ${slots}장 더 추가할 수 있습니다.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-add-review-photos-form data-review-id="${review.id}" data-photo-slots="${slots}"><div class="field"><label for="additional-review-photos">후기 사진</label><input id="additional-review-photos" name="reviewPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple required/><small>JPG·PNG·WebP, 장당 최대 5MB. 아이 얼굴·이름·연락처·주소·의료정보가 보이는 사진은 올리지 마세요.</small><div class="review-photo-preview" data-review-photo-preview></div></div><div class="privacy-boundary-note"><strong>홈페이지 공개 사진</strong><span>관리자가 후기 원문과 사진의 개인정보를 확인한 뒤 공개 대상으로 선정합니다. 이미 연결된 사진은 후기의 진정성을 위해 고객이 직접 삭제하거나 교체할 수 없습니다.</span></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">사진 추가</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-add-review-photos-form]");
    bindReviewPhotoPreview(form);
    form.addEventListener("submit", saveAdditionalServiceReviewPhotos);
  }

  async function saveAdditionalServiceReviewPhotos(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const review = state.reviews.find((item) => item.id === form.dataset.reviewId && item.source === "CLIENT");
    const files = selectedReviewPhotoFiles(form);
    const slots = Number(form.dataset.photoSlots || 0);
    const error = validateReviewPhotoSelection(files);
    if (!review || !review.publicConsent) return showToast("후기 공개 상태를 다시 확인해 주세요.", "error");
    if (error) return showToast(error, "error");
    if (!files.length || files.length > slots) return showToast(`사진을 1장 이상 ${slots}장 이하로 선택해 주세요.`, "error");
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      if (usingCloudData()) {
        await addServiceReviewPhotosCloud(review.id, files);
        closeModal();
        await refreshCloudState();
      } else {
        const photoUrls = await reviewFilesToDataUrls(files);
        review.photoUrls = [...(review.photoUrls || []), ...photoUrls].slice(0, 3);
        saveState();
        closeModal();
        render();
      }
      showToast("후기 사진을 추가했습니다. 관리자 확인 후 후기와 함께 공개됩니다.");
    } catch (uploadError) {
      showToast(friendlyErrorMessage(uploadError, "후기 사진을 추가하지 못했습니다."), "error");
      submitButton.disabled = false;
    }
  }

  function openServiceReviewModal(assignmentId) {
    const user = authUser();
    const client = state.role === "client" ? clientForUser(user?.id) : null;
    const assignment = state.assignments.find((item) => item.id === assignmentId && item.clientId === client?.id && !item.administrativelyRemovedAt);
    if (!assignment || !assignmentHasCompletedCare(assignment)) return showToast("실제 케어 제공 기록이 확인된 종료 서비스에만 후기를 작성할 수 있습니다.");
    if (state.reviews.some((review) => review.assignmentId === assignment.id)) return showToast("이 배정에는 이미 후기를 작성했습니다.");
    const caregiver = state.users.find((item) => item.id === assignment.caregiverUserId);
    if (isMassageOnlyProfessional(caregiver)) return showToast("마사지 전용 테라피스트는 평점·후기 대신 이력과 전문 분야를 제공합니다.", "info");
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="service-review-title"><header class="modal-header"><div><p class="eyebrow">SERVICE REVIEW</p><h3 id="service-review-title">${escapeHtml(caregiver?.fullName || "담당 관리사")} 관리사 후기</h3><p>실제 제공이 확인된 종료 서비스 배치마다 한 번 작성할 수 있습니다.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-service-review-form data-assignment-id="${assignment.id}">${reviewCompetencySurveyMarkup("service-review")}<div class="field"><span class="field-label">좋았던 점</span><div class="review-tag-options">${["세심한 케어", "정확한 기록", "친절한 소통", "시간 준수", "전문적인 지원"].map((tag) => `<label><input type="checkbox" name="tags" value="${tag}"/><span>${tag}</span></label>`).join("")}</div></div><div class="field"><label for="review-comment">후기</label><textarea id="review-comment" name="comment" maxlength="500" placeholder="서비스에서 좋았던 점이나 개선 의견을 남겨주세요." required></textarea><small>제출한 원문은 관리사와 운영 관리자에게 서비스 개선 목적으로 공유됩니다.</small></div><div class="field"><label for="review-photos">후기 사진 <small>선택 · 최대 3장</small></label><input id="review-photos" name="reviewPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled/><small>홈페이지 공개에 동의한 경우에만 첨부할 수 있습니다. 아이 얼굴·이름·연락처·주소·의료정보가 보이는 사진은 올리지 마세요.</small><div class="review-photo-preview" data-review-photo-preview></div></div><label class="review-public-consent"><input type="checkbox" name="publicConsent"/><span><strong>홈페이지 익명 후기와 첨부 사진 공개에 동의합니다.</strong><small>고객 이름은 표시하지 않으며, 관리자가 개인정보를 확인한 뒤 공개합니다. 선택하지 않아도 종합평점은 익명 평균에 반영됩니다.</small></span></label><div class="privacy-boundary-note"><strong>원문은 한 번만 제출 가능</strong><span>공정한 후기 관리를 위해 6개 전문 역량 점수와 자동 계산된 종합평점, 후기 원문은 제출 후 수정할 수 없습니다. 공개 동의가 있는 후기에는 사진을 최대 3장까지 추가할 수 있습니다.</span></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">후기 제출</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-service-review-form]");
    const consent = form.querySelector('[name="publicConsent"]');
    const photoInput = form.querySelector('[name="reviewPhotos"]');
    consent.addEventListener("change", () => {
      photoInput.disabled = !consent.checked;
      if (!consent.checked) {
        photoInput.value = "";
        form.querySelector("[data-review-photo-preview]").innerHTML = "";
      }
    });
    bindReviewPhotoPreview(form);
    form.addEventListener("submit", saveServiceReview);
  }

  async function saveServiceReview(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const user = authUser();
    const client = state.role === "client" ? clientForUser(user?.id) : null;
    const assignment = state.assignments.find((item) => item.id === form.dataset.assignmentId && item.clientId === client?.id && !item.administrativelyRemovedAt);
    if (!assignment || !assignmentHasCompletedCare(assignment)) return showToast("실제 케어 제공 기록이 확인된 종료 서비스에만 후기를 작성할 수 있습니다.", "error");
    const caregiver = state.users.find((item) => item.id === assignment.caregiverUserId);
    if (isMassageOnlyProfessional(caregiver)) return showToast("마사지 전용 테라피스트에게는 평점·후기를 등록하지 않습니다.", "info");
    if (state.reviews.some((review) => review.assignmentId === assignment.id)) return showToast("이 배정에는 이미 후기를 작성했습니다.", "info");
    const formData = new FormData(form);
    const competencyScores = competencyScoresFromFormData(formData);
    const rating = reviewOverallRating(competencyScores);
    const comment = String(formData.get("comment") || "").trim();
    if (rating == null || !competencyScores || !comment) return showToast("6개 전문 역량과 후기 내용을 모두 입력해 주세요.", "error");
    const tags = formData.getAll("tags");
    const publicConsent = formData.get("publicConsent") === "on";
    const photoFiles = selectedReviewPhotoFiles(form);
    const photoError = validateReviewPhotoSelection(photoFiles);
    if (photoError) return showToast(photoError, "error");
    if (photoFiles.length && !publicConsent) return showToast("사진을 첨부하려면 홈페이지 익명 공개에 동의해 주세요.", "error");
    if (usingCloudData()) {
      const submitButton = form.querySelector('button[type="submit"]');
      if (!assignment.caregiverId) return showToast("담당 관리사 정보를 확인할 수 없습니다.", "error");
      submitButton.disabled = true;
      submitButton.textContent = "후기 저장 중…";
      try {
        const result = await saveServiceReviewCloud({ assignmentId: assignment.id, competencyScores, tags, comment, publicConsent, photoFiles });
        closeModal();
        await refreshCloudState();
        showToast(result.photo_upload_error ? `후기는 등록했지만 사진은 연결하지 못했습니다. 완료 서비스 후기에서 다시 추가해 주세요. (${result.photo_upload_error})` : "관리사 후기와 사진이 등록되었습니다. 소중한 의견 감사합니다.", result.photo_upload_error ? "error" : "success");
      } catch (error) {
        showToast(friendlyErrorMessage(error, "후기를 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "후기 제출";
      }
      return;
    }
    const photoUrls = await reviewFilesToDataUrls(photoFiles);
    state.reviews.push({ id: `review-${Date.now()}`, assignmentId: assignment.id, clientId: client.id, caregiverUserId: assignment.caregiverUserId, rating, competencyScores, tags, comment, photoUrls, photoPaths: [], createdAt: new Date().toISOString(), createdBy: user.id, source: "CLIENT", publicConsent, publicationStatus: publicConsent ? "PENDING" : "PRIVATE", validityStatus: "VALID", moderationHistory: [] });
    saveState();
    closeModal();
    render();
    showToast("관리사 후기가 등록되었습니다. 소중한 의견 감사합니다.");
  }

  function openClientManagementModal(clientId, babyId = null) {
    if (state.role !== "admin") return showToast("관리자만 고객 관리정보를 수정할 수 있습니다.");
    const client = clientById(clientId);
    if (!client) return showToast("고객 정보를 찾을 수 없습니다.");
    const user = state.users.find((item) => item.id === client.userId);
    const assignments = state.assignments.filter((item) => item.clientId === client.id && item.status !== "CANCELLED").sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    const activeAssignment = assignments.find(isAssignmentCurrent);
    const upcomingAssignment = assignments.find((item) => new Date(item.startAt) > new Date());
    const assignment = activeAssignment || upcomingAssignment || assignments.at(-1);
    const caregiver = assignment ? state.users.find((item) => item.id === assignment.caregiverUserId) : null;
    const clientBabies = babiesForClient(client);
    const managedBaby = findClientBaby(client, "", babyId || assignment?.babyId || client.babyId) || clientBabies[0] || null;
    const managedBabyName = managedBaby?.name || client.babyName || "";
    const managedBabyBirthDate = managedBaby?.birthDate || client.babyBirthDate || "";
    const managedBabyAdminNotes = managedBaby?.adminNotes ?? (managedBaby?.id === client.babyId ? client.babyAdminNotes : "") ?? "";
    const lifecycleOptions = [["LEAD", "상담·승인 전"], ["ACTIVE", "서비스 관리 중"], ["PAUSED", "일시 중지"], ["COMPLETED", "서비스 종료"]];
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="client-management-title"><header class="modal-header"><div><p class="eyebrow">CLIENT CRM</p><h3 id="client-management-title">고객·아기 상세관리</h3><p>관리자 전용 상담·운영 정보</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-client-management-form>
      <div class="profile-summary"><div class="profile-summary-person"><div class="profile-avatar">${escapeHtml(client.motherName[0])}</div><div><strong>${escapeHtml(client.motherName)}</strong><span>${escapeHtml(user?.email || "이메일 미등록")} · ${escapeHtml(user?.phone || "전화 미등록")}</span></div></div><div class="profile-summary-tags"><span>${escapeHtml(client.clientStatus || "ACTIVE")}</span><span>${assignment ? `${assignment.weeks}주 계약` : "계약 없음"}</span><span>${caregiver ? `담당 ${escapeHtml(caregiver.fullName)}` : "관리사 미배정"}</span></div></div>
      <section class="profile-form-section"><div class="profile-section-title"><strong>고객 기본정보</strong><span>연락 및 CRM 상태</span></div><div class="form-grid two"><div class="field"><label for="client-full-name">고객 이름</label><input id="client-full-name" name="fullName" value="${escapeHtml(client.motherName)}" required /></div><div class="field"><label for="client-phone">전화번호</label><input id="client-phone" name="phone" value="${escapeHtml(user?.phone || "")}" /></div></div><div class="form-grid two"><div class="field"><label for="client-email">로그인 이메일</label><input id="client-email" value="${escapeHtml(user?.email || "")}" readonly /></div><div class="field"><label for="client-lifecycle">고객 관리상태</label><select id="client-lifecycle" name="clientStatus">${lifecycleOptions.map(([value, label]) => `<option value="${value}" ${value === (client.clientStatus || "ACTIVE") ? "selected" : ""}>${label}</option>`).join("")}</select></div></div><div class="form-grid two"><div class="field"><label for="maternal-status">산모 상태</label><input id="maternal-status" name="maternalStatus" value="${escapeHtml(client.maternalStatus || "")}" placeholder="회복 상태, 상담 시 확인사항" /></div><div class="field"><label for="preferred-language">선호 언어</label><input id="preferred-language" name="preferredLanguage" value="${escapeHtml(client.preferredLanguage || "")}" placeholder="한국어, English" /></div></div><div class="form-grid two"><div class="field"><label for="emergency-contact">비상 연락처</label><input id="emergency-contact" name="emergencyContact" value="${escapeHtml(client.emergencyContact || "")}" placeholder="이름 · 전화번호 · 관계" /></div><div class="field"><label for="client-next-contact">다음 상담 예정일</label><input id="client-next-contact" name="nextContactDate" type="date" value="${client.nextContactDate ? dateInputValue(client.nextContactDate) : ""}" /></div></div></section>
      <section class="profile-form-section"><div class="profile-section-title"><strong>아기·가정 정보</strong><span>케어 배정 시 참고</span></div>${clientBabies.length > 1 ? `<div class="field"><label for="managed-baby-selector">관리할 아이</label><select id="managed-baby-selector" data-managed-baby-selector>${clientBabies.map((baby) => `<option value="${escapeHtml(baby.id || "")}" ${baby.id === managedBaby?.id ? "selected" : ""}>${escapeHtml(baby.name || "이름 미등록")}</option>`).join("")}</select><small>아이별 이름·출생일·관리 메모를 구분해 저장합니다.</small></div>` : ""}<input type="hidden" name="babyId" value="${escapeHtml(managedBaby?.id || client.babyId || "")}"/><div class="form-grid two"><div class="field"><label for="managed-baby-name">아기 이름</label><input id="managed-baby-name" name="babyName" value="${escapeHtml(managedBabyName)}" required /></div><div class="field"><label for="managed-baby-birth">출산일·출산 예정일</label><input id="managed-baby-birth" name="babyBirthDate" type="date" value="${managedBabyBirthDate ? dateInputValue(managedBabyBirthDate) : ""}" required /></div></div><div class="field"><label for="managed-client-address">서비스 주소</label><input id="managed-client-address" name="address" value="${escapeHtml(client.address || "")}" ${usingCloudData() ? 'readonly aria-readonly="true"' : ""}/>${usingCloudData() ? "<small>확정된 서비스 주소 변경은 고객의 일정 변경 요청을 통해 처리합니다.</small>" : ""}</div><div class="form-grid two"><div class="field"><label for="managed-allergies">알러지·주의사항</label><input id="managed-allergies" name="allergies" value="${escapeHtml(client.allergies || "없음")}" ${usingCloudData() ? 'readonly aria-readonly="true"' : ""}/></div><div class="field"><label for="managed-household">가정 내 추가인원</label><input id="managed-household" name="extraHouseholdMembers" type="number" min="0" value="${Number(client.extraHouseholdMembers || 0)}" ${usingCloudData() ? 'readonly aria-readonly="true"' : ""}/></div></div><div class="field"><label for="managed-request-note">고객 요청사항</label><textarea id="managed-request-note" name="requestNote">${escapeHtml(client.requestNote || "")}</textarea></div><div class="field"><label for="baby-admin-notes">아기 관리 메모 <span class="admin-only-label">관리자 전용</span></label><textarea id="baby-admin-notes" name="babyAdminNotes" placeholder="아기의 상담·운영 관점 메모를 기록하세요.">${escapeHtml(managedBabyAdminNotes)}</textarea></div></section>
      <section class="profile-form-section internal-note-section"><div class="profile-section-title"><strong>CRM 내부 메모</strong><span>고객·관리사 화면에는 표시되지 않습니다.</span></div><div class="field"><label for="client-internal-memo">상담 이력·계약 특이사항</label><textarea id="client-internal-memo" name="internalMemo" placeholder="상담 결과, 연락 선호시간, 갱신 계획 등 내부 메모를 입력하세요.">${escapeHtml(client.internalMemo || "")}</textarea></div><small class="record-meta">마지막 수정: ${client.managementUpdatedAt ? new Date(client.managementUpdatedAt).toLocaleString("ko-KR") : "기록 전"}</small></section>
      <div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">고객정보 저장</button></div>
    </form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-managed-baby-selector]")?.addEventListener("change", (event) => openClientManagementModal(client.id, event.target.value));
    modalRoot.querySelector("[data-client-management-form]").addEventListener("submit", (event) => saveClientManagement(event, client.id));
  }

  async function saveClientManagement(event, clientId) {
    event.preventDefault();
    if (state.role !== "admin") return showToast("관리자 권한이 필요합니다.");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const client = clientById(clientId);
    if (!client) return showToast("저장할 고객 정보를 찾을 수 없습니다. 목록을 새로고침해 주세요.", "error");
    const user = state.users.find((item) => item.id === client.userId);
    if (usingCloudData()) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        await updateClientManagementCloud(client, values);
        closeModal();
        await refreshCloudState();
        showToast(`${values.fullName.trim()} 고객과 아기 정보를 저장했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "고객 관리정보를 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
      }
      return;
    }
    const managedBaby = findClientBaby(client, values.babyName, values.babyId || null);
    const managedBabyBirthDate = new Date(`${values.babyBirthDate}T12:00:00`).toISOString();
    Object.assign(client, {
      motherName: values.fullName.trim(),
      clientStatus: values.clientStatus,
      maternalStatus: values.maternalStatus.trim(),
      preferredLanguage: values.preferredLanguage.trim(),
      emergencyContact: values.emergencyContact.trim(),
      nextContactDate: values.nextContactDate ? new Date(`${values.nextContactDate}T12:00:00`).toISOString() : null,
      address: values.address.trim(),
      allergies: values.allergies.trim() || "없음",
      extraHouseholdMembers: Number(values.extraHouseholdMembers || 0),
      requestNote: values.requestNote.trim(),
      internalMemo: values.internalMemo.trim(),
      managementUpdatedAt: new Date().toISOString(),
      managementUpdatedBy: authUser().id,
    });
    if (managedBaby) Object.assign(managedBaby, { name: values.babyName.trim(), birthDate: managedBabyBirthDate, adminNotes: values.babyAdminNotes.trim() });
    if (!managedBaby || managedBaby.id === client.babyId) Object.assign(client, { babyName: values.babyName.trim(), babyBirthDate: managedBabyBirthDate, babyAdminNotes: values.babyAdminNotes.trim() });
    if (user) Object.assign(user, { fullName: client.motherName, phone: values.phone.trim(), initials: initialsFor(client.motherName) });
    if (state.session.clientId === client.id && (!values.babyId || state.session.babyId === values.babyId)) Object.assign(state.session, { clientName: client.motherName, babyName: values.babyName.trim(), babyInitial: values.babyName.trim()[0] || "B" });
    saveState();
    closeModal();
    render();
    showToast(`${client.motherName} 고객과 아기 정보를 저장했습니다.`);
  }

  function openCaregiverManagementModal(userId) {
    if (state.role !== "admin" || !canManageCaregiverHr()) return showToast("소유자 또는 관리자만 관리사 인사정보를 수정할 수 있습니다.");
    const user = state.users.find((item) => item.id === userId && (usingCloudData() ? item.databaseRoles?.includes("CAREGIVER") : item.role === "caregiver"));
    if (!user) return showToast("관리사 정보를 찾을 수 없습니다.");
    const assignments = state.assignments.filter((item) => item.caregiverUserId === user.id && item.status !== "CANCELLED").sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    const current = assignments.find(isAssignmentCurrent);
    const currentClient = current ? clientById(current.clientId) : null;
    const employmentOptions = [["APPLICANT", "지원자·승인 대기"], ["ACTIVE", "재직"], ["ON_LEAVE", "휴직"], ["INACTIVE", "퇴사·비활성"]];
    const hrSetupRequired = user.status === "approved" && user.hasHrProfile === false;
    const employmentValue = user.status === "pending" ? "APPLICANT" : user.employmentStatus || (usingCloudData() ? "INACTIVE" : "ACTIVE");
    const publicProfile = user.publicProfile || (state.publicCaregivers || []).find((item) => item.caregiverUserId === user.id || item.caregiverId === user.caregiverId) || {};
    const massageOnly = isMassageOnlyProfessional(user);
    const caregiverReviews = state.reviews.filter((review) => review.caregiverUserId === user.id).sort((a, b) => new Date(b.serviceDate || b.createdAt) - new Date(a.serviceDate || a.createdAt));
    const activeReviews = caregiverReviews.filter((review) => !review.archived && (
      (review.source === "CLIENT" && review.validityStatus !== "INVALID")
      || (review.source === "VERIFIED_EXTERNAL" && review.verificationStatus === "VERIFIED")
    ));
    const reviewAverage = publicProfile.averageRating != null ? Number(publicProfile.averageRating).toFixed(1) : activeReviews.length ? (activeReviews.reduce((sum, review) => sum + Number(review.rating), 0) / activeReviews.length).toFixed(1) : null;
    const reviewCount = publicProfile.averageRating != null ? Number(publicProfile.reviewCount || 0) : activeReviews.length;
    const reviewManagementMarkup = caregiverReviews.length ? caregiverReviews.map((review) => {
      const isLegacy = review.source !== "CLIENT";
      const verifiedExternal = review.source === "VERIFIED_EXTERNAL" && review.verificationStatus === "VERIFIED";
      const invalid = !isLegacy && review.validityStatus === "INVALID";
      const status = invalid ? "INVALID" : review.archived ? "ARCHIVED" : review.publicationStatus || "PRIVATE";
      const statusLabel = isLegacy && !verifiedExternal && !review.archived
        ? "증빙 확인 대기"
        : status === "INVALID" ? "평점 제외" : status === "PUBLISHED" ? "홈페이지 공개" : status === "PENDING" ? "공개 검토 대기" : status === "ARCHIVED" ? "보관됨" : "비공개";
      const publicationAction = review.publicConsent
        ? `<button type="button" class="text-button" data-client-review-publication="${review.id}" data-next-status="${status === "PUBLISHED" ? "HIDDEN" : "PUBLISHED"}">${status === "PUBLISHED" ? "홈페이지에서 숨기기" : "홈페이지 공개 선정"}</button>`
        : `<small>고객 공개 동의 없음</small>`;
      const action = isLegacy
        ? `${verifiedExternal || review.archived ? "" : `<button type="button" class="text-button" data-verify-historical-review="${review.id}">증빙 사진 추가·확인</button>`}<button type="button" class="text-button" data-toggle-historical-review="${review.id}" data-next-published="${status !== "PUBLISHED"}">${status === "PUBLISHED" ? "숨기기" : "공개"}</button>${review.archived ? "" : `<button type="button" class="text-button danger-text" data-archive-historical-review="${review.id}">보관</button>`}`
        : invalid
          ? `<button type="button" class="text-button" data-restore-client-review="${review.id}">유효 후기 복원</button>`
          : `${publicationAction}<button type="button" class="text-button danger-text" data-invalidate-client-review="${review.id}">무효 후기 평점 제외</button>`;
      const moderationNote = invalid ? `<small class="review-moderation-reason"><strong>${escapeHtml(reviewInvalidReasonLabel(review.invalidReasonCode))}</strong>${review.invalidReasonNote ? ` · ${escapeHtml(review.invalidReasonNote)}` : ""}</small>` : "";
      const sourceLabel = verifiedExternal ? "외부 경로 확인 후기 · 통합 평점 반영" : isLegacy ? "외부 후기 자료 · 증빙 확인 전" : "ProMoms 실제 서비스 후기";
      return `<article class="caregiver-review-admin-row ${invalid ? "invalidated" : ""}"><div>${reviewOverallRatingMarkup(review)}<strong>${isLegacy ? escapeHtml(review.reviewerAlias || "이전 서비스 고객") : "ProMoms 서비스 이용 고객"}</strong><small>${sourceLabel} · ${review.serviceDate ? formatDate(review.serviceDate) : new Date(review.createdAt).toLocaleDateString("ko-KR")}</small>${moderationNote}</div><div>${reviewCompetencySummaryMarkup(review.competencyScores, true)}<p>${escapeHtml(review.comment)}</p>${reviewPhotoGalleryMarkup(review, verifiedExternal ? "외부 후기 원본 사진" : "후기 첨부 사진")}</div><div class="caregiver-review-admin-actions"><span class="status-chip ${status === "INVALID" ? "coral" : status === "PUBLISHED" ? "" : "gold"}">${statusLabel}</span>${action}</div></article>`;
    }).join("") : `<div class="empty-state"><strong>등록된 후기가 없습니다.</strong><span>실제 서비스 완료 후기 또는 이전 후기 자료를 추가할 수 있습니다.</span></div>`;
    const reviewManagementSection = massageOnly
      ? `<section class="profile-form-section massage-only-profile-policy"><div class="profile-section-title"><strong>마사지 전용 공개 프로필</strong><span>평점·후기 미사용</span></div><div class="privacy-boundary-note"><strong>이력과 전문 분야 중심으로 표시됩니다.</strong><span>마사지 전용 테라피스트는 별점, 고객 후기와 돌봄 역량 육각형을 사용하지 않습니다. 위의 ‘마사지 주요 이력’과 ‘마사지 전문 분야’를 저장하면 홈페이지 카드와 상세 프로필에 반영됩니다.</span></div></section>`
      : `<section class="profile-form-section caregiver-review-management"><div class="profile-section-title"><strong>평점·후기 관리</strong><span>${reviewAverage ? `통합 확인 평균 ${reviewAverage}점 · ${reviewCount}건` : "확인된 후기 없음"}</span></div><div class="privacy-boundary-note"><strong>공개 선정과 평점 검증을 분리합니다.</strong><span>ProMoms 완료 서비스의 유효 고객 후기와 원본 사진·확인 기록이 있는 외부 경로 후기를 통합 평균에 반영합니다. 관리자는 공개할 후기 원문을 별도로 선정할 수 있지만, 낮은 별점만을 이유로 집계에서 제외할 수 없습니다.</span></div><div class="caregiver-review-admin-list">${reviewManagementMarkup}</div><button type="button" class="secondary-button" data-add-historical-review="${user.id}" ${user.caregiverId ? "" : "disabled"}>외부 경로 후기 등록</button></section>`;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="caregiver-management-title"><header class="modal-header"><div><p class="eyebrow">CAREGIVER HR</p><h3 id="caregiver-management-title">관리사 프로필·인사관리</h3><p>관리자 전용 인사 및 배정 기준 정보</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-caregiver-management-form>
      <div class="profile-summary"><div class="profile-summary-person"><div class="profile-avatar">${escapeHtml(user.initials)}</div><div><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email)} · ${escapeHtml(user.phone || "전화 미등록")}</span></div></div><div class="profile-summary-tags"><span>${user.status === "approved" ? "계정 승인" : "승인 대기"}</span><span>${currentClient ? `현재 ${escapeHtml(currentClient.motherName)} 담당` : "현재 배정 없음"}</span><span>총 ${assignments.length}건 배정</span></div></div>${hrSetupRequired ? '<div class="status-banner warning"><strong>인사정보 설정이 필요합니다.</strong><span>계정 승인만으로는 일정에 배정되지 않습니다. 아래 정보를 저장하고 근무상태를 ‘재직’으로 설정하세요.</span></div>' : ""}
      <section class="profile-form-section"><div class="profile-section-title"><strong>계정·재직 정보</strong><span>근무상태와 입사 이력</span></div><div class="form-grid two"><div class="field"><label for="caregiver-full-name">이름</label><input id="caregiver-full-name" name="fullName" value="${escapeHtml(user.fullName)}" required /></div><div class="field"><label for="managed-caregiver-phone">전화번호</label><input id="managed-caregiver-phone" name="phone" value="${escapeHtml(user.phone || "")}" /></div></div><div class="form-grid two"><div class="field"><label for="managed-caregiver-email">로그인 이메일</label><input id="managed-caregiver-email" value="${escapeHtml(user.email)}" readonly /></div><div class="field"><label for="employment-status">근무상태</label><select id="employment-status" name="employmentStatus">${employmentOptions.map(([value, label]) => `<option value="${value}" ${value === employmentValue ? "selected" : ""}>${label}</option>`).join("")}</select></div></div><div class="form-grid two"><div class="field"><label for="caregiver-hire-date">입사일자</label><input id="caregiver-hire-date" name="hireDate" type="date" value="${user.hireDate ? dateInputValue(user.hireDate) : ""}" /></div><div class="field"><label for="career-years">총 경력연수</label><input id="career-years" name="careerYears" type="number" min="0" max="60" step="0.5" value="${Number(user.careerYears || 0)}" /></div></div></section>
      <section class="profile-form-section"><div class="profile-section-title"><strong>경력·배정 역량</strong><span>배정 시 참고하는 전문 정보</span></div><div class="field"><label for="managed-certification">${massageOnly ? "마사지 주요 이력" : "자격·경력 요약"}</label><textarea id="managed-certification" name="certification" placeholder="${massageOnly ? "LMT 자격, 근무기관, 마사지 경력과 교육 이력을 입력하세요." : "보유 자격, 근무기관, 주요 경력을 입력하세요."}">${escapeHtml(user.certification || "")}</textarea></div><div class="form-grid two"><div class="field"><label for="caregiver-residential-area">거주지역</label><input id="caregiver-residential-area" name="residentialArea" value="${escapeHtml(user.residentialArea || "")}" placeholder="Duluth, GA" /></div><div class="field"><label for="caregiver-service-area">담당 가능지역</label><input id="caregiver-service-area" name="serviceArea" value="${escapeHtml(user.serviceArea || "")}" placeholder="Atlanta · Duluth · Marietta" /></div></div><div class="field"><label for="caregiver-specialties">${massageOnly ? "마사지 전문 분야" : "전문분야"}</label><input id="caregiver-specialties" name="specialties" value="${escapeHtml(user.specialties || "")}" placeholder="${massageOnly ? "산전 마사지, 산후 회복, 림프 관리" : "신생아 수면, 모유수유 지원"}" /></div></section>
      <section class="profile-form-section caregiver-public-profile-admin"><div class="profile-section-title"><strong>홈페이지 공개 프로필</strong><span>이름·경력·자격·전문분야·활동지역은 위 인사정보와 자동 동기화</span></div><div class="caregiver-public-admin-preview"><div class="caregiver-public-photo-preview" data-caregiver-photo-preview>${caregiverPublicPortraitMarkup({ ...publicProfile, displayName: publicProfile.displayName || user.fullName })}</div><div><strong data-caregiver-public-name-preview>${escapeHtml(publicProfile.displayName || user.fullName)}</strong><span>${escapeHtml(publicProfile.headline || "한 줄 소개를 입력해 주세요.")}</span><small>${massageOnly ? "마사지 주요 이력·전문 분야 공개" : reviewAverage ? `★ ${reviewAverage} · 후기 ${reviewCount}건` : "첫 후기를 기다리고 있어요"}</small></div></div><input type="hidden" name="existingPhotoPath" value="${escapeHtml(publicProfile.photoPath || "")}"/><div class="field"><label for="caregiver-public-photo">프로필 사진</label><input id="caregiver-public-photo" name="publicPhoto" type="file" accept="image/jpeg,image/png,image/webp" ${user.caregiverId ? "" : "disabled"}/><small>JPG·PNG·WebP, 최대 5MB. 홈페이지에 공개되는 사진입니다.</small></div><div class="form-grid two"><div class="field"><label for="public-display-name">공개 표시명 <small>자동 동기화</small></label><input id="public-display-name" name="publicDisplayName" value="${escapeHtml(publicProfile.displayName || user.fullName)}" maxlength="80" readonly required /></div><div class="field"><label for="public-headline">한 줄 소개</label><input id="public-headline" name="publicHeadline" value="${escapeHtml(publicProfile.headline || "")}" maxlength="120" placeholder="전문성과 돌봄 철학을 한 문장으로 소개하세요." /></div></div><div class="field"><label for="public-biography">공개 약력</label><textarea id="public-biography" name="publicBiography" maxlength="1500" placeholder="고객이 이해하기 쉬운 경력, 케어 철학과 강점을 입력하세요.">${escapeHtml(publicProfile.biography || user.certification || "")}</textarea></div><div class="form-grid two"><div class="field"><label for="public-career-years">공개 경력연수 <small>자동 동기화</small></label><input id="public-career-years" name="publicCareerYears" type="number" min="0" max="60" step="0.5" value="${Number(publicProfile.careerYears ?? user.careerYears ?? 0)}" readonly /></div><div class="field"><label for="public-service-area">공개 활동지역 <small>자동 동기화</small></label><input id="public-service-area" name="publicServiceArea" value="${escapeHtml(publicProfile.serviceArea || user.serviceArea || "")}" placeholder="Atlanta · Duluth · Marietta" readonly /></div></div><div class="form-grid two"><div class="field"><label for="public-specialties">${massageOnly ? "마사지 전문 분야" : "전문분야"} <small>자동 동기화</small></label><input id="public-specialties" name="publicSpecialties" value="${escapeHtml((publicProfile.specialties || []).join(", ") || user.specialties || "")}" placeholder="${massageOnly ? "산전 마사지, 산후 회복" : "신생아 수면, 산모 회복"}" readonly /></div><div class="field"><label for="public-credentials">${massageOnly ? "마사지 주요 이력" : "자격·교육"} <small>자동 동기화</small></label><input id="public-credentials" name="publicCredentials" value="${escapeHtml((publicProfile.credentials || []).join(", ") || user.certification || "")}" placeholder="${massageOnly ? "Georgia LMT, Prenatal Massage" : "Postpartum Doula, Infant CPR"}" readonly /></div></div><div class="form-grid two"><div class="field"><label for="public-languages">사용 언어</label><input id="public-languages" name="publicLanguages" value="${escapeHtml((publicProfile.languages || []).join(", ") || user.preferredLanguage || "")}" placeholder="한국어, English" /></div><div class="field"><label for="public-photo-alt">사진 대체 설명</label><input id="public-photo-alt" name="publicPhotoAlt" value="${escapeHtml(publicProfile.photoAlt || `${publicProfile.displayName || user.fullName} 관리사 프로필 사진`)}" maxlength="160" /></div></div><div class="form-grid two"><div class="field"><label for="public-sort-order">홈페이지 표시 순서</label><input id="public-sort-order" name="publicSortOrder" type="number" min="0" max="9999" value="${Number(publicProfile.sortOrder || 0)}" /></div><div class="public-profile-switches"><label><input type="checkbox" name="publicFeatured" ${publicProfile.featured ? "checked" : ""}/><span>추천 관리사 강조</span></label><label><input type="checkbox" name="publicPublished" ${publicProfile.isPublished === true ? "checked" : ""}/><span>홈페이지 공개</span></label></div></div><small>신규 관리사는 기본 비공개입니다. 소개 정보를 검토한 뒤 ‘홈페이지 공개’를 선택하세요.</small></section>
      ${reviewManagementSection}
      <section class="profile-form-section internal-note-section"><div class="profile-section-title"><strong>인사 특이사항</strong><span>관리사 본인에게는 표시되지 않습니다.</span></div><div class="field"><label for="caregiver-hr-notes">근무조건·상담·평가 메모</label><textarea id="caregiver-hr-notes" name="hrNotes" placeholder="근무 가능시간, 휴직, 면담, 평가 등 관리자 메모를 입력하세요.">${escapeHtml(user.hrNotes || "")}</textarea></div><div class="record-meta-grid"><small>가입일 ${user.createdAt ? new Date(user.createdAt).toLocaleDateString("ko-KR") : "미등록"}</small><small>승인일 ${user.approvedAt ? new Date(user.approvedAt).toLocaleDateString("ko-KR") : "승인 전"}</small><small>마지막 수정 ${user.hrUpdatedAt ? new Date(user.hrUpdatedAt).toLocaleString("ko-KR") : "기록 전"}</small></div></section>
      <div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">인사정보 저장</button></div>
    </form></section></div>`;
    bindModalFrame();
    const caregiverManagementForm = modalRoot.querySelector("[data-caregiver-management-form]");
    const sharedHomepageFields = [
      ["fullName", "publicDisplayName"],
      ["careerYears", "publicCareerYears"],
      ["specialties", "publicSpecialties"],
      ["certification", "publicCredentials"],
      ["serviceArea", "publicServiceArea"],
    ];
    const syncSharedHomepageFields = () => sharedHomepageFields.forEach(([sourceName, targetName]) => {
      const source = caregiverManagementForm.elements[sourceName];
      const target = caregiverManagementForm.elements[targetName];
      if (source && target) target.value = source.value;
    });
    const publicNamePreview = caregiverManagementForm.querySelector("[data-caregiver-public-name-preview]");
    const syncPublicNamePreview = () => {
      if (publicNamePreview) publicNamePreview.textContent = caregiverManagementForm.elements.fullName.value.trim() || "ProMoms 관리사";
    };
    syncSharedHomepageFields();
    syncPublicNamePreview();
    sharedHomepageFields.forEach(([sourceName]) => {
      const source = caregiverManagementForm.elements[sourceName];
      source?.addEventListener("input", syncSharedHomepageFields);
      source?.addEventListener("change", syncSharedHomepageFields);
      if (sourceName === "fullName") {
        source?.addEventListener("input", syncPublicNamePreview);
        source?.addEventListener("change", syncPublicNamePreview);
      }
    });
    caregiverManagementForm.addEventListener("submit", (event) => saveCaregiverManagement(event, user.id));
    modalRoot.querySelector('[name="publicPhoto"]')?.addEventListener("change", (event) => {
      const [file] = event.target.files || [];
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
        event.target.value = "";
        return showToast("JPG·PNG·WebP 형식의 5MB 이하 사진을 선택해 주세요.", "error");
      }
      const preview = modalRoot.querySelector("[data-caregiver-photo-preview]");
      const reader = new FileReader();
      reader.addEventListener("load", () => { if (preview) preview.innerHTML = `<img src="${reader.result}" alt="선택한 관리사 프로필 사진 미리보기"/>`; });
      reader.readAsDataURL(file);
    });
    modalRoot.querySelector("[data-add-historical-review]")?.addEventListener("click", () => openHistoricalCaregiverReviewModal(user.id));
    modalRoot.querySelectorAll("[data-client-review-publication]").forEach((button) => button.addEventListener("click", () => updateClientReviewPublication(button.dataset.clientReviewPublication, button.dataset.nextStatus, user.id, button)));
    modalRoot.querySelectorAll("[data-invalidate-client-review]").forEach((button) => button.addEventListener("click", () => openClientReviewInvalidationModal(button.dataset.invalidateClientReview, user.id)));
    modalRoot.querySelectorAll("[data-restore-client-review]").forEach((button) => button.addEventListener("click", () => updateClientReviewValidity(button.dataset.restoreClientReview, true, {}, user.id, button)));
    modalRoot.querySelectorAll("[data-toggle-historical-review]").forEach((button) => button.addEventListener("click", () => updateHistoricalReviewPublication(button.dataset.toggleHistoricalReview, button.dataset.nextPublished === "true", false, user.id, button)));
    modalRoot.querySelectorAll("[data-archive-historical-review]").forEach((button) => button.addEventListener("click", () => updateHistoricalReviewPublication(button.dataset.archiveHistoricalReview, false, true, user.id, button)));
    modalRoot.querySelectorAll("[data-verify-historical-review]").forEach((button) => button.addEventListener("click", () => openHistoricalReviewEvidenceModal(button.dataset.verifyHistoricalReview, user.id)));
  }

  async function saveCaregiverManagement(event, userId) {
    event.preventDefault();
    if (state.role !== "admin" || !canManageCaregiverHr()) return showToast("소유자 또는 관리자 권한이 필요합니다.");
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    const publicPhoto = formData.get("publicPhoto") instanceof File && formData.get("publicPhoto").size ? formData.get("publicPhoto") : null;
    const user = state.users.find((item) => item.id === userId && (usingCloudData() ? item.databaseRoles?.includes("CAREGIVER") : item.role === "caregiver"));
    if (!user) return showToast("관리사 정보를 찾을 수 없습니다.", "error");
    if (values.publicPublished === "on" && (!String(values.publicHeadline || "").trim() || !String(values.publicBiography || "").trim())) {
      return showToast("홈페이지에 공개하려면 한 줄 소개와 공개 약력을 입력해 주세요.", "error");
    }
    if (usingCloudData()) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        await updateCaregiverManagementCloud(user, values);
        const uploadedPhoto = publicPhoto ? await uploadCaregiverPublicPhotoCloud(user.caregiverId, publicPhoto) : null;
        await updateCaregiverPublicProfileCloud(user.caregiverId, values, uploadedPhoto?.path || null);
        closeModal();
        await refreshCloudState();
        showToast(`${values.fullName.trim()} 관리사의 인사정보와 홈페이지 프로필을 저장했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "관리사 인사정보를 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
      }
      return;
    }
    Object.assign(user, {
      fullName: values.fullName.trim(),
      initials: initialsFor(values.fullName),
      phone: values.phone.trim(),
      hireDate: values.hireDate ? new Date(`${values.hireDate}T12:00:00`).toISOString() : null,
      careerYears: Number(values.careerYears || 0),
      employmentStatus: values.employmentStatus,
      certification: values.certification.trim(),
      specialties: values.specialties.trim(),
      residentialArea: values.residentialArea.trim(),
      serviceArea: values.serviceArea.trim(),
      hrNotes: values.hrNotes.trim(),
      hrUpdatedAt: new Date().toISOString(),
      hrUpdatedBy: authUser().id,
    });
    const list = (value) => String(value || "").split(/[,·\n]/).map((item) => item.trim()).filter(Boolean);
    const existingPublicProfile = (state.publicCaregivers || []).find((item) => item.caregiverUserId === user.id);
    const publicProfile = {
      ...(existingPublicProfile || {}),
      caregiverId: existingPublicProfile?.caregiverId || user.caregiverId || `caregiver-${user.id}`,
      caregiverUserId: user.id,
      displayName: values.fullName.trim(),
      headline: values.publicHeadline.trim(),
      biography: values.publicBiography.trim(),
      photoAlt: values.publicPhotoAlt.trim(),
      careerYears: Number(values.careerYears || 0),
      specialties: list(values.specialties),
      credentials: list(values.certification),
      languages: list(values.publicLanguages),
      serviceArea: values.serviceArea.trim(),
      featured: values.publicFeatured === "on",
      sortOrder: Number(values.publicSortOrder || 0),
      isPublished: values.publicPublished === "on",
      averageRating: existingPublicProfile?.averageRating ?? null,
      reviewCount: existingPublicProfile?.reviewCount || 0,
      ratingDistribution: existingPublicProfile?.ratingDistribution || {},
      competencyAverages: existingPublicProfile?.competencyAverages || null,
      competencyReviewCount: existingPublicProfile?.competencyReviewCount || 0,
      reviews: existingPublicProfile?.reviews || [],
    };
    state.publicCaregivers ||= [];
    if (existingPublicProfile) Object.assign(existingPublicProfile, publicProfile);
    else state.publicCaregivers.push(publicProfile);
    user.publicProfile = publicProfile;
    saveState();
    closeModal();
    render();
    showToast(`${user.fullName} 관리사의 인사정보를 저장했습니다.`);
  }

  function openHistoricalCaregiverReviewModal(userId) {
    if (state.role !== "admin" || !canManageCaregiverHr()) return showToast("관리자 권한이 필요합니다.", "error");
    const user = state.users.find((item) => item.id === userId && item.caregiverId);
    if (!user) return showToast("승인된 관리사 정보를 찾을 수 없습니다.", "error");
    if (isMassageOnlyProfessional(user)) return showToast("마사지 전용 테라피스트는 평점·후기 대신 이력과 전문 분야를 관리합니다.", "info");
    const easternToday = easternDateKey();
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="historical-review-title"><header class="modal-header"><div><p class="eyebrow">VERIFIED EXTERNAL REVIEW</p><h3 id="historical-review-title">${escapeHtml(user.fullName)} 관리사 외부 경로 후기</h3><p>한국 활동 중 받은 손편지·메시지 등 실제 후기 자료를 등록하며, 원본 사진은 필요한 경우 선택하여 첨부할 수 있습니다.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-historical-review-form data-user-id="${user.id}">${reviewCompetencySurveyMarkup("historical-review")}<div class="form-grid two"><div class="field"><label for="historical-service-type">서비스 종류</label><select id="historical-service-type" name="serviceType"><option value="POSTPARTUM">산후조리</option><option value="BABYSITTING">베이비시팅</option></select></div><div class="field"><label for="historical-service-date">서비스 날짜</label><input id="historical-service-date" name="serviceDate" type="date" max="${easternToday}" value="${easternToday}" required /><small>미국 동부시간 기준 오늘 또는 이전 날짜를 선택하세요.</small></div></div><div class="field"><label for="historical-reviewer-alias">후기 표시명</label><input id="historical-reviewer-alias" name="reviewerAlias" value="외부 경로 이용 고객" maxlength="80" required/><small>실제 고객 이름이나 연락처는 입력하지 마세요.</small></div><div class="field"><label for="historical-review-tags">태그</label><input id="historical-review-tags" name="tags" maxlength="300" placeholder="세심한 케어, 친절한 소통" /></div><div class="field"><label for="historical-review-comment">후기 내용</label><textarea id="historical-review-comment" name="comment" minlength="1" maxlength="500" required placeholder="원본의 의미를 바꾸지 않고 개인정보를 제외해 입력하세요."></textarea></div><div class="field"><label for="historical-review-photos">원본·증빙 사진 <small>선택 · 최대 3장</small></label><input id="historical-review-photos" name="reviewPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple/><small>사진을 첨부하는 경우 이름·연락처·주소·아이 얼굴·의료정보를 가린 뒤 등록하세요.</small><div class="review-photo-preview" data-review-photo-preview></div></div><div class="field"><label for="historical-verification-note">확인 기록</label><textarea id="historical-verification-note" name="verificationNote" minlength="10" maxlength="500" required placeholder="후기의 출처와 실제 후기임을 확인한 근거를 10자 이상 입력하세요."></textarea></div><label class="review-public-consent admin"><input type="checkbox" name="verificationAttested" required/><span><strong>실제 서비스 이용자가 남긴 후기임을 확인했습니다.</strong><small>사진 첨부 여부와 관계없이 확인 관리자와 시각이 감사 기록에 저장되며, 6개 전문 역량의 자동 평균이 종합평점에 반영됩니다.</small></span></label><label class="review-public-consent admin"><input type="checkbox" name="isPublished" checked/><span><strong>홈페이지에 공개</strong><small>공개 화면에는 ‘외부 경로 확인 후기’로 표시됩니다.</small></span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">외부 후기 저장·확인</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-historical-review-form]");
    bindReviewPhotoPreview(form);
    form.addEventListener("submit", saveHistoricalCaregiverReview);
  }

  async function saveHistoricalCaregiverReview(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const user = state.users.find((item) => item.id === form.dataset.userId && item.caregiverId);
    if (!user) return showToast("관리사 정보를 다시 확인해 주세요.", "error");
    const formData = new FormData(form);
    const values = Object.fromEntries(formData.entries());
    const competencyScores = competencyScoresFromFormData(formData);
    const rating = reviewOverallRating(competencyScores);
    if (rating == null || !competencyScores || !String(values.comment || "").trim()) return showToast("6개 전문 역량과 후기 내용을 모두 입력해 주세요.", "error");
    values.rating = rating;
    values.competencyScores = competencyScores;
    if (!values.serviceDate || values.serviceDate > easternDateKey()) return showToast("이전 후기 날짜는 미국 동부시간 기준 오늘 또는 과거만 선택할 수 있습니다.", "error");
    const photoFiles = selectedReviewPhotoFiles(form);
    const photoError = validateReviewPhotoSelection(photoFiles);
    if (photoError) return showToast(photoError, "error");
    if (values.verificationAttested !== "on" || String(values.verificationNote || "").trim().length < 10) return showToast("실제 후기 확인 동의와 10자 이상의 확인 기록이 필요합니다.", "error");
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      if (usingCloudData()) {
        const result = await createHistoricalCaregiverReviewCloud(user.caregiverId, values, photoFiles);
        closeModal();
        await refreshCloudState();
        showToast(result.photo_upload_error ? `외부 후기는 정상 등록·반영됐지만 선택한 사진은 연결하지 못했습니다. (${result.photo_upload_error})` : "외부 경로 후기를 확인했습니다. 별점이 통합 평균에 반영됩니다.", result.photo_upload_error ? "info" : "success");
      } else {
        const photoUrls = await reviewFilesToDataUrls(photoFiles);
        state.reviews.push({ id: `historical-review-${Date.now()}`, assignmentId: null, clientId: null, caregiverId: user.caregiverId, caregiverUserId: user.id, rating, competencyScores, tags: String(values.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean), comment: values.comment.trim(), serviceDate: values.serviceDate, serviceType: values.serviceType, reviewerAlias: values.reviewerAlias.trim(), source: "VERIFIED_EXTERNAL", verificationStatus: "VERIFIED", verificationNote: String(values.verificationNote || "").trim(), photoUrls, photoPaths: [], publicationStatus: values.isPublished === "on" ? "PUBLISHED" : "HIDDEN", archived: false, createdAt: new Date().toISOString() });
        saveState();
        closeModal();
        render();
        showToast("외부 경로 후기를 확인했습니다. 별점이 통합 평균에 반영됩니다.");
      }
    } catch (error) {
      showToast(friendlyErrorMessage(error, "외부 경로 후기를 저장하지 못했습니다."), "error");
      submitButton.disabled = false;
    }
  }

  function openHistoricalReviewEvidenceModal(reviewId, userId) {
    if (state.role !== "admin" || !canManageCaregiverHr()) return showToast("관리자 권한이 필요합니다.", "error");
    const review = state.reviews.find((item) => item.id === reviewId && item.source !== "CLIENT" && !item.archived);
    const user = state.users.find((item) => item.id === userId && item.caregiverId === review?.caregiverId);
    if (!review || !user) return showToast("외부 후기 자료를 찾을 수 없습니다.", "error");
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="historical-evidence-title"><header class="modal-header"><div><p class="eyebrow">EXTERNAL REVIEW EVIDENCE</p><h3 id="historical-evidence-title">외부 후기 확인</h3><p>${escapeHtml(user.fullName)} 관리사 · 종합평점 ${reviewOverallRating(review.competencyScores, review.rating)?.toFixed(1) || "-"}점 · ${escapeHtml(review.comment)}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-historical-evidence-form data-review-id="${review.id}" data-user-id="${user.id}" data-caregiver-id="${user.caregiverId}"><div class="field"><label for="historical-evidence-photos">원본·증빙 사진 <small>선택 · 최대 3장</small></label><input id="historical-evidence-photos" name="reviewPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple/><small>사진을 첨부하는 경우 고객 이름·연락처·주소·아이 얼굴·의료정보를 가린 뒤 등록하세요.</small><div class="review-photo-preview" data-review-photo-preview></div></div><div class="field"><label for="historical-evidence-note">확인 기록</label><textarea id="historical-evidence-note" name="verificationNote" minlength="10" maxlength="500" required placeholder="후기의 출처와 실제 후기임을 확인한 근거를 입력하세요."></textarea></div><label class="review-public-consent admin"><input type="checkbox" name="verificationAttested" required/><span><strong>실제 서비스 이용자가 남긴 후기임을 확인했습니다.</strong><small>사진 첨부 여부와 관계없이 확인 기록은 감사 로그에 남으며 자동 계산된 종합평점이 통합 평균에 반영됩니다.</small></span></label><div class="form-actions"><button type="button" class="secondary-button" data-evidence-back>취소</button><button type="submit" class="primary-button">후기 확인 완료</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-historical-evidence-form]");
    bindReviewPhotoPreview(form);
    modalRoot.querySelector("[data-evidence-back]").addEventListener("click", () => openCaregiverManagementModal(userId));
    form.addEventListener("submit", saveHistoricalReviewEvidence);
  }

  async function saveHistoricalReviewEvidence(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const files = selectedReviewPhotoFiles(form);
    const note = String(formData.get("verificationNote") || "").trim();
    const error = validateReviewPhotoSelection(files);
    if (error) return showToast(error, "error");
    if (formData.get("verificationAttested") !== "on" || note.length < 10) return showToast("10자 이상의 확인 기록과 확인 동의가 필요합니다.", "error");
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      let photoUploadError = "";
      if (usingCloudData()) {
        const result = await addHistoricalReviewEvidenceCloud(form.dataset.caregiverId, form.dataset.reviewId, files, note);
        photoUploadError = result.photo_upload_error || "";
        await refreshCloudState();
      } else {
        const review = state.reviews.find((item) => item.id === form.dataset.reviewId);
        const photoUrls = await reviewFilesToDataUrls(files);
        Object.assign(review, { source: "VERIFIED_EXTERNAL", verificationStatus: "VERIFIED", verificationNote: note, photoUrls, verifiedAt: new Date().toISOString() });
        saveState();
        render();
      }
      showToast(photoUploadError ? `외부 후기는 정상 확인됐지만 선택한 사진은 연결하지 못했습니다. (${photoUploadError})` : "외부 후기를 확인했습니다. 별점이 통합 평균에 반영됩니다.", photoUploadError ? "info" : "success");
      openCaregiverManagementModal(form.dataset.userId);
    } catch (errorValue) {
      showToast(friendlyErrorMessage(errorValue, "외부 후기 증빙을 확인하지 못했습니다."), "error");
      button.disabled = false;
    }
  }

  async function updateClientReviewPublication(reviewId, status, userId, button) {
    const review = state.reviews.find((item) => item.id === reviewId && item.source === "CLIENT");
    if (!review) return showToast("고객 후기를 찾을 수 없습니다.", "error");
    if (review.validityStatus === "INVALID") return showToast("평점 제외 상태를 먼저 복원한 뒤 홈페이지 공개 여부를 변경해 주세요.", "error");
    if (button) button.disabled = true;
    try {
      if (usingCloudData()) {
        await setCaregiverReviewPublicationCloud(reviewId, status);
        await refreshCloudState();
      } else {
        review.publicationStatus = status;
        saveState();
        render();
      }
      showToast(status === "PUBLISHED" ? "고객 후기를 홈페이지 공개 대상으로 선정했습니다." : "고객 후기 원문을 홈페이지에서 숨겼습니다. 별점 집계에는 계속 반영됩니다.");
      if (state.auth.screen === "portal") openCaregiverManagementModal(userId);
    } catch (error) {
      showToast(friendlyErrorMessage(error, "후기 공개 상태를 변경하지 못했습니다."), "error");
      if (button) button.disabled = false;
    }
  }

  function openClientReviewInvalidationModal(reviewId, userId) {
    if (state.role !== "admin" || !canManageCaregiverHr()) return showToast("관리자 권한이 필요합니다.", "error");
    const review = state.reviews.find((item) => item.id === reviewId && item.source === "CLIENT");
    if (!review) return showToast("고객 후기를 찾을 수 없습니다.", "error");
    if (review.validityStatus === "INVALID") return showToast("이미 평점 집계에서 제외된 후기입니다.", "error");
    const reasonOptions = Object.entries(REVIEW_INVALID_REASON_LABELS)
      .map(([code, label]) => `<option value="${code}">${escapeHtml(label)}</option>`)
      .join("");
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="review-policy-title"><header class="modal-header"><div><p class="eyebrow">REVIEW INTEGRITY CHECK</p><h3 id="review-policy-title">고객 후기 유효성 검토</h3><p>원문을 삭제하지 않고 객관적으로 무효인 후기만 평점 집계와 홈페이지 공개에서 가역적으로 제외합니다.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-review-invalidation-form data-review-id="${review.id}" data-user-id="${userId}"><div class="review-summary-card">${reviewOverallRatingMarkup(review)}<p>${escapeHtml(review.comment || "후기 내용 없음")}</p></div><div class="privacy-boundary-note review-policy-warning"><strong>낮은 별점이나 부정적인 의견은 제외 사유가 아닙니다.</strong><span>실제 서비스 후기로 볼 수 없는 스팸, 사기·사칭·조작 정황, 중복 등록이 객관적으로 확인된 경우에만 처리하세요. 욕설·개인정보 등 원문 공개 문제는 홈페이지 숨기기로 처리하며 별점은 유지합니다. 처리자·사유·시각은 감사 기록에 남습니다.</span></div><div class="field"><label for="review-invalid-reason">무효 사유</label><select id="review-invalid-reason" name="reasonCode" required><option value="">사유를 선택하세요.</option>${reasonOptions}</select></div><div class="field"><label for="review-invalid-note">확인 근거</label><textarea id="review-invalid-note" name="reasonNote" minlength="10" maxlength="500" required placeholder="무효 후기라고 판단한 객관적인 근거를 10자 이상 입력하세요."></textarea><small>고객 의견에 대한 반박이 아니라 확인 가능한 무효 사유를 기록하세요.</small></div><div class="form-actions"><button type="button" class="secondary-button" data-review-moderation-back>취소</button><button type="submit" class="primary-button danger-button">평점 집계에서 제외</button></div></form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-review-moderation-back]")?.addEventListener("click", () => openCaregiverManagementModal(userId));
    modalRoot.querySelector("[data-review-invalidation-form]")?.addEventListener("submit", saveClientReviewInvalidation);
  }

  async function saveClientReviewInvalidation(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const reasonCode = String(values.reasonCode || "");
    const reasonNote = String(values.reasonNote || "").trim();
    if (!REVIEW_INVALID_REASON_LABELS[reasonCode]) return showToast("정책 위반 사유를 선택해 주세요.", "error");
    if (reasonNote.length < 10 || reasonNote.length > 500) return showToast("객관적인 확인 근거를 10자 이상 500자 이하로 입력해 주세요.", "error");
    const button = form.querySelector('button[type="submit"]');
    await updateClientReviewValidity(form.dataset.reviewId, false, { reasonCode, reasonNote }, form.dataset.userId, button);
  }

  async function updateClientReviewValidity(reviewId, isValid, { reasonCode = null, reasonNote = "" } = {}, userId, button) {
    if (state.role !== "admin" || !canManageCaregiverHr()) return showToast("관리자 권한이 필요합니다.", "error");
    const review = state.reviews.find((item) => item.id === reviewId && item.source === "CLIENT");
    if (!review) return showToast("고객 후기를 찾을 수 없습니다.", "error");
    if (isValid && !window.confirm("이 후기를 유효 상태로 복원할까요? 이전 공개 상태도 정책에 맞게 복구됩니다.")) return;
    if (button) button.disabled = true;
    try {
      if (usingCloudData()) {
        await setCaregiverReviewValidityCloud(reviewId, { isValid, reasonCode, reasonNote });
        await refreshCloudState();
      } else {
        review.moderationHistory ||= [];
        if (isValid) {
          const restoredStatus = review.publicationStatusBeforeInvalidation || (review.publicConsent ? "PENDING" : "PRIVATE");
          review.moderationHistory.push({ action: "RESTORE", actorId: authUser()?.id || null, occurredAt: new Date().toISOString() });
          Object.assign(review, { validityStatus: "VALID", invalidReasonCode: null, invalidReasonNote: "", invalidatedAt: null, publicationStatus: restoredStatus, publicationStatusBeforeInvalidation: null });
        } else {
          review.moderationHistory.push({ action: "EXCLUDE", reasonCode, reasonNote, actorId: authUser()?.id || null, occurredAt: new Date().toISOString(), previousPublicationStatus: review.publicationStatus || "PRIVATE" });
          Object.assign(review, { validityStatus: "INVALID", invalidReasonCode: reasonCode, invalidReasonNote: reasonNote, invalidatedAt: new Date().toISOString(), publicationStatusBeforeInvalidation: review.publicationStatus || "PRIVATE", publicationStatus: "HIDDEN" });
        }
        saveState();
        render();
      }
      showToast(isValid ? "후기를 유효 상태로 복원했습니다." : "정책 위반 후기를 평점 집계와 홈페이지 공개에서 제외했습니다. 원문과 감사 기록은 보존됩니다.");
      if (state.auth.screen === "portal") openCaregiverManagementModal(userId);
    } catch (error) {
      showToast(friendlyErrorMessage(error, isValid ? "후기를 복원하지 못했습니다." : "후기를 평점 집계에서 제외하지 못했습니다."), "error");
      if (button) button.disabled = false;
    }
  }

  async function updateHistoricalReviewPublication(reviewId, isPublished, archived, userId, button) {
    if (archived && !window.confirm("이 이전 후기를 보관 처리할까요? 홈페이지에서 숨겨지며 감사 기록은 유지됩니다.")) return;
    if (button) button.disabled = true;
    try {
      if (usingCloudData()) {
        await setHistoricalReviewPublicationCloud(reviewId, { isPublished, archived, reason: archived ? "관리자 보관 처리" : "" });
        await refreshCloudState();
      } else {
        const review = state.reviews.find((item) => item.id === reviewId);
        if (review) Object.assign(review, { publicationStatus: isPublished ? "PUBLISHED" : "HIDDEN", archived });
        saveState();
        render();
      }
      showToast(archived ? "이전 후기를 보관하고 홈페이지에서 숨겼습니다." : isPublished ? "출처가 표시된 이전 후기를 홈페이지에 공개했습니다." : "이전 후기를 홈페이지에서 숨겼습니다.");
      if (state.auth.screen === "portal") openCaregiverManagementModal(userId);
    } catch (error) {
      showToast(friendlyErrorMessage(error, "이전 후기 상태를 변경하지 못했습니다."), "error");
      if (button) button.disabled = false;
    }
  }

  function openProfileModal() {
    const user = authUser();
    if (!user) return showToast("로그인 정보를 확인할 수 없습니다.", "error");
    const client = state.role === "client" ? clientForUser(user.id) : null;
    const preferredLanguage = user.preferredLanguage || client?.preferredLanguage || "ko";
    const clientBabies = babiesForClient(client);
    const initialBaby = clientBabies[0] || null;
    const clientProfileFields = client ? `<section class="profile-form-section client-self-profile-section"><div class="profile-section-title"><strong>아기·서비스 정보</strong><span>서비스 신청서에 자동으로 불러옵니다.</span></div>${clientBabies.length ? `<div class="field"><label for="profile-baby-selector">작성할 아이</label><select id="profile-baby-selector" data-profile-baby-selector>${clientBabies.map((baby) => `<option value="${escapeHtml(baby.id || "")}">${escapeHtml(baby.name || "이름 미등록")} · ${baby.birthDate ? formatDate(baby.birthDate) : "출생일 미등록"}</option>`).join("")}<option value="__new__">+ 새 아이 등록</option></select></div>` : ""}<input type="hidden" name="babyId" value="${escapeHtml(initialBaby?.id || "")}"/><div class="form-grid two"><div class="field"><label for="profile-baby-name">아기 이름</label><input id="profile-baby-name" name="babyName" value="${escapeHtml(initialBaby?.name || "")}" autocomplete="off" required /></div><div class="field"><label for="profile-baby-birth">출생일 또는 출산 예정일</label><input id="profile-baby-birth" name="babyBirthDate" type="date" value="${initialBaby?.birthDate ? dateInputValue(initialBaby.birthDate) : ""}" required /></div></div><div class="field"><label for="profile-service-address">기본 서비스 주소</label><input id="profile-service-address" name="serviceAddress" value="${escapeHtml(client.address || "")}" autocomplete="street-address" placeholder="예: 119 Centennial, Acworth, GA 30102" minlength="5" maxlength="500" required /><small>관리사가 방문할 도로명·도시·주·우편번호를 포함해 5자 이상 입력해 주세요.</small></div><div class="form-grid two"><div class="field"><label for="profile-allergies">알러지·주의사항</label><input id="profile-allergies" name="allergies" value="${escapeHtml(client.allergies || "없음")}" maxlength="500" required /></div><div class="field"><label for="profile-household">가정 내 추가인원</label><input id="profile-household" name="extraHouseholdMembers" type="number" min="0" max="30" value="${Number(client.extraHouseholdMembers || 0)}" required /></div></div><div class="field"><label for="profile-emergency-contact">비상 연락처</label><input id="profile-emergency-contact" name="emergencyContact" value="${escapeHtml(client.emergencyContact || "")}" maxlength="300" placeholder="이름 · 전화번호 · 관계" /></div><div class="field"><label for="profile-request-note">기본 요청사항</label><textarea id="profile-request-note" name="requestNote" maxlength="2000" placeholder="서비스 신청 시 관리자가 참고할 기본 요청사항">${escapeHtml(client.requestNote || "")}</textarea></div></section>` : "";
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="my-profile-title"><header class="modal-header"><div><p class="eyebrow">MY PROFILE</p><h3 id="my-profile-title">${client ? "고객·아기 프로필" : "프로필 수정"}</h3><p>${client ? "연락처와 가족 정보를 저장하면 바로 서비스를 신청할 수 있습니다." : "연락처와 표시 정보를 최신 상태로 관리하세요."}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-my-profile-form><div class="profile-summary"><div class="profile-summary-person"><div class="profile-avatar">${escapeHtml(user.initials || initialsFor(user.fullName))}</div><div><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(ROLE_META[state.role]?.label || "회원")} 작업공간</span></div></div></div><section class="profile-form-section"><div class="profile-section-title"><strong>기본정보</strong><span>계정 연락 및 표시 정보</span></div><div class="field"><label for="profile-email">로그인 이메일</label><input id="profile-email" type="email" value="${escapeHtml(user.email || "")}" readonly aria-readonly="true"/><small>로그인 이메일 변경은 고객지원으로 문의해 주세요.</small></div><div class="form-grid two"><div class="field"><label for="profile-full-name">이름</label><input id="profile-full-name" name="fullName" autocomplete="name" value="${escapeHtml(user.fullName || "")}" required /></div><div class="field"><label for="profile-phone">전화번호</label><input id="profile-phone" name="phone" type="tel" autocomplete="tel" value="${escapeHtml(user.phone || "")}" required /></div></div><div class="field"><label for="profile-language">선호 언어</label><select id="profile-language" name="preferredLanguage"><option value="ko" ${preferredLanguage === "ko" || preferredLanguage.includes("한국") ? "selected" : ""}>한국어</option><option value="en" ${preferredLanguage === "en" || preferredLanguage === "English" ? "selected" : ""}>English</option><option value="ko,en" ${preferredLanguage.includes("·") || preferredLanguage.includes(",") ? "selected" : ""}>한국어 · English</option></select></div></section>${clientProfileFields}<div class="privacy-boundary-note"><strong>개인정보 보호</strong><span>프로필 정보는 계정 운영과 서비스 신청·배정에만 사용되며, 역할별 접근 권한이 적용됩니다.</span></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">${client ? "고객·아기 프로필 저장" : "프로필 저장"}</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-my-profile-form]");
    const syncProfileBaby = (focusNew = false) => {
      const selector = form.querySelector("[data-profile-baby-selector]");
      if (!selector) return;
      const selectedBaby = clientBabies.find((baby) => baby.id === selector.value) || null;
      form.elements.babyId.value = selectedBaby?.id || "";
      form.elements.babyName.value = selectedBaby?.name || "";
      form.elements.babyBirthDate.value = selectedBaby?.birthDate ? dateInputValue(selectedBaby.birthDate) : "";
      refreshEnhancedDateInput(form.elements.babyBirthDate);
      if (!selectedBaby && focusNew) form.elements.babyName.focus();
    };
    form.querySelector("[data-profile-baby-selector]")?.addEventListener("change", () => syncProfileBaby(true));
    const profileServiceAddressInput = form.elements.serviceAddress;
    profileServiceAddressInput?.addEventListener("input", (event) => event.currentTarget.setCustomValidity(""));
    profileServiceAddressInput?.addEventListener("invalid", (event) => {
      if (event.currentTarget.validity.valueMissing || event.currentTarget.validity.tooShort) {
        event.currentTarget.setCustomValidity("기본 서비스 주소를 5자 이상 입력해 주세요.");
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submittedForm = event.currentTarget;
      const values = Object.fromEntries(new FormData(submittedForm).entries());
      if (client && String(values.serviceAddress || "").trim().length < 5) {
        const addressInput = submittedForm.elements.serviceAddress;
        addressInput.setCustomValidity("기본 서비스 주소를 5자 이상 입력해 주세요.");
        addressInput.reportValidity();
        addressInput.focus();
        return;
      }
      const submitButton = submittedForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        if (usingCloudData()) {
          if (client) await updateMyClientProfileCloud(values);
          else await updateMyProfileCloud(values);
          closeModal();
          await refreshCloudState();
        } else {
          const previousFullName = user.fullName;
          Object.assign(user, { fullName: values.fullName.trim(), initials: initialsFor(values.fullName), phone: values.phone.trim(), preferredLanguage: values.preferredLanguage });
          if (!client && (state.role === "caregiver" || user.databaseRoles?.includes("CAREGIVER"))) {
            const publicProfile = (state.publicCaregivers || []).find((item) => item.caregiverUserId === user.id || item.caregiverId === user.caregiverId);
            if (publicProfile) {
              publicProfile.displayName = user.fullName;
              if (!publicProfile.photoAlt || publicProfile.photoAlt === `${previousFullName} 관리사 프로필 사진`) {
                publicProfile.photoAlt = `${user.fullName} 관리사 프로필 사진`;
              }
              if (user.publicProfile) Object.assign(user.publicProfile, publicProfile);
            }
          }
          if (client) {
            const existingBaby = findClientBaby(client, values.babyName, values.babyId || null);
            const savedBaby = existingBaby || { id: `baby-${Date.now()}`, name: "", birthDate: null };
            Object.assign(savedBaby, { name: values.babyName.trim(), birthDate: new Date(`${values.babyBirthDate}T12:00:00`).toISOString() });
            const updatedBabies = babiesForClient(client);
            if (!existingBaby) updatedBabies.push(savedBaby);
            Object.assign(client, { motherName: values.fullName.trim(), preferredLanguage: values.preferredLanguage, babies: updatedBabies, babyId: client.babyId || savedBaby.id, babyName: client.babyName || savedBaby.name, babyBirthDate: client.babyBirthDate || savedBaby.birthDate, address: values.serviceAddress.trim(), allergies: values.allergies.trim(), extraHouseholdMembers: Number(values.extraHouseholdMembers || 0), emergencyContact: values.emergencyContact.trim(), requestNote: values.requestNote.trim() });
          }
          saveState();
          closeModal();
          render();
        }
        showToast(client ? "고객·아기 프로필을 저장했습니다. 이제 서비스를 신청할 수 있습니다." : "프로필을 저장했습니다.");
      } catch (error) {
        showToast(friendlyErrorMessage(error, client ? "고객·아기 프로필을 저장하지 못했습니다." : "프로필을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
      }
    });
  }

  function openPasswordModal() {
    const user = authUser();
    const passwordMinLength = 8;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal" role="dialog" aria-modal="true" aria-labelledby="password-title"><header class="modal-header"><div><h3 id="password-title">비밀번호 변경</h3><p>${escapeHtml(user.email || user.login || "현재 계정")} 계정</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-password-form><div class="field"><label for="current-password">현재 비밀번호</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required /></div><div class="field"><label for="new-password">새 비밀번호</label><input id="new-password" name="newPassword" type="password" minlength="${passwordMinLength}" autocomplete="new-password" required /><small>${passwordMinLength}자 이상으로 설정해 주세요.</small></div><div class="field"><label for="confirm-password">새 비밀번호 확인</label><input id="confirm-password" name="confirmPassword" type="password" minlength="${passwordMinLength}" autocomplete="new-password" required /></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">변경하기</button></div></form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-password-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (values.newPassword !== values.confirmPassword) return showToast("새 비밀번호 확인이 일치하지 않습니다.", "error");
      if (usingCloudData()) {
        const submitButton = event.currentTarget.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        try {
          await signInCloud(user.email, values.currentPassword);
          await updatePasswordCloud(values.newPassword);
          closeModal();
          showToast("비밀번호가 안전하게 변경되었습니다.");
        } catch (error) {
          showToast(friendlyErrorMessage(error, "현재 비밀번호를 확인하거나 변경하지 못했습니다."), "error");
          submitButton.disabled = false;
        }
        return;
      }
      if (values.currentPassword !== user.password) return showToast("현재 비밀번호가 일치하지 않습니다.", "error");
      user.password = values.newPassword;
      user.mustChangePassword = false;
      saveState();
      closeModal();
      render();
      showToast("비밀번호가 변경되었습니다.");
    });
  }

  function dateInputValue(value) {
    return localDateKey(value || new Date());
  }

  function timeMinutes(value) {
    const [hours, minutes] = String(value || "00:00").split(":").map(Number);
    return hours * 60 + minutes;
  }

  function timeFromMinutes(value) {
    const minutes = Math.min(23 * 60 + 59, Math.max(0, value));
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function postpartumEndTime(startTime) {
    return timeFromMinutes(timeMinutes(startTime) + POSTPARTUM_VISIT_MINUTES);
  }

  function configurePostpartumFixedTime(form, startName, endName) {
    const startInput = form.elements[startName];
    const endInput = form.elements[endName];
    if (!startInput || !endInput) return;
    const scheduleGrid = startInput.closest(".form-grid");
    const note = document.createElement("div");
    note.className = "postpartum-fixed-time-note";
    note.innerHTML = `<strong>산후조리 고정 근무 기준</strong><span>실제 케어 8시간 + 식사 1시간 + 휴식 30분 · 종료시간 자동 계산</span>`;
    scheduleGrid?.insertAdjacentElement("afterend", note);
    const sync = () => {
      const postpartum = form.elements.serviceType?.value === "POSTPARTUM";
      note.hidden = !postpartum;
      endInput.readOnly = postpartum;
      endInput.setAttribute("aria-readonly", String(postpartum));
      if (!postpartum) return;
      startInput.max = "14:29";
      if (startInput.value > startInput.max) startInput.value = startInput.max;
      endInput.removeAttribute("min");
      endInput.value = postpartumEndTime(startInput.value);
    };
    startInput.addEventListener("change", sync);
    startInput.addEventListener("input", sync);
    form.querySelectorAll('input[name="serviceType"]').forEach((radio) => radio.addEventListener("change", sync));
    sync();
  }

  function isPostpartumServiceStarted(target) {
    return assignmentServiceType(target) === "POSTPARTUM" && new Date(adjustmentTargetStart(target)) <= new Date();
  }

  function assignmentHasCareHistory(target) {
    return Boolean(target?.id && ((state.careSessions || []).some((session) => session.assignmentId === target.id) || target.careSessionId));
  }

  function scheduledCareDays(startValue, endValue, daysOfWeek = []) {
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const allowedDays = daysOfWeek.length ? new Set(daysOfWeek) : new Set(["월", "화", "수", "목", "금"]);
    const cursor = startOfLocalDay(startValue);
    const end = startOfLocalDay(endValue);
    let count = 0;
    while (cursor <= end) {
      if (allowedDays.has(dayNames[cursor.getDay()])) count += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  function postpartumCancellationSettlement(target) {
    const originalTotal = Number(target.contractValue || target.estimatedTotal || postpartumEstimate(target.weeks));
    const deposit = Number(target.depositAmount || POSTPARTUM_DEPOSIT);
    const endAt = target.endAt || requestWindow(target).endAt;
    const remainingStart = new Date(Math.max(startOfLocalDay(new Date()).getTime(), startOfLocalDay(adjustmentTargetStart(target)).getTime()));
    const remainingCareDays = Math.max(1, scheduledCareDays(remainingStart, endAt, target.daysOfWeek || []));
    const settlementAmount = Math.max(0, (originalTotal - deposit) / remainingCareDays);
    return { originalTotal, deposit, remainingCareDays, settlementAmount };
  }

  function babysittingHours(startTime, endTime) {
    return (timeMinutes(endTime) - timeMinutes(startTime)) / 60;
  }

  function configureBabysittingMinimumTime(form, startName, endName) {
    const startInput = form.elements[startName];
    const endInput = form.elements[endName];
    if (!startInput || !endInput) return;
    const scheduleGrid = startInput.closest(".form-grid");
    const endField = endInput.closest(".field");
    const initialHours = Math.max(MIN_BABYSITTING_HOURS, Number(endInput.dataset.babysittingHours || babysittingHours(startInput.value, endInput.value) || MIN_BABYSITTING_HOURS));
    const durationField = document.createElement("div");
    durationField.className = "field babysitting-duration-field";
    durationField.innerHTML = `<label>케어시간</label><div class="care-hours-control"><input type="number" min="${MIN_BABYSITTING_HOURS}" max="12" step="0.5" value="${initialHours}" inputmode="decimal"/><span>시간</span></div><small>최소 ${MIN_BABYSITTING_HOURS}시간부터 30분 단위로 선택할 수 있습니다.</small>`;
    endField?.insertAdjacentElement("afterend", durationField);
    const durationInput = durationField.querySelector("input");
    const note = document.createElement("div");
    note.className = "babysitting-minimum-note";
    note.innerHTML = `<strong>베이비시팅 예약 기준</strong><span>희망 시작일 · 시작시간 · 케어시간 선택 · 최소 ${MIN_SERVICE_WEEKS}주 연속 계약</span>`;
    scheduleGrid?.insertAdjacentElement("afterend", note);
    const sync = () => {
      const babysitting = form.elements.serviceType?.value === "BABYSITTING";
      note.hidden = !babysitting;
      durationField.hidden = !babysitting;
      if (endField) endField.hidden = babysitting;
      if (!babysitting) {
        startInput.removeAttribute("max");
        endInput.removeAttribute("min");
        return;
      }
      const careHours = Math.min(12, Math.max(MIN_BABYSITTING_HOURS, Number(durationInput.value || MIN_BABYSITTING_HOURS)));
      durationInput.value = String(careHours);
      startInput.max = ["19:45", timeFromMinutes(23 * 60 + 59 - careHours * 60)].sort()[0];
      if (startInput.value > startInput.max) startInput.value = startInput.max;
      endInput.value = timeFromMinutes(timeMinutes(startInput.value) + careHours * 60);
    };
    durationInput.addEventListener("input", sync);
    durationInput.addEventListener("change", sync);
    startInput.addEventListener("input", sync);
    startInput.addEventListener("change", sync);
    form.querySelectorAll('input[name="serviceType"]').forEach((radio) => radio.addEventListener("change", sync));
    sync();
  }

  function assignmentWindow(startDate, dailyStart, dailyEnd, weeks) {
    const startAt = new Date(`${startDate}T${dailyStart}:00`);
    const endAt = new Date(startAt);
    endAt.setDate(endAt.getDate() + Math.max(1, Number(weeks || 1)) * 7 - 1);
    const [endHour, endMinute] = dailyEnd.split(":").map(Number);
    endAt.setHours(endHour, endMinute, 0, 0);
    return { startAt, endAt };
  }

  function caregiverIsAvailable(caregiverUserId, startAt, endAt, excludedAssignmentId = null, requestedDays = [], requestedDailyStart = null, requestedDailyEnd = null) {
    const requestedDaySet = new Set(requestedDays.length ? requestedDays : DEFAULT_SERVICE_DAYS);
    const requestStartMinutes = timeMinutes(requestedDailyStart || (startAt instanceof Date ? startAt.toTimeString().slice(0, 5) : "00:00"));
    const requestEndMinutes = timeMinutes(requestedDailyEnd || "23:59");
    return !state.assignments.some((assignment) => {
      if (assignment.id === excludedAssignmentId || assignment.caregiverUserId !== caregiverUserId || assignment.status === "CANCELLED") return false;
      const overlapStart = new Date(Math.max(startOfLocalDay(startAt).getTime(), startOfLocalDay(assignment.startAt).getTime()));
      const overlapEnd = new Date(Math.min(startOfLocalDay(endAt).getTime(), startOfLocalDay(assignment.endAt).getTime()));
      if (overlapStart > overlapEnd) return false;
      const existingStartMinutes = timeMinutes(assignment.dailyStart || "00:00");
      const existingEndMinutes = timeMinutes(assignment.dailyEnd || "23:59");
      if (requestEndMinutes <= existingStartMinutes || existingEndMinutes <= requestStartMinutes) return false;
      const existingDaySet = new Set(assignment.daysOfWeek?.length ? assignment.daysOfWeek : DEFAULT_SERVICE_DAYS);
      const cursor = new Date(overlapStart);
      while (cursor <= overlapEnd) {
        const weekday = KOREAN_WEEKDAYS[cursor.getDay()];
        if (requestedDaySet.has(weekday) && existingDaySet.has(weekday)) return true;
        cursor.setDate(cursor.getDate() + 1);
      }
      return false;
    });
  }

  function approvedAvailableCaregivers(startAt, endAt, excludedAssignmentId = null, requestedDays = [], requestedDailyStart = null, requestedDailyEnd = null, serviceType = null) {
    return state.users.filter((user) =>
      isCaregiverAssignable(user, serviceType)
      && caregiverIsAvailable(user.id, startAt, endAt, excludedAssignmentId, requestedDays, requestedDailyStart, requestedDailyEnd),
    );
  }

  function massageTherapistIsAvailable(user, clientId, startAt, endAt, excludedAssignmentId = null, requestedDays = [], requestedDailyStart = null, requestedDailyEnd = null) {
    if (!isProfessionalStaffActive(user) || !user.isMassageTherapist) return false;
    const requestedDaySet = new Set(requestedDays.length ? requestedDays : [KOREAN_WEEKDAYS[startOfLocalDay(startAt).getDay()]]);
    const requestStartMinutes = timeMinutes(requestedDailyStart || "00:00");
    const requestEndMinutes = timeMinutes(requestedDailyEnd || "23:59");
    return !state.assignments.some((assignment) => {
      if (assignment.id === excludedAssignmentId || assignment.caregiverUserId !== user.id || assignment.status === "CANCELLED") return false;
      const overlapStart = new Date(Math.max(startOfLocalDay(startAt).getTime(), startOfLocalDay(assignment.startAt).getTime()));
      const overlapEnd = new Date(Math.min(startOfLocalDay(endAt).getTime(), startOfLocalDay(assignment.endAt).getTime()));
      if (overlapStart > overlapEnd) return false;
      const existingStart = timeMinutes(assignment.dailyStart || "00:00");
      const existingEnd = timeMinutes(assignment.dailyEnd || "23:59");
      if (requestEndMinutes <= existingStart || existingEnd <= requestStartMinutes) return false;
      const existingDays = new Set(assignment.daysOfWeek?.length ? assignment.daysOfWeek : DEFAULT_SERVICE_DAYS);
      const cursor = new Date(overlapStart);
      while (cursor <= overlapEnd) {
        const weekday = KOREAN_WEEKDAYS[cursor.getDay()];
        if (requestedDaySet.has(weekday) && existingDays.has(weekday)) {
          const sameClientCareException = assignment.clientId === clientId && assignmentServiceType(assignment) !== "MASSAGE";
          if (!sameClientCareException) return true;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      return false;
    });
  }

  function approvedAvailableMassageTherapists(clientId, startAt, endAt, excludedAssignmentId = null, requestedDays = [], requestedDailyStart = null, requestedDailyEnd = null) {
    return state.users.filter((user) => massageTherapistIsAvailable(user, clientId, startAt, endAt, excludedAssignmentId, requestedDays, requestedDailyStart, requestedDailyEnd));
  }

  function canReassignCloudAssignment(assignment) {
    if (!usingCloudData() || !canReviewServiceRequests() || !assignment || !["CONFIRMED", "PROPOSED"].includes(assignment.databaseStatus)) return false;
    if ((state.careSessions || []).some((session) => session.assignmentId === assignment.id && session.status === "IN_PROGRESS")) return false;
    const endAt = new Date(assignment.endAt);
    return Number.isFinite(endAt.getTime()) && endAt >= new Date();
  }

  function reassignmentAvailabilityWindow(assignment) {
    const endAt = new Date(assignment.endAt);
    const sessions = (state.careSessions || []).filter((session) => session.assignmentId === assignment.id);
    const hasHistory = sessions.length > 0 || Boolean(assignment.careSessionId);
    if (!hasHistory) return { startAt: new Date(assignment.startAt), endAt };

    const todayKey = localDateKey(new Date());
    let startKey = [localDateKey(new Date(assignment.startAt)), todayKey].sort().at(-1);
    const dailyStart = assignment.dailyStart || "00:00";
    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (sessions.some((session) => session.serviceDate && session.serviceDate >= startKey) || (startKey === todayKey && nowTime >= dailyStart)) {
      const nextDate = new Date(`${startKey}T12:00:00`);
      nextDate.setDate(nextDate.getDate() + 1);
      startKey = localDateKey(nextDate);
    }

    const serviceDays = assignment.daysOfWeek?.length ? assignment.daysOfWeek : DEFAULT_SERVICE_DAYS;
    const candidateDate = new Date(`${startKey}T12:00:00`);
    while (candidateDate <= endAt && !serviceDays.includes(KOREAN_WEEKDAYS[candidateDate.getDay()])) {
      candidateDate.setDate(candidateDate.getDate() + 1);
    }
    if (startOfLocalDay(candidateDate) > startOfLocalDay(endAt)) return null;
    return { startAt: new Date(`${localDateKey(candidateDate)}T${dailyStart}:00`), endAt };
  }

  function openAssignmentModal(assignmentId = null, requestId = null) {
    const assignment = assignmentId ? state.assignments.find((item) => item.id === assignmentId) : null;
    const productionDetailOnly = Boolean(assignment && usingCloudData());
    if (assignmentId && !assignment) return showToast("일정 정보를 찾을 수 없습니다.");
    const requestedRequest = requestId ? state.serviceRequests.find((request) => request.id === requestId && request.status === "APPROVED" && !request.approvedAssignmentId) : null;
    if (!assignment && requestedRequest && !requestHasCapturedDepositEvidence(requestedRequest)) return openApprovedDepositEvidenceModal(requestedRequest.id);
    const approvedQueue = state.serviceRequests.filter((request) => request.status === "APPROVED" && !request.approvedAssignmentId && assignmentServiceType(request) !== "MASSAGE" && clientById(request.clientId) && requestHasCapturedDepositEvidence(request));
    if (!assignment && !approvedQueue.length) return showToast("승인과 예약금 수납 증빙이 완료된 신청이 없습니다.");
    const linkedRequest = assignment?.serviceRequestId ? state.serviceRequests.find((request) => request.id === assignment.serviceRequestId) : null;
    const selectedRequest = assignment ? linkedRequest : approvedQueue.find((request) => request.id === requestId) || approvedQueue[0];
    const source = assignment || selectedRequest;
    if (!source) return showToast("배치할 서비스 신청 정보를 찾을 수 없습니다.", "error");
    const client = clientById(source.clientId);
    if (!client) return showToast("연결된 고객 정보를 찾을 수 없습니다. 회원·고객 프로필 연결을 먼저 확인해 주세요.", "error");
    const serviceType = assignmentServiceType(source);
    const selectedWeeks = String(serviceType === "MASSAGE" ? Number(source.weeks || source.sessionCount || 1) : Math.max(MIN_SERVICE_WEEKS, Number(source.weeks || MIN_SERVICE_WEEKS)));
    const dateValue = dateInputValue(assignment?.startAt || selectedRequest?.desiredStartDate);
    const dailyStart = assignment?.dailyStart || selectedRequest?.dailyStart || "09:00";
    const dailyEnd = assignment?.dailyEnd || selectedRequest?.dailyEnd || "17:00";
    const previewWindow = serviceWindow(source, dateValue, dailyStart, dailyEnd, selectedWeeks);
    const lifecycleIssue = serviceType === "MASSAGE" ? null : serviceLifecycleIssue(source.clientId, serviceType, previewWindow.startAt, previewWindow.endAt, assignment?.id || null, selectedRequest?.id || null, source.babyId, source.babyName);
    const caregivers = assignment
      ? state.users.filter((user) => user.id === assignment.caregiverUserId || (serviceType === "MASSAGE" ? massageTherapistIsAvailable(user, source.clientId, previewWindow.startAt, previewWindow.endAt, assignment.id, source.daysOfWeek || [], dailyStart, dailyEnd) : isCaregiverAssignable(user, serviceType)))
      : serviceType === "MASSAGE"
        ? approvedAvailableMassageTherapists(source.clientId, previewWindow.startAt, previewWindow.endAt, null, source.daysOfWeek || [], dailyStart, dailyEnd)
        : approvedAvailableCaregivers(previewWindow.startAt, previewWindow.endAt, null, source.daysOfWeek || [], dailyStart, dailyEnd, serviceType);
    const selectedCaregiverId = assignment?.caregiverUserId || caregivers[0]?.id || "";
    const sourceBabyName = babyNameFor(source, client) || "아이 미등록";
    const requestLocked = Boolean(!assignment && usingCloudData());
    const reassignmentBlockedByActiveSession = Boolean(assignment && usingCloudData() && (state.careSessions || []).some((session) => session.assignmentId === assignment.id && session.status === "IN_PROGRESS"));
    const reassignmentAllowed = canReassignCloudAssignment(assignment);
    const reassignmentWindow = reassignmentAllowed ? reassignmentAvailabilityWindow(assignment) : null;
    const reassignmentCandidates = reassignmentAllowed && reassignmentWindow
      ? (serviceType === "MASSAGE" ? approvedAvailableMassageTherapists(source.clientId, reassignmentWindow.startAt, reassignmentWindow.endAt, assignment.id, source.daysOfWeek || [], dailyStart, dailyEnd) : approvedAvailableCaregivers(reassignmentWindow.startAt, reassignmentWindow.endAt, assignment.id, source.daysOfWeek || [], dailyStart, dailyEnd, serviceType)).filter((user) => user.id !== assignment.caregiverUserId)
      : [];
    const reassignmentMarkup = reassignmentBlockedByActiveSession
      ? '<section class="profile-form-section assignment-reassignment-panel"><div class="status-banner warning"><strong>진행 중인 근무를 먼저 종료해 주세요.</strong><span>현장 기록이 열려 있는 동안에는 담당 관리사를 바꿀 수 없습니다.</span></div></section>'
      : reassignmentAllowed && !reassignmentWindow
        ? '<section class="profile-form-section assignment-reassignment-panel"><div class="status-banner info"><strong>재배정할 남은 서비스 요일이 없습니다.</strong><span>계약 말일 이후의 서비스가 필요하면 고객이 기간 연장을 신청해야 합니다.</span></div></section>'
        : reassignmentAllowed
          ? `<section class="profile-form-section assignment-reassignment-panel" data-reassignment-panel><div class="profile-section-title"><strong>관리사 재배정</strong><span>현재 계약 일정은 유지하고 담당자만 변경합니다.</span></div>${reassignmentCandidates.length ? `<div class="field"><label for="assignment-replacement-caregiver">새 담당 관리사</label><select id="assignment-replacement-caregiver" name="replacementCaregiverUserId" data-reassignment-control required><option value="">선택해 주세요</option>${reassignmentCandidates.map((user) => `<option value="${user.id}">${escapeHtml(user.fullName)} · ${escapeHtml(user.serviceArea || user.residentialArea || "활동지역 미등록")}</option>`).join("")}</select><small>계정 승인·인사정보·재직 상태와 남은 운영 일정의 충돌을 모두 확인한 관리사만 표시됩니다.</small></div><div class="field"><label for="assignment-reassignment-reason">재배정 사유</label><textarea id="assignment-reassignment-reason" name="reassignmentReason" data-reassignment-control minlength="3" maxlength="500" placeholder="변경 사유와 인수인계에 필요한 내용을 구체적으로 입력하세요." required></textarea></div><button type="button" class="primary-button" data-reassign-assignment="${assignment.id}">관리사 재배정</button>` : `<div class="status-banner warning"><strong>현재 배정 가능한 다른 관리사가 없습니다.</strong><span>인사정보가 설정된 재직 관리사의 일정 여유를 확인해 주세요.</span></div>`}</section>`
          : "";
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal assignment-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-title"><header class="modal-header"><div><h3 id="assignment-title">${productionDetailOnly ? "확정 일정 상세" : assignment ? "일정·관리사 변경" : "승인된 신청에서 일정 배치"}</h3><p>${productionDetailOnly ? "확정된 신청·계약 기준 정보입니다. 변경과 취소는 승인 절차를 통해 감사 기록과 함께 반영됩니다." : assignment ? "기간, 시간과 담당 관리사를 변경합니다." : "고객 신청 정보를 불러왔습니다. 가능한 관리사를 선택해 캘린더에 배치하세요."}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-assignment-form>
      ${assignment ? "" : `<div class="field approved-request-picker"><label for="approved-request-select">승인된 서비스 신청</label><select id="approved-request-select" data-approved-request-select>${approvedQueue.map((request) => { const requestClient = clientById(request.clientId); const requestBabyName = babyNameFor(request, requestClient) || "아이 미등록"; return `<option value="${request.id}" ${request.id === selectedRequest.id ? "selected" : ""}>${serviceMetaFor(request.serviceType).label} · ${escapeHtml(requestClient.motherName)} / ${escapeHtml(requestBabyName)} · ${new Date(request.desiredStartDate).toLocaleDateString("ko-KR")}</option>`; }).join("")}</select><small>목록을 바꾸면 신청서의 일정·주소·요청사항이 자동으로 다시 불러와집니다.</small></div>`}
      <input type="hidden" name="serviceRequestId" value="${escapeHtml(selectedRequest?.id || assignment?.serviceRequestId || "")}"/><input type="hidden" name="serviceType" value="${serviceType}"/><input type="hidden" name="clientId" value="${client.id}"/>
      <div class="assignment-source-summary ${serviceMetaFor(serviceType).tone}">${serviceBadgeMarkup(serviceType)}<div><strong>${escapeHtml(client.motherName)}${serviceType === "MASSAGE" ? "" : ` · ${escapeHtml(sourceBabyName)}`}</strong><span>${escapeHtml(source.address || client.address || "주소 미등록")} · ${serviceType === "MASSAGE" ? `${source.durationMinutes || 60}분 × ${source.sessionCount || 1}회` : `알러지 ${escapeHtml(source.allergies || "없음")}`}</span></div><em>승인 신청 연결</em></div>${serviceType === "POSTPARTUM" ? `<div class="application-price-summary"><span>${postpartumModeFor(source) === "LIVE_IN" ? "입주형" : "출퇴근형"} 계약 예정 금액</span><strong>${money(requestServiceTotal(source))}</strong><small>주 ${money(postpartumWeeklyRate(source))} × ${selectedWeeks}주</small></div>` : serviceType === "MASSAGE" ? `<div class="application-price-summary"><span>${source.pricingTier === "POSTPARTUM_CLIENT" ? "산후조리 고객 우대가" : "일반 고객가"}</span><strong>${money(requestServiceTotal(source))}</strong><small>${source.durationMinutes || 60}분 × ${source.sessionCount || 1}회 · 24시간 이전 변경·취소</small></div>` : ""}<div class="insured-contract-note"><strong>보험 적용 W-2 직원 배정</strong><span>고객에게 고용·급여·세무·업무상 재해 리스크를 전가하지 않습니다.</span></div>${requestLocked ? '<div class="status-banner info">고객이 승인받은 신청 조건은 이 단계에서 수정되지 않습니다. 관리사만 선택해 확정하며, 일정 변경은 별도 변경·취소 승인 절차로 처리합니다.</div>' : ""}${lifecycleIssue ? `<div class="status-banner warning">${escapeHtml(lifecycleIssue.message)}</div>` : ""}
      <div class="field"><label for="assignment-caregiver">해당 기간에 가능한 관리사</label>${caregivers.length ? `<select id="assignment-caregiver" name="caregiverUserId" required>${caregivers.map((user) => `<option value="${user.id}" ${user.id === selectedCaregiverId ? "selected" : ""}>${escapeHtml(user.fullName)} · ${escapeHtml(user.serviceArea || user.residentialArea || "활동지역 미등록")}</option>`).join("")}</select><small>저장 시 다른 배정과의 기간 충돌을 다시 확인합니다.</small>` : `<div class="status-banner warning">신청 기간에 배정 가능한 승인 관리사가 없습니다. 관리사 일정을 조정한 뒤 다시 시도해 주세요.</div>`}</div>
      <div class="field"><span class="field-label">${serviceType === "MASSAGE" ? "예약 횟수" : "계약 기간"}</span>${requestLocked ? `<input type="hidden" name="weeks" value="${selectedWeeks}"/><div class="read-only-value">${serviceType === "MASSAGE" ? `${source.sessionCount || selectedWeeks}회` : `${selectedWeeks}주`}</div>` : serviceType === "MASSAGE" ? `<input type="hidden" name="weeks" value="${selectedWeeks}"/><div class="read-only-value">${source.sessionCount || selectedWeeks}회</div>` : `<div class="option-grid three">${radioOptions("weeks", [["2", "2주"], ["3", "3주"], ["4", "4주"]], String(Math.max(MIN_SERVICE_WEEKS, Number(selectedWeeks))))}</div>`}</div>
      <div class="form-grid three"><div class="field"><label for="assignment-start">시작일</label><input id="assignment-start" name="startDate" type="date" value="${dateValue}" required ${requestLocked ? 'readonly aria-readonly="true"' : ""}/></div><div class="field"><label for="assignment-start-time">시작 시간</label><input id="assignment-start-time" name="dailyStart" type="time" value="${dailyStart}" required ${requestLocked ? 'readonly aria-readonly="true"' : ""}/></div><div class="field"><label for="assignment-end-time">종료 시간</label><input id="assignment-end-time" name="dailyEnd" type="time" value="${dailyEnd}" required ${requestLocked ? 'readonly aria-readonly="true"' : ""}/></div></div>
      <div class="field"><label for="assignment-address">서비스 주소</label><input id="assignment-address" name="address" value="${escapeHtml(source.address || client.address || "")}" required placeholder="Street, City, State ZIP" ${requestLocked ? 'readonly aria-readonly="true"' : ""}/></div>
      <div class="form-grid two"><div class="field"><label for="assignment-household">가정 내 추가인원</label><input id="assignment-household" name="extraHouseholdMembers" type="number" min="0" value="${source.extraHouseholdMembers ?? 0}" required ${requestLocked ? 'readonly aria-readonly="true"' : ""}/></div><div class="field"><label for="assignment-allergy">알러지 유무/내용</label><input id="assignment-allergy" name="allergies" value="${escapeHtml(source.allergies || "없음")}" required ${requestLocked ? 'readonly aria-readonly="true"' : ""}/></div></div>
      <div class="field"><label for="assignment-note">고객 요청 메모</label><textarea id="assignment-note" name="requestNote" placeholder="관리사가 케어 전에 반드시 확인할 내용을 입력하세요." ${requestLocked ? 'readonly aria-readonly="true"' : ""}>${escapeHtml(source.requestNote || source.specialNotes || "")}</textarea></div>
      ${reassignmentMarkup}<div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button" ${caregivers.length && !lifecycleIssue ? "" : "disabled"}>${assignment ? "변경사항 저장" : "관리사 선택·캘린더 배치"}</button></div>
    </form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-approved-request-select]")?.addEventListener("change", (event) => openAssignmentModal(null, event.target.value));
    const assignmentForm = modalRoot.querySelector("[data-assignment-form]");
    configureBabysittingMinimumTime(assignmentForm, "dailyStart", "dailyEnd");
    configurePostpartumFixedTime(assignmentForm, "dailyStart", "dailyEnd");
    if (productionDetailOnly) {
      assignmentForm.querySelectorAll("input, select, textarea").forEach((control) => {
        if (!control.closest("[data-reassignment-panel]")) control.disabled = true;
      });
      assignmentForm.querySelectorAll('input[type="date"]').forEach(refreshEnhancedDateInput);
      const submit = assignmentForm.querySelector('button[type="submit"]');
      submit?.remove();
      assignmentForm.querySelector(".form-actions")?.insertAdjacentHTML("afterbegin", '<p class="form-action-note">고객의 변경·취소 요청이 승인되면 일정이 자동 반영됩니다.</p>');
    } else {
      assignmentForm.addEventListener("submit", (event) => saveAssignment(event, assignment?.id || null));
    }
    modalRoot.querySelector("[data-reassign-assignment]")?.addEventListener("click", async (event) => {
      const currentAssignment = state.assignments.find((item) => item.id === event.currentTarget.dataset.reassignAssignment);
      if (!canReassignCloudAssignment(currentAssignment)) return showToast("재배정 가능한 예정·진행 배정이 아닙니다. 화면을 새로고침해 주세요.", "error");
      const replacementUserId = String(assignmentForm.elements.replacementCaregiverUserId?.value || "");
      const reason = String(assignmentForm.elements.reassignmentReason?.value || "").trim();
      const replacement = state.users.find((user) => user.id === replacementUserId);
      if (!replacement || replacement.id === currentAssignment.caregiverUserId || !replacement.caregiverId || !isCaregiverAssignable(replacement, serviceType)) return showToast(`현재 ${serviceMetaFor(serviceType).label} 배정이 가능한 다른 관리사를 선택해 주세요.`, "error");
      if (reason.length < 3 || reason.length > 500) return showToast("감사 기록을 위해 재배정 사유를 3~500자로 입력해 주세요.", "error");
      const remainingWindow = reassignmentAvailabilityWindow(currentAssignment);
      if (!remainingWindow) return showToast("재배정할 남은 서비스 요일이 없습니다. 기간 연장이 필요한지 확인해 주세요.", "info");
      if (!caregiverIsAvailable(replacement.id, remainingWindow.startAt, remainingWindow.endAt, currentAssignment.id, currentAssignment.daysOfWeek || [], currentAssignment.dailyStart, currentAssignment.dailyEnd)) return showToast("선택한 관리사에게 남은 계약 기간과 겹치는 일정이 있습니다.", "error");
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "재배정 중…";
      try {
        await reassignCaregiverCloud({ assignmentId: currentAssignment.id, caregiverId: replacement.caregiverId, reason });
        closeModal();
        await refreshCloudState();
        showToast(`${replacement.fullName} 관리사로 재배정하고 감사 기록을 저장했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "관리사 재배정을 저장하지 못했습니다."), "error");
        button.disabled = false;
        button.textContent = "관리사 재배정";
      }
    });
  }

  async function saveAssignment(event, assignmentId = null) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (values.serviceType !== "MASSAGE" && Number(values.weeks) < MIN_SERVICE_WEEKS) return showToast("서비스 계약은 최소 2주부터 가능합니다.");
    if (values.serviceType === "BABYSITTING" && babysittingHours(values.dailyStart, values.dailyEnd) < MIN_BABYSITTING_HOURS) return showToast("베이비시팅은 하루 최소 4시간부터 배정할 수 있습니다.");
    if (values.serviceType === "POSTPARTUM" && values.dailyEnd !== postpartumEndTime(values.dailyStart)) return showToast("산후조리는 케어 8시간·식사 1시간·휴식 30분을 포함한 종료시간을 사용해야 합니다.");
    const request = values.serviceRequestId ? state.serviceRequests.find((item) => item.id === values.serviceRequestId) : null;
    const existingAssignment = assignmentId ? state.assignments.find((item) => item.id === assignmentId) : null;
    if (!assignmentId && (!request || request.status !== "APPROVED" || request.approvedAssignmentId)) return showToast("배치 가능한 승인 신청을 다시 선택해 주세요.");
    const { startAt, endAt } = serviceWindow(request || existingAssignment || { serviceType: values.serviceType, sessionCount: Number(values.weeks) }, values.startDate, values.dailyStart, values.dailyEnd, values.weeks);
    if (values.dailyEnd <= values.dailyStart) return showToast("종료 시간은 시작 시간보다 늦어야 합니다.");
    const babySource = request || existingAssignment;
    const lifecycleIssue = values.serviceType === "MASSAGE" ? null : serviceLifecycleIssue(values.clientId, values.serviceType, startAt, endAt, assignmentId, request?.id || null, babySource?.babyId, babySource?.babyName);
    if (lifecycleIssue) return showToast(lifecycleIssue.message);
    const requestedDays = request?.daysOfWeek || state.assignments.find((item) => item.id === assignmentId)?.daysOfWeek || [];
    const selectedCaregiver = state.users.find((user) => user.id === values.caregiverUserId);
    const selectedCaregiverEligible = values.serviceType === "MASSAGE"
      ? isProfessionalStaffActive(selectedCaregiver) && selectedCaregiver?.isMassageTherapist
      : isCaregiverAssignable(selectedCaregiver, values.serviceType);
    if (!selectedCaregiverEligible) return showToast(`선택한 직원에게 ${serviceMetaFor(values.serviceType).label} 서비스 권한이 없습니다.`, "error");
    const selectedCaregiverAvailable = values.serviceType === "MASSAGE"
      ? massageTherapistIsAvailable(selectedCaregiver, values.clientId, startAt, endAt, assignmentId, requestedDays, values.dailyStart, values.dailyEnd)
      : caregiverIsAvailable(values.caregiverUserId, startAt, endAt, assignmentId, requestedDays, values.dailyStart, values.dailyEnd);
    if (!selectedCaregiverAvailable) {
      showToast(values.serviceType === "MASSAGE" ? "해당 테라피스트에게 겹치는 케어기빙 또는 마사지 일정이 있습니다." : "해당 관리사에게 겹치는 배정 일정이 있습니다.");
      return;
    }
    const client = clientById(values.clientId);
    if (!client) return showToast("연결된 고객 정보를 찾을 수 없어 일정을 저장하지 않았습니다.", "error");
    if (usingCloudData()) {
      if (assignmentId) return showToast("진행 중인 실제 일정 변경은 고객의 변경 요청 승인 절차에서 처리해 주세요.");
      const caregiverUser = state.users.find((item) => item.id === values.caregiverUserId);
      if (!caregiverUser?.caregiverId) return showToast("관리사 데이터 연결 정보를 찾을 수 없습니다.");
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "일정 저장 중…";
      try {
        await scheduleServiceRequestCloud(request.id, caregiverUser.caregiverId);
        closeModal();
        await refreshCloudState();
        showToast(`${client.motherName} 고객의 ${serviceMetaFor(values.serviceType).label} 일정이 실제 캘린더에 저장되었습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "일정 배정을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "관리사 선택·캘린더 배치";
      }
      return;
    }
    const assignmentData = { serviceType: values.serviceType, serviceRequestId: request?.id || existingAssignment?.serviceRequestId || null, clientId: client.id, babyId: babySource?.babyId || client.babyId, babyName: babyNameFor(babySource, client) || client.babyName, caregiverUserId: values.caregiverUserId, weeks: Number(values.weeks), weeklyRate: values.serviceType === "POSTPARTUM" ? postpartumWeeklyRate(request || existingAssignment) : null, contractValue: values.serviceType === "POSTPARTUM" ? postpartumEstimate(values.weeks, postpartumModeFor(request || existingAssignment)) : null, depositAmount: values.serviceType === "POSTPARTUM" ? (request?.depositAmount || existingAssignment?.depositAmount || POSTPARTUM_DEPOSIT) : null, depositStatus: values.serviceType === "POSTPARTUM" ? (request?.depositStatus || existingAssignment?.depositStatus || "PAID") : null, depositPaidAt: values.serviceType === "POSTPARTUM" ? (request?.depositPaidAt || existingAssignment?.depositPaidAt || new Date().toISOString()) : null, insuredStaffing: true, employeeClassification: "W-2", startAt: startAt.toISOString(), endAt: endAt.toISOString(), dailyStart: values.dailyStart, dailyEnd: values.dailyEnd, daysOfWeek: request?.daysOfWeek || existingAssignment?.daysOfWeek || [], address: values.address, extraHouseholdMembers: Number(values.extraHouseholdMembers), allergies: values.allergies, requestNote: values.requestNote, maternalNotes: request?.maternalNotes || existingAssignment?.maternalNotes || "", mealInstructions: request?.mealInstructions || existingAssignment?.mealInstructions || "", routineNotes: request?.routineNotes || existingAssignment?.routineNotes || "", pickupNotes: request?.pickupNotes || existingAssignment?.pickupNotes || "", status: startAt <= new Date() && new Date() <= endAt ? "ACTIVE" : "SCHEDULED", updatedBy: authUser().id, updatedAt: new Date().toISOString() };
    if (values.serviceType === "BABYSITTING") Object.assign(assignmentData, { depositAmount: request?.depositAmount || existingAssignment?.depositAmount || BABYSITTING_DEPOSIT, depositStatus: request?.depositStatus || existingAssignment?.depositStatus || "PAID", depositPaidAt: request?.depositPaidAt || existingAssignment?.depositPaidAt || new Date().toISOString() });
    if (values.serviceType === "POSTPARTUM") Object.assign(assignmentData, { postpartumMode: request?.postpartumMode || existingAssignment?.postpartumMode || "COMMUTE", weeklyRate: request?.weeklyRate || existingAssignment?.weeklyRate || postpartumWeeklyRate(request), contractValue: requestServiceTotal(request || existingAssignment) });
    if (values.serviceType === "MASSAGE") Object.assign(assignmentData, { babyId: null, babyName: "", durationMinutes: request?.durationMinutes || 60, sessionCount: request?.sessionCount || 1, pricingTier: request?.pricingTier || "GENERAL", contractValue: requestServiceTotal(request), depositAmount: request?.depositAmount || requestServiceTotal(request), depositStatus: request?.depositStatus || "PAID", depositPaidAt: request?.depositPaidAt || new Date().toISOString() });
    let savedAssignment;
    if (assignmentId) {
      Object.assign(existingAssignment, assignmentData);
      savedAssignment = existingAssignment;
    } else {
      savedAssignment = { id: `assignment-${Date.now()}`, ...assignmentData, createdBy: authUser().id, createdAt: new Date().toISOString() };
      state.assignments.push(savedAssignment);
      Object.assign(request, { approvedAssignmentId: savedAssignment.id, scheduledAt: new Date().toISOString(), scheduledBy: authUser().id });
    }
    client.address = values.address;
    client.allergies = values.allergies;
    client.extraHouseholdMembers = Number(values.extraHouseholdMembers);
    client.requestNote = values.requestNote;
    client.approvalStatus = "APPROVED";
    client.clientStatus = "ACTIVE";
    saveState();
    closeModal();
    render();
    showToast(`${client.motherName} 고객의 ${serviceMetaFor(values.serviceType).label} ${values.weeks}주 일정을 ${assignmentId ? "변경" : "저장"}했습니다.`);
  }

  function openDeleteAssignmentModal(assignmentId) {
    const assignment = state.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return showToast("일정 정보를 찾을 수 없습니다.");
    const client = clientById(assignment.clientId);
    if (!client) return showToast("연결된 고객 정보를 찾을 수 없습니다.", "error");
    const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId);
    const babyName = babyNameFor(assignment, client) || "아이";
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-assignment-title" aria-describedby="delete-assignment-description"><div class="confirm-icon">!</div><h3 id="delete-assignment-title">정말 삭제하시겠습니까?</h3><p id="delete-assignment-description">삭제하면 이 일정은 계약·배정 목록과 월간 캘린더에서 즉시 제거되며 되돌릴 수 없습니다.</p><div class="delete-assignment-summary"><strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyName)}</strong><span>${new Date(assignment.startAt).toLocaleDateString("ko-KR")}–${new Date(assignment.endAt).toLocaleDateString("ko-KR")} · ${assignment.weeks}주</span><span>${escapeHtml(caregiver?.fullName || "관리사 미지정")} · ${assignment.dailyStart}–${assignment.dailyEnd}</span></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>아니요, 유지</button><button type="button" class="danger-button" data-confirm-delete-assignment="${assignment.id}">확인, 삭제</button></div></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-confirm-delete-assignment]").addEventListener("click", () => deleteAssignment(assignment.id));
  }

  function deleteAssignment(assignmentId) {
    const assignment = state.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return showToast("이미 삭제되었거나 존재하지 않는 일정입니다.");
    const client = clientById(assignment.clientId);
    if (!client) return showToast("연결된 고객 정보를 찾을 수 없어 일정을 삭제하지 않았습니다.", "error");
    state.assignments = state.assignments.filter((item) => item.id !== assignmentId);
    state.serviceRequests.forEach((request) => {
      if (request.approvedAssignmentId === assignmentId) request.approvedAssignmentId = null;
    });
    if (state.session.assignmentId === assignmentId) {
      state.session.active = false;
      state.session.assignmentId = null;
      state.session.endedAt = new Date().toISOString();
    }
    saveState();
    closeModal();
    render();
    showToast(`${client.motherName} 고객의 일정을 목록과 캘린더에서 삭제했습니다.`);
  }

  function openServiceAdjustmentModal(targetRef) {
    const [targetType, targetId] = String(targetRef).split(":");
    const target = adjustmentTarget(targetType, targetId);
    const user = authUser();
    const client = state.role === "client" ? clientForUser(user?.id) : null;
    if (!target || !client || target.clientId !== client.id) return showToast("변경할 서비스 정보를 찾을 수 없습니다.");
    if (pendingAdjustment(targetType, targetId)) return showToast("이미 관리자 검토 중인 변경·취소 요청이 있습니다.");
    const serviceType = assignmentServiceType(target);
    const startAt = adjustmentTargetStart(target);
    const postpartumStarted = isPostpartumServiceStarted(target);
    const hasCareHistory = targetType === "ASSIGNMENT" && assignmentHasCareHistory(target);
    const startLocked = postpartumStarted || hasCareHistory;
    const policy = adjustmentPolicy(serviceType, startAt, target, "CHANGE");
    const startValue = startLocked ? dateInputValue(startAt) : new Date(startAt) > new Date() ? dateInputValue(startAt) : localDateKey(new Date(Date.now() + 86400000));
    const durationControl = serviceType === "MASSAGE" ? `<input type="hidden" name="proposedWeeks" value="${Number(target.weeks || target.sessionCount || 1)}"/><div class="read-only-value">${target.durationMinutes || 60}분 · ${target.sessionCount || 1}회</div>` : `<div class="option-grid three">${radioOptions("proposedWeeks", [["2", "2주"], ["3", "3주"], ["4", "4주"]], String(Math.max(MIN_SERVICE_WEEKS, Number(target.weeks || MIN_SERVICE_WEEKS))))}</div>`;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal assignment-modal" role="dialog" aria-modal="true" aria-labelledby="adjustment-title"><header class="modal-header"><div>${serviceBadgeMarkup(serviceType)}<p class="eyebrow">CHANGE & CANCELLATION</p><h3 id="adjustment-title">${serviceMetaFor(serviceType).label} 변경·취소 요청</h3><p>요청은 관리자 승인 전까지 기존 일정에 영향을 주지 않습니다.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-service-adjustment-form><input type="hidden" name="targetType" value="${targetType}"/><input type="hidden" name="targetId" value="${targetId}"/><div class="request-review-grid"><div><span>${serviceType === "MASSAGE" ? "예약일" : "현재 기간"}</span><strong>${new Date(startAt).toLocaleDateString("ko-KR")}${serviceType === "MASSAGE" ? "" : `–${new Date(target.endAt || requestWindow(target).endAt).toLocaleDateString("ko-KR")}`}</strong></div><div><span>현재 시간</span><strong>${target.dailyStart}–${target.dailyEnd}</strong></div></div><div class="status-banner ${policy.tone}" data-adjustment-policy><strong>${escapeHtml(policy.title)}</strong><span>${escapeHtml(policy.detail)}</span></div><div class="field"><span class="field-label">요청 종류</span><div class="option-grid two">${radioOptions("adjustmentAction", [["CHANGE", "일정 변경"], ["CANCEL", "서비스 취소"]], "CHANGE")}</div></div><section class="application-block" data-adjustment-change><h4>변경 희망 일정</h4>${hasCareHistory ? '<div class="status-banner info"><strong>방문 이력이 있어 시작일과 일일 시간은 고정됩니다.</strong><span>과거 기록과 계약을 일치시키기 위해 이용 기간만 변경할 수 있습니다.</span></div>' : ""}<div class="form-grid three"><div class="field"><label for="adjustment-start">시작일</label><input id="adjustment-start" name="proposedStartDate" type="date" min="${localDateKey(new Date())}" value="${startValue}" ${startLocked ? 'readonly aria-readonly="true"' : "required"}/>${startLocked ? `<small>${hasCareHistory ? "완료·진행 방문 이력이 있어 최초 시작일을 변경할 수 없습니다." : "서비스가 시작되어 최초 시작일은 변경할 수 없습니다."}</small>` : ""}</div><div class="field"><label for="adjustment-start-time">시작 시간</label><input id="adjustment-start-time" name="proposedDailyStart" type="time" value="${target.dailyStart}" ${hasCareHistory ? 'readonly aria-readonly="true"' : ""} required/></div><div class="field"><label for="adjustment-end-time">종료 시간</label><input id="adjustment-end-time" name="proposedDailyEnd" type="time" value="${target.dailyEnd}" ${serviceType === "MASSAGE" || hasCareHistory ? 'readonly aria-readonly="true"' : ""} required/></div></div><div class="field"><span class="field-label">${serviceType === "MASSAGE" ? "예약 상품" : "이용 기간"}</span>${durationControl}</div></section><div class="field"><label for="adjustment-reason">변경·취소 사유</label><textarea id="adjustment-reason" name="reason" placeholder="관리자가 일정과 관리사 배정을 판단할 수 있도록 구체적으로 적어주세요." required></textarea></div><label class="consent-row"><input type="checkbox" name="policyAccepted" required/><span><strong>표시된 정책을 확인했습니다.</strong><small>관리자 승인 결과와 비용 처리 내역은 나의 서비스에서 확인할 수 있습니다.</small></span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">관리자에게 요청</button></div></form></section></div>`;
    const form = modalRoot.querySelector("[data-service-adjustment-form]");
    form.insertAdjacentHTML("afterbegin", `<input type="hidden" name="serviceType" value="${serviceType}"/>`);
    configureBabysittingMinimumTime(form, "proposedDailyStart", "proposedDailyEnd");
    configurePostpartumFixedTime(form, "proposedDailyStart", "proposedDailyEnd");
    if (serviceType === "MASSAGE") {
      const syncMassageEnd = () => { form.elements.proposedDailyEnd.value = timeFromMinutes(timeMinutes(form.elements.proposedDailyStart.value) + Number(target.durationMinutes || 60)); };
      form.elements.proposedDailyStart.addEventListener("input", syncMassageEnd);
      syncMassageEnd();
    }
    if (hasCareHistory) {
      form.querySelector(".babysitting-duration-field input")?.setAttribute("disabled", "");
    }
    const toggle = () => {
      const action = form.elements.adjustmentAction.value;
      form.querySelector("[data-adjustment-change]").hidden = action === "CANCEL";
      const currentPolicy = adjustmentPolicy(serviceType, startAt, target, action);
      const policyBanner = form.querySelector("[data-adjustment-policy]");
      policyBanner.className = `status-banner ${currentPolicy.tone}`;
      policyBanner.querySelector("strong").textContent = currentPolicy.title;
      policyBanner.querySelector("span").textContent = currentPolicy.detail;
      form.querySelector('button[type="submit"]').disabled = currentPolicy.allowed === false;
    };
    form.querySelectorAll('input[name="adjustmentAction"]').forEach((radio) => radio.addEventListener("change", toggle));
    form.addEventListener("submit", submitServiceAdjustment);
    bindModalFrame();
    toggle();
  }

  async function submitServiceAdjustment(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const target = adjustmentTarget(values.targetType, values.targetId);
    if (!target || pendingAdjustment(values.targetType, values.targetId)) return showToast("서비스 정보가 없거나 이미 검토 중인 요청이 있습니다.");
    const serviceType = assignmentServiceType(target);
    if (values.adjustmentAction === "CHANGE") {
      if (serviceType !== "MASSAGE" && Number(values.proposedWeeks) < MIN_SERVICE_WEEKS) return showToast("서비스는 최소 2주부터 가능합니다.");
      if (values.proposedDailyEnd <= values.proposedDailyStart) return showToast("종료 시간은 시작 시간보다 늦어야 합니다.");
      if (serviceType === "BABYSITTING" && babysittingHours(values.proposedDailyStart, values.proposedDailyEnd) < MIN_BABYSITTING_HOURS) return showToast("베이비시팅은 하루 최소 4시간부터 변경할 수 있습니다.");
      if (serviceType === "POSTPARTUM" && values.proposedDailyEnd !== postpartumEndTime(values.proposedDailyStart)) return showToast("산후조리 종료시간은 시작시간부터 케어 8시간·식사 1시간·휴식 30분을 반영해 자동 계산됩니다.");
      if (isPostpartumServiceStarted(target) && values.proposedStartDate !== dateInputValue(adjustmentTargetStart(target))) return showToast("이미 시작된 산후조리 서비스의 시작일은 변경할 수 없습니다.");
      if (assignmentHasCareHistory(target) && (values.proposedStartDate !== dateInputValue(adjustmentTargetStart(target)) || values.proposedDailyStart !== target.dailyStart || values.proposedDailyEnd !== target.dailyEnd)) return showToast("방문 이력이 있는 서비스는 시작일과 일일 시간을 변경할 수 없습니다.", "error");
    }
    const policy = adjustmentPolicy(serviceType, adjustmentTargetStart(target), target, values.adjustmentAction);
    if (policy.allowed === false) return showToast(policy.detail, "error");
    if (usingCloudData()) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "요청 저장 중…";
      try {
        const submitAdjustment = serviceType === "MASSAGE" ? submitMassageAdjustmentCloud : submitServiceAdjustmentCloud;
        await submitAdjustment({
          targetType: values.targetType,
          targetId: values.targetId,
          clientId: target.clientId,
          serviceType,
          action: values.adjustmentAction,
          proposedStartDate: values.adjustmentAction === "CHANGE" ? values.proposedStartDate : null,
          proposedDailyStart: values.adjustmentAction === "CHANGE" ? values.proposedDailyStart : null,
          proposedDailyEnd: values.adjustmentAction === "CHANGE" ? values.proposedDailyEnd : null,
          proposedWeeks: values.adjustmentAction === "CHANGE" ? values.proposedWeeks : null,
          reason: values.reason,
          policy,
        });
        closeModal();
        await refreshCloudState();
        showToast(`${serviceMetaFor(serviceType).label} ${values.adjustmentAction === "CANCEL" ? "취소" : "변경"} 요청을 접수했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "변경·취소 요청을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "관리자에게 요청";
      }
      return;
    }
    state.serviceAdjustments.push({ id: `adjustment-${Date.now()}`, clientId: target.clientId, serviceType, targetType: values.targetType, targetId: values.targetId, action: values.adjustmentAction, proposedStartDate: values.adjustmentAction === "CHANGE" ? values.proposedStartDate : null, proposedDailyStart: values.adjustmentAction === "CHANGE" ? values.proposedDailyStart : null, proposedDailyEnd: values.adjustmentAction === "CHANGE" ? values.proposedDailyEnd : null, proposedWeeks: values.adjustmentAction === "CHANGE" ? Number(values.proposedWeeks) : null, reason: values.reason.trim(), policyCode: policy.code, policyTitle: policy.title, policyDetail: policy.detail, originalContractValue: policy.originalTotal || null, depositAmount: policy.deposit || target.depositAmount || null, remainingCareDays: policy.remainingCareDays || null, cancellationSettlementAmount: policy.settlementAmount || null, status: "PENDING", createdAt: new Date().toISOString() });
    saveState(); closeModal(); render();
    showToast(`${serviceMetaFor(serviceType).label} ${values.adjustmentAction === "CANCEL" ? "취소" : "변경"} 요청을 접수했습니다.`);
  }

  function localMassageAvailableSlots(durationMinutes, dateFrom, dateTo) {
    const now = new Date();
    const rangeStart = new Date(`${dateFrom}T00:00:00`);
    const rangeEnd = new Date(`${dateTo}T23:59:59`);
    return (state.massageAvailability || []).flatMap((availability) => {
      const user = state.users.find((item) => item.caregiverId === availability.caregiverId || item.id === availability.caregiverUserId);
      if (!user?.isMassageTherapist) return [];
      const day = new Date(`${availability.availableDate}T00:00:00`);
      if (day < rangeStart || day > rangeEnd) return [];
      const windowStart = new Date(`${availability.availableDate}T${availability.startTime}:00`);
      const windowEnd = new Date(`${availability.availableDate}T${availability.endTime}:00`);
      const slots = [];
      for (let cursor = new Date(windowStart); cursor.getTime() + durationMinutes * 60000 <= windowEnd.getTime(); cursor = new Date(cursor.getTime() + 30 * 60000)) {
        const endsAt = new Date(cursor.getTime() + durationMinutes * 60000);
        if ((cursor.getTime() - now.getTime()) / 3600000 <= MASSAGE_CHANGE_NOTICE_HOURS) continue;
        const conflicts = (state.massageBookings || []).some((booking) => booking.caregiverId === availability.caregiverId && ["PENDING", "CONFIRMED"].includes(booking.status) && cursor < new Date(new Date(booking.endsAt).getTime() + 60 * 60000) && endsAt > new Date(new Date(booking.startsAt).getTime() - 60 * 60000));
        if (!conflicts) slots.push({ id: `${availability.id}:${cursor.toISOString()}`, availabilityId: availability.id, caregiverId: availability.caregiverId, caregiverUserId: user.id, therapistName: user.fullName || "ProMoms 테라피스트", startsAt: cursor.toISOString(), endsAt: endsAt.toISOString() });
      }
      return slots;
    }).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }

  async function massageAvailableSlots(durationMinutes, dateFrom, dateTo) {
    return usingCloudData()
      ? loadMassageAvailableSlotsCloud(durationMinutes, dateFrom, dateTo)
      : localMassageAvailableSlots(durationMinutes, dateFrom, dateTo);
  }

  function massageSlotLabel(slot) {
    const start = new Date(slot.startsAt);
    const end = new Date(slot.endsAt);
    return `${start.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })} · ${timeLabel(start)}–${timeLabel(end)} · ${slot.therapistName}`;
  }

  async function openMassageBookingModal() {
    const user = authUser();
    if (!user) {
      state.auth.screen = "signup";
      saveState();
      render();
      return;
    }
    if (state.role !== "client" || !userHasAccessRole(user, "CLIENT")) return showToast("마사지 예약은 고객 작업공간에서 신청해 주세요.", "error");
    const client = clientForUser(user.id);
    if (!client) return showToast("고객 프로필 연결을 먼저 확인해 주세요.", "error");
    const memberPricing = clientQualifiesForMassageMemberRate(client.id);
    const pricingTier = memberPricing ? "POSTPARTUM_CLIENT" : "GENERAL";
    const earliest = new Date();
    earliest.setDate(earliest.getDate() + 2);
    const earliestDate = localDateKey(earliest);
    const latest = new Date(earliest);
    latest.setDate(latest.getDate() + 55);
    const latestDate = localDateKey(latest);
    let slots60 = [];
    let slots90 = [];
    try {
      [slots60, slots90] = await Promise.all([
        massageAvailableSlots(60, earliestDate, latestDate),
        massageAvailableSlots(90, earliestDate, latestDate),
      ]);
    } catch (error) {
      return showToast(friendlyErrorMessage(error, "마사지 예약 가능시간을 불러오지 못했습니다."), "error");
    }
    const packageOption = memberPricing ? `<label><input type="radio" name="massagePlan" value="PACKAGE_4"/><span><strong>60분 × 4회</strong><small>$520 · 가능한 슬롯 4개를 각각 선택</small></span></label>` : "";
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal service-application-modal massage-booking-modal" role="dialog" aria-modal="true" aria-labelledby="massage-booking-title"><header class="modal-header"><div>${serviceBadgeMarkup("MASSAGE")}<p class="eyebrow">MASSAGE BOOKING</p><h3 id="massage-booking-title">산전·산후 마사지 예약</h3><p>테라피스트가 등록한 09:00–20:00 근무 가능시간에서 예약할 수 있습니다.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-massage-booking-form><input type="hidden" name="pricingTier" value="${pricingTier}"/><div class="status-banner ${memberPricing ? "success" : "info"}"><strong>${memberPricing ? "ProMoms 산후조리 고객 우대가" : "일반 고객 요금"}</strong><span>${memberPricing ? "현재 또는 예약된 산후조리 서비스가 확인되어 우대가가 자동 적용됩니다." : "산후조리 서비스 승인·예약이 확인되면 우대가가 자동 적용됩니다."}</span></div><section class="application-block"><h4>서비스 선택</h4><div class="massage-plan-options"><label><input type="radio" name="massagePlan" value="SINGLE_60" checked/><span><strong>60분 1회</strong><small>${money(MASSAGE_PRICES[pricingTier][60])}</small></span></label><label><input type="radio" name="massagePlan" value="SINGLE_90"/><span><strong>90분 1회</strong><small>${money(MASSAGE_PRICES[pricingTier][90])}</small></span></label>${packageOption}</div></section><section class="application-block massage-slot-section"><div class="section-header"><div><h4>테라피스트 가능시간 선택</h4><p>예약 전후 1시간은 이동시간으로 자동 제외됩니다.</p></div><span class="status-chip" data-massage-slot-count>0개 선택</span></div><div class="field"><label for="massage-slot-date">예약 가능한 날짜</label><select id="massage-slot-date" data-massage-slot-date></select></div><div class="massage-slot-grid" data-massage-slot-grid></div><div class="massage-selected-slots" data-massage-selected-slots></div></section><section class="application-block"><h4>방문 정보</h4><div class="field"><label for="massage-address">서비스 주소</label><input id="massage-address" name="requestAddress" value="${escapeHtml(client.address || "")}" placeholder="Street, City, State ZIP" required/></div><div class="field"><label for="massage-notes">요청사항</label><textarea id="massage-notes" name="requestSpecialNotes" maxlength="1000" placeholder="임신 주수, 회복 상태, 집중을 원하는 부위 등 테라피스트가 알아야 할 내용을 적어주세요."></textarea></div></section><div class="application-price-summary" data-massage-price><span>${memberPricing ? "산후조리 고객 우대가" : "일반 고객가"}</span><strong>${money(MASSAGE_PRICES[pricingTier][60])}</strong><small>고객 신청 후 관리자가 승인해야 일정이 최종 확정됩니다.</small></div><label class="consent-row application-consent"><input type="checkbox" name="requestConsent" required/><span><strong>예약 정보 활용 및 24시간 변경·취소 규정에 동의합니다.</strong><small>선택 슬롯은 관리자 승인 전까지 대기 상태이며, 승인 시 테라피스트 일정으로 확정됩니다.</small></span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">마사지 예약 요청</button></div></form></section></div>`;
    const form = modalRoot.querySelector("[data-massage-booking-form]");
    const selectedSlotIds = new Set();
    const slotDateSelect = form.querySelector("[data-massage-slot-date]");
    const slotGrid = form.querySelector("[data-massage-slot-grid]");
    const selectedSlots = form.querySelector("[data-massage-selected-slots]");
    const activeSlots = () => form.elements.massagePlan.value === "SINGLE_90" ? slots90 : slots60;
    const refreshSlots = (keepDate = true) => {
      const plan = form.elements.massagePlan.value;
      const pool = activeSlots();
      const multiple = plan === "PACKAGE_4";
      const previousDate = keepDate ? slotDateSelect.value : "";
      const dates = [...new Set(pool.map((slot) => localDateKey(slot.startsAt)))];
      slotDateSelect.innerHTML = dates.length ? dates.map((date) => `<option value="${date}" ${date === previousDate ? "selected" : ""}>${formatDate(`${date}T12:00:00`)}</option>`).join("") : `<option value="">예약 가능시간 없음</option>`;
      if (previousDate && dates.includes(previousDate)) slotDateSelect.value = previousDate;
      const currentDate = slotDateSelect.value;
      const dailySlots = pool.filter((slot) => localDateKey(slot.startsAt) === currentDate);
      slotGrid.innerHTML = dailySlots.length ? dailySlots.map((slot) => `<label class="massage-slot-option ${selectedSlotIds.has(slot.id) ? "selected" : ""}"><input type="${multiple ? "checkbox" : "radio"}" name="massageSlot" value="${escapeHtml(slot.id)}" ${selectedSlotIds.has(slot.id) ? "checked" : ""} ${multiple && selectedSlotIds.size >= 4 && !selectedSlotIds.has(slot.id) ? "disabled" : ""}/><span><strong>${timeLabel(slot.startsAt)}–${timeLabel(slot.endsAt)}</strong><small>${escapeHtml(slot.therapistName)}</small></span></label>`).join("") : `<div class="empty-state compact"><strong>이 날짜에 예약 가능한 시간이 없습니다.</strong></div>`;
      const chosen = pool.filter((slot) => selectedSlotIds.has(slot.id)).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
      form.querySelector("[data-massage-slot-count]").textContent = `${chosen.length}${multiple ? "/4" : "/1"}개 선택`;
      selectedSlots.innerHTML = chosen.length ? `<strong>선택한 일정</strong>${chosen.map((slot, index) => `<div><span>${multiple ? `${index + 1}회차 · ` : ""}${escapeHtml(massageSlotLabel(slot))}</span><button type="button" class="text-button" data-remove-massage-slot="${escapeHtml(slot.id)}">삭제</button></div>`).join("")}` : `<small>${multiple ? "서로 다른 예약 가능시간 4개를 선택해 주세요." : "예약 가능시간 1개를 선택해 주세요."}</small>`;
      slotGrid.querySelectorAll('input[name="massageSlot"]').forEach((input) => input.addEventListener("change", () => {
        if (multiple) {
          if (input.checked && selectedSlotIds.size >= 4) input.checked = false;
          else if (input.checked) selectedSlotIds.add(input.value);
          else selectedSlotIds.delete(input.value);
        } else {
          selectedSlotIds.clear();
          if (input.checked) selectedSlotIds.add(input.value);
        }
        refreshSlots();
      }));
      selectedSlots.querySelectorAll("[data-remove-massage-slot]").forEach((button) => button.addEventListener("click", () => { selectedSlotIds.delete(button.dataset.removeMassageSlot); refreshSlots(); }));
    };
    const refreshPrice = () => {
      const plan = form.elements.massagePlan.value;
      const values = plan === "PACKAGE_4" ? { pricingTier, durationMinutes: 60, sessionCount: 4 } : { pricingTier, durationMinutes: plan === "SINGLE_90" ? 90 : 60, sessionCount: 1 };
      const price = form.querySelector("[data-massage-price]");
      price.querySelector("strong").textContent = money(massagePrice(values));
      price.querySelector("small").textContent = values.sessionCount === 4 ? "60분 마사지 4회 · 회차별 가능한 날짜와 시간을 각각 선택" : `${values.durationMinutes}분 1회 · 승인 시 전액 수납 확인`;
    };
    form.querySelectorAll('input[name="massagePlan"]').forEach((input) => input.addEventListener("change", () => { selectedSlotIds.clear(); refreshPrice(); refreshSlots(false); }));
    slotDateSelect.addEventListener("change", () => refreshSlots());
    form.addEventListener("submit", (event) => submitMassageBooking(event, { slots60, slots90, selectedSlotIds }));
    bindModalFrame();
    refreshPrice();
    refreshSlots(false);
  }

  async function submitMassageBooking(event, slotState) {
    event.preventDefault();
    const user = authUser();
    const client = clientForUser(user?.id);
    if (!user || !client || state.role !== "client") return showToast("고객 작업공간으로 다시 전환해 주세요.", "error");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const plan = values.massagePlan;
    const durationMinutes = plan === "SINGLE_90" ? 90 : 60;
    const sessionCount = plan === "PACKAGE_4" ? 4 : 1;
    const pool = durationMinutes === 90 ? slotState.slots90 : slotState.slots60;
    const selected = pool.filter((slot) => slotState.selectedSlotIds.has(slot.id)).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    if (selected.length !== sessionCount) return showToast(sessionCount === 4 ? "4회권은 예약 가능한 일정 4개를 선택해 주세요." : "예약 가능한 일정 1개를 선택해 주세요.", "error");
    const expectedTier = clientQualifiesForMassageMemberRate(client.id) ? "POSTPARTUM_CLIENT" : "GENERAL";
    if (sessionCount === 4 && expectedTier !== "POSTPARTUM_CLIENT") return showToast("4회 패키지는 산후조리 예약·이용 고객에게만 제공됩니다.", "error");
    if (selected.some((slot) => hoursUntil(slot.startsAt) <= MASSAGE_CHANGE_NOTICE_HOURS)) return showToast("마사지 예약은 시작 24시간보다 여유 있게 신청해 주세요.", "error");
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "예약 요청 저장 중…";
    try {
      if (usingCloudData()) {
        await submitMassageServiceRequestCloud({
          durationMinutes,
          slots: selected.map((slot) => ({ availability_id: slot.availabilityId, starts_at: slot.startsAt })),
          requestAddress: values.requestAddress,
          requestSpecialNotes: values.requestSpecialNotes,
          requestConsent: values.requestConsent,
        });
        closeModal();
        await refreshCloudState();
      } else {
        const requestId = `massage-request-${Date.now()}`;
        const first = selected[0];
        state.serviceRequests.push({ id: requestId, requestKind: "NEW", serviceType: "MASSAGE", clientId: client.id, userId: user.id, status: "PENDING", weeks: sessionCount, durationMinutes, sessionCount, pricingTier: expectedTier, estimatedTotal: massagePrice({ pricingTier: expectedTier, durationMinutes, sessionCount }), depositAmount: massagePrice({ pricingTier: expectedTier, durationMinutes, sessionCount }), depositStatus: "DUE_ON_APPROVAL", desiredStartDate: first.startsAt, dailyStart: timeLabel(first.startsAt), dailyEnd: timeLabel(first.endsAt), daysOfWeek: [...new Set(selected.map((slot) => KOREAN_WEEKDAYS[new Date(slot.startsAt).getDay()]))], address: values.requestAddress.trim(), specialNotes: values.requestSpecialNotes?.trim() || "", createdAt: new Date().toISOString() });
        state.massageBookings = state.massageBookings || [];
        selected.forEach((slot, index) => state.massageBookings.push({ id: `massage-session-${Date.now()}-${index}`, requestId, clientId: client.id, caregiverId: slot.caregiverId, caregiverUserId: slot.caregiverUserId, sessionNumber: index + 1, startsAt: slot.startsAt, endsAt: slot.endsAt, status: "PENDING", durationMinutes, pricingTier: expectedTier, address: values.requestAddress.trim(), specialNotes: values.requestSpecialNotes?.trim() || "", createdAt: new Date().toISOString() }));
        saveState();
        closeModal();
        render();
      }
      showToast("마사지 예약 요청이 접수되었습니다. 테라피스트 일정 확인 후 확정됩니다.");
    } catch (error) {
      showToast(friendlyErrorMessage(error, "마사지 예약 요청을 저장하지 못했습니다."), "error");
      button.disabled = false;
      button.textContent = "마사지 예약 요청";
    }
  }

  function mondayDateKey(value) {
    const date = startOfLocalDay(new Date(`${value}T12:00:00`));
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return localDateKey(date);
  }

  async function saveMassageAvailability(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const weekdays = formData.getAll("weekday").map(Number);
    const weekStart = mondayDateKey(formData.get("weekStart"));
    const startTime = String(formData.get("startTime"));
    const endTime = String(formData.get("endTime"));
    if (!weekdays.length) return showToast("근무 가능한 요일을 한 개 이상 선택해 주세요.", "error");
    if (startTime < "09:00" || endTime > "20:00" || startTime >= endTime) return showToast("마사지 근무시간은 09:00–20:00 안에서 설정해 주세요.", "error");
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "저장 중…";
    try {
      if (usingCloudData()) {
        await saveMassageAvailabilityCloud({ weekStart, weekdays, startTime, endTime });
        await refreshCloudState();
      } else {
        const user = authUser();
        const caregiverId = user?.caregiverId;
        state.massageAvailability = state.massageAvailability || [];
        const selectedDates = weekdays.map((weekday) => { const date = new Date(`${weekStart}T12:00:00`); date.setDate(date.getDate() + weekday - 1); return localDateKey(date); });
        state.massageAvailability = state.massageAvailability.filter((item) => item.caregiverId !== caregiverId || !selectedDates.includes(item.availableDate));
        selectedDates.forEach((availableDate, index) => state.massageAvailability.push({ id: `massage-availability-${Date.now()}-${index}`, caregiverId, caregiverUserId: user.id, availableDate, startTime, endTime, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
        saveState();
        render();
      }
      showToast("주간 마사지 근무 가능시간을 저장했습니다.");
    } catch (error) {
      showToast(friendlyErrorMessage(error, "근무 가능시간을 저장하지 못했습니다."), "error");
      button.disabled = false;
      button.textContent = "이 주의 가능시간 저장";
    }
  }

  async function deleteMassageAvailability(availabilityId) {
    try {
      if (usingCloudData()) {
        await deleteMassageAvailabilityCloud(availabilityId);
        await refreshCloudState();
      } else {
        state.massageAvailability = (state.massageAvailability || []).filter((item) => item.id !== availabilityId);
        saveState();
        render();
      }
      showToast("근무 가능시간을 삭제했습니다.");
    } catch (error) {
      showToast(friendlyErrorMessage(error, "근무 가능시간을 삭제하지 못했습니다."), "error");
    }
  }

  async function openMassageSessionChangeModal(sessionId) {
    const user = authUser();
    const client = clientForUser(user?.id);
    const booking = (state.massageBookings || []).find((item) => item.id === sessionId && item.clientId === client?.id);
    if (!booking || booking.status !== "CONFIRMED") return showToast("변경할 수 있는 마사지 일정이 아닙니다.", "error");
    if (hoursUntil(booking.startsAt) <= MASSAGE_CHANGE_NOTICE_HOURS) return showToast("마사지 변경·취소는 시작 24시간 이전까지만 가능합니다.", "error");
    const earliest = new Date();
    earliest.setDate(earliest.getDate() + 2);
    const latest = new Date(earliest);
    latest.setDate(latest.getDate() + 55);
    let slots = [];
    try {
      slots = await massageAvailableSlots(booking.durationMinutes || 60, localDateKey(earliest), localDateKey(latest));
    } catch (error) {
      return showToast(friendlyErrorMessage(error, "변경 가능한 시간을 불러오지 못했습니다."), "error");
    }
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="massage-change-title"><header class="modal-header"><div><p class="eyebrow">MASSAGE CHANGE</p><h3 id="massage-change-title">마사지 일정 변경·취소</h3><p>${escapeHtml(massageBookingDateTime(booking))}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-massage-session-change-form><div class="option-grid two"><label class="radio-option"><input type="radio" name="action" value="CHANGE" checked/><span><strong>일정 변경</strong><small>다른 예약 가능시간 선택</small></span></label><label class="radio-option"><input type="radio" name="action" value="CANCEL"/><span><strong>예약 취소</strong><small>해당 회차만 취소 요청</small></span></label></div><div class="field" data-massage-change-slot><label for="massage-change-slot">새 예약 가능시간</label><select id="massage-change-slot" name="slotId" required>${slots.length ? slots.map((slot) => `<option value="${escapeHtml(slot.id)}">${escapeHtml(massageSlotLabel(slot))}</option>`).join("") : `<option value="">예약 가능한 시간이 없습니다</option>`}</select></div><div class="field"><label for="massage-change-reason">변경·취소 사유</label><textarea id="massage-change-reason" name="reason" minlength="2" maxlength="500" required></textarea></div><div class="status-banner info"><strong>24시간 이전 요청</strong><span>요청은 관리자가 승인한 뒤 일정에 반영됩니다.</span></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">관리자에게 요청</button></div></form></section></div>`;
    const form = modalRoot.querySelector("[data-massage-session-change-form]");
    const toggle = () => {
      const changing = form.elements.action.value === "CHANGE";
      form.querySelector("[data-massage-change-slot]").hidden = !changing;
      form.elements.slotId.required = changing;
    };
    form.querySelectorAll('input[name="action"]').forEach((input) => input.addEventListener("change", toggle));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const slot = slots.find((item) => item.id === values.slotId) || null;
      if (values.action === "CHANGE" && !slot) return showToast("변경할 예약 가능시간을 선택해 주세요.", "error");
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "요청 저장 중…";
      try {
        if (usingCloudData()) {
          await submitMassageBookingChangeCloud({ sessionId, action: values.action, reason: values.reason, slot });
          closeModal();
          await refreshCloudState();
        } else {
          state.massageBookingChanges = state.massageBookingChanges || [];
          state.massageBookingChanges.push({ id: `massage-change-${Date.now()}`, sessionId, requestedBy: user.id, action: values.action, proposedCaregiverId: slot?.caregiverId || null, proposedStartsAt: slot?.startsAt || null, proposedEndsAt: slot?.endsAt || null, reason: values.reason.trim(), status: "PENDING", createdAt: new Date().toISOString() });
          saveState();
          closeModal();
          render();
        }
        showToast("마사지 일정 변경·취소 요청을 접수했습니다.");
      } catch (error) {
        showToast(friendlyErrorMessage(error, "마사지 일정 요청을 저장하지 못했습니다."), "error");
        button.disabled = false;
        button.textContent = "관리자에게 요청";
      }
    });
    bindModalFrame();
    toggle();
  }

  async function reviewMassageBookingChange(changeId, approve) {
    const change = (state.massageBookingChanges || []).find((item) => item.id === changeId && item.status === "PENDING");
    if (!change) return showToast("이미 처리되었거나 찾을 수 없는 요청입니다.", "error");
    try {
      if (usingCloudData()) {
        await reviewMassageBookingChangeCloud(changeId, approve, approve ? "관리자 승인" : "관리자 반려");
        await refreshCloudState();
      } else {
        const booking = (state.massageBookings || []).find((item) => item.id === change.sessionId);
        change.status = approve ? "APPROVED" : "REJECTED";
        change.reviewedAt = new Date().toISOString();
        change.reviewedBy = authUser()?.id;
        if (approve && booking) {
          if (change.action === "CANCEL") {
            booking.status = "CANCELLED";
            booking.cancelledAt = new Date().toISOString();
            booking.cancellationReason = change.reason;
          } else {
            booking.caregiverId = change.proposedCaregiverId;
            booking.caregiverUserId = state.users.find((item) => item.caregiverId === change.proposedCaregiverId)?.id || booking.caregiverUserId;
            booking.startsAt = change.proposedStartsAt;
            booking.endsAt = change.proposedEndsAt;
          }
        }
        saveState();
        render();
      }
      showToast(`마사지 일정 요청을 ${approve ? "승인" : "반려"}했습니다.`);
    } catch (error) {
      showToast(friendlyErrorMessage(error, "마사지 일정 요청을 처리하지 못했습니다."), "error");
    }
  }

  function openServiceApplicationModal(preselectedType = null, applicationMode = "NEW", extensionAssignmentId = null, preselectedPostpartumMode = "COMMUTE") {
    const user = authUser();
    if (!user || state.role !== "client" || !userHasAccessRole(user, "CLIENT")) return showToast("고객 작업공간으로 전환해 주세요.");
    const client = clientForUser(user.id);
    if (!client) return showToast("가족 고객 정보가 계정에 연결되지 않았습니다. 관리자에게 회원 연결 확인을 요청해 주세요.", "error");
    const selectedType = ["POSTPARTUM", "BABYSITTING"].includes(preselectedType) ? preselectedType : defaultServiceApplicationType(client);
    const initialPostpartumMode = preselectedPostpartumMode === "LIVE_IN" ? "LIVE_IN" : "COMMUTE";
    const extensionMode = applicationMode === "EXTENSION" && selectedType === "BABYSITTING";
    const extensionAssignment = extensionMode
      ? state.assignments.find((assignment) => assignment.id === extensionAssignmentId && assignment.clientId === client.id && assignment.status !== "CANCELLED" && assignmentServiceType(assignment) === "BABYSITTING") || null
      : null;
    if (extensionMode && !extensionAssignment) return showToast("연장할 베이비시팅 일정을 먼저 선택해 주세요.", "error");
    // The child is selected inside the form. Do not block the whole family here:
    // another child may request a separate service while a sibling has an active plan.
    const extensionBabyName = extensionAssignment ? babyNameFor(extensionAssignment, client) : "";
    const latestEnd = extensionMode ? latestServiceEnd(client.id, "BABYSITTING", extensionAssignment.babyId, extensionBabyName) : null;
    const start = extensionMode && latestEnd ? nextWeekdayAfter(latestEnd) : selectedType === "BABYSITTING" ? minimumBabysittingStartDate(client.id) : new Date();
    if (selectedType !== "BABYSITTING") start.setDate(start.getDate() + 7);
    const startValue = localDateKey(start);
    const babysittingMinimum = extensionMode ? startValue : localDateKey(minimumBabysittingStartDate(client.id));
    const registeredBabies = babiesForClient(client);
    const initialBabyName = extensionBabyName || client.babyName || "";
    const initialBaby = findClientBaby(client, initialBabyName, extensionAssignment?.babyId || null);
    const initialBabyBirthDate = initialBaby?.birthDate || client.babyBirthDate || "";
    const initialBabyId = initialBaby?.id || extensionAssignment?.babyId || "";
    const babySelectionMarkup = registeredBabies.length
      ? `<div class="field"><label for="application-baby-selector">서비스 대상 아이</label><select id="application-baby-selector" data-baby-selector ${extensionMode ? 'disabled aria-disabled="true"' : ""}>${registeredBabies.map((baby) => `<option value="${escapeHtml(baby.id || "")}" ${baby.id === initialBabyId ? "selected" : ""}>${escapeHtml(baby.name || "이름 미등록")} · ${baby.birthDate ? formatDate(baby.birthDate) : "생년월일 미등록"}</option>`).join("")}${extensionMode ? "" : '<option value="__new__">+ 새 아이 등록</option>'}</select><small>기존 아이는 목록에서 선택해야 동일 서비스와 일정 중복을 정확히 확인할 수 있습니다.</small></div>`
      : "";
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal service-application-modal" role="dialog" aria-modal="true" aria-labelledby="service-application-title"><header class="modal-header"><div><p class="eyebrow">${extensionMode ? "SERVICE EXTENSION" : "CARE REQUEST"}</p><h3 id="service-application-title">${extensionMode ? "베이비시팅 기간 연장 신청" : "서비스 신청"}</h3><p>${extensionMode ? "기존 베이비시팅 종료 후 첫 평일에 이어서 시작합니다." : "희망 내용을 접수하면 관리자가 가능한 관리사를 확인해 배정합니다."}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-service-application-form><input type="hidden" name="applicationMode" value="${extensionMode ? "EXTENSION" : "NEW"}"/><input type="hidden" name="extensionAssignmentId" value="${escapeHtml(extensionAssignment?.id || "")}"/><input type="hidden" name="postpartumMode" value="${initialPostpartumMode}"/>
      <div class="field"><span class="field-label">서비스 종류</span><div class="service-choice-grid">${[["POSTPARTUM", "♡", "산후조리", "산모 회복·신생아 케어와 관리 차트"], ["BABYSITTING", "☆", "베이비시팅", "아이 식사·놀이·생활 이벤트 기록"]].map(([value, icon, label, detail]) => { const unavailable = extensionMode && value !== "BABYSITTING"; return `<label class="service-choice ${unavailable ? "unavailable" : ""}"><input type="radio" name="serviceType" value="${value}" ${value === selectedType ? "checked" : ""} ${unavailable ? "disabled" : ""}/><span><b>${icon}</b><strong>${label}</strong><small>${detail}</small></span></label>`; }).join("")}</div></div>
      <section class="application-block"><h4>아이 정보</h4>${babySelectionMarkup}<input type="hidden" name="babyId" value="${escapeHtml(initialBabyId)}"/><div class="form-grid two"><div class="field"><label for="application-baby-name">아기 이름</label><input id="application-baby-name" name="babyName" value="${escapeHtml(initialBabyName)}" autocomplete="off" ${initialBaby || extensionMode ? 'readonly aria-readonly="true"' : ""} required /><small>${extensionMode ? "연장 대상 아이는 기존 예약과 동일하게 유지됩니다." : registeredBabies.length ? "새 아이를 추가하려면 위 목록에서 ‘새 아이 등록’을 선택해 주세요." : "서비스를 받을 아이의 이름을 입력해 주세요."}</small></div><div class="field"><label for="application-baby-birth">출생일 또는 출산 예정일</label><input id="application-baby-birth" name="babyBirthDate" type="date" value="${initialBabyBirthDate ? dateInputValue(initialBabyBirthDate) : ""}" ${initialBaby || extensionMode ? 'readonly aria-readonly="true"' : ""} required /></div></div></section>
      <section class="application-block"><h4>희망 일정</h4><div class="field"><span class="field-label">이용 기간</span><div class="option-grid three">${radioOptions("requestedWeeks", [["2", "2주"], ["3", "3주"], ["4", "4주"]], "2")}</div></div><div class="form-grid three"><div class="field"><label for="application-start">희망 시작일</label><input id="application-start" name="desiredStartDate" type="date" min="${selectedType === "BABYSITTING" ? babysittingMinimum : localDateKey(new Date())}" value="${startValue}" data-babysitting-min="${babysittingMinimum}" required /><small data-start-guidance>희망 시작일은 관리자 확인 후 확정됩니다.</small></div><div class="field"><label for="application-start-time">시작 시간</label><input id="application-start-time" name="requestedDailyStart" type="time" value="09:00" required /></div><div class="field"><label for="application-end-time">종료 시간</label><input id="application-end-time" name="requestedDailyEnd" type="time" value="17:00" required /></div></div><div class="field"><span class="field-label">희망 요일</span><div class="weekday-options">${["월", "화", "수", "목", "금", "토", "일"].map((day) => `<label><input type="checkbox" name="daysOfWeek" value="${day}" ${["월", "화", "수", "목", "금"].includes(day) ? "checked" : ""}/><span>${day}</span></label>`).join("")}</div></div><div class="application-price-summary" data-application-price><span>산후조리 예상 서비스 비용</span><strong>$${postpartumEstimate(2).toLocaleString("en-US")}</strong><small>주 $${POSTPARTUM_WEEKLY_RATE.toLocaleString("en-US")} × 2주 · 예약금 $${POSTPARTUM_DEPOSIT.toLocaleString("en-US")}</small></div></section>
      <section class="application-block"><h4>방문·안전 정보</h4><div class="field"><label for="application-address">서비스 주소</label><input id="application-address" name="requestAddress" value="${escapeHtml(client.address || user.address || "")}" placeholder="Street, City, State ZIP" required /></div><div class="form-grid two"><div class="field"><label for="application-household">가정 내 추가인원</label><input id="application-household" name="requestHousehold" type="number" min="0" value="${Number(client.extraHouseholdMembers || 0)}" required /></div><div class="field"><label for="application-allergies">알러지 유무 및 내용</label><input id="application-allergies" name="requestAllergies" value="${escapeHtml(client.allergies || "없음")}" required /></div></div></section>
      <section class="application-block" data-postpartum-application><h4>산후조리 형태</h4><div class="option-grid two"><label class="radio-option"><input type="radio" name="postpartumModeChoice" value="COMMUTE" ${initialPostpartumMode === "COMMUTE" ? "checked" : ""}/><span><strong>출퇴근형</strong><small>주 $1,800 · 2/3/4주</small></span></label><label class="radio-option"><input type="radio" name="postpartumModeChoice" value="LIVE_IN" ${initialPostpartumMode === "LIVE_IN" ? "checked" : ""}/><span><strong>입주형</strong><small>주 $2,100 · 기본 4주</small></span></label></div><div class="field"><label for="maternal-notes">산모 상태·회복 지원 요청</label><textarea id="maternal-notes" name="maternalNotes" placeholder="회복 상태, 식사, 수유 지원 등 필요한 내용을 적어주세요."></textarea></div></section>
      <section class="application-block" data-babysitting-application hidden><h4>베이비시팅 요청</h4><div class="field"><label for="meal-instructions">식사·간식 지침</label><textarea id="meal-instructions" name="mealInstructions" placeholder="식사 시간, 메뉴, 양, 금지 식품을 적어주세요."></textarea></div><div class="form-grid two"><div class="field"><label for="routine-notes">생활 루틴</label><textarea id="routine-notes" name="routineNotes" placeholder="낮잠, 놀이, 산책 루틴"></textarea></div><div class="field"><label for="pickup-notes">인계·출입 지침</label><textarea id="pickup-notes" name="pickupNotes" placeholder="보호자 인계, 출입 방법"></textarea></div></div></section>
      <div class="field"><label for="application-special">특이사항·고객 요청 메모</label><textarea id="application-special" name="requestSpecialNotes" placeholder="반려동물, 주차, 선호 언어 등 관리사가 알아야 할 내용을 적어주세요."></textarea></div>
      <div class="insured-contract-note"><strong>보험 적용 정식 직원 서비스</strong><span>관리사는 ProMoms의 W-2 정식 직원이며, 회사가 급여·세무·고용 책임과 책임보상보험·근로자재해보험 체계를 관리합니다.</span></div><label class="consent-row application-consent"><input type="checkbox" name="requestConsent" required/><span><strong>서비스 신청 정보 수집·배정 활용 및 일정 중복 방지 안내에 동의합니다.</strong><small>입력 정보는 일정 검토와 배정된 관리사의 서비스 준비에 사용되며, 동일 아기의 두 서비스는 같은 기간에 배정되지 않습니다.</small></span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">신청 접수</button></div>
    </form></section></div>`;
    const form = modalRoot.querySelector("[data-service-application-form]");
    const syncRegisteredBaby = (focusNew = false) => {
      const selector = form.querySelector("[data-baby-selector]");
      if (!selector) return;
      const selectedBaby = registeredBabies.find((baby) => baby.id === selector.value) || null;
      form.elements.babyId.value = selectedBaby?.id || "";
      form.elements.babyName.value = selectedBaby?.name || "";
      form.elements.babyBirthDate.value = selectedBaby?.birthDate ? dateInputValue(selectedBaby.birthDate) : "";
      form.elements.babyName.readOnly = Boolean(selectedBaby) || extensionMode;
      form.elements.babyBirthDate.readOnly = Boolean(selectedBaby) || extensionMode;
      form.elements.babyName.setAttribute("aria-readonly", String(form.elements.babyName.readOnly));
      form.elements.babyBirthDate.setAttribute("aria-readonly", String(form.elements.babyBirthDate.readOnly));
      refreshEnhancedDateInput(form.elements.babyBirthDate);
      if (!selectedBaby && focusNew) form.elements.babyName.focus();
    };
    form.querySelector("[data-baby-selector]")?.addEventListener("change", () => syncRegisteredBaby(true));
    if (extensionMode) form.querySelector('input[name="serviceType"][value="POSTPARTUM"]').disabled = true;
    form.elements.requestedDailyEnd.dataset.babysittingHours = String(MIN_BABYSITTING_HOURS);
    configureBabysittingMinimumTime(form, "requestedDailyStart", "requestedDailyEnd");
    configurePostpartumFixedTime(form, "requestedDailyStart", "requestedDailyEnd");
    const updatePrice = () => { const babysitting = form.elements.serviceType.value === "BABYSITTING"; const weeks = Number(form.elements.requestedWeeks.value || POSTPARTUM_DEFAULT_WEEKS); const liveIn = form.elements.postpartumMode.value === "LIVE_IN"; const rate = liveIn ? POSTPARTUM_LIVE_IN_WEEKLY_RATE : POSTPARTUM_WEEKLY_RATE; const price = form.querySelector("[data-application-price]"); price.hidden = false; price.querySelector("span").textContent = babysitting ? "베이비시팅 예약금" : `${liveIn ? "입주형" : "출퇴근형"} 예상 서비스 비용`; price.querySelector("strong").textContent = babysitting ? `$${BABYSITTING_DEPOSIT.toLocaleString("en-US")}` : `$${(rate * weeks).toLocaleString("en-US")}`; price.querySelector("small").textContent = babysitting ? `시간당 $${BABYSITTING_HOURLY_RATE} × ${MIN_BABYSITTING_HOURS}시간 · 72시간 이전 취소 시 환불` : `주 $${rate.toLocaleString("en-US")} × ${weeks}주 · 승인 시 예약금 $${POSTPARTUM_DEPOSIT.toLocaleString("en-US")}`; };
    const syncPostpartumMode = () => { const selected = form.querySelector('input[name="postpartumModeChoice"]:checked')?.value || "COMMUTE"; form.elements.postpartumMode.value = selected; const liveIn = selected === "LIVE_IN"; form.querySelectorAll('input[name="requestedWeeks"]').forEach((input) => { input.disabled = liveIn && input.value !== "4"; }); if (liveIn) form.elements.requestedWeeks.value = "4"; updatePrice(); };
    const toggle = () => { const babysitting = form.elements.serviceType.value === "BABYSITTING"; const startInput = form.elements.desiredStartDate; const guidance = form.querySelector("[data-start-guidance]"); form.querySelector("[data-babysitting-application]").hidden = !babysitting; form.querySelector("[data-postpartum-application]").hidden = babysitting; form.querySelectorAll('input[name="requestedWeeks"]').forEach((input) => { input.disabled = false; }); if (!babysitting) syncPostpartumMode(); startInput.min = babysitting ? startInput.dataset.babysittingMin : localDateKey(new Date()); startInput.readOnly = extensionMode; if (babysitting && startInput.value < startInput.min) startInput.value = startInput.min; guidance.textContent = extensionMode ? `기존 예약 종료 후 첫 평일인 ${new Date(`${startInput.dataset.babysittingMin}T12:00:00`).toLocaleDateString("ko-KR")}로 자동 배치됩니다.` : form.elements.postpartumMode.value === "LIVE_IN" && !babysitting ? "입주형은 기본 4주이며 세부 입주·휴무 일정은 관리자 확인 후 확정됩니다." : "희망 시작일은 관리자 확인 후 확정됩니다."; refreshEnhancedDateInput(startInput); updatePrice(); };
    form.querySelectorAll('input[name="serviceType"]').forEach((radio) => radio.addEventListener("change", toggle));
    form.querySelectorAll('input[name="requestedWeeks"]').forEach((radio) => radio.addEventListener("change", updatePrice));
    form.querySelectorAll('input[name="postpartumModeChoice"]').forEach((radio) => radio.addEventListener("change", syncPostpartumMode));
    if (selectedType === "POSTPARTUM") form.elements.requestedWeeks.value = initialPostpartumMode === "LIVE_IN" ? "4" : String(POSTPARTUM_DEFAULT_WEEKS);
    toggle();
    form.addEventListener("submit", submitServiceApplication);
    bindModalFrame();
  }

  async function submitServiceApplication(event) {
    event.preventDefault();
    const user = authUser();
    if (!user || state.role !== "client" || !userHasAccessRole(user, "CLIENT")) return showToast("고객 작업공간으로 다시 전환해 주세요.", "error");
    const client = clientForUser(user.id);
    if (!client) return showToast("가족 고객 정보가 계정에 연결되지 않아 신청을 저장하지 않았습니다.", "error");
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    const extensionMode = values.applicationMode === "EXTENSION" && values.serviceType === "BABYSITTING";
    const requestedBabyId = values.babyId || null;
    const selectedBaby = findClientBaby(client, values.babyName, requestedBabyId);
    if (requestedBabyId && !selectedBaby) return showToast("선택한 아이 정보를 확인할 수 없습니다. 목록에서 다시 선택해 주세요.", "error");
    if (!requestedBabyId && findClientBaby(client, values.babyName)) return showToast("이미 등록된 아이입니다. 아이 목록에서 선택해 주세요.");
    const selectedBabyId = selectedBaby?.id || null;
    if (values.serviceType === "BABYSITTING" && activePostpartumForClient(client, selectedBabyId, values.babyName) && !extensionMode) return showToast("동일 아기가 산후조리를 이용 중인 동안에는 베이비시팅을 새로 신청할 수 없습니다.");
    if (Number(values.requestedWeeks) < MIN_SERVICE_WEEKS) return showToast("서비스 신청은 최소 2주부터 가능합니다.");
    if (values.serviceType === "POSTPARTUM" && values.postpartumMode === "LIVE_IN" && Number(values.requestedWeeks) !== 4) return showToast("입주형 산후조리는 기본 4주로 신청해 주세요.");
    if (values.serviceType === "BABYSITTING" && babysittingHours(values.requestedDailyStart, values.requestedDailyEnd) < MIN_BABYSITTING_HOURS) return showToast("베이비시팅은 하루 최소 4시간부터 신청할 수 있습니다.");
    if (values.serviceType === "POSTPARTUM" && values.requestedDailyEnd !== postpartumEndTime(values.requestedDailyStart)) return showToast("산후조리는 케어 8시간·식사 1시간·휴식 30분을 포함한 종료시간을 사용해야 합니다.");
    const daysOfWeek = formData.getAll("daysOfWeek");
    if (!daysOfWeek.length) return showToast("희망 요일을 한 개 이상 선택해 주세요.");
    if (values.requestedDailyEnd <= values.requestedDailyStart) return showToast("종료 시간은 시작 시간보다 늦어야 합니다.");
    if (!extensionMode && state.serviceRequests.some((request) => request.userId === user.id && ["PENDING", "APPROVED"].includes(request.status) && !request.approvedAssignmentId && assignmentServiceType(request) === values.serviceType && itemMatchesBaby(request, client, selectedBabyId, values.babyName))) return showToast(`같은 아이에 대해 이미 처리 중인 ${serviceMetaFor(values.serviceType).label} 신청이 있습니다.`);
    if (!extensionMode && state.assignments.some((assignment) => assignment.clientId === client.id && assignment.status !== "CANCELLED" && assignmentServiceType(assignment) === values.serviceType && new Date(assignment.endAt) >= new Date() && itemMatchesBaby(assignment, client, selectedBabyId, values.babyName))) return showToast(`같은 아이의 기존 ${serviceMetaFor(values.serviceType).label} 계약 기간이 끝난 뒤 다시 신청할 수 있습니다.`);
    if (extensionMode) {
      const extensionAssignment = state.assignments.find((assignment) => assignment.id === values.extensionAssignmentId && assignment.clientId === client.id && assignment.status !== "CANCELLED" && assignmentServiceType(assignment) === "BABYSITTING");
      if (!extensionAssignment || !itemMatchesBaby(extensionAssignment, client, selectedBabyId, values.babyName)) return showToast("연장 대상 일정을 확인할 수 없습니다.", "error");
      const latestEnd = latestServiceEnd(client.id, "BABYSITTING", selectedBabyId, values.babyName);
      if (!latestEnd) return showToast("연장할 기존 베이비시팅 예약을 찾을 수 없습니다.");
      const earliest = nextWeekdayAfter(latestEnd);
      if (localDateKey(values.desiredStartDate) !== localDateKey(earliest)) return showToast(`연장 일정은 기존 예약 종료 후 첫 평일인 ${earliest.toLocaleDateString("ko-KR")}에 시작합니다.`);
    }
    const requestedWindow = assignmentWindow(values.desiredStartDate, values.requestedDailyStart, values.requestedDailyEnd, values.requestedWeeks);
    const lifecycleIssue = serviceLifecycleIssue(client.id, values.serviceType, requestedWindow.startAt, requestedWindow.endAt, null, null, selectedBabyId, values.babyName);
    if (lifecycleIssue) return showToast(lifecycleIssue.message);
    if (usingCloudData()) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "신청 저장 중…";
      try {
        await submitServiceRequestCloud(values, {
          babyId: selectedBabyId,
          birthOrDueDate: values.babyBirthDate,
          daysOfWeek,
          requestKind: extensionMode ? "EXTENSION" : "NEW",
        });
        closeModal();
        await refreshCloudState();
        showToast(`${serviceMetaFor(values.serviceType).label} ${extensionMode ? "기간 연장" : "서비스"} 신청이 실제 데이터베이스에 접수되었습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "서비스 신청을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "신청 접수";
      }
      return;
    }
    const babyBirthDate = new Date(`${values.babyBirthDate}T12:00:00`).toISOString();
    const babyId = selectedBabyId || `baby-${Date.now()}`;
    if (!selectedBaby) {
      client.babies = babiesForClient(client);
      client.babies.push({ id: babyId, name: values.babyName.trim(), birthDate: babyBirthDate });
    }
    Object.assign(client, { babyId, babyName: values.babyName.trim(), babyBirthDate, address: values.requestAddress.trim(), allergies: values.requestAllergies.trim(), extraHouseholdMembers: Number(values.requestHousehold || 0), requestNote: values.requestSpecialNotes?.trim() || "", clientStatus: "LEAD", approvalStatus: "SERVICE_PENDING" });
    const selectedPostpartumRate = values.postpartumMode === "LIVE_IN" ? POSTPARTUM_LIVE_IN_WEEKLY_RATE : POSTPARTUM_WEEKLY_RATE;
    state.serviceRequests.push({ id: `request-${Date.now()}`, requestKind: extensionMode ? "EXTENSION" : "NEW", serviceType: values.serviceType, postpartumMode: values.serviceType === "POSTPARTUM" ? values.postpartumMode : null, clientId: client.id, userId: user.id, status: "PENDING", babyName: client.babyName, weeks: Number(values.requestedWeeks), weeklyRate: values.serviceType === "POSTPARTUM" ? selectedPostpartumRate : null, estimatedTotal: values.serviceType === "POSTPARTUM" ? selectedPostpartumRate * Number(values.requestedWeeks) : null, depositAmount: values.serviceType === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : null, depositStatus: values.serviceType === "POSTPARTUM" ? "DUE_ON_APPROVAL" : null, desiredStartDate: new Date(`${values.desiredStartDate}T${values.requestedDailyStart}:00`).toISOString(), dailyStart: values.requestedDailyStart, dailyEnd: values.requestedDailyEnd, daysOfWeek, address: values.requestAddress.trim(), extraHouseholdMembers: Number(values.requestHousehold || 0), allergies: values.requestAllergies.trim(), specialNotes: values.requestSpecialNotes?.trim() || "", maternalNotes: values.maternalNotes?.trim() || "", mealInstructions: values.mealInstructions?.trim() || "", routineNotes: values.routineNotes?.trim() || "", pickupNotes: values.pickupNotes?.trim() || "", birthOrDueDate: babyBirthDate, sequencePolicyAccepted: true, insuredStaffingAcknowledged: true, createdAt: new Date().toISOString() });
    Object.assign(state.serviceRequests.at(-1), { babyId, babyName: values.babyName.trim(), depositAmount: values.serviceType === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT, depositStatus: "DUE_ON_APPROVAL" });
    saveState();
    closeModal();
    render();
    showToast(`${serviceMetaFor(values.serviceType).label} ${extensionMode ? "기간 연장" : "서비스"} 신청이 접수되었습니다. 관리자 검토 후 알려드릴게요.`);
  }

  function openClientRequestModal(requestId) {
    if (!canReviewServiceRequests()) return showToast("서비스 신청의 결제 확인과 승인·반려는 소유자 또는 관리자만 처리할 수 있습니다.", "error");
    const request = state.serviceRequests.find((item) => item.id === requestId && item.status === "PENDING");
    if (!request) return showToast("대기 중인 고객 신청을 찾을 수 없습니다.");
    const client = clientById(request.clientId);
    if (!client) return showToast("연결된 고객 정보를 찾을 수 없습니다. 회원·고객 프로필 연결을 확인해 주세요.", "error");
    const serviceType = assignmentServiceType(request);
    const startDate = dateInputValue(request.desiredStartDate);
    const { startAt, endAt } = serviceWindow(request, startDate, request.dailyStart, request.dailyEnd, request.weeks);
    const lifecycleIssue = serviceType === "MASSAGE" ? null : serviceLifecycleIssue(client.id, serviceType, startAt, endAt, null, request.id, request.babyId, request.babyName);
    const requestBabyName = babyNameFor(request, client) || "아이 미등록";
    const periodMarkup = serviceType === "MASSAGE"
      ? `${request.sessionCount || 1}회 · ${formatDate(startAt)}${Number(request.sessionCount || 1) > 1 ? `–${formatDate(endAt)}` : ""}`
      : `${request.weeks}주 · ${formatDate(startAt)}–${formatDate(endAt)}`;
    const massageSessions = serviceType === "MASSAGE"
      ? (state.massageBookings || []).filter((booking) => booking.requestId === request.id && booking.status === "PENDING").sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
      : [];
    const massageSlotReviewMarkup = serviceType === "MASSAGE"
      ? `<div class="wide"><span>고객 선택 슬롯</span><strong class="massage-review-slots">${massageSessions.length ? massageSessions.map((booking) => `${booking.sessionNumber}회차 · ${escapeHtml(massageBookingDateTime(booking))} · ${escapeHtml(state.users.find((user) => user.caregiverId === booking.caregiverId)?.fullName || "테라피스트")}`).join("<br/>") : "선택 슬롯을 찾을 수 없음"}</strong></div>`
      : "";
    const approvalNoticeTitle = serviceType === "MASSAGE" ? "승인과 동시에 마사지 일정 확정" : "승인 후 일정·배정 메뉴로 이동";
    const approvalNoticeDetail = serviceType === "MASSAGE" ? "선택된 모든 슬롯을 다시 검증한 뒤 해당 테라피스트의 마사지 캘린더에 확정합니다." : "일정 중복 검증을 통과했습니다. 승인된 신청은 캘린더의 ‘일정 배치 대기’ 목록에 자동으로 표시됩니다.";
    const productMarkup = serviceType === "POSTPARTUM"
      ? `<div><span>상품·예상 비용</span><strong>${postpartumModeFor(request) === "LIVE_IN" ? "입주형" : "출퇴근형"} · ${money(requestServiceTotal(request))} · 주 ${money(postpartumWeeklyRate(request))}</strong></div>`
      : serviceType === "MASSAGE"
        ? `<div><span>상품·결제 금액</span><strong>${request.durationMinutes || 60}분 × ${request.sessionCount || 1}회 · ${money(requestServiceTotal(request))}</strong></div><div><span>가격 구분</span><strong>${request.pricingTier === "POSTPARTUM_CLIENT" ? "산후조리 예약·이용 고객 우대가" : "일반 고객가"}</strong></div>`
        : `<div><span>예상 서비스 비용</span><strong>${money(requestServiceTotal(request))} · 시간당 $${BABYSITTING_HOURLY_RATE}</strong></div>`;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal assignment-modal" role="dialog" aria-modal="true" aria-labelledby="client-request-title"><header class="modal-header"><div>${serviceBadgeMarkup(request.serviceType)}<h3 id="client-request-title">${serviceMetaFor(request.serviceType).label} 신청 검토·승인</h3><p>${escapeHtml(client.motherName)}${serviceType === "MASSAGE" ? "" : ` · ${escapeHtml(requestBabyName)}`}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-client-request-form>
      <div class="request-review-grid"><div><span>${serviceType === "MASSAGE" ? "예약 구성" : "희망 기간"}</span><strong>${periodMarkup}</strong></div>${serviceType === "MASSAGE" ? "" : `<div><span>방문 시간</span><strong>${request.dailyStart}–${request.dailyEnd}</strong></div><div><span>희망 요일</span><strong>${escapeHtml((request.daysOfWeek || []).join(" · ") || "미지정")}</strong></div>`}${serviceType === "MASSAGE" ? "" : `<div><span>출생/출산(예정)일</span><strong>${formatDate(request.birthOrDueDate)}</strong></div><div><span>추가인원</span><strong>${request.extraHouseholdMembers}명</strong></div>`}${productMarkup}<div class="wide"><span>주소</span><strong>${escapeHtml(request.address)}</strong></div>${serviceType === "MASSAGE" ? "" : `<div class="wide"><span>알러지</span><strong>${escapeHtml(request.allergies)}</strong></div>`}${serviceType === "BABYSITTING" ? `<div class="wide"><span>식사·간식 지침</span><strong>${escapeHtml(request.mealInstructions || "없음")}</strong></div><div class="wide"><span>생활 루틴·인계</span><strong>${escapeHtml([request.routineNotes, request.pickupNotes].filter(Boolean).join(" · ") || "없음")}</strong></div>` : serviceType === "POSTPARTUM" ? `<div class="wide"><span>산모 상태·회복 요청</span><strong>${escapeHtml(request.maternalNotes || "없음")}</strong></div>` : ""}<div class="wide"><span>특이사항·요청</span><strong>${escapeHtml(request.specialNotes || "없음")}</strong></div>${massageSlotReviewMarkup}</div>
      <div class="insured-contract-note"><strong>회사 운영 원칙</strong><span>책임보상보험 · 근로자재해보험 · W-2 정식 직원 운영 원칙이 서비스에 적용됩니다.</span></div>${lifecycleIssue ? `<div class="status-banner warning">${escapeHtml(lifecycleIssue.message)}</div>` : `<div class="privacy-boundary-note"><strong>${approvalNoticeTitle}</strong><span>${approvalNoticeDetail}</span></div>`}
      <div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button" ${lifecycleIssue ? "disabled" : ""}>서비스 신청 승인</button></div>
    </form></section></div>`;
    const requestDeposit = Number(request.depositAmount || (serviceType === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : serviceType === "BABYSITTING" ? BABYSITTING_DEPOSIT : requestServiceTotal(request)));
    const depositPolicyCopy = serviceType === "POSTPARTUM" ? "시작 30일 전까지 취소 시 환불·30일 이내에는 환불 불가" : serviceType === "BABYSITTING" ? "시작 72시간 이전 취소 시 환불·72시간 이내 취소 또는 노쇼 시 환불 불가" : "예약 시작 24시간 이전까지 고객 변경·취소 가능";
    const reviewForm = modalRoot.querySelector("[data-client-request-form]");
    const reviewActions = reviewForm.querySelector(".form-actions");
    reviewActions.classList.add("request-review-actions");
    reviewActions.insertAdjacentHTML("beforebegin", `<div class="field"><label for="request-review-note">검토 메모·반려 사유</label><textarea id="request-review-note" name="reviewNote" placeholder="반려할 때는 고객이 이해할 수 있는 사유를 반드시 입력해 주세요."></textarea></div><fieldset class="deposit-confirmation"><legend>${serviceType === "MASSAGE" ? "마사지 서비스 결제 수납 기록" : "예약금 수납 기록"}</legend><p><strong>$${requestDeposit.toLocaleString("en-US")} 수납 근거를 기록해야 승인할 수 있습니다.</strong><small>${depositPolicyCopy} 정책이 적용됩니다.</small></p><div class="form-grid three"><div class="field"><label for="request-payment-date">실제 수납일</label><input id="request-payment-date" name="paymentDate" type="date" value="${localDateKey(new Date())}" max="${localDateKey(new Date())}" required/><small>뒤늦게 입력해도 실제 받은 날짜로 수입에 반영됩니다.</small></div><div class="field"><label for="request-payment-method">결제 수단</label><select id="request-payment-method" name="paymentMethod" required><option value="">선택해 주세요</option><option value="CARD">카드</option><option value="ACH">ACH 계좌이체</option><option value="CASH">현금</option><option value="CHECK">수표</option><option value="OTHER">기타</option></select></div><div class="field"><label for="request-payment-reference">거래·영수증 번호</label><input id="request-payment-reference" name="paymentReference" minlength="3" maxlength="255" autocomplete="off" placeholder="결제사 거래번호 또는 수기 영수증 번호" required/><small>고유한 번호를 입력해 중복 수납을 방지합니다.</small></div></div></fieldset>`);
    reviewActions.querySelector('button[type="submit"]').insertAdjacentHTML("beforebegin", `<button type="button" class="secondary-button" data-reject-client-request="${request.id}">신청 반려</button>`);
    bindModalFrame();
    reviewForm.addEventListener("submit", (event) => approveClientRequest(event, request.id));
    reviewForm.querySelector("[data-reject-client-request]").addEventListener("click", () => rejectClientRequest(reviewForm, request.id));
  }

  function openApprovedDepositEvidenceModal(requestId) {
    if (!canReviewServiceRequests()) return showToast("예약금 증빙은 소유자 또는 관리자만 보완할 수 있습니다.", "error");
    const request = state.serviceRequests.find((item) => item.id === requestId && item.status === "APPROVED" && item.depositTransaction?.status !== "CAPTURED");
    if (!request) return showToast("이미 증빙이 등록되었거나 보완 대상이 아닌 신청입니다.", "info");
    const client = clientById(request.clientId);
    if (!client) return showToast("신청의 고객 정보를 찾을 수 없습니다.", "error");
    const clientLinkIssue = requestClientLinkIssue(request);
    if (clientLinkIssue) return showToast(`${clientLinkIssue} 회원 관리에서 고객 권한과 고객 프로필 연결을 먼저 복구해 주세요.`, "error");
    const depositAmount = Number(request.depositAmount || (assignmentServiceType(request) === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : assignmentServiceType(request) === "BABYSITTING" ? BABYSITTING_DEPOSIT : requestServiceTotal(request)));
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal" role="dialog" aria-modal="true" aria-labelledby="approved-deposit-title"><header class="modal-header"><div>${serviceBadgeMarkup(request.serviceType)}<p class="eyebrow">DEPOSIT RECEIPT</p><h3 id="approved-deposit-title">예약금 수납 확인·기록</h3><p>${escapeHtml(client.motherName)} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-approved-deposit-form><div class="request-review-grid"><div><span>승인 상태</span><strong>승인 완료</strong></div><div><span>필수 예약금</span><strong>${money(depositAmount)}</strong></div><div class="wide"><span>서비스</span><strong>${serviceMetaFor(request.serviceType).label} · ${formatDate(request.desiredStartDate)} 시작 예정</strong></div></div><div class="status-banner warning"><strong>실제 수납 내역만 기록하세요.</strong><span>이 화면은 결제를 실행하지 않습니다. 누락분은 실제 받은 날짜를 선택하면 해당 월·연도 수입에 소급 반영됩니다.</span></div><div class="form-grid three"><div class="field"><label for="approved-payment-date">실제 수납일</label><input id="approved-payment-date" name="paymentDate" type="date" value="${localDateKey(new Date())}" max="${localDateKey(new Date())}" required/></div><div class="field"><label for="approved-payment-method">결제 수단</label><select id="approved-payment-method" name="paymentMethod" required><option value="">선택해 주세요</option><option value="CARD">카드</option><option value="ACH">ACH 계좌이체</option><option value="CASH">현금</option><option value="CHECK">수표</option><option value="OTHER">기타</option></select></div><div class="field"><label for="approved-payment-reference">거래·영수증 번호</label><input id="approved-payment-reference" name="paymentReference" minlength="3" maxlength="255" autocomplete="off" placeholder="실제 거래번호 또는 수기 영수증 번호" required/></div></div><label class="consent-line"><input type="checkbox" name="evidenceConfirmed" required/><span>실제 예약금 수납 근거와 일치함을 확인합니다.</span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">예약금 수납 저장</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-approved-deposit-form]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const paymentMethod = String(values.paymentMethod || "").trim();
      const paymentReference = String(values.paymentReference || "").trim();
      if (!paymentMethod || paymentReference.length < 3) return showToast("결제 수단과 3자 이상의 실제 거래·영수증 번호를 입력해 주세요.", "error");
      if (!values.paymentDate || values.paymentDate > localDateKey(new Date())) return showToast("실제 수납일은 오늘 또는 지난 날짜로 선택해 주세요.", "error");
      if (values.evidenceConfirmed !== "on") return showToast("실제 수납 근거 확인에 동의해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "저장 중…";
      try {
        await recordApprovedRequestDepositEvidenceCloud({ requestId, paymentMethod, paymentReference, receivedOn: values.paymentDate });
        closeModal();
        await refreshCloudState();
        showToast(`${client.motherName} 고객의 예약금 증빙을 보완했습니다. 이제 일정을 배치할 수 있습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "예약금 증빙을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "예약금 수납 저장";
      }
    });
  }

  function openServiceBalancePaymentModal(requestId) {
    if (!canReviewServiceRequests()) return showToast("잔금 수납 기록은 소유자 또는 관리자만 처리할 수 있습니다.", "error");
    const request = state.serviceRequests.find((item) => item.id === requestId && item.status === "APPROVED");
    if (!request) return showToast("잔금을 기록할 승인 신청을 찾을 수 없습니다.", "error");
    const client = clientById(request.clientId);
    if (!client) return showToast("신청의 고객 정보를 찾을 수 없습니다.", "error");
    const clientLinkIssue = requestClientLinkIssue(request);
    if (clientLinkIssue) return showToast(`${clientLinkIssue} 회원 관리에서 고객 권한과 고객 프로필 연결을 먼저 복구해 주세요.`, "error");
    if (!requestHasCapturedDepositEvidence(request)) return showToast("실제 예약금 수납 증빙을 먼저 등록해 주세요.", "error");
    const outstanding = requestOutstandingBalance(request);
    if (outstanding <= 0) return showToast("이 신청은 미수 잔금이 없습니다.", "info");
    const total = requestServiceTotal(request);
    const alreadyPaid = requestDepositNet(request) + requestBalanceNet(request);
    const existingDiscount = requestOwnerDiscount(request);
    const canApplyOwnerDiscount = !usingCloudData() || hasDatabaseRole("OWNER");
    const ownerDiscountFields = canApplyOwnerDiscount
      ? `<section class="owner-discount-panel"><div class="section-header compact"><div><p class="eyebrow">OWNER DISCOUNT</p><h4>오너 할인 적용</h4><p>실제 현금 수납이 아닌 계약 할인입니다. 할인액만큼 미수금이 줄고 수입에는 포함되지 않습니다.</p></div><span class="status-chip gold">소유자 전용</span></div><div class="form-grid two"><div class="field"><label for="balance-discount-amount">추가 할인액</label><input id="balance-discount-amount" name="discountAmount" type="number" min="0" max="${outstanding.toFixed(2)}" step="0.01" value="0.00"/><small>최대 ${money(outstanding)}</small></div><div class="field"><label for="balance-discount-reason">할인 사유</label><input id="balance-discount-reason" name="discountReason" maxlength="500" autocomplete="off" placeholder="예: 장기 이용 고객 오너 승인 할인"/><small>할인액을 입력하면 3자 이상 사유가 필요합니다.</small></div></div></section>`
      : "";
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal" role="dialog" aria-modal="true" aria-labelledby="balance-payment-title"><header class="modal-header"><div>${serviceBadgeMarkup(request.serviceType)}<p class="eyebrow">BALANCE SETTLEMENT</p><h3 id="balance-payment-title">잔금 수납·할인 정산</h3><p>${escapeHtml(client.motherName)} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-balance-payment-form><div class="request-review-grid"><div><span>총 예정금액</span><strong>${money(total)}</strong></div><div><span>현금 기수납액</span><strong>${money(alreadyPaid)}</strong></div><div><span>기존 오너 할인</span><strong>${money(existingDiscount)}</strong></div><div><span>현재 미수 잔금</span><strong>${money(outstanding)}</strong></div></div><div class="status-banner warning"><strong>실제 수납 내역만 기록하세요.</strong><span>이 화면은 결제를 실행하지 않습니다. 수납액은 해당 수납월의 수입에 반영되고, 오너 할인은 수입이 아닌 정산 조정으로만 기록됩니다.</span></div>${ownerDiscountFields}<div class="settlement-live-summary" data-settlement-summary><span>이번 현금 수납</span><strong>${money(outstanding)}</strong><span>할인 후 남는 미수금</span><strong>${money(0)}</strong></div><div class="form-grid three"><div class="field"><label for="balance-payment-date">실제 수납·할인 적용일</label><input id="balance-payment-date" name="paymentDate" type="date" value="${localDateKey(new Date())}" max="${localDateKey(new Date())}" required/></div><div class="field"><label for="balance-payment-amount">실제 수납액</label><input id="balance-payment-amount" name="amount" type="number" min="0" max="${outstanding.toFixed(2)}" step="0.01" value="${outstanding.toFixed(2)}" required/><small data-balance-payment-limit>최대 ${money(outstanding)}</small></div><div class="field"><label for="balance-payment-method">결제 수단</label><select id="balance-payment-method" name="paymentMethod" required><option value="CARD">카드</option><option value="BANK_TRANSFER">계좌이체</option><option value="CHECK">수표</option><option value="CASH">현금</option><option value="OTHER">기타</option></select></div></div><div class="field"><label for="balance-payment-reference">거래·영수증 번호</label><input id="balance-payment-reference" name="paymentReference" minlength="3" maxlength="255" autocomplete="off" placeholder="결제사·은행의 고유 거래번호" required/><small>중복 사용할 수 없는 실제 외부 거래번호를 입력합니다. 전액 할인이라 현금 수납이 0이면 필요하지 않습니다.</small></div><label class="consent-line"><input type="checkbox" name="paymentConfirmed" required/><span>실제 수납액과 오너 승인 할인 내역이 위 정산 내용과 일치함을 확인합니다.</span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">잔금 정산 저장</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-balance-payment-form]");
    const amountInput = form.querySelector('[name="amount"]');
    const discountInput = form.querySelector('[name="discountAmount"]');
    const discountReasonInput = form.querySelector('[name="discountReason"]');
    const paymentMethodInput = form.querySelector('[name="paymentMethod"]');
    const paymentReferenceInput = form.querySelector('[name="paymentReference"]');
    const settlementSummary = form.querySelector("[data-settlement-summary]");
    const paymentLimit = form.querySelector("[data-balance-payment-limit]");
    let lastAutomaticAmount = outstanding;
    const syncSettlementInputs = () => {
      const discountAmount = Math.min(outstanding, Math.max(0, Number(discountInput?.value || 0)));
      const cashDueAfterDiscount = Math.max(0, outstanding - discountAmount);
      const enteredAmount = Math.max(0, Number(amountInput.value || 0));
      if (Math.abs(enteredAmount - lastAutomaticAmount) < 0.005 || enteredAmount > cashDueAfterDiscount) {
        amountInput.value = cashDueAfterDiscount.toFixed(2);
      }
      lastAutomaticAmount = cashDueAfterDiscount;
      amountInput.max = cashDueAfterDiscount.toFixed(2);
      if (paymentLimit) paymentLimit.textContent = `할인 적용 후 최대 ${money(cashDueAfterDiscount)}`;
      if (discountReasonInput) discountReasonInput.required = discountAmount > 0;
      const cashRequired = cashDueAfterDiscount > 0;
      paymentMethodInput.disabled = !cashRequired;
      paymentMethodInput.required = cashRequired;
      paymentReferenceInput.disabled = !cashRequired;
      paymentReferenceInput.required = cashRequired;
      if (settlementSummary) {
        const currentAmount = Math.max(0, Number(amountInput.value || 0));
        settlementSummary.innerHTML = `<span>이번 현금 수납</span><strong>${money(currentAmount)}</strong><span>할인 후 남는 미수금</span><strong>${money(Math.max(0, cashDueAfterDiscount - currentAmount))}</strong>`;
      }
    };
    discountInput?.addEventListener("input", syncSettlementInputs);
    amountInput.addEventListener("input", syncSettlementInputs);
    syncSettlementInputs();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const amount = Number(values.amount);
      const discountAmount = canApplyOwnerDiscount ? Number(values.discountAmount || 0) : 0;
      if (!Number.isFinite(amount) || amount < 0) return showToast("수납액은 0 이상으로 입력해 주세요.", "error");
      if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > outstanding) return showToast(`할인액은 0 이상 ${money(outstanding)} 이하여야 합니다.`, "error");
      if (amount + discountAmount <= 0 || amount + discountAmount > outstanding) return showToast(`수납액과 할인액의 합계는 0보다 크고 ${money(outstanding)} 이하여야 합니다.`, "error");
      if (discountAmount > 0 && String(values.discountReason || "").trim().length < 3) return showToast("오너 할인 사유를 3자 이상 입력해 주세요.", "error");
      if (amount > outstanding - discountAmount) return showToast("수납액이 할인 적용 후 미수금보다 큽니다.", "error");
      if (!values.paymentDate || values.paymentDate > localDateKey(new Date())) return showToast("실제 수납일은 오늘 또는 지난 날짜로 선택해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "저장 중…";
      try {
        await recordServiceBalancePaymentCloud({ requestId, amount, paymentMethod: values.paymentMethod || "", paymentReference: values.paymentReference || "", receivedOn: values.paymentDate, discountAmount, discountReason: values.discountReason || null });
        closeModal();
        await refreshCloudState();
        const settlementParts = [amount > 0 ? `현금 수납 ${money(amount)}` : "", discountAmount > 0 ? `오너 할인 ${money(discountAmount)}` : ""].filter(Boolean).join(" · ");
        showToast(`${client.motherName} 고객의 잔금 정산을 저장했습니다. ${settlementParts}`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "잔금 수납 기록을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "잔금 정산 저장";
      }
    });
  }

  function openDepositRefundModal(requestId) {
    const request = state.serviceRequests.find((item) => item.id === requestId);
    if (!request) return showToast("환불 대상 서비스를 찾을 수 없습니다.", "error");
    const suggested = Math.min(
      requestRefundableCollectedAmount(request),
      Number(request.depositAmount || request.depositTransaction?.amount || 0),
    );
    openServiceRefundModal(requestId, suggested);
  }

  function openServiceRefundModal(requestId, suggestedAmount = null) {
    if (!canReviewServiceRequests()) return showToast("서비스 환불 기록은 소유자 또는 관리자만 처리할 수 있습니다.", "error");
    const request = state.serviceRequests.find((item) => item.id === requestId);
    if (!request) return showToast("환불 대상 서비스를 찾을 수 없습니다.", "error");
    const client = clientById(request.clientId);
    const refundable = requestRefundableCollectedAmount(request);
    if (refundable <= 0) return showToast("이 서비스에는 추가로 환불할 수 있는 수납액이 없습니다.", "info");
    const defaultAmount = Number(suggestedAmount) > 0 ? Math.min(Number(suggestedAmount), refundable) : refundable;
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal service-refund-modal" role="dialog" aria-modal="true" aria-labelledby="service-refund-title"><header class="modal-header"><div>${serviceBadgeMarkup(request.serviceType)}<p class="eyebrow">SERVICE REFUND RECORD</p><h3 id="service-refund-title">서비스 환불 입력</h3><p>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-service-refund-form><div class="request-review-grid"><div><span>예약금 수납</span><strong>${money(requestDepositNet(request))}</strong></div><div><span>본 금액 수납</span><strong>${money(requestBalanceNet(request))}</strong></div><div><span>기존 누적 환불</span><strong>${money(requestRefundTotal(request))}</strong></div><div><span>추가 환불 가능</span><strong>${money(refundable)}</strong></div></div><div class="status-banner warning"><strong>실제 환불을 실행하는 화면이 아닙니다.</strong><span>결제사·은행에서 환불을 완료한 뒤 기록하세요. 저장한 환불액은 처리일 기준 월별·연도별 실수납 순액에서 자동 차감됩니다.</span></div><div class="form-grid two"><div class="field"><label for="service-refund-date">환불 처리일</label><input id="service-refund-date" name="refundedOn" type="date" value="${localToday}" max="${localToday}" required/></div><div class="field"><label for="service-refund-amount">환불액 (USD)</label><input id="service-refund-amount" name="amount" type="number" min="0.01" max="${refundable.toFixed(2)}" step="0.01" value="${defaultAmount.toFixed(2)}" inputmode="decimal" required/><small>최대 ${money(refundable)}</small></div><div class="field"><label for="service-refund-method">환불 수단</label><select id="service-refund-method" name="paymentMethod" required><option value="CARD">카드</option><option value="BANK_TRANSFER">은행 이체</option><option value="CHECK">수표</option><option value="CASH">현금</option><option value="OTHER">기타</option></select></div><div class="field"><label for="service-refund-reference">환불 참조번호</label><input id="service-refund-reference" name="refundReference" minlength="3" maxlength="255" autocomplete="off" placeholder="결제사·은행의 고유 번호" required/></div></div><div class="field"><label for="service-refund-reason">환불 사유</label><textarea id="service-refund-reason" name="refundReason" minlength="3" maxlength="1000" placeholder="환불 근거와 처리 내용을 기록해 주세요." required></textarea></div><label class="consent-line"><input type="checkbox" name="refundConfirmed" required/><span>위 금액이 실제로 환불되었으며 입력 내용이 정확함을 확인합니다.</span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">환불 기록 저장</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-service-refund-form]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const currentRequest = state.serviceRequests.find((item) => item.id === requestId);
      const currentRefundable = currentRequest ? requestRefundableCollectedAmount(currentRequest) : 0;
      const values = Object.fromEntries(new FormData(form).entries());
      const amount = Number(values.amount);
      const refundReference = String(values.refundReference || "").trim();
      const refundReason = String(values.refundReason || "").trim();
      if (!currentRequest || currentRefundable <= 0) return showToast("환불 가능 상태가 변경되었습니다. 화면을 새로 확인해 주세요.", "info");
      if (!Number.isFinite(amount) || amount <= 0 || amount > currentRefundable) return showToast(`환불액은 $0.01 이상 ${money(currentRefundable)} 이하여야 합니다.`, "error");
      if (refundReference.length < 3 || refundReason.length < 3) return showToast("환불 참조번호와 환불 사유를 입력해 주세요.", "error");
      if (values.refundConfirmed !== "on") return showToast("실제 환불 완료 확인에 동의해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "저장 중…";
      try {
        if (usingCloudData()) {
          const savedRefund = await recordServiceRefundCloud({ requestId, amount, paymentMethod: values.paymentMethod, refundReference, refundReason, refundedOn: values.refundedOn });
          closeModal();
          await refreshCloudState();
          if (!state.refundTransactions.some((item) => item.id === savedRefund.id)) {
            state.refundTransactions = [...state.refundTransactions, savedRefund];
          }
          const refreshedRequest = state.serviceRequests.find((item) => item.id === requestId);
          if (refreshedRequest && !refreshedRequest.refundTransactions.some((item) => item.id === savedRefund.id)) {
            refreshedRequest.refundTransactions = [...refreshedRequest.refundTransactions, savedRefund];
          }
          render();
        } else {
          const transaction = { id: `refund-${Date.now()}`, requestId, clientId: currentRequest.clientId, amount, status: "COMPLETED", paymentMethod: values.paymentMethod, refundReference, refundReason, refundedAt: `${values.refundedOn}T12:00:00`, recordedBy: authUser()?.id };
          currentRequest.refundTransactions = [...(currentRequest.refundTransactions || []), transaction];
          state.refundTransactions = [...(state.refundTransactions || []), transaction];
          if (currentRequest.depositStatus === "REFUND_DUE" && requestServiceRefundTotal(currentRequest) >= Number(currentRequest.depositAmount || 0)) currentRequest.depositStatus = "REFUNDED";
          saveState();
          closeModal();
          render();
        }
        showToast(`${client?.motherName || "고객"} 서비스 환불 ${money(amount)} 기록을 저장했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "서비스 환불 기록을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "환불 기록 저장";
      }
    });
  }

  function openServiceHistoryDetailModal(requestId) {
    const request = state.serviceRequests.find((item) => item.id === requestId);
    if (!request) return showToast("서비스 히스토리를 찾을 수 없습니다.", "error");
    const client = clientById(request.clientId);
    const requester = state.users.find((user) => user.id === request.userId);
    const assignment = serviceHistoryAssignment(request);
    const caregiver = state.users.find((user) => user.id === assignment?.caregiverUserId);
    const lifecycle = serviceHistoryLifecycle(request);
    const refunds = [...(request.refundTransactions || [])].sort((first, second) => new Date(second.refundedAt || 0) - new Date(first.refundedAt || 0));
    const refundable = requestRefundableCollectedAmount(request);
    const removedBy = state.users.find((user) => user.id === request.administrativelyRemovedBy);
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal service-history-detail-modal" role="dialog" aria-modal="true" aria-labelledby="service-history-detail-title"><header class="modal-header"><div>${serviceBadgeMarkup(request.serviceType)}<p class="eyebrow">SERVICE HISTORY DETAIL</p><h3 id="service-history-detail-title">${escapeHtml(client?.motherName || requester?.fullName || "고객 연결 확인 필요")} 서비스 기록</h3><p>${escapeHtml(babyNameFor(request, client) || "아이 정보 미등록")} · 신청 ${request.createdAt ? formatDate(request.createdAt) : "일자 미등록"}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><div class="modal-form"><div class="request-review-grid"><div><span>현재 상태</span><strong class="status-chip ${lifecycle.tone}">${lifecycle.label}</strong></div><div><span>담당 관리사</span><strong>${escapeHtml(caregiver?.fullName || (assignment ? "관리사 연결 확인" : "미배정"))}</strong></div><div><span>서비스 기간</span><strong>${serviceHistoryPeriod(request, assignment)}</strong></div><div><span>서비스 시간</span><strong>${escapeHtml(assignment ? `${assignment.dailyStart}–${assignment.dailyEnd}` : `${request.dailyStart || "--:--"}–${request.dailyEnd || "--:--"}`)}</strong></div><div><span>총 예정금액</span><strong>${money(requestServiceTotal(request))}</strong></div><div><span>예약금 수납</span><strong>${money(requestDepositNet(request))}</strong></div><div><span>본 금액 수납</span><strong>${money(requestBalanceNet(request))}</strong></div><div><span>누적 환불</span><strong>${money(requestRefundTotal(request))}</strong></div><div class="wide"><span>주소</span><strong>${escapeHtml(request.address || client?.address || "미등록")}</strong></div><div class="wide"><span>당시 요청사항</span><strong>${escapeHtml(request.requestNote || request.specialNotes || request.maternalNotes || request.routineNotes || "별도 요청사항 없음")}</strong></div></div>${request.administrativelyRemovedAt ? `<div class="status-banner warning"><strong>관리자 안전 삭제됨</strong><span>${formatDateTime(request.administrativelyRemovedAt)} · ${escapeHtml(removedBy?.fullName || "관리자")} · ${escapeHtml(request.administrativeRemovalReason || "사유 미등록")}</span></div>` : ""}<section class="history-refund-log"><div class="section-header"><div><h4>환불 기록</h4><p>환불은 취소·삭제와 별개의 실제 자금 이동 기록입니다.</p></div><span class="status-chip">${refunds.length}건</span></div>${refunds.length ? refunds.map((refund) => `<div class="history-refund-row"><div><strong>${money(refund.amount)}</strong><span>${formatDate(refund.refundedAt)} · ${escapeHtml(refund.paymentMethod || "수단 미등록")}</span></div><div><strong>${escapeHtml(refund.refundReference || "참조 미등록")}</strong><span>${escapeHtml(refund.refundReason || "사유 미등록")}</span></div></div>`).join("") : `<div class="empty-state compact"><strong>기록된 환불이 없습니다.</strong></div>`}</section><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button>${refundable > 0 ? `<button type="button" class="secondary-button" data-detail-refund>환불 입력</button>` : ""}${!request.administrativelyRemovedAt ? `<button type="button" class="danger-button" data-detail-archive>서비스 삭제</button>` : ""}</div></div></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-detail-refund]")?.addEventListener("click", () => {
      closeModal();
      openServiceRefundModal(requestId);
    });
    modalRoot.querySelector("[data-detail-archive]")?.addEventListener("click", () => {
      closeModal();
      openArchiveServiceRequestModal(requestId);
    });
  }

  function openArchiveServiceRequestModal(requestId) {
    if (!canReviewServiceRequests()) return showToast("서비스 삭제는 소유자 또는 관리자만 처리할 수 있습니다.", "error");
    const request = state.serviceRequests.find((item) => item.id === requestId);
    if (!request || request.administrativelyRemovedAt) return showToast("이미 삭제되었거나 존재하지 않는 서비스입니다.", "info");
    const client = clientById(request.clientId);
    const lifecycle = serviceHistoryLifecycle(request);
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal destructive-modal" role="dialog" aria-modal="true" aria-labelledby="archive-service-title"><header class="modal-header"><div>${serviceBadgeMarkup(request.serviceType)}<p class="eyebrow">ADMINISTRATIVE SERVICE REMOVAL</p><h3 id="archive-service-title">서비스 안전 삭제</h3><p>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-archive-service-form><div class="status-banner warning"><strong>운영 목록에서 서비스를 종료·숨깁니다.</strong><span>신청 상태는 취소로 바뀌고 예정 일정은 종료됩니다. 수납·환불·케어·감사 기록은 법적·회계 추적을 위해 삭제하지 않습니다. 진행 중인 케어가 있다면 먼저 종료해야 합니다.</span></div><div class="request-review-grid"><div><span>현재 상태</span><strong>${lifecycle.label}</strong></div><div><span>서비스 기간</span><strong>${serviceHistoryPeriod(request)}</strong></div><div><span>실수납</span><strong>${money(requestNetCollectedAmount(request))}</strong></div><div><span>추가 환불 가능</span><strong>${money(requestRefundableCollectedAmount(request))}</strong></div></div><div class="field"><label for="archive-service-reason">삭제 사유</label><textarea id="archive-service-reason" name="reason" minlength="5" maxlength="1000" placeholder="운영 원장에서 삭제해야 하는 구체적인 사유를 입력해 주세요." required></textarea><small>관리자와 처리 시각이 감사 로그에 함께 보존됩니다.</small></div><label class="consent-line"><input type="checkbox" name="confirmed" required/><span>수납·케어 기록은 보존되며 서비스 운영 상태만 종료된다는 점을 확인합니다.</span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="danger-button">서비스 삭제</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-archive-service-form]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const reason = String(values.reason || "").trim();
      if (reason.length < 5) return showToast("서비스 삭제 사유를 5자 이상 입력해 주세요.", "error");
      if (values.confirmed !== "on") return showToast("안전 삭제 처리 내용을 확인해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "처리 중…";
      try {
        if (usingCloudData()) {
          await archiveServiceRequestCloud(requestId, reason);
          closeModal();
          await refreshCloudState();
        } else {
          request.status = "CANCELLED";
          request.administrativelyRemovedAt = new Date().toISOString();
          request.administrativelyRemovedBy = authUser()?.id;
          request.administrativeRemovalReason = reason;
          const assignment = serviceHistoryAssignment(request);
          if (assignment && assignment.databaseStatus !== "COMPLETED") {
            assignment.status = "CANCELLED";
            assignment.databaseStatus = "CANCELLED";
          }
          saveState();
          closeModal();
          render();
        }
        showToast(`${client?.motherName || "고객"} 서비스가 운영 목록에서 안전 삭제되었습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "서비스를 삭제하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "서비스 삭제";
      }
    });
  }

  async function rejectClientRequest(form, requestId) {
    const request = state.serviceRequests.find((item) => item.id === requestId && item.status === "PENDING");
    const note = String(new FormData(form).get("reviewNote") || "").trim();
    if (!request) return showToast("이미 처리되었거나 존재하지 않는 신청입니다.", "info");
    if (!note) return showToast("고객이 확인할 수 있도록 반려 사유를 입력해 주세요.", "error");
    const buttons = form.querySelectorAll("button");
    buttons.forEach((button) => { button.disabled = true; });
    try {
      if (usingCloudData()) {
        await reviewServiceRequestCloud(request.id, false, note);
        closeModal();
        await refreshCloudState();
      } else {
        Object.assign(request, { status: "REJECTED", reviewedAt: new Date().toISOString(), reviewedBy: authUser().id, reviewNote: note });
        saveState();
        closeModal();
        render();
      }
      showToast("서비스 신청을 반려하고 사유를 저장했습니다.", "info");
    } catch (error) {
      showToast(friendlyErrorMessage(error, "서비스 신청을 반려하지 못했습니다."), "error");
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function reviewServiceAdjustment(adjustmentId, decision) {
    const adjustment = state.serviceAdjustments.find((item) => item.id === adjustmentId && item.status === "PENDING");
    if (!adjustment) return showToast("이미 처리되었거나 존재하지 않는 요청입니다.");
    const target = adjustmentTarget(adjustment.targetType, adjustment.targetId);
    if (!target) return showToast("연결된 서비스 정보를 찾을 수 없습니다.");
    if (usingCloudData()) {
      const actionButtons = document.querySelectorAll(`[data-approve-adjustment="${adjustmentId}"], [data-reject-adjustment="${adjustmentId}"]`);
      actionButtons.forEach((button) => { button.disabled = true; });
      try {
        const reviewAdjustment = assignmentServiceType(target) === "MASSAGE" ? reviewMassageAdjustmentCloud : reviewServiceAdjustmentCloud;
        await reviewAdjustment(adjustmentId, decision === "APPROVE");
        await refreshCloudState();
        showToast(decision === "APPROVE" ? `${serviceMetaFor(adjustment.serviceType).label} 요청을 승인하고 운영 일정에 반영했습니다.` : "변경·취소 요청을 반려했습니다. 기존 일정은 유지됩니다.");
      } catch (error) {
        showToast(friendlyErrorMessage(error, "변경·취소 요청을 처리하지 못했습니다."), "error");
        actionButtons.forEach((button) => { button.disabled = false; });
      }
      return;
    }
    if (decision === "REJECT") {
      Object.assign(adjustment, { status: "REJECTED", reviewedAt: new Date().toISOString(), reviewedBy: authUser().id });
      saveState(); render(); showToast("변경·취소 요청을 반려했습니다. 기존 일정은 그대로 유지됩니다.");
      return;
    }
    if (adjustment.action === "CANCEL") {
      target.status = "CANCELLED";
      target.cancelledAt = new Date().toISOString();
      target.cancellationReason = adjustment.reason;
      target.depositAmount = target.depositAmount || (adjustment.serviceType === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : adjustment.serviceType === "BABYSITTING" ? BABYSITTING_DEPOSIT : requestServiceTotal(target));
      target.depositStatus = ["DEPOSIT_REFUNDABLE", "BABYSITTING_DEPOSIT_REFUNDABLE", "MASSAGE_STANDARD_24H"].includes(adjustment.policyCode) ? "REFUND_DUE" : "NON_REFUNDABLE";
      if (adjustment.policyCode === "POSTPARTUM_ACTIVE_PRORATED") Object.assign(target, { cancellationSettlementAmount: adjustment.cancellationSettlementAmount, remainingCareDaysAtCancellation: adjustment.remainingCareDays, originalContractValueAtCancellation: adjustment.originalContractValue, cancellationFormula: "(original_total - deposit) / remaining_care_days" });
      if (adjustment.targetType === "ASSIGNMENT") {
        const linkedRequest = state.serviceRequests.find((item) => item.id === target.serviceRequestId);
        if (linkedRequest) Object.assign(linkedRequest, { status: "CANCELLED", cancelledAt: target.cancelledAt, depositStatus: target.depositStatus || linkedRequest.depositStatus, cancellationSettlementAmount: target.cancellationSettlementAmount || null, remainingCareDaysAtCancellation: target.remainingCareDaysAtCancellation || null });
        if (state.session.assignmentId === target.id) Object.assign(state.session, { active: false, endedAt: new Date().toISOString() });
      }
    } else {
      const window = serviceWindow(target, adjustment.proposedStartDate, adjustment.proposedDailyStart, adjustment.proposedDailyEnd, adjustment.proposedWeeks);
      const excludedAssignmentId = adjustment.targetType === "ASSIGNMENT" ? target.id : null;
      const excludedRequestId = adjustment.targetType === "REQUEST" ? target.id : null;
      const issue = adjustment.serviceType === "MASSAGE" ? null : serviceLifecycleIssue(target.clientId, adjustment.serviceType, window.startAt, window.endAt, excludedAssignmentId, excludedRequestId, target.babyId, target.babyName);
      if (issue) return showToast(`승인할 수 없습니다: ${issue.message}`);
      const currentCaregiver = state.users.find((user) => user.id === target.caregiverUserId);
      const caregiverAvailable = adjustment.serviceType === "MASSAGE"
        ? massageTherapistIsAvailable(currentCaregiver, target.clientId, window.startAt, window.endAt, target.id, target.daysOfWeek || [], adjustment.proposedDailyStart, adjustment.proposedDailyEnd)
        : caregiverIsAvailable(target.caregiverUserId, window.startAt, window.endAt, target.id, target.daysOfWeek || [], adjustment.proposedDailyStart, adjustment.proposedDailyEnd);
      if (adjustment.targetType === "ASSIGNMENT" && target.caregiverUserId && !caregiverAvailable) return showToast("현재 담당자의 변경 일정과 겹치는 배정이 있습니다. 일정·배정에서 담당자를 먼저 조정해 주세요.");
      const scheduleChanges = { weeks: adjustment.proposedWeeks, dailyStart: adjustment.proposedDailyStart, dailyEnd: adjustment.proposedDailyEnd };
      if (adjustment.targetType === "ASSIGNMENT") {
        Object.assign(target, scheduleChanges, { startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString(), status: window.startAt > new Date() ? "SCHEDULED" : "ACTIVE", scheduleChangedAt: new Date().toISOString() });
        if (adjustment.serviceType === "POSTPARTUM") Object.assign(target, { contractValue: postpartumEstimate(adjustment.proposedWeeks, postpartumModeFor(target)), weeklyRate: postpartumWeeklyRate(target) });
        const linkedRequest = state.serviceRequests.find((item) => item.id === target.serviceRequestId);
        if (linkedRequest) Object.assign(linkedRequest, scheduleChanges, { desiredStartDate: window.startAt.toISOString() });
      } else {
        Object.assign(target, scheduleChanges, { desiredStartDate: window.startAt.toISOString(), scheduleChangedAt: new Date().toISOString() });
        if (adjustment.serviceType === "POSTPARTUM") Object.assign(target, { estimatedTotal: postpartumEstimate(adjustment.proposedWeeks, postpartumModeFor(target)), weeklyRate: postpartumWeeklyRate(target) });
      }
    }
    Object.assign(adjustment, { status: "APPROVED", reviewedAt: new Date().toISOString(), reviewedBy: authUser().id });
    saveState(); render();
    showToast(`${serviceMetaFor(adjustment.serviceType).label} ${adjustment.action === "CANCEL" ? "취소와 비용 처리 상태" : "변경 일정"}를 반영했습니다.`);
  }

  async function approveClientRequest(event, requestId) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const paymentMethod = String(formData.get("paymentMethod") || "").trim();
    const paymentReference = String(formData.get("paymentReference") || "").trim();
    const paymentDate = String(formData.get("paymentDate") || "").trim();
    if (!paymentMethod || paymentReference.length < 3) return showToast("결제 수단과 3자 이상의 거래·영수증 번호를 입력해 주세요.", "error");
    if (!paymentDate || paymentDate > localDateKey(new Date())) return showToast("실제 수납일은 오늘 또는 지난 날짜로 선택해 주세요.", "error");
    const request = state.serviceRequests.find((item) => item.id === requestId && item.status === "PENDING");
    if (!request) return showToast("이미 처리되었거나 존재하지 않는 신청입니다.");
    const serviceType = assignmentServiceType(request);
    const startDate = dateInputValue(request.desiredStartDate);
    const { startAt, endAt } = serviceWindow(request, startDate, request.dailyStart, request.dailyEnd, request.weeks);
    const lifecycleIssue = serviceType === "MASSAGE" ? null : serviceLifecycleIssue(request.clientId, serviceType, startAt, endAt, null, request.id, request.babyId, request.babyName);
    if (lifecycleIssue) return showToast(lifecycleIssue.message);
    const client = clientById(request.clientId);
    if (!client) return showToast("연결된 고객 정보를 찾을 수 없어 신청을 승인하지 않았습니다.", "error");
    if (usingCloudData()) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "승인 저장 중…";
      try {
        await reviewServiceRequestCloud(request.id, true, String(formData.get("reviewNote") || "").trim() || null, { method: paymentMethod, reference: paymentReference, receivedOn: paymentDate });
        closeModal();
        await refreshCloudState();
        showToast(`${client.motherName} 고객의 ${serviceMetaFor(request.serviceType).label} 신청을 승인했습니다. 일정·배정 메뉴에서 관리사를 배치해 주세요.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "신청 승인을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "서비스 신청 승인";
      }
      return;
    }
    const depositPaidAt = new Date(`${paymentDate}T12:00:00`).toISOString();
    const depositAmount = Number(request.depositAmount || (serviceType === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : serviceType === "BABYSITTING" ? BABYSITTING_DEPOSIT : requestServiceTotal(request)));
    Object.assign(request, { status: "APPROVED", approvedAssignmentId: null, approvedAt: new Date().toISOString(), approvedBy: authUser().id, depositAmount, depositStatus: "PAID", depositPaidAt, depositTransaction: { amount: depositAmount, paymentMethod, externalReference: paymentReference, capturedAt: depositPaidAt, status: "CAPTURED" } });
    Object.assign(client, { approvalStatus: "APPROVED_AWAITING_SCHEDULE", clientStatus: "LEAD", address: request.address, allergies: request.allergies, extraHouseholdMembers: request.extraHouseholdMembers, requestNote: request.specialNotes });
    saveState();
    closeModal();
    render();
    showToast(`${client.motherName} 고객의 ${serviceMetaFor(request.serviceType).label} 신청을 승인했습니다. 일정·배정 메뉴에서 관리사를 배치해 주세요.`);
  }

  function fieldsForType(type, preset = null) {
    switch (type) {
      case "feeding": {
        const method = ["breast", "pumped", "formula"].includes(preset) ? preset : "breast";
        return `
          <div class="feeding-entry" data-feeding-entry>
            <div class="field"><span class="field-label">수유 방법</span><div class="option-grid feeding-method-grid">${radioOptions("method", [["breast", "직접 모유수유"], ["pumped", "유축 모유"], ["formula", "분유"]], method)}</div></div>
            <div class="feeding-measure-panel" data-feeding-panel="breast" ${method === "breast" ? "" : "hidden"}>
              <div class="field"><label for="feeding-duration">모유수유한 시간 (분)</label><input id="feeding-duration" name="duration" type="number" min="1" max="180" step="1" value="15" inputmode="numeric" ${method === "breast" ? "required" : "disabled"}/><small>직접 모유수유는 양(ml) 대신 실제 수유한 시간을 입력합니다.</small></div>
              <div class="field"><span class="field-label">수유한 쪽</span><div class="option-grid">${radioOptions("side", [["left", "왼쪽"], ["right", "오른쪽"], ["both", "양쪽"]], "both")}</div></div>
            </div>
            <div class="feeding-measure-panel" data-feeding-panel="volume" ${method === "breast" ? "hidden" : ""}>
              <div class="field unit-measurement-field" data-unit-measurement="volume"><label for="feeding-amount">수유량</label><div class="unit-measurement-control"><input id="feeding-amount" name="inputValue" data-unit-value type="number" min="5" max="500" step="1" value="80" inputmode="decimal" ${method === "breast" ? "disabled" : "required"}/><select name="inputUnit" data-unit-select aria-label="수유량 단위" ${method === "breast" ? "disabled" : ""}><option value="ml" selected>ml</option><option value="oz">oz</option></select></div><output class="unit-conversion-preview" data-unit-conversion aria-live="polite">자동 변환: 2.71 oz</output><small>ml 또는 oz로 입력하면 다른 단위를 자동으로 계산해 함께 저장합니다.</small></div>
            </div>
            <div class="field"><label for="feeding-note">수유 메모 (선택)</label><textarea id="feeding-note" name="note" placeholder="수유 중 관찰한 사실이나 보호자에게 전달할 내용을 적어주세요."></textarea></div>
          </div>`;
      }
      case "diaper":
        return `
          <div class="field"><span class="field-label">소변 양</span><div class="option-grid">${radioOptions("urine", [["small", "소량"], ["medium", "보통"], ["large", "많음"]], "medium")}</div></div>
          <div class="field"><span class="field-label">대변 상태</span><div class="option-grid two">${radioOptions("stool", [["none", "없음"], ["normal", "정상"], ["loose", "묽음"], ["hard", "단단함"]], "normal")}</div></div>
          <div class="field"><span class="field-label">색상</span><div class="option-grid">${radioOptions("color", [["yellow", "노란색"], ["green", "초록색"], ["brown", "갈색"]], "yellow")}</div></div>`;
      case "sleep":
        return `<div class="field"><label for="duration">수면 시간 (분)</label><input id="duration" name="duration" type="number" min="1" max="720" value="45" inputmode="numeric" required /><small>종료 시점에 총 수면 시간을 입력합니다.</small></div>`;
      case "temperature":
        return `<div class="field unit-measurement-field" data-unit-measurement="temperature"><label for="temperature">체온</label><div class="unit-measurement-control"><input id="temperature" name="inputValue" data-unit-value type="number" min="34" max="43" step="0.1" value="36.8" inputmode="decimal" required/><select name="inputUnit" data-unit-select aria-label="체온 단위"><option value="c" selected>℃</option><option value="f">℉</option></select></div><output class="unit-conversion-preview" data-unit-conversion aria-live="polite">자동 변환: 98.2℉</output><small>섭씨 또는 화씨로 입력하면 다른 단위를 자동으로 계산해 함께 저장합니다. 앱은 의료적 판단을 대신하지 않습니다.</small></div>`;
      case "bath":
        return `<div class="field"><label for="bath-type">목욕 구분</label><select id="bath-type" name="bathType"><option>전신 목욕</option><option>부분 세정</option><option>배꼽 관리</option></select></div><div class="field unit-measurement-field" data-unit-measurement="water-temperature"><label for="bath-water-temperature">물 온도</label><div class="unit-measurement-control"><input id="bath-water-temperature" name="inputValue" data-unit-value type="number" min="30" max="45" step="0.1" value="38.0" inputmode="decimal"/><select name="inputUnit" data-unit-select aria-label="물 온도 단위"><option value="c" selected>℃</option><option value="f">℉</option></select></div><output class="unit-conversion-preview" data-unit-conversion aria-live="polite">자동 변환: 100.4℉</output><small>섭씨 또는 화씨로 입력하면 다른 단위를 자동으로 계산해 함께 저장합니다.</small></div><div class="field"><label for="bath-note">피부·배꼽 관찰 메모</label><textarea id="bath-note" name="note" placeholder="발진, 건조함, 배꼽 주변 등 관찰한 사실을 기록하세요."></textarea></div>`;
      case "weight":
        return `<div class="field unit-measurement-field" data-unit-measurement="weight"><label for="baby-weight">아기 체중</label><div class="unit-measurement-control"><input id="baby-weight" name="inputValue" data-unit-value type="number" min="1" max="20" step="0.01" value="3.80" inputmode="decimal" required/><select name="inputUnit" data-unit-select aria-label="체중 단위"><option value="kg" selected>kg</option><option value="lb">lb</option></select></div><output class="unit-conversion-preview" data-unit-conversion aria-live="polite">자동 변환: 8.38 lb</output><small>kg 또는 lb로 입력하면 다른 단위를 자동으로 계산해 함께 저장합니다. 동일한 저울과 비슷한 조건에서 측정해 주세요.</small></div>`;
      case "mother":
        return `
          <div class="field"><label for="care">케어 항목</label><select id="care" name="care"><option>Light stretching</option><option>Breast care</option><option>Meal support</option><option>Rest support</option><option>Other</option></select></div>
          <div class="field"><label for="mother-note">간단한 메모</label><textarea id="mother-note" name="note" placeholder="산모의 상태와 제공한 케어를 간단히 기록하세요."></textarea></div>`;
      case "meal":
        return `<input type="hidden" name="mealType" value="식사"/><div class="field"><label for="meal-appetite">섭취 정도</label><select id="meal-appetite" name="appetite"><option>잘 먹음</option><option>보통</option><option>조금 먹음</option><option>거부함</option></select></div><div class="field"><label for="meal-menu">메뉴·양</label><input id="meal-menu" name="menu" placeholder="예: 닭고기 야채죽 1그릇" required /></div><div class="field"><label for="meal-note">식사 메모 (선택)</label><textarea id="meal-note" name="note" placeholder="알러지 확인, 반응, 보호자에게 전달할 내용이 있을 때만 적어주세요."></textarea></div>`;
      case "sitter_note": {
        const selectedCategory = ["놀이", "산책", "낮잠", "배변", "등원·하원", "안전 확인", "기타"].includes(preset) ? preset : "놀이";
        return `<div class="field"><label for="sitter-category">이벤트 구분</label><select id="sitter-category" name="category">${["놀이", "산책", "낮잠", "배변", "등원·하원", "안전 확인", "기타"].map((category) => `<option ${category === selectedCategory ? "selected" : ""}>${category}</option>`).join("")}</select></div><div class="field"><label for="sitter-note-text">활동·특이 이벤트 메모 (선택)</label><textarea id="sitter-note-text" name="text" placeholder="필요한 경우에만 아이의 반응이나 보호자 인계사항을 사실 중심으로 기록하세요."></textarea><small>메모를 입력하지 않아도 선택한 이벤트 구분만으로 저장할 수 있습니다.</small></div>`;
      }
      case "note":
      default:
        return `<div class="field"><label for="note-text">케어 메모 (선택)</label><textarea id="note-text" name="text" placeholder="특이사항이나 보호자에게 공유할 내용이 있을 때만 기록하세요."></textarea><small>메모 없이도 기록 시각과 항목을 저장할 수 있습니다.</small></div>`;
    }
  }

  function bindFeedingEntryForm(form) {
    const entry = form?.querySelector("[data-feeding-entry]");
    if (!entry) return;
    const updateMeasurementFields = () => {
      const method = form.elements.method?.value || "breast";
      const directPanel = entry.querySelector('[data-feeding-panel="breast"]');
      const volumePanel = entry.querySelector('[data-feeding-panel="volume"]');
      const durationInput = form.elements.duration;
      const amountInput = form.elements.inputValue;
      const amountUnit = form.elements.inputUnit;
      const sideInputs = [...form.querySelectorAll('input[name="side"]')];
      const direct = method === "breast";
      directPanel.hidden = !direct;
      volumePanel.hidden = direct;
      if (durationInput) {
        durationInput.disabled = !direct;
        durationInput.required = direct;
      }
      if (amountInput) {
        amountInput.disabled = direct;
        amountInput.required = !direct;
      }
      if (amountUnit) amountUnit.disabled = direct;
      sideInputs.forEach((input) => { input.disabled = !direct; });
    };
    form.querySelectorAll('input[name="method"]').forEach((input) => input.addEventListener("change", updateMeasurementFields));
    updateMeasurementFields();
  }

  function baseMeasurementValue(kind, value, unit) {
    if (kind === "volume") return volumeToMl(value, unit);
    if (kind === "temperature" || kind === "water-temperature") return celsiusFrom(value, unit);
    if (kind === "weight") return kilogramsFrom(value, unit);
    return null;
  }

  function displayMeasurementValue(kind, baseValue, unit) {
    if (!Number.isFinite(baseValue)) return null;
    if (kind === "volume") return unit === "oz" ? ouncesFromMl(baseValue) : baseValue;
    if (kind === "temperature" || kind === "water-temperature") return unit === "f" ? fahrenheitFromCelsius(baseValue) : baseValue;
    if (kind === "weight") return unit === "lb" ? poundsFromKilograms(baseValue) : baseValue;
    return null;
  }

  function measurementInputSettings(kind, unit) {
    if (kind === "volume") return unit === "oz"
      ? { min: 0.17, max: 16.91, step: 0.01, digits: 2 }
      : { min: 5, max: 500, step: 0.1, digits: 1 };
    if (kind === "water-temperature") return unit === "f"
      ? { min: 86, max: 113, step: 0.1, digits: 1 }
      : { min: 30, max: 45, step: 0.1, digits: 1 };
    if (kind === "temperature") return unit === "f"
      ? { min: 93.2, max: 109.4, step: 0.1, digits: 1 }
      : { min: 34, max: 43, step: 0.1, digits: 1 };
    return unit === "lb"
      ? { min: 2.2, max: 44.09, step: 0.01, digits: 2 }
      : { min: 1, max: 20, step: 0.01, digits: 2 };
  }

  function dualMeasurementLabel(kind, baseValue, preferredUnit) {
    if (kind === "volume") return formatDualVolume(baseValue, preferredUnit);
    if (kind === "temperature" || kind === "water-temperature") return formatDualTemperature(baseValue, preferredUnit);
    return formatDualWeight(baseValue, preferredUnit);
  }

  function bindUnitConversionFields(form) {
    form?.querySelectorAll("[data-unit-measurement]").forEach((field) => {
      const kind = field.dataset.unitMeasurement;
      const input = field.querySelector("[data-unit-value]");
      const select = field.querySelector("[data-unit-select]");
      const output = field.querySelector("[data-unit-conversion]");
      if (!input || !select || !output) return;
      const configure = () => {
        const settings = measurementInputSettings(kind, select.value);
        input.min = String(settings.min);
        input.max = String(settings.max);
        input.step = String(settings.step);
      };
      const refresh = () => {
        const baseValue = baseMeasurementValue(kind, input.value, select.value);
        if (baseValue === null) {
          output.textContent = "값을 입력하면 다른 단위를 자동 계산합니다.";
          return;
        }
        const label = dualMeasurementLabel(kind, baseValue, select.value);
        const alternate = /\((.+)\)$/.exec(label)?.[1] || label;
        output.textContent = `자동 변환: ${alternate}`;
      };
      select.dataset.previousUnit = select.value;
      select.addEventListener("change", () => {
        const previousUnit = select.dataset.previousUnit || select.value;
        const baseValue = baseMeasurementValue(kind, input.value, previousUnit);
        configure();
        if (baseValue !== null) {
          const settings = measurementInputSettings(kind, select.value);
          const converted = displayMeasurementValue(kind, baseValue, select.value);
          input.value = Number(converted).toFixed(settings.digits);
        }
        select.dataset.previousUnit = select.value;
        refresh();
      });
      input.addEventListener("input", refresh);
      configure();
      refresh();
    });
  }

  function populateCareEventForm(form, values = {}) {
    Object.entries(values).forEach(([name, value]) => {
      if (name === "mealType" || value === null || value === undefined) return;
      const controls = [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
      if (!controls.length) return;
      if (controls[0].type === "radio") {
        controls.forEach((control) => { control.checked = control.value === String(value); });
        return;
      }
      if (controls[0].type === "checkbox") {
        controls[0].checked = Boolean(value);
        return;
      }
      controls[0].value = String(value);
    });
    const type = form?.dataset.logFormType;
    const input = form?.elements.inputValue;
    const unit = form?.elements.inputUnit;
    if (!input || !unit || Number.isFinite(Number(values.inputValue))) return;
    if (type === "feeding" && Number.isFinite(Number(values.amount))) input.value = String(displayMeasurementValue("volume", Number(values.amount), unit.value));
    if (type === "temperature" && Number.isFinite(Number(values.value))) input.value = String(displayMeasurementValue("temperature", Number(values.value), unit.value));
    if (type === "bath" && Number.isFinite(Number(values.waterTemperature))) input.value = String(displayMeasurementValue("water-temperature", Number(values.waterTemperature), unit.value));
    if (type === "weight" && Number.isFinite(Number(values.value))) input.value = String(displayMeasurementValue("weight", Number(values.value), unit.value));
  }

  function careEventLocalTime(event) {
    const stored = String(event?.data?.recordedLocalTime || "");
    if (/^\d{2}:\d{2}$/.test(stored)) return stored;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: objectiveEventTimeZone(event),
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(event?.at));
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${values.hour || "00"}:${values.minute || "00"}`;
  }

  function setCareRecordTimeToNow(input, serviceDate, showDateError = true) {
    if (!input) return false;
    const now = new Date();
    if (localDateKey(now) !== serviceDate) {
      if (showDateError) showToast("이 기록의 근무일과 오늘 날짜가 달라 현재 시각을 적용할 수 없습니다.", "error");
      return false;
    }
    const value = localDateTimeInputValue(now);
    input.max = value;
    input.value = value;
    return true;
  }

  function openRetrospectiveCareReportModal(initialAssignmentId = null) {
    const user = authUser();
    const assignments = retrospectiveAssignmentsFor(user?.id);
    if (!assignments.length) return showToast("소급 기록을 입력할 수 있는 본인 배정이 없습니다.", "info");
    const initialAssignment = assignments.find((item) => item.id === initialAssignmentId) || assignments[0];
    const today = localDateKey(new Date());
    const optionMarkup = assignments.map((assignment) => {
      const client = clientById(assignment.clientId);
      return `<option value="${assignment.id}" ${assignment.id === initialAssignment.id ? "selected" : ""}>${escapeHtml(serviceMetaFor(assignment.serviceType).label)} · ${escapeHtml(client?.motherName || "고객")} / ${escapeHtml(babyNameFor(assignment, client) || "아이")} · ${formatDate(assignment.startAt)}–${formatDate(assignment.endAt)}</option>`;
    }).join("");
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal retrospective-report-modal" role="dialog" aria-modal="true" aria-labelledby="retrospective-report-title"><header class="modal-header"><div><p class="eyebrow">RETROSPECTIVE CARE RECORD</p><h3 id="retrospective-report-title">지난 근무 리포트 보완</h3><p>실제로 제공한 서비스만 해당 근무일 기준으로 입력해 주세요.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-retrospective-report-form><div class="field"><label for="retrospective-assignment">서비스 배정</label><select id="retrospective-assignment" name="assignmentId" required>${optionMarkup}</select></div><div class="form-grid three"><div class="field"><label for="retrospective-date">실제 서비스 날짜</label><input id="retrospective-date" name="serviceDate" type="date" max="${today}" required/></div><div class="field"><label for="retrospective-start">실제 시작시간</label><input id="retrospective-start" name="startedTime" type="time" required/></div><div class="field"><label for="retrospective-end">실제 종료시간</label><input id="retrospective-end" name="endedTime" type="time" required/></div></div><div class="field"><label for="retrospective-summary">근무 리포트·보완 내용</label><textarea id="retrospective-summary" name="summary" minlength="5" maxlength="3000" placeholder="실제로 제공한 케어, 식사·활동, 관찰사항과 보호자 인계내용을 사실 중심으로 입력하세요." required></textarea><small>관리자는 이 완료 방문을 검토한 뒤 고객용 보관 리포트로 발행할 수 있습니다.</small></div><div class="status-banner warning"><strong>소급 입력 기록</strong><span>서비스 날짜와 실제 근무시간 외에 입력자·입력시각이 감사 로그에 남습니다. 이미 고객에게 발행된 불변 리포트는 변경할 수 없습니다.</span></div><label class="consent-line"><input type="checkbox" name="workConfirmed" required/><span>위 날짜에 실제로 서비스를 제공했으며 입력 내용이 사실과 일치함을 확인합니다.</span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">지난 근무 리포트 저장</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-retrospective-report-form]");
    const assignmentSelect = form.elements.assignmentId;
    const serviceDateInput = form.elements.serviceDate;
    const startedTimeInput = form.elements.startedTime;
    const endedTimeInput = form.elements.endedTime;
    const applyAssignmentDefaults = () => {
      const assignment = assignments.find((item) => item.id === assignmentSelect.value) || assignments[0];
      serviceDateInput.min = localDateKey(assignment.startAt);
      serviceDateInput.max = localDateKey(new Date(Math.min(startOfLocalDay(assignment.endAt).getTime(), startOfLocalDay(new Date()).getTime())));
      serviceDateInput.value = latestRetrospectiveServiceDate(assignment);
      startedTimeInput.value = assignment.dailyStart || "09:00";
      endedTimeInput.value = assignment.dailyEnd || "17:00";
      refreshEnhancedDateInput(serviceDateInput);
    };
    assignmentSelect.addEventListener("change", applyAssignmentDefaults);
    applyAssignmentDefaults();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const assignment = assignments.find((item) => item.id === values.assignmentId);
      if (!assignment) return showToast("선택한 서비스 배정을 찾을 수 없습니다.", "error");
      const serviceDate = parseLocalDateValue(values.serviceDate);
      if (serviceDate < startOfLocalDay(assignment.startAt) || serviceDate > startOfLocalDay(assignment.endAt) || serviceDate > startOfLocalDay(new Date())) return showToast("실제 서비스 날짜는 해당 배정 기간 안의 오늘 또는 지난 날짜여야 합니다.", "error");
      if (!assignmentOccursOnDate(assignment, serviceDate)) return showToast("선택한 날짜는 이 배정의 서비스 요일이 아닙니다.", "error");
      if (String(values.endedTime) <= String(values.startedTime)) return showToast("실제 종료시간은 시작시간보다 늦어야 합니다.", "error");
      if (String(values.summary || "").trim().length < 5) return showToast("5자 이상의 실제 근무 내용을 입력해 주세요.", "error");
      if (values.workConfirmed !== "on") return showToast("실제 근무 사실 확인에 동의해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "저장 중…";
      try {
        if (usingCloudData()) {
          await recordRetrospectiveCareReportCloud({
            assignmentId: assignment.id,
            serviceDate: values.serviceDate,
            startedTime: values.startedTime,
            endedTime: values.endedTime,
            summary: values.summary,
          });
          closeModal();
          await refreshCloudState();
        } else {
          const sessionId = `session-retro-${Date.now()}`;
          const startAt = new Date(`${values.serviceDate}T${values.startedTime}:00`).toISOString();
          const endAt = new Date(`${values.serviceDate}T${values.endedTime}:00`).toISOString();
          state.careSessions.push({ id: sessionId, assignmentId: assignment.id, serviceDate: values.serviceDate, status: "COMPLETED", startedAt: startAt, endedAt: endAt });
          state.events.push({ id: `evt-retro-${Date.now()}`, careSessionId: sessionId, assignmentId: assignment.id, clientId: assignment.clientId, babyId: assignment.babyId, type: assignmentServiceType(assignment) === "BABYSITTING" ? "sitter_note" : "note", at: endAt, author: user.fullName, data: assignmentServiceType(assignment) === "BABYSITTING" ? { category: "소급 리포트", text: String(values.summary).trim(), retrospective: true } : { text: String(values.summary).trim(), retrospective: true } });
          saveState();
          closeModal();
          render();
        }
        showToast(`${formatDate(`${values.serviceDate}T12:00:00`)} 지난 근무 리포트를 저장했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "지난 근무 리포트를 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "지난 근무 리포트 저장";
      }
    });
  }

  function openCareEventEditModal(eventId) {
    const careEvent = state.events.find((item) => item.id === eventId);
    if (!careEvent) return showToast("수정할 관리 기록을 찾을 수 없습니다.", "error");
    if (!canEditCareEvent(careEvent)) return showToast("이 관리 기록을 수정할 권한이 없습니다.", "error");
    openLogModal(careEvent.type, careEvent.data?.method || careEvent.data?.category || null, careEvent.id);
  }

  function openLogModal(type, preset = null, eventId = null) {
    const existingEvent = eventId ? state.events.find((item) => item.id === eventId) : null;
    const editing = Boolean(existingEvent);
    const assignment = editing
      ? state.assignments.find((item) => item.id === existingEvent.assignmentId)
      : activeAssignmentContext();
    if (!assignment || (!editing && (!state.session.active || state.session.assignmentId !== assignment.id))) {
      showToast(editing ? "이 기록에 연결된 서비스 배정을 찾을 수 없습니다." : "케어 세션을 먼저 시작해 주세요.", "error");
      return;
    }
    if (editing && !canEditCareEvent(existingEvent)) {
      showToast("이 관리 기록을 수정할 권한이 없습니다.", "error");
      return;
    }
    if (!editing && activeSessionIsStale(assignment)) {
      showToast("이전 근무일의 미종료 세션에는 새 기록을 추가할 수 없습니다. 먼저 케어를 종료해 주세요.", "error");
      return;
    }
    const allowedTypes = assignmentServiceType(assignment) === "BABYSITTING" ? ["meal", "sitter_note"] : ["feeding", "diaper", "sleep", "temperature", "bath", "weight", "mother", "note"];
    if (!allowedTypes.includes(type)) return showToast("현재 배정 서비스에서 사용할 수 없는 기록 항목입니다.");
    const client = clientById(assignment.clientId);
    if (!client) return showToast("배정된 고객 정보를 확인할 수 없어 기록 화면을 열지 않았습니다.", "error");
    const meta = EVENT_META[type] || EVENT_META.note;
    const babyName = babyNameFor(assignment, client) || "아이";
    const deviceNow = new Date();
    const sessionDate = editing ? objectiveEventDateKey(existingEvent) : state.session.serviceDate || localDateKey(deviceNow);
    const currentLocalDateTime = editing
      ? `${sessionDate}T${careEventLocalTime(existingEvent)}`
      : localDateTimeInputValue(deviceNow);
    const maximumLocalDateTime = sessionDate === localDateKey(deviceNow)
      ? localDateTimeInputValue(deviceNow)
      : `${sessionDate}T23:59`;
    const sessionTimeZone = editing ? objectiveEventTimeZone(existingEvent) : state.session.serviceTimeZone || deviceTimeZone();
    const careSessionId = editing ? existingEvent.careSessionId : state.session.id;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop>
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="log-modal-title">
          <header class="modal-header">
            <div class="modal-title-wrap"><div class="quick-icon">${meta.icon}</div><div><h3 id="log-modal-title">${meta.label} 기록 ${editing ? "수정" : ""}</h3><p>${meta.subtitle} · ${escapeHtml(babyName)}</p></div></div>
            <button class="close-button" data-close-modal aria-label="닫기">×</button>
          </header>
          <form class="modal-form" data-log-form data-log-form-type="${type}" data-care-event-id="${existingEvent?.id || ""}" data-care-session-id="${careSessionId || ""}" data-assignment-id="${assignment.id}" data-session-date="${sessionDate}" data-service-time-zone="${escapeHtml(sessionTimeZone)}">
            <div class="field care-record-time-field"><label for="event-recorded-at">기록 일시</label><div class="care-record-time-control"><input id="event-recorded-at" name="recordedAt" type="datetime-local" min="${sessionDate}T00:00" max="${escapeHtml(maximumLocalDateTime)}" value="${escapeHtml(currentLocalDateTime)}" step="60" required />${sessionDate === localDateKey(deviceNow) ? `<button type="button" class="secondary-button" data-use-device-now>현재 시각</button>` : ""}</div><small>${editing ? "기존 기록값을 불러왔습니다. 기억과 다른 항목만 고쳐 저장하세요." : "휴대폰의 현재 시각이 자동으로 입력됩니다. 실제 기록 시각이 다를 때만 수정하세요."} · ${escapeHtml(serviceTimeZoneLabel(sessionTimeZone))} (${escapeHtml(deviceUtcOffsetLabel(deviceNow))})</small></div>
            ${fieldsForType(type, preset)}
            ${editing ? `<div class="status-banner"><strong>기록 정정</strong><span>수정 전·후 내용과 수정자가 감사 기록에 남습니다.</span></div>` : ""}
            <div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">${editing ? "변경 저장" : "기록 저장"}</button></div>
          </form>
        </section>
      </div>`;

    bindModalFrame();
    const logForm = modalRoot.querySelector("[data-log-form]");
    if (editing) populateCareEventForm(logForm, existingEvent.data);
    bindFeedingEntryForm(logForm);
    bindUnitConversionFields(logForm);
    modalRoot.querySelector("[data-use-device-now]")?.addEventListener("click", () => {
      setCareRecordTimeToNow(modalRoot.querySelector("#event-recorded-at"), sessionDate);
    });
    if (!editing) window.requestAnimationFrame(() => setCareRecordTimeToNow(modalRoot.querySelector("#event-recorded-at"), sessionDate, false));
    logForm.addEventListener("submit", saveLogEvent);
  }

  let modalReturnFocus = null;

  function focusableElements(container) {
    return [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden && element.offsetParent !== null);
  }

  function bindModalFrame() {
    const backdrop = modalRoot.querySelector("[data-modal-backdrop]");
    const modal = backdrop?.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!backdrop || !modal) return;
    app.inert = true;
    enhanceDateInputs(modal);
    modalReturnFocus = document.activeElement;
    modalRoot.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(); });
    modal.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusables = focusableElements(modal);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener("keydown", handleModalEscape);
    window.setTimeout(() => (focusableElements(modal)[0] || modal).focus(), 0);
  }

  function handleModalEscape(event) {
    if (event.key === "Escape") closeModal();
  }

  function closeModal() {
    closeCalendarPicker();
    document.body.classList.remove("report-print-active");
    modalRoot.innerHTML = "";
    app.inert = false;
    document.removeEventListener("keydown", handleModalEscape);
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function eventDateFromLocalInput(value, timeZone = deviceTimeZone()) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    const desiredWallTime = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    let candidate = desiredWallTime;
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
        const formattedWallTime = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
        candidate += desiredWallTime - formattedWallTime;
      }
    } catch {
      const selected = new Date(String(value || ""));
      return Number.isNaN(selected.getTime()) ? null : selected.toISOString();
    }
    return new Date(candidate).toISOString();
  }

  async function saveLogEvent(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form.dataset.logFormType;
    const values = Object.fromEntries(new FormData(form).entries());
    const data = { ...values };
    const existingEventId = form.dataset.careEventId || null;
    const existingEvent = existingEventId ? state.events.find((item) => item.id === existingEventId) : null;
    const sessionDate = form.dataset.sessionDate;
    const sessionTimeZone = form.dataset.serviceTimeZone || deviceTimeZone();
    delete data.recordedAt;

    const [recordedLocalDate = "", recordedLocalTime = ""] = String(values.recordedAt || "").split("T");
    const eventAt = eventDateFromLocalInput(values.recordedAt, sessionTimeZone);
    const selectedDate = eventAt ? new Date(eventAt) : null;
    if (!eventAt || !/^\d{4}-\d{2}-\d{2}$/.test(recordedLocalDate) || !/^\d{2}:\d{2}$/.test(recordedLocalTime)) {
      return showToast("기록 날짜와 시간을 확인해 주세요.", "error");
    }
    if (recordedLocalDate !== sessionDate) {
      return showToast("해당 서비스 근무일과 같은 날짜 안에서 기록 시각을 선택해 주세요.", "error");
    }
    if (selectedDate.getTime() > Date.now() + 15 * 60 * 1000) {
      return showToast("현재 시각보다 15분을 초과한 미래 시간은 기록할 수 없습니다.", "error");
    }
    data.recordedLocalDate = recordedLocalDate;
    data.recordedLocalTime = recordedLocalTime;
    data.recordedTimeZone = sessionTimeZone;
    data.recordedUtcOffsetMinutes = Math.round((Date.UTC(
      Number(recordedLocalDate.slice(0, 4)),
      Number(recordedLocalDate.slice(5, 7)) - 1,
      Number(recordedLocalDate.slice(8, 10)),
      Number(recordedLocalTime.slice(0, 2)),
      Number(recordedLocalTime.slice(3, 5)),
    ) - selectedDate.getTime()) / 60000);
    if (existingEvent) {
      data.submittedAt = existingEvent.data?.submittedAt || existingEvent.at;
      data.correctedAt = new Date().toISOString();
      data.correctionCount = Number(existingEvent.data?.correctionCount || 0) + 1;
    } else {
      data.submittedAt = new Date().toISOString();
    }

    ["amount", "duration", "value", "inputValue", "waterTemperature"].forEach((key) => {
      if (key in data) data[key] = data[key] === "" ? null : Number(data[key]);
    });

    if (type === "feeding") {
      if (data.method === "breast") {
        delete data.amount;
        if (!Number.isFinite(data.duration) || data.duration < 1 || data.duration > 180) return showToast("직접 모유수유한 시간을 1~180분 사이로 입력해 주세요.", "error");
      } else if (["pumped", "formula"].includes(data.method)) {
        delete data.duration;
        delete data.side;
        if (!["ml", "oz"].includes(data.inputUnit) || !Number.isFinite(data.inputValue)) return showToast("수유량과 ml/oz 단위를 확인해 주세요.", "error");
        data.amount = volumeToMl(data.inputValue, data.inputUnit);
        if (!Number.isFinite(data.amount) || data.amount < 5 || data.amount > 500) return showToast("실제 수유량을 5~500ml 사이로 입력해 주세요.", "error");
      } else {
        return showToast("수유 방법을 선택해 주세요.", "error");
      }
    }
    if (type === "temperature") {
      if (!["c", "f"].includes(data.inputUnit) || !Number.isFinite(data.inputValue)) return showToast("체온과 ℃/℉ 단위를 확인해 주세요.", "error");
      data.value = celsiusFrom(data.inputValue, data.inputUnit);
      if (!Number.isFinite(data.value) || data.value < 34 || data.value > 43) return showToast("체온은 34~43℃ 또는 이에 해당하는 화씨 범위로 입력해 주세요.", "error");
    }
    if (type === "weight") {
      if (!["kg", "lb"].includes(data.inputUnit) || !Number.isFinite(data.inputValue)) return showToast("체중과 kg/lb 단위를 확인해 주세요.", "error");
      data.value = kilogramsFrom(data.inputValue, data.inputUnit);
      if (!Number.isFinite(data.value) || data.value < 1 || data.value > 20) return showToast("체중은 1~20kg 또는 이에 해당하는 lb 범위로 입력해 주세요.", "error");
    }
    if (type === "bath" && data.inputValue !== null && data.inputValue !== undefined) {
      if (!["c", "f"].includes(data.inputUnit) || !Number.isFinite(data.inputValue)) return showToast("물 온도와 ℃/℉ 단위를 확인해 주세요.", "error");
      data.waterTemperature = celsiusFrom(data.inputValue, data.inputUnit);
      if (!Number.isFinite(data.waterTemperature) || data.waterTemperature < 30 || data.waterTemperature > 45) return showToast("물 온도는 30~45℃ 또는 이에 해당하는 화씨 범위로 입력해 주세요.", "error");
    }
    if (type === "meal") data.mealType = "식사";
    if ("note" in data) data.note = String(data.note || "").trim();
    if ("text" in data) data.text = String(data.text || "").trim();

    if (usingCloudData()) {
      if (!existingEvent && (!form.dataset.careSessionId || !state.session.active)) return showToast("케어를 시작한 뒤 기록할 수 있습니다.");
      if (!existingEvent && activeSessionIsStale()) return showToast("이전 근무일의 미종료 세션에는 기록을 추가할 수 없습니다. 먼저 케어를 종료해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = existingEvent ? "변경 저장 중…" : "저장 중…";
      try {
        const payload = { at: eventAt, data, notes: data.note || data.notes || data.text || null };
        if (existingEvent) await updateCareEventCloud({ eventId: existingEvent.id, ...payload });
        else await saveCareEventCloud({ careSessionId: form.dataset.careSessionId, type, ...payload });
        closeModal();
        await refreshCloudState();
        showToast(`${EVENT_META[type].label} 기록을 ${existingEvent ? "수정" : "저장"}했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, `케어 기록을 ${existingEvent ? "수정" : "저장"}하지 못했습니다.`), "error");
        submitButton.disabled = false;
        submitButton.textContent = existingEvent ? "변경 저장" : "기록 저장";
      }
      return;
    }

    if (existingEvent) {
      Object.assign(existingEvent, { at: eventAt, serviceTimeZone: sessionTimeZone, data });
    } else {
      const formAssignment = state.assignments.find((item) => item.id === form.dataset.assignmentId);
      state.events.push({
        id: `evt-${Date.now()}`,
        careSessionId: form.dataset.careSessionId,
        assignmentId: form.dataset.assignmentId,
        clientId: formAssignment?.clientId || state.session.clientId,
        babyId: formAssignment?.babyId || state.session.babyId,
        type,
        at: eventAt,
        author: authUser().fullName,
        createdBy: authUser().id,
        serviceTimeZone: sessionTimeZone,
        data,
      });
    }
    saveState();
    closeModal();
    render();
    showToast(`${EVENT_META[type].label} 기록을 ${existingEvent ? "수정" : "저장"}했습니다.`);
  }

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    const tone = ["success", "error", "info"].includes(type) ? type : "success";
    toast.className = `toast ${tone}`;
    toast.setAttribute("role", tone === "error" ? "alert" : "status");
    toast.innerHTML = `<span>${tone === "success" ? "✓" : tone === "error" ? "!" : "i"}</span><span>${escapeHtml(message)}</span>`;
    toastRoot.replaceChildren(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  if ("serviceWorker" in navigator) {
    if (import.meta.env.PROD) {
      window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
    } else {
      window.addEventListener("load", async () => {
        const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
        await Promise.all(registrations.map((registration) => registration.unregister()));
        const cacheKeys = await caches.keys().catch(() => []);
        await Promise.all(cacheKeys.filter((key) => key.startsWith("promoms-") || key.startsWith("kwellness-")).map((key) => caches.delete(key)));
      });
    }
  }

  async function initializeApp() {
    const dateInputObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches?.('input[type="date"]')) enhanceDateInputs(node.parentElement || document);
        else enhanceDateInputs(node);
      }));
    });
    dateInputObserver.observe(app, { childList: true, subtree: true });
    dateInputObserver.observe(modalRoot, { childList: true, subtree: true });
    if (cloudEnabled) {
      if (supabase && !authSubscription) {
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === "PASSWORD_RECOVERY") {
            passwordRecoveryRequested = true;
            state.auth.screen = "reset-password";
            state.auth.currentUserId = session?.user?.id || state.auth.currentUserId;
            saveState();
            render();
          }
        });
        authSubscription = data.subscription;
      }
      await refreshCloudState();
      return;
    }
    render();
  }

  initializeApp();
})();
