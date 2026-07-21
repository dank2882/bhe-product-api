"use strict";

const { randomUUID } = require("node:crypto");
const {
  assertCanAddTaskNote,
  assertCanCreateTaskRecord,
  assertCanReadTaskRecord,
  assertCanUpdateTaskRecord,
  canReadTaskRecord,
  getRecordVisibility,
  getTaskAccess,
  getTaskActorFields,
  isTaskAdmin,
  normalizeVisibility
} = require("./task-management-access");

const PROJECT_STATUSES = ["active", "paused", "done", "archived"];
const TASK_STATUSES = ["next", "waiting", "scheduled", "done", "dropped"];
const TASK_PRIORITIES = ["low", "medium", "high"];
const LIFE_AREAS = ["work", "home", "church", "personal"];
const EVENT_STATUSES = ["scheduled", "cancelled", "done"];
const ROUTINE_STATUSES = ["active", "paused", "archived"];
const RECURRENCE_TYPES = ["none", "daily", "weekly", "monthly", "custom"];
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
    project.outcome,
    project.status,
    project.priority,
    project.targetDate,
    project.requestedBy,
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
    task.status,
    task.priority,
    task.notes,
    task.waitingOn,
    task.followUpDate,
    task.requestedBy,
    task.assignedTo,
    task.context,
    task.completionRule,
    task.lastNotePreview,
    task.lastNoteBy,
    task.visibility
  ].filter(Boolean).join(" ").toLowerCase();
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
  if (!projectId || isTaskAdmin(deps) || !deps.projectsCollection) return null;
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
  assertCanReadTaskRecord(project, deps, { projectId });
  return project;
}

function buildProjectSummary(project = {}, fallbackId = "") {
  return {
    projectId: project.projectId || fallbackId,
    name: project.name || "",
    lifeArea: project.lifeArea || "work",
    outcome: project.outcome || "",
    status: project.status || "active",
    priority: project.priority || "medium",
    targetDate: project.targetDate || "",
    requestedBy: project.requestedBy || "Dan",
    notes: project.notes || "",
    visibility: getRecordVisibility(project),
    version: Number.isInteger(project.version) ? project.version : 1,
    createdBySub: project.createdBySub || "",
    createdByName: project.createdByName || "",
    updatedBySub: project.updatedBySub || "",
    updatedByName: project.updatedByName || "",
    createdAt: project.createdAt || "",
    updatedAt: project.updatedAt || "",
    completedAt: project.completedAt || ""
  };
}

function buildTaskSummary(task = {}, fallbackId = "") {
  return {
    taskId: task.taskId || fallbackId,
    title: task.title || "",
    projectId: task.projectId || "",
    eventId: task.eventId || "",
    lifeArea: task.lifeArea || "work",
    status: task.status || "next",
    priority: task.priority || "medium",
    dueDate: task.dueDate || "",
    scheduledDate: task.scheduledDate || "",
    scheduledTime: task.scheduledTime || "",
    timeWindow: task.timeWindow || "",
    waitingOn: task.waitingOn || "",
    followUpDate: task.followUpDate || "",
    requestedBy: task.requestedBy || "Dan",
    assignedTo: task.assignedTo || "Dan",
    context: task.context || "",
    autoCompleteAfterEvent: task.autoCompleteAfterEvent === true,
    completedByEventId: task.completedByEventId || "",
    notes: task.notes || "",
    visibility: getRecordVisibility(task),
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
    droppedAt: task.droppedAt || ""
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
    version: Number.isInteger(routine.version) ? routine.version : 1,
    createdBySub: routine.createdBySub || "",
    createdByName: routine.createdByName || "",
    updatedBySub: routine.updatedBySub || "",
    updatedByName: routine.updatedByName || "",
    createdAt: routine.createdAt || "",
    updatedAt: routine.updatedAt || "",
    archivedAt: routine.archivedAt || ""
  };
}

function buildBriefProject(project = {}) {
  return {
    projectId: project.projectId || "",
    name: project.name || "",
    lifeArea: project.lifeArea || "work",
    outcome: project.outcome || "",
    status: project.status || "active",
    priority: project.priority || "medium",
    targetDate: project.targetDate || "",
    visibility: getRecordVisibility(project)
  };
}

