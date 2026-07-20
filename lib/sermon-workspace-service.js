"use strict";

const { createHash, randomUUID } = require("node:crypto");

const FOLDER_TYPES = ["series", "ideas", "development", "archive"];
const FOLDER_STATUSES = ["active", "paused", "archived"];
const SERMON_STATUSES = ["idea", "developing", "draft", "ready", "preached", "archived"];
const SERMON_APPEND_TYPES = [
  "note",
  "outline",
  "application",
  "illustration",
  "question",
  "transition",
  "source_material"
];
const SERMON_SOURCE_TYPES = [
  "old_chat",
  "transcript",
  "preached_transcript",
  "cleaned_transcript",
  "youtube_caption",
  "vimeo_transcript",
  "media_audio",
  "pdf",
  "doc",
  "logos_export",
  "study_notes",
  "scripture_commentary",
  "other"
];
const SERMON_SOURCE_TYPE_ALIASES = Object.freeze({
  commentary: "scripture_commentary",
  personal_commentary: "scripture_commentary",
  scripture_note: "scripture_commentary",
  scripture_notes: "scripture_commentary"
});
const SERMON_MEDIA_TYPES = ["youtube", "vimeo", "audio", "video", "other"];
const SERMON_MEDIA_TRANSCRIPT_STATUSES = ["none", "pending", "raw_saved", "cleaned", "failed"];
const SERMON_OCCASION_STATUSES = ["planned", "preached", "cancelled"];
const DEFAULT_SERMON_TIME_ZONE = "America/Los_Angeles";
const SERMON_DEVELOPMENT_SESSION_STATUSES = ["active", "closed"];
const SERMON_DEVELOPMENT_SESSION_MODES = ["voice", "chat", "walk", "study", "imported", "other"];
const SERMON_DEVELOPMENT_TURN_SPEAKERS = ["dan", "assistant"];
const MAX_SERMON_DEVELOPMENT_TURN_LENGTH = 100000;
const SERMON_DEVELOPMENT_CHECKPOINT_TYPES = [
  "insight",
  "interpretation",
  "burden",
  "pastoral_context",
  "verbatim",
  "key_line",
  "illustration",
  "application",
  "structure",
  "decision",
  "open_question",
  "transition",
  "summary",
  "other"
];
const SERMON_MATERIAL_STATUSES = ["unplaced", "placed", "intentionally_cut"];
const PRESENTATION_ASPECT_RATIOS = ["16:9"];
const PRESENTATION_TEMPLATE_STATUSES = ["active", "archived"];
const PRESENTATION_STATUSES = ["planned", "rendered", "failed"];
const PRESENTATION_SLIDE_TYPES = [
  "title",
  "scripture",
  "big_idea",
  "section",
  "main_point",
  "quote",
  "application",
  "closing",
  "blank"
];
const PROFILE_CONFIDENCE_LEVELS = ["observed_once", "recurring", "established"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_IMPORTED_TEXT_LENGTH = 200000;
const MAX_CHUNK_TEXT_LENGTH = 1800;
const MAX_RAG_CONTEXT_CHARS = 12000;
const MAX_SERMON_IMPORT_BATCH_SIZE = 50;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-005";
const DEFAULT_PREACHING_PROFILE_ID = "default";
const SERMON_DATE_FIELDS = ["either", "preachedDate", "targetDate"];
const SERMON_SORT_ORDERS = [
  "default",
  "next_asc",
  "date_desc",
  "date_asc",
  "preached_desc",
  "preached_asc",
  "target_desc",
  "target_asc",
  "updated_desc",
  "title_asc"
];
const SERMON_CANONICAL_REPAIR_FIELDS = ["scriptureText", "bigIdea", "outline"];
const MAX_CANONICAL_REPAIR_CONTEXT_CHARS = 60000;

function createSermonWorkspaceError(message, statusCode = 400, details = {}, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  error.code = code || "sermon_workspace_error";
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

function createId(prefix, label, deps = {}) {
  const idFactory = typeof deps.randomUUID === "function" ? deps.randomUUID : randomUUID;
  return `${prefix}-${slugify(label)}-${idFactory().slice(0, 8)}`;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeEnum(value, allowedValues, fallback, fieldName) {
  const cleanValue = normalizeString(value);

  if (!cleanValue) {
    return fallback;
  }

  if (!allowedValues.includes(cleanValue)) {
    throw createSermonWorkspaceError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, value: cleanValue, allowedValues },
      `invalid_${fieldName}`
    );
  }

  return cleanValue;
}

function normalizeSermonSourceType(value, fallback = "other") {
  const cleanValue = normalizeString(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!cleanValue) return fallback;
  const canonicalValue = SERMON_SOURCE_TYPE_ALIASES[cleanValue] || cleanValue;
  if (!SERMON_SOURCE_TYPES.includes(canonicalValue)) {
    throw createSermonWorkspaceError(
      "Invalid sermon_source_type",
      400,
      { fieldName: "sermon_source_type", value: cleanValue, allowedValues: SERMON_SOURCE_TYPES },
      "invalid_sermon_source_type"
    );
  }
  return canonicalValue;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : DEFAULT_LIMIT;
}

function normalizeOptionalDate(value, fieldName) {
  const cleanValue = normalizeString(value);

  if (!cleanValue) {
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    throw createSermonWorkspaceError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, expectedFormat: "YYYY-MM-DD" },
      `invalid_${fieldName}`
    );
  }

  return cleanValue;
}

function normalizeOptionalTime(value, fieldName = "time") {
  const cleanValue = normalizeString(value).toLowerCase().replace(/\./g, "");

  if (!cleanValue) return "";

  const twelveHour = cleanValue.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] || 0);
    if (hour >= 1 && hour <= 12 && minute <= 59) {
      const normalizedHour = hour % 12 + (twelveHour[3] === "pm" ? 12 : 0);
      return `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const twentyFourHour = cleanValue.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour && Number(twentyFourHour[1]) <= 23 && Number(twentyFourHour[2]) <= 59) {
    return `${String(Number(twentyFourHour[1])).padStart(2, "0")}:${twentyFourHour[2]}`;
  }

  throw createSermonWorkspaceError(
    `Invalid ${fieldName}`,
    400,
    { fieldName, expectedFormat: "HH:MM or h:mm am/pm" },
    `invalid_${fieldName}`
  );
}

function normalizeOptionalDateTime(value, fieldName = "scheduledAt") {
  const cleanValue = normalizeString(value);
  if (!cleanValue) return "";

  const date = new Date(cleanValue);
  if (Number.isNaN(date.getTime()) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(cleanValue)) {
    throw createSermonWorkspaceError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, expectedFormat: "ISO 8601 with a UTC offset" },
      `invalid_${fieldName}`
    );
  }
  return date.toISOString();
}

function normalizeTimeZone(value, fieldName = "timeZone") {
  const cleanValue = normalizeString(value) || DEFAULT_SERMON_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: cleanValue }).format(new Date());
  } catch (_error) {
    throw createSermonWorkspaceError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, expectedFormat: "IANA time zone", value: cleanValue },
      `invalid_${fieldName}`
    );
  }
  return cleanValue;
}

function normalizeSermonDateFilters(input = {}) {
  const dateField = normalizeEnum(
    input.dateField,
    SERMON_DATE_FIELDS,
    "either",
    "sermon_date_field"
  );
  const exactDate = normalizeOptionalDate(input.date, "date");
  const dateFrom = normalizeOptionalDate(input.dateFrom, "dateFrom");
  const dateTo = normalizeOptionalDate(input.dateTo, "dateTo");
  const preachedDate = normalizeOptionalDate(input.preachedDate, "preachedDate");
  const targetDate = normalizeOptionalDate(input.targetDate, "targetDate");

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw createSermonWorkspaceError(
      "dateFrom cannot be after dateTo",
      400,
      { dateFrom, dateTo },
      "invalid_sermon_date_range"
    );
  }

  return {
    dateField,
    exactDate,
    dateFrom,
    dateTo,
    preachedDate,
    targetDate
  };
}

function getSermonDatesForField(sermon = {}, dateField = "either") {
  const occasions = Array.isArray(sermon.preachingOccasions) ? sermon.preachingOccasions : [];
  if (dateField === "preachedDate") {
    return Array.from(new Set([
      normalizeString(sermon.preachedDate),
      ...occasions.filter((occasion) => occasion.status === "preached").map((occasion) => occasion.date)
    ].filter(Boolean)));
  }
  if (dateField === "targetDate") {
    return Array.from(new Set([
      normalizeString(sermon.targetDate),
      ...occasions.filter((occasion) => occasion.status === "planned").map((occasion) => occasion.date)
    ].filter(Boolean)));
  }
  return Array.from(new Set([
    normalizeString(sermon.preachedDate),
    normalizeString(sermon.targetDate),
    ...occasions.filter((occasion) => occasion.status !== "cancelled").map((occasion) => occasion.date)
  ].filter(Boolean)));
}

function sermonMatchesDateFilters(sermon = {}, filters = {}) {
  const preachedDates = getSermonDatesForField(sermon, "preachedDate");
  const targetDates = getSermonDatesForField(sermon, "targetDate");

  if (filters.preachedDate && !preachedDates.includes(filters.preachedDate)) return false;
  if (filters.targetDate && !targetDates.includes(filters.targetDate)) return false;

  const dates = getSermonDatesForField(sermon, filters.dateField);
  if (filters.exactDate && !dates.includes(filters.exactDate)) return false;
  if ((filters.dateFrom || filters.dateTo) && !dates.some((date) => (
    (!filters.dateFrom || date >= filters.dateFrom) &&
    (!filters.dateTo || date <= filters.dateTo)
  ))) return false;

  return true;
}

function getSermonSortDate(sermon = {}, field = "either", emptyValue = "") {
  if (field === "preachedDate") return sermon.preachedDate || emptyValue;
  if (field === "targetDate") return sermon.targetDate || emptyValue;
  return sermon.preachedDate || sermon.targetDate || emptyValue;
}

function sortSermonSummaries(sermons = [], sortOrder = "default") {
  const cleanSort = normalizeEnum(
    sortOrder,
    SERMON_SORT_ORDERS,
    "default",
    "sermon_sort_order"
  );
  const items = [...sermons];

  if (cleanSort === "default" || cleanSort === "next_asc") {
    return items.sort((a, b) => {
      const dateA = a.nextOccasion?.sortKey || a.targetDate || "9999-12-31T23:59";
      const dateB = b.nextOccasion?.sortKey || b.targetDate || "9999-12-31T23:59";
      return dateA === dateB
        ? (b.updatedAt || "").localeCompare(a.updatedAt || "")
        : dateA.localeCompare(dateB);
    });
  }

  if (cleanSort === "updated_desc") {
    return items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }
  if (cleanSort === "title_asc") {
    return items.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }

  const descending = cleanSort.endsWith("_desc");
  const field = cleanSort.startsWith("preached_")
    ? "preachedDate"
    : cleanSort.startsWith("target_")
      ? "targetDate"
      : "either";

  return items.sort((a, b) => {
    const dateA = getSermonSortDate(a, field, descending ? "" : "9999-12-31");
    const dateB = getSermonSortDate(b, field, descending ? "" : "9999-12-31");
    const dateComparison = descending
      ? dateB.localeCompare(dateA)
      : dateA.localeCompare(dateB);
    return dateComparison || (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}

function validateDocId(value, fieldName) {
  const cleanValue = normalizeString(value);

  if (!cleanValue || cleanValue.includes("/")) {
    throw createSermonWorkspaceError(
      `Invalid ${fieldName}`,
      400,
      { fieldName, value: cleanValue },
      `invalid_${fieldName}`
    );
  }

  return cleanValue;
}

function getFoldersCollection({ sermonFoldersCollection } = {}) {
  if (!sermonFoldersCollection || typeof sermonFoldersCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon folders collection is not configured",
      500,
      {},
      "sermon_folders_collection_not_configured"
    );
  }

  return sermonFoldersCollection;
}

function getSermonsCollection({ sermonsCollection } = {}) {
  if (!sermonsCollection || typeof sermonsCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermons collection is not configured",
      500,
      {},
      "sermons_collection_not_configured"
    );
  }

  return sermonsCollection;
}

function getPreachingProfileCollection({ preachingProfilesCollection } = {}) {
  if (!preachingProfilesCollection || typeof preachingProfilesCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Preaching profiles collection is not configured",
      500,
      {},
      "preaching_profiles_collection_not_configured"
    );
  }

  return preachingProfilesCollection;
}

function getPreachingAnalysesCollection({ preachingAnalysesCollection } = {}) {
  if (!preachingAnalysesCollection || typeof preachingAnalysesCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Preaching analyses collection is not configured",
      500,
      {},
      "preaching_analyses_collection_not_configured"
    );
  }

  return preachingAnalysesCollection;
}

function getSermonSnapshotsCollection({ sermonSnapshotsCollection } = {}) {
  if (!sermonSnapshotsCollection || typeof sermonSnapshotsCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon snapshots collection is not configured",
      500,
      {},
      "sermon_snapshots_collection_not_configured"
    );
  }

  return sermonSnapshotsCollection;
}

function getSermonSourcesCollection({ sermonSourcesCollection } = {}) {
  if (!sermonSourcesCollection || typeof sermonSourcesCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon sources collection is not configured",
      500,
      {},
      "sermon_sources_collection_not_configured"
    );
  }

  return sermonSourcesCollection;
}

function getSermonChunksCollection({ sermonChunksCollection } = {}) {
  if (!sermonChunksCollection || typeof sermonChunksCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon chunks collection is not configured",
      500,
      {},
      "sermon_chunks_collection_not_configured"
    );
  }

  return sermonChunksCollection;
}

function getSermonMediaCollection({ sermonMediaCollection } = {}) {
  if (!sermonMediaCollection || typeof sermonMediaCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon media collection is not configured",
      500,
      {},
      "sermon_media_collection_not_configured"
    );
  }

  return sermonMediaCollection;
}

function getSermonOccasionsCollection({ sermonOccasionsCollection } = {}) {
  if (!sermonOccasionsCollection || typeof sermonOccasionsCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon occasions collection is not configured",
      500,
      {},
      "sermon_occasions_collection_not_configured"
    );
  }

  return sermonOccasionsCollection;
}

function getSermonDevelopmentSessionsCollection({ sermonDevelopmentSessionsCollection } = {}) {
  if (!sermonDevelopmentSessionsCollection || typeof sermonDevelopmentSessionsCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon development sessions collection is not configured",
      500,
      {},
      "sermon_development_sessions_collection_not_configured"
    );
  }
  return sermonDevelopmentSessionsCollection;
}

function getSermonDevelopmentCheckpointsCollection({ sermonDevelopmentCheckpointsCollection } = {}) {
  if (!sermonDevelopmentCheckpointsCollection || typeof sermonDevelopmentCheckpointsCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon development checkpoints collection is not configured",
      500,
      {},
      "sermon_development_checkpoints_collection_not_configured"
    );
  }
  return sermonDevelopmentCheckpointsCollection;
}

function getSermonDevelopmentTurnsCollection({ sermonDevelopmentTurnsCollection } = {}) {
  if (!sermonDevelopmentTurnsCollection || typeof sermonDevelopmentTurnsCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon development turns collection is not configured",
      500,
      {},
      "sermon_development_turns_collection_not_configured"
    );
  }
  return sermonDevelopmentTurnsCollection;
}

function getSermonPresentationTemplatesCollection({ sermonPresentationTemplatesCollection } = {}) {
  if (!sermonPresentationTemplatesCollection || typeof sermonPresentationTemplatesCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon presentation templates collection is not configured",
      500,
      {},
      "sermon_presentation_templates_collection_not_configured"
    );
  }

  return sermonPresentationTemplatesCollection;
}

function getSermonPresentationsCollection({ sermonPresentationsCollection } = {}) {
  if (!sermonPresentationsCollection || typeof sermonPresentationsCollection.doc !== "function") {
    throw createSermonWorkspaceError(
      "Sermon presentations collection is not configured",
      500,
      {},
      "sermon_presentations_collection_not_configured"
    );
  }

  return sermonPresentationsCollection;
}

function getRenderSermonPresentationPptxFunction({ renderSermonPresentationPptx } = {}) {
  if (typeof renderSermonPresentationPptx !== "function") {
    throw createSermonWorkspaceError(
      "Sermon presentation renderer is not configured",
      500,
      {},
      "sermon_presentation_renderer_not_configured"
    );
  }

  return renderSermonPresentationPptx;
}

function getUploadSermonPresentationPptxFunction({ uploadSermonPresentationPptx } = {}) {
  if (typeof uploadSermonPresentationPptx !== "function") {
    throw createSermonWorkspaceError(
      "Sermon presentation uploader is not configured",
      500,
      {},
      "sermon_presentation_uploader_not_configured"
    );
  }

  return uploadSermonPresentationPptx;
}

function getEmbedTextFunction({ embedText } = {}) {
  if (typeof embedText !== "function") {
    throw createSermonWorkspaceError(
      "Text embedding provider is not configured",
      500,
      {},
      "embedding_provider_not_configured"
    );
  }

  return embedText;
}

function getFindNearestChunksFunction({ findNearestChunks } = {}) {
  if (typeof findNearestChunks !== "function") {
    throw createSermonWorkspaceError(
      "Vector search provider is not configured",
      500,
      {},
      "vector_search_provider_not_configured"
    );
  }

  return findNearestChunks;
}

function getGenerateRagAnswerFunction({ generateRagAnswer } = {}) {
  if (typeof generateRagAnswer !== "function") {
    throw createSermonWorkspaceError(
      "RAG answer provider is not configured",
      500,
      {},
      "rag_answer_provider_not_configured"
    );
  }

  return generateRagAnswer;
}

function getGenerateCanonicalRepairProposalFunction({ generateCanonicalRepairProposal } = {}) {
  if (typeof generateCanonicalRepairProposal !== "function") {
    throw createSermonWorkspaceError(
      "Canonical repair proposal provider is not configured",
      500,
      {},
      "canonical_repair_provider_not_configured"
    );
  }

  return generateCanonicalRepairProposal;
}

async function loadCollection(collectionRef, maxDocs = 1000) {
  const snapshot = await collectionRef.limit(maxDocs).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() || {}
  }));
}

async function loadLightCollection(collectionRef, fields = [], maxDocs = 20000) {
  if (
    collectionRef &&
    typeof collectionRef.select === "function" &&
    typeof collectionRef.limit === "function"
  ) {
    const snapshot = await collectionRef.select(...fields).limit(maxDocs).get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() || {}
    }));
  }

  return loadCollection(collectionRef, maxDocs);
}

async function loadSermonOccasionRecords(occasionsCollection, { sermonId = "", maxDocs = 10000 } = {}) {
  const cleanSermonId = normalizeString(sermonId);

  if (
    cleanSermonId &&
    occasionsCollection &&
    typeof occasionsCollection.where === "function"
  ) {
    const snapshot = await occasionsCollection.where("sermonId", "==", cleanSermonId).limit(maxDocs).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  }

  return (await loadCollection(occasionsCollection, maxDocs))
    .filter(({ data }) => !cleanSermonId || normalizeString(data.sermonId) === cleanSermonId);
}

async function loadSermonDevelopmentRecords(
  collection,
  { sermonId = "", sessionId = "", maxDocs = 10000 } = {}
) {
  const cleanSermonId = normalizeString(sermonId);
  const cleanSessionId = normalizeString(sessionId);

  if (collection && typeof collection.where === "function") {
    let query = collection;
    if (cleanSermonId) query = query.where("sermonId", "==", cleanSermonId);
    if (cleanSessionId) query = query.where("sessionId", "==", cleanSessionId);
    const snapshot = await query.limit(maxDocs).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  }

  return (await loadCollection(collection, maxDocs))
    .filter(({ data }) => !cleanSermonId || normalizeString(data.sermonId) === cleanSermonId)
    .filter(({ data }) => !cleanSessionId || normalizeString(data.sessionId) === cleanSessionId);
}

async function loadSermonSourceRecords(
  sourcesCollection,
  { sermonId = "", folderId = "", sourceType = "", maxDocs = 10000 } = {}
) {
  const cleanSermonId = normalizeString(sermonId);
  const cleanFolderId = normalizeString(folderId);
  const cleanSourceType = normalizeString(sourceType);

  if (
    sourcesCollection &&
    typeof sourcesCollection.where === "function" &&
    typeof sourcesCollection.limit === "function"
  ) {
    let query = sourcesCollection;

    if (cleanSermonId) {
      query = query.where("sermonId", "==", cleanSermonId);
    }

    if (cleanFolderId) {
      query = query.where("folderId", "==", cleanFolderId);
    }

    if (cleanSourceType) {
      query = query.where("sourceType", "==", cleanSourceType);
    }

    const snapshot = await query.limit(maxDocs).get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() || {}
    }));
  }

  return (await loadCollection(sourcesCollection, maxDocs))
    .filter(({ data }) => !cleanSermonId || normalizeString(data.sermonId) === cleanSermonId)
    .filter(({ data }) => !cleanFolderId || normalizeString(data.folderId) === cleanFolderId)
    .filter(({ data }) => !cleanSourceType || normalizeString(data.sourceType || "other") === cleanSourceType);
}

function incrementCount(map, key) {
  const cleanKey = normalizeString(key) || "";
  map.set(cleanKey, (map.get(cleanKey) || 0) + 1);
}

function countMapToObject(map) {
  return Object.fromEntries(Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right)));
}

function getStatsHaystack(record = {}) {
  return [
    record.sermonId,
    record.folderId,
    record.title,
    record.status,
    record.scriptureText,
    record.bigIdea,
    record.occasion,
    record.notes,
    record.outline,
    record.sourceId,
    record.sourceType,
    record.sourceLabel,
    record.summary,
    record.searchText,
    record.sourceKind,
    record.chunkType,
    record.text
  ].map(normalizeString).join(" ").toLowerCase();
}

function recordMatchesStatsQuery(record = {}, query = "") {
  const cleanQuery = normalizeString(query).toLowerCase();
  return !cleanQuery || getStatsHaystack(record).includes(cleanQuery);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scriptureTextMatchesBook(scriptureText = "", scriptureBook = "") {
  const cleanText = normalizeString(scriptureText).toLowerCase();
  const cleanBook = normalizeString(scriptureBook).toLowerCase();
  if (!cleanText || !cleanBook) return false;

  const bookPattern = cleanBook.split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(^|[^a-z])${bookPattern}([^a-z]|$)`, "i").test(cleanText);
}

function buildStatsSample(record = {}, id = "") {
  return {
    id,
    sermonId: normalizeString(record.sermonId),
    sourceId: normalizeString(record.sourceId),
    title: normalizeString(record.title || record.sourceLabel),
    scriptureText: normalizeString(record.scriptureText),
    preachedDate: normalizeString(record.preachedDate),
    status: normalizeString(record.status),
    sourceType: normalizeString(record.sourceType),
    folderId: normalizeString(record.folderId)
  };
}

function buildFolderSearchText(folder = {}) {
  return [
    folder.folderId,
    folder.name,
    folder.folderType,
    folder.status,
    folder.description,
    folder.scriptureScope,
    folder.notes
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildFolderNameSignature(value = "") {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "in",
    "my",
    "of",
    "our",
    "series",
    "the",
    "to",
    "your"
  ]);

  return normalizeString(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token))
    .join(" ");
}

function normalizeSeriesSlug(value = "") {
  return slugify(value).replace(/-+$/, "");
}

function normalizeSeriesNumber(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(normalizeString).filter(Boolean)));
  }

  const cleanValue = normalizeString(value);
  return cleanValue
    ? Array.from(new Set(cleanValue.split(",").map(normalizeString).filter(Boolean)))
    : [];
}

function buildSeriesMetadata(input = {}, fallback = {}) {
  const seriesInput = isPlainObject(input.series) ? input.series : {};
  const fallbackSeries = isPlainObject(fallback.series) ? fallback.series : {};
  const seriesTitle = normalizeString(
    input.seriesTitle || seriesInput.title || fallback.seriesTitle || fallbackSeries.title
  );
  const seriesSlug = normalizeString(
    input.seriesSlug || seriesInput.slug || fallback.seriesSlug || fallbackSeries.slug
  ) || (seriesTitle ? normalizeSeriesSlug(seriesTitle) : "");
  const seriesId = normalizeString(
    input.seriesId || seriesInput.seriesId || seriesInput.id || fallback.seriesId || fallbackSeries.seriesId || fallbackSeries.id
  ) || (seriesSlug ? `series-${seriesSlug}` : "");
  const seriesNumber = normalizeSeriesNumber(
    input.seriesNumber ?? seriesInput.number ?? fallback.seriesNumber ?? fallbackSeries.number
  );

  return {
    seriesId,
    seriesTitle,
    seriesSlug,
    seriesNumber,
    series: {
      seriesId,
      title: seriesTitle,
      slug: seriesSlug,
      number: seriesNumber
    }
  };
}

function buildSermonOccasionId(sermonId, occasion = {}) {
  const signature = [
    normalizeString(sermonId),
    normalizeString(occasion.date),
    normalizeString(occasion.time),
    normalizeString(occasion.venue).toLowerCase(),
    normalizeString(occasion.service).toLowerCase()
  ].join("\u0000");
  return `sermon-occasion-${createHash("sha256").update(signature).digest("hex").slice(0, 32)}`;
}

function buildOccasionSortKey(occasion = {}) {
  const date = normalizeString(occasion.date);
  return date ? `${date}T${normalizeString(occasion.time) || "23:59"}` : "";
}

function buildSermonOccasionSearchText(occasion = {}) {
  return [
    occasion.occasionId,
    occasion.sermonId,
    occasion.status,
    occasion.date,
    occasion.time,
    occasion.timeZone,
    occasion.scheduledAt,
    occasion.venue,
    occasion.service,
    occasion.notes
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildSermonOccasionAggregateText(sermon = {}) {
  return [
    sermon.occasion,
    ...(Array.isArray(sermon.preachingOccasions)
      ? sermon.preachingOccasions.map(buildSermonOccasionSearchText)
      : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildSermonOccasionSummary(occasion = {}, fallbackId = "") {
  return {
    occasionId: normalizeString(occasion.occasionId || fallbackId),
    sermonId: normalizeString(occasion.sermonId),
    status: normalizeString(occasion.status) || "planned",
    date: normalizeString(occasion.date),
    time: normalizeString(occasion.time),
    timeZone: normalizeString(occasion.timeZone) || DEFAULT_SERMON_TIME_ZONE,
    scheduledAt: normalizeString(occasion.scheduledAt),
    venue: normalizeString(occasion.venue),
    service: normalizeString(occasion.service),
    notes: normalizeString(occasion.notes),
    sortKey: normalizeString(occasion.sortKey) || buildOccasionSortKey(occasion),
    createdAt: normalizeString(occasion.createdAt),
    updatedAt: normalizeString(occasion.updatedAt)
  };
}

function isScheduledSermonPlaceholder(sermon = {}, occasion = null) {
  const hasSubstantiveContent = [
    sermon.scriptureText,
    sermon.bigIdea,
    sermon.outline,
    sermon.notes,
    sermon.seriesId,
    sermon.seriesTitle,
    sermon.seriesSlug,
    sermon.primaryManuscriptSourceId
  ].some((value) => Boolean(normalizeString(value))) ||
    (Array.isArray(sermon.developmentNotes) && sermon.developmentNotes.length > 0) ||
    (Array.isArray(sermon.sourceRefs) && sermon.sourceRefs.length > 0);

  if (hasSubstantiveContent) return false;

  const title = normalizeString(sermon.title).toLowerCase();
  const service = normalizeString(occasion?.service).toLowerCase();
  const date = normalizeString(occasion?.date);
  return !title ||
    title.includes("placeholder") ||
    (service && title.includes(service)) ||
    (date && title.includes(date)) ||
    /^(sunday|wednesday|midweek|morning|evening|night)\b/.test(title);
}

function normalizeSermonOccasion(input = {}, fallback = {}) {
  const schedulePartsChanged = Object.prototype.hasOwnProperty.call(input, "date") ||
    Object.prototype.hasOwnProperty.call(input, "time") ||
    Object.prototype.hasOwnProperty.call(input, "timeZone");
  const rawScheduledAt = Object.prototype.hasOwnProperty.call(input, "scheduledAt")
    ? normalizeString(input.scheduledAt)
    : (schedulePartsChanged ? "" : normalizeString(fallback.scheduledAt));
  const scheduledAt = normalizeOptionalDateTime(rawScheduledAt, "scheduledAt");
  const scheduledDate = rawScheduledAt ? rawScheduledAt.slice(0, 10) : "";
  const scheduledTimeMatch = rawScheduledAt.match(/T(\d{2}):(\d{2})/);
  const scheduledTime = scheduledTimeMatch ? `${scheduledTimeMatch[1]}:${scheduledTimeMatch[2]}` : "";
  const date = normalizeOptionalDate(input.date || fallback.date || scheduledDate, "occasionDate");
  const time = normalizeOptionalTime(input.time || fallback.time || scheduledTime, "occasionTime");

  if (!date) {
    throw createSermonWorkspaceError(
      "Sermon occasion requires a date",
      400,
      {},
      "missing_sermon_occasion_date"
    );
  }

  const occasion = {
    sermonId: normalizeString(input.sermonId || fallback.sermonId),
    status: normalizeEnum(
      input.status,
      SERMON_OCCASION_STATUSES,
      normalizeString(fallback.status) || "planned",
      "sermon_occasion_status"
    ),
    date,
    time,
    timeZone: normalizeTimeZone(input.timeZone || fallback.timeZone),
    scheduledAt,
    venue: normalizeString(Object.prototype.hasOwnProperty.call(input, "venue") ? input.venue : fallback.venue),
    service: normalizeString(Object.prototype.hasOwnProperty.call(input, "service") ? input.service : fallback.service),
    notes: normalizeString(Object.prototype.hasOwnProperty.call(input, "notes") ? input.notes : fallback.notes),
    sourceRefs: normalizeSourceRefs(
      Object.prototype.hasOwnProperty.call(input, "sourceRefs") ? input.sourceRefs : fallback.sourceRefs
    ),
    mediaIds: Array.isArray(input.mediaIds)
      ? Array.from(new Set(input.mediaIds.map(normalizeString).filter(Boolean)))
      : (Array.isArray(fallback.mediaIds) ? [...fallback.mediaIds] : [])
  };
  occasion.sortKey = buildOccasionSortKey(occasion);
  occasion.searchText = buildSermonOccasionSearchText(occasion);
  return occasion;
}

function getLocalNowKey(nowIso, timeZone) {
  const date = new Date(nowIso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function isUpcomingSermonOccasion(occasion = {}, nowIso = new Date().toISOString()) {
  if (normalizeString(occasion.status) !== "planned") return false;
  if (occasion.scheduledAt) return new Date(occasion.scheduledAt).getTime() >= new Date(nowIso).getTime();

  const occasionKey = buildOccasionSortKey(occasion);
  if (!occasionKey) return false;
  const localNowKey = getLocalNowKey(nowIso, occasion.timeZone || DEFAULT_SERMON_TIME_ZONE);
  return occasion.time ? occasionKey >= localNowKey : occasion.date >= localNowKey.slice(0, 10);
}

function isLegacyTargetDateUpcoming(sermon = {}, nowIso = new Date().toISOString()) {
  const targetDate = normalizeString(sermon.targetDate);
  if (!targetDate) return false;
  return targetDate >= getLocalNowKey(nowIso, DEFAULT_SERMON_TIME_ZONE).slice(0, 10);
}

function sortSermonOccasions(occasions = []) {
  return [...occasions].sort((left, right) =>
    (left.sortKey || "9999-12-31T23:59").localeCompare(right.sortKey || "9999-12-31T23:59") ||
    (left.occasionId || "").localeCompare(right.occasionId || "")
  );
}

function selectNextSermonOccasion(occasions = [], nowIso = new Date().toISOString()) {
  return sortSermonOccasions(occasions.filter((occasion) => isUpcomingSermonOccasion(occasion, nowIso)))[0] || null;
}

function selectLatestPreachedOccasion(occasions = []) {
  return [...occasions]
    .filter((occasion) => occasion.status === "preached")
    .sort((left, right) => (right.sortKey || "").localeCompare(left.sortKey || ""))[0] || null;
}

function groupSermonOccasions(records = []) {
  const grouped = new Map();
  for (const { id, data } of records) {
    const occasion = buildSermonOccasionSummary(data, id);
    if (!occasion.sermonId) continue;
    const existing = grouped.get(occasion.sermonId) || [];
    existing.push(occasion);
    grouped.set(occasion.sermonId, existing);
  }
  for (const [sermonId, occasions] of grouped) {
    grouped.set(sermonId, sortSermonOccasions(occasions));
  }
  return grouped;
}

function enrichSermonWithOccasions(sermon = {}, occasions = [], nowIso = new Date().toISOString()) {
  const preachingOccasions = sortSermonOccasions(occasions);
  return {
    ...sermon,
    preachingOccasions,
    occasionCount: preachingOccasions.length,
    nextOccasion: selectNextSermonOccasion(preachingOccasions, nowIso),
    latestPreachedOccasion: selectLatestPreachedOccasion(preachingOccasions)
  };
}

function findMatchingFolderRecord(records = [], input = {}) {
  const name = normalizeString(input.name);
  const folderType = normalizeEnum(input.folderType, FOLDER_TYPES, "series", "folder_type");
  const cleanName = name.toLowerCase();
  const nameSignature = buildFolderNameSignature(name);

  if (!cleanName) {
    return null;
  }

  return records.find(({ data }) => {
    const recordFolderType = normalizeString(data.folderType || "series");

    if (folderType && recordFolderType !== folderType) {
      return false;
    }

    const recordName = normalizeString(data.name).toLowerCase();
    const recordSignature = buildFolderNameSignature(data.name);

    return recordName === cleanName ||
      (nameSignature && recordSignature && recordSignature === nameSignature);
  }) || null;
}

function buildSermonSearchText(sermon = {}) {
  return [
    sermon.sermonId,
    sermon.folderId,
    sermon.primaryManuscriptSourceId,
    sermon.seriesId,
    sermon.seriesTitle,
    sermon.seriesSlug,
    sermon.seriesNumber,
    ...(Array.isArray(sermon.tags) ? sermon.tags : []),
    sermon.title,
    sermon.status,
    sermon.scriptureText,
    sermon.bigIdea,
    sermon.occasion,
    sermon.notes,
    sermon.outline,
    ...(Array.isArray(sermon.preachingOccasions)
      ? sermon.preachingOccasions.map(buildSermonOccasionSearchText)
      : []),
    ...(Array.isArray(sermon.developmentNotes)
      ? sermon.developmentNotes.map((note) => note.content)
      : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildSermonSourceSearchText(source = {}) {
  return [
    source.sourceId,
    source.sermonId,
    source.folderId,
    source.seriesId,
    source.seriesTitle,
    source.seriesSlug,
    source.seriesNumber,
    ...(Array.isArray(source.tags) ? source.tags : []),
    source.sourceType,
    source.sourceLabel,
    source.summary,
    source.material,
    ...(Array.isArray(source.sourceRefs)
      ? source.sourceRefs.map((ref) => JSON.stringify(ref))
      : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildSermonMediaSearchText(media = {}) {
  return [
    media.mediaId,
    media.sermonId,
    media.occasionId,
    media.folderId,
    media.seriesId,
    media.seriesTitle,
    media.seriesSlug,
    media.seriesNumber,
    ...(Array.isArray(media.tags) ? media.tags : []),
    media.mediaType,
    media.platform,
    media.externalId,
    media.startSeconds,
    media.endSeconds,
    media.url,
    media.storagePath,
    media.originalFilename,
    media.title,
    media.label,
    media.recordedAt,
    media.transcriptStatus,
    media.notes,
    ...(Array.isArray(media.sourceRefs)
      ? media.sourceRefs.map((ref) => JSON.stringify(ref))
      : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildSermonChunkSearchText(chunk = {}) {
  return [
    chunk.chunkId,
    chunk.sourceKind,
    chunk.sermonId,
    chunk.folderId,
    chunk.seriesId,
    chunk.seriesTitle,
    chunk.seriesSlug,
    chunk.seriesNumber,
    ...(Array.isArray(chunk.tags) ? chunk.tags : []),
    chunk.sourceId,
    chunk.analysisId,
    chunk.chunkType,
    chunk.title,
    chunk.scriptureText,
    chunk.text
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildFolderSummary(folder = {}, fallbackId = "") {
  return {
    folderId: folder.folderId || fallbackId,
    name: folder.name || "",
    folderType: folder.folderType || "series",
    status: folder.status || "active",
    description: folder.description || "",
    scriptureScope: folder.scriptureScope || "",
    notes: folder.notes || "",
    createdAt: folder.createdAt || "",
    updatedAt: folder.updatedAt || ""
  };
}

function buildSermonSummary(sermon = {}, fallbackId = "") {
  const series = buildSeriesMetadata({}, sermon);
  return {
    sermonId: sermon.sermonId || fallbackId,
    folderId: sermon.folderId || "",
    primaryManuscriptSourceId: sermon.primaryManuscriptSourceId || "",
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    seriesNumber: series.seriesNumber,
    series: series.series,
    tags: normalizeTags(sermon.tags),
    title: sermon.title || "",
    status: sermon.status || "idea",
    scriptureText: sermon.scriptureText || "",
    bigIdea: sermon.bigIdea || "",
    targetDate: sermon.targetDate || "",
    preachedDate: sermon.preachedDate || "",
    occasion: sermon.occasion || "",
    occasionCount: Number.isFinite(Number(sermon.occasionCount))
      ? Number(sermon.occasionCount)
      : (Array.isArray(sermon.preachingOccasions) ? sermon.preachingOccasions.length : 0),
    nextOccasion: isPlainObject(sermon.nextOccasion) ? buildSermonOccasionSummary(sermon.nextOccasion) : null,
    latestPreachedOccasion: isPlainObject(sermon.latestPreachedOccasion)
      ? buildSermonOccasionSummary(sermon.latestPreachedOccasion)
      : null,
    notes: sermon.notes || "",
    outline: sermon.outline || "",
    createdAt: sermon.createdAt || "",
    updatedAt: sermon.updatedAt || ""
  };
}

function buildSermonDetail(sermon = {}, fallbackId = "") {
  return {
    ...buildSermonSummary(sermon, fallbackId),
    preachingOccasions: Array.isArray(sermon.preachingOccasions)
      ? sermon.preachingOccasions.map((occasion) => buildSermonOccasionSummary(occasion))
      : [],
    developmentNotes: Array.isArray(sermon.developmentNotes) ? sermon.developmentNotes : [],
    sourceRefs: Array.isArray(sermon.sourceRefs) ? sermon.sourceRefs : []
  };
}

function buildSermonListSummary(sermon = {}, fallbackId = "") {
  const summary = buildSermonSummary(sermon, fallbackId);
  return {
    sermonId: summary.sermonId,
    folderId: summary.folderId,
    primaryManuscriptSourceId: summary.primaryManuscriptSourceId,
    seriesId: summary.seriesId,
    seriesTitle: summary.seriesTitle,
    seriesSlug: summary.seriesSlug,
    seriesNumber: summary.seriesNumber,
    tags: summary.tags,
    title: summary.title,
    status: summary.status,
    scriptureText: summary.scriptureText,
    bigIdea: summary.bigIdea,
    targetDate: summary.targetDate,
    preachedDate: summary.preachedDate,
    occasion: summary.occasion,
    occasionCount: summary.occasionCount,
    nextOccasion: summary.nextOccasion,
    latestPreachedOccasion: summary.latestPreachedOccasion,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt
  };
}

function buildSermonSnapshotSummary(snapshot = {}, fallbackId = "") {
  const sermon = isPlainObject(snapshot.sermon) ? snapshot.sermon : {};

  return {
    snapshotId: snapshot.snapshotId || fallbackId,
    sermonId: snapshot.sermonId || sermon.sermonId || "",
    snapshotType: snapshot.snapshotType || "manual",
    reason: snapshot.reason || "",
    createdAt: snapshot.createdAt || "",
    sermonTitle: sermon.title || "",
    sermonStatus: sermon.status || "",
    sermonUpdatedAt: sermon.updatedAt || ""
  };
}

function buildSermonSnapshotDetail(snapshot = {}, fallbackId = "") {
  return {
    ...buildSermonSnapshotSummary(snapshot, fallbackId),
    sermon: isPlainObject(snapshot.sermon) ? snapshot.sermon : {}
  };
}

function buildSermonSourceSummary(source = {}, fallbackId = "") {
  const series = buildSeriesMetadata({}, source);
  return {
    sourceId: source.sourceId || fallbackId,
    sermonId: source.sermonId || "",
    folderId: source.folderId || "",
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    seriesNumber: series.seriesNumber,
    series: series.series,
    tags: normalizeTags(source.tags),
    sourceType: source.sourceType || "other",
    sourceLabel: source.sourceLabel || "",
    summary: source.summary || "",
    createdAt: source.createdAt || "",
    updatedAt: source.updatedAt || ""
  };
}

function buildSermonSourceDetail(source = {}, fallbackId = "") {
  return {
    ...buildSermonSourceSummary(source, fallbackId),
    material: source.material || "",
    sourceRefs: Array.isArray(source.sourceRefs) ? source.sourceRefs : []
  };
}

function getSermonSourceArtifactRef(source = {}) {
  return (Array.isArray(source.sourceRefs) ? source.sourceRefs : []).find((sourceRef) =>
    isPlainObject(sourceRef) &&
    normalizeString(sourceRef.role) === "manuscript_draft" &&
    normalizeString(sourceRef.storagePath) &&
    (
      normalizeString(sourceRef.type) === "cloud_storage_docx" ||
      normalizeString(sourceRef.contentType) === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ));
}

async function addSermonSourceArtifactDownload(source, deps = {}) {
  const artifactRef = getSermonSourceArtifactRef(source);
  if (!artifactRef || typeof deps.createSermonSourceDownload !== "function") {
    return { source };
  }

  const signed = await deps.createSermonSourceDownload({ source, sourceRef: artifactRef });
  const downloadUrl = normalizeString(signed?.downloadUrl);
  if (!downloadUrl) return { source };

  const download = {
    filename: normalizeString(signed.filename || artifactRef.filename),
    storagePath: normalizeString(signed.storagePath || artifactRef.storagePath),
    contentType: normalizeString(signed.contentType || artifactRef.contentType),
    sizeBytes: Number.isFinite(Number(signed.sizeBytes || artifactRef.sizeBytes))
      ? Number(signed.sizeBytes || artifactRef.sizeBytes)
      : 0,
    downloadUrl,
    downloadUrlExpiresAt: normalizeString(signed.downloadUrlExpiresAt || signed.expiresAt)
  };
  const sourceRefs = source.sourceRefs.map((sourceRef) =>
    sourceRef === artifactRef
      ? {
          ...sourceRef,
          downloadUrl: download.downloadUrl,
          downloadUrlExpiresAt: download.downloadUrlExpiresAt
        }
      : sourceRef);

  return {
    source: {
      ...source,
      sourceRefs,
      filename: download.filename,
      downloadUrl: download.downloadUrl,
      downloadUrlExpiresAt: download.downloadUrlExpiresAt
    },
    download,
    filename: download.filename,
    downloadUrl: download.downloadUrl,
    downloadUrlExpiresAt: download.downloadUrlExpiresAt
  };
}

function buildSermonDevelopmentSessionSummary(session = {}, fallbackId = "") {
  return {
    sessionId: normalizeString(session.sessionId || fallbackId),
    sermonId: normalizeString(session.sermonId),
    status: normalizeString(session.status) || "active",
    mode: normalizeString(session.mode) || "other",
    label: normalizeString(session.label),
    context: normalizeString(session.context),
    summary: normalizeString(session.summary),
    rawTranscriptSourceId: normalizeString(session.rawTranscriptSourceId),
    turnCount: Number.isFinite(Number(session.turnCount)) ? Number(session.turnCount) : 0,
    danTurnCount: Number.isFinite(Number(session.danTurnCount)) ? Number(session.danTurnCount) : 0,
    assistantTurnCount: Number.isFinite(Number(session.assistantTurnCount)) ? Number(session.assistantTurnCount) : 0,
    checkpointCount: Number.isFinite(Number(session.checkpointCount)) ? Number(session.checkpointCount) : 0,
    startedAt: normalizeString(session.startedAt || session.createdAt),
    endedAt: normalizeString(session.endedAt),
    createdAt: normalizeString(session.createdAt),
    updatedAt: normalizeString(session.updatedAt)
  };
}

function buildSermonDevelopmentTurn(turn = {}, fallbackId = "") {
  return {
    turnId: normalizeString(turn.turnId || fallbackId),
    sermonId: normalizeString(turn.sermonId),
    sessionId: normalizeString(turn.sessionId),
    speaker: normalizeString(turn.speaker) || "dan",
    sequence: Number.isFinite(Number(turn.sequence)) ? Number(turn.sequence) : 0,
    transcript: typeof turn.transcript === "string" ? turn.transcript : "",
    transcriptSha256: normalizeString(turn.transcriptSha256),
    checkpointIds: normalizeStringArray(turn.checkpointIds),
    sourceMode: normalizeString(turn.sourceMode),
    createdAt: normalizeString(turn.createdAt),
    updatedAt: normalizeString(turn.updatedAt)
  };
}

function buildSermonDevelopmentCheckpoint(checkpoint = {}, fallbackId = "") {
  const requestedCanonicalTargets = normalizeStringArray(checkpoint.canonicalTargets);
  const materialStatus = SERMON_MATERIAL_STATUSES.includes(checkpoint.materialStatus)
    ? checkpoint.materialStatus
    : requestedCanonicalTargets.length > 0
      ? "placed"
      : "unplaced";
  const canonicalTargets = materialStatus === "placed" ? requestedCanonicalTargets : [];
  return {
    checkpointId: normalizeString(checkpoint.checkpointId || fallbackId),
    sermonId: normalizeString(checkpoint.sermonId),
    sessionId: normalizeString(checkpoint.sessionId),
    checkpointType: normalizeString(checkpoint.checkpointType) || "insight",
    heading: normalizeString(checkpoint.heading),
    content: normalizeString(checkpoint.content),
    context: normalizeString(checkpoint.context),
    exactWording: checkpoint.exactWording === true || ["verbatim", "key_line"].includes(checkpoint.checkpointType),
    canonicalTargets,
    materialStatus,
    placementTarget: normalizeString(checkpoint.placementTarget),
    placementNotes: normalizeString(checkpoint.placementNotes),
    cutReason: normalizeString(checkpoint.cutReason),
    cutAuthorizedBy: normalizeString(checkpoint.cutAuthorizedBy),
    cutApprovalEvidence: normalizeString(checkpoint.cutApprovalEvidence),
    cutAuthorizedAt: normalizeString(checkpoint.cutAuthorizedAt),
    materialStatusHistory: Array.isArray(checkpoint.materialStatusHistory)
      ? checkpoint.materialStatusHistory.filter(isPlainObject).map(clone)
      : [],
    materialStatusChangedAt: normalizeString(checkpoint.materialStatusChangedAt),
    sourceRefs: normalizeSourceRefs(checkpoint.sourceRefs),
    createdAt: normalizeString(checkpoint.createdAt),
    updatedAt: normalizeString(checkpoint.updatedAt)
  };
}

function buildSermonMaterialFingerprint(checkpoints = []) {
  const material = checkpoints
    .map((checkpoint) => buildSermonDevelopmentCheckpoint(checkpoint, checkpoint.checkpointId))
    .sort((left, right) => left.checkpointId.localeCompare(right.checkpointId))
    .map((checkpoint) => ({
      checkpointId: checkpoint.checkpointId,
      checkpointType: checkpoint.checkpointType,
      heading: checkpoint.heading,
      content: checkpoint.content,
      canonicalTargets: [...checkpoint.canonicalTargets].sort(),
      materialStatus: checkpoint.materialStatus,
      placementTarget: checkpoint.placementTarget,
      placementNotes: checkpoint.placementNotes,
      cutReason: checkpoint.cutReason
    }));

  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function buildSermonMediaSummary(media = {}, fallbackId = "") {
  const series = buildSeriesMetadata({}, media);
  return {
    mediaId: media.mediaId || fallbackId,
    sermonId: media.sermonId || "",
    occasionId: media.occasionId || "",
    folderId: media.folderId || "",
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    seriesNumber: series.seriesNumber,
    series: series.series,
    tags: normalizeTags(media.tags),
    mediaType: media.mediaType || "other",
    title: media.title || "",
    label: media.label || "",
    platform: media.platform || "",
    externalId: media.externalId || "",
    url: media.url || "",
    storagePath: media.storagePath || "",
    originalFilename: media.originalFilename || "",
    contentType: media.contentType || "",
    startSeconds: typeof media.startSeconds === "number" ? media.startSeconds : 0,
    endSeconds: typeof media.endSeconds === "number" ? media.endSeconds : 0,
    durationSeconds: typeof media.durationSeconds === "number" ? media.durationSeconds : 0,
    recordedAt: media.recordedAt || "",
    transcriptStatus: media.transcriptStatus || "none",
    createdAt: media.createdAt || "",
    updatedAt: media.updatedAt || ""
  };
}

function buildSermonMediaDetail(media = {}, fallbackId = "") {
  return {
    ...buildSermonMediaSummary(media, fallbackId),
    transcriptSourceIds: isPlainObject(media.transcriptSourceIds) ? media.transcriptSourceIds : {},
    sourceRefs: Array.isArray(media.sourceRefs) ? media.sourceRefs : [],
    notes: media.notes || ""
  };
}

function buildPresentationTemplateSearchText(template = {}) {
  return [
    template.templateId,
    template.seriesId,
    template.seriesTitle,
    template.seriesSlug,
    template.name,
    template.status,
    template.aspectRatio,
    template.description,
    JSON.stringify(template.theme || {}),
    JSON.stringify(template.layouts || {})
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildPresentationSearchText(presentation = {}) {
  return [
    presentation.presentationId,
    presentation.sermonId,
    presentation.seriesId,
    presentation.seriesTitle,
    presentation.seriesSlug,
    presentation.templateId,
    presentation.title,
    presentation.status,
    presentation.aspectRatio,
    presentation.filename,
    presentation.storagePath,
    JSON.stringify(presentation.slidePlan || {})
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildPresentationTemplateSummary(template = {}, fallbackId = "") {
  const series = buildSeriesMetadata({}, template);
  return {
    templateId: template.templateId || fallbackId,
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    series: series.series,
    name: template.name || "",
    description: template.description || "",
    aspectRatio: template.aspectRatio || "16:9",
    status: template.status || "active",
    version: Number.isFinite(Number(template.version)) ? Number(template.version) : 1,
    createdFromPresentationId: template.createdFromPresentationId || "",
    sourceStoragePath: template.sourceStoragePath || "",
    sourceFilename: template.sourceFilename || "",
    sourceContentType: template.sourceContentType || "",
    sourceSizeBytes: Number.isFinite(Number(template.sourceSizeBytes)) ? Number(template.sourceSizeBytes) : 0,
    sourceChecksumSha256: template.sourceChecksumSha256 || "",
    importedAt: template.importedAt || "",
    createdAt: template.createdAt || "",
    updatedAt: template.updatedAt || ""
  };
}

function buildPresentationTemplateDetail(template = {}, fallbackId = "") {
  return {
    ...buildPresentationTemplateSummary(template, fallbackId),
    theme: isPlainObject(template.theme) ? clone(template.theme) : buildDefaultPresentationTheme(template.seriesTitle),
    layouts: isPlainObject(template.layouts) ? clone(template.layouts) : buildDefaultPresentationLayouts()
  };
}

function buildPresentationSummary(presentation = {}, fallbackId = "") {
  const series = buildSeriesMetadata({}, presentation);
  return {
    presentationId: presentation.presentationId || fallbackId,
    sermonId: presentation.sermonId || "",
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    series: series.series,
    templateId: presentation.templateId || "",
    title: presentation.title || "",
    status: presentation.status || "planned",
    aspectRatio: presentation.aspectRatio || "16:9",
    format: presentation.format || "pptx",
    slideCount: Number.isFinite(Number(presentation.slideCount)) ? Number(presentation.slideCount) : 0,
    filename: presentation.filename || "",
    storagePath: presentation.storagePath || "",
    contentType: presentation.contentType || "",
    sizeBytes: Number.isFinite(Number(presentation.sizeBytes)) ? Number(presentation.sizeBytes) : 0,
    downloadUrl: presentation.downloadUrl || "",
    downloadUrlExpiresAt: presentation.downloadUrlExpiresAt || "",
    materialFingerprint: presentation.materialFingerprint || "",
    placedMaterialCount: Number(presentation.placedMaterialCount) || 0,
    createdAt: presentation.createdAt || "",
    updatedAt: presentation.updatedAt || ""
  };
}

function buildPresentationDetail(presentation = {}, fallbackId = "") {
  return {
    ...buildPresentationSummary(presentation, fallbackId),
    slidePlan: isPlainObject(presentation.slidePlan) ? clone(presentation.slidePlan) : { slides: [] },
    renderError: presentation.renderError || ""
  };
}

function buildCompactPresentationResponse(response = {}) {
  const presentation = response.presentation || {};
  const template = response.template || {};
  return {
    presentation: {
      presentationId: presentation.presentationId || "",
      sermonId: presentation.sermonId || "",
      templateId: presentation.templateId || "",
      title: presentation.title || "",
      status: presentation.status || "",
      aspectRatio: presentation.aspectRatio || "16:9",
      slideCount: Number.isFinite(Number(presentation.slideCount)) ? Number(presentation.slideCount) : 0,
      filename: presentation.filename || "",
      downloadUrl: presentation.downloadUrl || "",
      downloadUrlExpiresAt: presentation.downloadUrlExpiresAt || "",
      materialFingerprint: presentation.materialFingerprint || "",
      placedMaterialCount: Number(presentation.placedMaterialCount) || 0
    },
    template: {
      templateId: template.templateId || presentation.templateId || "",
      name: template.name || "",
      seriesId: template.seriesId || "",
      seriesTitle: template.seriesTitle || "",
      aspectRatio: template.aspectRatio || "16:9"
    }
  };
}

function buildDefaultPresentationTheme(seriesTitle = "") {
  return {
    name: normalizeString(seriesTitle) || "Default Sermon Slides",
    fonts: {
      heading: "Aptos Display",
      body: "Aptos"
    },
    colors: {
      background: "101820",
      surface: "17212B",
      primary: "F2C14E",
      text: "FFFFFF",
      muted: "D8DEE9",
      accent: "7FB069"
    }
  };
}

function buildDefaultPresentationLayouts() {
  return {
    title: { titleSize: 44, subtitleSize: 22 },
    scripture: { referenceSize: 26, textSize: 30 },
    big_idea: { headingSize: 24, bodySize: 34 },
    section: { headingSize: 40, bodySize: 24 },
    main_point: { headingSize: 34, bodySize: 26 },
    quote: { bodySize: 32, citationSize: 20 },
    application: { headingSize: 32, bodySize: 26 },
    closing: { headingSize: 38, bodySize: 24 },
    blank: {}
  };
}

function normalizeHexColor(value, fallback) {
  const cleanValue = normalizeString(value).replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(cleanValue) ? cleanValue.toUpperCase() : fallback;
}

function normalizePresentationTheme(value = {}, fallbackSeriesTitle = "") {
  const fallbackTheme = buildDefaultPresentationTheme(fallbackSeriesTitle);
  const theme = isPlainObject(value) ? value : {};
  const fonts = isPlainObject(theme.fonts) ? theme.fonts : {};
  const colors = isPlainObject(theme.colors) ? theme.colors : {};

  return {
    name: normalizeString(theme.name) || fallbackTheme.name,
    fonts: {
      heading: normalizeString(fonts.heading) || fallbackTheme.fonts.heading,
      body: normalizeString(fonts.body) || fallbackTheme.fonts.body
    },
    colors: {
      background: normalizeHexColor(colors.background, fallbackTheme.colors.background),
      surface: normalizeHexColor(colors.surface, fallbackTheme.colors.surface),
      primary: normalizeHexColor(colors.primary, fallbackTheme.colors.primary),
      text: normalizeHexColor(colors.text, fallbackTheme.colors.text),
      muted: normalizeHexColor(colors.muted, fallbackTheme.colors.muted),
      accent: normalizeHexColor(colors.accent, fallbackTheme.colors.accent)
    }
  };
}

function normalizePresentationLayouts(value = {}) {
  return isPlainObject(value) ? { ...buildDefaultPresentationLayouts(), ...clone(value) } : buildDefaultPresentationLayouts();
}

function normalizeSlideType(value) {
  return normalizeEnum(value, PRESENTATION_SLIDE_TYPES, "main_point", "presentation_slide_type");
}

function normalizePresentationSlide(value = {}, index = 0) {
  const slide = isPlainObject(value) ? value : {};
  const type = normalizeSlideType(slide.type || slide.slideType);
  return {
    slideId: normalizeString(slide.slideId) || `slide-${String(index + 1).padStart(2, "0")}`,
    type,
    title: normalizeString(slide.title),
    subtitle: normalizeString(slide.subtitle),
    heading: normalizeString(slide.heading),
    body: normalizeString(slide.body || slide.content),
    reference: normalizeString(slide.reference),
    text: normalizeString(slide.text),
    citation: normalizeString(slide.citation),
    notes: normalizeString(slide.notes),
    bullets: normalizeStringArray(slide.bullets),
    sourceRefs: normalizeSourceRefs(slide.sourceRefs)
  };
}

function normalizePresentationSlides(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((slide, index) => normalizePresentationSlide(slide, index))
    .filter((slide) => slide.type === "blank" ||
      slide.title ||
      slide.subtitle ||
      slide.heading ||
      slide.body ||
      slide.reference ||
      slide.text ||
      slide.citation ||
      slide.bullets.length);
}

function splitOutlineLines(value = "") {
  return normalizeString(value)
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .slice(0, 10);
}

function truncateSlideBody(value = "", maximumLength = 320) {
  const cleanValue = normalizeString(value);
  if (cleanValue.length <= maximumLength) return cleanValue;
  const shortened = cleanValue.slice(0, maximumLength);
  const breakAt = Math.max(shortened.lastIndexOf(". "), shortened.lastIndexOf("; "));
  return `${shortened.slice(0, breakAt > maximumLength * 0.55 ? breakAt + 1 : maximumLength).trim()}...`;
}

function buildDevelopmentCheckpointSlides(checkpoints = [], existingText = "") {
  const supportedTypes = new Set(["verbatim", "key_line", "illustration", "application"]);
  const typeLimits = { verbatim: 1, key_line: 1, illustration: 1, application: 2 };
  const typeCounts = new Map();
  const slides = [];

  for (const checkpoint of checkpoints) {
    if (checkpoint.materialStatus !== "placed") continue;
    if (!supportedTypes.has(checkpoint.checkpointType)) continue;
    const currentCount = typeCounts.get(checkpoint.checkpointType) || 0;
    if (currentCount >= typeLimits[checkpoint.checkpointType]) continue;
    if (calculateTextCoverage(checkpoint.content, existingText) >= 0.85) continue;

    const isQuote = ["verbatim", "key_line"].includes(checkpoint.checkpointType);
    slides.push(normalizePresentationSlide({
      type: isQuote ? "quote" : checkpoint.checkpointType === "application" ? "application" : "section",
      heading: isQuote ? "" : checkpoint.heading ||
        (checkpoint.checkpointType === "illustration" ? "Illustration" : "Application"),
      body: isQuote ? "" : truncateSlideBody(checkpoint.content),
      text: isQuote ? truncateSlideBody(checkpoint.content, 260) : "",
      citation: isQuote && checkpoint.heading ? checkpoint.heading : "",
      notes: `Development checkpoint: ${checkpoint.checkpointId}`,
      sourceRefs: [{ type: "sermon_development_checkpoint", checkpointId: checkpoint.checkpointId }]
    }, slides.length));
    typeCounts.set(checkpoint.checkpointType, currentCount + 1);
  }

  return slides;
}

function buildDefaultSermonSlidePlan(sermon = {}, input = {}) {
  const slides = [
    normalizePresentationSlide({
      type: "title",
      title: normalizeString(input.title) || sermon.title || "Sermon",
      subtitle: sermon.scriptureText || sermon.seriesTitle || ""
    }, 0)
  ];

  if (sermon.scriptureText) {
    slides.push(normalizePresentationSlide({
      type: "scripture",
      reference: sermon.scriptureText,
      text: normalizeString(input.scriptureText) || ""
    }, slides.length));
  }

  if (sermon.bigIdea) {
    slides.push(normalizePresentationSlide({
      type: "big_idea",
      heading: "Big Idea",
      body: sermon.bigIdea
    }, slides.length));
  }

  const outlineLines = splitOutlineLines(sermon.outline);
  const maximumContentSlides = Math.max(15 - slides.length - 1, 0);
  const checkpointSlides = input.includeDevelopmentCheckpoints === false
    ? []
    : buildDevelopmentCheckpointSlides(
      Array.isArray(input.developmentCheckpoints) ? input.developmentCheckpoints : [],
      sermon.bigIdea
    ).slice(0, maximumContentSlides);
  const checkpointText = checkpointSlides
    .map((slide) => [slide.heading, slide.body, slide.text].filter(Boolean).join(" "))
    .join("\n");
  const selectedOutlineLines = outlineLines
    .filter((line) => calculateTextCoverage(line, checkpointText) < 0.85)
    .slice(0, Math.max(maximumContentSlides - checkpointSlides.length, 0));

  for (const line of selectedOutlineLines) {
    slides.push(normalizePresentationSlide({
      type: "main_point",
      heading: line
    }, slides.length));
  }

  slides.push(...checkpointSlides
    .map((slide, index) => ({
      ...slide,
      slideId: `slide-${String(slides.length + index + 1).padStart(2, "0")}`
    })));

  slides.push(normalizePresentationSlide({
    type: "closing",
    heading: normalizeString(input.closingHeading) || "Response",
    body: normalizeString(input.closingBody)
  }, slides.length));

  return {
    title: normalizeString(input.title) || `${sermon.title || "Sermon"} Slides`,
    generatedFrom: "sermon_workspace_default_v2",
    slides,
    planning: {
      targetSlideRange: { minimum: 10, maximum: 15 },
      actualSlideCount: slides.length,
      outlineMovementCount: selectedOutlineLines.length,
      availableOutlineMovementCount: outlineLines.length,
      developmentSlideCount: checkpointSlides.length,
      warnings: slides.length < 10
        ? ["The sermon has limited presentation-ready material; the deck was not padded with filler."]
        : []
    }
  };
}

function normalizePresentationPlan(value = {}, sermon = {}, input = {}) {
  const plan = isPlainObject(value) ? value : {};
  const slides = normalizePresentationSlides(plan.slides || input.slides);

  if (slides.length) {
    return {
      title: normalizeString(plan.title || input.title) || `${sermon.title || "Sermon"} Slides`,
      generatedFrom: normalizeString(plan.generatedFrom) || "provided",
      slides
    };
  }

  return buildDefaultSermonSlidePlan(sermon, input);
}

function buildSermonChunkSummary(chunk = {}, fallbackId = "") {
  const series = buildSeriesMetadata({}, chunk);
  const summary = {
    chunkId: chunk.chunkId || fallbackId,
    sourceKind: chunk.sourceKind || "",
    sermonId: chunk.sermonId || "",
    folderId: chunk.folderId || "",
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    seriesNumber: series.seriesNumber,
    series: series.series,
    tags: normalizeTags(chunk.tags),
    sourceId: chunk.sourceId || "",
    analysisId: chunk.analysisId || "",
    chunkType: chunk.chunkType || "",
    title: chunk.title || "",
    scriptureText: chunk.scriptureText || "",
    text: chunk.text || "",
    textHash: chunk.textHash || "",
    createdAt: chunk.createdAt || "",
    updatedAt: chunk.updatedAt || ""
  };

  if (typeof chunk.vectorDistance === "number") {
    summary.vectorDistance = chunk.vectorDistance;
  }

  return summary;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeString).filter(Boolean);
}

function normalizeSourceRefs(value) {
  return Array.isArray(value) ? value.filter(isPlainObject).map(clone) : [];
}

async function linkScriptureCommentarySource(source, deps = {}) {
  if (source.sourceType !== "scripture_commentary") return null;
  const noteIds = Array.from(new Set(source.sourceRefs
    .filter((ref) => ["personal_scripture_note", "scripture_note"].includes(normalizeString(ref.type)))
    .map((ref) => normalizeString(ref.scriptureNoteId))
    .filter(Boolean)));
  const collection = deps.scriptureNotesCollection;
  if (!noteIds.length || !collection || typeof collection.doc !== "function") {
    return { requested: noteIds.length, linked: 0, missingScriptureNoteIds: noteIds };
  }
  const missingScriptureNoteIds = [];
  let linked = 0;
  for (const scriptureNoteId of noteIds) {
    const ref = collection.doc(scriptureNoteId);
    const doc = await ref.get();
    if (!doc.exists) {
      missingScriptureNoteIds.push(scriptureNoteId);
      continue;
    }
    const note = doc.data() || {};
    await ref.set({
      ...note,
      sermonIds: Array.from(new Set([...(note.sermonIds || []), source.sermonId])),
      sermonSourceIds: Array.from(new Set([...(note.sermonSourceIds || []), source.sourceId])),
      updatedAt: getNowIso(deps)
    });
    linked += 1;
  }
  return { requested: noteIds.length, linked, missingScriptureNoteIds };
}

function hashText(value) {
  return createHash("sha256").update(normalizeString(value)).digest("hex");
}

function splitChunkText(value, maxLength = MAX_CHUNK_TEXT_LENGTH) {
  const text = normalizeString(value);

  if (!text) {
    return [];
  }

  const parts = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength);
    const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
    const splitAt = breakAt > maxLength * 0.55 ? breakAt + 1 : maxLength;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function buildChunkId({ sermonId, sourceKind, sourceId = "", analysisId = "", chunkType, index }) {
  return [
    "chunk",
    slugify(sermonId),
    slugify(sourceKind),
    slugify(sourceId || analysisId || chunkType),
    slugify(chunkType),
    String(index + 1).padStart(3, "0")
  ].join("-");
}

function buildChunkRecordsFromText(base, text) {
  return splitChunkText(text).map((part, index) => {
    const chunk = {
      ...base,
      chunkId: buildChunkId({ ...base, index }),
      text: part,
      textHash: hashText(part)
    };
    chunk.searchText = buildSermonChunkSearchText(chunk);
    return chunk;
  });
}

function buildSermonChunks(sermon = {}, sources = [], analyses = [], nowIso = "") {
  const sermonId = sermon.sermonId;
  const series = buildSeriesMetadata({}, sermon);
  const base = {
    sermonId,
    folderId: sermon.folderId || "",
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    seriesNumber: series.seriesNumber,
    series: series.series,
    tags: normalizeTags(sermon.tags),
    title: sermon.title || "",
    scriptureText: sermon.scriptureText || "",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  const chunks = [];

  for (const chunkType of ["bigIdea", "outline", "notes"]) {
    chunks.push(...buildChunkRecordsFromText(
      {
        ...base,
        sourceKind: "sermon",
        chunkType
      },
      sermon[chunkType]
    ));
  }

  const developmentNotes = Array.isArray(sermon.developmentNotes) ? sermon.developmentNotes : [];
  developmentNotes.forEach((note, noteIndex) => {
    chunks.push(...buildChunkRecordsFromText(
      {
        ...base,
        sourceKind: "sermon",
        sourceId: note.noteId || `development-note-${noteIndex + 1}`,
        chunkType: `development_note_${normalizeString(note.noteType) || "general"}`
      },
      note.content
    ));
  });

  sources.forEach((source) => {
    const sourceBase = {
      ...base,
      folderId: source.folderId || base.folderId,
      ...buildSeriesMetadata({}, source),
      tags: normalizeTags(source.tags).length ? normalizeTags(source.tags) : base.tags,
      sourceKind: "source",
      sourceId: source.sourceId,
      chunkType: `source_${source.sourceType || "other"}`,
      title: source.sourceLabel || base.title
    };
    chunks.push(...buildChunkRecordsFromText(
      {
        ...sourceBase,
        chunkType: `${sourceBase.chunkType}_summary`
      },
      source.summary
    ));
    chunks.push(...buildChunkRecordsFromText(
      {
        ...sourceBase,
        chunkType: `${sourceBase.chunkType}_material`
      },
      source.material
    ));
  });

  analyses.forEach((analysis) => {
    const analysisText = [
      analysis.summary,
      ...(Array.isArray(analysis.strengths) ? analysis.strengths : []),
      ...(Array.isArray(analysis.improvements) ? analysis.improvements : []),
      ...(Array.isArray(analysis.styleObservations) ? analysis.styleObservations : []),
      ...(Array.isArray(analysis.structureNotes) ? analysis.structureNotes : []),
      ...(Array.isArray(analysis.applicationNotes) ? analysis.applicationNotes : []),
      ...(Array.isArray(analysis.deliveryNotes) ? analysis.deliveryNotes : [])
    ].filter(Boolean).join("\n");
    chunks.push(...buildChunkRecordsFromText(
      {
        ...base,
        sourceKind: "analysis",
        analysisId: analysis.analysisId,
        chunkType: "preaching_analysis",
        title: analysis.title || base.title
      },
      analysisText
    ));
  });

  return chunks;
}

function normalizeProfileObservations(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return {
          category: "general",
          observation: normalizeString(item),
          confidence: "observed_once",
          evidence: ""
        };
      }

      if (!isPlainObject(item)) {
        return null;
      }

      return {
        category: normalizeString(item.category) || "general",
        observation: normalizeString(item.observation || item.content || item.note),
        confidence: normalizeEnum(
          item.confidence,
          PROFILE_CONFIDENCE_LEVELS,
          "observed_once",
          "profile_confidence"
        ),
        evidence: normalizeString(item.evidence)
      };
    })
    .filter((item) => item && item.observation);
}

function buildDefaultPreachingProfile(nowIso = "") {
  return {
    profileId: DEFAULT_PREACHING_PROFILE_ID,
    summary: "",
    tone: [],
    strengths: [],
    recurringPatterns: [],
    cautions: [],
    draftingGuidance: "",
    observations: [],
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

function buildPreachingProfileResponse(profile = {}) {
  return {
    profileId: profile.profileId || DEFAULT_PREACHING_PROFILE_ID,
    summary: profile.summary || "",
    tone: Array.isArray(profile.tone) ? profile.tone : [],
    strengths: Array.isArray(profile.strengths) ? profile.strengths : [],
    recurringPatterns: Array.isArray(profile.recurringPatterns) ? profile.recurringPatterns : [],
    cautions: Array.isArray(profile.cautions) ? profile.cautions : [],
    draftingGuidance: profile.draftingGuidance || "",
    observations: Array.isArray(profile.observations) ? profile.observations : [],
    createdAt: profile.createdAt || "",
    updatedAt: profile.updatedAt || ""
  };
}

function buildPreachingAnalysisResponse(analysis = {}, fallbackId = "") {
  return {
    analysisId: analysis.analysisId || fallbackId,
    sermonId: analysis.sermonId || "",
    title: analysis.title || "",
    sourceLabel: analysis.sourceLabel || "",
    analyzedAt: analysis.analyzedAt || "",
    summary: analysis.summary || "",
    strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
    improvements: Array.isArray(analysis.improvements) ? analysis.improvements : [],
    styleObservations: Array.isArray(analysis.styleObservations) ? analysis.styleObservations : [],
    structureNotes: Array.isArray(analysis.structureNotes) ? analysis.structureNotes : [],
    applicationNotes: Array.isArray(analysis.applicationNotes) ? analysis.applicationNotes : [],
    deliveryNotes: Array.isArray(analysis.deliveryNotes) ? analysis.deliveryNotes : [],
    profileCandidates: Array.isArray(analysis.profileCandidates) ? analysis.profileCandidates : [],
    sourceRefs: normalizeSourceRefs(analysis.sourceRefs),
    reflectionProposalId: analysis.reflectionProposalId || "",
    reflectionSourceFingerprint: analysis.reflectionSourceFingerprint || "",
    plannedVsPreached: isPlainObject(analysis.plannedVsPreached) ? clone(analysis.plannedVsPreached) : {},
    strongestLiveLanguage: Array.isArray(analysis.strongestLiveLanguage) ? clone(analysis.strongestLiveLanguage) : [],
    scriptureNoteCandidates: Array.isArray(analysis.scriptureNoteCandidates) ? clone(analysis.scriptureNoteCandidates) : [],
    recommendedNextActions: Array.isArray(analysis.recommendedNextActions) ? analysis.recommendedNextActions : [],
    createdAt: analysis.createdAt || "",
    updatedAt: analysis.updatedAt || ""
  };
}

function truncateImportedText(value) {
  const text = normalizeString(value);

  if (text.length <= MAX_IMPORTED_TEXT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_IMPORTED_TEXT_LENGTH)}\n\n[Import truncated at ${MAX_IMPORTED_TEXT_LENGTH} characters.]`;
}

function normalizeDevelopmentNoteItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return {
          content: normalizeString(item),
          noteType: "imported"
        };
      }

      if (isPlainObject(item)) {
        return {
          content: normalizeString(item.content || item.note || item.text),
          noteType: normalizeString(item.noteType || item.type) || "imported"
        };
      }

      return null;
    })
    .filter((item) => item && item.content);
}

function appendSection(existingText, heading, content) {
  const cleanContent = normalizeString(content);

  if (!cleanContent) {
    return existingText || "";
  }

  const section = `${heading}\n${cleanContent}`;
  return normalizeString(existingText)
    ? `${normalizeString(existingText)}\n\n${section}`
    : section;
}

async function saveSermonSnapshot(sermon = {}, deps = {}, { snapshotType = "manual", reason = "" } = {}) {
  const snapshotsCollection = getSermonSnapshotsCollection(deps);
  const nowIso = getNowIso(deps);
  const sermonId = validateDocId(sermon.sermonId, "sermonId");
  const cleanSnapshotType = normalizeString(snapshotType) || "manual";
  const cleanReason = normalizeString(reason) || cleanSnapshotType;
  const snapshotId = createId("snapshot", `${sermonId} ${cleanSnapshotType} ${nowIso}`, deps);
  const snapshot = {
    snapshotId,
    sermonId,
    snapshotType: cleanSnapshotType,
    reason: cleanReason,
    createdAt: nowIso,
    sermon: clone(sermon)
  };

  await snapshotsCollection.doc(snapshotId).set(snapshot);
  return buildSermonSnapshotSummary(snapshot, snapshotId);
}

async function assertSermonFolderExists(folderId, deps = {}) {
  const cleanFolderId = normalizeString(folderId);

  if (!cleanFolderId) {
    return "";
  }

  const validFolderId = validateDocId(cleanFolderId, "folderId");
  const foldersCollection = getFoldersCollection(deps);
  const folderDoc = await foldersCollection.doc(validFolderId).get();

  if (!folderDoc.exists) {
    throw createSermonWorkspaceError(
      "Sermon folder not found",
      404,
      { folderId: validFolderId },
      "sermon_folder_not_found"
    );
  }

  return validFolderId;
}

async function getRequiredSermonDoc(inputSermonId, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const sermonId = validateDocId(inputSermonId, "sermonId");
  const exactDoc = await sermonsCollection.doc(sermonId).get();

  if (exactDoc.exists) {
    return {
      sermonId,
      doc: exactDoc
    };
  }

  if (sermonId.length < 12) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const matches = (await loadCollection(sermonsCollection, 10000))
    .filter(({ id, data }) => normalizeString(id).startsWith(sermonId) ||
      normalizeString(data.sermonId).startsWith(sermonId));

  if (matches.length === 1) {
    const resolvedSermonId = matches[0].data.sermonId || matches[0].id;
    return {
      sermonId: resolvedSermonId,
      doc: {
        exists: true,
        data: () => clone({
          ...matches[0].data,
          sermonId: resolvedSermonId
        })
      }
    };
  }

  if (matches.length > 1) {
    throw createSermonWorkspaceError(
      "Sermon id prefix matched multiple sermons",
      409,
      {
        sermonId,
        matches: matches.slice(0, 10).map(({ id, data }) => ({
          sermonId: data.sermonId || id,
          title: data.title || ""
        }))
      },
      "ambiguous_sermon_id_prefix"
    );
  }

  throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
}

function findImportTarget(records, { sermonId, folderId, seriesId, seriesSlug, title, scriptureText }) {
  const cleanSermonId = normalizeString(sermonId);
  const cleanFolderId = normalizeString(folderId).toLowerCase();
  const cleanSeriesId = normalizeString(seriesId);
  const cleanSeriesSlug = normalizeString(seriesSlug);
  const cleanTitle = normalizeString(title).toLowerCase();
  const cleanScripture = normalizeString(scriptureText).toLowerCase();

  if (cleanSermonId) {
    return records.find((record) => record.id === cleanSermonId) || null;
  }

  if (!cleanTitle && !cleanScripture) {
    return null;
  }

  return records.find(({ data }) => {
    const recordFolderId = normalizeString(data.folderId).toLowerCase();
    const recordTitle = normalizeString(data.title).toLowerCase();
    const recordScripture = normalizeString(data.scriptureText).toLowerCase();

    if (cleanFolderId && recordFolderId !== cleanFolderId) {
      return false;
    }

    if (cleanSeriesId && normalizeString(data.seriesId) !== cleanSeriesId) {
      return false;
    }

    if (cleanSeriesSlug && normalizeString(data.seriesSlug) !== cleanSeriesSlug) {
      return false;
    }

    return (
      (cleanTitle && recordTitle === cleanTitle) ||
      (cleanScripture && recordScripture === cleanScripture)
    );
  }) || null;
}

async function createSermonFolder(input = {}, deps = {}) {
  const foldersCollection = getFoldersCollection(deps);
  const name = normalizeString(input.name);

  if (!name) {
    throw createSermonWorkspaceError("Missing folder name", 400, {}, "missing_folder_name");
  }

  const folderId = normalizeString(input.folderId)
    ? validateDocId(input.folderId, "folderId")
    : createId("folder", name, deps);
  const docRef = foldersCollection.doc(folderId);
  const existing = await docRef.get();

  if (existing.exists) {
    return {
      action: "existing",
      folder: buildFolderSummary(existing.data() || {}, folderId)
    };
  }

  const matchingFolder = findMatchingFolderRecord(await loadCollection(foldersCollection, 500), input);

  if (matchingFolder) {
    return {
      action: "existing",
      matchedBy: "folder_name_signature",
      folder: buildFolderSummary(matchingFolder.data, matchingFolder.id)
    };
  }

  const nowIso = getNowIso(deps);
  const folder = {
    folderId,
    name,
    folderType: normalizeEnum(input.folderType, FOLDER_TYPES, "series", "folder_type"),
    status: normalizeEnum(input.status, FOLDER_STATUSES, "active", "folder_status"),
    description: normalizeString(input.description),
    scriptureScope: normalizeString(input.scriptureScope),
    notes: normalizeString(input.notes),
    createdAt: nowIso,
    updatedAt: nowIso
  };
  folder.searchText = buildFolderSearchText(folder);

  await docRef.create(folder);
  return {
    action: "created",
    folder: buildFolderSummary(folder, folderId)
  };
}

async function listSermonFolders(input = {}, deps = {}) {
  const foldersCollection = getFoldersCollection(deps);
  const limit = normalizeLimit(input.limit);
  const folderType = normalizeString(input.folderType);
  const status = normalizeString(input.status);
  const query = normalizeString(input.query).toLowerCase();

  if (folderType && !FOLDER_TYPES.includes(folderType)) {
    throw createSermonWorkspaceError(
      "Invalid folder type",
      400,
      { folderType, allowedValues: FOLDER_TYPES },
      "invalid_folder_type"
    );
  }

  if (status && !FOLDER_STATUSES.includes(status)) {
    throw createSermonWorkspaceError(
      "Invalid folder status",
      400,
      { status, allowedValues: FOLDER_STATUSES },
      "invalid_folder_status"
    );
  }

  const folders = (await loadCollection(foldersCollection, 500))
    .map(({ id, data }) => buildFolderSummary(data, id))
    .filter((folder) => !folderType || folder.folderType === folderType)
    .filter((folder) => !status || folder.status === status)
    .filter((folder) => !query || buildFolderSearchText(folder).includes(query))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, limit);

  return { count: folders.length, folders };
}

async function updateSermonFolder(input = {}, deps = {}) {
  const foldersCollection = getFoldersCollection(deps);
  const folderId = validateDocId(input.folderId, "folderId");
  const docRef = foldersCollection.doc(folderId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSermonWorkspaceError("Sermon folder not found", 404, { folderId }, "sermon_folder_not_found");
  }

  const changes = isPlainObject(input.changes) ? input.changes : input;
  const nextFolder = { ...clone(doc.data() || {}), folderId };

  if (Object.prototype.hasOwnProperty.call(changes, "name")) {
    const name = normalizeString(changes.name);
    if (!name) {
      throw createSermonWorkspaceError("Folder name cannot be blank", 400, {}, "blank_folder_name");
    }
    nextFolder.name = name;
  }

  for (const field of ["description", "scriptureScope", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextFolder[field] = normalizeString(changes[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "folderType")) {
    nextFolder.folderType = normalizeEnum(changes.folderType, FOLDER_TYPES, nextFolder.folderType, "folder_type");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    nextFolder.status = normalizeEnum(changes.status, FOLDER_STATUSES, nextFolder.status, "folder_status");
  }

  nextFolder.updatedAt = getNowIso(deps);
  nextFolder.searchText = buildFolderSearchText(nextFolder);
  await docRef.set(nextFolder);

  return { folder: buildFolderSummary(nextFolder, folderId) };
}

async function createSermon(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const title = normalizeString(input.title);

  if (!title) {
    throw createSermonWorkspaceError("Missing sermon title", 400, {}, "missing_sermon_title");
  }

  const sermonId = normalizeString(input.sermonId)
    ? validateDocId(input.sermonId, "sermonId")
    : createId("sermon", title, deps);
  const docRef = sermonsCollection.doc(sermonId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createSermonWorkspaceError(
      "Sermon already exists",
      409,
      { sermonId },
      "sermon_already_exists"
    );
  }

  const folderId = await assertSermonFolderExists(input.folderId, deps);
  const series = buildSeriesMetadata(input);
  const tags = normalizeTags(input.tags);
  const nowIso = getNowIso(deps);
  const sermon = {
    sermonId,
    folderId,
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    seriesNumber: series.seriesNumber,
    series: series.series,
    tags,
    title,
    status: normalizeEnum(input.status, SERMON_STATUSES, "idea", "sermon_status"),
    scriptureText: normalizeString(input.scriptureText),
    bigIdea: normalizeString(input.bigIdea),
    targetDate: normalizeOptionalDate(input.targetDate, "targetDate"),
    preachedDate: normalizeOptionalDate(input.preachedDate, "preachedDate"),
    occasion: normalizeString(input.occasion),
    notes: normalizeString(input.notes),
    outline: normalizeString(input.outline),
    developmentNotes: [],
    sourceRefs: Array.isArray(input.sourceRefs) ? input.sourceRefs.filter(isPlainObject).map(clone) : [],
    createdAt: nowIso,
    updatedAt: nowIso
  };
  sermon.searchText = buildSermonSearchText(sermon);

  await docRef.create(sermon);
  return { sermon: buildSermonDetail(sermon, sermonId) };
}

async function listSermons(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const occasionsCollection = getSermonOccasionsCollection(deps);
  const limit = normalizeLimit(input.limit);
  const folderId = normalizeString(input.folderId);
  const seriesId = normalizeString(input.seriesId);
  const seriesSlug = normalizeString(input.seriesSlug);
  const seriesTitle = normalizeString(input.seriesTitle).toLowerCase();
  const tag = normalizeString(input.tag).toLowerCase();
  const status = normalizeString(input.status);
  const occasion = normalizeString(input.occasion).toLowerCase();
  const venue = normalizeString(input.venue).toLowerCase();
  const service = normalizeString(input.service).toLowerCase();
  const occasionStatus = normalizeString(input.occasionStatus);
  const scriptureText = normalizeString(input.scriptureText).toLowerCase();
  const query = normalizeString(input.query).toLowerCase();
  const dateFilters = normalizeSermonDateFilters(input);
  const nowIso = getNowIso(deps);

  if (status && !SERMON_STATUSES.includes(status)) {
    throw createSermonWorkspaceError(
      "Invalid sermon status",
      400,
      { status, allowedValues: SERMON_STATUSES },
      "invalid_sermon_status"
    );
  }
  if (occasionStatus && !SERMON_OCCASION_STATUSES.includes(occasionStatus)) {
    throw createSermonWorkspaceError(
      "Invalid sermon occasion status",
      400,
      { occasionStatus, allowedValues: SERMON_OCCASION_STATUSES },
      "invalid_sermon_occasion_status"
    );
  }

  const [sermonRecords, occasionRecords] = await Promise.all([
    loadCollection(sermonsCollection, 10000),
    loadSermonOccasionRecords(occasionsCollection, { maxDocs: 20000 })
  ]);
  const occasionsBySermon = groupSermonOccasions(occasionRecords);

  const sermons = sortSermonSummaries(
    sermonRecords
      .map(({ id, data }) => ({
        id,
        data: enrichSermonWithOccasions(data, occasionsBySermon.get(data.sermonId || id) || [], nowIso)
      }))
      .filter(({ data }) => !folderId || normalizeString(data.folderId) === folderId)
      .filter(({ data }) => !seriesId || normalizeString(data.seriesId) === seriesId)
      .filter(({ data }) => !seriesSlug || normalizeString(data.seriesSlug) === seriesSlug)
      .filter(({ data }) => !seriesTitle || normalizeString(data.seriesTitle).toLowerCase() === seriesTitle)
      .filter(({ data }) => !tag || normalizeTags(data.tags).map((item) => item.toLowerCase()).includes(tag))
      .filter(({ data }) => !status || normalizeString(data.status || "idea") === status)
      .filter(({ data }) => !occasion || buildSermonOccasionAggregateText(data).includes(occasion))
      .filter(({ data }) => !venue || data.preachingOccasions.some((item) => item.venue.toLowerCase().includes(venue)))
      .filter(({ data }) => !service || data.preachingOccasions.some((item) => item.service.toLowerCase().includes(service)))
      .filter(({ data }) => !occasionStatus || data.preachingOccasions.some((item) => item.status === occasionStatus))
      .filter(({ data }) => {
        if (input.upcomingOnly !== true) return true;
        if (normalizeString(data.status) === "archived") return false;
        if (data.preachingOccasions.length > 0) return Boolean(data.nextOccasion);
        return isLegacyTargetDateUpcoming(data, nowIso);
      })
      .filter(({ data }) => !scriptureText || normalizeString(data.scriptureText).toLowerCase().includes(scriptureText))
      .filter(({ data }) => sermonMatchesDateFilters(data, dateFilters))
      .filter(({ data }) => !query || buildSermonSearchText(data).includes(query))
      .map(({ id, data }) => buildSermonListSummary(data, id)),
    input.sort
  ).slice(0, limit);

  return { count: sermons.length, sermons };
}

function buildMinistryArchiveSermonSummary(sermon = {}) {
  return {
    sermonId: sermon.sermonId,
    title: sermon.title,
    status: sermon.status,
    scriptureText: sermon.scriptureText,
    bigIdea: sermon.bigIdea,
    tags: sermon.tags,
    preachedDate: sermon.preachedDate,
    targetDate: sermon.targetDate,
    occasion: sermon.occasion,
    nextOccasion: sermon.nextOccasion,
    latestPreachedOccasion: sermon.latestPreachedOccasion
  };
}

function getArchiveMetadataConflict(sermon = {}, excludeTags = []) {
  const metadata = {
    occasion: normalizeString(sermon.occasion),
    nextOccasionVenue: normalizeString(sermon.nextOccasion?.venue),
    nextOccasionService: normalizeString(sermon.nextOccasion?.service),
    latestPreachedVenue: normalizeString(sermon.latestPreachedOccasion?.venue),
    latestPreachedService: normalizeString(sermon.latestPreachedOccasion?.service)
  };
  const metadataText = Object.values(metadata).join(" ").toLowerCase();
  const matchedExcludedMetadataTerms = Array.from(new Set(excludeTags
    .map((tag) => tag.split("-").filter(Boolean).at(-1) || "")
    .filter((term) => term.length >= 4 && metadataText.includes(term))));

  if (matchedExcludedMetadataTerms.length === 0) return null;
  return {
    sermonId: sermon.sermonId,
    title: sermon.title,
    canonicalTags: sermon.tags,
    matchedExcludedMetadataTerms,
    conflictingLegacyMetadata: Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value)
    ),
    resolution: "retained_by_canonical_tag"
  };
}

async function reviewSermonMinistryArchive(input = {}, deps = {}) {
  const tag = normalizeString(input.tag).toLowerCase();
  if (!tag) {
    throw createSermonWorkspaceError(
      "Ministry archive review requires a canonical tag",
      400,
      { requiredField: "tag" },
      "missing_sermon_ministry_archive_tag"
    );
  }

  const excludeTags = normalizeTags(input.excludeTags).map((item) => item.toLowerCase());
  const result = await listSermons({ tag, limit: input.limit || 100 }, deps);
  const excludedSermons = result.sermons.filter((sermon) => {
    const sermonTags = normalizeTags(sermon.tags).map((item) => item.toLowerCase());
    return excludeTags.some((excludedTag) => sermonTags.includes(excludedTag));
  });
  const excludedIds = new Set(excludedSermons.map((sermon) => sermon.sermonId));
  const selectedSermons = result.sermons.filter((sermon) => !excludedIds.has(sermon.sermonId));
  const selectedIds = new Set(selectedSermons.map((sermon) => sermon.sermonId));
  const historicalSermons = selectedSermons.filter((sermon) => sermon.status === "preached");
  const currentSermons = selectedSermons.filter((sermon) => sermon.status !== "preached");
  const metadataConflicts = selectedSermons
    .map((sermon) => getArchiveMetadataConflict(sermon, excludeTags))
    .filter(Boolean);
  const semanticQuery = normalizeString(input.semanticQuery);
  const semanticResult = semanticQuery
    ? await semanticSearchSermonChunks({
      query: semanticQuery,
      tag,
      limit: input.semanticLimit || 20
    }, deps)
    : null;
  const semanticEvidence = semanticResult
    ? semanticResult.chunks.filter((chunk) => selectedIds.has(chunk.sermonId))
    : [];
  const historicalIds = new Set(historicalSermons.map((sermon) => sermon.sermonId));
  const evidenceSermonIds = Array.from(new Set(semanticEvidence
    .map((chunk) => chunk.sermonId)
    .filter((sermonId) => historicalIds.has(sermonId))));
  const requiredEvidenceSermonCount = Math.min(3, historicalSermons.length);
  const recommendationReady = Boolean(
    semanticQuery &&
    requiredEvidenceSermonCount > 0 &&
    evidenceSermonIds.length >= requiredEvidenceSermonCount
  );

  return {
    classificationAuthority: "canonical_sermon_tags",
    tag,
    excludeTags,
    counts: {
      matchedByCanonicalTag: result.sermons.length,
      excludedByCanonicalTag: excludedSermons.length,
      selected: selectedSermons.length,
      historical: historicalSermons.length,
      current: currentSermons.length,
      legacyMetadataConflicts: metadataConflicts.length
    },
    titleThemes: getSeriesThemeTerms(historicalSermons),
    selectedSermons: selectedSermons.map(buildMinistryArchiveSermonSummary),
    excludedSermons: excludedSermons.map(buildMinistryArchiveSermonSummary),
    legacyMetadataConflicts: metadataConflicts,
    semanticEvidence: semanticResult
      ? {
        query: semanticResult.query,
        chunkCount: semanticEvidence.length,
        distinctHistoricalSermonCount: evidenceSermonIds.length,
        historicalSermonIds: evidenceSermonIds,
        chunks: semanticEvidence
      }
      : null,
    recommendationReadiness: {
      ready: recommendationReady,
      requiredEvidenceSermonCount,
      retrievedEvidenceSermonCount: evidenceSermonIds.length,
      reason: recommendationReady
        ? "Representative historical sermon text was retrieved from enough canonically selected records."
        : semanticQuery
          ? "Too few canonically selected historical sermons were represented in retrieved chunk evidence. Do not recommend a direction yet."
          : "No semantic evidence query was supplied. Metadata and titles alone are not enough to recommend a direction."
    }
  };
}

function scoreTextMatch(actualValue, requestedValue, weights = {}) {
  const actual = normalizeString(actualValue).toLowerCase();
  const requested = normalizeString(requestedValue).toLowerCase();

  if (!actual || !requested) return 0;
  if (actual === requested) return weights.exact || 0;
  if (actual.startsWith(requested)) return weights.startsWith || weights.contains || 0;
  if (actual.includes(requested)) return weights.contains || 0;
  return 0;
}

function buildResolverSourceMatch(source = {}, fallbackId = "", terms = []) {
  const normalizedTerms = Array.from(new Set(terms.map(normalizeString).filter(Boolean)));
  let score = 0;
  const reasons = [];

  for (const term of normalizedTerms) {
    const labelScore = scoreTextMatch(source.sourceLabel, term, {
      exact: 800,
      startsWith: 600,
      contains: 550
    });
    const summaryScore = scoreTextMatch(source.summary, term, {
      exact: 650,
      startsWith: 500,
      contains: 450
    });
    const broadScore = buildSermonSourceSearchText(source).includes(term.toLowerCase()) ? 300 : 0;
    const termScore = Math.max(labelScore, summaryScore, broadScore);

    if (termScore > score) score = termScore;
    if (termScore > 0) reasons.push(`source:${term}`);
  }

  if (score === 0) return null;

  return {
    ...buildSermonSourceSummary(source, fallbackId),
    score,
    reasons: Array.from(new Set(reasons))
  };
}

function buildSermonResolutionCandidate(record, sourceMatches, criteria, dateFilters) {
  const { id, data } = record;
  const sermon = buildSermonListSummary(data, id);
  const reasons = [];
  let score = 0;

  const sermonId = normalizeString(criteria.sermonId);
  if (sermonId && sermon.sermonId === sermonId) {
    score += 2400;
    reasons.push("sermonId_exact");
  } else if (sermonId && sermon.sermonId.startsWith(sermonId)) {
    score += 1800;
    reasons.push("sermonId_prefix");
  }

  const titleScore = scoreTextMatch(sermon.title, criteria.title, {
    exact: 1200,
    startsWith: 950,
    contains: 800
  });
  if (titleScore) {
    score += titleScore;
    reasons.push(titleScore === 1200 ? "title_exact" : "title_partial");
  }

  const scriptureScore = scoreTextMatch(sermon.scriptureText, criteria.scriptureText, {
    exact: 850,
    startsWith: 700,
    contains: 650
  });
  if (scriptureScore) {
    score += scriptureScore;
    reasons.push(scriptureScore === 850 ? "scripture_exact" : "scripture_partial");
  }

  const occasionScore = scoreTextMatch(buildSermonOccasionAggregateText(data), criteria.occasion, {
    exact: 600,
    startsWith: 450,
    contains: 350
  });
  if (occasionScore) {
    score += occasionScore;
    reasons.push(occasionScore === 600 ? "occasion_exact" : "occasion_partial");
  }

  const query = normalizeString(criteria.query);
  if (query) {
    const queryTitleScore = scoreTextMatch(sermon.title, query, {
      exact: 1100,
      startsWith: 850,
      contains: 700
    });
    const queryScriptureScore = scoreTextMatch(sermon.scriptureText, query, {
      exact: 750,
      startsWith: 625,
      contains: 550
    });
    const queryOccasionScore = scoreTextMatch(buildSermonOccasionAggregateText(data), query, {
      exact: 500,
      startsWith: 400,
      contains: 325
    });
    const canonicalScore = Math.max(
      queryTitleScore,
      queryScriptureScore,
      queryOccasionScore,
      buildSermonSearchText(data).includes(query.toLowerCase()) ? 250 : 0
    );

    if (canonicalScore) {
      score += canonicalScore;
      reasons.push(queryTitleScore === canonicalScore
        ? (queryTitleScore === 1100 ? "query_title_exact" : "query_title_partial")
        : queryScriptureScore === canonicalScore
          ? "query_scripture"
          : queryOccasionScore === canonicalScore
            ? "query_occasion"
            : "query_canonical");
    }
  }

  if (dateFilters.exactDate) {
    score += 700;
    reasons.push("date_exact");
  }
  if (dateFilters.preachedDate) {
    score += 700;
    reasons.push("preachedDate_exact");
  }
  if (dateFilters.targetDate) {
    score += 700;
    reasons.push("targetDate_exact");
  }
  if (dateFilters.dateFrom || dateFilters.dateTo) {
    score += 300;
    reasons.push("date_range");
  }

  if (criteria.seriesId || criteria.seriesSlug || criteria.seriesTitle) {
    score += 300;
    reasons.push("series_filter");
  }
  if (criteria.folderId) {
    score += 100;
    reasons.push("folder_filter");
  }
  if (criteria.status) {
    score += 100;
    reasons.push("status_filter");
  }
  if (criteria.tag) {
    score += 100;
    reasons.push("tag_filter");
  }

  const sortedSourceMatches = [...sourceMatches].sort((left, right) => right.score - left.score);
  if (sortedSourceMatches.length > 0) {
    score += sortedSourceMatches[0].score + Math.min((sortedSourceMatches.length - 1) * 25, 100);
    reasons.push(...sortedSourceMatches.flatMap((source) => source.reasons));
  }

  return {
    ...sermon,
    score,
    confidence: score >= 1200 ? "high" : score >= 500 ? "medium" : "low",
    matchedBy: Array.from(new Set(reasons)),
    sourceMatchCount: sortedSourceMatches.length,
    sourceMatches: sortedSourceMatches.slice(0, 3).map(({ score: sourceScore, reasons: sourceReasons, ...source }) => ({
      ...source,
      score: sourceScore,
      matchedBy: sourceReasons
    }))
  };
}

async function resolveSermon(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const occasionsCollection = getSermonOccasionsCollection(deps);
  const includeSourceMatches = input.includeSourceMatches !== false;
  const criteria = {
    sermonId: normalizeString(input.sermonId),
    query: normalizeString(input.query),
    title: normalizeString(input.title),
    scriptureText: normalizeString(input.scriptureText),
    occasion: normalizeString(input.occasion),
    folderId: normalizeString(input.folderId),
    seriesId: normalizeString(input.seriesId),
    seriesSlug: normalizeString(input.seriesSlug),
    seriesTitle: normalizeString(input.seriesTitle),
    tag: normalizeString(input.tag),
    status: normalizeString(input.status)
  };
  const dateFilters = normalizeSermonDateFilters(input);
  const identifyingValues = [
    ...Object.values(criteria),
    dateFilters.exactDate,
    dateFilters.dateFrom,
    dateFilters.dateTo,
    dateFilters.preachedDate,
    dateFilters.targetDate
  ];

  if (!identifyingValues.some(Boolean)) {
    throw createSermonWorkspaceError(
      "At least one sermon resolution criterion is required",
      400,
      {},
      "missing_sermon_resolution_criteria"
    );
  }
  if (criteria.status && !SERMON_STATUSES.includes(criteria.status)) {
    throw createSermonWorkspaceError(
      "Invalid sermon status",
      400,
      { status: criteria.status, allowedValues: SERMON_STATUSES },
      "invalid_sermon_status"
    );
  }

  const [rawSermonRecords, occasionRecords] = await Promise.all([
    loadCollection(sermonsCollection, 10000),
    loadSermonOccasionRecords(occasionsCollection, { maxDocs: 20000 })
  ]);
  const occasionsBySermon = groupSermonOccasions(occasionRecords);
  const nowIso = getNowIso(deps);
  const sermonRecords = rawSermonRecords
    .map(({ id, data }) => ({
      id,
      data: enrichSermonWithOccasions(data, occasionsBySermon.get(data.sermonId || id) || [], nowIso)
    }))
    .filter(({ id, data }) => !criteria.sermonId ||
      normalizeString(data.sermonId || id).startsWith(criteria.sermonId))
    .filter(({ data }) => !criteria.folderId || normalizeString(data.folderId) === criteria.folderId)
    .filter(({ data }) => !criteria.seriesId || normalizeString(data.seriesId) === criteria.seriesId)
    .filter(({ data }) => !criteria.seriesSlug || normalizeString(data.seriesSlug) === criteria.seriesSlug)
    .filter(({ data }) => !criteria.seriesTitle ||
      normalizeString(data.seriesTitle).toLowerCase() === criteria.seriesTitle.toLowerCase())
    .filter(({ data }) => !criteria.tag || normalizeTags(data.tags)
      .map((item) => item.toLowerCase()).includes(criteria.tag.toLowerCase()))
    .filter(({ data }) => !criteria.status || normalizeString(data.status || "idea") === criteria.status)
    .filter(({ data }) => sermonMatchesDateFilters(data, dateFilters));

  const sourceTerms = [criteria.query, criteria.title, criteria.scriptureText, criteria.occasion];
  const sourceMatchesBySermon = new Map();

  if (includeSourceMatches && sourceTerms.some(Boolean)) {
    const sourcesCollection = getSermonSourcesCollection(deps);
    for (const { id, data } of await loadSermonSourceRecords(sourcesCollection, { maxDocs: 10000 })) {
      const sourceMatch = buildResolverSourceMatch(data, id, sourceTerms);
      const sourceSermonId = normalizeString(data.sermonId);
      if (!sourceMatch || !sourceSermonId) continue;
      const existing = sourceMatchesBySermon.get(sourceSermonId) || [];
      existing.push(sourceMatch);
      sourceMatchesBySermon.set(sourceSermonId, existing);
    }
  }

  const limit = normalizeLimit(input.limit || 10);
  const candidates = sermonRecords
    .map((record) => {
      const sermonId = normalizeString(record.data.sermonId || record.id);
      return buildSermonResolutionCandidate(
        record,
        sourceMatchesBySermon.get(sermonId) || [],
        criteria,
        dateFilters
      );
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score ||
      (right.updatedAt || "").localeCompare(left.updatedAt || ""))
    .slice(0, limit);

  if (candidates.length === 0) {
    return {
      resolution: "not_found",
      selected: null,
      needsClarification: false,
      criteria: { ...criteria, ...dateFilters, includeSourceMatches },
      count: 0,
      candidates: []
    };
  }

  const first = candidates[0];
  const second = candidates[1];
  const margin = second ? first.score - second.score : first.score;
  const exactId = first.matchedBy.includes("sermonId_exact");
  const resolved = exactId ||
    (!second && first.score >= 500) ||
    (first.score >= 1000 && margin >= 150) ||
    (first.score >= 700 && margin >= 250);

  return {
    resolution: resolved ? "resolved" : "ambiguous",
    selected: resolved ? first : null,
    needsClarification: !resolved,
    criteria: { ...criteria, ...dateFilters, includeSourceMatches },
    count: candidates.length,
    candidates
  };
}

function parsePrimaryScriptureRange(value = "") {
  const match = normalizeString(value).match(/^((?:[1-3]\s+)?[A-Za-z][A-Za-z ]*?)\s+(\d+):(\d+)(?:\s*[-\u2013]\s*(?:(\d+):)?(\d+))?/);
  if (!match) return null;
  const book = normalizeString(match[1]);
  const startChapter = Number(match[2]);
  const startVerse = Number(match[3]);
  const endChapter = Number(match[4] || startChapter);
  const endVerse = Number(match[5] || startVerse);
  return {
    book,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
    normalized: `${book} ${startChapter}:${startVerse}${endChapter !== startChapter || endVerse !== startVerse
      ? `-${endChapter !== startChapter ? `${endChapter}:` : ""}${endVerse}`
      : ""}`
  };
}

function suggestNextScriptureStart(scriptureText = "") {
  const range = parsePrimaryScriptureRange(scriptureText);
  if (!range) return null;
  return {
    reference: `${range.book} ${range.endChapter}:${range.endVerse + 1}`,
    basis: range.normalized,
    confidence: "mechanical_sequence_only",
    warning: "Confirm the literary unit and context before selecting the next sermon text."
  };
}

function getSeriesThemeTerms(sermons = []) {
  const stopWords = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is",
    "it", "of", "on", "or", "our", "that", "the", "this", "to", "we", "what", "when", "with", "your"
  ]);
  const counts = new Map();
  for (const sermon of sermons) {
    const terms = new Set([sermon.title, sermon.bigIdea]
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2 && !stopWords.has(term)));
    for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([term, sermonCount]) => ({ term, sermonCount }));
}

async function reviewSermonSeriesProgression(input = {}, deps = {}) {
  const seriesId = normalizeString(input.seriesId);
  const seriesSlug = normalizeString(input.seriesSlug);
  const seriesTitle = normalizeString(input.seriesTitle);
  if (!seriesId && !seriesSlug && !seriesTitle) {
    throw createSermonWorkspaceError(
      "Series progression review requires seriesId, seriesSlug, or seriesTitle",
      400,
      {},
      "missing_sermon_series_identity"
    );
  }

  const result = await listSermons({
    seriesId,
    seriesSlug,
    seriesTitle,
    limit: input.limit || 100,
    sort: "date_asc"
  }, deps);
  const sermons = result.sermons
    .filter((sermon) => input.includeArchived === true || sermon.status !== "archived")
    .sort((left, right) => {
      const leftNumber = Number(left.seriesNumber) || Number.MAX_SAFE_INTEGER;
      const rightNumber = Number(right.seriesNumber) || Number.MAX_SAFE_INTEGER;
      return leftNumber - rightNumber ||
        (left.preachedDate || left.targetDate || "9999-12-31")
          .localeCompare(right.preachedDate || right.targetDate || "9999-12-31");
    });
  const completed = sermons.filter((sermon) => sermon.status === "preached");
  const open = sermons.filter((sermon) => !["preached", "archived"].includes(sermon.status));
  const lastCompleted = completed
    .sort((left, right) => (Number(right.seriesNumber) || 0) - (Number(left.seriesNumber) || 0) ||
      (right.preachedDate || "").localeCompare(left.preachedDate || ""))[0] || null;
  const nextPlanned = open
    .sort((left, right) => (Number(left.seriesNumber) || Number.MAX_SAFE_INTEGER) -
      (Number(right.seriesNumber) || Number.MAX_SAFE_INTEGER) ||
      (left.nextOccasion?.sortKey || left.targetDate || "9999-12-31")
        .localeCompare(right.nextOccasion?.sortKey || right.targetDate || "9999-12-31"))[0] || null;
  const numbered = sermons.map((sermon) => Number(sermon.seriesNumber)).filter((number) => number > 0);
  const unnumberedSermons = sermons
    .filter((sermon) => !(Number(sermon.seriesNumber) > 0))
    .map((sermon) => ({ sermonId: sermon.sermonId, title: sermon.title, scriptureText: sermon.scriptureText }));
  const missingSeriesNumbers = [];
  if (numbered.length > 1) {
    const min = Math.min(...numbered);
    const max = Math.max(...numbered);
    const present = new Set(numbered);
    for (let number = min; number <= max; number += 1) {
      if (!present.has(number)) missingSeriesNumbers.push(number);
    }
  }
  const passageGroups = new Map();
  for (const sermon of sermons) {
    const passage = normalizeString(sermon.scriptureText).toLowerCase();
    if (!passage) continue;
    const group = passageGroups.get(passage) || [];
    group.push({ sermonId: sermon.sermonId, title: sermon.title, seriesNumber: sermon.seriesNumber });
    passageGroups.set(passage, group);
  }
  const repeatedPassages = Array.from(passageGroups.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([scriptureText, matches]) => ({ scriptureText, matches }));
  const suggestedNextStart = lastCompleted ? suggestNextScriptureStart(lastCompleted.scriptureText) : null;
  const recommendations = [];
  if (missingSeriesNumbers.length > 0) {
    recommendations.push(`Review missing series numbers: ${missingSeriesNumbers.join(", ")}.`);
  }
  if (unnumberedSermons.length > 0) {
    recommendations.push(`Assign series numbers to ${unnumberedSermons.length} unnumbered sermon record(s) before relying on exact series order.`);
  }
  if (repeatedPassages.length > 0) {
    recommendations.push("Review repeated passage records to distinguish intentional revisiting from duplicate metadata.");
  }
  if (nextPlanned && !normalizeString(nextPlanned.scriptureText)) {
    recommendations.push("Set the next planned sermon’s canonical scriptureText before extended development.");
  }
  if (suggestedNextStart) {
    recommendations.push(`Examine the literary unit beginning near ${suggestedNextStart.reference}; do not assume one-verse sequencing.`);
  }

  return {
    series: {
      seriesId: seriesId || sermons[0]?.seriesId || "",
      seriesSlug: seriesSlug || sermons[0]?.seriesSlug || "",
      seriesTitle: seriesTitle || sermons[0]?.seriesTitle || "",
      sermonCount: sermons.length,
      preachedCount: completed.length,
      openCount: open.length,
      orderingConfidence: unnumberedSermons.length === 0 && missingSeriesNumbers.length === 0
        ? "complete_metadata"
        : "partial_metadata"
    },
    lastCompleted,
    nextPlanned,
    suggestedNextStart,
    missingSeriesNumbers,
    unnumberedSermons,
    repeatedPassages,
    recurringThemes: getSeriesThemeTerms(sermons),
    recommendations,
    sermons: sermons.map((sermon) => ({
      sermonId: sermon.sermonId,
      seriesNumber: sermon.seriesNumber,
      title: sermon.title,
      status: sermon.status,
      scriptureText: sermon.scriptureText,
      bigIdea: sermon.bigIdea,
      preachedDate: sermon.preachedDate,
      targetDate: sermon.targetDate,
      nextOccasion: sermon.nextOccasion
    }))
  };
}

function extractLikelyScriptureReferences(value = "") {
  const books = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
    "Samuel", "Kings", "Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms?", "Proverbs",
    "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
    "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah",
    "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans",
    "Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "Thessalonians", "Timothy",
    "Titus", "Philemon", "Hebrews", "James", "Peter", "Jude", "Revelation"
  ];
  const pattern = new RegExp(
    `\\b(?:[1-3]\\s+)?(?:${books.join("|")})\\s+\\d+(?::\\d+(?:[-\\u2013]\\d+)?)?`,
    "gi"
  );
  return Array.from(new Set((String(value).match(pattern) || []).map(normalizeString)));
}

async function auditSermonCompleteness(input = {}, deps = {}) {
  const { sermonId, doc } = await getRequiredSermonDoc(input.sermonId, deps);
  const occasionRecords = await loadSermonOccasionRecords(
    getSermonOccasionsCollection(deps),
    { sermonId }
  );
  const sermon = buildSermonDetail(
    enrichSermonWithOccasions(doc.data() || {}, occasionRecords.map(({ id, data }) =>
      buildSermonOccasionSummary(data, id)), getNowIso(deps)),
    sermonId
  );
  const sourcesCollection = getSermonSourcesCollection(deps);
  const sourceRecords = await loadSermonSourceRecords(sourcesCollection, { sermonId, maxDocs: 10000 });
  const expectedFields = ["title", "scriptureText", "bigIdea", "outline", "occasion"];

  if (sermon.status === "preached") {
    expectedFields.push("preachedDate");
  } else if (["developing", "draft", "ready"].includes(sermon.status)) {
    expectedFields.push("targetDate");
  }

  const missingFields = expectedFields.filter((field) => {
    if (field === "occasion") return sermon.occasionCount === 0 && !normalizeString(sermon.occasion);
    if (field === "targetDate") return !sermon.nextOccasion && !normalizeString(sermon.targetDate);
    if (field === "preachedDate") return !sermon.latestPreachedOccasion && !normalizeString(sermon.preachedDate);
    return !normalizeString(sermon[field]);
  });
  const presentFieldCount = expectedFields.length - missingFields.length;
  const completenessScore = Math.round((presentFieldCount / expectedFields.length) * 100);
  const sourceTypeCounts = new Map();
  const likelyScriptureReferences = new Set();

  for (const { data } of sourceRecords) {
    incrementCount(sourceTypeCounts, normalizeString(data.sourceType) || "other");
    for (const reference of extractLikelyScriptureReferences([
      data.sourceLabel,
      data.summary,
      data.material
    ].map(normalizeString).join(" "))) {
      likelyScriptureReferences.add(reference);
    }
  }

  const recommendations = missingFields.map((field) => (
    field === "scriptureText" && likelyScriptureReferences.size > 0
      ? `Review saved sources and restore scriptureText; likely references include ${Array.from(likelyScriptureReferences).slice(0, 3).join(", ")}.`
      : `Review saved sources and restore the canonical ${field} field.`
  ));

  if (!sermon.seriesId && !sermon.seriesTitle) {
    recommendations.push("Add series metadata if this sermon belongs to a preaching series.");
  }
  if (sourceRecords.length === 0) {
    recommendations.push("Attach a manuscript, transcript, notes, or other source before attempting automatic repair.");
  }

  return {
    sermon,
    completeness: {
      status: completenessScore >= 90
        ? "complete"
        : completenessScore >= 60
          ? "needs_attention"
          : "thin",
      score: completenessScore,
      presentFieldCount,
      expectedFieldCount: expectedFields.length,
      missingFields
    },
    sourceCoverage: {
      count: sourceRecords.length,
      byType: countMapToObject(sourceTypeCounts),
      hasMaterial: sourceRecords.some(({ data }) => Boolean(normalizeString(data.material))),
      likelyScriptureReferences: Array.from(likelyScriptureReferences).slice(0, 10),
      sources: sourceRecords.slice(0, 5).map(({ id, data }) => buildSermonSourceSummary(data, id))
    },
    recommendations
  };
}

function inferSermonDevelopmentStage(sermon = {}, sourceCoverage = {}) {
  if (sermon.status === "preached") return "preached";
  if (sermon.status === "ready") return "ready";
  if (normalizeString(sermon.outline) && (normalizeString(sermon.notes) || sourceCoverage.hasMaterial)) {
    return "draft";
  }
  if (normalizeString(sermon.bigIdea) || normalizeString(sermon.outline)) return "structure";
  if (normalizeString(sermon.scriptureText) || sourceCoverage.hasMaterial) return "study";
  return "idea";
}

function getOccasionTimeContext(occasion, nowIso) {
  if (!occasion) return { daysUntil: null, urgency: "unscheduled" };
  const localToday = getLocalNowKey(nowIso, occasion.timeZone).slice(0, 10);
  const todayMs = Date.parse(`${localToday}T00:00:00Z`);
  const occasionMs = Date.parse(`${occasion.date}T00:00:00Z`);
  const daysUntil = Math.round((occasionMs - todayMs) / (24 * 60 * 60 * 1000));
  const urgency = daysUntil < 0
    ? "overdue"
    : daysUntil <= 1
      ? "immediate"
      : daysUntil <= 7
        ? "this_week"
        : daysUntil <= 21
          ? "upcoming"
          : "scheduled";
  return { daysUntil, urgency };
}

function buildSermonWorkflowPhase(timeContext = {}) {
  const daysUntil = timeContext.daysUntil;
  if (daysUntil === null || daysUntil === undefined) {
    return {
      phase: "unscheduled",
      focus: "Capture freely and clarify the biblical burden without forcing a deadline.",
      protect: "Do not manufacture structure merely to make an unscheduled idea look complete."
    };
  }
  if (daysUntil < 0) {
    return {
      phase: "post_service",
      focus: "Preserve preached media, reflection, and reusable material.",
      protect: "Keep preparation, proclamation, and later synthesis as distinct layers."
    };
  }
  if (daysUntil === 0) {
    return {
      phase: "pre_service_loading",
      focus: "Re-read, highlight, internalize the flow, and prepare to preach.",
      protect: "Avoid new development or structural change unless Dan explicitly redirects it."
    };
  }
  if (daysUntil <= 2) {
    return {
      phase: "finalization",
      focus: "Complete the manuscript or preaching notes and make clarity refinements only.",
      protect: "Avoid major restructuring; preserve settled movement and wording."
    };
  }
  if (daysUntil === 3) {
    return {
      phase: "muse",
      focus: "Develop illustrations, memorable phrasing, emotional pacing, transitions, and the landing.",
      protect: "Do not turn creative space into structural panic."
    };
  }
  return {
    phase: "structure",
    focus: "Settle the passage, burden, controlling idea, and sermon movements while capturing material freely.",
    protect: "Do not force illustrations or final wording before the structure can carry them."
  };
}

function assessSermonDevelopmentTracks(sermon = {}, checkpoints = []) {
  const active = checkpoints.filter((checkpoint) => checkpoint.materialStatus !== "intentionally_cut");
  const placed = active.filter((checkpoint) => checkpoint.materialStatus === "placed");
  const hasText = (pattern) => pattern.test([
    sermon.notes,
    sermon.outline,
    ...active.map((checkpoint) => `${checkpoint.heading} ${checkpoint.content}`)
  ].map(normalizeString).join("\n").toLowerCase());
  const anchorLines = active.filter((checkpoint) => ["key_line", "verbatim"].includes(checkpoint.checkpointType));
  const illustrations = active.filter((checkpoint) => checkpoint.checkpointType === "illustration");
  const transitions = active.filter((checkpoint) => checkpoint.checkpointType === "transition");
  const toneCheckpoints = active.filter((checkpoint) => ["burden", "pastoral_context"].includes(checkpoint.checkpointType));
  const entryReady = hasText(/\b(introduction|opening|open with|hook|entry|tension)\b/);
  const landingReady = hasText(/\b(conclusion|closing|close with|landing|final appeal|invitation)\b/);
  const toneReady = toneCheckpoints.length > 0 || hasText(/\b(tone|comforting|urgent|gentle|pastoral|encouraging|warning)\b/);
  const flow = {
    controllingIdea: Boolean(normalizeString(sermon.bigIdea)),
    structure: Boolean(normalizeString(sermon.outline)),
    entryPoint: entryReady,
    transitions: transitions.length > 0,
    emotionalTone: toneReady,
    cleanLanding: landingReady
  };
  const material = {
    total: checkpoints.length,
    placed: checkpoints.filter((checkpoint) => checkpoint.materialStatus === "placed").length,
    unplaced: checkpoints.filter((checkpoint) => checkpoint.materialStatus === "unplaced").length,
    intentionallyCut: checkpoints.filter((checkpoint) => checkpoint.materialStatus === "intentionally_cut").length,
    anchorLineCount: anchorLines.length,
    placedAnchorLineCount: placed.filter((checkpoint) => ["key_line", "verbatim"].includes(checkpoint.checkpointType)).length,
    illustrationCount: illustrations.length,
    placedIllustrationCount: placed.filter((checkpoint) => checkpoint.checkpointType === "illustration").length,
    transitionCount: transitions.length
  };
  const museNeeds = [
    material.anchorLineCount === 0 ? "craft_anchor_line" : material.placedAnchorLineCount === 0 ? "place_anchor_line" : "",
    material.illustrationCount === 0 ? "develop_illustration" : material.placedIllustrationCount === 0 ? "place_illustration" : "",
    !flow.transitions ? "refine_transitions" : "",
    !flow.emotionalTone ? "define_emotional_tone" : "",
    !flow.cleanLanding ? "shape_clean_landing" : ""
  ].filter(Boolean);
  return { flow, material, museNeeds };
}

async function evaluateSermonReadiness(input = {}, deps = {}) {
  const audit = await auditSermonCompleteness(input, deps);
  const { sermon, completeness, sourceCoverage } = audit;
  const checkpointRecords = await loadSermonDevelopmentRecords(
    getSermonDevelopmentCheckpointsCollection(deps),
    { sermonId: sermon.sermonId, maxDocs: 20000 }
  );
  const checkpoints = checkpointRecords.map(({ id, data }) =>
    buildSermonDevelopmentCheckpoint(data, id));
  const nowIso = getNowIso(deps);
  const nextOccasion = sermon.nextOccasion;
  const timeContext = getOccasionTimeContext(nextOccasion, nowIso);
  const workflow = buildSermonWorkflowPhase(timeContext);
  const developmentTracks = assessSermonDevelopmentTracks(sermon, checkpoints);
  const developmentText = [
    sermon.notes,
    sermon.outline,
    ...(Array.isArray(sermon.developmentNotes)
      ? sermon.developmentNotes.map((note) => note.content)
      : []),
    ...checkpoints.map((checkpoint) => checkpoint.content)
  ].map(normalizeString).join("\n").toLowerCase();
  const dimensions = {
    biblicalText: {
      ready: Boolean(normalizeString(sermon.scriptureText)),
      weight: 15
    },
    centralMessage: {
      ready: Boolean(normalizeString(sermon.bigIdea)),
      weight: 15
    },
    structure: {
      ready: Boolean(normalizeString(sermon.outline)),
      weight: 20
    },
    sourceMaterial: {
      ready: sourceCoverage.hasMaterial === true,
      weight: 10
    },
    development: {
      ready: Boolean(normalizeString(sermon.notes)) ||
        (Array.isArray(sermon.developmentNotes) && sermon.developmentNotes.length > 0) ||
        checkpoints.length > 0,
      weight: 15
    },
    application: {
      ready: checkpoints.some((checkpoint) => checkpoint.checkpointType === "application") ||
        /\b(apply|application|response|therefore|we must|you must)\b/.test(developmentText),
      weight: 10
    },
    preachingSchedule: {
      ready: Boolean(nextOccasion),
      weight: 5
    },
    declaredReady: {
      ready: ["ready", "preached"].includes(sermon.status),
      weight: 10
    }
  };
  const score = Object.values(dimensions)
    .reduce((total, dimension) => total + (dimension.ready ? dimension.weight : 0), 0);
  const stage = inferSermonDevelopmentStage(sermon, sourceCoverage);
  const blockers = [];
  const nextSteps = [];

  for (const field of completeness.missingFields) {
    const repairable = SERMON_CANONICAL_REPAIR_FIELDS.includes(field) && sourceCoverage.hasMaterial;
    nextSteps.push({
      priority: ["scriptureText", "bigIdea", "outline"].includes(field) ? "high" : "medium",
      code: `complete_${field}`,
      action: `Complete the canonical ${field} field.`,
      reason: repairable
        ? "Saved source material may support a source-grounded proposal."
        : "This field is expected at the sermon’s current stage.",
      suggestedOperation: repairable ? "proposeSermonCanonicalRepair" : "updateSermon"
    });
  }
  if (!sourceCoverage.hasMaterial) {
    nextSteps.push({
      priority: "high",
      code: "attach_source_material",
      action: "Attach manuscript, study notes, transcript, or other source material.",
      reason: "The workspace has no substantive saved material to develop or evaluate.",
      suggestedOperation: "createSermonSource"
    });
  }
  if (!dimensions.application.ready && normalizeString(sermon.outline)) {
    nextSteps.push({
      priority: "medium",
      code: "develop_application",
      action: "Develop the sermon’s response and application.",
      reason: "The saved development material does not yet show an explicit application movement.",
      suggestedOperation: "appendSermonContent"
    });
  }
  if (!nextOccasion && sermon.status !== "preached") {
    nextSteps.push({
      priority: "medium",
      code: "schedule_preaching_occasion",
      action: "Add the next preaching occasion with date, time, venue, and service.",
      reason: "Readiness cannot be weighed against a preaching deadline until an occasion is scheduled.",
      suggestedOperation: "createSermonOccasion"
    });
  }
  if (developmentTracks.material.unplaced > 0) {
    nextSteps.push({
      priority: workflow.phase === "muse" ? "high" : "medium",
      code: "review_unplaced_material",
      action: `Review ${developmentTracks.material.unplaced} unplaced development item${developmentTracks.material.unplaced === 1 ? "" : "s"}; place or intentionally cut each one before finalization.`,
      reason: "Preserved material should not disappear merely because it has not entered the sermon flow yet.",
      suggestedOperation: "getSermonMaterialInventory"
    });
  }
  if (workflow.phase === "muse" && developmentTracks.museNeeds.length > 0) {
    nextSteps.push({
      priority: "high",
      code: "use_muse_window",
      action: "Use the protected muse window for illustrations, anchor lines, emotional pacing, transitions, and the landing.",
      reason: `Muse needs: ${developmentTracks.museNeeds.join(", ")}.`,
      suggestedOperation: "saveSermonDevelopmentCheckpoint"
    });
  }
  if (workflow.phase === "pre_service_loading") {
    nextSteps.push({
      priority: "high",
      code: "load_sermon_for_preaching",
      action: "Re-read, highlight, and internalize the settled sermon flow.",
      reason: "The preaching occasion is today; this phase protects clarity and delivery rather than adding material.",
      suggestedOperation: "getSermonContext"
    });
  }
  if (score >= 85 && !["ready", "preached"].includes(sermon.status)) {
    nextSteps.push({
      priority: "low",
      code: "review_ready_status",
      action: "Review the sermon and, if appropriate, mark it ready.",
      reason: "The deterministic readiness checks are substantially complete.",
      suggestedOperation: "updateSermon"
    });
  }
  if (["immediate", "this_week"].includes(timeContext.urgency) && score < 70) {
    blockers.push({
      code: "deadline_readiness_risk",
      message: `The next preaching occasion is ${timeContext.urgency.replace("_", " ")} and readiness is ${score}%.`
    });
  }
  if (!dimensions.biblicalText.ready) {
    blockers.push({ code: "missing_biblical_text", message: "The primary biblical text is not canonical yet." });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  nextSteps.sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority]);

  return {
    sermon: buildSermonListSummary(sermon, sermon.sermonId),
    stage,
    readiness: {
      score,
      status: score >= 85 ? "ready_for_review" : score >= 60 ? "developing" : "early",
      completenessScore: completeness.score,
      dimensions
    },
    schedule: {
      nextOccasion,
      ...timeContext
    },
    workflow,
    developmentTracks,
    strengths: Object.entries(dimensions)
      .filter(([, dimension]) => dimension.ready)
      .map(([name]) => name),
    gaps: Object.entries(dimensions)
      .filter(([, dimension]) => !dimension.ready)
      .map(([name]) => name),
    blockers,
    nextSteps,
    recommendedNextStep: nextSteps[0] || null,
    sourceCoverage,
    preservation: {
      checkpointCount: checkpoints.length,
      exactWordingCount: checkpoints.filter((checkpoint) => checkpoint.exactWording).length,
      checkpointTypes: countMapToObject(checkpoints.reduce((counts, checkpoint) => {
        incrementCount(counts, checkpoint.checkpointType);
        return counts;
      }, new Map())),
      materialStatuses: countMapToObject(checkpoints.reduce((counts, checkpoint) => {
        incrementCount(counts, checkpoint.materialStatus);
        return counts;
      }, new Map()))
    }
  };
}

function getReadinessPriorityScore(item = {}) {
  const readinessScore = Number(item.readiness?.score) || 0;
  const urgencyWeights = {
    immediate: 80,
    this_week: 50,
    upcoming: 25,
    scheduled: 10,
    unscheduled: 0,
    overdue: 100
  };
  return (item.placeholder ? 200 : 0) +
    (urgencyWeights[item.schedule?.urgency] || 0) +
    (100 - readinessScore) +
    ((item.blockers?.length || 0) * 15);
}

async function buildPreachingPreparationDashboard(input = {}, deps = {}) {
  const limit = normalizeLimit(input.limit || 12);
  const legacyDate = normalizeOptionalDate(input.date, "date");
  const explicitAsOfDate = normalizeOptionalDate(input.asOfDate, "asOfDate");
  const requestedDateFrom = normalizeOptionalDate(input.dateFrom, "dateFrom");
  const requestedDateTo = normalizeOptionalDate(input.dateTo, "dateTo");
  const asOfDate = explicitAsOfDate || legacyDate;
  const effectiveDateFrom = requestedDateFrom || asOfDate;
  const scopeKind = requestedDateFrom || requestedDateTo
    ? (requestedDateFrom && requestedDateTo && requestedDateFrom === requestedDateTo
        ? "exact_date"
        : "date_range")
    : (asOfDate ? "upcoming_from_date" : "all_upcoming");
  const upcoming = await listSermons({
    upcomingOnly: true,
    dateFrom: effectiveDateFrom,
    dateTo: requestedDateTo,
    venue: input.venue,
    service: input.service,
    limit,
    sort: "next_asc"
  }, deps);
  const evaluations = await Promise.all(upcoming.sermons.map((sermon) =>
    evaluateSermonReadiness({ sermonId: sermon.sermonId }, deps)));
  const items = evaluations.map((evaluation) => {
    const sermon = evaluation.sermon;
    const occasion = evaluation.schedule.nextOccasion;
    const placeholder = isScheduledSermonPlaceholder(sermon, occasion);
    const item = {
      sermon,
      occasion,
      placeholder,
      stage: evaluation.stage,
      readiness: evaluation.readiness,
      schedule: evaluation.schedule,
      workflow: evaluation.workflow,
      developmentTracks: evaluation.developmentTracks,
      strengths: evaluation.strengths,
      gaps: evaluation.gaps,
      blockers: evaluation.blockers,
      recommendedNextStep: evaluation.recommendedNextStep,
      sourceCoverage: {
        count: evaluation.sourceCoverage.count,
        hasMaterial: evaluation.sourceCoverage.hasMaterial,
        byType: evaluation.sourceCoverage.byType
      },
      preservation: evaluation.preservation
    };
    item.priorityScore = getReadinessPriorityScore(item);
    return item;
  });
  const priority = [...items].sort((left, right) =>
    right.priorityScore - left.priorityScore ||
    (left.occasion?.sortKey || "9999-12-31T23:59")
      .localeCompare(right.occasion?.sortKey || "9999-12-31T23:59"));
  const occasionGroups = new Map();
  for (const item of items) {
    const occasion = item.occasion;
    if (!occasion) continue;
    const key = [occasion.date, occasion.time, occasion.venue, occasion.service]
      .map((value) => normalizeString(value).toLowerCase())
      .join("\u0000");
    const group = occasionGroups.get(key) || [];
    group.push(item);
    occasionGroups.set(key, group);
  }
  const scheduleConflicts = Array.from(occasionGroups.values())
    .filter((group) => group.length > 1)
    .map((group) => ({
      occasion: group[0].occasion,
      sermons: group.map((item) => ({
        sermonId: item.sermon.sermonId,
        title: item.sermon.title
      }))
    }));

  return {
    generatedAt: getNowIso(deps),
    timeZone: normalizeTimeZone(input.timeZone || DEFAULT_SERMON_TIME_ZONE),
    dataProvenance: {
      sourceOfTruth: "firestore",
      accessPath: "sermon_workspace_dispatcher",
      authoritative: true,
      description: "The sermon workspace dispatcher reads the live Firestore sermon records."
    },
    scope: {
      kind: scopeKind,
      effectiveDateFrom,
      effectiveDateTo: requestedDateTo,
      legacyDateInterpretedAs: legacyDate ? "asOfDate" : ""
    },
    filters: {
      date: legacyDate,
      asOfDate,
      dateFrom: requestedDateFrom,
      dateTo: requestedDateTo,
      venue: normalizeString(input.venue),
      service: normalizeString(input.service),
      limit
    },
    summary: {
      upcomingCount: items.length,
      placeholderCount: items.filter((item) => item.placeholder).length,
      readyForReviewCount: items.filter((item) => item.readiness.status === "ready_for_review").length,
      atRiskCount: items.filter((item) => item.blockers.length > 0).length,
      scheduleConflictCount: scheduleConflicts.length,
      workflowPhases: countMapToObject(items.reduce((counts, item) => {
        incrementCount(counts, item.workflow.phase);
        return counts;
      }, new Map()))
    },
    schedule: items,
    priority,
    bestNextAction: priority[0]
      ? {
          sermonId: priority[0].sermon.sermonId,
          title: priority[0].sermon.title,
          occasionId: priority[0].occasion?.occasionId || "",
          placeholder: priority[0].placeholder,
          recommendedNextStep: priority[0].recommendedNextStep,
          workflowPhase: priority[0].workflow.phase
        }
      : null,
    scheduleConflicts
  };
}

function normalizeCanonicalRepairFields(value) {
  if (value === undefined || value === null || value === "") {
    return [...SERMON_CANONICAL_REPAIR_FIELDS];
  }
  if (!Array.isArray(value)) {
    throw createSermonWorkspaceError(
      "Repair fields must be an array",
      400,
      { allowedFields: SERMON_CANONICAL_REPAIR_FIELDS },
      "invalid_canonical_repair_fields"
    );
  }

  const fields = Array.from(new Set(value.map(normalizeString).filter(Boolean)));
  const unsupported = fields.filter((field) => !SERMON_CANONICAL_REPAIR_FIELDS.includes(field));

  if (unsupported.length > 0 || fields.length === 0) {
    throw createSermonWorkspaceError(
      "Repair fields contain unsupported values",
      400,
      { unsupported, allowedFields: SERMON_CANONICAL_REPAIR_FIELDS },
      "invalid_canonical_repair_fields"
    );
  }

  return fields;
}

function buildCanonicalRepairContext(sermon = {}, sourceRecords = []) {
  const primarySourceId = normalizeString(sermon.primaryManuscriptSourceId);
  const sortedSources = [...sourceRecords].sort((left, right) => {
    const leftPrimary = normalizeString(left.data.sourceId || left.id) === primarySourceId ? 1 : 0;
    const rightPrimary = normalizeString(right.data.sourceId || right.id) === primarySourceId ? 1 : 0;
    if (rightPrimary !== leftPrimary) return rightPrimary - leftPrimary;
    return (right.data.updatedAt || right.data.createdAt || "")
      .localeCompare(left.data.updatedAt || left.data.createdAt || "");
  });
  const selectedSourceIds = [];
  const sections = [];
  let remaining = MAX_CANONICAL_REPAIR_CONTEXT_CHARS;

  for (const { id, data } of sortedSources) {
    if (remaining <= 0) break;
    const sourceId = normalizeString(data.sourceId || id);
    const header = [
      `Source ID: ${sourceId}`,
      `Type: ${normalizeString(data.sourceType) || "other"}`,
      `Label: ${normalizeString(data.sourceLabel)}`,
      normalizeString(data.summary) ? `Summary:\n${normalizeString(data.summary)}` : ""
    ].filter(Boolean).join("\n");
    const material = normalizeString(data.material);
    const availableMaterialChars = Math.max(remaining - header.length - 20, 0);
    const section = [
      header,
      material ? `Material:\n${material.slice(0, availableMaterialChars)}` : ""
    ].filter(Boolean).join("\n").slice(0, remaining);

    if (!section) continue;
    sections.push(section);
    selectedSourceIds.push(sourceId);
    remaining -= section.length + 10;
  }

  return {
    contextText: sections.join("\n\n---\n\n"),
    sourceIds: selectedSourceIds,
    contextChars: MAX_CANONICAL_REPAIR_CONTEXT_CHARS - Math.max(remaining, 0),
    truncated: remaining <= 0
  };
}

function normalizeCanonicalRepairChanges(value = {}, fields = SERMON_CANONICAL_REPAIR_FIELDS) {
  const input = isPlainObject(value) ? value : {};
  const changes = {};

  for (const field of fields) {
    const cleanValue = normalizeString(input[field]);
    if (cleanValue) changes[field] = cleanValue;
  }

  return changes;
}

function normalizeCanonicalRepairEvidence(value = {}, fields = SERMON_CANONICAL_REPAIR_FIELDS) {
  const input = isPlainObject(value) ? value : {};
  return Object.fromEntries(fields.map((field) => {
    const fieldEvidence = input[field];
    const items = Array.isArray(fieldEvidence)
      ? fieldEvidence.map(normalizeString).filter(Boolean)
      : normalizeString(fieldEvidence)
        ? [normalizeString(fieldEvidence)]
        : [];
    return [field, items.slice(0, 5)];
  }));
}

function buildCanonicalRepairProposalId({ sermonId, baseUpdatedAt, proposedChanges }) {
  const orderedChanges = Object.fromEntries(SERMON_CANONICAL_REPAIR_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(proposedChanges, field))
    .map((field) => [field, proposedChanges[field]]));
  const fingerprint = JSON.stringify({ sermonId, baseUpdatedAt, proposedChanges: orderedChanges });
  return `sermon-repair-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
}

async function proposeSermonCanonicalRepair(input = {}, deps = {}) {
  const { sermonId, doc } = await getRequiredSermonDoc(input.sermonId, deps);
  const sermon = buildSermonDetail(doc.data() || {}, sermonId);
  const requestedFields = normalizeCanonicalRepairFields(input.fields);
  const repairFields = requestedFields.filter((field) => !normalizeString(sermon[field]));

  if (repairFields.length === 0) {
    return {
      status: "no_repair_needed",
      sermon: buildSermonListSummary(sermon, sermonId),
      requestedFields,
      proposal: null
    };
  }

  const sourcesCollection = getSermonSourcesCollection(deps);
  const sourceRecords = await loadSermonSourceRecords(sourcesCollection, { sermonId, maxDocs: 10000 });

  if (sourceRecords.length === 0) {
    return {
      status: "insufficient_source_material",
      sermon: buildSermonListSummary(sermon, sermonId),
      requestedFields,
      repairFields,
      proposal: null,
      warnings: ["No saved sermon sources are available for a repair proposal."]
    };
  }

  const repairContext = buildCanonicalRepairContext(sermon, sourceRecords);
  const generateProposal = getGenerateCanonicalRepairProposalFunction(deps);
  const generated = await generateProposal({
    sermon,
    requestedFields: repairFields,
    contextText: repairContext.contextText,
    sourceIds: repairContext.sourceIds
  });
  const proposedChanges = normalizeCanonicalRepairChanges(generated?.proposedChanges, repairFields);

  if (Object.keys(proposedChanges).length === 0) {
    return {
      status: "insufficient_source_material",
      sermon: buildSermonListSummary(sermon, sermonId),
      requestedFields,
      repairFields,
      proposal: null,
      sourceSummary: repairContext,
      warnings: [normalizeString(generated?.warning) || "The saved sources did not support a reliable repair proposal."]
    };
  }

  const baseUpdatedAt = normalizeString(sermon.updatedAt);
  const proposalId = buildCanonicalRepairProposalId({ sermonId, baseUpdatedAt, proposedChanges });
  const warnings = Array.isArray(generated?.warnings)
    ? generated.warnings.map(normalizeString).filter(Boolean).slice(0, 10)
    : [];
  if (repairContext.truncated) {
    warnings.push(`Repair context was capped at ${MAX_CANONICAL_REPAIR_CONTEXT_CHARS} characters.`);
  }

  return {
    status: "proposed",
    sermon: buildSermonListSummary(sermon, sermonId),
    requestedFields,
    repairFields,
    proposal: {
      proposalId,
      sermonId,
      baseUpdatedAt,
      proposedChanges,
      evidence: normalizeCanonicalRepairEvidence(generated?.evidence, Object.keys(proposedChanges)),
      confidence: normalizeString(generated?.confidence) || "review_required",
      sourceIds: repairContext.sourceIds,
      contextChars: repairContext.contextChars,
      warnings
    },
    applyInstructions: {
      operation: "applySermonCanonicalRepair",
      confirmationRequired: true,
      arguments: {
        sermonId,
        proposalId,
        baseUpdatedAt,
        proposedChanges,
        confirmed: true
      }
    }
  };
}

async function applySermonCanonicalRepair(input = {}, deps = {}) {
  if (input.confirmed !== true) {
    throw createSermonWorkspaceError(
      "Explicit confirmation is required to apply a canonical repair",
      400,
      {},
      "canonical_repair_confirmation_required"
    );
  }

  const { sermonId, doc } = await getRequiredSermonDoc(input.sermonId, deps);
  const sermon = buildSermonDetail(doc.data() || {}, sermonId);
  const baseUpdatedAt = normalizeString(input.baseUpdatedAt);
  const proposalId = normalizeString(input.proposalId);
  const proposedChanges = normalizeCanonicalRepairChanges(input.proposedChanges);

  if (!baseUpdatedAt || !proposalId || Object.keys(proposedChanges).length === 0) {
    throw createSermonWorkspaceError(
      "A complete canonical repair proposal is required",
      400,
      {},
      "invalid_canonical_repair_proposal"
    );
  }
  if (normalizeString(sermon.updatedAt) !== baseUpdatedAt) {
    throw createSermonWorkspaceError(
      "The sermon changed after this repair was proposed; generate a new proposal",
      409,
      { sermonId, baseUpdatedAt, currentUpdatedAt: normalizeString(sermon.updatedAt) },
      "stale_canonical_repair_proposal"
    );
  }

  const expectedProposalId = buildCanonicalRepairProposalId({ sermonId, baseUpdatedAt, proposedChanges });
  if (proposalId !== expectedProposalId) {
    throw createSermonWorkspaceError(
      "The canonical repair proposal does not match its proposed changes",
      409,
      { sermonId, proposalId },
      "canonical_repair_proposal_mismatch"
    );
  }

  const conflictingFields = Object.keys(proposedChanges)
    .filter((field) => normalizeString(sermon[field]) && normalizeString(sermon[field]) !== proposedChanges[field]);
  if (conflictingFields.length > 0) {
    throw createSermonWorkspaceError(
      "Canonical repair cannot overwrite existing sermon content",
      409,
      { sermonId, conflictingFields },
      "canonical_repair_overwrite_blocked"
    );
  }

  const changesToApply = Object.fromEntries(Object.entries(proposedChanges)
    .filter(([field, value]) => normalizeString(sermon[field]) !== value));
  if (Object.keys(changesToApply).length === 0) {
    return {
      status: "already_applied",
      sermon,
      proposalId,
      appliedFields: []
    };
  }

  const updated = await updateSermon({ sermonId, changes: changesToApply }, deps);
  return {
    status: "applied",
    sermon: updated.sermon,
    snapshot: updated.snapshot,
    proposalId,
    appliedFields: Object.keys(changesToApply)
  };
}

async function getSermon(input = {}, deps = {}) {
  const { sermonId, doc } = await getRequiredSermonDoc(input.sermonId, deps);
  const occasionRecords = await loadSermonOccasionRecords(
    getSermonOccasionsCollection(deps),
    { sermonId }
  );
  const sermon = enrichSermonWithOccasions(
    doc.data() || {},
    occasionRecords.map(({ id, data }) => buildSermonOccasionSummary(data, id)),
    getNowIso(deps)
  );

  return { sermon: buildSermonDetail(sermon, sermonId) };
}

async function startSermonDevelopmentSession(input = {}, deps = {}) {
  const { sermonId, doc: sermonDoc } = await getRequiredSermonDoc(input.sermonId, deps);
  const sessionsCollection = getSermonDevelopmentSessionsCollection(deps);
  const mode = normalizeEnum(
    input.mode,
    SERMON_DEVELOPMENT_SESSION_MODES,
    "other",
    "sermon_development_session_mode"
  );
  const initialTranscript = typeof input.initialTranscript === "string" ? input.initialTranscript : "";
  const plannedAssistantTranscript = typeof input.assistantTranscript === "string" ? input.assistantTranscript : "";
  if (
    input.requireInitialExchange === true &&
    (!initialTranscript.trim() || !plannedAssistantTranscript.trim())
  ) {
    throw createSermonWorkspaceError(
      "A tracked development session must capture the initiating Dan turn and Chat reply",
      400,
      {
        requiredFields: ["initialTranscript", "assistantTranscript"],
        assistantTemplatePlaceholders: ["{{sessionId}}", "{{sermonTitle}}"]
      },
      "missing_sermon_development_initial_exchange"
    );
  }
  if (Boolean(initialTranscript.trim()) !== Boolean(plannedAssistantTranscript.trim())) {
    throw createSermonWorkspaceError(
      "Initial development capture requires both Dan's transcript and Chat's planned reply",
      400,
      { requiredFields: ["initialTranscript", "assistantTranscript"] },
      "incomplete_sermon_development_initial_exchange"
    );
  }

  const sessionId = normalizeString(input.sessionId)
    ? validateDocId(input.sessionId, "sessionId")
    : createId("sermon-session", `${sermonId} ${input.label || mode}`, deps);
  const docRef = sessionsCollection.doc(sessionId);
  const existing = await docRef.get();
  let action = "created";
  let session;
  if (existing.exists) {
    session = buildSermonDevelopmentSessionSummary(existing.data() || {}, sessionId);
    if (session.sermonId !== sermonId) {
      throw createSermonWorkspaceError(
        "Development session belongs to another sermon",
        409,
        { sessionId, sermonId, existingSermonId: session.sermonId },
        "sermon_development_session_conflict"
      );
    }
    action = "existing";
  } else {
    const nowIso = getNowIso(deps);
    session = {
      sessionId,
      sermonId,
      status: "active",
      mode,
      label: normalizeString(input.label) || `${mode === "walk" ? "Walk" : "Development"} session`,
      context: normalizeString(input.context),
      summary: "",
      rawTranscriptSourceId: "",
      turnCount: 0,
      danTurnCount: 0,
      assistantTurnCount: 0,
      checkpointCount: 0,
      startedAt: nowIso,
      endedAt: "",
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await docRef.create(session);
  }

  const sermon = buildSermonListSummary(sermonDoc.data() || {}, sermonId);
  let initialCapture = null;
  if (initialTranscript.trim()) {
    const assistantTranscript = plannedAssistantTranscript
      .replace(/\{\{sessionId\}\}/g, sessionId)
      .replace(/\{\{sermonTitle\}\}/g, sermon.title);
    initialCapture = await captureSermonDevelopmentTurn({
      sermonId,
      sessionId,
      transcript: initialTranscript,
      assistantTranscript,
      sourceMode: mode
    }, deps);
    const refreshed = await getRequiredSermonDevelopmentSession(sessionId, deps);
    session = buildSermonDevelopmentSessionSummary(refreshed.data, sessionId);
  }

  return {
    action,
    sermon,
    session: buildSermonDevelopmentSessionSummary(session, sessionId),
    initialCapture,
    storedAssistantTranscript: initialCapture?.assistantTurn?.transcript || ""
  };
}

async function listSermonDevelopmentSessions(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  const status = normalizeString(input.status);
  const mode = normalizeString(input.mode);
  const limit = normalizeLimit(input.limit);
  if (status && !SERMON_DEVELOPMENT_SESSION_STATUSES.includes(status)) {
    throw createSermonWorkspaceError(
      "Invalid development session status",
      400,
      { status, allowedValues: SERMON_DEVELOPMENT_SESSION_STATUSES },
      "invalid_sermon_development_session_status"
    );
  }
  if (mode && !SERMON_DEVELOPMENT_SESSION_MODES.includes(mode)) {
    throw createSermonWorkspaceError(
      "Invalid development session mode",
      400,
      { mode, allowedValues: SERMON_DEVELOPMENT_SESSION_MODES },
      "invalid_sermon_development_session_mode"
    );
  }

  const sessions = (await loadSermonDevelopmentRecords(
    getSermonDevelopmentSessionsCollection(deps),
    { sermonId, maxDocs: 10000 }
  ))
    .map(({ id, data }) => buildSermonDevelopmentSessionSummary(data, id))
    .filter((session) => !status || session.status === status)
    .filter((session) => !mode || session.mode === mode)
    .sort((left, right) => (right.startedAt || "").localeCompare(left.startedAt || ""))
    .slice(0, limit);
  return { count: sessions.length, sessions };
}

async function getRequiredSermonDevelopmentSession(sessionId, deps = {}) {
  const cleanSessionId = validateDocId(sessionId, "sessionId");
  const docRef = getSermonDevelopmentSessionsCollection(deps).doc(cleanSessionId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createSermonWorkspaceError(
      "Sermon development session not found",
      404,
      { sessionId: cleanSessionId },
      "sermon_development_session_not_found"
    );
  }
  return { sessionId: cleanSessionId, docRef, data: doc.data() || {} };
}

function requireDanCutAuthorization(input = {}, { plural = false } = {}) {
  const authorized = plural ? input.danAuthorizedCuts === true : input.danAuthorizedCut === true;
  const evidence = normalizeString(input.danApprovalEvidence);
  if (!authorized || !evidence) {
    throw createSermonWorkspaceError(
      "Only Dan may intentionally cut sermon material",
      403,
      {
        requiredAuthorizationField: plural ? "danAuthorizedCuts" : "danAuthorizedCut",
        requiredEvidenceField: "danApprovalEvidence"
      },
      "dan_cut_authorization_required"
    );
  }
  return evidence;
}

function buildMaterialStatusHistoryEntry(checkpoint = {}) {
  return {
    materialStatus: normalizeString(checkpoint.materialStatus) || "unplaced",
    canonicalTargets: normalizeStringArray(checkpoint.canonicalTargets),
    placementTarget: normalizeString(checkpoint.placementTarget),
    placementNotes: normalizeString(checkpoint.placementNotes),
    cutReason: normalizeString(checkpoint.cutReason),
    cutAuthorizedBy: normalizeString(checkpoint.cutAuthorizedBy),
    cutApprovalEvidence: normalizeString(checkpoint.cutApprovalEvidence),
    changedAt: normalizeString(checkpoint.materialStatusChangedAt || checkpoint.updatedAt || checkpoint.createdAt)
  };
}

function buildSermonDevelopmentTurnId(sessionId, sequence, transcript) {
  const digest = createHash("sha256")
    .update(`${sessionId}:${sequence}:${transcript}`)
    .digest("hex")
    .slice(0, 24);
  return `sermon-turn-${digest}`;
}

async function listSermonDevelopmentTurns(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  const sessionId = normalizeString(input.sessionId);
  const speaker = normalizeString(input.speaker);
  if (speaker && !SERMON_DEVELOPMENT_TURN_SPEAKERS.includes(speaker)) {
    throw createSermonWorkspaceError(
      "Invalid sermon development turn speaker",
      400,
      { speaker, allowedValues: SERMON_DEVELOPMENT_TURN_SPEAKERS },
      "invalid_sermon_development_turn_speaker"
    );
  }
  const turns = (await loadSermonDevelopmentRecords(
    getSermonDevelopmentTurnsCollection(deps),
    { sermonId, sessionId, maxDocs: 20000 }
  ))
    .map(({ id, data }) => buildSermonDevelopmentTurn(data, id))
    .filter((turn) => !speaker || turn.speaker === speaker)
    .sort((left, right) => input.sort === "desc"
      ? right.sequence - left.sequence
      : left.sequence - right.sequence)
    .slice(0, Math.min(Math.max(Number.parseInt(String(input.limit || 500), 10) || 500, 1), 2000));
  return { count: turns.length, turns };
}

async function captureSingleSermonDevelopmentTurn(input = {}, deps = {}) {
  const { sermonId } = await getRequiredSermonDoc(input.sermonId, deps);
  const sessionRecord = await getRequiredSermonDevelopmentSession(input.sessionId, deps);
  const session = buildSermonDevelopmentSessionSummary(sessionRecord.data, sessionRecord.sessionId);
  if (session.sermonId !== sermonId) {
    throw createSermonWorkspaceError(
      "Development session does not belong to this sermon",
      409,
      { sessionId: session.sessionId, sermonId, existingSermonId: session.sermonId },
      "sermon_development_session_sermon_mismatch"
    );
  }
  if (session.status === "closed") {
    throw createSermonWorkspaceError(
      "Development session is already closed",
      409,
      { sessionId: session.sessionId },
      "sermon_development_session_closed"
    );
  }

  const rawTranscript = typeof input.transcript === "string"
    ? input.transcript
    : typeof input.content === "string"
      ? input.content
      : "";
  if (!rawTranscript.trim()) {
    throw createSermonWorkspaceError(
      "Development turn requires the complete transcript Chat received",
      400,
      {},
      "missing_sermon_development_turn_transcript"
    );
  }
  if (rawTranscript.length > MAX_SERMON_DEVELOPMENT_TURN_LENGTH) {
    throw createSermonWorkspaceError(
      "Development turn transcript is too large",
      413,
      { maximumLength: MAX_SERMON_DEVELOPMENT_TURN_LENGTH },
      "sermon_development_turn_too_large"
    );
  }
  const speaker = normalizeEnum(
    input.speaker,
    SERMON_DEVELOPMENT_TURN_SPEAKERS,
    "dan",
    "sermon_development_turn_speaker"
  );
  const collection = getSermonDevelopmentTurnsCollection(deps);
  const existingRecords = await loadSermonDevelopmentRecords(collection, { sessionId: session.sessionId, maxDocs: 20000 });
  const requestedSequence = Number.parseInt(String(input.sequence || ""), 10);
  const sequence = Number.isInteger(requestedSequence) && requestedSequence > 0
    ? requestedSequence
    : existingRecords.reduce((maximum, record) => Math.max(maximum, Number(record.data.sequence) || 0), 0) + 1;
  const turnId = normalizeString(input.turnId)
    ? validateDocId(input.turnId, "turnId")
    : buildSermonDevelopmentTurnId(session.sessionId, sequence, rawTranscript);
  const sequenceConflict = existingRecords.find(({ id, data }) =>
    Number(data.sequence) === sequence && id !== turnId);
  if (sequenceConflict) {
    throw createSermonWorkspaceError(
      "A different development turn already uses this sequence",
      409,
      { sessionId: session.sessionId, sequence, existingTurnId: sequenceConflict.id },
      "sermon_development_turn_sequence_conflict"
    );
  }

  const transcriptSha256 = createHash("sha256").update(rawTranscript).digest("hex");
  const docRef = collection.doc(turnId);
  const existing = await docRef.get();
  let action = "created";
  let turn;
  if (existing.exists) {
    turn = { ...(existing.data() || {}), turnId };
    if (
      normalizeString(turn.sermonId) !== sermonId ||
      normalizeString(turn.sessionId) !== session.sessionId ||
      normalizeString(turn.speaker) !== speaker ||
      normalizeString(turn.transcriptSha256) !== transcriptSha256
    ) {
      throw createSermonWorkspaceError(
        "A different development turn is already saved with this id",
        409,
        { turnId },
        "sermon_development_turn_conflict"
      );
    }
    action = "replayed";
  } else {
    const nowIso = getNowIso(deps);
    turn = {
      turnId,
      sermonId,
      sessionId: session.sessionId,
      speaker,
      sequence,
      transcript: rawTranscript,
      transcriptSha256,
      checkpointIds: [],
      sourceMode: normalizeString(input.sourceMode) || session.mode,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await docRef.create(turn);
  }

  let checkpoints = [];
  if (Array.isArray(input.checkpoints) && input.checkpoints.length > 0) {
    const checkpointInputs = input.checkpoints.map((checkpoint, index) => ({
      ...checkpoint,
      checkpointId: normalizeString(checkpoint.checkpointId) || `${turnId}-checkpoint-${index + 1}`,
      sourceRefs: [
        ...normalizeSourceRefs(checkpoint.sourceRefs),
        { type: "development_turn", id: turnId, speaker, sequence }
      ]
    }));
    const saved = await saveSermonDevelopmentCheckpoint({
      sermonId,
      sessionId: session.sessionId,
      checkpoints: checkpointInputs,
      danAuthorizedCut: input.danAuthorizedCut,
      danApprovalEvidence: input.danApprovalEvidence
    }, deps, { allowActiveSessionWrite: true });
    checkpoints = saved.checkpoints;
    turn = {
      ...turn,
      checkpointIds: Array.from(new Set([
        ...normalizeStringArray(turn.checkpointIds),
        ...checkpoints.map((checkpoint) => checkpoint.checkpointId)
      ])),
      updatedAt: getNowIso(deps)
    };
    await docRef.set(turn);
  }

  const allTurns = await loadSermonDevelopmentRecords(collection, { sessionId: session.sessionId, maxDocs: 20000 });
  const danTurnCount = allTurns.filter(({ data }) => normalizeString(data.speaker) === "dan").length;
  const assistantTurnCount = allTurns.filter(({ data }) => normalizeString(data.speaker) === "assistant").length;
  const checkpointCount = deps.sermonDevelopmentCheckpointsCollection
    ? (await loadSermonDevelopmentRecords(
        getSermonDevelopmentCheckpointsCollection(deps),
        { sessionId: session.sessionId, maxDocs: 20000 }
      )).length
    : Number(sessionRecord.data.checkpointCount) || 0;
  await sessionRecord.docRef.set({
    ...sessionRecord.data,
    sessionId: session.sessionId,
    turnCount: allTurns.length,
    danTurnCount,
    assistantTurnCount,
    checkpointCount,
    updatedAt: getNowIso(deps)
  });

  return {
    action,
    turn: buildSermonDevelopmentTurn(turn, turnId),
    checkpoints,
    nextSequence: sequence + 1
  };
}

function hasExplicitAssistantWordingApproval(value = "") {
  const text = normalizeString(value)
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
  if (!text) return false;
  return [
    /\bsave (?:everything|all(?: of)? that|what|that) (?:you|chat) (?:just )?said\b/,
    /\bsave (?:that|it)(?: exact(?:ly)?(?: wording)?| wording| verbatim| word for word)\b/,
    /\bsave (?:exactly )?(?:how|the way) (?:you|chat) (?:just )?said (?:that|it)\b/,
    /\b(?:exactly|everything) what (?:you|chat) (?:just )?said\b.*\b(?:save|note|put|use|sermon|message)\b/,
    /\bwhat (?:you|chat) (?:just )?said\b.*\b(?:needs?|should|must|has) (?:to )?be\b/,
    /\b(?:that|it) needs to be (?:in|included in|used in) (?:the |this )?(?:sermon|message|notes)\b/,
    /\b(?:we (?:have|need|got) to|make sure (?:we|you)) (?:put|save|keep|include) that(?:\s+(?:in|as|there)\b|\b)/,
    /\bkeep (?:that|the) exact wording\b/,
    /\bi (?:really )?(?:like|love) (?:the )?exact (?:way|wording) (?:you|chat) (?:just )?said (?:that|it)\b/,
    /\b(?:that's|that is) the wording (?:that )?(?:needs|should|must) to be used\b/,
    /\bthat's (?:exactly )?it\b/
  ].some((pattern) => pattern.test(text));
}

function hasExplicitAssistantMaterialApproval(value = "") {
  const text = normalizeString(value)
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
  if (!text) return false;
  return [
    /\bsave (?:that|it)(?:\s+(?:movement|section|thought|idea|point|material|content|part))?\b/,
    /\b(?:include|included|use|keep) (?:all(?: of)? )?(?:that|it|both|everything|what (?:you|chat) (?:just )?said)\b/,
    /\b(?:go|move) forward with (?:that|it|all(?: of)? that|everything)\b/,
    /\bi (?:really )?(?:like|love) (?:all(?: of)? that|everything (?:you|chat) (?:just )?(?:said|mentioned))\b.*\b(?:include|included|use|keep|go forward|move forward)\b/,
    /\b(?:yes|yeah|yep)\b.*\b(?:include|included|use|keep) (?:that|it|both|all(?: of)? that|everything)\b/
  ].some((pattern) => pattern.test(text));
}

function checkpointPreservesApprovedAssistantMaterial(checkpoint, approvedContents = []) {
  if (!checkpoint || checkpoint.exactWording === true || approvedContents.length === 0) return false;
  const approvalContext = `${normalizeString(checkpoint.heading)} ${normalizeString(checkpoint.context)}`.toLowerCase();
  if (!/(?:approved|assistant-authored|chat-authored).*(?:assistant|chat|movement|material)|assistant-authored/.test(approvalContext)) {
    return false;
  }

  const candidate = normalizeString(checkpoint.content);
  const source = approvedContents.join("\n\n");
  if (!candidate || candidate.length < Math.min(250, Math.max(40, source.length * 0.25))) return false;

  const sourceWords = new Set(source.toLowerCase().replace(/[^a-z0-9']+/g, " ").split(" ").filter((word) => word.length >= 3));
  const candidateWords = candidate.toLowerCase().replace(/[^a-z0-9']+/g, " ").split(" ").filter((word) => word.length >= 3);
  if (candidateWords.length < 8) return false;
  const matchedWords = candidateWords.filter((word) => sourceWords.has(word)).length;
  return matchedWords / candidateWords.length >= 0.65;
}

function extractAssistantWritingBlocks(value = "") {
  const transcript = typeof value === "string" ? value : "";
  const blocks = [];
  const pattern = /:::writing(?:\{[^\n]*\})?\s*\n([\s\S]*?)\n:::/g;
  for (const match of transcript.matchAll(pattern)) {
    const content = normalizeString(match[1]);
    if (content) blocks.push(content);
  }
  return blocks;
}

function getApprovedAssistantContents(previousAssistantTurn) {
  if (!previousAssistantTurn || !normalizeString(previousAssistantTurn.transcript)) return [];
  const writingBlocks = extractAssistantWritingBlocks(previousAssistantTurn.transcript);
  return writingBlocks.length > 0
    ? writingBlocks
    : [normalizeString(previousAssistantTurn.transcript)];
}

function buildApprovedAssistantCheckpoints(previousAssistantTurn, checkpoints = [], approvalType = "exact_wording") {
  const approvedContents = getApprovedAssistantContents(previousAssistantTurn);
  if (approvedContents.length === 0) return [];
  const exactWording = approvalType === "exact_wording";
  const heading = exactWording ? "Approved Chat wording" : "Approved Chat material";
  const context = exactWording
    ? "Dan explicitly approved or asked to save the preceding Chat wording. Preserve its assistant authorship and exact wording until Dan shapes or cuts it."
    : "Dan explicitly approved including the preceding Chat material. Preserve its assistant authorship and substance for shaping; do not silently cut it or treat it as Dan's exact wording.";

  return approvedContents
    .filter((content) => !checkpoints.some((checkpoint) =>
      normalizeString(checkpoint.content) === normalizeString(content)))
    .map((content, index) => ({
      checkpointType: exactWording ? "verbatim" : "insight",
      heading: approvedContents.length > 1 ? `${heading} ${index + 1}` : heading,
      content,
      context,
      exactWording,
      materialStatus: "unplaced",
      sourceRefs: [
        {
          type: "development_turn",
          id: previousAssistantTurn.turnId,
          speaker: "assistant",
          sequence: previousAssistantTurn.sequence
        }
      ]
    }));
}

async function captureSermonDevelopmentTurn(input = {}, deps = {}) {
  const requestedSpeaker = normalizeString(input.speaker) || "dan";
  if (requestedSpeaker !== "dan") {
    return captureSingleSermonDevelopmentTurn(input, deps);
  }

  const assistantTranscript = typeof input.assistantTranscript === "string" ? input.assistantTranscript : "";
  const sessionRecord = await getRequiredSermonDevelopmentSession(input.sessionId, deps);
  const session = buildSermonDevelopmentSessionSummary(sessionRecord.data, sessionRecord.sessionId);
  const collection = getSermonDevelopmentTurnsCollection(deps);
  const existingTurns = (await loadSermonDevelopmentRecords(
    collection,
    { sessionId: session.sessionId, maxDocs: 20000 }
  )).map(({ id, data }) => buildSermonDevelopmentTurn(data, id))
    .sort((left, right) => left.sequence - right.sequence);
  const danTranscript = typeof input.transcript === "string" ? input.transcript : input.content;
  const danTranscriptSha256 = createHash("sha256").update(danTranscript || "").digest("hex");
  const assistantTranscriptSha256 = createHash("sha256").update(assistantTranscript).digest("hex");
  const lastTurn = existingTurns.at(-1);
  const penultimateTurn = existingTurns.at(-2);
  const completeReplay = Boolean(
    assistantTranscript.trim() &&
    penultimateTurn?.speaker === "dan" &&
    penultimateTurn.transcriptSha256 === danTranscriptSha256 &&
    lastTurn?.speaker === "assistant" &&
    lastTurn.transcriptSha256 === assistantTranscriptSha256
  );
  const partialReplay = Boolean(
    assistantTranscript.trim() &&
    lastTurn?.speaker === "dan" &&
    lastTurn.transcriptSha256 === danTranscriptSha256
  );
  const replayDanTurn = completeReplay ? penultimateTurn : partialReplay ? lastTurn : null;
  const turnsBeforeDan = replayDanTurn
    ? existingTurns.filter((turn) => turn.sequence < replayDanTurn.sequence)
    : existingTurns;
  const previousTurn = turnsBeforeDan.at(-1);
  const previousAssistantTurn = previousTurn?.speaker === "assistant" ? previousTurn : null;
  const exactWordingApprovalDetected = hasExplicitAssistantWordingApproval(danTranscript);
  const materialApprovalDetected = !exactWordingApprovalDetected && hasExplicitAssistantMaterialApproval(danTranscript);
  const approvalType = exactWordingApprovalDetected
    ? "exact_wording"
    : materialApprovalDetected
      ? "approved_material"
      : "";
  const approvalDetected = Boolean(approvalType);
  let checkpoints = Array.isArray(input.checkpoints) ? [...input.checkpoints] : [];
  const linkedReplayCheckpoints = [];
  for (const checkpointId of normalizeStringArray(replayDanTurn?.checkpointIds)) {
    const checkpointDoc = await getSermonDevelopmentCheckpointsCollection(deps).doc(checkpointId).get();
    if (checkpointDoc.exists) {
      linkedReplayCheckpoints.push(buildSermonDevelopmentCheckpoint(checkpointDoc.data() || {}, checkpointId));
    }
  }
  if (linkedReplayCheckpoints.length > 0 && checkpoints.length > 0) {
    checkpoints = checkpoints.filter((checkpoint) => !linkedReplayCheckpoints.some((existingCheckpoint) => {
      const requestedCheckpointId = normalizeString(checkpoint.checkpointId);
      if (requestedCheckpointId && requestedCheckpointId === existingCheckpoint.checkpointId) return true;
      return normalizeString(checkpoint.content) === normalizeString(existingCheckpoint.content) &&
        normalizeString(checkpoint.checkpointType) === normalizeString(existingCheckpoint.checkpointType);
    }));
  }
  const approvedAssistantContents = approvalDetected
    ? getApprovedAssistantContents(previousAssistantTurn)
    : [];
  const linkedReplayApprovalCheckpoints = approvalDetected
    ? linkedReplayCheckpoints.filter((checkpoint) =>
        approvedAssistantContents.some((content) =>
          normalizeString(checkpoint.content) === normalizeString(content)) ||
        (
          approvalType === "approved_material" &&
          checkpointPreservesApprovedAssistantMaterial(checkpoint, approvedAssistantContents)
        ))
    : [];
  const approvedAssistantAlreadyPreserved = approvedAssistantContents.length > 0 &&
    (
      linkedReplayApprovalCheckpoints.length > 0 ||
      approvedAssistantContents.every((content) => checkpoints.some((checkpoint) =>
        normalizeString(checkpoint.content) === normalizeString(content))) ||
      (
        approvalType === "approved_material" &&
        checkpoints.some((checkpoint) =>
          checkpointPreservesApprovedAssistantMaterial(checkpoint, approvedAssistantContents))
      )
    );
  const approvedAssistantCheckpoints = approvalDetected && !approvedAssistantAlreadyPreserved
    ? buildApprovedAssistantCheckpoints(previousAssistantTurn, checkpoints, approvalType)
    : [];
  if (approvedAssistantCheckpoints.length > 0) checkpoints.push(...approvedAssistantCheckpoints);

  if (!assistantTranscript.trim()) {
    const danCapture = await captureSingleSermonDevelopmentTurn({
      ...input,
      speaker: "dan",
      transcript: danTranscript,
      checkpoints
    }, deps);
    return {
      ...danCapture,
      assistantAction: "not_captured",
      assistantTurn: null,
      captureComplete: false,
      storedAssistantTranscript: "",
      requiredNextAction: "Replay captureSermonDevelopmentTurn with this same Dan transcript and the exact planned assistantTranscript before replying.",
      assistantApproval: {
        detected: approvalDetected,
        approvalType,
        preserved: approvedAssistantCheckpoints.length > 0 || approvedAssistantAlreadyPreserved,
        approvedAssistantTurnId: previousAssistantTurn?.turnId || "",
        checkpointId: approvedAssistantCheckpoints.length > 0
          ? danCapture.checkpoints.find((checkpoint) => checkpoint.content === approvedAssistantCheckpoints[0].content)?.checkpointId || ""
          : linkedReplayApprovalCheckpoints[0]?.checkpointId || "",
        checkpointIds: Array.from(new Set([
          ...approvedAssistantCheckpoints
            .map((approvedCheckpoint) => danCapture.checkpoints.find(
              (checkpoint) => checkpoint.content === approvedCheckpoint.content)?.checkpointId || "")
            .filter(Boolean),
          ...linkedReplayApprovalCheckpoints.map((checkpoint) => checkpoint.checkpointId)
        ]))
      }
    };
  }

  const maximumSequence = existingTurns.reduce(
    (maximum, turn) => Math.max(maximum, Number(turn.sequence) || 0),
    0
  );
  const requestedSequence = Number.parseInt(String(input.sequence || ""), 10);
  const danSequence = replayDanTurn?.sequence || (
    Number.isInteger(requestedSequence) && requestedSequence > maximumSequence
      ? requestedSequence
      : maximumSequence + 1
  );
  const danCapture = await captureSingleSermonDevelopmentTurn({
    ...input,
    turnId: replayDanTurn?.turnId || input.turnId,
    speaker: "dan",
    sequence: danSequence,
    transcript: danTranscript,
    checkpoints
  }, deps);

  let assistantCapture = null;
  if (assistantTranscript.trim()) {
    const replayAssistantTurn = completeReplay ? lastTurn : null;
    assistantCapture = await captureSingleSermonDevelopmentTurn({
      sermonId: session.sermonId,
      sessionId: session.sessionId,
      turnId: replayAssistantTurn?.turnId || input.assistantTurnId,
      speaker: "assistant",
      sequence: replayAssistantTurn?.sequence || danSequence + 1,
      transcript: assistantTranscript,
      sourceMode: input.sourceMode || session.mode
    }, deps);
  }

  return {
    ...danCapture,
    assistantAction: assistantCapture?.action || "not_captured",
    assistantTurn: assistantCapture?.turn || null,
    captureComplete: Boolean(assistantCapture?.turn),
    storedAssistantTranscript: assistantCapture?.turn?.transcript || "",
    requiredNextAction: assistantCapture?.turn
      ? "Output storedAssistantTranscript verbatim."
      : "Replay captureSermonDevelopmentTurn with this same Dan transcript and the exact planned assistantTranscript before replying.",
    assistantApproval: {
      detected: approvalDetected,
      approvalType,
      preserved: approvedAssistantCheckpoints.length > 0 || approvedAssistantAlreadyPreserved,
      approvedAssistantTurnId: previousAssistantTurn?.turnId || "",
      checkpointId: approvedAssistantCheckpoints.length > 0
        ? danCapture.checkpoints.find((checkpoint) => checkpoint.content === approvedAssistantCheckpoints[0].content)?.checkpointId || ""
        : linkedReplayApprovalCheckpoints[0]?.checkpointId || "",
      checkpointIds: Array.from(new Set([
        ...approvedAssistantCheckpoints
          .map((approvedCheckpoint) => danCapture.checkpoints.find(
            (checkpoint) => checkpoint.content === approvedCheckpoint.content)?.checkpointId || "")
          .filter(Boolean),
        ...linkedReplayApprovalCheckpoints.map((checkpoint) => checkpoint.checkpointId)
      ]))
    },
    nextSequence: assistantCapture?.nextSequence || danCapture.nextSequence
  };
}

function normalizeDevelopmentCheckpointInput(input = {}, fallback = {}) {
  const content = truncateImportedText(input.content || input.text || fallback.content);
  if (!content) {
    throw createSermonWorkspaceError(
      "Development checkpoint requires content",
      400,
      {},
      "missing_sermon_development_checkpoint_content"
    );
  }
  const checkpointType = normalizeEnum(
    input.checkpointType || input.type,
    SERMON_DEVELOPMENT_CHECKPOINT_TYPES,
    normalizeString(fallback.checkpointType) || "insight",
    "sermon_development_checkpoint_type"
  );
  const requestedCanonicalTargets = normalizeStringArray(input.canonicalTargets || fallback.canonicalTargets);
  const materialStatus = normalizeEnum(
    input.materialStatus || fallback.materialStatus,
    SERMON_MATERIAL_STATUSES,
    requestedCanonicalTargets.length > 0 ? "placed" : "unplaced",
    "sermon_material_status"
  );
  const canonicalTargets = materialStatus === "placed" ? requestedCanonicalTargets : [];
  const placementTarget = normalizeString(input.placementTarget || fallback.placementTarget);
  if (materialStatus === "placed" && !placementTarget && canonicalTargets.length === 0) {
    throw createSermonWorkspaceError(
      "Placed sermon material requires a placement target or canonical target",
      400,
      { materialStatus },
      "sermon_material_placement_target_required"
    );
  }
  return {
    checkpointType,
    heading: normalizeString(input.heading || fallback.heading),
    content,
    context: normalizeString(input.context || fallback.context),
    exactWording: input.exactWording === true || ["verbatim", "key_line"].includes(checkpointType),
    canonicalTargets,
    materialStatus,
    placementTarget: materialStatus === "placed" ? placementTarget : "",
    placementNotes: materialStatus === "placed" ? normalizeString(input.placementNotes || fallback.placementNotes) : "",
    cutReason: materialStatus === "intentionally_cut" ? normalizeString(input.cutReason || fallback.cutReason) : "",
    materialStatusChangedAt: normalizeString(input.materialStatusChangedAt || fallback.materialStatusChangedAt),
    sourceRefs: normalizeSourceRefs(input.sourceRefs || fallback.sourceRefs)
  };
}

async function saveSermonDevelopmentCheckpoint(input = {}, deps = {}, options = {}) {
  const { sermonId, doc } = await getRequiredSermonDoc(input.sermonId, deps);
  const sessionId = normalizeString(input.sessionId);
  let sessionRecord = null;
  if (sessionId) {
    sessionRecord = await getRequiredSermonDevelopmentSession(sessionId, deps);
    if (normalizeString(sessionRecord.data.sermonId) !== sermonId) {
      throw createSermonWorkspaceError(
        "Development session does not belong to this sermon",
        409,
        { sessionId, sermonId },
        "sermon_development_session_sermon_mismatch"
      );
    }
    if (normalizeString(sessionRecord.data.status) === "closed") {
      throw createSermonWorkspaceError(
        "Development session is already closed",
        409,
        { sessionId },
        "sermon_development_session_closed"
      );
    }
  }

  if (options.allowActiveSessionWrite !== true) {
    const activeSessionRecords = sessionRecord
      ? [{ id: sessionRecord.sessionId, data: sessionRecord.data }]
      : deps.sermonDevelopmentSessionsCollection
        ? await loadSermonDevelopmentRecords(
          getSermonDevelopmentSessionsCollection(deps),
          { sermonId, maxDocs: 1000 }
        )
        : [];
    const activeSessionIds = activeSessionRecords
      .filter(({ data }) => normalizeString(data.status) === "active")
      .map(({ id, data }) => normalizeString(data.sessionId || id))
      .filter(Boolean);
    if (activeSessionIds.length > 0) {
      throw createSermonWorkspaceError(
        "Active sermon development checkpoints must be saved with the captured conversation turn",
        409,
        {
          sermonId,
          activeSessionIds,
          requiredOperation: "captureSermonDevelopmentTurn",
          requiredArguments: ["transcript", "assistantTranscript", "checkpoints"]
        },
        "sermon_development_turn_capture_required"
      );
    }
  }

  const rawItems = Array.isArray(input.checkpoints) ? input.checkpoints : [input];
  if (rawItems.length === 0 || rawItems.length > 25 || rawItems.some((item) => !isPlainObject(item))) {
    throw createSermonWorkspaceError(
      "Development checkpoint batch must contain 1 to 25 objects",
      400,
      { count: rawItems.length },
      "invalid_sermon_development_checkpoint_batch"
    );
  }

  const checkpointsCollection = getSermonDevelopmentCheckpointsCollection(deps);
  const nowIso = getNowIso(deps);
  const checkpoints = [];
  for (const rawItem of rawItems) {
    const normalized = normalizeDevelopmentCheckpointInput(rawItem, input);
    let cutApprovalEvidence = "";
    if (normalized.materialStatus === "intentionally_cut") {
      if (!normalized.cutReason) {
        throw createSermonWorkspaceError(
          "Intentionally cut sermon material requires a reason",
          400,
          {},
          "sermon_material_cut_reason_required"
        );
      }
      cutApprovalEvidence = requireDanCutAuthorization({
        danAuthorizedCut: rawItem.danAuthorizedCut === true || input.danAuthorizedCut === true,
        danApprovalEvidence: rawItem.danApprovalEvidence || input.danApprovalEvidence
      });
    }
    const checkpointId = normalizeString(rawItem.checkpointId)
      ? validateDocId(rawItem.checkpointId, "checkpointId")
      : createId("sermon-checkpoint", `${sermonId} ${normalized.heading || normalized.checkpointType}`, deps);
    const checkpoint = {
      ...normalized,
      checkpointId,
      sermonId,
      sessionId,
      materialStatusChangedAt: normalized.materialStatusChangedAt || nowIso,
      cutAuthorizedBy: normalized.materialStatus === "intentionally_cut" ? "dan" : "",
      cutApprovalEvidence,
      cutAuthorizedAt: normalized.materialStatus === "intentionally_cut" ? nowIso : "",
      materialStatusHistory: [],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    const checkpointRef = checkpointsCollection.doc(checkpointId);
    const existingCheckpoint = await checkpointRef.get();
    if (existingCheckpoint.exists) {
      const existingValue = buildSermonDevelopmentCheckpoint(existingCheckpoint.data() || {}, checkpointId);
      const desiredValue = buildSermonDevelopmentCheckpoint(checkpoint, checkpointId);
      const comparable = (value) => JSON.stringify({
        sermonId: value.sermonId,
        sessionId: value.sessionId,
        checkpointType: value.checkpointType,
        heading: value.heading,
        content: value.content,
        context: value.context,
        exactWording: value.exactWording,
        canonicalTargets: value.canonicalTargets,
        materialStatus: value.materialStatus,
        placementTarget: value.placementTarget,
        placementNotes: value.placementNotes,
        cutReason: value.cutReason,
        cutAuthorizedBy: value.cutAuthorizedBy,
        cutApprovalEvidence: value.cutApprovalEvidence,
        sourceRefs: value.sourceRefs
      });
      if (comparable(existingValue) !== comparable(desiredValue)) {
        throw createSermonWorkspaceError(
          "A different development checkpoint is already saved with this id",
          409,
          { checkpointId },
          "sermon_development_checkpoint_conflict"
        );
      }
      checkpoints.push(existingValue);
      continue;
    }
    await checkpointRef.create(checkpoint);
    checkpoints.push(buildSermonDevelopmentCheckpoint(checkpoint, checkpointId));
  }

  if (sessionRecord) {
    const sessionCheckpoints = await loadSermonDevelopmentRecords(checkpointsCollection, { sessionId });
    await sessionRecord.docRef.set({
      ...sessionRecord.data,
      sessionId,
      checkpointCount: sessionCheckpoints.length,
      updatedAt: nowIso
    });
  }
  const nextSermon = {
    ...(doc.data() || {}),
    sermonId,
    lastDevelopmentAt: nowIso,
    updatedAt: nowIso
  };
  await getSermonsCollection(deps).doc(sermonId).set(nextSermon);

  return {
    count: checkpoints.length,
    checkpoints,
    sessionId,
    sermon: buildSermonListSummary(nextSermon, sermonId)
  };
}

async function listSermonDevelopmentCheckpoints(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  const sessionId = normalizeString(input.sessionId);
  const checkpointType = normalizeString(input.checkpointType);
  const materialStatus = normalizeString(input.materialStatus);
  const query = normalizeString(input.query).toLowerCase();
  const requestedLimit = Number.parseInt(String(input.limit ?? DEFAULT_LIMIT), 10);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 500)
    : DEFAULT_LIMIT;
  if (checkpointType && !SERMON_DEVELOPMENT_CHECKPOINT_TYPES.includes(checkpointType)) {
    throw createSermonWorkspaceError(
      "Invalid development checkpoint type",
      400,
      { checkpointType, allowedValues: SERMON_DEVELOPMENT_CHECKPOINT_TYPES },
      "invalid_sermon_development_checkpoint_type"
    );
  }
  if (materialStatus && !SERMON_MATERIAL_STATUSES.includes(materialStatus)) {
    throw createSermonWorkspaceError(
      "Invalid sermon material status",
      400,
      { materialStatus, allowedValues: SERMON_MATERIAL_STATUSES },
      "invalid_sermon_material_status"
    );
  }
  const checkpoints = (await loadSermonDevelopmentRecords(
    getSermonDevelopmentCheckpointsCollection(deps),
    { sermonId, sessionId, maxDocs: 20000 }
  ))
    .map(({ id, data }) => buildSermonDevelopmentCheckpoint(data, id))
    .filter((checkpoint) => !checkpointType || checkpoint.checkpointType === checkpointType)
    .filter((checkpoint) => !materialStatus || checkpoint.materialStatus === materialStatus)
    .filter((checkpoint) => !query || [checkpoint.heading, checkpoint.content, checkpoint.context]
      .join(" ").toLowerCase().includes(query))
    .sort((left, right) => input.sort === "asc"
      ? (left.createdAt || "").localeCompare(right.createdAt || "")
      : (right.createdAt || "").localeCompare(left.createdAt || ""))
    .slice(0, limit);
  return { count: checkpoints.length, checkpoints };
}

async function getSermonMaterialInventory(input = {}, deps = {}) {
  const { sermon } = await getSermon({ sermonId: input.sermonId }, deps);
  const materialStatus = normalizeString(input.materialStatus);
  const checkpointType = normalizeString(input.checkpointType);
  if (materialStatus && !SERMON_MATERIAL_STATUSES.includes(materialStatus)) {
    throw createSermonWorkspaceError(
      "Invalid sermon material status",
      400,
      { materialStatus, allowedValues: SERMON_MATERIAL_STATUSES },
      "invalid_sermon_material_status"
    );
  }
  if (checkpointType && !SERMON_DEVELOPMENT_CHECKPOINT_TYPES.includes(checkpointType)) {
    throw createSermonWorkspaceError(
      "Invalid development checkpoint type",
      400,
      { checkpointType, allowedValues: SERMON_DEVELOPMENT_CHECKPOINT_TYPES },
      "invalid_sermon_development_checkpoint_type"
    );
  }
  const all = (await loadSermonDevelopmentRecords(
    getSermonDevelopmentCheckpointsCollection(deps),
    { sermonId: sermon.sermonId, maxDocs: 20000 }
  )).map(({ id, data }) => buildSermonDevelopmentCheckpoint(data, id));
  const byStatus = countMapToObject(all.reduce((counts, checkpoint) => {
    incrementCount(counts, checkpoint.materialStatus);
    return counts;
  }, new Map()));
  const byType = countMapToObject(all.reduce((counts, checkpoint) => {
    incrementCount(counts, checkpoint.checkpointType);
    return counts;
  }, new Map()));
  const placedByTarget = countMapToObject(all
    .filter((checkpoint) => checkpoint.materialStatus === "placed")
    .reduce((counts, checkpoint) => {
      incrementCount(counts, checkpoint.placementTarget || checkpoint.canonicalTargets.join(", ") || "unspecified");
      return counts;
    }, new Map()));
  const checkpoints = all
    .filter((checkpoint) => !materialStatus || checkpoint.materialStatus === materialStatus)
    .filter((checkpoint) => !checkpointType || checkpoint.checkpointType === checkpointType)
    .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""))
    .slice(0, normalizeLimit(input.limit || 100));
  return {
    sermon: buildSermonListSummary(sermon, sermon.sermonId),
    materialFingerprint: buildSermonMaterialFingerprint(all),
    summary: {
      total: all.length,
      placed: byStatus.placed || 0,
      unplaced: byStatus.unplaced || 0,
      intentionallyCut: byStatus.intentionally_cut || 0,
      unplacedAnchorLines: all.filter((checkpoint) =>
        checkpoint.materialStatus === "unplaced" && ["key_line", "verbatim"].includes(checkpoint.checkpointType)).length,
      unplacedIllustrations: all.filter((checkpoint) =>
        checkpoint.materialStatus === "unplaced" && checkpoint.checkpointType === "illustration").length
    },
    byStatus,
    byType,
    placedByTarget,
    count: checkpoints.length,
    checkpoints
  };
}

function normalizeSermonMaterialPlacementDecisions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw createSermonWorkspaceError(
      "At least one material-placement decision is required",
      400,
      {},
      "sermon_material_placement_decisions_required"
    );
  }
  if (value.length > 500) {
    throw createSermonWorkspaceError(
      "A material-placement plan may contain at most 500 decisions",
      400,
      { count: value.length, maximum: 500 },
      "sermon_material_placement_plan_too_large"
    );
  }

  const checkpointIds = new Set();
  return value.map((rawDecision) => {
    const decision = isPlainObject(rawDecision) ? rawDecision : {};
    const checkpointId = validateDocId(decision.checkpointId, "checkpointId");
    if (checkpointIds.has(checkpointId)) {
      throw createSermonWorkspaceError(
        "A material-placement plan cannot include the same checkpoint twice",
        400,
        { checkpointId },
        "duplicate_sermon_material_placement_decision"
      );
    }
    checkpointIds.add(checkpointId);
    const materialStatus = normalizeString(decision.materialStatus);
    if (!SERMON_MATERIAL_STATUSES.includes(materialStatus)) {
      throw createSermonWorkspaceError(
        "Invalid sermon material status",
        400,
        { checkpointId, materialStatus, allowedValues: SERMON_MATERIAL_STATUSES },
        "invalid_sermon_material_status"
      );
    }
    const requestedCanonicalTargets = normalizeStringArray(decision.canonicalTargets);
    const canonicalTargets = materialStatus === "placed" ? requestedCanonicalTargets : [];
    const placementTarget = normalizeString(decision.placementTarget);
    if (materialStatus === "placed" && !placementTarget && canonicalTargets.length === 0) {
      throw createSermonWorkspaceError(
        "Placed sermon material requires a placement target or canonical target",
        400,
        { checkpointId },
        "sermon_material_placement_target_required"
      );
    }
    const cutReason = materialStatus === "intentionally_cut" ? normalizeString(decision.cutReason) : "";
    if (materialStatus === "intentionally_cut" && !cutReason) {
      throw createSermonWorkspaceError(
        "Intentionally cut sermon material requires a reason",
        400,
        { checkpointId },
        "sermon_material_cut_reason_required"
      );
    }
    return {
      checkpointId,
      materialStatus,
      placementTarget: materialStatus === "placed" ? placementTarget : "",
      placementNotes: materialStatus === "placed" ? normalizeString(decision.placementNotes) : "",
      cutReason,
      canonicalTargets
    };
  }).sort((left, right) => left.checkpointId.localeCompare(right.checkpointId));
}

async function proposeSermonMaterialPlacement(input = {}, deps = {}) {
  const { sermon } = await getSermon({ sermonId: input.sermonId }, deps);
  const all = (await loadSermonDevelopmentRecords(
    getSermonDevelopmentCheckpointsCollection(deps),
    { sermonId: sermon.sermonId, maxDocs: 20000 }
  )).map(({ id, data }) => buildSermonDevelopmentCheckpoint(data, id));
  const byId = new Map(all.map((checkpoint) => [checkpoint.checkpointId, checkpoint]));
  const decisions = normalizeSermonMaterialPlacementDecisions(input.decisions);

  for (const decision of decisions) {
    if (!byId.has(decision.checkpointId)) {
      throw createSermonWorkspaceError(
        "A material-placement checkpoint does not belong to this sermon",
        409,
        { sermonId: sermon.sermonId, checkpointId: decision.checkpointId },
        "sermon_material_placement_checkpoint_mismatch"
      );
    }
  }

  const requireAllUnplaced = input.requireAllUnplaced !== false;
  const decisionIds = new Set(decisions.map((decision) => decision.checkpointId));
  const omittedUnplacedCheckpointIds = all
    .filter((checkpoint) => checkpoint.materialStatus === "unplaced" && !decisionIds.has(checkpoint.checkpointId))
    .map((checkpoint) => checkpoint.checkpointId)
    .sort();
  if (requireAllUnplaced && omittedUnplacedCheckpointIds.length > 0) {
    throw createSermonWorkspaceError(
      "The material-placement plan does not resolve every unplaced checkpoint",
      409,
      { sermonId: sermon.sermonId, omittedUnplacedCheckpointIds },
      "sermon_material_placement_plan_incomplete"
    );
  }

  const proposed = all.map((checkpoint) => {
    const decision = decisions.find((item) => item.checkpointId === checkpoint.checkpointId);
    return decision ? { ...checkpoint, ...decision } : checkpoint;
  });
  const countStatuses = (checkpoints) => ({
    placed: checkpoints.filter((checkpoint) => checkpoint.materialStatus === "placed").length,
    unplaced: checkpoints.filter((checkpoint) => checkpoint.materialStatus === "unplaced").length,
    intentionallyCut: checkpoints.filter((checkpoint) => checkpoint.materialStatus === "intentionally_cut").length
  });
  const baseMaterialFingerprint = buildSermonMaterialFingerprint(all);
  const planHash = createHash("sha256").update(JSON.stringify({
    sermonId: sermon.sermonId,
    baseMaterialFingerprint,
    requireAllUnplaced,
    decisions
  })).digest("hex");

  return {
    sermon: buildSermonListSummary(sermon, sermon.sermonId),
    planHash,
    baseMaterialFingerprint,
    proposedMaterialFingerprint: buildSermonMaterialFingerprint(proposed),
    requireAllUnplaced,
    decisionCount: decisions.length,
    before: countStatuses(all),
    after: countStatuses(proposed),
    omittedUnplacedCheckpointIds,
    decisions: decisions.map((decision) => ({
      ...decision,
      checkpointType: byId.get(decision.checkpointId).checkpointType,
      heading: byId.get(decision.checkpointId).heading,
      content: byId.get(decision.checkpointId).content,
      previousMaterialStatus: byId.get(decision.checkpointId).materialStatus
    }))
  };
}

async function applySermonMaterialPlacementPlan(input = {}, deps = {}) {
  if (input.confirmed !== true) {
    throw createSermonWorkspaceError(
      "Material-placement plans require explicit confirmation",
      400,
      {},
      "sermon_material_placement_confirmation_required"
    );
  }
  const expectedPlanHash = normalizeString(input.expectedPlanHash);
  if (!expectedPlanHash) {
    throw createSermonWorkspaceError(
      "expectedPlanHash is required",
      400,
      {},
      "sermon_material_placement_plan_hash_required"
    );
  }
  const proposal = await proposeSermonMaterialPlacement(input, deps);
  const includesCut = proposal.decisions.some((decision) => decision.materialStatus === "intentionally_cut");
  const cutApprovalEvidence = includesCut
    ? requireDanCutAuthorization(input, { plural: true })
    : "";
  if (proposal.planHash !== expectedPlanHash) {
    throw createSermonWorkspaceError(
      "The sermon material changed after this placement plan was reviewed",
      409,
      {
        expectedPlanHash,
        currentPlanHash: proposal.planHash,
        currentMaterialFingerprint: proposal.baseMaterialFingerprint,
        nextAction: "Run proposeSermonMaterialPlacement again and confirm the new plan."
      },
      "stale_sermon_material_placement_plan"
    );
  }

  const collection = getSermonDevelopmentCheckpointsCollection(deps);
  const nowIso = getNowIso(deps);
  const writes = [];
  for (const decision of proposal.decisions) {
    const docRef = collection.doc(decision.checkpointId);
    const doc = await docRef.get();
    const current = doc.data() || {};
    const materialStatusHistory = [
      ...(Array.isArray(current.materialStatusHistory) ? current.materialStatusHistory.filter(isPlainObject) : []),
      buildMaterialStatusHistoryEntry(current)
    ];
    writes.push({
      docRef,
      value: {
        ...current,
        checkpointId: decision.checkpointId,
        materialStatus: decision.materialStatus,
        canonicalTargets: decision.canonicalTargets,
        placementTarget: decision.placementTarget,
        placementNotes: decision.placementNotes,
        cutReason: decision.cutReason,
        cutAuthorizedBy: decision.materialStatus === "intentionally_cut" ? "dan" : "",
        cutApprovalEvidence: decision.materialStatus === "intentionally_cut" ? cutApprovalEvidence : "",
        cutAuthorizedAt: decision.materialStatus === "intentionally_cut" ? nowIso : "",
        materialStatusHistory,
        materialStatusChangedAt: nowIso,
        updatedAt: nowIso
      }
    });
  }
  if (collection.firestore && typeof collection.firestore.batch === "function") {
    const batch = collection.firestore.batch();
    for (const write of writes) batch.set(write.docRef, write.value);
    await batch.commit();
  } else {
    await Promise.all(writes.map((write) => write.docRef.set(write.value)));
  }

  return {
    action: "applied",
    sermonId: proposal.sermon.sermonId,
    appliedCount: writes.length,
    planHash: proposal.planHash,
    inventory: await getSermonMaterialInventory({ sermonId: proposal.sermon.sermonId, limit: 200 }, deps)
  };
}

async function updateSermonDevelopmentCheckpointPlacement(input = {}, deps = {}) {
  const checkpointId = validateDocId(input.checkpointId, "checkpointId");
  const collection = getSermonDevelopmentCheckpointsCollection(deps);
  const docRef = collection.doc(checkpointId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createSermonWorkspaceError(
      "Development checkpoint not found",
      404,
      { checkpointId },
      "sermon_development_checkpoint_not_found"
    );
  }
  const current = { ...(doc.data() || {}), checkpointId };
  const materialStatus = normalizeEnum(
    input.materialStatus,
    SERMON_MATERIAL_STATUSES,
    "unplaced",
    "sermon_material_status"
  );
  const currentCheckpoint = buildSermonDevelopmentCheckpoint(current, checkpointId);
  const requestedCanonicalTargets = Object.prototype.hasOwnProperty.call(input, "canonicalTargets")
    ? normalizeStringArray(input.canonicalTargets)
    : currentCheckpoint.materialStatus === "placed"
      ? currentCheckpoint.canonicalTargets
      : [];
  const canonicalTargets = materialStatus === "placed" ? requestedCanonicalTargets : [];
  const placementTarget = normalizeString(input.placementTarget);
  if (materialStatus === "placed" && !placementTarget && canonicalTargets.length === 0) {
    throw createSermonWorkspaceError(
      "Placed sermon material requires a placement target or canonical target",
      400,
      { checkpointId },
      "sermon_material_placement_target_required"
    );
  }
  const cutReason = materialStatus === "intentionally_cut" ? normalizeString(input.cutReason) : "";
  let cutApprovalEvidence = "";
  if (materialStatus === "intentionally_cut") {
    if (!cutReason) {
      throw createSermonWorkspaceError(
        "Intentionally cut sermon material requires a reason",
        400,
        { checkpointId },
        "sermon_material_cut_reason_required"
      );
    }
    cutApprovalEvidence = requireDanCutAuthorization(input);
  }
  const nowIso = getNowIso(deps);
  const next = {
    ...current,
    materialStatus,
    canonicalTargets,
    placementTarget: materialStatus === "placed" ? placementTarget : "",
    placementNotes: materialStatus === "placed" ? normalizeString(input.placementNotes) : "",
    cutReason,
    cutAuthorizedBy: materialStatus === "intentionally_cut" ? "dan" : "",
    cutApprovalEvidence,
    cutAuthorizedAt: materialStatus === "intentionally_cut" ? nowIso : "",
    materialStatusHistory: [
      ...(Array.isArray(current.materialStatusHistory) ? current.materialStatusHistory.filter(isPlainObject) : []),
      buildMaterialStatusHistoryEntry(current)
    ],
    materialStatusChangedAt: nowIso,
    updatedAt: nowIso
  };
  await docRef.set(next);
  return {
    checkpoint: buildSermonDevelopmentCheckpoint(next, checkpointId),
    inventory: await getSermonMaterialInventory({ sermonId: current.sermonId, limit: 1 }, deps)
  };
}

function formatSermonDevelopmentTurns(turns = []) {
  return turns
    .filter((turn) => typeof turn.transcript === "string" && turn.transcript.trim())
    .sort((left, right) => Number(left.sequence) - Number(right.sequence))
    .map((turn) => [
      `${normalizeString(turn.speaker) === "assistant" ? "ASSISTANT" : "DAN"} TURN ${Number(turn.sequence) || 0}`,
      turn.transcript
    ].join("\n"))
    .join("\n\n");
}

function normalizeExpectedDanTurnCount(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return null;
    throw createSermonWorkspaceError(
      "Finalizing a development session requires the expected Dan-turn count",
      400,
      { requiredField: "expectedDanTurnCount" },
      "missing_expected_sermon_development_turn_count"
    );
  }
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw createSermonWorkspaceError(
      "Expected Dan-turn count must be a non-negative integer",
      400,
      { expectedDanTurnCount: value },
      "invalid_expected_sermon_development_turn_count"
    );
  }
  return count;
}

async function closeSermonDevelopmentSession(input = {}, deps = {}) {
  const sessionRecord = await getRequiredSermonDevelopmentSession(input.sessionId, deps);
  const session = buildSermonDevelopmentSessionSummary(sessionRecord.data, sessionRecord.sessionId);
  const expectedDanTurnCount = normalizeExpectedDanTurnCount(input.expectedDanTurnCount);
  if (session.status === "closed") {
    if (expectedDanTurnCount !== null && session.danTurnCount !== expectedDanTurnCount) {
      throw createSermonWorkspaceError(
        "Closed development session does not contain the expected number of Dan turns",
        409,
        {
          sessionId: session.sessionId,
          expectedDanTurnCount,
          actualDanTurnCount: session.danTurnCount
        },
        "sermon_development_turn_count_mismatch"
      );
    }
    return { action: "already_closed", session };
  }
  if (
    input.requireNonLiveSession === true &&
    ["voice", "chat", "walk", "study"].includes(session.mode)
  ) {
    throw createSermonWorkspaceError(
      "Interactive development sessions must be closed through the count-verified final exchange",
      409,
      {
        sessionId: session.sessionId,
        mode: session.mode,
        requiredOperation: "finalizeSermonDevelopmentSession"
      },
      "sermon_development_final_exchange_required"
    );
  }

  const turnRecords = deps.sermonDevelopmentTurnsCollection
    ? await loadSermonDevelopmentRecords(
      getSermonDevelopmentTurnsCollection(deps),
      { sessionId: session.sessionId, maxDocs: 20000 }
    )
    : [];
  const turns = turnRecords.map(({ id, data }) => buildSermonDevelopmentTurn(data, id));
  const danTurnCount = turns.filter((turn) => turn.speaker === "dan").length;
  if (expectedDanTurnCount !== null && danTurnCount !== expectedDanTurnCount) {
    throw createSermonWorkspaceError(
      "Development session does not contain the expected number of Dan turns",
      409,
      {
        sessionId: session.sessionId,
        expectedDanTurnCount,
        actualDanTurnCount: danTurnCount
      },
      "sermon_development_turn_count_mismatch"
    );
  }

  let summaryCheckpoint = null;
  if (normalizeString(input.summary)) {
    const result = await saveSermonDevelopmentCheckpoint({
      sermonId: session.sermonId,
      sessionId: session.sessionId,
      checkpointType: "summary",
      heading: normalizeString(input.summaryHeading) || "Session summary",
      content: input.summary
    }, deps, { allowActiveSessionWrite: true });
    summaryCheckpoint = result.checkpoints[0];
  }

  const danTurns = turns.filter((turn) => turn.speaker === "dan");
  const assistantTurnCount = turns.filter((turn) => turn.speaker === "assistant").length;
  const transcriptMaterial = typeof input.rawTranscript === "string" && input.rawTranscript.trim()
    ? input.rawTranscript
    : formatSermonDevelopmentTurns(danTurns);

  let transcriptSource = null;
  if (transcriptMaterial.trim()) {
    transcriptSource = (await createSermonSource({
      sermonId: session.sermonId,
      sourceType: "old_chat",
      sourceLabel: normalizeString(input.sourceLabel) || `${session.label} transcript`,
      summary: normalizeString(input.summary),
      material: transcriptMaterial,
      sourceRefs: [
        ...normalizeSourceRefs(input.sourceRefs),
        {
          type: "development_session",
          id: session.sessionId,
          capturedTurnCount: danTurns.length,
          capturedAssistantTurnCount: assistantTurnCount
        }
      ]
    }, deps)).source;
  }

  const checkpointRecords = await loadSermonDevelopmentRecords(
    getSermonDevelopmentCheckpointsCollection(deps),
    { sessionId: session.sessionId }
  );
  const checkpointStatusCounts = {
    unplaced: checkpointRecords.filter(({ data }) =>
      (normalizeString(data.materialStatus) || "unplaced") === "unplaced").length,
    placed: checkpointRecords.filter(({ data }) => normalizeString(data.materialStatus) === "placed").length,
    intentionallyCut: checkpointRecords.filter(({ data }) =>
      normalizeString(data.materialStatus) === "intentionally_cut").length
  };
  const nowIso = getNowIso(deps);
  const nextSession = {
    ...sessionRecord.data,
    sessionId: session.sessionId,
    status: "closed",
    summary: normalizeString(input.summary) || session.summary,
    rawTranscriptSourceId: transcriptSource?.sourceId || session.rawTranscriptSourceId,
    turnCount: turns.length,
    danTurnCount,
    assistantTurnCount,
    checkpointCount: checkpointRecords.length,
    endedAt: nowIso,
    updatedAt: nowIso
  };
  await sessionRecord.docRef.set(nextSession);
  return {
    action: "closed",
    session: buildSermonDevelopmentSessionSummary(nextSession, session.sessionId),
    summaryCheckpoint,
    transcriptSource,
    checkpointStatusCounts
  };
}

async function finalizeSermonDevelopmentSession(input = {}, deps = {}) {
  const sessionRecord = await getRequiredSermonDevelopmentSession(input.sessionId, deps);
  const session = buildSermonDevelopmentSessionSummary(sessionRecord.data, sessionRecord.sessionId);
  const expectedDanTurnCount = normalizeExpectedDanTurnCount(input.expectedDanTurnCount, { required: true });
  const finalTranscript = typeof input.finalTranscript === "string" ? input.finalTranscript : "";
  const assistantTranscript = typeof input.assistantTranscript === "string" ? input.assistantTranscript : "";

  if (session.status === "closed") {
    const checkpointRecords = await loadSermonDevelopmentRecords(
      getSermonDevelopmentCheckpointsCollection(deps),
      { sessionId: session.sessionId }
    );
    const closed = await closeSermonDevelopmentSession({
      sessionId: session.sessionId,
      expectedDanTurnCount
    }, deps);
    return {
      ...closed,
      finalTurn: null,
      finalAssistantTurn: null,
      finalCheckpoints: [],
      completionReceipt: {
        verified: true,
        sessionId: session.sessionId,
        danTurnCount: session.danTurnCount,
        assistantTurnCount: session.assistantTurnCount,
        checkpointCount: session.checkpointCount,
        transcriptSourceId: session.rawTranscriptSourceId,
        unplacedCheckpointCount: checkpointRecords.filter(({ data }) =>
          (normalizeString(data.materialStatus) || "unplaced") === "unplaced").length
      }
    };
  }
  if (!finalTranscript.trim() || !assistantTranscript.trim()) {
    throw createSermonWorkspaceError(
      "Finalizing a live development session requires the exact closing Dan turn and Chat receipt",
      400,
      { requiredFields: ["finalTranscript", "assistantTranscript"] },
      "missing_sermon_development_final_exchange"
    );
  }
  if (expectedDanTurnCount < 1) {
    throw createSermonWorkspaceError(
      "A final transcript requires an expected Dan-turn count of at least one",
      400,
      { expectedDanTurnCount },
      "invalid_expected_sermon_development_turn_count"
    );
  }

  const finalCapture = await captureSermonDevelopmentTurn({
    sermonId: session.sermonId,
    sessionId: session.sessionId,
    turnId: input.finalTurnId,
    assistantTurnId: input.finalAssistantTurnId,
    speaker: "dan",
    sequence: input.finalSequence,
    transcript: finalTranscript,
    assistantTranscript,
    sourceMode: input.sourceMode || session.mode,
    checkpoints: Array.isArray(input.finalCheckpoints) ? input.finalCheckpoints : [],
    danAuthorizedCut: input.danAuthorizedCut,
    danApprovalEvidence: input.danApprovalEvidence
  }, deps);

  const closed = await closeSermonDevelopmentSession({
    sessionId: session.sessionId,
    expectedDanTurnCount,
    summary: input.summary,
    summaryHeading: input.summaryHeading,
    sourceLabel: input.sourceLabel,
    sourceRefs: input.sourceRefs
  }, deps);

  return {
    ...closed,
    finalTurn: finalCapture?.turn || null,
    finalAssistantTurn: finalCapture?.assistantTurn || null,
    finalCheckpoints: finalCapture?.checkpoints || [],
    completionReceipt: {
      verified: closed.action === "closed" || closed.action === "already_closed",
      sessionId: closed.session.sessionId,
      danTurnCount: closed.session.danTurnCount,
      assistantTurnCount: closed.session.assistantTurnCount,
      checkpointCount: closed.session.checkpointCount,
      transcriptSourceId: closed.transcriptSource?.sourceId || closed.session.rawTranscriptSourceId,
      unplacedCheckpointCount: closed.checkpointStatusCounts?.unplaced || 0,
      finalDanTurnId: finalCapture?.turn?.turnId || "",
      finalAssistantTurnId: finalCapture?.assistantTurn?.turnId || ""
    }
  };
}

function normalizeCoverageText(value = "") {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function calculateTextCoverage(content = "", haystack = "") {
  const needle = normalizeCoverageText(content);
  const target = normalizeCoverageText(haystack);
  if (!needle || !target) return 0;
  if (target.includes(needle)) return 1;
  const tokens = Array.from(new Set(needle.split(/\s+/).filter((token) => token.length > 2)));
  if (tokens.length === 0) return 0;
  return tokens.filter((token) => target.includes(token)).length / tokens.length;
}

function splitDevelopmentSourceExcerpts(value = "") {
  return normalizeString(value)
    .split(/\n\s*\n+/)
    .map(normalizeString)
    .filter((excerpt) => excerpt.length >= 80)
    .slice(0, 200);
}

async function auditSermonDevelopmentPreservation(input = {}, deps = {}) {
  const { sermon } = await getSermon({ sermonId: input.sermonId }, deps);
  const checkpoints = (await loadSermonDevelopmentRecords(
    getSermonDevelopmentCheckpointsCollection(deps),
    { sermonId: sermon.sermonId, sessionId: input.sessionId, maxDocs: 20000 }
  )).map(({ id, data }) => buildSermonDevelopmentCheckpoint(data, id));
  const canonicalText = [
    sermon.scriptureText,
    sermon.bigIdea,
    sermon.outline,
    sermon.notes,
    ...(Array.isArray(sermon.developmentNotes) ? sermon.developmentNotes.map((note) => note.content) : [])
  ].join("\n");
  const checkpointCoverage = checkpoints.map((checkpoint) => {
    const score = calculateTextCoverage(checkpoint.content, canonicalText);
    const threshold = checkpoint.exactWording ? 1 : 0.72;
    return {
      ...checkpoint,
      integrationScore: Number(score.toFixed(2)),
      integrated: score >= threshold,
      recommendation: score >= threshold
        ? "No integration action required."
        : checkpoint.exactWording
          ? "Preserve this exact line in the outline, notes, or manuscript when appropriate."
          : "Review whether this checkpoint should shape the canonical outline, notes, or big idea."
    };
  });

  let sourceId = normalizeString(input.sourceId);
  if (!sourceId && normalizeString(input.sessionId)) {
    const sessionRecord = await getRequiredSermonDevelopmentSession(input.sessionId, deps);
    sourceId = normalizeString(sessionRecord.data.rawTranscriptSourceId);
  }
  let sourceCoverage = null;
  if (sourceId) {
    const source = (await getSermonSource({ sourceId }, deps)).source;
    if (source.sermonId !== sermon.sermonId) {
      throw createSermonWorkspaceError(
        "Development source does not belong to this sermon",
        409,
        { sermonId: sermon.sermonId, sourceId },
        "sermon_development_source_mismatch"
      );
    }
    const preservedText = [canonicalText, ...checkpoints.map((checkpoint) => checkpoint.content)].join("\n");
    const excerpts = splitDevelopmentSourceExcerpts(source.material);
    const uncoveredAll = excerpts
      .map((excerpt) => ({ excerpt, coverageScore: calculateTextCoverage(excerpt, preservedText) }))
      .filter(({ coverageScore }) => coverageScore < 0.65);
    const uncovered = uncoveredAll
      .slice(0, 20)
      .map(({ excerpt, coverageScore }) => ({ excerpt, coverageScore: Number(coverageScore.toFixed(2)) }));
    sourceCoverage = {
      sourceId,
      excerptCount: excerpts.length,
      coveredExcerptCount: excerpts.length - uncoveredAll.length,
      uncoveredExcerptCount: uncoveredAll.length,
      uncoveredExcerpts: uncovered
    };
  }

  const integratedCount = checkpointCoverage.filter((checkpoint) => checkpoint.integrated).length;
  return {
    sermon: buildSermonListSummary(sermon, sermon.sermonId),
    sessionId: normalizeString(input.sessionId),
    preservation: {
      checkpointCount: checkpointCoverage.length,
      durablyPreservedCount: checkpointCoverage.length,
      integratedCount,
      unintegratedCount: checkpointCoverage.length - integratedCount,
      integrationScore: checkpointCoverage.length
        ? Math.round((integratedCount / checkpointCoverage.length) * 100)
        : 100
    },
    unintegratedCheckpoints: checkpointCoverage.filter((checkpoint) => !checkpoint.integrated),
    integratedCheckpoints: checkpointCoverage.filter((checkpoint) => checkpoint.integrated),
    sourceCoverage
  };
}

function formatLegacyOccasionLine(occasion = {}) {
  const localDateTime = [occasion.date, occasion.time].filter(Boolean).join(" ");
  return [localDateTime, occasion.venue, occasion.service].filter(Boolean).join(" - ");
}

async function syncSermonOccasionCompatibilityFields(sermonId, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const sermonDocRef = sermonsCollection.doc(validateDocId(sermonId, "sermonId"));
  const sermonDoc = await sermonDocRef.get();
  if (!sermonDoc.exists) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const records = await loadSermonOccasionRecords(getSermonOccasionsCollection(deps), { sermonId });
  const occasions = records.map(({ id, data }) => buildSermonOccasionSummary(data, id));
  const nextOccasion = selectNextSermonOccasion(occasions, getNowIso(deps));
  const latestPreachedOccasion = selectLatestPreachedOccasion(occasions);
  const current = { ...(sermonDoc.data() || {}), sermonId };
  const legacyOccasion = occasions.map(formatLegacyOccasionLine).filter(Boolean).join("\n");
  const nextSermon = {
    ...current,
    targetDate: nextOccasion?.date || current.targetDate || "",
    preachedDate: latestPreachedOccasion?.date || current.preachedDate || "",
    occasion: legacyOccasion || current.occasion || "",
    occasionCount: occasions.length,
    nextOccasionId: nextOccasion?.occasionId || "",
    latestPreachedOccasionId: latestPreachedOccasion?.occasionId || "",
    updatedAt: getNowIso(deps)
  };
  nextSermon.searchText = buildSermonSearchText(enrichSermonWithOccasions(nextSermon, occasions, getNowIso(deps)));
  await sermonDocRef.set(nextSermon);
  return enrichSermonWithOccasions(nextSermon, occasions, getNowIso(deps));
}

async function listSermonOccasions(input = {}, deps = {}) {
  const occasionsCollection = getSermonOccasionsCollection(deps);
  const sermonId = normalizeString(input.sermonId);
  const status = normalizeString(input.status);
  const venue = normalizeString(input.venue).toLowerCase();
  const service = normalizeString(input.service).toLowerCase();
  const query = normalizeString(input.query).toLowerCase();
  const date = normalizeOptionalDate(input.date, "occasionDate");
  const dateFrom = normalizeOptionalDate(input.dateFrom, "occasionDateFrom");
  const dateTo = normalizeOptionalDate(input.dateTo, "occasionDateTo");
  const limit = normalizeLimit(input.limit);
  const nowIso = getNowIso(deps);

  if (status && !SERMON_OCCASION_STATUSES.includes(status)) {
    throw createSermonWorkspaceError(
      "Invalid sermon occasion status",
      400,
      { status, allowedValues: SERMON_OCCASION_STATUSES },
      "invalid_sermon_occasion_status"
    );
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw createSermonWorkspaceError(
      "occasionDateFrom cannot be after occasionDateTo",
      400,
      { dateFrom, dateTo },
      "invalid_sermon_occasion_date_range"
    );
  }

  const occasions = (await loadSermonOccasionRecords(occasionsCollection, { sermonId, maxDocs: 20000 }))
    .map(({ id, data }) => buildSermonOccasionSummary(data, id))
    .filter((item) => !status || item.status === status)
    .filter((item) => !venue || item.venue.toLowerCase().includes(venue))
    .filter((item) => !service || item.service.toLowerCase().includes(service))
    .filter((item) => !query || buildSermonOccasionSearchText(item).includes(query))
    .filter((item) => !date || item.date === date)
    .filter((item) => !dateFrom || item.date >= dateFrom)
    .filter((item) => !dateTo || item.date <= dateTo)
    .filter((item) => input.upcomingOnly !== true || isUpcomingSermonOccasion(item, nowIso));
  const sorted = input.sort === "desc"
    ? sortSermonOccasions(occasions).reverse()
    : sortSermonOccasions(occasions);

  return { count: Math.min(sorted.length, limit), occasions: sorted.slice(0, limit) };
}

async function createSermonOccasion(input = {}, deps = {}) {
  const sermonId = validateDocId(input.sermonId, "sermonId");
  const sermonDoc = await getSermonsCollection(deps).doc(sermonId).get();
  if (!sermonDoc.exists) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const occasionsCollection = getSermonOccasionsCollection(deps);
  const normalized = normalizeSermonOccasion({ ...input, sermonId });
  const existingRecords = await loadSermonOccasionRecords(occasionsCollection, { sermonId });
  const duplicate = existingRecords.find(({ data }) =>
    buildSermonOccasionId(sermonId, data) === buildSermonOccasionId(sermonId, normalized));
  if (duplicate) {
    return {
      action: "existing",
      occasion: buildSermonOccasionSummary(duplicate.data, duplicate.id),
      sermon: buildSermonDetail(await syncSermonOccasionCompatibilityFields(sermonId, deps), sermonId)
    };
  }

  const occasionId = normalizeString(input.occasionId)
    ? validateDocId(input.occasionId, "occasionId")
    : createId("sermon-occasion", `${sermonId} ${normalized.date} ${normalized.service}`, deps);
  const nowIso = getNowIso(deps);
  const occasion = {
    ...normalized,
    occasionId,
    sermonId,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  occasion.searchText = buildSermonOccasionSearchText(occasion);
  await occasionsCollection.doc(occasionId).create(occasion);
  const sermon = await syncSermonOccasionCompatibilityFields(sermonId, deps);

  return {
    action: "created",
    occasion: buildSermonOccasionSummary(occasion, occasionId),
    sermon: buildSermonDetail(sermon, sermonId)
  };
}

async function updateSermonOccasion(input = {}, deps = {}) {
  const occasionId = validateDocId(input.occasionId, "occasionId");
  const occasionsCollection = getSermonOccasionsCollection(deps);
  const docRef = occasionsCollection.doc(occasionId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createSermonWorkspaceError(
      "Sermon occasion not found",
      404,
      { occasionId },
      "sermon_occasion_not_found"
    );
  }

  const current = { ...(doc.data() || {}), occasionId };
  const changes = isPlainObject(input.changes) ? input.changes : input;
  const normalized = normalizeSermonOccasion(changes, current);
  const nextOccasion = {
    ...current,
    ...normalized,
    occasionId,
    sermonId: current.sermonId,
    updatedAt: getNowIso(deps)
  };
  nextOccasion.searchText = buildSermonOccasionSearchText(nextOccasion);
  await docRef.set(nextOccasion);
  const sermon = await syncSermonOccasionCompatibilityFields(current.sermonId, deps);

  return {
    occasion: buildSermonOccasionSummary(nextOccasion, occasionId),
    sermon: buildSermonDetail(sermon, current.sermonId)
  };
}

function buildScheduledSermonSelectionChanges(input = {}) {
  const changes = isPlainObject(input.changes) ? { ...input.changes } : {};
  for (const field of [
    "title",
    "status",
    "scriptureText",
    "bigIdea",
    "notes",
    "outline",
    "seriesId",
    "seriesTitle",
    "seriesSlug",
    "seriesNumber",
    "tags",
    "sourceRefs"
  ]) {
    if (Object.prototype.hasOwnProperty.call(input, field)) changes[field] = input[field];
  }
  return changes;
}

function sermonOccasionsMatch(left = {}, right = {}) {
  return ["date", "time", "venue", "service"].every((field) =>
    normalizeString(left[field]).toLowerCase() === normalizeString(right[field]).toLowerCase());
}

async function selectSermonForOccasion(input = {}, deps = {}) {
  if (input.confirmed !== true) {
    throw createSermonWorkspaceError(
      "Selecting a sermon for an occasion requires confirmed: true",
      400,
      {},
      "sermon_occasion_selection_confirmation_required"
    );
  }

  const occasionId = validateDocId(input.occasionId, "occasionId");
  const occasionsCollection = getSermonOccasionsCollection(deps);
  const occasionRef = occasionsCollection.doc(occasionId);
  const occasionDoc = await occasionRef.get();
  if (!occasionDoc.exists) {
    throw createSermonWorkspaceError(
      "Sermon occasion not found",
      404,
      { occasionId },
      "sermon_occasion_not_found"
    );
  }

  const currentOccasion = { ...(occasionDoc.data() || {}), occasionId };
  const currentSermonId = validateDocId(currentOccasion.sermonId, "sermonId");
  const expectedCurrentSermonId = normalizeString(input.expectedCurrentSermonId);
  if (expectedCurrentSermonId && expectedCurrentSermonId !== currentSermonId) {
    throw createSermonWorkspaceError(
      "The preaching occasion is no longer attached to the expected sermon",
      409,
      { occasionId, expectedCurrentSermonId, currentSermonId },
      "sermon_occasion_selection_stale"
    );
  }

  const sermonsCollection = getSermonsCollection(deps);
  const currentSermonDoc = await sermonsCollection.doc(currentSermonId).get();
  if (!currentSermonDoc.exists) {
    throw createSermonWorkspaceError(
      "The preaching occasion points to a missing sermon",
      409,
      { occasionId, currentSermonId },
      "sermon_occasion_orphaned"
    );
  }
  const currentSermon = { ...(currentSermonDoc.data() || {}), sermonId: currentSermonId };
  const targetSermonId = normalizeString(input.targetSermonId);
  const changes = buildScheduledSermonSelectionChanges(input);

  if (!targetSermonId || targetSermonId === currentSermonId) {
    if (!isScheduledSermonPlaceholder(currentSermon, currentOccasion)) {
      throw createSermonWorkspaceError(
        "The scheduled sermon is not an empty placeholder",
        409,
        { occasionId, sermonId: currentSermonId },
        "scheduled_sermon_not_placeholder"
      );
    }
    if (!normalizeString(changes.title)) {
      throw createSermonWorkspaceError(
        "Promoting a scheduled placeholder requires the selected sermon title",
        400,
        { occasionId },
        "missing_selected_sermon_title"
      );
    }

    const updated = await updateSermon({
      sermonId: currentSermonId,
      changes,
      snapshotReason: `Before selecting sermon for occasion ${occasionId}`
    }, deps);
    const sermon = await syncSermonOccasionCompatibilityFields(currentSermonId, deps);
    return {
      action: "promoted_placeholder",
      occasion: buildSermonOccasionSummary(currentOccasion, occasionId),
      sermon: buildSermonDetail(sermon, currentSermonId),
      snapshot: updated.snapshot,
      replacedPlaceholder: null
    };
  }

  if (Object.keys(changes).length > 0) {
    throw createSermonWorkspaceError(
      "Do not send sermon changes when assigning an already-existing sermon hub",
      400,
      { targetSermonId },
      "existing_sermon_selection_changes_not_allowed"
    );
  }
  if (!isScheduledSermonPlaceholder(currentSermon, currentOccasion)) {
    throw createSermonWorkspaceError(
      "Only an empty scheduled placeholder can be replaced by another sermon hub",
      409,
      { occasionId, currentSermonId },
      "scheduled_sermon_not_placeholder"
    );
  }

  const validTargetSermonId = validateDocId(targetSermonId, "targetSermonId");
  const targetSermonDoc = await sermonsCollection.doc(validTargetSermonId).get();
  if (!targetSermonDoc.exists) {
    throw createSermonWorkspaceError(
      "Selected sermon not found",
      404,
      { targetSermonId: validTargetSermonId },
      "sermon_not_found"
    );
  }
  const targetOccasionRecords = await loadSermonOccasionRecords(
    occasionsCollection,
    { sermonId: validTargetSermonId }
  );
  const duplicate = targetOccasionRecords.find(({ data }) =>
    normalizeString(data.status) !== "cancelled" && sermonOccasionsMatch(data, currentOccasion));
  if (duplicate) {
    throw createSermonWorkspaceError(
      "The selected sermon already has this preaching occasion",
      409,
      { occasionId, targetSermonId: validTargetSermonId, duplicateOccasionId: duplicate.id },
      "sermon_occasion_selection_duplicate"
    );
  }

  const nextOccasion = {
    ...currentOccasion,
    sermonId: validTargetSermonId,
    updatedAt: getNowIso(deps)
  };
  nextOccasion.searchText = buildSermonOccasionSearchText(nextOccasion);
  await occasionRef.set(nextOccasion);
  const targetSermon = await syncSermonOccasionCompatibilityFields(validTargetSermonId, deps);
  const remainingSourceOccasions = await loadSermonOccasionRecords(
    occasionsCollection,
    { sermonId: currentSermonId }
  );
  const replacementNote = `Scheduled placeholder replaced by sermon ${validTargetSermonId} for occasion ${occasionId}.`;
  const archived = remainingSourceOccasions.length === 0
    ? await updateSermon({
        sermonId: currentSermonId,
        changes: {
          status: "archived",
          notes: [normalizeString(currentSermon.notes), replacementNote].filter(Boolean).join("\n")
        },
        snapshotReason: `Before replacing scheduled placeholder for occasion ${occasionId}`
      }, deps)
    : null;
  const sourceSermon = await syncSermonOccasionCompatibilityFields(currentSermonId, deps);

  return {
    action: "assigned_existing_sermon",
    occasion: buildSermonOccasionSummary(nextOccasion, occasionId),
    sermon: buildSermonDetail(targetSermon, validTargetSermonId),
    replacedPlaceholder: buildSermonDetail(sourceSermon, currentSermonId),
    placeholderArchived: Boolean(archived),
    placeholderSnapshot: archived?.snapshot || null
  };
}

function extractTimeFromService(value = "") {
  const match = normalizeString(value).match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!match) return "";
  try {
    return normalizeOptionalTime(`${match[1]}:${match[2] || "00"} ${match[3]}`, "occasionTime");
  } catch (_error) {
    return "";
  }
}

function isTimeOnlyLegacyValue(value = "") {
  return /^\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\s*$/i.test(normalizeString(value));
}

function isPlaceholderLegacySermonDate(value = "") {
  return ["1970-01-01", "2001-01-01"].includes(normalizeString(value));
}

function looksLikeLegacyServiceLabel(value = "") {
  const cleanValue = normalizeString(value);
  if (!cleanValue || /\b(church|mission|camp|conference|home|center|centre|chapel building)\b/i.test(cleanValue)) {
    return false;
  }
  return /\b(sunday|wednesday|service|school|chapel|worship|prayer|morning|evening|night)\b/i.test(cleanValue);
}

function buildLegacySermonOccasionCandidates(sermon = {}) {
  const lines = normalizeString(sermon.occasion).split(/\n+/).map(normalizeString).filter(Boolean);
  const fallbackDate = normalizeString(sermon.preachedDate || sermon.targetDate);
  const fallbackStatus = sermon.preachedDate || sermon.status === "preached" ? "preached" : "planned";
  const candidates = (lines.length ? lines : (fallbackDate ? [""] : [])).map((line) => {
    const parts = line.split(/\s+-\s+/).map(normalizeString);
    const firstDateTime = (parts[0] || "").match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?$/);
    const date = firstDateTime?.[1] || fallbackDate;
    const timeFromPrefix = firstDateTime?.[2] || "";
    if (firstDateTime) parts.shift();
    let venue = parts.shift() || "";
    let service = parts.join(" - ");
    const time = timeFromPrefix || extractTimeFromService(service) || extractTimeFromService(venue);
    if (isTimeOnlyLegacyValue(venue)) venue = "";
    if (!service && looksLikeLegacyServiceLabel(venue)) {
      service = venue;
      venue = "";
    }
    return { date, time, venue, service, status: fallbackStatus, timeZone: DEFAULT_SERMON_TIME_ZONE };
  });

  return candidates.filter((candidate) => candidate.date);
}

async function upsertImportedSermonOccasions(sermonId, occasionInputs = [], deps = {}) {
  if (!Array.isArray(occasionInputs) || occasionInputs.length === 0) return [];
  const occasionsCollection = getSermonOccasionsCollection(deps);
  const results = [];

  for (const input of occasionInputs) {
    if (!isPlainObject(input)) continue;
    const normalized = normalizeSermonOccasion({ ...input, sermonId });
    const occasionId = buildSermonOccasionId(sermonId, normalized);
    const docRef = occasionsCollection.doc(occasionId);
    const existing = await docRef.get();
    const existingData = existing.exists ? (existing.data() || {}) : {};
    const nowIso = getNowIso(deps);
    const occasion = {
      ...existingData,
      ...normalized,
      occasionId,
      sermonId,
      createdAt: normalizeString(existingData.createdAt) || nowIso,
      updatedAt: nowIso
    };
    occasion.searchText = buildSermonOccasionSearchText(occasion);
    await docRef.set(occasion);
    results.push(buildSermonOccasionSummary(occasion, occasionId));
  }

  if (results.length > 0) await syncSermonOccasionCompatibilityFields(sermonId, deps);
  return results;
}

async function mapWithConcurrency(items = [], concurrency = 10, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function migrateLegacySermonOccasions(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  const dryRun = input.confirmed !== true;
  const sermonRecords = await loadCollection(getSermonsCollection(deps), 10000);
  const existingRecords = await loadSermonOccasionRecords(getSermonOccasionsCollection(deps), {
    sermonId,
    maxDocs: 20000
  });
  const existingIds = new Set(existingRecords.map(({ id }) => id));
  const candidates = [];

  for (const { id, data } of sermonRecords) {
    const currentSermonId = normalizeString(data.sermonId || id);
    if (sermonId && currentSermonId !== sermonId) continue;
    for (const occasion of buildLegacySermonOccasionCandidates(data)) {
      const occasionId = buildSermonOccasionId(currentSermonId, occasion);
      candidates.push({
        sermonId: currentSermonId,
        sermonTitle: normalizeString(data.title),
        occasionId,
        alreadyExists: existingIds.has(occasionId),
        migrationEligible: !isPlaceholderLegacySermonDate(occasion.date),
        warnings: isPlaceholderLegacySermonDate(occasion.date)
          ? ["placeholder_legacy_date"]
          : (!occasion.time ? ["time_unknown"] : []),
        occasion
      });
    }
  }

  let migratedCount = 0;
  if (!dryRun) {
    const bySermon = new Map();
    for (const candidate of candidates.filter((item) => item.migrationEligible && !item.alreadyExists)) {
      const values = bySermon.get(candidate.sermonId) || [];
      values.push(candidate.occasion);
      bySermon.set(candidate.sermonId, values);
    }
    const migrated = await mapWithConcurrency(
      Array.from(bySermon.entries()),
      10,
      async ([currentSermonId, occasions]) =>
        (await upsertImportedSermonOccasions(currentSermonId, occasions, deps)).length
    );
    migratedCount = migrated.reduce((total, count) => total + count, 0);
  }

  return {
    dryRun,
    confirmationRequired: dryRun,
    sermonCount: new Set(candidates.map((item) => item.sermonId)).size,
    candidateCount: candidates.length,
    eligibleCandidateCount: candidates.filter((item) => item.migrationEligible).length,
    skippedCandidateCount: candidates.filter((item) => !item.migrationEligible).length,
    newCandidateCount: candidates.filter((item) => item.migrationEligible && !item.alreadyExists).length,
    warningCounts: {
      placeholderLegacyDate: candidates.filter((item) => item.warnings.includes("placeholder_legacy_date")).length,
      timeUnknown: candidates.filter((item) => item.warnings.includes("time_unknown")).length
    },
    migratedCount,
    candidates: candidates.slice(0, normalizeLimit(input.limit || 100))
  };
}

async function listSermonSnapshots(input = {}, deps = {}) {
  const snapshotsCollection = getSermonSnapshotsCollection(deps);
  const sermonId = normalizeString(input.sermonId);
  const limit = normalizeLimit(input.limit);
  const snapshots = (await loadCollection(snapshotsCollection, 1000))
    .map(({ id, data }) => buildSermonSnapshotSummary(data, id))
    .filter((snapshot) => !sermonId || snapshot.sermonId === sermonId)
    .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""))
    .slice(0, limit);

  return {
    count: snapshots.length,
    snapshots
  };
}

async function getSermonSnapshot(input = {}, deps = {}) {
  const snapshotsCollection = getSermonSnapshotsCollection(deps);
  const snapshotId = validateDocId(input.snapshotId, "snapshotId");
  const doc = await snapshotsCollection.doc(snapshotId).get();

  if (!doc.exists) {
    throw createSermonWorkspaceError("Sermon snapshot not found", 404, { snapshotId }, "sermon_snapshot_not_found");
  }

  return {
    snapshot: buildSermonSnapshotDetail(doc.data() || {}, snapshotId)
  };
}

async function createSermonSource(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const sourcesCollection = getSermonSourcesCollection(deps);
  const sermonId = validateDocId(input.sermonId, "sermonId");
  const sermonDoc = await sermonsCollection.doc(sermonId).get();

  if (!sermonDoc.exists) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const sermon = { ...(sermonDoc.data() || {}), sermonId };
  const sourceType = normalizeSermonSourceType(input.sourceType || input.type, "other");
  const sourceLabel = normalizeString(input.sourceLabel) || "Sermon source material";
  const summary = truncateImportedText(input.summary || input.importedSummary);
  const material = truncateImportedText(input.material || input.importedMaterial || input.rawMaterial);
  const sourceRefs = normalizeSourceRefs(input.sourceRefs);
  if (!summary && !material && sourceRefs.length === 0) {
    throw createSermonWorkspaceError(
      "Source requires summary, material, or sourceRefs",
      400,
      {},
      "missing_sermon_source_material"
    );
  }

  const folderId = Object.prototype.hasOwnProperty.call(input, "folderId")
    ? await assertSermonFolderExists(input.folderId, deps)
    : normalizeString(sermon.folderId);
  const series = buildSeriesMetadata(input, sermon);
  const tags = Object.prototype.hasOwnProperty.call(input, "tags")
    ? normalizeTags(input.tags)
    : normalizeTags(sermon.tags);
  const sourceId = normalizeString(input.sourceId)
    ? validateDocId(input.sourceId, "sourceId")
    : createId("source", `${sermonId} ${sourceType} ${sourceLabel}`, deps);
  const docRef = sourcesCollection.doc(sourceId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createSermonWorkspaceError(
      "Sermon source already exists",
      409,
      { sourceId },
      "sermon_source_already_exists"
    );
  }

  const nowIso = getNowIso(deps);
  const source = {
    sourceId,
    sermonId,
    folderId,
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    seriesNumber: series.seriesNumber,
    series: series.series,
    tags,
    sourceType,
    sourceLabel,
    summary,
    material,
    sourceRefs,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  source.searchText = buildSermonSourceSearchText(source);

  await docRef.create(source);
  const commentaryLinks = await linkScriptureCommentarySource(source, deps);

  return {
    source: buildSermonSourceDetail(source, sourceId),
    ...(commentaryLinks ? { commentaryLinks } : {})
  };
}

async function listSermonSources(input = {}, deps = {}) {
  const sourcesCollection = getSermonSourcesCollection(deps);
  const sermonId = normalizeString(input.sermonId);
  const folderId = normalizeString(input.folderId);
  const seriesId = normalizeString(input.seriesId);
  const seriesSlug = normalizeString(input.seriesSlug);
  const tag = normalizeString(input.tag).toLowerCase();
  const sourceType = input.sourceType ? normalizeSermonSourceType(input.sourceType, "") : "";
  const query = normalizeString(input.query).toLowerCase();
  const limit = normalizeLimit(input.limit);

  const sources = (await loadSermonSourceRecords(sourcesCollection, {
    sermonId,
    folderId,
    sourceType,
    maxDocs: 10000
  }))
    .filter(({ data }) => !seriesId || normalizeString(data.seriesId) === seriesId)
    .filter(({ data }) => !seriesSlug || normalizeString(data.seriesSlug) === seriesSlug)
    .filter(({ data }) => !tag || normalizeTags(data.tags).map((item) => item.toLowerCase()).includes(tag))
    .filter(({ data }) => !query || buildSermonSourceSearchText(data).includes(query))
    .map(({ id, data }) => buildSermonSourceSummary(data, id))
    .sort((left, right) => (right.createdAt || right.updatedAt || "").localeCompare(left.createdAt || left.updatedAt || ""))
    .slice(0, limit);

  return {
    count: sources.length,
    sources
  };
}

async function getSermonSource(input = {}, deps = {}) {
  const sourcesCollection = getSermonSourcesCollection(deps);
  const sourceId = validateDocId(input.sourceId, "sourceId");
  const doc = await sourcesCollection.doc(sourceId).get();

  if (!doc.exists) {
    throw createSermonWorkspaceError("Sermon source not found", 404, { sourceId }, "sermon_source_not_found");
  }

  const source = buildSermonSourceDetail(doc.data() || {}, sourceId);
  return addSermonSourceArtifactDownload(source, deps);
}

async function createSermonPresentationTemplate(input = {}, deps = {}) {
  const templatesCollection = getSermonPresentationTemplatesCollection(deps);
  const name = normalizeString(input.name || input.seriesTitle) || "Sermon presentation template";
  const series = buildSeriesMetadata(input);
  const templateId = normalizeString(input.templateId)
    ? validateDocId(input.templateId, "templateId")
    : createId("presentation-template", `${series.seriesId || name} ${name}`, deps);
  const docRef = templatesCollection.doc(templateId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createSermonWorkspaceError(
      "Sermon presentation template already exists",
      409,
      { templateId },
      "sermon_presentation_template_already_exists"
    );
  }

  const nowIso = getNowIso(deps);
  const template = {
    templateId,
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    series: series.series,
    name,
    description: normalizeString(input.description),
    aspectRatio: normalizeEnum(input.aspectRatio, PRESENTATION_ASPECT_RATIOS, "16:9", "presentation_aspect_ratio"),
    status: normalizeEnum(input.status, PRESENTATION_TEMPLATE_STATUSES, "active", "presentation_template_status"),
    version: Number.isFinite(Number(input.version)) && Number(input.version) > 0 ? Number(input.version) : 1,
    theme: normalizePresentationTheme(input.theme, series.seriesTitle || name),
    layouts: normalizePresentationLayouts(input.layouts),
    createdFromPresentationId: normalizeString(input.createdFromPresentationId),
    sourceStoragePath: normalizeString(input.sourceStoragePath || input.storagePath),
    createdAt: nowIso,
    updatedAt: nowIso
  };
  template.searchText = buildPresentationTemplateSearchText(template);

  await docRef.create(template);
  return { template: buildPresentationTemplateDetail(template, templateId) };
}

async function listSermonPresentationTemplates(input = {}, deps = {}) {
  const templatesCollection = getSermonPresentationTemplatesCollection(deps);
  const seriesId = normalizeString(input.seriesId);
  const seriesSlug = normalizeString(input.seriesSlug);
  const status = normalizeString(input.status || "active");
  const query = normalizeString(input.query).toLowerCase();
  const limit = normalizeLimit(input.limit);

  if (status && !PRESENTATION_TEMPLATE_STATUSES.includes(status)) {
    throw createSermonWorkspaceError(
      "Invalid presentation template status",
      400,
      { status, allowedValues: PRESENTATION_TEMPLATE_STATUSES },
      "invalid_presentation_template_status"
    );
  }

  const templates = (await loadCollection(templatesCollection, 1000))
    .filter(({ data }) => !seriesId || normalizeString(data.seriesId) === seriesId)
    .filter(({ data }) => !seriesSlug || normalizeString(data.seriesSlug) === seriesSlug)
    .filter(({ data }) => !status || normalizeString(data.status || "active") === status)
    .filter(({ data }) => !query || buildPresentationTemplateSearchText(data).includes(query))
    .map(({ id, data }) => buildPresentationTemplateSummary(data, id))
    .sort((left, right) => {
      if ((left.seriesId || "") !== (right.seriesId || "")) {
        return (left.seriesTitle || left.seriesId || "").localeCompare(right.seriesTitle || right.seriesId || "");
      }
      return (right.version || 0) - (left.version || 0) ||
        (right.updatedAt || "").localeCompare(left.updatedAt || "");
    })
    .slice(0, limit);

  return { count: templates.length, templates };
}

async function getSermonPresentationTemplate(input = {}, deps = {}) {
  const templatesCollection = getSermonPresentationTemplatesCollection(deps);
  const templateId = validateDocId(input.templateId, "templateId");
  const doc = await templatesCollection.doc(templateId).get();

  if (!doc.exists) {
    throw createSermonWorkspaceError(
      "Sermon presentation template not found",
      404,
      { templateId },
      "sermon_presentation_template_not_found"
    );
  }

  return { template: buildPresentationTemplateDetail(doc.data() || {}, templateId) };
}

async function updateSermonPresentationTemplate(input = {}, deps = {}) {
  const templatesCollection = getSermonPresentationTemplatesCollection(deps);
  const templateId = validateDocId(input.templateId, "templateId");
  const docRef = templatesCollection.doc(templateId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSermonWorkspaceError(
      "Sermon presentation template not found",
      404,
      { templateId },
      "sermon_presentation_template_not_found"
    );
  }

  const changes = isPlainObject(input.changes) ? input.changes : input;
  const nextTemplate = { ...clone(doc.data() || {}), templateId };

  for (const field of ["name", "description", "createdFromPresentationId", "sourceStoragePath"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextTemplate[field] = normalizeString(changes[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "aspectRatio")) {
    nextTemplate.aspectRatio = normalizeEnum(
      changes.aspectRatio,
      PRESENTATION_ASPECT_RATIOS,
      nextTemplate.aspectRatio || "16:9",
      "presentation_aspect_ratio"
    );
  }

  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    nextTemplate.status = normalizeEnum(
      changes.status,
      PRESENTATION_TEMPLATE_STATUSES,
      nextTemplate.status || "active",
      "presentation_template_status"
    );
  }

  if (Object.prototype.hasOwnProperty.call(changes, "version")) {
    nextTemplate.version = Number.isFinite(Number(changes.version)) && Number(changes.version) > 0
      ? Number(changes.version)
      : nextTemplate.version || 1;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "theme")) {
    nextTemplate.theme = normalizePresentationTheme(changes.theme, nextTemplate.seriesTitle || nextTemplate.name);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "layouts")) {
    nextTemplate.layouts = normalizePresentationLayouts(changes.layouts);
  }

  const series = buildSeriesMetadata(changes, nextTemplate);
  nextTemplate.seriesId = series.seriesId;
  nextTemplate.seriesTitle = series.seriesTitle;
  nextTemplate.seriesSlug = series.seriesSlug;
  nextTemplate.series = series.series;
  nextTemplate.updatedAt = getNowIso(deps);
  nextTemplate.searchText = buildPresentationTemplateSearchText(nextTemplate);

  await docRef.set(nextTemplate);
  return { template: buildPresentationTemplateDetail(nextTemplate, templateId) };
}

async function importSermonPresentationTemplate(input = {}, deps = {}) {
  if (typeof deps.importSermonPresentationTemplatePptx !== "function") {
    throw createSermonWorkspaceError(
      "Presentation template PPTX import is not configured",
      500,
      {},
      "presentation_template_import_not_configured"
    );
  }

  const templatesCollection = getSermonPresentationTemplatesCollection(deps);
  const requestedTemplateId = normalizeString(input.templateId);
  let previousTemplateRecord = null;
  if (requestedTemplateId) {
    const templateId = validateDocId(requestedTemplateId, "templateId");
    const doc = await templatesCollection.doc(templateId).get();
    if (!doc.exists) {
      throw createSermonWorkspaceError(
        "Sermon presentation template not found",
        404,
        { templateId },
        "sermon_presentation_template_not_found"
      );
    }
    previousTemplateRecord = { id: templateId, data: doc.data() || {} };
  } else {
    const requestedSeries = buildSeriesMetadata(input);
    const candidates = (await loadCollection(templatesCollection, 1000))
      .filter(({ data }) => normalizeString(data.status || "active") === "active")
      .filter(({ data }) => !requestedSeries.seriesId || normalizeString(data.seriesId) === requestedSeries.seriesId)
      .filter(({ data }) => !requestedSeries.seriesSlug || normalizeString(data.seriesSlug) === requestedSeries.seriesSlug)
      .filter(({ data }) => !requestedSeries.seriesTitle || normalizeString(data.seriesTitle) === requestedSeries.seriesTitle)
      .sort((left, right) => (Number(right.data.version) || 1) - (Number(left.data.version) || 1));
    previousTemplateRecord = candidates[0] || null;
  }

  const previousTemplate = previousTemplateRecord
    ? buildPresentationTemplateDetail(previousTemplateRecord.data, previousTemplateRecord.id)
    : null;
  const series = buildSeriesMetadata(input, previousTemplate || {});
  const name = normalizeString(input.name) || previousTemplate?.name || series.seriesTitle;
  if (!name) {
    throw createSermonWorkspaceError(
      "Template import requires templateId, seriesTitle, or name",
      400,
      {},
      "presentation_template_identity_required"
    );
  }

  const imported = await deps.importSermonPresentationTemplatePptx({
    openaiFileIdRefs: input.openaiFileIdRefs,
    name,
    seriesId: series.seriesId,
    seriesSlug: series.seriesSlug
  });
  const version = (Number(previousTemplate?.version) || 0) + 1;
  const templateId = normalizeString(input.newTemplateId)
    ? validateDocId(input.newTemplateId, "newTemplateId")
    : createId("presentation-template", `${series.seriesId || name} imported version ${version}`, deps);
  const docRef = templatesCollection.doc(templateId);
  const existing = await docRef.get();
  if (existing.exists) {
    throw createSermonWorkspaceError(
      "Imported presentation template version already exists",
      409,
      { templateId },
      "presentation_template_version_exists"
    );
  }

  const nowIso = getNowIso(deps);
  const template = {
    templateId,
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    series: series.series,
    name,
    description: normalizeString(input.description) || previousTemplate?.description ||
      `Imported editable 16:9 PowerPoint template for ${series.seriesTitle || name}.`,
    aspectRatio: imported.aspectRatio || "16:9",
    status: "active",
    version,
    theme: normalizePresentationTheme(imported.theme, series.seriesTitle || name),
    layouts: normalizePresentationLayouts(imported.layouts),
    createdFromPresentationId: normalizeString(input.createdFromPresentationId),
    sourceStoragePath: normalizeString(imported.storagePath),
    sourceFilename: normalizeString(imported.originalFilename),
    sourceContentType: normalizeString(imported.contentType),
    sourceSizeBytes: Number(imported.sizeBytes) || 0,
    sourceChecksumSha256: normalizeString(imported.checksumSha256),
    importedAt: nowIso,
    importExtraction: isPlainObject(imported.extraction) ? clone(imported.extraction) : {},
    createdAt: nowIso,
    updatedAt: nowIso
  };
  template.searchText = buildPresentationTemplateSearchText(template);
  await docRef.create(template);

  if (previousTemplateRecord && previousTemplateRecord.id !== templateId) {
    const archived = {
      ...previousTemplateRecord.data,
      templateId: previousTemplateRecord.id,
      status: "archived",
      replacedByTemplateId: templateId,
      updatedAt: nowIso
    };
    archived.searchText = buildPresentationTemplateSearchText(archived);
    await templatesCollection.doc(previousTemplateRecord.id).set(archived);
  }

  return {
    action: "imported",
    previousTemplate,
    template: buildPresentationTemplateDetail(template, templateId),
    source: {
      filename: template.sourceFilename,
      storagePath: template.sourceStoragePath,
      contentType: template.sourceContentType,
      sizeBytes: template.sourceSizeBytes,
      checksumSha256: template.sourceChecksumSha256
    },
    extraction: clone(template.importExtraction)
  };
}

async function getOrCreateSermonPresentationTemplate(input = {}, deps = {}, sermon = {}) {
  const templateId = normalizeString(input.templateId);

  if (templateId) {
    return (await getSermonPresentationTemplate({ templateId }, deps)).template;
  }

  const templatesCollection = getSermonPresentationTemplatesCollection(deps);
  const series = buildSeriesMetadata(input, sermon);
  const records = await loadCollection(templatesCollection, 1000);
  const matching = records
    .filter(({ data }) => normalizeString(data.status || "active") === "active")
    .filter(({ data }) => series.seriesId
      ? normalizeString(data.seriesId) === series.seriesId
      : !normalizeString(data.seriesId))
    .sort((left, right) => {
      const versionDiff = (Number(right.data.version) || 1) - (Number(left.data.version) || 1);
      return versionDiff || (right.data.updatedAt || "").localeCompare(left.data.updatedAt || "");
    })[0];

  if (matching) {
    return buildPresentationTemplateDetail(matching.data, matching.id);
  }

  const created = await createSermonPresentationTemplate(
    {
      seriesId: series.seriesId,
      seriesTitle: series.seriesTitle,
      seriesSlug: series.seriesSlug,
      name: series.seriesTitle || "Default Sermon Slides",
      description: series.seriesId
        ? `Reusable 16:9 PowerPoint template for ${series.seriesTitle || series.seriesId}.`
        : "Reusable default 16:9 sermon PowerPoint template.",
      theme: input.theme,
      layouts: input.layouts
    },
    deps
  );
  return created.template;
}

async function createSermonPresentation(input = {}, deps = {}) {
  const presentationsCollection = getSermonPresentationsCollection(deps);
  const renderPptx = getRenderSermonPresentationPptxFunction(deps);
  const uploadPptx = getUploadSermonPresentationPptxFunction(deps);
  const { sermonId, doc: sermonDoc } = await getRequiredSermonDoc(input.sermonId, deps);

  const sermon = buildSermonDetail(sermonDoc.data() || {}, sermonId);
  const developmentCheckpoints = (await loadSermonDevelopmentRecords(
    getSermonDevelopmentCheckpointsCollection(deps),
    { sermonId, maxDocs: 20000 }
  ))
    .map(({ id, data }) => buildSermonDevelopmentCheckpoint(data, id))
    .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));
  const placedDevelopmentCheckpoints = developmentCheckpoints
    .filter((checkpoint) => checkpoint.materialStatus === "placed");
  const materialFingerprint = buildSermonMaterialFingerprint(developmentCheckpoints);
  const template = await getOrCreateSermonPresentationTemplate(input, deps, sermon);
  const slidePlan = normalizePresentationPlan(input.slidePlan, sermon, {
    ...input,
    developmentCheckpoints: placedDevelopmentCheckpoints
  });
  slidePlan.planning = {
    ...(isPlainObject(slidePlan.planning) ? slidePlan.planning : {}),
    materialFingerprint,
    placedMaterialCount: placedDevelopmentCheckpoints.length,
    excludedUnplacedMaterialCount: developmentCheckpoints.filter((checkpoint) =>
      checkpoint.materialStatus === "unplaced").length,
    excludedCutMaterialCount: developmentCheckpoints.filter((checkpoint) =>
      checkpoint.materialStatus === "intentionally_cut").length
  };
  const title = normalizeString(input.title || slidePlan.title) || `${sermon.title || "Sermon"} Slides`;
  const presentationId = normalizeString(input.presentationId)
    ? validateDocId(input.presentationId, "presentationId")
    : createId("presentation", `${sermonId} ${title}`, deps);
  const docRef = presentationsCollection.doc(presentationId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createSermonWorkspaceError(
      "Sermon presentation already exists",
      409,
      { presentationId },
      "sermon_presentation_already_exists"
    );
  }

  const nowIso = getNowIso(deps);
  const presentationBase = {
    presentationId,
    sermonId,
    seriesId: sermon.seriesId,
    seriesTitle: sermon.seriesTitle,
    seriesSlug: sermon.seriesSlug,
    series: sermon.series,
    templateId: template.templateId,
    title,
    status: "planned",
    aspectRatio: "16:9",
    format: "pptx",
    slideCount: slidePlan.slides.length,
    slidePlan,
    materialFingerprint,
    placedMaterialCount: placedDevelopmentCheckpoints.length,
    filename: "",
    storagePath: "",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sizeBytes: 0,
    downloadUrl: "",
    downloadUrlExpiresAt: "",
    renderError: "",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  presentationBase.searchText = buildPresentationSearchText(presentationBase);

  try {
    const buffer = await renderPptx({ sermon, template, presentation: presentationBase });
    const uploaded = await uploadPptx({
      sermonId,
      presentationId,
      title,
      buffer,
      generatedAt: nowIso
    });
    const presentation = {
      ...presentationBase,
      status: "rendered",
      filename: uploaded.filename || "",
      storagePath: uploaded.storagePath || "",
      contentType: uploaded.contentType || presentationBase.contentType,
      sizeBytes: uploaded.sizeBytes || buffer.length || 0,
      downloadUrl: uploaded.downloadUrl || "",
      downloadUrlExpiresAt: uploaded.expiresAt || "",
      updatedAt: getNowIso(deps)
    };
    presentation.searchText = buildPresentationSearchText(presentation);
    await docRef.create(presentation);
    const response = {
      presentation: buildPresentationDetail(presentation, presentationId),
      template
    };
    return input.compact !== false ? buildCompactPresentationResponse(response) : response;
  } catch (error) {
    const presentation = {
      ...presentationBase,
      status: "failed",
      renderError: error?.message || "PowerPoint render failed",
      updatedAt: getNowIso(deps)
    };
    presentation.searchText = buildPresentationSearchText(presentation);
    await docRef.create(presentation);
    throw createSermonWorkspaceError(
      "Sermon presentation render failed",
      500,
      { presentationId, reason: presentation.renderError },
      "sermon_presentation_render_failed"
    );
  }
}

async function createSermonPresentationFromLookup(input = {}, deps = {}) {
  const resolution = await resolveSermon(
    {
      sermonId: input.sermonId,
      query: input.query,
      title: input.sermonTitle || input.title,
      scriptureText: input.scriptureText,
      occasion: input.occasion,
      folderId: input.folderId,
      seriesId: input.seriesId,
      seriesSlug: input.seriesSlug,
      seriesTitle: input.seriesTitle,
      tag: input.tag,
      status: input.status,
      date: input.date,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      dateField: input.dateField,
      preachedDate: input.preachedDate,
      targetDate: input.targetDate,
      includeSourceMatches: input.includeSourceMatches === true,
      limit: input.limit || 10
    },
    deps
  );

  if (resolution.resolution !== "resolved" || !resolution.selected?.sermonId) {
    const ambiguous = resolution.resolution === "ambiguous";
    throw createSermonWorkspaceError(
      ambiguous
        ? "Sermon lookup is ambiguous; choose one candidate before creating the presentation"
        : "No sermon matched the presentation lookup",
      ambiguous ? 409 : 404,
      {
        resolution: resolution.resolution,
        candidates: resolution.candidates.slice(0, 5).map((candidate) => ({
          sermonId: candidate.sermonId,
          title: candidate.title,
          scriptureText: candidate.scriptureText,
          preachedDate: candidate.preachedDate,
          targetDate: candidate.targetDate,
          occasion: candidate.occasion,
          score: candidate.score,
          matchedBy: candidate.matchedBy
        }))
      },
      ambiguous
        ? "sermon_presentation_lookup_ambiguous"
        : "sermon_presentation_lookup_not_found"
    );
  }

  const selected = resolution.selected;
  const result = await createSermonPresentation(
    {
      sermonId: selected.sermonId,
      title: input.presentationTitle || selected.title,
      templateId: input.templateId,
      theme: input.theme,
      slidePlan: input.slidePlan,
      slides: input.slides,
      compact: input.compact
    },
    deps
  );

  return {
    ...result,
    resolvedSermon: {
      sermonId: selected.sermonId,
      title: selected.title,
      scriptureText: selected.scriptureText,
      preachedDate: selected.preachedDate,
      targetDate: selected.targetDate,
      occasion: selected.occasion,
      score: selected.score,
      confidence: selected.confidence,
      matchedBy: selected.matchedBy
    }
  };
}

async function listSermonPresentations(input = {}, deps = {}) {
  const presentationsCollection = getSermonPresentationsCollection(deps);
  const sermonId = normalizeString(input.sermonId);
  const seriesId = normalizeString(input.seriesId);
  const seriesSlug = normalizeString(input.seriesSlug);
  const templateId = normalizeString(input.templateId);
  const status = normalizeString(input.status);
  const query = normalizeString(input.query).toLowerCase();
  const limit = normalizeLimit(input.limit);

  if (status && !PRESENTATION_STATUSES.includes(status)) {
    throw createSermonWorkspaceError(
      "Invalid presentation status",
      400,
      { status, allowedValues: PRESENTATION_STATUSES },
      "invalid_presentation_status"
    );
  }

  const presentations = (await loadCollection(presentationsCollection, 1000))
    .filter(({ data }) => !sermonId || normalizeString(data.sermonId) === sermonId)
    .filter(({ data }) => !seriesId || normalizeString(data.seriesId) === seriesId)
    .filter(({ data }) => !seriesSlug || normalizeString(data.seriesSlug) === seriesSlug)
    .filter(({ data }) => !templateId || normalizeString(data.templateId) === templateId)
    .filter(({ data }) => !status || normalizeString(data.status || "planned") === status)
    .filter(({ data }) => !query || buildPresentationSearchText(data).includes(query))
    .map(({ id, data }) => buildPresentationSummary(data, id))
    .sort((left, right) => (right.createdAt || right.updatedAt || "").localeCompare(left.createdAt || left.updatedAt || ""))
    .slice(0, limit);

  return { count: presentations.length, presentations };
}

async function getSermonPresentation(input = {}, deps = {}) {
  const presentationsCollection = getSermonPresentationsCollection(deps);
  const presentationId = validateDocId(input.presentationId, "presentationId");
  const doc = await presentationsCollection.doc(presentationId).get();

  if (!doc.exists) {
    throw createSermonWorkspaceError(
      "Sermon presentation not found",
      404,
      { presentationId },
      "sermon_presentation_not_found"
    );
  }

  return { presentation: buildPresentationDetail(doc.data() || {}, presentationId) };
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function parseDurationSeconds(value) {
  const cleanValue = normalizeString(value);

  if (!cleanValue) {
    return 0;
  }

  if (/^\d+$/.test(cleanValue)) {
    return Number.parseInt(cleanValue, 10);
  }

  const match = cleanValue.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);

  if (!match || !match[0]) {
    return 0;
  }

  return (Number.parseInt(match[1] || "0", 10) * 3600) +
    (Number.parseInt(match[2] || "0", 10) * 60) +
    Number.parseInt(match[3] || "0", 10);
}

function parseYouTubeUrlMetadata(value) {
  const cleanUrl = normalizeString(value);

  if (!cleanUrl) {
    return {};
  }

  let parsed;

  try {
    parsed = new URL(cleanUrl);
  } catch (error) {
    return {};
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const isYouTube = hostname === "youtube.com" ||
    hostname === "m.youtube.com" ||
    hostname === "youtu.be" ||
    hostname.endsWith(".youtube.com");

  if (!isYouTube) {
    return {};
  }

  let videoId = "";

  if (hostname === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else {
    videoId = parsed.searchParams.get("v") || "";
    const pathParts = parsed.pathname.split("/").filter(Boolean);

    if (!videoId && ["live", "shorts", "embed"].includes(pathParts[0])) {
      videoId = pathParts[1] || "";
    }
  }

  const startSeconds = parseDurationSeconds(
    parsed.searchParams.get("t") ||
    parsed.searchParams.get("start") ||
    parsed.searchParams.get("time_continue")
  );

  return {
    platform: "youtube",
    mediaType: "youtube",
    externalId: videoId,
    startSeconds
  };
}

async function createSermonMedia(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const mediaCollection = getSermonMediaCollection(deps);
  const sermonId = validateDocId(input.sermonId, "sermonId");
  const sermonDoc = await sermonsCollection.doc(sermonId).get();

  if (!sermonDoc.exists) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const sermon = { ...(sermonDoc.data() || {}), sermonId };
  const occasionId = normalizeString(input.occasionId)
    ? validateDocId(input.occasionId, "occasionId")
    : "";
  let occasionDoc = null;
  if (occasionId) {
    occasionDoc = await getSermonOccasionsCollection(deps).doc(occasionId).get();
    if (!occasionDoc.exists) {
      throw createSermonWorkspaceError("Sermon occasion not found", 404, { occasionId }, "sermon_occasion_not_found");
    }
    const occasionSermonId = normalizeString(occasionDoc.data()?.sermonId);
    if (occasionSermonId !== sermonId) {
      throw createSermonWorkspaceError(
        "Sermon occasion belongs to another sermon",
        409,
        { occasionId, sermonId, occasionSermonId },
        "sermon_media_occasion_mismatch"
      );
    }
  }
  const urlMetadata = parseYouTubeUrlMetadata(input.url);
  const mediaType = normalizeEnum(
    input.mediaType || urlMetadata.mediaType || input.platform || input.type,
    SERMON_MEDIA_TYPES,
    "other",
    "sermon_media_type"
  );
  const title = normalizeString(input.title) || normalizeString(sermon.title) || "Sermon media";
  const label = normalizeString(input.label) || title;
  const url = normalizeString(input.url);
  const storagePath = normalizeString(input.storagePath);
  const sourceRefs = normalizeSourceRefs(input.sourceRefs);

  if (!url && !storagePath && sourceRefs.length === 0) {
    throw createSermonWorkspaceError(
      "Sermon media requires url, storagePath, or sourceRefs",
      400,
      {},
      "missing_sermon_media_reference"
    );
  }

  const folderId = Object.prototype.hasOwnProperty.call(input, "folderId")
    ? await assertSermonFolderExists(input.folderId, deps)
    : normalizeString(sermon.folderId);
  const mediaId = normalizeString(input.mediaId)
    ? validateDocId(input.mediaId, "mediaId")
    : createId("media", `${sermonId} ${mediaType} ${label}`, deps);
  const docRef = mediaCollection.doc(mediaId);
  const existing = await docRef.get();

  if (existing.exists) {
    throw createSermonWorkspaceError(
      "Sermon media already exists",
      409,
      { mediaId },
      "sermon_media_already_exists"
    );
  }

  const nowIso = getNowIso(deps);
  const series = buildSeriesMetadata(input, sermon);
  const tags = Object.prototype.hasOwnProperty.call(input, "tags")
    ? normalizeTags(input.tags)
    : normalizeTags(sermon.tags);
  const transcriptStatus = normalizeEnum(
    input.transcriptStatus,
    SERMON_MEDIA_TRANSCRIPT_STATUSES,
    "none",
    "sermon_media_transcript_status"
  );
  const media = {
    mediaId,
    sermonId,
    occasionId,
    folderId,
    seriesId: series.seriesId,
    seriesTitle: series.seriesTitle,
    seriesSlug: series.seriesSlug,
    seriesNumber: series.seriesNumber,
    series: series.series,
    tags,
    mediaType,
    platform: normalizeString(input.platform) || urlMetadata.platform || mediaType,
    externalId: normalizeString(input.externalId || input.videoId) || urlMetadata.externalId || "",
    url,
    storagePath,
    originalFilename: normalizeString(input.originalFilename || input.filename),
    contentType: normalizeString(input.contentType),
    title,
    label,
    startSeconds: normalizeOptionalNumber(input.startSeconds) || urlMetadata.startSeconds || 0,
    endSeconds: normalizeOptionalNumber(input.endSeconds),
    durationSeconds: normalizeOptionalNumber(input.durationSeconds),
    recordedAt: normalizeString(
      input.recordedAt || input.preachedDate || occasionDoc?.data()?.scheduledAt || occasionDoc?.data()?.date || sermon.preachedDate
    ),
    transcriptStatus,
    transcriptSourceIds: isPlainObject(input.transcriptSourceIds) ? clone(input.transcriptSourceIds) : {},
    sourceRefs,
    notes: normalizeString(input.notes),
    createdAt: nowIso,
    updatedAt: nowIso
  };
  media.searchText = buildSermonMediaSearchText(media);

  await docRef.create(media);

  if (occasionId) {
    const occasion = { ...(occasionDoc.data() || {}), occasionId };
    occasion.mediaIds = Array.from(new Set([
      ...(Array.isArray(occasion.mediaIds) ? occasion.mediaIds : []),
      mediaId
    ].map(normalizeString).filter(Boolean)));
    occasion.updatedAt = nowIso;
    occasion.searchText = buildSermonOccasionSearchText(occasion);
    await getSermonOccasionsCollection(deps).doc(occasionId).set(occasion);
  }

  return {
    media: buildSermonMediaDetail(media, mediaId)
  };
}

async function linkSermonMediaToOccasion(input = {}, deps = {}) {
  const mediaCollection = getSermonMediaCollection(deps);
  const occasionsCollection = getSermonOccasionsCollection(deps);
  const mediaId = validateDocId(input.mediaId, "mediaId");
  const occasionId = validateDocId(input.occasionId, "occasionId");
  const [mediaDoc, occasionDoc] = await Promise.all([
    mediaCollection.doc(mediaId).get(),
    occasionsCollection.doc(occasionId).get()
  ]);
  if (!mediaDoc.exists) {
    throw createSermonWorkspaceError("Sermon media not found", 404, { mediaId }, "sermon_media_not_found");
  }
  if (!occasionDoc.exists) {
    throw createSermonWorkspaceError("Sermon occasion not found", 404, { occasionId }, "sermon_occasion_not_found");
  }
  const media = { ...(mediaDoc.data() || {}), mediaId };
  const occasion = { ...(occasionDoc.data() || {}), occasionId };
  const sermonId = normalizeString(input.sermonId || media.sermonId);
  if (normalizeString(media.sermonId) !== sermonId || normalizeString(occasion.sermonId) !== sermonId) {
    throw createSermonWorkspaceError(
      "Sermon media and occasion must belong to the same sermon",
      409,
      { sermonId, mediaSermonId: media.sermonId, occasionSermonId: occasion.sermonId },
      "sermon_media_occasion_mismatch"
    );
  }
  const nowIso = getNowIso(deps);
  media.occasionId = occasionId;
  media.recordedAt = normalizeString(media.recordedAt || occasion.scheduledAt || occasion.date);
  media.updatedAt = nowIso;
  media.searchText = buildSermonMediaSearchText(media);
  occasion.mediaIds = Array.from(new Set([
    ...(Array.isArray(occasion.mediaIds) ? occasion.mediaIds : []),
    mediaId
  ].map(normalizeString).filter(Boolean)));
  occasion.updatedAt = nowIso;
  occasion.searchText = buildSermonOccasionSearchText(occasion);
  await mediaCollection.doc(mediaId).set(media);
  await occasionsCollection.doc(occasionId).set(occasion);
  return {
    media: buildSermonMediaDetail(media, mediaId),
    occasion: buildSermonOccasionSummary(occasion, occasionId)
  };
}

async function listSermonMedia(input = {}, deps = {}) {
  const mediaCollection = getSermonMediaCollection(deps);
  const sermonId = normalizeString(input.sermonId);
  const mediaType = normalizeString(input.mediaType || input.type);
  const transcriptStatus = normalizeString(input.transcriptStatus);
  const query = normalizeString(input.query).toLowerCase();
  const limit = normalizeLimit(input.limit);

  if (mediaType && !SERMON_MEDIA_TYPES.includes(mediaType)) {
    throw createSermonWorkspaceError(
      "Invalid sermon media type",
      400,
      { mediaType, allowedValues: SERMON_MEDIA_TYPES },
      "invalid_sermon_media_type"
    );
  }

  if (transcriptStatus && !SERMON_MEDIA_TRANSCRIPT_STATUSES.includes(transcriptStatus)) {
    throw createSermonWorkspaceError(
      "Invalid sermon media transcript status",
      400,
      { transcriptStatus, allowedValues: SERMON_MEDIA_TRANSCRIPT_STATUSES },
      "invalid_sermon_media_transcript_status"
    );
  }

  const mediaItems = (await loadCollection(mediaCollection, 1000))
    .filter(({ data }) => !sermonId || normalizeString(data.sermonId) === sermonId)
    .filter(({ data }) => !mediaType || normalizeString(data.mediaType || "other") === mediaType)
    .filter(({ data }) => !transcriptStatus || normalizeString(data.transcriptStatus || "none") === transcriptStatus)
    .filter(({ data }) => !query || buildSermonMediaSearchText(data).includes(query))
    .map(({ id, data }) => buildSermonMediaSummary(data, id))
    .sort((left, right) => (right.recordedAt || right.createdAt || "").localeCompare(left.recordedAt || left.createdAt || ""))
    .slice(0, limit);

  return {
    count: mediaItems.length,
    media: mediaItems
  };
}

async function getSermonMedia(input = {}, deps = {}) {
  const mediaCollection = getSermonMediaCollection(deps);
  const mediaId = validateDocId(input.mediaId, "mediaId");
  const doc = await mediaCollection.doc(mediaId).get();

  if (!doc.exists) {
    throw createSermonWorkspaceError("Sermon media not found", 404, { mediaId }, "sermon_media_not_found");
  }

  return {
    media: buildSermonMediaDetail(doc.data() || {}, mediaId)
  };
}

async function updateSermonMedia(input = {}, deps = {}) {
  const mediaCollection = getSermonMediaCollection(deps);
  const mediaId = validateDocId(input.mediaId, "mediaId");
  const docRef = mediaCollection.doc(mediaId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSermonWorkspaceError("Sermon media not found", 404, { mediaId }, "sermon_media_not_found");
  }

  const changes = isPlainObject(input.changes) ? input.changes : input;
  const nextMedia = { ...clone(doc.data() || {}), mediaId };

  for (const field of ["title", "label", "platform", "externalId", "url", "storagePath", "originalFilename", "contentType", "recordedAt", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextMedia[field] = normalizeString(changes[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "mediaType")) {
    nextMedia.mediaType = normalizeEnum(changes.mediaType, SERMON_MEDIA_TYPES, nextMedia.mediaType || "other", "sermon_media_type");
  }

  for (const numberField of ["startSeconds", "endSeconds", "durationSeconds"]) {
    if (Object.prototype.hasOwnProperty.call(changes, numberField)) {
      nextMedia[numberField] = normalizeOptionalNumber(changes[numberField]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "transcriptStatus")) {
    nextMedia.transcriptStatus = normalizeEnum(
      changes.transcriptStatus,
      SERMON_MEDIA_TRANSCRIPT_STATUSES,
      nextMedia.transcriptStatus || "none",
      "sermon_media_transcript_status"
    );
  }

  if (Object.prototype.hasOwnProperty.call(changes, "transcriptSourceIds")) {
    nextMedia.transcriptSourceIds = isPlainObject(changes.transcriptSourceIds)
      ? clone(changes.transcriptSourceIds)
      : {};
  }

  if (Object.prototype.hasOwnProperty.call(changes, "sourceRefs")) {
    nextMedia.sourceRefs = normalizeSourceRefs(changes.sourceRefs);
  }

  nextMedia.updatedAt = getNowIso(deps);
  nextMedia.searchText = buildSermonMediaSearchText(nextMedia);
  await docRef.set(nextMedia);

  return {
    media: buildSermonMediaDetail(nextMedia, mediaId)
  };
}

async function createSermonMediaTranscriptSource(input = {}, deps = {}) {
  const mediaCollection = getSermonMediaCollection(deps);
  const mediaId = validateDocId(input.mediaId, "mediaId");
  const mediaDocRef = mediaCollection.doc(mediaId);
  const mediaDoc = await mediaDocRef.get();

  if (!mediaDoc.exists) {
    throw createSermonWorkspaceError("Sermon media not found", 404, { mediaId }, "sermon_media_not_found");
  }

  const media = buildSermonMediaDetail(mediaDoc.data() || {}, mediaId);
  const transcriptText = normalizeString(input.transcriptText || input.material || input.text);

  if (!transcriptText) {
    throw createSermonWorkspaceError(
      "Transcript source requires transcriptText",
      400,
      {},
      "missing_transcript_text"
    );
  }

  const transcriptKind = normalizeEnum(
    input.transcriptKind || input.kind,
    ["raw", "cleaned"],
    "raw",
    "sermon_media_transcript_kind"
  );
  const sourceType = transcriptKind === "cleaned" ? "cleaned_transcript" : (
    media.mediaType === "youtube" ? "youtube_caption" :
      media.mediaType === "vimeo" ? "vimeo_transcript" : "preached_transcript"
  );
  const existingSourceId = normalizeString(media.transcriptSourceIds?.[transcriptKind]);
  if (existingSourceId && input.force !== true) {
    const existingSourceDoc = await getSermonSourcesCollection(deps).doc(existingSourceId).get();
    const existingSource = existingSourceDoc.exists
      ? buildSermonSourceDetail(existingSourceDoc.data() || {}, existingSourceId)
      : null;
    if (existingSource && normalizeString(existingSource.material) === transcriptText) {
      return {
        media,
        source: existingSource,
        reused: true
      };
    }
  }
  const nowIso = getNowIso(deps);
  const source = await createSermonSource(
    {
      sermonId: media.sermonId,
      sourceType,
      sourceLabel: normalizeString(input.sourceLabel) ||
        `${transcriptKind === "cleaned" ? "Cleaned" : "Raw"} transcript - ${media.label || media.title || mediaId}`,
      summary: truncateImportedText(input.summary || `${transcriptKind === "cleaned" ? "Cleaned" : "Raw"} preached transcript connected to media ${mediaId}.`),
      material: transcriptText,
      sourceRefs: [
        ...normalizeSourceRefs(input.sourceRefs),
        {
          type: "sermon_media",
          mediaId,
          mediaType: media.mediaType,
          platform: media.platform,
          url: media.url,
          storagePath: media.storagePath,
          occasionId: media.occasionId,
          transcriptKind,
          createdAt: nowIso
        }
      ]
    },
    deps
  );
  const transcriptSourceIds = isPlainObject(media.transcriptSourceIds)
    ? clone(media.transcriptSourceIds)
    : {};
  transcriptSourceIds[transcriptKind] = source.source.sourceId;
  const nextMedia = {
    ...clone(mediaDoc.data() || {}),
    mediaId,
    transcriptSourceIds,
    transcriptStatus: transcriptKind === "cleaned" ? "cleaned" : "raw_saved",
    updatedAt: nowIso
  };
  nextMedia.searchText = buildSermonMediaSearchText(nextMedia);
  await mediaDocRef.set(nextMedia);

  return {
    media: buildSermonMediaDetail(nextMedia, mediaId),
    source: source.source
  };
}

async function getSermonContext(input = {}, deps = {}) {
  const { sermonId, doc } = await getRequiredSermonDoc(input.sermonId, deps);
  const occasionRecords = await loadSermonOccasionRecords(
    getSermonOccasionsCollection(deps),
    { sermonId }
  );
  const sermon = buildSermonDetail(enrichSermonWithOccasions(
    doc.data() || {},
    occasionRecords.map(({ id, data }) => buildSermonOccasionSummary(data, id)),
    getNowIso(deps)
  ), sermonId);
  let folder = null;

  if (sermon.folderId) {
    const foldersCollection = getFoldersCollection(deps);
    const folderDoc = await foldersCollection.doc(validateDocId(sermon.folderId, "folderId")).get();
    folder = folderDoc.exists ? buildFolderSummary(folderDoc.data() || {}, sermon.folderId) : null;
  }

  const includeSourceMaterial = input.includeSourceMaterial === true;
  const sourcesCollection = getSermonSourcesCollection(deps);
  const sourceLimit = normalizeLimit(input.sourceLimit || input.limit || 10);
  const sourceRecords = (await loadSermonSourceRecords(sourcesCollection, {
    sermonId,
    maxDocs: 10000
  }))
    .sort((left, right) => {
      const primarySourceId = normalizeString(sermon.primaryManuscriptSourceId);
      const leftIsPrimary = primarySourceId && normalizeString(left.data.sourceId || left.id) === primarySourceId;
      const rightIsPrimary = primarySourceId && normalizeString(right.data.sourceId || right.id) === primarySourceId;

      if (leftIsPrimary !== rightIsPrimary) {
        return leftIsPrimary ? -1 : 1;
      }

      const leftDate = left.data.createdAt || left.data.updatedAt || "";
      const rightDate = right.data.createdAt || right.data.updatedAt || "";
      return rightDate.localeCompare(leftDate);
    });
  const sources = sourceRecords
    .slice(0, sourceLimit)
    .map(({ id, data }) => includeSourceMaterial
      ? buildSermonSourceDetail(data, id)
      : buildSermonSourceSummary(data, id));
  const snapshots = await listSermonSnapshots(
    {
      sermonId,
      limit: input.snapshotLimit || 5
    },
    deps
  );
  const preachingAnalyses = await listPreachingAnalyses(
    {
      sermonId,
      limit: input.analysisLimit || 5
    },
    deps
  );
  const developmentSessions = await listSermonDevelopmentSessions(
    { sermonId, limit: input.sessionLimit || 5 },
    deps
  );
  const developmentCheckpoints = await listSermonDevelopmentCheckpoints(
    { sermonId, limit: input.checkpointLimit || 25 },
    deps
  );
  const preachingProfile = input.includePreachingProfile === false
    ? null
    : (await getPreachingProfile({ profileId: input.profileId }, deps)).profile;

  return {
    sermon,
    folder,
    sources,
    recentSnapshots: snapshots.snapshots,
    recentDevelopmentSessions: developmentSessions.sessions,
    developmentCheckpoints: developmentCheckpoints.checkpoints,
    preachingAnalyses: preachingAnalyses.analyses,
    preachingProfile,
    counts: {
      sourceCount: sourceRecords.length,
      returnedSourceCount: sources.length,
      snapshotCount: snapshots.count,
      preachingAnalysisCount: preachingAnalyses.count,
      developmentSessionCount: developmentSessions.count,
      developmentCheckpointCount: developmentCheckpoints.count,
      occasionCount: sermon.occasionCount
    }
  };
}

async function rebuildSermonChunks(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const chunksCollection = getSermonChunksCollection(deps);
  const sermonId = validateDocId(input.sermonId, "sermonId");
  const sermonDoc = await sermonsCollection.doc(sermonId).get();

  if (!sermonDoc.exists) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const sermon = buildSermonDetail(sermonDoc.data() || {}, sermonId);
  const sourceRecords = await listSermonSources({ sermonId, limit: 100 }, deps);
  const sources = [];

  for (const source of sourceRecords.sources) {
    const sourceDetail = await getSermonSource({ sourceId: source.sourceId }, deps);
    sources.push(sourceDetail.source);
  }

  const analysisRecords = await listPreachingAnalyses({ sermonId, limit: 100 }, deps);
  const nowIso = getNowIso(deps);
  const chunks = buildSermonChunks(sermon, sources, analysisRecords.analyses, nowIso);
  let existingRecordsQuery = chunksCollection;
  let existing;

  if (typeof existingRecordsQuery.where === "function") {
    const snapshot = await existingRecordsQuery.where("sermonId", "==", sermonId).limit(1000).get();
    existing = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  } else {
    existing = (await loadCollection(chunksCollection, 10000))
      .filter(({ data }) => normalizeString(data.sermonId) === sermonId);
  }

  await Promise.all(existing.map(({ id }) => {
    const docRef = chunksCollection.doc(id);
    return typeof docRef.delete === "function" ? docRef.delete() : docRef.set({ deleted: true, sermonId });
  }));
  await Promise.all(chunks.map((chunk) => chunksCollection.doc(chunk.chunkId).set(chunk)));

  return {
    sermonId,
    chunkCount: chunks.length,
    deletedChunkCount: existing.length,
    chunks: chunks.map((chunk) => buildSermonChunkSummary(chunk, chunk.chunkId))
  };
}

async function getCanonicalTaggedSermonIds(tag, deps = {}) {
  const cleanTag = normalizeString(tag).toLowerCase();
  if (!cleanTag) return null;

  return new Set((await loadCollection(getSermonsCollection(deps), 10000))
    .filter(({ data }) => normalizeTags(data.tags).some((item) => item.toLowerCase() === cleanTag))
    .map(({ id, data }) => normalizeString(data.sermonId || id)));
}

async function searchSermonChunks(input = {}, deps = {}) {
  const chunksCollection = getSermonChunksCollection(deps);
  const query = normalizeString(input.query).toLowerCase();
  const sermonId = normalizeString(input.sermonId);
  const folderId = normalizeString(input.folderId);
  const seriesId = normalizeString(input.seriesId);
  const seriesSlug = normalizeString(input.seriesSlug);
  const tag = normalizeString(input.tag).toLowerCase();
  const sourceKind = normalizeString(input.sourceKind);
  const chunkType = normalizeString(input.chunkType);
  const limit = normalizeLimit(input.limit);
  const canonicalTaggedSermonIds = await getCanonicalTaggedSermonIds(tag, deps);

  if (!query && !sermonId && !folderId && !seriesId && !seriesSlug && !tag) {
    throw createSermonWorkspaceError(
      "Chunk search requires query, sermonId, folderId, series, or tag",
      400,
      {},
      "missing_chunk_search_target"
    );
  }

  let chunkRecords;
  let chunkQuery = chunksCollection;
  const canUseFirestoreQuery = typeof chunkQuery.where === "function";

  if (canUseFirestoreQuery && (sermonId || folderId || seriesId || seriesSlug || sourceKind || chunkType)) {
    if (sermonId) chunkQuery = chunkQuery.where("sermonId", "==", sermonId);
    if (folderId) chunkQuery = chunkQuery.where("folderId", "==", folderId);
    if (seriesId) chunkQuery = chunkQuery.where("seriesId", "==", seriesId);
    if (seriesSlug) chunkQuery = chunkQuery.where("seriesSlug", "==", seriesSlug);
    if (sourceKind) chunkQuery = chunkQuery.where("sourceKind", "==", sourceKind);
    if (chunkType) chunkQuery = chunkQuery.where("chunkType", "==", chunkType);
    const snapshot = await chunkQuery.limit(Math.max(limit * 10, 100)).get();
    chunkRecords = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  } else {
    const targetedSearch = Boolean(sermonId || folderId || seriesId || seriesSlug || tag || sourceKind || chunkType);
    chunkRecords = await loadCollection(chunksCollection, targetedSearch || !query ? 10000 : 2000);
  }

  const chunks = chunkRecords
    .filter(({ data }) => !data.deleted)
    .filter(({ data }) => !sermonId || normalizeString(data.sermonId) === sermonId)
    .filter(({ data }) => !folderId || normalizeString(data.folderId) === folderId)
    .filter(({ data }) => !seriesId || normalizeString(data.seriesId) === seriesId)
    .filter(({ data }) => !seriesSlug || normalizeString(data.seriesSlug) === seriesSlug)
    .filter(({ id, data }) => !tag || canonicalTaggedSermonIds.has(normalizeString(data.sermonId || id)))
    .filter(({ data }) => !sourceKind || normalizeString(data.sourceKind) === sourceKind)
    .filter(({ data }) => !chunkType || normalizeString(data.chunkType) === chunkType)
    .filter(({ data }) => !query || buildSermonChunkSearchText(data).includes(query))
    .map(({ id, data }) => buildSermonChunkSummary(data, id))
    .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""))
    .slice(0, limit);

  return {
    count: chunks.length,
    chunks
  };
}

async function embedSermonChunks(input = {}, deps = {}) {
  const chunksCollection = getSermonChunksCollection(deps);
  const embedText = getEmbedTextFunction(deps);
  const toVectorValue = typeof deps.toVectorValue === "function" ? deps.toVectorValue : null;
  const sermonId = normalizeString(input.sermonId);
  const folderId = normalizeString(input.folderId);
  const seriesId = normalizeString(input.seriesId);
  const seriesSlug = normalizeString(input.seriesSlug);
  const tag = normalizeString(input.tag).toLowerCase();
  const sourceKind = normalizeString(input.sourceKind);
  const chunkType = normalizeString(input.chunkType);
  const limit = normalizeLimit(input.limit || 25);
  const force = input.force === true;
  const embeddingModel = normalizeString(input.embeddingModel || deps.embeddingModel) || DEFAULT_EMBEDDING_MODEL;
  const taskType = normalizeString(input.taskType || deps.embeddingTaskType) || "RETRIEVAL_DOCUMENT";
  const nowIso = getNowIso(deps);
  const canonicalTaggedSermonIds = await getCanonicalTaggedSermonIds(tag, deps);
  let lightQuery = chunksCollection;
  const canUseFirestoreQuery = typeof lightQuery.where === "function" &&
    typeof lightQuery.select === "function";
  const selectedFields = [
    "chunkId",
    "sourceKind",
    "sermonId",
    "folderId",
    "seriesId",
    "seriesTitle",
    "seriesSlug",
    "seriesNumber",
    "tags",
    "sourceId",
    "analysisId",
    "chunkType",
    "title",
    "scriptureText",
    "text",
    "textHash",
    "embeddingModel",
    "embeddingTextHash",
    "deleted",
    "updatedAt"
  ];
  let matchingRecords;

  if (canUseFirestoreQuery) {
    if (sermonId) lightQuery = lightQuery.where("sermonId", "==", sermonId);
    if (folderId) lightQuery = lightQuery.where("folderId", "==", folderId);
    if (seriesId) lightQuery = lightQuery.where("seriesId", "==", seriesId);
    if (seriesSlug) lightQuery = lightQuery.where("seriesSlug", "==", seriesSlug);
    if (sourceKind) lightQuery = lightQuery.where("sourceKind", "==", sourceKind);
    if (chunkType) lightQuery = lightQuery.where("chunkType", "==", chunkType);

    const snapshot = await lightQuery.select(...selectedFields).get();
    matchingRecords = snapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() || {} }))
      .filter(({ data }) => !data.deleted)
      .filter(({ data }) => normalizeString(data.text));
  } else {
    matchingRecords = (await loadCollection(chunksCollection, 10000))
    .filter(({ data }) => !data.deleted)
    .filter(({ data }) => !sermonId || normalizeString(data.sermonId) === sermonId)
    .filter(({ data }) => !folderId || normalizeString(data.folderId) === folderId)
    .filter(({ data }) => !seriesId || normalizeString(data.seriesId) === seriesId)
    .filter(({ data }) => !seriesSlug || normalizeString(data.seriesSlug) === seriesSlug)
    .filter(({ data }) => !sourceKind || normalizeString(data.sourceKind) === sourceKind)
    .filter(({ data }) => !chunkType || normalizeString(data.chunkType) === chunkType)
    .filter(({ data }) => normalizeString(data.text));
  }

  matchingRecords = matchingRecords
    .filter(({ id, data }) => !tag || canonicalTaggedSermonIds.has(normalizeString(data.sermonId || id)));

  const pendingRecords = matchingRecords
    .filter(({ data }) => {
      if (force) {
        return true;
      }

      return !normalizeString(data.embeddingTextHash) ||
        normalizeString(data.embeddingModel) !== embeddingModel ||
        normalizeString(data.embeddingTextHash) !== normalizeString(data.textHash) ||
        (!canUseFirestoreQuery && toVectorValue && !data.embeddingVector);
    })
  const records = pendingRecords.slice(0, limit);

  const embeddedChunks = [];

  for (const { id, data } of records) {
    const embedding = await embedText(data.text, {
      taskType,
      model: embeddingModel,
      chunk: data
    });

    if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every((value) => typeof value === "number")) {
      throw createSermonWorkspaceError(
        "Embedding provider returned an invalid vector",
        502,
        { chunkId: data.chunkId || id },
        "invalid_embedding_vector"
      );
    }

    const nextChunk = {
      ...clone(data),
      chunkId: data.chunkId || id,
      embedding,
      embeddingVector: toVectorValue ? toVectorValue(embedding) : embedding,
      embeddingDimensions: embedding.length,
      embeddingModel,
      embeddingTaskType: taskType,
      embeddingTextHash: data.textHash || hashText(data.text),
      embeddedAt: nowIso,
      updatedAt: nowIso
    };
    nextChunk.searchText = buildSermonChunkSearchText(nextChunk);
    const docRef = chunksCollection.doc(id);
    await docRef.set(nextChunk, typeof docRef.update === "function" ? { merge: true } : undefined);
    embeddedChunks.push(buildSermonChunkSummary(nextChunk, id));
  }

  return {
    embeddedCount: embeddedChunks.length,
    matchingChunkCount: matchingRecords.length,
    pendingChunkCount: pendingRecords.length,
    embeddingModel,
    taskType,
    chunks: embeddedChunks
  };
}

function normalizeVectorDistanceMeasure(value) {
  const cleanValue = normalizeString(value || "COSINE").toUpperCase();
  const allowedValues = ["COSINE", "EUCLIDEAN", "DOT_PRODUCT"];

  if (!allowedValues.includes(cleanValue)) {
    throw createSermonWorkspaceError(
      "Invalid distanceMeasure",
      400,
      { distanceMeasure: cleanValue, allowedValues },
      "invalid_distance_measure"
    );
  }

  return cleanValue;
}

async function semanticSearchSermonChunks(input = {}, deps = {}) {
  const embedText = getEmbedTextFunction(deps);
  const findNearestChunks = getFindNearestChunksFunction(deps);
  const query = normalizeString(input.query);
  const sermonId = normalizeString(input.sermonId);
  const folderId = normalizeString(input.folderId);
  const seriesId = normalizeString(input.seriesId);
  const seriesSlug = normalizeString(input.seriesSlug);
  const tag = normalizeString(input.tag).toLowerCase();
  const sourceKind = normalizeString(input.sourceKind);
  const chunkType = normalizeString(input.chunkType);
  const limit = normalizeLimit(input.limit);
  const candidateLimit = tag
    ? Math.min(Math.max(limit * 20, 200), 1000)
    : Math.min(Math.max(limit * 5, limit), 100);
  const embeddingModel = normalizeString(input.embeddingModel || deps.embeddingModel) || DEFAULT_EMBEDDING_MODEL;
  const taskType = "RETRIEVAL_QUERY";
  const distanceMeasure = normalizeVectorDistanceMeasure(input.distanceMeasure);

  if (!query) {
    throw createSermonWorkspaceError(
      "Semantic chunk search requires query",
      400,
      {},
      "missing_semantic_chunk_search_query"
    );
  }

  const canonicalTaggedSermonIds = await getCanonicalTaggedSermonIds(tag, deps);

  const queryEmbedding = await embedText(query, {
    taskType,
    model: embeddingModel
  });

  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0 || !queryEmbedding.every((value) => typeof value === "number")) {
    throw createSermonWorkspaceError(
      "Embedding provider returned an invalid query vector",
      502,
      {},
      "invalid_query_embedding_vector"
    );
  }

  const nearestRecords = await findNearestChunks(queryEmbedding, {
    limit: candidateLimit,
    distanceMeasure
  });

  const chunks = nearestRecords
    .map(({ id, data }) => buildSermonChunkSummary(data || {}, id))
    .filter((chunk) => !sermonId || normalizeString(chunk.sermonId) === sermonId)
    .filter((chunk) => !folderId || normalizeString(chunk.folderId) === folderId)
    .filter((chunk) => !seriesId || normalizeString(chunk.seriesId) === seriesId)
    .filter((chunk) => !seriesSlug || normalizeString(chunk.seriesSlug) === seriesSlug)
    .filter((chunk) => !tag || canonicalTaggedSermonIds.has(normalizeString(chunk.sermonId)))
    .filter((chunk) => !sourceKind || normalizeString(chunk.sourceKind) === sourceKind)
    .filter((chunk) => !chunkType || normalizeString(chunk.chunkType) === chunkType)
    .slice(0, limit);

  return {
    query,
    count: chunks.length,
    candidateCount: nearestRecords.length,
    embeddingModel,
    taskType,
    distanceMeasure,
    chunks
  };
}

function buildRagCitation(chunk, index) {
  const number = index + 1;
  const labelParts = [
    chunk.title || "Untitled",
    chunk.scriptureText,
    chunk.chunkType
  ].filter(Boolean);

  return {
    citationId: `S${number}`,
    chunkId: chunk.chunkId,
    sermonId: chunk.sermonId,
    folderId: chunk.folderId,
    sourceKind: chunk.sourceKind,
    sourceId: chunk.sourceId,
    analysisId: chunk.analysisId,
    chunkType: chunk.chunkType,
    title: chunk.title,
    scriptureText: chunk.scriptureText,
    vectorDistance: chunk.vectorDistance,
    label: labelParts.join(" | ")
  };
}

function buildRagContextText(chunks) {
  let remaining = MAX_RAG_CONTEXT_CHARS;
  const blocks = [];

  chunks.forEach((chunk, index) => {
    if (remaining <= 0) {
      return;
    }

    const citationId = `S${index + 1}`;
    const header = [
      `[${citationId}]`,
      chunk.title || "Untitled",
      chunk.scriptureText ? `Passage: ${chunk.scriptureText}` : "",
      chunk.sourceKind ? `Kind: ${chunk.sourceKind}` : "",
      chunk.chunkType ? `Type: ${chunk.chunkType}` : "",
      typeof chunk.vectorDistance === "number" ? `Distance: ${chunk.vectorDistance}` : ""
    ].filter(Boolean).join(" ");
    const text = normalizeString(chunk.text);
    const availableForText = Math.max(remaining - header.length - 4, 0);
    const trimmedText = text.length > availableForText
      ? `${text.slice(0, Math.max(availableForText - 20, 0))}\n[truncated]`
      : text;
    const block = `${header}\n${trimmedText}`;

    blocks.push(block);
    remaining -= block.length + 2;
  });

  return blocks.join("\n\n");
}

async function answerSermonQuestion(input = {}, deps = {}) {
  const generateRagAnswer = getGenerateRagAnswerFunction(deps);
  const question = normalizeString(input.question || input.query);
  const limit = normalizeLimit(input.limit || 8);

  if (!question) {
    throw createSermonWorkspaceError(
      "RAG answer requires question",
      400,
      {},
      "missing_rag_answer_question"
    );
  }

  const retrieval = await semanticSearchSermonChunks(
    {
      query: question,
      sermonId: input.sermonId,
      folderId: input.folderId,
      seriesId: input.seriesId,
      seriesSlug: input.seriesSlug,
      tag: input.tag,
      sourceKind: input.sourceKind,
      chunkType: input.chunkType,
      limit,
      distanceMeasure: input.distanceMeasure,
      embeddingModel: input.embeddingModel
    },
    deps
  );

  if (retrieval.chunks.length === 0) {
    return {
      question,
      answer: "I could not find embedded sermon material close enough to answer from the saved sermon archive.",
      retrieval,
      citations: [],
      contextText: ""
    };
  }

  const citations = retrieval.chunks.map(buildRagCitation);
  const contextText = buildRagContextText(retrieval.chunks);
  const answer = await generateRagAnswer({
    question,
    contextText,
    citations,
    retrieval,
    answerStyle: normalizeString(input.answerStyle) || "concise"
  });

  return {
    question,
    answer: normalizeString(answer),
    retrieval,
    citations,
    contextText
  };
}

async function updateSermon(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const sermonId = validateDocId(input.sermonId, "sermonId");
  const docRef = sermonsCollection.doc(sermonId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const changes = isPlainObject(input.changes) ? input.changes : input;
  const nextSermon = { ...clone(doc.data() || {}), sermonId };

  if (Object.prototype.hasOwnProperty.call(changes, "folderId")) {
    nextSermon.folderId = await assertSermonFolderExists(changes.folderId, deps);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    const title = normalizeString(changes.title);
    if (!title) {
      throw createSermonWorkspaceError("Sermon title cannot be blank", 400, {}, "blank_sermon_title");
    }
    nextSermon.title = title;
  }

  for (const field of ["scriptureText", "bigIdea", "occasion", "notes", "outline"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextSermon[field] = normalizeString(changes[field]);
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(changes, "series") ||
    Object.prototype.hasOwnProperty.call(changes, "seriesId") ||
    Object.prototype.hasOwnProperty.call(changes, "seriesTitle") ||
    Object.prototype.hasOwnProperty.call(changes, "seriesSlug") ||
    Object.prototype.hasOwnProperty.call(changes, "seriesNumber")
  ) {
    const series = buildSeriesMetadata(changes, nextSermon);
    nextSermon.seriesId = series.seriesId;
    nextSermon.seriesTitle = series.seriesTitle;
    nextSermon.seriesSlug = series.seriesSlug;
    nextSermon.seriesNumber = series.seriesNumber;
    nextSermon.series = series.series;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "tags")) {
    nextSermon.tags = normalizeTags(changes.tags);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    nextSermon.status = normalizeEnum(changes.status, SERMON_STATUSES, nextSermon.status, "sermon_status");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "targetDate")) {
    nextSermon.targetDate = normalizeOptionalDate(changes.targetDate, "targetDate");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "preachedDate")) {
    nextSermon.preachedDate = normalizeOptionalDate(changes.preachedDate, "preachedDate");
  }

  if (Object.prototype.hasOwnProperty.call(changes, "sourceRefs")) {
    nextSermon.sourceRefs = Array.isArray(changes.sourceRefs)
      ? changes.sourceRefs.filter(isPlainObject).map(clone)
      : [];
  }

  if (Object.prototype.hasOwnProperty.call(changes, "primaryManuscriptSourceId")) {
    const primaryManuscriptSourceId = normalizeString(changes.primaryManuscriptSourceId);

    if (primaryManuscriptSourceId) {
      const sourceDoc = await getSermonSourcesCollection(deps)
        .doc(validateDocId(primaryManuscriptSourceId, "primaryManuscriptSourceId"))
        .get();

      if (!sourceDoc.exists || normalizeString(sourceDoc.data()?.sermonId) !== sermonId) {
        throw createSermonWorkspaceError(
          "Primary manuscript source must belong to this sermon",
          400,
          { sermonId, primaryManuscriptSourceId },
          "invalid_primary_manuscript_source"
        );
      }
    }

    nextSermon.primaryManuscriptSourceId = primaryManuscriptSourceId;
  }

  const snapshot = await saveSermonSnapshot({ ...clone(doc.data() || {}), sermonId }, deps, {
    snapshotType: "before_update",
    reason: normalizeString(input.snapshotReason) || "Before sermon update"
  });
  const previousStatus = normalizeString(doc.data()?.status);
  nextSermon.updatedAt = getNowIso(deps);
  nextSermon.searchText = buildSermonSearchText(nextSermon);
  await docRef.set(nextSermon);
  let scriptureNoteExtraction = null;
  if (
    normalizeString(nextSermon.status) === "ready" &&
    previousStatus !== "ready" &&
    input.extractScriptureNotes !== false &&
    typeof deps.extractScriptureNotesFromSermon === "function"
  ) {
    try {
      scriptureNoteExtraction = await deps.extractScriptureNotesFromSermon(
        { sermonId, compact: true },
        deps
      );
    } catch (error) {
      scriptureNoteExtraction = {
        action: "failed",
        error: {
          code: error?.code || "scripture_note_extraction_failed",
          message: error?.message || "Automatic Scripture note extraction failed"
        }
      };
    }
  }

  return { sermon: buildSermonDetail(nextSermon, sermonId), snapshot, scriptureNoteExtraction };
}

async function addSermonDevelopmentNote(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const sermonId = validateDocId(input.sermonId, "sermonId");
  const content = normalizeString(input.content);

  if (!content) {
    throw createSermonWorkspaceError("Missing note content", 400, {}, "missing_note_content");
  }

  const docRef = sermonsCollection.doc(sermonId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const nowIso = getNowIso(deps);
  const nextSermon = { ...clone(doc.data() || {}), sermonId };
  const snapshot = await saveSermonSnapshot(nextSermon, deps, {
    snapshotType: "before_development_note",
    reason: normalizeString(input.snapshotReason) || "Before development note append"
  });
  const note = {
    noteId: createId("note", content, deps),
    content,
    noteType: normalizeString(input.noteType) || "development",
    createdAt: nowIso
  };

  nextSermon.developmentNotes = Array.isArray(nextSermon.developmentNotes)
    ? nextSermon.developmentNotes.concat(note)
    : [note];
  nextSermon.updatedAt = nowIso;
  nextSermon.searchText = buildSermonSearchText(nextSermon);
  await docRef.set(nextSermon);

  return {
    note,
    sermon: buildSermonDetail(nextSermon, sermonId),
    snapshot
  };
}

async function appendSermonContent(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const sermonId = validateDocId(input.sermonId, "sermonId");
  const appendType = normalizeEnum(input.appendType || input.contentType, SERMON_APPEND_TYPES, "", "sermon_append_type");
  const content = normalizeString(input.content);

  if (!appendType) {
    throw createSermonWorkspaceError(
      "Missing append type",
      400,
      { allowedValues: SERMON_APPEND_TYPES },
      "missing_sermon_append_type"
    );
  }

  if (!content) {
    throw createSermonWorkspaceError("Missing append content", 400, {}, "missing_append_content");
  }

  const docRef = sermonsCollection.doc(sermonId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSermonWorkspaceError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  }

  const nowIso = getNowIso(deps);
  const nextSermon = { ...clone(doc.data() || {}), sermonId };
  const snapshot = await saveSermonSnapshot(nextSermon, deps, {
    snapshotType: "before_append",
    reason: normalizeString(input.snapshotReason) || `Before ${appendType} append`
  });
  const sourceLabel = normalizeString(input.sourceLabel);
  const heading = normalizeString(input.heading) ||
    `${appendType.replace(/_/g, " ")} - ${sourceLabel || nowIso}`;
  const note = {
    noteId: createId("note", content, deps),
    content,
    noteType: appendType === "note" ? "development" : appendType,
    createdAt: nowIso
  };

  if (appendType === "outline") {
    nextSermon.outline = appendSection(nextSermon.outline, heading, content);
  } else if (appendType === "source_material") {
    nextSermon.notes = appendSection(nextSermon.notes, heading, content);
  }

  nextSermon.developmentNotes = Array.isArray(nextSermon.developmentNotes)
    ? nextSermon.developmentNotes.concat(note)
    : [note];

  if (Object.prototype.hasOwnProperty.call(input, "sourceRefs")) {
    const existingRefs = Array.isArray(nextSermon.sourceRefs) ? nextSermon.sourceRefs : [];
    const incomingRefs = Array.isArray(input.sourceRefs)
      ? input.sourceRefs.filter(isPlainObject).map(clone)
      : [];
    nextSermon.sourceRefs = existingRefs.concat(incomingRefs);
  }

  nextSermon.updatedAt = nowIso;
  nextSermon.searchText = buildSermonSearchText(nextSermon);
  await docRef.set(nextSermon);

  const sourceResult = appendType === "source_material"
    ? await createSermonSource(
      {
        sermonId,
        sourceId: input.sourceId,
        sourceType: input.sourceType || "study_notes",
        sourceLabel: sourceLabel || heading,
        summary: normalizeString(input.summary),
        material: content,
        sourceRefs: input.sourceRefs
      },
      deps
    )
    : null;

  return {
    appendType,
    note,
    snapshot,
    sourceSaved: Boolean(sourceResult),
    source: sourceResult ? sourceResult.source : null,
    sermon: buildSermonDetail(nextSermon, sermonId)
  };
}

async function importSermonMaterial(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const title = normalizeString(input.title);
  const scriptureText = normalizeString(input.scriptureText);
  const folderId = await assertSermonFolderExists(input.folderId, deps);
  const series = buildSeriesMetadata(input);
  const tags = normalizeTags(input.tags);
  const importedMaterial = truncateImportedText(input.importedMaterial || input.rawMaterial);
  const importedSummary = truncateImportedText(input.importedSummary || input.summary);
  const developmentNoteItems = normalizeDevelopmentNoteItems(input.developmentNotes);
  const sourceRefs = normalizeSourceRefs(input.sourceRefs);
  const importedOccasionInputs = Array.isArray(input.occasions)
    ? input.occasions.filter(isPlainObject).map((occasion) => ({
      ...occasion,
      status: normalizeString(occasion.status) ||
        (normalizeString(input.status) === "preached" || normalizeString(input.preachedDate) ? "preached" : "planned")
    }))
    : [];
  const sourceType = normalizeSermonSourceType(input.sourceType, "old_chat");
  const updateMode = normalizeString(input.updateMode) || "create_or_update";
  const replaceExisting = input.replaceExisting === true;
  const sourceId = normalizeString(input.sourceId)
    ? validateDocId(input.sourceId, "sourceId")
    : "";

  if (!["create_or_update", "create_only", "update_only"].includes(updateMode)) {
    throw createSermonWorkspaceError(
      "Invalid import updateMode",
      400,
      { updateMode, allowedValues: ["create_or_update", "create_only", "update_only"] },
      "invalid_import_update_mode"
    );
  }

  if (!title && !scriptureText && !normalizeString(input.sermonId)) {
    throw createSermonWorkspaceError(
      "Import requires a sermonId, title, or scriptureText",
      400,
      {},
      "missing_import_target"
    );
  }

  if (!importedMaterial && !importedSummary && developmentNoteItems.length === 0) {
    throw createSermonWorkspaceError(
      "Import requires importedMaterial, importedSummary, or developmentNotes",
      400,
      {},
      "missing_import_material"
    );
  }

  const records = await loadCollection(sermonsCollection, 10000);
  const target = findImportTarget(records, {
    sermonId: input.sermonId,
    folderId,
    seriesId: series.seriesId,
    seriesSlug: series.seriesSlug,
    title,
    scriptureText
  });
  const nowIso = getNowIso(deps);
  const sourceLabel = normalizeString(input.sourceLabel) || "Imported sermon material";
  const shouldSaveSource = Boolean(importedSummary || importedMaterial || sourceRefs.length > 0);

  if (shouldSaveSource && sourceId) {
    const existingSourceDoc = await getSermonSourcesCollection(deps).doc(sourceId).get();
    if (existingSourceDoc.exists) {
      const existingSource = { ...(existingSourceDoc.data() || {}), sourceId };
      const existingSermonId = validateDocId(existingSource.sermonId, "sermonId");
      const existingSermonDoc = await sermonsCollection.doc(existingSermonId).get();

      if (!existingSermonDoc.exists) {
        throw createSermonWorkspaceError(
          "Existing import source points to a missing sermon",
          409,
          { sourceId, sermonId: existingSermonId },
          "sermon_import_source_target_missing"
        );
      }

      const occasions = await upsertImportedSermonOccasions(
        existingSermonId,
        importedOccasionInputs,
        deps
      );

      return {
        action: "skipped_existing_source",
        sermon: occasions.length > 0
          ? (await getSermon({ sermonId: existingSermonId }, deps)).sermon
          : buildSermonDetail(existingSermonDoc.data() || {}, existingSermonId),
        importedNoteCount: 0,
        materialSaved: false,
        sourceSaved: false,
        source: buildSermonSourceDetail(existingSource, sourceId),
        occasions
      };
    }
  }

  const importHeading = `Imported material - ${sourceLabel} - ${nowIso}`;
  const importContent = [
    importedSummary ? `Summary:\n${importedSummary}` : "",
    importedMaterial ? `Material:\n${importedMaterial}` : ""
  ].filter(Boolean).join("\n\n");

  if (target && updateMode === "create_only") {
    throw createSermonWorkspaceError(
      "Matching sermon already exists",
      409,
      { sermonId: target.id },
      "sermon_import_target_exists"
    );
  }

  if (!target && updateMode === "update_only") {
    throw createSermonWorkspaceError(
      "No matching sermon was found for import",
      404,
      { title, scriptureText },
      "sermon_import_target_not_found"
    );
  }

  const noteObjects = developmentNoteItems.map((item) => ({
    noteId: createId("note", item.content, deps),
    content: item.content,
    noteType: item.noteType,
    createdAt: nowIso
  }));

  if (!target) {
    const sermonTitle = title || scriptureText || "Imported Sermon Material";
    const sermonId = normalizeString(input.sermonId)
      ? validateDocId(input.sermonId, "sermonId")
      : createId("sermon", sermonTitle, deps);
    const sermon = {
      sermonId,
      folderId,
      seriesId: series.seriesId,
      seriesTitle: series.seriesTitle,
      seriesSlug: series.seriesSlug,
      seriesNumber: series.seriesNumber,
      series: series.series,
      tags,
      title: sermonTitle,
      status: normalizeEnum(input.status, SERMON_STATUSES, "idea", "sermon_status"),
      scriptureText,
      bigIdea: normalizeString(input.bigIdea),
      targetDate: normalizeOptionalDate(input.targetDate, "targetDate"),
      preachedDate: normalizeOptionalDate(input.preachedDate, "preachedDate"),
      occasion: normalizeString(input.occasion),
      notes: appendSection(normalizeString(input.notes), importHeading, importContent),
      outline: normalizeString(input.outline),
      developmentNotes: noteObjects,
      sourceRefs,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    sermon.searchText = buildSermonSearchText(sermon);

    await sermonsCollection.doc(sermonId).create(sermon);
    const sourceResult = shouldSaveSource
      ? await createSermonSource(
        {
          sermonId,
          sourceId,
          sourceType,
          sourceLabel,
          summary: importedSummary,
          material: importedMaterial,
          sourceRefs
        },
        deps
      )
      : null;
    const occasions = await upsertImportedSermonOccasions(sermonId, importedOccasionInputs, deps);
    const enrichedSermon = occasions.length > 0
      ? (await getSermon({ sermonId }, deps)).sermon
      : buildSermonDetail(sermon, sermonId);

    return {
      action: "created",
      sermon: enrichedSermon,
      importedNoteCount: noteObjects.length,
      materialSaved: Boolean(importContent),
      sourceSaved: Boolean(sourceResult),
      source: sourceResult ? sourceResult.source : null,
      occasions
    };
  }

  const docRef = sermonsCollection.doc(target.id);
  const nextSermon = { ...clone(target.data), sermonId: target.id };
  const snapshot = await saveSermonSnapshot(nextSermon, deps, {
    snapshotType: "before_import",
    reason: normalizeString(input.snapshotReason) || `Before import from ${sourceLabel}`
  });

  if (title && (replaceExisting || !normalizeString(nextSermon.title))) {
    nextSermon.title = title;
  }

  for (const field of ["folderId", "scriptureText", "bigIdea", "occasion"]) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      const value = field === "folderId" ? folderId : normalizeString(input[field]);
      if (replaceExisting || !normalizeString(nextSermon[field])) {
        nextSermon[field] = value;
      }
    }
  }

  if (
    series.seriesId ||
    series.seriesTitle ||
    series.seriesSlug ||
    series.seriesNumber ||
    Object.prototype.hasOwnProperty.call(input, "series")
  ) {
    nextSermon.seriesId = series.seriesId;
    nextSermon.seriesTitle = series.seriesTitle;
    nextSermon.seriesSlug = series.seriesSlug;
    nextSermon.seriesNumber = series.seriesNumber;
    nextSermon.series = series.series;
  }

  if (Object.prototype.hasOwnProperty.call(input, "tags")) {
    nextSermon.tags = tags;
  }

  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    nextSermon.status = normalizeEnum(
      input.status,
      SERMON_STATUSES,
      nextSermon.status || "idea",
      "sermon_status"
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "targetDate")) {
    const value = normalizeOptionalDate(input.targetDate, "targetDate");
    if (replaceExisting || !normalizeString(nextSermon.targetDate)) {
      nextSermon.targetDate = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "preachedDate")) {
    const value = normalizeOptionalDate(input.preachedDate, "preachedDate");
    if (replaceExisting || !normalizeString(nextSermon.preachedDate)) {
      nextSermon.preachedDate = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "outline")) {
    const outline = normalizeString(input.outline);
    if (replaceExisting || !normalizeString(nextSermon.outline)) {
      nextSermon.outline = outline;
    } else if (outline) {
      nextSermon.outline = appendSection(nextSermon.outline, importHeading, outline);
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "sourceRefs")) {
    const existingRefs = Array.isArray(nextSermon.sourceRefs) ? nextSermon.sourceRefs : [];
    nextSermon.sourceRefs = replaceExisting ? sourceRefs : existingRefs.concat(sourceRefs);
  }

  nextSermon.notes = appendSection(nextSermon.notes, importHeading, importContent);
  nextSermon.developmentNotes = Array.isArray(nextSermon.developmentNotes)
    ? nextSermon.developmentNotes.concat(noteObjects)
    : noteObjects;
  nextSermon.updatedAt = nowIso;
  nextSermon.searchText = buildSermonSearchText(nextSermon);

  await docRef.set(nextSermon);
  const sourceResult = shouldSaveSource
    ? await createSermonSource(
      {
        sermonId: target.id,
        sourceId,
        sourceType,
        sourceLabel,
        summary: importedSummary,
        material: importedMaterial,
        sourceRefs
      },
      deps
    )
    : null;
  const occasions = await upsertImportedSermonOccasions(target.id, importedOccasionInputs, deps);
  const enrichedSermon = occasions.length > 0
    ? (await getSermon({ sermonId: target.id }, deps)).sermon
    : buildSermonDetail(nextSermon, target.id);

  return {
    action: "updated",
    sermon: enrichedSermon,
    importedNoteCount: noteObjects.length,
    materialSaved: Boolean(importContent),
    sourceSaved: Boolean(sourceResult),
    source: sourceResult ? sourceResult.source : null,
    snapshot,
    occasions
  };
}

async function importSermonMaterialBatch(input = {}, deps = {}) {
  const items = Array.isArray(input.items)
    ? input.items
    : (Array.isArray(input.sermons) ? input.sermons : []);
  const batchSize = items.length;

  if (batchSize === 0) {
    throw createSermonWorkspaceError(
      "Batch import requires items",
      400,
      {},
      "missing_sermon_import_batch_items"
    );
  }

  if (batchSize > MAX_SERMON_IMPORT_BATCH_SIZE) {
    throw createSermonWorkspaceError(
      "Sermon import batch is too large",
      400,
      { batchSize, maxBatchSize: MAX_SERMON_IMPORT_BATCH_SIZE },
      "sermon_import_batch_too_large"
    );
  }

  const defaults = isPlainObject(input.defaults) ? input.defaults : {};
  const rebuildChunks = input.rebuildChunks === true;
  const embedChunks = input.embedChunks === true;
  const stopOnError = input.stopOnError === true;
  const results = [];
  const errors = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];

    if (!isPlainObject(item)) {
      const error = createSermonWorkspaceError(
        "Import item must be an object",
        400,
        { index },
        "invalid_sermon_import_item"
      );
      errors.push({
        index,
        code: error.code,
        message: error.message,
        details: error.details
      });
      if (stopOnError) {
        break;
      }
      continue;
    }

    try {
      const importResult = await importSermonMaterial(
        {
          ...defaults,
          ...item,
          sourceType: item.sourceType || defaults.sourceType || "logos_export"
        },
        deps
      );
      const result = {
        index,
        action: importResult.action,
        sermon: importResult.sermon,
        source: importResult.source || null,
        occasions: Array.isArray(importResult.occasions) ? importResult.occasions : [],
        importedNoteCount: importResult.importedNoteCount,
        sourceSaved: importResult.sourceSaved
      };

      if (rebuildChunks) {
        result.rebuild = await rebuildSermonChunks(
          { sermonId: importResult.sermon.sermonId },
          deps
        );
      }

      if (embedChunks) {
        result.embedding = await embedSermonChunks(
          { sermonId: importResult.sermon.sermonId, limit: input.embedLimit || 25 },
          deps
        );
      }

      results.push(result);
    } catch (error) {
      errors.push({
        index,
        code: error.code || "sermon_import_item_failed",
        message: error.message || "Sermon import item failed",
        details: error.details || {}
      });

      if (stopOnError) {
        break;
      }
    }
  }

  return {
    importedCount: results.length,
    errorCount: errors.length,
    requestedCount: batchSize,
    rebuildChunks,
    embedChunks,
    results,
    errors
  };
}

async function getPreachingProfile(input = {}, deps = {}) {
  const preachingProfilesCollection = getPreachingProfileCollection(deps);
  const profileId = normalizeString(input.profileId) || DEFAULT_PREACHING_PROFILE_ID;
  const doc = await preachingProfilesCollection.doc(validateDocId(profileId, "profileId")).get();

  if (!doc.exists) {
    return {
      profile: buildPreachingProfileResponse(buildDefaultPreachingProfile())
    };
  }

  return {
    profile: buildPreachingProfileResponse(doc.data() || {})
  };
}

async function updatePreachingProfile(input = {}, deps = {}) {
  const preachingProfilesCollection = getPreachingProfileCollection(deps);
  const nowIso = getNowIso(deps);
  const profileId = normalizeString(input.profileId) || DEFAULT_PREACHING_PROFILE_ID;
  const docRef = preachingProfilesCollection.doc(validateDocId(profileId, "profileId"));
  const doc = await docRef.get();
  const existingProfile = doc.exists
    ? { ...buildDefaultPreachingProfile(nowIso), ...(doc.data() || {}), profileId }
    : buildDefaultPreachingProfile(nowIso);
  const changes = isPlainObject(input.changes) ? input.changes : input;
  const nextProfile = { ...existingProfile, profileId };

  for (const field of ["summary", "draftingGuidance"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextProfile[field] = normalizeString(changes[field]);
    }
  }

  for (const field of ["tone", "strengths", "recurringPatterns", "cautions"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      nextProfile[field] = normalizeStringArray(changes[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "observations")) {
    const incomingObservations = normalizeProfileObservations(changes.observations);
    nextProfile.observations =
      changes.replaceObservations === true
        ? incomingObservations
        : (Array.isArray(existingProfile.observations) ? existingProfile.observations : [])
          .concat(incomingObservations);
  }

  nextProfile.createdAt = normalizeString(nextProfile.createdAt) || nowIso;
  nextProfile.updatedAt = nowIso;

  await docRef.set(nextProfile);

  return {
    profile: buildPreachingProfileResponse(nextProfile)
  };
}

async function createPreachingAnalysis(input = {}, deps = {}) {
  const sermonsCollection = getSermonsCollection(deps);
  const preachingAnalysesCollection = getPreachingAnalysesCollection(deps);
  const nowIso = getNowIso(deps);
  const sermonId = validateDocId(input.sermonId, "sermonId");
  const sermonDoc = await sermonsCollection.doc(sermonId).get();

  if (!sermonDoc.exists) {
    throw createSermonWorkspaceError(
      "Sermon not found",
      404,
      { sermonId },
      "sermon_not_found"
    );
  }

  const profileCandidates = normalizeProfileObservations(input.profileCandidates);
  const analysisId = normalizeString(input.analysisId)
    ? validateDocId(input.analysisId, "analysisId")
    : createId("analysis", `${sermonId} ${normalizeString(input.sourceLabel) || "preaching"}`, deps);
  const analysis = {
    analysisId,
    sermonId,
    title: normalizeString(input.title),
    sourceLabel: normalizeString(input.sourceLabel),
    analyzedAt: nowIso,
    summary: normalizeString(input.summary),
    strengths: normalizeStringArray(input.strengths),
    improvements: normalizeStringArray(input.improvements),
    styleObservations: normalizeStringArray(input.styleObservations),
    structureNotes: normalizeStringArray(input.structureNotes),
    applicationNotes: normalizeStringArray(input.applicationNotes),
    deliveryNotes: normalizeStringArray(input.deliveryNotes),
    profileCandidates,
    sourceRefs: normalizeSourceRefs(input.sourceRefs),
    reflectionProposalId: normalizeString(input.reflectionProposalId),
    reflectionSourceFingerprint: normalizeString(input.reflectionSourceFingerprint),
    plannedVsPreached: isPlainObject(input.plannedVsPreached) ? clone(input.plannedVsPreached) : {},
    strongestLiveLanguage: Array.isArray(input.strongestLiveLanguage)
      ? input.strongestLiveLanguage.filter(isPlainObject).map(clone).slice(0, 20)
      : [],
    scriptureNoteCandidates: Array.isArray(input.scriptureNoteCandidates)
      ? input.scriptureNoteCandidates.filter(isPlainObject).map(clone).slice(0, 25)
      : [],
    recommendedNextActions: normalizeStringArray(input.recommendedNextActions).slice(0, 10),
    createdAt: nowIso,
    updatedAt: nowIso
  };

  await preachingAnalysesCollection.doc(analysisId).create(analysis);

  const response = {
    analysis: buildPreachingAnalysisResponse(analysis, analysisId),
    profileUpdated: false
  };

  if (input.applyProfileCandidates === true && profileCandidates.length > 0) {
    const profileResult = await updatePreachingProfile(
      { observations: profileCandidates },
      deps
    );
    response.profileUpdated = true;
    response.profile = profileResult.profile;
  }

  return response;
}

async function listPreachingAnalyses(input = {}, deps = {}) {
  const preachingAnalysesCollection = getPreachingAnalysesCollection(deps);
  const sermonId = normalizeString(input.sermonId);
  const limit = normalizeLimit(input.limit);
  const analyses = await loadCollection(preachingAnalysesCollection, Math.max(limit, DEFAULT_LIMIT));
  const filtered = analyses
    .map(({ id, data }) => buildPreachingAnalysisResponse(data, id))
    .filter((analysis) => !sermonId || analysis.sermonId === sermonId)
    .sort((left, right) => (right.analyzedAt || right.createdAt).localeCompare(left.analyzedAt || left.createdAt))
    .slice(0, limit);

  return {
    analyses: filtered,
    count: filtered.length
  };
}

async function buildSermonWorkspaceOverview(input = {}, deps = {}) {
  const folders = await listSermonFolders({ status: "active", limit: 100 }, deps);
  const sermons = await listSermons({ limit: 100, sort: "next_asc" }, deps);
  const openSermons = sermons.sermons.filter((sermon) => !["preached", "archived"].includes(sermon.status));
  const upcomingSermons = openSermons.filter((sermon) =>
    sermon.nextOccasion || isLegacyTargetDateUpcoming(sermon, getNowIso(deps)));
  const nextScheduledSermon = upcomingSermons[0] || null;
  const nextSermonReadiness = nextScheduledSermon
    ? await evaluateSermonReadiness({ sermonId: nextScheduledSermon.sermonId }, deps)
    : null;
  const sermonsByFolder = new Map();

  for (const sermon of openSermons) {
    const key = sermon.folderId || "";
    sermonsByFolder.set(key, (sermonsByFolder.get(key) || 0) + 1);
  }

  return {
    summary: {
      activeFolderCount: folders.count,
      openSermonCount: openSermons.length,
      ideaCount: openSermons.filter((sermon) => sermon.status === "idea").length,
      developingCount: openSermons.filter((sermon) => sermon.status === "developing").length,
      readyCount: openSermons.filter((sermon) => sermon.status === "ready").length
    },
    folders: folders.folders.map((folder) => ({
      ...folder,
      openSermonCount: sermonsByFolder.get(folder.folderId) || 0
    })),
    nextScheduledSermon,
    nextSermonReadiness,
    upcomingSermons: upcomingSermons.slice(0, 10),
    unfiledSermons: openSermons.filter((sermon) => !sermon.folderId).slice(0, 10)
  };
}

async function getSermonArchiveStats(input = {}, deps = {}) {
  const foldersCollection = getFoldersCollection(deps);
  const sermonsCollection = getSermonsCollection(deps);
  const sourcesCollection = getSermonSourcesCollection(deps);
  const chunksCollection = getSermonChunksCollection(deps);
  const query = normalizeString(input.query);
  const scriptureBook = normalizeString(input.scriptureBook);
  const sourceTypeFilter = input.sourceType ? normalizeSermonSourceType(input.sourceType, "") : "";
  const statusFilter = normalizeString(input.status);

  if (statusFilter && !SERMON_STATUSES.includes(statusFilter)) {
    throw createSermonWorkspaceError(
      "Invalid sermon status",
      400,
      { status: statusFilter, allowedValues: SERMON_STATUSES },
      "invalid_sermon_status"
    );
  }

  const [folderRecords, sermonRecords, sourceRecords, chunkRecords] = await Promise.all([
    loadLightCollection(foldersCollection, [
      "name",
      "folderType",
      "status",
      "description",
      "scriptureScope",
      "updatedAt"
    ], 2000),
    loadLightCollection(sermonsCollection, [
      "sermonId",
      "folderId",
      "title",
      "status",
      "scriptureText",
      "bigIdea",
      "occasion",
      "preachedDate",
      "targetDate",
      "searchText",
      "updatedAt"
    ], 10000),
    loadLightCollection(sourcesCollection, [
      "sourceId",
      "sermonId",
      "folderId",
      "sourceType",
      "sourceLabel",
      "summary",
      "searchText",
      "createdAt",
      "updatedAt"
    ], 20000),
    loadLightCollection(chunksCollection, [
      "chunkId",
      "sermonId",
      "folderId",
      "sourceId",
      "sourceKind",
      "chunkType",
      "title",
      "scriptureText",
      "textHash",
      "embeddingTextHash",
      "embeddingModel",
      "deleted",
      "updatedAt"
    ], 30000)
  ]);

  const folderById = new Map(folderRecords.map(({ id, data }) => [id, { ...data, folderId: id }]));
  const sermonById = new Map(sermonRecords.map(({ id, data }) => [id, { ...data, sermonId: data.sermonId || id }]));
  const sermonStatusById = new Map();
  const sermonsByStatus = new Map();
  const sermonsByFolder = new Map();
  const sourcesByType = new Map();
  const sourcesByFolder = new Map();
  const chunksByKind = new Map();
  const chunksByFolder = new Map();
  const uniqueSourceSermonIds = new Set();
  const uniqueLogosSermonIds = new Set();
  const deterministicLogosSourceIds = new Set();
  const querySermonIds = new Set();
  const querySourceSermonIds = new Set();
  const queryChunkSermonIds = new Set();
  const queryPreachedSermonIds = new Set();
  const querySamples = [];
  const scriptureBookSermonIds = new Set();
  const scriptureBookPreachedSermonIds = new Set();
  const scriptureBookSamples = [];

  for (const { id, data } of sermonRecords) {
    const sermon = { ...data, sermonId: data.sermonId || id };
    sermonStatusById.set(id, normalizeString(sermon.status || "idea"));
    incrementCount(sermonsByStatus, sermon.status || "idea");
    incrementCount(sermonsByFolder, sermon.folderId);

    const matchesQuery = Boolean(query) && recordMatchesStatsQuery(sermon, query);
    const matchesStatus = !statusFilter || normalizeString(sermon.status || "idea") === statusFilter;
    if (matchesQuery && matchesStatus) {
      querySermonIds.add(id);
      if (normalizeString(sermon.status || "idea") === "preached") {
        queryPreachedSermonIds.add(id);
      }
      if (querySamples.length < 10) {
        querySamples.push(buildStatsSample(sermon, id));
      }
    }

    if (scriptureTextMatchesBook(sermon.scriptureText, scriptureBook) && matchesStatus) {
      scriptureBookSermonIds.add(id);
      if (normalizeString(sermon.status || "idea") === "preached") {
        scriptureBookPreachedSermonIds.add(id);
      }
      if (scriptureBookSamples.length < 10) {
        scriptureBookSamples.push(buildStatsSample(sermon, id));
      }
    }
  }

  for (const { id, data } of sourceRecords) {
    const source = { ...data, sourceId: data.sourceId || id };
    const sourceType = normalizeString(source.sourceType || "other");
    if (sourceTypeFilter && sourceType !== sourceTypeFilter) {
      continue;
    }

    incrementCount(sourcesByType, sourceType);
    incrementCount(sourcesByFolder, source.folderId);
    if (source.sermonId) {
      uniqueSourceSermonIds.add(source.sermonId);
    }
    if (sourceType === "logos_export" && source.sermonId) {
      uniqueLogosSermonIds.add(source.sermonId);
    }
    if (sourceType === "logos_export" && id.startsWith("source-logos-")) {
      deterministicLogosSourceIds.add(id);
    }

    const sermonStatus = sermonStatusById.get(source.sermonId) || normalizeString(sermonById.get(source.sermonId)?.status || "");
    const matchesQuery = Boolean(query) && recordMatchesStatsQuery(source, query);
    const matchesStatus = !statusFilter || sermonStatus === statusFilter;
    if (matchesQuery && matchesStatus && source.sermonId) {
      querySourceSermonIds.add(source.sermonId);
      if (sermonStatus === "preached") {
        queryPreachedSermonIds.add(source.sermonId);
      }
      if (querySamples.length < 10) {
        querySamples.push(buildStatsSample(source, id));
      }
    }
  }

  let activeChunkCount = 0;
  let embeddedChunkCount = 0;
  let pendingChunkCount = 0;
  let logosChunkCount = 0;
  let logosEmbeddedChunkCount = 0;
  let logosPendingChunkCount = 0;

  for (const { id, data } of chunkRecords) {
    const chunk = { ...data, chunkId: data.chunkId || id };
    if (
      chunk.deleted ||
      !normalizeString(chunk.textHash || chunk.title || chunk.scriptureText || chunk.chunkType)
    ) {
      continue;
    }

    activeChunkCount += 1;
    const isLogosChunk = normalizeString(chunk.sourceId).startsWith("source-logos-");
    const isEmbedded = Boolean(
      normalizeString(chunk.embeddingTextHash) &&
      normalizeString(chunk.textHash) &&
      normalizeString(chunk.embeddingTextHash) === normalizeString(chunk.textHash) &&
      normalizeString(chunk.embeddingModel)
    );
    if (isEmbedded) embeddedChunkCount += 1;
    else pendingChunkCount += 1;
    if (isLogosChunk) {
      logosChunkCount += 1;
      if (isEmbedded) logosEmbeddedChunkCount += 1;
      else logosPendingChunkCount += 1;
    }

    incrementCount(chunksByKind, chunk.sourceKind || "other");
    incrementCount(chunksByFolder, chunk.folderId);

    const sermonStatus = sermonStatusById.get(chunk.sermonId) || normalizeString(sermonById.get(chunk.sermonId)?.status || "");
    const matchesQuery = Boolean(query) && recordMatchesStatsQuery(chunk, query);
    const matchesStatus = !statusFilter || sermonStatus === statusFilter;
    if (matchesQuery && matchesStatus && chunk.sermonId) {
      queryChunkSermonIds.add(chunk.sermonId);
      if (sermonStatus === "preached") {
        queryPreachedSermonIds.add(chunk.sermonId);
      }
      if (querySamples.length < 10) {
        querySamples.push(buildStatsSample(chunk, id));
      }
    }

    if (scriptureTextMatchesBook(chunk.scriptureText, scriptureBook) && matchesStatus && chunk.sermonId) {
      scriptureBookSermonIds.add(chunk.sermonId);
      if (sermonStatus === "preached") {
        scriptureBookPreachedSermonIds.add(chunk.sermonId);
      }
      if (scriptureBookSamples.length < 10) {
        scriptureBookSamples.push(buildStatsSample(chunk, id));
      }
    }
  }

  const folderStats = folderRecords
    .map(({ id, data }) => ({
      folderId: id,
      name: normalizeString(data.name),
      folderType: normalizeString(data.folderType),
      status: normalizeString(data.status),
      sermonCount: sermonsByFolder.get(id) || 0,
      sourceCount: sourcesByFolder.get(id) || 0,
      chunkCount: chunksByFolder.get(id) || 0
    }))
    .sort((left, right) => right.sermonCount - left.sermonCount || left.name.localeCompare(right.name));

  const matchingDistinctSermonIds = new Set([
    ...querySermonIds,
    ...querySourceSermonIds,
    ...queryChunkSermonIds
  ]);

  return {
    filters: {
      query,
      scriptureBook,
      status: statusFilter,
      sourceType: sourceTypeFilter
    },
    totals: {
      folders: folderRecords.length,
      sermons: sermonRecords.length,
      sources: sourceTypeFilter
        ? sourceRecords.filter(({ data }) => normalizeString(data.sourceType || "other") === sourceTypeFilter).length
        : sourceRecords.length,
      uniqueSourceSermons: uniqueSourceSermonIds.size,
      logosExportSources: sourceRecords.filter(({ id, data }) =>
        normalizeString(data.sourceType || "other") === "logos_export" &&
        (!sourceTypeFilter || sourceTypeFilter === "logos_export") &&
        id
      ).length,
      deterministicLogosSources: deterministicLogosSourceIds.size,
      uniqueLogosSermons: uniqueLogosSermonIds.size,
      activeChunks: activeChunkCount,
      embeddedChunks: embeddedChunkCount,
      pendingChunks: pendingChunkCount,
      logosChunks: logosChunkCount,
      logosEmbeddedChunks: logosEmbeddedChunkCount,
      logosPendingChunks: logosPendingChunkCount
    },
    sermons: {
      total: sermonRecords.length,
      byStatus: countMapToObject(sermonsByStatus),
      unfiledCount: sermonsByFolder.get("") || 0
    },
    sources: {
      total: sourceRecords.length,
      byType: countMapToObject(sourcesByType),
      uniqueSermonCount: uniqueSourceSermonIds.size
    },
    chunks: {
      active: activeChunkCount,
      embedded: embeddedChunkCount,
      pending: pendingChunkCount,
      bySourceKind: countMapToObject(chunksByKind)
    },
    folders: folderStats,
    queryStats: {
      query,
      matchingCanonicalSermonCount: querySermonIds.size,
      matchingSourceRecordSermonCount: querySourceSermonIds.size,
      matchingChunkSermonCount: queryChunkSermonIds.size,
      matchingDistinctSermonCount: matchingDistinctSermonIds.size,
      matchingPreachedDistinctSermonCount: queryPreachedSermonIds.size,
      samples: querySamples
    },
    scriptureStats: {
      scriptureBook,
      matchingDistinctSermonCount: scriptureBookSermonIds.size,
      matchingPreachedDistinctSermonCount: scriptureBookPreachedSermonIds.size,
      samples: scriptureBookSamples
    }
  };
}

module.exports = {
  FOLDER_STATUSES,
  FOLDER_TYPES,
  SERMON_STATUSES,
  SERMON_APPEND_TYPES,
  SERMON_SOURCE_TYPES,
  MAX_IMPORTED_TEXT_LENGTH,
  SERMON_MEDIA_TYPES,
  SERMON_MEDIA_TRANSCRIPT_STATUSES,
  SERMON_OCCASION_STATUSES,
  SERMON_DEVELOPMENT_SESSION_STATUSES,
  SERMON_DEVELOPMENT_SESSION_MODES,
  SERMON_DEVELOPMENT_TURN_SPEAKERS,
  SERMON_DEVELOPMENT_CHECKPOINT_TYPES,
  SERMON_MATERIAL_STATUSES,
  PRESENTATION_ASPECT_RATIOS,
  PRESENTATION_STATUSES,
  PRESENTATION_TEMPLATE_STATUSES,
  PRESENTATION_SLIDE_TYPES,
  addSermonDevelopmentNote,
  answerSermonQuestion,
  applySermonMaterialPlacementPlan,
  applySermonCanonicalRepair,
  appendSermonContent,
  auditSermonCompleteness,
  auditSermonDevelopmentPreservation,
  buildSermonMaterialFingerprint,
  buildPreachingPreparationDashboard,
  buildSermonWorkspaceOverview,
  captureSermonDevelopmentTurn,
  createSermonOccasion,
  createSermonPresentation,
  createSermonPresentationFromLookup,
  createSermonPresentationTemplate,
  createSermonSource,
  createSermonMedia,
  createSermonMediaTranscriptSource,
  createSermon,
  createSermonFolder,
  createPreachingAnalysis,
  embedSermonChunks,
  createSermonWorkspaceError,
  getSermonArchiveStats,
  getPreachingProfile,
  getSermon,
  getSermonContext,
  getSermonMedia,
  getSermonMaterialInventory,
  getSermonPresentation,
  getSermonPresentationTemplate,
  getSermonSnapshot,
  getSermonSource,
  importSermonMaterial,
  importSermonMaterialBatch,
  importSermonPresentationTemplate,
  evaluateSermonReadiness,
  closeSermonDevelopmentSession,
  finalizeSermonDevelopmentSession,
  listPreachingAnalyses,
  listSermonDevelopmentCheckpoints,
  listSermonDevelopmentSessions,
  listSermonDevelopmentTurns,
  listSermonFolders,
  listSermonMedia,
  linkSermonMediaToOccasion,
  listSermonOccasions,
  listSermonPresentations,
  listSermonPresentationTemplates,
  listSermonSnapshots,
  listSermonSources,
  listSermons,
  migrateLegacySermonOccasions,
  proposeSermonCanonicalRepair,
  proposeSermonMaterialPlacement,
  rebuildSermonChunks,
  resolveSermon,
  reviewSermonMinistryArchive,
  reviewSermonSeriesProgression,
  searchSermonChunks,
  semanticSearchSermonChunks,
  selectSermonForOccasion,
  saveSermonDevelopmentCheckpoint,
  startSermonDevelopmentSession,
  updatePreachingProfile,
  updateSermonPresentationTemplate,
  updateSermonMedia,
  updateSermonDevelopmentCheckpointPlacement,
  updateSermonOccasion,
  updateSermon,
  updateSermonFolder
};
