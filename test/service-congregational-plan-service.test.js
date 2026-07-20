"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  saveServiceCongregationalPlan
} = require("../lib/service-congregational-plan-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    return { exists: this.collection.store.has(this.id), data: () => clone(this.collection.store.get(this.id)) };
  }

  async set(value) {
    this.collection.store.set(this.id, clone(value));
  }

  async update(value) {
    this.collection.store.set(this.id, { ...this.collection.store.get(this.id), ...clone(value) });
  }
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
  }

  doc(id) {
    return new FakeDocRef(this, id);
  }

  limit(maxDocs) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries()).slice(0, maxDocs).map(([id, value]) => ({ id, data: () => clone(value) }))
      })
    };
  }
}

function createDeps() {
  const requests = [];
  return {
    requests,
    servicesCollection: new FakeCollection({
      "service-1": {
        serviceId: "service-1",
        serviceDate: "2026-08-30",
        serviceType: "sunday_night",
        sourceSheetName: "PROPOSED SCHEDULES",
        sourceRowNumber: 31
      }
    }),
    serviceSongEventsCollection: new FakeCollection({
      "event-1": {
        serviceSongEventId: "event-1",
        serviceId: "service-1",
        sourceColumnName: "Congregational #1",
        sourceColumnKey: "congregational_1",
        slotIndex: 10,
        title: "Old First Song"
      },
      "event-3": {
        serviceSongEventId: "event-3",
        serviceId: "service-1",
        sourceColumnName: "Congregational #3",
        sourceColumnKey: "congregational_3",
        slotIndex: 30,
        title: "Untouched Third Song"
      }
    }),
    songsCollection: new FakeCollection({
      "rejoice-0276": { songId: "rejoice-0276", hymnalNumber: 276, canonicalTitle: "Jesus Paid It All" }
    }),
    createGoogleSheetBackup: async () => ({ created: true, backupSheetId: 99 }),
    googleSheetsRequest: async (request) => {
      requests.push(request);
      if (request.path.includes("values:batchGet")) {
        const latestPost = requests.findLast((item) => item.method === "POST");
        return { valueRanges: (latestPost?.data?.data || []).map((entry) => ({ values: [[entry.values[0][0]]] })) };
      }
      if (request.method === "GET") {
        const rows = Array.from({ length: 134 }, () => []);
        rows[0] = ["", "", "August"];
        rows[1] = ["Theme", "", "Date/Service", "Congregational #1", "Congregational #2", "Congregational #3"];
        rows[133] = ["", "", "August 30th PM"];
        return { values: rows };
      }
      return { totalUpdatedCells: request.data.data.length };
    },
    now: () => new Date("2026-07-15T20:00:00.000Z")
  };
}

test("service congregational plan writes the sheet and matching Firestore event", async () => {
  const deps = createDeps();
  const result = await saveServiceCongregationalPlan({
    serviceId: "service-1",
    songChanges: [{ slot: "congregational_1", songId: "rejoice-0276" }]
  }, deps);

  assert.equal(result.changes[0].displayValue, "276 - Jesus Paid It All");
  assert.equal(result.changes[0].sourceCell, "D134");
  assert.equal(deps.serviceSongEventsCollection.store.get("event-1").songId, "rejoice-0276");
  assert.equal(deps.serviceSongEventsCollection.store.get("event-1").title, "Jesus Paid It All");
  assert.equal(deps.serviceSongEventsCollection.store.get("event-1").sourceRowNumber, 134);
  assert.equal(deps.serviceSongEventsCollection.store.get("event-3").title, "Untouched Third Song");
  assert.equal(deps.servicesCollection.store.get("service-1").changedAfterPlan, true);
  assert.equal(deps.servicesCollection.store.get("service-1").sourceRowNumber, 134);
  assert.equal(deps.servicesCollection.store.get("service-1").sourceCell, "C134");
});

test("service congregational plan can clear one slot without deleting its audit record", async () => {
  const deps = createDeps();
  await saveServiceCongregationalPlan({
    serviceId: "service-1",
    songChanges: [{ slot: "congregational_1", clear: true, notes: "Removed by request" }]
  }, deps);

  const event = deps.serviceSongEventsCollection.store.get("event-1");
  assert.equal(event.planningStatus, "removed_from_plan");
  assert.equal(event.historyVisibility, "superseded");
  assert.equal(event.detailNote, "Removed by request");
});
