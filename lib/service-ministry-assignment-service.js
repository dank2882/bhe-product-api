"use strict";

const {
  writeServiceAssignmentsToGoogleSheet
} = require("./google-sheet-service-assignment-writer");

const SERVICE_MINISTRY_ASSIGNMENT_SCHEMA_VERSION = "service-ministry-assignments-v1";
const SUPPORT_MUSIC_ROLES = new Set(["choir_opener", "choir_special", "special_music", "offertory"]);
const SPECIAL_MUSIC_ROLES = new Set(["special_music", "offertory"]);
const CLEARABLE_ASSIGNMENT_FIELDS = new Set([
  "preacher",
  "congregationalLeader",
  "choirAccompanist",
  "specialAccompanists"
]);

function createServiceMinistryAssignmentError(
  message,
  statusCode = 400,
  code = "service_ministry_assignment_error",
  details = {}
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeServiceType(value) {
  const token = normalizeToken(value);
  if (["sunday_evening", "sunday_pm"].includes(token)) return "sunday_night";
  if (["wednesday_evening", "midweek"].includes(token)) return "wednesday_night";
  return token;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizePerson(value, fieldName, { optional = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (optional) return null;
    throw createServiceMinistryAssignmentError(`${fieldName} is required`, 400, "missing_person_assignment", { field: fieldName });
  }
  const source = typeof value === "string" ? { displayName: value } : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw createServiceMinistryAssignmentError(`Invalid ${fieldName}`, 400, "invalid_person_assignment", { field: fieldName });
  }
  const displayName = normalizeString(source.displayName || source.name);
  const personId = normalizeString(source.personId);
  const pianistId = normalizeString(source.pianistId);
  if (!displayName && !personId && !pianistId) {
    throw createServiceMinistryAssignmentError(
      `${fieldName} needs a displayName, personId, or pianistId`,
      400,
      "missing_person_identity",
      { field: fieldName }
    );
  }
  return {
    personId,
    pianistId,
    displayName,
    notes: normalizeString(source.notes)
  };
}

function personIdentity(value) {
  if (!value) return "";
  return normalizeToken(value.personId || value.pianistId || value.displayName);
}

async function loadService(serviceId, deps) {
  const cleanServiceId = normalizeString(serviceId);
  if (!cleanServiceId) {
    throw createServiceMinistryAssignmentError("serviceId is required", 400, "missing_service_id");
  }
  const docRef = deps.servicesCollection.doc(cleanServiceId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createServiceMinistryAssignmentError("Service not found", 404, "service_not_found", { serviceId: cleanServiceId });
  }
  const raw = doc.data() || {};
  return {
    docRef,
    raw,
    service: {
      serviceId: cleanServiceId,
      serviceDate: normalizeString(raw.serviceDate),
      serviceType: normalizeServiceType(raw.serviceType),
      title: normalizeString(raw.title),
      sourceSheetName: normalizeString(raw.sourceSheetName),
      sourceRowNumber: Number.isInteger(raw.sourceRowNumber) ? raw.sourceRowNumber : null,
      sourceCell: normalizeString(raw.sourceCell),
      message: raw.message && typeof raw.message === "object" && !Array.isArray(raw.message) ? raw.message : null
    }
  };
}

async function loadSupportMusicItems(serviceId, deps) {
  const snapshot = await deps.serviceSongEventsCollection.limit(5000).get();
  return snapshot.docs
    .map((doc) => ({ docId: doc.id, ...(doc.data() || {}) }))
    .filter((event) => normalizeString(event.serviceId) === serviceId)
    .filter((event) => SUPPORT_MUSIC_ROLES.has(normalizeToken(event.usageRole)))
    .map((event) => ({
      serviceSongEventId: normalizeString(event.serviceSongEventId || event.docId),
      usageRole: normalizeToken(event.usageRole),
      slotIndex: Number.isInteger(event.slotIndex) ? event.slotIndex : null,
      sourceColumnName: normalizeString(event.sourceColumnName),
      sourceCell: normalizeString(event.sourceCell),
      title: normalizeString(event.title || event.songTitle || event.songTitleCandidate),
      assignedPersonOrGroupRaw: normalizeString(event.assignedPersonOrGroupRaw),
      detailNote: normalizeString(event.detailNote)
    }))
    .sort((left, right) => (left.slotIndex ?? 9999) - (right.slotIndex ?? 9999));
}

function normalizeStoredAssignments(value = {}) {
  return {
    schemaVersion: SERVICE_MINISTRY_ASSIGNMENT_SCHEMA_VERSION,
    serviceId: normalizeString(value.serviceId),
    serviceDate: normalizeString(value.serviceDate),
    serviceType: normalizeServiceType(value.serviceType),
    preacher: normalizePerson(value.preacher, "preacher"),
    congregationalLeader: normalizePerson(value.congregationalLeader, "congregationalLeader"),
    choirAccompanist: normalizePerson(value.choirAccompanist, "choirAccompanist"),
    specialAccompanists: Array.isArray(value.specialAccompanists) ? value.specialAccompanists : [],
    createdAt: normalizeString(value.createdAt),
    updatedAt: normalizeString(value.updatedAt),
    changedBy: normalizeString(value.changedBy)
  };
}

function normalizeSpecialAccompanists(value, supportMusicItems) {
  if (!Array.isArray(value)) {
    throw createServiceMinistryAssignmentError(
      "specialAccompanists must be an array",
      400,
      "invalid_special_accompanists"
    );
  }
  const itemById = new Map(supportMusicItems.map((item) => [item.serviceSongEventId, item]));
  const seenIds = new Set();
  return value.map((assignment, index) => {
    const serviceSongEventId = normalizeString(assignment?.serviceSongEventId);
    const item = itemById.get(serviceSongEventId);
    if (!item || !SPECIAL_MUSIC_ROLES.has(item.usageRole)) {
      throw createServiceMinistryAssignmentError(
        "Special-music item was not found for this service",
        400,
        "special_music_item_not_found",
        { index, serviceSongEventId }
      );
    }
    if (seenIds.has(serviceSongEventId)) {
      throw createServiceMinistryAssignmentError(
        "A special-music item has more than one accompanist assignment",
        400,
        "duplicate_special_accompanist",
        { serviceSongEventId }
      );
    }
    seenIds.add(serviceSongEventId);
    const accompanist = normalizePerson(assignment, "specialAccompanist", { optional: false });
    return {
      serviceSongEventId,
      usageRole: item.usageRole,
      sourceColumnName: item.sourceColumnName,
      sourceCell: item.sourceCell,
      title: item.title,
      assignedPersonOrGroupRaw: item.assignedPersonOrGroupRaw,
      ...accompanist
    };
  });
}

function validatePreacherAndLeader(preacher, congregationalLeader) {
  const preacherIdentity = personIdentity(preacher);
  const leaderIdentity = personIdentity(congregationalLeader);
  if (preacherIdentity && leaderIdentity && preacherIdentity === leaderIdentity) {
    throw createServiceMinistryAssignmentError(
      "The preacher cannot also be the congregational leader for the same service",
      400,
      "preacher_cannot_lead_congregationals",
      { preacher: preacher?.displayName, congregationalLeader: congregationalLeader?.displayName }
    );
  }
}

async function getServiceMinistryAssignments(input = {}, deps = {}) {
  const { service } = await loadService(input.serviceId, deps);
  const [assignmentDoc, supportMusicItems] = await Promise.all([
    deps.serviceMinistryAssignmentsCollection.doc(service.serviceId).get(),
    loadSupportMusicItems(service.serviceId, deps)
  ]);
  const assignments = assignmentDoc.exists
    ? normalizeStoredAssignments(assignmentDoc.data() || {})
    : normalizeStoredAssignments({
      serviceId: service.serviceId,
      serviceDate: service.serviceDate,
      serviceType: service.serviceType,
      preacher: service.message?.speakerName ? { displayName: service.message.speakerName } : null
    });
  return { service, assignments, supportMusicItems };
}

async function trySpreadsheetWrite(input, deps) {
  try {
    return await writeServiceAssignmentsToGoogleSheet(input, deps);
  } catch (error) {
    return {
      written: false,
      error: {
        code: error?.code || "google_sheet_assignment_write_failed",
        message: error?.message || "Google Sheet assignment write failed",
        status: Number(error?.statusCode) || 500,
        details: error?.details || {}
      }
    };
  }
}

async function saveServiceMinistryAssignments(input = {}, deps = {}) {
  const { docRef: serviceRef, raw: rawService, service } = await loadService(input.serviceId, deps);
  const assignmentRef = deps.serviceMinistryAssignmentsCollection.doc(service.serviceId);
  const [existingDoc, supportMusicItems, pianoPlanDoc] = await Promise.all([
    assignmentRef.get(),
    loadSupportMusicItems(service.serviceId, deps),
    deps.servicePianoPlansCollection.doc(service.serviceId).get()
  ]);
  const existing = existingDoc.exists
    ? normalizeStoredAssignments(existingDoc.data() || {})
    : normalizeStoredAssignments({
      serviceId: service.serviceId,
      serviceDate: service.serviceDate,
      serviceType: service.serviceType,
      preacher: service.message?.speakerName ? { displayName: service.message.speakerName } : null
    });
  const next = { ...existing };
  for (const field of Array.isArray(input.clearFields) ? input.clearFields : []) {
    if (!CLEARABLE_ASSIGNMENT_FIELDS.has(field)) {
      throw createServiceMinistryAssignmentError(
        "Invalid clearFields entry",
        400,
        "invalid_service_assignment_clear_field",
        { field, allowedFields: Array.from(CLEARABLE_ASSIGNMENT_FIELDS) }
      );
    }
    next[field] = field === "specialAccompanists" ? [] : null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "preacher")) {
    next.preacher = normalizePerson(input.preacher, "preacher");
  }
  if (Object.prototype.hasOwnProperty.call(input, "congregationalLeader")) {
    next.congregationalLeader = normalizePerson(input.congregationalLeader, "congregationalLeader");
  }
  if (Object.prototype.hasOwnProperty.call(input, "choirAccompanist")) {
    next.choirAccompanist = normalizePerson(input.choirAccompanist, "choirAccompanist");
  }
  if (Object.prototype.hasOwnProperty.call(input, "specialAccompanists")) {
    next.specialAccompanists = normalizeSpecialAccompanists(input.specialAccompanists, supportMusicItems);
  }
  validatePreacherAndLeader(next.preacher, next.congregationalLeader);
  const now = getNowIso(deps);
  const record = {
    schemaVersion: SERVICE_MINISTRY_ASSIGNMENT_SCHEMA_VERSION,
    serviceId: service.serviceId,
    serviceDate: service.serviceDate,
    serviceType: service.serviceType,
    preacher: next.preacher,
    congregationalLeader: next.congregationalLeader,
    choirAccompanist: next.choirAccompanist,
    specialAccompanists: next.specialAccompanists,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    changedBy: normalizeString(input.changedBy) || "ministry-planning-dispatcher"
  };
  await assignmentRef.set(record);
  if (typeof serviceRef.update === "function") {
    await serviceRef.update({
      message: { ...(rawService.message || {}), speakerName: record.preacher?.displayName || "" },
      updatedAt: now
    });
  } else {
    await serviceRef.set({
      ...rawService,
      message: { ...(rawService.message || {}), speakerName: record.preacher?.displayName || "" },
      updatedAt: now
    });
  }
  const spreadsheetWrite = input.writeToSpreadsheet === false
    ? { written: false, skipped: true }
    : await trySpreadsheetWrite({
      ...input,
      service,
      pianoPlan: pianoPlanDoc.exists ? pianoPlanDoc.data() || {} : {},
      ministryAssignments: record,
      writeGroups: ["ministry"]
    }, deps);
  const warnings = spreadsheetWrite.error
    ? [{ code: spreadsheetWrite.error.code, message: spreadsheetWrite.error.message, details: spreadsheetWrite.error.details }]
    : [];
  return { service, assignments: record, supportMusicItems, spreadsheetWrite, warnings };
}

