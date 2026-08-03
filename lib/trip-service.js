"use strict";

const { createHash } = require("node:crypto");
const {
  assertCanReadTaskRecord,
  getTaskAccess,
  getTaskActorFields,
  isRecordOwner,
  isTaskAdmin
} = require("./task-management-access");

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
const SAFE_TRAVELER_FIELDS = Object.freeze([
  "displayName",
  "firstName",
  "lastName",
  "formsStatus",
  "passportReadiness",
  "teamNumber",
  "seatAssignments",
  "carryOn",
  "checkedBag"
]);
const EXCLUDED_WORKBOOK_CONTENT = Object.freeze([
  "Traveller Account Balance tab",
  "costs, payments, balances, donors, and financial communications",
  "legal name as on passport",
  "date of birth",
  "passport number, issue date, and expiration date",
  "booking number",
  "ticket number",
  "TSA PreCheck information"
]);
const SHEET_RANGES = Object.freeze([
  "'Traveller Information'!A:D",
  "'Traveller Information'!J:J",
  "'Traveller Information'!N:S",
  "'Apparel Order'!A:C"
]);

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
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: PHILIPPINES_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(safeDate).map(({ type, value: partValue }) => [type, partValue])
  );
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
  if (tripId !== PHILIPPINES_TRIP_ID) {
    throw createTripError("Unsupported trip", 400, "unsupported_trip", {
      tripId,
      supportedTripId: PHILIPPINES_TRIP_ID
    });
  }
  return tripId;
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
    philippineLocalTimestamp: memory.philippineLocalTimestamp || "",
    category: memory.category || "other",
    privacy: memory.privacy || "private_only",
    source: memory.source || "",
    author: memory.author || "",
    linkedRecordIds: Array.isArray(memory.linkedRecordIds) ? memory.linkedRecordIds : [],
    createdAt: memory.createdAt || "",
    updatedAt: memory.updatedAt || "",
    version: Number(memory.version || 0)
  };
}

