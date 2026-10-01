"use strict";

const { createHash } = require("node:crypto");
const { requireDanPrivateAccess, normalizeOwnerSubjects } = require("./dan-private-access");
const { stableStringify } = require("./workspace-operation-execution");
const { download } = require("./repository-library-service");

const hash = value => createHash("sha256").update(value).digest("hex");
const timestamp = deps => new Date(deps.now ? deps.now() : Date.now()).toISOString();
const collection = (deps, name) => deps.firestoreDb.collection(`danIntake${name}`);
const TERMINAL = new Set(["verified", "dismissed"]);
function fail(message, code = "intake_invalid_input", statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}
function text(value, field, max = 500, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`Invalid ${field}`);
  return value; // Source wording is never trimmed or rewritten.
}
function id(value, field = "id") {
  const result = text(value, field, 200);
  if (/[/\\\x00-\x1f]/.test(result) || result === "." || result === "..") fail(`Invalid ${field}`);
  return result;
}
function access(deps) {
  const actor = requireDanPrivateAccess(deps);
  return { ownerSubject: normalizeOwnerSubjects(deps.danOwnerSubjects)[0], actorSub: actor.subject };
}
function owned(snapshot, ownerSubject) {
  if (!snapshot.exists || snapshot.data().ownerSubject !== ownerSubject) fail("Intake not found", "intake_not_found", 404);
  return snapshot.data();
}
function expected(record, value) {
  if (!Number.isInteger(value) || value !== record.version) fail("Intake changed; read it again", "intake_version_conflict", 409);
}
function itemFor(record, itemId) {
  const item = record.items.find(i => i.itemId === id(itemId, "itemId"));
  if (!item) fail("Intake item not found", "intake_item_not_found", 404);
  return item;
}
function summary(record) {
  const unresolved = record.items.filter(i => !TERMINAL.has(i.status));
  return { intakeId: record.intakeId, title: record.title, version: record.version,
    createdAt: record.createdAt, updatedAt: record.updatedAt, extractionComplete: record.extractionComplete,
    sourceType: record.sourceType, sourcePreserved: record.sourceType !== "image" || Boolean(record.sourceFile),
    status: record.extractionComplete && unresolved.length === 0 ? "complete" : "open",
    itemCount: record.items.length, remainingCount: unresolved.length,
    verifiedCount: record.items.filter(i => i.status === "verified").length,
    sourceChecksum: record.sourceFile?.checksumSha256 || hash(record.exactText) };
}
function publicRecord(record) {
  const copy = structuredClone(record);
  if (copy.sourceFile) delete copy.sourceFile.storagePath;
  return { ...copy, ...summary(record) };
}
async function getIntake(input, deps) {
  const { ownerSubject } = access(deps);
  const record = owned(await collection(deps, "Records").doc(id(input.intakeId)).get(), ownerSubject);
  return { intake: publicRecord(record) };
}
async function listIntakes(input, deps) {
  const { ownerSubject } = access(deps);
  const size = input.limit ?? 25;
  if (!Number.isInteger(size) || size < 1 || size > 100) fail("limit must be 1-100");
  if (input.status && !["open", "complete"].includes(input.status)) fail("Invalid status");
  // Owner-scoped bounded read; filtering never silently truncates the inventory.
  const snapshot = await collection(deps, "Records").where("ownerSubject", "==", ownerSubject).limit(5001).get();
  if (snapshot.docs.length > 5000) fail("Intake inventory exceeds the complete-read limit", "intake_read_limit", 422);
  const records = snapshot.docs.map(d => summary(d.data())).filter(r => !input.status || r.status === input.status)
    .filter(r => !input.sourceChecksum || r.sourceChecksum === input.sourceChecksum)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.intakeId.localeCompare(b.intakeId));
  const binding = hash(stableStringify({ ownerSubject, status: input.status || "", sourceChecksum: input.sourceChecksum || "",
    records: records.map(r => [r.intakeId, r.version]) }));
  let offset = 0;
  if (input.cursor) {
    try {
      const c = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      if (c.binding !== binding || !Number.isInteger(c.offset) || c.offset < 0) throw new Error();
      offset = c.offset;
    } catch { fail("Inventory changed or cursor is invalid; restart browsing", "intake_invalid_cursor", 409); }
  }
  const page = records.slice(offset, offset + size), more = offset + size < records.length;
  return { intakes: page, totalCount: records.length, complete: !more,
    nextCursor: more ? Buffer.from(JSON.stringify({ binding, offset: offset + size })).toString("base64url") : "" };
}
async function getIntakeSource(input, deps) {
  const { ownerSubject } = access(deps);
  const record = owned(await collection(deps, "Records").doc(id(input.intakeId)).get(), ownerSubject);
  if (!record.sourceFile) fail("No original image was saved", "intake_source_unavailable", 404);
  const expires = Date.now() + 15 * 60 * 1000;
  const [url] = await deps.intakeBucket.file(record.sourceFile.storagePath).getSignedUrl({ version: "v4", action: "read", expires });
  return { intakeId: record.intakeId, source: publicRecord(record).sourceFile, download: { url, expiresAt: new Date(expires).toISOString() } };
}
async function getIntakeHistory(input, deps) {
  const { ownerSubject } = access(deps);
  owned(await collection(deps, "Records").doc(id(input.intakeId)).get(), ownerSubject);
  const size = input.limit ?? 25;
  if (!Number.isInteger(size) || size < 1 || size > 100) fail("limit must be 1-100");
  const after = input.afterVersion ?? 0;
  if (!Number.isInteger(after) || after < 0) fail("Invalid afterVersion");
  const snapshot = await collection(deps, "History").where("intakeId", "==", input.intakeId).limit(5001).get();
  if (snapshot.docs.length > 5000) fail("History exceeds complete-read limit", "intake_read_limit", 422);
  const events = snapshot.docs.map(d => d.data()).filter(r => r.ownerSubject === ownerSubject && r.version > after).sort((a, b) => a.version - b.version);
  const page = events.slice(0, size);
  return { events: page, complete: events.length <= size, nextAfterVersion: events.length > size ? page.at(-1).version : null };
}

