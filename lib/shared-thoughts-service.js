"use strict";

// A bounded extension of Task Management. These records never inherit broad
// private delegation, staff/admin access, or caller-supplied identity aliases.
const { createHash } = require("node:crypto");
const { getTaskAccess } = require("./task-management-access");
const { stableStringify } = require("./workspace-operation-execution");
const hash = value => createHash("sha256").update(value).digest("hex");
const DEFINITIONS = [
  ["getSharedThoughtContext", "query", [], [], "Read authenticated participant and Shared Thoughts workflow guidance."],
  ["listSharedThoughts", "query", [], ["query", "limit", "cursor"], "Discover only currently accessible Shared Thoughts; follow cursors even when a filtered page is empty."],
  ["getSharedThought", "query", ["thoughtId"], [], "Read a Shared Thought and its complete, ordered, attributed contributions."],
  ["prepareSharedThought", "command", ["title", "exactText"], ["assistantSummary"], "Dan prepares an immutable private draft for Sarah. Show the saved draft and ask approval before sharing."],
  ["shareSharedThought", "command", ["thoughtId", "expectedVersion", "approvalDigest", "approved"], [], "Dan explicitly approves this exact draft/history for Sarah. approved must be true after user approval."],
  ["appendSharedThought", "command", ["thoughtId", "expectedVersion", "exactText"], ["assistantSummary"], "Append the authenticated person's exact words to an actively shared thought; additions are visible to both people."],
  ["revokeSharedThought", "command", ["thoughtId", "expectedVersion"], [], "Dan revokes Sarah's future access and contributions; retained wording/history is unchanged."]
];
const OPERATIONS = DEFINITIONS.map(([name, mode, required, optional, summary]) => ({ name, mode, required, optional, summary }));
const NAMES = new Set(OPERATIONS.map(o => o.name));
const GUIDANCE = Object.freeze({
  version: "2026-10-25-v1", owner: "dan", systemOfRecord: "Task Management Shared Thoughts",
  capture: "Recognize requests to share thinking naturally. Select only the intended wording, verbatim, into exactText; keep concise AI interpretation in assistantSummary and title. Never archive a complete conversation or import unrelated private records. prepareSharedThought saves a Dan-only draft. Independently getSharedThought, show recipient Sarah, original wording and AI interpretation, and wait for Dan's explicit approval before shareSharedThought with the returned approvalDigest and current version. Changed wording requires a new private draft and renewed approval.",
  retrieve: "Use listSharedThoughts then getSharedThought; follow nextCursor until complete for a full inventory. Shared Thoughts access is explicit per record, independent of existing broader delegation. Never fall back to private Think Tank, notes, prayers, care, or chat history to answer what Dan shared.",
  collaborate: "Read current history first. Preserve each person's selected wording exactly, with AI summary separate. appendSharedThought is a visible contribution: use only when the signed-in person asks to add/respond; otherwise show a draft and obtain approval. Authorship and sequence come from the backend, never accept an author name from chat. Report Sarah's additions using their saved author, sequence and date; do not merge or rewrite earlier wording.",
  writes: "Use one stable idempotency key for each exact intent, current expectedVersion, then independently getSharedThought. On a conflict refresh and reconsider; never silently replay a stale share approval. After a timeout read before retrying. No messages or notifications are sent.",
  revoke: "Only Dan may revoke or re-share. Revocation blocks future reads/writes, including replays, but cannot erase text already viewed in another chat. Re-sharing exposes the full retained history and requires approval of its current digest."
});
function fail(message, code = "shared_thought_invalid_input", statusCode = 400) { throw Object.assign(new Error(message), { code, statusCode }); }
function text(value, field, maximum, optional = false) {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > maximum) fail(`Invalid ${field}`);
  return value; // Preserve original whitespace and Unicode exactly.
}
function id(value) {
  const result = text(value, "thoughtId", 100);
  if (!/^shared-thought-[a-f0-9]{40}$/.test(result)) fail("Invalid thoughtId");
  return result;
}
function access(deps) {
  const config = deps.sharedThoughtParticipants || {
    dan: process.env.SHARED_THOUGHTS_DAN_SUBJECT,
    sarah: process.env.SHARED_THOUGHTS_SARAH_SUBJECT
  };
  if (!config.dan || !config.sarah || config.dan === config.sarah) fail("Shared Thoughts participants are not configured", "shared_thought_not_configured", 503);
  const actor = getTaskAccess(deps);
  if (![config.dan, config.sarah].includes(actor.subject)) fail("Shared Thoughts requires an authorized individual identity", "shared_thought_access_denied", 403);
  return { ...config, subject: actor.subject, name: actor.subject === config.dan ? "Dan" : "Sarah" };
}
function owner(auth) { if (auth.subject !== auth.dan) fail("Only Dan may prepare or manage sharing", "shared_thought_owner_only", 403); }
function readable(record, auth) {
  return record && record.ownerSub === auth.dan && record.recipientSub === auth.sarah &&
    (auth.subject === auth.dan || record.state === "shared");
}
function requireRead(record, auth) {
  if (!readable(record, auth)) fail("Shared Thought not found", "shared_thought_not_found", 404);
}
function digest(record) {
  return hash(stableStringify({ thoughtId: record.thoughtId, recipientSub: record.recipientSub,
    title: record.title, exactText: record.exactText, assistantSummary: record.assistantSummary,
    contributions: record.contributions }));
}
function output(record, auth) {
  const { readerSubjects: _readers, ...thought } = record;
  return { thought, ...(auth.subject === auth.dan ? { approvalDigest: digest(record) } : {}) };
}
function db(deps) {
  if (!deps.firestoreDb?.runTransaction) fail("Shared Thoughts storage unavailable", "shared_thought_storage_unavailable", 503);
  return deps.firestoreDb;
}
function records(deps) { return db(deps).collection("danSharedThoughts"); }
async function getSharedThought(input, deps) {
  const auth = access(deps), snap = await records(deps).doc(id(input.thoughtId)).get();
  const record = snap.exists ? snap.data() : null;
  requireRead(record, auth);
  return output(record, auth);
}
async function listSharedThoughts(input, deps) {
  const auth = access(deps), size = input.limit === undefined ? 25 : input.limit;
  if (!Number.isInteger(size) || size < 1 || size > 100) fail("limit must be 1-100");
  const query = text(input.query, "query", 200, true).toLowerCase();
  const binding = hash(stableStringify({ subject: auth.subject, query }));
  let after = "";
  if (input.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
      if (cursor.binding !== binding) throw new Error();
      after = id(cursor.after);
    } catch { fail("Invalid cursor for this person/query", "shared_thought_invalid_cursor"); }
  }
  let q = records(deps).where("readerSubjects", "array-contains", auth.subject).orderBy("__name__");
  if (after) q = q.startAfter(after);
  const snap = await q.limit(size + 1).get(), page = snap.docs.slice(0, size);
  const thoughts = page.map(d => d.data()).filter(r => readable(r, auth))
    .filter(r => !query || [r.title, r.exactText, r.assistantSummary, ...r.contributions.flatMap(c => [c.exactText, c.assistantSummary])].join("\n").toLowerCase().includes(query))
    .map(r => ({ thoughtId: r.thoughtId, title: r.title, assistantSummary: r.assistantSummary,
      state: r.state, version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt,
      contributionCount: r.contributions.length, lastContribution: r.contributions.length ?
        { author: r.contributions.at(-1).author, sequence: r.contributions.at(-1).sequence, createdAt: r.contributions.at(-1).createdAt } : null }));
  const moreAvailable = snap.docs.length > size;
  return { thoughts, returnedCount: thoughts.length, scannedCount: page.length, moreAvailable, complete: !moreAvailable,
    nextCursor: moreAvailable ? Buffer.from(JSON.stringify({ binding, after: page.at(-1).id })).toString("base64url") : "" };
}
async function command(operation, input, key, deps) {
  const auth = access(deps);
  text(key, "idempotencyKey", 200);
  if (key.length < 8) fail("idempotencyKey must contain at least 8 characters");
  if (operation !== "appendSharedThought") owner(auth);
  const receiptId = `shared-thought-${hash(`${auth.subject}\0${key}`).slice(0, 40)}`;
  const thoughtId = operation === "prepareSharedThought" ? receiptId : id(input.thoughtId);
  const ref = records(deps).doc(thoughtId);
  const receiptRef = db(deps).collection("taskManagementOperationExecutions").doc(receiptId);
  const auditRef = db(deps).collection("taskManagementAuditEvents").doc(receiptId);
  const fingerprint = hash(stableStringify({ operation, input }));
  return db(deps).runTransaction(async tx => {
    const snapshot = await tx.get(ref), saved = snapshot.exists ? snapshot.data() : null;
    const receiptSnap = await tx.get(receiptRef);
    // Re-check current access before any receipt replay, including after revoke.
    if (operation !== "prepareSharedThought" || saved) requireRead(saved, auth);
    if (receiptSnap.exists) {
      const receipt = receiptSnap.data();
      if (receipt.fingerprint !== fingerprint) fail("Idempotency key already used for a different intent", "idempotency_key_reused", 409);
      return { ...receipt.result, replayed: true, currentVersion: saved.version, currentState: saved.state };
    }
    if (operation !== "prepareSharedThought" && (!Number.isInteger(input.expectedVersion) || input.expectedVersion !== saved.version)) fail("Thought changed; read it again", "shared_thought_version_conflict", 409);
    const at = new Date(deps.now ? deps.now() : Date.now()).toISOString();
    let next, sequence;
    if (operation === "prepareSharedThought") {
      if (saved) fail("Thought already exists", "shared_thought_exists", 409);
      next = { thoughtId, owner: "dan", ownerSub: auth.dan, recipientSub: auth.sarah,
        title: text(input.title, "title", 200), exactText: text(input.exactText, "exactText", 10000),
        assistantSummary: text(input.assistantSummary, "assistantSummary", 2000, true),
        author: { subject: auth.subject, name: auth.name }, state: "draft", readerSubjects: [auth.dan],
        contributions: [], version: 1, createdAt: at, updatedAt: at };
    } else {
      next = { ...saved, version: saved.version + 1, updatedAt: at };
      if (operation === "shareSharedThought") {
        if (input.approved !== true || input.approvalDigest !== digest(saved)) fail("Explicit approval of the exact saved content is required", "shared_thought_approval_required", 409);
        if (saved.state === "shared") fail("Thought already shared", "shared_thought_already_shared", 409);
        Object.assign(next, { state: "shared", readerSubjects: [auth.dan, auth.sarah], sharedAt: at,
          approvedBySub: auth.subject, approvedDigest: input.approvalDigest });
      } else if (operation === "revokeSharedThought") {
        if (saved.state !== "shared") fail("Thought is not currently shared", "shared_thought_not_shared", 409);
        Object.assign(next, { state: "revoked", readerSubjects: [auth.dan], revokedAt: at, revokedBySub: auth.subject });
      } else {
        if (saved.state !== "shared") fail("Contributions require active sharing", "shared_thought_not_shared", 409);
        if (saved.contributions.length >= 100) fail("This thought has reached the V1 limit of 100 contributions", "shared_thought_full", 409);
        sequence = saved.contributions.length + 1;
        next.contributions = [...saved.contributions, { sequence, author: { subject: auth.subject, name: auth.name },
          exactText: text(input.exactText, "exactText", 10000), assistantSummary: text(input.assistantSummary, "assistantSummary", 2000, true), createdAt: at }];
      }
    }
    if (Buffer.byteLength(JSON.stringify(next), "utf8") > 200000) fail("This thought has reached the V1 size limit", "shared_thought_full", 409);
    const result = { thoughtId, version: next.version, state: next.state, ...(sequence ? { sequence } : {}) };
    tx.set(ref, next);
    tx.create(receiptRef, { operation, actorSub: auth.subject, fingerprint, result, createdAt: at });
    tx.create(auditRef, { operation, actorSub: auth.subject, actorName: auth.name, targetIds: [thoughtId],
      version: next.version, createdAt: at, ...(operation === "shareSharedThought" ? { approvalDigest: input.approvalDigest } : {}) });
    return { ...result, replayed: false };
  });
}
async function runSharedThoughtOperation(request, deps) {
  const definition = OPERATIONS.find(o => o.name === request.operation && o.mode === request.mode);
  if (!definition) fail("Unknown Shared Thoughts operation or mode");
  const input = request.arguments ?? request.args ?? {};
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => ![...definition.required, ...definition.optional].includes(k))) fail("Unsupported Shared Thoughts arguments");
  if (definition.required.some(k => input[k] === undefined || input[k] === null)) fail("Missing required Shared Thoughts arguments");
  const auth = access(deps);
  let result;
  if (request.mode === "command") result = await command(request.operation, input, request.idempotencyKey, deps);
  else if (request.operation === "getSharedThoughtContext") result = { actor: { subject: auth.subject, name: auth.name }, recipient: { name: "Sarah", subject: auth.sarah }, guidance: GUIDANCE };
  else result = await ({ getSharedThought, listSharedThoughts })[request.operation](input, deps);
  return { operation: request.operation, mode: request.mode, result };
}
module.exports = { OPERATIONS, NAMES, GUIDANCE, runSharedThoughtOperation };
