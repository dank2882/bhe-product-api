const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BHE_API_KEY = process.env.BHE_API_KEY || "test-bhe-key";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key";

const {
  aiCorrectRepositoryDocumentOcr,
  buildDefaultRepositoryDocumentRecord,
  buildDefaultRepositoryItemRecord,
  cleanupRepositoryDocumentOcr,
  createRepositoryItem,
  getRepositoryDocumentById,
  getRepositoryDocumentSourceText,
  getRepositoryItemDocuments,
  getRepositoryItemById,
  linkRepositoryItemDocuments,
  listRepositoryDocumentsByProvenance,
  humanReviewRepositoryDocumentOcr,
  normalizeRepositoryDocumentOcr,
  saveRepositoryItemSummary,
  searchRepositoryDocuments,
  searchRepositoryItems,
  startRepositoryDocumentOcr,
  uploadRepositoryDocumentsToStorage
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

  limit(maxDocs) {
    return {
      get: async () => {
        const docs = Array.from(this.store.entries())
          .slice(0, maxDocs)
          .map(([id, value]) => ({
            id,
            data: () => clone(value)
          }));

        return { docs };
      }
    };
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

function createDeps({
  fileBuffer = Buffer.from("%PDF-1.7 fake pdf bytes"),
  repositoryDocuments = {},
  repositoryItems = {}
} = {}) {
  return {
    deps: {
      repositoryDocumentsCollection: new FakeCollection(repositoryDocuments),
      repositoryItemsCollection: new FakeCollection(repositoryItems),
      storage: new FakeStorage(),
      bucketName: "test-bucket",
      fetchImpl: async () => ({
        ok: true,
        arrayBuffer: async () => fileBuffer
      }),
      runDocumentAiOcr: async () => ({
        extractedText: "Extracted repository text",
        pageCount: 2,
        rawResult: { document: { text: "Extracted repository text", pages: [{}, {}] } }
      }),
      saveJsonFileToStorage: async () => {},
      saveTextFileToStorage: async () => {},
      cleanOcrText: (text) => text,
      normalizeOcrText: (text) => text,
      runAiCorrection: async (text) => text
    }
  };
}

test("buildDefaultRepositoryDocumentRecord applies the v1 repository defaults", () => {
  const record = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-123",
    title: "Research Notes",
    originalFilename: "Research Notes.pdf",
    storagePath: "repository/documents/doc-123-Research-Notes.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/doc-123-Research-Notes.pdf",
    byteSize: 1234,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });

  assert.deepEqual(record, {
    documentId: "doc-123",
    title: "Research Notes",
    originalFilename: "Research Notes.pdf",
    storagePath: "repository/documents/doc-123-Research-Notes.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/doc-123-Research-Notes.pdf",
    byteSize: 1234,
    mimeType: "application/pdf",
    uploadedAt: "2026-04-17T00:00:00.000Z",
    createdAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z",
    uploadedBy: "",
    originalFolderLabel: "",
    binLabel: "",
    scanBatchLabel: "",
    sourceLocationNotes: "",
    documentType: "printed-article",
    reviewStatus: "pending",
    ocr: {
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
    },
    linkedKnowledgeItemIds: []
  });
});

test("uploadRepositoryDocumentsToStorage stores uploaded PDFs and creates repository records", async () => {
  const { deps } = createDeps();

  const result = await uploadRepositoryDocumentsToStorage(
    {
      originalFolderLabel: "Cabinet A",
      binLabel: "Bin 4",
      scanBatchLabel: "April intake",
      sourceLocationNotes: "Top shelf",
      uploadedBy: "daniel@example.com",
      openaiFileIdRefs: [
        {
          name: "Luther Article.pdf",
          mime_type: "application/pdf",
          download_link: "https://files.example/luther-article.pdf"
        }
      ]
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.documents.length, 1);

  const createdDocument = result.documents[0];
  assert.ok(createdDocument.documentId);
  assert.equal(createdDocument.title, "Luther Article");
  assert.equal(createdDocument.originalFilename, "Luther Article.pdf");
  assert.equal(
    createdDocument.canonicalUrl,
    `gs://test-bucket/${createdDocument.storagePath}`
  );
  assert.equal(createdDocument.byteSize, Buffer.byteLength("%PDF-1.7 fake pdf bytes"));
  assert.equal(createdDocument.mimeType, "application/pdf");
  assert.equal(createdDocument.uploadedAt, createdDocument.createdAt);
  assert.equal(createdDocument.updatedAt, createdDocument.createdAt);
  assert.equal(createdDocument.uploadedBy, "daniel@example.com");
  assert.equal(createdDocument.originalFolderLabel, "Cabinet A");
  assert.equal(createdDocument.binLabel, "Bin 4");
  assert.equal(createdDocument.scanBatchLabel, "April intake");
  assert.equal(createdDocument.sourceLocationNotes, "Top shelf");
  assert.equal(createdDocument.reviewStatus, "pending");
  assert.deepEqual(createdDocument.ocr, {
    status: "not_started"
  });
  assert.deepEqual(createdDocument.linkedKnowledgeItemIds, []);
  assert.match(
    createdDocument.storagePath,
    /^repository\/documents\/.+-Luther-Article\.pdf$/
  );

  const savedDocument = (await deps.repositoryDocumentsCollection.doc(createdDocument.documentId).get()).data();
  assert.equal(savedDocument.documentId, createdDocument.documentId);
  assert.equal(savedDocument.storagePath, createdDocument.storagePath);
  assert.equal(savedDocument.canonicalUrl, createdDocument.canonicalUrl);
  assert.equal(savedDocument.byteSize, createdDocument.byteSize);
  assert.equal(savedDocument.createdAt, createdDocument.createdAt);
  assert.equal(savedDocument.updatedAt, createdDocument.updatedAt);
  assert.deepEqual(savedDocument.ocr, {
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
  });

  const storedFile = deps.storage.files.get(createdDocument.storagePath);
  assert.ok(storedFile);
  assert.equal(storedFile.contentType, "application/pdf");
});

test("uploadRepositoryDocumentsToStorage rejects non-PDF files with a clear 400-style error", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () =>
      uploadRepositoryDocumentsToStorage(
        {
          openaiFileIdRefs: [
            {
              name: "photo.jpg",
              mime_type: "image/jpeg",
              download_link: "https://files.example/photo.jpg"
            }
          ]
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(
        error.message,
        "Unsupported repository document type for photo.jpg. Only PDF files are supported."
      );
      return true;
    }
  );
});

test("uploadRepositoryDocumentsToStorage rejects missing backend-downloadable links", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () =>
      uploadRepositoryDocumentsToStorage(
        {
          openaiFileIdRefs: [
            {
              name: "Article.pdf",
              mime_type: "application/pdf"
            }
          ]
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(
        error.message,
        "Each repository file reference must include a backend-downloadable download_link."
      );
      return true;
    }
  );
});

