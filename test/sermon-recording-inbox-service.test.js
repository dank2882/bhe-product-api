const test = require("node:test");
const assert = require("node:assert/strict");

const {
  completeUnmatchedSermonRecordingIdentification,
  buildRecordingMatchCandidates,
  confirmUnmatchedSermonRecordingMatch,
  createSermonFromUnmatchedRecording,
  getUnmatchedSermonRecording,
  importUnmatchedSermonRecording,
  parseRecordingFilename,
  startUnmatchedSermonRecordingIdentification
} = require("../lib/sermon-recording-inbox-service");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class FakeDocRef {
  constructor(store, id) { this.store = store; this.id = id; }
  async get() { return { exists: this.store.has(this.id), data: () => clone(this.store.get(this.id)) }; }
  async create(data) {
    if (this.store.has(this.id)) throw new Error("already exists");
    this.store.set(this.id, clone(data));
  }
  async set(data) { this.store.set(this.id, clone(data)); }
}

class FakeCollection {
  constructor(records = {}) { this.store = new Map(Object.entries(clone(records))); }
  doc(id) { return new FakeDocRef(this.store, id); }
  limit(maximum) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries()).slice(0, maximum).map(([id, data]) => ({ id, data: () => clone(data) }))
      })
    };
  }
}

function createDeps() {
  const stored = [];
  const enqueued = [];
  return {
    sermonsCollection: new FakeCollection({
      "sermon-1": {
        sermonId: "sermon-1",
        title: "The Lord Upholdeth the Righteous",
        status: "preached",
        scriptureText: "Psalm 37:17",
        preachedDate: "2026-07-12"
      }
    }),
    sermonOccasionsCollection: new FakeCollection({
      "occasion-1": {
        occasionId: "occasion-1",
        sermonId: "sermon-1",
        status: "preached",
        date: "2026-07-12",
        time: "18:00",
        scheduledAt: "2026-07-13T01:00:00.000Z",
        venue: "Faith Baptist Church (Tacoma)",
        service: "Sunday Night",
        mediaIds: []
      }
    }),
    sermonMediaCollection: new FakeCollection(),
    sermonSourcesCollection: new FakeCollection(),
    sermonRecordingInboxCollection: new FakeCollection(),
    sermonTranscriptionJobsCollection: new FakeCollection(),
    sermonDevelopmentSessionsCollection: new FakeCollection(),
    sermonDevelopmentCheckpointsCollection: new FakeCollection(),
    preachingAnalysesCollection: new FakeCollection(),
    preachingProfilesCollection: new FakeCollection(),
    prepareSermonRecordingInboxFile: async () => ({
      buffer: Buffer.from("recording"),
      originalFilename: "2026-07-12_1800_The_Lord_Upholdeth.m4a",
      contentType: "audio/mp4",
      sizeBytes: 9,
      checksumSha256: "checksum-1",
      sourceKind: "dropbox",
      sourceUrl: "https://dropbox.test/recording",
      sourceRefs: [{ type: "dropbox" }]
    }),
    storeSermonRecordingInboxFile: async ({ inboxId }) => {
      stored.push(inboxId);
      return { storagePath: `sermon-recording-inbox/${inboxId}/recording.m4a` };
    },
    enqueueSermonTranscriptionJob: async ({ jobId }) => { enqueued.push(jobId); },
    stored,
    enqueued,
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-13T02:00:00.000Z"
  };
}

test("parses common recording date and time filename formats", () => {
  assert.deepEqual(
    parseRecordingFilename("2026-07-12_1800_Sunday-Night.m4a"),
    {
      inferredDate: "2026-07-12",
      inferredTime: "18:00",
      parseConfidence: "high",
      parseFormat: "iso_date",
      residualLabel: "1800 Sunday Night"
    }
  );
  const us = parseRecordingFilename("07-12-26 6-00pm Psalm 37.mp3");
  assert.equal(us.inferredDate, "2026-07-12");
  assert.equal(us.inferredTime, "18:00");
});

