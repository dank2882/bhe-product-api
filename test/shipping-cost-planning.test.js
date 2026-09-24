"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { runShippingOperation, operations } = require("../lib/shipping-operation-registry");
const { summarize, validate } = require("../lib/shipping-cost-planning");
const source = { shipmentId: "source-shipment", costId: "invoice" };
const line = (id, extra = {}) => ({ id, description: id, category: "ocean", currency: "USD", lowMinor: null, expectedMinor: null, highMinor: null, required: true, basis: "unknown", note: "Request a current itemized quote", ...extra });
const plan = (extra = {}) => ({ title: "Philippines 20-foot budget", destinationCountry: "Philippines", route: "Origin and delivery address to confirm", containerSize: "20", containerCount: 1, asOf: "2026-09-24", status: "draft", coverage: "partial", assumptions: "Planning only", exclusions: "Scope not confirmed", lines: [line("ocean")], historicalReferences: [], ...extra });
function setup() {
  const deps = { firestoreDb: fakeFirestore(), shippingOwnerSubjects: ["dan"], taskAccess: { subject: "dan", scopes: ["shipping.read", "shipping.write"] }, now: () => Date.parse("2026-09-24T12:00:00Z") };
  let n = 0;
  const call = async (operation, args = {}, key = "country-cost-test-" + (++n), overrides = {}) => (await runShippingOperation({ operation, mode: operations.find(o => o.name === operation).mode, arguments: args, idempotencyKey: key }, { ...deps, ...overrides })).result;
  const save = (estimate, expectedVersion = 0, key, estimateId = "ph-20") => call("saveCountryCostEstimate", { estimateId, expectedVersion, estimate }, key);
  return { deps, call, save };
}
async function addSource(deps, extra = {}) {
  await deps.firestoreDb.collection("fbcShippingShipments").doc(source.shipmentId).set({ owner: "fbc", version: 7, title: "Historical shipment", destinationCountry: "Philippines", status: "historical-incomplete", containers: [{ size: "20" }], costs: [{ id: "invoice", type: "invoice", status: "active", verification: "verified", currency: "USD", date: "2025-01-24", scope: "Ocean only", sources: ["email-1"], lines: [{ id: "ocean", amountMinor: 166000 }, { id: "included", amountMinor: 1000, includedInLineId: "ocean" }, { id: "deposit", amountMinor: 20000, refundable: true }], ...extra }] });
}
const historical = (extra = {}) => line("ocean", { basis: "historical", expectedMinor: 166000, reference: source, sourceLineId: "ocean", ...extra });
test("country estimates are authorized, versioned, replayable and independent of shipment records", async () => {
  const { deps, call, save } = setup();
  await assert.rejects(call("listCountryCostEstimates", {}, undefined, { taskAccess: { subject: "other", role: "admin", scopes: ["shipping.read", "shipping.write"] } }), { code: "shipping_access_denied" });
  await assert.rejects(call("saveCountryCostEstimate", { estimateId: "ph-20", expectedVersion: 0, estimate: plan() }, undefined, { taskAccess: { subject: "dan", scopes: ["shipping.read"] } }), { code: "shipping_access_denied" });
  const first = await save(plan(), 0, "country-create-key");
  assert.equal(first.readBackVerified, true); assert.equal(first.version, 1);
  const races = await Promise.allSettled([save(plan({ title: "A" }), 1), save(plan({ title: "B" }), 1)]);
  assert.equal(races.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(races.find(r => r.status === "rejected").reason.code, "shipping_version_conflict");
  const replay = await save(plan(), 0, "country-create-key"); assert.equal(replay.replayed, true); assert.equal(replay.version, 1); assert.equal(replay.estimate.title, plan().title);
  await assert.rejects(save(plan({ title: "Different" }), 0, "country-create-key"), { code: "shipping_idempotency_conflict" });
  assert.equal((await call("getCountryCostEstimate", { estimateId: "ph-20", version: 1 })).estimate.title, plan().title);
  assert.equal([...deps.firestoreDb.rows.keys()].filter(k => k.startsWith("fbcShippingShipments/")).length, 0);
  assert.equal([...deps.firestoreDb.rows.keys()].filter(k => k.startsWith("fbcShippingAudit/")).length, 2);
});
test("currency totals preserve unknowns, ranges, historical basis, risks and refundable cash", () => {
  const p = plan({ lines: [line("ocean", { basis: "allowance", expectedMinor: 200000, lowMinor: 180000, highMinor: 220000 }), line("insurance"), line("deposit", { category: "deposit", currency: "PHP", basis: "allowance", expectedMinor: 1024400 }), line("delay", { category: "delay", currency: "PHP", basis: "allowance", expectedMinor: 5576076 })] });
  const r = summarize(validate(p), "2026-09-24"), [usd, php] = r.currencies;
  assert.equal(r.budgetComplete, false); assert.equal(usd.expenses.expectedMinor, null); assert.equal(usd.expenses.knownExpectedMinor, 200000);
  assert.equal(php.expenses.expectedMinor, 0); assert.equal(php.refundableDeposits.expectedMinor, 1024400); assert.equal(php.delayRisk.expectedMinor, 5576076); assert.equal(php.cashRequired.expectedMinor, 6600476);
  assert.deepEqual(r.missingRequiredLineIds, ["insurance"]);
  const complete = summarize(plan({ coverage: "complete", lines: [line("known", { basis: "allowance", lowMinor: 100, expectedMinor: 200, highMinor: 300 })] }), "2026-09-24");
  assert.equal(complete.budgetComplete, true); assert.equal(complete.currencies[0].expenses.highMinor, 300);
  assert.throws(() => validate(plan({ lines: [line("bad", { basis: "allowance", lowMinor: 100, expectedMinor: 50 })] })), /low <= expected/);
  assert.throws(() => validate(plan({ lines: [line("bad", { expectedMinor: 0 })] })), /Unknown cost/);
  assert.throws(() => summarize(plan({ lines: [line("a", { expectedMinor: Number.MAX_SAFE_INTEGER }), line("b", { expectedMinor: 1 })] }), "2026-09-24"), /safe integer/);
});
test("historical values are checked against source currency, scope, count and cost kind", async () => {
  const { deps, save, call } = setup(); await addSource(deps);
  for (const lines of [[historical({ expectedMinor: 1 })], [historical({ currency: "PHP" })], [historical({ sourceLineId: "included", expectedMinor: 1000 })], [historical(), historical({ id: "duplicate" })], [historical({ sourceLineId: "deposit", expectedMinor: 20000 })]]) await assert.rejects(save(plan({ lines })));
  await assert.rejects(save(plan({ containerCount: 2, lines: [historical()] })), /size and count/);
  await assert.rejects(save(plan({ containerSize: "40", lines: [historical()] })), /size and count/);
  const r = await save(plan({ lines: [historical(), historical({ id: "deposit", sourceLineId: "deposit", expectedMinor: 20000, category: "deposit" })] }));
  assert.equal(r.estimate.lines[0].sourceDate, "2025-01-24"); assert.equal(r.estimate.lines[0].sourceSnapshot.shipmentVersion, 7); assert.equal(r.summary.needsCurrentPricing, true);
  assert.deepEqual(r.summary.historicalLineIds, ["ocean", "deposit"]);
  await addSource(deps, { type: "reimbursement" });
  await assert.rejects(save(plan({ lines: [historical()] }), 1), /reimbursements as references/);
  const reimbursement = await save(plan({ historicalReferences: [source] }), 1);
  assert.equal(reimbursement.estimate.historicalReferences[0].type, "reimbursement"); assert.equal(reimbursement.summary.currencies[0].cashRequired.expectedMinor, null);
  assert.equal((await call("getCountryCostEstimate", { estimateId: "ph-20", version: 1 })).estimate.lines[0].sourceSnapshot.type, "invoice");
});
test("expired quotes and canceled or disputed sources cannot silently become current budgets", async () => {
  const { deps, save, call } = setup();
  await addSource(deps, { type: "quote", validUntil: "2026-09-25" });
  const p = plan({ coverage: "complete", lines: [historical({ basis: "quote" })] });
  await save(p);
  const future = await call("getCountryCostEstimate", { estimateId: "ph-20" }, undefined, { now: () => Date.parse("2026-09-26") });
  assert.deepEqual(future.summary.expiredQuoteLineIds, ["ocean"]); assert.equal(future.summary.budgetComplete, false);
  await addSource(deps, { type: "quote", validUntil: "2026-09-23" }); await assert.rejects(save(p, 1), /unexpired/);
  await addSource(deps, { status: "disputed" }); await assert.rejects(save(plan({ historicalReferences: [source] }), 1), /active verified/);
  await addSource(deps); await deps.firestoreDb.collection("fbcShippingShipments").doc(source.shipmentId).update({ status: "canceled" });
  await assert.rejects(save(plan({ historicalReferences: [source] }), 1), /non-canceled/);
});
test("country estimate pagination retains cursor after an empty filtered page", async () => {
  const { save, call } = setup();
  await save(plan(), 0, undefined, "a-ph"); await save(plan({ destinationCountry: "Honduras" }), 0, undefined, "b-hn");
  const first = await call("listCountryCostEstimates", { country: "Honduras", limit: 1 }); assert.equal(first.estimates.length, 0); assert(first.nextCursor);
  const second = await call("listCountryCostEstimates", { country: "Honduras", limit: 1, cursor: first.nextCursor }); assert.equal(second.estimates[0].estimateId, "b-hn"); assert.equal(second.complete, true);
  await assert.rejects(call("listCountryCostEstimates", { country: "Peru", cursor: first.nextCursor }), { code: "shipping_invalid_cursor" });
});
