const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applySermonPostPreachingReflection,
  assessTranscriptFidelity,
  getSermonPostPreachingReflectionReadiness,
  proposeSermonPostPreachingReflection
} = require("../lib/sermon-post-preaching-reflection-service");
const { saveReviewedPostPreachingScriptureNotes } = require("../lib/scripture-note-service");

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
  async delete() { this.store.delete(this.id); }
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

function fakeFirestore() {
  let queue = Promise.resolve();
  return { runTransaction(callback) {
    const run = queue.then(async () => {
      const writes = [];
      const result = await callback({
        get: ref => ref.get(),
        create: (ref, data) => writes.push(() => ref.create(data)),
        set: (ref, data) => writes.push(() => ref.set(data))
      });
      for (const write of writes) await write();
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }};
}

function createDeps() {
  const exactLiveLine = "The same grace that saved you on Monday will hold you when Friday comes.";
  const commentaryLine = "God is not only present before the season; He is our refuge inside it.";
  const retainedLine = "Time by itself does not heal. Time with help does heal.";
  const transcript = [
    "We have walked through the appointed seasons of life.",
    retainedLine,
    exactLiveLine,
    commentaryLine,
    "Ecclesiastes 3 does not teach fatalism. It teaches us that God remains God when the season changes.",
    "Take a breath. You do not have to carry what only God can carry."
  ].join("\n\n");
  return {
    firestoreDb: fakeFirestore(),
    sermonOperationExecutionsCollection: new FakeCollection(),
    sermonsCollection: new FakeCollection({
      "sermon-times": {
        sermonId: "sermon-times",
        title: "Times and Seasons",
        status: "preached",
        scriptureText: "Ecclesiastes 3:1-8",
        bigIdea: "God appoints the seasons and remains faithful through them.",
        outline: "I. God appoints the season\nII. God meets us in the season",
        primaryManuscriptSourceId: "source-manuscript",
        updatedAt: "2026-07-12T18:00:00.000Z"
      }
    }),
    sermonOccasionsCollection: new FakeCollection(),
    sermonSourcesCollection: new FakeCollection({
      "source-manuscript": {
        sourceId: "source-manuscript",
        sermonId: "sermon-times",
        sourceType: "doc",
        sourceLabel: "Accepted manuscript",
        material: `God appoints every season. Take a breath and trust Him in Egypt. ${retainedLine}`,
        sourceRefs: [{ role: "manuscript_draft" }],
        createdAt: "2026-07-12T15:00:00.000Z"
      },
      "source-raw": {
        sourceId: "source-raw",
        sermonId: "sermon-times",
        sourceType: "preached_transcript",
        sourceLabel: "Raw transcript",
        material: "Raw transcript should not win when cleaned text exists.",
        createdAt: "2026-07-12T19:00:00.000Z"
      },
      "source-cleaned": {
        sourceId: "source-cleaned",
        sermonId: "sermon-times",
        sourceType: "cleaned_transcript",
        sourceLabel: "Cleaned preached transcript",
        material: transcript,
        createdAt: "2026-07-12T19:05:00.000Z"
      }
    }),
    sermonDevelopmentCheckpointsCollection: new FakeCollection({
      "checkpoint-planned": {
        checkpointId: "checkpoint-planned",
        sermonId: "sermon-times",
        checkpointType: "application",
        content: "Take a breath. You do not have to carry what only God can carry.",
        materialStatus: "placed",
        placementTarget: "Conclusion"
      }
    }),
    preachingProfilesCollection: new FakeCollection(),
    preachingAnalysesCollection: new FakeCollection(),
    sermonChunksCollection: new FakeCollection(),
    scriptureNotesCollection: new FakeCollection(),
    scriptureNoteImportsCollection: new FakeCollection(),
    scriptureNoteImportSegmentsCollection: new FakeCollection(),
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-12T20:00:00.000Z",
    exactLiveLine,
    commentaryLine,
    retainedLine,
    generatePostPreachingReflection: async () => ({
      summary: "The preached sermon retained the planned comfort while adding a memorable grace line.",
      retainedCore: [{ observation: "The call to trust God remained central.", evidence: "Take a breath." }],
      liveDevelopments: [
        { observation: "Grace was applied across the week.", evidence: exactLiveLine },
        { observation: "The healing line was retained.", evidence: retainedLine }
      ],
      plannedMaterialNotPreached: [],
      changedEmphasis: [],
      strengths: ["The live application remained tied to the controlling idea."],
      growthEdges: ["State the transition into the second movement more explicitly."],
      styleObservations: ["Uses short pastoral imperatives to land doctrine."],
      structureNotes: ["The two movements remained recognizable."],
      applicationNotes: ["The closing application became more concrete."],
      deliveryNotes: ["The key line was followed by a direct application."],
      strongestLiveLanguage: [
        { text: exactLiveLine, context: "Closing application", reason: "Reusable grace language" },
        { text: commentaryLine, context: "Psalm 46 application", reason: "Reusable commentary language" },
        { text: retainedLine, context: "Healing application", reason: "Already planned and must be filtered" },
        { text: "This sentence was never actually preached.", context: "Invented", reason: "Must be filtered" }
      ],
      scriptureNoteCandidates: [
        {
          reference: "Ecclesiastes 3:1-8",
          content: "Ecclesiastes 3 does not teach fatalism; God remains God when the season changes.",
          noteType: "interpretation",
          authorship: "dan_developed",
          confidence: 0.94,
          evidenceQuote: "Ecclesiastes 3 does not teach fatalism. It teaches us that God remains God when the season changes.",
          reason: "Reusable interpretation of the passage",
          novelty: "new_live_development",
          plannedComparison: "Primary passage: Ecclesiastes 3:1-8",
          differenceFromPlan: "The plan named the passage but did not contain this explicit correction of a fatalistic reading."
        },
        {
          reference: "Psalm 46:1",
          content: commentaryLine,
          noteType: "application",
          authorship: "dan_verbatim",
          confidence: 0.95,
          evidenceQuote: commentaryLine,
          reason: "New live Scripture-linked language should use the commentary destination."
        },
        {
          reference: "Ecclesiastes 3:1-8",
          content: retainedLine,
          noteType: "application",
          authorship: "dan_verbatim",
          confidence: 0.95,
          evidenceQuote: retainedLine,
          reason: "Already present in manuscript and must be filtered"
        },
        {
          reference: "Psalm 1:1",
          content: "Unsupported candidate",
          confidence: 0.9,
          evidenceQuote: "This evidence was not preached.",
          reason: "Must be filtered"
        }
      ],
      profileCandidates: [{
        category: "application",
        observation: "Uses brief pastoral imperatives to make doctrine concrete.",
        confidence: "observed_once",
        evidence: "Take a breath."
      }],
      recommendedNextActions: ["Preserve the strongest live grace line."],
      warnings: []
    })
  };
}

test("distinguishes summary-like transcript sources from verbatim transcript text", () => {
  const summary = assessTranscriptFidelity({
    material: [
      "CLEANED PREACHED TRANSCRIPT",
      "The message begins by reading James 2.",
      "The sermon develops the vessel image.",
      "The preacher explains the application.",
      "The closing widens toward missions."
    ].join("\n")
  });
  const verbatim = assessTranscriptFidelity({
    material: "Church, I want you to see what James says here. We have received mercy, and now we must carry mercy."
  });

  assert.equal(summary.fidelity, "summary");
  assert.equal(summary.exactLanguageEligible, false);
  assert.equal(verbatim.exactLanguageEligible, true);
});

test("reports reflection readiness and selects the cleaned transcript", async () => {
  const deps = createDeps();
  const result = await getSermonPostPreachingReflectionReadiness({ sermonId: "sermon-times" }, deps);

  assert.equal(result.status, "ready");
  assert.equal(result.sources.plannedBaseline.manuscriptSourceId, "source-manuscript");
  assert.equal(result.sources.preachedTranscript.transcriptSourceId, "source-cleaned");
  assert.equal(result.sources.preachedTranscript.sourceType, "cleaned_transcript");
});

test("proposes only transcript-grounded live lines and Scripture notes", async () => {
  const deps = createDeps();
  const result = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);

  assert.equal(result.status, "proposed");
  assert.match(result.proposal.proposalId, /^sermon-reflection-/);
  assert.equal(result.proposal.reflection.strongestLiveLanguage.length, 1);
  assert.equal(result.proposal.reflection.strongestLiveLanguage[0].text, deps.exactLiveLine);
  assert.equal(result.proposal.reflection.scriptureNoteCandidates.length, 2);
  assert.equal(result.proposal.reflection.scriptureNoteCandidates[0].reference, "Ecclesiastes 3:1-8");
  assert.equal(result.proposal.reflection.strongestLiveLanguage.some((item) => item.text === deps.retainedLine), false);
  assert.equal(result.proposal.reflection.strongestLiveLanguage.some((item) => item.text === deps.commentaryLine), false);
  assert.equal(result.proposal.reflection.scriptureNoteCandidates.some((item) => item.content === deps.retainedLine), false);
  assert.equal(result.proposal.reflection.liveDevelopments.some((item) => item.evidence === deps.retainedLine), false);
  assert.equal(result.proposal.reflection.retainedCore.some((item) => item.evidence === deps.retainedLine), true);
  assert.ok(result.proposal.reflection.noveltyReview.reclassifiedRetainedCount >= 1);
});

test("applies a confirmed reflection with analysis, exact live language, commentary provenance, and rebuilt chunks", async () => {
  const deps = createDeps();
  deps.saveReviewedPostPreachingScriptureNotes = saveReviewedPostPreachingScriptureNotes;
  const proposed = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);
  const applied = await applySermonPostPreachingReflection({
    ...proposed.applyInstructions.arguments,
    rebuildChunks: true
  }, deps);

  assert.equal(applied.status, "applied");
  assert.equal(applied.profileUpdated, false);
  assert.equal(applied.liveLanguage.savedCount, 1);
  assert.equal(applied.scriptureNotes.createdNoteCount, 2);
  assert.equal(applied.chunksRebuilt, true);
  assert.ok(applied.chunkCount > 0);
  const analysis = Array.from(deps.preachingAnalysesCollection.store.values())[0];
  assert.equal(analysis.reflectionProposalId, proposed.proposal.proposalId);
  assert.equal(analysis.sourceRefs[1].sourceId, "source-cleaned");
  const checkpoint = Array.from(deps.sermonDevelopmentCheckpointsCollection.store.values())
    .find((item) => item.content === deps.exactLiveLine);
  assert.equal(checkpoint.materialStatus, "unplaced");
  assert.equal(checkpoint.exactWording, true);
  const note = Array.from(deps.scriptureNotesCollection.store.values())[0];
  assert.equal(note.reference, "Ecclesiastes 3:1-8");
  assert.deepEqual(note.sermonSourceIds, ["source-cleaned"]);
  assert.deepEqual(note.preachingAnalysisIds, [analysis.analysisId]);
});

