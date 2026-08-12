"use strict";

const { randomUUID } = require("node:crypto");
const { getDanActorFields, requireDanPrivateAccess } = require("./dan-private-access");

const ORGANIZATION_TYPES = Object.freeze(["church", "ministry", "business", "nonprofit", "school", "other"]);
const CONTACT_METHOD_TYPES = Object.freeze([
  "email",
  "phone",
  "whatsapp",
  "messenger",
  "facebook",
  "address",
  "website",
  "other"
]);
const INTERACTION_TYPES = Object.freeze(["meeting", "visit", "message", "call", "letter", "event", "other"]);

function createRelationshipError(message, statusCode = 400, code = "dan_relationship_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value) {
  return normalizeString(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeStrings(value, maximum = 50) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeString).filter(Boolean))].slice(0, maximum);
}

function normalizeLocationKeys(value) {
  return [...new Set(normalizeStrings(value, 30).map(normalizeKey).filter(Boolean))];
}

function normalizeLimit(value, fallback = 25, maximum = 100) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), maximum) : fallback;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function getCollection(deps, key) {
  const collection = deps[key];
  if (!collection || typeof collection.doc !== "function") {
    throw createRelationshipError(
      `Dan Relationships collection ${key} is not configured`,
      500,
      "dan_relationship_collection_not_configured",
      { collection: key }
    );
  }
  return collection;
}

async function loadCollection(collection) {
  if (typeof collection.get !== "function") {
    throw createRelationshipError("Dan Relationships collection cannot be read", 500, "dan_relationship_collection_unreadable");
  }
  const snapshot = await collection.get();
  return Array.isArray(snapshot?.docs)
    ? snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    : [];
}

async function getRequiredRecord(collection, id, kind) {
  const cleanId = normalizeString(id);
  if (!cleanId) throw createRelationshipError(`${kind} ID is required`, 400, `missing_${kind}_id`);
  const document = await collection.doc(cleanId).get();
  if (!document.exists) {
    throw createRelationshipError(`${kind} not found`, 404, `${kind}_not_found`, { [`${kind}Id`]: cleanId });
  }
  return { id: cleanId, ...(document.data() || {}) };
}

function assertExpectedVersion(record, expectedVersion, kind) {
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected) || expected < 1) {
    throw createRelationshipError("A positive expectedVersion is required", 400, "missing_expected_version", { kind });
  }
  const current = Number(record.version || 0);
  if (expected !== current) {
    throw createRelationshipError(
      `${kind} changed since it was read`,
      409,
      "dan_relationship_version_conflict",
      { kind, expectedVersion: expected, currentVersion: current }
    );
  }
}

