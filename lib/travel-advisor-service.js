"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { createTravelWorkspaceDependencies, getTravelWorkspace, getTravelOwnership } = require("./travel-workspace-access");
const { DAN_TRAVEL_OPERATIONS, runDanTravelOperation } = require("./dan-travel-operation-registry");
const { getRequiredRecord, loadCollection, assertExpectedVersion, normalizeString, normalizeLocationKeys } = require("./dan-relationships-service");
const { getTrip, buildDestinationRefresher, locationMatches } = require("./dan-travel-companion-service");
const { createTask, getTask } = require("./project-task-service");
const { createIdempotentOperationRunner } = require("./workspace-operation-execution");

const REUSED = new Set([
  "createPerson", "updatePerson", "getPerson", "searchPeople", "findPossiblePersonDuplicates",
  "createOrganization", "getOrganization", "searchOrganizations", "linkPersonToOrganization",
  "addContactMethod", "updateContactMethod", "recordInteraction",
  "createTrip", "updateTrip", "getTrip", "listTrips", "addItineraryItem",
  "prepareItineraryCalendarExport", "recordItineraryCalendarExport",
  "createPackingList", "updatePackingItem", "buildDestinationRefresher"
]);
const EXTRA = [
  { name: "recordTripSummary", mode: "command", required: ["tripId", "exactText"], optional: ["summary", "happenedAt", "locationKeys", "personIds", "organizationIds", "commitments"], summary: "Preserve a trip report verbatim with linked people/churches and commitments. Does not create tasks automatically.", argumentGuidance: "commitments: [{title, dueDate?: YYYY-MM-DD, certainty: committed|tentative}]. Preserve uncertainty; never infer a deadline. Original exactText is stored unchanged." },
  { name: "getTripSummary", mode: "query", required: ["summaryId"], optional: [], summary: "Retrieve an exact private trip report and current linked task status." },
  { name: "listTripSummaries", mode: "query", required: [], optional: ["tripId", "query", "limit"], summary: "Find private trip summaries, including original wording and commitments." },
  { name: "getTripContext", mode: "query", required: ["tripId"], optional: [], summary: "Retrieve a trip, linked meetings and reports, and current commitment task status." },
  { name: "createFollowUpTask", mode: "command", required: ["summaryId", "commitmentId", "expectedVersion"], optional: [], summary: "Create one duplicate-safe private Task Management action from a firm commitment; link it back to the report.", argumentGuidance: "Task Management administrators can access private action tasks. Full trip narrative is never copied. Read the summary first. If task creation succeeded but linking is pending, retrieve its latest version and retry with a new key." },
  { name: "buildReturnBriefing", mode: "command", required: ["tripId"], optional: ["destinationId"], summary: "Build an on-demand destination refresher with relevant past trip reports and current follow-up task status." }
];
const operations = [...DAN_TRAVEL_OPERATIONS.filter(op => REUSED.has(op.name)), ...EXTRA];
const byName = new Map(operations.map(op => [op.name, op]));
const hash = value => createHash("sha256").update(value).digest("hex");
const now = deps => new Date(typeof deps.now === "function" ? deps.now() : Date.now()).toISOString();
function fail(message, statusCode = 400, code = "travel_advisor_invalid") { throw Object.assign(new Error(message), { statusCode, code }); }
function validId(id) { if (typeof id !== "string" || !id || id.length > 300 || /[/\\]/.test(id) || id === "." || id === "..") fail("Invalid record ID"); return id; }
function validateIds(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["owner", "ownerId", "ownerSub", "workspaceId", "subject", "subjects"].includes(key)) fail("Workspace ownership is selected by your authenticated identity");
    if (/Id$/.test(key) && item) validId(item);
    else if (/Ids$/.test(key) && Array.isArray(item)) item.forEach(validId);
    else if (typeof item === "object") validateIds(item);
  }
}
function requireTasks(deps, write = false) {
  const scopes = getTravelWorkspace(deps).scopes;
  if (!scopes.includes("tasks.read") || (write && !scopes.includes("tasks.write"))) fail("Task Management permission is required", 403, "travel_task_access_denied");
}
async function validateLinks(args, deps) {
  if (args.tripId) await getRequiredRecord(deps.travelTripsCollection, args.tripId, "trip");
  for (const id of args.personIds || []) await getRequiredRecord(deps.relationshipPeopleCollection, id, "person");
  for (const id of args.organizationIds || []) await getRequiredRecord(deps.relationshipOrganizationsCollection, id, "organization");
}

