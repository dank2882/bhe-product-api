"use strict";
const M = require("./personal-finance-model");
const root = deps => deps.firestoreDb.collection("danPersonalFinance").doc("workspace");
const MAX_RECORDS = 20000;
const normalize = { accounts: M.account, balances: M.balance, budgets: M.budget, schedules: M.schedule, scenarios: M.scenario };
async function readState(deps, tx) {
  M.access(deps);
  const get = ref => tx ? tx.get(ref) : ref.get(), ref = root(deps);
  // A transaction gives queries a coherent version-bound snapshot, even on reads.
  if (!tx) return deps.firestoreDb.runTransaction(t => readState(deps, t));
  const header = await get(ref), state = { version: 0, settings: M.settings({}, deps), ...(header.exists ? header.data() : {}) };
  for (const kind of M.kinds) {
    const snap = await get(ref.collection(kind).limit(MAX_RECORDS + 1));
    if (snap.docs.length > MAX_RECORDS) M.fail("Workspace exceeds supported record coverage; no partial forecast returned", "personal_finance_capacity", 413);
    state[kind] = snap.docs.map(d => d.data());
  }
  return state;
}
function sourceKey(t) { return M.hash({ accountId: t.accountId, system: t.source.system, externalId: t.externalId }); }
function transactionFingerprint(t) { return M.hash({ accountId: t.accountId, date: t.date, amountCents: t.amountCents, status: t.status }); }
function preview(state, input, deps) {
  M.shape(input, ["transactions", "budgets", "reference", "brokerageAccounts", "brokerageBalances"]);
  M.text(input.reference, "import reference", 500);
  const rows = M.array(input.transactions || [], 100), budgets = M.array(input.budgets || [], 20), working = structuredClone(state), changes = [], conflicts = [], seen = new Set();
  const brokerageAccounts = M.array(input.brokerageAccounts || [], 10), brokerageBalances = M.array(input.brokerageBalances || [], 10);
  const sameRecord = (a, b) => { const { revision, updatedAt, ...fields } = a; return M.hash(fields) === M.hash(b); };
  for (const [kind, records] of [["accounts", brokerageAccounts], ["balances", brokerageBalances]]) for (const raw of records) {
    const record = normalize[kind](raw, deps);
    if (kind === "accounts" ? record.type !== "brokerage" : M.find(working, "accounts", record.accountId).type !== "brokerage") M.fail("Brokerage import requires brokerage accounts");
    M.references(working, kind, record);
    const identity = `${kind}/${record.id}`;
    if (seen.has(identity)) M.fail("Duplicate brokerage record ID within import"); seen.add(identity);
    const old = working[kind].find(x => x.id === record.id);
    if (old && sameRecord(old, record)) continue;
    if (old && (kind === "balances" || old.type !== "brokerage")) {
      conflicts.push({ code: "brokerage_observation_conflict", kind, id: record.id }); continue;
    }
    const at = working[kind].findIndex(x => x.id === record.id);
    if (at < 0) working[kind].push(record); else working[kind][at] = record;
    changes.push({ kind, record });
  }
  for (const [index, raw] of rows.entries()) {
    const t = M.transaction(raw, deps); M.references(working, "transactions", t);
    const key = sourceKey(t); if (seen.has(key)) M.fail("Duplicate source transaction ID within import"); seen.add(key);
    const known = working.transactions.find(x => x.evidence.some(e => e.key === key));
    const matched = raw.matchId ? M.find(working, "transactions", raw.matchId) : known;
    if (known && matched?.id !== known.id) M.fail("Source identity already belongs to a different transaction");
    if (matched && matched.accountId !== t.accountId) M.fail("Matched transaction must belong to the same account");
    if (!matched && !raw.distinctConfirmed) {
      const candidates = working.transactions.filter(x => x.accountId === t.accountId && x.status !== "void" && x.amountCents === t.amountCents && Math.abs(Date.parse(x.date) - Date.parse(t.date)) <= 7 * 86400000);
      if (candidates.length) { conflicts.push({ index, code: "possible_duplicate", candidateIds: candidates.map(x => x.id) }); continue; }
    }
    if (matched && matched.status === "posted" && t.status === "pending") { conflicts.push({ index, code: "posted_to_pending", candidateIds: [matched.id] }); continue; }
    const priorEvidence = matched?.evidence.find(e => e.key === key);
    if (priorEvidence && t.source.observedOn < priorEvidence.transaction.source.observedOn) { conflicts.push({ index, code: "older_source_observation", candidateIds: [matched.id] }); continue; }
    if (priorEvidence && M.hash(priorEvidence.transaction) === M.hash(t)) continue;
    if (matched && t.source.system !== "bank" && matched.evidence.some(e => e.transaction.source.system === "bank") && (t.amountCents !== matched.amountCents || t.date !== matched.date || t.status !== matched.status)) {
      conflicts.push({ index, code: "bank_ynab_discrepancy", candidateIds: [matched.id] }); continue;
    }
    if (matched && !known && (matched.amountCents !== t.amountCents || matched.kind !== t.kind) && !(matched.status === "pending" && t.status === "posted" && t.source.system === "bank")) {
      conflicts.push({ index, code: "matched_event_discrepancy", candidateIds: [matched.id] }); continue;
    }
    const evidence = [...(matched?.evidence || []).filter(e => e.key !== key), { key, transaction: t }];
    if (evidence.length > 20) M.fail("Too many sources for one transaction");
    const bank = evidence.find(e => e.transaction.source.system === "bank")?.transaction;
    const record = { ...t, ...(bank && t.source.system !== "bank" ? bank : {}), id: matched?.id || `tx-${key}`, evidence,
      splits: t.source.system === "ynab" || !matched ? t.splits : matched.splits.length ? matched.splits : t.splits,
      scheduleId: t.scheduleId || matched?.scheduleId || "", occurrenceDate: t.occurrenceDate || matched?.occurrenceDate || "", transferId: t.transferId || matched?.transferId || "" };
    if (record.splits.length && record.splits.reduce((n, x) => n + x.amountCents, 0) !== record.amountCents) record.splits = t.splits;
    const i = working.transactions.findIndex(x => x.id === record.id); if (i < 0) working.transactions.push(record); else working.transactions[i] = record;
    changes.push({ kind: "transactions", record });
  }
  for (const raw of budgets) {
    const record = M.budget(raw, deps); M.references(working, "budgets", record);
    if (record.type !== "ynab" || record.source.system !== "ynab") M.fail("Imported budgets must preserve YNAB provenance");
    const old = working.budgets.find(x => x.id === record.id);
    if (old?.type === "proposal") M.fail("Import cannot overwrite a proposed budget");
    // Import never approves projected spending or enables a forecast implicitly.
    record.forecastEnabled = false;
    if (!old || M.hash({ ...old, revision: undefined, updatedAt: undefined }) !== M.hash(record)) changes.push({ kind: "budgets", record });
  }
  if (new Set(changes.map(x => `${x.kind}/${x.record.id}`)).size !== changes.length) M.fail("Multiple changes to the same record in one import; split the batch");
  return { version: state.version, previewHash: M.hash({ version: state.version, input }), changes, conflicts, canCommit: !conflicts.length, unchangedCount: rows.length + budgets.length + brokerageAccounts.length + brokerageBalances.length - changes.length - conflicts.length };
}
function applyRecord(state, kind, value, deps) {
  if (!normalize[kind]) M.fail("Record kind is not directly editable");
  const record = normalize[kind](value, deps); M.references(state, kind, record);
  const old = state[kind].find(x => x.id === record.id);
  if (kind === "accounts" && old && old.type !== record.type) M.fail("Account type cannot be reassigned");
  if (kind === "balances") {
    if (old) M.fail("Balance checkpoints are immutable; record a new checkpoint");
    for (const treatment of record.treatments) {
      const t = M.find(state, "transactions", treatment.transactionId);
      if (t.accountId !== record.accountId || t.date > record.date) M.fail("Balance treatment must reference this account on/before checkpoint date");
      treatment.fingerprint = transactionFingerprint(t);
    }
  }
  if (kind === "budgets" && record.type !== "proposal") M.fail("Use import for YNAB budgets; create a proposal for changes");
  return record;
}
async function command(operation, args, key, deps) {
  const actor = M.access(deps); M.text(key, "idempotencyKey", 180); if (key.length < 8) M.fail("Idempotency key too short");
  if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion < 0) M.fail("expectedVersion is required");
  const ref = root(deps), receiptRef = ref.collection("commands").doc(M.hash(key)), fingerprint = M.hash({ operation, args, actor: actor.subject });
  return deps.firestoreDb.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) { if (receipt.data().fingerprint !== fingerprint) M.fail("Idempotency key was used for a different command", "personal_finance_idempotency_conflict", 409); return { ...receipt.data().receipt, replayed: true }; }
    const state = await readState(deps, tx);
    if (state.version !== args.expectedVersion) M.fail("Workspace changed; read current state and preview again", "personal_finance_version_conflict", 409);
    const at = M.now(deps), version = state.version + 1, changes = []; let settings = state.settings;
    if (operation === "savePersonalRecord") changes.push({ kind: args.kind, record: applyRecord(state, args.kind, args.record, deps) });
    else if (operation === "savePersonalSettings") {
      settings = M.settings(args.settings, deps); if (settings.baselineBudgetId) M.find(state, "budgets", settings.baselineBudgetId);
    } else if (operation === "commitPersonalImport") {
      const p = preview(state, args.input, deps);
      if (p.previewHash !== args.previewHash) M.fail("Import must match the reviewed preview", "personal_finance_preview_changed", 409);
      if (!p.canCommit) M.fail("Resolve import conflicts before committing", "personal_finance_import_conflicts", 409);
      changes.push(...p.changes, { kind: "imports", record: { id: `import-${M.hash(key)}`, reference: args.input.reference, previewHash: p.previewHash, changedCount: p.changes.length, unchangedCount: p.unchangedCount, sourceRange: args.input.transactions?.length ? { from: args.input.transactions.map(t => t.date).sort()[0], through: args.input.transactions.map(t => t.date).sort().at(-1) } : null } });
    } else M.fail("Unknown command");
    for (const kind of M.kinds) if (state[kind].length + changes.filter(x => x.kind === kind && !state[kind].some(r => r.id === x.record.id)).length > MAX_RECORDS) M.fail("Record capacity reached", "personal_finance_capacity", 413);
    const changed = changes.map(({ kind, record }) => ({ kind, id: record.id }));
    const history = { version, operation, actorSub: actor.subject, occurredAt: at, changes, ...(operation === "savePersonalSettings" ? { settings } : {}) };
    if (Buffer.byteLength(JSON.stringify(history)) > 700000) M.fail("Import too large; use smaller batches", "personal_finance_capacity", 413);
    for (const { kind, record } of changes) tx.set(ref.collection(kind).doc(record.id), { ...record, revision: version, updatedAt: at });
    // Snapshot metadata serializes all mutations; domain records remain individual documents.
    tx.set(ref, { version, settings, updatedAt: at });
    tx.create(ref.collection("history").doc(String(version).padStart(12, "0")), history);
    const result = { version, changed, replayed: false }; tx.create(receiptRef, { fingerprint, receipt: result });
    return result;
  });
}
async function query(operation, args, deps) {
  const state = await readState(deps);
  if (operation === "getPersonalSettings") return { version: state.version, settings: state.settings, counts: Object.fromEntries(M.kinds.map(k => [k, state[k].length])) };
  if (["getPersonalRecord", "listPersonalRecords"].includes(operation)) {
    M.choice(args.kind, M.kinds, "record kind");
    if (operation === "getPersonalRecord") return { version: state.version, record: M.find(state, args.kind, args.id) };
    const rows = state[args.kind].filter(x => (!args.accountId || x.accountId === args.accountId) && (!args.from || x.date >= M.day(args.from)) && (!args.through || x.date <= M.day(args.through))).sort((a, b) => a.id.localeCompare(b.id));
    return { version: state.version, ...M.page(rows, args, M.hash({ version: state.version, kind: args.kind, accountId: args.accountId || "", from: args.from || "", through: args.through || "" })) };
  }
  if (operation === "previewPersonalImport") return preview(state, args.input, deps);
  if (operation === "buildPersonalForecast") return require("./personal-finance-engine").forecast(state, args, deps);
  if (operation === "comparePersonalBudgets") return require("./personal-finance-engine").compareBudgets(state, args);
  if (operation === "getPersonalHistory") {
    const after = args.afterVersion ?? 0, limit = args.limit ?? 25;
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) M.fail("Invalid history pagination");
    const snap = await root(deps).collection("history").orderBy("__name__").startAfter(String(after).padStart(12, "0")).limit(limit + 1).get();
    const items = snap.docs.map(d => d.data()).filter(x => x.version <= state.version), page = items.slice(0, limit);
    return { version: state.version, items: page, complete: items.length <= limit, nextAfterVersion: page.at(-1)?.version || after };
  }
  M.fail("Unknown query");
}
module.exports = { readState, preview, command, query, transactionFingerprint, root };
