"use strict";

const { resolveGoogleSheetServiceRow } = require("./google-sheet-service-row-resolver");

const DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID = "1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss";
const DEFAULT_MUSIC_PLANNING_SHEET_NAME = "PROPOSED SCHEDULES";

const STANDARD_ASSIGNMENT_HEADERS = Object.freeze([
  "Preacher",
  "Congregational Leader",
  "Piano 1",
  "Piano 2",
  "Piano 3",
  "Piano 4",
  "Choir Pianist",
  "Special #1 Pianist",
  "Special #2 Pianist",
  "Offertory Pianist"
]);

function createSheetAssignmentError(message, statusCode = 400, code = "sheet_assignment_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHeader(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractGoogleSheetId(value) {
  const cleanValue = normalizeString(value);
  if (!cleanValue) return "";
  const match = cleanValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : cleanValue;
}

function quoteSheetName(value) {
  return `'${normalizeString(value).replace(/'/g, "''")}'`;
}

function columnName(columnIndex) {
  let value = columnIndex + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function personName(value = {}) {
  if (typeof value === "string") return normalizeString(value);
  return normalizeString(value?.displayName);
}

function buildAssignmentValues({ pianoPlan = {}, ministryAssignments = {}, writeGroups = ["pianos", "ministry"] } = {}) {
  const groups = new Set(writeGroups);
  const values = {};
  if (groups.has("pianos")) {
    const byPosition = new Map(
      (Array.isArray(pianoPlan.assignments) ? pianoPlan.assignments : [])
        .map((assignment) => [normalizeString(assignment.position), personName(assignment)])
    );
    values["Piano 1"] = byPosition.get("piano_1") || "";
    values["Piano 2"] = byPosition.get("piano_2") || "";
    values["Piano 3"] = byPosition.get("piano_3") || "";
    values["Piano 4"] = byPosition.get("piano_4") || "";
  }
  if (groups.has("ministry")) {
    values.Preacher = personName(ministryAssignments.preacher);
    values["Congregational Leader"] = personName(ministryAssignments.congregationalLeader);
    values["Choir Pianist"] = personName(ministryAssignments.choirAccompanist);
    values["Special #1 Pianist"] = "";
    values["Special #2 Pianist"] = "";
    values["Offertory Pianist"] = "";
    for (const assignment of ministryAssignments.specialAccompanists || []) {
      const sourceColumnName = normalizeHeader(assignment.sourceColumnName);
      if (sourceColumnName === "special 1") values["Special #1 Pianist"] = personName(assignment);
      if (sourceColumnName === "special 2") values["Special #2 Pianist"] = personName(assignment);
      if (sourceColumnName === "offertory") values["Offertory Pianist"] = personName(assignment);
    }
  }
  return values;
}

async function writeServiceAssignmentsToGoogleSheet(input = {}, deps = {}) {
  if (typeof deps.googleSheetsRequest !== "function") {
    throw createSheetAssignmentError(
      "Google Sheets write access is not configured",
      500,
      "google_sheets_write_not_configured"
    );
  }
  const service = input.service || {};
  if (!Number.isInteger(service.sourceRowNumber) && (!normalizeString(service.serviceDate) || !normalizeString(service.serviceType))) {
    throw createSheetAssignmentError("Service source row was not found", 409, "service_sheet_row_not_found");
  }
  const googleSheetId = extractGoogleSheetId(
    input.googleSheetId || input.googleSheetUrl || DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID
  );
  const sheetName = normalizeString(input.sheet || service.sourceSheetName) || DEFAULT_MUSIC_PLANNING_SHEET_NAME;
  const quotedSheet = quoteSheetName(sheetName);
  const readRange = `${quotedSheet}!A1:AZ`;
  const sheetValues = await deps.googleSheetsRequest({
    method: "GET",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}/values/${encodeURIComponent(readRange)}`
  });
  const rows = Array.isArray(sheetValues?.values) ? sheetValues.values : [];
  const headerRowIndex = rows.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => normalizeHeader(cell) === "date service")
  );
  if (headerRowIndex < 0) {
    throw createSheetAssignmentError(
      "Date/Service header row was not found in the planning sheet",
      409,
      "service_sheet_header_not_found",
      { sheetName }
    );
  }
  const headerRow = Array.isArray(rows[headerRowIndex]) ? rows[headerRowIndex] : [];
  const headerColumnByName = new Map();
  headerRow.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized) headerColumnByName.set(normalized, index);
  });
  const rowResolution = resolveGoogleSheetServiceRow({ rows, headerRowIndex, headerColumnByName, service });
  const sourceRowNumber = rowResolution.sourceRowNumber;
  let nextColumnIndex = Math.max(headerRow.length, 11);
  const headerUpdates = [];
  for (const header of STANDARD_ASSIGNMENT_HEADERS) {
    const normalized = normalizeHeader(header);
    if (!headerColumnByName.has(normalized)) {
      headerColumnByName.set(normalized, nextColumnIndex);
      headerUpdates.push({ header, columnIndex: nextColumnIndex });
      nextColumnIndex += 1;
    }
  }

  const valuesByHeader = buildAssignmentValues(input);
  const data = [];
  for (const { header, columnIndex } of headerUpdates) {
    const cell = `${columnName(columnIndex)}${headerRowIndex + 1}`;
    data.push({ range: `${quotedSheet}!${cell}`, majorDimension: "ROWS", values: [[header]] });
  }
  for (const [header, value] of Object.entries(valuesByHeader)) {
    const columnIndex = headerColumnByName.get(normalizeHeader(header));
    const cell = `${columnName(columnIndex)}${sourceRowNumber}`;
    data.push({ range: `${quotedSheet}!${cell}`, majorDimension: "ROWS", values: [[value]] });
  }
  if (data.length === 0) {
    return { written: false, googleSheetId, sheetName, sourceRowNumber, updatedHeaders: [], updatedFields: [] };
  }
  if (typeof deps.createGoogleSheetBackup !== "function") {
    throw createSheetAssignmentError(
      "Google Sheet backup access is not configured",
      500,
      "google_sheet_backup_not_configured"
    );
  }
  const backup = await deps.createGoogleSheetBackup({
    googleSheetId,
    sheet: sheetName,
    reason: normalizeString(input.backupReason) || "before_service_assignment_write",
    serviceId: normalizeString(service.serviceId)
  }, deps);
  const result = await deps.googleSheetsRequest({
    method: "POST",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}/values:batchUpdate`,
    data: { valueInputOption: "RAW", data }
  });
  return {
    written: true,
    googleSheetId,
    sheetName,
    sourceRowNumber,
    rowResolution,
    backup,
    updatedHeaders: headerUpdates.map(({ header }) => header),
    updatedFields: Object.keys(valuesByHeader),
    updatedCells: Number(result?.totalUpdatedCells) || data.length
  };
}

module.exports = {
  buildAssignmentValues,
  columnName,
  createSheetAssignmentError,
  DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID,
  DEFAULT_MUSIC_PLANNING_SHEET_NAME,
  extractGoogleSheetId,
  STANDARD_ASSIGNMENT_HEADERS,
  writeServiceAssignmentsToGoogleSheet
};
