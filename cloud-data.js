import { backendStatus, supabase } from "./supabase-client.js";

export const cloudEnabled = Boolean(backendStatus.configured && supabase);

const ROLE_PRIORITY = ["OWNER", "ADMIN", "CARE_MANAGER", "RETAIL_STAFF", "CAREGIVER", "CLIENT"];
const ROLE_TO_APP = {
  OWNER: "admin",
  ADMIN: "admin",
  CARE_MANAGER: "admin",
  RETAIL_STAFF: "retail",
  CAREGIVER: "caregiver",
  CLIENT: "client",
};

const EVENT_TO_APP = {
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
};

const APP_TO_EVENT = Object.fromEntries(Object.entries(EVENT_TO_APP).map(([databaseValue, appValue]) => [appValue, databaseValue]));

function throwIfError(result, operation) {
  if (result.error) {
    const error = new Error(result.error.message || `${operation}에 실패했습니다.`);
    error.cause = result.error;
    throw error;
  }
  return result.data;
}

function shortTime(value) {
  return value ? String(value).slice(0, 5) : "";
}

function easternDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function sessionTimestamp(row) {
  return new Date(row.ended_at || row.started_at || `${row.service_date}T12:00:00`).getTime();
}

function assignmentRunsOnDate(assignment, dateKey) {
  const weekdayTokens = [
    ["일", "SUN", "SUNDAY", "7"],
    ["월", "MON", "MONDAY", "1"],
    ["화", "TUE", "TUESDAY", "2"],
    ["수", "WED", "WEDNESDAY", "3"],
    ["목", "THU", "THURSDAY", "4"],
    ["금", "FRI", "FRIDAY", "5"],
    ["토", "SAT", "SATURDAY", "6"],
  ];
  const date = new Date(`${dateKey}T12:00:00`);
  const serviceDays = assignment.service_days?.length ? assignment.service_days : ["월", "화", "수", "목", "금"];
  return easternDateKey(assignment.starts_at) <= dateKey
    && dateKey <= easternDateKey(assignment.ends_at)
    && weekdayTokens[date.getDay()].some((token) => serviceDays.includes(token));
}

function appRoleFor(profile, roles, caregiverApplication, membership) {
  const assigned = ROLE_PRIORITY.find((role) => roles.some((item) => item.user_id === profile.id && item.role === role));
  if (assigned) return ROLE_TO_APP[assigned];
  if (caregiverApplication || profile.requested_role === "CAREGIVER") return "caregiver";
  if (membership || profile.requested_role === "CLIENT") return "client";
  return "client";
}

function assignmentStatus(row) {
  if (row.status === "CANCELLED") return "CANCELLED";
  if (row.status === "COMPLETED") return "COMPLETED";
  const now = Date.now();
  if (new Date(row.starts_at).getTime() <= now && now <= new Date(row.ends_at).getTime()) return "ACTIVE";
  return "SCHEDULED";
}

const TABLE_PAGE_SIZE = 500;
const TABLE_MAX_PAGES = 200;
const TABLE_ORDER_COLUMNS = Object.freeze({
  user_roles: ["user_id", "role"],
  client_members: ["client_id", "user_id"],
  client_management_profiles: ["client_id"],
  caregiver_hr_profiles: ["caregiver_id"],
});

async function table(name, columns = "*") {
  const rows = [];
  const orderColumns = TABLE_ORDER_COLUMNS[name] || ["id"];

  for (let page = 0; page < TABLE_MAX_PAGES; page += 1) {
    const from = page * TABLE_PAGE_SIZE;
    let query = supabase.from(name).select(columns);
    orderColumns.forEach((column) => {
      query = query.order(column, { ascending: true });
    });

    const pageRows = throwIfError(
      await query.range(from, from + TABLE_PAGE_SIZE - 1),
      `${name} 조회 (${page + 1}페이지)`,
    );
    if (!Array.isArray(pageRows)) {
      throw new Error(`${name} 조회 결과 형식이 올바르지 않습니다.`);
    }

    rows.push(...pageRows);
    if (pageRows.length < TABLE_PAGE_SIZE) return rows;
  }

  throw new Error(`${name} 조회가 안전 한도 ${TABLE_PAGE_SIZE * TABLE_MAX_PAGES}행을 초과했습니다.`);
}

export async function currentCloudSession() {
  if (!cloudEnabled) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signInCloud(identifier, password) {
  const email = String(identifier).trim().toLowerCase();
  const result = await supabase.auth.signInWithPassword({ email, password });
  return throwIfError(result, "로그인");
}

export async function signUpCloud(values, consentVersion) {
  const requestedRole = values.role === "caregiver" ? "CAREGIVER" : "CLIENT";
  const result = await supabase.auth.signUp({
    email: values.email.trim().toLowerCase(),
    password: values.password,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
      data: {
        full_name: values.fullName.trim(),
        phone: values.phone.trim(),
        requested_role: requestedRole,
        preferred_language: values.preferredLanguage?.trim() || "ko",
        address: values.address?.trim() || "",
        emergency_contact: values.emergencyContact?.trim() || "",
        certification_summary: values.certification?.trim() || "",
        consent_version: consentVersion,
        consent_granted_at: new Date().toISOString(),
        service_terms_consent: values.termsService === "on",
        privacy_consent: values.termsPrivacy === "on",
        sensitive_care_consent: values.termsSensitive === "on",
        marketing_consent: values.termsMarketing === "on",
      },
    },
  });
  return throwIfError(result, "회원가입");
}

