"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  addContactMethod,
  createOrganization,
  createPerson,
  findPossiblePersonDuplicates,
  getOrganization,
  getPerson,
  linkPersonToOrganization,
  recordInteraction,
  searchOrganizations,
  searchPeople,
  updateContactMethod,
  updatePerson
} = require("./dan-relationships-service");
const {
  adjustRelationshipPhotoCrop,
  approveRelationshipProfilePhoto,
  getRelationshipPhoto,
  uploadRelationshipPhoto
} = require("./dan-relationship-photo-service");
const {
  observeOutlookContact,
  prepareOutlookContactPublish,
  prepareOutlookPhotoPublish,
  recordOutlookContactPublish,
  recordOutlookPhotoPublish,
  resolveOutlookMerge
} = require("./dan-outlook-projection-service");
const {
  addItineraryItem,
  buildDestinationRefresher,
  buildDueTravelBriefings,
  createPackingList,
  createTrip,
  getTrip,
  listTrips,
  prepareItineraryCalendarExport,
  recordItineraryCalendarExport,
  updatePackingItem,
  updateTrip
} = require("./dan-travel-companion-service");
const { getDanActorFields } = require("./dan-private-access");

const OPERATION_MODES = Object.freeze(["query", "command"]);

function defineOperation({ name, mode, summary, required = [], optional = [], exampleArguments = {}, argumentGuidance = "", handler }) {
  return Object.freeze({
    name,
    mode,
    summary,
    required: Object.freeze([...required]),
    optional: Object.freeze([...optional]),
    exampleArguments: Object.freeze({ ...exampleArguments }),
    argumentGuidance,
    confirmationPolicy: mode === "command" ? "explicit_for_external_or_destructive_effects" : "none",
    handler
  });
}

