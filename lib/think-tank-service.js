"use strict";

const { randomUUID } = require("node:crypto");
const { getTaskAccess, getTaskActorFields } = require("./task-management-access");

const THINK_TANK_STATUSES = Object.freeze(["inbox", "incubating", "ready", "parked", "closed"]);
const THINK_TANK_OPEN_STATUSES = Object.freeze(["inbox", "incubating", "ready"]);
const THINK_TANK_DESTINATIONS = Object.freeze([
  "task_management",
  "outlook_calendar",
  "sermon_workspace",
  "ministry_planning",
  "pastoral_care",
  "church_accounting"
]);
const LIFE_AREAS = Object.freeze(["work", "home", "church", "personal"]);
const MAX_SCAN = 5000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function createThinkTankError(message, statusCode = 400, code = "think_tank_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value, field, { maximum = 25, itemMaximum = 200 } = {}) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw createThinkTankError(`${field} must be an array`, 400, `invalid_${field}`);
  }
  if (value.length > maximum) {
    throw createThinkTankError(`${field} may contain at most ${maximum} values`, 400, `too_many_${field}`);
  }
  const normalized = value.map(normalizeString).filter(Boolean);
  const tooLong = normalized.find((item) => item.length > itemMaximum);
  if (tooLong) {
    throw createThinkTankError(`${field} values may contain at most ${itemMaximum} characters`, 400, `invalid_${field}`);
  }
  return [...new Set(normalized)];
}

function normalizeEnum(value, allowed, fallback, field) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (!allowed.includes(normalized)) {
    throw createThinkTankError(`Invalid ${field}`, 400, `invalid_${field}`, {
      value: normalized,
      allowedValues: allowed
    });
  }
  return normalized;
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

function normalizeDate(value, field, fallback = "") {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))) {
    throw createThinkTankError(`${field} must be YYYY-MM-DD`, 400, `invalid_${field}`, { value: normalized });
  }
  return normalized;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  return value instanceof Date ? value.toISOString() : String(value);
}

function validateDocId(value, field) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.length > 300 || normalized.includes("/")) {
    throw createThinkTankError(`Invalid ${field}`, 400, `invalid_${field}`);
  }
  return normalized;
}

function getCollection(deps, key, label) {
  const collection = deps[key];
  if (!collection || typeof collection.doc !== "function") {
    throw createThinkTankError(
      `${label} collection is not configured`,
      500,
      `${key.replace(/Collection$/, "")}_collection_not_configured`
    );
  }
  return collection;
}

