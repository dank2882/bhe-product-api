const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPreviewBundle,
  buildServiceOrderFirestoreWritePlan,
  buildSourceImportId,
  isSpreadsheetEventSupersedeCandidate
} = require("../lib/service-order-firestore-write-plan");

const NOW = "2026-05-08T18:30:00.000Z";

function buildServicePreview(overrides = {}) {
  const service = {
    serviceId: "svc-plan-2026-01-11-sunday-morning",
    serviceDate: "2026-01-11",
    serviceType: "sunday_morning",
    title: "Morning Service",
    serviceLabels: ["AM"],
    startTime: "11:00 am",
    duration: "1h 6m"
  };
  const orderItem = {
    serviceOrderItemId: "soi-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves",
    serviceId: service.serviceId,
    serviceDate: service.serviceDate,
    serviceType: service.serviceType,
    sequence: 30,
    itemType: "song",
    sectionTitle: "Congregational Singing",
    title: "Jesus Saves",
    startTime: "11:02 am",
    usageRole: "congregational",
    songTitleCandidate: "Jesus Saves",
    hymnalNumber: 388,
    songId: null,
    key: "G",
    titleParenthetical: "",
    songEntries: [
      {
        songTitle: "Jesus Saves",
        hymnalNumber: 388,
        key: "G",
        notes: [],
        rawValue: "Jesus Saves (#388)"
      }
    ],
    assignedPeople: [{ role: "leader", name: "Pastor Lee" }],
    notes: [],
    detailLines: ["Jesus Saves (#388)", "Key: G"],
    sourcePageIndexes: [0],
    sourceText: ["Congregational Singing Led By 11:02 am", "Jesus Saves (#388)", "Key: G"],
    planningStatus: "planned",
    actualStatus: "unknown"
  };
  const songEvent = {
    serviceSongEventId: "sse-order-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves",
    serviceId: service.serviceId,
    serviceDate: service.serviceDate,
    serviceType: service.serviceType,
    slotIndex: 30,
    plannedSequence: 30,
    usageRole: "congregational",
    rawValue: "Jesus Saves (#388)",
    songTitleCandidate: "Jesus Saves",
    songTitleConfidence: "high",
    title: "Jesus Saves",
    songTitle: "Jesus Saves",
    hymnalNumber: 388,
    key: "G",
    assignedPersonOrGroupRaw: "Pastor Lee",
    detailNote: "",
    songId: null,
    linkedServiceOrderItemId: orderItem.serviceOrderItemId,
    planningStatus: "planned",
    actualStatus: "unknown",
    source: "order_of_service_pdf",
    sourceType: "order_of_service_pdf"
  };
  const moment = {
    serviceMomentId: "sm-svc-plan-2026-01-11-sunday-morning-0030-jesus-saves-01",
    serviceId: service.serviceId,
    serviceDate: service.serviceDate,
    sequence: 30,
    momentType: "verse_dynamic",
    title: "Choir dismisses after first verse",
    linkedOrderItemIds: [orderItem.serviceOrderItemId],
    linkedSongEventIds: [],
    primarySongTitleCandidate: "Jesus Saves",
    primarySongId: null,
    scriptureRefs: [],
    assignedPeople: [],
    planningIntent: "",
    executionNotes: "Choir dismisses after first verse",
    status: "detected_for_review",
    postService: {
      impact: "unknown",
      notes: ""
    }
  };

  return {
    sourceImportPreview: {
      sourceType: "order_of_service_pdf",
      sourceName: "Order of Service PDF",
      sourceFileName: "morning-service-2026-01-11.pdf",
      sourceFileHash: "abc123",
      sourcePath: "/tmp/morning-service-2026-01-11.pdf",
      importMode: "preview",
      importContractVersion: "service-order-pdf-v1"
    },
    service,
    serviceOrderItems: [orderItem],
    serviceSongEvents: [songEvent],
    serviceMoments: [moment],
    warnings: [],
    summary: {},
    ...overrides
  };
}

function buildBundle(previews = [buildServicePreview()]) {
  return buildPreviewBundle(previews, {
    sourceName: "2026 YTD Service Order PDFs"
  });
}

