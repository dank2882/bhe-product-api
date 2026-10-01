"use strict";
const { createHash } = require("node:crypto");
const { requireDanPrivateAccess, normalizeOwnerSubjects } = require("./dan-private-access");
const { assertCanReadTaskRecord, assertCanUpdateTaskRecord, getTaskActorFields } = require("./task-management-access");
const { withProjectContext, branchIds } = require("./project-hierarchy");
const { stableStringify } = require("./workspace-operation-execution");
const policy = require("./planning-review-policy");
const hash = value => createHash("sha256").update(stableStringify(value)).digest("hex");
function fail(message, code = "planning_review_invalid_input", statusCode = 400) { throw Object.assign(new Error(message), { code, statusCode }); }
function id(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[/\\\x00-\x1f]/.test(value)) fail("Invalid record ID");
  return value;
}
function pageSize(value, fallback = 25) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < 1 || n > 100) fail("limit must be 1-100");
  return n;
}
function scope(deps) {
  const access = requireDanPrivateAccess(deps);
  // Historical task owners are configured separately from travel ownership.
  // Use the existing backend-owned mapping after the private-access check;
  // names and administrator readability are not ownership evidence.
  const subjects = new Set([...access.subjects, ...normalizeOwnerSubjects(deps.danOwnerSubjects),
    ...normalizeOwnerSubjects((deps.privateDelegationEnv || process.env).DAN_PRIVATE_OWNER_SUBJECTS)]);
  return record => [record.ownerSub, record.createdBySub, record.leadSub, record.assignedToSub, record.assignedBySub].some(s => subjects.has(s));
}
function paginate(rows, input, binding, defaultSize = 25) {
  const limit = pageSize(input.limit, defaultSize); let offset = 0;
  const fingerprint = hash(binding);
  if (input.cursor) try {
    const c = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
    if (c.binding !== fingerprint || !Number.isInteger(c.offset) || c.offset < 0) throw new Error();
    offset = c.offset;
  } catch { fail("Review changed or cursor is invalid; restart review", "planning_review_cursor_changed", 409); }
  const items = rows.slice(offset, offset + limit), more = offset + limit < rows.length;
  return { items, totalCount: rows.length, complete: !more, nextCursor: more ? Buffer.from(JSON.stringify({ binding: fingerprint, offset: offset + limit })).toString("base64url") : "" };
}

