"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { listAppointmentOperations, runAppointmentOperation } = require("../lib/appointments-operation-registry");
const { runAppointmentCommand } = require("../lib/appointments-service");
const { assessSlots, sequence } = require("../lib/appointments-policy");

const at = "2026-10-01T17:00:00.000Z", start = "2026-10-02T21:00:00.000Z", end = "2026-10-02T21:45:00.000Z";
const cal = (more = {}) => ({ kind: "calendar", calendar: { role: "meeting", operation: "create", start, end,
  subject: "Pastoral appointment", location: "Church office", attendees: [], ...more } });
function fixture() {
  const db = fakeFirestore(); let n = 0, clock = at;
  const deps = { firestoreDb: db, danOwnerSubjects: ["dan"], taskAccess: { subject: "dan", role: "admin" },
    privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: "dan", DAN_PRIVATE_DELEGATE_SUBJECTS: "sarah" }, now: () => clock };
  const query = (operation, args = {}, extra = {}) => runAppointmentOperation({ operation, mode: "query", arguments: args }, { ...deps, ...extra }).then(r => r.result);
  const command = (operation, args, key = `appointment-test-${++n}`, extra = {}) => runAppointmentOperation({ operation, mode: "command", arguments: args, idempotencyKey: key }, { ...deps, ...extra }).then(r => r.result);
  return { db, deps, query, command, setTime: t => { clock = t; } };
}
async function create(f, extra = {}) { return f.command("createAppointment", { contentClassification: "general_or_neutral", ...extra }); }
const fields = r => ({ appointmentId: r.appointmentId, expectedVersion: r.version });
async function propose(f, r, p = cal(), extra = {}) { return f.command("proposeAppointmentAction", { ...fields(r), proposal: p, ...extra }); }
async function approve(f, r, actions = r.appointment.actions) { return f.command("approveAppointmentActions", { ...fields(r), items: actions.map(a => ({ actionId: a.actionId, proposalHash: a.proposalHash })), userApproved: true }); }
async function ready(f) {
  let r = await create(f);
  r = await f.command("setAppointmentDecision", { ...fields(r), recommendation: "meeting", waitingOn: "requester", nextReviewAt: "2026-10-02T16:00:00.000Z" });
  r = await approve(f, await propose(f, r));
  return f.command("recordAppointmentObservation", { ...fields(r), actionId: r.appointment.actions[0].actionId, observedAt: at, availability: { start, end, conflictCount: 0 } });
}
async function booked(f) {
  let r = await ready(f), actionId = r.appointment.actions[0].actionId;
  r = await f.command("beginAppointmentAction", { ...fields(r), actionId });
  return f.command("recordAppointmentActionResult", { ...fields(r), actionId, outcome: "read_back", observedAt: at,
    event: { eventId: "event-one", start, end, location: "Church office", subject: "Pastoral appointment", attendees: [] } });
}

test("published calendar examples execute through the operation boundary without approving or dispatching", async () => {
  const catalog = listAppointmentOperations({ mode: "command", query: "proposeAppointmentAction" });
  for (const example of catalog.operations[0].examples) {
    const f = fixture(), r = await create(f);
    const result = await f.command("proposeAppointmentAction", { ...structuredClone(example.arguments), ...fields(r) });
    const saved = (await f.query("getAppointment", { appointmentId: r.appointmentId })).appointment;
    assert.equal(saved.version, result.version);
    assert.equal(saved.actions[0].status, "proposed");
    assert.equal(saved.actions[0].proposal.calendar.operation, example.arguments.proposal.calendar.operation);
    assert.equal(saved.actions[0].proposal.calendar.eventId, example.arguments.proposal.calendar.eventId);
    await assert.rejects(f.command("beginAppointmentAction", { ...fields(result), actionId: saved.actions[0].actionId }));
  }
});

