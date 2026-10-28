"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { buildPlan, localInstant, subtract } = require("../lib/capacity-planning-policy");
const { runTaskManagementOperation, listTaskManagementOperations } = require("../lib/task-management-operation-registry");
const { buildCapacityPlan } = require("../lib/capacity-planning-service");

const now = Date.parse("2026-10-28T15:59:00Z");
const stamp = h => `2026-10-28T${h}:00:00-07:00`;
const block = (a, b) => ({ start: stamp(a), end: stamp(b) });
function input(extra = {}) {
  return { horizon: block("09", "17"), timezone: "America/Los_Angeles", workWindows: [block("09", "12"), block("13", "17")],
    calendar: { status: "checked", observedAt: new Date(now).toISOString(), ...block("09", "17"), events: [] }, ...extra };
}
const task = (id, extra = {}) => ({ taskId: id, title: id, version: 2, ownerSub: "dan", assignedToSub: "dan", assignedTo: "Dan", visibility: "private", assignmentStatus: "accepted", status: "next", priority: "medium", estimatedMinutes: 60, disposition: "work", ...extra });
const planned = (id, extra = {}) => task(id, { status: "scheduled", workOnDate: "2026-10-28", workOnStartTime: "09:00", workOnEndTime: "10:00", workOnTimeZone: "America/Los_Angeles", outlookEventId: `event-${id}`, outlookCalendarId: "main", outlookSyncStatus: "synced", ...extra });
const event = (id, a = "09", b = "10", extra = {}) => ({ eventId: `event-${id}`, calendarId: "main", ...block(a, b), showAs: "busy", ...extra });
const result = (tasks, extra = {}) => buildPlan(input(extra), tasks, now);
const first = (tasks, extra) => result(tasks, extra).alternatives[0];

test("calendar union uses half-open intervals without double-counting or losing breaks", () => {
  assert.deepEqual(subtract([{ start: 0, end: 100 }], [{ start: 10, end: 30 }, { start: 20, end: 40 }, { start: 40, end: 50 }]), [{ start: 0, end: 10 }, { start: 50, end: 100 }]);
  const calendar = input().calendar; calendar.events = [event("a", "09", "11"), event("b", "10", "12"), event("c", "12", "13")];
  const r = first([task("a")], { calendar });
  assert.equal(r.availableBeforePlanningMinutes, 240);
  assert.equal(r.accounting[0].block.start, "2026-10-28T20:00:00.000Z");
  assert.equal(r.remainingCapacityMinutes, 180);
});

test("deadline then priority ordering is stable and every responsibility appears", () => {
  const tasks = [task("z", { priority: "low" }), task("a", { priority: "high" }), task("deadline", { dueDate: "2026-10-28", priority: "low" })];
  const a = first(tasks), b = first([...tasks].reverse());
  const allocations = x => Object.fromEntries(x.accounting.map(t => [t.taskId, t.block]));
  assert.deepEqual(allocations(a), allocations(b));
  assert.equal(a.accounting.find(t => t.taskId === "deadline").block.start, "2026-10-28T16:00:00.000Z");
  assert.equal(a.feasibility, "fits_supplied_constraints");
  assert.equal(a.accounting.length, 3);
});

test("missing estimate, waiting and delegated responsibilities stay visible", () => {
  const r = first([task("missing", { estimatedMinutes: 0 }), task("waiting", { disposition: "waiting", status: "waiting" }), task("delegated", { disposition: "delegated", assignedToSub: "other" })]);
  assert.equal(r.feasibility, "undetermined");
  assert.deepEqual(r.accounting.map(t => t.state), ["needs_information", "waiting", "delegated"]);
  assert.equal(r.changes.length, 0);
  assert.equal(r.remainingCapacityMinutes, 420);
});

test("free/cancelled calendar entries do not block, tentative meetings do", () => {
  const calendar = input().calendar;
  calendar.events = [event("free", "09", "17", { showAs: "free" }), event("cancelled", "09", "17", { cancelled: true }), event("tentative", "09", "10", { showAs: "tentative" })];
  const r = result([task("a")], { calendar });
  assert.equal(r.alternatives[0].availableBeforePlanningMinutes, 360);
  assert.equal(r.calendarClassification.at(-1).classification, "protected");
});

test("linked work is reserved once and unchanged links/versions are preserved", () => {
  const calendar = input().calendar; calendar.events = [event("a")];
  const r = first([planned("a"), task("b")], { calendar });
  assert.equal(r.availableBeforePlanningMinutes, 360);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].taskId, "b");
  assert.equal(r.accounting[0].version, 2);
  assert.equal(r.conflicts.length, 0);
});

