const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSermonWalkSession,
  finalizeSermonWalkCapture,
  getSermonWalkCaptureStatus,
  registerSermonWalkAudioChunk,
  registerSermonWalkFinalAudio,
  saveSermonWalkTurn
} = require("../lib/sermon-walk-capture-service");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }

  async get() {
    return {
      exists: this.store.has(this.id),
      data: () => clone(this.store.get(this.id))
    };
  }

  async create(data) {
    if (this.store.has(this.id)) throw new Error("already exists");
    this.store.set(this.id, clone(data));
  }

  async set(data) {
    this.store.set(this.id, clone(data));
  }
}

class FakeCollection {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(clone(initial)));
  }

  doc(id) {
    return new FakeDocRef(this.store, id);
  }

  async get() {
    return this.snapshot();
  }

  limit(max) {
    return { get: async () => this.snapshot(max) };
  }

  snapshot(max = Number.POSITIVE_INFINITY) {
    return {
      docs: Array.from(this.store.entries()).slice(0, max).map(([id, data]) => ({
        id,
        data: () => clone(data)
      }))
    };
  }
}

function createDeps() {
  return {
    sermonsCollection: new FakeCollection({
      "sermon-times": {
        sermonId: "sermon-times",
        title: "Times and Seasons",
        scriptureText: "Ecclesiastes 3:1-8",
        bigIdea: "God appoints the seasons.",
        status: "developing",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:00.000Z"
      }
    }),
    sermonOccasionsCollection: new FakeCollection(),
    sermonDevelopmentSessionsCollection: new FakeCollection(),
    sermonDevelopmentTurnsCollection: new FakeCollection(),
    sermonDevelopmentCheckpointsCollection: new FakeCollection(),
    sermonWalkTurnsCollection: new FakeCollection(),
    sermonWalkAudioChunksCollection: new FakeCollection(),
    sermonSourcesCollection: new FakeCollection(),
    sermonFoldersCollection: new FakeCollection(),
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-12T10:30:00.000Z"
  };
}

async function createSession(deps) {
  return createSermonWalkSession({ sermonId: "sermon-times", label: "Sunday walk" }, deps);
}

async function saveCompleteCapture(sessionId, deps) {
  await saveSermonWalkTurn({
    sessionId,
    itemId: "item-dan-1",
    speaker: "dan",
    sequence: 1,
    transcript: "The order in the universe shows that God acts intentionally."
  }, deps);
  await saveSermonWalkTurn({
    sessionId,
    itemId: "item-assistant-1",
    speaker: "assistant",
    sequence: 2,
    transcript: "Where should that thought land in the sermon?"
  }, deps);
  await registerSermonWalkAudioChunk({
    sessionId,
    sequence: 1,
    storagePath: `sermon-walks/${sessionId}/chunks/000001.webm`,
    sha256: "a".repeat(64),
    sizeBytes: 1200,
    contentType: "audio/webm"
  }, deps);
  await registerSermonWalkFinalAudio({
    sessionId,
    storagePath: `sermon-walks/${sessionId}/complete.webm`,
    sha256: "b".repeat(64),
    sizeBytes: 1200,
    contentType: "audio/webm"
  }, deps);
}

test("captures exact turns and replays identical writes idempotently", async () => {
  const deps = createDeps();
  const created = await createSession(deps);
  const sessionId = created.session.sessionId;
  const input = {
    sessionId,
    itemId: "item-dan-1",
    speaker: "dan",
    sequence: 1,
    transcript: "The order in the universe shows that God acts intentionally."
  };

  const first = await saveSermonWalkTurn(input, deps);
  const replay = await saveSermonWalkTurn(input, deps);

  assert.equal(first.action, "created");
  assert.equal(replay.action, "replayed");
  assert.equal(replay.receipt.transcript, input.transcript);
  assert.equal(deps.sermonWalkTurnsCollection.store.size, 1);

  await assert.rejects(
    saveSermonWalkTurn({ ...input, transcript: "Changed after the fact." }, deps),
    (error) => error.code === "sermon_walk_turn_conflict"
  );
});

test("refuses to close when an expected voice turn or audio chunk is missing", async () => {
  const deps = createDeps();
  const created = await createSession(deps);
  const sessionId = created.session.sessionId;
  await saveCompleteCapture(sessionId, deps);

  await assert.rejects(
    finalizeSermonWalkCapture({
      sessionId,
      expectedUserItemIds: ["item-dan-1", "item-dan-2"],
      finalChunkSequence: 2,
      clientPendingUploadCount: 0
    }, deps),
    (error) => {
      assert.equal(error.code, "sermon_walk_capture_incomplete");
      assert.deepEqual(error.details.missingUserItemIds, ["item-dan-2"]);
      assert.deepEqual(error.details.missingAudioSequences, [2]);
      return true;
    }
  );

  const session = deps.sermonDevelopmentSessionsCollection.store.get(sessionId);
  assert.equal(session.status, "active");
  assert.equal(session.captureStatus, "incomplete");
  assert.equal(deps.sermonSourcesCollection.store.size, 0);
});

test("closes only after audio and every expected Dan turn have durable receipts", async () => {
  const deps = createDeps();
  const created = await createSession(deps);
  const sessionId = created.session.sessionId;
  await saveCompleteCapture(sessionId, deps);

  const result = await finalizeSermonWalkCapture({
    sessionId,
    expectedUserItemIds: ["item-dan-1"],
    finalChunkSequence: 1,
    clientPendingUploadCount: 0,
    summary: "God's intentionality in creation should frame appointed seasons."
  }, deps);

  assert.equal(result.integrity.complete, true);
  assert.equal(result.session.captureStatus, "complete");
  assert.equal(result.session.status, "closed");
  assert.ok(result.session.liveTranscriptSourceId);

  const source = Array.from(deps.sermonSourcesCollection.store.values())[0];
  assert.match(source.material, /order in the universe/);
  assert.match(source.material, /Realtime item: item-dan-1/);

  const replay = await finalizeSermonWalkCapture({
    sessionId,
    expectedUserItemIds: ["item-dan-1"],
    finalChunkSequence: 1
  }, deps);
  assert.equal(replay.integrity.complete, true);

  const status = await getSermonWalkCaptureStatus({ sessionId }, deps);
  assert.equal(status.turns.length, 2);
  assert.equal(status.audioChunks.length, 1);
});