test("malformed calendar proposal gives structural guidance without writing or exposing source content", async () => {
  const f = fixture(), r = await create(f);
  const before = await f.query("getAppointment", { appointmentId: r.appointmentId });
  const historyBefore = await f.query("getAppointmentHistory", { appointmentId: r.appointmentId });
  const c = cal({ operation: "update", eventId: "event-one" }).calendar;
  for (const p of [
    { kind: "calendar", ...c, subject: "sensitive-source-marker" },
    { type: "calendar", calendar: c },
    { actionType: "calendar", calendar: c },
    { calendar: c },
    { kind: "calendar" },
    { kind: "calendar", calendar: { ...c, unexpected: "sensitive-source-marker" } }
  ]) {
    await assert.rejects(propose(f, r, p), err => {
      assert.equal(err.code, "appointments_invalid_input");
      assert.match(err.message, /proposal\.(kind|calendar)/);
      assert.equal(err.message.includes("sensitive-source-marker"), false);
      return true;
    });
  }
  assert.deepEqual(await f.query("getAppointment", { appointmentId: r.appointmentId }), before);
  assert.deepEqual(await f.query("getAppointmentHistory", { appointmentId: r.appointmentId }), historyBefore);
});

test("private access, delegation attribution, neutral initial capture and content-free audit", async () => {
  const f = fixture();
  await assert.rejects(create(f, { title: "Family's confidential issue" }), { code: "appointments_invalid_input" });
  await assert.rejects(create(f, { purpose: "Confidential source" }), { code: "appointments_invalid_input" });
  await assert.rejects(create(f, { contentClassification: "care" }), { code: "appointments_sensitive_source" });
  const r = await create(f);
  await assert.rejects(f.query("getAppointment", { appointmentId: r.appointmentId }, { taskAccess: { subject: "other", role: "admin" } }), { code: "dan_private_access_denied" });
  const d = await f.command("setAppointmentDecision", { ...fields(r), recommendation: "clarify", waitingOn: "dan" }, "sarah-decision-key", { taskAccess: { subject: "sarah", role: "member" } });
  assert.equal(d.appointment.actorSub, "sarah"); assert.equal(d.appointment.ownerSubject, "dan");
  const history = await f.query("getAppointmentHistory", { appointmentId: r.appointmentId });
  assert.equal(history.events.length, 2); assert.equal(JSON.stringify(history).includes("purpose"), false);
});

test("exact approval is atomic, versioned and invalidated only for changed/dependent actions", async () => {
  const f = fixture(); let r = await propose(f, await create(f));
  const first = r.appointment.actions[0];
  r = await propose(f, r, { kind: "domain_reference", reference: { system: "notebooks", recordId: "agenda" } });
  const other = r.appointment.actions[1];
  await assert.rejects(f.command("approveAppointmentActions", { ...fields(r), userApproved: true, items: [{ actionId: first.actionId, proposalHash: first.proposalHash }, { actionId: other.actionId, proposalHash: "stale" }] }), { code: "appointments_proposal_changed" });
  assert.equal((await f.query("getAppointment", { appointmentId: r.appointmentId })).appointment.actions[0].status, "proposed");
  r = await approve(f, r);
  const old = fields(r); r = await propose(f, r, cal({ location: "Other office" }), { actionId: first.actionId });
  assert.equal(r.appointment.actions[0].status, "proposed"); assert.equal(r.appointment.actions[1].status, "approved");
  await assert.rejects(f.command("dismissAppointmentAction", { ...old, actionId: first.actionId, userConfirmed: true }), { code: "appointments_version_conflict" });
});

test("calendar conflicts and stale observations prevent writes; interrupted begin replays as reconcile-only", async () => {
  const f = fixture(); let r = await ready(f), actionId = r.appointment.actions[0].actionId;
  await assert.rejects(f.command("recordAppointmentObservation", { ...fields(r), actionId, observedAt: at, availability: { start, end, conflictCount: 1 } }));
  f.setTime("2026-10-01T17:06:00.000Z");
  await assert.rejects(f.command("beginAppointmentAction", { ...fields(r), actionId }), { code: "appointments_calendar_read_required" });
  f.setTime(at);
  const args = { ...fields(r), actionId };
  r = await f.command("beginAppointmentAction", args, "single-dispatch-key");
  assert.equal(r.dispatchInstruction, "execute_once");
  assert.equal((await f.command("beginAppointmentAction", args, "single-dispatch-key")).dispatchInstruction, "reconcile_only");
  await assert.rejects(f.command("beginAppointmentAction", { ...fields(r), actionId }), { code: "appointments_action_locked" });
  await assert.rejects(f.command("recordAppointmentActionResult", { ...fields(r), actionId, outcome: "read_back", observedAt: at,
    event: { eventId: "event-one", start, end, location: "Wrong office", subject: "Pastoral appointment" } }), { code: "appointments_result_mismatch" });
});

