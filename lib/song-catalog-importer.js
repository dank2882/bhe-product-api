"use strict";

const DEFAULT_HYMNAL_ID = "rejoice";
const DEFAULT_CATALOG_SOURCE = "song_topics_index_verified.csv";
const DEFAULT_CATALOG_VERSION = "working";
const MAX_REVIEW_DETAILS = 100;

function getNowIso() {
  return new Date().toISOString();
}

function createImportError(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  return error;
}

function padHymnalNumber(hymnalNumber) {
  return String(hymnalNumber).padStart(4, "0");
}

function buildSongId(hymnalId, hymnalNumber) {
  return `${hymnalId}-${padHymnalNumber(hymnalNumber)}`;
}

function normalizeUnicodeText(value) {
  return typeof value === "string" ? value.normalize("NFKC") : "";
}

function normalizeInternalWhitespace(value) {
  return normalizeUnicodeText(value).replace(/\s+/g, " ").trim();
}

function normalizeDashCharacters(value) {
  return value.replace(/[\u2012\u2013\u2014\u2015]/g, "-");
}

function normalizeQuoteCharacters(value) {
  return value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, "\"");
}

function strictNormalizeTitle(title) {
  return normalizeInternalWhitespace(
    normalizeQuoteCharacters(normalizeDashCharacters(String(title || "")))
  ).toLowerCase();
}

function looseNormalizeTitle(title) {
  return strictNormalizeTitle(title)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTopics(rawTopics) {
  if (typeof rawTopics !== "string") {
    return {
      topics: [],
      hadMalformedTopicValue: false
    };
  }

  if (!normalizeInternalWhitespace(rawTopics)) {
    return {
      topics: [],
      hadMalformedTopicValue: false
    };
  }

  const parts = rawTopics.split(",");
  const topics = [];
  let hadMalformedTopicValue = false;

  for (const part of parts) {
    const topic = normalizeInternalWhitespace(part);
    if (!topic) {
      hadMalformedTopicValue = true;
      continue;
    }

    if (!topics.includes(topic)) {
      topics.push(topic);
    }
  }

  return {
    topics,
    hadMalformedTopicValue
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseSongCatalogCsv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) {
    throw createImportError("Missing or invalid csvText");
  }

  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw createImportError("CSV content was empty after parsing");
  }

  const header = parseCsvLine(lines[0]).map((column) => normalizeInternalWhitespace(column));
  const expectedHeader = ["Song #", "Title", "Topics"];

  if (expectedHeader.some((column, index) => header[index] !== column)) {
    throw createImportError("Unexpected CSV header", {
      expectedHeader,
      actualHeader: header
    });
  }

  return lines.slice(1).map((line, index) => {
    const [rawSongNumber = "", rawTitle = "", rawTopics = ""] = parseCsvLine(line);
    const rowNumber = index + 2;
    const cleanSongNumber = normalizeInternalWhitespace(rawSongNumber);
    const cleanTitle = normalizeInternalWhitespace(rawTitle);
    const parsedNumber = Number.parseInt(cleanSongNumber, 10);
    const isValidNumber = Number.isInteger(parsedNumber) && parsedNumber > 0;
    const { topics, hadMalformedTopicValue } = splitTopics(rawTopics);

    return {
      rowNumber,
      rawSongNumber,
      rawTitle,
      rawTopics,
      hymnalNumber: isValidNumber ? parsedNumber : null,
      title: cleanTitle,
      topics,
      hadMalformedTopicValue
    };
  });
}

function levenshteinDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");

  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const temp = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + cost
      );

      diagonal = temp;
    }
  }

  return previous[b.length];
}

function tokenizeLooseTitle(title) {
  return looseNormalizeTitle(title).split(" ").filter(Boolean);
}

