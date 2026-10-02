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

// Returned with Dan's live review so installed instruction copies do not own
// current source selection or task-state precedence. No new records/store.
function danReviewGuidance(deps) {
  if (!isDanPersonalView(deps)) return undefined;
  return {
    version: "2026-10-02",
    audience: "dan",
    sourceOfTruth: "Task Management live records",
    connectedSources: ["Outlook Calendar", "Outlook Email", "Messages", "Dropbox"],
    excludedDefaultSources: ["Teams", "Gmail", "Apple Reminders"],
    sourceInstruction: "Use the live owning Life OS domains for their records. Outlook owns personal commitments and mail, Messages owns texts, Dropbox owns source files. Search Dropbox only for relevant linked files or requested document context; do not scan the entire account for daily tasks. Other external channels require an explicit request. Report unavailable or limited reads honestly.",
    taskInstruction: "Read current tasks for every updated-todos or brief request. Chat, earlier briefs, email and document mentions do not override current saved status. Exclude done/dropped work; deduplicate by taskId. Before resurfacing an older candidate, resolve its live task and later source activity. If unresolved, label status needs confirmation. If a completion is requested, update the exact task with expectedVersion and an idempotency key, then independently getTask before claiming saved.",
    presentationInstruction: "Show every activeNext task. displayNumber is an integer reference for this review only, never a durable ID. Use ordinary bullets for scheduled, waiting and other sections; never invent letter suffixes such as 63a or reuse an earlier brief's numbering. Resolve taskId from this current response before any numbered update.",
    audienceInstruction: "correspondence_prepare_pastor_daily_brief is Pastor Smith's workflow, not Dan's review plan. Do not use its mailbox targets, history or presentation for Dan. Use correspondence_get_desk for Dan's correspondence.",
    mutationPolicy: "Reviews are read-only. A missing live source means unavailable, not permission to rebuild its records from chat."
  };
}

module.exports = { isDanPersonalView, isMaintenanceRecord, personalListScope, danReviewGuidance };
