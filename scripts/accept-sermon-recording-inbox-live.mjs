#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "location-map-985";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "chatgptstorage";
const BUCKET_NAME = process.env.BUCKET_NAME || "bhe-product-assets";
const BASE_URL = (process.env.SERMON_WORKSPACE_BASE_URL || "https://bhe-product-api-mwhc25pkra-uw.a.run.app").replace(/\/+$/, "");
const INPUT_FILE = path.resolve(process.env.SERMON_INBOX_ACCEPTANCE_FILE || "/tmp/sermon-transcription-acceptance.m4a");
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 180000;

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function runOperation(mode, operation, argumentsValue, idempotencyKey = "") {
  const response = await fetch(`${BASE_URL}/sermon-workspace/${mode}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": process.env.BHE_API_KEY
    },
    body: JSON.stringify({
      operation,
      arguments: argumentsValue,
      ...(idempotencyKey ? { idempotencyKey } : {})
    })
  });
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (_error) {
    throw new Error(`${operation} returned non-JSON HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }
  if (!response.ok || payload.ok !== true) {
    throw new Error(`${operation} failed: ${JSON.stringify(payload.error || payload)}`);
  }
  return payload;
}

function getOperationResult(payload) {
  return payload?.result || {};
}

async function deleteWhere(collection, field, value) {
  const snapshot = await collection.where(field, "==", value).get();
  await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  return snapshot.size;
}

