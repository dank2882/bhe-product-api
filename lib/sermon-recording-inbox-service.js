"use strict";

const { randomUUID } = require("node:crypto");
const {
  createSermon,
  createSermonOccasion,
  createSermonMedia,
  createSermonMediaTranscriptSource,
  getSermon,
  getSermonMedia
} = require("./sermon-workspace-service");
const {
  getSermonTranscriptionJob,
  startSermonTranscription
} = require("./sermon-transcription-job-service");

const INBOX_STATUSES = ["unmatched", "matched", "ignored", "failed"];
const IDENTIFICATION_STATUSES = ["not_started", "queued", "processing", "completed", "failed"];
const MAX_BATCH_SIZE = 50;
const MAX_IDENTIFICATION_TRANSCRIPT_CHARACTERS = 300000;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTokens(value) {
  const stop = new Set([
    "sermon", "lesson", "message", "audio", "recording", "sunday", "morning", "evening", "night", "service",
    "the", "and", "for", "that", "this", "these", "those", "with", "from", "into", "unto", "are", "was", "were",
    "been", "being", "have", "has", "had", "does", "not", "all", "things", "will", "would", "can", "could", "our",
    "your", "their", "his", "her", "you", "they", "them", "who", "what", "when", "where", "why", "how"
  ]);
  return Array.from(new Set(normalizeString(value).toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stop.has(token))));
}

