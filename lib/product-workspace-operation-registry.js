const { createHash } = require("node:crypto");

const productWorkspace = require("./product-workspace-service");

const OPERATION_MODES = ["query", "command"];

function defineOperation({
  name,
  mode,
  summary,
  required = [],
  optional = [],
  exampleArguments = {},
  argumentGuidance = "",
  handler
}) {
  return Object.freeze({
    name,
    mode,
    summary,
    required: Object.freeze([...required]),
    optional: Object.freeze([...optional]),
    exampleArguments: Object.freeze({ ...exampleArguments }),
    argumentGuidance,
    handler
  });
}

const PRODUCT_WORKSPACE_OPERATIONS = Object.freeze([
  defineOperation({
    name: "listProducts",
    mode: "query",
    summary: "List compact product records with SKU and ISBN summary fields.",
    optional: ["status", "productType", "limit", "scanLimit"],
    exampleArguments: { limit: 25 },
    handler: productWorkspace.listProducts
  }),
  defineOperation({
    name: "searchProducts",
    mode: "query",
    summary: "Search product records by title, slug, ISBN, SKU, Shopify handle, variant text, or marketplace identifiers.",
    required: ["query"],
    optional: ["limit", "scanLimit"],
    exampleArguments: { query: "Tyndale 1526", limit: 10 },
    handler: productWorkspace.searchProducts
  }),
  defineOperation({
    name: "getProduct",
    mode: "query",
    summary: "Retrieve one complete product record by slug.",
    required: ["slug"],
    exampleArguments: { slug: "tyndale-new-testament-1526" },
    handler: productWorkspace.getProduct
  }),
  defineOperation({
    name: "suggestSku",
    mode: "query",
    summary: "Suggest a BHE SKU using the controlled BHE-[TYPE]-[WORK]-[YEAR]-[EDITION] pattern and check for conflicts.",
    optional: ["slug", "title", "productType", "binding", "variant", "edition", "workCode", "year", "editionCode"],
    exampleArguments: { title: "Tyndale New Testament 1526 Commemorative Edition", productType: "Facsimile Bible" },
    argumentGuidance: "Use this before assigning a SKU. Review warnings when a year or work code is inferred.",
    handler: productWorkspace.suggestSku
  }),
  defineOperation({
    name: "auditProductIdentifiers",
    mode: "query",
    summary: "Audit products for missing BHE SKUs, missing external identifiers, duplicate SKUs, and duplicate ISBN-13 values.",
    optional: ["scanLimit"],
    exampleArguments: { scanLimit: 1000 },
    handler: productWorkspace.auditProductIdentifiers
  }),
  defineOperation({
    name: "getProductWorkspaceConfig",
    mode: "query",
    summary: "Retrieve backend product workspace config for allowed values, SKU policy, marketplace rules, import mappings, and workflow rules.",
    optional: ["configId"],
    exampleArguments: { configId: "default" },
    handler: productWorkspace.getProductWorkspaceConfig
  }),
  defineOperation({
    name: "importProductRegister",
    mode: "command",
    summary: "Import or update products from a Shopify/product register export, preserving existing records and storing current identifiers.",
    required: ["records"],
    optional: ["dryRun", "sourceName"],
    exampleArguments: {
      dryRun: true,
      sourceName: "shopify-products-csv",
      records: [
        {
          title: "Tyndale New Testament 1526 Commemorative Edition",
          shopifyHandle: "tyndale-new-testament-1526",
          productType: "Facsimile Bible",
          sku: "BHE-FB-TYN-1526-COM",
          isbn13: "9780000000000"
        }
      ]
    },
    argumentGuidance: "Use dryRun first. Each record may include title, slug, shopifyHandle, productType, sku/bheSku, ISBN, UPC/GTIN, ASIN, Shopify IDs, eBay item number, and variants.",
    handler: productWorkspace.importProductRegister
  }),
  defineOperation({
    name: "seedProductWorkspaceConfig",
    mode: "command",
    summary: "Create the backend product workspace config document from current defaults, or overwrite it when explicitly approved.",
    optional: ["configId", "dryRun", "overwrite", "updatedBy"],
    exampleArguments: { configId: "default", dryRun: true },
    argumentGuidance: "Use dryRun first. Do not set overwrite true unless the operator explicitly approves replacing the backend config.",
    handler: productWorkspace.seedProductWorkspaceConfig
  }),
  defineOperation({
    name: "updateProductWorkspaceConfig",
    mode: "command",
    summary: "Patch backend product workspace config for allowed values, SKU policy, marketplace rules, import mappings, or workflow rules.",
    required: ["patch"],
    optional: ["configId", "dryRun", "updatedBy"],
    exampleArguments: {
      configId: "default",
      dryRun: true,
      patch: {
        skuPolicy: {
          workCodes: {
            luther: "LUT"
          }
        }
      }
    },
    argumentGuidance: "Use dryRun first for policy changes. Patch only the specific values that need to change.",
    handler: productWorkspace.updateProductWorkspaceConfig
  }),
  defineOperation({
    name: "assignSku",
    mode: "command",
    summary: "Assign one permanent BHE SKU to a product after checking for duplicate SKU usage.",
    required: ["slug", "bheSku"],
    optional: ["manufacturerPartNumber", "allowDuplicate"],
    exampleArguments: { slug: "tyndale-new-testament-1526", bheSku: "BHE-FB-TYN-1526-COM" },
    argumentGuidance: "Do not use allowDuplicate unless an operator explicitly approves a known duplicate.",
    handler: productWorkspace.assignSku
  }),
  defineOperation({
    name: "updateProductSpecifications",
    mode: "command",
    summary: "Update verified product authors, physical specifications, publication date, and marketplace classification fields.",
    required: ["slug"],
    optional: [
      "authors",
      "specifications",
      "classification",
      "pageCount",
      "pageCountUnit",
      "binding",
      "language",
      "languageType",
      "publicationDate",
      "bisacCode",
      "subjectCode",
      "subjectCodeType"
    ],
    exampleArguments: {
      slug: "tyndale-new-testament-1526",
      authors: ["William Tyndale"],
      pageCount: 704,
      pageCountUnit: "pages",
      binding: "Hardcover",
      language: "English",
      languageType: "Original",
      publicationDate: null,
      bisacCode: "BIB018030",
      subjectCode: "BIB018030",
      subjectCodeType: "BISAC"
    },
    argumentGuidance: "Store only verified values. Leave publicationDate null until verified. Flat fields are stored under specifications or classification.",
    handler: productWorkspace.updateProductSpecifications
  }),
  defineOperation({
    name: "updateMarketplaceIdentifiers",
    mode: "command",
    summary: "Update ISBN, UPC/GTIN, Amazon ASIN, MPN, Shopify, and eBay identifier fields for one product.",
    required: ["slug"],
    optional: ["identifiers", "isbn10", "isbn13", "upc", "gtin", "amazonAsin", "manufacturerPartNumber", "shopifyProductId", "shopifyVariantId", "ebayItemNumber"],
    exampleArguments: {
      slug: "tyndale-new-testament-1526",
      isbn13: "9780000000000",
      manufacturerPartNumber: "BHE-FB-TYN-1526-COM"
    },
    handler: productWorkspace.updateMarketplaceIdentifiers
  })
]);