async function saveTripMemory(input = {}, deps = {}) {
  await requireTripProject(deps, { write: true });
  const tripId = normalizeTripId(input.tripId);
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
  const privacy = normalizeEnum(input.privacy, MEMORY_PRIVACY, "private_only", "trip_memory_privacy");
  const happenedAt = normalizeDateTime(input.happenedAt, "trip_memory_happened_at");
  const source = normalizeString(input.source) || "chatgpt";
  const author = normalizeString(input.author) || "Dan";
  const linkedRecordIds = [...new Set(
    (Array.isArray(input.linkedRecordIds) ? input.linkedRecordIds : [])
      .map(normalizeString)
      .filter(Boolean)
  )].slice(0, 25);
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
    source,
    author,
    linkedRecordIds
  }), 64);
  if (existing.exists) {
    const memory = existing.data() || {};
    if (memory.payloadFingerprint !== payloadFingerprint) {
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
  const actor = getTaskActorFields(deps);
  const memory = {
    memoryId,
    tripId,
    projectId: PHILIPPINES_TRIP_PROJECT_ID,
    exactText,
    happenedAt,
    philippineLocalTimestamp: `${manilaTimestamp(happenedAt || nowIso)} ${PHILIPPINES_TIME_ZONE}`,
    category,
    privacy,
    source,
    author,
    linkedRecordIds,
    ownerSub: actor.actorSub,
    ownerName: actor.actorName,
    idempotencyKeyHash,
    payloadFingerprint,
    searchText: normalizeKey([exactText, category, source, author].join(" ")),
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await memoryRef.create(memory);
  return { memory: memorySummary(memory), idempotency: { protected: true, replayed: false } };
}

async function getTripMemory(input = {}, deps = {}) {
  await requireTripProject(deps);
  normalizeTripId(input.tripId);
  const memoryId = normalizeString(input.memoryId);
  if (!memoryId) throw createTripError("memoryId is required", 400, "missing_trip_memory_id");
  const document = await getCollection(deps, "tripMemoriesCollection").doc(memoryId).get();
  if (!document.exists) {
    throw createTripError("Trip memory not found", 404, "trip_memory_not_found", { memoryId });
  }
  const memory = document.data() || {};
  if (memory.tripId !== PHILIPPINES_TRIP_ID) {
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
  await requireTripProject(deps);
  const tripId = normalizeTripId(input.tripId);
  const query = normalizeKey(input.query);
  const category = normalizeString(input.category).toLowerCase();
  const privacy = normalizeString(input.privacy).toLowerCase();
  const date = normalizeString(input.date);
  if (category && !MEMORY_CATEGORIES.includes(category)) {
    throw createTripError("Invalid trip memory category", 400, "invalid_trip_memory_category", { category });
  }
  if (privacy && !MEMORY_PRIVACY.includes(privacy)) {
    throw createTripError("Invalid trip memory privacy", 400, "invalid_trip_memory_privacy", { privacy });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createTripError("Invalid trip memory date", 400, "invalid_trip_memory_date", { date });
  }
  const limit = normalizeLimit(input.limit, 20, 50);
  const records = (await loadCollection(getCollection(deps, "tripMemoriesCollection")))
    .map(({ data }) => data)
    .filter((memory) => memory.tripId === tripId)
    .filter((memory) => !query || normalizeKey(memory.searchText || memory.exactText).includes(query))
    .filter((memory) => !category || memory.category === category)
    .filter((memory) => !privacy || memory.privacy === privacy)
    .filter((memory) => !date || String(memory.philippineLocalTimestamp || "").startsWith(date))
    .sort((left, right) => {
      const leftTime = left.happenedAt || left.createdAt || "";
      const rightTime = right.happenedAt || right.createdAt || "";
      return rightTime.localeCompare(leftTime);
    })
    .slice(0, limit)
    .map(memorySummary);
  const byDate = {};
  for (const memory of records) {
    const localDate = String(memory.philippineLocalTimestamp || "").slice(0, 10) || "unknown";
    byDate[localDate] = (byDate[localDate] || 0) + 1;
  }
  return {
    tripId,
    count: records.length,
    query,
    byDate,
    memories: records
  };
}

function extractGoogleSheetId(value) {
  const cleanValue = normalizeString(value);
  const match = cleanValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(cleanValue)) return cleanValue;
  throw createTripError("A valid Google Sheet URL or ID is required", 400, "invalid_trip_google_sheet");
}

function valueAt(rows, rowIndex, columnIndex = 0) {
  const row = Array.isArray(rows?.[rowIndex]) ? rows[rowIndex] : [];
  return normalizeString(row[columnIndex]);
}

function assertHeader(rows, expected, range) {
  const actual = expected.map((_, index) => normalizeKey(valueAt(rows, 0, index)));
  const wanted = expected.map(normalizeKey);
  if (actual.some((value, index) => value !== wanted[index])) {
    throw createTripError(
      "The Google Sheet headers changed; the privacy whitelist was not applied",
      409,
      "trip_sheet_header_mismatch",
      { range, expected, actual }
    );
  }
}

function findApparelHeaderRow(rows = []) {
  const expected = ["participant name", "shirt size", "jacket size"];
  return rows.slice(0, 10).findIndex((row) =>
    expected.every((header, index) => normalizeKey(row?.[index]) === header)
  );
}

function buildParticipantId(firstName, lastName) {
  return `trip-participant-${hashValue(`${normalizeKey(firstName)}|${normalizeKey(lastName)}`, 20)}`;
}

function buildApparelId(name) {
  return `trip-apparel-${hashValue(normalizeKey(name), 20)}`;
}

async function readTripSheetSnapshot(input = {}, deps = {}) {
  if (typeof deps.googleSheetsRequest !== "function") {
    throw createTripError("Google Sheets access is not configured", 500, "trip_google_sheets_not_configured");
  }
  const tripId = normalizeTripId(input.tripId);
  const googleSheetId = extractGoogleSheetId(input.googleSheetId || input.googleSheetUrl);
  const metadata = await deps.googleSheetsRequest({
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,index))`
  });
  const query = new URLSearchParams();
  for (const range of SHEET_RANGES) query.append("ranges", range);
  query.set("majorDimension", "ROWS");
  query.set("valueRenderOption", "FORMATTED_VALUE");
  const response = await deps.googleSheetsRequest({
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}/values:batchGet?${query.toString()}`
  });
  const valueRanges = Array.isArray(response?.valueRanges) ? response.valueRanges : [];
  if (valueRanges.length !== SHEET_RANGES.length) {
    throw createTripError(
      "Google Sheets did not return every privacy-approved range",
      502,
      "trip_sheet_ranges_incomplete",
      { expectedRangeCount: SHEET_RANGES.length, actualRangeCount: valueRanges.length }
    );
  }
  const travelerIdentityRows = valueRanges[0]?.values || [];
  const travelerTeamRows = valueRanges[1]?.values || [];
  const travelerTravelRows = valueRanges[2]?.values || [];
  const apparelRows = valueRanges[3]?.values || [];
  assertHeader(travelerIdentityRows, ["Forms", "Passport", "First Name", "Last Name"], SHEET_RANGES[0]);
  assertHeader(travelerTeamRows, ["TEAM #"], SHEET_RANGES[1]);
  assertHeader(
    travelerTravelRows,
    ["SEAT #1", "SEAT #2", "SEAT #3", "SEAT #4", "CARRY-ON", "CHECKED BAG"],
    SHEET_RANGES[2]
  );
  const participants = [];
  for (let rowIndex = 1; rowIndex < travelerIdentityRows.length; rowIndex += 1) {
    const firstName = valueAt(travelerIdentityRows, rowIndex, 2);
    const lastName = valueAt(travelerIdentityRows, rowIndex, 3);
    if (!firstName && !lastName) continue;
    const seatAssignments = [0, 1, 2, 3]
      .map((columnIndex) => valueAt(travelerTravelRows, rowIndex, columnIndex))
      .filter(Boolean);
    participants.push({
      participantId: buildParticipantId(firstName, lastName),
      tripId,
      displayName: [firstName, lastName].filter(Boolean).join(" "),
      firstName,
      lastName,
      formsStatus: valueAt(travelerIdentityRows, rowIndex, 0),
      passportReadiness: valueAt(travelerIdentityRows, rowIndex, 1),
      teamNumber: valueAt(travelerTeamRows, rowIndex, 0),
      seatAssignments,
      carryOn: valueAt(travelerTravelRows, rowIndex, 4),
      checkedBag: valueAt(travelerTravelRows, rowIndex, 5),
      sourceRowNumber: rowIndex + 1
    });
  }
  const apparelHeaderRow = findApparelHeaderRow(apparelRows);
  if (apparelHeaderRow < 0) {
    throw createTripError(
      "The Apparel Order headers changed; the privacy whitelist was not applied",
      409,
      "trip_apparel_header_mismatch"
    );
  }
  const apparel = [];
  for (let rowIndex = apparelHeaderRow + 1; rowIndex < apparelRows.length; rowIndex += 1) {
    const participantName = valueAt(apparelRows, rowIndex, 0);
    if (!participantName) continue;
    apparel.push({
      apparelId: buildApparelId(participantName),
      tripId,
      participantName,
      shirtSize: valueAt(apparelRows, rowIndex, 1),
      jacketSize: valueAt(apparelRows, rowIndex, 2),
      sourceRowNumber: rowIndex + 1
    });
  }
  const duplicateParticipantIds = participants
    .map((participant) => participant.participantId)
    .filter((participantId, index, all) => all.indexOf(participantId) !== index);
  if (duplicateParticipantIds.length) {
    throw createTripError(
      "The safe traveler fields do not uniquely identify every participant",
      409,
      "trip_participant_identity_conflict",
      { duplicateCount: new Set(duplicateParticipantIds).size }
    );
  }
  const safeSnapshot = {
    tripId,
    googleSheetId,
    spreadsheetTitle: normalizeString(metadata?.properties?.title),
    participants,
    apparel
  };
  return {
    ...safeSnapshot,
    fingerprint: hashValue(stableStringify(safeSnapshot), 64)
  };
}

