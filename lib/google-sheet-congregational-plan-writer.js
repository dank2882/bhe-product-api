"use strict";

const {
  DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID,
  DEFAULT_MUSIC_PLANNING_SHEET_NAME,
  extractGoogleSheetId
} = require("./google-sheet-service-assignment-writer");
const { resolveGoogleSheetServiceRow } = require("./google-sheet-service-row-resolver");

function createCongregationalSheetError(message, statusCode = 400, code = "congregational_sheet_write_error", details = {}) {
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

async function writeServiceCongregationalPlanToGoogleSheet(input = {}, deps = {}) {
  if (typeof deps.googleSheetsRequest !== "function" || typeof deps.createGoogleSheetBackup !== "function") {
    throw createCongregationalSheetError(
      "Google Sheets write and backup access are required",
      500,
      "google_sheet_congregational_write_not_configured"
    );
  }
  const service = input.service || {};
  if (!Number.isInteger(service.sourceRowNumber) && (!normalizeString(service.serviceDate) || !normalizeString(service.serviceType))) {
    throw createCongregationalSheetError("Service source row was not found", 409, "service_sheet_row_not_found");
  }
  const changes = Array.isArray(input.changes) ? input.changes : [];
  if (changes.length === 0) {
    throw createCongregationalSheetError("At least one congregational slot change is required", 400, "missing_song_changes");
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
    throw createCongregationalSheetError("Date/Service header row was not found", 409, "service_sheet_header_not_found");
  }
  const headerRow = Array.isArray(rows[headerRowIndex]) ? rows[headerRowIndex] : [];
  const headerColumnByName = new Map();
  headerRow.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized) headerColumnByName.set(normalized, index);
  });
  const rowResolution = resolveGoogleSheetServiceRow({ rows, headerRowIndex, headerColumnByName, service });
  const sourceRowNumber = rowResolution.sourceRowNumber;
  const data = changes.map((change) => {
    const sourceColumnName = normalizeString(change.sourceColumnName);
    const columnIndex = headerColumnByName.get(normalizeHeader(sourceColumnName));
    if (!Number.isInteger(columnIndex)) {
      throw createCongregationalSheetError(
        "Congregational column was not found in the planning sheet",
        409,
        "congregational_sheet_column_not_found",
        { sourceColumnName }
      );
    }
    const cell = `${columnName(columnIndex)}${sourceRowNumber}`;
    return {
      slot: normalizeString(change.slot),
      sourceColumnName,
      sourceCell: cell,
      update: {
        range: `${quotedSheet}!${cell}`,
        majorDimension: "ROWS",
        values: [[normalizeString(change.displayValue)]]
      }
    };
  });
  const backup = await deps.createGoogleSheetBackup({
    googleSheetId,
    sheet: sheetName,
    reason: "before_service_song_plan_write",
    serviceId: normalizeString(service.serviceId)
  }, deps);
  const result = await deps.googleSheetsRequest({
    method: "POST",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}/values:batchUpdate`,
    data: { valueInputOption: "RAW", data: data.map(({ update }) => update) }
  });
  const verificationQuery = data
    .map(({ update }) => `ranges=${encodeURIComponent(update.range)}`)
    .join("&");
  const verification = await deps.googleSheetsRequest({
    method: "GET",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}/values:batchGet?${verificationQuery}`
  });
  const valueRanges = Array.isArray(verification?.valueRanges) ? verification.valueRanges : [];
  const verifiedChanges = data.map((change, index) => {
    const actualValue = normalizeString(valueRanges[index]?.values?.[0]?.[0]);
    const expectedValue = normalizeString(change.update.values[0][0]);
    return { ...change, expectedValue, actualValue, matches: actualValue === expectedValue };
  });
  const mismatches = verifiedChanges.filter((change) => !change.matches);
  if (mismatches.length > 0) {
    throw createCongregationalSheetError(
      "Google Sheet song-plan verification failed",
      502,
      "google_sheet_song_plan_verification_failed",
      { mismatches: mismatches.map(({ slot, sourceCell, expectedValue, actualValue }) => ({ slot, sourceCell, expectedValue, actualValue })) }
    );
  }
  return {
    written: true,
    googleSheetId,
    sheetName,
    sourceRowNumber,
    rowResolution,
    backup,
    verified: true,
    updatedCells: Number(result?.totalUpdatedCells) || data.length,
    changes: verifiedChanges.map(({ update, ...change }) => change)
  };
}

module.exports = {
  createCongregationalSheetError,
  writeServiceCongregationalPlanToGoogleSheet
};
