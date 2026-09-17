"use strict";

const { createHash } = require("node:crypto");
const { withProjectContext } = require("./project-hierarchy");
const { readCompleteQuery } = require("./complete-query");
const { getTaskAccess, getBranchRole, assertCanReadTaskRecord, assertCanUpdateTaskRecord, canReadTaskRecord } = require("./task-management-access");
const { ROOT_ID, COLUMNS, fail, string, isMaintenanceProject } = require("./maintenance-fields");

async function context(deps, manager = false) {
  deps = await withProjectContext(deps);
  const access = getTaskAccess(deps), root = deps.projectGraph?.get(ROOT_ID);
  // No implicit system/admin bypass: this domain requires an individual grant.
  if (!access.subject || !root || root.visibility !== "branch") fail("Maintenance access is unavailable", 403);
  const owner = access.subjects.includes(root.ownerSub);
  const manages = owner || (root.maintenanceManagers || []).some(s => access.subjects.includes(s));
  if (manager ? !manages : !owner && !getBranchRole(root, deps)) fail("Maintenance permission required", 403);
  return { deps, root, access, owner, manages };
}

async function getMaintenanceAccess(input, deps) {
  const c = await context(deps, true);
  return { projectId: ROOT_ID, version: c.root.version, ownerSub: c.root.ownerSub,
    managers: c.root.maintenanceManagers || [], members: c.root.branchMembers || [],
    permanentDeletion: "owner_only", approvedReportersHaveRecordAccess: false };
}

async function setMaintenanceAccess(input, deps) {
  const collection = deps.projectsCollection;
  if (!collection?.firestore?.runTransaction) fail("Transactional storage required", 503);
  const { access } = await context(deps, true);
  const field = input.kind === "manager" ? "maintenanceManagers" : input.kind === "member" ? "branchMembers" : fail("kind must be manager or member");
  const subject = string(input.subject, 500);
  if (!subject || !["viewer", "editor", "remove"].includes(input.role)) fail("A subject and viewer/editor/remove role are required");
  if (field === "maintenanceManagers" && !["editor", "remove"].includes(input.role)) fail("Managers require editor role");
  if (!Number.isInteger(input.expectedVersion)) fail("expectedVersion is required");
  const ref = collection.doc(ROOT_ID);
  return collection.firestore.runTransaction(async tx => {
    const doc = await tx.get(ref), root = doc.data();
    if (!doc.exists) fail("Maintenance root missing", 404);
    const owner = access.subjects.includes(root.ownerSub);
    if (field === "maintenanceManagers" ? !owner : !owner && !(root.maintenanceManagers || []).some(s => access.subjects.includes(s))) fail("Only authorized Maintenance managers may change access", 403);
    if (root.version !== input.expectedVersion) fail("Maintenance access changed; reload it", 409);
    if (subject === root.ownerSub) fail("The owner's access cannot be removed or replaced");
    const managers = new Set(root.maintenanceManagers || []);
    const members = new Map((root.branchMembers || []).map(m => [m.subject, m.role]));
    if (field === "maintenanceManagers") {
      if (input.role === "remove") managers.delete(subject);
      else { managers.add(subject); members.set(subject, "editor"); }
    } else {
      if (managers.has(subject) && input.role !== "editor") fail("The owner must revoke manager authority before downgrading this member", 403);
      if (input.role === "remove") members.delete(subject); else members.set(subject, input.role);
    }
    if (members.size > 100 || managers.size > 10) fail("Maintenance member limit reached");
    const updatedAt = new Date().toISOString();
    const patch = { branchMembers: [...members].map(([subject, role]) => ({ subject, role })), maintenanceManagers: [...managers], version: root.version + 1, updatedAt, updatedBySub: access.subject, updatedByName: access.name };
    tx.update(ref, patch);
    tx.create(ref.collection("accessHistory").doc(String(patch.version)), { kind: input.kind, subject, role: input.role, actorSub: access.subject, occurredAt: updatedAt });
    return { projectId: ROOT_ID, ...patch };
  });
}

