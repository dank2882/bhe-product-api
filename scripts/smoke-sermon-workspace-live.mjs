#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "https://bhe-product-api-mwhc25pkra-uw.a.run.app";

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.SERMON_WORKSPACE_BASE_URL || DEFAULT_BASE_URL,
    apiKey: process.env.BHE_API_KEY || ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base-url") options.baseUrl = argv[++index] || "";
    else if (argument === "--api-key") options.apiKey = argv[++index] || "";
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

function assert(condition, message, details = {}) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function requestJson(baseUrl, path, { apiKey = "", method = "GET", body } = {}) {
  const headers = { accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_error) {
    throw new Error(`${method} ${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return { status: response.status, json };
}

async function runCheck(name, callback, results) {
  const startedAt = Date.now();
  try {
    const details = await callback();
    results.push({ name, ok: true, durationMs: Date.now() - startedAt, ...details });
  } catch (error) {
    results.push({
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      message: error.message,
      details: error.details || {}
    });
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: BHE_API_KEY=... npm run sermon:smoke-live [-- --base-url URL]");
    return;
  }
  assert(options.apiKey, "BHE_API_KEY is required for authenticated live smoke tests");

  const results = [];
  try {
    await runCheck("health", async () => {
      const { status, json } = await requestJson(options.baseUrl, "/health");
      assert(status === 200 && json.ok === true, "Health check failed", { status, json });
      return { maxImportedTextLength: json.capabilities?.sermonWorkspace?.maxImportedTextLength || 0 };
    }, results);

    await runCheck("catalog", async () => {
      const { status, json } = await requestJson(options.baseUrl, "/sermon-workspace/operations", {
        apiKey: options.apiKey
      });
      const operationNames = (json.operations || []).map((item) => item.operation);
      assert(status === 200 && json.ok === true, "Catalog request failed", { status, json });
      assert(operationNames.includes("listSermons"), "Catalog is missing listSermons");
      assert(operationNames.includes("buildPreachingPreparationDashboard"), "Catalog is missing the preaching dashboard");
      assert(operationNames.includes("selectSermonForOccasion"), "Catalog is missing scheduled sermon selection");
      assert(operationNames.includes("captureSermonDevelopmentTurn"), "Catalog is missing exact development-turn capture");
      assert(operationNames.includes("listSermonDevelopmentTurns"), "Catalog is missing development-turn retrieval");
      assert(operationNames.includes("finalizeSermonDevelopmentSession"), "Catalog is missing count-verified development finalization");
      assert(operationNames.includes("importScriptureNotes"), "Catalog is missing automatic Scripture note import");
      assert(operationNames.includes("getPersonalScriptureCommentary"), "Catalog is missing personal Scripture commentary retrieval");
      assert(operationNames.includes("createSermonPreachingPacket"), "Catalog is missing unified preaching packet creation");
      assert(operationNames.includes("getSermonPreachingPacket"), "Catalog is missing preaching packet retrieval");
      assert(operationNames.includes("startSermonTranscription"), "Catalog is missing durable transcription start");
      assert(operationNames.includes("getSermonTranscriptionJob"), "Catalog is missing transcription status retrieval");
      assert(operationNames.includes("importUnmatchedSermonRecording"), "Catalog is missing unmatched recording intake");
      assert(operationNames.includes("confirmUnmatchedSermonRecordingMatch"), "Catalog is missing recording match confirmation");
      assert(operationNames.includes("getSermonPostPreachingReflectionReadiness"), "Catalog is missing post-sermon reflection readiness");
      assert(operationNames.includes("proposeSermonPostPreachingReflection"), "Catalog is missing post-sermon reflection proposal");
      assert(operationNames.includes("applySermonPostPreachingReflection"), "Catalog is missing confirmed post-sermon reflection integration");
      return { catalogVersion: json.catalogVersion, operationCount: json.count };
    }, results);

    await runCheck("zero_result_query", async () => {
      const marker = `live-smoke-no-match-${randomUUID()}`;
      const { status, json } = await requestJson(options.baseUrl, "/sermon-workspace/query", {
        apiKey: options.apiKey,
        method: "POST",
        body: { operation: "listSermons", arguments: { query: marker, limit: 1 } }
      });
      assert(status === 200 && json.ok === true, "Zero-result query failed", { status, json });
      assert(json.result?.count === 0, "Zero-result query unexpectedly matched sermons", { result: json.result });
      return { requestId: json.requestId };
    }, results);

    await runCheck("structured_not_found", async () => {
      const { status, json } = await requestJson(options.baseUrl, "/sermon-workspace/query", {
        apiKey: options.apiKey,
        method: "POST",
        body: { operation: "getSermon", arguments: { sermonId: "sermon-live-smoke-does-not-exist" } }
      });
      assert(status === 200, "Structured not-found returned a transport error", { status, json });
      assert(json.ok === false && json.error?.code === "sermon_not_found", "Not-found response was not structured", { json });
      return { requestId: json.requestId, errorCode: json.error.code };
    }, results);

    await runCheck("preaching_dashboard", async () => {
      const { status, json } = await requestJson(options.baseUrl, "/sermon-workspace/query", {
        apiKey: options.apiKey,
        method: "POST",
        body: { operation: "buildPreachingPreparationDashboard", arguments: { limit: 12 } }
      });
      assert(status === 200 && json.ok === true, "Preaching dashboard failed", { status, json });
      assert(Array.isArray(json.result?.schedule), "Dashboard response is missing schedule items", { result: json.result });
      return {
        requestId: json.requestId,
        upcomingCount: json.result.summary?.upcomingCount || 0,
        placeholderCount: json.result.summary?.placeholderCount || 0
      };
    }, results);
  } catch (_error) {
    console.error(JSON.stringify({ ok: false, baseUrl: options.baseUrl, checks: results }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ ok: true, baseUrl: options.baseUrl, checks: results }, null, 2));
}

await main();
