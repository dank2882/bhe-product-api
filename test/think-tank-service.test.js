"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  appendThinkTankReflection,
  buildThinkTankReview,
  captureThinkTankEntry,
  getThinkTankEntry,
  linkThinkTankOutcome,
  listThinkTankEntries,
  listThinkTankReflections,
  updateThinkTankEntry
} = require("../lib/think-tank-service");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
  }

  doc(id) {
    return {
      get: async () => ({ exists: this.store.has(id), data: () => clone(this.store.get(id)) }),
      create: async (value) => {
        if (this.store.has(id)) throw new Error("already exists");
        this.store.set(id, clone(value));
      },
      set: async (value) => this.store.set(id, clone(value))
    };
  }

  limit(maxDocs) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries()).slice(0, maxDocs).map(([id, value]) => ({
          id,
          data: () => clone(value)
        }))
      })
    };
  }
}

function createDeps(subject = "auth0|dan", role = "member") {
  let sequence = 0;
  return {
    thinkTankEntriesCollection: new FakeCollection(),
    thinkTankReflectionsCollection: new FakeCollection(),
    taskAccess: {
      subject,
      subjects: [subject],
      name: subject === "auth0|dan" ? "Dan" : "Administrator",
      email: `${subject.replace(/[^a-z]/gi, "")}@example.test`,
      role
    },
    randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    now: () => "2026-08-10T12:00:00.000Z"
  };
}

test("capture preserves exact words and keeps assistant interpretation separate", async () => {
  const deps = createDeps();
  const exactText = "  I need to think about our ministry structure.\nDo not flatten this.  ";
  const result = await captureThinkTankEntry({
    exactText,
    assistantTitle: "Ministry structure",
    assistantSummary: "Dan wants to explore an organizational model.",
    topics: ["structure"],
    candidateDestinations: ["task_management"],
    source: "codex",
    sourceMode: "voice"
  }, deps);

  assert.equal(result.thought.exactText, exactText);
  assert.equal(result.thought.assistantTitle, "Ministry structure");
  assert.equal(result.thought.assistantSummary, "Dan wants to explore an organizational model.");
  assert.equal(result.thought.status, "inbox");
  assert.equal(result.thought.version, 1);
  assert.equal(deps.thinkTankEntriesCollection.store.size, 1);
});

test("Think Tank reads remain owner-only even for another task administrator", async () => {
  const deps = createDeps();
  const { thought } = await captureThinkTankEntry({ exactText: "Private thought" }, deps);
  const adminDeps = {
    ...deps,
    taskAccess: { subject: "auth0|admin", subjects: ["auth0|admin"], name: "Admin", role: "admin" }
  };

  await assert.rejects(
    () => getThinkTankEntry({ thoughtId: thought.thoughtId }, adminDeps),
    { code: "think_tank_owner_only", statusCode: 403 }
  );
  const list = await listThinkTankEntries({}, adminDeps);
  assert.equal(list.totalCount, 0);
});

test("updates preserve exact text and reject stale versions", async () => {
  const deps = createDeps();
  const { thought } = await captureThinkTankEntry({ exactText: "Original wording" }, deps);

  await assert.rejects(
    () => updateThinkTankEntry({
      thoughtId: thought.thoughtId,
      expectedVersion: 1,
      changes: { exactText: "Replacement" }
    }, deps),
    { code: "think_tank_exact_text_immutable", statusCode: 409 }
  );

  const updated = await updateThinkTankEntry({
    thoughtId: thought.thoughtId,
    expectedVersion: 1,
    changes: { status: "incubating", assistantSummary: "Interpretation only" }
  }, deps);
  assert.equal(updated.thought.exactText, "Original wording");
  assert.equal(updated.thought.status, "incubating");
  assert.equal(updated.thought.version, 2);

  await assert.rejects(
    () => updateThinkTankEntry({
      thoughtId: thought.thoughtId,
      expectedVersion: 1,
      changes: { status: "ready" }
    }, deps),
    { code: "think_tank_version_conflict", statusCode: 409 }
  );
});

