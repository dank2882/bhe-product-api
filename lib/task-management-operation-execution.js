"use strict";

const { runTaskManagementOperation } = require("./task-management-operation-registry");
const {
  buildReplaySummary,
  createIdempotentOperationRunner,
  getJsonByteLength,
  stableStringify
} = require("./workspace-operation-execution");

const runLegacyTaskManagementOperation = createIdempotentOperationRunner({
  workspaceCode: "task_management",
  executionIdPrefix: "task-management-operation",
  executionCollectionKey: "taskManagementOperationExecutionsCollection",
  runOperation: runTaskManagementOperation
});

// Shared Thoughts commits mutation, actor-bound receipt and audit atomically,
// and rechecks current authorization before replaying a receipt.
const sharedThoughts = require("./shared-thoughts-service");
const scheduleAdjustments = require("./schedule-adjustment-service");
async function runIdempotentTaskManagementOperation(input = {}, deps = {}) {
  if (sharedThoughts.NAMES.has(input.operation) || scheduleAdjustments.NAMES.has(input.operation)) return runTaskManagementOperation(input, deps);
  return runLegacyTaskManagementOperation(input, deps);
}

module.exports = {
  buildReplaySummary,
  getJsonByteLength,
  runIdempotentTaskManagementOperation,
  stableStringify
};
