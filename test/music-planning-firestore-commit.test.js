const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyCommitTarget,
  createCommitTargetsFromPlan,
  isSafePlannedExistingDocument,
  summarizeCommitClassifications,
  validateCreateOnlyCommitPlan,
  validateMusicPlanningCommitPlan
} = require("../lib/music-planning-firestore-commit");

const SOURCE_IMPORT_ID = "srcimp-spreadsheet-export-music-ministry-master-data-proposed-schedules-abc123-spreadsheet-planning-v1";

function buildPlan(overrides = {}) {
  const service = {
    action: "create",
    id: "svc-plan-2026-01-11-sunday-morning",
    proposed: {
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "spreadsheet_import",
      sourceType: "spreadsheet_export",
      sourceImportId: SOURCE_IMPORT_ID,
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    }
  };
  const event = {
    action: "create",
    id: "sse-plan-svc-plan-2026-01-11-sunday-morning-10-congregational-1",
    proposed: {
      serviceSongEventId: "sse-plan-svc-plan-2026-01-11-sunday-morning-10-congregational-1",
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "spreadsheet_import",
      sourceType: "spreadsheet_export",
      sourceImportId: SOURCE_IMPORT_ID,
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    }
  };
  const plan = {
    sourceImportPlan: {
      action: "create",
      id: SOURCE_IMPORT_ID,
      proposed: {
        sourceImportId: SOURCE_IMPORT_ID,
        sourceWorkbookHash: "abc123",
        sourceSheetName: "PROPOSED SCHEDULES"
      }
    },
    services: {
      create: [service],
      update: [],
      preserve: [],
      conflict: [],
      missingFromSource: []
    },
    serviceSongEvents: {
      create: [event],
      update: [],
      preserve: [],
      conflict: [],
      missingFromSource: []
    },
    warnings: [],
    conflicts: [],
    eligibleForCommit: true
  };

  return {
    ...plan,
    ...overrides
  };
}

function validate(plan = buildPlan(), options = {}) {
  return validateCreateOnlyCommitPlan(plan, {
    commit: true,
    confirmSourceImportId: SOURCE_IMPORT_ID,
    ...options
  });
}

test("validateCreateOnlyCommitPlan refuses without --commit", () => {
  const result = validate(buildPlan(), { commit: false });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("--commit")));
});

test("validateCreateOnlyCommitPlan refuses mismatched source import confirmation", () => {
  const result = validate(buildPlan(), { confirmSourceImportId: "wrong-id" });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("does not match")));
});

test("validateCreateOnlyCommitPlan refuses ineligible plan", () => {
  const result = validate(buildPlan({ eligibleForCommit: false }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("not eligible")));
});

test("validateCreateOnlyCommitPlan refuses plan conflicts", () => {
  const result = validate(buildPlan({
    conflicts: [{ reason: "duplicate_proposed_deterministic_id" }]
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("blocking conflicts")));
});

test("validateCreateOnlyCommitPlan refuses update actions", () => {
  const plan = buildPlan();
  plan.services.update.push({
    action: "update",
    id: "svc-plan-2026-01-11-sunday-morning"
  });
  const result = validate(plan);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("--allow-planned-updates")));
});

test("validateMusicPlanningCommitPlan accepts planned updates when explicitly allowed", () => {
  const plan = buildPlan();
  plan.services.update.push({
    action: "update",
    id: "svc-plan-2026-01-11-sunday-morning",
    proposed: {
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "spreadsheet_import",
      sourceType: "google_sheet_export",
      sourceImportId: SOURCE_IMPORT_ID,
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    }
  });

  const result = validateMusicPlanningCommitPlan(plan, {
    commit: true,
    confirmSourceImportId: SOURCE_IMPORT_ID,
    allowPlannedUpdates: true
  });

  assert.equal(result.ok, true);
});

test("validateMusicPlanningCommitPlan accepts safe partial conflict commits when explicitly allowed", () => {
  const plan = buildPlan({
    services: {
      create: buildPlan().services.create,
      update: [],
      preserve: [],
      conflict: [
        {
          action: "conflict",
          id: "svc-plan-2026-05-03-sunday-morning",
          reason: "existing_record_not_spreadsheet_owned_planned"
        }
      ],
      missingFromSource: []
    },
    conflicts: [
      {
        action: "conflict",
        id: "svc-plan-2026-05-03-sunday-morning",
        reason: "existing_record_not_spreadsheet_owned_planned"
      }
    ],
    eligibleForCommit: false
  });

  const result = validateMusicPlanningCommitPlan(plan, {
    commit: true,
    confirmSourceImportId: SOURCE_IMPORT_ID,
    allowPlannedUpdates: true,
    allowPartialConflicts: true
  });

  assert.equal(result.ok, true);
});

