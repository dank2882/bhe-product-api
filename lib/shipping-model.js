"use strict";

const { createHash } = require("node:crypto");
const { stableStringify } = require("./workspace-operation-execution");
const hash = value => createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
function fail(message, code = "shipping_invalid_input", statusCode = 400) { throw Object.assign(new Error(message), { code, statusCode }); }
function string(value, name, max = 2000, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max) fail("Invalid " + name);
  return value.trim();
}
function id(value) { const s = string(value, "identifier", 160); if (!/^[a-zA-Z0-9_-]+$/.test(s)) fail("Invalid identifier"); return s; }
function date(value) { const s = string(value, "date", 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) fail("Use a valid YYYY-MM-DD date"); return s; }
function integer(value) { if (!Number.isSafeInteger(value) || value < 0) fail("Expected a non-negative safe integer"); return value; }
function number(value) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail("Expected a non-negative finite number"); return value; }
function bool(value) { if (typeof value !== "boolean") fail("Expected a boolean"); return value; }
const enumeration = values => value => { if (!values.includes(value)) fail("Expected one of: " + values.join(", ")); return value; };
function array(check, max = 100) { return value => { if (!Array.isArray(value) || value.length > max) fail("Invalid array size"); return value.map(check); }; }
function object(shape, required = []) { return value => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("Expected a plain object");
  if (Object.keys(value).some(k => !Object.hasOwn(shape, k))) fail("Unknown field");
  for (const key of required) if (value[key] === undefined) fail("Missing " + key);
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, shape[key](v)]));
}; }
const text = value => string(value, "text");
const short = value => string(value, "text", 300);
const optional = check => value => value === "" ? "" : check(value);
const ids = array(id, 100);
const currency = enumeration(["USD", "PHP", "MXN", "PEN", "HNL", "COP", "EUR", "GBP", "ZMW", "UGX", "VES"]);
const currencyDecimals = code => ["UGX"].includes(code) ? 0 : 2;
function url(value) { const s = string(value, "source URL", 3000); let u; try { u = new URL(s); } catch { fail("Invalid source URL"); } if (u.protocol !== "https:" || u.username || u.password) fail("Only HTTPS source links without credentials are accepted"); return s; }
const evidence = enumeration(["reported", "verified", "disputed", "unverified"]);
const source = object({ id, kind: enumeration(["email", "document", "user", "carrier", "receipt"]), title: short, url, messageId: value => string(value, "messageId", 2000), documentHash: value => { if (!/^[a-f0-9]{64}$/.test(value)) fail("Invalid SHA-256"); return value; }, page: integer, observedAt: date, note: text }, ["id", "kind", "title"]);
const sources = ids;
const party = object({ id, role: enumeration(["shipper", "consignee", "notify", "forwarder", "broker", "receiver", "payer", "arrivalContact"]), legalName: short, address: text, contactName: short, email: short, phone: short, sources }, ["id", "role", "legalName"]);
const container = object({ id, size: enumeration(["20", "40", "40HC", "other", "unknown"]), number: value => { const s = string(value, "container number", 11).toUpperCase(); if (!/^[A-Z]{4}\d{7}$/.test(s)) fail("Container number must have 4 letters and 7 digits"); return s; }, seal: short, cargoWeight: number, tareWeight: number, vgmWeight: number, weightUnit: enumeration(["kg", "lb"]), sources, notes: text }, ["id", "size"]);
const route = object({ id, sequence: integer, mode: enumeration(["road", "rail", "sea", "other"]), from: short, to: short, state: enumeration(["requested", "approved", "actual"]), carrier: short, vessel: short, voyage: short, reason: text, sources }, ["id", "sequence", "mode", "from", "to", "state", "sources"]);
const milestone = object({ id, kind: enumeration(["productionReady", "documentsReady", "booked", "loaded", "originCutoff", "departed", "transshipment", "portArrival", "customsReleased", "delivered", "emptyReturned", "financialClosed", "needBy"]), containerId: id, date, dateType: enumeration(["proposed", "estimated", "actual"]), timezone: short, precision: enumeration(["day", "month"]), verification: evidence, sources, note: text, supersedes: id, dueOwner: short }, ["id", "kind", "date", "dateType", "verification", "sources"]);
const cargo = object({ id, containerId: id, description: short, language: short, cartons: integer, unitsPerCarton: integer, units: integer, weightPerCarton: number, weight: number, weightUnit: enumeration(["kg", "lb"]), declaredValueMinor: integer, insuredValueMinor: integer, currency, origin: short, sources }, ["id", "description", "sources"]);
const requirement = object({ id, title: short, required: bool, responsible: short, dueDate: date, status: enumeration(["needed", "draft", "signed", "sent", "received", "accepted", "waived"]), documentIds: ids, sources, acceptanceNote: text }, ["id", "title", "required", "status"]);
const document = object({ id, title: short, type: short, requirementId: id, sensitivity: enumeration(["standard", "restricted"]), sources, status: enumeration(["draft", "signed", "notarized", "apostilled", "sent", "received", "accepted", "superseded"]), date, originalRequired: bool, courierTracking: short, courierReceivedDate: date, supersedes: id, acceptanceNote: text }, ["id", "title", "type", "sensitivity", "sources", "status"]);
const costLine = object({ id, description: short, amountMinor: integer, category: short, basis: enumeration(["shipment", "container", "billOfLading", "document", "day", "hour", "other"]), quantity: number, containerId: id, includedInLineId: id, refundable: bool }, ["id", "description", "amountMinor", "basis"]);
const cost = object({ id, type: enumeration(["quote", "invoice", "credit", "reimbursement"]), issuer: short, documentNumber: short, currency, date, validUntil: date, scope: text, exclusions: text, lines: array(costLine, 80), statedTotalMinor: integer, status: enumeration(["active", "superseded", "waived", "disputed"]), replaces: id, appliesTo: id, reimburses: ids, sources, verification: evidence }, ["id", "type", "issuer", "documentNumber", "currency", "date", "scope", "lines", "status", "sources", "verification"]);
const payment = object({ id, costId: id, amountMinor: integer, currency, date, kind: enumeration(["payment", "deposit", "refund"]), verification: evidence, sources, payer: short, note: text }, ["id", "costId", "amountMinor", "currency", "date", "kind", "verification", "sources"]);
const incident = object({ id, title: short, category: enumeration(["documents", "customs", "route", "weather", "damage", "cost", "other"]), openedDate: date, resolvedDate: date, status: enumeration(["open", "resolved", "disputed"]), description: text, correctiveAction: text, daysDelayed: number, sources }, ["id", "title", "category", "status", "description", "sources"]);
const readinessChecks = object(Object.fromEntries(["receiver", "broker", "route", "quote", "funding", "unloading", "clearance"].map(k => [k, object({ confirmed: bool, sources, note: text }, ["confirmed", "sources"])])));
const shapes = { parties: party, containers: container, routeLegs: route, milestones: milestone, cargo: cargo, requirements: requirement, documents: document, costs: cost, payments: payment, incidents: incident, sources: source };
const fields = { title: short, destinationCountry: short, destinationCity: short, purpose: text, needBy: optional(date), loadingAddress: optional(text), dischargePort: optional(short), finalDeliveryAddress: optional(text), bookingNumber: optional(short), billOfLading: optional(short), references: array(short, 30), projectIds: ids, taskIds: ids, notes: text, recordKind: enumeration(["operational", "historical", "proposal"]), readinessChecks };
for (const [key, check] of Object.entries(shapes)) fields[key] = array(check, key === "milestones" ? 250 : 100);
const validateShipment = object(fields, ["title", "destinationCountry", "recordKind"]);
const validateChanges = object(Object.fromEntries(Object.entries(fields).filter(([k]) => !["recordKind", ...Object.keys(shapes)].includes(k))));
function sourceCheck(s) {
  const known = new Set(s.sources.map(v => v.id));
  for (const [key] of Object.entries(shapes)) {
    const rows = s[key] || [], seen = new Set();
    if (rows.length > (key === "milestones" ? 250 : 100)) fail("Too many " + key + " records");
    for (const row of rows) {
      if (seen.has(row.id)) fail("Duplicate " + key + " ID"); seen.add(row.id);
      if ((row.sources || []).some(v => !known.has(v))) fail("Unknown source reference in " + key);
      if (row.containerId && !s.containers.some(c => c.id === row.containerId)) fail("Unknown container reference");
      if (key === "milestones" && row.dateType === "actual" && (!row.sources.length || !["reported", "verified"].includes(row.verification))) fail("Actual milestones require reported or verified evidence");
    }
  }
  for (const check of Object.values(s.readinessChecks || {})) if (check.confirmed && (!check.sources.length || check.sources.some(v => !known.has(v)))) fail("Readiness confirmation requires known evidence");
  for (const req of s.requirements) {
    if ((req.documentIds || []).some(v => !s.documents.some(d => d.id === v))) fail("Unknown requirement document");
    if (["accepted", "waived"].includes(req.status) && (!req.sources?.length || !req.acceptanceNote)) fail("Accepted/waived requirement needs evidence and an acceptance note");
  }
  for (const key of ["milestones", "documents"]) for (const row of s[key]) {
    if (key === "documents" && row.requirementId && !s.requirements.some(r => r.id === row.requirementId)) fail("Unknown document requirement");
    if (row.supersedes) {
      const old = s[key].find(r => r.id === row.supersedes);
      if (!old || old.id === row.id || (key === "milestones" && (old.kind !== row.kind || old.dateType !== row.dateType || old.containerId !== row.containerId))) fail("Invalid superseded record");
      const seen = new Set([row.id]); let next = old;
      while (next) { if (seen.has(next.id)) fail("Supersession cycle"); seen.add(next.id); next = s[key].find(r => r.id === next.supersedes); }
    }
  }
  const documents = new Map(s.costs.map(c => [c.id, c]));
  const invoiceKeys = new Set();
  for (const c of s.costs) {
    const key = [c.type, c.issuer.toLowerCase(), c.documentNumber.toLowerCase()].join("|");
    if (invoiceKeys.has(key)) fail("Duplicate cost document; update its state instead of rebilling it"); invoiceKeys.add(key);
    if (!c.lines.length || !c.sources.length) fail("Costs require lines and evidence");
    if (new Set(c.lines.map(v => v.id)).size !== c.lines.length) fail("Duplicate cost line ID");
    for (const line of c.lines) {
      if (line.containerId && !s.containers.some(v => v.id === line.containerId)) fail("Unknown cost container");
      if (line.includedInLineId && !c.lines.some(v => v.id === line.includedInLineId && !v.includedInLineId && v.id !== line.id)) fail("Invalid included cost line");
    }
    if (c.statedTotalMinor !== undefined && costTotal(c) !== c.statedTotalMinor) fail("Cost lines do not match stated total; reconcile the document first");
    if (c.replaces && (!documents.has(c.replaces) || c.replaces === c.id || documents.get(c.replaces).status !== "superseded" || documents.get(c.replaces).currency !== c.currency)) fail("Replacement must reference a superseded document in the same currency");
    if (c.type === "credit" && (!documents.has(c.appliesTo) || documents.get(c.appliesTo).type !== "invoice" || documents.get(c.appliesTo).currency !== c.currency || (c.status === "active" && documents.get(c.appliesTo).status !== "active"))) fail("Active credit needs an active invoice in the same currency");
    for (const target of c.reimburses || []) if (!documents.has(target) || target === c.id) fail("Unknown reimbursed document");
  }
  for (const p of s.payments) if (!documents.has(p.costId) || documents.get(p.costId).currency !== p.currency || !p.sources.length) fail("Payment requires a cost document in the same currency and evidence");
  if (Buffer.byteLength(JSON.stringify(s)) > 600000) fail("Shipment exceeds record size limit; split unrelated shipment records");
  return s;
}
function newShipment(input) {
  const s = validateShipment(input);
  for (const key of Object.keys(shapes)) s[key] ||= [];
  s.readinessChecks ||= {}; s.projectIds ||= []; s.taskIds ||= []; s.references ||= [];
  if (s.destinationCountry.toLowerCase() === "philippines" && !s.requirements.length) s.requirements = ["Deed of Donation - Apostille", "Commercial Invoice", "Packing List", "Place of Origin"].map((title, i) => ({ id: "ph-document-" + (i + 1), title, required: true, status: "needed", responsible: "US team / Pastor Dan" }));
  return sourceCheck(s);
}
function activeMilestones(s) { const old = new Set(s.milestones.map(m => m.supersedes).filter(Boolean)); return s.milestones.filter(m => !old.has(m.id)); }
function qualityIssues(s) {
  const issues = [];
  const supersededDocuments = new Set(s.documents.map(d => d.supersedes).filter(Boolean));
  for (const r of s.requirements.filter(r => r.status === "accepted")) for (const documentId of r.documentIds || []) {
    const d = s.documents.find(d => d.id === documentId);
    if (!d || d.status !== "accepted" || supersededDocuments.has(documentId) || (d.requirementId && d.requirementId !== r.id)) issues.push("Requirement " + r.id + ": accepted document version needs review");
  }
  for (const c of s.cargo) {
    if (c.cartons !== undefined && c.unitsPerCarton !== undefined && c.units !== undefined && c.cartons * c.unitsPerCarton !== c.units) issues.push("Cargo " + c.id + ": cartons × units per carton differs from total units");
    if (c.cartons !== undefined && c.weightPerCarton !== undefined && c.weight !== undefined && Math.abs(c.cartons * c.weightPerCarton - c.weight) > .01) issues.push("Cargo " + c.id + ": calculated weight differs from stated weight");
  }
  for (const c of s.containers) if ([c.cargoWeight, c.tareWeight, c.vgmWeight].every(v => v !== undefined) && Math.abs(c.cargoWeight + c.tareWeight - c.vgmWeight) > .01) issues.push("Container " + c.id + ": cargo + tare differs from VGM");
  const byKind = new Map();
  for (const m of activeMilestones(s).filter(m => m.dateType === "actual")) { const key = m.kind + ":" + (m.containerId || "shipment"); const dates = byKind.get(key) || new Set(); dates.add(m.date); byKind.set(key, dates); }
  for (const [key, dates] of byKind) if (dates.size > 1) issues.push("Conflicting actual dates: " + key);
  return issues;
}
function readiness(s, today) {
  const missing = [];
  for (const field of ["needBy", "loadingAddress", "dischargePort", "finalDeliveryAddress"]) if (!s[field]) missing.push(field);
  if (!s.cargo.length) missing.push("contents");
  if (!s.containers.length) missing.push("container plan");
  for (const role of ["shipper", "consignee", "broker", "arrivalContact", "payer", "receiver"]) if (!s.parties.some(p => p.role === role)) missing.push(role);
  for (const check of ["receiver", "broker", "route", "quote", "funding", "unloading", "clearance"]) if (!s.readinessChecks[check]?.confirmed) missing.push(check + " confirmation");
  for (const r of s.requirements) if (r.required && !["accepted", "waived"].includes(r.status)) missing.push(r.title);
  if (!s.routeLegs.some(r => r.state === "approved")) missing.push("approved route");
  if (!s.costs.some(c => c.type === "quote" && c.status === "active" && c.validUntil && c.validUntil >= today)) missing.push("current unexpired quote");
  const issues = qualityIssues(s);
  return { ready: !missing.length && !issues.length, missing, issues, approval: s.approval || null, requirementBasis: "Shipment checklist; historical broker requirements must be reconfirmed. This is not legal certification." };
}
function costTotal(c) { const n = c.lines.filter(l => !l.includedInLineId).reduce((sum, l) => sum + l.amountMinor, 0); if (!Number.isSafeInteger(n)) fail("Cost total exceeds safe integer range"); return n; }
function costSummary(s, today) {
  const currencies = {};
  for (const c of s.costs) {
    const r = currencies[c.currency] ||= { currency: c.currency, decimals: currencyDecimals(c.currency), invoicedMinor: 0, creditsMinor: 0, confirmedPaymentsMinor: 0, reportedPaymentsMinor: 0, depositsMinor: 0, reimbursementRequestsMinor: 0, quoteMinor: 0, expiredQuoteMinor: 0, disputedMinor: 0, waivedMinor: 0 };
    const total = costTotal(c);
    if (c.status === "superseded") continue;
    if (c.status === "waived") { r.waivedMinor += total; continue; }
    if (c.status === "disputed") { r.disputedMinor += total; continue; }
    if (c.type === "invoice") r.invoicedMinor += total;
    if (c.type === "credit") r.creditsMinor += total;
    if (c.type === "reimbursement") r.reimbursementRequestsMinor += total;
    if (c.type === "quote") r[c.validUntil && c.validUntil >= today ? "quoteMinor" : "expiredQuoteMinor"] += total;
  }
  for (const p of s.payments) {
    const c = s.costs.find(c => c.id === p.costId), r = currencies[p.currency];
    if (p.kind === "deposit") { r.depositsMinor += p.amountMinor; continue; }
    if (c.type !== "invoice" || c.status !== "active") continue;
    const signed = p.kind === "refund" ? -p.amountMinor : p.amountMinor;
    if (p.verification === "verified") r.confirmedPaymentsMinor += signed;
    else if (p.verification === "reported") r.reportedPaymentsMinor += signed;
  }
  for (const r of Object.values(currencies)) r.unsettledInvoiceMinor = r.invoicedMinor - r.creditsMinor - r.confirmedPaymentsMinor;
  return { currencies: Object.values(currencies), documents: s.costs.map(c => ({ id: c.id, type: c.type, status: c.status, scope: c.scope, currency: c.currency, totalMinor: costTotal(c), validUntil: c.validUntil || null })), note: "Currencies remain separate. Quotes, disputed/waived amounts, deposits and reimbursements are not added to invoice totals. Payments require allocation; reported payment is not settlement proof." };
}
function historyInsights(shipments) {
  const samples = [], excluded = [];
  for (const s of shipments) {
    const ms = activeMilestones(s).filter(m => m.dateType === "actual" && ["verified", "reported"].includes(m.verification) && !m.containerId && m.precision !== "month");
    for (const [name, start, end] of [["ocean", "departed", "portArrival"], ["portToDoor", "portArrival", "delivered"], ["loadToDoor", "loaded", "delivered"]]) {
      const a = ms.filter(m => m.kind === start), b = ms.filter(m => m.kind === end);
      if (a.length !== 1 || b.length !== 1) { excluded.push({ shipmentId: s.shipmentId, interval: name, reason: "Missing or conflicting actual endpoints" }); continue; }
      const days = (Date.parse(b[0].date) - Date.parse(a[0].date)) / 86400000;
      if (days < 0) { excluded.push({ shipmentId: s.shipmentId, interval: name, reason: "Reversed dates" }); continue; }
      samples.push({ shipmentId: s.shipmentId, destinationCountry: s.destinationCountry, interval: name, days, verification: a[0].verification === "verified" && b[0].verification === "verified" ? "verified" : "reported", sources: [...new Set([...a[0].sources, ...b[0].sources])] });
    }
  }
  return { samples, excluded, note: "Observed intervals only; no forecast is treated as an actual endpoint and no cross-route average is asserted." };
}
module.exports = { hash, fail, string, id, date, integer, object, shapes, sourceCheck, newShipment, validateChanges, readiness, qualityIssues, costSummary, historyInsights, activeMilestones };