async function syncServiceAssignmentsToSpreadsheet(input = {}, deps = {}) {
  const { service } = await loadService(input.serviceId, deps);
  const [ministryDoc, pianoPlanDoc] = await Promise.all([
    deps.serviceMinistryAssignmentsCollection.doc(service.serviceId).get(),
    deps.servicePianoPlansCollection.doc(service.serviceId).get()
  ]);
  const ministryAssignments = ministryDoc.exists
    ? normalizeStoredAssignments(ministryDoc.data() || {})
    : normalizeStoredAssignments({
      serviceId: service.serviceId,
      serviceDate: service.serviceDate,
      serviceType: service.serviceType,
      preacher: service.message?.speakerName ? { displayName: service.message.speakerName } : null
    });
  const spreadsheetWrite = await writeServiceAssignmentsToGoogleSheet({
    ...input,
    service,
    pianoPlan: pianoPlanDoc.exists ? pianoPlanDoc.data() || {} : {},
    ministryAssignments,
    writeGroups: ["pianos", "ministry"]
  }, deps);
  return { service, spreadsheetWrite };
}

module.exports = {
  createServiceMinistryAssignmentError,
  getServiceMinistryAssignments,
  saveServiceMinistryAssignments,
  SERVICE_MINISTRY_ASSIGNMENT_SCHEMA_VERSION,
  SUPPORT_MUSIC_ROLES,
  syncServiceAssignmentsToSpreadsheet,
  validatePreacherAndLeader
};
