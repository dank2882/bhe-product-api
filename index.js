const express = require("express");
const multer = require("multer");
const { createHash, randomUUID } = require("node:crypto");
const { Firestore } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const { v1: DocumentAi } = require("@google-cloud/documentai");
const {
  buildCanonicalSongsFromCsv,
  buildSongId,
  importCanonicalSongsToCollection,
  looseNormalizeTitle,
  parseSongCatalogCsv,
  strictNormalizeTitle
} = require("./lib/song-catalog-importer");
const {
  getSongById,
  searchSongs,
  updateSongMinistryMetadata
} = require("./lib/song-catalog-service");

const REQUIRED_ENV_VARS = ["BHE_API_KEY", "OPENAI_API_KEY"];
for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const app = express();
app.use(express.json({ limit: "25mb" }));

const BHE_API_KEY = process.env.BHE_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const DOCUMENT_AI_LOCATION = process.env.DOCUMENT_AI_LOCATION || "us";
const DOCUMENT_AI_PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || "";
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || "location-map-985";
const BUCKET_NAME = process.env.BUCKET_NAME || "bhe-product-assets";
const PORT = process.env.PORT || 8080;
const ALLOWED_INTAKE_PURPOSES = [
  "source-document",
  "product-photo",
  "handwritten-note",
  "supporting-reference"
];
const APPROVED_PRODUCT_TYPES = [
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
];
const ALLOWED_REPOSITORY_ITEM_TYPES = [
  "person",
  "topic",
  "edition",
  "event",
  "place",
  "collection",
  "unsorted"
];
const CHAT_VISIBLE_IMAGES_NOT_ATTACHABLE_ERROR =
  "The images were visible in chat, but no backend-uploaded asset references were available, so they could not be attached to the product record.";
const SUPPORTED_ASSET_MIME_TYPES = new Set([
  "application/pdf",
  "image/tiff",
  "image/tif",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp"
]);
const CHAT_VISIBLE_IMAGE_SOURCE = "chat_visible_image";
const BACKEND_PERSISTED_ASSET_SOURCE = "backend_persisted_asset";
const DEFAULT_ASSET_UPLOAD_SOURCE = "openai_file_ref";


app.use((req, res, next) => {
  const isPublicPath = req.path === "/" || req.path === "/health";

  if (isPublicPath) {
    return next();
  }

  if (!BHE_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "BHE_API_KEY is not configured"
    });
  }

  const incomingApiKey = req.header("x-api-key") || "";

  if (incomingApiKey !== BHE_API_KEY) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  return next();
});

const db = new Firestore({
  projectId: "location-map-985",
  databaseId: "chatgptstorage"
});

const storage = new Storage({
  projectId: "location-map-985"
});

const documentAiClient = new DocumentAi.DocumentProcessorServiceClient({
  apiEndpoint: `${DOCUMENT_AI_LOCATION}-documentai.googleapis.com`
});

