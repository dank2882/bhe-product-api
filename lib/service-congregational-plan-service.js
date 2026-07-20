"use strict";

const {
  writeServiceCongregationalPlanToGoogleSheet
} = require("./google-sheet-congregational-plan-writer");

const CONGREGATIONAL_SLOTS = Object.freeze({
  congregational_1: Object.freeze({ slot: "congregational_1", sourceColumnName: "Congregational #1", slotIndex: 10 }),
  congregational_2: Object.freeze({ slot: "congregational_2", sourceColumnName: "Congregational #2", slotIndex: 20 }),
  congregational_3: Object.freeze({ slot: "congregational_3", sourceColumnName: "Congregational #3", slotIndex: 30 })
});

function createCongregationalPlanError(message, statusCode = 400, code = "service_congregational_plan_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function loadCollection(collection, limit = 5000) {
  const snapshot = await collection.limit(limit).get();
  return snapshot.docs.map((doc) => ({ docId: doc.id, ...(doc.data() || {}) }));
}

function normalizeSlot(value) {
  const token = normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases = {
    "1": "congregational_1",
    "2": "congregational_2",
    "3": "congregational_3",
    congregational1: "congregational_1",
    congregational2: "congregational_2",
    congregational3: "congregational_3"
  };
  return aliases[token] || token;
}

function songTitles(song = {}) {
  return [song.canonicalTitle, song.title, ...(Array.isArray(song.titleAliases) ? song.titleAliases : [])]
    .map((value) => normalizeToken(value))
    .filter(Boolean);
}

function resolveSongChange(change, songs) {
  if (change?.clear === true) {
    return { songId: "", hymnalNumber: null, title: "", displayValue: "", clear: true };
  }
  const requestedSongId = normalizeString(change?.songId);
  const requestedTitle = normalizeString(change?.title);
  const requestedHymnalNumber = Number(change?.hymnalNumber);
  let matches = songs;
  if (requestedSongId) {
    matches = songs.filter((song) => normalizeString(song.songId || song.docId) === requestedSongId);
    if (matches.length !== 1) {
      throw createCongregationalPlanError("Canonical song was not found", 404, "congregational_song_not_found", {
        songId: requestedSongId
      });
    }
  } else {
    if (Number.isInteger(requestedHymnalNumber)) {
      matches = matches.filter((song) => Number(song.hymnalNumber) === requestedHymnalNumber);
    }
    if (requestedTitle) {
      const titleToken = normalizeToken(requestedTitle);
      const exactTitleMatches = matches.filter((song) => songTitles(song).includes(titleToken));
      if (exactTitleMatches.length > 0) matches = exactTitleMatches;
    }
    if (matches.length > 1) {
      throw createCongregationalPlanError(
        "Song selection is ambiguous; provide songId",
        409,
        "ambiguous_congregational_song",
        { songIds: matches.slice(0, 10).map((song) => normalizeString(song.songId || song.docId)) }
      );
    }
  }
  const song = matches.length === 1 ? matches[0] : null;
  const title = normalizeString(song?.canonicalTitle || song?.title || requestedTitle);
  const hymnalNumber = Number.isInteger(Number(song?.hymnalNumber))
    ? Number(song.hymnalNumber)
    : (Number.isInteger(requestedHymnalNumber) ? requestedHymnalNumber : null);
  if (!title) {
    throw createCongregationalPlanError(
      "Each song change needs songId, hymnalNumber, title, or clear true",
      400,
      "missing_congregational_song"
    );
  }
  return {
    songId: normalizeString(song?.songId || song?.docId),
    hymnalNumber,
    title,
    displayValue: `${hymnalNumber ? `${hymnalNumber} - ` : ""}${title}`,
    clear: false
  };
}

