"use strict";

const { createHash } = require("node:crypto");
const JSZip = require("jszip");

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_SCRIPTURE_NOTE_IMPORT_BYTES = 10 * 1024 * 1024;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeXmlEntities(value = "") {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function extractTextFromDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    const error = new Error("The Word document does not contain word/document.xml");
    error.statusCode = 400;
    error.code = "scripture_note_docx_invalid";
    throw error;
  }
  const xml = await documentFile.async("string");
  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  return paragraphs.map((paragraph) => {
    const text = Array.from(paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
      .map((match) => decodeXmlEntities(match[1]))
      .join("");
    return text.trim();
  }).join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

async function prepareScriptureNoteImportFile({
  openaiFileIdRefs,
  fetchImpl = fetch,
  maximumBytes = MAX_SCRIPTURE_NOTE_IMPORT_BYTES
} = {}) {
  if (!Array.isArray(openaiFileIdRefs) || openaiFileIdRefs.length !== 1) {
    const error = new Error("Attach exactly one Word or plain-text Scripture notes file");
    error.statusCode = 400;
    error.code = "scripture_note_import_file_required";
    throw error;
  }
  const fileRef = openaiFileIdRefs[0] || {};
  const downloadLink = normalizeString(fileRef.download_link || fileRef.downloadLink);
  const originalFilename = normalizeString(fileRef.name) || "scripture-notes.txt";
  const contentType = normalizeString(fileRef.mime_type || fileRef.mimeType);
  const isDocx = /\.docx$/i.test(originalFilename) || contentType === DOCX_CONTENT_TYPE;
  const isText = /\.(?:txt|md)$/i.test(originalFilename) || /^text\//i.test(contentType);
  if (!downloadLink || (!isDocx && !isText)) {
    const error = new Error("The attached Scripture notes file must be .docx, .txt, or .md");
    error.statusCode = 400;
    error.code = "scripture_note_import_file_invalid";
    throw error;
  }
  const response = await fetchImpl(downloadLink);
  if (!response.ok) {
    const error = new Error("The attached Scripture notes file could not be downloaded before its link expired");
    error.statusCode = 400;
    error.code = "scripture_note_import_file_download_failed";
    throw error;
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (declaredLength > maximumBytes) {
    const error = new Error("The attached Scripture notes file is too large");
    error.statusCode = 413;
    error.code = "scripture_note_import_file_too_large";
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maximumBytes) {
    const error = new Error("The attached Scripture notes file is too large");
    error.statusCode = 413;
    error.code = "scripture_note_import_file_too_large";
    throw error;
  }
  const text = isDocx ? await extractTextFromDocx(buffer) : buffer.toString("utf8");
  if (!normalizeString(text)) {
    const error = new Error("The attached Scripture notes file did not contain readable text");
    error.statusCode = 400;
    error.code = "scripture_note_import_file_empty";
    throw error;
  }
  return {
    buffer,
    text,
    originalFilename,
    contentType: contentType || (isDocx ? DOCX_CONTENT_TYPE : "text/plain"),
    sizeBytes: buffer.length,
    checksumSha256: createHash("sha256").update(buffer).digest("hex")
  };
}

module.exports = {
  DOCX_CONTENT_TYPE,
  MAX_SCRIPTURE_NOTE_IMPORT_BYTES,
  extractTextFromDocx,
  prepareScriptureNoteImportFile
};
