const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BHE_API_KEY = process.env.BHE_API_KEY || "test-bhe-key";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key";

const {
  CHAT_VISIBLE_IMAGES_NOT_ATTACHABLE_ERROR,
  attachAssetsToProduct,
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