test("rejects a reflection after the transcript changes", async () => {
  const deps = createDeps();
  deps.saveReviewedPostPreachingScriptureNotes = saveReviewedPostPreachingScriptureNotes;
  const proposed = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);
  const transcript = deps.sermonSourcesCollection.store.get("source-cleaned");
  transcript.material += "\nA later transcript correction.";
  deps.sermonSourcesCollection.store.set("source-cleaned", transcript);

  await assert.rejects(
    applySermonPostPreachingReflection(proposed.applyInstructions.arguments, deps),
    (error) => error.code === "stale_post_preaching_reflection"
  );
  assert.equal(deps.preachingAnalysesCollection.store.size, 0);
});

test("an active development session does not block approved transcript excerpts", async () => {
  const deps = createDeps();
  deps.sermonDevelopmentSessionsCollection = new FakeCollection({ active: { sermonId: "sermon-times", status: "active" } });
  deps.saveReviewedPostPreachingScriptureNotes = saveReviewedPostPreachingScriptureNotes;
  const proposal = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);
  const result = await applySermonPostPreachingReflection(proposal.applyInstructions.arguments, deps);
  assert.equal(result.liveLanguage.savedCount, 1);
  assert.equal(deps.sermonDevelopmentSessionsCollection.store.get("active").status, "active");
});

