const express = require("express");
const multer = require("multer");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { promisify } = require("node:util");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const { v1: DocumentAi } = require("@google-cloud/documentai");
const { GoogleAuth } = require("google-auth-library");
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require("docx");
const PptxGenJS = require("pptxgenjs");
const {
  buildCanonicalSongsFromCsv,
  buildSongId,
  importCanonicalSongsToCollection,
  looseNormalizeTitle,
  parseSongCatalogCsv,
  strictNormalizeTitle
} = require("./lib/song-catalog-importer");
const {
  buildActiveCongregationalPool,
  deleteSong,
  getSongById,
  searchSongs,
  updateSongIdentity,
  updateSongMinistryMetadata
} = require("./lib/song-catalog-service");
const {
  getServiceById,
  searchServices
} = require("./lib/service-history-service");
const {
  commitOperatorDataChange,
  listOperatorCollections,
  queryOperatorDocuments
} = require("./lib/operator-data-service");
const {
  buildDailyBrief,
  buildDailyReview,
  completeTasksForPastEvents,
  createCalendarEvent,
  createProject,
  createRoutine,
  createTask,
  getProject,
  listCalendarEvents,
  listProjects,
  listRoutines,
  listTasks,
  updateCalendarEvent,
  updateProject,
  updateRoutine,
  updateTask
} = require("./lib/project-task-service");
const {
  addSermonDevelopmentNote,
  answerSermonQuestion,
  appendSermonContent,
  buildSermonMaterialFingerprint,
  buildSermonWorkspaceOverview,
  createPreachingAnalysis,
  createSermon,
  createSermonFolder,
  createSermonMedia,
  createSermonMediaTranscriptSource,
  createSermonPresentation,
  createSermonPresentationTemplate,
  createSermonSource,
  embedSermonChunks,
  getPreachingProfile,
  getSermonArchiveStats,
  getSermon,
  getSermonContext,
  getSermonMedia,
  getSermonMaterialInventory,
  getSermonPresentation,
  getSermonPresentationTemplate,
  getSermonSnapshot,
  getSermonSource,
  importSermonMaterial,
  importSermonMaterialBatch,
  importSermonPresentationTemplate,
  listPreachingAnalyses,
  listSermonFolders,
  listSermonMedia,
  listSermonPresentations,
  listSermonPresentationTemplates,
  listSermonSnapshots,
  listSermonSources,
  listSermons,
  MAX_IMPORTED_TEXT_LENGTH,
  rebuildSermonChunks,
  searchSermonChunks,
  semanticSearchSermonChunks,
  updatePreachingProfile,
  updateSermon,
  updateSermonMedia,
  updateSermonPresentationTemplate,
  updateSermonFolder
} = require("./lib/sermon-workspace-service");
const {
  buildSermonWorkspaceOperationError,
  listSermonWorkspaceOperations,
} = require("./lib/sermon-workspace-operation-registry");
const {
  buildProductWorkspaceOperationError,
  listProductWorkspaceOperations
} = require("./lib/product-workspace-operation-registry");
const {
  getJsonByteLength,
  runIdempotentSermonWorkspaceOperation
} = require("./lib/sermon-workspace-operation-execution");
const {
  getJsonByteLength: getProductJsonByteLength,
  runIdempotentProductWorkspaceOperation
} = require("./lib/product-workspace-operation-execution");
const {
  buildMinistryPlanningOperationError,
  listMinistryPlanningOperations
} = require("./lib/ministry-planning-operation-registry");
const {
  createGoogleSheetBackup
} = require("./lib/google-sheet-backup-service");
const {
  getJsonByteLength: getMinistryPlanningJsonByteLength,
  runIdempotentMinistryPlanningOperation
} = require("./lib/ministry-planning-operation-execution");
const {
  buildProductSearchText: buildProductWorkspaceSearchText,
  normalizeIdentifiers
} = require("./lib/product-workspace-service");
const {
  runGptActionTransportProbe
} = require("./lib/gpt-action-diagnostics");
const {
  applyPresentationActionFileResponse,
  buildAttachmentContentDisposition,
  createPreachingPacketActionFileResponse,
  createPresentationActionFileResponse,
  sanitizeAttachmentFilename
} = require("./lib/gpt-action-file-response");
const {
  buildGptActionArtifactDownloadUrl,
  buildGptActionDownloadUrl,
  verifyGptActionArtifactDownloadSignature,
  verifyGptActionDownloadSignature
} = require("./lib/gpt-action-download-url");
const {
  prepareSermonPresentationTemplateImport
} = require("./lib/sermon-presentation-template-import");
const {
  processSermonTranscriptionJob
} = require("./lib/sermon-transcription-job-service");
const {
  createSermonWalkSession,
  finalizeSermonWalkCapture,
  getSermonWalkCaptureStatus,
  registerSermonWalkAudioChunk,
  registerSermonWalkFinalAudio,
  saveSermonWalkHighAccuracyTranscript,
  saveSermonWalkTurn
} = require("./lib/sermon-walk-capture-service");
const {
  createSermonWalkAccessToken,
  verifySermonWalkAccessToken
} = require("./lib/sermon-walk-access");
const sermonRecordingInboxService = require("./lib/sermon-recording-inbox-service");
const scriptureNoteService = require("./lib/scripture-note-service");
const {
  prepareScriptureNoteImportFile
} = require("./lib/scripture-note-document-import");

const REQUIRED_ENV_VARS = ["BHE_API_KEY", "OPENAI_API_KEY"];
for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const app = express();
app.use((req, res, next) => {
  if (!req.path.startsWith("/gpt-action-diagnostics")) {
    return next();
  }

  const requestId = randomUUID();
  req.actionDiagnosticRequestId = requestId;
  res.set("x-request-id", requestId);
  console.log(JSON.stringify({
    event: "gpt_action_diagnostic_ingress",
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.header("user-agent") || "",
    contentType: req.header("content-type") || "",
    contentLength: req.header("content-length") || "",
    apiKeyProvided: Boolean(req.header("x-api-key"))
  }));
  return next();
});
app.use(express.json({ limit: "25mb" }));

const execFileAsync = promisify(execFile);

const BHE_API_KEY = process.env.BHE_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const SCRIPTURE_NOTE_MODEL = process.env.SCRIPTURE_NOTE_MODEL || OPENAI_MODEL;
const SERMON_MANUSCRIPT_MODEL = process.env.SERMON_MANUSCRIPT_MODEL || "gpt-5.6-sol";
const SERMON_SOURCE_SELECTION_MODEL = process.env.SERMON_SOURCE_SELECTION_MODEL || "gpt-5.6-terra";
const DOCUMENT_AI_LOCATION = process.env.DOCUMENT_AI_LOCATION || "us";
const DOCUMENT_AI_PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || "";
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || "location-map-985";
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "chatgptstorage";
const VERTEX_AI_LOCATION = process.env.VERTEX_AI_LOCATION || "us-central1";
const VERTEX_TEXT_EMBEDDING_MODEL = process.env.VERTEX_TEXT_EMBEDDING_MODEL || "text-embedding-005";
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe";
const SERMON_TRANSCRIPT_CLEANUP_MODEL = process.env.SERMON_TRANSCRIPT_CLEANUP_MODEL || OPENAI_MODEL;
const SERMON_TRANSCRIPTION_QUEUE_LOCATION = process.env.SERMON_TRANSCRIPTION_QUEUE_LOCATION || "us-west1";
const SERMON_TRANSCRIPTION_QUEUE_NAME = process.env.SERMON_TRANSCRIPTION_QUEUE_NAME || "sermon-transcription";
const SERMON_WALK_REALTIME_MODEL = process.env.SERMON_WALK_REALTIME_MODEL || "gpt-realtime-2.1";
const SERMON_WALK_REALTIME_VOICE = process.env.SERMON_WALK_REALTIME_VOICE || "marin";
const MAX_OPENAI_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;
const MAX_SERMON_MEDIA_IMPORT_BYTES = 100 * 1024 * 1024;
const YT_DLP_BIN = process.env.YT_DLP_BIN || "yt-dlp";
const YOUTUBE_COOKIES_BASE64 = process.env.YOUTUBE_COOKIES_BASE64 || "";
const YOUTUBE_OAUTH_CLIENT_ID = process.env.YOUTUBE_OAUTH_CLIENT_ID || "";
const YOUTUBE_OAUTH_CLIENT_SECRET = process.env.YOUTUBE_OAUTH_CLIENT_SECRET || "";
const YOUTUBE_OAUTH_REFRESH_TOKEN = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN || "";
const YOUTUBE_OAUTH_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const BUCKET_NAME = process.env.BUCKET_NAME || "bhe-product-assets";
const GPT_ACTION_BASE_URL = process.env.GPT_ACTION_BASE_URL ||
  "https://bhe-product-api-mwhc25pkra-uw.a.run.app";
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
const DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID = "1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss";
const DEFAULT_MUSIC_PLANNING_SHEET_NAME = "PROPOSED SCHEDULES";
const DEFAULT_MUSIC_PLANNING_YEAR = 2026;
const MUSIC_PLANNING_REFRESH_MODES = new Set(["preview-only", "plan-only", "commit"]);
const DEFAULT_SERMON_MANUSCRIPT_FORMAT = [
  "Use this consistent preaching manuscript format unless Dan explicitly asks for a different shape:",
  "",
  "# SERMON TITLE",
  "Subtitle line: A Sermon/Lesson on [Primary Passage]",
  "Date/Service line when known",
  "Topic line",
  "Title line",
  "",
  "## TEXT",
  "State the main biblical text and any focus verses.",
  "",
  "## INTRODUCTION",
  "Include an opening illustration or pastoral entry point when source material supports it.",
  "Include context for the passage and the problem/question the sermon addresses.",
  "",
  "## MAIN THEME",
  "Quote or summarize the controlling text.",
  "State the central concept/big idea in a clear, memorable way.",
  "",
  "## I. FIRST MAJOR MOVEMENT",
  "Use Roman numerals for major movements.",
  "Use A/B/C subpoints under each major movement.",
  "Under subpoints, develop the idea with explanation, Scripture, key truth, pastoral observation, illustration, and application as the source material allows.",
  "Use short bold labels such as **Key Point:**, **Truth:**, **Warning:**, **Application:**, **Illustration:**, **Question:**, or **Challenge:** to make the manuscript easy to preach from.",
  "",
  "## II. SECOND MAJOR MOVEMENT",
  "Continue the same structure.",
  "",
  "## III. THIRD MAJOR MOVEMENT",
  "Use as many movements as the passage/source material naturally requires, without forcing symmetry.",
  "",
  "## PERSONAL APPLICATION AND EXAMINATION",
  "Give direct self-examination questions and practical response points.",
  "",
  "## CONCLUSION",
  "Bring the sermon back to the main theme, the heart burden, and a clear final challenge or invitation.",
  "",
  "## SUPPORTING SCRIPTURES",
  "List supporting passages mentioned or clearly used.",
  "",
  "## KEY QUOTES FROM THE MESSAGE",
  "Preserve the strongest preach-ready lines from Dan's wording/source material.",
  "",
  "## PRACTICAL APPLICATIONS",
  "List concise action points or pastoral responses.",
  "",
  "Formatting rules:",
  "- Write in Markdown headings so the DOCX exporter can create clear sections.",
  "- Keep headings predictable across sermons.",
  "- Preserve Dan's warm, direct, text-driven pastoral voice.",
  "- Make the result easy to preach from, not merely easy to read."
].join("\n");
const DEFAULT_SERMON_ASSEMBLY_FORMAT = [
  "Assemble the manuscript in the approved movement order supplied by the placed development material.",
  "Use Markdown headings for the sermon title, text, introduction, approved major movements, and conclusion when those elements exist in the approved basis.",
  "Let movement names, proportions, applications, and the ending come from the supplied sermon rather than imposing a generic template.",
  "Do not add separate Personal Application and Examination, Supporting Scriptures, Key Quotes, or Practical Applications appendices unless the approved basis explicitly requires them.",
  "Preserve exact protected lines verbatim and make the result easy for Dan to preach from."
].join("\n");
const SERMON_MANUSCRIPT_MODES = new Set(["draft", "assembly"]);


app.use((req, res, next) => {
  const isSermonWalkAsset = req.method === "GET" &&
    (req.path === "/sermon-walk" || req.path.startsWith("/sermon-walk/")) &&
    !req.path.startsWith("/sermon-walk/api/");
  let sermonWalkAccess = null;
  if (req.path.startsWith("/sermon-walk/api/")) {
    const authorization = req.header("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    sermonWalkAccess = verifySermonWalkAccessToken(token, BHE_API_KEY);
    if (sermonWalkAccess) req.sermonWalkAccess = sermonWalkAccess;
  }
  const isPublicPath =
    req.path === "/" ||
    req.path === "/health" ||
    req.path === "/gpt-action-diagnostics/sample.txt" ||
    req.path.startsWith("/gpt-action-files/sermon-presentations/") ||
    req.path.startsWith("/gpt-action-files/sermon-preaching-packets/") ||
    isSermonWalkAsset ||
    Boolean(sermonWalkAccess);

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
  projectId: GCP_PROJECT_ID,
  databaseId: FIRESTORE_DATABASE_ID
});

const storage = new Storage({
  projectId: GCP_PROJECT_ID
});

const documentAiClient = new DocumentAi.DocumentProcessorServiceClient({
  apiEndpoint: `${DOCUMENT_AI_LOCATION}-documentai.googleapis.com`
});
const vertexAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"]
});
const googleSheetsAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const productsCollection = db.collection("products");
const assetLibraryCollection = db.collection("productAssetLibrary");
const repositoryDocumentsCollection = db.collection("repositoryDocuments");
const repositoryItemsCollection = db.collection("repositoryItems");
const songsCollection = db.collection("songs");
const songPairingsCollection = db.collection("songPairings");
const songMetadataAuditCollection = db.collection("songMetadataAudit");
const servicesCollection = db.collection("services");
const serviceOrderItemsCollection = db.collection("serviceOrderItems");
const serviceMomentsCollection = db.collection("serviceMoments");
const serviceSongEventsCollection = db.collection("serviceSongEvents");
const breezeImportsCollection = db.collection("breezeImports");
const sourceImportsCollection = db.collection("sourceImports");
const pianistsCollection = db.collection("pianists");
const servicePianoPlansCollection = db.collection("servicePianoPlans");
const serviceMinistryAssignmentsCollection = db.collection("serviceMinistryAssignments");
const projectsCollection = db.collection("projects");
const tasksCollection = db.collection("tasks");
const calendarEventsCollection = db.collection("calendarEvents");
const routinesCollection = db.collection("routines");
const sermonFoldersCollection = db.collection("sermonFolders");
const sermonsCollection = db.collection("sermons");
const sermonSnapshotsCollection = db.collection("sermonSnapshots");
const sermonSourcesCollection = db.collection("sermonSources");
const sermonMediaCollection = db.collection("sermonMedia");
const sermonOccasionsCollection = db.collection("sermonOccasions");
const sermonDevelopmentSessionsCollection = db.collection("sermonDevelopmentSessions");
const sermonDevelopmentTurnsCollection = db.collection("sermonDevelopmentTurns");
const sermonDevelopmentCheckpointsCollection = db.collection("sermonDevelopmentCheckpoints");
const sermonWalkTurnsCollection = db.collection("sermonWalkTurns");
const sermonWalkAudioChunksCollection = db.collection("sermonWalkAudioChunks");
const sermonChunksCollection = db.collection("sermonChunks");
const sermonPresentationTemplatesCollection = db.collection("sermonPresentationTemplates");
const sermonPresentationsCollection = db.collection("sermonPresentations");
const sermonPreachingPacketsCollection = db.collection("sermonPreachingPackets");
const sermonOperationExecutionsCollection = db.collection("sermonOperationExecutions");
const productOperationExecutionsCollection = db.collection("productOperationExecutions");
const ministryPlanningOperationExecutionsCollection = db.collection("ministryPlanningOperationExecutions");
const ministryPlanningConfigCollection = db.collection("ministryPlanningConfig");
const productWorkspaceConfigCollection = db.collection("productWorkspaceConfig");
const sermonTranscriptionJobsCollection = db.collection("sermonTranscriptionJobs");
const sermonRecordingInboxCollection = db.collection("sermonRecordingInbox");
const preachingProfilesCollection = db.collection("preachingProfiles");
const preachingAnalysesCollection = db.collection("preachingAnalyses");
const scriptureNotesCollection = db.collection("scriptureNotes");
const scriptureNoteImportsCollection = db.collection("scriptureNoteImports");
const scriptureNoteImportSegmentsCollection = db.collection("scriptureNoteImportSegments");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});
const sermonWalkAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
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
    identifiers: {
      bheSku: "",
      isbn10: "",
      isbn13: "",
      upc: "",
      gtin: "",
      amazonAsin: "",
      manufacturerPartNumber: "",
      shopifyProductId: "",
      shopifyVariantId: "",
      ebayItemNumber: "",
      sourceSku: "",
      legacySku: ""
    },
    marketplace: {
      shopifyHandle: slug,
      importedFrom: ""
    },
    variants: [],

    specifications: {
      pageCount: null,
      pageCountUnit: "",
      binding: "",
      language: "English",
      languageType: "",
      publicationDate: null
    },
    classification: {
      bisacCode: "",
      subjectCode: "",
      subjectCodeType: ""
    },

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
    variantCount: Array.isArray(product.variants) ? product.variants.length : 0,
    updatedAt: product.updatedAt || ""
  };
}

function buildSearchText(product = {}) {
  return buildProductWorkspaceSearchText(product);
}

function buildLegacySearchText(product = {}) {
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

function getTrimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function resolveProductAssetDownloadTarget(
  product,
  slug,
  { assetType, storagePath, storageKey, assetId } = {}
) {
  const cleanAssetType = getTrimmedString(assetType);
  const assetArrayPath = getAssetArrayPath(cleanAssetType);
  const assetFolder = getAssetFolder(cleanAssetType);

  if (!assetArrayPath || !assetFolder) {
    throw createWorkflowError("Invalid assetType", 400);
  }

  const requestedStoragePath = getTrimmedString(storagePath) || getTrimmedString(storageKey);
  const requestedAssetId = getTrimmedString(assetId);

  if (!requestedStoragePath && !requestedAssetId) {
    throw createWorkflowError("Missing assetId, storagePath, or storageKey", 400);
  }

  const assets = getSafeAssets(product);
  const assetList = Array.isArray(assets[cleanAssetType]) ? assets[cleanAssetType] : [];
  const matchingAsset = assetList
    .map((asset) => normalizeStoredAssetRecord(asset, cleanAssetType))
    .find((asset) => {
      if (requestedAssetId && asset.assetId === requestedAssetId) {
        return true;
      }

      return (
        requestedStoragePath &&
        (asset.storagePath === requestedStoragePath || asset.storageKey === requestedStoragePath)
      );
    });

  if (!matchingAsset) {
    throw createWorkflowError("Asset not found on product", 404);
  }

  const resolvedStoragePath = matchingAsset.storagePath || matchingAsset.storageKey;
  const directAssetPrefix = `products/${slug}/${assetFolder}/`;
  const assetLibraryPrefix = `products/${slug}/asset-library/`;

  if (
    !resolvedStoragePath ||
    (
      !resolvedStoragePath.startsWith(directAssetPrefix) &&
      !resolvedStoragePath.startsWith(assetLibraryPrefix)
    )
  ) {
    throw createWorkflowError("Invalid storagePath", 400, {
      storagePath: resolvedStoragePath,
      expectedPrefixes: [directAssetPrefix, assetLibraryPrefix]
    });
  }

  return {
    assetType: cleanAssetType,
    storagePath: resolvedStoragePath,
    asset: matchingAsset
  };
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
    songMetadataAuditCollection,
    ...overrides
  };
}

function getServiceHistoryDependencies(overrides = {}) {
  return {
    servicesCollection,
    serviceSongEventsCollection,
    breezeImportsCollection,
    sourceImportsCollection,
    ...overrides
  };
}

async function googleSheetsRequest({ method = "GET", path: requestPath, data } = {}) {
  const client = await googleSheetsAuth.getClient();
  try {
    const response = await client.request({
      method,
      url: `https://sheets.googleapis.com${requestPath}`,
      data
    });
    return response.data;
  } catch (error) {
    const wrapped = new Error(error?.response?.data?.error?.message || error?.message || "Google Sheets request failed");
    wrapped.statusCode = 502;
    wrapped.code = "google_sheets_request_failed";
    wrapped.details = {
      googleStatus: Number(error?.response?.status) || null,
      googleErrorStatus: error?.response?.data?.error?.status || ""
    };
    throw wrapped;
  }
}

function getOperatorDataDependencies(overrides = {}) {
  return {
    collections: {
      products: productsCollection,
      productAssetLibrary: assetLibraryCollection,
      repositoryDocuments: repositoryDocumentsCollection,
      repositoryItems: repositoryItemsCollection,
      songs: songsCollection,
      songPairings: songPairingsCollection,
      songMetadataAudit: songMetadataAuditCollection,
      services: servicesCollection,
      serviceOrderItems: serviceOrderItemsCollection,
      serviceMoments: serviceMomentsCollection,
      serviceSongEvents: serviceSongEventsCollection,
      breezeImports: breezeImportsCollection,
      sourceImports: sourceImportsCollection,
      pianists: pianistsCollection,
      servicePianoPlans: servicePianoPlansCollection,
      serviceMinistryAssignments: serviceMinistryAssignmentsCollection,
      projects: projectsCollection,
      tasks: tasksCollection,
      calendarEvents: calendarEventsCollection,
      routines: routinesCollection,
      sermonFolders: sermonFoldersCollection,
      sermons: sermonsCollection,
      sermonSnapshots: sermonSnapshotsCollection,
      sermonSources: sermonSourcesCollection,
      sermonMedia: sermonMediaCollection,
      sermonOccasions: sermonOccasionsCollection,
      sermonDevelopmentSessions: sermonDevelopmentSessionsCollection,
      sermonDevelopmentCheckpoints: sermonDevelopmentCheckpointsCollection,
      sermonWalkTurns: sermonWalkTurnsCollection,
      sermonWalkAudioChunks: sermonWalkAudioChunksCollection,
      sermonChunks: sermonChunksCollection,
      preachingProfiles: preachingProfilesCollection,
      preachingAnalyses: preachingAnalysesCollection
    },
    deleteFieldValue: Firestore.FieldValue.delete(),
    ...overrides
  };
}

function getMinistryPlanningDependencies(overrides = {}) {
  return {
    ...getOperatorDataDependencies(),
    ...getSongCatalogDependencies(),
    ...getServiceHistoryDependencies(),
    ministryPlanningOperationExecutionsCollection,
    ministryPlanningConfigCollection,
    pianistsCollection,
    servicePianoPlansCollection,
    serviceMinistryAssignmentsCollection,
    createGoogleSheetBackup,
    googleSheetsRequest,
    runMusicPlanningSpreadsheetRefresh,
    ...overrides
  };
}

function getProjectTaskDependencies(overrides = {}) {
  return {
    projectsCollection,
    tasksCollection,
    calendarEventsCollection,
    routinesCollection,
    ...overrides
  };
}

function extractEmbeddingValuesFromVertexResponse(responseData = {}) {
  const prediction = Array.isArray(responseData.predictions) ? responseData.predictions[0] : null;
  const values = prediction?.embeddings?.values || prediction?.embedding?.values || prediction?.values;

  if (!Array.isArray(values)) {
    throw createWorkflowError("Vertex embedding response did not include vector values", 502);
  }

  return values.map((value) => Number(value));
}

async function embedTextWithVertexAi(text, { taskType = "RETRIEVAL_DOCUMENT", model = VERTEX_TEXT_EMBEDDING_MODEL } = {}) {
  const cleanText = typeof text === "string" ? text.trim() : "";

  if (!cleanText) {
    throw createWorkflowError("Cannot embed blank text", 400);
  }

  const cleanModel = typeof model === "string" && model.trim() ? model.trim() : VERTEX_TEXT_EMBEDDING_MODEL;
  const cleanTaskType = typeof taskType === "string" && taskType.trim() ? taskType.trim() : "RETRIEVAL_DOCUMENT";
  const client = await vertexAuth.getClient();
  const url = `https://${VERTEX_AI_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${VERTEX_AI_LOCATION}/publishers/google/models/${cleanModel}:predict`;
  const response = await client.request({
    url,
    method: "POST",
    data: {
      instances: [
        {
          content: cleanText,
          task_type: cleanTaskType
        }
      ]
    }
  });

  return extractEmbeddingValuesFromVertexResponse(response.data);
}

async function findNearestSermonChunksWithFirestore(queryEmbedding, { limit = 10, distanceMeasure = "COSINE" } = {}) {
  const vectorQuery = sermonChunksCollection.findNearest({
    vectorField: "embeddingVector",
    queryVector: queryEmbedding,
    limit,
    distanceMeasure,
    distanceResultField: "vectorDistance"
  });
  const snapshot = await vectorQuery.get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() || {}
  }));
}

async function generateSermonRagAnswerWithOpenAi({ question, contextText, citations, answerStyle = "concise" } = {}) {
  const citationList = Array.isArray(citations)
    ? citations.map((citation) => `${citation.citationId}: ${citation.label}`).join("\n")
    : "";
  const instructions = [
    "You answer sermon-development questions using only the provided sermon archive context.",
    "Be pastoral, text-driven, and practical.",
    "Do not invent sermon records, sources, illustrations, or claims that are not in the context.",
    "Cite supporting claims with bracketed citation ids like [S1].",
    "If the context is insufficient, say what is missing instead of guessing.",
    answerStyle === "expanded"
      ? "Give a clear, developed answer with useful structure."
      : "Keep the answer concise and useful for voice mode."
  ].join(" ");
  const input = [
    `Question: ${question}`,
    "",
    "Available citations:",
    citationList,
    "",
    "Retrieved sermon archive context:",
    contextText
  ].join("\n");

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
      text: { verbosity: answerStyle === "expanded" ? "medium" : "low" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createWorkflowError(`OpenAI API error: ${response.status} ${errorText}`, 502);
  }

  const data = await response.json();
  const answer = extractOpenAiText(data);

  if (!answer) {
    throw createWorkflowError("OpenAI API returned empty RAG answer text", 502);
  }

  return answer;
}

async function generateSermonCanonicalRepairProposalWithOpenAi({
  sermon,
  requestedFields,
  contextText,
  sourceIds
} = {}) {
  const instructions = [
    "You prepare a read-only proposal to restore missing canonical fields on a sermon record from saved source material.",
    "Use only the supplied sermon and source context. Do not invent content or silently improve the sermon beyond what the sources support.",
    "For scriptureText, identify the primary preaching passage, not every supporting reference.",
    "For bigIdea, give one concise controlling sermon proposition faithful to the source's actual burden.",
    "For outline, preserve the source's real main movements and wording where possible; use a readable multiline outline.",
    "Return JSON only. proposedChanges may contain only requested fields with strong source support.",
    "Evidence must briefly name source wording, headings, or references that justify each proposed field.",
    "Set confidence to high, medium, or low. Put uncertainty in warnings instead of guessing."
  ].join(" ");
  const input = JSON.stringify({
    sermon: {
      sermonId: sermon?.sermonId || "",
      title: sermon?.title || "",
      status: sermon?.status || "",
      preachedDate: sermon?.preachedDate || "",
      occasion: sermon?.occasion || "",
      scriptureText: sermon?.scriptureText || "",
      bigIdea: sermon?.bigIdea || "",
      outline: sermon?.outline || ""
    },
    requestedFields,
    sourceIds,
    sourceContext: contextText,
    responseShape: {
      proposedChanges: {
        scriptureText: "primary passage when supported",
        bigIdea: "one controlling proposition when supported",
        outline: "multiline main movements when supported"
      },
      evidence: {
        scriptureText: ["brief source evidence"],
        bigIdea: ["brief source evidence"],
        outline: ["brief source evidence"]
      },
      confidence: "high | medium | low",
      warnings: ["uncertainty or omitted-field explanation"]
    }
  });

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
      text: { verbosity: "low" },
      max_output_tokens: 6000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createWorkflowError(`OpenAI canonical repair proposal error: ${response.status} ${errorText}`, 502);
  }

  const data = await response.json();
  const responseText = extractOpenAiText(data);
  if (!responseText) {
    throw createWorkflowError("OpenAI returned an empty canonical repair proposal", 502);
  }

  try {
    return parseDraftJson(responseText);
  } catch (error) {
    throw createWorkflowError("OpenAI returned an invalid canonical repair proposal", 502, {
      parseError: error?.message || "Invalid JSON"
    });
  }
}

