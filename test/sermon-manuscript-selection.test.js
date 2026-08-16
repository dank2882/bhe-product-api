const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BHE_API_KEY ||= "test-api-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.GCP_PROJECT_ID ||= "test-project";
process.env.FIRESTORE_DATABASE_ID ||= "test-db";

const {
  applyManuscriptSemanticCoverageAudit,
  buildManuscriptDraftContext,
  buildRequiredManuscriptCoverageItems,
  buildUnresolvedDevelopmentSessionBlockers,
  buildSermonSourceManifestItem,
  createSermonSourceDownload,
  filterSermonSourcesForManuscript,
  isGeneratedSermonManuscriptSource,
  selectSermonSourcesDeterministically,
  validateManuscriptAssemblyCompliance,
  validateManuscriptDevelopmentCoverage
} = require("../index");

test("creates a fresh signed DOCX link for a sermon-scoped manuscript artifact", async () => {
  const calls = [];
  const result = await createSermonSourceDownload({
    source: { sermonId: "sermon-token" },
    sourceRef: {
      storagePath: "sermon-manuscripts/sermon-token/token-manuscript.docx",
      filename: "token-manuscript.docx",
      sizeBytes: 4321
    }
  }, {
    bucketName: "test-bucket",
    nowMs: () => Date.parse("2026-07-19T12:00:00.000Z"),
    storage: {
      bucket(bucketName) {
        calls.push({ bucketName });
        return {
          file(storagePath) {
            calls.push({ storagePath });
            return {
              async getSignedUrl(options) {
                calls.push({ options });
                return ["https://storage.example.test/token-manuscript.docx"];
              }
            };
          }
        };
      }
    }
  });

  assert.equal(result.downloadUrl, "https://storage.example.test/token-manuscript.docx");
  assert.equal(result.downloadUrlExpiresAt, "2026-07-26T12:00:00.000Z");
  assert.deepEqual(calls[0], { bucketName: "test-bucket" });
  assert.deepEqual(calls[1], {
    storagePath: "sermon-manuscripts/sermon-token/token-manuscript.docx"
  });
  assert.equal(calls[2].options.action, "read");
});

test("refuses to sign a manuscript path outside its sermon scope", async () => {
  await assert.rejects(
    createSermonSourceDownload({
      source: { sermonId: "sermon-token" },
      sourceRef: {
        storagePath: "sermon-manuscripts/another-sermon/private.docx"
      }
    }, {
      storage: { bucket() { throw new Error("must not sign"); } }
    }),
    /storage path is invalid/
  );
});

test("manuscript context includes only approved placed development material", () => {
  const context = buildManuscriptDraftContext({
    sermon: { sermonId: "sermon-material", title: "Material Sermon" },
    developmentCheckpoints: [
      {
        checkpointId: "placed-line",
        checkpointType: "verbatim",
        content: "The same grace that saved me sustains me.",
        exactWording: true,
        materialStatus: "placed",
        placementTarget: "Conclusion"
      },
      {
        checkpointId: "unplaced-line",
        checkpointType: "insight",
        content: "This unresolved thought must remain outside the draft.",
        materialStatus: "unplaced"
      },
      {
        checkpointId: "cut-line",
        checkpointType: "key_line",
        content: "This rejected phrase must never return.",
        materialStatus: "intentionally_cut"
      }
    ]
  });

  assert.match(context, /APPROVED PLACED DEVELOPMENT MATERIAL/);
  assert.match(context, /Placement target: Conclusion/);
  assert.match(context, /Preserve this wording exactly/);
  assert.match(context, /The same grace that saved me sustains me/);
  assert.doesNotMatch(context, /unresolved thought/);
  assert.doesNotMatch(context, /rejected phrase/);
});

test("manuscript context includes the complete versioned preaching profile contract", () => {
  const context = buildManuscriptDraftContext({
    sermon: { sermonId: "sermon-profile", title: "Profile Sermon" },
    preachingProfile: {
      profileId: "default",
      version: 4,
      fingerprint: "a".repeat(64),
      summary: "Dan preaches with a text-driven pastoral burden.",
      tone: ["pastoral", "direct"],
      strengths: ["Concrete application"],
      recurringPatterns: ["Moves from explanation to response"],
      cautions: ["Return to the movement after illustrations"],
      draftingGuidance: "Preserve Dan's exact material before applying profile guidance.",
      avoidances: ["Generic academic prose"],
      contextGuidance: [{ context: "midweek", guidance: "Keep it conversational." }],
      growthGoals: [{ dimension: "transitions", nextGrowthTarget: "Restate the movement." }],
      observations: [{ category: "application", observation: "Presses for lived faith." }]
    }
  });

  assert.match(context, /PREACHING PROFILE/);
  assert.match(context, /"version": 4/);
  assert.match(context, /"tone":/);
  assert.match(context, /"draftingGuidance":/);
  assert.match(context, /"contextGuidance":/);
  assert.match(context, /"growthGoals":/);
  assert.doesNotMatch(context, /recurringStrengths/);
  assert.doesNotMatch(context, /stylePreferences/);
  assert.doesNotMatch(context, /cautionFlags/);
});