test("one selected flexible block can move; displaced work is recovered and explained", () => {
  const calendar = input().calendar; calendar.events = [event("a")];
  const r = result([planned("a")], { calendar, flexibleTaskIds: ["a"], workWindows: [block("09", "12"), block("13", "14")],
    proposal: { kind: "new_task", title: "New responsibility", estimatedMinutes: 180, priority: "high", dueDate: "2026-10-28" } });
  assert.equal(r.alternatives.length, 2);
  assert.equal(r.alternatives[0].feasibility, "not_feasible");
  const alternate = r.alternatives[1];
  assert.equal(alternate.feasibility, "fits_supplied_constraints");
  assert.equal(alternate.movedExistingBlocks, 1);
  const moved = alternate.changes.find(c => c.taskId === "a");
  assert.equal(moved.outlookEventId, "event-a");
  assert.equal(moved.expectedVersion, 2);
  assert.equal(moved.after.start, "2026-10-28T20:00:00.000Z");
  assert.equal(moved.requiresDanApproval, true);
  assert.equal(r.applySupported, false);
});

test("no alternative silently loses displaced work or claims overflow is feasible", () => {
  const calendar = input().calendar; calendar.events = [event("a")];
  const r = result([planned("a")], { calendar, flexibleTaskIds: ["a"], workWindows: [block("09", "12")],
    proposal: { kind: "new_task", title: "Too much", estimatedMinutes: 180, priority: "high" } });
  const alternate = r.alternatives[1];
  assert.equal(alternate.feasibility, "not_feasible");
  assert.equal(alternate.accounting.find(t => t.taskId === "a").state, "unplaced");
  assert.equal(alternate.accounting.length, 2);
});

test("reschedule checks version and reports fixed-event conflicts without moving them", () => {
  const calendar = input().calendar; calendar.events = [event("a"), event("meeting", "10", "11")];
  const proposal = { kind: "reschedule", taskId: "a", expectedVersion: 2, start: stamp("10") };
  const r = first([planned("a")], { calendar, proposal });
  assert.equal(r.feasibility, "not_feasible");
  assert.equal(r.conflicts[0].with.eventId, "event-meeting");
  assert.equal(r.accounting[0].state, "unplaced");
  assert.throws(() => first([planned("a")], { calendar, proposal: { ...proposal, expectedVersion: 1 } }), { code: "task_version_conflict" });
});

test("stale, shared and mismatched Outlook links cannot be moved", () => {
  const calendar = input().calendar; calendar.events = [event("a", "10", "11")];
  const r = first([planned("a")], { calendar });
  assert(r.risks.some(r => r.reason === "outlook_link_needs_reconciliation"));
  assert.notEqual(r.feasibility, "fits_supplied_constraints");
  assert.throws(() => result([planned("a")], { calendar, flexibleTaskIds: ["a"] }), { code: "capacity_plan_task_not_movable" });
  calendar.events = [event("a")];
  assert.throws(() => result([planned("a"), planned("b", { outlookEventId: "event-a" })], { calendar, flexibleTaskIds: ["a"] }), { code: "capacity_plan_task_not_movable" });
});

test("existing task conflicts and underallocation prevent a feasible result", () => {
  const calendar = input().calendar; calendar.events = [event("meeting")];
  const r = first([planned("a", { outlookEventId: "", estimatedMinutes: 120 })], { calendar });
  assert.equal(r.feasibility, "not_feasible");
  assert(r.conflicts.length);
  assert(r.risks.some(r => r.reason === "planned_block_shorter_than_estimate"));
});

test("deadlines use local dates; overdue and preserved late blocks are flagged", () => {
  const r = first([task("overdue", { dueDate: "2026-10-27" }), planned("late", { dueDate: "2026-10-27", outlookEventId: "" })]);
  assert.equal(r.feasibility, "not_feasible");
  assert(r.accounting.every(t => t.issues.includes("deadline_at_risk")));
  assert.equal(r.accounting[0].state, "unplaced");
});

test("future date-only work remains beyond horizon and dates are never silently changed", () => {
  const r = first([task("future", { status: "scheduled", workOnDate: "2026-11-01" }), task("today", { workOnDate: "2026-10-28" })]);
  assert.equal(r.accounting[0].state, "beyond_horizon");
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].taskId, "today");
});

