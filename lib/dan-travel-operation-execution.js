"use strict";

const { runDanTravelOperation } = require("./dan-travel-operation-registry");
const { requireDanPrivateAccess } = require("./dan-private-access");
const { createIdempotentOperationRunner, getJsonByteLength } = require("./workspace-operation-execution");

const runAuthorizedIdempotentDanTravelOperation = createIdempotentOperationRunner({
  workspaceCode: "dan_travel",
  executionIdPrefix: "dan-travel-operation",
  executionCollectionKey: "danTravelOperationExecutionsCollection",
  runOperation: runDanTravelOperation
});

async function runIdempotentDanTravelOperation(input = {}, deps = {}) {
  const operation = typeof input.operation === "string" ? input.operation.trim() : "";
  const allowAutomation = operation === "buildDueTravelBriefings" || operation === "buildDestinationRefresher";
  const access = requireDanPrivateAccess(deps, { allowAutomation });
  if (String(input.mode || "").trim().toLowerCase() === "command" && !String(input.idempotencyKey || "").trim()) {
    const error = new Error("Dan Travel commands require an idempotency key");
    error.statusCode = 400;
    error.code = "dan_travel_idempotency_key_required";
    throw error;
  }
  const idempotencyNamespace = access.matchedSubject || "trusted-dan-travel-automation";
  return runAuthorizedIdempotentDanTravelOperation({
    ...input,
    idempotencyNamespace,
    allowLegacyUnnamespacedReplay: true
  }, deps);
}

module.exports = {
  getJsonByteLength,
  runIdempotentDanTravelOperation
};