test("buildDefaultRepositoryItemRecord applies the v1 repository item defaults", () => {
  const record = buildDefaultRepositoryItemRecord({
    itemId: "item-123",
    title: "Martin Luther",
    itemType: "person",
    createdAt: "2026-04-17T00:00:00.000Z"
  });

  assert.deepEqual(record, {
    itemId: "item-123",
    title: "Martin Luther",
    itemType: "person",
    canonicalSummary: "",
    linkedDocumentIds: [],
    createdAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z"
  });
});

test("createRepositoryItem stores a repository item with v1 defaults", async () => {
  const { deps } = createDeps();

  const result = await createRepositoryItem(
    {
      title: "Martin Luther",
      itemType: "person"
    },
    deps
  );

  assert.ok(result.item.itemId);
  assert.equal(result.item.title, "Martin Luther");
  assert.equal(result.item.itemType, "person");
  assert.equal(result.item.canonicalSummary, "");
  assert.deepEqual(result.item.linkedDocumentIds, []);
  assert.equal(result.item.createdAt, result.item.updatedAt);

  const savedItem = (await deps.repositoryItemsCollection.doc(result.item.itemId).get()).data();
  assert.deepEqual(savedItem, result.item);
});

test("createRepositoryItem rejects missing title", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () =>
      createRepositoryItem(
        {
          title: "   ",
          itemType: "person"
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Missing or invalid title");
      return true;
    }
  );
});

test("createRepositoryItem rejects invalid itemType", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () =>
      createRepositoryItem(
        {
          title: "Martin Luther",
          itemType: "artifact"
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Invalid itemType");
      return true;
    }
  );
});

test("getRepositoryItemById returns the stored repository item", async () => {
  const itemId = "item-retrieve-1";
  const storedItem = {
    ...buildDefaultRepositoryItemRecord({
      itemId,
      title: "Martin Luther",
      itemType: "person",
      createdAt: "2026-04-17T00:00:00.000Z"
    }),
    canonicalSummary: "Protestant reformer",
    linkedDocumentIds: ["doc-1", "doc-2"]
  };

  const { deps } = createDeps({
    repositoryItems: {
      [itemId]: storedItem
    }
  });

  const result = await getRepositoryItemById({ itemId }, deps);

  assert.deepEqual(result.item, storedItem);
});

test("getRepositoryItemById fails clearly when the repository item does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => getRepositoryItemById({ itemId: "missing-item" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository item not found");
      return true;
    }
  );
});

test("getRepositoryItemById rejects missing or blank itemId", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => getRepositoryItemById({ itemId: "   " }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Missing or invalid itemId");
      return true;
    }
  );
});

test("getRepositoryItemDocuments returns linked repository document summaries in item order", async () => {
  const itemId = "item-documents-1";
  const documentA = {
    ...buildDefaultRepositoryDocumentRecord({
      documentId: "doc-a",
      title: "First Document",
      originalFilename: "first-document.pdf",
      storagePath: "repository/documents/first-document.pdf",
      canonicalUrl: "gs://test-bucket/repository/documents/first-document.pdf",
      byteSize: 100,
      uploadedAt: "2026-04-17T00:00:00.000Z",
      originalFolderLabel: "Cabinet A",
      binLabel: "Bin 1",
      scanBatchLabel: "Batch One"
    }),
    ocr: {
      ...buildDefaultRepositoryDocumentRecord({
        documentId: "tmp",
        title: "",
        originalFilename: "",
        storagePath: ""
      }).ocr,
      status: "completed",
      bestTextSource: "humanReviewedText"
    }
  };
  const documentB = {
    ...buildDefaultRepositoryDocumentRecord({
      documentId: "doc-b",
      title: "Second Document",
      originalFilename: "second-document.pdf",
      storagePath: "repository/documents/second-document.pdf",
      canonicalUrl: "gs://test-bucket/repository/documents/second-document.pdf",
      byteSize: 100,
      uploadedAt: "2026-04-18T00:00:00.000Z",
      originalFolderLabel: "Cabinet B",
      binLabel: "Bin 2",
      scanBatchLabel: "Batch Two"
    }),
    ocr: {
      ...buildDefaultRepositoryDocumentRecord({
        documentId: "tmp",
        title: "",
        originalFilename: "",
        storagePath: ""
      }).ocr,
      status: "processing",
      bestTextSource: "extractedText"
    }
  };
  const item = {
    ...buildDefaultRepositoryItemRecord({
      itemId,
      title: "Linked Item",
      itemType: "topic",
      createdAt: "2026-04-17T00:00:00.000Z"
    }),
    linkedDocumentIds: ["doc-b", "doc-a"]
  };

  const { deps } = createDeps({
    repositoryItems: {
      [itemId]: item
    },
    repositoryDocuments: {
      "doc-a": documentA,
      "doc-b": documentB
    }
  });

  const result = await getRepositoryItemDocuments({ itemId }, deps);

  assert.equal(result.itemId, itemId);
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.documents.map((document) => document.documentId),
    ["doc-b", "doc-a"]
  );
  assert.deepEqual(result.documents[0], {
    documentId: "doc-b",
    title: "Second Document",
    originalFilename: "second-document.pdf",
    originalFolderLabel: "Cabinet B",
    binLabel: "Bin 2",
    scanBatchLabel: "Batch Two",
    uploadedAt: "2026-04-18T00:00:00.000Z",
    reviewStatus: "pending",
    bestTextSource: "extractedText",
    ocrStatus: "processing"
  });
});

test("getRepositoryItemDocuments returns an empty array when an item has no linked documents", async () => {
  const itemId = "item-no-documents";
  const item = buildDefaultRepositoryItemRecord({
    itemId,
    title: "Empty Item",
    itemType: "topic",
    createdAt: "2026-04-17T00:00:00.000Z"
  });

  const { deps } = createDeps({
    repositoryItems: {
      [itemId]: item
    }
  });

  const result = await getRepositoryItemDocuments({ itemId }, deps);

  assert.deepEqual(result, {
    itemId,
    count: 0,
    documents: []
  });
});

test("getRepositoryItemDocuments fails clearly when the repository item does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => getRepositoryItemDocuments({ itemId: "missing-item" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository item not found");
      return true;
    }
  );
});

