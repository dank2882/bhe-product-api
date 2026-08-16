"use strict";

const { createHash } = require("node:crypto");
const sermonWorkspace = require("./sermon-workspace-service");

const TRANSCRIPT_TYPES = [
  "cleaned_transcript",
  "preached_transcript",
  "transcript",
  "youtube_caption",
  "vimeo_transcript"
];
const TRANSCRIPT_PRIORITY = new Map(TRANSCRIPT_TYPES.map((type, index) => [type, index]));
const PROFILE_CONFIDENCE = new Set(["observed_once", "recurring", "established"]);
const DEFAULT_CORPUS_SIZE = 12;
const MAX_CORPUS_SIZE = 16;
const MAX_TRANSCRIPT_CHARS = 50000;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value, maximum = 30) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeString)
    .filter(Boolean)
    .slice(0, maximum);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hashValue(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

function createProfileError(message, statusCode = 400, code = "preaching_profile_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function inferPreachedDate(sermon = {}, source = {}) {
  const occasions = Array.isArray(sermon.preachingOccasions)
    ? sermon.preachingOccasions
    : Array.isArray(sermon.occasions)
      ? sermon.occasions
      : [];
  const occasionDate = occasions
    .filter((occasion) => normalizeString(occasion.status) === "preached")
    .map((occasion) => normalizeString(occasion.date))
    .filter(Boolean)
    .sort()
    .at(-1);
  const explicit = normalizeString(sermon.preachedDate || occasionDate || sermon.targetDate);
  if (explicit) return explicit.slice(0, 10);
  const label = normalizeString(source.sourceLabel);
  const isoMatch = label.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const yearMatch = label.match(/\b(20\d{2})\b/);
  return yearMatch ? `${yearMatch[1]}-01-01` : "";
}

function inferPreachingContext(sermon = {}, source = {}) {
  const text = [
    sermon.title,
    sermon.occasion,
    ...(Array.isArray(sermon.preachingOccasions || sermon.occasions)
      ? (sermon.preachingOccasions || sermon.occasions)
        .flatMap((occasion) => [occasion.service, occasion.venue, occasion.notes])
      : []),
    source.sourceLabel
  ].map(normalizeString).join(" ").toLowerCase();
  if (/memorial|funeral|celebration of life/.test(text)) return "memorial";
  if (/family foundations|sunday school|class|lesson/.test(text)) return "class_or_teaching";
  if (/missions?|philippines|baguio|travel|translator/.test(text)) return "missions_or_translated";
  if (/wednesday|midweek|prayer service/.test(text)) return "midweek";
  if (/sunday night|evening service/.test(text)) return "sunday_evening";
  if (/sunday morning|11:00|morning service/.test(text)) return "sunday_morning";
  return "general_preaching";
}

function assessSourceFidelity(source = {}) {
  const label = normalizeString(source.sourceLabel).toLowerCase();
  if (/translator|spillover|partial|continuation|raw/.test(label)) return "lower";
  if (source.sourceType === "cleaned_transcript" || /canonical complete|complete transcript|master/.test(label)) {
    return "high";
  }
  if (source.sourceType === "youtube_caption" || source.sourceType === "vimeo_transcript") return "medium";
  return "medium_high";
}

function summarizeCorpusItem({ sermon, source, currentYear }) {
  const preachedDate = inferPreachedDate(sermon, source);
  const preachedYear = Number(preachedDate.slice(0, 4)) || 0;
  return {
    sermonId: sermon.sermonId,
    title: sermon.title,
    scriptureText: sermon.scriptureText || "",
    preachedDate,
    cohort: preachedYear && preachedYear < currentYear - 2 ? "historical_comparison" : "current_baseline",
    context: inferPreachingContext(sermon, source),
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceLabel: source.sourceLabel,
    sourceUpdatedAt: source.updatedAt || source.createdAt || "",
    fidelity: assessSourceFidelity(source)
  };
}

function chooseRepresentativeCorpus(items, limit) {
  const eligible = items.filter((item) => item.fidelity !== "lower");
  const current = eligible.filter((item) => item.cohort === "current_baseline");
  const historical = eligible.filter((item) => item.cohort === "historical_comparison");
  const compare = (left, right) =>
    normalizeString(right.preachedDate).localeCompare(normalizeString(left.preachedDate)) ||
    TRANSCRIPT_PRIORITY.get(left.sourceType) - TRANSCRIPT_PRIORITY.get(right.sourceType) ||
    normalizeString(right.sourceUpdatedAt).localeCompare(normalizeString(left.sourceUpdatedAt));
  current.sort(compare);
  historical.sort(compare);
  const selected = [];
  const selectedIds = new Set();
  const add = (item) => {
    if (!item || selectedIds.has(item.sermonId) || selected.length >= limit) return;
    selected.push(item);
    selectedIds.add(item.sermonId);
  };
  const currentContexts = new Set(current.map((item) => item.context));
  for (const context of currentContexts) add(current.find((item) => item.context === context));
  const historicalSlots = historical.length ? Math.min(2, Math.max(limit - selected.length, 0)) : 0;
  const currentTarget = Math.max(limit - historicalSlots, 0);
  for (const item of current) {
    if (selected.length >= currentTarget) break;
    add(item);
  }
  for (const item of historical) add(item);
  for (const item of current) add(item);
  return selected.slice(0, limit);
}

async function loadCorpusCandidates(input = {}, deps = {}) {
  const currentYear = Number(normalizeString(input.asOfDate).slice(0, 4)) ||
    Number(normalizeString(typeof deps.now === "function" ? deps.now() : new Date().toISOString()).slice(0, 4));
  const sourceLists = await Promise.all(TRANSCRIPT_TYPES.map((sourceType) =>
    sermonWorkspace.listSermonSources({ sourceType, limit: 100 }, deps)));
  const bestSourceBySermon = new Map();
  for (const source of sourceLists.flatMap((result) => result.sources || [])) {
    if (!source.sermonId) continue;
    const current = bestSourceBySermon.get(source.sermonId);
    const sourcePriority = TRANSCRIPT_PRIORITY.get(source.sourceType) ?? 99;
    const currentPriority = TRANSCRIPT_PRIORITY.get(current?.sourceType) ?? 99;
    const fidelityPriority = { high: 0, medium_high: 1, medium: 2, lower: 3 };
    const sourceFidelity = fidelityPriority[assessSourceFidelity(source)] ?? 99;
    const currentFidelity = fidelityPriority[assessSourceFidelity(current)] ?? 99;
    if (!current || sourceFidelity < currentFidelity ||
      (sourceFidelity === currentFidelity && sourcePriority < currentPriority) ||
      (sourceFidelity === currentFidelity && sourcePriority === currentPriority &&
        normalizeString(source.updatedAt || source.createdAt) > normalizeString(current.updatedAt || current.createdAt))) {
      bestSourceBySermon.set(source.sermonId, source);
    }
  }
  const records = await Promise.all([...bestSourceBySermon.values()].map(async (source) => {
    const sermon = (await sermonWorkspace.getSermon({ sermonId: source.sermonId }, deps)).sermon;
    return summarizeCorpusItem({ sermon, source, currentYear });
  }));
  return records;
}

async function getPreachingProfileBaselineReadiness(input = {}, deps = {}) {
  const profile = (await sermonWorkspace.getPreachingProfile({ profileId: input.profileId }, deps)).profile;
  const candidates = await loadCorpusCandidates(input, deps);
  const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_CORPUS_SIZE, 6), MAX_CORPUS_SIZE);
  const selectedCorpus = chooseRepresentativeCorpus(candidates, limit);
  const analyzed = await sermonWorkspace.listPreachingAnalyses({ limit: 100 }, deps);
  const reviewedSermonIds = new Set([
    ...normalizeStringArray(profile.evidenceCorpus?.currentSermonIds, 100),
    ...normalizeStringArray(profile.evidenceCorpus?.historicalSermonIds, 100)
  ]);
  const analyzedSermonIds = [...new Set((analyzed.analyses || []).map((item) => item.sermonId).filter(Boolean))];
  const newAnalyzedSermonIds = analyzedSermonIds.filter((sermonId) => !reviewedSermonIds.has(sermonId));
  const currentCount = selectedCorpus.filter((item) => item.cohort === "current_baseline").length;
  const historicalCount = selectedCorpus.filter((item) => item.cohort === "historical_comparison").length;
  const cadence = profile.reviewCadenceSermons || 5;
  return {
    status: selectedCorpus.length >= 6 ? "ready" : "not_ready",
    profile: {
      profileId: profile.profileId,
      version: profile.version,
      fingerprint: profile.fingerprint,
      updatedAt: profile.updatedAt,
      baselineApprovedAt: profile.baselineApprovedAt
    },
    selectedCorpus,
    counts: {
      candidateSermons: candidates.length,
      selectedSermons: selectedCorpus.length,
      currentBaselineSermons: currentCount,
      historicalComparisonSermons: historicalCount,
      lowerFidelityExcluded: candidates.filter((item) => item.fidelity === "lower").length,
      analyzedSermons: analyzedSermonIds.length,
      newAnalyzedSermons: newAnalyzedSermonIds.length
    },
    reviewCadence: {
      sermons: cadence,
      newAnalyzedSermonIds,
      due: newAnalyzedSermonIds.length >= cadence
    },
    blockers: selectedCorpus.length >= 6
      ? []
      : ["At least six distinct usable sermon transcripts are required for a defensible baseline."],
    nextOperation: selectedCorpus.length >= 6 ? "proposePreachingProfileBaseline" : ""
  };
}

