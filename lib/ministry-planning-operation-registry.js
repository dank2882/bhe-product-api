"use strict";

const { createHash } = require("node:crypto");

const {
  buildActiveCongregationalPool,
  getSongById,
  searchSongs,
  updateSongIdentity
} = require("./song-catalog-service");
const { getServiceById, searchServices } = require("./service-history-service");
const { listOperatorCollections, queryOperatorDocuments } = require("./operator-data-service");
const { getMinistryPlanningConfig } = require("./ministry-planning-config-service");
const {
  getPianistWorkload,
  getPianoServicePlan,
  listPianists,
  savePianistProfile,
  saveServicePianoAssignments
} = require("./pianist-planning-service");
const {
  getServiceMinistryAssignments,
  saveServiceMinistryAssignments,
  syncServiceAssignmentsToSpreadsheet
} = require("./service-ministry-assignment-service");
const {
  listGoogleSheetBackups,
  readGoogleSheetRange,
  restoreGoogleSheetBackup,
  restoreGoogleSheetRange
} = require("./google-sheet-backup-service");
const {
  saveServiceCongregationalPlan
} = require("./service-congregational-plan-service");
const {
  inspectMusicPlanningSpreadsheet,
  mutateMinistryData,
  recordServiceSongFeedback,
  syncMusicPlanningSpreadsheet
} = require("./ministry-planning-service");

const OPERATION_MODES = ["query", "command"];

function defineOperation({
  name,
  mode,
  summary,
  required = [],
  optional = [],
  exampleArguments = {},
  argumentGuidance = "",
  confirmationPolicy = "none",
  handler
}) {
  return Object.freeze({
    name,
    mode,
    summary,
    required: Object.freeze([...required]),
    optional: Object.freeze([...optional]),
    exampleArguments: Object.freeze({ ...exampleArguments }),
    argumentGuidance,
    confirmationPolicy,
    handler
  });
}

