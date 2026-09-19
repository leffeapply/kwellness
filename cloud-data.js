import { backendStatus, supabase } from "./supabase-client.js";
import {
  careEventTypeAllowedForService,
  isRecordableCareServiceType,
  normalizeCareServiceType,
} from "./care-service-scope.js";

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

function deviceDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sessionTimestamp(row) {
  return new Date(row.ended_at || row.started_at || `${row.service_date}T12:00:00`).getTime();
}

function assignmentContractCoversDate(assignment, dateKey) {
  if (!assignment || !dateKey) return false;
  const startDate = assignment.contractStartDate || deviceDateKey(assignment.startAt);
  const endDate = assignment.contractEndDate || deviceDateKey(assignment.endAt);
  return Boolean(startDate && endDate && startDate <= dateKey && dateKey <= endDate);
}

function appRoleFor(profile, roles, caregiverApplication, membership) {
  const assigned = ROLE_PRIORITY.find((role) => roles.some((item) => item.user_id === profile.id && item.role === role));
  if (assigned) return ROLE_TO_APP[assigned];
  if (caregiverApplication || profile.requested_role === "CAREGIVER") return "caregiver";
  if (membership || profile.requested_role === "CLIENT") return "client";
  return "client";
}

function assignmentStatus(row, contract, dateKey = deviceDateKey()) {
  if (row.status === "CANCELLED") return "CANCELLED";
  if (row.status === "COMPLETED") return "COMPLETED";
  const startDate = contract?.start_date || deviceDateKey(row.starts_at);
  const endDate = contract?.end_date || deviceDateKey(row.ends_at);
  if (startDate && endDate && startDate <= dateKey && dateKey <= endDate) return "ACTIVE";
  return "SCHEDULED";
}