function normalizeEvidence(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      sermonId: normalizeString(item.sermonId),
      sourceId: normalizeString(item.sourceId),
      quote: normalizeString(item.quote || item.evidence),
      note: normalizeString(item.note)
    }))
    .filter((item) => item.sermonId && (item.quote || item.note))
    .slice(0, 12);
}

function normalizeProposalEvidence(value) {
  return (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .map((item) => {
      if (typeof item === "string") return normalizeString(item);
      const evidence = normalizeEvidence([item])[0];
      return evidence
        ? [evidence.sermonId, evidence.quote || evidence.note].filter(Boolean).join(": ")
        : "";
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeProfileProposal(value = {}) {
  const profile = normalizeObject(value);
  return {
    summary: normalizeString(profile.summary),
    tone: normalizeStringArray(profile.tone, 12),
    strengths: normalizeStringArray(profile.strengths, 12),
    recurringPatterns: normalizeStringArray(profile.recurringPatterns, 16),
    cautions: normalizeStringArray(profile.cautions, 12),
    draftingGuidance: normalizeString(profile.draftingGuidance),
    avoidances: normalizeStringArray(profile.avoidances, 12),
    contextGuidance: (Array.isArray(profile.contextGuidance) ? profile.contextGuidance : [])
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        context: normalizeString(item.context),
        guidance: normalizeString(item.guidance),
        evidence: normalizeProposalEvidence(item.evidence)
      }))
      .filter((item) => item.context && item.guidance)
      .slice(0, 12),
    growthGoals: (Array.isArray(profile.growthGoals) ? profile.growthGoals : [])
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        dimension: normalizeString(item.dimension),
        currentPattern: normalizeString(item.currentPattern),
        nextGrowthTarget: normalizeString(item.nextGrowthTarget),
        confidence: PROFILE_CONFIDENCE.has(normalizeString(item.confidence))
          ? normalizeString(item.confidence)
          : "observed_once",
        evidence: normalizeProposalEvidence(item.evidence)
      }))
      .filter((item) => item.dimension && item.nextGrowthTarget)
      .slice(0, 12),
    observations: (Array.isArray(profile.observations) ? profile.observations : [])
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        category: normalizeString(item.category) || "general",
        observation: normalizeString(item.observation),
        confidence: PROFILE_CONFIDENCE.has(normalizeString(item.confidence))
          ? normalizeString(item.confidence)
          : "observed_once",
        evidence: normalizeProposalEvidence(item.evidence).join(" | ")
      }))
      .filter((item) => item.observation)
      .slice(0, 30)
  };
}

