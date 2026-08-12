"use strict";

const { getTaskAccess } = require("./task-management-access");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOwnerSubjects(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(values.map(normalizeString).filter(Boolean))];
}

function createDanAccessError(message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = code === "dan_private_owner_not_configured" ? 503 : 403;
  error.code = code;
  error.details = details;
  return error;
}

function requireDanPrivateAccess(deps = {}, { allowAutomation = false } = {}) {
  const access = getTaskAccess(deps);
  const ownerSubjects = normalizeOwnerSubjects(deps.danOwnerSubjects);

  if (allowAutomation && deps.trustedAutomation === true && access.role === "system") {
    return access;
  }
  if (ownerSubjects.length === 0) {
    throw createDanAccessError(
      "Dan private owner subjects are not configured",
      "dan_private_owner_not_configured"
    );
  }
  const matchedSubject = access.subjects.find((subject) => ownerSubjects.includes(subject));
  if (!matchedSubject) {
    throw createDanAccessError(
      "This private Dan record is not available to the current identity",
      "dan_private_access_denied",
      { role: access.role }
    );
  }
  return { ...access, matchedSubject };
}

function getDanActorFields(deps = {}) {
  const access = requireDanPrivateAccess(deps);
  return {
    actorSub: access.matchedSubject,
    actorName: access.name || access.email || "Dan",
    actorEmail: access.email,
    actorRole: access.role
  };
}

module.exports = {
  getDanActorFields,
  normalizeOwnerSubjects,
  requireDanPrivateAccess
};