function createInboxError(message, statusCode = 400, code = "sermon_recording_inbox_error", details = {}) {
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

function getCollection(deps, name) {
  const collection = deps[name];
  if (!collection || typeof collection.doc !== "function") {
    throw createInboxError(`${name} is not configured`, 500, "sermon_recording_inbox_not_configured");
  }
  return collection;
}

async function loadCollection(collection, maximum = 10000) {
  const snapshot = await collection.limit(maximum).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function normalizeYear(value) {
  const year = Number(value);
  if (year >= 1000 && year <= 9999) return year;
  if (year >= 0 && year <= 69) return 2000 + year;
  if (year >= 70 && year <= 99) return 1900 + year;
  return 0;
}

function validDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeTime(hourValue, minuteValue, meridiem = "") {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  const marker = normalizeString(meridiem).toLowerCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  if (marker) {
    if (hour < 1 || hour > 12) return "";
    if (marker === "pm" && hour !== 12) hour += 12;
    if (marker === "am" && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseRecordingFilename(filename) {
  const name = normalizeString(filename).replace(/\.[a-z0-9]{2,5}$/i, "");
  let date = "";
  let dateMatch = null;
  let format = "";
  const iso = name.match(/(?:^|\D)((?:19|20)\d{2})[-_. ](0?[1-9]|1[0-2])[-_. ]([0-2]?\d|3[01])(?:\D|$)/);
  const compact = name.match(/(?:^|\D)((?:19|20)\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\D|$)/);
  const us = name.match(/(?:^|\D)(0?[1-9]|1[0-2])[-_. ]([0-2]?\d|3[01])[-_. ]((?:19|20)?\d{2})(?:\D|$)/);
  if (iso) {
    dateMatch = iso;
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (validDateParts(year, month, day)) date = formatDate(year, month, day);
    format = "iso_date";
  } else if (compact) {
    dateMatch = compact;
    const year = Number(compact[1]);
    const month = Number(compact[2]);
    const day = Number(compact[3]);
    if (validDateParts(year, month, day)) date = formatDate(year, month, day);
    format = "compact_date";
  } else if (us) {
    dateMatch = us;
    const year = normalizeYear(us[3]);
    const month = Number(us[1]);
    const day = Number(us[2]);
    if (validDateParts(year, month, day)) date = formatDate(year, month, day);
    format = "us_date";
  }
  let time = "";
  const meridiemMatch = name.match(/(?:^|\D)(1[0-2]|0?[1-9])[:._-]([0-5]\d)\s*([ap]m)(?:\D|$)/i) ||
    name.match(/(?:^|\D)(1[0-2]|0?[1-9])\s*([ap]m)(?:\D|$)/i);
  if (meridiemMatch) {
    time = meridiemMatch.length >= 4
      ? normalizeTime(meridiemMatch[1], meridiemMatch[2], meridiemMatch[3])
      : normalizeTime(meridiemMatch[1], 0, meridiemMatch[2]);
  } else if (dateMatch) {
    const remainder = name.slice((dateMatch.index || 0) + dateMatch[0].length);
    const clock = remainder.match(/(?:^|\D)([01]?\d|2[0-3])[:._-]([0-5]\d)(?:[:._-][0-5]\d)?(?:\D|$)/) ||
      remainder.match(/(?:^|\D)([01]\d|2[0-3])([0-5]\d)(?:[0-5]\d)?(?:\D|$)/);
    if (clock) time = normalizeTime(clock[1], clock[2]);
  }
  const residual = name
    .replace(dateMatch?.[0] || "", " ")
    .replace(/(?:^|\D)(?:1[0-2]|0?[1-9])[:._-]?[0-5]?\d?\s*[ap]m(?:\D|$)/ig, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    inferredDate: date,
    inferredTime: time,
    parseConfidence: date && time ? "high" : date ? "medium" : "low",
    parseFormat: format,
    residualLabel: residual
  };
}

function buildInboxSummary(record = {}, fallbackId = "") {
  const candidates = Array.isArray(record.matchCandidates) ? record.matchCandidates : [];
  return {
    inboxId: normalizeString(record.inboxId || fallbackId),
    status: INBOX_STATUSES.includes(record.status) ? record.status : "unmatched",
    originalFilename: normalizeString(record.originalFilename),
    sourceKind: normalizeString(record.sourceKind),
    sourceUrl: normalizeString(record.sourceUrl),
    storagePath: normalizeString(record.storagePath),
    contentType: normalizeString(record.contentType),
    sizeBytes: Number(record.sizeBytes) || 0,
    checksumSha256: normalizeString(record.checksumSha256),
    inferredDate: normalizeString(record.inferredDate),
    inferredTime: normalizeString(record.inferredTime),
    parseConfidence: normalizeString(record.parseConfidence),
    residualLabel: normalizeString(record.residualLabel),
    matchStatus: normalizeString(record.matchStatus) || "not_evaluated",
    candidateCount: candidates.length,
    topCandidate: candidates[0] || null,
    sermonId: normalizeString(record.sermonId),
    occasionId: normalizeString(record.occasionId),
    mediaId: normalizeString(record.mediaId),
    transcriptionJobId: normalizeString(record.transcriptionJobId),
    identificationStatus: IDENTIFICATION_STATUSES.includes(record.identificationStatus)
      ? record.identificationStatus
      : "not_started",
    identificationJobId: normalizeString(record.identificationJobId),
    identificationTranscriptCharacterCount: Number(record.identificationTranscriptCharacterCount) || 0,
    identificationTranscriptTruncated: record.identificationTranscriptTruncated === true,
    identification: record.identification && typeof record.identification === "object"
      ? record.identification
      : null,
    identificationError: normalizeString(record.identificationError),
    createdAt: normalizeString(record.createdAt),
    updatedAt: normalizeString(record.updatedAt)
  };
}

function buildInboxDetail(record = {}, fallbackId = "") {
  return {
    ...buildInboxSummary(record, fallbackId),
    matchCandidates: Array.isArray(record.matchCandidates) ? record.matchCandidates : [],
    sourceRefs: Array.isArray(record.sourceRefs) ? record.sourceRefs : [],
    notes: normalizeString(record.notes),
    identificationTranscriptPreview: normalizeString(record.identificationTranscriptText).slice(0, 6000),
    promotedRawSourceId: normalizeString(record.promotedRawSourceId),
    matchedAt: normalizeString(record.matchedAt)
  };
}

function minutesFromTime(value) {
  const match = normalizeString(value).match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function overlapCount(left, right) {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

async function buildRecordingMatchCandidates(record, deps) {
  const [occasionRecords, sermonRecords] = await Promise.all([
    loadCollection(getCollection(deps, "sermonOccasionsCollection"), 20000),
    loadCollection(getCollection(deps, "sermonsCollection"), 20000)
  ]);
  const sermonById = new Map(sermonRecords.map(({ id, data }) => [id, { ...data, sermonId: data.sermonId || id }]));
  const filenameTokens = normalizeTokens(`${record.originalFilename} ${record.residualLabel}`);
  const identification = record.identification && typeof record.identification === "object" ? record.identification : {};
  const transcriptTokens = normalizeTokens([
    record.identificationTranscriptText,
    identification.suggestedTitle,
    ...(Array.isArray(identification.distinctivePhrases) ? identification.distinctivePhrases : [])
  ].join(" "));
  const suggestedTitleTokens = normalizeTokens(identification.suggestedTitle);
  const scriptureClues = (Array.isArray(identification.scriptureReferences) ? identification.scriptureReferences : [])
    .map((value) => normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const inferredMinutes = minutesFromTime(record.inferredTime);
  const candidates = [];
  const activeOccasionsBySermon = new Map();
  for (const { id, data } of occasionRecords) {
    if (normalizeString(data.status) === "cancelled") continue;
    const sermonId = normalizeString(data.sermonId);
    const values = activeOccasionsBySermon.get(sermonId) || [];
    values.push({ ...data, occasionId: normalizeString(data.occasionId || id) });
    activeOccasionsBySermon.set(sermonId, values);
  }

  function addContentEvidence(sermon, score, reasons) {
    const titleTokens = normalizeTokens(sermon.title);
    const transcriptTitleOverlap = overlapCount(titleTokens, transcriptTokens);
    const suggestedTitleOverlap = overlapCount(titleTokens, suggestedTitleTokens);
    const suggestedCoverage = suggestedTitleOverlap / Math.max(Math.min(titleTokens.length, suggestedTitleTokens.length), 1);
    const transcriptCoverage = transcriptTitleOverlap / Math.max(titleTokens.length, 1);
    if (titleTokens.length >= 2 && suggestedTitleTokens.length >= 2 && suggestedTitleOverlap >= 2 && suggestedCoverage >= 0.75) {
      score += 50;
      reasons.push("identified title closely matches the sermon title");
    } else if (suggestedTitleOverlap >= 2 && suggestedCoverage >= 0.5) {
      score += 15;
      reasons.push("identified title partially matches the sermon title");
    }
    if (titleTokens.length >= 2 && transcriptTitleOverlap >= 2 && transcriptCoverage >= 0.75) {
      score += 30;
      reasons.push("sermon-title wording appears in the transcript");
    }
    const normalizedScripture = normalizeString(sermon.scriptureText).toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const primaryScripture = normalizeString(sermon.scriptureText).split(/[;,]/)[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const primaryMatch = primaryScripture && scriptureClues[0] === primaryScripture;
    const secondaryMatch = normalizedScripture && scriptureClues.some((clue) => clue.length >= 5 && normalizedScripture.includes(clue));
    if (primaryMatch) {
      score += 40;
      reasons.push("identified primary Scripture matches the sermon record");
    } else if (secondaryMatch) {
      score += 12;
      reasons.push("one identified Scripture appears among the sermon's references");
    }
    const canonicalOverlap = overlapCount(
      transcriptTokens,
      normalizeTokens(`${sermon.bigIdea || ""} ${sermon.outline || ""}`)
    );
    if (canonicalOverlap >= 8) {
      score += Math.min(canonicalOverlap, 10);
      reasons.push("transcript wording overlaps the saved sermon idea or outline");
    }
    return score;
  }

  if (!record.inferredDate) {
    for (const { id, data } of sermonRecords) {
      const sermon = { ...data, sermonId: normalizeString(data.sermonId || id) };
      let score = 0;
      const reasons = [];
      const titleOverlap = overlapCount(filenameTokens, normalizeTokens(sermon.title));
      if (titleOverlap > 0) {
        score += Math.min(titleOverlap * 10, 25);
        reasons.push("filename wording matches the sermon title");
      }
      score = addContentEvidence(sermon, score, reasons);
      if (score < 20) continue;
      const occasions = activeOccasionsBySermon.get(sermon.sermonId) || [];
      const occasion = occasions.length === 1 ? occasions[0] : {};
      candidates.push({
        sermonId: sermon.sermonId,
        occasionId: normalizeString(occasion.occasionId),
        occasionCount: occasions.length,
        title: normalizeString(sermon.title),
        scriptureText: normalizeString(sermon.scriptureText),
        date: normalizeString(occasion.date),
        time: normalizeString(occasion.time),
        venue: normalizeString(occasion.venue),
        service: normalizeString(occasion.service),
        score,
        confidence: score >= 80 ? "high" : score >= 55 ? "medium" : "low",
        reasons
      });
    }
    candidates.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
    return candidates.slice(0, 10);
  }

  for (const { id, data } of occasionRecords) {
    if (normalizeString(data.status) === "cancelled") continue;
    const sermonId = normalizeString(data.sermonId);
    const sermon = sermonById.get(sermonId);
    if (!sermon) continue;
    let score = 0;
    const reasons = [];
    if (record.inferredDate && normalizeString(data.date) === record.inferredDate) {
      score += 55;
      reasons.push(`filename date matches ${data.date}`);
    } else if (record.inferredDate) {
      continue;
    }
    const occasionMinutes = minutesFromTime(data.time);
    if (inferredMinutes >= 0 && occasionMinutes >= 0) {
      const difference = Math.abs(inferredMinutes - occasionMinutes);
      if (difference <= 15) {
        score += 25;
        reasons.push("filename time matches the preaching time");
      } else if (difference <= 60) {
        score += 10;
        reasons.push("filename time is within one hour of the preaching time");
      }
    }
    const titleOverlap = overlapCount(filenameTokens, normalizeTokens(sermon.title));
    if (titleOverlap > 0) {
      score += Math.min(titleOverlap * 10, 25);
      reasons.push(`${titleOverlap} sermon-title word${titleOverlap === 1 ? "" : "s"} match`);
    }
    const serviceOverlap = overlapCount(filenameTokens, normalizeTokens(`${data.service} ${data.venue}`));
    if (serviceOverlap > 0) {
      score += Math.min(serviceOverlap * 5, 15);
      reasons.push("service or venue wording matches");
    }
    score = addContentEvidence(sermon, score, reasons);
    if (score <= 0) continue;
    candidates.push({
      sermonId,
      occasionId: normalizeString(data.occasionId || id),
      title: normalizeString(sermon.title),
      scriptureText: normalizeString(sermon.scriptureText),
      date: normalizeString(data.date),
      time: normalizeString(data.time),
      venue: normalizeString(data.venue),
      service: normalizeString(data.service),
      score,
      confidence: score >= 80 ? "high" : score >= 55 ? "medium" : "low",
      reasons
    });
  }
  candidates.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  return candidates.slice(0, 10);
}

function getMatchStatus(record, candidates) {
  if (candidates.length === 0) return record.inferredDate ? "no_schedule_match" : "needs_date_or_transcript";
  if (candidates[0].score >= 80 && (!candidates[1] || candidates[0].score - candidates[1].score >= 10)) return "likely_match";
  if (candidates.length > 1 && candidates[0].score - candidates[1].score < 10) return "ambiguous";
  return "suggested";
}

async function importUnmatchedSermonRecording(input = {}, deps = {}) {
  if (typeof deps.prepareSermonRecordingInboxFile !== "function" || typeof deps.storeSermonRecordingInboxFile !== "function") {
    throw createInboxError("Recording inbox file storage is not configured", 500, "sermon_recording_inbox_storage_not_configured");
  }
  const prepared = await deps.prepareSermonRecordingInboxFile(input);
  const records = await loadCollection(getCollection(deps, "sermonRecordingInboxCollection"), 20000);
  const duplicate = records.find(({ data }) =>
    normalizeString(data.checksumSha256) && data.checksumSha256 === prepared.checksumSha256);
  if (duplicate) {
    return { recording: buildInboxDetail(duplicate.data, duplicate.id), duplicate: true, imported: false };
  }
  const inboxId = normalizeString(input.inboxId) || `sermon-recording-inbox-${randomUUID().slice(0, 8)}`;
  const parsed = parseRecordingFilename(prepared.originalFilename);
  const stored = await deps.storeSermonRecordingInboxFile({ inboxId, prepared });
  const nowIso = getNowIso(deps);
  let record = {
    inboxId,
    status: "unmatched",
    originalFilename: prepared.originalFilename,
    sourceKind: prepared.sourceKind,
    sourceUrl: prepared.sourceUrl,
    storagePath: stored.storagePath,
    contentType: prepared.contentType,
    sizeBytes: prepared.sizeBytes,
    checksumSha256: prepared.checksumSha256,
    ...parsed,
    matchStatus: "not_evaluated",
    matchCandidates: [],
    sermonId: "",
    occasionId: "",
    mediaId: "",
    transcriptionJobId: "",
    identificationStatus: "not_started",
    identificationJobId: "",
    identificationTranscriptText: "",
    identificationTranscriptCharacterCount: 0,
    identificationTranscriptTruncated: false,
    identification: null,
    identificationError: "",
    promotedRawSourceId: "",
    sourceRefs: prepared.sourceRefs || [],
    notes: normalizeString(input.notes),
    createdAt: nowIso,
    updatedAt: nowIso
  };
  const candidates = await buildRecordingMatchCandidates(record, deps);
  record.matchCandidates = candidates;
  record.matchStatus = getMatchStatus(record, candidates);
  await getCollection(deps, "sermonRecordingInboxCollection").doc(inboxId).create(record);
  return { recording: buildInboxDetail(record, inboxId), duplicate: false, imported: true };
}

async function importUnmatchedSermonRecordings(input = {}, deps = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) throw createInboxError("Batch recording import requires items", 400, "recording_inbox_items_required");
  if (items.length > MAX_BATCH_SIZE) {
    throw createInboxError("Recording inbox batch is too large", 400, "recording_inbox_batch_too_large", {
      maximum: MAX_BATCH_SIZE,
      received: items.length
    });
  }
  const results = [];
  const errors = [];
  for (let index = 0; index < items.length; index += 1) {
    try {
      results.push({ index, ...(await importUnmatchedSermonRecording({ ...input.defaults, ...items[index] }, deps)) });
    } catch (error) {
      errors.push({ index, code: error.code || "recording_inbox_import_failed", message: error.message, details: error.details || {} });
      if (input.stopOnError === true) break;
    }
  }
  return { requestedCount: items.length, importedCount: results.filter((item) => item.imported).length, duplicateCount: results.filter((item) => item.duplicate).length, errorCount: errors.length, results, errors };
}

async function listUnmatchedSermonRecordings(input = {}, deps = {}) {
  const status = normalizeString(input.status);
  const matchStatus = normalizeString(input.matchStatus);
  const query = normalizeString(input.query).toLowerCase();
  const limit = Math.min(Math.max(Number.parseInt(input.limit, 10) || 50, 1), 200);
  if (status && !INBOX_STATUSES.includes(status)) {
    throw createInboxError("Invalid recording inbox status", 400, "invalid_recording_inbox_status", { status, allowedValues: INBOX_STATUSES });
  }
  const recordings = (await loadCollection(getCollection(deps, "sermonRecordingInboxCollection"), 20000))
    .filter(({ data }) => !status || data.status === status)
    .filter(({ data }) => !matchStatus || data.matchStatus === matchStatus)
    .filter(({ data }) => !query || `${data.originalFilename} ${data.residualLabel} ${data.inferredDate}`.toLowerCase().includes(query))
    .sort((left, right) => normalizeString(right.data.createdAt).localeCompare(normalizeString(left.data.createdAt)))
    .slice(0, limit)
    .map(({ id, data }) => buildInboxSummary(data, id));
  return { count: recordings.length, recordings };
}

async function getUnmatchedSermonRecording(input = {}, deps = {}) {
  const inboxId = normalizeString(input.inboxId);
  if (!inboxId) throw createInboxError("inboxId is required", 400, "recording_inbox_id_required");
  const doc = await getCollection(deps, "sermonRecordingInboxCollection").doc(inboxId).get();
  if (!doc.exists) throw createInboxError("Recording inbox item not found", 404, "recording_inbox_item_not_found", { inboxId });
  const record = { ...(doc.data() || {}), inboxId };
  if (input.refreshMatches === true && record.status === "unmatched") {
    record.matchCandidates = await buildRecordingMatchCandidates(record, deps);
    record.matchStatus = getMatchStatus(record, record.matchCandidates);
    record.updatedAt = getNowIso(deps);
    await getCollection(deps, "sermonRecordingInboxCollection").doc(inboxId).set(record);
  }
  return { recording: buildInboxDetail(record, inboxId) };
}

async function startUnmatchedSermonRecordingIdentification(input = {}, deps = {}) {
  const inboxId = normalizeString(input.inboxId);
  if (!inboxId) throw createInboxError("inboxId is required", 400, "recording_inbox_id_required");
  const inboxCollection = getCollection(deps, "sermonRecordingInboxCollection");
  const docRef = inboxCollection.doc(inboxId);
  const doc = await docRef.get();
  if (!doc.exists) throw createInboxError("Recording inbox item not found", 404, "recording_inbox_item_not_found", { inboxId });
  const record = { ...(doc.data() || {}), inboxId };
  if (record.status !== "unmatched") {
    throw createInboxError("Only unmatched recordings can run identification", 409, "recording_inbox_identification_not_unmatched", { inboxId, status: record.status });
  }
  if (record.identificationJobId && ["queued", "processing", "completed"].includes(record.identificationStatus)) {
    const job = await getSermonTranscriptionJob({ jobId: record.identificationJobId }, deps);
    return { recording: buildInboxDetail(record, inboxId), job: job.job, reused: true };
  }
  if (typeof deps.enqueueSermonTranscriptionJob !== "function") {
    throw createInboxError("Sermon transcription queue is not configured", 500, "sermon_transcription_queue_not_configured");
  }
  const nowIso = getNowIso(deps);
  const jobId = `sermon-transcription-${randomUUID().slice(0, 8)}`;
  const job = {
    jobId,
    targetType: "recording_inbox",
    inboxId,
    sermonId: "",
    mediaId: "",
    occasionId: "",
    status: "queued",
    stage: "queued",
    cleanTranscript: false,
    rebuildChunks: false,
    prompt: normalizeString(input.prompt),
    rawSourceId: "",
    cleanedSourceId: "",
    rawCharacterCount: 0,
    cleanedCharacterCount: 0,
    attemptCount: 0,
    errorCode: "",
    errorMessage: "",
    nextAction: "Wait for identification, then review the proposed sermon and occasion matches.",
    queuedAt: nowIso,
    startedAt: "",
    completedAt: "",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await getCollection(deps, "sermonTranscriptionJobsCollection").doc(jobId).create(job);
  const nextRecord = {
    ...record,
    identificationStatus: "queued",
    identificationJobId: jobId,
    identificationError: "",
    updatedAt: nowIso
  };
  await docRef.set(nextRecord);
  try {
    await deps.enqueueSermonTranscriptionJob({ jobId });
  } catch (error) {
    await docRef.set({ ...nextRecord, identificationStatus: "failed", identificationError: normalizeString(error.message), updatedAt: getNowIso(deps) });
    throw error;
  }
  return { recording: buildInboxDetail(nextRecord, inboxId), job, reused: false };
}

async function completeUnmatchedSermonRecordingIdentification(input = {}, deps = {}) {
  const inboxId = normalizeString(input.inboxId);
  const collection = getCollection(deps, "sermonRecordingInboxCollection");
  const docRef = collection.doc(inboxId);
  const doc = await docRef.get();
  if (!doc.exists) throw createInboxError("Recording inbox item not found", 404, "recording_inbox_item_not_found", { inboxId });
  const rawTranscript = normalizeString(input.transcriptText);
  if (!rawTranscript) throw createInboxError("Identification transcript is empty", 502, "recording_identification_transcript_empty");
  const transcriptText = rawTranscript.slice(0, MAX_IDENTIFICATION_TRANSCRIPT_CHARACTERS);
  const record = {
    ...(doc.data() || {}),
    inboxId,
    identificationStatus: "completed",
    identificationTranscriptText: transcriptText,
    identificationTranscriptCharacterCount: rawTranscript.length,
    identificationTranscriptTruncated: rawTranscript.length > transcriptText.length,
    identification: input.identification && typeof input.identification === "object" ? input.identification : null,
    identificationError: "",
    updatedAt: getNowIso(deps)
  };
  record.matchCandidates = await buildRecordingMatchCandidates(record, deps);
  record.matchStatus = getMatchStatus(record, record.matchCandidates);
  await docRef.set(record);
  return { recording: buildInboxDetail(record, inboxId) };
}

async function failUnmatchedSermonRecordingIdentification(input = {}, deps = {}) {
  const inboxId = normalizeString(input.inboxId);
  const docRef = getCollection(deps, "sermonRecordingInboxCollection").doc(inboxId);
  const doc = await docRef.get();
  if (!doc.exists) return null;
  const record = {
    ...(doc.data() || {}),
    inboxId,
    identificationStatus: "failed",
    identificationError: normalizeString(input.errorMessage) || "Recording identification failed",
    updatedAt: getNowIso(deps)
  };
  await docRef.set(record);
  return { recording: buildInboxDetail(record, inboxId) };
}

async function createSermonFromUnmatchedRecording(input = {}, deps = {}) {
  const inboxId = normalizeString(input.inboxId);
  if (!inboxId) throw createInboxError("inboxId is required", 400, "recording_inbox_id_required");
  if (input.confirmedNoMatch !== true) {
    throw createInboxError(
      "Confirm that no existing sermon hub matches before creating one from the recording",
      400,
      "recording_inbox_no_match_confirmation_required"
    );
  }
  const inboxCollection = getCollection(deps, "sermonRecordingInboxCollection");
  const docRef = inboxCollection.doc(inboxId);
  const doc = await docRef.get();
  if (!doc.exists) throw createInboxError("Recording inbox item not found", 404, "recording_inbox_item_not_found", { inboxId });
  let record = { ...(doc.data() || {}), inboxId };
  if (record.status === "matched" && record.sermonId) {
    return {
      sermon: (await getSermon({ sermonId: record.sermonId }, deps)).sermon,
      recording: buildInboxDetail(record, inboxId),
      media: record.mediaId ? (await getSermonMedia({ mediaId: record.mediaId }, deps)).media : null,
      job: record.transcriptionJobId ? (await getSermonTranscriptionJob({ jobId: record.transcriptionJobId }, deps)).job : null,
      reused: true
    };
  }
  if (record.identificationStatus !== "completed" || !normalizeString(record.identificationTranscriptText)) {
    throw createInboxError(
      "Run and complete recording identification before creating a sermon hub from its transcript",
      409,
      "recording_inbox_identification_required",
      { inboxId, identificationStatus: record.identificationStatus || "not_started" }
    );
  }
  if (typeof deps.buildSermonHubFromRecordingTranscript !== "function") {
    throw createInboxError("Transcript-to-sermon drafting is not configured", 500, "recording_sermon_drafting_not_configured");
  }
  const generated = await deps.buildSermonHubFromRecordingTranscript({
    transcriptText: record.identificationTranscriptText,
    recording: buildInboxDetail(record, inboxId),
    identification: record.identification || {}
  });
  const fallbackTitle = normalizeString(record.identification?.suggestedTitle) ||
    normalizeString(record.residualLabel) ||
    `Imported Sermon ${record.inferredDate || inboxId.slice(-8)}`;
  const sermonId = normalizeString(record.createdSermonId) || `sermon-from-recording-${inboxId.replace(/^sermon-recording-inbox-/, "")}`;
  let sermon;
  try {
    sermon = (await createSermon({
      sermonId,
      title: normalizeString(generated.title) || fallbackTitle,
      status: "preached",
      scriptureText: normalizeString(generated.scriptureText) ||
        (Array.isArray(record.identification?.scriptureReferences) ? record.identification.scriptureReferences.join("; ") : ""),
      bigIdea: normalizeString(generated.bigIdea),
      outline: normalizeString(generated.outline),
      notes: normalizeString(generated.notes),
      preachedDate: normalizeString(record.inferredDate),
      occasion: "",
      sourceRefs: [{
        type: "sermon_recording_inbox",
        inboxId,
        role: "hub_created_from_transcript",
        checksumSha256: record.checksumSha256
      }]
    }, deps)).sermon;
  } catch (error) {
    if (error.code !== "sermon_already_exists") throw error;
    sermon = (await getSermon({ sermonId }, deps)).sermon;
  }
  let occasion = null;
  if (record.inferredDate) {
    occasion = (await createSermonOccasion({
      sermonId,
      date: record.inferredDate,
      time: record.inferredTime,
      venue: Array.isArray(record.identification?.venueClues) ? record.identification.venueClues.join("; ") : "",
      service: Array.isArray(record.identification?.serviceClues) ? record.identification.serviceClues.join("; ") : "",
      status: "preached",
      notes: `Created from unmatched recording ${inboxId}.`
    }, deps)).occasion;
  }
  record = {
    ...record,
    createdSermonId: sermonId,
    createdOccasionId: occasion?.occasionId || "",
    updatedAt: getNowIso(deps)
  };
  await docRef.set(record);
  const confirmed = await confirmUnmatchedSermonRecordingMatch({
    inboxId,
    sermonId,
    occasionId: occasion?.occasionId || "",
    transcribe: input.transcribe !== false,
    cleanTranscript: input.cleanTranscript !== false,
    rebuildChunks: input.rebuildChunks !== false,
    cleanupInstructions: input.cleanupInstructions,
    notes: normalizeString(input.notes || record.notes)
  }, deps);
  return {
    sermon,
    occasion,
    recording: confirmed.recording,
    media: confirmed.media,
    job: confirmed.job,
    generatedNotes: {
      title: sermon.title,
      scriptureText: sermon.scriptureText,
      bigIdea: sermon.bigIdea,
      outline: sermon.outline,
      notes: sermon.notes
    },
    reused: false
  };
}

async function confirmUnmatchedSermonRecordingMatch(input = {}, deps = {}) {
  const inboxId = normalizeString(input.inboxId);
  const sermonId = normalizeString(input.sermonId);
  if (!inboxId || !sermonId) throw createInboxError("inboxId and sermonId are required", 400, "recording_match_target_required");
  const inboxCollection = getCollection(deps, "sermonRecordingInboxCollection");
  const docRef = inboxCollection.doc(inboxId);
  const doc = await docRef.get();
  if (!doc.exists) throw createInboxError("Recording inbox item not found", 404, "recording_inbox_item_not_found", { inboxId });
  let record = { ...(doc.data() || {}), inboxId };
  if (record.status === "matched" && record.mediaId) {
    const media = (await getSermonMedia({ mediaId: record.mediaId }, deps)).media;
    let job = record.transcriptionJobId
      ? (await getSermonTranscriptionJob({ jobId: record.transcriptionJobId }, deps)).job
      : null;
    if (!job && input.transcribe !== false) {
      const started = await startSermonTranscription({
        sermonId: record.sermonId || sermonId,
        mediaId: record.mediaId,
        occasionId: record.occasionId || input.occasionId,
        cleanTranscript: input.cleanTranscript !== false,
        rebuildChunks: input.rebuildChunks !== false,
        prompt: input.prompt,
        cleanupInstructions: input.cleanupInstructions
      }, deps);
      job = started.job;
      record.transcriptionJobId = job.jobId;
      record.updatedAt = getNowIso(deps);
      await docRef.set(record);
    }
    return { recording: buildInboxDetail(record, inboxId), media, job, reused: true };
  }
  const sermon = (await getSermon({ sermonId }, deps)).sermon;
  const occasionId = normalizeString(input.occasionId);
  let occasion = null;
  if (occasionId) {
    const occasionDoc = await getCollection(deps, "sermonOccasionsCollection").doc(occasionId).get();
    if (!occasionDoc.exists) throw createInboxError("Sermon occasion not found", 404, "sermon_occasion_not_found", { occasionId });
    occasion = { ...(occasionDoc.data() || {}), occasionId };
    if (normalizeString(occasion.sermonId) !== sermonId) {
      throw createInboxError("Selected occasion belongs to another sermon", 409, "recording_match_occasion_mismatch", { sermonId, occasionId });
    }
  }
  const mediaResult = await createSermonMedia({
    sermonId,
    occasionId,
    mediaType: normalizeString(record.contentType).startsWith("video/") ? "video" : "audio",
    platform: record.sourceKind || "recording_inbox",
    storagePath: record.storagePath,
    originalFilename: record.originalFilename,
    contentType: record.contentType,
    title: normalizeString(input.title) || sermon.title,
    label: normalizeString(input.label) || record.originalFilename,
    recordedAt: normalizeString(input.recordedAt || occasion?.scheduledAt || occasion?.date || record.inferredDate),
    transcriptStatus: "none",
    notes: normalizeString(input.notes || record.notes),
    sourceRefs: [
      ...(Array.isArray(record.sourceRefs) ? record.sourceRefs : []),
      { type: "sermon_recording_inbox", inboxId, checksumSha256: record.checksumSha256 }
    ]
  }, deps);
  const nowIso = getNowIso(deps);
  record = {
    ...record,
    status: "matched",
    sermonId,
    occasionId,
    mediaId: mediaResult.media.mediaId,
    matchedAt: nowIso,
    updatedAt: nowIso
  };
  await docRef.set(record);
  if (normalizeString(record.identificationTranscriptText)) {
    const promoted = await createSermonMediaTranscriptSource({
      mediaId: mediaResult.media.mediaId,
      transcriptKind: "raw",
      transcriptText: record.identificationTranscriptText,
      sourceLabel: `Raw preached transcript - ${record.originalFilename}`,
      summary: `Promoted from unmatched recording identification ${inboxId}; the audio was not transcribed twice.`,
      sourceRefs: [{ type: "sermon_recording_inbox", inboxId, role: "identification_transcript" }]
    }, deps);
    record.promotedRawSourceId = promoted.source.sourceId;
    record.identificationTranscriptText = "";
    record.updatedAt = getNowIso(deps);
    await docRef.set(record);
  }
  let job = null;
  if (input.transcribe !== false) {
    const started = await startSermonTranscription({
      sermonId,
      mediaId: mediaResult.media.mediaId,
      occasionId,
      cleanTranscript: input.cleanTranscript !== false,
      rebuildChunks: input.rebuildChunks !== false,
      prompt: input.prompt,
      cleanupInstructions: input.cleanupInstructions
    }, deps);
    job = started.job;
    record.transcriptionJobId = job.jobId;
    record.updatedAt = getNowIso(deps);
    await docRef.set(record);
  }
  return { recording: buildInboxDetail(record, inboxId), media: mediaResult.media, job, reused: false };
}

module.exports = {
  INBOX_STATUSES,
  IDENTIFICATION_STATUSES,
  MAX_BATCH_SIZE,
  buildRecordingMatchCandidates,
  completeUnmatchedSermonRecordingIdentification,
  confirmUnmatchedSermonRecordingMatch,
  createSermonFromUnmatchedRecording,
  failUnmatchedSermonRecordingIdentification,
  getUnmatchedSermonRecording,
  importUnmatchedSermonRecording,
  importUnmatchedSermonRecordings,
  listUnmatchedSermonRecordings,
  parseRecordingFilename,
  startUnmatchedSermonRecordingIdentification
};
