"use strict";

const { createHash } = require("node:crypto");
const { recordTaskManagementAuditEvent } = require("./task-management-audit");
const {
  addTaskNote,
  buildDailyReview,
  createProject,
  createRoutine,
  createTask,
  getProject,
  getTask,
  listProjects,
  listRoutines,
  listTaskNotes,
  listTasks,
  updateProject,
  updateRoutine,
  updateTask
} = require("./project-task-service");

const OPERATION_MODES = ["query", "command"];

function defineOperation({
  name,
  mode,
  summary,
  required = [],
  optional = [],
  exampleArguments = {},
  argumentGuidance = "",
  handler
}) {
  return Object.freeze({
    name,
    mode,
    summary,
    required: Object.freeze([...required]),
    optional: Object.freeze([...optional]),
    exampleArguments: Object.freeze({ ...exampleArguments }),
    argumentGuidance,
    confirmationPolicy: "none",
    handler
  });
}

const TASK_MANAGEMENT_OPERATIONS = Object.freeze([
  defineOperation({
    name: "buildDailyReview",
    mode: "query",
    summary: "Build a read-only project, task, waiting-item, routine, and Sarah-requested review for one date.",
    optional: ["today", "detailLevel"],
    exampleArguments: { today: "2026-07-21", detailLevel: "compact" },
    argumentGuidance: "This operation never creates, updates, or completes records. Combine it with Outlook Calendar for timed commitments.",
    handler: buildDailyReview
  }),
  defineOperation({
    name: "listProjects",
    mode: "query",
    summary: "List projects by status, life area, priority, target date, or search text.",
    optional: ["status", "lifeArea", "priority", "targetOnOrBefore", "query", "limit"],
    exampleArguments: { status: "active", lifeArea: "work", limit: 25 },
    handler: listProjects
  }),
  defineOperation({
    name: "getProject",
    mode: "query",
    summary: "Get one project by its stable project ID.",
    required: ["projectId"],
    exampleArguments: { projectId: "proj-bhe-vision" },
    handler: getProject
  }),
  defineOperation({
    name: "listTasks",
    mode: "query",
    summary: "List tasks by status, priority, project, life area, requester, dates, or search text.",
    optional: ["status", "priority", "projectId", "lifeArea", "requestedBy", "query", "dueBefore", "dueOnOrBefore", "followUpOnOrBefore", "limit"],
    exampleArguments: { status: "waiting", followUpOnOrBefore: "2026-07-21", limit: 25 },
    argumentGuidance: "Sermon identity, preparation, readiness, and preaching dates belong in Sermon Workspace and should not be represented as ordinary tasks.",
    handler: listTasks
  }),
  defineOperation({
    name: "getTask",
    mode: "query",
    summary: "Get one complete task, including its task-note summary.",
    required: ["taskId"],
    exampleArguments: { taskId: "task-example" },
    handler: getTask
  }),
  defineOperation({
    name: "listTaskNotes",
    mode: "query",
    summary: "Read the ordered append-only note conversation for one task.",
    required: ["taskId"],
    optional: ["limit"],
    exampleArguments: { taskId: "task-example", limit: 25 },
    handler: listTaskNotes
  }),
  defineOperation({
    name: "listRoutines",
    mode: "query",
    summary: "List recurring routines by status, life area, or search text.",
    optional: ["status", "lifeArea", "query", "limit"],
    exampleArguments: { status: "active", limit: 25 },
    handler: listRoutines
  }),
  defineOperation({
    name: "createProject",
    mode: "command",
    summary: "Create one project with an outcome, life area, priority, and optional target date.",
    required: ["name"],
    optional: ["projectId", "outcome", "lifeArea", "status", "priority", "targetDate", "requestedBy", "notes", "visibility"],
    exampleArguments: { name: "Prepare Psalms book", outcome: "Produce a proofed printable book block", lifeArea: "work" },
    handler: createProject
  }),
  defineOperation({
    name: "updateProject",
    mode: "command",
    summary: "Update selected fields on one existing project without replacing unrelated data.",
    required: ["projectId", "changes"],
    optional: ["expectedVersion"],
    exampleArguments: { projectId: "proj-example", changes: { priority: "high", targetDate: "2026-07-31" } },
    handler: updateProject
  }),
  defineOperation({
    name: "createTask",
    mode: "command",
    summary: "Create one concrete task or waiting item in the BHE task store.",
    required: ["title"],
    optional: ["taskId", "projectId", "lifeArea", "status", "priority", "dueDate", "scheduledDate", "scheduledTime", "timeWindow", "waitingOn", "followUpDate", "requestedBy", "assignedTo", "context", "notes", "visibility"],
    exampleArguments: { title: "Check with AWS billing support", status: "waiting", waitingOn: "AWS", requestedBy: "Dan" },
    argumentGuidance: "Do not create sermon-writing, sermon-preparation, preaching, or automatic sermon-completion tasks; use Sermon Workspace for that lifecycle.",
    handler: createTask
  }),
  defineOperation({
    name: "updateTask",
    mode: "command",
    summary: "Update selected fields or status on one existing task without overwriting its note conversation.",
    required: ["taskId", "changes"],
    optional: ["expectedVersion"],
    exampleArguments: { taskId: "task-example", changes: { status: "done" } },
    handler: updateTask
  }),
  defineOperation({
    name: "addTaskNote",
    mode: "command",
    summary: "Append a dated note from an authorized BHE collaborator to one task without overwriting prior notes.",
    required: ["taskId", "body", "author"],
    optional: ["noteId", "source"],
    exampleArguments: { taskId: "task-example", body: "August 21 works for me.", author: "Sarah", source: "chat" },
    argumentGuidance: "Preserve the actual speaker as author. Use task.notes for durable description and addTaskNote for the back-and-forth history.",
    handler: addTaskNote
  }),
  defineOperation({
    name: "createRoutine",
    mode: "command",
    summary: "Create one recurring routine without generating a new task for each occurrence.",
    required: ["title"],
    optional: ["routineId", "lifeArea", "status", "recurrence", "recurrenceNotes", "preferredTime", "assignedTo", "requestedBy", "notes", "visibility"],
    exampleArguments: { title: "Check mail and packages", lifeArea: "home", recurrence: "daily", preferredTime: "after work" },
    handler: createRoutine
  }),
  defineOperation({
    name: "updateRoutine",
    mode: "command",
    summary: "Update selected fields or status on one existing routine.",
    required: ["routineId", "changes"],
    optional: ["expectedVersion"],
    exampleArguments: { routineId: "routine-example", changes: { status: "paused" } },
    handler: updateRoutine
  })
]);

