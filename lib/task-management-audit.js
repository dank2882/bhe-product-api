"use strict";

const { randomUUID } = require("node:crypto");
const { getTaskAccess } = require("./task-management-access");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  return value instanceof Date ? value.toISOString() : String(value);
}

function collectTargetIds(args = {}, result = {}) {
  const ids = new Set();
  for (const value of [
    args.projectId,
    args.taskId,
    args.routineId,
    result?.project?.projectId,
    result?.task?.taskId,
    result?.note?.noteId,
    result?.routine?.routineId
  ]) {
    const clean = normalizeString(value);
    if (clean) ids.add(clean);
  }
  return [...ids];
}

async function recordTaskManagementAuditEvent({ operation, arguments: args = {}, result = {} } = {}, deps = {}) {
  const collection = deps.taskManagementAuditEventsCollection;
  if (!collection || typeof collection.doc !== "function") return;
  const access = getTaskAccess(deps);
  const idFactory = typeof deps.randomUUID === "function" ? deps.randomUUID : randomUUID;
  const eventId = `task-audit-${idFactory()}`;
  const changes = args && typeof args.changes === "object" && !Array.isArray(args.changes)
    ? Object.keys(args.changes).sort()
    : Object.keys(args || {}).filter((key) => !["body", "notes", "context"].includes(key)).sort();
  await collection.doc(eventId).create({
    eventId,
    operation: normalizeString(operation),
    actorSub: access.subject,
    actorName: access.name || access.email,
    actorEmail: access.email,
    actorRole: access.role,
    targetIds: collectTargetIds(args, result),
    changedFields: changes,
    createdAt: getNowIso(deps)
  });
}

module.exports = {
  collectTargetIds,
  recordTaskManagementAuditEvent
};