test("sermon manuscript selector prefers the primary refined manuscript over newer original notes", () => {
  const sermon = {
    sermonId: "sermon-help-healing",
    title: "Help, Healing, and Hope in a Broken World",
    primaryManuscriptSourceId: "source-refined"
  };
  const sources = [
    {
      sourceId: "source-original",
      sourceType: "old_chat",
      sourceLabel: "Original preparation notes",
      summary: "Original planning and old-chat development.",
      material: "Original material.",
      createdAt: "2026-07-10T18:00:00.000Z"
    },
    {
      sourceId: "source-transcript",
      sourceType: "preached_transcript",
      sourceLabel: "Preached transcript",
      summary: "What was preached live.",
      material: "Transcript material.",
      createdAt: "2026-07-09T18:00:00.000Z"
    },
    {
      sourceId: "source-refined",
      sourceType: "doc",
      sourceLabel: "Refined future preaching manuscript",
      summary: "The version to preach from next time.",
      material: "Refined material.",
      createdAt: "2026-07-08T18:00:00.000Z"
    }
  ];

  const selected = selectSermonSourcesDeterministically({
    sermon,
    sources,
    maxSources: 3
  });

  assert.equal(selected[0].sourceId, "source-refined");
  assert.equal(selected[1].sourceId, "source-original");
  assert.equal(selected[2].sourceId, "source-transcript");
});

test("sermon source manifest is compact and does not include full material", () => {
  const manifestItem = buildSermonSourceManifestItem(
    {
      sourceId: "source-long",
      sourceType: "doc",
      sourceLabel: "Long manuscript",
      summary: "A".repeat(2000),
      material: "Full manuscript should stay out of the selector manifest.",
      sourceRefs: [{ role: "manuscript_draft" }]
    },
    { primaryManuscriptSourceId: "source-long" }
  );

  assert.equal(manifestItem.sourceId, "source-long");
  assert.equal(manifestItem.isPrimaryManuscript, true);
  assert.equal(manifestItem.roles[0], "manuscript_draft");
  assert.equal(manifestItem.material, undefined);
  assert.ok(manifestItem.summary.length < 1000);
  assert.ok(manifestItem.materialChars > 0);
});

test("manuscript coverage validation requires placed exact and key material only", () => {
  const checkpoints = [
    {
      checkpointId: "placed-key",
      checkpointType: "key_line",
      content: "Don't just focus on getting out of Egypt-let God get Egypt out of you.",
      materialStatus: "placed",
      placementTarget: "Conclusion"
    },
    {
      checkpointId: "placed-application",
      checkpointType: "application",
      content: "Take a breath-God is in control. You don't have to carry what only He can carry.",
      materialStatus: "placed",
      placementTarget: "Pastoral closing"
    },
    {
      checkpointId: "unplaced-key",
      checkpointType: "key_line",
      content: "This unplaced line should not be required.",
      materialStatus: "unplaced"
    },
    {
      checkpointId: "cut-key",
      checkpointType: "key_line",
      content: "This cut line should not be required.",
      materialStatus: "intentionally_cut"
    }
  ];

  const required = buildRequiredManuscriptCoverageItems(checkpoints);
  assert.deepEqual(required.map((item) => item.checkpointId), ["placed-key", "placed-application"]);

  const missingResult = validateManuscriptDevelopmentCoverage(
    "The sermon closes with this pastoral word: Take a breath—God is in control. You don't have to carry what only He can carry.",
    checkpoints
  );
  assert.equal(missingResult.requiredCount, 2);
  assert.equal(missingResult.missingCount, 1);
  assert.equal(missingResult.missing[0].checkpointId, "placed-key");

  const coveredResult = validateManuscriptDevelopmentCoverage(
    [
      "Don't just focus on getting out of Egypt—let God get Egypt out of you.",
      "Take a breath—God is in control. You don't have to carry what only He can carry."
    ].join("\n"),
    checkpoints
  );
  assert.equal(coveredResult.missingCount, 0);
});

