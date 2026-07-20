const { createHmac, timingSafeEqual } = require("node:crypto");

const DEFAULT_GPT_ACTION_DOWNLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_GPT_ACTION_DOWNLOAD_TTL_SECONDS = 8 * 24 * 60 * 60;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createDownloadSignature({ presentationId, expiresAtSeconds, secret } = {}) {
  const cleanPresentationId = normalizeString(presentationId);
  const cleanSecret = normalizeString(secret);
  const cleanExpiresAtSeconds = Number(expiresAtSeconds);
  if (!cleanPresentationId || !cleanSecret || !Number.isSafeInteger(cleanExpiresAtSeconds)) {
    throw new Error("Invalid GPT Action download signature input");
  }
  return createHmac("sha256", cleanSecret)
    .update(`${cleanPresentationId}.${cleanExpiresAtSeconds}`)
    .digest("base64url");
}

function buildGptActionDownloadUrl({
  baseUrl,
  presentationId,
  secret,
  nowMs = Date.now(),
  ttlMs = DEFAULT_GPT_ACTION_DOWNLOAD_TTL_MS
} = {}) {
  const cleanBaseUrl = normalizeString(baseUrl).replace(/\/+$/, "");
  const cleanPresentationId = normalizeString(presentationId);
  if (!cleanBaseUrl || !cleanPresentationId) {
    throw new Error("GPT Action download URL requires baseUrl and presentationId");
  }
  const expiresAtMs = Number(nowMs) + Number(ttlMs);
  const expiresAtSeconds = Math.floor(expiresAtMs / 1000);
  const signature = createDownloadSignature({
    presentationId: cleanPresentationId,
    expiresAtSeconds,
    secret
  });
  const url = new URL(
    `/gpt-action-files/sermon-presentations/${encodeURIComponent(cleanPresentationId)}`,
    `${cleanBaseUrl}/`
  );
  url.searchParams.set("expires", String(expiresAtSeconds));
  url.searchParams.set("signature", signature);
  return {
    downloadUrl: url.toString(),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
  };
}

function buildGptActionArtifactDownloadUrl({
  baseUrl,
  artifactType,
  artifactId,
  secret,
  nowMs = Date.now(),
  ttlMs = DEFAULT_GPT_ACTION_DOWNLOAD_TTL_MS
} = {}) {
  const cleanBaseUrl = normalizeString(baseUrl).replace(/\/+$/, "");
  const cleanArtifactType = normalizeString(artifactType);
  const cleanArtifactId = normalizeString(artifactId);
  if (!cleanBaseUrl || !cleanArtifactType || !cleanArtifactId) {
    throw new Error("GPT Action artifact download URL requires baseUrl, artifactType, and artifactId");
  }
  const expiresAtMs = Number(nowMs) + Number(ttlMs);
  const expiresAtSeconds = Math.floor(expiresAtMs / 1000);
  const signature = createDownloadSignature({
    presentationId: `${cleanArtifactType}:${cleanArtifactId}`,
    expiresAtSeconds,
    secret
  });
  const url = new URL(
    `/gpt-action-files/${encodeURIComponent(cleanArtifactType)}/${encodeURIComponent(cleanArtifactId)}`,
    `${cleanBaseUrl}/`
  );
  url.searchParams.set("expires", String(expiresAtSeconds));
  url.searchParams.set("signature", signature);
  return {
    downloadUrl: url.toString(),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
  };
}

function verifyGptActionDownloadSignature({
  presentationId,
  expiresAtSeconds,
  signature,
  secret,
  nowMs = Date.now()
} = {}) {
  const cleanPresentationId = normalizeString(presentationId);
  const cleanSignature = normalizeString(signature);
  const parsedExpiresAtSeconds = Number(expiresAtSeconds);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);

  if (
    !cleanPresentationId ||
    !cleanSignature ||
    !Number.isSafeInteger(parsedExpiresAtSeconds) ||
    parsedExpiresAtSeconds <= nowSeconds ||
    parsedExpiresAtSeconds - nowSeconds > MAX_GPT_ACTION_DOWNLOAD_TTL_SECONDS
  ) {
    return false;
  }

  const expected = createDownloadSignature({
    presentationId: cleanPresentationId,
    expiresAtSeconds: parsedExpiresAtSeconds,
    secret
  });
  const actualBuffer = Buffer.from(cleanSignature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

function verifyGptActionArtifactDownloadSignature({ artifactType, artifactId, ...input } = {}) {
  return verifyGptActionDownloadSignature({
    ...input,
    presentationId: `${normalizeString(artifactType)}:${normalizeString(artifactId)}`
  });
}

module.exports = {
  DEFAULT_GPT_ACTION_DOWNLOAD_TTL_MS,
  MAX_GPT_ACTION_DOWNLOAD_TTL_SECONDS,
  buildGptActionArtifactDownloadUrl,
  buildGptActionDownloadUrl,
  createDownloadSignature,
  verifyGptActionArtifactDownloadSignature,
  verifyGptActionDownloadSignature
};
