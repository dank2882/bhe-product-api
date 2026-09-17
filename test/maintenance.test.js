"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { ROOT_ID, COLUMNS } = require("../lib/maintenance-fields");
const { createTask, updateTask, createRoutine, updateRoutine } = require("../lib/project-task-service");
const maintenance = require("../lib/maintenance-service");
const { createDomain, hash } = require("../services/maintenance-worker/domain");

async function fixture(subject = "shawna") {
  const db = fakeFirestore(), communicationsDb = fakeFirestore();
  const root = { projectId: ROOT_ID, name: "Maintenance", status: "active", visibility: "branch", teamId: "maintenance", lifeArea: "church", ownerSub: "dan", collaborationPolicy: "editor_archive_owner_delete", maintenanceManagers: ["shawna"], branchMembers: [{ subject: "shawna", role: "editor" }, { subject: "worker", role: "editor" }], version: 2 };
  await db.collection("projects").doc(ROOT_ID).set(root);
  for (const subject of ["dan", "shawna", "worker"]) await db.collection("staffAuthorizationProfiles").doc(require("../lib/staff-authorization-service").getStaffAuthorizationProfileId(subject)).set({ subject, status: "active", permissions: ["tasks.read", "tasks.write"] });
  const deps = { taskAccess: { subject, name: subject, role: "member", teamIds: ["maintenance"] }, now: () => "2026-09-17T00:00:00.000Z" };
  for (const name of ["projects", "tasks", "routines", "taskAttachments", "taskNotes", "taskNotifications", "taskManagementAuditEvents"]) deps[`${name}Collection`] = db.collection(name);
  const calls = [], sent = [], objects = new Map();
  const bucket = { file: path => ({ save: async buffer => { if (objects.has(path)) throw Object.assign(new Error("exists"), { code: 412 }); objects.set(path, buffer); }, getSignedUrl: async () => [`https://storage.test/${path}`] }) };
  const domain = createDomain({ taskDb: db, communicationsDb, bucket, enqueue: async (...args) => calls.push(args), send: async draft => { sent.push(draft); return { providerId: "SM1" }; }, mediaLoader: async () => ({ buffer: Buffer.from("image") }) });
  return { db, communicationsDb, deps, calls, sent, objects, domain, root };
}
test("maintenance fields survive normal CRUD and the exact table projection; unknown cost stays null", async () => {
  const f = await fixture();
  const created = await createTask({ taskId: "repair", projectId: ROOT_ID, title: "Repair door", lifeArea: "church", maintenance: { building: "B", area: "Back door", thirdParty: "Requested, not confirmed", cost: { estimate: 200 }, sourceStatus: "Asked Steve" } }, f.deps);
  assert.equal(created.task.maintenance.cost.actual, null);
  await updateTask({ taskId: "repair", expectedVersion: 1, changes: { maintenance: { ...created.task.maintenance, cost: { estimate: 200, actual: 180 } } } }, f.deps);
  const board = await maintenance.listMaintenanceBoard({}, f.deps);
  assert.deepEqual(board.columns, COLUMNS); assert.equal(board.rows[0].columns.Cost.actual, 180);
  await assert.rejects(createTask({ title: "Other", maintenance: { building: "A" } }, f.deps), /Maintenance/);
  await assert.rejects(updateTask({ taskId: "repair", expectedVersion: 2, changes: { maintenance: { cost: { actual: -1 } } } }, f.deps), /nonnegative/);
});
test("scoped managers grant membership but cannot appoint managers, alter owner or delete work", async () => {
  const f = await fixture();
  await maintenance.setMaintenanceAccess({ kind: "member", subject: "new", role: "editor", expectedVersion: 2 }, f.deps);
  await assert.rejects(maintenance.setMaintenanceAccess({ kind: "manager", subject: "new", role: "editor", expectedVersion: 3 }, f.deps), { statusCode: 403 });
  await assert.rejects(maintenance.setMaintenanceAccess({ kind: "member", subject: "dan", role: "remove", expectedVersion: 3 }, f.deps));
  await assert.rejects(maintenance.setMaintenanceAccess({ kind: "member", subject: "x", role: "editor", expectedVersion: 2 }, f.deps), { statusCode: 409 });
  await createTask({ taskId: "repair", projectId: ROOT_ID, title: "Repair", lifeArea: "church" }, f.deps);
  await assert.rejects(updateTask({ taskId: "repair", expectedVersion: 1, changes: { permanentlyDelete: true, confirmDelete: true } }, f.deps), { statusCode: 403 });
  await assert.rejects(maintenance.getMaintenanceAccess({}, { ...f.deps, taskAccess: { role: "admin", subject: "other" } }), { statusCode: 403 });
});
test("Maintenance routine completions are append-only, repeat-safe and branch-private", async () => {
  const f = await fixture();
  await createRoutine({ routineId: "check", projectId: ROOT_ID, title: "Check doors", recurrence: "daily" }, f.deps);
  const args = { routineId: "check", occurrenceKey: "2026-09-17", expectedVersion: 1, notes: "Checked" };
  const results = await Promise.all([maintenance.recordMaintenanceRoutineCompletion(args, f.deps), maintenance.recordMaintenanceRoutineCompletion(args, f.deps)]);
  assert.equal(results.filter(r => r.replayed).length, 1);
  assert.equal((await maintenance.listMaintenanceRoutineCompletions({ routineId: "check" }, f.deps)).completions.length, 1);
  assert.equal((await f.db.collection("routines").doc("check").get()).data().status, "active");
  const other = { ...f.deps, taskAccess: { role: "member", subject: "outsider" } };
  await assert.rejects(maintenance.listMaintenanceRoutines({}, other), { statusCode: 403 });
  await updateRoutine({ routineId: "check", expectedVersion: 2, changes: { status: "archived" } }, { ...f.deps, taskAccess: { role: "member", subject: "worker" } });
  assert.equal((await f.db.collection("routines").doc("check").get()).data().archivedBySub, "worker");
});
const actor = { subject: "shawna", name: "Shawna" };
const inbound = { provider: "twilio", providerId: "SMexample", channel: "sms", sender: "+12065550100", recipient: "+12065550101", body: "Door is fixed", media: [{ url: "provider media" }] };
async function approvedReporter(f) {
  return f.domain.invoke({ action: "setReporter", actor, expectedVersion: 0, changes: { channel: "sms", address: inbound.sender, name: "Worker", approved: true, consentNote: "Requested maintenance texts in writing" } });
}
test("duplicate inbound deliveries preserve one original; unknown senders quarantine and never complete work", async () => {
  const f = await fixture();
  const results = await Promise.all([f.domain.ingest(inbound), f.domain.ingest(inbound)]);
  assert.equal(results[0].messageId, results[1].messageId);
  assert.equal(results[0].reviewStatus, "quarantined");
  await f.domain.processMedia(results[0].messageId); await f.domain.processMedia(results[0].messageId);
  assert.equal(f.objects.size, 1); assert.equal((await f.db.collection("tasks").get()).docs.length, 0);
  await assert.rejects(f.domain.invoke({ action: "listInbox", actor: { subject: "worker" } }), { statusCode: 403 });
});
test("outbox approval binds immutable content; concurrency sends once; revoked consent blocks queued work", async () => {
  const f = await fixture(); await approvedReporter(f);
  const draft = await f.domain.invoke({ action: "draftMessage", actor, channel: "sms", recipient: inbound.sender, body: "Please check the door", requestKey: "request1" });
  await assert.rejects(f.domain.invoke({ action: "approveMessage", actor, draftId: draft.draftId, expectedVersion: 1, contentDigest: "wrong" }), { statusCode: 409 });
  await f.domain.invoke({ action: "approveMessage", actor, draftId: draft.draftId, expectedVersion: 1, contentDigest: draft.contentDigest });
  await Promise.all([f.domain.dispatch(draft.draftId), f.domain.dispatch(draft.draftId)]);
  assert.equal(f.sent.length, 1);
  const status = await f.domain.invoke({ action: "getOutbox", actor, draftId: draft.draftId });
  assert.equal(status.status, "accepted"); assert.equal(status.deliveryConfirmed, false);
  const second = await f.domain.invoke({ action: "draftMessage", actor, channel: "sms", recipient: inbound.sender, body: "Please check another door", requestKey: "request2" });
  await f.domain.invoke({ action: "approveMessage", actor, draftId: second.draftId, expectedVersion: 1, contentDigest: second.contentDigest });
  await f.domain.optOut("sms", inbound.sender, "STOP"); await f.domain.dispatch(second.draftId);
  assert.equal(f.sent.length, 1);
  assert.equal((await f.domain.invoke({ action: "getOutbox", actor, draftId: second.draftId })).status, "blocked");
});
test("ambiguous provider send is never retried, even during queue recovery", async () => {
  const f = await fixture(); await approvedReporter(f); let attempts = 0;
  const domain = createDomain({ taskDb: f.db, communicationsDb: f.communicationsDb, enqueue: async () => {}, send: async () => { attempts++; throw new Error("timeout after acceptance"); } });
  const draft = await domain.invoke({ action: "draftMessage", actor, channel: "sms", recipient: inbound.sender, body: "Test", requestKey: "request1" });
  await domain.invoke({ action: "approveMessage", actor, draftId: draft.draftId, expectedVersion: 1, contentDigest: draft.contentDigest });
  await domain.dispatch(draft.draftId); await domain.recover(); await domain.dispatch(draft.draftId);
  assert.equal(attempts, 1); assert.equal((await domain.invoke({ action: "getOutbox", actor, draftId: draft.draftId })).status, "unknown");
});

