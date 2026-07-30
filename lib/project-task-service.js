"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  assertCanAddTaskNote,
  assertCanCreateTaskRecord,
  assertCanReadTaskRecord,
  assertCanUpdateTaskRecord,
  canReadTaskRecord,
  getRecordVisibility,
  getTaskAccess,
  getTaskActorFields,
  isAccessSubject,
  isTaskAdmin,
  normalizeVisibility
} = require("./task-management-access");

const PROJECT_STATUSES = ["active", "paused", "done", "archived"];
const TASK_STATUSES = ["next", "waiting", "scheduled", "done", "dropped"];
const TASK_PRIORITIES = ["low", "medium", "high"];
const LIFE_AREAS = ["work", "home", "church", "personal"];
const BHE_DEPARTMENTS = ["facsimiles", "displays", "retail", "education"];
const EVENT_STATUSES = ["scheduled", "cancelled", "done"];
const ROUTINE_STATUSES = ["active", "paused", "archived"];
const RECURRENCE_TYPES = ["none", "daily", "weekly", "monthly", "custom"];
const OUTLOOK_SYNC_STATUSES = ["none", "pending", "synced", "error"];
const ASSIGNMENT_STATUSES = ["unassigned", "proposed", "accepted", "needs_clarification", "declined"];
const STAFF_PROFILE_ROLES = ["admin", "manager", "member", "collaborator", "viewer"];
const STAFF_PROFILE_STATUSES = ["active", "disabled"];
const PROJECT_HEALTH_STATUSES = ["unknown", "on_track", "at_risk", "blocked"];
const MILESTONE_STATUSES = ["not_started", "in_progress", "done", "blocked"];
const DEPENDENCY_STATUSES = ["open", "resolved", "blocked"];
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

function createProjectTaskError(message, statusCode = 400, details = {}, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  error.code = code || "project_task_error";
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  const slug = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "item";
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function getTodayDate(deps = {}) {
  return getNowIso(deps).slice(0, 10);
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIST_LIMIT), 10);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), MAX_LIST_LIMIT);
}

function normalizeOptionalInteger(value, fieldName, { min = 0, max = 100000 } = {}) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw createProjectTaskError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, value, min, max },
      `invalid_${fieldName}`
    );
  }
  return parsed;
}

function getStaffProfileId(subject) {
  const cleanSubject = normalizeString(subject);
  if (!cleanSubject) {
    throw createProjectTaskError("Missing staff identity subject", 400, {}, "missing_staff_subject");
  }
  return `staff-${createHash("sha256").update(cleanSubject).digest("hex").slice(0, 32)}`;
}

function normalizeEnum(value, allowedValues, fallback, fieldName) {
  const cleanValue = normalizeString(value);

  if (!cleanValue) {
    return fallback;
  }

  if (!allowedValues.includes(cleanValue)) {
    throw createProjectTaskError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, value: cleanValue, allowedValues },
      `invalid_${fieldName}`
    );
  }

  return cleanValue;
}

function normalizeDepartment(value) {
  const cleanValue = normalizeString(value).toLowerCase();
  if (!cleanValue) return "";
  const aliases = {
    facsimile: "facsimiles",
    fascimile: "facsimiles",
    fascimiles: "facsimiles",
    display: "displays"
  };
  const department = aliases[cleanValue] || cleanValue;
  if (!BHE_DEPARTMENTS.includes(department)) {
    throw createProjectTaskError(
      "Invalid BHE department",
      400,
      { fieldName: "department", value: cleanValue, allowedValues: BHE_DEPARTMENTS },
      "invalid_department"
    );
  }
  return department;
}

function normalizeOptionalDate(value, fieldName) {
  const cleanValue = normalizeString(value);

  if (!cleanValue) {
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    throw createProjectTaskError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, value: cleanValue, expectedFormat: "YYYY-MM-DD" },
      `invalid_${fieldName}`
    );
  }

  return cleanValue;
}

function normalizeOptionalDateTime(value, fieldName) {
  const cleanValue = normalizeString(value);

  if (!cleanValue) {
    return "";
  }

  const date = new Date(cleanValue);
  if (Number.isNaN(date.getTime())) {
    throw createProjectTaskError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, value: cleanValue, expectedFormat: "ISO-8601 date/time" },
      `invalid_${fieldName}`
    );
  }

  return cleanValue;
}

function normalizeOptionalTime(value, fieldName) {
  const cleanValue = normalizeString(value);
  if (!cleanValue) return "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cleanValue)) {
    throw createProjectTaskError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, value: cleanValue, expectedFormat: "HH:MM using a 24-hour clock" },
      `invalid_${fieldName}`
    );
  }
  return cleanValue;
}

function validateDocId(value, fieldName = "docId") {
  const cleanValue = normalizeString(value);

  if (!cleanValue || cleanValue.includes("/")) {
    throw createProjectTaskError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, value: cleanValue },
      `invalid_${fieldName}`
    );
  }

  return cleanValue;
}

function createId(prefix, label, deps = {}) {
  const idFactory = typeof deps.randomUUID === "function" ? deps.randomUUID : randomUUID;
  return `${prefix}-${slugify(label)}-${idFactory().slice(0, 8)}`;
}

function buildProjectSearchText(project = {}) {
  return [
    project.projectId,
    project.name,
    project.lifeArea,
    project.department,
    project.outcome,
    project.status,
    project.priority,
    project.targetDate,
    project.requestedBy,
    project.leadName,
    project.leadEmail,
    project.health,
    project.healthNote,
    ...(Array.isArray(project.milestones) ? project.milestones.flatMap((item) => [item.title, item.ownerName, item.status]) : []),
    ...(Array.isArray(project.dependencies) ? project.dependencies.flatMap((item) => [item.projectId, item.description, item.status]) : []),
    project.notes,
    project.visibility
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildTaskSearchText(task = {}) {
  return [
    task.taskId,
    task.title,
    task.projectId,
    task.eventId,
    task.lifeArea,
    task.department,
    task.status,
    task.priority,
    task.dueDate,
    task.workOnDate,
    task.workOnStartTime,
    task.workOnEndTime,
    task.workOnTimeZone,
    task.notes,
    task.waitingOn,
    task.followUpDate,
    task.requestedBy,
    task.assignedTo,
    task.assignedToEmail,
    task.assignedByName,
    task.assignmentStatus,
    task.assignmentResponseNote,
    task.estimatedMinutes,
    task.context,
    task.sourceType,
    task.sourceMessageId,
    task.sourceThreadId,
    task.sourceSubject,
    task.sourceSender,
    task.sourceWebUrl,
    task.completionRule,
    task.lastNotePreview,
    task.lastNoteBy,
    task.visibility
  ].filter(Boolean).join(" ").toLowerCase();
}

function normalizeMilestones(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw createProjectTaskError("milestones must be an array", 400, {}, "invalid_project_milestones");
  }
  if (value.length > 50) {
    throw createProjectTaskError("A project may have at most 50 milestones", 400, {}, "too_many_project_milestones");
  }
  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw createProjectTaskError("Each milestone must be an object", 400, { index }, "invalid_project_milestone");
    }
    const title = normalizeString(item.title);
    if (!title) {
      throw createProjectTaskError("Each milestone needs a title", 400, { index }, "missing_project_milestone_title");
    }
    return {
      milestoneId: normalizeString(item.milestoneId) || `milestone-${index + 1}`,
      title,
      status: normalizeEnum(item.status, MILESTONE_STATUSES, "not_started", "milestone_status"),
      targetDate: normalizeOptionalDate(item.targetDate, "milestoneTargetDate"),
      ownerSub: normalizeString(item.ownerSub),
      ownerName: normalizeString(item.ownerName)
    };
  });
}

function normalizeDependencies(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw createProjectTaskError("dependencies must be an array", 400, {}, "invalid_project_dependencies");
  }
  if (value.length > 50) {
    throw createProjectTaskError("A project may have at most 50 dependencies", 400, {}, "too_many_project_dependencies");
  }
  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw createProjectTaskError("Each dependency must be an object", 400, { index }, "invalid_project_dependency");
    }
    const description = normalizeString(item.description);
    const projectId = normalizeString(item.projectId);
    if (!description && !projectId) {
      throw createProjectTaskError("Each dependency needs a projectId or description", 400, { index }, "missing_project_dependency_detail");
    }
    return {
      dependencyId: normalizeString(item.dependencyId) || `dependency-${index + 1}`,
      projectId,
      description,
      status: normalizeEnum(item.status, DEPENDENCY_STATUSES, "open", "dependency_status")
    };
  });
}

