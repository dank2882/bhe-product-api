"use strict";

const { randomUUID } = require("node:crypto");
const { Firestore } = require("@google-cloud/firestore");

const ALLOWED_OPERATOR_COLLECTIONS = [
  "products",
  "productAssetLibrary",
  "repositoryDocuments",
  "repositoryItems",
  "songs",
  "songPairings",
  "songMetadataAudit",
  "services",
  "serviceOrderItems",
  "serviceMoments",
  "serviceSongEvents",
  "breezeImports",
  "sourceImports",
  "pianists",
  "servicePianoPlans",
  "serviceMinistryAssignments",
  "projects",
  "tasks",
  "calendarEvents",
  "routines",
  "sermonFolders",
  "sermons",
  "preachingProfiles",
  "preachingAnalyses"
];
const MAX_QUERY_LIMIT = 100;
const DEFAULT_QUERY_LIMIT = 25;
const DEFAULT_SCAN_LIMIT = 500;
const MAX_SCAN_LIMIT = 5000;
const DELETE_FIELD = Symbol("operator-delete-field");
const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function createOperatorDataError(message, statusCode = 400, details = {}, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  error.code = code || "operator_data_error";
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializeValue(value) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString()
      : String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }

  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = serializeValue(item);
    }
    return output;
  }

  return value;
}

function clone(value) {
  return serializeValue(value);
}

function deepMergeObjects(left, right) {
  const merged = clone(left || {});

  for (const [key, value] of Object.entries(right || {})) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeObjects(merged[key], value);
    } else {
      merged[key] = clone(value);
    }
  }

  return merged;
}

function normalizeCollectionName(collection) {
  const cleanCollection = normalizeString(collection);

  if (!cleanCollection) {
    throw createOperatorDataError(
      "Missing collection",
      400,
      { allowedCollections: ALLOWED_OPERATOR_COLLECTIONS },
      "missing_collection"
    );
  }

  if (!ALLOWED_OPERATOR_COLLECTIONS.includes(cleanCollection)) {
    throw createOperatorDataError(
      "Unsupported collection",
      400,
      { collection: cleanCollection, allowedCollections: ALLOWED_OPERATOR_COLLECTIONS },
      "unsupported_collection"
    );
  }

  return cleanCollection;
}

function getOperatorCollection(collection, { collections = {} } = {}) {
  const cleanCollection = normalizeCollectionName(collection);
  const collectionRef = collections[cleanCollection];

  if (!collectionRef || typeof collectionRef.doc !== "function" || typeof collectionRef.limit !== "function") {
    throw createOperatorDataError(
      "Operator collection is not configured",
      500,
      { collection: cleanCollection },
      "operator_collection_not_configured"
    );
  }

  return {
    collectionName: cleanCollection,
    collectionRef
  };
}

function validateDocId(docId, { required = false } = {}) {
  const cleanDocId = normalizeString(docId);

  if (!cleanDocId) {
    if (required) {
      throw createOperatorDataError(
        "Missing docId",
        400,
        {},
        "missing_doc_id"
      );
    }

    return "";
  }

  if (cleanDocId.includes("/")) {
    throw createOperatorDataError(
      "Invalid docId",
      400,
      { docId: cleanDocId },
      "invalid_doc_id"
    );
  }

  return cleanDocId;
}

function normalizeFieldPath(fieldPath) {
  const cleanFieldPath = normalizeString(fieldPath);

  if (!cleanFieldPath) {
    throw createOperatorDataError(
      "Missing fieldPath",
      400,
      {},
      "missing_field_path"
    );
  }

  if (!/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/.test(cleanFieldPath)) {
    throw createOperatorDataError(
      "Invalid fieldPath",
      400,
      { fieldPath: cleanFieldPath },
      "invalid_field_path"
    );
  }

  return cleanFieldPath;
}

function normalizeInteger(value, defaultValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? defaultValue), 10);

  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.min(Math.max(parsed, 1), maxValue);
}

function normalizeLimit(limit) {
  return normalizeInteger(limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
}

function normalizeScanLimit(scanLimit, limit) {
  const defaultScanLimit = Math.max(DEFAULT_SCAN_LIMIT, normalizeLimit(limit));
  return normalizeInteger(scanLimit, defaultScanLimit, MAX_SCAN_LIMIT);
}

function validateDataValue(value, path = "data") {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw createOperatorDataError(
      "Unsupported data value",
      400,
      { path },
      "unsupported_data_value"
    );
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateDataValue(value[index], `${path}[${index}]`);
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) {
      throw createOperatorDataError(
        "Unsupported data key",
        400,
        { path: `${path}.${key}` },
        "unsupported_data_key"
      );
    }

    validateDataValue(item, `${path}.${key}`);
  }
}