function buildSourceFingerprint(corpus) {
  return hashValue(corpus.map((item) => ({
    sermonId: item.sermonId,
    sourceId: item.sourceId,
    sourceUpdatedAt: item.sourceUpdatedAt,
    materialSha256: item.materialSha256
  })));
}

async function hydrateCorpus(selectedCorpus, deps) {
  return Promise.all(selectedCorpus.map(async (item) => {
    const source = (await sermonWorkspace.getSermonSource({ sourceId: item.sourceId }, deps)).source;
    const material = normalizeString(source.material);
    return {
      ...item,
      sourceUpdatedAt: source.updatedAt || source.createdAt || item.sourceUpdatedAt || "",
      materialSha256: hashValue(material),
      transcript: material.length > MAX_TRANSCRIPT_CHARS
        ? `${material.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript capped at ${MAX_TRANSCRIPT_CHARS} characters.]`
        : material,
      transcriptChars: material.length,
      truncated: material.length > MAX_TRANSCRIPT_CHARS
    };
  }));
}

async function proposePreachingProfileBaseline(input = {}, deps = {}) {
  const readiness = await getPreachingProfileBaselineReadiness(input, deps);
  if (readiness.status !== "ready") {
    return { ...readiness, proposal: null };
  }
  if (typeof deps.generatePreachingProfileBaseline !== "function") {
    throw createProfileError(
      "Preaching-profile baseline provider is not configured",
      500,
      "preaching_profile_baseline_provider_not_configured"
    );
  }
  const profile = (await sermonWorkspace.getPreachingProfile({ profileId: input.profileId }, deps)).profile;
  const analyses = await sermonWorkspace.listPreachingAnalyses({ limit: 100 }, deps);
  const hydratedCorpus = await hydrateCorpus(readiness.selectedCorpus, deps);
  const generated = await deps.generatePreachingProfileBaseline({
    currentProfile: profile,
    corpus: hydratedCorpus,
    analyses: analyses.analyses
  });
  const proposedProfile = normalizeProfileProposal(generated?.profile || generated);
  if (!proposedProfile.summary || proposedProfile.recurringPatterns.length === 0) {
    throw createProfileError(
      "Preaching-profile baseline returned no usable profile",
      502,
      "preaching_profile_baseline_empty"
    );
  }
  const sourceFingerprint = buildSourceFingerprint(hydratedCorpus);
  const evidenceCorpus = {
    asOfDate: normalizeString(input.asOfDate) ||
      normalizeString(typeof deps.now === "function" ? deps.now() : new Date().toISOString()).slice(0, 10),
    currentSermonIds: hydratedCorpus
      .filter((item) => item.cohort === "current_baseline")
      .map((item) => item.sermonId),
    historicalSermonIds: hydratedCorpus
      .filter((item) => item.cohort === "historical_comparison")
      .map((item) => item.sermonId),
    analysisIds: (analyses.analyses || []).map((analysis) => analysis.analysisId),
    transcriptSourceIds: hydratedCorpus.map((item) => item.sourceId),
    notes: "Recent sermons define the current voice; historical sermons are comparison evidence only."
  };
  const reviewedProfile = { ...proposedProfile, evidenceCorpus, reviewCadenceSermons: 5 };
  const proposalId = `preaching-profile-baseline-${hashValue({
    profileId: profile.profileId,
    expectedVersion: profile.version,
    sourceFingerprint,
    profile: reviewedProfile
  }).slice(0, 24)}`;
  const warnings = normalizeStringArray(generated?.warnings, 12);
  if (hydratedCorpus.some((item) => item.truncated)) {
    warnings.push("At least one transcript was capped for analysis; the full source remains unchanged in Sermon Workspace.");
  }
  warnings.push("Transcript evidence cannot establish audience response, gestures, vocal tone, or spiritual results.");
  return {
    status: "proposed",
    profile: readiness.profile,
    corpus: hydratedCorpus.map(({ transcript: _transcript, materialSha256, ...item }) => ({
      ...item,
      materialSha256
    })),
    proposal: {
      proposalId,
      profileId: profile.profileId,
      expectedVersion: profile.version,
      sourceFingerprint,
      profile: reviewedProfile,
      warnings
    },
    applyInstructions: {
      operation: "applyPreachingProfileBaseline",
      confirmationRequired: true,
      arguments: {
        proposalId,
        profileId: profile.profileId,
        expectedVersion: profile.version,
        sourceFingerprint,
        corpus: hydratedCorpus.map(({ transcript: _transcript, ...item }) => item),
        profile: reviewedProfile,
        confirmed: true
      }
    }
  };
}

