#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_API_URL = process.env.BHE_API_URL || "http://localhost:8080";
const DEFAULT_JSON_OUT = "tmp/logos-sermon-preflight.json";
const DEFAULT_MD_OUT = "tmp/logos-sermon-preflight.md";
const WATCH_SERIES_PATTERNS = [
  { key: "from_me_to_we", label: "From Me to We / Family Foundations", pattern: /from me to we|family foundations/i },
  { key: "james_living_by_faith", label: "James / Living by Faith", pattern: /james|living by faith/i }
];

function parseArgs(argv) {
  const args = {
    input: "",
    apiUrl: DEFAULT_API_URL,
    apiKey: process.env.BHE_API_KEY || "",
    jsonOut: DEFAULT_JSON_OUT,
    mdOut: DEFAULT_MD_OUT,
    lookupMode: "bulk"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if ((token === "--in" || token === "--input") && next) {
      args.input = next;
      index += 1;
    } else if (token === "--api-url" && next) {
      args.apiUrl = next;
      index += 1;
    } else if (token === "--api-key" && next) {
      args.apiKey = next;
      index += 1;
    } else if (token === "--json-out" && next) {
      args.jsonOut = next;
      index += 1;
    } else if (token === "--md-out" && next) {
      args.mdOut = next;
      index += 1;
    } else if (token === "--lookup-mode" && next) {
      args.lookupMode = next;
      index += 1;
    }
  }

  if (!args.input) {
    throw new Error("Missing --in path");
  }

  if (!args.apiKey) {
    throw new Error("Missing API key. Set BHE_API_KEY or pass --api-key.");
  }

  args.lookupMode = args.lookupMode === "live" ? "live" : "bulk";

  return args;
}