test("reflections append exact source entries and paginate without replacement", async () => {
  const deps = createDeps();
  const { thought } = await captureThinkTankEntry({ exactText: "Original" }, deps);
  await appendThinkTankReflection({ thoughtId: thought.thoughtId, exactText: " First reflection " }, deps);
  await appendThinkTankReflection({ thoughtId: thought.thoughtId, exactText: "Second reflection" }, deps);

  const first = await listThinkTankReflections({ thoughtId: thought.thoughtId, limit: 1 }, deps);
  assert.equal(first.reflections[0].exactText, " First reflection ");
  assert.equal(first.moreAvailable, true);
  assert.ok(first.nextCursor);
  assert.equal(first.complete, false);

  const second = await listThinkTankReflections({
    thoughtId: thought.thoughtId,
    limit: 1,
    cursor: first.nextCursor
  }, deps);
  assert.equal(second.reflections[0].exactText, "Second reflection");
  assert.equal(second.moreAvailable, false);
  assert.equal(second.complete, true);
  assert.equal((await getThinkTankEntry({ thoughtId: thought.thoughtId }, deps)).thought.exactText, "Original");
});

test("verified outcome links support multiple destinations and close by default", async () => {
  const deps = createDeps();
  const { thought } = await captureThinkTankEntry({ exactText: "Weekly review idea" }, deps);

  await assert.rejects(
    () => linkThinkTankOutcome({
      thoughtId: thought.thoughtId,
      destinationSystem: "task_management",
      destinationType: "routine",
      destinationId: "routine-weekly",
      destinationVerified: false,
      verificationReference: "",
      expectedVersion: 1
    }, deps),
    { code: "think_tank_destination_not_verified", statusCode: 409 }
  );

  const first = await linkThinkTankOutcome({
    thoughtId: thought.thoughtId,
    destinationSystem: "task_management",
    destinationType: "routine",
    destinationId: "routine-weekly",
    destinationVerified: true,
    verificationReference: "readback-1",
    expectedVersion: 1,
    closeThought: false
  }, deps);
  assert.equal(first.thought.status, "inbox");
  assert.equal(first.thought.outcomeLinks.length, 1);

  const second = await linkThinkTankOutcome({
    thoughtId: thought.thoughtId,
    destinationSystem: "sermon_workspace",
    destinationType: "sermon",
    destinationId: "sermon-example",
    destinationVerified: true,
    verificationReference: "readback-2",
    expectedVersion: 2
  }, deps);
  assert.equal(second.thought.status, "closed");
  assert.equal(second.thought.outcomeLinks.length, 2);
});

test("entry listing and weekly board expose explicit pagination and triage groups", async () => {
  const deps = createDeps();
  const captures = [
    { exactText: "Ministry structure", status: "inbox", lifeArea: "church", topics: ["growth"] },
    { exactText: "Daily schedule", status: "incubating", lifeArea: "personal", topics: ["growth"] },
    { exactText: "Sermon seed", status: "ready", lifeArea: "church", candidateDestinations: ["sermon_workspace"] },
    { exactText: "Maybe later", status: "parked", lifeArea: "personal" }
  ];
  for (const input of captures) await captureThinkTankEntry(input, deps);

  const first = await listThinkTankEntries({ limit: 2 }, deps);
  assert.equal(first.totalCount, 4);
  assert.equal(first.returnedCount, 2);
  assert.equal(first.moreAvailable, true);
  assert.equal(first.complete, false);
  const second = await listThinkTankEntries({ limit: 2, cursor: first.nextCursor }, deps);
  assert.equal(second.returnedCount, 2);
  assert.equal(second.complete, true);

  const board = await buildThinkTankReview({ asOfDate: "2026-08-17", includeParked: false }, deps);
  assert.equal(board.totalOpenCount, 3);
  assert.equal(board.groups.inbox.length, 1);
  assert.equal(board.groups.incubating.length, 1);
  assert.equal(board.groups.ready.length, 1);
  assert.equal(board.groups.parked, undefined);
  assert.equal(board.countsByTopic.growth, 2);
  assert.equal(board.groups.inbox[0].ageDays, 7);
});
