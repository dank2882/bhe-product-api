#!/usr/bin/env node

import fs from "node:fs";
import { Firestore } from "@google-cloud/firestore";
import {
  getLogosSermonTags,
  mergeLogosTags,
  toLogosImportItem
} from "./lib/logos-sermon-import.mjs";

function parseArgs(argv) {
  const options = {
    inFile: "",
    projectId: process.env.GCP_PROJECT_ID || "location-map-985",
    databaseId: process.env.FIRESTORE_DATABASE_ID || "chatgptstorage",
    verbose: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--in") options.inFile = argv[++index] || "";
    else if (token === "--project") options.projectId = argv[++index] || "";
    else if (token === "--database") options.databaseId = argv[++index] || "";
    else if (token === "--verbose") options.verbose = true;
    else if (token === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function mergeOccasions(...values) {
  const output = [];
  const seen = new Set();
  for (const occasion of values.flat().filter(Boolean)) {
    const clean = {
      date: normalizeText(occasion.date),
      time: normalizeText(occasion.time),
      timeZone: normalizeText(occasion.timeZone),
      venue: normalizeText(occasion.venue),
      service: normalizeText(occasion.service)
    };
    const key = [
      clean.date,
      normalizeKey(clean.venue),
      normalizeKey(clean.service)
    ].join("\u0000");
    if (!clean.date && !clean.venue && !clean.service) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function mergeRecords(records = []) {
  const byId = new Map();
  for (const record of records) {
    const key = normalizeText(record.logosId) ||
      `${normalizeKey(record.title)}\u0000${normalizeText(record.preachedDate)}`;
    const current = byId.get(key);
    if (!current) {
      byId.set(key, {
        ...record,
        tags: mergeLogosTags(record.tags || []),
        topics: mergeLogosTags(record.topics || []),
        audience: mergeLogosTags(Array.isArray(record.audience) ? record.audience : [record.audience]),
        occasions: mergeOccasions(record.occasions || [])
      });
      continue;
    }

    byId.set(key, {
      ...current,
      ...Object.fromEntries(Object.entries(record).filter(([, value]) =>
        value !== undefined && value !== null && value !== "")),
      tags: mergeLogosTags(current.tags, record.tags || []),
      topics: mergeLogosTags(current.topics, record.topics || []),
      audience: mergeLogosTags(
        current.audience,
        Array.isArray(record.audience) ? record.audience : [record.audience]
      ),
      occasions: mergeOccasions(current.occasions, record.occasions || [])
    });
  }
  return Array.from(byId.values());
}

function increment(map, key, amount = 1) {
  const cleanKey = normalizeText(key);
  map.set(cleanKey, (map.get(cleanKey) || 0) + amount);
}

function sortedCounts(map) {
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function metadataHasValue(metadata = {}, field) {
  const value = metadata[field];
  return Array.isArray(value) ? value.length > 0 : Boolean(normalizeText(value));
}

function findLogosMetadata(source = {}) {
  const ref = (Array.isArray(source.sourceRefs) ? source.sourceRefs : [])
    .find((item) => normalizeText(item?.type) === "logos_metadata");
  return ref?.metadata && typeof ref.metadata === "object" ? ref.metadata : {};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/audit-logos-sermon-metadata-live.mjs --in FILE [--verbose]");
    return;
  }
  if (!options.inFile) throw new Error("Missing --in <jsonl>.");

  const records = mergeRecords(readJsonl(options.inFile));
  const db = new Firestore({
    projectId: options.projectId,
    databaseId: options.databaseId
  });
  const [sermonSnapshot, sourceSnapshot, occasionSnapshot] = await Promise.all([
    db.collection("sermons").get(),
    db.collection("sermonSources").where("sourceType", "==", "logos_export").get(),
    db.collection("sermonOccasions").get()
  ]);
  const sermons = new Map(sermonSnapshot.docs.map((doc) => [doc.id, doc.data() || {}]));
  const sources = new Map(sourceSnapshot.docs.map((doc) => [doc.id, doc.data() || {}]));
  const occasionsBySermon = new Map();
  for (const doc of occasionSnapshot.docs) {
    const occasion = doc.data() || {};
    const values = occasionsBySermon.get(occasion.sermonId) || [];
    values.push(occasion);
    occasionsBySermon.set(occasion.sermonId, values);
  }

  const missingSermons = [];
  const conflicts = [];
  const tagCounts = new Map();
  const tagMissing = new Map();
  const sourceMetadataFields = [
    "speaker",
    "topics",
    "audience",
    "description",
    "targetDuration",
    "privateNotes"
  ];
  const structuredSourceCoverage = Object.fromEntries(sourceMetadataFields.map((field) => [
    field,
    { logosCount: 0, storedCount: 0 }
  ]));
  const counts = {
    matchedSermons: 0,
    matchedStableSources: 0,
    seriesLogosCount: 0,
    seriesMissingCanonical: 0,
    seriesConflicts: 0,
    passageLogosCount: 0,
    passageMissingCanonical: 0,
    passageConflicts: 0,
    occasionLogosCount: 0,
    occasionMissingExact: 0,
    venueMissingByDate: 0,
    serviceMissingByDate: 0
  };

  for (const record of records) {
    const item = toLogosImportItem(record);
    const sermon = sermons.get(item.sermonId);
    const source = sources.get(item.sourceId);
    const directTags = mergeLogosTags(record.tags || []);
    for (const tag of directTags) increment(tagCounts, tag);

    if (!sermon) {
      missingSermons.push({
        sermonId: item.sermonId,
        logosId: normalizeText(record.logosId),
        title: normalizeText(record.title),
        tags: directTags
      });
      for (const tag of directTags) increment(tagMissing, tag);
      continue;
    }
    counts.matchedSermons += 1;
    if (source) counts.matchedStableSources += 1;

    const currentTags = getLogosSermonTags({ tags: sermon.tags || [] }).map(normalizeKey);
    for (const tag of directTags) {
      if (!currentTags.includes(normalizeKey(tag))) increment(tagMissing, tag);
    }

    if (normalizeText(record.series)) {
      counts.seriesLogosCount += 1;
      if (!normalizeText(sermon.seriesTitle)) {
        counts.seriesMissingCanonical += 1;
      } else if (normalizeKey(sermon.seriesTitle) !== normalizeKey(record.series)) {
        counts.seriesConflicts += 1;
        conflicts.push({
          sermonId: item.sermonId,
          title: normalizeText(record.title),
          field: "seriesTitle",
          sermonWorkspace: normalizeText(sermon.seriesTitle),
          logos: normalizeText(record.series)
        });
      }
    }

    if (normalizeText(record.scriptureText)) {
      counts.passageLogosCount += 1;
      if (!normalizeText(sermon.scriptureText)) {
        counts.passageMissingCanonical += 1;
      } else if (normalizeKey(sermon.scriptureText) !== normalizeKey(record.scriptureText)) {
        counts.passageConflicts += 1;
        conflicts.push({
          sermonId: item.sermonId,
          title: normalizeText(record.title),
          field: "scriptureText",
          sermonWorkspace: normalizeText(sermon.scriptureText),
          logos: normalizeText(record.scriptureText)
        });
      }
    }

    const liveOccasions = occasionsBySermon.get(item.sermonId) || [];
    for (const occasion of item.occasions) {
      counts.occasionLogosCount += 1;
      const sameDate = liveOccasions.filter((current) =>
        normalizeText(current.date) === normalizeText(occasion.date));
      const exact = sameDate.some((current) =>
        normalizeKey(current.venue) === normalizeKey(occasion.venue) &&
        normalizeKey(current.service) === normalizeKey(occasion.service));
      if (!exact) {
        counts.occasionMissingExact += 1;
        if (
          occasion.venue &&
          !sameDate.some((current) => normalizeKey(current.venue) === normalizeKey(occasion.venue))
        ) {
          counts.venueMissingByDate += 1;
        }
        if (
          occasion.service &&
          !sameDate.some((current) => normalizeKey(current.service) === normalizeKey(occasion.service))
        ) {
          counts.serviceMissingByDate += 1;
        }
      }
    }

    const storedMetadata = source ? findLogosMetadata(source) : {};
    for (const field of sourceMetadataFields) {
      const expectedMetadata = item.sourceRefs
        .find((ref) => ref.type === "logos_metadata")?.metadata || {};
      if (!metadataHasValue(expectedMetadata, field)) continue;
      structuredSourceCoverage[field].logosCount += 1;
      if (metadataHasValue(storedMetadata, field)) {
        structuredSourceCoverage[field].storedCount += 1;
      }
    }
  }

  const tags = sortedCounts(tagCounts).map(({ value: tag, count: logosCount }) => {
    const missingCount = tagMissing.get(tag) || 0;
    return {
      tag,
      logosCount,
      presentCanonical: logosCount - missingCount,
      missingCanonical: missingCount
    };
  });
  const report = {
    mode: "read_only_audit",
    sourceFile: options.inFile,
    logos: {
      uniqueSermons: records.length,
      customTagCount: tags.length,
      tags
    },
    sermonWorkspace: {
      totalSermons: sermonSnapshot.size,
      totalOccasions: occasionSnapshot.size,
      totalLogosSources: sourceSnapshot.size,
      matchedSermons: counts.matchedSermons,
      missingSermons: missingSermons.length,
      matchedStableSources: counts.matchedStableSources
    },
    canonicalGaps: {
      series: {
        logosCount: counts.seriesLogosCount,
        missing: counts.seriesMissingCanonical,
        conflicts: counts.seriesConflicts
      },
      passages: {
        logosCount: counts.passageLogosCount,
        missing: counts.passageMissingCanonical,
        conflicts: counts.passageConflicts
      },
      occasions: {
        logosCount: counts.occasionLogosCount,
        missingExact: counts.occasionMissingExact,
        venueMissingByDate: counts.venueMissingByDate,
        serviceMissingByDate: counts.serviceMissingByDate
      }
    },
    structuredSourceCoverage,
    missingSermonSamples: missingSermons.slice(0, options.verbose ? 1000 : 20),
    conflictSamples: conflicts.slice(0, options.verbose ? 1000 : 20)
  };

  console.log(JSON.stringify(report, null, 2));
}

await main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    code: error.code || ""
  }, null, 2));
  process.exitCode = 1;
});