test("date-only work respects its saved timezone near another zone's midnight", () => {
  const horizon = { start: "2026-10-28T23:00:00-07:00", end: "2026-10-29T00:00:00-07:00" };
  const calendar = { ...input().calendar, ...horizon };
  const r = first([task("east", { workOnDate: "2026-10-29", workOnTimeZone: "America/New_York" })], { horizon, calendar, workWindows: [horizon] });
  assert.equal(r.accounting[0].state, "planned");
  assert.equal(r.feasibility, "fits_supplied_constraints");
});

test("empty windows mean no capacity; unknown calendar never yields an all-clear", () => {
  assert.equal(first([task("a")], { workWindows: [] }).feasibility, "not_feasible");
  for (const calendar of [
    { status: "unavailable", events: [] },
    { ...input().calendar, status: "limited" },
    { ...input().calendar, observedAt: "2026-10-28T15:00:00Z" },
    { ...input().calendar, observedAt: "2026-10-28T16:00:00Z" },
    { ...input().calendar, end: stamp("12") }
  ]) assert.equal(first([task("a")], { calendar }).feasibility, "undetermined");
});

test("calendar conflicts surface even without tasks; do not propose needless reshuffling", () => {
  const calendar = input().calendar; calendar.events = [event("one", "09", "11"), event("two", "10", "12")];
  const r = first([], { calendar });
  assert.equal(r.feasibility, "not_feasible");
  assert.equal(r.conflicts[0].event.eventId, "event-one");
  calendar.events = [event("a")];
  const plan = result([planned("a")], { calendar, flexibleTaskIds: ["a"], proposal: { kind: "new_task", title: "Fits already", priority: "high", estimatedMinutes: 60 } });
  assert.equal(plan.alternatives.length, 1);
  assert.equal(plan.alternatives[0].movedExistingBlocks, 0);
});

test("dense conflicts have explicit counts and bounded detail, never a false all-clear", () => {
  const calendar = input().calendar;
  calendar.events = Array.from({ length: 12 }, (_, i) => event(String(i)));
  const r = first([], { calendar });
  assert.equal(r.feasibility, "not_feasible");
  assert.equal(r.conflictCount, 66);
  assert.equal(r.conflicts.length, 50);
  assert.equal(r.conflictsTruncated, true);
});

test("waiting or unresolved assignments retain their saved time reservations", () => {
  const r = first([planned("waiting", { disposition: "waiting", outlookEventId: "" }), task("new")]);
  assert.equal(r.accounting.find(t => t.taskId === "waiting").state, "waiting");
  assert.equal(r.accounting.find(t => t.taskId === "new").block.start, "2026-10-28T17:00:00.000Z");
});

test("no feasible plan overlaps a commitment, leaves work out, or exceeds explicit windows", () => {
  // Deterministic scenario sweep exercises arithmetic independently of ranking.
  for (let duration = 15; duration <= 180; duration += 15) {
    const calendar = input().calendar; calendar.events = [event("meeting", "10", "11"), event("meeting2", "14", "15")];
    const tasks = Array.from({ length: 6 }, (_, i) => task(`work-${i}`, { estimatedMinutes: duration, priority: i % 2 ? "high" : "low" }));
    const r = first(tasks, { calendar });
    assert.equal(new Set(r.accounting.map(t => t.taskId)).size, tasks.length);
    const blocks = r.accounting.filter(t => t.block).map(t => t.block);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i], start = Date.parse(b.start), end = Date.parse(b.end);
      assert.equal((end - start) / 60000, duration);
      assert(input().workWindows.some(w => Date.parse(w.start) <= start && Date.parse(w.end) >= end));
      assert(calendar.events.every(e => end <= Date.parse(e.start) || start >= Date.parse(e.end)));
      assert(blocks.slice(i + 1).every(other => end <= Date.parse(other.start) || start >= Date.parse(other.end)));
    }
    if (r.feasibility === "fits_supplied_constraints") assert.equal(blocks.length, tasks.length);
    assert(r.remainingCapacityMinutes >= 0);
  }
});

test("DST conversion round-trips and refuses ambiguous/nonexistent local times", () => {
  assert.equal(new Date(localInstant("2026-11-01", "09:00", "America/Los_Angeles")).toISOString(), "2026-11-01T17:00:00.000Z");
  assert.equal(new Date(localInstant("2026-10-31", "09:00", "America/Los_Angeles")).toISOString(), "2026-10-31T16:00:00.000Z");
  assert.throws(() => localInstant("2026-11-01", "01:30", "America/Los_Angeles"), /Ambiguous/);
  assert.throws(() => localInstant("2026-03-08", "02:30", "America/Los_Angeles"), /nonexistent/);
  const r = first([planned("unknown-zone", { workOnTimeZone: "", outlookEventId: "" })]);
  assert.equal(r.feasibility, "undetermined");
});

