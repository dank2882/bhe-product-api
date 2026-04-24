"use strict";

function createServiceHistoryError(message, statusCode = 400, details = {}, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  error.code = code || "service_history_error";
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toDateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string") {
    return "";
  }

  const cleanValue = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    const parsed = new Date(`${cleanValue}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? "" : cleanValue;
  }

  const parsed = new Date(cleanValue);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function normalizeOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const normalizedDate = toDateOnly(value);

  if (!normalizedDate) {
    throw createServiceHistoryError(
      `Invalid ${fieldName}`,
      400,
      { field: fieldName, value },
      "invalid_date_filter"
    );
  }

  return normalizedDate;
}

function canonicalizeServiceType(value) {
  const cleanValue = normalizeString(value).toLowerCase();

  if (!cleanValue) {
    return "";
  }

  if (["sunday_morning", "sunday-morning"].includes(cleanValue) || cleanValue.includes("sunday morning")) {
    return "sunday_morning";
  }

  if (
    ["sunday_night", "sunday-evening", "sunday_evening", "sunday-night"].includes(cleanValue) ||
    cleanValue.includes("sunday night") ||
    cleanValue.includes("sunday evening")
  ) {
    return "sunday_night";
  }

  if (
    ["wednesday_night", "wednesday-evening", "wednesday_evening", "wednesday-night"].includes(cleanValue) ||
    cleanValue.includes("wednesday night") ||
    cleanValue.includes("wednesday evening")
  ) {
    return "wednesday_night";
  }

  return cleanValue.replace(/\s+/g, "_");
}

function normalizeServiceLabels(value) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = new Set();

  for (const item of values) {
    const cleanValue = normalizeString(item).toLowerCase();
    if (!cleanValue) {
      continue;
    }

    if (cleanValue.includes("lord's supper") || cleanValue.includes("lords supper") || cleanValue === "communion") {
      normalized.add("lords_supper");
      continue;
    }

    if (cleanValue.includes("easter")) {
      normalized.add("easter");
      continue;
    }

    normalized.add(cleanValue.replace(/\s+/g, "_"));
  }

  return Array.from(normalized).sort();
}

function normalizeServiceFilters(filters = {}) {
  if (filters === null || filters === undefined) {
    return {};
  }

  if (!isPlainObject(filters)) {
    throw createServiceHistoryError("Invalid filters", 400, {}, "invalid_filters");
  }

  const normalized = {};
  const serviceType = canonicalizeServiceType(filters.serviceType);
  const serviceDate = normalizeOptionalDate(filters.serviceDate, "serviceDate");
  const dateFrom = normalizeOptionalDate(filters.dateFrom, "dateFrom");
  const dateTo = normalizeOptionalDate(filters.dateTo, "dateTo");
  const labels = normalizeServiceLabels(filters.labels || filters.label);

  if (serviceType) {
    normalized.serviceType = serviceType;
  }

  if (serviceDate) {
    normalized.serviceDate = serviceDate;
  }

  if (dateFrom) {
    normalized.dateFrom = dateFrom;
  }

  if (dateTo) {
    normalized.dateTo = dateTo;
  }

  if (labels.length > 0) {
    normalized.labels = labels;
  }

  return normalized;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function previousSunday(date) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay();
  const daysBack = day === 0 ? 7 : day;
  result.setUTCDate(result.getUTCDate() - daysBack);
  return result;
}

const QUERY_STOP_WORDS = new Set([
  "what",
  "songs",
  "were",
  "used",
  "show",
  "me",
  "the",
  "from",
  "in",
  "this",
  "that",
  "history",
  "service",
  "services",
  "last",
  "next",
  "based",
  "on",
  "we",
  "our"
]);

function parseQueryIntent(query, nowDate = new Date()) {
  const cleanQuery = normalizeString(query).toLowerCase();
  const derivedFilters = {};
  let expectsSingleResult = false;

  if (!cleanQuery) {
    return {
      cleanQuery,
      derivedFilters,
      residualTokens: [],
      expectsSingleResult
    };
  }

  const explicitDate = cleanQuery.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (explicitDate) {
    derivedFilters.serviceDate = explicitDate[0];
    expectsSingleResult = true;
  }

  const yearMatch = cleanQuery.match(/\b(20\d{2})\b/);
  if (yearMatch && !derivedFilters.serviceDate) {
    derivedFilters.dateFrom = `${yearMatch[1]}-01-01`;
    derivedFilters.dateTo = `${yearMatch[1]}-12-31`;
  }

  if (cleanQuery.includes("last sunday")) {
    derivedFilters.serviceDate = toDateOnly(previousSunday(nowDate));
    expectsSingleResult = true;
  }

  if (cleanQuery.includes("this month")) {
    derivedFilters.dateFrom = toDateOnly(startOfMonth(nowDate));
    derivedFilters.dateTo = toDateOnly(endOfMonth(nowDate));
  }

  const serviceType = canonicalizeServiceType(cleanQuery);
  if (serviceType && ["sunday_morning", "sunday_night", "wednesday_night"].includes(serviceType)) {
    derivedFilters.serviceType = serviceType;
  }

  const labels = [];
  if (
    cleanQuery.includes("lord's supper") ||
    cleanQuery.includes("lords supper") ||
    cleanQuery.includes("communion")
  ) {
    labels.push("lords_supper");
  }

  if (cleanQuery.includes("easter")) {
    labels.push("easter");
  }

  if (labels.length > 0) {
    derivedFilters.labels = Array.from(new Set(labels)).sort();
    if (!cleanQuery.includes("this month")) {
      expectsSingleResult = true;
    }
  }

  const residualTokens = cleanQuery
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/lord['’]?s supper/g, " ")
    .replace(/communion/g, " ")
    .replace(/easter/g, " ")
    .replace(/sunday morning/g, " ")
    .replace(/sunday night/g, " ")
    .replace(/sunday evening/g, " ")
    .replace(/wednesday night/g, " ")
    .replace(/this month/g, " ")
    .replace(/last sunday/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !QUERY_STOP_WORDS.has(token));

  return {
    cleanQuery,
    derivedFilters,
    residualTokens,
    expectsSingleResult
  };
}

function mergeFilters(explicitFilters, derivedFilters) {
  const merged = {
    ...derivedFilters,
    ...explicitFilters
  };

  if (Array.isArray(derivedFilters.labels) || Array.isArray(explicitFilters.labels)) {
    merged.labels = Array.from(
      new Set([...(derivedFilters.labels || []), ...(explicitFilters.labels || [])])
    ).sort();
  }

  return merged;
}

function isNormalizedBreezeService(service = {}) {
  const source = normalizeString(service.source).toLowerCase();
  const sourceImportId = normalizeString(service.sourceImportId);
  return source === "breeze_import" || source === "breeze" || Boolean(sourceImportId);
}

function normalizeSongEntry(song = {}) {
  return {
    songId: normalizeString(song.songId),
    hymnalNumber: Number.isInteger(song.hymnalNumber) ? song.hymnalNumber : null,
    title: normalizeString(song.title || song.canonicalTitle || song.songTitle),
    slotIndex: Number.isInteger(song.slotIndex) ? song.slotIndex : null,
    usageRole: normalizeString(song.usageRole)
  };
}

function buildSongsForService(service = {}, serviceSongEvents = []) {
  const eventSongs = serviceSongEvents
    .filter((event) => normalizeString(event.serviceId) === normalizeString(service.serviceId))
    .map((event) => normalizeSongEntry(event))
    .sort((left, right) => {
      const leftSlot = left.slotIndex ?? Number.MAX_SAFE_INTEGER;
      const rightSlot = right.slotIndex ?? Number.MAX_SAFE_INTEGER;

      if (leftSlot !== rightSlot) {
        return leftSlot - rightSlot;
      }

      return left.title.localeCompare(right.title);
    });

  if (eventSongs.length > 0) {
    return eventSongs;
  }

  return (Array.isArray(service.songs) ? service.songs : [])
    .map((song) => normalizeSongEntry(song))
    .sort((left, right) => {
      const leftSlot = left.slotIndex ?? Number.MAX_SAFE_INTEGER;
      const rightSlot = right.slotIndex ?? Number.MAX_SAFE_INTEGER;

      if (leftSlot !== rightSlot) {
        return leftSlot - rightSlot;
      }

      return left.title.localeCompare(right.title);
    });
}

function buildImportContext(service = {}, importRecord = null) {
  const importId = normalizeString(service.sourceImportId);

  if (!importId) {
    return null;
  }

  if (!importRecord) {
    return {
      importId
    };
  }

  return {
    importId,
    status: normalizeString(importRecord.status),
    importedAt: normalizeString(importRecord.importedAt)
  };
}

function buildServiceSearchText(service = {}) {
  const labels = normalizeServiceLabels(service.serviceLabels || service.labels);

  return [
    normalizeString(service.serviceId),
    normalizeString(service.title),
    normalizeString(service.theme),
    normalizeString(service.serviceDate),
    canonicalizeServiceType(service.serviceType),
    labels.join(" "),
    normalizeString(service.rawBreezeReference)
  ]
    .join(" ")
    .toLowerCase();
}

function buildServiceSummary(service = {}, serviceSongEvents = [], importRecord = null) {
  const songs = buildSongsForService(service, serviceSongEvents);

  return {
    serviceId: normalizeString(service.serviceId),
    serviceDate: toDateOnly(service.serviceDate) || normalizeString(service.serviceDate),
    serviceType: canonicalizeServiceType(service.serviceType),
    title: normalizeString(service.title),
    theme: normalizeString(service.theme),
    source: normalizeString(service.source),
    sourceImportId: normalizeString(service.sourceImportId),
    serviceLabels: normalizeServiceLabels(service.serviceLabels || service.labels),
    songs,
    songCount: songs.length,
    importContext: buildImportContext(service, importRecord)
  };
}

function buildServiceDetail(service = {}, serviceSongEvents = [], importRecord = null) {
  const summary = buildServiceSummary(service, serviceSongEvents, importRecord);

  return {
    ...summary,
    rawBreezeReference: normalizeString(service.rawBreezeReference),
    createdAt: normalizeString(service.createdAt),
    updatedAt: normalizeString(service.updatedAt)
  };
}

function getSafeLimit(limit) {
  const parsed = Number.parseInt(String(limit ?? "10"), 10);
  if (!Number.isInteger(parsed)) {
    return 10;
  }

  return Math.min(Math.max(parsed, 1), 25);
}

async function loadServiceHistoryContext({
  servicesCollection,
  serviceSongEventsCollection,
  breezeImportsCollection
}) {
  const [servicesSnapshot, eventsSnapshot, importsSnapshot] = await Promise.all([
    servicesCollection.limit(500).get(),
    serviceSongEventsCollection.limit(5000).get(),
    breezeImportsCollection.limit(500).get()
  ]);

  const serviceSongEvents = eventsSnapshot.docs.map((doc) => doc.data() || {});
  const importRecordsById = new Map(
    importsSnapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const importId = normalizeString(data.importId || doc.id);
      return [importId, data];
    })
  );

  return {
    services: servicesSnapshot.docs.map((doc) => doc.data() || {}),
    serviceSongEvents,
    importRecordsById
  };
}

function matchesServiceFilters(summary, filters, searchText, residualTokens) {
  if (filters.serviceType && summary.serviceType !== filters.serviceType) {
    return false;
  }

  if (filters.serviceDate && summary.serviceDate !== filters.serviceDate) {
    return false;
  }

  if (filters.dateFrom && summary.serviceDate < filters.dateFrom) {
    return false;
  }

  if (filters.dateTo && summary.serviceDate > filters.dateTo) {
    return false;
  }

  if (Array.isArray(filters.labels) && filters.labels.length > 0) {
    const summaryLabels = new Set(summary.serviceLabels);

    for (const label of filters.labels) {
      if (!summaryLabels.has(label) && !searchText.includes(label.replace(/_/g, " "))) {
        return false;
      }
    }
  }

  if (residualTokens.length > 0 && !residualTokens.every((token) => searchText.includes(token))) {
    return false;
  }

  return true;
}

async function searchServices(
  {
    query,
    filters,
    limit = 10
  },
  deps
) {
  const cleanQuery = normalizeString(query);
  const normalizedFilters = normalizeServiceFilters(filters);
  const hasExplicitFilters = Object.keys(normalizedFilters).length > 0;

  if (!cleanQuery && !hasExplicitFilters) {
    throw createServiceHistoryError(
      "Missing query or filters",
      400,
      {},
      "missing_query_or_filters"
    );
  }

  const nowDate = typeof deps.now === "function" ? deps.now() : new Date();
  const {
    cleanQuery: normalizedQuery,
    derivedFilters,
    residualTokens,
    expectsSingleResult
  } = parseQueryIntent(cleanQuery, nowDate);
  const mergedFilters = mergeFilters(normalizedFilters, derivedFilters);
  const safeLimit = getSafeLimit(limit);
  const { services, serviceSongEvents, importRecordsById } = await loadServiceHistoryContext(deps);

  const matches = services
    .filter((service) => isNormalizedBreezeService(service))
    .map((service) => {
      const importRecord = importRecordsById.get(normalizeString(service.sourceImportId)) || null;
      const summary = buildServiceSummary(service, serviceSongEvents, importRecord);
      const searchText = buildServiceSearchText(service);

      return {
        ...summary,
        _searchText: searchText,
        _matched: matchesServiceFilters(summary, mergedFilters, searchText, residualTokens)
      };
    })
    .filter((service) => service._matched)
    .sort((left, right) => {
      if (left.serviceDate !== right.serviceDate) {
        return right.serviceDate.localeCompare(left.serviceDate);
      }

      return left.serviceType.localeCompare(right.serviceType);
    });

  const warnings = [];

  if (expectsSingleResult && matches.length > 1) {
    warnings.push("Multiple services matched the request. Review the returned candidates before selecting one.");
  }

  if (normalizedQuery && matches.length === 0) {
    warnings.push("No normalized Breeze-imported services matched the request.");
  }

  return {
    query: normalizedQuery.toLowerCase(),
    count: Math.min(matches.length, safeLimit),
    services: matches
      .slice(0, safeLimit)
      .map(({ _searchText, _matched, ...service }) => service),
    appliedFilters: mergedFilters,
    warnings
  };
}

async function getServiceById(
  { serviceId },
  deps
) {
  const cleanServiceId = normalizeString(serviceId);

  if (!cleanServiceId) {
    throw createServiceHistoryError(
      "Missing or invalid serviceId",
      400,
      {},
      "missing_or_invalid_service_id"
    );
  }

  const doc = await deps.servicesCollection.doc(cleanServiceId).get();

  if (!doc.exists) {
    throw createServiceHistoryError(
      "Service not found",
      404,
      { serviceId: cleanServiceId },
      "service_not_found"
    );
  }

  const service = doc.data() || {};

  if (!isNormalizedBreezeService(service)) {
    throw createServiceHistoryError(
      "Service not found",
      404,
      { serviceId: cleanServiceId },
      "service_not_found"
    );
  }

  const [eventsSnapshot, importsSnapshot] = await Promise.all([
    deps.serviceSongEventsCollection.limit(5000).get(),
    deps.breezeImportsCollection.limit(500).get()
  ]);

  const serviceSongEvents = eventsSnapshot.docs.map((eventDoc) => eventDoc.data() || {});
  const importRecordsById = new Map(
    importsSnapshot.docs.map((importDoc) => {
      const data = importDoc.data() || {};
      const importId = normalizeString(data.importId || importDoc.id);
      return [importId, data];
    })
  );

  return {
    service: buildServiceDetail(
      service,
      serviceSongEvents,
      importRecordsById.get(normalizeString(service.sourceImportId)) || null
    )
  };
}

module.exports = {
  buildServiceDetail,
  buildServiceSummary,
  createServiceHistoryError,
  getServiceById,
  searchServices
};