test("saveRepositoryItemSummary updates canonicalSummary and preserves other item fields", async () => {
  const itemId = "item-summary-1";
  const existingItem = {
    ...buildDefaultRepositoryItemRecord({
      itemId,
      title: "Martin Luther",
      itemType: "person",
      createdAt: "2026-04-17T00:00:00.000Z"
    }),
    linkedDocumentIds: ["doc-1", "doc-2"]
  };

  const { deps } = createDeps({
    repositoryItems: {
      [itemId]: existingItem
    }
  });

  const result = await saveRepositoryItemSummary(
    {
      itemId,
      canonicalSummary: "Major reformer associated with Wittenberg"
    },
    deps
  );

  assert.equal(result.item.itemId, itemId);
  assert.equal(result.item.title, "Martin Luther");
  assert.equal(result.item.itemType, "person");
  assert.equal(result.item.canonicalSummary, "Major reformer associated with Wittenberg");
  assert.deepEqual(result.item.linkedDocumentIds, ["doc-1", "doc-2"]);
  assert.equal(result.item.createdAt, "2026-04-17T00:00:00.000Z");
  assert.ok(result.item.updatedAt);

  const savedItem = (await deps.repositoryItemsCollection.doc(itemId).get()).data();
  assert.equal(savedItem.canonicalSummary, "Major reformer associated with Wittenberg");
  assert.deepEqual(savedItem.linkedDocumentIds, ["doc-1", "doc-2"]);
  assert.equal(savedItem.updatedAt, result.item.updatedAt);
});

test("saveRepositoryItemSummary fails clearly when the repository item does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () =>
      saveRepositoryItemSummary(
        {
          itemId: "missing-item",
          canonicalSummary: "Summary text"
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository item not found");
      return true;
    }
  );
});

test("saveRepositoryItemSummary rejects missing or invalid canonicalSummary", async () => {
  const itemId = "item-summary-invalid";
  const existingItem = buildDefaultRepositoryItemRecord({
    itemId,
    title: "Martin Luther",
    itemType: "person",
    createdAt: "2026-04-17T00:00:00.000Z"
  });

  const { deps } = createDeps({
    repositoryItems: {
      [itemId]: existingItem
    }
  });

  await assert.rejects(
    () =>
      saveRepositoryItemSummary(
        {
          itemId,
          canonicalSummary: "   "
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Missing or invalid canonicalSummary");
      return true;
    }
  );
});

test("linkRepositoryItemDocuments links repository documents to an item on both sides", async () => {
  const itemId = "item-link-1";
  const documentIdA = "doc-link-a";
  const documentIdB = "doc-link-b";
  const item = buildDefaultRepositoryItemRecord({
    itemId,
    title: "Reformation",
    itemType: "topic",
    createdAt: "2026-04-17T00:00:00.000Z"
  });
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: documentIdA,
    title: "Document A",
    originalFilename: "document-a.pdf",
    storagePath: "repository/documents/document-a.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/document-a.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });
  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: documentIdB,
    title: "Document B",
    originalFilename: "document-b.pdf",
    storagePath: "repository/documents/document-b.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/document-b.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });

  const { deps } = createDeps({
    repositoryItems: {
      [itemId]: item
    },
    repositoryDocuments: {
      [documentIdA]: documentA,
      [documentIdB]: documentB
    }
  });

  const result = await linkRepositoryItemDocuments(
    {
      itemId,
      documentIds: [documentIdA, documentIdB]
    },
    deps
  );

  assert.equal(result.itemId, itemId);
  assert.equal(result.linkedCount, 2);
  assert.deepEqual(result.linkedDocumentIds, [documentIdA, documentIdB]);
  assert.deepEqual(result.item.linkedDocumentIds, [documentIdA, documentIdB]);
  assert.ok(result.item.updatedAt);

  const savedItem = (await deps.repositoryItemsCollection.doc(itemId).get()).data();
  assert.deepEqual(savedItem.linkedDocumentIds, [documentIdA, documentIdB]);

  const savedDocumentA = (await deps.repositoryDocumentsCollection.doc(documentIdA).get()).data();
  const savedDocumentB = (await deps.repositoryDocumentsCollection.doc(documentIdB).get()).data();
  assert.deepEqual(savedDocumentA.linkedKnowledgeItemIds, [itemId]);
  assert.deepEqual(savedDocumentB.linkedKnowledgeItemIds, [itemId]);
  assert.equal(savedDocumentA.updatedAt, result.item.updatedAt);
  assert.equal(savedDocumentB.updatedAt, result.item.updatedAt);
});

test("linkRepositoryItemDocuments fails clearly when the repository item does not exist", async () => {
  const documentId = "doc-link-missing-item";
  const document = buildDefaultRepositoryDocumentRecord({
    documentId,
    title: "Document",
    originalFilename: "document.pdf",
    storagePath: "repository/documents/document.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/document.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });
  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: document
    }
  });

  await assert.rejects(
    () =>
      linkRepositoryItemDocuments(
        {
          itemId: "missing-item",
          documentIds: [documentId]
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository item not found");
      return true;
    }
  );
});

test("linkRepositoryItemDocuments fails clearly when a repository document does not exist", async () => {
  const itemId = "item-link-missing-doc";
  const item = buildDefaultRepositoryItemRecord({
    itemId,
    title: "Reformation",
    itemType: "topic",
    createdAt: "2026-04-17T00:00:00.000Z"
  });
  const { deps } = createDeps({
    repositoryItems: {
      [itemId]: item
    }
  });

  await assert.rejects(
    () =>
      linkRepositoryItemDocuments(
        {
          itemId,
          documentIds: ["missing-doc"]
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository document not found");
      return true;
    }
  );
});

test("linkRepositoryItemDocuments avoids duplicate links on both sides", async () => {
  const itemId = "item-link-dedupe";
  const documentId = "doc-link-dedupe";
  const item = {
    ...buildDefaultRepositoryItemRecord({
      itemId,
      title: "Reformation",
      itemType: "topic",
      createdAt: "2026-04-17T00:00:00.000Z"
    }),
    linkedDocumentIds: [documentId]
  };
  const document = {
    ...buildDefaultRepositoryDocumentRecord({
      documentId,
      title: "Document",
      originalFilename: "document.pdf",
      storagePath: "repository/documents/document.pdf",
      canonicalUrl: "gs://test-bucket/repository/documents/document.pdf",
      byteSize: 100,
      uploadedAt: "2026-04-17T00:00:00.000Z"
    }),
    linkedKnowledgeItemIds: [itemId]
  };

  const { deps } = createDeps({
    repositoryItems: {
      [itemId]: item
    },
    repositoryDocuments: {
      [documentId]: document
    }
  });

  const result = await linkRepositoryItemDocuments(
    {
      itemId,
      documentIds: [documentId, documentId]
    },
    deps
  );

  assert.equal(result.linkedCount, 1);
  assert.deepEqual(result.linkedDocumentIds, [documentId]);

  const savedItem = (await deps.repositoryItemsCollection.doc(itemId).get()).data();
  const savedDocument = (await deps.repositoryDocumentsCollection.doc(documentId).get()).data();
  assert.deepEqual(savedItem.linkedDocumentIds, [documentId]);
  assert.deepEqual(savedDocument.linkedKnowledgeItemIds, [itemId]);
});

test("searchRepositoryItems matches title and canonicalSummary", async () => {
  const itemA = {
    ...buildDefaultRepositoryItemRecord({
      itemId: "item-a",
      title: "Martin Luther",
      itemType: "person",
      createdAt: "2026-04-17T00:00:00.000Z"
    }),
    canonicalSummary: "Key figure in the Protestant Reformation",
    linkedDocumentIds: ["doc-1", "doc-2"],
    updatedAt: "2026-04-18T00:00:00.000Z"
  };
  const itemB = {
    ...buildDefaultRepositoryItemRecord({
      itemId: "item-b",
      title: "Wittenberg",
      itemType: "place",
      createdAt: "2026-04-17T00:00:00.000Z"
    }),
    canonicalSummary: "Historic city connected to reform debates",
    linkedDocumentIds: ["doc-3"],
    updatedAt: "2026-04-19T00:00:00.000Z"
  };

  const { deps } = createDeps({
    repositoryItems: {
      "item-a": itemA,
      "item-b": itemB
    }
  });

  const titleResult = await searchRepositoryItems(
    { query: "Martin Luther", limit: 10 },
    deps
  );
  assert.equal(titleResult.query, "martin luther");
  assert.equal(titleResult.count >= 1, true);
  assert.equal(titleResult.results[0].itemId, "item-a");
  assert.equal(titleResult.results[0].linkedDocumentCount, 2);

  const summaryResult = await searchRepositoryItems(
    { query: "historic city reform", limit: 10 },
    deps
  );
  assert.equal(summaryResult.count >= 1, true);
  assert.equal(summaryResult.results[0].itemId, "item-b");
  assert.equal(summaryResult.results[0].canonicalSummary, "Historic city connected to reform debates");
});

test("searchRepositoryItems rejects missing or blank query", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => searchRepositoryItems({ query: "   " }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Missing or invalid query");
      return true;
    }
  );
});

