"use strict";

const { createHash } = require("node:crypto");
const path = require("node:path");

const {
  DOCX_CONTENT_TYPE,
  MAX_SCRIPTURE_NOTE_IMPORT_BYTES
} = require("./scripture-note-document-import");

const UPLOAD_TTL_MS = 15 * 60 * 1000;
const IMPORT_READ_TTL_MS = 60 * 60 * 1000;
const UPLOAD_ID_PATTERN = /^scripture-notes-([a-f0-9]{32})-(\d{13})$/;
const CONTENT_TYPES_BY_EXTENSION = Object.freeze({
  ".docx": DOCX_CONTENT_TYPE,
  ".md": "text/markdown",
  ".txt": "text/plain"
});

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

function resolveFile(fileName) {
  const normalized = normalizeString(fileName);
  const extension = path.extname(normalized).toLowerCase();
  const isSafeBasename = normalized &&
    normalized.length <= 500 &&
    path.basename(normalized) === normalized &&
    !/[\\/\0\r\n]/.test(normalized) &&
    normalized !== "." &&
    normalized !== "..";
  if (!isSafeBasename || !CONTENT_TYPES_BY_EXTENSION[extension]) {
    throw createUploadError(
      "The Scripture notes upload must be one .docx, .txt, or .md file with a valid filename",
      400,
      "scripture_note_upload_file_invalid"
    );
  }
  return { fileName: normalized, contentType: CONTENT_TYPES_BY_EXTENSION[extension] };
}

function resolveIdempotencyKey(value) {
  const idempotencyKey = normalizeString(value);
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw createUploadError(
      "A stable idempotency key between 8 and 200 characters is required",
      400,
      "scripture_note_upload_idempotency_key_invalid"
    );
  }
  return idempotencyKey;
}

function parseUploadId(value) {
  const uploadId = normalizeString(value);
  const match = UPLOAD_ID_PATTERN.exec(uploadId);
  if (!match) {
    throw createUploadError(
      "The Scripture notes upload ID is invalid",
      400,
      "scripture_note_upload_id_invalid"
    );
  }
  return { uploadId, keyHash: match[1], createdAtMs: Number(match[2]) };
}

function buildStoragePath(uploadId, fileName) {
  return `sermon-file-staging/scripture-notes/${uploadId}/${fileName}`;
}

async function createScriptureNotesUpload(input = {}, deps = {}) {
  const { fileName, contentType } = resolveFile(input.fileName);
  const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
  if (!deps.bucket || typeof deps.bucket.file !== "function") {
    throw createUploadError(
      "Scripture notes upload storage is not configured",
      500,
      "scripture_note_upload_storage_not_configured"
    );
  }

  const nowMs = typeof deps.nowMs === "function" ? Number(deps.nowMs()) : Date.now();
  const keyHash = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
  const uploadId = `scripture-notes-${keyHash}-${nowMs}`;
  const storagePath = buildStoragePath(uploadId, fileName);
  const expiresAtMs = nowMs + UPLOAD_TTL_MS;
  const [url] = await deps.bucket.file(storagePath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: expiresAtMs,
    contentType
  });

  return {
    uploadId,
    fileName,
    contentType,
    maximumBytes: MAX_SCRIPTURE_NOTE_IMPORT_BYTES,
    expiresAt: new Date(expiresAtMs).toISOString(),
    upload: {
      method: "PUT",
      url,
      headers: { "Content-Type": contentType }
    }
  };
}

async function importScriptureNotesUpload(input = {}, deps = {}) {
  const { uploadId, createdAtMs } = parseUploadId(input.uploadId);
  const { fileName, contentType } = resolveFile(input.fileName);
  const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
  if (!deps.bucket || typeof deps.bucket.file !== "function" || typeof deps.runImport !== "function") {
    throw createUploadError(
      "Scripture notes staged import is not configured",
      500,
      "scripture_note_staged_import_not_configured"
    );
  }

  const nowMs = typeof deps.nowMs === "function" ? Number(deps.nowMs()) : Date.now();
  const readExpiresAtMs = createdAtMs + IMPORT_READ_TTL_MS;
  if (!Number.isFinite(createdAtMs) || nowMs > readExpiresAtMs) {
    throw createUploadError(
      "The staged Scripture notes upload expired; create a new upload and try again",
      410,
      "scripture_note_upload_expired"
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
        "The staged Scripture notes file was not found; upload the file before finalizing the import",
        400,
        "scripture_note_upload_missing"
      );
    }
    throw error;
  }

  const sizeBytes = Number(metadata?.size);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw createUploadError(
      "The staged Scripture notes file is empty",
      400,
      "scripture_note_upload_empty"
    );
  }
  if (sizeBytes > MAX_SCRIPTURE_NOTE_IMPORT_BYTES) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw createUploadError(
      "The staged Scripture notes file is too large",
      413,
      "scripture_note_upload_too_large",
      { maximumBytes: MAX_SCRIPTURE_NOTE_IMPORT_BYTES, sizeBytes }
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
      importId: normalizeString(options.importId) || `scripture-note-import-${uploadId}`,
      openaiFileIdRefs: [{
        name: fileName,
        mime_type: contentType,
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
  createScriptureNotesUpload,
  importScriptureNotesUpload
};
