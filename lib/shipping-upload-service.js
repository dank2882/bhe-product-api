"use strict";
// Reuse the existing private signed-PUT pattern used by Scripture Notes.
// The bytes bypass MCP JSON limits; finalization still checks the exact file.
const M = require("./shipping-model");
const { createHash } = require("node:crypto");
const MAX_BYTES = 25 * 1024 * 1024;
const PUT_TTL = 15 * 60 * 1000;
const FINALIZE_TTL = 60 * 60 * 1000;
const clock = deps => new Date(deps.now ? deps.now() : Date.now()).getTime();
const uploads = deps => deps.firestoreDb.collection("fbcShippingUploads");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function fileFields(input) {
  const filename = M.string(input.filename, "filename", 200);
  if (/[\/\\\0\r\n]/.test(filename) || filename === "." || filename === "..") M.fail("Invalid filename");
  if (!["application/pdf", "image/png", "image/jpeg"].includes(input.mimeType)) M.fail("Only PDF, PNG and JPEG originals are supported");
  const bytes = M.integer(input.bytes);
  if (!bytes || bytes > MAX_BYTES) M.fail("Direct upload must be 1 byte through 25 MiB");
  if (!/^[a-f0-9]{64}$/.test(input.sha256 || "")) M.fail("Expected lowercase SHA-256 of the exact original file");
  return { filename, mimeType: input.mimeType, bytes, sha256: input.sha256 };
}
async function create(input, key, deps, actor, shipment) {
  if (!deps.bucket) M.fail("Document storage unavailable", "shipping_unavailable", 503);
  const metadata = M.shapes.documents(input.document), file = fileFields(input);
  if (metadata.sensitivity === "restricted" && !actor.scopes.includes("shipping.documents.restricted")) M.fail("Restricted document permission required", "shipping_access_denied", 403);
  if (shipment.documents.some(d => d.id === metadata.id)) M.fail("Document ID already exists; use a new version ID");
  M.sourceCheck({ ...shipment, documents: [...shipment.documents, metadata] });
  M.string(key, "idempotencyKey", 200); if (key.length < 8) M.fail("Idempotency key too short");
  const uploadId = "shipping-upload-" + M.hash(actor.subject + "|" + key), ref = uploads(deps).doc(uploadId);
  const fingerprint = M.hash(input), timestamp = clock(deps);
  const session = await deps.firestoreDb.runTransaction(async tx => {
    const prior = await tx.get(ref);
    if (prior.exists) { if (prior.data().fingerprint !== fingerprint) M.fail("Upload key reused for changed input", "shipping_idempotency_conflict", 409); return prior.data(); }
    const session = { owner: "fbc", actorSub: actor.subject, shipmentId: shipment.shipmentId, expectedVersion: shipment.version, document: metadata, ...file, fingerprint, createdAt: timestamp, putExpiresAt: timestamp + PUT_TTL, expiresAt: timestamp + FINALIZE_TTL, stagingPath: "fbc-shipping-staging/" + uploadId };
    tx.create(ref, session);
    tx.create(deps.firestoreDb.collection("fbcShippingAudit").doc(uploadId), { owner: "fbc", actorSub: actor.subject, operation: "createDocumentUpload", shipmentId: shipment.shipmentId, createdAt: new Date(timestamp).toISOString() });
    return session;
  });
  if (session.completedReceiptId) M.fail("Upload already finalized; retrieve the shipment", "shipping_upload_complete", 409);
  if (timestamp >= session.putExpiresAt) M.fail("Upload link expired; create a new upload with a new key", "shipping_upload_expired", 410);
  // Generation precondition prevents an already-uploaded staging object from
  // being replaced by the same URL. Final files use a different immutable path.
  const headers = { "Content-Type": file.mimeType, "x-goog-if-generation-match": "0" };
  const [url] = await deps.bucket.file(session.stagingPath).getSignedUrl({ version: "v4", action: "write", expires: session.putExpiresAt, contentType: file.mimeType, extensionHeaders: { "x-goog-if-generation-match": "0" } });
  const saved = await ref.get();
  if (!saved.exists || saved.data().fingerprint !== fingerprint) M.fail("Upload intent read-back failed", "shipping_readback_failed", 503);
  return { uploadId, filename: file.filename, maximumBytes: MAX_BYTES, expectedBytes: file.bytes, sha256: file.sha256, expiresAt: new Date(session.putExpiresAt).toISOString(), finalizeBy: new Date(session.expiresAt).toISOString(), readBackVerified: true, upload: { method: "PUT", url, headers }, next: "PUT the exact original bytes, then finalizeDocumentUpload with this uploadId and the same shipment version. Do not save the signed URL as a source." };
}
async function prepare(input, deps, actor) {
  const uploadId = M.id(input.uploadId), snap = await uploads(deps).doc(uploadId).get();
  if (!snap.exists) M.fail("Upload not found", "shipping_not_found", 404);
  const session = snap.data();
  if (session.owner !== "fbc" || session.actorSub !== actor.subject || session.shipmentId !== input.shipmentId) M.fail("Upload is not available to this identity and shipment", "shipping_access_denied", 403);
  if (session.document.sensitivity === "restricted" && !actor.scopes.includes("shipping.documents.restricted")) M.fail("Restricted document permission required", "shipping_access_denied", 403);
  if (session.expectedVersion !== input.expectedVersion) M.fail("Shipment version changed; create a new upload intent", "shipping_version_conflict", 409);
  if (session.completedReceiptId) M.fail("Upload was already finalized; replay the original command key", "shipping_upload_complete", 409);
  if (clock(deps) >= session.expiresAt) M.fail("Upload expired", "shipping_upload_expired", 410);
  if (!deps.bucket) M.fail("Document storage unavailable", "shipping_unavailable", 503);
  const staging = deps.bucket.file(session.stagingPath);
  let metadata;
  try { [metadata] = await staging.getMetadata(); } catch (e) { if (Number(e.code) === 404) M.fail("Upload the file before finalizing", "shipping_upload_missing"); throw e; }
  if (Number(metadata.size) !== session.bytes || Number(metadata.size) > MAX_BYTES || metadata.contentType !== session.mimeType) M.fail("Uploaded size or MIME type does not match the reviewed file");
  const [bytes] = await deps.bucket.file(session.stagingPath, { generation: metadata.generation }).download();
  const valid = session.mimeType === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-" : session.mimeType === "image/png" ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" : bytes.subarray(0, 3).toString("hex") === "ffd8ff";
  if (!valid || bytes.length !== session.bytes || digest(bytes) !== session.sha256) M.fail("Uploaded original does not match its signature, size and SHA-256");
  const storagePath = "fbc-shipping/" + session.shipmentId + "/" + session.sha256;
  await deps.bucket.file(storagePath).save(bytes, { resumable: false, contentType: session.mimeType, metadata: { cacheControl: "private, no-store" }, preconditionOpts: { ifGenerationMatch: 0 } }).catch(e => { if (Number(e.code) !== 412) throw e; });
  return { ...session.document, storagePath, sha256: session.sha256, filename: session.filename, mimeType: session.mimeType, bytes: session.bytes };
}
module.exports = { create, prepare, MAX_BYTES };
