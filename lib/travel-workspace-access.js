"use strict";

const danAccess = require("./dan-private-access");
const { getStaffAuthorizationProfileId } = require("./staff-authorization-service");

// Only dependencies built from a fresh backend profile can carry a workspace.
// Request arguments, email, roles, and caller-provided subject aliases cannot.
const workspaces = new WeakMap();
const COLLECTIONS = Object.freeze({
  relationshipPeopleCollection: "people",
  relationshipOrganizationsCollection: "organizations",
  relationshipAffiliationsCollection: "affiliations",
  relationshipContactMethodsCollection: "contactMethods",
  relationshipInteractionsCollection: "interactions",
  relationshipPhotosCollection: "photos",
  outlookProjectionsCollection: "outlookProjections",
  travelTripsCollection: "trips",
  travelItineraryItemsCollection: "itineraryItems",
  travelPackingListsCollection: "packingLists",
  travelBriefingsCollection: "briefings",
  tripMemoriesCollection: "memories",
  danTravelOperationExecutionsCollection: "executions",
  danTravelAuditEventsCollection: "auditEvents"
});

function accessError(message = "This identity is not enabled for Travel Advisor") {
  return Object.assign(new Error(message), { statusCode: 403, code: "travel_access_denied" });
}

async function createTravelWorkspaceDependencies(deps, { subject, mode = "query" } = {}) {
  if (!subject || typeof subject !== "string") throw accessError();
  const profiles = deps.staffAuthorizationProfilesCollection;
  const snapshot = await profiles.doc(getStaffAuthorizationProfileId(subject)).get();
  // The canonical profile ID remains the workspace key. Alias support is explicit
  // in the profile, never taken from x-bhe-actor-subjects or request arguments.
  if (!snapshot.exists) throw accessError();
  const profile = snapshot.data();
  const subjects = [...new Set([profile.subject, ...(profile.identitySubjects || [])])];
  if (profile.status !== "active" || !subjects.includes(subject)
      || !profile.permissions?.includes("travel.read")
      || (mode === "command" && !profile.permissions.includes("travel.write"))) throw accessError();
  const workspaceId = snapshot.id;
  const root = deps.firestoreDb.collection("travelWorkspaces").doc(workspaceId);
  const scoped = { ...deps, relationshipPhotoBucket: null, trustedAutomation: false };
  for (const [key, name] of Object.entries(COLLECTIONS)) scoped[key] = root.collection(name);
  scoped.taskAccess = {
    subject, subjects, name: profile.displayName || profile.email || "Traveler",
    email: profile.email || "", role: profile.taskRole || "viewer",
    scopes: [...profile.permissions]
  };
  workspaces.set(scoped, { workspaceId, ownerSub: profile.subject, ...scoped.taskAccess });
  return scoped;
}

function getTravelWorkspace(deps) { return workspaces.get(deps); }

function requireTravelAccess(deps, options) {
  const workspace = workspaces.get(deps);
  return workspace ? { ...workspace, matchedSubject: workspace.workspaceId } : danAccess.requireDanPrivateAccess(deps, options);
}

function getTravelActorFields(deps) {
  const workspace = workspaces.get(deps);
  return workspace ? {
    actorSub: workspace.subject, actorName: workspace.name,
    actorEmail: workspace.email, actorRole: workspace.role
  } : danAccess.getDanActorFields(deps);
}

function getTravelOwnership(deps) {
  const workspace = workspaces.get(deps);
  return workspace
    ? { owner: "individual", ownerId: workspace.workspaceId, serves: [workspace.workspaceId], ownerSub: workspace.ownerSub, visibility: "private" }
    : { owner: "dan", serves: ["dan"], visibility: "private", ownerSub: getTravelActorFields(deps).actorSub };
}

module.exports = { COLLECTIONS, createTravelWorkspaceDependencies, getTravelWorkspace, requireTravelAccess, getTravelActorFields, getTravelOwnership };
