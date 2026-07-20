#!/usr/bin/env node

import fs from "node:fs";
import { getLogosSermonTags } from "./lib/logos-sermon-import.mjs";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MIN_CHARS = 50;

function parseArgs(argv) {
  const args = {
    inFile: "",
    apiUrl: process.env.BHE_API_URL || "http://localhost:8080",
    apiKey: process.env.BHE_API_KEY || "",
    batchSize: DEFAULT_BATCH_SIZE,
    minChars: DEFAULT_MIN_CHARS,
    folderId: "",
    rebuild: false,
    embed: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--in") args.inFile = next;
    else if (token === "--api-url") args.apiUrl = next;
    else if (token === "--api-key") args.apiKey = next;
    else if (token === "--batch-size") args.batchSize = Number.parseInt(next, 10);
    else if (token === "--min-chars") args.minChars = Number.parseInt(next, 10);
    else if (token === "--folder-id") args.folderId = next;
    else if (token === "--rebuild") args.rebuild = true;
    else if (token === "--embed") args.embed = true;

    if (token.startsWith("--") && next && !next.startsWith("--") && !["--rebuild", "--embed"].includes(token)) {
      index += 1;
    }
  }

  args.batchSize = Number.isInteger(args.batchSize) && args.batchSize > 0
    ? Math.min(args.batchSize, 50)
    : DEFAULT_BATCH_SIZE;
  args.minChars = Number.isInteger(args.minChars) && args.minChars >= 0 ? args.minChars : DEFAULT_MIN_CHARS;
  return args;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function buildSummary(record) {
  const tags = getLogosSermonTags(record);
  const occasionLines = Array.isArray(record.occasions)
    ? record.occasions
      .map((occasion, index) => {
        const details = [
          occasion.date ? `date: ${occasion.date}` : "",
          occasion.venue ? `venue: ${occasion.venue}` : "",
          occasion.service ? `service: ${occasion.service}` : ""
        ].filter(Boolean).join(", ");

        return details ? `${index + 1}. ${details}` : "";
      })
      .filter(Boolean)
    : [];

  return [
    record.preachedDate ? `Preached date: ${record.preachedDate}` : "",
    record.series ? `Series: ${record.series}` : "",
    record.seriesNumber ? `Series number: ${record.seriesNumber}` : "",
    record.venue ? `Venue: ${record.venue}` : "",
    record.service ? `Service: ${record.service}` : "",
    record.speaker ? `Speaker: ${record.speaker}` : "",
    record.duration ? `Duration: ${record.duration}` : "",
    record.wordCount ? `Word count: ${record.wordCount}` : "",
    record.topics?.length ? `Topics: ${record.topics.join(", ")}` : "",
    tags.length ? `Tags: ${tags.join(", ")}` : "",
    occasionLines.length ? `Preaching occasions:\n${occasionLines.join("\n")}` : ""
  ].filter(Boolean).join("\n");
}

function normalizeDocIdPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function buildStableSermonId(record) {
  if (record.logosId) {
    return `sermon-logos-${normalizeDocIdPart(record.logosId)}`;
  }

  return `sermon-logos-${normalizeDocIdPart(record.title)}-${normalizeDocIdPart(record.preachedDate)}`;
}

function buildStableSourceId(record) {
  if (record.logosId) {
    return `source-logos-${normalizeDocIdPart(record.logosId)}`;
  }

  return `source-logos-${normalizeDocIdPart(record.title)}-${normalizeDocIdPart(record.preachedDate)}`;
}

function toImportItem(record, defaults = {}) {
  const tags = getLogosSermonTags(record);
  const sourceRefs = [
    record.url ? { type: "logos_url", url: record.url } : null,
    record.logosId ? { type: "logos_id", id: record.logosId } : null,
    record.links?.length ? { type: "logos_links", links: record.links } : null,
    record.logosMetadata ? { type: "logos_metadata", metadata: record.logosMetadata } : null,
    record.logosExportTarget ? { type: "logos_export_target", target: record.logosExportTarget } : null
  ].filter(Boolean);

  return {
    folderId: defaults.folderId || "",
    sermonId: buildStableSermonId(record),
    sourceId: buildStableSourceId(record),
    title: record.title || record.scriptureText || "Imported Logos Sermon",
    tags,
    scriptureText: record.scriptureText || "",
    preachedDate: record.preachedDate || "",
    occasions: Array.isArray(record.occasions)
      ? record.occasions.map((occasion) => ({
        date: occasion.date || "",
        time: occasion.time || "",
        timeZone: occasion.timeZone || "America/Los_Angeles",
        venue: occasion.venue || "",
        service: occasion.service || "",
        status: "preached"
      }))
      : [],
    occasion: Array.isArray(record.occasions) && record.occasions.length > 0
      ? record.occasions
        .map((occasion) => [occasion.date, occasion.venue, occasion.service].filter(Boolean).join(" - "))
        .filter(Boolean)
        .join("\n")
      : [record.venue, record.service].filter(Boolean).join(" - "),
    status: "preached",
    sourceType: "logos_export",
    sourceTitle: record.title || "Logos Sermon",
    sourceLabel: record.title || "Logos Sermon",
    importedMaterial: record.manuscriptText || "",
    importedSummary: buildSummary(record),
    sourceRefs
  };
}

async function postBatch({ apiUrl, apiKey, items, rebuild, embed, batchSize }) {
  const endpoint = `${apiUrl.replace(/\/+$/, "")}/sermons/import/batch`;
  const responses = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        items: batch,
        rebuildChunks: rebuild,
        embedChunks: embed
      })
    });
    const data = await response.json().catch(() => ({}));
    responses.push({ status: response.status, data });

    if (!response.ok && response.status !== 207) {
      throw new Error(`Batch POST failed: ${response.status} ${JSON.stringify(data)}`);
    }

    console.log(`[${Math.min(index + batch.length, items.length)}/${items.length}] posted batch status ${response.status}`);
    if (response.status === 207 || data.errorCount > 0) {
      console.log(JSON.stringify({
        batchStart: index,
        errorCount: data.errorCount || 0,
        errors: data.errors || []
      }, null, 2));
    }
  }

  return responses;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inFile) throw new Error("Missing --in <jsonl>.");
  if (!args.apiKey) throw new Error("Missing API key. Set BHE_API_KEY or pass --api-key.");

  const records = readJsonl(args.inFile);
  const postableRecords = records.filter((record) => (record.manuscriptText || "").trim().length >= args.minChars);
  const skippedRecords = records
    .filter((record) => (record.manuscriptText || "").trim().length < args.minChars)
    .map((record) => ({ title: record.title, chars: (record.manuscriptText || "").trim().length }));
  const items = postableRecords.map((record) => toImportItem(record, { folderId: args.folderId }));
  const responses = await postBatch({
    apiUrl: args.apiUrl,
    apiKey: args.apiKey,
    items,
    rebuild: args.rebuild,
    embed: args.embed,
    batchSize: args.batchSize
  });

  console.log(JSON.stringify({
    inputRecords: records.length,
    postedRecords: items.length,
    skippedRecords,
    postedBatches: responses.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
