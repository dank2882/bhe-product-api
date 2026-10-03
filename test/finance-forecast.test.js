"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { runFinanceOperation: run, listFinanceOperations } = require("../lib/finance-forecast-operation-registry");
const M = require("../lib/finance-forecast-model");
function setup() {
  const db = fakeFirestore(), transaction = db.runTransaction; let sequence = 0;
  db.runTransaction = fn => transaction(tx => { let writing = false; return fn({
    get: r => { assert.equal(writing, false, "transaction reads precede writes"); return tx.get(r); },
    set: (...a) => { writing = true; return tx.set(...a); }, create: (...a) => { writing = true; return tx.create(...a); }
  }); });
  const deps = { firestoreDb: db, projectsCollection: db.collection("projects"), danOwnerSubjects: ["dan"], taskAccess: { subject: "dan", role: "admin" }, now: () => "2026-10-02T20:00:00Z" };
  const call = async (operation, args = {}, d = deps, key = `finance-test-${++sequence}`) => (await run({ operation, mode: operation.startsWith("get") || operation.startsWith("list") || operation.startsWith("build") ? "query" : "command", arguments: args, idempotencyKey: key }, d)).result;
  const version = async () => (await call("listFinanceRecords", { kind: "funds" })).version;
  const command = async (op, args) => call(op, { expectedVersion: await version(), ...args });
  return { db, deps, call, command, version };
}
const source = { reportedBy: "Dan", reportedOn: "2026-10-02", confirmedOn: "2026-10-02" };
async function plan(s, id = "project", organization = "fbc") {
  await s.db.collection("fbcMinistryRecords").doc(id).set({ owner: organization, recordKind: "ministry", status: "provisional" });
  await s.command("saveFinancePlan", { plan: { id, name: id, organization, ministryId: id, costCoverageConfirmedOn: "2026-10-02" } });
}
async function fund(s, id = "general", organization = "fbc", extra = {}) {
  await s.command("saveFund", { fund: { id, name: id, organization, restrictionConfirmed: true, cushionCents: 0, ...extra } });
}
async function balance(s, amountCents = 100000, extra = {}, fundId = "general") {
  return s.command("recordBalanceCheckpoint", { fundId, checkpoint: { amountCents, basis: "cash_available", effectiveDate: "2026-10-02", source, ...extra } });
}
function item(id, direction = "cost", amountCents = 10000, extra = {}) {
  return { id, fundId: "general", title: id, exactText: `Original ${id}`, direction, status: "committed", amountCents, timing: { kind: "exact", date: "2026-10-10" }, source, ...extra };
}
const save = (s, i) => s.command("saveForecastItem", { item: i });
const picture = async s => (await s.call("buildFinanceForecast")).items[0];
async function settlement(s, id, itemId, amountCents, extra = {}) {
  return s.command("recordSettlement", { settlement: { id, itemId, amountCents, date: "2026-10-02", source, exactText: "Reported actual payment or receipt", ...extra } });
}
test("strict primary identity rejects delegates, admins and injected owner aliases before any read/write", async () => {
  const s = setup();
  for (const subject of ["sarah", "staff", "administrator", ""]) {
    const d = { ...s.deps, taskAccess: { subject, subjects: [subject, "dan"], role: "admin" }, privateDelegationEnv: { DAN_PRIVATE_DELEGATE_SUBJECTS: subject, DAN_PRIVATE_OWNER_SUBJECTS: "dan" } };
    for (const [op, args] of [["listFinanceRecords", { kind: "funds" }], ["getFinanceHistory", {}], ["buildFinanceReview", {}], ["saveFund", { expectedVersion: 0, fund: {} }]]) await assert.rejects(s.call(op, args, d), e => e.code === "finance_access_denied");
  }
  assert.equal(s.db.rows.size, 0);
});
test("writes are atomic, versioned, idempotent and independently readable; concurrent stale writes fail", async () => {
  const s = setup(), args = { expectedVersion: 0, fund: { id: "general", name: "General", organization: "fbc" } };
  const first = await s.call("saveFund", args, s.deps, "stable-save-key");
  assert.equal(first.version, 1);
  assert.equal((await s.call("saveFund", args, s.deps, "stable-save-key")).replayed, true);
  await assert.rejects(s.call("saveFund", { ...args, fund: { ...args.fund, name: "Changed" } }, s.deps, "stable-save-key"), e => e.code === "finance_idempotency_conflict");
  const results = await Promise.allSettled([1, 2].map(n => s.call("saveFund", { expectedVersion: 1, fund: { ...args.fund, name: `Name ${n}` } })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await s.call("getFinanceRecord", { kind: "funds", id: "general" })).version, 2);
  assert.equal((await s.call("getFinanceHistory")).items.length, 2);
});
test("ministry ownership and provisional status are preserved and incorrect links cannot write", async () => {
  const s = setup(); await plan(s); await fund(s, "general", "fbc", { planIds: ["project"] });
  assert.equal((await s.db.collection("fbcMinistryRecords").doc("project").get()).data().status, "provisional");
  const before = await s.version();
  await assert.rejects(s.command("saveFinancePlan", { plan: { id: "wrong", name: "Wrong", organization: "gom", ministryId: "project" } }), /organization/);
  await assert.rejects(fund(s, "gom-fund", "gom", { planIds: ["project"] }), /organization/);
  assert.equal(await s.version(), before);
});
test("possible gifts are not expected cash; partial receipts reduce promise and checkpoint overlap blocks double count", async () => {
  const s = setup(); await fund(s); await balance(s, 10000, { effectiveDate: "2026-10-01" });
  const gift = item("gift", "income", 50000, { status: "possible" }); await save(s, gift);
  let f = await picture(s); assert.equal(f.views.expected.endingBalanceCents, 10000); assert.equal(f.views.potential.endingBalanceCents, 60000);
  await save(s, { ...gift, status: "committed" }); await settlement(s, "receipt1", "gift", 20000);
  f = await picture(s); assert.equal(f.cashCents, 30000); assert.equal(f.expectedGiftCents, 30000); assert.equal(f.views.expected.endingBalanceCents, 60000);
  await balance(s, 30000);
  f = await picture(s); assert.equal(f.cashCents, null); assert(f.limitations.includes("checkpoint_inclusion_unknown:receipt1"));
  await balance(s, 30000, { movementTreatments: [{ movementId: "receipt1", treatment: "included" }] });
  assert.equal((await picture(s)).views.expected.endingBalanceCents, 60000);
  await settlement(s, "receipt2", "gift", 30000);
  await balance(s, 60000, { movementTreatments: ["receipt1", "receipt2"].map(movementId => ({ movementId, treatment: "included" })) });
  f = await picture(s); assert.equal(f.expectedGiftCents, 0); assert.equal(f.views.expected.endingBalanceCents, 60000);
});
test("cost estimates replace commitments and aggregate estimates include covered cost only once", async () => {
  const s = setup(); await fund(s); await balance(s, 100000, { effectiveDate: "2026-10-01" });
  const cost = item("bill", "cost", 40000, { status: "expected" }); await save(s, cost);
  await save(s, { ...cost, status: "committed" });
  await save(s, item("finish", "cost", 100000, { status: "expected", coversItemIds: ["bill"] }));
  let f = await picture(s); assert.equal(f.knownRemainingCostCents, 100000); assert.equal(f.committedCostCents, 40000);
  await settlement(s, "paid", "bill", 10000);
  f = await picture(s); assert.equal(f.cashCents, 90000); assert.equal(f.knownRemainingCostCents, 90000); assert.equal(f.views.expected.endingBalanceCents, 0);
  await assert.rejects(save(s, item("finish2", "cost", 100000, { status: "expected", coversItemIds: ["bill"] })), /distinct committed/);
  await assert.rejects(save(s, { ...cost, amountCents: 5000 }), /below recorded/);
});
test("shared fund allocation counts cash once; restrictions, budget balances and missing coverage stay explicit", async () => {
  const s = setup(); await plan(s, "a"); await plan(s, "b");
  await fund(s, "general", "fbc", { planIds: ["a", "b"], allocations: [{ planId: "a", amountCents: 60000 }, { planId: "b", amountCents: 50000 }], cushionCents: 5000 });
  await balance(s, 100000);
  let forecast = await s.call("buildFinanceForecast"), f = forecast.items[0];
  assert.equal(forecast.organizationTotals[0].cashCents, 100000); assert.equal(f.unallocatedAfterCushionCents, -15000);
  assert(f.limitations.includes("allocations_and_cushion_exceed_cash"));
  await balance(s, 100000, { basis: "budget_allowance" }); assert.equal((await picture(s)).usableCashCents, null);
  await balance(s, 100000); await fund(s, "general", "fbc", { planIds: ["a", "b"], restriction: "Only project a", restrictionConfirmed: false });
  assert.equal((await picture(s)).usableCashCents, null);
});
test("shortage within a month survives positive month end and differs from a funding gap", async () => {
  const s = setup(); await fund(s); await balance(s, 10000);
  await save(s, item("bill", "cost", 20000));
  await save(s, item("gift", "income", 30000, { timing: { kind: "exact", date: "2026-10-20" } }));
  let f = await picture(s); assert.deepEqual(f.views.expected.firstShortage, { date: "2026-10-10", amountCents: 10000 });
  assert.equal(f.views.expected.monthly[0].endingBalanceCents, 20000); assert.equal(f.shortageType, "timing_shortage");
  await save(s, item("finish", "cost", 50000, { timing: { kind: "unknown" }, status: "expected" }));
  f = await picture(s); assert.equal(f.remainingFundingNeedCents, 30000); assert.equal(f.shortageType, "funding_and_timing");
  assert(f.limitations.includes("date_unknown:finish"));
});
test("windows, relative anchors, missing dates and overdue gifts do not invent optimistic precision", async () => {
  const s = setup(); await fund(s); await balance(s, 10000);
  await save(s, item("gift", "income", 30000, { timing: { kind: "window", from: "2026-11-01", to: "2026-11-30", originalText: "during November" } }));
  await save(s, item("shipping", "cost", 20000, { timing: { kind: "relative", eventReference: "shipment-1", daysAfter: 56, anchorBasis: "planned", anchorDate: "2026-09-01" } }));
  let f = await picture(s); assert.equal(f.gifts[0].date, "2026-11-30"); assert.equal(f.costs[0].date, "2026-10-27");
  await save(s, item("old-gift", "income", 100000, { timing: { kind: "exact", date: "2026-10-01" } }));
  await save(s, item("unknown", "cost", null, { timing: { kind: "relative", eventReference: "unshipped", daysAfter: 56 } }));
  f = await picture(s); assert.equal(f.expectedGiftCents, 30000); assert.equal(f.remainingFundingNeedCents, null);
  assert(f.limitations.includes("gift_overdue_reassess:old-gift")); assert.equal(f.costs.find(c => c.id === "unknown").date, "");
  assert.throws(() => M.timing({ kind: "exact", date: "2026-02-30" }));
});
test("monthly estimates use bounded dates, partial payments target occurrence and old unpaid costs remain overdue", async () => {
  const s = setup(); await fund(s); await balance(s, 100000, { effectiveDate: "2026-10-01" });
  await save(s, item("operating", "cost", 10000, { status: "expected", recurrence: { frequency: "monthly", startDate: "2026-09-30", endDate: "2026-12-30" } }));
  assert.equal((await picture(s)).knownRemainingCostCents, 40000);
  await settlement(s, "september", "operating", 10000, { occurrenceDate: "2026-09-30" });
  assert.equal((await picture(s)).knownRemainingCostCents, 30000);
  await assert.rejects(settlement(s, "invalid", "operating", 1, { occurrenceDate: "2026-11-01" }), /occurrence/);
});
test("temporary what-ifs change only the returned projection and optional proposals stay separate", async () => {
  const s = setup(); await fund(s); await balance(s, 10000);
  await save(s, item("optional", "cost", 20000, { status: "proposed" }));
  const before = JSON.stringify([...s.db.rows]);
  const result = await s.call("buildFinanceForecast", { scenario: [{ kind: "items", id: "optional", include: true }] });
  assert.equal(result.items[0].views.expected.endingBalanceCents, -10000); assert.equal(result.scenario, true);
  assert.equal((await picture(s)).views.expected.endingBalanceCents, 10000); assert.equal(JSON.stringify([...s.db.rows]), before);
});
test("advances project paired legs, never cover fundraising need and require repayment/lender evidence", async () => {
  const s = setup(); await fund(s, "general", "fbc", { lenderCoverageConfirmedOn: "2026-10-02" }); await balance(s, 100000);
  await fund(s, "missions", "gom"); await balance(s, 0, {}, "missions");
  await save(s, item("bill", "cost", 50000, { fundId: "missions", timing: { kind: "exact", date: "2026-10-12" } }));
  await s.command("saveAdvance", { advance: { id: "loan", title: "Temporary advance", fromFundId: "general", toFundId: "missions", amountCents: 50000,
    timing: { kind: "exact", date: "2026-10-10" }, repaymentTiming: { kind: "exact", date: "2026-11-10" }, repaymentSource: "", source, exactText: "An advance", status: "committed" } });
  let r = await s.call("buildFinanceForecast"), f = r.items.find(f => f.fundId === "missions");
  assert.equal(f.remainingFundingNeedCents, 50000); assert(f.limitations.includes("repayment_source_unknown:loan"));
  assert.equal(sumEvents(r, "2026-10-10"), 0); assert.equal(sumEvents(r, "2026-11-10"), 0);
  await assert.rejects(s.command("recordAdvanceMovement", { settlement: { id: "too-early", advanceId: "loan", kind: "repayment", amountCents: 10, date: "2026-10-02", source, exactText: "Invalid repayment" } }), /exceeds principal/);
  await s.command("recordAdvanceMovement", { settlement: { id: "advanced", advanceId: "loan", kind: "advance", amountCents: 50000, date: "2026-10-02", source, exactText: "Actually advanced" } });
  for (const [fundId, amountCents] of [["general", 50000], ["missions", 50000]]) await balance(s, amountCents, { movementTreatments: [{ movementId: "advanced", treatment: "included" }] }, fundId);
  r = await s.call("buildFinanceForecast"); assert.equal(r.items.find(f => f.fundId === "missions").remainingFundingNeedCents, 50000);
});
function sumEvents(result, date) { return result.items.flatMap(f => f.financingEvents).filter(e => e.date === date).reduce((n, e) => n + e.cents, 0); }
test("settlement corrections invalidate checkpoint; reads and completed reviews never confirm sources", async () => {
  const s = setup(); await fund(s); await save(s, item("gift", "income", 10000)); await settlement(s, "received", "gift", 10000);
  await balance(s, 10000, { movementTreatments: [{ movementId: "received", treatment: "included" }] });
  await s.command("voidSettlement", { settlementId: "received", reason: "Duplicate report" });
  assert.equal((await picture(s)).cashCents, null);
  const before = JSON.stringify([...s.db.rows]); await s.call("buildFinanceReview"); assert.equal(JSON.stringify([...s.db.rows]), before);
  await s.command("recordFinanceReview", { asOfDate: "2026-10-02", assessment: "Need corrected balance", userConfirmed: true });
  assert.equal((await picture(s)).cashCents, null);
  assert.equal((await s.call("buildFinanceReview")).lastReview.assessment, "Need corrected balance");
});
test("history pagination and current version are durable and catalog describes all operations", async () => {
  const s = setup(); await fund(s); await balance(s);
  const page = await s.call("getFinanceHistory", { limit: 1 }); assert.equal(page.complete, false);
  const next = await s.call("getFinanceHistory", { afterVersion: page.nextAfterVersion }); assert.equal(next.items[0].operation, "recordBalanceCheckpoint");
  assert.equal(listFinanceOperations().operations.length, 14);
  await assert.rejects(s.call("buildFinanceForecast", { asOfDate: "2026-09-01" }), /today/);
});
