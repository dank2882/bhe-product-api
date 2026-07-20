#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://bhe-product-api-mwhc25pkra-uw.a.run.app";

function parseArgs(argv) {
  const options = {
    file: "",
    sourceLabel: "Logos Scripture Notes Export",
    idempotencyKey: "",
    baseUrl: process.env.SERMON_WORKSPACE_BASE_URL || DEFAULT_BASE_URL,
    concurrency: 4,
    batchSize: 20
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--file") options.file = argv[++index] || "";
    else if (argument === "--source-label") options.sourceLabel = argv[++index] || "";
    else if (argument === "--idempotency-key") options.idempotencyKey = argv[++index] || "";
    else if (argument === "--base-url") options.baseUrl = argv[++index] || "";
    else if (argument === "--concurrency") options.concurrency = Number(argv[++index]) || 4;
    else if (argument === "--batch-size") options.batchSize = Number(argv[++index]) || 20;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: BHE_API_KEY=... npm run sermon:import-scripture-notes -- --file PATH --idempotency-key KEY");
    return;
  }
  if (!process.env.BHE_API_KEY) throw new Error("BHE_API_KEY is required");
  if (!options.file) throw new Error("--file is required");
  if (!options.idempotencyKey) throw new Error("--idempotency-key is required");
  const absolutePath = path.resolve(options.file);
  const rawText = fs.readFileSync(absolutePath, "utf8");
  const startedAt = Date.now();
  const response = await fetch(`${options.baseUrl}/sermon-workspace/command`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": process.env.BHE_API_KEY
    },
    body: JSON.stringify({
      operation: "importScriptureNotes",
      idempotencyKey: options.idempotencyKey,
      arguments: {
        rawText,
        sourceLabel: options.sourceLabel,
        sourceType: "logos_notes",
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        compact: true
      }
    })
  });
  const responseText = await response.text();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (_error) {
    throw new Error(`Import returned non-JSON HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }
  console.log(JSON.stringify({
    httpStatus: response.status,
    durationMs: Date.now() - startedAt,
    ...json
  }, null, 2));
  if (!response.ok || json.ok !== true) process.exitCode = 1;
}

await main();