async function applyPreachingProfileBaseline(input = {}, deps = {}) {
  if (input.confirmed !== true) {
    throw createProfileError(
      "Explicit confirmation is required to apply the preaching profile baseline",
      400,
      "preaching_profile_baseline_confirmation_required"
    );
  }
  const profileId = normalizeString(input.profileId) || "default";
  const current = (await sermonWorkspace.getPreachingProfile({ profileId }, deps)).profile;
  if (Number(input.expectedVersion) !== current.version) {
    throw createProfileError(
      "The preaching profile changed after this baseline was proposed",
      409,
      "stale_preaching_profile_baseline",
      { expectedVersion: Number(input.expectedVersion), currentVersion: current.version }
    );
  }
  const corpusInput = (Array.isArray(input.corpus) ? input.corpus : []).map((item) => ({
    ...normalizeObject(item),
    sermonId: normalizeString(item.sermonId),
    sourceId: normalizeString(item.sourceId)
  })).filter((item) => item.sermonId && item.sourceId);
  const hydratedCorpus = await hydrateCorpus(corpusInput, deps);
  const currentFingerprint = buildSourceFingerprint(hydratedCorpus);
  if (!input.sourceFingerprint || input.sourceFingerprint !== currentFingerprint) {
    throw createProfileError(
      "One or more transcript sources changed after this baseline was proposed",
      409,
      "stale_preaching_profile_corpus",
      { expectedSourceFingerprint: input.sourceFingerprint, currentSourceFingerprint: currentFingerprint }
    );
  }
  const profile = normalizeProfileProposal(input.profile);
  const evidenceCorpus = normalizeObject(input.profile?.evidenceCorpus);
  const reviewedProfile = {
    ...profile,
    evidenceCorpus,
    reviewCadenceSermons: Math.min(Math.max(Number(input.profile?.reviewCadenceSermons) || 5, 1), 25)
  };
  const expectedProposalId = `preaching-profile-baseline-${hashValue({
    profileId,
    expectedVersion: current.version,
    sourceFingerprint: currentFingerprint,
    profile: reviewedProfile
  }).slice(0, 24)}`;
  if (!input.proposalId || input.proposalId !== expectedProposalId) {
    throw createProfileError(
      "The preaching profile baseline does not match the reviewed proposal",
      409,
      "preaching_profile_baseline_proposal_mismatch"
    );
  }
  const approvedAt = normalizeString(typeof deps.now === "function" ? deps.now() : new Date().toISOString());
  const result = await sermonWorkspace.updatePreachingProfile({
    profileId,
    expectedVersion: current.version,
    changes: {
      ...reviewedProfile,
      replaceObservations: true,
      baselineApprovedAt: approvedAt
    }
  }, deps);
  return {
    profile: result.profile,
    appliedProposalId: input.proposalId,
    sourceFingerprint: currentFingerprint,
    corpusCounts: {
      current: normalizeStringArray(evidenceCorpus.currentSermonIds, 100).length,
      historical: normalizeStringArray(evidenceCorpus.historicalSermonIds, 100).length,
      transcripts: normalizeStringArray(evidenceCorpus.transcriptSourceIds, 100).length
    }
  };
}

module.exports = {
  applyPreachingProfileBaseline,
  getPreachingProfileBaselineReadiness,
  proposePreachingProfileBaseline
};
