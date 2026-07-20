"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getServiceMinistryAssignments,
  saveServiceMinistryAssignments
} = require("../lib/service-ministry-assignment-service");

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
        docs: Array.from(this.store.entries()).slice(0, maxDocs).map(([id, value]) => ({
          id,
          data: () => clone(value)
        }))
      })
    };
  }
}

function createDeps() {
  return {
    servicesCollection: new FakeCollection({
      "service-1": {
        serviceId: "service-1",
        serviceDate: "2026-07-19",
        serviceType: "sunday_morning",
        sourceSheetName: "PROPOSED SCHEDULES",
        sourceRowNumber: 12,
        message: {}
      }
    }),
    serviceSongEventsCollection: new FakeCollection({
      choir: {
        serviceSongEventId: "choir-event",
        serviceId: "service-1",
        usageRole: "choir_special",
        sourceColumnName: "Choir Special",
        slotIndex: 50,
        title: "Choir Song"
      },
      special: {
        serviceSongEventId: "special-event",
        serviceId: "service-1",
        usageRole: "special_music",
        sourceColumnName: "Special #1",
        sourceCell: "I12",
        slotIndex: 60,
        assignedPersonOrGroupRaw: "Vocalist"
      }
    }),
    serviceMinistryAssignmentsCollection: new FakeCollection(),
    servicePianoPlansCollection: new FakeCollection(),
    now: () => new Date("2026-07-15T20:00:00.000Z")
  };
}

test("service ministry query exposes stable choir and special item IDs", async () => {
  const result = await getServiceMinistryAssignments({ serviceId: "service-1" }, createDeps());

  assert.deepEqual(result.supportMusicItems.map((item) => item.serviceSongEventId), ["choir-event", "special-event"]);
});

test("preacher cannot also be saved as congregational leader", async () => {
  await assert.rejects(
    () => saveServiceMinistryAssignments({
      serviceId: "service-1",
      preacher: { displayName: "Same Person" },
      congregationalLeader: { displayName: "Same Person" },
      writeToSpreadsheet: false
    }, createDeps()),
    { code: "preacher_cannot_lead_congregationals" }
  );
});

test("service ministry assignments save preacher and per-special accompanist", async () => {
  const deps = createDeps();
  const result = await saveServiceMinistryAssignments({
    serviceId: "service-1",
    preacher: { displayName: "Pastor Example" },
    congregationalLeader: { displayName: "Song Leader" },
    choirAccompanist: { displayName: "Choir Pianist" },
    specialAccompanists: [{ serviceSongEventId: "special-event", displayName: "Special Pianist" }],
    writeToSpreadsheet: false
  }, deps);

  assert.equal(result.assignments.preacher.displayName, "Pastor Example");
  assert.equal(result.assignments.specialAccompanists[0].sourceColumnName, "Special #1");
  assert.equal(result.assignments.specialAccompanists[0].displayName, "Special Pianist");
  assert.equal(deps.servicesCollection.store.get("service-1").message.speakerName, "Pastor Example");
  assert.equal(result.spreadsheetWrite.skipped, true);
});
