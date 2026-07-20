"use strict";

const { parseDateService } = require("./music-planning-import-preview");

const MONTH_NUMBER_BY_NAME = new Map([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2], ["march", 3], ["mar", 3],
  ["april", 4], ["apr", 4], ["may", 5], ["june", 6], ["jun", 6], ["july", 7], ["jul", 7],
  ["august", 8], ["aug", 8], ["september", 9], ["sep", 9], ["sept", 9], ["october", 10],
  ["oct", 10], ["november", 11], ["nov", 11], ["december", 12], ["dec", 12]
]);

function createServiceRowResolutionError(message, statusCode = 409, code = "service_sheet_row_resolution_error", details = {}) {
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

function normalizeServiceType(value) {
  const token = normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["sunday_evening", "sunday_pm"].includes(token)) return "sunday_night";
  if (["wednesday_evening", "midweek", "prayer_service"].includes(token)) return "wednesday_night";
  return token;
}

function resolveGoogleSheetServiceRow({ rows = [], headerRowIndex = -1, headerColumnByName, service = {} } = {}) {
  const storedSourceRowNumber = Number.isInteger(service.sourceRowNumber) ? service.sourceRowNumber : null;
  const serviceDate = normalizeString(service.serviceDate);
  const serviceType = normalizeServiceType(service.serviceType);
  if (!serviceDate || !serviceType) {
    if (storedSourceRowNumber) {
      return { sourceRowNumber: storedSourceRowNumber, storedSourceRowNumber, provenanceCorrected: false, matchedDateService: "" };
    }
    throw createServiceRowResolutionError("Service needs date and type to resolve its live spreadsheet row", 409, "service_sheet_identity_missing");
  }
  const dateServiceColumnIndex = headerColumnByName instanceof Map
    ? headerColumnByName.get("date service")
    : null;
  if (!Number.isInteger(dateServiceColumnIndex)) {
    throw createServiceRowResolutionError("Date/Service column was not found", 409, "service_sheet_date_column_not_found");
  }
  const planningYear = Number(serviceDate.slice(0, 4));
  let currentMonthNumber = null;
  const matches = [];
  for (let rowIndex = Math.max(headerRowIndex + 1, 0); rowIndex < rows.length; rowIndex += 1) {
    const dateServiceValue = normalizeString(rows[rowIndex]?.[dateServiceColumnIndex]);
    if (!dateServiceValue || normalizeHeader(dateServiceValue) === "date service") continue;
    const monthMarker = MONTH_NUMBER_BY_NAME.get(normalizeHeader(dateServiceValue));
    if (monthMarker) {
      currentMonthNumber = monthMarker;
      continue;
    }
    const parsed = parseDateService(dateServiceValue, { currentMonthNumber, planningYear });
    if (parsed.monthNumber) currentMonthNumber = parsed.monthNumber;
    if (parsed.serviceDate === serviceDate && normalizeServiceType(parsed.serviceType) === serviceType) {
      matches.push({ sourceRowNumber: rowIndex + 1, matchedDateService: dateServiceValue });
    }
  }
  if (matches.length === 0) {
    throw createServiceRowResolutionError(
      "The service date and type were not found in the live planning sheet",
      409,
      "service_sheet_live_row_not_found",
      { serviceDate, serviceType, storedSourceRowNumber }
    );
  }
  if (matches.length > 1) {
    throw createServiceRowResolutionError(
      "More than one live spreadsheet row matches this service",
      409,
      "service_sheet_live_row_ambiguous",
      { serviceDate, serviceType, matches }
    );
  }
  return {
    ...matches[0],
    storedSourceRowNumber,
    provenanceCorrected: storedSourceRowNumber !== matches[0].sourceRowNumber
  };
}

module.exports = {
  createServiceRowResolutionError,
  normalizeServiceType,
  resolveGoogleSheetServiceRow
};
