"use strict";

const { createHash } = require("node:crypto");
const { stableStringify } = require("./workspace-operation-execution");

const PROFILE_TYPES = ["individual", "group", "duo", "small_group", "family", "ensemble", "choir", "school_group"];
const TIER_AVAILABILITY = Object.freeze({
  1: { label: "Wednesday night only", anyService: false, serviceTypes: ["wednesday_night"] },
  2: { label: "Sunday night + Wednesday night", anyService: false, serviceTypes: ["sunday_night", "wednesday_night"] },
  3: { label: "Any service", anyService: true, serviceTypes: [] }
});
const WRITES = new Set(["saveSpecialMusicProfile", "archiveSpecialMusicProfile"]);
function fail(message, code = "invalid_special_music_profile", statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}
function string(value, field, max = 300, empty = false) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max) fail(`Invalid ${field}`);
  return value;
}
function id(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,199}$/.test(value)) fail("Invalid specialMusicProfileId");
  return value;
}
function serviceType(value) {
  const token = string(value, "serviceType").trim().toLowerCase().replace(/[ -]+/g, "_");
  return ({ sunday_am: "sunday_morning", sunday_evening: "sunday_night", sunday_pm: "sunday_night", wednesday_evening: "wednesday_night", midweek: "wednesday_night" })[token] || token;
}
function validateProfile(input, previous = {}) {
  const allowed = new Set(["specialMusicProfileId", "expectedVersion", "displayName", "groupName", "profileType", "tier", "members", "accompanists", "aliases", "notes", "status"]);
  for (const field of Object.keys(input)) if (!allowed.has(field)) fail(`Unsupported field: ${field}`);
  const record = { groupName: "", members: [], accompanists: [], aliases: [], notes: "", status: "active", ...previous, ...input };
  delete record.expectedVersion;
  string(record.displayName, "displayName");
  string(record.groupName, "groupName", 300, true);
  if (!PROFILE_TYPES.includes(record.profileType)) fail("Invalid profileType");
  if (!Number.isInteger(record.tier) || !TIER_AVAILABILITY[record.tier]) fail("tier must be 1, 2, or 3");
  if (!["active", "inactive"].includes(record.status)) fail("status must be active or inactive; use archiveSpecialMusicProfile to archive");
  if (!Array.isArray(record.members) || record.members.length > 200) fail("members must contain at most 200 named members");
  record.members = record.members.map((member) => {
    const value = typeof member === "string" ? { displayName: member } : member;
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid member");
    if (Object.keys(value).some((key) => !["displayName", "personId", "breezePersonId"].includes(key))) fail("Unsupported member field");
    string(value.displayName, "member.displayName");
    for (const field of ["personId", "breezePersonId"]) if (value[field] !== undefined) string(value[field], field);
    return { ...value };
  });
  if (record.profileType === "individual" && record.members.length !== 1) fail("An individual must have one member");
  if (record.profileType === "individual" && record.groupName !== "") fail("groupName is only available to group profiles");
  if (!Array.isArray(record.accompanists) || record.accompanists.length > 50) fail("accompanists must be an array of at most 50 pianist references");
  const pianistIds = new Set();
  record.accompanists = record.accompanists.map((pianist) => {
    if (!pianist || typeof pianist !== "object" || Array.isArray(pianist)
      || Object.keys(pianist).some((field) => !["pianistId", "displayName"].includes(field))) fail("Invalid accompanist reference");
    string(pianist.pianistId, "pianistId", 200);
    if (pianist.pianistId.includes("/") || [".", ".."].includes(pianist.pianistId)) fail("Invalid pianistId");
    if (pianistIds.has(pianist.pianistId)) fail("Duplicate accompanist pianistId");
    pianistIds.add(pianist.pianistId);
    return { pianistId: pianist.pianistId };
  });
  if (!Array.isArray(record.aliases) || record.aliases.length > 100) fail("Invalid aliases");
  record.aliases.forEach((alias) => string(alias, "alias"));
  string(record.notes, "notes", 10000, true);
  record.tierAvailability = structuredClone(TIER_AVAILABILITY[record.tier]);
  return record;
}
async function getSpecialMusicProfile(input, deps) {
  const doc = await deps.specialMusicProfilesCollection.doc(id(input.specialMusicProfileId)).get();
  if (!doc.exists) fail("Special music profile not found", "special_music_profile_not_found", 404);
  return { profile: { ...doc.data(), specialMusicProfileId: doc.id || input.specialMusicProfileId } };
}
async function listSpecialMusicProfiles(input = {}, deps) {
  if (input.format !== undefined && !["records", "table"].includes(input.format)) fail("format must be records or table");
  const { tier, profileType, status = "active", afterId, limit = 100 } = input;
  if (tier !== undefined && (!Number.isInteger(tier) || !TIER_AVAILABILITY[tier])) fail("Invalid tier");
  if (profileType !== undefined && !PROFILE_TYPES.includes(profileType)) fail("Invalid profileType");
  if (!["active", "inactive", "archived", "all"].includes(status)) fail("Invalid status");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail("limit must be 1–200");
  const eligible = input.serviceType === undefined ? null : serviceType(input.serviceType);
  let query = deps.specialMusicProfilesCollection.orderBy("__name__");
  if (afterId !== undefined) query = query.startAfter(id(afterId));
  // Page through storage before filtering so filters never silently omit matches.
  const profiles = [];
  let scanned = 0;
  let lastId = null;
  let hasMore = false;
  while (scanned < 5000) {
    const snapshot = await query.limit(200).get();
    if (!snapshot.docs.length) break;
    for (const doc of snapshot.docs) {
      const profile = { ...doc.data(), specialMusicProfileId: doc.id };
      scanned += 1;
      lastId = doc.id;
      const rule = TIER_AVAILABILITY[profile.tier];
      if ((tier === undefined || profile.tier === tier) && (profileType === undefined || profile.profileType === profileType)
        && (status === "all" || profile.status === status) && (!eligible || (rule && (rule.anyService || rule.serviceTypes.includes(eligible))))) profiles.push(profile);
      if (profiles.length === limit || scanned === 5000) { hasMore = true; break; }
    }
    if (hasMore || snapshot.docs.length < 200) break;
    query = deps.specialMusicProfilesCollection.orderBy("__name__").startAfter(lastId);
  }
  const result = { profiles, count: profiles.length, nextCursor: hasMore ? lastId : null, tierAvailability: TIER_AVAILABILITY };
  if (input.format === "table") {
    result.table = {
      columns: ["Profile", "Group name", "Type", "Tier", "Eligible services", "Members", "Pianists", "Status"],
      rows: profiles.map((profile) => [profile.displayName, profile.groupName || "—", profile.profileType, profile.tier,
        TIER_AVAILABILITY[profile.tier]?.label || "Unknown", profile.members?.map((member) => member.displayName).join(" / ") || "Not supplied",
        profile.accompanists?.map((pianist) => pianist.displayName).join(" / ") || "Unassigned", profile.status])
    };
  }
  return result;
}
async function writeProfile(operation, input, deps) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Operation arguments must be an object");
  if (!WRITES.has(operation)) fail("Unknown special-music write operation");
  const profileId = id(input.specialMusicProfileId);
  const actor = string(deps.actorSubject, "authenticated actor", 500);
  const key = string(deps.idempotencyKey, "idempotencyKey", 200);
  if (key.length < 8) fail("idempotencyKey must contain at least 8 characters");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) fail("expectedVersion must be a nonnegative integer");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const fingerprint = hash(stableStringify({ operation, input }));
  const ref = deps.specialMusicProfilesCollection.doc(profileId);
  const receiptRef = deps.ministryPlanningOperationExecutionsCollection.doc(`special-music-${hash(`${actor}\0${key}`)}`);
  return deps.db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      const saved = receipt.data();
      if (saved.fingerprint !== fingerprint) fail("Idempotency key was already used for another intent", "idempotency_key_reused", 409);
      return { ...saved.response, idempotency: { protected: true, replayed: true, executionId: receiptRef.id } };
    }
    const doc = await transaction.get(ref);
    const previous = doc.exists ? doc.data() : null;
    if ((previous?.version || 0) !== input.expectedVersion) fail("Profile changed; retrieve it and retry with its current version", "version_conflict", 409);
    let profile;
    if (operation === "archiveSpecialMusicProfile") {
      if (!previous) fail("Special music profile not found", "special_music_profile_not_found", 404);
      if (Object.keys(input).some((field) => !["specialMusicProfileId", "expectedVersion"].includes(field))) fail("Archive accepts only profile ID and expectedVersion");
      profile = { ...previous, status: "archived" };
    } else {
      profile = validateProfile(input, previous || {});
      // Resolve names from the existing pianist roster inside the same transaction.
      for (const accompanist of profile.accompanists) {
        const pianist = await transaction.get(deps.pianistsCollection.doc(accompanist.pianistId));
        if (!pianist.exists) fail("Accompanist is not in the pianist roster", "pianist_not_found", 404);
        accompanist.displayName = string(pianist.data().displayName, "pianist displayName");
      }
    }
    const now = new Date(typeof deps.now === "function" ? deps.now() : Date.now()).toISOString();
    profile = { ...profile, specialMusicProfileId: profileId, version: (previous?.version || 0) + 1,
      createdAt: previous?.createdAt || now, updatedAt: now, updatedBy: actor };
    const response = { operation, mode: "command", result: { profile }, idempotency: { protected: true, replayed: false, executionId: receiptRef.id } };
    transaction.set(ref, profile);
    transaction.set(receiptRef, { operation, fingerprint, actor, source: "ministry-planning", createdAt: now, status: "succeeded", response });
    return response;
  });
}
async function saveSpecialMusicProfile(input, deps) { return (await writeProfile("saveSpecialMusicProfile", input, deps)).result; }
async function archiveSpecialMusicProfile(input, deps) { return (await writeProfile("archiveSpecialMusicProfile", input, deps)).result; }

module.exports = { PROFILE_TYPES, TIER_AVAILABILITY, WRITES, validateProfile, getSpecialMusicProfile, listSpecialMusicProfiles, saveSpecialMusicProfile, archiveSpecialMusicProfile, writeProfile };
