"use strict";
const { createHash } = require("node:crypto");
const { getTaskAccess } = require("./task-management-access");
const { normalizeOwnerSubjects } = require("./dan-private-access");
const { stableStringify } = require("./workspace-operation-execution");
const dates = require("./planning-review-policy");

function fail(message, code = "finance_invalid_input", statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}
function access(deps) {
  const actor = getTaskAccess(deps), owners = normalizeOwnerSubjects(deps.danOwnerSubjects);
  // Deliberately use the authenticated primary subject, not delegated owners,
  // role, request arguments, or the broader private-access helper.
  if (!actor.subject || !owners.includes(actor.subject)) fail("Finance is available only to Dan", "finance_access_denied", 403);
  return actor;
}
function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail("Unsupported fields");
}
function text(v, field = "text", max = 2000, optional = false) {
  if (optional && (v === undefined || v === "")) return "";
  if (typeof v !== "string" || !v.trim() || v.length > max) fail(`Invalid ${field}`);
  return v;
}
function id(v) { const s = text(v, "ID", 120); if (!/^[a-zA-Z0-9_-]+$/.test(s)) fail("Invalid ID"); return s; }
function choice(v, values, field) { if (!values.includes(v)) fail(`Invalid ${field}`); return v; }
function money(v, optional = false, signed = false) {
  if (optional && (v === undefined || v === null)) return null;
  if (!Number.isSafeInteger(v) || (!signed && v < 0) || Math.abs(v) > 1e12) fail("Amount must be integer USD cents within supported range");
  return v;
}
function day(v) { return dates.date(v); }
function addDays(v, n) { return new Date(Date.parse(`${day(v)}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
function addMonths(v, n) {
  const d = new Date(`${day(v)}T12:00:00Z`), date = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(date, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
const now = deps => new Date(deps.now ? deps.now() : Date.now()).toISOString();
const today = deps => dates.pacificDate(now(deps));
const hash = v => createHash("sha256").update(stableStringify(v)).digest("hex");
function source(v) {
  shape(v, ["reportedBy", "reference", "reportedOn", "confirmedOn"]);
  return { reportedBy: text(v.reportedBy, "reportedBy", 200), reference: text(v.reference, "reference", 1000, true),
    reportedOn: day(v.reportedOn), confirmedOn: v.confirmedOn ? day(v.confirmedOn) : "" };
}
function timing(v = { kind: "unknown" }) {
  shape(v, ["kind", "originalText", "date", "from", "to", "eventReference", "anchorDate", "anchorBasis", "daysAfter"]);
  const t = { kind: choice(v.kind, ["unknown", "exact", "window", "relative"], "timing kind"), originalText: text(v.originalText, "original expectation", 1000, true) };
  if (t.kind === "exact") t.date = day(v.date);
  if (t.kind === "window") { t.from = day(v.from); t.to = day(v.to); if (t.from > t.to) fail("Invalid date window"); }
  if (t.kind === "relative") {
    t.eventReference = text(v.eventReference, "event reference", 500);
    t.anchorDate = v.anchorDate ? day(v.anchorDate) : "";
    t.anchorBasis = choice(v.anchorBasis || "planned", ["planned", "actual"], "anchor basis");
    if (!Number.isInteger(v.daysAfter) || Math.abs(v.daysAfter) > 3660) fail("Invalid event offset");
    t.daysAfter = v.daysAfter;
  }
  return t;
}
function resolveTiming(t, incoming) {
  if (t.kind === "exact") return { date: t.date, assumption: "" };
  if (t.kind === "window") return { date: incoming ? t.to : t.from, assumption: incoming ? "latest_receipt_in_window" : "earliest_expense_in_window" };
  if (t.kind === "relative" && t.anchorDate) return { date: addDays(t.anchorDate, t.daysAfter), assumption: `${t.anchorBasis}_event_anchor` };
  return { date: "", assumption: "unscheduled" };
}
function recurrence(v) {
  if (v === undefined || v === null) return null;
  shape(v, ["frequency", "startDate", "endDate"]);
  const r = { frequency: choice(v.frequency, ["monthly"], "frequency"), startDate: day(v.startDate), endDate: day(v.endDate) };
  if (r.endDate < r.startDate || r.endDate > addMonths(r.startDate, 60)) fail("Recurring schedule must be bounded to five years");
  return r;
}
function occurrenceDates(item) {
  if (!item.recurrence) return [null];
  const result = [];
  for (let n = 0; n <= 60; n++) { const d = addMonths(item.recurrence.startDate, n); if (d > item.recurrence.endDate) break; result.push(d); }
  return result;
}
function empty() { return { version: 0, currency: "USD", funds: [], plans: [], items: [], settlements: [], advances: [], lastReview: null }; }
function find(state, kind, recordId) {
  const record = state[kind]?.find(r => r.id === id(recordId));
  if (!record) fail("Finance record not found", "finance_not_found", 404);
  return record;
}
function page(rows, input, binding) {
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("limit must be 1-100");
  let offset = 0;
  if (input.cursor) try { const c = JSON.parse(Buffer.from(input.cursor, "base64url")); if (c.binding !== binding || !Number.isInteger(c.offset) || c.offset < 0) throw Error(); offset = c.offset; } catch { fail("Records changed; restart pagination", "finance_cursor_changed", 409); }
  return { items: rows.slice(offset, offset + limit), totalCount: rows.length, complete: offset + limit >= rows.length,
    nextCursor: offset + limit < rows.length ? Buffer.from(JSON.stringify({ binding, offset: offset + limit })).toString("base64url") : "" };
}
module.exports = { fail, access, shape, text, id, choice, money, day, addDays, addMonths, now, today, hash, source, timing, resolveTiming, recurrence, occurrenceDates, empty, find, page };
