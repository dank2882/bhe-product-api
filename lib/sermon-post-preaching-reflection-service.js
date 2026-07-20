"use strict";

const { createHash } = require("node:crypto");
const sermonWorkspace = require("./sermon-workspace-service");

const TRANSCRIPT_SOURCE_PRIORITY = new Map([
  ["cleaned_transcript", 0],
  ["preached_transcript", 1],
  ["youtube_caption", 2],
  ["vimeo_transcript", 3],
  ["transcript", 4]
]);
const PLANNED_SOURCE_PRIORITY = new Map([
  ["doc", 0],
  ["study_notes", 1],
  ["logos_export", 2],
  ["old_chat", 3]
]);
const PROFILE_CONFIDENCE_LEVELS = new Set(["observed_once", "recurring", "established"]);
const MAX_CONTEXT_CHARS = 180000;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value, maximum = 20) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeString)
    .filter(Boolean)
    .slice(0, maximum);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createReflectionError(message, statusCode = 400, code = "sermon_post_preaching_reflection_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function hashValue(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function normalizeForEvidence(value) {
  return normalizeString(value).toLowerCase().replace(/\s+/g, " ");
}

function isTranscriptEvidence(value, transcriptText) {
  const evidence = normalizeForEvidence(value);
  return evidence.length >= 12 && normalizeForEvidence(transcriptText).includes(evidence);
}

function tokenizeForNovelty(value) {
  return normalizeForEvidence(value).match(/[a-z0-9]+/g) || [];
}

function calculateTokenSimilarity(leftValue, rightValue) {
  const left = new Set(tokenizeForNovelty(leftValue));
  const right = new Set(tokenizeForNovelty(rightValue));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.max(left.size, right.size);
}

function findBestPlannedSimilarity(value, plannedText) {
  const candidate = normalizeForEvidence(value);
  const planned = normalizeForEvidence(plannedText);
  if (!candidate || candidate.length < 12 || !planned) return { exact: false, similarity: 0, plannedMatch: "" };
  if (planned.includes(candidate)) return { exact: true, similarity: 1, plannedMatch: normalizeString(value) };
  const segments = normalizeString(plannedText)
    .split(/(?:\n+|(?<=[.!?])\s+)/)
    .map(normalizeString)
    .filter((segment) => segment.length >= 12 && segment.length <= 1000);
  return segments.reduce((best, segment) => {
    const similarity = calculateTokenSimilarity(value, segment);
    return similarity > best.similarity ? { exact: false, similarity, plannedMatch: segment } : best;
  }, { exact: false, similarity: 0, plannedMatch: "" });
}

function assessPreservationNovelty({
  text,
  plannedText,
  novelty,
  plannedComparison,
  differenceFromPlan,
  reference
}) {
  const match = findBestPlannedSimilarity(text, plannedText);
  if (match.exact) return { eligible: false, classification: "retained_exact", ...match };
  const declaredStronger = normalizeString(novelty) === "stronger_reformulation";
  const comparisonIsPlanned = Boolean(normalizeString(plannedComparison)) &&
    findBestPlannedSimilarity(plannedComparison, plannedText).exact;
  const explainsDifference = normalizeString(differenceFromPlan).length >= 20;
  const referenceAppearsInPlan = Boolean(normalizeString(reference)) &&
    normalizeForEvidence(plannedText).includes(normalizeForEvidence(reference));
  if (referenceAppearsInPlan && !(comparisonIsPlanned && explainsDifference)) {
    return { eligible: false, classification: "retained_reference_development", ...match };
  }
  if (match.similarity >= 0.6) {
    return declaredStronger && comparisonIsPlanned && explainsDifference
      ? { eligible: true, classification: "stronger_reformulation", ...match }
      : { eligible: false, classification: "retained_near_match", ...match };
  }
  if (declaredStronger && !(comparisonIsPlanned && explainsDifference)) {
    return { eligible: false, classification: "unproven_stronger_reformulation", ...match };
  }
  return {
    eligible: true,
    classification: normalizeString(novelty) === "stronger_reformulation"
      ? "stronger_reformulation"
      : "new_live_development",
    ...match
  };
}

