"use strict";

const { createHash } = require("node:crypto");
const { requireDanPrivateAccess } = require("./dan-private-access");
const { stableStringify } = require("./workspace-operation-execution");

const MAX_TEXT = 100000;
const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 600;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const now = (deps) => new Date(deps.now ? deps.now() : Date.now()).toISOString();
function fail(message, code = "notebooks_invalid_input", statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}
function str(value, field, max = 300, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`Invalid ${field}`);
  return value.trim();
}
function id(value, field = "id", optional = false) {
  const result = str(value, field, 200, optional);
  if (result.includes("/") || result === "." || result === "..") fail(`Invalid ${field}`);
  return result;
}
function limit(value, fallback = 25) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 100) fail("limit must be between 1 and 100");
  return value;
}
function tags(value = []) {
  if (!Array.isArray(value) || value.length > 25) fail("tags must be an array of at most 25 values");
  return [...new Set(value.map((item) => str(item, "tag", 80).toLowerCase()))];
}
function links(value = []) {
  if (!Array.isArray(value) || value.length > 25) fail("links must be an array of at most 25 web URLs");
  return [...new Set(value.map((item) => {
    const text = str(item, "link", 2048);
    let url;
    try { url = new URL(text); } catch { fail("Invalid link URL"); }
    if (!["https:", "http:"].includes(url.protocol)) fail("Only http and https links are supported");
    return text;
  }))];
}
function references(value = []) {
  if (!Array.isArray(value) || value.length > 30) fail("Too many record links");
  return value.map((ref) => ({ domain: str(ref?.domain, "domain", 100), recordId: id(ref?.recordId, "recordId") }));
}
function text(value) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT) fail(`text must contain 1-${MAX_TEXT} characters`);
  return value; // Exact submitted wording, including whitespace.
}
function summary(value = "") {
  if (typeof value !== "string" || value.length > 10000) fail("Invalid assistantSummary");
  return value;
}
const tokens = (value) => [...new Set((value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []))];
function chunks(note) {
  const source = [`Title: ${note.title}`, "Note text:", note.text, `Tags: ${note.tags.join(", ")}`, `Links: ${note.links.join("\n")}`, `Assistant summary (interpretation): ${note.assistantSummary}`].join("\n");
  const result = [];
  for (let offset = 0; offset < source.length; offset += CHUNK_SIZE - CHUNK_OVERLAP) {
    const passage = source.slice(offset, offset + CHUNK_SIZE);
    const chunkId = `${note.noteId}-v${note.version}-${String(result.length).padStart(4, "0")}`;
    result.push({ chunkId, noteId: note.noteId, notebookId: note.notebookId, ownerSubject: note.ownerSubject,
      revisionId: note.revisionId, version: note.version, text: passage, tokens: tokens(passage), textHash: hash(passage) });
    if (offset + CHUNK_SIZE >= source.length) break;
  }
  return result;
}
function access(deps) {
  const auth = requireDanPrivateAccess(deps);
  // Canonical owner is configuration, never the caller or delegate.
  const ownerSubject = Array.isArray(deps.danOwnerSubjects) ? deps.danOwnerSubjects[0] : String(deps.danOwnerSubjects).split(",")[0].trim();
  return { ownerSubject, actorSub: auth.subject };
}
function collection(deps, kind) { return deps.firestoreDb.collection(`danNotebook${kind}`); }
function owned(data, ownerSubject) {
  if (!data || data.ownerSubject !== ownerSubject) fail("Record not found", "notebooks_not_found", 404);
  return data;
}
async function read(deps, kind, recordId, ownerSubject, tx) {
  const ref = collection(deps, kind).doc(id(recordId));
  const snap = await (tx ? tx.get(ref) : ref.get());
  return owned(snap.exists ? snap.data() : null, ownerSubject);
}
function version(data, expected) {
  if (!Number.isInteger(expected) || expected !== data.version) fail("Record changed; read it again before updating", "notebooks_version_conflict", 409);
}
async function ancestry(deps, notebookId, ownerSubject, tx) {
  const result = [], seen = new Set();
  while (notebookId) {
    if (seen.has(notebookId)) fail("Invalid notebook hierarchy", "notebooks_cycle", 409);
    seen.add(notebookId);
    const book = await read(deps, "Books", notebookId, ownerSubject, tx);
    result.unshift(book);
    notebookId = book.parentId;
  }
  return result;
}
function assertActive(path) {
  if (path.some((book) => book.archived)) fail("The destination notebook is archived", "notebooks_archived_destination", 409);
}
async function tree(deps, ownerSubject) {
  const records = new Map();
  let after = "";
  do {
    let query = collection(deps, "Books").where("ownerSubject", "==", ownerSubject).orderBy("notebookId").limit(500);
    if (after) query = query.startAfter(after);
    const snap = await query.get();
    for (const doc of snap.docs) records.set(doc.id, doc.data());
    after = snap.docs.length === 500 ? snap.docs.at(-1).id : "";
  } while (after);
  return records;
}
function bookPath(books, notebookId) {
  const result = [], seen = new Set();
  while (notebookId) {
    if (seen.has(notebookId)) fail("Invalid notebook hierarchy", "notebooks_cycle", 409);
    seen.add(notebookId);
    const book = books.get(notebookId);
    if (!book) fail("Notebook no longer exists", "notebooks_not_found", 404);
    result.unshift(book);
    notebookId = book.parentId;
  }
  return result;
}
function decorate(note, path) {
  return { ...note, notebookPath: path.map((b) => b.name).join(" / "), notebookPathIds: path.map((b) => b.notebookId),
    effectivelyArchived: Boolean(note.archived || path.some((b) => b.archived)) };
}
function cursorDecode(value, binding) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (parsed.binding !== hash(stableStringify(binding)) || typeof parsed.after !== "string") throw new Error();
    return parsed.after;
  } catch { fail("Cursor does not match this query; restart browsing", "notebooks_invalid_cursor"); }
}
function cursorEncode(after, binding) {
  return Buffer.from(JSON.stringify({ after, binding: hash(stableStringify(binding)) })).toString("base64url");
}

