"use strict";

const { randomUUID } = require("node:crypto");

const { commitOperatorDataChange } = require("./operator-data-service");
const { getServiceById } = require("./service-history-service");

function createMinistryPlanningError(message, statusCode = 400, code = "ministry_planning_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTitle(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/^\d+\s*[-.:)]\s*/, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getHymnalNumber(value) {
  const match = normalizeString(value).match(/^(\d{1,4})\s*[-.:)]/);
  return match ? Number(match[1]) : null;
}

function appendNote(existing, note) {
  const cleanExisting = normalizeString(existing);
  if (!cleanExisting) return note;
  if (cleanExisting.includes(note)) return cleanExisting;
  return `${cleanExisting}\n${note}`;
}

async function inspectMusicPlanningSpreadsheet(input = {}, deps = {}) {
  if (typeof deps.runMusicPlanningSpreadsheetRefresh !== "function") {
    throw createMinistryPlanningError(
      "Music planning spreadsheet refresh is not configured",
      500,
      "spreadsheet_refresh_not_configured"
    );
  }
  return deps.runMusicPlanningSpreadsheetRefresh({ ...input, mode: "plan-only" });
}

async function syncMusicPlanningSpreadsheet(input = {}, deps = {}) {
  const plan = await inspectMusicPlanningSpreadsheet(input, deps);
  if (!plan.sourceImportId) {
    throw createMinistryPlanningError("Spreadsheet plan did not produce a source import ID", 409, "missing_source_import_id");
  }
  if (plan.plan?.eligibleForCommit !== true) {
    throw createMinistryPlanningError(
      "Spreadsheet plan is not eligible for commit",
      409,
      "spreadsheet_plan_not_eligible",
      { sourceImportId: plan.sourceImportId, plan: plan.plan }
    );
  }

  const baseCommit = {
    ...input,
    mode: "commit",
    humanConfirmed: true,
    allowPlannedUpdates: true,
    allowPartialConflicts: true
  };
  let sourceImportId = plan.sourceImportId;
  let commit;

  try {
    commit = await deps.runMusicPlanningSpreadsheetRefresh({
      ...baseCommit,
      confirmSourceImportId: sourceImportId
    });
  } catch (error) {
    const currentSourceImportId = normalizeString(error?.details?.sourceImportId);
    if (!currentSourceImportId || currentSourceImportId === sourceImportId) throw error;
    sourceImportId = currentSourceImportId;
    commit = await deps.runMusicPlanningSpreadsheetRefresh({
      ...baseCommit,
      confirmSourceImportId: sourceImportId
    });
  }

  return {
    synced: commit.commitResult?.postCommitVerification?.ok === true,
    sourceImportId,
    planSummary: plan.summary?.plan || null,
    commitResult: commit.commitResult,
    warnings: commit.summary?.preview?.warnings || plan.summary?.preview?.warnings || null
  };
}

async function mutateMinistryData(input = {}, deps = {}) {
  const operation = normalizeString(input.operation).toLowerCase();
  const destructive = operation === "delete" || (operation === "set" && input.merge !== true);

  if (destructive && input.confirmed !== true) {
    throw createMinistryPlanningError(
      "Permanent delete and full-document replacement require explicit confirmation",
      400,
      "destructive_change_confirmation_required",
      { collection: input.collection, docId: input.docId, operation }
    );
  }

  const collection = normalizeString(input.collection);
  const docId = normalizeString(input.docId);
  const target = `${collection}/${docId || "new-document"}`;
  return commitOperatorDataChange(
    {
      ...input,
      humanConfirmed: true,
      confirmationSummary: destructive
        ? `Dan explicitly confirmed ${operation} for ${target}.`
        : `Authorized ministry dispatcher command: ${operation} ${target}.`,
      changedBy: normalizeString(input.changedBy) || "ministry-planning-dispatcher"
    },
    deps
  );
}

function chooseCatalogSong(serviceSong, catalogSongs) {
  const explicitId = normalizeString(serviceSong.songId);
  if (explicitId) {
    return catalogSongs.find((song) => song.songId === explicitId || song.docId === explicitId) || null;
  }

  const number = Number.isInteger(serviceSong.hymnalNumber)
    ? serviceSong.hymnalNumber
    : getHymnalNumber(serviceSong.title || serviceSong.songTitleCandidate);
  if (number !== null) {
    const byNumber = catalogSongs.filter((song) => Number(song.hymnalNumber) === number);
    if (byNumber.length === 1) return byNumber[0];
  }

  const title = normalizeTitle(serviceSong.title || serviceSong.songTitleCandidate);
  if (!title) return null;
  const byTitle = catalogSongs.filter((song) => {
    const titles = [song.canonicalTitle, ...(Array.isArray(song.titleAliases) ? song.titleAliases : [])];
    return titles.some((candidate) => normalizeTitle(candidate) === title);
  });
  return byTitle.length === 1 ? byTitle[0] : null;
}

