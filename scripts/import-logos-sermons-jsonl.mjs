#!/usr/bin/env node

import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  buildLogosSourceSummary,
  toLogosImportItem
} from "./lib/logos-sermon-import.mjs";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MIN_CHARS = 50;

function parseArgs(argv) {
  const args = {
    inFile: "",
    apiUrl: process.env.BHE_API_URL || "http://localhost:8080",
    apiKey: process.env.BHE_API_KEY || "",
    batchSize: DEFAULT_BATCH_SIZE,
    minChars: DEFAULT_MIN_CHARS,
    folderId: "",
    metadataOnly: false,
    receiptOut: "",
    rebuild: false,
    embed: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--in") args.inFile = next;
    else if (token === "--api-url") args.apiUrl = next;
    else if (token === "--api-key") args.apiKey = next;
    else if (token === "--batch-size") args.batchSize = Number.parseInt(next, 10);
    else if (token === "--min-chars") args.minChars = Number.parseInt(next, 10);
    else if (token === "--folder-id") args.folderId = next;
    else if (token === "--receipt-out") args.receiptOut = next;
    else if (token === "--metadata-only") args.metadataOnly = true;
    else if (token === "--rebuild") args.rebuild = true;
    else if (token === "--embed") args.embed = true;

    if (
      token.startsWith("--") &&
      next &&
      !next.startsWith("--") &&
      !["--metadata-only", "--rebuild", "--embed"].includes(token)
    ) {
      index += 1;
    }
  }

  args.batchSize = Number.isInteger(args.batchSize) && args.batchSize > 0
    ? Math.min(args.batchSize, 50)
    : DEFAULT_BATCH_SIZE;
  args.minChars = Number.isInteger(args.minChars) && args.minChars >= 0 ? args.minChars : DEFAULT_MIN_CHARS;
  return args;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

async function postBatch({ apiUrl, apiKey, items, rebuild, embed, batchSize }) {
  const endpoint = `${apiUrl.replace(/\/+$/, "")}/sermon-workspace/command`;
  const responses = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const argumentsValue = {
      items: batch,
      rebuildChunks: rebuild,
      embedChunks: embed
    };
    const idempotencyKey = `logos-metadata-reconcile-v1-${createHash("sha256")
      .update(JSON.stringify(argumentsValue))
      .digest("hex")
      .slice(0, 24)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        operation: "importSermonMaterialBatch",
        arguments: argumentsValue,
        idempotencyKey
      })
    });
    const data = await response.json().catch(() => ({}));
    const result = data.result || {};
    responses.push({ status: response.status, data, result, idempotencyKey });

    if (!response.ok || data.ok !== true) {
      throw new Error(`Batch POST failed: ${response.status} ${JSON.stringify(data)}`);
    }

    console.log(`[${Math.min(index + batch.length, items.length)}/${items.length}] posted batch status ${response.status}`);
    if (result.errorCount > 0) {
      console.log(JSON.stringify({
        batchStart: index,
        errorCount: result.errorCount || 0,
        errors: result.errors || []
      }, null, 2));
    }
  }

  return responses;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inFile) throw new Error("Missing --in <jsonl>.");
  if (!args.apiKey) throw new Error("Missing API key. Set BHE_API_KEY or pass --api-key.");

  const records = readJsonl(args.inFile);
  const isPostable = (record) =>
    (record.manuscriptText || "").trim().length >= args.minChars ||
    Boolean(args.metadataOnly && buildLogosSourceSummary(record));
  const postableRecords = records.filter(isPostable);
  const skippedRecords = records
    .filter((record) => !isPostable(record))
    .map((record) => ({ title: record.title, chars: (record.manuscriptText || "").trim().length }));
  const items = postableRecords.map((record) => toLogosImportItem(record, { folderId: args.folderId }));
  const responses = await postBatch({
    apiUrl: args.apiUrl,
    apiKey: args.apiKey,
    items,
    rebuild: args.rebuild,
    embed: args.embed,
    batchSize: args.batchSize
  });

  const receipt = {
    mode: "logos_sermon_reconciliation_receipt",
    generatedAt: new Date().toISOString(),
    sourceFile: args.inFile,
    inputRecords: records.length,
    postedRecords: items.length,
    skippedRecords,
    postedBatches: responses.length,
    requestedCount: responses.reduce(
      (total, response) => total + Number(response.data?.requestedCount || 0),
      0
    ),
    importedCount: responses.reduce(
      (total, response) => total + Number(response.data?.importedCount || 0),
      0
    ),
    errorCount: responses.reduce(
      (total, response) => total + Number(response.data?.errorCount || 0),
      0
    ),
    batches: responses.map((response, batchIndex) => ({
      batchIndex,
      status: response.status,
      ok: response.data?.ok === true,
      requestedCount: response.data?.requestedCount || 0,
      importedCount: response.data?.importedCount || 0,
      errorCount: response.data?.errorCount || 0,
      receiptSummary: response.data?.receiptSummary || {},
      results: response.data?.results || [],
      errors: response.data?.errors || []
    }))
  };
  if (args.receiptOut) {
    fs.mkdirSync(path.dirname(args.receiptOut), { recursive: true });
    fs.writeFileSync(args.receiptOut, JSON.stringify(receipt, null, 2) + "\n");
  }

  console.log(JSON.stringify({
    inputRecords: receipt.inputRecords,
    postedRecords: receipt.postedRecords,
    skippedRecords: receipt.skippedRecords,
    postedBatches: receipt.postedBatches,
    importedCount: receipt.importedCount,
    errorCount: receipt.errorCount,
    receiptOut: args.receiptOut
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
