const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getServiceById,
  searchServices
} = require("../lib/service-history-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }

  async get() {
    return {
      exists: this.store.has(this.id),
      data: () => clone(this.store.get(this.id))
    };
  }
}

class FakeCollection {
  constructor(initialRecords = {}) {
    this.store = new Map(Object.entries(clone(initialRecords)));
  }

  doc(id) {
    return new FakeDocRef(this.store, id);
  }

  limit(maxDocs) {
    return {
      get: async () => {
        const docs = Array.from(this.store.entries())
          .slice(0, maxDocs)
          .map(([id, value]) => ({
            id,
            data: () => clone(value)
          }));

        return { docs };
      }
    };
  }
}

function buildService(overrides = {}) {
  return {
    serviceId: "svc-2026-04-19-am",
    serviceDate: "2026-04-19",
    serviceType: "Sunday Morning",
    title: "Sunday Morning Worship",
    theme: "The Faithfulness of God",
    source: "breeze_import",
    sourceImportId: "breeze-import-1",
    rawBreezeReference: "breeze:service:1001",
    serviceLabels: [],
    songs: [],
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    ...clone(overrides)
  };
}

function buildServiceSongEvent(overrides = {}) {
  return {
    serviceSongEventId: "event-1",
    serviceId: "svc-2026-04-19-am",
    songId: "rejoice-0381",
    hymnalNumber: 381,
    title: "Blessed Assurance",
    serviceDate: "2026-04-19",
    serviceType: "Sunday Morning",
    slotIndex: 1,
    usageRole: "congregational",
    source: "breeze_import",
    sourceImportId: "breeze-import-1",
    createdAt: "2026-04-23T00:00:00.000Z",
    ...clone(overrides)
  };
}

function buildBreezeImport(overrides = {}) {
  return {
    importId: "breeze-import-1",
    sourceSystem: "breeze",
    importedAt: "2026-04-23T00:00:00.000Z",
    status: "completed",
    rowCounts: {
      services: 4,
      serviceSongEvents: 12
    },
    warnings: [],
    unmatchedSongs: [],
    ...clone(overrides)
  };
}

function buildSourceImport(overrides = {}) {
  return {
    sourceImportId: "sheet-import-1",
    sourceType: "spreadsheet_export",
    sourceName: "Music Ministry - Master Data",
    sourceSheetName: "PROPOSED SCHEDULES",
    sourceImportedAt: "2026-04-23T00:00:00.000Z",
    status: "planned",
    ...clone(overrides)
  };
}

function buildSpreadsheetService(overrides = {}) {
  return buildService({
    serviceId: "svc-plan-2026-04-22-sunday-morning",
    serviceDate: "2026-04-22",
    serviceType: "sunday_morning",
    title: "Morning Service",
    theme: "Grace",
    source: "spreadsheet_import",
    sourceType: "spreadsheet_export",
    sourceName: "Music Ministry - Master Data",
    sourceImportId: "sheet-import-1",
    rawBreezeReference: "",
    planningStatus: "planned",
    actualStatus: "unknown",
    changedAfterPlan: false,
    serviceLabels: ["AM"],
    sourceSheetName: "PROPOSED SCHEDULES",
    sourceRowNumber: 4,
    sourceCell: "B4",
    ...clone(overrides)
  });
}

function buildSpreadsheetSongEvent(overrides = {}) {
  return buildServiceSongEvent({
    serviceSongEventId: "sse-plan-2026-04-22-c1",
    serviceId: "svc-plan-2026-04-22-sunday-morning",
    songId: null,
    hymnalNumber: null,
    title: "Jesus Saves",
    songTitleCandidate: "Jesus Saves",
    songTitleConfidence: "high",
    serviceDate: "2026-04-22",
    serviceType: "sunday_morning",
    slotIndex: 10,
    usageRole: "congregational",
    source: "spreadsheet_import",
    sourceType: "spreadsheet_export",
    sourceImportId: "sheet-import-1",
    planningStatus: "planned",
    actualStatus: "unknown",
    changedAfterPlan: false,
    sourceColumnName: "Congregational #1",
    sourceCell: "C4",
    assignedPersonOrGroupRaw: "",
    detailNote: "",
    ...clone(overrides)
  });
}

function createDeps({
  services = {},
  serviceSongEvents = {},
  breezeImports = {},
  sourceImports = {},
  now = () => new Date("2026-04-23T12:00:00.000Z")
} = {}) {
  return {
    servicesCollection: new FakeCollection(services),
    serviceSongEventsCollection: new FakeCollection(serviceSongEvents),
    breezeImportsCollection: new FakeCollection(breezeImports),
    sourceImportsCollection: new FakeCollection(sourceImports),
    now
  };
}

