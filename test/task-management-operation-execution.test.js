"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runIdempotentTaskManagementOperation
} = require("../lib/task-management-operation-execution");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
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

test("idempotent retry does not append a task note twice", async () => {
  const deps = {
    tasksCollection: new FakeCollection({
      "task-one": {
        taskId: "task-one",
        title: "One task",
        status: "next",
        lifeArea: "home"
      }
    }),
    taskNotesCollection: new FakeCollection(),
    taskManagementOperationExecutionsCollection: new FakeCollection(),
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-21T16:00:00.000Z"
  };
  const request = {
    mode: "command",
    operation: "addTaskNote",
    idempotencyKey: "task-one-sarah-note-2026-07-21",
    arguments: {
      taskId: "task-one",
      body: "Please pick this up tonight.",
      author: "Sarah"
    }
  };

  const first = await runIdempotentTaskManagementOperation(request, deps);
  const replay = await runIdempotentTaskManagementOperation(request, deps);

  assert.equal(first.result.task.noteCount, 1);
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(deps.taskNotesCollection.store.size, 1);
});