async function generatePostPreachingReflectionWithOpenAi({
  sermon,
  plannedText,
  transcriptText,
  preachingProfile,
  transcriptFidelity
} = {}) {
  const instructions = [
    "You prepare Dan's evidence-grounded post-sermon reflection by comparing what was planned with what the transcript shows was preached.",
    "Use only the supplied planned baseline, transcript, sermon metadata, and preaching profile. Do not invent audience response, vocal tone, gestures, spiritual results, or delivery facts unavailable in the transcript.",
    "Distinguish retained core, genuine live development, planned material omitted from the transcript, and changed emphasis. Omission is not automatically a weakness.",
    "Material already present in the planned baseline belongs only in retainedCore, even when the transcript repeats it word for word. Do not propose it for preservation again.",
    "Use liveDevelopments only for a new illustration, application, theological development, or meaningfully changed formulation that was not already in the planned baseline.",
    "Strengths and growth edges must be specific, pastoral, constructive, and supported by the comparison. Do not turn the reflection into a generic preaching rubric.",
    "Strongest live language must be copied exactly from the transcript and must not already appear in the planned baseline. Return no paraphrase in the text field.",
    "For each preservation candidate, set novelty to new_live_wording, new_live_development, or stronger_reformulation. A stronger_reformulation must include the exact plannedComparison it improves and a concrete differenceFromPlan explaining what is substantively stronger.",
    "When a Scripture-note candidate uses a reference already present in the plan, include the exact plannedComparison and differenceFromPlan proving the preached insight was genuinely new. Otherwise classify it as retained and do not propose it for preservation.",
    "If transcriptFidelity says exactLanguageEligible is false, return an empty strongestLiveLanguage list and treat commentary wording as AI synthesis rather than Dan verbatim.",
    "Scripture-note candidates must be reusable verse, passage, phrase, or word insights that belong in Dan's personal commentary, not whole sermon points or generic applications.",
    "Every Scripture-note candidate requires a canonical reference and an exact evidenceQuote copied from the transcript. Use dan_verbatim only when candidate content itself is the exact transcript wording; otherwise use dan_developed, ai_synthesis, or mixed.",
    "Profile candidates should describe potentially reusable preaching patterns. Default confidence to observed_once; use recurring only when the supplied profile independently shows the same pattern. Never mark a new candidate established from one sermon.",
    "Return JSON only in the requested shape. Keep lists selective and high-value. Put uncertainty in warnings rather than guessing."
  ].join(" ");
  const input = JSON.stringify({
    sermon: {
      sermonId: sermon?.sermonId || "",
      title: sermon?.title || "",
      scriptureText: sermon?.scriptureText || "",
      bigIdea: sermon?.bigIdea || "",
      status: sermon?.status || "",
      occasions: sermon?.occasions || []
    },
    preachingProfile: preachingProfile || {},
    transcriptFidelity: transcriptFidelity || {},
    plannedBaseline: plannedText,
    preachedTranscript: transcriptText,
    responseShape: {
      summary: "concise overall reflection",
      retainedCore: [{ observation: "what remained central", evidence: "short evidence" }],
      liveDevelopments: [{ observation: "material developed in the room", evidence: "exact or close transcript evidence" }],
      plannedMaterialNotPreached: [{ observation: "planned material absent from transcript", evidence: "planned-baseline evidence" }],
      changedEmphasis: [{ observation: "how emphasis shifted", evidence: "comparison evidence" }],
      strengths: ["specific strength"],
      growthEdges: ["specific improvement for next time"],
      styleObservations: ["transcript-supported style observation"],
      structureNotes: ["structure observation"],
      applicationNotes: ["application observation"],
      deliveryNotes: ["verbal delivery observation supported by transcript only"],
      strongestLiveLanguage: [{
        text: "exact transcript wording absent from the planned baseline",
        context: "where it occurred",
        reason: "why it is reusable",
        novelty: "new_live_wording | stronger_reformulation",
        plannedComparison: "exact planned wording when this is a stronger reformulation, otherwise blank",
        differenceFromPlan: "specific substantive improvement when this is a stronger reformulation, otherwise blank"
      }],
      scriptureNoteCandidates: [{
        reference: "canonical Scripture reference",
        content: "reusable commentary note",
        noteType: "observation | interpretation | word_study | theology | cross_reference | application | illustration | question | quotation | other",
        authorship: "dan_verbatim | dan_developed | ai_synthesis | mixed",
        confidence: 0.9,
        evidenceQuote: "exact transcript wording",
        reason: "why this belongs in personal Scripture commentary",
        novelty: "new_live_development | stronger_reformulation",
        plannedComparison: "exact planned wording when the reference already appears in the plan or this is a stronger reformulation",
        differenceFromPlan: "specific new insight or substantive improvement beyond the planned wording"
      }],
      profileCandidates: [{
        category: "tone | structure | application | delivery | style | other",
        observation: "potentially reusable preaching pattern",
        confidence: "observed_once | recurring",
        evidence: "transcript or profile evidence"
      }],
      recommendedNextActions: ["practical next action"],
      warnings: ["material limitation or uncertainty"]
    }
  });
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
      reasoning: { effort: "medium" },
      text: { verbosity: "medium" },
      max_output_tokens: 12000
    })
  });
  if (!response.ok) {
    throw createWorkflowError(`OpenAI post-sermon reflection error: ${response.status} ${await response.text()}`, 502);
  }
  const data = await response.json();
  const responseText = extractOpenAiText(data);
  if (!responseText) throw createWorkflowError("OpenAI returned an empty post-sermon reflection", 502);
  try {
    return parseDraftJson(responseText);
  } catch (error) {
    throw createWorkflowError("OpenAI returned an invalid post-sermon reflection", 502, {
      parseError: error?.message || "Invalid JSON"
    });
  }
}

async function classifyScriptureNoteSegmentsWithOpenAi({ sourceLabel, segments } = {}) {
  const instructions = [
    "You classify Dan's personal Logos and sermon-development notes for an automatically maintained personal Bible commentary.",
    "Return JSON only with one result for every supplied segmentIndex.",
    "Classifications: scripture_note, external_quotation, topical_material, sermon_material, noise, unresolved.",
    "Use scripture_note only for reusable verse, passage, phrase, or word insight. Do not classify an entire sermon outline, series plan, ministry document, or logistical note as commentary.",
    "Use external_quotation when the block substantially quotes a published commentary or named source, and preserve a concise attribution.",
    "Use noise for assistant follow-up language, duplicated image-extraction preambles, empty fragments, or content with no durable value.",
    "Resolve raw KJV verse text and distinctive phrases to a canonical reference when confident. Correct a heading when the quoted verse clearly belongs elsewhere; for example a Psalm 4:3 heading containing Psalm 3:3 text must resolve to Psalm 3:3 and include a warning.",
    "Do not manufacture a reference for topical material. Use unresolved when material appears valuable but cannot be anchored confidently.",
    "Note types: observation, interpretation, word_study, theology, cross_reference, application, illustration, question, quotation, other.",
    "Authorship labels: dan_verbatim, dan_developed, ai_synthesis, external_source, mixed, unknown. Do not present AI-generated explanation or external quotation as Dan's verbatim thought.",
    "Confidence is a number from 0 to 1 for the anchor and classification together.",
    "Keep summary under 50 words. Keep tags and relatedReferences sparse. Do not repeat the full note content in the response."
  ].join(" ");
  const input = JSON.stringify({
    sourceLabel: sourceLabel || "Imported Scripture notes",
    segments: (Array.isArray(segments) ? segments : []).map((segment) => ({
      segmentIndex: segment.index,
      heading: segment.heading || "",
      body: segment.body || "",
      truncated: segment.truncated === true
    })),
    responseShape: {
      results: [{
        segmentIndex: 0,
        classification: "scripture_note | external_quotation | topical_material | sermon_material | noise | unresolved",
        reference: "canonical reference or blank",
        anchorType: "verse | range | passage | phrase | word",
        anchorText: "specific phrase or word when relevant",
        noteType: "observation | interpretation | word_study | theology | cross_reference | application | illustration | question | quotation | other",
        summary: "compact reusable summary",
        authorship: "dan_verbatim | dan_developed | ai_synthesis | external_source | mixed | unknown",
        attribution: "source citation when present",
        confidence: 0.9,
        relatedReferences: [],
        tags: [],
        warnings: []
      }]
    }
  });
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: SCRIPTURE_NOTE_MODEL,
          instructions,
          input,
          reasoning: { effort: "medium" },
          text: { verbosity: "low" },
          max_output_tokens: 12000
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        const error = createWorkflowError(
          `OpenAI Scripture note classification error: ${response.status} ${errorText}`,
          502,
          { upstreamStatus: response.status, attempt }
        );
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } else {
        const data = await response.json();
        const responseText = extractOpenAiText(data);
        if (!responseText) throw createWorkflowError("OpenAI returned empty Scripture note classifications", 502);
        return parseDraftJson(responseText);
      }
    } catch (error) {
      lastError = error;
      if (attempt === 3 || (error?.details?.upstreamStatus && error.details.upstreamStatus < 500 && error.details.upstreamStatus !== 429)) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  throw createWorkflowError("Scripture note classification failed after retries", 502, {
    cause: lastError?.message || "Unknown classifier failure"
  });
}

async function prepareAndStoreScriptureNoteImportSource({ openaiFileIdRefs, sourceLabel } = {}) {
  const prepared = await prepareScriptureNoteImportFile({ openaiFileIdRefs, fetchImpl: fetch });
  const importedAt = getNowIso();
  const filename = sanitizeFilenameForStorage(prepared.originalFilename);
  const storagePath = `scripture-note-imports/${importedAt.slice(0, 10)}/${prepared.checksumSha256.slice(0, 16)}-${filename}`;
  await storage.bucket(BUCKET_NAME).file(storagePath).save(prepared.buffer, {
    resumable: false,
    metadata: {
      contentType: prepared.contentType,
      metadata: {
        importedAt,
        sourceLabel: cleanManuscriptText(sourceLabel),
        checksumSha256: prepared.checksumSha256
      }
    }
  });
  const { buffer: _buffer, ...result } = prepared;
  return { ...result, storagePath, importedAt };
}

function getFilenameFromStoragePath(storagePath) {
  const cleanPath = cleanManuscriptText(storagePath);
  const filename = cleanPath.split("/").filter(Boolean).pop() || "sermon-media";
  return isValidFilename(filename) ? filename : "sermon-media";
}

function normalizePublicMediaDownloadUrl(value) {
  const cleanUrl = cleanManuscriptText(value);

  if (!cleanUrl) {
    throw createWorkflowError("Missing media URL", 400);
  }

  let parsed;

  try {
    parsed = new URL(cleanUrl);
  } catch (error) {
    throw createWorkflowError("Invalid media URL", 400, { url: cleanUrl });
  }

  if (parsed.hostname.endsWith("dropbox.com")) {
    parsed.searchParams.set("dl", "1");
    parsed.searchParams.delete("raw");
  }

  return parsed.toString();
}

function inferFilenameFromMediaUrl(value, fallback = "sermon-media") {
  const cleanFallback = cleanManuscriptText(fallback) || "sermon-media";

  try {
    const parsed = new URL(cleanManuscriptText(value));
    const lastPart = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    const safe = lastPart.replace(/[^a-zA-Z0-9._ -]+/g, "").trim().replace(/\s+/g, "-");
    return safe || cleanFallback;
  } catch (error) {
    return cleanFallback;
  }
}

function inferContentTypeFromFilename(filename, fallback = "") {
  const cleanFallback = cleanManuscriptText(fallback);
  const lower = cleanManuscriptText(filename).toLowerCase();

  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";

  return cleanFallback && cleanFallback !== "application/json"
    ? cleanFallback
    : "application/octet-stream";
}

function inferMediaTypeFromContentType(contentType) {
  const cleanContentType = cleanManuscriptText(contentType).toLowerCase();

  if (cleanContentType.startsWith("audio/")) {
    return "audio";
  }

  if (cleanContentType.startsWith("video/")) {
    return "video";
  }

  return "other";
}

function inferRecordedAtFromFilename(filename) {
  const cleanFilename = cleanManuscriptText(filename);
  const match = cleanFilename.match(/(20\d{6})[-_ ]?(\d{6})/);

  if (!match) {
    return "";
  }

  const date = match[1];
  const time = match[2];
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
}

function isYouTubeSermonMedia(media = {}) {
  const mediaType = cleanManuscriptText(media.mediaType).toLowerCase();
  const platform = cleanManuscriptText(media.platform).toLowerCase();
  const url = cleanManuscriptText(media.url).toLowerCase();

  return mediaType === "youtube" ||
    platform.includes("youtube") ||
    url.includes("youtube.com/") ||
    url.includes("youtu.be/");
}

function extractYouTubeVideoId(value) {
  const cleanValue = cleanManuscriptText(value);

  if (!cleanValue) {
    return "";
  }

  try {
    const parsed = new URL(cleanValue);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (hostname === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] || "";
    }

    if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname.endsWith(".youtube.com")) {
      const fromQuery = parsed.searchParams.get("v");
      if (fromQuery) return fromQuery;

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["live", "shorts", "embed"].includes(parts[0])) {
        return parts[1] || "";
      }
    }
  } catch {
    // Fall through to existing externalId or blank.
  }

  return /^[a-zA-Z0-9_-]{6,}$/.test(cleanValue) ? cleanValue : "";
}

function normalizeMediaSecond(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function formatMediaTimestamp(totalSeconds) {
  const cleanSeconds = normalizeMediaSecond(totalSeconds);
  const hours = Math.floor(cleanSeconds / 3600);
  const minutes = Math.floor((cleanSeconds % 3600) / 60);
  const seconds = cleanSeconds % 60;
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].join(":");
}

function parseCaptionTimestampSeconds(value) {
  const cleanValue = cleanManuscriptText(value).replace(",", ".");
  const parts = cleanValue.split(":").map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }

  if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }

  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1];
  }

  return parts[0] || 0;
}

