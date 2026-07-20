#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Firestore } from "@google-cloud/firestore";

import writePlanTools from "../lib/service-order-firestore-write-plan.js";

const {
  buildPreviewBundle,
  buildServiceOrderFirestoreWritePlan
} = writePlanTools;

const DEFAULT_PREVIEW_DIR = "tmp/service-order-previews-2026-ytd-verified";
const DEFAULT_OUTPUT_PATH = "tmp/service-order-firestore-write-plan.json";
const DEFAULT_PROJECT_ID = "location-map-985";
const DEFAULT_DATABASE_ID = "chatgptstorage";
const DEFAULT_COLLECTION_LIMIT = 10000;

function parseArgs(argv) {
  const options = {
    previewDir: DEFAULT_PREVIEW_DIR,
    out: DEFAULT_OUTPUT_PATH,
    sourceName: "2026 YTD Service Order PDFs",
    projectId: process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_PROJECT_ID,
    databaseId: process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID,
    mockEmpty: false,
    fixture: "",
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--preview-dir" && next) {
      options.previewDir = next;
      index += 1;
      continue;
    }

    if (arg === "--out" && next) {
      options.out = next;
      index += 1;
      continue;
    }

    if (arg === "--source-name" && next) {
      options.sourceName = next;
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
  console.log("Usage: node scripts/plan-service-order-firestore-import.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --preview-dir <path>  Directory of service-order preview JSON files. Default: ${DEFAULT_PREVIEW_DIR}`);
  console.log(`  --out <path>          Write-plan JSON output path. Default: ${DEFAULT_OUTPUT_PATH}`);
  console.log("  --source-name <name>  Source import name stored in sourceImports.");
  console.log(`  --project <id>        Google Cloud project. Default: ${DEFAULT_PROJECT_ID}`);
  console.log(`  --database <id>       Firestore database. Default: ${DEFAULT_DATABASE_ID}`);
  console.log("  --fixture <path>      Read existing Firestore state from a local JSON fixture.");
  console.log("  --mock-empty          Use an empty existing Firestore state without network reads.");
  console.log("  --help, -h            Show this help.");
  console.log("");
  console.log("This command never writes to Firestore.");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readPreviewDirectory(previewDir) {
  const resolvedDir = path.resolve(previewDir);
  const previews = fs.readdirSync(resolvedDir)
    .filter((fileName) => fileName.endsWith(".json") && fileName !== "summary.json")
    .sort()
    .map((fileName) => readJson(path.join(resolvedDir, fileName)));

  if (previews.length === 0) {
    throw new Error(`No preview JSON files found in ${resolvedDir}.`);
  }

  return previews;
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
      serviceOrderItems: [],
      serviceSongEvents: [],
      serviceMoments: [],
      sourceImports: [],
      mode: "mock-empty"
    };
  }

  if (options.fixture) {
    return {
      services: [],
      serviceOrderItems: [],
      serviceSongEvents: [],
      serviceMoments: [],
      sourceImports: [],
      ...readJson(path.resolve(options.fixture)),
      mode: "fixture"
    };
  }

  const db = new Firestore({
    projectId: options.projectId,
    databaseId: options.databaseId
  });

  const [
    services,
    serviceOrderItems,
    serviceSongEvents,
    serviceMoments,
    sourceImports
  ] = await Promise.all([
    loadCollection(db, "services"),
    loadCollection(db, "serviceOrderItems"),
    loadCollection(db, "serviceSongEvents"),
    loadCollection(db, "serviceMoments"),
    loadCollection(db, "sourceImports")
  ]);

  return {
    services,
    serviceOrderItems,
    serviceSongEvents,
    serviceMoments,
    sourceImports,
    mode: "firestore",
    projectId: options.projectId,
    databaseId: options.databaseId
  };
}

function printActionGroup(title, counts) {
  console.log("");
  console.log(`${title}:`);
  console.log(`- creates: ${counts.create}`);
  console.log(`- updates: ${counts.update}`);
  console.log(`- preserves: ${counts.preserve}`);
  console.log(`- conflicts: ${counts.conflict}`);
  console.log(`- missing from source: ${counts.missingFromSource}`);
}

function printPlanSummary(plan, outputPath, existingState) {
  console.log("Service order Firestore write plan");
  console.log(`Existing state mode: ${existingState.mode}`);
  if (existingState.mode === "firestore") {
    console.log(`Firestore: ${existingState.projectId}/${existingState.databaseId}`);
  }
  console.log(`Source import action: ${plan.sourceImportPlan.action}`);
  printActionGroup("Services", plan.summary.services);
  printActionGroup("Service order items", plan.summary.serviceOrderItems);
  printActionGroup("Service song events", plan.summary.serviceSongEvents);
  printActionGroup("Service moments", plan.summary.serviceMoments);
  console.log("");
  console.log(`Spreadsheet events to supersede: ${plan.summary.supersededSpreadsheetEvents}`);
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

  const outputPath = path.resolve(options.out);
  const previews = readPreviewDirectory(options.previewDir);
  const previewBundle = buildPreviewBundle(previews, {
    sourceName: options.sourceName
  });
  const existingState = await loadExistingState(options);
  const plan = buildServiceOrderFirestoreWritePlan(previewBundle, existingState);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  printPlanSummary(plan, outputPath, existingState);
}

main().catch((error) => {
  console.error(`Write-plan failed: ${error.message}`);
  process.exitCode = 1;
});
