"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const service = require("../lib/project-task-service");
const { buildPlanningReview } = require("../lib/planning-review-service");
const maintenance = require("../lib/maintenance-service");

async function fixture() {
  const db = fakeFirestore();
  const deps = { danOwnerSubjects: ["dan", "old-dan"], privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: "dan,old-dan", DAN_PRIVATE_DELEGATE_SUBJECTS: "sarah" },
    taskAccess: { subject: "dan", subjects: ["old-dan"], name: "Dan", role: "admin" }, now: () => "2026-10-01T18:00:00Z" };
  for (const name of ["projects", "tasks", "routines", "taskNotifications"]) deps[`${name}Collection`] = db.collection(name);
  const project = { name: "Maintenance", status: "active", projectKind: "area", ownerSub: "dan", createdBySub: "dan", leadSub: "shawna", visibility: "branch", collaborationPolicy: "editor_archive_owner_delete", branchMembers: [{ subject: "shawna", role: "editor" }], maintenanceManagers: ["shawna"], nextReviewDate: "2026-09-01", version: 1 };
  await deps.projectsCollection.doc("proj-fbc-maintenance").set({ ...project, projectId: "proj-fbc-maintenance" });
  await deps.projectsCollection.doc("child").set({ ...project, projectId: "child", parentProjectId: "proj-fbc-maintenance", leadSub: "old-dan", projectKind: "outcome" });
  await deps.projectsCollection.doc("own").set({ ...project, projectId: "own", name: "Personal outcome", parentProjectId: "", visibility: "private", leadSub: "dan", projectKind: "outcome" });
  const task = { title: "Repair", projectId: "child", visibility: "branch", status: "next", ownerSub: "old-dan", createdBySub: "dan", assignedBySub: "dan", assignedToSub: "dan", dueDate: "2026-09-01", priority: "high", version: 1 };
  for (let i = 0; i < 105; i++) await deps.tasksCollection.doc(`repair-${i}`).set({ ...task, taskId: `repair-${i}`, assignedToSub: i % 2 ? "worker" : "dan" });
  await deps.tasksCollection.doc("repair-waiting").set({ ...task, taskId: "repair-waiting", status: "waiting", followUpDate: "2026-09-01" });
  await deps.tasksCollection.doc("repair-scheduled").set({ ...task, taskId: "repair-scheduled", status: "scheduled", workOnDate: "2026-09-01" });
  await deps.tasksCollection.doc("legacy-team-only").set({ ...task, taskId: "legacy-team-only", projectId: "", visibility: "staff", teamId: "maintenance" });
  await deps.tasksCollection.doc("personal").set({ ...task, taskId: "personal", projectId: "own", visibility: "private", ownerSub: "dan" });
  await deps.tasksCollection.doc("delegated").set({ ...task, taskId: "delegated", title: "Real delegation", projectId: "own", visibility: "staff", ownerSub: "worker", createdBySub: "worker", assignedToSub: "worker", assignedBySub: "dan" });
  await deps.tasksCollection.doc("waiting-delegated").set({ ...task, taskId: "waiting-delegated", projectId: "own", visibility: "staff", ownerSub: "worker", createdBySub: "worker", assignedToSub: "worker", assignedBySub: "dan", status: "waiting", followUpDate: "2026-09-01" });
  await deps.routinesCollection.doc("maintenance-routine").set({ routineId: "maintenance-routine", title: "Maintenance duty", projectId: "child", visibility: "branch", ownerSub: "dan", status: "active", version: 1 });
  await deps.routinesCollection.doc("personal-routine").set({ routineId: "personal-routine", title: "Personal review", ownerSub: "dan", status: "active", visibility: "private", version: 1 });
  for (const taskId of ["repair-0", "delegated"]) await deps.taskNotificationsCollection.doc(taskId).set({ notificationId: taskId, recipientSub: "dan", taskId, createdAt: "2026-10-01" });
  return { db, deps };
}