const TABLE_PAGE_SIZE = 500;
const TABLE_MAX_PAGES = 200;
const TABLE_ORDER_COLUMNS = Object.freeze({
  user_roles: ["user_id", "role"],
  client_members: ["client_id", "user_id"],
  client_management_profiles: ["client_id"],
  caregiver_hr_profiles: ["caregiver_id"],
  caregiver_public_profiles: ["caregiver_id"],
  caregiver_review_publications: ["review_id"],
  massage_therapist_availability: ["available_date", "start_time"],
  massage_booking_sessions: ["starts_at", "session_number"],
  massage_booking_changes: ["created_at"],
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

function publicCaregiverPhotoUrl(photoPath) {
  if (!photoPath || !supabase) return "";
  const { data } = supabase.storage.from("caregiver-public-photos").getPublicUrl(photoPath);
  return data?.publicUrl || "";
}

function publicCaregiverReviewPhotoUrl(photoPath) {
  if (!photoPath || !supabase) return "";
  const { data } = supabase.storage.from("caregiver-review-photos").getPublicUrl(photoPath);
  return data?.publicUrl || "";
}

const REVIEW_COMPETENCY_KEYS = [
  "meal_preparation",
  "attentiveness",
  "punctuality",
  "professionalism",
  "communication",
  "hygiene_safety",
];

function reviewCompetencyScoresFromRow(row) {
  const source = row?.competency_scores && typeof row.competency_scores === "object"
    ? row.competency_scores
    : Object.fromEntries(REVIEW_COMPETENCY_KEYS.map((key) => [key, row?.[`${key}_score`]]));
  const normalized = {};
  for (const key of REVIEW_COMPETENCY_KEYS) {
    const value = Number(source?.[key]);
    if (!Number.isFinite(value) || value < 1 || value > 5) return null;
    normalized[key] = value;
  }
  return normalized;
}

function normalizePublicCaregiver(row) {
  const reviews = Array.isArray(row?.reviews) ? row.reviews : [];
  const distribution = row?.rating_distribution && typeof row.rating_distribution === "object"
    ? row.rating_distribution
    : {};
  const competencyAverages = reviewCompetencyScoresFromRow({ competency_scores: distribution.competencies });
  const supportedServiceCapabilities = new Set(["POSTPARTUM", "BABYSITTING", "MASSAGE"]);
  const serviceCapabilities = (Array.isArray(row?.service_capabilities) ? row.service_capabilities : ["POSTPARTUM", "BABYSITTING"])
    .filter((serviceType) => supportedServiceCapabilities.has(serviceType));
  return {
    caregiverId: row.caregiver_id,
    caregiverUserId: row.user_id || null,
    displayName: row.display_name || "ProMoms 관리사",
    headline: row.headline || "가족의 일상을 세심하게 돌봅니다.",
    biography: row.biography || "",
    photoPath: row.photo_path || "",
    photoUrl: publicCaregiverPhotoUrl(row.photo_path),
    photoAlt: row.photo_alt || `${row.display_name || "ProMoms 관리사"} 프로필 사진`,
    careerYears: Number(row.career_years || 0),
    specialties: Array.isArray(row.specialties) ? row.specialties : [],
    credentials: Array.isArray(row.credentials) ? row.credentials : [],
    languages: Array.isArray(row.languages) ? row.languages : [],
    serviceArea: row.service_area || "",
    featured: Boolean(row.featured),
    sortOrder: Number(row.sort_order || 0),
    isPublished: row.is_published !== false,
    averageRating: row.average_rating == null ? null : Number(row.average_rating),
    reviewCount: Number(row.review_count || 0),
    ratingDistribution: distribution,
    competencyAverages,
    competencyReviewCount: Number(distribution.competency_review_count || 0),
    serviceCapabilities: [...new Set(serviceCapabilities)],
    reviews: reviews.map((review) => ({
      id: review.id,
      source: review.source || "CLIENT",
      rating: Number(review.rating || 0),
      competencyScores: reviewCompetencyScoresFromRow(review),
      tags: Array.isArray(review.tags) ? review.tags : [],
      comment: review.comment || "",
      serviceType: review.service_type || null,
      serviceDate: review.service_date || null,
      reviewerLabel: review.reviewer_label || "서비스 이용 고객",
      photoPaths: Array.isArray(review.photo_paths) ? review.photo_paths : [],
      photoUrls: (Array.isArray(review.photo_paths) ? review.photo_paths : [])
        .map(publicCaregiverReviewPhotoUrl)
        .filter(Boolean),
      createdAt: review.created_at || null,
    })),
  };
}

function hideReputationForMassageOnlyProfile(profile) {
  const capabilities = [...new Set((profile?.serviceCapabilities || []).filter((serviceType) => ["POSTPARTUM", "BABYSITTING", "MASSAGE"].includes(serviceType)))];
  if (capabilities.length !== 1 || capabilities[0] !== "MASSAGE") return profile;
  return {
    ...profile,
    averageRating: null,
    reviewCount: 0,
    ratingDistribution: {},
    competencyAverages: null,
    competencyReviewCount: 0,
    reviews: [],
  };
}

export async function loadPublicCaregiverDirectoryCloud() {
  if (!cloudEnabled) return [];
  const [directoryResponse, capabilityResponse] = await Promise.all([
    supabase.rpc("public_caregiver_directory"),
    supabase.rpc("public_caregiver_service_capabilities"),
  ]);
  const rows = throwIfError(directoryResponse, "관리사 공개 프로필 조회");
  const capabilityRows = capabilityResponse.error ? [] : (Array.isArray(capabilityResponse.data) ? capabilityResponse.data : []);
  const capabilitiesByCaregiver = new Map(capabilityRows.map((row) => [row.caregiver_id, row.service_capabilities]));
  return (Array.isArray(rows) ? rows : []).map((row) => hideReputationForMassageOnlyProfile(normalizePublicCaregiver({
    ...row,
    service_capabilities: capabilitiesByCaregiver.get(row.caregiver_id) || row.service_capabilities,
  })));
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
    myCaregiverCapabilities,
    caregiverPublicProfiles,
    massageAvailability,
    massageBookings,
    massageBookingChanges,
    serviceRequests,
    contracts,
    assignments,
    careSessions,
    careEvents,
    serviceAdjustments,
    reviews,
    reviewPublications,
    historicalReviews,
    publicCaregivers,
    reports,
    deposits,
    balanceTransactions,
    serviceRefunds,
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
    throwIfError(await supabase.rpc("my_caregiver_service_capabilities"), "내 서비스 자격 조회"),
    table("caregiver_public_profiles"),
    table("massage_therapist_availability"),
    table("massage_booking_sessions"),
    table("massage_booking_changes"),
    table("client_service_requests"),
    table("care_contracts"),
    table("care_assignments"),
    table("care_sessions"),
    table("care_events"),
    table("service_adjustment_requests"),
    table("caregiver_reviews"),
    table("caregiver_review_publications"),
    table("caregiver_historical_reviews"),
    loadPublicCaregiverDirectoryCloud(),
    table("care_reports"),
    table("deposit_transactions"),
    table("service_balance_transactions"),
    table("service_refund_transactions"),
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
  const rawAssignmentById = new Map(assignments.map((item) => [item.id, item]));
  const requestByAssignment = new Map(serviceRequests.filter((item) => item.approved_assignment_id).map((item) => [item.approved_assignment_id, item]));
  const requestByContract = new Map(serviceRequests
    .map((request) => [rawAssignmentById.get(request.approved_assignment_id)?.contract_id, request])
    .filter(([contractId]) => Boolean(contractId)));
  const sessionsByAssignment = new Map();
  careSessions.forEach((item) => {
    if (!sessionsByAssignment.has(item.assignment_id)) sessionsByAssignment.set(item.assignment_id, []);
    sessionsByAssignment.get(item.assignment_id).push(item);
  });
  sessionsByAssignment.forEach((items) => items.sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a)));
  const todayKey = deviceDateKey();
  const todaySessionForAssignment = (assignmentId) => (sessionsByAssignment.get(assignmentId) || []).find((item) => item.service_date === todayKey) || null;
  const latestCompletedSessionForAssignment = (assignmentId) => (sessionsByAssignment.get(assignmentId) || []).find((item) => item.status === "COMPLETED") || null;
  const profileById = new Map(profiles.map((item) => [item.id, item]));
  const directoryProfileByCaregiver = new Map(publicCaregivers.map((item) => [item.caregiverId, item]));
  const publicProfileByCaregiver = new Map(publicCaregivers.map((item) => [item.caregiverId, item]));
  caregiverPublicProfiles.forEach((row) => {
    const directoryProfile = directoryProfileByCaregiver.get(row.caregiver_id);
    publicProfileByCaregiver.set(row.caregiver_id, normalizePublicCaregiver({
      ...row,
      average_rating: directoryProfile?.averageRating ?? null,
      review_count: directoryProfile?.reviewCount || 0,
      rating_distribution: directoryProfile?.ratingDistribution || {},
      reviews: directoryProfile?.reviews || [],
    }));
  });
  const reviewPublicationById = new Map(reviewPublications.map((item) => [item.review_id, item]));
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
    const publicProfile = caregiver ? publicProfileByCaregiver.get(caregiver.id) : null;
    const ownCapabilities = profile.id === session.user.id
      ? (Array.isArray(myCaregiverCapabilities) ? myCaregiverCapabilities[0] : myCaregiverCapabilities)
      : null;
    const hasHrProfile = Boolean(hr || ownCapabilities?.has_hr_profile);
    const canProvidePostpartum = Boolean(hr?.can_provide_postpartum ?? ownCapabilities?.can_provide_postpartum ?? hasCaregiverRole);
    const canProvideBabysitting = Boolean(hr?.can_provide_babysitting ?? ownCapabilities?.can_provide_babysitting ?? hasCaregiverRole);
    const isMassageTherapist = Boolean(hr?.is_massage_therapist ?? ownCapabilities?.is_massage_therapist);
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
      employmentStatus: hr?.employment_status || ownCapabilities?.employment_status || (caregiverApproved ? "INACTIVE" : "APPLICANT"),
      hasHrProfile,
      canProvidePostpartum,
      canProvideBabysitting,
      isMassageTherapist,
      specialties: hr?.specialties || "",
      residentialArea: hr?.residential_area || "",
      serviceArea: hr?.service_area_notes || "",
      hrNotes: hr?.hr_notes || "",
      hrUpdatedAt: hr?.updated_at || null,
      caregiverId: caregiver?.id || null,
      publicProfile: publicProfile || null,
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

  assignmentBriefs.forEach((brief) => {
    if (!brief.client_id || appClients.some((client) => client.id === brief.client_id)) return;
    const reportBaby = brief.baby_id || brief.baby_name
      ? { id: brief.baby_id || null, name: brief.baby_name || "아이", birthDate: null, adminNotes: "" }
      : null;
    appClients.push({
      id: brief.client_id,
      userId: null,
      memberUserIds: [],
      motherName: brief.client_display_name || "이전 서비스 고객",
      maternalStatus: "과거 서비스 리포트",
      clientStatus: "HISTORICAL_REPORT_ONLY",
      approvalStatus: "HISTORICAL_REPORT_ONLY",
      preferredLanguage: "",
      emergencyContact: "",
      nextContactDate: null,
      internalMemo: "",
      babyAdminNotes: "",
      babyId: reportBaby?.id || null,
      babyName: reportBaby?.name || "",
      babyBirthDate: null,
      babies: reportBaby ? [reportBaby] : [],
      address: "",
      allergies: "",
      extraHouseholdMembers: 0,
      requestNote: "",
      managementUpdatedAt: null,
      restrictedReportProfile: true,
    });
  });

  const appAssignments = assignments.map((assignment) => {
    const contract = contractById.get(assignment.contract_id);
    const caregiver = caregiverById.get(assignment.caregiver_id);
    const request = requestByAssignment.get(assignment.id) || requestByContract.get(assignment.contract_id);
    const brief = briefByAssignment.get(assignment.id);
    const todaySession = todaySessionForAssignment(assignment.id);
    const latestCompletedSession = latestCompletedSessionForAssignment(assignment.id);
    const reportSession = latestCompletedSession;
    const assignmentBaby = babyById.get(contract?.baby_id || brief?.baby_id);
    return {
      id: assignment.id,
      contractId: assignment.contract_id,
      serviceRequestId: request?.id || null,
      administrativelyRemovedAt: request?.administratively_removed_at || null,
      serviceType: normalizeCareServiceType(assignment.service_type),
      clientId: contract?.client_id || brief?.client_id || null,
      babyId: contract?.baby_id || brief?.baby_id || null,
      babyName: assignmentBaby?.first_name || brief?.baby_name || request?.baby_name || "",
      caregiverUserId: caregiver?.user_id || brief?.caregiver_user_id || null,
      caregiverName: brief?.caregiver_display_name || "",
      caregiverCertification: brief?.caregiver_certification_summary || "",
      caregiverId: assignment.caregiver_id,
      weeks: assignment.contract_weeks || request?.requested_weeks || 2,
      postpartumMode: assignment.postpartum_mode || request?.postpartum_mode || null,
      durationMinutes: assignment.massage_duration_minutes || request?.massage_duration_minutes || null,
      sessionCount: assignment.massage_session_count || request?.massage_session_count || null,
      pricingTier: assignment.massage_pricing_tier || request?.massage_pricing_tier || null,
      weeklyRate: Number(assignment.weekly_rate || 0) || null,
      contractValue: Number(assignment.contract_value || 0) || null,
      depositAmount: Number(assignment.deposit_amount || 0) || null,
      depositStatus: assignment.deposit_status,
      depositPaidAt: assignment.deposit_paid_at,
      startAt: assignment.starts_at,
      endAt: assignment.ends_at,
      contractStartDate: contract?.start_date || deviceDateKey(assignment.starts_at),
      contractEndDate: contract?.end_date || deviceDateKey(assignment.ends_at),
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
      status: assignmentStatus(assignment, contract, todayKey),
      databaseStatus: assignment.status,
      careSessionId: reportSession?.id || null,
      careSessionStatus: reportSession?.status || null,
      careSessionDate: reportSession?.service_date || null,
      careSessionTimeZone: reportSession?.service_time_zone || "America/New_York",
      todayCareSessionId: todaySession?.id || null,
      todayCareSessionStatus: todaySession?.status || null,
      todayCareSessionEndedAt: todaySession?.ended_at || null,
      todayCareSessionTimeZone: todaySession?.service_time_zone || null,
      lastCompletedCareAt: latestCompletedSession?.ended_at || null,
      createdAt: assignment.created_at,
    };
  });

  const appMassageAvailability = massageAvailability.map((availability) => {
    const caregiver = caregiverById.get(availability.caregiver_id);
    return {
      id: availability.id,
      caregiverId: availability.caregiver_id,
      caregiverUserId: caregiver?.user_id || null,
      availableDate: availability.available_date,
      startTime: shortTime(availability.start_time),
      endTime: shortTime(availability.end_time),
      createdAt: availability.created_at,
      updatedAt: availability.updated_at,
    };
  });
  const appMassageBookings = massageBookings.map((booking) => {
    const caregiver = caregiverById.get(booking.caregiver_id);
    const request = serviceRequests.find((item) => item.id === booking.client_service_request_id);
    return {
      id: booking.id,
      requestId: booking.client_service_request_id,
      clientId: booking.client_id,
      caregiverId: booking.caregiver_id,
      caregiverUserId: caregiver?.user_id || null,
      sessionNumber: Number(booking.session_number || 1),
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      status: booking.status,
      durationMinutes: Number(request?.massage_duration_minutes || 60),
      pricingTier: request?.massage_pricing_tier || "GENERAL",
      address: request?.service_address || "",
      specialNotes: request?.special_notes || "",
      confirmedAt: booking.confirmed_at,
      cancelledAt: booking.cancelled_at,
      cancellationReason: booking.cancellation_reason || "",
      createdAt: booking.created_at,
    };
  });
  const appMassageBookingChanges = massageBookingChanges.map((change) => ({
    id: change.id,
    sessionId: change.massage_booking_session_id,
    requestedBy: change.requested_by,
    action: change.action,
    proposedCaregiverId: change.proposed_caregiver_id,
    proposedStartsAt: change.proposed_starts_at,
    proposedEndsAt: change.proposed_ends_at,
    reason: change.reason,
    status: change.status,
    reviewedBy: change.reviewed_by,
    reviewedAt: change.reviewed_at,
    reviewNote: change.review_note || "",
    createdAt: change.created_at,
  }));

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
  const appServiceRefunds = serviceRefunds.map((item) => ({
    ...item,
    requestId: item.client_service_request_id,
    clientId: item.client_id,
    amount: Number(item.amount || 0),
    paymentMethod: item.payment_method,
    refundReference: item.refund_reference,
    refundReason: item.refund_reason,
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
    postpartumMode: request.postpartum_mode || null,
    durationMinutes: request.massage_duration_minutes || null,
    sessionCount: request.massage_session_count || null,
    pricingTier: request.massage_pricing_tier || null,
    linkedPostpartumAssignmentId: request.massage_linked_postpartum_assignment_id || null,
    weeklyRate: Number(request.weekly_rate || 0) || null,
    estimatedTotal: Number(request.estimated_total || 0) || null,
    ownerDiscountAmount: Number(request.owner_discount_amount || 0),
    ownerDiscountReason: request.owner_discount_reason || "",
    ownerDiscountedBy: request.owner_discounted_by || null,
    ownerDiscountedAt: request.owner_discounted_at || null,
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
    administrativelyRemovedAt: request.administratively_removed_at,
    administrativelyRemovedBy: request.administratively_removed_by,
    administrativeRemovalReason: request.administrative_removal_reason || "",
    depositTransaction: appDeposits.find((item) => item.requestId === request.id) || null,
    balanceTransactions: appBalanceTransactions.filter((item) => item.requestId === request.id),
    refundTransactions: appServiceRefunds.filter((item) => item.requestId === request.id),
  }));

  const careSessionById = new Map(careSessions.map((item) => [item.id, item]));
  const assignmentBySession = new Map(careSessions.map((item) => [item.id, appAssignments.find((assignment) => assignment.id === item.assignment_id)]));
  const appEvents = careEvents.map((event) => {
    const careSession = careSessionById.get(event.care_session_id);
    const assignment = assignmentBySession.get(event.care_session_id);
    const creator = profileById.get(event.created_by);
    const eventType = EVENT_TO_APP[event.event_type] || null;
    if (!careSession || !assignment || !eventType || !careEventTypeAllowedForService(assignment.serviceType, eventType)) return null;
    return {
      id: event.id,
      careSessionId: event.care_session_id,
      assignmentId: assignment?.id,
      clientId: assignment?.clientId,
      babyId: assignment?.babyId,
      type: eventType,
      at: event.event_time,
      serviceTimeZone: careSession?.service_time_zone || "America/New_York",
      author: creator?.full_name || "ProMoms",
      createdBy: event.created_by,
      data: event.payload || {},
    };
  }).filter(Boolean);

  const currentUser = appUsers.find((item) => item.id === session.user.id);
  if (!currentUser) throw new Error("회원 프로필을 불러오지 못했습니다. 잠시 후 다시 로그인해 주세요.");
  if (currentUser.accountStatus === "SUSPENDED" || currentUser.accountStatus === "REJECTED") {
    throw new Error("현재 이용이 중지된 계정입니다. ProMoms 관리자에게 문의해 주세요.");
  }
  const currentUserIsCaregiver = currentUser.databaseRoles?.includes("CAREGIVER");
  const todayAssignments = appAssignments
    .filter((item) => item.status === "ACTIVE"
      && isRecordableCareServiceType(item.serviceType)
      && assignmentContractCoversDate(item, todayKey)
      && (currentUserIsCaregiver ? item.caregiverUserId === currentUser.id : true))
    .sort((a, b) => String(a.dailyStart).localeCompare(String(b.dailyStart)));
  const recoveredCareSession = currentUserIsCaregiver
    ? [...careSessions]
      .filter((item) => item.status === "IN_PROGRESS")
      .sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a))
      .find((item) => {
        const assignment = appAssignments.find((candidate) => candidate.id === item.assignment_id);
        return assignment?.caregiverUserId === currentUser.id && isRecordableCareServiceType(assignment.serviceType);
      }) || null
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
    massageAvailability: appMassageAvailability,
    massageBookings: appMassageBookings,
    massageBookingChanges: appMassageBookingChanges,
    serviceRequests: appRequests,
    depositTransactions: appDeposits,
    balanceTransactions: appBalanceTransactions,
    refundTransactions: appServiceRefunds,
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
    reviews: reviews.map((item) => {
      const publication = reviewPublicationById.get(item.id);
      return {
        id: item.id,
        assignmentId: item.assignment_id,
        clientId: item.client_id,
        caregiverId: item.caregiver_id,
        caregiverUserId: caregiverById.get(item.caregiver_id)?.user_id || null,
        rating: item.rating,
        competencyScores: reviewCompetencyScoresFromRow(item),
        tags: item.tags,
        comment: item.comment,
        createdAt: item.created_at,
        createdBy: item.created_by,
        source: "CLIENT",
        publicConsent: Boolean(publication?.customer_public_consent),
        publicationStatus: publication?.status || "PRIVATE",
        validityStatus: publication?.validity_status || "VALID",
        invalidReasonCode: publication?.validity_reason_code || null,
        invalidReasonNote: publication?.validity_reason_note || "",
        invalidatedAt: publication?.validity_moderated_at || null,
        photoPaths: item.photo_paths || [],
        photoUrls: (item.photo_paths || []).map(publicCaregiverReviewPhotoUrl).filter(Boolean),
      };
    }).concat(historicalReviews.map((item) => ({
      id: item.id,
      assignmentId: null,
      clientId: null,
      caregiverId: item.caregiver_id,
      caregiverUserId: caregiverById.get(item.caregiver_id)?.user_id || null,
      rating: item.rating,
      competencyScores: reviewCompetencyScoresFromRow(item),
      tags: item.tags || [],
      comment: item.comment,
      createdAt: item.created_at,
      serviceDate: item.service_date,
      serviceType: item.service_type,
      reviewerAlias: item.reviewer_alias || "이전 서비스 고객",
      source: item.verification_status === "VERIFIED" ? "VERIFIED_EXTERNAL" : "ADMIN_LEGACY",
      publicationStatus: item.is_published ? "PUBLISHED" : "HIDDEN",
      archived: Boolean(item.archived_at),
      photoPaths: item.photo_paths || [],
      photoUrls: (item.photo_paths || []).map(publicCaregiverReviewPhotoUrl).filter(Boolean),
      verificationStatus: item.verification_status || "UNVERIFIED",
      verificationNote: item.verification_note || "",
      verifiedAt: item.verified_at || null,
    }))),
    publicCaregivers,
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
      serviceTimeZone: item.service_time_zone || "America/New_York",
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
      serviceTimeZone: currentCareSession?.service_time_zone || null,
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
  return throwIfError(await supabase.rpc("submit_promoms_service_request", {
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
    p_postpartum_mode: values.serviceType === "POSTPARTUM" ? values.postpartumMode || "COMMUTE" : null,
    p_massage_duration_minutes: null,
    p_massage_session_count: null,
  }), "서비스 신청 저장");
}