function normalizeText(value) {
  return typeof value === "string"
    ? value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function getSeriesFlags(record) {
  const haystack = [
    record.title,
    record.series,
    record.service,
    record.venue,
    record.scriptureText,
    record.logosMetadata?.panelText
  ].map(normalizeText).join(" ");

  return WATCH_SERIES_PATTERNS
    .filter((series) => series.pattern.test(haystack))
    .map(({ key, label }) => ({ key, label }));
}

function getLogosQueries(record) {
  const id = normalizeText(record.logosId);
  if (id) return [id];

  const url = normalizeText(record.url);
  return url ? [url.split("?")[0]] : [];
}

function getInputDuplicateKey(record) {
  return normalizeText(record.logosId) ||
    normalizeText(record.url).split("?")[0] ||
    [
      normalizeForMatch(record.title),
      normalizeText(record.preachedDate),
      record.manuscriptText?.length || 0
    ].join("|");
}

async function apiGet(args, pathname, query = {}) {
  const url = new URL(pathname, args.apiUrl.replace(/\/+$/, "") + "/");
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && `${value}`.trim()) {
      url.searchParams.set(key, `${value}`);
    }
  }

  const response = await fetch(url, {
    headers: {
      "x-api-key": args.apiKey
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`GET ${url.pathname} failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function findSourceMatches(args, record) {
  if (args.lookupMode === "bulk" && args.backendSnapshot) {
    return findSourceMatchesInSnapshot(args.backendSnapshot, record);
  }

  const queries = getLogosQueries(record);
  const cacheKey = queries.join("|");
  args.sourceMatchCache ||= new Map();

  if (args.sourceMatchCache.has(cacheKey)) {
    return args.sourceMatchCache.get(cacheKey);
  }

  const matchesById = new Map();

  for (const query of queries) {
    const data = await apiGet(args, "/sermon-sources", {
      sourceType: "logos_export",
      query,
      limit: 10
    });

    for (const source of data.sources || []) {
      matchesById.set(source.sourceId, {
        sourceId: source.sourceId,
        sermonId: source.sermonId,
        sourceLabel: source.sourceLabel,
        summary: source.summary
      });
    }
  }

  const matches = Array.from(matchesById.values());
  args.sourceMatchCache.set(cacheKey, matches);
  return matches;
}

async function findTitleMatches(args, record) {
  if (args.lookupMode === "bulk" && args.backendSnapshot) {
    return findTitleMatchesInSnapshot(args.backendSnapshot, record);
  }

  const title = normalizeText(record.title);
  if (!title) return [];
  const targetTitle = normalizeForMatch(title);
  args.titleMatchCache ||= new Map();

  if (args.titleMatchCache.has(targetTitle)) {
    return args.titleMatchCache.get(targetTitle);
  }

  const data = await apiGet(args, "/sermons", {
    query: title,
    limit: 20
  });

  const matches = (data.sermons || [])
    .filter((sermon) => normalizeForMatch(sermon.title) === targetTitle)
    .map((sermon) => ({
      sermonId: sermon.sermonId,
      title: sermon.title,
      status: sermon.status,
      folderId: sermon.folderId,
      targetDate: sermon.targetDate,
      preachedDate: sermon.preachedDate,
      occasion: sermon.occasion
    }));

  args.titleMatchCache.set(targetTitle, matches);
  return matches;
}

function sourceMatchesRecord(source, record) {
  const haystack = [
    source.sourceId,
    source.sermonId,
    source.sourceLabel,
    source.summary,
    JSON.stringify(source.sourceRefs || [])
  ].map(normalizeText).join(" ");
  const queries = getLogosQueries(record);

  return queries.some((query) => query && haystack.includes(query));
}

function findSourceMatchesInSnapshot(snapshot, record) {
  return snapshot.sources
    .filter((source) => sourceMatchesRecord(source, record))
    .map((source) => ({
      sourceId: source.sourceId,
      sermonId: source.sermonId,
      sourceLabel: source.sourceLabel,
      summary: source.summary
    }));
}

function findTitleMatchesInSnapshot(snapshot, record) {
  const targetTitle = normalizeForMatch(record.title);
  if (!targetTitle) return [];

  return snapshot.sermons
    .filter((sermon) => normalizeForMatch(sermon.title) === targetTitle)
    .map((sermon) => ({
      sermonId: sermon.sermonId,
      title: sermon.title,
      status: sermon.status,
      folderId: sermon.folderId,
      targetDate: sermon.targetDate,
      preachedDate: sermon.preachedDate,
      occasion: sermon.occasion
    }));
}

async function buildBackendSnapshot(args) {
  if (args.lookupMode !== "bulk") {
    return null;
  }

  const [sourceData, sermonData] = await Promise.all([
    apiGet(args, "/sermon-sources", {
      sourceType: "logos_export",
      limit: 100
    }),
    apiGet(args, "/sermons", {
      limit: 100
    })
  ]);

  return {
    sources: sourceData.sources || [],
    sermons: sermonData.sermons || []
  };
}

function classifyRecord({ sourceMatches, titleMatches, seriesFlags, duplicateOrdinal }) {
  if (duplicateOrdinal > 1) {
    return "duplicate_in_input";
  }

  if (sourceMatches.length > 0) {
    return "already_imported";
  }

  if (titleMatches.length > 1) {
    return "ambiguous";
  }

  if (titleMatches.length === 1) {
    return seriesFlags.length > 0 ? "review_update_candidate" : "update_candidate";
  }

  return seriesFlags.length > 0 ? "review_create_candidate" : "create_candidate";
}

async function buildPreflight(args, records) {
  const items = [];
  args.backendSnapshot = await buildBackendSnapshot(args);
  if (args.backendSnapshot) {
    console.log(JSON.stringify({
      lookupMode: args.lookupMode,
      backendSources: args.backendSnapshot.sources.length,
      backendSermons: args.backendSnapshot.sermons.length
    }));
  }
  const duplicateCounts = records.reduce((acc, record) => {
    const key = getInputDuplicateKey(record);
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());
  const duplicateSeen = new Map();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const duplicateKey = getInputDuplicateKey(record);
    const duplicateCount = duplicateCounts.get(duplicateKey) || 1;
    const duplicateOrdinal = (duplicateSeen.get(duplicateKey) || 0) + 1;
    duplicateSeen.set(duplicateKey, duplicateOrdinal);
    const seriesFlags = getSeriesFlags(record);
    const sourceMatches = await findSourceMatches(args, record);
    const titleMatches = await findTitleMatches(args, record);
    const action = classifyRecord({ sourceMatches, titleMatches, seriesFlags, duplicateOrdinal });

    items.push({
      index: index + 1,
      title: normalizeText(record.title),
      preachedDate: normalizeText(record.preachedDate),
      series: normalizeText(record.series),
      seriesNumber: normalizeText(record.seriesNumber),
      venue: normalizeText(record.venue),
      service: normalizeText(record.service),
      manuscriptChars: record.manuscriptText?.length || 0,
      logosId: normalizeText(record.logosId),
      url: normalizeText(record.url),
      duplicateKey,
      duplicateCount,
      duplicateOrdinal,
      seriesFlags,
      sourceMatches,
      titleMatches,
      action
    });
  }

  const counts = items.reduce((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {});

  return {
    input: args.input,
    generatedAt: new Date().toISOString(),
    requestedCount: records.length,
    counts,
    items
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Logos Import Preflight\n");
  lines.push(`Source: ${report.input}`);
  lines.push(`Records: ${report.requestedCount}`);
  lines.push(`Generated: ${report.generatedAt}\n`);
  lines.push("## Summary\n");

  for (const key of [
    "already_imported",
    "update_candidate",
    "review_update_candidate",
    "create_candidate",
    "review_create_candidate",
    "ambiguous",
    "duplicate_in_input"
  ]) {
    lines.push(`- ${key}: ${report.counts[key] || 0}`);
  }

  lines.push("\n## Records\n");

  for (const item of report.items) {
    lines.push(`### ${item.index}. ${item.title || "(untitled)"}`);
    lines.push(`- Action: ${item.action}`);
    lines.push(`- Date: ${item.preachedDate || "(blank)"}`);
    lines.push(`- Series: ${item.series || "(blank)"}`);
    lines.push(`- Series number: ${item.seriesNumber || "(blank)"}`);
    lines.push(`- Occasion: ${[item.venue, item.service].filter(Boolean).join(" - ") || "(blank)"}`);
    lines.push(`- Manuscript chars: ${item.manuscriptChars}`);
    lines.push(`- Logos id: ${item.logosId || "(blank)"}`);

    if (item.duplicateCount > 1) {
      lines.push(`- Input duplicate: ${item.duplicateOrdinal} of ${item.duplicateCount}`);
    }

    if (item.seriesFlags.length > 0) {
      lines.push(`- Review flags: ${item.seriesFlags.map((flag) => flag.label).join(", ")}`);
    }

    if (item.sourceMatches.length > 0) {
      lines.push("- Existing Logos sources:");
      for (const source of item.sourceMatches) {
        lines.push(`  - ${source.sermonId} (${source.sourceId})`);
      }
    }

    if (item.titleMatches.length > 0) {
      lines.push("- Existing title matches:");
      for (const sermon of item.titleMatches) {
        lines.push(`  - ${sermon.sermonId}: ${sermon.title} [${sermon.status || "status blank"}]`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function writeOutputs(args, report) {
  fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
  fs.mkdirSync(path.dirname(args.mdOut), { recursive: true });
  fs.writeFileSync(args.jsonOut, JSON.stringify(report, null, 2));
  fs.writeFileSync(args.mdOut, renderMarkdown(report));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = readJsonl(args.input);
  const report = await buildPreflight(args, records);

  writeOutputs(args, report);
  console.log(JSON.stringify({
    input: args.input,
    jsonOut: path.resolve(args.jsonOut),
    mdOut: path.resolve(args.mdOut),
    requestedCount: report.requestedCount,
    counts: report.counts
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