function proposal(value, deps) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("proposal must be an object");
  const destination = text(value.destination, "destination", 100);
  const adapter = deps.intakeDestinations?.[destination];
  if (!adapter) fail("Destination is not supported by durable intake; use its owning workflow", "intake_destination_unavailable", 422);
  if (!["create", "update", "link"].includes(value.action)) fail("action must be create, update, or link");
  if (!adapter.actions.includes(value.action)) fail("Destination does not support this action");
  const args = value.arguments ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) fail("arguments must be an object");
  if (Buffer.byteLength(stableStringify(args)) > 20000) fail("Proposal is too large");
  const normalized = { destination, action: value.action, recordId: value.action === "create" ? "" : id(value.recordId, "recordId"), arguments: args,
    rationale: text(value.rationale, "rationale", 2000, true),
    duplicateCheck: text(value.duplicateCheck, "duplicateCheck", 2000) };
  // Preparation is pure: reject malformed routing before it can be approved
  // and locked. The actual dispatch identity is assigned only after approval.
  adapter.prepare(normalized, { ...access(deps), idempotencyKey: "proposal-validation-only" });
  return normalized;
}
function ensureMutable(item) {
  if (!["proposed", "needs_details"].includes(item.status)) fail("Approved or settled items cannot be rewritten", "intake_item_locked", 409);
}

