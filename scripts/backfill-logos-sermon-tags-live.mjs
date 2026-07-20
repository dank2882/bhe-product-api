#!/usr/bin/env node

import fs from "node:fs";
import { getLogosSermonTags, mergeLogosTags } from "./lib/logos-sermon-import.mjs";

const DEFAULT_BASE_URL = "https://bhe-product-api-mwhc25pkra-uw.a.run.app";

function parseArgs(argv) {
  const options = {
    inFile: "",
    baseUrl: process.env.SERMON_WORKSPACE_BASE_URL || DEFAULT_BASE_URL,
    apiKey: process.env.BHE_API_KEY || "",
    canonicalTag: "life-builders",
    commit: false,
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--in") options.inFile = argv[++index] || "";
    else if (argument === "--base-url") options.baseUrl = argv[++index] || "";
    else if (argument === "--api-key") options.apiKey = argv[++index] || "";
    else if (argument === "--canonical-tag") options.canonicalTag = argv[++index] || "";
    else if (argument === "--commit") options.commit = true;
    else if (argument === "--verbose") options.verbose = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function normalizeDocIdPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function getStableSermonId(record) {
  if (record.logosId) return `sermon-logos-${normalizeDocIdPart(record.logosId)}`;
  return `sermon-logos-${normalizeDocIdPart(record.title)}-${normalizeDocIdPart(record.preachedDate)}`;
}

async function executeOperation(options, operation, argumentsValue, mode = "query") {
  const response = await fetch(`${options.baseUrl}/sermon-workspace/${mode}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": options.apiKey
    },
    body: JSON.stringify({ operation, arguments: argumentsValue })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok !== true) {
    const error = new Error(data.error?.message || `${operation} failed with HTTP ${response.status}`);
    error.code = data.error?.code || "operation_failed";
    error.details = data.error?.details || {};
    throw error;
  }

  return data.result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: BHE_API_KEY=... node scripts/backfill-logos-sermon-tags-live.mjs --in FILE [--canonical-tag TAG] [--commit] [--verbose]");
    return;
  }
  if (!options.inFile) throw new Error("Missing --in <jsonl>.");
  if (!options.apiKey) throw new Error("Missing API key. Set BHE_API_KEY or pass --api-key.");

  const candidates = readJsonl(options.inFile)
    .map((record) => ({ record, inferredTags: getLogosSermonTags(record) }))
    .filter(({ inferredTags }) => inferredTags.includes(options.canonicalTag));
  const changes = [];
  const missing = [];

  for (const { record, inferredTags } of candidates) {
    const sermonId = getStableSermonId(record);
    let result;
    try {
      result = await executeOperation(options, "getSermon", { sermonId });
    } catch (error) {
      if (error.code === "sermon_not_found") {
        missing.push({ sermonId, title: record.title || "" });
        continue;
      }
      throw error;
    }

    const currentTags = Array.isArray(result.sermon?.tags) ? result.sermon.tags : [];
    const nextTags = mergeLogosTags(currentTags, inferredTags);
    if (nextTags.length === currentTags.length) continue;
    changes.push({
      sermonId,
      title: result.sermon?.title || record.title || "",
      currentTags,
      addedTags: nextTags.filter((tag) => !currentTags.some((current) => current.toLowerCase() === tag.toLowerCase())),
      nextTags
    });
  }

  const updated = [];
  if (options.commit) {
    for (const change of changes) {
      await executeOperation(options, "updateSermon", {
        sermonId: change.sermonId,
        changes: { tags: change.nextTags }
      }, "command");
      updated.push(change.sermonId);
    }
  }

  const report = {
    mode: options.commit ? "commit" : "dry_run",
    canonicalTag: options.canonicalTag,
    candidateCount: candidates.length,
    classCount: candidates.filter(({ inferredTags }) => inferredTags.includes("life-builders-class")).length,
    retreatCount: candidates.filter(({ inferredTags }) => inferredTags.includes("life-builders-retreat")).length,
    changeCount: changes.length,
    unchangedCount: candidates.length - changes.length - missing.length,
    missingCount: missing.length,
    updatedCount: updated.length,
    missing,
    changes: options.verbose ? changes : changes.map(({ sermonId, title, addedTags }) => ({ sermonId, title, addedTags }))
  };

  console.log(JSON.stringify(report, null, 2));
}

await main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    code: error.code || "",
    details: error.details || {}
  }, null, 2));
  process.exitCode = 1;
});