function plan(previewBundle = buildBundle(), existingState = {}) {
  return buildServiceOrderFirestoreWritePlan(previewBundle, {
    services: [],
    serviceOrderItems: [],
    serviceSongEvents: [],
    serviceMoments: [],
    sourceImports: [],
    ...existingState
  }, {
    now: NOW
  });
}

function buildExistingSpreadsheetService(overrides = {}) {
  return {
    serviceId: "svc-plan-2026-01-11-sunday-morning",
    serviceDate: "2026-01-11",
    serviceType: "sunday_morning",
    title: "Morning Service",
    source: "spreadsheet_import",
    sourceType: "spreadsheet_export",
    planningStatus: "planned",
    actualStatus: "unknown",
    changedAfterPlan: false,
    ...overrides
  };
}

function buildExistingSpreadsheetEvent(overrides = {}) {
  return {
    serviceSongEventId: "sse-plan-svc-plan-2026-01-11-sunday-morning-10-congregational-1",
    serviceId: "svc-plan-2026-01-11-sunday-morning",
    serviceDate: "2026-01-11",
    serviceType: "sunday_morning",
    slotIndex: 10,
    usageRole: "congregational",
    songTitleCandidate: "Jesus saves",
    source: "spreadsheet_import",
    sourceType: "spreadsheet_export",
    planningStatus: "planned",
    actualStatus: "unknown",
    changedAfterPlan: false,
    ...overrides
  };
}

test("buildSourceImportId is deterministic for a service-order bundle", () => {
  const bundle = buildBundle();

  assert.match(
    buildSourceImportId(bundle.sourceImportPreview),
    /^srcimp-order-of-service-pdf-2026-ytd-service-order-pdfs-2026-01-11-2026-01-11-[a-f0-9]{16}-service-order-pdf-v1$/
  );
});

test("missing service-order records plan creates", () => {
  const result = plan();

  assert.equal(result.services.create.length, 1);
  assert.equal(result.serviceOrderItems.create.length, 1);
  assert.equal(result.serviceSongEvents.create.length, 1);
  assert.equal(result.serviceMoments.create.length, 1);
  assert.equal(result.eligibleForCommit, true);
  assert.equal(result.serviceOrderItems.create[0].proposed.linkedServiceSongEventIds.length, 1);
});

test("existing spreadsheet service is refreshed and spreadsheet events are superseded", () => {
  const result = plan(buildBundle(), {
    services: [buildExistingSpreadsheetService({ theme: "Old Theme" })],
    serviceSongEvents: [buildExistingSpreadsheetEvent()]
  });

  assert.equal(result.services.update.length, 1);
  assert.ok(result.services.update[0].changedFields.includes("theme"));
  assert.equal(result.serviceSongEvents.create.length, 1);
  assert.equal(result.serviceSongEvents.update.length, 1);
  assert.equal(
    result.serviceSongEvents.update[0].reason,
    "supersede_spreadsheet_event_for_service_order_pdf"
  );
  assert.equal(result.serviceSongEvents.update[0].proposed.historyVisibility, "superseded");
  assert.equal(result.summary.supersededSpreadsheetEvents, 1);
});

test("manual spreadsheet events are not superseded", () => {
  const event = buildExistingSpreadsheetEvent({
    manualOverride: true,
    manualOverrideFields: ["songTitleCandidate"]
  });

  assert.equal(
    isSpreadsheetEventSupersedeCandidate(event, new Set([event.serviceId])),
    false
  );

  const result = plan(buildBundle(), {
    serviceSongEvents: [event]
  });

  assert.equal(result.summary.supersededSpreadsheetEvents, 0);
});

test("duplicate proposed service-order event ids are conflicts", () => {
  const preview = buildServicePreview();
  const duplicateEvent = {
    ...preview.serviceSongEvents[0],
    rawValue: "Duplicate"
  };
  const result = plan(buildBundle([{
    ...preview,
    serviceSongEvents: [preview.serviceSongEvents[0], duplicateEvent]
  }]));

  assert.equal(result.serviceSongEvents.conflict.length, 1);
  assert.equal(result.serviceSongEvents.conflict[0].reason, "duplicate_proposed_deterministic_id");
  assert.equal(result.eligibleForCommit, false);
});
