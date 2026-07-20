"use strict";

const { createHash } = require("node:crypto");

const {
  MAX_TEMPLATE_PPTX_BYTES,
  PPTX_CONTENT_TYPE
} = require("./sermon-presentation-template-import");

const UPLOAD_TTL_MS = 15 * 60 * 1000;
const IMPORT_READ_TTL_MS = 60 * 60 * 1000;
const UPLOAD_ID_PATTERN = /^presentation-template-([a-f0-9]{32})-(\d{13})$/;

function createUploadError(message, statusCode, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveFileName(value) {
  const fileName = normalizeString(value);
  const isSafePptx = fileName &&
    fileName.length <= 500 &&
    !/[\\/\0\r\n]/.test(fileName) &&
    fileName !== "." &&
    fileName !== ".." &&
    /\.pptx$/i.test(fileName);
  if (!isSafePptx) {
    throw createUploadError(
      "The presentation-template upload must be one editable .pptx file with a valid filename",
      400,
      "presentation_template_upload_file_invalid"
    );
  }
  return fileName;
}

function resolveIdempotencyKey(value) {
  const idempotencyKey = normalizeString(value);
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw createUploadError(
      "A stable idempotency key between 8 and 200 characters is required",
      400,
      "presentation_template_upload_idempotency_key_invalid"
    );
  }
  return idempotencyKey;
}

function parseUploadId(value) {
  const uploadId = normalizeString(value);
  const match = UPLOAD_ID_PATTERN.exec(uploadId);
  if (!match) {
    throw createUploadError(
      "The presentation-template upload ID is invalid",
      400,
      "presentation_template_upload_id_invalid"
    );
  }
  return { uploadId, createdAtMs: Number(match[2]) };
}

function buildStoragePath(uploadId, fileName) {
  return `sermon-file-staging/presentation-templates/${uploadId}/${fileName}`;
}

async function createPresentationTemplateUpload(input = {}, deps = {}) {
  const fileName = resolveFileName(input.fileName);
  const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
  if (!deps.bucket || typeof deps.bucket.file !== "function") {
    throw createUploadError(
      "Presentation-template upload storage is not configured",
      500,
      "presentation_template_upload_storage_not_configured"
    );
  }

  const nowMs = typeof deps.nowMs === "function" ? Number(deps.nowMs()) : Date.now();
  const keyHash = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
  const uploadId = `presentation-template-${keyHash}-${nowMs}`;
  const storagePath = buildStoragePath(uploadId, fileName);
  const expiresAtMs = nowMs + UPLOAD_TTL_MS;
  const [url] = await deps.bucket.file(storagePath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: expiresAtMs,
    contentType: PPTX_CONTENT_TYPE
  });

  return {
    uploadId,
    fileName,
    contentType: PPTX_CONTENT_TYPE,
    maximumBytes: MAX_TEMPLATE_PPTX_BYTES,
    expiresAt: new Date(expiresAtMs).toISOString(),
    upload: {
      method: "PUT",
      url,
      headers: { "Content-Type": PPTX_CONTENT_TYPE }
    }
  };
}

async function importPresentationTemplateUpload(input = {}, deps = {}) {
  const { uploadId, createdAtMs } = parseUploadId(input.uploadId);
  const fileName = resolveFileName(input.fileName);
  const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
  if (!deps.bucket || typeof deps.bucket.file !== "function" || typeof deps.runImport !== "function") {
    throw createUploadError(
      "Presentation-template staged import is not configured",
      500,
      "presentation_template_staged_import_not_configured"
    );
  }

  const nowMs = typeof deps.nowMs === "function" ? Number(deps.nowMs()) : Date.now();
  const readExpiresAtMs = createdAtMs + IMPORT_READ_TTL_MS;
  if (!Number.isFinite(createdAtMs) || nowMs > readExpiresAtMs) {
    throw createUploadError(
      "The staged presentation-template upload expired; create a new upload and try again",
      410,
      "presentation_template_upload_expired"
    );
  }

  const storagePath = buildStoragePath(uploadId, fileName);
  const file = deps.bucket.file(storagePath);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if (error?.code === 404 || Number(error?.statusCode) === 404) {
      throw createUploadError(
        "The staged PowerPoint was not found; upload the file before finalizing the import",
        400,
        "presentation_template_upload_missing"
      );
    }
    throw error;
  }

  const sizeBytes = Number(metadata?.size);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw createUploadError(
      "The staged PowerPoint is empty",
      400,
      "presentation_template_upload_empty"
    );
  }
  if (sizeBytes > MAX_TEMPLATE_PPTX_BYTES) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw createUploadError(
      "The staged PowerPoint exceeds the 10 MB template import limit",
      413,
      "presentation_template_upload_too_large",
      { maximumBytes: MAX_TEMPLATE_PPTX_BYTES, sizeBytes }
    );
  }

  const [downloadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: readExpiresAtMs
  });
  const { uploadId: _uploadId, fileName: _fileName, idempotencyKey: _idempotencyKey, ...options } = input;
  const result = await deps.runImport({
    idempotencyKey,
    arguments: {
      ...options,
      openaiFileIdRefs: [{
        name: fileName,
        mime_type: PPTX_CONTENT_TYPE,
        download_link: downloadUrl,
        file_id: uploadId
      }]
    }
  });

  let stagedFileDeleted = true;
  try {
    await file.delete({ ignoreNotFound: true });
  } catch (_error) {
    stagedFileDeleted = false;
  }
  return {
    ...result,
    stagedUpload: { uploadId, fileName, sizeBytes, stagedFileDeleted }
  };
}

module.exports = {
  IMPORT_READ_TTL_MS,
  UPLOAD_TTL_MS,
  buildStoragePath,
  createPresentationTemplateUpload,
  importPresentationTemplateUpload
};
