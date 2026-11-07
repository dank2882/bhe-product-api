import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
// Narrow read-only release check. Never print records, credentials or identity values.
const runtime = JSON.parse(execFileSync("gcloud", ["run", "services", "describe", "bhe-product-api", "--project=location-map-985", "--region=us-west1", "--format=json"]));
const env = Object.fromEntries(runtime.spec.template.spec.containers[0].env.map(e => [e.name, e]));
const secret = env.BHE_API_KEY.valueFrom.secretKeyRef;
const key = execFileSync("gcloud", ["secrets", "versions", "access", secret.key, `--secret=${secret.name}`, "--project=location-map-985"], { encoding: "utf8" }).trim();
const owner = env.DAN_TRAVEL_OWNER_SUBJECTS.value.split(",")[0].trim();
const base = process.env.PERSONAL_FINANCE_VERIFY_BASE_URL || runtime.status.url;
async function request(path, body, actor = owner, url = base) {
  const r = await fetch(`${url}/personal-finance/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-api-key": key, "x-bhe-actor-sub": actor, "x-bhe-actor-subjects": JSON.stringify([actor, owner]), "x-bhe-task-role": "admin" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
}
const query = async (operation, args = {}, url = base) => { const r = await request("query", { operation, arguments: args }, owner, url); assert.equal(r.status, 200); assert.equal(r.body.ok, true); return r.body.result; };
const catalog = await request("operations"); assert.equal(catalog.status, 200); assert.equal(catalog.body.catalogVersion, "1.1.0"); assert(catalog.body.contracts.brokerage);
const before = await query("getPersonalSettings");
for (const actor of ["ungranted-brokerage-review", ...(env.DAN_PRIVATE_DELEGATE_SUBJECTS?.value || "").split(",").filter(x => x && x !== owner)]) {
  for (const path of ["operations", "query", "command"]) {
    const r = await request(path, path === "operations" ? null : { operation: path === "query" ? "getPersonalSettings" : "savePersonalSettings", arguments: {}, idempotencyKey: "denied-brokerage-review" }, actor);
    assert.equal(r.status, 403);
  }
}
const current = await query("buildPersonalForecast", { includeDetail: true });
const production = await query("buildPersonalForecast", { includeDetail: true }, runtime.status.url);
assert.equal(current.engineVersion, "1.1.0"); assert(Array.isArray(current.baseline.brokerageObservations));
for (const field of ["daily", "monthly", "openingUsableCents", "endingUsableCents", "lowestUsableCents", "reserveShortfallCents", "status", "gaps"]) assert.deepEqual(current.baseline[field], production.baseline[field]);
const input = { reference: "Synthetic read-only brokerage preview; never committed", brokerageAccounts: [{ id: "synthetic-brokerage-preview-only", name: "Synthetic preview only", type: "brokerage", currency: "USD" }], brokerageBalances: [{ id: "synthetic-brokerage-preview-only-balance", accountId: "synthetic-brokerage-preview-only", date: current.asOfDate, amountCents: 10000, source: { system: "manual", reference: "Synthetic preview only", observedOn: current.asOfDate }, treatments: [] }] };
const preview = await query("previewPersonalImport", { input }); assert.equal(preview.canCommit, true); assert.equal(preview.changes.length, 2);
input.brokerageAccounts[0].includeInSpendable = true;
assert.equal((await request("query", { operation: "previewPersonalImport", arguments: { input } })).status, 400);
assert.deepEqual(await query("getPersonalSettings"), before);
console.log(JSON.stringify({ passed: true, checks: ["live 1.1 catalog", "owner allow and delegate/admin denial", "brokerage preview", "spendable exclusion", "unchanged household cash projections", "no writes"] }));
