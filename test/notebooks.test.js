"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runNotebookOperation } = require("../lib/notebooks-operation-registry");
const { processNotebookIndexingJob, chunks } = require("../lib/notebooks-service");

// Transactional in-memory Firestore: rejects reads after writes and rolls back
// failures, so tests exercise the production transaction contract.
class Store {
  constructor() { this.data = new Map(); this.tail = Promise.resolve(); }
  collection(name) { return new Query(this, name); }
  async runTransaction(action) {
    const run = this.tail.then(async () => {
      const writes = []; let writing = false;
      const result = await action({
        get: (ref) => { assert.equal(writing, false, "Firestore reads must precede writes"); return ref.get(); },
        create: (ref, value) => { writing = true; writes.push(() => ref.create(value)); },
        set: (ref, value) => { writing = true; writes.push(() => ref.set(value)); },
        update: (ref, value) => { writing = true; writes.push(() => ref.update(value)); },
        delete: (ref) => { writing = true; writes.push(() => ref.delete()); }
      });
      const backup = structuredClone(this.data);
      try { for (const write of writes) await write(); } catch (error) { this.data = backup; throw error; }
      return result;
    });
    this.tail = run.catch(() => {}); return run;
  }
}
class Ref {
  constructor(store, name, id) { this.store = store; this.key = `${name}/${id}`; this.id = id; }
  async get() { const v = this.store.data.get(this.key); return { id: this.id, exists: v !== undefined, data: () => structuredClone(v) }; }
  async set(v) { this.store.data.set(this.key, structuredClone(v)); }
  async create(v) { if (this.store.data.has(this.key)) throw Object.assign(new Error("already exists"), { code: 6 }); await this.set(v); }
  async update(v) { assert(this.store.data.has(this.key)); await this.set({ ...this.store.data.get(this.key), ...v }); }
  async delete() { this.store.data.delete(this.key); }
}
class Query {
  constructor(store, name, filters = [], order = "", after = "", maximum = Infinity, nearest = null) { Object.assign(this, { store, name, filters, order, after, maximum, nearest }); }
  copy(changes) { return Object.assign(new Query(this.store, this.name), this, changes); }
  doc(id) { return new Ref(this.store, this.name, id); }
  where(field, op, value) { return this.copy({ filters: [...this.filters, [field, op, value]] }); }
  orderBy(field) { return this.copy({ order: field }); }
  startAfter(value) { return this.copy({ after: value }); }
  limit(maximum) { return this.copy({ maximum }); }
  findNearest(nearest) { return this.copy({ nearest, maximum: nearest.limit }); }
  count() { return { get: async () => ({ data: () => ({ count: this.values().length }) }) }; }
  values() {
    let rows = [...this.store.data.entries()].filter(([key]) => key.startsWith(`${this.name}/`))
      .map(([key, value]) => ({ id: key.split("/")[1], ...structuredClone(value) }))
      .filter((v) => this.filters.every(([f, op, val]) => op === "==" ? v[f] === val : op === "in" ? val.includes(v[f]) : op === "array-contains-any" ? val.some((t) => v[f]?.includes(t)) : false));
    if (this.nearest) rows = rows.filter((r) => r.embeddingVector).map((r) => ({ ...r, vectorDistance: r.embeddingVector.reduce((n, x, i) => n + (x - this.nearest.queryVector[i]) ** 2, 0) })).sort((a, b) => a.vectorDistance - b.vectorDistance);
    else if (this.order) rows.sort((a, b) => a[this.order] < b[this.order] ? -1 : 1);
    if (this.after) rows = rows.filter((r) => r[this.order] > this.after);
    return rows.slice(0, this.maximum);
  }
  async get() { return { docs: this.values().map((v) => ({ id: v.id, data: () => { const { id, ...data } = v; return data; } })) }; }
}
function setup() {
  let counter = 0;
  const deps = { firestoreDb: new Store(), danOwnerSubjects: ["dan"], taskAccess: { subject: "dan", role: "admin" },
    privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: "dan", DAN_PRIVATE_DELEGATE_SUBJECTS: "sarah" },
    embeddingModel: "test", toVectorValue: (v) => v,
    embedText: async (s) => /leader|responsibilit|delegat/i.test(s) ? [1, 0] : [0, 1], enqueueNotebookIndexingJob: async () => {},
    now: () => new Date("2026-09-21T12:00:00.000Z") };
  const call = async (operation, args = {}, overrides = {}, key = `test-key-${++counter}`) => (await runNotebookOperation({ mode: ["getNotebook", "getNote", "browseNotebooks", "listNotes", "getNoteHistory", "searchNotes", "getIndexingStatus"].includes(operation) ? "query" : "command", operation, arguments: args, idempotencyKey: key }, { ...deps, ...overrides })).result;
  return { deps, call };
}