function truncateContext(value, maximum = MAX_CONTEXT_CHARS) {
  const text = normalizeString(value);
  if (text.length <= maximum) return { text, truncated: false, originalChars: text.length };
  return {
    text: `${text.slice(0, maximum)}\n\n[Context truncated at ${maximum} characters.]`,
    truncated: true,
    originalChars: text.length
  };
}

function normalizeComparisonItems(value, maximum = 12) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (typeof item === "string") return { observation: normalizeString(item), evidence: "" };
    const object = normalizeObject(item);
    return {
      observation: normalizeString(object.observation || object.summary || object.content),
      evidence: normalizeString(object.evidence || object.evidenceQuote)
    };
  }).filter((item) => item.observation).slice(0, maximum);
}

function normalizeProfileCandidates(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    const object = normalizeObject(item);
    const confidence = normalizeString(object.confidence);
    return {
      category: normalizeString(object.category) || "general",
      observation: normalizeString(object.observation || object.content),
      confidence: PROFILE_CONFIDENCE_LEVELS.has(confidence) ? confidence : "observed_once",
      evidence: normalizeString(object.evidence)
    };
  }).filter((item) => item.observation).slice(0, 12);
}

function assessTranscriptFidelity(source = {}) {
  const material = normalizeString(source.material);
  const summaryMarkerCount = [
    /\bthe (?:message|sermon) (?:begins|opens|develops|explains|applies|closes|returns|emphasizes)\b/gi,
    /\bthe preacher (?:explains|argues|applies|emphasizes|illustrates|concludes|confesses)\b/gi,
    /\bthe (?:opening|closing|transcript) (?:moves|widens|shows|includes|ends)\b/gi
  ].reduce((total, pattern) => total + (material.match(pattern) || []).length, 0);
  const summaryHeader = /^(?:cleaned\s+)?preached\s+(?:transcript|sermon)\s+(?:summary|notes)\b/i.test(material) ||
    /^cleaned preached transcript\b/i.test(material) && summaryMarkerCount >= 2;
  const summaryLike = summaryHeader || summaryMarkerCount >= 4;
  return {
    fidelity: summaryLike ? "summary" : "verbatim_or_cleaned_verbatim",
    exactLanguageEligible: !summaryLike,
    summaryMarkerCount
  };
}

