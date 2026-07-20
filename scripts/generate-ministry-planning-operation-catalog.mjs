import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CATALOG_HASH,
  CATALOG_VERSION,
  MINISTRY_PLANNING_OPERATIONS,
  OPERATION_MODES
} = require("../lib/ministry-planning-operation-registry");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outputArgument = args.find((argument) => !argument.startsWith("--"));
const outputPath = path.resolve(outputArgument || "docs/gpts/ministry-planning.operation-catalog.md");
const modeAction = {
  query: "runMinistryPlanningQuery",
  command: "runMinistryPlanningCommand"
};

const lines = [
  "# Ministry Planning Operation Catalog",
  "",
  "This generated file is a local review artifact. The Custom GPT reads the live catalog through `listMinistryPlanningOperations`; do not upload this file as GPT Knowledge.",
  "",
  "## Routing Rules",
  "",
  "1. Use `runMinistryPlanningQuery` for every read-only operation.",
  "2. Use `runMinistryPlanningCommand` for requested durable changes and spreadsheet syncs.",
  "3. Send the catalog name in `operation` and inputs in `arguments`.",
  "4. Do not ask for separate permission before queries, creates, merges, updates, feedback saves, or an explicitly requested sync.",
  "5. Ask once only before a permanent delete or full-document replacement, then send `confirmed: true`.",
  "6. Send one stable `idempotencyKey` per command intent and reuse it only to retry that intent.",
  "7. Never ask Dan to read back a generated `sourceImportId`; `syncMusicPlanningSpreadsheet` resolves it internally.",
  "",
  `Catalog version: \`${CATALOG_VERSION}\``,
  "",
  `Catalog hash: \`${CATALOG_HASH}\``,
  "",
  `The registry currently exposes ${MINISTRY_PLANNING_OPERATIONS.length} operations.`,
  ""
];

for (const mode of OPERATION_MODES) {
  lines.push(`## ${mode[0].toUpperCase()}${mode.slice(1)} Operations`, "");
  lines.push(`Use \`${modeAction[mode]}\` for every operation in this section.`, "");

  for (const operation of MINISTRY_PLANNING_OPERATIONS.filter((item) => item.mode === mode)) {
    lines.push(`### ${operation.name}`, "", operation.summary, "");
    lines.push(`Required: ${operation.required.length ? operation.required.map((item) => `\`${item}\``).join(", ") : "none"}`, "");
    lines.push(`Optional: ${operation.optional.length ? operation.optional.map((item) => `\`${item}\``).join(", ") : "none"}`, "");
    lines.push(`Confirmation policy: \`${operation.confirmationPolicy}\``, "");
    if (operation.argumentGuidance) lines.push(`Argument guidance: ${operation.argumentGuidance}`, "");
    lines.push("```json", JSON.stringify({ operation: operation.name, arguments: operation.exampleArguments }, null, 2), "```", "");
  }
}

const content = `${lines.join("\n")}\n`;
if (checkOnly) {
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (existing !== content) {
    console.error(`Operation catalog is stale: ${outputPath}`);
    process.exitCode = 1;
  } else {
    console.log(`Operation catalog is current: ${CATALOG_VERSION}`);
  }
} else {
  fs.writeFileSync(outputPath, content);
  console.log(`Wrote ${MINISTRY_PLANNING_OPERATIONS.length} operations (${CATALOG_VERSION}) to ${outputPath}`);
}
