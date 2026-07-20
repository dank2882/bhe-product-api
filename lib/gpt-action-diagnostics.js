const ACTION_DIAGNOSTIC_SCENARIOS = Object.freeze([
  "plain_json",
  "same_domain_url",
  "long_external_url",
  "delayed_json",
  "http_error"
]);

const ACTION_DIAGNOSTIC_SCENARIO_SET = new Set(ACTION_DIAGNOSTIC_SCENARIOS);
const DEFAULT_BASE_URL = "https://bhe-product-api-mwhc25pkra-uw.a.run.app";

function createDiagnosticError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDelayMs(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1500;
  return Math.min(Math.max(parsed, 100), 10000);
}

function getNowIso(deps = {}) {
  return typeof deps.now === "function" ? deps.now() : new Date().toISOString();
}

function getSleep(deps = {}) {
  return typeof deps.sleep === "function"
    ? deps.sleep
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildProbeUrl(scenario, marker, deps = {}) {
  const baseUrl = normalizeString(deps.baseUrl) || DEFAULT_BASE_URL;

  if (scenario === "same_domain_url") {
    return `${baseUrl}/gpt-action-diagnostics/sample.txt?marker=${encodeURIComponent(marker)}`;
  }

  if (scenario === "long_external_url") {
    return "https://storage.googleapis.com/bhe-product-assets/action-diagnostics/transport-probe.txt" +
      `?marker=${encodeURIComponent(marker)}&diagnostic=${"a".repeat(900)}`;
  }

  return "";
}

async function runGptActionTransportProbe(input = {}, deps = {}) {
  const requestId = normalizeString(input.requestId);
  const marker = normalizeString(input.marker);
  const scenario = normalizeString(input.scenario).toLowerCase();
  const receivedAt = getNowIso(deps);

  if (!requestId) {
    throw createDiagnosticError("Missing diagnostic request ID", 500, "diagnostic_request_id_missing");
  }
  if (!marker || marker.length > 100) {
    throw createDiagnosticError(
      "marker must contain between 1 and 100 characters",
      400,
      "invalid_diagnostic_marker"
    );
  }
  if (!ACTION_DIAGNOSTIC_SCENARIO_SET.has(scenario)) {
    throw createDiagnosticError(
      "Unknown diagnostic scenario",
      400,
      "invalid_diagnostic_scenario"
    );
  }
  if (scenario === "http_error") {
    throw createDiagnosticError(
      "Intentional diagnostic HTTP error",
      418,
      "intentional_diagnostic_http_error"
    );
  }

  const delayMs = scenario === "delayed_json" ? normalizeDelayMs(input.delayMs) : 0;
  if (delayMs > 0) {
    await getSleep(deps)(delayMs);
  }

  return {
    ok: true,
    requestId,
    marker,
    scenario,
    method: "POST",
    receivedAt,
    completedAt: getNowIso(deps),
    delayMs,
    url: buildProbeUrl(scenario, marker, deps),
    serviceRevision: normalizeString(deps.serviceRevision) || "local",
    message: "GPT Action transport probe completed"
  };
}

module.exports = {
  ACTION_DIAGNOSTIC_SCENARIOS,
  runGptActionTransportProbe
};
