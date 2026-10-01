"use strict";
const { createHash } = require("node:crypto");
const tasks = require("./project-task-service");
const thoughts = require("./think-tank-service");
const notebooks = require("./notebooks-service");
const { stableStringify } = require("./workspace-operation-execution");
const { runIdempotentTaskManagementOperation } = require("./task-management-operation-execution");
const { runNotebookOperation } = require("./notebooks-operation-registry");

const hash = value => createHash("sha256").update(value).digest("hex");
function invalid(message) { throw Object.assign(new Error(message), { code: "intake_invalid_destination", statusCode: 400 }); }
const definitions = {
  task: { idField: "taskId", create: "createTask", update: "updateTask", result: "task", get: tasks.getTask },
  project: { idField: "projectId", create: "createProject", update: "updateProject", result: "project", get: tasks.getProject },
  routine: { idField: "routineId", create: "createRoutine", update: "updateRoutine", result: "routine",
    get: async (input, deps) => ({ routine: (await tasks.listRoutines({}, deps, true)).routines.find(r => r.routineId === input.routineId) }) },
  thought: { idField: "thoughtId", create: "captureThinkTankEntry", update: "updateThinkTankEntry", result: "thought", get: thoughts.getThinkTankEntry },
  note: { idField: "noteId", create: "createNote", update: "updateNote", result: "note", get: notebooks.getNote }
};
function matches(actual, expected) {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (Array.isArray(expected)) return stableStringify(actual) === stableStringify(expected);
  return actual && Object.entries(expected).every(([key, value]) => matches(actual[key], value));
}
function createIntakeDestinations(deps) {
  const adapters = Object.fromEntries(Object.entries(definitions).map(([destination, definition]) => [destination, {
    actions: ["create", "update", "link"],
    prepare(proposal, context) {
      const args = structuredClone(proposal.arguments);
      const isCreate = proposal.action === "create";
      if (["permanentlyDelete", "confirmDelete", "delete", "archive"].some(field => Object.hasOwn(args, field) || Object.hasOwn(args.changes || {}, field))) invalid("Deletion and archival require the owning workflow");
      if (Object.hasOwn(args, definition.idField)) invalid("The target ID is controlled by intake; use recordId to select an existing record");
      if (proposal.action === "update" && (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1)) invalid("An update requires the destination's current expectedVersion");
      if (proposal.action === "link" && Object.keys(args).length) invalid("Linking an existing record takes no mutation arguments");
      const recordId = !isCreate ? proposal.recordId : destination === "note"
        ? `note-${hash(`${context.ownerSubject}\0${context.actorSub}\0${context.idempotencyKey}`).slice(0, 32)}`
        : `${destination}-${hash(context.idempotencyKey).slice(0, 32)}`;
      if (!(destination === "note" && isCreate)) args[definition.idField] = recordId;
      // An explicit visibility choice is part of the reviewed proposal; ordinary
      // captures default private even for a manager's task/project defaults.
      if (isCreate && ["task", "project", "routine"].includes(destination) && !args.visibility) args.visibility = "private";
      const operation = proposal.action === "link" ? "" : isCreate ? definition.create : definition.update;
      if (operation) {
        const catalog = destination === "note" ? require("./notebooks-operation-registry").listNotebookOperations({ mode: "command" })
          : require("./task-management-operation-registry").listTaskManagementOperations({ mode: "command", limit: 200 });
        const contract = catalog.operations.find(o => (o.operation || o.name) === operation);
        const allowed = [...contract.required, ...contract.optional];
        if (contract.required.some(field => args[field] === undefined) || Object.keys(args).some(field => !allowed.includes(field))) invalid("Arguments do not match the owning operation catalog");
      }
      let expectedFields = proposal.action === "link" ? {} : isCreate ? { ...args } : args.changes;
      if (!expectedFields || typeof expectedFields !== "object" || Array.isArray(expectedFields)) invalid("Updates require changes");
      expectedFields = structuredClone(expectedFields);
      delete expectedFields[definition.idField]; delete expectedFields.expectedVersion;
      // Preserve exact note/thought text. Existing task/project services normalize
      // their display strings; the original wording remains immutable in intake.
      if (destination !== "note") for (const [field, value] of Object.entries(expectedFields)) {
        if (typeof value === "string" && field !== "exactText") expectedFields[field] = value.trim();
      }
      return { destination, action: proposal.action, recordId, actorSub: context.actorSub,
        tool: destination === "note" ? "notebooks_run_command" : "tasks_run_command",
        operation, arguments: args, idempotencyKey: context.idempotencyKey, expectedFields };
    },
    async verify(dispatch) {
      const result = await definition.get({ [definition.idField]: dispatch.recordId }, deps);
      const record = result[definition.result];
      if (!record) throw Object.assign(new Error("Destination not found"), { statusCode: 404, code: "intake_destination_not_found" });
      const verified = Boolean(record && matches(record, dispatch.expectedFields));
      return { verified, destination, recordId: dispatch.recordId, version: record?.version || 0,
        method: "owning_domain_readback", checkedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() };
    },
    async execute(dispatch) {
      if (dispatch.action === "link") return;
      const input = { operation: dispatch.operation, mode: "command", arguments: dispatch.arguments, idempotencyKey: dispatch.idempotencyKey };
      if (destination === "note") return runNotebookOperation(input, deps);
      return runIdempotentTaskManagementOperation(input, deps);
    }
  }]));
  adapters.domain_reference = {
    actions: ["link"],
    prepare(proposal, context) {
      const { system, expectedVersion, breezePersonId } = proposal.arguments;
      if (!["sermon_workspace", "prayer_management", "pastoral_care_extended", "pastoral_care_member", "correspondence", "dan_travel", "dan_relationships"].includes(system)) invalid("Unsupported reference system");
      const fields = system === "pastoral_care_member" ? ["system", "expectedVersion", "breezePersonId"] : ["system", "expectedVersion"];
      if (Object.keys(proposal.arguments).some(key => !fields.includes(key))) invalid("Domain references contain only opaque identity and optional expectedVersion");
      if (system === "pastoral_care_member" && (typeof breezePersonId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(breezePersonId))) invalid("Member care requires the verified Breeze person ID");
      if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) invalid("Invalid referenced version");
      return { destination: "domain_reference", action: "link", recordId: proposal.recordId,
        system, ...(system === "pastoral_care_member" ? { breezePersonId } : {}), expectedVersion: expectedVersion || null, actorSub: context.actorSub, idempotencyKey: context.idempotencyKey,
        tool: "intake_verify_domain_reference" };
    },
    async verify() { throw Object.assign(new Error("Use intake_verify_domain_reference; the gateway must read the owning domain"), { code: "intake_domain_readback_required", statusCode: 409 }); }
  };
  return adapters;
}
module.exports = { createIntakeDestinations };