function buildFixtureDeps() {
  return createDeps({
    services: {
      "svc-2026-04-19-am": buildService(),
      "svc-2026-04-19-pm": buildService({
        serviceId: "svc-2026-04-19-pm",
        serviceDate: "2026-04-19",
        serviceType: "Sunday Night",
        title: "Sunday Evening Worship",
        theme: "Walking by Faith",
        sourceImportId: "breeze-import-2",
        rawBreezeReference: "breeze:service:1002"
      }),
      "svc-2026-04-12-pm": buildService({
        serviceId: "svc-2026-04-12-pm",
        serviceDate: "2026-04-12",
        serviceType: "Sunday Night",
        title: "Sunday Evening Worship",
        theme: "Standing Firm",
        sourceImportId: "breeze-import-3",
        rawBreezeReference: "breeze:service:1003"
      }),
      "svc-2025-04-20-am": buildService({
        serviceId: "svc-2025-04-20-am",
        serviceDate: "2025-04-20",
        serviceType: "Sunday Morning",
        title: "Easter Sunday Morning",
        theme: "He Is Risen",
        serviceLabels: ["Easter"],
        sourceImportId: "breeze-import-4",
        rawBreezeReference: "breeze:service:1004"
      }),
      "svc-2026-04-05-ls": buildService({
        serviceId: "svc-2026-04-05-ls",
        serviceDate: "2026-04-05",
        serviceType: "Sunday Night",
        title: "Lord's Supper Evening",
        theme: "Remember Me",
        serviceLabels: ["Lord's Supper"],
        sourceImportId: "breeze-import-5",
        rawBreezeReference: "breeze:service:1005"
      }),
      "svc-2025-10-05-ls": buildService({
        serviceId: "svc-2025-10-05-ls",
        serviceDate: "2025-10-05",
        serviceType: "Sunday Night",
        title: "Lord's Supper Evening",
        theme: "Communion Together",
        serviceLabels: ["Lord's Supper"],
        sourceImportId: "breeze-import-6",
        rawBreezeReference: "breeze:service:1006"
      }),
      "svc-manual-1": buildService({
        serviceId: "svc-manual-1",
        serviceDate: "2026-04-19",
        serviceType: "Sunday Morning",
        title: "Manual Draft Service",
        theme: "Should Be Ignored",
        source: "manual",
        sourceImportId: "",
        rawBreezeReference: ""
      })
    },
    serviceSongEvents: {
      "event-1": buildServiceSongEvent(),
      "event-2": buildServiceSongEvent({
        serviceSongEventId: "event-2",
        serviceId: "svc-2026-04-19-am",
        songId: "rejoice-0405",
        hymnalNumber: 405,
        title: "Take My Life, and Let It Be Consecrated",
        slotIndex: 2
      }),
      "event-3": buildServiceSongEvent({
        serviceSongEventId: "event-3",
        serviceId: "svc-2025-04-20-am",
        songId: "rejoice-0329",
        hymnalNumber: 329,
        title: "I Know That My Redeemer Liveth",
        serviceDate: "2025-04-20",
        sourceImportId: "breeze-import-4"
      }),
      "event-4": buildServiceSongEvent({
        serviceSongEventId: "event-4",
        serviceId: "svc-2026-04-05-ls",
        songId: "rejoice-0244",
        hymnalNumber: 244,
        title: "What a Friend We Have in Jesus",
        serviceDate: "2026-04-05",
        serviceType: "Sunday Night",
        sourceImportId: "breeze-import-5"
      }),
      "event-5": buildServiceSongEvent({
        serviceSongEventId: "event-5",
        serviceId: "svc-2025-10-05-ls",
        songId: "rejoice-0292",
        hymnalNumber: 292,
        title: "When I Survey the Wondrous Cross",
        serviceDate: "2025-10-05",
        serviceType: "Sunday Night",
        sourceImportId: "breeze-import-6"
      }),
      "event-6": buildServiceSongEvent({
        serviceSongEventId: "event-6",
        serviceId: "svc-2026-04-19-pm",
        songId: "rejoice-0636",
        hymnalNumber: 636,
        title: "Revive Us Again",
        serviceDate: "2026-04-19",
        serviceType: "Sunday Night",
        sourceImportId: "breeze-import-2"
      }),
      "event-7": buildServiceSongEvent({
        serviceSongEventId: "event-7",
        serviceId: "svc-2026-04-12-pm",
        songId: "rejoice-0519",
        hymnalNumber: 519,
        title: "Spirit of the Living God",
        serviceDate: "2026-04-12",
        serviceType: "Sunday Night",
        sourceImportId: "breeze-import-3"
      })
    },
    breezeImports: {
      "breeze-import-1": buildBreezeImport(),
      "breeze-import-2": buildBreezeImport({
        importId: "breeze-import-2"
      }),
      "breeze-import-3": buildBreezeImport({
        importId: "breeze-import-3"
      }),
      "breeze-import-4": buildBreezeImport({
        importId: "breeze-import-4"
      }),
      "breeze-import-5": buildBreezeImport({
        importId: "breeze-import-5"
      }),
      "breeze-import-6": buildBreezeImport({
        importId: "breeze-import-6"
      })
    }
  });
}

