"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { runIntakeOperation } = require("../lib/intake-operation-registry");
const { createIntakeDestinations } = require("../lib/intake-destinations");

function setup() {
  const db = fakeFirestore(), objects = new Map(); let counter = 0;
  const deps = { firestoreDb: db, danOwnerSubjects: ["dan"],
    taskAccess: { subject: "dan", role: "admin", name: "Dan" },
    privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: "dan", DAN_PRIVATE_DELEGATE_SUBJECTS: "sarah" },
    now: () => new Date("2026-10-01T17:00:00Z"),
    projectsCollection: db.collection("projects"), tasksCollection: db.collection("tasks"),
    routinesCollection: db.collection("routines"), taskNotesCollection: db.collection("taskNotes"),
    thinkTankEntriesCollection: db.collection("thoughts"), thinkTankReflectionsCollection: db.collection("reflections"),
    taskManagementOperationExecutionsCollection: db.collection("executions"),
    taskManagementAuditEventsCollection: db.collection("taskAudit"),
    intakeBucket: { file: path => ({ save: async bytes => objects.set(path, bytes), download: async () => [objects.get(path)],
      getSignedUrl: async () => ["https://storage.googleapis.com/private-test/original"] }) },
    enqueueNotebookIndexingJob: async () => {} };
  deps.intakeDestinations = createIntakeDestinations(deps);
  const call = async (operation, args = {}, key = `intake-test-${++counter}`, overrides = {}) => {
    const active = { ...deps, ...overrides }; active.intakeDestinations = overrides.intakeDestinations || createIntakeDestinations(active);
    return (await runIntakeOperation({ mode: /^(get|list)/.test(operation) ? "query" : "command", operation,
      arguments: args, idempotencyKey: key }, active)).result;
  };
  return { deps, db, call, objects };
}
const capture = { title: "Meeting notes", sourceType: "text", sensitivity: "general", exactText: "  Andrew will get estimates.\nMaybe vans next year.  " };
async function proposed(f, destination = "task", args = { title: "Ask Andrew for estimates" }) {
  const created = await f.call("createIntake", capture);
  const result = await f.call("proposeIntakeItem", { intakeId: created.intakeId, expectedVersion: 1,
    exactText: "Andrew will get estimates.", proposal: { destination, action: "create", arguments: args,
      duplicateCheck: "Searched existing accessible records; no matching commitment found." } });
  return result;
}
async function approved(f, destination, args) {
  const p = await proposed(f, destination, args), item = p.intake.items[0];
  return f.call("approveIntakeItem", { intakeId: p.intakeId, expectedVersion: p.version,
    itemId: item.itemId, proposalHash: item.proposalHash, approvalNote: "Dan: Save this action." });
}

test("exact capture, immutable source, idempotency and extraction revisions", async () => {
  const f = setup();
  const a = await f.call("createIntake", capture, "same-source-key");
  assert.equal(a.intake.exactText, capture.exactText);
  assert.equal((await f.call("createIntake", capture, "same-source-key")).intakeId, a.intakeId);
  await assert.rejects(f.call("createIntake", { ...capture, exactText: "different" }, "same-source-key"), { code: "idempotency_key_reused" });
  await f.call("saveIntakeExtraction", { intakeId: a.intakeId, expectedVersion: 1, transcript: "First reading", uncertainties: ["Andrew or Andy?"] });
  await assert.rejects(f.call("finishIntakeExtraction", { intakeId: a.intakeId, expectedVersion: 2 }), { code: "intake_needs_details" });
  const updated = await f.call("saveIntakeExtraction", { intakeId: a.intakeId, expectedVersion: 2, transcript: "Corrected reading", uncertainties: [] });
  assert.equal(updated.intake.exactText, capture.exactText);
  const history = await f.call("getIntakeHistory", { intakeId: a.intakeId });
  assert.deepEqual(history.events.filter(e => e.operation === "saveIntakeExtraction").map(e => e.transcript), ["First reading", "Corrected reading"]);
});

test("questions block approval, exact proposal locks, and stale writes cannot overwrite", async () => {
  const f = setup(), p = await proposed(f), item = p.intake.items[0];
  const args = { intakeId: p.intakeId, expectedVersion: p.version, itemId: item.itemId,
    proposalHash: item.proposalHash, approvalNote: "Save" };
  await assert.rejects(f.call("approveIntakeItem", { ...args, proposalHash: "old" }), { code: "intake_proposal_changed" });
  await f.call("approveIntakeItem", args);
  await assert.rejects(f.call("approveIntakeItem", args), { code: "intake_version_conflict" });
  await assert.rejects(f.call("proposeIntakeItem", { intakeId: p.intakeId, expectedVersion: 3, itemId: item.itemId,
    exactText: "Changed", proposal: item.proposal }), { code: "intake_item_locked" });
});

