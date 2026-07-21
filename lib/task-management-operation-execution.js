"use strict";

const { runTaskManagementOperation } = require("./task-management-operation-registry");
const {
  buildReplaySummary,
  createIdempotentOperationRunner,
  getJsonByteLength,
  stableStringify
} = require("./workspace-operation-execution");

const runIdempotentTaskManagementOperation = createIdempotentOperationRunner({
  workspaceCode: "task_management",
  executionIdPrefix: "task-management-operation",
  executionCollectionKey: "taskManagementOperationExecutionsCollection",
  runOperation: runTaskManagementOperation
});

module.exports = {
  buildReplaySummary,
  getJsonByteLength,
  runIdempotentTaskManagementOperation,
  stableStringify
};