async function recordTripSummary(args, deps) {
  if (typeof args.exactText !== "string" || !args.exactText.trim() || args.exactText.length > 100000) fail("Provide original report text, up to 100,000 characters");
  for (const field of ["personIds", "organizationIds", "commitments"]) {
    if (args[field] !== undefined && (!Array.isArray(args[field]) || args[field].length > 50)) fail(`${field} must be an array of at most 50 entries`);
  }
  await validateLinks(args, deps);
  if (args.happenedAt && Number.isNaN(Date.parse(args.happenedAt))) fail("happenedAt must be an ISO date/time");
  const commitments = (args.commitments || []).map(item => {
    if (!item || !normalizeString(item.title) || item.title.length > 1000) fail("Each commitment needs a title up to 1,000 characters");
    if (!["committed", "tentative"].includes(item.certainty)) fail("State whether each commitment is committed or tentative");
    const dueDate = normalizeString(item.dueDate);
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate)) fail("Commitment dueDate must be a real YYYY-MM-DD date");
    return { commitmentId: `commitment-${randomUUID()}`, title: item.title.trim(), certainty: item.certainty, dueDate, taskId: "" };
  });
  const memoryId = `summary-${randomUUID()}`;
  const timestamp = now(deps);
  const record = {
    ...getTravelOwnership(deps), memoryId, summaryId: memoryId, tripId: args.tripId,
    kind: "trip_summary", stream: "story", privacy: "private", exactText: args.exactText,
    summary: normalizeString(args.summary), happenedAt: args.happenedAt || "",
    locationKeys: normalizeLocationKeys(args.locationKeys), personIds: args.personIds || [],
    organizationIds: args.organizationIds || [], commitments,
    version: 1, createdAt: timestamp, updatedAt: timestamp,
    createdBySub: getTravelWorkspace(deps).subject
  };
  await deps.tripMemoriesCollection.doc(memoryId).create(record);
  return { summary: record };
}

async function readSummary(summaryId, deps) {
  const report = await getRequiredRecord(deps.tripMemoriesCollection, validId(summaryId), "summary");
  if (report.kind !== "trip_summary") fail("Trip summary not found", 404, "summary_not_found");
  return report;
}
async function enrichSummary(report, deps) {
  const commitments = await Promise.all(report.commitments.map(async item => {
    if (!item.taskId) return item;
    if (!getTravelWorkspace(deps).scopes.includes("tasks.read")) return { ...item, taskCoverage: "permission_unavailable" };
    try {
      const { task } = await getTask({ taskId: item.taskId }, deps);
      if (!deps.taskAccess.subjects.includes(task.ownerSub)) return { ...item, taskCoverage: "unavailable" };
      return { ...item, task: { taskId: task.taskId, title: task.title, status: task.status, dueDate: task.dueDate, version: task.version }, taskCoverage: "checked" };
    } catch (error) {
      if (![403, 404].includes(error.statusCode)) throw error;
      return { ...item, taskCoverage: "unavailable" };
    }
  }));
  return { ...report, commitments };
}
async function listTripSummaries(args, deps) {
  if (args.tripId) await getRequiredRecord(deps.travelTripsCollection, args.tripId, "trip");
  const query = normalizeString(args.query).toLowerCase();
  const matches = (await loadCollection(deps.tripMemoriesCollection)).filter(item => item.kind === "trip_summary"
    && (!args.tripId || item.tripId === args.tripId)
    && (!query || `${item.exactText} ${item.summary}`.toLowerCase().includes(query)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 25, 1), 100);
  return { count: Math.min(matches.length, limit), total: matches.length, hasMore: matches.length > limit,
    summaries: await Promise.all(matches.slice(0, limit).map(item => enrichSummary(item, deps))) };
}

