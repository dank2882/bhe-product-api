"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ORDER_SERVICE_IMPORT_CONTRACT_VERSION = "service-order-pdf-v1";

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

const MUSIC_SECTION_PATTERNS = [
  [/congregational/i, "congregational"],
  [/choir opener/i, "choir_opener"],
  [/choir special/i, "choir_special"],
  [/special music/i, "special_music"],
  [/offertory/i, "offertory"],
  [/invitation/i, "invitation"],
  [/baptism/i, "baptism"],
  [/prelude/i, "prelude"],
  [/postlude/i, "postlude"]
];
const GENERIC_NON_SONG_DETAIL_VALUES = new Set([
  "invitation",
  "pianist",
  "pianist -",
  "postlude",
  "postlude music",
  "prelude",
  "prelude music"
]);
const ASSIGNMENT_ROLE_LABEL_PATTERN = "(song leader|pianist|ushers?|drivers?|pastoral|invitation specialist)";

function normalizeString(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
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

function hashFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function decodePdfLiteralString(value) {
  const bytes = [];

  for (let index = 0; index < value.length; index += 1) {
    const byte = value[index];

    if (byte === 92 && index + 1 < value.length) {
      index += 1;
      const next = value[index];
      const escaped = {
        98: 8,
        102: 12,
        110: 10,
        114: 13,
        116: 9,
        40: 40,
        41: 41,
        92: 92
      }[next];
      bytes.push(escaped === undefined ? next : escaped);
      continue;
    }

    bytes.push(byte);
  }

  const buffer = Buffer.from(bytes);
  const nullByteCount = bytes.filter((byte) => byte === 0).length;

  if (nullByteCount >= Math.max(1, Math.floor(bytes.length / 4))) {
    const characters = [];
    for (let index = 0; index + 1 < buffer.length; index += 2) {
      characters.push(String.fromCharCode((buffer[index] << 8) | buffer[index + 1]));
    }
    return characters.join("");
  }

  return buffer.toString("latin1");
}

function decodePdfTextToken(rawToken) {
  if (!rawToken) {
    return "";
  }

  if (rawToken.startsWith("(") && rawToken.endsWith(")")) {
    return decodePdfLiteralString(Buffer.from(rawToken.slice(1, -1), "binary"));
  }

  if (rawToken.startsWith("<") && rawToken.endsWith(">")) {
    return "";
  }

  return "";
}

function extractTextRunsFromPdfBuffer(buffer) {
  const source = buffer.toString("binary");
  const streamPattern = /(\d+)\s+0\s+obj\s*<<[\s\S]*?>>\s*stream\r?\n/g;
  const textRuns = [];
  let match;
  let pageIndex = 0;

  while ((match = streamPattern.exec(source)) !== null) {
    const streamStart = match.index + match[0].length;
    const streamEnd = source.indexOf("endstream", streamStart);

    if (streamEnd < 0) {
      continue;
    }

    const rawStream = Buffer.from(source.slice(streamStart, streamEnd), "binary");
    let decompressed;

    try {
      decompressed = zlib.inflateSync(rawStream).toString("binary");
    } catch (_error) {
      continue;
    }

    if (!decompressed.includes(" Tj")) {
      continue;
    }

    const pageRuns = [];
    const textPattern = /BT\s+(?:\/F\d+\s+[-0-9.]+\s+Tf\s+ET\s+)?(?:q [\s\S]*?BT\s+)?([-0-9.]+)\s+([-0-9.]+)\s+Td\s+(\((?:\\.|[^\\)])*\)|<[^>]+>)\s+Tj/g;
    let textMatch;

    while ((textMatch = textPattern.exec(decompressed)) !== null) {
      const text = normalizeString(decodePdfTextToken(textMatch[3]));

      if (!text) {
        continue;
      }

      pageRuns.push({
        pageIndex,
        x: Number.parseFloat(textMatch[1]),
        y: Number.parseFloat(textMatch[2]),
        text
      });
    }

    if (pageRuns.length > 0) {
      textRuns.push(...pageRuns);
      pageIndex += 1;
    }
  }

  return textRuns;
}