test("failure after staging analysis, profile, and phrases commits nothing; retry saves once", async () => {
  const deps = createDeps();
  const before = clone([...deps.sermonDevelopmentCheckpointsCollection.store]);
  deps.saveReviewedPostPreachingScriptureNotes = async () => { throw new Error("injected note failure"); };
  const proposal = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);
  const args = { ...proposal.applyInstructions.arguments, applyProfileCandidates: true, rebuildChunks: false };
  await assert.rejects(applySermonPostPreachingReflection(args, deps), /injected note failure/);
  assert.equal(deps.preachingAnalysesCollection.store.size, 0);
  assert.equal(deps.preachingProfilesCollection.store.size, 0);
  assert.equal(deps.sermonOperationExecutionsCollection.store.size, 0);
  assert.deepEqual([...deps.sermonDevelopmentCheckpointsCollection.store], before);
  deps.saveReviewedPostPreachingScriptureNotes = saveReviewedPostPreachingScriptureNotes;
  const first = await applySermonPostPreachingReflection(args, deps);
  const second = await applySermonPostPreachingReflection(args, deps);
  assert.equal(second.reflectionReplayed, true);
  assert.equal(second.analysis.analysisId, first.analysis.analysisId);
  assert.equal(deps.preachingAnalysesCollection.store.size, 1);
  assert.equal(deps.preachingProfilesCollection.store.values().next().value.version, 1);
  assert.equal(deps.scriptureNotesCollection.store.size, 2);
  assert.equal(deps.sermonDevelopmentCheckpointsCollection.store.size, 2);
});

