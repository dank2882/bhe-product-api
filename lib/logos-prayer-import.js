"use strict";

const { createHash } = require("node:crypto");
const JSZip = require("jszip");

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_DOCX_BYTES = 10 * 1024 * 1024;

function normalizeString(value) { return typeof value === "string" ? value.trim() : ""; }
function decodeXml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
function parseScheduleText(value) {
  const text = normalizeString(value).toLowerCase();
  const timeZone = "America/Los_Angeles";
  if (text === "daily" || text === "every day") return { kind: "daily", timeZone };
  const interval = text.match(/every\s+(\d+)\s+days?/);
  const date = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (interval && date) return { kind: "interval", intervalDays: Number(interval[1]), startDate: date[1], timeZone };
  if (interval) return null;
  if (date) return { kind: "date", date: date[1], timeZone };
  const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekdays = weekdayNames.map((name, index) => new RegExp(`\\b${name}s?\\b`).test(text) ? index : -1).filter((index) => index >= 0);
  if (weekdays.length) return { kind: "weekly", weekdays, timeZone };
  return null;
}

async function downloadDocx(openaiFileIdRefs, deps = {}) {
  if (!Array.isArray(openaiFileIdRefs) || openaiFileIdRefs.length !== 1) {
    throw Object.assign(new Error("Attach exactly one Logos DOCX export"), { statusCode: 400, code: "invalid_logos_export_count" });
  }
  const ref = openaiFileIdRefs[0] || {};
  const name = normalizeString(ref.name || ref.file_name || "logos-prayers.docx");
  const type = normalizeString(ref.mime_type || ref.mimeType).toLowerCase();
  if (!name.toLowerCase().endsWith(".docx") && type !== DOCX_TYPE) {
    throw Object.assign(new Error("The Logos prayer export must be a DOCX file"), { statusCode: 400, code: "invalid_logos_export_type" });
  }
  const url = normalizeString(ref.download_link || ref.downloadLink);
  if (!url) throw Object.assign(new Error("The attached DOCX has no backend-downloadable link"), { statusCode: 400, code: "missing_logos_export_link" });
  const response = await (deps.fetchImpl || fetch)(url);
  if (!response.ok) throw Object.assign(new Error("Failed to download the Logos prayer export"), { statusCode: 502, code: "logos_export_download_failed" });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_DOCX_BYTES) throw Object.assign(new Error("The Logos DOCX is empty or exceeds 10 MB"), { statusCode: 400, code: "invalid_logos_export_size" });
  return { buffer, name };
}

async function extractDocxParagraphs(buffer) {
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch {
    throw Object.assign(new Error("The Logos export is not a readable DOCX"), { statusCode: 400, code: "malformed_logos_export" });
  }
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw Object.assign(new Error("The DOCX has no Word document content"), { statusCode: 400, code: "malformed_logos_export" });
  const xml = await documentFile.async("string");
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => {
    const block = match[0];
    const text = [...block.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((part) => decodeXml(part[1])).join("");
    const style = block.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] || "";
    return { text, style };
  }).filter((item) => item.text.trim());
}