function requirePlainData(data, operation) {
  if (!isPlainObject(data)) {
    throw createOperatorDataError(
      `Missing or invalid data for ${operation}`,
      400,
      { operation },
      "invalid_operator_data"
    );
  }

  validateDataValue(data);
  return clone(data);
}

function getFieldValue(document, fieldPath) {
  const cleanFieldPath = normalizeString(fieldPath);

  if (["id", "docId", "documentId", "__name__"].includes(cleanFieldPath)) {
    return document.id;
  }

  const parts = cleanFieldPath.split(".");
  let current = document.data;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function setFieldValue(target, fieldPath, value) {
  const parts = normalizeFieldPath(fieldPath).split(".");
  let current = target;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = clone(value);
}

function deleteFieldValue(target, fieldPath) {
  const parts = normalizeFieldPath(fieldPath).split(".");
  let current = target;

  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current?.[parts[index]];
    if (!isPlainObject(current)) {
      return;
    }
  }

  delete current[parts[parts.length - 1]];
}

function deepEqual(left, right) {
  return JSON.stringify(clone(left)) === JSON.stringify(clone(right));
}

function normalizeFilterOperator(operator) {
  const cleanOperator = normalizeString(operator || "==").toLowerCase();
  const allowedOperators = new Set([
    "==",
    "!=",
    "<",
    "<=",
    ">",
    ">=",
    "in",
    "not-in",
    "array-contains",
    "array-contains-any",
    "contains",
    "exists"
  ]);

  if (!allowedOperators.has(cleanOperator)) {
    throw createOperatorDataError(
      "Unsupported filter operator",
      400,
      { operator: cleanOperator },
      "unsupported_filter_operator"
    );
  }

  return cleanOperator;
}

function comparePrimitive(left, right) {
  if (left === right) {
    return 0;
  }

  if (left === undefined || left === null) {
    return -1;
  }

  if (right === undefined || right === null) {
    return 1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left < right ? -1 : 1;
  }

  return String(left).localeCompare(String(right));
}

function matchesFilter(document, filter) {
  if (!isPlainObject(filter)) {
    throw createOperatorDataError(
      "Invalid filter",
      400,
      { filter },
      "invalid_filter"
    );
  }

  const fieldPath = normalizeFieldPath(filter.fieldPath);
  const operator = normalizeFilterOperator(filter.operator);
  const actualValue = getFieldValue(document, fieldPath);
  const expectedValue = clone(filter.value);

  if (operator === "exists") {
    return Boolean(expectedValue) ? actualValue !== undefined : actualValue === undefined;
  }

  if (operator === "==") {
    return deepEqual(actualValue, expectedValue);
  }

  if (operator === "!=") {
    return !deepEqual(actualValue, expectedValue);
  }

  if (["<", "<=", ">", ">="].includes(operator)) {
    const comparison = comparePrimitive(actualValue, expectedValue);
    return operator === "<"
      ? comparison < 0
      : operator === "<="
        ? comparison <= 0
        : operator === ">"
          ? comparison > 0
          : comparison >= 0;
  }

  if (operator === "in" || operator === "not-in") {
    if (!Array.isArray(expectedValue)) {
      throw createOperatorDataError(
        "Filter value must be an array",
        400,
        { fieldPath, operator },
        "invalid_filter_value"
      );
    }

    const included = expectedValue.some((item) => deepEqual(actualValue, item));
    return operator === "in" ? included : !included;
  }

  if (operator === "array-contains") {
    return Array.isArray(actualValue) && actualValue.some((item) => deepEqual(item, expectedValue));
  }

  if (operator === "array-contains-any") {
    if (!Array.isArray(expectedValue)) {
      throw createOperatorDataError(
        "Filter value must be an array",
        400,
        { fieldPath, operator },
        "invalid_filter_value"
      );
    }

    return Array.isArray(actualValue) &&
      actualValue.some((item) => expectedValue.some((expectedItem) => deepEqual(item, expectedItem)));
  }

  if (operator === "contains") {
    if (Array.isArray(actualValue)) {
      return actualValue.some((item) => String(item).toLowerCase().includes(String(expectedValue).toLowerCase()));
    }

    return String(actualValue ?? "").toLowerCase().includes(String(expectedValue).toLowerCase());
  }

  return false;
}