const DAN_TRAVEL_OPERATIONS = Object.freeze([
  defineOperation({ name: "getPerson", mode: "query", summary: "Get one private relationship person with affiliations, contact methods, interactions, and photos.", required: ["personId"], exampleArguments: { personId: "person-example" }, handler: getPerson }),
  defineOperation({ name: "searchPeople", mode: "query", summary: "Search Dan's private relationship people, including name-only records.", optional: ["query", "location", "status", "limit"], exampleArguments: { location: "Baguio", limit: 25 }, handler: searchPeople }),
  defineOperation({ name: "findPossiblePersonDuplicates", mode: "query", summary: "Find possible person duplicates without automatically merging records.", optional: ["displayName", "email", "phone", "organizationId"], handler: findPossiblePersonDuplicates }),
  defineOperation({ name: "getOrganization", mode: "query", summary: "Get one private church or organization and its affiliations.", required: ["organizationId"], handler: getOrganization }),
  defineOperation({ name: "searchOrganizations", mode: "query", summary: "Search Dan's private churches and organizations.", optional: ["query", "type", "location", "limit"], handler: searchOrganizations }),
  defineOperation({ name: "getRelationshipPhoto", mode: "query", summary: "Get private photo metadata and a short-lived display URL.", required: ["photoId"], handler: getRelationshipPhoto }),
  defineOperation({ name: "prepareOutlookContactPublish", mode: "query", summary: "Prepare sanitized Outlook contact fields and duplicate-search hints without changing Outlook.", required: ["personId"], optional: ["allowWithoutContactMethod"], argumentGuidance: "Search saved Outlook contacts before asking Dan to approve create, link, or update. Private notes and memories are excluded.", handler: prepareOutlookContactPublish }),
  defineOperation({ name: "listTrips", mode: "query", summary: "List Dan's private trips across personal, family, ministry, and business travel.", optional: ["query", "status", "limit"], handler: listTrips }),
  defineOperation({ name: "getTrip", mode: "query", summary: "Get one trip with itinerary, packing lists, and generated briefings.", required: ["tripId"], handler: getTrip }),
  defineOperation({ name: "prepareItineraryCalendarExport", mode: "query", summary: "Prepare one selected timed itinerary item for Outlook Calendar without changing Outlook.", required: ["itineraryItemId"], optional: ["includeNotes"], argumentGuidance: "Notes remain private unless Dan explicitly chooses to include them.", handler: prepareItineraryCalendarExport }),

  defineOperation({ name: "createPerson", mode: "command", summary: "Create a private person record, including a name-only relationship.", required: ["displayName"], optional: ["personId", "givenName", "middleName", "surname", "honorific", "alternateNames", "title", "notes", "locationKeys", "duplicateReviewed"], argumentGuidance: "Review possible duplicates first; never merge solely by name.", handler: createPerson }),
  defineOperation({ name: "updatePerson", mode: "command", summary: "Version-safely enrich or archive one private person.", required: ["personId", "changes", "expectedVersion"], handler: updatePerson }),
  defineOperation({ name: "createOrganization", mode: "command", summary: "Create a private church, ministry, business, school, nonprofit, or other organization.", required: ["name"], optional: ["organizationId", "type", "alternateNames", "parentOrganizationId", "website", "notes", "locationKeys", "addresses", "duplicateReviewed"], handler: createOrganization }),
  defineOperation({ name: "linkPersonToOrganization", mode: "command", summary: "Link a person to a church or organization with role and source context.", required: ["personId", "organizationId"], optional: ["affiliationId", "role", "startedOn", "endedOn", "confidence", "source", "notes"], handler: linkPersonToOrganization }),
  defineOperation({ name: "addContactMethod", mode: "command", summary: "Add an email, phone, WhatsApp, Messenger, Facebook, address, website, or other method.", required: ["type", "value"], optional: ["personId", "organizationId", "contactMethodId", "label", "preferred", "verified", "verifiedAt", "source", "notes"], handler: addContactMethod }),
  defineOperation({ name: "updateContactMethod", mode: "command", summary: "Version-safely update, verify, prefer, or archive one contact method.", required: ["contactMethodId", "changes", "expectedVersion"], handler: updateContactMethod }),
  defineOperation({ name: "recordInteraction", mode: "command", summary: "Record a private meeting, visit, message, call, letter, event, or other relationship interaction.", required: ["summary"], optional: ["interactionId", "personIds", "organizationIds", "tripId", "type", "happenedAt", "locationKeys", "exactText", "source", "sourceRecordIds", "followUpStatus", "followUpSummary"], handler: recordInteraction }),
  defineOperation({ name: "uploadRelationshipPhoto", mode: "command", summary: "Persist one normal photo privately and prepare an attention-based or user-directed square crop preview.", required: ["personId", "openaiFileIdRefs"], optional: ["cropBox", "focalPoint"], argumentGuidance: "Chat may visually identify the intended person and supply a crop box or focal point. This operation does not perform face recognition.", handler: uploadRelationshipPhoto }),
  defineOperation({ name: "adjustRelationshipPhotoCrop", mode: "command", summary: "Regenerate a profile-photo preview with an approved manual crop box or focal point.", required: ["photoId", "expectedVersion"], optional: ["cropBox", "focalPoint"], handler: adjustRelationshipPhotoCrop }),
  defineOperation({ name: "approveRelationshipProfilePhoto", mode: "command", summary: "Promote an approved crop to the person's profile photo and create application and Outlook derivatives.", required: ["photoId", "expectedVersion", "approved"], argumentGuidance: "approved must be true after Dan has viewed the preview.", handler: approveRelationshipProfilePhoto }),
  defineOperation({ name: "recordOutlookContactPublish", mode: "command", summary: "Record an approved Outlook create, link, or update only after refreshed contact read-back.", required: ["personId", "approved", "action", "contactId", "contactFolderId", "refreshedContact"], optional: ["expectedVersion", "changeKey", "photoStatus"], handler: recordOutlookContactPublish }),
  defineOperation({ name: "observeOutlookContact", mode: "command", summary: "Record a refreshed Outlook observation and propose field-level merges without silently overwriting either side.", required: ["personId", "expectedVersion"], optional: ["contactId", "contactFolderId", "changeKey", "refreshedContact", "deleted"], handler: observeOutlookContact }),
  defineOperation({ name: "resolveOutlookMerge", mode: "command", summary: "Apply Dan's field-level merge choices and return any Outlook updates still required.", required: ["personId", "expectedVersion", "approved", "decisions"], handler: resolveOutlookMerge }),
  defineOperation({ name: "prepareOutlookPhotoPublish", mode: "command", summary: "Prepare a five-minute private JPEG handoff and exact Graph contact-photo path after approval.", required: ["personId", "approved"], argumentGuidance: "The client must perform the Microsoft Graph PUT and record a verified receipt; this operation never accepts an OAuth token.", handler: prepareOutlookPhotoPublish }),
  defineOperation({ name: "recordOutlookPhotoPublish", mode: "command", summary: "Record an approved Outlook contact-photo publish only after the connector verifies the photo read-back.", required: ["personId", "expectedVersion", "approved", "contactId", "contactFolderId", "readBackVerified"], optional: ["graphRequestId"], handler: recordOutlookPhotoPublish }),
  defineOperation({ name: "createTrip", mode: "command", summary: "Create a private trip and initial destination-added relationship briefings.", required: ["name", "destinations"], optional: ["tripId", "purpose", "startDate", "endDate", "timeZone", "status", "travelers", "notes", "legacyProjectId"], handler: createTrip }),
  defineOperation({ name: "updateTrip", mode: "command", summary: "Version-safely update one trip without replacing source-owned calendar or media records.", required: ["tripId", "changes", "expectedVersion"], handler: updateTrip }),
  defineOperation({ name: "addItineraryItem", mode: "command", summary: "Add a source-linked itinerary item; Outlook event IDs remain optional projections.", required: ["tripId", "title"], optional: ["itineraryItemId", "destinationId", "type", "startsAt", "endsAt", "timeZone", "location", "confirmationNumber", "notes", "sourceRecordIds", "outlookCalendarId", "outlookEventId", "outlookSyncStatus"], handler: addItineraryItem }),
  defineOperation({ name: "recordItineraryCalendarExport", mode: "command", summary: "Record an approved selective Outlook Calendar projection only after event read-back.", required: ["itineraryItemId", "expectedVersion", "approved", "outlookCalendarId", "outlookEventId", "refreshedEvent"], handler: recordItineraryCalendarExport }),
  defineOperation({ name: "createPackingList", mode: "command", summary: "Create a reusable or trip-specific live packing checklist.", required: ["name"], optional: ["packingListId", "tripId", "source", "sourceReference", "sourceChecksumSha256", "categories", "rules", "items"], handler: createPackingList }),
  defineOperation({ name: "updatePackingItem", mode: "command", summary: "Version-safely update one packing item, including its live packed state.", required: ["packingListId", "packingItemId", "changes", "expectedVersion"], handler: updatePackingItem }),
  defineOperation({ name: "buildDestinationRefresher", mode: "command", summary: "Persist an on-demand, destination-added, T-14, or active-trip daily relationship refresher.", required: ["tripId"], optional: ["destinationId", "trigger"], handler: buildDestinationRefresher }),
  defineOperation({ name: "buildDueTravelBriefings", mode: "command", summary: "Build missing T-14 and active-trip daily briefings for one local date.", optional: ["today"], handler: buildDueTravelBriefings })
]);

