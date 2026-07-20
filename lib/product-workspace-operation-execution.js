const { createHash } = require("node:crypto");

const {
  runProductWorkspaceOperation
} = require("./product-workspace-operation-registry");

const MAX_STORED_RESULT_BYTES = 400000;
const IDEMPOTENCY_RETENTION_DAYS = 30;

function createExecutionError(message, statusCode, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function hashValue(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function getJsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch (_error) {
    return 0;
  }
}

function getNowIso(deps = {}) {
  return typeof deps.now === "function" ? deps.now() : new Date().toISOString();
}

function addDays(isoDate, days) {
  return new Date(new Date(isoDate).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || /already exists/i.test(error?.message || "");
}

function getExecutionsCollection(deps = {}) {
  const collection = deps.productOperationExecutionsCollection;
  if (!collection || typeof collection.doc !== "function") {
    throw createExecutionError(
      "Product operation executions collection is not configured",
      500,
      "product_operation_executions_not_configured"
    );
  }
  return collection;
}

function buildReplaySummary(result = {}) {
  const identifiers = {};
  const queue = [{ value: result, depth: 0 }];

  while (queue.length > 0 && Object.keys(identifiers).length < 40) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || depth > 4) continue;

    for (const [key, child] of Object.entries(value)) {
      if (
        typeof child === "string" &&
        (/Id$/.test(key) || ["slug", "sku", "bheSku", "isbn13", "status"].includes(key))
      ) {
        identifiers[key] = child;
      } else if (
        typeof child === "number" &&
        ["count", "importedCount", "plannedCount", "errorCount", "findingCount"].includes(key)
      ) {
        identifiers[key] = child;
      } else if (child && typeof child === "object") {
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }

  return {
    replaySummaryOnly: true,
    message: "The original operation succeeded, but its full result was too large to cache for replay.",
    identifiers,
    resultKeys: result && typeof result === "object" ? Object.keys(result) : []
  };
}

function buildCachedError(record = {}) {
  const cached = record.error || {};
  return createExecutionError(
    cached.message || "The earlier idempotent operation failed",
    Number(cached.status) || 500,
    cached.code || "idempotent_operation_failed",
    {
      ...(cached.details || {}),
      idempotentReplay: true,
      executionId: record.executionId || ""
    }
  );
}

function resolveExistingExecution(record = {}, fingerprint, context = {}) {
  if (record.requestFingerprint !== fingerprint) {
    throw createExecutionError(
      "Idempotency key was already used with different arguments",
      409,
      "idempotency_key_reused",
      {
        operation: context.operation,
        mode: context.mode,
        executionId: record.executionId || ""
      }
    );
  }

  if (record.status === "succeeded") {
    return {
      ...(record.response || {}),
      idempotency: {
        protected: true,
        replayed: true,
        executionId: record.executionId || "",
        keyHash: context.keyHash
      }
    };
  }

  if (record.status === "failed") {
    throw buildCachedError(record);
  }

  throw createExecutionError(
    "An operation with this idempotency key is already in progress",
    409,
    "idempotent_operation_in_progress",
    {
      operation: context.operation,
      mode: context.mode,
      executionId: record.executionId || "",
      retryable: true
    }
  );
}

async function getExecutionRecord(docRef) {
  const doc = await docRef.get();
  return doc.exists ? (doc.data() || {}) : null;
}

async function runIdempotentProductWorkspaceOperation(input = {}, deps = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const operation = normalizeString(input.operation);
  const operationArguments = input.arguments ?? input.args ?? {};
  const idempotencyKey = normalizeString(input.idempotencyKey);

  if (mode === "query" || !idempotencyKey) {
    const response = await runProductWorkspaceOperation(
      { mode, operation, arguments: operationArguments },
      deps
    );
    return {
      ...response,
      idempotency: {
        protected: false,
        replayed: false,
        executionId: "",
        keyHash: ""
      }
    };
  }

  if (idempotencyKey.length > 200) {
    throw createExecutionError(
      "Idempotency key is too long",
      400,
      "invalid_idempotency_key",
      { maximumLength: 200 }
    );
  }

  const executionsCollection = getExecutionsCollection(deps);
  const keyHash = hashValue(idempotencyKey).slice(0, 16);
  const executionId = `product-operation-${hashValue(`${mode}\u0000${operation}\u0000${idempotencyKey}`).slice(0, 40)}`;
  const requestFingerprint = hashValue(stableStringify(operationArguments));
  const docRef = executionsCollection.doc(executionId);
  const context = { mode, operation, executionId, keyHash };
  const existing = await getExecutionRecord(docRef);

  if (existing) {
    return resolveExistingExecution(existing, requestFingerprint, context);
  }

  const startedAt = getNowIso(deps);
  const pendingRecord = {
    executionId,
    mode,
    operation,
    idempotencyKeyHash: keyHash,
    requestFingerprint,
    argumentKeys: operationArguments && typeof operationArguments === "object"
      ? Object.keys(operationArguments).sort()
      : [],
    status: "in_progress",
    createdAt: startedAt,
    updatedAt: startedAt,
    expiresAt: addDays(startedAt, IDEMPOTENCY_RETENTION_DAYS)
  };

  try {
    await docRef.create(pendingRecord);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const racedRecord = await getExecutionRecord(docRef);
    if (!racedRecord) throw error;
    return resolveExistingExecution(racedRecord, requestFingerprint, context);
  }

  try {
    const response = await runProductWorkspaceOperation(
      { mode, operation, arguments: operationArguments },
      deps
    );
    const responseBytes = getJsonByteLength(response);
    const responseToStore = responseBytes <= MAX_STORED_RESULT_BYTES
      ? response
      : {
          operation: response.operation,
          mode: response.mode,
          result: buildReplaySummary(response.result)
        };
    const completedAt = getNowIso(deps);

    await docRef.set({
      ...pendingRecord,
      status: "succeeded",
      response: responseToStore,
      responseBytes,
      responseStoredCompletely: responseBytes <= MAX_STORED_RESULT_BYTES,
      completedAt,
      updatedAt: completedAt
    });

    return {
      ...response,
      idempotency: {
        protected: true,
        replayed: false,
        executionId,
        keyHash
      }
    };
  } catch (error) {
    const failedAt = getNowIso(deps);
    await docRef.set({
      ...pendingRecord,
      status: "failed",
      error: {
        code: error?.code || "product_workspace_operation_failed",
        message: error?.message || "Product workspace operation failed",
        status: Number(error?.statusCode) || 500,
        details: error?.details || {}
      },
      failedAt,
      updatedAt: failedAt
    });
    throw error;
  }
}

module.exports = {
  IDEMPOTENCY_RETENTION_DAYS,
  MAX_STORED_RESULT_BYTES,
  buildReplaySummary,
  getJsonByteLength,
  runIdempotentProductWorkspaceOperation,
  stableStringify
};