async function loadCollection(collectionRef, maxDocs = MAX_SCAN) {
  const snapshot = await collectionRef.limit(maxDocs).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function getActorSubjects(deps = {}) {
  const access = getTaskAccess(deps);
  return [...new Set([access.subject, ...(access.subjects || [])].map(normalizeString).filter(Boolean))];
}

function assertAuthenticatedOwner(deps = {}) {
  const subjects = getActorSubjects(deps);
  if (!subjects.length) {
    throw createThinkTankError(
      "Think Tank requires an authenticated individual identity",
      403,
      "think_tank_identity_required"
    );
  }
  return subjects;
}

function isThoughtOwner(thought = {}, deps = {}) {
  const actorSubjects = getActorSubjects(deps);
  if (!actorSubjects.length) return false;
  const ownerSubjects = [...new Set([
    thought.ownerSub,
    ...(Array.isArray(thought.ownerSubjects) ? thought.ownerSubjects : [])
  ].map(normalizeString).filter(Boolean))];
  return ownerSubjects.some((subject) => actorSubjects.includes(subject));
}

function assertThoughtOwner(thought = {}, deps = {}, thoughtId = "") {
  if (isThoughtOwner(thought, deps)) return;
  throw createThinkTankError(
    "This Think Tank entry belongs to another private owner",
    403,
    "think_tank_owner_only",
    { thoughtId }
  );
}

function normalizeTopics(value) {
  return normalizeStringArray(value, "topics", { maximum: 25, itemMaximum: 100 }) || [];
}

function normalizeCandidateDestinations(value) {
  const destinations = normalizeStringArray(value, "candidate_destinations", {
    maximum: THINK_TANK_DESTINATIONS.length,
    itemMaximum: 100
  }) || [];
  return destinations.map((destination) => normalizeEnum(
    destination,
    THINK_TANK_DESTINATIONS,
    "",
    "candidate_destination"
  ));
}

function buildSearchText(thought = {}) {
  return [
    thought.thoughtId,
    thought.exactText,
    thought.assistantTitle,
    thought.assistantSummary,
    thought.lifeArea,
    thought.status,
    ...(Array.isArray(thought.topics) ? thought.topics : []),
    ...(Array.isArray(thought.candidateDestinations) ? thought.candidateDestinations : []),
    ...(Array.isArray(thought.outcomeLinks)
      ? thought.outcomeLinks.flatMap((link) => [
          link.destinationSystem,
          link.destinationType,
          link.destinationId,
          link.label
        ])
      : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildThoughtRecord(thought = {}, fallbackId = "") {
  return {
    thoughtId: thought.thoughtId || fallbackId,
    exactText: thought.exactText || "",
    assistantTitle: thought.assistantTitle || "",
    assistantSummary: thought.assistantSummary || "",
    lifeArea: thought.lifeArea || "",
    topics: Array.isArray(thought.topics) ? [...thought.topics] : [],
    candidateDestinations: Array.isArray(thought.candidateDestinations)
      ? [...thought.candidateDestinations]
      : [],
    status: THINK_TANK_STATUSES.includes(thought.status) ? thought.status : "inbox",
    source: thought.source || "",
    sourceMode: thought.sourceMode || "",
    outcomeLinks: Array.isArray(thought.outcomeLinks)
      ? thought.outcomeLinks.map((link) => ({ ...link }))
      : [],
    ownerSub: thought.ownerSub || "",
    ownerName: thought.ownerName || "",
    ownerEmail: thought.ownerEmail || "",
    version: Number.isInteger(thought.version) ? thought.version : 1,
    createdAt: thought.createdAt || "",
    updatedAt: thought.updatedAt || "",
    closedAt: thought.closedAt || ""
  };
}

function buildThoughtSummary(thought = {}, fallbackId = "", asOfDate = "") {
  const record = buildThoughtRecord(thought, fallbackId);
  const exactTextMaximum = 2000;
  const exactTextTruncated = record.exactText.length > exactTextMaximum;
  let ageDays = 0;
  if (asOfDate && record.createdAt) {
    const createdDate = record.createdAt.slice(0, 10);
    ageDays = Math.max(0, Math.floor(
      (Date.parse(`${asOfDate}T00:00:00.000Z`) - Date.parse(`${createdDate}T00:00:00.000Z`)) /
      (24 * 60 * 60 * 1000)
    ));
  }
  return {
    thoughtId: record.thoughtId,
    exactText: exactTextTruncated ? `${record.exactText.slice(0, exactTextMaximum - 1)}…` : record.exactText,
    exactTextTruncated,
    assistantTitle: record.assistantTitle,
    assistantSummary: record.assistantSummary,
    lifeArea: record.lifeArea,
    topics: record.topics,
    candidateDestinations: record.candidateDestinations,
    status: record.status,
    outcomeLinks: record.outcomeLinks,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ageDays
  };
}

function encodeCursor(thought = {}) {
  return Buffer.from(JSON.stringify({
    createdAt: thought.createdAt || "",
    thoughtId: thought.thoughtId || ""
  }), "utf8").toString("base64url");
}

function encodeReflectionCursor(reflection = {}) {
  return Buffer.from(JSON.stringify({
    createdAt: reflection.createdAt || "",
    reflectionId: reflection.reflectionId || ""
  }), "utf8").toString("base64url");
}

function decodeReflectionCursor(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  try {
    const decoded = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
    if (!normalizeString(decoded.createdAt) || !normalizeString(decoded.reflectionId)) throw new Error("invalid");
    return { createdAt: decoded.createdAt, reflectionId: decoded.reflectionId };
  } catch (_error) {
    throw createThinkTankError("Invalid Think Tank reflection cursor", 400, "invalid_think_tank_reflection_cursor");
  }
}

function decodeCursor(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  try {
    const decoded = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
    if (!normalizeString(decoded.createdAt) || !normalizeString(decoded.thoughtId)) throw new Error("invalid");
    return { createdAt: decoded.createdAt, thoughtId: decoded.thoughtId };
  } catch (_error) {
    throw createThinkTankError("Invalid Think Tank cursor", 400, "invalid_think_tank_cursor");
  }
}

function sortThoughts(a, b) {
  const created = (b.createdAt || "").localeCompare(a.createdAt || "");
  return created || (b.thoughtId || "").localeCompare(a.thoughtId || "");
}

function applyCursor(records, cursor) {
  if (!cursor) return records;
  const index = records.findIndex((record) => (
    record.createdAt === cursor.createdAt && record.thoughtId === cursor.thoughtId
  ));
  if (index < 0) {
    throw createThinkTankError(
      "The Think Tank cursor is stale or does not match this result set",
      409,
      "stale_think_tank_cursor"
    );
  }
  return records.slice(index + 1);
}

function normalizeStatusFilters(input = {}) {
  if (input.status) {
    return [normalizeEnum(input.status, THINK_TANK_STATUSES, "", "think_tank_status")];
  }
  if (input.statuses === undefined) return [];
  const statuses = normalizeStringArray(input.statuses, "statuses", {
    maximum: THINK_TANK_STATUSES.length,
    itemMaximum: 50
  }) || [];
  return statuses.map((status) => normalizeEnum(status, THINK_TANK_STATUSES, "", "think_tank_status"));
}

async function loadOwnedThoughts(input = {}, deps = {}) {
  assertAuthenticatedOwner(deps);
  const collection = getCollection(deps, "thinkTankEntriesCollection", "Think Tank entries");
  const records = await loadCollection(collection, MAX_SCAN);
  const statuses = normalizeStatusFilters(input);
  const lifeArea = normalizeString(input.lifeArea).toLowerCase();
  if (lifeArea && !LIFE_AREAS.includes(lifeArea)) {
    throw createThinkTankError("Invalid life area", 400, "invalid_life_area", { allowedValues: LIFE_AREAS });
  }
  const topic = normalizeString(input.topic).toLowerCase();
  const query = normalizeString(input.query).toLowerCase();
  const thoughts = records
    .filter(({ data }) => isThoughtOwner(data, deps))
    .map(({ id, data }) => buildThoughtRecord(data, id))
    .filter((thought) => !statuses.length || statuses.includes(thought.status))
    .filter((thought) => !lifeArea || thought.lifeArea === lifeArea)
    .filter((thought) => !topic || thought.topics.some((value) => value.toLowerCase() === topic))
    .filter((thought) => !query || buildSearchText(thought).includes(query))
    .sort(sortThoughts);
  return {
    thoughts,
    sourceTruncated: records.length >= MAX_SCAN
  };
}

async function captureThinkTankEntry(input = {}, deps = {}) {
  const exactText = typeof input.exactText === "string" ? input.exactText : "";
  if (!exactText.trim()) {
    throw createThinkTankError("exactText is required", 400, "think_tank_exact_text_required");
  }
  if (exactText.length > 100000) {
    throw createThinkTankError("exactText may contain at most 100000 characters", 400, "think_tank_exact_text_too_long");
  }
  const ownerSubjects = assertAuthenticatedOwner(deps);
  const actor = getTaskActorFields(deps);
  const nowIso = getNowIso(deps);
  const idFactory = typeof deps.randomUUID === "function" ? deps.randomUUID : randomUUID;
  const thoughtId = normalizeString(input.thoughtId)
    ? validateDocId(input.thoughtId, "thoughtId")
    : `thought-${idFactory()}`;
  const collection = getCollection(deps, "thinkTankEntriesCollection", "Think Tank entries");
  const docRef = collection.doc(thoughtId);
  const existing = await docRef.get();
  if (existing.exists) {
    throw createThinkTankError("Think Tank entry already exists", 409, "think_tank_entry_exists", { thoughtId });
  }
  const lifeArea = normalizeEnum(input.lifeArea, LIFE_AREAS, "", "life_area");
  const thought = {
    thoughtId,
    exactText,
    assistantTitle: normalizeString(input.assistantTitle),
    assistantSummary: normalizeString(input.assistantSummary),
    lifeArea,
    topics: normalizeTopics(input.topics),
    candidateDestinations: normalizeCandidateDestinations(input.candidateDestinations),
    status: normalizeEnum(input.status, THINK_TANK_STATUSES, "inbox", "think_tank_status"),
    source: normalizeString(input.source),
    sourceMode: normalizeString(input.sourceMode),
    outcomeLinks: [],
    ownerSub: actor.actorSub,
    ownerSubjects,
    ownerName: actor.actorName,
    ownerEmail: actor.actorEmail,
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    closedAt: ""
  };
  thought.searchText = buildSearchText(thought);
  await docRef.create(thought);
  return { thought: buildThoughtRecord(thought, thoughtId) };
}

async function getThinkTankEntry(input = {}, deps = {}) {
  assertAuthenticatedOwner(deps);
  const thoughtId = validateDocId(input.thoughtId, "thoughtId");
  const collection = getCollection(deps, "thinkTankEntriesCollection", "Think Tank entries");
  const doc = await collection.doc(thoughtId).get();
  if (!doc.exists) {
    throw createThinkTankError("Think Tank entry not found", 404, "think_tank_entry_not_found", { thoughtId });
  }
  const thought = doc.data() || {};
  assertThoughtOwner(thought, deps, thoughtId);
  return { thought: buildThoughtRecord(thought, thoughtId) };
}

async function listThinkTankEntries(input = {}, deps = {}) {
  const { thoughts, sourceTruncated } = await loadOwnedThoughts(input, deps);
  const cursor = decodeCursor(input.cursor);
  const remaining = applyCursor(thoughts, cursor);
  const limit = normalizeLimit(input.limit);
  const page = remaining.slice(0, limit);
  const moreAvailable = remaining.length > page.length;
  return {
    totalCount: thoughts.length,
    returnedCount: page.length,
    entries: page.map((thought) => buildThoughtSummary(thought)),
    moreAvailable,
    nextCursor: moreAvailable && page.length ? encodeCursor(page.at(-1)) : "",
    sourceTruncated,
    complete: !sourceTruncated && !moreAvailable
  };
}

async function listThinkTankReflections(input = {}, deps = {}) {
  const thoughtId = validateDocId(input.thoughtId, "thoughtId");
  await getThinkTankEntry({ thoughtId }, deps);
  const collection = getCollection(deps, "thinkTankReflectionsCollection", "Think Tank reflections");
  const records = await loadCollection(collection, MAX_SCAN);
  const reflections = records
    .filter(({ data }) => data.thoughtId === thoughtId)
    .map(({ id, data }) => ({
      reflectionId: data.reflectionId || id,
      thoughtId,
      exactText: data.exactText || "",
      assistantSummary: data.assistantSummary || "",
      author: data.author || "",
      source: data.source || "",
      sourceMode: data.sourceMode || "",
      createdAt: data.createdAt || ""
    }))
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const cursor = decodeReflectionCursor(input.cursor);
  let remaining = reflections;
  if (cursor) {
    const index = reflections.findIndex((reflection) => (
      reflection.createdAt === cursor.createdAt && reflection.reflectionId === cursor.reflectionId
    ));
    if (index < 0) {
      throw createThinkTankError(
        "The Think Tank reflection cursor is stale or does not match this result set",
        409,
        "stale_think_tank_reflection_cursor"
      );
    }
    remaining = reflections.slice(index + 1);
  }
  const limit = normalizeLimit(input.limit);
  const page = remaining.slice(0, limit);
  const moreAvailable = remaining.length > page.length;
  const sourceTruncated = records.length >= MAX_SCAN;
  return {
    thoughtId,
    totalCount: reflections.length,
    returnedCount: page.length,
    reflections: page,
    moreAvailable,
    nextCursor: moreAvailable && page.length ? encodeReflectionCursor(page.at(-1)) : "",
    sourceTruncated,
    complete: !sourceTruncated && !moreAvailable
  };
}

function assertExpectedVersion(input = {}, existing = {}, thoughtId = "") {
  const expectedVersion = Number(input.expectedVersion);
  const currentVersion = Math.max(1, Number(existing.version) || 1);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw createThinkTankError(
      "expectedVersion is required and must be a positive integer",
      400,
      "think_tank_version_required",
      { thoughtId, currentVersion }
    );
  }
  if (expectedVersion !== currentVersion) {
    throw createThinkTankError(
      "The Think Tank entry changed after it was read; refresh it before updating",
      409,
      "think_tank_version_conflict",
      { thoughtId, expectedVersion, currentVersion }
    );
  }
}

async function persistVersionedThought(docRef, next, input, deps, thoughtId) {
  const firestore = docRef.firestore || docRef.parent?.firestore;
  if (firestore && typeof firestore.runTransaction === "function") {
    await firestore.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(docRef);
      if (!freshDoc.exists) {
        throw createThinkTankError("Think Tank entry not found", 404, "think_tank_entry_not_found", { thoughtId });
      }
      const fresh = freshDoc.data() || {};
      assertThoughtOwner(fresh, deps, thoughtId);
      assertExpectedVersion(input, fresh, thoughtId);
      transaction.set(docRef, next);
    });
    return;
  }
  await docRef.set(next);
}

async function updateThinkTankEntry(input = {}, deps = {}) {
  const thoughtId = validateDocId(input.thoughtId, "thoughtId");
  const collection = getCollection(deps, "thinkTankEntriesCollection", "Think Tank entries");
  const docRef = collection.doc(thoughtId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createThinkTankError("Think Tank entry not found", 404, "think_tank_entry_not_found", { thoughtId });
  }
  const existing = doc.data() || {};
  assertThoughtOwner(existing, deps, thoughtId);
  assertExpectedVersion(input, existing, thoughtId);
  const changes = input.changes && typeof input.changes === "object" && !Array.isArray(input.changes)
    ? input.changes
    : {};
  if (Object.prototype.hasOwnProperty.call(changes, "exactText")) {
    throw createThinkTankError(
      "Think Tank exactText is immutable; append a reflection instead",
      409,
      "think_tank_exact_text_immutable",
      { thoughtId }
    );
  }
  const allowedFields = new Set([
    "assistantTitle",
    "assistantSummary",
    "lifeArea",
    "topics",
    "candidateDestinations",
    "status"
  ]);
  const unsupported = Object.keys(changes).filter((field) => !allowedFields.has(field));
  if (unsupported.length) {
    throw createThinkTankError(
      "Think Tank update contains unsupported fields",
      400,
      "unsupported_think_tank_changes",
      { unsupported }
    );
  }
  const next = { ...existing };
  if (Object.prototype.hasOwnProperty.call(changes, "assistantTitle")) {
    next.assistantTitle = normalizeString(changes.assistantTitle);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "assistantSummary")) {
    next.assistantSummary = normalizeString(changes.assistantSummary);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "lifeArea")) {
    next.lifeArea = normalizeEnum(changes.lifeArea, LIFE_AREAS, "", "life_area");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "topics")) {
    next.topics = normalizeTopics(changes.topics);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "candidateDestinations")) {
    next.candidateDestinations = normalizeCandidateDestinations(changes.candidateDestinations);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    next.status = normalizeEnum(changes.status, THINK_TANK_STATUSES, next.status || "inbox", "think_tank_status");
  }
  const nowIso = getNowIso(deps);
  next.version = Math.max(1, Number(existing.version) || 1) + 1;
  next.updatedAt = nowIso;
  next.closedAt = next.status === "closed" ? (existing.closedAt || nowIso) : "";
  next.searchText = buildSearchText(next);
  await persistVersionedThought(docRef, next, input, deps, thoughtId);
  return { thought: buildThoughtRecord(next, thoughtId) };
}