export async function signOutCloud() {
  return throwIfError(await supabase.auth.signOut(), "로그아웃");
}

export async function recordMyCurrentConsentsCloud({
  serviceTerms,
  privacy,
  sensitiveCare,
  marketing = false,
}) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("record_my_current_consents", {
    p_service_terms: Boolean(serviceTerms),
    p_privacy: Boolean(privacy),
    p_sensitive_care: Boolean(sensitiveCare),
    p_marketing: Boolean(marketing),
  }), "필수 동의 저장");
}

export async function requestPasswordResetCloud(email) {
  return throwIfError(await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/?password-recovery=1`,
  }), "비밀번호 재설정 안내 발송");
}

export async function claimInitialAdminIfEligible(email) {
  void email;
}

async function loadCloudStateOnce(session) {
  if (!session?.user) throw new Error("로그인 세션이 없습니다.");

  const ownProfile = throwIfError(
    await supabase
      .from("profiles")
      .select("id, account_status")
      .eq("id", session.user.id)
      .maybeSingle(),
    "계정 상태 확인",
  );
  if (!ownProfile) throw new Error("회원 프로필을 불러오지 못했습니다. 잠시 후 다시 로그인해 주세요.");
  if (["SUSPENDED", "REJECTED"].includes(ownProfile.account_status)) {
    throw new Error("현재 이용이 중지된 계정입니다. ProMoms 관리자에게 문의해 주세요.");
  }

  const [
    profiles,
    roles,
    clientMembers,
    clients,
    babies,
    caregiverApplications,
    caregivers,
    clientManagement,
    caregiverHr,
    serviceRequests,
    contracts,
    assignments,
    careSessions,
    careEvents,
    serviceAdjustments,
    reviews,
    reports,
    deposits,
    balanceTransactions,
    shiftChecks,
    assignmentBriefs,
  ] = await Promise.all([
    table("profiles"),
    table("user_roles"),
    table("client_members"),
    table("clients"),
    table("babies"),
    table("caregiver_applications"),
    table("caregivers"),
    table("client_management_profiles"),
    table("caregiver_hr_profiles"),
    table("client_service_requests"),
    table("care_contracts"),
    table("care_assignments"),
    table("care_sessions"),
    table("care_events"),
    table("service_adjustment_requests"),
    table("caregiver_reviews"),
    table("care_reports"),
    table("deposit_transactions"),
    table("service_balance_transactions"),
    table("care_shift_checks"),
    throwIfError(await supabase.rpc("my_assignment_briefs"), "배정 안전정보 조회"),
  ]);

  const roleMap = new Map();
  roles.forEach((item) => {
    if (!roleMap.has(item.user_id)) roleMap.set(item.user_id, []);
    roleMap.get(item.user_id).push(item);
  });
  const memberByUser = new Map(clientMembers.map((item) => [item.user_id, item]));
  const membersByClient = new Map();
  clientMembers.forEach((member) => {
    if (!membersByClient.has(member.client_id)) membersByClient.set(member.client_id, []);
    membersByClient.get(member.client_id).push(member);
  });
  const applicationByUser = new Map(caregiverApplications.map((item) => [item.user_id, item]));
  const caregiverByUser = new Map(caregivers.map((item) => [item.user_id, item]));
  const caregiverById = new Map(caregivers.map((item) => [item.id, item]));
  const caregiverHrById = new Map(caregiverHr.map((item) => [item.caregiver_id, item]));
  const managementByClient = new Map(clientManagement.map((item) => [item.client_id, item]));
  const babiesByClient = new Map();
  const babyById = new Map();
  babies.forEach((baby) => {
    babyById.set(baby.id, baby);
    if (!babiesByClient.has(baby.client_id)) babiesByClient.set(baby.client_id, []);
    babiesByClient.get(baby.client_id).push(baby);
  });
  const requestsByClient = new Map();
  serviceRequests.forEach((request) => {
    if (!requestsByClient.has(request.client_id)) requestsByClient.set(request.client_id, []);
    requestsByClient.get(request.client_id).push(request);
  });
  const contractById = new Map(contracts.map((item) => [item.id, item]));
  const requestByAssignment = new Map(serviceRequests.filter((item) => item.approved_assignment_id).map((item) => [item.approved_assignment_id, item]));
  const sessionsByAssignment = new Map();
  careSessions.forEach((item) => {
    if (!sessionsByAssignment.has(item.assignment_id)) sessionsByAssignment.set(item.assignment_id, []);
    sessionsByAssignment.get(item.assignment_id).push(item);
  });
  sessionsByAssignment.forEach((items) => items.sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a)));
  const todayKey = easternDateKey();
  const todaySessionForAssignment = (assignmentId) => (sessionsByAssignment.get(assignmentId) || []).find((item) => item.service_date === todayKey) || null;
  const latestCompletedSessionForAssignment = (assignmentId) => (sessionsByAssignment.get(assignmentId) || []).find((item) => item.status === "COMPLETED") || null;
  const profileById = new Map(profiles.map((item) => [item.id, item]));
  const briefByAssignment = new Map(assignmentBriefs.map((item) => [item.assignment_id, item]));
  const briefByClient = new Map(assignmentBriefs.map((item) => [item.client_id, item]));

  const appUsers = profiles.map((profile) => {
    const caregiverApplication = applicationByUser.get(profile.id);
    const caregiver = caregiverByUser.get(profile.id);
    const hr = caregiver ? caregiverHrById.get(caregiver.id) : null;
    const databaseRoles = (roleMap.get(profile.id) || []).map((item) => item.role);
    const role = appRoleFor(profile, roleMap.get(profile.id) || [], caregiverApplication, memberByUser.get(profile.id));
    const hasCaregiverRole = databaseRoles.includes("CAREGIVER");
    const caregiverApproved = hasCaregiverRole && Boolean(caregiver);
    const accountUnavailable = ["SUSPENDED", "REJECTED"].includes(profile.account_status);
    return {
      id: profile.id,
      login: profile.email || "",
      email: profile.email || "",
      role,
      databaseRoles,
      isOwner: databaseRoles.includes("OWNER"),
      status: accountUnavailable ? "blocked" : role === "caregiver" ? (caregiverApproved ? "approved" : "pending") : (profile.account_status === "ACTIVE" ? "approved" : "pending"),
      caregiverStatus: accountUnavailable ? "blocked" : hasCaregiverRole ? (caregiverApproved ? "approved" : "pending") : null,
      accountStatus: profile.account_status,
      fullName: profile.full_name,
      initials: profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
      phone: profile.phone || "",
      preferredLanguage: profile.preferred_language || "",
      certification: hr?.career_summary || caregiverApplication?.certification_summary || "",
      hireDate: hr?.hire_date || null,
      careerYears: Number(hr?.career_years || 0),
      employmentStatus: hr?.employment_status || (caregiverApproved ? "INACTIVE" : "APPLICANT"),
      hasHrProfile: Boolean(hr),
      specialties: hr?.specialties || "",
      residentialArea: hr?.residential_area || "",
      serviceArea: hr?.service_area_notes || "",
      hrNotes: hr?.hr_notes || "",
      hrUpdatedAt: hr?.updated_at || null,
      caregiverId: caregiver?.id || null,
      applicationId: caregiverApplication?.id || null,
      applicationStatus: caregiverApplication?.status || null,
      createdAt: profile.created_at,
      approvedAt: caregiverApplication?.reviewed_at || null,
    };
  });

  assignmentBriefs.forEach((brief) => {
    if (!brief.caregiver_user_id || appUsers.some((user) => user.id === brief.caregiver_user_id)) return;
    const fullName = brief.caregiver_display_name || "담당 관리사";
    appUsers.push({
      id: brief.caregiver_user_id,
      login: "",
      email: "",
      role: "caregiver",
      databaseRoles: ["CAREGIVER"],
      isOwner: false,
      status: "approved",
      accountStatus: "ACTIVE",
      fullName,
      initials: fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
      phone: "",
      preferredLanguage: "",
      certification: brief.caregiver_certification_summary || "",
      caregiverId: null,
      restrictedAssignmentProfile: true,
    });
  });

  const appClients = clients.map((client) => {
    const clientMembersForClient = membersByClient.get(client.id) || [];
    const member = clientMembersForClient.find((item) => item.is_primary) || clientMembersForClient[0] || null;
    const profile = member ? profileById.get(member.user_id) : null;
    const clientBabies = (babiesByClient.get(client.id) || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const baby = clientBabies[0] || null;
    const management = managementByClient.get(client.id);
    const latestRequest = (requestsByClient.get(client.id) || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    return {
      id: client.id,
      userId: member?.user_id || null,
      memberUserIds: clientMembersForClient.map((item) => item.user_id),
      motherName: client.display_name,
      maternalStatus: management?.maternal_status || "서비스 신청 전",
      clientStatus: management?.lifecycle_status || client.status,
      approvalStatus: latestRequest?.status || "ACCOUNT_ACTIVE",
      preferredLanguage: management?.preferred_language || profile?.preferred_language || briefByClient.get(client.id)?.preferred_language || "",
      emergencyContact: management?.emergency_contact || client.emergency_contact || briefByClient.get(client.id)?.emergency_contact || "",
      nextContactDate: management?.next_contact_date || null,
      internalMemo: management?.internal_memo || "",
      babyAdminNotes: management?.baby_admin_notes || "",
      babyId: baby?.id || null,
      babyName: baby?.first_name || "",
      babyBirthDate: baby?.birth_date || latestRequest?.birth_or_due_date || null,
      babies: clientBabies.map((item) => ({ id: item.id, name: item.first_name || "", birthDate: item.birth_date || null, adminNotes: item.notes || "" })),
      address: client.service_address || latestRequest?.service_address || "",
      allergies: client.allergy_notes || latestRequest?.allergy_notes || "",
      extraHouseholdMembers: client.household_extra_people ?? latestRequest?.household_extra_people ?? 0,
      requestNote: client.notes || latestRequest?.special_notes || "",
      managementUpdatedAt: management?.updated_at || null,
    };
  });

  const appAssignments = assignments.map((assignment) => {
    const contract = contractById.get(assignment.contract_id);
    const caregiver = caregiverById.get(assignment.caregiver_id);
    const request = requestByAssignment.get(assignment.id);
    const brief = briefByAssignment.get(assignment.id);
    const todaySession = todaySessionForAssignment(assignment.id);
    const latestCompletedSession = latestCompletedSessionForAssignment(assignment.id);
    const reportSession = latestCompletedSession;
    const assignmentBaby = babyById.get(contract?.baby_id || brief?.baby_id);
    return {
      id: assignment.id,
      serviceRequestId: request?.id || null,
      serviceType: assignment.service_type,
      clientId: contract?.client_id || brief?.client_id || null,
      babyId: contract?.baby_id || brief?.baby_id || null,
      babyName: assignmentBaby?.first_name || request?.baby_name || "",
      caregiverUserId: caregiver?.user_id || brief?.caregiver_user_id || null,
      caregiverName: brief?.caregiver_display_name || "",
      caregiverCertification: brief?.caregiver_certification_summary || "",
      caregiverId: assignment.caregiver_id,
      weeks: assignment.contract_weeks || request?.requested_weeks || 2,
      weeklyRate: Number(assignment.weekly_rate || 0) || null,
      contractValue: Number(assignment.contract_value || 0) || null,
      depositAmount: Number(assignment.deposit_amount || 0) || null,
      depositStatus: assignment.deposit_status,
      depositPaidAt: assignment.deposit_paid_at,
      startAt: assignment.starts_at,
      endAt: assignment.ends_at,
      dailyStart: shortTime(assignment.daily_start_time),
      dailyEnd: shortTime(assignment.daily_end_time),
      daysOfWeek: assignment.service_days || [],
      address: assignment.service_address || "",
      extraHouseholdMembers: assignment.household_extra_people || 0,
      allergies: assignment.allergy_notes || "",
      requestNote: assignment.client_request_note || "",
      maternalNotes: assignment.maternal_notes || "",
      mealInstructions: assignment.meal_instructions || "",
      routineNotes: assignment.routine_notes || "",
      pickupNotes: assignment.pickup_notes || "",
      status: assignmentStatus(assignment),
      databaseStatus: assignment.status,
      careSessionId: reportSession?.id || null,
      careSessionStatus: reportSession?.status || null,
      careSessionDate: reportSession?.service_date || null,
      todayCareSessionId: todaySession?.id || null,
      todayCareSessionStatus: todaySession?.status || null,
      todayCareSessionEndedAt: todaySession?.ended_at || null,
      lastCompletedCareAt: latestCompletedSession?.ended_at || null,
      createdAt: assignment.created_at,
    };
  });

  const appDeposits = deposits.map((item) => ({
    ...item,
    requestId: item.client_service_request_id,
    clientId: item.client_id,
    paymentMethod: item.payment_method,
    externalReference: item.external_reference,
    capturedAt: item.captured_at,
    refundReference: item.refund_reference,
    refundedAmount: Number(item.refunded_amount || 0),
    refundedAt: item.refunded_at,
    recordedBy: item.recorded_by,
  }));
  const appBalanceTransactions = balanceTransactions.map((item) => ({
    ...item,
    requestId: item.client_service_request_id,
    clientId: item.client_id,
    amount: Number(item.amount || 0),
    paymentMethod: item.payment_method,
    externalReference: item.external_reference,
    capturedAt: item.captured_at,
    refundReference: item.refund_reference,
    refundedAmount: Number(item.refunded_amount || 0),
    refundedAt: item.refunded_at,
    recordedBy: item.recorded_by,
  }));

  const appRequests = serviceRequests.map((request) => ({
    id: request.id,
    requestKind: request.request_kind,
    serviceType: request.service_type,
    clientId: request.client_id,
    babyId: request.baby_id,
    babyName: babyById.get(request.baby_id)?.first_name || "",
    userId: request.requested_by,
    status: request.status,
    weeks: request.requested_weeks,
    weeklyRate: Number(request.weekly_rate || 0) || null,
    estimatedTotal: Number(request.estimated_total || 0) || null,
    depositAmount: Number(request.deposit_amount || 0) || null,
    depositStatus: request.deposit_status,
    depositPaidAt: request.deposit_paid_at,
    desiredStartDate: `${request.desired_start_date}T12:00:00`,
    dailyStart: shortTime(request.daily_start_time),
    dailyEnd: shortTime(request.daily_end_time),
    daysOfWeek: request.requested_days || [],
    address: request.service_address,
    extraHouseholdMembers: request.household_extra_people,
    allergies: request.allergy_notes,
    specialNotes: request.special_notes || "",
    maternalNotes: request.maternal_notes || "",
    mealInstructions: request.meal_instructions || "",
    routineNotes: request.routine_notes || "",
    pickupNotes: request.pickup_notes || "",
    birthOrDueDate: request.birth_or_due_date,
    approvedAssignmentId: request.approved_assignment_id,
    createdAt: request.created_at,
    approvedAt: request.reviewed_at,
    reviewNote: request.review_note || "",
    depositTransaction: appDeposits.find((item) => item.requestId === request.id) || null,
    balanceTransactions: appBalanceTransactions.filter((item) => item.requestId === request.id),
  }));

  const assignmentBySession = new Map(careSessions.map((item) => [item.id, appAssignments.find((assignment) => assignment.id === item.assignment_id)]));
  const appEvents = careEvents.map((event) => {
    const assignment = assignmentBySession.get(event.care_session_id);
    const creator = profileById.get(event.created_by);
    return {
      id: event.id,
      careSessionId: event.care_session_id,
      assignmentId: assignment?.id,
      clientId: assignment?.clientId,
      babyId: assignment?.babyId,
      type: EVENT_TO_APP[event.event_type] || "note",
      at: event.event_time,
      author: creator?.full_name || "ProMoms",
      data: event.payload || {},
    };
  });

  const currentUser = appUsers.find((item) => item.id === session.user.id);
  if (!currentUser) throw new Error("회원 프로필을 불러오지 못했습니다. 잠시 후 다시 로그인해 주세요.");
  if (currentUser.accountStatus === "SUSPENDED" || currentUser.accountStatus === "REJECTED") {
    throw new Error("현재 이용이 중지된 계정입니다. ProMoms 관리자에게 문의해 주세요.");
  }
  const currentUserIsCaregiver = currentUser.databaseRoles?.includes("CAREGIVER");
  const todayAssignments = appAssignments
    .filter((item) => item.status === "ACTIVE" && assignmentRunsOnDate(assignments.find((row) => row.id === item.id), todayKey) && (currentUserIsCaregiver ? item.caregiverUserId === currentUser.id : true))
    .sort((a, b) => String(a.dailyStart).localeCompare(String(b.dailyStart)));
  const recoveredCareSession = currentUserIsCaregiver
    ? [...careSessions]
      .filter((item) => item.status === "IN_PROGRESS")
      .sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a))
      .find((item) => appAssignments.find((assignment) => assignment.id === item.assignment_id)?.caregiverUserId === currentUser.id) || null
    : null;
  const recoveredAssignment = recoveredCareSession ? appAssignments.find((item) => item.id === recoveredCareSession.assignment_id) || null : null;
  const currentAssignment = recoveredAssignment
    || todayAssignments.find((item) => item.todayCareSessionStatus === "IN_PROGRESS")
    || todayAssignments.find((item) => !["COMPLETED", "CANCELLED"].includes(item.todayCareSessionStatus))
    || todayAssignments.at(-1)
    || null;
  const currentCareSession = recoveredCareSession || (currentAssignment ? todaySessionForAssignment(currentAssignment.id) : null);
  const currentClient = currentAssignment ? appClients.find((item) => item.id === currentAssignment.clientId) : null;
  const shiftChecklists = {};
  shiftChecks
    .filter((item) => item.service_date === todayKey)
    .forEach((item) => {
      shiftChecklists[item.assignment_id] ||= {};
      shiftChecklists[item.assignment_id][item.check_key] = Boolean(item.checked);
    });
  return {
    currentUser,
    users: appUsers,
    clients: appClients,
    assignments: appAssignments,
    serviceRequests: appRequests,
    depositTransactions: appDeposits,
    balanceTransactions: appBalanceTransactions,
    serviceAdjustments: serviceAdjustments.map((item) => ({
      id: item.id,
      targetType: item.care_assignment_id ? "ASSIGNMENT" : "REQUEST",
      targetId: item.care_assignment_id || item.client_service_request_id,
      clientId: item.client_id,
      userId: item.requested_by,
      serviceType: item.service_type,
      action: item.action,
      proposedStartDate: item.proposed_start_date,
      proposedDailyStart: shortTime(item.proposed_daily_start_time),
      proposedDailyEnd: shortTime(item.proposed_daily_end_time),
      proposedWeeks: item.proposed_weeks,
      reason: item.reason,
      policyCode: item.policy_code,
      policyTitle: item.policy_snapshot?.title || item.policy_code,
      policyDetail: item.policy_snapshot?.detail || "",
      originalContractValue: Number(item.original_contract_value || 0) || null,
      remainingCareDays: item.remaining_care_days,
      cancellationSettlementAmount: Number(item.cancellation_settlement_amount || 0) || null,
      cancellationFormula: item.cancellation_formula || "",
      status: item.status,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
      reviewNote: item.review_note || "",
    })),
    shiftChecklists,
    events: appEvents,
    reviews: reviews.map((item) => ({
      id: item.id,
      assignmentId: item.assignment_id,
      clientId: item.client_id,
      caregiverId: item.caregiver_id,
      caregiverUserId: caregiverById.get(item.caregiver_id)?.user_id || null,
      rating: item.rating,
      tags: item.tags,
      comment: item.comment,
      createdAt: item.created_at,
    })),
    reports: reports.map((item) => {
      const assignment = assignmentBySession.get(item.care_session_id);
      return {
        id: item.id,
        careSessionId: item.care_session_id,
        assignmentId: assignment?.id || null,
        clientId: assignment?.clientId || null,
        serviceType: assignment?.serviceType || null,
        title: item.summary || "Care Report",
        structuredSummary: item.structured_summary || {},
        status: item.status.toLowerCase(),
        publishedAt: item.published_at,
      };
    }),
    careSessions: careSessions.map((item) => ({
      id: item.id,
      assignmentId: item.assignment_id,
      serviceDate: item.service_date,
      status: item.status,
      startedAt: item.started_at,
      endedAt: item.ended_at,
    })),
    session: {
      id: currentCareSession?.id || null,
      assignmentId: currentAssignment?.id || null,
      clientId: currentAssignment?.clientId || null,
      babyId: currentAssignment?.babyId || null,
      serviceDate: currentCareSession?.service_date || null,
      active: currentCareSession?.status === "IN_PROGRESS",
      startedAt: currentCareSession?.started_at || null,
      endedAt: currentCareSession?.ended_at || null,
      clientName: currentClient?.motherName || "",
      babyName: currentAssignment?.babyName || currentClient?.babyName || "",
      babyInitial: (currentAssignment?.babyName || currentClient?.babyName || "")[0] || "",
      caregiverName: currentUserIsCaregiver ? currentUser.fullName : "",
      schedule: currentAssignment ? `${currentAssignment.dailyStart} – ${currentAssignment.dailyEnd}` : "",
      address: currentAssignment?.address || "",
    },
  };
}

const AUTH_CLOCK_RETRY_DELAYS = [1000, 2000, 3000, 4000];

function isAuthClockSkewError(error) {
  const message = String(error?.message || error?.cause?.message || "").toLowerCase();
  return message.includes("jwt issued at future")
    || message.includes("jwt issued in the future")
    || message.includes("token is not yet valid");
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function loadCloudState(session) {
  let lastError;
  for (let attempt = 0; attempt <= AUTH_CLOCK_RETRY_DELAYS.length; attempt += 1) {
    try {
      return await loadCloudStateOnce(session);
    } catch (error) {
      lastError = error;
      if (!isAuthClockSkewError(error)) throw error;
      if (attempt === AUTH_CLOCK_RETRY_DELAYS.length) break;
      await wait(AUTH_CLOCK_RETRY_DELAYS[attempt]);
    }
  }

  const error = new Error("인증 서버와 데이터 서버를 동기화하는 중입니다. 잠시 후 다시 시도해 주세요.");
  error.cause = lastError;
  throw error;
}

export async function submitServiceRequestCloud(values, derived) {
  return throwIfError(await supabase.rpc("submit_client_service_request", {
    p_service_type: values.serviceType,
    p_baby_id: derived.babyId || null,
    p_baby_name: values.babyName.trim(),
    p_birth_or_due_date: derived.birthOrDueDate,
    p_requested_weeks: Number(values.requestedWeeks),
    p_desired_start_date: values.desiredStartDate,
    p_daily_start_time: values.requestedDailyStart,
    p_daily_end_time: values.requestedDailyEnd,
    p_requested_days: derived.daysOfWeek,
    p_service_address: values.requestAddress.trim(),
    p_household_extra_people: Number(values.requestHousehold || 0),
    p_allergy_notes: values.requestAllergies.trim(),
    p_special_notes: values.requestSpecialNotes?.trim() || null,
    p_maternal_notes: values.maternalNotes?.trim() || null,
    p_meal_instructions: values.mealInstructions?.trim() || null,
    p_routine_notes: values.routineNotes?.trim() || null,
    p_pickup_notes: values.pickupNotes?.trim() || null,
    p_request_kind: derived.requestKind,
    p_sequence_policy_accepted: values.requestConsent === "on",
    p_insured_staffing_acknowledged: values.requestConsent === "on",
  }), "서비스 신청 저장");
}

export async function reviewServiceRequestCloud(requestId, approve, note = null, payment = null) {
  return throwIfError(await supabase.rpc("review_service_request_with_dated_deposit", {
    p_request_id: requestId,
    p_approve: approve,
    p_review_note: note,
    p_payment_method: approve ? payment?.method || null : null,
    p_payment_reference: approve ? payment?.reference || null : null,
    p_received_on: approve ? payment?.receivedOn || null : null,
  }), "서비스 신청 검토");
}

export async function recordApprovedRequestDepositEvidenceCloud({ requestId, paymentMethod, paymentReference, receivedOn }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("record_approved_request_deposit_evidence_dated", {
    p_request_id: requestId,
    p_payment_method: String(paymentMethod || "").trim(),
    p_payment_reference: String(paymentReference || "").trim(),
    p_received_on: receivedOn,
  }), "기존 예약금 증빙 보완");
}

export async function recordServiceBalancePaymentCloud({ requestId, amount, paymentMethod, paymentReference, receivedOn }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("record_service_balance_payment_dated", {
    p_request_id: requestId,
    p_amount: Number(amount),
    p_payment_method: String(paymentMethod || "").trim(),
    p_payment_reference: String(paymentReference || "").trim(),
    p_received_on: receivedOn,
  }), "서비스 잔금 수납 기록");
}

export async function recordRetrospectiveCareReportCloud({ assignmentId, serviceDate, startedTime, endedTime, summary }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("record_retrospective_care_report", {
    p_assignment_id: assignmentId,
    p_service_date: serviceDate,
    p_started_time: startedTime,
    p_ended_time: endedTime,
    p_summary: String(summary || "").trim(),
  }), "지난 근무 리포트 저장");
}

export async function scheduleServiceRequestCloud(requestId, caregiverId) {
  return throwIfError(await supabase.rpc("schedule_approved_client_request", {
    p_request_id: requestId,
    p_caregiver_id: caregiverId,
  }), "관리사 일정 배정");
}

export async function recordDepositRefundCloud({ requestId, refundReference }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("record_deposit_refund", {
    p_request_id: requestId,
    p_refund_reference: String(refundReference || "").trim(),
  }), "예약금 환불 기록");
}

export async function reassignCaregiverCloud({ assignmentId, caregiverId, reason }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("admin_reassign_caregiver", {
    p_assignment_id: assignmentId,
    p_caregiver_id: caregiverId,
    p_reason: String(reason || "").trim(),
  }), "관리사 재배정");
}

export async function setCareSessionStatusCloud(assignmentId, status) {
  return throwIfError(await supabase.rpc("set_care_session_status", {
    p_assignment_id: assignmentId,
    p_status: status,
  }), "케어 세션 상태 저장");
}

export async function setCareShiftCheckCloud(assignmentId, checkKey, checked) {
  return throwIfError(await supabase.rpc("set_care_shift_check", {
    p_assignment_id: assignmentId,
    p_check_key: checkKey,
    p_checked: Boolean(checked),
  }), "근무 전 확인사항 저장");
}

export async function saveCareEventCloud({ careSessionId, type, at, data, notes = null }) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  return throwIfError(await supabase.from("care_events").insert({
    care_session_id: careSessionId,
    event_type: APP_TO_EVENT[type] || "NOTE",
    event_time: at,
    payload: data,
    notes,
    unusual_observation: false,
    created_by: authData.user.id,
  }).select("id").single(), "케어 기록 저장");
}

export async function approveCaregiverCloud(userId, note = null) {
  return throwIfError(await supabase.rpc("approve_caregiver", {
    applicant_user_id: userId,
    approval_note: note,
  }), "관리사 승인");
}

export async function setMemberStatusCloud(userId, status) {
  return throwIfError(await supabase.rpc("set_member_account_status", {
    p_user_id: userId,
    p_status: status,
  }), "회원 상태 변경");
}

export async function changeMemberRoleCloud(userId, role) {
  return throwIfError(await supabase.rpc("admin_change_member_role", {
    p_user_id: userId,
    p_role: role,
  }), "회원 종류 변경");
}

export async function setMemberAccessRolesCloud(userId, roles) {
  return throwIfError(await supabase.rpc("admin_set_member_access_roles", {
    p_user_id: userId,
    p_roles: roles,
  }), "회원 접근 권한 구성");
}

export async function archiveMemberCloud(userId) {
  return throwIfError(await supabase.rpc("admin_archive_member", {
    p_user_id: userId,
  }), "회원 삭제");
}

async function authenticatedUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("로그인이 필요합니다.");
  return data.user.id;
}

export async function updateClientManagementCloud(client, values) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("admin_update_client_management", {
    p_client_id: client.id,
    p_baby_id: values.babyId || client.babyId || null,
    p_full_name: values.fullName.trim(),
    p_phone: values.phone.trim() || null,
    p_lifecycle_status: values.clientStatus,
    p_request_note: values.requestNote.trim() || null,
    p_baby_name: values.babyName.trim(),
    p_baby_birth_date: values.babyBirthDate,
    p_baby_admin_notes: values.babyAdminNotes.trim() || null,
    p_maternal_status: values.maternalStatus.trim() || null,
    p_preferred_language: values.preferredLanguage.trim() || null,
    p_emergency_contact: values.emergencyContact.trim() || null,
    p_next_contact_date: values.nextContactDate || null,
    p_internal_memo: values.internalMemo.trim() || null,
  }), "고객 관리정보 저장");
}

export async function updateCaregiverManagementCloud(user, values) {
  await authenticatedUserId();
  if (!user.caregiverId) throw new Error("승인된 관리사만 인사정보를 저장할 수 있습니다.");
  return throwIfError(await supabase.rpc("admin_update_caregiver_management", {
    p_caregiver_id: user.caregiverId,
    p_full_name: values.fullName.trim(),
    p_phone: values.phone.trim() || null,
    p_hire_date: values.hireDate || null,
    p_career_years: Number(values.careerYears || 0),
    p_employment_status: values.employmentStatus,
    p_career_summary: values.certification.trim() || null,
    p_specialties: values.specialties.trim() || null,
    p_residential_area: values.residentialArea.trim() || null,
    p_service_area_notes: values.serviceArea.trim() || null,
    p_hr_notes: values.hrNotes.trim() || null,
  }), "관리사 인사정보 저장");
}

export async function updatePasswordCloud(password) {
  return throwIfError(await supabase.auth.updateUser({ password }), "비밀번호 변경");
}

export async function updateMyProfileCloud(values) {
  const fullName = values.fullName.trim();
  const phone = values.phone.trim() || null;
  const preferredLanguage = values.preferredLanguage.trim() || "ko";
  await authenticatedUserId();
  throwIfError(await supabase.rpc("update_my_profile", {
    p_full_name: fullName,
    p_phone: phone,
    p_preferred_language: preferredLanguage,
  }), "프로필 저장");
  const metadataSync = await supabase.auth.updateUser({
    data: {
      full_name: fullName,
      phone: phone || "",
      preferred_language: preferredLanguage,
    },
  });
  if (metadataSync.error) console.warn("Profile metadata sync deferred", metadataSync.error.message);
}

export async function updateMyClientProfileCloud(values) {
  const result = throwIfError(await supabase.rpc("update_my_client_profile", {
    p_full_name: values.fullName.trim(),
    p_phone: values.phone.trim() || null,
    p_preferred_language: values.preferredLanguage.trim() || "ko",
    p_baby_id: values.babyId || null,
    p_baby_name: values.babyName.trim(),
    p_baby_birth_date: values.babyBirthDate,
    p_service_address: values.serviceAddress.trim(),
    p_allergy_notes: values.allergies?.trim() || null,
    p_household_extra_people: Number(values.extraHouseholdMembers || 0),
    p_emergency_contact: values.emergencyContact?.trim() || null,
    p_request_note: values.requestNote?.trim() || null,
  }), "고객·아기 프로필 저장");
  const metadataSync = await supabase.auth.updateUser({
    data: {
      full_name: values.fullName.trim(),
      phone: values.phone.trim(),
      preferred_language: values.preferredLanguage.trim() || "ko",
    },
  });
  if (metadataSync.error) console.warn("Client profile metadata sync deferred", metadataSync.error.message);
  return result;
}

export async function saveServiceReviewCloud({ assignmentId, clientId, caregiverId, rating, tags, comment }) {
  const userId = await authenticatedUserId();
  return throwIfError(await supabase.from("caregiver_reviews").insert({
    assignment_id: assignmentId,
    client_id: clientId,
    caregiver_id: caregiverId,
    rating,
    tags,
    comment,
    created_by: userId,
  }), "서비스 후기 저장");
}

export async function publishCareReportCloud({ careSessionId, title }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("publish_care_report", {
    p_care_session_id: careSessionId,
    p_title: String(title || "").trim(),
  }), "케어 리포트 발행");
}

export async function submitServiceAdjustmentCloud({
  targetType,
  targetId,
  action,
  proposedStartDate,
  proposedDailyStart,
  proposedDailyEnd,
  proposedWeeks,
  reason,
}) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("submit_service_adjustment", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_action: action,
    p_reason: reason.trim(),
    p_proposed_start_date: action === "CHANGE" ? proposedStartDate : null,
    p_proposed_daily_start_time: action === "CHANGE" ? proposedDailyStart : null,
    p_proposed_daily_end_time: action === "CHANGE" ? proposedDailyEnd : null,
    p_proposed_weeks: action === "CHANGE" ? Number(proposedWeeks) : null,
  }), "서비스 변경·취소 요청 저장");
}

export async function reviewServiceAdjustmentCloud(adjustmentId, approve, reviewNote = null) {
  return throwIfError(await supabase.rpc("review_service_adjustment", {
    p_adjustment_id: adjustmentId,
    p_approve: approve,
    p_review_note: reviewNote,
  }), "서비스 변경·취소 요청 검토");
}