function countTitleNoise(title) {
  const normalized = normalizeInternalWhitespace(title);
  const punctuationCount = (normalized.match(/[^\w\s']/g) || []).length;
  const midWordUppercaseCount = normalized
    .split(/\s+/)
    .filter(Boolean)
    .reduce((count, token) => count + ((token.slice(1).match(/[A-Z]/g) || []).length), 0);

  return punctuationCount + (midWordUppercaseCount * 2);
}

function isLikelyMinorTitleVariant(leftTitle, rightTitle) {
  const leftLoose = looseNormalizeTitle(leftTitle);
  const rightLoose = looseNormalizeTitle(rightTitle);

  if (!leftLoose || !rightLoose) {
    return false;
  }

  if (leftLoose === rightLoose) {
    return true;
  }

  const leftTokens = tokenizeLooseTitle(leftTitle);
  const rightTokens = tokenizeLooseTitle(rightTitle);

  if (leftTokens.length !== rightTokens.length) {
    return false;
  }

  let differingTokenCount = 0;

  for (let index = 0; index < leftTokens.length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];

    if (leftToken === rightToken) {
      continue;
    }

    differingTokenCount += 1;
    const maxLength = Math.max(leftToken.length, rightToken.length);
    const maxDistance = Math.max(3, Math.ceil(maxLength * 0.4));

    if (levenshteinDistance(leftToken, rightToken) > maxDistance) {
      return false;
    }
  }

  return differingTokenCount > 0 && differingTokenCount <= 1;
}

function rankTitleVariant(titleStats) {
  const strictTitle = strictNormalizeTitle(titleStats.title);
  const looseTitle = looseNormalizeTitle(titleStats.title);

  return [
    titleStats.count,
    -countTitleNoise(titleStats.title),
    -strictTitle.length,
    -looseTitle.length,
    titleStats.title
  ];
}

function compareRankedValues(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) {
      return -1;
    }

    if (left[index] > right[index]) {
      return 1;
    }
  }

  return 0;
}

function chooseCanonicalTitle(titleStatsList) {
  return titleStatsList
    .slice()
    .sort((left, right) => compareRankedValues(rankTitleVariant(right), rankTitleVariant(left)))[0];
}

function buildNormalizedLookupKeys({
  hymnalNumber,
  canonicalTitle,
  titleAliases
}) {
  const lookupKeys = new Set([
    `number:${hymnalNumber}`,
    `number:${padHymnalNumber(hymnalNumber)}`,
    `number-title:${hymnalNumber}:${looseNormalizeTitle(canonicalTitle)}`
  ]);

  for (const title of [canonicalTitle].concat(titleAliases)) {
    const strictTitle = strictNormalizeTitle(title);
    const looseTitle = looseNormalizeTitle(title);

    if (strictTitle) {
      lookupKeys.add(`title-strict:${strictTitle}`);
    }

    if (looseTitle) {
      lookupKeys.add(`title:${looseTitle}`);
    }
  }

  return Array.from(lookupKeys).sort();
}

function buildDefaultSourceEvidence({
  catalogSource,
  catalogVersion,
  rowRefs
}) {
  return {
    catalogSource,
    catalogVersion,
    rowCount: rowRefs.length,
    rowRefs,
    pdfAudit: {
      status: "not_reviewed",
      notes: ""
    }
  };
}

function summarizeRowForEvidence(row) {
  return {
    rowNumber: row.rowNumber,
    rawTitle: row.rawTitle,
    rawTopics: row.topics
  };
}

function collectTitleStats(rows) {
  const titlesByRawTitle = new Map();

  for (const row of rows) {
    const key = row.title;
    const current = titlesByRawTitle.get(key) || {
      title: row.title,
      count: 0,
      strictNormalizedTitle: strictNormalizeTitle(row.title),
      looseNormalizedTitle: looseNormalizeTitle(row.title)
    };

    current.count += 1;
    titlesByRawTitle.set(key, current);
  }

  return Array.from(titlesByRawTitle.values());
}

