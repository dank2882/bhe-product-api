const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  CATALOG_HASH,
  CATALOG_VERSION,
  SERMON_WORKSPACE_OPERATIONS,
  buildSermonWorkspaceOperationError,
  listSermonWorkspaceOperations,
  runSermonWorkspaceOperation
} = require("../lib/sermon-workspace-operation-registry");

const ROOT_DIR = path.resolve(__dirname, "..");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }

  async get() {
    return {
      exists: this.store.has(this.id),
      data: () => clone(this.store.get(this.id))
    };
  }

  async create(data) {
    this.store.set(this.id, clone(data));
  }

  async set(data) {
    this.store.set(this.id, clone(data));
  }
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
  }

  doc(id) {
    return new FakeDocRef(this.store, id);
  }

  limit(maxDocs) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries())
          .slice(0, maxDocs)
          .map(([id, data]) => ({
            id,
            data: () => clone(data)
          }))
      })
    };
  }
}

function createDeps() {
  return {
    sermonsCollection: new FakeCollection({
      "sermon-living-free": {
        sermonId: "sermon-living-free",
        title: "Living Free",
        status: "preached",
        scriptureText: "John 8:31-36",
        bigIdea: "The Son makes believers free indeed.",
        outline: "1. Continue in truth\n2. Know the truth\n3. Live free",
        updatedAt: "2026-07-01T17:00:00.000Z"
      }
    }),
    sermonOccasionsCollection: new FakeCollection(),
    sermonDevelopmentSessionsCollection: new FakeCollection(),
    sermonDevelopmentCheckpointsCollection: new FakeCollection(),
    sermonPresentationTemplatesCollection: new FakeCollection(),
    sermonPresentationsCollection: new FakeCollection(),
    renderSermonPresentationPptx: async () => Buffer.from("pptx"),
    uploadSermonPresentationPptx: async ({ presentationId }) => ({
      filename: "living-free.pptx",
      storagePath: `sermon-presentations/${presentationId}.pptx`,
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 4,
      downloadUrl: `https://example.test/${presentationId}.pptx`,
      expiresAt: "2026-07-08T17:00:00.000Z"
    }),
    importSermonPresentationTemplatePptx: async () => ({
      originalFilename: "edited-template.pptx",
      storagePath: "sermon-presentation-templates/edited-template.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 200,
      checksumSha256: "b".repeat(64),
      aspectRatio: "16:9",
      theme: {
        fonts: { heading: "Georgia", body: "Arial" },
        colors: {
          background: "112233",
          surface: "223344",
          primary: "D4AF37",
          text: "FFFFFF",
          muted: "CCCCCC",
          accent: "4A8F8F"
        }
      },
      layouts: { title: { titleSize: 48 } },
      extraction: { backgroundSource: "first_slide" }
    }),
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-01T17:00:00.000Z"
  };
}

test("catalog exposes more backend operations than the Custom GPT action limit", () => {
  assert.ok(SERMON_WORKSPACE_OPERATIONS.length > 30);

  const catalog = listSermonWorkspaceOperations();
  assert.equal(catalog.count, SERMON_WORKSPACE_OPERATIONS.length);
  assert.deepEqual(catalog.modes, ["query", "artifact", "command"]);
  assert.ok(catalog.operations.some(({ operation }) => operation === "listSermons"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "createSermonPresentation"));
  const dashboard = catalog.operations.find(({ operation }) => operation === "buildPreachingPreparationDashboard");
  assert.ok(dashboard);
  assert.deepEqual(dashboard.exampleArguments, { limit: 12 });
  assert.ok(dashboard.optional.includes("asOfDate"));
  assert.ok(!dashboard.optional.includes("date"));
  assert.match(dashboard.argumentGuidance, /send only limit: 12/i);
  assert.match(dashboard.argumentGuidance, /authoritative Firestore/i);
  assert.ok(catalog.operations.some(({ operation }) => operation === "selectSermonForOccasion"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "getPreachingProfileBaselineReadiness"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "proposePreachingProfileBaseline"));
  const applyPreachingProfileBaseline = catalog.operations.find(
    ({ operation }) => operation === "applyPreachingProfileBaseline"
  );
  assert.ok(applyPreachingProfileBaseline);
  assert.ok(applyPreachingProfileBaseline.required.includes("expectedVersion"));
  assert.ok(applyPreachingProfileBaseline.required.includes("sourceFingerprint"));
  const updatePreachingProfile = catalog.operations.find(
    ({ operation }) => operation === "updatePreachingProfile"
  );
  assert.deepEqual(updatePreachingProfile.required, ["changes", "expectedVersion"]);
  const ministryArchive = catalog.operations.find(({ operation }) => operation === "reviewSermonMinistryArchive");
  assert.ok(ministryArchive);
  assert.deepEqual(ministryArchive.required, ["tag"]);
  assert.match(ministryArchive.argumentGuidance, /Canonical sermon tags control membership/);
  assert.match(ministryArchive.argumentGuidance, /recommendationReadiness\.ready/);
  assert.ok(catalog.operations.some(({ operation }) => operation === "finalizeSermonDevelopmentSession"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "importScriptureNotes"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "getPersonalScriptureCommentary"));
  const startSession = catalog.operations.find(({ operation }) => operation === "startSermonDevelopmentSession");
  assert.deepEqual(startSession.required, ["sermonId", "initialTranscript", "assistantTranscript"]);
  const finalizeSession = catalog.operations.find(({ operation }) => operation === "finalizeSermonDevelopmentSession");
  assert.deepEqual(finalizeSession.required, [
    "sessionId",
    "expectedDanTurnCount",
    "finalTranscript",
    "assistantTranscript"
  ]);
  assert.ok(!catalog.operations.some(({ operation }) => operation === "createSermonFolder"));
  assert.ok(!catalog.operations.some(({ operation }) => operation === "listSermonFolders"));
  assert.equal(catalog.catalogVersion, CATALOG_VERSION);
  assert.equal(catalog.catalogHash, CATALOG_HASH);
});

