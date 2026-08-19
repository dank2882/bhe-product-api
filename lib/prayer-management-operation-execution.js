"use strict";

const { createHash } = require("node:crypto");
const { stableStringify } = require("./prayer-crypto");
const { runPrayerManagementOperation } = require("./prayer-management-operation-registry");
const { assertPrayerAccess } = require("./prayer-management-service");

function hash(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function fail(message, statusCode, code) { throw Object.assign(new Error(message), { statusCode, code }); }
async function runIdempotentPrayerManagementOperation(input = {}, deps = {}) {
  const mode = String(input.mode || "").toLowerCase(); const key = String(input.idempotencyKey || "").trim();
  if (mode === "query") return { ...(await runPrayerManagementOperation(input, deps)), idempotency: { protected: false, replayed: false, executionId: "", keyHash: "" } };
  const authorizedOwner = assertPrayerAccess(deps, "prayer.write");
  if (!key) fail("Prayer commands require an idempotency key", 400, "prayer_idempotency_key_required");
  if (key.length > 200) fail("Idempotency key is too long", 400, "invalid_idempotency_key");
  const identity = authorizedOwner.subject; const keyHash = hash(key).slice(0, 16);
  const executionId = `prayer-execution-${hash(`${identity}\u0000${input.operation}\u0000${key}`).slice(0, 40)}`;
  const fingerprint = hash(stableStringify(input.arguments ?? {})); const ref = deps.prayerOperationExecutionsCollection.doc(executionId);
  const existingDoc = await ref.get();
  if (existingDoc.exists) {
    const existing = existingDoc.data() || {};
    if (existing.requestFingerprint !== fingerprint) fail("Idempotency key was already used with different arguments", 409, "idempotency_key_reused");
    if (existing.status === "succeeded") {
      const response = await deps.prayerCrypto.decryptJson(existing.encryptedResponse, { recordType: "execution", recordId: executionId, ownerSub: existing.ownerSub });
      return { ...response, idempotency: { protected: true, replayed: true, executionId, keyHash } };
    }
    fail("An operation with this idempotency key is already in progress", 409, "idempotent_operation_in_progress");
  }
  const timestamp = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
  const startedAt = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp);
  const pending = { executionId, ownerSub: identity, operation: String(input.operation || ""), requestFingerprint: fingerprint, idempotencyKeyHash: keyHash, argumentKeys: Object.keys(input.arguments || {}).sort(), status: "in_progress", createdAt: startedAt, updatedAt: startedAt, contentRedacted: true };
  await ref.create(pending);
  try {
    const response = await runPrayerManagementOperation(input, deps);
    const encryptedResponse = await deps.prayerCrypto.encryptJson(response, { recordType: "execution", recordId: executionId, ownerSub: identity });
    await ref.set({ ...pending, status: "succeeded", encryptedResponse, updatedAt: startedAt, completedAt: startedAt });
    return { ...response, idempotency: { protected: true, replayed: false, executionId, keyHash } };
  } catch (error) {
    await ref.set({ ...pending, status: "failed", errorCode: error?.code || "prayer_operation_failed", errorStatus: Number(error?.statusCode) || 500, updatedAt: startedAt, failedAt: startedAt });
    throw error;
  }
}
function getJsonByteLength(value) { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return 0; } }
module.exports = { getJsonByteLength, runIdempotentPrayerManagementOperation };
