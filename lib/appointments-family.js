"use strict";
const { createHash } = require("node:crypto");
const { stableStringify } = require("./workspace-operation-execution");
const { requireDanPrivateAccess, normalizeOwnerSubjects } = require("./dan-private-access");
const { instant, range } = require("./appointments-policy");
const hash = v => createHash("sha256").update(stableStringify(v)).digest("hex");
const fail = (message, code = "appointments_family_invalid", statusCode = 400) => { throw Object.assign(new Error(message), { code, statusCode }); };
const at = deps => new Date(deps.now ? deps.now() : Date.now()).toISOString();
const base = () => ({ version: 0, enabled: false, timezone: "America/Los_Angeles", windows: [], channel: "", recipient: "", approverSubject: "" });
const owner = deps => { requireDanPrivateAccess(deps); return normalizeOwnerSubjects(deps.danOwnerSubjects)[0]; };
const ref = deps => deps.firestoreDb.collection("danAppointmentSettings").doc(hash(owner(deps)));
const setup = p => p.enabled && (!p.windows.length || !p.channel || !p.recipient || !p.approverSubject);
async function read(deps, tx) { const s = tx ? await tx.get(ref(deps)) : await ref(deps).get(); return s.exists ? s.data() : base(); }
async function getAppointmentFamilyPolicy(input, deps) { const p = await read(deps); return { policy: { ...p, setupNeeded: setup(p) } }; }
async function configureAppointmentFamilyPolicy(input, key, deps) {
  const access = requireDanPrivateAccess(deps), owners = normalizeOwnerSubjects(deps.danOwnerSubjects);
  if (!access.subjects.some(s => owners.includes(s))) fail("Only Dan may change his family scheduling rule", "appointments_family_owner_required", 403);
  if (input.userApproved !== true || typeof key !== "string" || key.length < 8 || key.length > 180) fail("Exact configuration approval and stable key required");
  const p = input.policy;
  if (!p || Object.keys(p).some(k => !["enabled", "timezone", "windows", "channel", "recipient", "approverSubject"].includes(k)) || typeof p.enabled !== "boolean") fail("Invalid policy fields");
  const value = { ...base(), ...p };
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }); } catch { fail("Invalid timezone"); }
  if (!Array.isArray(value.windows) || value.windows.length > 28) fail("Use at most 28 weekly windows");
  const minute = s => { if (typeof s !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)) fail("Use HH:mm local times"); return Number(s.slice(0, 2)) * 60 + Number(s.slice(3)); };
  value.windows = value.windows.map(w => {
    if (!w || Object.keys(w).some(k => !["day", "start", "end"].includes(k)) || !Number.isInteger(w.day) || w.day < 0 || w.day > 6) fail("Use weekday 0 (Sunday) through 6 (Saturday)");
    const start = minute(w.start), end = w.end === "24:00" ? 1440 : minute(w.end);
    if (start >= end) fail("Split overnight windows at midnight");
    return { day: w.day, start: w.start, end: w.end };
  }).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  for (let i = 1; i < value.windows.length; i++) if (value.windows[i].day === value.windows[i - 1].day && value.windows[i].start < value.windows[i - 1].end) fail("Weekly windows cannot overlap");
  if (!["", "email", "text"].includes(value.channel) || typeof value.recipient !== "string" || value.recipient.length > 300 || typeof value.approverSubject !== "string") fail("Invalid notification contact");
  if (value.channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.recipient)) fail("Verified email address required");
  if (value.channel === "text" && !/^\+[1-9]\d{7,14}$/.test(value.recipient)) fail("Use verified international phone number");
  const delegates = normalizeOwnerSubjects((deps.privateDelegationEnv || process.env).DAN_PRIVATE_DELEGATE_SUBJECTS);
  if (value.approverSubject && (!delegates.includes(value.approverSubject) || owners.includes(value.approverSubject))) fail("Resolve wife's existing authorized identity; cannot appoint Dan as his own approver");
  const fingerprint = hash(input), receiptRef = deps.firestoreDb.collection("danAppointmentReceipts").doc(hash({ owner: owner(deps), actor: access.subject, key, kind: "family_policy" }));
  const result = await deps.firestoreDb.runTransaction(async tx => {
    const [receipt, previous] = await Promise.all([tx.get(receiptRef), read(deps, tx)]);
    if (receipt.exists) { if (receipt.data().fingerprint !== fingerprint) fail("Key used for different configuration", "idempotency_key_reused", 409); return receipt.data().result; }
    if (input.expectedVersion !== previous.version) fail("Family policy changed; reread it", "appointments_version_conflict", 409);
    value.version = previous.version + 1; value.ownerSubject = owner(deps); value.updatedAt = at(deps); value.actorSub = access.subject;
    const result = { version: value.version };
    tx.set(ref(deps), value); tx.create(receiptRef, { fingerprint, result, actorSub: access.subject, createdAt: at(deps) }); return result;
  });
  return { ...result, ...(await getAppointmentFamilyPolicy({}, deps)), readBackVerified: true };
}
function blocks(r, planned = true) {
  const values = { ...r.events };
  if (planned) for (const a of r.actions) if (!["verified", "dismissed"].includes(a.status) && a.proposal.kind === "calendar") {
    const c = a.proposal.calendar; if (c.operation === "cancel") delete values[c.role]; else values[c.role] = c;
  }
  return Object.entries(values).filter(([, v]) => !v.cancelled).map(([role, v]) => ({ role, start: v.start, end: v.end, location: v.location || "" })).sort((a, b) => a.start.localeCompare(b.start) || a.role.localeCompare(b.role));
}
// Evaluate actual instants in local time, including both DST occurrences. The
// local windows are minute-granular; interval endpoints remain exact instants.
function inside(b, p) {
  const { start, end } = range(b), lo = Date.parse(start), hi = Date.parse(end);
  if (hi - lo > 14 * 86400000) fail("Split appointments spanning more than fourteen days");
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: p.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const contains = t => { const d = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value])); const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d.weekday), time = `${d.hour}:${d.minute}`; return p.windows.some(w => w.day === day && time >= w.start && time < w.end); };
  if (!contains(lo) || !contains(hi - 1)) return false;
  for (let t = Math.ceil((lo + 1) / 60000) * 60000; t < hi; t += 60000) if (!contains(t)) return false;
  return true;
}
function assess(r, p, planned = true) {
  const bs = blocks(r, planned), arrangementHash = hash({ policyVersion: p.version, blocks: bs });
  const outsideRoles = p.enabled && !setup(p) ? bs.filter(b => !inside(b, p)).map(b => b.role) : [];
  const required = p.enabled && outsideRoles.length > 0;
  const approval = r.familyApproval;
  const approved = required && approval?.decision === "approved" && approval.arrangementHash === arrangementHash;
  return { enabled: p.enabled, policyVersion: p.version, setupNeeded: setup(p), arrangementHash, blocks: bs, outsideRoles, required, approved,
    status: !p.enabled ? "disabled" : setup(p) ? "needs_setup" : !required ? "not_required" : approved ? "approved" : approval?.arrangementHash === arrangementHash && approval.decision === "declined" ? "declined" : "awaiting_wife",
    notificationChannel: p.channel, notificationRecipient: p.recipient };
}
function guard(r, p, planned = true) {
  const a = assess(r, p, planned);
  if (a.setupNeeded) fail("Set normal meeting hours and wife's approval contact before booking", "appointments_family_setup_required", 409);
  if (a.required && !a.approved) fail("Wife's approval is required for this exact arrangement before booking or confirming", "appointments_family_approval_required", 409);
  return a;
}
function recordApproval(r, p, input, actorSub, deps) {
  const a = assess(r, p);
  if (r.disposition !== "open" || !a.blocks.some(b => b.role === "meeting") || a.setupNeeded || !a.required || a.arrangementHash !== input.arrangementHash) fail("Read and review the current out-of-hours arrangement", "appointments_family_arrangement_changed", 409);
  if (!["approved", "declined", "revoked"].includes(input.decision)) fail("Invalid wife decision");
  let method;
  if (input.source === "authenticated_wife") {
    if (actorSub !== p.approverSubject) fail("This action requires wife's own authenticated identity", "appointments_family_approver_required", 403);
    method = "authenticated_wife";
  } else if (input.source === "reply_readback") {
    if (input.sender !== p.recipient || input.channel !== p.channel || input.contentMatched !== true || typeof input.sourceId !== "string" || !input.sourceId.trim() || input.sourceId.length > 1500) fail("Read wife's explicit reply from the exact configured sender and channel");
    const observed = instant(input.observedAt), delta = Date.parse(at(deps)) - Date.parse(observed);
    if (delta < 0 || delta > 300000) fail("Read the approval reply now");
    method = "client_connector_readback";
  } else fail("Silence or Dan's report cannot substitute for wife's approval");
  r.familyApproval = { decision: input.decision, arrangementHash: a.arrangementHash, policyVersion: p.version, actorSub, method, recordedAt: at(deps), ...(input.sourceId ? { sourceId: input.sourceId } : {}) };
}
function confirmedAgreement(r) {
  const m = r.events.meeting;
  return r.disposition === "open" && m && !m.cancelled && r.agreement?.accepted === true &&
    r.agreement.meetingIdentity === hash({ eventId: m.eventId, start: m.start, end: m.end, location: m.location }) && !r.reconciliationRequired;
}
function syncNotices(r, previous, p, at) {
  const before = assess(previous, p, false), after = assess(r, p, false);
  const wasConfirmed = confirmedAgreement(previous) && before.approved;
  const confirmed = confirmedAgreement(r) && after.approved;
  const hadFamily = (previous.familyNotices || []).some(n => n.kind === "confirmed") || wasConfirmed;
  let kind = "";
  if (hadFamily && (r.disposition === "cancelled" || r.events.meeting?.cancelled) && (before.arrangementHash !== after.arrangementHash || previous.disposition !== r.disposition)) kind = "cancelled";
  else if (hadFamily && before.arrangementHash !== after.arrangementHash) kind = "changed";
  else if (confirmed && (!wasConfirmed || before.arrangementHash !== after.arrangementHash || (r.familyNotices || []).some(n => n.status === "pending" && n.arrangementHash !== after.arrangementHash))) kind = "confirmed";
  if (!kind) return;
  const noticeId = `family-${hash({ kind, arrangementHash: after.arrangementHash, occurrence: r.version }).slice(0, 24)}`;
  if ((r.familyNotices || []).some(n => n.noticeId === noticeId)) return;
  r.familyNotices ||= [];
  for (const n of r.familyNotices) if (n.status === "pending") n.status = "superseded";
  r.familyNotices.push({ noticeId, kind, arrangementHash: after.arrangementHash, status: "pending", createdAt: at, blocks: after.blocks, channel: p.channel, recipient: p.recipient });
}
function checkMessage(r, p, a) {
  const purpose = a.proposal.familyPurpose;
  if (!purpose) { if (blocks(r).length) guard(r, p); return; }
  const v = a.proposal;
  if (!p.enabled || setup(p) || v.channel !== p.channel || stableStringify(v.recipients) !== stableStringify([p.recipient])) fail("Family messages must use the configured wife's contact");
  if (purpose === "approval_request") {
    if (v.arrangementHash !== assess(r, p).arrangementHash || !assess(r, p).required) fail("Approval request arrangement has changed", "appointments_family_arrangement_changed", 409);
  } else {
    const n = (r.familyNotices || []).find(n => n.noticeId === v.familyNoticeId);
    if (purpose === "confirmed" && (assess(r, p).arrangementHash !== v.arrangementHash || !assess(r, p, false).approved || !confirmedAgreement(r))) fail("Confirmed notification arrangement has changed", "appointments_family_notice_changed", 409);
    if (!n || n.status !== "pending" || n.arrangementHash !== v.arrangementHash || n.kind !== purpose) fail("Read the current pending family notice", "appointments_family_notice_changed", 409);
  }
}
module.exports = { read, getAppointmentFamilyPolicy, configureAppointmentFamilyPolicy, assess, guard, recordApproval, syncNotices, checkMessage, inside };
