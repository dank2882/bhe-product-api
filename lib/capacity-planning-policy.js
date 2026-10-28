"use strict";

// Transient arithmetic only. Task Management and Outlook retain their records.
const { date } = require("./planning-review-policy");
const MINUTE = 60000;
function fail(message, code = "capacity_plan_invalid_input", statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}
function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail("Unexpected planning fields");
}
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) fail("Use ISO timestamps with explicit offsets");
  date(value.slice(0, 10));
  const n = Date.parse(value);
  if (!Number.isFinite(n) || value.slice(11, 13) > "23" || value.slice(14, 16) > "59") fail("Invalid timestamp");
  return n;
}
function range(value) {
  const start = instant(value.start), end = instant(value.end);
  if (end <= start) fail("End must follow start");
  return { start, end };
}
const iso = n => new Date(n).toISOString();
const outputRange = r => ({ start: iso(r.start), end: iso(r.end) });
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const contains = (a, b) => a.start <= b.start && a.end >= b.end;
function formatter(timeZone) {
  if (typeof timeZone !== "string" || !timeZone) fail("An IANA timezone is required");
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch { fail("Invalid IANA timezone"); }
}
function local(n, fmt) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(n)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Find actual offsets surrounding this date, then round-trip. Gaps and repeated
// local times are unresolved, never silently shifted or assigned an offset.
function localInstant(day, time, zone) {
  date(day);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail("Invalid local work-on time");
  const fmt = formatter(zone), target = `${day}T${time}`, naive = Date.parse(`${target}:00Z`);
  const offsets = new Set();
  for (let h = -36; h <= 36; h += 6) {
    const n = naive + h * 60 * MINUTE;
    offsets.add(Date.parse(`${local(n, fmt)}:00Z`) - n);
  }
  const candidates = [...offsets].map(o => naive - o).filter(n => local(n, fmt) === target);
  if (candidates.length !== 1) fail("Ambiguous or nonexistent local work-on time");
  return candidates[0];
}
function union(rows) {
  const result = [];
  for (const r of [...rows].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = result.at(-1);
    if (last && last.end >= r.start) last.end = Math.max(last.end, r.end);
    else result.push({ start: r.start, end: r.end });
  }
  return result;
}
function subtract(windows, busy) {
  let free = windows.map(r => ({ ...r }));
  for (const b of union(busy)) free = free.flatMap(w => !overlaps(w, b) ? [w] : [
    ...(w.start < b.start ? [{ start: w.start, end: b.start }] : []),
    ...(b.end < w.end ? [{ start: b.end, end: w.end }] : [])
  ]);
  return free;
}
const totalMinutes = rows => rows.reduce((n, r) => n + (r.end - r.start) / MINUTE, 0);
function text(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 1500) fail(`${field} is required`);
  return value;
}
function normalize(input, now) {
  shape(input, ["horizon", "timezone", "workWindows", "calendar", "proposal", "flexibleTaskIds"]);
  const fmt = formatter(input.timezone), horizon = range(input.horizon || {});
  if (horizon.start < now || horizon.end - horizon.start > 14 * 86400000) fail("Use a future horizon of at most 14 days");
  if (!Array.isArray(input.workWindows) || input.workWindows.length > 56) fail("Supply at most 56 explicit work windows; an empty list means no capacity");
  const windows = input.workWindows.map(range).sort((a, b) => a.start - b.start);
  windows.forEach((w, i) => {
    if (!contains(horizon, w) || (i && overlaps(windows[i - 1], w))) fail("Work windows must be disjoint and inside the horizon");
    if (local(w.start, fmt).slice(0, 10) !== local(w.end - 1, fmt).slice(0, 10)) fail("Split work windows at local midnight");
  });
  const c = input.calendar;
  shape(c, ["status", "observedAt", "start", "end", "events"]);
  if (!["checked", "limited", "unavailable"].includes(c.status)) fail("Label Outlook coverage checked, limited or unavailable");
  if (!Array.isArray(c.events) || c.events.length > 1000) fail("Supply at most 1000 Outlook event occurrences");
  const seen = new Set();
  const events = c.events.map(e => {
    shape(e, ["eventId", "calendarId", "start", "end", "showAs", "cancelled"]);
    const key = JSON.stringify([text(e.calendarId, "calendarId"), text(e.eventId, "eventId")]);
    if (seen.has(key)) fail("Duplicate Outlook occurrence; supply unique occurrence IDs");
    seen.add(key);
    if (e.showAs !== undefined && !["free", "busy", "tentative", "oof", "workingElsewhere", "unknown"].includes(e.showAs)) fail("Invalid Outlook showAs");
    if (e.cancelled !== undefined && typeof e.cancelled !== "boolean") fail("cancelled must be boolean");
    return { ...e, ...range(e), key };
  });
  const observed = c.observedAt ? instant(c.observedAt) : NaN;
  const covered = c.start && c.end ? range(c) : null;
  const calendarChecked = c.status === "checked" && observed <= now && now - observed <= 5 * MINUTE && covered && contains(covered, horizon);
  const flexible = input.flexibleTaskIds || [];
  if (!Array.isArray(flexible) || flexible.length > 10 || new Set(flexible).size !== flexible.length || flexible.some(id => typeof id !== "string")) fail("Select at most 10 distinct flexible task IDs");
  let proposal;
  if (input.proposal) {
    const p = input.proposal;
    if (p.kind === "new_task") {
      shape(p, ["kind", "title", "estimatedMinutes", "priority", "dueDate"]);
      if (!Number.isInteger(p.estimatedMinutes) || p.estimatedMinutes < 1 || p.estimatedMinutes > 10080) fail("Supply an explicit proposed effort in minutes");
      if (!["high", "medium", "low"].includes(p.priority)) fail("Supply the proposed priority");
      proposal = { ...p, title: text(p.title, "title"), taskId: "$proposal", version: 0, status: "next", dueDate: p.dueDate ? date(p.dueDate) : "", disposition: "work", workOnDate: "" };
    } else if (p.kind === "reschedule") {
      shape(p, ["kind", "taskId", "expectedVersion", "start"]);
      if (!Number.isInteger(p.expectedVersion) || p.expectedVersion < 1) fail("Current task version is required");
      proposal = { ...p, taskId: text(p.taskId, "taskId"), start: instant(p.start) };
    } else fail("Proposal must be new_task or reschedule");
  }
  return { horizon, fmt, windows, events, flexible, proposal, calendarChecked: Boolean(calendarChecked) };
}