test("booking is held until explicit matching agreement; no automatic attendance/debrief completion", async () => {
  const f = fixture(); let r = await booked(f);
  assert.equal(r.appointment.status, "held"); assert.equal(r.appointment.complete, false);
  const args = { ...fields(r), accepted: true, start, end, location: "Church office", source: "user_reported", sourceId: "Dan reports agreement" };
  await assert.rejects(f.command("recordAppointmentAgreement", { ...args, location: "Wrong" }));
  r = await f.command("recordAppointmentAgreement", args);
  assert.equal(r.appointment.status, "confirmed");
  f.setTime("2026-10-03T17:00:00.000Z");
  const read = (await f.query("getAppointment", { appointmentId: r.appointmentId })).appointment;
  assert.equal(read.status, "confirmed"); assert(read.attentionReasons.includes("meeting_outcome_needed"));
  r = await f.command("recordAppointmentOutcome", { ...fields(r), outcome: "met", userConfirmed: true });
  assert.equal(r.appointment.debrief, "pending");
  r = await f.command("finishAppointmentDebrief", { ...fields(r), result: "not_needed", userConfirmed: true });
  assert.equal(r.appointment.complete, true);
});

test("external Outlook movement invalidates agreement and requires explicit sequence reconciliation", async () => {
  const f = fixture(); let r = await booked(f);
  r = await f.command("recordAppointmentAgreement", { ...fields(r), accepted: true, start, end, location: "Church office", source: "reply_readback", sourceId: "message-one" });
  r = await f.command("reconcileAppointmentEvent", { ...fields(r), role: "meeting", observedAt: at,
    event: { eventId: "event-one", start: "2026-10-02T22:00:00.000Z", end: "2026-10-02T22:45:00.000Z", location: "Church office", subject: "Private care detail" } });
  assert.equal(r.appointment.status, "held"); assert.equal(r.appointment.reconciliationRequired, true);
  assert.equal(JSON.stringify(r.appointment).includes("Private care detail"), false);
  await assert.rejects(f.command("recordAppointmentAgreement", { ...fields(r), accepted: true, start, end, location: "Church office", source: "user_reported", sourceId: "Dan" }));
  r = await f.command("resolveAppointmentReconciliation", { ...fields(r), userApproved: true });
  assert.equal(r.appointment.reconciliationRequired, false); assert.equal(r.appointment.agreement, null);
});

test("unknown messages stay open, cannot be replayed or dismissed, and sent evidence is not delivery", async () => {
  const f = fixture(); let r = await propose(f, await create(f), { kind: "message", channel: "email", recipients: ["test@example.invalid"], reference: { system: "correspondence", recordId: "draft-one", expectedVersion: 2 } });
  r = await approve(f, r); const actionId = r.appointment.actions[0].actionId;
  r = await f.command("beginAppointmentAction", { ...fields(r), actionId });
  r = await f.command("recordAppointmentActionResult", { ...fields(r), actionId, outcome: "unknown" });
  await assert.rejects(f.command("dismissAppointmentAction", { ...fields(r), actionId, userConfirmed: true }));
  await assert.rejects(f.command("beginAppointmentAction", { ...fields(r), actionId }));
  r = await f.command("recordAppointmentActionResult", { ...fields(r), actionId, outcome: "read_back", observedAt: at,
    message: { sourceId: "sent-message-one", correspondenceVersion: 2, recipients: ["test@example.invalid"], contentMatched: true } });
  assert.equal(r.appointment.actions[0].result.method, "client_connector_readback");
  assert.equal(r.appointment.actions[0].result.deliveryConfirmed, false);
});

