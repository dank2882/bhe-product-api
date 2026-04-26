"use strict";

const BLOCKED_ACTIONS = ["conflict"];
const IGNORED_ACTIONS = ["preserve", "missingFromSource"];
const UPDATEABLE_KINDS = new Set(["service", "serviceSongEvent"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getSourceImportId(plan = {}) {
  return normalizeString(plan.sourceImportPlan && plan.sourceImportPlan.id);
}

function countActions(actionGroup = {}, actionName) {
  return Array.isArray(actionGroup[actionName]) ? actionGroup[actionName].length : 0;
}

function getCreateItems(actionGroup = {}) {
  return Array.isArray(actionGroup.create) ? actionGroup.create : [];
}

function getUpdateItems(actionGroup = {}) {
  return Array.isArray(actionGroup.update) ? actionGroup.update : [];
}

function getErrorWarnings(plan = {}) {
  return (Array.isArray(plan.warnings) ? plan.warnings : []).filter((warning) => warning.severity === "error");
}

function validateMusicPlanningCommitPlan(plan = {}, options = {}) {
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
    const serviceCount = countActions(plan.services, actionName);
    const eventCount = countActions(plan.serviceSongEvents, actionName);

    if (serviceCount > 0) {
      errors.push(`Plan contains service ${actionName} actions, which this commit does not support.`);
    }

    if (eventCount > 0) {
      errors.push(`Plan contains service song event ${actionName} actions, which this commit does not support.`);
    }
  }

  const serviceUpdates = countActions(plan.services, "update");
  const eventUpdates = countActions(plan.serviceSongEvents, "update");
  if ((serviceUpdates > 0 || eventUpdates > 0) && options.allowPlannedUpdates !== true) {
    errors.push("Plan contains update actions. Pass --allow-planned-updates to refresh spreadsheet-owned planned records.");
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
  const result = validateMusicPlanningCommitPlan(plan, {
    ...options,
    allowPlannedUpdates: false
  });

  for (const actionName of IGNORED_ACTIONS) {
    const serviceCount = countActions(plan.services, actionName);
    const eventCount = countActions(plan.serviceSongEvents, actionName);

    if (serviceCount > 0) {
      result.errors.push(`Plan contains service ${actionName} actions, which this create-only commit does not support.`);
    }

    if (eventCount > 0) {
      result.errors.push(`Plan contains service song event ${actionName} actions, which this create-only commit does not support.`);
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

function createCommitTargetsFromPlan(plan = {}) {
  const sourceImportId = getSourceImportId(plan);
  const targets = [];

  if (plan.sourceImportPlan && plan.sourceImportPlan.proposed) {
    targets.push({
      collectionName: "sourceImports",
      id: sourceImportId,
      proposed: plan.sourceImportPlan.proposed,
      planAction: plan.sourceImportPlan.action,
      kind: "sourceImport"
    });
  }

  for (const item of getCreateItems(plan.services)) {
    targets.push({
      collectionName: "services",
      id: item.id,
      proposed: item.proposed,
      planAction: item.action,
      kind: "service"
    });
  }

  for (const item of getUpdateItems(plan.services)) {
    targets.push({
      collectionName: "services",
      id: item.id,
      proposed: item.proposed,
      existing: item.existing,
      planAction: item.action,
      kind: "service"
    });
  }

  for (const item of getCreateItems(plan.serviceSongEvents)) {
    targets.push({
      collectionName: "serviceSongEvents",
      id: item.id,
      proposed: item.proposed,
      planAction: item.action,
      kind: "serviceSongEvent"
    });
  }

  for (const item of getUpdateItems(plan.serviceSongEvents)) {
    targets.push({
      collectionName: "serviceSongEvents",
      id: item.id,
      proposed: item.proposed,
      existing: item.existing,
      planAction: item.action,
      kind: "serviceSongEvent"
    });
  }

  return targets;
}

function valuesEqual(left, right) {
  return JSON.stringify(left === undefined ? null : left) === JSON.stringify(right === undefined ? null : right);
}

function isExpectedExistingDocument(existing = {}, proposed = {}, kind = "") {
  if (!existing || !proposed) {
    return false;
  }

  if (kind === "sourceImport") {
    return normalizeString(existing.sourceImportId) === normalizeString(proposed.sourceImportId) &&
      normalizeString(existing.sourceWorkbookHash) === normalizeString(proposed.sourceWorkbookHash) &&
      normalizeString(existing.sourceSheetName) === normalizeString(proposed.sourceSheetName);
  }

  return normalizeString(existing.sourceImportId) === normalizeString(proposed.sourceImportId) &&
    normalizeString(existing.source) === normalizeString(proposed.source) &&
    normalizeString(existing.sourceType) === normalizeString(proposed.sourceType) &&
    valuesEqual(existing.serviceId, proposed.serviceId) &&
    (kind !== "serviceSongEvent" || valuesEqual(existing.serviceSongEventId, proposed.serviceSongEventId));
}

function isSafePlannedExistingDocument(existing = {}, kind = "") {
  const source = normalizeString(existing.source);
  const sourceType = normalizeString(existing.sourceType);
  const planningStatus = normalizeString(existing.planningStatus);
  const actualStatus = normalizeString(existing.actualStatus);
  const manualOverrideFields = Array.isArray(existing.manualOverrideFields) ? existing.manualOverrideFields : [];
  const lastEditedBy = normalizeString(existing.lastEditedBy);
  const updatedBy = normalizeString(existing.updatedBy);

  if (source !== "spreadsheet_import" && !["spreadsheet_export", "google_sheet_export"].includes(sourceType)) {
    return false;
  }

  if (planningStatus !== "planned") {
    return false;
  }

  if (actualStatus && actualStatus !== "unknown") {
    return false;
  }

  if (existing.changedAfterPlan === true || existing.manualOverride === true || manualOverrideFields.length > 0) {
    return false;
  }

  if (lastEditedBy && !["spreadsheet_import", "music_planning_import", "system"].includes(lastEditedBy)) {
    return false;
  }

  if (updatedBy && !["spreadsheet_import", "music_planning_import", "system"].includes(updatedBy)) {
    return false;
  }

  if (kind === "serviceSongEvent" && (normalizeString(existing.songId) || normalizeString(existing.matchedSongId))) {
    return false;
  }

  return true;
}

function classifyCommitTarget({ existing = null, target }) {
  if (!existing) {
    if (target.planAction === "update") {
      return {
        action: "conflictExisting",
        target,
        existing,
        reason: "update_target_missing"
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
    serviceSongEventsCreated: 0,
    serviceSongEventsUpdated: 0,
    serviceSongEventsSkippedExisting: 0,
    conflicts: 0
  };

  for (const item of classifications) {
    if (item.action === "conflictExisting") {
      summary.conflicts += 1;
      continue;
    }

    if (item.target.kind === "sourceImport") {
      if (item.action === "create") {
        summary.sourceImportCreated += 1;
      } else {
        summary.sourceImportSkippedExisting += 1;
      }
      continue;
    }

    if (item.target.kind === "service") {
      if (item.action === "create") {
        summary.servicesCreated += 1;
      } else if (item.action === "update") {
        summary.servicesUpdated += 1;
      } else {
        summary.servicesSkippedExisting += 1;
      }
      continue;
    }

    if (item.target.kind === "serviceSongEvent") {
      if (item.action === "create") {
        summary.serviceSongEventsCreated += 1;
      } else if (item.action === "update") {
        summary.serviceSongEventsUpdated += 1;
      } else {
        summary.serviceSongEventsSkippedExisting += 1;
      }
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
  validateMusicPlanningCommitPlan,
  validateCreateOnlyCommitPlan
};
