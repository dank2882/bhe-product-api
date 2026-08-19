"use strict";

const { createHash, randomUUID } = require("node:crypto");
const service = require("./prayer-management-service");

function define(name, mode, summary, required, optional, handler) { return Object.freeze({ name, mode, summary, required: Object.freeze(required || []), optional: Object.freeze(optional || []), confirmationPolicy: name === "commitLogosImport" ? "explicit_preview_approval" : "none", handler }); }
const PRAYER_OPERATIONS = Object.freeze([
  define("listPrayerLists", "query", "List the signed-in owner's encrypted prayer lists.", [], ["status"], service.listPrayerLists),
  define("listPrayers", "query", "List the signed-in owner's prayers by list or state.", [], ["listId", "status", "statuses"], service.listPrayers),
  define("getPrayer", "query", "Get one prayer by ID.", ["prayerId"], [], service.getPrayer),
  define("searchPrayers", "query", "Search decrypted owner-only content in memory without a plaintext index.", ["query"], ["statuses"], service.searchPrayers),
  define("getTodaysPrayers", "query", "Get active prayers due today in their configured time zones.", [], ["at"], service.getTodaysPrayers),
  define("getPrayerHistory", "query", "Get append-only prayed, reflection, answer, reopen, and archive events.", ["prayerId"], [], service.getPrayerHistory),
  define("getPrayerImport", "query", "Read back one encrypted Logos import preview or committed receipt.", ["importId"], [], service.getPrayerImport),
  define("createPrayerList", "command", "Create an encrypted private prayer list.", ["title"], ["description", "listId"], service.createPrayerList),
  define("createPrayer", "command", "Create an encrypted private prayer.", ["listId", "title", "prayerText"], ["privateContext", "tags", "people", "topics", "schedule", "source", "sourceRef", "prayerId"], service.createPrayer),
  define("updatePrayer", "command", "Update prayer content, list, or schedule with optimistic concurrency.", ["prayerId", "expectedVersion", "changes"], [], service.updatePrayer),
  define("recordPrayed", "command", "Append a prayed event and optional private reflection.", ["prayerId", "expectedVersion"], ["reflection"], service.recordPrayed),
  define("markPrayerAnswered", "command", "Mark a prayer answered and append the answer note.", ["prayerId", "expectedVersion"], ["answerText"], service.markPrayerAnswered),
  define("reopenPrayer", "command", "Reopen an answered or archived prayer.", ["prayerId", "expectedVersion"], ["note"], service.reopenPrayer),
  define("archivePrayer", "command", "Archive a prayer recoverably.", ["prayerId", "expectedVersion"], ["note"], service.archivePrayer),
  define("previewLogosImport", "command", "Parse and encrypt a one-time Logos DOCX import preview without creating prayers.", ["importId", "openaiFileIdRefs"], ["sourceName", "rawText"], service.previewLogosImport),
  define("commitLogosImport", "command", "Commit an explicitly approved preview with deterministic import IDs and reconciliation.", ["importId", "approved"], [], service.commitLogosImport)
]);
const BY_NAME = new Map(PRAYER_OPERATIONS.map((op) => [op.name, op]));
const CATALOG_VERSION = "2026-08-19";
const CATALOG_HASH = createHash("sha256").update(JSON.stringify(PRAYER_OPERATIONS.map(({ handler, ...op }) => op))).digest("hex");
function fail(message, statusCode, code, details = {}) { throw Object.assign(new Error(message), { statusCode, code, details }); }

function listPrayerManagementOperations({ mode, query, limit = 100 } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  const operations = PRAYER_OPERATIONS.filter((op) => (!mode || op.mode === mode) && (!needle || `${op.name} ${op.summary}`.toLowerCase().includes(needle))).slice(0, Math.min(Math.max(Number(limit) || 100, 1), 200)).map(({ handler, ...op }) => op);
  return { catalogVersion: CATALOG_VERSION, catalogHash: CATALOG_HASH, operations, operationCount: operations.length, privacy: { ownerOnly: true, applicationEncrypted: true, logsRedacted: true, backgroundAiProcessing: false } };
}
async function runPrayerManagementOperation(input = {}, deps = {}) {
  const mode = String(input.mode || "").toLowerCase(); const name = String(input.operation || "").trim(); const args = input.arguments ?? {};
  if (!["query", "command"].includes(mode)) fail("Prayer operation mode must be query or command", 400, "invalid_prayer_operation_mode");
  if (!args || typeof args !== "object" || Array.isArray(args)) fail("Prayer operation arguments must be an object", 400, "invalid_prayer_arguments");
  const operation = BY_NAME.get(name); if (!operation) fail("Unknown Prayer Management operation", 404, "unknown_prayer_operation", { operation: name });
  if (operation.mode !== mode) fail(`Operation ${name} must use ${operation.mode} mode`, 400, "prayer_operation_mode_mismatch");
  const missing = operation.required.filter((key) => args[key] === undefined || args[key] === null || args[key] === "");
  if (name === "previewLogosImport" && typeof args.rawText === "string") {
    const fileIndex = missing.indexOf("openaiFileIdRefs");
    if (fileIndex >= 0) missing.splice(fileIndex, 1);
  }
  if (missing.length) fail("Required prayer operation arguments are missing", 400, "missing_prayer_arguments", { operation: name, missing });
  const result = await operation.handler(args, deps);
  if (mode === "command" && deps.prayerAuditEventsCollection) {
    const auditOwner = service.assertPrayerAccess(deps, "prayer.write");
    const timestamp = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
    const auditId = `prayer-audit-${typeof deps.randomUUID === "function" ? deps.randomUUID() : randomUUID()}`;
    await deps.prayerAuditEventsCollection.doc(auditId).create({ auditId, ownerSub: auditOwner.subject, operation: name, argumentKeys: Object.keys(args).sort(), resultKeys: Object.keys(result || {}).sort(), createdAt: timestamp instanceof Date ? timestamp.toISOString() : String(timestamp), contentRedacted: true });
  }
  return { operation: name, mode, result };
}
function buildPrayerManagementOperationError(error, context = {}) { return { ok: false, requestId: context.requestId || "", operation: String(context.operation || ""), mode: String(context.mode || ""), error: { code: error?.code || "prayer_management_operation_failed", message: error?.message || "Prayer Management operation failed", status: Number(error?.statusCode) || 500, details: error?.details || {}, requestId: context.requestId || "" } }; }

module.exports = { CATALOG_HASH, CATALOG_VERSION, PRAYER_OPERATIONS, buildPrayerManagementOperationError, listPrayerManagementOperations, runPrayerManagementOperation };
