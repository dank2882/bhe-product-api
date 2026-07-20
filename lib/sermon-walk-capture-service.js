const { createHash, randomUUID } = require("node:crypto");
const {
  closeSermonDevelopmentSession,
  getSermon,
  startSermonDevelopmentSession
} = require("./sermon-workspace-service");

const WALK_CAPTURE_STATUSES = ["recording", "syncing", "incomplete", "complete"];
const WALK_TURN_SPEAKERS = ["dan", "assistant"];
const WALK_TURN_CAPTURE_STATUSES = ["completed", "failed"];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nowIso(deps = {}) {
  return typeof deps.now === "function" ? deps.now() : new Date().toISOString();
}

function fail(message, statusCode = 400, code = "sermon_walk_capture_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function requireCollection(collection, name) {
  if (!collection || typeof collection.doc !== "function") {
    throw fail(`${name} collection is not configured`, 500, "sermon_walk_collection_not_configured", { name });
  }
  return collection;
}

function positiveInteger(value, field) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw fail(`${field} must be a positive integer`, 400, "invalid_sermon_walk_sequence", { field, value });
  }
  return parsed;
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildTurnId(sessionId, itemId) {
  return `walk-turn-${hashText(`${sessionId}:${itemId}`).slice(0, 24)}`;
}

function buildChunkId(sessionId, sequence) {
  return `walk-audio-${hashText(`${sessionId}:${sequence}`).slice(0, 24)}`;
}

async function loadCollection(collection) {
  const snapshot = await collection.get();
  return (snapshot.docs || []).map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

async function loadSessionCollection(collection, sessionId) {
  if (typeof collection.where === "function") {
    const snapshot = await collection.where("sessionId", "==", sessionId).limit(10000).get();
    return (snapshot.docs || []).map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  }
  return (await loadCollection(collection)).filter(({ data }) => data.sessionId === sessionId);
}

async function getSessionRecord(sessionId, deps = {}) {
  const cleanSessionId = clean(sessionId);
  if (!cleanSessionId) throw fail("sessionId is required", 400, "sermon_walk_session_id_required");
  const collection = requireCollection(deps.sermonDevelopmentSessionsCollection, "sermonDevelopmentSessions");
  const docRef = collection.doc(cleanSessionId);
  const doc = await docRef.get();
  if (!doc.exists) throw fail("Sermon walk session not found", 404, "sermon_walk_session_not_found", { sessionId });
  return { docRef, session: { ...(doc.data() || {}), sessionId: cleanSessionId } };
}

async function loadSessionTurns(sessionId, deps = {}) {
  const collection = requireCollection(deps.sermonWalkTurnsCollection, "sermonWalkTurns");
  return (await loadSessionCollection(collection, sessionId))
    .map(({ id, data }) => ({ ...data, turnId: data.turnId || id }))
    .sort((left, right) => (left.sequence - right.sequence) || left.turnId.localeCompare(right.turnId));
}

async function loadSessionChunks(sessionId, deps = {}) {
  const collection = requireCollection(deps.sermonWalkAudioChunksCollection, "sermonWalkAudioChunks");
  return (await loadSessionCollection(collection, sessionId))
    .map(({ id, data }) => ({ ...data, chunkId: data.chunkId || id }))
    .sort((left, right) => left.sequence - right.sequence);
}

function summarizeTurn(turn = {}) {
  return {
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    sermonId: turn.sermonId,
    itemId: turn.itemId,
    previousItemId: turn.previousItemId || "",
    speaker: turn.speaker,
    sequence: turn.sequence,
    transcript: turn.transcript || "",
    transcriptSha256: turn.transcriptSha256 || "",
    captureStatus: turn.captureStatus || "completed",
    audioStartMs: Number(turn.audioStartMs) || 0,
    audioEndMs: Number(turn.audioEndMs) || 0,
    createdAt: turn.createdAt || "",
    updatedAt: turn.updatedAt || ""
  };
}

function summarizeChunk(chunk = {}) {
  return {
    chunkId: chunk.chunkId,
    sessionId: chunk.sessionId,
    sermonId: chunk.sermonId,
    sequence: chunk.sequence,
    storagePath: chunk.storagePath || "",
    contentType: chunk.contentType || "",
    sizeBytes: Number(chunk.sizeBytes) || 0,
    sha256: chunk.sha256 || "",
    startedAtMs: Number(chunk.startedAtMs) || 0,
    endedAtMs: Number(chunk.endedAtMs) || 0,
    createdAt: chunk.createdAt || ""
  };
}

function uniqueStrings(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean)));
}