function buildTaskNoteSearchText(note = {}) {
  return [
    note.noteId,
    note.taskId,
    note.body,
    note.author,
    note.source
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildEventSearchText(event = {}) {
  return [
    event.eventId,
    event.title,
    event.lifeArea,
    event.status,
    event.location,
    event.notes,
    event.requestedBy
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildRoutineSearchText(routine = {}) {
  return [
    routine.routineId,
    routine.title,
    routine.lifeArea,
    routine.status,
    routine.recurrence,
    routine.notes,
    routine.requestedBy,
    routine.assignedTo,
    routine.visibility
  ].filter(Boolean).join(" ").toLowerCase();
}

function assertExpectedVersion(input = {}, existing = {}, deps = {}, kind = "record", id = "") {
  const access = getTaskAccess(deps);
  const currentVersion = Math.max(1, Number(existing.version) || 1);
  const hasExpectedVersion = Object.prototype.hasOwnProperty.call(input, "expectedVersion");

  if (!["system", "admin"].includes(access.role) && !hasExpectedVersion) {
    throw createProjectTaskError(
      `The ${kind} changed-state check is required for shared edits`,
      409,
      { kind, id, currentVersion },
      "task_version_required"
    );
  }
  if (!hasExpectedVersion) return;

  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw createProjectTaskError(
      "expectedVersion must be a positive integer",
      400,
      { kind, id, expectedVersion: input.expectedVersion },
      "invalid_task_version"
    );
  }
  if (expectedVersion !== currentVersion) {
    throw createProjectTaskError(
      `The ${kind} changed after it was read; refresh it before updating`,
      409,
      { kind, id, expectedVersion, currentVersion },
      "task_version_conflict"
    );
  }
}

async function assertProjectReferenceAccessible(projectId, deps = {}) {
  if (!projectId) return null;
  if (!deps.projectsCollection) {
    if (isTaskAdmin(deps)) return null;
    throw createProjectTaskError(
      "Projects collection is not configured",
      500,
      {},
      "projects_collection_not_configured"
    );
  }
  const projectDoc = await deps.projectsCollection.doc(projectId).get();
  if (!projectDoc.exists) {
    throw createProjectTaskError(
      "Project not found",
      404,
      { projectId },
      "project_not_found"
    );
  }
  const project = projectDoc.data() || {};
  if (!isTaskAdmin(deps)) {
    assertCanReadTaskRecord(project, deps, { projectId });
  }
  return project;
}

function buildProjectSummary(project = {}, fallbackId = "") {
  return {
    projectId: project.projectId || fallbackId,
    name: project.name || "",
    lifeArea: project.lifeArea || "work",
    department: project.department || "",
    outcome: project.outcome || "",
    status: project.status || "active",
    priority: project.priority || "medium",
    targetDate: project.targetDate || "",
    requestedBy: project.requestedBy || "Dan",
    leadSub: project.leadSub || "",
    leadName: project.leadName || "",
    leadEmail: project.leadEmail || "",
    health: project.health || "unknown",
    healthNote: project.healthNote || "",
    lastHealthAt: project.lastHealthAt || "",
    nextReviewDate: project.nextReviewDate || "",
    milestones: Array.isArray(project.milestones) ? clone(project.milestones) : [],
    dependencies: Array.isArray(project.dependencies) ? clone(project.dependencies) : [],
    notes: project.notes || "",
    visibility: getRecordVisibility(project),
    ownerSub: project.ownerSub || project.createdBySub || "",
    ownerName: project.ownerName || project.createdByName || "",
    ownerEmail: project.ownerEmail || "",
    version: Number.isInteger(project.version) ? project.version : 1,
    createdBySub: project.createdBySub || "",
    createdByName: project.createdByName || "",
    updatedBySub: project.updatedBySub || "",
    updatedByName: project.updatedByName || "",
    createdAt: project.createdAt || "",
    updatedAt: project.updatedAt || "",
    completedAt: project.completedAt || "",
    archivedAt: project.archivedAt || "",
    statusBeforeArchive: project.statusBeforeArchive || "",
    restoredAt: project.restoredAt || "",
    restoredBySub: project.restoredBySub || "",
    restoredByName: project.restoredByName || ""
  };
}

function buildTaskSummary(task = {}, fallbackId = "") {
  const workOnDate = task.workOnDate || task.scheduledDate || "";
  const workOnStartTime = task.workOnStartTime || task.scheduledTime || "";
  return {
    taskId: task.taskId || fallbackId,
    title: task.title || "",
    projectId: task.projectId || "",
    eventId: task.eventId || "",
    lifeArea: task.lifeArea || "work",
    department: task.department || "",
    status: task.status || "next",
    priority: task.priority || "medium",
    dueDate: task.dueDate || "",
    workOnDate,
    workOnStartTime,
    workOnEndTime: task.workOnEndTime || "",
    workOnTimeZone: task.workOnTimeZone || "",
    scheduledDate: task.scheduledDate || "",
    scheduledTime: task.scheduledTime || "",
    timeWindow: task.timeWindow || "",
    waitingOn: task.waitingOn || "",
    followUpDate: task.followUpDate || "",
    requestedBy: task.requestedBy || "Dan",
    assignedTo: task.assignedTo || "Dan",
    assignedToSub: task.assignedToSub || "",
    assignedToEmail: task.assignedToEmail || "",
    assignedBySub: task.assignedBySub || "",
    assignedByName: task.assignedByName || "",
    assignedAt: task.assignedAt || "",
    assignmentStatus: task.assignmentStatus || (task.assignedToSub ? "accepted" : "unassigned"),
    assignmentRespondedAt: task.assignmentRespondedAt || "",
    assignmentRespondedBySub: task.assignmentRespondedBySub || "",
    assignmentResponseNote: task.assignmentResponseNote || "",
    estimatedMinutes: Number.isInteger(task.estimatedMinutes) ? task.estimatedMinutes : 0,
    context: task.context || "",
    sourceType: task.sourceType || "",
    sourceMessageId: task.sourceMessageId || "",
    sourceThreadId: task.sourceThreadId || "",
    sourceSubject: task.sourceSubject || "",
    sourceSender: task.sourceSender || "",
    sourceReceivedAt: task.sourceReceivedAt || "",
    sourceWebUrl: task.sourceWebUrl || "",
    autoCompleteAfterEvent: task.autoCompleteAfterEvent === true,
    completedByEventId: task.completedByEventId || "",
    notes: task.notes || "",
    visibility: getRecordVisibility(task),
    ownerSub: task.ownerSub || task.createdBySub || "",
    ownerName: task.ownerName || task.createdByName || "",
    ownerEmail: task.ownerEmail || "",
    outlookCalendarId: task.outlookCalendarId || "",
    outlookEventId: task.outlookEventId || task.eventId || "",
    outlookEventWebUrl: task.outlookEventWebUrl || "",
    outlookSyncStatus: task.outlookSyncStatus || "none",
    version: Number.isInteger(task.version) ? task.version : 1,
    createdBySub: task.createdBySub || "",
    createdByName: task.createdByName || "",
    updatedBySub: task.updatedBySub || "",
    updatedByName: task.updatedByName || "",
    noteCount: Number.isInteger(task.noteCount) ? task.noteCount : 0,
    lastNoteAt: task.lastNoteAt || "",
    lastNoteBy: task.lastNoteBy || "",
    lastNotePreview: task.lastNotePreview || "",
    createdAt: task.createdAt || "",
    updatedAt: task.updatedAt || "",
    completedAt: task.completedAt || "",
    droppedAt: task.droppedAt || "",
    statusBeforeDrop: task.statusBeforeDrop || "",
    restoredAt: task.restoredAt || "",
    restoredBySub: task.restoredBySub || "",
    restoredByName: task.restoredByName || ""
  };
}

function buildTaskNoteSummary(note = {}, fallbackId = "") {
  return {
    noteId: note.noteId || fallbackId,
    taskId: note.taskId || "",
    body: note.body || "",
    author: note.author || "",
    source: note.source || "chat",
    authorSub: note.authorSub || "",
    createdAt: note.createdAt || ""
  };
}

function buildEventSummary(event = {}, fallbackId = "") {
  return {
    eventId: event.eventId || fallbackId,
    title: event.title || "",
    lifeArea: event.lifeArea || "home",
    status: event.status || "scheduled",
    startDateTime: event.startDateTime || "",
    endDateTime: event.endDateTime || "",
    allDay: event.allDay === true,
    location: event.location || "",
    notes: event.notes || "",
    recurrence: event.recurrence || "none",
    recurrenceNotes: event.recurrenceNotes || "",
    requestedBy: event.requestedBy || "Dan",
    createdAt: event.createdAt || "",
    updatedAt: event.updatedAt || "",
    completedAt: event.completedAt || "",
    cancelledAt: event.cancelledAt || ""
  };
}

function buildRoutineSummary(routine = {}, fallbackId = "") {
  return {
    routineId: routine.routineId || fallbackId,
    title: routine.title || "",
    lifeArea: routine.lifeArea || "home",
    status: routine.status || "active",
    recurrence: routine.recurrence || "daily",
    recurrenceNotes: routine.recurrenceNotes || "",
    preferredTime: routine.preferredTime || "",
    assignedTo: routine.assignedTo || "Dan",
    requestedBy: routine.requestedBy || "Dan",
    notes: routine.notes || "",
    visibility: getRecordVisibility(routine),
    ownerSub: routine.ownerSub || routine.createdBySub || "",
    ownerName: routine.ownerName || routine.createdByName || "",
    ownerEmail: routine.ownerEmail || "",
    version: Number.isInteger(routine.version) ? routine.version : 1,
    createdBySub: routine.createdBySub || "",
    createdByName: routine.createdByName || "",
    updatedBySub: routine.updatedBySub || "",
    updatedByName: routine.updatedByName || "",
    createdAt: routine.createdAt || "",
    updatedAt: routine.updatedAt || "",
    archivedAt: routine.archivedAt || "",
    statusBeforeArchive: routine.statusBeforeArchive || "",
    restoredAt: routine.restoredAt || "",
    restoredBySub: routine.restoredBySub || "",
    restoredByName: routine.restoredByName || ""
  };
}

function buildBriefProject(project = {}) {
  return {
    projectId: project.projectId || "",
    name: project.name || "",
    lifeArea: project.lifeArea || "work",
    department: project.department || "",
    outcome: project.outcome || "",
    status: project.status || "active",
    priority: project.priority || "medium",
    targetDate: project.targetDate || "",
    leadName: project.leadName || "",
    leadSub: project.leadSub || "",
    health: project.health || "unknown",
    healthNote: project.healthNote || "",
    nextReviewDate: project.nextReviewDate || "",
    milestoneCount: Array.isArray(project.milestones) ? project.milestones.length : 0,
    openDependencyCount: Array.isArray(project.dependencies)
      ? project.dependencies.filter((item) => item.status !== "resolved").length
      : 0,
    visibility: getRecordVisibility(project)
  };
}

function buildBriefTask(task = {}) {
  const workOnDate = task.workOnDate || task.scheduledDate || "";
  const workOnStartTime = task.workOnStartTime || task.scheduledTime || "";
  return {
    taskId: task.taskId || "",
    title: task.title || "",
    projectId: task.projectId || "",
    eventId: task.eventId || "",
    lifeArea: task.lifeArea || "work",
    department: task.department || "",
    status: task.status || "next",
    priority: task.priority || "medium",
    dueDate: task.dueDate || "",
    workOnDate,
    workOnStartTime,
    workOnEndTime: task.workOnEndTime || "",
    workOnTimeZone: task.workOnTimeZone || "",
    scheduledDate: task.scheduledDate || "",
    scheduledTime: task.scheduledTime || "",
    timeWindow: task.timeWindow || "",
    followUpDate: task.followUpDate || "",
    requestedBy: task.requestedBy || "Dan",
    assignedTo: task.assignedTo || "Dan",
    assignedToSub: task.assignedToSub || "",
    assignedToEmail: task.assignedToEmail || "",
    assignedByName: task.assignedByName || "",
    assignmentStatus: task.assignmentStatus || (task.assignedToSub ? "accepted" : "unassigned"),
    assignmentResponseNote: task.assignmentResponseNote || "",
    estimatedMinutes: Number.isInteger(task.estimatedMinutes) ? task.estimatedMinutes : 0,
    context: task.context || "",
    autoCompleteAfterEvent: task.autoCompleteAfterEvent === true,
    noteCount: Number.isInteger(task.noteCount) ? task.noteCount : 0,
    lastNoteAt: task.lastNoteAt || "",
    lastNoteBy: task.lastNoteBy || "",
    lastNotePreview: task.lastNotePreview || "",
    visibility: getRecordVisibility(task),
    outlookEventId: task.outlookEventId || task.eventId || "",
    outlookSyncStatus: task.outlookSyncStatus || "none"
  };
}

function buildCompactTask(task = {}) {
  const workOnDate = task.workOnDate || task.scheduledDate || "";
  const workOnStartTime = task.workOnStartTime || task.scheduledTime || "";
  return {
    taskId: task.taskId || "",
    title: task.title || "",
    projectId: task.projectId || "",
    lifeArea: task.lifeArea || "work",
    department: task.department || "",
    status: task.status || "next",
    priority: task.priority || "medium",
    dueDate: task.dueDate || "",
    workOnDate,
    workOnStartTime,
    timeWindow: task.timeWindow || "",
    waitingOn: task.waitingOn || "",
    followUpDate: task.followUpDate || "",
    requestedBy: task.requestedBy || "Dan",
    assignedTo: task.assignedTo || "Dan",
    assignedToSub: task.assignedToSub || "",
    assignmentStatus: task.assignmentStatus || (task.assignedToSub ? "accepted" : "unassigned"),
    estimatedMinutes: Number.isInteger(task.estimatedMinutes) ? task.estimatedMinutes : 0,
    visibility: getRecordVisibility(task),
    completedAt: task.completedAt || "",
    droppedAt: task.droppedAt || ""
  };
}

function buildOverdueReviewItem(task = {}, today = "") {
  const dueAt = new Date(`${task.dueDate}T12:00:00.000Z`).getTime();
  const todayAt = new Date(`${today}T12:00:00.000Z`).getTime();
  const daysOverdue = Number.isFinite(dueAt) && Number.isFinite(todayAt)
    ? Math.max(1, Math.floor((todayAt - dueAt) / 86400000))
    : 1;
  return {
    ...buildBriefTask(task),
    reviewReason: "overdue",
    daysOverdue,
    reviewUrgency: daysOverdue >= 7 ? "urgent" : "review",
    priorityChanged: false,
    decisionOptions: ["complete", "plan work", "revise deadline", "delegate", "drop"]
  };
}

function isPersonalRecordForAccess(record = {}, access = {}) {
  const subjects = Array.isArray(access.subjects)
    ? access.subjects.map(normalizeString).filter(Boolean)
    : [normalizeString(access.subject)].filter(Boolean);
  const email = normalizeString(access.email).toLowerCase();
  const name = normalizeString(access.name).toLowerCase();
  if (!subjects.length && !email && !name) return true;
  if (subjects.length && [record.assignedToSub, record.ownerSub, record.createdBySub, record.leadSub]
    .map(normalizeString).some((subject) => subjects.includes(subject))) return true;
  if (email && [record.assignedToEmail, record.ownerEmail, record.leadEmail]
    .map((value) => normalizeString(value).toLowerCase()).includes(email)) return true;
  return Boolean(name && [record.assignedTo, record.ownerName, record.leadName]
    .map((value) => normalizeString(value).toLowerCase()).includes(name));
}

function buildBriefEvent(event = {}) {
  return {
    eventId: event.eventId || "",
    title: event.title || "",
    lifeArea: event.lifeArea || "home",
    status: event.status || "scheduled",
    startDateTime: event.startDateTime || "",
    endDateTime: event.endDateTime || "",
    allDay: event.allDay === true,
    location: event.location || "",
    recurrence: event.recurrence || "none",
    requestedBy: event.requestedBy || "Dan"
  };
}

function buildBriefRoutine(routine = {}) {
  return {
    routineId: routine.routineId || "",
    title: routine.title || "",
    lifeArea: routine.lifeArea || "home",
    recurrence: routine.recurrence || "daily",
    preferredTime: routine.preferredTime || "",
    assignedTo: routine.assignedTo || "Dan",
    requestedBy: routine.requestedBy || "Dan",
    visibility: getRecordVisibility(routine)
  };
}

async function loadCollection(collectionRef, maxDocs = 500) {
  const snapshot = await collectionRef.limit(maxDocs).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() || {}
  }));
}

function getProjectCollection({ projectsCollection } = {}) {
  if (!projectsCollection || typeof projectsCollection.doc !== "function") {
    throw createProjectTaskError(
      "Projects collection is not configured",
      500,
      {},
      "projects_collection_not_configured"
    );
  }

  return projectsCollection;
}

function getTaskCollection({ tasksCollection } = {}) {
  if (!tasksCollection || typeof tasksCollection.doc !== "function") {
    throw createProjectTaskError(
      "Tasks collection is not configured",
      500,
      {},
      "tasks_collection_not_configured"
    );
  }

  return tasksCollection;
}

function getTaskNoteCollection({ taskNotesCollection } = {}) {
  if (!taskNotesCollection || typeof taskNotesCollection.doc !== "function") {
    throw createProjectTaskError(
      "Task notes collection is not configured",
      500,
      {},
      "task_notes_collection_not_configured"
    );
  }

  return taskNotesCollection;
}

function getEventCollection({ calendarEventsCollection } = {}) {
  if (!calendarEventsCollection || typeof calendarEventsCollection.doc !== "function") {
    throw createProjectTaskError(
      "Calendar events collection is not configured",
      500,
      {},
      "calendar_events_collection_not_configured"
    );
  }

  return calendarEventsCollection;
}

function getRoutineCollection({ routinesCollection } = {}) {
  if (!routinesCollection || typeof routinesCollection.doc !== "function") {
    throw createProjectTaskError(
      "Routines collection is not configured",
      500,
      {},
      "routines_collection_not_configured"
    );
  }

  return routinesCollection;
}

function getStaffProfileCollection({ taskStaffProfilesCollection } = {}) {
  if (!taskStaffProfilesCollection || typeof taskStaffProfilesCollection.doc !== "function") {
    throw createProjectTaskError(
      "Task staff profiles collection is not configured",
      500,
      {},
      "task_staff_profiles_collection_not_configured"
    );
  }
  return taskStaffProfilesCollection;
}

function getNotificationCollection({ taskNotificationsCollection } = {}) {
  if (!taskNotificationsCollection || typeof taskNotificationsCollection.doc !== "function") {
    throw createProjectTaskError(
      "Task notifications collection is not configured",
      500,
      {},
      "task_notifications_collection_not_configured"
    );
  }
  return taskNotificationsCollection;
}

function buildStaffProfileSummary(profile = {}, fallbackId = "") {
  return {
    profileId: profile.profileId || fallbackId,
    subject: profile.subject || "",
    displayName: profile.displayName || profile.email || "",
    email: profile.email || "",
    role: STAFF_PROFILE_ROLES.includes(profile.role) ? profile.role : "member",
    status: STAFF_PROFILE_STATUSES.includes(profile.status) ? profile.status : "active",
    managerSub: profile.managerSub || "",
    weeklyCapacityMinutes: Number.isInteger(profile.weeklyCapacityMinutes) ? profile.weeklyCapacityMinutes : 0,
    sharePrivateCapacity: profile.sharePrivateCapacity === true,
    version: Number.isInteger(profile.version) ? profile.version : 1,
    firstSeenAt: profile.firstSeenAt || "",
    lastSeenAt: profile.lastSeenAt || "",
    updatedAt: profile.updatedAt || "",
    updatedBySub: profile.updatedBySub || "",
    updatedByName: profile.updatedByName || ""
  };
}

function buildNotificationSummary(notification = {}, fallbackId = "") {
  return {
    notificationId: notification.notificationId || fallbackId,
    recipientSub: notification.recipientSub || "",
    type: notification.type || "assignment",
    taskId: notification.taskId || "",
    title: notification.title || "",
    message: notification.message || "",
    actorSub: notification.actorSub || "",
    actorName: notification.actorName || "",
    createdAt: notification.createdAt || "",
    readAt: notification.readAt || ""
  };
}

function getEventEffectiveEnd(event = {}) {
  return normalizeString(event.endDateTime) || normalizeString(event.startDateTime);
}

function isEventPast(event = {}, nowIso = "") {
  const effectiveEnd = getEventEffectiveEnd(event);

  if (!effectiveEnd) {
    return false;
  }

  const eventDate = new Date(effectiveEnd);
  const nowDate = new Date(nowIso);

  return !Number.isNaN(eventDate.getTime()) &&
    !Number.isNaN(nowDate.getTime()) &&
    eventDate.getTime() < nowDate.getTime();
}

