"use strict";

const {
  SERVICE_ORDER_SOURCE,
  SERVICE_ORDER_SOURCE_TYPE,
  SUPERSEDED_EVENT_FIELDS,
  isServiceOrderSource
} = require("./service-order-firestore-write-plan");

const BLOCKED_ACTIONS = ["conflict"];
const IGNORED_ACTIONS = ["preserve", "missingFromSource"];
const UPDATEABLE_KINDS = new Set([
  "service",
  "serviceOrderItem",
  "serviceSongEvent",
  "serviceMoment"
]);
const SPREADSHEET_SOURCE_TYPES = new Set(["spreadsheet_export", "google_sheet_export"]);
const IMPORT_ACTORS = new Set([
  "service_order_pdf_import",
  "spreadsheet_import",
  "music_planning_import",
  "system"
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getSourceImportId(plan = {}) {
  return normalizeString(plan.sourceImportPlan && plan.sourceImportPlan.id);
}

function countActions(actionGroup = {}, actionName) {
  return Array.isArray(actionGroup[actionName]) ? actionGroup[actionName].length : 0;
}

function getItems(actionGroup = {}, actionName) {
  return Array.isArray(actionGroup[actionName]) ? actionGroup[actionName] : [];
}

function hasSupersedeSpreadsheetEventUpdates(plan = {}) {
  return getItems(plan.serviceSongEvents, "update")
    .some((item) => item.reason === "supersede_spreadsheet_event_for_service_order_pdf");
}

function getErrorWarnings(plan = {}) {
  return (Array.isArray(plan.warnings) ? plan.warnings : []).filter((warning) => warning.severity === "error");
}

function validateServiceOrderCommitPlan(plan = {}, options = {}) {
  const errors = [];
  const sourceImportId = getSourceImportId(plan);

  if (!options.commit) {
    errors.push("Missing required --commit flag.");
  }

  if (!sourceImportId) {
    errors.push("Plan is missing sourceImportPlan.id.");
  }

  if (normalizeString(options.confirmSourceImportId) !== sourceImportId) {
    errors.push("Confirmed source import ID does not match plan source import ID.");
  }

  if (plan.eligibleForCommit !== true) {
    errors.push("Plan is not eligible for commit.");
  }

  const conflictCount = Array.isArray(plan.conflicts)
    ? plan.conflicts.length
    : Number(plan.summary && plan.summary.conflicts && plan.summary.conflicts.total) || 0;
  if (conflictCount > 0) {
    errors.push("Plan contains blocking conflicts.");
  }

  const errorWarnings = getErrorWarnings(plan);
  if (errorWarnings.length > 0) {
    errors.push("Plan contains error-level warnings.");
  }

  for (const actionName of BLOCKED_ACTIONS) {
    for (const [groupName, actionGroup] of Object.entries(getPlanActionGroups(plan))) {
      const count = countActions(actionGroup, actionName);
      if (count > 0) {
        errors.push(`Plan contains ${groupName} ${actionName} actions, which this commit does not support.`);
      }
    }
  }

  const updateCount = Object.values(getPlanActionGroups(plan))
    .reduce((sum, actionGroup) => sum + countActions(actionGroup, "update"), 0);
  if (updateCount > 0 && options.allowPlannedUpdates !== true) {
    errors.push("Plan contains update actions. Pass --allow-planned-updates to refresh planned import-owned records.");
  }

  if (hasSupersedeSpreadsheetEventUpdates(plan) && options.allowSupersedeSpreadsheetEvents !== true) {
    errors.push("Plan supersedes spreadsheet song events. Pass --allow-supersede-spreadsheet-events to mark those rows as superseded.");
  }

  const sourceImportAction = normalizeString(plan.sourceImportPlan && plan.sourceImportPlan.action);
  if (!["create", "preserve"].includes(sourceImportAction)) {
    errors.push(`Unsupported source import action: ${sourceImportAction || "(missing)"}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    sourceImportId,
    errorWarnings
  };
}

function validateCreateOnlyCommitPlan(plan = {}, options = {}) {
  const result = validateServiceOrderCommitPlan(plan, {
    ...options,
    allowPlannedUpdates: false,
    allowSupersedeSpreadsheetEvents: false
  });

  for (const actionName of IGNORED_ACTIONS) {
    for (const [groupName, actionGroup] of Object.entries(getPlanActionGroups(plan))) {
      const count = countActions(actionGroup, actionName);
      if (count > 0) {
        result.errors.push(`Plan contains ${groupName} ${actionName} actions, which this create-only commit does not support.`);
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

function getPlanActionGroups(plan = {}) {
  return {
    services: plan.services || {},
    serviceOrderItems: plan.serviceOrderItems || {},
    serviceSongEvents: plan.serviceSongEvents || {},
    serviceMoments: plan.serviceMoments || {}
  };
}

function createCommitTargetsFromPlan(plan = {}) {
  const sourceImportId = getSourceImportId(plan);
  const targets = [];

  if (plan.sourceImportPlan && plan.sourceImportPlan.proposed) {
    targets.push({
      collectionName: "sourceImports",
      id: sourceImportId,
      proposed: plan.sourceImportPlan.proposed,
      existing: plan.sourceImportPlan.existing || null,
      planAction: plan.sourceImportPlan.action,
      kind: "sourceImport",
      reason: plan.sourceImportPlan.reason || ""
    });
  }

  const definitions = [
    ["services", "services", "service", "serviceId"],
    ["serviceOrderItems", "serviceOrderItems", "serviceOrderItem", "serviceOrderItemId"],
    ["serviceSongEvents", "serviceSongEvents", "serviceSongEvent", "serviceSongEventId"],
    ["serviceMoments", "serviceMoments", "serviceMoment", "serviceMomentId"]
  ];

  for (const [groupName, collectionName, kind] of definitions) {
    const actionGroup = plan[groupName] || {};

    for (const actionName of ["create", "update"]) {
      for (const item of getItems(actionGroup, actionName)) {
        targets.push({
          collectionName,
          id: item.id,
          proposed: item.proposed,
          existing: item.existing || null,
          planAction: item.action,
          kind,
          reason: item.reason || "",
          changedFields: item.changedFields || []
        });
      }
    }
  }

  return targets;
}

function valuesEqual(left, right) {
  return JSON.stringify(left === undefined ? null : left) === JSON.stringify(right === undefined ? null : right);
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

function isSafePlannedExistingDocument(existing = {}, kind = "") {
  if (kind === "serviceSongEvent" && normalizeString(existing.historyVisibility) === "superseded") {
    return true;
  }

  return (isServiceOrderSource(existing) || isSpreadsheetSource(existing)) &&
    isPlannedUnknown(existing) &&
    !hasManualOverride(existing);
}

function isExpectedExistingDocument(existing = {}, proposed = {}, kind = "") {
  if (!existing || !proposed) {
    return false;
  }

  if (kind === "sourceImport") {
    return normalizeString(existing.sourceImportId) === normalizeString(proposed.sourceImportId) &&
      normalizeString(existing.sourceVersion) === normalizeString(proposed.sourceVersion);
  }

  return normalizeString(existing.sourceImportId) === normalizeString(proposed.sourceImportId) &&
    normalizeString(existing.source) === SERVICE_ORDER_SOURCE &&
    normalizeString(existing.sourceType) === SERVICE_ORDER_SOURCE_TYPE &&
    valuesEqual(existing.serviceId, proposed.serviceId);
}

function isSupersedeSpreadsheetTarget(target = {}) {
  return target.kind === "serviceSongEvent" &&
    target.reason === "supersede_spreadsheet_event_for_service_order_pdf" &&
    SUPERSEDED_EVENT_FIELDS.every((fieldName) => Object.prototype.hasOwnProperty.call(target.proposed || {}, fieldName));
}

function classifyCommitTarget({ existing = null, target }) {
  if (!existing) {
    if (target.planAction === "update" || target.planAction === "preserve") {
      return {
        action: "conflictExisting",
        target,
        existing,
        reason: `${target.planAction}_target_missing`
      };
    }

    return {
      action: "create",
      target
    };
  }

  if (isExpectedExistingDocument(existing, target.proposed, target.kind)) {
    if (target.planAction === "update" && UPDATEABLE_KINDS.has(target.kind)) {
      return {
        action: "update",
        target,
        existing
      };
    }

    return {
      action: "skipExisting",
      target,
      existing
    };
  }

  if (
    target.planAction === "update" &&
    UPDATEABLE_KINDS.has(target.kind) &&
    isSupersedeSpreadsheetTarget(target) &&
    isSpreadsheetSource(existing) &&
    isPlannedUnknown(existing) &&
    !hasManualOverride(existing)
  ) {
    return {
      action: "update",
      target,
      existing
    };
  }

  if (target.planAction === "update" && UPDATEABLE_KINDS.has(target.kind) && isSafePlannedExistingDocument(existing, target.kind)) {
    return {
      action: "update",
      target,
      existing
    };
  }

  return {
    action: "conflictExisting",
    target,
    existing,
    reason: "target_document_exists_with_unexpected_content"
  };
}

function summarizeCommitClassifications(classifications = []) {
  const summary = {
    sourceImportCreated: 0,
    sourceImportSkippedExisting: 0,
    servicesCreated: 0,
    servicesUpdated: 0,
    servicesSkippedExisting: 0,
    serviceOrderItemsCreated: 0,
    serviceOrderItemsUpdated: 0,
    serviceOrderItemsSkippedExisting: 0,
    serviceSongEventsCreated: 0,
    serviceSongEventsUpdated: 0,
    serviceSongEventsSkippedExisting: 0,
    spreadsheetSongEventsSuperseded: 0,
    serviceMomentsCreated: 0,
    serviceMomentsUpdated: 0,
    serviceMomentsSkippedExisting: 0,
    conflicts: 0
  };

  for (const item of classifications) {
    if (item.action === "conflictExisting") {
      summary.conflicts += 1;
      continue;
    }

    const fieldPrefixByKind = {
      sourceImport: "sourceImport",
      service: "services",
      serviceOrderItem: "serviceOrderItems",
      serviceSongEvent: "serviceSongEvents",
      serviceMoment: "serviceMoments"
    };
    const prefix = fieldPrefixByKind[item.target.kind];

    if (!prefix) {
      continue;
    }

    if (item.action === "create") {
      summary[`${prefix}Created`] += 1;
    } else if (item.action === "update") {
      summary[`${prefix}Updated`] += 1;
      if (isSupersedeSpreadsheetTarget(item.target)) {
        summary.spreadsheetSongEventsSuperseded += 1;
      }
    } else {
      summary[`${prefix}SkippedExisting`] += 1;
    }
  }

  return summary;
}

module.exports = {
  classifyCommitTarget,
  createCommitTargetsFromPlan,
  getSourceImportId,
  isExpectedExistingDocument,
  isSafePlannedExistingDocument,
  summarizeCommitClassifications,
  validateCreateOnlyCommitPlan,
  validateServiceOrderCommitPlan
};
