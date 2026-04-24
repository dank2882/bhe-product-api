#!/usr/bin/env node

const subdomain = (process.env.BREEZE_SUBDOMAIN || "").trim();
const apiKey = (process.env.BREEZE_API_KEY || "").trim();

if (!subdomain || !apiKey) {
  console.error("Missing required environment variables.");
  console.error("Set BREEZE_SUBDOMAIN and BREEZE_API_KEY in the shell that runs this script.");
  process.exit(1);
}

if (!/^[a-z0-9-]+$/i.test(subdomain)) {
  console.error("BREEZE_SUBDOMAIN contains unexpected characters. Refusing to run.");
  process.exit(1);
}

if (typeof fetch !== "function") {
  console.error("This script requires a Node.js version with global fetch support.");
  process.exit(1);
}

const currentYear = new Date().getFullYear();

const endpoints = [
  {
    label: "/api/events?limit=5&details=1",
    path: "/api/events",
    params: {
      limit: "5",
      details: "1"
    },
    keepJsonForFollowup: true
  },
  {
    label: `/api/events?start=${currentYear}-01-01&end=${currentYear}-12-31&limit=5&details=1`,
    path: "/api/events",
    params: {
      start: `${currentYear}-01-01`,
      end: `${currentYear}-12-31`,
      limit: "5",
      details: "1"
    },
    keepJsonForFollowup: true
  },
  {
    label: "/api/events/calendars",
    path: "/api/events/calendars"
  },
  {
    label: "/api/events/locations",
    path: "/api/events/locations"
  }
];

const sensitiveValueKeyPattern =
  /(^|_)(name|first|last|email|phone|address|street|city|zip|birth|person|people|member|family|amount|giving|payment|donation)($|_)/i;

const planningKeyPattern =
  /song|songs|setlist|set_list|set-list|serviceplan|service_plan|service-planning|planning|worship|music|ccli|arrangement/i;

const orderRoleKeyPattern =
  /order|position|sequence|sort|slot|role|usage|item|items|section|sections|key/i;

