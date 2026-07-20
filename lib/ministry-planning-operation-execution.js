"use strict";

const { runMinistryPlanningOperation } = require("./ministry-planning-operation-registry");
const {
  buildReplaySummary,
  createIdempotentOperationRunner,
  getJsonByteLength,
  stableStringify
} = require("./workspace-operation-execution");

const runIdempotentMinistryPlanningOperation = createIdempotentOperationRunner({
  workspaceCode: "ministry_planning",
  executionIdPrefix: "ministry-planning-operation",
  executionCollectionKey: "ministryPlanningOperationExecutionsCollection",
  runOperation: runMinistryPlanningOperation
});

module.exports = {
  buildReplaySummary,
  getJsonByteLength,
  runIdempotentMinistryPlanningOperation,
  stableStringify
};
