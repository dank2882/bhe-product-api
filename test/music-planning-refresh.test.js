const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRefreshArtifactPaths,
  buildRefreshSummary,
  getPlanActionSummary,
  parseRefreshArgs,
  validateRefreshCommitPlan
} = require("../lib/music-planning-refresh");

const SOURCE_IMPORT_ID = "srcimp-google-sheet-export-music-ministry-master-data-proposed-schedules-abc123-spreadsheet-planning-v1";

function buildPlan(overrides = {}) {
  return {
    sourceImportPlan: {
      action: "preserve",
      id: SOURCE_IMPORT_ID,
      proposed: {
        sourceImportId: SOURCE_IMPORT_ID,
        sourceWorkbookHash: "abc123",
        sourceSheetName: "PROPOSED SCHEDULES"
      }
    },
    services: {
      create: [],
      update: [],
      preserve: [],
      conflict: [],
      missingFromSource: []
    },
    serviceSongEvents: {
      create: [],
      update: [],
      preserve: [],
      conflict: [],
      missingFromSource: []
    },
    warnings: [],
    conflicts: [],
    eligibleForCommit: true,
    ...overrides
  };
}

test("parseRefreshArgs defaults to plan-only live Sheet refresh", () => {
  const options = parseRefreshArgs([]);

  assert.equal(options.mode, "plan-only");
  assert.equal(options.sheet, "PROPOSED SCHEDULES");
  assert.equal(options.googleSheetId, "1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss");
});

test("parseRefreshArgs accepts commit mode and confirmation flags", () => {
  const options = parseRefreshArgs([
    "--commit",
    "--allow-planned-updates",
    "--allow-partial-conflicts",
    "--confirm-source-import-id",
    SOURCE_IMPORT_ID,
    "--out-dir",
    "tmp/example"
  ]);

  assert.equal(options.mode, "commit");
  assert.equal(options.allowPlannedUpdates, true);
  assert.equal(options.allowPartialConflicts, true);
  assert.equal(options.confirmSourceImportId, SOURCE_IMPORT_ID);
  assert.equal(options.outDir, "tmp/example");
});

test("parseRefreshArgs rejects multiple modes", () => {
  assert.throws(
    () => parseRefreshArgs(["--preview-only", "--commit"]),
    /Use only one/
  );
});

test("buildRefreshArtifactPaths writes all artifacts under the output directory", () => {
  const paths = buildRefreshArtifactPaths("tmp/refresh-test");

  assert.match(paths.preview, /tmp\/refresh-test\/music-planning-google-sheet-preview-latest\.json$/);
  assert.match(paths.writePlan, /tmp\/refresh-test\/music-planning-firestore-write-plan-latest\.json$/);
  assert.match(paths.commitResult, /tmp\/refresh-test\/music-planning-firestore-commit-result-latest\.json$/);
  assert.match(paths.summary, /tmp\/refresh-test\/music-planning-refresh-summary-latest\.json$/);
});

test("getPlanActionSummary reports create, update, warning, and conflict counts", () => {
  const plan = buildPlan({
    services: {
      create: [{ id: "svc-one" }],
      update: [{ id: "svc-two" }],
      preserve: [],
      conflict: [],
      missingFromSource: [{ id: "svc-old" }]
    },
    serviceSongEvents: {
      create: [{ id: "sse-one" }],
      update: [],
      preserve: [{ id: "sse-two" }],
      conflict: [],
      missingFromSource: []
    },
    summary: {
      warnings: {
        total: 1,
        bySeverity: { review: 1 }
      },
      conflicts: {
        total: 0
      }
    }
  });
  const summary = getPlanActionSummary(plan);

  assert.equal(summary.services.create, 1);
  assert.equal(summary.services.update, 1);
  assert.equal(summary.services.missingFromSource, 1);
  assert.equal(summary.serviceSongEvents.create, 1);
  assert.equal(summary.serviceSongEvents.preserve, 1);
  assert.equal(summary.warnings.bySeverity.review, 1);
});

test("validateRefreshCommitPlan refuses commit without exact source import confirmation", () => {
  const result = validateRefreshCommitPlan(buildPlan(), {
    commit: true,
    confirmSourceImportId: "wrong-id",
    allowPlannedUpdates: true
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("does not match")));
});

test("validateRefreshCommitPlan requires planned update opt-in", () => {
  const plan = buildPlan();
  plan.services.update.push({ id: "svc-one", proposed: {} });

  const result = validateRefreshCommitPlan(plan, {
    commit: true,
    confirmSourceImportId: SOURCE_IMPORT_ID,
    allowPlannedUpdates: false
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("--allow-planned-updates")));
});

test("validateRefreshCommitPlan accepts eligible planned update when explicitly allowed", () => {
  const plan = buildPlan();
  plan.services.update.push({ id: "svc-one", proposed: {} });

  const result = validateRefreshCommitPlan(plan, {
    commit: true,
    confirmSourceImportId: SOURCE_IMPORT_ID,
    allowPlannedUpdates: true
  });

  assert.equal(result.ok, true);
});

test("buildRefreshSummary captures preview, plan, commit, and verification status", () => {
  const summary = buildRefreshSummary({
    options: {
      mode: "commit",
      googleSheetId: "sheet-id",
      sheet: "PROPOSED SCHEDULES",
      year: 2026,
      projectId: "project",
      databaseId: "database"
    },
    artifacts: {
      preview: "tmp/preview.json"
    },
    preview: {
      sourceImportPreview: {
        sourceType: "google_sheet_export",
        sourceName: "Music Ministry - Master Data",
        sourceSheetName: "PROPOSED SCHEDULES",
        sourceSpreadsheetId: "sheet-id",
        importableServicesDetected: 2,
        songMusicSlotsDetected: 3
      },
      warnings: []
    },
    plan: buildPlan(),
    commitResult: {
      sourceImportId: SOURCE_IMPORT_ID,
      summary: { servicesUpdated: 1 },
      safety: { deletesPerformed: 0 }
    },
    postCommitVerification: {
      ok: true
    }
  });

  assert.equal(summary.mode, "commit");
  assert.equal(summary.preview.importableServicesDetected, 2);
  assert.equal(summary.commit.performed, true);
  assert.equal(summary.postCommitVerification.ok, true);
});