async function completeTasksForPastEvents(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const calendarEventsCollection = getEventCollection(deps);
  const nowIso = normalizeOptionalDateTime(input.nowIso, "nowIso") || getNowIso(deps);
  const taskRecords = await loadCollection(tasksCollection, 1000);
  const openEventTaskRecords = taskRecords.filter(({ data }) =>
    data &&
    data.autoCompleteAfterEvent === true &&
    normalizeString(data.eventId) &&
    !["done", "dropped"].includes(data.status)
  );

  if (openEventTaskRecords.length === 0) {
    return {
      completedCount: 0,
      completedTasks: []
    };
  }

  const eventRecords = await loadCollection(calendarEventsCollection, 1000);
  const eventsById = new Map(eventRecords.map(({ id, data }) => [id, { ...data, eventId: id }]));
  const completedTasks = [];

  for (const { id, data } of openEventTaskRecords) {
    const eventId = normalizeString(data.eventId);
    const event = eventsById.get(eventId);

    if (!event || !isEventPast(event, nowIso)) {
      continue;
    }

    const nextTask = {
      ...clone(data),
      taskId: id,
      status: "done",
      completedAt: nowIso,
      completedByEventId: eventId,
      updatedAt: nowIso
    };
    nextTask.searchText = buildTaskSearchText(nextTask);
    await tasksCollection.doc(id).set(nextTask);
    completedTasks.push(buildTaskSummary(nextTask, id));
  }

  return {
    completedCount: completedTasks.length,
    completedTasks
  };
}

async function saveProjectWithDepartmentCascade({
  docRef,
  nextProject,
  projectId,
  departmentChanged,
  deps,
  nowIso,
  actor
}) {
  if (!departmentChanged) {
    await docRef.set(nextProject);
    return 0;
  }

  const tasksCollection = getTaskCollection(deps);
  const taskRecords = (await loadCollection(tasksCollection, 2000))
    .filter(({ data }) => normalizeString(data.projectId) === projectId)
    .filter(({ data }) => normalizeString(data.department).toLowerCase() !== nextProject.department)
    .map(({ id, data }) => {
      const task = {
        ...clone(data),
        taskId: id,
        department: nextProject.department,
        version: Math.max(1, Number(data.version) || 1) + 1,
        updatedBySub: actor.actorSub,
        updatedByName: actor.actorName,
        updatedAt: nowIso
      };
      task.searchText = buildTaskSearchText(task);
      return { id, task };
    });

  const firestore = docRef.firestore || tasksCollection.firestore;
  if (firestore && typeof firestore.batch === "function" && taskRecords.length <= 450) {
    const batch = firestore.batch();
    batch.set(docRef, nextProject);
    for (const { id, task } of taskRecords) {
      batch.set(tasksCollection.doc(id), task);
    }
    await batch.commit();
  } else {
    for (const { id, task } of taskRecords) {
      await tasksCollection.doc(id).set(task);
    }
    await docRef.set(nextProject);
  }

  return taskRecords.length;
}

async function createProject(input = {}, deps = {}) {
  const projectsCollection = getProjectCollection(deps);
  const name = normalizeString(input.name);

  if (!name) {
    throw createProjectTaskError("Missing project name", 400, {}, "missing_project_name");
  }

  assertCanCreateTaskRecord(input, deps, "project");

  const nowIso = getNowIso(deps);
  const projectId = normalizeString(input.projectId)
    ? validateDocId(input.projectId, "projectId")
    : createId("proj", name, deps);
  const docRef = projectsCollection.doc(projectId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createProjectTaskError(
      "Project already exists",
      409,
      { projectId },
      "project_already_exists"
    );
  }

  const actor = getTaskActorFields(deps);
  const project = {
    projectId,
    name,
    lifeArea: normalizeEnum(input.lifeArea, LIFE_AREAS, "work", "life_area"),
    department: normalizeDepartment(input.department),
    outcome: normalizeString(input.outcome),
    status: normalizeEnum(input.status, PROJECT_STATUSES, "active", "project_status"),
    priority: normalizeEnum(input.priority, TASK_PRIORITIES, "medium", "project_priority"),
    targetDate: normalizeOptionalDate(input.targetDate, "targetDate"),
    requestedBy: normalizeString(input.requestedBy) || "Dan",
    leadSub: normalizeString(input.leadSub) || actor.actorSub,
    leadName: normalizeString(input.leadName) || actor.actorName,
    leadEmail: normalizeString(input.leadEmail) || actor.actorEmail,
    health: normalizeEnum(input.health, PROJECT_HEALTH_STATUSES, "unknown", "project_health"),
    healthNote: normalizeString(input.healthNote),
    lastHealthAt: normalizeString(input.health) || normalizeString(input.healthNote) ? nowIso : "",
    nextReviewDate: normalizeOptionalDate(input.nextReviewDate, "nextReviewDate"),
    milestones: normalizeMilestones(input.milestones) || [],
    dependencies: normalizeDependencies(input.dependencies) || [],
    notes: normalizeString(input.notes),
    visibility: normalizeVisibility(
      input.visibility,
      getTaskAccess(deps).role === "manager" ? "staff" : "private"
    ),
    ownerSub: actor.actorSub,
    ownerName: actor.actorName,
    ownerEmail: actor.actorEmail,
    version: 1,
    createdBySub: actor.actorSub,
    createdByName: actor.actorName,
    updatedBySub: actor.actorSub,
    updatedByName: actor.actorName,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: "",
    archivedAt: "",
    statusBeforeArchive: "",
    restoredAt: "",
    restoredBySub: "",
    restoredByName: ""
  };

  if (project.status === "done") {
    project.completedAt = nowIso;
  }
  if (project.status === "archived") {
    project.archivedAt = nowIso;
  }

  project.searchText = buildProjectSearchText(project);
  await docRef.create(project);

  return {
    project: buildProjectSummary(project, projectId)
  };
}

async function listProjects(input = {}, deps = {}) {
  const projectsCollection = getProjectCollection(deps);
  const limit = normalizeLimit(input.limit);
  const status = normalizeString(input.status);
  const lifeArea = normalizeString(input.lifeArea);
  const department = normalizeDepartment(input.department);
  const priority = normalizeString(input.priority);
  const targetOnOrBefore = normalizeOptionalDate(input.targetOnOrBefore, "targetOnOrBefore");
  const query = normalizeString(input.query).toLowerCase();

  if (status && !PROJECT_STATUSES.includes(status)) {
    throw createProjectTaskError(
      "Invalid project status",
      400,
      { status, allowedValues: PROJECT_STATUSES },
      "invalid_project_status"
    );
  }

  if (lifeArea && !LIFE_AREAS.includes(lifeArea)) {
    throw createProjectTaskError(
      "Invalid life area",
      400,
      { lifeArea, allowedValues: LIFE_AREAS },
      "invalid_life_area"
    );
  }

  if (priority && !TASK_PRIORITIES.includes(priority)) {
    throw createProjectTaskError(
      "Invalid project priority",
      400,
      { priority, allowedValues: TASK_PRIORITIES },
      "invalid_project_priority"
    );
  }

  const records = await loadCollection(projectsCollection, 500);
  const projects = records
    .map(({ id, data }) => buildProjectSummary(data, id))
    .filter((project) => canReadTaskRecord(project, deps))
    .filter((project) => !status || project.status === status)
    .filter((project) => !lifeArea || project.lifeArea === lifeArea)
    .filter((project) => !department || project.department === department)
    .filter((project) => !priority || project.priority === priority)
    .filter((project) => !targetOnOrBefore || (project.targetDate && project.targetDate <= targetOnOrBefore))
    .filter((project) => !query || buildProjectSearchText(project).includes(query))
    .sort((a, b) => {
      const targetCompare = (a.targetDate || "9999-99-99").localeCompare(b.targetDate || "9999-99-99");
      if (targetCompare !== 0) {
        return targetCompare;
      }

      const priorityWeight = { high: 0, medium: 1, low: 2 };
      const priorityCompare = (priorityWeight[a.priority] ?? 1) - (priorityWeight[b.priority] ?? 1);
      if (priorityCompare !== 0) {
        return priorityCompare;
      }

      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    })
    .slice(0, limit);

  return {
    count: projects.length,
    projects
  };
}

async function getProject(input = {}, deps = {}) {
  const projectsCollection = getProjectCollection(deps);
  const projectId = validateDocId(input.projectId, "projectId");
  const doc = await projectsCollection.doc(projectId).get();

  if (!doc.exists) {
    throw createProjectTaskError(
      "Project not found",
      404,
      { projectId },
      "project_not_found"
    );
  }

  assertCanReadTaskRecord(doc.data() || {}, deps, { projectId });

  return {
    project: buildProjectSummary(doc.data() || {}, projectId)
  };
}

async function updateProject(input = {}, deps = {}) {
  const projectsCollection = getProjectCollection(deps);
  const projectId = validateDocId(input.projectId, "projectId");
  const docRef = projectsCollection.doc(projectId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createProjectTaskError(
      "Project not found",
      404,
      { projectId },
      "project_not_found"
    );
  }

  const existing = doc.data() || {};
  const changes = isPlainObject(input.changes) ? input.changes : input;
  assertCanUpdateTaskRecord(existing, changes, deps, "project");
  assertExpectedVersion(input, existing, deps, "project", projectId);
  const nowIso = getNowIso(deps);
  const actor = getTaskActorFields(deps);
  const nextProject = {
    ...clone(existing),
    projectId
  };

  if (Object.prototype.hasOwnProperty.call(changes, "name")) {
    const name = normalizeString(changes.name);
    if (!name) {
      throw createProjectTaskError("Project name cannot be blank", 400, {}, "blank_project_name");
    }
    nextProject.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "lifeArea")) {
    nextProject.lifeArea = normalizeEnum(
      changes.lifeArea,
      LIFE_AREAS,
      nextProject.lifeArea || "work",
      "life_area"
    );
  }

  const departmentChanged = Object.prototype.hasOwnProperty.call(changes, "department") &&
    normalizeDepartment(changes.department) !== (nextProject.department || "");
  if (Object.prototype.hasOwnProperty.call(changes, "department")) {
    nextProject.department = normalizeDepartment(changes.department);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "outcome")) {
    nextProject.outcome = normalizeString(changes.outcome);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    nextProject.status = normalizeEnum(
      changes.status,
      PROJECT_STATUSES,
      nextProject.status || "active",
      "project_status"
    );
    if (nextProject.status === "done" && !nextProject.completedAt) {
      nextProject.completedAt = nowIso;
    }
    if (nextProject.status !== "done") {
      nextProject.completedAt = "";
    }
    if (nextProject.status === "archived" && existing.status !== "archived") {
      nextProject.statusBeforeArchive = existing.status || "active";
      nextProject.archivedAt = nowIso;
    }
    if (existing.status === "archived" && nextProject.status !== "archived") {
      nextProject.statusBeforeArchive = "";
      nextProject.archivedAt = "";
      nextProject.restoredAt = nowIso;
      nextProject.restoredBySub = actor.actorSub;
      nextProject.restoredByName = actor.actorName;
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
    nextProject.priority = normalizeEnum(
      changes.priority,
      TASK_PRIORITIES,
      nextProject.priority || "medium",
      "project_priority"
    );
  }

  if (Object.prototype.hasOwnProperty.call(changes, "targetDate")) {
    nextProject.targetDate = normalizeOptionalDate(changes.targetDate, "targetDate");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "requestedBy")) {
    nextProject.requestedBy = normalizeString(changes.requestedBy) || "Dan";
  }

  for (const field of ["leadSub", "leadName", "leadEmail"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextProject[field] = normalizeString(changes[field]);
    }
  }

  const ownershipFields = ["ownerSub", "ownerName", "ownerEmail"];
  if (ownershipFields.some((field) => Object.prototype.hasOwnProperty.call(changes, field))) {
    if (!isTaskAdmin(deps)) {
      throw createProjectTaskError(
        "Only a task administrator may change project ownership",
        403,
        { projectId },
        "project_owner_update_denied"
      );
    }
    for (const field of ownershipFields) {
      if (Object.prototype.hasOwnProperty.call(changes, field)) {
        nextProject[field] = normalizeString(changes[field]);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "health")) {
    nextProject.health = normalizeEnum(
      changes.health,
      PROJECT_HEALTH_STATUSES,
      nextProject.health || "unknown",
      "project_health"
    );
    nextProject.lastHealthAt = nowIso;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "healthNote")) {
    nextProject.healthNote = normalizeString(changes.healthNote);
    nextProject.lastHealthAt = nowIso;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "nextReviewDate")) {
    nextProject.nextReviewDate = normalizeOptionalDate(changes.nextReviewDate, "nextReviewDate");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "milestones")) {
    nextProject.milestones = normalizeMilestones(changes.milestones) || [];
  }
  if (Object.prototype.hasOwnProperty.call(changes, "dependencies")) {
    nextProject.dependencies = normalizeDependencies(changes.dependencies) || [];
  }

  if (Object.prototype.hasOwnProperty.call(changes, "notes")) {
    nextProject.notes = normalizeString(changes.notes);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "visibility")) {
    nextProject.visibility = normalizeVisibility(changes.visibility, nextProject.visibility || "private");
  }

  nextProject.version = Math.max(1, Number(existing.version) || 1) + 1;
  nextProject.updatedBySub = actor.actorSub;
  nextProject.updatedByName = actor.actorName;
  nextProject.updatedAt = nowIso;
  nextProject.searchText = buildProjectSearchText(nextProject);
  const updatedTaskCount = await saveProjectWithDepartmentCascade({
    docRef,
    nextProject,
    projectId,
    departmentChanged,
    deps,
    nowIso,
    actor
  });

  return {
    project: buildProjectSummary(nextProject, projectId),
    departmentCascade: {
      changed: departmentChanged,
      updatedTaskCount
    }
  };
}

async function createTaskNotification({ recipientSub, type, taskId, title, message, actor } = {}, deps = {}) {
  const cleanRecipientSub = normalizeString(recipientSub);
  if (!cleanRecipientSub) return null;
  const collection = getNotificationCollection(deps);
  const nowIso = getNowIso(deps);
  const idFactory = typeof deps.randomUUID === "function" ? deps.randomUUID : randomUUID;
  const notificationKey = createHash("sha256")
    .update([type, taskId, cleanRecipientSub, message].map(normalizeString).join("|"))
    .digest("hex")
    .slice(0, 10);
  const notificationId = `notification-${slugify(type)}-${notificationKey}-${idFactory().slice(0, 8)}`;
  const notification = {
    notificationId,
    recipientSub: cleanRecipientSub,
    type: normalizeString(type) || "assignment",
    taskId: normalizeString(taskId),
    title: normalizeString(title),
    message: normalizeString(message),
    actorSub: normalizeString(actor?.actorSub),
    actorName: normalizeString(actor?.actorName),
    createdAt: nowIso,
    readAt: ""
  };
  await collection.doc(notificationId).create(notification);
  return buildNotificationSummary(notification, notificationId);
}

