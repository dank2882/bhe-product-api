"use strict";

const ROOT_ID = "proj-fbc-maintenance";
const COLUMNS = Object.freeze(["Project", "Task", "Priority", "Third Party", "Cost", "Target Date", "Status", "Assigned To", "Notes", "Images"]);
function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode, code: "maintenance_validation" });
}
function string(value, max = 2000) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > max) fail("Invalid maintenance text field");
  return value.trim();
}
function normalizeMaintenance(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("maintenance must be an object");
  const allowed = ["building", "area", "thirdParty", "workflowStatus", "cost", "targetDateText", "sourceStatus", "sourcePriority", "sourceReferences"];
  if (Object.keys(value).some(k => !allowed.includes(k))) fail("Unsupported maintenance field");
  const result = Object.fromEntries(allowed.filter(k => !["cost", "sourceReferences"].includes(k)).map(k => [k, string(value[k])]));
  if (result.workflowStatus && !["Not Started", "Planning", "Assessment Needed", "Quote Needed", "Quote / Schedule", "Waiting", "In Progress", "Completed", "Deferred"].includes(result.workflowStatus)) fail("Unsupported maintenance workflowStatus");
  const cost = value.cost || {};
  if (typeof cost !== "object" || Array.isArray(cost) || Object.keys(cost).some(k => !["estimate", "actual", "currency", "note"].includes(k))) fail("Invalid maintenance cost");
  result.cost = { estimate: null, actual: null, currency: string(cost.currency || "USD", 3), note: string(cost.note) };
  if (!/^[A-Z]{3}$/.test(result.cost.currency)) fail("Cost currency must be a three-letter code");
  for (const kind of ["estimate", "actual"]) {
    if (cost[kind] !== undefined && cost[kind] !== null) {
      if (typeof cost[kind] !== "number" || !Number.isFinite(cost[kind]) || cost[kind] < 0) fail("Cost must be nonnegative or null for unknown");
      result.cost[kind] = cost[kind];
    }
  }
  if (value.sourceReferences !== undefined && (!Array.isArray(value.sourceReferences) || value.sourceReferences.length > 30)) fail("Too many source references");
  result.sourceReferences = (value.sourceReferences || []).map(s => string(s, 2000));
  return result;
}
function isMaintenanceProject(projectId, graph) {
  const seen = new Set();
  while (projectId && !seen.has(projectId)) {
    if (projectId === ROOT_ID) return true;
    seen.add(projectId); projectId = graph?.get(projectId)?.parentProjectId;
  }
  return false;
}
function validateMaintenanceParent(value, projectId, graph) {
  if (value && !isMaintenanceProject(projectId, graph)) fail("Maintenance fields require a project within FBC Maintenance");
}
module.exports = { ROOT_ID, COLUMNS, fail, string, normalizeMaintenance, isMaintenanceProject, validateMaintenanceParent };