function normalizeReflection(value, transcriptText = "", options = {}) {
  const reflection = normalizeObject(value);
  let filteredLiveLanguageCount = 0;
  let filteredScriptureNoteCount = 0;
  let strongestLiveLanguage = (Array.isArray(reflection.strongestLiveLanguage)
    ? reflection.strongestLiveLanguage
    : []).map((item) => {
    const object = normalizeObject(item);
    const normalized = {
      text: normalizeString(object.text || object.quote),
      context: normalizeString(object.context),
      reason: normalizeString(object.reason),
      novelty: normalizeString(object.novelty) || "new_live_wording",
      plannedComparison: normalizeString(object.plannedComparison),
      differenceFromPlan: normalizeString(object.differenceFromPlan)
    };
    return {
      ...normalized,
      noveltyAssessment: assessPreservationNovelty({
        text: normalized.text,
        plannedText: options.plannedText,
        novelty: normalized.novelty,
        plannedComparison: normalized.plannedComparison,
        differenceFromPlan: normalized.differenceFromPlan
      })
    };
  }).filter((item) => {
    const eligible = options.allowExactLanguage !== false && item.text &&
      isTranscriptEvidence(item.text, transcriptText) && item.noveltyAssessment.eligible;
    if (!eligible) filteredLiveLanguageCount += 1;
    return eligible;
  }).slice(0, 12);
  const scriptureNoteCandidates = (Array.isArray(reflection.scriptureNoteCandidates)
    ? reflection.scriptureNoteCandidates
    : []).map((item) => {
    const object = normalizeObject(item);
    const confidence = Math.min(Math.max(Number(object.confidence) || 0, 0), 1);
    const content = normalizeString(object.content || object.note);
    const evidenceQuote = normalizeString(object.evidenceQuote);
    const requestedAuthorship = normalizeString(object.authorship) || "dan_developed";
    const novelty = normalizeString(object.novelty) || "new_live_development";
    const plannedComparison = normalizeString(object.plannedComparison);
    const differenceFromPlan = normalizeString(object.differenceFromPlan);
    const reference = normalizeString(object.reference);
    const evidenceNovelty = assessPreservationNovelty({
      text: evidenceQuote,
      plannedText: options.plannedText,
      novelty,
      plannedComparison,
      differenceFromPlan,
      reference
    });
    const contentNovelty = assessPreservationNovelty({
      text: content,
      plannedText: options.plannedText,
      novelty,
      plannedComparison,
      differenceFromPlan,
      reference
    });
    return {
      reference,
      content,
      noteType: normalizeString(object.noteType) || "observation",
      authorship: options.summarySource === true
        ? "ai_synthesis"
        : requestedAuthorship === "dan_verbatim" && normalizeForEvidence(content) !== normalizeForEvidence(evidenceQuote)
          ? "dan_developed"
          : requestedAuthorship,
      confidence,
      evidenceQuote,
      reason: normalizeString(object.reason),
      novelty,
      plannedComparison,
      differenceFromPlan,
      noveltyAssessment: evidenceNovelty.eligible && contentNovelty.eligible
        ? evidenceNovelty
        : { ...evidenceNovelty, eligible: false, classification: contentNovelty.classification }
    };
  }).filter((item) => {
    const eligible = item.reference && item.content && item.evidenceQuote &&
      isTranscriptEvidence(item.evidenceQuote, transcriptText) && item.noveltyAssessment.eligible;
    if (!eligible) filteredScriptureNoteCount += 1;
    return eligible;
  }).slice(0, 20);
  const scriptureEvidence = new Set(scriptureNoteCandidates.map((item) => normalizeForEvidence(item.evidenceQuote)));
  strongestLiveLanguage = strongestLiveLanguage.filter((item) => {
    const duplicatedAsCommentary = scriptureEvidence.has(normalizeForEvidence(item.text));
    if (duplicatedAsCommentary) filteredLiveLanguageCount += 1;
    return !duplicatedAsCommentary;
  });
  const retainedCore = normalizeComparisonItems(reflection.retainedCore);
  const rawLiveDevelopments = normalizeComparisonItems(reflection.liveDevelopments);
  const liveDevelopments = [];
  let reclassifiedRetainedCount = 0;
  for (const item of rawLiveDevelopments) {
    const assessment = assessPreservationNovelty({
      text: item.evidence || item.observation,
      plannedText: options.plannedText,
      novelty: "new_live_development"
    });
    if (assessment.eligible) {
      liveDevelopments.push(item);
    } else {
      retainedCore.push(item);
      reclassifiedRetainedCount += 1;
    }
  }

  return {
    summary: normalizeString(reflection.summary),
    retainedCore: retainedCore.slice(0, 20),
    liveDevelopments: liveDevelopments.slice(0, 12),
    plannedMaterialNotPreached: normalizeComparisonItems(reflection.plannedMaterialNotPreached),
    changedEmphasis: normalizeComparisonItems(reflection.changedEmphasis),
    strengths: normalizeStringArray(reflection.strengths),
    growthEdges: normalizeStringArray(reflection.growthEdges),
    styleObservations: normalizeStringArray(reflection.styleObservations),
    structureNotes: normalizeStringArray(reflection.structureNotes),
    applicationNotes: normalizeStringArray(reflection.applicationNotes),
    deliveryNotes: normalizeStringArray(reflection.deliveryNotes),
    strongestLiveLanguage,
    scriptureNoteCandidates,
    profileCandidates: normalizeProfileCandidates(reflection.profileCandidates),
    recommendedNextActions: normalizeStringArray(reflection.recommendedNextActions, 10),
    noveltyReview: {
      reclassifiedRetainedCount,
      filteredLiveLanguageCount,
      filteredScriptureNoteCount
    }
  };
}

function buildProposalId({ sermonId, sourceFingerprint, reflection }) {
  const { noveltyReview: _noveltyReview, ...reviewedReflection } = normalizeObject(reflection);
  return `sermon-reflection-${hashValue({ sermonId, sourceFingerprint, reflection: reviewedReflection }).slice(0, 24)}`;
}