function collectTextParts(value, parts = []) {
  if (value === null || value === undefined) {
    return parts;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextParts(item, parts);
    }
    return parts;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectTextParts(item, parts);
    }
    return parts;
  }

  parts.push(String(value));
  return parts;
}

function getSearchHaystack(document, fields = []) {
  const fieldList = Array.isArray(fields)
    ? fields.map((field) => normalizeString(field)).filter(Boolean)
    : [];

  const values = fieldList.length > 0
    ? fieldList.map((fieldPath) => getFieldValue(document, fieldPath))
    : [document.id, document.data];

  return values
    .flatMap((value) => collectTextParts(value, []))
    .join(" ")
    .toLowerCase();
}

function matchesFreeText(document, freeText = {}) {
  const query = normalizeString(
    typeof freeText === "string" ? freeText : freeText.query
  ).toLowerCase();

  if (!query) {
    return true;
  }

  const matchMode = normalizeString(freeText.matchMode || "all").toLowerCase();
  const haystack = getSearchHaystack(document, freeText.fields || []);

  if (matchMode === "phrase") {
    return haystack.includes(query);
  }

  const tokens = query.split(/\s+/).filter(Boolean);

  if (matchMode === "any") {
    return tokens.some((token) => haystack.includes(token));
  }

  return tokens.every((token) => haystack.includes(token));
}

function normalizeOrderBy(orderBy) {
  const values = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];

  return values.map((item) => {
    if (!isPlainObject(item)) {
      throw createOperatorDataError(
        "Invalid orderBy item",
        400,
        { orderBy: item },
        "invalid_order_by"
      );
    }

    const fieldPath = normalizeFieldPath(item.fieldPath);
    const direction = normalizeString(item.direction || "asc").toLowerCase();

    if (!["asc", "desc"].includes(direction)) {
      throw createOperatorDataError(
        "Invalid orderBy direction",
        400,
        { direction },
        "invalid_order_by_direction"
      );
    }

    return { fieldPath, direction };
  });
}

function applyOrdering(documents, orderBy) {
  if (orderBy.length === 0) {
    return documents;
  }

  return [...documents].sort((left, right) => {
    for (const item of orderBy) {
      const comparison = comparePrimitive(
        getFieldValue(left, item.fieldPath),
        getFieldValue(right, item.fieldPath)
      );

      if (comparison !== 0) {
        return item.direction === "desc" ? comparison * -1 : comparison;
      }
    }

    return left.id.localeCompare(right.id);
  });
}

function selectDocumentData(document, select = []) {
  const fields = Array.isArray(select)
    ? select.map((field) => normalizeString(field)).filter(Boolean)
    : [];

  if (fields.length === 0) {
    return clone(document.data);
  }

  const selected = {};

  for (const fieldPath of fields) {
    if (["id", "docId", "documentId", "__name__"].includes(fieldPath)) {
      continue;
    }

    const value = getFieldValue(document, fieldPath);

    if (value !== undefined) {
      setFieldValue(selected, fieldPath, value);
    }
  }

  return selected;
}

async function getDocumentsById(collectionRef, docIds) {
  const documents = [];

  for (const docId of docIds) {
    const docRef = collectionRef.doc(docId);
    const doc = await docRef.get();

    if (doc.exists) {
      documents.push({
        id: docId,
        data: clone(doc.data() || {})
      });
    }
  }

  return documents;
}