test("destination saves and readback survive a new session without duplicating tasks", async () => {
  const f = setup(), a = await approved(f), itemId = a.intake.items[0].itemId;
  const done = await f.call("dispatchIntakeItem", { intakeId: a.intakeId, expectedVersion: a.version, itemId }, "save-approved-item");
  assert.equal(done.intake.items[0].status, "verified");
  assert.equal(done.intake.status, "open"); // Other parts of this page are not yet considered.
  const repeat = await f.call("dispatchIntakeItem", { intakeId: a.intakeId, expectedVersion: a.version, itemId }, "save-approved-item");
  assert.equal(repeat.alreadyVerified, true);
  assert.equal((await f.deps.tasksCollection.get()).docs.length, 1);
  const current = (await f.call("getIntake", { intakeId: a.intakeId })).intake;
  const finished = await f.call("finishIntakeExtraction", { intakeId: a.intakeId, expectedVersion: current.version });
  assert.equal(finished.intake.status, "complete");
});

test("a crash after destination save leaves a recoverable locked dispatch", async () => {
  const f = setup(), a = await approved(f), itemId = a.intake.items[0].itemId;
  const adapters = createIntakeDestinations(f.deps), execute = adapters.task.execute;
  adapters.task.execute = async d => { await execute(d); throw new Error("response lost after commit"); };
  const args = { intakeId: a.intakeId, itemId, expectedVersion: a.version };
  await assert.rejects(f.call("dispatchIntakeItem", args, "crash-recovery-key", { intakeDestinations: adapters }), /response lost/);
  const partial = (await f.call("getIntake", { intakeId: a.intakeId })).intake;
  assert.equal(partial.items[0].status, "dispatching");
  const result = await f.call("dispatchIntakeItem", { ...args, expectedVersion: partial.version }, "resume-new-chat-key");
  assert.equal(result.intake.items[0].status, "verified");
  assert.equal((await f.deps.tasksCollection.get()).docs.length, 1);
});

test("private note dispatch preserves exact text through the owning notebook operation", async () => {
  const f = setup(), exact = "  Reference wording.\nKeep whitespace.  ";
  const a = await approved(f, "note", { title: "Reference", text: exact });
  const r = await f.call("dispatchIntakeItem", { intakeId: a.intakeId, itemId: a.intake.items[0].itemId, expectedVersion: a.version });
  const item = r.intake.items[0];
  assert.equal(item.status, "verified");
  assert.equal((await f.db.collection("danNotebookNotes").doc(item.outcome.recordId).get()).data().text, exact);
});

test("delegates retain owner and actor; other administrators and restricted sources are denied", async () => {
  const f = setup(), a = await f.call("createIntake", capture);
  const r = await f.call("saveIntakeExtraction", { intakeId: a.intakeId, expectedVersion: 1, transcript: "Reading", uncertainties: [] }, "sarah-extraction", { taskAccess: { subject: "sarah", role: "member" } });
  assert.equal(r.intake.ownerSubject, "dan"); assert.equal(r.intake.actorSub, "sarah");
  await assert.rejects(f.call("getIntake", { intakeId: a.intakeId }, "outsider-get", { taskAccess: { subject: "other-admin", role: "admin" } }), { code: "dan_private_access_denied" });
  await assert.rejects(f.call("createIntake", { ...capture, sensitivity: "care" }), { code: "intake_sensitive_source" });
});

test("source image is saved as original bytes, private metadata excludes paths and URLs, and replay tolerates refreshed URLs", async () => {
  const f = setup(), bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  f.deps.fetchImpl = async () => new Response(bytes, { headers: { "content-type": "image/png" } });
  const a = await f.call("createIntake", { title: "Paper", sourceType: "image", sensitivity: "general" });
  assert.equal(a.intake.sourcePreserved, false);
  await assert.rejects(f.call("finishIntakeExtraction", { intakeId: a.intakeId, expectedVersion: 1 }), { code: "intake_source_unavailable" });
  const input = { intakeId: a.intakeId, expectedVersion: 1, file: { id: "file-1", download_link: "https://files.openai.com/original" } };
  const saved = await f.call("attachIntakeImage", input, "attach-original-key");
  assert.equal(saved.intake.sourcePreserved, true);
  assert.equal(saved.intake.sourceFile.storagePath, undefined);
  assert.deepEqual([...f.objects.values()][0], bytes);
  const replay = await f.call("attachIntakeImage", { ...input, file: { ...input.file, download_link: "https://files.openai.com/refreshed" } }, "attach-original-key");
  assert.equal(replay.replayed, true); assert.equal(f.objects.size, 1);
});