function groupTextRunsIntoLines(textRuns = []) {
  const sortedRuns = [...textRuns].sort((left, right) => {
    if (left.pageIndex !== right.pageIndex) {
      return left.pageIndex - right.pageIndex;
    }

    if (Math.abs(right.y - left.y) > 1.25) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });
  const lines = [];

  for (const run of sortedRuns) {
    const previous = lines[lines.length - 1];

    if (
      previous &&
      previous.pageIndex === run.pageIndex &&
      Math.abs(previous.y - run.y) <= 1.25
    ) {
      previous.runs.push(run);
      previous.y = (previous.y + run.y) / 2;
      continue;
    }

    lines.push({
      pageIndex: run.pageIndex,
      y: run.y,
      runs: [run]
    });
  }

  return lines.map((line) => {
    const runs = [...line.runs].sort((left, right) => left.x - right.x);
    const headingTexts = runs
      .filter((run) => run.x >= 25 && run.x < 80)
      .map((run) => run.text);
    const detailTexts = runs
      .filter((run) => run.x >= 80 && run.x < 385)
      .map((run) => run.text);
    const leaderTexts = runs
      .filter((run) => run.x >= 385 && run.x < 505)
      .map((run) => run.text)
      .filter((text) => !/^led by$/i.test(text));
    const timeTexts = runs
      .filter((run) => run.x >= 500 || /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(run.text))
      .map((run) => run.text)
      .filter((text) => /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(text));

    return {
      ...line,
      runs,
      headingTexts,
      detailTexts,
      leaderTexts,
      timeTexts,
      hasLedByLabel: runs.some((run) => /^led by$/i.test(run.text)),
      text: runs.map((run) => run.text).join(" ")
    };
  });
}

function isMetadataLine(line) {
  if (line.pageIndex > 0) {
    return false;
  }

  if (line.y > 760) {
    return true;
  }

  return /^(morning service|evening service|start time:|duration:)/i.test(line.text);
}