const MINISTRY_PLANNING_OPERATIONS = Object.freeze([
  defineOperation({
    name: "listDataCollections",
    mode: "query",
    summary: "List the Firestore collections available to ministry planning queries and commands.",
    handler: async () => listOperatorCollections()
  }),
  defineOperation({
    name: "getMinistryPlanningConfig",
    mode: "query",
    summary: "Retrieve the current Firestore-backed workflow, song-planning model, or service-order model.",
    optional: ["configId", "section", "sections"],
    exampleArguments: { sections: ["operatorGuidance", "songPlanning"] },
    argumentGuidance: "Load operatorGuidance once at the first substantive ministry request in a conversation, then request only relevant domain sections as needed. Omit sections to retrieve all runtime documents. The live operation list remains authoritative for operation names and arguments.",
    handler: getMinistryPlanningConfig
  }),
  defineOperation({
    name: "queryData",
    mode: "query",
    summary: "Read ministry records with document IDs, filters, text search, sorting, and field selection.",
    required: ["collection"],
    optional: ["docId", "docIds", "dataFilters", "query", "fields", "orderBy", "limit", "scanLimit"],
    exampleArguments: { collection: "services", orderBy: [{ fieldPath: "serviceDate", direction: "desc" }], limit: 10 },
    handler: queryMinistryData
  }),
  defineOperation({
    name: "searchSongs",
    mode: "query",
    summary: "Search the canonical song catalog by title, hymn number, topic, source, or planning metadata.",
    optional: ["query", "filters", "sort", "limit"],
    exampleArguments: { query: "Footsteps of Jesus", limit: 10 },
    handler: searchSongs
  }),
  defineOperation({
    name: "getSong",
    mode: "query",
    summary: "Retrieve one complete canonical song record.",
    required: ["songId"],
    exampleArguments: { songId: "rejoice-262-footsteps-of-jesus" },
    handler: getSongById
  }),
  defineOperation({
    name: "searchServices",
    mode: "query",
    summary: "Search committed past or upcoming service schedules using natural language or date and service filters.",
    optional: ["query", "filters", "limit"],
    exampleArguments: { query: "last Sunday night", limit: 5 },
    argumentGuidance: "Use this first for schedule questions. It returns related song rows with each service.",
    handler: searchServices
  }),
  defineOperation({
    name: "getService",
    mode: "query",
    summary: "Retrieve one complete service and its ordered song rows.",
    required: ["serviceId"],
    exampleArguments: { serviceId: "svc-plan-2026-07-12-sunday-evening" },
    handler: getServiceById
  }),
  defineOperation({
    name: "buildActiveCongregationalPool",
    mode: "query",
    summary: "Build the current ordinary-service congregational song pool from canonical planning rules.",
    optional: ["limit", "leaderId", "usageRole", "includeExcluded"],
    exampleArguments: { leaderId: "dan", limit: 100 },
    handler: buildActiveCongregationalPool
  }),
  defineOperation({
    name: "inspectMusicPlanningSpreadsheet",
    mode: "query",
    summary: "Read and compare the live planning spreadsheet without changing Firestore.",
    optional: ["googleSheetId", "googleSheetUrl", "sheet", "year", "focusDate", "focusServiceType"],
    exampleArguments: { focusDate: "2026-07-12", focusServiceType: "sunday_night" },
    argumentGuidance: "Use only when the user asks to inspect or compare the live sheet, or a committed schedule lookup is missing expected data.",
    handler: inspectMusicPlanningSpreadsheet
  }),
  defineOperation({
    name: "listGoogleSheetBackups",
    mode: "query",
    summary: "List hidden full-sheet backups available for the live ministry planning spreadsheet.",
    optional: ["googleSheetId", "googleSheetUrl", "limit"],
    exampleArguments: { limit: 10 },
    argumentGuidance: "Assignment writes create these backups automatically before changing the sheet.",
    handler: listGoogleSheetBackups
  }),
  defineOperation({
    name: "readGoogleSheetRange",
    mode: "query",
    summary: "Read a bounded A1 range directly from the live planning spreadsheet without cached exports.",
    required: ["range"],
    optional: ["googleSheetId", "googleSheetUrl", "sheet"],
    exampleArguments: { range: "A125:K140" },
    argumentGuidance: "Use this to verify exact live cells or diagnose stale source-row provenance.",
    handler: readGoogleSheetRange
  }),
  defineOperation({
    name: "listPianists",
    mode: "query",
    summary: "List pianist profiles, capability levels, regular schedules, limits, and optional availability for one service.",
    optional: ["pianistId", "capabilityLevel", "status", "includeInactive", "serviceId", "serviceDate", "serviceType"],
    exampleArguments: { serviceDate: "2026-07-19", serviceType: "sunday_morning" },
    argumentGuidance: "Provide serviceId, or serviceDate plus serviceType, to evaluate each pianist's recurring availability and exact-date exceptions.",
    handler: listPianists
  }),
  defineOperation({
    name: "getPianoServicePlan",
    mode: "query",
    summary: "Get all Piano 1-4 assignments, duties, availability warnings, and required-position coverage for one service.",
    required: ["serviceId"],
    exampleArguments: { serviceId: "svc-plan-2026-07-19-sunday-morning" },
    handler: getPianoServicePlan
  }),
  defineOperation({
    name: "getPianistWorkload",
    mode: "query",
    summary: "Report pianist service counts and Piano 1-4 history, warning when a pianist exceeds their monthly service limit.",
    optional: ["pianistId", "month", "dateFrom", "dateTo"],
    exampleArguments: { month: "2026-07" },
    argumentGuidance: "The default monthly limit is six services. Exceeding the limit warns but does not block an assignment.",
    handler: getPianistWorkload
  }),
  defineOperation({
    name: "getServiceMinistryAssignments",
    mode: "query",
    summary: "Get the preacher, congregational leader, choir accompanist, and per-special accompanists for one service.",
    required: ["serviceId"],
    exampleArguments: { serviceId: "svc-plan-2026-07-19-sunday-morning" },
    argumentGuidance: "The response includes stable serviceSongEventId values for each choir, special-music, and offertory item.",
    handler: getServiceMinistryAssignments
  }),
  defineOperation({
    name: "syncMusicPlanningSpreadsheet",
    mode: "command",
    summary: "Plan and commit a safe live spreadsheet sync, resolving the current source import ID internally.",
    optional: ["googleSheetId", "googleSheetUrl", "sheet", "year", "focusDate", "focusServiceType"],
    exampleArguments: { googleSheetUrl: "https://docs.google.com/spreadsheets/d/1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss/edit" },
    argumentGuidance: "The user's request to sync is sufficient authorization. Do not ask them to repeat a generated sourceImportId.",
    handler: syncMusicPlanningSpreadsheet
  }),
  defineOperation({
    name: "savePianistProfile",
    mode: "command",
    summary: "Create or update a pianist's capability, recurring availability logic, exact-date exceptions, and monthly workload limit.",
    optional: [
      "pianistId",
      "displayName",
      "status",
      "capabilityLevel",
      "defaultAvailability",
      "recurringRules",
      "availabilityExceptions",
      "regularScheduleNotes",
      "monthlyServiceLimit",
      "notes",
      "changedBy"
    ],
    exampleArguments: {
      displayName: "Example Pianist",
      capabilityLevel: "developing",
      defaultAvailability: "unavailable",
      recurringRules: [{ ruleId: "first-third-sunday-am", available: true, serviceTypes: ["sunday_morning"], weeksOfMonth: [1, 3] }],
      monthlyServiceLimit: 6
    },
    argumentGuidance: "A new profile needs displayName. An update may use pianistId. Store Dan's wording in regularScheduleNotes and translate it into recurringRules; exact dates belong in availabilityExceptions.",
    handler: savePianistProfile
  }),
  defineOperation({
    name: "saveServicePianoAssignments",
    mode: "command",
    summary: "Assign pianists to whole-service Piano 1-4 positions, or clear positions, with eligibility and workload warnings.",
    required: ["serviceId"],
    optional: ["assignments", "clearPositions", "replaceAssignments", "writeToSpreadsheet", "googleSheetId", "googleSheetUrl", "sheet", "changedBy"],
    exampleArguments: {
      serviceId: "svc-plan-2026-07-19-sunday-morning",
      assignments: [
        { position: "piano_1", pianistId: "pianist-example-primary" },
        { position: "piano_3", pianistId: "pianist-example-learner" }
      ]
    },
    argumentGuidance: "Piano 1 is required for complete coverage. Piano 2, 3, and 4 are optional. Piano 1 handles prelude, congregationals, invitation, and postlude; all other positions handle congregationals only.",
    handler: saveServicePianoAssignments
  }),
  defineOperation({
    name: "saveServiceCongregationalPlan",
    mode: "command",
    summary: "Change one or more congregational song slots in both Firestore and the visible live Google Sheet row.",
    required: ["serviceId", "songChanges"],
    optional: ["googleSheetId", "googleSheetUrl", "sheet", "changedBy"],
    exampleArguments: {
      serviceId: "svc-plan-2026-08-30-sunday-evening",
      songChanges: [
        { slot: "congregational_1", songId: "rejoice-0276" },
        { slot: "congregational_2", songId: "rejoice-0311" }
      ]
    },
    argumentGuidance: "Use this for requested congregational song changes instead of mutateData. It always backs up and updates the live Sheet; 'do not refresh' means do not re-import the Sheet and does not suppress this requested write.",
    handler: saveServiceCongregationalPlan
  }),
  defineOperation({
    name: "saveServiceMinistryAssignments",
    mode: "command",
    summary: "Save the preacher, congregational leader, choir accompanist, and one accompanist for each special-music item.",
    required: ["serviceId"],
    optional: [
      "preacher",
      "congregationalLeader",
      "choirAccompanist",
      "specialAccompanists",
      "clearFields",
      "writeToSpreadsheet",
      "googleSheetId",
      "googleSheetUrl",
      "sheet",
      "changedBy"
    ],
    exampleArguments: {
      serviceId: "svc-plan-2026-07-19-sunday-morning",
      preacher: { displayName: "Pastor Example" },
      congregationalLeader: { displayName: "Song Leader Example" },
      choirAccompanist: { displayName: "Choir Pianist Example" },
      specialAccompanists: [
        { serviceSongEventId: "sse-plan-example-special-1", displayName: "Special Pianist Example" }
      ]
    },
    argumentGuidance: "The preacher and congregational leader must be different people. Choir and special accompaniment do not count toward monthly Piano 1-4 workload. Spreadsheet write-back is attempted by default.",
    handler: saveServiceMinistryAssignments
  }),
  defineOperation({
    name: "syncServiceAssignmentsToSpreadsheet",
    mode: "command",
    summary: "Write the current preacher, leader, Piano 1-4, choir, and per-special assignments to the service's row in the live Google Sheet.",
    required: ["serviceId"],
    optional: ["googleSheetId", "googleSheetUrl", "sheet"],
    exampleArguments: { serviceId: "svc-plan-2026-07-19-sunday-morning" },
    argumentGuidance: "Use this to retry or explicitly refresh Google Sheet write-back from the current Firestore assignment records.",
    handler: syncServiceAssignmentsToSpreadsheet
  }),
  defineOperation({
    name: "restoreGoogleSheetBackup",
    mode: "command",
    summary: "Restore the active planning tab from a selected hidden backup after first backing up its current state.",
    optional: ["googleSheetId", "googleSheetUrl", "sheet", "backupSheetId", "backupTitle", "confirmed"],
    exampleArguments: { backupSheetId: 123456789, confirmed: true },
    argumentGuidance: "Use backupSheetId or backupTitle from listGoogleSheetBackups. A clear user request to restore that backup is confirmation; pass confirmed true without asking them to approve the same request again.",
    confirmationPolicy: "destructive_only",
    handler: restoreGoogleSheetBackup
  }),
  defineOperation({
    name: "restoreGoogleSheetRange",
    mode: "command",
    summary: "Restore only a selected A1 range from a hidden backup and verify the copied values.",
    required: ["range"],
    optional: ["googleSheetId", "googleSheetUrl", "sheet", "backupSheetId", "backupTitle", "confirmed"],
    exampleArguments: { backupSheetId: 123456789, range: "D31:F31", confirmed: true },
    argumentGuidance: "Use this for surgical recovery without replacing the whole tab. A clear request to repair the named range is confirmation; pass confirmed true.",
    confirmationPolicy: "destructive_only",
    handler: restoreGoogleSheetRange
  }),
  defineOperation({
    name: "recordServiceSongFeedback",
    mode: "command",
    summary: "Apply planning feedback to the canonical songs used in one service, resolving hymn numbers and titles automatically.",
    required: ["serviceId", "feedback"],
    optional: ["treatment", "changedBy"],
    exampleArguments: {
      serviceId: "svc-plan-2026-07-12-sunday-evening",
      feedback: "These songs dragged out; avoid using this group together for now.",
      treatment: "soft_downweight"
    },
    argumentGuidance: "Default treatment is soft_downweight. Use hard_block only when Dan clearly wants every resolved song marked do_not_use.",
    handler: recordServiceSongFeedback
  }),
  defineOperation({
    name: "updateSongIdentity",
    mode: "command",
    summary: "Update one canonical song title or title aliases and write its audit record.",
    required: ["songId", "changes"],
    optional: ["changeReason", "changedBy"],
    exampleArguments: { songId: "rejoice-262-footsteps-of-jesus", changes: { titleAliases: ["Footsteps"] } },
    handler: updateSongIdentity
  }),
  defineOperation({
    name: "mutateData",
    mode: "command",
    summary: "Create, update, merge, replace, or delete one approved ministry data record.",
    required: ["collection", "operation"],
    optional: ["docId", "data", "fieldPatches", "merge", "confirmed", "changedBy"],
    exampleArguments: {
      collection: "songs",
      docId: "rejoice-262-footsteps-of-jesus",
      operation: "update",
      fieldPatches: [{ fieldPath: "ministryPlanning.rotationStrength", action: "set", value: "rare" }]
    },
    argumentGuidance: "Create, merge, and update run from the user's request without another confirmation. Set with merge false and delete require confirmed: true after explicit confirmation.",
    confirmationPolicy: "destructive_only",
    handler: mutateMinistryData
  })
]);

