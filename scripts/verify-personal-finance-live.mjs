import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
// Existing service secret remains in process memory only; never print responses,
// financial values, actor identifiers, or provider request objects.
const runtime = JSON.parse(execFileSync("gcloud", ["run", "services", "describe", "bhe-product-api", "--project=location-map-985", "--region=us-west1", "--format=json"]));
const env = Object.fromEntries(runtime.spec.template.spec.containers[0].env.map(e => [e.name, e]));
const ref = env.BHE_API_KEY.valueFrom.secretKeyRef;
const apiKey = execFileSync("gcloud", ["secrets", "versions", "access", ref.key, `--secret=${ref.name}`, "--project=location-map-985"], { encoding: "utf8" }).trim();
const owner = env.DAN_TRAVEL_OWNER_SUBJECTS.value.split(",")[0].trim();
const base = process.env.PERSONAL_FINANCE_VERIFY_BASE_URL || runtime.status.url;
const headers = actor => ({ "content-type": "application/json", "x-api-key": apiKey, "x-bhe-actor-sub": actor, "x-bhe-actor-subjects": JSON.stringify([actor, owner]), "x-bhe-task-role": "admin" });
async function request(path, body, actor = owner) {
  const r = await fetch(`${base}/personal-finance/${path}`, { method: body ? "POST" : "GET", headers: headers(actor), ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
}
const query = async (operation, args = {}) => { const r = await request("query", { operation, arguments: args }); assert.equal(r.status, 200); assert.equal(r.body.ok, true); return r.body.result; };
const catalog = await request("operations"); assert.equal(catalog.status, 200); assert.equal(catalog.body.domain, "personal_finance");
const before = await query("getPersonalSettings");
const denied = ["personal-finance-ungranted-admin", ...(env.DAN_PRIVATE_DELEGATE_SUBJECTS?.value || "").split(",").filter(Boolean)];
for (const actor of denied.filter(a => a !== owner)) for (const path of ["operations", "query", "command"]) {
  const r = await request(path, path === "operations" ? null : { operation: path === "query" ? "getPersonalSettings" : "savePersonalSettings", arguments: { expectedVersion: before.version, settings: {} }, idempotencyKey: "personal-finance-denial-verification" }, actor);
  assert.equal(r.status, 403);
}
const input = { reference: "Technical initialization — no financial data imported", transactions: [] };
const preview = await query("previewPersonalImport", { input }); assert.equal(preview.canCommit, true); assert.equal(preview.changes.length, 0);
const body = { operation: "commitPersonalImport", arguments: { input, previewHash: preview.previewHash, expectedVersion: preview.version }, idempotencyKey: `personal-finance-technical-init-v${preview.version}` };
const first = await request("command", body); assert.equal(first.status, 200); assert.equal(first.body.ok, true);
const replay = await request("command", body); assert.equal(replay.status, 200); assert.equal(replay.body.result.replayed, true);
const record = first.body.result.changed.find(x => x.kind === "imports"); assert(record);
const readback = await query("getPersonalRecord", record); assert.equal(readback.record.changedCount, 0);
const conflict = await request("command", { ...body, idempotencyKey: `${body.idempotencyKey}-stale` }); assert.equal(conflict.status, 409);
const after = await query("getPersonalSettings"); assert.equal(after.version, first.body.result.version);
for (const kind of ["accounts", "transactions", "balances", "budgets", "schedules", "scenarios"]) assert.equal(after.counts[kind], before.counts[kind]);
const forecast = await query("buildPersonalForecast"); assert.equal(forecast.version, after.version); assert.equal(forecast.saved, false);
if (!after.counts.accounts) assert.equal(forecast.baseline.status, "unresolved");
console.log(JSON.stringify({ passed: true, version: after.version, checks: ["catalog", "exact-owner access", "delegate/admin alias denial", "read-only preview", "empty technical receipt write", "retry replay", "stale version denial", "independent readback", "no financial records created", "read-only forecast"], boundary: "authenticated owning API; real-account reconciliation and installed user-client acceptance remain separate" }));
