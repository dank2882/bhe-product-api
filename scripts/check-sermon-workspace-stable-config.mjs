import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = path.join(ROOT_DIR, "docs/gpts/sermon-workspace.stable-config.json");
const SCHEMA_PATH = "docs/gpts/sermon-workspace.schema.dispatcher-upload.json";
const INSTRUCTIONS_PATH = "docs/gpts/sermon-workspace.instructions.upload.md";
const MAX_INSTRUCTION_BYTES = 8000;
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const refresh = process.argv.includes("--refresh");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function getOperationIds(schema) {
  const operationIds = [];
  for (const pathItem of Object.values(schema.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (METHODS.has(method) && operation?.operationId) {
        operationIds.push(operation.operationId);
      }
    }
  }
  return operationIds;
}

const schemaBuffer = read(SCHEMA_PATH);
const instructionsBuffer = read(INSTRUCTIONS_PATH);
const schema = JSON.parse(schemaBuffer.toString("utf8"));
const current = {
  contractVersion: "1",
  purpose: "Keep the Custom GPT schema and instructions stable while backend operations and knowledge files continue to evolve.",
  schema: {
    path: SCHEMA_PATH,
    openapi: schema.openapi,
    apiVersion: schema.info?.version || "",
    sha256: sha256(schemaBuffer),
    operationIds: getOperationIds(schema)
  },
  instructions: {
    path: INSTRUCTIONS_PATH,
    maximumBytes: MAX_INSTRUCTION_BYTES,
    bytes: instructionsBuffer.length,
    sha256: sha256(instructionsBuffer)
  },
  updatableKnowledgeFiles: [
    "docs/gpts/sermon-workspace.operation-catalog.md",
    "docs/gpts/sermon-workspace.supplemental.md"
  ],
  compatibilityRules: [
    "Add normal backend capabilities as registry operations in query, artifact, or command mode.",
    "Use a specialized direct OpenAPI Action when stronger typing, file transport, reliability, latency, or confirmation behavior materially improves the workflow.",
    "Keep useful headroom under the 30-Action platform limit without treating a low Action count as an objective.",
    "Keep existing direct specialized actions backward compatible.",
    "Update the operation catalog when registry metadata changes.",
    "Update the supplemental knowledge file when workflows or preferences change.",
    "Change the frozen schema or instructions only for a true compatibility or security requirement."
  ]
};

if (instructionsBuffer.length > MAX_INSTRUCTION_BYTES) {
  console.error(`Instructions exceed ${MAX_INSTRUCTION_BYTES} bytes: ${instructionsBuffer.length}`);
  process.exit(1);
}

if (refresh) {
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Refreshed stable GPT contract ${schema.info?.version || ""}`);
  process.exit(0);
}

if (!fs.existsSync(LOCK_PATH)) {
  console.error(`Stable GPT contract is missing: ${LOCK_PATH}`);
  process.exit(1);
}

const locked = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
if (JSON.stringify(locked) !== JSON.stringify(current)) {
  console.error("Stable GPT schema or instructions changed without refreshing the compatibility contract.");
  console.error("Review the change. If it is truly required, run npm run sermon:refresh-stable-gpt-config.");
  process.exit(1);
}

console.log(
  `Stable GPT contract verified: schema ${current.schema.apiVersion}, ` +
  `${current.schema.operationIds.length} actions, ${current.instructions.bytes} instruction bytes`
);
