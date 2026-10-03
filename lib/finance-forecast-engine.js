"use strict";
const M = require("./finance-forecast-model");
const { settled, validateItems, validateAdvances } = require("./finance-forecast-service");
const sum = xs => xs.reduce((a, b) => { const n = a + b; if (!Number.isSafeInteger(n)) M.fail("Forecast exceeds safe monetary range", "finance_capacity", 422); return n; }, 0);
const active = item => !["cancelled", "withdrawn"].includes(item.status);

function applyScenario(original, changes = []) {
  if (!Array.isArray(changes) || changes.length > 20) M.fail("At most 20 temporary scenario changes");
  const state = structuredClone(original);
  for (const c of changes) {
    M.shape(c, ["kind", "id", "amountCents", "timing", "include", "title", "fundId", "planId"]);
    if (c.kind === "addCost") {
      const id = M.id(c.id); if (state.items.some(i => i.id === id)) M.fail("Scenario item ID already exists");
      const fund = M.find(state, "funds", c.fundId);
      if (c.planId && !fund.planIds.includes(c.planId)) M.fail("Scenario plan is not permitted to use fund");
      state.items.push({ id, fundId: fund.id, planId: c.planId || "", title: M.text(c.title, "scenario title", 300), direction: "cost", status: "committed",
        amountCents: M.money(c.amountCents), timing: M.timing(c.timing), recurrence: null, coversItemIds: [], scenario: true });
    } else {
      const kind = M.choice(c.kind, ["items", "advances"], "scenario kind"), r = M.find(state, kind, c.id);
      if (c.amountCents !== undefined) r.amountCents = M.money(c.amountCents, true);
      if (c.timing) r.timing = M.timing(c.timing);
      if (c.include !== undefined) {
        if (typeof c.include !== "boolean") M.fail("Scenario include must be boolean");
        if (!active(r)) M.fail("Cannot include a cancelled or withdrawn record");
        r.scenarioIncluded = c.include;
      }
    }
  }
  validateItems(state); validateAdvances(state);
  return state;
}
function movementLegs(state, s) {
  if (s.itemId) { const i = M.find(state, "items", s.itemId); return [{ fundId: i.fundId, cents: (i.direction === "income" ? 1 : -1) * s.amountCents, financing: false, planId: i.planId }]; }
  const a = M.find(state, "advances", s.advanceId), sign = s.kind === "advance" ? 1 : -1;
  return [{ fundId: a.fromFundId, cents: -sign * s.amountCents, financing: true }, { fundId: a.toFundId, cents: sign * s.amountCents, financing: true }];
}
function currentCash(state, fund, asOfDate, gaps) {
  const c = fund.checkpoint;
  if (!c) { gaps.push("missing_cash_checkpoint"); return null; }
  if (c.effectiveDate > asOfDate) { gaps.push("checkpoint_after_requested_date"); return null; }
  if (c.basis !== "cash_available") { gaps.push(`${c.basis}_is_not_usable_cash`); return null; }
  if (!c.source.confirmedOn) gaps.push("cash_availability_reported_not_confirmed");
  if (c.needsReview) { gaps.push("checkpoint_invalidated_by_correction"); return null; }
  if (M.addMonths(c.source.confirmedOn || c.effectiveDate, 1) <= asOfDate) gaps.push("balance_refresh_due");
  let value = c.amountCents, ambiguous = false;
  for (const s of state.settlements.filter(s => !s.voided && s.date <= asOfDate)) {
    const leg = movementLegs(state, s).find(l => l.fundId === fund.id); if (!leg) continue;
    const treatment = c.movementTreatments.find(t => t.movementId === s.id)?.treatment;
    if (s.date <= c.effectiveDate && !treatment) { ambiguous = true; gaps.push(`checkpoint_inclusion_unknown:${s.id}`); }
    else if (s.date > c.effectiveDate || treatment === "excluded") value = sum([value, leg.cents]);
  }
  return ambiguous ? null : value;
}
function eventRows(state, asOfDate, horizonEnd, gaps) {
  const rows = [], costs = [], gifts = [];
  for (const i of state.items.filter(active)) {
    if (i.scenarioIncluded === false) continue;
    const optional = i.status === "proposed" && i.scenarioIncluded !== true;
    for (const occurrenceDate of M.occurrenceDates(i)) {
      const when = occurrenceDate ? { date: occurrenceDate, assumption: "monthly_schedule" } : M.resolveTiming(i.timing, i.direction === "income");
      const paid = settled(state, i.id, occurrenceDate);
      let amount = i.amountCents === null ? null : i.amountCents - paid;
      if (i.coversItemIds.length) {
        const covered = i.coversItemIds.map(id => M.find(state, "items", id));
        if (covered.some(c => c.amountCents === null)) { amount = null; gaps[i.fundId].push(`covered_cost_unknown:${i.id}`); }
        else if (amount !== null) {
          const included = sum(covered.map(c => c.amountCents));
          if (included > i.amountCents) gaps[i.fundId].push(`included_costs_exceed_estimate:${i.id}`);
          amount = Math.max(0, amount - included);
        }
      }
      if (amount === 0) continue;
      // A recurring operating schedule is evaluated only through the rolling
      // year; earlier unpaid occurrences remain explicit overdue exposure.
      if (occurrenceDate && occurrenceDate > horizonEnd) continue;
      const row = { id: i.id, fundId: i.fundId, planId: i.planId, title: i.title, direction: i.direction, status: i.status,
        amountCents: amount, occurrenceDate, date: when.date, assumption: when.assumption, originalTiming: i.timing,
        optional, overdue: Boolean(when.date && when.date < asOfDate), financing: false };
      (i.direction === "income" ? gifts : costs).push(row);
      if (optional) continue;
      if (amount === null) { gaps[i.fundId].push(`amount_unknown:${i.id}`); continue; }
      if (!when.date) { gaps[i.fundId].push(`date_unknown:${i.id}`); continue; }
      if (row.overdue && i.direction === "income") { gaps[i.fundId].push(`gift_overdue_reassess:${i.id}`); continue; }
      if (row.overdue) gaps[i.fundId].push(`expense_overdue:${i.id}`);
      rows.push({ ...row, date: when.date < asOfDate ? asOfDate : when.date, cents: amount * (i.direction === "income" ? 1 : -1) });
    }
  }
  for (const a of state.advances.filter(a => a.status !== "cancelled" && a.scenarioIncluded !== false)) {
    if (a.status === "proposed" && a.scenarioIncluded !== true) continue;
    const source = M.find(state, "funds", a.fromFundId);
    const both = message => { gaps[a.fromFundId].push(message); gaps[a.toFundId].push(message); };
    if (!a.repaymentSource) both(`repayment_source_unknown:${a.id}`);
    if (!source.lenderCoverageConfirmedOn || M.addMonths(source.lenderCoverageConfirmedOn, 1) <= asOfDate) both(`lender_capacity_unverified:${a.id}`);
    if (!source.restrictionConfirmed || (source.restriction && !a.restrictionUseConfirmed)) { both(`advance_restriction_unconfirmed:${a.id}`); continue; }
    const s = state.settlements.filter(s => s.advanceId === a.id && !s.voided && s.date <= asOfDate);
    const disbursed = sum(s.filter(s => s.kind === "advance").map(s => s.amountCents)), repaid = sum(s.filter(s => s.kind === "repayment").map(s => s.amountCents));
    if (a.amountCents === null) { both(`advance_amount_unknown:${a.id}`); continue; }
    const transfer = M.resolveTiming(a.timing, true), repay = M.resolveTiming(a.repaymentTiming, true);
    const plannedPrincipal = a.amountCents - disbursed;
    let futureTransferIncluded = false;
    for (const [kind, amount, t, from, to] of [["advance", plannedPrincipal, transfer, a.fromFundId, a.toFundId], ["repayment", a.amountCents - repaid, repay, a.toFundId, a.fromFundId]]) {
      if (!amount) continue;
      if (!t.date || t.date < asOfDate) { both(`${kind}_timing_reassess:${a.id}`); continue; }
      if (kind === "repayment" && plannedPrincipal && (!futureTransferIncluded || t.date < transfer.date)) { both(`repayment_precedes_confirmed_funding:${a.id}`); continue; }
      rows.push({ id: a.id, title: a.title, fundId: from, date: t.date, cents: -amount, direction: "cost", status: "committed", financing: true, kind, assumption: t.assumption });
      rows.push({ id: a.id, title: a.title, fundId: to, date: t.date, cents: amount, direction: "income", status: "committed", financing: true, kind, assumption: t.assumption });
      if (kind === "advance") futureTransferIncluded = true;
    }
  }
  return { rows, costs, gifts };
}
function timeline(cash, events, asOfDate, end, cushion, view) {
  if (cash === null) return { firstShortage: null, lowestBalanceCents: null, endingBalanceCents: null, firstCushionBreach: null, weekly: [], monthly: [], calculable: false };
  const rows = events.filter(e => e.date <= end && (e.direction === "cost" || view === "potential" || (view === "expected" && e.status === "committed")))
    .sort((a, b) => a.date.localeCompare(b.date) || a.cents - b.cents || a.id.localeCompare(b.id));
  // Outflows before inflows on the same date: conservative and explicitly labelled.
  let balance = cash, low = cash, shortage = cash < 0 ? { date: asOfDate, amountCents: -cash } : null;
  let breach = cushion !== null && cash < cushion ? { date: asOfDate, amountCents: cushion - cash } : null;
  const week = new Map(), month = new Map();
  const buckets = (date, cents) => {
    const m = date.slice(0, 7); if (!month.has(m)) month.set(m, { period: m, netCents: 0 }); month.get(m).netCents += cents;
    if (date <= M.addDays(asOfDate, 89)) { const w = Math.floor((Date.parse(date) - Date.parse(asOfDate)) / 86400000 / 7); if (!week.has(w)) week.set(w, { from: M.addDays(asOfDate, w * 7), netCents: 0 }); week.get(w).netCents += cents; }
  };
  for (const e of rows) {
    balance = sum([balance, e.cents]); low = Math.min(low, balance);
    if (balance < 0 && !shortage) shortage = { date: e.date, amountCents: -balance };
    if (cushion !== null && balance < cushion && !breach) breach = { date: e.date, amountCents: cushion - balance };
    buckets(e.date, e.cents);
  }
  let wBalance = cash, mBalance = cash;
  for (let i = 0; i < 13; i++) if (!week.has(i)) week.set(i, { from: M.addDays(asOfDate, i * 7), netCents: 0 });
  for (let d = asOfDate.slice(0, 7) + "-01"; d <= end; d = M.addMonths(d, 1)) if (!month.has(d.slice(0, 7))) month.set(d.slice(0, 7), { period: d.slice(0, 7), netCents: 0 });
  return { firstShortage: shortage, lowestBalanceCents: low, endingBalanceCents: balance, firstCushionBreach: breach, calculable: true,
    weekly: [...week.entries()].sort((a,b) => a[0]-b[0]).map(([,r]) => ({ ...r, endingBalanceCents: (wBalance += r.netCents) })),
    monthly: [...month.values()].sort((a,b) => a.period.localeCompare(b.period)).map(r => ({ ...r, endingBalanceCents: (mBalance += r.netCents) })) };
}
function forecast(original, input, deps) {
  M.access(deps);
  const asOfDate = M.day(input.asOfDate || M.today(deps));
  if (asOfDate !== M.today(deps)) M.fail("First-release forecasts use today's Pacific date; historical forecasts are not reconstructed");
  if (input.organization) M.choice(input.organization, ["fbc", "bhe", "gom"], "organization");
  if (input.fundId) M.find(original, "funds", input.fundId);
  const state = applyScenario(original, input.scenario), end = M.addDays(M.addMonths(asOfDate, 12), -1);
  const gaps = Object.fromEntries(state.funds.map(f => [f.id, []]));
  const events = eventRows(state, asOfDate, end, gaps);
  const funds = state.funds.filter(f => (!input.organization || f.organization === input.organization) && (!input.fundId || f.id === input.fundId)).map(f => {
    const limitations = gaps[f.id], cash = currentCash(state, f, asOfDate, limitations);
    if (!f.restrictionConfirmed) limitations.push("fund_use_restrictions_unconfirmed");
    if (f.cushionCents === null) limitations.push("cushion_not_defined");
    if (!f.lenderCoverageConfirmedOn) limitations.push("whole_organization_capacity_not_verified");
    for (const id of f.planIds) { const p = M.find(state, "plans", id); if (!p.costCoverageConfirmedOn || M.addMonths(p.costCoverageConfirmedOn, 1) <= asOfDate) limitations.push(`cost_coverage_needs_review:${id}`); }
    const costs = events.costs.filter(c => c.fundId === f.id), gifts = events.gifts.filter(g => g.fundId === f.id), rows = events.rows.filter(e => e.fundId === f.id);
    const expense = sum(costs.filter(c => !c.optional).map(c => c.amountCents || 0));
    const eligibleGifts = gifts.filter(g => g.status === "committed" && !g.overdue);
    const unknownAmounts = costs.some(c => !c.optional && c.amountCents === null) || eligibleGifts.some(g => g.amountCents === null);
    const financingCash = sum(state.settlements.filter(s => !s.voided && s.advanceId && s.date <= asOfDate).flatMap(s => movementLegs(state, s)).filter(l => l.fundId === f.id).map(l => l.cents));
    const fundingGap = cash === null || unknownAmounts ? null : Math.max(0, expense - sum(eligibleGifts.map(g => g.amountCents)) - (cash - financingCash));
    const allocation = sum(f.allocations.map(a => a.amountCents));
    if (cash !== null && allocation + (f.cushionCents || 0) > cash) limitations.push("allocations_and_cushion_exceed_cash");
    const views = Object.fromEntries(["available", "expected", "potential"].map(v => [v, timeline(cash, rows, asOfDate, end, f.cushionCents, v)]));
    const plannedCosts = costs.filter(c => !c.optional);
    return { fundId: f.id, name: f.name, organization: f.organization, active: f.active,
      cashCents: cash, balanceEffectiveDate: f.checkpoint?.effectiveDate || null, balanceConfirmedOn: f.checkpoint?.source.confirmedOn || null,
      balanceSource: f.checkpoint?.source || null, balanceBasis: f.checkpoint?.basis || null,
      usableCashCents: f.restrictionConfirmed ? cash : null, restriction: f.restriction,
      allocatedCents: allocation, cushionCents: f.cushionCents,
      unallocatedAfterCushionCents: cash === null || !f.restrictionConfirmed ? null : cash - allocation - (f.cushionCents || 0),
      uncommittedAfterCushionCents: cash === null || !f.restrictionConfirmed ? null : cash - sum(costs.filter(c => c.status === "committed").map(c => c.amountCents || 0)) - (f.cushionCents || 0),
      knownRemainingCostCents: expense, committedCostCents: sum(costs.filter(c => c.status === "committed").map(c => c.amountCents || 0)),
      expectedGiftCents: sum(eligibleGifts.map(g => g.amountCents || 0)), remainingFundingNeedCents: fundingGap,
      needBasis: "entered remaining project costs; recurring operating costs through rolling year; financing excluded; coverage limitations apply",
      shortageType: fundingGap === null ? "undetermined" : fundingGap > 0 ? (views.expected.firstShortage ? "funding_and_timing" : "funding_gap") : views.expected.firstShortage ? "timing_shortage" : "none_in_entered_information",
      views, costs, gifts, financingEvents: rows.filter(r => r.financing),
      plans: f.planIds.map(id => {
        const p = M.find(state, "plans", id), a = f.allocations.find(a => a.planId === id)?.amountCents ?? null;
        const c = plannedCosts.filter(c => c.planId === id), g = eligibleGifts.filter(g => g.planId === id);
        return { planId: id, name: p.name, active: p.active, allocatedCents: a, knownRemainingCostCents: sum(c.map(c => c.amountCents || 0)),
          remainingFundingNeedCents: a === null || c.some(c => c.amountCents === null) || g.some(g => g.amountCents === null) ? null : Math.max(0, sum(c.map(c => c.amountCents)) - a - sum(g.map(g => g.amountCents))),
          allocationBasis: "reservation within shared fund; not additional cash; fund-wide timeline governs availability" };
      }),
      limitations: [...new Set(limitations)], decision: { assessment: limitations.length ? "review_assumptions_and_gaps" : views.expected.firstShortage ? "funding_or_timing_decision_needed" : "within_entered_forecast",
        neededBy: views.expected.firstShortage?.date || null, approvalGranted: false } };
  });
  return { version: original.version, asOfDate, horizonEnd: end, currency: "USD", scenario: Boolean(input.scenario?.length), saved: false,
    sameDayAssumption: "costs before receipts; intraday order is unconfirmed", scope: "selected funds/projects only; not whole-organization solvency",
    ...M.page(funds, input, M.hash({ version: original.version, organization: input.organization || "", fundId: input.fundId || "", scenario: input.scenario || [], asOfDate })),
    organizationTotals: ["fbc", "bhe", "gom"].map(organization => {
      const selected = funds.filter(f => f.organization === organization);
      return { organization, fundCount: selected.length, cashCents: selected.some(f => f.cashCents === null) ? null : sum(selected.map(f => f.cashCents)),
        knownRemainingCostCents: sum(selected.map(f => f.knownRemainingCostCents)), fundsAreNotInterchangeable: true };
    }),
    guidance: "Lead with usable cash, obligations, shortage, funding need and decision. Explain limitations. Cash already contains reported receipts: never add receipts again. An advance is not giving. No approval, task or message has been created." };
}
module.exports = { forecast, applyScenario, timeline, currentCash };
