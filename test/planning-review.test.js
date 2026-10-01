"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const tasks = require("../lib/project-task-service");
const reviews = require("../lib/planning-review-service");
const policy = require("../lib/planning-review-policy");
function setup() {
  const db = fakeFirestore();
  return { db, deps: { firestoreDb: db, danOwnerSubjects: ["dan"], taskAccess: { subject: "dan", role: "admin", name: "Dan" },
    privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: "dan", DAN_PRIVATE_DELEGATE_SUBJECTS: "sarah" },
    projectsCollection: db.collection("projects"), tasksCollection: db.collection("tasks"), routinesCollection: db.collection("routines"),
    taskNotesCollection: db.collection("taskNotes"), taskNotificationsCollection: db.collection("notifications"),
    now: () => new Date("2026-10-02T17:00:00Z") } };
}
const project = (projectId, extra = {}) => ({ projectId, name: projectId, ownerSub: "dan", leadSub: "dan", leadName: "Dan", visibility: "private",
  outcome: "Finish this outcome", projectKind: "outcome", status: "active", version: 1, updatedAt: "2026-10-01T12:00:00Z", nextReviewDate: "2026-10-02", ...extra });
const task = (taskId, extra = {}) => ({ taskId, title: taskId, ownerSub: "dan", assignedToSub: "dan", assignedTo: "Dan", visibility: "private", status: "next", version: 1, ...extra });

test("cadence uses Pacific dates, Fridays and first weekdays across months and years", () => {
  assert.equal(policy.pacificDate("2026-10-02T02:00:00Z"), "2026-10-01");
  assert.equal(policy.nextReviewOccurrence("weekly", "2026-10-01", true), "2026-10-02");
  assert.equal(policy.nextReviewOccurrence("weekly", "2026-10-02", true), "2026-10-02");
  assert.equal(policy.nextReviewOccurrence("weekly", "2026-10-02"), "2026-10-09");
  assert.equal(policy.nextReviewOccurrence("monthly", "2026-10-01", true), "2026-10-01");
  assert.equal(policy.nextReviewOccurrence("monthly", "2026-10-02"), "2026-11-02");
  assert.equal(policy.nextReviewOccurrence("monthly", "2026-12-31"), "2027-01-01");
  assert.equal(policy.nextReviewOccurrence("monthly", "2027-04-30"), "2027-05-03");
  assert.throws(() => policy.date("2026-02-30"));
});

test("daily review surfaces paused project reviews and missed work without hiding next tasks or mutating records", async () => {
  const f = setup();
  await f.deps.projectsCollection.doc("vans").create(project("vans", { status: "paused" }));
  await f.deps.tasksCollection.doc("active").create(task("active", { projectId: "vans", priority: "low" }));
  await f.deps.tasksCollection.doc("missed").create(task("missed", { status: "scheduled", workOnDate: "2026-09-28" }));
  await f.deps.routinesCollection.doc("weekly").create({ routineId: "weekly", title: "Weekly Whole-Life Review", status: "active", reviewKind: "weekly", nextReviewDate: "2026-10-02", ownerSub: "dan", version: 1 });
  const before = structuredClone([...f.db.rows]);
  const result = await tasks.buildDailyReview({ today: "2026-10-02" }, f.deps);
  assert.equal(result.projectReviewsDue[0].projectId, "vans");
  assert.equal(result.scheduledOverdue[0].taskId, "missed");
  assert.equal(result.activeNext[0].taskId, "active");
  assert.equal(result.planningRoutinesDue[0].routineId, "weekly");
  assert.deepEqual([...f.db.rows], before);
});

