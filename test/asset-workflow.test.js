const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BHE_API_KEY = process.env.BHE_API_KEY || "test-bhe-key";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key";

const {
  CHAT_VISIBLE_IMAGES_NOT_ATTACHABLE_ERROR,
  attachAssetsToProduct,
  buildFileHandoffDiagnosticSummary,
  findRegisteredAsset,
  getCleanupSourceText,
  getFinalAiCorrectionSourceText,
  getOcrModeForMimeType,
  getNormalizationSourceText,
  uploadAssetsToStorage
} = require("../index.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeValues(currentValue, nextValue) {
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  if (!isObject(currentValue) || !isObject(nextValue)) {
    return clone(nextValue);
  }

  const merged = { ...clone(currentValue) };

  for (const [key, value] of Object.entries(nextValue)) {
    merged[key] = mergeValues(currentValue[key], value);
  }

  return merged;
}

class FakeDocRef {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }

  async get() {
    return {
      exists: this.store.has(this.id),
      data: () => clone(this.store.get(this.id))
    };
  }

  async set(value) {
    this.store.set(this.id, clone(value));
  }

  async update(updates) {
    const current = this.store.get(this.id);

    if (!current) {
      throw new Error(`Document does not exist: ${this.id}`);
    }

    this.store.set(this.id, mergeValues(current, updates));
  }
}

class FakeCollection {
  constructor(initialRecords = {}) {
    this.store = new Map(Object.entries(clone(initialRecords)));
  }

  doc(id) {
    return new FakeDocRef(this.store, id);
  }
}

class FakeStorage {
  constructor() {
    this.files = new Map();
  }

  bucket() {
    return {
      file: (storageKey) => ({
        save: async (buffer, options = {}) => {
          this.files.set(storageKey, {
            buffer: Buffer.from(buffer),
            contentType: options.contentType || "application/octet-stream"
          });
        }
      })
    };
  }
}

function createDeps(productOverrides = {}) {
  const slug = "sample-product";
  const productsCollection = new FakeCollection({
    [slug]: {
      slug,
      title: "Sample Product",
      subtitle: "Existing subtitle",
      content: {
        shortDescription: "Existing short description"
      },
      assets: {
        sourceFiles: [],
        imagesRaw: [],
        imagesEdited: [],
        exports: []
      },
      ...clone(productOverrides)
    }
  });

  const assetLibraryCollection = new FakeCollection();
  const storage = new FakeStorage();
  const fileBuffer = Buffer.from("fake image bytes");

  return {
    slug,
    deps: {
      productsCollection,
      assetLibraryCollection,
      storage,
      bucketName: "test-bucket",
      fetchImpl: async () => ({
        ok: true,
        arrayBuffer: async () => fileBuffer
      })
    }
  };
}

test("uploadAssetsToStorage persists backend assets without attaching them to the product", async () => {
  const { slug, deps } = createDeps();

  const result = await uploadAssetsToStorage(
    {
      slug,
      assetType: "imagesRaw",
      purpose: "supporting-reference",
      notes: "Reference scan",
      openaiFileIdRefs: [
        {
          name: "reference-scan.jpg",
          mime_type: "image/jpg",
          download_link: "https://files.example/reference-scan.jpg"
        }
      ]
    },
    deps
  );

  assert.equal(result.uploadedCount, 1);
  assert.equal(result.persistedAssets.length, 1);
  assert.ok(result.persistedAssets[0].assetId);
  assert.equal(result.persistedAssets[0].mimeType, "image/jpeg");
  assert.match(result.persistedAssets[0].storageKey, new RegExp(`^products/${slug}/asset-library/`));
  assert.equal(result.persistedAssets[0].canonicalUrl.startsWith("gs://test-bucket/"), true);
  assert.equal(result.persistedAssets[0].byteSize, Buffer.byteLength("fake image bytes"));
  assert.equal(result.persistedAssets[0].checksumSha256.length, 64);

  const savedProduct = (await deps.productsCollection.doc(slug).get()).data();
  assert.equal(savedProduct.assets.imagesRaw.length, 0);
});

test("attachAssetsToProduct attaches a persisted asset to the existing product", async () => {
  const { slug, deps } = createDeps();
  const uploadResult = await uploadAssetsToStorage(
    {
      slug,
      assetType: "imagesRaw",
      purpose: "product-photo",
      openaiFileIdRefs: [
        {
          name: "gallery.jpg",
          mime_type: "image/jpeg",
          download_link: "https://files.example/gallery.jpg"
        }
      ]
    },
    deps
  );

  const assetId = uploadResult.persistedAssets[0].assetId;
  const attachResult = await attachAssetsToProduct(
    {
      slug,
      assetIds: [assetId],
      assetRole: "gallery_image"
    },
    deps
  );

  assert.equal(attachResult.attachedCount, 1);
  assert.equal(attachResult.duplicateAssetIds.length, 0);
  assert.equal(attachResult.attachedAssets[0].assetId, assetId);
  assert.equal(attachResult.attachedAssets[0].assetRole, "gallery_image");

  const savedProduct = (await deps.productsCollection.doc(slug).get()).data();
  assert.equal(savedProduct.assets.imagesRaw.length, 1);
  assert.equal(savedProduct.assets.imagesRaw[0].assetId, assetId);
});

test("attachAssetsToProduct fails clearly when only chat-visible images exist", async () => {
  const { slug, deps } = createDeps();

  await assert.rejects(
    () =>
      attachAssetsToProduct(
        {
          slug,
          chatVisibleImages: [{ chatImageId: "chat-image-1", filename: "visible-only.jpg" }]
        },
        deps
      ),
    (error) => {
      assert.equal(error.message, CHAT_VISIBLE_IMAGES_NOT_ATTACHABLE_ERROR);
      return true;
    }
  );
});

