"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  IMPORT_READ_TTL_MS,
  UPLOAD_TTL_MS,
  buildStoragePath,
  createPresentationTemplateUpload,
  importPresentationTemplateUpload
} = require("../lib/sermon-presentation-template-upload-service");

const PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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

test("creates one short-lived, content-type-bound PowerPoint upload", async () => {
  const nowMs = 1784563200000;
  const bucket = createFakeBucket();
  const result = await createPresentationTemplateUpload({
    fileName: "Seasons Template.pptx",
    idempotencyKey: "seasons-template-upload"
  }, { bucket, nowMs: () => nowMs });

  assert.match(result.uploadId, /^presentation-template-[a-f0-9]{32}-1784563200000$/);
  assert.equal(result.fileName, "Seasons Template.pptx");
  assert.equal(result.contentType, PPTX_CONTENT_TYPE);
  assert.equal(result.expiresAt, new Date(nowMs + UPLOAD_TTL_MS).toISOString());
  assert.equal(result.upload.method, "PUT");
  assert.deepEqual(result.upload.headers, { "Content-Type": PPTX_CONTENT_TYPE });
  assert.deepEqual(bucket.calls[0], [
    "signed-url",
    buildStoragePath(result.uploadId, "Seasons Template.pptx"),
    {
      version: "v4",
      action: "write",
      expires: nowMs + UPLOAD_TTL_MS,
      contentType: PPTX_CONTENT_TYPE
    }
  ]);
});

test("finalizes a staged PowerPoint through the existing idempotent template importer", async () => {
  const createdAtMs = 1784563200000;
  const uploadId = `presentation-template-${"a".repeat(32)}-${createdAtMs}`;
  const bucket = createFakeBucket({ size: "98765" });
  const importCalls = [];
  const result = await importPresentationTemplateUpload({
    uploadId,
    fileName: "Seasons Template.pptx",
    templateId: "template-seasons-v1",
    seriesTitle: "Seasons of Life",
    idempotencyKey: "seasons-template-import"
  }, {
    bucket,
    nowMs: () => createdAtMs + 1000,
    runImport: async (input) => {
      importCalls.push(input);
      return { operation: "importSermonPresentationTemplate", result: { action: "imported" } };
    }
  });

  const storagePath = buildStoragePath(uploadId, "Seasons Template.pptx");
  assert.deepEqual(importCalls, [{
    idempotencyKey: "seasons-template-import",
    arguments: {
      templateId: "template-seasons-v1",
      seriesTitle: "Seasons of Life",
      openaiFileIdRefs: [{
        name: "Seasons Template.pptx",
        mime_type: PPTX_CONTENT_TYPE,
        download_link: `https://storage.test/read/${encodeURIComponent(storagePath)}?expires=${createdAtMs + IMPORT_READ_TTL_MS}`,
        file_id: uploadId
      }]
    }
  }]);
  assert.equal(result.result.action, "imported");
  assert.deepEqual(result.stagedUpload, {
    uploadId,
    fileName: "Seasons Template.pptx",
    sizeBytes: 98765,
    stagedFileDeleted: true
  });
  assert.deepEqual(bucket.calls.at(-1), ["delete", storagePath, { ignoreNotFound: true }]);
});

test("rejects unsafe filenames and unsupported extensions", async () => {
  const bucket = createFakeBucket();
  for (const fileName of ["../template.pptx", "..\\template.pptx", "template.ppt", "template.pdf"]) {
    await assert.rejects(
      () => createPresentationTemplateUpload({
        fileName,
        idempotencyKey: "invalid-template-file"
      }, { bucket }),
      (error) => error.code === "presentation_template_upload_file_invalid"
    );
  }
});

test("rejects missing, oversized, and expired staged PowerPoints", async () => {
  const createdAtMs = 1784563200000;
  const uploadId = `presentation-template-${"b".repeat(32)}-${createdAtMs}`;
  const baseInput = {
    uploadId,
    fileName: "template.pptx",
    seriesTitle: "Test Series",
    idempotencyKey: "finalize-template"
  };

  await assert.rejects(
    () => importPresentationTemplateUpload(baseInput, {
      bucket: createFakeBucket({ metadataError: { code: 404 } }),
      nowMs: () => createdAtMs + 1000,
      runImport: async () => ({})
    }),
    (error) => error.code === "presentation_template_upload_missing"
  );
  await assert.rejects(
    () => importPresentationTemplateUpload(baseInput, {
      bucket: createFakeBucket({ size: String(10 * 1024 * 1024 + 1) }),
      nowMs: () => createdAtMs + 1000,
      runImport: async () => ({})
    }),
    (error) => error.code === "presentation_template_upload_too_large" && error.statusCode === 413
  );
  await assert.rejects(
    () => importPresentationTemplateUpload(baseInput, {
      bucket: createFakeBucket(),
      nowMs: () => createdAtMs + IMPORT_READ_TTL_MS + 1,
      runImport: async () => ({})
    }),
    (error) => error.code === "presentation_template_upload_expired" && error.statusCode === 410
  );
});
