"use strict";

const {
  DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID,
  DEFAULT_MUSIC_PLANNING_SHEET_NAME,
  extractGoogleSheetId
} = require("./google-sheet-service-assignment-writer");

const BACKUP_SHEET_PREFIX = "_BACKUP_";

function createSheetBackupError(message, statusCode = 400, code = "google_sheet_backup_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function quoteSheetName(value) {
  return `'${normalizeString(value).replace(/'/g, "''")}'`;
}

function getNow(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function buildBackupTitle(sheetName, now, label = "") {
  const timestamp = now.toISOString().replace(/[-:.]/g, "");
  const cleanSheet = normalizeString(sheetName).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const cleanLabel = normalizeString(label).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${BACKUP_SHEET_PREFIX}${cleanSheet}_${timestamp}${cleanLabel ? `_${cleanLabel}` : ""}`.slice(0, 100);
}

function columnIndexFromName(value) {
  return normalizeString(value).toUpperCase().split("").reduce((total, character) =>
    (total * 26) + character.charCodeAt(0) - 64, 0) - 1;
}

function parseBoundedA1Range(value) {
  const range = normalizeString(value).toUpperCase();
  const match = range.match(/^([A-Z]{1,3})([1-9]\d*)(?::([A-Z]{1,3})([1-9]\d*))?$/);
  if (!match) {
    throw createSheetBackupError("A bounded A1 range is required", 400, "invalid_google_sheet_range", { range: value });
  }
  const startColumnIndex = columnIndexFromName(match[1]);
  const startRowIndex = Number(match[2]) - 1;
  const endColumnIndex = columnIndexFromName(match[3] || match[1]) + 1;
  const endRowIndex = Number(match[4] || match[2]);
  if (endColumnIndex <= startColumnIndex || endRowIndex <= startRowIndex) {
    throw createSheetBackupError("Google Sheet range end must follow its start", 400, "invalid_google_sheet_range", { range });
  }
  return { range, startColumnIndex, startRowIndex, endColumnIndex, endRowIndex };
}

async function getSpreadsheetSheets(googleSheetId, deps) {
  if (typeof deps.googleSheetsRequest !== "function") {
    throw createSheetBackupError("Google Sheets access is not configured", 500, "google_sheets_backup_not_configured");
  }
  const response = await deps.googleSheetsRequest({
    method: "GET",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}?fields=sheets(properties(sheetId,title,index,hidden,gridProperties))`
  });
  return Array.isArray(response?.sheets)
    ? response.sheets.map((sheet) => sheet.properties || {}).filter((properties) => Number.isInteger(properties.sheetId))
    : [];
}

async function createGoogleSheetBackup(input = {}, deps = {}) {
  if (typeof deps.googleSheetsRequest !== "function") {
    throw createSheetBackupError("Google Sheets access is not configured", 500, "google_sheets_backup_not_configured");
  }
  const googleSheetId = extractGoogleSheetId(
    input.googleSheetId || input.googleSheetUrl || DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID
  );
  const sheetName = normalizeString(input.sheet) || DEFAULT_MUSIC_PLANNING_SHEET_NAME;
  const now = getNow(deps);
  const sheets = await getSpreadsheetSheets(googleSheetId, deps);
  const source = sheets.find((sheet) => sheet.title === sheetName);
  if (!source) {
    throw createSheetBackupError("Source sheet was not found", 404, "google_sheet_backup_source_not_found", {
      googleSheetId,
      sheetName
    });
  }
  const copied = await deps.googleSheetsRequest({
    method: "POST",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}/sheets/${source.sheetId}:copyTo`,
    data: { destinationSpreadsheetId: googleSheetId }
  });
  if (!Number.isInteger(copied?.sheetId)) {
    throw createSheetBackupError("Google Sheets did not return the copied sheet ID", 502, "google_sheet_backup_copy_failed");
  }
  const backupTitle = buildBackupTitle(sheetName, now, input.label || input.reason);
  await deps.googleSheetsRequest({
    method: "POST",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}:batchUpdate`,
    data: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: copied.sheetId, title: backupTitle, hidden: true },
          fields: "title,hidden"
        }
      }]
    }
  });
  return {
    created: true,
    googleSheetId,
    sourceSheetId: source.sheetId,
    sourceSheetName: sheetName,
    backupSheetId: copied.sheetId,
    backupTitle,
    hidden: true,
    createdAt: now.toISOString(),
    reason: normalizeString(input.reason),
    serviceId: normalizeString(input.serviceId)
  };
}

