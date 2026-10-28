"use strict";

const { createHash } = require("node:crypto");
const { stableStringify } = require("./workspace-operation-execution");
const { normalize, localInstant, subtract } = require("./capacity-planning-policy");
const { date } = require("./planning-review-policy");
const hash = value => createHash("sha256").update(stableStringify(value)).digest("hex");
const fail = (message, code = "schedule_adjustment_invalid", statusCode = 409) => { throw Object.assign(new Error(message), { code, statusCode }); };
function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail("Unexpected schedule-adjustment fields", "schedule_adjustment_invalid", 400);
}
function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail("Explicit ISO timestamp required");
  date(value.slice(0, 10));
  if (value.slice(11, 13) > "23" || value.slice(14, 16) > "59") fail("Invalid timestamp");
  return Date.parse(value);
}
const iso = value => new Date(value).toISOString();
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
function fresh(value, now, after = 0, age = 300000) {
  const at = instant(value);
  if (at > now || now - at > age || at < after) fail("Refresh the independent Outlook observation", "schedule_adjustment_stale");
  return at;
}
function eventEvidence(observation, now, after = 0, readback = false) {
  shape(observation, ["observedAt", "event"]);
  fresh(observation.observedAt, now, after);
  const e = observation.event;
  shape(e, ["calendarId", "eventId", "start", "end", "type", "isOrganizer", "attendees", "recurrence", "seriesMasterId", "isAllDay", "cancelled", "showAs", "subject", "body", "location", "etag", "changeKey", "lastModifiedDateTime"]);
  for (const key of ["calendarId", "eventId", "subject", "body", "location"]) if (typeof e[key] !== "string" || e[key].length > (key === "body" ? 64000 : 2000)) fail(`Missing or excessive event ${key}`);
  if (!Array.isArray(e.attendees) || e.attendees.length > 100 || ["type", "isOrganizer", "recurrence", "seriesMasterId", "isAllDay", "cancelled", "showAs"].some(k => e[k] === undefined)) fail("Incomplete event evidence");
  if (!readback && (!e.calendarId || !e.eventId || e.type !== "singleInstance" || e.isOrganizer !== true || e.recurrence !== null || e.seriesMasterId !== null || e.isAllDay !== false || e.cancelled !== false || e.attendees.length || e.showAs !== "busy")) fail("Only an organizer-owned, busy, single-instance focus event without attendees is supported", "schedule_adjustment_event_ineligible");
  const start = instant(e.start), end = instant(e.end);
  if (end <= start) fail("Invalid event interval");
  const concurrency = {};
  for (const key of ["etag", "changeKey", "lastModifiedDateTime"]) {
    if (e[key] != null && (typeof e[key] !== "string" || e[key].length > 2000)) fail("Invalid provider concurrency evidence");
    concurrency[key] = e[key] || null;
  }
  return { calendarId: e.calendarId, eventId: e.eventId, start: iso(start), end: iso(end),
    contentHash: hash({ subject: e.subject, body: e.body, location: e.location, type: e.type, isOrganizer: e.isOrganizer, attendees: e.attendees, recurrence: e.recurrence, seriesMasterId: e.seriesMasterId, isAllDay: e.isAllDay, cancelled: e.cancelled, showAs: e.showAs }), concurrency };
}
function taskBlock(t) {
  return { start: localInstant(t.workOnDate, t.workOnStartTime, t.workOnTimeZone), end: localInstant(t.workOnDate, t.workOnEndTime, t.workOnTimeZone) };
}
function localParts(value, timezone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const MUTABLE_TASK_FIELDS = new Set(["workOnDate", "workOnStartTime", "workOnEndTime", "workOnTimeZone", "scheduledDate", "scheduledTime", "timeWindow", "version", "updatedAt", "updatedBySub", "updatedByName"]);
function preservedTaskHash(task) { return hash(Object.fromEntries(Object.entries(task).filter(([k]) => !MUTABLE_TASK_FIELDS.has(k)))); }
function taskAfterMatches(task, proposal) {
  return task.version === proposal.taskVersion + 1 && preservedTaskHash(task) === proposal.preservedTaskHash &&
    Object.entries(proposal.taskChanges).every(([k, v]) => task[k] === v) && task.scheduledDate === proposal.taskChanges.workOnDate && task.scheduledTime === proposal.taskChanges.workOnStartTime;
}
function eventAfterMatches(event, proposal) {
  const before = proposal.event;
  return event.calendarId === before.calendarId && event.eventId === before.eventId && event.contentHash === before.contentHash && event.start === proposal.after.start && event.end === proposal.after.end;
}

function assessAdjustment(input, task, allTasks, personalPlan, ownerSubjects, now) {
  shape(input, ["taskId", "expectedVersion", "proposedStart", "flexible", "planning", "calendarIds", "observation"]);
  if (input.flexible !== true) fail("Explicitly select this focus block as flexible");
  if (task.taskId !== input.taskId || task.version !== input.expectedVersion) fail("Task version changed", "task_version_conflict");
  if (!ownerSubjects.has(task.ownerSub) || !ownerSubjects.has(task.assignedToSub) || task.assignmentStatus !== "accepted" || task.status !== "scheduled" || task.autoCompleteAfterEvent || task.outlookSyncStatus !== "synced") fail("A scheduled, accepted, Dan-owned focus task is required", "schedule_adjustment_task_ineligible");
  const event = eventEvidence(input.observation, now);
  if (task.outlookCalendarId !== event.calendarId || task.outlookEventId !== event.eventId) fail("Task and independent Outlook IDs do not match");
  const markers = [...new Set(input.observation.event.body.match(/\btask-[a-zA-Z0-9-]+\b/g) || [])];
  if (markers.length !== 1 || markers[0] !== task.taskId) fail("Verify exactly one task marker in the focus event; shared or unverified blocks are excluded", "schedule_adjustment_shared_block");
  const narrativeLinks = [...new Set((`${task.context || ""} ${task.timeWindow || ""} ${task.notes || ""}`).match(/itemid=[^&\s]+/gi) || [])];
  if (narrativeLinks.length > 1 || (task.eventId && task.eventId !== task.outlookEventId)) fail("Additional calendar references require reconciliation first", "schedule_adjustment_multiple_links");
  const before = taskBlock(task);
  if (iso(before.start) !== event.start || iso(before.end) !== event.end) fail("Task schedule and Outlook differ", "schedule_adjustment_link_mismatch");
  shape(input.planning, ["horizon", "timezone", "workWindows", "calendar"]);
  const n = normalize(input.planning, now);
  if (!n.calendarChecked) fail("Complete, fresh Outlook coverage is required", "schedule_adjustment_calendar_incomplete");
  if (!Array.isArray(input.calendarIds) || input.calendarIds.length !== 1 || input.calendarIds[0] !== event.calendarId || n.events.some(e => e.calendarId !== event.calendarId)) fail("This increment requires complete coverage of Dan's selected primary calendar only");
  if (input.planning.timezone !== task.workOnTimeZone) fail("Preserve the task's timezone");
  const start = instant(input.proposedStart), after = { start, end: start + before.end - before.start };
  if (start === before.start || start < now || start % 60000 || after.end % 60000) fail("Select a different future time at minute precision");
  const parts = localParts(start, input.planning.timezone), endParts = localParts(after.end, input.planning.timezone);
  if (parts.day !== endParts.day || localInstant(parts.day, parts.time, input.planning.timezone) !== start || localInstant(parts.day, endParts.time, input.planning.timezone) !== after.end) fail("The move must fit one unambiguous local day");
  if (task.dueDate && parts.day > task.dueDate) fail("Proposed block is after this task's deadline", "schedule_adjustment_deadline_risk");
  if (!n.windows.some(w => w.start <= after.start && w.end >= after.end)) fail("Proposed time is outside the approved eligible work windows", "schedule_adjustment_capacity_conflict");
  const busy = n.events.filter(e => !(e.calendarId === event.calendarId && e.eventId === event.eventId) && !e.cancelled && e.showAs !== "free");
  // All authorized task reservations remain protected, including waiting work.
  for (const other of allTasks) {
    if (other.taskId === task.taskId || ["done", "dropped"].includes(other.status) || !ownerSubjects.has(other.assignedToSub)) continue;
    if (!other.workOnDate || other.workOnDate !== parts.day) continue;
    if (!other.workOnStartTime || !other.workOnEndTime || !other.workOnTimeZone) fail("Another task has unresolved timing on the proposed day", "schedule_adjustment_task_timing_unknown");
    let b; try { b = taskBlock(other); } catch { fail("Another task's timed reservation is invalid", "schedule_adjustment_task_timing_unknown"); }
    busy.push(b);
  }
  if (busy.some(b => overlaps(b, after))) fail("The move would overlap protected work or an Outlook commitment", "schedule_adjustment_capacity_conflict");
  const taskChanges = { workOnDate: parts.day, workOnStartTime: parts.time, workOnEndTime: endParts.time, workOnTimeZone: input.planning.timezone,
    timeWindow: `${parts.day} ${parts.time}–${endParts.time} ${input.planning.timezone}` };
  const assumptions = { horizon: input.planning.horizon, timezone: input.planning.timezone, workWindows: input.planning.workWindows, calendarIds: input.calendarIds, flexible: true };
  const proposal = { schemaVersion: 1, taskId: task.taskId, taskVersion: task.version, taskHash: hash(task), preservedTaskHash: preservedTaskHash(task),
    event, before: { start: iso(before.start), end: iso(before.end) }, after: { start: iso(after.start), end: iso(after.end) }, taskChanges, assumptions };
  const free = subtract(n.windows, busy);
  return { readOnly: true, generatedAt: iso(now), observationAgeSeconds: (now - instant(input.observation.observedAt)) / 1000,
    calendarObservationAgeSeconds: (now - instant(input.planning.calendar.observedAt)) / 1000,
    proposal, proposalHash: hash(proposal), taskTitle: task.title,
    adjustmentFeasibility: "fits_verified_reservation_constraints", displacedTaskIds: [],
    reservedMinutes: (after.end - after.start) / 60000, estimatedMinutes: task.estimatedMinutes || null,
    remainingCapacityMinutes: subtract(free, [after]).reduce((sum, w) => sum + (w.end - w.start) / 60000, 0),
    risks: [...(!task.estimatedMinutes ? ["Selected task effort is unknown; moving its existing reservation does not promise completion."] : task.estimatedMinutes > (after.end - after.start) / 60000 ? ["Selected task effort exceeds this reservation; the unresolved effort is preserved."] : []),
      "Outlook connector evidence is client-attested, not backend-verified. Conditional Outlook updates are unavailable; a concurrency race remains between preflight and write.",
      "Historical schedule wording in task context and event body is preserved; structured times and the task timeWindow are the current schedule."],
    sourceCoverage: personalPlan.sourceCoverage, inventoryFeasibility: personalPlan.alternatives[0].feasibility,
    accounting: personalPlan.alternatives[0].accounting, inventoryRisks: personalPlan.alternatives[0].risks,
    approvalRequired: true, mutationsApplied: false };
}
module.exports = { hash, fail, shape, instant, fresh, eventEvidence, taskAfterMatches, eventAfterMatches, assessAdjustment };