test("searchServices supports last Sunday morning lookup from normalized Breeze history", async () => {
  const deps = buildFixtureDeps();

  const result = await searchServices(
    {
      query: "What songs were used last Sunday morning?"
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.deepEqual(result.appliedFilters, {
    dateScope: "past",
    serviceDate: "2026-04-19",
    serviceType: "sunday_morning"
  });
  assert.equal(result.services[0].serviceId, "svc-2026-04-19-am");
  assert.deepEqual(
    result.services[0].songs.map((song) => song.title),
    ["Blessed Assurance", "Take My Life, and Let It Be Consecrated"]
  );
});

test("searchServices supports Easter Sunday morning lookup for a specific year", async () => {
  const deps = buildFixtureDeps();

  const result = await searchServices(
    {
      query: "Show me the Easter Sunday morning service from 2025."
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.services[0].serviceId, "svc-2025-04-20-am");
  assert.deepEqual(result.appliedFilters, {
    dateScope: "past",
    dateFrom: "2025-01-01",
    dateTo: "2025-12-31",
    serviceType: "sunday_morning",
    labels: ["easter"]
  });
});

test("searchServices returns ambiguity warnings when multiple Lord's Supper evening services match", async () => {
  const deps = buildFixtureDeps();

  const result = await searchServices(
    {
      query: "Show me the Lord's Supper evening service songs."
    },
    deps
  );

  assert.equal(result.count, 2);
  assert.deepEqual(result.appliedFilters, {
    dateScope: "past",
    labels: ["lords_supper"]
  });
  assert.deepEqual(result.warnings, [
    "Multiple services matched the request. Review the returned candidates before selecting one."
  ]);
});

test("searchServices supports Sunday night services this month lookup", async () => {
  const deps = buildFixtureDeps();

  const result = await searchServices(
    {
      query: "What songs were used in Sunday night services this month?"
    },
    deps
  );

  assert.equal(result.count, 3);
  assert.deepEqual(result.appliedFilters, {
    dateScope: "past",
    dateFrom: "2026-04-01",
    dateTo: "2026-04-30",
    serviceType: "sunday_night"
  });
  assert.deepEqual(
    result.services.map((service) => service.serviceId),
    ["svc-2026-04-19-pm", "svc-2026-04-12-pm", "svc-2026-04-05-ls"]
  );
});

test("searchServices defaults to past services and excludes today/future services", async () => {
  const deps = createDeps({
    services: {
      past: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-22-sunday-morning",
        serviceDate: "2026-04-22"
      }),
      today: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-23-sunday-morning",
        serviceDate: "2026-04-23"
      }),
      future: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24"
      })
    },
    serviceSongEvents: {
      pastEvent: buildSpreadsheetSongEvent({
        serviceId: "svc-plan-2026-04-22-sunday-morning",
        serviceDate: "2026-04-22"
      }),
      todayEvent: buildSpreadsheetSongEvent({
        serviceSongEventId: "sse-plan-2026-04-23-c1",
        serviceId: "svc-plan-2026-04-23-sunday-morning",
        serviceDate: "2026-04-23"
      }),
      futureEvent: buildSpreadsheetSongEvent({
        serviceSongEventId: "sse-plan-2026-04-24-c1",
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24"
      })
    },
    sourceImports: {
      "sheet-import-1": buildSourceImport()
    },
    now: () => new Date("2026-04-23T12:00:00.000Z")
  });

  const result = await searchServices(
    {
      filters: {
        serviceType: "sunday_morning"
      }
    },
    deps
  );

  assert.deepEqual(result.appliedFilters, {
    dateScope: "past",
    serviceType: "sunday_morning"
  });
  assert.deepEqual(
    result.services.map((service) => service.serviceId),
    ["svc-plan-2026-04-22-sunday-morning"]
  );
});

