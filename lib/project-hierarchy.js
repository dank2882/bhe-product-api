"use strict";

const { readCompleteQuery } = require("./complete-query");
const MAX_PROJECT_DEPTH = 8;
function hierarchyError(message, code = "invalid_project_hierarchy", statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function projectMap(docs) {
  return new Map(docs.map(doc => [doc.id, { ...doc.data(), projectId: doc.id }]));
}
async function withProjectContext(deps = {}) {
  if (deps.projectGraph || !deps.projectsCollection) return deps;
  return { ...deps, projectGraph: projectMap(await readCompleteQuery(deps.projectsCollection)) };
}
function ancestry(projectId, graph) {
  const result = [], seen = new Set();
  while (projectId) {
    if (seen.has(projectId)) throw hierarchyError("Project hierarchy contains a cycle", "project_hierarchy_cycle", 409);
    seen.add(projectId);
    const project = graph.get(projectId);
    if (!project) throw hierarchyError("A parent project is missing", "project_parent_missing", 409);
    result.push(project);
    projectId = project.parentProjectId || "";
    if (result.length > MAX_PROJECT_DEPTH) throw hierarchyError(`Projects support at most ${MAX_PROJECT_DEPTH} levels`, "project_hierarchy_too_deep", 422);
  }
  return result;
}
function branchIds(projectId, graph) {
  const ids = new Set([projectId]);
  const children = new Map();
  for (const project of graph.values()) {
    const parent = project.parentProjectId || "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(project.projectId);
  }
  const queue = [projectId];
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) || []) {
    if (ids.has(child)) throw hierarchyError("Project hierarchy contains a cycle", "project_hierarchy_cycle", 409);
    ids.add(child); queue.push(child);
  }
  return ids;
}
function validateHierarchy(next, graph) {
  const candidate = new Map(graph); candidate.set(next.projectId, next);
  for (const id of branchIds(next.projectId, candidate)) ancestry(id, candidate);
  const parent = candidate.get(next.parentProjectId);
  if (parent && ["done", "archived"].includes(parent.status)) throw hierarchyError("Reopen the parent before adding or moving a project beneath it", "project_parent_inactive", 409);
  return candidate;
}
// Hierarchy changes read the project graph inside a Firestore transaction.
// Concurrent opposite moves cannot both succeed and create a cycle.
async function saveHierarchyProject({ collection, next, snapshot, authorize, create = false }) {
  const firestore = collection.firestore;
  if (!firestore?.runTransaction) {
    const graph = projectMap(await readCompleteQuery(collection));
    authorize(graph); validateHierarchy(next, graph);
    if (create) await collection.doc(next.projectId).create(next);
    else await collection.doc(next.projectId).set(next);
    return;
  }
  await firestore.runTransaction(async transaction => {
    const all = await transaction.get(collection.orderBy("__name__").limit(10001));
    if (all.docs.length > 10000) throw hierarchyError("Project hierarchy exceeds its complete-read budget", "query_requires_narrower_scope", 422);
    const graph = projectMap(all.docs);
    const current = all.docs.find(doc => doc.id === next.projectId);
    if (create ? !!current : !current || !current.updateTime.isEqual(snapshot.updateTime)) {
      throw hierarchyError("Project changed; reload it before updating the hierarchy", "task_version_conflict", 409);
    }
    authorize(graph); validateHierarchy(next, graph);
    const ref = collection.doc(next.projectId);
    if (create) transaction.create(ref, next); else transaction.update(ref, next);
  });
}
module.exports = { MAX_PROJECT_DEPTH, hierarchyError, withProjectContext, ancestry, branchIds, validateHierarchy, saveHierarchyProject };