function buildOrderBlocks(lines = []) {
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (isMetadataLine(line)) {
      continue;
    }

    const headingText = normalizeString(line.headingTexts.join(" "));
    const hasHeading = Boolean(headingText);

    if (hasHeading) {
      const isHeadingContinuation =
        current &&
        current.headerOpen &&
        !line.hasLedByLabel &&
        line.timeTexts.length === 0 &&
        line.detailTexts.length === 0 &&
        line.pageIndex === current.lastHeaderPageIndex &&
        Math.abs(current.lastHeaderY - line.y) <= 26;

      if (isHeadingContinuation) {
        current.headingParts.push(headingText);
        current.lines.push(line);
        current.lastHeaderY = line.y;
        continue;
      }

      if (current) {
        blocks.push(current);
      }

      current = {
        headingParts: [headingText],
        lines: [line],
        headerOpen: true,
        lastHeaderY: line.y,
        lastHeaderPageIndex: line.pageIndex
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(line);

    if (
      line.detailTexts.length > 0 ||
      line.leaderTexts.some((text) => !/^led by$/i.test(text))
    ) {
      current.headerOpen = false;
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function parseServiceStart(rawStartTime) {
  const match = normalizeString(rawStartTime).match(
    /([A-Za-z]+),?\s+(\d{1,2}),?\s+(20\d{2})\s*\|\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i
  );

  if (!match) {
    return {
      serviceDate: "",
      startTime: ""
    };
  }

  const month = MONTHS.get(match[1].toLowerCase());
  const day = Number.parseInt(match[2], 10);

  if (!month || !Number.isInteger(day)) {
    return {
      serviceDate: "",
      startTime: normalizeString(match[4])
    };
  }

  return {
    serviceDate: `${match[3]}-${pad2(month)}-${pad2(day)}`,
    startTime: normalizeString(match[4]).toLowerCase()
  };
}

function parseServiceType(title) {
  const cleanTitle = normalizeString(title).toLowerCase();

  if (cleanTitle.includes("morning")) {
    return "sunday_morning";
  }

  if (cleanTitle.includes("evening") || cleanTitle.includes("night") || /\bpm\b/.test(cleanTitle)) {
    return "sunday_evening";
  }

  if (cleanTitle.includes("prayer")) {
    return "prayer_service";
  }

  if (cleanTitle.includes("midweek")) {
    return "wednesday_night";
  }

  if (cleanTitle.includes("missions conference") || cleanTitle.includes("missions banquet")) {
    return "special_event";
  }

  return slugify(cleanTitle || "service").replace(/-/g, "_");
}

function deriveServiceLabels({ serviceType, title, sourceFileName } = {}) {
  const labels = [];
  const combined = `${title || ""} ${sourceFileName || ""}`;

  if (serviceType === "sunday_morning") {
    labels.push("AM");
  }

  if (serviceType === "sunday_evening") {
    labels.push("PM");
  }

  if (/lord'?s[-\s]+memorial[-\s]+supper|lord'?s[-\s]+supper|communion/i.test(combined)) {
    labels.push("Lord's Supper");
  }

  if (/easter/i.test(combined)) {
    labels.push("Easter");
  }

  return Array.from(new Set(labels));
}

function buildServiceId({ serviceDate, serviceType, title }) {
  const datePart = serviceDate || "unknown-date";
  const serviceTypeSlug = slugify(serviceType || title || "service");

  if (serviceTypeSlug === "special-event") {
    return `svc-plan-${datePart}-special-event-${slugify(title || "service")}`;
  }

  return `svc-plan-${datePart}-${serviceTypeSlug}`;
}

function titleCaseSlug(value) {
  return slugify(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getServiceTitleFromFileName(sourceFileName) {
  const basename = path.basename(sourceFileName || "", ".pdf");
  const withoutHash = basename.replace(/-da39a.*$/i, "");
  const withoutDate = withoutHash.replace(/-20\d{2}-\d{2}-\d{2}$/i, "");
  return titleCaseSlug(withoutDate);
}

function normalizeServiceTitle(title, sourceFileName = "") {
  const cleanTitle = normalizeString(title);
  const fallbackTitle = getServiceTitleFromFileName(sourceFileName);
  const resolvedTitle = cleanTitle && cleanTitle !== "Service"
    ? cleanTitle
    : fallbackTitle || cleanTitle || "Service";

  if (/^missions conference service$/i.test(resolvedTitle)) {
    return "Missions Conference";
  }

  return resolvedTitle;
}

function getPdfHeaderMetadata(lines = [], { sourceFileName = "" } = {}) {
  const titleLine = lines.find((line) =>
    line.pageIndex === 0 &&
    line.runs.some((run) => run.x < 100 && /service/i.test(run.text)) &&
    line.y > 780
  );
  const startLine = lines.find((line) => /^start time:/i.test(line.text));
  const durationLine = lines.find((line) => /duration:/i.test(line.text));
  const parsedStart = parseServiceStart(startLine?.text || "");
  const title = normalizeServiceTitle(titleLine?.runs?.[0]?.text || "", sourceFileName);
  const serviceType = parseServiceType(title);
  const serviceLabels = deriveServiceLabels({ serviceType, title, sourceFileName });
  const serviceId = buildServiceId({
    serviceDate: parsedStart.serviceDate,
    serviceType,
    title
  });
  const durationMatch = normalizeString(durationLine?.text || "").match(/duration:\s*(.+)$/i);

  return {
    serviceId,
    serviceDate: parsedStart.serviceDate,
    serviceType,
    title,
    serviceLabels,
    startTime: parsedStart.startTime,
    duration: durationMatch ? normalizeString(durationMatch[1]) : ""
  };
}

function parseTime(lines = []) {
  for (const line of lines) {
    const time = line.timeTexts.find(Boolean);
    if (time) {
      return normalizeString(time).toLowerCase();
    }
  }

  return "";
}

function parseUsageRole(sectionTitle, detailLines = []) {
  const combined = `${sectionTitle} ${detailLines.join(" ")}`;

  for (const [pattern, role] of MUSIC_SECTION_PATTERNS) {
    if (pattern.test(sectionTitle)) {
      return role;
    }
  }

  if (detailLines.some((line) => /^key:/i.test(line))) {
    return "special_music";
  }

  for (const [pattern, role] of MUSIC_SECTION_PATTERNS) {
    if (pattern.test(combined)) {
      return role;
    }
  }

  return "";
}

function parseItemType(sectionTitle, detailLines = []) {
  const combined = `${sectionTitle} ${detailLines.join(" ")}`;
  const usageRole = parseUsageRole(sectionTitle, detailLines);

  if (/theme/i.test(sectionTitle)) {
    return "theme";
  }

  if (/offering|announcement/i.test(combined)) {
    return "offering";
  }

  if (usageRole) {
    return "song";
  }

  if (/prayer/i.test(combined)) {
    return "prayer";
  }

  if (/message|pastor|sermon/i.test(combined)) {
    return "message";
  }

  if (/baptism/i.test(combined)) {
    return "baptism";
  }

  if (/transportation/i.test(combined)) {
    return "transportation";
  }

  return "service_element";
}

function parseSongTitle(rawTitle) {
  const cleanTitle = normalizeString(rawTitle);
  const parentheticalHymnMatch = cleanTitle.match(/^(.*?)\s*\((?:[^()#]*\s*)?#\s*(\d+)\s*\)\s*$/);

  if (parentheticalHymnMatch) {
    return {
      songTitle: normalizeString(parentheticalHymnMatch[1]),
      hymnalNumber: Number.parseInt(parentheticalHymnMatch[2], 10)
    };
  }

  const trailingHymnMatch = cleanTitle.match(/^(.*?)\s+#\s*(\d+)\s*$/);

  if (trailingHymnMatch) {
    return {
      songTitle: normalizeString(trailingHymnMatch[1]),
      hymnalNumber: Number.parseInt(trailingHymnMatch[2], 10)
    };
  }

  const trailingParentheticalMatch = cleanTitle.match(/^(.*?)\s*\(([^()]*)\)\s*$/);

  if (trailingParentheticalMatch) {
    return {
      songTitle: normalizeString(trailingParentheticalMatch[1]),
      hymnalNumber: null,
      titleParenthetical: normalizeString(trailingParentheticalMatch[2])
    };
  }

  return {
    songTitle: cleanTitle.replace(/\s+\(\)\s*$/, ""),
    hymnalNumber: null,
    titleParenthetical: ""
  };
}

function isGenericTitleParenthetical(value) {
  const cleanValue = normalizeString(value).toLowerCase();
  return ["default", "invitation", "special music"].includes(cleanValue);
}

function isGenericNonSongDetail(value) {
  const cleanValue = normalizeString(value)
    .toLowerCase()
    .replace(/\s+-\s*$/, " -");

  return GENERIC_NON_SONG_DETAIL_VALUES.has(cleanValue) ||
    /^piano\s*\d+$/i.test(cleanValue);
}

function isSkippableDetailLine(value) {
  return /^\(none\)$/i.test(normalizeString(value)) || isGenericNonSongDetail(value);
}

function parseKeyValue(value) {
  const match = normalizeString(value).match(/^key:\s*(.*)$/i);
  return match ? normalizeString(match[1]) : null;
}

function hasAssignmentRoleLabel(value) {
  return new RegExp(`^${ASSIGNMENT_ROLE_LABEL_PATTERN}\\s*:?\\s*`, "i")
    .test(normalizeString(value));
}

function hasUnbalancedParenthesis(value) {
  const cleanValue = normalizeString(value);
  return cleanValue.includes("(") &&
    cleanValue.split("(").length > cleanValue.split(")").length;
}

function getJoinedTitleLine(detailLines = [], titleIndex = 0) {
  const consumedIndexes = new Set([titleIndex]);
  let titleLine = detailLines[titleIndex] || "";
  let nextIndex = titleIndex + 1;

  while (
    hasUnbalancedParenthesis(titleLine) &&
    detailLines[nextIndex] &&
    parseKeyValue(detailLines[nextIndex]) === null &&
    !isSkippableDetailLine(detailLines[nextIndex])
  ) {
    titleLine = normalizeString(`${titleLine} ${detailLines[nextIndex]}`);
    consumedIndexes.add(nextIndex);
    nextIndex += 1;
  }

  return {
    titleLine: normalizeString(titleLine),
    consumedIndexes
  };
}

function getPrimaryTitleLine(detailLines = []) {
  const titleIndex = detailLines.findIndex((line) =>
    parseKeyValue(line) === null &&
    !isSkippableDetailLine(line)
  );

  if (titleIndex < 0) {
    return {
      titleLine: "",
      consumedIndexes: new Set()
    };
  }

  return getJoinedTitleLine(detailLines, titleIndex);
}

function getAdjacentContentIndex(detailLines = [], startIndex = 0, direction = 1) {
  for (
    let index = startIndex;
    index >= 0 && index < detailLines.length;
    index += direction
  ) {
    if (!isSkippableDetailLine(detailLines[index])) {
      return index;
    }
  }

  return -1;
}

function shouldStartSongEntry({
  detailLines,
  titleIndex,
  consumedIndexes,
  parsedTitle,
  hasPreviousEntry
}) {
  if (!parsedTitle.songTitle) {
    return false;
  }

  if (!hasPreviousEntry) {
    return true;
  }

  if (parsedTitle.hymnalNumber) {
    return true;
  }

  const previousIndex = getAdjacentContentIndex(detailLines, titleIndex - 1, -1);
  const nextIndex = getAdjacentContentIndex(
    detailLines,
    Math.max(...consumedIndexes) + 1,
    1
  );

  return previousIndex >= 0 &&
    nextIndex >= 0 &&
    parseKeyValue(detailLines[previousIndex]) !== null &&
    parseKeyValue(detailLines[nextIndex]) !== null;
}

function parseSongEntries(detailLines = []) {
  const starts = [];
  let index = 0;

  while (index < detailLines.length) {
    const line = detailLines[index];

    if (parseKeyValue(line) !== null || isSkippableDetailLine(line)) {
      index += 1;
      continue;
    }

    const { titleLine, consumedIndexes } = getJoinedTitleLine(detailLines, index);
    const parsedTitle = parseSongTitle(titleLine);

    if (
      shouldStartSongEntry({
        detailLines,
        titleIndex: index,
        consumedIndexes,
        parsedTitle,
        hasPreviousEntry: starts.length > 0
      })
    ) {
      starts.push({
        startIndex: index,
        titleLine,
        consumedIndexes,
        parsedTitle
      });
    }

    index = Math.max(...consumedIndexes) + 1;
  }

  return starts.map((start, startIndex) => {
    const endIndex = starts[startIndex + 1]?.startIndex ?? detailLines.length;
    const notes = [];
    let key = "";

    for (let detailIndex = start.startIndex; detailIndex < endIndex; detailIndex += 1) {
      const detailLine = detailLines[detailIndex];
      const keyValue = parseKeyValue(detailLine);

      if (start.consumedIndexes.has(detailIndex) || isSkippableDetailLine(detailLine)) {
        continue;
      }

      if (keyValue !== null) {
        if (!key) {
          key = keyValue;
        }
        continue;
      }

      if (hasAssignmentRoleLabel(detailLine)) {
        continue;
      }

      notes.push(detailLine);
    }

    if (
      start.parsedTitle.titleParenthetical &&
      !isGenericTitleParenthetical(start.parsedTitle.titleParenthetical)
    ) {
      notes.unshift(start.parsedTitle.titleParenthetical);
    }

    return {
      ...start.parsedTitle,
      key,
      notes,
      rawValue: start.titleLine
    };
  });
}

function parseDetailFields(detailLines = []) {
  const songEntries = parseSongEntries(detailLines);

  if (songEntries.length > 0) {
    return {
      ...songEntries[0],
      songEntries
    };
  }

  const keyLine = detailLines.find((line) => parseKeyValue(line) !== null);
  const key = keyLine ? parseKeyValue(keyLine) : "";
  const { titleLine, consumedIndexes } = getPrimaryTitleLine(detailLines);
  const parsedTitle = parseSongTitle(titleLine);
  const notes = detailLines.filter((line, index) => {
    return !consumedIndexes.has(index) &&
      line !== keyLine &&
      !isSkippableDetailLine(line);
  });

  if (
    parsedTitle.titleParenthetical &&
    !isGenericTitleParenthetical(parsedTitle.titleParenthetical)
  ) {
    notes.unshift(parsedTitle.titleParenthetical);
  }

  return {
    ...parsedTitle,
    key,
    notes,
    songEntries: []
  };
}

function normalizeAssignedRole(rawRole) {
  const cleanRole = normalizeString(rawRole).toLowerCase();

  if (cleanRole === "drivers") {
    return "driver";
  }

  if (cleanRole === "ushers") {
    return "usher";
  }

  return cleanRole.replace(/\s+/g, "_");
}

function normalizeAssignedName(value) {
  return normalizeString(value).replace(/\s*;\s*$/, "");
}

function parseLabeledAssignedPeople(rawLeaderTexts = []) {
  const combined = normalizeString(rawLeaderTexts.join(" "));
  const rolePattern = new RegExp(`${ASSIGNMENT_ROLE_LABEL_PATTERN}\\s*:?\\s*`, "ig");
  const matches = [];
  let match;

  while ((match = rolePattern.exec(combined)) !== null) {
    matches.push({
      role: normalizeAssignedRole(match[1]),
      labelStart: match.index,
      nameStart: match.index + match[0].length
    });
  }

  return matches.map((assignment, index) => {
    const nameEnd = matches[index + 1]?.labelStart ?? combined.length;
    return {
      role: assignment.role,
      name: normalizeAssignedName(combined.slice(assignment.nameStart, nameEnd))
    };
  });
}

function parseAssignedPeople(lines = [], detailLines = []) {
  const assignedPeople = [];
  const rawLeaderTexts = lines
    .flatMap((line) => line.leaderTexts)
    .map(normalizeString)
    .filter(Boolean);
  const labeledAssignedPeople = parseLabeledAssignedPeople(rawLeaderTexts);
  const detailAssignedPeople = parseLabeledAssignedPeople(
    detailLines.filter((line) => hasAssignmentRoleLabel(line))
  );

  if (labeledAssignedPeople.length > 0) {
    assignedPeople.push(...labeledAssignedPeople);
  } else {
    for (const text of rawLeaderTexts) {
      assignedPeople.push({ role: "leader", name: normalizeAssignedName(text) });
    }
  }
  assignedPeople.push(...detailAssignedPeople);

  for (const detailLine of detailLines) {
    const prayerMatch = detailLine.match(/^opening prayer\s*-\s*(.+)$/i);
    if (prayerMatch) {
      assignedPeople.push({
        role: "prayer",
        name: normalizeString(prayerMatch[1])
      });
    }
  }

  return assignedPeople;
}

function getUniqueNormalizedValues(values = []) {
  const seen = new Set();
  const normalizedValues = [];

  for (const value of values) {
    const cleanValue = normalizeString(value);
    const lookupValue = cleanValue.toLowerCase();

    if (!cleanValue || seen.has(lookupValue)) {
      continue;
    }

    seen.add(lookupValue);
    normalizedValues.push(cleanValue);
  }

  return normalizedValues;
}

function shouldUseTitleParentheticalAsAssignee(value) {
  return normalizeString(value) && !isGenericTitleParenthetical(value);
}

function buildOrderItem(block, service, sequence) {
  const sectionTitle = normalizeString(block.headingParts.join(" "));
  const detailLines = block.lines
    .flatMap((line) => line.detailTexts)
    .map(normalizeString)
    .filter(Boolean);
  const parsedDetails = parseDetailFields(detailLines);
  const usageRole = parseUsageRole(sectionTitle, detailLines);
  const itemType = parseItemType(sectionTitle, detailLines);
  const title = parsedDetails.songTitle || sectionTitle;
  const orderItemId = `soi-${service.serviceId}-${String(sequence).padStart(4, "0")}-${slugify(title || sectionTitle || "item")}`;
  const songEntries = itemType === "song" ? parsedDetails.songEntries : [];
  const notes = songEntries.length > 0
    ? songEntries.flatMap((entry) => entry.notes)
    : parsedDetails.notes;

  return {
    serviceOrderItemId: orderItemId,
    serviceId: service.serviceId,
    serviceDate: service.serviceDate,
    serviceType: service.serviceType,
    sequence,
    itemType,
    sectionTitle,
    title,
    startTime: parseTime(block.lines),
    usageRole,
    songTitleCandidate: itemType === "song" ? parsedDetails.songTitle : "",
    hymnalNumber: parsedDetails.hymnalNumber,
    songId: null,
    key: parsedDetails.key,
    titleParenthetical: parsedDetails.titleParenthetical || "",
    songEntries,
    assignedPeople: parseAssignedPeople(block.lines, detailLines),
    notes,
    detailLines,
    sourcePageIndexes: Array.from(new Set(block.lines.map((line) => line.pageIndex))).sort((left, right) => left - right),
    sourceText: block.lines.map((line) => line.text),
    planningStatus: "planned",
    actualStatus: "unknown"
  };
}

function buildAssignedPersonOrGroupRaw(item, songEntry) {
  return getUniqueNormalizedValues([
    ...item.assignedPeople
      .filter((person) => person.name)
      .map((person) => person.name),
    ...(
      songEntry.titleParenthetical &&
      !["congregational", "invitation", "baptism"].includes(item.usageRole) &&
      shouldUseTitleParentheticalAsAssignee(songEntry.titleParenthetical)
        ? [songEntry.titleParenthetical]
        : []
    )
  ]).join(", ");
}

function buildServiceSongEventsFromOrderItems(orderItems = []) {
  return orderItems
    .filter((item) => item.itemType === "song" && item.songTitleCandidate)
    .flatMap((item) => {
      const songEntries = item.songEntries?.length
        ? item.songEntries
        : [{
            songTitle: item.songTitleCandidate,
            hymnalNumber: item.hymnalNumber,
            key: item.key,
            titleParenthetical: item.titleParenthetical,
            notes: item.notes,
            rawValue: item.detailLines[0] || item.title
          }];

      return songEntries.map((songEntry, songEntryIndex) => {
        const eventSequence = item.sequence + songEntryIndex;
        const eventIdSuffix = songEntries.length > 1
          ? `-${String(songEntryIndex + 1).padStart(2, "0")}-${slugify(songEntry.songTitle)}`
          : "";

        return {
          serviceSongEventId: `sse-order-${item.serviceOrderItemId.replace(/^soi-/, "")}${eventIdSuffix}`,
          serviceId: item.serviceId,
          serviceDate: item.serviceDate,
          serviceType: item.serviceType,
          slotIndex: eventSequence,
          plannedSequence: eventSequence,
          usageRole: item.usageRole,
          rawValue: songEntry.rawValue || item.detailLines[0] || item.title,
          songTitleCandidate: songEntry.songTitle,
          songTitleConfidence: songEntry.hymnalNumber ? "high" : "medium",
          title: songEntry.songTitle,
          songTitle: songEntry.songTitle,
          hymnalNumber: songEntry.hymnalNumber,
          key: songEntry.key,
          assignedPersonOrGroupRaw: buildAssignedPersonOrGroupRaw(item, songEntry),
          detailNote: songEntry.notes.join(" "),
          songId: item.songId,
          linkedServiceOrderItemId: item.serviceOrderItemId,
          planningStatus: item.planningStatus,
          actualStatus: item.actualStatus,
          source: "order_of_service_pdf",
          sourceType: "order_of_service_pdf"
        };
      });
    });
}

function inferMomentType(note) {
  const cleanNote = normalizeString(note).toLowerCase();

  if (cleanNote.includes("scripture") || cleanNote.includes("read ")) {
    return "scripture_connection";
  }

  if (cleanNote.includes("chorus")) {
    return "chorus_append";
  }

  if (cleanNote.includes("solo")) {
    return "solo_verse";
  }

  if (cleanNote.includes("verse")) {
    return "verse_dynamic";
  }

  if (
    cleanNote.includes("dismiss") ||
    cleanNote.includes("enter") ||
    cleanNote.includes("come up") ||
    cleanNote.includes("platform")
  ) {
    return "service_transition";
  }

  return "";
}

function buildServiceMomentsFromOrderItems(orderItems = []) {
  const moments = [];

  for (const item of orderItems) {
    for (const note of item.notes) {
      const momentType = inferMomentType(note);

      if (!momentType) {
        continue;
      }

      const serviceMomentId = `sm-${item.serviceOrderItemId.replace(/^soi-/, "")}-${String(moments.length + 1).padStart(2, "0")}`;
      moments.push({
        serviceMomentId,
        serviceId: item.serviceId,
        serviceDate: item.serviceDate,
        sequence: item.sequence,
        momentType,
        title: note,
        linkedOrderItemIds: [item.serviceOrderItemId],
        linkedSongEventIds: [],
        primarySongTitleCandidate: item.songTitleCandidate || "",
        primarySongId: item.songId,
        scriptureRefs: [],
        assignedPeople: [],
        planningIntent: "",
        executionNotes: note,
        status: "detected_for_review",
        postService: {
          impact: "unknown",
          notes: ""
        }
      });
    }
  }

  return moments;
}

function buildServiceOrderPreviewFromTextRuns({
  textRuns,
  sourceFileName = "",
  sourceFileHash = "",
  sourcePath = ""
} = {}) {
  const lines = groupTextRunsIntoLines(textRuns);
  const service = getPdfHeaderMetadata(lines, { sourceFileName });
  const blocks = buildOrderBlocks(lines);
  const serviceOrderItems = blocks.map((block, index) =>
    buildOrderItem(block, service, (index + 1) * 10)
  );
  const serviceSongEvents = buildServiceSongEventsFromOrderItems(serviceOrderItems);
  const serviceMoments = buildServiceMomentsFromOrderItems(serviceOrderItems);
  const warnings = [];

  if (!service.serviceDate) {
    warnings.push({
      severity: "review",
      code: "missing_service_date",
      message: "The PDF start time could not be parsed into a service date."
    });
  }

  if (serviceOrderItems.length === 0) {
    warnings.push({
      severity: "error",
      code: "no_order_items_detected",
      message: "No order-of-service items were detected in the PDF text."
    });
  }

  return {
    sourceImportPreview: {
      sourceType: "order_of_service_pdf",
      sourceName: "Order of Service PDF",
      sourceFileName,
      sourceFileHash,
      sourcePath,
      importMode: "preview",
      importContractVersion: ORDER_SERVICE_IMPORT_CONTRACT_VERSION,
      planningStatusDefault: "planned",
      actualStatusDefault: "unknown",
      linesDetected: lines.length,
      orderItemsDetected: serviceOrderItems.length,
      serviceSongEventsDetected: serviceSongEvents.length,
      serviceMomentsDetected: serviceMoments.length,
      warningsCount: warnings.length
    },
    service,
    serviceOrderItems,
    serviceSongEvents,
    serviceMoments,
    warnings,
    summary: {
      orderItemsByType: countBy(serviceOrderItems, (item) => item.itemType),
      songEventsByRole: countBy(serviceSongEvents, (event) => event.usageRole),
      serviceMomentsByType: countBy(serviceMoments, (moment) => moment.momentType),
      warningsBySeverity: countBy(warnings, (warning) => warning.severity)
    }
  };
}

function countBy(items, getKey) {
  return items.reduce((result, item) => {
    const key = getKey(item) || "(blank)";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function buildServiceOrderPreviewFromPdf({
  pdfPath
} = {}) {
  const resolvedPath = path.resolve(pdfPath || "");
  const sourceFileHash = hashFile(resolvedPath);
  const textRuns = extractTextRunsFromPdfBuffer(fs.readFileSync(resolvedPath));

  return buildServiceOrderPreviewFromTextRuns({
    textRuns,
    sourceFileName: path.basename(resolvedPath),
    sourceFileHash,
    sourcePath: resolvedPath
  });
}

module.exports = {
  buildServiceOrderPreviewFromPdf,
  buildServiceOrderPreviewFromTextRuns,
  decodePdfLiteralString,
  extractTextRunsFromPdfBuffer,
  groupTextRunsIntoLines,
  ORDER_SERVICE_IMPORT_CONTRACT_VERSION
};
