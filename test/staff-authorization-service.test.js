"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  STAFF_AUTHORIZATION_SCOPES,
  buildAuthorizationFromRoleNames,
  getStaffAuthorizationProfileId,
  resolveStaffAuthorization,
  saveStaffAuthorizationProfile
} = require("../lib/staff-authorization-service");

function createCollection() {
  const records = new Map();
  return {
    records,
    doc(id) {
      return {
        async get() {
          return {
            exists: records.has(id),
            data: () => records.get(id)
          };
        },
        async set(value) {
          records.set(id, structuredClone(value));
        }
      };
    }
  };
}

test("unknown staff identities register pending with no access", async () => {
  const collection = createCollection();
  const result = await resolveStaffAuthorization({
    subject: "waad|shawna",
    displayName: "Shawna Blue",
    email: "ShawnaB@FoundedOnFaith.com"
  }, {
    staffAuthorizationProfilesCollection: collection,
    now: () => new Date("2026-07-24T12:00:00.000Z")
  });

  assert.equal(result.created, true);
  assert.equal(result.authorized, false);
  assert.deepEqual(result.effectiveScopes, []);
  assert.equal(result.effectiveTaskRole, "viewer");
  assert.equal(result.profile.status, "pending");
  assert.equal(result.profile.email, "shawnab@foundedonfaith.com");
});

test("active profiles return only approved stored scopes and task role", async () => {
  const collection = createCollection();
  await saveStaffAuthorizationProfile({
    subject: "waad|shawna",
    changes: {
      displayName: "Shawna Blue",
      email: "shawnab@foundedonfaith.com",
      identitySubjects: ["google-oauth2|shawna", "waad|shawna"],
      status: "active",
      permissions: [
        "tasks.read",
        "tasks.comment",
        "tasks.write",
        "ministry.read",
        "ministry.write",
        "correspondence.read",
        "correspondence.write",
        "care.read.main",
        "care.search"
      ],
      roleNames: [
        "BHE Task Manager",
        "BHE Ministry Planner",
        "BHE Correspondence Editor",
        "BHE Pastoral Care Administrator"
      ],
      taskRole: "manager"
    },
    expectedVersion: 0,
    updatedBySub: "waad|dan",
    updatedByName: "Dan"
  }, {
    staffAuthorizationProfilesCollection: collection,
    now: () => new Date("2026-07-24T12:00:00.000Z")
  });

  const result = await resolveStaffAuthorization({
    subject: "waad|shawna",
    displayName: "Shawna Blue"
  }, {
    staffAuthorizationProfilesCollection: collection,
    now: () => new Date("2026-07-24T13:00:00.000Z")
  });

  assert.equal(result.authorized, true);
  assert.equal(result.effectiveTaskRole, "manager");
  assert.deepEqual(result.effectiveScopes, [
    "ministry.read",
    "ministry.write",
    "tasks.read",
    "tasks.comment",
    "tasks.write",
    "correspondence.read",
    "correspondence.write",
    "care.read.main",
    "care.search"
  ]);
  assert.equal(result.profile.lastSeenAt, "2026-07-24T13:00:00.000Z");
  assert.deepEqual(result.effectiveIdentitySubjects, [
    "google-oauth2|shawna",
    "waad|shawna"
  ]);
});

test("stored staff identity is authoritative over incomplete token claims", async () => {
  const collection = createCollection();
  await saveStaffAuthorizationProfile({
    subject: "waad|dan",
    changes: {
      displayName: "Dan Kirchner",
      email: "dank@foundedonfaith.com",
      identitySubjects: [
        "google-oauth2|106948814779912948467",
        "entra|8645ddd9-9cc8-4b1b-9d95-1eddf5df7492|1bfc55ff-1f97-4263-beb1-609e7a3c963e"
      ],
      status: "active",
      permissions: ["tasks.read"],
      taskRole: "admin"
    },
    expectedVersion: 0
  }, { staffAuthorizationProfilesCollection: collection });

  const result = await resolveStaffAuthorization({
    subject: "waad|dan",
    displayName: "Dan",
    email: ""
  }, { staffAuthorizationProfilesCollection: collection });

  assert.equal(result.profile.displayName, "Dan Kirchner");
  assert.equal(result.profile.email, "dank@foundedonfaith.com");
  assert.deepEqual(result.effectiveIdentitySubjects, [
    "entra|8645ddd9-9cc8-4b1b-9d95-1eddf5df7492|1bfc55ff-1f97-4263-beb1-609e7a3c963e",
    "google-oauth2|106948814779912948467",
    "waad|dan"
  ]);
});

test("disabled profiles fail closed even when permissions remain stored", async () => {
  const collection = createCollection();
  await saveStaffAuthorizationProfile({
    subject: "waad|disabled",
    changes: {
      status: "disabled",
      permissions: ["tasks.read", "tasks.write"],
      taskRole: "member"
    },
    expectedVersion: 0
  }, { staffAuthorizationProfilesCollection: collection });

  const result = await resolveStaffAuthorization(
    { subject: "waad|disabled" },
    { staffAuthorizationProfilesCollection: collection }
  );

  assert.equal(result.authorized, false);
  assert.deepEqual(result.effectiveScopes, []);
  assert.equal(result.effectiveTaskRole, "viewer");
});

test("profile updates reject unsupported permissions and stale versions", async () => {
  const collection = createCollection();
  await assert.rejects(
    () => saveStaffAuthorizationProfile({
      subject: "waad|staff",
      changes: { permissions: ["tasks.read", "everything.admin"] }
    }, { staffAuthorizationProfilesCollection: collection }),
    (error) => error.code === "unsupported_staff_authorization_permissions"
  );

  await saveStaffAuthorizationProfile({
    subject: "waad|staff",
    changes: { status: "active", permissions: ["tasks.read"] },
    expectedVersion: 0
  }, { staffAuthorizationProfilesCollection: collection });

  await assert.rejects(
    () => saveStaffAuthorizationProfile({
      subject: "waad|staff",
      changes: { permissions: ["tasks.read", "tasks.write"] },
      expectedVersion: 0
    }, { staffAuthorizationProfilesCollection: collection }),
    (error) => error.code === "staff_authorization_version_conflict"
  );
});

test("the backend allowlist exactly covers the unified OAuth resource", () => {
  assert.equal(STAFF_AUTHORIZATION_SCOPES.length, 18);
  assert.equal(
    getStaffAuthorizationProfileId("waad|dan"),
    getStaffAuthorizationProfileId("waad|dan")
  );
  assert.notEqual(
    getStaffAuthorizationProfileId("waad|dan"),
    getStaffAuthorizationProfileId("waad|shawna")
  );
});

test("approved display-role aliases produce the expected least-privilege profile", () => {
  assert.deepEqual(buildAuthorizationFromRoleNames([
    "Ministry Planner",
    "Task Manager",
    "Correspondence Editor",
    "Pastoral Care Administrator"
  ]), {
    roleNames: [
      "BHE Correspondence Editor",
      "BHE Ministry Planner",
      "BHE Pastoral Care Administrator",
      "BHE Task Manager"
    ],
    permissions: [
      "ministry.read",
      "ministry.write",
      "tasks.read",
      "tasks.comment",
      "tasks.write",
      "correspondence.read",
      "correspondence.write",
      "care.read.main",
      "care.read.spanish",
      "care.search"
    ],
    taskRole: "manager"
  });
});
