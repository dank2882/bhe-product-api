"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { runIdempotentTaskManagementOperation: run } = require("../lib/task-management-operation-execution");
const { OPERATIONS } = require("../lib/shared-thoughts-service");
const { listTaskManagementOperations } = require("../lib/task-management-operation-registry");
function setup() {
  const firestoreDb = fakeFirestore(); let n = 0;
  const call = (subject, operation, args = {}, key = `test-key-${++n}`) => run({ operation,
    mode: OPERATIONS.find(o => o.name === operation)?.mode || "command", arguments: args, idempotencyKey: key },
  { firestoreDb, sharedThoughtParticipants: { dan: "dan", sarah: "sarah" },
    // Broad delegation and claimed aliases must never bypass per-record checks.
    privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: "dan", DAN_PRIVATE_DELEGATE_SUBJECTS: "sarah" },
    taskAccess: { subject, subjects: [subject, "dan"], name: "Forged Name", role: "admin" },
    now: () => new Date("2026-10-25T17:00:00Z") }).then(r => r.result);
  const draft = (key) => call("dan", "prepareSharedThought", { title: "A thought", exactText: "  My exact words — café.\n\nKeep this.  ", assistantSummary: "AI interpretation" }, key);
  const read = (subject, thoughtId) => call(subject, "getSharedThought", { thoughtId });
  const share = async thoughtId => { const r = await read("dan", thoughtId); return call("dan", "shareSharedThought", { thoughtId, expectedVersion: r.thought.version, approvalDigest: r.approvalDigest, approved: true }); };
  return { firestoreDb, call, draft, read, share };
}

test("Dan approves, Sarah discovers/reads/contributes, Dan reads/responds; exact text, authorship and chronology survive", async () => {
  const { call, draft, read, share } = setup();
  const d = await draft(), thoughtId = d.thoughtId;
  assert.equal((await read("dan", thoughtId)).thought.state, "draft");
  await assert.rejects(read("sarah", thoughtId), { code: "shared_thought_not_found" });
  assert.deepEqual((await call("sarah", "listSharedThoughts")).thoughts, []);
  await share(thoughtId);
  assert.equal((await call("sarah", "listSharedThoughts", { query: "café" })).thoughts[0].thoughtId, thoughtId);
  const original = (await read("sarah", thoughtId)).thought;
  assert.equal(original.exactText, "  My exact words — café.\n\nKeep this.  ");
  assert.equal(original.assistantSummary, "AI interpretation");
  const sarahText = "  I wonder…\nLet's leave this open.  ";
  await call("sarah", "appendSharedThought", { thoughtId, expectedVersion: 2, exactText: sarahText, assistantSummary: "A separate interpretation" });
  const r = await read("dan", thoughtId);
  assert.deepEqual(r.thought.contributions[0], { sequence: 1, author: { subject: "sarah", name: "Sarah" }, exactText: sarahText, assistantSummary: "A separate interpretation", createdAt: "2026-10-25T17:00:00.000Z" });
  await call("dan", "appendSharedThought", { thoughtId, expectedVersion: 3, exactText: "Yes, let's discuss it." });
  const history = (await read("sarah", thoughtId)).thought;
  assert.deepEqual(history.contributions.map(c => [c.sequence, c.author.name]), [[1, "Sarah"], [2, "Dan"]]);
  assert.equal(history.exactText, original.exactText);
});

test("approval, owner authority and strict actor checks fail closed", async () => {
  const { call, draft, read } = setup(), { thoughtId } = await draft();
  const r = await read("dan", thoughtId);
  for (const args of [{ approved: false, approvalDigest: r.approvalDigest }, { approved: true, approvalDigest: "altered" }]) {
    await assert.rejects(call("dan", "shareSharedThought", { thoughtId, expectedVersion: 1, ...args }), { code: "shared_thought_approval_required" });
  }
  for (const actor of ["", "outsider"]) {
    await assert.rejects(read(actor, thoughtId), { code: "shared_thought_access_denied" });
    await assert.rejects(call(actor, "listSharedThoughts"), { code: "shared_thought_access_denied" });
  }
  for (const operation of ["shareSharedThought", "revokeSharedThought"]) await assert.rejects(call("sarah", operation,
    { thoughtId, expectedVersion: 1, ...(operation === "shareSharedThought" ? { approved: true, approvalDigest: r.approvalDigest } : {}) }), { code: "shared_thought_owner_only" });
  await assert.rejects(call("sarah", "prepareSharedThought", { title: "x", exactText: "x", assistantSummary: "" }), { code: "shared_thought_owner_only" });
  await assert.rejects(call("dan", "appendSharedThought", { thoughtId, expectedVersion: 1, exactText: "x" }), { code: "shared_thought_not_shared" });
  await assert.rejects(call("dan", "prepareSharedThought", { title: "x", exactText: "x", assistantSummary: "", author: "Sarah" }), { code: "shared_thought_invalid_input" });
});