test("all-day events block actual elapsed intervals and recurrence instances stay separate", () => {
  const calendar = input().calendar;
  calendar.events = [{ eventId: "occurrence-1", calendarId: "main", start: "2026-10-28T00:00:00-07:00", end: "2026-10-29T00:00:00-07:00" }];
  assert.equal(first([task("a")], { calendar }).remainingCapacityMinutes, 0);
  calendar.events.push({ ...calendar.events[0] });
  assert.throws(() => first([], { calendar }), /Duplicate/);
});

test("past, overlapping and unbounded windows are rejected; no fabricated estimates", () => {
  assert.throws(() => first([], { workWindows: [block("09", "11"), block("10", "12")] }), /disjoint/);
  assert.throws(() => first([], { horizon: block("08", "17") }), /future horizon/);
  assert.throws(() => first([], { proposal: { kind: "new_task", title: "Unknown", priority: "high" } }), /effort/);
  assert.throws(() => first([], { timezone: "not-a-zone" }), /timezone/);
  assert.throws(() => first([], { approved: true }), /Unexpected/);
});

async function setup(records = []) {
  const db = fakeFirestore();
  for (const t of records) await db.collection("tasks").doc(t.taskId).set(t);
  return { db, deps: { tasksCollection: db.collection("tasks"), projectsCollection: db.collection("projects"),
    danOwnerSubjects: ["dan", "old-dan"], taskAccess: { subject: "dan", name: "Dan", role: "admin" },
    privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: "dan,old-dan", DAN_PRIVATE_DELEGATE_SUBJECTS: "sarah" }, now: () => new Date(now) } };
}

test("registered query reads owning records, preserves delegation, and writes nothing", async () => {
  const { db, deps } = await setup([task("mine"), task("delegated", { assignedToSub: "other" }), task("pending", { assignmentStatus: "proposed" }), task("legacy", { ownerSub: "old-dan", assignedToSub: "old-dan" }), task("done", { status: "done" }), task("other", { ownerSub: "other", assignedToSub: "other" }), task("maintenance", { teamId: "maintenance" })]);
  const before = structuredClone([...db.rows]);
  const r = await runTaskManagementOperation({ mode: "query", operation: "buildCapacityPlan", arguments: input() }, deps);
  const rows = r.result.alternatives[0].accounting;
  assert.deepEqual(rows.map(t => t.taskId).sort(), ["delegated", "legacy", "mine", "pending"]);
  assert.equal(rows.find(t => t.taskId === "delegated").state, "delegated");
  assert.equal(rows.find(t => t.taskId === "pending").state, "pending_assignment");
  assert.deepEqual([...db.rows], before);
  assert.equal(listTaskManagementOperations({ query: "buildCapacityPlan" }).operations[0].mode, "query");
  await assert.rejects(runTaskManagementOperation({ mode: "command", operation: "buildCapacityPlan", arguments: input() }, deps), { code: "operation_mode_mismatch" });
});

test("backend access is exact; delegate sees Dan's plan without including their own work", async () => {
  const { deps } = await setup([task("mine"), task("sarah", { ownerSub: "sarah", assignedToSub: "sarah" })]);
  const delegated = await buildCapacityPlan(input(), { ...deps, taskAccess: { subject: "sarah", role: "admin" } });
  assert.deepEqual(delegated.alternatives[0].accounting.map(t => t.taskId), ["mine"]);
  await assert.rejects(buildCapacityPlan(input(), { ...deps, taskAccess: { subject: "outsider", role: "admin" } }), { code: "dan_private_access_denied" });
  await assert.rejects(buildCapacityPlan(input({ flexibleTaskIds: ["sarah"] }), deps), { code: "capacity_plan_task_not_movable" });
});

test("complete inventory crosses storage page boundary, with no response-list truncation", async () => {
  const records = Array.from({ length: 510 }, (_, i) => task(`other-${i}`, { ownerSub: "other", assignedToSub: "other" }));
  records.push(task("z-mine"));
  const { deps } = await setup(records);
  const r = await buildCapacityPlan(input(), deps);
  assert.deepEqual(r.alternatives[0].accounting.map(t => t.taskId), ["z-mine"]);
});

test("legacy name-matched personal work is accounted for as unresolved, never silently omitted", async () => {
  const { deps } = await setup([task("legacy", { ownerSub: "", assignedToSub: "", assignedTo: "Dan" })]);
  const r = await buildCapacityPlan(input(), deps);
  assert.equal(r.alternatives[0].accounting[0].state, "identity_unresolved");
  assert.equal(r.alternatives[0].feasibility, "undetermined");
});