async function createDisposableSourceUrl(input, filename) {
  if (process.env.SERMON_INBOX_ACCEPTANCE_URL) {
    return process.env.SERMON_INBOX_ACCEPTANCE_URL;
  }
  const form = new FormData();
  form.append("file", new Blob([input], { type: "audio/mp4" }), filename);
  const uploadResponse = await fetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    body: form
  });
  const uploadPayload = await uploadResponse.json();
  const landingUrl = uploadPayload?.data?.url || "";
  assert(uploadResponse.ok && landingUrl, `Disposable acceptance upload failed: ${JSON.stringify(uploadPayload)}`);
  const landingResponse = await fetch(landingUrl);
  const landingHtml = await landingResponse.text();
  const directUrl = landingHtml.match(/https:\/\/tmpfiles\.org\/dl\/[^"\s<]+/)?.[0] || "";
  assert(landingResponse.ok && directUrl, "Disposable acceptance upload returned no direct download URL");
  return directUrl;
}

async function main() {
  assert(process.env.BHE_API_KEY, "BHE_API_KEY is required");
  const input = await fs.readFile(INPUT_FILE);
  assert(input.length > 0, `Acceptance recording is empty: ${INPUT_FILE}`);

  const runId = randomUUID().replace(/-/g, "").slice(0, 10);
  const marker = `sermon-inbox-live-${runId}`;
  const title = `Sermon Transcription Acceptance Test ${runId}`;
  const filename = `58th Ave NE 15-${runId}.m4a`;
  const storage = new Storage({ projectId: PROJECT_ID });
  const bucket = storage.bucket(BUCKET_NAME);
  const firestore = new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
  const executionIds = new Set();
  const jobIds = new Set();
  const storagePaths = new Set();
  let sermonId = "";
  let occasionId = "";
  let inboxId = "";
  let mediaId = "";
  let jobId = "";

  const rememberExecution = (payload) => {
    const executionId = payload?.idempotency?.executionId || "";
    if (executionId) executionIds.add(executionId);
  };

  try {
    const sourceUrl = await createDisposableSourceUrl(input, filename);

    const importResponse = await runOperation("command", "importUnmatchedSermonRecording", {
      url: sourceUrl,
      filename,
      contentType: "audio/mp4",
      notes: marker
    }, `${marker}-import`);
    rememberExecution(importResponse);
    const imported = getOperationResult(importResponse);
    inboxId = imported.recording?.inboxId || "";
    assert(imported.imported === true, "Recording was not imported into the inbox");
    assert(inboxId, "Inbox import returned no inboxId");
    assert(!imported.recording?.inferredDate, "Undated acceptance filename unexpectedly produced a date");
    assert(imported.recording?.matchStatus === "needs_date_or_transcript", "Undated recording did not request identification");
    if (imported.recording?.storagePath) storagePaths.add(imported.recording.storagePath);

    const duplicateResponse = await runOperation("command", "importUnmatchedSermonRecording", {
      url: sourceUrl,
      filename: `copy-${filename}`,
      contentType: "audio/mp4",
      notes: marker
    }, `${marker}-duplicate`);
    rememberExecution(duplicateResponse);
    const duplicate = getOperationResult(duplicateResponse);
    assert(duplicate.duplicate === true, "Checksum duplicate was not detected");
    assert(duplicate.recording?.inboxId === inboxId, "Duplicate did not resolve to the original inbox record");

    const identifyResponse = await runOperation("command", "startUnmatchedSermonRecordingIdentification", {
      inboxId
    }, `${marker}-identify`);
    rememberExecution(identifyResponse);
    const identificationJobId = getOperationResult(identifyResponse).job?.jobId || "";
    assert(identificationJobId, "Identification returned no jobId");
    jobIds.add(identificationJobId);
    const identificationPollStartedAt = Date.now();
    let identificationJob = null;
    while (Date.now() - identificationPollStartedAt < POLL_TIMEOUT_MS) {
      const jobResponse = await runOperation("query", "getSermonTranscriptionJob", { jobId: identificationJobId });
      identificationJob = getOperationResult(jobResponse).job;
      if (["completed", "failed"].includes(identificationJob?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    assert(identificationJob?.status === "completed", `Identification did not complete: ${identificationJob?.errorMessage || "timed_out"}`);
    const identifiedResponse = await runOperation("query", "getUnmatchedSermonRecording", { inboxId });
    const identified = getOperationResult(identifiedResponse).recording;
    assert(identified?.identificationStatus === "completed", "Inbox did not preserve completed identification");
    assert(identified?.identification?.suggestedTitle || identified?.identification?.scriptureReferences?.length, "Identification returned no usable sermon clues");
    assert(identified?.candidateCount > 0, "Transcript identification returned no archive candidates");

    const confirmResponse = await runOperation("command", "createSermonFromUnmatchedRecording", {
      inboxId,
      confirmedNoMatch: true,
      transcribe: true,
      cleanTranscript: true,
      rebuildChunks: false,
      notes: marker
    }, `${marker}-create-from-recording`);
    rememberExecution(confirmResponse);
    const confirmed = getOperationResult(confirmResponse);
    sermonId = confirmed.sermon?.sermonId || "";
    occasionId = confirmed.occasion?.occasionId || "";
    mediaId = confirmed.media?.mediaId || "";
    jobId = confirmed.job?.jobId || "";
    if (jobId) jobIds.add(jobId);
    assert(sermonId, "Transcript-derived sermon hub was not created");
    assert(confirmed.sermon?.status === "preached", "Transcript-derived sermon was not marked preached");
    assert(confirmed.generatedNotes?.outline || confirmed.generatedNotes?.notes, "Transcript-derived sermon notes were not created");
    assert(confirmed.recording?.status === "matched", "Inbox record was not linked to the created sermon");
    assert(mediaId, "Confirmation returned no mediaId");
    assert(jobId, "Confirmation returned no transcription jobId");
    assert(confirmed.media?.storagePath === imported.recording?.storagePath, "Confirmation copied rather than reused the inbox recording");

    const pollStartedAt = Date.now();
    let job = null;
    while (Date.now() - pollStartedAt < POLL_TIMEOUT_MS) {
      const jobResponse = await runOperation("query", "getSermonTranscriptionJob", { jobId });
      job = getOperationResult(jobResponse).job;
      if (["completed", "failed"].includes(job?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    assert(job?.status === "completed", `Transcription did not complete: ${job?.status || "timed_out"} ${job?.errorMessage || ""}`.trim());
    assert(job.rawSourceId, "Completed job has no raw transcript source");
    assert(job.cleanedSourceId, "Completed job has no cleaned transcript source");

    const inboxResponse = await runOperation("query", "getUnmatchedSermonRecording", { inboxId });
    const finalRecording = getOperationResult(inboxResponse).recording;
    assert(finalRecording?.status === "matched", "Final inbox record is not matched");
    assert(finalRecording?.transcriptionJobId === jobId, "Final inbox record does not point to its transcription job");

    console.log(JSON.stringify({
      ok: true,
      service: BASE_URL,
      inboxId,
      inferredDate: imported.recording.inferredDate,
      inferredTime: imported.recording.inferredTime,
      initialMatchStatus: imported.recording.matchStatus,
      identificationStatus: identified.identificationStatus,
      identifiedTitle: identified.identification?.suggestedTitle || "",
      identifiedScripture: identified.identification?.scriptureReferences || [],
      matchStatus: identified.matchStatus,
      matchScore: identified.topCandidate?.score || 0,
      duplicateDetected: true,
      sermonId,
      occasionId,
      mediaId,
      jobId,
      transcriptionStatus: job.status,
      rawTranscriptSourceId: job.rawSourceId,
      cleanedTranscriptSourceId: job.cleanedSourceId
    }, null, 2));
  } finally {
    const cleanupCounts = {};
    if (sermonId) {
      for (const collectionName of [
        "sermonSources",
        "sermonChunks",
        "sermonMedia",
        "sermonTranscriptionJobs",
        "sermonRecordingInbox",
        "sermonOccasions"
      ]) {
        cleanupCounts[collectionName] = await deleteWhere(firestore.collection(collectionName), "sermonId", sermonId);
      }
      await firestore.collection("sermons").doc(sermonId).delete().catch(() => {});
      cleanupCounts.sermons = 1;
    }
    if (inboxId) {
      await firestore.collection("sermonRecordingInbox").doc(inboxId).delete().catch(() => {});
    }
    await Promise.all(Array.from(executionIds, (executionId) =>
      firestore.collection("sermonOperationExecutions").doc(executionId).delete().catch(() => {})
    ));
    cleanupCounts.sermonOperationExecutions = executionIds.size;
    await Promise.all(Array.from(jobIds, (cleanupJobId) =>
      firestore.collection("sermonTranscriptionJobs").doc(cleanupJobId).delete().catch(() => {})
    ));
    await Promise.all(Array.from(storagePaths, (storagePath) =>
      bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => {})
    ));
    cleanupCounts.storageObjects = storagePaths.size;
    await firestore.terminate();
    console.error(`Acceptance cleanup: ${JSON.stringify(cleanupCounts)}`);
  }
}

await main();