const OPERATION_BY_NAME = new Map(TASK_MANAGEMENT_OPERATIONS.map((operation) => [operation.name, operation]));

function createRegistryError(message, statusCode = 400, code = "task_management_operation_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildCatalogEntry(operation) {
  return {
    operation: operation.name,
    mode: operation.mode,
    summary: operation.summary,
    required: [...operation.required],
    optional: [...operation.optional],
    exampleArguments: { ...operation.exampleArguments },
    argumentGuidance: operation.argumentGuidance || "",
    confirmationPolicy: operation.confirmationPolicy
  };
}

const CATALOG_HASH = createHash("sha256")
  .update(JSON.stringify(TASK_MANAGEMENT_OPERATIONS.map(buildCatalogEntry)))
  .digest("hex");
const CATALOG_VERSION = `1-${CATALOG_HASH.slice(0, 12)}`;

function listTaskManagementOperations(input = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const query = normalizeString(input.query).toLowerCase();
  const parsedLimit = Number(input.limit);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 200) : 100;

  if (mode && !OPERATION_MODES.includes(mode)) {
    throw createRegistryError("Invalid task management operation mode", 400, "invalid_operation_mode", {
      mode,
      allowedModes: OPERATION_MODES
    });
  }

  const operations = TASK_MANAGEMENT_OPERATIONS
    .filter((operation) => !mode || operation.mode === mode)
    .filter((operation) => !query || [operation.name, operation.summary].join(" ").toLowerCase().includes(query))
    .slice(0, limit)
    .map(buildCatalogEntry);

  return {
    catalogVersion: CATALOG_VERSION,
    catalogHash: CATALOG_HASH,
    modes: [...OPERATION_MODES],
    count: operations.length,
    operations
  };
}

async function runTaskManagementOperation(input = {}, deps = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const operationName = normalizeString(input.operation);
  const operationArguments = input.arguments ?? input.args ?? {};

  if (!OPERATION_MODES.includes(mode)) {
    throw createRegistryError("Invalid task management operation mode", 400, "invalid_operation_mode", {
      mode,
      allowedModes: OPERATION_MODES
    });
  }
  if (!operationName) throw createRegistryError("Operation is required", 400, "missing_operation");
  if (!operationArguments || typeof operationArguments !== "object" || Array.isArray(operationArguments)) {
    throw createRegistryError("Operation arguments must be an object", 400, "invalid_operation_arguments");
  }

  const operation = OPERATION_BY_NAME.get(operationName);
  if (!operation) {
    throw createRegistryError("Unknown task management operation", 404, "unknown_operation", { operation: operationName });
  }
  if (operation.mode !== mode) {
    throw createRegistryError(`Operation ${operationName} must use ${operation.mode} mode`, 400, "operation_mode_mismatch", {
      operation: operationName,
      expectedMode: operation.mode,
      receivedMode: mode
    });
  }

  const missing = operation.required.filter((field) => {
    const value = operationArguments[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw createRegistryError("Required operation arguments are missing", 400, "missing_operation_arguments", {
      operation: operationName,
      missing
    });
  }

  const result = await operation.handler(operationArguments, deps);
  if (mode === "command") {
    await recordTaskManagementAuditEvent({
      operation: operationName,
      arguments: operationArguments,
      result
    }, deps);
  }
  return { operation: operationName, mode, result };
}

function buildTaskManagementOperationError(error, context = {}) {
  return {
    ok: false,
    requestId: context.requestId || "",
    operation: normalizeString(context.operation),
    mode: normalizeString(context.mode).toLowerCase(),
    error: {
      code: error?.code || "task_management_operation_failed",
      message: error?.message || "Task management operation failed",
      status: Number(error?.statusCode) || 500,
      details: error?.details || {},
      requestId: context.requestId || ""
    }
  };
}

module.exports = {
  CATALOG_HASH,
  CATALOG_VERSION,
  OPERATION_MODES,
  TASK_MANAGEMENT_OPERATIONS,
  buildTaskManagementOperationError,
  listTaskManagementOperations,
  runTaskManagementOperation
};