const OPERATION_BY_NAME = new Map(MINISTRY_PLANNING_OPERATIONS.map((operation) => [operation.name, operation]));

function createRegistryError(message, statusCode = 400, code = "ministry_planning_operation_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function queryMinistryData(input = {}, deps = {}) {
  const orderBy = Array.isArray(input.orderBy)
    ? input.orderBy.map((item) => ({
      ...item,
      fieldPath: normalizeString(item?.fieldPath || item?.field)
    }))
    : input.orderBy;

  return queryOperatorDocuments(
    {
      ...input,
      filters: input.dataFilters ?? input.filters,
      freeText: input.freeText ?? input.query,
      select: input.select ?? input.fields,
      orderBy
    },
    deps
  );
}

function buildCatalogEntry(operation) {
  return {
    operation: operation.name,
    mode: operation.mode,
    summary: operation.summary,
    required: [...operation.required],
    optional: [...operation.optional],
    exampleArguments: { ...operation.exampleArguments },
    argumentGuidance: operation.argumentGuidance || "",
    confirmationPolicy: operation.confirmationPolicy
  };
}

const CATALOG_HASH = createHash("sha256")
  .update(JSON.stringify(MINISTRY_PLANNING_OPERATIONS.map(buildCatalogEntry)))
  .digest("hex");
