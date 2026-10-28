"use strict";

const { requireDanPrivateAccess, normalizeOwnerSubjects } = require("./dan-private-access");
const { withProjectContext } = require("./project-hierarchy");
const { listTasks } = require("./project-task-service");
const { buildPlan, fail } = require("./capacity-planning-policy");

async function buildCapacityPlan(input = {}, deps = {}) {
  const access = requireDanPrivateAccess(deps);
  deps = await withProjectContext(deps);
  const subjects = new Set(normalizeOwnerSubjects(deps.danOwnerSubjects));
  // A delegate may read Dan's plan; their own work is not Dan's capacity.
  if (access.subjects.some(s => subjects.has(s))) access.subjects.forEach(s => subjects.add(s));
  const inventory = await listTasks({ view: "personal", includeArchived: true }, deps, true);
  const isOwner = access.subjects.some(s => subjects.has(s));
  const tasks = inventory.tasks.filter(t => !["done", "dropped"].includes(t.status) &&
    (isOwner || [t.ownerSub, t.createdBySub, t.assignedToSub, t.assignedBySub].some(s => subjects.has(s)) ||
      ![t.ownerSub, t.createdBySub, t.assignedToSub, t.assignedBySub].some(Boolean))).map(t => {
    let disposition = "work";
    if (t.assignedToSub && !subjects.has(t.assignedToSub)) disposition = "delegated";
    else if (["proposed", "needs_clarification", "declined"].includes(t.assignmentStatus)) disposition = "pending_assignment";
    else if (t.status === "waiting") disposition = "waiting";
    else if (!t.assignedToSub) disposition = "identity_unresolved";
    return { ...t, disposition };
  });
  if (tasks.length > 1000) fail("Personal inventory exceeds the first-increment planning budget", "capacity_plan_inventory_too_large", 422);
  const now = new Date(typeof deps.now === "function" ? deps.now() : Date.now()).getTime();
  if (!Number.isFinite(now)) fail("Invalid planning clock");
  return { ...buildPlan(input, tasks, now), generatedAt: new Date(now).toISOString(),
    scope: "Dan personal responsibilities; existing Maintenance handoff exclusions retained. Delegated and waiting work are monitored, not assigned Dan's time." };
}

module.exports = { buildCapacityPlan };
