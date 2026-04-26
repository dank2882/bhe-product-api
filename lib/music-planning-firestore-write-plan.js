"use strict";

const { createHash } = require("node:crypto");

const IMPORT_CONTRACT_VERSION = "spreadsheet-planning-v1";
const SPREADSHEET_SOURCE_TYPES = new Set(["spreadsheet_export", "google_sheet_export"]);
const IMPORT_ACTORS = new Set(["spreadsheet_import", "music_planning_import", "system"]);

const SERVICE_IMPORT_FIELDS = [
  "serviceDate",
  "serviceType",
  "title",
  "theme",
  "serviceLabels",
  "planningStatus",
  "actualStatus",
  "changedAfterPlan",
  "source",
  "sourceType",
  "sourceName",
  "sourceWorkbookHash",
  "sourceSpreadsheetId",
  "sourceSheetName",
  "sourceRowNumber",
  "sourceCell",
  "sourceImportId",
  "sourceImportedAt",
  "sourcePreviewServiceId"
];

const SERVICE_SONG_EVENT_IMPORT_FIELDS = [
  "serviceId",
  "serviceDate",
  "serviceType",
  "slotIndex",
  "plannedSequence",
  "usageRole",
  "sourceColumnName",
  "sourceColumnKey",
  "sourceRowNumber",
  "sourceCell",
  "rawValue",
  "songTitleCandidate",
  "songTitleConfidence",
  "hymnalNumber",
  "assignedPersonOrGroupRaw",
  "detailNote",
  "title",
  "songTitle",
  "songId",
  "planningStatus",
  "actualStatus",
  "changedAfterPlan",
  "source",
  "sourceType",
  "sourceName",
  "sourceWorkbookHash",
  "sourceSpreadsheetId",
  "sourceSheetName",
  "sourceImportId",
  "sourceImportedAt",
  "sourcePreviewServiceSongEventId"
];

function normalizeString(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function slugify(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function shortHash(value, length = 12) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, length);
}