test("searchRepositoryDocuments matches provenance fields and OCR bestText", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-a",
    title: "Luther Pamphlet",
    originalFilename: "luther-pamphlet.pdf",
    storagePath: "repository/documents/doc-a-luther-pamphlet.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/doc-a-luther-pamphlet.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 4",
    scanBatchLabel: "Batch Alpha",
    sourceLocationNotes: "Top shelf"
  });
  documentA.ocr = {
    ...documentA.ocr,
    status: "completed",
    bestText: "Historical notes about Wittenberg and reform movements",
    bestTextSource: "aiCorrectedText"
  };

  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-b",
    title: "Archive Notes",
    originalFilename: "archive-notes.pdf",
    storagePath: "repository/documents/doc-b-archive-notes.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/doc-b-archive-notes.pdf",
    byteSize: 120,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet Z",
    binLabel: "Research Bin",
    scanBatchLabel: "Batch Beta",
    sourceLocationNotes: "Lower shelf"
  });
  documentB.ocr = {
    ...documentB.ocr,
    status: "completed",
    bestText: "General archive overview",
    bestTextSource: "cleanedText"
  };

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-a": documentA,
      "doc-b": documentB
    }
  });

  const provenanceResult = await searchRepositoryDocuments(
    { query: "Batch Alpha", limit: 10 },
    deps
  );
  assert.equal(provenanceResult.query, "batch alpha");
  assert.equal(provenanceResult.count >= 1, true);
  assert.equal(provenanceResult.results[0].documentId, "doc-a");
  assert.equal(provenanceResult.results[0].originalFolderLabel, "Cabinet A");
  assert.equal(provenanceResult.results[0].bestTextSource, "aiCorrectedText");
  assert.equal(provenanceResult.results[0].ocrStatus, "completed");

  const ocrResult = await searchRepositoryDocuments(
    { query: "Wittenberg reform", limit: 10 },
    deps
  );
  assert.equal(ocrResult.count, 1);
  assert.equal(ocrResult.results[0].documentId, "doc-a");
});

test("searchRepositoryDocuments still works with no provenance filters", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-filter-base-a",
    title: "Luther Letter",
    originalFilename: "luther-letter.pdf",
    storagePath: "repository/documents/luther-letter.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/luther-letter.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  documentA.ocr = {
    ...documentA.ocr,
    status: "completed",
    bestText: "Luther text",
    bestTextSource: "extractedText"
  };

  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-filter-base-b",
    title: "Luther Sermon",
    originalFilename: "luther-sermon.pdf",
    storagePath: "repository/documents/luther-sermon.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/luther-sermon.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet B",
    binLabel: "Bin 2",
    scanBatchLabel: "Batch Two"
  });
  documentB.ocr = {
    ...documentB.ocr,
    status: "completed",
    bestText: "More Luther text",
    bestTextSource: "cleanedText"
  };

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-filter-base-a": documentA,
      "doc-filter-base-b": documentB
    }
  });

  const result = await searchRepositoryDocuments(
    { query: "Luther", limit: 10 },
    deps
  );

  assert.equal(result.count, 2);
  assert.deepEqual(
    result.results.map((document) => document.documentId),
    ["doc-filter-base-b", "doc-filter-base-a"]
  );
});

test("searchRepositoryDocuments originalFolderLabel filter restricts results correctly", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-folder-a",
    title: "Letter",
    originalFilename: "letter-a.pdf",
    storagePath: "repository/documents/letter-a.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/letter-a.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  documentA.ocr = { ...documentA.ocr, bestText: "Letter text", status: "completed" };

  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-folder-b",
    title: "Letter",
    originalFilename: "letter-b.pdf",
    storagePath: "repository/documents/letter-b.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/letter-b.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet B",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  documentB.ocr = { ...documentB.ocr, bestText: "Letter text", status: "completed" };

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-folder-a": documentA,
      "doc-folder-b": documentB
    }
  });

  const result = await searchRepositoryDocuments(
    { query: "Letter", originalFolderLabel: "Cabinet A" },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.results[0].documentId, "doc-folder-a");
});

test("searchRepositoryDocuments binLabel filter restricts results correctly", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-bin-a",
    title: "Essay",
    originalFilename: "essay-a.pdf",
    storagePath: "repository/documents/essay-a.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/essay-a.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  documentA.ocr = { ...documentA.ocr, bestText: "Essay text", status: "completed" };

  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-bin-b",
    title: "Essay",
    originalFilename: "essay-b.pdf",
    storagePath: "repository/documents/essay-b.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/essay-b.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 2",
    scanBatchLabel: "Batch One"
  });
  documentB.ocr = { ...documentB.ocr, bestText: "Essay text", status: "completed" };

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-bin-a": documentA,
      "doc-bin-b": documentB
    }
  });

  const result = await searchRepositoryDocuments(
    { query: "Essay", binLabel: "Bin 2" },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.results[0].documentId, "doc-bin-b");
});

