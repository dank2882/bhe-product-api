"use strict";

const { createHash } = require("node:crypto");

const STAFF_AUTHORIZATION_SCOPES = Object.freeze([
  "ministry.read",
  "ministry.write",
  "sermon.read",
  "sermon.write",
  "tasks.read",
  "tasks.comment",
  "tasks.write",
  "tasks.admin",
  "product.read",
  "product.write",
  "product.admin",
  "repository.read",
  "repository.write",
  "correspondence.read",
  "correspondence.write",
  "care.read.main",
  "care.read.spanish",
  "care.search",
  "prayer.read",
  "prayer.write"
]);

const STAFF_AUTHORIZATION_STATUSES = Object.freeze([
  "pending",
  "active",
  "disabled"
]);

const STAFF_TASK_ROLES = Object.freeze([
  "admin",
  "manager",
  "member",
  "collaborator",
  "viewer"
]);

const STAFF_AUTHORIZATION_ROLE_BUNDLES = Object.freeze({
  "FBC Staff Tools Administrator": {
    permissions: STAFF_AUTHORIZATION_SCOPES.filter((scope) => !scope.startsWith("prayer.")),
    taskRole: "admin"
  },
  "Dan Prayer Management Owner": {
    permissions: ["prayer.read", "prayer.write"]
  },
  "BHE Ministry Planner": {
    permissions: ["ministry.read", "ministry.write"]
  },
  "BHE Ministry Viewer": {
    permissions: ["ministry.read"]
  },
  "Sermon Workspace User": {
    permissions: ["sermon.read", "sermon.write"]
  },
  "BHE Task Administrator": {
    permissions: ["tasks.read", "tasks.comment", "tasks.write", "tasks.admin"],
    taskRole: "admin"
  },
  "BHE Task Manager": {
    permissions: ["tasks.read", "tasks.comment", "tasks.write"],
    taskRole: "manager"
  },
  "BHE Task Collaborator": {
    permissions: ["tasks.read", "tasks.comment"],
    taskRole: "collaborator"
  },
  "BHE Task Viewer": {
    permissions: ["tasks.read"],
    taskRole: "viewer"
  },
  "BHE Product Administrator": {
    permissions: ["product.read", "product.write", "product.admin"]
  },
  "BHE Product Editor": {
    permissions: ["product.read", "product.write"]
  },
  "BHE Product Viewer": {
    permissions: ["product.read"]
  },
  "BHE Knowledge Repository Editor": {
    permissions: ["repository.read", "repository.write"]
  },
  "BHE Knowledge Repository Viewer": {
    permissions: ["repository.read"]
  },
  "BHE Correspondence Editor": {
    permissions: ["correspondence.read", "correspondence.write"]
  },
  "BHE Correspondence Viewer": {
    permissions: ["correspondence.read"]
  },
  "BHE Pastoral Care Administrator": {
    permissions: ["care.read.main", "care.read.spanish", "care.search"]
  },
  "BHE Pastoral Care Leader": {
    permissions: ["care.read.main", "care.search"]
  },
  "BHE Pastoral Care Worker": {
    permissions: ["care.read.main", "care.search"]
  },
  "BHE Spanish Pastor": {
    permissions: ["care.read.spanish", "care.search"]
  },
  "BHE Spanish Care Worker": {
    permissions: ["care.read.spanish", "care.search"]
  }
});

