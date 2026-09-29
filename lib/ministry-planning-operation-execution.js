"use strict";

const { runMinistryPlanningOperation } = require("./ministry-planning-operation-registry");
const {
  buildReplaySummary,
  createIdempotentOperationRunner,
  getJsonByteLength,
  stableStringify
} = require("./workspace-operation-execution");

const runLegacyOperation = createIdempotentOperationRunner({
  workspaceCode: "ministry_planning",
  executionIdPrefix: "ministry-planning-operation",
  executionCollectionKey: "ministryPlanningOperationExecutionsCollection",
  runOperation: runMinistryPlanningOperation
});

async function runIdempotentMinistryPlanningOperation(input = {}, deps = {}) {
  const { WRITES, writeProfile } = require("./special-music-profile-service");
  if (input.mode === "command" && WRITES.has(input.operation)) {
    return writeProfile(input.operation, input.arguments ?? input.args ?? {}, { ...deps, idempotencyKey: input.idempotencyKey });
  }
  return runLegacyOperation(input, deps);
}

module.exports = {
  buildReplaySummary,
  getJsonByteLength,
  runIdempotentMinistryPlanningOperation,
  stableStringify
};
