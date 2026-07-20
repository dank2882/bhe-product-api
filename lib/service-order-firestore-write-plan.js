"use strict";

const { createHash } = require("node:crypto");

const SERVICE_ORDER_IMPORT_CONTRACT_VERSION = "service-order-pdf-v1";
const SERVICE_ORDER_SOURCE = "service_order_pdf_import";
const SERVICE_ORDER_SOURCE_TYPE = "order_of_service_pdf";
const SPREADSHEET_SOURCE_TYPES = new Set(["spreadsheet_export", "google_sheet_export"]);
const IMPORT_ACTORS = new Set([
  "service_order_pdf_import",
  "spreadsheet_import",
  "music_planning_import",
  "system"
]);

const SERVICE_IMPORT_FIELDS = [
  "serviceDate",
  "serviceType",
  "title",
  "theme",
  "serviceLabels",
  "startTime",
  "duration",
  "planningStatus",
  "actualStatus",
  "changedAfterPlan",
  "source",
  "sourceType",
  "sourceName",
  "sourceImportId",
  "sourceImportedAt",
  "sourceFileName",
  "sourceFileHash",
  "sourcePath"
];

const SERVICE_ORDER_ITEM_IMPORT_FIELDS = [
  "serviceOrderItemId",
  "serviceId",
  "serviceDate",
  "serviceType",
  "sequence",
  "itemType",
  "sectionTitle",
  "title",
  "startTime",
  "usageRole",
  "songTitleCandidate",
  "hymnalNumber",
  "songId",
  "key",
  "titleParenthetical",
  "songEntries",
  "assignedPeople",
  "notes",
  "detailLines",
  "sourcePageIndexes",
  "sourceText",
  "linkedServiceSongEventIds",
  "planningStatus",
  "actualStatus",
  "changedAfterPlan",
  "source",
  "sourceType",
  "sourceName",
  "sourceImportId",
  "sourceImportedAt",
  "sourceFileName",
  "sourceFileHash",
  "sourcePath"
];

const SERVICE_SONG_EVENT_IMPORT_FIELDS = [
  "serviceSongEventId",
  "serviceId",
  "serviceDate",
  "serviceType",
  "slotIndex",
  "plannedSequence",
  "usageRole",
  "rawValue",
  "songTitleCandidate",
  "songTitleConfidence",
  "title",
  "songTitle",
  "hymnalNumber",
  "key",
  "assignedPersonOrGroupRaw",
  "detailNote",
  "songId",
  "linkedServiceOrderItemId",
  "planningStatus",
  "actualStatus",
  "changedAfterPlan",
  "source",
  "sourceType",
  "sourceName",
  "sourceImportId",
  "sourceImportedAt",
  "sourceFileName",
  "sourceFileHash",
  "sourcePath"
];

const SERVICE_MOMENT_IMPORT_FIELDS = [
  "serviceMomentId",
  "serviceId",
  "serviceDate",
  "sequence",
  "momentType",
  "title",
  "linkedOrderItemIds",
  "linkedSongEventIds",
  "primarySongTitleCandidate",
  "primarySongId",
  "scriptureRefs",
  "assignedPeople",
  "planningIntent",
  "executionNotes",
  "status",
  "postService",
  "source",
  "sourceType",
  "sourceName",
  "sourceImportId",
  "sourceImportedAt",
  "sourceFileName",
  "sourceFileHash",
  "sourcePath"
];