const OPERATION_BY_NAME = new Map(PRODUCT_WORKSPACE_OPERATIONS.map((operation) => [operation.name, operation]));

function createRegistryError(message, statusCode = 400, code = "product_workspace_operation_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeMode(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOperationName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArguments(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createRegistryError("Operation arguments must be an object", 400, "invalid_operation_arguments");
  }
  return value;
}

function buildCatalogEntry(operation) {
  return {
    operation: operation.name,
    mode: operation.mode,
    summary: operation.summary,
    required: [...operation.required],
    optional: [...operation.optional],
    exampleArguments: { ...operation.exampleArguments },
    argumentGuidance: operation.argumentGuidance || ""
  };
}

const CATALOG_HASH = createHash("sha256")
  .update(JSON.stringify(PRODUCT_WORKSPACE_OPERATIONS.map(buildCatalogEntry)))
  .digest("hex");
const CATALOG_VERSION = `1-${CATALOG_HASH.slice(0, 12)}`;

function listProductWorkspaceOperations(input = {}) {
  const mode = normalizeMode(input.mode);
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
  const requestedLimit = Number(input.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
    : 100;

  if (mode && !OPERATION_MODES.includes(mode)) {
    throw createRegistryError("Invalid product workspace operation mode", 400, "invalid_operation_mode", {
      mode,
      allowedModes: OPERATION_MODES
    });
  }

  const operations = PRODUCT_WORKSPACE_OPERATIONS
    .filter((operation) => !mode || operation.mode === mode)
    .filter((operation) => {
      if (!query) return true;
      return [operation.name, operation.mode, operation.summary].join(" ").toLowerCase().includes(query);
    })
    .slice(0, limit)
    .map(buildCatalogEntry);

  return {
    catalogVersion: CATALOG_VERSION,
    catalogHash: CATALOG_HASH,
    modes: [...OPERATION_MODES],
    count: operations.length,
    operations
  };
}

async function runProductWorkspaceOperation(input = {}, deps = {}) {
  const mode = normalizeMode(input.mode);
  const operationName = normalizeOperationName(input.operation);

  if (!OPERATION_MODES.includes(mode)) {
    throw createRegistryError("Invalid product workspace operation mode", 400, "invalid_operation_mode", {
      mode,
      allowedModes: OPERATION_MODES
    });
  }

  if (!operationName) {
    throw createRegistryError("Operation is required", 400, "missing_operation");
  }

  const operation = OPERATION_BY_NAME.get(operationName);
  if (!operation) {
    throw createRegistryError("Unknown product workspace operation", 404, "unknown_operation", { operation: operationName });
  }

  if (operation.mode !== mode) {
    throw createRegistryError(`Operation ${operationName} must use ${operation.mode} mode`, 400, "operation_mode_mismatch", {
      operation: operationName,
      expectedMode: operation.mode,
      receivedMode: mode
    });
  }

  const operationArguments = normalizeArguments(input.arguments ?? input.args);
  const missing = operation.required.filter((field) => {
    const value = operationArguments[field];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw createRegistryError("Required operation arguments are missing", 400, "missing_operation_arguments", {
      operation: operationName,
      missing
    });
  }

  const result = await operation.handler(operationArguments, deps);
  return {
    operation: operationName,
    mode,
    result
  };
}

function buildProductWorkspaceOperationError(error, context = {}) {
  return {
    ok: false,
    requestId: context.requestId || "",
    operation: normalizeOperationName(context.operation),
    mode: normalizeMode(context.mode),
    error: {
      code: error?.code || "product_workspace_operation_failed",
      message: error?.message || "Product workspace operation failed",
      status: Number(error?.statusCode) || 500,
      details: error?.details || {},
      requestId: context.requestId || ""
    }
  };
}

module.exports = {
  CATALOG_HASH,
  CATALOG_VERSION,
  OPERATION_MODES,
  PRODUCT_WORKSPACE_OPERATIONS,
  buildProductWorkspaceOperationError,
  listProductWorkspaceOperations,
  runProductWorkspaceOperation
};