async function createFollowUpTask(args, deps) {
  requireTasks(deps, true);
  const report = await readSummary(args.summaryId, deps);
  assertExpectedVersion(report, args.expectedVersion, "summary");
  const commitment = report.commitments.find(item => item.commitmentId === args.commitmentId);
  if (!commitment) fail("Commitment not found", 404);
  if (commitment.certainty !== "committed") fail("A tentative idea cannot become a commitment task");
  const workspace = getTravelWorkspace(deps);
  const taskId = `task-travel-${hash(`${workspace.workspaceId}:${report.summaryId}:${commitment.commitmentId}`).slice(0, 40)}`;
  let task;
  const existing = await deps.tasksCollection.doc(taskId).get();
  if (!existing.exists) {
    try {
      await createTask({ taskId, title: commitment.title, dueDate: commitment.dueDate,
        visibility: "private", status: "next", lifeArea: "work", requestedBy: workspace.name,
        sourceType: "travel_advisor", sourceThreadId: report.summaryId,
        context: "Travel follow-up", notes: "" }, deps);
    } catch (error) {
      // A concurrent call may have created the same deterministic task.
      if (!(error.code === 6 || error.code === "task_already_exists")) throw error;
    }
  }
  task = (await getTask({ taskId }, deps)).task;
  if (!workspace.subjects.includes(task.ownerSub) || task.sourceType !== "travel_advisor" || task.sourceThreadId !== report.summaryId) fail("Follow-up task ownership conflicts with its source", 409, "travel_task_conflict");
  try {
    const linked = await deps.firestoreDb.runTransaction(async tx => {
      const ref = deps.tripMemoriesCollection.doc(report.summaryId);
      const current = (await tx.get(ref)).data();
      const match = current.commitments.find(item => item.commitmentId === commitment.commitmentId);
      if (match.taskId === taskId) return current;
      assertExpectedVersion(current, args.expectedVersion, "summary");
      const next = { ...current, version: current.version + 1, updatedAt: now(deps),
        commitments: current.commitments.map(item => item.commitmentId === commitment.commitmentId ? { ...item, taskId } : item) };
      tx.set(ref, next);
      return next;
    });
    return { task, summaryId: report.summaryId, version: linked.version, linkStatus: "linked" };
  } catch (error) {
    return { task, summaryId: report.summaryId, linkStatus: "pending", warning: "Task exists. Read the latest summary and retry linking with a new idempotency key; no duplicate task will be created.", linkError: error.code || "link_failed" };
  }
}

