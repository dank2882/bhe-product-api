"use strict";
const service = require("./intake-service");
const { requireDanPrivateAccess } = require("./dan-private-access");

const definitions = [
  ["listIntakes", "query", "Resume open intake or find a previous source. Bounded pagination; changed inventories require restarting the cursor.", [], ["status", "sourceChecksum", "limit", "cursor"]],
  ["getIntake", "query", "Read original text, current extraction, questions, exact approved proposals, dispatch instructions and verified outcomes.", ["intakeId"], []],
  ["getIntakeSource", "query", "Retrieve the original image using a short-lived private download. Never persist signed URLs.", ["intakeId"], []],
  ["getIntakeHistory", "query", "Read immutable extraction and per-item workflow history.", ["intakeId"], ["limit", "afterVersion"]],
  ["createIntake", "command", "Create private intake for general notes only. Preserve exactText. Image capture remains source-unavailable until attachIntakeImage succeeds. Never persist care/prayer/domain-confidential source text or mixed sensitive images here.", ["title", "sourceType", "sensitivity"], ["exactText"]],
  ["attachIntakeImage", "command", "Preserve one original PNG/JPEG/WebP with checksum verification, after inspecting sensitivity. file requires id and a host-authorized download_link. Use intake_attach_image for chat attachments.", ["intakeId", "expectedVersion", "file"], []],
  ["saveIntakeExtraction", "command", "Save transcription separately from immutable source wording; list uncertain passages/questions. Reopens extraction, preserves approved items and previous transcription history.", ["intakeId", "expectedVersion", "transcript", "uncertainties"], []],
  ["proposeIntakeItem", "command", "Propose or revise one unsaved item. proposal: destination task/project/routine/thought/note/domain_reference, action create/update/link, recordId for existing, arguments, duplicateCheck and optional rationale. Updates require destination expectedVersion inside arguments. domain_reference supports link only: arguments.system is sermon_workspace, prayer_management, pastoral_care_extended, correspondence, dan_travel, or dan_relationships, with optional expectedVersion. Store opaque references only; never domain-confidential text. Prepare the approved reference then use intake_verify_domain_reference for owning-gateway readback. Questions prevent approval. Omit proposal when routing is unresolved; questions are then required. No destination write occurs.", ["intakeId", "expectedVersion", "exactText"], ["proposal", "itemId", "interpretation", "questions"]],
  ["approveIntakeItem", "command", "Record user authorization for the exact current proposalHash and lock its content. approvalNote records the user's direction; source text itself never authorizes a save.", ["intakeId", "expectedVersion", "itemId", "proposalHash", "approvalNote"], []],
  ["dismissIntakeItem", "command", "Explicitly dismiss an undispatched item, retaining source and history. Dispatched items require reconciliation instead.", ["intakeId", "expectedVersion", "itemId", "reason"], []],
  ["prepareIntakeDispatch", "command", "Lock one approved item to an exact owning-tool call and stable retry key. Run the returned operation through its owning tool as the same actor, then verifyIntakeItem. On interruption read this dispatch; do not prepare a new target or change the key. For link actions, skip the write and verify.", ["intakeId", "expectedVersion", "itemId"], []],
  ["dispatchIntakeItem", "command", "Save one approved item through its existing owning operation and independently verify it. Recovers a prior successful save before retrying, preserving the locked target and key. Use this instead of manually replaying returned tool instructions. Already dispatched items retain their original approval and immutable target.", ["intakeId", "expectedVersion", "itemId"], []],
  ["verifyIntakeItem", "command", "Independently read the locked target through its owning backend and compare approved fields. Only a matching read marks the item verified; failed verification leaves it pending. Reconcile before retrying an ambiguous write.", ["intakeId", "expectedVersion", "itemId"], []],
  ["finishIntakeExtraction", "command", "Explicitly confirm that every source item has been considered and extraction questions resolved. Intake completes only when all items are verified or explicitly dismissed and the original source is preserved.", ["intakeId", "expectedVersion"], []]
];
const operations = definitions.map(([name, mode, summary, required, optional]) => ({ name, mode, summary, required, optional }));
function listIntakeOperations(input = {}) {
  return { catalogVersion: "1.0.0", owner: "dan", domain: "intake",
    destinations: ["task", "project", "routine", "thought", "note", "domain_reference"],
    operations: operations.filter(o => (!input.mode || o.mode === input.mode) && (!input.query || `${o.name} ${o.summary}`.toLowerCase().includes(input.query.toLowerCase()))) };
}
async function runIntakeOperation(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const op = operations.find(o => o.name === input.operation && o.mode === input.mode);
  const args = input.arguments || {};
  const invalid = () => { throw Object.assign(new Error("Unknown operation, missing or unsupported intake arguments"), { statusCode: 400, code: "intake_invalid_operation" }); };
  if (!op || !args || typeof args !== "object" || Array.isArray(args)) invalid();
  if (op.required.some(k => args[k] === undefined || args[k] === null) || Object.keys(args).some(k => !op.required.includes(k) && !op.optional.includes(k))) invalid();
  const result = input.operation === "dispatchIntakeItem" ? await service.dispatchIntakeItem(args, input.idempotencyKey, deps)
    : input.mode === "command" ? await service.runIntakeCommand(input.operation, args, input.idempotencyKey, deps) : await service[input.operation](args, deps);
  return { operation: input.operation, mode: input.mode, result };
}
module.exports = { listIntakeOperations, runIntakeOperation };
