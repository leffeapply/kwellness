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

async function table(name, columns = "*") {
  return throwIfError(await supabase.from(name).select(columns), `${name} 조회`);
}

export async function currentCloudSession() {
  if (!cloudEnabled) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signInCloud(identifier, password) {
  const aliases = {
    admin: "admin@kwellness.test",
    retail: "retail@k-wellness.com",
  };
  const email = aliases[String(identifier).trim().toLowerCase()] || String(identifier).trim().toLowerCase();
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
        marketing_consent: values.termsMarketing === "on",
      },
    },
  });
  return throwIfError(result, "회원가입");
}

export async function signOutCloud() {
  return throwIfError(await supabase.auth.signOut(), "로그아웃");
}

export async function claimInitialAdminIfEligible(email) {
  void email;
}

export async function loadCloudState(session) {
  if (!session?.user) throw new Error("로그인 세션이 없습니다.");

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
  ]);

  const roleMap = new Map();
  roles.forEach((item) => {
    if (!roleMap.has(item.user_id)) roleMap.set(item.user_id, []);
    roleMap.get(item.user_id).push(item);
  });
  const memberByUser = new Map(clientMembers.map((item) => [item.user_id, item]));
  const memberByClient = new Map(clientMembers.map((item) => [item.client_id, item]));
  const applicationByUser = new Map(caregiverApplications.map((item) => [item.user_id, item]));
  const caregiverByUser = new Map(caregivers.map((item) => [item.user_id, item]));
  const caregiverById = new Map(caregivers.map((item) => [item.id, item]));
  const caregiverHrById = new Map(caregiverHr.map((item) => [item.caregiver_id, item]));
  const managementByClient = new Map(clientManagement.map((item) => [item.client_id, item]));
  const babiesByClient = new Map();
  babies.forEach((baby) => {
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
  const sessionByAssignment = new Map(careSessions.map((item) => [item.assignment_id, item]));
  const profileById = new Map(profiles.map((item) => [item.id, item]));

  const appUsers = profiles.map((profile) => {
    const caregiverApplication = applicationByUser.get(profile.id);
    const caregiver = caregiverByUser.get(profile.id);
    const hr = caregiver ? caregiverHrById.get(caregiver.id) : null;
    const role = appRoleFor(profile, roleMap.get(profile.id) || [], caregiverApplication, memberByUser.get(profile.id));
    const caregiverApproved = role === "caregiver" && Boolean(caregiver);
    return {
      id: profile.id,
      login: profile.email || "",
      email: profile.email || "",
      role,
      status: role === "caregiver" ? (caregiverApproved ? "approved" : "pending") : (profile.account_status === "ACTIVE" ? "approved" : "pending"),
      accountStatus: profile.account_status,
      fullName: profile.full_name,
      initials: profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
      phone: profile.phone || "",
      certification: caregiverApplication?.certification_summary || "",
      hireDate: hr?.hire_date || null,
      careerYears: Number(hr?.career_years || 0),
      employmentStatus: hr?.employment_status || (caregiverApproved ? caregiver.status : "APPLICANT"),
      specialties: hr?.specialties || "",
      residentialArea: hr?.residential_area || "",
      serviceArea: hr?.service_area_notes || "",
      hrNotes: hr?.hr_notes || "",
      caregiverId: caregiver?.id || null,
      applicationId: caregiverApplication?.id || null,
      applicationStatus: caregiverApplication?.status || null,
      createdAt: profile.created_at,
      approvedAt: caregiverApplication?.reviewed_at || null,
    };
  });

  const appClients = clients.map((client) => {
    const member = memberByClient.get(client.id);
    const profile = member ? profileById.get(member.user_id) : null;
    const clientBabies = (babiesByClient.get(client.id) || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const baby = clientBabies[0] || null;
    const management = managementByClient.get(client.id);
    const latestRequest = (requestsByClient.get(client.id) || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    return {
      id: client.id,
      userId: member?.user_id || null,
      motherName: client.display_name,
      maternalStatus: management?.maternal_status || "서비스 신청 전",
      clientStatus: management?.lifecycle_status || client.status,
      approvalStatus: latestRequest?.status || "ACCOUNT_ACTIVE",
      preferredLanguage: management?.preferred_language || profile?.preferred_language || "",
      emergencyContact: management?.emergency_contact || "",
      nextContactDate: management?.next_contact_date || null,
      internalMemo: management?.internal_memo || "",
      babyAdminNotes: management?.baby_admin_notes || "",
      babyId: baby?.id || null,
      babyName: baby?.first_name || "",
      babyBirthDate: baby?.birth_date || latestRequest?.birth_or_due_date || null,
      address: latestRequest?.service_address || "",
      allergies: latestRequest?.allergy_notes || "",
      extraHouseholdMembers: latestRequest?.household_extra_people || 0,
      requestNote: latestRequest?.special_notes || "",
    };
  });

  const appAssignments = assignments.map((assignment) => {
    const contract = contractById.get(assignment.contract_id);
    const caregiver = caregiverById.get(assignment.caregiver_id);
    const request = requestByAssignment.get(assignment.id);
    return {
      id: assignment.id,
      serviceRequestId: request?.id || null,
      serviceType: assignment.service_type,
      clientId: contract?.client_id,
      babyId: contract?.baby_id || null,
      caregiverUserId: caregiver?.user_id || null,
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
      createdAt: assignment.created_at,
    };
  });

  const appRequests = serviceRequests.map((request) => ({
    id: request.id,
    requestKind: request.request_kind,
    serviceType: request.service_type,
    clientId: request.client_id,
    babyId: request.baby_id,
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
      author: creator?.full_name || "K-Wellness",
      data: event.payload || {},
    };
  });

  const currentUser = appUsers.find((item) => item.id === session.user.id);
  if (!currentUser) throw new Error("회원 프로필을 불러오지 못했습니다. 이메일 인증 후 다시 로그인해 주세요.");
  if (currentUser.accountStatus === "SUSPENDED" || currentUser.accountStatus === "REJECTED") {
    throw new Error("현재 이용이 중지된 계정입니다. K-Wellness 관리자에게 문의해 주세요.");
  }
  const currentAssignment = appAssignments
    .filter((item) => item.status === "ACTIVE" && (currentUser.role === "caregiver" ? item.caregiverUserId === currentUser.id : true))
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0] || null;
  const currentCareSession = currentAssignment ? sessionByAssignment.get(currentAssignment.id) : null;
  const currentClient = currentAssignment ? appClients.find((item) => item.id === currentAssignment.clientId) : null;

  return {
    currentUser,
    users: appUsers,
    clients: appClients,
    assignments: appAssignments,
    serviceRequests: appRequests,
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
      status: item.status,
      createdAt: item.created_at,
    })),
    events: appEvents,
    reviews: reviews.map((item) => ({
      id: item.id,
      assignmentId: item.assignment_id,
      clientId: item.client_id,
      caregiverId: item.caregiver_id,
      rating: item.rating,
      tags: item.tags,
      comment: item.comment,
      createdAt: item.created_at,
    })),
    reports: reports.map((item) => ({
      id: item.id,
      careSessionId: item.care_session_id,
      title: item.summary || "Care Report",
      status: item.status.toLowerCase(),
      publishedAt: item.published_at,
    })),
    session: {
      id: currentCareSession?.id || null,
      assignmentId: currentAssignment?.id || null,
      clientId: currentAssignment?.clientId || null,
      babyId: currentAssignment?.babyId || null,
      active: currentCareSession?.status === "IN_PROGRESS",
      startedAt: currentCareSession?.started_at || null,
      endedAt: currentCareSession?.ended_at || null,
      clientName: currentClient?.motherName || "",
      babyName: currentClient?.babyName || "",
      babyInitial: currentClient?.babyName?.[0] || "",
      caregiverName: currentUser.role === "caregiver" ? currentUser.fullName : "",
      schedule: currentAssignment ? `${currentAssignment.dailyStart} – ${currentAssignment.dailyEnd}` : "",
      address: currentAssignment?.address || "",
    },
  };
}