test("bounded listing supplies accurate counts and rejects cursors after changes", async () => {
  const f = setup();
  const a = await f.call("createIntake", capture); await f.call("createIntake", { ...capture, title: "Second" });
  const first = await f.call("listIntakes", { limit: 1 });
  assert.equal(first.totalCount, 2); assert.equal(first.complete, false);
  const second = await f.call("listIntakes", { limit: 1, cursor: first.nextCursor });
  assert.equal(second.complete, true); assert.notEqual(first.intakes[0].intakeId, second.intakes[0].intakeId);
  await f.call("finishIntakeExtraction", { intakeId: a.intakeId, expectedVersion: 1 });
  await assert.rejects(f.call("listIntakes", { limit: 1, cursor: first.nextCursor }), { code: "intake_invalid_cursor" });
});

test("unrouted and partially processed source items remain resumable without inventing a destination", async () => {
  const f = setup(), a = await approved(f);
  const held = await f.call("proposeIntakeItem", { intakeId: a.intakeId, expectedVersion: a.version,
    exactText: "Maybe vans next year.", questions: ["Is this an idea to consider or an approved project?"] });
  const unresolved = held.intake.items[1];
  await assert.rejects(f.call("approveIntakeItem", { intakeId: a.intakeId, expectedVersion: held.version,
    itemId: unresolved.itemId, proposalHash: unresolved.proposalHash, approvalNote: "Save" }), { code: "intake_needs_details" });
  const done = await f.call("dispatchIntakeItem", { intakeId: a.intakeId, expectedVersion: held.version, itemId: a.intake.items[0].itemId });
  const finished = await f.call("finishIntakeExtraction", { intakeId: a.intakeId, expectedVersion: done.intake.version });
  assert.equal(finished.intake.status, "open");
  assert.equal(finished.intake.remainingCount, 1);
  const listed = await f.call("listIntakes", { status: "open" });
  assert.equal(listed.intakes[0].intakeId, a.intakeId);
  assert.equal((await f.deps.tasksCollection.get()).docs.length, 1);
});

test("failed image handoff leaves the original unavailable and no saved image claim", async () => {
  const f = setup(), a = await f.call("createIntake", { title: "Missing image", sourceType: "image", sensitivity: "general" });
  f.deps.fetchImpl = async () => new Response("expired", { status: 403 });
  await assert.rejects(f.call("attachIntakeImage", { intakeId: a.intakeId, expectedVersion: 1,
    file: { id: "expired", download_link: "https://files.openai.com/expired" } }));
  const r = await f.call("getIntake", { intakeId: a.intakeId });
  assert.equal(r.intake.sourcePreserved, false); assert.equal(r.intake.version, 1);
  assert.equal(f.objects.size, 0);
});

test("domain receipts cannot be invented by the public command tool and bind to an approved opaque target", async () => {
  const f = setup(), created = await f.call("createIntake", { ...capture, exactText: "Domain-owned item; original preserved in its owning system." });
  const p = await f.call("proposeIntakeItem", { intakeId: created.intakeId, expectedVersion: 1,
    exactText: "Restricted domain item", proposal: { destination: "domain_reference", action: "link", recordId: "prayer-existing",
      arguments: { system: "prayer_management", expectedVersion: 3 }, duplicateCheck: "Exact owning record retrieved" } });
  const item = p.intake.items[0];
  const a = await f.call("approveIntakeItem", { intakeId: p.intakeId, expectedVersion: p.version, itemId: item.itemId, proposalHash: item.proposalHash, approvalNote: "Record this link" });
  const prepared = await f.call("prepareIntakeDispatch", { intakeId: a.intakeId, expectedVersion: a.version, itemId: item.itemId });
  const args = { intakeId: a.intakeId, expectedVersion: prepared.version, itemId: item.itemId,
    receipt: { system: "prayer_management", recordId: "prayer-existing", version: 3, prayerText: "must never be retained" } };
  await assert.rejects(f.call("recordIntakeDomainVerification", args), { code: "intake_invalid_operation" });
  const { runIntakeCommand } = require('../lib/intake-service');
  await assert.rejects(runIntakeCommand("recordIntakeDomainVerification", args, "gateway-receipt-key", f.deps), { code: "intake_domain_readback_required" });
  const done = await runIntakeCommand("recordIntakeDomainVerification", args, "gateway-receipt-key", { ...f.deps, trustedDomainVerification: true });
  assert.equal(done.intake.items[0].status, "verified");
  assert.equal(JSON.stringify([...f.db.rows]).includes("must never be retained"), false);
});

for (const [destination, args] of [
  ['project', { name: 'Synthetic future vehicle decision', projectKind: 'outcome', status: 'paused' }],
  ['routine', { title: 'Synthetic review', reviewKind: 'weekly' }],
  ['thought', { assistantTitle: 'Maybe vehicles', exactText: '  Maybe vans next year.  ' }]
]) test(`approved ${destination} uses the owning command and independent readback`, async () => {
  const f = setup(), a = await approved(f, destination, args);
  const r = await f.call('dispatchIntakeItem', { intakeId: a.intakeId, expectedVersion: a.version, itemId: a.intake.items[0].itemId });
  assert.equal(r.intake.items[0].status, 'verified');
});