const STAFF_AUTHORIZATION_ROLE_ALIASES = Object.freeze({
  "Ministry Planner": "BHE Ministry Planner",
  "Ministry Viewer": "BHE Ministry Viewer",
  "Task Administrator": "BHE Task Administrator",
  "Task Manager": "BHE Task Manager",
  "Task Collaborator": "BHE Task Collaborator",
  "Task Viewer": "BHE Task Viewer",
  "Product Administrator": "BHE Product Administrator",
  "Product Editor": "BHE Product Editor",
  "Product Viewer": "BHE Product Viewer",
  "Repository Editor": "BHE Knowledge Repository Editor",
  "Repository Viewer": "BHE Knowledge Repository Viewer",
  "Correspondence Editor": "BHE Correspondence Editor",
  "Correspondence Viewer": "BHE Correspondence Viewer",
  "Care Admin": "BHE Pastoral Care Administrator",
  "Pastoral Care Administrator": "BHE Pastoral Care Administrator",
  "Care Worker": "BHE Pastoral Care Worker",
  "Pastoral Care Worker": "BHE Pastoral Care Worker",
  "Spanish Pastor": "BHE Spanish Pastor"
});

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createAuthorizationError(message, statusCode, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function getAuthorizationCollection({ staffAuthorizationProfilesCollection } = {}) {
  if (
    !staffAuthorizationProfilesCollection
    || typeof staffAuthorizationProfilesCollection.doc !== "function"
  ) {
    throw createAuthorizationError(
      "Staff authorization profiles collection is not configured",
      500,
      "staff_authorization_collection_not_configured"
    );
  }
  return staffAuthorizationProfilesCollection;
}

function getStaffAuthorizationProfileId(subject) {
  const cleanSubject = normalizeString(subject);
  if (!cleanSubject) {
    throw createAuthorizationError(
      "Missing staff identity subject",
      400,
      "missing_staff_subject"
    );
  }
  return `staff-auth-${createHash("sha256").update(cleanSubject).digest("hex").slice(0, 32)}`;
}

function normalizeStatus(value, fallback = "pending") {
  const status = normalizeString(value).toLowerCase() || fallback;
  if (!STAFF_AUTHORIZATION_STATUSES.includes(status)) {
    throw createAuthorizationError(
      "Invalid staff authorization status",
      400,
      "invalid_staff_authorization_status",
      { status, allowed: STAFF_AUTHORIZATION_STATUSES }
    );
  }
  return status;
}

function normalizeTaskRole(value, fallback = "viewer") {
  const role = normalizeString(value).toLowerCase() || fallback;
  if (!STAFF_TASK_ROLES.includes(role)) {
    throw createAuthorizationError(
      "Invalid staff task role",
      400,
      "invalid_staff_task_role",
      { role, allowed: STAFF_TASK_ROLES }
    );
  }
  return role;
}

function normalizePermissions(value = []) {
  if (!Array.isArray(value)) {
    throw createAuthorizationError(
      "Staff authorization permissions must be an array",
      400,
      "invalid_staff_authorization_permissions"
    );
  }
  const permissions = [...new Set(value.map(normalizeString).filter(Boolean))];
  const unsupported = permissions.filter(
    (permission) => !STAFF_AUTHORIZATION_SCOPES.includes(permission)
  );
  if (unsupported.length) {
    throw createAuthorizationError(
      "Unsupported staff authorization permissions",
      400,
      "unsupported_staff_authorization_permissions",
      { unsupported, allowed: STAFF_AUTHORIZATION_SCOPES }
    );
  }
  return permissions.sort(
    (left, right) => STAFF_AUTHORIZATION_SCOPES.indexOf(left)
      - STAFF_AUTHORIZATION_SCOPES.indexOf(right)
  );
}

function normalizeRoleNames(value = []) {
  if (!Array.isArray(value)) {
    throw createAuthorizationError(
      "Staff authorization role names must be an array",
      400,
      "invalid_staff_authorization_role_names"
    );
  }
  return [...new Set(value.map(normalizeString).filter(Boolean))].sort();
}

function normalizeIdentitySubjects(value = [], primarySubject = "") {
  if (!Array.isArray(value)) {
    throw createAuthorizationError(
      "Staff authorization identity subjects must be an array",
      400,
      "invalid_staff_authorization_identity_subjects"
    );
  }
  const subjects = [...new Set([
    normalizeString(primarySubject),
    ...value.map(normalizeString)
  ].filter(Boolean))].sort();
  if (subjects.length > 20 || subjects.some((subject) => subject.length > 500)) {
    throw createAuthorizationError(
      "Staff authorization identity subjects exceed the supported limit",
      400,
      "staff_authorization_identity_subjects_limit",
      { maxSubjects: 20, maxSubjectLength: 500 }
    );
  }
  return subjects;
}

function buildAuthorizationFromRoleNames(value = []) {
  const requestedRoleNames = normalizeRoleNames(value);
  const canonicalRoleNames = requestedRoleNames.map(
    (roleName) => STAFF_AUTHORIZATION_ROLE_ALIASES[roleName] || roleName
  );
  const unsupported = canonicalRoleNames.filter(
    (roleName) => !STAFF_AUTHORIZATION_ROLE_BUNDLES[roleName]
  );
  if (unsupported.length) {
    throw createAuthorizationError(
      "Unsupported staff authorization roles",
      400,
      "unsupported_staff_authorization_roles",
      {
        unsupported,
        allowed: Object.keys(STAFF_AUTHORIZATION_ROLE_BUNDLES)
      }
    );
  }
  const taskRoleRank = {
    viewer: 0,
    collaborator: 1,
    member: 2,
    manager: 3,
    admin: 4
  };
  let taskRole = "viewer";
  const permissions = [];
  for (const roleName of canonicalRoleNames) {
    const bundle = STAFF_AUTHORIZATION_ROLE_BUNDLES[roleName];
    permissions.push(...bundle.permissions);
    if (
      bundle.taskRole
      && taskRoleRank[bundle.taskRole] > taskRoleRank[taskRole]
    ) {
      taskRole = bundle.taskRole;
    }
  }
  return {
    roleNames: [...new Set(canonicalRoleNames)].sort(),
    permissions: normalizePermissions(permissions),
    taskRole
  };
}

function buildStaffAuthorizationSummary(profile = {}, fallbackId = "") {
  const status = STAFF_AUTHORIZATION_STATUSES.includes(profile.status)
    ? profile.status
    : "pending";
  const permissions = normalizePermissions(
    Array.isArray(profile.permissions) ? profile.permissions : []
  );
  return {
    profileId: profile.profileId || fallbackId,
    subject: normalizeString(profile.subject),
    identitySubjects: normalizeIdentitySubjects(
      Array.isArray(profile.identitySubjects) ? profile.identitySubjects : [],
      profile.subject
    ),
    displayName: normalizeString(profile.displayName) || normalizeString(profile.email),
    email: normalizeString(profile.email).toLowerCase(),
    status,
    permissions,
    roleNames: normalizeRoleNames(
      Array.isArray(profile.roleNames) ? profile.roleNames : []
    ),
    taskRole: STAFF_TASK_ROLES.includes(profile.taskRole)
      ? profile.taskRole
      : "viewer",
    version: Number.isInteger(profile.version) && profile.version > 0
      ? profile.version
      : 1,
    firstSeenAt: normalizeString(profile.firstSeenAt),
    lastSeenAt: normalizeString(profile.lastSeenAt),
    updatedAt: normalizeString(profile.updatedAt),
    updatedBySub: normalizeString(profile.updatedBySub),
    updatedByName: normalizeString(profile.updatedByName)
  };
}

async function resolveStaffAuthorization(input = {}, deps = {}) {
  const subject = normalizeString(input.subject);
  const profileId = getStaffAuthorizationProfileId(subject);
  const docRef = getAuthorizationCollection(deps).doc(profileId);
  const snapshot = await docRef.get();
  const existing = snapshot.exists ? snapshot.data() || {} : null;
  const nowIso = getNowIso(deps);
  const displayName = normalizeString(input.displayName);
  const email = normalizeString(input.email).toLowerCase();

  const profile = existing
    ? {
        ...existing,
        profileId,
        subject,
        displayName: existing.displayName || displayName || existing.email || email || "",
        email: existing.email || email || "",
        lastSeenAt: nowIso,
        version: Number.isInteger(existing.version) && existing.version > 0
          ? existing.version
          : 1
      }
    : {
        profileId,
        subject,
        displayName: displayName || email,
        email,
        status: "pending",
        permissions: [],
        roleNames: [],
        taskRole: "viewer",
        version: 1,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        updatedAt: nowIso,
        updatedBySub: "",
        updatedByName: ""
      };

  await docRef.set(profile);
  const summary = buildStaffAuthorizationSummary(profile, profileId);
  const isActive = summary.status === "active";
  return {
    profile: summary,
    registered: true,
    created: !existing,
    authorized: isActive && summary.permissions.length > 0,
    effectiveScopes: isActive ? summary.permissions : [],
    effectiveTaskRole: isActive ? summary.taskRole : "viewer",
    effectiveIdentitySubjects: isActive ? summary.identitySubjects : []
  };
}

async function saveStaffAuthorizationProfile(input = {}, deps = {}) {
  const subject = normalizeString(input.subject);
  const profileId = getStaffAuthorizationProfileId(subject);
  const docRef = getAuthorizationCollection(deps).doc(profileId);
  const snapshot = await docRef.get();
  const existing = snapshot.exists ? snapshot.data() || {} : null;
  const changes = input.changes && typeof input.changes === "object"
    ? input.changes
    : {};
  const allowedFields = new Set([
    "displayName",
    "email",
    "status",
    "permissions",
    "roleNames",
    "taskRole",
    "identitySubjects"
  ]);
  const unsupported = Object.keys(changes).filter((field) => !allowedFields.has(field));
  if (unsupported.length) {
    throw createAuthorizationError(
      "Unsupported staff authorization profile fields",
      400,
      "unsupported_staff_authorization_fields",
      { unsupported, allowed: [...allowedFields] }
    );
  }

  const currentVersion = existing && Number.isInteger(existing.version)
    ? existing.version
    : 0;
  if (
    input.expectedVersion !== undefined
    && Number(input.expectedVersion) !== currentVersion
  ) {
    throw createAuthorizationError(
      "Staff authorization profile version conflict",
      409,
      "staff_authorization_version_conflict",
      { expectedVersion: Number(input.expectedVersion), currentVersion }
    );
  }

  const nowIso = getNowIso(deps);
  const next = {
    ...(existing || {}),
    profileId,
    subject,
    displayName: Object.prototype.hasOwnProperty.call(changes, "displayName")
      ? normalizeString(changes.displayName)
      : existing?.displayName || "",
    email: Object.prototype.hasOwnProperty.call(changes, "email")
      ? normalizeString(changes.email).toLowerCase()
      : existing?.email || "",
    status: Object.prototype.hasOwnProperty.call(changes, "status")
      ? normalizeStatus(changes.status)
      : normalizeStatus(existing?.status),
    permissions: Object.prototype.hasOwnProperty.call(changes, "permissions")
      ? normalizePermissions(changes.permissions)
      : normalizePermissions(existing?.permissions || []),
    roleNames: Object.prototype.hasOwnProperty.call(changes, "roleNames")
      ? normalizeRoleNames(changes.roleNames)
      : normalizeRoleNames(existing?.roleNames || []),
    taskRole: Object.prototype.hasOwnProperty.call(changes, "taskRole")
      ? normalizeTaskRole(changes.taskRole)
      : normalizeTaskRole(existing?.taskRole),
    identitySubjects: Object.prototype.hasOwnProperty.call(changes, "identitySubjects")
      ? normalizeIdentitySubjects(changes.identitySubjects, subject)
      : normalizeIdentitySubjects(existing?.identitySubjects || [], subject),
    version: currentVersion + 1,
    firstSeenAt: existing?.firstSeenAt || nowIso,
    lastSeenAt: existing?.lastSeenAt || "",
    updatedAt: nowIso,
    updatedBySub: normalizeString(input.updatedBySub),
    updatedByName: normalizeString(input.updatedByName)
  };

  await docRef.set(next);
  return { profile: buildStaffAuthorizationSummary(next, profileId) };
}

module.exports = {
  STAFF_AUTHORIZATION_ROLE_BUNDLES,
  STAFF_AUTHORIZATION_SCOPES,
  STAFF_AUTHORIZATION_STATUSES,
  STAFF_TASK_ROLES,
  buildAuthorizationFromRoleNames,
  buildStaffAuthorizationSummary,
  getStaffAuthorizationProfileId,
  normalizeIdentitySubjects,
  normalizePermissions,
  resolveStaffAuthorization,
  saveStaffAuthorizationProfile
};