function buildSheetPreview(snapshot = {}) {
  const participantNames = new Set((snapshot.participants || []).map((participant) => normalizeKey(participant.displayName)));
  const unmatchedApparelCount = (snapshot.apparel || [])
    .filter((item) => !participantNames.has(normalizeKey(item.participantName)))
    .length;
  const teams = {};
  let missingFormsStatus = 0;
  let missingPassportReadiness = 0;
  for (const participant of snapshot.participants || []) {
    const team = participant.teamNumber || "unassigned";
    teams[team] = (teams[team] || 0) + 1;
    if (!participant.formsStatus) missingFormsStatus += 1;
    if (!participant.passportReadiness) missingPassportReadiness += 1;
  }
  return {
    tripId: snapshot.tripId || PHILIPPINES_TRIP_ID,
    googleSheetId: snapshot.googleSheetId || "",
    spreadsheetTitle: snapshot.spreadsheetTitle || "",
    fingerprint: snapshot.fingerprint || "",
    privacyBoundary: {
      importedTravelerFields: [...SAFE_TRAVELER_FIELDS],
      importedApparelFields: ["participantName", "shirtSize", "jacketSize"],
      excludedWorkbookContent: [...EXCLUDED_WORKBOOK_CONTENT],
      ignoredTabs: ["Traveller Account Balance", "Teams"]
    },
    summary: {
      participantCount: (snapshot.participants || []).length,
      apparelOrderCount: (snapshot.apparel || []).length,
      unmatchedApparelCount,
      missingFormsStatus,
      missingPassportReadiness,
      participantsByTeam: teams
    }
  };
}