test("imports, deduplicates, and ranks an exact date-time occasion", async () => {
  const deps = createDeps();
  const first = await importUnmatchedSermonRecording({ url: "https://dropbox.test/recording" }, deps);

  assert.equal(first.imported, true);
  assert.equal(first.recording.inferredDate, "2026-07-12");
  assert.equal(first.recording.inferredTime, "18:00");
  assert.equal(first.recording.matchStatus, "likely_match");
  assert.equal(first.recording.topCandidate.sermonId, "sermon-1");
  assert.equal(first.recording.topCandidate.occasionId, "occasion-1");
  assert.equal(deps.stored.length, 1);

  const duplicate = await importUnmatchedSermonRecording({ url: "https://dropbox.test/copy" }, deps);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.recording.inboxId, first.recording.inboxId);
  assert.equal(deps.stored.length, 1);
});

test("confirms the exact match and queues transcription without copying the recording", async () => {
  const deps = createDeps();
  const imported = await importUnmatchedSermonRecording({ url: "https://dropbox.test/recording" }, deps);
  const confirmed = await confirmUnmatchedSermonRecordingMatch({
    inboxId: imported.recording.inboxId,
    sermonId: "sermon-1",
    occasionId: "occasion-1",
    transcribe: true,
    cleanTranscript: true,
    rebuildChunks: false
  }, deps);

  assert.equal(confirmed.recording.status, "matched");
  assert.equal(confirmed.media.storagePath, imported.recording.storagePath);
  assert.equal(confirmed.media.occasionId, "occasion-1");
  assert.equal(confirmed.job.status, "queued");
  assert.equal(deps.enqueued.length, 1);
  assert.deepEqual(deps.sermonOccasionsCollection.store.get("occasion-1").mediaIds, [confirmed.media.mediaId]);

  const fetched = await getUnmatchedSermonRecording({ inboxId: imported.recording.inboxId }, deps);
  assert.equal(fetched.recording.transcriptionJobId, confirmed.job.jobId);
});

test("can queue transcription after an earlier match-only confirmation", async () => {
  const deps = createDeps();
  const imported = await importUnmatchedSermonRecording({ url: "https://dropbox.test/recording" }, deps);
  const matched = await confirmUnmatchedSermonRecordingMatch({
    inboxId: imported.recording.inboxId,
    sermonId: "sermon-1",
    occasionId: "occasion-1",
    transcribe: false
  }, deps);
  assert.equal(matched.job, null);

  const queued = await confirmUnmatchedSermonRecordingMatch({
    inboxId: imported.recording.inboxId,
    sermonId: "sermon-1",
    occasionId: "occasion-1",
    transcribe: true,
    rebuildChunks: false
  }, deps);
  assert.equal(queued.reused, true);
  assert.equal(queued.job.status, "queued");
  assert.equal(deps.enqueued.length, 1);
});

test("identifies an undated recording in staging and promotes its transcript only after confirmation", async () => {
  const deps = createDeps();
  deps.prepareSermonRecordingInboxFile = async () => ({
    buffer: Buffer.from("recording"),
    originalFilename: "58th Ave NE 15.m4a",
    contentType: "audio/mp4",
    sizeBytes: 9,
    checksumSha256: "checksum-undated",
    sourceKind: "dropbox",
    sourceUrl: "https://dropbox.test/undated",
    sourceRefs: [{ type: "dropbox" }]
  });
  const imported = await importUnmatchedSermonRecording({ url: "https://dropbox.test/undated" }, deps);
  assert.equal(imported.recording.matchStatus, "needs_date_or_transcript");

  const started = await startUnmatchedSermonRecordingIdentification({ inboxId: imported.recording.inboxId }, deps);
  assert.equal(started.job.targetType, "recording_inbox");
  assert.equal(started.recording.identificationStatus, "queued");

  const identified = await completeUnmatchedSermonRecordingIdentification({
    inboxId: imported.recording.inboxId,
    transcriptText: "The Lord upholdeth the righteous. The same grace that made me righteous keeps me standing.",
    identification: {
      suggestedTitle: "The Lord Upholdeth the Righteous",
      scriptureReferences: ["Psalm 37:17"],
      distinctivePhrases: ["the same grace that made me righteous"]
    }
  }, deps);
  assert.equal(identified.recording.identificationStatus, "completed");
  assert.equal(identified.recording.topCandidate.sermonId, "sermon-1");

  const confirmed = await confirmUnmatchedSermonRecordingMatch({
    inboxId: imported.recording.inboxId,
    sermonId: "sermon-1",
    occasionId: "occasion-1",
    transcribe: false
  }, deps);
  assert.ok(confirmed.recording.promotedRawSourceId);
  assert.equal(confirmed.recording.identificationTranscriptPreview, "");
  assert.equal(deps.sermonMediaCollection.store.get(confirmed.media.mediaId).transcriptStatus, "raw_saved");
});