test("validateMusicPlanningCommitPlan rejects unsafe partial conflict commits", () => {
  const plan = buildPlan({
    services: {
      create: buildPlan().services.create,
      update: [],
      preserve: [],
      conflict: [
        {
          action: "conflict",
          id: "svc-plan-2026-01-11-sunday-morning",
          reason: "duplicate_proposed_deterministic_id"
        }
      ],
      missingFromSource: []
    },
    conflicts: [
      {
        action: "conflict",
        id: "svc-plan-2026-01-11-sunday-morning",
        reason: "duplicate_proposed_deterministic_id"
      }
    ],
    eligibleForCommit: false
  });

  const result = validateMusicPlanningCommitPlan(plan, {
    commit: true,
    confirmSourceImportId: SOURCE_IMPORT_ID,
    allowPlannedUpdates: true,
    allowPartialConflicts: true
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("not safe for partial commit")));
});

test("validateCreateOnlyCommitPlan accepts create-only plan", () => {
  const result = validate();

  assert.equal(result.ok, true);
  assert.equal(result.sourceImportId, SOURCE_IMPORT_ID);
});

test("createCommitTargetsFromPlan returns source import, services, and events", () => {
  const targets = createCommitTargetsFromPlan(buildPlan());

  assert.equal(targets.length, 3);
  assert.deepEqual(targets.map((target) => target.collectionName), [
    "sourceImports",
    "services",
    "serviceSongEvents"
  ]);
});

test("classifyCommitTarget skips expected existing document without overwrite", () => {
  const target = createCommitTargetsFromPlan(buildPlan())[1];
  const result = classifyCommitTarget({
    existing: {
      serviceId: target.proposed.serviceId,
      source: "spreadsheet_import",
      sourceType: "spreadsheet_export",
      sourceImportId: SOURCE_IMPORT_ID
    },
    target
  });

  assert.equal(result.action, "skipExisting");
});

test("classifyCommitTarget allows safe planned update across spreadsheet source snapshots", () => {
  const plan = buildPlan();
  const target = {
    collectionName: "services",
    id: "svc-plan-2026-01-11-sunday-morning",
    proposed: {
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "spreadsheet_import",
      sourceType: "google_sheet_export",
      sourceImportId: "new-source-import",
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    },
    planAction: "update",
    kind: "service"
  };
  const result = classifyCommitTarget({
    existing: {
      serviceId: target.proposed.serviceId,
      source: "spreadsheet_import",
      sourceType: "spreadsheet_export",
      sourceImportId: plan.sourceImportPlan.id,
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    },
    target
  });

  assert.equal(result.action, "update");
});

test("isSafePlannedExistingDocument blocks curated song event matches", () => {
  assert.equal(isSafePlannedExistingDocument({
    source: "spreadsheet_import",
    sourceType: "spreadsheet_export",
    planningStatus: "planned",
    actualStatus: "unknown",
    changedAfterPlan: false,
    songId: "rejoice-0405"
  }, "serviceSongEvent"), false);
});

test("classifyCommitTarget conflicts on unexpected existing document", () => {
  const target = createCommitTargetsFromPlan(buildPlan())[1];
  const result = classifyCommitTarget({
    existing: {
      serviceId: target.proposed.serviceId,
      source: "manual",
      sourceType: "manual",
      sourceImportId: "manual-import"
    },
    target
  });

  assert.equal(result.action, "conflictExisting");
});

test("summarizeCommitClassifications reports creates and skipped existing", () => {
  const targets = createCommitTargetsFromPlan(buildPlan());
  const summary = summarizeCommitClassifications([
    classifyCommitTarget({ existing: null, target: targets[0] }),
    classifyCommitTarget({ existing: null, target: targets[1] }),
    classifyCommitTarget({
      existing: {
        serviceSongEventId: targets[2].proposed.serviceSongEventId,
        serviceId: targets[2].proposed.serviceId,
        source: "spreadsheet_import",
        sourceType: "spreadsheet_export",
        sourceImportId: SOURCE_IMPORT_ID
      },
      target: targets[2]
    })
  ]);

  assert.equal(summary.sourceImportCreated, 1);
  assert.equal(summary.servicesCreated, 1);
  assert.equal(summary.servicesUpdated, 0);
  assert.equal(summary.serviceSongEventsSkippedExisting, 1);
  assert.equal(summary.conflicts, 0);
});
