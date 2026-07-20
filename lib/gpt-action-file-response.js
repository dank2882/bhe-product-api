const DEFAULT_PRESENTATION_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_GPT_ACTION_FILE_BYTES = 10 * 1024 * 1024;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeAttachmentFilename(value) {
  const filename = normalizeString(value) || "sermon-presentation.pptx";
  return filename
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^A-Za-z0-9._ ()-]/g, "_")
    .slice(0, 180) || "sermon-presentation.pptx";
}

function buildAttachmentContentDisposition(filename) {
  return `attachment; filename="${sanitizeAttachmentFilename(filename)}"`;
}

function getPresentationCandidate(operationResult = {}) {
  const result = operationResult.result && typeof operationResult.result === "object"
    ? operationResult.result
    : {};
  const presentation = result.presentation && typeof result.presentation === "object"
    ? result.presentation
    : {};

  return {
    presentationId: normalizeString(presentation.presentationId),
    filename: normalizeString(presentation.filename),
    storagePath: normalizeString(presentation.storagePath),
    contentType: normalizeString(presentation.contentType),
    sizeBytes: Number.isFinite(Number(presentation.sizeBytes))
      ? Number(presentation.sizeBytes)
      : 0
  };
}

async function createPresentationActionFileResponse(operationResult = {}, deps = {}) {
  const candidate = getPresentationCandidate(operationResult);
  if (!candidate.presentationId) return null;

  const stored = typeof deps.getPresentation === "function"
    ? await deps.getPresentation(candidate.presentationId)
    : {};
  const presentation = stored && typeof stored === "object" ? stored : {};
  const storagePath = normalizeString(presentation.storagePath || candidate.storagePath);
  const filename = sanitizeAttachmentFilename(presentation.filename || candidate.filename);
  const contentType = normalizeString(presentation.contentType || candidate.contentType) ||
    DEFAULT_PRESENTATION_CONTENT_TYPE;
  const sizeBytes = Number.isFinite(Number(presentation.sizeBytes))
    ? Number(presentation.sizeBytes)
    : candidate.sizeBytes;

  if (!storagePath || typeof deps.createSignedUrl !== "function") return null;
  if (sizeBytes > MAX_GPT_ACTION_FILE_BYTES) {
    return {
      skipped: true,
      reason: "file_too_large",
      presentationId: candidate.presentationId,
      sizeBytes
    };
  }

  const signed = await deps.createSignedUrl({
    presentationId: candidate.presentationId,
    storagePath,
    filename,
    contentType,
    contentDisposition: buildAttachmentContentDisposition(filename)
  });
  const downloadUrl = normalizeString(signed?.downloadUrl || signed?.url);
  if (!downloadUrl) return null;

  return {
    skipped: false,
    presentationId: candidate.presentationId,
    filename,
    contentType,
    sizeBytes,
    downloadUrl,
    downloadUrlExpiresAt: normalizeString(signed?.expiresAt),
    openaiFileResponse: [downloadUrl]
  };
}

async function createPreachingPacketActionFileResponse(operationResult = {}, deps = {}) {
  const result = operationResult.result && typeof operationResult.result === "object"
    ? operationResult.result
    : {};
  const candidate = result.packet && typeof result.packet === "object" ? result.packet : {};
  const packetId = normalizeString(candidate.packetId);
  if (!packetId) return null;
  const stored = typeof deps.getPacket === "function" ? await deps.getPacket(packetId) : {};
  const packet = stored && typeof stored === "object" ? stored : {};
  const storagePath = normalizeString(packet.storagePath || candidate.storagePath);
  const filename = sanitizeAttachmentFilename(packet.filename || candidate.filename || "sermon-preaching-packet.zip");
  const contentType = normalizeString(packet.contentType || candidate.contentType) || "application/zip";
  const sizeBytes = Number.isFinite(Number(packet.sizeBytes)) ? Number(packet.sizeBytes) : Number(candidate.sizeBytes) || 0;
  if (!storagePath || typeof deps.createSignedUrl !== "function") return null;
  if (sizeBytes > MAX_GPT_ACTION_FILE_BYTES) {
    return { skipped: true, reason: "file_too_large", artifactId: packetId, packetId, sizeBytes };
  }
  const signed = await deps.createSignedUrl({
    packetId,
    storagePath,
    filename,
    contentType,
    contentDisposition: buildAttachmentContentDisposition(filename)
  });
  const downloadUrl = normalizeString(signed?.downloadUrl || signed?.url);
  if (!downloadUrl) return null;
  return {
    skipped: false,
    artifactId: packetId,
    packetId,
    filename,
    contentType,
    sizeBytes,
    downloadUrl,
    downloadUrlExpiresAt: normalizeString(signed?.expiresAt),
    openaiFileResponse: [downloadUrl]
  };
}

function applyPresentationActionFileResponse(responseBody = {}, fileResponse = {}) {
  if (!fileResponse || fileResponse.skipped || !Array.isArray(fileResponse.openaiFileResponse)) {
    return responseBody;
  }

  responseBody.openaiFileResponse = [...fileResponse.openaiFileResponse];

  if (Object.hasOwn(responseBody, "downloadUrl")) {
    responseBody.downloadUrl = fileResponse.downloadUrl;
    responseBody.downloadUrlExpiresAt = fileResponse.downloadUrlExpiresAt;
  }

  const nestedPresentation = responseBody.result?.presentation;
  if (nestedPresentation && typeof nestedPresentation === "object") {
    nestedPresentation.downloadUrl = fileResponse.downloadUrl;
    nestedPresentation.downloadUrlExpiresAt = fileResponse.downloadUrlExpiresAt;
  }
  const nestedPacket = responseBody.result?.packet;
  if (nestedPacket && typeof nestedPacket === "object") {
    nestedPacket.downloadUrl = fileResponse.downloadUrl;
    nestedPacket.downloadUrlExpiresAt = fileResponse.downloadUrlExpiresAt;
  }

  return responseBody;
}

module.exports = {
  MAX_GPT_ACTION_FILE_BYTES,
  applyPresentationActionFileResponse,
  buildAttachmentContentDisposition,
  createPreachingPacketActionFileResponse,
  createPresentationActionFileResponse,
  sanitizeAttachmentFilename
};