const OPERATION_BY_NAME = new Map(DAN_TRAVEL_OPERATIONS.map((operation) => [operation.name, operation]));

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildCatalogEntry(operation) {
  return {
    operation: operation.name,
    mode: operation.mode,
    summary: operation.summary,
    required: [...operation.required],
    optional: [...operation.optional],
    exampleArguments: { ...operation.exampleArguments },
    argumentGuidance: operation.argumentGuidance,
    confirmationPolicy: operation.confirmationPolicy
  };
}

const CATALOG_HASH = createHash("sha256").update(JSON.stringify(DAN_TRAVEL_OPERATIONS.map(buildCatalogEntry))).digest("hex");
const CATALOG_VERSION = `1-${CATALOG_HASH.slice(0, 12)}`;

function createOperationError(message, statusCode = 400, code = "dan_travel_operation_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function listDanTravelOperations(input = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const query = normalizeString(input.query).toLowerCase();
  const limit = Math.min(Math.max(Number.parseInt(input.limit || "100", 10) || 100, 1), 200);
  if (mode && !OPERATION_MODES.includes(mode)) throw createOperationError("Invalid operation mode", 400, "invalid_operation_mode");
  const operations = DAN_TRAVEL_OPERATIONS
    .filter((operation) => !mode || operation.mode === mode)
    .filter((operation) => !query || `${operation.name} ${operation.summary}`.toLowerCase().includes(query))
    .slice(0, limit)
    .map(buildCatalogEntry);
  return { catalogVersion: CATALOG_VERSION, catalogHash: CATALOG_HASH, modes: [...OPERATION_MODES], count: operations.length, operations };
}