async function listMaintenanceBoard(input = {}, deps) {
  const c = await context(deps); deps = c.deps;
  const { listTasks } = require("./project-task-service");
  const tasks = await listTasks({ projectId: ROOT_ID, includeDescendants: true, includeArchived: input.includeArchived === true, limit: input.limit || 50, cursor: input.cursor }, deps);
  const attachments = deps.taskAttachmentsCollection ? await readCompleteQuery(deps.taskAttachmentsCollection) : [];
  const rows = tasks.tasks.map(task => {
    const m = task.maintenance || {};
    return { taskId: task.taskId, version: task.version, building: m.building || "Unconfirmed", area: m.area || "", columns: {
      Project: deps.projectGraph.get(task.projectId)?.name || "Maintenance", Task: task.title, Priority: task.priority,
      "Third Party": m.thirdParty || "", Cost: m.cost || { estimate: null, actual: null, currency: "USD" },
      "Target Date": task.dueDate || m.targetDateText || "", Status: task.status === "dropped" ? "Archived" : task.status === "done" ? "Completed" : m.workflowStatus || ({next:"Not Started",waiting:"Waiting",scheduled:"Scheduled"}[task.status] || task.status), "Assigned To": task.assignedTo,
      Notes: task.notes, Images: attachments.filter(d => d.data().recordType === "task" && d.data().recordId === task.taskId && d.data().contentType?.startsWith("image/")).map(d => ({ attachmentId: d.id, fileName: d.data().fileName }))
    }, sourceStatus: m.sourceStatus || "", sourcePriority: m.sourcePriority || "" };
  });
  return { columns: COLUMNS, rows, count: rows.length, hasMore: tasks.hasMore, nextCursor: tasks.nextCursor,
    guidance: "Preserve columns and group by building/area. Unknown is not zero. Images are attachment references; request an authorized download. Retrieve recurring duties separately with listMaintenanceRoutines. Follow pagination before calling this complete." };
}

async function listMaintenanceRoutines(input = {}, deps) {
  const c = await context(deps); deps = c.deps;
  const docs = await readCompleteQuery(deps.routinesCollection);
  const routines = docs.map(d => ({ ...d.data(), routineId: d.id })).filter(r => isMaintenanceProject(r.projectId, deps.projectGraph) && canReadTaskRecord(r, deps) && (input.includeArchived === true || r.status !== "archived"));
  // Complete read has a hard budget and fails explicitly rather than truncating.
  return { routines, count: routines.length, complete: true };
}

async function recordMaintenanceRoutineCompletion(input, deps) {
  const c = await context(deps); deps = c.deps;
  const id = string(input.routineId, 500), occurrence = string(input.occurrenceKey, 200);
  if (!id || /[\/]/.test(id) || !occurrence) fail("routineId and stable occurrenceKey are required");
  const ref = deps.routinesCollection.doc(id);
  const completionId = createHash("sha256").update(occurrence).digest("hex");
  const completionRef = ref.collection("completions").doc(completionId);
  if (!Number.isInteger(input.expectedVersion)) fail("expectedVersion is required");
  return deps.routinesCollection.firestore.runTransaction(async tx => {
    const [doc, prior, projectDocs] = await Promise.all([tx.get(ref), tx.get(completionRef), tx.get(deps.projectsCollection.orderBy("__name__").limit(10001))]);
    if (projectDocs.docs.length > 10000) fail("Project context exceeds read budget", 422);
    const fresh = { ...deps, projectGraph: new Map(projectDocs.docs.map(d => [d.id, { ...d.data(), projectId: d.id }])) };
    const routine = doc.data();
    if (!doc.exists || !isMaintenanceProject(routine.projectId, fresh.projectGraph)) fail("Maintenance routine not found", 404);
    assertCanUpdateTaskRecord(routine, {}, fresh, "routine");
    if (prior.exists) return { completion: prior.data(), replayed: true };
    if (routine.version !== input.expectedVersion || routine.status !== "active") fail("Routine changed or is inactive", 409);
    const completedAt = new Date().toISOString();
    const completion = { completionId, occurrenceKey: occurrence, notes: string(input.notes, 10000), completedAt, completedBySub: c.access.subject, completedByName: c.access.name };
    tx.create(completionRef, completion);
    tx.update(ref, { version: routine.version + 1, lastCompletedAt: completedAt, lastCompletedBySub: c.access.subject });
    return { completion, version: routine.version + 1, replayed: false };
  });
}

async function listMaintenanceRoutineCompletions(input, deps) {
  const c = await context(deps); deps = c.deps;
  const id = string(input.routineId, 500);
  if (!id || /[\/]/.test(id)) fail("Invalid routineId");
  const ref = deps.routinesCollection.doc(id), doc = await ref.get();
  if (!doc.exists || !isMaintenanceProject(doc.data().projectId, deps.projectGraph)) fail("Maintenance routine not found", 404);
  assertCanReadTaskRecord(doc.data(), deps);
  return { completions: (await readCompleteQuery(ref.collection("completions"))).map(d => d.data()), complete: true };
}

async function maintenanceMessaging(input, deps) {
  const c = await context(deps, true);
  if (!deps.maintenanceMessagingRequest) fail("Maintenance messaging is not connected yet", 503);
  return deps.maintenanceMessagingRequest({ ...input, actor: { subject: c.access.subject, name: c.access.name } });
}

module.exports = { context, getMaintenanceAccess, setMaintenanceAccess, listMaintenanceBoard, listMaintenanceRoutines, recordMaintenanceRoutineCompletion, listMaintenanceRoutineCompletions, maintenanceMessaging };
