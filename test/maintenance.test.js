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
  const domain = createDomain({ isSendingAllowed: () => true, taskDb: db, communicationsDb, bucket, enqueue: async (...args) => calls.push(args), send: async draft => { sent.push(draft); return { providerId: "SM1" }; }, mediaLoader: async () => ({ buffer: Buffer.from("image") }) });
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
test("chat board groups and filters the complete authorized set before paging, with stable references", async () => {
  const f = await fixture();
  for (let i = 0; i < 27; i++) await createTask({ taskId: `job-${i}`, projectId: ROOT_ID, title: `Repair ${String(i).padStart(2, "0")}`, assignedTo: "", maintenance: { building: i < 25 ? "B Building" : "A Building", area: "Hallway" } }, f.deps);
  await f.db.collection("tasks").doc("unrelated").set({ title: "Not Maintenance", visibility: "staff", status: "next", projectId: "other" });
  const first = await maintenance.listMaintenanceBoard({}, f.deps);
  assert.equal(first.count, 20); assert.equal(first.totalCount, 27); assert.equal(first.complete, false);
  assert.deepEqual(first.summary.byBuilding, { "B Building": 25, "A Building": 2 });
  assert.ok(first.rows.every(row => row.building === "B Building"));
  const second = await maintenance.listMaintenanceBoard({ cursor: first.nextCursor }, f.deps);
  assert.equal(second.count, 7); assert.equal(second.hasMore, false); assert.equal(second.complete, false);
  assert.deepEqual(first.rows.map(r => r.number), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual(second.rows.map(r => r.number), [21, 22, 23, 24, 25, 26, 27]);
  assert.equal(first.selection.snapshot, second.selection.snapshot);
  assert.deepEqual(first.selection.items[0], { number: 1, taskId: first.rows[0].taskId, version: 1, reference: first.rows[0].reference });
  assert.match(first.markdown, /1\. Repair 00/);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.taskId)).size, 27);
  const selected = await maintenance.listMaintenanceBoard({ building: "a", unassigned: true }, f.deps);
  assert.equal(selected.count, 2); assert.equal(selected.authorizedTotalCount, 27); assert.equal(selected.complete, true);
  const found = await maintenance.listMaintenanceBoard({ reference: second.rows.at(-1).reference }, f.deps);
  assert.equal(found.rows[0].taskId, second.rows.at(-1).taskId);
  assert.equal(found.rows[0].number, 1);
  assert.notEqual(found.selection.snapshot, first.selection.snapshot);
  await assert.rejects(maintenance.listMaintenanceBoard({ building: "A", cursor: first.nextCursor }, f.deps), { statusCode: 409 });
  await updateTask({ taskId: "job-0", expectedVersion: 1, changes: { title: "Changed" } }, f.deps);
  await assert.rejects(maintenance.listMaintenanceBoard({ cursor: first.nextCursor }, f.deps), { statusCode: 409 });
  await assert.rejects(maintenance.listMaintenanceBoard({}, { ...f.deps, taskAccess: { subject: "outsider", role: "admin" } }), { statusCode: 403 });
});
test("chat table retains source notes, escapes Markdown and presents proposed assignees and unknown costs honestly", async () => {
  const f = await fixture();
  const notes = "Source notes | <unsafe> [link](https://example.com)\n" + "original history ".repeat(100).trimEnd();
  await createTask({ taskId: "source", projectId: ROOT_ID, title: "Door | <test>\nrepair", assignedTo: "Volunteer", assignedToSub: "", notes, maintenance: { building: "B Building", area: "Hall | <one>", cost: { estimate: 0 } } }, f.deps);
  const compact = await maintenance.listMaintenanceBoard({}, f.deps);
  assert.ok(compact.rows[0].notesTruncated); assert.ok(compact.rows[0].columns.Notes.length < 250);
  assert.match(compact.markdown, /Volunteer \(proposed\)/);
  assert.match(compact.markdown, /Estimate: USD 0; actual: unknown/);
  assert.match(compact.markdown, /&#124;/); assert.match(compact.markdown, /&lt;test&gt;/);
  assert.ok(!compact.markdown.includes("<unsafe>")); assert.ok(!compact.markdown.includes("[link](https://example.com)"));
  const full = await maintenance.listMaintenanceBoard({ reference: compact.rows[0].reference, detailLevel: "full" }, f.deps);
  assert.equal(full.rows[0].columns.Notes, notes); assert.equal(full.rows[0].notesTruncated, false);
  assert.equal((await f.db.collection("tasks").doc("source").get()).data().notes, notes);
  assert.equal((await f.db.collection("tasks").doc("source").get()).data().version, 1);
  await assert.rejects(maintenance.listMaintenanceBoard({ limit: 1000 }, f.deps), { statusCode: 400 });
});
test("a referenced table task updates through existing versioned commands and reads back without changing source notes", async () => {
  const f = await fixture();
  await createTask({ taskId: "door", projectId: ROOT_ID, title: "Repair door", notes: "Original evidence", maintenance: { building: "B Building", workflowStatus: "In Progress" } }, f.deps);
  const row = (await maintenance.listMaintenanceBoard({}, f.deps)).rows[0];
  const fresh = (await require("../lib/project-task-service").getTask({ taskId: row.taskId }, f.deps)).task;
  await updateTask({ taskId: row.taskId, expectedVersion: fresh.version, changes: { status: "done" } }, f.deps);
  const saved = (await maintenance.listMaintenanceBoard({ reference: row.reference }, f.deps)).rows[0];
  assert.equal(saved.columns.Status, "Completed"); assert.equal(saved.version, fresh.version + 1); assert.equal(saved.columns.Notes, "Original evidence");
  await assert.rejects(updateTask({ taskId: row.taskId, expectedVersion: fresh.version, changes: { status: "waiting" } }, f.deps), { statusCode: 409 });
});
test("recurring duty table preserves cadence and source details and remains active after occurrence completion", async () => {
  const f = await fixture();
  await createRoutine({ routineId: "doors", projectId: ROOT_ID, title: "Check doors", recurrence: "daily", recurrenceNotes: "Each school day", notes: "Long source ".repeat(100), maintenance: { building: "B Building" } }, f.deps);
  const board = await maintenance.listMaintenanceRoutines({}, f.deps);
  assert.equal(board.selection.recordType, "routine");
  assert.equal(board.selection.items[0].routineId, "doors");
  assert.equal(board.rows[0].number, 1);
  assert.equal(board.rows[0].recurrence, "daily"); assert.ok(board.rows[0].notesTruncated);
  const full = await maintenance.listMaintenanceRoutines({ reference: board.rows[0].reference, detailLevel: "full" }, f.deps);
  assert.equal(full.routines[0].notes, "Long source ".repeat(100).trimEnd());
  await maintenance.recordMaintenanceRoutineCompletion({ routineId: "doors", occurrenceKey: "2026-09-17", expectedVersion: full.rows[0].version }, f.deps);
  const saved = await maintenance.listMaintenanceRoutines({ reference: board.rows[0].reference }, f.deps);
  assert.equal(saved.rows[0].columns.Status, "active"); assert.ok(saved.rows[0].lastCompletedAt);
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
test("channel gate blocks approval and queued sends before any send attempt", async () => {
  const f = await fixture(); await approvedReporter(f);
  let allowed = false, attempts = 0;
  const domain = createDomain({ taskDb: f.db, communicationsDb: f.communicationsDb, enqueue: async () => {}, send: async () => { attempts++; return {}; }, isSendingAllowed: () => allowed });
  const draft = await domain.invoke({ action: "draftMessage", actor, channel: "sms", recipient: inbound.sender, body: "Channel test", requestKey: "channel-test" });
  const approval = { action: "approveMessage", actor, draftId: draft.draftId, expectedVersion: 1, contentDigest: draft.contentDigest };
  await assert.rejects(domain.invoke(approval), { statusCode: 503 });
  assert.equal((await domain.invoke({ action: "getOutbox", actor, draftId: draft.draftId })).status, "draft");
  const unconfigured = createDomain({ taskDb: f.db, communicationsDb: f.communicationsDb });
  await assert.rejects(unconfigured.invoke(approval), { statusCode: 503 });
  allowed = true; await domain.invoke(approval); allowed = false;
  await assert.rejects(domain.dispatch(draft.draftId), { statusCode: 503 });
  const blocked = await domain.invoke({ action: "getOutbox", actor, draftId: draft.draftId });
  assert.equal(blocked.status, "approved"); assert.equal(blocked.attemptedAt, undefined); assert.equal(attempts, 0);
  allowed = true; await domain.dispatch(draft.draftId); await domain.dispatch(draft.draftId);
  assert.equal(attempts, 1);
});
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
  const domain = createDomain({ isSendingAllowed: () => true, taskDb: f.db, communicationsDb: f.communicationsDb, enqueue: async () => {}, send: async () => { attempts++; throw new Error("timeout after acceptance"); } });
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

test("board renders private photo indicators and inline previews only for the authorized page; links do not break pagination", async () => {
  const f = await fixture();
  for (const id of ["a", "b", "private"]) {
    await createTask({ taskId: id, projectId: ROOT_ID, title: id, ...(id === "private" ? { visibility: "private" } : {}) }, id === "private" ? { ...f.deps, taskAccess: { subject: "dan", role: "member" } } : f.deps);
    await f.db.collection("taskAttachments").doc(`photo-${id}`).set({ recordType: "task", recordId: id, contentType: "image/jpeg", storagePath: `photos/${id}`, fileName: "<bad>|[link].jpg" });
  }
  let tick = 0; const signed = [];
  f.deps.taskAttachmentBucket = { file: path => ({ getSignedUrl: async options => {
    signed.push({ path, options }); return [`https://storage.test/${path}?token=${++tick}`];
  } }) };
  const first = await maintenance.listMaintenanceBoard({ limit: 1 }, f.deps);
  assert.equal(first.totalCount, 2);
  assert.match(first.markdown, /📷 \*\*1 photo\*\*/);
  assert.match(first.markdown, /\[Open photo\]\(https:\/\/storage.test\/photos\/a/);
  assert.doesNotMatch(first.markdown, /!\[Photo/);
  assert.match(first.markdown, /photo viewer/);
  assert.ok(!first.markdown.includes("<bad>"));
  assert.deepEqual([...new Set(signed.map(x => x.path))], ["photos/a"]);
  assert.equal(signed[1].options.responseDisposition, "inline");
  assert.equal(signed[1].options.responseType, "image/jpeg");
  const second = await maintenance.listMaintenanceBoard({ limit: 1, cursor: first.nextCursor }, f.deps);
  assert.equal(second.rows[0].taskId, "b");
  assert.equal(second.hasMore, false);
  assert.ok(!signed.some(x => x.path === "photos/private"));
  await f.db.collection("taskAttachments").doc("second-photo").set({ recordType: "task", recordId: "a", contentType: "image/jpeg", storagePath: "photos/new", fileName: "new.jpg" });
  await assert.rejects(maintenance.listMaintenanceBoard({ limit: 1, cursor: first.nextCursor }, f.deps), { statusCode: 409 });
});

test("photo signing failure retains the attachment count and a clear preview fallback", async () => {
  const f = await fixture();
  await createTask({ taskId: "repair", projectId: ROOT_ID, title: "Repair" }, f.deps);
  await f.db.collection("taskAttachments").doc("photo").set({ recordType: "task", recordId: "repair", contentType: "image/jpeg", storagePath: "photo", fileName: "photo.jpg" });
  f.deps.taskAttachmentBucket = { file: () => ({ getSignedUrl: async () => { throw new Error("signing unavailable"); } }) };
  const board = await maintenance.listMaintenanceBoard({}, f.deps);
  assert.equal(board.rows[0].columns.Images.length, 1);
  assert.match(board.markdown, /1 photo/);
  assert.match(board.markdown, /Preview unavailable/);
  assert.ok(!board.markdown.includes("!["));
});


test("numbered archive batch keeps original selected IDs despite rows shifting and preserves recoverable history", async () => {
  const f = await fixture();
  for (let i = 1; i <= 6; i++) await createTask({ taskId: `numbered-${i}`, projectId: ROOT_ID, title: `Numbered ${i}`, notes: "Keep this history" }, f.deps);
  const displayed = await maintenance.listMaintenanceBoard({}, f.deps);
  const selected = [1, 3, 5].map(n => displayed.selection.items.find(item => item.number === n));
  const { getTask, restoreTaskRecord } = require("../lib/project-task-service");
  for (const item of selected) {
    const current = (await getTask({ taskId: item.taskId }, f.deps)).task;
    await updateTask({ taskId: item.taskId, expectedVersion: current.version, changes: { status: "dropped" } }, f.deps);
  }
  const active = await maintenance.listMaintenanceBoard({}, f.deps);
  assert.deepEqual(active.rows.map(r => r.taskId), ["numbered-2", "numbered-4", "numbered-6"]);
  assert.deepEqual(active.rows.map(r => r.number), [1, 2, 3]);
  assert.notEqual(active.selection.snapshot, displayed.selection.snapshot);
  for (const item of selected) {
    const saved = (await getTask({ taskId: item.taskId }, f.deps)).task;
    assert.equal(saved.status, "dropped"); assert.equal(saved.notes, "Keep this history"); assert.equal(saved.archivedBySub, "shawna");
  }
  await restoreTaskRecord({ recordType: "task", recordId: selected[0].taskId, expectedVersion: 2 }, f.deps);
  assert.equal((await getTask({ taskId: selected[0].taskId }, f.deps)).task.status, "next");
});

test("church email domain admits requests for review without granting outbound consent or staff access", async () => {
  const f = await fixture();
  const email = { provider: "graph", providerId: "church-email", channel: "email", sender: "New.Person@FoundedOnFaith.COM", recipient: "maintenance@foundedonfaith.com", body: "Please repair a door", media: [] };
  const result = await f.domain.ingest(email);
  assert.equal(result.reviewStatus, "pending");
  assert.equal((await f.communicationsDb.collection("maintenanceMessages").doc(result.messageId).get()).data().admissionReason, "foundedonfaith_email");
  assert.equal((await f.domain.ingest(email)).messageId, result.messageId);
  assert.equal((await f.communicationsDb.collection("maintenanceReporters").get()).docs.length, 0);
  assert.equal((await f.db.collection("tasks").get()).docs.length, 0);
  assert.equal((await f.db.collection("projects").doc(ROOT_ID).get()).data().version, f.root.version);
  await assert.rejects(f.domain.invoke({ action: "draftMessage", actor, channel: "email", recipient: email.sender, body: "No inferred consent", requestKey: "no-consent" }), { statusCode: 403 });
  for (const sender of ["someone@example.com", "person@sub.foundedonfaith.com", "person@notfoundedonfaith.com", "person@foundedonfaith.com.evil.test"]) {
    assert.equal((await f.domain.ingest({ ...email, providerId: sender, sender })).reviewStatus, "quarantined");
  }
  assert.equal((await f.domain.ingest({ ...email, provider: "twilio", providerId: "not-graph" })).reviewStatus, "quarantined");
  await f.domain.invoke({ action: "setReporter", actor, expectedVersion: 0, changes: { channel: "email", address: email.sender, name: "Revoked", approved: false, consentNote: "" } });
  assert.equal((await f.domain.ingest({ ...email, providerId: "after-revocation" })).reviewStatus, "quarantined");
  assert.equal((await f.domain.ingest(email)).reviewStatus, "pending", "replays preserve original review history");
  await f.domain.invoke({ action: "setReporter", actor, expectedVersion: 0, changes: { channel: "email", address: "worker@example.com", name: "Approved external", approved: true, consentNote: "" } });
  assert.equal((await f.domain.ingest({ ...email, providerId: "approved-external", sender: "worker@example.com" })).reviewStatus, "pending");
});
