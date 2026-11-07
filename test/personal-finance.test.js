"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { run, listOperations } = require("../lib/personal-finance-operation-registry");
const M = require("../lib/personal-finance-model");
const source = { system: "manual", reference: "synthetic test", observedOn: "2026-11-06" };
const reviewArtifact = (id = "review") => ({ id, name: "Synthetic review", type: "source_review", date: "2026-11-06", basedOnVersion: 0, format: "json", content: '{"held":true,"amountCents":123}', status: "provisional", source });
test("personal artifacts persist exact content with digest, immutable identity and retry safety", async () => {
  const s = setup(), artifact = reviewArtifact(), args = { expectedVersion: 0, artifact };
  const first = await s.command("savePersonalArtifact", args, "artifact-stable-retry");
  const read = (await s.query("getPersonalArtifact", { id: artifact.id })).artifact;
  assert.equal(read.content, artifact.content);
  assert.equal(read.contentSha256, require("node:crypto").createHash("sha256").update(artifact.content).digest("hex"));
  assert.equal(read.contentBytes, Buffer.byteLength(artifact.content));
  assert.equal((await s.command("savePersonalArtifact", args, "artifact-stable-retry")).version, first.version);
  await assert.rejects(s.command("savePersonalArtifact", { artifact }), /immutable/);
  await assert.rejects(s.command("savePersonalArtifact", { expectedVersion: 0, artifact: reviewArtifact("other") }), /Workspace changed/);
  await assert.rejects(s.command("savePersonalArtifact", { ...args, artifact: { ...artifact, content: '{}' } }, "artifact-stable-retry"), /Idempotency/);
  assert((await s.query("getPersonalHistory")).items[0].changes.some(c => c.kind === "artifacts" && c.record.content === artifact.content));
});
test("artifact metadata pages are bounded and version checked; archives never affect forecasts", async () => {
  const s = setup(); await baseline(s);
  const before = (await s.query("buildPersonalForecast", { includeDetail: true })).baseline;
  for (const id of ["a", "b", "c"]) await s.command("savePersonalArtifact", { artifact: reviewArtifact(id) });
  const page = await s.query("listPersonalArtifacts", { limit: 2 });
  assert.deepEqual(page.items.map(x => x.id), ["a", "b"]);assert(!page.complete);assert.equal(page.nextAfterId, "b");
  assert(page.items.every(x => !("content" in x)));
  const last = await s.query("listPersonalArtifacts", { limit: 2, afterId: page.nextAfterId, expectedVersion: page.version });
  assert.deepEqual(last.items.map(x => x.id), ["c"]);assert(last.complete);
  assert.deepEqual((await s.query("buildPersonalForecast", { includeDetail: true })).baseline, before);
  await s.command("savePersonalArtifact", { artifact: reviewArtifact("d") });
  await assert.rejects(s.query("listPersonalArtifacts", { afterId: "b", expectedVersion: page.version }), /Workspace changed/);
  await assert.rejects(s.query("listPersonalArtifacts", { limit: 21 }));
  await assert.rejects(s.query("getPersonalArtifact", { id: "absent" }), /not found/);
});
test("artifact validation and all entry points preserve exact-owner privacy", async () => {
  const s = setup();
  for (const change of [{ content: "" }, { content: "{" }, { content: "é".repeat(125001) }, { type: "generic_note" }, { basedOnVersion: 1 }, { basedOnVersion: -1 }, { date: "2026-11-07" }, { format: "executable" }, { status: "approved_cash" }, { contentSha256: "forged" }]) await assert.rejects(s.command("savePersonalArtifact", { artifact: { ...reviewArtifact(), ...change } }));
  for (const taskAccess of [{ subject: "staff", role: "admin" }, { subject: "sarah", subjects: ["dan"], role: "admin" }]) {
    const deps = { ...s.deps, taskAccess };
    await assert.rejects(s.query("getPersonalArtifact", { id: "review" }, deps), e => e.statusCode === 403);
    await assert.rejects(s.query("listPersonalArtifacts", {}, deps), e => e.statusCode === 403);
    await assert.rejects(run({ mode: "command", operation: "savePersonalArtifact", arguments: { expectedVersion: 0, artifact: reviewArtifact() }, idempotencyKey: "artifact-denied" }, deps), e => e.statusCode === 403);
  }
  assert.equal(s.db.rows.size, 0);
});
function setup() {
  const db = fakeFirestore(), original = db.runTransaction; let seq = 0;
  db.runTransaction = fn => original(tx => { let writing = false; return fn({ get: r => { assert.equal(writing, false); return tx.get(r); }, set: (...a) => { writing = true; return tx.set(...a); }, create: (...a) => { writing = true; return tx.create(...a); } }); });
  const deps = { firestoreDb: db, danOwnerSubjects: ["dan"], taskAccess: { subject: "dan", role: "admin" }, now: () => "2026-11-07T03:00:00Z" };
  const query = async (operation, args = {}, d = deps) => (await run({ operation, arguments: args, mode: "query" }, d)).result;
  const version = async () => (await query("getPersonalSettings")).version;
  const command = async (operation, args, key = `personal-test-${++seq}`) => (await run({ operation, arguments: { expectedVersion: await version(), ...args }, mode: "command", idempotencyKey: key }, deps)).result;
  const save = (kind, record) => command("savePersonalRecord", { kind, record });
  const preview = input => query("previewPersonalImport", { input });
  const commit = async input => { const p = await preview(input); return command("commitPersonalImport", { input, previewHash: p.previewHash, expectedVersion: p.version }); };
  return { db, deps, query, command, save, preview, commit, version };
}
const account = (id = "checking", type = "checking", extra = {}) => ({ id, name: id, type, currency: "USD", ...extra });
const tx = (externalId, extra = {}) => ({ accountId: "checking", externalId, date: "2026-11-06", amountCents: -1000, status: "posted", kind: "expense", splits: [{ categoryId: "food", amountCents: -1000 }], source: { ...source, system: "bank" }, ...extra });
const input = transactions => ({ reference: "synthetic export", transactions });
const brokerageBatch = () => ({ reference: "synthetic brokerage export", brokerageAccounts: [account("investment", "brokerage")], brokerageBalances: [{ id: "investment-observation", accountId: "investment", date: "2026-11-06", amountCents: 900000, treatments: [], source, brokerageDetails: { date: "2026-11-05", cashBalanceCents: 300000, securitiesValueCents: 600000, settledFundsCents: 290000, cashAvailableToWithdrawCents: 250000 } }] });
const budget = (extra = {}) => ({ id: "baseline", name: "Plan", month: "2026-11", type: "proposal", categories: [], repeatMonthly: true, forecastEnabled: true, source, ...extra });
const schedule = (id, extra = {}) => ({ id, name: id, accountId: "checking", kind: "expense", amountCents: 1000, startDate: "2026-11-10", frequency: "once", source, ...extra });
async function checkpoint(s, accountId = "checking", amountCents = 100000, treatments = [], extra = {}) { return s.save("balances", { id: `balance-${accountId}-${await s.version()}`, accountId, amountCents, date: "2026-11-06", source, treatments, ...extra }); }
async function baseline(s) {
  await s.save("accounts", account()); await checkpoint(s);
  await s.save("budgets", budget());
  await s.command("savePersonalSettings", { settings: { reserveCents: 10000, baselineBudgetId: "baseline", coverageConfirmedOn: "2026-11-06", coverageThrough: "2027-11-05" } });
}
test("noncash assets preserve unknown valuations, history and cash isolation", async () => {
  const s = setup(); await baseline(s);
  const before = (await s.query("buildPersonalForecast", { includeDetail: true })).baseline;
  const asset = { id: "synthetic-car", name: "Synthetic vehicle", type: "vehicle", currency: "USD", estimatedValueCents: null, debtStatus: "paid_off", vehicle: { modelYear: 2015, makeModel: "Test model", odometerMiles: 80000 }, source };
  await s.save("assets", asset);
  assert.equal((await s.query("getPersonalRecord", { kind: "assets", id: asset.id })).record.estimatedValueCents, null);
  await s.save("assets", { ...asset, estimatedValueCents: 1234500, valuationDate: "2026-11-06" });
  assert.deepEqual((await s.query("buildPersonalForecast", { includeDetail: true })).baseline, before);
  const history = await s.query("getPersonalHistory");
  assert(history.items.some(h => h.changes.some(c => c.kind === "assets" && c.record.estimatedValueCents === null)));
  await assert.rejects(s.save("schedules", schedule("sell", { accountId: asset.id, kind: "income" })), /not found/);
  for (const bad of [{ estimatedValueCents: 100 }, { estimatedValueCents: -1, valuationDate: "2026-11-06" }, { valuationDate: "2026-11-06" }, { estimatedValueCents: 100, valuationDate: "2026-11-07" }, { includeInSpendable: true }, { currency: "CAD" }]) await assert.rejects(s.save("assets", { ...asset, ...bad }));
  const args = { expectedVersion: await s.version(), kind: "assets", record: asset };
  const first = await s.command("savePersonalRecord", args, "asset-stable-retry");
  assert.equal((await s.command("savePersonalRecord", args, "asset-stable-retry")).version, first.version);
  await assert.rejects(s.command("savePersonalRecord", args), /Workspace changed/);
  for (const taskAccess of [{ subject: "staff", role: "admin" }, { subject: "delegate", subjects: ["dan"], role: "admin" }]) {
    await assert.rejects(s.query("listPersonalRecords", { kind: "assets" }, { ...s.deps, taskAccess }));
    await assert.rejects(run({ operation: "savePersonalRecord", mode: "command", arguments: args, idempotencyKey: "asset-denied-write" }, { ...s.deps, taskAccess }));
  }
});
test("brokerage preview, atomic creation, independent readback and duplicate reimport", async () => {
  const s = setup(), batch = brokerageBatch(), v = await s.version();
  const preview = await s.preview(batch); assert.equal(preview.canCommit, true); assert.equal(preview.changes.length, 2); assert.equal(await s.version(), v);
  await s.commit(batch);
  const observation = (await s.query("getPersonalRecord", { kind: "balances", id: "investment-observation" })).record;
  assert.deepEqual(observation.brokerageDetails, batch.brokerageBalances[0].brokerageDetails);
  assert.equal((await s.query("getPersonalRecord", { kind: "accounts", id: "investment" })).record.includeInSpendable, false);
  const repeated = await s.preview(batch); assert.equal(repeated.changes.length, 0); assert.equal(repeated.unchangedCount, 2);
  const changed = structuredClone(batch); changed.brokerageBalances[0].amountCents++;
  assert.equal((await s.preview(changed)).conflicts[0].code, "brokerage_observation_conflict");
  await assert.rejects(s.commit(changed), /conflicts/);
  assert.equal((await s.query("getPersonalRecord", { kind: "balances", id: "investment-observation" })).record.amountCents, 900000);
});
test("brokerage values never fund reserves or scenarios and remain dated observations", async () => {
  const s = setup(); await baseline(s);
  const before = (await s.query("buildPersonalForecast", { includeDetail: true })).baseline;
  await s.commit(brokerageBatch());
  const f = await s.query("buildPersonalForecast", { includeDetail: true, scenario: { id: "test", name: "Test", additions: [schedule("purchase", { amountCents: 95000 })] } });
  assert.equal(f.baseline.openingUsableCents, before.openingUsableCents);
  assert.deepEqual(f.baseline.daily, before.daily); assert.deepEqual(f.baseline.monthly, before.monthly);
  assert.equal(f.scenario.status, "shortfall"); assert.equal(f.baseline.accounts.length, 1);
  assert.equal(f.baseline.brokerageObservations[0].accountValueCents, 900000);
  assert.equal(f.baseline.brokerageObservations[0].details.date, "2026-11-05");
  assert.equal(f.baseline.brokerageObservations[0].projected, false);
});
test("brokerage import rejects relabeling, duplicate IDs, borrowing and cashflow use", async () => {
  const s = setup(); await baseline(s); await s.commit(brokerageBatch());
  await assert.rejects(s.save("accounts", account("investment", "brokerage", { includeInSpendable: true })), /excluded/);
  await assert.rejects(s.save("accounts", account("investment")), /type cannot/);
  await assert.rejects(s.save("schedules", schedule("transfer", { kind: "transfer", toAccountId: "investment" })), /observations only/);
  await assert.rejects(s.preview(input([tx("trade", { accountId: "investment" })])), /observations only/);
  await assert.rejects(s.save("budgets", budget({ categories: [{ categoryId: "food", accountId: "investment", plannedCents: 100 }] })), /observations only/);
  await assert.rejects(s.query("buildPersonalForecast", { scenario: { id: "x", name: "x", additions: [schedule("income", { accountId: "investment", kind: "income" })] } }), /observations only/);
  const bad = brokerageBatch(); bad.brokerageBalances[0].brokerageDetails.borrowingCents = 40000;
  await assert.rejects(s.preview(bad), /Unsupported|Unknown|Unexpected/i);
  const dup = brokerageBatch(); dup.brokerageBalances.push(dup.brokerageBalances[0]); await assert.rejects(s.preview(dup), /Duplicate/);
  const wrong = brokerageBatch(); wrong.brokerageAccounts[0].id = "checking"; await assert.rejects(s.commit(wrong));
  await assert.rejects(checkpoint(s, "checking", 100000, [], { brokerageDetails: { date: "2026-11-06" } }), /require a brokerage/);
});
test("brokerage missing fields stay unknown; stale and absent observations are explicit", async () => {
  const s = setup(); await baseline(s); await s.save("accounts", account("investment", "brokerage"));
  let f = (await s.query("buildPersonalForecast")).baseline; assert.equal(f.brokerageObservations[0].freshness, "missing"); assert.equal(f.brokerageObservations[0].accountValueCents, null);
  await checkpoint(s, "investment", 900000, [], { date: "2026-10-01", brokerageDetails: { date: "2026-10-01" } });
  f = (await s.query("buildPersonalForecast")).baseline; assert.equal(f.brokerageObservations[0].freshness, "stale"); assert.equal(f.brokerageObservations[0].details.cashAvailableToWithdrawCents, null);
  await assert.rejects(checkpoint(s, "investment", 900000, [], { brokerageDetails: { date: "2026-11-07" } }), /cannot follow/);
  await checkpoint(s, "investment", 900000, [], { brokerageDetails: { date: "2026-11-06", cashBalanceCents: -10000 } });
  f = (await s.query("buildPersonalForecast")).baseline;
  assert.equal(f.status, "unresolved"); assert(f.gaps.some(g => g.code === "brokerage_debt_requires_review"));
});
test("exact primary owner required before catalog, query or command; aliases/delegation cannot grant access", async () => {
  const s = setup();
  for (const subject of ["sarah", "staff", "admin", ""]) {
    const deps = { ...s.deps, taskAccess: { subject, subjects: [subject, "dan"], role: "admin" }, privateDelegationEnv: { DAN_PRIVATE_DELEGATE_SUBJECTS: subject, DAN_PRIVATE_OWNER_SUBJECTS: "dan" } };
    assert.throws(() => listOperations({}, deps), e => e.statusCode === 403);
    await assert.rejects(s.query("getPersonalSettings", {}, deps), e => e.statusCode === 403);
    await assert.rejects(run({ mode: "command", operation: "savePersonalRecord", arguments: {}, idempotencyKey: "denied-test" }, deps), e => e.statusCode === 403);
  }
  assert.equal(s.db.rows.size, 0);
  await assert.rejects(require("../lib/operator-data-service").queryOperatorDocuments({ collection: "danPersonalFinance" }, { firestoreDb: s.db }), /collection/i);
});
test("individual documents, version conflicts, idempotent receipts and independent readback", async () => {
  const s = setup(), args = { expectedVersion: 0, kind: "accounts", record: account() };
  const first = await s.command("savePersonalRecord", args, "stable-account");
  assert.equal(first.version, 1);
  assert.equal((await s.command("savePersonalRecord", args, "stable-account")).replayed, true);
  await assert.rejects(s.command("savePersonalRecord", { ...args, record: account("other") }, "stable-account"), e => e.statusCode === 409);
  const results = await Promise.allSettled(["one", "two"].map(id => s.command("savePersonalRecord", { expectedVersion: 1, kind: "accounts", record: account(id) })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await s.query("getPersonalRecord", { kind: "accounts", id: "checking" })).record.currency, "USD");
  assert(s.db.rows.has("danPersonalFinance/workspace/accounts/checking"));
  assert(![...s.db.rows.keys()].some(p => p.startsWith("danFinanceForecast/")));
});
test("preview is read-only; stale or altered previews cannot commit; duplicate reimports no-op", async () => {
  const s = setup(); await s.save("accounts", account()); const batch = input([tx("a")]);
  const p = await s.preview(batch); assert.equal(await s.version(), p.version); assert.equal(p.changes.length, 1);
  await assert.rejects(s.command("commitPersonalImport", { input: input([tx("b")]), previewHash: p.previewHash }), /preview/);
  await s.commit(batch); const again = await s.preview(batch); assert.equal(again.changes.length, 0); assert.equal(again.unchangedCount, 1);
  await assert.rejects(s.command("commitPersonalImport", { expectedVersion: p.version, input: batch, previewHash: p.previewHash }), /changed/);
  assert.equal((await s.query("listPersonalRecords", { kind: "transactions" })).totalCount, 1);
});
test("overlap is explicit, YNAB adds categories once, discrepancies block, repeated real purchases can be distinct", async () => {
  const s = setup(); await s.save("accounts", account()); await s.commit(input([tx("bank-a", { splits: [] })]));
  const id = (await s.query("listPersonalRecords", { kind: "transactions" })).items[0].id;
  const y = tx("ynab-a", { source: { ...source, system: "ynab" } });
  assert.equal((await s.preview(input([y]))).conflicts[0].code, "possible_duplicate");
  await s.commit(input([{ ...y, matchId: id }]));
  const records = await s.query("listPersonalRecords", { kind: "transactions" }); assert.equal(records.totalCount, 1); assert.equal(records.items[0].evidence.length, 2); assert.equal(records.items[0].splits[0].categoryId, "food");
  const changed = { ...y, matchId: id, amountCents: -2000, splits: [] };
  assert.equal((await s.preview(input([changed]))).canCommit, false);
  await s.commit(input([tx("another-real-purchase", { distinctConfirmed: true })]));
  assert.equal((await s.query("listPersonalRecords", { kind: "transactions" })).totalCount, 2);
});
test("pending becomes posted on same identity and invalidates a checkpoint rather than counting twice", async () => {
  const s = setup(); await baseline(s); await s.commit(input([tx("a", { status: "pending" })]));
  const record = (await s.query("listPersonalRecords", { kind: "transactions" })).items[0];
  await checkpoint(s, "checking", 100000, [{ transactionId: record.id, included: false }]);
  let f = (await s.query("buildPersonalForecast")).baseline; assert.equal(f.endingUsableCents, 99000);
  await s.commit(input([tx("a")])); f = (await s.query("buildPersonalForecast")).baseline;
  assert.equal(f.status, "unresolved"); assert(f.gaps.some(g => g.code === "checkpoint_invalidated_by_transaction_change"));
  await checkpoint(s, "checking", 99000, [{ transactionId: record.id, included: true }]);
  f = (await s.query("buildPersonalForecast")).baseline; assert.equal(f.endingUsableCents, 99000); assert.equal(f.status, "within_plan");
});
test("missing reserve, dates, stale balances and unconfirmed coverage cannot yield affirmative affordability", async () => {
  const s = setup(); let f = (await s.query("buildPersonalForecast")).baseline; assert.equal(f.status, "unresolved");
  assert(f.gaps.some(g => g.code === "reserve_target_missing"));
  await baseline(s); await s.save("schedules", schedule("unknown", { amountCents: null, startDate: "" }));
  f = (await s.query("buildPersonalForecast")).baseline; assert.equal(f.status, "unresolved");
  assert(f.gaps.some(g => g.code === "schedule_amount_or_timing_missing"));
  await assert.rejects(s.query("buildPersonalForecast", { asOfDate: "2026-11-07" }), /Pacific/);
  await assert.rejects(s.save("accounts", { ...account("fx"), currency: "PHP" }), /currency/);
});
test("daily/monthly cash flow, month-end recurrence, account shortfalls and isolated purchase scenario", async () => {
  const s = setup(); await baseline(s); await s.save("schedules", schedule("pay", { kind: "income", amountCents: 100000, startDate: "2026-11-30", frequency: "monthly" }));
  const before = await s.version();
  const f = await s.query("buildPersonalForecast", { includeDetail: true, scenario: { id: "purchase", name: "Purchase", additions: [schedule("purchase", { startDate: "2026-11-07", amountCents: 95000 })] } });
  assert.equal(f.baseline.daily.length, 90); assert.equal(f.through, "2027-11-05");
  assert(f.baseline.events.some(e => e.date === "2027-02-28")); assert.equal(f.baseline.status, "within_plan");
  assert.equal(f.scenario.status, "shortfall"); assert.equal(f.scenario.reserveShortfallCents, 5000); assert.equal(f.difference.endingUsableCents, -95000);
  assert.equal(await s.version(), before);
});
test("same-day expenses precede income and savings require explicit inclusion", async () => {
  const s = setup(); await baseline(s); await s.save("accounts", account("savings", "savings")); await checkpoint(s, "savings", 10000000);
  await s.save("schedules", schedule("bill", { amountCents: 110000 })); await s.save("schedules", schedule("pay", { kind: "income", amountCents: 110000 }));
  const f = (await s.query("buildPersonalForecast")).baseline;
  assert.equal(f.openingUsableCents, 100000); assert.equal(f.lowestUsableCents, -10000); assert.equal(f.status, "shortfall"); assert.deepEqual(f.accountShortfalls, ["checking"]);
});
test("budget remainder subtracts splits, refunds and scheduled expenses without spending allocations", async () => {
  const s = setup(); await baseline(s);
  await s.save("budgets", budget({ categories: [{ categoryId: "food", accountId: "checking", plannedCents: 10000 }] }));
  await s.commit(input([tx("spend", { amountCents: -4000, splits: [{ categoryId: "food", amountCents: -3000 }, { categoryId: "other", amountCents: -1000 }] }), tx("refund", { amountCents: 1000, splits: [{ categoryId: "food", amountCents: 1000 }] })]));
  const items = (await s.query("listPersonalRecords", { kind: "transactions" })).items;
  await checkpoint(s, "checking", 100000, items.map(t => ({ transactionId: t.id, included: true })));
  await s.save("schedules", schedule("food-order", { amountCents: 2000, categoryId: "food" }));
  const f = (await s.query("buildPersonalForecast", { includeDetail: true })).baseline;
  assert.equal(f.events.find(e => e.origin === "budget_remainder").amountCents, -6000);
  assert.equal(f.monthly[0].outflowCents, 8000);
  await s.commit({ reference: "YNAB budget", budgets: [budget({ id: "ynab", type: "ynab", source: { ...source, system: "ynab" }, categories: [{ categoryId: "food", assignedCents: 999999, plannedCents: null }] })] });
  assert.equal((await s.query("getPersonalRecord", { kind: "budgets", id: "ynab" })).record.forecastEnabled, false);
  const c = await s.query("comparePersonalBudgets", { baselineId: "ynab", proposalId: "baseline" }); assert.equal(c.categories[0].actualAndPendingSpendingCents, 2000);
});
test("card purchase and paired payment count expense once while reducing bank cash", async () => {
  const s = setup(); await baseline(s); await s.save("accounts", account("card", "credit_card"));
  await s.commit(input([tx("buy", { accountId: "card" }), tx("pay-out", { kind: "card_payment", splits: [], transferId: "payment" }), tx("pay-in", { accountId: "card", amountCents: 1000, kind: "card_payment", splits: [], transferId: "payment" })]));
  const records = (await s.query("listPersonalRecords", { kind: "transactions" })).items;
  await checkpoint(s, "checking", 99000, records.filter(t => t.accountId === "checking").map(t => ({ transactionId: t.id, included: true })));
  await checkpoint(s, "card", 0, records.filter(t => t.accountId === "card").map(t => ({ transactionId: t.id, included: true })));
  const f = (await s.query("buildPersonalForecast")).baseline; assert.equal(f.endingUsableCents, 99000); assert.equal(f.status, "within_plan");
  const c = await s.query("comparePersonalBudgets", { baselineId: "baseline", proposalId: "baseline" }); assert.deepEqual(c.categories, []);
});
test("actual schedule occurrence removes expected payment, partial settlement retains remainder", async () => {
  const s = setup(); await baseline(s); await s.save("schedules", schedule("bill", { startDate: "2026-11-06", amountCents: 3000, categoryId: "food" }));
  await s.commit(input([tx("paid", { scheduleId: "bill", occurrenceDate: "2026-11-06" })]));
  const t = (await s.query("listPersonalRecords", { kind: "transactions" })).items[0]; await checkpoint(s, "checking", 99000, [{ transactionId: t.id, included: true }]);
  const f = (await s.query("buildPersonalForecast", { includeDetail: true })).baseline;
  assert.equal(f.events.find(e => e.id === "bill").amountCents, -2000); assert.equal(f.endingUsableCents, 97000);
});
test("strict inputs reject unsafe money, malformed splits and incorrect references; pagination retains coverage", async () => {
  const s = setup(); await s.save("accounts", account());
  await assert.rejects(s.save("accounts", account("__proto__")), /Reserved/);
  await assert.rejects(s.preview(input([tx("bad", { amountCents: 1.1 })])), /integer/);
  await assert.rejects(s.preview(input([tx("bad", { splits: [{ categoryId: "food", amountCents: -999 }] })])), /Split/);
  await assert.rejects(s.preview(input([tx("bad", { accountId: "missing" })])), /not found/);
  await s.save("accounts", account("other"));
  const first = await s.query("listPersonalRecords", { kind: "accounts", limit: 1 }); assert.equal(first.complete, false);
  const second = await s.query("listPersonalRecords", { kind: "accounts", limit: 1, cursor: first.nextCursor }); assert.equal(second.complete, true); assert.notEqual(first.items[0].id, second.items[0].id);
  await s.save("accounts", account("third")); await assert.rejects(s.query("listPersonalRecords", { kind: "accounts", cursor: first.nextCursor }), /changed/);
});
test("bank correction preserves disagreement with YNAB; older source observations cannot replace newer evidence", async () => {
  const s = setup(); await baseline(s); await s.commit(input([tx("bank")]));
  const id = (await s.query("listPersonalRecords", { kind: "transactions" })).items[0].id;
  await s.commit(input([tx("ynab", { source: { ...source, system: "ynab" }, matchId: id })]));
  await s.commit(input([tx("bank", { amountCents: -2000, splits: [] })]));
  const r = (await s.query("getPersonalRecord", { kind: "transactions", id })).record;
  assert.equal(r.amountCents, -2000); assert.deepEqual(r.splits, []);
  assert((await s.query("buildPersonalForecast")).baseline.gaps.some(g => g.code === "source_observations_disagree"));
  const older = tx("bank", { date: "2026-11-05", source: { ...source, system: "bank", observedOn: "2026-11-05" } });
  assert.equal((await s.preview(input([older]))).conflicts[0].code, "older_source_observation");
});
test("different pending/posted source IDs can match with changed hold amount without a phantom expense", async () => {
  const s = setup(); await baseline(s); await s.commit(input([tx("hold", { status: "pending" })]));
  const id = (await s.query("listPersonalRecords", { kind: "transactions" })).items[0].id;
  await s.commit(input([tx("posted", { matchId: id, amountCents: -1200, splits: [{ categoryId: "food", amountCents: -1200 }] })]));
  await checkpoint(s, "checking", 98800, [{ transactionId: id, included: true }]);
  const f = (await s.query("buildPersonalForecast")).baseline;
  assert.equal(f.status, "within_plan"); assert.equal(f.endingUsableCents, 98800);
  assert.equal((await s.query("listPersonalRecords", { kind: "transactions" })).totalCount, 1);
});
test("voided included movements require new reconciliation and zero reserve is explicit", async () => {
  const s = setup(); await baseline(s); await s.commit(input([tx("paid")]));
  const id = (await s.query("listPersonalRecords", { kind: "transactions" })).items[0].id;
  await checkpoint(s, "checking", 99000, [{ transactionId: id, included: true }]);
  await s.commit(input([tx("paid", { status: "void" })]));
  assert((await s.query("buildPersonalForecast")).baseline.gaps.some(g => g.code === "checkpoint_invalidated_by_transaction_change"));
  await checkpoint(s, "checking", 100000);
  await s.command("savePersonalSettings", { settings: { reserveCents: 0, baselineBudgetId: "baseline", coverageConfirmedOn: "2026-11-06", coverageThrough: "2027-11-05" } });
  assert.equal((await s.query("buildPersonalForecast")).baseline.status, "within_plan");
});

