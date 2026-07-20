const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSermonTranscriptionJob,
  processSermonTranscriptionJob,
  startSermonTranscription
} = require("../lib/sermon-transcription-job-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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
        docs: Array.from(this.store.entries()).slice(0, maximum).map(([id, data]) => ({
          id,
          data: () => clone(data)
        }))
      })
    };
  }
}

function createDeps() {
  const enqueued = [];
  const deps = {
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
    sermonMediaCollection: new FakeCollection({
      "media-1": {
        mediaId: "media-1",
        sermonId: "sermon-1",
        mediaType: "audio",
        label: "Sunday night recording",
        storagePath: "sermon-media/sermon-1/media-1/recording.m4a",
        contentType: "audio/mp4",
        transcriptStatus: "none",
        transcriptSourceIds: {},
        notes: "Preserve this media note."
      }
    }),
    sermonSourcesCollection: new FakeCollection(),
    sermonTranscriptionJobsCollection: new FakeCollection(),
    enqueueSermonTranscriptionJob: async ({ jobId }) => { enqueued.push(jobId); },
    enqueued,
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-13T02:00:00.000Z"
  };
  return deps;
}

test("queues an existing recording and links it to the exact preaching occasion", async () => {
  const deps = createDeps();
  const result = await startSermonTranscription({
    sermonId: "sermon-1",
    mediaId: "media-1",
    occasionId: "occasion-1"
  }, deps);

  assert.equal(result.job.status, "queued");
  assert.equal(result.job.occasionId, "occasion-1");
  assert.equal(deps.enqueued.length, 1);
  assert.equal(deps.sermonMediaCollection.store.get("media-1").occasionId, "occasion-1");
  assert.deepEqual(deps.sermonOccasionsCollection.store.get("occasion-1").mediaIds, ["media-1"]);
});

test("imports one attached recording before queueing it", async () => {
  const deps = createDeps();
  let received = null;
  deps.importSermonRecording = async (input) => {
    received = input;
    return {
      media: {
        mediaId: "media-imported",
        sermonId: "sermon-1",
        occasionId: "occasion-1",
        mediaType: "audio",
        label: "Attached recording",
        transcriptStatus: "none"
      }
    };
  };
  const result = await startSermonTranscription({
    sermonId: "sermon-1",
    occasionId: "occasion-1",
    openaiFileIdRefs: [{ name: "sermon.m4a", download_link: "https://files.test/sermon.m4a" }]
  }, deps);

  assert.equal(received.openaiFileIdRefs[0].name, "sermon.m4a");
  assert.equal(result.job.mediaId, "media-imported");
});

test("processes raw and cleaned transcript layers once and replays completion", async () => {
  const deps = createDeps();
  const started = await startSermonTranscription({
    sermonId: "sermon-1",
    mediaId: "media-1",
    occasionId: "occasion-1",
    rebuildChunks: false
  }, deps);
  let transcribeCalls = 0;
  let cleanupCalls = 0;
  deps.transcribeSermonMedia = async () => {
    transcribeCalls += 1;
    return {
      text: "The same grace that made me righteous is the grace that keeps me standing.",
      method: "openai_transcription",
      model: "gpt-4o-transcribe"
    };
  };
  deps.cleanSermonTranscript = async ({ transcriptText }) => {
    cleanupCalls += 1;
    return { text: transcriptText, model: "gpt-5.5" };
  };

  const completed = await processSermonTranscriptionJob({ jobId: started.job.jobId }, deps);
  assert.equal(completed.job.status, "completed");
  assert.ok(completed.job.rawSourceId);
  assert.ok(completed.job.cleanedSourceId);
  assert.equal(deps.sermonMediaCollection.store.get("media-1").transcriptStatus, "cleaned");
  assert.equal(deps.sermonMediaCollection.store.get("media-1").notes, "Preserve this media note.");
  assert.equal(transcribeCalls, 1);
  assert.equal(cleanupCalls, 1);

  const replay = await processSermonTranscriptionJob({ jobId: started.job.jobId }, deps);
  assert.equal(replay.replayed, true);
  assert.equal(transcribeCalls, 1);
  assert.equal(cleanupCalls, 1);
  const fetched = await getSermonTranscriptionJob({ jobId: started.job.jobId }, deps);
  assert.equal(fetched.job.nextAction.includes("post-sermon"), true);
});

test("does not reuse a raw-only job when cleaned output is newly requested", async () => {
  const deps = createDeps();
  deps.sermonTranscriptionJobsCollection.store.set("raw-only", {
    jobId: "raw-only",
    sermonId: "sermon-1",
    mediaId: "media-1",
    status: "completed",
    cleanTranscript: false,
    rebuildChunks: false,
    createdAt: "2026-07-13T01:00:00.000Z"
  });

  const result = await startSermonTranscription({
    sermonId: "sermon-1",
    mediaId: "media-1",
    cleanTranscript: true,
    rebuildChunks: false
  }, deps);

  assert.equal(result.reused, false);
  assert.notEqual(result.job.jobId, "raw-only");
});

test("processes an inbox identification job without creating sermon sources", async () => {
  const deps = createDeps();
  deps.sermonRecordingInboxCollection = new FakeCollection({
    "inbox-1": {
      inboxId: "inbox-1",
      status: "unmatched",
      originalFilename: "58th Ave NE 15.m4a",
      storagePath: "sermon-recording-inbox/inbox-1/recording.m4a",
      contentType: "audio/mp4"
    }
  });
  deps.sermonTranscriptionJobsCollection.store.set("identify-1", {
    jobId: "identify-1",
    targetType: "recording_inbox",
    inboxId: "inbox-1",
    status: "queued",
    stage: "queued",
    attemptCount: 0,
    createdAt: "2026-07-13T01:00:00.000Z"
  });
  deps.transcribeSermonMedia = async ({ media }) => ({
    text: "Open your Bible to Psalm 37 verse 17.",
    method: "openai_transcription",
    model: "gpt-4o-transcribe",
    media
  });
  deps.analyzeUnmatchedRecordingTranscript = async () => ({
    suggestedTitle: "The Lord Upholdeth the Righteous",
    scriptureReferences: ["Psalm 37:17"]
  });
  let completedInput = null;
  deps.completeUnmatchedRecordingIdentification = async (input) => {
    completedInput = input;
    return { recording: { inboxId: input.inboxId, identificationStatus: "completed" } };
  };

  const completed = await processSermonTranscriptionJob({ jobId: "identify-1" }, deps);
  assert.equal(completed.job.status, "completed");
  assert.equal(completed.job.targetType, "recording_inbox");
  assert.equal(completed.job.inboxId, "inbox-1");
  assert.equal(completedInput.identification.scriptureReferences[0], "Psalm 37:17");
  assert.equal(deps.sermonSourcesCollection.store.size, 0);
});