async function listGoogleSheetBackups(input = {}, deps = {}) {
  const googleSheetId = extractGoogleSheetId(
    input.googleSheetId || input.googleSheetUrl || DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID
  );
  const limitValue = Number(input.limit);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 200) : 25;
  const sheets = await getSpreadsheetSheets(googleSheetId, deps);
  const backups = sheets
    .filter((sheet) => normalizeString(sheet.title).startsWith(BACKUP_SHEET_PREFIX))
    .sort((left, right) => normalizeString(right.title).localeCompare(normalizeString(left.title)))
    .slice(0, limit)
    .map((sheet) => ({
      backupSheetId: sheet.sheetId,
      backupTitle: sheet.title,
      hidden: sheet.hidden === true,
      index: sheet.index,
      gridProperties: sheet.gridProperties || {}
    }));
  return { googleSheetId, count: backups.length, backups };
}

async function readGoogleSheetRange(input = {}, deps = {}) {
  const googleSheetId = extractGoogleSheetId(
    input.googleSheetId || input.googleSheetUrl || DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID
  );
  const sheetName = normalizeString(input.sheet) || DEFAULT_MUSIC_PLANNING_SHEET_NAME;
  const range = normalizeString(input.range);
  if (!/^[A-Z]{1,3}[1-9]\d*(?::[A-Z]{1,3}[1-9]\d*)?$/i.test(range)) {
    throw createSheetBackupError("A bounded A1 range is required", 400, "invalid_google_sheet_range", { range });
  }
  if (typeof deps.googleSheetsRequest !== "function") {
    throw createSheetBackupError("Google Sheets access is not configured", 500, "google_sheets_backup_not_configured");
  }
  const qualifiedRange = `${quoteSheetName(sheetName)}!${range.toUpperCase()}`;
  const response = await deps.googleSheetsRequest({
    method: "GET",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}/values/${encodeURIComponent(qualifiedRange)}`
  });
  return {
    googleSheetId,
    sheetName,
    requestedRange: range.toUpperCase(),
    returnedRange: normalizeString(response?.range),
    values: Array.isArray(response?.values) ? response.values : []
  };
}

async function restoreGoogleSheetBackup(input = {}, deps = {}) {
  if (input.confirmed !== true) {
    throw createSheetBackupError(
      "Restoring a spreadsheet backup requires explicit confirmation",
      400,
      "spreadsheet_restore_confirmation_required"
    );
  }
  const googleSheetId = extractGoogleSheetId(
    input.googleSheetId || input.googleSheetUrl || DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID
  );
  const sheetName = normalizeString(input.sheet) || DEFAULT_MUSIC_PLANNING_SHEET_NAME;
  const sheets = await getSpreadsheetSheets(googleSheetId, deps);
  const destination = sheets.find((sheet) => sheet.title === sheetName);
  const requestedSheetId = Number(input.backupSheetId);
  const requestedTitle = normalizeString(input.backupTitle);
  const source = sheets.find((sheet) =>
    (Number.isInteger(requestedSheetId) && sheet.sheetId === requestedSheetId) ||
    (requestedTitle && sheet.title === requestedTitle)
  );
  if (!destination) {
    throw createSheetBackupError("Destination sheet was not found", 404, "google_sheet_restore_destination_not_found", { sheetName });
  }
  if (!source || !normalizeString(source.title).startsWith(BACKUP_SHEET_PREFIX)) {
    throw createSheetBackupError("Backup sheet was not found", 404, "google_sheet_restore_backup_not_found", {
      backupSheetId: input.backupSheetId,
      backupTitle: input.backupTitle
    });
  }
  const safetyBackup = await createGoogleSheetBackup({
    googleSheetId,
    sheet: sheetName,
    reason: "pre_restore",
    serviceId: normalizeString(input.serviceId)
  }, deps);
  const sourceRows = Number(source.gridProperties?.rowCount) || 1000;
  const sourceColumns = Number(source.gridProperties?.columnCount) || 26;
  const destinationRows = Number(destination.gridProperties?.rowCount) || 1000;
  const destinationColumns = Number(destination.gridProperties?.columnCount) || 26;
  const requests = [];
  if (destinationRows < sourceRows || destinationColumns < sourceColumns) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: destination.sheetId,
          gridProperties: {
            rowCount: Math.max(destinationRows, sourceRows),
            columnCount: Math.max(destinationColumns, sourceColumns)
          }
        },
        fields: "gridProperties(rowCount,columnCount)"
      }
    });
  }
  requests.push({
    copyPaste: {
      source: {
        sheetId: source.sheetId,
        startRowIndex: 0,
        endRowIndex: sourceRows,
        startColumnIndex: 0,
        endColumnIndex: sourceColumns
      },
      destination: {
        sheetId: destination.sheetId,
        startRowIndex: 0,
        endRowIndex: sourceRows,
        startColumnIndex: 0,
        endColumnIndex: sourceColumns
      },
      pasteType: "PASTE_NORMAL",
      pasteOrientation: "NORMAL"
    }
  });
  await deps.googleSheetsRequest({
    method: "POST",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}:batchUpdate`,
    data: { requests }
  });
  return {
    restored: true,
    googleSheetId,
    destinationSheetId: destination.sheetId,
    destinationSheetName: destination.title,
    restoredFrom: { backupSheetId: source.sheetId, backupTitle: source.title },
    safetyBackup
  };
}

