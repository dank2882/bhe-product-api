"use strict";

const { randomUUID } = require("node:crypto");
const {
  createSermonMediaTranscriptSource,
  getSermon,
  getSermonMedia,
  getSermonSource,
  linkSermonMediaToOccasion,
  rebuildSermonChunks,
  updateSermonMedia
} = require("./sermon-workspace-service");

const TRANSCRIPTION_JOB_STATUSES = ["queued", "processing", "completed", "failed"];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createJobError(message, statusCode = 400, code = "sermon_transcription_job_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function getJobsCollection(deps = {}) {
  const collection = deps.sermonTranscriptionJobsCollection;
  if (!collection || typeof collection.doc !== "function") {
    throw createJobError(
      "Sermon transcription jobs are not configured",
      500,
      "sermon_transcription_jobs_not_configured"
    );
  }
  return collection;
}

async function loadJobs(collection, maximum = 1000) {
  const snapshot = await collection.limit(maximum).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function buildJobSummary(job = {}, fallbackId = "") {
  return {
    jobId: normalizeString(job.jobId || fallbackId),
    targetType: normalizeString(job.targetType) || "sermon_media",
    inboxId: normalizeString(job.inboxId),
    sermonId: normalizeString(job.sermonId),
    mediaId: normalizeString(job.mediaId),
    occasionId: normalizeString(job.occasionId),
    status: TRANSCRIPTION_JOB_STATUSES.includes(job.status) ? job.status : "queued",
    stage: normalizeString(job.stage) || "queued",
    cleanTranscript: job.cleanTranscript !== false,
    rebuildChunks: job.rebuildChunks !== false,
    rawSourceId: normalizeString(job.rawSourceId),
    cleanedSourceId: normalizeString(job.cleanedSourceId),
    rawCharacterCount: Number(job.rawCharacterCount) || 0,
    cleanedCharacterCount: Number(job.cleanedCharacterCount) || 0,
    transcriptionMethod: normalizeString(job.transcriptionMethod),
    transcriptionModel: normalizeString(job.transcriptionModel),
    cleanupModel: normalizeString(job.cleanupModel),
    attemptCount: Number(job.attemptCount) || 0,
    errorCode: normalizeString(job.errorCode),
    errorMessage: normalizeString(job.errorMessage),
    nextAction: normalizeString(job.nextAction),
    queuedAt: normalizeString(job.queuedAt || job.createdAt),
    startedAt: normalizeString(job.startedAt),
    completedAt: normalizeString(job.completedAt),
    createdAt: normalizeString(job.createdAt),
    updatedAt: normalizeString(job.updatedAt)
  };
}

async function findReusableJob({ sermonId, mediaId, cleanTranscript, rebuildChunks }, deps) {
  const records = await loadJobs(getJobsCollection(deps), 1000);
  const match = records
    .filter(({ data }) => normalizeString(data.sermonId) === sermonId)
    .filter(({ data }) => normalizeString(data.mediaId) === mediaId)
    .filter(({ data }) => ["queued", "processing", "completed"].includes(data.status))
    .filter(({ data }) => cleanTranscript !== true || data.cleanTranscript !== false)
    .filter(({ data }) => rebuildChunks !== true || data.rebuildChunks !== false)
    .sort((left, right) => normalizeString(right.data.createdAt).localeCompare(normalizeString(left.data.createdAt)))[0];
  return match ? buildJobSummary(match.data, match.id) : null;
}

async function resolveMediaForJob(input, deps) {
  const mediaId = normalizeString(input.mediaId);
  if (mediaId) return (await getSermonMedia({ mediaId }, deps)).media;
  const sermonId = normalizeString(input.sermonId);
  if (!sermonId) {
    throw createJobError(
      "Provide mediaId or sermonId with one attached/public recording",
      400,
      "sermon_transcription_media_required"
    );
  }
  if (typeof deps.importSermonRecording !== "function") {
    throw createJobError(
      "Sermon recording import is not configured",
      500,
      "sermon_recording_import_not_configured"
    );
  }
  const imported = await deps.importSermonRecording(input);
  if (!imported?.media?.mediaId) {
    throw createJobError(
      "Sermon recording import did not return a media record",
      502,
      "sermon_recording_import_failed"
    );
  }
  return imported.media;
}

async function startSermonTranscription(input = {}, deps = {}) {
  const media = await resolveMediaForJob(input, deps);
  const sermonId = normalizeString(input.sermonId) || normalizeString(media.sermonId);
  if (!sermonId || sermonId !== normalizeString(media.sermonId)) {
    throw createJobError(
      "The selected media belongs to another sermon",
      409,
      "sermon_transcription_media_mismatch",
      { requestedSermonId: normalizeString(input.sermonId), mediaSermonId: media.sermonId }
    );
  }
  const occasionId = normalizeString(input.occasionId) || normalizeString(media.occasionId);
  if (occasionId && occasionId !== normalizeString(media.occasionId)) {
    await linkSermonMediaToOccasion({ sermonId, mediaId: media.mediaId, occasionId }, deps);
  }
  if (input.force !== true) {
    const reusable = await findReusableJob({
      sermonId,
      mediaId: media.mediaId,
      cleanTranscript: input.cleanTranscript !== false,
      rebuildChunks: input.rebuildChunks !== false
    }, deps);
    if (reusable) {
      return { job: reusable, media, reused: true, queued: ["queued", "processing"].includes(reusable.status) };
    }
  }
  const nowIso = getNowIso(deps);
  const jobId = normalizeString(input.jobId) || `sermon-transcription-${randomUUID().slice(0, 8)}`;
  const job = {
    jobId,
    sermonId,
    mediaId: media.mediaId,
    occasionId,
    status: "queued",
    stage: "queued",
    cleanTranscript: input.cleanTranscript !== false,
    rebuildChunks: input.rebuildChunks !== false,
    rawSourceId: "",
    cleanedSourceId: "",
    rawCharacterCount: 0,
    cleanedCharacterCount: 0,
    transcriptionMethod: "",
    transcriptionModel: "",
    cleanupModel: "",
    prompt: normalizeString(input.prompt),
    cleanupInstructions: normalizeString(input.cleanupInstructions),
    attemptCount: 0,
    errorCode: "",
    errorMessage: "",
    nextAction: "Wait for completion, then review the cleaned transcript before post-sermon analysis.",
    queuedAt: nowIso,
    startedAt: "",
    completedAt: "",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  const docRef = getJobsCollection(deps).doc(jobId);
  await docRef.create(job);
  try {
    if (typeof deps.enqueueSermonTranscriptionJob !== "function") {
      throw createJobError(
        "Sermon transcription queue is not configured",
        500,
        "sermon_transcription_queue_not_configured"
      );
    }
    await deps.enqueueSermonTranscriptionJob({ jobId });
  } catch (error) {
    const failed = {
      ...job,
      status: "failed",
      stage: "queue_failed",
      errorCode: normalizeString(error.code) || "sermon_transcription_enqueue_failed",
      errorMessage: normalizeString(error.message) || "Transcription job could not be queued",
      nextAction: "Retry startSermonTranscription with the same media after the queue is available.",
      updatedAt: getNowIso(deps)
    };
    await docRef.set(failed);
    throw error;
  }
  return { job: buildJobSummary(job, jobId), media, reused: false, queued: true };
}

async function getSermonTranscriptionJob(input = {}, deps = {}) {
  const jobId = normalizeString(input.jobId);
  if (!jobId) throw createJobError("jobId is required", 400, "sermon_transcription_job_id_required");
  const doc = await getJobsCollection(deps).doc(jobId).get();
  if (!doc.exists) {
    throw createJobError("Sermon transcription job not found", 404, "sermon_transcription_job_not_found", { jobId });
  }
  return { job: buildJobSummary(doc.data() || {}, jobId) };
}

async function listSermonTranscriptionJobs(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  const mediaId = normalizeString(input.mediaId);
  const status = normalizeString(input.status);
  const limit = Math.min(Math.max(Number.parseInt(input.limit, 10) || 50, 1), 200);
  if (status && !TRANSCRIPTION_JOB_STATUSES.includes(status)) {
    throw createJobError("Invalid transcription job status", 400, "invalid_sermon_transcription_job_status", {
      status,
      allowedValues: TRANSCRIPTION_JOB_STATUSES
    });
  }
  const jobs = (await loadJobs(getJobsCollection(deps), 10000))
    .filter(({ data }) => !sermonId || normalizeString(data.sermonId) === sermonId)
    .filter(({ data }) => !mediaId || normalizeString(data.mediaId) === mediaId)
    .filter(({ data }) => !status || data.status === status)
    .sort((left, right) => normalizeString(right.data.createdAt).localeCompare(normalizeString(left.data.createdAt)))
    .slice(0, limit)
    .map(({ id, data }) => buildJobSummary(data, id));
  return { count: jobs.length, jobs };
}

async function processSermonTranscriptionJob(input = {}, deps = {}) {
  const jobId = normalizeString(input.jobId);
  const collection = getJobsCollection(deps);
  const docRef = collection.doc(jobId);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createJobError("Sermon transcription job not found", 404, "sermon_transcription_job_not_found", { jobId });
  }
  const existing = { ...(doc.data() || {}), jobId };
  if (existing.status === "completed") return { job: buildJobSummary(existing, jobId), replayed: true };
  const startedAt = getNowIso(deps);
  let working = {
    ...existing,
    status: "processing",
    stage: "loading_media",
    attemptCount: (Number(existing.attemptCount) || 0) + 1,
    startedAt: normalizeString(existing.startedAt) || startedAt,
    errorCode: "",
    errorMessage: "",
    updatedAt: startedAt
  };
  await docRef.set(working);
  let rawSource = null;
  try {
    if (normalizeString(existing.targetType) === "recording_inbox") {
      const inboxDoc = await deps.sermonRecordingInboxCollection.doc(existing.inboxId).get();
      if (!inboxDoc.exists) {
        throw createJobError("Recording inbox item not found", 404, "recording_inbox_item_not_found", { inboxId: existing.inboxId });
      }
      const recording = { ...(inboxDoc.data() || {}), inboxId: existing.inboxId };
      working = { ...working, stage: "transcribing_for_identification", updatedAt: getNowIso(deps) };
      await docRef.set(working);
      if (typeof deps.transcribeSermonMedia !== "function") {
        throw createJobError("Sermon media transcription is not configured", 500, "sermon_media_transcriber_not_configured");
      }
      const transcription = await deps.transcribeSermonMedia({
        media: {
          mediaId: "",
          storagePath: recording.storagePath,
          contentType: recording.contentType,
          originalFilename: recording.originalFilename,
          label: recording.originalFilename
        },
        prompt: existing.prompt
      });
      working = { ...working, stage: "extracting_identification_clues", updatedAt: getNowIso(deps) };
      await docRef.set(working);
      const identification = typeof deps.analyzeUnmatchedRecordingTranscript === "function"
        ? await deps.analyzeUnmatchedRecordingTranscript({
            transcriptText: transcription.text,
            recording
          })
        : null;
      if (typeof deps.completeUnmatchedRecordingIdentification !== "function") {
        throw createJobError("Recording identification completion is not configured", 500, "recording_identification_not_configured");
      }
      const completedInbox = await deps.completeUnmatchedRecordingIdentification({
        inboxId: existing.inboxId,
        transcriptText: transcription.text,
        identification
      }, deps);
      const completedAt = getNowIso(deps);
      const completed = {
        ...working,
        status: "completed",
        stage: "completed",
        rawCharacterCount: normalizeString(transcription.text).length,
        transcriptionMethod: normalizeString(transcription.method) || "openai_transcription",
        transcriptionModel: normalizeString(transcription.model),
        completedAt,
        updatedAt: completedAt,
        nextAction: "Review the recording clues and ranked matches, then confirm the exact sermon and occasion or create a new sermon hub."
      };
      await docRef.set(completed);
      return {
        job: buildJobSummary(completed, jobId),
        recording: completedInbox.recording,
        replayed: false
      };
    }
    const media = (await getSermonMedia({ mediaId: existing.mediaId }, deps)).media;
    const sermon = (await getSermon({ sermonId: existing.sermonId }, deps)).sermon;
    const rawSourceId = normalizeString(media.transcriptSourceIds?.raw);
    if (rawSourceId) {
      rawSource = (await getSermonSource({ sourceId: rawSourceId }, deps)).source;
    } else {
      working = { ...working, stage: "transcribing", updatedAt: getNowIso(deps) };
      await docRef.set(working);
      if (typeof deps.transcribeSermonMedia !== "function") {
        throw createJobError("Sermon media transcription is not configured", 500, "sermon_media_transcriber_not_configured");
      }
      const transcription = await deps.transcribeSermonMedia({ media, prompt: existing.prompt });
      const saved = await createSermonMediaTranscriptSource({
        mediaId: media.mediaId,
        transcriptKind: "raw",
        transcriptText: transcription.text,
        sourceLabel: `Raw preached transcript - ${media.label || sermon.title}`,
        summary: [
          `Raw preached transcript generated with ${transcription.model || "transcription service"}.`,
          transcription.method ? `Method: ${transcription.method}.` : "",
          existing.occasionId ? `Occasion: ${existing.occasionId}.` : ""
        ].filter(Boolean).join("\n"),
        sourceRefs: existing.occasionId ? [{ type: "sermon_occasion", occasionId: existing.occasionId }] : []
      }, deps);
      rawSource = saved.source;
      working.transcriptionMethod = normalizeString(transcription.method) || "openai_transcription";
      working.transcriptionModel = normalizeString(transcription.model);
    }
    working.rawSourceId = rawSource.sourceId;
    working.rawCharacterCount = normalizeString(rawSource.material).length;
    let cleanedSource = null;
    if (existing.cleanTranscript !== false) {
      const refreshedMedia = (await getSermonMedia({ mediaId: existing.mediaId }, deps)).media;
      const cleanedSourceId = normalizeString(refreshedMedia.transcriptSourceIds?.cleaned);
      if (cleanedSourceId) {
        cleanedSource = (await getSermonSource({ sourceId: cleanedSourceId }, deps)).source;
      } else {
        working = { ...working, stage: "cleaning_transcript", updatedAt: getNowIso(deps) };
        await docRef.set(working);
        if (typeof deps.cleanSermonTranscript !== "function") {
          throw createJobError("Sermon transcript cleanup is not configured", 500, "sermon_transcript_cleanup_not_configured");
        }
        const cleanup = await deps.cleanSermonTranscript({
          transcriptText: rawSource.material,
          sermon,
          media,
          instructions: existing.cleanupInstructions
        });
        const saved = await createSermonMediaTranscriptSource({
          mediaId: media.mediaId,
          transcriptKind: "cleaned",
          transcriptText: cleanup.text,
          sourceLabel: `Cleaned preached transcript - ${media.label || sermon.title}`,
          summary: `Conservatively cleaned from raw transcript ${rawSource.sourceId}; wording and sermon sequence preserved.`,
          sourceRefs: [
            { type: "sermon_source", sourceId: rawSource.sourceId, role: "raw_transcript" },
            ...(existing.occasionId ? [{ type: "sermon_occasion", occasionId: existing.occasionId }] : [])
          ]
        }, deps);
        cleanedSource = saved.source;
        working.cleanupModel = normalizeString(cleanup.model);
      }
      working.cleanedSourceId = cleanedSource.sourceId;
      working.cleanedCharacterCount = normalizeString(cleanedSource.material).length;
    }
    let rebuild = null;
    if (existing.rebuildChunks !== false) {
      working = { ...working, stage: "rebuilding_search", updatedAt: getNowIso(deps) };
      await docRef.set(working);
      rebuild = await rebuildSermonChunks({ sermonId: existing.sermonId }, deps);
    }
    const completedAt = getNowIso(deps);
    const completed = {
      ...working,
      status: "completed",
      stage: "completed",
      completedAt,
      updatedAt: completedAt,
      nextAction: "Review the cleaned transcript, then run the post-sermon comparison and commentary proposal workflow."
    };
    await docRef.set(completed);
    return {
      job: buildJobSummary(completed, jobId),
      rawSource: rawSource ? { sourceId: rawSource.sourceId, sourceType: rawSource.sourceType } : null,
      cleanedSource: cleanedSource ? { sourceId: cleanedSource.sourceId, sourceType: cleanedSource.sourceType } : null,
      rebuild,
      replayed: false
    };
  } catch (error) {
    const failedAt = getNowIso(deps);
    const failed = {
      ...working,
      status: "failed",
      stage: `${working.stage || "processing"}_failed`,
      errorCode: normalizeString(error.code) || "sermon_transcription_processing_failed",
      errorMessage: normalizeString(error.message) || "Sermon transcription processing failed",
      nextAction: rawSource
        ? "The raw transcript was preserved. Retry to continue cleanup and indexing."
        : "Check the recording and retry the transcription job.",
      updatedAt: failedAt
    };
    await docRef.set(failed);
    if (normalizeString(existing.targetType) === "recording_inbox" && typeof deps.failUnmatchedRecordingIdentification === "function") {
      await deps.failUnmatchedRecordingIdentification({
        inboxId: existing.inboxId,
        errorMessage: failed.errorMessage
      }, deps).catch(() => {});
    }
    if (!rawSource && normalizeString(existing.mediaId)) {
      await updateSermonMedia({ mediaId: existing.mediaId, changes: { transcriptStatus: "failed" } }, deps).catch(() => {});
    }
    throw error;
  }
}

module.exports = {
  TRANSCRIPTION_JOB_STATUSES,
  getSermonTranscriptionJob,
  listSermonTranscriptionJobs,
  processSermonTranscriptionJob,
  startSermonTranscription
};
