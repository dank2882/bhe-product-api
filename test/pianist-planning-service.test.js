"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluatePianistAvailability,
  getPianistWorkload,
  getPianoServicePlan,
  savePianistProfile,
  saveServicePianoAssignments
} = require("../lib/pianist-planning-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    return {
      exists: this.collection.store.has(this.id),
      data: () => clone(this.collection.store.get(this.id))
    };
  }

  async set(value) {
    this.collection.store.set(this.id, clone(value));
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

function buildServices() {
  return {
    "service-1": { serviceDate: "2026-07-05", serviceType: "sunday_morning", title: "Sunday Morning" },
    "service-2": { serviceDate: "2026-07-05", serviceType: "sunday_evening", title: "Sunday Evening" },
    "service-3": { serviceDate: "2026-07-08", serviceType: "wednesday_night", title: "Wednesday" },
    "service-4": { serviceDate: "2026-07-12", serviceType: "sunday_morning", title: "Sunday Morning" },
    "service-5": { serviceDate: "2026-07-12", serviceType: "sunday_evening", title: "Sunday Evening" },
    "service-6": { serviceDate: "2026-07-15", serviceType: "wednesday_night", title: "Wednesday" },
    "service-7": { serviceDate: "2026-07-19", serviceType: "sunday_morning", title: "Sunday Morning" }
  };
}

function createDeps() {
  return {
    pianistsCollection: new FakeCollection(),
    servicePianoPlansCollection: new FakeCollection(),
    servicesCollection: new FakeCollection(buildServices()),
    now: () => new Date("2026-07-15T20:00:00.000Z")
  };
}

test("recurring availability supports weeks of month and exact-date overrides", () => {
  const profile = {
    pianistId: "pianist-learner",
    displayName: "Learner",
    status: "active",
    capabilityLevel: "developing",
    defaultAvailability: "unavailable",
    recurringRules: [{
      ruleId: "first-third-sunday-am",
      serviceTypes: ["sunday_morning"],
      weeksOfMonth: [1, 3],
      available: true
    }],
    availabilityExceptions: [{
      serviceDate: "2026-07-19",
      serviceTypes: ["sunday_morning"],
      available: false,
      reason: "Away"
    }]
  };

  assert.equal(evaluatePianistAvailability(profile, "2026-07-05", "sunday_morning").available, true);
  assert.equal(evaluatePianistAvailability(profile, "2026-07-12", "sunday_morning").available, false);
  assert.deepEqual(
    evaluatePianistAvailability(profile, "2026-07-19", "sunday_morning"),
    { available: false, source: "date_exception", matchedRuleIds: [], reason: "Away" }
  );
});

test("pianist profiles derive fixed eligible piano positions", async () => {
  const deps = createDeps();
  const primary = await savePianistProfile({
    displayName: "Primary Player",
    capabilityLevel: "piano_1",
    defaultAvailability: "available"
  }, deps);
  const accompanist = await savePianistProfile({
    displayName: "Second Player",
    capabilityLevel: "piano_2",
    defaultAvailability: "available"
  }, deps);
  const learner = await savePianistProfile({
    displayName: "Learning Player",
    capabilityLevel: "developing",
    defaultAvailability: "available"
  }, deps);

  assert.deepEqual(primary.profile.eligiblePositions, ["piano_1"]);
  assert.deepEqual(accompanist.profile.eligiblePositions, ["piano_2"]);
  assert.deepEqual(learner.profile.eligiblePositions, ["piano_3", "piano_4"]);
  assert.equal(primary.profile.monthlyServiceLimit, 6);
});

test("whole-service assignments enforce position levels and preserve duty history", async () => {
  const deps = createDeps();
  await savePianistProfile({
    displayName: "Primary Player",
    capabilityLevel: "piano_1",
    defaultAvailability: "available"
  }, deps);
  await savePianistProfile({
    displayName: "Learning Player",
    capabilityLevel: "developing",
    defaultAvailability: "available"
  }, deps);

  const first = await saveServicePianoAssignments({
    serviceId: "service-1",
    assignments: [
      { position: "piano_1", pianistId: "pianist-primary_player" },
      { position: "piano_3", pianistId: "pianist-learning_player" }
    ]
  }, deps);

  assert.equal(first.plan.coverage.complete, true);
  assert.deepEqual(first.plan.assignments[0].duties, ["prelude", "congregational", "invitation", "postlude"]);
  assert.deepEqual(first.plan.assignments[1].duties, ["congregational"]);

  for (let index = 2; index <= 7; index += 1) {
    await saveServicePianoAssignments({
      serviceId: `service-${index}`,
      assignments: [{ position: "piano_1", pianistId: "pianist-primary_player" }]
    }, deps);
  }

  const workload = await getPianistWorkload({
    pianistId: "pianist-primary_player",
    month: "2026-07"
  }, deps);
  assert.equal(workload.pianists[0].totalServices, 7);
  assert.equal(workload.pianists[0].positionCounts.piano_1, 7);
  assert.equal(workload.pianists[0].months[0].overLimit, true);
  assert.equal(workload.warnings[0].code, "monthly_service_limit_exceeded");

  const plan = await getPianoServicePlan({ serviceId: "service-1" }, deps);
  assert.equal(plan.plan.assignments.length, 2);
  assert.equal(plan.plan.assignments[1].position, "piano_3");
});

test("a Piano 2 pianist cannot be moved into another position", async () => {
  const deps = createDeps();
  await savePianistProfile({
    displayName: "Second Player",
    capabilityLevel: "piano_2",
    defaultAvailability: "available"
  }, deps);

  await assert.rejects(
    () => saveServicePianoAssignments({
      serviceId: "service-1",
      assignments: [{ position: "piano_1", pianistId: "pianist-second_player" }]
    }, deps),
    { code: "pianist_position_not_eligible" }
  );
});