test("simultaneous application of a proposal creates one reflection and one receipt", async () => {
  const deps = createDeps();
  deps.saveReviewedPostPreachingScriptureNotes = saveReviewedPostPreachingScriptureNotes;
  const proposal = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);
  const args = { ...proposal.applyInstructions.arguments, rebuildChunks: false };
  const results = await Promise.all([applySermonPostPreachingReflection(args, deps), applySermonPostPreachingReflection(args, deps)]);
  assert.deepEqual(results.map(r => r.reflectionReplayed), [false, true]);
  assert.equal(deps.preachingAnalysesCollection.store.size, 1);
  assert.equal(deps.sermonOperationExecutionsCollection.store.size, 1);
  await assert.rejects(applySermonPostPreachingReflection({ ...args, saveLiveLanguage: false }, deps), { code: "post_preaching_reflection_selection_conflict" });
});

test("indexing failure reports a saved reflection with indexing pending", async () => {
  const deps = createDeps();
  deps.saveReviewedPostPreachingScriptureNotes = saveReviewedPostPreachingScriptureNotes;
  const proposal = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);
  delete deps.sermonChunksCollection;
  const result = await applySermonPostPreachingReflection(proposal.applyInstructions.arguments, deps);
  assert.equal(result.status, "applied");
  assert.equal(result.indexingPending, true);
  assert.equal(deps.preachingAnalysesCollection.store.size, 1);
});