test("Dan personal lists and every review exclude the handed-off branch, preserve delegation and never mutate records", async () => {
  const { db, deps } = await fixture(), before = structuredClone([...db.rows]);
  const listed = await service.listTasks({ limit: 2 }, deps);
  assert.equal(listed.scope, "personal");
  assert.equal(listed.hasMore, true);
  const second = await service.listTasks({ limit: 2, cursor: listed.nextCursor }, deps);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...listed.tasks, ...second.tasks].map(t => t.taskId)).size, 3);
  assert.deepEqual((await service.listProjects({}, deps)).projects.map(p => p.projectId), ["own"]);
  assert.deepEqual((await service.listRoutines({}, deps)).routines.map(r => r.routineId), ["personal-routine"]);
  const daily = await service.buildDailyReview({ today: "2026-10-01" }, deps);
  assert.deepEqual(new Set(daily.activeNext.map(t => t.taskId)), new Set(["personal", "delegated"]));
  assert.equal(daily.summary.openTaskCount, 3);
  assert.equal(daily.summary.activeNextCount, 2);
  assert.equal(daily.followUpDue[0].taskId, "waiting-delegated");
  assert.deepEqual(daily.notifications.map(n => n.taskId), ["delegated"]);
  assert.equal(daily.summary.unreadNotificationCount, 1);
  assert(!JSON.stringify(daily).includes('"child"'));
  for (const period of ["weekly", "monthly"]) for (const section of ["overview", "outcomes", "areas", "attention", "setup", "waiting"]) {
    const review = await buildPlanningReview({ period, section, asOfDate: "2026-10-01" }, deps);
    assert.equal(review.summary.openProjectCount, 1);
    assert.equal(review.summary.waitingCount, 1);
    assert(!JSON.stringify(review).includes('"child"'));
    assert(!JSON.stringify(review).includes('"proj-fbc-maintenance"'));
  }
  assert.deepEqual([...db.rows], before);
});

test("Shawna and explicit shared board lookups retain complete Maintenance access; aliases and private delegates do not reintroduce it", async () => {
  const { deps } = await fixture();
  for (const subject of ["old-dan", "sarah"]) {
    const scoped = { ...deps, taskAccess: { subject, name: subject, role: "admin" } };
    assert.equal((await service.listTasks({ limit: 100 }, scoped)).count, 3);
    assert.equal((await buildPlanningReview({ asOfDate: "2026-10-01" }, scoped)).summary.openProjectCount, 1);
  }
  for (const subject of ["dan", "shawna"]) {
    const scoped = { ...deps, taskAccess: { subject, role: "member" } };
    const board = await maintenance.listMaintenanceBoard({ limit: 100 }, scoped);
    assert.equal(board.totalCount, 107);
    const next = await maintenance.listMaintenanceBoard({ limit: 100, cursor: board.nextCursor }, scoped);
    assert.equal(next.count, 7);
    assert.equal((await maintenance.listMaintenanceRoutines({}, scoped)).totalCount, 1);
  }
  const explicit = await service.listTasks({ teamId: "maintenance" }, deps);
  assert.equal(explicit.scope, "authorized_inventory");
  assert.equal(explicit.tasks[0].taskId, "legacy-team-only");
  const shawna = { ...deps, taskAccess: { subject: "shawna", role: "member" } };
  assert((await service.listProjects({}, shawna)).projects.some(p => p.projectId === "proj-fbc-maintenance"));
  await assert.rejects(maintenance.listMaintenanceBoard({}, { ...deps, taskAccess: { subject: "outsider", role: "admin" } }), { statusCode: 403 });
});

test("live Dan review refresh excludes completed and dropped work in every task section and scopes guidance to Dan", async () => {
  const { db, deps } = await fixture();
  const before = await service.buildDailyReview({ today: "2026-10-01" }, deps);
  assert.equal(before.guidance.audience, "dan");
  assert.deepEqual(before.guidance.connectedSources, ["Outlook Calendar", "Outlook Email", "Messages", "Dropbox"]);
  assert(before.activeNext.some(t => t.taskId === "personal"));
  await service.updateTask({ taskId: "personal", expectedVersion: 1, changes: { status: "done" } }, deps);
  await service.updateTask({ taskId: "delegated", expectedVersion: 1, changes: { status: "dropped" } }, deps);
  const saved = structuredClone([...db.rows]);
  const after = await service.buildDailyReview({ today: "2026-10-01" }, deps);
  for (const key of ["activeNext", "highPriorityNext", "overdue", "needsReview", "dueToday", "scheduledToday", "scheduledOverdue", "followUpDue", "waiting", "scheduled"]) {
    assert(!after[key].some(t => ["personal", "delegated"].includes(t.taskId)), key);
  }
  assert.equal(after.summary.activeNextCount, 0);
  assert.equal((await service.getTask({ taskId: "personal" }, deps)).task.status, "done");
  assert.deepEqual([...db.rows], saved, "review remains read-only");
  const other = await service.buildDailyReview({ today: "2026-10-01" }, { ...deps, taskAccess: { subject: "shawna", role: "member" } });
  assert.equal(other.guidance, undefined, "Dan source policy must not leak into another person's review");
});