test("searchServices uses the ministry-local date boundary for default history scope", async () => {
  const deps = createDeps({
    services: {
      currentLocalDay: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24"
      }),
      previousLocalDay: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-23-sunday-morning",
        serviceDate: "2026-04-23"
      })
    },
    sourceImports: {
      "sheet-import-1": buildSourceImport()
    },
    now: () => new Date("2026-04-25T04:30:00.000Z")
  });

  const result = await searchServices(
    {
      filters: {
        serviceType: "sunday_morning"
      }
    },
    deps
  );

  assert.deepEqual(
    result.services.map((service) => service.serviceId),
    ["svc-plan-2026-04-23-sunday-morning"]
  );
});

test("searchServices supports upcoming dateScope for today and future planned services", async () => {
  const deps = createDeps({
    services: {
      past: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-22-sunday-morning",
        serviceDate: "2026-04-22"
      }),
      today: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-23-sunday-morning",
        serviceDate: "2026-04-23"
      }),
      future: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24"
      })
    },
    sourceImports: {
      "sheet-import-1": buildSourceImport()
    },
    now: () => new Date("2026-04-23T12:00:00.000Z")
  });

  const result = await searchServices(
    {
      filters: {
        dateScope: "upcoming",
        serviceType: "sunday_morning"
      }
    },
    deps
  );

  assert.deepEqual(
    result.services.map((service) => service.serviceId),
    [
      "svc-plan-2026-04-24-sunday-morning",
      "svc-plan-2026-04-23-sunday-morning"
    ]
  );
});

test("searchServices supports any dateScope for past and upcoming services", async () => {
  const deps = createDeps({
    services: {
      past: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-22-sunday-morning",
        serviceDate: "2026-04-22"
      }),
      future: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24"
      })
    },
    sourceImports: {
      "sheet-import-1": buildSourceImport()
    },
    now: () => new Date("2026-04-23T12:00:00.000Z")
  });

  const result = await searchServices(
    {
      filters: {
        dateScope: "any",
        serviceType: "sunday_morning"
      }
    },
    deps
  );

  assert.deepEqual(
    result.services.map((service) => service.serviceId),
    [
      "svc-plan-2026-04-24-sunday-morning",
      "svc-plan-2026-04-22-sunday-morning"
    ]
  );
});

test("past spreadsheet-imported services appear in history results with status and source fields", async () => {
  const deps = createDeps({
    services: {
      "svc-plan-2026-04-22-sunday-morning": buildSpreadsheetService()
    },
    serviceSongEvents: {
      pastEvent: buildSpreadsheetSongEvent()
    },
    sourceImports: {
      "sheet-import-1": buildSourceImport()
    },
    now: () => new Date("2026-04-23T12:00:00.000Z")
  });

  const result = await searchServices(
    {
      filters: {
        serviceDate: "2026-04-22",
        serviceType: "sunday_morning"
      }
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.services[0].source, "spreadsheet_import");
  assert.equal(result.services[0].sourceType, "spreadsheet_export");
  assert.equal(result.services[0].sourceName, "Music Ministry - Master Data");
  assert.equal(result.services[0].planningStatus, "planned");
  assert.equal(result.services[0].actualStatus, "unknown");
  assert.equal(result.services[0].changedAfterPlan, false);
  assert.deepEqual(result.services[0].importContext, {
    importId: "sheet-import-1",
    status: "planned",
    importedAt: "2026-04-23T00:00:00.000Z",
    sourceType: "spreadsheet_export",
    sourceName: "Music Ministry - Master Data",
    sourceSheetName: "PROPOSED SCHEDULES"
  });
});

test("future spreadsheet-imported services do not appear in default history results", async () => {
  const deps = createDeps({
    services: {
      future: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24"
      })
    },
    sourceImports: {
      "sheet-import-1": buildSourceImport()
    },
    now: () => new Date("2026-04-23T12:00:00.000Z")
  });

  const result = await searchServices(
    {
      filters: {
        serviceType: "sunday_morning"
      }
    },
    deps
  );

  assert.equal(result.count, 0);
});

