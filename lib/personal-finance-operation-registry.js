"use strict";
const M = require("./personal-finance-model"), service = require("./personal-finance-service");
const definitions = [
  ["getPersonalSettings", "query", [], []],
  ["listPersonalRecords", "query", ["kind"], ["accountId", "from", "through", "limit", "cursor"]],
  ["getPersonalRecord", "query", ["kind", "id"], []],
  ["getPersonalHistory", "query", [], ["afterVersion", "limit"]],
  ["previewPersonalImport", "query", ["input"], []],
  ["buildPersonalForecast", "query", [], ["asOfDate", "scenarioId", "scenario", "includeDetail"]],
  ["comparePersonalBudgets", "query", ["baselineId", "proposalId"], ["month"]],
  ["savePersonalRecord", "command", ["expectedVersion", "kind", "record"], []],
  ["savePersonalSettings", "command", ["expectedVersion", "settings"], []],
  ["commitPersonalImport", "command", ["expectedVersion", "input", "previewHash"], []]
];
const contracts = {
  source: "{system:bank|ynab|manual,reference:string,observedOn:YYYY-MM-DD}; source identifiers only, never credentials or full account numbers.",
  accounts: "{id,name,type:checking|savings|credit_card|loan|brokerage,currency:USD,includeInSpendable?:boolean,active?:boolean}. Savings excluded unless explicitly included. Debt balances use negative amounts owed. Brokerage is observation-only and always excluded from spendable cash; no transactions, schedules, budget allocations or scenario movements on brokerage accounts in this version.",
  transactions: "Import only: {accountId,externalId,date,amountCents:signed integer,status:pending|posted|void,kind:expense|income|transfer|card_payment,payee?,splits?:[{categoryId,amountCents:signed}],source,matchId?,distinctConfirmed?,scheduleId?,occurrenceDate?,transferId?}. Positive increases account balance; purchases decrease cash or increase debt (negative). Refunds are positive expense-kind records. Split sum equals signed transaction amount. Card payments/transfers have no spending splits; pair both sides with transferId. Explicitly link actual schedule occurrences to avoid projecting them again. matchId resolves same event across sources/pending-to-posted; distinctConfirmed explicitly confirms a separate event despite duplicate warning.",
  balances: "{id,accountId,date,amountCents:signed,source,treatments:[{transactionId,included:boolean}]}. Immutable dated checkpoint, not a payment. Explicit included/excluded treatment required for every imported event on/before checkpoint date. Later financial corrections invalidate checkpoint. Use a new ID to reconcile.",
  budgets: "{id,name,month:YYYY-MM,type:ynab|proposal,categories:[{categoryId,accountId?,plannedCents:integer|null,assignedCents?:signed|null,availableCents?:signed|null}],source,repeatMonthly?:boolean,forecastEnabled?:boolean}. Import preserves YNAB data with forecastEnabled=false. Save a proposal and explicitly enable planned spending to forecast; assigned/available allocations never become expenses automatically. Empty categories permit an explicitly schedule-only spending plan. Select baselineBudgetId in settings.",
  schedules: "{id,name,accountId,toAccountId?,kind:income|expense|transfer|card_payment,amountCents:nonnegative integer|null,categoryId?,startDate?:YYYY-MM-DD,endDate?:YYYY-MM-DD,frequency:once|weekly|biweekly|monthly,source,active?:boolean}. Transfer/card_payment requires destination. Missing amount/date stays a coverage gap. Explicit debt payment amounts must include planned interest/fees in the appropriate expense schedule; no loan amortization inferred.",
  scenarios: "{id,name,budgetId?,additions:[schedule]} max20. Adds hypothetical income, expenses or payments; budgetId optionally replaces spending plan for comparison. Saved proposals never alter baseline automatically. Temporary scenario passed to forecast is never saved.",
  settings: "{reserveCents:nonnegative integer|null,baselineBudgetId?,coverageConfirmedOn?:YYYY-MM-DD,coverageThrough?:YYYY-MM-DD,notes?}. Explicit zero reserve allowed; null unresolved. Confirmation must come from Dan that account/income/bill/debt/budget coverage is complete through stated date; never infer from a read or import. Confirmations older than 30 days and balances older than 7 days qualify forecasts.",
  import: "input:{reference,transactions?:[transaction] max100,budgets?:[budget] max20}. Create accounts first. Read previewPersonalImport, show changes/conflicts, obtain approval for that concrete import, then commit identical input with returned previewHash and current expectedVersion. Resolve all conflicts first. Independent getPersonalRecord verification after commit. Imports are source-read-only, user-initiated, no external execution.",
  money: "Only USD supported; all amounts safe integer cents. Currency conversion and unsupported currencies must be reported as coverage gaps outside this USD workspace, never silently converted or discarded.",
  forecast: "Default compact monthly/account results; includeDetail:true adds 90 daily points and explanatory events. Rolling twelve months from today's Pacific date. Missing coverage means unresolved, not affordable. Within-plan is a conditional calculation, never spending authorization. Actual-plus-pending category totals require complete imports for the compared month.",
  editing: "savePersonalRecord supports accounts/balances/budgets(proposal only)/schedules/scenarios. Full replacement of editable fields; retrieve current record first, remove revision/updatedAt metadata, preserve other fields. Global expectedVersion and stable idempotencyKey required for every command. Balance checkpoints and source import history are immutable. Reads and previews do not persist. All collection lists paginated; follow cursor. History records preserve prior changes.",
  brokerage: "Brokerage balances use amountCents for observed total account value, never projected cash. Optional brokerageDetails:{date:YYYY-MM-DD,cashBalanceCents?:signed|null,securitiesValueCents?:nonnegative|null,settledFundsCents?:nonnegative|null,cashAvailableToWithdrawCents?:nonnegative|null} retains separately dated source details; missing values remain null. No margin buying power or borrowing included. previewPersonalImport/commitPersonalImport also accept input.brokerageAccounts:[account] max10 and input.brokerageBalances:[balance] max10, atomically creating accounts before immutable observations. Require reviewed preview/hash/version. Identical reimports unchanged; conflicting checkpoint IDs require review and new dated IDs. Forecast brokerageObservations are separate, non-projected snapshots. No investment return assumptions, lot/trade accounting, or brokerage cash transfer projections. Do not relabel investment transfers as income; missing reconciliation/coverage remains unresolved."
};
function listOperations(input, deps) {
  M.access(deps); M.shape(input, ["mode", "query"]);
  return { catalogVersion: "1.1.0", domain: "personal_finance", owner: "dan", access: "exact_dan_subject_only", contracts,
    operations: definitions.filter(d => (!input.mode || d[1] === input.mode) && (!input.query || d[0].toLowerCase().includes(String(input.query).toLowerCase()))).map(([name, mode, required, optional]) => ({ name, mode, required, optional })) };
}
async function run(input, deps) {
  M.access(deps); M.shape(input, ["operation", "mode", "arguments", "idempotencyKey"]);
  const def = definitions.find(d => d[0] === input.operation && d[1] === input.mode); if (!def) M.fail("Unknown operation or incorrect mode");
  const args = input.arguments || {}; M.shape(args, [...def[2], ...def[3]]);
  if (def[2].some(k => args[k] === undefined)) M.fail("Required operation argument missing");
  return { operation: input.operation, result: input.mode === "query" ? await service.query(input.operation, args, deps) : await service.command(input.operation, args, input.idempotencyKey, deps) };
}
module.exports = { listOperations, run };