test("wish list preserves priority across edits, deferral, restore and atomic moves", async () => {
  const s = setup(); await baseline(s);
  const before = (await s.query("buildPersonalForecast", { includeDetail: true })).baseline;
  const wish = (id, extra = {}) => ({ id, name: id, currency: "USD", estimatedCostCents: null, source, ...extra });
  for (const id of ["a", "b", "c"]) await s.command("savePersonalWish", { item: wish(id) });
  await s.command("movePersonalWish", { id: "c", beforeId: "a" });
  let list = await s.query("listPersonalWishlist");
  assert.deepEqual(list.items.map(x => [x.id, x.rank]), [["c", 1], ["a", 2], ["b", 3]]);
  await s.command("savePersonalWish", { item: wish("a", { estimatedCostCents: 50000, notes: "Synthetic cost estimate" }) });
  assert.equal((await s.query("getPersonalRecord", { kind: "wishlist", id: "a" })).record.rank, 2);
  await s.command("savePersonalWish", { item: wish("c", { status: "deferred" }) });
  assert.deepEqual((await s.query("listPersonalWishlist")).items.map(x => [x.id, x.rank]), [["a", 1], ["b", 2]]);
  assert.equal((await s.query("listPersonalWishlist", { status: "deferred" })).items[0].rank, null);
  await s.command("savePersonalWish", { item: wish("c") });
  await s.command("movePersonalWish", { id: "a" });
  assert.deepEqual((await s.query("listPersonalWishlist")).items.map(x => x.id), ["b", "c", "a"]);
  await s.command("savePersonalWish", { item: wish("b", { status: "purchased" }) });
  assert.equal((await s.query("getPersonalRecord", { kind: "wishlist", id: "b" })).record.status, "purchased");
  assert.deepEqual((await s.query("buildPersonalForecast", { includeDetail: true })).baseline, before);
  const history = (await s.query("getPersonalHistory")).items;
  assert(history.some(h => h.operation === "movePersonalWish" && h.changes.length === 3));
});
test("wish list retries, stale edits, pagination and invalid input are safe", async () => {
  const s = setup(), item = { id: "a", name: "Synthetic wish", currency: "USD", estimatedCostCents: null, source };
  const args = { expectedVersion: 0, item };
  const receipt = await s.command("savePersonalWish", args, "wish-stable-key");
  assert.equal((await s.command("savePersonalWish", args, "wish-stable-key")).version, receipt.version);
  await assert.rejects(s.command("savePersonalWish", { ...args, item: { ...item, name: "Changed" } }, "wish-stable-key"), /Idempotency/);
  await assert.rejects(s.command("savePersonalWish", args), /Workspace changed/);
  for (const bad of [{ estimatedCostCents: -1 }, { estimatedCostCents: 1.1 }, { currency: "EUR" }, { rank: 1 }, { status: "funded" }, { accountId: "checking" }, { notes: "x".repeat(2001) }]) await assert.rejects(s.command("savePersonalWish", { item: { ...item, ...bad } }));
  await assert.rejects(s.command("movePersonalWish", { id: "a", beforeId: "a" }));
  await assert.rejects(s.command("movePersonalWish", { id: "absent" }));
  await assert.rejects(s.command("movePersonalWish", { id: "a", beforeId: "absent" }));
  await assert.rejects(s.save("wishlist", item));
  await s.command("savePersonalWish", { item: { ...item, id: "b" } });
  const page = await s.query("listPersonalWishlist", { limit: 1 });
  assert.equal(page.items[0].id, "a");assert(page.nextCursor);
  assert.equal((await s.query("listPersonalWishlist", { limit: 1, cursor: page.nextCursor })).items[0].id, "b");
  await s.command("movePersonalWish", { id: "b", beforeId: "a" });
  await assert.rejects(s.query("listPersonalWishlist", { limit: 1, cursor: page.nextCursor }));
  await s.command("savePersonalWish", { item: { ...item, id: "b", status: "dropped" } });
  await assert.rejects(s.command("movePersonalWish", { id: "b" }));
  assert.equal((await s.query("listPersonalWishlist", { status: "all" })).items.length, 2);
});
test("wish list entry points deny delegates and staff without creating records", async () => {
  const s = setup();
  for (const taskAccess of [{ subject: "staff", role: "admin" }, { subject: "delegate", subjects: ["dan"], role: "admin" }]) {
    const deps = { ...s.deps, taskAccess };
    await assert.rejects(s.query("listPersonalWishlist", {}, deps), e => e.statusCode === 403);
    await assert.rejects(s.query("getPersonalRecord", { kind: "wishlist", id: "a" }, deps), e => e.statusCode === 403);
    for (const operation of ["savePersonalWish", "movePersonalWish"]) await assert.rejects(run({ operation, mode: "command", arguments: { expectedVersion: 0, ...(operation === "movePersonalWish" ? { id: "a" } : { item: {} }) }, idempotencyKey: "denied-wish-intent" }, deps), e => e.statusCode === 403);
  }
  assert.equal(s.db.rows.size, 0);
});
