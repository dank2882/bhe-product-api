"use strict";

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SOURCE_SHEET_NAME = "PROPOSED SCHEDULES";
const DEFAULT_PLANNING_YEAR = 2026;

const MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12]
]);

const MONTH_NAME_BY_NUMBER = new Map([
  [1, "January"],
  [2, "February"],
  [3, "March"],
  [4, "April"],
  [5, "May"],
  [6, "June"],
  [7, "July"],
  [8, "August"],
  [9, "September"],
  [10, "October"],
  [11, "November"],
  [12, "December"]
]);

const MUSIC_SLOT_DEFINITIONS = [
  {
    header: "Congregational #1",
    key: "congregational_1",
    usageRole: "congregational",
    slotIndex: 10,
    titleConfidence: "high"
  },
  {
    header: "Congregational #2",
    key: "congregational_2",
    usageRole: "congregational",
    slotIndex: 20,
    titleConfidence: "high"
  },
  {
    header: "Congregational #3",
    key: "congregational_3",
    usageRole: "congregational",
    slotIndex: 30,
    titleConfidence: "high"
  },
  {
    header: "Choir Opener",
    key: "choir_opener",
    usageRole: "choir_opener",
    slotIndex: 40,
    titleConfidence: "high"
  },
  {
    header: "Choir Special",
    key: "choir_special",
    usageRole: "choir_special",
    slotIndex: 50,
    titleConfidence: "high"
  },
  {
    header: "Special #1",
    key: "special_1",
    usageRole: "special_music",
    slotIndex: 60,
    titleConfidence: "low"
  },
  {
    header: "Special #2",
    key: "special_2",
    usageRole: "special_music",
    slotIndex: 70,
    titleConfidence: "low"
  },
  {
    header: "Offertory",
    key: "offertory",
    usageRole: "offertory",
    slotIndex: 80,
    titleConfidence: "low"
  }
];

const DEFAULT_SERVICE_LABELS = new Set(["AM", "PM", "Prayer Service"]);
const ASSIGNMENT_FIRST_USAGE_ROLES = new Set(["special_music", "offertory"]);
const MESSAGE_COLUMN_DEFINITIONS = [
  {
    key: "speakerName",
    aliases: ["speaker", "speaker name", "preacher", "preacher name", "message speaker", "sermon speaker"]
  },
  {
    key: "scriptureText",
    aliases: ["message text", "sermon text", "scripture", "scripture text", "bible text"]
  },
  {
    key: "sermonTitle",
    aliases: ["message title", "sermon title"]
  },
  {
    key: "topic",
    aliases: ["message topic", "sermon topic", "topic"]
  },
  {
    key: "notes",
    aliases: ["message notes", "sermon notes", "speaker notes", "notes"]
  },
  {
    key: "notesUrl",
    aliases: ["message notes url", "sermon notes url", "speaker notes url", "notes url", "notes link"]
  }
];

function normalizeString(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeHeader(value) {
  return normalizeString(value).toLowerCase();
}

function slugify(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttributes(source) {
  const attrs = {};
  const attrPattern = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match;

  while ((match = attrPattern.exec(source)) !== null) {
    attrs[match[1]] = decodeXml(match[2]);
  }

  return attrs;
}

function columnNameToIndex(columnName) {
  let result = 0;

  for (const char of columnName) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }

  return result;
}

function columnIndexToName(index) {
  let value = index;
  let result = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }

  return result;
}

function parseCellReference(reference) {
  const match = String(reference || "").match(/^([A-Z]+)(\d+)$/);

  if (!match) {
    return null;
  }

  return {
    rowNumber: Number.parseInt(match[2], 10),
    columnIndex: columnNameToIndex(match[1]),
    columnName: match[1]
  };
}

function readZipEntry(workbookPath, entryName) {
  try {
    return execFileSync("unzip", ["-p", workbookPath, entryName], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024
    });
  } catch (error) {
    throw new Error(`Unable to read ${entryName} from workbook: ${error.message}`);
  }
}

function getXmlTextParts(source) {
  const parts = [];
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match;

  while ((match = textPattern.exec(source)) !== null) {
    parts.push(decodeXml(match[1]));
  }

  return parts;
}