export async function submitMassageServiceRequestCloud(values) {
  return throwIfError(await supabase.rpc("submit_massage_service_request", {
    p_duration_minutes: Number(values.durationMinutes),
    p_service_address: values.requestAddress.trim(),
    p_special_notes: values.requestSpecialNotes?.trim() || null,
    p_slots: values.slots,
    p_policy_accepted: values.requestConsent === "on",
  }), "마사지 예약 요청 저장");
}

export async function loadMassageAvailableSlotsCloud(durationMinutes, dateFrom, dateTo) {
  const rows = throwIfError(await supabase.rpc("available_massage_slots", {
    p_duration_minutes: Number(durationMinutes),
    p_date_from: dateFrom,
    p_date_to: dateTo,
  }), "마사지 예약 가능시간 조회");
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: `${row.availability_id}:${row.slot_starts_at}`,
    availabilityId: row.availability_id,
    caregiverId: row.caregiver_id,
    caregiverUserId: row.caregiver_user_id,
    therapistName: row.therapist_name || "ProMoms 테라피스트",
    startsAt: row.slot_starts_at,
    endsAt: row.slot_ends_at,
  }));
}

export async function saveMassageAvailabilityCloud({ weekStart, weekdays, startTime, endTime }) {
  return throwIfError(await supabase.rpc("save_my_massage_availability", {
    p_week_start: weekStart,
    p_weekdays: weekdays.map(Number),
    p_start_time: startTime,
    p_end_time: endTime,
  }), "마사지 근무 가능시간 저장");
}