const CATALOG_VERSION = `1-${CATALOG_HASH.slice(0, 12)}`;

function listMinistryPlanningOperations(input = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const query = normalizeString(input.query).toLowerCase();
  const parsedLimit = Number(input.limit);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 200) : 100;

  if (mode && !OPERATION_MODES.includes(mode)) {
    throw createRegistryError("Invalid ministry planning operation mode", 400, "invalid_operation_mode", {
      mode,
      allowedModes: OPERATION_MODES
    });
  }

  const operations = MINISTRY_PLANNING_OPERATIONS
    .filter((operation) => !mode || operation.mode === mode)
    .filter((operation) => !query || [operation.name, operation.summary].join(" ").toLowerCase().includes(query))
    .slice(0, limit)
    .map(buildCatalogEntry);

  return { catalogVersion: CATALOG_VERSION, catalogHash: CATALOG_HASH, modes: [...OPERATION_MODES], count: operations.length, operations };
}

async function runMinistryPlanningOperation(input = {}, deps = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const operationName = normalizeString(input.operation);
  const operationArguments = input.arguments ?? input.args ?? {};

  if (!OPERATION_MODES.includes(mode)) {
    throw createRegistryError("Invalid ministry planning operation mode", 400, "invalid_operation_mode", { mode, allowedModes: OPERATION_MODES });
  }
  if (!operationName) throw createRegistryError("Operation is required", 400, "missing_operation");
  if (!operationArguments || typeof operationArguments !== "object" || Array.isArray(operationArguments)) {
    throw createRegistryError("Operation arguments must be an object", 400, "invalid_operation_arguments");
  }

  const operation = OPERATION_BY_NAME.get(operationName);
  if (!operation) throw createRegistryError("Unknown ministry planning operation", 404, "unknown_operation", { operation: operationName });
  if (operation.mode !== mode) {
    throw createRegistryError(`Operation ${operationName} must use ${operation.mode} mode`, 400, "operation_mode_mismatch", {
      operation: operationName,
      expectedMode: operation.mode,
      receivedMode: mode
    });
  }

  const missing = operation.required.filter((field) => {
    const value = operationArguments[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw createRegistryError("Required operation arguments are missing", 400, "missing_operation_arguments", {
      operation: operationName,
      missing
    });
  }

  const result = await operation.handler(operationArguments, deps);
  return { operation: operationName, mode, result };
}

function buildMinistryPlanningOperationError(error, context = {}) {
  return {
    ok: false,
    requestId: context.requestId || "",
    operation: normalizeString(context.operation),
    mode: normalizeString(context.mode).toLowerCase(),
    error: {
      code: error?.code || "ministry_planning_operation_failed",
      message: error?.message || "Ministry planning operation failed",
      status: Number(error?.statusCode) || 500,
      details: error?.details || {},
      requestId: context.requestId || ""
    }
  };
}

module.exports = {
  CATALOG_HASH,
  CATALOG_VERSION,
  MINISTRY_PLANNING_OPERATIONS,
  OPERATION_MODES,
  buildMinistryPlanningOperationError,
  listMinistryPlanningOperations,
  runMinistryPlanningOperation
};
