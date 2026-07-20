"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createIdempotentOperationRunner
} = require("../lib/workspace-operation-execution");

function containsNestedArray(value, insideArray = false) {
  if (Array.isArray(value)) {
    if (insideArray) return true;
    return value.some((item) => containsNestedArray(item, true));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsNestedArray(item, false));
  }
  return false;
}

class FirestoreShapedCollection {
  constructor() {
    this.store = new Map();
  }

  doc(id) {
    return {
      get: async () => ({ exists: this.store.has(id), data: () => this.store.get(id) }),
      create: async (value) => this.store.set(id, value),
      set: async (value) => {
        if (containsNestedArray(value)) throw new Error("Firestore rejects nested arrays");
        this.store.set(id, value);
      }
    };
  }
}

test("idempotency receipts serialize nested Sheet value arrays and replay them exactly", async () => {
  let calls = 0;
  const runner = createIdempotentOperationRunner({
    workspaceCode: "test",
    executionIdPrefix: "test-operation",
    executionCollectionKey: "executionsCollection",
    runOperation: async () => {
      calls += 1;
      return { operation: "restoreRange", mode: "command", result: { values: [["one", "two"]] } };
    }
  });
  const deps = { executionsCollection: new FirestoreShapedCollection() };
  const request = { mode: "command", operation: "restoreRange", arguments: {}, idempotencyKey: "restore-once" };

  const first = await runner(request, deps);
  const replay = await runner(request, deps);

  assert.deepEqual(first.result.values, [["one", "two"]]);
  assert.deepEqual(replay.result.values, [["one", "two"]]);
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(calls, 1);
});