function buildPlan(input, tasks, now) {
  const n = normalize(input, now), { fmt, horizon, windows, events } = n;
  const rows = tasks.map(t => ({ ...t, issues: [] }));
  const byId = new Map(rows.map(t => [t.taskId, t]));
  for (const t of rows) {
    t.dateFmt = fmt;
    if (t.workOnTimeZone) try { t.dateFmt = formatter(t.workOnTimeZone); } catch { t.issues.push("unresolved_work_on_timezone"); }
    if (t.dueDate) try { date(t.dueDate); } catch { t.issues.push("invalid_deadline"); }
    if (t.workOnDate) {
      try {
        date(t.workOnDate);
        if (t.workOnStartTime && t.workOnEndTime) {
          t.block = { start: localInstant(t.workOnDate, t.workOnStartTime, t.workOnTimeZone), end: localInstant(t.workOnDate, t.workOnEndTime, t.workOnTimeZone) };
          if (t.block.end <= t.block.start) fail("Invalid work-on block");
        } else if (t.workOnStartTime || t.workOnEndTime) t.issues.push("incomplete_work_on_time");
      } catch { t.issues.push("unresolved_work_on_time"); delete t.block; }
    } else if (t.workOnStartTime || t.workOnEndTime) t.issues.push("missing_work_on_date");
    t.minutes = t.block ? (t.block.end - t.block.start) / MINUTE : t.estimatedMinutes;
    if (t.disposition === "work" && !(t.minutes > 0)) t.issues.push("missing_effort");
    if (t.block && t.estimatedMinutes > t.minutes) t.issues.push("planned_block_shorter_than_estimate");
    const matches = events.filter(e => e.eventId === t.outlookEventId && e.calendarId === t.outlookCalendarId && !e.cancelled && e.showAs !== "free");
    t.linked = matches.length === 1 && t.block && matches[0].start === t.block.start && matches[0].end === t.block.end && t.outlookSyncStatus === "synced" ? matches[0] : null;
    if (t.outlookEventId && !t.linked && (!t.block || overlaps(t.block, horizon))) t.issues.push("outlook_link_needs_reconciliation");
    if (t.disposition === "work" && t.block && t.block.end <= horizon.start) t.issues.push("past_block_is_not_completion");
    if (t.disposition === "work" && t.workOnDate && !t.block && t.workOnDate < local(horizon.start, t.dateFmt).slice(0, 10)) t.issues.push("missed_work_on_date");
  }
  // Reservation identity and permission to move it are different. Retain a
  // verified link for deduplication, but never release a shared event for one task.
  const groups = new Map();
  for (const t of rows) if (t.outlookCalendarId && t.outlookEventId) {
    const key = JSON.stringify([t.outlookCalendarId, t.outlookEventId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const group of groups.values()) if (group.length > 1) {
    for (const t of group) {
      t.shared = true;
      // The group reservation is not an individual task-effort estimate.
      t.minutes = t.estimatedMinutes > 0 ? t.estimatedMinutes : 0;
      if (!t.minutes) t.issues.push("shared_block_effort_unknown");
    }
    const verified = group.filter(t => t.linked);
    // Include Dan's timed waiting follow-ups, but not delegated execution effort.
    const knownWork = verified.filter(t => ["work", "waiting"].includes(t.disposition));
    if (verified.length && knownWork.reduce((sum, t) => sum + t.minutes, 0) > (verified[0].linked.end - verified[0].linked.start) / MINUTE) {
      for (const t of knownWork) t.issues.push("shared_block_effort_exceeds_capacity");
    }
  }
  const movable = t => t && !t.shared && t.disposition === "work" && t.issues.length === 0 && (!t.outlookEventId || t.linked) && (!t.block || contains(horizon, t.block));
  for (const id of n.flexible) if (!movable(byId.get(id)) || !byId.get(id).block) fail("A flexible task needs a current timed block inside the horizon without reconciliation issues", "capacity_plan_task_not_movable", 409);
  let target;
  if (n.proposal?.kind === "new_task") {
    if (byId.has("$proposal")) fail("Reserved proposal ID conflicts with a task", "capacity_plan_identity_conflict", 409);
    target = { ...n.proposal, minutes: n.proposal.estimatedMinutes, issues: [], dateFmt: fmt }; rows.push(target);
  }
  if (n.proposal?.kind === "reschedule") {
    target = byId.get(n.proposal.taskId);
    if (!movable(target)) fail("Selected task is unavailable or needs reconciliation", "capacity_plan_task_not_movable", 409);
    if (target.version !== n.proposal.expectedVersion) fail("Task changed; reread before planning", "task_version_conflict", 409);
    target.requestedBlock = { start: n.proposal.start, end: n.proposal.start + target.minutes * MINUTE };
    if (!contains(horizon, target.requestedBlock)) fail("Requested work must be inside the horizon");
  }
  const horizonDay = local(horizon.end - 1, fmt).slice(0, 10);
  const priority = { high: 0, medium: 1, low: 2 };
  const order = (a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1) || a.taskId.localeCompare(b.taskId);
  function scenario(releasedId) {
    const released = new Set([...(target?.requestedBlock ? [target.taskId] : []), ...(releasedId ? [releasedId] : [])]);
    const releasedEvents = new Set(rows.filter(t => released.has(t.taskId) && t.linked).map(t => t.linked.key));
    const busy = events.filter(e => !e.cancelled && e.showAs !== "free" && !releasedEvents.has(e.key)).map(e => ({ ...e, ref: { calendarId: e.calendarId, eventId: e.eventId } }));
    const allocations = new Map(), conflicts = [], risks = [];
    let conflictCount = 0;
    const addConflict = conflict => { conflictCount++; if (conflicts.length < 50) conflicts.push(conflict); };
    for (let i = 0; i < busy.length; i++) for (let j = i + 1; j < busy.length; j++) {
      if (overlaps(busy[i], horizon) && overlaps(busy[j], horizon) && overlaps(busy[i], busy[j])) addConflict({ event: busy[i].ref, with: busy[j].ref });
    }
    for (const t of rows) if (t.block && t.disposition !== "delegated" && !released.has(t.taskId)) {
      allocations.set(t.taskId, t.block);
      if (overlaps(t.block, horizon)) {
        // Verified task reservations are already represented by their events.
        // Event/event overlaps were checked above; unlinked tasks still compare
        // against every reservation, including verified shared events.
        if (!t.linked) for (const b of busy) if (overlaps(t.block, b)) addConflict({ taskId: t.taskId, with: b.ref });
        if (!windows.some(w => contains(w, t.block))) risks.push({ taskId: t.taskId, reason: "existing_block_outside_work_windows" });
      }
      // Matching Outlook and task blocks are one reservation, not two.
      if (!t.linked) busy.push({ ...t.block, ref: { taskId: t.taskId } });
    }
    let free = subtract(windows, busy);
    const availableBeforePlanningMinutes = totalMinutes(free);
    function place(t) {
      if (t.issues.length) return;
      let slot = t.requestedBlock;
      if (slot) {
        if (!free.some(w => contains(w, slot))) {
          for (const b of busy.filter(b => overlaps(b, slot))) addConflict({ taskId: t.taskId, with: b.ref });
          return;
        }
      } else {
        for (const w of free) {
          const candidate = { start: w.start, end: w.start + t.minutes * MINUTE };
          const day = local(candidate.start, t.dateFmt).slice(0, 10);
          if (candidate.end > w.end || (t.dueDate && local(candidate.end - 1, fmt).slice(0, 10) > t.dueDate)) continue;
          // A saved date is a constraint unless explicitly selected for movement.
          if (t.workOnDate && !released.has(t.taskId) && day !== t.workOnDate) continue;
          slot = candidate; break;
        }
      }
      if (!slot) return;
      allocations.set(t.taskId, slot); free = subtract(free, [slot]);
      busy.push({ ...slot, ref: { taskId: t.taskId } });
    }
    if (target?.requestedBlock) place(target);
    // In the single-move alternative, place a new proposal first, then recover
    // the displaced task before other unplanned work. Never hide an overflow.
    if (releasedId && target && !target.requestedBlock) place(target);
    const displaced = byId.get(releasedId);
    if (displaced && displaced !== target) place(displaced);
    for (const t of rows.filter(t => t.disposition === "work" && !allocations.has(t.taskId) && t !== displaced && !(releasedId && t === target) && !t.requestedBlock).sort(order)) {
      if (t.workOnDate && t.workOnDate > local(horizon.end - 1, t.dateFmt).slice(0, 10)) continue;
      place(t);
    }
    const accounting = rows.map(t => {
      const block = allocations.get(t.taskId);
      const issues = [...t.issues];
      let state = t.disposition;
      if (state === "work") {
        state = t.shared && !t.minutes ? "needs_information" : block ? "planned" : t.workOnDate > local(horizon.end - 1, t.dateFmt).slice(0, 10) ? "beyond_horizon" : issues.length ? "needs_information" : "unplaced";
        if (state === "unplaced") issues.push("no_contiguous_slot_within_constraints");
        if (t.dueDate && t.dueDate <= horizonDay && (!block || local(block.end - 1, fmt).slice(0, 10) > t.dueDate)) issues.push("deadline_at_risk");
      } else if (t.dueDate && t.dueDate <= horizonDay) issues.push("deadline_requires_owner_follow_up");
      if (block && t.dueDate && local(block.end - 1, fmt).slice(0, 10) > t.dueDate) issues.push("deadline_at_risk");
      for (const reason of issues) risks.push({ taskId: t.taskId, reason });
      return { taskId: t.taskId, version: t.version, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate || "", workOnDate: t.workOnDate || "", estimatedMinutes: t.estimatedMinutes || 0, plannedMinutes: t.minutes || 0, state, issues, ...(t.shared ? { sharedBlockMinutes: t.block ? (t.block.end - t.block.start) / MINUTE : 0 } : {}), ...(block ? { block: outputRange(block) } : {}) };
    });
    const changes = rows.flatMap(t => {
      const block = allocations.get(t.taskId);
      if (!block || (t.block && block.start === t.block.start && block.end === t.block.end)) return [];
      return [{ taskId: t.taskId, expectedVersion: t.version, action: t.taskId === "$proposal" ? "create_task_and_plan" : "plan_work", before: t.block ? outputRange(t.block) : null, after: outputRange(block), outlookCalendarId: t.outlookCalendarId || "", outlookEventId: t.outlookEventId || "", outlookSyncStatus: t.outlookSyncStatus || "none", requiresDanApproval: true }];
    });
    const movedExistingBlocks = changes.filter(c => c.before).length;
    const unresolved = accounting.filter(t => ["unplaced", "needs_information", "identity_unresolved", "pending_assignment"].includes(t.state)).length;
    const constraintFailure = conflictCount || risks.some(r => ["deadline_at_risk", "existing_block_outside_work_windows", "planned_block_shorter_than_estimate", "shared_block_effort_exceeds_capacity"].includes(r.reason)) || accounting.some(t => t.state === "unplaced");
    return { strategy: releasedId ? "move_one_selected_flexible_task" : "preserve_existing_blocks", releasedTaskId: releasedId || null,
      feasibility: constraintFailure ? "not_feasible" : !n.calendarChecked || unresolved || risks.length ? "undetermined" : "fits_supplied_constraints",
      explanation: releasedId ? "Consider moving only this explicitly selected task; all displaced work remains accounted for." : "Retain existing timed work; place other work by deadline, then priority, then stable ID.",
      movedExistingBlocks, availableBeforePlanningMinutes, remainingCapacityMinutes: totalMinutes(free), remainingWindows: free.map(outputRange), conflictCount, conflictsTruncated: conflictCount > conflicts.length, conflicts, risks, accounting, changes };
  }
  const baseline = scenario(null);
  const candidates = n.flexible.filter(id => id !== target?.taskId && byId.get(id).block).map(scenario);
  const score = s => [s.feasibility === "not_feasible" ? 1 : 0,
    target && !s.accounting.find(t => t.taskId === target.taskId)?.block ? 1 : 0,
    s.accounting.filter(t => ["unplaced", "needs_information"].includes(t.state)).length,
    s.conflictCount + s.risks.length, s.movedExistingBlocks];
  const compare = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  candidates.sort((a, b) => compare(a, b) || a.releasedTaskId.localeCompare(b.releasedTaskId));
  const alternate = candidates.find(s => compare(s, baseline) < 0 && JSON.stringify(s.changes) !== JSON.stringify(baseline.changes));
  return { readOnly: true, approvalRequired: true, applySupported: false, timezone: input.timezone, horizon: outputRange(horizon),
    sourceCoverage: { tasks: "complete_authorized_personal_inventory", calendar: n.calendarChecked ? "fresh_client_observation" : "unavailable_incomplete_or_stale", calendarBackendVerified: false },
    calendarClassification: events.map(e => ({ eventId: e.eventId, calendarId: e.calendarId, ...outputRange(e), classification: e.cancelled || e.showAs === "free" ? "nonblocking" : rows.some(t => (n.flexible.includes(t.taskId) || t.requestedBlock) && t.linked?.key === e.key) ? "explicitly_flexible_linked_work" : "protected" })),
    alternatives: [baseline, ...(alternate ? [alternate] : [])],
    guidance: "Review every accounting row and risk. Shared Outlook blocks are one protected reservation, not proof that every linked task fits or is complete. Shared-task plannedMinutes uses only its own explicit effort estimate (zero means unknown); sharedBlockMinutes is the common reservation duration, not additional capacity. These are bounded greedy alternatives, not proof that no other schedule exists. Estimates are supplied, never predicted. Outlook evidence is client-attested; expand recurrence and finish pagination across all relevant calendars. No change is approved or saved. Obtain Dan's exact approval, reread tasks and Outlook, and use existing versioned task/calendar workflows with readback. This query cannot apply a plan." };
}

module.exports = { buildPlan, localInstant, subtract, normalize, fail };