test("searchRepositoryDocuments scanBatchLabel filter restricts results correctly", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-batch-a",
    title: "Treatise",
    originalFilename: "treatise-a.pdf",
    storagePath: "repository/documents/treatise-a.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/treatise-a.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  documentA.ocr = { ...documentA.ocr, bestText: "Treatise text", status: "completed" };

  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-batch-b",
    title: "Treatise",
    originalFilename: "treatise-b.pdf",
    storagePath: "repository/documents/treatise-b.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/treatise-b.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch Two"
  });
  documentB.ocr = { ...documentB.ocr, bestText: "Treatise text", status: "completed" };

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-batch-a": documentA,
      "doc-batch-b": documentB
    }
  });

  const result = await searchRepositoryDocuments(
    { query: "Treatise", scanBatchLabel: "Batch Two" },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.results[0].documentId, "doc-batch-b");
});

test("searchRepositoryDocuments blank optional filters do not break existing behavior", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-blank-a",
    title: "Chronicle",
    originalFilename: "chronicle-a.pdf",
    storagePath: "repository/documents/chronicle-a.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/chronicle-a.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  documentA.ocr = { ...documentA.ocr, bestText: "Chronicle text", status: "completed" };

  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-blank-b",
    title: "Chronicle",
    originalFilename: "chronicle-b.pdf",
    storagePath: "repository/documents/chronicle-b.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/chronicle-b.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet B",
    binLabel: "Bin 2",
    scanBatchLabel: "Batch Two"
  });
  documentB.ocr = { ...documentB.ocr, bestText: "Chronicle text", status: "completed" };

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-blank-a": documentA,
      "doc-blank-b": documentB
    }
  });

  const result = await searchRepositoryDocuments(
    {
      query: "Chronicle",
      originalFolderLabel: "   ",
      binLabel: "",
      scanBatchLabel: "   "
    },
    deps
  );

  assert.equal(result.count, 2);
});

test("listRepositoryDocumentsByProvenance lists documents by originalFolderLabel", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-prov-folder-a",
    title: "Alpha",
    originalFilename: "alpha.pdf",
    storagePath: "repository/documents/alpha.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/alpha.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  documentA.ocr = { ...documentA.ocr, status: "completed", bestTextSource: "cleanedText" };
  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-prov-folder-b",
    title: "Beta",
    originalFilename: "beta.pdf",
    storagePath: "repository/documents/beta.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/beta.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet B",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  documentB.ocr = { ...documentB.ocr, status: "processing", bestTextSource: "extractedText" };

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-prov-folder-a": documentA,
      "doc-prov-folder-b": documentB
    }
  });

  const result = await listRepositoryDocumentsByProvenance(
    { originalFolderLabel: "Cabinet A" },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.documents[0].documentId, "doc-prov-folder-a");
});

test("listRepositoryDocumentsByProvenance lists documents by binLabel", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-prov-bin-a",
    title: "Alpha",
    originalFilename: "alpha.pdf",
    storagePath: "repository/documents/alpha.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/alpha.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-prov-bin-b",
    title: "Beta",
    originalFilename: "beta.pdf",
    storagePath: "repository/documents/beta.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/beta.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 2",
    scanBatchLabel: "Batch One"
  });

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-prov-bin-a": documentA,
      "doc-prov-bin-b": documentB
    }
  });

  const result = await listRepositoryDocumentsByProvenance(
    { binLabel: "Bin 2" },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.documents[0].documentId, "doc-prov-bin-b");
});

test("listRepositoryDocumentsByProvenance lists documents by scanBatchLabel", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-prov-batch-a",
    title: "Alpha",
    originalFilename: "alpha.pdf",
    storagePath: "repository/documents/alpha.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/alpha.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-prov-batch-b",
    title: "Beta",
    originalFilename: "beta.pdf",
    storagePath: "repository/documents/beta.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/beta.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch Two"
  });

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-prov-batch-a": documentA,
      "doc-prov-batch-b": documentB
    }
  });

  const result = await listRepositoryDocumentsByProvenance(
    { scanBatchLabel: "Batch Two" },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.documents[0].documentId, "doc-prov-batch-b");
});

test("listRepositoryDocumentsByProvenance combines provenance filters correctly", async () => {
  const documentA = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-prov-combo-a",
    title: "Alpha",
    originalFilename: "alpha.pdf",
    storagePath: "repository/documents/alpha.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/alpha.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 1",
    scanBatchLabel: "Batch One"
  });
  const documentB = buildDefaultRepositoryDocumentRecord({
    documentId: "doc-prov-combo-b",
    title: "Beta",
    originalFilename: "beta.pdf",
    storagePath: "repository/documents/beta.pdf",
    canonicalUrl: "gs://test-bucket/repository/documents/beta.pdf",
    byteSize: 100,
    uploadedAt: "2026-04-18T00:00:00.000Z",
    originalFolderLabel: "Cabinet A",
    binLabel: "Bin 2",
    scanBatchLabel: "Batch One"
  });

  const { deps } = createDeps({
    repositoryDocuments: {
      "doc-prov-combo-a": documentA,
      "doc-prov-combo-b": documentB
    }
  });

  const result = await listRepositoryDocumentsByProvenance(
    {
      originalFolderLabel: "Cabinet A",
      binLabel: "Bin 2"
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.documents[0].documentId, "doc-prov-combo-b");
});

test("listRepositoryDocumentsByProvenance rejects when all provenance filters are missing or blank", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () =>
      listRepositoryDocumentsByProvenance(
        {
          originalFolderLabel: "   ",
          binLabel: "",
          scanBatchLabel: "   "
        },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "At least one provenance filter is required");
      return true;
    }
  );
});

test("searchRepositoryDocuments rejects missing or blank query", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => searchRepositoryDocuments({ query: "   " }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Missing or invalid query");
      return true;
    }
  );
});

test("getRepositoryDocumentById returns the stored repository document", async () => {
  const documentId = "doc-retrieve-1";
  const sourceStoragePath = "repository/documents/doc-retrieve-1-Article.pdf";
  const storedDocument = buildDefaultRepositoryDocumentRecord({
    documentId,
    title: "Retrieved Article",
    originalFilename: "Retrieved Article.pdf",
    storagePath: sourceStoragePath,
    canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
    byteSize: 4321,
    uploadedAt: "2026-04-17T00:00:00.000Z",
    uploadedBy: "reviewer@example.com",
    originalFolderLabel: "Cabinet R",
    binLabel: "Bin 9",
    scanBatchLabel: "Batch Retrieve",
    sourceLocationNotes: "Archive shelf"
  });
  storedDocument.ocr = {
    ...storedDocument.ocr,
    status: "completed",
    bestText: "Retrieved OCR text",
    bestTextSource: "humanReviewedText",
    humanReviewedText: "Retrieved OCR text"
  };

  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: storedDocument
    }
  });

  const result = await getRepositoryDocumentById({ documentId }, deps);

  assert.deepEqual(result.document, storedDocument);
});

