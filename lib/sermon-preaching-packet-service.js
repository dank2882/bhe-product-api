"use strict";

const { randomUUID } = require("node:crypto");
const JSZip = require("jszip");
const {
  createSermonPresentation,
  getSermon,
  getSermonMaterialInventory,
  getSermonPresentation,
  getSermonSource,
  listSermonPresentations,
  listSermonSources
} = require("./sermon-workspace-service");

const PACKET_CONTENT_TYPE = "application/zip";
const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createPacketError(message, statusCode = 400, details = {}, code = "sermon_preaching_packet_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  error.code = code;
  return error;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function slugify(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "sermon";
}

function getCollection(deps, name) {
  const collection = deps[name];
  if (!collection || typeof collection.doc !== "function") {
    throw createPacketError(`${name} is not configured`, 500, {}, "sermon_preaching_packet_collection_not_configured");
  }
  return collection;
}

async function loadCollection(collection, maximum = 1000) {
  const snapshot = await collection.limit(maximum).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function findManuscriptFile(source = {}, sermon = {}) {
  const refs = [
    ...(Array.isArray(source.sourceRefs) ? source.sourceRefs : []),
    ...(Array.isArray(sermon.sourceRefs) ? sermon.sourceRefs : [])
  ];
  const preferred = refs.find((ref) =>
    normalizeString(ref.role) === "manuscript_draft" && normalizeString(ref.storagePath));
  const fallback = refs.find((ref) =>
    normalizeString(ref.storagePath) && (
      normalizeString(ref.contentType) === DOCX_CONTENT_TYPE ||
      normalizeString(ref.filename).toLowerCase().endsWith(".docx")
    ));
  const file = preferred || fallback;
  return file ? {
    filename: normalizeString(file.filename) || `${slugify(sermon.title)}-manuscript.docx`,
    storagePath: normalizeString(file.storagePath),
    contentType: normalizeString(file.contentType) || DOCX_CONTENT_TYPE,
    sizeBytes: Number(file.sizeBytes) || 0
  } : null;
}

function findMaterialFingerprint(source = {}) {
  const ref = (Array.isArray(source.sourceRefs) ? source.sourceRefs : [])
    .find((item) => normalizeString(item.type) === "sermon_material_plan");
  return normalizeString(ref?.materialFingerprint);
}

function buildPacketSummary(packet = {}, fallbackId = "") {
  return {
    packetId: packet.packetId || fallbackId,
    sermonId: packet.sermonId || "",
    title: packet.title || "",
    status: packet.status || "ready",
    filename: packet.filename || "",
    storagePath: packet.storagePath || "",
    contentType: packet.contentType || PACKET_CONTENT_TYPE,
    sizeBytes: Number(packet.sizeBytes) || 0,
    downloadUrl: packet.downloadUrl || "",
    downloadUrlExpiresAt: packet.downloadUrlExpiresAt || "",
    manuscriptSourceId: packet.manuscriptSourceId || "",
    manuscriptFilename: packet.manuscriptFilename || "",
    presentationId: packet.presentationId || "",
    presentationFilename: packet.presentationFilename || "",
    templateId: packet.templateId || "",
    slideCount: Number(packet.slideCount) || 0,
    sourceCount: Number(packet.sourceCount) || 0,
    materialFingerprint: packet.materialFingerprint || "",
    materialPlanVerified: packet.materialPlanVerified === true,
    createdAt: packet.createdAt || "",
    updatedAt: packet.updatedAt || ""
  };
}

async function resolvePresentation(input, sermonId, materialFingerprint, deps) {
  const createPresentation = deps.createSermonPresentation || createSermonPresentation;
  const getPresentation = deps.getSermonPresentation || getSermonPresentation;
  if (input.presentationId && input.regenerateSlides !== true) {
    const presentation = (await getPresentation({ presentationId: input.presentationId }, deps)).presentation;
    if (materialFingerprint && presentation.materialFingerprint !== materialFingerprint) {
      throw createPacketError("The selected presentation was generated from an older sermon material plan", 409, {
        sermonId,
        presentationId: presentation.presentationId,
        expectedMaterialFingerprint: materialFingerprint,
        presentationMaterialFingerprint: presentation.materialFingerprint || "",
        nextAction: "Regenerate the sermon presentation, then retry the packet."
      }, "sermon_presentation_material_plan_stale");
    }
    return presentation;
  }
  if (input.regenerateSlides !== true) {
    const existing = await listSermonPresentations({ sermonId, status: "rendered", limit: 25 }, deps);
    const presentation = existing.presentations.find((item) =>
      item.storagePath && (!materialFingerprint || item.materialFingerprint === materialFingerprint));
    if (presentation) return presentation;
  }
  const created = await createPresentation({
    sermonId,
    templateId: input.templateId,
    title: input.presentationTitle,
    compact: input.compact !== false
  }, deps);
  const presentationId = normalizeString(created?.presentation?.presentationId);
  if (!presentationId) return created?.presentation;
  return (await getPresentation({ presentationId }, deps)).presentation;
}

async function createSermonPreachingPacket(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  if (!sermonId) throw createPacketError("sermonId is required", 400, {}, "sermon_id_required");
  const sermon = (await getSermon({ sermonId }, deps)).sermon;
  const materialInventory = await getSermonMaterialInventory({ sermonId, limit: 1 }, deps);
  if (materialInventory.summary.unplaced > 0) {
    throw createPacketError("Resolve every unplaced sermon-development item before creating the preaching packet", 409, {
      sermonId,
      unplacedCount: materialInventory.summary.unplaced,
      materialFingerprint: materialInventory.materialFingerprint,
      nextAction: "Preview and confirm a batch placement plan, then regenerate the final artifacts."
    }, "sermon_material_plan_incomplete");
  }
  const settledMaterialFingerprint = materialInventory.summary.total > 0
    ? materialInventory.materialFingerprint
    : "";
  const manuscriptSourceId = normalizeString(input.manuscriptSourceId) || normalizeString(sermon.primaryManuscriptSourceId);
  if (!manuscriptSourceId) {
    throw createPacketError(
      "An accepted primary manuscript is required before creating a preaching packet",
      409,
      { sermonId, nextAction: "Call createSermonManuscriptDraft, then retry this packet operation." },
      "primary_manuscript_required"
    );
  }
  const manuscriptSource = (await getSermonSource({ sourceId: manuscriptSourceId }, deps)).source;
  if (manuscriptSource.sermonId !== sermonId) {
    throw createPacketError("Primary manuscript belongs to another sermon", 409, {
      sermonId,
      manuscriptSourceId,
      sourceSermonId: manuscriptSource.sermonId
    }, "manuscript_sermon_mismatch");
  }
  const manuscriptMaterialFingerprint = findMaterialFingerprint(manuscriptSource);
  if (settledMaterialFingerprint && manuscriptMaterialFingerprint !== settledMaterialFingerprint) {
    throw createPacketError("The primary manuscript was generated from an older sermon material plan", 409, {
      sermonId,
      manuscriptSourceId,
      expectedMaterialFingerprint: settledMaterialFingerprint,
      manuscriptMaterialFingerprint,
      nextAction: "Create and accept a new manuscript draft, then retry the packet."
    }, "sermon_manuscript_material_plan_stale");
  }
  const manuscriptFile = findManuscriptFile(manuscriptSource, sermon);
  if (!manuscriptFile?.storagePath) {
    throw createPacketError("Primary manuscript DOCX file is missing", 409, {
      sermonId,
      manuscriptSourceId
    }, "primary_manuscript_file_missing");
  }
  const presentation = await resolvePresentation(input, sermonId, settledMaterialFingerprint, deps);
  if (!presentation?.storagePath) {
    throw createPacketError("Rendered presentation file is missing", 409, {
      sermonId,
      presentationId: presentation?.presentationId || ""
    }, "sermon_presentation_file_missing");
  }
  if (typeof deps.downloadSermonArtifact !== "function" || typeof deps.uploadSermonPreachingPacket !== "function") {
    throw createPacketError("Preaching packet file storage is not configured", 500, {}, "preaching_packet_storage_not_configured");
  }
  const [manuscriptBuffer, presentationBuffer, sourceResult] = await Promise.all([
    deps.downloadSermonArtifact({ storagePath: manuscriptFile.storagePath }),
    deps.downloadSermonArtifact({ storagePath: presentation.storagePath }),
    listSermonSources({ sermonId, limit: 200 }, deps)
  ]);
  const generatedAt = getNowIso(deps);
  const packetId = normalizeString(input.packetId) || `preaching-packet-${slugify(sermonId)}-${
    (typeof deps.randomUUID === "function" ? deps.randomUUID() : randomUUID()).slice(0, 8)
  }`;
  const sourceManifest = sourceResult.sources.map((source) => ({
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceLabel: source.sourceLabel,
    summary: source.summary,
    tags: source.tags,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt
  }));
  const packetManifest = {
    packetId,
    generatedAt,
    sermon: {
      sermonId: sermon.sermonId,
      title: sermon.title,
      status: sermon.status,
      scriptureText: sermon.scriptureText,
      bigIdea: sermon.bigIdea,
      outline: sermon.outline,
      seriesId: sermon.seriesId,
      seriesTitle: sermon.seriesTitle,
      seriesSlug: sermon.seriesSlug,
      seriesNumber: sermon.seriesNumber,
      occasions: sermon.occasions,
      primaryManuscriptSourceId: manuscriptSourceId
    },
    manuscript: {
      sourceId: manuscriptSourceId,
      sourceLabel: manuscriptSource.sourceLabel,
      filename: manuscriptFile.filename,
      storagePath: manuscriptFile.storagePath
    },
    presentation: {
      presentationId: presentation.presentationId,
      filename: presentation.filename,
      storagePath: presentation.storagePath,
      aspectRatio: presentation.aspectRatio,
      slideCount: presentation.slideCount,
      templateId: presentation.templateId
    },
    materialPlan: {
      materialFingerprint: materialInventory.materialFingerprint,
      total: materialInventory.summary.total,
      placed: materialInventory.summary.placed,
      unplaced: materialInventory.summary.unplaced,
      intentionallyCut: materialInventory.summary.intentionallyCut,
      manuscriptVerified: !settledMaterialFingerprint || manuscriptMaterialFingerprint === settledMaterialFingerprint,
      presentationVerified: !settledMaterialFingerprint || presentation.materialFingerprint === settledMaterialFingerprint
    },
    sources: sourceManifest
  };
  const zip = new JSZip();
  zip.file(manuscriptFile.filename, manuscriptBuffer);
  zip.file(presentation.filename || `${slugify(sermon.title)}.pptx`, presentationBuffer);
  zip.file(`${slugify(sermon.title)}-manuscript.txt`, normalizeString(manuscriptSource.material));
  zip.file("packet-manifest.json", `${JSON.stringify(packetManifest, null, 2)}\n`);
  zip.file("source-manifest.json", `${JSON.stringify(sourceManifest, null, 2)}\n`);
  zip.file("README.txt", [
    `Preaching packet: ${sermon.title}`,
    `Scripture: ${sermon.scriptureText || ""}`,
    `Generated: ${generatedAt}`,
    "",
    "Contents:",
    `- ${manuscriptFile.filename}: editable sermon manuscript`,
    `- ${presentation.filename}: editable 16:9 PowerPoint`,
    `- ${slugify(sermon.title)}-manuscript.txt: portable manuscript text`,
    "- packet-manifest.json: sermon and artifact metadata",
    "- source-manifest.json: source provenance without duplicating full source material"
  ].join("\n"));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const uploaded = await deps.uploadSermonPreachingPacket({
    sermonId,
    packetId,
    title: sermon.title,
    buffer,
    generatedAt
  });
  const packet = {
    packetId,
    sermonId,
    title: sermon.title,
    status: "ready",
    ...uploaded,
    manuscriptSourceId,
    manuscriptFilename: manuscriptFile.filename,
    manuscriptStoragePath: manuscriptFile.storagePath,
    presentationId: presentation.presentationId,
    presentationFilename: presentation.filename,
    presentationStoragePath: presentation.storagePath,
    templateId: presentation.templateId || "",
    slideCount: Number(presentation.slideCount) || 0,
    sourceCount: sourceManifest.length,
    materialFingerprint: materialInventory.materialFingerprint,
    materialPlanVerified: true,
    createdAt: generatedAt,
    updatedAt: generatedAt
  };
  await getCollection(deps, "sermonPreachingPacketsCollection").doc(packetId).create(packet);
  return {
    packet: buildPacketSummary(packet, packetId),
    manuscript: {
      sourceId: manuscriptSourceId,
      filename: manuscriptFile.filename
    },
    presentation: {
      presentationId: presentation.presentationId,
      filename: presentation.filename,
      aspectRatio: presentation.aspectRatio,
      slideCount: Number(presentation.slideCount) || 0,
      templateId: presentation.templateId || ""
    }
  };
}

async function listSermonPreachingPackets(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  const limit = Math.min(Math.max(Number.parseInt(input.limit, 10) || 50, 1), 200);
  const records = await loadCollection(getCollection(deps, "sermonPreachingPacketsCollection"), 10000);
  const packets = records
    .filter(({ data }) => !sermonId || data.sermonId === sermonId)
    .sort((left, right) => normalizeString(right.data.createdAt).localeCompare(normalizeString(left.data.createdAt)))
    .slice(0, limit)
    .map(({ id, data }) => buildPacketSummary(data, id));
  return { count: packets.length, packets };
}

async function getSermonPreachingPacket(input = {}, deps = {}) {
  const packetId = normalizeString(input.packetId);
  if (!packetId) throw createPacketError("packetId is required", 400, {}, "packet_id_required");
  const doc = await getCollection(deps, "sermonPreachingPacketsCollection").doc(packetId).get();
  if (!doc.exists) throw createPacketError("Preaching packet not found", 404, { packetId }, "sermon_preaching_packet_not_found");
  return { packet: buildPacketSummary(doc.data() || {}, packetId) };
}

module.exports = {
  PACKET_CONTENT_TYPE,
  createSermonPreachingPacket,
  getSermonPreachingPacket,
  listSermonPreachingPackets
};
