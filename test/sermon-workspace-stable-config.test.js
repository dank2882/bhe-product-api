const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const LOCK_PATH = path.join(ROOT_DIR, "docs/gpts/sermon-workspace.stable-config.json");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

test("frozen Custom GPT schema and instructions match the compatibility contract", () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  const schemaBuffer = read(lock.schema.path);
  const instructionsBuffer = read(lock.instructions.path);
  const schema = JSON.parse(schemaBuffer.toString("utf8"));
  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  const operationIds = [];

  for (const pathItem of Object.values(schema.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (methods.has(method) && operation?.operationId) {
        operationIds.push(operation.operationId);
      }
    }
  }

  assert.equal(schema.openapi, lock.schema.openapi);
  assert.equal(schema.info.version, lock.schema.apiVersion);
  assert.equal(sha256(schemaBuffer), lock.schema.sha256);
  assert.deepEqual(operationIds, lock.schema.operationIds);
  assert.equal(instructionsBuffer.length, lock.instructions.bytes);
  assert.ok(instructionsBuffer.length <= lock.instructions.maximumBytes);
  assert.equal(sha256(instructionsBuffer), lock.instructions.sha256);
  const instructions = instructionsBuffer.toString("utf8");
  assert.match(instructions, /Treat "development mode,"/);
  assert.match(instructions, /captureSermonDevelopmentTurn/);
  assert.match(instructions, /assistantTranscript/);
  assert.match(instructions, /initialTranscript/);
  assert.match(instructions, /\{\{sermonTitle\}\}/);
  assert.match(instructions, /Never call `saveSermonDevelopmentCheckpoint` during an active session/);
  assert.match(instructions, /Unapproved Chat turns are audit-only/);
  assert.match(instructions, /finalizeSermonDevelopmentSession/);
  assert.match(instructions, /expectedDanTurnCount/);
  assert.match(instructions, /completionReceipt/);
});

test("direct PowerPoint Action uses a strongly typed flat request contract", () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  const schema = JSON.parse(read(lock.schema.path).toString("utf8"));
  const operation = schema.paths?.["/sermon-presentations/from-lookup"]?.post;
  const requestSchema = operation?.requestBody?.content?.["application/json"]?.schema;

  assert.equal(operation?.operationId, "runSermonSlides");
  assert.equal(requestSchema?.type, "object");
  assert.equal(requestSchema?.additionalProperties, false);
  assert.deepEqual(requestSchema?.required, ["title", "idempotencyKey"]);
  assert.equal(requestSchema?.properties?.dateField?.default, "either");
  assert.deepEqual(requestSchema?.properties?.dateField?.enum, [
    "either",
    "preachedDate",
    "targetDate"
  ]);
  assert.equal(requestSchema?.properties?.compact?.type, "boolean");
  assert.equal(
    operation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
    "#/components/schemas/SermonPresentationActionResponse"
  );
  const responseSchema = schema.components?.schemas?.SermonPresentationActionResponse;
  assert.equal(responseSchema?.type, "object");
  assert.equal(responseSchema?.additionalProperties, false);
  assert.equal(responseSchema?.properties?.presentationId?.type, "string");
  assert.equal(responseSchema?.properties?.slideCount?.type, "integer");
  assert.equal(responseSchema?.properties?.downloadUrl?.format, "uri");
  assert.equal(responseSchema?.properties?.openaiFileResponse?.type, "array");
  assert.equal(responseSchema?.properties?.openaiFileResponse?.items?.format, "uri");
  assert.equal(
    schema.components?.schemas?.DispatchResponse?.properties?.openaiFileResponse?.type,
    "array"
  );
  assert.equal(
    schema.components?.schemas?.DispatchRequest?.properties?.openaiFileIdRefs?.type,
    "array"
  );
  assert.ok(lock.schema.operationIds.length <= 30);
});