function findMissingSequences(chunks, finalChunkSequence) {
  if (!finalChunkSequence) return [];
  const found = new Set(chunks.map((chunk) => chunk.sequence));
  const missing = [];
  for (let sequence = 1; sequence <= finalChunkSequence; sequence += 1) {
    if (!found.has(sequence)) missing.push(sequence);
  }
  return missing;
}

function buildCaptureIntegrity({ session, turns, chunks, expectedUserItemIds, finalChunkSequence, clientPendingUploadCount }) {
  const expected = uniqueStrings(expectedUserItemIds.length ? expectedUserItemIds : session.expectedUserItemIds);
  const completedDanItems = new Set(turns
    .filter((turn) => turn.speaker === "dan" && turn.captureStatus === "completed" && clean(turn.transcript))
    .map((turn) => turn.itemId));
  const failedDanItems = turns
    .filter((turn) => turn.speaker === "dan" && turn.captureStatus === "failed")
    .map((turn) => turn.itemId);
  const missingUserItemIds = expected.filter((itemId) => !completedDanItems.has(itemId));
  const lastChunkSequence = finalChunkSequence || Number(session.finalChunkSequence) || 0;
  const missingAudioSequences = findMissingSequences(chunks, lastChunkSequence);
  const pendingUploads = Number.isFinite(Number(clientPendingUploadCount))
    ? Math.max(0, Number(clientPendingUploadCount))
    : Number(session.clientPendingUploadCount) || 0;
  const checks = {
    hasFinalAudio: Boolean(clean(session.finalAudioStoragePath)),
    hasAudioChunks: chunks.length > 0,
    hasExpectedUserTurns: expected.length > 0,
    audioSequenceComplete: lastChunkSequence > 0 && missingAudioSequences.length === 0 && chunks.length === lastChunkSequence,
    transcriptTurnsComplete: expected.length > 0 && missingUserItemIds.length === 0 && failedDanItems.length === 0,
    clientUploadsComplete: pendingUploads === 0
  };
  const complete = Object.values(checks).every(Boolean);
  return {
    complete,
    checks,
    expectedUserTurnCount: expected.length,
    completedUserTurnCount: completedDanItems.size,
    assistantTurnCount: turns.filter((turn) => turn.speaker === "assistant" && turn.captureStatus === "completed").length,
    audioChunkCount: chunks.length,
    finalChunkSequence: lastChunkSequence,
    pendingUploadCount: pendingUploads,
    missingUserItemIds,
    failedUserItemIds: failedDanItems,
    missingAudioSequences,
    finalAudioStoragePath: clean(session.finalAudioStoragePath),
    finalAudioSha256: clean(session.finalAudioSha256),
    finalAudioSizeBytes: Number(session.finalAudioSizeBytes) || 0
  };
}

async function createSermonWalkSession(input = {}, deps = {}) {
  const sermonId = clean(input.sermonId);
  if (!sermonId) throw fail("sermonId is required", 400, "sermon_walk_sermon_id_required");
  const { sermon } = await getSermon({ sermonId }, deps);
  const started = await startSermonDevelopmentSession({
    sermonId,
    mode: "walk",
    label: clean(input.label) || `Sermon walk - ${sermon.title}`,
    context: clean(input.context)
  }, deps);
  const sessionCollection = requireCollection(deps.sermonDevelopmentSessionsCollection, "sermonDevelopmentSessions");
  const sessionDoc = sessionCollection.doc(started.session.sessionId);
  const timestamp = nowIso(deps);
  const session = {
    ...started.session,
    captureVersion: 1,
    captureStatus: "recording",
    expectedUserItemIds: [],
    finalChunkSequence: 0,
    clientPendingUploadCount: 0,
    finalAudioStoragePath: "",
    finalAudioSha256: "",
    finalAudioSizeBytes: 0,
    liveTranscriptSourceId: "",
    highAccuracyTranscriptSourceId: "",
    highAccuracyTranscriptStatus: "not_started",
    captureManifestSha256: "",
    captureStartedAt: timestamp,
    captureCompletedAt: "",
    updatedAt: timestamp
  };
  await sessionDoc.set(session);
  return {
    sermon: {
      sermonId: sermon.sermonId,
      title: sermon.title,
      scriptureText: sermon.scriptureText,
      bigIdea: sermon.bigIdea
    },
    session
  };
}