function parseSharedStrings(workbookPath) {
  let xml = "";

  try {
    xml = readZipEntry(workbookPath, "xl/sharedStrings.xml");
  } catch {
    return [];
  }

  const strings = [];
  const stringPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;

  while ((match = stringPattern.exec(xml)) !== null) {
    strings.push(getXmlTextParts(match[1]).join(""));
  }

  return strings;
}

function parseWorkbookSheets(workbookPath) {
  const workbookXml = readZipEntry(workbookPath, "xl/workbook.xml");
  const relsXml = readZipEntry(workbookPath, "xl/_rels/workbook.xml.rels");
  const relationships = new Map();
  const relPattern = /<Relationship\b([^>]*)\/>/g;
  let relMatch;

  while ((relMatch = relPattern.exec(relsXml)) !== null) {
    const attrs = parseAttributes(relMatch[1]);
    if (attrs.Id && attrs.Target) {
      relationships.set(attrs.Id, attrs.Target);
    }
  }

  const sheets = [];
  const sheetPattern = /<sheet\b([^>]*)\/>/g;
  let sheetMatch;

  while ((sheetMatch = sheetPattern.exec(workbookXml)) !== null) {
    const attrs = parseAttributes(sheetMatch[1]);
    const relId = attrs["r:id"];
    const target = relationships.get(relId);

    if (!attrs.name || !target) {
      continue;
    }

    const sheetPath = target.startsWith("/")
      ? target.replace(/^\//, "")
      : `xl/${target}`;

    sheets.push({
      name: attrs.name,
      path: sheetPath
    });
  }

  return sheets;
}

function parseWorksheetRows(workbookPath, sheetPath, sharedStrings) {
  const xml = readZipEntry(workbookPath, sheetPath);
  const rowsByNumber = new Map();
  const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let match;
  let maxRow = 0;
  let maxColumn = 0;

  while ((match = cellPattern.exec(xml)) !== null) {
    const attrs = parseAttributes(match[1]);
    const reference = parseCellReference(attrs.r);

    if (!reference) {
      continue;
    }

    const body = match[2] || "";
    let value = "";

    if (attrs.t === "s") {
      const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      if (valueMatch) {
        const index = Number.parseInt(valueMatch[1], 10);
        value = sharedStrings[index] || "";
      }
    } else if (attrs.t === "inlineStr") {
      value = getXmlTextParts(body).join("");
    } else {
      const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      value = valueMatch ? decodeXml(valueMatch[1]) : "";
    }

    value = normalizeString(value);

    if (!value) {
      continue;
    }

    if (!rowsByNumber.has(reference.rowNumber)) {
      rowsByNumber.set(reference.rowNumber, {
        rowNumber: reference.rowNumber,
        cells: {}
      });
    }

    rowsByNumber.get(reference.rowNumber).cells[reference.columnIndex] = {
      value,
      sourceCell: `${reference.columnName}${reference.rowNumber}`,
      columnIndex: reference.columnIndex,
      columnName: reference.columnName
    };

    maxRow = Math.max(maxRow, reference.rowNumber);
    maxColumn = Math.max(maxColumn, reference.columnIndex);
  }

  return {
    rows: Array.from(rowsByNumber.values()).sort((a, b) => a.rowNumber - b.rowNumber),
    maxRow,
    maxColumn
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function worksheetFromCsvText({
  csvText,
  sheetName = DEFAULT_SOURCE_SHEET_NAME,
  workbookPath = "",
  sheetNames = [sheetName]
}) {
  const csvRows = parseCsvRows(csvText);
  const rows = [];
  let maxColumn = 0;

  for (let rowIndex = 0; rowIndex < csvRows.length; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const cells = {};

    for (let columnOffset = 0; columnOffset < csvRows[rowIndex].length; columnOffset += 1) {
      const value = normalizeString(csvRows[rowIndex][columnOffset]);

      if (!value) {
        continue;
      }

      const columnIndex = columnOffset + 1;
      const columnName = columnIndexToName(columnIndex);
      cells[columnIndex] = {
        value,
        sourceCell: `${columnName}${rowNumber}`,
        columnIndex,
        columnName
      };
      maxColumn = Math.max(maxColumn, columnIndex);
    }

    if (Object.keys(cells).length > 0) {
      rows.push({
        rowNumber,
        cells
      });
    }
  }

  return {
    workbookPath,
    sheetName,
    sheetNames,
    rows,
    maxRow: csvRows.length,
    maxColumn
  };
}

function readXlsxWorksheet({ workbookPath, sheetName = DEFAULT_SOURCE_SHEET_NAME }) {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }

  const sharedStrings = parseSharedStrings(workbookPath);
  const sheets = parseWorkbookSheets(workbookPath);
  const sheet = sheets.find((candidate) => candidate.name === sheetName);

  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const worksheet = parseWorksheetRows(workbookPath, sheet.path, sharedStrings);

  return {
    workbookPath,
    sheetName,
    sheetNames: sheets.map((candidate) => candidate.name),
    ...worksheet
  };
}

function hashFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getSingleCellValue(row) {
  const values = Object.values(row.cells).map((cell) => cell.value).filter(Boolean);
  return values.length === 1 ? values[0] : "";
}

function isMonthHeaderRow(row) {
  const value = normalizeString(getSingleCellValue(row)).toLowerCase();
  return MONTHS.has(value);
}

function getMonthNumber(value) {
  const cleanValue = normalizeString(value).toLowerCase();
  return MONTHS.get(cleanValue) || null;
}

function getHeaderMap(row) {
  const headers = {};

  for (const cell of Object.values(row.cells)) {
    const normalizedHeader = normalizeHeader(cell.value);
    if (normalizedHeader) {
      headers[normalizedHeader] = cell.columnIndex;
    }
  }

  if (!headers["date/service"]) {
    return null;
  }

  const slotColumns = {};
  const messageColumns = {};

  for (const slot of MUSIC_SLOT_DEFINITIONS) {
    const columnIndex = headers[normalizeHeader(slot.header)];
    if (columnIndex) {
      slotColumns[slot.key] = columnIndex;
    }
  }

  for (const definition of MESSAGE_COLUMN_DEFINITIONS) {
    const normalizedAliases = definition.aliases.map((alias) => normalizeHeader(alias));
    const matchedAlias = normalizedAliases.find((alias) => headers[alias]);
    if (matchedAlias) {
      messageColumns[definition.key] = headers[matchedAlias];
    }
  }

  return {
    dateServiceColumn: headers["date/service"],
    themeColumn: headers.theme || 1,
    slotColumns,
    messageColumns
  };
}

function findMonthInText(value) {
  const cleanValue = normalizeString(value).toLowerCase();
  const match = cleanValue.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
  return match ? MONTHS.get(match[1]) : null;
}

function getDateParts(dateServiceText, currentMonthNumber, planningYear = DEFAULT_PLANNING_YEAR) {
  const cleanValue = normalizeString(dateServiceText);
  const monthNumber = findMonthInText(cleanValue) || currentMonthNumber;
  const dayMatch = cleanValue.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)?\s*(\d{1,2})(?:st|nd|rd|th)?\b/i);

  if (!monthNumber || !dayMatch) {
    return {
      serviceDate: "",
      monthNumber,
      dayNumber: null,
      warning: "Unable to parse service date."
    };
  }

  const dayNumber = Number.parseInt(dayMatch[1], 10);
  const date = new Date(Date.UTC(planningYear, monthNumber - 1, dayNumber));

  if (
    date.getUTCFullYear() !== planningYear ||
    date.getUTCMonth() !== monthNumber - 1 ||
    date.getUTCDate() !== dayNumber
  ) {
    return {
      serviceDate: "",
      monthNumber,
      dayNumber,
      warning: "Parsed date is not a valid calendar date."
    };
  }

  return {
    serviceDate: `${planningYear}-${pad2(monthNumber)}-${pad2(dayNumber)}`,
    monthNumber,
    dayNumber,
    warning: ""
  };
}