async function getNotebook(input, deps) {
  const { ownerSubject } = access(deps);
  const path = await ancestry(deps, id(input.notebookId), ownerSubject);
  return { notebook: decorate(path.at(-1), path) };
}
async function getNote(input, deps) {
  const { ownerSubject } = access(deps);
  const note = await read(deps, "Notes", input.noteId, ownerSubject);
  return { note: decorate(note, await ancestry(deps, note.notebookId, ownerSubject)) };
}
async function browseNotebooks(input, deps) {
  const { ownerSubject } = access(deps), books = await tree(deps, ownerSubject);
  const parentId = id(input.parentId, "parentId", true), size = limit(input.limit);
  if (parentId && !books.has(parentId)) fail("Notebook not found", "notebooks_not_found", 404);
  const records = [...books.values()].filter((b) => b.parentId === parentId)
    .map((b) => decorate(b, bookPath(books, b.notebookId)))
    .filter((b) => input.includeArchived === true || !b.effectivelyArchived)
    .filter((b) => !input.name || b.name.toLowerCase() === str(input.name, "name").toLowerCase())
    .sort((a, b) => a.notebookId.localeCompare(b.notebookId));
  const binding = { ownerSubject, parentId, includeArchived: input.includeArchived === true, name: input.name || "",
    snapshot: hash(stableStringify([...books.values()].map((b) => [b.notebookId, b.version]).sort())) };
  const after = cursorDecode(input.cursor, binding), remaining = records.filter((b) => b.notebookId > after);
  const selected = remaining.slice(0, size);
  return { notebooks: selected, nextCursor: remaining.length > size ? cursorEncode(selected.at(-1).notebookId, binding) : "",
    complete: remaining.length <= size };
}
async function listNotes(input, deps) {
  const { ownerSubject } = access(deps), notebookId = id(input.notebookId), size = limit(input.limit);
  const path = await ancestry(deps, notebookId, ownerSubject);
  const binding = { ownerSubject, notebookId, includeArchived: input.includeArchived === true };
  const after = cursorDecode(input.cursor, binding);
  let q = collection(deps, "Notes").where("ownerSubject", "==", ownerSubject).where("notebookId", "==", notebookId).orderBy("noteId");
  if (after) q = q.startAfter(after);
  const snap = await q.limit(size + 1).get(), page = snap.docs.slice(0, size);
  return { notes: page.map((s) => decorate(s.data(), path)).filter((n) => input.includeArchived === true || !n.effectivelyArchived)
    .map(({ text: _text, ...n }) => n), nextCursor: snap.docs.length > size ? cursorEncode(page.at(-1).id, binding) : "", complete: snap.docs.length <= size };
}
async function getNoteHistory(input, deps) {
  const { ownerSubject } = access(deps), size = limit(input.limit);
  await read(deps, "Notes", input.noteId, ownerSubject);
  if (input.revisionId) return { revision: await readRevision(input.noteId, input.revisionId, ownerSubject, deps) };
  const binding = { ownerSubject, noteId: input.noteId }, after = cursorDecode(input.cursor, binding);
  let q = collection(deps, "Revisions").where("ownerSubject", "==", ownerSubject).where("noteId", "==", input.noteId).orderBy("revisionId");
  if (after) q = q.startAfter(after);
  const snap = await q.limit(size + 1).get(), page = snap.docs.slice(0, size);
  return { revisions: page.map((s) => { const r = s.data(); return { revisionId: r.revisionId, version: r.version, title: r.title, updatedAt: r.updatedAt, actorSub: r.actorSub }; }),
    nextCursor: snap.docs.length > size ? cursorEncode(page.at(-1).id, binding) : "", complete: snap.docs.length <= size };
}
async function readRevision(noteId, revisionId, ownerSubject, deps, tx) {
  const revision = await read(deps, "Revisions", revisionId, ownerSubject, tx);
  if (revision.noteId !== noteId) fail("Revision does not belong to this note");
  return revision;
}
async function getIndexingStatus(input, deps) {
  const { ownerSubject } = access(deps);
  const note = await read(deps, "Notes", input.noteId, ownerSubject);
  const job = await read(deps, "Jobs", note.indexJobId, ownerSubject);
  return { noteId: note.noteId, version: note.version, indexingStatus: note.indexingStatus, job };
}