test("revocation blocks read, search, append and receipt replay; re-sharing needs current approval", async () => {
  const { call, draft, read, share } = setup(), { thoughtId } = await draft(); await share(thoughtId);
  const args = { thoughtId, expectedVersion: 2, exactText: "Sarah's preserved contribution" };
  await call("sarah", "appendSharedThought", args, "sarah-replay");
  await call("dan", "revokeSharedThought", { thoughtId, expectedVersion: 3 });
  await assert.rejects(read("sarah", thoughtId), { code: "shared_thought_not_found" });
  await assert.rejects(call("sarah", "appendSharedThought", args, "sarah-replay"), { code: "shared_thought_not_found" });
  assert.equal((await call("sarah", "listSharedThoughts", { query: "preserved" })).thoughts.length, 0);
  assert.equal((await read("dan", thoughtId)).thought.contributions[0].exactText, args.exactText);
  await share(thoughtId);
  assert.equal((await read("sarah", thoughtId)).thought.contributions.length, 1);
});

test("atomic, actor-bound idempotency and optimistic concurrency", async () => {
  const { call, draft, read, share, firestoreDb } = setup();
  const [a, b] = await Promise.all([draft("same-draft"), draft("same-draft")]);
  assert.equal(a.thoughtId, b.thoughtId); assert.equal(b.replayed, true);
  const thoughtId = a.thoughtId; await share(thoughtId);
  const results = await Promise.allSettled([call("dan", "appendSharedThought", { thoughtId, expectedVersion: 2, exactText: "Dan" }, "same-both"), call("sarah", "appendSharedThought", { thoughtId, expectedVersion: 2, exactText: "Sarah" }, "same-both")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "shared_thought_version_conflict");
  const failed = results[0].status === "rejected" ? "dan" : "sarah";
  await call(failed, "appendSharedThought", { thoughtId, expectedVersion: 3, exactText: failed }, "same-both");
  assert.equal((await read("dan", thoughtId)).thought.contributions.length, 2);
  await assert.rejects(call("dan", "prepareSharedThought", { title: "Changed", exactText: "changed", assistantSummary: "" }, "same-draft"), { code: "idempotency_key_reused" });
  assert.equal([...firestoreDb.rows.keys()].filter(k => k.startsWith("taskManagementAuditEvents/")).length, 4);
});

test("discovery is bounded and cursor is bound to actor/query; legacy private data never enters results", async () => {
  const { call, draft, share, firestoreDb } = setup();
  await firestoreDb.collection("thinkTankEntries").doc("private").set({ exactText: "Private unrelated", ownerSub: "dan" });
  for (let i = 0; i < 4; i++) { const d = await draft(); if (i < 3) await share(d.thoughtId); }
  let cursor, count = 0;
  do { const page = await call("sarah", "listSharedThoughts", { limit: 1, ...(cursor ? { cursor } : {}) }); count += page.thoughts.length; cursor = page.nextCursor; if (cursor) await assert.rejects(call("dan", "listSharedThoughts", { cursor }), { code: "shared_thought_invalid_cursor" }); } while (cursor);
  assert.equal(count, 3);
  assert.equal((await call("sarah", "listSharedThoughts", { query: "Private unrelated" })).thoughts.length, 0);
  const filtered = await call("sarah", "listSharedThoughts", { query: "no match", limit: 1 });
  assert.equal(filtered.complete, false); assert(filtered.nextCursor);
});

test("catalog and live guidance expose the same narrow workflow; configuration fails closed", async () => {
  const { call } = setup();
  const catalog = listTaskManagementOperations({ query: "SharedThought", limit: 100 });
  assert.equal(catalog.count, 7);
  assert.match((await call("dan", "getSharedThoughtContext")).guidance.capture, /wait for Dan's explicit approval/);
  await assert.rejects(run({ operation: "getSharedThoughtContext", mode: "query", arguments: {} }, { taskAccess: { subject: "dan" }, sharedThoughtParticipants: {} }), { code: "shared_thought_not_configured" });
});

test("revoke races serialize against contributions; immutable content cannot be overwritten", async () => {
  const { call, draft, read, share } = setup(), { thoughtId } = await draft(); await share(thoughtId);
  const r = await Promise.allSettled([
    call("dan", "revokeSharedThought", { thoughtId, expectedVersion: 2 }),
    call("sarah", "appendSharedThought", { thoughtId, expectedVersion: 2, exactText: "Race" })
  ]);
  assert.equal(r[0].status, "fulfilled"); assert.equal(r[1].status, "rejected");
  assert.equal((await read("dan", thoughtId)).thought.contributions.length, 0);
  await assert.rejects(call("dan", "revokeSharedThought", { thoughtId, expectedVersion: 3, exactText: "Rewrite" }), { code: "shared_thought_invalid_input" });
});

test("failed atomic writes leave no thought, audit or receipt", async () => {
  const { call, draft, firestoreDb } = setup();
  const original = firestoreDb.runTransaction;
  firestoreDb.runTransaction = fn => original(async tx => {
    const result = await fn(tx);
    throw Object.assign(new Error("simulated transaction failure"), { code: "aborted" });
  });
  await assert.rejects(draft("failed-transaction"), { code: "aborted" });
  assert.equal(firestoreDb.rows.size, 0);
  firestoreDb.runTransaction = original;
  const d = await draft("failed-transaction"); assert.equal(d.version, 1);
  await assert.rejects(call("dan", "prepareSharedThought", { title: "x", exactText: "x" }, "short"), { code: "shared_thought_invalid_input" });
});