async function queryOperatorDocuments(
  {
    collection,
    docId,
    docIds,
    filters = [],
    freeText,
    orderBy,
    select,
    limit,
    scanLimit
  } = {},
  deps = {}
) {
  const { collectionName, collectionRef } = getOperatorCollection(collection, deps);
  const safeLimit = normalizeLimit(limit);
  const safeScanLimit = normalizeScanLimit(scanLimit, safeLimit);
  const cleanDocId = validateDocId(docId);
  const cleanDocIds = Array.isArray(docIds)
    ? docIds.map((id) => validateDocId(id)).filter(Boolean)
    : [];
  const requestedDocIds = Array.from(new Set([cleanDocId, ...cleanDocIds].filter(Boolean)));
  const filterList = Array.isArray(filters) ? filters : [];
  const orderByList = normalizeOrderBy(orderBy);
  const baseDocuments = requestedDocIds.length > 0
    ? await getDocumentsById(collectionRef, requestedDocIds)
    : (await collectionRef.limit(safeScanLimit).get()).docs.map((doc) => ({
        id: doc.id,
        data: clone(doc.data() || {})
      }));

  const matchedDocuments = applyOrdering(
    baseDocuments.filter((document) => {
      return filterList.every((filter) => matchesFilter(document, filter)) &&
        matchesFreeText(document, freeText || {});
    }),
    orderByList
  );
  const documents = matchedDocuments.slice(0, safeLimit).map((document) => ({
    collection: collectionName,
    docId: document.id,
    path: `${collectionName}/${document.id}`,
    data: selectDocumentData(document, select)
  }));
  const warnings = [];

  if (requestedDocIds.length === 0 && baseDocuments.length >= safeScanLimit) {
    warnings.push("The query scanned up to scanLimit; there may be additional matches beyond this scan window.");
  }

  return {
    collection: collectionName,
    count: documents.length,
    matchedCount: matchedDocuments.length,
    scannedCount: baseDocuments.length,
    limit: safeLimit,
    scanLimit: requestedDocIds.length > 0 ? requestedDocIds.length : safeScanLimit,
    documents,
    warnings
  };
}

function normalizeOperation(operation) {
  const cleanOperation = normalizeString(operation).toLowerCase();

  if (!["create", "set", "update", "delete"].includes(cleanOperation)) {
    throw createOperatorDataError(
      "Unsupported operation",
      400,
      { operation },
      "unsupported_operator_operation"
    );
  }

  return cleanOperation;
}

function normalizeHumanSafetyCheck({ humanConfirmed, confirmationSummary }) {
  const cleanSummary = normalizeString(confirmationSummary);

  if (humanConfirmed !== true || !cleanSummary) {
    throw createOperatorDataError(
      "Human confirmation is required before committing this data change",
      400,
      {},
      "missing_human_confirmation"
    );
  }

  return cleanSummary;
}

function normalizeFieldPatches(fieldPatches = []) {
  if (fieldPatches === null || fieldPatches === undefined) {
    return [];
  }

  if (!Array.isArray(fieldPatches)) {
    throw createOperatorDataError(
      "Invalid fieldPatches",
      400,
      {},
      "invalid_field_patches"
    );
  }

  return fieldPatches.map((patch) => {
    if (!isPlainObject(patch)) {
      throw createOperatorDataError(
        "Invalid field patch",
        400,
        { patch },
        "invalid_field_patch"
      );
    }

    const fieldPath = normalizeFieldPath(patch.fieldPath);
    const action = normalizeString(patch.action || "set").toLowerCase();

    if (!["set", "delete"].includes(action)) {
      throw createOperatorDataError(
        "Unsupported field patch action",
        400,
        { action },
        "unsupported_field_patch_action"
      );
    }

    if (action === "set") {
      validateDataValue(patch.value, fieldPath);
    }

    return {
      fieldPath,
      action,
      value: action === "set" ? clone(patch.value) : DELETE_FIELD
    };
  });
}

function buildFieldPatchPayload(fieldPatches, deleteFieldSentinel) {
  if (fieldPatches.length === 0) {
    return {};
  }

  return buildUpdatePayload(null, fieldPatches, deleteFieldSentinel);
}

function buildUpdatePayload(data, fieldPatches, deleteFieldSentinel) {
  const payload = {};

  if (isPlainObject(data)) {
    validateDataValue(data);
    for (const [fieldPath, value] of Object.entries(data)) {
      normalizeFieldPath(fieldPath);
      payload[fieldPath] = clone(value);
    }
  }

  for (const patch of fieldPatches) {
    payload[patch.fieldPath] = patch.action === "delete"
      ? deleteFieldSentinel
      : clone(patch.value);
  }

  if (Object.keys(payload).length === 0) {
    throw createOperatorDataError(
      "Update requires data or fieldPatches",
      400,
      {},
      "empty_operator_update"
    );
  }

  return payload;
}

function applyUpdatePayload(previousData, updatePayload, deleteFieldSentinel) {
  const nextData = clone(previousData || {});

  for (const [fieldPath, value] of Object.entries(updatePayload)) {
    if (value === deleteFieldSentinel) {
      deleteFieldValue(nextData, fieldPath);
    } else {
      setFieldValue(nextData, fieldPath, value);
    }
  }

  return nextData;
}

