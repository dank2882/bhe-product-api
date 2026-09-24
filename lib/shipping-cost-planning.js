"use strict";
// Country budgets belong to FBC Shipping, independently of shipment invoices.
// The existing service supplies the authenticated owner; no alternative auth path.
const M = require("./shipping-model");
const coll = (deps, name) => deps.firestoreDb.collection("fbcShipping" + name);
const now = deps => new Date(deps.now ? deps.now() : Date.now()).toISOString();
const text = v => M.string(v, "text", 2000);
const short = v => M.string(v, "text", 300);
const choice = values => v => { if (!values.includes(v)) M.fail("Expected one of: " + values.join(", ")); return v; };
const array = (check, max) => v => { if (!Array.isArray(v) || v.length > max) M.fail("Invalid array size"); return v.map(check); };
const amount = v => v === null ? null : M.integer(v);
const bool = v => { if (typeof v !== "boolean") M.fail("Expected boolean"); return v; };
const ref = M.object({ shipmentId: M.id, costId: M.id }, ["shipmentId", "costId"]);
const line = M.object({
  id: M.id, description: short, category: choice(["origin", "ocean", "documents", "insurance", "customs", "port", "brokerage", "delivery", "delay", "contingency", "deposit", "other"]),
  currency: M.currency, lowMinor: amount, expectedMinor: amount, highMinor: amount,
  required: bool, basis: choice(["historical", "quote", "allowance", "unknown"]),
  note: text, reference: ref, sourceLineId: M.id, sourceDate: M.date
}, ["id", "description", "category", "currency", "lowMinor", "expectedMinor", "highMinor", "required", "basis", "note"]);
const shape = M.object({
  title: short, destinationCountry: short, destinationCity: short, route: text,
  containerSize: choice(["20", "40", "40HC", "other", "unknown"]), containerCount: v => { M.integer(v); if (v < 1 || v > 100) M.fail("Container count must be 1–100"); return v; },
  asOf: M.date, status: choice(["draft", "archived"]), coverage: choice(["partial", "complete"]),
  assumptions: text, exclusions: text, lines: array(line, 80), historicalReferences: array(ref, 30)
}, ["title", "destinationCountry", "route", "containerSize", "containerCount", "asOf", "status", "coverage", "assumptions", "exclusions", "lines", "historicalReferences"]);
const refKey = r => r.shipmentId + "/" + r.costId;
function validate(value) {
  const p = shape(value);
  if (!p.lines.length || new Set(p.lines.map(l => l.id)).size !== p.lines.length) M.fail("Use at least one line with unique IDs");
  if (new Set(p.historicalReferences.map(refKey)).size !== p.historicalReferences.length) M.fail("Duplicate historical reference");
  const used = new Set();
  for (const l of p.lines) {
    const numbers = [l.lowMinor, l.expectedMinor, l.highMinor].filter(v => v !== null);
    if (numbers.some((v, i) => i && v < numbers[i - 1])) M.fail("Cost range must satisfy low <= expected <= high");
    if (l.basis === "unknown" && numbers.length) M.fail("Unknown cost must have null amounts");
    if (l.basis !== "unknown" && l.expectedMinor === null) M.fail("Known cost needs an expected amount");
    if (["historical", "quote"].includes(l.basis)) {
      if (!l.reference || !l.sourceLineId) M.fail("Historical/quote amounts require a source cost line");
      const key = refKey(l.reference) + "/" + l.sourceLineId;
      if (used.has(key)) M.fail("Source cost line counted twice"); used.add(key);
    } else if (l.reference || l.sourceLineId) M.fail("Use historical/quote basis for sourced cost lines");
  }
  return p;
}
function add(a, b) { const n = a + b; if (!Number.isSafeInteger(n)) M.fail("Cost total exceeds safe integer range"); return n; }
function summarize(p, today) {
  const currencies = [...new Set(p.lines.map(l => l.currency))].map(currency => {
    const lines = p.lines.filter(l => l.currency === currency);
    const groups = {};
    for (const [name, selected] of Object.entries({ expenses: lines.filter(l => !["deposit", "delay"].includes(l.category)), delayRisk: lines.filter(l => l.category === "delay"), refundableDeposits: lines.filter(l => l.category === "deposit"), cashRequired: lines })) {
      const total = key => selected.some(l => l[key] === null) ? null : selected.reduce((a, l) => add(a, l[key]), 0);
      groups[name] = { knownExpectedMinor: selected.reduce((a, l) => add(a, l.expectedMinor || 0), 0), lowMinor: total("lowMinor"), expectedMinor: total("expectedMinor"), highMinor: total("highMinor"), missingLineIds: selected.filter(l => l.expectedMinor === null).map(l => l.id) };
    }
    return { currency, minorDecimals: M.currencyDecimals(currency), ...groups };
  });
  const historicalLineIds = p.lines.filter(l => l.basis === "historical").map(l => l.id);
  const expiredQuoteLineIds = p.lines.filter(l => l.basis === "quote" && (!l.sourceSnapshot?.validUntil || l.sourceSnapshot.validUntil < today)).map(l => l.id);
  const missingRequiredLineIds = p.lines.filter(l => l.required && l.expectedMinor === null).map(l => l.id);
  return { currencies, missingRequiredLineIds, historicalLineIds, expiredQuoteLineIds,
    budgetComplete: p.coverage === "complete" && !p.lines.some(l => l.expectedMinor === null) && p.containerSize !== "unknown" && !expiredQuoteLineIds.length,
    needsCurrentPricing: !!historicalLineIds.length || !!expiredQuoteLineIds.length || p.lines.some(l => l.basis === "unknown"),
    note: "Amounts cover the entire stated container count, not a per-container rate. Currencies are never combined. Historical amounts are reference values, not current quotes. Partial coverage is not an all-in delivery price. Delay risks and refundable deposits are separate. Estimates do not satisfy shipment readiness or authorize booking/payment." };
}
function owned(p) { if (!p || p.owner !== "fbc") M.fail("Country estimate not found", "shipping_not_found", 404); return p; }
async function get(input, deps) {
  const estimateId = M.id(input.estimateId);
  const version = input.version === undefined ? null : M.integer(input.version);
  const snap = await coll(deps, version === null ? "CountryEstimates" : "CountryEstimateRevisions").doc(version === null ? estimateId : estimateId + "-v" + version).get();
  const estimate = owned(snap.exists ? snap.data() : null);
  return { estimate, summary: summarize(estimate, now(deps).slice(0, 10)) };
}
async function list(input, deps) {
  const country = input.country === undefined ? "" : short(input.country).toLowerCase();
  const status = input.status === undefined ? "" : choice(["draft", "archived"])(input.status);
  const limit = input.limit === undefined ? 25 : M.integer(input.limit); if (limit < 1 || limit > 100) M.fail("limit must be 1–100");
  const binding = M.hash({ country, status }); let after = "";
  if (input.cursor) try { const c = JSON.parse(Buffer.from(input.cursor, "base64url").toString()); if (c.binding !== binding) throw Error(); after = M.id(c.after); } catch { M.fail("Cursor does not match query", "shipping_invalid_cursor"); }
  let query = coll(deps, "CountryEstimates").orderBy("__name__"); if (after) query = query.startAfter(after);
  const snap = await query.limit(limit + 1).get(), page = snap.docs.slice(0, limit), today = now(deps).slice(0, 10);
  return { estimates: page.map(d => d.data()).filter(p => p.owner === "fbc" && (!country || p.destinationCountry.toLowerCase() === country) && (!status || p.status === status)).map(p => ({ estimateId: p.estimateId, title: p.title, destinationCountry: p.destinationCountry, containerSize: p.containerSize, containerCount: p.containerCount, route: p.route, status: p.status, version: p.version, asOf: p.asOf, coverage: p.coverage, summary: summarize(p, today) })),
    nextCursor: snap.docs.length > limit ? Buffer.from(JSON.stringify({ after: page.at(-1).id, binding })).toString("base64url") : "", complete: snap.docs.length <= limit,
    coverage: "Follow every cursor, including empty filtered pages. Different routes, sizes, counts and cost scopes are separate estimate sheets." };
}
async function save(input, key, deps, actor) {
  const estimateId = M.id(input.estimateId), expected = M.integer(input.expectedVersion), plan = validate(input.estimate);
  M.string(key, "idempotencyKey", 200); if (key.length < 8) M.fail("Idempotency key too short");
  const fingerprint = M.hash({ operation: "saveCountryCostEstimate", input }), receiptId = M.hash(actor.subject + "|" + key);
  const receiptRef = coll(deps, "Receipts").doc(receiptId), planRef = coll(deps, "CountryEstimates").doc(estimateId);
  const result = await deps.firestoreDb.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) { if (receipt.data().fingerprint !== fingerprint) M.fail("Idempotency key reused with different content", "shipping_idempotency_conflict", 409); return { ...receipt.data().result, replayed: true }; }
    const current = await tx.get(planRef);
    if (current.exists) owned(current.data());
    if ((current.exists ? current.data().version : 0) !== expected) M.fail("Country estimate changed; read it again", "shipping_version_conflict", 409);
    const references = [...new Map([...plan.historicalReferences, ...plan.lines.filter(l => l.reference).map(l => l.reference)].map(r => [refKey(r), r])).values()];
    const snapshots = new Map();
    for (const r of references) {
      const s = await tx.get(coll(deps, "Shipments").doc(r.shipmentId)), shipment = s.exists ? s.data() : null;
      const c = shipment?.costs?.find(c => c.id === r.costId);
      if (shipment?.owner !== "fbc" || shipment.status === "canceled" || !c || c.status !== "active" || c.verification !== "verified" || !["invoice", "quote", "reimbursement"].includes(c.type)) M.fail("Reference requires an active verified cost on a non-canceled FBC shipment");
      snapshots.set(refKey(r), { ...r, shipmentVersion: shipment.version, destinationCountry: shipment.destinationCountry, shipmentTitle: shipment.title, containers: shipment.containers.map(c => ({ size: c.size })), type: c.type, currency: c.currency, minorDecimals: M.currencyDecimals(c.currency), date: c.date, scope: c.scope, validUntil: c.validUntil || "", sourceIds: c.sources, lines: c.lines, totalMinor: c.lines.filter(l => !l.includedInLineId).reduce((a, l) => add(a, l.amountMinor), 0) });
    }
    for (const l of plan.lines) if (l.reference) {
      const s = snapshots.get(refKey(l.reference)), original = s.lines.find(v => v.id === l.sourceLineId);
      if (!original || original.includedInLineId || original.amountMinor !== l.expectedMinor || s.currency !== l.currency) M.fail("Expected amount/currency must match an independently counted source line");
      if (l.basis === "historical" && s.type !== "invoice") M.fail("Historical budget lines require invoices; keep reimbursements as references only");
      if (l.basis === "quote" && (s.type !== "quote" || !s.validUntil || s.validUntil < now(deps).slice(0, 10))) M.fail("Quote line requires a current unexpired quote");
      if (s.destinationCountry.toLowerCase() !== plan.destinationCountry.toLowerCase() || s.containers.length !== plan.containerCount || s.containers.some(c => c.size !== plan.containerSize)) M.fail("Source amount must match country, container size and count; use a documented allowance for a different scenario");
      if (!!original.refundable !== (l.category === "deposit")) M.fail("Keep refundable deposits separate from expenses");
      l.sourceDate = s.date;
      const { lines, ...metadata } = s; l.sourceSnapshot = metadata;
    }
    plan.historicalReferences = references.map(r => snapshots.get(refKey(r)));
    const timestamp = now(deps), version = expected + 1;
    const record = { ...plan, estimateId, owner: "fbc", version, createdAt: current.exists ? current.data().createdAt : timestamp, updatedAt: timestamp, updatedBy: actor.subject };
    summarize(record, timestamp.slice(0, 10)); // Reject unsafe totals before any write.
    if (Buffer.byteLength(JSON.stringify(record)) > 600000) M.fail("Country estimate too large");
    const saved = { estimateId, version, replayed: false };
    tx.set(planRef, record); tx.create(coll(deps, "CountryEstimateRevisions").doc(estimateId + "-v" + version), record);
    tx.create(receiptRef, { owner: "fbc", actorSub: actor.subject, fingerprint, result: saved, createdAt: timestamp });
    tx.create(coll(deps, "Audit").doc(receiptId), { owner: "fbc", operation: "saveCountryCostEstimate", estimateId, version, actorSub: actor.subject, timestamp, fingerprint });
    return saved;
  });
  const readback = await get({ estimateId, version: result.version }, deps);
  return { ...result, ...readback, readBackVerified: true };
}
module.exports = { validate, summarize, get, list, save };