async function createTask(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const title = normalizeString(input.title);

  if (!title) {
    throw createProjectTaskError("Missing task title", 400, {}, "missing_task_title");
  }

  assertCanCreateTaskRecord(input, deps, "task");

  const nowIso = getNowIso(deps);
  const sourceMessageId = normalizeString(input.sourceMessageId);
  if (sourceMessageId) {
    const matchingSource = (await loadCollection(tasksCollection, 2000))
      .find(({ data }) => data.sourceMessageId === sourceMessageId && canReadTaskRecord(data, deps));
    if (matchingSource) {
      throw createProjectTaskError(
        "This email message is already linked to a task",
        409,
        { taskId: matchingSource.id, sourceMessageId },
        "task_source_already_captured"
      );
    }
  }
  const taskId = normalizeString(input.taskId)
    ? validateDocId(input.taskId, "taskId")
    : createId("task", title, deps);
  const docRef = tasksCollection.doc(taskId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createProjectTaskError(
      "Task already exists",
      409,
      { taskId },
      "task_already_exists"
    );
  }

  const status = normalizeEnum(input.status, TASK_STATUSES, "next", "task_status");
  let defaultVisibility = getTaskAccess(deps).role === "manager" ? "staff" : "private";
  const projectId = normalizeString(input.projectId);
  const accessibleProject = await assertProjectReferenceAccessible(projectId, deps);
  if (!normalizeString(input.visibility) && accessibleProject) {
    defaultVisibility = getRecordVisibility(accessibleProject);
  }
  const requestedDepartment = normalizeDepartment(input.department);
  const projectDepartment = projectId
    ? normalizeDepartment(accessibleProject?.department)
    : "";
  if (projectId && requestedDepartment && requestedDepartment !== projectDepartment) {
    throw createProjectTaskError(
      "A task in a project must use the project's department",
      409,
      {
        projectId,
        projectDepartment,
        requestedDepartment
      },
      "task_project_department_conflict"
    );
  }
  const actor = getTaskActorFields(deps);
  const assignedTo = normalizeString(input.assignedTo) || actor.actorName || "Dan";
  const assignedToSub = normalizeString(input.assignedToSub) || actor.actorSub;
  const assignedToEmail = normalizeString(input.assignedToEmail) || actor.actorEmail;
  const isSelfAssignment = Boolean(actor.actorSub && assignedToSub === actor.actorSub);
  const isTerminalTask = ["done", "dropped"].includes(status);
  const assignmentStatus = !assignedToSub && !assignedToEmail && !assignedTo
    ? "unassigned"
    : isSelfAssignment || isTerminalTask
      ? "accepted"
      : "proposed";
  const workOnDate = normalizeOptionalDate(input.workOnDate || input.scheduledDate, "workOnDate");
  const workOnStartTime = normalizeOptionalTime(
    input.workOnStartTime || input.scheduledTime,
    "workOnStartTime"
  );
  const workOnEndTime = normalizeOptionalTime(input.workOnEndTime, "workOnEndTime");
  if (workOnStartTime && workOnEndTime && workOnEndTime <= workOnStartTime) {
    throw createProjectTaskError(
      "workOnEndTime must be later than workOnStartTime",
      400,
      { workOnStartTime, workOnEndTime },
      "invalid_work_on_time_range"
    );
  }
  const task = {
    taskId,
    title,
    projectId,
    eventId: normalizeString(input.eventId),
    lifeArea: normalizeEnum(input.lifeArea, LIFE_AREAS, "work", "life_area"),
    department: projectId ? projectDepartment : requestedDepartment,
    status,
    priority: normalizeEnum(input.priority, TASK_PRIORITIES, "medium", "task_priority"),
    dueDate: normalizeOptionalDate(input.dueDate, "dueDate"),
    workOnDate,
    workOnStartTime,
    workOnEndTime,
    workOnTimeZone: normalizeString(input.workOnTimeZone),
    scheduledDate: workOnDate,
    scheduledTime: workOnStartTime,
    timeWindow: normalizeString(input.timeWindow),
    waitingOn: normalizeString(input.waitingOn),
    followUpDate: normalizeOptionalDate(input.followUpDate, "followUpDate"),
    requestedBy: normalizeString(input.requestedBy) || "Dan",
    assignedTo,
    assignedToSub,
    assignedToEmail,
    assignedBySub: actor.actorSub,
    assignedByName: actor.actorName,
    assignedAt: nowIso,
    assignmentStatus,
    assignmentRespondedAt: assignmentStatus === "accepted" ? nowIso : "",
    assignmentRespondedBySub: isSelfAssignment ? actor.actorSub : "",
    assignmentResponseNote: "",
    estimatedMinutes: normalizeOptionalInteger(input.estimatedMinutes, "estimated_minutes", { max: 10080 }),
    context: normalizeString(input.context),
    sourceType: normalizeString(input.sourceType),
    sourceMessageId,
    sourceThreadId: normalizeString(input.sourceThreadId),
    sourceSubject: normalizeString(input.sourceSubject),
    sourceSender: normalizeString(input.sourceSender),
    sourceReceivedAt: normalizeOptionalDateTime(input.sourceReceivedAt, "sourceReceivedAt"),
    sourceWebUrl: normalizeString(input.sourceWebUrl),
    autoCompleteAfterEvent: input.autoCompleteAfterEvent === true,
    completedByEventId: "",
    notes: normalizeString(input.notes),
    visibility: normalizeVisibility(input.visibility, defaultVisibility),
    ownerSub: actor.actorSub,
    ownerName: actor.actorName,
    ownerEmail: actor.actorEmail,
    outlookCalendarId: normalizeString(input.outlookCalendarId),
    outlookEventId: normalizeString(input.outlookEventId || input.eventId),
    outlookEventWebUrl: normalizeString(input.outlookEventWebUrl),
    outlookSyncStatus: normalizeEnum(
      input.outlookSyncStatus,
      OUTLOOK_SYNC_STATUSES,
      "none",
      "outlook_sync_status"
    ),
    version: 1,
    createdBySub: actor.actorSub,
    createdByName: actor.actorName,
    updatedBySub: actor.actorSub,
    updatedByName: actor.actorName,
    noteCount: 0,
    lastNoteAt: "",
    lastNoteBy: "",
    lastNotePreview: "",
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: status === "done" ? nowIso : "",
    droppedAt: status === "dropped" ? nowIso : "",
    statusBeforeDrop: "",
    restoredAt: "",
    restoredBySub: "",
    restoredByName: ""
  };

  task.searchText = buildTaskSearchText(task);
  await docRef.create(task);

  let notification = null;
  if (assignmentStatus === "proposed" && assignedToSub && assignedToSub !== actor.actorSub) {
    notification = await createTaskNotification({
      recipientSub: assignedToSub,
      type: "assignment",
      taskId,
      title: "New task assignment",
      message: `${actor.actorName || "A team member"} assigned: ${title}`,
      actor
    }, deps);
  }

  return {
    task: buildTaskSummary(task, taskId),
    notification
  };
}

async function getTask(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const taskId = validateDocId(input.taskId, "taskId");
  const doc = await tasksCollection.doc(taskId).get();

  if (!doc.exists) {
    throw createProjectTaskError(
      "Task not found",
      404,
      { taskId },
      "task_not_found"
    );
  }

  assertCanReadTaskRecord(doc.data() || {}, deps, { taskId });

  return {
    task: buildTaskSummary(doc.data() || {}, taskId)
  };
}

async function addTaskNote(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const taskNotesCollection = getTaskNoteCollection(deps);
  const taskId = validateDocId(input.taskId, "taskId");
  const body = normalizeString(input.body);
  const author = normalizeString(input.author);

  if (!body) {
    throw createProjectTaskError("Missing task note body", 400, {}, "missing_task_note_body");
  }
  if (!author) {
    throw createProjectTaskError("Missing task note author", 400, {}, "missing_task_note_author");
  }

  const taskRef = tasksCollection.doc(taskId);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) {
    throw createProjectTaskError(
      "Task not found",
      404,
      { taskId },
      "task_not_found"
    );
  }

  assertCanAddTaskNote({ ...(taskDoc.data() || {}), taskId }, deps);

  const nowIso = getNowIso(deps);
  const noteId = normalizeString(input.noteId)
    ? validateDocId(input.noteId, "noteId")
    : createId("task-note", `${taskId}-${author}`, deps);
  const noteRef = taskNotesCollection.doc(noteId);
  const existingNote = await noteRef.get();
  if (existingNote.exists) {
    throw createProjectTaskError(
      "Task note already exists",
      409,
      { noteId, taskId },
      "task_note_already_exists"
    );
  }

  const actor = getTaskActorFields(deps);
  const note = {
    noteId,
    taskId,
    body,
    author,
    source: normalizeString(input.source) || "chat",
    authorSub: actor.actorSub,
    createdAt: nowIso
  };
  note.searchText = buildTaskNoteSearchText(note);
  const buildUpdatedTask = (taskData = {}) => {
    const task = {
      ...clone(taskData),
      taskId,
      noteCount: Math.max(0, Number(taskData.noteCount) || 0) + 1,
      lastNoteAt: nowIso,
      lastNoteBy: author,
      lastNotePreview: body.slice(0, 240),
      version: Math.max(1, Number(taskData.version) || 1) + 1,
      updatedBySub: actor.actorSub,
      updatedByName: actor.actorName,
      updatedAt: nowIso
    };
    task.searchText = buildTaskSearchText(task);
    return task;
  };

  let task;
  const firestore = taskNotesCollection.firestore || tasksCollection.firestore;
  if (firestore && typeof firestore.runTransaction === "function") {
    await firestore.runTransaction(async (transaction) => {
      const [freshTaskDoc, freshNoteDoc] = await Promise.all([
        transaction.get(taskRef),
        transaction.get(noteRef)
      ]);
      if (!freshTaskDoc.exists) {
        throw createProjectTaskError("Task not found", 404, { taskId }, "task_not_found");
      }
      if (freshNoteDoc.exists) {
        throw createProjectTaskError(
          "Task note already exists",
          409,
          { noteId, taskId },
          "task_note_already_exists"
        );
      }
      task = buildUpdatedTask(freshTaskDoc.data() || {});
      transaction.create(noteRef, note);
      transaction.set(taskRef, task);
    });
  } else {
    task = buildUpdatedTask(taskDoc.data() || {});
    await noteRef.create(note);
    await taskRef.set(task);
  }

  return {
    note: buildTaskNoteSummary(note, noteId),
    task: buildTaskSummary(task, taskId)
  };
}

async function listTaskNotes(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const taskNotesCollection = getTaskNoteCollection(deps);
  const taskId = validateDocId(input.taskId, "taskId");
  const taskDoc = await tasksCollection.doc(taskId).get();

  if (!taskDoc.exists) {
    throw createProjectTaskError(
      "Task not found",
      404,
      { taskId },
      "task_not_found"
    );
  }

  assertCanReadTaskRecord(taskDoc.data() || {}, deps, { taskId });

  const limit = normalizeLimit(input.limit);
  const notes = (await loadCollection(taskNotesCollection, 1000))
    .map(({ id, data }) => buildTaskNoteSummary(data, id))
    .filter((note) => note.taskId === taskId)
    .sort((left, right) => (left.createdAt || "").localeCompare(right.createdAt || ""))
    .slice(-limit);

  return {
    task: buildTaskSummary(taskDoc.data() || {}, taskId),
    count: notes.length,
    notes
  };
}

async function listTasks(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const limit = normalizeLimit(input.limit);
  const detailLevel = normalizeString(input.detailLevel) === "compact" ? "compact" : "full";
  const status = normalizeString(input.status);
  const priority = normalizeString(input.priority);
  const projectId = normalizeString(input.projectId);
  const eventId = normalizeString(input.eventId);
  const lifeArea = normalizeString(input.lifeArea);
  const department = normalizeDepartment(input.department);
  const requestedBy = normalizeString(input.requestedBy).toLowerCase();
  const assignedTo = normalizeString(input.assignedTo).toLowerCase();
  const assignedToSub = normalizeString(input.assignedToSub);
  const sourceMessageId = normalizeString(input.sourceMessageId);
  const workOnDate = normalizeOptionalDate(input.workOnDate, "workOnDate");
  const workOnOnOrBefore = normalizeOptionalDate(input.workOnOnOrBefore, "workOnOnOrBefore");
  const query = normalizeString(input.query).toLowerCase();
  const dueBefore = normalizeOptionalDate(input.dueBefore, "dueBefore");
  const dueOnOrBefore = normalizeOptionalDate(input.dueOnOrBefore, "dueOnOrBefore");
  const followUpOnOrBefore = normalizeOptionalDate(input.followUpOnOrBefore, "followUpOnOrBefore");

  if (status && !TASK_STATUSES.includes(status)) {
    throw createProjectTaskError(
      "Invalid task status",
      400,
      { status, allowedValues: TASK_STATUSES },
      "invalid_task_status"
    );
  }

  if (priority && !TASK_PRIORITIES.includes(priority)) {
    throw createProjectTaskError(
      "Invalid task priority",
      400,
      { priority, allowedValues: TASK_PRIORITIES },
      "invalid_task_priority"
    );
  }

  if (lifeArea && !LIFE_AREAS.includes(lifeArea)) {
    throw createProjectTaskError(
      "Invalid life area",
      400,
      { lifeArea, allowedValues: LIFE_AREAS },
      "invalid_life_area"
    );
  }

  const records = await loadCollection(tasksCollection, 1000);
  const tasks = records
    .map(({ id, data }) => buildTaskSummary(data, id))
    .filter((task) => canReadTaskRecord(task, deps))
    .filter((task) => !status || task.status === status)
    .filter((task) => !priority || task.priority === priority)
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => !eventId || task.eventId === eventId)
    .filter((task) => !lifeArea || task.lifeArea === lifeArea)
    .filter((task) => !department || task.department === department)
    .filter((task) => !requestedBy || task.requestedBy.toLowerCase() === requestedBy)
    .filter((task) => !assignedTo || task.assignedTo.toLowerCase() === assignedTo)
    .filter((task) => !assignedToSub || task.assignedToSub === assignedToSub)
    .filter((task) => !sourceMessageId || task.sourceMessageId === sourceMessageId)
    .filter((task) => !workOnDate || task.workOnDate === workOnDate)
    .filter((task) => !workOnOnOrBefore || (task.workOnDate && task.workOnDate <= workOnOnOrBefore))
    .filter((task) => !query || buildTaskSearchText(task).includes(query))
    .filter((task) => !dueBefore || (task.dueDate && task.dueDate < dueBefore))
    .filter((task) => !dueOnOrBefore || (task.dueDate && task.dueDate <= dueOnOrBefore))
    .filter((task) => !followUpOnOrBefore || (task.followUpDate && task.followUpDate <= followUpOnOrBefore))
    .sort((a, b) => {
      const statusRank = { next: 0, scheduled: 1, waiting: 2, done: 3, dropped: 4 };
      const priorityRank = { high: 0, medium: 1, low: 2 };
      const dueA = a.dueDate || "9999-12-31";
      const dueB = b.dueDate || "9999-12-31";

      if ((statusRank[a.status] ?? 9) !== (statusRank[b.status] ?? 9)) {
        return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
      }

      if (dueA !== dueB) {
        return dueA.localeCompare(dueB);
      }

      if ((priorityRank[a.priority] ?? 9) !== (priorityRank[b.priority] ?? 9)) {
        return (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      }

      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    })
    .slice(0, limit);

  return {
    count: tasks.length,
    detailLevel,
    tasks: detailLevel === "compact" ? tasks.map(buildCompactTask) : tasks
  };
}