export async function submitServiceRequestCloud(values, derived) {
  return throwIfError(await supabase.rpc("submit_client_service_request", {
    p_service_type: values.serviceType,
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
  }), "서비스 신청 저장");
}

export async function reviewServiceRequestCloud(requestId, approve, note = null) {
  return throwIfError(await supabase.rpc("review_client_service_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_review_note: note,
  }), "서비스 신청 검토");
}

export async function scheduleServiceRequestCloud(requestId, caregiverId) {
  return throwIfError(await supabase.rpc("schedule_approved_client_request", {
    p_request_id: requestId,
    p_caregiver_id: caregiverId,
  }), "관리사 일정 배정");
}

export async function setCareSessionStatusCloud(assignmentId, status) {
  return throwIfError(await supabase.rpc("set_care_session_status", {
    p_assignment_id: assignmentId,
    p_status: status,
  }), "케어 세션 상태 저장");
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
  const updaterId = await authenticatedUserId();
  const nextContactDate = values.nextContactDate || null;
  const results = await Promise.all([
    supabase.from("profiles").update({
      full_name: values.fullName.trim(),
      phone: values.phone.trim() || null,
    }).eq("id", client.userId),
    supabase.from("clients").update({
      display_name: values.fullName.trim(),
      status: values.clientStatus === "LEAD" ? "LEAD" : values.clientStatus === "COMPLETED" ? "INACTIVE" : "ACTIVE",
      notes: values.requestNote.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", client.id),
    client.babyId
      ? supabase.from("babies").update({
        first_name: values.babyName.trim(),
        birth_date: values.babyBirthDate,
        notes: values.babyAdminNotes.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq("id", client.babyId)
      : supabase.from("babies").insert({
        client_id: client.id,
        first_name: values.babyName.trim(),
        birth_date: values.babyBirthDate,
        notes: values.babyAdminNotes.trim() || null,
      }),
    supabase.from("client_management_profiles").upsert({
      client_id: client.id,
      lifecycle_status: values.clientStatus,
      maternal_status: values.maternalStatus.trim() || null,
      preferred_language: values.preferredLanguage.trim() || null,
      emergency_contact: values.emergencyContact.trim() || null,
      next_contact_date: nextContactDate,
      internal_memo: values.internalMemo.trim() || null,
      baby_admin_notes: values.babyAdminNotes.trim() || null,
      updated_by: updaterId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" }),
  ]);
  results.forEach((result) => throwIfError(result, "고객 관리정보 저장"));
}

export async function updateCaregiverManagementCloud(user, values) {
  const updaterId = await authenticatedUserId();
  if (!user.caregiverId) throw new Error("승인된 관리사만 인사정보를 저장할 수 있습니다.");
  const caregiverStatus = values.employmentStatus === "ON_LEAVE" ? "ON_LEAVE" : values.employmentStatus === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  const results = await Promise.all([
    supabase.from("profiles").update({
      full_name: values.fullName.trim(),
      phone: values.phone.trim() || null,
    }).eq("id", user.id),
    supabase.from("caregivers").update({
      status: caregiverStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", user.caregiverId),
    supabase.from("caregiver_hr_profiles").upsert({
      caregiver_id: user.caregiverId,
      hire_date: values.hireDate || null,
      career_years: Number(values.careerYears || 0),
      employment_status: values.employmentStatus === "APPLICANT" ? "ACTIVE" : values.employmentStatus,
      career_summary: values.certification.trim() || null,
      specialties: values.specialties.trim() || null,
      residential_area: values.residentialArea.trim() || null,
      service_area_notes: values.serviceArea.trim() || null,
      hr_notes: values.hrNotes.trim() || null,
      updated_by: updaterId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "caregiver_id" }),
  ]);
  results.forEach((result) => throwIfError(result, "관리사 인사정보 저장"));
}

export async function updatePasswordCloud(password) {
  return throwIfError(await supabase.auth.updateUser({ password }), "비밀번호 변경");
}
