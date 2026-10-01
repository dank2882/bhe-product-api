"use strict";

function fail(message) { throw Object.assign(new Error(message), { code: "appointments_invalid_input", statusCode: 400 }); }
function instant(value) {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail("Use an ISO timestamp with an explicit offset");
  return new Date(value).toISOString();
}
function range(value) {
  const start = instant(value.start), end = instant(value.end);
  if (end <= start) fail("End must follow start");
  return { start, end };
}
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const minutes = r => (Date.parse(r.end) - Date.parse(r.start)) / 60000;
function sequence(blocks) {
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > 8) fail("Supply 1-8 preparation, travel, meeting or recovery blocks");
  const roles = new Set();
  const ordered = blocks.map(b => {
    if (!["preparation", "outbound_travel", "meeting", "return_travel", "recovery", "earlier_preparation"].includes(b.role) || roles.has(b.role)) fail("Invalid or duplicate block role");
    roles.add(b.role); return { role: b.role, ...range(b) };
  }).sort((a, b) => a.start.localeCompare(b.start));
  if (!roles.has("meeting")) fail("A meeting block is required");
  for (let i = 1; i < ordered.length; i++) if (overlaps(ordered[i - 1], ordered[i])) fail("Appointment blocks overlap");
  const byRole = Object.fromEntries(ordered.map(b => [b.role, b]));
  const meeting = byRole.meeting, prep = byRole.preparation, travel = byRole.outbound_travel;
  if (travel && travel.end !== meeting.start) fail("Outbound travel must end at the meeting start");
  if (prep && prep.end !== (travel || meeting).start) fail("Final preparation must directly precede travel or the meeting");
  if (byRole.earlier_preparation && byRole.earlier_preparation.end > (prep || travel || meeting).start) fail("Earlier preparation must precede final preparation or travel");
  if (byRole.return_travel && byRole.return_travel.start < meeting.end) fail("Return travel must follow the meeting");
  if (byRole.recovery && byRole.recovery.start < (byRole.return_travel || meeting).end) fail("Recovery must follow the meeting and return travel");
  return ordered;
}

// Advice only. Source observations are transient, not a second calendar or life log.
function assessSlots(input = {}) {
  if (!Array.isArray(input.candidates) || !input.candidates.length || input.candidates.length > 20) fail("Supply 1-20 candidate sequences");
  if (!Array.isArray(input.busy) || input.busy.length > 500) fail("Supply bounded calendar availability");
  if (!Array.isArray(input.demands || []) || (input.demands || []).length > 200) fail("Use at most 200 known demands");
  const busy = input.busy.map(range);
  const demands = (input.demands || []).map(d => {
    if (!["planned", "completed", "user_reported"].includes(d.basis) || !["light", "moderate", "heavy", "unknown"].includes(d.load)) fail("Label demand evidence and estimated load");
    return { ...range(d), load: d.load, basis: d.basis };
  });
  const zone = input.timezone || "America/Los_Angeles";
  let day; try { day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }); day.format(new Date()); } catch { fail("Invalid timezone"); }
  const rows = input.candidates.map((c, index) => {
    const blocks = sequence(c.blocks), meeting = blocks.find(b => b.role === "meeting");
    const localDay = day.format(new Date(meeting.start));
    const relevant = demands.filter(d => day.format(new Date(d.start)) === localDay);
    const conflicts = blocks.filter(b => busy.some(e => overlaps(b, e))).map(b => b.role);
    const heavy = relevant.filter(d => d.load === "heavy").length;
    const scheduledMinutes = busy.filter(b => day.format(new Date(b.start)) === localDay).reduce((n, b) => n + minutes(b), 0);
    return { candidateIndex: index, blocks, available: conflicts.length === 0, conflicts,
      advice: heavy ? "This day already includes demanding work; consider a lighter day." : "No heavy demands were supplied; this does not establish spare capacity.",
      heavyDemandCount: heavy, knownBusyMinutes: scheduledMinutes,
      capacityKnown: false, score: conflicts.length ? null : heavy * 180 + scheduledMinutes,
      preparationMinutes: blocks.filter(b => b.role === "preparation").reduce((n, b) => n + minutes(b), 0) };
  });
  rows.sort((a, b) => Number(b.available) - Number(a.available) || (a.score ?? Infinity) - (b.score ?? Infinity) || a.candidateIndex - b.candidateIndex);
  return { candidates: rows, advisoryOnly: true, sourceCoverage: input.coverage === "checked" ? "checked" : "limited",
    guidance: "Compare relevant work and Dan's own assessment. Never treat planned work as completed or an empty calendar as available energy. Recheck live availability immediately before booking." };
}
module.exports = { instant, range, sequence, overlaps, assessSlots };