function buildBriefTask(task = {}) {
  return {
    taskId: task.taskId || "",
    title: task.title || "",
    projectId: task.projectId || "",
    eventId: task.eventId || "",
    lifeArea: task.lifeArea || "work",
    status: task.status || "next",
    priority: task.priority || "medium",
    dueDate: task.dueDate || "",
    scheduledDate: task.scheduledDate || "",
    scheduledTime: task.scheduledTime || "",
    timeWindow: task.timeWindow || "",
    followUpDate: task.followUpDate || "",
    requestedBy: task.requestedBy || "Dan",
    assignedTo: task.assignedTo || "Dan",
    context: task.context || "",
    autoCompleteAfterEvent: task.autoCompleteAfterEvent === true,
    noteCount: Number.isInteger(task.noteCount) ? task.noteCount : 0,
    lastNoteAt: task.lastNoteAt || "",
    lastNoteBy: task.lastNoteBy || "",
    lastNotePreview: task.lastNotePreview || "",
    visibility: getRecordVisibility(task)
  };
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
    outcome: normalizeString(input.outcome),
    status: normalizeEnum(input.status, PROJECT_STATUSES, "active", "project_status"),
    priority: normalizeEnum(input.priority, TASK_PRIORITIES, "medium", "project_priority"),
    targetDate: normalizeOptionalDate(input.targetDate, "targetDate"),
    requestedBy: normalizeString(input.requestedBy) || "Dan",
    notes: normalizeString(input.notes),
    visibility: normalizeVisibility(
      input.visibility,
      getTaskAccess(deps).role === "manager" ? "staff" : "private"
    ),
    version: 1,
    createdBySub: actor.actorSub,
    createdByName: actor.actorName,
    updatedBySub: actor.actorSub,
    updatedByName: actor.actorName,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: ""
  };

  if (project.status === "done") {
    project.completedAt = nowIso;
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

  if (Object.prototype.hasOwnProperty.call(changes, "notes")) {
    nextProject.notes = normalizeString(changes.notes);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "visibility")) {
    nextProject.visibility = normalizeVisibility(changes.visibility, nextProject.visibility || "private");
  }

  const actor = getTaskActorFields(deps);
  nextProject.version = Math.max(1, Number(existing.version) || 1) + 1;
  nextProject.updatedBySub = actor.actorSub;
  nextProject.updatedByName = actor.actorName;
  nextProject.updatedAt = nowIso;
  nextProject.searchText = buildProjectSearchText(nextProject);
  await docRef.set(nextProject);

  return {
    project: buildProjectSummary(nextProject, projectId)
  };
}

