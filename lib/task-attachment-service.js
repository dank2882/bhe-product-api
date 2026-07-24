"use strict";

const { createHash } = require("node:crypto");
const {
  assertCanReadTaskRecord,
  assertCanUpdateTaskRecord,
  getTaskActorFields
} = require("./task-management-access");

const MAX_TASK_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TTL_MS = 15 * 60 * 1000;
const RECORD_TYPES = new Set(["task", "project"]);
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp"
]);
const MIME_BY_EXTENSION = Object.freeze({
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
});

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createAttachmentError(message, statusCode, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function validateDocId(value, fieldName) {
  const id = normalizeString(value);
  if (!id || id.length > 500 || /[\/\0\r\n]/.test(id)) {
    throw createAttachmentError(`Invalid ${fieldName}`, 400, "invalid_task_attachment_parent", { fieldName });
  }
  return id;
}

function normalizeRecordType(value) {
  const recordType = normalizeString(value).toLowerCase();
  if (!RECORD_TYPES.has(recordType)) {
    throw createAttachmentError(
      "Attachment recordType must be task or project",
      400,
      "invalid_task_attachment_record_type",
      { recordType, allowedValues: [...RECORD_TYPES] }
    );
  }
  return recordType;
}

function resolveFileName(value) {
  const fileName = normalizeString(value);
  if (!fileName || fileName.length > 500 || /[\\/\0\r\n]/.test(fileName) || fileName === "." || fileName === "..") {
    throw createAttachmentError("The attachment filename is invalid", 400, "task_attachment_file_invalid");
  }
  const extension = fileName.includes(".") ? `.${fileName.split(".").at(-1).toLowerCase()}` : "";
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw createAttachmentError(
      "The attachment file type is not supported",
      400,
      "task_attachment_file_type_unsupported",
      { extension, allowedExtensions: [...ALLOWED_EXTENSIONS] }
    );
  }
  return { fileName, extension };
}

function getCollection(deps, name) {
  const collection = deps[name];
  if (!collection || typeof collection.doc !== "function") {
    throw createAttachmentError("Task attachment storage is not configured", 500, "task_attachment_storage_not_configured");
  }
  return collection;
}

async function getParent(recordType, recordId, deps) {
  const collection = getCollection(deps, recordType === "task" ? "tasksCollection" : "projectsCollection");
  const doc = await collection.doc(recordId).get();
  if (!doc.exists) {
    throw createAttachmentError(
      `${recordType === "task" ? "Task" : "Project"} not found`,
      404,
      `${recordType}_not_found`,
      { recordId }
    );
  }
  return { collection, doc, record: { ...(doc.data() || {}), [`${recordType}Id`]: recordId } };
}

function buildAttachmentSummary(attachment = {}, attachmentId = "") {
  return {
    attachmentId: normalizeString(attachment.attachmentId) || attachmentId,
    recordType: normalizeString(attachment.recordType),
    recordId: normalizeString(attachment.recordId),
    fileName: normalizeString(attachment.fileName),
    contentType: normalizeString(attachment.contentType),
    sizeBytes: Number(attachment.sizeBytes) || 0,
    checksumSha256: normalizeString(attachment.checksumSha256),
    description: normalizeString(attachment.description),
    uploadedBySub: normalizeString(attachment.uploadedBySub),
    uploadedByName: normalizeString(attachment.uploadedByName),
    uploadedByEmail: normalizeString(attachment.uploadedByEmail),
    createdAt: normalizeString(attachment.createdAt)
  };
}

