const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyCommitTarget,
  createCommitTargetsFromPlan,
  summarizeCommitClassifications,
  validateCreateOnlyCommitPlan,
  validateServiceOrderCommitPlan
} = require("../lib/service-order-firestore-commit");

const SOURCE_IMPORT_ID = "srcimp-order-of-service-pdf-2026-ytd-service-order-pdfs-2026-01-01-2026-05-08-abc123-service-order-pdf-v1";

function buildPlan(overrides = {}) {
  const service = {
    action: "create",
    id: "svc-plan-2026-01-11-sunday-morning",
    proposed: {
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "service_order_pdf_import",
      sourceType: "order_of_service_pdf",
      sourceImportId: SOURCE_IMPORT_ID,
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    }
  };
  const item = {
    action: "create",
    id: "soi-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves",
    proposed: {
      serviceOrderItemId: "soi-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves",
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "service_order_pdf_import",
      sourceType: "order_of_service_pdf",
      sourceImportId: SOURCE_IMPORT_ID,
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    }
  };
  const event = {
    action: "create",
    id: "sse-order-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves",
    proposed: {
      serviceSongEventId: "sse-order-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves",
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "service_order_pdf_import",
      sourceType: "order_of_service_pdf",
      sourceImportId: SOURCE_IMPORT_ID,
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    }
  };
  const moment = {
    action: "create",
    id: "sm-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves-01",
    proposed: {
      serviceMomentId: "sm-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves-01",
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "service_order_pdf_import",
      sourceType: "order_of_service_pdf",
      sourceImportId: SOURCE_IMPORT_ID
    }
  };

  return {
    sourceImportPlan: {
      action: "create",
      id: SOURCE_IMPORT_ID,
      proposed: {
        sourceImportId: SOURCE_IMPORT_ID,
        sourceType: "order_of_service_pdf",
        sourceVersion: "abc123"
      }
    },
    services: {
      create: [service],
      update: [],
      preserve: [],
      conflict: [],
      missingFromSource: []
    },
    serviceOrderItems: {
      create: [item],
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
    serviceMoments: {
      create: [moment],
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

test("validateServiceOrderCommitPlan requires explicit supersede flag", () => {
  const plan = buildPlan();
  plan.serviceSongEvents.update.push({
    action: "update",
    id: "sse-plan-old",
    reason: "supersede_spreadsheet_event_for_service_order_pdf",
    proposed: {
      serviceSongEventId: "sse-plan-old",
      historyVisibility: "superseded",
      supersededBySourceImportId: SOURCE_IMPORT_ID,
      supersededBySourceType: "order_of_service_pdf",
      supersededAt: "2026-05-08T18:30:00.000Z",
      supersededReason: "Replaced in service history by order-of-service PDF import.",
      changedAfterPlan: false
    }
  });

  const result = validateServiceOrderCommitPlan(plan, {
    commit: true,
    confirmSourceImportId: SOURCE_IMPORT_ID,
    allowPlannedUpdates: true
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("supersedes spreadsheet song events")));
});

test("validateServiceOrderCommitPlan accepts planned updates and supersede flag", () => {
  const plan = buildPlan();
  plan.services.update.push({
    action: "update",
    id: "svc-plan-2026-01-11-sunday-morning",
    proposed: {
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      source: "service_order_pdf_import",
      sourceType: "order_of_service_pdf",
      sourceImportId: SOURCE_IMPORT_ID,
      planningStatus: "planned",
      actualStatus: "unknown",
      changedAfterPlan: false
    }
  });

  const result = validateServiceOrderCommitPlan(plan, {
    commit: true,
    confirmSourceImportId: SOURCE_IMPORT_ID,
    allowPlannedUpdates: true,
    allowSupersedeSpreadsheetEvents: true
  });

  assert.equal(result.ok, true);
});

test("createCommitTargetsFromPlan returns all service-order target collections", () => {
  const targets = createCommitTargetsFromPlan(buildPlan());

  assert.deepEqual(targets.map((target) => target.collectionName), [
    "sourceImports",
    "services",
    "serviceOrderItems",
    "serviceSongEvents",
    "serviceMoments"
  ]);
});

test("classifyCommitTarget allows superseding safe spreadsheet event", () => {
  const plan = buildPlan();
  const target = {
    collectionName: "serviceSongEvents",
    id: "sse-plan-old",
    kind: "serviceSongEvent",
    planAction: "update",
    reason: "supersede_spreadsheet_event_for_service_order_pdf",
    proposed: {
      serviceSongEventId: "sse-plan-old",
      serviceId: "svc-plan-2026-01-11-sunday-morning",
      historyVisibility: "superseded",
      supersededBySourceImportId: SOURCE_IMPORT_ID,
      supersededBySourceType: "order_of_service_pdf",
      supersededAt: "2026-05-08T18:30:00.000Z",
      supersededReason: "Replaced in service history by order-of-service PDF import.",
      changedAfterPlan: false
    }
  };
  const result = classifyCommitTarget({
    existing: {
      serviceSongEventId: target.id,
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

test("summarizeCommitClassifications reports service-order creates and supersedes", () => {
  const targets = createCommitTargetsFromPlan(buildPlan());
  const supersedeTarget = {
    collectionName: "serviceSongEvents",
    id: "sse-plan-old",
    kind: "serviceSongEvent",
    planAction: "update",
    reason: "supersede_spreadsheet_event_for_service_order_pdf",
    proposed: {
      historyVisibility: "superseded",
      supersededBySourceImportId: SOURCE_IMPORT_ID,
      supersededBySourceType: "order_of_service_pdf",
      supersededAt: "2026-05-08T18:30:00.000Z",
      supersededReason: "Replaced in service history by order-of-service PDF import.",
      changedAfterPlan: false
    }
  };
  const summary = summarizeCommitClassifications([
    classifyCommitTarget({ existing: null, target: targets[0] }),
    classifyCommitTarget({ existing: null, target: targets[1] }),
    classifyCommitTarget({ existing: null, target: targets[2] }),
    classifyCommitTarget({ existing: null, target: targets[3] }),
    classifyCommitTarget({ existing: null, target: targets[4] }),
    classifyCommitTarget({
      existing: {
        source: "spreadsheet_import",
        sourceType: "spreadsheet_export",
        planningStatus: "planned",
        actualStatus: "unknown",
        changedAfterPlan: false
      },
      target: supersedeTarget
    })
  ]);

  assert.equal(summary.sourceImportCreated, 1);
  assert.equal(summary.servicesCreated, 1);
  assert.equal(summary.serviceOrderItemsCreated, 1);
  assert.equal(summary.serviceSongEventsCreated, 1);
  assert.equal(summary.serviceMomentsCreated, 1);
  assert.equal(summary.spreadsheetSongEventsSuperseded, 1);
});