test("getRepositoryDocumentById fails clearly when the repository document does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => getRepositoryDocumentById({ documentId: "missing-doc" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository document not found");
      return true;
    }
  );
});

test("getRepositoryDocumentById rejects missing or blank documentId", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => getRepositoryDocumentById({ documentId: "   " }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Missing or invalid documentId");
      return true;
    }
  );
});

test("getRepositoryDocumentSourceText returns the best available repository source text package", async () => {
  const documentId = "doc-source-text-1";
  const sourceStoragePath = "repository/documents/doc-source-text-1-Article.pdf";
  const storedDocument = buildDefaultRepositoryDocumentRecord({
    documentId,
    title: "Source Text Article",
    originalFilename: "Source Text Article.pdf",
    storagePath: sourceStoragePath,
    canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
    byteSize: 4321,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });
  storedDocument.ocr = {
    ...storedDocument.ocr,
    extractedText: "Raw OCR text",
    cleanedText: "Cleaned OCR text",
    normalizedText: "Normalized OCR text",
    aiCorrectedText: "AI-corrected OCR text",
    humanReviewedText: "Human-reviewed OCR text",
    bestText: "Human-reviewed OCR text",
    bestTextSource: "humanReviewedText",
    bestTextUpdatedAt: "2026-04-17T03:00:00.000Z"
  };

  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: storedDocument
    }
  });

  const result = await getRepositoryDocumentSourceText({ documentId }, deps);

  assert.equal(result.documentId, documentId);
  assert.deepEqual(result.sourceText, {
    bestText: "Human-reviewed OCR text",
    bestTextSource: "humanReviewedText",
    bestTextUpdatedAt: "2026-04-17T03:00:00.000Z",
    extractedText: "Raw OCR text",
    cleanedText: "Cleaned OCR text",
    normalizedText: "Normalized OCR text",
    aiCorrectedText: "AI-corrected OCR text",
    humanReviewedText: "Human-reviewed OCR text"
  });
});

test("getRepositoryDocumentSourceText fails clearly when the repository document does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => getRepositoryDocumentSourceText({ documentId: "missing-doc" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository document not found");
      return true;
    }
  );
});

test("getRepositoryDocumentSourceText rejects missing or blank documentId", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => getRepositoryDocumentSourceText({ documentId: "   " }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Missing or invalid documentId");
      return true;
    }
  );
});

test("startRepositoryDocumentOcr saves repository OCR results onto the document", async () => {
  const savedJsonFiles = [];
  const savedTextFiles = [];
  const documentId = "repo-doc-1";
  const sourceStoragePath = "repository/documents/repo-doc-1-Luther-Article.pdf";
  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: buildDefaultRepositoryDocumentRecord({
        documentId,
        title: "Luther Article",
        originalFilename: "Luther Article.pdf",
        storagePath: sourceStoragePath,
        canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
        byteSize: 1234,
        uploadedAt: "2026-04-17T00:00:00.000Z"
      })
    }
  });

  deps.runDocumentAiOcr = async ({ sourceStoragePath: incomingPath, sourceFilename, mimeType }) => {
    assert.equal(incomingPath, sourceStoragePath);
    assert.equal(sourceFilename, "Luther Article.pdf");
    assert.equal(mimeType, "application/pdf");

    return {
      extractedText: "Repository OCR text",
      pageCount: 3,
      rawResult: {
        document: {
          text: "Repository OCR text",
          pages: [{}, {}, {}]
        }
      }
    };
  };
  deps.saveJsonFileToStorage = async (storagePath, jsonValue) => {
    savedJsonFiles.push({ storagePath, jsonValue });
  };
  deps.saveTextFileToStorage = async (storagePath, text) => {
    savedTextFiles.push({ storagePath, text });
  };

  const result = await startRepositoryDocumentOcr({ documentId }, deps);

  assert.equal(result.documentId, documentId);
  assert.equal(result.ocr.status, "completed");
  assert.equal(result.ocr.sourceStoragePath, sourceStoragePath);
  assert.equal(
    result.ocr.rawOutputPath,
    `repository/documents/${documentId}/ocr/raw/Luther-Article.json`
  );
  assert.equal(
    result.ocr.textOutputPath,
    `repository/documents/${documentId}/ocr/text/Luther-Article.txt`
  );
  assert.equal(result.ocr.extractedText, "Repository OCR text");
  assert.equal(result.ocr.pageCount, 3);
  assert.equal(result.ocr.error, "");
  assert.equal(result.ocr.bestText, "Repository OCR text");
  assert.equal(result.ocr.bestTextSource, "extractedText");
  assert.equal(result.ocr.cleanedText, "");
  assert.equal(result.ocr.cleanupStatus, "not_started");
  assert.equal(result.ocr.cleanupProcessedAt, "");
  assert.equal(result.ocr.cleanupError, "");
  assert.equal(result.ocr.normalizedText, "");
  assert.equal(result.ocr.normalizationStatus, "not_started");
  assert.equal(result.ocr.normalizationProcessedAt, "");
  assert.equal(result.ocr.normalizationError, "");
  assert.equal(result.ocr.aiCorrectedText, "");
  assert.equal(result.ocr.aiCorrectionStatus, "not_started");
  assert.equal(result.ocr.aiCorrectionProcessedAt, "");
  assert.equal(result.ocr.aiCorrectionError, "");
  assert.equal(result.ocr.humanReviewedText, "");
  assert.ok(result.ocr.processedAt);
  assert.equal(result.ocr.bestTextUpdatedAt, result.ocr.processedAt);

  assert.equal(savedJsonFiles.length, 1);
  assert.equal(savedJsonFiles[0].storagePath, result.ocr.rawOutputPath);
  assert.equal(savedTextFiles.length, 1);
  assert.equal(savedTextFiles[0].storagePath, result.ocr.textOutputPath);
  assert.equal(savedTextFiles[0].text, "Repository OCR text");

  const savedDocument = (await deps.repositoryDocumentsCollection.doc(documentId).get()).data();
  assert.equal(savedDocument.ocr.status, "completed");
  assert.equal(savedDocument.ocr.bestText, "Repository OCR text");
  assert.equal(savedDocument.updatedAt, result.ocr.processedAt);
});

test("startRepositoryDocumentOcr fails clearly when the repository document does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => startRepositoryDocumentOcr({ documentId: "missing-doc" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository document not found");
      return true;
    }
  );
});

test("startRepositoryDocumentOcr rejects non-PDF repository documents", async () => {
  const documentId = "repo-doc-image";
  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: buildDefaultRepositoryDocumentRecord({
        documentId,
        title: "Photo",
        originalFilename: "Photo.jpg",
        storagePath: "repository/documents/repo-doc-image-Photo.jpg",
        canonicalUrl: "gs://test-bucket/repository/documents/repo-doc-image-Photo.jpg",
        byteSize: 123,
        mimeType: "image/jpeg",
        uploadedAt: "2026-04-17T00:00:00.000Z"
      })
    }
  });

  await assert.rejects(
    () => startRepositoryDocumentOcr({ documentId }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Repository document OCR currently supports PDF files only.");
      return true;
    }
  );
});

