const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFirestoreWritePlan,
  buildServiceId,
  buildServiceSongEventId,
  buildSourceImportId
} = require("../lib/music-planning-firestore-write-plan");

const NOW = "2026-04-25T12:00:00.000Z";

function buildPreview(overrides = {}) {
  const service = {
    previewServiceId: "preview-svc-2026-01-11-sunday-morning-r4",
    serviceDate: "2026-01-11",
    serviceType: "sunday_morning",
    title: "Morning Service",
    theme: "",
    serviceLabels: ["AM"],
    planningStatus: "planned",
    sourceType: "spreadsheet_export",
    sourceName: "Music Ministry - Master Data",
    sourceSheetName: "PROPOSED SCHEDULES",
    sourceRowNumber: 4,
    sourceCell: "B4",
    rawDateService: "Jan 11th AM",
    planningSignals: ["planned_music_slot"],
    warningCodes: []
  };
  const event = {
    previewServiceSongEventId: "preview-svc-2026-01-11-sunday-morning-r4-congregational-1-r4",
    previewServiceId: service.previewServiceId,
    serviceDate: "2026-01-11",
    serviceType: "sunday_morning",
    slotIndex: 10,
    plannedSequence: 10,
    usageRole: "congregational",
    sourceColumnName: "Congregational #1",
    sourceColumnKey: "congregational_1",
    sourceRowNumber: 4,
    sourceCell: "C4",
    rawValue: "Jesus Saves",
    songTitleCandidate: "Jesus Saves",
    songTitleConfidence: "high",
    hymnalNumber: null,
    assignedPersonOrGroupRaw: "",
    detailNote: "",
    songId: null,
    planningStatus: "planned",
    actualStatus: "unknown",
    changedAfterPlan: false,
    sourceType: "spreadsheet_export",
    sourceName: "Music Ministry - Master Data",
    sourceSheetName: "PROPOSED SCHEDULES",
    warningCodes: []
  };
  const preview = {
    sourceImportPreview: {
      sourceType: "spreadsheet_export",
      sourceName: "Music Ministry - Master Data",
      sourceFileHash: "abc123def4567890",
      sourceSheetName: "PROPOSED SCHEDULES",
      importMode: "preview",
      planningStatusDefault: "planned",
      actualStatusDefault: "unknown",
      planningYear: 2026,
      serviceRowsDetected: 1,
      importableServicesDetected: 1,
      skippedServiceShellsDetected: 0,
      songMusicSlotsDetected: 1
    },
    importableServices: [service],
    skippedServiceShells: [],
    serviceSongEvents: [event],
    warnings: [],
    summary: {}
  };

  return {
    ...preview,
    ...overrides
  };
}

function buildExistingService(overrides = {}) {
  return {
    serviceId: "svc-plan-2026-01-11-sunday-morning",
    serviceDate: "2026-01-11",
    serviceType: "sunday_morning",
    title: "Morning Service",
    theme: "",
    serviceLabels: ["AM"],
    planningStatus: "planned",
    actualStatus: "unknown",
    changedAfterPlan: false,
    source: "spreadsheet_import",
    sourceType: "spreadsheet_export",
    ...overrides
  };
}

function buildExistingEvent(overrides = {}) {
  return {
    serviceSongEventId: "sse-plan-svc-plan-2026-01-11-sunday-morning-10-congregational-1",
    serviceId: "svc-plan-2026-01-11-sunday-morning",
    serviceDate: "2026-01-11",
    serviceType: "sunday_morning",
    slotIndex: 10,
    sourceColumnKey: "congregational_1",
    title: "Jesus Saves",
    songTitleCandidate: "Jesus Saves",
    planningStatus: "planned",
    actualStatus: "unknown",
    changedAfterPlan: false,
    source: "spreadsheet_import",
    sourceType: "spreadsheet_export",
    ...overrides
  };
}

function plan(preview = buildPreview(), existingState = {}) {
  return buildFirestoreWritePlan(preview, {
    services: [],
    serviceSongEvents: [],
    sourceImports: [],
    ...existingState
  }, {
    now: NOW
  });
}

test("buildServiceId and buildServiceSongEventId use deterministic Slice 11 IDs", () => {
  const preview = buildPreview();
  const service = preview.importableServices[0];
  const event = preview.serviceSongEvents[0];
  const serviceId = buildServiceId(service);

  assert.equal(serviceId, "svc-plan-2026-01-11-sunday-morning");
  assert.equal(
    buildServiceSongEventId(event, serviceId),
    "sse-plan-svc-plan-2026-01-11-sunday-morning-10-congregational-1"
  );
  assert.equal(
    buildSourceImportId(preview.sourceImportPreview),
    "srcimp-spreadsheet-export-music-ministry-master-data-proposed-schedules-abc123def456-spreadsheet-planning-v1"
  );
});