test("semantic evidence verifies paraphrased illustrations and applications without weakening exact wording", () => {
  const checkpoints = [
    {
      checkpointId: "car-road-illustration",
      checkpointType: "illustration",
      content: "Driving a road you were told is right, but as it becomes unfamiliar others begin questioning it, increasing doubt until a visible sign confirms to everyone you are on the right road.",
      materialStatus: "placed",
      placementTarget: "Movement 3"
    },
    {
      checkpointId: "sustaining-presence",
      checkpointType: "application",
      content: "Believers should not treat tokens as a way out of hardship but as God's means of sustaining them within it.",
      materialStatus: "placed",
      placementTarget: "Movement 4"
    },
    {
      checkpointId: "humble-posture",
      checkpointType: "application",
      content: "Believers must approach asking for a token with humility, avoiding both entitlement and superstition.",
      materialStatus: "placed",
      placementTarget: "Movement 5"
    },
    {
      checkpointId: "do-not-accuse",
      checkpointType: "application",
      content: "Believers should not become frustrated or accuse God of failure if a token is not given quickly.",
      materialStatus: "placed",
      placementTarget: "Movement 5"
    },
    {
      checkpointId: "protected-line",
      checkpointType: "key_line",
      content: "God is in no way obligated or bound to answer this.",
      exactWording: true,
      materialStatus: "placed",
      placementTarget: "Movement 5"
    }
  ];
  const evidence = {
    car: "Picture the people in your car asking whether you missed a turn as the road becomes unfamiliar. Then a clear road sign appears, and everyone can see that you are still traveling the right road.",
    sustaining: "The token is not an exit ramp out of the trial. It is the assurance of God's sustaining presence while you remain in the trial.",
    humble: "We therefore ask humbly, refusing both the entitlement that demands an answer and the superstition that assigns God's voice to every ordinary event.",
    accuse: "When no sign comes on our preferred timetable, we must not grow frustrated or accuse God of failing us. His grace is not a debt that we can collect.",
    fabricated: "This sentence does not occur anywhere in the manuscript and cannot be accepted as evidence."
  };
  const manuscript = [evidence.car, evidence.sustaining, evidence.humble, evidence.accuse].join("\n\n");
  const deterministic = validateManuscriptDevelopmentCoverage(manuscript, checkpoints);

  assert.equal(deterministic.missingCount, 5);

  const audited = applyManuscriptSemanticCoverageAudit(manuscript, deterministic, [
    { checkpointId: "car-road-illustration", included: true, confidence: "high", evidence: evidence.car },
    { checkpointId: "sustaining-presence", included: true, confidence: "high", evidence: evidence.sustaining },
    { checkpointId: "humble-posture", included: true, confidence: "high", evidence: evidence.humble },
    { checkpointId: "do-not-accuse", included: true, confidence: "high", evidence: evidence.accuse },
    { checkpointId: "protected-line", included: true, confidence: "high", evidence: evidence.fabricated }
  ]);

  assert.equal(audited.semanticAcceptedCount, 4);
  assert.equal(audited.coveredCount, 4);
  assert.equal(audited.missingCount, 1);
  assert.equal(audited.missing[0].checkpointId, "protected-line");
  assert.equal(audited.covered[0].coverageMethod, "semantic_evidence");
});

test("semantic coverage rejects evidence that is not an exact manuscript excerpt", () => {
  const checkpoints = [{
    checkpointId: "application",
    checkpointType: "application",
    content: "Ask humbly without demanding that God answer on your timetable.",
    materialStatus: "placed"
  }];
  const manuscript = "We ask with humility and leave both the answer and its timing to the Lord.";
  const deterministic = validateManuscriptDevelopmentCoverage(manuscript, checkpoints);
  const audited = applyManuscriptSemanticCoverageAudit(manuscript, deterministic, [{
    checkpointId: "application",
    included: true,
    confidence: "high",
    evidence: "The manuscript clearly says that we should ask humbly and trust God's timing."
  }]);

  assert.equal(audited.semanticAcceptedCount, 0);
  assert.equal(audited.missingCount, 1);
  assert.equal(audited.missing[0].semanticAudit.evidenceVerified, false);
});

test("manuscript generation blocks active or empty unresolved development sessions", () => {
  const blockers = buildUnresolvedDevelopmentSessionBlockers([
    {
      sessionId: "active-empty",
      label: "Pre-Sunday capture",
      mode: "voice",
      status: "active",
      checkpointCount: 0,
      summary: "",
      rawTranscriptSourceId: "",
      startedAt: "2026-07-11T19:38:07.884Z"
    },
    {
      sessionId: "closed-empty",
      label: "Closed but empty",
      mode: "chat",
      status: "closed",
      checkpointCount: 0,
      summary: "",
      rawTranscriptSourceId: ""
    },
    {
      sessionId: "closed-source",
      label: "Closed with source",
      mode: "chat",
      status: "closed",
      checkpointCount: 0,
      summary: "",
      rawTranscriptSourceId: "source-chat"
    },
    {
      sessionId: "closed-checkpointed",
      label: "Closed with checkpoints",
      mode: "walk",
      status: "closed",
      checkpointCount: 2,
      summary: "",
      rawTranscriptSourceId: ""
    }
  ]);

  assert.deepEqual(blockers.map((item) => item.sessionId), ["active-empty", "closed-empty"]);
  assert.equal(blockers[0].label, "Pre-Sunday capture");
  assert.equal(blockers[0].checkpointCount, 0);
});