// The command, immutable revision, lexical index, receipt and audit commit together.
// Retrying after a process crash uses this receipt rather than mutating a second time.
async function runNotebookCommand(operation, input, idempotencyKey, deps) {
  const { ownerSubject, actorSub } = access(deps);
  const key = str(idempotencyKey, "idempotencyKey", 200);
  if (key.length < 8) fail("idempotencyKey must have at least 8 characters");
  const intentId = hash(`${ownerSubject}\0${actorSub}\0${key}`), fingerprint = hash(stableStringify({ operation, input }));
  const receiptRef = collection(deps, "Receipts").doc(intentId);
  const timestamp = now(deps);
  const outcome = await deps.firestoreDb.runTransaction(async (tx) => {
    const prior = await tx.get(receiptRef);
    if (prior.exists) {
      if (prior.data().fingerprint !== fingerprint) fail("Idempotency key used for a different command", "idempotency_key_reused", 409);
      return { ...prior.data().result, replayed: true };
    }
    const metadata = { owner: "dan", ownerSubject, actorSub, updatedAt: timestamp };
    const writeReceipt = (result) => {
      tx.create(receiptRef, { ownerSubject, actorSub, operation, fingerprint, result, createdAt: timestamp });
      tx.create(collection(deps, "Audit").doc(intentId), { ownerSubject, actorSub, operation, recordId: result.noteId || result.notebookId, version: result.version, createdAt: timestamp });
      return result;
    };
    if (operation === "createNotebook" || operation === "updateNotebook") {
      const creating = operation === "createNotebook", notebookId = creating ? `book-${intentId.slice(0, 32)}` : id(input.notebookId);
      const previous = creating ? null : await read(deps, "Books", notebookId, ownerSubject, tx);
      if (previous) version(previous, input.expectedVersion);
      const changes = creating ? input : input.changes;
      if (!changes || typeof changes !== "object" || Array.isArray(changes)) fail("changes must be an object");
      if (!creating && Object.keys(changes).some((k) => !["name", "parentId", "archived"].includes(k))) fail("Unsupported notebook change");
      if (previous?.system === "unfiled") fail("The Unfiled notebook cannot be renamed, moved or archived");
      const parentId = changes.parentId === undefined ? (previous?.parentId || "") : id(changes.parentId, "parentId", true);
      const path = await ancestry(deps, parentId, ownerSubject, tx);
      if (path.some((b) => b.notebookId === notebookId)) fail("A notebook cannot contain itself", "notebooks_cycle", 409);
      if (creating || parentId !== previous.parentId) assertActive(path);
      if (changes.archived !== undefined && typeof changes.archived !== "boolean") fail("archived must be boolean");
      const record = { ...previous, ...metadata, notebookId, name: changes.name === undefined && previous ? previous.name : str(changes.name, "name"),
        parentId, archived: changes.archived ?? previous?.archived ?? false, version: (previous?.version || 0) + 1, createdAt: previous?.createdAt || timestamp };
      tx.set(collection(deps, "Books").doc(notebookId), record);
      return writeReceipt({ notebookId, version: record.version });
    }
    const creating = operation === "createNote";
    const noteId = creating ? `note-${intentId.slice(0, 32)}` : id(input.noteId);
    const previous = creating ? null : await read(deps, "Notes", noteId, ownerSubject, tx);
    if (previous) version(previous, input.expectedVersion);
    if (operation === "retryIndexing") {
      const job = await read(deps, "Jobs", previous.indexJobId, ownerSubject, tx);
      tx.set(collection(deps, "Jobs").doc(job.jobId), { ...job, status: "pending", retryGeneration: (job.retryGeneration || 0) + 1, updatedAt: timestamp });
      tx.update(collection(deps, "Notes").doc(noteId), { indexingStatus: "pending" });
      return writeReceipt({ noteId, version: previous.version, jobId: job.jobId });
    }
    let changes = creating ? input : input.changes;
    if (operation === "restoreNoteRevision") {
      const revision = await readRevision(noteId, input.revisionId, ownerSubject, deps, tx);
      changes = Object.fromEntries(["title", "text", "tags", "links", "assistantSummary", "recordLinks"].map((k) => [k, revision[k]]));
    }
    if (operation === "linkNoteRecord") {
      changes = { recordLinks: [...previous.recordLinks, { domain: input.domain, recordId: input.recordId }] };
    }
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) fail("changes must be an object");
    if (!creating && Object.keys(changes).some((k) => !["title", "text", "tags", "links", "assistantSummary", "recordLinks", "notebookId", "archived"].includes(k))) fail("Unsupported note change");
    if (changes.archived !== undefined && typeof changes.archived !== "boolean") fail("archived must be boolean");
    const unfiledId = `unfiled-${hash(ownerSubject).slice(0, 24)}`;
    const notebookId = changes.notebookId === undefined ? (previous?.notebookId || unfiledId) : id(changes.notebookId, "notebookId");
    let unfiled = null, path;
    if (notebookId === unfiledId) {
      const snap = await tx.get(collection(deps, "Books").doc(unfiledId));
      if (!snap.exists) unfiled = { ...metadata, notebookId: unfiledId, parentId: "", name: "Unfiled", system: "unfiled", archived: false, version: 1, createdAt: timestamp };
      path = [unfiled || owned(snap.data(), ownerSubject)];
    } else path = await ancestry(deps, notebookId, ownerSubject, tx);
    if (creating || notebookId !== previous.notebookId || changes.archived === false) assertActive(path);
    const nextVersion = (previous?.version || 0) + 1;
    const revisionId = `${noteId}-v${String(nextVersion).padStart(10, "0")}`, jobId = `${noteId}-v${nextVersion}`;
    const note = { ...previous, ...metadata, noteId, notebookId, revisionId, indexJobId: jobId, indexingStatus: "pending", version: nextVersion,
      title: changes.title === undefined && previous ? previous.title : str(changes.title, "title"),
      text: changes.text === undefined && previous ? previous.text : text(changes.text),
      tags: changes.tags === undefined && previous ? previous.tags : tags(changes.tags),
      links: changes.links === undefined && previous ? previous.links : links(changes.links),
      assistantSummary: changes.assistantSummary === undefined && previous ? previous.assistantSummary : summary(changes.assistantSummary),
      recordLinks: changes.recordLinks === undefined && previous ? previous.recordLinks : references(changes.recordLinks),
      archived: changes.archived ?? previous?.archived ?? false, createdAt: previous?.createdAt || timestamp };
    const previousChunks = previous ? chunks(previous) : [];
    if (unfiled) tx.create(collection(deps, "Books").doc(unfiledId), unfiled);
    tx.set(collection(deps, "Notes").doc(noteId), note);
    tx.create(collection(deps, "Revisions").doc(revisionId), note);
    for (const chunk of previousChunks) tx.delete(collection(deps, "Chunks").doc(chunk.chunkId));
    for (const chunk of chunks(note)) tx.create(collection(deps, "Chunks").doc(chunk.chunkId), chunk);
    tx.create(collection(deps, "Jobs").doc(jobId), { jobId, noteId, ownerSubject, version: nextVersion, status: "pending", attempts: 0, retryGeneration: 0, createdAt: timestamp, updatedAt: timestamp });
    return writeReceipt({ noteId, version: nextVersion, revisionId, jobId });
  });
  let delivery = null;
  if (outcome.jobId) delivery = await enqueueJob(outcome.jobId, deps);
  const result = outcome.noteId ? await getNote({ noteId: outcome.noteId }, deps) : await getNotebook({ notebookId: outcome.notebookId }, deps);
  return { ...outcome, ...result, readBackVerified: true, ...(delivery ? { indexingDelivery: delivery } : {}) };
}
async function enqueueJob(jobId, deps) {
  const ref = collection(deps, "Jobs").doc(jobId), snap = await ref.get();
  if (!snap.exists || ["completed", "superseded"].includes(snap.data().status)) return { status: snap.data()?.status || "missing" };
  try {
    if (typeof deps.enqueueNotebookIndexingJob !== "function") throw new Error("Indexing delivery is not configured");
    await deps.enqueueNotebookIndexingJob({ jobId, retryGeneration: snap.data().retryGeneration || 0 });
    return { status: "queued" };
  } catch {
    // The durable job remains pending; a retry command can redeliver it.
    return { status: "pending", warning: "Note saved and word-searchable; meaning-based indexing delivery needs retry." };
  }
}