test("attachAssetsToProduct fails when asset IDs are missing", async () => {
  const { slug, deps } = createDeps();

  await assert.rejects(
    () => attachAssetsToProduct({ slug }, deps),
    (error) => {
      assert.equal(
        error.message,
        "Attach failed because one or more backend asset IDs are required."
      );
      return true;
    }
  );
});

test("image-only attach leaves unrelated product fields untouched", async () => {
  const { slug, deps } = createDeps({
    title: "Keep This Title",
    subtitle: "Keep This Subtitle",
    content: {
      shortDescription: "Leave me alone"
    }
  });

  const before = (await deps.productsCollection.doc(slug).get()).data();
  const uploadResult = await uploadAssetsToStorage(
    {
      slug,
      assetType: "imagesRaw",
      purpose: "supporting-reference",
      openaiFileIdRefs: [
        {
          name: "notes.jpg",
          mime_type: "image/jpeg",
          download_link: "https://files.example/notes.jpg"
        }
      ]
    },
    deps
  );

  await attachAssetsToProduct(
    {
      slug,
      assetIds: [uploadResult.persistedAssets[0].assetId],
      assetRole: "reference_scan"
    },
    deps
  );

  const after = (await deps.productsCollection.doc(slug).get()).data();
  assert.equal(after.title, before.title);
  assert.equal(after.subtitle, before.subtitle);
  assert.deepEqual(after.content, before.content);
  assert.equal(after.assets.imagesRaw.length, 1);
});

test("buildFileHandoffDiagnosticSummary reports openai file handoff shape", async () => {
  const summary = buildFileHandoffDiagnosticSummary({
    method: "POST",
    path: "/debug/file-handoff-inspect",
    headers: {
      "content-type": "application/json",
      "content-length": "321",
      "user-agent": "OpenAI/Actions",
      "x-api-key": "secret-key",
      "x-openai-trace-id": "trace-123"
    },
    get(name) {
      return this.headers[name.toLowerCase()] || "";
    },
    body: {
      openaiFileIdRefs: [
        {
          name: "sample.pdf",
          id: "file_123",
          mime_type: "application/pdf",
          download_link: "https://files.example/sample.pdf"
        }
      ],
      note: "debug"
    }
  });

  assert.equal(summary.contentType, "application/json");
  assert.equal(summary.source, "cloud_run_action_payload");
  assert.deepEqual(summary.topLevelBodyKeys, ["openaiFileIdRefs", "note"]);
  assert.equal(summary.openaiFileIdRefsPresent, true);
  assert.equal(summary.openaiFileIdRefsIsArray, true);
  assert.equal(summary.openaiFileIdRefsLength, 1);
  assert.equal(summary.firstElementType, "object");
  assert.deepEqual(summary.firstElementKeys, [
    "name",
    "id",
    "mime_type",
    "download_link"
  ]);
  assert.equal(summary.relevantHeaders["x-api-key"], "[redacted]");
});

test("attached PDF from asset library remains OCR-eligible as a registered source file", async () => {
  const { slug, deps } = createDeps();
  const uploadResult = await uploadAssetsToStorage(
    {
      slug,
      assetType: "sourceFiles",
      purpose: "source-document",
      subtype: "handwritten-notes",
      openaiFileIdRefs: [
        {
          name: "notes.pdf",
          mime_type: "application/pdf",
          download_link: "https://files.example/notes.pdf"
        }
      ]
    },
    deps
  );

  const assetId = uploadResult.persistedAssets[0].assetId;
  const attachResult = await attachAssetsToProduct(
    {
      slug,
      assetIds: [assetId],
      assetRole: "source_note"
    },
    deps
  );

  const savedProduct = (await deps.productsCollection.doc(slug).get()).data();
  const attachedAsset = attachResult.attachedAssets[0];
  const matchingAsset = findRegisteredAsset(
    savedProduct,
    "sourceFiles",
    attachedAsset.storagePath,
    attachedAsset.filename
  );

  assert.ok(matchingAsset);
  assert.equal(attachedAsset.storagePath.includes("/asset-library/"), true);
  assert.equal(attachedAsset.mimeType, "application/pdf");
});

test("getOcrModeForMimeType routes PDFs to the PDF OCR mode", async () => {
  assert.equal(getOcrModeForMimeType("application/pdf"), "document_ai_pdf");
});

test("cleanup prefers the initial AI correction when available", async () => {
  assert.equal(
    getCleanupSourceText({
      extractedText: "raw text",
      aiInitialCorrectedText: "ai first pass"
    }),
    "ai first pass"
  );
});

test("normalization prefers cleaned text, then initial AI text", async () => {
  assert.equal(
    getNormalizationSourceText({
      cleanedText: "cleaned",
      aiInitialCorrectedText: "ai first pass",
      extractedText: "raw"
    }),
    "cleaned"
  );

  assert.equal(
    getNormalizationSourceText({
      cleanedText: "",
      aiInitialCorrectedText: "ai first pass",
      extractedText: "raw"
    }),
    "ai first pass"
  );
});

test("final AI correction prefers normalized text but can fall back to the initial AI text", async () => {
  assert.equal(
    getFinalAiCorrectionSourceText({
      normalizedText: "normalized",
      cleanedText: "cleaned",
      aiInitialCorrectedText: "ai first pass",
      extractedText: "raw"
    }),
    "normalized"
  );

  assert.equal(
    getFinalAiCorrectionSourceText({
      normalizedText: "",
      cleanedText: "",
      aiInitialCorrectedText: "ai first pass",
      extractedText: "raw"
    }),
    "ai first pass"
  );
});
