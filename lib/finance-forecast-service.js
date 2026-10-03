"use strict";
const M = require("./finance-forecast-model");
const { assertCanReadTaskRecord } = require("./task-management-access");
const root = deps => deps.firestoreDb.collection("danFinanceForecast").doc("workspace");
const kinds = ["funds", "plans", "items", "settlements", "advances"];

async function readState(deps) {
  M.access(deps);
  const snap = await root(deps).get();
  return snap.exists ? snap.data() : M.empty();
}
function validateSource(s, deps) {
  const source = M.source(s);
  if ([source.reportedOn, source.confirmedOn].some(d => d > M.today(deps))) M.fail("Source confirmation cannot be future dated");
  return source;
}
function upsert(state, kind, record, at) {
  const previous = state[kind].find(r => r.id === record.id);
  const next = { ...record, createdAt: previous?.createdAt || at, updatedAt: at };
  if (previous) state[kind][state[kind].indexOf(previous)] = next; else state[kind].push(next);
  return next;
}
function sum(values) { return values.reduce((n, x) => n + x, 0); }
function settled(state, itemId, occurrenceDate = null) {
  return sum(state.settlements.filter(s => !s.voided && s.itemId === itemId && s.occurrenceDate === occurrenceDate).map(s => s.amountCents));
}
async function verifyPlanLinks(plan, deps, tx) {
  if (!plan.ministryId && !plan.projectId) M.fail("Link an existing ministry or project");
  if (plan.ministryId) {
    const s = await tx.get(deps.firestoreDb.collection("fbcMinistryRecords").doc(plan.ministryId));
    if (!s.exists || (s.data().owner || "fbc") !== plan.organization || (s.data().recordKind || "ministry") !== "ministry") M.fail("Ministry organization or classification does not match");
  }
  if (plan.projectId) {
    const s = await tx.get(deps.projectsCollection.doc(plan.projectId));
    if (!s.exists) M.fail("Linked project not found");
    assertCanReadTaskRecord(s.data(), deps, { projectId: plan.projectId });
    // Task projects do not universally have organization metadata. Where it
    // exists it must agree; otherwise the explicit forecast organization owns
    // this planning link and does not change the project's ownership.
    if (["fbc", "bhe", "gom"].includes(s.data().ownerNamespace) && s.data().ownerNamespace !== plan.organization) M.fail("Project organization does not match");
  }
}
function permitted(state, fundId, planId) {
  const fund = M.find(state, "funds", fundId);
  if (!planId) return fund;
  const plan = M.find(state, "plans", planId);
  if (plan.organization !== fund.organization || !fund.planIds.includes(planId)) M.fail("Plan is not permitted to use this fund");
  return fund;
}
function normalizeItem(v, state, deps) {
  M.shape(v, ["id", "fundId", "planId", "title", "exactText", "direction", "status", "amountCents", "timing", "recurrence", "source", "donor", "designatedPurpose", "coversItemIds"]);
  const item = { id: M.id(v.id), fundId: M.id(v.fundId), planId: v.planId ? M.id(v.planId) : "", title: M.text(v.title, "title", 300),
    exactText: M.text(v.exactText, "exactText", 10000), direction: M.choice(v.direction, ["income", "cost"], "direction"),
    amountCents: M.money(v.amountCents, true), timing: M.timing(v.timing), recurrence: M.recurrence(v.recurrence), source: validateSource(v.source, deps),
    donor: M.text(v.donor, "donor", 300, true), designatedPurpose: M.text(v.designatedPurpose, "designated purpose", 1000, true), coversItemIds: v.coversItemIds || [] };
  item.status = M.choice(v.status, item.direction === "income" ? ["possible", "committed", "withdrawn"] : ["expected", "committed", "proposed", "cancelled"], "status");
  if (!Array.isArray(item.coversItemIds) || item.coversItemIds.length > 100 || new Set(item.coversItemIds).size !== item.coversItemIds.length) M.fail("Invalid covered costs");
  item.coversItemIds.forEach(M.id);
  permitted(state, item.fundId, item.planId);
  if (item.recurrence && (item.direction !== "cost" || item.coversItemIds.length)) M.fail("Recurring records support costs without aggregate coverage");
  if (item.coversItemIds.length && (item.direction !== "cost" || item.status !== "expected")) M.fail("Only expected cost totals may include other costs");
  return item;
}
function validateItems(state) {
  const claimed = new Set();
  for (const i of state.items) {
    if (i.direction === "cost" && i.status === "expected") for (const coveredId of i.coversItemIds) {
      const c = M.find(state, "items", coveredId);
      if (c.id === i.id || c.direction !== "cost" || c.status !== "committed" || c.recurrence || c.coversItemIds.length || c.fundId !== i.fundId || c.planId !== i.planId || claimed.has(c.id)) M.fail("Included costs must be distinct committed costs in the same plan and fund");
      claimed.add(c.id);
    }
    if (i.amountCents !== null) for (const occurrenceDate of M.occurrenceDates(i)) {
      const covered = i.coversItemIds.map(id => M.find(state, "items", id));
      const ceiling = covered.some(c => c.amountCents === null) ? 0 : Math.max(0, i.amountCents - sum(covered.map(c => c.amountCents)));
      if (settled(state, i.id, occurrenceDate) > ceiling) M.fail("Amount is below recorded settlements or payments overlap included costs");
    }
    if (state.settlements.some(s => !s.voided && s.itemId === i.id && !M.occurrenceDates(i).includes(s.occurrenceDate))) M.fail("Schedule would orphan recorded payments");
  }
}
async function mutate(operation, args, state, deps, tx, at) {
  const changed = [], mark = (kind, id) => changed.push({ kind, id });
  if (operation === "saveFund") {
    const v = args.fund;
    M.shape(v, ["id", "name", "organization", "restriction", "restrictionConfirmed", "planIds", "allocations", "cushionCents", "lenderCoverageConfirmedOn", "active"]);
    const old = state.funds.find(f => f.id === v.id);
    const fund = { id: M.id(v.id), name: M.text(v.name, "fund name", 300), organization: M.choice(v.organization, ["fbc", "bhe", "gom"], "organization"),
      restriction: M.text(v.restriction, "restriction", 2000, true), restrictionConfirmed: v.restrictionConfirmed === true,
      cushionCents: M.money(v.cushionCents, true), planIds: v.planIds || [], allocations: v.allocations || [],
      lenderCoverageConfirmedOn: v.lenderCoverageConfirmedOn ? M.day(v.lenderCoverageConfirmedOn) : "", active: v.active !== false,
      checkpoint: old?.checkpoint || null };
    if (fund.lenderCoverageConfirmedOn > M.today(deps)) M.fail("Lender confirmation cannot be future dated");
    if (old && old.organization !== fund.organization) M.fail("Fund organization cannot be transferred");
    if (!Array.isArray(fund.planIds) || fund.planIds.length > 100 || new Set(fund.planIds).size !== fund.planIds.length || !Array.isArray(fund.allocations) || fund.allocations.length > 100) M.fail("Invalid fund allocations");
    for (const planId of fund.planIds) if (M.find(state, "plans", planId).organization !== fund.organization) M.fail("Fund and plan organization differ");
    const allocated = new Set();
    fund.allocations = fund.allocations.map(a => { M.shape(a, ["planId", "amountCents"]); if (!fund.planIds.includes(a.planId) || allocated.has(a.planId)) M.fail("Invalid or duplicate allocation"); allocated.add(a.planId); return { planId: M.id(a.planId), amountCents: M.money(a.amountCents) }; });
    if (state.items.some(i => i.fundId === fund.id && i.planId && !fund.planIds.includes(i.planId))) M.fail("Cannot remove a plan with existing finance items");
    // Archiving is a display preference, not permission to omit liabilities.
    upsert(state, "funds", fund, at); mark("funds", fund.id);
  } else if (operation === "saveFinancePlan") {
    const v = args.plan;
    M.shape(v, ["id", "name", "organization", "ministryId", "projectId", "costCoverageConfirmedOn", "active"]);
    const p = { id: M.id(v.id), name: M.text(v.name, "name", 300), organization: M.choice(v.organization, ["fbc", "bhe", "gom"], "organization"),
      ministryId: v.ministryId ? M.id(v.ministryId) : "", projectId: v.projectId ? M.id(v.projectId) : "",
      costCoverageConfirmedOn: v.costCoverageConfirmedOn ? M.day(v.costCoverageConfirmedOn) : "", active: v.active !== false };
    if (p.costCoverageConfirmedOn > M.today(deps)) M.fail("Cost confirmation cannot be future dated");
    const old = state.plans.find(x => x.id === p.id);
    if (old && ["organization", "ministryId", "projectId"].some(k => old[k] !== p[k])) M.fail("Plan identity cannot be reassigned");
    await verifyPlanLinks(p, deps, tx); upsert(state, "plans", p, at); mark("plans", p.id);
  } else if (operation === "saveForecastItem") {
    const i = normalizeItem(args.item, state, deps), old = state.items.find(x => x.id === i.id);
    if (old && ["fundId", "planId", "direction"].some(k => old[k] !== i[k])) M.fail("Item destination and direction cannot be reassigned");
    upsert(state, "items", i, at); validateItems(state); mark("items", i.id);
  } else if (operation === "recordBalanceCheckpoint") {
    const f = M.find(state, "funds", args.fundId), v = args.checkpoint;
    M.shape(v, ["amountCents", "basis", "effectiveDate", "source", "movementTreatments"]);
    const c = { amountCents: M.money(v.amountCents, false, true), basis: M.choice(v.basis, ["cash_available", "accounting_balance", "budget_allowance"], "balance basis"),
      effectiveDate: M.day(v.effectiveDate), source: validateSource(v.source, deps), movementTreatments: v.movementTreatments || [], needsReview: false };
    if (c.effectiveDate > M.today(deps) || (f.checkpoint && c.effectiveDate < f.checkpoint.effectiveDate)) M.fail("Checkpoint must be current or later than the previous checkpoint, never future dated");
    if (!Array.isArray(c.movementTreatments) || c.movementTreatments.length > 1000) M.fail("Invalid movement treatments");
    const ids = new Set();
    for (const x of c.movementTreatments) {
      M.shape(x, ["movementId", "treatment"]); M.choice(x.treatment, ["included", "excluded"], "treatment");
      const s = M.find(state, "settlements", x.movementId);
      if (ids.has(s.id) || s.voided || !movementFunds(state, s).includes(f.id) || s.date > c.effectiveDate) M.fail("Invalid checkpoint movement");
      ids.add(s.id);
    }
    f.checkpoint = c; f.updatedAt = at; mark("funds", f.id);
  } else if (operation === "recordSettlement" || operation === "recordAdvanceMovement") {
    const v = args.settlement;
    M.shape(v, ["id", "itemId", "advanceId", "kind", "amountCents", "date", "occurrenceDate", "source", "exactText"]);
    const s = { id: M.id(v.id), itemId: "", advanceId: "", kind: "item", amountCents: M.money(v.amountCents), date: M.day(v.date),
      occurrenceDate: null, source: validateSource(v.source, deps), exactText: M.text(v.exactText, "exactText", 10000), voided: false, createdAt: at };
    if (!s.amountCents || s.date > M.today(deps)) M.fail("Settlement must have a positive amount and an actual non-future date");
    if (state.settlements.some(x => x.id === s.id)) M.fail("Settlement already exists; use its original idempotency key", "finance_duplicate", 409);
    if (operation === "recordSettlement") {
      const i = M.find(state, "items", v.itemId); s.itemId = i.id;
      if (i.amountCents === null || ["withdrawn", "cancelled"].includes(i.status)) M.fail("Set the expected total before settling an active item");
      s.occurrenceDate = i.recurrence ? M.day(v.occurrenceDate) : null;
      if (!M.occurrenceDates(i).includes(s.occurrenceDate)) M.fail("Unknown recurring occurrence");
    } else {
      const a = M.find(state, "advances", v.advanceId); s.advanceId = a.id; s.kind = M.choice(v.kind, ["advance", "repayment"], "movement kind");
      if (a.status === "cancelled") M.fail("Cannot settle a cancelled advance");
    }
    state.settlements.push(s); validateItems(state); validateAdvances(state); mark("settlements", s.id);
  } else if (operation === "voidSettlement") {
    const s = M.find(state, "settlements", args.settlementId);
    if (s.voided) M.fail("Settlement is already voided");
    s.voided = true; s.voidReason = M.text(args.reason, "correction reason"); s.updatedAt = at;
    for (const fundId of movementFunds(state, s)) { const f = M.find(state, "funds", fundId); if (f.checkpoint && s.date <= f.checkpoint.effectiveDate) f.checkpoint.needsReview = true; }
    validateAdvances(state); mark("settlements", s.id);
  } else if (operation === "saveAdvance") {
    const v = args.advance;
    M.shape(v, ["id", "title", "fromFundId", "toFundId", "amountCents", "timing", "repaymentTiming", "repaymentSource", "source", "exactText", "status", "restrictionUseConfirmed"]);
    const a = { id: M.id(v.id), title: M.text(v.title, "title", 300), fromFundId: M.id(v.fromFundId), toFundId: M.id(v.toFundId),
      amountCents: M.money(v.amountCents, true), timing: M.timing(v.timing), repaymentTiming: M.timing(v.repaymentTiming),
      repaymentSource: M.text(v.repaymentSource, "repayment source", 2000, true), source: validateSource(v.source, deps), exactText: M.text(v.exactText, "exactText", 10000),
      status: M.choice(v.status, ["proposed", "committed", "cancelled"], "advance status"), restrictionUseConfirmed: v.restrictionUseConfirmed === true };
    M.find(state, "funds", a.fromFundId); M.find(state, "funds", a.toFundId);
    if (a.fromFundId === a.toFundId) M.fail("Advance requires different funds");
    const old = state.advances.find(x => x.id === a.id);
    if (old && (old.fromFundId !== a.fromFundId || old.toFundId !== a.toFundId)) M.fail("Advance funds cannot be reassigned");
    upsert(state, "advances", a, at); validateAdvances(state); mark("advances", a.id);
  } else if (operation === "recordFinanceReview") {
    if (args.userConfirmed !== true) M.fail("Only record an explicitly completed review");
    const date = M.day(args.asOfDate);
    if (date > M.today(deps)) M.fail("Cannot complete a future review");
    state.lastReview = { asOfDate: date, reviewedAt: at, reviewedThroughVersion: state.version, assessment: M.text(args.assessment, "assessment", 5000) };
  } else M.fail("Unknown finance command");
  return changed;
}
function movementFunds(state, s) {
  if (s.itemId) return [M.find(state, "items", s.itemId).fundId];
  const a = M.find(state, "advances", s.advanceId); return [a.fromFundId, a.toFundId];
}
function validateAdvances(state) {
  for (const a of state.advances) {
    const movements = state.settlements.filter(s => s.advanceId === a.id && !s.voided).sort((x, y) => x.date.localeCompare(y.date) || (x.kind === "advance" ? -1 : 1));
    let principal = 0, advanced = 0;
    for (const s of movements) { if (s.kind === "advance") { principal += s.amountCents; advanced += s.amountCents; } else principal -= s.amountCents; if (principal < 0) M.fail("Repayment exceeds principal advanced on that date"); }
    if (a.amountCents !== null && advanced > a.amountCents) M.fail("Advance amount is below recorded disbursements");
    if (a.status === "cancelled" && principal) M.fail("An outstanding advance cannot be cancelled");
  }
}
async function runCommand(operation, args, key, deps) {
  const actor = M.access(deps);
  M.text(key, "idempotencyKey", 180); if (key.length < 8) M.fail("Idempotency key too short");
  if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 0) M.fail("Current workspace expectedVersion is required");
  const ref = root(deps), fingerprint = M.hash({ operation, args, actor: actor.subject }), receiptRef = ref.collection("commands").doc(M.hash(key));
  return deps.firestoreDb.runTransaction(async tx => {
    const [prior, snap] = await Promise.all([tx.get(receiptRef), tx.get(ref)]);
    if (prior.exists) { if (prior.data().fingerprint !== fingerprint) M.fail("Idempotency key already used for another intent", "finance_idempotency_conflict", 409); return { ...prior.data().receipt, replayed: true }; }
    const state = snap.exists ? snap.data() : M.empty();
    if (state.version !== args.expectedVersion) M.fail("Finance changed; read the current version", "finance_version_conflict", 409);
    const at = M.now(deps), changed = await mutate(operation, args, state, deps, tx, at);
    state.version++; state.updatedAt = at;
    // Small bounded first release; never silently omit a portion of the money.
    if (kinds.some(k => state[k].length > 1000) || Buffer.byteLength(JSON.stringify(state)) > 650000) M.fail("Finance workspace exceeds first-release capacity", "finance_capacity", 422);
    const receipt = { version: state.version, operation, changed, savedAt: at, replayed: false };
    const history = { version: state.version, operation, changed, occurredAt: at, actorSub: actor.subject, input: args };
    tx.set(ref, state);
    tx.create(ref.collection("history").doc(String(state.version).padStart(10, "0")), history);
    tx.create(receiptRef, { fingerprint, receipt });
    return receipt;
  });
}
async function listFinanceRecords(input, deps) {
  const state = await readState(deps), kind = M.choice(input.kind, kinds, "kind");
  const rows = state[kind].filter(r => (!input.organization || r.organization === input.organization || (r.fundId && M.find(state, "funds", r.fundId).organization === input.organization)))
    .filter(r => !input.query || `${r.title || r.name || ""} ${r.exactText || ""}`.toLowerCase().includes(input.query.toLowerCase()));
  return { version: state.version, ...M.page(rows.map(r => presentRecord(state, kind, r)), input, M.hash({ kind, version: state.version, organization: input.organization || "", query: input.query || "" })) };
}
function presentRecord(state, kind, record) {
  if (kind !== "items") return record;
  const occurrences = M.occurrenceDates(record).map(occurrenceDate => {
    const settledCents = settled(state, record.id, occurrenceDate);
    return { occurrenceDate, settledCents, remainingCents: record.amountCents === null ? null : Math.max(0, record.amountCents - settledCents),
      settlementState: settledCents === 0 ? "unsettled" : settledCents === record.amountCents ? (record.direction === "income" ? "received" : "paid") : (record.direction === "income" ? "partially_received" : "partially_paid") };
  });
  return { ...record, settlementSummary: occurrences };
}
async function getFinanceRecord(input, deps) { const state = await readState(deps), kind = M.choice(input.kind, kinds, "kind"); return { version: state.version, record: presentRecord(state, kind, M.find(state, kind, input.id)) }; }
async function getFinanceHistory(input, deps) {
  const state = await readState(deps), afterVersion = input.afterVersion ?? 0;
  if (!Number.isInteger(afterVersion) || afterVersion < 0) M.fail("Invalid history version");
  const limit = input.limit ?? 25; if (!Number.isInteger(limit) || limit < 1 || limit > 100) M.fail("limit must be 1-100");
  const snap = await root(deps).collection("history").orderBy("__name__").startAfter(String(afterVersion).padStart(10, "0")).limit(limit + 1).get();
  const rows = snap.docs.map(d => d.data());
  return { version: state.version, items: rows.slice(0, limit), complete: rows.length <= limit, nextAfterVersion: rows.length > limit ? rows[limit - 1].version : null };
}
async function buildFinanceForecast(input, deps) { return require("./finance-forecast-engine").forecast(await readState(deps), input, deps); }
async function buildFinanceReview(input, deps) {
  const state = await readState(deps), result = require("./finance-forecast-engine").forecast(state, { ...input, limit: input.limit ?? 5 }, deps);
  const changes = await getFinanceHistory({ afterVersion: state.lastReview?.reviewedThroughVersion || 0, limit: 25 }, deps);
  return { ...result, changesSinceReview: changes, lastReview: state.lastReview,
    guidance: "Review active projects and approaching shortages. Ask only about material changes. No review or confirmation has been saved." };
}
module.exports = { readState, runCommand, listFinanceRecords, getFinanceRecord, getFinanceHistory, buildFinanceForecast, buildFinanceReview, normalizeItem, validateItems, validateAdvances, settled, movementFunds };