// Internal worker only: owner comes from the durable job, never request data.
async function processNotebookIndexingJob(input, deps) {
  const jobId = id(input.jobId), jobRef = collection(deps, "Jobs").doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) fail("Indexing job not found", "notebooks_not_found", 404);
  const job = snap.data();
  if (["completed", "superseded"].includes(job.status)) return { jobId, status: job.status };
  const note = await read(deps, "Notes", job.noteId, job.ownerSubject);
  if (note.version !== job.version) {
    await jobRef.update({ status: "superseded", updatedAt: now(deps) });
    return { jobId, status: "superseded" };
  }
  await deps.firestoreDb.runTransaction(async (tx) => {
    const current = (await tx.get(jobRef)).data();
    if (!["completed", "superseded"].includes(current.status)) tx.update(jobRef, { status: "processing", attempts: (current.attempts || 0) + 1, updatedAt: now(deps) });
  });
  try {
    const indexed = [];
    for (const chunk of chunks(note)) {
      const embedding = await deps.embedText(chunk.text, { taskType: "RETRIEVAL_DOCUMENT", model: deps.embeddingModel });
      if (!Array.isArray(embedding) || !embedding.length || embedding.length > 2048 || !embedding.every(Number.isFinite)) fail("Invalid embedding", "notebooks_invalid_embedding", 502);
      indexed.push({ ...chunk, embeddingVector: deps.toVectorValue(embedding), embeddingModel: deps.embeddingModel });
    }
    return await deps.firestoreDb.runTransaction(async (tx) => {
      const current = await read(deps, "Notes", job.noteId, job.ownerSubject, tx);
      if (current.version !== job.version) {
        tx.update(jobRef, { status: "superseded", updatedAt: now(deps) });
        return { jobId, status: "superseded" };
      }
      for (const chunk of indexed) tx.set(collection(deps, "Chunks").doc(chunk.chunkId), chunk);
      tx.update(collection(deps, "Notes").doc(note.noteId), { indexingStatus: "ready" });
      tx.update(jobRef, { status: "completed", updatedAt: now(deps) });
      return { jobId, status: "completed", chunkCount: indexed.length };
    });
  } catch (error) {
    await deps.firestoreDb.runTransaction(async (tx) => {
      const current = await read(deps, "Notes", job.noteId, job.ownerSubject, tx);
      const currentJob = (await tx.get(jobRef)).data();
      if (currentJob.status === "completed") return;
      const obsolete = current.version !== job.version;
      tx.update(jobRef, { status: obsolete ? "superseded" : "failed", errorCode: "notebooks_embedding_failed", updatedAt: now(deps) });
      if (!obsolete) tx.update(collection(deps, "Notes").doc(note.noteId), { indexingStatus: "failed" });
    });
    throw error;
  }
}

