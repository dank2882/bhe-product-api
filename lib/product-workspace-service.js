const IDENTIFIER_FIELDS = [
  "bheSku",
  "isbn10",
  "isbn13",
  "upc",
  "gtin",
  "amazonAsin",
  "manufacturerPartNumber",
  "shopifyProductId",
  "shopifyVariantId",
  "ebayItemNumber",
  "sourceSku",
  "legacySku"
];

const SPECIFICATION_FIELDS = [
  "pageCount",
  "pageCountUnit",
  "binding",
  "language",
  "languageType",
  "publicationDate"
];

const CLASSIFICATION_FIELDS = [
  "bisacCode",
  "subjectCode",
  "subjectCodeType"
];

const PRODUCT_TYPE_CODES = Object.freeze({
  "Facsimile Bible": "FB",
  Book: "BK",
  Reproduction: "RP",
  "Teaching Resource": "TR",
  Artwork: "AR",
  Poster: "PO",
  DVD: "DV",
  Statue: "ST",
  Canvas: "CV",
  "Coins & Medallions": "CM",
  "Bible Stand": "BS",
  "Book Press": "PR",
  "Sculpture Stand": "SS",
  "Dimensional Art": "DA",
  Tour: "TO"
});

const WORK_CODES = Object.freeze({
  tyndale: "TYN",
  geneva: "GEN",
  bishops: "BIS",
  "bishop's": "BIS",
  "king james": "KJV",
  kjv: "KJV",
  gutenberg: "GUT",
  wycliffe: "WYC",
  matthews: "MAT",
  coverdale: "COV"
});

const EDITION_CODES = Object.freeze({
  commemorative: "COM",
  deluxe: "DLX",
  leather: "LTH",
  hardcover: "HDC",
  hardback: "HDC",
  softcover: "SFT",
  paperback: "SFT",
  burgundy: "BUR",
  black: "BLK",
  cherrywood: "YCDL",
  poster: "PST"
});

const DEFAULT_PRODUCT_WORKSPACE_CONFIG = Object.freeze({
  configVersion: 1,
  defaults: {
    vendor: "Biblical Heritage Exhibit",
    category: "Media > Books > Print Books",
    targetAudience: "Adults",
    language: "English"
  },
  allowedValues: {
    productTypes: [
      "Facsimile Bible",
      "Book",
      "Reproduction",
      "Teaching Resource",
      "Artwork",
      "Poster",
      "DVD",
      "Statue",
      "Canvas",
      "Coins & Medallions",
      "Bible Stand",
      "Book Press",
      "Sculpture Stand",
      "Dimensional Art",
      "Tour"
    ],
    vendors: [
      "Biblical Heritage Exhibit",
      "Thomas Nelson",
      "Crossway",
      "Smithsonian Books",
      "Vision Video"
    ],
    categories: [
      "Media > Books > Print Books",
      "Media > Books",
      "Home & Garden > Decor > Artwork"
    ],
    tags: [
      "English",
      "Hebrew",
      "Greek",
      "Latin",
      "German",
      "Spanish",
      "Facsimile",
      "Reproduction",
      "Bible History",
      "Reformation",
      "Tyndale",
      "Martin Luther",
      "Education",
      "limited-edition",
      "Just Arrived!",
      "popup-event"
    ],
    collections: [
      "Commemorative Bible Series",
      "Facsimile Bibles",
      "Bible History & Education"
    ]
  },
  skuPolicy: {
    pattern: "BHE-[TYPE]-[WORK]-[YEAR]-[EDITION]",
    productTypeCodes: PRODUCT_TYPE_CODES,
    workCodes: WORK_CODES,
    editionCodes: EDITION_CODES,
    rules: [
      "Never reuse a BHE SKU, even after discontinuing a product.",
      "Every separately purchasable edition, binding, size, color, or set needs its own SKU.",
      "If two products have different ISBNs, they normally should have different SKUs.",
      "Do not place price, inventory quantity, or marketplace name in the SKU."
    ]
  },
  marketplaceRules: {
    internalIdentifier: "BHE SKU",
    externalIdentifiers: ["ISBN-10", "ISBN-13", "UPC", "GTIN", "Amazon ASIN", "Shopify IDs", "eBay item number"],
    neverInvent: ["ISBN", "UPC", "GTIN", "ASIN", "Shopify ID", "eBay item number"],
    sellerSkuField: "identifiers.bheSku",
    manufacturerPartNumberDefault: "identifiers.bheSku"
  },
  importMappings: {
    title: ["title", "productTitle", "Title"],
    shopifyHandle: ["shopifyHandle", "handle", "Handle"],
    productType: ["productType", "type", "Type"],
    bheSku: ["bheSku", "sku", "SKU"],
    isbn10: ["isbn10", "ISBN10"],
    isbn13: ["isbn13", "ISBN13", "isbn"],
    upc: ["upc", "UPC"],
    gtin: ["gtin", "GTIN"],
    amazonAsin: ["amazonAsin", "asin", "ASIN"],
    manufacturerPartNumber: ["manufacturerPartNumber", "mpn", "MPN"],
    shopifyProductId: ["shopifyProductId", "productId"],
    shopifyVariantId: ["shopifyVariantId", "variantId"],
    ebayItemNumber: ["ebayItemNumber", "ebayItemId"]
  },
  workflowRules: {
    productRegisterImport: "Run importProductRegister with dryRun: true before live import.",
    archiveDeleteConfirmation: "Confirm before archive/delete when a product is identified by rough description and ambiguity exists.",
    apiPriority: "Use product API actions first for product records, identifiers, assets, OCR, drafts, archive/delete, source files, and saved media links."
  }
});

