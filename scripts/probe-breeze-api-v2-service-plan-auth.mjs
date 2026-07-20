#!/usr/bin/env node

const subdomain = (process.env.BREEZE_SUBDOMAIN || "").trim();
const apiKey = (process.env.BREEZE_API_KEY || "").trim();
const eventId = (process.env.BREEZE_EVENT_ID || "409212043").trim();

if (!subdomain || !apiKey) {
  console.error("Missing required environment variables.");
  console.error("Set BREEZE_SUBDOMAIN and BREEZE_API_KEY in the shell that runs this script.");
  process.exit(1);
}

if (!/^[a-z0-9-]+$/i.test(subdomain)) {
  console.error("BREEZE_SUBDOMAIN contains unexpected characters. Refusing to run.");
  process.exit(1);
}

if (!/^\d+$/.test(eventId)) {
  console.error("BREEZE_EVENT_ID must be numeric when provided. Refusing to run.");
  process.exit(1);
}

if (typeof fetch !== "function") {
  console.error("This script requires a Node.js version with global fetch support.");
  process.exit(1);
}

const apiV2BaseUrl = "https://api.breezechms.com/api/v2";
const legacyBaseUrl = `https://${subdomain}.breezechms.com/api`;

const endpoints = [
  {
    label: "legacy /api/account/summary credential control",
    url: `${legacyBaseUrl}/account/summary`
  },
  {
    label: "api-v2 /event-instances/{eventId}",
    url: `${apiV2BaseUrl}/event-instances/${eventId}`
  },
  {
    label: "api-v2 /service-plans/{eventId}",
    url: `${apiV2BaseUrl}/service-plans/${eventId}`
  },
  {
    label: "api-v2 /service-plans/{eventId}?setlist_view=1",
    url: `${apiV2BaseUrl}/service-plans/${eventId}?setlist_view=1`
  },
  {
    label: "api-v2 /service-plans/{eventId}/segments",
    url: `${apiV2BaseUrl}/service-plans/${eventId}/segments`
  },
  {
    label: "api-v2 /song-library/search?searchTerm={knownTitle}",
    url: `${apiV2BaseUrl}/song-library/search?searchTerm=${encodeURIComponent("Blessed Assurance")}`
  }
];

const authPatterns = [
  {
    label: "Api-Key header",
    headers: {
      "Api-Key": apiKey
    }
  }
];

const keyPatterns = {
  servicePlan: /service[_-]?plan|plan|segment|schedule|block|detail|item|section/i,
  music: /song|music|hymn|ccli|arrangement|version|title/i,
  order: /order|sort|position|sequence|slot|start|time|duration/i,
  role: /role|type|leader|performer|person|team|assignment/i,
  private: /name|first|last|email|phone|address|street|city|zip|birth|person|people|member|family|amount|giving|payment|donation/i
};

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function formatList(values) {
  const clean = uniqueSorted(values);
  if (clean.length === 0) {
    return "none";
  }

  const visible = clean.slice(0, 40);
  const suffix = clean.length > visible.length ? `, ... (${clean.length - visible.length} more)` : "";
  return `${visible.join(", ")}${suffix}`;
}

function collectKeys(value, depth = 0, prefix = "", acc = new Set()) {
  if (depth > 5 || value === null || typeof value !== "object") {
    return acc;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) {
      collectKeys(item, depth + 1, prefix, acc);
    }
    return acc;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    acc.add(keyPath);
    collectKeys(nestedValue, depth + 1, keyPath, acc);
  }

  return acc;
}

function summarizeJsonShape(json) {
  if (Array.isArray(json)) {
    const topLevelKeys = uniqueSorted(
      json
        .slice(0, 5)
        .flatMap((item) => (item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item) : []))
    );

    return {
      shape: `array(length=${json.length})`,
      topLevelKeys,
      allKeys: uniqueSorted(Array.from(collectKeys(json)))
    };
  }

  if (json && typeof json === "object") {
    return {
      shape: `object(keys=${Object.keys(json).length})`,
      topLevelKeys: uniqueSorted(Object.keys(json)),
      allKeys: uniqueSorted(Array.from(collectKeys(json)))
    };
  }

  return {
    shape: typeof json,
    topLevelKeys: [],
    allKeys: []
  };
}

function summarizeSignals(allKeys) {
  return {
    servicePlanKeys: allKeys.filter((key) => keyPatterns.servicePlan.test(key)),
    musicKeys: allKeys.filter((key) => keyPatterns.music.test(key)),
    orderKeys: allKeys.filter((key) => keyPatterns.order.test(key)),
    roleKeys: allKeys.filter((key) => keyPatterns.role.test(key)),
    privateKeys: allKeys.filter((key) => keyPatterns.private.test(key))
  };
}

async function fetchEndpoint(endpoint, authPattern) {
  const response = await fetch(endpoint.url, {
    method: "GET",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      ...authPattern.headers
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
    authPattern,
    status: response.status,
    contentType,
    isJson,
    json
  };
}

function printResult(result) {
  const shape = result.isJson ? summarizeJsonShape(result.json) : null;
  const signals = shape ? summarizeSignals(shape.allKeys) : null;

  console.log(`\nEndpoint: ${result.endpoint.label}`);
  console.log(`Auth pattern attempted: ${result.authPattern.label}`);
  console.log(`HTTP status: ${result.status}`);
  console.log(`JSON response: ${result.isJson ? "yes" : "no"}`);
  console.log(`Shape: ${shape ? shape.shape : "not JSON"}`);
  console.log(`Top-level keys: ${shape ? formatList(shape.topLevelKeys) : "none"}`);

  if (signals) {
    console.log(`Service-plan/segment/item field signals: ${formatList(signals.servicePlanKeys)}`);
    console.log(`Music/song/title field signals: ${formatList(signals.musicKeys)}`);
    console.log(`Order/time/duration field signals: ${formatList(signals.orderKeys)}`);
    console.log(`Role/leader/type field signals: ${formatList(signals.roleKeys)}`);
    console.log(`Private-looking field names present but values suppressed: ${formatList(signals.privateKeys)}`);
  }
}

console.log("Breeze API-v2 service-plan auth probe");
console.log("Credentials: BREEZE_SUBDOMAIN=SET; BREEZE_API_KEY=SET; API key is never printed.");
console.log(`Event ID: ${eventId}`);
console.log("Output policy: structural summaries only; no raw response bodies, private values, or secrets are printed or written.");

for (const authPattern of authPatterns) {
  for (const endpoint of endpoints) {
    try {
      const result = await fetchEndpoint(endpoint, authPattern);
      printResult(result);
    } catch (error) {
      console.log(`\nEndpoint: ${endpoint.label}`);
      console.log(`Auth pattern attempted: ${authPattern.label}`);
      console.log("HTTP status: request failed");
      console.log("JSON response: no");
      console.log(`Shape: request error (${error.name || "Error"})`);
      console.log("Top-level keys: none");
    }
  }
}

console.log("\nInterpretation guide:");
console.log("* 2xx on api-v2 service-plan/event-instance routes suggests the API key may work for automation-safe access.");
console.log("* 401/403 on api-v2 routes while the legacy account summary succeeds suggests the API key works for legacy /api but not api-v2 service-plan access.");
console.log("* 404 on service-plans/{eventId} may mean the event ID is not the service plan ID; check whether event-instances/{eventId} exposes a plan ID in field signals/top-level keys.");