function aggregateSongRows(rows, options) {
  const {
    hymnalId,
    catalogSource,
    catalogVersion,
    importedAt
  } = options;
  const firstRow = rows[0];
  const titleStatsList = collectTitleStats(rows);
  const canonicalTitleStats = chooseCanonicalTitle(titleStatsList);
  const strictTitleSet = new Set(titleStatsList.map((item) => item.strictNormalizedTitle));
  const looseTitleSet = new Set(titleStatsList.map((item) => item.looseNormalizedTitle));
  const reviewFlags = new Set();
  const warnings = [];
  const canonicalTitle = canonicalTitleStats.title;
  const titleAliases = titleStatsList
    .map((item) => item.title)
    .filter((title) => title !== canonicalTitle)
    .sort();

  if (rows.some((row) => row.hadMalformedTopicValue)) {
    reviewFlags.add("malformed_topic_value");
  }

  if (rows.every((row) => row.topics.length === 0)) {
    reviewFlags.add("missing_topics");
  }

  if (strictTitleSet.size > 1 && looseTitleSet.size > 1) {
    const everyVariantLooksMinor = titleStatsList.every(
      (titleStats) =>
        titleStats.title === canonicalTitle ||
        isLikelyMinorTitleVariant(canonicalTitle, titleStats.title)
    );

    if (everyVariantLooksMinor) {
      reviewFlags.add("malformed_title_variant");
      reviewFlags.add("pdf_audit_required");
    } else {
      reviewFlags.add("duplicate_number_material_title_conflict");
      reviewFlags.add("pdf_audit_required");
    }
  }

  const topics = Array.from(
    new Set(rows.flatMap((row) => row.topics))
  ).sort((left, right) => left.localeCompare(right));

  let sourceStatus = "verified";
  if (reviewFlags.has("duplicate_number_material_title_conflict")) {
    sourceStatus = "needs_review";
  } else if (reviewFlags.size > 0) {
    sourceStatus = "needs_review";
  }

  if (!canonicalTitle) {
    reviewFlags.add("unresolved_import_ambiguity");
    sourceStatus = "blocked";
    warnings.push(`Hymnal number ${firstRow.hymnalNumber} did not resolve to a canonical title.`);
  }

  const songId = buildSongId(hymnalId, firstRow.hymnalNumber);
  const sourceEvidence = buildDefaultSourceEvidence({
    catalogSource,
    catalogVersion,
    rowRefs: rows.map(summarizeRowForEvidence)
  });

  return {
    song: {
      songId,
      hymnalId,
      hymnalNumber: firstRow.hymnalNumber,
      canonicalTitle,
      topics,
      titleAliases,
      normalizedLookupKeys: buildNormalizedLookupKeys({
        hymnalNumber: firstRow.hymnalNumber,
        canonicalTitle,
        titleAliases
      }),
      sourceStatus,
      sourceEvidence,
      reviewFlags: Array.from(reviewFlags).sort(),
      createdAt: importedAt,
      updatedAt: importedAt
    },
    warnings
  };
}

