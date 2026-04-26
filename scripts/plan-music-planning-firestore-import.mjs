#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Firestore } from "@google-cloud/firestore";

import writePlanTools from "../lib/music-planning-firestore-write-plan.js";

const { buildFirestoreWritePlan } = writePlanTools;

const DEFAULT_PREVIEW_PATH = "tmp/music-planning-import-preview.json";
const DEFAULT_OUTPUT_PATH = "tmp/music-planning-firestore-write-plan.json";
const DEFAULT_PROJECT_ID = "location-map-985";
const DEFAULT_DATABASE_ID = "chatgptstorage";
const DEFAULT_COLLECTION_LIMIT = 10000;

function parseArgs(argv) {
  const options = {
    preview: DEFAULT_PREVIEW_PATH,
    out: DEFAULT_OUTPUT_PATH,
    projectId: process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_PROJECT_ID,
    databaseId: process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID,
    mockEmpty: false,
    fixture: "",
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--preview" && next) {
      options.preview = next;
      index += 1;
      continue;
    }

    if (arg === "--out" && next) {
      options.out = next;
      index += 1;
      continue;
    }

    if (arg === "--project" && next) {
      options.projectId = next;
      index += 1;
      continue;
    }

    if (arg === "--database" && next) {
      options.databaseId = next;
      index += 1;
      continue;
    }

    if (arg === "--fixture" && next) {
      options.fixture = next;
      index += 1;
      continue;
    }

    if (arg === "--mock-empty") {
      options.mockEmpty = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (options.mockEmpty && options.fixture) {
    throw new Error("Use either --mock-empty or --fixture, not both.");
  }

  return options;
}

function printHelp() {
  console.log("Usage: node scripts/plan-music-planning-firestore-import.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --preview <path>   Preview JSON path. Default: ${DEFAULT_PREVIEW_PATH}`);
  console.log(`  --out <path>       Write-plan JSON output path. Default: ${DEFAULT_OUTPUT_PATH}`);
  console.log(`  --project <id>     Google Cloud project. Default: ${DEFAULT_PROJECT_ID}`);
  console.log(`  --database <id>    Firestore database. Default: ${DEFAULT_DATABASE_ID}`);
  console.log("  --fixture <path>   Read existing Firestore state from a local JSON fixture.");
  console.log("  --mock-empty       Use an empty existing Firestore state without network reads.");
  console.log("  --help, -h         Show this help.");
  console.log("");
  console.log("This command never writes to Firestore.");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function loadCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).limit(DEFAULT_COLLECTION_LIMIT).get();

  return snapshot.docs.map((doc) => ({
    firestoreDocId: doc.id,
    ...(doc.data() || {})
  }));
}

async function loadExistingState(options) {
  if (options.mockEmpty) {
    return {
      services: [],
      serviceSongEvents: [],
      sourceImports: [],
      mode: "mock-empty"
    };
  }

  if (options.fixture) {
    return {
      services: [],
      serviceSongEvents: [],
      sourceImports: [],
      ...readJson(path.resolve(options.fixture)),
      mode: "fixture"
    };
  }

  const db = new Firestore({
    projectId: options.projectId,
    databaseId: options.databaseId
  });

  const [services, serviceSongEvents, sourceImports] = await Promise.all([
    loadCollection(db, "services"),
    loadCollection(db, "serviceSongEvents"),
    loadCollection(db, "sourceImports")
  ]);

  return {
    services,
    serviceSongEvents,
    sourceImports,
    mode: "firestore",
    projectId: options.projectId,
    databaseId: options.databaseId
  };
}

function printPlanSummary(plan, outputPath, existingState) {
  console.log("Music planning Firestore write plan");
  console.log(`Existing state mode: ${existingState.mode}`);
  if (existingState.mode === "firestore") {
    console.log(`Firestore: ${existingState.projectId}/${existingState.databaseId}`);
  }
  console.log(`Source import action: ${plan.sourceImportPlan.action}`);

  console.log("");
  console.log("Services:");
  console.log(`- creates: ${plan.summary.services.create}`);
  console.log(`- updates: ${plan.summary.services.update}`);
  console.log(`- preserves: ${plan.summary.services.preserve}`);
  console.log(`- conflicts: ${plan.summary.services.conflict}`);
  console.log(`- missing from source: ${plan.summary.services.missingFromSource}`);

  console.log("");
  console.log("Service song events:");
  console.log(`- creates: ${plan.summary.serviceSongEvents.create}`);
  console.log(`- updates: ${plan.summary.serviceSongEvents.update}`);
  console.log(`- preserves: ${plan.summary.serviceSongEvents.preserve}`);
  console.log(`- conflicts: ${plan.summary.serviceSongEvents.conflict}`);
  console.log(`- missing from source: ${plan.summary.serviceSongEvents.missingFromSource}`);

  console.log("");
  console.log("Warnings:");
  console.log(`- total: ${plan.summary.warnings.total}`);
  console.log(`- by severity: ${JSON.stringify(plan.summary.warnings.bySeverity)}`);

  console.log("");
  console.log(`Conflicts: ${plan.summary.conflicts.total}`);
  if (plan.summary.conflicts.total > 0) {
    console.log(`Conflict reasons: ${JSON.stringify(plan.summary.conflicts.byReason)}`);
  }
  console.log(`Eligible for commit: ${plan.eligibleForCommit ? "yes" : "no"}`);
  console.log(`Write-plan JSON: ${outputPath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const previewPath = path.resolve(options.preview);
  const outputPath = path.resolve(options.out);
  const preview = readJson(previewPath);
  const existingState = await loadExistingState(options);
  const plan = buildFirestoreWritePlan(preview, existingState);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  printPlanSummary(plan, outputPath, existingState);
}

main().catch((error) => {
  console.error(`Write-plan failed: ${error.message}`);
  process.exitCode = 1;
});