async function buildPlanningReview(input, deps) {
  const relevant = scope(deps), asOfDate = policy.date(input.asOfDate);
  const period = input.period || "weekly";
  if (!["weekly", "monthly"].includes(period)) fail("period must be weekly or monthly");
  const section = input.section || "overview";
  if (!["overview", "outcomes", "areas", "attention", "setup", "waiting"].includes(section)) fail("Invalid review section");
  deps = await withProjectContext(deps);
  const service = require("./project-task-service");
  const [p, t, r] = await Promise.all([service.listProjects({}, deps, true), service.listTasks({}, deps, true), service.listRoutines({ status: "active" }, deps, true)]);
  const openTasks = t.tasks.filter(task => !["done", "dropped"].includes(task.status) && (task.visibility !== "private" || relevant(task)));
  const personalProjectIds = new Set(openTasks.filter(relevant).map(task => task.projectId).filter(Boolean));
  const candidates = p.projects.filter(project => ["active", "paused"].includes(project.status) && (project.visibility !== "private" || relevant(project)));
  const allVisible = new Map(candidates.map(project => [project.projectId, project]));
  // Relevant roots include authorized branches containing the owner's assigned
  // work. Readability alone (for an administrator) is not personal relevance.
  for (const projectId of [...personalProjectIds]) {
    let current = allVisible.get(projectId), seen = new Set();
    while (current && !seen.has(current.projectId)) { seen.add(current.projectId); personalProjectIds.add(current.projectId); current = allVisible.get(current.parentProjectId); }
  }
  const selected = new Set(candidates.filter(project => relevant(project) || personalProjectIds.has(project.projectId)).map(project => project.projectId));
  for (const projectId of [...selected]) for (const childId of branchIds(projectId, deps.projectGraph)) if (allVisible.has(childId)) selected.add(childId);
  const projects = candidates.filter(project => selected.has(project.projectId));
  const rows = projects.map(project => {
    const ids = branchIds(project.projectId, deps.projectGraph);
    const work = openTasks.filter(task => ids.has(task.projectId));
    const check = policy.attention(project, work, asOfDate), kind = project.projectKind || "unclassified";
    const topLevel = !selected.has(project.parentProjectId);
    return { projectId: project.projectId, parentProjectId: selected.has(project.parentProjectId) ? project.parentProjectId : "",
      name: project.name, projectKind: kind, lifeArea: project.lifeArea, status: project.status, version: project.version,
      leadName: project.leadName, outcome: project.outcome, nextReviewDate: project.nextReviewDate,
      lastReviewedAt: project.lastReviewedAt, targetDate: project.targetDate, updatedAt: project.updatedAt,
      topLevel, ...check, ...(kind === "outcome" ? policy.horizon(project, asOfDate) : {}),
      areaState: kind !== "area" ? "" : check.reasons.length ? "needs_attention" :
        check.setup.length ? "ownership_or_setup_gaps" : project.health === "on_track" && project.lastReviewedAt && project.nextReviewDate > asOfDate ? "stable" : "unassessed",
      directOpenTaskCount: work.filter(task => task.projectId === project.projectId).length,
      branchOpenTaskCount: work.length, nextActionCount: work.filter(task => task.status === "next").length,
      waitingCount: work.filter(task => task.status === "waiting").length,
      validNextStepCount: work.filter(policy.hasNextStep).length };
  });
  rows.sort((a, b) => Number(b.topLevel) - Number(a.topLevel) || (a.nextReviewDate || "9999").localeCompare(b.nextReviewDate || "9999") || a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId));
  const attention = rows.filter(row => row.reasons.length);
  const setup = rows.filter(row => row.setup.length).sort((a, b) =>
    Number(b.topLevel && b.projectKind === "unclassified") - Number(a.topLevel && a.projectKind === "unclassified") ||
    Number(b.branchOpenTaskCount > 0) - Number(a.branchOpenTaskCount > 0) ||
    (a.nextReviewDate || a.targetDate || "9999").localeCompare(b.nextReviewDate || b.targetDate || "9999") ||
    b.updatedAt.localeCompare(a.updatedAt) || a.projectId.localeCompare(b.projectId));
  const waiting = openTasks.filter(task => task.status === "waiting" && (relevant(task) || selected.has(task.projectId)))
    .map(task => ({ taskId: task.taskId, title: task.title, projectId: task.projectId, waitingOn: task.waitingOn,
      followUpDate: task.followUpDate, followUpExceptionReason: task.followUpExceptionReason, validNextStep: policy.hasNextStep(task) }));
  const overview = rows.filter(row => row.topLevel && (period === "monthly" || row.status === "active" || row.reasons.includes("review_due")));
  const outcomes = rows.filter(row => row.projectKind === "outcome" && (period === "monthly" || row.status === "active" || row.reasons.includes("review_due")));
  const areas = rows.filter(row => row.projectKind === "area");
  const choices = { overview, outcomes, areas, attention, setup, waiting }, chosen = choices[section];
  const binding = { period, asOfDate, section, owner: normalizeOwnerSubjects(deps.danOwnerSubjects)[0],
    rows: rows.map(row => [row.projectId, row.version]), tasks: openTasks.map(task => [task.taskId, task.version]) };
  const page = paginate(chosen, input, binding, section === "setup" ? 5 : 25);
  const routineReviews = r.routines.filter(routine => routine.reviewKind && relevant(routine)).map(routine => ({ routineId: routine.routineId, title: routine.title, reviewKind: routine.reviewKind,
    nextReviewDate: routine.nextReviewDate, lastReviewedAt: routine.lastReviewedAt, version: routine.version,
    due: Boolean(routine.nextReviewDate && routine.nextReviewDate <= asOfDate) }));
  return { asOfDate, period, section, ...page, summary: { openProjectCount: rows.length, topLevelCount: rows.filter(row => row.topLevel).length,
    attentionCount: attention.length, setupCount: setup.length, waitingCount: waiting.length,
    outcomeCount: outcomes.length, areaCount: areas.length,
    horizonCounts: Object.fromEntries(["overdue", "0_30", "31_90", "91_365", "later", "no_horizon"].map(bucket => [bucket, outcomes.filter(row => row.bucket === bucket).length])) },
    planningSetup: { totalCount: setup.length, items: setup.slice(0, 5), moreAvailable: setup.length > 5, continuation: { section: "setup", limit: 5 } },
    routineReviews, coverage: { complete: true, scope: "authorized owner-relevant projects and accessible descendants, excluding handed-off FBC Maintenance; tasks counted once per branch", presentationComplete: page.complete },
    retrievalRequests: [{ source: "Outlook Calendar", windowDays: period === "weekly" ? 14 : 365 },
      { source: "Intake", operation: "listIntakes", arguments: { status: "open", limit: 5 }, guidance: "Show unresolved captures with a total count and at most five items; do not complete or dismiss them during review." },
      { source: "Think Tank", operation: "buildThinkTankReview", arguments: { asOfDate, includeParked: period === "monthly" } },
      { source: "Other owning domains", guidance: "Retrieve only relevant authoritative context and label unavailable or incomplete sources. Never copy confidential histories." }],
    guidance: "Show root summaries first. Read section outcomes for all outcome horizons, including children under areas, and section areas separately. Read section attention for independently due child reviews; never assume parent review covers them. No record has been changed." };
}