async function restoreGoogleSheetRange(input = {}, deps = {}) {
  if (input.confirmed !== true) {
    throw createSheetBackupError(
      "Restoring a spreadsheet range requires explicit confirmation",
      400,
      "spreadsheet_restore_confirmation_required"
    );
  }
  const googleSheetId = extractGoogleSheetId(
    input.googleSheetId || input.googleSheetUrl || DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID
  );
  const sheetName = normalizeString(input.sheet) || DEFAULT_MUSIC_PLANNING_SHEET_NAME;
  const parsedRange = parseBoundedA1Range(input.range);
  const sheets = await getSpreadsheetSheets(googleSheetId, deps);
  const destination = sheets.find((sheet) => sheet.title === sheetName);
  const requestedSheetId = Number(input.backupSheetId);
  const requestedTitle = normalizeString(input.backupTitle);
  const source = sheets.find((sheet) =>
    (Number.isInteger(requestedSheetId) && sheet.sheetId === requestedSheetId) ||
    (requestedTitle && sheet.title === requestedTitle)
  );
  if (!destination) {
    throw createSheetBackupError("Destination sheet was not found", 404, "google_sheet_restore_destination_not_found", { sheetName });
  }
  if (!source || !normalizeString(source.title).startsWith(BACKUP_SHEET_PREFIX)) {
    throw createSheetBackupError("Backup sheet was not found", 404, "google_sheet_restore_backup_not_found", {
      backupSheetId: input.backupSheetId,
      backupTitle: input.backupTitle
    });
  }
  const safetyBackup = await createGoogleSheetBackup({
    googleSheetId,
    sheet: sheetName,
    reason: "pre_range_restore"
  }, deps);
  const gridRange = {
    startRowIndex: parsedRange.startRowIndex,
    endRowIndex: parsedRange.endRowIndex,
    startColumnIndex: parsedRange.startColumnIndex,
    endColumnIndex: parsedRange.endColumnIndex
  };
  await deps.googleSheetsRequest({
    method: "POST",
    path: `/v4/spreadsheets/${encodeURIComponent(googleSheetId)}:batchUpdate`,
    data: {
      requests: [{
        copyPaste: {
          source: { sheetId: source.sheetId, ...gridRange },
          destination: { sheetId: destination.sheetId, ...gridRange },
          pasteType: "PASTE_NORMAL",
          pasteOrientation: "NORMAL"
        }
      }]
    }
  });
  const [sourceRead, destinationRead] = await Promise.all([
    readGoogleSheetRange({ googleSheetId, sheet: source.title, range: parsedRange.range }, deps),
    readGoogleSheetRange({ googleSheetId, sheet: destination.title, range: parsedRange.range }, deps)
  ]);
  if (JSON.stringify(sourceRead.values) !== JSON.stringify(destinationRead.values)) {
    throw createSheetBackupError(
      "Restored spreadsheet range did not match its backup",
      502,
      "google_sheet_range_restore_verification_failed",
      { range: parsedRange.range, sourceValues: sourceRead.values, destinationValues: destinationRead.values }
    );
  }
  return {
    restored: true,
    verified: true,
    googleSheetId,
    range: parsedRange.range,
    destinationSheetName: destination.title,
    restoredFrom: { backupSheetId: source.sheetId, backupTitle: source.title },
    values: destinationRead.values,
    safetyBackup
  };
}

module.exports = {
  BACKUP_SHEET_PREFIX,
  buildBackupTitle,
  createGoogleSheetBackup,
  createSheetBackupError,
  listGoogleSheetBackups,
  parseBoundedA1Range,
  readGoogleSheetRange,
  restoreGoogleSheetBackup,
  restoreGoogleSheetRange
};
