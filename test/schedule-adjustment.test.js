"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { runIdempotentTaskManagementOperation: run } = require("../lib/task-management-operation-execution");
const { getTask } = require("../lib/project-task-service");
const { listTaskManagementOperations } = require("../lib/task-management-operation-registry");
const stamp = hour => `2026-10-29T${hour}:00-07:00`;
const block = (a, b) => ({ start: stamp(a), end: stamp(b) });
async function setup(extra = []) {
  const db = fakeFirestore(); let clock = Date.parse(stamp("12:00")), key = 0;
  const task = { taskId: "task-focus", title: "A focus task", ownerSub: "dan", assignedToSub: "dan", assignedBySub: "dan", assignmentStatus: "accepted", assignedTo: "Dan", status: "scheduled", priority: "high", visibility: "private", version: 3,
    dueDate: "2026-10-30", estimatedMinutes: 45, workOnDate: "2026-10-29", workOnStartTime: "13:00", workOnEndTime: "13:45", workOnTimeZone: "America/Los_Angeles", scheduledDate: "2026-10-29", scheduledTime: "13:00", timeWindow: "old display", outlookCalendarId: "main", outlookEventId: "event-focus", outlookEventWebUrl: "https://outlook.invalid/focus", outlookSyncStatus: "synced", context: "Preserve exact context", notes: "Preserve notes", updatedAt: "2026-10-28T19:00:00.000Z" };
  for (const t of [task, ...extra]) await db.collection("tasks").doc(t.taskId).set(t);
  const deps = { firestoreDb: db, tasksCollection: db.collection("tasks"), projectsCollection: db.collection("projects"), taskManagementOperationExecutionsCollection: db.collection("executions"), taskManagementAuditEventsCollection: db.collection("audit"),
    danOwnerSubjects: ["dan", "old-dan"], taskAccess: { subject: "dan", role: "admin", name: "Dan" }, now: () => new Date(clock) };
  const event = { calendarId: "main", eventId: "event-focus", ...block("13:00", "13:45"), type: "singleInstance", isOrganizer: true, attendees: [], recurrence: null, seriesMasterId: null, isAllDay: false, cancelled: false, showAs: "busy", subject: "Focus", body: "Work on task-focus", location: "", changeKey: "v1" };
  const calendar = () => ({ status: "checked", observedAt: new Date(clock).toISOString(), ...block("12:30", "17:00"), events: [{ calendarId: "main", eventId: "event-focus", start: event.start, end: event.end, showAs: "busy" }] });
  const observation = () => ({ observedAt: new Date(clock).toISOString(), event: structuredClone(event) });
  const input = () => ({ taskId: task.taskId, expectedVersion: 3, proposedStart: stamp("15:00"), flexible: true, calendarIds: ["main"], observation: observation(), planning: { horizon: block("12:30", "17:00"), timezone: "America/Los_Angeles", workWindows: [block("13:00", "16:00")], calendar: calendar() } });
  const query = async (operation, args = {}, overrides = {}) => (await run({ operation, mode: "query", arguments: args }, { ...deps, ...overrides })).result;
  const command = async (operation, args, id = `test-intent-${++key}`) => (await run({ operation, mode: "command", arguments: args, idempotencyKey: id }, deps)).result;
  const preview = () => query("previewScheduleAdjustment", input());
  const approve = async () => { const i = input(), v = await query("previewScheduleAdjustment", i); return command("approveScheduleAdjustment", { preview: i, proposalHash: v.proposalHash, userApproved: true }); };
  const begin = async approved => { clock += 1000; return command("beginScheduleAdjustment", { adjustmentId: approved.adjustment.adjustmentId, expectedVersion: approved.adjustment.version, proposalHash: approved.adjustment.proposalHash, calendar: calendar(), observation: observation() }); };
  const record = async begun => { clock += 1000; Object.assign(event, block("15:00", "15:45"), { changeKey: "v2" }); return command("recordScheduleAdjustmentResult", { adjustmentId: begun.adjustment.adjustmentId, expectedVersion: begun.adjustment.version, outcome: "observed", observation: observation(), calendar: calendar() }); };
  const verify = async saved => { clock += 1000; return command("verifyScheduleAdjustment", { adjustmentId: saved.adjustment.adjustmentId, expectedVersion: saved.adjustment.version, observation: observation() }); };
  return { db, deps, task, event, calendar, observation, input, query, command, preview, approve, begin, record, verify, advance: ms => { clock += ms; } };
}

