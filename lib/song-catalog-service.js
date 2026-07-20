"use strict";

const { randomUUID } = require("node:crypto");

const {
  buildNormalizedLookupKeys,
  strictNormalizeTitle
} = require("./song-catalog-importer");
const {
  DEVELOPMENT_POTENTIAL_VALUES,
  EDITABLE_MINISTRY_METADATA_FIELDS,
  FEELS_DATED_VALUES,
  LEADER_READINESS_VALUES,
  normalizeSongMinistryMetadata,
  normalizeSituationalUse,
  SITUATIONAL_USE_VALUES,
  STRENGTH_VALUES
} = require("./song-ministry-metadata");
const {
  evaluateSongActiveCongregationalPool,
  normalizeSongMinistryPlanning,
  normalizePlanningContext,
  PLANNING_USAGE_ROLE_VALUES,
  SEASONAL_USE_VALUES,
  SONG_USE_STATUS_VALUES
} = require("./song-ministry-planning");

const EDITABLE_SONG_IDENTITY_FIELDS = [
  "canonicalTitle",
  "titleAliases"
];
const PROTECTED_SONG_IDENTITY_FIELDS = [
  "songId",
  "hymnalId",
  "hymnalNumber",
  "normalizedLookupKeys",
  "sourceEvidence",
  "sourceStatus",
  "reviewFlags"
];

