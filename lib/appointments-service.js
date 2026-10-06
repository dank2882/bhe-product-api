"use strict";
const { createHash } = require("node:crypto");
const { requireDanPrivateAccess, normalizeOwnerSubjects } = require("./dan-private-access");
const { stableStringify } = require("./workspace-operation-execution");
const policy = require("./appointments-policy");
const family = require("./appointments-family");
const hash = value => createHash("sha256").update(stableStringify(value)).digest("hex");
const col = (deps, name) => deps.firestoreDb.collection(`danAppointment${name}`);
const now = deps => new Date(deps.now ? deps.now() : Date.now()).toISOString();
const done = a => ["verified", "dismissed"].includes(a.status);
function fail(message, code = "appointments_invalid_input", statusCode = 400) { throw Object.assign(new Error(message), { code, statusCode }); }
function text(value, field, max = 500, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`Invalid ${field}`);
  return value;
}
function id(value) { const v = text(value, "ID", 500); if (/[/\\\x00-\x1f]/.test(v)) fail("Invalid ID"); return v; }
function shape(value, keys, message = "Unsupported fields") {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail(message);
}
function choice(value, choices, name) { if (!choices.includes(value)) fail(`Invalid ${name}`); return value; }
function access(deps) { const a = requireDanPrivateAccess(deps); return { ownerSubject: normalizeOwnerSubjects(deps.danOwnerSubjects)[0], actorSub: a.subject }; }
function owned(snap, owner) { if (!snap.exists || snap.data().ownerSubject !== owner) fail("Appointment not found", "appointments_not_found", 404); return snap.data(); }
function expected(r, version) { if (!Number.isInteger(version) || r.version !== version) fail("Appointment changed; read it again", "appointments_version_conflict", 409); }
function action(r, actionId) { const a = r.actions.find(a => a.actionId === actionId); if (!a) fail("Action not found"); return a; }
function reference(v) {
  shape(v, ["system", "recordId", "expectedVersion", "breezePersonId"]);
  choice(v.system, ["appointments", "notebooks", "intake", "task_management", "prayer_management", "pastoral_care_member", "pastoral_care_extended", "correspondence"], "reference system");
  const r = { system: v.system, recordId: id(v.recordId) };
  if (v.expectedVersion !== undefined) { if (!Number.isInteger(v.expectedVersion) || v.expectedVersion < 1) fail("Invalid referenced version"); r.expectedVersion = v.expectedVersion; }
  if (v.system === "pastoral_care_member") r.breezePersonId = id(v.breezePersonId);
  else if (v.breezePersonId !== undefined) fail("Person identity is only valid for member care");
  return r;
}
function calendar(v, privacy) {
  shape(v, ["role", "calendarId", "eventId", "operation", "start", "end", "timezone", "subject", "location", "attendees", "body", "reminderMinutes"], "Invalid proposal.calendar: use an object containing role, operation and calendar fields; see proposeAppointmentAction examples");
  choice(v.role, ["meeting", "preparation", "earlier_preparation", "outbound_travel", "return_travel", "recovery"], "calendar role");
  choice(v.operation, ["create", "update", "cancel"], "calendar operation");
  const result = { role: v.role, operation: v.operation, calendarId: text(v.calendarId, "calendarId", 1000, true),
    eventId: text(v.eventId, "eventId", 1500, v.operation === "create") };
  if (v.operation !== "cancel") {
    Object.assign(result, policy.range(v), { timezone: v.timezone || "America/Los_Angeles", subject: text(v.subject, "subject", 200),
      location: text(v.location, "location", 1000, v.role !== "meeting"), body: text(v.body, "body", 3000, true) });
    try { new Intl.DateTimeFormat("en-US", { timeZone: result.timezone }); } catch { fail("Invalid timezone"); }
    if (privacy === "restricted" && (result.subject !== (v.role === "meeting" ? "Pastoral appointment" : "Private preparation / travel") || result.body)) fail("Restricted appointments require neutral calendar labels and no body text");
    if (!Array.isArray(v.attendees || []) || (v.attendees || []).length > 30) fail("Invalid attendees");
    result.attendees = (v.attendees || []).map(a => text(a, "attendee email", 300));
    if (v.role !== "meeting" && result.attendees.length) fail("Private preparation and travel cannot have attendees");
    if (v.reminderMinutes !== undefined) { if (!Number.isInteger(v.reminderMinutes) || v.reminderMinutes < 0 || v.reminderMinutes > 10080) fail("Invalid reminder"); result.reminderMinutes = v.reminderMinutes; }
  }
  return result;
}
function proposal(v, privacy) {
  shape(v, ["kind", "phase", "calendar", "reference", "channel", "recipients", "threadId", "dependsOn", "targetSystem", "breezePersonId", "familyPurpose", "arrangementHash", "familyNoticeId"], 'Unsupported proposal fields: use proposal.kind as the discriminator; put calendar fields inside proposal.calendar, for example {kind:"calendar",calendar:{role:"meeting",operation:"update",eventId:"...",...}}');
  choice(v.kind, ["calendar", "message", "domain_reference", "domain_handoff"], "proposal.kind (calendar/message/domain_reference/domain_handoff)");
  const p = { kind: v.kind, phase: choice(v.phase || "arrangement", ["arrangement", "follow_up"], "phase") };
  const byKind = { calendar: ["calendar"], message: ["reference", "channel", "recipients", "threadId", "familyPurpose", "arrangementHash", "familyNoticeId"], domain_reference: ["reference"], domain_handoff: ["targetSystem", "breezePersonId"] };
  if (Object.keys(v).some(k => !["kind", "phase", "dependsOn", ...byKind[v.kind]].includes(k))) fail("Fields do not match this action kind");
  if (v.kind === "calendar") p.calendar = calendar(v.calendar, privacy);
  else if (v.kind === "domain_handoff") {
    p.targetSystem = reference({ system: v.targetSystem, recordId: "pending", ...(v.breezePersonId ? { breezePersonId: v.breezePersonId } : {}) }).system;
    if (v.breezePersonId) p.breezePersonId = id(v.breezePersonId);
  } else p.reference = reference(v.reference);
  if (v.kind === "message") {
    if (p.reference.system !== "correspondence" || !p.reference.expectedVersion) fail("Messages require the exact approved Correspondence record version");
    p.channel = choice(v.channel, ["email", "text", "manual"], "delivery channel");
    if (!Array.isArray(v.recipients) || !v.recipients.length || v.recipients.length > 20) fail("Exact recipients are required");
    p.recipients = v.recipients.map(r => text(r, "recipient", 300)); p.threadId = text(v.threadId, "threadId", 1500, true);
    if (v.familyPurpose) {
      p.familyPurpose = choice(v.familyPurpose, ["approval_request", "confirmed", "changed", "cancelled"], "family message purpose");
      p.arrangementHash = text(v.arrangementHash, "arrangement hash", 64);
      if (v.familyPurpose !== "approval_request") p.familyNoticeId = id(v.familyNoticeId);
    } else if (v.arrangementHash || v.familyNoticeId) fail("Family metadata requires a family purpose");
  }
  if (!Array.isArray(v.dependsOn || []) || (v.dependsOn || []).length > 20) fail("Invalid dependencies");
  p.dependsOn = [...new Set((v.dependsOn || []).map(id))];
  return p;
}
function currentMeeting(r) { return r.events.meeting && !r.events.meeting.cancelled ? r.events.meeting : null; }
function meetingIdentity(e) { return e ? hash({ eventId: e.eventId, start: e.start, end: e.end, location: e.location }) : ""; }
// Derived from durable state, never an assertion that this client's Outlook
// connection is available. External preflight and readback remain mandatory.
function bookingProgress(r, familyAssessment, agreement, asOf) {
  const pending = r.actions.filter(a => !done(a) && a.proposal.kind === "calendar" && a.proposal.phase === "arrangement");
  const approvalActionIds = pending.filter(a => a.status === "proposed").map(a => a.actionId);
  const base = { calendarBooked: Boolean(currentMeeting(r)), participantAgreed: agreement,
    pendingMessageCount: r.actions.filter(a => !done(a) && a.proposal.kind === "message").length,
    pendingFamilyNoticeCount: (r.familyNotices || []).filter(n => n.status === "pending").length,
    approvalActionIds, connectorAccess: "check_in_active_client" };
  const result = (state, nextAction, blockers = [], actionId = null) => ({ ...base, state, nextAction, blockers, actionId });
  if (r.disposition !== "open") return result("closed", "none");
  const attempted = pending.find(a => ["dispatching", "unknown"].includes(a.status));
  if (attempted || r.reconciliationRequired) return result("reconciliation_needed", "reconcile_calendar", [attempted ? "prior_attempt_unresolved" : "calendar_changed"], attempted?.actionId || null);
  if (!pending.length) return currentMeeting(r) ? result("booked", "none") : result("needs_arrangement", "propose_arrangement", ["meeting_not_proposed"]);
  if (new Set(pending.map(a => a.proposal.calendar.role)).size !== pending.length) return result("blocked", "review_calendar_actions", ["competing_calendar_actions"]);
  const blockers = [];
  const needsFamily = pending.some(a => a.proposal.calendar.operation !== "cancel");
  if (needsFamily && familyAssessment.setupNeeded) blockers.push("family_policy_needs_setup");
  if (needsFamily && familyAssessment.required && !familyAssessment.approved) blockers.push("wife_approval_required");
  if (approvalActionIds.length) blockers.push("action_approval_required");
  if (blockers.length) return result("approvals_needed", blockers.includes("family_policy_needs_setup") ? "configure_family_policy" : approvalActionIds.length ? "approve_actions" : "record_family_approval", blockers);
  const eligible = pending.filter(a => a.proposal.dependsOn.every(d => action(r, d).status === "verified"));
  if (!eligible.length) return result("blocked", "complete_dependencies", ["dependencies_unverified"]);
  const a = eligible[0], c = a.proposal.calendar, o = r.observations[a.actionId];
  const fresh = o && o.proposalHash === a.proposalHash && recent(o.observedAt, { now: () => asOf });
  const observed = fresh && (c.operation === "cancel" || (o.availability?.conflictCount === 0 && o.availability.start <= c.start && o.availability.end >= c.end)) && (c.operation === "create" || o.currentEvent);
  return result("ready_to_book", observed ? "begin_calendar_action" : "check_calendar", [], a.actionId);
}
function summary(r, asOf = now({}), familyPolicy = { enabled: false, version: 0, windows: [] }) {
  const familyAssessment = family.assess(r, familyPolicy), actualFamily = family.assess(r, familyPolicy, false);
  const pendingNotices = (r.familyNotices || []).filter(n => n.status === "pending");
  const meeting = currentMeeting(r), unresolved = r.actions.filter(a => !done(a));
  const agreement = r.agreement?.accepted === true && r.agreement.meetingIdentity === meetingIdentity(meeting) && !actualFamily.setupNeeded && (!actualFamily.required || actualFamily.approved);
  const booking = bookingProgress(r, familyAssessment, agreement, asOf);
  const waitingOn = r.waitingOn === "dan" && ["ready_to_book", "booked"].includes(booking.state) ? "none" : r.waitingOn;
  let status = meeting ? agreement ? "confirmed" : "held" : "proposed";
  if (r.disposition !== "open") status = r.disposition;
  const reasons = [];
  if (r.disposition === "open" && familyAssessment.enabled && familyAssessment.blocks.length && familyAssessment.setupNeeded) reasons.push("family_policy_needs_setup");
  if (r.disposition === "open" && familyAssessment.required && !familyAssessment.approved) reasons.push("wife_approval_required");
  if (pendingNotices.length) reasons.push("wife_notification_pending");
  if (r.disposition === "open" && waitingOn === "dan" && !(booking.state === "approvals_needed" && !booking.approvalActionIds.length)) reasons.push("awaiting_dan");
  if (r.disposition === "open" && meeting && !agreement) reasons.push("participant_agreement_pending");
  if (r.disposition === "open" && ["requester", "other"].includes(waitingOn) && !r.nextReviewAt) reasons.push("response_pending");
  if (r.nextReviewAt && r.nextReviewAt <= asOf && r.disposition === "open") reasons.push("response_or_hold_review_due");
  if (r.reconciliationRequired) reasons.push("calendar_changes_need_review");
  if (unresolved.length) reasons.push("unfinished_actions");
  if (r.disposition === "met" && r.debrief === "pending") reasons.push("debrief_needed");
  if (r.disposition === "open" && meeting?.end <= asOf) reasons.push("meeting_outcome_needed");
  return { appointmentId: r.appointmentId, title: r.title, participants: r.participants || [], privacy: r.privacy, version: r.version, status,
    recommendation: r.recommendation, waitingOn, nextReviewAt: r.nextReviewAt, booking,
    debrief: r.debrief, meeting: meeting ? { start: meeting.start, end: meeting.end } : null,
    family: familyAssessment, pendingFamilyNotices: pendingNotices, remainingActionCount: unresolved.length, attentionReasons: reasons, updatedAt: r.updatedAt,
    complete: r.disposition !== "open" && r.debrief !== "pending" && unresolved.length === 0 && pendingNotices.length === 0 && !r.reconciliationRequired };
}
async function getAppointment(input, deps) {
  const { ownerSubject } = access(deps), r = owned(await col(deps, "Records").doc(id(input.appointmentId)).get(), ownerSubject);
  return { appointment: { ...r, ...summary(r, now(deps), await family.read(deps)) } };
}
async function listAppointments(input, deps) {
  const { ownerSubject } = access(deps), asOf = input.asOf ? policy.instant(input.asOf) : now(deps);
  const size = input.limit ?? 20; if (!Number.isInteger(size) || size < 1 || size > 100) fail("limit must be 1-100");
  choice(input.view || "open", ["open", "attention", "all"], "view");
  const snap = await col(deps, "Records").where("ownerSubject", "==", ownerSubject).limit(5001).get();
  if (snap.docs.length > 5000) fail("Appointment inventory exceeds bounded read", "appointments_read_limit", 422);
  const familyPolicy = await family.read(deps);
  const rows = snap.docs.map(d => summary(d.data(), asOf, familyPolicy)).filter(r => input.view === "all" || !r.complete)
    .filter(r => input.view !== "attention" || r.attentionReasons.length)
    .sort((a, b) => (a.nextReviewAt || a.meeting?.start || "9999").localeCompare(b.nextReviewAt || b.meeting?.start || "9999") || a.appointmentId.localeCompare(b.appointmentId));
  const binding = hash({ ownerSubject, view: input.view || "open", rows }); let offset = 0;
  if (input.cursor) { try { const c = JSON.parse(Buffer.from(input.cursor, "base64url")); if (c.binding !== binding || !Number.isInteger(c.offset) || c.offset < 0) throw Error(); offset = c.offset; } catch { fail("Inventory changed; restart browsing", "appointments_invalid_cursor", 409); } }
  const more = rows.length > offset + size;
  return { appointments: rows.slice(offset, offset + size), totalCount: rows.length, complete: !more,
    nextCursor: more ? Buffer.from(JSON.stringify({ binding, offset: offset + size })).toString("base64url") : "" };
}
async function getAppointmentHistory(input, deps) {
  await getAppointment(input, deps);
  const size = input.limit ?? 25; if (!Number.isInteger(size) || size < 1 || size > 100) fail("Invalid limit");
  const snap = await col(deps, "History").where("appointmentId", "==", input.appointmentId).limit(5001).get();
  if (snap.docs.length > 5000) fail("History exceeds bounded read", "appointments_read_limit", 422);
  const rows = snap.docs.map(d => d.data()).filter(r => r.version > (input.afterVersion || 0)).sort((a, b) => a.version - b.version);
  return { events: rows.slice(0, size), complete: rows.length <= size, nextAfterVersion: rows.length > size ? rows[size - 1].version : null };
}
async function getAppointmentPreparation(input, deps) {
  const { appointment: r } = await getAppointment(input, deps);
  return { appointment: r, retrievalRequests: [
    ...Object.entries(r.events).map(([role, e]) => ({ source: "Outlook Calendar", operation: "fetch_event", role, eventId: e.eventId, calendarId: e.calendarId })),
    ...r.links.map(l => ({ source: l.system, recordId: l.recordId, ...(l.breezePersonId ? { breezePersonId: l.breezePersonId } : {}) }))
  ], guidance: "First reread linked Outlook events and reconcile changes. Then retrieve the current agenda and permitted source records. Present purpose, decisions, questions, preparation and prayer time. Never copy confidential source text into this record." };
}
function recent(at, deps) { const delta = Date.parse(now(deps)) - Date.parse(at); return delta >= 0 && delta <= 5 * 60 * 1000; }
function approvedSequence(r) {
  const blocks = { ...r.events };
  for (const a of r.actions) if (["approved", "dispatching", "unknown"].includes(a.status) && a.proposal.kind === "calendar") {
    const c = a.proposal.calendar;
    if (c.operation === "cancel") delete blocks[c.role]; else blocks[c.role] = c;
  }
  const active = Object.entries(blocks).filter(([, e]) => !e.cancelled).map(([role, e]) => ({ role, start: e.start, end: e.end }));
  if (active.length && active.some(b => b.role === "meeting")) policy.sequence(active);
  // A cancellation-only bundle may temporarily leave old blocks; reconciliation
  // remains mandatory before the appointment can be closed.
}
function eventSnapshot(v) {
  shape(v, ["eventId", "calendarId", "start", "end", "location", "subject", "body", "attendees", "cancelled"]);
  const e = { eventId: text(v.eventId, "eventId", 1500), calendarId: text(v.calendarId, "calendarId", 1000, true), cancelled: v.cancelled === true };
  if (!e.cancelled) Object.assign(e, policy.range(v), { location: text(v.location, "location", 1000, true), subject: text(v.subject, "subject", 200), body: text(v.body, "body", 3000, true), attendees: (v.attendees || []).map(a => text(a, "attendee", 300)) });
  return e;
}
function matchesEvent(c, e) {
  return e && (c.operation === "cancel" ? e.cancelled : !e.cancelled && c.start === e.start && c.end === e.end && c.location === e.location && c.subject === e.subject && c.body === e.body && stableStringify([...c.attendees].sort()) === stableStringify([...e.attendees].sort())) &&
    (!c.eventId || c.eventId === e.eventId) && c.calendarId === e.calendarId;
}

