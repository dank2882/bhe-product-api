"use strict";
const M = require("./personal-finance-model");
const { transactionFingerprint } = require("./personal-finance-service");
const sum = xs => { const n = xs.reduce((a, b) => a + b, 0); if (!Number.isSafeInteger(n)) M.fail("Calculation exceeds exact integer range"); return n; };
function occurrences(s, end) {
  if (!s.startDate) return [];
  const result = [];
  for (let n = 0; n < 4000; n++) {
    const date = s.frequency === "monthly" ? M.addMonths(s.startDate, n) : M.addDays(s.startDate, n * (s.frequency === "biweekly" ? 14 : s.frequency === "weekly" ? 7 : 1));
    if (date > end || (s.endDate && date > s.endDate)) return result;
    result.push(date); if (s.frequency === "once") return result;
  }
  M.fail("Schedule history exceeds supported horizon; archive the old schedule and create its continuation");
}
function categorySpending(state, month, categoryId) {
  return -sum(state.transactions.filter(t => t.status !== "void" && t.kind === "expense" && t.date.startsWith(month)).flatMap(t => t.splits.filter(x => x.categoryId === categoryId).map(x => x.amountCents)));
}
function compareBudgets(state, args) {
  const base = M.find(state, "budgets", args.baselineId), proposed = M.find(state, "budgets", args.proposalId);
  if (proposed.type !== "proposal") M.fail("Comparison requires a proposed budget");
  const month = args.month || proposed.month; M.day(`${month}-01`);
  const ids = [...new Set([...base.categories, ...proposed.categories].map(x => x.categoryId))].sort();
  return { version: state.version, month, baselineId: base.id, proposalId: proposed.id, categories: ids.map(categoryId => {
    const a = base.categories.find(x => x.categoryId === categoryId), b = proposed.categories.find(x => x.categoryId === categoryId);
    return { categoryId, importedAssignedCents: a?.assignedCents ?? null, importedAvailableCents: a?.availableCents ?? null, baselinePlannedCents: a?.plannedCents ?? null, proposedPlannedCents: b?.plannedCents ?? null, actualAndPendingSpendingCents: categorySpending(state, month, categoryId), deltaPlannedCents: a?.plannedCents != null && b?.plannedCents != null ? b.plannedCents - a.plannedCents : null };
  }), limitations: ["YNAB assigned/available amounts are allocations, not automatic future expenses.", "Spending includes pending items and refunds; missing imported history or categories limits comparisons."] };
}
function project(state, today, end, scenario) {
  const gaps = [], events = [], accounts = state.accounts.filter(a => a.type !== "brokerage"), balances = {}, checkpoints = {}, assumptions = ["USD integer cents; Pacific calendar dates", "Expenses precede receipts on the same day", "Unscheduled category spending is placed at the beginning of its month", "Pending cash movements are placed today", "Only explicitly selected cash accounts contribute to usable cash", "Brokerage values are separate observations, never projected income, spendable cash or borrowing capacity"];
  const brokerageObservations = state.accounts.filter(a => a.type === "brokerage").map(a => {
    const latest = state.balances.filter(b => b.accountId === a.id && b.date <= today).sort((a, b) => b.date.localeCompare(a.date) || b.revision - a.revision)[0];
    return { accountId: a.id, includedInSpendable: false, date: latest?.date || null, accountValueCents: latest?.amountCents ?? null, details: latest?.brokerageDetails || null, source: latest?.source || null, freshness: !latest ? "missing" : latest.date < M.addDays(today, -7) ? "stale" : "current", projected: false };
  });
  const gap = (code, id = "") => { if (!gaps.some(g => g.code === code && g.id === id)) gaps.push({ code, id }); };
  const add = e => { if (e.amountCents) events.push(e); if (events.length > 50000) M.fail("Forecast event limit exceeded; narrow schedules before forecasting", "personal_finance_capacity", 413); };
  if (!accounts.length) gap("no_accounts");
  if (!accounts.some(a => a.includeInSpendable)) gap("no_spendable_accounts");
  if (state.settings.reserveCents === null) gap("reserve_target_missing");
  if (!state.settings.coverageConfirmedOn || state.settings.coverageConfirmedOn < M.addDays(today, -30)) gap("coverage_confirmation_missing_or_stale");
  if (!state.settings.coverageThrough || state.settings.coverageThrough < end) gap("income_bills_and_budget_coverage_incomplete");
  for (const a of accounts) {
    const cp = state.balances.filter(b => b.accountId === a.id && b.date <= today).sort((a, b) => b.date.localeCompare(a.date) || b.revision - a.revision)[0];
    checkpoints[a.id] = cp || null; balances[a.id] = cp?.amountCents ?? 0;
    if (!cp) gap("balance_missing", a.id);
    else if (cp.date < M.addDays(today, -7)) gap("balance_stale", a.id);
    if (!a.active && (cp?.amountCents || state.schedules.some(s => s.active && [s.accountId, s.toAccountId].includes(a.id)))) gap("inactive_account_has_exposure", a.id);
    for (const t of state.transactions.filter(t => t.accountId === a.id && t.status !== "void")) {
      const treatment = cp?.treatments.find(x => x.transactionId === t.id);
      if (cp && t.date <= cp.date && !treatment) gap("checkpoint_transaction_treatment_missing", t.id);
      if (treatment && treatment.fingerprint !== transactionFingerprint(t)) gap("checkpoint_invalidated_by_transaction_change", t.id);
      const included = treatment?.included === true;
      if (!included && t.status === "posted" && cp && (t.date > cp.date || treatment?.included === false)) balances[a.id] = sum([balances[a.id], t.amountCents]);
      if (!included && t.status === "pending") add({ date: today, accountId: a.id, amountCents: t.amountCents, origin: "pending", id: t.id, categoryId: "" });
    }
    // Voiding an event previously included in a checkpoint also needs reconciliation.
    for (const treatment of cp?.treatments || []) {
      const t = state.transactions.find(t => t.id === treatment.transactionId);
      if (!t || transactionFingerprint(t) !== treatment.fingerprint) gap("checkpoint_invalidated_by_transaction_change", treatment.transactionId);
    }
  }
  for (const t of state.transactions.filter(t => t.status !== "void")) {
    if (t.scheduleId) {
      const s = state.schedules.find(s => s.id === t.scheduleId);
      if (!s || ![s.accountId, s.toAccountId].includes(t.accountId) || s.kind !== t.kind || !occurrences(s, t.occurrenceDate).includes(t.occurrenceDate)) gap("transaction_schedule_link_invalidated", t.id);
    }
    if (t.evidence.some(e => !(t.status === "posted" && e.transaction.status === "pending") && (e.transaction.amountCents !== t.amountCents || (e.transaction.status === "posted" && e.transaction.date !== t.date)))) gap("source_observations_disagree", t.id);
    if (t.kind === "expense" && !t.splits.length) gap("transaction_category_missing", t.id);
    if (["transfer", "card_payment"].includes(t.kind)) {
      const pair = t.transferId && state.transactions.filter(x => x.transferId === t.transferId && x.status !== "void");
      if (!pair || pair.length !== 2 || pair[0].accountId === pair[1].accountId || sum(pair.map(x => x.amountCents)) !== 0) gap("transfer_pair_unresolved", t.id);
    }
  }
  const schedules = [...state.schedules, ...(scenario?.additions || [])].filter(s => s.active);
  const plannedCategory = [];
  for (const s of schedules) {
    if (!s.startDate || s.amountCents === null) { gap("schedule_amount_or_timing_missing", s.id); continue; }
    for (const date of occurrences(s, end)) {
      const legs = [{ accountId: s.accountId, sign: s.kind === "income" ? 1 : -1 }, ...(s.toAccountId ? [{ accountId: s.toAccountId, sign: 1 }] : [])];
      for (const leg of legs) {
        const linked = state.transactions.filter(t => t.status !== "void" && t.scheduleId === s.id && t.occurrenceDate === date && t.accountId === leg.accountId);
        const settled = sum(linked.map(t => t.amountCents * leg.sign));
        if (settled < 0 || settled > s.amountCents) gap("schedule_actual_differs_from_plan", s.id);
        const remaining = Math.max(0, s.amountCents - settled);
        if (!remaining) continue;
        if (date < today) { gap("overdue_occurrence_unresolved", `${s.id}:${date}`); if (leg.sign > 0) continue; }
        const effectiveDate = date < today ? today : date;
        add({ date: effectiveDate, accountId: leg.accountId, amountCents: leg.sign * remaining, origin: "schedule", id: s.id, occurrenceDate: date, categoryId: s.categoryId });
        if (s.kind === "expense") plannedCategory.push({ date: effectiveDate, categoryId: s.categoryId, amountCents: remaining });
      }
    }
  }
  const budgetId = scenario?.budgetId || state.settings.baselineBudgetId;
  const budget = budgetId ? state.budgets.find(b => b.id === budgetId) : null;
  if (!budget?.forecastEnabled) gap("spending_budget_not_selected_or_enabled");
  if (budget?.forecastEnabled) {
    for (const s of schedules) if (budget.categories.length && s.kind === "expense" && !s.categoryId) gap("scheduled_expense_category_missing", s.id);
    const months = []; for (let date = `${today.slice(0, 7)}-01`; date <= end; date = M.addMonths(date, 1)) months.push(date.slice(0, 7));
    for (const month of months) {
      if (budget.month !== month && !(budget.repeatMonthly && month >= budget.month)) { gap("budget_month_uncovered", month); continue; }
      for (const c of budget.categories) {
        if (c.plannedCents === null || !c.accountId) { gap("category_plan_amount_or_account_missing", c.categoryId); continue; }
        const spent = categorySpending(state, month, c.categoryId), scheduled = sum(plannedCategory.filter(e => e.date.startsWith(month) && e.categoryId === c.categoryId).map(e => e.amountCents));
        // Refunds reduce actual spending; never create a negative expense event.
        const remainder = Math.max(0, c.plannedCents - spent - scheduled);
        add({ date: month === today.slice(0, 7) ? today : `${month}-01`, accountId: c.accountId, amountCents: -remainder, origin: "budget_remainder", id: budget.id, categoryId: c.categoryId });
      }
    }
  }
  for (const a of accounts.filter(a => ["credit_card", "loan"].includes(a.type))) {
    if ((balances[a.id] < 0 || events.some(e => e.accountId === a.id && e.amountCents < 0)) && !schedules.some(s => s.toAccountId === a.id && s.startDate && s.amountCents !== null)) gap("debt_payment_schedule_missing", a.id);
  }
  const spendable = accounts.filter(a => a.includeInSpendable).map(a => a.id);
  const usable = () => sum(spendable.map(id => balances[id]));
  const startBalances = { ...balances }, lows = { ...balances }, lowDates = Object.fromEntries(accounts.map(a => [a.id, today]));
  const openingUsableCents = usable(); let lowestUsableCents = openingUsableCents, lowestUsableDate = today;
  const daily = [], monthly = new Map(), ordered = events.sort((a, b) => a.date.localeCompare(b.date) || a.amountCents - b.amountCents || a.id.localeCompare(b.id));
  let cursor = 0;
  for (let date = today; date <= end; date = M.addDays(date, 1)) {
    const month = date.slice(0, 7);
    if (!monthly.has(month)) monthly.set(month, { month, openingUsableCents: usable(), incomeCents: 0, outflowCents: 0, lowestUsableCents: usable(), closingUsableCents: usable() });
    const bucket = monthly.get(month);
    while (cursor < ordered.length && ordered[cursor].date === date) {
      const e = ordered[cursor++];
      if (!(e.accountId in balances)) { gap("event_account_missing", e.id); continue; }
      balances[e.accountId] = sum([balances[e.accountId], e.amountCents]);
      if (balances[e.accountId] < lows[e.accountId]) { lows[e.accountId] = balances[e.accountId]; lowDates[e.accountId] = date; }
      if (spendable.includes(e.accountId)) { if (e.amountCents < 0) bucket.outflowCents -= e.amountCents; else bucket.incomeCents += e.amountCents; }
      const cash = usable(); if (cash < lowestUsableCents) { lowestUsableCents = cash; lowestUsableDate = date; } bucket.lowestUsableCents = Math.min(bucket.lowestUsableCents, cash);
    }
    bucket.closingUsableCents = usable();
    if (date < M.addDays(today, 90)) daily.push({ date, usableCents: usable(), accounts: { ...balances } });
  }
  const reserve = state.settings.reserveCents;
  const accountShortfalls = accounts.filter(a => ["checking", "savings"].includes(a.type) && lows[a.id] < 0).map(a => a.id);
  return { status: gaps.length ? "unresolved" : accountShortfalls.length || lowestUsableCents < reserve ? "shortfall" : "within_plan",
    gaps, assumptions, brokerageObservations, conditionalProjection: gaps.length > 0, openingUsableCents, endingUsableCents: usable(), lowestUsableCents, lowestUsableDate, reserveCents: reserve,
    reserveShortfallCents: reserve === null ? null : Math.max(0, reserve - lowestUsableCents), accountShortfalls,
    accounts: accounts.map(a => ({ id: a.id, type: a.type, includedInSpendable: a.includeInSpendable, checkpointDate: checkpoints[a.id]?.date || null, source: checkpoints[a.id]?.source || null, openingCents: startBalances[a.id], endingCents: balances[a.id], lowestCents: lows[a.id], lowestDate: lowDates[a.id] })), daily, monthly: [...monthly.values()], events: ordered };
}
function forecast(state, args, deps) {
  const today = M.today(deps); if (args.asOfDate && args.asOfDate !== today) M.fail("Forecast asOfDate must be today's Pacific date");
  const end = M.addDays(M.addMonths(today, 12), -1), baseline = project(state, today, end);
  let scenario = null;
  if (args.scenarioId && args.scenario) M.fail("Choose a saved or temporary scenario, not both");
  if (args.scenarioId) scenario = M.find(state, "scenarios", args.scenarioId);
  if (args.scenario) { scenario = M.scenario(args.scenario, deps); M.references(state, "scenarios", scenario); }
  if (scenario && new Set([...state.schedules, ...scenario.additions].map(s => s.id)).size !== state.schedules.length + scenario.additions.length) M.fail("Scenario additions need unique schedule IDs");
  const comparison = scenario ? project(state, today, end, scenario) : null;
  const strip = result => { if (args.includeDetail !== true) { delete result.daily; delete result.events; } return result; };
  return { version: state.version, engineVersion: "1.1.0", asOfDate: today, through: end, currency: "USD", saved: false, baseline: strip(baseline), ...(comparison ? { scenario: strip(comparison), difference: { endingUsableCents: comparison.endingUsableCents - baseline.endingUsableCents, lowestUsableCents: comparison.lowestUsableCents - baseline.lowestUsableCents } } : {}), guidance: "Within-plan means only within recorded assumptions, not spending approval. Unresolved projections must not be described as affordable. Reconcile flagged coverage first." };
}
module.exports = { forecast, compareBudgets, occurrences };
