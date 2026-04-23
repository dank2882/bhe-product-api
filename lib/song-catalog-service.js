"use strict";

const {
  DEVELOPMENT_POTENTIAL_VALUES,
  FEELS_DATED_VALUES,
  LEADER_READINESS_VALUES,
  normalizeSongMinistryMetadata,
  normalizeSituationalUse,
  SITUATIONAL_USE_VALUES,
  STRENGTH_VALUES
} = require("./song-ministry-metadata");

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

  return normalized;
}

function buildSongSearchText(song = {}) {
  const aliases = Array.isArray(song.titleAliases) ? song.titleAliases : [];
  const topics = Array.isArray(song.topics) ? song.topics : [];

  return [
    song.songId || "",
    String(song.hymnalNumber || ""),
    song.canonicalTitle || "",
    aliases.join(" "),
    topics.join(" ")
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

  if (!cleanQuery && !hasFilters) {
    throw createSongCatalogError(
      "Missing query or filters",
      400,
      {},
      "missing_query_or_filters"
    );
  }

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const safeLimit = getSafeLimit(limit);
  const safeSort = getSafeSort(sort);
  const snapshot = await songsCollection.limit(500).get();

  const songs = snapshot.docs
    .map((doc) => {
      const song = doc.data() || {};
      const summary = buildSongSummary(song);
      const ministryMetadata = summary.ministryMetadata;
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
      const matchesFilters =
        matchesTheme &&
        matchesSourceStatus &&
        matchesHymnalNumber &&
        matchesLeaderReadiness &&
        matchesStrength &&
        matchesFeelsDated &&
        matchesSituationalUse &&
        matchesDevelopmentPotential;
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

module.exports = {
  buildSongDetail,
  buildSongSearchText,
  buildSongSummary,
  createSongCatalogError,
  getSongById,
  searchSongs
};
