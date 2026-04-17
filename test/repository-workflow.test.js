const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BHE_API_KEY = process.env.BHE_API_KEY || "test-bhe-key";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key";

const {
  aiCorrectRepositoryDocumentOcr,
  buildDefaultRepositoryDocumentRecord,
  cleanupRepositoryDocumentOcr,
  normalizeRepositoryDocumentOcr,
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
  repositoryDocuments = {}
} = {}) {
  return {
    deps: {
      repositoryDocumentsCollection: new FakeCollection(repositoryDocuments),
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
      aiCorrectionError: ""
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
    aiCorrectionError: ""
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
          aiCorrectionError: ""
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
