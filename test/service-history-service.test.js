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

function createDeps({
  services = {},
  serviceSongEvents = {},
  breezeImports = {},
  now = () => new Date("2026-04-23T12:00:00.000Z")
} = {}) {
  return {
    servicesCollection: new FakeCollection(services),
    serviceSongEventsCollection: new FakeCollection(serviceSongEvents),
    breezeImportsCollection: new FakeCollection(breezeImports),
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
    dateFrom: "2026-04-01",
    dateTo: "2026-04-30",
    serviceType: "sunday_night"
  });
  assert.deepEqual(
    result.services.map((service) => service.serviceId),
    ["svc-2026-04-19-pm", "svc-2026-04-12-pm", "svc-2026-04-05-ls"]
  );
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
    status: "completed",
    importedAt: "2026-04-23T00:00:00.000Z"
  });
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
