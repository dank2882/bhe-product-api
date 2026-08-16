"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyPreachingProfileBaseline,
  getPreachingProfileBaselineReadiness,
  proposePreachingProfileBaseline
} = require("../lib/sermon-preaching-profile-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

  async set(data) {
    this.store.set(this.id, clone(data));
  }

  async create(data) {
    this.store.set(this.id, clone(data));
  }
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
  }

  doc(id) {
    return new FakeDocRef(this.store, id);
  }

  limit(maxDocs) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries()).slice(0, maxDocs).map(([id, data]) => ({
          id,
          data: () => clone(data)
        }))
      })
    };
  }
}

function createDeps() {
  const sermons = {};
  const sources = {};
  for (let index = 1; index <= 8; index += 1) {
    const sermonId = `sermon-current-${index}`;
    sermons[sermonId] = {
      sermonId,
      title: index === 1 ? "A Memorial Message" : `Current Sermon ${index}`,
      status: "preached",
      scriptureText: `James ${index}:1`,
      preachedDate: `2026-07-${String(index).padStart(2, "0")}`,
      updatedAt: "2026-08-01T00:00:00.000Z"
    };
    sources[`source-clean-${index}`] = {
      sourceId: `source-clean-${index}`,
      sermonId,
      sourceType: "cleaned_transcript",
      sourceLabel: index === 1 ? "Complete memorial transcript" : `Complete Sunday morning transcript ${index}`,
      material: `Transcript ${index}. Dan explains the text and presses a concrete response.`,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    };
  }
  for (let index = 1; index <= 2; index += 1) {
    const sermonId = `sermon-historical-${index}`;
    sermons[sermonId] = {
      sermonId,
      title: `Historical Sermon ${index}`,
      status: "preached",
      scriptureText: `Romans ${index}:1`,
      preachedDate: `2012-02-${String(index).padStart(2, "0")}`,
      updatedAt: "2026-08-01T00:00:00.000Z"
    };
    sources[`source-historical-${index}`] = {
      sourceId: `source-historical-${index}`,
      sermonId,
      sourceType: "cleaned_transcript",
      sourceLabel: `Cleaned historical transcript ${index}`,
      material: `Historical transcript ${index}.`,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    };
  }
  sources["source-raw-duplicate"] = {
    sourceId: "source-raw-duplicate",
    sermonId: "sermon-current-2",
    sourceType: "preached_transcript",
    sourceLabel: "Raw preached transcript",
    material: "Lower-priority duplicate.",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z"
  };
  delete sources["source-clean-8"];
  sources["source-raw-8"] = {
    sourceId: "source-raw-8",
    sermonId: "sermon-current-8",
    sourceType: "preached_transcript",
    sourceLabel: "Raw partial transcript",
    material: "Raw partial evidence.",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z"
  };
  sources["source-canonical-8"] = {
    sourceId: "source-canonical-8",
    sermonId: "sermon-current-8",
    sourceType: "transcript",
    sourceLabel: "Canonical complete preached transcript",
    material: "Complete evidence for current sermon eight.",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z"
  };
  return {
    sermonsCollection: new FakeCollection(sermons),
    sermonSourcesCollection: new FakeCollection(sources),
    sermonOccasionsCollection: new FakeCollection(),
    preachingProfilesCollection: new FakeCollection({
      default: {
        profileId: "default",
        version: 2,
        summary: "Existing profile",
        tone: ["pastoral"],
        strengths: [],
        recurringPatterns: [],
        cautions: [],
        draftingGuidance: "",
        observations: [],
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z"
      }
    }),
    preachingAnalysesCollection: new FakeCollection({
      "analysis-current-1": {
        analysisId: "analysis-current-1",
        sermonId: "sermon-current-1",
        title: "Review",
        analyzedAt: "2026-08-01T00:00:00.000Z",
        profileCandidates: []
      }
    }),
    now: () => "2026-08-16T12:00:00.000Z",
    generatePreachingProfileBaseline: async () => ({
      profile: {
        summary: "Dan preaches with a text-driven pastoral burden that seeks a concrete response.",
        tone: ["pastoral", "direct"],
        strengths: ["Connects the text to ordinary life."],
        recurringPatterns: ["Moves from explanation to direct application."],
        cautions: ["Return explicitly to the main movement after illustrations."],
        draftingGuidance: "Preserve Dan's exact material first, then the biblical text and approved shape, then this profile.",
        avoidances: ["Do not impose generic academic prose."],
        contextGuidance: [{
          context: "sunday_morning",
          guidance: "Keep the text and controlling burden verbally visible.",
          evidence: [{
            sermonId: "sermon-current-2",
            sourceId: "source-clean-2",
            quote: "Dan explains the text and presses a concrete response."
          }]
        }],
        growthGoals: [{
          dimension: "transitions",
          currentPattern: "Illustrations can widen the movement.",
          nextGrowthTarget: "Name the movement again after an illustration.",
          confidence: "recurring",
          evidence: [{
            sermonId: "sermon-current-2",
            sourceId: "source-clean-2",
            quote: "presses a concrete response"
          }]
        }],
        observations: [{
          category: "application",
          observation: "Dan presses hearers toward a concrete response.",
          confidence: "recurring",
          evidence: [{
            sermonId: "sermon-current-2",
            sourceId: "source-clean-2",
            quote: "presses a concrete response"
          }]
        }]
      }
    })
  };
}

test("selects a recent-first deduplicated baseline with historical comparison", async () => {
  const readiness = await getPreachingProfileBaselineReadiness({ limit: 10 }, createDeps());

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.counts.selectedSermons, 10);
  assert.equal(readiness.counts.currentBaselineSermons, 8);
  assert.equal(readiness.counts.historicalComparisonSermons, 2);
  assert.equal(readiness.selectedCorpus.filter((item) => item.sermonId === "sermon-current-2").length, 1);
  assert.equal(
    readiness.selectedCorpus.find((item) => item.sermonId === "sermon-current-2").sourceId,
    "source-clean-2"
  );
  assert.equal(
    readiness.selectedCorpus.find((item) => item.sermonId === "sermon-current-8").sourceId,
    "source-canonical-8"
  );
});

test("proposes without writing, then applies the unchanged approved baseline with provenance", async () => {
  const deps = createDeps();
  const before = clone(deps.preachingProfilesCollection.store.get("default"));
  const proposed = await proposePreachingProfileBaseline({ limit: 10 }, deps);

  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.proposal.expectedVersion, 2);
  assert.equal(proposed.proposal.profile.evidenceCorpus.currentSermonIds.length, 8);
  assert.deepEqual(deps.preachingProfilesCollection.store.get("default"), before);

  const applied = await applyPreachingProfileBaseline(
    proposed.applyInstructions.arguments,
    deps
  );

  assert.equal(applied.profile.version, 3);
  assert.equal(applied.profile.growthGoals.length, 1);
  assert.equal(applied.profile.contextGuidance.length, 1);
  assert.equal(applied.profile.evidenceCorpus.currentSermonIds.length, 8);
  assert.equal(applied.profile.baselineApprovedAt, "2026-08-16T12:00:00.000Z");
  assert.match(applied.profile.fingerprint, /^[a-f0-9]{64}$/);
});

test("rejects a stale approved baseline", async () => {
  const deps = createDeps();
  const proposed = await proposePreachingProfileBaseline({ limit: 10 }, deps);
  deps.preachingProfilesCollection.store.get("default").version = 3;

  await assert.rejects(
    () => applyPreachingProfileBaseline(proposed.applyInstructions.arguments, deps),
    (error) => error.code === "stale_preaching_profile_baseline"
  );
});
