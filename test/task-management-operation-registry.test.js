"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TASK_MANAGEMENT_OPERATIONS,
  listTaskManagementOperations,
  runTaskManagementOperation
} = require("../lib/task-management-operation-registry");

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

  async create(value) {
    if (this.collection.store.has(this.id)) throw new Error("already exists");
    this.collection.store.set(this.id, clone(value));
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

function createDeps() {
  return {
    projectsCollection: new FakeCollection(),
    tasksCollection: new FakeCollection({
      "task-dinner": {
        taskId: "task-dinner",
        title: "Choose Reynolds dinner dates",
        status: "next",
        priority: "medium",
        lifeArea: "home",
        requestedBy: "Sarah",
        assignedTo: "Dan",
        updatedAt: "2026-07-21T15:00:00.000Z"
      }
    }),
    taskNotesCollection: new FakeCollection(),
    calendarEventsCollection: new FakeCollection(),
    routinesCollection: new FakeCollection(),
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-21T16:00:00.000Z"
  };
}

test("task management catalog exposes focused read and write operations", () => {
  const catalog = listTaskManagementOperations();

  assert.equal(catalog.count, TASK_MANAGEMENT_OPERATIONS.length);
  assert.deepEqual(catalog.modes, ["query", "command"]);
  assert.ok(catalog.operations.some(({ operation }) => operation === "buildDailyReview"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "addTaskNote"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "restoreRecord"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "getMyStaffProfile"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "respondToAssignment"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "updateStaffProfile"));
  assert.equal(catalog.operations.some(({ operation }) => operation === "createCalendarEvent"), false);
  assert.equal(catalog.operations.some(({ operation }) => operation === "completeTasksForPastEvents"), false);
});

test("daily review query leaves a past-event task open", async () => {
  const deps = createDeps();
  deps.tasksCollection.store.set("task-old-sermon", {
    taskId: "task-old-sermon",
    title: "Preach old sermon",
    status: "next",
    priority: "high",
    lifeArea: "church",
    eventId: "event-old-sermon",
    autoCompleteAfterEvent: true
  });
  deps.calendarEventsCollection.store.set("event-old-sermon", {
    eventId: "event-old-sermon",
    title: "Past service",
    status: "scheduled",
    endDateTime: "2026-07-20T19:00:00-07:00"
  });

  const response = await runTaskManagementOperation({
    mode: "query",
    operation: "buildDailyReview",
    arguments: { today: "2026-07-21" }
  }, deps);

  assert.equal(response.result.summary.eventCompletedTaskCount, 0);
  assert.equal(deps.tasksCollection.store.get("task-old-sermon").status, "next");
});

test("task note command appends Sarah's note", async () => {
  const deps = createDeps();
  const response = await runTaskManagementOperation({
    mode: "command",
    operation: "addTaskNote",
    arguments: {
      taskId: "task-dinner",
      body: "August 21 works for me.",
      author: "Sarah"
    }
  }, deps);

  assert.equal(response.result.note.author, "Sarah");
  assert.equal(response.result.task.noteCount, 1);
});

test("dispatcher rejects task writes in query mode", async () => {
  await assert.rejects(
    () => runTaskManagementOperation({
      mode: "query",
      operation: "updateTask",
      arguments: { taskId: "task-dinner", changes: { status: "done" } }
    }, createDeps()),
    { code: "operation_mode_mismatch", statusCode: 400 }
  );
});
