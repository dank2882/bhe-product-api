"use strict";
// Reuse the established exact-primary-subject gate and date/money primitives.
const F = require("./finance-forecast-model");
function safeId(v) { const result = F.id(v); if (["__proto__", "prototype", "constructor"].includes(result)) F.fail("Reserved identifier"); return result; }
const kinds = ["accounts", "transactions", "balances", "budgets", "schedules", "scenarios", "imports"];
const fail = (message, code = "personal_finance_invalid_input", statusCode = 400) => F.fail(message, code, statusCode);
function source(v, deps) {
  F.shape(v, ["system", "reference", "observedOn"]);
  const result = { system: F.choice(v.system, ["bank", "ynab", "manual"], "source system"), reference: F.text(v.reference, "source reference", 500), observedOn: F.day(v.observedOn) };
  if (result.observedOn > F.today(deps)) fail("Source observation cannot be in the future");
  return result;
}
const optionalId = v => v ? safeId(v) : "";
function bool(v, fallback = false) { if (v === undefined) return fallback; if (typeof v !== "boolean") fail("Expected a boolean"); return v; }
function array(v, max = 100) { if (!Array.isArray(v) || v.length > max) fail(`Expected an array with at most ${max} entries`); return v; }
function amount(v, signed = false) { return F.money(v, false, signed); }
function account(v) {
  F.shape(v, ["id", "name", "type", "currency", "includeInSpendable", "active"]);
  const type = F.choice(v.type, ["checking", "savings", "credit_card", "loan", "brokerage"], "account type");
  const includeInSpendable = bool(v.includeInSpendable, type === "checking");
  if (includeInSpendable && ["credit_card", "loan"].includes(type)) fail("Credit is not spendable cash");
  if (includeInSpendable && type === "brokerage") fail("Brokerage observations are excluded from spendable cash");
  return { id: safeId(v.id), name: F.text(v.name, "account name", 200), type, currency: F.choice(v.currency, ["USD"], "currency (only USD supported)"), includeInSpendable, active: bool(v.active, true) };
}
function splits(v, total) {
  const result = array(v || []).map(x => { F.shape(x, ["categoryId", "amountCents"]); return { categoryId: safeId(x.categoryId), amountCents: amount(x.amountCents, true) }; });
  if (result.length && result.reduce((n, x) => n + x.amountCents, 0) !== total) fail("Split amounts must equal the transaction amount");
  return result;
}
function transaction(v, deps) {
  F.shape(v, ["id", "accountId", "externalId", "date", "amountCents", "status", "kind", "payee", "splits", "source", "matchId", "distinctConfirmed", "scheduleId", "occurrenceDate", "transferId"]);
  const money = amount(v.amountCents, true), date = F.day(v.date), status = F.choice(v.status, ["pending", "posted", "void"], "transaction status");
  if (date > F.today(deps)) fail("Actual transactions cannot have a future date; use schedules");
  const result = { accountId: safeId(v.accountId), externalId: F.text(v.externalId, "stable source transaction ID", 200), date, amountCents: money, status,
    kind: F.choice(v.kind, ["expense", "income", "transfer", "card_payment"], "transaction kind"), payee: F.text(v.payee, "payee", 200, true), splits: splits(v.splits, money), source: source(v.source, deps),
    scheduleId: optionalId(v.scheduleId), occurrenceDate: v.occurrenceDate ? F.day(v.occurrenceDate) : "", transferId: optionalId(v.transferId) };
  if (Boolean(result.scheduleId) !== Boolean(result.occurrenceDate)) fail("Schedule link requires its occurrence date");
  if (result.source.observedOn < date) fail("Transaction observation precedes its date");
  if (["transfer", "card_payment"].includes(result.kind) && result.splits.length) fail("Transfers and card payments cannot be category spending");
  return result;
}
function balance(v, deps) {
  F.shape(v, ["id", "accountId", "date", "amountCents", "source", "treatments", "brokerageDetails"]);
  const date = F.day(v.date); if (date > F.today(deps)) fail("Balance cannot be future dated");
  const treatments = array(v.treatments || [], 20000).map(x => { F.shape(x, ["transactionId", "included"]); return { transactionId: safeId(x.transactionId), included: bool(x.included) }; });
  if (new Set(treatments.map(x => x.transactionId)).size !== treatments.length) fail("Duplicate balance treatment");
  const origin = source(v.source, deps); if (origin.observedOn < date) fail("Balance observation precedes its date");
  const result = { id: safeId(v.id), accountId: safeId(v.accountId), date, amountCents: amount(v.amountCents, true), source: origin, treatments };
  if (v.brokerageDetails !== undefined) {
    const detail = v.brokerageDetails;
    F.shape(detail, ["date", "cashBalanceCents", "securitiesValueCents", "settledFundsCents", "cashAvailableToWithdrawCents"]);
    const detailDate = F.day(detail.date);
    if (detailDate > origin.observedOn) fail("Brokerage detail date cannot follow observation");
    result.brokerageDetails = { date: detailDate };
    for (const key of ["cashBalanceCents", "securitiesValueCents", "settledFundsCents", "cashAvailableToWithdrawCents"]) result.brokerageDetails[key] = detail[key] == null ? null : amount(detail[key], key === "cashBalanceCents");
  }
  return result;
}
function budget(v, deps) {
  F.shape(v, ["id", "month", "type", "name", "categories", "source", "repeatMonthly", "forecastEnabled"]);
  if (!/^\d{4}-\d{2}$/.test(v.month || "")) fail("Budget month must be YYYY-MM"); F.day(`${v.month}-01`);
  const categories = array(v.categories).map(x => {
    F.shape(x, ["categoryId", "accountId", "plannedCents", "assignedCents", "availableCents"]);
    return { categoryId: safeId(x.categoryId), accountId: optionalId(x.accountId), plannedCents: x.plannedCents == null ? null : amount(x.plannedCents), assignedCents: x.assignedCents == null ? null : amount(x.assignedCents, true), availableCents: x.availableCents == null ? null : amount(x.availableCents, true) };
  });
  if (new Set(categories.map(x => x.categoryId)).size !== categories.length) fail("Duplicate budget category");
  return { id: safeId(v.id), name: F.text(v.name, "budget name", 200), month: v.month, type: F.choice(v.type, ["ynab", "proposal"], "budget type"), categories, source: source(v.source, deps), repeatMonthly: bool(v.repeatMonthly), forecastEnabled: bool(v.forecastEnabled) };
}
function schedule(v, deps) {
  F.shape(v, ["id", "name", "accountId", "toAccountId", "kind", "amountCents", "categoryId", "startDate", "endDate", "frequency", "source", "active"]);
  const result = { id: safeId(v.id), name: F.text(v.name, "schedule name", 200), accountId: safeId(v.accountId), toAccountId: optionalId(v.toAccountId), kind: F.choice(v.kind, ["income", "expense", "transfer", "card_payment"], "schedule kind"), amountCents: v.amountCents == null ? null : amount(v.amountCents), categoryId: optionalId(v.categoryId), startDate: v.startDate ? F.day(v.startDate) : "", endDate: v.endDate ? F.day(v.endDate) : "", frequency: F.choice(v.frequency, ["once", "weekly", "biweekly", "monthly"], "frequency"), source: source(v.source, deps), active: bool(v.active, true) };
  if (result.endDate && result.startDate && result.endDate < result.startDate) fail("Schedule end precedes start");
  if (["transfer", "card_payment"].includes(result.kind) !== Boolean(result.toAccountId)) fail("Transfers require both accounts; income/expenses have one account");
  if (result.toAccountId === result.accountId) fail("Transfer accounts must differ");
  return result;
}
function scenario(v, deps) {
  F.shape(v, ["id", "name", "budgetId", "additions"]);
  return { id: safeId(v.id), name: F.text(v.name, "scenario name", 200), budgetId: optionalId(v.budgetId), additions: array(v.additions || [], 20).map(x => schedule(x, deps)) };
}
function settings(v, deps) {
  F.shape(v, ["reserveCents", "baselineBudgetId", "coverageConfirmedOn", "coverageThrough", "notes"]);
  const result = { reserveCents: v.reserveCents == null ? null : amount(v.reserveCents), baselineBudgetId: optionalId(v.baselineBudgetId), coverageConfirmedOn: v.coverageConfirmedOn ? F.day(v.coverageConfirmedOn) : "", coverageThrough: v.coverageThrough ? F.day(v.coverageThrough) : "", notes: F.text(v.notes, "coverage notes", 1000, true) };
  if (result.coverageConfirmedOn > F.today(deps)) fail("Coverage confirmation cannot be future dated");
  return result;
}
function find(s, kind, id) { const r = s[kind].find(x => x.id === safeId(id)); if (!r) fail("Record not found", "personal_finance_not_found", 404); return r; }
function references(s, kind, r) {
  const check = id => { if (id) find(s, "accounts", id); };
  if (["transactions", "balances", "schedules"].includes(kind)) { check(r.accountId); check(r.toAccountId); }
  if (kind === "budgets") r.categories.forEach(x => check(x.accountId));
  if (kind === "scenarios") { if (r.budgetId) find(s, "budgets", r.budgetId); r.additions.forEach(x => references(s, "schedules", x)); }
  const accountIds = kind === "budgets" ? r.categories.map(c => c.accountId) : [r.accountId, r.toAccountId];
  const brokerage = accountIds.filter(Boolean).some(id => find(s, "accounts", id).type === "brokerage");
  if (["transactions", "schedules", "budgets"].includes(kind) && brokerage) fail("Brokerage supports balance observations only; investment activity and cash transfer projections require separate reconciliation");
  if (kind === "balances") {
    if (!brokerage && r.brokerageDetails) fail("Brokerage details require a brokerage account");
    if (brokerage && r.treatments.length) fail("Brokerage observations cannot reconcile cash transactions");
  }
  if (kind === "transactions" && r.scheduleId) {
    const schedule = find(s, "schedules", r.scheduleId);
    if (![schedule.accountId, schedule.toAccountId].includes(r.accountId) || schedule.kind !== r.kind) fail("Transaction schedule link does not match");
    if (!require("./personal-finance-engine").occurrences(schedule, r.occurrenceDate).includes(r.occurrenceDate)) fail("Transaction occurrence is outside its schedule");
  }
}
module.exports = { ...F, id: safeId, fail, kinds, source, bool, array, amount, account, transaction, balance, budget, schedule, scenario, settings, find, references };