async function searchNotes(input, deps) {
  const { ownerSubject } = access(deps), size = limit(input.limit), queryText = str(input.query, "query", 500);
  const queryTokens = tokens(queryText);
  if (!queryTokens.length || queryTokens.length > 30) fail("Search requires 1-30 distinct words");
  const filterTags = tags(input.tags), root = id(input.notebookId, "notebookId", true);
  const mode = input.mode || "hybrid";
  if (!["hybrid", "words", "meaning"].includes(mode)) fail("Invalid search mode");
  const books = await tree(deps, ownerSubject);
  if (root && !books.has(root)) fail("Notebook not found", "notebooks_not_found", 404);
  const allowed = [...books.keys()].filter((bookId) => {
    const path = bookPath(books, bookId);
    return (!root || path.some((b) => b.notebookId === root)) && (input.includeArchived === true || !path.some((b) => b.archived));
  });
  const afterDate = input.updatedFrom || "", beforeDate = input.updatedTo || "";
  for (const date of [afterDate, beforeDate]) if (date && !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(date)) fail("Invalid date filter");
  if ([afterDate, beforeDate].some((d) => d && Number.isNaN(Date.parse(d)))) fail("Invalid date filter");
  const upperDate = beforeDate.length === 10 ? `${beforeDate}T23:59:59.999Z` : beforeDate;
  const binding = { ownerSubject, queryText, root, mode, filterTags, afterDate, beforeDate, archived: input.includeArchived === true,
    tree: hash(stableStringify([...books.values()].map((b) => [b.notebookId, b.version]).sort())) };
  const decoded = cursorDecode(input.cursor, binding);
  let pageState = { after: "", offset: 0, signature: "" };
  if (decoded) {
    try { pageState = JSON.parse(decoded); } catch { fail("Invalid search cursor"); }
    if (typeof pageState.after !== "string" || !Number.isInteger(pageState.offset) || pageState.offset < 0) fail("Invalid search cursor");
  }
  const after = pageState.after, candidateLimit = 200;
  const candidates = new Map();
  let lexicalMore = false, lexicalAfter = "", semanticAvailable = mode !== "words", semanticError = "";
  if (mode !== "meaning") {
    let q = collection(deps, "Chunks").where("ownerSubject", "==", ownerSubject).where("tokens", "array-contains-any", queryTokens).orderBy("chunkId");
    if (after) q = q.startAfter(after);
    const snap = await q.limit(candidateLimit + 1).get(), page = snap.docs.slice(0, candidateLimit);
    lexicalMore = snap.docs.length > candidateLimit;
    lexicalAfter = page.at(-1)?.id || "";
    page.forEach((s, rank) => candidates.set(s.id, { ...s.data(), lexicalRank: rank + 1 }));
  }
  if (mode !== "words" && allowed.length) {
    try {
      const embedding = await deps.embedText(queryText, { taskType: "RETRIEVAL_QUERY", model: deps.embeddingModel });
      // Scoped queries precede nearest-neighbor selection. The tree may move
      // without rewriting every descendant's index; notebook IDs stay stable.
      for (let start = 0; start < allowed.length; start += 30) {
        const q = collection(deps, "Chunks").where("ownerSubject", "==", ownerSubject)
          .where("notebookId", "in", allowed.slice(start, start + 30)).where("embeddingModel", "==", deps.embeddingModel);
        const snap = await q.findNearest({ vectorField: "embeddingVector", queryVector: embedding, limit: 100,
          distanceMeasure: "COSINE", distanceResultField: "vectorDistance" }).get();
        snap.docs.forEach((s) => candidates.set(s.id, { ...candidates.get(s.id), ...s.data(), semantic: true }));
      }
    } catch {
      semanticAvailable = false;
      semanticError = "Meaning-based search unavailable; word results may still be available.";
    }
  }
  const semanticRanks = [...candidates.values()].filter((c) => c.semantic).sort((a, b) => a.vectorDistance - b.vectorDistance);
  semanticRanks.forEach((c, rank) => { c.semanticRank = rank + 1; });
  const matches = new Map(), cache = new Map(), allowedSet = new Set(allowed);
  for (const chunk of candidates.values()) {
    if (!allowedSet.has(chunk.notebookId)) continue;
    if (!cache.has(chunk.noteId)) {
      const snap = await collection(deps, "Notes").doc(chunk.noteId).get();
      cache.set(chunk.noteId, snap.exists ? snap.data() : null);
    }
    const note = cache.get(chunk.noteId);
    if (!note || note.ownerSubject !== ownerSubject || note.version !== chunk.version || note.notebookId !== chunk.notebookId) continue;
    // Re-read ancestry so a concurrent archive/move cannot leak stale paths.
    const path = await ancestry(deps, note.notebookId, ownerSubject);
    if (root && !path.some((b) => b.notebookId === root)) continue;
    if (input.includeArchived !== true && (note.archived || path.some((b) => b.archived))) continue;
    if (!filterTags.every((tag) => note.tags.includes(tag))) continue;
    if (afterDate && note.updatedAt < afterDate || upperDate && note.updatedAt > upperDate) continue;
    const exact = `${note.title}\n${chunk.text}`.toLowerCase().includes(queryText.toLowerCase());
    const lexicalScore = queryTokens.filter((token) => chunk.tokens.includes(token)).length / queryTokens.length;
    const score = (exact ? 10 : 0) + lexicalScore + (chunk.lexicalRank ? 1 / (60 + chunk.lexicalRank) : 0) + (chunk.semanticRank ? 1 / (60 + chunk.semanticRank) : 0);
    if (!matches.has(note.noteId) || matches.get(note.noteId).score < score) matches.set(note.noteId, {
      noteId: note.noteId, title: note.title, notebookId: note.notebookId, notebookPath: path.map((b) => b.name).join(" / "),
      revisionId: note.revisionId, version: note.version, excerpt: chunk.text, excerptSource: "searchable passage (note text and labeled metadata)",
      score, match: exact ? "exact" : chunk.semantic ? "meaning" : "words", indexingStatus: note.indexingStatus, updatedAt: note.updatedAt
    });
  }
  // Aggregate over owner-indexed note metadata, not a scan of note contents.
  let pendingCount = null;
  try {
    const result = await collection(deps, "Notes").where("ownerSubject", "==", ownerSubject).where("indexingStatus", "in", ["pending", "failed"]).count().get();
    pendingCount = result.data().count;
  } catch { /* Availability metadata must not hide otherwise usable results. */ }
  const ordered = [...matches.values()].sort((a, b) => b.score - a.score || a.noteId.localeCompare(b.noteId));
  const signature = hash(stableStringify(ordered.map((n) => [n.noteId, n.version, n.score])));
  if (pageState.signature && pageState.signature !== signature) fail("Search results changed; restart the query", "notebooks_stale_cursor", 409);
  const moreResults = ordered.length > pageState.offset + size;
  const nextState = moreResults ? { after, offset: pageState.offset + size, signature }
    : lexicalMore ? { after: lexicalAfter, offset: 0, signature: "" } : null;
  return { query: queryText, results: ordered.slice(pageState.offset, pageState.offset + size), nextCursor: nextState ? cursorEncode(JSON.stringify(nextState), binding) : "",
    coverage: { exhaustive: false, lexicalMore, resultLimitReached: moreResults, candidateLimit,
      semanticAvailable, semanticTopKPerNotebookBatch: 100, pendingIndexCount: pendingCount,
      warning: semanticError || (pendingCount ? "Some saved notes are awaiting meaning-based indexing." : "Ranked retrieval is bounded; use words mode and pagination for lexical coverage.") } };
}

module.exports = { MAX_TEXT, chunks, tokens, getNotebook, getNote, browseNotebooks, listNotes, getNoteHistory,
  getIndexingStatus, runNotebookCommand, processNotebookIndexingJob, searchNotes };