async function runAppointmentCommand(operation, input, key, deps) {
  const { ownerSubject, actorSub } = access(deps);
  text(key, "idempotencyKey", 180); if (key.length < 8) fail("Idempotency key too short");
  if (operation === "recordAppointmentDomainVerification" && !deps.trustedDomainVerification) fail("Owning gateway readback required", "appointments_verification_forbidden", 403);
  const intent = hash({ ownerSubject, actorSub, key }), creating = operation === "createAppointment";
  const appointmentId = creating ? `appointment-${intent.slice(0, 32)}` : id(input.appointmentId);
  const ref = col(deps, "Records").doc(appointmentId), receiptRef = col(deps, "Receipts").doc(intent);
  const fingerprint = hash({ operation, input });
  const result = await deps.firestoreDb.runTransaction(async tx => {
    const [receipt, existing, familyPolicy] = await Promise.all([tx.get(receiptRef), tx.get(ref), family.read(deps, tx)]);
    if (receipt.exists) { if (receipt.data().fingerprint !== fingerprint) fail("Key already used for different intent", "idempotency_key_reused", 409); return { ...receipt.data().result, replayed: true }; }
    const at = now(deps); let r;
    if (creating) {
      if (existing.exists) fail("Appointment exists", "appointments_conflict", 409);
      if (input.contentClassification !== "general_or_neutral") fail("Sensitive source content must stay in its owning domain", "appointments_sensitive_source", 422);
      const privacy = choice(input.privacy || "restricted", ["general", "restricted"], "privacy");
      if (privacy === "restricted" && input.title && input.title !== "Pastoral appointment") fail("Use a neutral title for restricted appointments");
      let sourceRef = null;
      if (input.sourceRef) {
        shape(input.sourceRef, ["system", "recordId"]);
        sourceRef = { system: choice(input.sourceRef.system, ["email", "text", "phone", "conversation", "notebooks", "pastoral_care"], "source reference"), recordId: text(input.sourceRef.recordId, "source record ID", 1500) };
      }
      if (!Array.isArray(input.participants || []) || (input.participants || []).length > 30) fail("Use at most 30 participants");
      const participants = (input.participants || []).map(p => {
        shape(p, ["name", "source", "recordId"]);
        return { name: text(p.name, "participant name", 200), source: choice(p.source, ["contacts", "breeze", "dan_relationships", "user"], "participant source"), recordId: text(p.recordId, "participant ID", 500, p.source === "user") };
      });
      r = { appointmentId, ownerSubject, actorSub, version: 1, createdAt: at, updatedAt: at,
        privacy, participants, title: privacy === "restricted" ? "Pastoral appointment" : text(input.title, "title", 200),
        purpose: privacy === "restricted" ? "" : text(input.purpose, "purpose", 2000, true),
        sourceChannel: choice(input.sourceChannel || "conversation", ["conversation", "email", "text", "phone", "other"], "source channel"),
        sourceRef, urgency: choice(input.urgency || "unknown", ["unknown", "routine", "time_sensitive", "urgent"], "urgency"),
        recommendation: "undecided", disposition: "open", waitingOn: "dan", nextReviewAt: "", debrief: "pending",
        actions: [], links: [], events: {}, observations: {}, agreement: null, reconciliationRequired: false,
        defaults: { timezone: "America/Los_Angeles", preparationMinutes: 30, confirmation: "original_channel", energy: "advisory" } };
      if (privacy === "restricted" && input.purpose) fail("Put sensitive explanations in Pastoral Care; omit purpose here");
    } else {
      r = structuredClone(owned(existing, ownerSubject)); expected(r, input.expectedVersion);
      r.version++; r.updatedAt = at; r.actorSub = actorSub;
      if (operation === "recordAppointmentWifeApproval") {
        family.recordApproval(r, familyPolicy, input, actorSub, deps);
      } else if (operation === "setAppointmentDecision") {
        r.recommendation = choice(input.recommendation, ["undecided", "clarify", "text", "email", "phone", "meeting", "refer", "no_action"], "recommendation");
        r.waitingOn = choice(input.waitingOn, ["dan", "requester", "other", "none"], "next actor");
        r.nextReviewAt = input.nextReviewAt ? policy.instant(input.nextReviewAt) : "";
      } else if (operation === "proposeAppointmentAction") {
        const p = proposal(input.proposal, r.privacy), actionId = input.actionId ? id(input.actionId) : `action-${intent.slice(0, 24)}`;
        const previous = r.actions.find(a => a.actionId === actionId);
        if (previous && !["proposed", "approved"].includes(previous.status)) fail("Reconcile dispatched actions before replacing them", "appointments_action_locked", 409);
        if (p.dependsOn.some(d => d === actionId || !r.actions.some(a => a.actionId === d))) fail("Dependencies must name earlier actions");
        const visits = new Set([actionId]); const walk = aid => { if (visits.has(aid)) fail("Action dependency cycle"); visits.add(aid); for (const d of action(r, aid).proposal.dependsOn) walk(d); visits.delete(aid); }; p.dependsOn.forEach(walk);
        if (!previous && r.actions.length >= 100) fail("Use a follow-on appointment after 100 actions");
        const a = { actionId, proposal: p, proposalHash: hash(p), status: "proposed" };
        if (previous?.proposalHash === a.proposalHash) Object.assign(a, previous);
        if (previous) r.actions[r.actions.indexOf(previous)] = a; else r.actions.push(a);
        if (previous && previous.proposalHash !== a.proposalHash) {
          const affected = new Set([actionId]); let added;
          do { added = false; for (const dependent of r.actions) if (!affected.has(dependent.actionId) && dependent.proposal.dependsOn.some(d => affected.has(d))) { affected.add(dependent.actionId); added = true; } } while (added);
          for (const dependent of r.actions) if (affected.has(dependent.actionId) && dependent.actionId !== actionId) {
            if (["dispatching", "unknown"].includes(dependent.status)) fail("Reconcile dependent attempts before changing their arrangement", "appointments_action_locked", 409);
            if (dependent.status === "approved") { dependent.status = "proposed"; delete dependent.approval; }
          }
        }
        if (p.phase === "follow_up") r.debrief = "pending";
      } else if (operation === "approveAppointmentActions") {
        if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100 || new Set(input.items.map(x => x.actionId)).size !== input.items.length) fail("Select unique exact actions");
        if (input.userApproved !== true) fail("Explicit itemized user approval required");
        for (const item of input.items) {
          shape(item, ["actionId", "proposalHash"]); const a = action(r, item.actionId);
          if (!["proposed", "approved"].includes(a.status) || a.proposalHash !== item.proposalHash) fail("Action changed; review it again", "appointments_proposal_changed", 409);
          a.status = "approved"; a.approval = { proposalHash: a.proposalHash, actorSub, approvedAt: at };
        }
        approvedSequence(r);
        if (r.waitingOn === "dan" && !r.actions.some(a => a.status === "proposed" && a.proposal.phase === "arrangement")) r.waitingOn = "none";
      } else if (operation === "recordAppointmentObservation") {
        const a = action(r, input.actionId);
        if (a.proposal.kind !== "calendar" || !["proposed", "approved"].includes(a.status)) fail("An unattempted calendar action is required");
        const observedAt = policy.instant(input.observedAt); if (!recent(observedAt, deps)) fail("Reread the calendar now; observation must be within five minutes");
        const o = { observedAt, method: "client_connector_readback", proposalHash: a.proposalHash };
        if (input.currentEvent) {
          const e = eventSnapshot(input.currentEvent), c = a.proposal.calendar;
          if (!c.eventId || e.eventId !== c.eventId || e.calendarId !== c.calendarId) fail("Observation targets a different event");
          if (r.privacy === "restricted") { delete e.subject; delete e.body; }
          o.currentEvent = e;
        }
        if (input.availability) {
          shape(input.availability, ["start", "end", "conflictCount"]); o.availability = policy.range(input.availability);
          if (input.availability.conflictCount !== 0) fail("Resolve calendar conflicts before proceeding");
          o.availability.conflictCount = 0;
        }
        r.observations[a.actionId] = o;
      } else if (operation === "beginAppointmentAction") {
        const a = action(r, input.actionId);
        if (a.status !== "approved") fail("Only an approved, unattempted action can begin; reconcile any prior attempt", "appointments_action_locked", 409);
        if (a.proposal.dependsOn.some(d => action(r, d).status !== "verified")) fail("Verify dependent actions first");
        if (a.proposal.kind === "calendar" && a.proposal.calendar.operation !== "cancel") {
          const latest = r.actions.filter(x => !done(x) && x.proposal.kind === "calendar" && x.proposal.calendar.role === a.proposal.calendar.role).at(-1);
          if (familyPolicy.enabled && latest?.actionId !== a.actionId) fail("Review the latest arrangement before dispatch", "appointments_family_arrangement_changed", 409);
          family.guard(r, familyPolicy);
        }
        if (a.proposal.kind === "message") family.checkMessage(r, familyPolicy, a);
        if (a.proposal.kind === "message" && ((!a.proposal.familyPurpose && r.reconciliationRequired) || Object.values(r.events).some(e => !recent(e.observedAt, deps)))) fail("Reread and reconcile linked calendar blocks before sending", "appointments_calendar_read_required", 409);
        if (a.proposal.kind === "calendar") {
          const c = a.proposal.calendar, o = r.observations[a.actionId];
          if (!o || o.proposalHash !== a.proposalHash || !recent(o.observedAt, deps)) fail("Fresh matching calendar observation required", "appointments_calendar_read_required", 409);
          if (c.operation !== "cancel" && (!o.availability || o.availability.start > c.start || o.availability.end < c.end)) fail("Check availability for the whole block");
          if (c.operation !== "create" && !o.currentEvent) fail("Reread the current event before changing it");
        }
        a.status = "dispatching"; a.startedAt = at; a.startedBy = actorSub;
        a.dispatchKey = `appointment-${hash({ appointmentId, actionId: a.actionId, proposalHash: a.proposalHash }).slice(0, 48)}`;
      } else if (operation === "recordAppointmentActionResult") {
        const a = action(r, input.actionId);
        if (!["dispatching", "unknown"].includes(a.status) || !["calendar", "message"].includes(a.proposal.kind)) fail("An attempted connector action is required");
        choice(input.outcome, ["unknown", "read_back", "user_reported"], "outcome");
        if (input.outcome === "unknown") { a.status = "unknown"; a.result = { method: "unverified", observedAt: at }; }
        else {
          const observedAt = policy.instant(input.observedAt); if (observedAt < a.startedAt || observedAt > at) fail("Evidence must follow the attempt and cannot be future dated");
          if (a.proposal.kind === "calendar") {
            if (input.outcome !== "read_back") fail("Calendar results require a connector readback");
            const e = eventSnapshot(input.event);
            if (!matchesEvent(a.proposal.calendar, e)) fail("Calendar readback differs from the approved action", "appointments_result_mismatch", 409);
            r.events[a.proposal.calendar.role] = { ...e, observedAt, method: "client_connector_readback" };
            if (r.privacy === "restricted") { delete r.events[a.proposal.calendar.role].subject; delete r.events[a.proposal.calendar.role].body; }
            a.result = { method: "client_connector_readback", observedAt, eventId: e.eventId };
          } else {
            shape(input.message, ["sourceId", "correspondenceVersion", "recipients", "contentMatched"]);
            if (input.message.correspondenceVersion !== a.proposal.reference.expectedVersion || input.message.contentMatched !== true || stableStringify(input.message.recipients) !== stableStringify(a.proposal.recipients)) fail("Message evidence must match exact approved recipients and wording version");
            a.result = { method: input.outcome === "read_back" ? "client_connector_readback" : "user_reported", observedAt,
              sourceId: text(input.message.sourceId, "message source ID", 1500), deliveryConfirmed: false };
            if (a.proposal.familyNoticeId) {
              const notice = (r.familyNotices || []).find(n => n.noticeId === a.proposal.familyNoticeId);
              if (!notice) fail("Family notice not found");
              notice.status = "sent"; notice.actionId = a.actionId; notice.result = { ...a.result };
            }
          }
          a.status = "verified";
        }
      } else if (operation === "bindAppointmentHandoff") {
        const a = action(r, input.actionId), target = reference(input.reference);
        if (a.proposal.kind !== "domain_handoff" || a.status !== "dispatching" || a.boundReference) fail("Only an unbound dispatched handoff can acquire its owning target");
        if (target.system !== a.proposal.targetSystem || (a.proposal.breezePersonId && target.breezePersonId !== a.proposal.breezePersonId)) fail("Handoff target differs from the approved owning system or person");
        a.boundReference = target;
      } else if (operation === "recordAppointmentDomainVerification") {
        const a = action(r, input.actionId);
        if (!["domain_reference", "domain_handoff"].includes(a.proposal.kind) || a.status !== "dispatching") fail("Begin an approved reference or handoff action first");
        const t = a.boundReference || a.proposal.reference, receipt = input.receipt;
        if (!t) fail("Bind the owning saved record before verification");
        if (receipt && receipt.version !== null && (!Number.isInteger(receipt.version) || receipt.version < 1)) fail("Invalid owning record version");
        if (!receipt || receipt.system !== t.system || receipt.recordId !== t.recordId || (t.expectedVersion && receipt.version !== t.expectedVersion)) fail("Owning readback did not match");
        const link = { ...t, version: receipt.version ?? null, method: "owning_gateway_readback", verifiedAt: at };
        delete link.expectedVersion;
        r.links = r.links.filter(l => l.system !== t.system || l.recordId !== t.recordId); r.links.push(link);
        a.status = "verified"; a.result = link;
      } else if (operation === "recordAppointmentAgreement") {
        family.guard(r, familyPolicy); family.guard(r, familyPolicy, false);
        if (familyPolicy.enabled && r.actions.some(a => !done(a) && a.proposal.kind === "calendar")) fail("Verify all planned calendar blocks before confirming", "appointments_family_arrangement_changed", 409);
        const meeting = currentMeeting(r);
        if (!meeting || r.reconciliationRequired) fail("Reconcile and verify the actual meeting before recording agreement");
        if (input.accepted !== true || input.start !== meeting.start || input.end !== meeting.end || input.location !== meeting.location) fail("Agreement must match the current meeting details");
        r.agreement = { accepted: true, meetingIdentity: meetingIdentity(meeting), source: choice(input.source, ["user_reported", "reply_readback", "attendee_acceptance"], "agreement source"), sourceId: text(input.sourceId, "agreement source", 1500), recordedAt: at };
        r.waitingOn = "none"; r.nextReviewAt = "";
      } else if (operation === "reconcileAppointmentEvent") {
        const role = input.role, previous = r.events[role]; if (!previous) fail("Linked event not found");
        const e = eventSnapshot(input.event); if (e.eventId !== previous.eventId || e.calendarId !== previous.calendarId) fail("Read the exact linked event");
        const observedAt = policy.instant(input.observedAt); if (!recent(observedAt, deps)) fail("Use a fresh calendar readback");
        const changed = previous.cancelled !== e.cancelled || previous.start !== e.start || previous.end !== e.end || previous.location !== e.location;
        r.events[role] = { ...e, observedAt, method: "client_connector_readback" };
        if (r.privacy === "restricted") { delete r.events[role].subject; delete r.events[role].body; }
        if (changed) { r.reconciliationRequired = true; if (role === "meeting") { r.agreement = null; r.waitingOn = "dan"; r.nextReviewAt = at; } }
      } else if (operation === "resolveAppointmentReconciliation") {
        if (input.userApproved !== true) fail("User review of changed arrangements is required");
        for (const e of Object.values(r.events)) if (!recent(e.observedAt, deps)) fail("Reread all linked blocks before resolving changes");
        if (Object.values(r.events).some(e => !e.cancelled) && !currentMeeting(r)) fail("Resolve remaining preparation or travel for the cancelled meeting");
        if (currentMeeting(r)) policy.sequence(Object.entries(r.events).filter(([, e]) => !e.cancelled).map(([role, e]) => ({ role, start: e.start, end: e.end })));
        r.reconciliationRequired = false;
      } else if (operation === "recordAppointmentOutcome") {
        if (input.userConfirmed !== true) fail("Ask Dan what actually happened");
        r.disposition = choice(input.outcome, ["open", "met", "cancelled", "no_show", "resolved_without_meeting"], "meeting outcome");
        if (r.disposition === "resolved_without_meeting" && currentMeeting(r)) fail("Resolve linked calendar blocks first");
        if (r.disposition === "cancelled" && Object.values(r.events).some(e => !e.cancelled)) fail("Reconcile or cancel remaining calendar blocks first");
        if (r.disposition !== "open") { r.waitingOn = "none"; r.nextReviewAt = ""; }
      } else if (operation === "finishAppointmentDebrief") {
        if (input.userConfirmed !== true || r.disposition === "open") fail("Confirm the actual outcome and review follow-up first");
        if (r.actions.some(a => a.proposal.phase === "follow_up" && !done(a))) fail("Resolve each follow-up before completing the debrief");
        r.debrief = choice(input.result, ["complete", "not_needed"], "debrief result");
      } else if (operation === "dismissAppointmentAction") {
        const a = action(r, input.actionId);
        if (!["proposed", "approved"].includes(a.status) || input.userConfirmed !== true) fail("Attempted actions need reconciliation; only user-dismissed unattempted actions can close");
        if (r.actions.some(b => !done(b) && b.proposal.dependsOn.includes(a.actionId))) fail("Resolve dependent actions first");
        a.status = "dismissed";
      } else fail("Unknown appointment command");
    }
    if (!creating) family.syncNotices(r, owned(existing, ownerSubject), familyPolicy, at);
    if (Buffer.byteLength(stableStringify(r)) > 700000) fail("Appointment is too large; split follow-on work");
    const saved = { appointmentId, operation, version: r.version };
    tx.set(ref, r); tx.create(receiptRef, { ownerSubject, actorSub, fingerprint, result: saved, createdAt: at });
    // Deliberately no source text, purpose, message bodies, calendar bodies or care content in audit events.
    tx.create(col(deps, "History").doc(`${appointmentId}-${String(r.version).padStart(8, "0")}`), { appointmentId, ownerSubject, actorSub, version: r.version, operation, actionId: input.actionId || "", proposalHash: input.actionId ? r.actions.find(a => a.actionId === input.actionId)?.proposalHash || "" : "", occurredAt: at });
    return saved;
  });
  return { ...result, ...(await getAppointment({ appointmentId }, deps)), readBackVerified: true,
    ...(operation === "beginAppointmentAction" ? { dispatchInstruction: result.replayed ? "reconcile_only" : "execute_once" } : {}) };
}
module.exports = { getAppointment, listAppointments, getAppointmentHistory, getAppointmentPreparation, runAppointmentCommand, reference, summary };