function buildBaseRecord(kind, id, deps) {
  const actor = getDanActorFields(deps);
  const now = getNowIso(deps);
  return {
    [`${kind}Id`]: id,
    owner: "dan",
    serves: ["dan"],
    visibility: "private",
    ownerSub: actor.actorSub,
    createdBySub: actor.actorSub,
    createdByName: actor.actorName,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function buildSearchText(values) {
  return normalizeKey(values.flat().filter(Boolean).join(" "));
}

function buildPersonSummary(person = {}) {
  return {
    personId: person.personId || "",
    displayName: person.displayName || "",
    givenName: person.givenName || "",
    middleName: person.middleName || "",
    surname: person.surname || "",
    honorific: person.honorific || "",
    alternateNames: Array.isArray(person.alternateNames) ? person.alternateNames : [],
    title: person.title || "",
    notes: person.notes || "",
    locationKeys: Array.isArray(person.locationKeys) ? person.locationKeys : [],
    completeness: person.completeness || "name_only",
    profilePhotoId: person.profilePhotoId || "",
    status: person.status || "active",
    version: Number(person.version || 0),
    createdAt: person.createdAt || "",
    updatedAt: person.updatedAt || ""
  };
}

function calculatePersonCompleteness(person = {}, { affiliations = 0, contactMethods = 0 } = {}) {
  if (contactMethods > 0) return "contactable";
  if (affiliations > 0) return "affiliated";
  return "name_only";
}

async function findPossiblePersonDuplicates(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const displayName = normalizeKey(input.displayName);
  const email = normalizeKey(input.email);
  const phone = normalizeKey(input.phone);
  const organizationId = normalizeString(input.organizationId);
  if (!displayName && !email && !phone) return { count: 0, candidates: [] };

  const [people, contacts, affiliations] = await Promise.all([
    loadCollection(getCollection(deps, "relationshipPeopleCollection")),
    loadCollection(getCollection(deps, "relationshipContactMethodsCollection")),
    loadCollection(getCollection(deps, "relationshipAffiliationsCollection"))
  ]);
  const contactOwners = new Set(contacts
    .filter((method) => (email && normalizeKey(method.value) === email) || (phone && normalizeKey(method.value) === phone))
    .map((method) => method.personId));
  const organizationPeople = new Set(affiliations
    .filter((affiliation) => organizationId && affiliation.organizationId === organizationId)
    .map((affiliation) => affiliation.personId));

  const candidates = people
    .map((person) => {
      const exactName = Boolean(displayName) && normalizeKey(person.displayName) === displayName;
      const contactMatch = contactOwners.has(person.personId);
      const organizationMatch = organizationPeople.has(person.personId);
      const score = (contactMatch ? 100 : 0) + (exactName ? 30 : 0) + (organizationMatch ? 20 : 0);
      return { person, score, reasons: [contactMatch && "contact_method", exactName && "name", organizationMatch && "organization"].filter(Boolean) };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map(({ person, score, reasons }) => ({ ...buildPersonSummary(person), duplicateScore: score, reasons }));
  return { count: candidates.length, candidates, requiresReview: candidates.length > 0 };
}

async function createPerson(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const displayName = normalizeString(input.displayName);
  if (!displayName) throw createRelationshipError("displayName is required", 400, "missing_person_display_name");
  const duplicateReview = await findPossiblePersonDuplicates(input, deps);
  if (duplicateReview.requiresReview && input.duplicateReviewed !== true) {
    throw createRelationshipError(
      "Possible duplicate people require review before creating another record",
      409,
      "possible_person_duplicate",
      duplicateReview
    );
  }
  const personId = normalizeString(input.personId) || `person-${randomUUID()}`;
  const record = {
    ...buildBaseRecord("person", personId, deps),
    displayName,
    givenName: normalizeString(input.givenName),
    middleName: normalizeString(input.middleName),
    surname: normalizeString(input.surname),
    honorific: normalizeString(input.honorific),
    alternateNames: normalizeStrings(input.alternateNames, 20),
    title: normalizeString(input.title),
    notes: normalizeString(input.notes),
    locationKeys: normalizeLocationKeys(input.locationKeys),
    completeness: "name_only",
    profilePhotoId: "",
    status: "active",
    searchText: buildSearchText([displayName, input.alternateNames, input.title, input.locationKeys])
  };
  try {
    await getCollection(deps, "relationshipPeopleCollection").doc(personId).create(record);
  } catch (error) {
    if (/already exists/i.test(error?.message || "") || error?.code === 6) {
      throw createRelationshipError("personId already exists", 409, "person_id_exists", { personId });
    }
    throw error;
  }
  return { person: buildPersonSummary(record), duplicateReview };
}

async function getPerson(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const person = await getRequiredRecord(getCollection(deps, "relationshipPeopleCollection"), input.personId, "person");
  const [affiliations, contactMethods, interactions, photos] = await Promise.all([
    loadCollection(getCollection(deps, "relationshipAffiliationsCollection")),
    loadCollection(getCollection(deps, "relationshipContactMethodsCollection")),
    loadCollection(getCollection(deps, "relationshipInteractionsCollection")),
    loadCollection(getCollection(deps, "relationshipPhotosCollection"))
  ]);
  return {
    person: buildPersonSummary(person),
    affiliations: affiliations.filter((item) => item.personId === person.personId),
    contactMethods: contactMethods.filter((item) => item.personId === person.personId),
    interactions: interactions.filter((item) => Array.isArray(item.personIds) && item.personIds.includes(person.personId)),
    photos: photos.filter((item) => item.personId === person.personId)
  };
}

async function updatePerson(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const collection = getCollection(deps, "relationshipPeopleCollection");
  const existing = await getRequiredRecord(collection, input.personId, "person");
  assertExpectedVersion(existing, input.expectedVersion, "person");
  const changes = input.changes && typeof input.changes === "object" && !Array.isArray(input.changes) ? input.changes : {};
  const allowed = ["displayName", "givenName", "middleName", "surname", "honorific", "alternateNames", "title", "notes", "locationKeys", "status"];
  const next = { ...existing };
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    next[key] = key === "alternateNames"
      ? normalizeStrings(changes[key], 20)
      : key === "locationKeys"
        ? normalizeLocationKeys(changes[key])
        : normalizeString(changes[key]);
  }
  if (!next.displayName) throw createRelationshipError("displayName cannot be blank", 400, "missing_person_display_name");
  if (!['active', 'archived'].includes(next.status || 'active')) {
    throw createRelationshipError("Invalid person status", 400, "invalid_person_status");
  }
  next.searchText = buildSearchText([next.displayName, next.alternateNames, next.title, next.locationKeys]);
  next.version = Number(existing.version || 0) + 1;
  next.updatedAt = getNowIso(deps);
  await collection.doc(existing.personId).set(next);
  return { person: buildPersonSummary(next) };
}

async function searchPeople(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const query = normalizeKey(input.query);
  const location = normalizeKey(input.location);
  const status = normalizeString(input.status) || "active";
  const people = (await loadCollection(getCollection(deps, "relationshipPeopleCollection")))
    .filter((person) => !status || (person.status || "active") === status)
    .filter((person) => !query || normalizeKey(person.searchText || person.displayName).includes(query))
    .filter((person) => !location || (person.locationKeys || []).some((key) => normalizeKey(key).includes(location)))
    .sort((left, right) => (left.displayName || "").localeCompare(right.displayName || ""))
    .slice(0, normalizeLimit(input.limit))
    .map(buildPersonSummary);
  return { count: people.length, people };
}

async function createOrganization(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const name = normalizeString(input.name);
  if (!name) throw createRelationshipError("Organization name is required", 400, "missing_organization_name");
  const type = normalizeString(input.type).toLowerCase() || "other";
  if (!ORGANIZATION_TYPES.includes(type)) {
    throw createRelationshipError("Invalid organization type", 400, "invalid_organization_type", { allowed: ORGANIZATION_TYPES });
  }
  const existing = (await loadCollection(getCollection(deps, "relationshipOrganizationsCollection")))
    .find((organization) => normalizeKey(organization.name) === normalizeKey(name));
  if (existing && input.duplicateReviewed !== true) {
    throw createRelationshipError("An organization with this name may already exist", 409, "possible_organization_duplicate", {
      organization: existing
    });
  }
  const organizationId = normalizeString(input.organizationId) || `organization-${randomUUID()}`;
  const record = {
    ...buildBaseRecord("organization", organizationId, deps),
    name,
    type,
    alternateNames: normalizeStrings(input.alternateNames, 20),
    parentOrganizationId: normalizeString(input.parentOrganizationId),
    website: normalizeString(input.website),
    notes: normalizeString(input.notes),
    locationKeys: normalizeLocationKeys(input.locationKeys),
    addresses: Array.isArray(input.addresses) ? input.addresses.slice(0, 10) : [],
    status: "active",
    searchText: buildSearchText([name, input.alternateNames, type, input.locationKeys])
  };
  await getCollection(deps, "relationshipOrganizationsCollection").doc(organizationId).create(record);
  return { organization: record };
}

async function getOrganization(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const organization = await getRequiredRecord(
    getCollection(deps, "relationshipOrganizationsCollection"),
    input.organizationId,
    "organization"
  );
  const affiliations = (await loadCollection(getCollection(deps, "relationshipAffiliationsCollection")))
    .filter((item) => item.organizationId === organization.organizationId);
  return { organization, affiliations };
}

async function searchOrganizations(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const query = normalizeKey(input.query);
  const type = normalizeString(input.type).toLowerCase();
  const location = normalizeKey(input.location);
  const organizations = (await loadCollection(getCollection(deps, "relationshipOrganizationsCollection")))
    .filter((item) => !type || item.type === type)
    .filter((item) => !query || normalizeKey(item.searchText || item.name).includes(query))
    .filter((item) => !location || (item.locationKeys || []).some((key) => normalizeKey(key).includes(location)))
    .slice(0, normalizeLimit(input.limit))
    .sort((left, right) => (left.name || "").localeCompare(right.name || ""));
  return { count: organizations.length, organizations };
}

async function linkPersonToOrganization(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const people = getCollection(deps, "relationshipPeopleCollection");
  const organizations = getCollection(deps, "relationshipOrganizationsCollection");
  const person = await getRequiredRecord(people, input.personId, "person");
  await getRequiredRecord(organizations, input.organizationId, "organization");
  const role = normalizeString(input.role);
  const existing = (await loadCollection(getCollection(deps, "relationshipAffiliationsCollection")))
    .find((item) => item.personId === person.personId && item.organizationId === input.organizationId && normalizeKey(item.role) === normalizeKey(role));
  if (existing) return { affiliation: existing, replayed: true };
  const affiliationId = normalizeString(input.affiliationId) || `affiliation-${randomUUID()}`;
  const affiliation = {
    ...buildBaseRecord("affiliation", affiliationId, deps),
    personId: person.personId,
    organizationId: normalizeString(input.organizationId),
    role,
    startedOn: normalizeString(input.startedOn),
    endedOn: normalizeString(input.endedOn),
    confidence: normalizeString(input.confidence) || "confirmed",
    source: normalizeString(input.source),
    notes: normalizeString(input.notes),
    status: normalizeString(input.endedOn) ? "past" : "current"
  };
  await getCollection(deps, "relationshipAffiliationsCollection").doc(affiliationId).create(affiliation);
  if (person.completeness === "name_only") {
    const nextPerson = { ...person, completeness: "affiliated", version: Number(person.version || 0) + 1, updatedAt: getNowIso(deps) };
    await people.doc(person.personId).set(nextPerson);
  }
  return { affiliation, replayed: false };
}

function normalizeContactValue(type, value) {
  const clean = normalizeString(value);
  if (["email"].includes(type)) return clean.toLowerCase();
  if (["phone", "whatsapp"].includes(type)) return clean.replace(/[^\d+]/g, "");
  return clean;
}

async function addContactMethod(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const type = normalizeString(input.type).toLowerCase();
  if (!CONTACT_METHOD_TYPES.includes(type)) {
    throw createRelationshipError("Invalid contact method type", 400, "invalid_contact_method_type", { allowed: CONTACT_METHOD_TYPES });
  }
  const personId = normalizeString(input.personId);
  const organizationId = normalizeString(input.organizationId);
  if (Boolean(personId) === Boolean(organizationId)) {
    throw createRelationshipError("Provide exactly one personId or organizationId", 400, "invalid_contact_method_owner");
  }
  const ownerCollection = personId
    ? getCollection(deps, "relationshipPeopleCollection")
    : getCollection(deps, "relationshipOrganizationsCollection");
  const owner = await getRequiredRecord(ownerCollection, personId || organizationId, personId ? "person" : "organization");
  const value = normalizeContactValue(type, input.value);
  if (!value) throw createRelationshipError("Contact method value is required", 400, "missing_contact_method_value");
  const collection = getCollection(deps, "relationshipContactMethodsCollection");
  const duplicate = (await loadCollection(collection)).find((item) =>
    item.type === type && item.normalizedValue === normalizeKey(value) && item.personId === personId && item.organizationId === organizationId
  );
  if (duplicate) return { contactMethod: duplicate, replayed: true };
  const contactMethodId = normalizeString(input.contactMethodId) || `contact-method-${randomUUID()}`;
  const record = {
    ...buildBaseRecord("contactMethod", contactMethodId, deps),
    personId,
    organizationId,
    type,
    value,
    normalizedValue: normalizeKey(value),
    label: normalizeString(input.label),
    preferred: input.preferred === true,
    verifiedAt: input.verified === true ? getNowIso(deps) : normalizeString(input.verifiedAt),
    source: normalizeString(input.source),
    notes: normalizeString(input.notes),
    status: "active"
  };
  await collection.doc(contactMethodId).create(record);
  if (personId && owner.completeness !== "contactable") {
    await ownerCollection.doc(personId).set({
      ...owner,
      completeness: "contactable",
      version: Number(owner.version || 0) + 1,
      updatedAt: getNowIso(deps)
    });
  }
  return { contactMethod: record, replayed: false };
}

async function updateContactMethod(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const collection = getCollection(deps, "relationshipContactMethodsCollection");
  const existing = await getRequiredRecord(collection, input.contactMethodId, "contactMethod");
  assertExpectedVersion(existing, input.expectedVersion, "contactMethod");
  const changes = input.changes && typeof input.changes === "object" ? input.changes : {};
  const next = { ...existing };
  for (const field of ["value", "label", "source", "notes", "status"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) next[field] = normalizeString(changes[field]);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "preferred")) next.preferred = changes.preferred === true;
  if (Object.prototype.hasOwnProperty.call(changes, "verified")) next.verifiedAt = changes.verified === true ? getNowIso(deps) : "";
  next.value = normalizeContactValue(existing.type, next.value);
  next.normalizedValue = normalizeKey(next.value);
  next.version = Number(existing.version || 0) + 1;
  next.updatedAt = getNowIso(deps);
  await collection.doc(existing.contactMethodId).set(next);
  return { contactMethod: next };
}

async function recordInteraction(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const personIds = normalizeStrings(input.personIds, 25);
  const organizationIds = normalizeStrings(input.organizationIds, 25);
  if (personIds.length === 0 && organizationIds.length === 0) {
    throw createRelationshipError("An interaction must link a person or organization", 400, "missing_interaction_relationship");
  }
  for (const personId of personIds) {
    await getRequiredRecord(getCollection(deps, "relationshipPeopleCollection"), personId, "person");
  }
  for (const organizationId of organizationIds) {
    await getRequiredRecord(getCollection(deps, "relationshipOrganizationsCollection"), organizationId, "organization");
  }
  const type = normalizeString(input.type).toLowerCase() || "other";
  if (!INTERACTION_TYPES.includes(type)) {
    throw createRelationshipError("Invalid interaction type", 400, "invalid_interaction_type", { allowed: INTERACTION_TYPES });
  }
  const summary = normalizeString(input.summary);
  if (!summary) throw createRelationshipError("Interaction summary is required", 400, "missing_interaction_summary");
  const interactionId = normalizeString(input.interactionId) || `interaction-${randomUUID()}`;
  const record = {
    ...buildBaseRecord("interaction", interactionId, deps),
    personIds,
    organizationIds,
    tripId: normalizeString(input.tripId),
    type,
    happenedAt: normalizeString(input.happenedAt) || getNowIso(deps),
    locationKeys: normalizeLocationKeys(input.locationKeys),
    summary,
    exactText: normalizeString(input.exactText),
    source: normalizeString(input.source),
    sourceRecordIds: normalizeStrings(input.sourceRecordIds, 25),
    followUpStatus: normalizeString(input.followUpStatus) || "none",
    followUpSummary: normalizeString(input.followUpSummary),
    searchText: buildSearchText([summary, input.exactText, input.locationKeys])
  };
  await getCollection(deps, "relationshipInteractionsCollection").doc(interactionId).create(record);
  return { interaction: record };
}

module.exports = {
  CONTACT_METHOD_TYPES,
  INTERACTION_TYPES,
  ORGANIZATION_TYPES,
  addContactMethod,
  assertExpectedVersion,
  buildPersonSummary,
  calculatePersonCompleteness,
  createOrganization,
  createPerson,
  createRelationshipError,
  findPossiblePersonDuplicates,
  getCollection,
  getNowIso,
  getOrganization,
  getPerson,
  getRequiredRecord,
  linkPersonToOrganization,
  loadCollection,
  normalizeKey,
  normalizeLimit,
  normalizeLocationKeys,
  normalizeString,
  normalizeStrings,
  recordInteraction,
  searchOrganizations,
  searchPeople,
  updateContactMethod,
  updatePerson
};
