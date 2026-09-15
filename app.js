import { backendStatus, supabase } from "./supabase-client.js";
import proMomsLogoUrl from "./assets/promoms-logo.png";
import {
  approveCaregiverCloud,
  archiveMemberCloud,
  archiveServiceRequestCloud,
  cloudEnabled,
  currentCloudSession,
  loadCloudState,
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
  setCareShiftCheckCloud,
  setCareSessionStatusCloud,
  setMemberAccessRolesCloud,
  setMemberStatusCloud,
  signInCloud,
  signOutCloud,
  signUpCloud,
  submitServiceRequestCloud,
  submitServiceAdjustmentCloud,
  updateCaregiverManagementCloud,
  updateClientManagementCloud,
  updateMyClientProfileCloud,
  updateMyProfileCloud,
  updatePasswordCloud,
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
    client: { label: "고객", name: "고객", initials: "고" },
    retail: { label: "리테일 직원", name: "리테일 직원", initials: "리" },
  };

  const SERVICE_META = {
    POSTPARTUM: { label: "산후조리", shortLabel: "산후조리", icon: "♡", tone: "postpartum", description: "산모 회복과 신생아 일상 케어" },
    BABYSITTING: { label: "베이비시팅", shortLabel: "베이비시팅", icon: "☆", tone: "babysitting", description: "식사·놀이·생활 중심 돌봄" },
  };

  const POSTPARTUM_WEEKLY_RATE = 1800;
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
  const CURRENT_CONSENT_VERSION = "2026-09-13";

  const PREMIUM_ADD_ONS = {
    MASSAGE: {
      label: "프리미엄 산모 마사지",
      icon: "✦",
      status: "COMING_SOON",
      enabled: false,
      addOnOnly: true,
      licenseRequirement: "Georgia Licensed Massage Therapist",
      description: "조지아주 마사지 테라피스트 라이선스를 보유한 전문가만 제공하는 산후조리 추가 서비스",
    },
  };

  const NAV = {
    admin: [
      { id: "overview", label: "운영 현황", icon: "◫" },
      { id: "schedule", label: "일정·배정", icon: "◷" },
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
      { id: "profile", label: "내 정보", icon: "♙" },
    ],
    client: [
      { id: "services", label: "나의 서비스", icon: "⌂" },
      { id: "postpartum", label: "나의 산후조리", icon: "♡" },
      { id: "babysitting", label: "나의 베이비시팅", icon: "☆" },
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
      version: 17,
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
      adminSelectedReportSessionId: null,
      shiftChecklists: {},
      serviceCatalog: { MASSAGE: { ...PREMIUM_ADD_ONS.MASSAGE } },
      views: { admin: "overview", caregiver: "caregiving", client: "services", retail: "pos" },
      auth: { currentUserId: null, screen: "public", termsVersion: CURRENT_CONSENT_VERSION },
      users: [],
      clients: [],
      assignments: [],
      serviceRequests: [],
      depositTransactions: [],
      balanceTransactions: [],
      refundTransactions: [],
      serviceAdjustments: [],
      reports: [],
      careSessions: [],
      reviews: [],
      events: [],
      session: { id: null, assignmentId: null, clientId: null, babyId: null, serviceDate: null, active: false, startedAt: null, endedAt: null, clientName: "", babyName: "", babyInitial: "", caregiverName: "", schedule: "", address: "" },
      retail: { selectedCategory: "ALL", posCategory: "ALL", cart: [], carts: {}, products: [], inventoryMovements: [], orders: [] },
    };
  }

  function buildSeedState() {
    if (!import.meta.env.DEV) return buildCloudShellState();
    return {
      version: 17,
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
      adminSelectedReportSessionId: null,
      shiftChecklists: {},
      serviceCatalog: { MASSAGE: { ...PREMIUM_ADD_ONS.MASSAGE } },
      views: { admin: "overview", caregiver: "caregiving", client: "services", retail: "pos" },
      auth: { currentUserId: null, screen: "public", termsVersion: CURRENT_CONSENT_VERSION },
      users: [
        { id: "user-admin", login: "admin-preview@localhost.invalid", email: "admin-preview@localhost.invalid", password: null, role: "admin", status: "approved", fullName: "운영 관리자", initials: "운", mustChangePassword: false, createdAt: dateOffset(-120) },
        { id: "user-retail", login: "retail-preview@localhost.invalid", email: "retail-preview@localhost.invalid", password: null, role: "retail", status: "approved", fullName: "리테일 담당자", initials: "리", mustChangePassword: false, createdAt: dateOffset(-90) },
        { id: "user-caregiver-mina", login: "caregiver-one@localhost.invalid", email: "caregiver-one@localhost.invalid", password: null, role: "caregiver", status: "approved", fullName: "Mina Kim", initials: "MK", phone: "470-555-0142", certification: "Newborn Care Specialist · CPR", hireDate: dateOffset(-58), careerYears: 6, employmentStatus: "ACTIVE", specialties: "신생아 수면, 모유수유 지원", residentialArea: "Duluth, GA", serviceArea: "Duluth · Johns Creek · Suwanee", hrNotes: "야간 근무는 사전 협의 필요", createdAt: dateOffset(-60) },
        { id: "user-caregiver-jane", login: "caregiver-two@localhost.invalid", email: "caregiver-two@localhost.invalid", password: null, role: "caregiver", status: "approved", fullName: "Jane Lee", initials: "JL", phone: "470-555-0188", certification: "Postpartum Doula · Infant CPR", hireDate: dateOffset(-42), careerYears: 4, employmentStatus: "ACTIVE", specialties: "산모 회복, 식사 지원", residentialArea: "Sandy Springs, GA", serviceArea: "Atlanta · Sandy Springs · Marietta", hrNotes: "주 4일 근무 선호", createdAt: dateOffset(-45) },
        { id: "user-caregiver-soo", login: "caregiver-three@localhost.invalid", email: "caregiver-three@localhost.invalid", password: null, role: "caregiver", status: "approved", fullName: "Soo Choi", initials: "SC", phone: "470-555-0194", certification: "Infant Care · CPR", hireDate: dateOffset(-28), careerYears: 3, employmentStatus: "ACTIVE", specialties: "영아 놀이, 생활 루틴, 안전 돌봄", residentialArea: "Kennesaw, GA", serviceArea: "Kennesaw · Marietta · Acworth", hrNotes: "오후 베이비시팅 일정 선호", createdAt: dateOffset(-30) },
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
      reviews: [],
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
            version: 17,
            users: mergeById(seed.users, saved.users),
            clients: mergeById(seed.clients, saved.clients),
            assignments: mergeById(seed.assignments, saved.assignments),
            serviceRequests: mergeById(seed.serviceRequests, saved.serviceRequests),
            serviceAdjustments: mergeById(seed.serviceAdjustments, saved.serviceAdjustments || []),
            events: mergeById(seed.events, saved.events),
            reviews: mergeById(seed.reviews, saved.reviews || []),
            views: { ...seed.views, ...(saved.views || {}) },
            serviceTabs: {
              client: { ...seed.serviceTabs.client, ...(saved.serviceTabs?.client || {}) },
              caregiver: { ...seed.serviceTabs.caregiver, ...(saved.serviceTabs?.caregiver || {}) },
            },
            peopleDirectory: { ...seed.peopleDirectory, ...(saved.peopleDirectory || {}) },
            financeFilters: { ...seed.financeFilters, ...(saved.financeFilters || {}) },
            serviceHistoryFilters: { ...seed.serviceHistoryFilters, ...(saved.serviceHistoryFilters || {}) },
            chartRangeByRole: { ...seed.chartRangeByRole, ...(saved.chartRangeByRole || {}) },
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
          version: 17,
          auth: seed.auth,
          users: seed.users,
          clients: seed.clients,
          assignments: seed.assignments,
          serviceRequests: seed.serviceRequests,
          serviceAdjustments: saved.serviceAdjustments || [],
          reports: saved.reports || [],
          reviews: saved.reviews || [],
          events: upgradedEvents,
          views: { ...seed.views, ...(saved.views || {}) },
          serviceTabs: seed.serviceTabs,
          peopleDirectory: { ...seed.peopleDirectory, ...(saved.peopleDirectory || {}) },
          financeFilters: { ...seed.financeFilters, ...(saved.financeFilters || {}) },
          serviceHistoryFilters: { ...seed.serviceHistoryFilters, ...(saved.serviceHistoryFilters || {}) },
          chartRangeByRole: { ...seed.chartRangeByRole, ...(saved.chartRangeByRole || {}) },
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
  state.version = 17;
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");
  const initialUrl = new URL(window.location.href);
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
        state = { ...clean, auth: { ...clean.auth, screen: "public", currentUserId: null } };
        return;
      }
      const preferredWorkspace = state.role;
      const live = await loadCloudState(session);
      Object.assign(state, live);
      state.auth.currentUserId = live.currentUser.id;
      const availableWorkspaces = availableWorkspaceRoles(live.currentUser);
      state.role = availableWorkspaces.includes(preferredWorkspace) ? preferredWorkspace : live.currentUser.role;
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
    if (message.includes("in-progress care session")) return "진행 중인 케어 세션을 먼저 종료하거나 취소한 뒤 서비스를 삭제해 주세요.";
    if (message.includes("detailed service removal reason")) return "서비스 삭제 사유를 5자 이상 구체적으로 입력해 주세요.";
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
    if (message.includes("only an owner")) return "소유자만 관리자 권한을 추가하거나 제거할 수 있습니다.";
    if (message.includes("duplicate") || message.includes("already exists")) return "이미 처리 중이거나 저장된 항목입니다.";
    if (message.includes("permission") || message.includes("row-level security") || message.includes("not authorized")) return "이 작업을 수행할 권한이 없습니다.";
    return fallback;
  }

  function todayLabel() {
    return TODAY_FORMATTER.format(new Date());
  }

  function timeLabel(value) {
    return TIME_FORMATTER.format(new Date(value));
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
    if (roles.has("CAREGIVER")) workspaces.push("caregiver");
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

  function isAssignmentCurrent(assignment) {
    const now = new Date();
    return new Date(assignment.startAt) <= now && now <= new Date(assignment.endAt) && assignment.status !== "CANCELLED";
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
    return isAssignmentCurrent(assignment) && assignmentOccursOnDate(assignment, new Date());
  }

  function assignmentServiceType(assignment) {
    return assignment?.serviceType === "BABYSITTING" ? "BABYSITTING" : "POSTPARTUM";
  }

  function serviceMetaFor(value) {
    return SERVICE_META[value === "BABYSITTING" ? "BABYSITTING" : "POSTPARTUM"];
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
    return assignmentWindow(dateInputValue(request.desiredStartDate), request.dailyStart, request.dailyEnd, request.weeks);
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
      ? state.assignments.find((assignment) => assignment.id === state.session.assignmentId && assignment.caregiverUserId === userId && assignment.status !== "CANCELLED" && (!serviceType || assignmentServiceType(assignment) === serviceType))
      : null;
    if (recoveredAssignment) return recoveredAssignment;
    const todaysAssignments = state.assignments
      .filter((assignment) => assignment.caregiverUserId === userId && assignmentIsScheduledToday(assignment) && (!serviceType || assignmentServiceType(assignment) === serviceType))
      .sort((a, b) => String(a.dailyStart).localeCompare(String(b.dailyStart)));
    return todaysAssignments.find((assignment) => state.session.active && state.session.assignmentId === assignment.id)
      || todaysAssignments.find((assignment) => assignment.todayCareSessionStatus !== "COMPLETED" && !(state.session.assignmentId === assignment.id && state.session.endedAt))
      || todaysAssignments.at(-1)
      || null;
  }

  function assignmentCompletedToday(assignment) {
    return assignment?.todayCareSessionStatus === "COMPLETED"
      || (!usingCloudData() && state.session.assignmentId === assignment?.id && Boolean(state.session.endedAt));
  }

  function nextAssignmentFor(userId, serviceType = null) {
    const now = new Date();
    return state.assignments
      .filter((assignment) => assignment.caregiverUserId === userId && new Date(assignment.startAt) > now && assignment.status !== "CANCELLED" && (!serviceType || assignmentServiceType(assignment) === serviceType))
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0] || null;
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

  function isCaregiverAssignable(user) {
    const hasCaregiverAccess = usingCloudData() ? user?.databaseRoles?.includes("CAREGIVER") : user?.role === "caregiver";
    const caregiverStatus = user?.caregiverStatus || user?.status;
    if (!hasCaregiverAccess || caregiverStatus !== "approved" || user.employmentStatus !== "ACTIVE") return false;
    return !usingCloudData() || user.hasHrProfile === true;
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
      return state.assignments
        .filter((assignment) => assignment.caregiverUserId === user.id && isAssignmentCurrent(assignment))
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
    const sessionDateKey = state.session.active
      && state.session.assignmentId === assignment?.id
      && state.session.serviceDate
      ? state.session.serviceDate
      : localDateKey(new Date());
    const allowedEventTypes = assignmentServiceType(assignment) === "BABYSITTING" ? ["meal", "sitter_note"] : ["feeding", "diaper", "sleep", "temperature", "bath", "weight", "mother", "note"];
    return state.events.filter((event) => allowed.includes(event.clientId) && (!contextId || event.clientId === contextId) && (!assignment || event.assignmentId === assignment.id) && localDateKey(event.at) === sessionDateKey && allowedEventTypes.includes(event.type));
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
        admin: new Set(["overview", "schedule", "requests", "finance", "history", "people", "reports"]),
        caregiver: new Set(["caregiving", "postpartum", "babysitting", "profile"]),
        client: new Set(["services", "postpartum", "babysitting"]),
        retail: new Set(["pos"]),
      };
      items = items.filter((item) => liveViews[role]?.has(item.id));
      if (role === "admin" && hasDatabaseRole("CARE_MANAGER") && !hasDatabaseRole("OWNER") && !hasDatabaseRole("ADMIN")) {
        items = items.filter((item) => ["overview", "schedule", "reports"].includes(item.id));
      }
      if (role === "retail") items = items.map((item) => ({ ...item, label: "리테일 준비 중" }));
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
      caregiver: [view === "caregiving" ? "My Caregiving" : serviceType === "BABYSITTING" ? "Babysitting Caregiving" : "Postpartum Caregiving", view === "caregiving" ? "두 서비스의 현재·다음 배정을 한눈에 확인하세요." : serviceType === "BABYSITTING" ? "식사와 생활 이벤트를 간결하게 기록하세요." : "산모와 신생아의 케어 기록에 집중하세요."],
      client: [view === "services" ? "My Services" : serviceType === "BABYSITTING" ? "My Babysitting" : "My Postpartum Care", view === "services" ? "이용 중인 서비스와 신청·배정 상태를 한눈에 확인하세요." : "선택한 서비스의 일정과 돌봄 기록만 안전하게 표시됩니다."],
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

  function postpartumEstimate(weeks) {
    return POSTPARTUM_WEEKLY_RATE * Math.max(MIN_SERVICE_WEEKS, Number(weeks || MIN_SERVICE_WEEKS));
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
          ? `<button class="primary-button mini-button" data-record-approved-deposit="${request.id}">예약금 확인</button>`
          : requestOutstandingBalance(request) > 0
            ? `<button class="primary-button mini-button" data-record-service-balance="${request.id}">잔금 확인</button>`
            : '<span class="status-chip">수납 완료</span>'
        : "";
      return `<button class="secondary-button mini-button" data-edit-assignment="${assignment.id}">상세 보기</button>${paymentAction}`;
    }
    return `<button class="secondary-button mini-button" data-edit-assignment="${assignment.id}">변경</button><button class="danger-button mini-button" data-cancel-assignment="${assignment.id}">삭제</button>`;
  }

  function adminSchedule() {
    const caregivers = state.users.filter(isCaregiverAssignable);
    const approvedUnscheduled = state.serviceRequests.filter((request) => request.status === "APPROVED" && !request.approvedAssignmentId && clientById(request.clientId));
    const approvedQueue = approvedUnscheduled.filter(requestHasCapturedDepositEvidence);
    const depositEvidenceQueue = approvedUnscheduled.filter((request) => !requestHasCapturedDepositEvidence(request));
    const filter = ["POSTPARTUM", "BABYSITTING"].includes(state.adminScheduleFilter) ? state.adminScheduleFilter : "ALL";
    const assignments = state.assignments.filter((item) => item.status !== "CANCELLED" && (filter === "ALL" || assignmentServiceType(item) === filter));
    return `
      <section class="page">
        ${demoBanner()}
        ${pageHeading("SCHEDULE & ASSIGNMENTS", "승인 신청 기반 일정·배정", "승인된 고객 서비스 신청을 불러와 관리사만 선택하고 월간 캘린더에 배치합니다.")}
        <div class="grid stats">${statCard("Active", state.assignments.filter(isAssignmentCurrent).length, "현재 진행 중", "◷")}${statCard("Postpartum", state.assignments.filter((item) => isAssignmentCurrent(item) && assignmentServiceType(item) === "POSTPARTUM").length, "산후조리 진행", "♡")}${statCard("Babysitting", state.assignments.filter((item) => isAssignmentCurrent(item) && assignmentServiceType(item) === "BABYSITTING").length, "베이비시팅 진행", "☆")}${statCard("Ready to schedule", approvedQueue.length, "승인·예약금 확인 완료", "→")}</div>
        <article class="card card-pad schedule-source-card" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">APPROVED SERVICE REQUESTS</p><h3>일정 배치 대기</h3><p>승인과 예약금 수납이 확인된 신청을 캘린더에 배치할 수 있습니다.</p></div><span class="status-chip gold">${approvedQueue.length} ready</span></div>${depositEvidenceQueue.length ? `<div class="status-banner warning"><strong>${depositEvidenceQueue.length}건의 예약금 증빙을 먼저 보완해 주세요.</strong><span>실제 수납 근거가 없는 기존 승인 건은 일정 배치에서 제외됩니다.</span></div><div class="approved-schedule-strip evidence-schedule-strip">${depositEvidenceQueue.map((request) => { const client = clientById(request.clientId); return `<button type="button" class="approved-schedule-card ${serviceMetaFor(request.serviceType).tone}" data-record-approved-deposit="${request.id}">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyNameFor(request, client) || "아이")}</strong><span>${money(Number(request.depositAmount || (assignmentServiceType(request) === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT)))} 수납 증빙 필요</span><em>증빙 보완 →</em></button>`; }).join("")}</div>` : ""}<div class="approved-schedule-strip">${approvedQueue.length ? approvedQueue.map((request) => { const client = clientById(request.clientId); return `<button type="button" class="approved-schedule-card ${serviceMetaFor(request.serviceType).tone}" data-open-assignment data-request-id="${request.id}">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyNameFor(request, client) || "아이")}</strong><span>${formatDate(request.desiredStartDate)} · ${request.dailyStart}–${request.dailyEnd} · ${request.weeks}주</span><em>일정 배치 →</em></button>`; }).join("") : `<div class="empty-state"><strong>배치 가능한 승인 신청이 없습니다.</strong><span>${depositEvidenceQueue.length ? "위 승인 건의 실제 예약금 증빙을 보완해 주세요." : "서비스 신청·승인 메뉴에서 먼저 고객 신청을 승인해 주세요."}</span></div>`}</div></article>
        <div class="schedule-filter-bar" role="group" aria-label="캘린더 서비스 필터"><span>표시 서비스</span>${[["ALL", "전체"], ["POSTPARTUM", "♡ 산후조리"], ["BABYSITTING", "☆ 베이비시팅"]].map(([value, label]) => `<button type="button" class="${filter === value ? "active" : ""}" data-schedule-filter="${value}">${label}</button>`).join("")}</div>
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
    return `<div class="month-calendar"><div class="month-weekdays">${weekdayHeader}</div><div class="month-grid">${days.map((day) => { const dayStart = new Date(day); dayStart.setHours(0,0,0,0); const dayEnd = new Date(day); dayEnd.setHours(23,59,59,999); const assignments = state.assignments.filter((item) => item.status !== "CANCELLED" && (state.adminScheduleFilter === "ALL" || !state.adminScheduleFilter || assignmentServiceType(item) === state.adminScheduleFilter) && new Date(item.startAt) <= dayEnd && new Date(item.endAt) >= dayStart && assignmentOccursOnDate(item, day)); const outside = day.getMonth() !== viewMonth.getMonth(); const today = day.toDateString() === new Date().toDateString(); return `<div class="month-day ${outside ? "outside" : ""} ${today ? "today" : ""}"><header>${day.getDate()}</header><div class="month-events">${assignments.slice(0,3).map((assignment) => { const client = clientById(assignment.clientId); const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId); return `<button class="month-event ${assignmentServiceType(assignment).toLowerCase()}" data-edit-assignment="${assignment.id}" title="${escapeHtml(serviceMetaFor(assignment.serviceType).label)} · ${escapeHtml(client?.motherName || "고객")} / ${escapeHtml(caregiver?.fullName || "관리사")}"><strong>${assignmentServiceType(assignment) === "BABYSITTING" ? "☆" : "♡"} ${escapeHtml(babyNameFor(assignment, client) || client?.motherName || "고객")}</strong><span>${escapeHtml(caregiver?.fullName || "관리사 미배정")} · ${assignment.dailyStart}</span></button>`; }).join("")}${assignments.length > 3 ? `<small>+${assignments.length - 3}개 일정</small>` : ""}</div></div>`; }).join("")}</div></div>`;
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
    return `<footer class="directory-pagination"><span class="directory-count">총 ${pagination.totalItems}명 · ${pagination.page}/${pagination.totalPages} 페이지</span><nav class="pagination-pages" aria-label="${scope === "client" ? "고객" : "관리사"} 목록 페이지"><button type="button" class="page-button page-arrow" data-directory-page="${scope}" data-page="${pagination.page - 1}" ${pagination.page === 1 ? "disabled" : ""} aria-label="이전 페이지">‹</button>${pageItems.map((page, index) => page === null ? `<span class="page-ellipsis" aria-hidden="true" data-ellipsis-index="${index}">…</span>` : `<button type="button" class="page-button ${page === pagination.page ? "current" : ""}" data-directory-page="${scope}" data-page="${page}" ${page === pagination.page ? 'aria-current="page"' : ""}>${page}</button>`).join("")}<button type="button" class="page-button page-arrow" data-directory-page="${scope}" data-page="${pagination.page + 1}" ${pagination.page === pagination.totalPages ? "disabled" : ""} aria-label="다음 페이지">›</button></nav></footer>`;
  }

  function directoryToolbarMarkup(scope, query, sort, pageSize) {
    const isClient = scope === "client";
    const sortOptions = isClient
      ? [["mother-asc", "고객 이름 가나다순"], ["mother-desc", "고객 이름 역순"], ["baby-asc", "아기 이름 가나다순"], ["baby-desc", "아기 이름 역순"], ["care-newest", "관리 년월 최신순"], ["care-oldest", "관리 년월 오래된순"]]
      : [["name-asc", "관리사 이름 가나다순"], ["name-desc", "관리사 이름 역순"], ["hire-newest", "입사년월 최신순"], ["hire-oldest", "입사년월 오래된순"], ["residence-asc", "거주지역 가나다순"], ["residence-desc", "거주지역 역순"]];
    return `<div class="directory-toolbar"><form class="directory-search-form" data-directory-search="${scope}"><label class="sr-only" for="${scope}-directory-search">${isClient ? "고객·아기" : "관리사"} 검색</label><input id="${scope}-directory-search" name="query" type="search" value="${escapeHtml(query)}" placeholder="${isClient ? "고객·아기 이름, 연락처 검색" : "이름, 지역, 자격 검색"}" /><button type="submit" class="secondary-button mini-button">검색</button>${query ? `<button type="button" class="text-button directory-clear" data-clear-directory-search="${scope}">초기화</button>` : ""}</form><div class="directory-filter-group"><label for="${scope}-directory-sort">정렬</label><select id="${scope}-directory-sort" data-directory-sort="${scope}">${sortOptions.map(([value, label]) => `<option value="${value}" ${value === sort ? "selected" : ""}>${label}</option>`).join("")}</select><label for="${scope}-directory-size">표시</label><select id="${scope}-directory-size" data-directory-size="${scope}">${[2, 5, 10, 20].map((size) => `<option value="${size}" ${Number(pageSize) === size ? "selected" : ""}>${size}명</option>`).join("")}</select></div></div>`;
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
    return `<div class="management-row caregiver-management-row"><div class="management-identity"><div class="mini-avatar">${escapeHtml(user.initials)}</div><div><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email)} · ${escapeHtml(user.phone || "전화 미등록")}</span></div></div><div class="management-cell"><span>경력·입사년월</span><strong>${Number(user.careerYears || 0)}년 경력</strong><small>${user.hireDate ? `${formatDate(user.hireDate, { year: "numeric", month: "long" })} 입사` : "입사일 미등록"}</small></div><div class="management-cell"><span>거주지역·전문분야</span><strong>${escapeHtml(user.residentialArea || "거주지역 미등록")}</strong><small>${escapeHtml(user.specialties || user.certification || "전문분야 미등록")} · 담당 ${escapeHtml(user.serviceArea || "미등록")}</small></div><div class="management-cell memo-cell"><span>현재 배정·인사메모</span><strong>${client ? `${escapeHtml(client.motherName)} · ${escapeHtml(assignedBabyName || "아이")}` : "현재 배정 없음"}</strong><small>${escapeHtml(hrSetupRequired ? "인사정보를 저장하고 근무상태를 재직으로 설정해야 배정할 수 있습니다." : user.hrNotes || "인사 메모 없음")}</small></div><div class="management-actions"><span class="status-chip ${user.status === "pending" || user.employmentStatus === "INACTIVE" || hrSetupRequired || suspended || archived ? "coral" : ""}">${accountStatusLabel}</span><button class="secondary-button mini-button" data-manage-caregiver="${user.id}">${hrSetupRequired ? "인사정보 설정" : "프로필·수정"}</button>${accountAction}</div></div>`;
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
      return Number(request?.weeks || 0) * Number(request?.weeklyRate || POSTPARTUM_WEEKLY_RATE);
    }
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
    return Math.max(0, requestServiceTotal(request) - requestDepositNet(request) - requestBalanceNet(request));
  }

  function memberAccountRowMarkup(user) {
    const isSelf = user.id === authUser()?.id;
    const archived = user.accountStatus === "REJECTED";
    const pending = user.accountStatus === "PENDING";
    const currentRoles = user.databaseRoles?.length ? user.databaseRoles : [DATABASE_ROLE_BY_APP_ROLE[user.role] || "CLIENT"];
    const targetIsAdministrator = currentRoles.some((role) => ["OWNER", "ADMIN"].includes(role));
    const protectedAdministrator = targetIsAdministrator && !canGrantAdministrativeRole() && !isSelf;
    const roleBadges = currentRoles
      .map((role) => `<span class="member-role-badge ${["OWNER", "ADMIN"].includes(role) ? "administrative" : ""}">${escapeHtml(DATABASE_ROLE_LABELS[role] || role)}</span>`)
      .join("");
    const accountAction = isSelf || currentRoles.includes("OWNER")
      ? `<span class="status-chip">${isSelf ? "현재 계정" : "보호된 소유자"}</span>`
      : archived
        ? `<span class="status-chip coral">보관됨</span>`
        : `<button class="text-button danger-text mini-button" data-archive-member="${user.id}" data-member-name="${escapeHtml(user.fullName)}">계정 보관</button>`;
    return `<div class="management-row member-account-row ${archived ? "is-archived" : ""}"><div class="management-identity"><div class="mini-avatar">${escapeHtml(user.initials || initialsFor(user.fullName))}</div><div><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email || "이메일 미등록")}</span></div></div><div class="management-cell"><span>접근 권한</span><div class="member-role-badges">${roleBadges}</div><button class="secondary-button mini-button member-access-button" type="button" data-configure-member-roles="${user.id}" ${archived || protectedAdministrator ? "disabled" : ""}>권한 구성</button><small>${protectedAdministrator ? "소유자만 다른 관리자 권한을 변경할 수 있습니다." : "한 계정에 여러 작업공간을 함께 부여할 수 있습니다."}</small></div><div class="management-cell"><span>가입일</span><strong>${user.createdAt ? formatDate(user.createdAt) : "미등록"}</strong><small>${escapeHtml(user.phone || "전화 미등록")}</small></div><div class="management-cell"><span>계정 상태</span><strong>${archived ? "보관됨" : pending ? "승인 대기" : user.accountStatus === "SUSPENDED" ? "접근 정지" : "정상"}</strong><small>${archived ? "로그인 및 데이터 접근 차단" : `${currentRoles.length}개 권한 연결됨`}</small></div><div class="management-actions">${accountAction}</div></div>`;
  }

  function openMemberRoleAccessModal(userId) {
    const member = state.users.find((item) => item.id === userId);
    if (!member) return showToast("회원 정보를 찾을 수 없습니다.", "error");
    const currentRoles = new Set(member.databaseRoles?.length ? member.databaseRoles : [DATABASE_ROLE_BY_APP_ROLE[member.role] || "CLIENT"]);
    const adminLocked = !canGrantAdministrativeRole();
    const fixedRoles = ["OWNER", "CARE_MANAGER", "RETAIL_STAFF"].filter((role) => currentRoles.has(role));
    const roleOption = (role, label, detail, disabled = false) => `<label class="member-access-option ${disabled ? "locked" : ""}"><input type="checkbox" name="accessRole" value="${role}" ${currentRoles.has(role) ? "checked" : ""} ${disabled ? "disabled" : ""}/><span><strong>${label}</strong><small>${detail}</small></span></label>`;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal member-access-modal" role="dialog" aria-modal="true" aria-labelledby="member-access-title"><header class="modal-header"><div><p class="eyebrow">MEMBER ACCESS</p><h3 id="member-access-title">회원 권한 구성</h3><p>${escapeHtml(member.fullName)} · ${escapeHtml(member.email || "이메일 미등록")}</p></div><button class="close-button" type="button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-member-access-form><div class="status-banner"><strong>복수 역할 계정</strong><span>선택한 작업공간을 같은 로그인 계정에서 전환해 사용할 수 있습니다. 기존 역할의 운영 기록은 다른 역할을 추가해도 유지됩니다.</span></div><fieldset class="member-access-options"><legend>허용할 작업공간</legend>${roleOption("CLIENT", "고객", "본인의 서비스 신청·일정·케어 기록을 확인합니다.")}${roleOption("CAREGIVER", "관리사", "배정된 고객 일정과 케어 기록 화면을 사용합니다.")}${roleOption("ADMIN", "관리자", adminLocked ? "현재 관리자 권한은 유지되며 소유자만 변경할 수 있습니다." : "회원·일정·결제·운영 정보를 관리합니다.", adminLocked)}${fixedRoles.length ? `<div class="fixed-access-note"><strong>보호된 기존 권한</strong><div class="member-role-badges">${fixedRoles.map((role) => `<span class="member-role-badge administrative">${escapeHtml(DATABASE_ROLE_LABELS[role])}</span>`).join("")}</div><small>소유자 및 기존 특수 권한은 이 화면에서 제거되지 않습니다.</small></div>` : ""}</fieldset><div class="privacy-boundary-note"><strong>고객 작업공간 자동 준비</strong><span>고객 권한을 추가하면 고객 레코드와 계정 연결을 즉시 생성하고 계정을 활성화합니다. 회원은 고객 화면에서 아기·주소 정보를 직접 작성한 뒤 바로 서비스를 신청할 수 있습니다.</span></div><div class="privacy-boundary-note"><strong>관리자 예외 승인</strong><span>관리자 또는 소유자가 관리사 권한을 추가하면 회원의 사전 약관 동의가 없어도 즉시 활성화됩니다. 회원 본인의 동의로 기록하지 않으며 승인자와 예외 적용 여부를 감사 로그에 남깁니다.</span></div><div class="privacy-boundary-note"><strong>활성 기록 보호</strong><span>진행 중인 고객 계약이나 관리사 배정이 있으면 해당 권한은 제거할 수 없지만, 다른 권한을 추가하는 것은 가능합니다.</span></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">권한 저장</button></div></form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-member-access-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const selectedRoles = [...form.querySelectorAll('input[name="accessRole"]:checked')].map((input) => input.value);
      fixedRoles.forEach((role) => { if (!selectedRoles.includes(role)) selectedRoles.push(role); });
      if (!selectedRoles.length) return showToast("최소 한 개의 접근 권한을 선택해 주세요.", "error");
      const addingCaregiver = selectedRoles.includes("CAREGIVER") && !currentRoles.has("CAREGIVER");
      const addingClient = selectedRoles.includes("CLIENT") && !currentRoles.has("CLIENT");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "저장 중…";
      try {
        if (usingCloudData()) {
          await setMemberAccessRolesCloud(member.id, selectedRoles);
          closeModal();
          await refreshCloudState();
        } else {
          member.databaseRoles = selectedRoles;
          member.role = selectedRoles.some((role) => ["OWNER", "ADMIN", "CARE_MANAGER"].includes(role))
            ? "admin"
            : selectedRoles.includes("CAREGIVER") ? "caregiver"
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
    const issue = serviceLifecycleIssue(request.clientId, assignmentServiceType(request), window.startAt, window.endAt, null, request.id, request.babyId, request.babyName);
    const price = assignmentServiceType(request) === "POSTPARTUM" ? `$${postpartumEstimate(request.weeks).toLocaleString("en-US")} 예상 · 주 $${POSTPARTUM_WEEKLY_RATE.toLocaleString("en-US")}` : `시간당 $${BABYSITTING_HOURLY_RATE} · 독립 신청 서비스`;
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
    return `<div class="client-request-row service-request-management-row ${issue || clientLinkIssue || depositEvidenceMissing ? "has-lifecycle-issue" : ""}"><div><div class="request-title-line">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</strong></div><span>${request.weeks}주 · ${formatDate(request.desiredStartDate)} · ${request.dailyStart}–${request.dailyEnd}</span><small>${price}</small></div><div><strong>${escapeHtml(request.address)}</strong><span>알러지 ${escapeHtml(request.allergies || "없음")} · 추가인원 ${request.extraHouseholdMembers || 0}명</span></div><div><strong>${clientLinkIssue ? "고객 계정 연결 오류" : issue ? "일정 중복 확인 필요" : isApprovedQueue ? queueTitle : "신청 내용"}</strong><span>${escapeHtml(issueDetail)}</span></div>${isApprovedQueue ? queueAction : `<button class="primary-button mini-button" data-review-client-request="${request.id}" ${clientLinkIssue ? "disabled" : ""}>신청 검토·승인</button>`}</div>`;
  }

  function adjustmentManagementMarkup(adjustments) {
    return `<article class="card card-pad adjustment-review-card" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">CHANGE & CANCELLATION QUEUE</p><h3>변경·취소 승인 요청</h3><p>기존 일정은 유지한 채 정책과 관리사 일정을 검토한 뒤 승인합니다.</p></div><span class="status-chip coral">${adjustments.length} pending</span></div><div class="request-list">${adjustments.length ? adjustments.map((adjustment) => {
      const client = clientById(adjustment.clientId);
      const target = adjustmentTarget(adjustment.targetType, adjustment.targetId);
      const proposed = adjustment.action === "CHANGE" ? `${new Date(`${adjustment.proposedStartDate}T12:00:00`).toLocaleDateString("ko-KR")} · ${adjustment.proposedWeeks}주 · ${adjustment.proposedDailyStart}–${adjustment.proposedDailyEnd}` : "전체 서비스 취소";
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
    const approvedQueue = state.serviceRequests.filter((request) => request.status === "APPROVED" && !request.approvedAssignmentId);
    const refundDueRequests = state.serviceRequests.filter((request) => request.status === "CANCELLED" && request.depositStatus === "REFUND_DUE");
    const pendingPostpartum = pending.filter((request) => assignmentServiceType(request) === "POSTPARTUM");
    const pendingBabysitting = pending.filter((request) => assignmentServiceType(request) === "BABYSITTING");
    return `<section class="page admin-request-page">${demoBanner()}${pageHeading("SERVICE REQUEST CONTROL", "서비스 신청·승인", "산후조리와 베이비시팅 신청을 각각 검토하고 일정 중복 여부를 확인합니다.")}<div class="grid stats">${statCard("Pending review", pending.length, "신청 검토 필요", "!")}${statCard("Postpartum", pendingPostpartum.length, "산후조리 검토 대기", "♡")}${statCard("Babysitting", pendingBabysitting.length, "베이비시팅 검토 대기", "☆")}${statCard("Ready to schedule", approvedQueue.length, "승인 완료·배정 대기", "◷")}</div><div class="service-request-columns" style="margin-top:18px"><article class="card card-pad request-service-column postpartum"><div class="section-header"><div>${serviceBadgeMarkup("POSTPARTUM")}<h3>산후조리 신청</h3><p>주 $${POSTPARTUM_WEEKLY_RATE.toLocaleString("en-US")} · 산모 상태와 신생아 케어 요청을 검토합니다.</p></div><span class="status-chip coral">${pendingPostpartum.length}</span></div><div class="request-list">${pendingPostpartum.length ? pendingPostpartum.map((request) => requestManagementRowMarkup(request, "pending")).join("") : `<div class="empty-state"><strong>검토 대기 신청이 없습니다.</strong></div>`}</div></article><article class="card card-pad request-service-column babysitting"><div class="section-header"><div>${serviceBadgeMarkup("BABYSITTING")}<h3>베이비시팅 신청</h3><p>희망 일정과 식사·알러지·생활 루틴을 함께 검토합니다.</p></div><span class="status-chip coral">${pendingBabysitting.length}</span></div><div class="request-list">${pendingBabysitting.length ? pendingBabysitting.map((request) => requestManagementRowMarkup(request, "pending")).join("") : `<div class="empty-state"><strong>검토 대기 신청이 없습니다.</strong></div>`}</div></article></div><article class="card card-pad approved-request-queue" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">APPROVED QUEUE</p><h3>일정 배치 가능한 승인 신청</h3><p>고객이 입력한 일정과 요청사항을 불러오고, 동일 아기의 서비스 기간이 겹치지 않을 때 관리사를 배치합니다.</p></div><span class="status-chip gold">${approvedQueue.length} ready</span></div><div class="request-list">${approvedQueue.length ? approvedQueue.map((request) => requestManagementRowMarkup(request, "approved")).join("") : `<div class="empty-state"><strong>일정 배치 대기 신청이 없습니다.</strong><span>신청을 승인하면 이 목록으로 이동합니다.</span></div>`}</div></article>${canReviewServiceRequests() ? depositRefundQueueMarkup(refundDueRequests) : ""}</section>`;
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
    const clientLinkIssue = requestClientLinkIssue(request);
    const total = requestServiceTotal(request);
    const deposit = requestDepositNet(request);
    const balancePaid = requestBalanceNet(request);
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
      ? `<button class="primary-button mini-button" data-record-approved-deposit="${request.id}">예약금 확인·기록</button>`
      : canRecordBalance
        ? `<button class="primary-button mini-button" data-record-service-balance="${request.id}">잔금 확인·기록</button>`
        : request.status === "APPROVED" && clientLinkIssue
          ? '<span class="status-chip coral">연결 복구 필요</span>'
          : outstanding === 0 && request.status === "APPROVED"
            ? '<span class="status-chip">수납 완료</span>'
            : "";
    return `<div class="finance-ledger-row ${clientLinkIssue ? "has-lifecycle-issue" : ""}"><div class="finance-ledger-primary"><div class="request-title-line">${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</strong></div><span>${formatDate(request.desiredStartDate)} 시작 · ${request.weeks}주</span><small>신청 ${request.createdAt ? formatDate(request.createdAt) : "일자 미등록"}</small></div><div><span>신청 상태</span><strong class="status-chip ${statusTone}">${escapeHtml(serviceRequestStatusLabel(request))}</strong><small>${escapeHtml(clientLinkIssue || (request.approvedAssignmentId ? "일정 배정 연결됨" : ""))}</small></div><div><span>총 예정금액</span><strong>${total > 0 ? money(total) : "계산 필요"}</strong><small>${assignmentServiceType(request) === "POSTPARTUM" ? `주 ${money(Number(request.weeklyRate || POSTPARTUM_WEEKLY_RATE))}` : `시간당 ${money(BABYSITTING_HOURLY_RATE)}`}</small></div><div><span>예약금</span><strong>${depositLabel}</strong><small>${escapeHtml(depositReference ? `거래 ${depositReference}` : "실제 증빙 기준")}${depositReceivedAt ? ` · ${formatDate(depositReceivedAt)}` : ""}</small></div><div><span>잔금</span><strong>${money(balancePaid)} 수납</strong><small>${request.status === "APPROVED" ? `${money(outstanding)} 미수` : "승인 건만 미수 계산"}${latestBalancePayment ? ` · 최근 ${formatDate(latestBalancePayment.capturedAt || latestBalancePayment.captured_at)}` : ""}</small></div><div class="finance-ledger-action">${actionMarkup}</div></div>`;
  }

  function financeCollectionQueueItemMarkup(request) {
    const client = clientById(request.clientId);
    const clientLinkIssue = requestClientLinkIssue(request);
    const total = requestServiceTotal(request);
    const deposit = requestDepositNet(request);
    const balancePaid = requestBalanceNet(request);
    const outstanding = requestOutstandingBalance(request);
    const requiredDeposit = Number(request.depositAmount || (assignmentServiceType(request) === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT));
    const needsDeposit = deposit <= 0;
    const collected = deposit + balancePaid;
    const progress = total > 0 ? Math.min(100, Math.max(0, collected / total * 100)) : 0;
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
    return `<article class="finance-collection-item ${clientLinkIssue ? "has-lifecycle-issue" : ""}"><div class="finance-collection-identity"><div>${serviceBadgeMarkup(request.serviceType)}<strong>${escapeHtml(client?.motherName || "고객 연결 확인 필요")} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</strong></div><span>${formatDate(request.desiredStartDate)} 시작 · ${request.weeks}주</span></div><div class="finance-collection-amounts"><div><span>총 예정금액</span><strong>${money(total)}</strong></div><div><span>예약금 수납</span><strong>${money(deposit)}</strong></div><div><span>본 금액 수납</span><strong>${money(balancePaid)}</strong></div><div class="outstanding"><span>현재 미수금</span><strong>${money(outstanding)}</strong></div></div><div class="finance-collection-progress" aria-label="총 예정금액 중 ${Math.round(progress)}% 수납"><span style="width:${progress.toFixed(2)}%"></span></div><div class="finance-collection-footer"><small>${escapeHtml(clientLinkIssue || nextStep)}</small>${actionMarkup}</div></article>`;
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
      serviceType: ["ALL", "POSTPARTUM", "BABYSITTING"].includes(state.serviceHistoryFilters?.serviceType) ? state.serviceHistoryFilters.serviceType : "ALL",
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
    const directory = state.peopleDirectory;
    const clientQuery = normalizeDirectorySearch(directory.clientQuery);
    const caregiverQuery = normalizeDirectorySearch(directory.caregiverQuery);
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
    const clientPage = paginateDirectory(clients, directory.clientPage, directory.clientPageSize);
    const caregiverPage = paginateDirectory(sortedCaregivers, directory.caregiverPage, directory.caregiverPageSize);
    const clientCount = clientQuery ? `${clients.length} / ${state.clients.length} families` : `${state.clients.length} families`;
    const caregiverCount = caregiverQuery ? `${sortedCaregivers.length} / ${caregivers.length} people` : `${caregivers.length} people`;
    const visibleMembers = [...state.users].sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));
    const activeMemberCount = visibleMembers.filter((user) => user.accountStatus !== "REJECTED").length;
    return `
      <section class="page">
        ${demoBanner()}
        ${pageHeading("CLIENT CRM & PEOPLE", "고객·아기 관리 및 인사관리", "가입 승인부터 고객 상담 기록, 아기 정보, 관리사 경력과 근무 이력까지 한 곳에서 관리합니다.")}
        <div class="grid stats people-stats">${statCard("Clients", state.clients.length, `${activeClients.length}명 서비스 관리 중`, "♡")}${statCard("Caregivers", caregivers.length, `${caregivers.filter((user) => user.status === "approved").length}명 승인됨`, "♙")}${statCard("Active assignments", state.assignments.filter(isAssignmentCurrent).length, "현재 진행 중", "◷")}${statCard("Caregiver approvals", pendingCaregivers.length, "관리사 계정 검토 필요", "!")}</div>
        <article class="card card-pad management-directory member-governance"><div class="section-header"><div><p class="eyebrow">MEMBER DATABASE</p><h3>웹앱 회원 데이터베이스 관리</h3><p>권한 있는 운영 계정에서 회원 종류와 접근 상태를 관리합니다. 계정 보관은 운영 기록을 유지하면서 로그인과 데이터 접근을 차단합니다.</p></div><span class="status-chip">${activeMemberCount} active · ${visibleMembers.length} total</span></div><div class="management-list">${visibleMembers.length ? visibleMembers.map(memberAccountRowMarkup).join("") : `<div class="directory-empty"><strong>가입 회원이 없습니다.</strong></div>`}</div></article>
        ${pendingCaregivers.length ? `<article class="card card-pad approval-panel"><div class="section-header"><div><h3>승인 대기 관리사</h3><p>자격·경력 정보를 검토하고 인사정보를 보완한 후 승인하세요.</p></div><span class="status-chip coral">${pendingCaregivers.length} pending</span></div><div class="people-list">${pendingCaregivers.map((user) => `<div class="person-row pending-caregiver-row"><div class="mini-avatar">${escapeHtml(user.initials)}</div><div class="person-copy"><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email)} · ${escapeHtml(user.certification || "자격 정보 미입력")}</span></div><div class="management-actions"><button class="secondary-button mini-button" data-manage-caregiver="${user.id}">프로필 검토</button><button class="primary-button mini-button" data-approve-user="${user.id}">관리사 승인</button></div></div>`).join("")}</div></article>` : `<div class="status-banner success">✓ 현재 승인 대기 중인 관리사가 없습니다.</div>`}
        <article class="card card-pad management-directory"><div class="section-header"><div><p class="eyebrow">CLIENT CRM</p><h3>고객·아기 관리</h3><p>고객·아기 이름 또는 관리 년월로 찾고 정렬해 상담·계약 정보를 관리합니다.</p></div><span class="status-chip">${clientCount}</span></div>${directoryToolbarMarkup("client", directory.clientQuery, directory.clientSort, directory.clientPageSize)}<div class="management-list">${clientPage.items.length ? clientPage.items.map(clientManagementRowMarkup).join("") : `<div class="directory-empty"><strong>검색 결과가 없습니다.</strong><span>검색어를 바꾸거나 초기화해 주세요.</span></div>`}</div>${directoryPaginationMarkup("client", clientPage)}</article>
        <article class="card card-pad management-directory"><div class="section-header"><div><p class="eyebrow">CAREGIVER HR</p><h3>관리사 인사관리</h3><p>이름, 입사년월, 거주지역 기준으로 관리사를 빠르게 찾고 정렬합니다.</p></div><span class="status-chip">${caregiverCount}</span></div>${directoryToolbarMarkup("caregiver", directory.caregiverQuery, directory.caregiverSort, directory.caregiverPageSize)}<div class="management-list">${caregiverPage.items.length ? caregiverPage.items.map(caregiverManagementRowMarkup).join("") : `<div class="directory-empty"><strong>검색 결과가 없습니다.</strong><span>검색어를 바꾸거나 초기화해 주세요.</span></div>`}</div>${directoryPaginationMarkup("caregiver", caregiverPage)}</article>
      </section>`;
  }

  function serviceWorkspaceTabsMarkup(role, serviceType, activeTab) {
    const tabs = role === "client"
      ? (serviceType === "BABYSITTING" ? [["summary", "오늘의 시팅"], ["timeline", "시팅 타임라인"]] : [["summary", "오늘의 요약"], ["timeline", "케어 타임라인"], ["charts", "관리 차트"]])
      : (serviceType === "BABYSITTING" ? [["today", "오늘의 시팅"], ["timeline", "시팅 기록"]] : [["today", "오늘의 케어"], ["timeline", "케어 기록"], ["charts", "관리 차트"]]);
    return `<div class="service-workspace-nav ${serviceMetaFor(serviceType).tone}"><div>${serviceBadgeMarkup(serviceType)}<strong>${role === "client" ? "나의 서비스 상세" : "나의 케어기빙 상세"}</strong></div><div role="tablist" aria-label="${serviceMetaFor(serviceType).label} 상세 메뉴">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${activeTab === id}" class="${activeTab === id ? "active" : ""}" data-service-tab="${id}" data-service-type="${serviceType}">${label}</button>`).join("")}</div></div>`;
  }

  function caregiverServiceOverviewCard(user, serviceType) {
    const current = currentAssignmentFor(user.id, serviceType);
    const next = nextAssignmentFor(user.id, serviceType);
    const meta = serviceMetaFor(serviceType);
    const primary = current || next;
    if (!primary) return `<article class="card service-overview-card empty ${meta.tone}"><div class="service-overview-icon">${meta.icon}</div><div>${serviceBadgeMarkup(serviceType)}<h3>현재 담당 중인 ${meta.label} 케어기빙이 없습니다.</h3><p>관리자가 승인된 고객 신청을 배정하면 이 영역에 표시됩니다.</p></div><button class="secondary-button" data-enter-caregiver-service="${serviceType}">작업공간 확인</button></article>`;
    const client = clientById(primary.clientId);
    if (!client) return `<article class="card service-overview-card empty ${meta.tone}"><div class="service-overview-icon">!</div><div>${serviceBadgeMarkup(serviceType)}<h3>배정 고객 정보를 확인할 수 없습니다.</h3><p>개인정보 보호 또는 데이터 연결 상태를 관리자가 확인해야 합니다.</p></div></article>`;
    const babyName = babyNameFor(primary, client) || "아이";
    return `<article class="card service-overview-card ${meta.tone}"><div class="service-overview-top"><div>${serviceBadgeMarkup(serviceType)}<h3>${current ? "현재 담당 중" : "다음 배정 예정"}</h3></div><span class="status-chip ${current ? "" : "gold"}">${assignmentCountdown(primary)}</span></div><strong class="service-overview-family">${escapeHtml(client.motherName)} · ${escapeHtml(babyName)}</strong><p>${new Date(primary.startAt).toLocaleDateString("ko-KR")}–${new Date(primary.endAt).toLocaleDateString("ko-KR")} · ${primary.dailyStart}–${primary.dailyEnd}</p><div class="service-overview-actions"><button class="primary-button" data-enter-caregiver-service="${serviceType}">${meta.label} 작업공간</button><button class="secondary-button" data-caregiver-assignment-detail="${primary.id}">고객 정보</button></div></article>`;
  }

  function caregiverCaregivingHub() {
    const user = authUser();
    const activeAssignments = state.assignments.filter((assignment) => assignment.caregiverUserId === user.id && isAssignmentCurrent(assignment));
    const upcomingAssignments = state.assignments.filter((assignment) => assignment.caregiverUserId === user.id && assignment.status !== "CANCELLED" && new Date(assignment.startAt) > new Date());
    const retrospectiveAssignments = retrospectiveAssignmentsFor(user.id);
    return `<section class="page service-hub-page">${demoBanner()}${pageHeading("MY CAREGIVING", "나의 케어기빙 현황", "산후조리와 베이비시팅 배정을 분리해 확인하고 각 작업공간으로 이동합니다.")}<div class="grid stats">${statCard("Current", activeAssignments.length, "현재 진행 중인 전체 배정", "◷")}${statCard("Postpartum", activeAssignments.filter((item) => assignmentServiceType(item) === "POSTPARTUM").length, "산후조리 진행 중", "♡")}${statCard("Babysitting", activeAssignments.filter((item) => assignmentServiceType(item) === "BABYSITTING").length, "베이비시팅 진행 중", "☆")}${statCard("Employment", "W-2", "보험 적용 정식 직원", "◈")}</div><div class="service-overview-grid" style="margin-top:18px">${caregiverServiceOverviewCard(user, "POSTPARTUM")}${caregiverServiceOverviewCard(user, "BABYSITTING")}</div><article class="card card-pad retrospective-entry-card" style="margin-top:18px"><div><p class="eyebrow">RETROSPECTIVE CARE RECORD</p><h3>지난 근무 리포트 보완</h3><p>웹 기록을 놓친 실제 근무를 소급 입력할 수 있습니다. 서비스 날짜와 실제 근무시간은 그대로 기록되고, 입력자와 뒤늦게 입력한 시각은 감사 이력에 별도로 남습니다.</p></div><button type="button" class="primary-button" data-open-retrospective-report ${retrospectiveAssignments.length ? "" : "disabled"}>지난 근무 리포트 입력</button></article><article class="card card-pad service-boundary-note" style="margin-top:18px"><strong>서비스별 기록·업무 범위</strong><p>산후조리에는 산모·신생아 케어와 차트만, 베이비시팅에는 식사·생활 이벤트만 표시됩니다. 의료행위와 무면허 마사지는 업무 범위에 포함되지 않으며, 프리미엄 산모 마사지는 향후 조지아주 라이선스 보유 전문가에게만 별도 배정됩니다.</p></article></section>`;
  }

  function retrospectiveAssignmentsFor(userId) {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    return state.assignments
      .filter((assignment) => assignment.caregiverUserId === userId
        && assignment.status !== "CANCELLED"
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
    const client = clientById(assignment.clientId);
    if (!client) return `<div class="assignment-peek-card empty"><span class="peek-label">${label}</span><strong>고객 정보 확인 필요</strong><small>관리자에게 배정 데이터 연결 상태를 문의해 주세요.</small></div>`;
    const babyName = babyNameFor(assignment, client) || "아이";
    return `<button type="button" class="assignment-peek-card ${serviceMetaFor(assignment.serviceType).tone}" data-caregiver-assignment-detail="${assignment.id}"><span class="peek-top"><span class="peek-label">${label}</span><span class="status-chip ${new Date(assignment.startAt) > new Date() ? "gold" : ""}">${assignmentCountdown(assignment)}</span></span>${serviceBadgeMarkup(assignment.serviceType)}<strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyName)}</strong><small>${new Date(assignment.startAt).toLocaleDateString("ko-KR")}–${new Date(assignment.endAt).toLocaleDateString("ko-KR")} · ${assignment.dailyStart}–${assignment.dailyEnd}</small><span class="peek-link">고객 정보 확인 →</span></button>`;
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
    return `<article class="card card-pad shift-checklist-card" style="margin-top:18px"><div class="section-header"><div><p class="eyebrow">PRE-SHIFT CHECK</p><h3>근무 전 안전 체크</h3><p>매 방문마다 확인 상태가 해당 배정에 저장됩니다.</p></div><span class="status-chip ${completed === items.length ? "" : "gold"}">${completed}/${items.length} 완료</span></div><div class="shift-check-list">${items.map(([id, title, detail]) => `<label><input type="checkbox" data-shift-check="${assignment.id}" data-check-id="${id}" ${saved[id] ? "checked" : ""}/><span>✓</span><div><strong>${title}</strong><small>${detail}</small></div></label>`).join("")}</div></article>`;
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
    return `<section class="page babysitting-workspace">${demoBanner()}${workspaceNav}${pageHeading("BABYSITTING WORKSPACE", `안녕하세요, ${escapeHtml(user.fullName)}님.`, `${escapeHtml(client.motherName)} 보호자의 ${escapeHtml(babyName)} 아이에게 배정된 베이비시팅 화면입니다.`)}<article class="card babysitting-hero"><div><div class="hero-care-top"><div>${serviceBadgeMarkup("BABYSITTING")}<p class="eyebrow">TODAY'S SITTING</p><h3>${escapeHtml(babyName)}</h3><p>${assignment.dailyStart}–${assignment.dailyEnd} · ${escapeHtml(assignment.address)}</p></div><div class="live-pill"><span class="live-dot"></span>${staleSession ? "CLOSE PREVIOUS SESSION" : active ? "SITTING IN PROGRESS" : completedToday ? "TODAY COMPLETED" : "SESSION READY"}</div></div><div class="assignment-brief"><span>보호자 ${escapeHtml(client.motherName)}</span><span>알러지 ${escapeHtml(assignment.allergies)}</span><span>추가인원 ${assignment.extraHouseholdMembers}명</span><span>${assignment.weeks}주 일정</span></div><div class="care-actions">${active ? `<button class="primary-button" data-notice="${sitterEvents.length}개의 해당 근무일 시팅 기록이 저장되어 있습니다.">시팅 진행 중 · ${timeLabel(state.session.startedAt)}</button><button class="secondary-button" data-end-care>시팅 종료</button>` : completedToday ? '<button class="secondary-button" disabled>오늘 시팅 완료</button>' : `<button class="primary-button" data-start-care data-assignment-id="${assignment.id}">시팅 시작하기</button>`}<button class="secondary-button" data-caregiver-assignment-detail="${assignment.id}">아이 상세정보</button></div></div></article>${staleSessionBannerMarkup()}<div class="assignment-peek-grid" style="margin-top:18px">${caregiverAssignmentPeekMarkup(assignment, "현재 시팅")}${caregiverAssignmentPeekMarkup(nextAssignment, "다음 일정")}</div>${staleSession ? "" : caregiverSafetyChecklistMarkup(assignment)}<div class="grid two babysitting-guide-grid" style="margin-top:18px"><article class="card card-pad"><div class="section-header"><div><h3>식사·안전 지침</h3><p>보호자가 신청 시 전달한 내용</p></div><span class="status-chip coral">확인 필수</span></div><dl class="sitting-instructions"><div><dt>알러지</dt><dd>${escapeHtml(assignment.allergies || "없음")}</dd></div><div><dt>식사·간식</dt><dd>${escapeHtml(assignment.mealInstructions || "별도 지침 없음")}</dd></div><div><dt>생활 루틴</dt><dd>${escapeHtml(assignment.routineNotes || "별도 지침 없음")}</dd></div><div><dt>인계·출입</dt><dd>${escapeHtml(assignment.pickupNotes || "별도 지침 없음")}</dd></div></dl></article><article class="card quick-log-card sitter-quick-card"><div class="section-header"><div><h3>빠른 시팅 기록</h3><p>식사와 주요 이벤트만 간단히 공유</p></div><span class="status-chip ${canLog ? "" : "gold"}">${canLog ? "기록 가능" : staleSession ? "이전 근무 종료 필요" : completedToday ? "오늘 기록 완료" : "시팅 시작 필요"}</span></div><div class="quick-log-grid sitter-grid">${["meal", "sitter_note"].map((type) => { const meta = EVENT_META[type]; return `<button class="quick-button" data-log-type="${type}" ${canLog ? "" : "disabled"}><span class="quick-icon">${meta.icon}</span><span>${meta.label}</span></button>`; }).join("")}</div>${canLog ? "" : `<p class="session-hint">${staleSession ? "이전 근무 세션을 종료하면 오늘 일정으로 진행할 수 있습니다." : completedToday ? "오늘 시팅이 종료되어 기록이 잠겼습니다." : "‘시팅 시작하기’를 누르면 기록할 수 있습니다."}</p>`}</article></div><article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>${staleSession ? "미종료 근무일" : "오늘의"} 식사·이벤트</h3><p>${sitterEvents.length}개의 베이비시팅 기록</p></div><button class="text-button" data-service-tab="timeline" data-service-type="BABYSITTING">전체 보기 →</button></div>${timelineMarkup(6, assignment)}</article></section>`;
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
        ${pageHeading("CAREGIVER WORKSPACE", `안녕하세요, ${escapeHtml(user.fullName)}님.`, `배정된 ${escapeHtml(client.motherName)} 산모와 ${escapeHtml(babyName)} 아기의 정보만 접근할 수 있습니다.`)}
        <article class="card hero-care">
          <div class="hero-care-top">
            <div><p class="eyebrow">TODAY'S ASSIGNMENT</p><h3>${escapeHtml(babyName)}</h3><p>${assignment.dailyStart} – ${assignment.dailyEnd} · ${escapeHtml(assignment.address)}</p></div>
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

        <article class="card quick-log-card" style="margin-top:18px">
          <div class="section-header"><div><h3>빠른 기록</h3><p>자주 쓰는 항목만 간단하게</p></div><span class="status-chip ${canLog ? "" : "gold"}">${canLog ? "기록 가능" : staleSession ? "이전 근무 종료 필요" : "세션 시작 필요"}</span></div>
          <div class="quick-log-grid">
            ${Object.entries(EVENT_META).filter(([type]) => !["meal", "sitter_note"].includes(type))
              .map(
                ([type, meta]) => `<button class="quick-button" data-log-type="${type}" ${canLog ? "" : "disabled"}><span class="quick-icon">${meta.icon}</span><span>${meta.label}</span></button>`,
              )
              .join("")}
          </div>
          ${canLog ? "" : `<p class="session-hint">${staleSession ? "이전 근무 세션을 종료하면 오늘 일정으로 진행할 수 있습니다." : "위의 ‘케어 시작하기’를 누르면 기록 버튼이 활성화됩니다."}</p>`}
        </article>

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
        const methods = { breast: "직접 수유", pumped: "유축 모유", formula: "분유" };
        const amount = data.amount ? ` · ${data.amount}ml` : data.duration ? ` · ${data.duration}분` : "";
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
        return `${Number(data.value).toFixed(1)}℃ · ${Number(data.value) >= 37.5 ? "확인 필요" : "정상 범위"}`;
      case "bath":
        return `${data.bathType || "목욕"}${data.waterTemperature ? ` · 물 온도 ${Number(data.waterTemperature).toFixed(1)}℃` : ""}${data.note ? ` · ${data.note}` : ""}`;
      case "weight":
        return `${Number(data.value).toFixed(2)}kg · 성장 기록`;
      case "mother":
        return `${data.care || "산모 케어"}${data.note ? ` · ${data.note}` : ""}`;
      case "note":
        return data.text || "메모가 기록되었습니다.";
      case "meal":
        return `${data.mealType || "식사"} · ${data.menu || "메뉴 기록"} · ${data.appetite || "식사량 확인"}${data.note ? ` · ${data.note}` : ""}`;
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
        return `
          <div class="timeline-item">
            <div class="timeline-time">${timeLabel(event.at)}</div>
            <div class="timeline-icon">${meta.icon}</div>
            <div class="timeline-copy"><strong>${meta.label}</strong><span>${escapeHtml(eventDescription(event))}</span></div>
            <div class="timeline-author">${escapeHtml(event.author)}</div>
          </div>`;
      })
      .join("")}</div>`;
  }

  function caregiverTimeline(serviceType = "POSTPARTUM", workspaceNav = "") {
    const assignment = currentAssignmentFor(authUser().id, serviceType);
    const client = assignment ? clientById(assignment.clientId) : null;
    const babysitting = serviceType === "BABYSITTING";
    const babyName = assignment && client ? babyNameFor(assignment, client) : "";
    return `
      <section class="page">
        ${demoBanner()}
        ${workspaceNav}
        ${pageHeading(babysitting ? "SITTING EVENTS" : "CARE EVENTS", babysitting ? "오늘의 시팅 기록" : "오늘의 케어 기록", babysitting ? "아이의 식사와 놀이·산책·생활 이벤트를 시간순으로 공유합니다." : "수유·기저귀·수면처럼 반복되는 활동을 각각의 시간 기반 이벤트로 기록합니다.")}
        <article class="card card-pad">
          <div class="section-header"><div><h3>${escapeHtml(babyName || "배정 대기")}</h3><p>${visibleCareEvents(assignment).length}개의 접근 가능한 이벤트 · ${todayLabel()}</p></div><span class="status-chip">배정 권한 적용</span></div>
          ${timelineMarkup(undefined, assignment)}
        </article>
      </section>`;
  }

  function caregiverProfile() {
    const user = authUser();
    const assignment = currentAssignmentFor(user.id);
    const client = assignment ? clientById(assignment.clientId) : null;
    const currentBabyName = assignment && client ? babyNameFor(assignment, client) : "";
    const upcoming = state.assignments.filter((item) => item.caregiverUserId === user.id && item.status !== "CANCELLED" && new Date(item.startAt) > new Date()).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    const shownUpcoming = upcoming.slice(0, 5);
    const caregiverReviews = state.reviews.filter((review) => review.caregiverUserId === user.id);
    const reviewAverage = caregiverReviews.length ? (caregiverReviews.reduce((sum, review) => sum + Number(review.rating), 0) / caregiverReviews.length).toFixed(1) : null;
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
            <div class="quality-metrics"><div><span>이번 주 리포트</span><strong>4/4</strong><small>모든 리포트 제출 완료</small></div><div><span>고객 후기</span><strong>${reviewAverage ? `${reviewAverage} / 5.0` : "후기 대기"}</strong><small>${caregiverReviews.length}건의 완료 서비스 후기</small></div></div>
          </article>
        </div>
        <article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>예정된 배정</h3><p>서비스 종류를 구분해 최대 5개의 다음 일정과 고객 준비정보를 확인합니다.</p></div><span class="status-chip gold">${shownUpcoming.length} / ${upcoming.length} upcoming</span></div><div class="assignment-list">${shownUpcoming.length ? shownUpcoming.map((item, index) => { const upcomingClient = clientById(item.clientId); const upcomingBabyName = upcomingClient ? babyNameFor(item, upcomingClient) : ""; return upcomingClient ? `<button type="button" class="assignment-row caregiver-upcoming-row assignment-detail-button" data-caregiver-assignment-detail="${item.id}"><span>${serviceBadgeMarkup(item.serviceType)}<strong>${escapeHtml(upcomingClient.motherName)} · ${escapeHtml(upcomingBabyName || "아이")}</strong><span>${new Date(item.startAt).toLocaleDateString("ko-KR")}–${new Date(item.endAt).toLocaleDateString("ko-KR")} · ${item.weeks}주</span></span><span><strong>${item.dailyStart}–${item.dailyEnd}</strong><span>방문 시간</span></span><span><strong>${escapeHtml(item.address)}</strong><span>${index === 0 ? "가장 가까운 다음 일정" : "클릭하여 고객 준비정보 확인"}</span></span><span class="status-chip gold">${assignmentCountdown(item)}</span></button>` : `<div class="assignment-row"><div><strong>고객 정보 연결 확인 필요</strong><span>${formatDate(item.startAt)} 시작 예정</span></div><span class="status-chip coral">관리자 확인</span></div>`; }).join("") : `<div class="empty-state"><strong>예정된 배정이 없습니다.</strong></div>`}</div></article>
      </section>`;
  }

  function summaryStats(assignment = null) {
    const visibleEvents = visibleCareEvents(assignment);
    const feeding = visibleEvents.filter((event) => event.type === "feeding");
    const diapers = visibleEvents.filter((event) => event.type === "diaper");
    const sleeps = visibleEvents.filter((event) => event.type === "sleep");
    const temperatures = visibleEvents.filter((event) => event.type === "temperature");
    return {
      feedCount: feeding.length,
      feedAmount: feeding.reduce((sum, event) => sum + (Number(event.data.amount) || 0), 0),
      sleepMinutes: sleeps.reduce((sum, event) => sum + (Number(event.data.duration) || 0), 0),
      urineCount: diapers.filter((event) => event.data.urine && event.data.urine !== "none").length,
      stoolCount: diapers.filter((event) => event.data.stool && event.data.stool !== "none").length,
      latestTemp: temperatures.length ? temperatures.sort((a, b) => new Date(b.at) - new Date(a.at))[0].data.value : null,
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

  function assignmentHasCompletedCare(assignment) {
    return assignment.status === "COMPLETED" || new Date(assignment.endAt) < new Date();
  }

  function clientServiceReviewMarkup(client, serviceType = null, assignmentOverride = null) {
    if (!client) return "";
    const assignments = state.assignments.filter((assignment) => assignment.clientId === client.id && assignment.status !== "CANCELLED" && new Date(assignment.startAt) <= new Date() && (!serviceType || assignmentServiceType(assignment) === serviceType) && (!assignmentOverride || assignment.id === assignmentOverride.id)).sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    if (!assignments.length) return "";
    const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
    const existingReviews = state.reviews.filter((review) => review.clientId === client.id && assignmentIds.has(review.assignmentId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const reviewable = assignments.find((assignment) => assignmentHasCompletedCare(assignment) && !state.reviews.some((review) => review.assignmentId === assignment.id));
    const assignment = reviewable || assignments[0];
    const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId);
    const existing = state.reviews.find((review) => review.assignmentId === assignment.id) || existingReviews[0];
    if (existing) {
      const reviewedCaregiver = state.users.find((user) => user.id === existing.caregiverUserId);
      return `<article class="card service-review-card completed"><div class="review-icon">✓</div><div><p class="eyebrow">SERVICE REVIEW COMPLETED</p><h3>${escapeHtml(reviewedCaregiver?.fullName || "담당 관리사")} 관리사 후기</h3><div class="review-stars" aria-label="별점 ${existing.rating}점">${"★".repeat(Number(existing.rating))}${"☆".repeat(5 - Number(existing.rating))}</div><p>${escapeHtml(existing.comment || "소중한 후기가 등록되었습니다.")}</p><small>${new Date(existing.createdAt).toLocaleDateString("ko-KR")} 작성 · 동일 배정에는 후기를 한 번만 작성할 수 있습니다.</small></div></article>`;
    }
    const available = assignmentHasCompletedCare(assignment);
    return `<article class="card service-review-card ${available ? "ready" : "locked"}"><div class="review-icon">${available ? "♡" : "◷"}</div><div><p class="eyebrow">SERVICE REVIEW</p><h3>${escapeHtml(caregiver?.fullName || "담당 관리사")} 관리사 후기를 남겨주세요.</h3><p>${available ? "종료된 서비스 경험을 바탕으로 서비스 품질 향상에 도움이 되는 후기를 한 번 작성할 수 있습니다." : "서비스 계약·배정 기간이 종료되면 담당 관리사에 대한 후기 작성이 활성화됩니다."}</p></div>${available ? `<button type="button" class="primary-button" data-open-review="${assignment.id}">후기 작성</button>` : `<span class="status-chip gold">계약·배정 종료 후 가능</span>`}</article>`;
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
      return `<article class="card service-overview-card empty ${meta.tone}"><div class="service-overview-icon">${meta.icon}</div><div>${serviceBadgeMarkup(serviceType)}<h3>${requestStatus ? `${escapeHtml(requestBabyName)} · ${requestStatus}` : `현재 이용중인 ${meta.label} 서비스가 없습니다.`}</h3><p>${requestStatus ? `${request.weeks}주 · ${formatDate(request.desiredStartDate)} 시작 희망 · ${request.dailyStart}–${request.dailyEnd}` : (babysittingBlocked ? "동일 아기가 산후조리를 이용 중인 동안에는 베이비시팅을 신청할 수 없습니다." : serviceType === "BABYSITTING" ? "산후조리 이용 여부와 관계없이 별도의 서비스로 신청할 수 있습니다." : "필요한 경우 별도의 서비스 신청서를 접수할 수 있습니다.")}</p>${adjustment ? `<small class="adjustment-state">변경·취소 요청 관리자 검토 중</small>` : ""}${extensionPending ? `<small class="adjustment-state">기간 연장 신청 관리자 검토 중</small>` : ""}</div><div class="service-overview-actions">${requestStatus ? `<span class="status-chip ${request.status === "PENDING" ? "gold" : ""}">${requestStatus}</span>${canAdjustRequest ? `<button class="secondary-button" data-service-adjust="REQUEST:${request.id}" ${adjustment ? "disabled" : ""}>${adjustment ? "요청 검토 중" : "신청 변경·취소"}</button>` : ""}` : `<button class="primary-button" data-service-apply="${serviceType}" ${babysittingBlocked ? "disabled" : ""}>${babysittingBlocked ? "산후조리 이용 중 신청 불가" : `${meta.label} 신청`}</button>`}</div></article>`;
    }
    const caregiver = state.users.find((user) => user.id === assignment.caregiverUserId);
    const status = isAssignmentCurrent(assignment) ? "이용 중" : new Date(assignment.startAt) > new Date() ? "시작 예정" : "이용 완료";
    const adjustment = pendingAdjustment("ASSIGNMENT", assignment.id);
    return `<article class="card service-overview-card ${meta.tone}"><div class="service-overview-top"><div>${serviceBadgeMarkup(serviceType)}<h3>${status}</h3></div><span class="status-chip ${status === "이용 중" ? "" : "gold"}">${assignmentCountdown(assignment)}</span></div><strong class="service-overview-family">${escapeHtml(client.motherName)} · ${escapeHtml(babyNameFor(assignment, client) || "아이")}</strong><p>${new Date(assignment.startAt).toLocaleDateString("ko-KR")}–${new Date(assignment.endAt).toLocaleDateString("ko-KR")} · ${assignment.dailyStart}–${assignment.dailyEnd}</p><div class="service-overview-meta"><span>담당 ${escapeHtml(caregiver?.fullName || "배정 대기")}</span><span>${escapeHtml(assignment.address)}</span>${serviceType === "POSTPARTUM" ? `<span>예약금 $${Number(assignment.depositAmount || POSTPARTUM_DEPOSIT).toLocaleString("en-US")} 납부 · 계약 $${Number(assignment.contractValue || postpartumEstimate(assignment.weeks)).toLocaleString("en-US")}</span>` : ""}</div>${adjustment ? `<small class="adjustment-state">변경·취소 요청 관리자 검토 중</small>` : ""}${extensionPending ? `<small class="adjustment-state">기간 연장 신청 관리자 검토 중</small>` : ""}<div class="service-overview-actions"><button class="primary-button" data-enter-client-service="${serviceType}" data-assignment-id="${assignment.id}">${serviceType === "BABYSITTING" ? "나의 베이비시팅" : "나의 산후조리"} 보기</button><button class="secondary-button" data-service-adjust="ASSIGNMENT:${assignment.id}" ${adjustment ? "disabled" : ""}>${adjustment ? "요청 검토 중" : "일정 변경·취소"}</button>${serviceType === "BABYSITTING" ? `<button class="secondary-button" data-service-extend="${assignment.id}" ${extensionPending ? "disabled" : ""}>${extensionPending ? "연장 검토 중" : "기간 연장 신청"}</button>` : ""}</div></article>`;
  }

  function clientServicesHub() {
    const client = clientForUser(authUser().id);
    if (!client) return `<section class="page">${demoBanner()}<div class="empty-state"><strong>고객 정보를 찾을 수 없습니다.</strong></div></section>`;
    const currentService = clientCurrentService(client.id);
    const activeCount = state.assignments.filter((assignment) => assignment.clientId === client.id && isAssignmentCurrent(assignment)).length;
    const pendingCount = state.serviceRequests.filter((request) => request.clientId === client.id && (request.status === "PENDING" || (request.status === "APPROVED" && !request.approvedAssignmentId))).length;
    const postpartumAssignments = currentAndUpcomingAssignmentsForClient(client.id, "POSTPARTUM");
    const babysittingAssignments = currentAndUpcomingAssignmentsForClient(client.id, "BABYSITTING");
    const openRequests = state.serviceRequests.filter((request) => request.clientId === client.id && ["PENDING", "APPROVED"].includes(request.status) && !request.approvedAssignmentId);
    const postpartumRequests = openRequests.filter((request) => assignmentServiceType(request) === "POSTPARTUM");
    const babysittingRequests = openRequests.filter((request) => assignmentServiceType(request) === "BABYSITTING");
    const postpartumCards = [...postpartumAssignments.map((assignment) => clientServiceOverviewCard(client, "POSTPARTUM", assignment)), ...postpartumRequests.map((request) => clientServiceOverviewCard(client, "POSTPARTUM", null, request))];
    const babysittingCards = [...babysittingAssignments.map((assignment) => clientServiceOverviewCard(client, "BABYSITTING", assignment)), ...babysittingRequests.map((request) => clientServiceOverviewCard(client, "BABYSITTING", null, request))];
    const massage = state.serviceCatalog.MASSAGE;
    const profileSetup = clientProfileComplete(client) ? "" : `<article class="card client-profile-onboarding"><div><p class="eyebrow">PROFILE SETUP</p><h3>서비스 신청 전에 가족 프로필을 완성해 주세요.</h3><p>아기 이름·출생일 또는 예정일과 기본 서비스 주소를 한 번 저장하면 신청서에 자동으로 불러옵니다.</p></div><button class="primary-button" type="button" data-edit-profile>고객·아기 프로필 작성</button></article>`;
    return `<section class="page service-hub-page">${demoBanner()}${pageHeading("MY SERVICES", `${escapeHtml(client.motherName)}님의 서비스`, "아기별 이용 중인 돌봄과 신청·배정 상태를 한눈에 확인하세요.")}${profileSetup}<div class="grid stats">${statCard("Active service", activeCount, "현재 진행 중인 전체 배정", "✓")}${statCard("Current service", activeCount > 1 ? `${activeCount}건 이용 중` : currentService ? serviceMetaFor(currentService).label : "대기", "아기별 현재 돌봄", currentService === "BABYSITTING" ? "☆" : "♡")}${statCard("Pending requests", pendingCount ? `${pendingCount}건` : "없음", "승인·일정 배정 대기", "◷")}</div><div class="service-overview-grid" style="margin-top:18px">${postpartumCards.length ? postpartumCards.join("") : clientServiceOverviewCard(client, "POSTPARTUM")}${babysittingCards.length ? babysittingCards.join("") : clientServiceOverviewCard(client, "BABYSITTING")}</div><div style="margin-top:18px">${clientPublishedReportsMarkup(client.id, null, true)}</div><article class="card premium-addon-card" style="margin-top:18px"><div class="premium-addon-icon">${massage.icon}</div><div><p class="eyebrow">PREMIUM ADD-ON · COMING SOON</p><h3>${massage.label}</h3><p>${massage.description}. 현재는 신청할 수 없으며, 라이선스·보험·전문인력 검증이 완료된 뒤 산후조리 계약의 추가 상품으로 열립니다.</p><div class="premium-addon-tags"><span>Georgia License 필수</span><span>산후조리 Add-on</span><span>현재 선택 불가</span></div></div><button class="secondary-button" disabled>준비 중</button></article><article class="card card-pad service-boundary-note" style="margin-top:18px"><strong>동일 아기의 겹치는 서비스만 자동으로 차단합니다.</strong><p>베이비시팅은 산후조리 이용 이력 없이도 독립적으로 신청할 수 있습니다. 다만 동일 아기가 산후조리를 현재 이용 중일 때는 베이비시팅 신규 신청이 제한되며, 두 서비스 기간은 서로 겹칠 수 없습니다.</p></article></section>`;
  }

  function clientBabysittingSummary(client, assignment, workspaceNav = "") {
    const babyName = babyNameFor(assignment, client) || "아이";
    const caregiver = state.users.find((item) => item.id === assignment.caregiverUserId);
    const events = visibleCareEvents(assignment).filter((event) => ["meal", "sitter_note"].includes(event.type));
    const meals = events.filter((event) => event.type === "meal");
    const notes = events.filter((event) => event.type === "sitter_note");
    return `<section class="page babysitting-client-page">${demoBanner()}${workspaceNav}<article class="card client-hero babysitting-client-hero"><div class="client-hero-copy">${serviceBadgeMarkup("BABYSITTING")}<p class="eyebrow">${escapeHtml(babyName).toUpperCase()}'S SITTING · ${todayLabel()}</p><h3>${escapeHtml(babyName)}의 오늘이 편안하게 이어지고 있어요. ☆</h3><p>담당 관리사가 공유한 식사와 놀이·산책·생활 이벤트를 간결하게 확인하세요.</p></div><div class="client-hero-art"><div class="baby-monogram">${escapeHtml(babyName[0] || "B")}</div></div></article><div class="grid three sitter-summary-grid" style="margin-top:18px">${summaryCard("🍽️", "식사·간식", `${meals.length}회`, meals.at(-1) ? eventDescription(meals.at(-1)) : "기록 전")}${summaryCard("☆", "생활 이벤트", `${notes.length}건`, notes.at(-1) ? eventDescription(notes.at(-1)) : "기록 전")}${summaryCard("♙", "담당 관리사", caregiver?.fullName || "배정 완료", `${assignment.dailyStart}–${assignment.dailyEnd}`)}</div>${clientServiceReviewMarkup(client, "BABYSITTING", assignment)}<article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>오늘의 시팅 기록</h3><p>식사와 주요 활동이 시간순으로 표시됩니다.</p></div><button class="text-button" data-service-tab="timeline" data-service-type="BABYSITTING">전체 보기 →</button></div>${timelineMarkup(undefined, assignment)}</article><div style="margin-top:18px">${clientPublishedReportsMarkup(client.id, "BABYSITTING")}</div></section>`;
  }

  function clientSummary(serviceType = "POSTPARTUM", workspaceNav = "") {
    const client = clientForUser(authUser().id);
    if (!client || !clientHasApprovedService(client.id, serviceType)) return clientServiceGateMarkup(client, serviceType, workspaceNav);
    const assignment = selectedClientAssignment(client.id, serviceType);
    if (serviceType === "BABYSITTING") return clientBabysittingSummary(client, assignment, workspaceNav);
    const babyName = babyNameFor(assignment, client) || "아기";
    const stats = summaryStats(assignment);
    const needsAttention = stats.latestTemp !== null && Number(stats.latestTemp) >= 37.5;
    return `
      <section class="page">
        ${demoBanner()}
        ${workspaceNav}
        <article class="card client-hero">
          <div class="client-hero-copy">
            <p class="eyebrow">${escapeHtml(babyName).toUpperCase()}'S DAY · ${todayLabel()}</p>
            <h3>${needsAttention ? "확인이 필요한 기록이 있어요." : `${escapeHtml(babyName)}는 오늘도 편안하게 지내고 있어요.`} ♡</h3>
            <p>관리사가 기록한 케어 활동을 이해하기 쉬운 요약으로 보여드립니다. 모든 수치는 오늘의 기록을 기준으로 자동 계산됩니다.</p>
          </div>
          <div class="client-hero-art"><div class="baby-monogram">${escapeHtml(babyName[0] || "B")}</div></div>
        </article>

        <div class="grid stats" style="margin-top:18px">
          ${summaryCard("🍼", "수유", `${stats.feedCount}회`, `총 ${stats.feedAmount} ml`)}
          ${summaryCard("☾", "수면", durationLabel(stats.sleepMinutes), "기록된 수면 시간")}
          ${summaryCard("🚼", "기저귀", `${stats.urineCount}회`, `대변 ${stats.stoolCount}회`)}
          ${summaryCard("🌡️", "체온", stats.latestTemp === null ? "기록 전" : `${Number(stats.latestTemp).toFixed(1)}℃`, needsAttention ? "관리자 확인 필요" : "정상 범위")}
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
    return `
      <section class="page">
        ${demoBanner()}
        ${workspaceNav}
        ${pageHeading(`${escapeHtml(babyName).toUpperCase()}'S ${babysitting ? "SITTING" : "CARE"} TIMELINE`, babysitting ? "오늘의 시팅 기록" : "오늘의 소중한 기록", babysitting ? `시간순으로 정리된 ${escapeHtml(babyName)}의 식사와 생활 이벤트입니다.` : `시간순으로 정리된 ${escapeHtml(babyName)}의 수유, 수면, 기저귀와 케어 활동입니다.`)}
        <article class="card card-pad"><div class="section-header"><div><h3>${todayLabel()}</h3><p>배정 관리사가 남긴 ${visibleCareEvents(assignment).length}개의 기록</p></div><span class="status-chip">본인 정보만 표시</span></div>${timelineMarkup(undefined, assignment)}</article>
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
    return `<div class="chart-legend"><span><i class="legend-swatch breast"></i>모유·유축</span><span><i class="legend-swatch formula"></i>분유</span><small>직접 수유는 입력된 ml만 합산됩니다.</small></div><div class="trend-chart-scroll"><div class="daily-bar-chart" style="--chart-days:${buckets.length};min-width:${Math.max(700, buckets.length * 42)}px">${daily.map((day) => `<div class="daily-bar-column" aria-label="${day.fullLabel} 모유 ${day.breast}ml, 분유 ${day.formula}ml"><span class="chart-value">${day.total || ""}</span><div class="stacked-bar-shell"><div class="stacked-bar ${day.total ? "" : "no-data"}" style="height:${day.total ? Math.max(4, (day.total / max) * 100) : 2}%">${day.total ? `<i class="bar-segment formula" style="flex:${day.formula}"></i><i class="bar-segment breast" style="flex:${day.breast}"></i>` : ""}</div></div><small>${day.shortLabel}</small></div>`).join("")}</div></div>`;
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
    const temperatures = periodEvents.filter((event) => event.type === "temperature").map((event) => Number(event.data.value)).filter(Number.isFinite);
    const sleeps = periodEvents.filter((event) => event.type === "sleep").reduce((sum, event) => sum + (Number(event.data.duration) || 0), 0);
    const weights = periodEvents.filter((event) => event.type === "weight").sort((a, b) => new Date(a.at) - new Date(b.at));
    return `<div class="chart-kpi-grid"><div><span>모유·유축</span><strong>${breast.toLocaleString()} ml</strong></div><div><span>분유</span><strong>${formula.toLocaleString()} ml</strong></div><div><span>평균 체온</span><strong>${temperatures.length ? `${(temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length).toFixed(1)}℃` : "기록 전"}</strong></div><div><span>총 수면</span><strong>${durationLabel(sleeps)}</strong></div><div><span>최근 체중</span><strong>${weights.length ? `${Number(weights.at(-1).data.value).toFixed(2)} kg` : "기록 전"}</strong></div></div>`;
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
      <article class="card chart-card wide"><div class="section-header"><div><h3>수유량</h3><p>일별 모유·유축과 분유 섭취량 · ml</p></div><span class="status-chip">${periodEvents.filter((event) => event.type === "feeding").length}회</span></div>${feedingTrendMarkup(buckets)}</article>
      <article class="card chart-card wide"><div class="section-header"><div><h3>체온 추이</h3><p>일별 평균 관찰 기록 · ℃</p></div><span class="status-chip ${temperatureEvents.some((event) => Number(event.data.value) >= 37.5) ? "coral" : ""}">${temperatureEvents.length ? `${Number(temperatureEvents.at(-1).data.value).toFixed(1)}℃` : "기록 전"}</span></div>${chartLineSvg(buckets, temperaturesByDay, { min: 35.5, max: 38, warning: 37.5, unit: "℃", decimals: 1, ariaLabel: `${chartBabyName} 체온 추이`, empty: "체온 기록이 아직 없습니다." })}</article>
      <article class="card chart-card wide"><div class="section-header"><div><h3>하루 수면 시간</h3><p>날짜별 기록된 총 수면 시간</p></div><span class="status-chip">${durationLabel(periodEvents.filter((event) => event.type === "sleep").reduce((sum, event) => sum + (Number(event.data.duration) || 0), 0))}</span></div>${sleepTrendMarkup(buckets)}</article>
      <article class="card chart-card wide"><div class="section-header"><div><h3>몸무게</h3><p>성장 추이 · kg</p></div><span class="status-chip">${latestWeight ? `${Number(latestWeight.data.value).toFixed(2)} kg` : "기록 전"}</span></div>${chartLineSvg(buckets, weightsByDay, { unit: "kg", decimals: 2, ariaLabel: `${chartBabyName} 몸무게 추이`, empty: "체중 기록이 아직 없습니다." })}</article>
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
    modalRoot.innerHTML = `<div class="modal-backdrop archived-report-backdrop" data-modal-backdrop><section class="modal archived-report-print" role="dialog" aria-modal="true" aria-labelledby="archived-report-title"><header class="modal-header"><div>${brandLogoMarkup()}<p class="eyebrow">PUBLISHED CARE REPORT</p><h3 id="archived-report-title">${escapeHtml(report.title)}</h3><p>발행 시점의 보관 리포트</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><div class="modal-form"><div class="request-review-grid"><div><span>서비스</span><strong>${escapeHtml(serviceMetaFor(serviceType).label)}</strong></div><div><span>서비스 날짜</span><strong>${snapshot.service_date ? formatDate(snapshot.service_date) : "기록 없음"}</strong></div><div><span>고객·아이</span><strong>${escapeHtml(snapshot.client_name || "고객")} · ${escapeHtml(snapshot.baby_name || "아이")}</strong></div><div><span>담당 관리사</span><strong>${escapeHtml(snapshot.caregiver_name || "관리사 정보 없음")}</strong></div><div><span>시작</span><strong>${escapeHtml(startedAt)}</strong></div><div><span>종료</span><strong>${escapeHtml(endedAt)}</strong></div></div><div class="privacy-boundary-note"><strong>불변 보관본</strong><span>아래 내용은 관리자가 리포트를 발행한 시점의 케어 세션과 이벤트 스냅샷입니다.</span></div><section class="archived-report-events"><div class="section-header"><div><h3>케어 기록</h3><p>${events.length}개의 발행 시점 기록</p></div></div>${events.length ? events.map(archivedReportEventMarkup).join("") : '<div class="empty-state"><strong>발행 시점에 저장된 케어 이벤트가 없습니다.</strong></div>'}</section><footer class="archived-report-meta">발행일 ${report.publishedAt ? new Date(report.publishedAt).toLocaleString("ko-KR") : "기록 없음"} · Report ID ${escapeHtml(report.id)}</footer><div class="form-actions archived-report-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="button" class="primary-button" data-print-archived-report>보관 리포트 인쇄</button></div></div></section></div>`;
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
    const allowedTabs = serviceType === "BABYSITTING" ? ["summary", "timeline"] : ["summary", "timeline", "charts"];
    const requested = state.serviceTabs.client[serviceType] || "summary";
    const activeTab = allowedTabs.includes(requested) ? requested : "summary";
    const workspaceNav = serviceWorkspaceTabsMarkup("client", serviceType, activeTab);
    if (activeTab === "timeline") return clientTimeline(serviceType, workspaceNav);
    if (activeTab === "charts") return clientCharts(serviceType, workspaceNav);
    return clientSummary(serviceType, workspaceNav);
  }

  function caregiverServiceWorkspace(serviceType) {
    const allowedTabs = serviceType === "BABYSITTING" ? ["today", "timeline"] : ["today", "timeline", "charts"];
    const requested = state.serviceTabs.caregiver[serviceType] || "today";
    const activeTab = allowedTabs.includes(requested) ? requested : "today";
    const workspaceNav = serviceWorkspaceTabsMarkup("caregiver", serviceType, activeTab);
    if (activeTab === "timeline") return caregiverTimeline(serviceType, workspaceNav);
    if (activeTab === "charts") return caregiverCharts(serviceType, workspaceNav);
    return caregiverToday(serviceType, workspaceNav);
  }

  function babysittingReportMarkup(client, assignment = null) {
    const events = state.events.filter((event) => event.clientId === client.id && (!assignment || event.assignmentId === assignment.id) && ["meal", "sitter_note"].includes(event.type)).sort((a, b) => new Date(b.at) - new Date(a.at));
    const mealCount = events.filter((event) => event.type === "meal").length;
    const noteCount = events.filter((event) => event.type === "sitter_note").length;
    return `<div class="babysitting-report">${serviceBadgeMarkup("BABYSITTING")}<div class="grid stats sitter-report-stats">${statCard("Meal records", mealCount, "식사·간식 기록", "🍽️")}${statCard("Activity notes", noteCount, "놀이·산책·생활", "☆")}${statCard("Recent records", events.slice(0, 7).length, "최근 7일 요약", "◷")}${statCard("Safety notes", events.filter((event) => event.data?.category === "안전 확인").length, "안전 확인 이벤트", "✓")}</div><article class="card card-pad" style="margin-top:18px"><div class="section-header"><div><h3>베이비시팅 식사·이벤트 리포트</h3><p>체온·몸무게·수면 차트 대신 보호자에게 필요한 생활 기록만 제공합니다.</p></div><span class="status-chip">${events.length} records</span></div>${events.length ? `<div class="timeline">${events.slice(0, 12).map((event) => { const meta = EVENT_META[event.type]; return `<div class="timeline-item"><div class="timeline-time">${new Date(event.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}<br/>${timeLabel(event.at)}</div><div class="timeline-icon">${meta.icon}</div><div class="timeline-copy"><strong>${meta.label}</strong><span>${escapeHtml(eventDescription(event))}</span></div><div class="timeline-author">${escapeHtml(event.author)}</div></div>`; }).join("")}</div>` : `<div class="empty-state"><strong>베이비시팅 기록이 아직 없습니다.</strong></div>`}</article></div>`;
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
      ? `<div class="timeline">${events.map((event) => { const meta = EVENT_META[event.type] || EVENT_META.note; return `<div class="timeline-item"><div class="timeline-time">${timeLabel(event.at)}</div><div class="timeline-icon">${meta.icon}</div><div class="timeline-copy"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(eventDescription(event))}</span></div><div class="timeline-author">${escapeHtml(event.author || "ProMoms")}</div></div>`; }).join("")}</div>`
      : '<div class="empty-state"><strong>선택한 방문에 저장된 케어 이벤트가 없습니다.</strong><span>빈 방문도 완료 이력 자체는 보관됩니다.</span></div>';
    const summary = serviceType === "BABYSITTING"
      ? `<div class="grid stats sitter-report-stats">${statCard("Meal records", events.filter((event) => event.type === "meal").length, "식사·간식 기록", "🍽️")}${statCard("Activity notes", events.filter((event) => event.type === "sitter_note").length, "놀이·산책·생활", "☆")}${statCard("Total records", events.length, "선택 방문 전체", "◷")}${statCard("Safety notes", events.filter((event) => event.data?.category === "안전 확인").length, "안전 확인 이벤트", "✓")}</div>`
      : careChartSummaryMarkup(events);
    return `<div class="care-session-report-preview">${serviceBadgeMarkup(serviceType)}<article class="card card-pad"><div class="section-header"><div><p class="eyebrow">EXACT VISIT PREVIEW</p><h3>${escapeHtml(babyName)} · ${serviceDate}</h3><p>선택한 완료 방문 1건의 기록만 표시합니다. 발행되는 불변 보관본과 동일한 범위입니다.</p></div><span class="status-chip">${events.length} records</span></div>${summary}<div class="section-header session-event-header"><div><h3>방문 상세 기록</h3><p>${session.startedAt ? `${new Date(session.startedAt).toLocaleString("ko-KR")} 시작` : "시작시간 기록 없음"}${session.endedAt ? ` · ${new Date(session.endedAt).toLocaleString("ko-KR")} 종료` : ""}</p></div></div>${eventList}</article></div>`;
  }

  function adminReports() {
    const reportAssignments = state.assignments
      .filter((assignment) => assignment.status !== "CANCELLED" && clientById(assignment.clientId))
      .sort((first, second) => new Date(second.startAt) - new Date(first.startAt));
    const assignment = reportAssignments.find((item) => item.id === state.adminSelectedAssignmentId)
      || reportAssignments.find((item) => item.clientId === state.adminSelectedClientId)
      || reportAssignments[0];
    const client = assignment ? clientById(assignment.clientId) : null;
    if (!assignment || !client) {
      return `<section class="page report-page">${demoBanner()}${pageHeading("CARE REPORTS", "전체 산모·아기 차트와 리포트", "서비스 고객과 케어 기록이 생성되면 리포트를 검토하고 전달할 수 있습니다.")}<article class="card card-pad"><div class="empty-state"><span class="empty-icon">◇</span><strong>리포트를 생성할 고객이 없습니다.</strong><span>회원 관리에서 고객 가입 상태를 확인하고, 승인된 서비스를 일정에 배치해 주세요.</span></div></article></section>`;
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
      ? `<div class="field"><label for="report-session">완료 방문 선택</label><select id="report-session" data-admin-report-session>${completedSessions.map((session) => { const alreadyPublished = state.reports.some((report) => report.careSessionId === session.id && report.status === "published"); return `<option value="${session.id}" ${session.id === reportSession?.id ? "selected" : ""}>${session.serviceDate ? formatDate(`${session.serviceDate}T12:00:00`) : "날짜 미등록"}${alreadyPublished ? " · 발행 완료" : " · 발행 대기"}</option>`; }).join("")}</select></div>`
      : '<div class="status-chip gold">완료된 방문 기록이 없습니다.</div>';
    const reportAction = publishedReport
      ? `<button class="primary-button" data-print-care-report="${publishedReport.id}">발행 완료 · 보관본 보기</button>`
      : reportSession
        ? `<button class="primary-button" data-publish-report="${assignment.id}" data-care-session-id="${reportSession.id}">리포트 생성·고객에게 보내기</button>`
        : '<span class="status-chip gold">완료된 케어 세션에서만 발행 가능</span>';
    return `<section class="page report-page">${demoBanner()}${pageHeading("CARE REPORTS", "전체 산모·아기 차트와 리포트", "관리자는 모든 고객 기록을 검토하고 승인 리포트를 고객 화면에 전달할 수 있습니다.")}
      <div class="report-toolbar card"><div class="field"><label for="report-assignment">서비스 배정 선택</label><select id="report-assignment" data-admin-assignment>${reportAssignments.map((item) => { const itemClient = clientById(item.clientId); const itemBabyName = babyNameFor(item, itemClient) || "아이"; return `<option value="${item.id}" ${item.id === assignment.id ? "selected" : ""}>${serviceMetaFor(item.serviceType).label} · ${escapeHtml(itemClient.motherName)} / ${escapeHtml(itemBabyName)} · ${formatDate(item.startAt)}</option>`; }).join("")}</select></div>${reportSessionOptions}<div class="report-actions"><button class="secondary-button" data-print-report>현재 화면 인쇄·PDF 저장</button>${reportAction}</div></div>
      <header class="print-report-header"><div class="brand-mark">${brandLogoMarkup()}</div><div><strong>ProMoms CARE REPORT</strong><span>${reportSession?.serviceDate ? formatDate(`${reportSession.serviceDate}T12:00:00`) : "완료 방문 선택 필요"} · ${escapeHtml(client.motherName)} / ${escapeHtml(reportBabyName)}</span></div></header>
      ${reportSession ? careSessionReportPreviewMarkup(client, assignment, reportSession) : '<article class="card card-pad"><div class="empty-state"><strong>발행할 완료 방문이 없습니다.</strong><span>관리사가 근무를 종료하면 방문별 검토 화면이 생성됩니다.</span></div></article>'}
      <article class="card report-note" style="margin-top:18px"><p>${babysitting ? `${escapeHtml(reportBabyName)}의 식사와 생활 이벤트 기록을 바탕으로 만든 베이비시팅 운영 리포트입니다.` : `${escapeHtml(reportBabyName)}의 수유·수면·체온 기록과 ${escapeHtml(client.motherName)}님의 산모 케어 기록을 바탕으로 만든 운영 리포트입니다. 의료 진단이 아니며, 우려되는 상태는 의료 전문가와 상의해야 합니다.`}</p><span>Reviewed by ProMoms Administrator</span></article>
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
        <section class="public-hero" id="home"><div class="public-hero-copy"><p class="eyebrow">ProMoms PROFESSIONAL FAMILY CARE</p><h1>회복의 시간부터<br/><em>아이의 일상까지.</em></h1><p>전문가의 믿음직한 손길과 엄마의 따뜻한 마음. 산후조리 케어, 베이비 케어, 맘스 뷰티를 ProMoms에서 만나보세요.</p><div class="public-hero-actions"><button class="primary-button public-cta" data-service-apply="${defaultApplicationType}">${defaultApplicationType === "BABYSITTING" ? "베이비시팅 미리 신청" : "서비스 신청하기"}</button><button class="secondary-button public-cta" data-public-anchor="services">서비스 살펴보기</button></div><div class="public-trust-row"><span>✓ 책임보상보험 운영 원칙</span><span>✓ 근로자재해보험 운영 원칙</span><span>✓ W-2 직접 고용 원칙</span><span>✓ 고객에게 고용 리스크 전가 없음</span></div></div><div class="public-hero-visual promoms-hero">${brandLogoMarkup(true)}<p class="promoms-brand-lines">POSTPARTUM CARE · BABY CARE · MOMS BEAUTY</p></div></section>
        <div class="public-content">${publicServiceStatusMarkup(user)}
          <section class="public-section public-about" id="about"><div class="public-section-heading"><p class="eyebrow">ABOUT ProMoms</p><h2>가족에게 필요한 케어를<br/>더 투명하고 책임 있게.</h2></div><div class="about-story"><p>ProMoms는 조지아 애틀랜타 메트로 지역의 가족을 중심으로 산모의 회복, 아이의 안전한 돌봄, 생활에 필요한 제품까지 연결하는 패밀리 웰니스 서비스입니다. W-2 직접 고용과 회사 차원의 책임보상보험·근로자재해보험 운영을 원칙으로 삼아 고객에게 고용 및 업무상 재해 리스크를 전가하지 않는 체계를 지향합니다.</p><div class="about-metrics"><div><strong>W-2</strong><span>직접 고용 운영 원칙</span></div><div><strong>Company</strong><span>보험 책임 회사 관리</span></div><div><strong>Atlanta</strong><span>메트로 지역 방문 케어</span></div></div></div></section>
          <section class="public-section" id="services"><div class="public-section-heading centered"><p class="eyebrow">OUR SERVICES</p><h2>가족에게 필요한 돌봄을 선택하세요.</h2><p>산후조리와 베이비시팅은 각각 독립적으로 신청할 수 있으며, 동일 아기의 서비스 기간만 겹치지 않도록 운영합니다.</p></div><div class="public-service-grid"><article class="public-service-card featured"><span class="service-number">01</span><div class="service-symbol">♡</div><p class="eyebrow">POSTPARTUM CARE</p><h3>산후조리 서비스</h3><p>산모 회복 지원과 신생아 수유·수면·체온·목욕·체중 기록을 세심하게 관리합니다.</p><ul><li>2·3·4주 맞춤 일정</li><li>산모 식사·휴식·회복 지원</li><li>신생아 케어 기록과 주간 차트</li><li>보험 적용·W-2 정식 직원 운영 원칙</li></ul><div class="service-price"><span>2주 기본 패키지</span><strong>$3,600<small> · 주 $1,800</small></strong></div><button class="primary-button" data-service-apply="POSTPARTUM">산후조리 신청</button></article><article class="public-service-card"><span class="service-number">02</span><div class="service-symbol">☆</div><p class="eyebrow">BABYSITTING</p><h3>베이비시팅 서비스</h3><p>아이의 식사와 한국형 이유식·유아식, 놀이·산책과 생활 이벤트를 보호자에게 정확하게 공유합니다.</p><ul><li>보험 적용·W-2 정식 직원 운영 원칙</li><li>고용 및 사고 Risk 고객 전가 없음</li><li>이유식 및 유아식 한국형 준비</li><li>놀이·산책·특이 이벤트 메모</li></ul><div class="service-price"><span>4시간분 예약금 $128 · 최소 2주</span><strong>$32<small>부터</small></strong></div><button class="primary-button" data-service-apply="BABYSITTING">베이비시팅 신청</button></article><article class="public-service-card premium-coming-soon"><span class="service-number">03</span><div class="service-symbol">✦</div><p class="eyebrow">PREMIUM ADD-ON · COMING SOON</p><h3>산모 마사지</h3><p>산후조리 고객을 위한 프리미엄 추가 상품으로 준비하고 있습니다.</p><ul><li>Georgia Massage Therapist License 필수</li><li>라이선스 확인된 전문가만 제공</li><li>마사지 업무 보험 범위 확인</li><li>산후조리 계약 Add-on 형태</li></ul><div class="service-price"><span>출시 준비 중</span><strong>미정</strong></div><button class="secondary-button" disabled>현재 선택 불가</button></article></div><section class="insured-staffing-panel"><div><p class="eyebrow">WHY INSURED STAFFING MATTERS</p><h3>보험·고용 책임을 회사가 관리합니다.</h3><p>ProMoms는 W-2 직접 고용과 책임보상보험·근로자재해보험 운영을 회사의 원칙으로 두고 있습니다.</p></div><ul><li><span>◈</span><strong>책임보상보험</strong><small>서비스 수행 중 대인·대물 리스크 관리</small></li><li><span>✓</span><strong>근로자재해보험</strong><small>업무상 재해 책임을 고객에게 전가하지 않음</small></li><li><span>W-2</span><strong>정식 직원</strong><small>독립계약자 편법 운영 없이 회사가 고용 의무 처리</small></li></ul></section><div class="public-rules" id="rules"><div><strong>이용 규칙</strong><span>① 산후조리 예약금 $500 · 시작 30일 전까지 취소 시 환불</span><span>② 시작 30일 이내 산후조리 예약금 환불 불가</span><span>③ 베이비시팅 예약금 $128 · 4시간분</span><span>④ 시작 72시간 이전 취소 시 베이비시팅 예약금 환불</span><span>⑤ 시작 72시간 이내 취소·노쇼 시 예약금 환불 불가</span><span>⑥ 동일 아기의 산후조리·베이비시팅 기간 중복 불가</span><span>⑦ 의료행위·무면허 마사지는 제공하지 않음</span></div></div></section>
          <section class="public-section public-caregiver-section" id="caregivers"><div class="public-section-heading"><p class="eyebrow">TRUSTED CARE TEAM</p><h2>확인된 기준으로 관리사를 배정합니다.</h2><p>실제 등록된 관리사의 자격·경력·활동 지역과 일정을 관리자가 확인한 뒤 고객에게 배정합니다.</p></div><div class="public-caregiver-grid"><article><div class="public-person-art mint">✓</div><h3>신원·경력 확인</h3><span>IDENTITY & EXPERIENCE</span><p>지원 서류와 경력 정보를 확인하고 승인된 계정만 배정 후보에 포함합니다.</p></article><article><div class="public-person-art blush">CPR</div><h3>자격·안전 기준</h3><span>CREDENTIALS & SAFETY</span><p>서비스에 필요한 교육과 자격, 만료일을 확인한 뒤 업무 범위를 구분합니다.</p></article><article><div class="public-person-art mint">↔</div><h3>일정·가정 맞춤 배정</h3><span>SCHEDULE & FAMILY FIT</span><p>서비스 유형, 지역, 요일과 시간의 실제 가용성을 확인해 중복 없이 배정합니다.</p></article></div></section>
          <section class="public-section" id="shop-preview"><div class="public-section-heading public-shop-heading"><div><p class="eyebrow">ProMoms SELECT · COMING SOON</p><h2>Beauty & Baby Store</h2><p>상품·결제·재고 운영 체계가 준비된 뒤 별도 스토어로 선보일 예정입니다.</p></div><button class="secondary-button" disabled>출시 준비 중</button></div><div class="store-readiness-note"><strong>지금은 돌봄 서비스 신청과 기록 기능만 운영합니다.</strong><span>샘플 상품이나 재고를 실제 판매 상품처럼 표시하지 않습니다.</span></div></section>
          <section class="public-section public-location" id="location"><div class="location-card"><p class="eyebrow">SERVICE AREA</p><h2>Atlanta Metro 방문 케어</h2><p>고객의 서비스 주소와 일정, 관리사 이동 가능 범위를 확인한 뒤 방문 가능 여부를 안내합니다.</p><dl><div><dt>기본 지역</dt><dd>Atlanta Metro, Georgia</dd></div><div><dt>상담 방식</dt><dd>전화 상담 후 일정·주소 확인</dd></div><div><dt>방문 안내</dt><dd>신청 승인 전 최종 서비스 가능 지역을 확인합니다.</dd></div></dl><a class="primary-button public-link-button" href="tel:+14704049467">전화로 가능 지역 문의</a></div><div class="location-map" role="img" aria-label="Atlanta Metro 방문 서비스 지역 안내"><div class="map-road road-one"></div><div class="map-road road-two"></div><div class="map-pin"><span class="promoms-mark">${brandLogoMarkup()}</span><strong>ProMoms</strong></div><small>Atlanta Metro · Georgia</small></div></section>
          <section class="public-section public-contact" id="contact"><div><p class="eyebrow">CONTACT US</p><h2>돌봄이 필요한 순간,<br/>편하게 이야기해 주세요.</h2></div><div class="contact-methods"><a href="tel:+14704049467"><span>☎</span><div><small>전화 상담</small><strong>470-404-9467</strong></div></a><button data-notice="이메일 문의 채널은 운영 주소 확정 후 안내합니다. 현재는 전화로 문의해 주세요."><span>✉</span><div><small>이메일 문의</small><strong>채널 준비 중</strong></div></button><button data-notice="Atlanta Metro 내 상세 방문 가능 여부는 서비스 주소와 일정을 확인한 뒤 안내합니다."><span>GA</span><div><small>서비스 지역</small><strong>Atlanta Metro</strong></div></button></div></section>
        </div>
      </main><footer class="public-footer"><div class="public-brand inverse"><span class="promoms-mark">${brandLogoMarkup()}</span><div><strong>ProMoms</strong><small>엄마 곁의 전문가</small></div></div><p>© 2026 ProMoms. All rights reserved.</p><div><button data-public-anchor="rules">이용약관</button><button data-auth-screen="login">직원 로그인</button></div></footer>
    </div>`;
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
    document.querySelectorAll("[data-service-apply]").forEach((button) => button.addEventListener("click", () => { const user = authUser(); if (!user) { state.auth.screen = "signup"; saveState(); render(); return; } if (!userHasAccessRole(user, "CLIENT")) return showToast("서비스 신청은 고객 권한이 있는 계정에서 이용할 수 있습니다."); openServiceApplicationModal(button.dataset.serviceApply || null); }));
    document.querySelectorAll("[data-my-service]").forEach((button) => button.addEventListener("click", enterClientPortal));
    document.querySelectorAll("[data-enter-portal]").forEach((button) => button.addEventListener("click", () => { state.auth.screen = "portal"; saveState(); render(); }));
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
        state.auth.screen = user.role === "client" ? "public" : "portal";
        state.role = user.role;
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
      admin: { overview: adminOverview, schedule: adminSchedule, requests: adminRequests, finance: adminFinance, history: adminServiceHistory, people: adminPeople, reports: adminReports },
      caregiver: { caregiving: caregiverCaregivingHub, postpartum: () => caregiverServiceWorkspace("POSTPARTUM"), babysitting: () => caregiverServiceWorkspace("BABYSITTING"), profile: caregiverProfile },
      client: { services: clientServicesHub, postpartum: () => clientServiceWorkspace("POSTPARTUM"), babysitting: () => clientServiceWorkspace("BABYSITTING") },
      retail: {},
    };
    const previewPages = import.meta.env.DEV ? {
      admin: { ...operationalPages.admin, retail: adminRetail, analytics: adminAnalytics },
      caregiver: operationalPages.caregiver,
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

    document.querySelectorAll("[data-shift-check]").forEach((checkbox) => checkbox.addEventListener("change", async () => {
      const assignmentId = checkbox.dataset.shiftCheck;
      const checkId = checkbox.dataset.checkId;
      const previousValue = !checkbox.checked;
      state.shiftChecklists[assignmentId] = state.shiftChecklists[assignmentId] || {};
      state.shiftChecklists[assignmentId][checkId] = checkbox.checked;
      if (usingCloudData()) {
        checkbox.disabled = true;
        try {
          await setCareShiftCheckCloud(assignmentId, checkId, checkbox.checked);
          await refreshCloudState();
          showToast(checkbox.checked ? "오늘의 근무 전 확인사항을 저장했습니다." : "오늘의 확인 상태를 해제했습니다.");
        } catch (error) {
          state.shiftChecklists[assignmentId][checkId] = previousValue;
          showToast(friendlyErrorMessage(error, "확인사항을 저장하지 못했습니다."), "error");
          render();
        }
        return;
      }
      saveState();
      render();
      showToast(checkbox.checked ? "근무 전 확인 항목을 저장했습니다." : "확인 상태를 해제했습니다.");
    }));

    document.querySelectorAll("[data-public-home]").forEach((button) => button.addEventListener("click", () => { state.auth.screen = "public"; saveState(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
    document.querySelectorAll("[data-service-apply]").forEach((button) => button.addEventListener("click", () => openServiceApplicationModal(button.dataset.serviceApply || null)));
    document.querySelectorAll("[data-service-adjust]").forEach((button) => button.addEventListener("click", () => openServiceAdjustmentModal(button.dataset.serviceAdjust)));
    document.querySelectorAll("[data-service-extend]").forEach((button) => button.addEventListener("click", () => openServiceApplicationModal("BABYSITTING", "EXTENSION", button.dataset.serviceExtend || null)));

    document.querySelectorAll("[data-log-type]").forEach((button) => {
      button.addEventListener("click", () => openLogModal(button.dataset.logType));
    });

    document.querySelectorAll("[data-chart-range]").forEach((button) => button.addEventListener("click", () => {
      state.chartRangeByRole[state.role] = button.dataset.chartRange;
      saveState();
      render();
    }));

    document.querySelectorAll("[data-caregiver-assignment-detail]").forEach((button) => button.addEventListener("click", () => openCaregiverAssignmentDetailModal(button.dataset.caregiverAssignmentDetail)));
    document.querySelectorAll("[data-open-retrospective-report]").forEach((button) => button.addEventListener("click", () => openRetrospectiveCareReportModal(button.dataset.assignmentId || null)));
    document.querySelectorAll("[data-open-review]").forEach((button) => button.addEventListener("click", () => openServiceReviewModal(button.dataset.openReview)));

    document.querySelectorAll("[data-start-care]").forEach((button) => {
      button.addEventListener("click", async () => {
        const assignment = state.assignments.find((item) => item.id === button.dataset.assignmentId);
        if (!assignment) return showToast("시작할 배정 정보를 찾을 수 없습니다.", "error");
        if (usingCloudData()) {
          button.disabled = true;
          try {
            await setCareSessionStatusCloud(assignment.id, "IN_PROGRESS");
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
            await setCareSessionStatusCloud(assignment.id, "COMPLETED");
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
        const assignment = state.assignments.find((item) => item.id === button.dataset.publishReport && item.status !== "CANCELLED");
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

  function defaultTimeValue() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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
    const client = clientById(assignment.clientId);
    if (!client) return showToast("배정된 고객 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.", "error");
    const babysitting = assignmentServiceType(assignment) === "BABYSITTING";
    const babyName = babyNameFor(assignment, client) || "아이";
    const baby = findClientBaby(client, babyName, assignment.babyId);
    const babyBirthDate = baby?.birthDate || client.babyBirthDate;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal assignment-detail-modal" role="dialog" aria-modal="true" aria-labelledby="caregiver-assignment-detail-title"><header class="modal-header"><div>${serviceBadgeMarkup(assignment.serviceType)}<p class="eyebrow">ASSIGNED CLIENT BRIEF</p><h3 id="caregiver-assignment-detail-title">배정 고객 준비정보</h3><p>${assignmentCountdown(assignment)} · ${formatDate(assignment.startAt)} 시작</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><div class="modal-form"><div class="profile-summary"><div class="profile-summary-person"><div class="profile-avatar">${escapeHtml((babyName || "B")[0])}</div><div><strong>${escapeHtml(client.motherName)} · ${escapeHtml(babyName)}</strong><span>${assignment.dailyStart}–${assignment.dailyEnd} · ${assignment.weeks}주 ${serviceMetaFor(assignment.serviceType).label}</span></div></div><div class="profile-summary-tags"><span>${assignmentCountdown(assignment)}</span><span>${new Date(assignment.startAt) > new Date() ? "예정된 배정" : "현재 배정"}</span></div></div><div class="request-review-grid"><div><span>${babysitting ? "아이 출생일" : "출산일·예정일"}</span><strong>${babyBirthDate ? formatDate(babyBirthDate) : "미등록"}</strong></div>${babysitting ? `<div><span>생활 루틴</span><strong>${escapeHtml(assignment.routineNotes || "별도 지침 없음")}</strong></div>` : `<div><span>산모 상태</span><strong>${escapeHtml(client.maternalStatus || "기록 전")}</strong></div>`}<div class="wide"><span>방문 주소</span><strong>${escapeHtml(assignment.address || client.address || "미등록")}</strong></div><div><span>알러지·주의사항</span><strong>${escapeHtml(assignment.allergies || client.allergies || "없음")}</strong></div><div><span>가정 내 추가인원</span><strong>${Number(assignment.extraHouseholdMembers || 0)}명</strong></div><div><span>선호 언어</span><strong>${escapeHtml(client.preferredLanguage || "미등록")}</strong></div><div><span>방문 시간</span><strong>${assignment.dailyStart}–${assignment.dailyEnd}</strong></div>${babysitting ? `<div class="wide"><span>식사·간식 지침</span><strong>${escapeHtml(assignment.mealInstructions || "별도 지침 없음")}</strong></div><div class="wide"><span>인계·출입 지침</span><strong>${escapeHtml(assignment.pickupNotes || "별도 지침 없음")}</strong></div>` : ""}<div class="wide"><span>고객 요청 메모</span><strong>${escapeHtml(assignment.requestNote || client.requestNote || "별도 요청사항 없음")}</strong></div></div><div class="privacy-boundary-note"><strong>접근 범위 안내</strong><span>배정 준비에 필요한 고객 정보만 표시됩니다. 기록 입력은 실제 배정 기간에만 활성화됩니다.</span></div><div class="form-actions"><button type="button" class="primary-button" data-close-modal>확인 완료</button></div></div></section></div>`;
    bindModalFrame();
  }

  function openServiceReviewModal(assignmentId) {
    const user = authUser();
    const client = state.role === "client" ? clientForUser(user?.id) : null;
    const assignment = state.assignments.find((item) => item.id === assignmentId && item.clientId === client?.id && item.status !== "CANCELLED");
    if (!assignment || !assignmentHasCompletedCare(assignment)) return showToast("서비스 계약·배정 기간이 종료된 후에 후기를 작성할 수 있습니다.");
    if (state.reviews.some((review) => review.assignmentId === assignment.id)) return showToast("이 배정에는 이미 후기를 작성했습니다.");
    const caregiver = state.users.find((item) => item.id === assignment.caregiverUserId);
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="service-review-title"><header class="modal-header"><div><p class="eyebrow">SERVICE REVIEW</p><h3 id="service-review-title">${escapeHtml(caregiver?.fullName || "담당 관리사")} 관리사 후기</h3><p>서비스 계약·배정 기간이 종료된 배정당 한 번만 작성할 수 있습니다.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-service-review-form data-assignment-id="${assignment.id}"><div class="field"><span class="field-label">서비스 만족도</span><div class="rating-options">${[5, 4, 3, 2, 1].map((rating) => `<label><input type="radio" name="rating" value="${rating}" ${rating === 5 ? "checked" : ""} required/><span>${rating}점 <b>${"★".repeat(rating)}</b></span></label>`).join("")}</div></div><div class="field"><span class="field-label">좋았던 점</span><div class="review-tag-options">${["세심한 케어", "정확한 기록", "친절한 소통", "시간 준수", "전문적인 지원"].map((tag) => `<label><input type="checkbox" name="tags" value="${tag}"/><span>${tag}</span></label>`).join("")}</div></div><div class="field"><label for="review-comment">후기</label><textarea id="review-comment" name="comment" maxlength="500" placeholder="서비스에서 좋았던 점이나 개선 의견을 남겨주세요." required></textarea><small>관리사와 운영 관리자에게 서비스 개선 목적으로 공유됩니다.</small></div><div class="privacy-boundary-note"><strong>한 번만 제출 가능</strong><span>공정한 후기 관리를 위해 제출 후에는 추가 작성이나 수정이 불가능합니다.</span></div><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">후기 제출</button></div></form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-service-review-form]").addEventListener("submit", saveServiceReview);
  }

  async function saveServiceReview(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const user = authUser();
    const client = state.role === "client" ? clientForUser(user?.id) : null;
    const assignment = state.assignments.find((item) => item.id === form.dataset.assignmentId && item.clientId === client?.id && item.status !== "CANCELLED");
    if (!assignment || !assignmentHasCompletedCare(assignment)) return showToast("서비스 계약·배정 기간이 종료된 후에 후기를 작성할 수 있습니다.", "error");
    if (state.reviews.some((review) => review.assignmentId === assignment.id)) return showToast("이 배정에는 이미 후기를 작성했습니다.", "info");
    const formData = new FormData(form);
    const rating = Number(formData.get("rating"));
    const comment = String(formData.get("comment") || "").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !comment) return showToast("별점과 후기를 모두 입력해 주세요.", "error");
    const tags = formData.getAll("tags");
    if (usingCloudData()) {
      const submitButton = form.querySelector('button[type="submit"]');
      if (!assignment.caregiverId) return showToast("담당 관리사 정보를 확인할 수 없습니다.", "error");
      submitButton.disabled = true;
      submitButton.textContent = "후기 저장 중…";
      try {
        await saveServiceReviewCloud({ assignmentId: assignment.id, clientId: client.id, caregiverId: assignment.caregiverId, rating, tags, comment });
        closeModal();
        await refreshCloudState();
        showToast("관리사 후기가 등록되었습니다. 소중한 의견 감사합니다.");
      } catch (error) {
        showToast(friendlyErrorMessage(error, "후기를 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "후기 제출";
      }
      return;
    }
    state.reviews.push({ id: `review-${Date.now()}`, assignmentId: assignment.id, clientId: client.id, caregiverUserId: assignment.caregiverUserId, rating, tags, comment, createdAt: new Date().toISOString(), createdBy: user.id });
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
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="caregiver-management-title"><header class="modal-header"><div><p class="eyebrow">CAREGIVER HR</p><h3 id="caregiver-management-title">관리사 프로필·인사관리</h3><p>관리자 전용 인사 및 배정 기준 정보</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-caregiver-management-form>
      <div class="profile-summary"><div class="profile-summary-person"><div class="profile-avatar">${escapeHtml(user.initials)}</div><div><strong>${escapeHtml(user.fullName)}</strong><span>${escapeHtml(user.email)} · ${escapeHtml(user.phone || "전화 미등록")}</span></div></div><div class="profile-summary-tags"><span>${user.status === "approved" ? "계정 승인" : "승인 대기"}</span><span>${currentClient ? `현재 ${escapeHtml(currentClient.motherName)} 담당` : "현재 배정 없음"}</span><span>총 ${assignments.length}건 배정</span></div></div>${hrSetupRequired ? '<div class="status-banner warning"><strong>인사정보 설정이 필요합니다.</strong><span>계정 승인만으로는 일정에 배정되지 않습니다. 아래 정보를 저장하고 근무상태를 ‘재직’으로 설정하세요.</span></div>' : ""}
      <section class="profile-form-section"><div class="profile-section-title"><strong>계정·재직 정보</strong><span>근무상태와 입사 이력</span></div><div class="form-grid two"><div class="field"><label for="caregiver-full-name">이름</label><input id="caregiver-full-name" name="fullName" value="${escapeHtml(user.fullName)}" required /></div><div class="field"><label for="managed-caregiver-phone">전화번호</label><input id="managed-caregiver-phone" name="phone" value="${escapeHtml(user.phone || "")}" /></div></div><div class="form-grid two"><div class="field"><label for="managed-caregiver-email">로그인 이메일</label><input id="managed-caregiver-email" value="${escapeHtml(user.email)}" readonly /></div><div class="field"><label for="employment-status">근무상태</label><select id="employment-status" name="employmentStatus">${employmentOptions.map(([value, label]) => `<option value="${value}" ${value === employmentValue ? "selected" : ""}>${label}</option>`).join("")}</select></div></div><div class="form-grid two"><div class="field"><label for="caregiver-hire-date">입사일자</label><input id="caregiver-hire-date" name="hireDate" type="date" value="${user.hireDate ? dateInputValue(user.hireDate) : ""}" /></div><div class="field"><label for="career-years">총 경력연수</label><input id="career-years" name="careerYears" type="number" min="0" max="60" step="0.5" value="${Number(user.careerYears || 0)}" /></div></div></section>
      <section class="profile-form-section"><div class="profile-section-title"><strong>경력·배정 역량</strong><span>배정 시 참고하는 전문 정보</span></div><div class="field"><label for="managed-certification">자격·경력 요약</label><textarea id="managed-certification" name="certification" placeholder="보유 자격, 근무기관, 주요 경력을 입력하세요.">${escapeHtml(user.certification || "")}</textarea></div><div class="form-grid two"><div class="field"><label for="caregiver-residential-area">거주지역</label><input id="caregiver-residential-area" name="residentialArea" value="${escapeHtml(user.residentialArea || "")}" placeholder="Duluth, GA" /></div><div class="field"><label for="caregiver-service-area">담당 가능지역</label><input id="caregiver-service-area" name="serviceArea" value="${escapeHtml(user.serviceArea || "")}" placeholder="Atlanta · Duluth · Marietta" /></div></div><div class="field"><label for="caregiver-specialties">전문분야</label><input id="caregiver-specialties" name="specialties" value="${escapeHtml(user.specialties || "")}" placeholder="신생아 수면, 모유수유 지원" /></div></section>
      <section class="profile-form-section internal-note-section"><div class="profile-section-title"><strong>인사 특이사항</strong><span>관리사 본인에게는 표시되지 않습니다.</span></div><div class="field"><label for="caregiver-hr-notes">근무조건·상담·평가 메모</label><textarea id="caregiver-hr-notes" name="hrNotes" placeholder="근무 가능시간, 휴직, 면담, 평가 등 관리자 메모를 입력하세요.">${escapeHtml(user.hrNotes || "")}</textarea></div><div class="record-meta-grid"><small>가입일 ${user.createdAt ? new Date(user.createdAt).toLocaleDateString("ko-KR") : "미등록"}</small><small>승인일 ${user.approvedAt ? new Date(user.approvedAt).toLocaleDateString("ko-KR") : "승인 전"}</small><small>마지막 수정 ${user.hrUpdatedAt ? new Date(user.hrUpdatedAt).toLocaleString("ko-KR") : "기록 전"}</small></div></section>
      <div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">인사정보 저장</button></div>
    </form></section></div>`;
    bindModalFrame();
    modalRoot.querySelector("[data-caregiver-management-form]").addEventListener("submit", (event) => saveCaregiverManagement(event, user.id));
  }

  async function saveCaregiverManagement(event, userId) {
    event.preventDefault();
    if (state.role !== "admin" || !canManageCaregiverHr()) return showToast("소유자 또는 관리자 권한이 필요합니다.");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const user = state.users.find((item) => item.id === userId && (usingCloudData() ? item.databaseRoles?.includes("CAREGIVER") : item.role === "caregiver"));
    if (usingCloudData()) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        await updateCaregiverManagementCloud(user, values);
        closeModal();
        await refreshCloudState();
        showToast(`${values.fullName.trim()} 관리사의 인사정보를 저장했습니다.`);
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
    saveState();
    closeModal();
    render();
    showToast(`${user.fullName} 관리사의 인사정보를 저장했습니다.`);
  }

  function openProfileModal() {
    const user = authUser();
    if (!user) return showToast("로그인 정보를 확인할 수 없습니다.", "error");
    const client = state.role === "client" ? clientForUser(user.id) : null;
    const preferredLanguage = user.preferredLanguage || client?.preferredLanguage || "ko";
    const clientBabies = babiesForClient(client);
    const initialBaby = clientBabies[0] || null;
    const clientProfileFields = client ? `<section class="profile-form-section client-self-profile-section"><div class="profile-section-title"><strong>아기·서비스 정보</strong><span>서비스 신청서에 자동으로 불러옵니다.</span></div>${clientBabies.length ? `<div class="field"><label for="profile-baby-selector">작성할 아이</label><select id="profile-baby-selector" data-profile-baby-selector>${clientBabies.map((baby) => `<option value="${escapeHtml(baby.id || "")}">${escapeHtml(baby.name || "이름 미등록")} · ${baby.birthDate ? formatDate(baby.birthDate) : "출생일 미등록"}</option>`).join("")}<option value="__new__">+ 새 아이 등록</option></select></div>` : ""}<input type="hidden" name="babyId" value="${escapeHtml(initialBaby?.id || "")}"/><div class="form-grid two"><div class="field"><label for="profile-baby-name">아기 이름</label><input id="profile-baby-name" name="babyName" value="${escapeHtml(initialBaby?.name || "")}" autocomplete="off" required /></div><div class="field"><label for="profile-baby-birth">출생일 또는 출산 예정일</label><input id="profile-baby-birth" name="babyBirthDate" type="date" value="${initialBaby?.birthDate ? dateInputValue(initialBaby.birthDate) : ""}" required /></div></div><div class="field"><label for="profile-service-address">기본 서비스 주소</label><input id="profile-service-address" name="serviceAddress" value="${escapeHtml(client.address || "")}" autocomplete="street-address" placeholder="Street, City, State ZIP" required /></div><div class="form-grid two"><div class="field"><label for="profile-allergies">알러지·주의사항</label><input id="profile-allergies" name="allergies" value="${escapeHtml(client.allergies || "없음")}" maxlength="500" required /></div><div class="field"><label for="profile-household">가정 내 추가인원</label><input id="profile-household" name="extraHouseholdMembers" type="number" min="0" max="30" value="${Number(client.extraHouseholdMembers || 0)}" required /></div></div><div class="field"><label for="profile-emergency-contact">비상 연락처</label><input id="profile-emergency-contact" name="emergencyContact" value="${escapeHtml(client.emergencyContact || "")}" maxlength="300" placeholder="이름 · 전화번호 · 관계" /></div><div class="field"><label for="profile-request-note">기본 요청사항</label><textarea id="profile-request-note" name="requestNote" maxlength="2000" placeholder="서비스 신청 시 관리자가 참고할 기본 요청사항">${escapeHtml(client.requestNote || "")}</textarea></div></section>` : "";
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
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submittedForm = event.currentTarget;
      const values = Object.fromEntries(new FormData(submittedForm).entries());
      const submitButton = submittedForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        if (usingCloudData()) {
          if (client) await updateMyClientProfileCloud(values);
          else await updateMyProfileCloud(values);
          closeModal();
          await refreshCloudState();
        } else {
          Object.assign(user, { fullName: values.fullName.trim(), initials: initialsFor(values.fullName), phone: values.phone.trim(), preferredLanguage: values.preferredLanguage });
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
    endAt.setDate(endAt.getDate() + Math.max(MIN_SERVICE_WEEKS, Number(weeks || MIN_SERVICE_WEEKS)) * 7 - 1);
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

  function approvedAvailableCaregivers(startAt, endAt, excludedAssignmentId = null, requestedDays = [], requestedDailyStart = null, requestedDailyEnd = null) {
    return state.users.filter((user) =>
      isCaregiverAssignable(user)
      && caregiverIsAvailable(user.id, startAt, endAt, excludedAssignmentId, requestedDays, requestedDailyStart, requestedDailyEnd),
    );
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
    const approvedQueue = state.serviceRequests.filter((request) => request.status === "APPROVED" && !request.approvedAssignmentId && clientById(request.clientId) && requestHasCapturedDepositEvidence(request));
    if (!assignment && !approvedQueue.length) return showToast("승인과 예약금 수납 증빙이 완료된 신청이 없습니다.");
    const linkedRequest = assignment?.serviceRequestId ? state.serviceRequests.find((request) => request.id === assignment.serviceRequestId) : null;
    const selectedRequest = assignment ? linkedRequest : approvedQueue.find((request) => request.id === requestId) || approvedQueue[0];
    const source = assignment || selectedRequest;
    if (!source) return showToast("배치할 서비스 신청 정보를 찾을 수 없습니다.", "error");
    const client = clientById(source.clientId);
    if (!client) return showToast("연결된 고객 정보를 찾을 수 없습니다. 회원·고객 프로필 연결을 먼저 확인해 주세요.", "error");
    const selectedWeeks = String(Math.max(MIN_SERVICE_WEEKS, Number(source.weeks || MIN_SERVICE_WEEKS)));
    const dateValue = dateInputValue(assignment?.startAt || selectedRequest?.desiredStartDate);
    const dailyStart = assignment?.dailyStart || selectedRequest?.dailyStart || "09:00";
    const dailyEnd = assignment?.dailyEnd || selectedRequest?.dailyEnd || "17:00";
    const previewWindow = assignmentWindow(dateValue, dailyStart, dailyEnd, selectedWeeks);
    const lifecycleIssue = serviceLifecycleIssue(source.clientId, assignmentServiceType(source), previewWindow.startAt, previewWindow.endAt, assignment?.id || null, selectedRequest?.id || null, source.babyId, source.babyName);
    const caregivers = assignment ? state.users.filter((user) => user.id === assignment.caregiverUserId || isCaregiverAssignable(user)) : approvedAvailableCaregivers(previewWindow.startAt, previewWindow.endAt, null, source.daysOfWeek || [], dailyStart, dailyEnd);
    const selectedCaregiverId = assignment?.caregiverUserId || caregivers[0]?.id || "";
    const serviceType = assignmentServiceType(source);
    const sourceBabyName = babyNameFor(source, client) || "아이 미등록";
    const requestLocked = Boolean(!assignment && usingCloudData());
    const reassignmentBlockedByActiveSession = Boolean(assignment && usingCloudData() && (state.careSessions || []).some((session) => session.assignmentId === assignment.id && session.status === "IN_PROGRESS"));
    const reassignmentAllowed = canReassignCloudAssignment(assignment);
    const reassignmentWindow = reassignmentAllowed ? reassignmentAvailabilityWindow(assignment) : null;
    const reassignmentCandidates = reassignmentAllowed && reassignmentWindow
      ? approvedAvailableCaregivers(reassignmentWindow.startAt, reassignmentWindow.endAt, assignment.id, source.daysOfWeek || [], dailyStart, dailyEnd).filter((user) => user.id !== assignment.caregiverUserId)
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
      <div class="assignment-source-summary ${serviceMetaFor(serviceType).tone}">${serviceBadgeMarkup(serviceType)}<div><strong>${escapeHtml(client.motherName)} · ${escapeHtml(sourceBabyName)}</strong><span>${escapeHtml(source.address || client.address || "주소 미등록")} · 알러지 ${escapeHtml(source.allergies || "없음")}</span></div><em>승인 신청 연결</em></div>${serviceType === "POSTPARTUM" ? `<div class="application-price-summary"><span>계약 예정 금액</span><strong>$${postpartumEstimate(selectedWeeks).toLocaleString("en-US")}</strong><small>주 $${POSTPARTUM_WEEKLY_RATE.toLocaleString("en-US")} × ${selectedWeeks}주</small></div>` : ""}<div class="insured-contract-note"><strong>보험 적용 W-2 직원 배정</strong><span>고객에게 고용·급여·세무·업무상 재해 리스크를 전가하지 않습니다.</span></div>${requestLocked ? '<div class="status-banner info">고객이 승인받은 신청 조건은 이 단계에서 수정되지 않습니다. 관리사만 선택해 확정하며, 일정 변경은 별도 변경·취소 승인 절차로 처리합니다.</div>' : ""}${lifecycleIssue ? `<div class="status-banner warning">${escapeHtml(lifecycleIssue.message)}</div>` : ""}
      <div class="field"><label for="assignment-caregiver">해당 기간에 가능한 관리사</label>${caregivers.length ? `<select id="assignment-caregiver" name="caregiverUserId" required>${caregivers.map((user) => `<option value="${user.id}" ${user.id === selectedCaregiverId ? "selected" : ""}>${escapeHtml(user.fullName)} · ${escapeHtml(user.serviceArea || user.residentialArea || "활동지역 미등록")}</option>`).join("")}</select><small>저장 시 다른 배정과의 기간 충돌을 다시 확인합니다.</small>` : `<div class="status-banner warning">신청 기간에 배정 가능한 승인 관리사가 없습니다. 관리사 일정을 조정한 뒤 다시 시도해 주세요.</div>`}</div>
      <div class="field"><span class="field-label">계약 기간</span>${requestLocked ? `<input type="hidden" name="weeks" value="${selectedWeeks}"/><div class="read-only-value">${selectedWeeks}주</div>` : `<div class="option-grid three">${radioOptions("weeks", [["2", "2주"], ["3", "3주"], ["4", "4주"]], String(Math.max(MIN_SERVICE_WEEKS, Number(selectedWeeks))))}</div>`}</div>
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
      if (!replacement || replacement.id === currentAssignment.caregiverUserId || !replacement.caregiverId || !isCaregiverAssignable(replacement)) return showToast("현재 배정 가능한 다른 관리사를 선택해 주세요.", "error");
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
    if (Number(values.weeks) < MIN_SERVICE_WEEKS) return showToast("서비스 계약은 최소 2주부터 가능합니다.");
    if (values.serviceType === "BABYSITTING" && babysittingHours(values.dailyStart, values.dailyEnd) < MIN_BABYSITTING_HOURS) return showToast("베이비시팅은 하루 최소 4시간부터 배정할 수 있습니다.");
    if (values.serviceType === "POSTPARTUM" && values.dailyEnd !== postpartumEndTime(values.dailyStart)) return showToast("산후조리는 케어 8시간·식사 1시간·휴식 30분을 포함한 종료시간을 사용해야 합니다.");
    const request = values.serviceRequestId ? state.serviceRequests.find((item) => item.id === values.serviceRequestId) : null;
    if (!assignmentId && (!request || request.status !== "APPROVED" || request.approvedAssignmentId)) return showToast("배치 가능한 승인 신청을 다시 선택해 주세요.");
    const { startAt, endAt } = assignmentWindow(values.startDate, values.dailyStart, values.dailyEnd, values.weeks);
    if (values.dailyEnd <= values.dailyStart) return showToast("종료 시간은 시작 시간보다 늦어야 합니다.");
    const existingAssignment = assignmentId ? state.assignments.find((item) => item.id === assignmentId) : null;
    const babySource = request || existingAssignment;
    const lifecycleIssue = serviceLifecycleIssue(values.clientId, values.serviceType, startAt, endAt, assignmentId, request?.id || null, babySource?.babyId, babySource?.babyName);
    if (lifecycleIssue) return showToast(lifecycleIssue.message);
    const requestedDays = request?.daysOfWeek || state.assignments.find((item) => item.id === assignmentId)?.daysOfWeek || [];
    if (!caregiverIsAvailable(values.caregiverUserId, startAt, endAt, assignmentId, requestedDays, values.dailyStart, values.dailyEnd)) {
      showToast("해당 관리사에게 겹치는 배정 일정이 있습니다.");
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
    const assignmentData = { serviceType: values.serviceType, serviceRequestId: request?.id || existingAssignment?.serviceRequestId || null, clientId: client.id, babyId: babySource?.babyId || client.babyId, babyName: babyNameFor(babySource, client) || client.babyName, caregiverUserId: values.caregiverUserId, weeks: Number(values.weeks), weeklyRate: values.serviceType === "POSTPARTUM" ? POSTPARTUM_WEEKLY_RATE : null, contractValue: values.serviceType === "POSTPARTUM" ? postpartumEstimate(values.weeks) : null, depositAmount: values.serviceType === "POSTPARTUM" ? (request?.depositAmount || existingAssignment?.depositAmount || POSTPARTUM_DEPOSIT) : null, depositStatus: values.serviceType === "POSTPARTUM" ? (request?.depositStatus || existingAssignment?.depositStatus || "PAID") : null, depositPaidAt: values.serviceType === "POSTPARTUM" ? (request?.depositPaidAt || existingAssignment?.depositPaidAt || new Date().toISOString()) : null, insuredStaffing: true, employeeClassification: "W-2", startAt: startAt.toISOString(), endAt: endAt.toISOString(), dailyStart: values.dailyStart, dailyEnd: values.dailyEnd, daysOfWeek: request?.daysOfWeek || existingAssignment?.daysOfWeek || [], address: values.address, extraHouseholdMembers: Number(values.extraHouseholdMembers), allergies: values.allergies, requestNote: values.requestNote, maternalNotes: request?.maternalNotes || existingAssignment?.maternalNotes || "", mealInstructions: request?.mealInstructions || existingAssignment?.mealInstructions || "", routineNotes: request?.routineNotes || existingAssignment?.routineNotes || "", pickupNotes: request?.pickupNotes || existingAssignment?.pickupNotes || "", status: startAt <= new Date() && new Date() <= endAt ? "ACTIVE" : "SCHEDULED", updatedBy: authUser().id, updatedAt: new Date().toISOString() };
    if (values.serviceType === "BABYSITTING") Object.assign(assignmentData, { depositAmount: request?.depositAmount || existingAssignment?.depositAmount || BABYSITTING_DEPOSIT, depositStatus: request?.depositStatus || existingAssignment?.depositStatus || "PAID", depositPaidAt: request?.depositPaidAt || existingAssignment?.depositPaidAt || new Date().toISOString() });
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
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal assignment-modal" role="dialog" aria-modal="true" aria-labelledby="adjustment-title"><header class="modal-header"><div>${serviceBadgeMarkup(serviceType)}<p class="eyebrow">CHANGE & CANCELLATION</p><h3 id="adjustment-title">${serviceMetaFor(serviceType).label} 변경·취소 요청</h3><p>요청은 관리자 승인 전까지 기존 일정에 영향을 주지 않습니다.</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-service-adjustment-form><input type="hidden" name="targetType" value="${targetType}"/><input type="hidden" name="targetId" value="${targetId}"/><div class="request-review-grid"><div><span>현재 기간</span><strong>${new Date(startAt).toLocaleDateString("ko-KR")}–${new Date(target.endAt || requestWindow(target).endAt).toLocaleDateString("ko-KR")}</strong></div><div><span>현재 시간</span><strong>${target.dailyStart}–${target.dailyEnd}</strong></div></div><div class="status-banner ${policy.tone}" data-adjustment-policy><strong>${escapeHtml(policy.title)}</strong><span>${escapeHtml(policy.detail)}</span></div><div class="field"><span class="field-label">요청 종류</span><div class="option-grid two">${radioOptions("adjustmentAction", [["CHANGE", "일정 변경"], ["CANCEL", "서비스 취소"]], "CHANGE")}</div></div><section class="application-block" data-adjustment-change><h4>변경 희망 일정</h4>${hasCareHistory ? '<div class="status-banner info"><strong>방문 이력이 있어 시작일과 일일 시간은 고정됩니다.</strong><span>과거 기록과 계약을 일치시키기 위해 이용 기간만 변경할 수 있습니다.</span></div>' : ""}<div class="form-grid three"><div class="field"><label for="adjustment-start">시작일</label><input id="adjustment-start" name="proposedStartDate" type="date" min="${localDateKey(new Date())}" value="${startValue}" ${startLocked ? 'readonly aria-readonly="true"' : "required"}/>${startLocked ? `<small>${hasCareHistory ? "완료·진행 방문 이력이 있어 최초 시작일을 변경할 수 없습니다." : "서비스가 시작되어 최초 시작일은 변경할 수 없습니다."}</small>` : ""}</div><div class="field"><label for="adjustment-start-time">시작 시간</label><input id="adjustment-start-time" name="proposedDailyStart" type="time" value="${target.dailyStart}" ${hasCareHistory ? 'readonly aria-readonly="true"' : ""} required/></div><div class="field"><label for="adjustment-end-time">종료 시간</label><input id="adjustment-end-time" name="proposedDailyEnd" type="time" value="${target.dailyEnd}" ${hasCareHistory ? 'readonly aria-readonly="true"' : ""} required/></div></div><div class="field"><span class="field-label">이용 기간</span><div class="option-grid three">${radioOptions("proposedWeeks", [["2", "2주"], ["3", "3주"], ["4", "4주"]], String(Math.max(MIN_SERVICE_WEEKS, Number(target.weeks || MIN_SERVICE_WEEKS))))}</div></div></section><div class="field"><label for="adjustment-reason">변경·취소 사유</label><textarea id="adjustment-reason" name="reason" placeholder="관리자가 일정과 관리사 배정을 판단할 수 있도록 구체적으로 적어주세요." required></textarea></div><label class="consent-row"><input type="checkbox" name="policyAccepted" required/><span><strong>표시된 정책을 확인했습니다.</strong><small>관리자 승인 결과와 비용 처리 내역은 나의 서비스에서 확인할 수 있습니다.</small></span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">관리자에게 요청</button></div></form></section></div>`;
    const form = modalRoot.querySelector("[data-service-adjustment-form]");
    form.insertAdjacentHTML("afterbegin", `<input type="hidden" name="serviceType" value="${serviceType}"/>`);
    configureBabysittingMinimumTime(form, "proposedDailyStart", "proposedDailyEnd");
    configurePostpartumFixedTime(form, "proposedDailyStart", "proposedDailyEnd");
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
      if (Number(values.proposedWeeks) < MIN_SERVICE_WEEKS) return showToast("서비스는 최소 2주부터 가능합니다.");
      if (values.proposedDailyEnd <= values.proposedDailyStart) return showToast("종료 시간은 시작 시간보다 늦어야 합니다.");
      if (serviceType === "BABYSITTING" && babysittingHours(values.proposedDailyStart, values.proposedDailyEnd) < MIN_BABYSITTING_HOURS) return showToast("베이비시팅은 하루 최소 4시간부터 변경할 수 있습니다.");
      if (serviceType === "POSTPARTUM" && values.proposedDailyEnd !== postpartumEndTime(values.proposedDailyStart)) return showToast("산후조리 종료시간은 시작시간부터 케어 8시간·식사 1시간·휴식 30분을 반영해 자동 계산됩니다.");
      if (isPostpartumServiceStarted(target) && values.proposedStartDate !== dateInputValue(adjustmentTargetStart(target))) return showToast("이미 시작된 산후조리 서비스의 시작일은 변경할 수 없습니다.");
      if (assignmentHasCareHistory(target) && (values.proposedStartDate !== dateInputValue(adjustmentTargetStart(target)) || values.proposedDailyStart !== target.dailyStart || values.proposedDailyEnd !== target.dailyEnd)) return showToast("방문 이력이 있는 서비스는 시작일과 일일 시간을 변경할 수 없습니다.", "error");
    }
    const policy = adjustmentPolicy(serviceType, adjustmentTargetStart(target), target, values.adjustmentAction);
    if (usingCloudData()) {
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "요청 저장 중…";
      try {
        await submitServiceAdjustmentCloud({
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

  function openServiceApplicationModal(preselectedType = null, applicationMode = "NEW", extensionAssignmentId = null) {
    const user = authUser();
    if (!user || state.role !== "client" || !userHasAccessRole(user, "CLIENT")) return showToast("고객 작업공간으로 전환해 주세요.");
    const client = clientForUser(user.id);
    if (!client) return showToast("가족 고객 정보가 계정에 연결되지 않았습니다. 관리자에게 회원 연결 확인을 요청해 주세요.", "error");
    const selectedType = ["POSTPARTUM", "BABYSITTING"].includes(preselectedType) ? preselectedType : defaultServiceApplicationType(client);
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
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal service-application-modal" role="dialog" aria-modal="true" aria-labelledby="service-application-title"><header class="modal-header"><div><p class="eyebrow">${extensionMode ? "SERVICE EXTENSION" : "CARE REQUEST"}</p><h3 id="service-application-title">${extensionMode ? "베이비시팅 기간 연장 신청" : "서비스 신청"}</h3><p>${extensionMode ? "기존 베이비시팅 종료 후 첫 평일에 이어서 시작합니다." : "희망 내용을 접수하면 관리자가 가능한 관리사를 확인해 배정합니다."}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-service-application-form><input type="hidden" name="applicationMode" value="${extensionMode ? "EXTENSION" : "NEW"}"/><input type="hidden" name="extensionAssignmentId" value="${escapeHtml(extensionAssignment?.id || "")}"/>
      <div class="field"><span class="field-label">서비스 종류</span><div class="service-choice-grid">${[["POSTPARTUM", "♡", "산후조리", "산모 회복·신생아 케어와 관리 차트"], ["BABYSITTING", "☆", "베이비시팅", "아이 식사·놀이·생활 이벤트 기록"]].map(([value, icon, label, detail]) => { const unavailable = extensionMode && value !== "BABYSITTING"; return `<label class="service-choice ${unavailable ? "unavailable" : ""}"><input type="radio" name="serviceType" value="${value}" ${value === selectedType ? "checked" : ""} ${unavailable ? "disabled" : ""}/><span><b>${icon}</b><strong>${label}</strong><small>${detail}</small></span></label>`; }).join("")}</div></div>
      <section class="application-block"><h4>아이 정보</h4>${babySelectionMarkup}<input type="hidden" name="babyId" value="${escapeHtml(initialBabyId)}"/><div class="form-grid two"><div class="field"><label for="application-baby-name">아기 이름</label><input id="application-baby-name" name="babyName" value="${escapeHtml(initialBabyName)}" autocomplete="off" ${initialBaby || extensionMode ? 'readonly aria-readonly="true"' : ""} required /><small>${extensionMode ? "연장 대상 아이는 기존 예약과 동일하게 유지됩니다." : registeredBabies.length ? "새 아이를 추가하려면 위 목록에서 ‘새 아이 등록’을 선택해 주세요." : "서비스를 받을 아이의 이름을 입력해 주세요."}</small></div><div class="field"><label for="application-baby-birth">출생일 또는 출산 예정일</label><input id="application-baby-birth" name="babyBirthDate" type="date" value="${initialBabyBirthDate ? dateInputValue(initialBabyBirthDate) : ""}" ${initialBaby || extensionMode ? 'readonly aria-readonly="true"' : ""} required /></div></div></section>
      <section class="application-block"><h4>희망 일정</h4><div class="field"><span class="field-label">이용 기간</span><div class="option-grid three">${radioOptions("requestedWeeks", [["2", "2주"], ["3", "3주"], ["4", "4주"]], "2")}</div></div><div class="form-grid three"><div class="field"><label for="application-start">희망 시작일</label><input id="application-start" name="desiredStartDate" type="date" min="${selectedType === "BABYSITTING" ? babysittingMinimum : localDateKey(new Date())}" value="${startValue}" data-babysitting-min="${babysittingMinimum}" required /><small data-start-guidance>희망 시작일은 관리자 확인 후 확정됩니다.</small></div><div class="field"><label for="application-start-time">시작 시간</label><input id="application-start-time" name="requestedDailyStart" type="time" value="09:00" required /></div><div class="field"><label for="application-end-time">종료 시간</label><input id="application-end-time" name="requestedDailyEnd" type="time" value="17:00" required /></div></div><div class="field"><span class="field-label">희망 요일</span><div class="weekday-options">${["월", "화", "수", "목", "금", "토", "일"].map((day) => `<label><input type="checkbox" name="daysOfWeek" value="${day}" ${["월", "화", "수", "목", "금"].includes(day) ? "checked" : ""}/><span>${day}</span></label>`).join("")}</div></div><div class="application-price-summary" data-application-price><span>산후조리 예상 서비스 비용</span><strong>$${postpartumEstimate(2).toLocaleString("en-US")}</strong><small>주 $${POSTPARTUM_WEEKLY_RATE.toLocaleString("en-US")} × 2주 · 예약금 $${POSTPARTUM_DEPOSIT.toLocaleString("en-US")}</small></div></section>
      <section class="application-block"><h4>방문·안전 정보</h4><div class="field"><label for="application-address">서비스 주소</label><input id="application-address" name="requestAddress" value="${escapeHtml(client.address || user.address || "")}" placeholder="Street, City, State ZIP" required /></div><div class="form-grid two"><div class="field"><label for="application-household">가정 내 추가인원</label><input id="application-household" name="requestHousehold" type="number" min="0" value="${Number(client.extraHouseholdMembers || 0)}" required /></div><div class="field"><label for="application-allergies">알러지 유무 및 내용</label><input id="application-allergies" name="requestAllergies" value="${escapeHtml(client.allergies || "없음")}" required /></div></div></section>
      <section class="application-block" data-postpartum-application><h4>산후조리 요청</h4><div class="field"><label for="maternal-notes">산모 상태·회복 지원 요청</label><textarea id="maternal-notes" name="maternalNotes" placeholder="회복 상태, 식사, 수유 지원 등 필요한 내용을 적어주세요."></textarea></div></section>
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
    const updatePrice = () => { const babysitting = form.elements.serviceType.value === "BABYSITTING"; const weeks = Number(form.elements.requestedWeeks.value || POSTPARTUM_DEFAULT_WEEKS); const price = form.querySelector("[data-application-price]"); price.hidden = false; price.querySelector("span").textContent = babysitting ? "베이비시팅 예약금" : "산후조리 예상 서비스 비용"; price.querySelector("strong").textContent = babysitting ? `$${BABYSITTING_DEPOSIT.toLocaleString("en-US")}` : `$${postpartumEstimate(weeks).toLocaleString("en-US")}`; price.querySelector("small").textContent = babysitting ? `시간당 $${BABYSITTING_HOURLY_RATE} × ${MIN_BABYSITTING_HOURS}시간 · 72시간 이전 취소 시 환불` : `주 $${POSTPARTUM_WEEKLY_RATE.toLocaleString("en-US")} × ${weeks}주 · 승인 시 예약금 $${POSTPARTUM_DEPOSIT.toLocaleString("en-US")}`; };
    const toggle = () => { const babysitting = form.elements.serviceType.value === "BABYSITTING"; const startInput = form.elements.desiredStartDate; const guidance = form.querySelector("[data-start-guidance]"); form.querySelector("[data-babysitting-application]").hidden = !babysitting; form.querySelector("[data-postpartum-application]").hidden = babysitting; startInput.min = babysitting ? startInput.dataset.babysittingMin : localDateKey(new Date()); startInput.readOnly = extensionMode; if (babysitting && startInput.value < startInput.min) startInput.value = startInput.min; guidance.textContent = extensionMode ? `기존 예약 종료 후 첫 평일인 ${new Date(`${startInput.dataset.babysittingMin}T12:00:00`).toLocaleDateString("ko-KR")}로 자동 배치됩니다.` : "희망 시작일은 관리자 확인 후 확정됩니다."; refreshEnhancedDateInput(startInput); updatePrice(); };
    form.querySelectorAll('input[name="serviceType"]').forEach((radio) => radio.addEventListener("change", toggle));
    form.querySelectorAll('input[name="requestedWeeks"]').forEach((radio) => radio.addEventListener("change", updatePrice));
    if (selectedType === "POSTPARTUM") form.elements.requestedWeeks.value = String(POSTPARTUM_DEFAULT_WEEKS);
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
    state.serviceRequests.push({ id: `request-${Date.now()}`, requestKind: extensionMode ? "EXTENSION" : "NEW", serviceType: values.serviceType, clientId: client.id, userId: user.id, status: "PENDING", babyName: client.babyName, weeks: Number(values.requestedWeeks), weeklyRate: values.serviceType === "POSTPARTUM" ? POSTPARTUM_WEEKLY_RATE : null, estimatedTotal: values.serviceType === "POSTPARTUM" ? postpartumEstimate(values.requestedWeeks) : null, depositAmount: values.serviceType === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : null, depositStatus: values.serviceType === "POSTPARTUM" ? "DUE_ON_APPROVAL" : null, desiredStartDate: new Date(`${values.desiredStartDate}T${values.requestedDailyStart}:00`).toISOString(), dailyStart: values.requestedDailyStart, dailyEnd: values.requestedDailyEnd, daysOfWeek, address: values.requestAddress.trim(), extraHouseholdMembers: Number(values.requestHousehold || 0), allergies: values.requestAllergies.trim(), specialNotes: values.requestSpecialNotes?.trim() || "", maternalNotes: values.maternalNotes?.trim() || "", mealInstructions: values.mealInstructions?.trim() || "", routineNotes: values.routineNotes?.trim() || "", pickupNotes: values.pickupNotes?.trim() || "", birthOrDueDate: babyBirthDate, sequencePolicyAccepted: true, insuredStaffingAcknowledged: true, createdAt: new Date().toISOString() });
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
    const startDate = dateInputValue(request.desiredStartDate);
    const { startAt, endAt } = assignmentWindow(startDate, request.dailyStart, request.dailyEnd, request.weeks);
    const lifecycleIssue = serviceLifecycleIssue(client.id, assignmentServiceType(request), startAt, endAt, null, request.id, request.babyId, request.babyName);
    const requestBabyName = babyNameFor(request, client) || "아이 미등록";
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal assignment-modal" role="dialog" aria-modal="true" aria-labelledby="client-request-title"><header class="modal-header"><div>${serviceBadgeMarkup(request.serviceType)}<h3 id="client-request-title">${serviceMetaFor(request.serviceType).label} 신청 검토·승인</h3><p>${escapeHtml(client.motherName)} · ${escapeHtml(requestBabyName)}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-client-request-form>
      <div class="request-review-grid"><div><span>희망 기간</span><strong>${request.weeks}주 · ${formatDate(startAt)}–${formatDate(endAt)}</strong></div><div><span>방문 시간</span><strong>${request.dailyStart}–${request.dailyEnd}</strong></div><div><span>희망 요일</span><strong>${escapeHtml((request.daysOfWeek || []).join(" · ") || "미지정")}</strong></div><div><span>출생/출산(예정)일</span><strong>${formatDate(request.birthOrDueDate)}</strong></div><div><span>추가인원</span><strong>${request.extraHouseholdMembers}명</strong></div>${assignmentServiceType(request) === "POSTPARTUM" ? `<div><span>예상 서비스 비용</span><strong>$${postpartumEstimate(request.weeks).toLocaleString("en-US")} · 주 $${POSTPARTUM_WEEKLY_RATE.toLocaleString("en-US")}</strong></div>` : ""}<div class="wide"><span>주소</span><strong>${escapeHtml(request.address)}</strong></div><div class="wide"><span>알러지</span><strong>${escapeHtml(request.allergies)}</strong></div>${assignmentServiceType(request) === "BABYSITTING" ? `<div class="wide"><span>식사·간식 지침</span><strong>${escapeHtml(request.mealInstructions || "없음")}</strong></div><div class="wide"><span>생활 루틴·인계</span><strong>${escapeHtml([request.routineNotes, request.pickupNotes].filter(Boolean).join(" · ") || "없음")}</strong></div>` : `<div class="wide"><span>산모 상태·회복 요청</span><strong>${escapeHtml(request.maternalNotes || "없음")}</strong></div>`}<div class="wide"><span>특이사항·요청</span><strong>${escapeHtml(request.specialNotes || "없음")}</strong></div></div>
      <div class="insured-contract-note"><strong>회사 운영 원칙</strong><span>책임보상보험 · 근로자재해보험 · W-2 정식 직원 운영 원칙이 서비스에 적용됩니다.</span></div>${lifecycleIssue ? `<div class="status-banner warning">${escapeHtml(lifecycleIssue.message)}</div>` : `<div class="privacy-boundary-note"><strong>승인 후 일정·배정 메뉴로 이동</strong><span>일정 중복 검증을 통과했습니다. 승인된 신청은 캘린더의 ‘일정 배치 대기’ 목록에 자동으로 표시됩니다.</span></div>`}
      <div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button" ${lifecycleIssue ? "disabled" : ""}>서비스 신청 승인</button></div>
    </form></section></div>`;
    const requestDeposit = assignmentServiceType(request) === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT;
    const depositPolicyCopy = assignmentServiceType(request) === "POSTPARTUM" ? "시작 30일 전까지 취소 시 환불·30일 이내에는 환불 불가" : "시작 72시간 이전 취소 시 환불·72시간 이내 취소 또는 노쇼 시 환불 불가";
    const reviewForm = modalRoot.querySelector("[data-client-request-form]");
    const reviewActions = reviewForm.querySelector(".form-actions");
    reviewActions.classList.add("request-review-actions");
    reviewActions.insertAdjacentHTML("beforebegin", `<div class="field"><label for="request-review-note">검토 메모·반려 사유</label><textarea id="request-review-note" name="reviewNote" placeholder="반려할 때는 고객이 이해할 수 있는 사유를 반드시 입력해 주세요."></textarea></div><fieldset class="deposit-confirmation"><legend>예약금 수납 기록</legend><p><strong>$${requestDeposit.toLocaleString("en-US")} 수납 근거를 기록해야 승인할 수 있습니다.</strong><small>${depositPolicyCopy} 정책이 적용됩니다.</small></p><div class="form-grid three"><div class="field"><label for="request-payment-date">실제 수납일</label><input id="request-payment-date" name="paymentDate" type="date" value="${localDateKey(new Date())}" max="${localDateKey(new Date())}" required/><small>뒤늦게 입력해도 실제 받은 날짜로 수입에 반영됩니다.</small></div><div class="field"><label for="request-payment-method">결제 수단</label><select id="request-payment-method" name="paymentMethod" required><option value="">선택해 주세요</option><option value="CARD">카드</option><option value="ACH">ACH 계좌이체</option><option value="CASH">현금</option><option value="CHECK">수표</option><option value="OTHER">기타</option></select></div><div class="field"><label for="request-payment-reference">거래·영수증 번호</label><input id="request-payment-reference" name="paymentReference" minlength="3" maxlength="255" autocomplete="off" placeholder="결제사 거래번호 또는 수기 영수증 번호" required/><small>고유한 번호를 입력해 중복 수납을 방지합니다.</small></div></div></fieldset>`);
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
    const depositAmount = Number(request.depositAmount || (assignmentServiceType(request) === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT));
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
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal" role="dialog" aria-modal="true" aria-labelledby="balance-payment-title"><header class="modal-header"><div>${serviceBadgeMarkup(request.serviceType)}<p class="eyebrow">BALANCE PAYMENT</p><h3 id="balance-payment-title">잔금 수납 확인·기록</h3><p>${escapeHtml(client.motherName)} · ${escapeHtml(babyNameFor(request, client) || "아이 정보 없음")}</p></div><button class="close-button" data-close-modal aria-label="닫기">×</button></header><form class="modal-form" data-balance-payment-form><div class="request-review-grid"><div><span>총 예정금액</span><strong>${money(total)}</strong></div><div><span>기수납액</span><strong>${money(alreadyPaid)}</strong></div><div class="wide"><span>현재 미수 잔금</span><strong>${money(outstanding)}</strong></div></div><div class="status-banner warning"><strong>실제 수납 내역만 기록하세요.</strong><span>이 화면은 결제를 실행하지 않습니다. 누락분은 실제 받은 날짜를 선택하면 해당 월·연도 수입에 소급 반영됩니다.</span></div><div class="form-grid three"><div class="field"><label for="balance-payment-date">실제 수납일</label><input id="balance-payment-date" name="paymentDate" type="date" value="${localDateKey(new Date())}" max="${localDateKey(new Date())}" required/></div><div class="field"><label for="balance-payment-amount">수납액</label><input id="balance-payment-amount" name="amount" type="number" min="0.01" max="${outstanding.toFixed(2)}" step="0.01" value="${outstanding.toFixed(2)}" required/><small>최대 ${money(outstanding)}</small></div><div class="field"><label for="balance-payment-method">결제 수단</label><select id="balance-payment-method" name="paymentMethod" required><option value="CARD">카드</option><option value="BANK_TRANSFER">계좌이체</option><option value="CHECK">수표</option><option value="CASH">현금</option><option value="OTHER">기타</option></select></div></div><div class="field"><label for="balance-payment-reference">거래·영수증 번호</label><input id="balance-payment-reference" name="paymentReference" minlength="3" maxlength="255" autocomplete="off" placeholder="결제사·은행의 고유 거래번호" required/><small>중복 사용할 수 없는 실제 외부 거래번호를 입력합니다.</small></div><label class="consent-line"><input type="checkbox" name="paymentConfirmed" required/><span>위 금액의 실제 잔금 수납 내역과 일치함을 확인합니다.</span></label><div class="form-actions"><button type="button" class="secondary-button" data-close-modal>닫기</button><button type="submit" class="primary-button">잔금 수납 저장</button></div></form></section></div>`;
    bindModalFrame();
    const form = modalRoot.querySelector("[data-balance-payment-form]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const amount = Number(values.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) return showToast(`수납액은 0보다 크고 ${money(outstanding)} 이하여야 합니다.`, "error");
      if (!values.paymentDate || values.paymentDate > localDateKey(new Date())) return showToast("실제 수납일은 오늘 또는 지난 날짜로 선택해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "저장 중…";
      try {
        await recordServiceBalancePaymentCloud({ requestId, amount, paymentMethod: values.paymentMethod, paymentReference: values.paymentReference, receivedOn: values.paymentDate });
        closeModal();
        await refreshCloudState();
        showToast(`${client.motherName} 고객의 잔금 ${money(amount)} 수납 기록을 저장했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "잔금 수납 기록을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
        submitButton.textContent = "잔금 수납 저장";
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
          await recordServiceRefundCloud({ requestId, amount, paymentMethod: values.paymentMethod, refundReference, refundReason, refundedOn: values.refundedOn });
          closeModal();
          await refreshCloudState();
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
        await reviewServiceAdjustmentCloud(adjustmentId, decision === "APPROVE");
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
      target.depositAmount = target.depositAmount || (adjustment.serviceType === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT);
      target.depositStatus = ["DEPOSIT_REFUNDABLE", "BABYSITTING_DEPOSIT_REFUNDABLE"].includes(adjustment.policyCode) ? "REFUND_DUE" : "NON_REFUNDABLE";
      if (adjustment.policyCode === "POSTPARTUM_ACTIVE_PRORATED") Object.assign(target, { cancellationSettlementAmount: adjustment.cancellationSettlementAmount, remainingCareDaysAtCancellation: adjustment.remainingCareDays, originalContractValueAtCancellation: adjustment.originalContractValue, cancellationFormula: "(original_total - deposit) / remaining_care_days" });
      if (adjustment.targetType === "ASSIGNMENT") {
        const linkedRequest = state.serviceRequests.find((item) => item.id === target.serviceRequestId);
        if (linkedRequest) Object.assign(linkedRequest, { status: "CANCELLED", cancelledAt: target.cancelledAt, depositStatus: target.depositStatus || linkedRequest.depositStatus, cancellationSettlementAmount: target.cancellationSettlementAmount || null, remainingCareDaysAtCancellation: target.remainingCareDaysAtCancellation || null });
        if (state.session.assignmentId === target.id) Object.assign(state.session, { active: false, endedAt: new Date().toISOString() });
      }
    } else {
      const window = assignmentWindow(adjustment.proposedStartDate, adjustment.proposedDailyStart, adjustment.proposedDailyEnd, adjustment.proposedWeeks);
      const excludedAssignmentId = adjustment.targetType === "ASSIGNMENT" ? target.id : null;
      const excludedRequestId = adjustment.targetType === "REQUEST" ? target.id : null;
      const issue = serviceLifecycleIssue(target.clientId, adjustment.serviceType, window.startAt, window.endAt, excludedAssignmentId, excludedRequestId, target.babyId, target.babyName);
      if (issue) return showToast(`승인할 수 없습니다: ${issue.message}`);
      if (adjustment.targetType === "ASSIGNMENT" && target.caregiverUserId && !caregiverIsAvailable(target.caregiverUserId, window.startAt, window.endAt, target.id, target.daysOfWeek || [], adjustment.proposedDailyStart, adjustment.proposedDailyEnd)) return showToast("현재 관리사가 변경 일정에 배정되어 있습니다. 일정·배정에서 관리사를 먼저 조정해 주세요.");
      const scheduleChanges = { weeks: adjustment.proposedWeeks, dailyStart: adjustment.proposedDailyStart, dailyEnd: adjustment.proposedDailyEnd };
      if (adjustment.targetType === "ASSIGNMENT") {
        Object.assign(target, scheduleChanges, { startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString(), status: window.startAt > new Date() ? "SCHEDULED" : "ACTIVE", scheduleChangedAt: new Date().toISOString() });
        if (adjustment.serviceType === "POSTPARTUM") Object.assign(target, { contractValue: postpartumEstimate(adjustment.proposedWeeks), weeklyRate: POSTPARTUM_WEEKLY_RATE });
        const linkedRequest = state.serviceRequests.find((item) => item.id === target.serviceRequestId);
        if (linkedRequest) Object.assign(linkedRequest, scheduleChanges, { desiredStartDate: window.startAt.toISOString() });
      } else {
        Object.assign(target, scheduleChanges, { desiredStartDate: window.startAt.toISOString(), scheduleChangedAt: new Date().toISOString() });
        if (adjustment.serviceType === "POSTPARTUM") Object.assign(target, { estimatedTotal: postpartumEstimate(adjustment.proposedWeeks), weeklyRate: POSTPARTUM_WEEKLY_RATE });
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
    const startDate = dateInputValue(request.desiredStartDate);
    const { startAt, endAt } = assignmentWindow(startDate, request.dailyStart, request.dailyEnd, request.weeks);
    const lifecycleIssue = serviceLifecycleIssue(request.clientId, assignmentServiceType(request), startAt, endAt, null, request.id, request.babyId, request.babyName);
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
    Object.assign(request, { status: "APPROVED", approvedAssignmentId: null, approvedAt: new Date().toISOString(), approvedBy: authUser().id, depositAmount: assignmentServiceType(request) === "POSTPARTUM" ? POSTPARTUM_DEPOSIT : BABYSITTING_DEPOSIT, depositStatus: "PAID", depositPaidAt, depositTransaction: { paymentMethod, externalReference: paymentReference, capturedAt: depositPaidAt, status: "CAPTURED" } });
    Object.assign(client, { approvalStatus: "APPROVED_AWAITING_SCHEDULE", clientStatus: "LEAD", address: request.address, allergies: request.allergies, extraHouseholdMembers: request.extraHouseholdMembers, requestNote: request.specialNotes });
    saveState();
    closeModal();
    render();
    showToast(`${client.motherName} 고객의 ${serviceMetaFor(request.serviceType).label} 신청을 승인했습니다. 일정·배정 메뉴에서 관리사를 배치해 주세요.`);
  }

  function fieldsForType(type) {
    switch (type) {
      case "feeding":
        return `
          <div class="field"><span class="field-label">수유 방법</span><div class="option-grid">${radioOptions("method", [["breast", "직접 수유"], ["pumped", "유축 모유"], ["formula", "분유"]], "pumped")}</div></div>
          <div class="field"><label for="amount">수유량 (ml)</label><input id="amount" name="amount" type="number" min="0" max="500" step="5" value="80" inputmode="numeric" /><small>직접 수유라면 0으로 두고 메모에 시간을 적어도 됩니다.</small></div>`;
      case "diaper":
        return `
          <div class="field"><span class="field-label">소변 양</span><div class="option-grid">${radioOptions("urine", [["small", "소량"], ["medium", "보통"], ["large", "많음"]], "medium")}</div></div>
          <div class="field"><span class="field-label">대변 상태</span><div class="option-grid two">${radioOptions("stool", [["none", "없음"], ["normal", "정상"], ["loose", "묽음"], ["hard", "단단함"]], "normal")}</div></div>
          <div class="field"><span class="field-label">색상</span><div class="option-grid">${radioOptions("color", [["yellow", "노란색"], ["green", "초록색"], ["brown", "갈색"]], "yellow")}</div></div>`;
      case "sleep":
        return `<div class="field"><label for="duration">수면 시간 (분)</label><input id="duration" name="duration" type="number" min="1" max="720" value="45" inputmode="numeric" required /><small>종료 시점에 총 수면 시간을 입력합니다.</small></div>`;
      case "temperature":
        return `<div class="field"><label for="temperature">체온 (℃)</label><input id="temperature" name="value" type="number" min="34" max="43" step="0.1" value="36.8" inputmode="decimal" required /><small>앱은 기록을 돕는 도구이며 의료적 판단을 대신하지 않습니다.</small></div>`;
      case "bath":
        return `<div class="field"><label for="bath-type">목욕 구분</label><select id="bath-type" name="bathType"><option>전신 목욕</option><option>부분 세정</option><option>배꼽 관리</option></select></div><div class="field"><label for="bath-water-temperature">물 온도 (℃)</label><input id="bath-water-temperature" name="waterTemperature" type="number" min="30" max="45" step="0.1" value="38.0" inputmode="decimal" /></div><div class="field"><label for="bath-note">피부·배꼽 관찰 메모</label><textarea id="bath-note" name="note" placeholder="발진, 건조함, 배꼽 주변 등 관찰한 사실을 기록하세요."></textarea></div>`;
      case "weight":
        return `<div class="field"><label for="baby-weight">아기 체중 (kg)</label><input id="baby-weight" name="value" type="number" min="1" max="20" step="0.01" value="3.80" inputmode="decimal" required /><small>동일한 저울과 비슷한 조건에서 측정하면 추이를 비교하기 쉽습니다.</small></div>`;
      case "mother":
        return `
          <div class="field"><label for="care">케어 항목</label><select id="care" name="care"><option>Light stretching</option><option>Breast care</option><option>Meal support</option><option>Rest support</option><option>Other</option></select></div>
          <div class="field"><label for="mother-note">간단한 메모</label><textarea id="mother-note" name="note" placeholder="산모의 상태와 제공한 케어를 간단히 기록하세요."></textarea></div>`;
      case "meal":
        return `<div class="form-grid two"><div class="field"><label for="meal-type">식사 구분</label><select id="meal-type" name="mealType"><option>아침</option><option>점심</option><option>저녁</option><option>간식</option><option>분유·우유</option></select></div><div class="field"><label for="meal-appetite">섭취 정도</label><select id="meal-appetite" name="appetite"><option>잘 먹음</option><option>보통</option><option>조금 먹음</option><option>거부함</option></select></div></div><div class="field"><label for="meal-menu">메뉴·양</label><input id="meal-menu" name="menu" placeholder="예: 닭고기 야채죽 1그릇" required /></div><div class="field"><label for="meal-note">식사 메모</label><textarea id="meal-note" name="note" placeholder="알러지 확인, 반응, 보호자에게 전달할 내용을 적어주세요."></textarea></div>`;
      case "sitter_note":
        return `<div class="field"><label for="sitter-category">이벤트 구분</label><select id="sitter-category" name="category"><option>놀이</option><option>산책</option><option>낮잠</option><option>배변</option><option>등원·하원</option><option>안전 확인</option><option>기타</option></select></div><div class="field"><label for="sitter-note-text">활동·특이 이벤트</label><textarea id="sitter-note-text" name="text" placeholder="무엇을 했는지, 아이의 반응과 보호자 인계사항을 사실 중심으로 기록하세요." required></textarea><small>의료적 판단 대신 관찰한 사실과 조치만 기록합니다.</small></div>`;
      case "note":
      default:
        return `<div class="field"><label for="note-text">케어 메모</label><textarea id="note-text" name="text" placeholder="특이사항이나 보호자에게 공유할 내용을 기록하세요." required></textarea><small>진단이나 확정적 의료 판단 대신 관찰한 사실을 기록하세요.</small></div>`;
    }
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

  function openLogModal(type) {
    const assignment = activeAssignmentContext();
    if (!assignment || !state.session.active || state.session.assignmentId !== assignment.id) {
      showToast("케어 세션을 먼저 시작해 주세요.");
      return;
    }
    if (activeSessionIsStale(assignment)) {
      showToast("이전 근무일의 미종료 세션에는 새 기록을 추가할 수 없습니다. 먼저 케어를 종료해 주세요.", "error");
      return;
    }
    const allowedTypes = assignmentServiceType(assignment) === "BABYSITTING" ? ["meal", "sitter_note"] : ["feeding", "diaper", "sleep", "temperature", "bath", "weight", "mother", "note"];
    if (!allowedTypes.includes(type)) return showToast("현재 배정 서비스에서 사용할 수 없는 기록 항목입니다.");
    const client = clientById(assignment.clientId);
    if (!client) return showToast("배정된 고객 정보를 확인할 수 없어 기록 화면을 열지 않았습니다.", "error");
    const meta = EVENT_META[type] || EVENT_META.note;
    const babyName = babyNameFor(assignment, client) || "아이";
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop>
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="log-modal-title">
          <header class="modal-header">
            <div class="modal-title-wrap"><div class="quick-icon">${meta.icon}</div><div><h3 id="log-modal-title">${meta.label} 기록</h3><p>${meta.subtitle} · ${escapeHtml(babyName)}</p></div></div>
            <button class="close-button" data-close-modal aria-label="닫기">×</button>
          </header>
          <form class="modal-form" data-log-form data-log-form-type="${type}">
            <div class="field"><label for="event-time">기록 시간</label><input id="event-time" name="time" type="time" value="${defaultTimeValue()}" required /></div>
            ${fieldsForType(type)}
            <div class="form-actions"><button type="button" class="secondary-button" data-close-modal>취소</button><button type="submit" class="primary-button">기록 저장</button></div>
          </form>
        </section>
      </div>`;

    bindModalFrame();
    modalRoot.querySelector("[data-log-form]").addEventListener("submit", saveLogEvent);
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

  function eventDateFromTime(time) {
    const [hours, minutes] = time.split(":").map(Number);
    const dateKey = state.session.serviceDate || localDateKey(new Date());
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return date.toISOString();
  }

  async function saveLogEvent(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form.dataset.logFormType;
    const values = Object.fromEntries(new FormData(form).entries());
    const data = { ...values };
    delete data.time;

    ["amount", "duration", "value", "waterTemperature"].forEach((key) => {
      if (key in data) data[key] = data[key] === "" ? null : Number(data[key]);
    });

    if (usingCloudData()) {
      if (!state.session.id || !state.session.active) return showToast("케어를 시작한 뒤 기록할 수 있습니다.");
      if (activeSessionIsStale()) return showToast("이전 근무일의 미종료 세션에는 기록을 추가할 수 없습니다. 먼저 케어를 종료해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        await saveCareEventCloud({
          careSessionId: state.session.id,
          type,
          at: eventDateFromTime(values.time),
          data,
          notes: data.note || data.notes || null,
        });
        closeModal();
        await refreshCloudState();
        showToast(`${EVENT_META[type].label} 기록을 실제 데이터베이스에 저장했습니다.`);
      } catch (error) {
        showToast(friendlyErrorMessage(error, "케어 기록을 저장하지 못했습니다."), "error");
        submitButton.disabled = false;
      }
      return;
    }

    state.events.push({
      id: `evt-${Date.now()}`,
      assignmentId: state.session.assignmentId,
      clientId: state.session.clientId,
      babyId: state.session.babyId,
      type,
      at: eventDateFromTime(values.time),
      author: authUser().fullName,
      data,
    });
    saveState();
    closeModal();
    render();
    showToast(`${EVENT_META[type].label} 기록을 저장했습니다.`);
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