test("owning references require trusted verification and partial follow-up blocks debrief completion", async () => {
  const f = fixture(); let r = await create(f);
  r = await f.command("recordAppointmentOutcome", { ...fields(r), outcome: "met", userConfirmed: true });
  r = await propose(f, r, { kind: "domain_reference", phase: "follow_up", reference: { system: "prayer_management", recordId: "prayer-one", expectedVersion: 1 } });
  r = await approve(f, r); const actionId = r.appointment.actions[0].actionId;
  r = await f.command("beginAppointmentAction", { ...fields(r), actionId });
  await assert.rejects(f.command("finishAppointmentDebrief", { ...fields(r), result: "complete", userConfirmed: true }));
  const args = { ...fields(r), actionId, receipt: { system: "prayer_management", recordId: "prayer-one", version: 1 } };
  await assert.rejects(runAppointmentCommand("recordAppointmentDomainVerification", args, "forged-receipt", f.deps), { code: "appointments_verification_forbidden" });
  r = await runAppointmentCommand("recordAppointmentDomainVerification", args, "verified-receipt", { ...f.deps, trustedDomainVerification: true });
  r = await f.command("finishAppointmentDebrief", { ...fields(r), result: "complete", userConfirmed: true });
  assert.equal(r.appointment.complete, true); assert.equal(r.appointment.links[0].method, "owning_gateway_readback");
});

test("review pagination is read-only and explicit hold review dates surface", async () => {
  const f = fixture(); let r = await create(f);
  await assert.rejects(f.command("setAppointmentDecision", { ...fields(r), recommendation: "meeting", waitingOn: "requester" }));
  r = await f.command("setAppointmentDecision", { ...fields(r), recommendation: "meeting", waitingOn: "requester", nextReviewAt: at });
  await create(f);
  const first = await f.query("listAppointments", { limit: 1 });
  assert.equal(first.totalCount, 2); assert.equal(first.complete, false);
  const second = await f.query("listAppointments", { limit: 1, cursor: first.nextCursor });
  assert.equal(second.complete, true); assert.notEqual(first.appointments[0].appointmentId, second.appointments[0].appointmentId);
  const review = await f.query("listAppointments", { view: "attention" });
  assert.equal(review.totalCount, 2); assert(review.appointments.some(a => a.attentionReasons.includes("response_or_hold_review_due")));
  assert.equal((await f.query("getAppointment", { appointmentId: r.appointmentId })).appointment.version, r.version);
});

test("slot advice respects travel order, known demands and DST offsets without claiming capacity", () => {
  const blocks = [{ role: "preparation", start: "2026-10-02T13:00:00-07:00", end: "2026-10-02T13:30:00-07:00" },
    { role: "outbound_travel", start: "2026-10-02T13:30:00-07:00", end: "2026-10-02T14:00:00-07:00" },
    { role: "meeting", start, end }];
  const result = assessSlots({ candidates: [{ blocks }], busy: [{ start: "2026-10-02T20:00:00Z", end: "2026-10-02T20:15:00Z" }],
    demands: [{ start: "2026-10-02T17:00:00Z", end: "2026-10-02T18:00:00Z", load: "heavy", basis: "completed" }] });
  assert.equal(result.candidates[0].available, false); assert.deepEqual(result.candidates[0].conflicts, ["preparation"]);
  assert.equal(result.candidates[0].preparationMinutes, 30); assert.equal(result.candidates[0].capacityKnown, false);
  assert.throws(() => sequence([{ ...blocks[0], end: start }, blocks[1], blocks[2]]), /overlap/);
  assert.throws(() => assessSlots({ candidates: [{ blocks }], busy: [], demands: [{ start, end, load: "heavy", basis: "inferred_completed" }] }));
});

test("sensitive handoff reserves a stable key before save and resumes after returned identity", async () => {
  const f = fixture(); let r = await create(f);
  r = await f.command("recordAppointmentOutcome", { ...fields(r), outcome: "met", userConfirmed: true });
  r = await propose(f, r, { kind: "domain_handoff", phase: "follow_up", targetSystem: "pastoral_care_member", breezePersonId: "123" });
  r = await approve(f, r); const actionId = r.appointment.actions[0].actionId;
  r = await f.command("beginAppointmentAction", { ...fields(r), actionId });
  const fresh = (await f.query("getAppointment", { appointmentId: r.appointmentId })).appointment;
  assert.equal(fresh.actions[0].dispatchKey, r.appointment.actions[0].dispatchKey);
  await assert.rejects(f.command("bindAppointmentHandoff", { ...fields(r), actionId, reference: { system: "pastoral_care_member", recordId: "matter-one", breezePersonId: "456" } }));
  r = await f.command("bindAppointmentHandoff", { ...fields(r), actionId, reference: { system: "pastoral_care_member", recordId: "matter-one", breezePersonId: "123", expectedVersion: 1 } });
  await assert.rejects(f.command("bindAppointmentHandoff", { ...fields(r), actionId, reference: { system: "pastoral_care_member", recordId: "matter-two", breezePersonId: "123" } }));
  r = await runAppointmentCommand("recordAppointmentDomainVerification", { ...fields(r), actionId, receipt: { system: "pastoral_care_member", recordId: "matter-one", version: 1 } }, "verified-sensitive-key", { ...f.deps, trustedDomainVerification: true });
  r = await f.command("finishAppointmentDebrief", { ...fields(r), result: "complete", userConfirmed: true });
  assert.equal(r.appointment.complete, true); assert.equal(r.appointment.actions[0].result.breezePersonId, "123");
});