function buildCanonicalSongsFromCsv(
  {
    csvText,
    hymnalId = DEFAULT_HYMNAL_ID,
    catalogSource = DEFAULT_CATALOG_SOURCE,
    catalogVersion = DEFAULT_CATALOG_VERSION,
    importedAt = getNowIso()
  }
) {
  const rows = parseSongCatalogCsv(csvText);
  const validRows = [];
  const rowErrors = [];
  const nonFatalWarnings = [];

  for (const row of rows) {
    if (row.hymnalNumber === null) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        flag: "missing_hymnal_number",
        message: "Row is missing a valid hymnal number."
      });
      continue;
    }

    if (!row.title) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        flag: "missing_title",
        message: "Row is missing a valid title.",
        hymnalNumber: row.hymnalNumber
      });
      continue;
    }

    validRows.push(row);
  }

  const rowsByHymnalNumber = new Map();

  for (const row of validRows) {
    const existingRows = rowsByHymnalNumber.get(row.hymnalNumber) || [];
    existingRows.push(row);
    rowsByHymnalNumber.set(row.hymnalNumber, existingRows);
  }

  const songs = [];

  for (const groupedRows of Array.from(rowsByHymnalNumber.values()).sort(
    (left, right) => left[0].hymnalNumber - right[0].hymnalNumber
  )) {
    const { song, warnings } = aggregateSongRows(groupedRows, {
      hymnalId,
      catalogSource,
      catalogVersion,
      importedAt
    });

    songs.push(song);
    nonFatalWarnings.push(...warnings);
  }

  const songsByStrictTitle = new Map();

  for (const song of songs) {
    const strictTitle = strictNormalizeTitle(song.canonicalTitle);
    if (!strictTitle) {
      continue;
    }

    const currentSongs = songsByStrictTitle.get(strictTitle) || [];
    currentSongs.push(song);
    songsByStrictTitle.set(strictTitle, currentSongs);
  }

  for (const [strictTitle, songsWithSameTitle] of songsByStrictTitle.entries()) {
    if (songsWithSameTitle.length <= 1) {
      continue;
    }

    const affectedNumbers = songsWithSameTitle.map((song) => song.hymnalNumber).sort((left, right) => left - right);

    for (const song of songsWithSameTitle) {
      if (!song.reviewFlags.includes("duplicate_title_conflicting_numbers")) {
        song.reviewFlags = song.reviewFlags.concat("duplicate_title_conflicting_numbers").sort();
      }

      if (!song.reviewFlags.includes("pdf_audit_required")) {
        song.reviewFlags = song.reviewFlags.concat("pdf_audit_required").sort();
      }

      if (song.sourceStatus === "verified") {
        song.sourceStatus = "needs_review";
      }
    }

    nonFatalWarnings.push(
      `Canonical title "${strictTitle}" appeared under multiple hymn numbers: ${affectedNumbers.join(", ")}`
    );
  }

  const reviewItemsCreated = songs.filter(
    (song) => song.sourceStatus !== "verified" || song.reviewFlags.length > 0
  ).length;

  return {
    songs,
    importSummary: {
      totalRowsRead: rows.length,
      validRowsRead: validRows.length,
      canonicalSongsPrepared: songs.length,
      rowsAggregated: Math.max(validRows.length - songs.length, 0),
      reviewItemsCreated,
      fatalErrors: [],
      nonFatalWarnings: nonFatalWarnings.slice(0, MAX_REVIEW_DETAILS),
      rowErrors
    }
  };
}

function areRecordsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function importCanonicalSongsToCollection(
  options,
  {
    songsCollection
  } = {}
) {
  if (!songsCollection || typeof songsCollection.doc !== "function") {
    throw createImportError("songsCollection with doc() is required");
  }

  const {
    songs,
    importSummary
  } = buildCanonicalSongsFromCsv(options);

  let canonicalSongsCreated = 0;
  let canonicalSongsUpdated = 0;
  let canonicalSongsUnchanged = 0;

  for (const song of songs) {
    const docRef = songsCollection.doc(song.songId);
    const existingDoc = await docRef.get();

    if (!existingDoc.exists) {
      await docRef.set(song);
      canonicalSongsCreated += 1;
      continue;
    }

    const existingSong = existingDoc.data() || {};
    const nextSong = {
      ...song,
      createdAt: typeof existingSong.createdAt === "string" && existingSong.createdAt
        ? existingSong.createdAt
        : song.createdAt
    };

    if (areRecordsEqual(existingSong, nextSong)) {
      canonicalSongsUnchanged += 1;
      continue;
    }

    await docRef.set(nextSong);
    canonicalSongsUpdated += 1;
  }

  return {
    songs,
    importSummary: {
      ...importSummary,
      canonicalSongsCreated,
      canonicalSongsUpdated,
      canonicalSongsUnchanged
    }
  };
}

module.exports = {
  buildCanonicalSongsFromCsv,
  buildSongId,
  importCanonicalSongsToCollection,
  isLikelyMinorTitleVariant,
  looseNormalizeTitle,
  parseSongCatalogCsv,
  strictNormalizeTitle
};