async function recordServiceSongFeedback(input = {}, deps = {}) {
  const serviceId = normalizeString(input.serviceId);
  const feedback = normalizeString(input.feedback);
  const treatment = normalizeString(input.treatment || "soft_downweight").toLowerCase();

  if (!serviceId || !feedback) {
    throw createMinistryPlanningError(
      "serviceId and feedback are required",
      400,
      "missing_service_feedback_arguments"
    );
  }
  if (!["soft_downweight", "hard_block"].includes(treatment)) {
    throw createMinistryPlanningError(
      "Invalid service feedback treatment",
      400,
      "invalid_service_feedback_treatment",
      { allowedTreatments: ["soft_downweight", "hard_block"] }
    );
  }

  const { service } = await getServiceById({ serviceId }, deps);
  const catalogSnapshot = await deps.songsCollection.limit(5000).get();
  const catalogSongs = catalogSnapshot.docs.map((doc) => ({ docId: doc.id, ...(doc.data() || {}) }));
  const resolved = [];
  const unresolved = [];

  for (const serviceSong of service.songs || []) {
    if (!normalizeString(serviceSong.title || serviceSong.songTitleCandidate)) continue;
    const catalogSong = chooseCatalogSong(serviceSong, catalogSongs);
    if (catalogSong) resolved.push({ serviceSong, catalogSong });
    else unresolved.push(serviceSong);
  }

  const serviceLabel = `${service.serviceDate} ${service.serviceType.replace(/_/g, " ")}`;
  const note = `Dan noted the ${serviceLabel} service: ${feedback}`;
  const updated = [];

  for (const { serviceSong, catalogSong } of resolved) {
    const songId = normalizeString(catalogSong.songId || catalogSong.docId);
    const docRef = deps.songsCollection.doc(catalogSong.docId);
    const planning = catalogSong.ministryPlanning && typeof catalogSong.ministryPlanning === "object"
      ? catalogSong.ministryPlanning
      : {};
    const nextPlanning = {
      ...planning,
      notes: appendNote(planning.notes, note)
    };

    if (treatment === "hard_block") {
      nextPlanning.useStatus = "do_not_use";
    } else if (!["core", "solid_rotation"].includes(normalizeString(planning.rotationStrength))) {
      nextPlanning.rotationStrength = "rare";
    }

    const changedAtValue = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
    const changedAt = changedAtValue instanceof Date ? changedAtValue.toISOString() : String(changedAtValue);
    if (typeof docRef.update === "function") {
      await docRef.update({ ministryPlanning: nextPlanning, updatedAt: changedAt });
    } else {
      await docRef.set({ ...catalogSong, ministryPlanning: nextPlanning, updatedAt: changedAt });
    }

    if (deps.songMetadataAuditCollection?.doc) {
      const auditId = typeof deps.createAuditId === "function" ? deps.createAuditId() : randomUUID();
      await deps.songMetadataAuditCollection.doc(auditId).set({
        auditId,
        songId,
        category: "service_song_feedback",
        serviceId,
        treatment,
        feedback,
        previousValues: { ministryPlanning: planning },
        newValues: { ministryPlanning: nextPlanning },
        changedAt,
        changedBy: normalizeString(input.changedBy) || "ministry-planning-dispatcher"
      });
    }

    updated.push({
      songId,
      title: normalizeString(catalogSong.canonicalTitle || serviceSong.title),
      treatment,
      ministryPlanning: nextPlanning
    });
  }

  return {
    service: {
      serviceId: service.serviceId,
      serviceDate: service.serviceDate,
      serviceType: service.serviceType,
      title: service.title
    },
    treatment,
    feedback,
    updatedCount: updated.length,
    updated,
    unresolvedCount: unresolved.length,
    unresolved
  };
}

module.exports = {
  chooseCatalogSong,
  createMinistryPlanningError,
  inspectMusicPlanningSpreadsheet,
  mutateMinistryData,
  recordServiceSongFeedback,
  syncMusicPlanningSpreadsheet
};