async function updateTask(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const taskId = validateDocId(input.taskId, "taskId");
  const docRef = tasksCollection.doc(taskId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createProjectTaskError(
      "Task not found",
      404,
      { taskId },
      "task_not_found"
    );
  }

  const existing = doc.data() || {};
  const changes = isPlainObject(input.changes) ? input.changes : input;
  assertCanUpdateTaskRecord(existing, changes, deps, "task");
  assertExpectedVersion(input, existing, deps, "task", taskId);
  const hasProjectChange = Object.prototype.hasOwnProperty.call(changes, "projectId");
  const nextProjectId = hasProjectChange ? normalizeString(changes.projectId) : normalizeString(existing.projectId);
  const referencedProject = await assertProjectReferenceAccessible(nextProjectId, deps);
  const nowIso = getNowIso(deps);
  const actor = getTaskActorFields(deps);
  const nextTask = {
    ...clone(existing),
    taskId
  };
  nextTask.workOnDate = nextTask.workOnDate || nextTask.scheduledDate || "";
  nextTask.workOnStartTime = nextTask.workOnStartTime || nextTask.scheduledTime || "";
  nextTask.workOnEndTime = nextTask.workOnEndTime || "";
  nextTask.workOnTimeZone = nextTask.workOnTimeZone || "";

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    const title = normalizeString(changes.title);
    if (!title) {
      throw createProjectTaskError("Task title cannot be blank", 400, {}, "blank_task_title");
    }
    nextTask.title = title;
  }

  if (hasProjectChange) {
    nextTask.projectId = nextProjectId;
  }

  const hasDepartmentChange = Object.prototype.hasOwnProperty.call(changes, "department");
  const requestedDepartment = hasDepartmentChange
    ? normalizeDepartment(changes.department)
    : normalizeString(nextTask.department).toLowerCase();
  if (nextProjectId) {
    const projectDepartment = normalizeDepartment(referencedProject?.department);
    if (hasDepartmentChange && requestedDepartment !== projectDepartment) {
      throw createProjectTaskError(
        "A task in a project must use the project's department",
        409,
        {
          projectId: nextProjectId,
          projectDepartment,
          requestedDepartment
        },
        "task_project_department_conflict"
      );
    }
    nextTask.department = projectDepartment;
  } else if (hasDepartmentChange) {
    nextTask.department = requestedDepartment;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "eventId")) {
    nextTask.eventId = normalizeString(changes.eventId);
    if (!nextTask.eventId) {
      nextTask.autoCompleteAfterEvent = false;
      nextTask.completedByEventId = "";
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "lifeArea")) {
    nextTask.lifeArea = normalizeEnum(
      changes.lifeArea,
      LIFE_AREAS,
      nextTask.lifeArea || "work",
      "life_area"
    );
  }

  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    nextTask.status = normalizeEnum(
      changes.status,
      TASK_STATUSES,
      nextTask.status || "next",
      "task_status"
    );
    if (nextTask.status === "done" && !nextTask.completedAt) {
      nextTask.completedAt = nowIso;
    }
    if (nextTask.status === "dropped" && !nextTask.droppedAt) {
      nextTask.droppedAt = nowIso;
    }
    if (nextTask.status === "dropped" && existing.status !== "dropped") {
      nextTask.statusBeforeDrop = existing.status || "next";
    }
    if (nextTask.status !== "done") {
      nextTask.completedAt = "";
    }
    if (nextTask.status !== "dropped") {
      nextTask.droppedAt = "";
    }
    if (existing.status === "dropped" && nextTask.status !== "dropped") {
      nextTask.statusBeforeDrop = "";
      nextTask.restoredAt = nowIso;
      nextTask.restoredBySub = actor.actorSub;
      nextTask.restoredByName = actor.actorName;
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
    nextTask.priority = normalizeEnum(
      changes.priority,
      TASK_PRIORITIES,
      nextTask.priority || "medium",
      "task_priority"
    );
  }

  if (Object.prototype.hasOwnProperty.call(changes, "dueDate")) {
    nextTask.dueDate = normalizeOptionalDate(changes.dueDate, "dueDate");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "workOnDate") ||
      Object.prototype.hasOwnProperty.call(changes, "scheduledDate")) {
    nextTask.workOnDate = normalizeOptionalDate(
      Object.prototype.hasOwnProperty.call(changes, "workOnDate")
        ? changes.workOnDate
        : changes.scheduledDate,
      "workOnDate"
    );
    nextTask.scheduledDate = nextTask.workOnDate;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "workOnStartTime") ||
      Object.prototype.hasOwnProperty.call(changes, "scheduledTime")) {
    nextTask.workOnStartTime = normalizeOptionalTime(
      Object.prototype.hasOwnProperty.call(changes, "workOnStartTime")
        ? changes.workOnStartTime
        : changes.scheduledTime,
      "workOnStartTime"
    );
    nextTask.scheduledTime = nextTask.workOnStartTime;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "workOnEndTime")) {
    nextTask.workOnEndTime = normalizeOptionalTime(changes.workOnEndTime, "workOnEndTime");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "workOnTimeZone")) {
    nextTask.workOnTimeZone = normalizeString(changes.workOnTimeZone);
  }

  if (nextTask.workOnStartTime && nextTask.workOnEndTime &&
      nextTask.workOnEndTime <= nextTask.workOnStartTime) {
    throw createProjectTaskError(
      "workOnEndTime must be later than workOnStartTime",
      400,
      {
        workOnStartTime: nextTask.workOnStartTime,
        workOnEndTime: nextTask.workOnEndTime
      },
      "invalid_work_on_time_range"
    );
  }

  if (Object.prototype.hasOwnProperty.call(changes, "timeWindow")) {
    nextTask.timeWindow = normalizeString(changes.timeWindow);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "waitingOn")) {
    nextTask.waitingOn = normalizeString(changes.waitingOn);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "followUpDate")) {
    nextTask.followUpDate = normalizeOptionalDate(changes.followUpDate, "followUpDate");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "estimatedMinutes")) {
    nextTask.estimatedMinutes = normalizeOptionalInteger(
      changes.estimatedMinutes,
      "estimated_minutes",
      { max: 10080 }
    );
  }

  if (Object.prototype.hasOwnProperty.call(changes, "requestedBy")) {
    nextTask.requestedBy = normalizeString(changes.requestedBy) || "Dan";
  }

  const ownershipFields = ["ownerSub", "ownerName", "ownerEmail"];
  if (ownershipFields.some((field) => Object.prototype.hasOwnProperty.call(changes, field))) {
    if (!isTaskAdmin(deps)) {
      throw createProjectTaskError(
        "Only a task administrator may change task ownership",
        403,
        { taskId },
        "task_owner_update_denied"
      );
    }
    for (const field of ownershipFields) {
      if (Object.prototype.hasOwnProperty.call(changes, field)) {
        nextTask[field] = normalizeString(changes[field]);
      }
    }
  }

  const assignmentChanged = ["assignedTo", "assignedToSub", "assignedToEmail"]
    .some((field) => Object.prototype.hasOwnProperty.call(changes, field));
  if (Object.prototype.hasOwnProperty.call(changes, "assignedTo")) {
    nextTask.assignedTo = normalizeString(changes.assignedTo) || "Unassigned";
  }
  if (Object.prototype.hasOwnProperty.call(changes, "assignedToSub")) {
    nextTask.assignedToSub = normalizeString(changes.assignedToSub);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "assignedToEmail")) {
    nextTask.assignedToEmail = normalizeString(changes.assignedToEmail);
  }
  if (assignmentChanged) {
    const assigningActor = getTaskActorFields(deps);
    nextTask.assignedBySub = assigningActor.actorSub;
    nextTask.assignedByName = assigningActor.actorName;
    nextTask.assignedAt = nowIso;
    const selfAssignment = Boolean(assigningActor.actorSub && nextTask.assignedToSub === assigningActor.actorSub);
    const isTerminalTask = ["done", "dropped"].includes(nextTask.status);
    nextTask.assignmentStatus = !nextTask.assignedToSub && !nextTask.assignedToEmail && !normalizeString(nextTask.assignedTo)
      ? "unassigned"
      : selfAssignment || isTerminalTask
        ? "accepted"
        : "proposed";
    nextTask.assignmentRespondedAt = nextTask.assignmentStatus === "accepted" ? nowIso : "";
    nextTask.assignmentRespondedBySub = selfAssignment ? assigningActor.actorSub : "";
    nextTask.assignmentResponseNote = "";
  }

  if (["done", "dropped"].includes(nextTask.status) && nextTask.assignmentStatus === "proposed") {
    nextTask.assignmentStatus = "accepted";
    nextTask.assignmentRespondedAt = nextTask.assignmentRespondedAt || nowIso;
    nextTask.assignmentRespondedBySub = nextTask.assignmentRespondedBySub ||
      (actor.actorSub === nextTask.assignedToSub ? actor.actorSub : "");
    nextTask.assignmentResponseNote = "";
  }

  if (Object.prototype.hasOwnProperty.call(changes, "context")) {
    nextTask.context = normalizeString(changes.context);
  }

  for (const field of ["sourceType", "sourceThreadId", "sourceSubject", "sourceSender", "sourceWebUrl"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextTask[field] = normalizeString(changes[field]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "sourceMessageId")) {
    const sourceMessageId = normalizeString(changes.sourceMessageId);
    if (sourceMessageId && sourceMessageId !== existing.sourceMessageId) {
      const matchingSource = (await loadCollection(tasksCollection, 2000))
        .find(({ id, data }) => id !== taskId && data.sourceMessageId === sourceMessageId && canReadTaskRecord(data, deps));
      if (matchingSource) {
        throw createProjectTaskError(
          "This email message is already linked to a task",
          409,
          { taskId: matchingSource.id, sourceMessageId },
          "task_source_already_captured"
        );
      }
    }
    nextTask.sourceMessageId = sourceMessageId;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "sourceReceivedAt")) {
    nextTask.sourceReceivedAt = normalizeOptionalDateTime(changes.sourceReceivedAt, "sourceReceivedAt");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "autoCompleteAfterEvent")) {
    nextTask.autoCompleteAfterEvent = changes.autoCompleteAfterEvent === true;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "notes")) {
    nextTask.notes = normalizeString(changes.notes);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "visibility")) {
    nextTask.visibility = normalizeVisibility(changes.visibility, nextTask.visibility || "private");
  }

  for (const field of ["outlookCalendarId", "outlookEventId", "outlookEventWebUrl"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextTask[field] = normalizeString(changes[field]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, "outlookSyncStatus")) {
    nextTask.outlookSyncStatus = normalizeEnum(
      changes.outlookSyncStatus,
      OUTLOOK_SYNC_STATUSES,
      nextTask.outlookSyncStatus || "none",
      "outlook_sync_status"
    );
  }

  nextTask.version = Math.max(1, Number(existing.version) || 1) + 1;
  nextTask.updatedBySub = actor.actorSub;
  nextTask.updatedByName = actor.actorName;
  nextTask.updatedAt = nowIso;
  nextTask.searchText = buildTaskSearchText(nextTask);
  await docRef.set(nextTask);

  let notification = null;
  if (assignmentChanged && nextTask.assignmentStatus === "proposed" && nextTask.assignedToSub && nextTask.assignedToSub !== actor.actorSub) {
    notification = await createTaskNotification({
      recipientSub: nextTask.assignedToSub,
      type: "assignment",
      taskId,
      title: "Task reassigned to you",
      message: `${actor.actorName || "A team member"} assigned: ${nextTask.title}`,
      actor
    }, deps);
  }

  return {
    task: buildTaskSummary(nextTask, taskId),
    notification
  };
}

async function createCalendarEvent(input = {}, deps = {}) {
  const calendarEventsCollection = getEventCollection(deps);
  const title = normalizeString(input.title);

  if (!title) {
    throw createProjectTaskError("Missing event title", 400, {}, "missing_event_title");
  }

  const nowIso = getNowIso(deps);
  const eventId = normalizeString(input.eventId)
    ? validateDocId(input.eventId, "eventId")
    : createId("event", title, deps);
  const docRef = calendarEventsCollection.doc(eventId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createProjectTaskError(
      "Calendar event already exists",
      409,
      { eventId },
      "calendar_event_already_exists"
    );
  }

  const event = {
    eventId,
    title,
    lifeArea: normalizeEnum(input.lifeArea, LIFE_AREAS, "home", "life_area"),
    status: normalizeEnum(input.status, EVENT_STATUSES, "scheduled", "event_status"),
    startDateTime: normalizeOptionalDateTime(input.startDateTime, "startDateTime"),
    endDateTime: normalizeOptionalDateTime(input.endDateTime, "endDateTime"),
    allDay: input.allDay === true,
    location: normalizeString(input.location),
    notes: normalizeString(input.notes),
    recurrence: normalizeEnum(input.recurrence, RECURRENCE_TYPES, "none", "recurrence"),
    recurrenceNotes: normalizeString(input.recurrenceNotes),
    requestedBy: normalizeString(input.requestedBy) || "Dan",
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: "",
    cancelledAt: ""
  };

  event.searchText = buildEventSearchText(event);
  await docRef.create(event);

  return {
    event: buildEventSummary(event, eventId)
  };
}