async function commitOperatorDataChange(
  {
    collection,
    docId,
    operation,
    data,
    fieldPatches,
    merge = false,
    humanConfirmed,
    confirmationSummary,
    changedBy = "custom-gpt"
  } = {},
  deps = {}
) {
  const cleanOperation = normalizeOperation(operation);
  const safetySummary = normalizeHumanSafetyCheck({ humanConfirmed, confirmationSummary });
  const { collectionName, collectionRef } = getOperatorCollection(collection, deps);
  const cleanDocId = validateDocId(docId, { required: cleanOperation !== "create" });
  const targetDocId = cleanDocId || (typeof deps.createDocumentId === "function" ? deps.createDocumentId() : randomUUID());
  const docRef = collectionRef.doc(targetDocId);
  const doc = await docRef.get();
  const previousExists = doc.exists === true;
  const previousData = previousExists ? clone(doc.data() || {}) : null;
  const changedAt = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
  const actor = normalizeString(changedBy) || "custom-gpt";
  const deleteFieldSentinel = deps.deleteFieldValue || Firestore.FieldValue.delete();
  let newData = null;

  if (cleanOperation === "create") {
    if (previousExists) {
      throw createOperatorDataError(
        "Document already exists",
        409,
        { collection: collectionName, docId: targetDocId },
        "operator_document_already_exists"
      );
    }

    const patches = normalizeFieldPatches(fieldPatches);
    const createData = requirePlainData(data, cleanOperation);
    newData = applyUpdatePayload(
      createData,
      buildFieldPatchPayload(patches, deleteFieldSentinel),
      deleteFieldSentinel
    );

    if (typeof docRef.create === "function") {
      await docRef.create(newData);
    } else {
      await docRef.set(newData);
    }
  } else if (cleanOperation === "set") {
    const patches = normalizeFieldPatches(fieldPatches);
    const nextData = applyUpdatePayload(
      requirePlainData(data, cleanOperation),
      buildFieldPatchPayload(patches, deleteFieldSentinel),
      deleteFieldSentinel
    );
    newData = merge && previousExists ? deepMergeObjects(previousData, nextData) : nextData;
    if (merge) {
      await docRef.set(nextData, { merge: true });
    } else {
      await docRef.set(nextData);
    }
  } else if (cleanOperation === "update") {
    if (!previousExists) {
      throw createOperatorDataError(
        "Document not found",
        404,
        { collection: collectionName, docId: targetDocId },
        "operator_document_not_found"
      );
    }

    const patches = normalizeFieldPatches(fieldPatches);
    const updatePayload = buildUpdatePayload(data, patches, deleteFieldSentinel);
    newData = applyUpdatePayload(previousData, updatePayload, deleteFieldSentinel);

    if (typeof docRef.update === "function") {
      await docRef.update(updatePayload);
    } else {
      await docRef.set(newData);
    }
  } else if (cleanOperation === "delete") {
    if (!previousExists) {
      throw createOperatorDataError(
        "Document not found",
        404,
        { collection: collectionName, docId: targetDocId },
        "operator_document_not_found"
      );
    }

    if (typeof docRef.delete !== "function") {
      throw createOperatorDataError(
        "Document delete is not configured",
        500,
        { collection: collectionName, docId: targetDocId },
        "operator_delete_not_configured"
      );
    }

    await docRef.delete();
  }

  return {
    collection: collectionName,
    docId: targetDocId,
    path: `${collectionName}/${targetDocId}`,
    operation: cleanOperation,
    committed: true,
    deleted: cleanOperation === "delete",
    previousExists,
    previousData,
    newData,
    humanConfirmation: {
      confirmed: true,
      summary: safetySummary
    },
    changedBy: actor,
    changedAt
  };
}

function listOperatorCollections() {
  return {
    collections: ALLOWED_OPERATOR_COLLECTIONS.map((collection) => ({
      collection,
      canQuery: true,
      canCreate: true,
      canSet: true,
      canUpdate: true,
      canDelete: true
    }))
  };
}

module.exports = {
  ALLOWED_OPERATOR_COLLECTIONS,
  createOperatorDataError,
  commitOperatorDataChange,
  listOperatorCollections,
  queryOperatorDocuments
};