function parseParagraphs(paragraphs) {
  const lists = [];
  const prayers = [];
  const manualReview = [];
  let currentList = "Imported from Logos";
  let currentPrayer = null;
  const ensureList = (title) => {
    if (!lists.some((list) => list.title === title)) lists.push({ title });
  };
  for (const [index, paragraph] of paragraphs.entries()) {
    const text = paragraph.text.trim();
    const heading = /^Heading[1-6]$/i.test(paragraph.style) || /^Prayer List:\s*/i.test(text);
    if (heading) {
      currentList = text.replace(/^Prayer List:\s*/i, "").trim() || currentList;
      ensureList(currentList);
      currentPrayer = null;
      continue;
    }
    const field = text.match(/^(Tags?|People?|Topics?|Schedule|Notes?|Answer(?:ed)?):\s*(.*)$/i);
    if (field && currentPrayer) {
      const key = field[1].toLowerCase();
      const value = field[2];
      if (key.startsWith("tag")) currentPrayer.tags = value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
      else if (key.startsWith("people")) currentPrayer.people = value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
      else if (key.startsWith("topic")) currentPrayer.topics = value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
      else if (key === "schedule") {
        currentPrayer.scheduleText = value;
        currentPrayer.schedule = parseScheduleText(value);
        if (!currentPrayer.schedule) manualReview.push({ paragraph: index + 1, reason: "Schedule requires confirmation", text });
      }
      else if (key.startsWith("answer")) { currentPrayer.answerText = value; currentPrayer.status = "answered"; }
      else currentPrayer.context = [currentPrayer.context, value].filter(Boolean).join("\n");
      continue;
    }
    if (field && !currentPrayer) {
      manualReview.push({ paragraph: index + 1, reason: "Field appeared before a prayer", text });
      continue;
    }
    ensureList(currentList);
    currentPrayer = {
      listTitle: currentList,
      title: text.split(/[.!?]\s/)[0].slice(0, 300),
      prayerText: text,
      context: "",
      tags: [], people: [], topics: [], status: "active",
      sourceParagraph: index + 1
    };
    prayers.push(currentPrayer);
  }
  if (!prayers.length) manualReview.push({ reason: "No prayers could be confidently identified", text: "The DOCX must be reviewed manually." });
  if (!paragraphs.some((p) => /^Heading[1-6]$/i.test(p.style) || /^Prayer List:/i.test(p.text))) {
    manualReview.push({ reason: "No explicit list headings were detected", text: "All recovered prayers were placed in Imported from Logos." });
  }
  return { lists, prayers, manualReview };
}

async function buildLogosImportPreview(input = {}, deps = {}) {
  let paragraphs;
  let sourceName = normalizeString(input.sourceName) || "logos-prayers.docx";
  if (Array.isArray(input.openaiFileIdRefs)) {
    const downloaded = await downloadDocx(input.openaiFileIdRefs, deps);
    sourceName = downloaded.name;
    paragraphs = await extractDocxParagraphs(downloaded.buffer);
  } else if (typeof input.rawText === "string") {
    paragraphs = input.rawText.split(/\r?\n/).map((text) => ({ text, style: "" })).filter((p) => p.text.trim());
  } else {
    throw Object.assign(new Error("Attach a Logos DOCX export"), { statusCode: 400, code: "missing_logos_export" });
  }
  const parsed = parseParagraphs(paragraphs);
  const fingerprintCounts = new Map();
  for (const prayer of parsed.prayers) {
    const fingerprint = createHash("sha256").update(`${prayer.listTitle}\u0000${prayer.prayerText}`.toLowerCase()).digest("hex");
    prayer.fingerprint = fingerprint;
    fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) || 0) + 1);
  }
  const duplicates = parsed.prayers.filter((p) => fingerprintCounts.get(p.fingerprint) > 1).map((p) => ({ title: p.title, listTitle: p.listTitle, sourceParagraph: p.sourceParagraph }));
  return {
    sourceName,
    sourceHash: createHash("sha256").update(JSON.stringify(paragraphs)).digest("hex"),
    lists: parsed.lists,
    prayers: parsed.prayers,
    duplicates,
    manualReview: parsed.manualReview,
    uncertainMappings: parsed.manualReview,
    counts: {
      lists: parsed.lists.length,
      prayers: parsed.prayers.length,
      withTags: parsed.prayers.filter((p) => p.tags.length).length,
      withSchedules: parsed.prayers.filter((p) => p.scheduleText).length,
      answered: parsed.prayers.filter((p) => p.status === "answered").length,
      duplicates: duplicates.length,
      manualReview: parsed.manualReview.length
    }
  };
}

module.exports = { DOCX_TYPE, MAX_DOCX_BYTES, buildLogosImportPreview, extractDocxParagraphs, parseParagraphs, parseScheduleText };
