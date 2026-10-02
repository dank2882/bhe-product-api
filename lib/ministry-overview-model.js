"use strict";
const { createHash } = require("node:crypto");
const { stableStringify } = require("./workspace-operation-execution");
const { getTaskAccess } = require("./task-management-access");
const { normalizeOwnerSubjects } = require("./dan-private-access");
const dates = require("./planning-review-policy");

const hash = value => createHash("sha256").update(stableStringify(value)).digest("hex");
function fail(message, code = "ministry_overview_invalid_input", statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}
function text(v, field, max = 2000, optional = false) {
  if (optional && (v === undefined || v === "")) return "";
  if (typeof v !== "string" || !v.trim() || v.length > max) fail(`Invalid ${field}`);
  return v;
}
function id(v) { const s = text(v, "ID", 200); if (/[/\\\x00-\x1f]/.test(s)) fail("Invalid ID"); return s; }
function shape(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail("Unsupported fields");
}
function choice(v, choices, field) { if (!choices.includes(v)) fail(`Invalid ${field}`); return v; }
function list(v, normalize, max = 100) {
  if (!Array.isArray(v) || v.length > max) fail("Invalid list"); return v.map(normalize);
}
function date(v, optional = false) { return optional && (v === "" || v === undefined) ? "" : dates.date(v); }
const now = deps => new Date(deps.now ? deps.now() : Date.now()).toISOString();
const today = deps => dates.pacificDate(now(deps));
function nextMonth(day) {
  date(day); const d = new Date(`${day}T12:00:00Z`), n = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(n, end)); return d.toISOString().slice(0, 10);
}
function actor(deps) {
  const a = getTaskAccess(deps);
  if (!a.subject || !normalizeOwnerSubjects(deps.danOwnerSubjects).length) fail("Authenticated ministry identity is required", "ministry_overview_access_denied", 403);
  return { ...a, owner: a.subjects.some(s => normalizeOwnerSubjects(deps.danOwnerSubjects).includes(s)) };
}
function canRead(r, deps) { const a = actor(deps); return a.owner || r.grants.some(g => a.subjects.includes(g.subject)); }
function authorize(r, deps, write = false, ownerOnly = false) {
  const a = actor(deps);
  if (!r || (!a.owner && (ownerOnly || !r.grants.some(g => a.subjects.includes(g.subject) && (!write || g.role === "editor"))))) {
    fail("Ministry not available to this identity", "ministry_overview_access_denied", 403);
  }
  return a;
}
function requireOwner(deps) { const a = actor(deps); if (!a.owner) fail("Dan must authorize this change", "ministry_overview_owner_required", 403); return a; }
function expected(r, v) { if (!Number.isInteger(v) || r.version !== v) fail("Ministry changed; read it again", "ministry_overview_version_conflict", 409); }
function person(v) {
  shape(v, ["name", "breezePersonId", "subject", "role"]);
  return { name: text(v.name, "person name", 200), breezePersonId: v.breezePersonId ? id(v.breezePersonId) : "",
    subject: text(v.subject, "subject", 300, true), role: text(v.role, "role", 300, true) };
}
function source(v, at, actorSub) {
  shape(v, ["kind", "reference", "reportedAt", "confirmedAt", "certainty"]);
  const reportedAt = v.reportedAt || at, confirmedAt = v.confirmedAt || "";
  for (const t of [reportedAt, confirmedAt].filter(Boolean)) if (!Number.isFinite(Date.parse(t)) || Date.parse(t) > Date.parse(at)) fail("Source dates cannot be invalid or future");
  return { kind: choice(v.kind || "user_report", ["user_report", "leader_report", "breeze", "task_management", "document"], "source kind"),
    reference: text(v.reference, "source reference", 1000, true), reportedAt, confirmedAt,
    certainty: choice(v.certainty || "reported", ["reported", "confirmed", "proposed", "disputed", "unknown"], "certainty"), actorSub };
}
function returnCondition(v) {
  shape(v, ["kind", "date", "eventInstanceId", "daysBefore", "condition"]);
  const kind = choice(v.kind, ["next_review", "date", "event", "change", "missing"], "return condition");
  const r = { kind };
  if (kind === "date") r.date = date(v.date);
  if (kind === "event") { r.eventInstanceId = id(v.eventInstanceId); if (!Number.isInteger(v.daysBefore) || v.daysBefore < 0 || v.daysBefore > 365) fail("Invalid event lead time"); r.daysBefore = v.daysBefore; }
  if (kind === "change") r.condition = text(v.condition, "reconsideration condition");
  return r;
}
function need(v) {
  shape(v, ["description", "estimatedCost", "currency"]);
  if (v.estimatedCost !== null && v.estimatedCost !== undefined && (!Number.isFinite(v.estimatedCost) || v.estimatedCost < 0)) fail("Invalid cost estimate");
  const currency = v.currency || "USD"; if (!/^[A-Z]{3}$/.test(currency)) fail("Invalid currency");
  return { description: text(v.description, "need"), estimatedCost: v.estimatedCost ?? null, currency, basis: "estimate_not_approved_spending" };
}
function profile(changes, owner) {
  const common = ["name", "purpose", "goals", "workers", "projectIds"];
  const protectedKeys = ["leader", "oversight", "parentMinistryId", "decisionResponsibilities", "personalScope", "status", "nextReviewDate", "calendarAreaIds"];
  shape(changes, [...common, ...protectedKeys]);
  if (!owner && Object.keys(changes).some(k => protectedKeys.includes(k))) fail("Leadership, scope and review policy changes require Dan", "ministry_overview_owner_required", 403);
  const out = {};
  for (const [k,v] of Object.entries(changes)) {
    if (["name", "purpose", "decisionResponsibilities"].includes(k)) out[k] = text(v, k, k === "name" ? 200 : 10000, k !== "name");
    else if (k === "goals") out[k] = list(v, x => text(x, "goal"));
    else if (k === "workers") out[k] = list(v, person, 250);
    else if (["leader", "oversight"].includes(k)) out[k] = v === null ? null : person(v);
    else if (["calendarAreaIds", "projectIds"].includes(k)) out[k] = [...new Set(list(v, id))];
    else if (k === "parentMinistryId") out[k] = v ? id(v) : "";
    else if (k === "personalScope") out[k] = choice(v, ["included", "handed_off"], k);
    else if (k === "status") out[k] = choice(v, ["active", "archived"], k);
    else out[k] = date(v);
  }
  return out;
}
function page(rows, input, binding) {
  const limit = input.limit ?? 25; if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("limit must be 1-100");
  const fingerprint = hash(binding); let offset = 0;
  if (input.cursor) try { const c = JSON.parse(Buffer.from(input.cursor, "base64url")); if (c.binding !== fingerprint || !Number.isInteger(c.offset) || c.offset < 0) throw Error(); offset = c.offset; } catch { fail("Inventory changed; restart pagination", "ministry_overview_cursor_changed", 409); }
  return { items: rows.slice(offset, offset + limit), totalCount: rows.length, complete: offset + limit >= rows.length,
    nextCursor: offset + limit < rows.length ? Buffer.from(JSON.stringify({ binding: fingerprint, offset: offset + limit })).toString("base64url") : "" };
}
module.exports = { hash, fail, text, id, shape, choice, list, date, now, today, nextMonth, actor, canRead, authorize, requireOwner, expected, person, source, returnCondition, need, profile, page };
