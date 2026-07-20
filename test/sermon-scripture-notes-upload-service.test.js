"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  IMPORT_READ_TTL_MS,
  UPLOAD_TTL_MS,
  buildStoragePath,
  createScriptureNotesUpload,
  importScriptureNotesUpload
} = require("../lib/sermon-scripture-notes-upload-service");

function createFakeBucket({ size = "4096", metadataError = null, deleteError = null } = {}) {
  const calls = [];
  return {
    calls,
    file(storagePath) {
      return {
        async getSignedUrl(options) {
          calls.push(["signed-url", storagePath, options]);
          return [`https://storage.test/${options.action}/${encodeURIComponent(storagePath)}?expires=${options.expires}`];
        },
        async getMetadata() {
          calls.push(["metadata", storagePath]);
          if (metadataError) throw metadataError;
          return [{ size }];
        },
        async delete(options) {
          calls.push(["delete", storagePath, options]);
          if (deleteError) throw deleteError;
        }
      };
    }
  };
}

test("creates one short-lived, content-type-bound Scripture notes upload", async () => {
  const nowMs = 1784563200000;
  const bucket = createFakeBucket();
  const result = await createScriptureNotesUpload({
    fileName: "Psalm Notes.docx",
    idempotencyKey: "psalm-notes-upload"
  }, { bucket, nowMs: () => nowMs });

  assert.match(result.uploadId, /^scripture-notes-[a-f0-9]{32}-1784563200000$/);
  assert.equal(result.fileName, "Psalm Notes.docx");
  assert.equal(
    result.contentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert.equal(result.expiresAt, new Date(nowMs + UPLOAD_TTL_MS).toISOString());
  assert.equal(result.upload.method, "PUT");
  assert.deepEqual(result.upload.headers, { "Content-Type": result.contentType });
  assert.deepEqual(bucket.calls[0], [
    "signed-url",
    buildStoragePath(result.uploadId, "Psalm Notes.docx"),
    {
      version: "v4",
      action: "write",
      expires: nowMs + UPLOAD_TTL_MS,
      contentType: result.contentType
    }
  ]);
});

test("finalizes a staged upload through the idempotent existing importer and removes staging", async () => {
  const createdAtMs = 1784563200000;
  const uploadId = `scripture-notes-${"a".repeat(32)}-${createdAtMs}`;
  const bucket = createFakeBucket({ size: "5686" });
  const importCalls = [];
  const result = await importScriptureNotesUpload({
    uploadId,
    fileName: "Psalm Notes.docx",
    sourceLabel: "Logos export",
    compact: true,
    force: false,
    idempotencyKey: "psalm-notes-import"
  }, {
    bucket,
    nowMs: () => createdAtMs + 1000,
    runImport: async (input) => {
      importCalls.push(input);
      return { operation: "importScriptureNotes", result: { imported: 42 } };
    }
  });

  const storagePath = buildStoragePath(uploadId, "Psalm Notes.docx");
  assert.deepEqual(importCalls, [{
    idempotencyKey: "psalm-notes-import",
    arguments: {
      sourceLabel: "Logos export",
      compact: true,
      force: false,
      importId: `scripture-note-import-${uploadId}`,
      openaiFileIdRefs: [{
        name: "Psalm Notes.docx",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        download_link: `https://storage.test/read/${encodeURIComponent(storagePath)}?expires=${createdAtMs + IMPORT_READ_TTL_MS}`,
        file_id: uploadId
      }]
    }
  }]);
  assert.equal(result.result.imported, 42);
  assert.deepEqual(result.stagedUpload, {
    uploadId,
    fileName: "Psalm Notes.docx",
    sizeBytes: 5686,
    stagedFileDeleted: true
  });
  assert.deepEqual(bucket.calls.at(-1), ["delete", storagePath, { ignoreNotFound: true }]);
});

test("rejects unsafe filenames and unsupported extensions", async () => {
  const bucket = createFakeBucket();
  await assert.rejects(
    () => createScriptureNotesUpload({
      fileName: "../notes.docx",
      idempotencyKey: "invalid-file-name"
    }, { bucket }),
    (error) => error.code === "scripture_note_upload_file_invalid"
  );
  await assert.rejects(
    () => createScriptureNotesUpload({
      fileName: "..\\notes.docx",
      idempotencyKey: "invalid-windows-path"
    }, { bucket }),
    (error) => error.code === "scripture_note_upload_file_invalid"
  );
  await assert.rejects(
    () => createScriptureNotesUpload({
      fileName: "notes.pdf",
      idempotencyKey: "invalid-extension"
    }, { bucket }),
    (error) => error.code === "scripture_note_upload_file_invalid"
  );
});

test("rejects missing, oversized, and expired staged uploads", async () => {
  const createdAtMs = 1784563200000;
  const uploadId = `scripture-notes-${"b".repeat(32)}-${createdAtMs}`;
  const baseInput = {
    uploadId,
    fileName: "notes.txt",
    idempotencyKey: "finalize-notes"
  };

  await assert.rejects(
    () => importScriptureNotesUpload(baseInput, {
      bucket: createFakeBucket({ metadataError: { code: 404 } }),
      nowMs: () => createdAtMs + 1000,
      runImport: async () => ({})
    }),
    (error) => error.code === "scripture_note_upload_missing"
  );
  await assert.rejects(
    () => importScriptureNotesUpload(baseInput, {
      bucket: createFakeBucket({ size: String(10 * 1024 * 1024 + 1) }),
      nowMs: () => createdAtMs + 1000,
      runImport: async () => ({})
    }),
    (error) => error.code === "scripture_note_upload_too_large" && error.statusCode === 413
  );
  await assert.rejects(
    () => importScriptureNotesUpload(baseInput, {
      bucket: createFakeBucket(),
      nowMs: () => createdAtMs + IMPORT_READ_TTL_MS + 1,
      runImport: async () => ({})
    }),
    (error) => error.code === "scripture_note_upload_expired" && error.statusCode === 410
  );
});