function decodeCaptionEntities(value) {
  return cleanManuscriptText(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function cleanCaptionLine(value) {
  return decodeCaptionEntities(value)
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\an\d+\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWebVttTranscript(value) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const segments = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    const timingMatch = line.match(
      /^((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/
    );

    if (!timingMatch) {
      index += 1;
      continue;
    }

    index += 1;
    const textLines = [];

    while (index < lines.length && lines[index].trim()) {
      const textLine = cleanCaptionLine(lines[index]);

      if (textLine && !/^\[(music|applause|laughter)\]$/i.test(textLine)) {
        textLines.push(textLine);
      }

      index += 1;
    }

    const text = textLines.join(" ").replace(/\s+/g, " ").trim();

    if (text) {
      segments.push({
        startSeconds: parseCaptionTimestampSeconds(timingMatch[1]),
        endSeconds: parseCaptionTimestampSeconds(timingMatch[2]),
        text
      });
    }
  }

  return segments;
}

function buildTranscriptTextFromSegments(segments = [], { startSeconds = 0, endSeconds = 0 } = {}) {
  const cleanStart = normalizeMediaSecond(startSeconds);
  const cleanEnd = normalizeMediaSecond(endSeconds);
  const paragraphs = [];
  let previousText = "";

  for (const segment of segments) {
    if (cleanStart && Number(segment.endSeconds || 0) < cleanStart) {
      continue;
    }

    if (cleanEnd && Number(segment.startSeconds || 0) > cleanEnd) {
      continue;
    }

    const text = cleanManuscriptText(segment.text);

    if (!text || text === previousText) {
      continue;
    }

    paragraphs.push(text);
    previousText = text;
  }

  return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function chooseYouTubeCaptionTrack(metadata = {}) {
  const candidates = [];

  for (const [kind, groups] of [
    ["manual", metadata.subtitles],
    ["automatic", metadata.automatic_captions]
  ]) {
    if (!groups || typeof groups !== "object") {
      continue;
    }

    for (const [language, tracks] of Object.entries(groups)) {
      for (const track of Array.isArray(tracks) ? tracks : []) {
        if (!track?.url) {
          continue;
        }

        candidates.push({
          kind,
          language,
          ext: cleanManuscriptText(track.ext).toLowerCase(),
          url: track.url,
          name: cleanManuscriptText(track.name)
        });
      }
    }
  }

  const scoreTrack = (track) => {
    let score = 0;
    const language = track.language.toLowerCase();

    if (track.kind === "manual") score += 100;
    if (language === "en") score += 50;
    if (language === "en-us") score += 45;
    if (language.startsWith("en")) score += 30;
    if (track.ext === "vtt") score += 20;
    return score;
  };

  return candidates
    .filter((track) => track.language.toLowerCase().startsWith("en"))
    .sort((left, right) => scoreTrack(right) - scoreTrack(left))[0] || null;
}

function hasYouTubeOAuthConfig() {
  return Boolean(
    YOUTUBE_OAUTH_CLIENT_ID &&
    YOUTUBE_OAUTH_CLIENT_SECRET &&
    YOUTUBE_OAUTH_REFRESH_TOKEN
  );
}

async function getYouTubeOAuthAccessToken() {
  if (!hasYouTubeOAuthConfig()) {
    throw createWorkflowError("YouTube OAuth is not configured", 400, {
      code: "youtube_oauth_not_configured",
      requiredSecrets: [
        "YOUTUBE_OAUTH_CLIENT_ID",
        "YOUTUBE_OAUTH_CLIENT_SECRET",
        "YOUTUBE_OAUTH_REFRESH_TOKEN"
      ]
    });
  }

  const body = new URLSearchParams({
    client_id: YOUTUBE_OAUTH_CLIENT_ID,
    client_secret: YOUTUBE_OAUTH_CLIENT_SECRET,
    refresh_token: YOUTUBE_OAUTH_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw createWorkflowError("YouTube OAuth token refresh failed", 502, {
      code: "youtube_oauth_refresh_failed",
      status: response.status,
      error: data.error || "",
      errorDescription: data.error_description || ""
    });
  }

  return data.access_token;
}

function chooseOfficialYouTubeCaptionTrack(items = []) {
  const candidates = items
    .map((item) => ({
      id: item.id || "",
      language: cleanManuscriptText(item.snippet?.language).toLowerCase(),
      name: cleanManuscriptText(item.snippet?.name),
      trackKind: cleanManuscriptText(item.snippet?.trackKind).toLowerCase(),
      status: cleanManuscriptText(item.snippet?.status).toLowerCase(),
      isDraft: Boolean(item.snippet?.isDraft)
    }))
    .filter((item) => item.id && item.language.startsWith("en") && item.status !== "failed");

  const scoreTrack = (track) => {
    let score = 0;

    if (!track.isDraft) score += 50;
    if (track.trackKind === "standard") score += 100;
    if (track.trackKind === "asr") score += 40;
    if (track.language === "en") score += 30;
    if (track.language === "en-us") score += 25;
    if (track.name.toLowerCase().includes("english")) score += 10;
    return score;
  };

  return candidates.sort((left, right) => scoreTrack(right) - scoreTrack(left))[0] || null;
}

async function fetchOfficialYouTubeCaptionTranscript({ media, startSeconds = 0, endSeconds = 0 } = {}) {
  if (!hasYouTubeOAuthConfig()) {
    throw createWorkflowError("YouTube OAuth is not configured", 400, {
      code: "youtube_oauth_not_configured"
    });
  }

  const videoId = cleanManuscriptText(media?.externalId) || extractYouTubeVideoId(media?.url);

  if (!videoId) {
    throw createWorkflowError("YouTube OAuth transcript requires a video id", 400, {
      code: "youtube_video_id_missing",
      mediaId: media?.mediaId || ""
    });
  }

  const accessToken = await getYouTubeOAuthAccessToken();
  const listUrl = new URL("https://www.googleapis.com/youtube/v3/captions");
  listUrl.searchParams.set("part", "id,snippet");
  listUrl.searchParams.set("videoId", videoId);

  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const listData = await listResponse.json().catch(() => ({}));

  if (!listResponse.ok) {
    throw createWorkflowError("YouTube official caption list failed", 502, {
      code: "youtube_caption_list_failed",
      status: listResponse.status,
      error: listData.error?.message || listData.error || "",
      videoId
    });
  }

  const track = chooseOfficialYouTubeCaptionTrack(Array.isArray(listData.items) ? listData.items : []);

  if (!track) {
    throw createWorkflowError("No official English YouTube caption track found", 404, {
      code: "youtube_caption_track_not_found",
      videoId,
      trackCount: Array.isArray(listData.items) ? listData.items.length : 0
    });
  }

  const downloadUrl = new URL(`https://www.googleapis.com/youtube/v3/captions/${encodeURIComponent(track.id)}`);
  downloadUrl.searchParams.set("tfmt", "vtt");

  const downloadResponse = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const captionText = await downloadResponse.text();

  if (!downloadResponse.ok) {
    throw createWorkflowError("YouTube official caption download failed", 502, {
      code: "youtube_caption_download_failed",
      status: downloadResponse.status,
      error: captionText.slice(0, 500),
      videoId,
      captionId: track.id,
      trackKind: track.trackKind,
      language: track.language,
      nextStep: track.trackKind === "asr"
        ? "YouTube exposed only an auto-generated caption track and refused official download. Add a manual caption track in YouTube Studio, use local transcript extraction, or provide/directly import audio."
        : "Confirm the OAuth account can edit this video and that the caption track is downloadable."
    });
  }

  const segments = parseWebVttTranscript(captionText);
  const text = buildTranscriptTextFromSegments(segments, { startSeconds, endSeconds });

  if (text.length < 50) {
    throw createWorkflowError("Official YouTube caption track did not contain enough sermon text after trimming", 502, {
      code: "youtube_caption_text_too_short",
      videoId,
      captionId: track.id,
      startSeconds,
      endSeconds
    });
  }

  return {
    text,
    raw: {
      captionId: track.id,
      trackKind: track.trackKind,
      language: track.language,
      name: track.name,
      segmentCount: segments.length,
      videoId
    },
    model: `youtube-api-${track.trackKind || "caption"}-captions`,
    sizeBytes: Buffer.byteLength(captionText),
    contentType: downloadResponse.headers.get("content-type") || "text/vtt",
    method: "youtube_api_captions",
    startSeconds,
    endSeconds
  };
}

function buildYouTubeAuthError(error) {
  const text = [
    error?.message,
    error?.stderr,
    error?.stdout
  ].filter(Boolean).join("\n");

  if (!/sign in|not a bot|confirm.*bot|cookies/i.test(text)) {
    return null;
  }

  return createWorkflowError(
    "YouTube blocked anonymous transcript access and requires an authenticated cookie secret",
    401,
    {
      code: "youtube_auth_required",
      youtubeAuthRequired: true,
      cookieSecretConfigured: Boolean(YOUTUBE_COOKIES_BASE64),
      nextStep: "Configure YOUTUBE_COOKIES_BASE64 from a Netscape-format YouTube cookies.txt export, then retry transcription."
    }
  );
}

async function runYtDlp(args, options = {}) {
  let cookieDir = "";

  try {
    const resolvedArgs = [...args];

    if (YOUTUBE_COOKIES_BASE64) {
      cookieDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sermon-youtube-cookies-"));
      const cookiePath = path.join(cookieDir, "cookies.txt");
      await fs.promises.writeFile(
        cookiePath,
        Buffer.from(YOUTUBE_COOKIES_BASE64, "base64"),
        { mode: 0o600 }
      );
      resolvedArgs.unshift("--cookies", cookiePath);
    }

    return await execFileAsync(YT_DLP_BIN, resolvedArgs, options);
  } catch (error) {
    const authError = buildYouTubeAuthError(error);

    if (authError) {
      throw authError;
    }

    throw error;
  } finally {
    if (cookieDir) {
      await fs.promises.rm(cookieDir, { recursive: true, force: true });
    }
  }
}

async function loadYouTubeMetadata(url) {
  const cleanUrl = cleanManuscriptText(url);

  if (!cleanUrl) {
    throw createWorkflowError("YouTube transcription requires a media URL", 400);
  }

  const { stdout } = await runYtDlp(
    ["--dump-single-json", "--skip-download", "--no-playlist", cleanUrl],
    { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 }
  );

  return JSON.parse(stdout);
}

async function fetchYouTubeCaptionTranscript({ media, startSeconds = 0, endSeconds = 0 } = {}) {
  const metadata = await loadYouTubeMetadata(media.url);
  const track = chooseYouTubeCaptionTrack(metadata);

  if (!track) {
    throw createWorkflowError("No English YouTube caption track found", 404, {
      mediaId: media.mediaId || "",
      videoId: media.externalId || metadata.id || ""
    });
  }

  const response = await fetch(track.url);

  if (!response.ok) {
    throw createWorkflowError(
      `YouTube caption download failed: ${response.status}`,
      502,
      { mediaId: media.mediaId || "", videoId: media.externalId || metadata.id || "" }
    );
  }

  const captionText = await response.text();
  const segments = parseWebVttTranscript(captionText);
  const text = buildTranscriptTextFromSegments(segments, { startSeconds, endSeconds });

  if (text.length < 50) {
    throw createWorkflowError("YouTube caption track did not contain enough sermon text after trimming", 502, {
      mediaId: media.mediaId || "",
      videoId: media.externalId || metadata.id || "",
      startSeconds,
      endSeconds
    });
  }

  return {
    text,
    raw: {
      captionKind: track.kind,
      language: track.language,
      ext: track.ext,
      segmentCount: segments.length,
      videoId: metadata.id || media.externalId || ""
    },
    model: `youtube-${track.kind}-captions`,
    sizeBytes: Buffer.byteLength(captionText),
    contentType: "text/vtt",
    method: "youtube_captions",
    startSeconds,
    endSeconds
  };
}

async function downloadYouTubeAudioForTranscription({ media, startSeconds = 0, endSeconds = 0 } = {}) {
  const cleanUrl = cleanManuscriptText(media.url);

  if (!cleanUrl) {
    throw createWorkflowError("YouTube audio transcription requires a media URL", 400);
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sermon-youtube-"));
  const outputTemplate = path.join(tempDir, "sermon-audio.%(ext)s");
  const args = [
    "--no-playlist",
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "8",
    "--output",
    outputTemplate
  ];

  if (startSeconds || endSeconds) {
    const start = formatMediaTimestamp(startSeconds);
    const end = endSeconds ? formatMediaTimestamp(endSeconds) : "";
    args.push("--download-sections", `*${start}-${end}`, "--force-keyframes-at-cuts");
  }

  args.push(cleanUrl);

  try {
    await runYtDlp(args, {
      timeout: 20 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024
    });

    const files = await fs.promises.readdir(tempDir);
    const audioFile = files
      .map((filename) => path.join(tempDir, filename))
      .find((filename) => /\.(mp3|m4a|webm|opus|wav)$/i.test(filename));

    if (!audioFile) {
      throw createWorkflowError("YouTube audio download did not produce a transcribable audio file", 502);
    }

    const initialStats = await fs.promises.stat(audioFile);
    let finalAudioFile = audioFile;

    if (initialStats.size > MAX_OPENAI_TRANSCRIPTION_BYTES) {
      const compressedFile = path.join(tempDir, "sermon-audio-compressed.mp3");
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", audioFile, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", compressedFile],
        { timeout: 10 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 }
      );
      finalAudioFile = compressedFile;
    }

    const finalStats = await fs.promises.stat(finalAudioFile);

    if (finalStats.size > MAX_OPENAI_TRANSCRIPTION_BYTES) {
      throw createWorkflowError("Clipped YouTube audio is still too large for direct transcription", 413, {
        sizeBytes: finalStats.size,
        maxBytes: MAX_OPENAI_TRANSCRIPTION_BYTES,
        startSeconds,
        endSeconds,
        nextStep: "Set an endSeconds value or split the sermon into smaller media segments."
      });
    }

    return {
      buffer: await fs.promises.readFile(finalAudioFile),
      filename: path.basename(finalAudioFile),
      contentType: "audio/mpeg",
      sizeBytes: finalStats.size
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function importSermonMediaFromPublicUrl({
  sermonId,
  occasionId,
  url,
  filename,
  title,
  label,
  mediaType,
  contentType,
  recordedAt,
  notes,
  externalId,
  startSeconds,
  endSeconds,
  sourceRefs = []
} = {}, deps = {}) {
  const cleanSermonId = cleanManuscriptText(sermonId);
  const downloadUrl = normalizePublicMediaDownloadUrl(url);
  const inferredFilename = cleanManuscriptText(filename) ||
    inferFilenameFromMediaUrl(downloadUrl, "sermon-media");
  const safeFilename = inferredFilename.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw createWorkflowError(
      `Media URL download failed: ${response.status}`,
      502,
      { url: downloadUrl }
    );
  }

  const contentLength = Number(response.headers.get("content-length") || 0);

  if (contentLength > MAX_SERMON_MEDIA_IMPORT_BYTES) {
    throw createWorkflowError(
      "Media file is too large for URL import",
      413,
      { contentLength, maxBytes: MAX_SERMON_MEDIA_IMPORT_BYTES }
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_SERMON_MEDIA_IMPORT_BYTES) {
    throw createWorkflowError(
      "Media file is too large for URL import",
      413,
      { sizeBytes: buffer.length, maxBytes: MAX_SERMON_MEDIA_IMPORT_BYTES }
    );
  }

  const headerContentType = cleanManuscriptText(response.headers.get("content-type"));
  const resolvedContentType = inferContentTypeFromFilename(
    safeFilename,
    contentType || headerContentType
  );
  const resolvedMediaType = cleanManuscriptText(mediaType) ||
    inferMediaTypeFromContentType(resolvedContentType);
  const mediaId = `media-${slugifyExportPart(cleanSermonId)}-${randomUUID().slice(0, 8)}`;
  const storagePath = `sermon-media/${slugifyExportPart(cleanSermonId)}/${mediaId}/${safeFilename}`;
  const file = storage.bucket(BUCKET_NAME).file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: resolvedContentType,
      metadata: {
        sermonId: cleanSermonId,
        importedFromUrl: downloadUrl
      }
    }
  });

  const mediaResult = await createSermonMedia(
    {
      sermonId: cleanSermonId,
      occasionId,
      mediaId,
      mediaType: resolvedMediaType,
      platform: cleanManuscriptText(new URL(downloadUrl).hostname) || resolvedMediaType,
      externalId,
      startSeconds,
      endSeconds,
      url: cleanManuscriptText(url),
      storagePath,
      originalFilename: safeFilename,
      contentType: resolvedContentType,
      title: title || label || safeFilename,
      label: label || title || safeFilename,
      recordedAt: recordedAt || inferRecordedAtFromFilename(safeFilename),
      transcriptStatus: "none",
      notes,
      sourceRefs: [
        ...(Array.isArray(sourceRefs) ? sourceRefs : []),
        {
          type: "public_media_url",
          url: cleanManuscriptText(url),
          downloadUrl,
          importedAt: new Date().toISOString()
        },
        {
          type: "cloud_storage_media",
          storagePath,
          contentType: resolvedContentType,
          originalFilename: safeFilename,
          sizeBytes: buffer.length
        }
      ]
    },
    deps
  );

  return {
    media: mediaResult.media,
    import: {
      url: cleanManuscriptText(url),
      downloadUrl,
      filename: safeFilename,
      storagePath,
      contentType: resolvedContentType,
      sizeBytes: buffer.length
    }
  };
}

async function transcribeBufferWithOpenAi({
  buffer,
  filename = "sermon-media.mp3",
  contentType = "application/octet-stream",
  sizeBytes = 0,
  prompt = "",
  responseFormat = "json"
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createWorkflowError("Transcription requires a non-empty media buffer", 400);
  }

  const resolvedSizeBytes = Number(sizeBytes || buffer.length);

  if (resolvedSizeBytes > MAX_OPENAI_TRANSCRIPTION_BYTES) {
    throw createWorkflowError(
      "Media file is too large for direct transcription",
      413,
      {
        sizeBytes: resolvedSizeBytes,
        maxBytes: MAX_OPENAI_TRANSCRIPTION_BYTES,
        nextStep: "Compress or chunk the media before transcription."
      }
    );
  }

  const formData = new FormData();
  const blob = new Blob([buffer], { type: contentType });
  formData.append("file", blob, filename);
  formData.append("model", OPENAI_TRANSCRIPTION_MODEL);
  formData.append("response_format", responseFormat === "text" ? "text" : "json");

  const cleanPrompt = cleanManuscriptText(prompt);
  if (cleanPrompt) {
    formData.append("prompt", cleanPrompt);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createWorkflowError(`OpenAI transcription error: ${response.status} ${errorText}`, 502);
  }

  if (responseFormat === "text") {
    const text = await response.text();
    return {
      text: cleanManuscriptText(text),
      raw: text,
      model: OPENAI_TRANSCRIPTION_MODEL,
      sizeBytes: resolvedSizeBytes,
      contentType,
      method: "openai_transcription"
    };
  }

  const data = await response.json();
  const text = cleanManuscriptText(data.text);

  if (!text) {
    throw createWorkflowError("OpenAI transcription returned empty text", 502);
  }

  return {
    text,
    raw: data,
    model: OPENAI_TRANSCRIPTION_MODEL,
    sizeBytes: resolvedSizeBytes,
    contentType,
    method: "openai_transcription"
  };
}

async function transcribeStoredSermonMediaWithOpenAi({ media, prompt = "", responseFormat = "json" } = {}) {
  const storagePath = cleanManuscriptText(media?.storagePath);

  if (!storagePath) {
    throw createWorkflowError(
      "Media transcription requires a Cloud Storage media file",
      400,
      { mediaId: media?.mediaId || "" }
    );
  }

  const file = storage.bucket(BUCKET_NAME).file(storagePath);
  const [metadata] = await file.getMetadata();
  const sizeBytes = Number(metadata?.size || 0);
  const contentType = cleanManuscriptText(metadata?.contentType || media?.contentType) || "application/octet-stream";
  const [buffer] = await file.download();

  if (sizeBytes > MAX_OPENAI_TRANSCRIPTION_BYTES) {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sermon-transcription-"));
    const inputFilename = sanitizeFilenameForStorage(getFilenameFromStoragePath(storagePath));
    const inputPath = path.join(tempDir, inputFilename);
    const outputPath = path.join(tempDir, "sermon-audio-compressed.mp3");
    try {
      await fs.promises.writeFile(inputPath, buffer);
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", outputPath],
        { timeout: 12 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 }
      );
      const compressed = await fs.promises.readFile(outputPath);
      if (compressed.length > MAX_OPENAI_TRANSCRIPTION_BYTES) {
        throw createWorkflowError("Compressed sermon audio is still too large for transcription", 413, {
          originalSizeBytes: sizeBytes,
          compressedSizeBytes: compressed.length,
          maximumBytes: MAX_OPENAI_TRANSCRIPTION_BYTES,
          nextStep: "Split this unusually long recording into multiple files."
        });
      }
      const transcription = await transcribeBufferWithOpenAi({
        buffer: compressed,
        filename: "sermon-audio-compressed.mp3",
        contentType: "audio/mpeg",
        sizeBytes: compressed.length,
        prompt,
        responseFormat
      });
      return {
        ...transcription,
        method: "compressed_audio_openai_transcription",
        originalSizeBytes: sizeBytes,
        compressedSizeBytes: compressed.length
      };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  return transcribeBufferWithOpenAi({
    buffer,
    filename: getFilenameFromStoragePath(storagePath),
    contentType,
    sizeBytes,
    prompt,
    responseFormat
  });
}

async function transcribeYouTubeSermonMedia({ media, prompt = "", responseFormat = "json", preferCaptions = true } = {}) {
  const startSeconds = normalizeMediaSecond(media?.startSeconds);
  const endSeconds = normalizeMediaSecond(media?.endSeconds);
  const transcriptFailures = [];

  if (preferCaptions) {
    if (hasYouTubeOAuthConfig()) {
      try {
        return await fetchOfficialYouTubeCaptionTranscript({ media, startSeconds, endSeconds });
      } catch (error) {
        transcriptFailures.push({
          method: "youtube_api_captions",
          message: error.message || "Official YouTube caption transcript failed",
          details: error.details || {}
        });
        console.warn("Official YouTube caption transcript failed; falling back to downloader captions:", error.message || error);
      }
    }

    try {
      return await fetchYouTubeCaptionTranscript({ media, startSeconds, endSeconds });
    } catch (error) {
      transcriptFailures.push({
        method: "youtube_downloader_captions",
        message: error.message || "YouTube downloader caption transcript failed",
        details: error.details || {}
      });
      console.warn("YouTube caption transcript failed; falling back to audio transcription:", error.message || error);
    }
  }

  let audio;

  try {
    audio = await downloadYouTubeAudioForTranscription({ media, startSeconds, endSeconds });
  } catch (error) {
    transcriptFailures.push({
      method: "youtube_audio_download",
      message: error.message || "YouTube audio download failed",
      details: error.details || {}
    });

    const officialFailure = transcriptFailures.find((failure) => failure.method === "youtube_api_captions");
    const officialDetails = officialFailure?.details || {};

    throw createWorkflowError(
      officialDetails.code === "youtube_caption_download_failed"
        ? "Official YouTube captions were found but could not be downloaded, and fallback audio access was blocked"
        : "YouTube transcript ingestion failed across official captions and fallback audio",
      502,
      {
        code: "youtube_transcript_ingestion_failed",
        mediaId: media?.mediaId || "",
        videoId: media?.externalId || extractYouTubeVideoId(media?.url),
        failures: transcriptFailures,
        nextStep: officialDetails.nextStep ||
          "Use local transcript extraction, add a manual caption track in YouTube Studio, or provide a direct audio/video file."
      }
    );
  }

  const transcription = await transcribeBufferWithOpenAi({
    buffer: audio.buffer,
    filename: audio.filename,
    contentType: audio.contentType,
    sizeBytes: audio.sizeBytes,
    prompt,
    responseFormat
  });

  return {
    ...transcription,
    method: "youtube_audio_openai_transcription",
    startSeconds,
    endSeconds
  };
}

async function transcribeSermonMediaWithOpenAi({ media, prompt = "", responseFormat = "json", preferCaptions = true } = {}) {
  if (isYouTubeSermonMedia(media)) {
    return transcribeYouTubeSermonMedia({ media, prompt, responseFormat, preferCaptions });
  }

  return transcribeStoredSermonMediaWithOpenAi({ media, prompt, responseFormat });
}

async function importSermonRecordingForJob(input = {}) {
  const fileRefs = Array.isArray(input.openaiFileIdRefs) ? input.openaiFileIdRefs : [];
  if (fileRefs.length > 1) {
    throw createWorkflowError("Attach only one sermon recording per transcription job", 400, {
      code: "sermon_recording_attachment_count_invalid"
    });
  }
  const fileRef = fileRefs[0] || {};
  const url = cleanManuscriptText(
    fileRef.download_link || fileRef.downloadLink || input.url
  );
  if (!url) {
    throw createWorkflowError("Attach one audio/video recording or provide a public media URL", 400, {
      code: "sermon_recording_required"
    });
  }
  const filename = cleanManuscriptText(
    input.filename || fileRef.name || inferFilenameFromMediaUrl(url, "sermon-recording.mp3")
  );
  const contentType = cleanManuscriptText(input.contentType || fileRef.mime_type || fileRef.mimeType);
  const inferredType = inferContentTypeFromFilename(filename, contentType);
  if (!inferredType.startsWith("audio/") && !inferredType.startsWith("video/")) {
    throw createWorkflowError("The sermon recording must be an audio or video file", 400, {
      code: "sermon_recording_type_invalid",
      filename,
      contentType: inferredType
    });
  }
  return importSermonMediaFromPublicUrl({
    sermonId: input.sermonId,
    occasionId: input.occasionId,
    url,
    filename,
    title: input.title,
    label: input.label,
    mediaType: input.mediaType,
    contentType: inferredType,
    recordedAt: input.recordedAt,
    notes: input.notes,
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    sourceRefs: [
      ...(Array.isArray(input.sourceRefs) ? input.sourceRefs : []),
      ...(fileRefs.length ? [{
        type: "chatgpt_attachment",
        name: filename,
        contentType: inferredType
      }] : [])
    ]
  }, getSermonWorkspaceDependencies());
}

async function prepareSermonRecordingInboxFile(input = {}) {
  const fileRefs = Array.isArray(input.openaiFileIdRefs) ? input.openaiFileIdRefs : [];
  if (fileRefs.length > 1) {
    throw createWorkflowError("Import one unmatched recording per item", 400, {
      code: "recording_inbox_attachment_count_invalid"
    });
  }
  const fileRef = fileRefs[0] || {};
  const sourceUrl = cleanManuscriptText(input.url);
  const incomingUrl = cleanManuscriptText(fileRef.download_link || fileRef.downloadLink || sourceUrl);
  if (!incomingUrl) {
    throw createWorkflowError("Attach one recording or provide a public Dropbox/media URL", 400, {
      code: "recording_inbox_file_required"
    });
  }
  const downloadUrl = normalizePublicMediaDownloadUrl(incomingUrl);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw createWorkflowError(`Recording download failed: ${response.status}`, 502, {
      code: "recording_inbox_download_failed",
      sourceUrl: sourceUrl || "attached_file"
    });
  }
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (declaredBytes > MAX_SERMON_MEDIA_IMPORT_BYTES) {
    throw createWorkflowError("Recording is larger than the 100 MB inbox limit", 413, {
      code: "recording_inbox_file_too_large",
      sizeBytes: declaredBytes,
      maximumBytes: MAX_SERMON_MEDIA_IMPORT_BYTES
    });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_SERMON_MEDIA_IMPORT_BYTES) {
    throw createWorkflowError("Recording is larger than the 100 MB inbox limit", 413, {
      code: "recording_inbox_file_too_large",
      sizeBytes: buffer.length,
      maximumBytes: MAX_SERMON_MEDIA_IMPORT_BYTES
    });
  }
  const originalFilename = cleanManuscriptText(
    input.filename || fileRef.name || inferFilenameFromMediaUrl(downloadUrl, "unmatched-sermon-recording")
  );
  const headerType = cleanManuscriptText(response.headers.get("content-type"));
  const contentType = inferContentTypeFromFilename(
    originalFilename,
    input.contentType || fileRef.mime_type || fileRef.mimeType || headerType
  );
  if (contentType === "application/zip" || /\.zip$/i.test(originalFilename)) {
    throw createWorkflowError("This appears to be a Dropbox folder ZIP, not one recording", 400, {
      code: "recording_inbox_folder_link_not_supported",
      nextAction: "Provide individual file links or a batch list of Dropbox file links."
    });
  }
  if (!contentType.startsWith("audio/") && !contentType.startsWith("video/")) {
    throw createWorkflowError("The unmatched recording must be an audio or video file", 400, {
      code: "recording_inbox_file_type_invalid",
      originalFilename,
      contentType
    });
  }
  const hostname = new URL(downloadUrl).hostname.toLowerCase();
  const sourceKind = fileRefs.length ? "chatgpt_attachment" :
    (hostname.endsWith("dropbox.com") || hostname.endsWith("dropboxusercontent.com") ? "dropbox" : "public_url");
  return {
    buffer,
    originalFilename: sanitizeFilenameForStorage(originalFilename),
    contentType,
    sizeBytes: buffer.length,
    checksumSha256: createHash("sha256").update(buffer).digest("hex"),
    sourceKind,
    sourceUrl,
    sourceRefs: [{
      type: sourceKind,
      sourceUrl,
      originalFilename,
      importedAt: getNowIso()
    }]
  };
}

async function storeSermonRecordingInboxFile({ inboxId, prepared } = {}) {
  const filename = sanitizeFilenameForStorage(prepared.originalFilename);
  const storagePath = `sermon-recording-inbox/${slugifyExportPart(inboxId)}/${filename}`;
  await storage.bucket(BUCKET_NAME).file(storagePath).save(prepared.buffer, {
    resumable: false,
    metadata: {
      contentType: prepared.contentType,
      metadata: {
        inboxId,
        checksumSha256: prepared.checksumSha256,
        sourceKind: prepared.sourceKind
      }
    }
  });
  return { storagePath };
}

async function cleanSermonTranscriptWithOpenAi({ transcriptText, sermon, media, instructions = "" } = {}) {
  const rawText = cleanManuscriptText(transcriptText);
  if (!rawText) throw createWorkflowError("Transcript cleanup requires raw transcript text", 400);
  const cleanupInstructions = [
    "Conservatively clean a preached sermon transcript.",
    "Return only the cleaned transcript text, with readable paragraphs and no commentary about the work.",
    "Preserve the preacher's wording, sequence, illustrations, emphasis, repetitions that carry rhetorical force, and theological meaning.",
    "Remove only obvious speech-recognition artifacts, false starts with no meaning, accidental duplicate fragments, and filler that obstructs reading.",
    "Correct obvious punctuation, capitalization, speaker breaks, and Scripture-name transcription errors when the context makes the correction clear.",
    "Do not summarize, outline, improve the theology, add material, silently rewrite quotations, or make the sermon sound more polished than it was.",
    "When uncertain, preserve the original wording.",
    cleanManuscriptText(instructions)
  ].filter(Boolean).join(" ");
  const input = [
    `Sermon: ${cleanManuscriptText(sermon?.title)}`,
    `Scripture: ${cleanManuscriptText(sermon?.scriptureText)}`,
    `Recording: ${cleanManuscriptText(media?.label || media?.title)}`,
    "",
    "RAW TRANSCRIPT",
    rawText
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: SERMON_TRANSCRIPT_CLEANUP_MODEL,
      instructions: cleanupInstructions,
      input,
      reasoning: { effort: "low" },
      text: { verbosity: "high" },
      max_output_tokens: 48000
    })
  });
  if (!response.ok) {
    throw createWorkflowError(`OpenAI transcript cleanup error: ${response.status} ${await response.text()}`, 502);
  }
  const data = await response.json();
  const text = cleanManuscriptText(extractOpenAiText(data));
  if (!text) throw createWorkflowError("OpenAI returned an empty cleaned transcript", 502);
  return { text, model: SERMON_TRANSCRIPT_CLEANUP_MODEL };
}

async function analyzeUnmatchedRecordingTranscriptWithOpenAi({ transcriptText, recording } = {}) {
  const rawText = cleanManuscriptText(transcriptText);
  if (!rawText) throw createWorkflowError("Recording identification requires transcript text", 400);
  const transcriptSample = rawText.length <= 42000
    ? rawText
    : `${rawText.slice(0, 34000)}\n\n[...middle omitted for identification...]\n\n${rawText.slice(-8000)}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: SERMON_TRANSCRIPT_CLEANUP_MODEL,
      instructions: [
        "Extract identity clues from a raw sermon or Bible-lesson transcript.",
        "Do not invent a title, Scripture reference, date, venue, or service.",
        "A venueClue must explicitly name where the recording occurred. A serviceClue must explicitly identify a service type such as Sunday Morning, Prayer Service, funeral, chapel, or staff devotion; never treat conversational references to another pastor, night, or event as service metadata.",
        "Use an empty string or empty array when evidence is absent.",
        "Return only one JSON object with keys suggestedTitle, scriptureReferences, dateClues, venueClues, serviceClues, distinctivePhrases, and summary.",
        "Keep the summary under 80 words and return at most five distinctive phrases."
      ].join(" "),
      input: [
        `Recording filename: ${cleanManuscriptText(recording?.originalFilename)}`,
        "",
        "RAW TRANSCRIPT SAMPLE",
        transcriptSample
      ].join("\n"),
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens: 1400
    })
  });
  if (!response.ok) {
    throw createWorkflowError(`OpenAI recording identification error: ${response.status} ${await response.text()}`, 502);
  }
  const data = await response.json();
  const parsed = parseDraftJson(extractOpenAiText(data));
  const stringList = (value, maximum = 10) => (Array.isArray(value) ? value : [])
    .map(cleanManuscriptText)
    .filter(Boolean)
    .slice(0, maximum);
  return {
    suggestedTitle: cleanManuscriptText(parsed?.suggestedTitle),
    scriptureReferences: stringList(parsed?.scriptureReferences),
    dateClues: stringList(parsed?.dateClues, 5),
    venueClues: stringList(parsed?.venueClues, 5),
    serviceClues: stringList(parsed?.serviceClues, 5),
    distinctivePhrases: stringList(parsed?.distinctivePhrases, 5),
    summary: cleanManuscriptText(parsed?.summary).slice(0, 1200)
  };
}

async function buildSermonHubFromRecordingTranscriptWithOpenAi({ transcriptText, recording, identification } = {}) {
  const rawText = cleanManuscriptText(transcriptText);
  if (!rawText) throw createWorkflowError("Creating sermon notes requires transcript text", 400);
  const transcriptSample = rawText.length <= 90000
    ? rawText
    : `${rawText.slice(0, 70000)}\n\n[...middle omitted...]\n\n${rawText.slice(-20000)}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: SERMON_TRANSCRIPT_CLEANUP_MODEL,
      instructions: [
        "Create faithful archive notes for a preached sermon that has no surviving preparation notes.",
        "Derive every claim from the transcript. Do not add illustrations, theology, Scripture references, applications, or wording not supported by it.",
        "Preserve memorable exact lines in quotation marks when they are clear in the transcript.",
        "The outline should reflect the sermon's actual preached movement rather than impose a new structure.",
        "Return only one JSON object with string keys title, scriptureText, bigIdea, outline, and notes.",
        "Use an empty string for a field that cannot be established. Notes should be useful, substantial, and clearly organized."
      ].join(" "),
      input: [
        `Filename: ${cleanManuscriptText(recording?.originalFilename)}`,
        `Identification clues: ${JSON.stringify(identification || {})}`,
        "",
        "PREACHED TRANSCRIPT",
        transcriptSample
      ].join("\n"),
      reasoning: { effort: "medium" },
      text: { verbosity: "high" },
      max_output_tokens: 8000
    })
  });
  if (!response.ok) {
    throw createWorkflowError(`OpenAI transcript-to-sermon notes error: ${response.status} ${await response.text()}`, 502);
  }
  const parsed = parseDraftJson(extractOpenAiText(await response.json()));
  return {
    title: cleanManuscriptText(parsed?.title).slice(0, 300),
    scriptureText: cleanManuscriptText(parsed?.scriptureText).slice(0, 1000),
    bigIdea: cleanManuscriptText(parsed?.bigIdea).slice(0, 4000),
    outline: cleanManuscriptText(parsed?.outline).slice(0, 20000),
    notes: cleanManuscriptText(parsed?.notes).slice(0, 40000)
  };
}

async function enqueueSermonTranscriptionJob({ jobId } = {}) {
  const cleanJobId = cleanManuscriptText(jobId);
  const parent = `projects/${GCP_PROJECT_ID}/locations/${SERMON_TRANSCRIPTION_QUEUE_LOCATION}/queues/${SERMON_TRANSCRIPTION_QUEUE_NAME}`;
  const taskName = `${parent}/tasks/${cleanJobId}`;
  const client = await vertexAuth.getClient();
  try {
    await client.request({
      url: `https://cloudtasks.googleapis.com/v2/${parent}/tasks`,
      method: "POST",
      data: {
        task: {
          name: taskName,
          dispatchDeadline: "900s",
          httpRequest: {
            httpMethod: "POST",
            url: `${GPT_ACTION_BASE_URL}/internal/sermon-transcription-jobs/${encodeURIComponent(cleanJobId)}/run`,
            headers: {
              "Content-Type": "application/json",
              "x-api-key": BHE_API_KEY
            },
            body: Buffer.from(JSON.stringify({ jobId: cleanJobId })).toString("base64")
          }
        }
      }
    });
    return { queued: true, taskName, reused: false };
  } catch (error) {
    if (Number(error?.response?.status) === 409) {
      return { queued: true, taskName, reused: true };
    }
    throw error;
  }
}

function cleanManuscriptText(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
}