// Receipt and workflow change commit together. File I/O happens before the
// transaction at a deterministic content path; orphan bytes are never a saved intake.
async function runIntakeCommand(operation, input, idempotencyKey, deps) {
  const { ownerSubject, actorSub } = access(deps);
  if (operation === "recordIntakeDomainVerification" && deps.trustedDomainVerification !== true) fail("Owning gateway verification required", "intake_domain_readback_required", 403);
  const key = text(idempotencyKey, "idempotencyKey", 200);
  if (key.length < 8) fail("Use an idempotency key of at least eight characters");
  const intentId = hash(`${ownerSubject}\0${actorSub}\0${key}`);
  const creating = operation === "createIntake";
  const intakeId = creating ? `intake-${intentId.slice(0, 32)}` : id(input.intakeId, "intakeId");
  const ref = collection(deps, "Records").doc(intakeId), receiptRef = collection(deps, "Receipts").doc(intentId);
  // Expiring URLs are transport only. Bind replay to the stable host file ID.
  const identityInput = structuredClone(input);
  if (identityInput.file) identityInput.file = { id: text(input.file.id || input.file.file_id, "file.id", 500) };
  const fingerprint = hash(stableStringify({ operation, input: identityInput }));
  const oldReceipt = await receiptRef.get();
  if (oldReceipt.exists) {
    if (oldReceipt.data().fingerprint !== fingerprint) fail("Idempotency key reused for different intent", "idempotency_key_reused", 409);
    return { ...oldReceipt.data().result, replayed: true, ...(await getIntake({ intakeId }, deps)), readBackVerified: true };
  }
  let sourceFile;
  if (operation === "attachIntakeImage") {
    const record = owned(await ref.get(), ownerSubject);
    expected(record, input.expectedVersion);
    if (record.sourceType !== "image" || record.sourceFile) fail("This intake cannot accept another source image");
    const image = await download(input.file, deps);
    const storagePath = `dan/intake/${hash(ownerSubject).slice(0, 24)}/${intakeId}/${image.checksumSha256}.${image.extension}`;
    const file = deps.intakeBucket.file(storagePath);
    await file.save(image.bytes, { resumable: false, contentType: image.contentType, metadata: { cacheControl: "private, no-store" } });
    const [saved] = await file.download();
    if (hash(saved) !== image.checksumSha256) fail("Stored original did not match", "intake_source_checksum_mismatch", 500);
    sourceFile = { storagePath, checksumSha256: image.checksumSha256, sizeBytes: image.bytes.length,
      contentType: image.contentType, width: image.width, height: image.height, fileId: identityInput.file.id };
  }
  let verification;
  if (operation === "verifyIntakeItem") {
    const record = owned(await ref.get(), ownerSubject); expected(record, input.expectedVersion);
    const item = itemFor(record, input.itemId);
    if (!["dispatching", "verified"].includes(item.status)) fail("Prepare this item for dispatch first");
    const adapter = deps.intakeDestinations?.[item.proposal.destination];
    if (!adapter?.verify) fail("Destination verification is unavailable", "intake_destination_unavailable", 503);
    verification = await adapter.verify(item.dispatch, deps);
    if (!verification?.verified || verification.recordId !== item.dispatch.recordId) fail("Destination has not been verified", "intake_destination_unverified", 409);
  }
  const result = await deps.firestoreDb.runTransaction(async tx => {
    const [receipt, existing] = await Promise.all([tx.get(receiptRef), tx.get(ref)]);
    if (receipt.exists) {
      if (receipt.data().fingerprint !== fingerprint) fail("Idempotency key reused for different intent", "idempotency_key_reused", 409);
      return { ...receipt.data().result, replayed: true };
    }
    const at = timestamp(deps);
    let record;
    if (creating) {
      if (existing.exists) fail("Intake already exists", "intake_exists", 409);
      if (input.sensitivity !== "general") fail("Restricted domain sources must use their owning intake, not general intake", "intake_sensitive_source", 422);
      if (!["text", "image"].includes(input.sourceType)) fail("sourceType must be text or image");
      record = { intakeId, ownerSubject, actorSub, title: text(input.title, "title"), sourceType: input.sourceType,
        exactText: text(input.exactText, "exactText", 100000, input.sourceType === "image"),
        transcript: "", uncertainties: [], sourceFile: null, extractionComplete: false, items: [],
        version: 1, createdAt: at, updatedAt: at };
    } else {
      record = owned(existing, ownerSubject); expected(record, input.expectedVersion);
      record = structuredClone(record); record.version += 1; record.updatedAt = at; record.actorSub = actorSub;
      if (operation === "attachIntakeImage") {
        if (record.sourceFile) fail("Original source is immutable", "intake_source_locked", 409);
        record.sourceFile = sourceFile;
      } else if (operation === "saveIntakeExtraction") {
        record.transcript = text(input.transcript, "transcript", 100000, true);
        if (!Array.isArray(input.uncertainties) || input.uncertainties.length > 100) fail("uncertainties must be an array of up to 100 questions");
        record.uncertainties = input.uncertainties.map(q => text(q, "uncertainty", 2000));
        // Changing extraction requires another explicit finish; existing approved
        // item text remains locked to the extraction the user actually approved.
        record.extractionComplete = false;
      } else if (operation === "finishIntakeExtraction") {
        if (record.sourceType === "image" && !record.sourceFile) fail("Original image is not durably saved", "intake_source_unavailable", 409);
        if (record.uncertainties.length) fail("Resolve extraction uncertainties before finishing", "intake_needs_details", 409);
        record.extractionComplete = true;
      } else if (operation === "proposeIntakeItem") {
        if (record.extractionComplete) fail("Save revised extraction before adding or revising items", "intake_extraction_closed", 409);
        const itemId = input.itemId ? id(input.itemId, "itemId") : `item-${intentId.slice(0, 24)}`;
        const previous = record.items.find(i => i.itemId === itemId);
        if (previous) ensureMutable(previous);
        if (!previous && record.items.length >= 100) fail("Use at most 100 items per intake");
        const questions = input.questions ?? [];
        if (!Array.isArray(questions) || questions.length > 20) fail("Use at most 20 questions per item");
        if (!input.proposal && !questions.length) fail("An unrouted item requires a question or unresolved handoff detail");
        const item = { itemId, exactText: text(input.exactText, "exactText", 10000),
          interpretation: text(input.interpretation, "interpretation", 2000, true),
          questions: questions.map(q => text(q, "question", 2000)), proposal: input.proposal ? proposal(input.proposal, deps) : null,
          status: questions.length ? "needs_details" : "proposed" };
        item.proposalHash = hash(stableStringify({ exactText: item.exactText, interpretation: item.interpretation, proposal: item.proposal }));
        if (previous) record.items[record.items.indexOf(previous)] = item; else record.items.push(item);
      } else if (operation === "approveIntakeItem") {
        const item = itemFor(record, input.itemId); ensureMutable(item);
        if (item.questions.length) fail("Resolve this item's questions before approval", "intake_needs_details", 409);
        if (input.proposalHash !== item.proposalHash) fail("Proposal changed; review the current proposal", "intake_proposal_changed", 409);
        item.approvalNote = text(input.approvalNote, "approvalNote", 2000);
        item.approvedAt = at; item.approvedBy = actorSub; item.status = "approved";
      } else if (operation === "dismissIntakeItem") {
        const item = itemFor(record, input.itemId);
        if (["dispatching", "verified"].includes(item.status)) fail("A dispatched item cannot be dismissed; reconcile its target", "intake_item_locked", 409);
        item.dismissalReason = text(input.reason, "reason", 2000); item.status = "dismissed";
      } else if (operation === "prepareIntakeDispatch") {
        const item = itemFor(record, input.itemId);
        if (item.status !== "approved") fail("An approved item is required", "intake_item_locked", 409);
        const adapter = deps.intakeDestinations[item.proposal.destination];
        item.dispatch = adapter.prepare(item.proposal, {
          ownerSubject, actorSub, intakeId, itemId: item.itemId,
          idempotencyKey: `intake-${hash(`${intakeId}/${item.itemId}/${item.proposalHash}`).slice(0, 48)}`
        });
        item.status = "dispatching";
      } else if (operation === "recordIntakeDomainVerification") {
        const item = itemFor(record, input.itemId), dispatch = item.dispatch;
        if (item.status !== "dispatching" || dispatch?.destination !== "domain_reference") fail("Prepare an approved domain reference first");
        const receipt = input.receipt;
        if (!receipt || receipt.system !== dispatch.system || receipt.recordId !== dispatch.recordId ||
          (dispatch.expectedVersion && receipt.version !== dispatch.expectedVersion)) fail("Read-back did not match the locked reference", "intake_destination_unverified", 409);
        if (receipt.version !== null && (!Number.isInteger(receipt.version) || receipt.version < 1)) fail("Invalid reference version");
        item.outcome = { verified: true, destination: "domain_reference", system: dispatch.system, recordId: dispatch.recordId,
          version: receipt.version, method: "owning_gateway_readback", verifiedAt: at, verifiedBy: actorSub };
        item.status = "verified";
      } else if (operation === "verifyIntakeItem") {
        const item = itemFor(record, input.itemId);
        if (!["dispatching", "verified"].includes(item.status)) fail("Dispatch state changed", "intake_item_locked", 409);
        item.outcome = { ...verification, verifiedAt: at, verifiedBy: actorSub };
        item.status = "verified";
      } else fail("Unknown intake command");
    }
    if (Buffer.byteLength(stableStringify(record)) > 750000) fail("Intake exceeds safe document size; split the source into smaller batches");
    const saved = { intakeId, version: record.version, operation };
    tx.set(ref, record);
    tx.create(receiptRef, { ownerSubject, actorSub, fingerprint, result: saved, createdAt: at });
    tx.create(collection(deps, "History").doc(`${intakeId}-${String(record.version).padStart(8, "0")}`), {
      intakeId, ownerSubject, actorSub, version: record.version, operation, occurredAt: at,
      itemId: input.itemId || "", transcript: operation === "saveIntakeExtraction" ? record.transcript : "",
      uncertainties: operation === "saveIntakeExtraction" ? record.uncertainties : [],
      item: ["proposeIntakeItem", "approveIntakeItem", "dismissIntakeItem", "prepareIntakeDispatch", "verifyIntakeItem", "recordIntakeDomainVerification"].includes(operation)
        ? record.items.find(i => i.itemId === input.itemId) || record.items.at(-1) : null
    });
    return saved;
  });
  return { ...result, ...(await getIntake({ intakeId }, deps)), readBackVerified: true };
}