async function createTask(input = {}, deps = {}) {
  const tasksCollection = getTaskCollection(deps);
  const title = normalizeString(input.title);

  if (!title) {
    throw createProjectTaskError("Missing task title", 400, {}, "missing_task_title");
  }

  assertCanCreateTaskRecord(input, deps, "task");

  const nowIso = getNowIso(deps);
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
  if (!normalizeString(input.visibility) && projectId && deps.projectsCollection) {
    const projectDoc = accessibleProject
      ? { exists: true, data: () => accessibleProject }
      : await deps.projectsCollection.doc(projectId).get();
    if (projectDoc.exists) defaultVisibility = getRecordVisibility(projectDoc.data() || {});
  }
  const actor = getTaskActorFields(deps);
  const task = {
    taskId,
    title,
    projectId,
    eventId: normalizeString(input.eventId),
    lifeArea: normalizeEnum(input.lifeArea, LIFE_AREAS, "work", "life_area"),
    status,
    priority: normalizeEnum(input.priority, TASK_PRIORITIES, "medium", "task_priority"),
    dueDate: normalizeOptionalDate(input.dueDate, "dueDate"),
    scheduledDate: normalizeOptionalDate(input.scheduledDate, "scheduledDate"),
    scheduledTime: normalizeString(input.scheduledTime),
    timeWindow: normalizeString(input.timeWindow),
    waitingOn: normalizeString(input.waitingOn),
    followUpDate: normalizeOptionalDate(input.followUpDate, "followUpDate"),
    requestedBy: normalizeString(input.requestedBy) || "Dan",
    assignedTo: normalizeString(input.assignedTo) || "Dan",
    context: normalizeString(input.context),
    autoCompleteAfterEvent: input.autoCompleteAfterEvent === true,
    completedByEventId: "",
    notes: normalizeString(input.notes),
    visibility: normalizeVisibility(input.visibility, defaultVisibility),
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
    droppedAt: status === "dropped" ? nowIso : ""
  };

  task.searchText = buildTaskSearchText(task);
  await docRef.create(task);

  return {
    task: buildTaskSummary(task, taskId)
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
  const status = normalizeString(input.status);
  const priority = normalizeString(input.priority);
  const projectId = normalizeString(input.projectId);
  const eventId = normalizeString(input.eventId);
  const lifeArea = normalizeString(input.lifeArea);
  const requestedBy = normalizeString(input.requestedBy).toLowerCase();
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
    .filter((task) => !requestedBy || task.requestedBy.toLowerCase() === requestedBy)
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
    tasks
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
  if (Object.prototype.hasOwnProperty.call(changes, "projectId")) {
    await assertProjectReferenceAccessible(normalizeString(changes.projectId), deps);
  }
  const nowIso = getNowIso(deps);
  const nextTask = {
    ...clone(existing),
    taskId
  };

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    const title = normalizeString(changes.title);
    if (!title) {
      throw createProjectTaskError("Task title cannot be blank", 400, {}, "blank_task_title");
    }
    nextTask.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "projectId")) {
    nextTask.projectId = normalizeString(changes.projectId);
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
    if (nextTask.status !== "done") {
      nextTask.completedAt = "";
    }
    if (nextTask.status !== "dropped") {
      nextTask.droppedAt = "";
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

  if (Object.prototype.hasOwnProperty.call(changes, "scheduledDate")) {
    nextTask.scheduledDate = normalizeOptionalDate(changes.scheduledDate, "scheduledDate");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "scheduledTime")) {
    nextTask.scheduledTime = normalizeString(changes.scheduledTime);
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

  if (Object.prototype.hasOwnProperty.call(changes, "requestedBy")) {
    nextTask.requestedBy = normalizeString(changes.requestedBy) || "Dan";
  }

  if (Object.prototype.hasOwnProperty.call(changes, "assignedTo")) {
    nextTask.assignedTo = normalizeString(changes.assignedTo) || "Dan";
  }

  if (Object.prototype.hasOwnProperty.call(changes, "context")) {
    nextTask.context = normalizeString(changes.context);
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

  const actor = getTaskActorFields(deps);
  nextTask.version = Math.max(1, Number(existing.version) || 1) + 1;
  nextTask.updatedBySub = actor.actorSub;
  nextTask.updatedByName = actor.actorName;
  nextTask.updatedAt = nowIso;
  nextTask.searchText = buildTaskSearchText(nextTask);
  await docRef.set(nextTask);

  return {
    task: buildTaskSummary(nextTask, taskId)
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
    version: 1,
    createdBySub: actor.actorSub,
    createdByName: actor.actorName,
    updatedBySub: actor.actorSub,
    updatedByName: actor.actorName,
    createdAt: nowIso,
    updatedAt: nowIso,
    archivedAt: ""
  };

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
    nextRoutine.archivedAt = nextRoutine.status === "archived" ? (nextRoutine.archivedAt || nowIso) : "";
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
  const actor = getTaskActorFields(deps);
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

async function buildDailyReview(input = {}, deps = {}) {
  const today = normalizeOptionalDate(input.today, "today") || getTodayDate(deps);
  const detailLevel = normalizeString(input.detailLevel) === "full" ? "full" : "compact";
  const projectsResult = await listProjects({ status: "active", limit: 100 }, deps);
  const tasksResult = await listTasks({ limit: 100 }, deps);
  const routinesResult = await listRoutines({ status: "active", limit: 100 }, deps);
  const openTasks = tasksResult.tasks.filter((task) => !["done", "dropped"].includes(task.status));
  const nextTasks = openTasks.filter((task) => task.status === "next");
  const projectIdsWithNext = new Set(nextTasks.map((task) => task.projectId).filter(Boolean));

  const overdue = openTasks.filter((task) => task.dueDate && task.dueDate < today);
  const dueToday = openTasks.filter((task) => task.dueDate === today);
  const scheduledToday = openTasks.filter((task) => task.scheduledDate === today);
  const highPriorityNext = nextTasks.filter((task) => task.priority === "high");
  const waiting = openTasks.filter((task) => task.status === "waiting");
  const followUpDue = waiting.filter((task) => task.followUpDate && task.followUpDate <= today);
  const scheduled = openTasks.filter((task) => task.status === "scheduled");
  const sarahRequested = openTasks.filter((task) => task.requestedBy.toLowerCase() === "sarah");
  const projectsWithoutNextAction = projectsResult.projects.filter(
    (project) => !projectIdsWithNext.has(project.projectId)
  );
  const highPriorityProjects = projectsResult.projects.filter((project) => project.priority === "high");
  const projectTargetsDue = projectsResult.projects.filter(
    (project) => project.targetDate && project.targetDate <= today
  );
  const mapTask = detailLevel === "full" ? (task) => task : buildBriefTask;
  const mapRoutine = detailLevel === "full" ? (routine) => routine : buildBriefRoutine;
  const mapProject = detailLevel === "full" ? (project) => project : buildBriefProject;

  return {
    today,
    detailLevel,
    summary: {
      activeProjectCount: projectsResult.projects.length,
      openTaskCount: openTasks.length,
      overdueCount: overdue.length,
      dueTodayCount: dueToday.length,
      eventCount: 0,
      routineCount: routinesResult.count,
      scheduledTodayCount: scheduledToday.length,
      highPriorityNextCount: highPriorityNext.length,
      waitingCount: waiting.length,
      followUpDueCount: followUpDue.length,
      highPriorityProjectCount: highPriorityProjects.length,
      projectTargetDueCount: projectTargetsDue.length,
      sarahRequestedOpenCount: sarahRequested.length,
      eventCompletedTaskCount: 0,
      projectsWithoutNextActionCount: projectsWithoutNextAction.length
    },
    eventCompletedTasks: [],
    eventsToday: [],
    routines: routinesResult.routines.map(mapRoutine),
    overdue: overdue.slice(0, 8).map(mapTask),
    dueToday: dueToday.slice(0, 8).map(mapTask),
    scheduledToday: scheduledToday.slice(0, 8).map(mapTask),
    highPriorityNext: highPriorityNext.slice(0, 8).map(mapTask),
    followUpDue: followUpDue.slice(0, 8).map(mapTask),
    highPriorityProjects: highPriorityProjects.slice(0, 8).map(mapProject),
    projectTargetsDue: projectTargetsDue.slice(0, 8).map(mapProject),
    waiting: waiting.slice(0, 8).map(mapTask),
    sarahRequested: sarahRequested.slice(0, 8).map(mapTask),
    scheduled: scheduled.slice(0, 8).map(mapTask),
    projectsWithoutNextAction: projectsWithoutNextAction.slice(0, 8).map(mapProject)
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
    `Summary: ${review.summary.openTaskCount} open tasks, ${review.summary.overdueCount} overdue, ${review.summary.dueTodayCount} due today, ${review.summary.highPriorityNextCount} high-priority next actions, ${review.summary.highPriorityProjectCount} high-priority projects, ${review.summary.projectTargetDueCount} project targets due, ${review.summary.followUpDueCount} waiting follow-ups due, ${review.summary.sarahRequestedOpenCount} Sarah-requested open items, ${review.summary.eventCompletedTaskCount} event-bound tasks auto-completed.`,
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
    dueTodayCount: review.summary.dueTodayCount,
    highPriorityNextCount: review.summary.highPriorityNextCount,
    highPriorityProjectCount: review.summary.highPriorityProjectCount,
    projectTargetDueCount: review.summary.projectTargetDueCount,
    sarahRequestedOpenCount: review.summary.sarahRequestedOpenCount
  };
}

module.exports = {
  EVENT_STATUSES,
  LIFE_AREAS,
  PROJECT_STATUSES,
  RECURRENCE_TYPES,
  ROUTINE_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  addTaskNote,
  buildDailyBrief,
  buildDailyReview,
  completeTasksForPastEvents,
  createCalendarEvent,
  createProject,
  createProjectTaskError,
  createRoutine,
  createTask,
  getTask,
  getProject,
  listCalendarEvents,
  listProjects,
  listRoutines,
  listTasks,
  listTaskNotes,
  updateCalendarEvent,
  updateProject,
  updateRoutine,
  updateTask
};
