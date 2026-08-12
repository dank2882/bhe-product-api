"use strict";

const { runDanTravelOperation } = require("./dan-travel-operation-registry");
const { createIdempotentOperationRunner, getJsonByteLength } = require("./workspace-operation-execution");

const runIdempotentDanTravelOperation = createIdempotentOperationRunner({
  workspaceCode: "dan_travel",
  executionIdPrefix: "dan-travel-operation",
  executionCollectionKey: "danTravelOperationExecutionsCollection",
  runOperation: runDanTravelOperation
});

module.exports = {
  getJsonByteLength,
  runIdempotentDanTravelOperation
};