test("nested notebooks preserve IDs through moves, prevent cycles, allow duplicate names, and archive branches", async () => {
  const { call } = setup();
  const a = await call("createNotebook", { name: "Ministry" });
  const b = await call("createNotebook", { name: "Leadership", parentId: a.notebookId });
  const other = await call("createNotebook", { name: "Personal" });
  await call("createNotebook", { name: "Leadership", parentId: other.notebookId });
  const n = await call("createNote", { title: "Developing leaders", text: "Give responsibility gradually.", notebookId: b.notebookId });
  await assert.rejects(call("updateNotebook", { notebookId: a.notebookId, expectedVersion: 1, changes: { parentId: b.notebookId } }), { code: "notebooks_cycle" });
  await call("updateNotebook", { notebookId: b.notebookId, expectedVersion: 1, changes: { parentId: other.notebookId, name: "Training" } });
  assert.equal((await call("getNote", { noteId: n.noteId })).note.notebookPath, "Personal / Training");
  await call("updateNotebook", { notebookId: other.notebookId, expectedVersion: 1, changes: { archived: true } });
  assert.equal((await call("searchNotes", { query: "responsibility", mode: "words" })).results.length, 0);
  assert.equal((await call("searchNotes", { query: "responsibility", mode: "words", includeArchived: true })).results.length, 1);
  await call("updateNotebook", { notebookId: other.notebookId, expectedVersion: 2, changes: { archived: false } });
  assert.equal((await call("searchNotes", { query: "responsibility", mode: "words" })).results[0].notebookPath, "Personal / Training");
});

test("capture, immutable revisions, restore, explicit links, and independent readback", async () => {
  const { call } = setup();
  const exact = "  First thought.\n\nKeep these words.  ";
  const n = await call("createNote", { title: "Thought", text: exact, assistantSummary: "Interpretation" });
  assert.equal(n.note.text, exact); assert.equal(n.note.notebookPath, "Unfiled"); assert.equal(n.readBackVerified, true);
  await assert.rejects(call("updateNotebook", { notebookId: n.note.notebookId, expectedVersion: 1, changes: { archived: true } }));
  const edited = await call("updateNote", { noteId: n.noteId, expectedVersion: 1, changes: { text: "Changed" } });
  assert.equal(edited.version, 2);
  assert.equal((await call("getNoteHistory", { noteId: n.noteId, revisionId: n.revisionId })).revision.text, exact);
  const restored = await call("restoreNoteRevision", { noteId: n.noteId, expectedVersion: 2, revisionId: n.revisionId });
  assert.equal(restored.note.text, exact); assert.equal(restored.version, 3);
  const linked = await call("linkNoteRecord", { noteId: n.noteId, expectedVersion: 3, domain: "think_tank", recordId: "thought-test" });
  assert.deepEqual(linked.note.recordLinks, [{ domain: "think_tank", recordId: "thought-test" }]);
});

test("atomic idempotency and optimistic concurrency protect captures and edits", async () => {
  const { call, deps } = setup();
  const args = { title: "Capture", text: "Exact words" };
  const a = await call("createNote", args, {}, "stable-capture-key");
  const b = await call("createNote", args, {}, "stable-capture-key");
  assert.equal(a.noteId, b.noteId); assert.equal(b.replayed, true);
  await assert.rejects(call("createNote", { ...args, text: "Other" }, {}, "stable-capture-key"), { code: "idempotency_key_reused" });
  const results = await Promise.allSettled([1, 2].map((x) => call("updateNote", { noteId: a.noteId, expectedVersion: 1, changes: { title: `Edit ${x}` } })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await deps.firestoreDb.collection("danNotebookRevisions").get()).docs.length, 2);
  assert.equal((await call("getNote", { noteId: a.noteId })).note.version, 2);
});

test("Sarah edits with her identity; staff denied across search, revisions, jobs and commands", async () => {
  const { call } = setup();
  const n = await call("createNote", { title: "Private", text: "Owner content" });
  const sarah = { taskAccess: { subject: "sarah", role: "member" } };
  const edit = await call("updateNote", { noteId: n.noteId, expectedVersion: 1, changes: { title: "Edited by Sarah" } }, sarah);
  assert.equal(edit.note.ownerSubject, "dan"); assert.equal(edit.note.actorSub, "sarah");
  const outsider = { taskAccess: { subject: "staff-admin", role: "admin" } };
  for (const [op, args] of [["getNote", { noteId: n.noteId }], ["getNoteHistory", { noteId: n.noteId }], ["getIndexingStatus", { noteId: n.noteId }], ["searchNotes", { query: "Owner" }], ["browseNotebooks", {}], ["retryIndexing", { noteId: n.noteId, expectedVersion: 2 }]]) {
    await assert.rejects(call(op, args, outsider), { code: "dan_private_access_denied" });
  }
  await assert.rejects(call("getNote", { noteId: n.noteId }, { ...sarah, privateDelegationEnv: {} }), { code: "dan_private_access_denied" });
});

