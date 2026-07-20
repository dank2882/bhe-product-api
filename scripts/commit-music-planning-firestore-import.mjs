#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Firestore } from "@google-cloud/firestore";

import commitTools from "../lib/music-planning-firestore-commit.js";

const {
  classifyCommitTarget,
  createCommitTargetsFromPlan,
  getSourceImportId,
  summarizeCommitClassifications,
  validateMusicPlanningCommitPlan
} = commitTools;

const DEFAULT_PLAN_PATH = "tmp/music-planning-firestore-write-plan.json";
const DEFAULT_OUTPUT_PATH = "tmp/music-planning-firestore-commit-result.json";
const DEFAULT_PROJECT_ID = "location-map-985";
const DEFAULT_DATABASE_ID = "chatgptstorage";

function parseArgs(argv) {
  const options = {
    plan: DEFAULT_PLAN_PATH,
    out: DEFAULT_OUTPUT_PATH,
    projectId: process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_PROJECT_ID,
    databaseId: process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID,
    confirmSourceImportId: "",
    commit: false,
    allowPlannedUpdates: false,
    allowPartialConflicts: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--plan" && next) {
      options.plan = next;
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

    if (arg === "--confirm-source-import-id" && next) {
      options.confirmSourceImportId = next;
      index += 1;
      continue;
    }

    if (arg === "--commit") {
      options.commit = true;
      continue;
    }

    if (arg === "--allow-planned-updates") {
      options.allowPlannedUpdates = true;
      continue;
    }

    if (arg === "--allow-partial-conflicts") {
      options.allowPartialConflicts = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log("Usage: node scripts/commit-music-planning-firestore-import.mjs --commit --confirm-source-import-id <id> [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --plan <path>                       Write-plan JSON path. Default: ${DEFAULT_PLAN_PATH}`);
  console.log(`  --out <path>                        Commit result JSON path. Default: ${DEFAULT_OUTPUT_PATH}`);
  console.log("  --confirm-source-import-id <id>     Required exact source import ID confirmation.");
  console.log("  --commit                            Required flag to perform Firestore writes.");
  console.log("  --allow-planned-updates             Allow updates to spreadsheet-owned planned/unknown records.");
  console.log("  --allow-partial-conflicts           Commit safe create/update rows while reporting known-safe unrelated conflicts.");
  console.log(`  --project <id>                      Google Cloud project. Default: ${DEFAULT_PROJECT_ID}`);
  console.log(`  --database <id>                     Firestore database. Default: ${DEFAULT_DATABASE_ID}`);
  console.log("  --help, -h                          Show this help.");
  console.log("");
  console.log("This command creates missing records and, when explicitly allowed, refreshes spreadsheet-owned planned records. It never deletes, marks completed, or matches songs.");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function classifyTargets(db, targets) {
  const targetsWithRefs = targets.map((target) => ({
    ...target,
    docRef: db.collection(target.collectionName).doc(target.id)
  }));
  const snapshots = targetsWithRefs.length > 0
    ? await db.getAll(...targetsWithRefs.map((target) => target.docRef))
    : [];

  return targetsWithRefs.map((target, index) => {
    const doc = snapshots[index];
    return classifyCommitTarget({
      existing: doc && doc.exists ? (doc.data() || {}) : null,
      target
    });
  });
}

async function commitBatch(db, writes) {
  if (writes.length === 0) {
    return;
  }

  let batch = db.batch();
  let batchSize = 0;

  for (const write of writes) {
    if (write.type === "create") {
      batch.create(write.docRef, write.data);
    } else {
      batch.set(write.docRef, write.data, { merge: true });
    }
    batchSize += 1;

    if (batchSize === 450) {
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }
}

async function applyClassifiedTargets(db, classifications) {
  const created = [];
  const updated = [];
  const skippedExisting = [];
  const writes = [];

  for (const item of classifications) {
    if (item.action === "skipExisting") {
      skippedExisting.push({
        collectionName: item.target.collectionName,
        id: item.target.id,
        kind: item.target.kind
      });
      continue;
    }

    if (item.action !== "create") {
      if (item.action === "update") {
        writes.push({
          type: "update",
          docRef: item.target.docRef,
          data: item.target.proposed
        });
        updated.push({
          collectionName: item.target.collectionName,
          id: item.target.id,
          kind: item.target.kind
        });
      }
      continue;
    }

    writes.push({
      type: "create",
      docRef: item.target.docRef,
      data: item.target.proposed
    });
    created.push({
      collectionName: item.target.collectionName,
      id: item.target.id,
      kind: item.target.kind
    });
  }

  await commitBatch(db, writes);

  return {
    created,
    updated,
    skippedExisting
  };
}

function buildResult({ plan, validation, classifications, writeResult, options }) {
  const summary = summarizeCommitClassifications(classifications);

  return {
    sourceImportId: validation.sourceImportId,
    committedAt: new Date().toISOString(),
    projectId: options.projectId,
    databaseId: options.databaseId,
    planPath: path.resolve(options.plan),
    warningsSummary: plan.summary && plan.summary.warnings ? plan.summary.warnings : {},
    summary,
    created: writeResult.created,
    updated: writeResult.updated,
    skippedExisting: writeResult.skippedExisting,
    conflicts: classifications
      .filter((item) => item.action === "conflictExisting")
      .map((item) => ({
        collectionName: item.target.collectionName,
        id: item.target.id,
        kind: item.target.kind,
        reason: item.reason
      })),
    safety: {
      updatesPerformed: writeResult.updated.length,
      plannedUpdatesPerformed: writeResult.updated.length,
      deletesPerformed: 0,
      completionChangesPerformed: 0,
      catalogMatchesPerformed: 0,
      gptArtifactsChanged: false,
      createOnly: writeResult.updated.length === 0,
      partialConflictsAllowed: options.allowPartialConflicts === true
    }
  };
}

function printResult(result, outputPath) {
  console.log("Music planning Firestore commit result");
  console.log(`Source import ID: ${result.sourceImportId}`);
  console.log(`Firestore: ${result.projectId}/${result.databaseId}`);
  console.log("");
  console.log(`Source import created: ${result.summary.sourceImportCreated}`);
  console.log(`Source import skipped existing: ${result.summary.sourceImportSkippedExisting}`);
  console.log(`Services created: ${result.summary.servicesCreated}`);
  console.log(`Services updated: ${result.summary.servicesUpdated}`);
  console.log(`Services skipped existing: ${result.summary.servicesSkippedExisting}`);
  console.log(`Service song events created: ${result.summary.serviceSongEventsCreated}`);
  console.log(`Service song events updated: ${result.summary.serviceSongEventsUpdated}`);
  console.log(`Service song events skipped existing: ${result.summary.serviceSongEventsSkippedExisting}`);
  console.log(`Conflicts: ${result.summary.conflicts}`);
  console.log(`Warnings summary: ${JSON.stringify(result.warningsSummary)}`);
  console.log("");
  console.log("Safety confirmation: no deletes, completion changes, catalog matches, GPT artifacts, or deployments were performed.");
  console.log(`Commit result JSON: ${outputPath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const planPath = path.resolve(options.plan);
  const outputPath = path.resolve(options.out);
  const plan = readJson(planPath);
  const validation = validateMusicPlanningCommitPlan(plan, {
    commit: options.commit,
    confirmSourceImportId: options.confirmSourceImportId,
    allowPlannedUpdates: options.allowPlannedUpdates,
    allowPartialConflicts: options.allowPartialConflicts
  });

  if (!validation.ok) {
    throw new Error(`Commit refused:\n- ${validation.errors.join("\n- ")}`);
  }

  const sourceImportId = getSourceImportId(plan);
  if (sourceImportId !== validation.sourceImportId) {
    throw new Error("Source import ID validation mismatch.");
  }

  const targets = createCommitTargetsFromPlan(plan);
  const db = new Firestore({
    projectId: options.projectId,
    databaseId: options.databaseId
  });
  const classifications = await classifyTargets(db, targets);
  const conflictingExisting = classifications.filter((item) => item.action === "conflictExisting");

  if (conflictingExisting.length > 0) {
    throw new Error(
      `Commit refused: ${conflictingExisting.length} target documents already exist with unexpected content.`
    );
  }

  const writeResult = await applyClassifiedTargets(db, classifications);
  const result = buildResult({
    plan,
    validation,
    classifications,
    writeResult,
    options
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  printResult(result, outputPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
