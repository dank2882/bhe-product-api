"use strict";

const { createHash } = require("node:crypto");
const {
  assertCanReadTaskRecord,
  getTaskAccess,
  getTaskActorFields,
  isRecordOwner,
  isTaskAdmin
} = require("./task-management-access");
const { getDanActorFields, requireDanPrivateAccess } = require("./dan-private-access");

const PHILIPPINES_TRIP_ID = "trip-philippines-2026";
const PHILIPPINES_TRIP_PROJECT_ID = "project-philippines-2026";
const PHILIPPINES_TIME_ZONE = "Asia/Manila";
const MEMORY_CATEGORIES = Object.freeze([
  "moment",
  "ministry",
  "travel",
  "people",
  "decision",
  "lesson",
  "other"
]);
const MEMORY_PRIVACY = Object.freeze(["private_only", "needs_review", "public_ok"]);
const MEMORY_STREAMS = Object.freeze(["story", "personal_journal"]);

function createTripError(message, statusCode = 400, code = "trip_error", details = {}) {
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
  return normalizeString(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeLimit(value, fallback = 20, maximum = 100) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), maximum) : fallback;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function manilaTimestamp(value = new Date()) {
  return localTimestamp(value, PHILIPPINES_TIME_ZONE);
}

function localTimestamp(value = new Date(), timeZone = PHILIPPINES_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(safeDate).map(({ type, value: partValue }) => [type, partValue]));
  } catch (_error) {
    throw createTripError("Invalid trip time zone", 400, "invalid_trip_time_zone", { timeZone });
  }
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function hashValue(value, length = 24) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function getCollection(deps, key) {
  const collection = deps[key];
  if (!collection || typeof collection.doc !== "function") {
    throw createTripError(
      `Trip collection ${key} is not configured`,
      500,
      "trip_collection_not_configured",
      { collection: key }
    );
  }
  return collection;
}

async function requireTripProject(deps = {}, { write = false } = {}) {
  const projectsCollection = getCollection(deps, "projectsCollection");
  const document = await projectsCollection.doc(PHILIPPINES_TRIP_PROJECT_ID).get();
  if (!document.exists) {
    throw createTripError(
      "Project Philippines is not available",
      404,
      "trip_project_not_found",
      { projectId: PHILIPPINES_TRIP_PROJECT_ID }
    );
  }
  const project = { ...(document.data() || {}), projectId: PHILIPPINES_TRIP_PROJECT_ID };
  assertCanReadTaskRecord(project, deps, { projectId: PHILIPPINES_TRIP_PROJECT_ID });
  if (write && !isTaskAdmin(deps) && !isRecordOwner(project, deps)) {
    const access = getTaskAccess(deps);
    throw createTripError(
      "Only the private trip owner may change Trip Memory or Trip reference records",
      403,
      "trip_write_access_denied",
      { role: access.role, projectId: PHILIPPINES_TRIP_PROJECT_ID }
    );
  }
  return project;
}

function normalizeTripId(value) {
  const tripId = normalizeString(value) || PHILIPPINES_TRIP_ID;
  if (!/^trip-[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(tripId)) {
    throw createTripError("Invalid trip ID", 400, "invalid_trip_id", { tripId });
  }
  return tripId;
}

async function requireTripScope(deps, tripId, { write = false } = {}) {
  if (tripId === PHILIPPINES_TRIP_ID) {
    const project = await requireTripProject(deps, { write });
    return { tripId, projectId: PHILIPPINES_TRIP_PROJECT_ID, timeZone: PHILIPPINES_TIME_ZONE, actor: getTaskActorFields(deps), project };
  }
  requireDanPrivateAccess(deps);
  const tripsCollection = getCollection(deps, "travelTripsCollection");
  const document = await tripsCollection.doc(tripId).get();
  if (!document.exists) throw createTripError("Trip not found", 404, "trip_not_found", { tripId });
  const trip = document.data() || {};
  return { tripId, projectId: "", timeZone: normalizeString(trip.timeZone) || "America/Los_Angeles", actor: getDanActorFields(deps), trip };
}

function normalizeDateTime(value, fieldName) {
  const cleanValue = normalizeString(value);
  if (!cleanValue) return "";
  const date = new Date(cleanValue);
  if (Number.isNaN(date.getTime())) {
    throw createTripError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`, {
      value: cleanValue,
      expected: "ISO-8601 date/time"
    });
  }
  return date.toISOString();
}

function normalizeEnum(value, allowed, fallback, fieldName) {
  const cleanValue = normalizeString(value).toLowerCase() || fallback;
  if (!allowed.includes(cleanValue)) {
    throw createTripError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`, {
      value: cleanValue,
      allowed
    });
  }
  return cleanValue;
}