test("reviewed photos attach to one authorized task, never to a competing concurrent review", async () => {
  const f = await fixture();
  for (const taskId of ["repair-a", "repair-b"]) await createTask({ taskId, projectId: ROOT_ID, title: taskId, lifeArea: "church" }, f.deps);
  const message = await f.domain.ingest(inbound); await f.domain.processMedia(message.messageId);
  const results = await Promise.allSettled(["repair-a", "repair-b"].map(taskId => f.domain.invoke({ action: "reviewMessage", actor, messageId: message.messageId, expectedVersion: 1, decision: "link", taskId })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const photos = (await f.db.collection("taskAttachments").get()).docs;
  assert.equal(photos.length, 1);
  const reviewed = await f.domain.invoke({ action: "getMessage", actor, messageId: message.messageId });
  assert.equal(photos[0].data().recordId, reviewed.taskId);
  assert.equal((await f.db.collection("tasks").doc(reviewed.taskId).get()).data().status, "next");
});

test("staff offboarding blocks already approved sends; delivery callbacks never downgrade delivered to sent", async () => {
  const f = await fixture(); await approvedReporter(f);
  const draft = await f.domain.invoke({ action: "draftMessage", actor, channel: "sms", recipient: inbound.sender, body: "Check door", requestKey: "offboard" });
  await f.domain.invoke({ action: "approveMessage", actor, draftId: draft.draftId, expectedVersion: 1, contentDigest: draft.contentDigest });
  const profileId = require("../lib/staff-authorization-service").getStaffAuthorizationProfileId(actor.subject);
  await f.db.collection("staffAuthorizationProfiles").doc(profileId).update({ status: "disabled" });
  await f.domain.dispatch(draft.draftId); assert.equal(f.sent.length, 0);
  assert.equal((await f.communicationsDb.collection("maintenanceOutbox").doc(draft.draftId).get()).data().status, "blocked");
  await f.communicationsDb.collection("maintenanceOutbox").doc("delivery").set({ channel: "sms", status: "accepted", providerId: "SMreceipt" });
  await f.domain.delivery("delivery", "SMreceipt", "delivered"); await f.domain.delivery("delivery", "SMreceipt", "sent");
  assert.equal((await f.communicationsDb.collection("maintenanceOutbox").doc("delivery").get()).data().deliveryStatus, "delivered");
});