async function previewTripGoogleSheetImport(input = {}, deps = {}) {
  await requireTripProject(deps);
  return { preview: buildSheetPreview(await readTripSheetSnapshot(input, deps)) };
}

async function upsertRecord(collection, id, nextData, deps = {}) {
  const ref = collection.doc(id);
  const existing = await ref.get();
  const nowIso = getNowIso(deps);
  const previous = existing.exists ? (existing.data() || {}) : {};
  const record = {
    ...previous,
    ...nextData,
    version: Math.max(0, Number(previous.version) || 0) + 1,
    createdAt: previous.createdAt || nowIso,
    updatedAt: nowIso
  };
  await ref.set(record);
  return record;
}

async function commitTripGoogleSheetImport(input = {}, deps = {}) {
  await requireTripProject(deps, { write: true });
  const idempotencyKey = normalizeString(input.idempotencyKey);
  if (idempotencyKey.length < 8) {
    throw createTripError("A stable idempotency key is required", 400, "missing_trip_import_idempotency_key");
  }
  const snapshot = await readTripSheetSnapshot(input, deps);
  if (input.expectedFingerprint && input.expectedFingerprint !== snapshot.fingerprint) {
    throw createTripError(
      "The Google Sheet changed after preview; preview it again before importing",
      409,
      "trip_sheet_preview_stale",
      { expectedFingerprint: input.expectedFingerprint, actualFingerprint: snapshot.fingerprint }
    );
  }
  const importsCollection = getCollection(deps, "tripImportsCollection");
  const importId = `trip-import-${hashValue(`${snapshot.tripId}:${idempotencyKey}`)}`;
  const importRef = importsCollection.doc(importId);
  const existingImport = await importRef.get();
  if (existingImport.exists) {
    const existing = existingImport.data() || {};
    if (existing.fingerprint !== snapshot.fingerprint) {
      throw createTripError(
        "This idempotency key was already used for a different Sheet snapshot",
        409,
        "trip_import_idempotency_key_reused",
        { importId }
      );
    }
    return {
      import: existing,
      preview: buildSheetPreview(snapshot),
      idempotency: { protected: true, replayed: true }
    };
  }
  const actor = getTaskActorFields(deps);
  const participantsCollection = getCollection(deps, "tripParticipantsCollection");
  const apparelCollection = getCollection(deps, "tripApparelCollection");
  for (const participant of snapshot.participants) {
    await upsertRecord(participantsCollection, participant.participantId, {
      ...participant,
      projectId: PHILIPPINES_TRIP_PROJECT_ID,
      privacy: "private_only",
      active: true,
      source: {
        type: "google_sheet",
        googleSheetId: snapshot.googleSheetId,
        sheetName: "Traveller Information",
        sourceRowNumber: participant.sourceRowNumber,
        importId
      },
      updatedBySub: actor.actorSub,
      updatedByName: actor.actorName
    }, deps);
  }
  for (const item of snapshot.apparel) {
    await upsertRecord(apparelCollection, item.apparelId, {
      ...item,
      projectId: PHILIPPINES_TRIP_PROJECT_ID,
      privacy: "private_only",
      active: true,
      source: {
        type: "google_sheet",
        googleSheetId: snapshot.googleSheetId,
        sheetName: "Apparel Order",
        sourceRowNumber: item.sourceRowNumber,
        importId
      },
      updatedBySub: actor.actorSub,
      updatedByName: actor.actorName
    }, deps);
  }
  const preview = buildSheetPreview(snapshot);
  const nowIso = getNowIso(deps);
  const importRecord = {
    importId,
    tripId: snapshot.tripId,
    projectId: PHILIPPINES_TRIP_PROJECT_ID,
    sourceType: "google_sheet",
    googleSheetId: snapshot.googleSheetId,
    spreadsheetTitle: snapshot.spreadsheetTitle,
    fingerprint: snapshot.fingerprint,
    privacyBoundary: preview.privacyBoundary,
    summary: preview.summary,
    importedBySub: actor.actorSub,
    importedByName: actor.actorName,
    idempotencyKeyHash: hashValue(idempotencyKey, 64),
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1
  };
  await importRef.create(importRecord);
  return {
    import: importRecord,
    preview,
    idempotency: { protected: true, replayed: false }
  };
}