function getParentheticalLabels(value) {
  const labels = [];
  const pattern = /\(([^()]+)\)/g;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    const label = normalizeString(match[1]);
    if (label) {
      labels.push(label);
    }
  }

  return labels;
}

function parseServiceTypeAndTitle(dateServiceText) {
  const cleanValue = normalizeString(dateServiceText);
  const labels = getParentheticalLabels(cleanValue);
  const hasAm = /\bAM\b/i.test(cleanValue);
  const hasPm = /\bPM\b/i.test(cleanValue);
  const hasPrayer = /prayer service/i.test(cleanValue);

  if (hasPrayer) {
    return {
      serviceType: "prayer_service",
      title: "Prayer Service",
      labels: Array.from(new Set(["Prayer Service", ...labels])),
      warning: ""
    };
  }

  if (hasAm) {
    return {
      serviceType: "sunday_morning",
      title: "Morning Service",
      labels: Array.from(new Set(["AM", ...labels])),
      warning: ""
    };
  }

  if (hasPm) {
    return {
      serviceType: "sunday_evening",
      title: "Evening Service",
      labels: Array.from(new Set(["PM", ...labels])),
      warning: ""
    };
  }

  if (labels.length > 0) {
    return {
      serviceType: "special_event",
      title: labels[0],
      labels,
      warning: ""
    };
  }

  return {
    serviceType: "unknown",
    title: "Service",
    labels,
    warning: "Unable to derive service type from Date/Service."
  };
}