test("cleanupRepositoryDocumentOcr saves cleaned repository OCR text and updates bestText", async () => {
  const documentId = "repo-doc-cleanup";
  const sourceStoragePath = "repository/documents/repo-doc-cleanup-Article.pdf";
  const baseDocument = buildDefaultRepositoryDocumentRecord({
    documentId,
    title: "Article",
    originalFilename: "Article.pdf",
    storagePath: sourceStoragePath,
    canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
    byteSize: 1234,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });

  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: {
        ...baseDocument,
        ocr: {
          ...baseDocument.ocr,
          status: "completed",
          sourceStoragePath,
          extractedText: "Line 1   \n\nLine 2",
          pageCount: 2,
          processedAt: "2026-04-17T01:00:00.000Z",
          bestText: "Line 1   \n\nLine 2",
          bestTextSource: "extractedText",
          bestTextUpdatedAt: "2026-04-17T01:00:00.000Z"
        }
      }
    }
  });

  deps.cleanOcrText = (text) => {
    assert.equal(text, "Line 1   \n\nLine 2");
    return "Line 1\n\nLine 2";
  };

  const result = await cleanupRepositoryDocumentOcr({ documentId }, deps);

  assert.equal(result.documentId, documentId);
  assert.equal(result.ocr.cleanupStatus, "completed");
  assert.equal(result.ocr.cleanedText, "Line 1\n\nLine 2");
  assert.ok(result.ocr.cleanupProcessedAt);
  assert.equal(result.ocr.cleanupError, "");
  assert.equal(result.ocr.bestText, "Line 1\n\nLine 2");
  assert.equal(result.ocr.bestTextSource, "cleanedText");
  assert.equal(result.ocr.bestTextUpdatedAt, result.ocr.cleanupProcessedAt);

  const savedDocument = (await deps.repositoryDocumentsCollection.doc(documentId).get()).data();
  assert.equal(savedDocument.ocr.cleanupStatus, "completed");
  assert.equal(savedDocument.ocr.cleanedText, "Line 1\n\nLine 2");
  assert.equal(savedDocument.ocr.bestTextSource, "cleanedText");
  assert.equal(savedDocument.updatedAt, result.ocr.cleanupProcessedAt);
});

test("cleanupRepositoryDocumentOcr fails clearly when the repository document does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => cleanupRepositoryDocumentOcr({ documentId: "missing-doc" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository document not found");
      return true;
    }
  );
});

test("cleanupRepositoryDocumentOcr rejects missing OCR extracted text", async () => {
  const documentId = "repo-doc-no-text";
  const sourceStoragePath = "repository/documents/repo-doc-no-text-Article.pdf";
  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: {
        ...buildDefaultRepositoryDocumentRecord({
          documentId,
          title: "Article",
          originalFilename: "Article.pdf",
          storagePath: sourceStoragePath,
          canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
          byteSize: 1234,
          uploadedAt: "2026-04-17T00:00:00.000Z"
        }),
        ocr: {
          status: "completed",
          sourceStoragePath,
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
        }
      }
    }
  });

  await assert.rejects(
    () => cleanupRepositoryDocumentOcr({ documentId }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "No OCR text available to clean");
      return true;
    }
  );
});

test("humanReviewRepositoryDocumentOcr saves human-reviewed text and promotes it to bestText", async () => {
  const documentId = "repo-doc-human-review";
  const sourceStoragePath = "repository/documents/repo-doc-human-review-Article.pdf";
  const baseDocument = buildDefaultRepositoryDocumentRecord({
    documentId,
    title: "Article",
    originalFilename: "Article.pdf",
    storagePath: sourceStoragePath,
    canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
    byteSize: 1234,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });

  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: {
        ...baseDocument,
        ocr: {
          ...baseDocument.ocr,
          status: "completed",
          sourceStoragePath,
          extractedText: "Raw OCR text",
          cleanedText: "Cleaned OCR text",
          normalizedText: "Normalized OCR text",
          aiCorrectedText: "AI-corrected OCR text",
          cleanupStatus: "completed",
          normalizationStatus: "completed",
          aiCorrectionStatus: "completed",
          bestText: "AI-corrected OCR text",
          bestTextSource: "aiCorrectedText",
          bestTextUpdatedAt: "2026-04-17T02:00:00.000Z"
        }
      }
    }
  });

  const result = await humanReviewRepositoryDocumentOcr(
    { documentId, humanReviewedText: "Manually reviewed final text" },
    deps
  );

  assert.equal(result.documentId, documentId);
  assert.equal(result.ocr.humanReviewedText, "Manually reviewed final text");
  assert.equal(result.ocr.bestText, "Manually reviewed final text");
  assert.equal(result.ocr.bestTextSource, "humanReviewedText");
  assert.ok(result.ocr.bestTextUpdatedAt);
  assert.equal(result.ocr.aiCorrectedText, "AI-corrected OCR text");
  assert.equal(result.ocr.normalizedText, "Normalized OCR text");
  assert.equal(result.ocr.cleanedText, "Cleaned OCR text");

  const savedDocument = (await deps.repositoryDocumentsCollection.doc(documentId).get()).data();
  assert.equal(savedDocument.ocr.humanReviewedText, "Manually reviewed final text");
  assert.equal(savedDocument.ocr.bestTextSource, "humanReviewedText");
  assert.equal(savedDocument.updatedAt, result.ocr.bestTextUpdatedAt);
});

test("humanReviewRepositoryDocumentOcr fails clearly when the repository document does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () =>
      humanReviewRepositoryDocumentOcr(
        { documentId: "missing-doc", humanReviewedText: "Reviewed text" },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository document not found");
      return true;
    }
  );
});

test("humanReviewRepositoryDocumentOcr rejects missing or blank humanReviewedText", async () => {
  const documentId = "repo-doc-no-human-text";
  const sourceStoragePath = "repository/documents/repo-doc-no-human-text-Article.pdf";
  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: buildDefaultRepositoryDocumentRecord({
        documentId,
        title: "Article",
        originalFilename: "Article.pdf",
        storagePath: sourceStoragePath,
        canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
        byteSize: 1234,
        uploadedAt: "2026-04-17T00:00:00.000Z"
      })
    }
  });

  await assert.rejects(
    () =>
      humanReviewRepositoryDocumentOcr(
        { documentId, humanReviewedText: "   " },
        deps
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Missing or invalid humanReviewedText");
      return true;
    }
  );
});