test("read-only preview binds exact identities/times/assumptions and keeps full accounting despite unrelated unknown effort", async () => {
  const s = await setup([{ taskId: "task-unknown", ownerSub: "dan", assignedToSub: "dan", assignmentStatus: "accepted", status: "next", estimatedMinutes: 0, version: 1 }]);
  const before = structuredClone([...s.db.rows]);
  const r = await s.preview();
  assert.equal(r.accounting.length, 2); assert.equal(r.inventoryFeasibility, "undetermined");
  assert.equal(r.adjustmentFeasibility, "fits_verified_reservation_constraints");
  assert.equal(r.proposal.taskVersion, 3); assert.equal(r.proposal.event.concurrency.changeKey, "v1");
  assert.equal(r.reservedMinutes, 45); assert.equal(r.remainingCapacityMinutes, 135);
  assert.deepEqual([...s.db.rows], before); assert.equal(r.mutationsApplied, false);
});
test("full simulated workflow uses existing task update, preserves fields, and verifies only after a second calendar read", async () => {
  const s = await setup(), before = (await getTask({ taskId: s.task.taskId }, s.deps)).task;
  const a = await s.approve(); assert.equal((await s.deps.tasksCollection.doc(s.task.taskId).get()).data().version, 3);
  const b = await s.begin(a); assert.equal(b.dispatchInstruction, "execute_once");
  assert.deepEqual(Object.keys(b.dispatch.arguments).sort(), ["calendar_id", "end", "event_id", "start"]);
  const r = await s.record(b); assert.equal(r.adjustment.state, "awaiting_final_readback");
  const t = (await getTask({ taskId: s.task.taskId }, s.deps)).task;
  assert.equal(t.version, 4); assert.equal(t.workOnStartTime, "15:00");
  for (const k of ["dueDate", "priority", "estimatedMinutes", "ownerSub", "assignedToSub", "assignmentStatus", "context", "notes", "outlookEventId", "outlookCalendarId", "outlookEventWebUrl", "status"]) assert.deepEqual(t[k], before[k], k);
  const v = await s.verify(r); assert.equal(v.adjustment.state, "verified"); assert.equal(v.calendarBackendVerified, false);
  assert.equal((await s.db.collection("taskScheduleAdjustmentLocks").get()).docs.length, 0);
});
test("approval is exact, explicit and owner-only, without delegated or administrator bypass", async () => {
  const s = await setup(), i = s.input(), v = await s.preview();
  await assert.rejects(s.command("approveScheduleAdjustment", { preview: i, proposalHash: v.proposalHash, userApproved: false }), { code: "schedule_adjustment_approval_required" });
  i.proposedStart = stamp("14:00");
  await assert.rejects(s.command("approveScheduleAdjustment", { preview: i, proposalHash: v.proposalHash, userApproved: true }), { code: "schedule_adjustment_stale" });
  await assert.rejects(s.query("previewScheduleAdjustment", s.input(), { taskAccess: { subject: "sarah", role: "admin" }, privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: "dan", DAN_PRIVATE_DELEGATE_SUBJECTS: "sarah" } }), { code: "schedule_adjustment_owner_only" });
});
test("shared event links are excluded even when another task is completed or outside personal visibility", async () => {
  const s = await setup([{ taskId: "task-other", ownerSub: "other", assignedToSub: "other", status: "done", outlookCalendarId: "main", outlookEventId: "event-focus" }]);
  await assert.rejects(s.preview(), { code: "schedule_adjustment_shared_block" });
});
test("recurrences, attendees, missing metadata and event bodies containing a second task are excluded", async () => {
  for (const change of [{ type: "occurrence" }, { attendees: [{ emailAddress: { address: "someone@example.com" } }] }, { recurrence: undefined }, { body: "task-focus and task-other" }, { isOrganizer: false }]) {
    const s = await setup(); Object.assign(s.event, change); await assert.rejects(s.preview());
  }
});
test("multiple task-context sessions and task/event time mismatches are excluded", async () => {
  const s = await setup();
  await s.deps.tasksCollection.doc(s.task.taskId).update({ context: "https://outlook.test/?itemid=one&x=1 https://outlook.test/?itemid=two&x=1" });
  await assert.rejects(s.preview(), { code: "schedule_adjustment_multiple_links" });
  await s.deps.tasksCollection.doc(s.task.taskId).update({ context: "", workOnStartTime: "13:15" });
  await assert.rejects(s.preview(), { code: "schedule_adjustment_link_mismatch" });
});
test("protected commitments, windows, incomplete coverage and selected deadline are checked", async () => {
  const s = await setup();
  let i = s.input(); i.planning.calendar.events.push({ calendarId: "main", eventId: "meeting", ...block("15:30", "16:00") });
  await assert.rejects(s.query("previewScheduleAdjustment", i), { code: "schedule_adjustment_capacity_conflict" });
  i = s.input(); i.proposedStart = stamp("15:30"); await assert.rejects(s.query("previewScheduleAdjustment", i), { code: "schedule_adjustment_capacity_conflict" });
  i = s.input(); i.planning.calendar.status = "limited"; await assert.rejects(s.query("previewScheduleAdjustment", i), { code: "schedule_adjustment_calendar_incomplete" });
  await s.deps.tasksCollection.doc(s.task.taskId).update({ dueDate: "2026-10-28" }); await assert.rejects(s.preview(), { code: "schedule_adjustment_deadline_risk" });
});
test("selected unknown or excessive effort remains an explicit risk; duration is never enlarged or marked complete", async () => {
  const s = await setup();
  for (const estimatedMinutes of [0, 90]) {
    await s.deps.tasksCollection.doc(s.task.taskId).update({ estimatedMinutes });
    const r = await s.preview(); assert.equal(r.reservedMinutes, 45); assert.match(r.risks[0], /unknown|exceeds/); assert.equal(r.proposal.taskChanges.estimatedMinutes, undefined);
  }
});
test("stale task, event content, provider version, coverage and approvals reject before dispatch", async () => {
  for (const kind of ["task", "event", "etag", "coverage", "expiry"]) {
    const s = await setup(), a = await s.approve();
    if (kind === "task") await s.deps.tasksCollection.doc(s.task.taskId).update({ version: 4, priority: "low" });
    if (kind === "event") s.event.subject = "Changed title";
    if (kind === "etag") s.event.changeKey = "other";
    if (kind === "expiry") s.advance(901000);
    if (kind === "coverage") {
      const c = s.calendar(); c.observedAt = "2026-10-29T18:00:00.000Z";
      await assert.rejects(s.command("beginScheduleAdjustment", { adjustmentId: a.adjustment.adjustmentId, expectedVersion: 1, proposalHash: a.adjustment.proposalHash, calendar: c, observation: s.observation() }));
    } else await assert.rejects(s.begin(a));
    assert.equal((await s.deps.tasksCollection.doc(s.task.taskId).get()).data().workOnStartTime, "13:00");
  }
});
test("begin replay and two approved proposals cannot dispatch an event twice", async () => {
  const s = await setup(), a = await s.approve(), other = await s.approve(), b = await s.begin(a);
  assert.equal(b.dispatchInstruction, "execute_once");
  const replay = await s.begin(a); assert.equal(replay.dispatchInstruction, "reconcile_only"); assert.equal(replay.dispatch, undefined);
  await assert.rejects(s.begin(other), { code: "schedule_adjustment_locked" });
});
test("an unknown calendar outcome remains durable and can be reconciled without repeating the calendar write", async () => {
  const s = await setup(), b = await s.begin(await s.approve());
  const r = await s.command("recordScheduleAdjustmentResult", { adjustmentId: b.adjustment.adjustmentId, expectedVersion: b.adjustment.version, outcome: "unknown" });
  assert.equal(r.adjustment.state, "reconciliation_required"); assert.equal(r.adjustment.taskAttemptedAt, null);
  assert.equal((await s.deps.tasksCollection.doc(s.task.taskId).get()).data().version, 3);
  const recovered = await s.record(r); assert.equal(recovered.adjustment.state, "awaiting_final_readback");
});
test("calendar success followed by a task edit retains the partial result and never overwrites that edit", async () => {
  const s = await setup(), b = await s.begin(await s.approve());
  await s.deps.tasksCollection.doc(s.task.taskId).update({ version: 4, priority: "low" });
  const r = await s.record(b);
  assert.equal(r.adjustment.state, "reconciliation_required"); assert(r.adjustment.calendarEvidence); assert.equal(r.adjustment.taskAttemptedAt, null);
  const task = (await s.deps.tasksCollection.doc(s.task.taskId).get()).data(); assert.equal(task.priority, "low"); assert.equal(task.workOnStartTime, "13:00");
});
test("unexpected calendar content or cancellation is preserved as mismatch evidence and cannot update task", async () => {
  for (const change of [{ subject: "Unapproved subject" }, { cancelled: true }]) {
    const s = await setup(), b = await s.begin(await s.approve()); Object.assign(s.event, change);
    const r = await s.record(b); assert.equal(r.adjustment.issue, "calendar_readback_mismatch"); assert(r.adjustment.calendarEvidence); assert.equal(r.adjustment.taskAttemptedAt, null);
  }
});
test("lost task-update response is resolved by readback, without another update", async () => {
  const s = await setup(), b = await s.begin(await s.approve());
  const original = s.deps.taskManagementAuditEventsCollection;
  s.deps.taskManagementAuditEventsCollection = { doc: () => ({ create: async () => { throw new Error("response lost after task commit"); } }) };
  const r = await s.record(b); assert.equal(r.adjustment.state, "awaiting_final_readback");
  s.deps.taskManagementAuditEventsCollection = original;
  const v = await s.verify(r); assert.equal(v.adjustment.state, "verified"); assert.equal((await s.deps.tasksCollection.doc(s.task.taskId).get()).data().version, 4);
});
test("task failure locks the attempt; repeating evidence cannot blindly retry it", async () => {
  const s = await setup(), b = await s.begin(await s.approve());
  s.deps.taskManagementOperationExecutionsCollection = undefined;
  const r = await s.record(b); assert.equal(r.adjustment.state, "reconciliation_required"); assert(r.adjustment.taskAttemptedAt);
  s.deps.taskManagementOperationExecutionsCollection = s.db.collection("executions");
  const again = await s.record(r); assert.equal(again.adjustment.state, "reconciliation_required"); assert.equal((await s.deps.tasksCollection.doc(s.task.taskId).get()).data().version, 3);
});
test("final verification cannot hide changed deadlines or changed calendar times", async () => {
  const s = await setup(), r = await s.record(await s.begin(await s.approve()));
  await s.deps.tasksCollection.doc(s.task.taskId).update({ dueDate: "2026-11-01", version: 5 });
  const v = await s.verify(r); assert.equal(v.adjustment.state, "reconciliation_required");
  assert.equal((await s.db.collection("taskScheduleAdjustmentLocks").get()).docs.length, 2);
});
test("live catalog clearly separates read-only preview, approval and execution", () => {
  const operations = listTaskManagementOperations({ query: "ScheduleAdjustment" }).operations;
  assert.equal(operations.length, 7); assert.equal(operations.find(o => o.operation === "previewScheduleAdjustment").mode, "query");
  assert.equal(operations.find(o => o.operation === "approveScheduleAdjustment").confirmationPolicy, "explicit_user_approval");
});