async function saveSermonWalkTurn(input = {}, deps = {}) {
  const { session } = await getSessionRecord(input.sessionId, deps);
  if (session.captureStatus === "complete" || session.status === "closed") {
    throw fail("Sermon walk session is already complete", 409, "sermon_walk_session_complete");
  }
  const itemId = clean(input.itemId);
  if (!itemId) throw fail("itemId is required", 400, "sermon_walk_item_id_required");
  const speaker = clean(input.speaker).toLowerCase();
  if (!WALK_TURN_SPEAKERS.includes(speaker)) {
    throw fail("Invalid sermon walk speaker", 400, "invalid_sermon_walk_speaker", { speaker });
  }
  const captureStatus = clean(input.captureStatus) || "completed";
  if (!WALK_TURN_CAPTURE_STATUSES.includes(captureStatus)) {
    throw fail("Invalid sermon walk turn status", 400, "invalid_sermon_walk_turn_status", { captureStatus });
  }
  const transcript = clean(input.transcript);
  if (captureStatus === "completed" && !transcript) {
    throw fail("Completed sermon walk turns require a transcript", 400, "sermon_walk_transcript_required");
  }
  if (transcript.length > 50000) {
    throw fail("Sermon walk turn transcript is too large", 413, "sermon_walk_transcript_too_large");
  }
  const sequence = positiveInteger(input.sequence, "sequence");
  const turnId = buildTurnId(session.sessionId, itemId);
  const collection = requireCollection(deps.sermonWalkTurnsCollection, "sermonWalkTurns");
  const docRef = collection.doc(turnId);
  const existing = await docRef.get();
  const transcriptSha256 = hashText(transcript);
  if (existing.exists) {
    const current = { ...(existing.data() || {}), turnId };
    if (current.transcriptSha256 !== transcriptSha256 || current.speaker !== speaker) {
      throw fail("A different transcript is already saved for this voice turn", 409, "sermon_walk_turn_conflict", {
        itemId,
        turnId
      });
    }
    return { action: "replayed", receipt: summarizeTurn(current) };
  }
  const timestamp = nowIso(deps);
  const turn = {
    turnId,
    sessionId: session.sessionId,
    sermonId: session.sermonId,
    itemId,
    previousItemId: clean(input.previousItemId),
    speaker,
    sequence,
    transcript,
    transcriptSha256,
    captureStatus,
    audioStartMs: Math.max(0, Number(input.audioStartMs) || 0),
    audioEndMs: Math.max(0, Number(input.audioEndMs) || 0),
    source: clean(input.source) || "openai_realtime",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await docRef.create(turn);
  return { action: "created", receipt: summarizeTurn(turn) };
}

async function registerSermonWalkAudioChunk(input = {}, deps = {}) {
  const { session } = await getSessionRecord(input.sessionId, deps);
  if (session.captureStatus === "complete" || session.status === "closed") {
    throw fail("Sermon walk session is already complete", 409, "sermon_walk_session_complete");
  }
  const sequence = positiveInteger(input.sequence, "sequence");
  const sha256 = clean(input.sha256);
  const storagePath = clean(input.storagePath);
  if (!/^[a-f0-9]{64}$/i.test(sha256) || !storagePath) {
    throw fail("Audio chunk requires storagePath and SHA-256", 400, "invalid_sermon_walk_audio_chunk");
  }
  const chunkId = buildChunkId(session.sessionId, sequence);
  const collection = requireCollection(deps.sermonWalkAudioChunksCollection, "sermonWalkAudioChunks");
  const docRef = collection.doc(chunkId);
  const existing = await docRef.get();
  if (existing.exists) {
    const current = { ...(existing.data() || {}), chunkId };
    if (current.sha256 !== sha256) {
      throw fail("A different audio chunk is already saved at this sequence", 409, "sermon_walk_audio_chunk_conflict", {
        sequence,
        chunkId
      });
    }
    return { action: "replayed", receipt: summarizeChunk(current) };
  }
  const timestamp = nowIso(deps);
  const chunk = {
    chunkId,
    sessionId: session.sessionId,
    sermonId: session.sermonId,
    sequence,
    storagePath,
    contentType: clean(input.contentType) || "application/octet-stream",
    sizeBytes: Math.max(0, Number(input.sizeBytes) || 0),
    sha256: sha256.toLowerCase(),
    startedAtMs: Math.max(0, Number(input.startedAtMs) || 0),
    endedAtMs: Math.max(0, Number(input.endedAtMs) || 0),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await docRef.create(chunk);
  return { action: "created", receipt: summarizeChunk(chunk) };
}

async function registerSermonWalkFinalAudio(input = {}, deps = {}) {
  const { docRef, session } = await getSessionRecord(input.sessionId, deps);
  const storagePath = clean(input.storagePath);
  const sha256 = clean(input.sha256).toLowerCase();
  if (!storagePath || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw fail("Final audio requires storagePath and SHA-256", 400, "invalid_sermon_walk_final_audio");
  }
  if (session.finalAudioSha256 && session.finalAudioSha256 !== sha256) {
    throw fail("A different final audio recording is already registered", 409, "sermon_walk_final_audio_conflict");
  }
  const timestamp = nowIso(deps);
  const next = {
    ...session,
    captureStatus: "syncing",
    finalAudioStoragePath: storagePath,
    finalAudioSha256: sha256,
    finalAudioSizeBytes: Math.max(0, Number(input.sizeBytes) || 0),
    finalAudioContentType: clean(input.contentType) || "application/octet-stream",
    highAccuracyTranscriptStatus: session.highAccuracyTranscriptStatus === "ready" ? "ready" : "pending",
    updatedAt: timestamp
  };
  await docRef.set(next);
  return {
    action: session.finalAudioSha256 ? "replayed" : "registered",
    finalAudio: {
      storagePath: next.finalAudioStoragePath,
      sha256: next.finalAudioSha256,
      sizeBytes: next.finalAudioSizeBytes,
      contentType: next.finalAudioContentType
    }
  };
}

async function saveSermonWalkHighAccuracyTranscript(input = {}, deps = {}) {
  const { docRef, session } = await getSessionRecord(input.sessionId, deps);
  const sourceId = clean(input.sourceId);
  const status = clean(input.status) || (sourceId ? "ready" : "failed");
  const next = {
    ...session,
    highAccuracyTranscriptSourceId: sourceId,
    highAccuracyTranscriptStatus: status,
    highAccuracyTranscriptError: clean(input.error),
    updatedAt: nowIso(deps)
  };
  await docRef.set(next);
  return { sourceId, status };
}

async function getSermonWalkCaptureStatus(input = {}, deps = {}) {
  const { session } = await getSessionRecord(input.sessionId, deps);
  const turns = await loadSessionTurns(session.sessionId, deps);
  const chunks = await loadSessionChunks(session.sessionId, deps);
  const integrity = buildCaptureIntegrity({
    session,
    turns,
    chunks,
    expectedUserItemIds: uniqueStrings(input.expectedUserItemIds),
    finalChunkSequence: Number(input.finalChunkSequence) || 0,
    clientPendingUploadCount: input.clientPendingUploadCount
  });
  return {
    session: {
      sessionId: session.sessionId,
      sermonId: session.sermonId,
      label: session.label || "",
      status: session.status || "active",
      captureStatus: session.captureStatus || "recording",
      captureStartedAt: session.captureStartedAt || session.startedAt || "",
      captureCompletedAt: session.captureCompletedAt || "",
      liveTranscriptSourceId: session.liveTranscriptSourceId || session.rawTranscriptSourceId || "",
      highAccuracyTranscriptSourceId: session.highAccuracyTranscriptSourceId || "",
      highAccuracyTranscriptStatus: session.highAccuracyTranscriptStatus || "not_started"
    },
    integrity,
    turns: turns.map(summarizeTurn),
    audioChunks: chunks.map(summarizeChunk)
  };
}

function formatWalkTranscript(turns) {
  return turns
    .filter((turn) => turn.captureStatus === "completed" && clean(turn.transcript))
    .map((turn) => [
      `TURN ${turn.sequence} - ${turn.speaker === "dan" ? "DAN" : "ASSISTANT"}`,
      `Realtime item: ${turn.itemId}`,
      turn.transcript
    ].join("\n"))
    .join("\n\n");
}

async function finalizeSermonWalkCapture(input = {}, deps = {}) {
  const { docRef, session } = await getSessionRecord(input.sessionId, deps);
  if (session.captureStatus === "complete" && session.status === "closed") {
    return getSermonWalkCaptureStatus({ sessionId: session.sessionId }, deps);
  }
  const expectedUserItemIds = uniqueStrings(input.expectedUserItemIds);
  const finalChunkSequence = positiveInteger(input.finalChunkSequence, "finalChunkSequence");
  const clientPendingUploadCount = Math.max(0, Number(input.clientPendingUploadCount) || 0);
  const timestamp = nowIso(deps);
  const pendingSession = {
    ...session,
    captureStatus: "syncing",
    expectedUserItemIds,
    finalChunkSequence,
    clientPendingUploadCount,
    updatedAt: timestamp
  };
  await docRef.set(pendingSession);
  const turns = await loadSessionTurns(session.sessionId, deps);
  const chunks = await loadSessionChunks(session.sessionId, deps);
  const integrity = buildCaptureIntegrity({
    session: pendingSession,
    turns,
    chunks,
    expectedUserItemIds,
    finalChunkSequence,
    clientPendingUploadCount
  });
  if (!integrity.complete) {
    await docRef.set({
      ...pendingSession,
      captureStatus: "incomplete",
      captureIntegrity: integrity,
      updatedAt: nowIso(deps)
    });
    throw fail("Sermon walk capture is incomplete and was not closed", 409, "sermon_walk_capture_incomplete", integrity);
  }

  const transcript = formatWalkTranscript(turns);
  const manifestSha256 = hashText(JSON.stringify({
    expectedUserItemIds,
    finalChunkSequence,
    turnReceipts: turns.map((turn) => [turn.itemId, turn.transcriptSha256, turn.captureStatus]),
    audioReceipts: chunks.map((chunk) => [chunk.sequence, chunk.sha256]),
    finalAudioSha256: pendingSession.finalAudioSha256
  }));
  const closed = await closeSermonDevelopmentSession({
    sessionId: session.sessionId,
    summary: clean(input.summary),
    rawTranscript: transcript,
    sourceLabel: clean(input.sourceLabel) || `${session.label || "Sermon walk"} - lossless live transcript`,
    sourceRefs: [
      { type: "sermon_walk_capture_manifest", id: manifestSha256 },
      { type: "cloud_storage_audio", path: pendingSession.finalAudioStoragePath }
    ]
  }, deps);
  const completeSession = {
    ...(await getSessionRecord(session.sessionId, deps)).session,
    captureStatus: "complete",
    captureIntegrity: integrity,
    captureManifestSha256: manifestSha256,
    liveTranscriptSourceId: closed.transcriptSource?.sourceId || closed.session.rawTranscriptSourceId || "",
    captureCompletedAt: nowIso(deps),
    updatedAt: nowIso(deps)
  };
  await docRef.set(completeSession);
  return getSermonWalkCaptureStatus({ sessionId: session.sessionId }, deps);
}

module.exports = {
  WALK_CAPTURE_STATUSES,
  createSermonWalkSession,
  finalizeSermonWalkCapture,
  getSermonWalkCaptureStatus,
  registerSermonWalkAudioChunk,
  registerSermonWalkFinalAudio,
  saveSermonWalkHighAccuracyTranscript,
  saveSermonWalkTurn
};