async function loadSermonSources(sermonId, deps) {
  const listed = await sermonWorkspace.listSermonSources({ sermonId, limit: 100 }, deps);
  return Promise.all(listed.sources.map(async (source) =>
    (await sermonWorkspace.getSermonSource({ sourceId: source.sourceId }, deps)).source));
}

function selectSource(sources, explicitSourceId, priorities, role = "") {
  if (explicitSourceId) return sources.find((source) => source.sourceId === explicitSourceId) || null;
  return sources
    .filter((source) => priorities.has(source.sourceType))
    .sort((left, right) => {
      const leftRole = role && (left.sourceRefs || []).some((ref) => ref.role === role) ? -1 : 0;
      const rightRole = role && (right.sourceRefs || []).some((ref) => ref.role === role) ? -1 : 0;
      return leftRole - rightRole ||
        priorities.get(left.sourceType) - priorities.get(right.sourceType) ||
        normalizeString(right.updatedAt || right.createdAt).localeCompare(normalizeString(left.updatedAt || left.createdAt));
    })[0] || null;
}

function buildCanonicalPlanText(sermon, checkpoints) {
  const placed = checkpoints.filter((checkpoint) => checkpoint.materialStatus === "placed");
  return [
    sermon.scriptureText ? `Primary passage: ${sermon.scriptureText}` : "",
    sermon.bigIdea ? `Big idea: ${sermon.bigIdea}` : "",
    sermon.outline ? `Outline:\n${sermon.outline}` : "",
    sermon.notes ? `Notes:\n${sermon.notes}` : "",
    ...placed.map((checkpoint) => [
      `Placed ${checkpoint.checkpointType || "material"}: ${checkpoint.heading || ""}`,
      checkpoint.placementTarget ? `Target: ${checkpoint.placementTarget}` : "",
      checkpoint.content
    ].filter(Boolean).join("\n"))
  ].filter(Boolean).join("\n\n");
}

async function resolveReflectionInputs(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  if (!sermonId) throw createReflectionError("sermonId is required", 400, "sermon_id_required");
  const sermon = (await sermonWorkspace.getSermon({ sermonId }, deps)).sermon;
  const [sources, checkpointResult, profileResult, existingAnalyses] = await Promise.all([
    loadSermonSources(sermonId, deps),
    sermonWorkspace.listSermonDevelopmentCheckpoints({ sermonId, limit: 500, sort: "asc" }, deps),
    sermonWorkspace.getPreachingProfile({ profileId: input.profileId }, deps),
    sermonWorkspace.listPreachingAnalyses({ sermonId, limit: 25 }, deps)
  ]);
  const transcriptSourceId = normalizeString(input.transcriptSourceId);
  const manuscriptSourceId = normalizeString(input.manuscriptSourceId);
  const transcriptSource = selectSource(sources, transcriptSourceId, TRANSCRIPT_SOURCE_PRIORITY);
  if (transcriptSourceId && !transcriptSource) {
    throw createReflectionError("The selected transcript source does not belong to this sermon", 409,
      "post_preaching_transcript_source_mismatch", { sermonId, transcriptSourceId });
  }
  const primaryManuscript = manuscriptSourceId
    ? selectSource(sources, manuscriptSourceId, PLANNED_SOURCE_PRIORITY)
    : sources.find((source) => source.sourceId === sermon.primaryManuscriptSourceId) ||
      selectSource(sources, "", PLANNED_SOURCE_PRIORITY, "manuscript_draft");
  if (manuscriptSourceId && !primaryManuscript) {
    throw createReflectionError("The selected planned manuscript source does not belong to this sermon", 409,
      "post_preaching_manuscript_source_mismatch", { sermonId, manuscriptSourceId });
  }
  const canonicalPlanText = buildCanonicalPlanText(sermon, checkpointResult.checkpoints);
  const plannedText = [
    canonicalPlanText,
    primaryManuscript?.material ? `Accepted manuscript:\n${primaryManuscript.material}` : ""
  ].filter(Boolean).join("\n\n---\n\n");
  const transcriptText = normalizeString(transcriptSource?.material);
  const transcriptFidelity = assessTranscriptFidelity(transcriptSource);
  const materialFingerprint = sermonWorkspace.buildSermonMaterialFingerprint(checkpointResult.checkpoints);
  const sourceFingerprint = hashValue({
    sermonId,
    sermonUpdatedAt: sermon.updatedAt || "",
    materialFingerprint,
    manuscriptSourceId: primaryManuscript?.sourceId || "",
    manuscriptHash: hashValue(primaryManuscript?.material || ""),
    transcriptSourceId: transcriptSource?.sourceId || "",
    transcriptHash: hashValue(transcriptText)
  });
  const blockers = [];
  if (!transcriptSource || !transcriptText) blockers.push({
    code: "preached_transcript_required",
    message: "A cleaned or preached transcript is required before post-sermon reflection.",
    nextAction: "Complete sermon transcription and save the transcript source."
  });
  if (!plannedText) blockers.push({
    code: "planned_baseline_required",
    message: "No manuscript, outline, notes, or placed development material is available for comparison.",
    nextAction: "Attach the planned manuscript or restore the sermon outline and notes."
  });
  return {
    sermon,
    sources,
    checkpoints: checkpointResult.checkpoints,
    profile: profileResult.profile,
    existingAnalyses: existingAnalyses.analyses,
    manuscriptSource: primaryManuscript,
    transcriptSource,
    plannedText,
    transcriptText,
    transcriptFidelity,
    materialFingerprint,
    sourceFingerprint,
    blockers
  };
}