test("creates a preached sermon hub and faithful notes when an identified recording has no archive match", async () => {
  const deps = createDeps();
  deps.prepareSermonRecordingInboxFile = async () => ({
    buffer: Buffer.from("recording"),
    originalFilename: "Old Sermon 15.m4a",
    contentType: "audio/mp4",
    sizeBytes: 9,
    checksumSha256: "checksum-new-hub",
    sourceKind: "dropbox",
    sourceUrl: "https://dropbox.test/new-hub",
    sourceRefs: [{ type: "dropbox" }]
  });
  deps.buildSermonHubFromRecordingTranscript = async () => ({
    title: "Grace Keeps Us Standing",
    scriptureText: "Psalm 37:17",
    bigIdea: "The grace that gives righteousness also sustains the believer.",
    outline: "1. We have no righteousness of our own\n2. Christ gives righteousness\n3. The Lord upholds His people",
    notes: "Transcript-derived archive notes with the preached movement preserved."
  });
  const imported = await importUnmatchedSermonRecording({ url: "https://dropbox.test/new-hub" }, deps);
  await completeUnmatchedSermonRecordingIdentification({
    inboxId: imported.recording.inboxId,
    transcriptText: "The same grace that made me righteous is the grace that keeps me standing.",
    identification: { suggestedTitle: "Grace Keeps Us Standing", scriptureReferences: ["Psalm 37:17"] }
  }, deps);

  const created = await createSermonFromUnmatchedRecording({
    inboxId: imported.recording.inboxId,
    confirmedNoMatch: true,
    transcribe: false
  }, deps);
  assert.equal(created.sermon.status, "preached");
  assert.equal(created.sermon.title, "Grace Keeps Us Standing");
  assert.equal(created.sermon.scriptureText, "Psalm 37:17");
  assert.match(created.sermon.outline, /Christ gives righteousness/);
  assert.equal(created.recording.status, "matched");
  assert.equal(created.recording.sermonId, created.sermon.sermonId);
  assert.ok(created.recording.promotedRawSourceId);
});

test("does not treat one secondary cross-reference and broad sermon words as a credible match", async () => {
  const deps = createDeps();
  deps.sermonsCollection = new FakeCollection({
    "sermon-unrelated": {
      sermonId: "sermon-unrelated",
      title: "Help, Healing, and Hope in a Broken World",
      scriptureText: "John 3:16; Romans 10:13; 2 Corinthians 5:8",
      bigIdea: "God gives hope and help to hurting people in a broken world."
    }
  });
  deps.sermonOccasionsCollection = new FakeCollection({
    "occasion-unrelated": {
      occasionId: "occasion-unrelated",
      sermonId: "sermon-unrelated",
      date: "2026-07-08",
      service: "Memorial service"
    }
  });
  const candidates = await buildRecordingMatchCandidates({
    originalFilename: "58th Ave NE 15.m4a",
    residualLabel: "58th Ave NE 15",
    identificationTranscriptText: "Jesus prayed in Gethsemane, Abba Father, all things are possible unto thee.",
    identification: {
      suggestedTitle: "Abba Father All Things Are Possible Unto Thee",
      scriptureReferences: ["Mark 14:32-36", "John 3:16"]
    }
  }, deps);
  assert.equal(candidates.length, 0);
});