async function listCalendarEvents(input = {}, deps = {}) {
  const calendarEventsCollection = getEventCollection(deps);
  const limit = normalizeLimit(input.limit);
  const status = normalizeString(input.status);
  const lifeArea = normalizeString(input.lifeArea);
  const date = normalizeOptionalDate(input.date, "date");
  const fromDate = normalizeOptionalDate(input.fromDate, "fromDate");
  const toDate = normalizeOptionalDate(input.toDate, "toDate");
  const query = normalizeString(input.query).toLowerCase();

  if (status && !EVENT_STATUSES.includes(status)) {
    throw createProjectTaskError(
      "Invalid event status",
      400,
      { status, allowedValues: EVENT_STATUSES },
      "invalid_event_status"
    );
  }

  if (lifeArea && !LIFE_AREAS.includes(lifeArea)) {
    throw createProjectTaskError(
      "Invalid life area",
      400,
      { lifeArea, allowedValues: LIFE_AREAS },
      "invalid_life_area"
    );
  }

  const records = await loadCollection(calendarEventsCollection, 1000);
  const events = records
    .map(({ id, data }) => buildEventSummary(data, id))
    .filter((event) => !status || event.status === status)
    .filter((event) => !lifeArea || event.lifeArea === lifeArea)
    .filter((event) => !date || event.startDateTime.slice(0, 10) === date)
    .filter((event) => !fromDate || event.startDateTime.slice(0, 10) >= fromDate)
    .filter((event) => !toDate || event.startDateTime.slice(0, 10) <= toDate)
    .filter((event) => !query || buildEventSearchText(event).includes(query))
    .sort((a, b) => {
      const startA = a.startDateTime || "9999-12-31T23:59:59";
      const startB = b.startDateTime || "9999-12-31T23:59:59";
      return startA.localeCompare(startB);
    })
    .slice(0, limit);

  return {
    count: events.length,
    events
  };
}

async function updateCalendarEvent(input = {}, deps = {}) {
  const calendarEventsCollection = getEventCollection(deps);
  const eventId = validateDocId(input.eventId, "eventId");
  const docRef = calendarEventsCollection.doc(eventId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createProjectTaskError(
      "Calendar event not found",
      404,
      { eventId },
      "calendar_event_not_found"
    );
  }

  const existing = doc.data() || {};
  const changes = isPlainObject(input.changes) ? input.changes : input;
  const nowIso = getNowIso(deps);
  const nextEvent = {
    ...clone(existing),
    eventId
  };

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    const title = normalizeString(changes.title);
    if (!title) {
      throw createProjectTaskError("Event title cannot be blank", 400, {}, "blank_event_title");
    }
    nextEvent.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "lifeArea")) {
    nextEvent.lifeArea = normalizeEnum(changes.lifeArea, LIFE_AREAS, nextEvent.lifeArea || "home", "life_area");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    nextEvent.status = normalizeEnum(changes.status, EVENT_STATUSES, nextEvent.status || "scheduled", "event_status");
    if (nextEvent.status === "done" && !nextEvent.completedAt) {
      nextEvent.completedAt = nowIso;
    }
    if (nextEvent.status === "cancelled" && !nextEvent.cancelledAt) {
      nextEvent.cancelledAt = nowIso;
    }
    if (nextEvent.status !== "done") {
      nextEvent.completedAt = "";
    }
    if (nextEvent.status !== "cancelled") {
      nextEvent.cancelledAt = "";
    }
  }

  for (const field of ["startDateTime", "endDateTime"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextEvent[field] = normalizeOptionalDateTime(changes[field], field);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "allDay")) {
    nextEvent.allDay = changes.allDay === true;
  }

  for (const field of ["location", "notes", "recurrenceNotes"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextEvent[field] = normalizeString(changes[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "recurrence")) {
    nextEvent.recurrence = normalizeEnum(changes.recurrence, RECURRENCE_TYPES, nextEvent.recurrence || "none", "recurrence");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "requestedBy")) {
    nextEvent.requestedBy = normalizeString(changes.requestedBy) || "Dan";
  }

  nextEvent.updatedAt = nowIso;
  nextEvent.searchText = buildEventSearchText(nextEvent);
  await docRef.set(nextEvent);

  return {
    event: buildEventSummary(nextEvent, eventId)
  };
}

async function createRoutine(input = {}, deps = {}) {
  const routinesCollection = getRoutineCollection(deps);
  const title = normalizeString(input.title);

  if (!title) {
    throw createProjectTaskError("Missing routine title", 400, {}, "missing_routine_title");
  }

  assertCanCreateTaskRecord(input, deps, "routine");

  const nowIso = getNowIso(deps);
  const routineId = normalizeString(input.routineId)
    ? validateDocId(input.routineId, "routineId")
    : createId("routine", title, deps);
  const docRef = routinesCollection.doc(routineId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createProjectTaskError(
      "Routine already exists",
      409,
      { routineId },
      "routine_already_exists"
    );
  }

  const actor = getTaskActorFields(deps);
  const routine = {
    routineId,
    title,
    lifeArea: normalizeEnum(input.lifeArea, LIFE_AREAS, "home", "life_area"),
    status: normalizeEnum(input.status, ROUTINE_STATUSES, "active", "routine_status"),
    recurrence: normalizeEnum(input.recurrence, RECURRENCE_TYPES, "daily", "recurrence"),
    recurrenceNotes: normalizeString(input.recurrenceNotes),
    preferredTime: normalizeString(input.preferredTime),
    assignedTo: normalizeString(input.assignedTo) || "Dan",
    requestedBy: normalizeString(input.requestedBy) || "Dan",
    notes: normalizeString(input.notes),
    visibility: normalizeVisibility(
      input.visibility,
      getTaskAccess(deps).role === "manager" ? "staff" : "private"
    ),
    ownerSub: actor.actorSub,
    ownerName: actor.actorName,
    ownerEmail: actor.actorEmail,
    version: 1,
    createdBySub: actor.actorSub,
    createdByName: actor.actorName,
    updatedBySub: actor.actorSub,
    updatedByName: actor.actorName,
    createdAt: nowIso,
    updatedAt: nowIso,
    archivedAt: "",
    statusBeforeArchive: "",
    restoredAt: "",
    restoredBySub: "",
    restoredByName: ""
  };
  if (routine.status === "archived") routine.archivedAt = nowIso;

  routine.searchText = buildRoutineSearchText(routine);
  await docRef.create(routine);

  return {
    routine: buildRoutineSummary(routine, routineId)
  };
}

async function listRoutines(input = {}, deps = {}) {
  const routinesCollection = getRoutineCollection(deps);
  const limit = normalizeLimit(input.limit);
  const status = normalizeString(input.status);
  const lifeArea = normalizeString(input.lifeArea);
  const query = normalizeString(input.query).toLowerCase();

  if (status && !ROUTINE_STATUSES.includes(status)) {
    throw createProjectTaskError(
      "Invalid routine status",
      400,
      { status, allowedValues: ROUTINE_STATUSES },
      "invalid_routine_status"
    );
  }

  if (lifeArea && !LIFE_AREAS.includes(lifeArea)) {
    throw createProjectTaskError(
      "Invalid life area",
      400,
      { lifeArea, allowedValues: LIFE_AREAS },
      "invalid_life_area"
    );
  }

  const records = await loadCollection(routinesCollection, 1000);
  const routines = records
    .map(({ id, data }) => buildRoutineSummary(data, id))
    .filter((routine) => canReadTaskRecord(routine, deps))
    .filter((routine) => !status || routine.status === status)
    .filter((routine) => !lifeArea || routine.lifeArea === lifeArea)
    .filter((routine) => !query || buildRoutineSearchText(routine).includes(query))
    .sort((a, b) => {
      const timeA = a.preferredTime || "99:99";
      const timeB = b.preferredTime || "99:99";
      if (timeA !== timeB) {
        return timeA.localeCompare(timeB);
      }
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    })
    .slice(0, limit);

  return {
    count: routines.length,
    routines
  };
}

async function updateRoutine(input = {}, deps = {}) {
  const routinesCollection = getRoutineCollection(deps);
  const routineId = validateDocId(input.routineId, "routineId");
  const docRef = routinesCollection.doc(routineId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createProjectTaskError(
      "Routine not found",
      404,
      { routineId },
      "routine_not_found"
    );
  }

  const existing = doc.data() || {};
  const changes = isPlainObject(input.changes) ? input.changes : input;
  assertCanUpdateTaskRecord(existing, changes, deps, "routine");
  assertExpectedVersion(input, existing, deps, "routine", routineId);
  const nowIso = getNowIso(deps);
  const actor = getTaskActorFields(deps);
  const nextRoutine = {
    ...clone(existing),
    routineId
  };

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    const title = normalizeString(changes.title);
    if (!title) {
      throw createProjectTaskError("Routine title cannot be blank", 400, {}, "blank_routine_title");
    }
    nextRoutine.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "lifeArea")) {
    nextRoutine.lifeArea = normalizeEnum(changes.lifeArea, LIFE_AREAS, nextRoutine.lifeArea || "home", "life_area");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    nextRoutine.status = normalizeEnum(changes.status, ROUTINE_STATUSES, nextRoutine.status || "active", "routine_status");
    if (nextRoutine.status === "archived" && existing.status !== "archived") {
      nextRoutine.statusBeforeArchive = existing.status || "active";
      nextRoutine.archivedAt = nowIso;
    }
    if (existing.status === "archived" && nextRoutine.status !== "archived") {
      nextRoutine.statusBeforeArchive = "";
      nextRoutine.archivedAt = "";
      nextRoutine.restoredAt = nowIso;
      nextRoutine.restoredBySub = actor.actorSub;
      nextRoutine.restoredByName = actor.actorName;
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "recurrence")) {
    nextRoutine.recurrence = normalizeEnum(changes.recurrence, RECURRENCE_TYPES, nextRoutine.recurrence || "daily", "recurrence");
  }

  for (const field of ["recurrenceNotes", "preferredTime", "assignedTo", "requestedBy", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextRoutine[field] = normalizeString(changes[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "visibility")) {
    nextRoutine.visibility = normalizeVisibility(changes.visibility, nextRoutine.visibility || "private");
  }

  nextRoutine.assignedTo = nextRoutine.assignedTo || "Dan";
  nextRoutine.requestedBy = nextRoutine.requestedBy || "Dan";
  nextRoutine.version = Math.max(1, Number(existing.version) || 1) + 1;
  nextRoutine.updatedBySub = actor.actorSub;
  nextRoutine.updatedByName = actor.actorName;
  nextRoutine.updatedAt = nowIso;
  nextRoutine.searchText = buildRoutineSearchText(nextRoutine);
  await docRef.set(nextRoutine);

  return {
    routine: buildRoutineSummary(nextRoutine, routineId)
  };
}

async function restoreTaskRecord(input = {}, deps = {}) {
  const recordType = normalizeString(input.recordType).toLowerCase();
  const recordId = validateDocId(input.recordId, "recordId");
  const access = getTaskAccess(deps);
  if (!["system", "admin", "manager"].includes(access.role)) {
    throw createProjectTaskError(
      "A task manager or administrator is required to restore archived work",
      403,
      { role: access.role, recordType, recordId },
      "task_restore_denied"
    );
  }

  const definitions = {
    task: {
      collection: getTaskCollection(deps),
      archivedStatus: "dropped",
      defaultStatus: "next",
      previousField: "statusBeforeDrop",
      update: (status) => updateTask({
        taskId: recordId,
        changes: { status },
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {})
      }, deps)
    },
    project: {
      collection: getProjectCollection(deps),
      archivedStatus: "archived",
      defaultStatus: "active",
      previousField: "statusBeforeArchive",
      update: (status) => updateProject({
        projectId: recordId,
        changes: { status },
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {})
      }, deps)
    },
    routine: {
      collection: getRoutineCollection(deps),
      archivedStatus: "archived",
      defaultStatus: "active",
      previousField: "statusBeforeArchive",
      update: (status) => updateRoutine({
        routineId: recordId,
        changes: { status },
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {})
      }, deps)
    }
  };
  const definition = definitions[recordType];
  if (!definition) {
    throw createProjectTaskError(
      "recordType must be task, project, or routine",
      400,
      { recordType, allowedValues: Object.keys(definitions) },
      "invalid_task_restore_record_type"
    );
  }
  const doc = await definition.collection.doc(recordId).get();
  if (!doc.exists) {
    throw createProjectTaskError(
      `${recordType} not found`,
      404,
      { recordType, recordId },
      `${recordType}_not_found`
    );
  }
  const record = doc.data() || {};
  assertCanReadTaskRecord(record, deps, { recordType, recordId });
  if (
    access.role === "manager"
    && getRecordVisibility(record) !== "staff"
    && !isAccessSubject(record.ownerSub, access)
  ) {
    throw createProjectTaskError(
      "Managers may restore staff-visible records or private records they own",
      403,
      { recordType, recordId },
      "task_restore_denied"
    );
  }
  if (record.status !== definition.archivedStatus) {
    throw createProjectTaskError(
      `The ${recordType} is not archived or dropped`,
      409,
      { recordType, recordId, status: record.status },
      "task_record_not_archived"
    );
  }
  const allowedStatuses = recordType === "task"
    ? TASK_STATUSES.filter((status) => status !== "dropped")
    : recordType === "project"
      ? PROJECT_STATUSES.filter((status) => status !== "archived")
      : ROUTINE_STATUSES.filter((status) => status !== "archived");
  const previousStatus = normalizeString(record[definition.previousField]);
  const restoredStatus = allowedStatuses.includes(previousStatus) ? previousStatus : definition.defaultStatus;
  const result = await definition.update(restoredStatus);
  return { action: "restored", recordType, recordId, restoredStatus, ...result };
}

async function resolveStaffIdentity(input = {}, deps = {}) {
  const collection = getStaffProfileCollection(deps);
  const subject = normalizeString(input.subject);
  const profileId = getStaffProfileId(subject);
  const docRef = collection.doc(profileId);
  const doc = await docRef.get();
  const nowIso = getNowIso(deps);
  const bootstrapRole = STAFF_PROFILE_ROLES.includes(normalizeString(input.bootstrapRole).toLowerCase())
    ? normalizeString(input.bootstrapRole).toLowerCase()
    : "member";
  const existing = doc.exists ? doc.data() || {} : null;
  const shouldKeepBootstrapElevation = ["admin", "manager"].includes(bootstrapRole) &&
    !["admin", "manager"].includes(existing?.role);
  const profile = existing
    ? {
        ...clone(existing),
        profileId,
        subject,
        displayName: normalizeString(input.displayName) || existing.displayName || existing.email || "",
        email: normalizeString(input.email) || existing.email || "",
        role: shouldKeepBootstrapElevation ? bootstrapRole : existing.role || bootstrapRole,
        lastSeenAt: nowIso,
        updatedAt: shouldKeepBootstrapElevation ? nowIso : existing.updatedAt || existing.firstSeenAt || nowIso,
        version: Math.max(1, Number(existing.version) || 1) + (shouldKeepBootstrapElevation ? 1 : 0)
      }
    : {
        profileId,
        subject,
        displayName: normalizeString(input.displayName) || normalizeString(input.email),
        email: normalizeString(input.email),
        role: bootstrapRole,
        status: "active",
        managerSub: "",
        weeklyCapacityMinutes: 0,
        sharePrivateCapacity: false,
        version: 1,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        updatedAt: nowIso,
        updatedBySub: "",
        updatedByName: ""
      };
  await docRef.set(profile);
  const summary = buildStaffProfileSummary(profile, profileId);
  return {
    profile: summary,
    effectiveRole: summary.status === "disabled" ? "viewer" : summary.role,
    registered: true,
    created: !existing
  };
}