test("uploaded catalog and dispatcher schema match the live registry contract", () => {
  const catalog = fs.readFileSync(
    path.join(ROOT_DIR, "docs/gpts/sermon-workspace.operation-catalog.md"),
    "utf8"
  );
  const schema = JSON.parse(fs.readFileSync(
    path.join(ROOT_DIR, "docs/gpts/sermon-workspace.schema.dispatcher-upload.json"),
    "utf8"
  ));
  const operationIds = Object.values(schema.paths)
    .flatMap((pathItem) => Object.values(pathItem))
    .map((operation) => operation.operationId)
    .filter(Boolean);

  assert.match(catalog, new RegExp("Catalog version: `" + CATALOG_VERSION + "`"));
  assert.match(catalog, new RegExp(CATALOG_HASH));
  assert.match(catalog, new RegExp(`currently exposes ${SERMON_WORKSPACE_OPERATIONS.length} operations`));
  assert.deepEqual(operationIds, [
    "listSermonWorkspaceOperations",
    "runSermonWorkspaceQuery",
    "runSermonWorkspaceArtifact",
    "runSermonSlides",
    "runSermonWorkspaceCommand",
    "createSermonWalkSession",
    "createSermonManuscriptDraft",
    "transcribeSermonMedia",
    "createSermonMediaUploadUrl",
    "importSermonMediaFromUrl"
  ]);
  assert.equal(
    schema.components.schemas.DispatchRequest.properties.idempotencyKey.maxLength,
    200
  );
  assert.equal(
    schema.components.schemas.DispatchRequest.properties.openaiFileIdRefs.type,
    "array"
  );
});

test("direct Custom GPT upload schema stays within the 30-operation limit", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(ROOT_DIR, "docs/gpts/sermon-workspace.schema.upload.json"),
    "utf8"
  ));
  const operationIds = Object.values(schema.paths || {})
    .flatMap((pathItem) => Object.entries(pathItem || {}))
    .filter(([method, operation]) =>
      ["get", "post", "put", "patch", "delete"].includes(method) && operation?.operationId)
    .map(([, operation]) => operation.operationId);

  assert.ok(operationIds.length <= 30, `Custom GPT schema has ${operationIds.length} operations`);
  assert.ok(operationIds.includes("createSermonWalkSession"));
  assert.ok(operationIds.includes("createSermonManuscriptDraft"));
});

test("query dispatcher runs sermon search through the operation registry", async () => {
  const response = await runSermonWorkspaceOperation(
    {
      mode: "query",
      operation: "listSermons",
      arguments: { query: "Living Free", limit: 10 }
    },
    createDeps()
  );

  assert.equal(response.operation, "listSermons");
  assert.equal(response.result.count, 1);
  assert.equal(response.result.sermons[0].sermonId, "sermon-living-free");
});

test("artifact dispatcher creates a compact editable PowerPoint result", async () => {
  const response = await runSermonWorkspaceOperation(
    {
      mode: "artifact",
      operation: "createSermonPresentation",
      arguments: { sermonId: "sermon-living-free" }
    },
    createDeps()
  );

  assert.equal(response.result.presentation.status, "rendered");
  assert.equal(response.result.presentation.aspectRatio, "16:9");
  assert.match(response.result.presentation.downloadUrl, /\.pptx$/);
  assert.equal(Object.prototype.hasOwnProperty.call(response.result.presentation, "slidePlan"), false);
});

test("command dispatcher imports an attached PPTX as a reusable template", async () => {
  const response = await runSermonWorkspaceOperation(
    {
      mode: "command",
      operation: "importSermonPresentationTemplate",
      arguments: {
        seriesTitle: "Seasons of Life",
        openaiFileIdRefs: [{ name: "edited-template.pptx", download_link: "https://files.test/pptx" }]
      }
    },
    createDeps()
  );

  assert.equal(response.result.action, "imported");
  assert.equal(response.result.template.seriesTitle, "Seasons of Life");
  assert.equal(response.result.template.version, 1);
  assert.equal(response.result.template.sourceFilename, "edited-template.pptx");
});

test("dispatcher rejects unknown operations and mode mismatches", async () => {
  await assert.rejects(
    () => runSermonWorkspaceOperation(
      { mode: "query", operation: "notARealOperation", arguments: {} },
      createDeps()
    ),
    { code: "unknown_operation", statusCode: 404 }
  );

  await assert.rejects(
    () => runSermonWorkspaceOperation(
      {
        mode: "query",
        operation: "createSermonPresentation",
        arguments: { sermonId: "sermon-living-free" }
      },
      createDeps()
    ),
    { code: "operation_mode_mismatch", statusCode: 400 }
  );
});

test("operation errors are serialized for a successful HTTP action response", () => {
  const error = Object.assign(new Error("Sermon not found"), {
    code: "sermon_not_found",
    statusCode: 404,
    details: { sermonId: "missing" }
  });

  const response = buildSermonWorkspaceOperationError(error, {
    mode: "query",
    operation: "getSermon",
    requestId: "request-123"
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.status, 404);
  assert.equal(response.error.code, "sermon_not_found");
  assert.equal(response.requestId, "request-123");
  assert.equal(response.error.requestId, "request-123");
});
