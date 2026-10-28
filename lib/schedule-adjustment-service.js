"use strict";

// Task Management owns this small approval/receipt workflow, never a second task
// or calendar store. Outlook writes remain in the authorized client connector.
const { requireDanPrivateAccess, normalizeOwnerSubjects } = require("./dan-private-access");
const { getTask, listTasks } = require("./project-task-service");
const { buildCapacityPlan } = require("./capacity-planning-service");
const p = require("./schedule-adjustment-policy");
const DEFINITIONS = [
  ["getScheduleAdjustmentGuide", "query", [], "Read the exact preview, approval, one-time Outlook dispatch, task update and reconciliation contract."],
  ["previewScheduleAdjustment", "query", ["taskId", "expectedVersion", "proposedStart", "flexible", "planning", "calendarIds", "observation"], "Read one unchanged-duration focus-block adjustment; preserve full personal task accounting and unrelated risks. No writes."],
  ["getScheduleAdjustment", "query", ["adjustmentId"], "Read saved approval, exact proposal, attempt evidence and recovery instructions. Never authorizes redispatch."],
  ["approveScheduleAdjustment", "command", ["preview", "proposalHash", "userApproved"], "After Dan explicitly approves the displayed exact preview, bind approval to its digest and freshly rechecked task/event. Saves workflow only."],
  ["beginScheduleAdjustment", "command", ["adjustmentId", "expectedVersion", "proposalHash", "calendar", "observation"], "Recheck exact approved task/event and fresh complete availability, then lock one calendar dispatch. Only execute_once authorizes the exact returned connector call; replay requires reconciliation."],
  ["recordScheduleAdjustmentResult", "command", ["adjustmentId", "expectedVersion", "outcome"], "Save unknown or independently observed calendar outcome. An exact fresh readback plus calendar coverage permits one expected-version task update. Never retries Outlook. outcome unknown or observed; observed requires observation and calendar."],
  ["verifyScheduleAdjustment", "command", ["adjustmentId", "expectedVersion", "observation"], "Independently reread task and freshly fetched Outlook event after both attempts. Verify exact schedules and preserved task fields, or retain partial/uncertain evidence. Never writes either source."],
];
const OPERATIONS = DEFINITIONS.map(([name, mode, required, summary]) => ({ name, mode, required, optional: name === "recordScheduleAdjustmentResult" ? ["observation", "calendar"] : [], summary }));
const NAMES = new Set(OPERATIONS.map(o => o.name));
const GUIDE = {
  owner: "Task Management", schemaVersion: 1,
  preview: "Call previewScheduleAdjustment with taskId, expectedVersion, proposedStart (explicit ISO offset), flexible:true after identifying a flexible focus block. planning is the buildCapacityPlan {horizon,timezone,workWindows,calendar} input without proposal/flexibleTaskIds. calendarIds:[exact primary calendar ID]. The horizon covers the proposed slot, at most 14 days; it need not include the old slot, which must be fetched independently. Calendar coverage must be complete, fully paginated and recurrence-expanded. Do not invent work windows. Missing estimates remain visible; this moves the existing reservation without promising completion.",
  observation: "observation:{observedAt,event:{calendarId,eventId,start,end,type:singleInstance,isOrganizer:true,attendees:[],recurrence:null,seriesMasterId:null,isAllDay:false,cancelled:false,showAs:busy,subject,body,location,etag?,changeKey?,lastModifiedDateTime?}}. Read full event via fetch_event, use actual UTC/offset times and exact raw IDs. Map response_status organizer to isOrganizer, body.content to body and location.displayName to location. Supply provider concurrency values only when returned, otherwise null. The body must identify exactly one task. Inspect task context for additional sessions and constraints. Calendar evidence is client-attested, never backend-verified.",
  approval: "Display task title/ID/version, exact current and proposed local dates/times, unchanged duration, calendar/event identity, capacity, selected-task and inventory risks, and proposalHash. Wait for Dan's explicit approval of only that change. approveScheduleAdjustment {preview:exact preview input,proposalHash,userApproved:true}; changed preview needs new approval. Approval expires after 15 minutes before dispatch. A proposal or generic instruction to implement this workflow is not approval.",
  execution: "Refresh task, fetch_event and complete calendar coverage. beginScheduleAdjustment with current workflow version, exact proposalHash, fresh observation/calendar. Observations must be after saved approval and within 60 seconds for begin. Only a newly returned dispatchInstruction execute_once authorizes update_event with precisely dispatch.arguments (start/end only). Verify dispatchNotAfter before calling; never call after interruption or replay. Outlook connector lacks conditional If-Match and idempotency; do not invent either. Do not create/delete events, invite attendees, change subject/body or call updateTask separately.",
  result: "After connector call, independently fetch_event and refresh complete calendar coverage. recordScheduleAdjustmentResult outcome observed plus observation/calendar; outcome unknown if timeout/error/unavailable. Exact readback permits the backend's one existing expected-version updateTask call. It preserves ownership, effort, priorities, deadlines, links, assignment and historical context. Then fetch_event again AFTER task attempt/readback and call verifyScheduleAdjustment, which independently rereads task. Report verified only from that result.",
  recovery: "On any interruption call getScheduleAdjustment. Never repeat a calendar write after begin, even if no response was received. Fetch the exact event: if it matches the approved move, record observed evidence and finish the still-unattempted task leg. If task was already attempted, use verify only; never retry uncertain writes. If either system differs, retain reconciliation_required and show both observations. Any rollback, revised time or manual repair requires a separately reviewed exact proposal; no automatic rollback. Task and calendar updates are not atomic.",
};
const now = deps => new Date(typeof deps.now === "function" ? deps.now() : Date.now()).getTime();
function auth(deps) {
  const a = requireDanPrivateAccess(deps), owners = new Set(normalizeOwnerSubjects(deps.danOwnerSubjects));
  if (!a.subjects.some(s => owners.has(s))) p.fail("Only Dan may use schedule adjustments; private delegation is insufficient", "schedule_adjustment_owner_only", 403);
  a.subjects.forEach(s => owners.add(s));
  return { actor: a.subject, owner: normalizeOwnerSubjects(deps.danOwnerSubjects)[0], owners };
}
function db(deps) {
  if (!deps.firestoreDb?.runTransaction) p.fail("Schedule workflow storage unavailable", "schedule_adjustment_storage_unavailable", 503);
  return deps.firestoreDb;
}
function ref(deps, id) {
  if (!/^schedule-adjustment-[a-f0-9]{40}$/.test(id || "")) p.fail("Invalid adjustmentId");
  return db(deps).collection("taskScheduleAdjustments").doc(id);
}
function owned(record, a) {
  if (!record || record.ownerSub !== a.owner) p.fail("Adjustment not found", "schedule_adjustment_not_found", 404);
  return record;
}
function output(record) {
  return { adjustment: record, calendarBackendVerified: false, dispatchInstruction: "reconcile_only",
    nextAction: record.state === "approved" ? "refresh_and_begin" : record.state === "verified" ? "report_verified" : "read_both_sources_and_reconcile; never repeat the calendar write",
    reconciliation: GUIDE.recovery };
}
async function uniqueLink(task, deps, tx = null) {
  const collection = deps.tasksCollection;
  const read = query => tx ? tx.get(query) : query.get();
  const rows = await Promise.all(["outlookEventId", "eventId"].map(key => read(collection.where(key, "==", task.outlookEventId).limit(1001))));
  if (rows.some(r => r.docs.length >= 1001)) p.fail("Event-link coverage exceeds the verification budget", "schedule_adjustment_shared_block");
  const linked = new Set(rows.flatMap(r => r.docs).filter(d => (d.data().outlookCalendarId || "") === task.outlookCalendarId).map(d => d.id));
  if (linked.size !== 1 || !linked.has(task.taskId)) p.fail("The event is shared or its unique task link is unverified", "schedule_adjustment_shared_block");
}
async function preview(input, deps) {
  const a = auth(deps), task = (await getTask({ taskId: input.taskId }, deps)).task;
  await uniqueLink(task, deps);
  const inventory = await listTasks({ view: "authorized", includeArchived: true }, deps, true);
  const plan = await buildCapacityPlan(input.planning, deps);
  return p.assessAdjustment(input, task, inventory.tasks, plan, a.owners, now(deps));
}
async function load(input, deps) { return owned((await ref(deps, input.adjustmentId).get()).data(), auth(deps)); }
function requestFrom(record, calendar, observation) {
  const v = record.proposal, a = v.assumptions;
  return { taskId: v.taskId, expectedVersion: v.taskVersion, proposedStart: v.after.start, flexible: true,
    calendarIds: a.calendarIds, planning: { horizon: a.horizon, timezone: a.timezone, workWindows: a.workWindows, calendar }, observation };
}
// Record changes, actor-bound idempotency receipt and content-free audit together.
// Receipts never return execute_once on replay, even after a lost HTTP response.
async function commit(operation, input, key, deps, change) {
  const a = auth(deps);
  if (typeof key !== "string" || key.length < 8 || key.length > 180) p.fail("A stable idempotency key is required");
  const intent = p.hash({ actor: a.actor, key }), fingerprint = p.hash({ operation, input });
  const id = operation === "approveScheduleAdjustment" ? `schedule-adjustment-${p.hash({ owner: a.owner, proposalHash: input.proposalHash, intent }).slice(0, 40)}` : input.adjustmentId;
  const recordRef = ref(deps, id), receiptRef = db(deps).collection("taskScheduleAdjustmentReceipts").doc(intent);
  const result = await db(deps).runTransaction(async tx => {
    const receipt = (await tx.get(receiptRef)).data();
    const current = (await tx.get(recordRef)).data();
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) p.fail("Idempotency key reused with different intent", "idempotency_key_reused");
      return { record: owned(current, a), replayed: true };
    }
    if (operation !== "approveScheduleAdjustment") {
      owned(current, a);
      if (!Number.isInteger(input.expectedVersion) || current.version !== input.expectedVersion) p.fail("Workflow changed; reread it", "schedule_adjustment_version_conflict");
    }
    const next = await change(current, tx, a);
    next.adjustmentId = id; next.ownerSub = a.owner; next.version = (current?.version || 0) + 1; next.updatedAt = new Date(now(deps)).toISOString();
    tx.set(recordRef, next);
    tx.create(receiptRef, { adjustmentId: id, fingerprint, operation, actorSub: a.actor, version: next.version, createdAt: next.updatedAt });
    tx.create(recordRef.collection("history").doc(String(next.version).padStart(8, "0")), { operation, actorSub: a.actor, version: next.version, state: next.state, at: next.updatedAt });
    return { record: next, replayed: false };
  });
  const readback = owned((await recordRef.get()).data(), a);
  return { ...result, record: readback };
}
async function taskUnchanged(proposal, deps, tx) {
  const task = (await getTask({ taskId: proposal.taskId }, deps)).task;
  if (p.hash(task) !== proposal.taskHash) p.fail("Task changed since the exact preview", "schedule_adjustment_stale");
  await uniqueLink(task, deps, tx);
  // Enlist the owning task in this transaction to invalidate the dispatch lock
  // if its version changes while the lock is being committed.
  const raw = (await tx.get(deps.tasksCollection.doc(task.taskId))).data();
  if (!raw || raw.version !== proposal.taskVersion || raw.updatedAt !== task.updatedAt) p.fail("Task changed during preflight", "schedule_adjustment_stale");
}
async function runScheduleAdjustmentOperation(input, deps) {
  auth(deps);
  const op = OPERATIONS.find(o => o.name === input.operation && o.mode === input.mode), args = input.arguments || {};
  if (!op) p.fail("Unknown schedule adjustment operation");
  p.shape(args, [...op.required, ...op.optional]);
  if (op.required.some(k => args[k] === undefined)) p.fail("Missing schedule adjustment arguments");
  let result;
  if (op.name === "getScheduleAdjustmentGuide") result = GUIDE;
  else if (op.name === "previewScheduleAdjustment") result = await preview(args, deps);
  else if (op.name === "getScheduleAdjustment") result = output(await load(args, deps));
  else if (op.name === "approveScheduleAdjustment") {
    if (args.userApproved !== true) p.fail("Dan's explicit approval is required", "schedule_adjustment_approval_required");
    const prepared = await preview(args.preview, deps);
    if (prepared.proposalHash !== args.proposalHash) p.fail("Preview changed; obtain new exact approval", "schedule_adjustment_stale");
    const r = await commit(op.name, args, input.idempotencyKey, deps, async (current, tx, a) => {
      if (current) p.fail("This proposal already has an approval/attempt; retrieve it instead of creating another", "schedule_adjustment_exists");
      await taskUnchanged(prepared.proposal, deps, tx);
      return { state: "approved", proposal: prepared.proposal, proposalHash: prepared.proposalHash,
        approvedBy: a.actor, approvedAt: new Date(now(deps)).toISOString(), expiresAt: new Date(now(deps) + 900000).toISOString(),
        calendarAttemptedAt: null, taskAttemptedAt: null, taskReadBackAt: null, calendarEvidence: null, taskEvidence: null };
    });
    result = { ...output(r.record), replayed: r.replayed };
  } else if (op.name === "beginScheduleAdjustment") {
    const saved = await load(args, deps);
    if (saved.proposalHash !== args.proposalHash) p.fail("Approval digest mismatch");
    // A replay is always observation-only, even when new input would otherwise fit.
    if (saved.calendarAttemptedAt) result = output(saved);
    else {
      const check = await preview(requestFrom(saved, args.calendar, args.observation), deps);
      if (check.proposalHash !== saved.proposalHash) p.fail("Task/event/concurrency evidence changed; obtain a new preview and approval", "schedule_adjustment_stale");
      p.fresh(args.observation.observedAt, now(deps), Date.parse(saved.approvedAt), 60000);
      p.fresh(args.calendar.observedAt, now(deps), Date.parse(saved.approvedAt), 60000);
      const r = await commit(op.name, args, input.idempotencyKey, deps, async (current, tx) => {
        if (current.state !== "approved" || current.calendarAttemptedAt || Date.parse(current.expiresAt) < now(deps)) p.fail("Approval expired or was already attempted", "schedule_adjustment_stale");
        await taskUnchanged(current.proposal, deps, tx);
        for (const identity of [current.proposal.taskId, [current.proposal.event.calendarId, current.proposal.event.eventId]]) {
          const lockRef = db(deps).collection("taskScheduleAdjustmentLocks").doc(p.hash(identity));
          const lock = (await tx.get(lockRef)).data();
          if (lock && lock.adjustmentId !== current.adjustmentId) p.fail("Another adjustment has an unresolved attempt for this task/event", "schedule_adjustment_locked");
        }
        for (const identity of [current.proposal.taskId, [current.proposal.event.calendarId, current.proposal.event.eventId]]) tx.set(db(deps).collection("taskScheduleAdjustmentLocks").doc(p.hash(identity)), { adjustmentId: current.adjustmentId });
        return { ...current, state: "calendar_dispatching", calendarAttemptedAt: new Date(now(deps)).toISOString(),
          dispatchNotAfter: new Date(now(deps) + 30000).toISOString(), preflightObservedAt: args.observation.observedAt, availabilityObservedAt: args.calendar.observedAt };
      });
      result = { ...output(r.record), replayed: r.replayed };
      if (!r.replayed && r.record.state === "calendar_dispatching") result = { ...result, dispatchInstruction: "execute_once", dispatchNotAfter: r.record.dispatchNotAfter,
        dispatch: { tool: "microsoft_outlook_calendar.update_event", arguments: { calendar_id: r.record.proposal.event.calendarId, event_id: r.record.proposal.event.eventId,
          start: { dateTime: r.record.proposal.after.start.replace("Z", ""), timeZone: "UTC" }, end: { dateTime: r.record.proposal.after.end.replace("Z", ""), timeZone: "UTC" } } } };
    }
  } else if (op.name === "recordScheduleAdjustmentResult") {
    if (!["unknown", "observed"].includes(args.outcome)) p.fail("Outcome must be unknown or observed");
    const saved = await load(args, deps);
    if (!saved.calendarAttemptedAt) p.fail("No approved calendar attempt exists");
    let event = null, safe = false, reason = "calendar_outcome_unknown";
    if (args.outcome === "observed") {
      event = p.eventEvidence(args.observation, now(deps), Date.parse(saved.calendarAttemptedAt), true);
      if (p.eventAfterMatches(event, saved.proposal)) {
        // Assess the same approved move against the newly observed busy calendar.
        // The original fetched event content/times stay bound in the proposal;
        // fresh source readback above proves the approved after-state separately.
        const source = { ...args.observation, event: { ...args.observation.event, ...saved.proposal.before, ...saved.proposal.event.concurrency } };
        try {
          p.fresh(args.calendar?.observedAt, now(deps), Date.parse(saved.calendarAttemptedAt));
          const checked = await preview(requestFrom(saved, args.calendar, source), deps);
          safe = checked.proposalHash === saved.proposalHash;
          reason = safe ? "" : "proposal_changed";
        } catch (error) { reason = error.code || "pre_task_check_failed"; }
      } else reason = "calendar_readback_mismatch";
    }
    const r = await commit(op.name, args, input.idempotencyKey, deps, async (current, tx) => {
      if (current.state === "verified") p.fail("Already verified; read the workflow");
      const next = { ...current, calendarEvidence: event ? { ...event, observedAt: args.observation.observedAt } : current.calendarEvidence,
        state: "reconciliation_required", issue: reason || "task_attempt_requires_readback" };
      if (safe && !current.taskAttemptedAt) {
        try {
          await taskUnchanged(current.proposal, deps, tx);
          next.taskAttemptedAt = new Date(now(deps)).toISOString(); next.state = "task_dispatching"; next.issue = "";
        } catch (error) { next.issue = error.code || "task_preflight_changed"; }
      }
      return next;
    });
    // Commit calendar readback and task-attempt evidence BEFORE the task write.
    // A replay or interrupted task attempt never sends another source write.
    if (!r.replayed && r.record.state === "task_dispatching" && !saved.taskAttemptedAt) {
      let issue = "", task = null;
      try {
        await require("./task-management-operation-execution").runIdempotentTaskManagementOperation({ operation: "updateTask", mode: "command",
          arguments: { taskId: r.record.proposal.taskId, expectedVersion: r.record.proposal.taskVersion, changes: r.record.proposal.taskChanges },
          idempotencyKey: `${r.record.adjustmentId}:task` }, deps);
      } catch (error) { issue = error.code || "task_write_unknown"; }
      try { task = (await getTask({ taskId: r.record.proposal.taskId }, deps)).task; } catch { issue ||= "task_readback_unavailable"; }
      const matches = task && p.taskAfterMatches(task, r.record.proposal);
      const final = await commit("recordTaskAttempt", { adjustmentId: r.record.adjustmentId, expectedVersion: r.record.version }, `${r.record.adjustmentId}:task-result`, deps, async current => ({
        ...current, state: matches ? "awaiting_final_readback" : "reconciliation_required", issue: matches ? "" : issue || "task_readback_mismatch",
        taskReadBackAt: new Date(now(deps)).toISOString(), taskEvidence: task ? { taskId: task.taskId, version: task.version, hash: p.hash(task), matches } : null }));
      result = output(final.record);
    } else result = { ...output(r.record), replayed: r.replayed };
  } else if (op.name === "verifyScheduleAdjustment") {
    const saved = await load(args, deps);
    if (!saved.taskAttemptedAt) p.fail("Task update has not been attempted; reconcile the calendar outcome first");
    const event = p.eventEvidence(args.observation, now(deps), Date.parse(saved.taskReadBackAt || saved.taskAttemptedAt), true);
    const task = (await getTask({ taskId: saved.proposal.taskId }, deps)).task;
    p.fresh(args.observation.observedAt, now(deps), Math.max(Date.parse(saved.taskReadBackAt || saved.taskAttemptedAt), Date.parse(task.updatedAt) || 0));
    let unique = true; try { await uniqueLink(task, deps); } catch { unique = false; }
    const observedMatch = unique && p.eventAfterMatches(event, saved.proposal) && p.taskAfterMatches(task, saved.proposal);
    const r = await commit(op.name, args, input.idempotencyKey, deps, async (current, tx) => {
      const latest = (await tx.get(deps.tasksCollection.doc(task.taskId))).data();
      let matches = observedMatch && latest?.version === task.version && latest?.updatedAt === task.updatedAt;
      try { await uniqueLink(task, deps, tx); } catch { matches = false; }
      if (matches) {
        const lockRefs = [current.proposal.taskId, [current.proposal.event.calendarId, current.proposal.event.eventId]].map(identity => db(deps).collection("taskScheduleAdjustmentLocks").doc(p.hash(identity)));
        const locks = await Promise.all(lockRefs.map(r => tx.get(r)));
        locks.forEach((lock, i) => { if (lock.data()?.adjustmentId === current.adjustmentId) tx.delete(lockRefs[i]); });
      }
      return { ...current,
      state: matches ? "verified" : "reconciliation_required", issue: matches ? "" : "final_readback_mismatch",
      calendarEvidence: { ...event, observedAt: args.observation.observedAt }, taskEvidence: { taskId: task.taskId, version: task.version, hash: p.hash(task), matches },
      verifiedAt: matches ? new Date(now(deps)).toISOString() : null }; });
    result = output(r.record);
  }
  return { operation: op.name, mode: op.mode, result };
}
module.exports = { OPERATIONS, NAMES, runScheduleAdjustmentOperation };
