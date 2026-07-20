import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Firestore } from "@google-cloud/firestore";

const require = createRequire(import.meta.url);
const {
  evaluateSongActiveCongregationalPool,
  normalizeSongMinistryPlanning
} = require("../lib/song-ministry-planning");

const DEFAULT_PROJECT_ID = "location-map-985";
const DEFAULT_DATABASE_ID = "chatgptstorage";
const DEFAULT_OUTPUT_PATH = "tmp/rejoice-active-pool-report-latest.json";

function parseArgs(argv) {
  const options = {
    projectId: DEFAULT_PROJECT_ID,
    databaseId: DEFAULT_DATABASE_ID,
    output: DEFAULT_OUTPUT_PATH,
    leaderId: "dan",
    usageRole: "congregational"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--project-id" && next) {
      options.projectId = next;
      index += 1;
    } else if (arg === "--database-id" && next) {
      options.databaseId = next;
      index += 1;
    } else if (arg === "--output" && next) {
      options.output = next;
      index += 1;
    } else if (arg === "--leader-id" && next) {
      options.leaderId = next;
      index += 1;
    } else if (arg === "--usage-role" && next) {
      options.usageRole = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function toSortedObject(map) {
  return Object.fromEntries(
    Array.from(map.entries()).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    )
  );
}

function summarizeUnknowns(song, planning, unknowns) {
  for (const field of ["energy", "tempo", "congregationFit", "rotationStrength"]) {
    if (!planning[field] || planning[field] === "unknown") {
      unknowns[field].push({
        songId: song.songId,
        hymnalNumber: song.hymnalNumber,
        canonicalTitle: song.canonicalTitle
      });
    }
  }
}

async function loadRejoiceSongs(db) {
  const snapshot = await db.collection("songs")
    .where("songId", ">=", "rejoice-")
    .where("songId", "<", "rejoice.")
    .get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((left, right) => (left.hymnalNumber || 9999) - (right.hymnalNumber || 9999));
}

function buildReport(songs, options) {
  const exclusionCounts = new Map();
  const warningCounts = new Map();
  const activeSongs = [];
  const excludedSongs = [];
  const unknowns = {
    energy: [],
    tempo: [],
    congregationFit: [],
    rotationStrength: []
  };

  for (const song of songs) {
    const result = evaluateSongActiveCongregationalPool(song, {
      leaderId: options.leaderId,
      usageRole: options.usageRole
    });
    const planning = normalizeSongMinistryPlanning(song.ministryPlanning);

    for (const reason of result.blockedReasons) {
      increment(exclusionCounts, reason);
    }

    for (const warning of result.warnings) {
      increment(warningCounts, warning);
    }

    summarizeUnknowns(song, planning, unknowns);

    const summary = {
      songId: song.songId,
      hymnalNumber: song.hymnalNumber,
      canonicalTitle: song.canonicalTitle,
      topics: Array.isArray(song.topics) ? song.topics : [],
      ministryPlanning: planning
    };

    if (result.active) {
      activeSongs.push({
        ...summary,
        warnings: result.warnings
      });
    } else {
      excludedSongs.push({
        ...summary,
        blockedReasons: result.blockedReasons
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    rule: {
      hymnal: "rejoice",
      leaderId: options.leaderId,
      usageRole: options.usageRole,
      excludeOccasionOnly: true,
      rareRotationIsWarningOnly: true
    },
    totals: {
      rejoiceSongs: songs.length,
      activeCount: activeSongs.length,
      excludedCount: excludedSongs.length
    },
    exclusionCounts: toSortedObject(exclusionCounts),
    warningCounts: toSortedObject(warningCounts),
    unknownCounts: Object.fromEntries(
      Object.entries(unknowns).map(([field, rows]) => [field, rows.length])
    ),
    activeSongs: activeSongs.map((song) => ({
      songId: song.songId,
      hymnalNumber: song.hymnalNumber,
      canonicalTitle: song.canonicalTitle,
      energy: song.ministryPlanning.energy,
      tempo: song.ministryPlanning.tempo,
      rotationStrength: song.ministryPlanning.rotationStrength,
      congregationFit: song.ministryPlanning.congregationFit,
      warnings: song.warnings
    })),
    excludedSongs: excludedSongs.map((song) => ({
      songId: song.songId,
      hymnalNumber: song.hymnalNumber,
      canonicalTitle: song.canonicalTitle,
      blockedReasons: song.blockedReasons
    })),
    unknownSamples: Object.fromEntries(
      Object.entries(unknowns).map(([field, rows]) => [field, rows.slice(0, 25)])
    )
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = new Firestore({
    projectId: options.projectId,
    databaseId: options.databaseId
  });
  const songs = await loadRejoiceSongs(db);
  const report = buildReport(songs, options);
  const outputPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    options.output
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    outputPath,
    totals: report.totals,
    exclusionCounts: report.exclusionCounts,
    warningCounts: report.warningCounts,
    unknownCounts: report.unknownCounts,
    firstActiveSongs: report.activeSongs.slice(0, 15)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