function memorySummary(memory = {}) {
  return {
    memoryId: memory.memoryId || "",
    tripId: memory.tripId || PHILIPPINES_TRIP_ID,
    exactText: memory.exactText || "",
    happenedAt: memory.happenedAt || "",
    localTimestamp: memory.localTimestamp || memory.philippineLocalTimestamp || "",
    localTimeZone: memory.localTimeZone || (memory.tripId === PHILIPPINES_TRIP_ID ? PHILIPPINES_TIME_ZONE : ""),
    philippineLocalTimestamp: memory.philippineLocalTimestamp || "",
    category: memory.category || "other",
    privacy: memory.privacy || "private_only",
    stream: memory.stream || "story",
    source: memory.source || "",
    author: memory.author || "",
    linkedRecordIds: Array.isArray(memory.linkedRecordIds) ? memory.linkedRecordIds : [],
    createdAt: memory.createdAt || "",
    updatedAt: memory.updatedAt || "",
    version: Number(memory.version || 0)
  };
}

async function saveTripMemory(input = {}, deps = {}) {
  const tripId = normalizeTripId(input.tripId);
  const scope = await requireTripScope(deps, tripId, { write: true });
  const exactText = normalizeString(input.exactText || input.body);
  const idempotencyKey = normalizeString(input.idempotencyKey);
  if (!exactText) {
    throw createTripError("Trip memory text is required", 400, "missing_trip_memory_text");
  }
  if (exactText.length > 20000) {
    throw createTripError("Trip memory text is too long", 400, "trip_memory_text_too_long");
  }
  if (idempotencyKey.length < 8) {
    throw createTripError("A stable idempotency key is required", 400, "missing_trip_memory_idempotency_key");
  }
  const category = normalizeEnum(input.category, MEMORY_CATEGORIES, "moment", "trip_memory_category");
  const stream = normalizeEnum(input.stream, MEMORY_STREAMS, "story", "trip_memory_stream");
  const privacy = normalizeEnum(input.privacy, MEMORY_PRIVACY, "private_only", "trip_memory_privacy");
  const happenedAt = normalizeDateTime(input.happenedAt, "trip_memory_happened_at");
  const source = normalizeString(input.source) || "chatgpt";
  const author = normalizeString(input.author) || "Dan";
  const linkedRecordIds = [...new Set(
    (Array.isArray(input.linkedRecordIds) ? input.linkedRecordIds : [])
      .map(normalizeString)
      .filter(Boolean)
  )].slice(0, 25);
  if (stream === "personal_journal" && privacy !== "private_only") {
    throw createTripError(
      "Personal journal entries must remain private_only",
      400,
      "personal_journal_privacy_required"
    );
  }
  if (stream === "personal_journal" && linkedRecordIds.length > 0) {
    throw createTripError(
      "Personal journal entries cannot be linked to operational or publishing records",
      400,
      "personal_journal_links_not_allowed"
    );
  }
  const idempotencyKeyHash = hashValue(idempotencyKey, 64);
  const memoryId = `trip-memory-${hashValue(`${tripId}:${idempotencyKey}`)}`;
  const memoriesCollection = getCollection(deps, "tripMemoriesCollection");
  const memoryRef = memoriesCollection.doc(memoryId);
  const existing = await memoryRef.get();
  const payloadFingerprint = hashValue(stableStringify({
    tripId,
    exactText,
    happenedAt,
    category,
    privacy,
    stream,
    source,
    author,
    linkedRecordIds
  }), 64);
  if (existing.exists) {
    const memory = existing.data() || {};
    const legacyStoryFingerprint = hashValue(stableStringify({
      tripId,
      exactText,
      happenedAt,
      category,
      privacy,
      source,
      author,
      linkedRecordIds
    }), 64);
    const isLegacyStoryReplay = stream === "story"
      && !memory.stream
      && memory.payloadFingerprint === legacyStoryFingerprint;
    if (memory.payloadFingerprint !== payloadFingerprint && !isLegacyStoryReplay) {
      throw createTripError(
        "This idempotency key was already used for a different trip memory",
        409,
        "trip_memory_idempotency_key_reused",
        { memoryId }
      );
    }
    return { memory: memorySummary(memory), idempotency: { protected: true, replayed: true } };
  }
  const nowIso = getNowIso(deps);
  const actor = scope.actor;
  const timestamp = `${localTimestamp(happenedAt || nowIso, scope.timeZone)} ${scope.timeZone}`;
  const memory = {
    memoryId,
    tripId,
    projectId: scope.projectId,
    exactText,
    happenedAt,
    localTimestamp: timestamp,
    localTimeZone: scope.timeZone,
    philippineLocalTimestamp: tripId === PHILIPPINES_TRIP_ID ? timestamp : "",
    category,
    privacy,
    stream,
    source,
    author,
    linkedRecordIds,
    ownerSub: actor.actorSub,
    ownerName: actor.actorName,
    idempotencyKeyHash,
    payloadFingerprint,
    searchText: normalizeKey([exactText, category, stream, source, author].join(" ")),
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await memoryRef.create(memory);
  return { memory: memorySummary(memory), idempotency: { protected: true, replayed: false } };
}

async function getTripMemory(input = {}, deps = {}) {
  const memoryId = normalizeString(input.memoryId);
  if (!memoryId) throw createTripError("memoryId is required", 400, "missing_trip_memory_id");
  const document = await getCollection(deps, "tripMemoriesCollection").doc(memoryId).get();
  if (!document.exists) {
    throw createTripError("Trip memory not found", 404, "trip_memory_not_found", { memoryId });
  }
  const memory = document.data() || {};
  const tripId = normalizeTripId(input.tripId || memory.tripId);
  await requireTripScope(deps, tripId);
  if (memory.tripId !== tripId) {
    throw createTripError("Trip memory does not belong to this trip", 409, "trip_memory_project_mismatch", { memoryId });
  }
  return { memory: memorySummary(memory) };
}

async function loadCollection(collection) {
  if (typeof collection.get !== "function") {
    throw createTripError("Trip collection cannot be read", 500, "trip_collection_read_unavailable");
  }
  const snapshot = await collection.get();
  return Array.isArray(snapshot?.docs)
    ? snapshot.docs.map((document) => ({ id: document.id, data: document.data() || {} }))
    : [];
}

async function searchTripMemories(input = {}, deps = {}) {
  const tripId = normalizeTripId(input.tripId);
  await requireTripScope(deps, tripId);
  const query = normalizeKey(input.query);
  const category = normalizeString(input.category).toLowerCase();
  const privacy = normalizeString(input.privacy).toLowerCase();
  const stream = normalizeString(input.stream).toLowerCase() || "story";
  const date = normalizeString(input.date);
  if (category && !MEMORY_CATEGORIES.includes(category)) {
    throw createTripError("Invalid trip memory category", 400, "invalid_trip_memory_category", { category });
  }
  if (privacy && !MEMORY_PRIVACY.includes(privacy)) {
    throw createTripError("Invalid trip memory privacy", 400, "invalid_trip_memory_privacy", { privacy });
  }
  if (!MEMORY_STREAMS.includes(stream)) {
    throw createTripError("Invalid trip memory stream", 400, "invalid_trip_memory_stream", { stream });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createTripError("Invalid trip memory date", 400, "invalid_trip_memory_date", { date });
  }
  const limit = normalizeLimit(input.limit, 20, 50);
  const records = (await loadCollection(getCollection(deps, "tripMemoriesCollection")))
    .map(({ data }) => data)
    .filter((memory) => memory.tripId === tripId)
    .filter((memory) => (memory.stream || "story") === stream)
    .filter((memory) => !query || normalizeKey(memory.searchText || memory.exactText).includes(query))
    .filter((memory) => !category || memory.category === category)
    .filter((memory) => !privacy || memory.privacy === privacy)
    .filter((memory) => !date || String(memory.localTimestamp || memory.philippineLocalTimestamp || "").startsWith(date))
    .sort((left, right) => {
      const leftTime = left.happenedAt || left.createdAt || "";
      const rightTime = right.happenedAt || right.createdAt || "";
      return rightTime.localeCompare(leftTime);
    })
    .slice(0, limit)
    .map(memorySummary);
  const byDate = {};
  for (const memory of records) {
    const localDate = String(memory.localTimestamp || memory.philippineLocalTimestamp || "").slice(0, 10) || "unknown";
    byDate[localDate] = (byDate[localDate] || 0) + 1;
  }
  return {
    tripId,
    stream,
    count: records.length,
    query,
    byDate,
    memories: records
  };
}

module.exports = {
  MEMORY_CATEGORIES,
  MEMORY_PRIVACY,
  MEMORY_STREAMS,
  PHILIPPINES_TRIP_ID,
  PHILIPPINES_TRIP_PROJECT_ID,
  getTripMemory,
  localTimestamp,
  manilaTimestamp,
  saveTripMemory,
  searchTripMemories
};