async function appendThinkTankReflection(input = {}, deps = {}) {
  const thoughtId = validateDocId(input.thoughtId, "thoughtId");
  await getThinkTankEntry({ thoughtId }, deps);
  const exactText = typeof input.exactText === "string" ? input.exactText : "";
  if (!exactText.trim()) {
    throw createThinkTankError("Reflection exactText is required", 400, "think_tank_reflection_text_required");
  }
  if (exactText.length > 100000) {
    throw createThinkTankError("Reflection exactText may contain at most 100000 characters", 400, "think_tank_reflection_text_too_long");
  }
  const actor = getTaskActorFields(deps);
  const idFactory = typeof deps.randomUUID === "function" ? deps.randomUUID : randomUUID;
  const reflectionId = normalizeString(input.reflectionId)
    ? validateDocId(input.reflectionId, "reflectionId")
    : `thought-reflection-${idFactory()}`;
  const collection = getCollection(deps, "thinkTankReflectionsCollection", "Think Tank reflections");
  const docRef = collection.doc(reflectionId);
  const existing = await docRef.get();
  if (existing.exists) {
    throw createThinkTankError(
      "Think Tank reflection already exists",
      409,
      "think_tank_reflection_exists",
      { reflectionId }
    );
  }
  const reflection = {
    reflectionId,
    thoughtId,
    exactText,
    assistantSummary: normalizeString(input.assistantSummary),
    author: normalizeString(input.author) || actor.actorName || "Dan",
    source: normalizeString(input.source),
    sourceMode: normalizeString(input.sourceMode),
    ownerSub: actor.actorSub,
    createdAt: getNowIso(deps)
  };
  await docRef.create(reflection);
  return { reflection: { ...reflection } };
}