test("word and meaning search, tags, dates, subtree restriction, and long overlapping passages", async () => {
  const { call, deps } = setup();
  const root = await call("createNotebook", { name: "Ministry" });
  const child = await call("createNotebook", { name: "Leadership", parentId: root.notebookId });
  const n = await call("createNote", { notebookId: child.notebookId, title: "Responsibility", text: `${"Context. ".repeat(300)}Help future leaders by giving responsibility gradually.`, tags: ["Training"] });
  await call("createNote", { title: "Other", text: "Responsibility in another notebook." });
  const lexical = await call("searchNotes", { query: "giving responsibility gradually", mode: "words", notebookId: root.notebookId, tags: ["training"], updatedFrom: "2026-09-20", updatedTo: "2026-09-21" });
  assert.equal(lexical.results.length, 1); assert.equal(lexical.results[0].match, "exact");
  assert.equal(lexical.coverage.pendingIndexCount, 2);
  await processNotebookIndexingJob({ jobId: n.jobId }, deps);
  const semantic = await call("searchNotes", { query: "delegation", mode: "meaning", notebookId: root.notebookId });
  assert.equal(semantic.results[0].noteId, n.noteId); assert.equal(semantic.results[0].match, "meaning");
  assert(chunks(n.note).length > 1);
  assert.equal((await call("searchNotes", { query: "responsibility", tags: ["absent"] })).results.length, 0);
});

test("indexing failure keeps saved text searchable, supports retry and handles superseded jobs", async () => {
  const { call, deps } = setup();
  const n = await call("createNote", { title: "Retry", text: "Searchable immediately" }, { enqueueNotebookIndexingJob: async () => { throw new Error("outage"); } });
  assert.equal(n.indexingDelivery.status, "pending");
  assert.equal((await call("searchNotes", { query: "immediately", mode: "words" })).results[0].noteId, n.noteId);
  await assert.rejects(processNotebookIndexingJob({ jobId: n.jobId }, { ...deps, embedText: async () => { throw new Error("outage"); } }));
  assert.equal((await call("getIndexingStatus", { noteId: n.noteId })).indexingStatus, "failed");
  await call("retryIndexing", { noteId: n.noteId, expectedVersion: 1 });
  await processNotebookIndexingJob({ jobId: n.jobId }, deps);
  assert.equal((await call("getIndexingStatus", { noteId: n.noteId })).indexingStatus, "ready");
  const edit = await call("updateNote", { noteId: n.noteId, expectedVersion: 1, changes: { text: "New content" } });
  let moved = false;
  await processNotebookIndexingJob({ jobId: edit.jobId }, { ...deps, embedText: async () => {
    if (!moved) { moved = true; await call("updateNote", { noteId: n.noteId, expectedVersion: 2, changes: { text: "Latest content" } }); }
    return [1, 0];
  } });
  assert.equal((await deps.firestoreDb.collection("danNotebookJobs").doc(edit.jobId).get()).data().status, "superseded");
  assert.equal((await call("getNote", { noteId: n.noteId })).note.text, "Latest content");
  assert.equal((await call("searchNotes", { query: "New", mode: "words" })).results.length, 0);
});

test("pagination retains all lexical matches and rejects reused or stale cursors", async () => {
  const { call } = setup();
  for (let i = 0; i < 8; i++) await call("createNote", { title: `Note ${i}`, text: "Common searchable phrase" });
  let cursor = "", seen = new Set();
  do {
    const page = await call("searchNotes", { query: "Common", mode: "words", limit: 2, ...(cursor ? { cursor } : {}) });
    page.results.forEach((r) => seen.add(r.noteId)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 8);
  const page = await call("searchNotes", { query: "Common", mode: "words", limit: 2 });
  await assert.rejects(call("searchNotes", { query: "Other", mode: "words", cursor: page.nextCursor }), { code: "notebooks_invalid_cursor" });
  await call("createNote", { title: "New", text: "Common new note" });
  await assert.rejects(call("searchNotes", { query: "Common", mode: "words", cursor: page.nextCursor }), { code: "notebooks_stale_cursor" });
});

test("lexical pagination crosses candidate pages without losing matching notes", async () => {
  const { call } = setup();
  for (let i = 0; i < 108; i++) await call("createNote", { title: `Common ${i}`, text: "Common searchable phrase" });
  let cursor = "", pages = 0; const seen = new Set();
  do {
    const page = await call("searchNotes", { query: "Common", mode: "words", limit: 25, ...(cursor ? { cursor } : {}) });
    page.results.forEach((r) => seen.add(r.noteId)); cursor = page.nextCursor;
    assert(++pages < 20);
  } while (cursor);
  assert.equal(seen.size, 108);
});

test("assistant interpretations retain provenance even in later chunks", async () => {
  const { call } = setup();
  await call("createNote", { title: "Source", text: "Dan's exact words", assistantSummary: `${"Interpretation. ".repeat(200)} assistant-only-finding` });
  const result = await call("searchNotes", { query: "assistant-only-finding", mode: "words" });
  assert.equal(result.results[0].excerptSource, "assistant_summary");
});