async function getTripImport(input = {}, deps = {}) {
  await requireTripProject(deps);
  normalizeTripId(input.tripId);
  const importId = normalizeString(input.importId);
  if (!importId) throw createTripError("importId is required", 400, "missing_trip_import_id");
  const document = await getCollection(deps, "tripImportsCollection").doc(importId).get();
  if (!document.exists) {
    throw createTripError("Trip import not found", 404, "trip_import_not_found", { importId });
  }
  return { import: document.data() || {} };
}

function participantSummary(participant = {}) {
  return {
    participantId: participant.participantId || "",
    displayName: participant.displayName || "",
    teamNumber: participant.teamNumber || "",
    formsStatus: participant.formsStatus || "",
    passportReadiness: participant.passportReadiness || "",
    seatAssignments: Array.isArray(participant.seatAssignments) ? participant.seatAssignments : [],
    carryOn: participant.carryOn || "",
    checkedBag: participant.checkedBag || "",
    active: participant.active !== false,
    updatedAt: participant.updatedAt || ""
  };
}

function apparelSummary(item = {}) {
  return {
    apparelId: item.apparelId || "",
    participantName: item.participantName || "",
    shirtSize: item.shirtSize || "",
    jacketSize: item.jacketSize || "",
    active: item.active !== false,
    updatedAt: item.updatedAt || ""
  };
}

async function getTripReference(input = {}, deps = {}) {
  await requireTripProject(deps);
  const tripId = normalizeTripId(input.tripId);
  const query = normalizeKey(input.query);
  const teamNumber = normalizeString(input.teamNumber);
  const limit = normalizeLimit(input.limit, 25, 50);
  const participants = (await loadCollection(getCollection(deps, "tripParticipantsCollection")))
    .map(({ data }) => data)
    .filter((participant) => participant.tripId === tripId && participant.active !== false)
    .filter((participant) => !query || normalizeKey(participant.displayName).includes(query))
    .filter((participant) => !teamNumber || participant.teamNumber === teamNumber)
    .sort((left, right) => normalizeKey(left.displayName).localeCompare(normalizeKey(right.displayName)));
  const apparel = (await loadCollection(getCollection(deps, "tripApparelCollection")))
    .map(({ data }) => data)
    .filter((item) => item.tripId === tripId && item.active !== false)
    .filter((item) => !query || normalizeKey(item.participantName).includes(query))
    .sort((left, right) => normalizeKey(left.participantName).localeCompare(normalizeKey(right.participantName)));
  const latestImport = (await loadCollection(getCollection(deps, "tripImportsCollection")))
    .map(({ data }) => data)
    .filter((record) => record.tripId === tripId)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0] || {};
  const byTeam = {};
  let missingFormsStatus = 0;
  let missingPassportReadiness = 0;
  for (const participant of participants) {
    const team = participant.teamNumber || "unassigned";
    byTeam[team] = (byTeam[team] || 0) + 1;
    if (!participant.formsStatus) missingFormsStatus += 1;
    if (!participant.passportReadiness) missingPassportReadiness += 1;
  }
  return {
    tripId,
    query,
    teamNumber,
    summary: {
      participantCount: participants.length,
      apparelOrderCount: apparel.length,
      participantsByTeam: byTeam,
      missingFormsStatus,
      missingPassportReadiness
    },
    latestImport: {
      importId: latestImport.importId || "",
      fingerprint: latestImport.fingerprint || "",
      spreadsheetTitle: latestImport.spreadsheetTitle || "",
      createdAt: latestImport.createdAt || ""
    },
    participants: input.summaryOnly === true
      ? []
      : participants.slice(0, limit).map(participantSummary),
    apparel: input.summaryOnly === true
      ? []
      : apparel.slice(0, limit).map(apparelSummary)
  };
}

module.exports = {
  EXCLUDED_WORKBOOK_CONTENT,
  MEMORY_CATEGORIES,
  MEMORY_PRIVACY,
  PHILIPPINES_TRIP_ID,
  PHILIPPINES_TRIP_PROJECT_ID,
  SAFE_TRAVELER_FIELDS,
  SHEET_RANGES,
  buildSheetPreview,
  commitTripGoogleSheetImport,
  extractGoogleSheetId,
  getTripImport,
  getTripMemory,
  getTripReference,
  manilaTimestamp,
  previewTripGoogleSheetImport,
  readTripSheetSnapshot,
  saveTripMemory,
  searchTripMemories
};