const SUPERSEDED_EVENT_FIELDS = [
  "historyVisibility",
  "supersededBySourceImportId",
  "supersededBySourceType",
  "supersededAt",
  "supersededReason",
  "changedAfterPlan"
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

function countBy(items = [], getKey) {
  return items.reduce((result, item) => {
    const key = getKey(item) || "(blank)";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
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

function createEmptyActionGroup() {
  return {
    create: [],
    update: [],
    preserve: [],
    conflict: [],
    missingFromSource: []
  };
}

function makePlanItem({
  action,
  id,
  proposed = null,
  existing = null,
  reason = "",
  changedFields = [],
  preservedFields = []
}) {
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

function getChangedFields(proposed = {}, existing = {}, fieldNames = []) {
  return fieldNames.filter((fieldName) => {
    const proposedValue = proposed[fieldName] === undefined ? null : proposed[fieldName];
    const existingValue = existing[fieldName] === undefined ? null : existing[fieldName];
    return stableStringify(proposedValue) !== stableStringify(existingValue);
  });
}

function isServiceOrderSource(record = {}) {
  return record.source === SERVICE_ORDER_SOURCE || record.sourceType === SERVICE_ORDER_SOURCE_TYPE;
}

function isSpreadsheetSource(record = {}) {
  return record.source === "spreadsheet_import" || SPREADSHEET_SOURCE_TYPES.has(record.sourceType);
}

function isPlannedUnknown(record = {}) {
  return record.planningStatus === "planned" &&
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

function isCompletedOrConfirmed(record = {}) {
  return record.planningStatus === "confirmed" ||
    record.planningStatus === "completed" ||
    record.actualStatus === "completed" ||
    record.completionStatus === "completed" ||
    record.changedAfterPlan === true;
}

function isSafeImportOwnedPlanned(record = {}) {
  return (isServiceOrderSource(record) || isSpreadsheetSource(record)) &&
    isPlannedUnknown(record) &&
    !hasManualOverride(record);
}

function buildPreviewBundle(previews = [], options = {}) {
  const orderedPreviews = [...previews].sort((left, right) => {
    const leftService = left.service || {};
    const rightService = right.service || {};
    return `${leftService.serviceDate || ""}:${leftService.serviceType || ""}:${leftService.serviceId || ""}`
      .localeCompare(`${rightService.serviceDate || ""}:${rightService.serviceType || ""}:${rightService.serviceId || ""}`);
  });
  const sourceFiles = orderedPreviews.map((preview) => ({
    sourceFileName: preview.sourceImportPreview?.sourceFileName || "",
    sourceFileHash: preview.sourceImportPreview?.sourceFileHash || "",
    sourcePath: preview.sourceImportPreview?.sourcePath || "",
    serviceId: preview.service?.serviceId || "",
    serviceDate: preview.service?.serviceDate || "",
    serviceType: preview.service?.serviceType || ""
  }));
  const serviceDates = orderedPreviews
    .map((preview) => preview.service?.serviceDate || "")
    .filter(Boolean)
    .sort();
  const sourceVersion = shortHash(sourceFiles, 16);

  return {
    sourceImportPreview: {
      sourceType: SERVICE_ORDER_SOURCE_TYPE,
      sourceName: options.sourceName || "Service Order PDF Import",
      sourceVersion,
      importMode: "preview",
      importContractVersion: SERVICE_ORDER_IMPORT_CONTRACT_VERSION,
      planningStatusDefault: "planned",
      actualStatusDefault: "unknown",
      serviceDateStart: serviceDates[0] || "",
      serviceDateEnd: serviceDates[serviceDates.length - 1] || "",
      sourceFiles,
      servicesDetected: orderedPreviews.length,
      orderItemsDetected: orderedPreviews.reduce((sum, preview) => sum + (preview.serviceOrderItems || []).length, 0),
      serviceSongEventsDetected: orderedPreviews.reduce((sum, preview) => sum + (preview.serviceSongEvents || []).length, 0),
      serviceMomentsDetected: orderedPreviews.reduce((sum, preview) => sum + (preview.serviceMoments || []).length, 0),
      warningsCount: orderedPreviews.reduce((sum, preview) => sum + (preview.warnings || []).length, 0)
    },
    servicePreviews: orderedPreviews,
    warnings: orderedPreviews.flatMap((preview) => preview.warnings || []),
    summary: {
      services: orderedPreviews.length,
      orderItems: orderedPreviews.reduce((sum, preview) => sum + (preview.serviceOrderItems || []).length, 0),
      serviceSongEvents: orderedPreviews.reduce((sum, preview) => sum + (preview.serviceSongEvents || []).length, 0),
      serviceMoments: orderedPreviews.reduce((sum, preview) => sum + (preview.serviceMoments || []).length, 0),
      warnings: orderedPreviews.reduce((sum, preview) => sum + (preview.warnings || []).length, 0)
    }
  };
}

function buildSourceImportId(sourceImportPreview = {}) {
  const sourceType = slugify(sourceImportPreview.sourceType || SERVICE_ORDER_SOURCE_TYPE);
  const sourceName = slugify(sourceImportPreview.sourceName || "service-order-pdf-import");
  const dateRange = [
    sourceImportPreview.serviceDateStart || "unknown-start",
    sourceImportPreview.serviceDateEnd || "unknown-end"
  ].map(slugify).join("-");
  const sourceVersion = normalizeString(sourceImportPreview.sourceVersion || "")
    .slice(0, 16) || shortHash(sourceImportPreview, 16);

  return `srcimp-${sourceType}-${sourceName}-${dateRange}-${sourceVersion}-${slugify(SERVICE_ORDER_IMPORT_CONTRACT_VERSION)}`;
}

function buildSourceImportRecord(previewBundle = {}, { sourceImportId, nowIso } = {}) {
  const sourceImportPreview = previewBundle.sourceImportPreview || {};

  return {
    sourceImportId,
    sourceType: SERVICE_ORDER_SOURCE_TYPE,
    sourceName: sourceImportPreview.sourceName || "Service Order PDF Import",
    sourceVersion: sourceImportPreview.sourceVersion || "",
    importContractVersion: SERVICE_ORDER_IMPORT_CONTRACT_VERSION,
    parserVersion: SERVICE_ORDER_IMPORT_CONTRACT_VERSION,
    mode: "plan",
    status: "planned",
    sourceImportedAt: nowIso,
    serviceDateStart: sourceImportPreview.serviceDateStart || "",
    serviceDateEnd: sourceImportPreview.serviceDateEnd || "",
    sourceFiles: Array.isArray(sourceImportPreview.sourceFiles) ? sourceImportPreview.sourceFiles : [],
    previewSummary: previewBundle.summary || {},
    rowCounts: {
      services: sourceImportPreview.servicesDetected || 0,
      serviceOrderItems: sourceImportPreview.orderItemsDetected || 0,
      serviceSongEvents: sourceImportPreview.serviceSongEventsDetected || 0,
      serviceMoments: sourceImportPreview.serviceMomentsDetected || 0
    },
    warningCounts: countBy(previewBundle.warnings || [], (warning) => warning.severity || "review"),
    warningsSummary: countBy(previewBundle.warnings || [], (warning) => warning.code || "unknown")
  };
}

function getThemeFromPreview(preview = {}) {
  const themeItem = (preview.serviceOrderItems || []).find((item) => item.itemType === "theme");
  return normalizeString(themeItem?.title || themeItem?.sectionTitle || "");
}

function getSourceMetadata(preview = {}, context = {}) {
  const sourceImportPreview = preview.sourceImportPreview || {};

  return {
    source: SERVICE_ORDER_SOURCE,
    sourceType: SERVICE_ORDER_SOURCE_TYPE,
    sourceName: context.sourceName || "Service Order PDF Import",
    sourceImportId: context.sourceImportId,
    sourceImportedAt: context.nowIso,
    sourceFileName: sourceImportPreview.sourceFileName || "",
    sourceFileHash: sourceImportPreview.sourceFileHash || "",
    sourcePath: sourceImportPreview.sourcePath || ""
  };
}

function buildProposedServiceRecord(preview = {}, context = {}) {
  const service = preview.service || {};

  return {
    serviceId: service.serviceId || "",
    serviceDate: service.serviceDate || "",
    serviceType: service.serviceType || "",
    title: service.title || "",
    theme: getThemeFromPreview(preview),
    serviceLabels: Array.isArray(service.serviceLabels) ? service.serviceLabels : [],
    startTime: service.startTime || "",
    duration: service.duration || "",
    planningStatus: service.planningStatus || "planned",
    actualStatus: service.actualStatus || "unknown",
    changedAfterPlan: Boolean(service.changedAfterPlan),
    ...getSourceMetadata(preview, context)
  };
}

function buildProposedServiceOrderItemRecord(item = {}, context = {}) {
  return {
    serviceOrderItemId: item.serviceOrderItemId || "",
    serviceId: item.serviceId || "",
    serviceDate: item.serviceDate || "",
    serviceType: item.serviceType || "",
    sequence: Number.isInteger(item.sequence) ? item.sequence : null,
    itemType: item.itemType || "",
    sectionTitle: item.sectionTitle || "",
    title: item.title || "",
    startTime: item.startTime || "",
    usageRole: item.usageRole || "",
    songTitleCandidate: item.songTitleCandidate || "",
    hymnalNumber: Number.isInteger(item.hymnalNumber) ? item.hymnalNumber : null,
    songId: item.songId || null,
    key: item.key || "",
    titleParenthetical: item.titleParenthetical || "",
    songEntries: Array.isArray(item.songEntries) ? item.songEntries : [],
    assignedPeople: Array.isArray(item.assignedPeople) ? item.assignedPeople : [],
    notes: Array.isArray(item.notes) ? item.notes : [],
    detailLines: Array.isArray(item.detailLines) ? item.detailLines : [],
    sourcePageIndexes: Array.isArray(item.sourcePageIndexes) ? item.sourcePageIndexes : [],
    sourceText: Array.isArray(item.sourceText) ? item.sourceText : [],
    linkedServiceSongEventIds: context.linkedServiceSongEventIdsByOrderItemId.get(item.serviceOrderItemId) || [],
    planningStatus: item.planningStatus || "planned",
    actualStatus: item.actualStatus || "unknown",
    changedAfterPlan: Boolean(item.changedAfterPlan),
    ...getSourceMetadata(context.preview, context)
  };
}

function buildProposedServiceSongEventRecord(event = {}, context = {}) {
  return {
    serviceSongEventId: event.serviceSongEventId || "",
    serviceId: event.serviceId || "",
    serviceDate: event.serviceDate || "",
    serviceType: event.serviceType || "",
    slotIndex: Number.isInteger(event.slotIndex) ? event.slotIndex : null,
    plannedSequence: Number.isInteger(event.plannedSequence) ? event.plannedSequence : event.slotIndex || null,
    usageRole: event.usageRole || "",
    rawValue: event.rawValue || "",
    songTitleCandidate: event.songTitleCandidate || "",
    songTitleConfidence: event.songTitleConfidence || "",
    title: event.title || event.songTitleCandidate || "",
    songTitle: event.songTitle || event.songTitleCandidate || "",
    hymnalNumber: Number.isInteger(event.hymnalNumber) ? event.hymnalNumber : null,
    key: event.key || "",
    assignedPersonOrGroupRaw: event.assignedPersonOrGroupRaw || "",
    detailNote: event.detailNote || "",
    songId: event.songId || null,
    linkedServiceOrderItemId: event.linkedServiceOrderItemId || "",
    planningStatus: event.planningStatus || "planned",
    actualStatus: event.actualStatus || "unknown",
    changedAfterPlan: Boolean(event.changedAfterPlan),
    ...getSourceMetadata(context.preview, context)
  };
}

function buildProposedServiceMomentRecord(moment = {}, context = {}) {
  return {
    serviceMomentId: moment.serviceMomentId || "",
    serviceId: moment.serviceId || "",
    serviceDate: moment.serviceDate || "",
    sequence: Number.isInteger(moment.sequence) ? moment.sequence : null,
    momentType: moment.momentType || "",
    title: moment.title || "",
    linkedOrderItemIds: Array.isArray(moment.linkedOrderItemIds) ? moment.linkedOrderItemIds : [],
    linkedSongEventIds: Array.isArray(moment.linkedSongEventIds) ? moment.linkedSongEventIds : [],
    primarySongTitleCandidate: moment.primarySongTitleCandidate || "",
    primarySongId: moment.primarySongId || null,
    scriptureRefs: Array.isArray(moment.scriptureRefs) ? moment.scriptureRefs : [],
    assignedPeople: Array.isArray(moment.assignedPeople) ? moment.assignedPeople : [],
    planningIntent: moment.planningIntent || "",
    executionNotes: moment.executionNotes || "",
    status: moment.status || "detected_for_review",
    postService: moment.postService && typeof moment.postService === "object"
      ? moment.postService
      : { impact: "unknown", notes: "" },
    ...getSourceMetadata(context.preview, context)
  };
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

function classifyImportRecord({ id, proposed, existing, importFields, type }) {
  if (!existing) {
    return makePlanItem({
      action: "create",
      id,
      proposed,
      reason: "record_missing"
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

  if (isCompletedOrConfirmed(existing)) {
    return makePlanItem({
      action: "conflict",
      id,
      proposed,
      existing,
      reason: "existing_completed_confirmed_or_changed_after_plan"
    });
  }

  if (!isSafeImportOwnedPlanned(existing)) {
    return makePlanItem({
      action: "conflict",
      id,
      proposed,
      existing,
      reason: "existing_record_not_import_owned_planned",
      preservedFields: type ? [type] : []
    });
  }

  return makePlanItem({
    action: "update",
    id,
    proposed,
    existing,
    reason: isServiceOrderSource(existing)
      ? "existing_service_order_planned_record"
      : "existing_import_owned_planned_record",
    changedFields: getChangedFields(proposed, existing, importFields)
  });
}

function detectMissingFromSource({ existingRecords, proposedIds, idField }) {
  return existingRecords
    .filter((record) => isServiceOrderSource(record))
    .filter((record) => {
      const id = getRecordId(record, idField);
      return id && !proposedIds.has(id);
    })
    .map((record) => makePlanItem({
      action: "missingFromSource",
      id: getRecordId(record, idField),
      existing: record,
      reason: "existing_service_order_record_missing_from_latest_preview"
    }));
}

function getErrorWarningConflicts(warnings = []) {
  return warnings
    .filter((warning) => warning.severity === "error")
    .map((warning) => ({
      action: "conflict",
      id: warning.sourceFileName || warning.sourcePath || warning.code,
      reason: "preview_error_warning",
      warning
    }));
}

function buildSupersededEventUpdate({ existingEvent, sourceImportId, nowIso }) {
  return {
    ...existingEvent,
    historyVisibility: "superseded",
    supersededBySourceImportId: sourceImportId,
    supersededBySourceType: SERVICE_ORDER_SOURCE_TYPE,
    supersededAt: nowIso,
    supersededReason: "Replaced in service history by order-of-service PDF import.",
    changedAfterPlan: false
  };
}

function isSpreadsheetEventSupersedeCandidate(event = {}, importedServiceIds = new Set()) {
  return importedServiceIds.has(normalizeString(event.serviceId)) &&
    isSpreadsheetSource(event) &&
    isPlannedUnknown(event) &&
    !hasManualOverride(event) &&
    event.historyVisibility !== "superseded";
}

function addSupersedeSpreadsheetEventUpdates({
  serviceSongEventsPlan,
  existingEvents,
  importedServiceIds,
  sourceImportId,
  nowIso
}) {
  const proposedUpdates = [];

  for (const existingEvent of existingEvents) {
    if (!isSpreadsheetEventSupersedeCandidate(existingEvent, importedServiceIds)) {
      continue;
    }

    const id = getRecordId(existingEvent, "serviceSongEventId");
    if (!id) {
      continue;
    }

    const proposed = buildSupersededEventUpdate({ existingEvent, sourceImportId, nowIso });
    proposedUpdates.push(makePlanItem({
      action: "update",
      id,
      proposed,
      existing: existingEvent,
      reason: "supersede_spreadsheet_event_for_service_order_pdf",
      changedFields: getChangedFields(proposed, existingEvent, SUPERSEDED_EVENT_FIELDS)
    }));
  }

  serviceSongEventsPlan.update.push(...proposedUpdates);
}

function actionCounts(actionGroup = {}) {
  return Object.fromEntries(
    ["create", "update", "preserve", "conflict", "missingFromSource"].map((action) => [
      action,
      Array.isArray(actionGroup[action]) ? actionGroup[action].length : 0
    ])
  );
}

function summarizePlan({
  servicesPlan,
  serviceOrderItemsPlan,
  serviceSongEventsPlan,
  serviceMomentsPlan,
  warnings,
  conflicts,
  sourceImportPlan
}) {
  return {
    sourceImportAction: sourceImportPlan.action,
    services: actionCounts(servicesPlan),
    serviceOrderItems: actionCounts(serviceOrderItemsPlan),
    serviceSongEvents: actionCounts(serviceSongEventsPlan),
    serviceMoments: actionCounts(serviceMomentsPlan),
    supersededSpreadsheetEvents: serviceSongEventsPlan.update
      .filter((item) => item.reason === "supersede_spreadsheet_event_for_service_order_pdf")
      .length,
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

function addProposedRecordsToPlan({
  proposedRecords,
  existingRecords,
  idField,
  collectionName,
  actionGroup,
  conflicts,
  importFields,
  type
}) {
  const proposedById = groupProposedById(proposedRecords, (record) => record[idField]);
  addDuplicateConflicts({
    grouped: proposedById,
    collectionName,
    conflicts,
    target: actionGroup
  });

  const duplicateIds = new Set(
    Array.from(proposedById.entries()).filter(([, records]) => records.length > 1).map(([id]) => id)
  );
  const existingById = indexExistingRecords(existingRecords, idField);

  for (const proposed of proposedRecords) {
    const id = proposed[idField];
    if (duplicateIds.has(id)) {
      continue;
    }

    const planItem = classifyImportRecord({
      id,
      proposed,
      existing: existingById.get(id) || null,
      importFields,
      type
    });
    actionGroup[planItem.action].push(planItem);
    if (planItem.action === "conflict") {
      conflicts.push(planItem);
    }
  }

  const proposedIds = new Set(proposedRecords.map((record) => record[idField]));
  actionGroup.missingFromSource.push(...detectMissingFromSource({
    existingRecords,
    proposedIds,
    idField
  }));
}

function buildServiceOrderFirestoreWritePlan(previewBundle = {}, existingState = {}, options = {}) {
  const nowIso = toIsoString(options.now || new Date());
  const sourceImportPreview = previewBundle.sourceImportPreview || {};
  const sourceImportId = options.sourceImportId || buildSourceImportId(sourceImportPreview);
  const sourceName = sourceImportPreview.sourceName || "Service Order PDF Import";
  const sourceImportRecord = buildSourceImportRecord(previewBundle, { sourceImportId, nowIso });
  const sourceImportsById = indexExistingRecords(existingState.sourceImports || [], "sourceImportId");
  const sourceImportPlan = makePlanItem({
    action: sourceImportsById.has(sourceImportId) ? "preserve" : "create",
    id: sourceImportId,
    proposed: sourceImportRecord,
    existing: sourceImportsById.get(sourceImportId) || null,
    reason: sourceImportsById.has(sourceImportId) ? "source_import_snapshot_already_exists" : "source_import_missing"
  });

  const servicesPlan = createEmptyActionGroup();
  const serviceOrderItemsPlan = createEmptyActionGroup();
  const serviceSongEventsPlan = createEmptyActionGroup();
  const serviceMomentsPlan = createEmptyActionGroup();
  const conflicts = [];
  const servicePreviews = previewBundle.servicePreviews || [];
  const importedServiceIds = new Set(servicePreviews.map((preview) => normalizeString(preview.service?.serviceId)).filter(Boolean));
  const proposedServices = [];
  const proposedOrderItems = [];
  const proposedSongEvents = [];
  const proposedMoments = [];

  for (const preview of servicePreviews) {
    const context = {
      preview,
      sourceImportId,
      sourceName,
      nowIso,
      linkedServiceSongEventIdsByOrderItemId: new Map()
    };

    for (const event of preview.serviceSongEvents || []) {
      const linkedId = event.linkedServiceOrderItemId || "";
      if (!context.linkedServiceSongEventIdsByOrderItemId.has(linkedId)) {
        context.linkedServiceSongEventIdsByOrderItemId.set(linkedId, []);
      }
      context.linkedServiceSongEventIdsByOrderItemId.get(linkedId).push(event.serviceSongEventId);
    }

    proposedServices.push(buildProposedServiceRecord(preview, context));
    proposedOrderItems.push(
      ...(preview.serviceOrderItems || []).map((item) => buildProposedServiceOrderItemRecord(item, context))
    );
    proposedSongEvents.push(
      ...(preview.serviceSongEvents || []).map((event) => buildProposedServiceSongEventRecord(event, context))
    );
    proposedMoments.push(
      ...(preview.serviceMoments || []).map((moment) => buildProposedServiceMomentRecord(moment, context))
    );
  }

  addProposedRecordsToPlan({
    proposedRecords: proposedServices,
    existingRecords: existingState.services || [],
    idField: "serviceId",
    collectionName: "services",
    actionGroup: servicesPlan,
    conflicts,
    importFields: SERVICE_IMPORT_FIELDS,
    type: "service"
  });
  addProposedRecordsToPlan({
    proposedRecords: proposedOrderItems,
    existingRecords: existingState.serviceOrderItems || [],
    idField: "serviceOrderItemId",
    collectionName: "serviceOrderItems",
    actionGroup: serviceOrderItemsPlan,
    conflicts,
    importFields: SERVICE_ORDER_ITEM_IMPORT_FIELDS,
    type: "serviceOrderItem"
  });
  addProposedRecordsToPlan({
    proposedRecords: proposedSongEvents,
    existingRecords: existingState.serviceSongEvents || [],
    idField: "serviceSongEventId",
    collectionName: "serviceSongEvents",
    actionGroup: serviceSongEventsPlan,
    conflicts,
    importFields: SERVICE_SONG_EVENT_IMPORT_FIELDS,
    type: "serviceSongEvent"
  });
  addProposedRecordsToPlan({
    proposedRecords: proposedMoments,
    existingRecords: existingState.serviceMoments || [],
    idField: "serviceMomentId",
    collectionName: "serviceMoments",
    actionGroup: serviceMomentsPlan,
    conflicts,
    importFields: SERVICE_MOMENT_IMPORT_FIELDS,
    type: "serviceMoment"
  });

  addSupersedeSpreadsheetEventUpdates({
    serviceSongEventsPlan,
    existingEvents: existingState.serviceSongEvents || [],
    importedServiceIds,
    sourceImportId,
    nowIso
  });

  const errorWarningConflicts = getErrorWarningConflicts(previewBundle.warnings || []);
  conflicts.push(...errorWarningConflicts);

  const summary = summarizePlan({
    servicesPlan,
    serviceOrderItemsPlan,
    serviceSongEventsPlan,
    serviceMomentsPlan,
    warnings: previewBundle.warnings || [],
    conflicts,
    sourceImportPlan
  });

  return {
    sourceImportPlan,
    services: servicesPlan,
    serviceOrderItems: serviceOrderItemsPlan,
    serviceSongEvents: serviceSongEventsPlan,
    serviceMoments: serviceMomentsPlan,
    summary,
    warnings: previewBundle.warnings || [],
    conflicts,
    eligibleForCommit: conflicts.length === 0
  };
}

module.exports = {
  SERVICE_ORDER_IMPORT_CONTRACT_VERSION,
  SERVICE_ORDER_SOURCE,
  SERVICE_ORDER_SOURCE_TYPE,
  SUPERSEDED_EVENT_FIELDS,
  buildPreviewBundle,
  buildServiceOrderFirestoreWritePlan,
  buildSourceImportId,
  buildSourceImportRecord,
  buildProposedServiceRecord,
  buildProposedServiceOrderItemRecord,
  buildProposedServiceSongEventRecord,
  buildProposedServiceMomentRecord,
  hasManualOverride,
  isServiceOrderSource,
  isSpreadsheetEventSupersedeCandidate,
  slugify,
  stableStringify
};