async function linkThinkTankOutcome(input = {}, deps = {}) {
  const thoughtId = validateDocId(input.thoughtId, "thoughtId");
  const collection = getCollection(deps, "thinkTankEntriesCollection", "Think Tank entries");
  const docRef = collection.doc(thoughtId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createThinkTankError("Think Tank entry not found", 404, "think_tank_entry_not_found", { thoughtId });
  }
  const existing = doc.data() || {};
  assertThoughtOwner(existing, deps, thoughtId);
  assertExpectedVersion(input, existing, thoughtId);
  const destinationSystem = normalizeEnum(
    input.destinationSystem,
    THINK_TANK_DESTINATIONS,
    "",
    "destination_system"
  );
  const destinationType = normalizeString(input.destinationType);
  const destinationId = normalizeString(input.destinationId);
  const verificationReference = normalizeString(input.verificationReference);
  if (!destinationType || !destinationId) {
    throw createThinkTankError(
      "destinationType and destinationId are required",
      400,
      "think_tank_destination_required"
    );
  }
  if (input.destinationVerified !== true || !verificationReference) {
    throw createThinkTankError(
      "A verified destination read-back is required before linking a Think Tank outcome",
      409,
      "think_tank_destination_not_verified"
    );
  }
  const links = Array.isArray(existing.outcomeLinks) ? existing.outcomeLinks.map((link) => ({ ...link })) : [];
  const duplicate = links.find((link) => (
    link.destinationSystem === destinationSystem &&
    link.destinationType === destinationType &&
    link.destinationId === destinationId
  ));
  if (duplicate) {
    return {
      thought: buildThoughtRecord(existing, thoughtId),
      outcomeLink: duplicate,
      duplicate: true
    };
  }
  const actor = getTaskActorFields(deps);
  const nowIso = getNowIso(deps);
  const outcomeLink = {
    destinationSystem,
    destinationType,
    destinationId,
    label: normalizeString(input.label),
    verificationReference,
    linkedAt: nowIso,
    linkedBySub: actor.actorSub,
    linkedByName: actor.actorName
  };
  links.push(outcomeLink);
  const next = {
    ...existing,
    outcomeLinks: links,
    status: input.closeThought === false ? existing.status : "closed",
    version: Math.max(1, Number(existing.version) || 1) + 1,
    updatedAt: nowIso,
    closedAt: input.closeThought === false ? (existing.closedAt || "") : (existing.closedAt || nowIso)
  };
  next.searchText = buildSearchText(next);
  await persistVersionedThought(docRef, next, input, deps, thoughtId);
  return {
    thought: buildThoughtRecord(next, thoughtId),
    outcomeLink,
    duplicate: false
  };
}

