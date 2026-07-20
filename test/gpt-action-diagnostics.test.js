const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.BHE_API_KEY ||= "test-bhe-api-key";
process.env.OPENAI_API_KEY ||= "test-openai-api-key";

const {
  ACTION_DIAGNOSTIC_SCENARIOS,
  runGptActionTransportProbe
} = require("../lib/gpt-action-diagnostics");
const { app } = require("../index");

test("diagnostic OpenAPI schema matches the server scenario contract", () => {
  const schemaPath = path.resolve(
    __dirname,
    "../docs/gpts/diagnostics/sermon-action-transport.schema.json"
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const probe = schema.paths?.["/gpt-action-diagnostics/probe"]?.post;
  const scenarioEnum = schema.components?.schemas?.ProbeRequest?.properties?.scenario?.enum;

  assert.equal(schema.openapi, "3.1.0");
  assert.equal(schema.info?.version, "1.2.0");
  assert.equal(schema.paths?.["/gpt-action-diagnostics/ping"]?.get?.operationId, "pingGptActionTransport");
  assert.equal(probe?.operationId, "runGptActionTransportProbe");
  assert.deepEqual(scenarioEnum, ACTION_DIAGNOSTIC_SCENARIOS);
  assert.equal(
    schema.paths?.["/sermon-presentations/from-lookup"]?.post?.operationId,
    "createSermonPresentationFromLookupDirect"
  );
  assert.deepEqual(
    schema.components?.schemas?.PresentationRequest?.required,
    ["title", "idempotencyKey"]
  );
  assert.equal(
    schema.paths?.["/sermon-workspace/query"]?.post?.operationId,
    "runSermonWorkspaceQuery"
  );
  assert.equal(
    schema.paths?.["/sermon-workspace/artifact"]?.post?.operationId,
    "runSermonWorkspaceArtifact"
  );
  assert.deepEqual(
    schema.components?.schemas?.DispatchRequest?.required,
    ["operation", "arguments"]
  );
  assert.equal(
    probe?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
    "#/components/schemas/ProbeResponse"
  );
});

test("diagnostic probe exposes the controlled transport scenarios", () => {
  assert.deepEqual(ACTION_DIAGNOSTIC_SCENARIOS, [
    "plain_json",
    "same_domain_url",
    "long_external_url",
    "delayed_json",
    "http_error"
  ]);
});

test("plain diagnostic probe has no URL or external dependencies", async () => {
  const response = await runGptActionTransportProbe(
    {
      requestId: "request-1",
      marker: "plain-1",
      scenario: "plain_json"
    },
    {
      now: () => "2026-07-11T00:00:00.000Z",
      serviceRevision: "revision-1"
    }
  );

  assert.equal(response.ok, true);
  assert.equal(response.url, "");
  assert.equal(response.delayMs, 0);
  assert.equal(response.serviceRevision, "revision-1");
});

test("diagnostic URL scenarios isolate same-domain and long external responses", async () => {
  const common = {
    requestId: "request-2",
    marker: "url-1"
  };
  const deps = {
    now: () => "2026-07-11T00:00:00.000Z",
    baseUrl: "https://api.example.com"
  };
  const sameDomain = await runGptActionTransportProbe(
    { ...common, scenario: "same_domain_url" },
    deps
  );
  const external = await runGptActionTransportProbe(
    { ...common, scenario: "long_external_url" },
    deps
  );

  assert.match(sameDomain.url, /^https:\/\/api\.example\.com\/gpt-action-diagnostics\/sample\.txt/);
  assert.match(external.url, /^https:\/\/storage\.googleapis\.com\//);
  assert.ok(external.url.length > 900);
});

test("delayed diagnostic probe uses an injected bounded delay", async () => {
  const delays = [];
  const response = await runGptActionTransportProbe(
    {
      requestId: "request-3",
      marker: "delay-1",
      scenario: "delayed_json",
      delayMs: 2500
    },
    {
      now: () => "2026-07-11T00:00:00.000Z",
      sleep: async (delayMs) => delays.push(delayMs)
    }
  );

  assert.deepEqual(delays, [2500]);
  assert.equal(response.delayMs, 2500);
});

test("intentional HTTP diagnostic error is explicit", async () => {
  await assert.rejects(
    runGptActionTransportProbe({
      requestId: "request-4",
      marker: "error-1",
      scenario: "http_error"
    }),
    (error) => {
      assert.equal(error.statusCode, 418);
      assert.equal(error.code, "intentional_diagnostic_http_error");
      return true;
    }
  );
});

test("diagnostic routes distinguish authenticated GET, POST, and HTTP error", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = {
    "content-type": "application/json",
    "x-api-key": process.env.BHE_API_KEY
  };

  const ping = await fetch(`${baseUrl}/gpt-action-diagnostics/ping`, {
    headers: { "x-api-key": process.env.BHE_API_KEY }
  });
  assert.equal(ping.status, 200);
  assert.equal((await ping.json()).probe, "ping");

  const plain = await fetch(`${baseUrl}/gpt-action-diagnostics/probe`, {
    method: "POST",
    headers,
    body: JSON.stringify({ marker: "route-plain", scenario: "plain_json" })
  });
  assert.equal(plain.status, 200);
  assert.equal((await plain.json()).scenario, "plain_json");

  const intentionalError = await fetch(`${baseUrl}/gpt-action-diagnostics/probe`, {
    method: "POST",
    headers,
    body: JSON.stringify({ marker: "route-error", scenario: "http_error" })
  });
  assert.equal(intentionalError.status, 418);
  assert.equal((await intentionalError.json()).errorCode, "intentional_diagnostic_http_error");

  const unauthorized = await fetch(`${baseUrl}/gpt-action-diagnostics/ping`);
  assert.equal(unauthorized.status, 401);
});
