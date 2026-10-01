"use strict";

const { getTaskAccess } = require("./task-management-access");
const { normalizeOwnerSubjects } = require("./dan-private-access");
const { delegatedOwnerSubjects } = require("./dan-private-delegation");
const { isMaintenanceProject } = require("./maintenance-fields");

// Operational handoff accepted October 1, 2026. Historical authorship and
// administrative ownership are not an ongoing personal delegation to Dan.
function isDanPersonalView(deps) {
  const access = getTaskAccess(deps), env = deps.privateDelegationEnv || process.env;
  const owners = new Set([...normalizeOwnerSubjects(deps.danOwnerSubjects),
    ...normalizeOwnerSubjects(env.DAN_PRIVATE_OWNER_SUBJECTS)]);
  return [...access.subjects, ...delegatedOwnerSubjects(access.subject, env)].some(s => owners.has(s));
}

function isMaintenanceRecord(record, deps) {
  return record.teamId === "maintenance" || isMaintenanceProject(record.projectId, deps.projectGraph);
}

function personalListScope(input, deps) {
  // A deliberate Maintenance lookup stays in the existing authorized shared
  // system. Generic searches, priorities and dates must not pull it back in.
  const explicitMaintenance = input.teamId === "maintenance" ||
    [input.projectId, input.parentProjectId, input.ancestorProjectId].some(id => isMaintenanceProject(id, deps.projectGraph));
  const excludesMaintenance = isDanPersonalView(deps) && !explicitMaintenance;
  return {
    scope: excludesMaintenance ? "dan_personal_excludes_maintenance" : "authorized_inventory",
    includes: record => !excludesMaintenance || !isMaintenanceRecord(record, deps)
  };
}

module.exports = { isDanPersonalView, isMaintenanceRecord, personalListScope };