async function getMyStaffProfile(input = {}, deps = {}) {
  const access = getTaskAccess(deps);
  if (!access.subject) {
    throw createProjectTaskError("The signed-in staff identity is unavailable", 401, {}, "missing_staff_subject");
  }
  return resolveStaffIdentity({
    subject: access.subject,
    displayName: access.name,
    email: access.email,
    bootstrapRole: access.role
  }, deps);
}

async function listStaffProfiles(input = {}, deps = {}) {
  const access = getTaskAccess(deps);
  if (!["system", "admin", "manager"].includes(access.role)) {
    throw createProjectTaskError("A manager or administrator is required for the staff directory", 403, { role: access.role }, "staff_directory_denied");
  }
  const status = normalizeString(input.status).toLowerCase();
  if (status && !STAFF_PROFILE_STATUSES.includes(status)) {
    throw createProjectTaskError("Invalid staff status", 400, { status }, "invalid_staff_status");
  }
  const query = normalizeString(input.query).toLowerCase();
  const profiles = (await loadCollection(getStaffProfileCollection(deps), 500))
    .map(({ id, data }) => buildStaffProfileSummary(data, id))
    .filter((profile) => !status || profile.status === status)
    .filter((profile) => !query || [profile.displayName, profile.email, profile.role].join(" ").toLowerCase().includes(query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, normalizeLimit(input.limit));
  return { count: profiles.length, profiles };
}

async function updateMyStaffProfile(input = {}, deps = {}) {
  const access = getTaskAccess(deps);
  if (!access.subject || ["viewer"].includes(access.role)) {
    throw createProjectTaskError("A signed-in staff member is required", 403, { role: access.role }, "staff_profile_update_denied");
  }
  await getMyStaffProfile({}, deps);
  return updateStaffProfile({
    subject: access.subject,
    changes: input.changes || input,
    expectedVersion: input.expectedVersion,
    selfService: true
  }, deps);
}

async function updateStaffProfile(input = {}, deps = {}) {
  const access = getTaskAccess(deps);
  const subject = normalizeString(input.subject);
  const selfService = input.selfService === true && isAccessSubject(subject, access);
  if (!selfService && !["system", "admin"].includes(access.role)) {
    throw createProjectTaskError("A task administrator is required to manage staff roles", 403, { role: access.role }, "staff_role_update_denied");
  }
  const collection = getStaffProfileCollection(deps);
  const profileId = getStaffProfileId(subject);
  const docRef = collection.doc(profileId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createProjectTaskError("Staff member has not signed in yet", 404, { subject }, "staff_profile_not_found");
  }
  const existing = doc.data() || {};
  assertExpectedVersion(input, existing, deps, "staff profile", profileId);
  const changes = isPlainObject(input.changes) ? input.changes : input;
  const allowedFields = selfService
    ? ["displayName", "email", "weeklyCapacityMinutes", "sharePrivateCapacity"]
    : ["displayName", "email", "role", "status", "managerSub", "weeklyCapacityMinutes", "sharePrivateCapacity"];
  const unsupported = Object.keys(changes).filter((field) => !allowedFields.includes(field));
  if (unsupported.length > 0) {
    throw createProjectTaskError("Unsupported staff profile fields", 400, { unsupported, allowedFields }, "unsupported_staff_profile_fields");
  }
  const next = { ...clone(existing), profileId, subject };
  for (const field of ["displayName", "email", "managerSub"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) next[field] = normalizeString(changes[field]);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "role")) {
    next.role = normalizeEnum(changes.role, STAFF_PROFILE_ROLES, next.role || "member", "staff_role");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    next.status = normalizeEnum(changes.status, STAFF_PROFILE_STATUSES, next.status || "active", "staff_status");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "weeklyCapacityMinutes")) {
    next.weeklyCapacityMinutes = normalizeOptionalInteger(changes.weeklyCapacityMinutes, "weekly_capacity_minutes", { max: 10080 });
  }
  if (Object.prototype.hasOwnProperty.call(changes, "sharePrivateCapacity")) {
    next.sharePrivateCapacity = changes.sharePrivateCapacity === true;
  }
  const actor = getTaskActorFields(deps);
  next.version = Math.max(1, Number(existing.version) || 1) + 1;
  next.updatedAt = getNowIso(deps);
  next.updatedBySub = actor.actorSub;
  next.updatedByName = actor.actorName;
  await docRef.set(next);
  return { profile: buildStaffProfileSummary(next, profileId) };
}

async function listMyNotifications(input = {}, deps = {}) {
  const access = getTaskAccess(deps);
  if (!access.subject) {
    throw createProjectTaskError("The signed-in staff identity is unavailable", 401, {}, "missing_staff_subject");
  }
  const unreadOnly = input.unreadOnly !== false;
  const notifications = (await loadCollection(getNotificationCollection(deps), 1000))
    .map(({ id, data }) => buildNotificationSummary(data, id))
    .filter((item) => isAccessSubject(item.recipientSub, access))
    .filter((item) => !unreadOnly || !item.readAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, normalizeLimit(input.limit));
  return { count: notifications.length, unreadOnly, notifications };
}

async function markNotificationRead(input = {}, deps = {}) {
  const access = getTaskAccess(deps);
  const notificationId = validateDocId(input.notificationId, "notificationId");
  const docRef = getNotificationCollection(deps).doc(notificationId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createProjectTaskError("Notification not found", 404, { notificationId }, "task_notification_not_found");
  }
  const existing = doc.data() || {};
  if (!isAccessSubject(existing.recipientSub, access) && !["system", "admin"].includes(access.role)) {
    throw createProjectTaskError("This notification belongs to another staff member", 403, { notificationId }, "task_notification_denied");
  }
  const next = { ...clone(existing), notificationId, readAt: existing.readAt || getNowIso(deps) };
  await docRef.set(next);
  return { notification: buildNotificationSummary(next, notificationId) };
}

async function respondToAssignment(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const taskId = validateDocId(input.taskId, "taskId");
  const docRef = tasksCollection.doc(taskId);
  const doc = await docRef.get();
  if (!doc.exists) throw createProjectTaskError("Task not found", 404, { taskId }, "task_not_found");
  const existing = doc.data() || {};
  const access = getTaskAccess(deps);
  if (!access.subject || !isAccessSubject(existing.assignedToSub, access)) {
    throw createProjectTaskError("Only the assigned person may respond to this assignment", 403, { taskId }, "assignment_response_denied");
  }
  assertExpectedVersion(input, existing, deps, "task", taskId);
  const response = normalizeEnum(
    input.response,
    ["accepted", "needs_clarification", "declined"],
    "accepted",
    "assignment_response"
  );
  const nowIso = getNowIso(deps);
  const actor = getTaskActorFields(deps);
  const next = {
    ...clone(existing),
    taskId,
    assignmentStatus: response,
    assignmentRespondedAt: nowIso,
    assignmentRespondedBySub: access.subject,
    assignmentResponseNote: normalizeString(input.note),
    version: Math.max(1, Number(existing.version) || 1) + 1,
    updatedAt: nowIso,
    updatedBySub: actor.actorSub,
    updatedByName: actor.actorName
  };
  next.searchText = buildTaskSearchText(next);
  await docRef.set(next);
  let notification = null;
  if (existing.assignedBySub && !isAccessSubject(existing.assignedBySub, access)) {
    notification = await createTaskNotification({
      recipientSub: existing.assignedBySub,
      type: "assignment_response",
      taskId,
      title: `Assignment ${response.replace("_", " ")}`,
      message: `${actor.actorName || "The assignee"} ${response.replace("_", " ")}: ${existing.title}`,
      actor
    }, deps);
  }
  return { task: buildTaskSummary(next, taskId), notification };
}

async function buildDailyReview(input = {}, deps = {}) {
  const today = normalizeOptionalDate(input.today, "today") || getTodayDate(deps);
  const detailLevel = normalizeString(input.detailLevel) === "full" ? "full" : "compact";
  const access = getTaskAccess(deps);
  const [projectsResult, tasksResult, routinesResult, notificationsResult] = await Promise.all([
    listProjects({ status: "active", limit: 100 }, deps),
    listTasks({ limit: 100 }, deps),
    listRoutines({ status: "active", limit: 100 }, deps),
    access.subject ? listMyNotifications({ unreadOnly: true, limit: 25 }, deps) : Promise.resolve({ count: 0, notifications: [] })
  ]);
  const allOpenTasks = tasksResult.tasks.filter((task) => !["done", "dropped"].includes(task.status));
  const openTasks = access.subject
    ? allOpenTasks.filter((task) => isPersonalRecordForAccess(task, access))
    : allOpenTasks;
  const personalProjectIds = new Set(openTasks.map((task) => task.projectId).filter(Boolean));
  const personalProjects = access.subject
    ? projectsResult.projects.filter((project) =>
        personalProjectIds.has(project.projectId) || isPersonalRecordForAccess(project, access)
      )
    : projectsResult.projects;
  const personalRoutines = access.subject
    ? routinesResult.routines.filter((routine) => isPersonalRecordForAccess(routine, access))
    : routinesResult.routines;
  const nextTasks = openTasks.filter((task) => task.status === "next");
  const projectIdsWithNext = new Set(nextTasks.map((task) => task.projectId).filter(Boolean));

  const overdue = openTasks.filter((task) => task.dueDate && task.dueDate < today);
  const needsReview = overdue
    .map((task) => buildOverdueReviewItem(task, today))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));
  const dueToday = openTasks.filter((task) => task.dueDate === today);
  const scheduledToday = openTasks.filter((task) => task.workOnDate === today);
  const highPriorityNext = nextTasks.filter((task) => task.priority === "high");
  const waiting = openTasks.filter((task) => task.status === "waiting");
  const followUpDue = waiting.filter((task) => task.followUpDate && task.followUpDate <= today);
  const scheduled = openTasks.filter((task) => task.status === "scheduled");
  const sarahRequested = openTasks.filter((task) => task.requestedBy.toLowerCase() === "sarah");
  const pendingAssignments = access.subject
    ? openTasks.filter((task) =>
        isAccessSubject(task.assignedToSub, access) && task.assignmentStatus === "proposed"
      )
    : [];
  const assignmentQuestions = allOpenTasks.filter((task) =>
    task.assignmentStatus === "needs_clarification" &&
    (
      !access.subject
      || isAccessSubject(task.assignedToSub, access)
      || isAccessSubject(task.assignedBySub, access)
    )
  );
  const projectsWithoutNextAction = personalProjects.filter(
    (project) => !projectIdsWithNext.has(project.projectId)
  );
  const highPriorityProjects = personalProjects.filter((project) => project.priority === "high");
  const projectTargetsDue = personalProjects.filter(
    (project) => project.targetDate && project.targetDate <= today
  );
  const mapTask = detailLevel === "full" ? (task) => task : buildBriefTask;
  const mapRoutine = detailLevel === "full" ? (routine) => routine : buildBriefRoutine;
  const mapProject = detailLevel === "full" ? (project) => project : buildBriefProject;

  return {
    today,
    detailLevel,
    summary: {
      activeProjectCount: personalProjects.length,
      openTaskCount: openTasks.length,
      overdueCount: overdue.length,
      needsReviewCount: needsReview.length,
      dueTodayCount: dueToday.length,
      eventCount: 0,
      routineCount: personalRoutines.length,
      scheduledTodayCount: scheduledToday.length,
      highPriorityNextCount: highPriorityNext.length,
      waitingCount: waiting.length,
      followUpDueCount: followUpDue.length,
      highPriorityProjectCount: highPriorityProjects.length,
      projectTargetDueCount: projectTargetsDue.length,
      sarahRequestedOpenCount: sarahRequested.length,
      pendingAssignmentCount: pendingAssignments.length,
      assignmentQuestionCount: assignmentQuestions.length,
      unreadNotificationCount: notificationsResult.count,
      eventCompletedTaskCount: 0,
      projectsWithoutNextActionCount: projectsWithoutNextAction.length
    },
    eventCompletedTasks: [],
    eventsToday: [],
    routines: personalRoutines.map(mapRoutine),
    overdue: overdue.slice(0, 8).map(mapTask),
    needsReview: needsReview.slice(0, 12),
    dueToday: dueToday.slice(0, 8).map(mapTask),
    scheduledToday: scheduledToday.slice(0, 8).map(mapTask),
    highPriorityNext: highPriorityNext.slice(0, 8).map(mapTask),
    followUpDue: followUpDue.slice(0, 8).map(mapTask),
    highPriorityProjects: highPriorityProjects.slice(0, 8).map(mapProject),
    projectTargetsDue: projectTargetsDue.slice(0, 8).map(mapProject),
    waiting: waiting.slice(0, 8).map(mapTask),
    sarahRequested: sarahRequested.slice(0, 8).map(mapTask),
    pendingAssignments: pendingAssignments.slice(0, 8).map(mapTask),
    assignmentQuestions: assignmentQuestions.slice(0, 8).map(mapTask),
    notifications: notificationsResult.notifications,
    scheduled: scheduled.slice(0, 8).map(mapTask),
    projectsWithoutNextAction: projectsWithoutNextAction.slice(0, 8).map(mapProject)
  };
}

function getTaskPlannedMinutes(task = {}) {
  if (Number.isInteger(task.estimatedMinutes) && task.estimatedMinutes > 0) return task.estimatedMinutes;
  const start = normalizeString(task.workOnStartTime);
  const end = normalizeString(task.workOnEndTime);
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
}

function deriveProjectHealth(project = {}, projectTasks = [], today = "", staleBefore = "") {
  const reasons = [];
  const dependencies = Array.isArray(project.dependencies) ? project.dependencies : [];
  const milestones = Array.isArray(project.milestones) ? project.milestones : [];
  if (project.health === "blocked" || dependencies.some((item) => item.status === "blocked") || milestones.some((item) => item.status === "blocked")) {
    reasons.push("A project, milestone, or dependency is marked blocked.");
    return { health: "blocked", reasons };
  }
  if (project.targetDate && project.targetDate < today) reasons.push("The project target date has passed.");
  if (milestones.some((item) => item.status !== "done" && item.targetDate && item.targetDate < today)) {
    reasons.push("An unfinished milestone is past its target date.");
  }
  if (!projectTasks.some((task) => task.status === "next")) reasons.push("The project has no next action.");
  if (project.updatedAt && project.updatedAt.slice(0, 10) < staleBefore) reasons.push("The project has not been updated in 14 days.");
  if (reasons.length > 0) return { health: "at_risk", reasons };
  if (project.health === "on_track") return { health: "on_track", reasons: [] };
  return { health: project.health || "unknown", reasons: [] };
}