function buildSourceSummary(resolved) {
  return {
    sourceFingerprint: resolved.sourceFingerprint,
    materialFingerprint: resolved.materialFingerprint,
    plannedBaseline: {
      method: resolved.manuscriptSource ? "accepted_manuscript_plus_canonical_plan" : "canonical_plan",
      manuscriptSourceId: resolved.manuscriptSource?.sourceId || "",
      manuscriptLabel: resolved.manuscriptSource?.sourceLabel || "",
      characterCount: resolved.plannedText.length
    },
    preachedTranscript: {
      transcriptSourceId: resolved.transcriptSource?.sourceId || "",
      transcriptLabel: resolved.transcriptSource?.sourceLabel || "",
      sourceType: resolved.transcriptSource?.sourceType || "",
      characterCount: resolved.transcriptText.length,
      fidelity: resolved.transcriptFidelity.fidelity,
      exactLanguageEligible: resolved.transcriptFidelity.exactLanguageEligible
    }
  };
}

async function getSermonPostPreachingReflectionReadiness(input = {}, deps = {}) {
  const resolved = await resolveReflectionInputs(input, deps);
  return {
    status: resolved.blockers.length ? "not_ready" : "ready",
    sermon: resolved.sermon,
    sources: buildSourceSummary(resolved),
    blockerCount: resolved.blockers.length,
    blockers: resolved.blockers,
    existingAnalysisCount: resolved.existingAnalyses.length,
    nextOperation: resolved.blockers.length ? "" : "proposeSermonPostPreachingReflection"
  };
}

