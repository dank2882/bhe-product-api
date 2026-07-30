"use strict";

const TASK_ACCESS_ROLES = Object.freeze(["system", "admin", "manager", "member", "collaborator", "viewer"]);
const TASK_VISIBILITIES = Object.freeze(["private", "staff"]);
const SHARED_LIFE_AREAS = new Set(["work", "church"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createAccessError(message, details = {}) {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = "task_access_denied";
  error.details = details;
  return error;
}

function normalizeTaskAccess(value = {}) {
  const rawRole = normalizeString(value.role).toLowerCase();
  const role = TASK_ACCESS_ROLES.includes(rawRole) ? rawRole : "system";
  const subject = normalizeString(value.subject);
  const subjects = [...new Set([
    subject,
    ...(Array.isArray(value.subjects) ? value.subjects.map(normalizeString) : [])
  ].filter(Boolean))];
  return {
    role,
    subject,
    subjects,
    name: normalizeString(value.name),
    email: normalizeString(value.email),
    scopes: Array.isArray(value.scopes)
      ? value.scopes.map(normalizeString).filter(Boolean)
      : []
  };
}

function isAccessSubject(subject, access = {}) {
  const cleanSubject = normalizeString(subject);
  return Boolean(cleanSubject) && normalizeTaskAccess(access).subjects.includes(cleanSubject);
}

function getTaskAccess(deps = {}) {
  return normalizeTaskAccess(deps.taskAccess || {});
}

function isTaskAdmin(deps = {}) {
  return ["system", "admin"].includes(getTaskAccess(deps).role);
}

function isRecordOwner(record = {}, deps = {}) {
  const access = getTaskAccess(deps);
  if (!access.subjects.length) return false;
  return [record.ownerSub, record.createdBySub]
    .map(normalizeString)
    .filter(Boolean)
    .some((subject) => access.subjects.includes(subject));
}

function isRecordAssignee(record = {}, deps = {}) {
  const access = getTaskAccess(deps);
  return isAccessSubject(record.assignedToSub, access);
}

function normalizeVisibility(value, fallback = "private") {
  const visibility = normalizeString(value).toLowerCase();
  if (!visibility) return fallback;
  if (!TASK_VISIBILITIES.includes(visibility)) {
    const error = new Error("Invalid task visibility");
    error.statusCode = 400;
    error.code = "invalid_task_visibility";
    error.details = { visibility, allowedValues: TASK_VISIBILITIES };
    throw error;
  }
  return visibility;
}

function getRecordVisibility(record = {}) {
  return normalizeVisibility(record.visibility, "private");
}

function canReadTaskRecord(record = {}, deps = {}) {
  return isTaskAdmin(deps) || isRecordOwner(record, deps) || getRecordVisibility(record) === "staff";
}

function assertCanReadTaskRecord(record = {}, deps = {}, details = {}) {
  if (canReadTaskRecord(record, deps)) return;
  const access = getTaskAccess(deps);
  throw createAccessError("This task record is not shared with the current user", {
    ...details,
    role: access.role
  });
}

function assertCanCreateTaskRecord(input = {}, deps = {}, kind = "task") {
  const access = getTaskAccess(deps);
  if (["system", "admin"].includes(access.role)) return;
  if (!["manager", "member"].includes(access.role)) {
    throw createAccessError(`The ${access.role} role cannot create ${kind} records`, {
      role: access.role,
      kind
    });
  }
  const visibility = normalizeVisibility(input.visibility, access.role === "manager" ? "staff" : "private");
  const lifeArea = normalizeString(input.lifeArea) || "work";
  if (visibility === "staff" && !SHARED_LIFE_AREAS.has(lifeArea)) {
    throw createAccessError("Staff-visible records must belong to work or church", {
      role: access.role,
      kind,
      visibility,
      lifeArea
    });
  }
}

function assertCanUpdateTaskRecord(existing = {}, changes = {}, deps = {}, kind = "task") {
  const access = getTaskAccess(deps);
  if (["system", "admin"].includes(access.role)) return;
  if (!["manager", "member"].includes(access.role)) {
    throw createAccessError(`The ${access.role} role cannot update ${kind} records`, {
      role: access.role,
      kind
    });
  }
  assertCanReadTaskRecord(existing, deps, { kind });
  if (access.role === "member" && !isRecordOwner(existing, deps) && !isRecordAssignee(existing, deps)) {
    throw createAccessError("Members may update only records they own or tasks assigned to them", {
      role: access.role,
      kind
    });
  }
  if (Object.prototype.hasOwnProperty.call(changes, "visibility")) {
    throw createAccessError("Only a task administrator may change record visibility", {
      role: access.role,
      kind
    });
  }
  const nextLifeArea = normalizeString(changes.lifeArea) || normalizeString(existing.lifeArea) || "work";
  if (!SHARED_LIFE_AREAS.has(nextLifeArea)) {
    throw createAccessError("Managers may update only work or church records", {
      role: access.role,
      kind,
      lifeArea: nextLifeArea
    });
  }
  if (changes.status === "dropped" || changes.status === "archived") {
    const isSupportedSoftRemoval =
      (kind === "task" && changes.status === "dropped") ||
      (kind === "project" && changes.status === "archived");
    const managerMaySoftRemoveStaffRecord =
      access.role === "manager" &&
      getRecordVisibility(existing) === "staff" &&
      isSupportedSoftRemoval;
    const memberMaySoftRemoveOwnStaffRecord =
      access.role === "member" &&
      getRecordVisibility(existing) === "staff" &&
      isRecordOwner(existing, deps) &&
      isSupportedSoftRemoval;
    if (!managerMaySoftRemoveStaffRecord && !memberMaySoftRemoveOwnStaffRecord) {
      throw createAccessError(
        "Managers may soft-remove staff-visible tasks and projects; members may soft-remove only staff-visible records they created",
        {
          role: access.role,
          kind,
          status: changes.status,
          visibility: getRecordVisibility(existing),
          isOwner: isRecordOwner(existing, deps)
        }
      );
    }
  }
}

function assertCanAddTaskNote(task = {}, deps = {}) {
  const access = getTaskAccess(deps);
  if (["system", "admin"].includes(access.role)) return;
  if (!["manager", "member", "collaborator"].includes(access.role)) {
    throw createAccessError(`The ${access.role} role cannot add task notes`, {
      role: access.role
    });
  }
  assertCanReadTaskRecord(task, deps, { taskId: task.taskId || "" });
}

function getTaskActorFields(deps = {}) {
  const access = getTaskAccess(deps);
  return {
    actorSub: access.subject,
    actorName: access.name || access.email,
    actorEmail: access.email,
    actorRole: access.role
  };
}

module.exports = {
  TASK_ACCESS_ROLES,
  TASK_VISIBILITIES,
  assertCanAddTaskNote,
  assertCanCreateTaskRecord,
  assertCanReadTaskRecord,
  assertCanUpdateTaskRecord,
  canReadTaskRecord,
  getRecordVisibility,
  getTaskAccess,
  getTaskActorFields,
  isTaskAdmin,
  isAccessSubject,
  isRecordAssignee,
  isRecordOwner,
  normalizeTaskAccess,
  normalizeVisibility
};