async function saveServiceCongregationalPlan(input = {}, deps = {}) {
  const serviceId = normalizeString(input.serviceId);
  if (!serviceId) {
    throw createCongregationalPlanError("serviceId is required", 400, "missing_service_id");
  }
  const requestedChanges = Array.isArray(input.songChanges) ? input.songChanges : [];
  if (requestedChanges.length === 0) {
    throw createCongregationalPlanError("At least one congregational slot change is required", 400, "missing_song_changes");
  }
  const serviceRef = deps.servicesCollection.doc(serviceId);
  const [serviceDoc, existingEvents, songs] = await Promise.all([
    serviceRef.get(),
    loadCollection(deps.serviceSongEventsCollection),
    loadCollection(deps.songsCollection)
  ]);
  if (!serviceDoc.exists) {
    throw createCongregationalPlanError("Service not found", 404, "service_not_found", { serviceId });
  }
  const rawService = serviceDoc.data() || {};
  const service = {
    serviceId,
    serviceDate: normalizeString(rawService.serviceDate),
    serviceType: normalizeString(rawService.serviceType),
    title: normalizeString(rawService.title),
    sourceSheetName: normalizeString(rawService.sourceSheetName),
    sourceRowNumber: Number.isInteger(rawService.sourceRowNumber) ? rawService.sourceRowNumber : null
  };
  const serviceEvents = existingEvents.filter((event) => normalizeString(event.serviceId) === serviceId);
  const usedSlots = new Set();
  const preparedChanges = requestedChanges.map((change, index) => {
    const eventId = normalizeString(change?.serviceSongEventId);
    const matchingEvent = eventId
      ? serviceEvents.find((event) => normalizeString(event.serviceSongEventId || event.docId) === eventId)
      : null;
    const slot = normalizeSlot(change?.slot || matchingEvent?.sourceColumnKey || matchingEvent?.sourceColumnName);
    const definition = CONGREGATIONAL_SLOTS[slot];
    if (!definition) {
      throw createCongregationalPlanError(
        "Invalid congregational slot",
        400,
        "invalid_congregational_slot",
        { index, slot: change?.slot, allowedSlots: Object.keys(CONGREGATIONAL_SLOTS) }
      );
    }
    if (usedSlots.has(slot)) {
      throw createCongregationalPlanError("A congregational slot was changed more than once", 400, "duplicate_congregational_slot", { slot });
    }
    usedSlots.add(slot);
    const existing = matchingEvent || serviceEvents.find((event) =>
      Number(event.slotIndex) === definition.slotIndex || normalizeString(event.sourceColumnName) === definition.sourceColumnName
    );
    const resolved = resolveSongChange(change, songs);
    return {
      ...definition,
      serviceSongEventId: normalizeString(existing?.serviceSongEventId || existing?.docId) ||
        `sse-plan-${serviceId}-${definition.slotIndex}-${definition.slot.replace(/_/g, "-")}`,
      existing: existing || {},
      notes: normalizeString(change?.notes),
      ...resolved
    };
  });
  const spreadsheetWrite = await writeServiceCongregationalPlanToGoogleSheet({
    ...input,
    service,
    changes: preparedChanges
  }, deps);
  const resolvedSourceRowNumber = spreadsheetWrite.sourceRowNumber;
  service.sourceRowNumber = resolvedSourceRowNumber;
  const sourceCellBySlot = new Map(spreadsheetWrite.changes.map((change) => [change.slot, change.sourceCell]));
  const now = getNowIso(deps);
  const changedBy = normalizeString(input.changedBy) || "ministry-planning-dispatcher";
  const savedChanges = [];
  for (const change of preparedChanges) {
    const record = {
      ...change.existing,
      serviceSongEventId: change.serviceSongEventId,
      serviceId,
      serviceDate: service.serviceDate,
      serviceType: service.serviceType,
      slotIndex: change.slotIndex,
      plannedSequence: change.slotIndex,
      usageRole: "congregational",
      sourceColumnName: change.sourceColumnName,
      sourceColumnKey: change.slot,
      sourceRowNumber: resolvedSourceRowNumber,
      sourceCell: sourceCellBySlot.get(change.slot) || normalizeString(change.existing.sourceCell),
      rawValue: change.displayValue,
      songTitleCandidate: change.title,
      songTitleConfidence: "high",
      title: change.title,
      songTitle: change.title,
      hymnalNumber: change.hymnalNumber,
      songId: change.songId || null,
      planningStatus: change.clear ? "removed_from_plan" : "planned",
      historyVisibility: change.clear ? "superseded" : "active",
      changedAfterPlan: true,
      detailNote: change.notes,
      updatedAt: now,
      changedBy
    };
    await deps.serviceSongEventsCollection.doc(change.serviceSongEventId).set(record);
    savedChanges.push({
      slot: change.slot,
      serviceSongEventId: change.serviceSongEventId,
      sourceCell: record.sourceCell,
      displayValue: change.displayValue,
      songId: change.songId,
      hymnalNumber: change.hymnalNumber,
      title: change.title,
      cleared: change.clear
    });
  }
  await serviceRef.update({
    changedAfterPlan: true,
    sourceRowNumber: resolvedSourceRowNumber,
    sourceCell: `C${resolvedSourceRowNumber}`,
    updatedAt: now,
    changedBy
  });
  return { service, changes: savedChanges, spreadsheetWrite };
}

module.exports = {
  CONGREGATIONAL_SLOTS,
  createCongregationalPlanError,
  saveServiceCongregationalPlan
};