function toIsoString(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function countBy(items, getKey) {
  return items.reduce((result, item) => {
    const key = getKey(item) || "(blank)";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function buildSourceImportId(sourceImportPreview = {}) {
  const sourceType = slugify(sourceImportPreview.sourceType || "spreadsheet-export");
  const sourceName = slugify(sourceImportPreview.sourceName || "music-ministry-master-data");
  const sheetName = slugify(sourceImportPreview.sourceSheetName || "proposed-schedules");
  const sourceVersionHash = normalizeString(sourceImportPreview.sourceFileHash || sourceImportPreview.sourceVersion || "")
    .slice(0, 12) || shortHash(sourceImportPreview, 12);
  const contractVersion = slugify(IMPORT_CONTRACT_VERSION);

  return `srcimp-${sourceType}-${sourceName}-${sheetName}-${sourceVersionHash}-${contractVersion}`;
}

function buildServiceId(service = {}) {
  const serviceDate = normalizeString(service.serviceDate) || `row-${service.sourceRowNumber || "unknown"}`;
  const serviceType = slugify(service.serviceType || "unknown");

  if (serviceType === "special-event") {
    const titleSlug = slugify(service.title || (service.serviceLabels || [])[0] || "service");
    return `svc-plan-${serviceDate}-special-event-${titleSlug}`;
  }

  return `svc-plan-${serviceDate}-${serviceType}`;
}

function buildServiceSongEventId(event = {}, serviceId) {
  return `sse-plan-${serviceId}-${event.slotIndex}-${slugify(event.sourceColumnKey || event.sourceColumnName || "slot")}`;
}

function buildSourceImportRecord(preview = {}, { sourceImportId, nowIso }) {
  const sourceImportPreview = preview.sourceImportPreview || {};

  return {
    sourceImportId,
    sourceType: sourceImportPreview.sourceType || "spreadsheet_export",
    sourceName: sourceImportPreview.sourceName || "",
    sourceWorkbookHash: sourceImportPreview.sourceFileHash || "",
    sourceSpreadsheetId: sourceImportPreview.sourceSpreadsheetId || "",
    sourceSheetName: sourceImportPreview.sourceSheetName || "",
    sourceVersion: sourceImportPreview.sourceFileHash || "",
    importContractVersion: IMPORT_CONTRACT_VERSION,
    parserVersion: IMPORT_CONTRACT_VERSION,
    mode: "plan",
    status: "planned",
    sourceImportedAt: nowIso,
    previewSummary: preview.summary || {},
    rowCounts: {
      serviceRowsDetected: sourceImportPreview.serviceRowsDetected || 0,
      importableServices: sourceImportPreview.importableServicesDetected || 0,
      skippedServiceShells: sourceImportPreview.skippedServiceShellsDetected || 0,
      serviceSongEvents: sourceImportPreview.songMusicSlotsDetected || 0
    },
    warningCounts: countBy(preview.warnings || [], (warning) => warning.severity || "review"),
    warningsSummary: countBy(preview.warnings || [], (warning) => warning.code || "unknown")
  };
}

function buildProposedServiceRecord(service = {}, context = {}) {
  const serviceId = context.serviceId || buildServiceId(service);
  const sourceImportPreview = context.sourceImportPreview || {};

  return {
    serviceId,
    serviceDate: service.serviceDate || "",
    serviceType: service.serviceType || "",
    title: service.title || "",
    theme: service.theme || "",
    serviceLabels: Array.isArray(service.serviceLabels) ? service.serviceLabels : [],
    planningStatus: service.planningStatus || "planned",
    actualStatus: service.actualStatus || "unknown",
    changedAfterPlan: Boolean(service.changedAfterPlan),
    source: "spreadsheet_import",
    sourceType: service.sourceType || sourceImportPreview.sourceType || "spreadsheet_export",
    sourceName: service.sourceName || sourceImportPreview.sourceName || "",
    sourceWorkbookHash: sourceImportPreview.sourceFileHash || service.sourceWorkbookHash || "",
    sourceSpreadsheetId: sourceImportPreview.sourceSpreadsheetId || service.sourceSpreadsheetId || "",
    sourceSheetName: service.sourceSheetName || sourceImportPreview.sourceSheetName || "",
    sourceRowNumber: service.sourceRowNumber || null,
    sourceCell: service.sourceCell || "",
    sourceImportId: context.sourceImportId,
    sourceImportedAt: context.nowIso,
    sourcePreviewServiceId: service.previewServiceId || "",
    rawDateService: service.rawDateService || "",
    planningSignals: Array.isArray(service.planningSignals) ? service.planningSignals : [],
    warningCodes: Array.isArray(service.warningCodes) ? service.warningCodes : []
  };
}

function buildProposedServiceSongEventRecord(event = {}, context = {}) {
  const sourceImportPreview = context.sourceImportPreview || {};
  const titleCandidate = normalizeString(event.songTitleCandidate || event.songTitle || "");

  return {
    serviceSongEventId: context.serviceSongEventId,
    serviceId: context.serviceId,
    serviceDate: event.serviceDate || "",
    serviceType: event.serviceType || "",
    slotIndex: Number.isInteger(event.slotIndex) ? event.slotIndex : null,
    plannedSequence: Number.isInteger(event.plannedSequence) ? event.plannedSequence : event.slotIndex || null,
    usageRole: event.usageRole || "",
    sourceColumnName: event.sourceColumnName || "",
    sourceColumnKey: event.sourceColumnKey || "",
    sourceRowNumber: event.sourceRowNumber || null,
    sourceCell: event.sourceCell || "",
    rawValue: event.rawValue || event.songTitleRaw || "",
    songTitleCandidate: titleCandidate,
    songTitleConfidence: event.songTitleConfidence || event.titleConfidence || "",
    title: titleCandidate,
    songTitle: titleCandidate,
    hymnalNumber: Number.isInteger(event.hymnalNumber) ? event.hymnalNumber : null,
    assignedPersonOrGroupRaw: event.assignedPersonOrGroupRaw || "",
    detailNote: event.detailNote || "",
    songId: event.songId || null,
    planningStatus: event.planningStatus || "planned",
    actualStatus: event.actualStatus || "unknown",
    changedAfterPlan: Boolean(event.changedAfterPlan),
    source: "spreadsheet_import",
    sourceType: event.sourceType || sourceImportPreview.sourceType || "spreadsheet_export",
    sourceName: event.sourceName || sourceImportPreview.sourceName || "",
    sourceWorkbookHash: sourceImportPreview.sourceFileHash || event.sourceWorkbookHash || "",
    sourceSpreadsheetId: sourceImportPreview.sourceSpreadsheetId || event.sourceSpreadsheetId || "",
    sourceSheetName: event.sourceSheetName || sourceImportPreview.sourceSheetName || "",
    sourceImportId: context.sourceImportId,
    sourceImportedAt: context.nowIso,
    sourcePreviewServiceSongEventId: event.previewServiceSongEventId || "",
    warningCodes: Array.isArray(event.warningCodes) ? event.warningCodes : []
  };
}

function getRecordId(record = {}, idField) {
  return normalizeString(record[idField] || record.firestoreDocId || record.id);
}

function indexExistingRecords(records = [], idField) {
  const result = new Map();

  for (const record of records) {
    const id = getRecordId(record, idField);
    if (id) {
      result.set(id, record);
    }
  }

  return result;
}

function isSpreadsheetSource(record = {}) {
  return record.source === "spreadsheet_import" || SPREADSHEET_SOURCE_TYPES.has(record.sourceType);
}

function isSpreadsheetOwnedPlanned(record = {}) {
  return isSpreadsheetSource(record) &&
    record.planningStatus === "planned" &&
    (record.actualStatus === "unknown" || record.actualStatus === undefined || record.actualStatus === "") &&
    record.changedAfterPlan !== true;
}

function hasManualOverride(record = {}) {
  if (record.manualOverride === true) {
    return true;
  }

  if (Array.isArray(record.manualOverrideFields) && record.manualOverrideFields.length > 0) {
    return true;
  }

  const lastEditedBy = normalizeString(record.lastEditedBy);
  const updatedBy = normalizeString(record.updatedBy);

  return Boolean(lastEditedBy && !IMPORT_ACTORS.has(lastEditedBy)) ||
    Boolean(updatedBy && !IMPORT_ACTORS.has(updatedBy));
}

function hasCuratedSongMatch(record = {}) {
  return Boolean(normalizeString(record.songId)) || Boolean(normalizeString(record.matchedSongId));
}

function isCompletedOrConfirmed(record = {}) {
  return record.planningStatus === "confirmed" ||
    record.planningStatus === "completed" ||
    record.actualStatus === "completed" ||
    record.completionStatus === "completed" ||
    record.changedAfterPlan === true;
}

function getChangedFields(proposed = {}, existing = {}, fieldNames = []) {
  return fieldNames.filter((fieldName) => {
    const proposedValue = proposed[fieldName] === undefined ? null : proposed[fieldName];
    const existingValue = existing[fieldName] === undefined ? null : existing[fieldName];
    return stableStringify(proposedValue) !== stableStringify(existingValue);
  });
}

function makePlanItem({ action, id, proposed = null, existing = null, reason = "", changedFields = [], preservedFields = [] }) {
  return {
    action,
    id,
    reason,
    changedFields,
    preservedFields,
    proposed,
    existing
  };
}

function classifyExistingRecord({ id, proposed, existing, importFields, type }) {
  if (!existing) {
    return makePlanItem({
      action: "create",
      id,
      proposed,
      reason: "record_missing"
    });
  }

  if (isCompletedOrConfirmed(existing)) {
    return makePlanItem({
      action: "conflict",
      id,
      proposed,
      existing,
      reason: "existing_completed_confirmed_or_changed_after_plan"
    });
  }

  if (hasManualOverride(existing)) {
    return makePlanItem({
      action: "preserve",
      id,
      proposed,
      existing,
      reason: "manual_override_present",
      preservedFields: existing.manualOverrideFields || []
    });
  }

  if (type === "serviceSongEvent" && hasCuratedSongMatch(existing)) {
    return makePlanItem({
      action: "preserve",
      id,
      proposed,
      existing,
      reason: "curated_song_match_present",
      preservedFields: ["songId"]
    });
  }

  if (!isSpreadsheetOwnedPlanned(existing)) {
    return makePlanItem({
      action: "conflict",
      id,
      proposed,
      existing,
      reason: "existing_record_not_spreadsheet_owned_planned"
    });
  }

  return makePlanItem({
    action: "update",
    id,
    proposed,
    existing,
    reason: "existing_spreadsheet_planned_record",
    changedFields: getChangedFields(proposed, existing, importFields)
  });
}

function groupProposedById(records, getId) {
  const byId = new Map();

  for (const record of records) {
    const id = getId(record);
    if (!byId.has(id)) {
      byId.set(id, []);
    }
    byId.get(id).push(record);
  }

  return byId;
}

function addDuplicateConflicts({ grouped, collectionName, conflicts, target }) {
  for (const [id, records] of grouped.entries()) {
    if (records.length <= 1) {
      continue;
    }

    const conflict = {
      action: "conflict",
      id,
      reason: "duplicate_proposed_deterministic_id",
      collectionName,
      proposedRecords: records
    };
    conflicts.push(conflict);
    target.conflict.push(conflict);
  }
}

function detectMissingFromSource({ existingRecords, proposedIds, idField }) {
  return existingRecords
    .filter((record) => isSpreadsheetSource(record))
    .filter((record) => {
      const id = getRecordId(record, idField);
      return id && !proposedIds.has(id);
    })
    .map((record) => makePlanItem({
      action: "missingFromSource",
      id: getRecordId(record, idField),
      existing: record,
      reason: "existing_spreadsheet_record_missing_from_latest_preview"
    }));
}

function getErrorWarningConflicts(warnings = []) {
  return warnings
    .filter((warning) => warning.severity === "error")
    .map((warning) => ({
      action: "conflict",
      id: warning.sourceCell || warning.code,
      reason: "preview_error_warning",
      warning
    }));
}

function summarizePlan({ servicesPlan, serviceSongEventsPlan, warnings, conflicts, sourceImportPlan }) {
  const serviceCounts = Object.fromEntries(
    ["create", "update", "preserve", "conflict", "missingFromSource"].map((action) => [
      action,
      servicesPlan[action].length
    ])
  );
  const serviceSongEventCounts = Object.fromEntries(
    ["create", "update", "preserve", "conflict", "missingFromSource"].map((action) => [
      action,
      serviceSongEventsPlan[action].length
    ])
  );

  return {
    sourceImportAction: sourceImportPlan.action,
    services: serviceCounts,
    serviceSongEvents: serviceSongEventCounts,
    warnings: {
      total: warnings.length,
      bySeverity: countBy(warnings, (warning) => warning.severity || "review"),
      byCode: countBy(warnings, (warning) => warning.code || "unknown")
    },
    conflicts: {
      total: conflicts.length,
      byReason: countBy(conflicts, (conflict) => conflict.reason || "unknown")
    }
  };
}

function createEmptyActionGroup() {
  return {
    create: [],
    update: [],
    preserve: [],
    conflict: [],
    missingFromSource: []
  };
}

function buildFirestoreWritePlan(preview = {}, existingState = {}, options = {}) {
  const nowIso = toIsoString(options.now || new Date());
  const sourceImportPreview = preview.sourceImportPreview || {};
  const sourceImportId = options.sourceImportId || buildSourceImportId(sourceImportPreview);
  const sourceImportRecord = buildSourceImportRecord(preview, { sourceImportId, nowIso });
  const sourceImportsById = indexExistingRecords(existingState.sourceImports || [], "sourceImportId");
  const sourceImportPlan = makePlanItem({
    action: sourceImportsById.has(sourceImportId) ? "preserve" : "create",
    id: sourceImportId,
    proposed: sourceImportRecord,
    existing: sourceImportsById.get(sourceImportId) || null,
    reason: sourceImportsById.has(sourceImportId) ? "source_import_snapshot_already_exists" : "source_import_missing"
  });

  const servicesPlan = createEmptyActionGroup();
  const serviceSongEventsPlan = createEmptyActionGroup();
  const conflicts = [];
  const serviceIdByPreviewId = new Map();
  const proposedServices = (preview.importableServices || []).map((service) => {
    const serviceId = buildServiceId(service);
    serviceIdByPreviewId.set(service.previewServiceId, serviceId);
    return buildProposedServiceRecord(service, {
      serviceId,
      sourceImportId,
      sourceImportPreview,
      nowIso
    });
  });
  const proposedServiceEvents = (preview.serviceSongEvents || []).map((event) => {
    const serviceId = serviceIdByPreviewId.get(event.previewServiceId) || buildServiceId(event);
    const serviceSongEventId = buildServiceSongEventId(event, serviceId);
    return buildProposedServiceSongEventRecord(event, {
      serviceId,
      serviceSongEventId,
      sourceImportId,
      sourceImportPreview,
      nowIso
    });
  });

  const proposedServicesById = groupProposedById(proposedServices, (service) => service.serviceId);
  const proposedEventsById = groupProposedById(proposedServiceEvents, (event) => event.serviceSongEventId);
  addDuplicateConflicts({
    grouped: proposedServicesById,
    collectionName: "services",
    conflicts,
    target: servicesPlan
  });
  addDuplicateConflicts({
    grouped: proposedEventsById,
    collectionName: "serviceSongEvents",
    conflicts,
    target: serviceSongEventsPlan
  });

  const duplicateServiceIds = new Set(
    Array.from(proposedServicesById.entries()).filter(([, records]) => records.length > 1).map(([id]) => id)
  );
  const duplicateEventIds = new Set(
    Array.from(proposedEventsById.entries()).filter(([, records]) => records.length > 1).map(([id]) => id)
  );
  const existingServicesById = indexExistingRecords(existingState.services || [], "serviceId");
  const existingEventsById = indexExistingRecords(existingState.serviceSongEvents || [], "serviceSongEventId");

  for (const proposed of proposedServices) {
    if (duplicateServiceIds.has(proposed.serviceId)) {
      continue;
    }

    const planItem = classifyExistingRecord({
      id: proposed.serviceId,
      proposed,
      existing: existingServicesById.get(proposed.serviceId) || null,
      importFields: SERVICE_IMPORT_FIELDS,
      type: "service"
    });
    servicesPlan[planItem.action].push(planItem);
    if (planItem.action === "conflict") {
      conflicts.push(planItem);
    }
  }

  for (const proposed of proposedServiceEvents) {
    if (duplicateEventIds.has(proposed.serviceSongEventId)) {
      continue;
    }

    const planItem = classifyExistingRecord({
      id: proposed.serviceSongEventId,
      proposed,
      existing: existingEventsById.get(proposed.serviceSongEventId) || null,
      importFields: SERVICE_SONG_EVENT_IMPORT_FIELDS,
      type: "serviceSongEvent"
    });
    serviceSongEventsPlan[planItem.action].push(planItem);
    if (planItem.action === "conflict") {
      conflicts.push(planItem);
    }
  }

  const proposedServiceIds = new Set(proposedServices.map((service) => service.serviceId));
  const proposedEventIds = new Set(proposedServiceEvents.map((event) => event.serviceSongEventId));
  servicesPlan.missingFromSource.push(...detectMissingFromSource({
    existingRecords: existingState.services || [],
    proposedIds: proposedServiceIds,
    idField: "serviceId"
  }));
  serviceSongEventsPlan.missingFromSource.push(...detectMissingFromSource({
    existingRecords: existingState.serviceSongEvents || [],
    proposedIds: proposedEventIds,
    idField: "serviceSongEventId"
  }));

  const errorWarningConflicts = getErrorWarningConflicts(preview.warnings || []);
  conflicts.push(...errorWarningConflicts);

  const summary = summarizePlan({
    servicesPlan,
    serviceSongEventsPlan,
    warnings: preview.warnings || [],
    conflicts,
    sourceImportPlan
  });

  return {
    sourceImportPlan,
    services: servicesPlan,
    serviceSongEvents: serviceSongEventsPlan,
    summary,
    warnings: preview.warnings || [],
    conflicts,
    eligibleForCommit: conflicts.length === 0
  };
}

module.exports = {
  IMPORT_CONTRACT_VERSION,
  SERVICE_IMPORT_FIELDS,
  SERVICE_SONG_EVENT_IMPORT_FIELDS,
  buildFirestoreWritePlan,
  buildServiceId,
  buildServiceSongEventId,
  buildSourceImportId,
  buildProposedServiceRecord,
  buildProposedServiceSongEventRecord,
  hasManualOverride,
  isCompletedOrConfirmed,
  isSpreadsheetOwnedPlanned,
  slugify,
  stableStringify
};