function incrementCount(map, key) {
  const normalized = normalizeString(key) || "unclassified";
  map[normalized] = (map[normalized] || 0) + 1;
}

async function buildThinkTankReview(input = {}, deps = {}) {
  const asOfDate = normalizeDate(input.asOfDate, "asOfDate", getNowIso(deps).slice(0, 10));
  const statuses = input.includeParked === true
    ? [...THINK_TANK_OPEN_STATUSES, "parked"]
    : [...THINK_TANK_OPEN_STATUSES];
  const { thoughts, sourceTruncated } = await loadOwnedThoughts({
    ...input,
    status: undefined,
    statuses
  }, deps);
  const cursor = decodeCursor(input.cursor);
  const remaining = applyCursor(thoughts, cursor);
  const limit = normalizeLimit(input.limit);
  const page = remaining.slice(0, limit);
  const moreAvailable = remaining.length > page.length;
  const groups = Object.fromEntries(statuses.map((status) => [status, []]));
  for (const thought of page) groups[thought.status].push(buildThoughtSummary(thought, thought.thoughtId, asOfDate));
  const countsByStatus = {};
  const countsByLifeArea = {};
  const countsByTopic = {};
  for (const thought of thoughts) {
    incrementCount(countsByStatus, thought.status);
    incrementCount(countsByLifeArea, thought.lifeArea);
    if (!thought.topics.length) incrementCount(countsByTopic, "unclassified");
    else thought.topics.forEach((topic) => incrementCount(countsByTopic, topic));
  }
  return {
    asOfDate,
    totalOpenCount: thoughts.length,
    returnedCount: page.length,
    groups,
    countsByStatus,
    countsByLifeArea,
    countsByTopic,
    moreAvailable,
    nextCursor: moreAvailable && page.length ? encodeCursor(page.at(-1)) : "",
    sourceTruncated,
    complete: !sourceTruncated && !moreAvailable
  };
}

module.exports = {
  LIFE_AREAS,
  THINK_TANK_DESTINATIONS,
  THINK_TANK_OPEN_STATUSES,
  THINK_TANK_STATUSES,
  appendThinkTankReflection,
  buildThinkTankReview,
  captureThinkTankEntry,
  createThinkTankError,
  getThinkTankEntry,
  linkThinkTankOutcome,
  listThinkTankEntries,
  listThinkTankReflections,
  updateThinkTankEntry
};
