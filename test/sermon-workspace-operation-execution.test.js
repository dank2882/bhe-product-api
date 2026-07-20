const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildReplaySummary,
  runIdempotentSermonWorkspaceOperation,
  stableStringify
} = require("../lib/sermon-workspace-operation-execution");

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

  async create(data) {
    if (this.store.has(this.id)) {
      const error = new Error("already exists");
      error.code = 6;
      throw error;
    }
    this.store.set(this.id, clone(data));
  }

  async set(data) {
    this.store.set(this.id, clone(data));
  }
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
  }

  doc(id) {
    return new FakeDocRef(this.store, id);
  }

  limit(maxDocs) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries())
          .slice(0, maxDocs)
          .map(([id, data]) => ({
            id,
            data: () => clone(data)
          }))
      })
    };
  }
}

function createDeps() {
  return {
    sermonsCollection: new FakeCollection(),
    sermonOccasionsCollection: new FakeCollection(),
    sermonDevelopmentSessionsCollection: new FakeCollection(),
    sermonDevelopmentCheckpointsCollection: new FakeCollection(),
    sermonOperationExecutionsCollection: new FakeCollection(),
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-11T01:30:00.000Z"
  };
}

test("query operations remain read-only and do not require an idempotency collection", async () => {
  const response = await runIdempotentSermonWorkspaceOperation(
    {
      mode: "query",
      operation: "listSermons",
      arguments: { query: "Living Free" }
    },
    {
      sermonsCollection: new FakeCollection(),
      sermonOccasionsCollection: new FakeCollection(),
      sermonDevelopmentSessionsCollection: new FakeCollection(),
      sermonDevelopmentCheckpointsCollection: new FakeCollection()
    }
  );

  assert.equal(response.result.count, 0);
  assert.equal(response.idempotency.protected, false);
});

test("command retries replay the first successful result without running twice", async () => {
  const deps = createDeps();
  const request = {
    mode: "command",
    operation: "createSermon",
    idempotencyKey: "create-sermon-walk-2026-07-11",
    arguments: { title: "A Walk-Built Sermon", status: "idea" }
  };

  const first = await runIdempotentSermonWorkspaceOperation(request, deps);
  const replay = await runIdempotentSermonWorkspaceOperation(request, deps);

  assert.equal(first.idempotency.protected, true);
  assert.equal(first.idempotency.replayed, false);
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(replay.result.sermon.sermonId, first.result.sermon.sermonId);
  assert.equal(deps.sermonsCollection.store.size, 1);
  assert.equal(deps.sermonOperationExecutionsCollection.store.size, 1);
});

test("reusing an idempotency key with different arguments is rejected", async () => {
  const deps = createDeps();
  const baseRequest = {
    mode: "command",
    operation: "createSermon",
    idempotencyKey: "one-user-intent"
  };

  await runIdempotentSermonWorkspaceOperation(
    { ...baseRequest, arguments: { title: "First Title" } },
    deps
  );

  await assert.rejects(
    () => runIdempotentSermonWorkspaceOperation(
      { ...baseRequest, arguments: { title: "Different Title" } },
      deps
    ),
    { code: "idempotency_key_reused", statusCode: 409 }
  );
});

test("failed idempotent commands replay the structured failure", async () => {
  const deps = createDeps();
  const request = {
    mode: "command",
    operation: "createSermon",
    idempotencyKey: "missing-title",
    arguments: {}
  };

  await assert.rejects(
    () => runIdempotentSermonWorkspaceOperation(request, deps),
    { code: "missing_operation_arguments" }
  );
  await assert.rejects(
    () => runIdempotentSermonWorkspaceOperation(request, deps),
    (error) => {
      assert.equal(error.code, "missing_operation_arguments");
      assert.equal(error.details.idempotentReplay, true);
      return true;
    }
  );
});

test("stable request fingerprints ignore object key order", () => {
  assert.equal(
    stableStringify({ query: "Living Free", filters: { status: "preached", limit: 10 } }),
    stableStringify({ filters: { limit: 10, status: "preached" }, query: "Living Free" })
  );
});

test("large replay summaries preserve useful identifiers", () => {
  const summary = buildReplaySummary({
    presentation: {
      presentationId: "presentation-123",
      templateId: "template-456",
      status: "rendered",
      slideCount: 12,
      downloadUrl: "https://example.test/deck.pptx"
    }
  });

  assert.equal(summary.replaySummaryOnly, true);
  assert.equal(summary.identifiers.presentationId, "presentation-123");
  assert.equal(summary.identifiers.slideCount, 12);
});
