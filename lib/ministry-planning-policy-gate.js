"use strict";

const { getMinistryPlanningConfig } = require("./ministry-planning-config-service");

// A current-policy acknowledgement is a workflow gate, not an authorization grant
// or proof of a model's reasoning. It is stripped before domain validation and
// idempotency fingerprinting so re-reading policy does not change a write intent.
async function requireMinistryPlanningPolicy(input, deps) {
  if (input.mode === "query" && input.operation === "getMinistryPlanningConfig") return input;
  const args = input.arguments ?? input.args ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw Object.assign(new Error("Operation arguments must be an object"), {
      code: "invalid_operation_arguments", statusCode: 400
    });
  }
  const config = await getMinistryPlanningConfig({ sections: ["operatorGuidance"] }, deps);
  if (!config.configVersion || !config.documents.operatorGuidance?.content) {
    throw Object.assign(new Error("Current ministry policy is unavailable; no operation was run"), {
      code: "ministry_policy_unavailable", statusCode: 503
    });
  }
  if (args.policyVersion !== config.configVersion) {
    throw Object.assign(new Error("Load and review ministry_get_guidance with operatorGuidance before any Music work, then retry with arguments.policyVersion set to its configVersion. No operation was run."), {
      code: "ministry_policy_review_required", statusCode: 409,
      details: { guidanceOperation: "getMinistryPlanningConfig", sections: ["operatorGuidance"], acknowledgementField: "arguments.policyVersion" }
    });
  }
  const { policyVersion, ...domainArguments } = args;
  return { ...input, arguments: domainArguments };
}

async function runWithMinistryPlanningPolicy(input, deps, runOperation) {
  return runOperation(await requireMinistryPlanningPolicy(input, deps), deps);
}

module.exports = { requireMinistryPlanningPolicy, runWithMinistryPlanningPolicy };