function truncateForPrompt(value, maxLength) {
  const text = cleanManuscriptText(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(maxLength - 36, 0)).trim()}\n[truncated for prompt]`;
}

function normalizeManuscriptCoverageText(value) {
  return cleanManuscriptText(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRequiredManuscriptCoverageItems(developmentCheckpoints = []) {
  const requiredTypes = new Set(["key_line", "verbatim", "illustration", "application"]);
  return developmentCheckpoints
    .filter((checkpoint) => checkpoint?.materialStatus === "placed")
    .filter((checkpoint) => checkpoint.exactWording === true || requiredTypes.has(checkpoint.checkpointType))
    .map((checkpoint) => ({
      checkpointId: cleanManuscriptText(checkpoint.checkpointId),
      checkpointType: cleanManuscriptText(checkpoint.checkpointType),
      heading: cleanManuscriptText(checkpoint.heading),
      placementTarget: cleanManuscriptText(checkpoint.placementTarget || checkpoint.canonicalTargets?.join(", ")),
      content: cleanManuscriptText(checkpoint.content),
      exactWording: checkpoint.exactWording === true || ["key_line", "verbatim"].includes(checkpoint.checkpointType)
    }))
    .filter((item) => item.content);
}

function validateManuscriptDevelopmentCoverage(manuscript, developmentCheckpoints = []) {
  const manuscriptText = normalizeManuscriptCoverageText(manuscript);
  const requiredItems = buildRequiredManuscriptCoverageItems(developmentCheckpoints);
  const covered = [];
  const missing = [];

  for (const item of requiredItems) {
    const requiredText = normalizeManuscriptCoverageText(item.content);
    if (!requiredText) continue;
    if (manuscriptText.includes(requiredText)) {
      covered.push({
        ...item,
        coverageMethod: "exact_text",
        coverageScore: 1
      });
      continue;
    }

    if (!item.exactWording && requiredText.length > 160) {
      const sample = requiredText.slice(0, 160).trim();
      if (sample && manuscriptText.includes(sample)) {
        covered.push({
          ...item,
          coverageMethod: "leading_text",
          coverageScore: 1
        });
        continue;
      }
    }

    missing.push({
      ...item,
      coverageMethod: item.exactWording ? "exact_text_required" : "semantic_evidence_required",
      coverageScore: 0
    });
  }

  return {
    requiredCount: requiredItems.length,
    missingCount: missing.length,
    coveredCount: covered.length,
    missing,
    covered
  };
}

function applyManuscriptSemanticCoverageAudit(manuscript, coverage = {}, auditItems = []) {
  const manuscriptText = normalizeManuscriptCoverageText(manuscript);
  const auditByCheckpointId = new Map((Array.isArray(auditItems) ? auditItems : [])
    .map((item) => [cleanManuscriptText(item?.checkpointId), item])
    .filter(([checkpointId]) => checkpointId));
  const retainedMissing = [];
  const semanticallyCovered = [];

  for (const item of coverage.missing || []) {
    if (item.exactWording) {
      retainedMissing.push(item);
      continue;
    }

    const audit = auditByCheckpointId.get(item.checkpointId);
    const evidence = cleanManuscriptText(audit?.evidence);
    const normalizedEvidence = normalizeManuscriptCoverageText(evidence);
    const confidence = cleanManuscriptText(audit?.confidence).toLowerCase();
    const evidenceIsVerifiable = normalizedEvidence.length >= 40 &&
      manuscriptText.includes(normalizedEvidence);

    if (audit?.included === true && confidence === "high" && evidenceIsVerifiable) {
      semanticallyCovered.push({
        ...item,
        coverageMethod: "semantic_evidence",
        coverageScore: 1,
        evidence,
        auditReason: cleanManuscriptText(audit.reason)
      });
      continue;
    }

    retainedMissing.push({
      ...item,
      semanticAudit: audit
        ? {
            included: audit.included === true,
            confidence,
            evidenceVerified: evidenceIsVerifiable,
            reason: cleanManuscriptText(audit.reason)
          }
        : null
    });
  }

  const covered = [...(coverage.covered || []), ...semanticallyCovered];
  return {
    ...coverage,
    missingCount: retainedMissing.length,
    coveredCount: covered.length,
    semanticAcceptedCount: semanticallyCovered.length,
    missing: retainedMissing,
    covered
  };
}

function validateManuscriptAssemblyCompliance(manuscript, options = {}) {
  const text = cleanManuscriptText(manuscript);
  const normalized = normalizeManuscriptCoverageText(text);
  const violations = [];
  const practicalMatch = text.match(/(?:^|\n)#{0,3}\s*PRACTICAL APPLICATIONS[\s\S]*$/i);
  const numberedApplicationCount = practicalMatch
    ? (practicalMatch[0].match(/(?:^|\n)\s*\d+[\.)]\s+/g) || []).length
    : 0;
  const personalApplicationSection = /(?:^|\n)#{0,3}\s*PERSONAL APPLICATION AND EXAMINATION\b/i.test(text);

  if (options.requireReliefEnding !== false) {
    if (personalApplicationSection) {
      violations.push({
        code: "personal_application_section_present",
        message: "Assembly mode should not add a separate Personal Application and Examination section when the requested ending is relief, not instruction."
      });
    }
    if (numberedApplicationCount > 3) {
      violations.push({
        code: "too_many_practical_applications",
        message: "Assembly mode should not end with a long list of practical applications.",
        count: numberedApplicationCount
      });
    }
  }

  const requiredFinalPosture = normalizeManuscriptCoverageText(options.simpleFinalPosture);
  if (options.requireSimpleFinalPosture === true && requiredFinalPosture &&
    !normalized.includes(requiredFinalPosture)) {
    violations.push({
      code: "missing_simple_final_posture",
      message: "Assembly mode should preserve the sermon-specific simple final posture supplied by Dan."
    });
  }

  return {
    violationCount: violations.length,
    violations
  };
}

function buildUnresolvedDevelopmentSessionBlockers(developmentSessions = []) {
  return developmentSessions
    .filter((session) => {
      const status = cleanManuscriptText(session.status);
      const checkpointCount = Number(session.checkpointCount) || 0;
      const hasSummary = Boolean(cleanManuscriptText(session.summary));
      const hasRawTranscript = Boolean(cleanManuscriptText(session.rawTranscriptSourceId));
      return status === "active" || (checkpointCount === 0 && !hasSummary && !hasRawTranscript);
    })
    .map((session) => ({
      sessionId: cleanManuscriptText(session.sessionId),
      label: cleanManuscriptText(session.label),
      mode: cleanManuscriptText(session.mode),
      status: cleanManuscriptText(session.status),
      checkpointCount: Number(session.checkpointCount) || 0,
      hasSummary: Boolean(cleanManuscriptText(session.summary)),
      hasRawTranscript: Boolean(cleanManuscriptText(session.rawTranscriptSourceId)),
      startedAt: cleanManuscriptText(session.startedAt)
    }));
}

function getSermonSourceRoles(source = {}) {
  const refs = Array.isArray(source.sourceRefs) ? source.sourceRefs : [];
  return refs
    .map((ref) => cleanManuscriptText(ref?.role || ref?.type))
    .filter(Boolean);
}

function getSermonSourceMaterialChars(source = {}) {
  return cleanManuscriptText(source.material).length;
}

function isGeneratedSermonManuscriptSource(source = {}) {
  const label = cleanManuscriptText(source.sourceLabel).toLowerCase();
  const summary = cleanManuscriptText(source.summary).toLowerCase();
  const roles = getSermonSourceRoles(source).map((role) => role.toLowerCase());
  return roles.includes("manuscript_draft") ||
    roles.includes("manuscript_material_plan") ||
    /\bgenerated manuscript draft\b/.test(label) ||
    /\bgpt manuscript draft\b/.test(summary);
}

function normalizeManuscriptSourceFilterList(value) {
  return (Array.isArray(value) ? value : [value])
    .map(cleanManuscriptText)
    .filter(Boolean);
}

function filterSermonSourcesForManuscript(sources = [], options = {}) {
  const excludedSourceIds = new Set(normalizeManuscriptSourceFilterList(options.excludeSourceIds));
  const excludedSourceTypes = new Set(normalizeManuscriptSourceFilterList(options.excludeSourceTypes));
  return sources.filter((source) => {
    const sourceId = cleanManuscriptText(source.sourceId);
    const sourceType = cleanManuscriptText(source.sourceType);
    if (excludedSourceIds.has(sourceId)) return false;
    if (excludedSourceTypes.has(sourceType)) return false;
    if (options.excludeGeneratedManuscriptSources === true && isGeneratedSermonManuscriptSource(source)) {
      return false;
    }
    return true;
  });
}

function buildSermonSourceManifestItem(source = {}, sermon = {}) {
  return {
    sourceId: source.sourceId || "",
    sourceType: source.sourceType || "other",
    sourceLabel: source.sourceLabel || "",
    summary: truncateForPrompt(source.summary || "", 900),
    roles: getSermonSourceRoles(source),
    isPrimaryManuscript: Boolean(
      sermon?.primaryManuscriptSourceId &&
      source.sourceId === sermon.primaryManuscriptSourceId
    ),
    materialChars: getSermonSourceMaterialChars(source),
    createdAt: source.createdAt || "",
    updatedAt: source.updatedAt || ""
  };
}

function scoreSermonSourceForFutureManuscript(source = {}, sermon = {}) {
  const label = cleanManuscriptText(source.sourceLabel).toLowerCase();
  const summary = cleanManuscriptText(source.summary).toLowerCase();
  const type = cleanManuscriptText(source.sourceType);
  const roles = getSermonSourceRoles(source).map((role) => role.toLowerCase());
  const haystack = `${label} ${summary} ${roles.join(" ")}`;
  let score = 0;

  if (sermon?.primaryManuscriptSourceId && source.sourceId === sermon.primaryManuscriptSourceId) {
    score += 1000;
  }

  if (roles.includes("primary_manuscript") || roles.includes("future_preaching_manuscript")) {
    score += 900;
  }

  if (roles.includes("manuscript_draft")) {
    score += 650;
  }

  if (/\b(refined|future|preach it again|preaching version|revised|synthesis)\b/.test(haystack)) {
    score += 600;
  }

  if (/\b(manuscript|draft|preparation|prep)\b/.test(haystack)) {
    score += 350;
  }

  if (type === "doc") score += 300;
  if (type === "study_notes" || type === "logos_export" || type === "old_chat") score += 240;
  if (type === "cleaned_transcript") score += 230;
  if (type === "preached_transcript" || type === "transcript") score += 220;
  if (type === "youtube_caption" || type === "vimeo_transcript" || type === "media_audio") score += 180;

  score += Math.min(Math.floor(getSermonSourceMaterialChars(source) / 2500), 50);

  return score;
}

function selectSermonSourcesDeterministically({ sermon = {}, sources = [], maxSources = 24 } = {}) {
  const sourceGroups = new Map([
    ["primary", []],
    ["manuscript", []],
    ["preparation", []],
    ["transcript", []],
    ["other", []]
  ]);

  for (const source of sources) {
    const type = cleanManuscriptText(source.sourceType);
    const label = cleanManuscriptText(source.sourceLabel).toLowerCase();
    const roles = getSermonSourceRoles(source).map((role) => role.toLowerCase());
    const isPrimary = sermon?.primaryManuscriptSourceId && source.sourceId === sermon.primaryManuscriptSourceId;
    const isManuscript = type === "doc" || roles.includes("manuscript_draft") || /\b(manuscript|synthesis|refined|future|preach it again|revised)\b/.test(label);
    const isPreparation = ["old_chat", "study_notes", "logos_export", "pdf"].includes(type);
    const isTranscript = ["transcript", "preached_transcript", "cleaned_transcript", "youtube_caption", "vimeo_transcript", "media_audio"].includes(type);
    const scored = {
      ...source,
      selectionScore: scoreSermonSourceForFutureManuscript(source, sermon)
    };

    if (isPrimary) {
      sourceGroups.get("primary").push(scored);
    } else if (isManuscript) {
      sourceGroups.get("manuscript").push(scored);
    } else if (isPreparation) {
      sourceGroups.get("preparation").push(scored);
    } else if (isTranscript) {
      sourceGroups.get("transcript").push(scored);
    } else {
      sourceGroups.get("other").push(scored);
    }
  }

  const sortSources = (items) => items.sort((left, right) => {
    if (right.selectionScore !== left.selectionScore) {
      return right.selectionScore - left.selectionScore;
    }

    return (right.createdAt || right.updatedAt || "").localeCompare(left.createdAt || left.updatedAt || "");
  });
  const selected = [];
  const selectedIds = new Set();
  const addSource = (source) => {
    if (!source?.sourceId || selectedIds.has(source.sourceId) || selected.length >= maxSources) {
      return;
    }

    selectedIds.add(source.sourceId);
    selected.push(source);
  };

  for (const group of sourceGroups.values()) {
    sortSources(group);
  }

  sourceGroups.get("primary").forEach(addSource);
  sourceGroups.get("manuscript").slice(0, 4).forEach(addSource);
  sourceGroups.get("preparation").slice(0, 8).forEach(addSource);
  sourceGroups.get("transcript").slice(0, 4).forEach(addSource);
  sourceGroups.get("other").slice(0, 4).forEach(addSource);

  const remaining = Array.from(sourceGroups.values())
    .flat()
    .filter((source) => !selectedIds.has(source.sourceId));
  sortSources(remaining);
  remaining.forEach(addSource);

  return selected.map((source) => ({
    sourceId: source.sourceId,
    sourceType: source.sourceType || "other",
    sourceLabel: source.sourceLabel || "",
    reason: source.sourceId === sermon?.primaryManuscriptSourceId
      ? "Existing primary manuscript source."
      : `Selected by backend source priority score ${source.selectionScore}.`
  }));
}

function parseSourceSelectionJson(text) {
  const cleanText = cleanManuscriptText(text);
  const fencedMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1].trim() : cleanText;

  try {
    const parsed = JSON.parse(jsonText);
    const selectedSources = Array.isArray(parsed.selectedSources) ? parsed.selectedSources : [];

    return selectedSources
      .map((item) => ({
        sourceId: cleanManuscriptText(item.sourceId),
        reason: cleanManuscriptText(item.reason)
      }))
      .filter((item) => item.sourceId);
  } catch (_error) {
    return [];
  }
}

async function selectSermonSourcesForManuscriptWithOpenAi({ sermon, sources, focusNotes, maxSources = 24 } = {}) {
  const manifest = sources.map((source) => buildSermonSourceManifestItem(source, sermon));
  const instructions = [
    "You select sermon source records for a backend manuscript synthesis workflow.",
    "Return JSON only with a selectedSources array.",
    "Prefer the primary manuscript source if present, then refined or manuscript sources, then preparation notes, then preached transcripts, then other supporting sources.",
    "Include enough preparation and transcript material to avoid missing key sermon substance.",
    "Do not select sources from outside the provided manifest."
  ].join(" ");
  const input = JSON.stringify({
    sermon: {
      sermonId: sermon?.sermonId,
      title: sermon?.title,
      scriptureText: sermon?.scriptureText,
      bigIdea: sermon?.bigIdea,
      primaryManuscriptSourceId: sermon?.primaryManuscriptSourceId || ""
    },
    focusNotes: cleanManuscriptText(focusNotes),
    maxSources,
    sourceManifest: manifest,
    responseShape: {
      selectedSources: [
        {
          sourceId: "source-id",
          reason: "brief reason"
        }
      ]
    }
  }, null, 2);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: SERMON_SOURCE_SELECTION_MODEL,
      instructions,
      input,
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens: 3000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createWorkflowError(`OpenAI source selection error: ${response.status} ${errorText}`, 502);
  }

  const data = await response.json();
  const selected = parseSourceSelectionJson(extractOpenAiText(data));
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const deduped = [];
  const seenIds = new Set();

  for (const item of selected) {
    const source = sourceById.get(item.sourceId);

    if (source && !seenIds.has(item.sourceId)) {
      seenIds.add(item.sourceId);
      deduped.push({
        sourceId: item.sourceId,
        sourceType: source.sourceType || "other",
        sourceLabel: source.sourceLabel || "",
        reason: item.reason || "Selected by backend AI source selector."
      });
    }

    if (deduped.length >= maxSources) {
      break;
    }
  }

  return deduped;
}

async function selectSermonSourcesForManuscript({ sermon, sources, focusNotes, maxSources, useAiSelection = true } = {}) {
  const deterministicSelection = selectSermonSourcesDeterministically({ sermon, sources, maxSources });

  if (!useAiSelection || deterministicSelection.length === 0) {
    return {
      method: "deterministic",
      selectedSources: deterministicSelection,
      warning: ""
    };
  }

  try {
    const aiSelection = await selectSermonSourcesForManuscriptWithOpenAi({
      sermon,
      sources,
      focusNotes,
      maxSources
    });

    if (aiSelection.length > 0) {
      return {
        method: "openai_manifest_selection",
        selectedSources: aiSelection,
        warning: ""
      };
    }
  } catch (error) {
    return {
      method: "deterministic_fallback",
      selectedSources: deterministicSelection,
      warning: error?.message || "AI source selection failed"
    };
  }

  return {
    method: "deterministic_fallback",
    selectedSources: deterministicSelection,
    warning: "AI source selection returned no usable source ids"
  };
}

async function hydrateSelectedSermonSources(selectedSources = [], deps = {}) {
  const hydrated = [];

  for (const selectedSource of selectedSources) {
    const result = await getSermonSource({ sourceId: selectedSource.sourceId }, deps);
    hydrated.push({
      ...result.source,
      selectionReason: selectedSource.reason || ""
    });
  }

  return hydrated;
}

function buildManuscriptDraftContext({
  sermon,
  folder,
  sources = [],
  preachingAnalyses = [],
  preachingProfile = null,
  semanticChunks = [],
  developmentCheckpoints = [],
  options = {}
} = {}) {
  const sourceBlocks = [];
  const sourceMaterialBudget = clampInteger(options.sourceMaterialBudget, 120000, 6000, 600000);
  let remainingSourceChars = sourceMaterialBudget;

  for (const source of sources) {
    if (remainingSourceChars <= 0) {
      break;
    }

    const material = cleanManuscriptText(source.material);
    const summary = cleanManuscriptText(source.summary);
    const available = Math.max(remainingSourceChars - 700, 0);
    const block = [
      `Source: ${source.sourceLabel || source.sourceId || "Untitled source"}`,
      source.sourceId ? `Source ID: ${source.sourceId}` : "",
      `Type: ${source.sourceType || "unknown"}`,
      source.selectionReason ? `Selection reason: ${source.selectionReason}` : "",
      summary ? `Summary: ${summary}` : "",
      material ? `Material:\n${truncateForPrompt(material, available)}` : ""
    ].filter(Boolean).join("\n");

    sourceBlocks.push(block);
    remainingSourceChars -= block.length + 2;
  }

  const chunkBlocks = semanticChunks.slice(0, clampInteger(options.semanticLimit, 10, 0, 20)).map((chunk, index) => [
    `Retrieved chunk ${index + 1}: ${chunk.title || "Untitled"}`,
    chunk.scriptureText ? `Passage: ${chunk.scriptureText}` : "",
    chunk.chunkType ? `Type: ${chunk.chunkType}` : "",
    cleanManuscriptText(chunk.text)
  ].filter(Boolean).join("\n"));

  const analysisBlocks = preachingAnalyses.slice(0, 5).map((analysis) => [
    analysis.summary ? `Analysis summary: ${analysis.summary}` : "",
    Array.isArray(analysis.styleObservations) && analysis.styleObservations.length
      ? `Style observations: ${analysis.styleObservations.join("; ")}`
      : "",
    Array.isArray(analysis.structureNotes) && analysis.structureNotes.length
      ? `Structure notes: ${analysis.structureNotes.join("; ")}`
      : ""
  ].filter(Boolean).join("\n"));

  const profileBlock = preachingProfile
    ? JSON.stringify({
      profileId: preachingProfile.profileId,
      summary: preachingProfile.summary,
      recurringStrengths: preachingProfile.recurringStrengths,
      stylePreferences: preachingProfile.stylePreferences,
      cautionFlags: preachingProfile.cautionFlags
    }, null, 2)
    : "";
  const placedDevelopmentMaterial = developmentCheckpoints
    .filter((checkpoint) => checkpoint.materialStatus === "placed")
    .sort((left, right) => {
      const targetDiff = cleanManuscriptText(left.placementTarget)
        .localeCompare(cleanManuscriptText(right.placementTarget));
      return targetDiff || cleanManuscriptText(left.createdAt).localeCompare(cleanManuscriptText(right.createdAt));
    });
  const developmentMaterialBlocks = placedDevelopmentMaterial.map((checkpoint) => [
    `Placement target: ${checkpoint.placementTarget || checkpoint.canonicalTargets?.join(", ") || "Approved sermon flow"}`,
    checkpoint.checkpointType ? `Material type: ${checkpoint.checkpointType}` : "",
    checkpoint.heading ? `Heading: ${checkpoint.heading}` : "",
    checkpoint.exactWording === true ? "Wording rule: Preserve this wording exactly." : "",
    checkpoint.placementNotes ? `Placement notes: ${checkpoint.placementNotes}` : "",
    `Content:\n${cleanManuscriptText(checkpoint.content)}`,
    checkpoint.checkpointId ? `Checkpoint ID: ${checkpoint.checkpointId}` : ""
  ].filter(Boolean).join("\n"));

  return [
    "SERMON RECORD",
    JSON.stringify({
      sermonId: sermon?.sermonId,
      title: sermon?.title,
      status: sermon?.status,
      folder: folder?.name || "",
      scriptureText: sermon?.scriptureText || "",
      bigIdea: sermon?.bigIdea || "",
      occasion: sermon?.occasion || "",
      targetDate: sermon?.targetDate || "",
      preachedDate: sermon?.preachedDate || "",
      outline: sermon?.outline || "",
      notes: sermon?.notes || ""
    }, null, 2),
    "",
    profileBlock ? "PREACHING PROFILE" : "",
    profileBlock,
    "",
    analysisBlocks.length ? "RECENT PREACHING ANALYSIS" : "",
    analysisBlocks.join("\n\n"),
    "",
    developmentMaterialBlocks.length ? "APPROVED PLACED DEVELOPMENT MATERIAL" : "",
    developmentMaterialBlocks.join("\n\n"),
    "",
    sourceBlocks.length ? "SOURCE MATERIAL" : "",
    sourceBlocks.join("\n\n"),
    "",
    chunkBlocks.length ? "SEMANTICALLY RETRIEVED ARCHIVE CHUNKS" : "",
    chunkBlocks.join("\n\n")
  ].filter((part) => part !== "").join("\n");
}

async function generateSermonManuscriptWithOpenAi({ contextText, options = {} } = {}) {
  const focusNotes = cleanManuscriptText(options.focusNotes);
  const targetLength = cleanManuscriptText(options.targetLength) || "full sermon manuscript";
  const tone = cleanManuscriptText(options.tone) ||
    "pastoral, text-driven, clear, earnest, warm, and suitable for Dan to preach";
  const manuscriptMode = options.manuscriptMode === "assembly" ? "assembly" : "draft";
  const manuscriptFormat = cleanManuscriptText(options.manuscriptFormat) ||
    (manuscriptMode === "assembly" ? DEFAULT_SERMON_ASSEMBLY_FORMAT : DEFAULT_SERMON_MANUSCRIPT_FORMAT);
  const instructions = manuscriptMode === "assembly"
    ? [
        "You are assembling Dan's sermon manuscript from supplied sermon material.",
        "Use only the provided backend-selected sermon workspace context as your factual and conceptual source.",
        "Do not act as the primary author of a fuller sermon. Preserve Dan's supplied wording, sequence, emphasis, tone, and restraint.",
        "Use approved placed development material in its named placement target, and preserve any item marked exact wording verbatim.",
        "Treat placement notes as binding shape and tone instructions, not optional suggestions.",
        "Do not add a fuller application framework, numbered practical-application list, extra movement, or separate Personal Application and Examination section unless the supplied material explicitly asks for it.",
        "When the supplied material calls for relief rather than instruction, keep the landing simple and pastoral.",
        "If source material is thin, leave a clearly labeled [NEEDS DAN DEVELOPMENT] gap instead of inventing substance.",
        "Use short connective prose only where needed to make Dan's material preachably coherent.",
        "Do not invent dates, stories, quotations, source claims, or personal details that are not supported by the context.",
        "Unplaced and intentionally-cut development material is deliberately absent and must not be reconstructed or reintroduced.",
        "Return the complete assembled manuscript."
      ].join(" ")
    : [
        "You are Dan's sermon manuscript drafting assistant.",
        "Use only the provided backend-selected sermon workspace context as your factual and conceptual source.",
        "Treat backend-selected primary/refined manuscript sources as the future-preaching baseline when present.",
        "Use preparation notes for intended structure, preached transcripts for strongest live language, and preaching analysis/profile for reusable improvements.",
        "Use approved placed development material in its named placement target, and preserve any item marked exact wording verbatim.",
        "Unplaced and intentionally-cut development material is deliberately absent and must not be reconstructed or reintroduced.",
        "Write a coherent sermon manuscript that preserves Dan's wording, burdens, illustrations, and structure when they appear in the source material.",
        "Do not flatten the material into a short summary. Develop the sermon in full prose with headings.",
        "Do not invent dates, stories, quotations, source claims, or personal details that are not supported by the context.",
        "If the archive context is thin, still draft what can be drafted and add a short 'Needs More Source Material' note at the end.",
        "Avoid academic stiffness. Make it preachable, clear, pastoral, and text-governed.",
        "Follow the provided manuscript format closely so Dan can preach from a familiar structure every time."
      ].join(" ");
  const input = [
    `Manuscript mode: ${manuscriptMode}`,
    `Target length: ${targetLength}`,
    `Tone: ${tone}`,
    focusNotes ? `Specific focus notes from Dan: ${focusNotes}` : "",
    "",
    "Required manuscript format:",
    manuscriptFormat,
    "",
    "Sermon workspace context:",
    contextText
  ].filter(Boolean).join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || SERMON_MANUSCRIPT_MODEL,
      instructions,
      input,
      reasoning: { effort: "medium" },
      text: { verbosity: "high" },
      max_output_tokens: clampInteger(options.maxOutputTokens, 24000, 2000, 128000)
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createWorkflowError(`OpenAI API error: ${response.status} ${errorText}`, 502);
  }

  const data = await response.json();
  const manuscript = extractOpenAiText(data);

  if (!manuscript) {
    throw createWorkflowError("OpenAI API returned empty manuscript text", 502);
  }

  return manuscript;
}

async function auditSermonManuscriptCoverageWithOpenAi({
  manuscript,
  coverageItems = [],
  options = {}
} = {}) {
  const items = coverageItems
    .filter((item) => item && !item.exactWording)
    .map((item) => ({
      checkpointId: item.checkpointId,
      checkpointType: item.checkpointType,
      heading: item.heading,
      placementTarget: item.placementTarget,
      requiredMeaning: item.content
    }));

  if (items.length === 0) {
    return [];
  }

  const instructions = [
    "You audit whether a completed sermon manuscript faithfully includes supplied development material.",
    "Judge meaning, not exact wording. Do not reward a vague thematic resemblance.",
    "An item is included only when its complete controlling thought and distinctive details are actually present.",
    "For every included item, quote one exact contiguous passage from the manuscript as evidence.",
    "Evidence must be copied exactly, contain at least one complete sentence, and must not use ellipses or combine separate passages.",
    "Use confidence high only when the evidence clearly carries the required meaning. Otherwise mark included false.",
    "Return JSON only with one items array. Each item must contain checkpointId, included, confidence, evidence, and reason."
  ].join(" ");
  const input = [
    "Development material to verify:",
    JSON.stringify(items, null, 2),
    "",
    "Completed manuscript:",
    cleanManuscriptText(manuscript)
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || SERMON_MANUSCRIPT_MODEL,
      instructions,
      input,
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      max_output_tokens: clampInteger(options.maxOutputTokens, 4000, 1000, 8000)
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createWorkflowError(`OpenAI manuscript coverage audit error: ${response.status} ${errorText}`, 502);
  }

  const parsed = parseDraftJson(extractOpenAiText(await response.json()));
  return (Array.isArray(parsed?.items) ? parsed.items : [])
    .map((item) => ({
      checkpointId: cleanManuscriptText(item?.checkpointId),
      included: item?.included === true,
      confidence: cleanManuscriptText(item?.confidence).toLowerCase(),
      evidence: cleanManuscriptText(item?.evidence).slice(0, 2000),
      reason: cleanManuscriptText(item?.reason).slice(0, 1200)
    }))
    .filter((item) => item.checkpointId);
}

async function validateManuscriptCoverageWithSemanticAudit({
  manuscript,
  developmentCheckpoints = [],
  options = {}
} = {}) {
  let coverage = validateManuscriptDevelopmentCoverage(manuscript, developmentCheckpoints);
  const semanticCandidates = coverage.missing.filter((item) => !item.exactWording);

  if (semanticCandidates.length === 0) {
    return {
      coverage,
      semanticAuditApplied: false,
      semanticAuditWarning: ""
    };
  }

  try {
    const auditItems = await auditSermonManuscriptCoverageWithOpenAi({
      manuscript,
      coverageItems: semanticCandidates,
      options
    });
    coverage = applyManuscriptSemanticCoverageAudit(manuscript, coverage, auditItems);
    return {
      coverage,
      semanticAuditApplied: true,
      semanticAuditWarning: ""
    };
  } catch (error) {
    return {
      coverage,
      semanticAuditApplied: false,
      semanticAuditWarning: error?.message || "Semantic manuscript coverage audit failed"
    };
  }
}

async function reviseSermonManuscriptForCoverageWithOpenAi({
  manuscript,
  contextText,
  missingCoverageItems = [],
  options = {}
} = {}) {
  const missingItems = missingCoverageItems.map((item) => ({
    checkpointId: item.checkpointId,
    checkpointType: item.checkpointType,
    heading: item.heading,
    placementTarget: item.placementTarget || "Approved sermon flow",
    exactWording: item.exactWording,
    content: item.content
  }));
  const instructions = [
    "You repair Dan's sermon manuscript by adding required placed development material that was omitted.",
    "Return the complete revised manuscript, not a summary or patch.",
    "Use only the provided manuscript and sermon workspace context.",
    "Insert each missing item into its placement target or the nearest fitting sermon movement.",
    "For exact wording items, copy the content verbatim.",
    "For every other missing item, preserve its complete thought and distinctive details, staying close to the supplied language.",
    "Do not merely mention the topic, add a heading, or claim that an item is present without actually developing it in the manuscript.",
    "Do not reintroduce unplaced or intentionally-cut material.",
    "Do not invent new stories, dates, quotations, source claims, or personal details."
  ].join(" ");
  const input = [
    "Missing required placed development material:",
    JSON.stringify(missingItems, null, 2),
    "",
    "Current manuscript:",
    manuscript,
    "",
    "Sermon workspace context:",
    contextText
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || SERMON_MANUSCRIPT_MODEL,
      instructions,
      input,
      reasoning: { effort: "medium" },
      text: { verbosity: "high" },
      max_output_tokens: clampInteger(options.maxOutputTokens, 24000, 2000, 128000)
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createWorkflowError(`OpenAI manuscript coverage repair error: ${response.status} ${errorText}`, 502);
  }

  const revised = extractOpenAiText(await response.json());
  if (!revised) {
    throw createWorkflowError("OpenAI API returned empty manuscript coverage repair text", 502);
  }

  return revised;
}

function slugifyExportPart(value) {
  const slug = cleanManuscriptText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || "sermon-manuscript";
}

function buildDocxParagraphsFromManuscript({ title, manuscript, sermon } = {}) {
  const paragraphs = [];
  const cleanTitle = cleanManuscriptText(title) || cleanManuscriptText(sermon?.title) || "Sermon Manuscript";
  const cleanManuscript = cleanManuscriptText(manuscript);

  paragraphs.push(new Paragraph({
    text: cleanTitle,
    heading: HeadingLevel.TITLE
  }));

  const metadataParts = [
    cleanManuscriptText(sermon?.scriptureText),
    cleanManuscriptText(sermon?.occasion),
    cleanManuscriptText(sermon?.preachedDate || sermon?.targetDate)
  ].filter(Boolean);

  if (metadataParts.length > 0) {
    paragraphs.push(new Paragraph({
      children: [
        new TextRun({
          text: metadataParts.join(" | "),
          italics: true
        })
      ],
      spacing: { after: 240 }
    }));
  }

  const lines = cleanManuscript.split(/\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      paragraphs.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1].length === 1
        ? HeadingLevel.HEADING_1
        : headingMatch[1].length === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
      paragraphs.push(new Paragraph({
        text: headingMatch[2].trim(),
        heading: level
      }));
      continue;
    }

    if (line.length <= 90 && /[:?]$/.test(line) && !/[.!]$/.test(line)) {
      paragraphs.push(new Paragraph({
        text: line,
        heading: HeadingLevel.HEADING_2
      }));
      continue;
    }

    paragraphs.push(new Paragraph({
      text: line,
      spacing: { after: 160 }
    }));
  }

  return paragraphs;
}

async function buildSermonManuscriptDocxBuffer({ title, manuscript, sermon } = {}) {
  const doc = new Document({
    creator: "BHE Sermon Workspace",
    description: "Generated sermon manuscript draft",
    title: cleanManuscriptText(title) || cleanManuscriptText(sermon?.title) || "Sermon Manuscript",
    sections: [
      {
        properties: {},
        children: buildDocxParagraphsFromManuscript({ title, manuscript, sermon })
      }
    ]
  });

  return Packer.toBuffer(doc);
}

async function uploadSermonManuscriptDocxExport({ sermonId, title, manuscript, sermon, generatedAt } = {}) {
  const cleanSermonId = cleanManuscriptText(sermonId);
  const cleanGeneratedAt = cleanManuscriptText(generatedAt) || new Date().toISOString();
  const datePart = cleanGeneratedAt.replace(/[:.]/g, "-");
  const filename = `${slugifyExportPart(title || sermon?.title)}-${datePart}.docx`;
  const storagePath = `sermon-manuscripts/${slugifyExportPart(cleanSermonId)}/${filename}`;
  const buffer = await buildSermonManuscriptDocxBuffer({ title, manuscript, sermon });
  const file = storage.bucket(BUCKET_NAME).file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      metadata: {
        sermonId: cleanSermonId,
        generatedAt: cleanGeneratedAt
      }
    }
  });

  const [downloadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
  });

  return {
    filename,
    storagePath,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: buffer.length,
    downloadUrl,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  };
}

async function createSermonSourceDownload({ source, sourceRef } = {}, deps = {}) {
  const sermonId = cleanManuscriptText(source?.sermonId);
  const storagePath = cleanManuscriptText(sourceRef?.storagePath);
  const expectedPrefix = `sermon-manuscripts/${slugifyExportPart(sermonId)}/`;
  if (
    !sermonId ||
    !storagePath ||
    storagePath.includes("..") ||
    !storagePath.startsWith(expectedPrefix) ||
    !storagePath.toLowerCase().endsWith(".docx")
  ) {
    throw createWorkflowError("Sermon manuscript storage path is invalid", 400, {
      code: "invalid_sermon_manuscript_storage_path",
      sermonId,
      storagePath
    });
  }

  const expiresAtMs = (typeof deps.nowMs === "function" ? deps.nowMs() : Date.now()) +
    7 * 24 * 60 * 60 * 1000;
  const storageClient = deps.storage || storage;
  const bucketName = cleanManuscriptText(deps.bucketName) || BUCKET_NAME;
  const file = storageClient.bucket(bucketName).file(storagePath);
  const [downloadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAtMs
  });

  return {
    filename: cleanManuscriptText(sourceRef?.filename) || getFilenameFromStoragePath(storagePath),
    storagePath,
    contentType: cleanManuscriptText(sourceRef?.contentType) ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: Number.isFinite(Number(sourceRef?.sizeBytes)) ? Number(sourceRef.sizeBytes) : 0,
    downloadUrl,
    downloadUrlExpiresAt: new Date(expiresAtMs).toISOString()
  };
}

async function downloadSermonArtifact({ storagePath } = {}) {
  const cleanStoragePath = cleanManuscriptText(storagePath);
  if (!cleanStoragePath) throw createWorkflowError("Sermon artifact storagePath is required", 400);
  const [buffer] = await storage.bucket(BUCKET_NAME).file(cleanStoragePath).download();
  return buffer;
}

async function uploadSermonPreachingPacket({ sermonId, packetId, title, buffer, generatedAt } = {}) {
  const cleanGeneratedAt = cleanManuscriptText(generatedAt) || new Date().toISOString();
  const filename = `${slugifyExportPart(title)}-preaching-packet-${cleanGeneratedAt.replace(/[:.]/g, "-")}.zip`;
  const storagePath = `sermon-preaching-packets/${slugifyExportPart(sermonId)}/${filename}`;
  const file = storage.bucket(BUCKET_NAME).file(storagePath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: "application/zip",
      metadata: {
        sermonId: cleanManuscriptText(sermonId),
        packetId: cleanManuscriptText(packetId),
        generatedAt: cleanGeneratedAt
      }
    }
  });
  const expiresAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const [downloadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAtMs,
    responseDisposition: buildAttachmentContentDisposition(filename),
    responseType: "application/zip"
  });
  return {
    filename,
    storagePath,
    contentType: "application/zip",
    sizeBytes: buffer.length,
    downloadUrl,
    downloadUrlExpiresAt: new Date(expiresAtMs).toISOString()
  };
}

function cleanPresentationText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getPresentationTheme(template = {}) {
  const theme = isPlainObject(template.theme) ? template.theme : {};
  const fonts = isPlainObject(theme.fonts) ? theme.fonts : {};
  const colors = isPlainObject(theme.colors) ? theme.colors : {};

  return {
    fonts: {
      heading: cleanPresentationText(fonts.heading) || "Aptos Display",
      body: cleanPresentationText(fonts.body) || "Aptos"
    },
    colors: {
      background: cleanPresentationText(colors.background).replace(/^#/, "") || "101820",
      surface: cleanPresentationText(colors.surface).replace(/^#/, "") || "17212B",
      primary: cleanPresentationText(colors.primary).replace(/^#/, "") || "F2C14E",
      text: cleanPresentationText(colors.text).replace(/^#/, "") || "FFFFFF",
      muted: cleanPresentationText(colors.muted).replace(/^#/, "") || "D8DEE9",
      accent: cleanPresentationText(colors.accent).replace(/^#/, "") || "7FB069"
    }
  };
}

function getPresentationLayout(template = {}, slideType = "main_point") {
  const layouts = isPlainObject(template.layouts) ? template.layouts : {};
  return isPlainObject(layouts[slideType]) ? layouts[slideType] : {};
}

function addPresentationFooter(slide, { sermon, template, theme }) {
  const footerText = [
    cleanPresentationText(sermon?.seriesTitle),
    cleanPresentationText(template?.name)
  ].filter(Boolean)[0] || "Sermon Slides";

  slide.addText(footerText, {
    x: 0.65,
    y: 6.86,
    w: 8.6,
    h: 0.22,
    fontFace: theme.fonts.body,
    fontSize: 8,
    color: theme.colors.muted,
    margin: 0,
    breakLine: false,
    fit: "shrink"
  });
}

function addPresentationBackground(slide, theme) {
  slide.background = { color: theme.colors.background };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: theme.colors.background },
    line: { color: theme.colors.background, transparency: 100 }
  });
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.16,
    h: 7.5,
    fill: { color: theme.colors.primary },
    line: { color: theme.colors.primary, transparency: 100 }
  });
}

function addPresentationHeading(slide, text, theme, y = 0.65, fontSize = 34) {
  slide.addText(cleanPresentationText(text), {
    x: 0.75,
    y,
    w: 11.85,
    h: 0.75,
    fontFace: theme.fonts.heading,
    bold: true,
    fontSize,
    color: theme.colors.primary,
    margin: 0,
    breakLine: false,
    fit: "shrink"
  });
}

function addPresentationBody(slide, text, theme, y = 1.72, fontSize = 28, height = 4.6) {
  slide.addText(cleanPresentationText(text), {
    x: 0.95,
    y,
    w: 11.2,
    h: height,
    fontFace: theme.fonts.body,
    fontSize,
    color: theme.colors.text,
    margin: 0.08,
    breakLine: false,
    fit: "shrink",
    valign: "mid"
  });
}

function getSlideBodyText(slide = {}) {
  return cleanPresentationText(slide.body || slide.text || slide.subtitle);
}

function addBulletList(slideObj, bullets = [], theme, y = 2.0) {
  if (!Array.isArray(bullets) || bullets.length === 0) {
    return false;
  }

  slideObj.addText(
    bullets.map((bullet) => ({
      text: cleanPresentationText(bullet),
      options: { bullet: { type: "bullet" }, breakLine: true }
    })),
    {
      x: 1.05,
      y,
      w: 10.9,
      h: 4.15,
      fontFace: theme.fonts.body,
      fontSize: 25,
      color: theme.colors.text,
      fit: "shrink",
      breakLine: false
    }
  );
  return true;
}

async function renderSermonPresentationPptx({ sermon, template, presentation } = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "BHE Sermon Workspace";
  pptx.company = "Biblical Heritage Exhibit";
  pptx.subject = cleanPresentationText(sermon?.scriptureText);
  pptx.title = cleanPresentationText(presentation?.title) || cleanPresentationText(sermon?.title) || "Sermon Slides";
  pptx.lang = "en-US";
  pptx.theme = {
    headFontFace: getPresentationTheme(template).fonts.heading,
    bodyFontFace: getPresentationTheme(template).fonts.body,
    lang: "en-US"
  };

  const theme = getPresentationTheme(template);
  const slides = Array.isArray(presentation?.slidePlan?.slides) ? presentation.slidePlan.slides : [];

  for (const planSlide of slides) {
    const slide = pptx.addSlide();
    addPresentationBackground(slide, theme);

    if (planSlide.type === "title") {
      const layout = getPresentationLayout(template, "title");
      slide.addText(cleanPresentationText(planSlide.title || presentation?.title || sermon?.title), {
        x: 0.78,
        y: 1.75,
        w: 11.7,
        h: 1.7,
        fontFace: theme.fonts.heading,
        bold: true,
        fontSize: Number(layout.titleSize) || 46,
        color: theme.colors.text,
        margin: 0,
        fit: "shrink",
        breakLine: false,
        valign: "mid"
      });
      slide.addShape("line", {
        x: 0.82,
        y: 3.62,
        w: 4.3,
        h: 0,
        line: { color: theme.colors.primary, width: 3 }
      });
      slide.addText(cleanPresentationText(planSlide.subtitle || sermon?.scriptureText || sermon?.seriesTitle), {
        x: 0.82,
        y: 3.92,
        w: 10.8,
        h: 0.72,
        fontFace: theme.fonts.body,
        fontSize: Number(layout.subtitleSize) || 23,
        color: theme.colors.muted,
        margin: 0,
        fit: "shrink",
        breakLine: false
      });
    } else if (planSlide.type === "scripture") {
      const layout = getPresentationLayout(template, "scripture");
      addPresentationHeading(slide, planSlide.reference || "Scripture", theme, 0.76, Number(layout.referenceSize) || 26);
      addPresentationBody(slide, planSlide.text || planSlide.body || sermon?.scriptureText, theme, 1.62, Number(layout.textSize) || 31, 4.75);
    } else if (planSlide.type === "quote") {
      const layout = getPresentationLayout(template, "quote");
      addPresentationBody(slide, `“${getSlideBodyText(planSlide)}”`, theme, 1.25, Number(layout.bodySize) || 33, 4.25);
      if (planSlide.citation) {
        slide.addText(cleanPresentationText(planSlide.citation), {
          x: 1.05,
          y: 5.75,
          w: 10.6,
          h: 0.42,
          fontFace: theme.fonts.body,
          italic: true,
          fontSize: Number(layout.citationSize) || 19,
          color: theme.colors.primary,
          margin: 0,
          fit: "shrink"
        });
      }
    } else {
      const layout = getPresentationLayout(template, planSlide.type);
      const heading = cleanPresentationText(planSlide.heading || planSlide.title || (
        planSlide.type === "big_idea" ? "Big Idea" :
          planSlide.type === "application" ? "Application" :
            planSlide.type === "closing" ? "Response" : ""
      ));
      if (heading) {
        addPresentationHeading(
          slide,
          heading,
          theme,
          0.72,
          Number(layout.headingSize) || (planSlide.type === "section" ? 40 : 34)
        );
      }
      if (!addBulletList(slide, planSlide.bullets, theme, heading ? 1.92 : 1.2)) {
        addPresentationBody(
          slide,
          getSlideBodyText(planSlide),
          theme,
          heading ? 1.72 : 1.2,
          Number(layout.bodySize) || (planSlide.type === "big_idea" ? 34 : 27),
          4.65
        );
      }
    }

    addPresentationFooter(slide, { sermon, template, theme });
    if (planSlide.notes && typeof slide.addNotes === "function") {
      slide.addNotes(planSlide.notes);
    }
  }

  return pptx.write({ outputType: "nodebuffer" });
}

async function uploadSermonPresentationPptx({ sermonId, presentationId, title, buffer, generatedAt } = {}) {
  const cleanSermonId = cleanManuscriptText(sermonId);
  const cleanPresentationId = cleanManuscriptText(presentationId);
  const cleanGeneratedAt = cleanManuscriptText(generatedAt) || new Date().toISOString();
  const datePart = cleanGeneratedAt.replace(/[:.]/g, "-");
  const filename = `${slugifyExportPart(title || cleanPresentationId || "sermon-slides")}-${datePart}.pptx`;
  const storagePath = `sermon-presentations/${slugifyExportPart(cleanSermonId)}/${filename}`;
  const file = storage.bucket(BUCKET_NAME).file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      metadata: {
        sermonId: cleanSermonId,
        presentationId: cleanPresentationId,
        generatedAt: cleanGeneratedAt
      }
    }
  });

  const expiresAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const [downloadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAtMs,
    responseDisposition: `attachment; filename="${filename}"`,
    responseType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  });

  return {
    filename,
    storagePath,
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sizeBytes: buffer.length,
    downloadUrl,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

async function importSermonPresentationTemplatePptx({
  openaiFileIdRefs,
  name,
  seriesId,
  seriesSlug
} = {}) {
  const prepared = await prepareSermonPresentationTemplateImport({
    openaiFileIdRefs,
    fetchImpl: fetch,
    fallbackName: name
  });
  const importedAt = getNowIso();
  const filename = sanitizeFilenameForStorage(prepared.originalFilename);
  const folder = slugifyExportPart(seriesSlug || seriesId || name || "sermon-template");
  const datePart = importedAt.replace(/[:.]/g, "-");
  const storagePath = `sermon-presentation-templates/${folder}/${datePart}-${filename}`;
  await storage.bucket(BUCKET_NAME).file(storagePath).save(prepared.buffer, {
    resumable: false,
    metadata: {
      contentType: prepared.contentType,
      metadata: {
        importedAt,
        seriesId: cleanManuscriptText(seriesId),
        templateName: cleanManuscriptText(name),
        checksumSha256: prepared.checksumSha256
      }
    }
  });

  const { buffer: _buffer, ...result } = prepared;
  return { ...result, storagePath, importedAt };
}

function getSermonWorkspaceDependencies(overrides = {}) {
  const dependencies = {
    sermonFoldersCollection,
    sermonsCollection,
    sermonSnapshotsCollection,
    sermonSourcesCollection,
    sermonMediaCollection,
    sermonOccasionsCollection,
    sermonDevelopmentSessionsCollection,
    sermonDevelopmentTurnsCollection,
    sermonDevelopmentCheckpointsCollection,
    sermonWalkTurnsCollection,
    sermonWalkAudioChunksCollection,
    sermonChunksCollection,
    sermonPresentationTemplatesCollection,
    sermonPresentationsCollection,
    sermonPreachingPacketsCollection,
    sermonOperationExecutionsCollection,
    sermonTranscriptionJobsCollection,
    sermonRecordingInboxCollection,
    preachingProfilesCollection,
    preachingAnalysesCollection,
    scriptureNotesCollection,
    scriptureNoteImportsCollection,
    scriptureNoteImportSegmentsCollection,
    renderSermonPresentationPptx,
    uploadSermonPresentationPptx,
    createSermonSourceDownload,
    downloadSermonArtifact,
    uploadSermonPreachingPacket,
    importSermonPresentationTemplatePptx,
    embedText: embedTextWithVertexAi,
    embeddingModel: VERTEX_TEXT_EMBEDDING_MODEL,
    findNearestChunks: findNearestSermonChunksWithFirestore,
    toVectorValue: (embedding) => FieldValue.vector(embedding),
    generateRagAnswer: generateSermonRagAnswerWithOpenAi,
    generateCanonicalRepairProposal: generateSermonCanonicalRepairProposalWithOpenAi,
    generatePostPreachingReflection: generatePostPreachingReflectionWithOpenAi,
    classifyScriptureNoteSegments: classifyScriptureNoteSegmentsWithOpenAi,
    prepareScriptureNoteImportSource: prepareAndStoreScriptureNoteImportSource
  };
  dependencies.importSermonRecording = importSermonRecordingForJob;
  dependencies.transcribeSermonMedia = ({ media, prompt }) =>
    transcribeSermonMediaWithOpenAi({ media, prompt });
  dependencies.cleanSermonTranscript = cleanSermonTranscriptWithOpenAi;
  dependencies.analyzeUnmatchedRecordingTranscript = analyzeUnmatchedRecordingTranscriptWithOpenAi;
  dependencies.buildSermonHubFromRecordingTranscript = buildSermonHubFromRecordingTranscriptWithOpenAi;
  dependencies.completeUnmatchedRecordingIdentification = sermonRecordingInboxService.completeUnmatchedSermonRecordingIdentification;
  dependencies.failUnmatchedRecordingIdentification = sermonRecordingInboxService.failUnmatchedSermonRecordingIdentification;
  dependencies.enqueueSermonTranscriptionJob = enqueueSermonTranscriptionJob;
  dependencies.prepareSermonRecordingInboxFile = prepareSermonRecordingInboxFile;
  dependencies.storeSermonRecordingInboxFile = storeSermonRecordingInboxFile;
  dependencies.extractScriptureNotesFromSermon = (input, operationDeps = dependencies) =>
    scriptureNoteService.extractScriptureNotesFromSermon(input, operationDeps);
  dependencies.saveReviewedPostPreachingScriptureNotes = (input, operationDeps = dependencies) =>
    scriptureNoteService.saveReviewedPostPreachingScriptureNotes(input, operationDeps);
  return { ...dependencies, ...overrides };
}

function getProductWorkspaceDependencies(overrides = {}) {
  return {
    productsCollection,
    productOperationExecutionsCollection,
    productWorkspaceConfigCollection,
    now: getNowIso,
    ...overrides
  };
}

function getSermonWalkAudioExtension(contentType = "") {
  const normalized = cleanManuscriptText(contentType).toLowerCase();
  if (normalized.includes("mp4") || normalized.includes("aac")) return "m4a";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  return "webm";
}

function assertSermonWalkScope(req, sessionId) {
  const access = req.sermonWalkAccess;
  const cleanSessionId = cleanManuscriptText(sessionId);
  if (!access || access.sessionId !== cleanSessionId) {
    throw createWorkflowError("Sermon walk access does not match this session", 403, {
      code: "sermon_walk_scope_mismatch"
    });
  }
  return access;
}

function buildSermonWalkRealtimeInstructions(sermon = {}) {
  return [
    "You are Dan's sermon-development conversation partner during a walk.",
    "Help Dan discover and articulate his own sermon thoughts through a natural spoken conversation.",
    "Ask one concise question at a time, listen carefully, and reflect his ideas without taking authorship away from him.",
    "Do not draft a manuscript, introduce a generic sermon framework, or claim that anything is saved.",
    "The application records audio and transcripts independently; focus on the conversation.",
    "When Dan says a line matters, acknowledge it briefly and continue developing his thought.",
    `Sermon: ${cleanManuscriptText(sermon.title) || "Untitled sermon"}`,
    `Passage: ${cleanManuscriptText(sermon.scriptureText) || "Not yet settled"}`,
    cleanManuscriptText(sermon.bigIdea) ? `Current big idea: ${cleanManuscriptText(sermon.bigIdea)}` : ""
  ].filter(Boolean).join("\n");
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

async function saveRepositoryDocumentProvenance(
  {
    documentId,
    originalFolderLabel,
    binLabel,
    scanBatchLabel,
    sourceLocationNotes
  },
  deps = getRepositoryWorkflowDependencies()
) {
  const {
    docRef,
    document
  } = await getRequiredRepositoryDocument(deps.repositoryDocumentsCollection, documentId);

  const provenanceUpdates = {};

  if (typeof originalFolderLabel === "string" && originalFolderLabel.trim()) {
    provenanceUpdates.originalFolderLabel = originalFolderLabel.trim();
  }

  if (typeof binLabel === "string" && binLabel.trim()) {
    provenanceUpdates.binLabel = binLabel.trim();
  }

  if (typeof scanBatchLabel === "string" && scanBatchLabel.trim()) {
    provenanceUpdates.scanBatchLabel = scanBatchLabel.trim();
  }

  if (typeof sourceLocationNotes === "string" && sourceLocationNotes.trim()) {
    provenanceUpdates.sourceLocationNotes = sourceLocationNotes.trim();
  }

  if (Object.keys(provenanceUpdates).length === 0) {
    throw createWorkflowError("No valid provenance fields were provided", 400);
  }

  const updatedAt = getNowIso();
  const updatedDocument = {
    ...document,
    ...provenanceUpdates,
    updatedAt
  };

  await docRef.update({
    ...provenanceUpdates,
    updatedAt
  });

  return {
    document: updatedDocument
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

app.use("/sermon-walk", express.static(path.join(__dirname, "public", "sermon-walk"), {
  extensions: ["html"],
  index: "index.html",
  maxAge: "5m"
}));

app.post("/sermons/:sermonId/walk-sessions", async (req, res) => {
  try {
    const result = await createSermonWalkSession({
      ...(req.body || {}),
      sermonId: req.params.sermonId
    }, getSermonWorkspaceDependencies());
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + (12 * 60 * 60);
    const accessToken = createSermonWalkAccessToken({
      sessionId: result.session.sessionId,
      sermonId: result.sermon.sermonId,
      expiresAtSeconds
    }, BHE_API_KEY);
    const launchUrl = `${GPT_ACTION_BASE_URL}/sermon-walk/#session=${encodeURIComponent(result.session.sessionId)}&token=${encodeURIComponent(accessToken)}`;
    return res.status(201).json({
      ok: true,
      ...result,
      launchUrl,
      accessExpiresAt: new Date(expiresAtSeconds * 1000).toISOString()
    });
  } catch (error) {
    console.error("Error creating sermon walk session:", error);
    return res.status(getErrorStatusCode(error, 500)).json(buildStructuredErrorResponse(error, {
      fallbackCode: "sermon_walk_session_create_failed",
      fallbackMessage: "Sermon walk session create failed"
    }));
  }
});

