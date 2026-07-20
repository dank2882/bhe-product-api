import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Firestore } from "@google-cloud/firestore";

const require = createRequire(import.meta.url);
const {
  CATALOG_HASH,
  CATALOG_VERSION
} = require("../lib/ministry-planning-operation-registry");

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const projectId = process.env.GCP_PROJECT_ID || "location-map-985";
const databaseId = process.env.FIRESTORE_DATABASE_ID || "chatgptstorage";
const rootDir = path.resolve(import.meta.dirname, "..");
const sources = {
  operatorGuidance: "docs/gpts/worship-service-slice18.builder-instructions.md",
  workflow: "docs/gpts/worship-service-slice18.workflow.md",
  songPlanning: "docs/gpts/ministry-planning-data-model.md",
  serviceOrder: "docs/gpts/service-order-data-model.md",
  pianoPlanning: "docs/gpts/piano-planning-data-model.md"
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const documents = Object.fromEntries(Object.entries(sources).map(([section, relativePath]) => {
  const content = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  return [section, {
    section,
    sourceFile: relativePath,
    contentType: "text/markdown",
    sha256: sha256(content),
    content
  }];
}));
const configFingerprint = sha256(JSON.stringify({
  catalogHash: CATALOG_HASH,
  documents: Object.fromEntries(Object.entries(documents).map(([section, document]) => [section, document.sha256]))
}));
const now = new Date().toISOString();
const record = {
  configId: "default",
  schemaVersion: "ministry-planning-runtime-config-v1",
  configVersion: `1-${configFingerprint.slice(0, 12)}`,
  catalogVersion: CATALOG_VERSION,
  catalogHash: CATALOG_HASH,
  documents,
  updatedAt: now,
  updatedBy: "sync-ministry-planning-config"
};

console.log(JSON.stringify({
  mode: commit ? "commit" : "preview",
  projectId,
  databaseId,
  configId: record.configId,
  configVersion: record.configVersion,
  catalogVersion: record.catalogVersion,
  sections: Object.fromEntries(Object.entries(documents).map(([section, document]) => [section, {
    sourceFile: document.sourceFile,
    bytes: Buffer.byteLength(document.content, "utf8"),
    sha256: document.sha256
  }]))
}, null, 2));

if (commit) {
  const db = new Firestore({ projectId, databaseId });
  await db.collection("ministryPlanningConfig").doc(record.configId).set(record);
  const verification = await db.collection("ministryPlanningConfig").doc(record.configId).get();
  if (!verification.exists || verification.data()?.configVersion !== record.configVersion) {
    throw new Error("Ministry planning config verification failed");
  }
  console.log(`Committed and verified ministryPlanningConfig/${record.configId}`);
}