export async function deleteMassageAvailabilityCloud(availabilityId) {
  return throwIfError(await supabase.rpc("delete_my_massage_availability", {
    p_availability_id: availabilityId,
  }), "마사지 근무 가능시간 삭제");
}

export async function submitMassageBookingChangeCloud({ sessionId, action, reason, slot = null }) {
  return throwIfError(await supabase.rpc("submit_massage_booking_change", {
    p_session_id: sessionId,
    p_action: action,
    p_reason: reason.trim(),
    p_availability_id: action === "CHANGE" ? slot?.availabilityId || null : null,
    p_starts_at: action === "CHANGE" ? slot?.startsAt || null : null,
  }), "마사지 일정 변경·취소 요청 저장");
}

export async function reviewMassageBookingChangeCloud(changeId, approve, reviewNote = null) {
  return throwIfError(await supabase.rpc("review_massage_booking_change", {
    p_change_id: changeId,
    p_approve: approve,
    p_review_note: reviewNote,
  }), "마사지 일정 변경·취소 요청 검토");
}

export async function reviewServiceRequestCloud(requestId, approve, note = null, payment = null) {
  return throwIfError(await supabase.rpc("review_promoms_service_request", {
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

export async function recordServiceBalancePaymentCloud({ requestId, amount, paymentMethod, paymentReference, receivedOn, discountAmount = 0, discountReason = null }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("settle_service_balance_payment", {
    p_request_id: requestId,
    p_amount: Number(amount),
    p_payment_method: String(paymentMethod || "").trim(),
    p_payment_reference: String(paymentReference || "").trim(),
    p_received_on: receivedOn,
    p_discount_amount: Number(discountAmount || 0),
    p_discount_reason: String(discountReason || "").trim() || null,
  }), "서비스 잔금 수납 기록");
}

export async function recordServiceRefundCloud({ requestId, amount, paymentMethod, refundReference, refundReason, refundedOn }) {
  await authenticatedUserId();
  const response = throwIfError(await supabase.rpc("record_service_refund", {
    p_request_id: requestId,
    p_amount: Number(amount),
    p_payment_method: String(paymentMethod || "").trim(),
    p_refund_reference: String(refundReference || "").trim(),
    p_refund_reason: String(refundReason || "").trim(),
    p_refunded_on: refundedOn,
  }), "서비스 환불 기록");
  const saved = Array.isArray(response) ? response[0] : response;
  if (!saved?.id || saved.status !== "COMPLETED") {
    throw new Error("서비스 환불 기록이 데이터베이스에 저장되었는지 확인하지 못했습니다.");
  }
  return {
    ...saved,
    requestId: saved.client_service_request_id,
    clientId: saved.client_id,
    amount: Number(saved.amount || 0),
    paymentMethod: saved.payment_method,
    refundReference: saved.refund_reference,
    refundReason: saved.refund_reason,
    refundedAt: saved.refunded_at,
    recordedBy: saved.recorded_by,
  };
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
  return throwIfError(await supabase.rpc("schedule_promoms_service_request", {
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

export async function setCareSessionStatusCloud(assignmentId, status, { serviceDate = null, timeZone = null } = {}) {
  return throwIfError(await supabase.rpc("set_care_session_status", {
    p_assignment_id: assignmentId,
    p_status: status,
    p_service_date: serviceDate,
    p_time_zone: timeZone,
  }), "케어 세션 상태 저장");
}

export async function setCareShiftCheckCloud(assignmentId, checkKey, checked, { serviceDate = null, timeZone = null } = {}) {
  return throwIfError(await supabase.rpc("set_care_shift_check", {
    p_assignment_id: assignmentId,
    p_check_key: checkKey,
    p_checked: Boolean(checked),
    p_service_date: serviceDate,
    p_time_zone: timeZone,
  }), "근무 전 확인사항 저장");
}

export async function saveCareShiftChecklistCloud(assignmentId, checks, { serviceDate = null, timeZone = null } = {}) {
  return throwIfError(await supabase.rpc("save_care_shift_checklist", {
    p_assignment_id: assignmentId,
    p_checks: checks,
    p_service_date: serviceDate,
    p_time_zone: timeZone,
  }), "근무 전 안전 체크 저장");
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

export async function updateCareEventCloud({ eventId, at, data, notes = null }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("update_care_event", {
    p_event_id: eventId,
    p_event_time: at,
    p_payload: data,
    p_notes: notes,
  }), "케어 기록 수정");
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

export async function configureMemberServiceAccessCloud(userId, roles, capabilities) {
  return throwIfError(await supabase.rpc("admin_configure_member_service_access", {
    p_user_id: userId,
    p_roles: roles,
    p_postpartum: Boolean(capabilities?.postpartum),
    p_babysitting: Boolean(capabilities?.babysitting),
    p_massage: Boolean(capabilities?.massage),
  }), "회원 서비스 권한 구성");
}

export async function setMassageTherapistCapabilityCloud(userId, enabled) {
  return throwIfError(await supabase.rpc("admin_set_massage_therapist_capability", {
    p_user_id: userId,
    p_enabled: Boolean(enabled),
  }), "마사지 테라피스트 자격 설정");
}

export async function archiveMemberCloud(userId) {
  return throwIfError(await supabase.rpc("admin_archive_member", {
    p_user_id: userId,
  }), "회원 삭제");
}

export async function archiveServiceRequestCloud(requestId, reason) {
  return throwIfError(await supabase.rpc("admin_archive_service_request", {
    p_request_id: requestId,
    p_reason: String(reason || "").trim(),
  }), "서비스 삭제");
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
    p_service_address: String(values.serviceAddress || "").trim(),
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

const REVIEW_PHOTO_MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function validateReviewPhotoFiles(files) {
  const normalized = Array.from(files || []).filter((file) => file instanceof File && file.size > 0);
  if (normalized.length > 3) throw new Error("후기 사진은 최대 3장까지 등록할 수 있습니다.");
  normalized.forEach((file) => {
    if (!REVIEW_PHOTO_MIME_EXTENSIONS[file.type]) throw new Error("후기 사진은 JPG, PNG, WebP 형식만 등록할 수 있습니다.");
    if (file.size > 5 * 1024 * 1024) throw new Error("후기 사진은 장당 5MB 이하만 등록할 수 있습니다.");
  });
  return normalized;
}

async function uploadReviewPhotoFiles(prefix, files) {
  const normalized = validateReviewPhotoFiles(files);
  const uploadedPaths = [];
  try {
    for (const file of normalized) {
      const extension = REVIEW_PHOTO_MIME_EXTENSIONS[file.type];
      const photoPath = `${prefix}/${crypto.randomUUID()}.${extension}`;
      throwIfError(await supabase.storage.from("caregiver-review-photos").upload(photoPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      }), "후기 사진 업로드");
      uploadedPaths.push(photoPath);
    }
    return uploadedPaths;
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from("caregiver-review-photos").remove(uploadedPaths);
    throw error;
  }
}

async function cleanupUnattachedReviewPhotos(photoPaths) {
  if (!photoPaths?.length) return;
  await supabase.storage.from("caregiver-review-photos").remove(photoPaths);
}

export async function addServiceReviewPhotosCloud(reviewId, photoFiles) {
  await authenticatedUserId();
  const photoPaths = await uploadReviewPhotoFiles(`customer/${reviewId}`, photoFiles);
  try {
    return throwIfError(await supabase.rpc("attach_caregiver_review_photos", {
      p_review_id: reviewId,
      p_photo_paths: photoPaths,
    }), "고객 후기 사진 연결");
  } catch (error) {
    await cleanupUnattachedReviewPhotos(photoPaths);
    throw error;
  }
}

export async function saveServiceReviewCloud({ assignmentId, competencyScores, tags, comment, publicConsent, photoFiles = [] }) {
  await authenticatedUserId();
  const savedReview = throwIfError(await supabase.rpc("submit_caregiver_review", {
    p_assignment_id: assignmentId,
    p_competency_scores: competencyScores,
    p_tags: Array.isArray(tags) ? tags : [],
    p_comment: String(comment || "").trim(),
    p_public_consent: Boolean(publicConsent),
  }), "서비스 후기 저장");
  if (!photoFiles.length) return savedReview;
  try {
    await addServiceReviewPhotosCloud(savedReview.review_id, photoFiles);
    return { ...savedReview, photo_count: photoFiles.length };
  } catch (error) {
    return { ...savedReview, photo_upload_error: error.message || "후기 사진을 연결하지 못했습니다." };
  }
}

export async function uploadCaregiverPublicPhotoCloud(caregiverId, file) {
  await authenticatedUserId();
  if (!file) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error("관리사 프로필 사진은 5MB 이하만 등록할 수 있습니다.");
  const mimeExtensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = mimeExtensions[file.type];
  if (!extension) throw new Error("JPG, PNG, WebP 형식의 사진만 등록할 수 있습니다.");
  const photoPath = `${caregiverId}/profile`;
  throwIfError(await supabase.storage.from("caregiver-public-photos").upload(photoPath, file, {
    cacheControl: "60",
    contentType: file.type,
    upsert: true,
  }), "관리사 프로필 사진 업로드");
  return { path: photoPath, url: publicCaregiverPhotoUrl(photoPath) };
}

export async function updateCaregiverPublicProfileCloud(caregiverId, values, photoPath = null) {
  await authenticatedUserId();
  const list = (value, maxItems, maxLength) => [...new Set(
    String(value || "").split(/[,·\n]/).map((item) => item.trim()).filter(Boolean),
  )].slice(0, maxItems).map((item) => item.slice(0, maxLength));
  const canonicalName = String(values.fullName ?? values.publicDisplayName ?? "").trim().slice(0, 80);
  const submittedPhotoAlt = String(values.publicPhotoAlt || "").trim();
  const canonicalPhotoAlt = !submittedPhotoAlt || / 관리사 프로필 사진$/.test(submittedPhotoAlt)
    ? `${canonicalName} 관리사 프로필 사진`.slice(0, 160)
    : submittedPhotoAlt.slice(0, 160);
  return throwIfError(await supabase.rpc("admin_upsert_caregiver_public_profile", {
    p_caregiver_id: caregiverId,
    p_display_name: canonicalName,
    p_headline: String(values.publicHeadline || "").trim(),
    p_biography: String(values.publicBiography || "").trim(),
    p_photo_path: photoPath || String(values.existingPhotoPath || "").trim() || null,
    p_photo_alt: canonicalPhotoAlt || null,
    p_career_years: Number(values.careerYears ?? values.publicCareerYears ?? 0),
    p_specialties: list(values.specialties ?? values.publicSpecialties, 12, 60),
    p_credentials: list(values.certification ?? values.publicCredentials, 12, 120),
    p_languages: list(values.publicLanguages, 8, 40),
    p_service_area: String(values.serviceArea ?? values.publicServiceArea ?? "").trim().slice(0, 240) || null,
    p_featured: values.publicFeatured === "on",
    p_sort_order: Number(values.publicSortOrder || 0),
    p_is_published: values.publicPublished === "on",
  }), "홈페이지 관리사 프로필 저장");
}

export async function addHistoricalReviewEvidenceCloud(caregiverId, reviewId, photoFiles, verificationNote) {
  await authenticatedUserId();
  let photoPaths = [];
  let photoUploadError = null;
  try {
    photoPaths = await uploadReviewPhotoFiles(`external/${caregiverId}/${reviewId}`, photoFiles);
  } catch (error) {
    photoUploadError = error;
  }
  try {
    const verifiedReview = throwIfError(await supabase.rpc("admin_verify_historical_caregiver_review", {
      p_review_id: reviewId,
      p_photo_paths: photoPaths,
      p_verification_note: String(verificationNote || "").trim(),
    }), "외부 경로 후기 확인");
    return photoUploadError
      ? { ...verifiedReview, photo_upload_error: photoUploadError.message || "선택한 후기 사진을 업로드하지 못했습니다." }
      : verifiedReview;
  } catch (error) {
    await cleanupUnattachedReviewPhotos(photoPaths);
    throw error;
  }
}

export async function createHistoricalCaregiverReviewCloud(caregiverId, values, photoFiles = []) {
  await authenticatedUserId();
  const tags = String(values.tags || "").split(/[,·\n]/).map((item) => item.trim()).filter(Boolean);
  const savedReview = throwIfError(await supabase.rpc("admin_create_historical_caregiver_review", {
    p_caregiver_id: caregiverId,
    p_competency_scores: values.competencyScores,
    p_tags: tags,
    p_comment: String(values.comment || "").trim(),
    p_service_type: values.serviceType || null,
    p_service_date: values.serviceDate || null,
    p_reviewer_alias: String(values.reviewerAlias || "이전 서비스 고객").trim(),
    p_is_published: values.isPublished === "on",
  }), "이전 관리사 후기 저장");
  const verifiedReview = await addHistoricalReviewEvidenceCloud(caregiverId, savedReview.review_id, photoFiles, values.verificationNote);
  return {
    ...savedReview,
    verification_status: "VERIFIED",
    photo_count: Number(verifiedReview.photo_count || 0),
    photo_upload_error: verifiedReview.photo_upload_error || "",
  };
}

export async function setCaregiverReviewPublicationCloud(reviewId, status) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("admin_set_caregiver_review_publication", {
    p_review_id: reviewId,
    p_status: status,
  }), "고객 후기 공개 상태 변경");
}

export async function setCaregiverReviewValidityCloud(reviewId, { isValid, reasonCode, reasonNote }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("admin_set_caregiver_review_validity", {
    p_review_id: reviewId,
    p_is_valid: Boolean(isValid),
    p_reason_code: reasonCode || null,
    p_reason_note: String(reasonNote || "").trim() || null,
  }), "고객 후기 유효성 상태 변경");
}

export async function setHistoricalReviewPublicationCloud(reviewId, { isPublished, archived, reason }) {
  await authenticatedUserId();
  return throwIfError(await supabase.rpc("admin_set_historical_review_publication", {
    p_review_id: reviewId,
    p_is_published: Boolean(isPublished),
    p_archived: Boolean(archived),
    p_reason: String(reason || "").trim() || null,
  }), "이전 후기 상태 변경");
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

export async function submitMassageAdjustmentCloud({
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
  return throwIfError(await supabase.rpc("submit_massage_adjustment", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_action: action,
    p_reason: reason.trim(),
    p_proposed_start_date: action === "CHANGE" ? proposedStartDate : null,
    p_proposed_daily_start_time: action === "CHANGE" ? proposedDailyStart : null,
    p_proposed_daily_end_time: action === "CHANGE" ? proposedDailyEnd : null,
    p_proposed_weeks: action === "CHANGE" ? Number(proposedWeeks) : null,
  }), "마사지 변경·취소 요청 저장");
}

export async function reviewMassageAdjustmentCloud(adjustmentId, approve, reviewNote = null) {
  return throwIfError(await supabase.rpc("review_massage_adjustment", {
    p_adjustment_id: adjustmentId,
    p_approve: approve,
    p_review_note: reviewNote,
  }), "마사지 변경·취소 요청 검토");
}
