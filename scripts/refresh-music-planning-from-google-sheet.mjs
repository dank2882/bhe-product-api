#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

import { Firestore } from "@google-cloud/firestore";

import previewTools from "../lib/music-planning-import-preview.js";
import writePlanTools from "../lib/music-planning-firestore-write-plan.js";
import commitTools from "../lib/music-planning-firestore-commit.js";
import refreshTools from "../lib/music-planning-refresh.js";

const {
  DEFAULT_LIVE_GOOGLE_SHEET_ID,
  DEFAULT_SOURCE_SHEET_NAME,
  buildRefreshArtifactPaths,
  buildRefreshSummary,
  getPlanActionSummary,
  parseRefreshArgs,
  validateRefreshCommitPlan
} = refreshTools;

const {
  buildPlanningPreviewFromWorksheetRows,
  worksheetFromCsvText
} = previewTools;

const { buildFirestoreWritePlan } = writePlanTools;

const {
  classifyCommitTarget,
  createCommitTargetsFromPlan,
  getSourceImportId,
  summarizeCommitClassifications
} = commitTools;

const DEFAULT_COLLECTION_LIMIT = 10000;

function printHelp() {
  console.log("Usage: node scripts/refresh-music-planning-from-google-sheet.mjs [mode] [options]");
  console.log("");
  console.log("Modes:");
  console.log("  --preview-only                  Pull the live Sheet and write preview JSON only.");
  console.log("  --plan-only                     Pull preview, read Firestore, and write a plan. Default mode.");
  console.log("  --commit                        Pull preview, plan, and commit safe creates/updates.");
  console.log("");
  console.log("Options:");
  console.log(`  --google-sheet-id <id>          Default: ${DEFAULT_LIVE_GOOGLE_SHEET_ID}`);
  console.log(`  --sheet <name>                  Default: ${DEFAULT_SOURCE_SHEET_NAME}`);
  console.log("  --year <year>                   Planning year. Default: 2026");
  console.log("  --out-dir <path>                Artifact directory. Default: tmp");
  console.log("  --allow-planned-updates         Required when commit plan includes planned updates.");
  console.log("  --allow-partial-conflicts       Commit safe rows while reporting known-safe unrelated conflicts.");
  console.log("  --confirm-source-import-id <id> Required exact source import ID confirmation for --commit.");
  console.log("  --project <id>                  Google Cloud project. Default: location-map-985");
  console.log("  --database <id>                 Firestore database. Default: chatgptstorage");
  console.log("  --help, -h                      Show this help.");
  console.log("");
  console.log("This command never deletes, marks completed, matches songs, updates GPT artifacts, or deploys.");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchGoogleSheetPreview(options) {
  const sheetParam = encodeURIComponent(options.sheet);
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(options.googleSheetId)}/gviz/tq?tqx=out:csv&sheet=${sheetParam}`;
  const response = await fetch(url, { redirect: "follow" });
  const csvText = await response.text();

  if (!response.ok) {
    throw new Error(`Google Sheet CSV export failed: ${response.status}`);
  }

  const worksheet = worksheetFromCsvText({
    csvText,
    sheetName: options.sheet,
    workbookPath: url,
    sheetNames: [options.sheet]
  });
  const preview = buildPlanningPreviewFromWorksheetRows({
    worksheet,
    planningYear: options.year,
    sourceName: "Music Ministry - Master Data",
    sourceType: "google_sheet_export",
    sourceWorkbookName: `Google Sheet ${options.googleSheetId}`,
    sourceFileHash: createHash("sha256").update(csvText).digest("hex")
  });

  preview.sourceImportPreview.sourceSpreadsheetId = options.googleSheetId;
  return preview;
}

async function loadCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).limit(DEFAULT_COLLECTION_LIMIT).get();

  return snapshot.docs.map((doc) => ({
    firestoreDocId: doc.id,
    ...(doc.data() || {})
  }));
}

async function loadExistingState(db) {
  const [services, serviceSongEvents, sourceImports] = await Promise.all([
    loadCollection(db, "services"),
    loadCollection(db, "serviceSongEvents"),
    loadCollection(db, "sourceImports")
  ]);

  return {
    services,
    serviceSongEvents,
    sourceImports,
    mode: "firestore"
  };
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
      continue;
    }

    if (item.action === "create") {
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
  }

  await commitBatch(db, writes);

  return {
    created,
    updated,
    skippedExisting
  };
}

function buildCommitResult({ plan, validation, classifications, writeResult, options, planPath }) {
  const summary = summarizeCommitClassifications(classifications);
  const planConflicts = Array.isArray(plan.conflicts) ? plan.conflicts : [];

  return {
    sourceImportId: validation.sourceImportId,
    committedAt: new Date().toISOString(),
    projectId: options.projectId,
    databaseId: options.databaseId,
    planPath,
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
    planConflictsSkipped: planConflicts.map((item) => ({
      id: item.id,
      action: item.action,
      reason: item.reason,
      serviceDate: item.proposed?.serviceDate || item.existing?.serviceDate || "",
      serviceType: item.proposed?.serviceType || item.existing?.serviceType || ""
    })),
    safety: {
      updatesPerformed: writeResult.updated.length,
      plannedUpdatesPerformed: writeResult.updated.length,
      deletesPerformed: 0,
      completionChangesPerformed: 0,
      catalogMatchesPerformed: 0,
      gptArtifactsChanged: false,
      deploymentsPerformed: 0,
      partialConflictsAllowed: options.allowPartialConflicts === true,
      planConflictsSkipped: planConflicts.length
    }
  };
}

function getVerificationTargets(plan) {
  const sourceImportId = getSourceImportId(plan);
  const services = [
    ...(plan.services && Array.isArray(plan.services.create) ? plan.services.create : []),
    ...(plan.services && Array.isArray(plan.services.update) ? plan.services.update : [])
  ].map((item) => item.id);
  const serviceSongEvents = [
    ...(plan.serviceSongEvents && Array.isArray(plan.serviceSongEvents.create) ? plan.serviceSongEvents.create : []),
    ...(plan.serviceSongEvents && Array.isArray(plan.serviceSongEvents.update) ? plan.serviceSongEvents.update : [])
  ].map((item) => item.id);

  return {
    sourceImportId,
    services,
    serviceSongEvents
  };
}

async function verifyPostCommit(db, plan) {
  const targets = getVerificationTargets(plan);
  const refs = [];
  const labels = [];

  if (targets.sourceImportId) {
    refs.push(db.collection("sourceImports").doc(targets.sourceImportId));
    labels.push({ collectionName: "sourceImports", id: targets.sourceImportId });
  }

  for (const id of targets.services) {
    refs.push(db.collection("services").doc(id));
    labels.push({ collectionName: "services", id });
  }

  for (const id of targets.serviceSongEvents) {
    refs.push(db.collection("serviceSongEvents").doc(id));
    labels.push({ collectionName: "serviceSongEvents", id });
  }

  const snapshots = refs.length > 0 ? await db.getAll(...refs) : [];
  const missing = [];
  const counts = {
    sourceImports: 0,
    services: 0,
    serviceSongEvents: 0
  };

  snapshots.forEach((doc, index) => {
    const label = labels[index];
    if (!doc.exists) {
      missing.push(label);
      return;
    }
    counts[label.collectionName] += 1;
  });

  return {
    expected: {
      sourceImports: targets.sourceImportId ? 1 : 0,
      services: targets.services.length,
      serviceSongEvents: targets.serviceSongEvents.length
    },
    found: counts,
    missing,
    ok: missing.length === 0
  };
}

function printRefreshSummary({ options, artifacts, preview, plan, commitResult, verification }) {
  const planSummary = plan ? getPlanActionSummary(plan) : null;

  console.log("Music planning live Google Sheet refresh");
  console.log(`Mode: ${options.mode}`);
  console.log(`Google Sheet ID: ${options.googleSheetId}`);
  console.log(`Sheet: ${options.sheet}`);
  console.log(`Firestore: ${options.projectId}/${options.databaseId}`);
  console.log("");
  console.log(`Importable services detected: ${preview.sourceImportPreview.importableServicesDetected}`);
  console.log(`Music slots detected: ${preview.sourceImportPreview.songMusicSlotsDetected}`);
  console.log(`Preview warnings: ${JSON.stringify(preview.summary.warningsBySeverity || {})}`);

  if (planSummary) {
    console.log("");
    console.log("Plan:");
    console.log(`- source import action: ${planSummary.sourceImportAction}`);
    console.log(`- service creates: ${planSummary.services.create}`);
    console.log(`- service updates: ${planSummary.services.update}`);
    console.log(`- service song event creates: ${planSummary.serviceSongEvents.create}`);
    console.log(`- service song event updates: ${planSummary.serviceSongEvents.update}`);
    console.log(`- preserves: ${planSummary.services.preserve + planSummary.serviceSongEvents.preserve}`);
    console.log(`- conflicts: ${planSummary.conflicts}`);
    console.log(`- missing from source: ${planSummary.services.missingFromSource + planSummary.serviceSongEvents.missingFromSource}`);
    console.log(`- warnings: ${JSON.stringify(planSummary.warnings.bySeverity || {})}`);
    console.log(`- eligible for commit: ${planSummary.eligibleForCommit ? "yes" : "no"}`);
  }

  if (commitResult) {
    console.log("");
    console.log("Commit:");
    console.log(`- source import created: ${commitResult.summary.sourceImportCreated}`);
    console.log(`- source import skipped existing: ${commitResult.summary.sourceImportSkippedExisting}`);
    console.log(`- services created: ${commitResult.summary.servicesCreated}`);
    console.log(`- services updated: ${commitResult.summary.servicesUpdated}`);
    console.log(`- services skipped existing: ${commitResult.summary.servicesSkippedExisting}`);
    console.log(`- service song events created: ${commitResult.summary.serviceSongEventsCreated}`);
    console.log(`- service song events updated: ${commitResult.summary.serviceSongEventsUpdated}`);
    console.log(`- service song events skipped existing: ${commitResult.summary.serviceSongEventsSkippedExisting}`);
    console.log(`- conflicts: ${commitResult.summary.conflicts}`);
    console.log("- safety: no deletes, completion changes, catalog matches, GPT updates, or deployments");
  } else {
    console.log("");
    console.log("Commit performed: no");
  }

  if (verification) {
    console.log("");
    console.log("Post-commit verification:");
    console.log(`- source imports found: ${verification.found.sourceImports}/${verification.expected.sourceImports}`);
    console.log(`- services found: ${verification.found.services}/${verification.expected.services}`);
    console.log(`- service song events found: ${verification.found.serviceSongEvents}/${verification.expected.serviceSongEvents}`);
    console.log(`- verification ok: ${verification.ok ? "yes" : "no"}`);
  }

  console.log("");
  console.log(`Preview JSON: ${artifacts.preview}`);
  if (plan) {
    console.log(`Write-plan JSON: ${artifacts.writePlan}`);
  }
  if (commitResult) {
    console.log(`Commit result JSON: ${artifacts.commitResult}`);
  }
  console.log(`Refresh summary JSON: ${artifacts.summary}`);
}

async function main() {
  const options = parseRefreshArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const artifacts = buildRefreshArtifactPaths(options.outDir);
  const preview = await fetchGoogleSheetPreview(options);
  writeJson(artifacts.preview, preview);

  let db = null;
  let plan = null;
  let commitResult = null;
  let verification = null;

  if (options.mode !== "preview-only") {
    db = new Firestore({
      projectId: options.projectId,
      databaseId: options.databaseId
    });
    const existingState = await loadExistingState(db);
    plan = buildFirestoreWritePlan(preview, existingState);
    writeJson(artifacts.writePlan, plan);
  }

  if (options.mode === "commit") {
    const validation = validateRefreshCommitPlan(plan, options);

    if (!validation.ok) {
      const sourceImportId = getSourceImportId(plan);
      const hint = sourceImportId
        ? `\nRequired confirmation: --confirm-source-import-id ${sourceImportId}`
        : "";
      throw new Error(`Refresh commit refused:\n- ${validation.errors.join("\n- ")}${hint}`);
    }

    const targets = createCommitTargetsFromPlan(plan);
    const classifications = await classifyTargets(db, targets);
    const conflictingExisting = classifications.filter((item) => item.action === "conflictExisting");

    if (conflictingExisting.length > 0) {
      throw new Error(
        `Refresh commit refused: ${conflictingExisting.length} target documents already exist with unexpected content.`
      );
    }

    const writeResult = await applyClassifiedTargets(db, classifications);
    commitResult = buildCommitResult({
      plan,
      validation,
      classifications,
      writeResult,
      options,
      planPath: artifacts.writePlan
    });
    writeJson(artifacts.commitResult, commitResult);
    verification = await verifyPostCommit(db, plan);
  }

  const summary = buildRefreshSummary({
    options,
    artifacts,
    preview,
    plan,
    commitResult,
    postCommitVerification: verification
  });
  writeJson(artifacts.summary, summary);
  printRefreshSummary({
    options,
    artifacts,
    preview,
    plan,
    commitResult,
    verification
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
