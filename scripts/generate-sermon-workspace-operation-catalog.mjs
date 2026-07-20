import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CATALOG_HASH,
  CATALOG_VERSION,
  OPERATION_MODES,
  SERMON_WORKSPACE_OPERATIONS
} = require("../lib/sermon-workspace-operation-registry");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outputArgument = args.find((argument) => !argument.startsWith("--"));
const outputPath = path.resolve(
  outputArgument || "docs/gpts/sermon-workspace.operation-catalog.md"
);

const modeAction = {
  query: "runSermonWorkspaceQuery",
  artifact: "runSermonWorkspaceArtifact",
  command: "runSermonWorkspaceCommand"
};

const lines = [
  "# Sermon Workspace Operation Catalog",
  "",
  "Upload this file as Custom GPT knowledge. It documents backend operations routed through four stable OpenAPI Actions. The knowledge file describes operations; the dispatcher Actions execute them.",
  "",
  "## Routing Rules",
  "",
  "1. Use `listSermonWorkspaceOperations` when the correct operation or arguments are unclear.",
  "2. Use `runSermonWorkspaceQuery` for read-only retrieval and analysis.",
  "3. Use `runSermonWorkspaceArtifact` for downloadable generated artifacts.",
  "4. Use `runSermonWorkspaceCommand` for creates, imports, appends, updates, indexing, and other durable changes.",
  "5. Send the catalog operation name in `operation` and its inputs inside `arguments`.",
  "6. Never invent operation names. If an operation is unknown, retrieve the live catalog.",
  "7. For artifact and command operations, send a stable `idempotencyKey` for one user intent and reuse it only when retrying that same intent.",
  "",
  "Dispatcher request shape:",
  "",
  "```json",
  "{",
  "  \"operation\": \"listSermons\",",
  "  \"arguments\": {",
  "    \"query\": \"Living Free\",",
  "    \"limit\": 10",
  "  }",
  "}",
  "```",
  "",
  `Catalog version: \`${CATALOG_VERSION}\``,
  "",
  `Catalog hash: \`${CATALOG_HASH}\``,
  "",
  `The registry currently exposes ${SERMON_WORKSPACE_OPERATIONS.length} operations. Adding registry operations does not add OpenAPI operations.`,
  ""
];

for (const mode of OPERATION_MODES) {
  const operations = SERMON_WORKSPACE_OPERATIONS.filter(
    (operation) => operation.mode === mode
  );
  lines.push(`## ${mode[0].toUpperCase()}${mode.slice(1)} Operations`);
  lines.push("");
  lines.push(`Use \`${modeAction[mode]}\` for every operation in this section.`);
  lines.push("");

  for (const operation of operations) {
    lines.push(`### ${operation.name}`);
    lines.push("");
    lines.push(operation.summary);
    lines.push("");
    lines.push(`Required: ${operation.required.length ? operation.required.map((item) => `\`${item}\``).join(", ") : "none"}`);
    lines.push("");
    lines.push(`Optional: ${operation.optional.length ? operation.optional.map((item) => `\`${item}\``).join(", ") : "none"}`);
    lines.push("");
    if (operation.argumentGuidance) {
      lines.push(`Argument guidance: ${operation.argumentGuidance}`);
      lines.push("");
    }
    lines.push("```json");
    lines.push(JSON.stringify({
      operation: operation.name,
      arguments: operation.exampleArguments
    }, null, 2));
    lines.push("```");
    lines.push("");
  }
}

lines.push("## Specialized Direct Actions");
lines.push("");
lines.push("These workflows remain direct OpenAPI Actions because they include specialized voice launch, storage, download, transcription, or server-side manuscript orchestration:");
lines.push("");
lines.push("- `createSermonWalkSession`");
lines.push("- `runSermonSlides`");
lines.push("- `createSermonManuscriptDraft`");
lines.push("- `transcribeSermonMedia`");
lines.push("- `createSermonMediaUploadUrl`");
lines.push("- `importSermonMediaFromUrl`");
lines.push("");

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
  console.log(`Wrote ${SERMON_WORKSPACE_OPERATIONS.length} operations (${CATALOG_VERSION}) to ${outputPath}`);
}