test("monthly areas stay outside outcome horizons and setup is limited to five records", async () => {
  const f = setup();
  await f.deps.projectsCollection.doc("area").create(project("area", { projectKind: "area", targetDate: "", nextReviewDate: "", outcome: "" }));
  await f.deps.projectsCollection.doc("vans").create(project("vans", { status: "paused", nextReviewDate: "2026-11-15" }));
  for (let i = 0; i < 12; i++) await f.deps.projectsCollection.doc(`legacy-${i}`).create(project(`legacy-${i}`, { projectKind: "unclassified", nextReviewDate: "" }));
  const result = await reviews.buildPlanningReview({ asOfDate: "2026-10-02", period: "monthly", limit: 100 }, f.deps);
  assert.equal(result.items.find(p => p.projectId === "area").bucket, undefined);
  assert.equal(result.items.find(p => p.projectId === "area").reasons.includes("next_step_missing"), false);
  assert.equal(result.items.find(p => p.projectId === "vans").bucket, "31_90");
  assert.equal(result.planningSetup.items.length, 5);
  assert.deepEqual(result.retrievalRequests.find(r => r.source === "Intake").arguments, { status: "open", limit: 5 });
  assert.equal(result.planningSetup.totalCount, 13);
  const page = await reviews.buildPlanningReview({ asOfDate: "2026-10-02", section: "setup" }, f.deps);
  assert.equal(page.items.length, 5); assert.equal(page.complete, false);
  const next = await reviews.buildPlanningReview({ asOfDate: "2026-10-02", section: "setup", cursor: page.nextCursor }, f.deps);
  assert.equal(next.items.length, 5);
  assert.equal(new Set([...page.items, ...next.items].map(p => p.projectId)).size, 10);
});

test("waiting next steps require a party and date or explicit exception; children can supply a parent step", async () => {
  assert.equal(policy.hasNextStep(task("waiting", { status: "waiting", waitingOn: "Andrew" })), false);
  assert.equal(policy.hasNextStep(task("waiting", { status: "waiting", waitingOn: "Andrew", followUpDate: "2026-10-09" })), true);
  assert.equal(policy.hasNextStep(task("waiting", { status: "waiting", followUpDate: "2026-10-09" })), false);
  assert.equal(policy.hasNextStep(task("waiting", { status: "waiting", waitingOn: "Andrew", followUpExceptionReason: "He will bring the response to the scheduled review." })), true);
  const f = setup();
  await f.deps.projectsCollection.doc("parent").create(project("parent"));
  await f.deps.projectsCollection.doc("child").create(project("child", { parentProjectId: "parent" }));
  await f.deps.tasksCollection.doc("step").create(task("step", { projectId: "child" }));
  const r = await reviews.buildPlanningReview({ asOfDate: "2026-10-02" }, f.deps);
  assert.equal(r.items.length, 1); assert.equal(r.items[0].branchOpenTaskCount, 1); assert.equal(r.items[0].directOpenTaskCount, 0);
  assert.equal(r.items[0].reasons.includes("next_step_missing"), false);
  const attention = await reviews.buildPlanningReview({ asOfDate: "2026-10-02", section: "attention" }, f.deps);
  assert.equal(attention.items.length, 2);
});

test("parent completion preserves child dates, retains history, rejects stale competing changes and safely replays", async () => {
  const f = setup();
  await f.deps.projectsCollection.doc("parent").create(project("parent"));
  await f.deps.projectsCollection.doc("child").create(project("child", { parentProjectId: "parent" }));
  const input = { recordType: "project", recordId: "parent", expectedVersion: 1, asOfDate: "2026-10-02", nextReviewDate: "2026-10-09" };
  const result = await reviews.recordPlanningReview(input, f.deps);
  assert.equal(result.current.nextReviewDate, "2026-10-09"); assert.equal(result.readBackVerified, true);
  assert.equal((await f.deps.projectsCollection.doc("child").get()).data().nextReviewDate, "2026-10-02");
  assert.equal((await reviews.recordPlanningReview(input, f.deps)).replayed, true);
  await assert.rejects(reviews.recordPlanningReview({ ...input, nextReviewDate: "2026-10-16" }, f.deps), { code: "planning_review_version_conflict" });
  const h = await reviews.listPlanningReviewHistory({ recordType: "project", recordId: "parent" }, f.deps);
  assert.equal(h.completions.length, 1); assert.equal(h.completions[0].previousReviewDate, "2026-10-02");
});

