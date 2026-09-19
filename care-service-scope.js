export const CARE_SERVICE_TYPES = Object.freeze(["POSTPARTUM", "BABYSITTING", "MASSAGE"]);
export const RECORDABLE_CARE_SERVICE_TYPES = Object.freeze(["POSTPARTUM", "BABYSITTING"]);

export const CARE_EVENT_TYPES_BY_SERVICE = Object.freeze({
  POSTPARTUM: Object.freeze(["feeding", "diaper", "sleep", "temperature", "bath", "weight", "mother", "note"]),
  BABYSITTING: Object.freeze(["meal", "sitter_note"]),
  MASSAGE: Object.freeze([]),
});

export function normalizeCareServiceType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return CARE_SERVICE_TYPES.includes(normalized) ? normalized : null;
}

export function isRecordableCareServiceType(value) {
  return RECORDABLE_CARE_SERVICE_TYPES.includes(normalizeCareServiceType(value));
}

export function careEventTypeAllowedForService(serviceType, eventType) {
  const normalizedServiceType = normalizeCareServiceType(serviceType);
  return Boolean(normalizedServiceType && CARE_EVENT_TYPES_BY_SERVICE[normalizedServiceType]?.includes(String(eventType || "")));
}

export function careEventMatchesAssignment(event, assignment, sessions = []) {
  const serviceType = normalizeCareServiceType(assignment?.serviceType);
  if (!event?.assignmentId || !assignment?.id || event.assignmentId !== assignment.id) return false;
  if (!careEventTypeAllowedForService(serviceType, event.type)) return false;
  if (assignment.clientId && event.clientId && event.clientId !== assignment.clientId) return false;
  if (assignment.babyId && event.babyId && event.babyId !== assignment.babyId) return false;
  if (!event.careSessionId) return true;
  const session = sessions.find((item) => item?.id === event.careSessionId);
  return Boolean(session && session.assignmentId === assignment.id);
}