app.get("/sermon-walk/api/session", async (req, res) => {
  try {
    const access = assertSermonWalkScope(req, req.sermonWalkAccess?.sessionId);
    const [capture, sermonResult] = await Promise.all([
      getSermonWalkCaptureStatus({ sessionId: access.sessionId }, getSermonWorkspaceDependencies()),
      getSermon({ sermonId: access.sermonId }, getSermonWorkspaceDependencies())
    ]);
    return res.status(200).json({
      ok: true,
      sermon: {
        sermonId: sermonResult.sermon.sermonId,
        title: sermonResult.sermon.title,
        scriptureText: sermonResult.sermon.scriptureText,
        bigIdea: sermonResult.sermon.bigIdea
      },
      ...capture
    });
  } catch (error) {
    return res.status(getErrorStatusCode(error, 500)).json(buildStructuredErrorResponse(error, {
      fallbackCode: "sermon_walk_session_fetch_failed",
      fallbackMessage: "Sermon walk session fetch failed"
    }));
  }
});

app.post(
  "/sermon-walk/api/realtime",
  express.text({ type: ["application/sdp", "text/plain"], limit: "1mb" }),
  async (req, res) => {
    try {
      const access = assertSermonWalkScope(req, req.sermonWalkAccess?.sessionId);
      const offerSdp = typeof req.body === "string" ? req.body.trim() : "";
      if (!offerSdp) throw createWorkflowError("Realtime connection requires SDP", 400);
      const { sermon } = await getSermon({ sermonId: access.sermonId }, getSermonWorkspaceDependencies());
      const formData = new FormData();
      formData.set("sdp", offerSdp);
      formData.set("session", JSON.stringify({
        type: "realtime",
        model: SERMON_WALK_REALTIME_MODEL,
        instructions: buildSermonWalkRealtimeInstructions(sermon),
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: {
              model: OPENAI_TRANSCRIPTION_MODEL,
              language: "en"
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 350,
              silence_duration_ms: 750,
              create_response: true,
              interrupt_response: true
            }
          },
          output: {
            voice: SERMON_WALK_REALTIME_VOICE
          }
        }
      }));
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Safety-Identifier": createHash("sha256").update("dan-sermon-walk").digest("hex")
        },
        body: formData
      });
      const responseBody = await response.text();
      if (!response.ok) {
        throw createWorkflowError(`OpenAI Realtime connection error: ${response.status} ${responseBody}`, 502);
      }
      res.status(200).type("application/sdp").send(responseBody);
    } catch (error) {
      console.error("Error opening sermon walk Realtime session:", error);
      return res.status(getErrorStatusCode(error, 500)).json(buildStructuredErrorResponse(error, {
        fallbackCode: "sermon_walk_realtime_failed",
        fallbackMessage: "Sermon walk voice connection failed"
      }));
    }
  }
);

app.post("/sermon-walk/api/turns", async (req, res) => {
  try {
    const access = assertSermonWalkScope(req, req.body?.sessionId || req.sermonWalkAccess?.sessionId);
    const result = await saveSermonWalkTurn({
      ...(req.body || {}),
      sessionId: access.sessionId
    }, getSermonWorkspaceDependencies());
    return res.status(result.action === "created" ? 201 : 200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(getErrorStatusCode(error, 500)).json(buildStructuredErrorResponse(error, {
      fallbackCode: "sermon_walk_turn_save_failed",
      fallbackMessage: "Sermon walk turn save failed"
    }));
  }
});

app.post("/sermon-walk/api/audio-chunks", sermonWalkAudioUpload.single("audio"), async (req, res) => {
  try {
    const access = assertSermonWalkScope(req, req.body?.sessionId || req.sermonWalkAccess?.sessionId);
    if (!req.file?.buffer?.length) throw createWorkflowError("Audio chunk is required", 400);
    const sequence = Number.parseInt(String(req.body?.sequence), 10);
    if (!Number.isInteger(sequence) || sequence < 1) throw createWorkflowError("Valid audio sequence is required", 400);
    const sha256 = createHash("sha256").update(req.file.buffer).digest("hex");
    const claimedSha256 = cleanManuscriptText(req.body?.sha256).toLowerCase();
    if (claimedSha256 && claimedSha256 !== sha256) {
      throw createWorkflowError("Audio chunk checksum did not match", 409, {
        code: "sermon_walk_audio_checksum_mismatch",
        sequence
      });
    }
    const extension = getSermonWalkAudioExtension(req.file.mimetype);
    const storagePath = `sermon-walks/${access.sermonId}/${access.sessionId}/chunks/${String(sequence).padStart(6, "0")}.${extension}`;
    await storage.bucket(BUCKET_NAME).file(storagePath).save(req.file.buffer, {
      resumable: false,
      metadata: {
        contentType: req.file.mimetype,
        metadata: { sermonId: access.sermonId, sessionId: access.sessionId, sequence: String(sequence), sha256 }
      }
    });
    const result = await registerSermonWalkAudioChunk({
      sessionId: access.sessionId,
      sequence,
      storagePath,
      contentType: req.file.mimetype,
      sizeBytes: req.file.buffer.length,
      sha256,
      startedAtMs: req.body?.startedAtMs,
      endedAtMs: req.body?.endedAtMs
    }, getSermonWorkspaceDependencies());
    return res.status(result.action === "created" ? 201 : 200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(getErrorStatusCode(error, 500)).json(buildStructuredErrorResponse(error, {
      fallbackCode: "sermon_walk_audio_chunk_save_failed",
      fallbackMessage: "Sermon walk audio chunk save failed"
    }));
  }
});

app.post("/sermon-walk/api/audio-seal", async (req, res) => {
  try {
    const access = assertSermonWalkScope(req, req.body?.sessionId || req.sermonWalkAccess?.sessionId);
    const finalChunkSequence = Number.parseInt(String(req.body?.finalChunkSequence), 10);
    const status = await getSermonWalkCaptureStatus({
      sessionId: access.sessionId,
      finalChunkSequence,
      expectedUserItemIds: req.body?.expectedUserItemIds,
      clientPendingUploadCount: req.body?.clientPendingUploadCount
    }, getSermonWorkspaceDependencies());
    if (status.integrity.missingAudioSequences.length > 0 || status.audioChunks.length !== finalChunkSequence) {
      throw createWorkflowError("Audio chunks are still missing and cannot be sealed", 409, {
        code: "sermon_walk_audio_incomplete",
        missingAudioSequences: status.integrity.missingAudioSequences
      });
    }
    const manifest = {
      version: 1,
      sermonId: access.sermonId,
      sessionId: access.sessionId,
      createdAt: getNowIso(),
      contentType: status.audioChunks[0]?.contentType || "application/octet-stream",
      chunks: status.audioChunks.map((chunk) => ({
        sequence: chunk.sequence,
        storagePath: chunk.storagePath,
        sizeBytes: chunk.sizeBytes,
        sha256: chunk.sha256,
        startedAtMs: chunk.startedAtMs,
        endedAtMs: chunk.endedAtMs
      }))
    };
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2));
    const manifestSha256 = createHash("sha256").update(manifestBuffer).digest("hex");
    const manifestPath = `sermon-walks/${access.sermonId}/${access.sessionId}/audio-manifest.json`;
    await storage.bucket(BUCKET_NAME).file(manifestPath).save(manifestBuffer, {
      resumable: false,
      metadata: { contentType: "application/json", metadata: { sha256: manifestSha256 } }
    });
    await registerSermonWalkFinalAudio({
      sessionId: access.sessionId,
      storagePath: manifestPath,
      contentType: "application/vnd.bhe.sermon-walk-manifest+json",
      sizeBytes: status.audioChunks.reduce((total, chunk) => total + chunk.sizeBytes, 0),
      sha256: manifestSha256
    }, getSermonWorkspaceDependencies());

    let highAccuracyTranscript = { status: "deferred", sourceId: "", error: "" };
    const totalBytes = status.audioChunks.reduce((total, chunk) => total + chunk.sizeBytes, 0);
    if (totalBytes > 0 && totalBytes <= MAX_OPENAI_TRANSCRIPTION_BYTES) {
      try {
        const chunkBuffers = await Promise.all(status.audioChunks.map(async (chunk) => {
          const [buffer] = await storage.bucket(BUCKET_NAME).file(chunk.storagePath).download();
          return buffer;
        }));
        const audioBuffer = Buffer.concat(chunkBuffers);
        const sermonResult = await getSermon({ sermonId: access.sermonId }, getSermonWorkspaceDependencies());
        const transcription = await transcribeBufferWithOpenAi({
          buffer: audioBuffer,
          filename: `sermon-walk.${getSermonWalkAudioExtension(manifest.contentType)}`,
          contentType: manifest.contentType,
          sizeBytes: audioBuffer.length,
          prompt: [sermonResult.sermon.title, sermonResult.sermon.scriptureText, sermonResult.sermon.bigIdea]
            .map(cleanManuscriptText).filter(Boolean).join(". ")
        });
        const sourceResult = await createSermonSource({
          sermonId: access.sermonId,
          sourceType: "transcript",
          sourceLabel: `${status.session.label || "Sermon walk"} - high-accuracy audio transcript`,
          summary: `Audio-derived sermon walk transcript generated with ${transcription.model}.`,
          material: transcription.text,
          sourceRefs: [
            { type: "sermon_walk_audio_manifest", path: manifestPath, sha256: manifestSha256 },
            { type: "sermon_walk_session", id: access.sessionId }
          ]
        }, getSermonWorkspaceDependencies());
        highAccuracyTranscript = { status: "ready", sourceId: sourceResult.source.sourceId, error: "" };
      } catch (error) {
        console.error("Sermon walk high-accuracy transcription failed after audio was safely sealed:", error);
        highAccuracyTranscript = { status: "failed", sourceId: "", error: error.message || "Transcription failed" };
      }
    }
    await saveSermonWalkHighAccuracyTranscript({
      sessionId: access.sessionId,
      ...highAccuracyTranscript
    }, getSermonWorkspaceDependencies());
    return res.status(200).json({
      ok: true,
      audioManifest: { storagePath: manifestPath, sha256: manifestSha256, chunkCount: manifest.chunks.length, totalBytes },
      highAccuracyTranscript
    });
  } catch (error) {
    console.error("Error sealing sermon walk audio:", error);
    return res.status(getErrorStatusCode(error, 500)).json(buildStructuredErrorResponse(error, {
      fallbackCode: "sermon_walk_audio_seal_failed",
      fallbackMessage: "Sermon walk audio seal failed"
    }));
  }
});

app.post("/sermon-walk/api/finalize", async (req, res) => {
  try {
    const access = assertSermonWalkScope(req, req.body?.sessionId || req.sermonWalkAccess?.sessionId);
    const result = await finalizeSermonWalkCapture({
      ...(req.body || {}),
      sessionId: access.sessionId
    }, getSermonWorkspaceDependencies());
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(getErrorStatusCode(error, 500)).json(buildStructuredErrorResponse(error, {
      fallbackCode: "sermon_walk_finalize_failed",
      fallbackMessage: "Sermon walk finalization failed"
    }));
  }
});

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

  return res.status(ok ? 200 : 500).json({
    ok,
    checks,
    capabilities: {
      sermonWorkspace: {
        maxImportedTextLength: MAX_IMPORTED_TEXT_LENGTH,
        manuscriptModel: SERMON_MANUSCRIPT_MODEL,
        sourceSelectionModel: SERMON_SOURCE_SELECTION_MODEL,
        scriptureNoteModel: SCRIPTURE_NOTE_MODEL
      }
    }
  });
});

app.get("/gpt-action-diagnostics/sample.txt", (req, res) => {
  const marker = typeof req.query.marker === "string" ? req.query.marker.slice(0, 100) : "";
  res.set("cache-control", "no-store");
  res.type("text/plain");
  return res.status(200).send(`GPT Action diagnostic sample${marker ? `: ${marker}` : ""}\n`);
});

app.get("/gpt-action-diagnostics/ping", (req, res) => {
  const requestId = req.actionDiagnosticRequestId || randomUUID();
  const responseBody = {
    ok: true,
    requestId,
    probe: "ping",
    method: "GET",
    receivedAt: new Date().toISOString(),
    serviceRevision: process.env.K_REVISION || "local",
    message: "GPT Action diagnostic ping completed"
  };

  res.set("cache-control", "no-store");
  console.log(JSON.stringify({
    event: "gpt_action_diagnostic_completed",
    requestId,
    method: "GET",
    scenario: "ping",
    status: 200,
    responseBytes: getJsonByteLength(responseBody)
  }));
  return res.status(200).json(responseBody);
});

