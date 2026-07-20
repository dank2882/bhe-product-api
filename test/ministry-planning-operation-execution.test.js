"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runIdempotentMinistryPlanningOperation
} = require("../lib/ministry-planning-operation-execution");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeExecutionCollection {
  constructor() {
    this.store = new Map();
  }

  doc(id) {
    return {
      get: async () => ({
        exists: this.store.has(id),
        data: () => clone(this.store.get(id))
      }),
      create: async (value) => {
        if (this.store.has(id)) {
          const error = new Error("already exists");
          error.code = 6;
          throw error;
        }
        this.store.set(id, clone(value));
      },
      set: async (value) => this.store.set(id, clone(value))
    };
  }
}

test("spreadsheet sync resolves its own source ID and idempotent retries do not sync twice", async () => {
  const executions = new FakeExecutionCollection();
  let refreshCalls = 0;
  const deps = {
    ministryPlanningOperationExecutionsCollection: executions,
    runMusicPlanningSpreadsheetRefresh: async (input) => {
      refreshCalls += 1;
      if (input.mode === "plan-only") {
        return {
          sourceImportId: "srcimp-current",
          plan: { eligibleForCommit: true },
          summary: { plan: { services: { create: 2 } } }
        };
      }
      assert.equal(input.confirmSourceImportId, "srcimp-current");
      return {
        commitResult: {
          postCommitVerification: { ok: true },
          summary: { servicesCreated: 2 }
        },
        summary: {}
      };
    }
  };
  const request = {
    mode: "command",
    operation: "syncMusicPlanningSpreadsheet",
    idempotencyKey: "sync-sheet-2026-07-15",
    arguments: {}
  };

  const first = await runIdempotentMinistryPlanningOperation(request, deps);
  const replay = await runIdempotentMinistryPlanningOperation(request, deps);

  assert.equal(first.result.synced, true);
  assert.equal(first.result.sourceImportId, "srcimp-current");
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(refreshCalls, 2);
});

test("query operations need no idempotency collection", async () => {
  const emptyCollection = {
    limit: () => ({ get: async () => ({ docs: [] }) }),
    doc: () => ({ get: async () => ({ exists: false }) })
  };
  const response = await runIdempotentMinistryPlanningOperation(
    {
      mode: "query",
      operation: "searchServices",
      arguments: { query: "last Sunday night" }
    },
    {
      servicesCollection: emptyCollection,
      serviceSongEventsCollection: emptyCollection,
      breezeImportsCollection: emptyCollection,
      sourceImportsCollection: emptyCollection,
      now: () => new Date("2026-07-15T20:00:00.000Z")
    }
  );

  assert.equal(response.result.count, 0);
  assert.equal(response.idempotency.protected, false);
});