test("aiCorrectRepositoryDocumentOcr saves AI-corrected repository OCR text and updates bestText", async () => {
  const documentId = "repo-doc-ai-correct";
  const sourceStoragePath = "repository/documents/repo-doc-ai-correct-Article.pdf";
  const baseDocument = buildDefaultRepositoryDocumentRecord({
    documentId,
    title: "Article",
    originalFilename: "Article.pdf",
    storagePath: sourceStoragePath,
    canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
    byteSize: 1234,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });

  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: {
        ...baseDocument,
        ocr: {
          ...baseDocument.ocr,
          status: "completed",
          sourceStoragePath,
          extractedText: "Raw OCR text",
          cleanedText: "Cleaned OCR text",
          normalizedText: "Normalized OCR text",
          cleanupStatus: "completed",
          normalizationStatus: "completed",
          pageCount: 2,
          processedAt: "2026-04-17T00:30:00.000Z",
          bestText: "Normalized OCR text",
          bestTextSource: "normalizedText",
          bestTextUpdatedAt: "2026-04-17T01:00:00.000Z"
        }
      }
    }
  });

  deps.runAiCorrection = async (text) => {
    assert.equal(text, "Normalized OCR text");
    return "AI-corrected OCR text";
  };

  const result = await aiCorrectRepositoryDocumentOcr({ documentId }, deps);

  assert.equal(result.documentId, documentId);
  assert.equal(result.ocr.aiCorrectedText, "AI-corrected OCR text");
  assert.equal(result.ocr.aiCorrectionStatus, "completed");
  assert.ok(result.ocr.aiCorrectionProcessedAt);
  assert.equal(result.ocr.aiCorrectionError, "");
  assert.equal(result.ocr.bestText, "AI-corrected OCR text");
  assert.equal(result.ocr.bestTextSource, "aiCorrectedText");
  assert.equal(result.ocr.bestTextUpdatedAt, result.ocr.aiCorrectionProcessedAt);

  const savedDocument = (await deps.repositoryDocumentsCollection.doc(documentId).get()).data();
  assert.equal(savedDocument.ocr.aiCorrectedText, "AI-corrected OCR text");
  assert.equal(savedDocument.ocr.aiCorrectionStatus, "completed");
  assert.equal(savedDocument.ocr.bestTextSource, "aiCorrectedText");
  assert.equal(savedDocument.updatedAt, result.ocr.aiCorrectionProcessedAt);
});

test("aiCorrectRepositoryDocumentOcr fails clearly when the repository document does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => aiCorrectRepositoryDocumentOcr({ documentId: "missing-doc" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository document not found");
      return true;
    }
  );
});

test("aiCorrectRepositoryDocumentOcr rejects missing AI-correction source text", async () => {
  const documentId = "repo-doc-no-ai-text";
  const sourceStoragePath = "repository/documents/repo-doc-no-ai-text-Article.pdf";
  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: {
        ...buildDefaultRepositoryDocumentRecord({
          documentId,
          title: "Article",
          originalFilename: "Article.pdf",
          storagePath: sourceStoragePath,
          canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
          byteSize: 1234,
          uploadedAt: "2026-04-17T00:00:00.000Z"
        }),
        ocr: {
          status: "completed",
          sourceStoragePath,
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
          aiCorrectionError: ""
        }
      }
    }
  });

  await assert.rejects(
    () => aiCorrectRepositoryDocumentOcr({ documentId }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "No OCR text available to AI-correct");
      return true;
    }
  );
});

test("normalizeRepositoryDocumentOcr saves normalized repository OCR text and updates bestText", async () => {
  const documentId = "repo-doc-normalize";
  const sourceStoragePath = "repository/documents/repo-doc-normalize-Article.pdf";
  const baseDocument = buildDefaultRepositoryDocumentRecord({
    documentId,
    title: "Article",
    originalFilename: "Article.pdf",
    storagePath: sourceStoragePath,
    canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
    byteSize: 1234,
    uploadedAt: "2026-04-17T00:00:00.000Z"
  });

  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: {
        ...baseDocument,
        ocr: {
          ...baseDocument.ocr,
          status: "completed",
          sourceStoragePath,
          extractedText: "Raw OCR text",
          cleanedText: "Cleaned OCR text",
          cleanupStatus: "completed",
          cleanupProcessedAt: "2026-04-17T01:00:00.000Z",
          pageCount: 2,
          processedAt: "2026-04-17T00:30:00.000Z",
          bestText: "Cleaned OCR text",
          bestTextSource: "cleanedText",
          bestTextUpdatedAt: "2026-04-17T01:00:00.000Z"
        }
      }
    }
  });

  deps.normalizeOcrText = (text) => {
    assert.equal(text, "Cleaned OCR text");
    return "Normalized OCR text";
  };

  const result = await normalizeRepositoryDocumentOcr({ documentId }, deps);

  assert.equal(result.documentId, documentId);
  assert.equal(result.ocr.normalizedText, "Normalized OCR text");
  assert.equal(result.ocr.normalizationStatus, "completed");
  assert.ok(result.ocr.normalizationProcessedAt);
  assert.equal(result.ocr.normalizationError, "");
  assert.equal(result.ocr.bestText, "Normalized OCR text");
  assert.equal(result.ocr.bestTextSource, "normalizedText");
  assert.equal(result.ocr.bestTextUpdatedAt, result.ocr.normalizationProcessedAt);

  const savedDocument = (await deps.repositoryDocumentsCollection.doc(documentId).get()).data();
  assert.equal(savedDocument.ocr.normalizedText, "Normalized OCR text");
  assert.equal(savedDocument.ocr.normalizationStatus, "completed");
  assert.equal(savedDocument.ocr.bestTextSource, "normalizedText");
  assert.equal(savedDocument.updatedAt, result.ocr.normalizationProcessedAt);
});

test("normalizeRepositoryDocumentOcr fails clearly when the repository document does not exist", async () => {
  const { deps } = createDeps();

  await assert.rejects(
    () => normalizeRepositoryDocumentOcr({ documentId: "missing-doc" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Repository document not found");
      return true;
    }
  );
});

test("normalizeRepositoryDocumentOcr rejects missing normalization source text", async () => {
  const documentId = "repo-doc-no-normalize-text";
  const sourceStoragePath = "repository/documents/repo-doc-no-normalize-text-Article.pdf";
  const { deps } = createDeps({
    repositoryDocuments: {
      [documentId]: {
        ...buildDefaultRepositoryDocumentRecord({
          documentId,
          title: "Article",
          originalFilename: "Article.pdf",
          storagePath: sourceStoragePath,
          canonicalUrl: `gs://test-bucket/${sourceStoragePath}`,
          byteSize: 1234,
          uploadedAt: "2026-04-17T00:00:00.000Z"
        }),
        ocr: {
          status: "completed",
          sourceStoragePath,
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
          normalizationError: ""
        }
      }
    }
  });

  await assert.rejects(
    () => normalizeRepositoryDocumentOcr({ documentId }, deps),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "No OCR text available to normalize");
      return true;
    }
  );
});