app.post("/gpt-action-diagnostics/probe", async (req, res) => {
  const requestId = req.actionDiagnosticRequestId || randomUUID();
  const startedAtMs = Date.now();
  res.set("cache-control", "no-store");

  try {
    const responseBody = await runGptActionTransportProbe(
      {
        ...(req.body || {}),
        requestId
      },
      {
        baseUrl: "https://bhe-product-api-mwhc25pkra-uw.a.run.app",
        serviceRevision: process.env.K_REVISION || "local"
      }
    );
    console.log(JSON.stringify({
      event: "gpt_action_diagnostic_completed",
      requestId,
      method: "POST",
      scenario: responseBody.scenario,
      status: 200,
      durationMs: Date.now() - startedAtMs,
      responseBytes: getJsonByteLength(responseBody)
    }));
    return res.status(200).json(responseBody);
  } catch (error) {
    const status = getErrorStatusCode(error, 500);
    const responseBody = {
      ok: false,
      requestId,
      errorCode: typeof error?.code === "string" ? error.code : "diagnostic_probe_failed",
      errorMessage: error?.message || "GPT Action diagnostic probe failed",
      errorStatus: status
    };
    console.error(JSON.stringify({
      event: "gpt_action_diagnostic_failed",
      requestId,
      method: "POST",
      scenario: typeof req.body?.scenario === "string" ? req.body.scenario : "",
      status,
      durationMs: Date.now() - startedAtMs,
      responseBytes: getJsonByteLength(responseBody),
      errorCode: responseBody.errorCode
    }));
    return res.status(status).json(responseBody);
  }
});

function normalizeRefreshMode(value) {
  const cleanValue = typeof value === "string" ? value.trim().toLowerCase().replace(/_/g, "-") : "";

  if (cleanValue === "preview") {
    return "preview-only";
  }

  if (cleanValue === "plan") {
    return "plan-only";
  }

  if (!cleanValue) {
    return "plan-only";
  }

  if (!MUSIC_PLANNING_REFRESH_MODES.has(cleanValue)) {
    const error = new Error("Invalid spreadsheet refresh mode");
    error.statusCode = 400;
    error.code = "invalid_spreadsheet_refresh_mode";
    error.details = {
      allowedModes: Array.from(MUSIC_PLANNING_REFRESH_MODES)
    };
    throw error;
  }

  return cleanValue;
}

function extractGoogleSheetId(value) {
  const cleanValue = typeof value === "string" ? value.trim() : "";

  if (!cleanValue) {
    return "";
  }

  const urlMatch = cleanValue.match(/\/spreadsheets\/d\/([^/]+)/);
  if (urlMatch) {
    return decodeURIComponent(urlMatch[1]);
  }

  return cleanValue;
}

function normalizeFocusDate(value) {
  const cleanValue = typeof value === "string" ? value.trim() : "";

  if (!cleanValue) {
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    const error = new Error("Invalid focus date");
    error.statusCode = 400;
    error.code = "invalid_focus_date";
    error.details = {
      expectedFormat: "YYYY-MM-DD"
    };
    throw error;
  }

  return cleanValue;
}

function normalizeFocusServiceType(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase().replace(/-/g, "_")
    : "";
}

function normalizeSpreadsheetRefreshRequest(body = {}) {
  const request = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const mode = normalizeRefreshMode(request.mode);
  const googleSheetId = extractGoogleSheetId(
    request.googleSheetId || request.googleSheetUrl || request.url
  ) || DEFAULT_MUSIC_PLANNING_GOOGLE_SHEET_ID;
  const sheet = typeof request.sheet === "string" && request.sheet.trim()
    ? request.sheet.trim()
    : DEFAULT_MUSIC_PLANNING_SHEET_NAME;
  const planningYear = Number.parseInt(
    String(request.year || request.planningYear || DEFAULT_MUSIC_PLANNING_YEAR),
    10
  );
  const allowPlannedUpdates = request.allowPlannedUpdates === true;
  const allowPartialConflicts = request.allowPartialConflicts === true;
  const confirmSourceImportId = typeof request.confirmSourceImportId === "string"
    ? request.confirmSourceImportId.trim()
    : "";
  const humanConfirmed = request.humanConfirmed === true;
  const focusDate = normalizeFocusDate(request.focusDate || request.serviceDate || request.date);
  const focusServiceType = normalizeFocusServiceType(request.focusServiceType || request.serviceType);

  if (!Number.isInteger(planningYear) || planningYear < 2000 || planningYear > 2100) {
    const error = new Error("Invalid planning year");
    error.statusCode = 400;
    error.code = "invalid_planning_year";
    throw error;
  }

  if (mode === "commit" && !humanConfirmed) {
    const error = new Error("Spreadsheet refresh commit requires explicit human confirmation");
    error.statusCode = 400;
    error.code = "spreadsheet_commit_requires_human_confirmation";
    throw error;
  }

  return {
    mode,
    googleSheetId,
    sheet,
    planningYear,
    allowPlannedUpdates,
    allowPartialConflicts,
    confirmSourceImportId,
    humanConfirmed,
    focusDate,
    focusServiceType
  };
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function truncateForResponse(value, maxLength = 6000) {
  const text = typeof value === "string" ? value : "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function buildSpreadsheetRefreshArgs(options, outDir) {
  const args = [
    path.join(__dirname, "scripts", "refresh-music-planning-from-google-sheet.mjs"),
    `--${options.mode}`,
    "--google-sheet-id",
    options.googleSheetId,
    "--sheet",
    options.sheet,
    "--year",
    String(options.planningYear),
    "--out-dir",
    outDir,
    "--project",
    GCP_PROJECT_ID,
    "--database",
    FIRESTORE_DATABASE_ID
  ];

  if (options.allowPlannedUpdates) {
    args.push("--allow-planned-updates");
  }

  if (options.allowPartialConflicts) {
    args.push("--allow-partial-conflicts");
  }

  if (options.confirmSourceImportId) {
    args.push("--confirm-source-import-id", options.confirmSourceImportId);
  }

  return args;
}

function getPlanItemRecord(item = {}) {
  return item && typeof item === "object"
    ? item.proposed || item.existing || null
    : null;
}

function matchesSpreadsheetRefreshFocus(record, options = {}) {
  if (!record || !options.focusDate) {
    return false;
  }

  if (record.serviceDate !== options.focusDate) {
    return false;
  }

  return !options.focusServiceType || record.serviceType === options.focusServiceType;
}

function buildFocusedServiceItem(item = {}) {
  const record = getPlanItemRecord(item) || {};

  return {
    action: item.action || "",
    id: item.id || record.serviceId || "",
    reason: item.reason || "",
    changedFields: Array.isArray(item.changedFields) ? item.changedFields : [],
    serviceId: record.serviceId || "",
    serviceDate: record.serviceDate || "",
    serviceType: record.serviceType || "",
    title: record.title || "",
    theme: record.theme || "",
    message: record.message && typeof record.message === "object" ? record.message : {},
    warningCodes: Array.isArray(record.warningCodes) ? record.warningCodes : []
  };
}

function buildFocusedSongEventItem(item = {}) {
  const record = getPlanItemRecord(item) || {};

  return {
    action: item.action || "",
    id: item.id || record.serviceSongEventId || "",
    reason: item.reason || "",
    changedFields: Array.isArray(item.changedFields) ? item.changedFields : [],
    serviceSongEventId: record.serviceSongEventId || "",
    serviceId: record.serviceId || "",
    serviceDate: record.serviceDate || "",
    serviceType: record.serviceType || "",
    slotIndex: typeof record.slotIndex === "number" ? record.slotIndex : null,
    usageRole: record.usageRole || "",
    sourceColumnName: record.sourceColumnName || "",
    sourceCell: record.sourceCell || "",
    rawValue: record.rawValue || "",
    title: record.title || "",
    songTitle: record.songTitle || "",
    songTitleCandidate: record.songTitleCandidate || "",
    hymnalNumber: typeof record.hymnalNumber === "number" ? record.hymnalNumber : null,
    assignedPersonOrGroupRaw: record.assignedPersonOrGroupRaw || "",
    detailNote: record.detailNote || "",
    songId: record.songId || null,
    warningCodes: Array.isArray(record.warningCodes) ? record.warningCodes : []
  };
}

function collectFocusedPlanItems(group = {}, options = {}, mapItem) {
  const actions = ["create", "update", "preserve", "conflict", "missingFromSource"];
  const focused = {};

  for (const action of actions) {
    const items = Array.isArray(group[action]) ? group[action] : [];
    focused[action] = items
      .filter((item) => matchesSpreadsheetRefreshFocus(getPlanItemRecord(item), options))
      .map(mapItem);
  }

  return focused;
}

function buildSpreadsheetRefreshFocus(plan, options = {}) {
  if (!plan || !options.focusDate) {
    return null;
  }

  const services = collectFocusedPlanItems(plan.services || {}, options, buildFocusedServiceItem);
  const serviceSongEvents = collectFocusedPlanItems(
    plan.serviceSongEvents || {},
    options,
    buildFocusedSongEventItem
  );

  const countItems = (group) => Object.fromEntries(
    Object.entries(group).map(([action, items]) => [action, items.length])
  );

  return {
    serviceDate: options.focusDate,
    serviceType: options.focusServiceType || "",
    services,
    serviceSongEvents,
    counts: {
      services: countItems(services),
      serviceSongEvents: countItems(serviceSongEvents)
    }
  };
}

function buildSpreadsheetRefreshResponse({ options, outDir, stdout = "", stderr = "", failed = false, error = null }) {
  const summaryPath = path.join(outDir, "music-planning-refresh-summary-latest.json");
  const planPath = path.join(outDir, "music-planning-firestore-write-plan-latest.json");
  const commitPath = path.join(outDir, "music-planning-firestore-commit-result-latest.json");
  const summary = readJsonIfExists(summaryPath);
  const plan = readJsonIfExists(planPath);
  const commitResult = readJsonIfExists(commitPath);
  const sourceImportId = plan && plan.sourceImportPlan ? plan.sourceImportPlan.id : "";

  return {
    ok: !failed,
    mode: options.mode,
    source: {
      googleSheetId: options.googleSheetId,
      sheet: options.sheet,
      planningYear: options.planningYear
    },
    sourceImportId,
    requiredCommitConfirmation: sourceImportId
      ? {
          confirmSourceImportId: sourceImportId,
          allowPlannedUpdates: true,
          allowPartialConflicts: true,
          humanConfirmed: true
        }
      : null,
    summary,
    plan: plan
      ? {
          eligibleForCommit: plan.eligibleForCommit === true,
          actionSummary: summary ? summary.plan : null,
          conflicts: Array.isArray(plan.conflicts) ? plan.conflicts.slice(0, 10) : []
        }
      : null,
    focus: buildSpreadsheetRefreshFocus(plan, options),
    commitResult: commitResult
      ? {
          sourceImportId: commitResult.sourceImportId,
          summary: commitResult.summary,
          safety: commitResult.safety,
          planConflictsSkipped: Array.isArray(commitResult.planConflictsSkipped)
            ? commitResult.planConflictsSkipped
            : [],
          postCommitVerification: summary ? summary.postCommitVerification : null
        }
      : null,
    log: truncateForResponse(stdout),
    warningLog: truncateForResponse(stderr, 2000),
    error: error ? error.message : ""
  };
}

async function runMusicPlanningSpreadsheetRefresh(body = {}) {
  const options = normalizeSpreadsheetRefreshRequest(body);
  const outDir = path.join(os.tmpdir(), `music-planning-refresh-${randomUUID()}`);
  const args = buildSpreadsheetRefreshArgs(options, outDir);

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: __dirname,
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024
    });

    return buildSpreadsheetRefreshResponse({
      options,
      outDir,
      stdout,
      stderr
    });
  } catch (error) {
    error.statusCode = error.statusCode || 400;
    error.details = buildSpreadsheetRefreshResponse({
      options,
      outDir,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      failed: true,
      error
    });
    throw error;
  }
}

app.get("/projects", async (req, res) => {
  try {
    const result = await listProjects(
      {
        status: req.query.status,
        lifeArea: req.query.lifeArea,
        priority: req.query.priority,
        targetOnOrBefore: req.query.targetOnOrBefore,
        query: req.query.query,
        limit: req.query.limit
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing projects:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "project_list_failed",
          fallbackMessage: "Project list failed"
        })
      );
  }
});

app.post("/projects", async (req, res) => {
  try {
    const result = await createProject(req.body || {}, getProjectTaskDependencies());

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating project:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "project_create_failed",
          fallbackMessage: "Project create failed"
        })
      );
  }
});

app.get("/projects/:projectId", async (req, res) => {
  try {
    const result = await getProject(
      { projectId: req.params.projectId },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching project:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "project_fetch_failed",
          fallbackMessage: "Project fetch failed"
        })
      );
  }
});

app.patch("/projects/:projectId", async (req, res) => {
  try {
    const result = await updateProject(
      {
        projectId: req.params.projectId,
        changes: req.body?.changes || req.body || {}
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating project:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "project_update_failed",
          fallbackMessage: "Project update failed"
        })
      );
  }
});

app.get("/tasks", async (req, res) => {
  try {
    const result = await listTasks(
      {
        status: req.query.status,
        priority: req.query.priority,
        projectId: req.query.projectId,
        eventId: req.query.eventId,
        lifeArea: req.query.lifeArea,
        requestedBy: req.query.requestedBy,
        query: req.query.query,
        dueBefore: req.query.dueBefore,
        dueOnOrBefore: req.query.dueOnOrBefore,
        followUpOnOrBefore: req.query.followUpOnOrBefore,
        limit: req.query.limit
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing tasks:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "task_list_failed",
          fallbackMessage: "Task list failed"
        })
      );
  }
});

app.post("/tasks", async (req, res) => {
  try {
    const result = await createTask(req.body || {}, getProjectTaskDependencies());

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating task:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "task_create_failed",
          fallbackMessage: "Task create failed"
        })
      );
  }
});

app.patch("/tasks/:taskId", async (req, res) => {
  try {
    const result = await updateTask(
      {
        taskId: req.params.taskId,
        changes: req.body?.changes || req.body || {}
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating task:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "task_update_failed",
          fallbackMessage: "Task update failed"
        })
      );
  }
});

app.get("/calendar-events", async (req, res) => {
  try {
    const result = await listCalendarEvents(
      {
        status: req.query.status,
        lifeArea: req.query.lifeArea,
        date: req.query.date,
        fromDate: req.query.fromDate,
        toDate: req.query.toDate,
        query: req.query.query,
        limit: req.query.limit
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing calendar events:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "calendar_event_list_failed",
          fallbackMessage: "Calendar event list failed"
        })
      );
  }
});

app.post("/calendar-events", async (req, res) => {
  try {
    const result = await createCalendarEvent(req.body || {}, getProjectTaskDependencies());

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating calendar event:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "calendar_event_create_failed",
          fallbackMessage: "Calendar event create failed"
        })
      );
  }
});

app.patch("/calendar-events/:eventId", async (req, res) => {
  try {
    const result = await updateCalendarEvent(
      {
        eventId: req.params.eventId,
        changes: req.body?.changes || req.body || {}
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating calendar event:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "calendar_event_update_failed",
          fallbackMessage: "Calendar event update failed"
        })
      );
  }
});

app.get("/routines", async (req, res) => {
  try {
    const result = await listRoutines(
      {
        status: req.query.status,
        lifeArea: req.query.lifeArea,
        query: req.query.query,
        limit: req.query.limit
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing routines:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "routine_list_failed",
          fallbackMessage: "Routine list failed"
        })
      );
  }
});

app.post("/routines", async (req, res) => {
  try {
    const result = await createRoutine(req.body || {}, getProjectTaskDependencies());

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating routine:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "routine_create_failed",
          fallbackMessage: "Routine create failed"
        })
      );
  }
});

app.patch("/routines/:routineId", async (req, res) => {
  try {
    const result = await updateRoutine(
      {
        routineId: req.params.routineId,
        changes: req.body?.changes || req.body || {}
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating routine:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "routine_update_failed",
          fallbackMessage: "Routine update failed"
        })
      );
  }
});

app.post("/daily-review", async (req, res) => {
  try {
    const result = await buildDailyReview(req.body || {}, getProjectTaskDependencies());

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error building daily review:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "daily_review_failed",
          fallbackMessage: "Daily review failed"
        })
      );
  }
});

app.get("/daily-review", async (req, res) => {
  try {
    const result = await buildDailyReview(
      {
        today: req.query.today,
        detailLevel: req.query.detailLevel
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error building daily review:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "daily_review_failed",
          fallbackMessage: "Daily review failed"
        })
      );
  }
});

app.get("/daily-brief", async (req, res) => {
  try {
    const result = await buildDailyBrief(
      {
        today: req.query.today
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error building daily brief:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "daily_brief_failed",
          fallbackMessage: "Daily brief failed"
        })
      );
  }
});

app.get("/daily-brief-simple", async (req, res) => {
  try {
    const result = await buildDailyBrief(
      {
        today: req.query.today
      },
      getProjectTaskDependencies()
    );

    return res.status(200).json({
      result: result.briefText
    });
  } catch (error) {
    console.error("Error building simple daily brief:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({
        result: "Daily brief failed."
      });
  }
});

app.post("/event-task-completion", async (req, res) => {
  try {
    const result = await completeTasksForPastEvents(req.body || {}, getProjectTaskDependencies());

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error completing event-bound tasks:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "event_task_completion_failed",
          fallbackMessage: "Event task completion failed"
        })
      );
  }
});

app.get("/sermon-folders", async (req, res) => {
  try {
    const result = await listSermonFolders(
      {
        folderType: req.query.folderType,
        status: req.query.status,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermon folders:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_folder_list_failed",
          fallbackMessage: "Sermon folder list failed"
        })
      );
  }
});

app.post("/sermon-folders", async (req, res) => {
  try {
    const result = await createSermonFolder(req.body || {}, getSermonWorkspaceDependencies());

    return res.status(result.action === "existing" ? 200 : 201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating sermon folder:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_folder_create_failed",
          fallbackMessage: "Sermon folder create failed"
        })
      );
  }
});

app.patch("/sermon-folders/:folderId", async (req, res) => {
  try {
    const result = await updateSermonFolder(
      {
        folderId: req.params.folderId,
        changes: req.body?.changes || req.body || {}
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating sermon folder:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_folder_update_failed",
          fallbackMessage: "Sermon folder update failed"
        })
      );
  }
});

app.get("/sermons", async (req, res) => {
  try {
    const result = await listSermons(
      {
        folderId: req.query.folderId,
        seriesId: req.query.seriesId,
        seriesSlug: req.query.seriesSlug,
        seriesTitle: req.query.seriesTitle,
        tag: req.query.tag,
        status: req.query.status,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermons:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_list_failed",
          fallbackMessage: "Sermon list failed"
        })
      );
  }
});

app.get("/sermon-archive/stats", async (req, res) => {
  try {
    const result = await getSermonArchiveStats(
      {
        query: req.query.query,
        scriptureBook: req.query.scriptureBook,
        status: req.query.status,
        sourceType: req.query.sourceType
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error building sermon archive stats:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_archive_stats_failed",
          fallbackMessage: "Sermon archive stats failed"
        })
      );
  }
});

app.post("/sermons", async (req, res) => {
  try {
    const result = await createSermon(req.body || {}, getSermonWorkspaceDependencies());

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating sermon:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_create_failed",
          fallbackMessage: "Sermon create failed"
        })
      );
  }
});

app.post("/sermons/import", async (req, res) => {
  try {
    const result = await importSermonMaterial(
      req.body || {},
      getSermonWorkspaceDependencies()
    );

    return res.status(result.action === "created" ? 201 : 200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error importing sermon material:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_import_failed",
          fallbackMessage: "Sermon import failed"
        })
      );
  }
});

app.post("/sermons/import/batch", async (req, res) => {
  try {
    const result = await importSermonMaterialBatch(
      req.body || {},
      getSermonWorkspaceDependencies()
    );

    return res.status(result.errorCount > 0 ? 207 : 200).json({
      ok: result.errorCount === 0,
      ...result
    });
  } catch (error) {
    console.error("Error importing sermon material batch:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_import_batch_failed",
          fallbackMessage: "Sermon import batch failed"
        })
      );
  }
});

app.get("/sermon-presentation-templates", async (req, res) => {
  try {
    const result = await listSermonPresentationTemplates(
      {
        seriesId: req.query.seriesId,
        seriesSlug: req.query.seriesSlug,
        status: req.query.status,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermon presentation templates:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_presentation_template_list_failed",
          fallbackMessage: "Sermon presentation template list failed"
        })
      );
  }
});

app.post("/sermon-presentation-templates", async (req, res) => {
  try {
    const result = await createSermonPresentationTemplate(
      req.body || {},
      getSermonWorkspaceDependencies()
    );

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating sermon presentation template:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_presentation_template_create_failed",
          fallbackMessage: "Sermon presentation template create failed"
        })
      );
  }
});

app.get("/sermon-presentation-templates/:templateId", async (req, res) => {
  try {
    const result = await getSermonPresentationTemplate(
      { templateId: req.params.templateId },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching sermon presentation template:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_presentation_template_fetch_failed",
          fallbackMessage: "Sermon presentation template fetch failed"
        })
      );
  }
});

app.patch("/sermon-presentation-templates/:templateId", async (req, res) => {
  try {
    const result = await updateSermonPresentationTemplate(
      {
        templateId: req.params.templateId,
        changes: req.body?.changes || req.body || {}
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating sermon presentation template:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_presentation_template_update_failed",
          fallbackMessage: "Sermon presentation template update failed"
        })
      );
  }
});

app.get("/preaching-profile", async (req, res) => {
  try {
    const result = await getPreachingProfile(
      { profileId: req.query.profileId },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching preaching profile:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "preaching_profile_fetch_failed",
          fallbackMessage: "Preaching profile fetch failed"
        })
      );
  }
});

app.patch("/preaching-profile", async (req, res) => {
  try {
    const result = await updatePreachingProfile(req.body || {}, getSermonWorkspaceDependencies());

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating preaching profile:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "preaching_profile_update_failed",
          fallbackMessage: "Preaching profile update failed"
        })
      );
  }
});

app.get("/sermons/:sermonId", async (req, res) => {
  try {
    const result = await getSermon(
      { sermonId: req.params.sermonId },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching sermon:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_fetch_failed",
          fallbackMessage: "Sermon fetch failed"
        })
      );
  }
});

app.get("/sermons/:sermonId/context", async (req, res) => {
  try {
    const result = await getSermonContext(
      {
        sermonId: req.params.sermonId,
        includeSourceMaterial: req.query.includeSourceMaterial === "true",
        includePreachingProfile: req.query.includePreachingProfile === "false" ? false : undefined,
        sourceLimit: req.query.sourceLimit,
        snapshotLimit: req.query.snapshotLimit,
        analysisLimit: req.query.analysisLimit,
        profileId: req.query.profileId
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching sermon context:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_context_fetch_failed",
          fallbackMessage: "Sermon context fetch failed"
        })
      );
  }
});

app.get("/sermons/:sermonId/presentations", async (req, res) => {
  try {
    const result = await listSermonPresentations(
      {
        sermonId: req.params.sermonId,
        templateId: req.query.templateId,
        status: req.query.status,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermon presentations:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_presentation_list_failed",
          fallbackMessage: "Sermon presentation list failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/presentations", async (req, res) => {
  try {
    const result = await createSermonPresentation(
      {
        ...(req.body || {}),
        sermonId: req.params.sermonId
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating sermon presentation:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_presentation_create_failed",
          fallbackMessage: "Sermon presentation create failed"
        })
      );
  }
});

app.get("/sermon-presentations", async (req, res) => {
  try {
    const result = await listSermonPresentations(
      {
        sermonId: req.query.sermonId,
        seriesId: req.query.seriesId,
        seriesSlug: req.query.seriesSlug,
        templateId: req.query.templateId,
        status: req.query.status,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermon presentations:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_presentation_list_failed",
          fallbackMessage: "Sermon presentation list failed"
        })
      );
  }
});

app.get("/gpt-action-files/sermon-presentations/:presentationId", async (req, res) => {
  const presentationId = cleanManuscriptText(req.params.presentationId);
  const signatureIsValid = verifyGptActionDownloadSignature({
    presentationId,
    expiresAtSeconds: req.query.expires,
    signature: req.query.signature,
    secret: BHE_API_KEY
  });
  if (!signatureIsValid) {
    return res.status(403).json({ ok: false, error: "Invalid or expired file link" });
  }

  try {
    const doc = await sermonPresentationsCollection.doc(presentationId).get();
    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Presentation not found" });
    }
    const presentation = doc.data() || {};
    const storagePath = cleanManuscriptText(presentation.storagePath);
    if (!storagePath) {
      return res.status(404).json({ ok: false, error: "Presentation file not found" });
    }

    const filename = sanitizeAttachmentFilename(presentation.filename);
    const contentType = cleanManuscriptText(presentation.contentType) ||
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const file = storage.bucket(BUCKET_NAME).file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ ok: false, error: "Presentation file not found" });
    }

    res.set({
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": buildAttachmentContentDisposition(filename),
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff"
    });
    const sizeBytes = Number(presentation.sizeBytes);
    if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
      res.set("Content-Length", String(sizeBytes));
    }

    console.log(JSON.stringify({
      event: "gpt_action_file_download_started",
      presentationId,
      filename,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0
    }));
    const stream = file.createReadStream();
    stream.on("error", (error) => {
      console.error(JSON.stringify({
        event: "gpt_action_file_download_failed",
        presentationId,
        errorMessage: error?.message || "Presentation download failed"
      }));
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "Presentation download failed" });
      } else {
        res.destroy(error);
      }
    });
    stream.on("end", () => {
      console.log(JSON.stringify({
        event: "gpt_action_file_download_completed",
        presentationId
      }));
    });
    return stream.pipe(res);
  } catch (error) {
    console.error("Error streaming GPT Action presentation file:", error);
    return res.status(500).json({ ok: false, error: "Presentation download failed" });
  }
});

app.get("/gpt-action-files/sermon-preaching-packets/:packetId", async (req, res) => {
  const packetId = cleanManuscriptText(req.params.packetId);
  const signatureIsValid = verifyGptActionArtifactDownloadSignature({
    artifactType: "sermon-preaching-packets",
    artifactId: packetId,
    expiresAtSeconds: req.query.expires,
    signature: req.query.signature,
    secret: BHE_API_KEY
  });
  if (!signatureIsValid) {
    return res.status(403).json({ ok: false, error: "Invalid or expired file link" });
  }
  try {
    const doc = await sermonPreachingPacketsCollection.doc(packetId).get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: "Preaching packet not found" });
    const packet = doc.data() || {};
    const storagePath = cleanManuscriptText(packet.storagePath);
    if (!storagePath) return res.status(404).json({ ok: false, error: "Preaching packet file not found" });
    const filename = sanitizeAttachmentFilename(packet.filename || "sermon-preaching-packet.zip");
    const file = storage.bucket(BUCKET_NAME).file(storagePath);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ ok: false, error: "Preaching packet file not found" });
    res.set({
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": buildAttachmentContentDisposition(filename),
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff"
    });
    const sizeBytes = Number(packet.sizeBytes);
    if (Number.isFinite(sizeBytes) && sizeBytes > 0) res.set("Content-Length", String(sizeBytes));
    const stream = file.createReadStream();
    stream.on("error", (error) => {
      console.error(JSON.stringify({
        event: "gpt_action_packet_download_failed",
        packetId,
        errorMessage: error?.message || "Preaching packet download failed"
      }));
      if (!res.headersSent) res.status(500).json({ ok: false, error: "Preaching packet download failed" });
      else res.destroy(error);
    });
    return stream.pipe(res);
  } catch (error) {
    console.error("Error streaming GPT Action preaching packet:", error);
    return res.status(500).json({ ok: false, error: "Preaching packet download failed" });
  }
});

app.get("/sermon-presentations/:presentationId", async (req, res) => {
  try {
    const result = await getSermonPresentation(
      { presentationId: req.params.presentationId },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching sermon presentation:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_presentation_fetch_failed",
          fallbackMessage: "Sermon presentation fetch failed"
        })
      );
  }
});

app.get("/sermons/:sermonId/snapshots", async (req, res) => {
  try {
    const result = await listSermonSnapshots(
      {
        sermonId: req.params.sermonId,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermon snapshots:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_snapshot_list_failed",
          fallbackMessage: "Sermon snapshot list failed"
        })
      );
  }
});