function target(input, deps) {
  if (!["project", "routine"].includes(input.recordType)) fail("recordType must be project or routine");
  return (input.recordType === "project" ? deps.projectsCollection : deps.routinesCollection).doc(id(input.recordId));
}
async function recordPlanningReview(input, deps) {
  requireDanPrivateAccess(deps);
  const asOfDate = policy.date(input.asOfDate), ref = target(input, deps);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) fail("expectedVersion is required");
  if (input.recordType === "project" && policy.date(input.nextReviewDate, "nextReviewDate") <= asOfDate) fail("Next project review must be after this review date");
  const actor = getTaskActorFields(deps), at = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  const today = policy.pacificDate(at);
  if (asOfDate > today) fail("A future review cannot be recorded as completed");
  const completionRef = ref.collection("planningReviews").doc(String(input.expectedVersion).padStart(10, "0"));
  const fingerprint = hash({ input, actor: actor.actorSub });
  const result = await ref.firestore.runTransaction(async tx => {
    const [snapshot, prior, graph] = await Promise.all([tx.get(ref), tx.get(completionRef), tx.get(deps.projectsCollection.orderBy("__name__").limit(10001))]);
    if (graph.docs.length > 10000) fail("Project context exceeds complete-read budget", "planning_review_read_limit", 422);
    if (!snapshot.exists) fail("Review record not found", "planning_review_not_found", 404);
    const record = snapshot.data(), scoped = { ...deps, projectGraph: new Map(graph.docs.map(d => [d.id, { ...d.data(), projectId: d.id }])) };
    assertCanUpdateTaskRecord(record, {}, scoped, input.recordType);
    if (prior.exists) {
      if (prior.data().fingerprint !== fingerprint) fail("Record already reviewed by another intent", "planning_review_version_conflict", 409);
      return { completion: prior.data(), replayed: true };
    }
    if ((record.version || 1) !== input.expectedVersion) fail("Record changed; read it again before reviewing", "planning_review_version_conflict", 409);
    if (record.status !== "active" && !(input.recordType === "project" && record.status === "paused")) fail("Only active routines and active/paused projects can be reviewed");
    const nextReviewDate = input.recordType === "project" ? input.nextReviewDate : policy.nextReviewOccurrence(record.reviewKind, today);
    const completion = { recordType: input.recordType, recordId: input.recordId, asOfDate,
      previousReviewDate: record.nextReviewDate || "", nextReviewDate, reviewedAt: at, reviewedBySub: actor.actorSub,
      reviewedByName: actor.actorName, previousVersion: input.expectedVersion, version: input.expectedVersion + 1, fingerprint };
    tx.create(completionRef, completion);
    tx.update(ref, { version: completion.version, lastReviewedAt: at, nextReviewDate, updatedAt: at,
      updatedBySub: actor.actorSub, updatedByName: actor.actorName });
    return { completion, replayed: false };
  });
  const current = await ref.get();
  deps = await withProjectContext(deps); assertCanReadTaskRecord(current.data(), deps);
  return { ...result, current: { recordId: input.recordId, version: current.data().version,
    lastReviewedAt: current.data().lastReviewedAt, nextReviewDate: current.data().nextReviewDate }, readBackVerified: true };
}
async function listPlanningReviewHistory(input, deps) {
  requireDanPrivateAccess(deps); deps = await withProjectContext(deps);
  const ref = target(input, deps), snapshot = await ref.get();
  if (!snapshot.exists) fail("Review record not found", "planning_review_not_found", 404);
  assertCanReadTaskRecord(snapshot.data(), deps);
  const limit = pageSize(input.limit), after = input.afterVersion ?? 0;
  if (!Number.isInteger(after) || after < 0) fail("Invalid afterVersion");
  const page = await ref.collection("planningReviews").orderBy("__name__").startAfter(String(after).padStart(10, "0")).limit(limit + 1).get();
  const completions = page.docs.slice(0, limit).map(d => { const { fingerprint, ...data } = d.data(); return data; });
  return { completions, complete: page.docs.length <= limit, nextAfterVersion: page.docs.length > limit ? completions.at(-1).previousVersion : null };
}
module.exports = { buildPlanningReview, recordPlanningReview, listPlanningReviewHistory };