test("late routine completion advances once and does not complete Think Tank or project reviews", async () => {
  const f = setup();
  for (const [routineId, reviewKind] of [["wholelife", "weekly"], ["think", ""]]) await f.deps.routinesCollection.doc(routineId).create({ routineId, title: routineId, reviewKind, status: "active", nextReviewDate: "2026-09-18", ownerSub: "dan", version: 1 });
  await f.deps.projectsCollection.doc("project").create(project("project"));
  const r = await reviews.recordPlanningReview({ recordType: "routine", recordId: "wholelife", expectedVersion: 1, asOfDate: "2026-10-02" }, f.deps);
  assert.equal(r.current.nextReviewDate, "2026-10-09");
  assert.equal((await f.deps.routinesCollection.doc("think").get()).data().version, 1);
  assert.equal((await f.deps.projectsCollection.doc("project").get()).data().version, 1);
  assert.equal((await reviews.listPlanningReviewHistory({ recordType: "routine", recordId: "wholelife" }, f.deps)).completions.length, 1);
});

test("whole-life review excludes other people's private details even for an administrator and honors delegation", async () => {
  const f = setup();
  await f.deps.projectsCollection.doc("dan").create(project("dan"));
  await f.deps.projectsCollection.doc("other").create(project("other", { ownerSub: "other", leadSub: "other" }));
  await f.deps.tasksCollection.doc("other-task").create(task("other-task", { projectId: "dan", ownerSub: "other", assignedToSub: "other", status: "waiting" }));
  const result = await reviews.buildPlanningReview({ asOfDate: "2026-10-02" }, f.deps);
  assert.deepEqual(result.items.map(p => p.projectId), ["dan"]); assert.equal(result.summary.waitingCount, 0);
  await assert.rejects(reviews.buildPlanningReview({ asOfDate: "2026-10-02" }, { ...f.deps, taskAccess: { subject: "outsider", role: "admin" } }), { code: "dan_private_access_denied" });
  const delegated = await reviews.buildPlanningReview({ asOfDate: "2026-10-02" }, { ...f.deps, taskAccess: { subject: "sarah", role: "admin" } });
  assert.equal(delegated.items[0].projectId, "dan");
});

test("monthly outcomes include quiet child commitments beneath areas and queries never complete reviews", async () => {
  const f = setup();
  await f.deps.projectsCollection.doc("facilities").create(project("facilities", { projectKind: "area", nextReviewDate: "2026-12-01" }));
  await f.deps.projectsCollection.doc("vehicle").create(project("vehicle", { parentProjectId: "facilities", status: "paused", nextReviewDate: "2027-03-01" }));
  const before = structuredClone([...f.db.rows]);
  const r = await reviews.buildPlanningReview({ asOfDate: "2026-10-02", period: "monthly", section: "outcomes" }, f.deps);
  assert.deepEqual(r.items.map(p => p.projectId), ["vehicle"]);
  assert.equal(r.items[0].bucket, "91_365");
  assert.equal(r.summary.horizonCounts['91_365'], 1);
  assert.deepEqual([...f.db.rows], before);
});

test("configured historical Dan task owners remain in review without including unrelated staff roots", async () => {
  const f = setup();
  f.deps.privateDelegationEnv.DAN_PRIVATE_OWNER_SUBJECTS = "dan,dan-legacy";
  await f.deps.projectsCollection.doc("legacy").create(project("legacy", { ownerSub: "dan-legacy", leadSub: "dan-legacy" }));
  await f.deps.projectsCollection.doc("other").create(project("other", { ownerSub: "other", leadSub: "other", visibility: "staff" }));
  const result = await reviews.buildPlanningReview({ asOfDate: "2026-10-02" }, f.deps);
  assert.deepEqual(result.items.map(p => p.projectId), ["legacy"]);
  const delegated = await reviews.buildPlanningReview({ asOfDate: "2026-10-02" }, { ...f.deps, taskAccess: { subject: "sarah", role: "admin" } });
  assert.deepEqual(delegated.items.map(p => p.projectId), ["legacy"]);
});

test("future completions fail; backdated routine completion schedules beyond actual today", async () => {
  const f = setup();
  await f.deps.routinesCollection.doc("weekly").create({ routineId: "weekly", title: "Weekly", ownerSub: "dan", reviewKind: "weekly", status: "active", version: 1 });
  const input = { recordType: "routine", recordId: "weekly", expectedVersion: 1 };
  await assert.rejects(reviews.recordPlanningReview({ ...input, asOfDate: "2026-10-09" }, f.deps), /future review/);
  const r = await reviews.recordPlanningReview({ ...input, asOfDate: "2026-09-18" }, f.deps);
  assert.equal(r.current.nextReviewDate, "2026-10-09");
});