test("fresh manuscript source filter excludes prior generated manuscript drafts", () => {
  const sources = [
    {
      sourceId: "generated-primary",
      sourceType: "doc",
      sourceLabel: "Generated manuscript draft - 2026-07-12",
      summary: "GPT manuscript draft created with gpt-5.6-sol.",
      sourceRefs: [{ role: "manuscript_draft" }]
    },
    {
      sourceId: "development-chat",
      sourceType: "old_chat",
      sourceLabel: "Pre-Sunday development chat",
      summary: "Raw development conversation.",
      sourceRefs: [{ role: "raw_development_chat" }]
    },
    {
      sourceId: "study-notes",
      sourceType: "study_notes",
      sourceLabel: "Exodus study notes",
      summary: "Preparation notes."
    }
  ];

  assert.equal(isGeneratedSermonManuscriptSource(sources[0]), true);
  assert.equal(isGeneratedSermonManuscriptSource(sources[1]), false);

  const filtered = filterSermonSourcesForManuscript(sources, {
    excludeGeneratedManuscriptSources: true
  });

  assert.deepEqual(filtered.map((source) => source.sourceId), ["development-chat", "study-notes"]);
});

test("manuscript source filter can explicitly include prior generated drafts", () => {
  const sources = [
    {
      sourceId: "generated-primary",
      sourceType: "doc",
      sourceLabel: "Generated manuscript draft - 2026-07-12",
      summary: "GPT manuscript draft created with gpt-5.6-sol.",
      sourceRefs: [{ role: "manuscript_draft" }]
    },
    {
      sourceId: "development-chat",
      sourceType: "old_chat",
      sourceLabel: "Pre-Sunday development chat",
      summary: "Raw development conversation."
    }
  ];

  const filtered = filterSermonSourcesForManuscript(sources, {
    excludeGeneratedManuscriptSources: false
  });

  assert.deepEqual(filtered.map((source) => source.sourceId), ["generated-primary", "development-chat"]);
});

test("assembly compliance rejects instruction-heavy endings when relief was requested", () => {
  const result = validateManuscriptAssemblyCompliance(`
# Sermon

## PERSONAL APPLICATION AND EXAMINATION

Consider these questions.

## PRACTICAL APPLICATIONS

1. Do one thing.
2. Do another thing.
3. Do a third thing.
4. Do a fourth thing.

You don't have to fix the season... you have to trust the God who's in it.
`);

  assert.equal(result.violationCount, 2);
  assert.deepEqual(
    result.violations.map((violation) => violation.code),
    ["personal_application_section_present", "too_many_practical_applications"]
  );
});

test("assembly compliance accepts simple relief-shaped conclusion", () => {
  const result = validateManuscriptAssemblyCompliance(`
## CONCLUSION

God doesn't waste seasons like this... He uses them to shape you, prepare you, and reveal Himself to you.

You don't have to fix the season... you have to trust the God who's in it.
`);

  assert.equal(result.violationCount, 0);
});

test("assembly compliance never applies another sermon's final phrase", () => {
  const tokenConclusion = `
## CONCLUSION

God, I do not need every explanation, but I do need the assurance that You are with me.
`;

  const withoutSermonSpecificRequirement = validateManuscriptAssemblyCompliance(tokenConclusion, {
    requireSimpleFinalPosture: true
  });
  assert.equal(withoutSermonSpecificRequirement.violationCount, 0);

  const missingRequiredPosture = validateManuscriptAssemblyCompliance(tokenConclusion, {
    requireSimpleFinalPosture: true,
    simpleFinalPosture: "I can leave the explanation with God."
  });
  assert.deepEqual(
    missingRequiredPosture.violations.map((violation) => violation.code),
    ["missing_simple_final_posture"]
  );

  const matchingPosture = validateManuscriptAssemblyCompliance(`${tokenConclusion}\nI can leave the explanation with God.`, {
    requireSimpleFinalPosture: true,
    simpleFinalPosture: "I can leave the explanation with God."
  });
  assert.equal(matchingPosture.violationCount, 0);
});