test("approval rejects preparation/travel overlap and changing a dependency revokes confirmation approval", async () => {
  const f = fixture(); let r = await propose(f, await create(f));
  const meeting = r.appointment.actions[0];
  r = await propose(f, r, cal({ role: "preparation", subject: "Private preparation / travel", start: "2026-10-02T20:30:00.000Z", end: "2026-10-02T21:15:00.000Z", location: "" }));
  await assert.rejects(approve(f, r), /overlap/);
  const prep = r.appointment.actions[1];
  r = await f.command("dismissAppointmentAction", { ...fields(r), actionId: prep.actionId, userConfirmed: true });
  r = await propose(f, r, { kind: "message", channel: "email", recipients: ["test@example.invalid"], reference: { system: "correspondence", recordId: "draft-one", expectedVersion: 1 }, dependsOn: [meeting.actionId] });
  r = await approve(f, r, r.appointment.actions.filter(a => a.status === "proposed"));
  r = await propose(f, r, cal({ location: "New office" }), { actionId: meeting.actionId });
  assert.equal(r.appointment.actions.at(-1).status, "proposed");
});

const familyWindows = Array.from({ length: 5 }, (_, i) => [
  { day: i + 1, start: "08:30", end: "11:30" }, { day: i + 1, start: "13:30", end: "16:30" }
]).flat();
async function familyConfig(f, changes = {}, version = 0) {
  return f.command("configureAppointmentFamilyPolicy", { expectedVersion: version, userApproved: true,
    policy: { enabled: true, windows: familyWindows, channel: "email", recipient: "wife@example.invalid", approverSubject: "sarah", ...changes } });
}
async function wifeApprove(f, r, more = {}) {
  return f.command("recordAppointmentWifeApproval", { ...fields(r), arrangementHash: r.appointment.family.arrangementHash,
    decision: "approved", source: "authenticated_wife", ...more }, undefined, { taskAccess: { subject: "sarah", role: "member" } });
}
async function familyReady(f) {
  await familyConfig(f); let r = await create(f);
  r = await f.command("setAppointmentDecision", { ...fields(r), recommendation: "meeting", waitingOn: "requester", nextReviewAt: end });
  r = await approve(f, await propose(f, r, cal({ start: "2026-10-03T00:00:00Z", end: "2026-10-03T00:45:00Z" })));
  const c = r.appointment.actions[0].proposal.calendar;
  return f.command("recordAppointmentObservation", { ...fields(r), actionId: r.appointment.actions[0].actionId, observedAt: at, availability: { start: c.start, end: c.end, conflictCount: 0 } });
}
async function familyBooked(f) {
  let r = await wifeApprove(f, await familyReady(f)); const a = r.appointment.actions[0];
  r = await f.command("beginAppointmentAction", { ...fields(r), actionId: a.actionId });
  r = await f.command("recordAppointmentActionResult", { ...fields(r), actionId: a.actionId, outcome: "read_back", observedAt: at,
    event: { eventId: "family-meeting", ...Object.fromEntries(["start", "end", "location", "subject", "attendees"].map(k => [k, a.proposal.calendar[k]])) } });
  return f.command("recordAppointmentAgreement", { ...fields(r), accepted: true, start: a.proposal.calendar.start, end: a.proposal.calendar.end, location: "Church office", source: "reply_readback", sourceId: "requester-reply" });
}
test("family policy is owner-only, versioned, replay-safe and incomplete setup cannot book", async () => {
  const f = fixture();
  await assert.rejects(f.command("configureAppointmentFamilyPolicy", { expectedVersion: 0, userApproved: true, policy: { enabled: true } }, undefined, { taskAccess: { subject: "sarah", role: "member" } }), { code: "appointments_family_owner_required" });
  const args = { expectedVersion: 0, userApproved: true, policy: { enabled: true, windows: familyWindows } };
  await f.command("configureAppointmentFamilyPolicy", args, "configure-once");
  assert.equal((await f.command("configureAppointmentFamilyPolicy", args, "configure-once")).policy.version, 1);
  assert.equal((await f.query("getAppointmentFamilyPolicy")).policy.setupNeeded, true);
  let r = await ready(f);
  await assert.rejects(f.command("beginAppointmentAction", { ...fields(r), actionId: r.appointment.actions[0].actionId }), { code: "appointments_family_setup_required" });
  await assert.rejects(familyConfig(f), { code: "appointments_version_conflict" });
});
test("normal windows include endpoints correctly, lunch/weekends and all preparation/travel require approval", async () => {
  const { inside, assess } = require("../lib/appointments-family"); const p = { enabled: true, version: 1, windows: familyWindows, timezone: "America/Los_Angeles", channel: "email", recipient: "wife@example.invalid", approverSubject: "sarah" };
  const b = (start, end) => ({ start, end });
  assert.equal(inside(b("2026-10-02T08:30:00-07:00", "2026-10-02T11:30:00-07:00"), p), true);
  assert.equal(inside(b("2026-10-02T11:29:00-07:00", "2026-10-02T11:30:01-07:00"), p), false);
  assert.equal(inside(b("2026-10-02T11:00:00-07:00", "2026-10-02T14:00:00-07:00"), p), false);
  assert.equal(inside(b("2026-10-03T09:00:00-07:00", "2026-10-03T10:00:00-07:00"), p), false);
  assert.equal(inside(b("2026-11-01T01:15:00-07:00", "2026-11-01T01:45:00-08:00"), { ...p, windows: [{ day: 0, start: "01:00", end: "02:00" }] }), true);
  const a = assess({ events: { meeting: b(start, end), preparation: b("2026-10-02T13:00:00-07:00", "2026-10-02T13:30:00-07:00"), return_travel: b("2026-10-02T16:15:00-07:00", "2026-10-02T16:45:00-07:00") }, actions: [] }, p);
  assert.deepEqual(a.outsideRoles, ["preparation", "return_travel"]);
});
test("Dan approval, silence and mismatched replies cannot bypass wife's exact approval", async () => {
  const f = fixture(); let r = await familyReady(f); const actionId = r.appointment.actions[0].actionId;
  await assert.rejects(f.command("beginAppointmentAction", { ...fields(r), actionId }), { code: "appointments_family_approval_required" });
  await assert.rejects(f.command("recordAppointmentWifeApproval", { ...fields(r), arrangementHash: r.appointment.family.arrangementHash, decision: "approved", source: "authenticated_wife" }), { code: "appointments_family_approver_required" });
  await assert.rejects(wifeApprove(f, r, { source: "user_reported" }));
  await assert.rejects(wifeApprove(f, r, { source: "reply_readback", sender: "wrong@example.invalid", channel: "email", sourceId: "reply", observedAt: at, contentMatched: true }));
  r = await wifeApprove(f, r, { decision: "declined" }); assert.equal(r.appointment.family.status, "declined");
  await assert.rejects(f.command("beginAppointmentAction", { ...fields(r), actionId }), { code: "appointments_family_approval_required" });
  r = await wifeApprove(f, r); assert.equal(r.appointment.family.approved, true);
  r = await propose(f, r, cal({ start: "2026-10-03T00:15:00Z", end: "2026-10-03T01:00:00Z" }), { actionId });
  assert.equal(r.appointment.family.approved, false);
  await assert.rejects(wifeApprove(f, r, { arrangementHash: "stale" }), { code: "appointments_family_arrangement_changed" });
});
test("confirmed out-of-hours meeting queues one family notice and verified sending closes only that notice", async () => {
  const f = fixture(); let r = await familyBooked(f);
  assert.equal(r.appointment.status, "confirmed"); assert.equal(r.appointment.pendingFamilyNotices.length, 1);
  const n = r.appointment.pendingFamilyNotices[0]; assert.equal(n.kind, "confirmed");
  assert.equal(r.appointment.family.approved, true); // Creating provider event IDs does not invalidate approval.
  r = await propose(f, r, { kind: "message", familyPurpose: "confirmed", arrangementHash: n.arrangementHash, familyNoticeId: n.noticeId,
    channel: "email", recipients: ["wife@example.invalid"], reference: { system: "correspondence", recordId: "wife-notice", expectedVersion: 1 } });
  r = await approve(f, r, [r.appointment.actions.at(-1)]); const a = r.appointment.actions.at(-1);
  r = await f.command("beginAppointmentAction", { ...fields(r), actionId: a.actionId });
  r = await f.command("recordAppointmentActionResult", { ...fields(r), actionId: a.actionId, outcome: "unknown" });
  assert.equal(r.appointment.pendingFamilyNotices.length, 1);
  r = await f.command("recordAppointmentActionResult", { ...fields(r), actionId: a.actionId, outcome: "read_back", observedAt: at,
    message: { sourceId: "sent-one", correspondenceVersion: 1, recipients: ["wife@example.invalid"], contentMatched: true } });
  assert.equal(r.appointment.pendingFamilyNotices.length, 0);
  assert.equal(r.appointment.familyNotices[0].result.deliveryConfirmed, false);
  r = await f.command("reconcileAppointmentEvent", { ...fields(r), role: "meeting", observedAt: at,
    event: { eventId: "family-meeting", start: "2026-10-03T00:15:00Z", end: "2026-10-03T01:00:00Z", subject: "Pastoral appointment", location: "Church office", attendees: [] } });
  assert.equal(r.appointment.family.approved, false); assert.equal(r.appointment.pendingFamilyNotices[0].kind, "changed");
  r = await f.command("reconcileAppointmentEvent", { ...fields(r), role: "meeting", observedAt: at, event: { eventId: "family-meeting", cancelled: true } });
  assert.equal(r.appointment.pendingFamilyNotices.at(-1).kind, "cancelled");
});
test("policy edits invalidate approvals and cancellation remains possible without wife approval", async () => {
  const f = fixture(); let r = await familyBooked(f);
  await familyConfig(f, { windows: familyWindows.slice(0, -1) }, 1);
  r = { ...r, ...(await f.query("getAppointment", { appointmentId: r.appointmentId })) };
  assert.equal(r.appointment.family.approved, false); assert.equal(r.appointment.status, "held");
  r = await propose(f, r, cal({ operation: "cancel", eventId: "family-meeting" }));
  r = await approve(f, r, [r.appointment.actions.at(-1)]); const actionId = r.appointment.actions.at(-1).actionId;
  r = await f.command("recordAppointmentObservation", { ...fields(r), actionId, observedAt: at, currentEvent: { eventId: "family-meeting", start: "2026-10-03T00:00:00Z", end: "2026-10-03T00:45:00Z", subject: "Pastoral appointment", location: "Church office", attendees: [] } });
  r = await f.command("beginAppointmentAction", { ...fields(r), actionId }); assert.equal(r.dispatchInstruction, "execute_once");
});

test("cancelled arrangements cannot reacquire wife approval or send stale confirmed notices", async () => {
  const f = fixture(); let r = await familyBooked(f); const n = r.appointment.pendingFamilyNotices[0];
  r = await propose(f, r, { kind: "message", familyPurpose: "confirmed", arrangementHash: n.arrangementHash, familyNoticeId: n.noticeId, channel: "email", recipients: ["wife@example.invalid"], reference: { system: "correspondence", recordId: "stale-confirmation", expectedVersion: 1 } });
  r = await approve(f, r, [r.appointment.actions.at(-1)]); const aid = r.appointment.actions.at(-1).actionId;
  r = await f.command("reconcileAppointmentEvent", { ...fields(r), role: "meeting", observedAt: at, event: { eventId: "family-meeting", cancelled: true } });
  await assert.rejects(wifeApprove(f, r), { code: "appointments_family_arrangement_changed" });
  await assert.rejects(f.command("beginAppointmentAction", { ...fields(r), actionId: aid }), { code: "appointments_family_notice_changed" });
  assert.equal(r.appointment.pendingFamilyNotices[0].kind, "cancelled");
});
