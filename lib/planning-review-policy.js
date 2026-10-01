"use strict";
function fail(message) { throw Object.assign(new Error(message), { code: "planning_review_invalid_input", statusCode: 400 }); }
function date(value, field = "asOfDate") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`Invalid ${field}`);
  return value;
}
function pacificDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const fields = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
function nextReviewOccurrence(kind, asOfDate, inclusive = false) {
  date(asOfDate);
  if (!["weekly", "monthly"].includes(kind)) fail("reviewKind must be weekly or monthly");
  const d = new Date(`${asOfDate}T12:00:00Z`);
  for (let i = 0; i < 63; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    const candidate = d.toISOString().slice(0, 10), day = d.getUTCDay();
    if (!inclusive && candidate === asOfDate) continue;
    const firstWeekday = day >= 1 && day <= 5 && (d.getUTCDate() === 1 || (day === 1 && d.getUTCDate() <= 3));
    if (kind === "weekly" ? day === 5 : firstWeekday) return candidate;
  }
  fail("Could not determine next review date");
}
function hasNextStep(task) {
  if (task.status === "next") return Boolean(task.assignedToSub || String(task.assignedTo || "").trim());
  if (task.status === "scheduled") return Boolean(task.workOnDate && (task.assignedToSub || String(task.assignedTo || "").trim()));
  return task.status === "waiting" && Boolean(String(task.waitingOn || "").trim()) && Boolean(task.followUpDate || String(task.followUpExceptionReason || "").trim());
}
function projectDates(project) {
  return [{ kind: "review", date: project.nextReviewDate }, { kind: "target", date: project.targetDate },
    ...(project.milestones || []).filter(m => m.status !== "done").map(m => ({ kind: "milestone", date: m.targetDate, label: m.title || m.name || "" }))].filter(d => d.date);
}
function horizon(project, asOfDate) {
  const dates = projectDates(project).sort((a, b) => a.date.localeCompare(b.date));
  if (!dates.length) return { bucket: "no_horizon", dates };
  const days = Math.round((Date.parse(`${dates[0].date}T12:00:00Z`) - Date.parse(`${asOfDate}T12:00:00Z`)) / 86400000);
  return { bucket: days < 0 ? "overdue" : days <= 30 ? "0_30" : days <= 90 ? "31_90" : days <= 365 ? "91_365" : "later", dates };
}
function attention(project, tasks, asOfDate) {
  const reasons = [], setup = [];
  if (project.nextReviewDate && project.nextReviewDate <= asOfDate) reasons.push("review_due");
  if (project.health === "blocked" || (project.dependencies || []).some(d => d.status === "blocked") || (project.milestones || []).some(m => m.status === "blocked")) reasons.push("blocked");
  if (projectDates(project).some(d => d.kind !== "review" && d.date < asOfDate)) reasons.push("date_overdue");
  if (projectDates(project).some(d => d.kind !== "review" && d.date >= asOfDate && Date.parse(d.date) - Date.parse(asOfDate) <= 30 * 86400000)) reasons.push("date_approaching");
  if (tasks.some(t => t.status === "waiting" && t.followUpDate && t.followUpDate <= asOfDate)) reasons.push("follow_up_due");
  if (tasks.some(t => t.status === "scheduled" && t.workOnDate && t.workOnDate < asOfDate)) reasons.push("scheduled_work_missed");
  if (tasks.some(t => t.dueDate && t.dueDate < asOfDate)) reasons.push("task_deadline_overdue");
  if (project.projectKind === "outcome" && project.status === "active" && !tasks.some(hasNextStep)) reasons.push("next_step_missing");
  if (project.status === "paused" && tasks.some(t => t.status === "next")) reasons.push("paused_project_has_active_tasks");
  if (!project.projectKind || project.projectKind === "unclassified") setup.push("classification_needed");
  if (!project.nextReviewDate) setup.push("review_date_needed");
  if (!project.leadSub && !project.leadName) setup.push("lead_needed");
  if (project.projectKind === "outcome" && !project.outcome) setup.push("outcome_needed");
  if (tasks.some(t => t.status === "waiting" && !hasNextStep(t))) setup.push("waiting_details_needed");
  return { reasons, setup };
}
module.exports = { date, pacificDate, nextReviewOccurrence, hasNextStep, projectDates, horizon, attention };