async function startAuditEvent(operation, args, deps) {
  const collection = deps.danTravelAuditEventsCollection;
  if (!collection || typeof collection.doc !== "function") throw createOperationError("Dan travel audit collection is not configured", 500, "dan_travel_audit_not_configured");
  const actor = getDanActorFields(deps);
  const auditEventId = `dan-travel-audit-${randomUUID()}`;
  const now = typeof deps.now === "function" ? new Date(deps.now()).toISOString() : new Date().toISOString();
  const record = {
    auditEventId,
    owner: "dan",
    visibility: "private",
    operation,
    argumentKeys: args && typeof args === "object" ? Object.keys(args).sort() : [],
    actorSub: actor.actorSub,
    actorName: actor.actorName,
    status: "in_progress",
    createdAt: now,
    updatedAt: now
  };
  await collection.doc(auditEventId).create(record);
  return { auditEventId, collection, record };
}

async function finishAuditEvent(audit, result, deps) {
  const resultIds = {};
  const queue = [result];
  while (queue.length && Object.keys(resultIds).length < 30) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && /Id$/.test(key)) resultIds[key] = child;
      else if (child && typeof child === "object") queue.push(child);
    }
  }
  const now = typeof deps.now === "function" ? new Date(deps.now()).toISOString() : new Date().toISOString();
  await audit.collection.doc(audit.auditEventId).set({
    ...audit.record,
    resultIds,
    status: "succeeded",
    completedAt: now,
    updatedAt: now
  });
}

async function failAuditEvent(audit, error, deps) {
  const now = typeof deps.now === "function" ? new Date(deps.now()).toISOString() : new Date().toISOString();
  await audit.collection.doc(audit.auditEventId).set({
    ...audit.record,
    status: "failed",
    error: {
      code: error?.code || "dan_travel_operation_failed",
      status: Number(error?.statusCode) || 500
    },
    failedAt: now,
    updatedAt: now
  });
}

async function runDanTravelOperation(input = {}, deps = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const operationName = normalizeString(input.operation);
  const args = input.arguments ?? input.args ?? {};
  if (!OPERATION_MODES.includes(mode)) throw createOperationError("Invalid operation mode", 400, "invalid_operation_mode");
  if (!operationName) throw createOperationError("Operation is required", 400, "missing_operation");
  if (!args || typeof args !== "object" || Array.isArray(args)) throw createOperationError("Operation arguments must be an object", 400, "invalid_operation_arguments");
  const operation = OPERATION_BY_NAME.get(operationName);
  if (!operation) throw createOperationError("Unknown Dan travel operation", 404, "unknown_operation", { operation: operationName });
  if (operation.mode !== mode) throw createOperationError(`Operation ${operationName} must use ${operation.mode} mode`, 400, "operation_mode_mismatch");
  const missing = operation.required.filter((field) => args[field] === undefined || args[field] === null || args[field] === "");
  if (missing.length) throw createOperationError("Required operation arguments are missing", 400, "missing_operation_arguments", { operation: operationName, missing });
  if (mode !== "command") {
    const result = await operation.handler(args, deps);
    return { operation: operationName, mode, result };
  }
  const audit = await startAuditEvent(operationName, args, deps);
  let result;
  try {
    result = await operation.handler(args, deps);
  } catch (error) {
    try {
      await failAuditEvent(audit, error, deps);
    } catch (_auditError) {
      // The original operation failure remains authoritative.
    }
    throw error;
  }
  try {
    await finishAuditEvent(audit, result, deps);
    return {
      operation: operationName,
      mode,
      result,
      audit: { auditEventId: audit.auditEventId, status: "succeeded" }
    };
  } catch (_auditError) {
    return {
      operation: operationName,
      mode,
      result,
      audit: {
        auditEventId: audit.auditEventId,
        status: "completion_pending",
        warning: "The mutation committed, but the audit completion update needs reconciliation."
      }
    };
  }
}

function buildDanTravelOperationError(error, context = {}) {
  return {
    ok: false,
    requestId: context.requestId || "",
    operation: normalizeString(context.operation),
    mode: normalizeString(context.mode).toLowerCase(),
    error: {
      code: error?.code || "dan_travel_operation_failed",
      message: error?.message || "Dan travel operation failed",
      status: Number(error?.statusCode) || 500,
      details: error?.details || {},
      requestId: context.requestId || ""
    }
  };
}

module.exports = {
  CATALOG_HASH,
  CATALOG_VERSION,
  DAN_TRAVEL_OPERATIONS,
  OPERATION_MODES,
  buildDanTravelOperationError,
  listDanTravelOperations,
  runDanTravelOperation
};