async function dispatchIntakeItem(input, idempotencyKey, deps) {
  const { actorSub } = access(deps);
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 180) fail("Dispatch key must contain 8-180 characters");
  let result = await getIntake(input, deps);
  let item = itemFor(result.intake, input.itemId);
  if (item.status === "approved") {
    result = await runIntakeCommand("prepareIntakeDispatch", input, `${idempotencyKey}:prepare`, deps);
    item = itemFor(result.intake, input.itemId);
  } else if (!["dispatching", "verified"].includes(item.status)) fail("Approve the exact item before dispatch", "intake_item_locked", 409);
  if (item.status === "verified") return { ...result, readBackVerified: true, alreadyVerified: true };
  const adapter = deps.intakeDestinations[item.proposal.destination];
  // Recovery first: a destination may have saved successfully before the client
  // lost its response. Never issue another write merely to discover that fact.
  let verification;
  try { verification = await adapter.verify(item.dispatch); }
  catch (error) { if (error.statusCode !== 404) throw error; }
  if (!verification?.verified) {
    if (item.dispatch.actorSub !== actorSub) fail("The original actor must resume this write; a delegate can verify an existing result", "intake_dispatch_actor_changed", 409);
    if (item.dispatch.action === "create" && verification) fail("The locked target exists with different content; reconcile it before proceeding", "intake_destination_conflict", 409);
    if (item.dispatch.action === "link") fail("Linked destination is unavailable", "intake_destination_unverified", 409);
    await adapter.execute(item.dispatch);
  }
  // Refresh after the external operation. Other items may have changed while
  // it ran; the target of this item is immutable once dispatch started.
  result = await getIntake(input, deps);
  return runIntakeCommand("verifyIntakeItem", { intakeId: input.intakeId, itemId: input.itemId,
    expectedVersion: result.intake.version }, `${idempotencyKey}:verify`, deps);
}

module.exports = { getIntake, listIntakes, getIntakeSource, getIntakeHistory, runIntakeCommand, dispatchIntakeItem, summary };