test("upcoming planned service song events preserve special-music fields", async () => {
  const deps = createDeps({
    services: {
      future: buildSpreadsheetService({
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24"
      })
    },
    serviceSongEvents: {
      assignmentOnly: buildSpreadsheetSongEvent({
        serviceSongEventId: "sse-plan-2026-04-24-special-1",
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24",
        slotIndex: 60,
        usageRole: "special_music",
        title: "",
        songTitleCandidate: "",
        songTitleConfidence: "low",
        assignedPersonOrGroupRaw: "Gabe & Abby D",
        detailNote: "",
        sourceColumnName: "Special #1",
        sourceCell: "H4"
      }),
      performerPlusTitle: buildSpreadsheetSongEvent({
        serviceSongEventId: "sse-plan-2026-04-24-special-2",
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24",
        slotIndex: 70,
        usageRole: "special_music",
        title: "Around the Corner",
        songTitleCandidate: "Around the Corner",
        songTitleConfidence: "medium",
        assignedPersonOrGroupRaw: "Gendro family",
        sourceColumnName: "Special #2",
        sourceCell: "I4"
      }),
      detailNote: buildSpreadsheetSongEvent({
        serviceSongEventId: "sse-plan-2026-04-24-special-3",
        serviceId: "svc-plan-2026-04-24-sunday-morning",
        serviceDate: "2026-04-24",
        slotIndex: 80,
        usageRole: "special_music",
        title: "",
        songTitleCandidate: "",
        songTitleConfidence: "low",
        assignedPersonOrGroupRaw: "FBCA Elementary",
        detailNote: "K-2",
        sourceColumnName: "Special #3",
        sourceCell: "J4"
      })
    },
    sourceImports: {
      "sheet-import-1": buildSourceImport()
    },
    now: () => new Date("2026-04-23T12:00:00.000Z")
  });

  const result = await searchServices(
    {
      filters: {
        dateScope: "upcoming",
        serviceDate: "2026-04-24"
      }
    },
    deps
  );

  const songs = result.services[0].songs;
  assert.equal(songs[0].assignedPersonOrGroupRaw, "Gabe & Abby D");
  assert.equal(songs[0].songTitleCandidate, "");
  assert.equal(songs[0].sourceColumnName, "Special #1");
  assert.equal(songs[0].sourceCell, "H4");
  assert.equal(songs[1].assignedPersonOrGroupRaw, "Gendro family");
  assert.equal(songs[1].songTitleCandidate, "Around the Corner");
  assert.equal(songs[1].songTitleConfidence, "medium");
  assert.equal(songs[2].assignedPersonOrGroupRaw, "FBCA Elementary");
  assert.equal(songs[2].detailNote, "K-2");
});

test("getServiceById returns the normalized service detail with songs and import context", async () => {
  const deps = buildFixtureDeps();

  const result = await getServiceById(
    {
      serviceId: "svc-2026-04-19-am"
    },
    deps
  );

  assert.equal(result.service.serviceId, "svc-2026-04-19-am");
  assert.equal(result.service.serviceType, "sunday_morning");
  assert.equal(result.service.songCount, 2);
  assert.deepEqual(
    result.service.songs.map((song) => song.hymnalNumber),
    [381, 405]
  );
  assert.deepEqual(result.service.importContext, {
    importId: "breeze-import-1",
    sourceType: "breeze",
    status: "completed",
    importedAt: "2026-04-23T00:00:00.000Z"
  });
});

test("getServiceById returns planned spreadsheet detail with sourceImports context", async () => {
  const deps = createDeps({
    services: {
      "svc-plan-2026-04-22-sunday-morning": buildSpreadsheetService()
    },
    serviceSongEvents: {
      pastEvent: buildSpreadsheetSongEvent()
    },
    sourceImports: {
      "sheet-import-1": buildSourceImport()
    }
  });

  const result = await getServiceById(
    {
      serviceId: "svc-plan-2026-04-22-sunday-morning"
    },
    deps
  );

  assert.equal(result.service.planningStatus, "planned");
  assert.equal(result.service.actualStatus, "unknown");
  assert.equal(result.service.changedAfterPlan, false);
  assert.equal(result.service.sourceType, "spreadsheet_export");
  assert.equal(result.service.sourceSheetName, "PROPOSED SCHEDULES");
  assert.equal(result.service.sourceRowNumber, 4);
  assert.equal(result.service.sourceCell, "B4");
  assert.equal(result.service.importContext.sourceType, "spreadsheet_export");
});

test("searchServices rejects requests with no query and no filters", async () => {
  const deps = buildFixtureDeps();

  await assert.rejects(
    () => searchServices({}, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "missing_query_or_filters");
      return true;
    }
  );
});

test("getServiceById fails clearly when the service does not exist", async () => {
  const deps = buildFixtureDeps();

  await assert.rejects(
    () => getServiceById({ serviceId: "svc-missing" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "service_not_found");
      return true;
    }
  );
});