async function buildLeadershipBrief(input = {}, deps = {}) {
  const access = getTaskAccess(deps);
  if (!["system", "admin", "manager"].includes(access.role)) {
    throw createProjectTaskError(
      "A task manager or administrator is required for the leadership brief",
      403,
      { role: access.role },
      "task_leadership_brief_denied"
    );
  }
  const today = normalizeOptionalDate(input.today, "today") || getTodayDate(deps);
  const horizonDays = Math.min(Math.max(Number(input.horizonDays) || 7, 1), 31);
  const horizonDate = new Date(`${today}T12:00:00.000Z`);
  horizonDate.setUTCDate(horizonDate.getUTCDate() + horizonDays);
  const horizon = horizonDate.toISOString().slice(0, 10);
  const staleDate = new Date(`${today}T12:00:00.000Z`);
  staleDate.setUTCDate(staleDate.getUTCDate() - 14);
  const staleBefore = staleDate.toISOString().slice(0, 10);

  const [taskRecords, projectRecords, staffProfileRecords] = await Promise.all([
    loadCollection(getTaskCollection(deps), 2000),
    loadCollection(getProjectCollection(deps), 1000),
    loadCollection(getStaffProfileCollection(deps), 500)
  ]);
  const allTasks = taskRecords
    .map(({ id, data }) => buildTaskSummary(data, id))
    .filter((task) => !["done", "dropped"].includes(task.status));
  const tasks = taskRecords
    .filter(({ data }) => canReadTaskRecord(data, deps) && getRecordVisibility(data) === "staff")
    .map(({ id, data }) => buildTaskSummary(data, id))
    .filter((task) => !["done", "dropped"].includes(task.status));
  const projects = projectRecords
    .filter(({ data }) => canReadTaskRecord(data, deps) && getRecordVisibility(data) === "staff")
    .map(({ id, data }) => buildProjectSummary(data, id))
    .filter((project) => project.status === "active");
  const people = new Map();
  const staffProfiles = staffProfileRecords
    .map(({ id, data }) => buildStaffProfileSummary(data, id))
    .filter((profile) => profile.status === "active");
  for (const profile of staffProfiles) {
    people.set(profile.subject, {
      personKey: profile.subject,
      name: profile.displayName || profile.email || "Staff member",
      subject: profile.subject,
      email: profile.email,
      role: profile.role,
      openTaskCount: 0,
      plannedTodayCount: 0,
      plannedInHorizonCount: 0,
      overdueCount: 0,
      waitingCount: 0,
      highPriorityCount: 0,
      pendingAssignmentCount: 0,
      staffPlannedMinutesInHorizon: 0,
      privateOpenTaskCount: profile.sharePrivateCapacity ? 0 : null,
      privatePlannedMinutesInHorizon: profile.sharePrivateCapacity ? 0 : null,
      weeklyCapacityMinutes: profile.weeklyCapacityMinutes,
      capacityMinutesInHorizon: profile.weeklyCapacityMinutes
        ? Math.round(profile.weeklyCapacityMinutes * horizonDays / 7)
        : 0,
      tasksPlannedToday: []
    });
  }
  for (const task of tasks) {
    const personKey = task.assignedToSub || task.assignedToEmail || task.assignedTo || "unassigned";
    const person = people.get(personKey) || {
      personKey,
      name: task.assignedTo || task.assignedToEmail || "Unassigned",
      subject: task.assignedToSub || "",
      email: task.assignedToEmail || "",
      openTaskCount: 0,
      plannedTodayCount: 0,
      plannedInHorizonCount: 0,
      overdueCount: 0,
      waitingCount: 0,
      highPriorityCount: 0,
      pendingAssignmentCount: 0,
      staffPlannedMinutesInHorizon: 0,
      privateOpenTaskCount: null,
      privatePlannedMinutesInHorizon: null,
      weeklyCapacityMinutes: 0,
      capacityMinutesInHorizon: 0,
      tasksPlannedToday: []
    };
    person.openTaskCount += 1;
    if (task.workOnDate === today) {
      person.plannedTodayCount += 1;
      person.tasksPlannedToday.push(buildBriefTask(task));
    }
    if (task.workOnDate && task.workOnDate >= today && task.workOnDate <= horizon) {
      person.plannedInHorizonCount += 1;
      person.staffPlannedMinutesInHorizon += getTaskPlannedMinutes(task);
    }
    if (task.dueDate && task.dueDate < today) person.overdueCount += 1;
    if (task.status === "waiting") person.waitingCount += 1;
    if (task.priority === "high") person.highPriorityCount += 1;
    if (task.assignmentStatus === "proposed") person.pendingAssignmentCount += 1;
    people.set(personKey, person);
  }
  const profilesBySubject = new Map(staffProfiles.map((profile) => [profile.subject, profile]));
  for (const task of allTasks.filter((item) => item.visibility === "private")) {
    const personKey = task.assignedToSub || task.ownerSub;
    const profile = profilesBySubject.get(personKey);
    const person = people.get(personKey);
    if (!profile?.sharePrivateCapacity || !person) continue;
    person.privateOpenTaskCount += 1;
    if (task.workOnDate && task.workOnDate >= today && task.workOnDate <= horizon) {
      person.privatePlannedMinutesInHorizon += getTaskPlannedMinutes(task);
    }
  }
  const byPerson = [...people.values()]
    .map((person) => {
      const privateMinutes = Number.isInteger(person.privatePlannedMinutesInHorizon)
        ? person.privatePlannedMinutesInHorizon
        : 0;
      const plannedMinutesInHorizon = person.staffPlannedMinutesInHorizon + privateMinutes;
      return {
        ...person,
        plannedMinutesInHorizon,
        utilizationPercent: person.capacityMinutesInHorizon > 0
          ? Math.round(plannedMinutesInHorizon * 100 / person.capacityMinutesInHorizon)
          : null,
        outlookBusyMinutesInHorizon: null,
        tasksPlannedToday: person.tasksPlannedToday.slice(0, 8)
      };
    })
    .sort((a, b) => b.plannedTodayCount - a.plannedTodayCount || b.openTaskCount - a.openTaskCount || a.name.localeCompare(b.name));
  const unassigned = tasks.filter(
    (task) => !task.assignedToSub && !task.assignedToEmail && !normalizeString(task.assignedTo)
  );
  const plannedToday = tasks.filter((task) => task.workOnDate === today);
  const overdue = tasks.filter((task) => task.dueDate && task.dueDate < today);
  const needsReview = overdue
    .map((task) => buildOverdueReviewItem(task, today))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));
  const waiting = tasks.filter((task) => task.status === "waiting");
  const stale = tasks.filter((task) => task.updatedAt && task.updatedAt.slice(0, 10) < staleBefore);
  const projectHealth = projects.map((project) => {
    const health = deriveProjectHealth(
      project,
      tasks.filter((task) => task.projectId === project.projectId),
      today,
      staleBefore
    );
    return { ...buildBriefProject(project), derivedHealth: health.health, healthReasons: health.reasons };
  });
  const atRiskProjects = projectHealth.filter((project) => ["at_risk", "blocked"].includes(project.derivedHealth));

  return {
    today,
    horizon,
    summary: {
      staffActiveProjectCount: projects.length,
      staffOpenTaskCount: tasks.length,
      peopleWithOpenWorkCount: byPerson.filter((person) =>
        person.openTaskCount > 0 || (Number.isInteger(person.privateOpenTaskCount) && person.privateOpenTaskCount > 0)
      ).length,
      staffDirectoryCount: staffProfiles.length,
      plannedTodayCount: plannedToday.length,
      overdueCount: overdue.length,
      needsReviewCount: needsReview.length,
      waitingCount: waiting.length,
      unassignedCount: unassigned.length,
      staleCount: stale.length,
      pendingAssignmentCount: tasks.filter((task) => task.assignmentStatus === "proposed").length,
      atRiskProjectCount: atRiskProjects.length
    },
    byPerson,
    plannedToday: plannedToday.slice(0, 25).map(buildBriefTask),
    overdue: overdue.slice(0, 25).map(buildBriefTask),
    needsReview: needsReview.slice(0, 25),
    waiting: waiting.slice(0, 25).map(buildBriefTask),
    unassigned: unassigned.slice(0, 25).map(buildBriefTask),
    stale: stale.slice(0, 25).map(buildBriefTask),
    activeProjects: projectHealth.slice(0, 25),
    atRiskProjects: atRiskProjects.slice(0, 25)
  };
}

async function buildDailyBrief(input = {}, deps = {}) {
  const review = await buildDailyReview(
    {
      ...input,
      detailLevel: "compact"
    },
    deps
  );
  const lines = [
    `Daily brief for ${review.today}.`,
    `Summary: ${review.summary.openTaskCount} open tasks, ${review.summary.needsReviewCount} needing overdue review, ${review.summary.dueTodayCount} due today, ${review.summary.highPriorityNextCount} high-priority next actions, ${review.summary.highPriorityProjectCount} high-priority projects, ${review.summary.projectTargetDueCount} project targets due, ${review.summary.followUpDueCount} waiting follow-ups due, ${review.summary.sarahRequestedOpenCount} Sarah-requested open items, ${review.summary.eventCompletedTaskCount} event-bound tasks auto-completed.`,
    "",
    "Needs review:",
    ...review.needsReview.map((item) => `- ${item.title} (${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"} overdue; decide: complete, plan, revise deadline, delegate, or drop)`),
    "",
    "Work:",
    ...review.overdue.filter((item) => item.lifeArea === "work").map((item) => `- Overdue: ${item.title}`),
    ...review.dueToday.filter((item) => item.lifeArea === "work").map((item) => `- Due today: ${item.title}`),
    ...review.highPriorityNext.filter((item) => item.lifeArea === "work").map((item) => `- High priority: ${item.title}`),
    ...review.highPriorityProjects.filter((item) => item.lifeArea === "work").map((item) => `- High-priority project: ${item.name}${item.targetDate ? ` (target ${item.targetDate})` : ""}`),
    ...review.projectTargetsDue.filter((item) => item.lifeArea === "work").map((item) => `- Project target due: ${item.name}${item.targetDate ? ` (${item.targetDate})` : ""}`),
    ...review.followUpDue.filter((item) => item.lifeArea === "work").map((item) => `- Follow up: ${item.title}${item.waitingOn ? ` (waiting on ${item.waitingOn})` : ""}`),
    "",
    "Home:",
    ...review.eventsToday.filter((item) => item.lifeArea === "home").map((item) => `- Event: ${item.title}`),
    ...review.routines.filter((item) => item.lifeArea === "home").map((item) => `- Routine: ${item.title}`),
    ...review.dueToday.filter((item) => item.lifeArea === "home").map((item) => `- Due today: ${item.title}`),
    ...review.highPriorityProjects.filter((item) => item.lifeArea === "home").map((item) => `- High-priority project: ${item.name}${item.targetDate ? ` (target ${item.targetDate})` : ""}`),
    ...review.projectTargetsDue.filter((item) => item.lifeArea === "home").map((item) => `- Project target due: ${item.name}${item.targetDate ? ` (${item.targetDate})` : ""}`),
    "",
    "Church:",
    ...review.dueToday.filter((item) => item.lifeArea === "church").map((item) => `- Due today: ${item.title}`),
    ...review.highPriorityNext.filter((item) => item.lifeArea === "church").map((item) => `- High priority: ${item.title}`),
    ...review.highPriorityProjects.filter((item) => item.lifeArea === "church").map((item) => `- High-priority project: ${item.name}${item.targetDate ? ` (target ${item.targetDate})` : ""}`),
    ...review.projectTargetsDue.filter((item) => item.lifeArea === "church").map((item) => `- Project target due: ${item.name}${item.targetDate ? ` (${item.targetDate})` : ""}`),
    "",
    "Personal:",
    ...review.routines.filter((item) => item.lifeArea === "personal").map((item) => `- Routine: ${item.title}`),
    ...review.dueToday.filter((item) => item.lifeArea === "personal").map((item) => `- Due today: ${item.title}`),
    ...review.highPriorityProjects.filter((item) => item.lifeArea === "personal").map((item) => `- High-priority project: ${item.name}${item.targetDate ? ` (target ${item.targetDate})` : ""}`),
    ...review.projectTargetsDue.filter((item) => item.lifeArea === "personal").map((item) => `- Project target due: ${item.name}${item.targetDate ? ` (${item.targetDate})` : ""}`),
    "",
    "Sarah-requested:",
    ...review.sarahRequested.map((item) => `- ${item.title} (${item.lifeArea})`)
  ];

  return {
    today: review.today,
    briefText: lines
      .filter((line, index, allLines) => line || allLines[index - 1] !== "")
      .join("\n")
      .trim(),
    openTaskCount: review.summary.openTaskCount,
    overdueCount: review.summary.overdueCount,
    needsReviewCount: review.summary.needsReviewCount,
    dueTodayCount: review.summary.dueTodayCount,
    highPriorityNextCount: review.summary.highPriorityNextCount,
    highPriorityProjectCount: review.summary.highPriorityProjectCount,
    projectTargetDueCount: review.summary.projectTargetDueCount,
    sarahRequestedOpenCount: review.summary.sarahRequestedOpenCount
  };
}

module.exports = {
  ASSIGNMENT_STATUSES,
  BHE_DEPARTMENTS,
  EVENT_STATUSES,
  LIFE_AREAS,
  PROJECT_HEALTH_STATUSES,
  PROJECT_STATUSES,
  RECURRENCE_TYPES,
  ROUTINE_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  addTaskNote,
  buildDailyBrief,
  buildDailyReview,
  buildLeadershipBrief,
  completeTasksForPastEvents,
  createCalendarEvent,
  createProject,
  createProjectTaskError,
  createRoutine,
  createTask,
  getMyStaffProfile,
  getTask,
  getProject,
  listCalendarEvents,
  listProjects,
  listMyNotifications,
  listRoutines,
  listStaffProfiles,
  listTasks,
  listTaskNotes,
  markNotificationRead,
  respondToAssignment,
  resolveStaffIdentity,
  restoreTaskRecord,
  updateCalendarEvent,
  updateProject,
  updateMyStaffProfile,
  updateStaffProfile,
  updateRoutine,
  updateTask
};