async function proposeSermonPostPreachingReflection(input = {}, deps = {}) {
  const resolved = await resolveReflectionInputs(input, deps);
  if (resolved.blockers.length) {
    return {
      status: "not_ready",
      sermon: resolved.sermon,
      sources: buildSourceSummary(resolved),
      blockers: resolved.blockers,
      proposal: null
    };
  }
  if (typeof deps.generatePostPreachingReflection !== "function") {
    throw createReflectionError("Post-sermon reflection provider is not configured", 500,
      "post_preaching_reflection_provider_not_configured");
  }
  const planned = truncateContext(resolved.plannedText);
  const preached = truncateContext(resolved.transcriptText);
  const generated = await deps.generatePostPreachingReflection({
    sermon: resolved.sermon,
    plannedText: planned.text,
    transcriptText: preached.text,
    preachingProfile: resolved.profile,
    transcriptFidelity: resolved.transcriptFidelity
  });
  const reflection = normalizeReflection(generated, resolved.transcriptText, {
    allowExactLanguage: resolved.transcriptFidelity.exactLanguageEligible,
    summarySource: !resolved.transcriptFidelity.exactLanguageEligible,
    plannedText: resolved.plannedText
  });
  if (!reflection.summary) {
    throw createReflectionError("Post-sermon reflection returned no usable summary", 502,
      "post_preaching_reflection_empty");
  }
  const proposalId = buildProposalId({
    sermonId: resolved.sermon.sermonId,
    sourceFingerprint: resolved.sourceFingerprint,
    reflection
  });
  const warnings = normalizeStringArray(generated?.warnings, 10);
  if (planned.truncated) warnings.push(`Planned context was capped at ${MAX_CONTEXT_CHARS} characters.`);
  if (preached.truncated) warnings.push(`Transcript context was capped at ${MAX_CONTEXT_CHARS} characters.`);
  if (!resolved.manuscriptSource) warnings.push("No accepted manuscript was available; comparison used canonical fields and placed checkpoints.");
  if (!resolved.transcriptFidelity.exactLanguageEligible) {
    warnings.push("The selected transcript is summary-like; exact live-language checkpoint saving is disabled and commentary authorship is labeled AI synthesis.");
  }
  const filteredPreservationCount = reflection.noveltyReview.filteredLiveLanguageCount +
    reflection.noveltyReview.filteredScriptureNoteCount +
    reflection.noveltyReview.reclassifiedRetainedCount;
  if (filteredPreservationCount > 0) {
    warnings.push(`The novelty gate reclassified or removed ${filteredPreservationCount} item${filteredPreservationCount === 1 ? "" : "s"} already represented in the planned baseline.`);
  }
  return {
    status: "proposed",
    sermon: resolved.sermon,
    sources: buildSourceSummary(resolved),
    proposal: {
      proposalId,
      sermonId: resolved.sermon.sermonId,
      sourceFingerprint: resolved.sourceFingerprint,
      manuscriptSourceId: resolved.manuscriptSource?.sourceId || "",
      transcriptSourceId: resolved.transcriptSource.sourceId,
      reflection,
      warnings
    },
    applyInstructions: {
      operation: "applySermonPostPreachingReflection",
      confirmationRequired: true,
      arguments: {
        sermonId: resolved.sermon.sermonId,
        proposalId,
        sourceFingerprint: resolved.sourceFingerprint,
        manuscriptSourceId: resolved.manuscriptSource?.sourceId || "",
        transcriptSourceId: resolved.transcriptSource.sourceId,
        reflection,
        confirmed: true,
        saveLiveLanguage: true,
        saveScriptureNotes: true,
        applyProfileCandidates: false
      }
    }
  };
}