test("simultaneous begins permit only one calendar dispatch", async () => {
  const s = await setup(), a = await s.approve();
  const results = await Promise.allSettled([s.begin(a), s.begin(a)]);
  assert.equal(results.filter(r => r.status === "fulfilled" && r.value.dispatchInstruction === "execute_once").length, 1);
});
test("a new conflict after calendar success keeps evidence and prevents the task leg", async () => {
  const s = await setup(), b = await s.begin(await s.approve());
  s.advance(1000); Object.assign(s.event, block("15:00", "15:45"));
  const calendar = s.calendar(); calendar.events.push({ calendarId: "main", eventId: "new-meeting", ...block("15:15", "16:00") });
  const r = await s.command("recordScheduleAdjustmentResult", { adjustmentId: b.adjustment.adjustmentId, expectedVersion: b.adjustment.version, outcome: "observed", observation: s.observation(), calendar });
  assert.equal(r.adjustment.state, "reconciliation_required"); assert(r.adjustment.calendarEvidence); assert.equal(r.adjustment.taskAttemptedAt, null);
});
test("final verification rejects an Outlook observation made before the task leg", async () => {
  const s = await setup(), b = await s.begin(await s.approve()), old = s.observation(), r = await s.record(b);
  Object.assign(old.event, block("15:00", "15:45"));
  await assert.rejects(s.command("verifyScheduleAdjustment", { adjustmentId: r.adjustment.adjustmentId, expectedVersion: r.adjustment.version, observation: old }), { code: "schedule_adjustment_stale" });
});
