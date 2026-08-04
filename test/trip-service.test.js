"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getTripMemory,
  saveTripMemory,
  searchTripMemories
} = require("../lib/trip-service");

class FakeDocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    const value = this.collection.records.get(this.id);
    return {
      id: this.id,
      exists: value !== undefined,
      data: () => value
    };
  }

  async create(value) {
    if (this.collection.records.has(this.id)) throw new Error("already exists");
    this.collection.records.set(this.id, structuredClone(value));
  }

  async set(value) {
    this.collection.records.set(this.id, structuredClone(value));
  }
}

class FakeCollection {
  constructor(records = []) {
    this.records = new Map(records.map((record) => [record.id, structuredClone(record.data)]));
  }

  doc(id) {
    return new FakeDocRef(this, id);
  }

  async get() {
    return {
      docs: [...this.records.entries()].map(([id, value]) => ({
        id,
        data: () => structuredClone(value)
      }))
    };
  }
}

function buildDeps(overrides = {}) {
  return {
    projectsCollection: new FakeCollection([{
      id: "project-philippines-2026",
      data: {
        projectId: "project-philippines-2026",
        visibility: "private",
        ownerSub: "dan-sub"
      }
    }]),
    tripMemoriesCollection: new FakeCollection(),
    taskAccess: {
      role: "member",
      subject: "dan-sub",
      subjects: ["dan-sub"],
      name: "Dan"
    },
    now: () => new Date("2026-08-03T06:00:00.000Z"),
    ...overrides
  };
}

test("trip memory preserves exact text, defaults private, and reads back", async () => {
  const deps = buildDeps();
  const exactText = "We landed, and the first small kindness mattered.";
  const saved = await saveTripMemory({
    exactText,
    category: "moment",
    idempotencyKey: "memory-flight-kindness-001"
  }, deps);
  assert.equal(saved.memory.exactText, exactText);
  assert.equal(saved.memory.privacy, "private_only");
  assert.match(saved.memory.philippineLocalTimestamp, /Asia\/Manila$/);
  assert.equal(saved.idempotency.replayed, false);

  const replayed = await saveTripMemory({
    exactText,
    category: "moment",
    idempotencyKey: "memory-flight-kindness-001"
  }, deps);
  assert.equal(replayed.idempotency.replayed, true);

  const readBack = await getTripMemory({ memoryId: saved.memory.memoryId }, deps);
  assert.equal(readBack.memory.exactText, exactText);
  const history = await searchTripMemories({ query: "small kindness" }, deps);
  assert.equal(history.count, 1);
  assert.equal(history.memories[0].memoryId, saved.memory.memoryId);
});

test("trip memory rejects reuse of an idempotency key for changed text", async () => {
  const deps = buildDeps();
  await saveTripMemory({ exactText: "First", idempotencyKey: "memory-reuse-001" }, deps);
  await assert.rejects(
    saveTripMemory({ exactText: "Changed", idempotencyKey: "memory-reuse-001" }, deps),
    (error) => error.code === "trip_memory_idempotency_key_reused"
  );
});

test("private trip data cannot be read or written by another member", async () => {
  const deps = buildDeps({
    taskAccess: {
      role: "member",
      subject: "other-sub",
      subjects: ["other-sub"],
      name: "Other"
    }
  });
  await assert.rejects(
    searchTripMemories({}, deps),
    (error) => error.code === "task_access_denied"
  );
  await assert.rejects(
    saveTripMemory({ exactText: "No", idempotencyKey: "memory-other-001" }, deps),
    (error) => error.code === "task_access_denied"
  );
});