function createSongCatalogError(message, statusCode = 400, details = {}, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  error.code = code || "song_catalog_error";
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createInvalidFilterValueError(field, value, allowedValues) {
  return createSongCatalogError(
    `Invalid filter value for ${field}`,
    400,
    {
      field,
      value,
      allowedValues
    },
    "invalid_filter_value"
  );
}

function normalizeEnumFilter(value, field, allowedValues) {
  const cleanValue = normalizeString(value).toLowerCase();

  if (!cleanValue) {
    return undefined;
  }

  if (!allowedValues.includes(cleanValue)) {
    throw createInvalidFilterValueError(field, value, allowedValues);
  }

  return cleanValue;
}

function normalizeMinistryMetadataFieldValue(field, value) {
  if (field === "leaderReadiness") {
    return normalizeEnumFilter(value, field, LEADER_READINESS_VALUES);
  }

  if (field === "strength") {
    return normalizeEnumFilter(value, field, STRENGTH_VALUES);
  }

  if (field === "feelsDated") {
    return normalizeEnumFilter(value, field, FEELS_DATED_VALUES);
  }

  if (field === "situationalUse") {
    return normalizeSituationalUseFilter(value);
  }

  if (field === "developmentPotential") {
    return normalizeEnumFilter(value, field, DEVELOPMENT_POTENTIAL_VALUES);
  }

  throw createSongCatalogError(
    "Unsupported ministry metadata field",
    400,
    {
      field,
      allowedFields: EDITABLE_MINISTRY_METADATA_FIELDS
    },
    "unsupported_metadata_field"
  );
}

function normalizeTokenFilter(value, field, allowedValues) {
  const normalized = normalizePlanningContext({ [field]: value })[field];

  if (!normalized) {
    return undefined;
  }

  if (!allowedValues.includes(normalized)) {
    throw createInvalidFilterValueError(field, value, allowedValues);
  }

  return normalized;
}

function normalizeOpenTokenFilter(value) {
  const normalized = normalizePlanningContext({ usageRole: value }).usageRole;
  return normalized || undefined;
}

function normalizeSituationalUseFilter(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  const normalizedValues = [];

  for (const item of values) {
    const cleanValue = normalizeString(item).toLowerCase();

    if (!cleanValue) {
      continue;
    }

    if (!SITUATIONAL_USE_VALUES.includes(cleanValue)) {
      throw createInvalidFilterValueError(
        "situationalUse",
        item,
        SITUATIONAL_USE_VALUES
      );
    }

    if (!normalizedValues.includes(cleanValue)) {
      normalizedValues.push(cleanValue);
    }
  }

  return normalizedValues.length > 0
    ? normalizedSituationalUse(normalizedValues)
    : undefined;
}

function normalizedSituationalUse(values) {
  return normalizeSituationalUse(values);
}

function normalizeFilters(filters = {}) {
  if (filters === null || filters === undefined) {
    return {};
  }

  if (typeof filters !== "object" || Array.isArray(filters)) {
    throw createSongCatalogError("Invalid filters", 400, {}, "invalid_filters");
  }

  const theme = normalizeString(filters.theme);
  const sourceStatus = normalizeString(filters.sourceStatus);
  const hymnalNumber = normalizeOptionalInteger(filters.hymnalNumber);
  const leaderReadiness = normalizeEnumFilter(
    filters.leaderReadiness,
    "leaderReadiness",
    LEADER_READINESS_VALUES
  );
  const strength = normalizeEnumFilter(
    filters.strength,
    "strength",
    STRENGTH_VALUES
  );
  const feelsDated = normalizeEnumFilter(
    filters.feelsDated,
    "feelsDated",
    FEELS_DATED_VALUES
  );
  const situationalUse = normalizeSituationalUseFilter(filters.situationalUse);
  const developmentPotential = normalizeEnumFilter(
    filters.developmentPotential,
    "developmentPotential",
    DEVELOPMENT_POTENTIAL_VALUES
  );
  const useStatus = normalizeEnumFilter(
    filters.useStatus,
    "useStatus",
    SONG_USE_STATUS_VALUES
  );
  const allowedUsageRole = normalizeTokenFilter(
    filters.allowedUsageRole || filters.usageRole,
    "usageRole",
    PLANNING_USAGE_ROLE_VALUES
  );
  const blockedUsageRole = normalizeTokenFilter(
    filters.blockedUsageRole,
    "usageRole",
    PLANNING_USAGE_ROLE_VALUES
  );
  const seasonalUse = normalizeTokenFilter(
    filters.seasonalUse || filters.season,
    "season",
    SEASONAL_USE_VALUES
  );
  const worshipFunction = normalizeOpenTokenFilter(filters.worshipFunction);
  const normalized = {};

  if (theme) {
    normalized.theme = theme;
  }

  if (sourceStatus) {
    normalized.sourceStatus = sourceStatus;
  }

  if (hymnalNumber !== null) {
    normalized.hymnalNumber = hymnalNumber;
  }

  if (leaderReadiness) {
    normalized.leaderReadiness = leaderReadiness;
  }

  if (strength) {
    normalized.strength = strength;
  }

  if (feelsDated) {
    normalized.feelsDated = feelsDated;
  }

  if (situationalUse) {
    normalized.situationalUse = situationalUse;
  }

  if (developmentPotential) {
    normalized.developmentPotential = developmentPotential;
  }

  if (useStatus) {
    normalized.useStatus = useStatus;
  }

  if (allowedUsageRole) {
    normalized.allowedUsageRole = allowedUsageRole;
  }

  if (blockedUsageRole) {
    normalized.blockedUsageRole = blockedUsageRole;
  }

  if (seasonalUse) {
    normalized.seasonalUse = seasonalUse;
  }

  if (worshipFunction) {
    normalized.worshipFunction = worshipFunction;
  }

  return normalized;
}

function normalizeMetadataChanges(changes) {
  if (!isPlainObject(changes)) {
    throw createSongCatalogError(
      "Invalid changes object",
      400,
      {},
      "invalid_changes"
    );
  }

  const entries = Object.entries(changes);

  if (entries.length === 0) {
    throw createSongCatalogError(
      "Changes must not be empty",
      400,
      {},
      "empty_changes"
    );
  }

  const unsupportedFields = entries
    .map(([field]) => field)
    .filter((field) => !EDITABLE_MINISTRY_METADATA_FIELDS.includes(field));

  if (unsupportedFields.length > 0) {
    throw createSongCatalogError(
      "Unsupported ministry metadata fields",
      400,
      {
        unsupportedFields,
        allowedFields: EDITABLE_MINISTRY_METADATA_FIELDS
      },
      "unsupported_metadata_fields"
    );
  }

  const normalized = {};

  for (const [field, value] of entries) {
    const normalizedValue = normalizeMinistryMetadataFieldValue(field, value);

    if (normalizedValue === undefined) {
      throw createSongCatalogError(
        `Invalid or empty value for ${field}`,
        400,
        {
          field
        },
        "invalid_metadata_value"
      );
    }

    normalized[field] = normalizedValue;
  }

  return normalized;
}

function normalizeChangeReason(changeReason) {
  const cleanChangeReason = normalizeString(changeReason);

  if (!cleanChangeReason) {
    throw createSongCatalogError(
      "Missing changeReason",
      400,
      {},
      "missing_change_reason"
    );
  }

  return cleanChangeReason;
}

function normalizeIdentityText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeTitleAliases(value, canonicalTitle) {
  if (!Array.isArray(value)) {
    throw createSongCatalogError(
      "Invalid titleAliases",
      400,
      {
        field: "titleAliases"
      },
      "invalid_identity_value"
    );
  }

  const normalizedAliases = [];
  const seenTitles = new Set();
  const normalizedCanonicalTitle = strictNormalizeTitle(canonicalTitle);

  for (const alias of value) {
    const cleanAlias = normalizeIdentityText(alias);

    if (!cleanAlias) {
      throw createSongCatalogError(
        "Invalid titleAliases",
        400,
        {
          field: "titleAliases"
        },
        "invalid_identity_value"
      );
    }

    const normalizedAlias = strictNormalizeTitle(cleanAlias);

    if (normalizedAlias === normalizedCanonicalTitle || seenTitles.has(normalizedAlias)) {
      continue;
    }

    seenTitles.add(normalizedAlias);
    normalizedAliases.push(cleanAlias);
  }

  return normalizedAliases.sort((left, right) => left.localeCompare(right));
}

function normalizeIdentityChanges(changes, existingSong = {}) {
  if (!isPlainObject(changes)) {
    throw createSongCatalogError(
      "Invalid changes object",
      400,
      {},
      "invalid_changes"
    );
  }

  const entries = Object.entries(changes);

  if (entries.length === 0) {
    throw createSongCatalogError(
      "Changes must not be empty",
      400,
      {},
      "empty_changes"
    );
  }

  const protectedFields = entries
    .map(([field]) => field)
    .filter((field) => PROTECTED_SONG_IDENTITY_FIELDS.includes(field));

  if (protectedFields.length > 0) {
    throw createSongCatalogError(
      "Protected song identity fields cannot be edited",
      400,
      {
        protectedFields,
        allowedFields: EDITABLE_SONG_IDENTITY_FIELDS
      },
      "protected_identity_fields"
    );
  }

  const unsupportedFields = entries
    .map(([field]) => field)
    .filter((field) => !EDITABLE_SONG_IDENTITY_FIELDS.includes(field));

  if (unsupportedFields.length > 0) {
    throw createSongCatalogError(
      "Unsupported song identity fields",
      400,
      {
        unsupportedFields,
        allowedFields: EDITABLE_SONG_IDENTITY_FIELDS
      },
      "unsupported_identity_fields"
    );
  }

  const normalized = {};
  const nextCanonicalTitle = Object.hasOwn(changes, "canonicalTitle")
    ? normalizeIdentityText(changes.canonicalTitle)
    : normalizeIdentityText(existingSong.canonicalTitle);

  if (Object.hasOwn(changes, "canonicalTitle")) {
    if (!nextCanonicalTitle) {
      throw createSongCatalogError(
        "Invalid canonicalTitle",
        400,
        {
          field: "canonicalTitle"
        },
        "invalid_identity_value"
      );
    }

    normalized.canonicalTitle = nextCanonicalTitle;
  }

  if (Object.hasOwn(changes, "titleAliases")) {
    normalized.titleAliases = normalizeTitleAliases(
      changes.titleAliases,
      nextCanonicalTitle
    );
  }

  if (Object.keys(normalized).length === 0) {
    throw createSongCatalogError(
      "Changes must include at least one editable identity field",
      400,
      {
        allowedFields: EDITABLE_SONG_IDENTITY_FIELDS
      },
      "empty_identity_changes"
    );
  }

  return normalized;
}

function buildSongIdentityResponse(song = {}) {
  return {
    songId: song.songId || "",
    hymnalId: song.hymnalId || "",
    hymnalNumber: typeof song.hymnalNumber === "number" ? song.hymnalNumber : 0,
    canonicalTitle: song.canonicalTitle || "",
    titleAliases: Array.isArray(song.titleAliases) ? song.titleAliases : [],
    normalizedLookupKeys: Array.isArray(song.normalizedLookupKeys) ? song.normalizedLookupKeys : [],
    updatedAt: song.updatedAt || ""
  };
}

function buildSongSearchText(song = {}) {
  const aliases = Array.isArray(song.titleAliases) ? song.titleAliases : [];
  const topics = Array.isArray(song.topics) ? song.topics : [];

  return [
    song.songId || "",
    String(song.hymnalNumber || ""),
    song.canonicalTitle || "",
    aliases.join(" "),
    topics.join(" "),
    Object.values(normalizeSongMinistryPlanning(song.ministryPlanning))
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .filter((value) => typeof value === "string")
      .join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

function buildSongSummary(song = {}) {
  return {
    songId: song.songId || "",
    hymnalNumber: typeof song.hymnalNumber === "number" ? song.hymnalNumber : 0,
    canonicalTitle: song.canonicalTitle || "",
    topics: Array.isArray(song.topics) ? song.topics : [],
    ministryMetadata: normalizeSongMinistryMetadata(song.ministryMetadata),
    ministryPlanning: normalizeSongMinistryPlanning(song.ministryPlanning),
    sourceStatus: song.sourceStatus || "",
    reviewFlags: Array.isArray(song.reviewFlags) ? song.reviewFlags : []
  };
}

function buildSongDetail(song = {}) {
  return {
    songId: song.songId || "",
    hymnalId: song.hymnalId || "",
    hymnalNumber: typeof song.hymnalNumber === "number" ? song.hymnalNumber : 0,
    canonicalTitle: song.canonicalTitle || "",
    topics: Array.isArray(song.topics) ? song.topics : [],
    titleAliases: Array.isArray(song.titleAliases) ? song.titleAliases : [],
    normalizedLookupKeys: Array.isArray(song.normalizedLookupKeys) ? song.normalizedLookupKeys : [],
    ministryMetadata: normalizeSongMinistryMetadata(song.ministryMetadata),
    ministryPlanning: normalizeSongMinistryPlanning(song.ministryPlanning),
    sourceStatus: song.sourceStatus || "",
    sourceEvidence: song.sourceEvidence && typeof song.sourceEvidence === "object"
      ? song.sourceEvidence
      : {},
    reviewFlags: Array.isArray(song.reviewFlags) ? song.reviewFlags : [],
    createdAt: song.createdAt || "",
    updatedAt: song.updatedAt || ""
  };
}

function getSafeLimit(limit) {
  const parsed = Number.parseInt(String(limit ?? "10"), 10);
  if (!Number.isInteger(parsed)) {
    return 10;
  }

  return Math.min(Math.max(parsed, 1), 25);
}

function getSafeSort(sort) {
  const cleanSort = normalizeString(sort);
  const allowedSorts = new Set(["relevance", "title_asc", "hymnal_number_asc"]);
  return allowedSorts.has(cleanSort) ? cleanSort : "relevance";
}

function getSafeActivePoolLimit(limit) {
  const parsed = Number.parseInt(String(limit ?? "25"), 10);
  if (!Number.isInteger(parsed)) {
    return 25;
  }

  return Math.min(Math.max(parsed, 1), 250);
}

async function getSongById(
  { songId },
  {
    songsCollection
  }
) {
  const cleanSongId = normalizeString(songId);

  if (!cleanSongId) {
    throw createSongCatalogError(
      "Missing or invalid songId",
      400,
      {},
      "missing_or_invalid_song_id"
    );
  }

  const doc = await songsCollection.doc(cleanSongId).get();

  if (!doc.exists) {
    throw createSongCatalogError(
      "Song not found",
      404,
      { songId: cleanSongId },
      "song_not_found"
    );
  }

  return {
    song: buildSongDetail(doc.data() || {})
  };
}

async function deleteSong(
  { songId },
  {
    songsCollection
  }
) {
  const cleanSongId = normalizeString(songId);

  if (!cleanSongId) {
    throw createSongCatalogError(
      "Missing or invalid songId",
      400,
      {},
      "missing_or_invalid_song_id"
    );
  }

  if (!songsCollection || typeof songsCollection.doc !== "function") {
    throw createSongCatalogError(
      "songsCollection with doc() is required",
      500,
      {},
      "missing_songs_collection"
    );
  }

  const docRef = songsCollection.doc(cleanSongId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSongCatalogError(
      "Song not found",
      404,
      { songId: cleanSongId },
      "song_not_found"
    );
  }

  const song = buildSongDetail(doc.data() || {});

  if (typeof docRef.delete !== "function") {
    throw createSongCatalogError(
      "songsCollection doc reference with delete() is required",
      500,
      {},
      "missing_song_delete_method"
    );
  }

  await docRef.delete();

  return {
    deleted: true,
    songId: song.songId,
    hymnalNumber: song.hymnalNumber,
    canonicalTitle: song.canonicalTitle
  };
}

async function searchSongs(
  {
    query,
    filters,
    limit = 10,
    sort = "relevance"
  },
  {
    songsCollection
  }
) {
  const cleanQuery = normalizeString(query).toLowerCase();
  const normalizedFilters = normalizeFilters(filters);
  const hasFilters = Object.keys(normalizedFilters).length > 0;

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const safeLimit = getSafeLimit(limit);
  const safeSort = getSafeSort(sort);
  const snapshot = await songsCollection.limit(500).get();

  const songs = snapshot.docs
    .map((doc) => {
      const song = doc.data() || {};
      const summary = buildSongSummary(song);
      const ministryMetadata = summary.ministryMetadata;
      const ministryPlanning = summary.ministryPlanning;
      const searchText = buildSongSearchText(song);
      const matchedTokenCount = tokens.length === 0
        ? 0
        : tokens.filter((token) => searchText.includes(token)).length;
      const matchesTheme = !normalizedFilters.theme || summary.topics.some(
        (topic) => topic.toLowerCase().includes(normalizedFilters.theme.toLowerCase())
      );
      const matchesSourceStatus =
        !normalizedFilters.sourceStatus || summary.sourceStatus === normalizedFilters.sourceStatus;
      const matchesHymnalNumber =
        normalizedFilters.hymnalNumber === undefined ||
        summary.hymnalNumber === normalizedFilters.hymnalNumber;
      const matchesLeaderReadiness =
        normalizedFilters.leaderReadiness === undefined ||
        ministryMetadata.leaderReadiness === normalizedFilters.leaderReadiness;
      const matchesStrength =
        normalizedFilters.strength === undefined ||
        ministryMetadata.strength === normalizedFilters.strength;
      const matchesFeelsDated =
        normalizedFilters.feelsDated === undefined ||
        ministryMetadata.feelsDated === normalizedFilters.feelsDated;
      const matchesSituationalUse =
        normalizedFilters.situationalUse === undefined ||
        normalizedFilters.situationalUse.every((value) => ministryMetadata.situationalUse.includes(value));
      const matchesDevelopmentPotential =
        normalizedFilters.developmentPotential === undefined ||
        ministryMetadata.developmentPotential === normalizedFilters.developmentPotential;
      const matchesUseStatus =
        normalizedFilters.useStatus === undefined ||
        ministryPlanning.useStatus === normalizedFilters.useStatus;
      const matchesAllowedUsageRole =
        normalizedFilters.allowedUsageRole === undefined ||
        ministryPlanning.allowedUsageRoles.includes(normalizedFilters.allowedUsageRole);
      const matchesBlockedUsageRole =
        normalizedFilters.blockedUsageRole === undefined ||
        ministryPlanning.blockedUsageRoles.includes(normalizedFilters.blockedUsageRole);
      const matchesSeasonalUse =
        normalizedFilters.seasonalUse === undefined ||
        ministryPlanning.seasonalUse.includes(normalizedFilters.seasonalUse);
      const matchesWorshipFunction =
        normalizedFilters.worshipFunction === undefined ||
        ministryPlanning.worshipFunctions.includes(normalizedFilters.worshipFunction);
      const matchesFilters =
        matchesTheme &&
        matchesSourceStatus &&
        matchesHymnalNumber &&
        matchesLeaderReadiness &&
        matchesStrength &&
        matchesFeelsDated &&
        matchesSituationalUse &&
        matchesDevelopmentPotential &&
        matchesUseStatus &&
        matchesAllowedUsageRole &&
        matchesBlockedUsageRole &&
        matchesSeasonalUse &&
        matchesWorshipFunction;
      const passesQuery = tokens.length === 0 || matchedTokenCount > 0;

      return {
        ...summary,
        _matchedTokenCount: matchedTokenCount,
        _matchesFilters: matchesFilters,
        _passesQuery: passesQuery
      };
    })
    .filter((song) => song._matchesFilters && song._passesQuery)
    .sort((left, right) => {
      if (safeSort === "title_asc") {
        return left.canonicalTitle.localeCompare(right.canonicalTitle);
      }

      if (safeSort === "hymnal_number_asc") {
        return left.hymnalNumber - right.hymnalNumber;
      }

      if (right._matchedTokenCount !== left._matchedTokenCount) {
        return right._matchedTokenCount - left._matchedTokenCount;
      }

      return left.hymnalNumber - right.hymnalNumber;
    })
    .slice(0, safeLimit)
    .map(({ _matchedTokenCount, _matchesFilters, _passesQuery, ...song }) => song);

  const warnings = [];

  if (songs.some((song) => song.sourceStatus === "needs_review")) {
    warnings.push("Some returned songs still need manual catalog review.");
  }

  return {
    query: cleanQuery,
    count: songs.length,
    songs,
    appliedFilters: normalizedFilters,
    warnings
  };
}

async function buildActiveCongregationalPool(
  {
    limit = 25,
    leaderId = "dan",
    usageRole = "congregational",
    includeExcluded = false
  } = {},
  {
    songsCollection
  }
) {
  const safeLimit = getSafeActivePoolLimit(limit);
  const snapshot = await songsCollection.limit(1000).get();
  const activeSongs = [];
  const excludedSongs = [];
  let excludedCount = 0;
  const exclusionCounts = {};
  const warningCounts = {};

  for (const doc of snapshot.docs) {
    const song = doc.data() || {};

    if (!normalizeString(song.songId).startsWith("rejoice-")) {
      continue;
    }

    const result = evaluateSongActiveCongregationalPool(song, {
      leaderId,
      usageRole
    });
    const summary = buildSongSummary(song);
    const activePoolSong = {
      ...summary,
      activePool: {
        active: result.active,
        blockedReasons: result.blockedReasons,
        warnings: result.warnings
      }
    };

    for (const reason of result.blockedReasons) {
      exclusionCounts[reason] = (exclusionCounts[reason] || 0) + 1;
    }

    for (const warning of result.warnings) {
      warningCounts[warning] = (warningCounts[warning] || 0) + 1;
    }

    if (result.active) {
      activeSongs.push(activePoolSong);
    } else {
      excludedCount += 1;
      if (includeExcluded) {
        excludedSongs.push(activePoolSong);
      }
    }
  }

  activeSongs.sort((left, right) => left.hymnalNumber - right.hymnalNumber);
  excludedSongs.sort((left, right) => left.hymnalNumber - right.hymnalNumber);

  return {
    rule: {
      hymnal: "rejoice",
      leaderId: normalizePlanningContext({ leaderId }).leaderId || "dan",
      usageRole: normalizePlanningContext({ usageRole }).usageRole || "congregational",
      excludeOccasionOnly: true,
      rareRotationIsWarningOnly: true
    },
    count: activeSongs.length,
    songs: activeSongs.slice(0, safeLimit),
    excludedCount,
    excludedSongs: includeExcluded ? excludedSongs.slice(0, safeLimit) : [],
    exclusionCounts: Object.fromEntries(
      Object.entries(exclusionCounts).sort(([left], [right]) => left.localeCompare(right))
    ),
    warningCounts: Object.fromEntries(
      Object.entries(warningCounts).sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

async function updateSongMinistryMetadata(
  {
    songId,
    changes,
    changeReason,
    changedBy = "custom-gpt"
  },
  {
    songsCollection,
    songMetadataAuditCollection,
    now = () => new Date().toISOString(),
    createAuditId = () => randomUUID()
  }
) {
  const cleanSongId = normalizeString(songId);

  if (!cleanSongId) {
    throw createSongCatalogError(
      "Missing or invalid songId",
      400,
      {},
      "missing_or_invalid_song_id"
    );
  }

  if (!songsCollection || typeof songsCollection.doc !== "function") {
    throw createSongCatalogError(
      "songsCollection with doc() is required",
      500,
      {},
      "missing_songs_collection"
    );
  }

  if (!songMetadataAuditCollection || typeof songMetadataAuditCollection.doc !== "function") {
    throw createSongCatalogError(
      "songMetadataAuditCollection with doc() is required",
      500,
      {},
      "missing_song_metadata_audit_collection"
    );
  }

  const normalizedChanges = normalizeMetadataChanges(changes);
  const normalizedChangeReason = normalizeChangeReason(changeReason);
  const cleanChangedBy = normalizeString(changedBy) || "custom-gpt";
  const docRef = songsCollection.doc(cleanSongId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSongCatalogError(
      "Song not found",
      404,
      { songId: cleanSongId },
      "song_not_found"
    );
  }

  const existingSong = doc.data() || {};
  const previousMetadata = normalizeSongMinistryMetadata(existingSong.ministryMetadata);
  const nextMetadata = {
    ...previousMetadata,
    ...normalizedChanges
  };
  const changesApplied = Object.keys(normalizedChanges).filter((field) => {
    return JSON.stringify(previousMetadata[field]) !== JSON.stringify(nextMetadata[field]);
  });

  if (changesApplied.length === 0) {
    throw createSongCatalogError(
      "No metadata changes were applied",
      400,
      {},
      "no_metadata_changes_applied"
    );
  }

  const changedAt = now();
  const previousValues = {};
  const newValues = {};

  for (const field of changesApplied) {
    previousValues[field] = previousMetadata[field];
    newValues[field] = nextMetadata[field];
  }

  const auditEntry = {
    auditId: createAuditId(),
    songId: cleanSongId,
    changedAt,
    changedBy: cleanChangedBy,
    changeReason: normalizedChangeReason,
    previousValues,
    newValues,
    changesApplied
  };

  await docRef.set({
    ...existingSong,
    ministryMetadata: nextMetadata,
    updatedAt: changedAt
  });

  await songMetadataAuditCollection.doc(auditEntry.auditId).set(auditEntry);

  return {
    songId: cleanSongId,
    ministryMetadata: nextMetadata,
    auditEntry,
    updatedAt: changedAt
  };
}

async function updateSongIdentity(
  {
    songId,
    changes,
    changeReason,
    changedBy = "custom-gpt"
  },
  {
    songsCollection,
    songMetadataAuditCollection,
    now = () => new Date().toISOString(),
    createAuditId = () => randomUUID()
  }
) {
  const cleanSongId = normalizeString(songId);

  if (!cleanSongId) {
    throw createSongCatalogError(
      "Missing or invalid songId",
      400,
      {},
      "missing_or_invalid_song_id"
    );
  }

  if (!songsCollection || typeof songsCollection.doc !== "function") {
    throw createSongCatalogError(
      "songsCollection with doc() is required",
      500,
      {},
      "missing_songs_collection"
    );
  }

  const docRef = songsCollection.doc(cleanSongId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createSongCatalogError(
      "Song not found",
      404,
      { songId: cleanSongId },
      "song_not_found"
    );
  }

  const existingSong = doc.data() || {};
  const normalizedChanges = normalizeIdentityChanges(changes, existingSong);
  const previousIdentity = buildSongIdentityResponse(existingSong);
  const nextCanonicalTitle = normalizedChanges.canonicalTitle || previousIdentity.canonicalTitle;
  const nextTitleAliases = Object.hasOwn(normalizedChanges, "titleAliases")
    ? normalizedChanges.titleAliases
    : previousIdentity.titleAliases;
  const normalizedLookupKeys = Number.isInteger(existingSong.hymnalNumber)
    ? buildNormalizedLookupKeys({
        hymnalNumber: existingSong.hymnalNumber,
        canonicalTitle: nextCanonicalTitle,
        titleAliases: nextTitleAliases
      })
    : previousIdentity.normalizedLookupKeys;
  const changedAt = now();
  const updatedSong = {
    ...existingSong,
    canonicalTitle: nextCanonicalTitle,
    titleAliases: nextTitleAliases,
    normalizedLookupKeys,
    updatedAt: changedAt
  };
  const nextIdentity = buildSongIdentityResponse(updatedSong);
  const changesApplied = EDITABLE_SONG_IDENTITY_FIELDS.filter((field) => {
    return JSON.stringify(previousIdentity[field]) !== JSON.stringify(nextIdentity[field]);
  });

  if (JSON.stringify(previousIdentity.normalizedLookupKeys) !== JSON.stringify(nextIdentity.normalizedLookupKeys)) {
    changesApplied.push("normalizedLookupKeys");
  }

  if (changesApplied.length === 0) {
    throw createSongCatalogError(
      "No identity changes were applied",
      400,
      {},
      "no_identity_changes_applied"
    );
  }

  const previousValues = {};
  const newValues = {};

  for (const field of changesApplied) {
    previousValues[field] = previousIdentity[field];
    newValues[field] = nextIdentity[field];
  }

  const auditEntry = {
    auditId: createAuditId(),
    auditType: "song_identity",
    songId: cleanSongId,
    changedAt,
    changedBy: normalizeString(changedBy) || "custom-gpt",
    changeReason: normalizeString(changeReason) || "Controlled song identity update.",
    previousValues,
    newValues,
    changesApplied
  };

  await docRef.set(updatedSong);

  if (songMetadataAuditCollection && typeof songMetadataAuditCollection.doc === "function") {
    await songMetadataAuditCollection.doc(auditEntry.auditId).set(auditEntry);
  }

  return {
    songId: cleanSongId,
    canonicalTitle: nextIdentity.canonicalTitle,
    titleAliases: nextIdentity.titleAliases,
    normalizedLookupKeys: nextIdentity.normalizedLookupKeys,
    auditEntry,
    updatedAt: changedAt
  };
}

module.exports = {
  buildSongDetail,
  buildSongIdentityResponse,
  buildSongSearchText,
  buildSongSummary,
  createSongCatalogError,
  deleteSong,
  buildActiveCongregationalPool,
  getSongById,
  searchSongs,
  updateSongIdentity,
  updateSongMinistryMetadata
};