test("legacy proposal records cannot be silently duplicated", async () => {
  const deps = createDeps();
  const proposal = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);
  deps.preachingAnalysesCollection.store.set("legacy", { analysisId: "legacy", sermonId: "sermon-times", reflectionProposalId: proposal.proposal.proposalId });
  await assert.rejects(applySermonPostPreachingReflection(proposal.applyInstructions.arguments, deps), { code: "post_preaching_reflection_already_saved" });
  assert.equal(deps.preachingAnalysesCollection.store.size, 1);
});

test("duplicate removal is guarded, recoverable, and repeatable", async () => {
  const { removeDuplicatePreachingAnalysis, listPreachingAnalyses } = require("../lib/sermon-workspace-service");
  const deps = createDeps();
  const record = { sermonId: "sermon-times", reflectionProposalId: "reviewed-proposal", summary: "Exact approved wording", updatedAt: "before" };
  deps.preachingAnalysesCollection.store.set("keep", { ...record, analysisId: "keep" });
  deps.preachingAnalysesCollection.store.set("duplicate", { ...record, analysisId: "duplicate" });
  const args = { sermonId: "sermon-times", analysisId: "duplicate", keepAnalysisId: "keep", expectedUpdatedAt: "before", expectedKeepUpdatedAt: "before", confirmed: true };
  await assert.rejects(removeDuplicatePreachingAnalysis({ ...args, confirmed: false }, deps));
  await assert.rejects(removeDuplicatePreachingAnalysis({ ...args, expectedUpdatedAt: "stale" }, deps));
  deps.preachingAnalysesCollection.store.get("duplicate").summary = "Different wording";
  await assert.rejects(removeDuplicatePreachingAnalysis(args, deps), { code: "analyses_not_duplicates" });
  deps.preachingAnalysesCollection.store.get("duplicate").summary = record.summary;
  const result = await removeDuplicatePreachingAnalysis(args, deps);
  assert.equal(result.status, "removed");
  assert.equal((await removeDuplicatePreachingAnalysis(args, deps)).replayed, true);
  const list = await listPreachingAnalyses({ sermonId: "sermon-times" }, deps);
  assert.deepEqual(list.analyses.map(a => a.analysisId), ["keep"]);
  assert.equal(deps.preachingAnalysesCollection.store.get("duplicate").summary, record.summary);
  assert.equal(deps.preachingAnalysesCollection.store.get("keep").updatedAt, "before");
});

test("dispatcher retries a failed reflection with the same key and replays across new keys", async () => {
  const { runIdempotentSermonWorkspaceOperation } = require("../lib/sermon-workspace-operation-execution");
  const deps = createDeps();
  const proposal = await proposeSermonPostPreachingReflection({ sermonId: "sermon-times" }, deps);
  const request = { mode: "command", operation: "applySermonPostPreachingReflection", idempotencyKey: "reflection-retry-same-key", arguments: { ...proposal.applyInstructions.arguments, rebuildChunks: false } };
  deps.saveReviewedPostPreachingScriptureNotes = async () => { throw new Error("temporary failure"); };
  await assert.rejects(runIdempotentSermonWorkspaceOperation(request, deps), /temporary failure/);
  deps.saveReviewedPostPreachingScriptureNotes = saveReviewedPostPreachingScriptureNotes;
  const saved = await runIdempotentSermonWorkspaceOperation(request, deps);
  const replay = await runIdempotentSermonWorkspaceOperation({ ...request, idempotencyKey: "another-chat-retry-key" }, deps);
  assert.equal(replay.result.reflectionReplayed, true);
  assert.equal(replay.result.analysis.analysisId, saved.result.analysis.analysisId);
  assert.equal(deps.preachingAnalysesCollection.store.size, 1);
  await assert.rejects(runIdempotentSermonWorkspaceOperation({ ...request, arguments: { ...request.arguments, saveLiveLanguage: false } }, deps), { code: "idempotency_key_reused" });
});