function buildUrl({ path, params = {} }) {
  const url = new URL(`https://${subdomain}.breezechms.com${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function collectKeys(value, depth = 0, acc = new Set()) {
  if (depth > 4 || value === null || typeof value !== "object") {
    return acc;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) {
      collectKeys(item, depth + 1, acc);
    }
    return acc;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    acc.add(key);
    collectKeys(nestedValue, depth + 1, acc);
  }

  return acc;
}

function summarizeJsonShape(json) {
  if (Array.isArray(json)) {
    const itemKeys = uniqueSorted(
      json
        .slice(0, 5)
        .flatMap((item) => (item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item) : []))
    );

    return {
      kind: "array",
      summary: `array(length=${json.length})`,
      topLevelKeys: itemKeys,
      allKeys: uniqueSorted(Array.from(collectKeys(json)))
    };
  }

  if (json && typeof json === "object") {
    return {
      kind: "object",
      summary: `object(keys=${Object.keys(json).length})`,
      topLevelKeys: uniqueSorted(Object.keys(json)),
      allKeys: uniqueSorted(Array.from(collectKeys(json)))
    };
  }

  return {
    kind: typeof json,
    summary: typeof json,
    topLevelKeys: [],
    allKeys: []
  };
}

function formatKeys(keys) {
  if (keys.length === 0) {
    return "none";
  }

  const visibleKeys = keys.slice(0, 40);
  const suffix = keys.length > visibleKeys.length ? `, ... (${keys.length - visibleKeys.length} more)` : "";
  return `${visibleKeys.join(", ")}${suffix}`;
}

function summarizeSignals(allKeys) {
  const planningKeys = uniqueSorted(allKeys.filter((key) => planningKeyPattern.test(key)));
  const orderRoleKeys = uniqueSorted(allKeys.filter((key) => orderRoleKeyPattern.test(key)));
  const sensitiveKeys = uniqueSorted(allKeys.filter((key) => sensitiveValueKeyPattern.test(key)));

  return {
    planningKeys,
    orderRoleKeys,
    sensitiveKeys
  };
}

async function fetchEndpoint(endpoint) {
  const url = buildUrl(endpoint);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Api-Key": apiKey
    }
  });

  const contentType = response.headers.get("content-type") || "";
  let json = null;
  let isJson = contentType.toLowerCase().includes("application/json");

  try {
    json = await response.json();
    isJson = true;
  } catch {
    json = null;
  }

  return {
    endpoint,
    status: response.status,
    isJson,
    json
  };
}

function findFirstEventInstanceId(json) {
  const candidates = Array.isArray(json) ? json : json && typeof json === "object" ? [json] : [];

  for (const item of candidates) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const id = item.id || item.instance_id;
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }

    if (typeof id === "number" && Number.isFinite(id)) {
      return String(id);
    }
  }

  return "";
}

function printResult({ endpoint, status, isJson, json }) {
  const shape = isJson ? summarizeJsonShape(json) : null;
  const signals = shape ? summarizeSignals(shape.allKeys) : null;

  console.log(`\nEndpoint: ${endpoint.label}`);
  console.log(`HTTP status: ${status}`);
  console.log(`JSON response: ${isJson ? "yes" : "no"}`);
  console.log(`Shape: ${shape ? shape.summary : "not JSON"}`);
  console.log(`Top-level keys: ${shape ? formatKeys(shape.topLevelKeys) : "none"}`);

  if (signals) {
    console.log(`Service-planning/song field signals: ${formatKeys(signals.planningKeys)}`);
    console.log(`Order/setlist/usage-role field signals: ${formatKeys(signals.orderRoleKeys)}`);
    console.log(`Sensitive-looking field names present but values suppressed: ${formatKeys(signals.sensitiveKeys)}`);
  }
}

console.log("Breeze read-only API probe");
console.log("Credentials: BREEZE_SUBDOMAIN=SET; BREEZE_API_KEY=SET; API key is never printed.");
console.log("Output policy: status codes and JSON shape only; raw response bodies and private values are suppressed.");

const results = [];
let firstEventInstanceId = "";

for (const endpoint of endpoints) {
  try {
    const result = await fetchEndpoint(endpoint);
    results.push(result);
    printResult(result);

    if (endpoint.keepJsonForFollowup && !firstEventInstanceId && result.isJson) {
      firstEventInstanceId = findFirstEventInstanceId(result.json);
    }
  } catch (error) {
    console.log(`\nEndpoint: ${endpoint.label}`);
    console.log("HTTP status: request failed");
    console.log("JSON response: no");
    console.log(`Shape: request error (${error.name || "Error"})`);
    console.log("Top-level keys: none");
  }
}

if (firstEventInstanceId) {
  const detailEndpoint = {
    label: "/api/events/list_event?instance_id={event_instance_id}&schedule=1&schedule_limit=5&eligible=0",
    path: "/api/events/list_event",
    params: {
      instance_id: firstEventInstanceId,
      schedule: "1",
      schedule_limit: "5",
      eligible: "0"
    }
  };

  try {
    const result = await fetchEndpoint(detailEndpoint);
    results.push(result);
    printResult(result);
  } catch (error) {
    console.log(`\nEndpoint: ${detailEndpoint.label}`);
    console.log("HTTP status: request failed");
    console.log("JSON response: no");
    console.log(`Shape: request error (${error.name || "Error"})`);
    console.log("Top-level keys: none");
  }
} else {
  console.log("\nEndpoint: /api/events/list_event?instance_id={event_instance_id}");
  console.log("HTTP status: not sent; no event instance id was available from prior event responses");
  console.log("JSON response: no");
  console.log("Shape: not tested");
  console.log("Top-level keys: none");
}

const successfulJsonResults = results.filter((result) => result.status >= 200 && result.status < 300 && result.isJson);
const allKeys = uniqueSorted(successfulJsonResults.flatMap((result) => Array.from(collectKeys(result.json))));
const signals = summarizeSignals(allKeys);
const eventShellLikely =
  allKeys.includes("id") &&
  (allKeys.includes("event_id") || allKeys.includes("start_datetime") || allKeys.includes("end_datetime"));

console.log("\nSummary");
console.log(`Event/service shells available: ${eventShellLikely ? "likely yes" : "not confirmed from observed keys"}`);
console.log(
  `Service planning song rows available: ${
    signals.planningKeys.length > 0 ? "field-name signals observed; inspect carefully" : "no field-name signals observed"
  }`
);
console.log(
  `Song order/setlist/usage roles available: ${
    signals.orderRoleKeys.length > 0 ? "generic order/role/item signals observed; no values printed" : "no field-name signals observed"
  }`
);
console.log(
  `API appears sufficient for service-history import: ${
    eventShellLikely && signals.planningKeys.length > 0
      ? "possibly, but requires manual review of suppressed response structure"
      : eventShellLikely
        ? "event shells only from this probe; song usage still not proven"
        : "not proven"
  }`
);
console.log("No official public Service Planning/song usage endpoint was added to this probe because none was found in the docs.");