app.get("/sermons/:sermonId/sources", async (req, res) => {
  try {
    const result = await listSermonSources(
      {
        sermonId: req.params.sermonId,
        folderId: req.query.folderId,
        seriesId: req.query.seriesId,
        seriesSlug: req.query.seriesSlug,
        tag: req.query.tag,
        sourceType: req.query.sourceType,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermon sources:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_source_list_failed",
          fallbackMessage: "Sermon source list failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/sources", async (req, res) => {
  try {
    const result = await createSermonSource(
      {
        ...(req.body || {}),
        sermonId: req.params.sermonId
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating sermon source:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_source_create_failed",
          fallbackMessage: "Sermon source create failed"
        })
      );
  }
});

app.get("/sermons/:sermonId/media", async (req, res) => {
  try {
    const result = await listSermonMedia(
      {
        sermonId: req.params.sermonId,
        mediaType: req.query.mediaType,
        transcriptStatus: req.query.transcriptStatus,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermon media:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_media_list_failed",
          fallbackMessage: "Sermon media list failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/media", async (req, res) => {
  try {
    const result = await createSermonMedia(
      {
        ...(req.body || {}),
        sermonId: req.params.sermonId
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating sermon media:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_media_create_failed",
          fallbackMessage: "Sermon media create failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/media/upload-url", async (req, res) => {
  try {
    const body = req.body || {};
    const filename = cleanManuscriptText(body.filename || body.originalFilename);
    const contentType = cleanManuscriptText(body.contentType);

    if (!filename || !isValidFilename(filename)) {
      throw createWorkflowError("Missing or invalid filename", 400);
    }

    if (!contentType || (!contentType.startsWith("audio/") && !contentType.startsWith("video/"))) {
      throw createWorkflowError("contentType must be an audio or video MIME type", 400, { contentType });
    }

    const inferredMediaType = contentType.startsWith("audio/") ? "audio" : "video";
    const mediaId = cleanManuscriptText(body.mediaId) ||
      `media-${slugifyExportPart(req.params.sermonId)}-${randomUUID().slice(0, 8)}`;
    const storagePath = cleanManuscriptText(body.storagePath) ||
      `sermon-media/${slugifyExportPart(req.params.sermonId)}/${mediaId}/${filename}`;
    const file = storage.bucket(BUCKET_NAME).file(storagePath);
    const [uploadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 60 * 60 * 1000,
      contentType
    });
    const mediaResult = await createSermonMedia(
      {
        ...(body || {}),
        sermonId: req.params.sermonId,
        mediaId,
        mediaType: body.mediaType || inferredMediaType,
        platform: body.platform || inferredMediaType,
        storagePath,
        originalFilename: filename,
        contentType,
        transcriptStatus: body.transcriptStatus || "none",
        sourceRefs: [
          ...(Array.isArray(body.sourceRefs) ? body.sourceRefs : []),
          {
            type: "cloud_storage_media",
            storagePath,
            contentType,
            originalFilename: filename
          }
        ]
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(201).json({
      ok: true,
      media: mediaResult.media,
      upload: {
        uploadUrl,
        method: "PUT",
        storagePath,
        contentType,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    });
  } catch (error) {
    console.error("Error creating sermon media upload URL:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_media_upload_url_failed",
          fallbackMessage: "Sermon media upload URL create failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/media/import-url", async (req, res) => {
  let importedMedia = null;

  try {
    const body = req.body || {};
    const deps = getSermonWorkspaceDependencies();
    const imported = await importSermonMediaFromPublicUrl(
      {
        ...(body || {}),
        sermonId: req.params.sermonId
      },
      deps
    );
    importedMedia = imported.media;
    let transcription = null;
    let source = null;
    let rebuild = null;
    let embed = null;

    if (body.transcribe === true) {
      await updateSermonMedia(
        {
          mediaId: imported.media.mediaId,
          changes: { transcriptStatus: "pending" }
        },
        deps
      );
      const transcriptionResult = await transcribeSermonMediaWithOpenAi({
        media: imported.media,
        prompt: body.prompt,
        responseFormat: body.responseFormat,
        preferCaptions: body.preferCaptions !== false
      });
      const sourceResult = await createSermonMediaTranscriptSource(
        {
          mediaId: imported.media.mediaId,
          transcriptKind: "raw",
          transcriptText: transcriptionResult.text,
          summary: [
            `Raw transcript generated with ${transcriptionResult.model}.`,
            transcriptionResult.method ? `Method: ${transcriptionResult.method}.` : "",
            `Media: ${imported.media.title || imported.media.label || imported.media.mediaId}`,
            transcriptionResult.startSeconds ? `Start offset: ${transcriptionResult.startSeconds} seconds.` : "",
            transcriptionResult.endSeconds ? `End offset: ${transcriptionResult.endSeconds} seconds.` : "",
            `Bytes: ${transcriptionResult.sizeBytes}`
          ].filter(Boolean).join("\n"),
          sourceLabel: body.sourceLabel ||
            `Raw transcript - ${imported.media.label || imported.media.title || imported.media.mediaId}`
        },
        deps
      );
      importedMedia = sourceResult.media;
      source = sourceResult.source;
      transcription = {
        model: transcriptionResult.model,
        method: transcriptionResult.method || "openai_transcription",
        startSeconds: transcriptionResult.startSeconds || imported.media.startSeconds || 0,
        endSeconds: transcriptionResult.endSeconds || imported.media.endSeconds || 0,
        sizeBytes: transcriptionResult.sizeBytes,
        contentType: transcriptionResult.contentType,
        textLength: transcriptionResult.text.length,
        preview: truncateForResponse(transcriptionResult.text, 1200)
      };

      if (body.rebuildChunks !== false) {
        rebuild = await rebuildSermonChunks(
          { sermonId: req.params.sermonId },
          deps
        );

        if (body.embedChunks === true) {
          embed = await embedSermonChunks(
            {
              sermonId: req.params.sermonId,
              limit: body.embedLimit || 50
            },
            deps
          );
        }
      }
    }

    return res.status(201).json({
      ok: true,
      media: importedMedia,
      import: imported.import,
      source,
      transcription,
      rebuild,
      embed
    });
  } catch (error) {
    console.error("Error importing sermon media from URL:", error);

    if (importedMedia?.mediaId) {
      try {
        await updateSermonMedia(
          {
            mediaId: importedMedia.mediaId,
            changes: {
              transcriptStatus: "failed",
              notes: `Media URL import/transcription failed: ${error.message || "Unknown error"}`
            }
          },
          getSermonWorkspaceDependencies()
        );
      } catch (updateError) {
        console.error("Error marking imported sermon media failed:", updateError);
      }
    }

    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_media_import_url_failed",
          fallbackMessage: "Sermon media URL import failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/manuscript-draft", async (req, res) => {
  try {
    const body = req.body || {};
    const deps = getSermonWorkspaceDependencies();
    const manuscriptMode = SERMON_MANUSCRIPT_MODES.has(cleanManuscriptText(body.manuscriptMode))
      ? cleanManuscriptText(body.manuscriptMode)
      : "draft";
    const sourceLimit = clampInteger(body.sourceLimit, 100, 1, 100);
    const maxSelectedSources = clampInteger(body.maxSelectedSources, 24, 1, 50);
    const semanticLimit = clampInteger(body.semanticLimit, 10, 0, 20);
    const context = await getSermonContext(
      {
        sermonId: req.params.sermonId,
        includeSourceMaterial: false,
        includePreachingProfile: body.includePreachingProfile === false ? false : true,
        sourceLimit,
        checkpointLimit: 500,
        snapshotLimit: clampInteger(body.snapshotLimit, 3, 1, 20),
        analysisLimit: clampInteger(body.analysisLimit, 5, 1, 20),
        profileId: body.profileId
      },
      deps
    );
    const sourceFilterOptions = {
      excludeSourceIds: body.excludeSourceIds,
      excludeSourceTypes: body.excludeSourceTypes,
      excludeGeneratedManuscriptSources: body.includeGeneratedManuscriptSources === true ||
        body.includePriorManuscriptSources === true
        ? false
        : body.excludeGeneratedManuscriptSources !== false
    };
    const candidateSources = filterSermonSourcesForManuscript(
      context.sources,
      sourceFilterOptions
    );
    const sourceSelection = await selectSermonSourcesForManuscript({
      sermon: context.sermon,
      sources: candidateSources,
      focusNotes: body.focusNotes,
      maxSources: maxSelectedSources,
      useAiSelection: body.useAiSourceSelection === false
        ? false
        : body.dryRun === true
          ? body.runAiSelectionInDryRun === true
          : true
    });
    const selectedSources = await hydrateSelectedSermonSources(
      sourceSelection.selectedSources,
      deps
    );

    const semanticQuery = cleanManuscriptText(body.semanticQuery) || [
      context.sermon?.title,
      context.sermon?.scriptureText,
      context.sermon?.bigIdea,
      body.focusNotes
    ].filter(Boolean).join(" ");
    let semanticRetrieval = null;
    let semanticWarning = "";

    if (semanticLimit > 0 && semanticQuery) {
      try {
        semanticRetrieval = await semanticSearchSermonChunks(
          {
            query: semanticQuery,
            sermonId: req.params.sermonId,
            limit: semanticLimit,
            distanceMeasure: body.distanceMeasure,
            embeddingModel: body.embeddingModel
          },
          deps
        );
      } catch (error) {
        semanticWarning = error?.message || "Semantic retrieval failed";
      }
    }

    const contextText = buildManuscriptDraftContext({
      sermon: context.sermon,
      folder: context.folder,
      sources: selectedSources,
      preachingAnalyses: context.preachingAnalyses,
      preachingProfile: context.preachingProfile,
      semanticChunks: semanticRetrieval?.chunks || [],
      developmentCheckpoints: context.developmentCheckpoints,
      options: {
        sourceMaterialBudget: body.sourceMaterialBudget,
        semanticLimit
      }
    });
    const developmentCheckpoints = Array.isArray(context.developmentCheckpoints)
      ? context.developmentCheckpoints
      : [];
    const materialInventory = await getSermonMaterialInventory({
      sermonId: req.params.sermonId,
      limit: 1
    }, deps);
    if (materialInventory.summary.total > developmentCheckpoints.length) {
      throw createWorkflowError(
        "The sermon has more than 500 development checkpoints; archive or consolidate material before manuscript generation.",
        409
      );
    }
    const contextMaterialFingerprint = buildSermonMaterialFingerprint(developmentCheckpoints);
    if (materialInventory.materialFingerprint !== contextMaterialFingerprint) {
      throw createWorkflowError(
        "Sermon development material changed during manuscript preparation; retry with the current material plan.",
        409
      );
    }
    const materialFingerprint = materialInventory.materialFingerprint;
    const contextStats = {
      sourceCount: context.counts?.sourceCount || 0,
      returnedSourceCount: context.counts?.returnedSourceCount || 0,
      selectedSourceCount: selectedSources.length,
      semanticChunkCount: semanticRetrieval?.count || 0,
      contextChars: contextText.length,
      sourceLimit,
      maxSelectedSources,
      candidateSourceCount: candidateSources.length,
      excludedSourceCount: Math.max((context.sources || []).length - candidateSources.length, 0),
      excludeGeneratedManuscriptSources: sourceFilterOptions.excludeGeneratedManuscriptSources,
      semanticLimit,
      semanticWarning,
      sourceSelectionMethod: sourceSelection.method,
      sourceSelectionWarning: sourceSelection.warning || "",
      manuscriptMode,
      materialFingerprint,
      placedMaterialCount: materialInventory.summary.placed,
      excludedUnplacedMaterialCount: materialInventory.summary.unplaced,
      excludedCutMaterialCount: materialInventory.summary.intentionallyCut,
      requiredDevelopmentCoverageCount: buildRequiredManuscriptCoverageItems(developmentCheckpoints).length
    };
    const unresolvedDevelopmentSessions = buildUnresolvedDevelopmentSessionBlockers(
      context.recentDevelopmentSessions
    );
    const selectedSourceSummary = selectedSources.map((source) => ({
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      sourceLabel: source.sourceLabel,
      materialChars: getSermonSourceMaterialChars(source),
      selectionReason: source.selectionReason || ""
    }));

    if (body.dryRun === true) {
      return res.status(200).json({
        ok: true,
        sermonId: req.params.sermonId,
        dryRun: true,
        model: SERMON_MANUSCRIPT_MODEL,
        manuscriptMode,
        sourceSelectionModel: body.runAiSelectionInDryRun === true ? SERMON_SOURCE_SELECTION_MODEL : null,
        sermon: context.sermon,
        selectedSources: selectedSourceSummary,
        contextStats,
        unresolvedDevelopmentSessions,
        readyForManuscriptGeneration: unresolvedDevelopmentSessions.length === 0,
        contextPreview: truncateForPrompt(contextText, 3000)
      });
    }

    if (unresolvedDevelopmentSessions.length > 0 && body.ignoreUnresolvedDevelopmentSessions !== true) {
      throw createWorkflowError(
        "Resolve active or empty sermon development sessions before manuscript generation",
        409,
        {
          unresolvedDevelopmentSessions,
          nextAction: "Save the missing development chat as checkpoints/source material and close the session, or rerun only after intentionally ignoring these sessions."
        }
      );
    }

    let manuscript = await generateSermonManuscriptWithOpenAi({
      contextText,
      options: {
        focusNotes: body.focusNotes,
        targetLength: body.targetLength,
        tone: body.tone,
        manuscriptFormat: body.manuscriptFormat,
        manuscriptMode,
        model: body.model,
        maxOutputTokens: body.maxOutputTokens
      }
    });
    let coverageEvaluation = await validateManuscriptCoverageWithSemanticAudit({
      manuscript,
      developmentCheckpoints,
      options: {
        model: body.model,
        maxOutputTokens: body.coverageAuditMaxOutputTokens
      }
    });
    let developmentCoverage = coverageEvaluation.coverage;
    let semanticCoverageAuditApplied = coverageEvaluation.semanticAuditApplied;
    const semanticCoverageAuditWarnings = coverageEvaluation.semanticAuditWarning
      ? [coverageEvaluation.semanticAuditWarning]
      : [];
    let coverageRepairApplied = false;
    if (developmentCoverage.missingCount > 0 && body.repairMissingDevelopmentMaterial !== false) {
      manuscript = await reviseSermonManuscriptForCoverageWithOpenAi({
        manuscript,
        contextText,
        missingCoverageItems: developmentCoverage.missing,
        options: {
          model: body.model,
          maxOutputTokens: body.maxOutputTokens
        }
      });
      coverageRepairApplied = true;
      coverageEvaluation = await validateManuscriptCoverageWithSemanticAudit({
        manuscript,
        developmentCheckpoints,
        options: {
          model: body.model,
          maxOutputTokens: body.coverageAuditMaxOutputTokens
        }
      });
      developmentCoverage = coverageEvaluation.coverage;
      semanticCoverageAuditApplied = semanticCoverageAuditApplied || coverageEvaluation.semanticAuditApplied;
      if (coverageEvaluation.semanticAuditWarning) {
        semanticCoverageAuditWarnings.push(coverageEvaluation.semanticAuditWarning);
      }
    }
    if (developmentCoverage.missingCount > 0) {
      throw createWorkflowError(
        "Generated manuscript is missing required placed development material",
        502,
        {
          missingCount: developmentCoverage.missingCount,
          missing: developmentCoverage.missing.map((item) => ({
            checkpointId: item.checkpointId,
            checkpointType: item.checkpointType,
            placementTarget: item.placementTarget,
            exactWording: item.exactWording,
            coverageMethod: item.coverageMethod,
            semanticAudit: item.semanticAudit || null,
            contentPreview: truncateForPrompt(item.content, 240)
          })),
          semanticCoverageAuditApplied,
          semanticCoverageAuditWarnings,
          nextAction: "Do not duplicate these checkpoints into sermon notes. The placed checkpoints remain the source of truth; correct the backend audit or checkpoint itself before retrying."
        }
      );
    }
    const assemblyCompliance = manuscriptMode === "assembly"
      ? validateManuscriptAssemblyCompliance(manuscript, {
          requireReliefEnding: body.requireReliefEnding !== false,
          requireSimpleFinalPosture: body.requireSimpleFinalPosture === true,
          simpleFinalPosture: body.simpleFinalPosture
        })
      : { violationCount: 0, violations: [] };
    if (assemblyCompliance.violationCount > 0 && body.ignoreAssemblyCompliance !== true) {
      throw createWorkflowError(
        "Assembled manuscript does not obey requested shape and restraint",
        502,
        assemblyCompliance
      );
    }
    const docTitle = cleanManuscriptText(body.docTitle) ||
      `${context.sermon?.title || "Sermon"} - Manuscript Draft`;
    const generatedAt = new Date().toISOString();
    const exportFile = await uploadSermonManuscriptDocxExport({
      sermonId: req.params.sermonId,
      title: docTitle,
      manuscript,
      sermon: context.sermon,
      generatedAt
    });
    const sourceResult = await createSermonSource(
      {
        sermonId: req.params.sermonId,
        sourceType: "doc",
        sourceLabel: `Generated manuscript draft - ${generatedAt.slice(0, 10)}`,
        summary: [
          `GPT manuscript draft created with ${body.model || SERMON_MANUSCRIPT_MODEL}.`,
          `DOCX export: ${exportFile.storagePath}`,
          `Context: ${contextStats.selectedSourceCount} selected source records, ${contextStats.semanticChunkCount} semantic chunks.`,
          `Manuscript mode: ${manuscriptMode}.`,
          `Material plan: ${contextStats.placedMaterialCount} placed, ${contextStats.excludedUnplacedMaterialCount} unplaced excluded, ${contextStats.excludedCutMaterialCount} intentionally cut excluded.`,
          `Coverage validation: ${developmentCoverage.requiredCount} required placed items checked, ${semanticCoverageAuditApplied ? "semantic evidence audit applied" : "deterministic audit only"}, ${coverageRepairApplied ? "repair pass applied" : "no repair pass needed"}.`,
          `Source selection: ${contextStats.sourceSelectionMethod}${contextStats.sourceSelectionWarning ? ` (${contextStats.sourceSelectionWarning})` : ""}.`
        ].join("\n"),
        material: manuscript,
        sourceRefs: [
          {
            type: "cloud_storage_docx",
            role: "manuscript_draft",
            storagePath: exportFile.storagePath,
            filename: exportFile.filename,
            contentType: exportFile.contentType,
            sizeBytes: exportFile.sizeBytes,
            downloadUrlExpiresAt: exportFile.expiresAt,
            title: docTitle,
            generatedAt,
            model: body.model || SERMON_MANUSCRIPT_MODEL,
            sourceSelectionModel: sourceSelection.method === "openai_manifest_selection"
              ? SERMON_SOURCE_SELECTION_MODEL
              : "",
            selectedSourceIds: selectedSources.map((source) => source.sourceId)
          },
          {
            type: "sermon_material_plan",
            role: "manuscript_material_plan",
            materialFingerprint,
            placedMaterialCount: contextStats.placedMaterialCount,
            excludedUnplacedMaterialCount: contextStats.excludedUnplacedMaterialCount,
            excludedCutMaterialCount: contextStats.excludedCutMaterialCount,
            generatedAt
          }
        ]
      },
      deps
    );
    const existingRefs = Array.isArray(context.sermon?.sourceRefs)
      ? context.sermon.sourceRefs
      : [];
    const nextRefs = [
      ...existingRefs.filter((ref) => ref?.storagePath !== exportFile.storagePath),
      {
        type: "cloud_storage_docx",
        role: "manuscript_draft",
        storagePath: exportFile.storagePath,
        filename: exportFile.filename,
        contentType: exportFile.contentType,
        sizeBytes: exportFile.sizeBytes,
        title: docTitle,
        sourceId: sourceResult.source.sourceId,
        generatedAt,
        model: body.model || SERMON_MANUSCRIPT_MODEL,
        materialFingerprint,
        placedMaterialCount: contextStats.placedMaterialCount
      }
    ];
    const sermonUpdate = await updateSermon(
      {
        sermonId: req.params.sermonId,
        changes: {
          sourceRefs: nextRefs,
          primaryManuscriptSourceId: sourceResult.source.sourceId
        },
        snapshotReason: "Before attaching generated manuscript draft as primary manuscript"
      },
      deps
    );

    return res.status(201).json({
      ok: true,
      sermonId: req.params.sermonId,
      model: body.model || SERMON_MANUSCRIPT_MODEL,
      manuscriptMode,
      sourceSelectionModel: sourceSelection.method === "openai_manifest_selection"
        ? SERMON_SOURCE_SELECTION_MODEL
        : null,
      exportFile,
      source: sourceResult.source,
      sermon: sermonUpdate.sermon,
      selectedSources: selectedSourceSummary,
      contextStats,
      developmentCoverage: {
        requiredCount: developmentCoverage.requiredCount,
        missingCount: developmentCoverage.missingCount,
        coveredCount: developmentCoverage.coveredCount,
        semanticAcceptedCount: developmentCoverage.semanticAcceptedCount || 0,
        semanticAuditApplied: semanticCoverageAuditApplied,
        semanticAuditWarnings: semanticCoverageAuditWarnings,
        repairApplied: coverageRepairApplied,
        coverage: developmentCoverage.covered.map((item) => ({
          checkpointId: item.checkpointId,
          checkpointType: item.checkpointType,
          exactWording: item.exactWording,
          coverageMethod: item.coverageMethod,
          evidence: item.evidence || ""
        }))
      },
      assemblyCompliance,
      manuscriptPreview: truncateForPrompt(manuscript, 1200)
    });
  } catch (error) {
    console.error("Error creating sermon manuscript draft:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_manuscript_draft_failed",
          fallbackMessage: "Sermon manuscript draft failed"
        })
      );
  }
});

app.get("/sermon-snapshots/:snapshotId", async (req, res) => {
  try {
    const result = await getSermonSnapshot(
      { snapshotId: req.params.snapshotId },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching sermon snapshot:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_snapshot_fetch_failed",
          fallbackMessage: "Sermon snapshot fetch failed"
        })
      );
  }
});

app.get("/sermon-sources/search", async (req, res) => {
  try {
    const result = await listSermonSources(
      {
        sermonId: req.query.sermonId,
        folderId: req.query.folderId,
        seriesId: req.query.seriesId,
        seriesSlug: req.query.seriesSlug,
        tag: req.query.tag,
        sourceType: req.query.sourceType,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error searching sermon sources:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_source_search_failed",
          fallbackMessage: "Sermon source search failed"
        })
      );
  }
});

app.post("/sermon-source-search", async (req, res) => {
  try {
    const result = await listSermonSources(
      {
        sermonId: req.body?.sermonId,
        folderId: req.body?.folderId,
        seriesId: req.body?.seriesId,
        seriesSlug: req.body?.seriesSlug,
        tag: req.body?.tag,
        sourceType: req.body?.sourceType,
        query: req.body?.query,
        limit: req.body?.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error searching sermon sources:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_source_search_failed",
          fallbackMessage: "Sermon source search failed"
        })
      );
  }
});

app.get("/sermon-source-search", async (req, res) => {
  try {
    const result = await listSermonSources(
      {
        sermonId: req.query.sermonId,
        folderId: req.query.folderId,
        seriesId: req.query.seriesId,
        seriesSlug: req.query.seriesSlug,
        tag: req.query.tag,
        sourceType: req.query.sourceType,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error searching sermon sources:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_source_search_failed",
          fallbackMessage: "Sermon source search failed"
        })
      );
  }
});

app.get("/sermon-chunk-search", async (req, res) => {
  try {
    const result = await searchSermonChunks(
      {
        query: req.query.query,
        sermonId: req.query.sermonId,
        folderId: req.query.folderId,
        seriesId: req.query.seriesId,
        seriesSlug: req.query.seriesSlug,
        tag: req.query.tag,
        sourceKind: req.query.sourceKind,
        chunkType: req.query.chunkType,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error searching sermon chunks:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_chunk_search_failed",
          fallbackMessage: "Sermon chunk search failed"
        })
      );
  }
});

app.get("/sermon-semantic-search", async (req, res) => {
  try {
    const result = await semanticSearchSermonChunks(
      {
        query: req.query.query,
        sermonId: req.query.sermonId,
        folderId: req.query.folderId,
        seriesId: req.query.seriesId,
        seriesSlug: req.query.seriesSlug,
        tag: req.query.tag,
        sourceKind: req.query.sourceKind,
        chunkType: req.query.chunkType,
        limit: req.query.limit,
        distanceMeasure: req.query.distanceMeasure,
        embeddingModel: req.query.embeddingModel
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error searching sermon chunks semantically:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_semantic_search_failed",
          fallbackMessage: "Sermon semantic search failed"
        })
      );
  }
});

app.post("/sermon-rag-answer", async (req, res) => {
  try {
    const result = await answerSermonQuestion(
      req.body || {},
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error answering sermon question with RAG:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_rag_answer_failed",
          fallbackMessage: "Sermon RAG answer failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/chunks/rebuild", async (req, res) => {
  try {
    const result = await rebuildSermonChunks(
      {
        ...(req.body || {}),
        sermonId: req.params.sermonId
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error rebuilding sermon chunks:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_chunk_rebuild_failed",
          fallbackMessage: "Sermon chunk rebuild failed"
        })
      );
  }
});

app.post("/sermon-chunks/embed", async (req, res) => {
  try {
    const result = await embedSermonChunks(
      req.body || {},
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error embedding sermon chunks:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_chunk_embed_failed",
          fallbackMessage: "Sermon chunk embed failed"
        })
      );
  }
});

app.get("/sermon-sources", async (req, res) => {
  try {
    const result = await listSermonSources(
      {
        sermonId: req.query.sermonId,
        folderId: req.query.folderId,
        sourceType: req.query.sourceType,
        query: req.query.query,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error searching sermon sources:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_source_search_failed",
          fallbackMessage: "Sermon source search failed"
        })
      );
  }
});

app.get("/sermon-sources/:sourceId", async (req, res) => {
  try {
    const result = await getSermonSource(
      { sourceId: req.params.sourceId },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching sermon source:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_source_fetch_failed",
          fallbackMessage: "Sermon source fetch failed"
        })
      );
  }
});

app.get("/sermon-media/:mediaId", async (req, res) => {
  try {
    const result = await getSermonMedia(
      { mediaId: req.params.mediaId },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error fetching sermon media:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_media_fetch_failed",
          fallbackMessage: "Sermon media fetch failed"
        })
      );
  }
});

app.patch("/sermon-media/:mediaId", async (req, res) => {
  try {
    const result = await updateSermonMedia(
      {
        mediaId: req.params.mediaId,
        changes: req.body?.changes || req.body || {}
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating sermon media:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_media_update_failed",
          fallbackMessage: "Sermon media update failed"
        })
      );
  }
});

app.post("/sermon-media/:mediaId/transcript-source", async (req, res) => {
  try {
    const deps = getSermonWorkspaceDependencies();
    const result = await createSermonMediaTranscriptSource(
      {
        ...(req.body || {}),
        mediaId: req.params.mediaId
      },
      deps
    );
    let rebuild = null;

    if (req.body?.rebuildChunks === true) {
      rebuild = await rebuildSermonChunks(
        { sermonId: result.media.sermonId },
        deps
      );
    }

    return res.status(201).json({
      ok: true,
      ...result,
      rebuild
    });
  } catch (error) {
    console.error("Error creating sermon media transcript source:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_media_transcript_source_failed",
          fallbackMessage: "Sermon media transcript source create failed"
        })
      );
  }
});

app.post("/sermon-media/:mediaId/transcribe", async (req, res) => {
  try {
    const deps = getSermonWorkspaceDependencies();
    const mediaResult = await getSermonMedia(
      { mediaId: req.params.mediaId },
      deps
    );
    const existingRawSourceId = cleanManuscriptText(mediaResult.media.transcriptSourceIds?.raw);
    if (existingRawSourceId && req.body?.force !== true) {
      const existingSource = await getSermonSource({ sourceId: existingRawSourceId }, deps);
      return res.status(200).json({
        ok: true,
        media: mediaResult.media,
        source: existingSource.source,
        transcription: {
          reused: true,
          textLength: cleanManuscriptText(existingSource.source.material).length,
          preview: truncateForResponse(existingSource.source.material, 1200)
        },
        rebuild: null,
        embed: null
      });
    }
    await updateSermonMedia(
      {
        mediaId: req.params.mediaId,
        changes: { transcriptStatus: "pending" }
      },
      deps
    );
    const transcription = await transcribeSermonMediaWithOpenAi({
      media: mediaResult.media,
      prompt: req.body?.prompt,
      responseFormat: req.body?.responseFormat,
      preferCaptions: req.body?.preferCaptions !== false
    });
    const sourceResult = await createSermonMediaTranscriptSource(
      {
        mediaId: req.params.mediaId,
        transcriptKind: "raw",
        transcriptText: transcription.text,
        summary: [
          `Raw transcript generated with ${transcription.model}.`,
          transcription.method ? `Method: ${transcription.method}.` : "",
          `Media: ${mediaResult.media.title || mediaResult.media.label || req.params.mediaId}`,
          transcription.startSeconds ? `Start offset: ${transcription.startSeconds} seconds.` : "",
          transcription.endSeconds ? `End offset: ${transcription.endSeconds} seconds.` : "",
          `Bytes: ${transcription.sizeBytes}`
        ].filter(Boolean).join("\n"),
        sourceLabel: req.body?.sourceLabel ||
          `Raw transcript - ${mediaResult.media.label || mediaResult.media.title || req.params.mediaId}`
      },
      deps
    );
    let rebuild = null;
    let embed = null;

    if (req.body?.rebuildChunks !== false) {
      rebuild = await rebuildSermonChunks(
        { sermonId: sourceResult.media.sermonId },
        deps
      );

      if (req.body?.embedChunks === true) {
        embed = await embedSermonChunks(
          {
            sermonId: sourceResult.media.sermonId,
            limit: req.body?.embedLimit || 50
          },
          deps
        );
      }
    }

    return res.status(201).json({
      ok: true,
      media: sourceResult.media,
      source: sourceResult.source,
      transcription: {
        model: transcription.model,
        method: transcription.method || "openai_transcription",
        startSeconds: transcription.startSeconds || mediaResult.media.startSeconds || 0,
        endSeconds: transcription.endSeconds || mediaResult.media.endSeconds || 0,
        sizeBytes: transcription.sizeBytes,
        contentType: transcription.contentType,
        textLength: transcription.text.length,
        preview: truncateForResponse(transcription.text, 1200)
      },
      rebuild,
      embed
    });
  } catch (error) {
    console.error("Error transcribing sermon media:", error);

    try {
      await updateSermonMedia(
        {
          mediaId: req.params.mediaId,
          changes: {
            transcriptStatus: "failed"
          }
        },
        getSermonWorkspaceDependencies()
      );
    } catch (updateError) {
      console.error("Error marking sermon media transcription failed:", updateError);
    }

    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_media_transcription_failed",
          fallbackMessage: "Sermon media transcription failed"
        })
      );
  }
});

