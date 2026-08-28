"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MEETING_FRONT_LOAD_CONTEXT,
  addMeetingFrontLoadEntry,
  buildMeetingFrontLoad,
  calculatePrepWindow,
  linkMeetingFrontLoadReference,
  prepareMeetingFrontLoad
} = require("../lib/meeting-front-load-service");

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
    projectsCollection: new FakeCollection({
      "proj-staff-meeting": {
        projectId: "proj-staff-meeting",
        name: "Staff leadership",
        lifeArea: "church",
        visibility: "private",
        ownerSub: "entra|dan",
        version: 1
      }
    }),
    tasksCollection: new FakeCollection({
      "task-open-loop": {
        taskId: "task-open-loop",
        projectId: "proj-staff-meeting",
        title: "Confirm fall training date",
        lifeArea: "church",
        status: "waiting",
        priority: "medium",
        visibility: "private",
        ownerSub: "entra|dan",
        updatedAt: "2026-08-28T15:00:00.000Z"
      }
    }),
    taskNotesCollection: new FakeCollection(),
    taskNotificationsCollection: new FakeCollection(),
    taskAccess: {
      role: "system",
      subject: "entra|dan",
      subjects: ["entra|dan"],
      name: "Dan",
      email: "dan@example.com"
    },
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-08-28T16:00:00.000Z"
  };
}

test("calculates and saves a private preparation window linked to Outlook", async () => {
  assert.deepEqual(
    calculatePrepWindow("2026-09-03T10:00:00-07:00", "America/Los_Angeles", 20),
    {
      workOnDate: "2026-09-03",
      workOnStartTime: "09:40",
      workOnEndTime: "10:00",
      workOnTimeZone: "America/Los_Angeles"
    }
  );

  const deps = createDeps();
  const result = await prepareMeetingFrontLoad({
    taskId: "task-front-load-staff-2026-09-03",
    meetingTitle: "Staff Meeting",
    meetingStartsAt: "2026-09-03T10:00:00-07:00",
    timeZone: "America/Los_Angeles",
    outlookCalendarId: "calendar-dan",
    outlookEventId: "event-staff-2026-09-03",
    outlookEventWebUrl: "https://outlook.example/events/staff-2026-09-03",
    projectId: "proj-staff-meeting",
    prepMinutes: 20
  }, deps);

  assert.equal(result.task.visibility, "private");
  assert.equal(result.task.context, MEETING_FRONT_LOAD_CONTEXT);
  assert.equal(result.task.status, "scheduled");
  assert.equal(result.task.workOnStartTime, "09:40");
  assert.equal(result.task.sourceMessageId, "event-staff-2026-09-03");
  assert.equal(result.task.outlookEventId, "");
  assert.doesNotMatch(result.task.notes, /specific prayer|counseling/i);
});

test("assembles sections, owning-system references, and related open tasks", async () => {
  const deps = createDeps();
  const created = await prepareMeetingFrontLoad({
    taskId: "task-front-load-staff-2026-09-03",
    meetingTitle: "Staff Meeting",
    meetingStartsAt: "2026-09-03T10:00:00-07:00",
    timeZone: "America/Los_Angeles",
    outlookEventId: "event-staff-2026-09-03",
    projectId: "proj-staff-meeting"
  }, deps);

  await addMeetingFrontLoadEntry({
    taskId: created.task.taskId,
    noteId: "note-purpose",
    section: "purpose",
    body: "Leave with one clear fall ministry priority."
  }, deps);
  await addMeetingFrontLoadEntry({
    taskId: created.task.taskId,
    noteId: "note-listen",
    section: "listen",
    body: "Ask where the team feels unclear."
  }, deps);
  await linkMeetingFrontLoadReference({
    taskId: created.task.taskId,
    noteId: "note-prayer-reference",
    system: "prayer_management",
    recordType: "prayer",
    recordId: "prayer-staff-unity"
  }, deps);

  const result = await buildMeetingFrontLoad({ outlookEventId: "event-staff-2026-09-03" }, deps);
  assert.equal(result.frontLoad.meeting.title, "Staff Meeting");
  assert.equal(result.frontLoad.sections.purpose[0].body, "Leave with one clear fall ministry priority.");
  assert.equal(result.frontLoad.sections.listen[0].body, "Ask where the team feels unclear.");
  assert.equal(result.frontLoad.references[0].recordId, "prayer-staff-unity");
  assert.equal(result.frontLoad.retrievalRequests[0].system, "prayer_management");
  assert.deepEqual(result.frontLoad.relatedOpenTasks.map((task) => task.taskId), ["task-open-loop"]);
  assert.ok(result.frontLoad.missingSections.includes("open_loops"));
});

test("keeps prayer and pastoral-care details out of general task notes", async () => {
  const deps = createDeps();
  const created = await prepareMeetingFrontLoad({
    meetingTitle: "Deacons Meeting",
    meetingStartsAt: "2026-09-10T18:30:00-07:00",
    timeZone: "America/Los_Angeles",
    outlookEventId: "event-deacons-2026-09-10"
  }, deps);

  await assert.rejects(
    () => linkMeetingFrontLoadReference({
      taskId: created.task.taskId,
      system: "pastoral_care",
      recordType: "care_record",
      recordId: "care-private-id",
      label: "Sensitive counseling detail"
    }, deps),
    { code: "sensitive_meeting_front_load_label_denied", statusCode: 400 }
  );
  await assert.rejects(
    () => addMeetingFrontLoadEntry({
      taskId: created.task.taskId,
      section: "prayer",
      body: "A durable prayer that belongs elsewhere"
    }, deps),
    { code: "invalid_meeting_front_load_section", statusCode: 400 }
  );
});

test("prevents duplicate preparation records for the same Outlook occurrence", async () => {
  const deps = createDeps();
  const input = {
    meetingTitle: "Staff Meeting",
    meetingStartsAt: "2026-09-03T10:00:00-07:00",
    timeZone: "America/Los_Angeles",
    outlookEventId: "event-staff-2026-09-03"
  };
  await prepareMeetingFrontLoad(input, deps);
  await assert.rejects(
    () => prepareMeetingFrontLoad(input, deps),
    { code: "task_source_already_captured", statusCode: 409 }
  );
});
