"use strict";

const path = require("node:path");

const commitTools = require("./music-planning-firestore-commit");

const DEFAULT_LIVE_GOOGLE_SHEET_ID = "1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss";
const DEFAULT_SOURCE_SHEET_NAME = "PROPOSED SCHEDULES";
const DEFAULT_PLANNING_YEAR = 2026;
const DEFAULT_OUT_DIR = "tmp";
const DEFAULT_PROJECT_ID = "location-map-985";
const DEFAULT_DATABASE_ID = "chatgptstorage";

function parseBooleanMode(options) {
  const selected = [
    options.previewOnly ? "preview-only" : "",
    options.planOnly ? "plan-only" : "",
    options.commit ? "commit" : ""
  ].filter(Boolean);

  if (selected.length > 1) {
    throw new Error("Use only one of --preview-only, --plan-only, or --commit.");
  }

  return selected[0] || "plan-only";
}

function parseRefreshArgs(argv = [], defaults = {}) {
  const options = {
    googleSheetId: defaults.googleSheetId || DEFAULT_LIVE_GOOGLE_SHEET_ID,
    sheet: defaults.sheet || DEFAULT_SOURCE_SHEET_NAME,
    year: defaults.year || DEFAULT_PLANNING_YEAR,
    outDir: defaults.outDir || DEFAULT_OUT_DIR,
    projectId: defaults.projectId || process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_PROJECT_ID,
    databaseId: defaults.databaseId || process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID,
    previewOnly: false,
    planOnly: false,
    commit: false,
    allowPlannedUpdates: false,
    allowPartialConflicts: false,
    confirmSourceImportId: "",
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--google-sheet-id" && next) {
      options.googleSheetId = next;
      index += 1;
      continue;
    }

    if (arg === "--sheet" && next) {
      options.sheet = next;
      index += 1;
      continue;
    }

    if (arg === "--year" && next) {
      options.year = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === "--out-dir" && next) {
      options.outDir = next;
      index += 1;
      continue;
    }

    if (arg === "--project" && next) {
      options.projectId = next;
      index += 1;
      continue;
    }

    if (arg === "--database" && next) {
      options.databaseId = next;
      index += 1;
      continue;
    }

    if (arg === "--confirm-source-import-id" && next) {
      options.confirmSourceImportId = next;
      index += 1;
      continue;
    }

    if (arg === "--preview-only") {
      options.previewOnly = true;
      continue;
    }

    if (arg === "--plan-only") {
      options.planOnly = true;
      continue;
    }

    if (arg === "--commit") {
      options.commit = true;
      continue;
    }

    if (arg === "--allow-planned-updates") {
      options.allowPlannedUpdates = true;
      continue;
    }

    if (arg === "--allow-partial-conflicts") {
      options.allowPartialConflicts = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!options.googleSheetId || typeof options.googleSheetId !== "string") {
    throw new Error("--google-sheet-id is required.");
  }

  if (!Number.isInteger(options.year) || options.year < 2000 || options.year > 2100) {
    throw new Error("--year must be a four-digit planning year.");
  }

  options.mode = parseBooleanMode(options);
  return options;
}

function buildRefreshArtifactPaths(outDir = DEFAULT_OUT_DIR) {
  const root = path.resolve(outDir);

  return {
    outDir: root,
    preview: path.join(root, "music-planning-google-sheet-preview-latest.json"),
    writePlan: path.join(root, "music-planning-firestore-write-plan-latest.json"),
    commitResult: path.join(root, "music-planning-firestore-commit-result-latest.json"),
    summary: path.join(root, "music-planning-refresh-summary-latest.json")
  };
}

function countAction(group = {}, action) {
  return Array.isArray(group[action]) ? group[action].length : 0;
}

function getWarningSummary(warnings = []) {
  const bySeverity = {};

  for (const warning of warnings) {
    const severity = warning && warning.severity ? warning.severity : "unknown";
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }

  return {
    total: warnings.length,
    bySeverity
  };
}

function getPlanActionSummary(plan = {}) {
  return {
    sourceImportAction: plan.sourceImportPlan ? plan.sourceImportPlan.action : "",
    services: {
      create: countAction(plan.services, "create"),
      update: countAction(plan.services, "update"),
      preserve: countAction(plan.services, "preserve"),
      conflict: countAction(plan.services, "conflict"),
      missingFromSource: countAction(plan.services, "missingFromSource")
    },
    serviceSongEvents: {
      create: countAction(plan.serviceSongEvents, "create"),
      update: countAction(plan.serviceSongEvents, "update"),
      preserve: countAction(plan.serviceSongEvents, "preserve"),
      conflict: countAction(plan.serviceSongEvents, "conflict"),
      missingFromSource: countAction(plan.serviceSongEvents, "missingFromSource")
    },
    warnings: plan.summary && plan.summary.warnings
      ? plan.summary.warnings
      : getWarningSummary(plan.warnings || []),
    conflicts: plan.summary && plan.summary.conflicts
      ? plan.summary.conflicts.total
      : Array.isArray(plan.conflicts) ? plan.conflicts.length : 0,
    eligibleForCommit: plan.eligibleForCommit === true
  };
}

function getPreviewSummary(preview = {}) {
  const source = preview.sourceImportPreview || {};

  return {
    sourceType: source.sourceType || "",
    sourceName: source.sourceName || "",
    sourceSheetName: source.sourceSheetName || "",
    sourceSpreadsheetId: source.sourceSpreadsheetId || "",
    rowCountInspected: source.rowCountInspected || 0,
    importableServicesDetected: source.importableServicesDetected || 0,
    skippedServiceShellsDetected: source.skippedServiceShellsDetected || 0,
    songMusicSlotsDetected: source.songMusicSlotsDetected || 0,
    warnings: getWarningSummary(preview.warnings || [])
  };
}

function validateRefreshCommitPlan(plan = {}, options = {}) {
  return commitTools.validateMusicPlanningCommitPlan(plan, {
    commit: options.commit === true,
    confirmSourceImportId: options.confirmSourceImportId,
    allowPlannedUpdates: options.allowPlannedUpdates === true,
    allowPartialConflicts: options.allowPartialConflicts === true
  });
}

function buildRefreshSummary({
  options = {},
  artifacts = {},
  preview = null,
  plan = null,
  commitResult = null,
  postCommitVerification = null
} = {}) {
  return {
    generatedAt: new Date().toISOString(),
    mode: options.mode || "plan-only",
    source: {
      googleSheetId: options.googleSheetId || "",
      sheet: options.sheet || "",
      planningYear: options.year || null
    },
    firestore: {
      projectId: options.projectId || "",
      databaseId: options.databaseId || ""
    },
    artifacts,
    preview: preview ? getPreviewSummary(preview) : null,
    plan: plan ? getPlanActionSummary(plan) : null,
    commit: commitResult ? {
      performed: true,
      sourceImportId: commitResult.sourceImportId,
      summary: commitResult.summary,
      safety: commitResult.safety
    } : {
      performed: false
    },
    postCommitVerification
  };
}

module.exports = {
  DEFAULT_DATABASE_ID,
  DEFAULT_LIVE_GOOGLE_SHEET_ID,
  DEFAULT_OUT_DIR,
  DEFAULT_PLANNING_YEAR,
  DEFAULT_PROJECT_ID,
  DEFAULT_SOURCE_SHEET_NAME,
  buildRefreshArtifactPaths,
  buildRefreshSummary,
  getPlanActionSummary,
  getPreviewSummary,
  getWarningSummary,
  parseRefreshArgs,
  validateRefreshCommitPlan
};
