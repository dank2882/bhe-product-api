"use strict";
const { createHash } = require("node:crypto");
const { assertCanDeleteTaskRecord, getTaskAccess } = require("./task-management-access");
function fail(message, code, statusCode = 409) { throw Object.assign(new Error(message), { code, statusCode }); }

// Permanent deletion is deliberately separate from reversible archive. The
// transaction checks current identity policy, version and references and stores
// a durable receipt atomically, so a retry cannot delete a recreated record.
async function deleteTaskRecord(input = {}, deps = {}) {
  const { recordType, recordId, expectedVersion, confirmDelete } = input;
  if (!["task", "project"].includes(recordType) || typeof recordId !== "string" || !/^[A-Za-z0-9_-]+$/.test(recordId) || !Number.isInteger(expectedVersion) || expectedVersion < 1 || confirmDelete !== true) {
    fail("Supply task/project recordType, recordId, current expectedVersion and confirmDelete:true after an explicit delete request", "invalid_delete_request", 400);
  }
  const collection = recordType === "task" ? deps.tasksCollection : deps.projectsCollection;
  const db = collection?.firestore;
  if (!db?.runTransaction || !deps.taskManagementAuditEventsCollection) fail("Transactional deletion is unavailable", "delete_unavailable", 503);
  const access = getTaskAccess(deps);
  if (!access.subject) fail("An authenticated individual is required", "task_access_denied", 403);
  const receiptId = "task-delete-" + createHash("sha256").update(JSON.stringify([recordType, recordId, expectedVersion, access.subject])).digest("hex").slice(0, 40);
  const receiptRef = deps.taskManagementAuditEventsCollection.doc(receiptId);
  return db.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) return { ...receipt.data().result, replayed: true };
    const ref = collection.doc(recordId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail("Record not found", "task_record_not_found", 404);
    const record = { ...snapshot.data(), [recordType === "task" ? "taskId" : "projectId"]: recordId };
    const projects = await tx.get(deps.projectsCollection.orderBy("__name__").limit(10001));
    if (projects.docs.length > 10000) fail("Project graph exceeds the complete-read limit", "query_requires_narrower_scope", 422);
    const projectGraph = new Map(projects.docs.map(d => [d.id, { ...d.data(), projectId: d.id }]));
    assertCanDeleteTaskRecord(record, { ...deps, projectGraph });
    if (record.version !== expectedVersion) fail("Record changed; retrieve its current version before deleting", "task_version_conflict");
    const query = async (collection, field, value, limit = 1) => {
      if (!collection) fail("Reference checks are unavailable", "delete_unavailable", 503);
      return (await tx.get(collection.where(field, "==", value).limit(limit))).docs;
    };
    if (recordType === "project") {
      if ([...projectGraph.values()].some(p => p.parentProjectId === recordId || (p.dependencies || []).some(d => d.projectId === recordId)) ||
          (await query(deps.tasksCollection, "projectId", recordId)).length ||
          (await query(deps.routinesCollection, "projectId", recordId)).length ||
          (await query(deps.calendarEventsCollection, "projectId", recordId)).length) {
        fail("Move or remove linked work before deleting this project; archiving is available", "task_record_has_references");
      }
    }
    let notes = [], notifications = [];
    if (recordType === "task") {
      if ((await query(deps.taskAttachmentsCollection, "taskId", recordId)).length ||
          (await query(deps.calendarEventsCollection, "taskId", recordId)).length || record.outlookEventId) {
        fail("This task has files or calendar links; archive it to preserve those references", "task_record_has_references");
      }
      notes = await query(deps.taskNotesCollection, "taskId", recordId, 401);
      notifications = await query(deps.taskNotificationsCollection, "taskId", recordId, 401);
      if (notes.length + notifications.length > 400) fail("Too much linked history for one atomic deletion; archive this task", "task_record_has_references");
    }
    const result = { action: "deleted", recordType, recordId, deletedVersion: expectedVersion, receiptId };
    for (const doc of [...notes, ...notifications]) tx.delete(doc.ref);
    tx.delete(ref);
    tx.create(receiptRef, { eventId: receiptId, operation: "deleteRecord", actorSub: access.subject, actorName: access.name || access.email, actorRole: access.role, targetIds: [recordId], changedFields: ["deleted"], createdAt: new Date().toISOString(), result });
    return result;
  });
}
module.exports = { deleteTaskRecord };