const productsCollection = db.collection("products");
const assetLibraryCollection = db.collection("productAssetLibrary");
const repositoryDocumentsCollection = db.collection("repositoryDocuments");
const repositoryItemsCollection = db.collection("repositoryItems");
const songsCollection = db.collection("songs");
const songMetadataAuditCollection = db.collection("songMetadataAudit");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});
function buildDefaultProduct({ slug, title, productType }) {
  return {
    slug,
    title,
    subtitle: "",
    productType,
    status: "draft",

    authors: [],
    series: null,
    language: "English",
    isbn10: "",
    isbn13: "",

    binding: "",
    dimensions: {
      depthIn: 0,
      heightIn: 0,
      thicknessIn: 0
    },
    weightLb: 0,

    pricing: {
      retailPrice: 0,
      storePrice: 0,
      costPerItem: 0
    },

    organization: {
      collections: [],
      tags: [],
      genre: "",
      targetAudience: "Adults",
      vendor: "Biblical Heritage Exhibit",
      category: "Media > Books > Print Books"
    },

    content: {
      shortDescription: "",
      mainDescription: "",
      featureBullets: [],
      seoTitle: "",
      metaDescription: "",
      urlHandle: slug
    },

    mediaNotes: {
      videoEmphasis: "",
      requiredPhotoVideoFeatures: [],
      photoLibraryUrl: ""
    },

    assets: {
      sourceFiles: [],
      imagesRaw: [],
      imagesEdited: [],
      exports: []
    },

    ocr: {
      status: "not_started",
      documents: []
    },

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function isValidFilename(filename) {
  return /^[a-zA-Z0-9._-]+$/.test(filename);
}

function getAssetFolder(assetType) {
  const folderMap = {
    sourceFiles: "source",
    imagesRaw: "images/raw",
    imagesEdited: "images/edited",
    exports: "exports"
  };

  return folderMap[assetType] || null;
}

function getAssetArrayPath(assetType) {
  const allowedTypes = ["sourceFiles", "imagesRaw", "imagesEdited", "exports"];
  return allowedTypes.includes(assetType) ? `assets.${assetType}` : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createWorkflowError(message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function getErrorStatusCode(error, fallbackStatusCode = 500) {
  return Number.isInteger(error?.statusCode) ? error.statusCode : fallbackStatusCode;
}

function buildStructuredErrorResponse(
  error,
  {
    fallbackCode = "internal_error",
    fallbackMessage = "Internal server error"
  } = {}
) {
  const response = {
    ok: false,
    error: {
      code:
        typeof error?.code === "string" && error.code.trim()
          ? error.code.trim()
          : fallbackCode,
      message:
        typeof error?.message === "string" && error.message.trim()
          ? error.message.trim()
          : fallbackMessage
    }
  };

  if (error?.details && typeof error.details === "object" && Object.keys(error.details).length > 0) {
    response.error.details = error.details;
  }

  return response;
}

function redactHeaderValue(headerName, value) {
  if (typeof value !== "string") {
    return value;
  }

  const normalizedName = headerName.toLowerCase();

  if (["authorization", "x-api-key", "cookie"].includes(normalizedName)) {
    return "[redacted]";
  }

  return value;
}

function getRelevantRequestHeaders(headers = {}) {
  const relevantHeaders = {};

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const normalizedName = headerName.toLowerCase();
    const shouldInclude =
      normalizedName === "content-type" ||
      normalizedName === "content-length" ||
      normalizedName === "user-agent" ||
      normalizedName === "host" ||
      normalizedName.startsWith("x-openai") ||
      normalizedName.startsWith("openai-") ||
      normalizedName.startsWith("x-forwarded-") ||
      normalizedName === "authorization" ||
      normalizedName === "x-api-key";

    if (!shouldInclude) {
      continue;
    }

    relevantHeaders[headerName] = Array.isArray(headerValue)
      ? headerValue.map((item) => redactHeaderValue(headerName, item))
      : redactHeaderValue(headerName, headerValue);
  }

  return relevantHeaders;
}

function getValueType(value) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function buildFileHandoffDiagnosticSummary(req) {
  const body = req.body;
  const bodyIsPlainObject = isPlainObject(body);
  const topLevelBodyKeys = bodyIsPlainObject ? Object.keys(body) : [];
  const hasOpenAiFileIdRefs =
    bodyIsPlainObject && Object.prototype.hasOwnProperty.call(body, "openaiFileIdRefs");
  const openaiFileIdRefs = hasOpenAiFileIdRefs ? body.openaiFileIdRefs : undefined;
  const openaiFileIdRefsIsArray = Array.isArray(openaiFileIdRefs);
  const firstElement = openaiFileIdRefsIsArray && openaiFileIdRefs.length > 0
    ? openaiFileIdRefs[0]
    : undefined;

  return {
    source: "cloud_run_action_payload",
    receivedAt: getNowIso(),
    method: req.method,
    path: req.path,
    contentType: req.get("content-type") || "",
    bodyRootType: getValueType(body),
    topLevelBodyKeys,
    topLevelBodyValueTypes: bodyIsPlainObject
      ? Object.fromEntries(
          Object.entries(body).map(([key, value]) => [key, getValueType(value)])
        )
      : {},
    openaiFileIdRefsPresent: hasOpenAiFileIdRefs,
    openaiFileIdRefsIsArray,
    openaiFileIdRefsLength: openaiFileIdRefsIsArray ? openaiFileIdRefs.length : 0,
    firstElementType: getValueType(firstElement),
    firstElementKeys: isPlainObject(firstElement) ? Object.keys(firstElement) : [],
    firstElementPreview:
      firstElement === undefined
        ? null
        : isPlainObject(firstElement) || Array.isArray(firstElement)
          ? firstElement
          : String(firstElement),
    relevantHeaders: getRelevantRequestHeaders(req.headers || {})
  };
}

function getDefaultOcrBlock() {
  return {
    status: "not_started",
    documents: []
  };
}

function getSafeAssets(product = {}) {
  const assets = product.assets || {};

  return {
    sourceFiles: Array.isArray(assets.sourceFiles) ? assets.sourceFiles : [],
    imagesRaw: Array.isArray(assets.imagesRaw) ? assets.imagesRaw : [],
    imagesEdited: Array.isArray(assets.imagesEdited) ? assets.imagesEdited : [],
    exports: Array.isArray(assets.exports) ? assets.exports : []
  };
}

function findRegisteredAsset(product, assetType, storagePath, filename) {
  const cleanAssetType =
    typeof assetType === "string" && assetType.trim() ? assetType.trim() : "";
  const cleanStoragePath =
    typeof storagePath === "string" && storagePath.trim() ? storagePath.trim() : "";
  const cleanFilename =
    typeof filename === "string" && filename.trim() ? filename.trim() : "";

  if (!cleanAssetType || !cleanStoragePath || !cleanFilename) {
    return null;
  }

  const assets = getSafeAssets(product);
  const assetList = Array.isArray(assets[cleanAssetType]) ? assets[cleanAssetType] : [];

  return assetList.find(
    (asset) =>
      asset &&
      asset.storagePath === cleanStoragePath &&
      asset.filename === cleanFilename
  ) || null;
}

function isAllowedOcrAssetType(assetType) {
  return ["sourceFiles", "imagesRaw", "imagesEdited", "exports"].includes(assetType);
}

function getOcrModeForMimeType(mimeType) {
  if (mimeType === "application/pdf") {
    return "document_ai_pdf";
  }

  if (mimeType === "image/tiff") {
    return "document_ai_tiff";
  }

  if (mimeType.startsWith("image/")) {
    return "document_ai_image";
  }

  return "document_ai_generic";
}

function computeOverallOcrStatus(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return "not_started";
  }

  if (documents.some((doc) => doc.status === "processing")) {
    return "processing";
  }

  if (documents.some((doc) => doc.status === "failed")) {
    return "failed";
  }

  if (documents.every((doc) => doc.status === "completed")) {
    return "completed";
  }

  if (documents.some((doc) => doc.status === "queued")) {
    return "queued";
  }

  return "not_started";
}

function getRawOcrOutputPath(slug, sourceFilename) {
  const base = sourceFilename.replace(/\.[^.]+$/, "");
  return `products/${slug}/ocr/raw/${base}.json`;
}

function getTextOcrOutputPath(slug, sourceFilename) {
  const base = sourceFilename.replace(/\.[^.]+$/, "");
  return `products/${slug}/ocr/text/${base}.txt`;
}

function getNowIso() {
  return new Date().toISOString();
}

function buildProductListItem(product = {}, fallbackSlug = "") {
  return {
    slug: product.slug || fallbackSlug,
    title: product.title || "",
    subtitle: product.subtitle || "",
    productType: product.productType || "",
    status: product.status || "",
    updatedAt: product.updatedAt || ""
  };
}

function buildSearchText(product = {}) {
  const authors = Array.isArray(product.authors) ? product.authors : [];
  const collections = Array.isArray(product.organization?.collections)
    ? product.organization.collections
    : [];
  const tags = Array.isArray(product.organization?.tags)
    ? product.organization.tags
    : [];
  const featureBullets = Array.isArray(product.content?.featureBullets)
    ? product.content.featureBullets
    : [];

  const ocrDocuments = Array.isArray(product.ocr?.documents) ? product.ocr.documents : [];
  const ocrBestTexts = ocrDocuments
    .map((doc) => (typeof doc?.bestText === "string" ? doc.bestText : ""))
    .filter(Boolean);

  return [
    product.slug || "",
    product.title || "",
    product.subtitle || "",
    product.productType || "",
    product.series || "",
    product.language || "",
    product.content?.shortDescription || "",
    product.content?.mainDescription || "",
    product.content?.seoTitle || "",
    product.content?.metaDescription || "",
    ...authors,
    ...collections,
    ...tags,
    ...featureBullets,
    ...ocrBestTexts
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function applyBestText(record) {
  const now = getNowIso();

  if (record.humanReviewedText && record.humanReviewedText.trim()) {
    return {
      ...record,
      bestText: record.humanReviewedText,
      bestTextSource: "humanReviewedText",
      bestTextUpdatedAt: now
    };
  }

  if (record.aiCorrectedText && record.aiCorrectedText.trim()) {
    return {
      ...record,
      bestText: record.aiCorrectedText,
      bestTextSource: "aiCorrectedText",
      bestTextUpdatedAt: now
    };
  }

  if (record.aiInitialCorrectedText && record.aiInitialCorrectedText.trim()) {
    return {
      ...record,
      bestText: record.aiInitialCorrectedText,
      bestTextSource: "aiInitialCorrectedText",
      bestTextUpdatedAt: now
    };
  }

  if (record.normalizedText && record.normalizedText.trim()) {
    return {
      ...record,
      bestText: record.normalizedText,
      bestTextSource: "normalizedText",
      bestTextUpdatedAt: now
    };
  }

  if (record.cleanedText && record.cleanedText.trim()) {
    return {
      ...record,
      bestText: record.cleanedText,
      bestTextSource: "cleanedText",
      bestTextUpdatedAt: now
    };
  }

  if (record.extractedText && record.extractedText.trim()) {
    return {
      ...record,
      bestText: record.extractedText,
      bestTextSource: "extractedText",
      bestTextUpdatedAt: now
    };
  }

  return {
    ...record,
    bestText: "",
    bestTextSource: "",
    bestTextUpdatedAt: record.bestTextUpdatedAt || ""
  };
}

function withOcrDefaults(record = {}) {
  return {
    assetType: record.assetType || "",
    sourceFilename: record.sourceFilename || "",
    sourceStoragePath: record.sourceStoragePath || "",
    mimeType: record.mimeType || "",
    status: record.status || "",
    ocrProvider: record.ocrProvider || "",
    ocrMode: record.ocrMode || "",
    rawOutputPath: record.rawOutputPath || "",
    textOutputPath: record.textOutputPath || "",
    extractedText: record.extractedText || "",
    pageCount: typeof record.pageCount === "number" ? record.pageCount : 0,
    processedAt: record.processedAt || "",
    error: record.error || "",

    cleanedText: record.cleanedText || "",
    cleanupStatus: record.cleanupStatus || "not_started",
    cleanupProcessedAt: record.cleanupProcessedAt || "",
    cleanupError: record.cleanupError || "",

    normalizedText: record.normalizedText || "",
    normalizationStatus: record.normalizationStatus || "not_started",
    normalizationProcessedAt: record.normalizationProcessedAt || "",
    normalizationError: record.normalizationError || "",

    aiInitialCorrectedText: record.aiInitialCorrectedText || "",
    aiInitialCorrectionStatus: record.aiInitialCorrectionStatus || "not_started",
    aiInitialCorrectionProcessedAt: record.aiInitialCorrectionProcessedAt || "",
    aiInitialCorrectionError: record.aiInitialCorrectionError || "",

    aiCorrectedText: record.aiCorrectedText || "",
    aiCorrectionStatus: record.aiCorrectionStatus || "not_started",
    aiCorrectionProcessedAt: record.aiCorrectionProcessedAt || "",
    aiCorrectionError: record.aiCorrectionError || "",

    humanReviewedText: record.humanReviewedText || "",

    bestText: record.bestText || "",
    bestTextSource: record.bestTextSource || "",
    bestTextUpdatedAt: record.bestTextUpdatedAt || ""
  };
}

function getCleanupSourceText(record = {}) {
  return (
    (record.aiInitialCorrectedText && record.aiInitialCorrectedText.trim()) ||
    (record.extractedText && record.extractedText.trim()) ||
    ""
  );
}

function getNormalizationSourceText(record = {}) {
  return (
    (record.cleanedText && record.cleanedText.trim()) ||
    (record.aiInitialCorrectedText && record.aiInitialCorrectedText.trim()) ||
    (record.extractedText && record.extractedText.trim()) ||
    ""
  );
}

function getFinalAiCorrectionSourceText(record = {}) {
  return (
    (record.normalizedText && record.normalizedText.trim()) ||
    (record.cleanedText && record.cleanedText.trim()) ||
    (record.aiInitialCorrectedText && record.aiInitialCorrectedText.trim()) ||
    (record.extractedText && record.extractedText.trim()) ||
    ""
  );
}

function buildSourceTextPackage(product) {
  const ocr = product.ocr || getDefaultOcrBlock();
  const documents = Array.isArray(ocr.documents) ? ocr.documents : [];

  const usableDocuments = documents
    .map((doc) => withOcrDefaults(doc))
    .filter((doc) => doc.bestText && doc.bestText.trim())
    .map((doc) => ({
      sourceFilename: doc.sourceFilename,
      sourceStoragePath: doc.sourceStoragePath,
      bestText: doc.bestText,
      bestTextSource: doc.bestTextSource,
      bestTextUpdatedAt: doc.bestTextUpdatedAt
    }));

  const combinedText = usableDocuments
    .map((doc) => `===== ${doc.sourceFilename} =====\n${doc.bestText}`)
    .join("\n\n")
    .trim();

  return {
    documents: usableDocuments,
    combinedText
  };
}

function getTextPreview(text, maxLength = 220) {
  const cleanText =
    typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";

  if (!cleanText) {
    return "";
  }

  if (cleanText.length <= maxLength) {
    return cleanText;
  }

  return `${cleanText.slice(0, maxLength).trim()}...`;
}

function buildIntakeOverview(assetSummary) {
  const overviewParts = [];
  const purposeParts = Object.entries(assetSummary.byPurpose)
    .filter(([, count]) => count > 0)
    .map(([purpose, count]) => `${count} ${purpose}`);

  if (assetSummary.totalAssets === 0) {
    overviewParts.push("No registered assets were found for this product.");
  } else if (purposeParts.length > 0) {
    overviewParts.push(`Registered assets include ${purposeParts.join(", ")}.`);
  } else {
    overviewParts.push(`${assetSummary.totalAssets} registered assets are present.`);
  }

  if (assetSummary.ocrDocuments.withText > 0) {
    overviewParts.push(
      `Usable OCR text is available from ${assetSummary.ocrDocuments.withText} document${assetSummary.ocrDocuments.withText === 1 ? "" : "s"}.`
    );
  } else {
    overviewParts.push("No usable OCR text is available yet.");
  }

  if (assetSummary.reviewRequiredCount > 0) {
    overviewParts.push(
      `${assetSummary.reviewRequiredCount} asset${assetSummary.reviewRequiredCount === 1 ? "" : "s"} ${assetSummary.reviewRequiredCount === 1 ? "is" : "are"} marked for human review.`
    );
  }

  return overviewParts.join(" ");
}

function inferLikelyTitle(product, flattenedAssets, sourceTextPackage) {
  if (typeof product.title === "string" && product.title.trim()) {
    return {
      title: product.title.trim(),
      confidence: "high",
      basis: ["Existing product title is already saved on the record."]
    };
  }

  const preferredAsset =
    flattenedAssets.find((asset) => asset.purpose === "source-document" && asset.filename) ||
    flattenedAssets.find((asset) => asset.filename);

  if (preferredAsset) {
    return {
      title: preferredAsset.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim(),
      confidence: "low",
      basis: [`Derived from uploaded filename: ${preferredAsset.filename}.`]
    };
  }

  const firstTextDocument = sourceTextPackage.documents[0];

  if (firstTextDocument?.sourceFilename) {
    return {
      title: firstTextDocument.sourceFilename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim(),
      confidence: "low",
      basis: [`Derived from OCR source filename: ${firstTextDocument.sourceFilename}.`]
    };
  }

  return {
    title: "",
    confidence: "low",
    basis: []
  };
}

function inferLikelyProductType(product, evidenceText) {
  if (typeof product.productType === "string" && product.productType.trim()) {
    return {
      productType: product.productType.trim(),
      confidence: "high",
      basis: ["Existing product type is already saved on the record."]
    };
  }

  const normalizedText = typeof evidenceText === "string" ? evidenceText.toLowerCase() : "";

  if (
    normalizedText.includes("facsimile bible") ||
    normalizedText.includes("bible facsimile") ||
    (normalizedText.includes("facsimile") && normalizedText.includes("bible")) ||
    (normalizedText.includes("reproduction") && normalizedText.includes("bible"))
  ) {
    return {
      productType: "Facsimile Bible",
      confidence: "medium",
      basis: ["Inferred from text evidence mentioning a facsimile or reproduction Bible."]
    };
  }

  const rules = [
    { productType: "Teaching Resource", patterns: [/teaching resource/, /study guide/, /curriculum/] },
    { productType: "DVD", patterns: [/\bdvd\b/, /\bvideo series\b/] },
    { productType: "Poster", patterns: [/\bposter\b/] },
    { productType: "Canvas", patterns: [/\bcanvas\b/] },
    { productType: "Statue", patterns: [/\bstatue\b/] },
    { productType: "Coins & Medallions", patterns: [/\bmedallion\b/, /\bcoin\b/] },
    { productType: "Bible Stand", patterns: [/\bbible stand\b/] },
    { productType: "Book Press", patterns: [/\bbook press\b/] },
    { productType: "Sculpture Stand", patterns: [/\bsculpture stand\b/] },
    { productType: "Dimensional Art", patterns: [/\bdimensional art\b/] },
    { productType: "Artwork", patterns: [/\bartwork\b/] },
    { productType: "Tour", patterns: [/\btour\b/] },
    { productType: "Book", patterns: [/\bpaperback\b/, /\bhardcover\b/, /\bbook\b/] }
  ];

  const match = rules.find((rule) => rule.patterns.some((pattern) => pattern.test(normalizedText)));

  if (match && APPROVED_PRODUCT_TYPES.includes(match.productType)) {
    return {
      productType: match.productType,
      confidence: "medium",
      basis: [`Inferred from text evidence mentioning ${match.productType.toLowerCase()}.`]
    };
  }

  return {
    productType: "",
    confidence: "low",
    basis: []
  };
}

function extractImportantFacts(product, flattenedAssets, sourceTextPackage, likelyProduct) {
  const facts = [];
  const evidenceText = [
    sourceTextPackage.combinedText,
    ...flattenedAssets.map((asset) => asset.notes)
  ]
    .filter(Boolean)
    .join("\n");

  if (likelyProduct.title) {
    facts.push(`Likely title: ${likelyProduct.title}`);
  }

  if (likelyProduct.productType) {
    facts.push(`Likely product type: ${likelyProduct.productType}`);
  }

  if (Array.isArray(product.authors) && product.authors.length > 0) {
    facts.push(`Authors on record: ${product.authors.join(", ")}`);
  }

  if (typeof product.series === "string" && product.series.trim()) {
    facts.push(`Series on record: ${product.series.trim()}`);
  }

  if (typeof product.language === "string" && product.language.trim()) {
    facts.push(`Language on record: ${product.language.trim()}`);
  }

  if (typeof product.isbn13 === "string" && product.isbn13.trim()) {
    facts.push(`ISBN-13 on record: ${product.isbn13.trim()}`);
  } else if (typeof product.isbn10 === "string" && product.isbn10.trim()) {
    facts.push(`ISBN-10 on record: ${product.isbn10.trim()}`);
  }

  const detectedIsbns = Array.from(
    new Set(
      (evidenceText.match(/\b(?:97[89][-\s]?)?[0-9][0-9\-\s]{8,20}[0-9Xx]\b/g) || [])
        .map((item) => item.replace(/\s+/g, " ").trim())
        .filter((item) => item.replace(/[^0-9Xx]/g, "").length >= 10)
    )
  ).slice(0, 3);

  detectedIsbns.forEach((isbn) => {
    facts.push(`ISBN-like text found in source evidence: ${isbn}`);
  });

  flattenedAssets
    .filter((asset) => asset.notes)
    .slice(0, 3)
    .forEach((asset) => {
      facts.push(`Asset note on ${asset.filename || asset.storagePath}: ${getTextPreview(asset.notes, 140)}`);
    });

  if (sourceTextPackage.documents.length > 0) {
    facts.push(
      `OCR text is available from ${sourceTextPackage.documents.length} document${sourceTextPackage.documents.length === 1 ? "" : "s"}.`
    );
  }

  return Array.from(new Set(facts)).slice(0, 10);
}

function buildIntakeAnalysis(product = {}) {
  const flattenedAssets = getFlattenedProductAssets(product);
  const ocrDocuments = Array.isArray(product.ocr?.documents)
    ? product.ocr.documents.map((doc) => withOcrDefaults(doc))
    : [];
  const sourceTextPackage = buildSourceTextPackage(product);
  const ocrByStoragePath = new Map(
    ocrDocuments.map((doc) => [doc.sourceStoragePath, doc])
  );

  const groupedAssets = {
    "source-document": [],
    "product-photo": [],
    "handwritten-note": [],
    "supporting-reference": [],
    unspecified: []
  };

  flattenedAssets.forEach((asset) => {
    const matchingOcr = ocrByStoragePath.get(asset.storagePath);
    const groupedKey = asset.purpose || "unspecified";

    groupedAssets[groupedKey].push({
      assetType: asset.assetType,
      filename: asset.filename,
      storagePath: asset.storagePath,
      contentType: asset.contentType,
      uploadedAt: asset.uploadedAt,
      purpose: asset.purpose,
      subtype: asset.subtype,
      notes: asset.notes,
      ocrRequested: asset.ocrRequested,
      reviewRequired: asset.reviewRequired,
      ocr: matchingOcr
        ? {
            status: matchingOcr.status,
            bestTextSource: matchingOcr.bestTextSource,
            hasBestText: Boolean(matchingOcr.bestText && matchingOcr.bestText.trim()),
            preview: getTextPreview(matchingOcr.bestText)
          }
        : null
    });
  });

  const assetSummary = {
    totalAssets: flattenedAssets.length,
    byAssetType: {
      sourceFiles: flattenedAssets.filter((asset) => asset.assetType === "sourceFiles").length,
      imagesRaw: flattenedAssets.filter((asset) => asset.assetType === "imagesRaw").length,
      imagesEdited: flattenedAssets.filter((asset) => asset.assetType === "imagesEdited").length,
      exports: flattenedAssets.filter((asset) => asset.assetType === "exports").length
    },
    byPurpose: {
      "source-document": flattenedAssets.filter((asset) => asset.purpose === "source-document").length,
      "product-photo": flattenedAssets.filter((asset) => asset.purpose === "product-photo").length,
      "handwritten-note": flattenedAssets.filter((asset) => asset.purpose === "handwritten-note").length,
      "supporting-reference": flattenedAssets.filter((asset) => asset.purpose === "supporting-reference").length,
      unspecified: flattenedAssets.filter((asset) => !asset.purpose).length
    },
    ocrDocuments: {
      total: ocrDocuments.length,
      withText: sourceTextPackage.documents.length,
      processing: ocrDocuments.filter((doc) => doc.status === "processing").length,
      failed: ocrDocuments.filter((doc) => doc.status === "failed").length
    },
    reviewRequiredCount: flattenedAssets.filter((asset) => asset.reviewRequired).length
  };
  assetSummary.overview = buildIntakeOverview(assetSummary);

  const evidenceText = [
    sourceTextPackage.combinedText,
    ...flattenedAssets.map((asset) => asset.notes),
    product.title || "",
    product.subtitle || "",
    product.productType || "",
    product.content?.shortDescription || "",
    product.content?.mainDescription || ""
  ]
    .filter(Boolean)
    .join("\n\n");

  const titleGuess = inferLikelyTitle(product, flattenedAssets, sourceTextPackage);
  const productTypeGuess = inferLikelyProductType(product, evidenceText);

  const likelyProduct = {
    title: titleGuess.title,
    productType: productTypeGuess.productType,
    confidence:
      titleGuess.confidence === "high" || productTypeGuess.confidence === "high"
        ? "high"
        : titleGuess.confidence === "medium" || productTypeGuess.confidence === "medium"
          ? "medium"
          : "low",
    basis: [...titleGuess.basis, ...productTypeGuess.basis]
  };

  const importantFacts = extractImportantFacts(product, flattenedAssets, sourceTextPackage, likelyProduct);
  const uncertainties = [];
  const openQuestions = [];
  const reviewReasons = [];
  const priorityAssets = [];

  if (flattenedAssets.length === 0) {
    uncertainties.push("No registered assets are available yet, so the intake analysis has very little evidence to work with.");
  }

  if (sourceTextPackage.documents.length === 0) {
    uncertainties.push("No usable OCR text is available yet, so this analysis depends on asset metadata and saved product fields.");
  }

  if (flattenedAssets.some((asset) => asset.purpose === "product-photo")) {
    uncertainties.push("V1 does not inspect image content directly; product-photo analysis depends on filenames, notes, and OCR text only.");
  }

  if (!likelyProduct.title) {
    uncertainties.push("A likely title could not be identified confidently from the current intake evidence.");
    openQuestions.push("What is the final product title?");
  }

  if (!likelyProduct.productType) {
    uncertainties.push("A likely approved product type could not be identified confidently from the current intake evidence.");
    openQuestions.push("Which approved product type best fits this item?");
  }

  if (assetSummary.byPurpose.unspecified > 0) {
    uncertainties.push("Some assets still have no intake purpose assigned.");
    openQuestions.push("Should any unassigned assets be labeled as source-document, product-photo, handwritten-note, or supporting-reference?");
  }

  if (assetSummary.ocrDocuments.processing > 0) {
    uncertainties.push("Some OCR work is still processing, so text findings may expand after OCR completes.");
  }

  if (assetSummary.ocrDocuments.failed > 0) {
    uncertainties.push("Some OCR documents failed, so the available text evidence may be incomplete.");
    reviewReasons.push("One or more OCR documents failed and should be checked manually.");
  }

  flattenedAssets
    .filter((asset) => asset.reviewRequired)
    .slice(0, 5)
    .forEach((asset) => {
      priorityAssets.push({
        filename: asset.filename,
        purpose: asset.purpose || "unspecified",
        reason: asset.purpose === "handwritten-note" ? "Handwritten-note default review requirement." : "Marked reviewRequired on the asset."
      });
    });

  if (flattenedAssets.some((asset) => asset.reviewRequired)) {
    reviewReasons.push("At least one asset is marked reviewRequired.");
  }

  if (flattenedAssets.some((asset) => asset.purpose === "handwritten-note")) {
    reviewReasons.push("Handwritten-note assets usually need human verification even when OCR text is available.");
  }

  if (ocrDocuments.some((doc) => doc.bestText && doc.bestText.trim() && doc.bestTextSource !== "humanReviewedText")) {
    reviewReasons.push("OCR text exists, but none of the usable text has been human-reviewed yet.");
  }

  if (assetSummary.byPurpose["source-document"] === 0 && assetSummary.ocrDocuments.withText === 0) {
    openQuestions.push("Is there a canonical source document or reference file that should be added for intake analysis?");
  }

  if (
    flattenedAssets.some(
      (asset) => asset.purpose === "supporting-reference" && !asset.ocrRequested && !asset.notes
    )
  ) {
    openQuestions.push("Do any supporting-reference assets need OCR or notes so their content can be used in analysis?");
  }

  if (
    flattenedAssets.some(
      (asset) => asset.purpose === "product-photo" && !asset.notes
    )
  ) {
    openQuestions.push("Which product-photo assets are final keeper shots versus rough intake/reference photos?");
  }

  return {
    slug: product.slug || "",
    assetSummary,
    groupedAssets,
    textFindings: {
      sourceTextAvailable: Boolean(sourceTextPackage.combinedText),
      combinedTextLength: sourceTextPackage.combinedText.length,
      documents: sourceTextPackage.documents.map((doc) => ({
        sourceFilename: doc.sourceFilename,
        sourceStoragePath: doc.sourceStoragePath,
        bestTextSource: doc.bestTextSource,
        bestTextUpdatedAt: doc.bestTextUpdatedAt,
        preview: getTextPreview(doc.bestText)
      })),
      noteEntries: flattenedAssets
        .filter((asset) => asset.notes)
        .map((asset) => ({
          filename: asset.filename,
          purpose: asset.purpose || "unspecified",
          notePreview: getTextPreview(asset.notes)
        }))
    },
    likelyProduct,
    importantFacts,
    uncertainties,
    reviewRecommendations: {
      humanReviewRecommended: reviewReasons.length > 0,
      reasons: Array.from(new Set(reviewReasons)),
      priorityAssets
    },
    openQuestions: Array.from(new Set(openQuestions))
  };
}

function buildDraftPrompt(product, sourceTextPackage) {
  const payload = {
    product: {
      slug: product.slug || "",
      title: product.title || "",
      subtitle: product.subtitle || "",
      productType: product.productType || "",
      status: product.status || "",
      authors: Array.isArray(product.authors) ? product.authors : [],
      series: product.series || null,
      language: product.language || "",
      isbn10: product.isbn10 || "",
      isbn13: product.isbn13 || "",
      binding: product.binding || "",
      dimensions: product.dimensions || {},
      weightLb: typeof product.weightLb === "number" ? product.weightLb : 0,
      pricing: product.pricing || {},
      organization: product.organization || {},
      mediaNotes: product.mediaNotes || {},
      existingContent: product.content || {}
    },
    sourceText: sourceTextPackage
  };

  return [
    "You are a product content writer for Biblical Heritage Exhibit.",
    "Generate a structured draft from the provided product record and source text.",
    "Use source text as the primary factual source.",
    "Preserve facts and avoid inventing bibliographic details.",
    "Do not invent ISBNs, dimensions, pricing, authors, dates, or edition claims not supported by the source text or existing product record.",
    "You may improve clarity and grammar.",
    "Return valid JSON only with exactly these keys:",
    "title, subtitle, shortDescription, mainDescription, featureBullets, seoTitle, metaDescription",
    "featureBullets must be an array of 3 to 5 short strings.",
    "mainDescription must be a readable marketing-ready paragraph or short multi-paragraph description.",
    "shortDescription and metaDescription should be concise.",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function extractOpenAiText(responseJson) {
  if (typeof responseJson?.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  const outputs = Array.isArray(responseJson?.output) ? responseJson.output : [];
  const parts = [];

  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const piece of content) {
      if (typeof piece?.text === "string" && piece.text) {
        parts.push(piece.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function parseDraftJson(text) {
  const direct = text.trim();

  try {
    return JSON.parse(direct);
  } catch (error) {
    // continue
  }

  const fencedMatch =
    direct.match(/```json\s*([\s\S]*?)```/i) ||
    direct.match(/```([\s\S]*?)```/);

  if (fencedMatch) {
    return JSON.parse(fencedMatch[1].trim());
  }

  const firstBrace = direct.indexOf("{");
  const lastBrace = direct.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(direct.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Could not parse draft JSON");
}

function sanitizeOptionalString(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error("Invalid optional string");
  }

  return value.trim();
}

function sanitizeOptionalBoolean(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new Error("Invalid optional boolean");
  }

  return value;
}

function sanitizeOptionalIntakePurpose(value) {
  const cleanPurpose = sanitizeOptionalString(value);

  if (!cleanPurpose) {
    return "";
  }

  if (!ALLOWED_INTAKE_PURPOSES.includes(cleanPurpose)) {
    throw new Error("Invalid purpose");
  }

  return cleanPurpose;
}

function parseOptionalBooleanLike(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const cleanValue = value.trim().toLowerCase();

    if (!cleanValue) {
      return undefined;
    }

    if (["true", "1", "yes"].includes(cleanValue)) {
      return true;
    }

    if (["false", "0", "no"].includes(cleanValue)) {
      return false;
    }
  }

  throw new Error("Invalid optional boolean");
}

function getDefaultOcrRequestedForPurpose(purpose) {
  if (purpose === "source-document" || purpose === "handwritten-note") {
    return true;
  }

  return false;
}

function getDefaultReviewRequiredForPurpose(purpose) {
  return purpose === "handwritten-note";
}

function resolveAssetIntakeMetadata({
  purpose,
  subtype,
  notes,
  ocrRequested,
  reviewRequired
}) {
  const cleanPurpose = sanitizeOptionalIntakePurpose(purpose);
  const cleanSubtype = sanitizeOptionalString(subtype);
  const cleanNotes = sanitizeOptionalString(notes);
  const parsedOcrRequested = parseOptionalBooleanLike(ocrRequested);
  const parsedReviewRequired = parseOptionalBooleanLike(reviewRequired);

  return {
    purpose: cleanPurpose,
    subtype: cleanSubtype,
    notes: cleanNotes,
    ocrRequested:
      parsedOcrRequested !== undefined
        ? parsedOcrRequested
        : getDefaultOcrRequestedForPurpose(cleanPurpose),
    reviewRequired:
      parsedReviewRequired !== undefined
        ? parsedReviewRequired
        : getDefaultReviewRequiredForPurpose(cleanPurpose)
  };
}

function buildAssetRecord({
  filename,
  storagePath,
  contentType,
  purpose,
  subtype,
  notes,
  ocrRequested,
  reviewRequired
}) {
  return {
    filename,
    storagePath,
    contentType,
    uploadedAt: getNowIso(),
    purpose,
    subtype,
    notes,
    ocrRequested,
    reviewRequired
  };
}

function normalizeStoredAssetRecord(asset = {}, assetType = "") {
  const purpose =
    typeof asset.purpose === "string" && ALLOWED_INTAKE_PURPOSES.includes(asset.purpose.trim())
      ? asset.purpose.trim()
      : "";

  let ocrRequested = getDefaultOcrRequestedForPurpose(purpose);
  let reviewRequired = getDefaultReviewRequiredForPurpose(purpose);

  try {
    const parsedOcrRequested = parseOptionalBooleanLike(asset.ocrRequested);
    if (parsedOcrRequested !== undefined) {
      ocrRequested = parsedOcrRequested;
    }
  } catch (error) {
    ocrRequested = getDefaultOcrRequestedForPurpose(purpose);
  }

  try {
    const parsedReviewRequired = parseOptionalBooleanLike(asset.reviewRequired);
    if (parsedReviewRequired !== undefined) {
      reviewRequired = parsedReviewRequired;
    }
  } catch (error) {
    reviewRequired = getDefaultReviewRequiredForPurpose(purpose);
  }

  return {
    assetType,
    assetId: typeof asset.assetId === "string" ? asset.assetId.trim() : "",
    filename: typeof asset.filename === "string" ? asset.filename.trim() : "",
    storagePath: typeof asset.storagePath === "string" ? asset.storagePath.trim() : "",
    storageKey:
      typeof asset.storageKey === "string" && asset.storageKey.trim()
        ? asset.storageKey.trim()
        : typeof asset.storagePath === "string"
          ? asset.storagePath.trim()
          : "",
    contentType: typeof asset.contentType === "string" ? asset.contentType.trim() : "",
    mimeType:
      typeof asset.mimeType === "string" && asset.mimeType.trim()
        ? asset.mimeType.trim()
        : typeof asset.contentType === "string"
          ? asset.contentType.trim()
          : "",
    canonicalUrl: typeof asset.canonicalUrl === "string" ? asset.canonicalUrl.trim() : "",
    byteSize: typeof asset.byteSize === "number" ? asset.byteSize : 0,
    checksumSha256:
      typeof asset.checksumSha256 === "string" ? asset.checksumSha256.trim() : "",
    uploadedAt: typeof asset.uploadedAt === "string" ? asset.uploadedAt.trim() : "",
    attachedAt: typeof asset.attachedAt === "string" ? asset.attachedAt.trim() : "",
    purpose,
    subtype: typeof asset.subtype === "string" ? asset.subtype.trim() : "",
    notes: typeof asset.notes === "string" ? asset.notes.trim() : "",
    assetRole: typeof asset.assetRole === "string" ? asset.assetRole.trim() : "",
    ocrRequested,
    reviewRequired
  };
}

function getFlattenedProductAssets(product = {}) {
  const assets = getSafeAssets(product);

  return Object.entries(assets).flatMap(([assetType, items]) =>
    items.map((item) => normalizeStoredAssetRecord(item, assetType))
  );
}

function sanitizeDraft(draft, product) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new Error("Invalid draft shape");
  }

  const cleanTitle =
    typeof draft.title === "string" && draft.title.trim()
      ? draft.title.trim()
      : (product.title || "").trim();

  const cleanSubtitle =
    typeof draft.subtitle === "string"
      ? draft.subtitle.trim()
      : (product.subtitle || "").trim();

  const cleanShortDescription =
    typeof draft.shortDescription === "string" ? draft.shortDescription.trim() : "";

  const cleanMainDescription =
    typeof draft.mainDescription === "string" ? draft.mainDescription.trim() : "";

  const cleanFeatureBullets = Array.isArray(draft.featureBullets)
    ? draft.featureBullets
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const cleanSeoTitle =
    typeof draft.seoTitle === "string"
      ? draft.seoTitle.trim()
      : cleanTitle;

  const cleanMetaDescription =
    typeof draft.metaDescription === "string" ? draft.metaDescription.trim() : "";

  return {
    title: cleanTitle,
    subtitle: cleanSubtitle,
    shortDescription: cleanShortDescription,
    mainDescription: cleanMainDescription,
    featureBullets: cleanFeatureBullets,
    seoTitle: cleanSeoTitle,
    metaDescription: cleanMetaDescription
  };
}

function validateDraftPayload(draft) {
  if (!isPlainObject(draft)) {
    return false;
  }

  if (
    typeof draft.title !== "string" ||
    typeof draft.subtitle !== "string" ||
    typeof draft.shortDescription !== "string" ||
    typeof draft.mainDescription !== "string" ||
    typeof draft.seoTitle !== "string" ||
    typeof draft.metaDescription !== "string" ||
    !Array.isArray(draft.featureBullets) ||
    !draft.featureBullets.every((item) => typeof item === "string")
  ) {
    return false;
  }

  return true;
}

async function runAiCorrection(sourceText) {
  const instructions = [
    "You are correcting OCR text from historical Bible-related documents.",
    "Return plain corrected text only.",
    "Do not add commentary, bullets, labels, or markdown.",
    "Preserve paragraph order and meaning.",
    "Fix obvious OCR corruption and spacing issues.",
    "Do not invent facts or missing content.",
    "If a word is uncertain, choose the most conservative plausible correction.",
    "Do not rewrite into marketing copy."
  ].join(" ");

  const input = ["Correct this OCR text conservatively.", "", sourceText].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions,
      input,
      reasoning: { effort: "low" },
      text: { verbosity: "low" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const correctedText = extractOpenAiText(data);

  if (!correctedText) {
    throw new Error("OpenAI API returned empty correction text");
  }

  return correctedText;
}

async function runDraftGeneration(product, sourceTextPackage) {
  const prompt = buildDraftPrompt(product, sourceTextPackage);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions:
        "Return valid JSON only. Do not include markdown fences. Do not include explanatory text.",
      input: prompt,
      reasoning: { effort: "medium" },
      text: { verbosity: "low" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const rawText = extractOpenAiText(data);

  if (!rawText) {
    throw new Error("OpenAI API returned empty draft text");
  }

  const parsedDraft = parseDraftJson(rawText);
  return sanitizeDraft(parsedDraft, product);
}

async function saveTextFileToStorage(storagePath, text) {
  const file = storage.bucket(BUCKET_NAME).file(storagePath);
  await file.save(text, {
    contentType: "text/plain; charset=utf-8"
  });
}

async function saveJsonFileToStorage(storagePath, jsonValue) {
  const file = storage.bucket(BUCKET_NAME).file(storagePath);
  await file.save(JSON.stringify(jsonValue, null, 2), {
    contentType: "application/json; charset=utf-8"
  });
}

function validateDocumentAiConfig() {
  if (!DOCUMENT_AI_LOCATION || !DOCUMENT_AI_PROCESSOR_ID) {
    throw new Error("DOCUMENT_AI_LOCATION and DOCUMENT_AI_PROCESSOR_ID must be configured");
  }
}

function getDocumentAiProcessorName() {
  validateDocumentAiConfig();
  return documentAiClient.processorPath(
    GCP_PROJECT_ID,
    DOCUMENT_AI_LOCATION,
    DOCUMENT_AI_PROCESSOR_ID
  );
}

function getMimeTypeForDocumentAi(mimeType) {
  const allowedMimeTypes = new Set([
    "application/pdf",
    "image/tiff",
    "image/tif",
    "image/gif",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/bmp"
  ]);

  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error(`Unsupported mimeType for Document AI: ${mimeType}`);
  }

  if (mimeType === "image/jpg") {
    return "image/jpeg";
  }

  if (mimeType === "image/tif") {
    return "image/tiff";
  }

  return mimeType;
}

async function runDocumentAiOcr({ sourceStoragePath, sourceFilename, mimeType }) {
  validateDocumentAiConfig();

  const normalizedMimeType = getMimeTypeForDocumentAi(mimeType);
  const processorName = getDocumentAiProcessorName();

  const file = storage.bucket(BUCKET_NAME).file(sourceStoragePath);
  const [fileBuffer] = await file.download();

  const request = {
    name: processorName,
    rawDocument: {
      content: fileBuffer.toString("base64"),
      mimeType: normalizedMimeType,
      displayName: sourceFilename
    },
    skipHumanReview: true
  };

  const [result] = await documentAiClient.processDocument(request);
  const document = result.document || {};
  const extractedText = document.text || "";
  const pageCount = Array.isArray(document.pages) ? document.pages.length : 0;

  return {
    extractedText,
    pageCount,
    rawResult: result
  };
}

function cleanOcrText(rawText) {
  if (typeof rawText !== "string") {
    return "";
  }

  let text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");

  const lines = text.split("\n").map((line) => line.trim());
  const cleanedLines = [];
  let previousBlank = false;

  for (const line of lines) {
    const normalizedLine = line.replace(/\s+/g, " ").trim();

    if (!normalizedLine) {
      if (!previousBlank) {
        cleanedLines.push("");
      }
      previousBlank = true;
      continue;
    }

    cleanedLines.push(normalizedLine);
    previousBlank = false;
  }

  text = cleanedLines.join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function normalizeOcrText(inputText) {
  if (typeof inputText !== "string") {
    return "";
  }

  let text = cleanOcrText(inputText);

  const replacements = [
    [/\bEglish\b/g, "English"],
    [/\borgullaguges\b/g, "original languages"],
    [/\bDriginally\b/g, "Originally"],
    [/\bfint ported by Bible\b/g, "first printed Bible"],
    [/\bIndeportece\b/g, "Independence"],
    [/\bAmericas freedom and Indeportece\b/g, "America's freedom and Independence"],
    [/\bBilde\b/g, "Bible"],
    [/\bBitte\b/g, "Bible"],
    [/\bEyll Bakke\b/g, "Bible back"],
    [/\bligital\b/g, "digital"],
    [/\bremaing Copies\b/g, "remaining copies"],
    [/\bworld tidy\b/g, "world today"],
    [/\bfrommy\b/g, "Germany"],
    [/\bgotho Font woriginal Quarto\b/g, "gothic font with original quarto"],
    [/\bgishtors\b/g, "legislators"],
    [/\bPartors\b/g, "Pastors"],
    [/\bannivery\b/g, "anniversary"],
    [/\bCommemoratul\b/g, "Commemorative"],
    [/\bhustoric presentativ pièce\b/g, "historic presentation piece"],
    [/\bacross the country and Foreign Territories\b/g, "across the country and foreign territories"],
    [/\brefraction\b/g, "Reformation"]
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\bE4h\b/g, "New");
  text = text.replace(/\bward be significat\b/g, "would be significant");
  text = text.replace(/\bsoming the seed\b/g, "sowing the seed");
  text = text.replace(/\bHry\/hout\b/g, "throughout");
  text = text.replace(/\bSooth\b/g, "500th");
  text = text.replace(/\baming\b/g, "anniversary");
  text = text.replace(/\bthy\b/g, "taking");
  text = text.replace(/\bfore in full ed or\b/g, "offered in full color");
  text = text.replace(/\bAndre Axercised the Capitol Connection\b/g, "through Capitol Commission");
  text = text.replace(/\bsee speed project\b/g, "see special project");
  text = text.replace(/\?+/g, "");

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n")
    .trim();
}

function sanitizeFilenameForStorage(filename) {
  const trimmed = (filename || "uploaded-file").trim();
  const replaced = trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
  return replaced || `uploaded-${Date.now()}`;
}

function normalizeAssetMimeType(mimeType) {
  if (typeof mimeType !== "string" || !mimeType.trim()) {
    return "application/octet-stream";
  }

  const cleanMimeType = mimeType.trim().toLowerCase();

  if (cleanMimeType === "image/jpg") {
    return "image/jpeg";
  }

  if (cleanMimeType === "image/tif") {
    return "image/tiff";
  }

  return cleanMimeType;
}

function ensureSupportedAssetMimeType(mimeType) {
  const normalizedMimeType = normalizeAssetMimeType(mimeType);

  if (!SUPPORTED_ASSET_MIME_TYPES.has(normalizedMimeType)) {
    throw createWorkflowError(
      `Unsupported file type: ${normalizedMimeType}. Supported types include JPG, PNG, WEBP, TIFF, GIF, BMP, and PDF.`,
      400,
      { mimeType: normalizedMimeType }
    );
  }

  return normalizedMimeType;
}

function buildCanonicalAssetUrl(storageKey, bucketName = BUCKET_NAME) {
  return `gs://${bucketName}/${storageKey}`;
}

function getDefaultRepositoryDocumentOcr() {
  return {
    status: "not_started",
    sourceStoragePath: "",
    rawOutputPath: "",
    textOutputPath: "",
    extractedText: "",
    pageCount: 0,
    processedAt: "",
    error: "",
    bestText: "",
    bestTextSource: "",
    bestTextUpdatedAt: "",
    cleanedText: "",
    cleanupStatus: "not_started",
    cleanupProcessedAt: "",
    cleanupError: "",
    normalizedText: "",
    normalizationStatus: "not_started",
    normalizationProcessedAt: "",
    normalizationError: "",
    aiCorrectedText: "",
    aiCorrectionStatus: "not_started",
    aiCorrectionProcessedAt: "",
    aiCorrectionError: "",
    humanReviewedText: ""
  };
}

function buildDefaultRepositoryDocumentRecord({
  documentId,
  title,
  originalFilename,
  storagePath,
  canonicalUrl,
  byteSize,
  mimeType = "application/pdf",
  uploadedAt,
  createdAt,
  updatedAt,
  uploadedBy,
  originalFolderLabel,
  binLabel,
  scanBatchLabel,
  sourceLocationNotes
}) {
  const timestamp = uploadedAt || createdAt || updatedAt || getNowIso();

  return {
    documentId,
    title,
    originalFilename,
    storagePath,
    canonicalUrl: typeof canonicalUrl === "string" ? canonicalUrl : "",
    byteSize: typeof byteSize === "number" ? byteSize : 0,
    mimeType: mimeType || "application/pdf",
    uploadedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    uploadedBy: typeof uploadedBy === "string" ? uploadedBy : "",
    originalFolderLabel: typeof originalFolderLabel === "string" ? originalFolderLabel : "",
    binLabel: typeof binLabel === "string" ? binLabel : "",
    scanBatchLabel: typeof scanBatchLabel === "string" ? scanBatchLabel : "",
    sourceLocationNotes: typeof sourceLocationNotes === "string" ? sourceLocationNotes : "",
    documentType: "printed-article",
    reviewStatus: "pending",
    ocr: getDefaultRepositoryDocumentOcr(),
    linkedKnowledgeItemIds: []
  };
}

function buildDefaultRepositoryItemRecord({
  itemId,
  title,
  itemType,
  createdAt,
  updatedAt
}) {
  const timestamp = createdAt || updatedAt || getNowIso();

  return {
    itemId,
    title,
    itemType,
    canonicalSummary: "",
    linkedDocumentIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function buildPersistedAssetRecord({
  assetId,
  slug,
  filename,
  mimeType,
  storageKey,
  canonicalUrl,
  byteSize,
  checksumSha256,
  uploadSource,
  uploadState,
  intendedAssetType,
  purpose,
  subtype,
  notes,
  ocrRequested,
  reviewRequired,
  sourceFileRef
}) {
  const now = getNowIso();

  return {
    assetId,
    slug,
    filename,
    mimeType,
    storageKey,
    canonicalUrl,
    byteSize: typeof byteSize === "number" ? byteSize : 0,
    checksumSha256: checksumSha256 || "",
    uploadSource: uploadSource || DEFAULT_ASSET_UPLOAD_SOURCE,
    uploadState: uploadState || "persisted",
    intendedAssetType: intendedAssetType || "",
    purpose: purpose || "",
    subtype: subtype || "",
    notes: notes || "",
    ocrRequested: Boolean(ocrRequested),
    reviewRequired: Boolean(reviewRequired),
    sourceFileRef: isPlainObject(sourceFileRef) ? sourceFileRef : {},
    createdAt: now,
    updatedAt: now
  };
}

function normalizePersistedAssetRecord(record = {}) {
  return {
    assetId: typeof record.assetId === "string" ? record.assetId.trim() : "",
    slug: typeof record.slug === "string" ? record.slug.trim() : "",
    filename: typeof record.filename === "string" ? record.filename.trim() : "",
    mimeType: normalizeAssetMimeType(record.mimeType),
    storageKey: typeof record.storageKey === "string" ? record.storageKey.trim() : "",
    canonicalUrl: typeof record.canonicalUrl === "string" ? record.canonicalUrl.trim() : "",
    byteSize: typeof record.byteSize === "number" ? record.byteSize : 0,
    checksumSha256:
      typeof record.checksumSha256 === "string" ? record.checksumSha256.trim() : "",
    uploadSource: typeof record.uploadSource === "string" ? record.uploadSource.trim() : "",
    uploadState: typeof record.uploadState === "string" ? record.uploadState.trim() : "",
    intendedAssetType:
      typeof record.intendedAssetType === "string" ? record.intendedAssetType.trim() : "",
    purpose: typeof record.purpose === "string" ? record.purpose.trim() : "",
    subtype: typeof record.subtype === "string" ? record.subtype.trim() : "",
    notes: typeof record.notes === "string" ? record.notes.trim() : "",
    ocrRequested: Boolean(record.ocrRequested),
    reviewRequired: Boolean(record.reviewRequired),
    sourceFileRef: isPlainObject(record.sourceFileRef) ? record.sourceFileRef : {},
    createdAt: typeof record.createdAt === "string" ? record.createdAt.trim() : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt.trim() : ""
  };
}

function buildProductAssetAttachment({
  persistedAsset,
  assetType,
  assetRole,
  purpose,
  subtype,
  notes,
  ocrRequested,
  reviewRequired
}) {
  const normalizedAsset = normalizePersistedAssetRecord(persistedAsset);
  const attachedAt = getNowIso();
  const resolvedPurpose = typeof purpose === "string" && purpose.trim()
    ? purpose.trim()
    : normalizedAsset.purpose;
  const resolvedSubtype = typeof subtype === "string" ? subtype.trim() : normalizedAsset.subtype;
  const resolvedNotes = typeof notes === "string" ? notes.trim() : normalizedAsset.notes;

  return {
    assetId: normalizedAsset.assetId,
    filename: normalizedAsset.filename,
    storagePath: normalizedAsset.storageKey,
    storageKey: normalizedAsset.storageKey,
    canonicalUrl: normalizedAsset.canonicalUrl,
    contentType: normalizedAsset.mimeType,
    mimeType: normalizedAsset.mimeType,
    byteSize: normalizedAsset.byteSize,
    checksumSha256: normalizedAsset.checksumSha256,
    uploadedAt: normalizedAsset.createdAt || attachedAt,
    attachedAt,
    purpose: resolvedPurpose,
    subtype: resolvedSubtype,
    notes: resolvedNotes,
    ocrRequested:
      ocrRequested !== undefined ? Boolean(ocrRequested) : Boolean(normalizedAsset.ocrRequested),
    reviewRequired:
      reviewRequired !== undefined
        ? Boolean(reviewRequired)
        : Boolean(normalizedAsset.reviewRequired),
    assetRole: typeof assetRole === "string" ? assetRole.trim() : "",
    sourceType: BACKEND_PERSISTED_ASSET_SOURCE,
    assetType
  };
}

function getAssetWorkflowDependencies(overrides = {}) {
  return {
    productsCollection,
    assetLibraryCollection,
    storage,
    bucketName: BUCKET_NAME,
    fetchImpl: fetch,
    ...overrides
  };
}

function getRepositoryWorkflowDependencies(overrides = {}) {
  return {
    repositoryDocumentsCollection,
    repositoryItemsCollection,
    storage,
    bucketName: BUCKET_NAME,
    fetchImpl: fetch,
    runDocumentAiOcr,
    saveJsonFileToStorage,
    saveTextFileToStorage,
    cleanOcrText,
    normalizeOcrText,
    runAiCorrection,
    ...overrides
  };
}

function getSongCatalogDependencies(overrides = {}) {
  return {
    songsCollection,
    ...overrides
  };
}

async function getRequiredRepositoryDocument(repositoryDocuments, documentId) {
  const cleanDocumentId =
    typeof documentId === "string" && documentId.trim() ? documentId.trim() : "";

  if (!cleanDocumentId) {
    throw createWorkflowError("Missing or invalid documentId", 400);
  }

  const docRef = repositoryDocuments.doc(cleanDocumentId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createWorkflowError("Repository document not found", 404, {
      documentId: cleanDocumentId
    });
  }

  return {
    documentId: cleanDocumentId,
    docRef,
    document: doc.data() || {}
  };
}

async function getRequiredRepositoryItem(repositoryItems, itemId) {
  const cleanItemId =
    typeof itemId === "string" && itemId.trim() ? itemId.trim() : "";

  if (!cleanItemId) {
    throw createWorkflowError("Missing or invalid itemId", 400);
  }

  const docRef = repositoryItems.doc(cleanItemId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createWorkflowError("Repository item not found", 404, {
      itemId: cleanItemId
    });
  }

  return {
    itemId: cleanItemId,
    docRef,
    item: doc.data() || {}
  };
}

async function getRepositoryDocumentById(
  { documentId },
  deps = getRepositoryWorkflowDependencies()
) {
  const { document } = await getRequiredRepositoryDocument(
    deps.repositoryDocumentsCollection,
    documentId
  );

  return {
    document
  };
}

async function getRepositoryDocumentSourceText(
  { documentId },
  deps = getRepositoryWorkflowDependencies()
) {
  const { document } = await getRequiredRepositoryDocument(
    deps.repositoryDocumentsCollection,
    documentId
  );
  const ocr = {
    ...getDefaultRepositoryDocumentOcr(),
    ...(isPlainObject(document.ocr) ? document.ocr : {})
  };

  return {
    documentId: document.documentId || documentId,
    sourceText: {
      bestText: ocr.bestText || "",
      bestTextSource: ocr.bestTextSource || "",
      bestTextUpdatedAt: ocr.bestTextUpdatedAt || "",
      extractedText: ocr.extractedText || "",
      cleanedText: ocr.cleanedText || "",
      normalizedText: ocr.normalizedText || "",
      aiCorrectedText: ocr.aiCorrectedText || "",
      humanReviewedText: ocr.humanReviewedText || ""
    }
  };
}

async function createRepositoryItem(
  { title, itemType },
  deps = getRepositoryWorkflowDependencies()
) {
  if (typeof title !== "string" || !title.trim()) {
    throw createWorkflowError("Missing or invalid title", 400);
  }

  if (typeof itemType !== "string" || !itemType.trim()) {
    throw createWorkflowError("Missing or invalid itemType", 400);
  }

  const cleanTitle = title.trim();
  const cleanItemType = itemType.trim();

  if (!ALLOWED_REPOSITORY_ITEM_TYPES.includes(cleanItemType)) {
    throw createWorkflowError("Invalid itemType", 400, {
      itemType: cleanItemType
    });
  }

  const item = buildDefaultRepositoryItemRecord({
    itemId: randomUUID(),
    title: cleanTitle,
    itemType: cleanItemType,
    createdAt: getNowIso()
  });

  await deps.repositoryItemsCollection.doc(item.itemId).set(item);

  return {
    item
  };
}

async function getRepositoryItemById(
  { itemId },
  deps = getRepositoryWorkflowDependencies()
) {
  const { item } = await getRequiredRepositoryItem(
    deps.repositoryItemsCollection,
    itemId
  );

  return {
    item
  };
}

async function getRepositoryItemDocuments(
  { itemId },
  deps = getRepositoryWorkflowDependencies()
) {
  const { itemId: cleanItemId, item } = await getRequiredRepositoryItem(
    deps.repositoryItemsCollection,
    itemId
  );
  const linkedDocumentIds = Array.isArray(item.linkedDocumentIds)
    ? item.linkedDocumentIds.filter((id) => typeof id === "string" && id.trim())
    : [];

  if (linkedDocumentIds.length === 0) {
    return {
      itemId: cleanItemId,
      count: 0,
      documents: []
    };
  }

  const documents = [];
  for (const documentId of linkedDocumentIds) {
    const { document } = await getRequiredRepositoryDocument(
      deps.repositoryDocumentsCollection,
      documentId
    );
    documents.push(buildRepositoryDocumentSearchResultSummary(document, documentId));
  }

  return {
    itemId: cleanItemId,
    count: documents.length,
    documents
  };
}

async function saveRepositoryItemSummary(
  { itemId, canonicalSummary },
  deps = getRepositoryWorkflowDependencies()
) {
  const {
    docRef,
    item
  } = await getRequiredRepositoryItem(deps.repositoryItemsCollection, itemId);

  if (typeof canonicalSummary !== "string" || !canonicalSummary.trim()) {
    throw createWorkflowError("Missing or invalid canonicalSummary", 400);
  }

  const updatedAt = getNowIso();
  const updatedItem = {
    ...item,
    canonicalSummary: canonicalSummary.trim(),
    updatedAt
  };

  await docRef.update({
    canonicalSummary: updatedItem.canonicalSummary,
    updatedAt
  });

  return {
    item: updatedItem
  };
}

async function linkRepositoryItemDocuments(
  { itemId, documentIds },
  deps = getRepositoryWorkflowDependencies()
) {
  const {
    itemId: cleanItemId,
    docRef: itemDocRef,
    item: existingItem
  } = await getRequiredRepositoryItem(deps.repositoryItemsCollection, itemId);

  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    throw createWorkflowError("Missing or invalid documentIds", 400);
  }

  const normalizedDocumentIds = [];
  for (const rawDocumentId of documentIds) {
    const cleanDocumentId =
      typeof rawDocumentId === "string" && rawDocumentId.trim() ? rawDocumentId.trim() : "";

    if (!cleanDocumentId) {
      throw createWorkflowError("Missing or invalid documentIds", 400);
    }

    if (!normalizedDocumentIds.includes(cleanDocumentId)) {
      normalizedDocumentIds.push(cleanDocumentId);
    }
  }

  const repositoryDocuments = [];
  for (const documentIdToLink of normalizedDocumentIds) {
    const repositoryDocument = await getRequiredRepositoryDocument(
      deps.repositoryDocumentsCollection,
      documentIdToLink
    );
    repositoryDocuments.push(repositoryDocument);
  }

  const updatedAt = getNowIso();
  const existingLinkedDocumentIds = Array.isArray(existingItem.linkedDocumentIds)
    ? existingItem.linkedDocumentIds.filter((id) => typeof id === "string" && id.trim())
    : [];
  const linkedDocumentIds = Array.from(
    new Set(existingLinkedDocumentIds.concat(normalizedDocumentIds))
  );

  const updatedItem = {
    ...existingItem,
    linkedDocumentIds,
    updatedAt
  };

  await itemDocRef.update({
    linkedDocumentIds,
    updatedAt
  });

  for (const { docRef, document } of repositoryDocuments) {
    const existingLinkedKnowledgeItemIds = Array.isArray(document.linkedKnowledgeItemIds)
      ? document.linkedKnowledgeItemIds.filter((id) => typeof id === "string" && id.trim())
      : [];
    const linkedKnowledgeItemIds = Array.from(
      new Set(existingLinkedKnowledgeItemIds.concat(cleanItemId))
    );

    await docRef.update({
      linkedKnowledgeItemIds,
      updatedAt
    });
  }

  return {
    itemId: cleanItemId,
    linkedCount: normalizedDocumentIds.length,
    linkedDocumentIds,
    item: updatedItem
  };
}

async function searchRepositoryItems(
  { query, limit = 10 },
  deps = getRepositoryWorkflowDependencies()
) {
  if (typeof query !== "string" || !query.trim()) {
    throw createWorkflowError("Missing or invalid query", 400);
  }

  const cleanQuery = query.trim().toLowerCase();
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const snapshot = await deps.repositoryItemsCollection.limit(200).get();

  const results = snapshot.docs
    .map((doc) => {
      const item = doc.data() || {};
      const searchText = buildRepositoryItemSearchText(item);
      const matchedTokenCount = tokens.filter((token) => searchText.includes(token)).length;

      return {
        ...buildRepositoryItemSearchResultSummary(item, doc.id),
        _score: matchedTokenCount
      };
    })
    .filter((item) => item._score > 0)
    .sort((a, b) => {
      if (b._score !== a._score) {
        return b._score - a._score;
      }

      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    })
    .slice(0, safeLimit)
    .map(({ _score, ...item }) => item);

  return {
    query: cleanQuery,
    count: results.length,
    results
  };
}

async function getRequiredProductDoc(products, slug) {
  const docRef = products.doc(slug);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createWorkflowError("Product not found", 404, { slug });
  }

  return {
    docRef,
    product: doc.data() || {}
  };
}

async function getRequiredPersistedAsset(assetCollection, assetId) {
  const docRef = assetCollection.doc(assetId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw createWorkflowError(`Persisted asset not found: ${assetId}`, 404, { assetId });
  }

  return {
    docRef,
    asset: normalizePersistedAssetRecord(doc.data() || {})
  };
}

async function analyzeUploadedImages({
  images,
  extractedData,
  summary,
  ocrText
}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw createWorkflowError("At least one chat-visible image is required for analysis", 400);
  }

  const normalizedImages = images.map((image, index) => {
    const fallbackId = `chat-image-${index + 1}`;
    const mimeType = normalizeAssetMimeType(image?.mimeType || image?.mime_type || "");

    return {
      chatImageId:
        typeof image?.chatImageId === "string" && image.chatImageId.trim()
          ? image.chatImageId.trim()
          : typeof image?.chat_image_id === "string" && image.chat_image_id.trim()
            ? image.chat_image_id.trim()
            : fallbackId,
      filename:
        typeof image?.filename === "string" && image.filename.trim()
          ? image.filename.trim()
          : typeof image?.name === "string" && image.name.trim()
            ? image.name.trim()
            : "",
      mimeType,
      sourceType: CHAT_VISIBLE_IMAGE_SOURCE
    };
  });

  return {
    lifecycle: "analysis_only",
    imageCount: normalizedImages.length,
    images: normalizedImages,
    summary: typeof summary === "string" ? summary.trim() : "",
    ocrText: typeof ocrText === "string" ? ocrText : "",
    extractedData: isPlainObject(extractedData) ? extractedData : {},
    persistedAssets: []
  };
}

async function uploadAssetsToStorage(
  {
    slug,
    assetType,
    purpose,
    subtype,
    notes,
    ocrRequested,
    reviewRequired,
    openaiFileIdRefs
  },
  deps = getAssetWorkflowDependencies()
) {
  if (!isValidSlug(slug)) {
    throw createWorkflowError("Invalid slug", 400, { slug });
  }

  if (typeof assetType !== "string" || !assetType.trim()) {
    throw createWorkflowError("Missing or invalid assetType", 400);
  }

  const cleanAssetType = assetType.trim();
  const assetFolder = getAssetFolder(cleanAssetType);

  if (!assetFolder) {
    throw createWorkflowError("Invalid assetType", 400, { assetType: cleanAssetType });
  }

  if (!Array.isArray(openaiFileIdRefs) || openaiFileIdRefs.length === 0) {
    throw createWorkflowError(
      "No backend-uploadable file references were provided. Chat-visible images must be uploaded into backend storage before they can be attached.",
      400
    );
  }

  const intakeMetadata = resolveAssetIntakeMetadata({
    purpose,
    subtype,
    notes,
    ocrRequested,
    reviewRequired
  });

  await getRequiredProductDoc(deps.productsCollection, slug);

  const bucket = deps.storage.bucket(deps.bucketName);
  const persistedAssets = [];

  for (const fileRef of openaiFileIdRefs) {
    const downloadLink =
      typeof fileRef?.download_link === "string" ? fileRef.download_link.trim() : "";

    if (!downloadLink) {
      throw createWorkflowError(
        "The chat-visible image did not include a backend-downloadable file reference, so it could not be uploaded into backend asset storage.",
        400,
        { fileRef }
      );
    }

    const originalName =
      typeof fileRef?.name === "string" && fileRef.name.trim()
        ? fileRef.name.trim()
        : `uploaded-${Date.now()}`;
    const filename = sanitizeFilenameForStorage(originalName);
    const mimeType = ensureSupportedAssetMimeType(fileRef?.mime_type || fileRef?.mimeType || "");
    const assetId = randomUUID();
    const storageKey = `products/${slug}/asset-library/${assetId}-${filename}`;
    const response = await deps.fetchImpl(downloadLink);

    if (!response.ok) {
      throw createWorkflowError(
        `Failed to download uploaded file into backend storage: ${originalName}`,
        400,
        { filename: originalName }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
    const byteSize = buffer.byteLength;

    await bucket.file(storageKey).save(buffer, { contentType: mimeType });

    const persistedAsset = buildPersistedAssetRecord({
      assetId,
      slug,
      filename,
      mimeType,
      storageKey,
      canonicalUrl: buildCanonicalAssetUrl(storageKey, deps.bucketName),
      byteSize,
      checksumSha256,
      uploadSource: DEFAULT_ASSET_UPLOAD_SOURCE,
      uploadState: "persisted",
      intendedAssetType: cleanAssetType,
      purpose: intakeMetadata.purpose,
      subtype: intakeMetadata.subtype,
      notes: intakeMetadata.notes,
      ocrRequested: intakeMetadata.ocrRequested,
      reviewRequired: intakeMetadata.reviewRequired,
      sourceFileRef: {
        sourceName: originalName,
        mimeType,
        downloadLinkAvailable: true
      }
    });

    await deps.assetLibraryCollection.doc(assetId).set(persistedAsset);
    persistedAssets.push(normalizePersistedAssetRecord(persistedAsset));
  }

  return {
    slug,
    uploadedCount: persistedAssets.length,
    persistedAssets
  };
}

function getRepositoryUploadFilename(fileRef = {}) {
  const originalName =
    typeof fileRef?.name === "string" && fileRef.name.trim()
      ? fileRef.name.trim()
      : `uploaded-${Date.now()}.pdf`;

  return {
    originalName,
    safeFilename: sanitizeFilenameForStorage(originalName)
  };
}

function getRepositoryUploadMimeType(fileRef = {}) {
  const rawMimeType =
    typeof fileRef?.mime_type === "string" && fileRef.mime_type.trim()
      ? fileRef.mime_type.trim()
      : typeof fileRef?.mimeType === "string" && fileRef.mimeType.trim()
        ? fileRef.mimeType.trim()
        : "";

  if (rawMimeType) {
    return normalizeAssetMimeType(rawMimeType);
  }

  const filename =
    typeof fileRef?.name === "string" && fileRef.name.trim() ? fileRef.name.trim().toLowerCase() : "";

  if (filename.endsWith(".pdf")) {
    return "application/pdf";
  }

  return "";
}

function buildRepositoryDocumentSummary(document = {}) {
  return {
    documentId: typeof document.documentId === "string" ? document.documentId : "",
    title: typeof document.title === "string" ? document.title : "",
    originalFilename: typeof document.originalFilename === "string" ? document.originalFilename : "",
    storagePath: typeof document.storagePath === "string" ? document.storagePath : "",
    canonicalUrl: typeof document.canonicalUrl === "string" ? document.canonicalUrl : "",
    byteSize: typeof document.byteSize === "number" ? document.byteSize : 0,
    mimeType: typeof document.mimeType === "string" ? document.mimeType : "",
    uploadedAt: typeof document.uploadedAt === "string" ? document.uploadedAt : "",
    createdAt: typeof document.createdAt === "string" ? document.createdAt : "",
    updatedAt: typeof document.updatedAt === "string" ? document.updatedAt : "",
    uploadedBy: typeof document.uploadedBy === "string" ? document.uploadedBy : "",
    originalFolderLabel:
      typeof document.originalFolderLabel === "string" ? document.originalFolderLabel : "",
    binLabel: typeof document.binLabel === "string" ? document.binLabel : "",
    scanBatchLabel: typeof document.scanBatchLabel === "string" ? document.scanBatchLabel : "",
    sourceLocationNotes:
      typeof document.sourceLocationNotes === "string" ? document.sourceLocationNotes : "",
    documentType: typeof document.documentType === "string" ? document.documentType : "",
    reviewStatus: typeof document.reviewStatus === "string" ? document.reviewStatus : "",
    ocr: {
      status:
        typeof document.ocr?.status === "string"
          ? document.ocr.status
          : getDefaultRepositoryDocumentOcr().status
    },
    linkedKnowledgeItemIds: Array.isArray(document.linkedKnowledgeItemIds)
      ? document.linkedKnowledgeItemIds
      : []
  };
}

function buildRepositoryDocumentSearchText(document = {}) {
  return [
    document.title || "",
    document.originalFilename || "",
    document.originalFolderLabel || "",
    document.binLabel || "",
    document.scanBatchLabel || "",
    document.sourceLocationNotes || "",
    document.ocr?.bestText || ""
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildRepositoryDocumentSearchResultSummary(document = {}, fallbackDocumentId = "") {
  return {
    documentId: document.documentId || fallbackDocumentId,
    title: document.title || "",
    originalFilename: document.originalFilename || "",
    originalFolderLabel: document.originalFolderLabel || "",
    binLabel: document.binLabel || "",
    scanBatchLabel: document.scanBatchLabel || "",
    uploadedAt: document.uploadedAt || "",
    reviewStatus: document.reviewStatus || "",
    bestTextSource: document.ocr?.bestTextSource || "",
    ocrStatus: document.ocr?.status || ""
  };
}

function buildRepositoryItemSearchText(item = {}) {
  return [
    item.title || "",
    item.itemType || "",
    item.canonicalSummary || ""
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildRepositoryItemSearchResultSummary(item = {}, fallbackItemId = "") {
  const linkedDocumentIds = Array.isArray(item.linkedDocumentIds) ? item.linkedDocumentIds : [];

  return {
    itemId: item.itemId || fallbackItemId,
    title: item.title || "",
    itemType: item.itemType || "",
    canonicalSummary: item.canonicalSummary || "",
    linkedDocumentCount: linkedDocumentIds.length,
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || ""
  };
}

function getRepositoryDocumentOcrBaseName(documentId, sourceFilename) {
  const safeFilename = sanitizeFilenameForStorage(
    typeof sourceFilename === "string" && sourceFilename.trim()
      ? sourceFilename.trim()
      : `document-${documentId}.pdf`
  );

  return safeFilename.replace(/\.[^.]+$/, "").trim() || `document-${documentId}`;
}

function getRepositoryDocumentRawOcrOutputPath(documentId, sourceFilename) {
  const base = getRepositoryDocumentOcrBaseName(documentId, sourceFilename);
  return `repository/documents/${documentId}/ocr/raw/${base}.json`;
}

function getRepositoryDocumentTextOcrOutputPath(documentId, sourceFilename) {
  const base = getRepositoryDocumentOcrBaseName(documentId, sourceFilename);
  return `repository/documents/${documentId}/ocr/text/${base}.txt`;
}

async function uploadRepositoryDocumentsToStorage(
  {
    openaiFileIdRefs,
    originalFolderLabel,
    binLabel,
    scanBatchLabel,
    sourceLocationNotes,
    uploadedBy
  },
  deps = getRepositoryWorkflowDependencies()
) {
  if (!Array.isArray(openaiFileIdRefs) || openaiFileIdRefs.length === 0) {
    throw createWorkflowError(
      "No backend-uploadable file references were provided for repository document upload.",
      400
    );
  }

  const bucket = deps.storage.bucket(deps.bucketName);
  const createdDocuments = [];
  const cleanUploadedBy = typeof uploadedBy === "string" ? uploadedBy.trim() : "";
  const cleanOriginalFolderLabel =
    typeof originalFolderLabel === "string" ? originalFolderLabel.trim() : "";
  const cleanBinLabel = typeof binLabel === "string" ? binLabel.trim() : "";
  const cleanScanBatchLabel = typeof scanBatchLabel === "string" ? scanBatchLabel.trim() : "";
  const cleanSourceLocationNotes =
    typeof sourceLocationNotes === "string" ? sourceLocationNotes.trim() : "";

  for (const fileRef of openaiFileIdRefs) {
    if (!isPlainObject(fileRef)) {
      throw createWorkflowError(
        "Each repository file reference must be an object with a backend-downloadable file link.",
        400
      );
    }

    const downloadLink =
      typeof fileRef.download_link === "string" ? fileRef.download_link.trim() : "";

    if (!downloadLink) {
      throw createWorkflowError(
        "Each repository file reference must include a backend-downloadable download_link.",
        400,
        { fileRef }
      );
    }

    const { originalName, safeFilename } = getRepositoryUploadFilename(fileRef);
    const mimeType = getRepositoryUploadMimeType(fileRef);

    if (mimeType !== "application/pdf") {
      throw createWorkflowError(
        `Unsupported repository document type for ${originalName}. Only PDF files are supported.`,
        400,
        { filename: originalName, mimeType: mimeType || "" }
      );
    }

    const response = await deps.fetchImpl(downloadLink);

    if (!response.ok) {
      throw createWorkflowError(
        `Failed to download uploaded repository file into backend storage: ${originalName}`,
        400,
        { filename: originalName }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const byteSize = buffer.byteLength;
    const documentId = randomUUID();
    const storagePath = `repository/documents/${documentId}-${safeFilename}`;
    const canonicalUrl = buildCanonicalAssetUrl(storagePath, deps.bucketName);
    const uploadedAt = getNowIso();

    const titleFromOriginal = originalName.replace(/\.[^.]+$/, "").trim();
    const titleFromSanitized = safeFilename.replace(/\.[^.]+$/, "").trim();
    const resolvedTitle = titleFromOriginal || titleFromSanitized;

    await bucket.file(storagePath).save(buffer, { contentType: mimeType });

    const createdDocument = buildDefaultRepositoryDocumentRecord({
      documentId,
      title: resolvedTitle,
      originalFilename: originalName,
      storagePath,
      canonicalUrl,
      byteSize,
      mimeType,
      uploadedAt,
      uploadedBy: cleanUploadedBy,
      originalFolderLabel: cleanOriginalFolderLabel,
      binLabel: cleanBinLabel,
      scanBatchLabel: cleanScanBatchLabel,
      sourceLocationNotes: cleanSourceLocationNotes
    });

    await deps.repositoryDocumentsCollection.doc(documentId).set(createdDocument);
    createdDocuments.push(buildRepositoryDocumentSummary(createdDocument));
  }

  return {
    count: createdDocuments.length,
    documents: createdDocuments
  };
}

async function searchRepositoryDocuments(
  {
    query,
    limit = 10,
    originalFolderLabel,
    binLabel,
    scanBatchLabel
  },
  deps = getRepositoryWorkflowDependencies()
) {
  if (typeof query !== "string" || !query.trim()) {
    throw createWorkflowError("Missing or invalid query", 400);
  }

  const cleanQuery = query.trim().toLowerCase();
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const cleanOriginalFolderLabel =
    typeof originalFolderLabel === "string" ? originalFolderLabel.trim() : "";
  const cleanBinLabel = typeof binLabel === "string" ? binLabel.trim() : "";
  const cleanScanBatchLabel = typeof scanBatchLabel === "string" ? scanBatchLabel.trim() : "";
  const snapshot = await deps.repositoryDocumentsCollection.limit(200).get();

  const results = snapshot.docs
    .map((doc) => {
      const document = doc.data() || {};
      const matchesOriginalFolderLabel =
        !cleanOriginalFolderLabel || document.originalFolderLabel === cleanOriginalFolderLabel;
      const matchesBinLabel = !cleanBinLabel || document.binLabel === cleanBinLabel;
      const matchesScanBatchLabel =
        !cleanScanBatchLabel || document.scanBatchLabel === cleanScanBatchLabel;
      const searchText = buildRepositoryDocumentSearchText(document);
      const matchedTokenCount = tokens.filter((token) => searchText.includes(token)).length;

      return {
        ...buildRepositoryDocumentSearchResultSummary(document, doc.id),
        _matchesFilters:
          matchesOriginalFolderLabel && matchesBinLabel && matchesScanBatchLabel,
        _score: matchedTokenCount
      };
    })
    .filter((item) => item._matchesFilters && item._score > 0)
    .sort((a, b) => {
      if (b._score !== a._score) {
        return b._score - a._score;
      }

      return (b.uploadedAt || "").localeCompare(a.uploadedAt || "");
    })
    .slice(0, safeLimit)
    .map(({ _matchesFilters, _score, ...item }) => item);

  return {
    query: cleanQuery,
    count: results.length,
    results
  };
}

async function listRepositoryDocumentsByProvenance(
  {
    originalFolderLabel,
    binLabel,
    scanBatchLabel
  },
  deps = getRepositoryWorkflowDependencies()
) {
  const cleanOriginalFolderLabel =
    typeof originalFolderLabel === "string" ? originalFolderLabel.trim() : "";
  const cleanBinLabel = typeof binLabel === "string" ? binLabel.trim() : "";
  const cleanScanBatchLabel = typeof scanBatchLabel === "string" ? scanBatchLabel.trim() : "";

  if (!cleanOriginalFolderLabel && !cleanBinLabel && !cleanScanBatchLabel) {
    throw createWorkflowError(
      "At least one provenance filter is required",
      400
    );
  }

  const snapshot = await deps.repositoryDocumentsCollection.limit(200).get();

  const documents = snapshot.docs
    .map((doc) => {
      const document = doc.data() || {};
      const matchesOriginalFolderLabel =
        !cleanOriginalFolderLabel || document.originalFolderLabel === cleanOriginalFolderLabel;
      const matchesBinLabel = !cleanBinLabel || document.binLabel === cleanBinLabel;
      const matchesScanBatchLabel =
        !cleanScanBatchLabel || document.scanBatchLabel === cleanScanBatchLabel;

      return {
        ...buildRepositoryDocumentSearchResultSummary(document, doc.id),
        _matchesFilters:
          matchesOriginalFolderLabel && matchesBinLabel && matchesScanBatchLabel
      };
    })
    .filter((item) => item._matchesFilters)
    .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))
    .map(({ _matchesFilters, ...item }) => item);

  return {
    count: documents.length,
    documents
  };
}

async function startRepositoryDocumentOcr(
  { documentId },
  deps = getRepositoryWorkflowDependencies()
) {
  const {
    documentId: cleanDocumentId,
    docRef,
    document
  } = await getRequiredRepositoryDocument(deps.repositoryDocumentsCollection, documentId);

  const mimeType = normalizeAssetMimeType(document.mimeType);

  if (mimeType !== "application/pdf") {
    throw createWorkflowError("Repository document OCR currently supports PDF files only.", 400, {
      documentId: cleanDocumentId,
      mimeType
    });
  }

  const sourceStoragePath =
    typeof document.storagePath === "string" && document.storagePath.trim()
      ? document.storagePath.trim()
      : "";

  if (!sourceStoragePath) {
    throw createWorkflowError("Repository document is missing storagePath", 400, {
      documentId: cleanDocumentId
    });
  }

  const sourceFilename =
    typeof document.originalFilename === "string" && document.originalFilename.trim()
      ? document.originalFilename.trim()
      : sourceStoragePath.split("/").pop() || `document-${cleanDocumentId}.pdf`;

  const rawOutputPath = getRepositoryDocumentRawOcrOutputPath(cleanDocumentId, sourceFilename);
  const textOutputPath = getRepositoryDocumentTextOcrOutputPath(cleanDocumentId, sourceFilename);

  const processingOcr = {
    ...getDefaultRepositoryDocumentOcr(),
    status: "processing",
    sourceStoragePath,
    rawOutputPath,
    textOutputPath
  };

  await docRef.update({
    ocr: processingOcr,
    updatedAt: getNowIso()
  });

  try {
    const ocrRun = await deps.runDocumentAiOcr({
      sourceStoragePath,
      sourceFilename,
      mimeType
    });

    await deps.saveJsonFileToStorage(rawOutputPath, ocrRun.rawResult);
    await deps.saveTextFileToStorage(textOutputPath, ocrRun.extractedText);

    const processedAt = getNowIso();
    const bestText = typeof ocrRun.extractedText === "string" ? ocrRun.extractedText : "";
    const completedOcr = {
      ...getDefaultRepositoryDocumentOcr(),
      status: "completed",
      sourceStoragePath,
      rawOutputPath,
      textOutputPath,
      extractedText: bestText,
      pageCount: typeof ocrRun.pageCount === "number" ? ocrRun.pageCount : 0,
      processedAt,
      error: "",
      bestText,
      bestTextSource: "extractedText",
      bestTextUpdatedAt: processedAt
    };

    await docRef.update({
      ocr: completedOcr,
      updatedAt: processedAt
    });

    return {
      documentId: cleanDocumentId,
      ocr: completedOcr
    };
  } catch (error) {
    const failedOcr = {
      ...getDefaultRepositoryDocumentOcr(),
      status: "failed",
      sourceStoragePath,
      rawOutputPath,
      textOutputPath,
      error: error.message || "OCR failed"
    };

    await docRef.update({
      ocr: failedOcr,
      updatedAt: getNowIso()
    });

    throw createWorkflowError(error.message || "OCR failed", 500, {
      documentId: cleanDocumentId
    });
  }
}

async function cleanupRepositoryDocumentOcr(
  { documentId },
  deps = getRepositoryWorkflowDependencies()
) {
  const {
    documentId: cleanDocumentId,
    docRef,
    document
  } = await getRequiredRepositoryDocument(deps.repositoryDocumentsCollection, documentId);

  const existingOcr = {
    ...getDefaultRepositoryDocumentOcr(),
    ...(isPlainObject(document.ocr) ? document.ocr : {})
  };
  const extractedText = getCleanupSourceText(existingOcr);

  if (!extractedText.trim()) {
    throw createWorkflowError("No OCR text available to clean", 400, {
      documentId: cleanDocumentId
    });
  }

  const processingOcr = {
    ...existingOcr,
    cleanupStatus: "processing",
    cleanupError: ""
  };

  await docRef.update({
    ocr: processingOcr,
    updatedAt: getNowIso()
  });

  try {
    const cleanedText = deps.cleanOcrText(extractedText);
    const cleanupProcessedAt = getNowIso();
    const completedOcr = {
      ...existingOcr,
      cleanedText,
      cleanupStatus: "completed",
      cleanupProcessedAt,
      cleanupError: "",
      bestText: cleanedText && cleanedText.trim() ? cleanedText : existingOcr.bestText,
      bestTextSource: cleanedText && cleanedText.trim() ? "cleanedText" : existingOcr.bestTextSource,
      bestTextUpdatedAt:
        cleanedText && cleanedText.trim() ? cleanupProcessedAt : existingOcr.bestTextUpdatedAt
    };

    await docRef.update({
      ocr: completedOcr,
      updatedAt: cleanupProcessedAt
    });

    return {
      documentId: cleanDocumentId,
      ocr: completedOcr
    };
  } catch (error) {
    const failedOcr = {
      ...existingOcr,
      cleanupStatus: "failed",
      cleanupProcessedAt: getNowIso(),
      cleanupError: error.message || "Cleanup failed"
    };

    await docRef.update({
      ocr: failedOcr,
      updatedAt: getNowIso()
    });

    throw createWorkflowError(error.message || "Cleanup failed", 500, {
      documentId: cleanDocumentId
    });
  }
}

async function normalizeRepositoryDocumentOcr(
  { documentId },
  deps = getRepositoryWorkflowDependencies()
) {
  const {
    documentId: cleanDocumentId,
    docRef,
    document
  } = await getRequiredRepositoryDocument(deps.repositoryDocumentsCollection, documentId);

  const existingOcr = {
    ...getDefaultRepositoryDocumentOcr(),
    ...(isPlainObject(document.ocr) ? document.ocr : {})
  };
  const sourceText = getNormalizationSourceText(existingOcr);

  if (!sourceText.trim()) {
    throw createWorkflowError("No OCR text available to normalize", 400, {
      documentId: cleanDocumentId
    });
  }

  const processingOcr = {
    ...existingOcr,
    normalizationStatus: "processing",
    normalizationError: ""
  };

  await docRef.update({
    ocr: processingOcr,
    updatedAt: getNowIso()
  });

  try {
    const normalizedText = deps.normalizeOcrText(sourceText);
    const normalizationProcessedAt = getNowIso();
    const completedOcr = {
      ...existingOcr,
      normalizedText,
      normalizationStatus: "completed",
      normalizationProcessedAt,
      normalizationError: "",
      bestText:
        normalizedText && normalizedText.trim() ? normalizedText : existingOcr.bestText,
      bestTextSource:
        normalizedText && normalizedText.trim()
          ? "normalizedText"
          : existingOcr.bestTextSource,
      bestTextUpdatedAt:
        normalizedText && normalizedText.trim()
          ? normalizationProcessedAt
          : existingOcr.bestTextUpdatedAt
    };

    await docRef.update({
      ocr: completedOcr,
      updatedAt: normalizationProcessedAt
    });

    return {
      documentId: cleanDocumentId,
      ocr: completedOcr
    };
  } catch (error) {
    const failedOcr = {
      ...existingOcr,
      normalizationStatus: "failed",
      normalizationProcessedAt: getNowIso(),
      normalizationError: error.message || "Normalization failed"
    };

    await docRef.update({
      ocr: failedOcr,
      updatedAt: getNowIso()
    });

    throw createWorkflowError(error.message || "Normalization failed", 500, {
      documentId: cleanDocumentId
    });
  }
}

async function aiCorrectRepositoryDocumentOcr(
  { documentId },
  deps = getRepositoryWorkflowDependencies()
) {
  const {
    documentId: cleanDocumentId,
    docRef,
    document
  } = await getRequiredRepositoryDocument(deps.repositoryDocumentsCollection, documentId);

  const existingOcr = {
    ...getDefaultRepositoryDocumentOcr(),
    ...(isPlainObject(document.ocr) ? document.ocr : {})
  };
  const sourceText = getFinalAiCorrectionSourceText(existingOcr);

  if (!sourceText.trim()) {
    throw createWorkflowError("No OCR text available to AI-correct", 400, {
      documentId: cleanDocumentId
    });
  }

  const processingOcr = {
    ...existingOcr,
    aiCorrectionStatus: "processing",
    aiCorrectionError: ""
  };

  await docRef.update({
    ocr: processingOcr,
    updatedAt: getNowIso()
  });

  try {
    const aiCorrectedText = await deps.runAiCorrection(sourceText);
    const aiCorrectionProcessedAt = getNowIso();
    const completedOcr = {
      ...existingOcr,
      aiCorrectedText,
      aiCorrectionStatus: "completed",
      aiCorrectionProcessedAt,
      aiCorrectionError: "",
      bestText:
        aiCorrectedText && aiCorrectedText.trim() ? aiCorrectedText : existingOcr.bestText,
      bestTextSource:
        aiCorrectedText && aiCorrectedText.trim()
          ? "aiCorrectedText"
          : existingOcr.bestTextSource,
      bestTextUpdatedAt:
        aiCorrectedText && aiCorrectedText.trim()
          ? aiCorrectionProcessedAt
          : existingOcr.bestTextUpdatedAt
    };

    await docRef.update({
      ocr: completedOcr,
      updatedAt: aiCorrectionProcessedAt
    });

    return {
      documentId: cleanDocumentId,
      ocr: completedOcr
    };
  } catch (error) {
    const failedOcr = {
      ...existingOcr,
      aiCorrectionStatus: "failed",
      aiCorrectionProcessedAt: getNowIso(),
      aiCorrectionError: error.message || "AI correction failed"
    };

    await docRef.update({
      ocr: failedOcr,
      updatedAt: getNowIso()
    });

    throw createWorkflowError(error.message || "AI correction failed", 500, {
      documentId: cleanDocumentId
    });
  }
}

async function humanReviewRepositoryDocumentOcr(
  { documentId, humanReviewedText },
  deps = getRepositoryWorkflowDependencies()
) {
  const {
    documentId: cleanDocumentId,
    docRef,
    document
  } = await getRequiredRepositoryDocument(deps.repositoryDocumentsCollection, documentId);

  if (typeof humanReviewedText !== "string" || !humanReviewedText.trim()) {
    throw createWorkflowError("Missing or invalid humanReviewedText", 400, {
      documentId: cleanDocumentId
    });
  }

  const cleanHumanReviewedText = humanReviewedText.trim();
  const existingOcr = {
    ...getDefaultRepositoryDocumentOcr(),
    ...(isPlainObject(document.ocr) ? document.ocr : {})
  };
  const bestTextUpdatedAt = getNowIso();
  const updatedOcr = {
    ...existingOcr,
    humanReviewedText: cleanHumanReviewedText,
    bestText: cleanHumanReviewedText,
    bestTextSource: "humanReviewedText",
    bestTextUpdatedAt
  };

  await docRef.update({
    ocr: updatedOcr,
    updatedAt: bestTextUpdatedAt
  });

  return {
    documentId: cleanDocumentId,
    ocr: updatedOcr
  };
}

async function attachAssetsToProduct(
  {
    slug,
    assetIds,
    assetType,
    assetRole,
    purpose,
    subtype,
    notes,
    ocrRequested,
    reviewRequired,
    chatVisibleImages,
    openaiFileIdRefs
  },
  deps = getAssetWorkflowDependencies()
) {
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    const attemptedChatVisibleAttach =
      (Array.isArray(chatVisibleImages) && chatVisibleImages.length > 0) ||
      (Array.isArray(openaiFileIdRefs) && openaiFileIdRefs.length > 0);

    throw createWorkflowError(
      attemptedChatVisibleAttach
        ? CHAT_VISIBLE_IMAGES_NOT_ATTACHABLE_ERROR
        : "Attach failed because one or more backend asset IDs are required.",
      400
    );
  }

  if (!isValidSlug(slug)) {
    throw createWorkflowError("Invalid slug", 400, { slug });
  }

  const { docRef, product } = await getRequiredProductDoc(deps.productsCollection, slug);
  const assets = getSafeAssets(product);
  const attachedAssets = [];
  const duplicateAssetIds = [];

  for (const rawAssetId of assetIds) {
    const cleanAssetId =
      typeof rawAssetId === "string" && rawAssetId.trim() ? rawAssetId.trim() : "";

    if (!cleanAssetId) {
      throw createWorkflowError("Attach failed because one or more asset IDs were empty.", 400);
    }

    const { asset } = await getRequiredPersistedAsset(deps.assetLibraryCollection, cleanAssetId);
    const resolvedAssetType =
      typeof assetType === "string" && assetType.trim()
        ? assetType.trim()
        : asset.intendedAssetType;
    const assetArrayPath = getAssetArrayPath(resolvedAssetType);

    if (!assetArrayPath) {
      throw createWorkflowError(
        `Persisted asset ${cleanAssetId} is missing a valid target assetType.`,
        400,
        { assetId: cleanAssetId }
      );
    }

    const assetList = Array.isArray(assets[resolvedAssetType]) ? assets[resolvedAssetType] : [];
    const alreadyAttached = assetList.some((item) => item?.assetId === cleanAssetId);

    if (alreadyAttached) {
      duplicateAssetIds.push(cleanAssetId);
      continue;
    }

    const attachment = buildProductAssetAttachment({
      persistedAsset: asset,
      assetType: resolvedAssetType,
      assetRole,
      purpose,
      subtype,
      notes,
      ocrRequested,
      reviewRequired
    });

    assets[resolvedAssetType] = assetList.concat(attachment);
    attachedAssets.push(attachment);
  }

  await docRef.update({
    assets,
    updatedAt: getNowIso()
  });

  return {
    slug,
    attachedCount: attachedAssets.length,
    duplicateAssetIds,
    attachedAssets
  };
}

async function importConversationFilesToProduct({
  slug,
  assetType,
  purpose,
  subtype,
  notes,
  ocrRequested,
  reviewRequired,
  openaiFileIdRefs
}) {
  const cleanAssetType = assetType.trim();
  const assetArrayPath = getAssetArrayPath(cleanAssetType);
  const assetFolder = getAssetFolder(cleanAssetType);

  if (!assetArrayPath || !assetFolder) {
    throw new Error("Invalid assetType");
  }

  const docRef = productsCollection.doc(slug);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new Error("Product not found");
  }

  const intakeMetadata = resolveAssetIntakeMetadata({
    purpose,
    subtype,
    notes,
    ocrRequested,
    reviewRequired
  });

  const bucket = storage.bucket(BUCKET_NAME);
  const importedAssets = [];
  const ocrResults = [];

  for (const fileRef of openaiFileIdRefs) {
    const originalName =
      typeof fileRef?.name === "string" && fileRef.name.trim()
        ? fileRef.name.trim()
        : `uploaded-${Date.now()}`;

    const mimeType =
      typeof fileRef?.mime_type === "string" && fileRef.mime_type.trim()
        ? fileRef.mime_type.trim()
        : "application/octet-stream";

    const downloadLink =
      typeof fileRef?.download_link === "string" ? fileRef.download_link.trim() : "";

    if (!downloadLink) {
      throw new Error(`Missing download link for uploaded file: ${originalName}`);
    }

    const safeFilename = sanitizeFilenameForStorage(originalName);
    const storagePath = `products/${slug}/${assetFolder}/${safeFilename}`;

    const response = await fetch(downloadLink);
    if (!response.ok) {
      throw new Error(`Failed to download uploaded file: ${originalName}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const file = bucket.file(storagePath);
    await file.save(buffer, { contentType: mimeType });

    const assetRecord = buildAssetRecord({
      filename: safeFilename,
      storagePath,
      contentType: mimeType,
      purpose: intakeMetadata.purpose,
      subtype: intakeMetadata.subtype,
      notes: intakeMetadata.notes,
      ocrRequested: intakeMetadata.ocrRequested,
      reviewRequired: intakeMetadata.reviewRequired
    });

    await docRef.update({
      [assetArrayPath]: Firestore.FieldValue.arrayUnion(assetRecord),
      updatedAt: getNowIso()
    });

    importedAssets.push(assetRecord);

    if (intakeMetadata.ocrRequested && isAllowedOcrAssetType(cleanAssetType)) {
      const ocrMode = getOcrModeForMimeType(mimeType);
      const rawOutputPath = getRawOcrOutputPath(slug, safeFilename);
      const textOutputPath = getTextOcrOutputPath(slug, safeFilename);

      const baseRecord = withOcrDefaults(
        applyBestText({
          assetType: cleanAssetType,
          sourceFilename: safeFilename,
          sourceStoragePath: storagePath,
          mimeType,
          status: "processing",
          ocrProvider: "document_ai",
          ocrMode,
          rawOutputPath,
          textOutputPath,
          extractedText: "",
          pageCount: 0,
          processedAt: "",
          error: ""
        })
      );

      const currentProduct = (await docRef.get()).data() || {};
      const currentOcr = currentProduct.ocr || getDefaultOcrBlock();
      const currentDocs = Array.isArray(currentOcr.documents) ? currentOcr.documents : [];

      const docsWithoutExisting = currentDocs.filter(
        (item) => !(item?.sourceStoragePath === storagePath && item?.sourceFilename === safeFilename)
      );

      await docRef.update({
        ocr: {
          status: "processing",
          documents: [...docsWithoutExisting, baseRecord]
        },
        updatedAt: getNowIso()
      });

      const ocrRun = await runDocumentAiOcr({
        sourceStoragePath: storagePath,
        sourceFilename: safeFilename,
        mimeType
      });

      await saveJsonFileToStorage(rawOutputPath, ocrRun.rawResult);
      await saveTextFileToStorage(textOutputPath, ocrRun.extractedText);

      let updatedOcrRecord = withOcrDefaults(
        applyBestText({
          ...baseRecord,
          status: "completed",
          extractedText: ocrRun.extractedText,
          pageCount: ocrRun.pageCount,
          processedAt: getNowIso()
        })
      );

      try {
        updatedOcrRecord.aiInitialCorrectedText = await runAiCorrection(updatedOcrRecord.extractedText);
        updatedOcrRecord.aiInitialCorrectionStatus = "completed";
        updatedOcrRecord.aiInitialCorrectionProcessedAt = getNowIso();
        updatedOcrRecord.aiInitialCorrectionError = "";
      } catch (ocrAiInitialError) {
        updatedOcrRecord.aiInitialCorrectionStatus = "failed";
        updatedOcrRecord.aiInitialCorrectionProcessedAt = getNowIso();
        updatedOcrRecord.aiInitialCorrectionError = ocrAiInitialError.message;
      }

      updatedOcrRecord = applyBestText(updatedOcrRecord);

      updatedOcrRecord.cleanedText = cleanOcrText(getCleanupSourceText(updatedOcrRecord));
      updatedOcrRecord.cleanupStatus = "completed";
      updatedOcrRecord.cleanupProcessedAt = getNowIso();
      updatedOcrRecord = applyBestText(updatedOcrRecord);

      updatedOcrRecord.normalizedText = normalizeOcrText(getNormalizationSourceText(updatedOcrRecord));
      updatedOcrRecord.normalizationStatus = "completed";
      updatedOcrRecord.normalizationProcessedAt = getNowIso();
      updatedOcrRecord = applyBestText(updatedOcrRecord);

      try {
        updatedOcrRecord.aiCorrectedText = await runAiCorrection(
          getFinalAiCorrectionSourceText(updatedOcrRecord)
        );
        updatedOcrRecord.aiCorrectionStatus = "completed";
        updatedOcrRecord.aiCorrectionProcessedAt = getNowIso();
        updatedOcrRecord.aiCorrectionError = "";
      } catch (ocrAiError) {
        updatedOcrRecord.aiCorrectionStatus = "failed";
        updatedOcrRecord.aiCorrectionProcessedAt = getNowIso();
        updatedOcrRecord.aiCorrectionError = ocrAiError.message;
      }

      updatedOcrRecord = withOcrDefaults(applyBestText(updatedOcrRecord));

      const refreshedProduct = (await docRef.get()).data() || {};
      const refreshedOcr = refreshedProduct.ocr || getDefaultOcrBlock();
      const refreshedDocs = Array.isArray(refreshedOcr.documents) ? refreshedOcr.documents : [];

      const replacedDocs = refreshedDocs
        .filter(
          (item) => !(item?.sourceStoragePath === storagePath && item?.sourceFilename === safeFilename)
        )
        .concat(updatedOcrRecord);

      await docRef.update({
        ocr: {
          status: computeOverallOcrStatus(replacedDocs),
          documents: replacedDocs
        },
        updatedAt: getNowIso()
      });

      ocrResults.push({
        filename: safeFilename,
        status: updatedOcrRecord.aiCorrectionStatus === "completed" ? "completed" : "partial",
        bestTextSource: updatedOcrRecord.bestTextSource,
        pageCount: updatedOcrRecord.pageCount
      });
    }
  }

  return {
    slug,
    importedCount: importedAssets.length,
    importedAssets,
    ocrRequested: intakeMetadata.ocrRequested,
    ocrResults
  };
}

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "bhe-product-api",
    message: "API is running"
  });
});

app.get("/health", (req, res) => {
  const checks = {
    bheApiKeyConfigured: Boolean(process.env.BHE_API_KEY),
    openAiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    documentAiProcessorConfigured: Boolean(process.env.DOCUMENT_AI_PROCESSOR_ID)
  };

  const ok = Object.values(checks).every(Boolean);

  return res.status(ok ? 200 : 500).json({ ok, checks });
});

app.post("/products", async (req, res) => {
  try {
    const { slug, title, productType } = req.body;

    if (
      typeof slug !== "string" ||
      typeof title !== "string" ||
      typeof productType !== "string" ||
      !slug.trim() ||
      !title.trim() ||
      !productType.trim() ||
      !isValidSlug(slug)
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanSlug = slug.trim();
    const docRef = productsCollection.doc(cleanSlug);
    const existingDoc = await docRef.get();

    if (existingDoc.exists) {
      return res.status(409).json({ ok: false, error: "Product already exists" });
    }

    const product = buildDefaultProduct({
      slug: cleanSlug,
      title: title.trim(),
      productType: productType.trim()
    });

    const productWithSearchText = {
      ...product,
      searchText: buildSearchText(product)
    };

    await docRef.set(productWithSearchText);

    return res.status(201).json({
      ok: true,
      slug: productWithSearchText.slug,
      message: "Product created"
    });
  } catch (error) {
    console.error("Error creating product:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/search", async (req, res) => {
  try {
    const { query, limit = 10 } = req.body;

    if (typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or invalid query" });
    }

    const cleanQuery = query.trim().toLowerCase();
    const tokens = cleanQuery.split(/\s+/).filter(Boolean);
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);

    const snapshot = await productsCollection.limit(200).get();

    const results = snapshot.docs
      .map((doc) => {
        const product = doc.data() || {};
        const fallbackSearchText = buildSearchText(product);
        const searchText =
          typeof product.searchText === "string" && product.searchText.trim()
            ? product.searchText
            : fallbackSearchText;

        const matchedTokenCount = tokens.filter((token) => searchText.includes(token)).length;

        return {
          slug: product.slug || doc.id,
          title: product.title || "",
          subtitle: product.subtitle || "",
          productType: product.productType || "",
          status: product.status || "",
          series: product.series || null,
          authors: Array.isArray(product.authors) ? product.authors : [],
          updatedAt: product.updatedAt || "",
          _score: matchedTokenCount
        };
      })
      .filter((item) => item._score > 0)
      .sort((a, b) => {
        if (b._score !== a._score) {
          return b._score - a._score;
        }
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      })
      .slice(0, safeLimit)
      .map(({ _score, ...item }) => item);

    return res.status(200).json({
      ok: true,
      query: cleanQuery,
      count: results.length,
      results
    });
  } catch (error) {
    console.error("Error searching products:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.get("/products", async (req, res) => {
  try {
    const rawLimit = req.query.limit;
    const safeLimit = Math.min(Math.max(Number(rawLimit) || 25, 1), 100);

    const snapshot = await productsCollection.limit(200).get();

    const products = snapshot.docs
      .map((doc) => buildProductListItem(doc.data() || {}, doc.id))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .slice(0, safeLimit);

    return res.status(200).json({ ok: true, count: products.length, products });
  } catch (error) {
    console.error("Error listing products:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.get("/products/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    return res.status(200).json({ ok: true, product: doc.data() });
  } catch (error) {
    console.error("Error fetching product:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.get("/products/:slug/assets", async (req, res) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data() || {};
    const assets = getSafeAssets(product);

    return res.status(200).json({ ok: true, slug, assets });
  } catch (error) {
    console.error("Error fetching assets:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/images/analyze-uploaded-images", async (req, res) => {
  try {
    const analysis = await analyzeUploadedImages(req.body || {});
    return res.status(200).json({ ok: true, analysis });
  } catch (error) {
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Image analysis failed" });
  }
});

async function handleFileHandoffDiagnostic(req, res) {
  try {
    const diagnostic = buildFileHandoffDiagnosticSummary(req);
    console.log("File handoff diagnostic request:", JSON.stringify(diagnostic));
    return res.status(200).json({ ok: true, diagnostic });
  } catch (error) {
    console.error("Error building file handoff diagnostic:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Diagnostic failed" });
  }
}

app.post("/debug/file-handoff-inspect", handleFileHandoffDiagnostic);
app.post("/debug/cloud-run-action-payload-inspect", handleFileHandoffDiagnostic);

app.post("/products/:slug/assets/upload-openai-files", async (req, res) => {
  try {
    const result = await uploadAssetsToStorage(
      {
        slug: req.params.slug,
        ...req.body
      },
      getAssetWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message:
        "Files were uploaded into backend asset storage. Attach them to the product with their assetIds in a separate step.",
      ...result
    });
  } catch (error) {
    console.error("Error uploading assets to storage:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Upload failed" });
  }
});

app.post("/products/:slug/assets/attach", async (req, res) => {
  try {
    const result = await attachAssetsToProduct(
      {
        slug: req.params.slug,
        ...req.body
      },
      getAssetWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message:
        result.attachedCount > 0
          ? "Backend-persisted assets were attached to the product record."
          : "No new assets were attached because all provided assetIds were already attached.",
      ...result
    });
  } catch (error) {
    console.error("Error attaching assets to product:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Attach failed" });
  }
});

app.post("/repository/documents/upload-openai-files", async (req, res) => {
  try {
    const result = await uploadRepositoryDocumentsToStorage(
      req.body || {},
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      count: result.count,
      documents: result.documents
    });
  } catch (error) {
    console.error("Error uploading repository documents to storage:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Upload failed" });
  }
});

app.post("/repository/items", async (req, res) => {
  try {
    const result = await createRepositoryItem(
      req.body || {},
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      item: result.item
    });
  } catch (error) {
    console.error("Error creating repository item:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Create failed" });
  }
});

app.get("/repository/items/:itemId", async (req, res) => {
  try {
    const result = await getRepositoryItemById(
      { itemId: req.params.itemId },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      item: result.item
    });
  } catch (error) {
    console.error("Error fetching repository item:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Fetch failed" });
  }
});

app.get("/repository/items/:itemId/documents", async (req, res) => {
  try {
    const result = await getRepositoryItemDocuments(
      { itemId: req.params.itemId },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      itemId: result.itemId,
      count: result.count,
      documents: result.documents
    });
  } catch (error) {
    console.error("Error fetching repository item documents:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Fetch failed" });
  }
});

app.post("/repository/items/:itemId/summary/save", async (req, res) => {
  try {
    const result = await saveRepositoryItemSummary(
      {
        itemId: req.params.itemId,
        canonicalSummary: req.body?.canonicalSummary
      },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message: "Repository item summary saved",
      item: result.item
    });
  } catch (error) {
    console.error("Error saving repository item summary:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Save failed" });
  }
});

app.post("/repository/items/:itemId/link-documents", async (req, res) => {
  try {
    const result = await linkRepositoryItemDocuments(
      {
        itemId: req.params.itemId,
        documentIds: req.body?.documentIds
      },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      itemId: result.itemId,
      linkedCount: result.linkedCount,
      linkedDocumentIds: result.linkedDocumentIds,
      item: result.item
    });
  } catch (error) {
    console.error("Error linking repository documents to item:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Link failed" });
  }
});

app.post("/repository/items/search", async (req, res) => {
  try {
    const result = await searchRepositoryItems(
      req.body || {},
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      query: result.query,
      count: result.count,
      results: result.results
    });
  } catch (error) {
    console.error("Error searching repository items:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Search failed" });
  }
});

app.post("/repository/documents/search", async (req, res) => {
  try {
    const result = await searchRepositoryDocuments(
      req.body || {},
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      query: result.query,
      count: result.count,
      results: result.results
    });
  } catch (error) {
    console.error("Error searching repository documents:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Search failed" });
  }
});

app.post("/repository/documents/by-provenance", async (req, res) => {
  try {
    const result = await listRepositoryDocumentsByProvenance(
      req.body || {},
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      count: result.count,
      documents: result.documents
    });
  } catch (error) {
    console.error("Error listing repository documents by provenance:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "List failed" });
  }
});

app.get("/repository/documents/:documentId", async (req, res) => {
  try {
    const result = await getRepositoryDocumentById(
      { documentId: req.params.documentId },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      document: result.document
    });
  } catch (error) {
    console.error("Error fetching repository document:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Fetch failed" });
  }
});

app.get("/repository/documents/:documentId/source-text", async (req, res) => {
  try {
    const result = await getRepositoryDocumentSourceText(
      { documentId: req.params.documentId },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      documentId: result.documentId,
      sourceText: result.sourceText
    });
  } catch (error) {
    console.error("Error fetching repository source text:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Fetch failed" });
  }
});

app.post("/repository/documents/:documentId/ocr/start", async (req, res) => {
  try {
    const result = await startRepositoryDocumentOcr(
      { documentId: req.params.documentId },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message: "Repository document OCR completed",
      documentId: result.documentId,
      ocr: result.ocr
    });
  } catch (error) {
    console.error("Error starting repository document OCR:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "OCR failed" });
  }
});

app.post("/repository/documents/:documentId/ocr/cleanup", async (req, res) => {
  try {
    const result = await cleanupRepositoryDocumentOcr(
      { documentId: req.params.documentId },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message: "Repository OCR cleanup completed",
      documentId: result.documentId,
      ocr: result.ocr
    });
  } catch (error) {
    console.error("Error cleaning repository OCR text:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "OCR cleanup failed" });
  }
});

app.post("/repository/documents/:documentId/ocr/normalize", async (req, res) => {
  try {
    const result = await normalizeRepositoryDocumentOcr(
      { documentId: req.params.documentId },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message: "Repository OCR normalization completed",
      documentId: result.documentId,
      ocr: result.ocr
    });
  } catch (error) {
    console.error("Error normalizing repository OCR text:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "OCR normalization failed" });
  }
});

app.post("/repository/documents/:documentId/ocr/ai-correct", async (req, res) => {
  try {
    const result = await aiCorrectRepositoryDocumentOcr(
      { documentId: req.params.documentId },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message: "Repository OCR AI correction completed",
      documentId: result.documentId,
      ocr: result.ocr
    });
  } catch (error) {
    console.error("Error AI-correcting repository OCR text:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "OCR AI correction failed" });
  }
});

app.post("/repository/documents/:documentId/ocr/human-review", async (req, res) => {
  try {
    const result = await humanReviewRepositoryDocumentOcr(
      {
        documentId: req.params.documentId,
        humanReviewedText: req.body?.humanReviewedText
      },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message: "Repository human-reviewed OCR text saved",
      documentId: result.documentId,
      ocr: result.ocr
    });
  } catch (error) {
    console.error("Error saving repository human-reviewed OCR text:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Human review failed" });
  }
});

app.post("/songs/search", async (req, res) => {
  try {
    const result = await searchSongs(
      req.body || {},
      getSongCatalogDependencies()
    );

    return res.status(200).json({
      ok: true,
      query: result.query,
      count: result.count,
      songs: result.songs,
      appliedFilters: result.appliedFilters,
      warnings: result.warnings
    });
  } catch (error) {
    console.error("Error searching songs:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "song_search_failed",
          fallbackMessage: "Song search failed"
        })
      );
  }
});

app.get("/songs/:songId", async (req, res) => {
  try {
    const result = await getSongById(
      { songId: req.params.songId },
      getSongCatalogDependencies()
    );

    return res.status(200).json({
      ok: true,
      song: result.song
    });
  } catch (error) {
    console.error("Error fetching song:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "song_fetch_failed",
          fallbackMessage: "Song fetch failed"
        })
      );
  }
});

app.post("/products/:slug/assets/upload", upload.single("file"), async (req, res) => {
  try {
    const { slug } = req.params;
    const {
      assetType,
      purpose,
      subtype,
      notes,
      ocrRequested,
      reviewRequired
    } = req.body;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file was provided" });
    }

    if (typeof assetType !== "string" || !assetType.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or invalid assetType" });
    }

    const cleanAssetType = assetType.trim();
    const assetArrayPath = getAssetArrayPath(cleanAssetType);
    const assetFolder = getAssetFolder(cleanAssetType);

    if (!assetArrayPath || !assetFolder) {
      return res.status(400).json({ ok: false, error: "Invalid assetType" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    let intakeMetadata = null;

    try {
      intakeMetadata = resolveAssetIntakeMetadata({
        purpose,
        subtype,
        notes,
        ocrRequested,
        reviewRequired
      });
    } catch (validationError) {
      return res.status(400).json({ ok: false, error: validationError.message });
    }

    const originalName =
      typeof req.file.originalname === "string" && req.file.originalname.trim()
        ? req.file.originalname.trim()
        : `uploaded-${Date.now()}`;

    const safeFilename = sanitizeFilenameForStorage(originalName);
    const mimeType = req.file.mimetype || "application/octet-stream";
    const storagePath = `products/${slug}/${assetFolder}/${safeFilename}`;

    const file = storage.bucket(BUCKET_NAME).file(storagePath);
    await file.save(req.file.buffer, {
      contentType: mimeType
    });

    const assetRecord = buildAssetRecord({
      filename: safeFilename,
      storagePath,
      contentType: mimeType,
      purpose: intakeMetadata.purpose,
      subtype: intakeMetadata.subtype,
      notes: intakeMetadata.notes,
      ocrRequested: intakeMetadata.ocrRequested,
      reviewRequired: intakeMetadata.reviewRequired
    });

    await docRef.update({
      [assetArrayPath]: Firestore.FieldValue.arrayUnion(assetRecord),
      updatedAt: getNowIso()
    });

    let ocr = null;

    if (intakeMetadata.ocrRequested && isAllowedOcrAssetType(cleanAssetType)) {
      try {
        const ocrMode = getOcrModeForMimeType(mimeType);
        const rawOutputPath = getRawOcrOutputPath(slug, safeFilename);
        const textOutputPath = getTextOcrOutputPath(slug, safeFilename);

        const baseRecord = withOcrDefaults(
          applyBestText({
            assetType: cleanAssetType,
            sourceFilename: safeFilename,
            sourceStoragePath: storagePath,
            mimeType,
            status: "processing",
            ocrProvider: "document_ai",
            ocrMode,
            rawOutputPath,
            textOutputPath,
            extractedText: "",
            pageCount: 0,
            processedAt: "",
            error: ""
          })
        );

        const currentProduct = (await docRef.get()).data() || {};
        const currentOcr = currentProduct.ocr || getDefaultOcrBlock();
        const currentDocs = Array.isArray(currentOcr.documents) ? currentOcr.documents : [];

        const docsWithoutExisting = currentDocs.filter(
          (item) => !(item?.sourceStoragePath === storagePath && item?.sourceFilename === safeFilename)
        );

        await docRef.update({
          ocr: {
            status: "processing",
            documents: [...docsWithoutExisting, baseRecord]
          },
          updatedAt: getNowIso()
        });

        const ocrRun = await runDocumentAiOcr({
          sourceStoragePath: storagePath,
          sourceFilename: safeFilename,
          mimeType
        });

        await saveJsonFileToStorage(rawOutputPath, ocrRun.rawResult);
        await saveTextFileToStorage(textOutputPath, ocrRun.extractedText);

        let updatedOcrRecord = withOcrDefaults(
          applyBestText({
            ...baseRecord,
            status: "completed",
            extractedText: ocrRun.extractedText,
            pageCount: ocrRun.pageCount,
            processedAt: getNowIso()
          })
        );

        try {
          updatedOcrRecord.aiInitialCorrectedText = await runAiCorrection(updatedOcrRecord.extractedText);
          updatedOcrRecord.aiInitialCorrectionStatus = "completed";
          updatedOcrRecord.aiInitialCorrectionProcessedAt = getNowIso();
          updatedOcrRecord.aiInitialCorrectionError = "";
        } catch (ocrAiInitialError) {
          updatedOcrRecord.aiInitialCorrectionStatus = "failed";
          updatedOcrRecord.aiInitialCorrectionProcessedAt = getNowIso();
          updatedOcrRecord.aiInitialCorrectionError = ocrAiInitialError.message;
        }

        updatedOcrRecord = applyBestText(updatedOcrRecord);

        updatedOcrRecord.cleanedText = cleanOcrText(getCleanupSourceText(updatedOcrRecord));
        updatedOcrRecord.cleanupStatus = "completed";
        updatedOcrRecord.cleanupProcessedAt = getNowIso();
        updatedOcrRecord = applyBestText(updatedOcrRecord);

        updatedOcrRecord.normalizedText = normalizeOcrText(getNormalizationSourceText(updatedOcrRecord));
        updatedOcrRecord.normalizationStatus = "completed";
        updatedOcrRecord.normalizationProcessedAt = getNowIso();
        updatedOcrRecord = applyBestText(updatedOcrRecord);

        try {
          updatedOcrRecord.aiCorrectedText = await runAiCorrection(
            getFinalAiCorrectionSourceText(updatedOcrRecord)
          );
          updatedOcrRecord.aiCorrectionStatus = "completed";
          updatedOcrRecord.aiCorrectionProcessedAt = getNowIso();
          updatedOcrRecord.aiCorrectionError = "";
        } catch (ocrAiError) {
          updatedOcrRecord.aiCorrectionStatus = "failed";
          updatedOcrRecord.aiCorrectionProcessedAt = getNowIso();
          updatedOcrRecord.aiCorrectionError = ocrAiError.message;
        }

        updatedOcrRecord = withOcrDefaults(applyBestText(updatedOcrRecord));

        const refreshedProduct = (await docRef.get()).data() || {};
        const refreshedOcr = refreshedProduct.ocr || getDefaultOcrBlock();
        const refreshedDocs = Array.isArray(refreshedOcr.documents) ? refreshedOcr.documents : [];

        const replacedDocs = refreshedDocs
          .filter(
            (item) => !(item?.sourceStoragePath === storagePath && item?.sourceFilename === safeFilename)
          )
          .concat(updatedOcrRecord);

        await docRef.update({
          ocr: {
            status: computeOverallOcrStatus(replacedDocs),
            documents: replacedDocs
          },
          updatedAt: getNowIso()
        });

        ocr = {
          status: updatedOcrRecord.aiCorrectionStatus === "completed" ? "completed" : "partial",
          bestTextSource: updatedOcrRecord.bestTextSource,
          pageCount: updatedOcrRecord.pageCount
        };
      } catch (ocrError) {
        ocr = {
          status: "failed",
          error: ocrError.message || "OCR failed"
        };
      }
    }

    return res.status(200).json({
      ok: true,
      message: "File uploaded and asset registered",
      slug,
      asset: assetRecord,
      ocr
    });
  } catch (error) {
    console.error("Error uploading asset:", error);
    return res.status(500).json({ ok: false, error: "Upload failed" });
  }
});

app.post("/products/:slug/assets/upload-from-url", async (req, res) => {
  try {
    const { slug } = req.params;
    const {
      assetType,
      fileUrl,
      filename,
      purpose,
      subtype,
      notes,
      ocrRequested,
      reviewRequired
    } = req.body;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    if (typeof assetType !== "string" || !assetType.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or invalid assetType" });
    }

    if (typeof fileUrl !== "string" || !fileUrl.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or invalid fileUrl" });
    }

    const cleanAssetType = assetType.trim();
    const cleanFileUrl = fileUrl.trim();
if (!/^https?:\/\//i.test(cleanFileUrl)) {
  return res.status(400).json({
    ok: false,
    error: "fileUrl must be a publicly reachable http or https URL"
  });
}
    const assetArrayPath = getAssetArrayPath(cleanAssetType);
    const assetFolder = getAssetFolder(cleanAssetType);

    if (!assetArrayPath || !assetFolder) {
      return res.status(400).json({ ok: false, error: "Invalid assetType" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    let intakeMetadata = null;

    try {
      intakeMetadata = resolveAssetIntakeMetadata({
        purpose,
        subtype,
        notes,
        ocrRequested,
        reviewRequired
      });
    } catch (validationError) {
      return res.status(400).json({ ok: false, error: validationError.message });
    }

    const response = await fetch(cleanFileUrl);
    if (!response.ok) {
      return res.status(400).json({ ok: false, error: "Failed to download fileUrl" });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const contentType =
      response.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";

    const inferredFilename =
      (typeof filename === "string" && filename.trim())
        ? filename.trim()
        : cleanFileUrl.split("/").pop() || `uploaded-${Date.now()}`;

    const safeFilename = sanitizeFilenameForStorage(inferredFilename);
    const storagePath = `products/${slug}/${assetFolder}/${safeFilename}`;

    const file = storage.bucket(BUCKET_NAME).file(storagePath);
    await file.save(buffer, { contentType });

    const assetRecord = buildAssetRecord({
      filename: safeFilename,
      storagePath,
      contentType,
      purpose: intakeMetadata.purpose,
      subtype: intakeMetadata.subtype,
      notes: intakeMetadata.notes,
      ocrRequested: intakeMetadata.ocrRequested,
      reviewRequired: intakeMetadata.reviewRequired
    });

    await docRef.update({
      [assetArrayPath]: Firestore.FieldValue.arrayUnion(assetRecord),
      updatedAt: getNowIso()
    });

    return res.status(200).json({
      ok: true,
      message: "File downloaded, stored, and registered",
      slug,
      asset: assetRecord
    });
  } catch (error) {
    console.error("Error uploading asset from URL:", error);
    return res.status(500).json({ ok: false, error: "Upload failed" });
  }
});

app.post("/products/:slug/assets/import-openai-files", async (req, res) => {
  try {
    const result = await uploadAssetsToStorage(
      {
        slug: req.params.slug,
        ...req.body
      },
      getAssetWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message:
        "Files were uploaded into backend asset storage. Attach them to the product with their assetIds in a separate step.",
      ...result
    });
  } catch (error) {
    console.error("Error importing OpenAI files:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Import failed" });
  }
});

app.post("/products/:slug/assets/download-url", async (req, res) => {
  try {
    const { slug } = req.params;
    const { assetType, storagePath } = req.body;

    if (
      !isValidSlug(slug) ||
      typeof assetType !== "string" ||
      typeof storagePath !== "string" ||
      !assetType.trim() ||
      !storagePath.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanAssetType = assetType.trim();
    const cleanStoragePath = storagePath.trim();

    const assetArrayPath = getAssetArrayPath(cleanAssetType);
    const assetFolder = getAssetFolder(cleanAssetType);

    if (!assetArrayPath || !assetFolder) {
      return res.status(400).json({ ok: false, error: "Invalid assetType" });
    }

    const expectedPrefix = `products/${slug}/${assetFolder}/`;

    if (!cleanStoragePath.startsWith(expectedPrefix)) {
      return res.status(400).json({ ok: false, error: "Invalid storagePath" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data() || {};
    const assets = getSafeAssets(product);
    const assetList = assets[cleanAssetType] || [];

    const assetExists = assetList.some((asset) => asset && asset.storagePath === cleanStoragePath);

    if (!assetExists) {
      return res.status(404).json({ ok: false, error: "Asset not found on product" });
    }

    const file = storage.bucket(BUCKET_NAME).file(cleanStoragePath);

    const [downloadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000
    });

    return res.status(200).json({
      ok: true,
      slug,
      assetType: cleanAssetType,
      storagePath: cleanStoragePath,
      downloadUrl
    });
  } catch (error) {
    console.error("Error generating download URL:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/archive", async (req, res) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data() || {};
    const updates = { status: "archived", updatedAt: getNowIso() };
    const mergedProduct = { ...product, ...updates };
    updates.searchText = buildSearchText(mergedProduct);

    await docRef.update(updates);

    return res.status(200).json({ ok: true, message: "Product archived", slug });
  } catch (error) {
    console.error("Error archiving product:", error);
    return res.status(500).json({ ok: false, error: "Archive failed" });
  }
});

app.delete("/products/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    await docRef.delete();

    return res.status(200).json({ ok: true, message: "Product deleted", slug });
  } catch (error) {
    console.error("Error deleting product:", error);
    return res.status(500).json({ ok: false, error: "Delete failed" });
  }
});

app.get("/products/:slug/source-text", async (req, res) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const sourceText = buildSourceTextPackage(product);

    return res.status(200).json({ ok: true, slug, sourceText });
  } catch (error) {
    console.error("Error fetching source text:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/intake/analyze", async (req, res) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data() || {};
    const analysis = buildIntakeAnalysis({ ...product, slug: product.slug || slug });

    return res.status(200).json({
      ok: true,
      slug,
      assetSummary: analysis.assetSummary,
      groupedAssets: analysis.groupedAssets,
      textFindings: analysis.textFindings,
      likelyProduct: analysis.likelyProduct,
      importantFacts: analysis.importantFacts,
      uncertainties: analysis.uncertainties,
      reviewRecommendations: analysis.reviewRecommendations,
      openQuestions: analysis.openQuestions
    });
  } catch (error) {
    console.error("Error analyzing intake:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/generate-draft", async (req, res) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const sourceTextPackage = buildSourceTextPackage(product);

    if (!sourceTextPackage.combinedText || !sourceTextPackage.combinedText.trim()) {
      return res.status(400).json({ ok: false, error: "No source text available for draft generation" });
    }

    const draft = await runDraftGeneration(product, sourceTextPackage);

    return res.status(200).json({ ok: true, slug, draft });
  } catch (error) {
    console.error("Error generating draft:", error);
    return res.status(500).json({ ok: false, error: "Draft generation failed" });
  }
});

app.post("/products/:slug/draft/save", async (req, res) => {
  try {
    const { slug } = req.params;
    const { draft } = req.body;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    if (!validateDraftPayload(draft)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid draft" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data() || {};
    const existingContent = isPlainObject(product.content) ? product.content : {};

    const updates = {
      title: draft.title.trim(),
      subtitle: draft.subtitle.trim(),
      content: {
        ...existingContent,
        shortDescription: draft.shortDescription.trim(),
        mainDescription: draft.mainDescription.trim(),
        featureBullets: draft.featureBullets.map((item) => item.trim()),
        seoTitle: draft.seoTitle.trim(),
        metaDescription: draft.metaDescription.trim()
      },
      updatedAt: getNowIso()
    };

    const mergedProduct = { ...product, ...updates, content: updates.content };
    updates.searchText = buildSearchText(mergedProduct);

    await docRef.update(updates);

    return res.status(200).json({ ok: true, message: "Draft saved", slug });
  } catch (error) {
    console.error("Error saving draft:", error);
    return res.status(500).json({ ok: false, error: "Draft save failed" });
  }
});

app.post("/products/:slug/assets/upload-url", async (req, res) => {
  try {
    const { slug } = req.params;
    const { assetType, filename, contentType } = req.body;

    if (
      !isValidSlug(slug) ||
      typeof assetType !== "string" ||
      typeof filename !== "string" ||
      typeof contentType !== "string" ||
      !assetType.trim() ||
      !filename.trim() ||
      !contentType.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanAssetType = assetType.trim();
    const cleanFilename = filename.trim();
    const cleanContentType = contentType.trim();
    const assetFolder = getAssetFolder(cleanAssetType);

    if (!assetFolder) {
      return res.status(400).json({ ok: false, error: "Invalid assetType" });
    }

    if (!isValidFilename(cleanFilename)) {
      return res.status(400).json({ ok: false, error: "Invalid filename" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const storagePath = `products/${slug}/${assetFolder}/${cleanFilename}`;
    const file = storage.bucket(BUCKET_NAME).file(storagePath);

    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType: cleanContentType
    });

    return res.status(200).json({ ok: true, uploadUrl, storagePath });
  } catch (error) {
    console.error("Error generating upload URL:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/assets/register", async (req, res) => {
  try {
    const { slug } = req.params;
    const {
      assetType,
      filename,
      storagePath,
      contentType,
      purpose,
      subtype,
      notes,
      ocrRequested,
      reviewRequired
    } = req.body;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    if (
      typeof assetType !== "string" ||
      typeof filename !== "string" ||
      typeof storagePath !== "string" ||
      typeof contentType !== "string" ||
      !assetType.trim() ||
      !filename.trim() ||
      !storagePath.trim() ||
      !contentType.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanAssetType = assetType.trim();
    const cleanFilename = filename.trim();
    const cleanStoragePath = storagePath.trim();
    const cleanContentType = contentType.trim();

    const assetArrayPath = getAssetArrayPath(cleanAssetType);
    const assetFolder = getAssetFolder(cleanAssetType);

    if (!assetArrayPath || !assetFolder) {
      return res.status(400).json({ ok: false, error: "Invalid assetType" });
    }

    if (!isValidFilename(cleanFilename)) {
      return res.status(400).json({ ok: false, error: "Invalid filename" });
    }

    const expectedPrefix = `products/${slug}/${assetFolder}/`;

    if (!cleanStoragePath.startsWith(expectedPrefix)) {
      return res.status(400).json({ ok: false, error: "Invalid storagePath" });
    }

    let intakeMetadata = null;

    try {
      intakeMetadata = resolveAssetIntakeMetadata({
        purpose,
        subtype,
        notes,
        ocrRequested,
        reviewRequired
      });
    } catch (validationError) {
      return res.status(400).json({ ok: false, error: validationError.message });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const assetRecord = buildAssetRecord({
      filename: cleanFilename,
      storagePath: cleanStoragePath,
      contentType: cleanContentType,
      purpose: intakeMetadata.purpose,
      subtype: intakeMetadata.subtype,
      notes: intakeMetadata.notes,
      ocrRequested: intakeMetadata.ocrRequested,
      reviewRequired: intakeMetadata.reviewRequired
    });

    await docRef.update({
      [assetArrayPath]: Firestore.FieldValue.arrayUnion(assetRecord),
      updatedAt: getNowIso()
    });

    return res.status(200).json({ ok: true, message: "Asset registered", asset: assetRecord });
  } catch (error) {
    console.error("Error registering asset:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/assets/unregister", async (req, res) => {
  try {
    const { slug } = req.params;
    const { assetType, storagePath, uploadedAt } = req.body;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    if (
      typeof assetType !== "string" ||
      typeof storagePath !== "string" ||
      typeof uploadedAt !== "string" ||
      !assetType.trim() ||
      !storagePath.trim() ||
      !uploadedAt.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanAssetType = assetType.trim();
    const cleanStoragePath = storagePath.trim();
    const cleanUploadedAt = uploadedAt.trim();
    const assetFolder = getAssetFolder(cleanAssetType);

    if (!isAllowedOcrAssetType(cleanAssetType) || !assetFolder) {
      return res.status(400).json({ ok: false, error: "Invalid assetType" });
    }

    const expectedPrefix = `products/${slug}/${assetFolder}/`;

    if (!cleanStoragePath.startsWith(expectedPrefix)) {
      return res.status(400).json({ ok: false, error: "Invalid storagePath" });
    }

    if (Number.isNaN(Date.parse(cleanUploadedAt))) {
      return res.status(400).json({ ok: false, error: "Invalid uploadedAt" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const assets = getSafeAssets(product);
    const assetList = assets[cleanAssetType] || [];

    const assetIndex = assetList.findIndex(
      (asset) =>
        asset &&
        asset.storagePath === cleanStoragePath &&
        asset.uploadedAt === cleanUploadedAt
    );

    if (assetIndex === -1) {
      return res.status(404).json({ ok: false, error: "Asset record not found" });
    }

    const updatedAssetList = assetList.filter((_, index) => index !== assetIndex);

    await docRef.update({
      [`assets.${cleanAssetType}`]: updatedAssetList,
      updatedAt: getNowIso()
    });

    return res.status(200).json({
      ok: true,
      message: "Asset record unregistered",
      removed: {
        assetType: cleanAssetType,
        storagePath: cleanStoragePath,
        uploadedAt: cleanUploadedAt
      }
    });
  } catch (error) {
    console.error("Error unregistering asset:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/content/save", async (req, res) => {
  try {
    const { slug } = req.params;
    const {
      title,
      subtitle,
      productType,
      authors,
      series,
      language,
      isbn10,
      isbn13,
      binding,
      dimensions,
      weightLb,
      pricing,
      organization,
      content,
      mediaNotes,
      status
    } = req.body;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const currentProduct = doc.data() || {};
    const updates = { updatedAt: getNowIso() };

    if (title !== undefined) {
      if (typeof title !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid title" });
      }
      updates.title = title.trim();
    }

    if (subtitle !== undefined) {
      if (typeof subtitle !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid subtitle" });
      }
      updates.subtitle = subtitle.trim();
    }

    if (productType !== undefined) {
      if (typeof productType !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid productType" });
      }
      updates.productType = productType.trim();
    }

    if (authors !== undefined) {
      if (!Array.isArray(authors) || !authors.every((item) => typeof item === "string")) {
        return res.status(400).json({ ok: false, error: "Invalid authors" });
      }
      updates.authors = authors.map((item) => item.trim());
    }

    if (series !== undefined) {
      if (series !== null && typeof series !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid series" });
      }
      updates.series = series === null ? null : series.trim();
    }

    if (language !== undefined) {
      if (typeof language !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid language" });
      }
      updates.language = language.trim();
    }

    if (isbn10 !== undefined) {
      if (typeof isbn10 !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid isbn10" });
      }
      updates.isbn10 = isbn10.trim();
    }

    if (isbn13 !== undefined) {
      if (typeof isbn13 !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid isbn13" });
      }
      updates.isbn13 = isbn13.trim();
    }

    if (binding !== undefined) {
      if (typeof binding !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid binding" });
      }
      updates.binding = binding.trim();
    }

    if (weightLb !== undefined) {
      if (typeof weightLb !== "number") {
        return res.status(400).json({ ok: false, error: "Invalid weightLb" });
      }
      updates.weightLb = weightLb;
    }

    if (status !== undefined) {
      if (typeof status !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid status" });
      }
      updates.status = status.trim();
    }

    if (dimensions !== undefined) {
      if (
        !isPlainObject(dimensions) ||
        typeof dimensions.depthIn !== "number" ||
        typeof dimensions.heightIn !== "number" ||
        typeof dimensions.thicknessIn !== "number"
      ) {
        return res.status(400).json({ ok: false, error: "Invalid dimensions" });
      }
      updates.dimensions = dimensions;
    }

    if (pricing !== undefined) {
      if (
        !isPlainObject(pricing) ||
        typeof pricing.retailPrice !== "number" ||
        typeof pricing.storePrice !== "number" ||
        typeof pricing.costPerItem !== "number"
      ) {
        return res.status(400).json({ ok: false, error: "Invalid pricing" });
      }
      updates.pricing = pricing;
    }

    if (organization !== undefined) {
      if (!isPlainObject(organization)) {
        return res.status(400).json({ ok: false, error: "Invalid organization" });
      }
      updates.organization = organization;
    }

    if (content !== undefined) {
      if (!isPlainObject(content)) {
        return res.status(400).json({ ok: false, error: "Invalid content" });
      }
      updates.content = content;
    }

    if (mediaNotes !== undefined) {
      if (!isPlainObject(mediaNotes)) {
        return res.status(400).json({ ok: false, error: "Invalid mediaNotes" });
      }
      updates.mediaNotes = mediaNotes;
    }

    const mergedProduct = {
      ...currentProduct,
      ...updates,
      organization:
        updates.organization !== undefined ? updates.organization : currentProduct.organization,
      content: updates.content !== undefined ? updates.content : currentProduct.content,
      mediaNotes: updates.mediaNotes !== undefined ? updates.mediaNotes : currentProduct.mediaNotes,
      dimensions: updates.dimensions !== undefined ? updates.dimensions : currentProduct.dimensions,
      pricing: updates.pricing !== undefined ? updates.pricing : currentProduct.pricing,
      authors: updates.authors !== undefined ? updates.authors : currentProduct.authors
    };

    updates.searchText = buildSearchText(mergedProduct);

    await docRef.update(updates);

    return res.status(200).json({ ok: true, message: "Content saved" });
  } catch (error) {
    console.error("Error saving content:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/ocr/start", async (req, res) => {
  try {
    const { slug } = req.params;
    const { assetType, sourceStoragePath, sourceFilename, mimeType } = req.body;

    if (
      !isValidSlug(slug) ||
      typeof assetType !== "string" ||
      typeof sourceStoragePath !== "string" ||
      typeof sourceFilename !== "string" ||
      typeof mimeType !== "string" ||
      !assetType.trim() ||
      !sourceStoragePath.trim() ||
      !sourceFilename.trim() ||
      !mimeType.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanAssetType = assetType.trim();
    const cleanSourceStoragePath = sourceStoragePath.trim();
    const cleanSourceFilename = sourceFilename.trim();
    const cleanMimeType = mimeType.trim();

    if (!isAllowedOcrAssetType(cleanAssetType)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    if (!isValidFilename(cleanSourceFilename)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const matchingAsset = findRegisteredAsset(
      product,
      cleanAssetType,
      cleanSourceStoragePath,
      cleanSourceFilename
    );

    if (!matchingAsset) {
      return res.status(400).json({ ok: false, error: "Invalid sourceStoragePath" });
    }

    const currentOcr = product.ocr || getDefaultOcrBlock();
    const currentDocuments = Array.isArray(currentOcr.documents) ? currentOcr.documents : [];

    const existingIndex = currentDocuments.findIndex(
      (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
    );

    const baseOcrDocument = withOcrDefaults({
      assetType: cleanAssetType,
      sourceFilename: cleanSourceFilename,
      sourceStoragePath: cleanSourceStoragePath,
      mimeType: cleanMimeType,
      status: "processing",
      ocrProvider: "document-ai",
      ocrMode: getOcrModeForMimeType(cleanMimeType),
      error: ""
    });

    const documentsBeforeRun =
      existingIndex === -1
        ? [...currentDocuments, baseOcrDocument]
        : currentDocuments.map((docItem, index) =>
            index === existingIndex
              ? withOcrDefaults({
                  ...docItem,
                  assetType: cleanAssetType,
                  sourceFilename: cleanSourceFilename,
                  sourceStoragePath: cleanSourceStoragePath,
                  mimeType: cleanMimeType,
                  status: "processing",
                  ocrProvider: "document-ai",
                  ocrMode: getOcrModeForMimeType(cleanMimeType),
                  error: ""
                })
              : withOcrDefaults(docItem)
          );

    await docRef.update({
      ocr: { status: "processing", documents: documentsBeforeRun },
      updatedAt: getNowIso()
    });

    try {
      const documentAiResult = await runDocumentAiOcr({
        sourceStoragePath: cleanSourceStoragePath,
        sourceFilename: cleanSourceFilename,
        mimeType: cleanMimeType
      });

      const rawOutputPath = getRawOcrOutputPath(slug, cleanSourceFilename);
      const textOutputPath = getTextOcrOutputPath(slug, cleanSourceFilename);

      await saveJsonFileToStorage(rawOutputPath, documentAiResult.rawResult);
      await saveTextFileToStorage(textOutputPath, documentAiResult.extractedText || "");

      const completedRecord = applyBestText(
        withOcrDefaults({
          ...baseOcrDocument,
          rawOutputPath,
          textOutputPath,
          extractedText: documentAiResult.extractedText || "",
          pageCount: documentAiResult.pageCount || 0,
          status: "completed",
          processedAt: getNowIso(),
          error: ""
        })
      );

      try {
        completedRecord.aiInitialCorrectedText = await runAiCorrection(completedRecord.extractedText);
        completedRecord.aiInitialCorrectionStatus = "completed";
        completedRecord.aiInitialCorrectionProcessedAt = getNowIso();
        completedRecord.aiInitialCorrectionError = "";
      } catch (ocrAiInitialError) {
        completedRecord.aiInitialCorrectionStatus = "failed";
        completedRecord.aiInitialCorrectionProcessedAt = getNowIso();
        completedRecord.aiInitialCorrectionError = ocrAiInitialError.message || "Initial AI correction failed";
      }

      const completedRecordWithAiStart = applyBestText(withOcrDefaults(completedRecord));

      const refreshedDoc = await docRef.get();
      const refreshedProduct = refreshedDoc.data() || {};
      const refreshedOcr = refreshedProduct.ocr || getDefaultOcrBlock();
      const refreshedDocuments = Array.isArray(refreshedOcr.documents)
        ? refreshedOcr.documents
        : [];

      const refreshedIndex = refreshedDocuments.findIndex(
        (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
      );

      const finalDocuments =
        refreshedIndex === -1
          ? [...refreshedDocuments, completedRecordWithAiStart]
          : refreshedDocuments.map((docItem, index) =>
              index === refreshedIndex
                ? applyBestText(
                    withOcrDefaults({
                      ...docItem,
                      ...completedRecordWithAiStart,
                      rawOutputPath,
                      textOutputPath,
                      extractedText: documentAiResult.extractedText || "",
                      pageCount: documentAiResult.pageCount || 0,
                      status: "completed",
                      processedAt: getNowIso(),
                      error: ""
                    })
                  )
                : withOcrDefaults(docItem)
            );

      await docRef.update({
        ocr: {
          status: computeOverallOcrStatus(finalDocuments),
          documents: finalDocuments
        },
        updatedAt: getNowIso()
      });

      return res.status(200).json({
        ok: true,
        message: "OCR completed",
        ocrDocument: completedRecordWithAiStart
      });
    } catch (ocrError) {
      console.error("Document AI OCR failed:", ocrError);

      const failedRecord = withOcrDefaults({
        ...baseOcrDocument,
        status: "failed",
        processedAt: getNowIso(),
        error: ocrError.message || "OCR failed"
      });

      const refreshedDoc = await docRef.get();
      const refreshedProduct = refreshedDoc.data() || {};
      const refreshedOcr = refreshedProduct.ocr || getDefaultOcrBlock();
      const refreshedDocuments = Array.isArray(refreshedOcr.documents)
        ? refreshedOcr.documents
        : [];

      const refreshedIndex = refreshedDocuments.findIndex(
        (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
      );

      const finalDocuments =
        refreshedIndex === -1
          ? [...refreshedDocuments, failedRecord]
          : refreshedDocuments.map((docItem, index) =>
              index === refreshedIndex
                ? withOcrDefaults({
                    ...docItem,
                    status: "failed",
                    ocrProvider: "document-ai",
                    processedAt: getNowIso(),
                    error: ocrError.message || "OCR failed"
                  })
                : withOcrDefaults(docItem)
            );

      await docRef.update({
        ocr: {
          status: computeOverallOcrStatus(finalDocuments),
          documents: finalDocuments
        },
        updatedAt: getNowIso()
      });

      return res.status(500).json({ ok: false, error: "OCR failed" });
    }
  } catch (error) {
    console.error("Error starting OCR job:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.get("/products/:slug/ocr", async (req, res) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const ocr = product.ocr || getDefaultOcrBlock();

    return res.status(200).json({ ok: true, ocr });
  } catch (error) {
    console.error("Error fetching OCR block:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/ocr/register", async (req, res) => {
  try {
    const { slug } = req.params;
    const { sourceStoragePath, rawOutputPath, textOutputPath, extractedText, pageCount, status, error } = req.body;

    if (
      !isValidSlug(slug) ||
      typeof sourceStoragePath !== "string" ||
      typeof rawOutputPath !== "string" ||
      typeof textOutputPath !== "string" ||
      typeof extractedText !== "string" ||
      typeof pageCount !== "number" ||
      typeof status !== "string" ||
      typeof error !== "string" ||
      !sourceStoragePath.trim() ||
      !rawOutputPath.trim() ||
      !textOutputPath.trim() ||
      !status.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanSourceStoragePath = sourceStoragePath.trim();
    const cleanRawOutputPath = rawOutputPath.trim();
    const cleanTextOutputPath = textOutputPath.trim();
    const cleanExtractedText = extractedText;
    const cleanStatus = status.trim();
    const cleanError = error;

    if (!["processing", "completed", "failed"].includes(cleanStatus)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const rawPrefix = `products/${slug}/ocr/raw/`;
    const textPrefix = `products/${slug}/ocr/text/`;

    if (!cleanRawOutputPath.startsWith(rawPrefix) || !cleanTextOutputPath.startsWith(textPrefix)) {
      return res.status(400).json({ ok: false, error: "Invalid OCR output path" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const currentOcr = product.ocr || getDefaultOcrBlock();
    const currentDocuments = Array.isArray(currentOcr.documents) ? currentOcr.documents : [];

    const documentIndex = currentDocuments.findIndex(
      (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
    );

    if (documentIndex === -1) {
      return res.status(404).json({ ok: false, error: "OCR record not found" });
    }

    const existingRecord = withOcrDefaults(currentDocuments[documentIndex]);
    const updatedRecord = applyBestText(
      withOcrDefaults({
        ...existingRecord,
        status: cleanStatus,
        rawOutputPath: cleanRawOutputPath,
        textOutputPath: cleanTextOutputPath,
        extractedText: cleanExtractedText,
        pageCount,
        processedAt: getNowIso(),
        error: cleanError
      })
    );

    const updatedDocuments = [...currentDocuments];
    updatedDocuments[documentIndex] = updatedRecord;
    const overallStatus = computeOverallOcrStatus(updatedDocuments);

    await docRef.update({
      ocr: { status: overallStatus, documents: updatedDocuments },
      updatedAt: getNowIso()
    });

    return res.status(200).json({
      ok: true,
      message: "OCR result registered",
      ocrDocument: {
        sourceStoragePath: updatedRecord.sourceStoragePath,
        rawOutputPath: updatedRecord.rawOutputPath,
        textOutputPath: updatedRecord.textOutputPath,
        extractedText: updatedRecord.extractedText,
        pageCount: updatedRecord.pageCount,
        status: updatedRecord.status,
        error: updatedRecord.error,
        bestText: updatedRecord.bestText,
        bestTextSource: updatedRecord.bestTextSource
      }
    });
  } catch (error) {
    console.error("Error registering OCR result:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/ocr/remove-document", async (req, res) => {
  try {
    const { slug } = req.params;
    const { sourceStoragePath } = req.body;

    if (!isValidSlug(slug)) {
      return res.status(400).json({ ok: false, error: "Invalid slug" });
    }

    if (typeof sourceStoragePath !== "string" || !sourceStoragePath.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanSourceStoragePath = sourceStoragePath.trim();
    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();

    if (!product.ocr || !Array.isArray(product.ocr.documents)) {
      return res.status(404).json({ ok: false, error: "OCR record not found" });
    }

    const currentDocuments = product.ocr.documents;
    const documentIndex = currentDocuments.findIndex(
      (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
    );

    if (documentIndex === -1) {
      return res.status(404).json({ ok: false, error: "OCR record not found" });
    }

    const updatedDocuments = currentDocuments.filter((_, index) => index !== documentIndex);
    let overallStatus = "not_started";

    if (updatedDocuments.some((ocrDoc) => ocrDoc.status === "processing")) {
      overallStatus = "processing";
    } else if (updatedDocuments.some((ocrDoc) => ocrDoc.status === "failed")) {
      overallStatus = "failed";
    } else if (updatedDocuments.some((ocrDoc) => ocrDoc.status === "completed")) {
      overallStatus = "completed";
    }

    const updatedOcr = {
      status: overallStatus,
      documents: updatedDocuments
    };

    await docRef.update({
      ocr: updatedOcr,
      updatedAt: getNowIso()
    });

    return res.status(200).json({
      ok: true,
      message: "OCR document removed",
      removed: {
        sourceStoragePath: cleanSourceStoragePath
      },
      ocr: updatedOcr
    });
  } catch (error) {
    console.error("Error removing OCR document:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/ocr/cleanup", async (req, res) => {
  try {
    const { slug } = req.params;
    const { sourceStoragePath } = req.body;

    if (!isValidSlug(slug) || typeof sourceStoragePath !== "string" || !sourceStoragePath.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanSourceStoragePath = sourceStoragePath.trim();
    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const currentOcr = product.ocr || getDefaultOcrBlock();
    const currentDocuments = Array.isArray(currentOcr.documents) ? currentOcr.documents : [];

    const documentIndex = currentDocuments.findIndex(
      (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
    );

    if (documentIndex === -1) {
      return res.status(404).json({ ok: false, error: "OCR record not found" });
    }

    const existingRecord = withOcrDefaults(currentDocuments[documentIndex]);
    const extractedText = getCleanupSourceText(existingRecord);

    if (!extractedText.trim()) {
      return res.status(400).json({ ok: false, error: "No OCR text available to clean" });
    }

    const processingRecord = withOcrDefaults({
      ...existingRecord,
      cleanupStatus: "processing",
      cleanupError: ""
    });

    const processingDocuments = [...currentDocuments];
    processingDocuments[documentIndex] = processingRecord;

    await docRef.update({
      ocr: { status: currentOcr.status || "completed", documents: processingDocuments },
      updatedAt: getNowIso()
    });

    try {
      const cleanedText = cleanOcrText(extractedText);

      const updatedRecord = applyBestText(
        withOcrDefaults({
          ...existingRecord,
          cleanedText,
          cleanupStatus: "completed",
          cleanupProcessedAt: getNowIso(),
          cleanupError: ""
        })
      );

      const finalDocuments = [...processingDocuments];
      finalDocuments[documentIndex] = updatedRecord;

      await docRef.update({
        ocr: { status: currentOcr.status || "completed", documents: finalDocuments },
        updatedAt: getNowIso()
      });

      return res.status(200).json({
        ok: true,
        message: "OCR cleanup completed",
        ocrDocument: {
          sourceStoragePath: updatedRecord.sourceStoragePath,
          cleanupStatus: updatedRecord.cleanupStatus,
          cleanedText: updatedRecord.cleanedText,
          cleanupError: updatedRecord.cleanupError,
          bestText: updatedRecord.bestText,
          bestTextSource: updatedRecord.bestTextSource
        }
      });
    } catch (cleanupError) {
      const failedRecord = withOcrDefaults({
        ...existingRecord,
        cleanupStatus: "failed",
        cleanupProcessedAt: getNowIso(),
        cleanupError: cleanupError.message || "Cleanup failed"
      });

      const finalDocuments = [...processingDocuments];
      finalDocuments[documentIndex] = failedRecord;

      await docRef.update({
        ocr: { status: currentOcr.status || "completed", documents: finalDocuments },
        updatedAt: getNowIso()
      });

      return res.status(500).json({ ok: false, error: "OCR cleanup failed" });
    }
  } catch (error) {
    console.error("Error cleaning OCR text:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/ocr/normalize", async (req, res) => {
  try {
    const { slug } = req.params;
    const { sourceStoragePath } = req.body;

    if (!isValidSlug(slug) || typeof sourceStoragePath !== "string" || !sourceStoragePath.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanSourceStoragePath = sourceStoragePath.trim();
    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const currentOcr = product.ocr || getDefaultOcrBlock();
    const currentDocuments = Array.isArray(currentOcr.documents) ? currentOcr.documents : [];

    const documentIndex = currentDocuments.findIndex(
      (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
    );

    if (documentIndex === -1) {
      return res.status(404).json({ ok: false, error: "OCR record not found" });
    }

    const existingRecord = withOcrDefaults(currentDocuments[documentIndex]);
    const sourceText = getNormalizationSourceText(existingRecord);

    if (!sourceText) {
      return res.status(400).json({ ok: false, error: "No OCR text available to normalize" });
    }

    const processingRecord = withOcrDefaults({
      ...existingRecord,
      normalizationStatus: "processing",
      normalizationError: ""
    });

    const processingDocuments = [...currentDocuments];
    processingDocuments[documentIndex] = processingRecord;

    await docRef.update({
      ocr: { status: currentOcr.status || "completed", documents: processingDocuments },
      updatedAt: getNowIso()
    });

    try {
      const normalizedText = normalizeOcrText(sourceText);

      const updatedRecord = applyBestText(
        withOcrDefaults({
          ...existingRecord,
          normalizedText,
          normalizationStatus: "completed",
          normalizationProcessedAt: getNowIso(),
          normalizationError: ""
        })
      );

      const finalDocuments = [...processingDocuments];
      finalDocuments[documentIndex] = updatedRecord;

      await docRef.update({
        ocr: { status: currentOcr.status || "completed", documents: finalDocuments },
        updatedAt: getNowIso()
      });

      return res.status(200).json({
        ok: true,
        message: "OCR normalization completed",
        ocrDocument: {
          sourceStoragePath: updatedRecord.sourceStoragePath,
          normalizationStatus: updatedRecord.normalizationStatus,
          normalizedText: updatedRecord.normalizedText,
          normalizationError: updatedRecord.normalizationError,
          bestText: updatedRecord.bestText,
          bestTextSource: updatedRecord.bestTextSource
        }
      });
    } catch (normalizationError) {
      const failedRecord = withOcrDefaults({
        ...existingRecord,
        normalizationStatus: "failed",
        normalizationProcessedAt: getNowIso(),
        normalizationError: normalizationError.message || "Normalization failed"
      });

      const finalDocuments = [...processingDocuments];
      finalDocuments[documentIndex] = failedRecord;

      await docRef.update({
        ocr: { status: currentOcr.status || "completed", documents: finalDocuments },
        updatedAt: getNowIso()
      });

      return res.status(500).json({ ok: false, error: "OCR normalization failed" });
    }
  } catch (error) {
    console.error("Error normalizing OCR text:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/ocr/ai-correct", async (req, res) => {
  try {
    const { slug } = req.params;
    const { sourceStoragePath } = req.body;

    if (!isValidSlug(slug) || typeof sourceStoragePath !== "string" || !sourceStoragePath.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanSourceStoragePath = sourceStoragePath.trim();
    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const currentOcr = product.ocr || getDefaultOcrBlock();
    const currentDocuments = Array.isArray(currentOcr.documents) ? currentOcr.documents : [];

    const documentIndex = currentDocuments.findIndex(
      (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
    );

    if (documentIndex === -1) {
      return res.status(404).json({ ok: false, error: "OCR record not found" });
    }

    const existingRecord = withOcrDefaults(currentDocuments[documentIndex]);
    const sourceText = getFinalAiCorrectionSourceText(existingRecord);

    if (!sourceText) {
      return res.status(400).json({ ok: false, error: "No OCR text available to AI-correct" });
    }

    const processingRecord = withOcrDefaults({
      ...existingRecord,
      aiCorrectionStatus: "processing",
      aiCorrectionError: ""
    });

    const processingDocuments = [...currentDocuments];
    processingDocuments[documentIndex] = processingRecord;

    await docRef.update({
      ocr: { status: currentOcr.status || "completed", documents: processingDocuments },
      updatedAt: getNowIso()
    });

    try {
      const aiCorrectedText = await runAiCorrection(sourceText);

      const updatedRecord = applyBestText(
        withOcrDefaults({
          ...existingRecord,
          aiCorrectedText,
          aiCorrectionStatus: "completed",
          aiCorrectionProcessedAt: getNowIso(),
          aiCorrectionError: ""
        })
      );

      const finalDocuments = [...processingDocuments];
      finalDocuments[documentIndex] = updatedRecord;

      await docRef.update({
        ocr: { status: currentOcr.status || "completed", documents: finalDocuments },
        updatedAt: getNowIso()
      });

      return res.status(200).json({
        ok: true,
        message: "AI OCR correction completed",
        ocrDocument: {
          sourceStoragePath: updatedRecord.sourceStoragePath,
          aiCorrectionStatus: updatedRecord.aiCorrectionStatus,
          aiCorrectedText: updatedRecord.aiCorrectedText,
          aiCorrectionError: updatedRecord.aiCorrectionError,
          bestText: updatedRecord.bestText,
          bestTextSource: updatedRecord.bestTextSource
        }
      });
    } catch (aiError) {
      const failedRecord = withOcrDefaults({
        ...existingRecord,
        aiCorrectionStatus: "failed",
        aiCorrectionProcessedAt: getNowIso(),
        aiCorrectionError: aiError.message || "AI correction failed"
      });

      const finalDocuments = [...processingDocuments];
      finalDocuments[documentIndex] = failedRecord;

      await docRef.update({
        ocr: { status: currentOcr.status || "completed", documents: finalDocuments },
        updatedAt: getNowIso()
      });

      return res.status(500).json({ ok: false, error: "AI correction failed" });
    }
  } catch (error) {
    console.error("Error AI-correcting OCR text:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

app.post("/products/:slug/ocr/human-review", async (req, res) => {
  try {
    const { slug } = req.params;
    const { sourceStoragePath, humanReviewedText } = req.body;

    if (
      !isValidSlug(slug) ||
      typeof sourceStoragePath !== "string" ||
      typeof humanReviewedText !== "string" ||
      !sourceStoragePath.trim() ||
      !humanReviewedText.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const cleanSourceStoragePath = sourceStoragePath.trim();
    const cleanHumanReviewedText = humanReviewedText.trim();
    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data();
    const currentOcr = product.ocr || getDefaultOcrBlock();
    const currentDocuments = Array.isArray(currentOcr.documents) ? currentOcr.documents : [];

    const documentIndex = currentDocuments.findIndex(
      (ocrDoc) => ocrDoc.sourceStoragePath === cleanSourceStoragePath
    );

    if (documentIndex === -1) {
      return res.status(404).json({ ok: false, error: "OCR record not found" });
    }

    const existingRecord = withOcrDefaults(currentDocuments[documentIndex]);
    const updatedRecord = applyBestText(
      withOcrDefaults({
        ...existingRecord,
        humanReviewedText: cleanHumanReviewedText
      })
    );

    const updatedDocuments = [...currentDocuments];
    updatedDocuments[documentIndex] = updatedRecord;

    await docRef.update({
      ocr: {
        status: currentOcr.status || computeOverallOcrStatus(updatedDocuments),
        documents: updatedDocuments
      },
      updatedAt: getNowIso()
    });

    return res.status(200).json({
      ok: true,
      message: "Human-reviewed OCR text saved",
      ocrDocument: {
        sourceStoragePath: updatedRecord.sourceStoragePath,
        humanReviewedText: updatedRecord.humanReviewedText,
        bestText: updatedRecord.bestText,
        bestTextSource: updatedRecord.bestTextSource,
        bestTextUpdatedAt: updatedRecord.bestTextUpdatedAt
      }
    });
  } catch (error) {
    console.error("Error saving human-reviewed OCR text:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`bhe-product-api listening on port ${PORT}`);
  });
}

module.exports = {
  app,
  aiCorrectRepositoryDocumentOcr,
  CHAT_VISIBLE_IMAGES_NOT_ATTACHABLE_ERROR,
  analyzeUploadedImages,
  attachAssetsToProduct,
  buildCanonicalSongsFromCsv,
  buildSongId,
  buildDefaultRepositoryDocumentRecord,
  buildDefaultRepositoryItemRecord,
  buildFileHandoffDiagnosticSummary,
  buildCanonicalAssetUrl,
  buildPersistedAssetRecord,
  buildProductAssetAttachment,
  buildStructuredErrorResponse,
  cleanupRepositoryDocumentOcr,
  createRepositoryItem,
  createWorkflowError,
  findRegisteredAsset,
  getCleanupSourceText,
  getFinalAiCorrectionSourceText,
  getAssetWorkflowDependencies,
  getSongCatalogDependencies,
  getOcrModeForMimeType,
  getRepositoryDocumentById,
  getRepositoryDocumentSourceText,
  getRepositoryItemDocuments,
  getRepositoryItemById,
  getRequiredRepositoryItem,
  humanReviewRepositoryDocumentOcr,
  importCanonicalSongsToCollection,
  getRepositoryWorkflowDependencies,
  linkRepositoryItemDocuments,
  listRepositoryDocumentsByProvenance,
  looseNormalizeTitle,
  getNormalizationSourceText,
  normalizeRepositoryDocumentOcr,
  normalizePersistedAssetRecord,
  normalizeStoredAssetRecord,
  saveRepositoryItemSummary,
  searchSongs,
  searchRepositoryDocuments,
  searchRepositoryItems,
  startRepositoryDocumentOcr,
  strictNormalizeTitle,
  getSongById,
  updateSongMinistryMetadata,
  uploadRepositoryDocumentsToStorage,
  uploadAssetsToStorage
};
