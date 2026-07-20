const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BHE_API_KEY ||= "test-bhe-api-key";
process.env.OPENAI_API_KEY ||= "test-openai-api-key";

const {
  buildSermonWorkspaceOperationArguments,
  getSermonWorkspaceIdempotencyKey,
  buildDirectSermonPresentationActionError,
  buildDirectSermonPresentationActionResponse
} = require("../index");

test("dispatcher moves top-level ChatGPT file references into operation arguments", () => {
  const fileRefs = [{
    name: "edited-template.pptx",
    mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    download_link: "https://files.example.test/template"
  }];
  const result = buildSermonWorkspaceOperationArguments({
    operation: "importSermonPresentationTemplate",
    arguments: { seriesTitle: "Seasons of Life" },
    openaiFileIdRefs: fileRefs
  });

  assert.equal(result.seriesTitle, "Seasons of Life");
  assert.deepEqual(result.openaiFileIdRefs, fileRefs);
});

test("dispatcher hoists a misplaced nested idempotency key and removes it from operation arguments", () => {
  const body = {
    operation: "captureSermonDevelopmentTurn",
    arguments: {
      sermonId: "sermon-1",
      transcript: "Complete turn",
      idempotencyKey: "stable-capture-intent"
    }
  };

  assert.equal(getSermonWorkspaceIdempotencyKey(body), "stable-capture-intent");
  assert.deepEqual(buildSermonWorkspaceOperationArguments(body), {
    sermonId: "sermon-1",
    transcript: "Complete turn"
  });
});

test("direct sermon presentation Action response is flat and complete", () => {
  const response = buildDirectSermonPresentationActionResponse({
    requestId: "request-1",
    result: {
      operation: "createSermonPresentationFromLookup",
      result: {
        presentation: {
          presentationId: "presentation-1",
          sermonId: "sermon-1",
          title: "Living Free",
          status: "rendered",
          aspectRatio: "16:9",
          slideCount: 13,
          filename: "living-free.pptx",
          downloadUrl: "https://example.com/living-free.pptx",
          downloadUrlExpiresAt: "2026-07-18T00:00:00.000Z",
          templateId: "template-1"
        },
        template: {
          templateId: "template-1",
          name: "Default Sermon Slides"
        }
      },
      idempotency: {
        replayed: true,
        executionId: "execution-1"
      }
    }
  });

  assert.deepEqual(response, {
    ok: true,
    requestId: "request-1",
    operation: "createSermonPresentationFromLookup",
    presentationId: "presentation-1",
    sermonId: "sermon-1",
    title: "Living Free",
    status: "rendered",
    aspectRatio: "16:9",
    slideCount: 13,
    filename: "living-free.pptx",
    downloadUrl: "https://example.com/living-free.pptx",
    downloadUrlExpiresAt: "2026-07-18T00:00:00.000Z",
    templateId: "template-1",
    templateName: "Default Sermon Slides",
    idempotencyReplayed: true,
    executionId: "execution-1"
  });
  assert.equal(Object.hasOwn(response, "result"), false);
});

test("direct sermon presentation Action error is flat and structured", () => {
  const response = buildDirectSermonPresentationActionError({
    requestId: "request-2",
    operation: "createSermonPresentationFromLookup",
    error: {
      code: "SERMON_NOT_FOUND",
      message: "No sermon matched the lookup.",
      status: 404
    }
  });

  assert.deepEqual(response, {
    ok: false,
    requestId: "request-2",
    operation: "createSermonPresentationFromLookup",
    errorCode: "SERMON_NOT_FOUND",
    errorMessage: "No sermon matched the lookup.",
    errorStatus: 404
  });
});
