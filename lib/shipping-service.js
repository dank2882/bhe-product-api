"use strict";

const { getTaskAccess } = require("./task-management-access");
const M = require("./shipping-model");
const uploadService = require("./shipping-upload-service");
const costPlanning = require("./shipping-cost-planning");
const now = deps => new Date(deps.now ? deps.now() : Date.now()).toISOString();
const collection = (deps, name) => deps.firestoreDb.collection("fbcShipping" + name);
const commandSections = { upsertParty: "parties", upsertContainer: "containers", recordRouteLeg: "routeLegs", recordMilestone: "milestones", upsertCargo: "cargo", upsertRequirement: "requirements", recordDocument: "documents", recordCostDocument: "costs", recordPayment: "payments", recordIncident: "incidents", addSource: "sources" };
const immutableSections = new Set(["milestones", "documents", "costs", "payments", "sources"]);
function access(deps, scope = "shipping.read") {
  const a = getTaskAccess(deps), allowed = Array.isArray(deps.shippingOwnerSubjects) ? deps.shippingOwnerSubjects : [];
  if (!allowed.length) M.fail("Shipping owner identity is not configured", "shipping_unavailable", 503);
  // No role-based admin bypass or private-domain delegation. Identity aliases
  // come from the authenticated gateway/profile, never operation arguments.
  if (!a.subject || !a.subjects.some(s => allowed.includes(s)) || !a.scopes.includes(scope)) M.fail("Shipping is restricted to the authorized FBC owner", "shipping_access_denied", 403);
  return a;
}
function owned(s) { if (!s || s.owner !== "fbc") M.fail("Shipment not found", "shipping_not_found", 404); return s; }
async function read(deps, shipmentId, tx) { const ref = collection(deps, "Shipments").doc(M.id(shipmentId)); const snap = await (tx ? tx.get(ref) : ref.get()); return owned(snap.exists ? snap.data() : null); }
function checkVersion(s, expected) { if (!Number.isSafeInteger(expected) || expected !== s.version) M.fail("Shipment changed; read it again before updating", "shipping_version_conflict", 409); }
function publicRecord(s, a) {
  const copy = structuredClone(s);
  copy.documents = copy.documents.map(d => {
    if (d.sensitivity === "restricted" && !a.scopes.includes("shipping.documents.restricted")) return { id: d.id, sensitivity: "restricted", restricted: true };
    const { storagePath, ...metadata } = d; return { ...metadata, fileAvailable: !!storagePath };
  });
  return copy;
}
function summary(s) { return { shipmentId: s.shipmentId, title: s.title, owner: s.owner, destinationCountry: s.destinationCountry, destinationCity: s.destinationCity || "", recordKind: s.recordKind, status: s.status, version: s.version, needBy: s.needBy || "", containerCount: s.containers.length, updatedAt: s.updatedAt, issueCount: M.qualityIssues(s).length, sourceCount: s.sources.length }; }
function pageSize(value) { if (value === undefined) return 25; if (!Number.isInteger(value) || value < 1 || value > 100) M.fail("limit must be 1–100"); return value; }
async function listShipments(input, deps) {
  access(deps); const limit = pageSize(input.limit);
  const filter = { country: input.country || "", status: input.status || "", recordKind: input.recordKind || "", query: input.query || "" };
  for (const value of Object.values(filter)) if (typeof value !== "string" || value.length > 300) M.fail("Invalid filter");
  let after = "";
  if (input.cursor) try { const c = JSON.parse(Buffer.from(input.cursor, "base64url").toString()); if (c.binding !== M.hash(filter)) throw Error(); after = M.id(c.after); } catch { M.fail("Cursor does not match query", "shipping_invalid_cursor"); }
  let query = collection(deps, "Shipments").orderBy("__name__");
  if (after) query = query.startAfter(after);
  const snap = await query.limit(limit + 1).get(), page = snap.docs.slice(0, limit);
  const shipments = page.map(d => d.data()).filter(s => s.owner === "fbc")
    .filter(s => !filter.country || s.destinationCountry.toLowerCase() === filter.country.toLowerCase())
    .filter(s => !filter.status || s.status === filter.status)
    .filter(s => !filter.recordKind || s.recordKind === filter.recordKind)
    .filter(s => !filter.query || [s.title, s.billOfLading, s.bookingNumber, ...s.references].join(" ").toLowerCase().includes(filter.query.toLowerCase()));
  return { shipments: shipments.map(summary), nextCursor: snap.docs.length > limit ? Buffer.from(JSON.stringify({ after: page.at(-1).id, binding: M.hash(filter) })).toString("base64url") : "", complete: snap.docs.length <= limit, scanned: page.length, coverage: "Filters apply to this scanned page; follow nextCursor even if no rows match." };
}
async function getShipment(input, deps) { const a = access(deps), s = await read(deps, input.shipmentId); return { shipment: publicRecord(s, a), readiness: M.readiness(s, now(deps).slice(0, 10)), costs: M.costSummary(s, now(deps).slice(0, 10)) }; }
async function getReadiness(input, deps) { access(deps); return M.readiness(await read(deps, input.shipmentId), now(deps).slice(0, 10)); }
async function getCostSummary(input, deps) { access(deps); return M.costSummary(await read(deps, input.shipmentId), now(deps).slice(0, 10)); }
async function getDocumentChecklist(input, deps) { const a = access(deps), s = await read(deps, input.shipmentId); return { requirements: s.requirements, documents: publicRecord(s, a).documents }; }
async function getSchedule(input, deps) {
  const result = await listShipments(input, deps);
  const schedules = [];
  for (const item of result.shipments) { const s = await read(deps, item.shipmentId); schedules.push({ ...item, milestones: M.activeMilestones(s).sort((a, b) => a.date.localeCompare(b.date)), missing: M.readiness(s, now(deps).slice(0, 10)).missing }); }
  return { ...result, shipments: schedules };
}
async function getHistoryInsights(input, deps) {
  const page = await listShipments(input, deps), records = [];
  for (const item of page.shipments) records.push(await read(deps, item.shipmentId));
  return { ...M.historyInsights(records), nextCursor: page.nextCursor, complete: page.complete, coverage: "Samples cover this page only; no population average is asserted." };
}
async function getShipmentHistory(input, deps) {
  const a = access(deps); await read(deps, input.shipmentId);
  const version = M.integer(input.version); const snap = await collection(deps, "Revisions").doc(input.shipmentId + "-v" + version).get();
  if (!snap.exists) M.fail("Revision not found", "shipping_not_found", 404);
  return { shipment: publicRecord(owned(snap.data()), a) };
}
async function getDocument(input, deps) {
  access(deps); const s = await read(deps, input.shipmentId), d = s.documents.find(v => v.id === input.documentId);
  if (!d) M.fail("Document not found", "shipping_not_found", 404);
  if (d.sensitivity === "restricted") access(deps, "shipping.documents.restricted");
  if (!d.storagePath) return { document: d, fileAvailable: false, note: "Only source/metadata is tracked; no original file uploaded." };
  if (!deps.bucket) M.fail("Document storage unavailable", "shipping_unavailable", 503);
  const [downloadUrl] = await deps.bucket.file(d.storagePath).getSignedUrl({ version: "v4", action: "read", expires: Date.parse(now(deps)) + 15 * 60 * 1000, responseDisposition: "attachment" });
  const { storagePath, ...metadata } = d;
  return { document: metadata, downloadUrl, expiresInSeconds: 900 };
}
async function createDocumentUpload(input, key, deps) {
  const actor = access(deps, "shipping.write"), shipment = await read(deps, input.shipmentId);
  checkVersion(shipment, input.expectedVersion);
  return uploadService.create(input, key, deps, actor, shipment);
}
async function prepareFile(input, deps) {
  access(deps, "shipping.write");
  const s = await read(deps, input.shipmentId); checkVersion(s, input.expectedVersion);
  const metadata = M.shapes.documents(input.document);
  if (metadata.sensitivity === "restricted") access(deps, "shipping.documents.restricted");
  if (!deps.bucket) M.fail("Document storage unavailable", "shipping_unavailable", 503);
  if (typeof input.contentBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.contentBase64)) M.fail("Invalid base64 file");
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.toString("base64") !== input.contentBase64) M.fail("File must be valid base64 and at most 10 MiB");
  const signatures = { "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-", "image/png": bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", "image/jpeg": bytes.subarray(0, 3).toString("hex") === "ffd8ff" };
  if (!signatures[input.mimeType]) M.fail("Only PDF, PNG and JPEG originals with matching signatures are supported");
  const filename = M.string(input.filename, "filename", 200); if (/[\/\\\r\n]/.test(filename)) M.fail("Invalid filename");
  const fileHash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  const storagePath = "fbc-shipping/" + s.shipmentId + "/" + fileHash;
  await deps.bucket.file(storagePath).save(bytes, { resumable: false, contentType: input.mimeType, metadata: { cacheControl: "private, no-store" }, preconditionOpts: { ifGenerationMatch: 0 } }).catch(e => { if (Number(e.code) !== 412) throw e; });
  return { ...metadata, storagePath, sha256: fileHash, filename, mimeType: input.mimeType, bytes: bytes.length };
}
function materialEdit(s) { if (s.approval) { s.approval = null; s.needsReapproval = true; if (s.status === "approved-for-booking") s.status = "preparing"; } }
function mutation(s, operation, input, actor, timestamp, prepared) {
  if (operation === "updateShipment") { Object.assign(s, M.validateChanges(input.changes)); materialEdit(s); }
  else if (["uploadDocument", "finalizeDocumentUpload"].includes(operation)) { if (s.documents.some(d => d.id === prepared.id)) M.fail("Document ID already exists; use a new version ID"); s.documents.push(prepared); materialEdit(s); }
  else if (commandSections[operation]) {
    const section = commandSections[operation], row = M.shapes[section](input.record);
    const at = s[section].findIndex(v => v.id === row.id);
    if (at >= 0 && immutableSections.has(section)) M.fail("Immutable record already exists; add a sourced correction/version");
    if (section === "documents" && row.sensitivity === "restricted") { if (!actor.scopes.includes("shipping.documents.restricted")) M.fail("Restricted document permission required", "shipping_access_denied", 403); }
    if (at >= 0) s[section][at] = row; else s[section].push(row);
    if (!["milestones", "payments", "incidents", "sources"].includes(section)) materialEdit(s);
  } else if (operation === "setCostState") {
    const c = s.costs.find(c => c.id === input.costId); if (!c) M.fail("Cost document not found");
    if (!["active", "superseded", "waived", "disputed"].includes(input.status)) M.fail("Invalid cost state");
    const note = M.string(input.note, "cost state reason"), sourceIds = input.sources;
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.some(id => !s.sources.some(x => x.id === id))) M.fail("Cost state change requires source evidence");
    c.status = input.status; c.stateReason = note; c.stateSources = sourceIds; materialEdit(s);
  } else if (operation === "approveReadiness") {
    if (!actor.scopes.includes("shipping.approve")) M.fail("Shipping approval permission required", "shipping_access_denied", 403);
    if (!["proposed", "preparing", "ready-for-review", "approved-for-booking", "on-hold"].includes(s.status)) M.fail("Booking approval applies only before booking");
    const review = M.readiness(s, timestamp.slice(0, 10)); if (!review.ready) M.fail("Shipment is not ready: " + [...review.missing, ...review.issues].join("; "), "shipping_not_ready", 409);
    s.approval = { actorSub: actor.subject, approvedAt: timestamp, reviewedVersion: s.version, note: M.string(input.note, "approval note") }; s.needsReapproval = false; s.status = "approved-for-booking";
  } else if (operation === "setShipmentStatus") {
    const allowed = ["proposed", "preparing", "ready-for-review", "booked", "loaded", "in-transit", "at-port", "clearing", "delivered", "closed", "on-hold", "canceled", "historical-incomplete"];
    if (!allowed.includes(input.status)) M.fail("Invalid shipment status");
    if (!input.sources?.length || input.sources.some(id => !s.sources.some(x => x.id === id))) M.fail("Status change requires source evidence");
    if (input.status === "booked" && (!s.approval || s.needsReapproval || !M.readiness(s, timestamp.slice(0, 10)).ready)) M.fail("Current readiness approval is required for booking", "shipping_not_ready", 409);
    const gates = { loaded: "loaded", "in-transit": "departed", "at-port": "portArrival", delivered: "delivered", closed: "emptyReturned" };
    const covered = kind => { const ms = M.activeMilestones(s).filter(m => m.kind === kind && m.dateType === "actual"); return ms.some(m => !m.containerId) || (s.containers.length > 0 && s.containers.every(c => ms.some(m => m.containerId === c.id))); };
    if (gates[input.status] && !covered(gates[input.status])) M.fail("Status requires actual " + gates[input.status] + " evidence covering the whole shipment");
    if (input.status === "closed" && !covered("delivered")) M.fail("Closeout needs delivery evidence for the whole shipment");
    if (input.status === "closed" && !M.activeMilestones(s).some(m => m.kind === "financialClosed" && m.dateType === "actual")) M.fail("Closeout needs financial reconciliation evidence");
    s.status = input.status; s.statusNote = M.string(input.note, "status reason"); s.statusSources = input.sources;
  } else M.fail("Unknown shipping command");
  return M.sourceCheck(s);
}
async function runShippingCommand(operation, input, key, deps) {
  const a = access(deps, "shipping.write");
  if (operation === "approveReadiness") access(deps, "shipping.approve");
  const idempotencyKey = M.string(key, "idempotencyKey", 200); if (idempotencyKey.length < 8) M.fail("Idempotency key must be at least 8 characters");
  const intentId = M.hash(a.subject + "|" + idempotencyKey), fingerprint = M.hash({ operation, input });
  const receiptRef = collection(deps, "Receipts").doc(intentId);
  // Avoid re-uploading a file on a committed replay. Transaction still rechecks.
  const prior = await receiptRef.get();
  if (prior.exists && prior.data().fingerprint !== fingerprint) M.fail("Idempotency key reused for different input", "shipping_idempotency_conflict", 409);
  let prepared = null;
  if (!prior.exists && operation === "uploadDocument") prepared = await prepareFile(input, deps);
  if (!prior.exists && operation === "finalizeDocumentUpload") { checkVersion(await read(deps, input.shipmentId), input.expectedVersion); prepared = await uploadService.prepare(input, deps, a); }
  const timestamp = now(deps);
  const result = await deps.firestoreDb.runTransaction(async tx => {
    const prior = await tx.get(receiptRef);
    if (prior.exists) { if (prior.data().fingerprint !== fingerprint) M.fail("Idempotency key reused", "shipping_idempotency_conflict", 409); return { ...prior.data().result, replayed: true }; }
    const creating = operation === "createShipment", shipmentId = creating ? "ship-" + intentId.slice(0, 28) : M.id(input.shipmentId);
    let s = creating ? M.newShipment(input.shipment) : await read(deps, shipmentId, tx);
    if (creating && s.documents.some(d => d.sensitivity === "restricted") && !a.scopes.includes("shipping.documents.restricted")) M.fail("Restricted document permission required", "shipping_access_denied", 403);
    if (!creating) checkVersion(s, input.expectedVersion);
    let uploadRef, upload;
    if (operation === "finalizeDocumentUpload") {
      uploadRef = collection(deps, "Uploads").doc(M.id(input.uploadId));
      const snapshot = await tx.get(uploadRef); upload = snapshot.data();
      if (!upload || upload.actorSub !== a.subject || upload.shipmentId !== shipmentId || upload.completedReceiptId) M.fail("Upload changed or was already finalized", "shipping_upload_conflict", 409);
    }
    if (creating) s = { ...s, shipmentId, owner: "fbc", status: s.recordKind === "historical" ? "historical-incomplete" : "proposed", createdAt: timestamp, version: 0, approval: null, needsReapproval: false };
    else s = mutation(structuredClone(s), operation, input, a, timestamp, prepared);
    s.version += 1; s.updatedAt = timestamp; s.updatedBy = a.subject;
    M.sourceCheck(s);
    const revisionId = shipmentId + "-v" + s.version;
    const result = { shipmentId, version: s.version, revisionId, receiptId: intentId };
    if (uploadRef) tx.set(uploadRef, { ...upload, completedReceiptId: intentId, completedAt: timestamp });
    tx.set(collection(deps, "Shipments").doc(shipmentId), s);
    tx.create(collection(deps, "Revisions").doc(revisionId), s);
    tx.create(receiptRef, { owner: "fbc", actorSub: a.subject, operation, fingerprint, result, createdAt: timestamp });
    tx.create(collection(deps, "Audit").doc(intentId), { owner: "fbc", actorSub: a.subject, operation, shipmentId, version: s.version, createdAt: timestamp });
    return result;
  });
  const revision = await collection(deps, "Revisions").doc(result.revisionId).get();
  if (!revision.exists || revision.data().version !== result.version || revision.data().owner !== "fbc") M.fail("Write saved; revision read-back failed. Retry the same idempotency key.", "shipping_readback_failed", 503);
  return { ...result, readBackVerified: true, shipment: publicRecord(revision.data(), a) };
}
async function previewImportBatch(input, deps) {
  access(deps, "shipping.write");
  if (!Array.isArray(input.candidates) || !input.candidates.length || input.candidates.length > 50) M.fail("Import 1–50 candidates at a time");
  const rows = input.candidates.map(v => { const row = M.object({ sourceKey: value => M.string(value, "sourceKey", 200), shipment: M.newShipment }, ["sourceKey", "shipment"])(v); if (!row.shipment.sources.length) M.fail("Imported history requires source evidence"); if (row.shipment.recordKind === "operational") M.fail("Import stages historical records or proposals, not live booking approvals"); return row; });
  if (new Set(rows.map(r => r.sourceKey)).size !== rows.length) M.fail("Duplicate import source key");
  const duplicates = [];
  for (const row of rows) { const prior = await collection(deps, "Imports").doc(M.hash(row.sourceKey)).get(); if (prior.exists) duplicates.push({ sourceKey: row.sourceKey, shipmentId: prior.data().shipmentId }); }
  return { previewHash: M.hash(rows), candidates: rows.map(r => ({ sourceKey: r.sourceKey, title: r.shipment.title, recordKind: r.shipment.recordKind, issues: M.qualityIssues(r.shipment) })), duplicates, canCommit: duplicates.length === 0, sourceInstructionsAreData: true };
}
async function commitImportBatch(input, key, deps) {
  // Each shipment is independently durable and replayable. A partial failure
  // exposes receipts for completed rows; rerun the same batch/key safely.
  const actor = access(deps, "shipping.write");
  const preview = await previewImportBatch(input, deps);
  if (preview.previewHash !== input.previewHash) M.fail("Import changed since preview", "shipping_import_changed", 409);
  M.string(key, "idempotencyKey", 200); if (key.length < 8) M.fail("Idempotency key too short");
  const results = [];
  for (const row of input.candidates) {
    const sourceHash = M.hash(row.sourceKey), marker = collection(deps, "Imports").doc(sourceHash), fingerprint = M.hash(row);
    const reserved = await deps.firestoreDb.runTransaction(async tx => { const p = await tx.get(marker); if (p.exists) { if (p.data().fingerprint !== fingerprint) M.fail("Source key already imported with different content", "shipping_duplicate_import", 409); return p.data(); } const r = { owner: "fbc", actorSub: actor.subject, sourceKey: row.sourceKey, fingerprint, status: "reserved", idempotencyKey: "import-" + sourceHash }; tx.create(marker, r); return r; });
    if (reserved.status === "committed") { const existing = await read(deps, reserved.shipmentId); results.push({ sourceKey: row.sourceKey, shipmentId: existing.shipmentId, version: existing.version, replayed: true, readBackVerified: true }); continue; }
    if (reserved.actorSub !== actor.subject) M.fail("Import is being completed by another authenticated identity", "shipping_import_reserved", 409);
    const result = await runShippingCommand("createShipment", { shipment: row.shipment }, reserved.idempotencyKey, deps);
    await marker.set({ ...reserved, shipmentId: result.shipmentId, version: result.version, status: "committed" });
    const saved = await marker.get(); if (saved.data().shipmentId !== result.shipmentId) M.fail("Import marker read-back failed", "shipping_readback_failed", 503);
    results.push({ sourceKey: row.sourceKey, shipmentId: result.shipmentId, version: result.version, readBackVerified: result.readBackVerified });
  }
  return { previewHash: input.previewHash, results, readBackVerified: true };
}
async function listCountryCostEstimates(input, deps) { access(deps); return costPlanning.list(input, deps); }
async function getCountryCostEstimate(input, deps) { access(deps); return costPlanning.get(input, deps); }
async function saveCountryCostEstimate(input, key, deps) { return costPlanning.save(input, key, deps, access(deps, "shipping.write")); }
module.exports = { access, listShipments, getShipment, getReadiness, getCostSummary, getDocumentChecklist, getSchedule, getHistoryInsights, getShipmentHistory, getDocument, createDocumentUpload, previewImportBatch, commitImportBatch, runShippingCommand, commandSections, listCountryCostEstimates, getCountryCostEstimate, saveCountryCostEstimate };