test("proposed service missing plans a create", () => {
  const result = plan();

  assert.equal(result.services.create.length, 1);
  assert.equal(result.services.create[0].id, "svc-plan-2026-01-11-sunday-morning");
  assert.equal(result.services.create[0].proposed.planningStatus, "planned");
});

test("proposed service carries optional message fields", () => {
  const preview = buildPreview();
  preview.importableServices[0] = {
    ...preview.importableServices[0],
    message: {
      speakerName: "Pastor Smith",
      scriptureText: "John 3:16-21",
      sermonTitle: "For God So Loved",
      topic: "Salvation",
      notesUrl: "https://docs.google.com/document/d/example",
      sourceCells: {
        speakerName: "J4",
        scriptureText: "K4"
      }
    },
    planningSignals: ["planned_music_slot", "message"]
  };
  const result = plan(preview);

  assert.deepEqual(result.services.create[0].proposed.message, {
    speakerName: "Pastor Smith",
    scriptureText: "John 3:16-21",
    sermonTitle: "For God So Loved",
    topic: "Salvation",
    notesUrl: "https://docs.google.com/document/d/example",
    sourceCells: {
      speakerName: "J4",
      scriptureText: "K4"
    }
  });
  assert.ok(result.services.create[0].proposed.planningSignals.includes("message"));
});

test("proposed service exists and remains planned plans an update", () => {
  const result = plan(buildPreview(), {
    services: [buildExistingService({ theme: "Old Theme" })]
  });

  assert.equal(result.services.update.length, 1);
  assert.equal(result.services.update[0].id, "svc-plan-2026-01-11-sunday-morning");
  assert.ok(result.services.update[0].changedFields.includes("theme"));
});

test("completed service is a blocking conflict", () => {
  const result = plan(buildPreview(), {
    services: [buildExistingService({ actualStatus: "completed" })]
  });

  assert.equal(result.services.conflict.length, 1);
  assert.equal(result.services.conflict[0].reason, "existing_completed_confirmed_or_changed_after_plan");
  assert.equal(result.eligibleForCommit, false);
});

test("manual override is preserved rather than updated", () => {
  const result = plan(buildPreview(), {
    services: [buildExistingService({ manualOverride: true, manualOverrideFields: ["theme"] })]
  });

  assert.equal(result.services.preserve.length, 1);
  assert.equal(result.services.preserve[0].reason, "manual_override_present");
  assert.deepEqual(result.services.preserve[0].preservedFields, ["theme"]);
});

test("proposed song event missing plans a create", () => {
  const result = plan();

  assert.equal(result.serviceSongEvents.create.length, 1);
  assert.equal(
    result.serviceSongEvents.create[0].id,
    "sse-plan-svc-plan-2026-01-11-sunday-morning-10-congregational-1"
  );
});

test("proposed song event exists and remains planned plans an update", () => {
  const result = plan(buildPreview(), {
    serviceSongEvents: [buildExistingEvent({ rawValue: "Old Value" })]
  });

  assert.equal(result.serviceSongEvents.update.length, 1);
  assert.ok(result.serviceSongEvents.update[0].changedFields.includes("rawValue"));
});

test("existing spreadsheet-imported record missing from latest preview is reported only", () => {
  const result = plan(buildPreview({ importableServices: [], serviceSongEvents: [] }), {
    services: [buildExistingService()],
    serviceSongEvents: [buildExistingEvent()]
  });

  assert.equal(result.services.missingFromSource.length, 1);
  assert.equal(result.serviceSongEvents.missingFromSource.length, 1);
  assert.equal(result.eligibleForCommit, true);
});

test("preview error warning makes plan ineligible for commit", () => {
  const result = plan(buildPreview({
    warnings: [
      {
        code: "service_date_parse_warning",
        severity: "error",
        message: "Unable to parse service date.",
        sourceCell: "B4"
      }
    ]
  }));

  assert.equal(result.eligibleForCommit, false);
  assert.ok(result.conflicts.some((conflict) => conflict.reason === "preview_error_warning"));
});

test("duplicate deterministic proposed service IDs are blocking conflicts", () => {
  const preview = buildPreview();
  const duplicate = {
    ...preview.importableServices[0],
    previewServiceId: "preview-duplicate",
    sourceRowNumber: 5,
    sourceCell: "B5"
  };
  const result = plan({
    ...preview,
    importableServices: [preview.importableServices[0], duplicate]
  });

  assert.equal(result.services.conflict.length, 1);
  assert.equal(result.services.conflict[0].reason, "duplicate_proposed_deterministic_id");
  assert.equal(result.eligibleForCommit, false);
});