async function runExtra(operation, args, deps) {
  if (operation === "recordTripSummary") return recordTripSummary(args, deps);
  if (operation === "getTripSummary") return { summary: await enrichSummary(await readSummary(args.summaryId, deps), deps) };
  if (operation === "listTripSummaries") return listTripSummaries(args, deps);
  if (operation === "createFollowUpTask") return createFollowUpTask(args, deps);
  if (operation === "getTripContext") {
    const trip = await getTrip(args, deps);
    const reports = await listTripSummaries({ tripId: args.tripId, limit: 100 }, deps);
    const interactions = (await loadCollection(deps.relationshipInteractionsCollection)).filter(item => item.tripId === args.tripId);
    return { ...trip, ...reports, interactions };
  }
  if (operation === "buildReturnBriefing") {
    const result = await buildDestinationRefresher({ ...args, trigger: "on_demand" }, deps);
    const destination = result.briefing.destination;
    const trips = new Map((await loadCollection(deps.travelTripsCollection)).map(trip => [trip.tripId, trip]));
    const matches = (await loadCollection(deps.tripMemoriesCollection)).filter(item => item.kind === "trip_summary" && (
      item.tripId === args.tripId || (item.locationKeys?.length ? locationMatches(item.locationKeys, destination)
        : trips.get(item.tripId)?.destinations.some(prior => locationMatches(prior.locationKeys, destination)))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ...result, priorReports: await Promise.all(matches.slice(0, 50).map(item => enrichSummary(item, deps))), reportCount: matches.length, hasMoreReports: matches.length > 50 };
  }
}

const runner = createIdempotentOperationRunner({
  workspaceCode: "travel_advisor", executionIdPrefix: "travel-advisor-operation",
  executionCollectionKey: "danTravelOperationExecutionsCollection", preserveCommittedResult: true,
  runOperation: async (input, deps) => {
    if (REUSED.has(input.operation)) return runDanTravelOperation(input, deps);
    const auditId = `travel-audit-${randomUUID()}`;
    const audit = deps.danTravelAuditEventsCollection.doc(auditId);
    if (input.mode === "command") await audit.create({ ...getTravelOwnership(deps), operation: input.operation, actorSub: getTravelWorkspace(deps).subject, status: "in_progress", createdAt: now(deps) });
    try {
      const result = await runExtra(input.operation, input.arguments, deps);
      let auditStatus = "succeeded";
      if (input.mode === "command") {
        try { await audit.set({ status: "succeeded", completedAt: now(deps) }, { merge: true }); }
        catch { auditStatus = "completion_pending"; }
      }
      return { operation: input.operation, mode: input.mode, result, ...(input.mode === "command" ? { audit: { auditId, status: auditStatus } } : {}) };
    } catch (error) {
      if (input.mode === "command") await audit.set({ status: "failed", code: error.code || "travel_failed", completedAt: now(deps) }, { merge: true }).catch(() => {});
      throw error;
    }
  }
});

async function runTravelAdvisorOperation(input, deps) {
  const operation = byName.get(input.operation);
  if (!operation || operation.mode !== input.mode) fail("Unknown Travel Advisor operation or mode", 400, "travel_operation_unavailable");
  const scoped = await createTravelWorkspaceDependencies(deps, { subject: deps.taskAccess?.subject, mode: input.mode });
  const args = input.arguments || {};
  if (!args || typeof args !== "object" || Array.isArray(args)) fail("Arguments must be an object");
  for (const field of operation.required) if (args[field] === undefined || args[field] === null || args[field] === "") fail(`Missing ${field}`);
  validateIds(args);
  if (input.operation === "createFollowUpTask") requireTasks(scoped, true);
  if (input.operation === "recordInteraction") await validateLinks(args, scoped);
  if (input.operation === "createOrganization" && args.parentOrganizationId) await getRequiredRecord(scoped.relationshipOrganizationsCollection, args.parentOrganizationId, "organization");
  if (input.mode === "command" && (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200)) fail("Commands require an idempotency key of 8–200 characters");
  return runner({ ...input, arguments: args, idempotencyNamespace: getTravelWorkspace(scoped).workspaceId, allowLegacyUnnamespacedReplay: false }, scoped);
}

async function listTravelAdvisorOperations(input = {}, deps) {
  await createTravelWorkspaceDependencies(deps, { subject: deps.taskAccess?.subject });
  const entries = operations.filter(op => (!input.mode || op.mode === input.mode) && (!input.query || `${op.name} ${op.summary}`.toLowerCase().includes(String(input.query).toLowerCase())))
    .map(({ name, mode, required, optional, summary, argumentGuidance }) => ({ operation: name, mode, required, optional, summary, argumentGuidance: argumentGuidance || "" }));
  return { catalogVersion: `1-${hash(JSON.stringify(entries)).slice(0, 12)}`, count: entries.length, operations: entries,
    guidance: "Travel Advisor owns your private trip reports and relationships. Preserve exact original notes, distinguish firm commitments from tentative ideas, and resolve people/churches before linking. Use createFollowUpTask for firm actions; Task Management administrators can access those action tasks. Never copy the full narrative to tasks. Outlook uses your own connection after approval. Read back material writes. No automatic sharing or sending." };
}

module.exports = { listTravelAdvisorOperations, runTravelAdvisorOperation };