async function applySermonPostPreachingReflection(input = {}, deps = {}) {
  if (input.confirmed !== true) {
    throw createReflectionError("Explicit confirmation is required to apply a post-sermon reflection", 400,
      "post_preaching_reflection_confirmation_required");
  }
  const resolved = await resolveReflectionInputs(input, deps);
  if (resolved.blockers.length) {
    throw createReflectionError("Post-sermon reflection prerequisites are no longer satisfied", 409,
      "post_preaching_reflection_not_ready", { blockers: resolved.blockers });
  }
  const sourceFingerprint = normalizeString(input.sourceFingerprint);
  if (!sourceFingerprint || sourceFingerprint !== resolved.sourceFingerprint) {
    throw createReflectionError("The manuscript, sermon plan, or transcript changed after this reflection was proposed", 409,
      "stale_post_preaching_reflection", {
        expectedSourceFingerprint: sourceFingerprint,
        currentSourceFingerprint: resolved.sourceFingerprint,
        nextAction: "Generate a new post-sermon reflection proposal."
      });
  }
  const reflection = normalizeReflection(input.reflection, resolved.transcriptText, {
    allowExactLanguage: resolved.transcriptFidelity.exactLanguageEligible,
    summarySource: !resolved.transcriptFidelity.exactLanguageEligible,
    plannedText: resolved.plannedText
  });
  const proposalId = normalizeString(input.proposalId);
  const expectedProposalId = buildProposalId({
    sermonId: resolved.sermon.sermonId,
    sourceFingerprint,
    reflection
  });
  if (!proposalId || proposalId !== expectedProposalId) {
    throw createReflectionError("The reflection proposal does not match its reviewed content", 409,
      "post_preaching_reflection_proposal_mismatch", { proposalId });
  }

  const sourceRefs = [
    ...(resolved.manuscriptSource ? [{
      type: "sermon_source",
      role: "planned_manuscript",
      sourceId: resolved.manuscriptSource.sourceId
    }] : []),
    {
      type: "sermon_source",
      role: "preached_transcript",
      sourceId: resolved.transcriptSource.sourceId
    }
  ];
  const analysisResult = await sermonWorkspace.createPreachingAnalysis({
    sermonId: resolved.sermon.sermonId,
    title: `Post-sermon reflection - ${resolved.sermon.title}`,
    sourceLabel: resolved.transcriptSource.sourceLabel,
    summary: reflection.summary,
    strengths: reflection.strengths,
    improvements: reflection.growthEdges,
    styleObservations: reflection.styleObservations,
    structureNotes: reflection.structureNotes,
    applicationNotes: reflection.applicationNotes,
    deliveryNotes: reflection.deliveryNotes,
    profileCandidates: reflection.profileCandidates,
    applyProfileCandidates: input.applyProfileCandidates === true,
    sourceRefs,
    reflectionProposalId: proposalId,
    reflectionSourceFingerprint: sourceFingerprint,
    plannedVsPreached: {
      retainedCore: reflection.retainedCore,
      liveDevelopments: reflection.liveDevelopments,
      plannedMaterialNotPreached: reflection.plannedMaterialNotPreached,
      changedEmphasis: reflection.changedEmphasis
    },
    strongestLiveLanguage: reflection.strongestLiveLanguage,
    scriptureNoteCandidates: reflection.scriptureNoteCandidates,
    recommendedNextActions: reflection.recommendedNextActions
  }, deps);

  let liveLanguage = { count: 0, checkpoints: [] };
  if (input.saveLiveLanguage !== false && reflection.strongestLiveLanguage.length) {
    liveLanguage = await sermonWorkspace.saveSermonDevelopmentCheckpoint({
      sermonId: resolved.sermon.sermonId,
      checkpoints: reflection.strongestLiveLanguage.map((item) => ({
        checkpointType: "verbatim",
        heading: "Strong live preaching language",
        content: item.text,
        context: item.context || item.reason,
        exactWording: true,
        materialStatus: "unplaced",
        sourceRefs: [
          ...sourceRefs,
          { type: "preaching_analysis", analysisId: analysisResult.analysis.analysisId, proposalId }
        ]
      }))
    }, deps);
  }

  let scriptureNotes = { action: "skipped", createdNoteCount: 0, duplicateCount: 0 };
  if (input.saveScriptureNotes !== false && reflection.scriptureNoteCandidates.length) {
    if (typeof deps.saveReviewedPostPreachingScriptureNotes !== "function") {
      throw createReflectionError("Reviewed Scripture-note saving is not configured", 500,
        "post_preaching_scripture_note_saver_not_configured");
    }
    scriptureNotes = await deps.saveReviewedPostPreachingScriptureNotes({
      sermonId: resolved.sermon.sermonId,
      analysisId: analysisResult.analysis.analysisId,
      transcriptSourceId: resolved.transcriptSource.sourceId,
      proposalId,
      sourceLabel: `Post-sermon reflection: ${resolved.sermon.title}`,
      candidates: reflection.scriptureNoteCandidates
    }, deps);
  }

  const rebuild = input.rebuildChunks === false
    ? null
    : await sermonWorkspace.rebuildSermonChunks({ sermonId: resolved.sermon.sermonId }, deps);
  return {
    status: "applied",
    sermonId: resolved.sermon.sermonId,
    proposalId,
    sourceFingerprint,
    analysis: analysisResult.analysis,
    profileUpdated: analysisResult.profileUpdated,
    profile: analysisResult.profile || null,
    liveLanguage: {
      savedCount: liveLanguage.count,
      checkpointIds: liveLanguage.checkpoints.map((checkpoint) => checkpoint.checkpointId)
    },
    scriptureNotes,
    chunksRebuilt: Boolean(rebuild),
    chunkCount: rebuild?.chunkCount || 0
  };
}

module.exports = {
  assessTranscriptFidelity,
  applySermonPostPreachingReflection,
  buildProposalId,
  getSermonPostPreachingReflectionReadiness,
  normalizeReflection,
  proposeSermonPostPreachingReflection,
  resolveReflectionInputs
};