async function downloadAttachmentReference(openaiFileIdRefs, deps = {}) {
  if (!Array.isArray(openaiFileIdRefs) || openaiFileIdRefs.length !== 1) {
    throw createAttachmentError(
      "Attach exactly one file",
      400,
      "task_attachment_file_required"
    );
  }
  const fileRef = openaiFileIdRefs[0] || {};
  const downloadLink = normalizeString(fileRef.download_link || fileRef.downloadLink);
  const { fileName, extension } = resolveFileName(fileRef.name || fileRef.file_name || "attached-file");
  if (!downloadLink) {
    throw createAttachmentError("The attached file does not have a download link", 400, "task_attachment_download_link_missing");
  }
  const fetchImpl = deps.fetchImpl || fetch;
  const response = await fetchImpl(downloadLink);
  if (!response.ok) {
    throw createAttachmentError(
      "The attached file could not be downloaded before its link expired",
      400,
      "task_attachment_download_failed"
    );
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (declaredLength > MAX_TASK_ATTACHMENT_BYTES) {
    throw createAttachmentError("The attached file exceeds the 25 MB limit", 413, "task_attachment_too_large", {
      maximumBytes: MAX_TASK_ATTACHMENT_BYTES,
      sizeBytes: declaredLength
    });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw createAttachmentError("The attached file is empty", 400, "task_attachment_empty");
  }
  if (buffer.length > MAX_TASK_ATTACHMENT_BYTES) {
    throw createAttachmentError("The attached file exceeds the 25 MB limit", 413, "task_attachment_too_large", {
      maximumBytes: MAX_TASK_ATTACHMENT_BYTES,
      sizeBytes: buffer.length
    });
  }
  const responseContentType = normalizeString(response.headers?.get?.("content-type")).split(";")[0];
  const declaredContentType = normalizeString(fileRef.mime_type || fileRef.mimeType).split(";")[0];
  return {
    buffer,
    fileName,
    contentType: declaredContentType || responseContentType || MIME_BY_EXTENSION[extension],
    sizeBytes: buffer.length,
    checksumSha256: createHash("sha256").update(buffer).digest("hex")
  };
}

async function attachTaskFile(input = {}, deps = {}) {
  const recordType = normalizeRecordType(input.recordType);
  const recordId = validateDocId(input.recordId, "recordId");
  const { record } = await getParent(recordType, recordId, deps);
  assertCanUpdateTaskRecord(record, {}, deps, recordType);

  const prepared = await downloadAttachmentReference(input.openaiFileIdRefs, deps);
  const attachmentsCollection = getCollection(deps, "taskAttachmentsCollection");
  if (!deps.taskAttachmentBucket || typeof deps.taskAttachmentBucket.file !== "function") {
    throw createAttachmentError("Task attachment file storage is not configured", 500, "task_attachment_bucket_not_configured");
  }
  const attachmentHash = createHash("sha256")
    .update(`${recordType}\n${recordId}\n${prepared.checksumSha256}`)
    .digest("hex")
    .slice(0, 32);
  const attachmentId = `attachment-${attachmentHash}`;
  const docRef = attachmentsCollection.doc(attachmentId);
  const existing = await docRef.get();
  if (existing.exists) {
    return { action: "existing", attachment: buildAttachmentSummary(existing.data() || {}, attachmentId) };
  }

  const storagePath = `task-management/${recordType}s/${encodeURIComponent(recordId)}/attachments/${attachmentId}/${encodeURIComponent(prepared.fileName)}`;
  await deps.taskAttachmentBucket.file(storagePath).save(prepared.buffer, {
    resumable: false,
    metadata: { contentType: prepared.contentType }
  });
  const actor = getTaskActorFields(deps);
  const createdAt = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
  const attachment = {
    attachmentId,
    parentKey: `${recordType}:${recordId}`,
    recordType,
    recordId,
    fileName: prepared.fileName,
    contentType: prepared.contentType,
    sizeBytes: prepared.sizeBytes,
    checksumSha256: prepared.checksumSha256,
    storagePath,
    description: normalizeString(input.description),
    uploadedBySub: actor.actorSub,
    uploadedByName: actor.actorName,
    uploadedByEmail: actor.actorEmail,
    createdAt
  };
  try {
    await docRef.create(attachment);
  } catch (error) {
    await deps.taskAttachmentBucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => {});
    throw error;
  }
  return { action: "attached", attachment: buildAttachmentSummary(attachment, attachmentId) };
}

async function loadParentForAttachment(input = {}, deps = {}) {
  const attachmentsCollection = getCollection(deps, "taskAttachmentsCollection");
  const attachmentId = validateDocId(input.attachmentId, "attachmentId");
  const doc = await attachmentsCollection.doc(attachmentId).get();
  if (!doc.exists) {
    throw createAttachmentError("Attachment not found", 404, "task_attachment_not_found", { attachmentId });
  }
  const attachment = doc.data() || {};
  const recordType = normalizeRecordType(attachment.recordType);
  const recordId = validateDocId(attachment.recordId, "recordId");
  const { record } = await getParent(recordType, recordId, deps);
  assertCanReadTaskRecord(record, deps, { recordType, recordId, attachmentId });
  return { attachmentId, attachment };
}

async function listTaskAttachments(input = {}, deps = {}) {
  const recordType = normalizeRecordType(input.recordType);
  const recordId = validateDocId(input.recordId, "recordId");
  const { record } = await getParent(recordType, recordId, deps);
  assertCanReadTaskRecord(record, deps, { recordType, recordId });
  const collection = getCollection(deps, "taskAttachmentsCollection");
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const query = typeof collection.where === "function"
    ? collection.where("parentKey", "==", `${recordType}:${recordId}`).limit(limit)
    : collection.limit(1000);
  const snapshot = await query.get();
  const attachments = snapshot.docs
    .map((doc) => buildAttachmentSummary(doc.data() || {}, doc.id))
    .filter((item) => item.recordType === recordType && item.recordId === recordId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  return { recordType, recordId, count: attachments.length, attachments };
}

async function getTaskAttachmentDownload(input = {}, deps = {}) {
  const { attachmentId, attachment } = await loadParentForAttachment(input, deps);
  if (!deps.taskAttachmentBucket || typeof deps.taskAttachmentBucket.file !== "function") {
    throw createAttachmentError("Task attachment file storage is not configured", 500, "task_attachment_bucket_not_configured");
  }
  const expiresAtMs = (typeof deps.nowMs === "function" ? Number(deps.nowMs()) : Date.now()) + DOWNLOAD_TTL_MS;
  const [url] = await deps.taskAttachmentBucket.file(attachment.storagePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAtMs,
    responseDisposition: `attachment; filename="${normalizeString(attachment.fileName).replace(/["\\]/g, "_")}"`
  });
  return {
    attachment: buildAttachmentSummary(attachment, attachmentId),
    download: { url, expiresAt: new Date(expiresAtMs).toISOString() }
  };
}

module.exports = {
  ALLOWED_EXTENSIONS,
  DOWNLOAD_TTL_MS,
  MAX_TASK_ATTACHMENT_BYTES,
  attachTaskFile,
  getTaskAttachmentDownload,
  listTaskAttachments
};