function createProductWorkspaceError(message, statusCode = 400, code = "product_workspace_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getNowIso(deps = {}) {
  return typeof deps.now === "function" ? deps.now() : new Date().toISOString();
}

function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function slugify(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeIdentifierValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeIdentifiers(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const identifiers = {};

  for (const field of IDENTIFIER_FIELDS) {
    identifiers[field] = normalizeIdentifierValue(source[field]);
  }

  return identifiers;
}

function mergeIdentifiers(current = {}, next = {}) {
  const merged = normalizeIdentifiers(current);
  const cleanNext = normalizeIdentifiers(next);

  for (const field of IDENTIFIER_FIELDS) {
    if (cleanNext[field]) {
      merged[field] = cleanNext[field];
    }
  }

  return merged;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeStoredSpecifications(product = {}) {
  const source = isPlainObject(product.specifications) ? product.specifications : {};
  const pageCount = Number(source.pageCount);

  return {
    pageCount: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null,
    pageCountUnit: normalizeString(source.pageCountUnit),
    binding: normalizeString(source.binding || product.binding),
    language: normalizeString(source.language || product.language),
    languageType: normalizeString(source.languageType),
    publicationDate: source.publicationDate === null
      ? null
      : normalizeString(source.publicationDate) || null
  };
}

function normalizeStoredClassification(product = {}) {
  const source = isPlainObject(product.classification) ? product.classification : {};
  return {
    bisacCode: normalizeString(source.bisacCode).toUpperCase(),
    subjectCode: normalizeString(source.subjectCode).toUpperCase(),
    subjectCodeType: normalizeString(source.subjectCodeType).toUpperCase()
  };
}

function isValidPublicationDate(value) {
  if (/^\d{4}$/.test(value)) return true;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return true;

  const match = value.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function collectStructuredPatch(input = {}, containerName, fields) {
  const nested = input[containerName];
  if (nested !== undefined && !isPlainObject(nested)) {
    throw createProductWorkspaceError(
      `${containerName} must be an object`,
      400,
      `invalid_${containerName}`
    );
  }

  const patch = {};
  for (const field of fields) {
    if (isPlainObject(nested) && hasOwn(nested, field)) patch[field] = nested[field];
    if (hasOwn(input, field)) patch[field] = input[field];
  }
  return patch;
}

function applySpecificationPatch(current, patch) {
  const next = { ...current };

  for (const [field, value] of Object.entries(patch)) {
    if (field === "pageCount") {
      if (value === null || value === "") {
        next.pageCount = null;
      } else if (!Number.isInteger(value) || value <= 0) {
        throw createProductWorkspaceError(
          "pageCount must be a positive integer or null",
          400,
          "invalid_page_count"
        );
      } else {
        next.pageCount = value;
      }
      continue;
    }

    if (field === "publicationDate") {
      if (value === null || value === "") {
        next.publicationDate = null;
      } else if (typeof value !== "string" || !isValidPublicationDate(value.trim())) {
        throw createProductWorkspaceError(
          "publicationDate must be YYYY, YYYY-MM, YYYY-MM-DD, or null",
          400,
          "invalid_publication_date"
        );
      } else {
        next.publicationDate = value.trim();
      }
      continue;
    }

    if (value !== null && typeof value !== "string") {
      throw createProductWorkspaceError(`${field} must be a string or null`, 400, `invalid_${field}`);
    }
    next[field] = normalizeString(value);
  }

  return next;
}

function applyClassificationPatch(current, patch) {
  const next = { ...current };
  for (const [field, value] of Object.entries(patch)) {
    if (value !== null && typeof value !== "string") {
      throw createProductWorkspaceError(`${field} must be a string or null`, 400, `invalid_${field}`);
    }
    next[field] = normalizeString(value).toUpperCase();
  }
  return next;
}

function normalizeVariant(input = {}, index = 0) {
  if (!isPlainObject(input)) {
    throw createProductWorkspaceError("Variant must be an object", 400, "invalid_variant", { index });
  }

  const title = normalizeString(input.title || input.variantTitle || input.optionSummary || input.name);
  const variantId = normalizeString(input.variantId || input.shopifyVariantId || input.id);
  const optionSummary = normalizeString(input.optionSummary || input.options || input.variant || title);
  const identifiers = normalizeIdentifiers({
    ...(isPlainObject(input.identifiers) ? input.identifiers : {}),
    bheSku: input.bheSku || input.sku || input.SKU,
    isbn10: input.isbn10 || input.ISBN10,
    isbn13: input.isbn13 || input.ISBN13 || input.isbn,
    upc: input.upc || input.UPC,
    gtin: input.gtin || input.GTIN,
    amazonAsin: input.amazonAsin || input.asin || input.ASIN,
    manufacturerPartNumber: input.manufacturerPartNumber || input.mpn || input.MPN,
    shopifyVariantId: input.shopifyVariantId || variantId,
    ebayItemNumber: input.ebayItemNumber || input.ebayItemId,
    sourceSku: input.currentSku || input.sourceSku,
    legacySku: input.legacySku
  });
  const sku = normalizeString(input.sku || input.bheSku || identifiers.bheSku);

  return {
    variantId,
    title,
    optionSummary,
    sku,
    identifiers: {
      ...identifiers,
      bheSku: identifiers.bheSku || sku
    },
    status: normalizeString(input.status) || "active",
    notes: normalizeString(input.notes)
  };
}

function buildProductSearchText(product = {}) {
  const authors = Array.isArray(product.authors) ? product.authors : [];
  const collections = Array.isArray(product.organization?.collections) ? product.organization.collections : [];
  const tags = Array.isArray(product.organization?.tags) ? product.organization.tags : [];
  const identifiers = normalizeIdentifiers(product.identifiers);
  const specifications = normalizeStoredSpecifications(product);
  const classification = normalizeStoredClassification(product);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variantText = variants.flatMap((variant) => [
    variant.title,
    variant.optionSummary,
    variant.sku,
    ...Object.values(normalizeIdentifiers(variant.identifiers))
  ]);

  return [
    product.slug || "",
    product.title || "",
    product.subtitle || "",
    product.productType || "",
    product.series || "",
    product.language || "",
    product.binding || "",
    product.content?.urlHandle || "",
    product.content?.shortDescription || "",
    product.content?.mainDescription || "",
    ...authors,
    ...collections,
    ...tags,
    ...Object.values(identifiers),
    ...Object.values(specifications).map((value) => value ?? ""),
    ...Object.values(classification),
    ...variantText
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getProductsCollection(deps = {}) {
  const collection = deps.productsCollection;
  if (!collection || typeof collection.doc !== "function") {
    throw createProductWorkspaceError(
      "Products collection is not configured",
      500,
      "products_collection_not_configured"
    );
  }
  return collection;
}

function getProductWorkspaceConfigCollection(deps = {}) {
  const collection = deps.productWorkspaceConfigCollection;
  if (!collection || typeof collection.doc !== "function") {
    throw createProductWorkspaceError(
      "Product workspace config collection is not configured",
      500,
      "product_workspace_config_not_configured"
    );
  }
  return collection;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return cloneJson(base);
  const merged = cloneJson(base);

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

async function getProductWorkspaceConfig(input = {}, deps = {}) {
  const configId = normalizeString(input.configId) || "default";
  const configCollection = deps.productWorkspaceConfigCollection;
  if (!configCollection || typeof configCollection.doc !== "function") {
    return {
      configId,
      source: "backend-defaults",
      config: cloneJson(DEFAULT_PRODUCT_WORKSPACE_CONFIG)
    };
  }
  const doc = await configCollection.doc(configId).get();
  const storedConfig = doc.exists ? doc.data() || {} : {};
  const config = deepMerge(DEFAULT_PRODUCT_WORKSPACE_CONFIG, storedConfig);

  return {
    configId,
    source: doc.exists ? "firestore" : "backend-defaults",
    config
  };
}

function validateConfigPatch(patch) {
  if (!isPlainObject(patch)) {
    throw createProductWorkspaceError("Config patch must be an object", 400, "invalid_config_patch");
  }
  if (patch.allowedValues !== undefined && !isPlainObject(patch.allowedValues)) {
    throw createProductWorkspaceError("allowedValues must be an object", 400, "invalid_allowed_values");
  }
  if (patch.skuPolicy !== undefined && !isPlainObject(patch.skuPolicy)) {
    throw createProductWorkspaceError("skuPolicy must be an object", 400, "invalid_sku_policy");
  }
  if (patch.marketplaceRules !== undefined && !isPlainObject(patch.marketplaceRules)) {
    throw createProductWorkspaceError("marketplaceRules must be an object", 400, "invalid_marketplace_rules");
  }
  if (patch.importMappings !== undefined && !isPlainObject(patch.importMappings)) {
    throw createProductWorkspaceError("importMappings must be an object", 400, "invalid_import_mappings");
  }
}

async function updateProductWorkspaceConfig(input = {}, deps = {}) {
  const configId = normalizeString(input.configId) || "default";
  const patch = input.patch;
  validateConfigPatch(patch);

  const configCollection = getProductWorkspaceConfigCollection(deps);
  const docRef = configCollection.doc(configId);
  const existing = await getProductWorkspaceConfig({ configId }, deps);
  const now = getNowIso(deps);
  const updatedConfig = deepMerge(existing.config, {
    ...patch,
    updatedAt: now,
    updatedBy: normalizeString(input.updatedBy) || "product-workspace"
  });

  if (input.dryRun === true) {
    return {
      dryRun: true,
      configId,
      source: existing.source,
      config: updatedConfig
    };
  }

  await docRef.set(updatedConfig, { merge: false });
  return {
    dryRun: false,
    configId,
    source: "firestore",
    config: updatedConfig
  };
}

async function seedProductWorkspaceConfig(input = {}, deps = {}) {
  const configId = normalizeString(input.configId) || "default";
  const configCollection = getProductWorkspaceConfigCollection(deps);
  const docRef = configCollection.doc(configId);
  const existingDoc = await docRef.get();

  if (existingDoc.exists && input.overwrite !== true) {
    return {
      seeded: false,
      configId,
      reason: "config_exists",
      config: deepMerge(DEFAULT_PRODUCT_WORKSPACE_CONFIG, existingDoc.data() || {})
    };
  }

  const now = getNowIso(deps);
  const config = {
    ...cloneJson(DEFAULT_PRODUCT_WORKSPACE_CONFIG),
    createdAt: existingDoc.exists ? existingDoc.data()?.createdAt || now : now,
    updatedAt: now,
    updatedBy: normalizeString(input.updatedBy) || "product-workspace"
  };

  if (input.dryRun === true) {
    return {
      seeded: false,
      dryRun: true,
      configId,
      config
    };
  }

  await docRef.set(config, { merge: false });
  return {
    seeded: true,
    dryRun: false,
    configId,
    config
  };
}

async function getProductDoc(productsCollection, slug) {
  const cleanSlug = normalizeString(slug);
  if (!isValidSlug(cleanSlug)) {
    throw createProductWorkspaceError("Invalid product slug", 400, "invalid_slug", { slug });
  }

  const docRef = productsCollection.doc(cleanSlug);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw createProductWorkspaceError("Product not found", 404, "product_not_found", { slug: cleanSlug });
  }

  return { docRef, product: { ...(doc.data() || {}), slug: (doc.data() || {}).slug || cleanSlug } };
}

function buildProductSummary(product = {}, fallbackSlug = "") {
  const identifiers = normalizeIdentifiers(product.identifiers);
  return {
    slug: product.slug || fallbackSlug,
    title: product.title || "",
    subtitle: product.subtitle || "",
    productType: product.productType || "",
    status: product.status || "",
    bheSku: identifiers.bheSku || product.bheSku || "",
    isbn10: identifiers.isbn10 || product.isbn10 || "",
    isbn13: identifiers.isbn13 || product.isbn13 || "",
    manufacturerPartNumber: identifiers.manufacturerPartNumber || "",
    variantCount: Array.isArray(product.variants) ? product.variants.length : 0,
    updatedAt: product.updatedAt || ""
  };
}

async function fetchProductDocs(productsCollection, limit = 500) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const snapshot = await productsCollection.limit(safeLimit).get();
  return snapshot.docs.map((doc) => ({
    doc,
    slug: doc.id,
    product: { ...(doc.data() || {}), slug: (doc.data() || {}).slug || doc.id }
  }));
}

async function listProducts(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const docs = await fetchProductDocs(productsCollection, input.scanLimit || 500);
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
  const status = normalizeString(input.status);
  const productType = normalizeString(input.productType).toLowerCase();
  const products = docs
    .map(({ product, slug }) => buildProductSummary(product, slug))
    .filter((product) => !status || product.status === status)
    .filter((product) => !productType || product.productType.toLowerCase() === productType)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, limit);

  return { count: products.length, products };
}

async function searchProducts(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const query = normalizeString(input.query).toLowerCase();
  if (!query) {
    throw createProductWorkspaceError("Search query is required", 400, "missing_query");
  }

  const tokens = query.split(/\s+/).filter(Boolean);
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const docs = await fetchProductDocs(productsCollection, input.scanLimit || 500);
  const results = docs
    .map(({ product, slug }) => {
      const searchText = normalizeString(product.searchText) || buildProductSearchText(product);
      const matchedTokenCount = tokens.filter((token) => searchText.includes(token)).length;
      return {
        ...buildProductSummary(product, slug),
        _score: matchedTokenCount
      };
    })
    .filter((item) => item._score > 0)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    })
    .slice(0, limit)
    .map(({ _score, ...item }) => item);

  return { query, count: results.length, results };
}

async function getProduct(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const { product } = await getProductDoc(productsCollection, input.slug);
  return { product };
}

function getTypeCode(productType = "", config = DEFAULT_PRODUCT_WORKSPACE_CONFIG) {
  const codes = isPlainObject(config.skuPolicy?.productTypeCodes)
    ? config.skuPolicy.productTypeCodes
    : PRODUCT_TYPE_CODES;
  return codes[normalizeString(productType)] || slugify(productType).slice(0, 2).toUpperCase() || "PR";
}

function findWorkCode(text = "", config = DEFAULT_PRODUCT_WORKSPACE_CONFIG) {
  const cleanText = normalizeString(text).toLowerCase();
  const codes = isPlainObject(config.skuPolicy?.workCodes) ? config.skuPolicy.workCodes : WORK_CODES;
  for (const [needle, code] of Object.entries(codes)) {
    if (cleanText.includes(needle)) return code;
  }
  return slugify(cleanText).split("-").find((part) => part.length >= 3)?.slice(0, 3).toUpperCase() || "GEN";
}

function findYear(text = "") {
  const match = normalizeString(text).match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? match[1] : "0000";
}

function findEditionCode(text = "", config = DEFAULT_PRODUCT_WORKSPACE_CONFIG) {
  const cleanText = normalizeString(text).toLowerCase();
  const codes = isPlainObject(config.skuPolicy?.editionCodes) ? config.skuPolicy.editionCodes : EDITION_CODES;
  for (const [needle, code] of Object.entries(codes)) {
    if (cleanText.includes(needle)) return code;
  }
  return "STD";
}

async function collectSkuConflicts(productsCollection, candidateSku, currentSlug = "") {
  const cleanSku = normalizeString(candidateSku).toUpperCase();
  if (!cleanSku) return [];

  const docs = await fetchProductDocs(productsCollection, 1000);
  const conflicts = [];
  for (const { product, slug } of docs) {
    if (slug === currentSlug) continue;
    const productSku = normalizeIdentifiers(product.identifiers).bheSku.toUpperCase();
    if (productSku === cleanSku) {
      conflicts.push({ slug, title: product.title || "", field: "identifiers.bheSku" });
    }
    for (const [index, variant] of (Array.isArray(product.variants) ? product.variants : []).entries()) {
      const variantSku = normalizeString(variant.sku || variant.identifiers?.bheSku).toUpperCase();
      if (variantSku === cleanSku) {
        conflicts.push({ slug, title: product.title || "", field: `variants[${index}].sku` });
      }
    }
  }
  return conflicts;
}

async function suggestSku(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const { config } = await getProductWorkspaceConfig({}, deps);
  let product = {};
  let slug = normalizeString(input.slug);

  if (slug) {
    ({ product } = await getProductDoc(productsCollection, slug));
  } else {
    product = {
      title: normalizeString(input.title),
      productType: normalizeString(input.productType),
      binding: normalizeString(input.binding)
    };
    slug = slugify(product.title);
  }

  const titleText = [
    product.title,
    product.subtitle,
    product.series,
    product.binding,
    input.variant,
    input.edition
  ].join(" ");
  const typeCode = getTypeCode(input.productType || product.productType, config);
  const workCode = normalizeString(input.workCode).toUpperCase() || findWorkCode(titleText, config);
  const year = normalizeString(input.year) || findYear(titleText);
  const editionCode = normalizeString(input.editionCode).toUpperCase() || findEditionCode(titleText, config);
  const candidateSku = `BHE-${typeCode}-${workCode}-${year}-${editionCode}`;
  const conflicts = await collectSkuConflicts(productsCollection, candidateSku, slug);

  return {
    sku: candidateSku,
    available: conflicts.length === 0,
    conflicts,
    basis: {
      typeCode,
      workCode,
      year,
      editionCode
    },
    warning: year === "0000"
      ? "No historical year was detected; review the SKU before assignment."
      : ""
  };
}

async function assignSku(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const slug = normalizeString(input.slug);
  const sku = normalizeString(input.bheSku || input.sku).toUpperCase();
  if (!sku) {
    throw createProductWorkspaceError("BHE SKU is required", 400, "missing_bhe_sku");
  }
  if (!/^BHE-[A-Z0-9]+-[A-Z0-9]+-[0-9]{4}-[A-Z0-9]+$/.test(sku)) {
    throw createProductWorkspaceError(
      "BHE SKU must follow BHE-[TYPE]-[WORK]-[YEAR]-[EDITION]",
      400,
      "invalid_bhe_sku",
      { sku }
    );
  }

  const { docRef, product } = await getProductDoc(productsCollection, slug);
  const conflicts = await collectSkuConflicts(productsCollection, sku, slug);
  if (conflicts.length > 0 && input.allowDuplicate !== true) {
    throw createProductWorkspaceError("BHE SKU is already assigned", 409, "duplicate_bhe_sku", { sku, conflicts });
  }

  const identifiers = mergeIdentifiers(product.identifiers, {
    bheSku: sku,
    manufacturerPartNumber: input.manufacturerPartNumber || sku
  });
  const updatedAt = getNowIso(deps);
  const updates = {
    identifiers,
    bheSku: sku,
    isbn10: identifiers.isbn10 || product.isbn10 || "",
    isbn13: identifiers.isbn13 || product.isbn13 || "",
    updatedAt
  };
  updates.searchText = buildProductSearchText({ ...product, ...updates });

  await docRef.update(updates);
  return { slug, bheSku: sku, identifiers };
}

async function updateMarketplaceIdentifiers(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const slug = normalizeString(input.slug);
  const { docRef, product } = await getProductDoc(productsCollection, slug);
  const identifiers = mergeIdentifiers(product.identifiers, {
    ...(isPlainObject(input.identifiers) ? input.identifiers : {}),
    upc: input.upc,
    gtin: input.gtin,
    amazonAsin: input.amazonAsin,
    manufacturerPartNumber: input.manufacturerPartNumber,
    shopifyProductId: input.shopifyProductId,
    shopifyVariantId: input.shopifyVariantId,
    ebayItemNumber: input.ebayItemNumber,
    isbn10: input.isbn10,
    isbn13: input.isbn13
  });
  const updatedAt = getNowIso(deps);
  const updates = {
    identifiers,
    isbn10: identifiers.isbn10 || product.isbn10 || "",
    isbn13: identifiers.isbn13 || product.isbn13 || "",
    updatedAt
  };
  updates.searchText = buildProductSearchText({ ...product, ...updates });

  await docRef.update(updates);
  return { slug, identifiers };
}

async function updateProductSpecifications(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const slug = normalizeString(input.slug);
  const { docRef, product } = await getProductDoc(productsCollection, slug);
  const specificationPatch = collectStructuredPatch(input, "specifications", SPECIFICATION_FIELDS);
  const classificationPatch = collectStructuredPatch(input, "classification", CLASSIFICATION_FIELDS);
  const hasAuthors = hasOwn(input, "authors");

  if (Object.keys(specificationPatch).length === 0 && Object.keys(classificationPatch).length === 0 && !hasAuthors) {
    throw createProductWorkspaceError(
      "At least one specification, classification, or author update is required",
      400,
      "missing_specification_updates"
    );
  }

  const specifications = applySpecificationPatch(
    normalizeStoredSpecifications(product),
    specificationPatch
  );
  const classification = applyClassificationPatch(
    normalizeStoredClassification(product),
    classificationPatch
  );
  let authors = Array.isArray(product.authors) ? product.authors : [];

  if (hasAuthors) {
    if (!Array.isArray(input.authors) || !input.authors.every((author) => typeof author === "string")) {
      throw createProductWorkspaceError("authors must be an array of strings", 400, "invalid_authors");
    }
    authors = input.authors.map(normalizeString).filter(Boolean);
  }

  const updatedAt = getNowIso(deps);
  const updates = {
    specifications,
    classification,
    authors,
    binding: specifications.binding,
    language: specifications.language,
    updatedAt
  };
  updates.searchText = buildProductSearchText({ ...product, ...updates });

  await docRef.update(updates);
  return { slug, authors, specifications, classification, updatedAt };
}

function normalizeImportRecord(record = {}, index = 0) {
  if (!isPlainObject(record)) {
    throw createProductWorkspaceError("Import record must be an object", 400, "invalid_import_record", { index });
  }

  const title = normalizeString(record.title || record.productTitle || record["Title"]);
  const handle = normalizeString(record.shopifyHandle || record.handle || record["Handle"]);
  const slug = normalizeString(record.slug) || slugify(handle || title);
  if (!title && !slug) {
    throw createProductWorkspaceError("Import record requires title, slug, or Shopify handle", 400, "missing_import_identity", { index });
  }
  if (!isValidSlug(slug)) {
    throw createProductWorkspaceError("Import record has invalid slug", 400, "invalid_import_slug", { index, slug });
  }

  const productType = normalizeString(record.productType || record.type || record["Type"]) || "Book";
  const identifiers = normalizeIdentifiers({
    ...(isPlainObject(record.identifiers) ? record.identifiers : {}),
    bheSku: record.bheSku || record.sku || record.SKU,
    isbn10: record.isbn10 || record.ISBN10,
    isbn13: record.isbn13 || record.ISBN13 || record.isbn,
    upc: record.upc || record.UPC,
    gtin: record.gtin || record.GTIN,
    amazonAsin: record.amazonAsin || record.asin || record.ASIN,
    manufacturerPartNumber: record.manufacturerPartNumber || record.mpn || record.MPN,
    shopifyProductId: record.shopifyProductId || record.productId,
    shopifyVariantId: record.shopifyVariantId || record.variantId,
    ebayItemNumber: record.ebayItemNumber || record.ebayItemId,
    sourceSku: record.currentSku || record.sourceSku,
    legacySku: record.legacySku
  });
  const variants = Array.isArray(record.variants)
    ? record.variants.map(normalizeVariant)
    : [];

  return {
    slug,
    title: title || slug,
    subtitle: normalizeString(record.subtitle),
    productType,
    status: normalizeString(record.status) || "draft",
    binding: normalizeString(record.binding),
    identifiers,
    variants,
    shopifyHandle: handle,
    notes: normalizeString(record.notes)
  };
}

async function importProductRegister(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const records = Array.isArray(input.records) ? input.records : [];
  if (records.length === 0) {
    throw createProductWorkspaceError("Product register import requires records", 400, "missing_import_records");
  }
  if (records.length > 500) {
    throw createProductWorkspaceError("Product register import is limited to 500 records per call", 400, "too_many_import_records");
  }

  const dryRun = input.dryRun === true;
  const now = getNowIso(deps);
  const results = [];
  const errors = [];

  for (let index = 0; index < records.length; index += 1) {
    try {
      const normalized = normalizeImportRecord(records[index], index);
      const docRef = productsCollection.doc(normalized.slug);
      const existingDoc = await docRef.get();
      const existingProduct = existingDoc.exists ? existingDoc.data() || {} : {};
      const identifiers = mergeIdentifiers(existingProduct.identifiers, normalized.identifiers);
      const existingVariants = Array.isArray(existingProduct.variants) ? existingProduct.variants : [];
      const variants = normalized.variants.length > 0 ? normalized.variants : existingVariants;
      const product = {
        ...existingProduct,
        slug: normalized.slug,
        title: normalized.title || existingProduct.title || normalized.slug,
        subtitle: normalized.subtitle || existingProduct.subtitle || "",
        productType: normalized.productType || existingProduct.productType || "Book",
        status: normalized.status || existingProduct.status || "draft",
        language: existingProduct.language || "English",
        binding: normalized.binding || existingProduct.binding || "",
        identifiers,
        bheSku: identifiers.bheSku || existingProduct.bheSku || "",
        isbn10: identifiers.isbn10 || existingProduct.isbn10 || "",
        isbn13: identifiers.isbn13 || existingProduct.isbn13 || "",
        variants,
        marketplace: {
          ...(isPlainObject(existingProduct.marketplace) ? existingProduct.marketplace : {}),
          shopifyHandle: normalized.shopifyHandle || existingProduct.marketplace?.shopifyHandle || "",
          importedFrom: normalizeString(input.sourceName) || existingProduct.marketplace?.importedFrom || "product-register"
        },
        content: {
          ...(isPlainObject(existingProduct.content) ? existingProduct.content : {}),
          urlHandle: normalized.shopifyHandle || existingProduct.content?.urlHandle || normalized.slug
        },
        importNotes: normalized.notes || existingProduct.importNotes || "",
        createdAt: existingProduct.createdAt || now,
        updatedAt: now
      };
      product.searchText = buildProductSearchText(product);

      if (!dryRun) {
        await docRef.set(product, { merge: true });
      }

      results.push({
        index,
        slug: normalized.slug,
        title: product.title,
        action: existingDoc.exists ? "updated" : "created",
        bheSku: identifiers.bheSku,
        isbn13: identifiers.isbn13,
        variantCount: variants.length
      });
    } catch (error) {
      errors.push({
        index,
        code: error?.code || "import_record_failed",
        message: error?.message || "Import record failed",
        details: error?.details || {}
      });
    }
  }

  return {
    dryRun,
    requestedCount: records.length,
    importedCount: dryRun ? 0 : results.length,
    plannedCount: dryRun ? results.length : 0,
    errorCount: errors.length,
    results,
    errors
  };
}

async function auditProductIdentifiers(input = {}, deps = {}) {
  const productsCollection = getProductsCollection(deps);
  const docs = await fetchProductDocs(productsCollection, input.scanLimit || 1000);
  const skuMap = new Map();
  const isbnMap = new Map();
  const findings = [];

  for (const { product, slug } of docs) {
    const identifiers = normalizeIdentifiers(product.identifiers);
    if (!identifiers.bheSku) {
      findings.push({ severity: "warning", slug, code: "missing_bhe_sku", message: "Product is missing a permanent BHE SKU." });
    }
    if (!identifiers.isbn13 && !identifiers.upc && !identifiers.gtin) {
      findings.push({ severity: "info", slug, code: "missing_external_identifier", message: "Product has no ISBN-13, UPC, or GTIN on record." });
    }
    if (identifiers.bheSku) {
      const key = identifiers.bheSku.toUpperCase();
      skuMap.set(key, [...(skuMap.get(key) || []), { slug, title: product.title || "" }]);
    }
    if (identifiers.isbn13) {
      const key = identifiers.isbn13.replace(/\D/g, "");
      isbnMap.set(key, [...(isbnMap.get(key) || []), { slug, title: product.title || "" }]);
    }
  }

  for (const [sku, matches] of skuMap.entries()) {
    if (matches.length > 1) {
      findings.push({ severity: "error", code: "duplicate_bhe_sku", sku, matches });
    }
  }
  for (const [isbn13, matches] of isbnMap.entries()) {
    if (isbn13 && matches.length > 1) {
      findings.push({ severity: "warning", code: "duplicate_isbn13", isbn13, matches });
    }
  }

  return {
    scannedCount: docs.length,
    findingCount: findings.length,
    findings
  };
}

module.exports = {
  CLASSIFICATION_FIELDS,
  DEFAULT_PRODUCT_WORKSPACE_CONFIG,
  IDENTIFIER_FIELDS,
  SPECIFICATION_FIELDS,
  auditProductIdentifiers,
  assignSku,
  buildProductSearchText,
  buildProductSummary,
  createProductWorkspaceError,
  getProduct,
  getProductWorkspaceConfig,
  importProductRegister,
  listProducts,
  normalizeIdentifiers,
  normalizeStoredClassification,
  normalizeStoredSpecifications,
  searchProducts,
  seedProductWorkspaceConfig,
  suggestSku,
  updateProductWorkspaceConfig,
  updateMarketplaceIdentifiers,
  updateProductSpecifications
};