function parseDateService(dateServiceText, {
  currentMonthNumber = null,
  planningYear = DEFAULT_PLANNING_YEAR
} = {}) {
  const cleanValue = normalizeString(dateServiceText);
  const dateParts = getDateParts(cleanValue, currentMonthNumber, planningYear);
  const typeAndTitle = parseServiceTypeAndTitle(cleanValue);
  const warnings = [];

  if (dateParts.warning) {
    warnings.push(dateParts.warning);
  }

  if (typeAndTitle.warning) {
    warnings.push(typeAndTitle.warning);
  }

  return {
    rawDateService: cleanValue,
    serviceDate: dateParts.serviceDate,
    planningYear,
    monthNumber: dateParts.monthNumber,
    monthName: dateParts.monthNumber ? MONTH_NAME_BY_NUMBER.get(dateParts.monthNumber) : "",
    dayNumber: dateParts.dayNumber,
    serviceType: typeAndTitle.serviceType,
    title: typeAndTitle.title,
    serviceLabels: typeAndTitle.labels,
    warnings
  };
}

function parseHymnalNumber(value) {
  const match = normalizeString(value).match(/(?:^|\s)#\s*(\d{1,4})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function removeLeadingHymnalNumber(value) {
  return normalizeString(value).replace(/^#\s*\d{1,4}\s*/, "").trim();
}

function parseMusicSlotValue(rawValue, slotDefinition) {
  const rawText = normalizeString(rawValue);
  const hymnalNumber = parseHymnalNumber(rawText);
  const cleanedTitle = removeLeadingHymnalNumber(rawText);
  const isAssignmentFirst = ASSIGNMENT_FIRST_USAGE_ROLES.has(slotDefinition.usageRole);
  const warnings = [];
  let songTitleCandidate = cleanedTitle;
  let assignedPersonOrGroupRaw = "";
  let songTitleConfidence = slotDefinition.titleConfidence;
  let detailNote = "";

  if (slotDefinition.usageRole !== "congregational") {
    const assignmentMatch = cleanedTitle.match(/^(.+?)\s*\(([^()]+)\)\s*$/);

    if (assignmentMatch) {
      assignedPersonOrGroupRaw = normalizeString(assignmentMatch[1]);
      const parenthetical = normalizeString(assignmentMatch[2]);

      if (isDetailNoteParenthetical(parenthetical)) {
        songTitleCandidate = isAssignmentFirst ? "" : assignedPersonOrGroupRaw;
        detailNote = parenthetical;
        songTitleConfidence = isAssignmentFirst ? "low" : slotDefinition.titleConfidence;
        warnings.push({
          code: "special_music_detail_note_only",
          severity: "review",
          message: "Parenthetical value appears to be a detail note rather than a song title."
        });
      } else {
        if (isAssignmentFirst) {
          songTitleCandidate = parenthetical;
          songTitleConfidence = "medium";
          warnings.push({
            code: "ambiguous_special_music_cell",
            severity: "review",
            message: "Non-congregational music cell was split as performer/group plus parenthetical title; review before matching."
          });
        } else {
          songTitleCandidate = assignedPersonOrGroupRaw;
          assignedPersonOrGroupRaw = parenthetical;
          songTitleConfidence = slotDefinition.titleConfidence;
        }
      }
    } else if (isAssignmentFirst) {
      assignedPersonOrGroupRaw = cleanedTitle;
      songTitleCandidate = "";
      songTitleConfidence = "low";
      warnings.push({
        code: "special_music_assignment_only",
        severity: "review",
        message: "Special/offertory cell appears to be a performer/group assignment rather than a song title."
      });
    }
  }

  return {
    rawValue: rawText,
    rawText,
    songTitleCandidate,
    songTitle: songTitleCandidate,
    hymnalNumber,
    assignedPersonOrGroupRaw,
    songTitleConfidence,
    titleConfidence: songTitleConfidence,
    detailNote,
    warnings
  };
}

function isDetailNoteParenthetical(value) {
  const cleanValue = normalizeString(value);

  return /^(?:k|pre-k|\d{1,2})\s*[-–]\s*\d{1,2}$/i.test(cleanValue) ||
    /^(?:grade|grades)\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?$/i.test(cleanValue);
}

function buildPreviewServiceId({ serviceDate, serviceType, rowNumber }) {
  const datePart = serviceDate || `row-${rowNumber}`;
  const typePart = slugify(serviceType || "unknown");
  return `preview-svc-${datePart}-${typePart}-r${rowNumber}`;
}

function buildPreviewSongEventId({ serviceId, slotKey, sourceRowNumber }) {
  return `${serviceId}-${slugify(slotKey)}-r${sourceRowNumber}`;
}

function createWarning({
  code,
  severity = "review",
  message,
  sourceSheetName,
  sourceRowNumber = null,
  sourceColumnName = "",
  sourceCell = ""
}) {
  return {
    code,
    severity,
    message,
    sourceSheetName,
    sourceRowNumber,
    sourceColumnName,
    sourceCell
  };
}

function getCell(row, columnIndex) {
  return columnIndex ? row.cells[columnIndex] : undefined;
}

function countBy(items, getKey) {
  return items.reduce((result, item) => {
    const key = getKey(item) || "(blank)";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function getServicePlanningSignals({ parsedService, theme, message, rowSlotCount }) {
  const signals = [];

  if (rowSlotCount > 0) {
    signals.push("planned_music_slot");
  }

  if (theme) {
    signals.push("theme");
  }

  if (message && Object.keys(message).length > 0) {
    signals.push("message");
  }

  const explicitLabels = parsedService.serviceLabels.filter((label) => !DEFAULT_SERVICE_LABELS.has(label));

  if (explicitLabels.length > 0) {
    signals.push("explicit_service_label");
  }

  return signals;
}

function getServiceMessage(row, messageColumns = {}) {
  const message = {};
  const sourceCells = {};

  for (const definition of MESSAGE_COLUMN_DEFINITIONS) {
    const columnIndex = messageColumns[definition.key];
    const cell = getCell(row, columnIndex);
    const value = normalizeString(cell && cell.value);

    if (value) {
      message[definition.key] = value;
      sourceCells[definition.key] = cell.sourceCell;
    }
  }

  if (Object.keys(message).length === 0) {
    return null;
  }

  return {
    ...message,
    sourceCells
  };
}

function buildPlanningPreviewFromWorksheetRows({
  worksheet,
  planningYear = DEFAULT_PLANNING_YEAR,
  sourceName = "Music Ministry - Master Data",
  sourceType = "spreadsheet_export",
  sourceWorkbookName = "",
  sourceFileHash = ""
}) {
  const importableServices = [];
  const skippedServiceShells = [];
  const serviceSongEvents = [];
  const warnings = [];
  const sheetName = worksheet.sheetName || DEFAULT_SOURCE_SHEET_NAME;
  let currentMonthNumber = null;
  let activeHeader = null;
  let skippedHeaderRows = 0;
  let skippedMonthRows = 0;

  for (const row of worksheet.rows) {
    if (isMonthHeaderRow(row)) {
      currentMonthNumber = getMonthNumber(getSingleCellValue(row));
      skippedMonthRows += 1;
      continue;
    }

    const nextHeader = getHeaderMap(row);
    if (nextHeader) {
      activeHeader = nextHeader;
      skippedHeaderRows += 1;
      continue;
    }

    if (!activeHeader) {
      continue;
    }

    const dateServiceCell = getCell(row, activeHeader.dateServiceColumn);

    if (!dateServiceCell) {
      continue;
    }

    const parsedService = parseDateService(dateServiceCell.value, {
      currentMonthNumber,
      planningYear
    });
    const themeCell = getCell(row, activeHeader.themeColumn);
    const theme = normalizeString(themeCell && themeCell.value);
    const message = getServiceMessage(row, activeHeader.messageColumns);
    const serviceId = buildPreviewServiceId({
      serviceDate: parsedService.serviceDate,
      serviceType: parsedService.serviceType,
      rowNumber: row.rowNumber
    });
    const serviceWarningCodes = [];

    for (const warningMessage of parsedService.warnings) {
      const code = warningMessage.toLowerCase().includes("date")
        ? "service_date_parse_warning"
        : "service_type_parse_warning";
      const severity = code === "service_date_parse_warning" ? "error" : "review";
      serviceWarningCodes.push(code);
      warnings.push(createWarning({
        code,
        severity,
        message: warningMessage,
        sourceSheetName: sheetName,
        sourceRowNumber: row.rowNumber,
        sourceColumnName: "Date/Service",
        sourceCell: dateServiceCell.sourceCell
      }));
    }

    const service = {
      previewServiceId: serviceId,
      serviceDate: parsedService.serviceDate,
      serviceType: parsedService.serviceType,
      title: parsedService.title,
      theme,
      serviceLabels: parsedService.serviceLabels,
      planningStatus: "planned",
      sourceType,
      sourceName,
      sourceSheetName: sheetName,
      sourceRowNumber: row.rowNumber,
      sourceCell: dateServiceCell.sourceCell,
      rawDateService: parsedService.rawDateService,
      planningSignals: [],
      warningCodes: serviceWarningCodes
    };

    if (message) {
      service.message = message;
    }

    let rowSlotCount = 0;
    const rowServiceSongEvents = [];

    for (const slotDefinition of MUSIC_SLOT_DEFINITIONS) {
      const columnIndex = activeHeader.slotColumns[slotDefinition.key];
      const slotCell = getCell(row, columnIndex);

      if (!slotCell || !normalizeString(slotCell.value)) {
        continue;
      }

      rowSlotCount += 1;
      const parsedSlot = parseMusicSlotValue(slotCell.value, slotDefinition);
      const previewEventId = buildPreviewSongEventId({
        serviceId,
        slotKey: slotDefinition.key,
        sourceRowNumber: row.rowNumber
      });
      const warningCodes = [];

      for (const slotWarning of parsedSlot.warnings) {
        warningCodes.push(slotWarning.code);
        warnings.push(createWarning({
          code: slotWarning.code,
          severity: slotWarning.severity,
          message: slotWarning.message,
          sourceSheetName: sheetName,
          sourceRowNumber: row.rowNumber,
          sourceColumnName: slotDefinition.header,
          sourceCell: slotCell.sourceCell
        }));
      }

      rowServiceSongEvents.push({
        previewServiceSongEventId: previewEventId,
        previewServiceId: serviceId,
        serviceDate: parsedService.serviceDate,
        serviceType: parsedService.serviceType,
        slotIndex: slotDefinition.slotIndex,
        plannedSequence: slotDefinition.slotIndex,
        usageRole: slotDefinition.usageRole,
        sourceColumnName: slotDefinition.header,
        sourceColumnKey: slotDefinition.key,
        sourceRowNumber: row.rowNumber,
        sourceCell: slotCell.sourceCell,
        rawValue: parsedSlot.rawValue,
        songTitleCandidate: parsedSlot.songTitleCandidate,
        songTitle: parsedSlot.songTitle,
        songTitleRaw: parsedSlot.rawText,
        songTitleConfidence: parsedSlot.songTitleConfidence,
        titleConfidence: parsedSlot.titleConfidence,
        hymnalNumber: parsedSlot.hymnalNumber,
        assignedPersonOrGroupRaw: parsedSlot.assignedPersonOrGroupRaw,
        detailNote: parsedSlot.detailNote,
        songId: null,
        planningStatus: "planned",
        actualStatus: "unknown",
        changedAfterPlan: false,
        sourceType,
        sourceName,
        sourceSheetName: sheetName,
        warningCodes
      });
    }

    service.planningSignals = getServicePlanningSignals({
      parsedService,
      theme,
      message,
      rowSlotCount
    });

    if (service.planningSignals.length > 0) {
      importableServices.push(service);
      serviceSongEvents.push(...rowServiceSongEvents);
    } else {
      skippedServiceShells.push({
        ...service,
        importable: false,
        skipReason: "date_service_only_no_planning_signal"
      });
    }
  }

  const servicesWithMusicSlots = importableServices.filter((service) =>
    service.planningSignals.includes("planned_music_slot")
  ).length;
  const importableServicesWithoutMusicSlots = importableServices.length - servicesWithMusicSlots;
  const importableServicesWithMessage = importableServices.filter((service) =>
    service.planningSignals.includes("message")
  ).length;

  if (skippedServiceShells.length > 0) {
    warnings.push(createWarning({
      code: "skipped_service_shells",
      severity: "info",
      message: `${skippedServiceShells.length} date/service-only rows were reported as skipped service shells.`,
      sourceSheetName: sheetName
    }));
  }

  const summary = {
    serviceRowsDetected: importableServices.length + skippedServiceShells.length,
    importableServicesDetected: importableServices.length,
    skippedServiceShellsDetected: skippedServiceShells.length,
    importableServicesWithMusicSlots: servicesWithMusicSlots,
    importableServicesWithoutMusicSlots,
    importableServicesWithMessage,
    songMusicSlotsDetected: serviceSongEvents.length,
    warningsCount: warnings.length,
    warningsBySeverity: countBy(warnings, (warning) => warning.severity),
    warningsByCode: countBy(warnings, (warning) => warning.code),
    importableServicesByType: countBy(importableServices, (service) => service.serviceType),
    skippedServiceShellsByType: countBy(skippedServiceShells, (service) => service.serviceType),
    musicSlotsByRole: countBy(serviceSongEvents, (event) => event.usageRole),
    musicSlotsByColumn: countBy(serviceSongEvents, (event) => event.sourceColumnName),
    musicSlotsByTitleConfidence: countBy(serviceSongEvents, (event) => event.songTitleConfidence || event.titleConfidence),
    skippedServiceShellsByReason: countBy(skippedServiceShells, (service) => service.skipReason)
  };

  const sourceImportPreview = {
    sourceType,
    sourceName,
    sourceWorkbookName,
    sourceFileHash,
    sourceSheetName: sheetName,
    importMode: "preview",
    planningStatusDefault: "planned",
    actualStatusDefault: "unknown",
    planningYear,
    rowCountInspected: worksheet.maxRow || worksheet.rows.length,
    nonEmptyRowsInspected: worksheet.rows.length,
    skippedMonthRows,
    skippedHeaderRows,
    serviceRowsDetected: summary.serviceRowsDetected,
    servicesDetected: importableServices.length,
    importableServicesDetected: importableServices.length,
    skippedServiceShellsDetected: skippedServiceShells.length,
    importableServicesWithMusicSlots: servicesWithMusicSlots,
    importableServicesWithoutMusicSlots,
    importableServicesWithMessage,
    songMusicSlotsDetected: serviceSongEvents.length,
    warningsCount: warnings.length
  };

  return {
    sourceImportPreview,
    importableServices,
    skippedServiceShells,
    serviceSongEvents,
    warnings,
    summary
  };
}

module.exports = {
  DEFAULT_PLANNING_YEAR,
  DEFAULT_SOURCE_SHEET_NAME,
  MUSIC_SLOT_DEFINITIONS,
  buildPlanningPreviewFromWorksheetRows,
  hashFile,
  parseDateService,
  parseMusicSlotValue,
  readXlsxWorksheet,
  worksheetFromCsvText
};