app.post("/internal/sermon-transcription-jobs/:jobId/run", async (req, res) => {
  try {
    const result = await processSermonTranscriptionJob(
      { jobId: req.params.jobId },
      getSermonWorkspaceDependencies()
    );
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Error processing sermon transcription job:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(buildStructuredErrorResponse(error, {
        fallbackCode: "sermon_transcription_job_processing_failed",
        fallbackMessage: "Sermon transcription job processing failed"
      }));
  }
});

app.patch("/sermons/:sermonId", async (req, res) => {
  try {
    const result = await updateSermon(
      {
        sermonId: req.params.sermonId,
        changes: req.body?.changes || req.body || {}
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error updating sermon:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_update_failed",
          fallbackMessage: "Sermon update failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/append", async (req, res) => {
  try {
    const result = await appendSermonContent(
      {
        ...(req.body || {}),
        sermonId: req.params.sermonId
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error appending sermon content:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_append_failed",
          fallbackMessage: "Sermon content append failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/development-notes", async (req, res) => {
  try {
    const result = await addSermonDevelopmentNote(
      {
        sermonId: req.params.sermonId,
        content: req.body?.content,
        noteType: req.body?.noteType
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error adding sermon development note:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_note_create_failed",
          fallbackMessage: "Sermon development note create failed"
        })
      );
  }
});

app.get("/sermons/:sermonId/preaching-analyses", async (req, res) => {
  try {
    const result = await listPreachingAnalyses(
      {
        sermonId: req.params.sermonId,
        limit: req.query.limit
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error listing preaching analyses:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "preaching_analysis_list_failed",
          fallbackMessage: "Preaching analysis list failed"
        })
      );
  }
});

app.post("/sermons/:sermonId/preaching-analysis", async (req, res) => {
  try {
    const result = await createPreachingAnalysis(
      {
        ...(req.body || {}),
        sermonId: req.params.sermonId
      },
      getSermonWorkspaceDependencies()
    );

    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error creating preaching analysis:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "preaching_analysis_create_failed",
          fallbackMessage: "Preaching analysis create failed"
        })
      );
  }
});

app.post("/sermon-workspace/overview", async (req, res) => {
  try {
    const result = await buildSermonWorkspaceOverview(
      req.body || {},
      getSermonWorkspaceDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error building sermon workspace overview:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "sermon_workspace_overview_failed",
          fallbackMessage: "Sermon workspace overview failed"
        })
      );
  }
});

app.get("/sermon-workspace/operations", (req, res) => {
  const requestId = randomUUID();

  try {
    const result = listSermonWorkspaceOperations({
      mode: req.query.mode,
      query: req.query.query,
      limit: req.query.limit
    });

    return res.status(200).json({
      ok: true,
      requestId,
      ...result
    });
  } catch (error) {
    console.error("Error listing sermon workspace operations:", error);
    return res.status(200).json(
      buildSermonWorkspaceOperationError(error, {
        mode: req.query.mode,
        requestId
      })
    );
  }
});

async function handleSermonWorkspaceOperation(req, res, mode, options = {}) {
  const requestId = randomUUID();
  const operation = req.body?.operation;
  const operationArguments = buildSermonWorkspaceOperationArguments(req.body);
  const idempotencyKey = getSermonWorkspaceIdempotencyKey(req.body);
  const startedAtMs = Date.now();
  const argumentKeys = operationArguments && typeof operationArguments === "object" && !Array.isArray(operationArguments)
    ? Object.keys(operationArguments).sort()
    : [];

  res.set("x-request-id", requestId);
  console.log(JSON.stringify({
    event: "sermon_workspace_operation_started",
    requestId,
    mode,
    operation: typeof operation === "string" ? operation : "",
    argumentKeys,
    idempotencyProvided: typeof idempotencyKey === "string" && Boolean(idempotencyKey.trim())
  }));

  try {
    const result = await runIdempotentSermonWorkspaceOperation(
      {
        mode,
        operation,
        arguments: operationArguments,
        idempotencyKey
      },
      getSermonWorkspaceDependencies()
    );
    let responseBody = typeof options.formatSuccessResponse === "function"
      ? await options.formatSuccessResponse({ requestId, result })
      : {
          ok: true,
          requestId,
          ...result
        };
    if (mode === "artifact") {
      try {
        const packetFileResponse = await createPreachingPacketActionFileResponse(result, {
          getPacket: async (packetId) => {
            const doc = await sermonPreachingPacketsCollection.doc(packetId).get();
            return doc.exists ? (doc.data() || {}) : {};
          },
          createSignedUrl: async ({ packetId }) => buildGptActionArtifactDownloadUrl({
            baseUrl: GPT_ACTION_BASE_URL,
            artifactType: "sermon-preaching-packets",
            artifactId: packetId,
            secret: BHE_API_KEY
          })
        });
        const presentationFileResponse = packetFileResponse ? null : await createPresentationActionFileResponse(result, {
          getPresentation: async (presentationId) => {
            const doc = await sermonPresentationsCollection.doc(presentationId).get();
            return doc.exists ? (doc.data() || {}) : {};
          },
          createSignedUrl: async ({ presentationId }) => {
            return buildGptActionDownloadUrl({
              baseUrl: GPT_ACTION_BASE_URL,
              presentationId,
              secret: BHE_API_KEY
            });
          }
        });
        const fileResponse = packetFileResponse || presentationFileResponse;
        responseBody = applyPresentationActionFileResponse(responseBody, fileResponse);
        if (fileResponse?.openaiFileResponse?.length) {
          console.log(JSON.stringify({
            event: "sermon_workspace_action_file_attached",
            requestId,
            operation: result.operation,
            artifactId: fileResponse.artifactId || fileResponse.presentationId,
            filename: fileResponse.filename,
            sizeBytes: fileResponse.sizeBytes
          }));
        } else if (fileResponse?.skipped) {
          console.warn(JSON.stringify({
            event: "sermon_workspace_action_file_skipped",
            requestId,
            operation: result.operation,
            artifactId: fileResponse.artifactId || fileResponse.presentationId,
            reason: fileResponse.reason,
            sizeBytes: fileResponse.sizeBytes
          }));
        }
      } catch (fileError) {
        console.error(JSON.stringify({
          event: "sermon_workspace_action_file_failed",
          requestId,
          operation: result.operation,
          errorMessage: fileError?.message || "Action file response failed"
        }));
      }
    }
    const durationMs = Date.now() - startedAtMs;
    const responseBytes = getJsonByteLength(responseBody);

    console.log(JSON.stringify({
      event: "sermon_workspace_operation_succeeded",
      requestId,
      mode,
      operation: result.operation,
      durationMs,
      responseBytes,
      idempotencyProtected: result.idempotency?.protected === true,
      idempotencyReplayed: result.idempotency?.replayed === true,
      executionId: result.idempotency?.executionId || ""
    }));

    return res.status(200).json(responseBody);
  } catch (error) {
    const operationError = buildSermonWorkspaceOperationError(error, {
      mode,
      operation,
      requestId
    });
    const responseBody = typeof options.formatErrorResponse === "function"
      ? options.formatErrorResponse(operationError)
      : operationError;
    const durationMs = Date.now() - startedAtMs;
    const responseBytes = getJsonByteLength(responseBody);

    console.error(JSON.stringify({
      event: "sermon_workspace_operation_failed",
      requestId,
      mode,
      operation: typeof operation === "string" ? operation : "",
      durationMs,
      responseBytes,
      logicalStatus: operationError.error.status,
      errorCode: operationError.error.code,
      argumentKeys,
      idempotencyProvided: typeof idempotencyKey === "string" && Boolean(idempotencyKey.trim())
    }));

    return res.status(200).json(responseBody);
  }
}

function buildSermonWorkspaceOperationArguments(body = {}) {
  const rawOperationArguments = body?.arguments ?? body?.args;
  const operationArguments = isPlainObject(rawOperationArguments)
    ? Object.fromEntries(Object.entries(rawOperationArguments).filter(([key]) => key !== "idempotencyKey"))
    : rawOperationArguments;
  return Array.isArray(body?.openaiFileIdRefs)
    ? {
        ...(isPlainObject(operationArguments) ? operationArguments : {}),
        openaiFileIdRefs: body.openaiFileIdRefs
      }
    : operationArguments;
}

function getSermonWorkspaceIdempotencyKey(body = {}) {
  if (typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim()) {
    return body.idempotencyKey;
  }
  const rawOperationArguments = body?.arguments ?? body?.args;
  return isPlainObject(rawOperationArguments) && typeof rawOperationArguments.idempotencyKey === "string"
    ? rawOperationArguments.idempotencyKey
    : undefined;
}

app.post("/sermon-workspace/query", async (req, res) => {
  return handleSermonWorkspaceOperation(req, res, "query");
});

app.post("/sermon-workspace/artifact", async (req, res) => {
  return handleSermonWorkspaceOperation(req, res, "artifact");
});

function buildDirectSermonPresentationActionResponse({ requestId, result } = {}) {
  const operationResult = result && typeof result === "object" ? result : {};
  const payload = operationResult.result && typeof operationResult.result === "object"
    ? operationResult.result
    : {};
  const presentation = payload.presentation && typeof payload.presentation === "object"
    ? payload.presentation
    : {};
  const template = payload.template && typeof payload.template === "object"
    ? payload.template
    : {};
  const idempotency = operationResult.idempotency && typeof operationResult.idempotency === "object"
    ? operationResult.idempotency
    : {};

  return {
    ok: true,
    requestId: cleanManuscriptText(requestId),
    operation: cleanManuscriptText(operationResult.operation) || "createSermonPresentationFromLookup",
    presentationId: cleanManuscriptText(presentation.presentationId),
    sermonId: cleanManuscriptText(presentation.sermonId),
    title: cleanManuscriptText(presentation.title),
    status: cleanManuscriptText(presentation.status),
    aspectRatio: cleanManuscriptText(presentation.aspectRatio) || "16:9",
    slideCount: Number.isFinite(Number(presentation.slideCount)) ? Number(presentation.slideCount) : 0,
    filename: cleanManuscriptText(presentation.filename),
    downloadUrl: cleanManuscriptText(presentation.downloadUrl),
    downloadUrlExpiresAt: cleanManuscriptText(presentation.downloadUrlExpiresAt),
    templateId: cleanManuscriptText(presentation.templateId || template.templateId),
    templateName: cleanManuscriptText(template.name),
    idempotencyReplayed: idempotency.replayed === true,
    executionId: cleanManuscriptText(idempotency.executionId)
  };
}

function buildDirectSermonPresentationActionError(operationError = {}) {
  const error = operationError.error && typeof operationError.error === "object"
    ? operationError.error
    : {};

  return {
    ok: false,
    requestId: cleanManuscriptText(operationError.requestId || error.requestId),
    operation: cleanManuscriptText(operationError.operation) || "createSermonPresentationFromLookup",
    errorCode: cleanManuscriptText(error.code) || "sermon_presentation_create_failed",
    errorMessage: cleanManuscriptText(error.message) || "Sermon presentation creation failed",
    errorStatus: Number.isFinite(Number(error.status)) ? Number(error.status) : 500
  };
}

app.post("/sermon-presentations/from-lookup", async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
  const { idempotencyKey, ...operationArguments } = body;
  req.body = {
    operation: "createSermonPresentationFromLookup",
    arguments: operationArguments,
    idempotencyKey
  };
  return handleSermonWorkspaceOperation(req, res, "artifact", {
    formatSuccessResponse: buildDirectSermonPresentationActionResponse,
    formatErrorResponse: buildDirectSermonPresentationActionError
  });
});

app.post("/sermon-workspace/command", async (req, res) => {
  return handleSermonWorkspaceOperation(req, res, "command");
});

app.get("/ministry-planning/operations", (req, res) => {
  const requestId = randomUUID();

  try {
    const result = listMinistryPlanningOperations({
      mode: req.query.mode,
      query: req.query.query,
      limit: req.query.limit
    });
    return res.status(200).json({ ok: true, requestId, ...result });
  } catch (error) {
    console.error("Error listing ministry planning operations:", error);
    return res.status(200).json(buildMinistryPlanningOperationError(error, {
      mode: req.query.mode,
      requestId
    }));
  }
});

async function handleMinistryPlanningOperation(req, res, mode) {
  const requestId = randomUUID();
  const operation = req.body?.operation;
  const operationArguments = req.body?.arguments ?? req.body?.args;
  const idempotencyKey = req.body?.idempotencyKey;
  const startedAtMs = Date.now();
  const argumentKeys = operationArguments && typeof operationArguments === "object" && !Array.isArray(operationArguments)
    ? Object.keys(operationArguments).sort()
    : [];

  res.set("x-request-id", requestId);
  console.log(JSON.stringify({
    event: "ministry_planning_operation_started",
    requestId,
    mode,
    operation: typeof operation === "string" ? operation : "",
    argumentKeys,
    idempotencyProvided: typeof idempotencyKey === "string" && Boolean(idempotencyKey.trim())
  }));

  try {
    const result = await runIdempotentMinistryPlanningOperation(
      { mode, operation, arguments: operationArguments, idempotencyKey },
      getMinistryPlanningDependencies()
    );
    const responseBody = { ok: true, requestId, ...result };
    console.log(JSON.stringify({
      event: "ministry_planning_operation_succeeded",
      requestId,
      mode,
      operation: result.operation,
      durationMs: Date.now() - startedAtMs,
      responseBytes: getMinistryPlanningJsonByteLength(responseBody),
      idempotencyProtected: result.idempotency?.protected === true,
      idempotencyReplayed: result.idempotency?.replayed === true,
      executionId: result.idempotency?.executionId || ""
    }));
    return res.status(200).json(responseBody);
  } catch (error) {
    const responseBody = buildMinistryPlanningOperationError(error, {
      mode,
      operation,
      requestId
    });
    console.error(JSON.stringify({
      event: "ministry_planning_operation_failed",
      requestId,
      mode,
      operation: typeof operation === "string" ? operation : "",
      durationMs: Date.now() - startedAtMs,
      responseBytes: getMinistryPlanningJsonByteLength(responseBody),
      logicalStatus: responseBody.error.status,
      errorCode: responseBody.error.code,
      argumentKeys,
      idempotencyProvided: typeof idempotencyKey === "string" && Boolean(idempotencyKey.trim())
    }));
    return res.status(200).json(responseBody);
  }
}

app.post("/ministry-planning/query", async (req, res) => {
  return handleMinistryPlanningOperation(req, res, "query");
});

app.post("/ministry-planning/command", async (req, res) => {
  return handleMinistryPlanningOperation(req, res, "command");
});

app.get("/product-workspace/operations", (req, res) => {
  const requestId = randomUUID();

  try {
    const result = listProductWorkspaceOperations({
      mode: req.query.mode,
      query: req.query.query,
      limit: req.query.limit
    });

    return res.status(200).json({
      ok: true,
      requestId,
      ...result
    });
  } catch (error) {
    console.error("Error listing product workspace operations:", error);
    return res.status(200).json(
      buildProductWorkspaceOperationError(error, {
        mode: req.query.mode,
        requestId
      })
    );
  }
});

async function handleProductWorkspaceOperation(req, res, mode) {
  const requestId = randomUUID();
  const operation = req.body?.operation;
  const operationArguments = req.body?.arguments ?? req.body?.args;
  const idempotencyKey = req.body?.idempotencyKey;
  const startedAtMs = Date.now();
  const argumentKeys = operationArguments && typeof operationArguments === "object" && !Array.isArray(operationArguments)
    ? Object.keys(operationArguments).sort()
    : [];

  res.set("x-request-id", requestId);
  console.log(JSON.stringify({
    event: "product_workspace_operation_started",
    requestId,
    mode,
    operation: typeof operation === "string" ? operation : "",
    argumentKeys,
    idempotencyProvided: typeof idempotencyKey === "string" && Boolean(idempotencyKey.trim())
  }));

  try {
    const result = await runIdempotentProductWorkspaceOperation(
      {
        mode,
        operation,
        arguments: operationArguments,
        idempotencyKey
      },
      getProductWorkspaceDependencies()
    );
    const responseBody = {
      ok: true,
      requestId,
      ...result
    };
    const durationMs = Date.now() - startedAtMs;
    const responseBytes = getProductJsonByteLength(responseBody);

    console.log(JSON.stringify({
      event: "product_workspace_operation_succeeded",
      requestId,
      mode,
      operation: result.operation,
      durationMs,
      responseBytes,
      idempotencyProtected: result.idempotency?.protected === true,
      idempotencyReplayed: result.idempotency?.replayed === true,
      executionId: result.idempotency?.executionId || ""
    }));

    return res.status(200).json(responseBody);
  } catch (error) {
    const operationError = buildProductWorkspaceOperationError(error, {
      mode,
      operation,
      requestId
    });
    const durationMs = Date.now() - startedAtMs;
    const responseBytes = getProductJsonByteLength(operationError);

    console.error(JSON.stringify({
      event: "product_workspace_operation_failed",
      requestId,
      mode,
      operation: typeof operation === "string" ? operation : "",
      durationMs,
      responseBytes,
      logicalStatus: operationError.error.status,
      errorCode: operationError.error.code,
      argumentKeys,
      idempotencyProvided: typeof idempotencyKey === "string" && Boolean(idempotencyKey.trim())
    }));

    return res.status(200).json(operationError);
  }
}

app.post("/product-workspace/query", async (req, res) => {
  return handleProductWorkspaceOperation(req, res, "query");
});

app.post("/product-workspace/command", async (req, res) => {
  return handleProductWorkspaceOperation(req, res, "command");
});

app.get("/sermon-workspace/capabilities", (_req, res) => {
  return res.status(200).json({
    ok: true,
    maxImportedTextLength: MAX_IMPORTED_TEXT_LENGTH,
    manuscriptModel: SERMON_MANUSCRIPT_MODEL,
    sourceSelectionModel: SERMON_SOURCE_SELECTION_MODEL,
    sourceSelection: {
      compactManifest: true,
      aiAssistedSelection: true,
      deterministicFallback: true,
      selectedSourceHydration: true
    },
    primaryManuscriptPointer: {
      field: "primaryManuscriptSourceId",
      validatesSourceBelongsToSermon: true
    }
  });
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

app.post("/repository/documents/:documentId/provenance/save", async (req, res) => {
  try {
    const result = await saveRepositoryDocumentProvenance(
      {
        documentId: req.params.documentId,
        originalFolderLabel: req.body?.originalFolderLabel,
        binLabel: req.body?.binLabel,
        scanBatchLabel: req.body?.scanBatchLabel,
        sourceLocationNotes: req.body?.sourceLocationNotes
      },
      getRepositoryWorkflowDependencies()
    );

    return res.status(200).json({
      ok: true,
      message: "Repository document provenance saved",
      document: result.document
    });
  } catch (error) {
    console.error("Error saving repository document provenance:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Save failed" });
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

app.post("/songs/active-congregational-pool", async (req, res) => {
  try {
    const result = await buildActiveCongregationalPool(
      req.body || {},
      getSongCatalogDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error building active congregational pool:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "active_pool_failed",
          fallbackMessage: "Active congregational pool build failed"
        })
      );
  }
});

app.post("/music-planning/spreadsheet-refresh", async (req, res) => {
  try {
    const result = await runMusicPlanningSpreadsheetRefresh(req.body || {});

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error refreshing music planning spreadsheet:", error.message || error);
    return res
      .status(getErrorStatusCode(error, 400))
      .json(
        error.details || buildStructuredErrorResponse(error, {
          fallbackCode: "music_planning_spreadsheet_refresh_failed",
          fallbackMessage: "Music planning spreadsheet refresh failed"
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

app.delete("/songs/:songId", async (req, res) => {
  try {
    const result = await deleteSong(
      { songId: req.params.songId },
      getSongCatalogDependencies()
    );

    return res.status(200).json({
      ok: true,
      deleted: result.deleted,
      songId: result.songId,
      hymnalNumber: result.hymnalNumber,
      canonicalTitle: result.canonicalTitle
    });
  } catch (error) {
    console.error("Error deleting song:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "song_delete_failed",
          fallbackMessage: "Song delete failed"
        })
      );
  }
});

app.patch("/songs/:songId/ministry-metadata", async (req, res) => {
  try {
    const result = await updateSongMinistryMetadata(
      {
        songId: req.params.songId,
        changes: req.body?.changes,
        changeReason: req.body?.changeReason,
        changedBy: req.body?.changedBy
      },
      getSongCatalogDependencies()
    );

    return res.status(200).json({
      ok: true,
      songId: result.songId,
      ministryMetadata: result.ministryMetadata,
      auditEntry: result.auditEntry,
      updatedAt: result.updatedAt
    });
  } catch (error) {
    console.error("Error updating song ministry metadata:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "song_metadata_update_failed",
          fallbackMessage: "Song metadata update failed"
        })
      );
  }
});

app.patch("/songs/:songId/identity", async (req, res) => {
  try {
    const result = await updateSongIdentity(
      {
        songId: req.params.songId,
        changes: req.body?.changes,
        changeReason: req.body?.changeReason,
        changedBy: req.body?.changedBy
      },
      getSongCatalogDependencies()
    );

    return res.status(200).json({
      ok: true,
      songId: result.songId,
      canonicalTitle: result.canonicalTitle,
      titleAliases: result.titleAliases,
      normalizedLookupKeys: result.normalizedLookupKeys,
      auditEntry: result.auditEntry,
      updatedAt: result.updatedAt
    });
  } catch (error) {
    console.error("Error updating song identity:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "song_identity_update_failed",
          fallbackMessage: "Song identity update failed"
        })
      );
  }
});

app.post("/services/search", async (req, res) => {
  try {
    const result = await searchServices(
      req.body || {},
      getServiceHistoryDependencies()
    );

    return res.status(200).json({
      ok: true,
      query: result.query,
      count: result.count,
      services: result.services,
      appliedFilters: result.appliedFilters,
      warnings: result.warnings
    });
  } catch (error) {
    console.error("Error searching services:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "service_search_failed",
          fallbackMessage: "Service search failed"
        })
      );
  }
});

app.get("/services/:serviceId", async (req, res) => {
  try {
    const result = await getServiceById(
      { serviceId: req.params.serviceId },
      getServiceHistoryDependencies()
    );

    return res.status(200).json({
      ok: true,
      service: result.service
    });
  } catch (error) {
    console.error("Error fetching service:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "service_fetch_failed",
          fallbackMessage: "Service fetch failed"
        })
      );
  }
});

app.get("/operator/collections", async (_req, res) => {
  return res.status(200).json({
    ok: true,
    ...listOperatorCollections()
  });
});

app.post("/operator/query", async (req, res) => {
  try {
    const result = await queryOperatorDocuments(
      req.body || {},
      getOperatorDataDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error querying operator data:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "operator_query_failed",
          fallbackMessage: "Operator data query failed"
        })
      );
  }
});

app.post("/operator/commit", async (req, res) => {
  try {
    const result = await commitOperatorDataChange(
      req.body || {},
      getOperatorDataDependencies()
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Error committing operator data change:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json(
        buildStructuredErrorResponse(error, {
          fallbackCode: "operator_commit_failed",
          fallbackMessage: "Operator data commit failed"
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
    const { assetType, storagePath, storageKey, assetId } = req.body || {};

    if (
      !isValidSlug(slug) ||
      typeof assetType !== "string" ||
      !assetType.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Missing or invalid required fields" });
    }

    const docRef = productsCollection.doc(slug);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    const product = doc.data() || {};
    const downloadTarget = resolveProductAssetDownloadTarget(product, slug, {
      assetType,
      storagePath,
      storageKey,
      assetId
    });

    const file = storage.bucket(BUCKET_NAME).file(downloadTarget.storagePath);

    const [downloadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000
    });

    return res.status(200).json({
      ok: true,
      slug,
      assetType: downloadTarget.assetType,
      assetId: downloadTarget.asset.assetId,
      filename: downloadTarget.asset.filename,
      storagePath: downloadTarget.storagePath,
      downloadUrl
    });
  } catch (error) {
    console.error("Error generating download URL:", error);
    return res
      .status(getErrorStatusCode(error, 500))
      .json({ ok: false, error: error.message || "Internal server error" });
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
      identifiers,
      marketplace,
      variants,
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

    if (identifiers !== undefined) {
      if (!isPlainObject(identifiers)) {
        return res.status(400).json({ ok: false, error: "Invalid identifiers" });
      }
      const mergedIdentifiers = normalizeIdentifiers(currentProduct.identifiers);
      for (const [key, value] of Object.entries(identifiers)) {
        if (Object.prototype.hasOwnProperty.call(mergedIdentifiers, key)) {
          mergedIdentifiers[key] = typeof value === "string" ? value.trim() : String(value ?? "").trim();
        }
      }
      if (isbn10 !== undefined) mergedIdentifiers.isbn10 = isbn10.trim();
      if (isbn13 !== undefined) mergedIdentifiers.isbn13 = isbn13.trim();
      updates.identifiers = mergedIdentifiers;
      updates.bheSku = updates.identifiers.bheSku || currentProduct.bheSku || "";
      updates.isbn10 = updates.identifiers.isbn10 || updates.isbn10 || currentProduct.isbn10 || "";
      updates.isbn13 = updates.identifiers.isbn13 || updates.isbn13 || currentProduct.isbn13 || "";
    } else if (isbn10 !== undefined || isbn13 !== undefined) {
      const mergedIdentifiers = normalizeIdentifiers(currentProduct.identifiers);
      if (isbn10 !== undefined) mergedIdentifiers.isbn10 = isbn10.trim();
      if (isbn13 !== undefined) mergedIdentifiers.isbn13 = isbn13.trim();
      updates.identifiers = mergedIdentifiers;
    }

    if (marketplace !== undefined) {
      if (!isPlainObject(marketplace)) {
        return res.status(400).json({ ok: false, error: "Invalid marketplace" });
      }
      updates.marketplace = marketplace;
    }

    if (variants !== undefined) {
      if (!Array.isArray(variants) || !variants.every((item) => isPlainObject(item))) {
        return res.status(400).json({ ok: false, error: "Invalid variants" });
      }
      updates.variants = variants;
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
  applyManuscriptSemanticCoverageAudit,
  attachAssetsToProduct,
  buildCanonicalSongsFromCsv,
  buildSongId,
  buildDefaultRepositoryDocumentRecord,
  buildDefaultRepositoryItemRecord,
  buildFileHandoffDiagnosticSummary,
  buildManuscriptDraftContext,
  buildSermonWorkspaceOperationArguments,
  getSermonWorkspaceIdempotencyKey,
  buildDirectSermonPresentationActionError,
  buildDirectSermonPresentationActionResponse,
  buildCanonicalAssetUrl,
  buildPersistedAssetRecord,
  buildProductAssetAttachment,
  buildRequiredManuscriptCoverageItems,
  buildUnresolvedDevelopmentSessionBlockers,
  buildSermonSourceManifestItem,
  buildSpreadsheetRefreshResponse,
  buildSpreadsheetRefreshArgs,
  buildStructuredErrorResponse,
  cleanupRepositoryDocumentOcr,
  createSermonSourceDownload,
  createRepositoryItem,
  createWorkflowError,
  findRegisteredAsset,
  filterSermonSourcesForManuscript,
  getCleanupSourceText,
  getFinalAiCorrectionSourceText,
  getAssetWorkflowDependencies,
  getMinistryPlanningDependencies,
  getOperatorDataDependencies,
  getSongCatalogDependencies,
  getServiceHistoryDependencies,
  getOcrModeForMimeType,
  getRepositoryDocumentById,
  getRepositoryDocumentSourceText,
  getServiceById,
  getRepositoryItemDocuments,
  resolveProductAssetDownloadTarget,
  renderSermonPresentationPptx,
  getRepositoryItemById,
  getRequiredRepositoryItem,
  humanReviewRepositoryDocumentOcr,
  importCanonicalSongsToCollection,
  getRepositoryWorkflowDependencies,
  linkRepositoryItemDocuments,
  listOperatorCollections,
  listRepositoryDocumentsByProvenance,
  looseNormalizeTitle,
  getNormalizationSourceText,
  normalizeRepositoryDocumentOcr,
  normalizePersistedAssetRecord,
  normalizeStoredAssetRecord,
  normalizeSpreadsheetRefreshRequest,
  parseSongCatalogCsv,
  runMusicPlanningSpreadsheetRefresh,
  saveRepositoryDocumentProvenance,
  saveRepositoryItemSummary,
  searchServices,
  searchSongs,
  scoreSermonSourceForFutureManuscript,
  isGeneratedSermonManuscriptSource,
  selectSermonSourcesDeterministically,
  validateManuscriptAssemblyCompliance,
  validateManuscriptDevelopmentCoverage,
  buildActiveCongregationalPool,
  queryOperatorDocuments,
  searchRepositoryDocuments,
  searchRepositoryItems,
  startRepositoryDocumentOcr,
  strictNormalizeTitle,
  deleteSong,
  commitOperatorDataChange,
  getSongById,
  updateSongIdentity,
  updateSongMinistryMetadata,
  uploadRepositoryDocumentsToStorage,
  uploadAssetsToStorage
};
