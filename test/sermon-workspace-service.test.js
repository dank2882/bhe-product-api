const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addSermonDevelopmentNote,
  answerSermonQuestion,
  applySermonMaterialPlacementPlan,
  applySermonCanonicalRepair,
  appendSermonContent,
  auditSermonCompleteness,
  auditSermonDevelopmentPreservation,
  buildPreachingPreparationDashboard,
  buildSermonWorkspaceOverview,
  captureSermonDevelopmentTurn,
  createPreachingAnalysis,
  closeSermonDevelopmentSession,
  createSermon,
  createSermonOccasion,
  createSermonFolder,
  createSermonMedia,
  createSermonMediaTranscriptSource,
  createSermonPresentation,
  createSermonPresentationFromLookup,
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
  evaluateSermonReadiness,
  finalizeSermonDevelopmentSession,
  listPreachingAnalyses,
  listSermonDevelopmentCheckpoints,
  listSermonDevelopmentSessions,
  listSermonDevelopmentTurns,
  listSermonFolders,
  listSermonMedia,
  listSermonOccasions,
  listSermonPresentations,
  listSermonPresentationTemplates,
  listSermonSnapshots,
  listSermonSources,
  listSermons,
  migrateLegacySermonOccasions,
  proposeSermonCanonicalRepair,
  proposeSermonMaterialPlacement,
  rebuildSermonChunks,
  resolveSermon,
  reviewSermonMinistryArchive,
  reviewSermonSeriesProgression,
  searchSermonChunks,
  selectSermonForOccasion,
  saveSermonDevelopmentCheckpoint,
  startSermonDevelopmentSession,
  semanticSearchSermonChunks,
  updatePreachingProfile,
  updateSermonMedia,
  updateSermonDevelopmentCheckpointPlacement,
  updateSermonOccasion,
  updateSermonPresentationTemplate,
  updateSermon
} = require("../lib/sermon-workspace-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

  async create(data) {
    if (this.store.has(this.id)) {
      throw new Error("already exists");
    }

    this.store.set(this.id, clone(data));
  }

  async set(data) {
    this.store.set(this.id, clone(data));
  }

  async delete() {
    this.store.delete(this.id);
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
      get: async () => ({
        docs: Array.from(this.store.entries())
          .slice(0, maxDocs)
          .map(([id, data]) => ({
            id,
            data: () => clone(data)
          }))
      })
    };
  }
}

function createDeps({
  folders = {},
  sermons = {},
  sermonSnapshots = {},
  sermonSources = {},
  sermonMedia = {},
  sermonOccasions = {},
  sermonDevelopmentSessions = {},
  sermonDevelopmentTurns = {},
  sermonDevelopmentCheckpoints = {},
  sermonChunks = {},
  sermonPresentationTemplates = {},
  sermonPresentations = {},
  preachingProfiles = {},
  preachingAnalyses = {},
  scriptureNotes = {},
  generateCanonicalRepairProposal = async () => ({ proposedChanges: {} }),
  extractScriptureNotesFromSermon,
  importSermonPresentationTemplatePptx = async () => ({
    originalFilename: "imported-template.pptx",
    storagePath: "sermon-presentation-templates/imported-template.pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sizeBytes: 12345,
    checksumSha256: "a".repeat(64),
    aspectRatio: "16:9",
    theme: {
      name: "Imported Theme",
      fonts: { heading: "Georgia", body: "Arial" },
      colors: {
        background: "112233",
        surface: "223344",
        primary: "D4AF37",
        text: "FFFFFF",
        muted: "CCCCCC",
        accent: "4A8F8F"
      }
    },
    layouts: { title: { titleSize: 50, subtitleSize: 24 } },
    extraction: { backgroundSource: "first_slide" }
  }),
  randomId = "12345678-aaaa-bbbb-cccc-123456789012",
  now = "2026-07-01T17:00:00.000Z"
} = {}) {
  const deps = {
    sermonFoldersCollection: new FakeCollection(folders),
    sermonsCollection: new FakeCollection(sermons),
    sermonSnapshotsCollection: new FakeCollection(sermonSnapshots),
    sermonSourcesCollection: new FakeCollection(sermonSources),
    sermonMediaCollection: new FakeCollection(sermonMedia),
    sermonOccasionsCollection: new FakeCollection(sermonOccasions),
    sermonDevelopmentSessionsCollection: new FakeCollection(sermonDevelopmentSessions),
    sermonDevelopmentTurnsCollection: new FakeCollection(sermonDevelopmentTurns),
    sermonDevelopmentCheckpointsCollection: new FakeCollection(sermonDevelopmentCheckpoints),
    sermonChunksCollection: new FakeCollection(sermonChunks),
    sermonPresentationTemplatesCollection: new FakeCollection(sermonPresentationTemplates),
    sermonPresentationsCollection: new FakeCollection(sermonPresentations),
    preachingProfilesCollection: new FakeCollection(preachingProfiles),
    preachingAnalysesCollection: new FakeCollection(preachingAnalyses),
    scriptureNotesCollection: new FakeCollection(scriptureNotes),
    generateCanonicalRepairProposal,
    importSermonPresentationTemplatePptx,
    renderSermonPresentationPptx: async () => Buffer.from("pptx"),
    uploadSermonPresentationPptx: async ({ sermonId, presentationId, title, buffer }) => ({
      filename: `${title || presentationId}.pptx`,
      storagePath: `sermon-presentations/${sermonId}/${presentationId}.pptx`,
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: buffer.length,
      downloadUrl: `https://example.test/${presentationId}.pptx`,
      expiresAt: "2026-07-08T17:00:00.000Z"
    }),
    randomUUID: () => randomId,
    now: () => now
  };
  if (typeof extractScriptureNotesFromSermon === "function") {
    deps.extractScriptureNotesFromSermon = extractScriptureNotesFromSermon;
  }
  return deps;
}

test("creates and lists sermon folders", async () => {
  const deps = createDeps();

  const created = await createSermonFolder(
    {
      name: "Philippians",
      folderType: "series",
      scriptureScope: "Philippians"
    },
    deps
  );

  assert.equal(created.folder.folderId, "folder-philippians-12345678");
  assert.equal(created.folder.folderType, "series");

  const listed = await listSermonFolders({ folderType: "series" }, deps);
  assert.equal(listed.count, 1);
  assert.equal(listed.folders[0].name, "Philippians");
});

test("reuses likely duplicate sermon series folders", async () => {
  const deps = createDeps({
    folders: {
      "folder-james-living-our-faith": {
        folderId: "folder-james-living-our-faith",
        name: "James — Living Our Faith",
        folderType: "series",
        status: "active",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const result = await createSermonFolder(
    {
      name: "James: Living Your Faith",
      folderType: "series",
      status: "active"
    },
    deps
  );

  assert.equal(result.action, "existing");
  assert.equal(result.matchedBy, "folder_name_signature");
  assert.equal(result.folder.folderId, "folder-james-living-our-faith");

  const listed = await listSermonFolders({ query: "James", limit: 10 }, deps);
  assert.equal(listed.count, 1);
});

test("creates, finds, and updates a sermon", async () => {
  const deps = createDeps({
    folders: {
      "folder-philippians": {
        folderId: "folder-philippians",
        name: "Philippians",
        folderType: "series",
        status: "active",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const created = await createSermon(
    {
      title: "The Mind of Christ",
      folderId: "folder-philippians",
      scriptureText: "Philippians 2:1-11",
      bigIdea: "Christlike humility is the pattern for church unity.",
      status: "developing"
    },
    deps
  );

  assert.equal(created.sermon.sermonId, "sermon-the-mind-of-christ-12345678");
  assert.equal(created.sermon.status, "developing");

  const search = await listSermons({ query: "humility" }, deps);
  assert.equal(search.count, 1);

  const updated = await updateSermon(
    {
      sermonId: created.sermon.sermonId,
      changes: {
        outline: "1. Consolation in Christ\n2. Lowliness of mind\n3. The example of Christ"
      }
    },
    deps
  );

  assert.match(updated.sermon.outline, /example of Christ/);
  assert.equal(updated.snapshot.sermonId, created.sermon.sermonId);
});

test("automatically extracts Scripture notes when a sermon first becomes ready", async () => {
  const calls = [];
  const deps = createDeps({
    sermons: {
      "sermon-ready-milestone": {
        sermonId: "sermon-ready-milestone",
        title: "Living Faith",
        status: "draft",
        scriptureText: "James 2:14-26",
        updatedAt: "2026-07-10T17:00:00.000Z"
      }
    },
    extractScriptureNotesFromSermon: async (input) => {
      calls.push(input);
      return { action: "imported", import: { createdNoteCount: 2 } };
    }
  });

  const result = await updateSermon({
    sermonId: "sermon-ready-milestone",
    changes: { status: "ready" }
  }, deps);

  assert.equal(calls.length, 1, JSON.stringify({
    status: result.sermon.status,
    extraction: result.scriptureNoteExtraction,
    extractorType: typeof deps.extractScriptureNotesFromSermon
  }));
  assert.equal(calls[0].sermonId, "sermon-ready-milestone");
  assert.equal(result.scriptureNoteExtraction.action, "imported");
});

test("creates sermon hubs with series metadata instead of requiring folders", async () => {
  const deps = createDeps();

  const created = await createSermon(
    {
      title: "Mercy That Shapes, Fills, and Flows",
      seriesTitle: "James — Living Our Faith",
      seriesNumber: 11,
      tags: ["mercy", "james"],
      scriptureText: "James 2:13",
      status: "developing"
    },
    deps
  );

  assert.equal(created.sermon.folderId, "");
  assert.equal(created.sermon.seriesId, "series-james-living-our-faith");
  assert.equal(created.sermon.seriesSlug, "james-living-our-faith");
  assert.equal(created.sermon.seriesNumber, 11);

  const bySeries = await listSermons({ seriesSlug: "james-living-our-faith" }, deps);
  assert.equal(bySeries.count, 1);
  assert.equal(bySeries.sermons[0].sermonId, created.sermon.sermonId);
  assert.equal(Object.prototype.hasOwnProperty.call(bySeries.sermons[0], "notes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bySeries.sermons[0], "outline"), false);

  const byTag = await listSermons({ tag: "mercy" }, deps);
  assert.equal(byTag.count, 1);
});

test("reviews sermon series progression without guessing beyond the next textual start", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-james-8": {
        sermonId: "sermon-james-8",
        title: "The Sin of Partiality",
        status: "preached",
        scriptureText: "James 2:1-9",
        seriesId: "series-james-living-our-faith",
        seriesTitle: "James - Living Our Faith",
        seriesSlug: "james-living-our-faith",
        seriesNumber: 8,
        preachedDate: "2026-06-21"
      },
      "sermon-james-10": {
        sermonId: "sermon-james-10",
        title: "Mercy Rejoiceth Against Judgment",
        status: "preached",
        scriptureText: "James 2:10-13",
        bigIdea: "Received mercy must shape how believers treat others.",
        seriesId: "series-james-living-our-faith",
        seriesTitle: "James - Living Our Faith",
        seriesSlug: "james-living-our-faith",
        seriesNumber: 10,
        preachedDate: "2026-06-28"
      },
      "sermon-james-11": {
        sermonId: "sermon-james-11",
        title: "Mercy in Action",
        status: "developing",
        seriesId: "series-james-living-our-faith",
        seriesTitle: "James - Living Our Faith",
        seriesSlug: "james-living-our-faith",
        seriesNumber: 11,
        targetDate: "2026-07-12"
      }
    }
  });

  const review = await reviewSermonSeriesProgression({
    seriesSlug: "james-living-our-faith"
  }, deps);

  assert.equal(review.series.sermonCount, 3);
  assert.equal(review.lastCompleted.sermonId, "sermon-james-10");
  assert.equal(review.nextPlanned.sermonId, "sermon-james-11");
  assert.equal(review.suggestedNextStart.reference, "James 2:14");
  assert.equal(review.suggestedNextStart.confidence, "mechanical_sequence_only");
  assert.deepEqual(review.missingSeriesNumbers, [9]);
  assert.ok(review.recurringThemes.some(({ term }) => term === "mercy"));
  assert.ok(review.recommendations.some((recommendation) => /scriptureText/.test(recommendation)));
});

test("reviews a ministry archive from canonical tags and requires sermon-text evidence", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-class-history": {
        sermonId: "sermon-class-history",
        title: "Life Builders Class - Prioritizing Life",
        status: "preached",
        tags: ["life-builders", "life-builders-class"],
        preachedDate: "2015-08-23",
        occasion: "Life Builder's Retreat"
      },
      "sermon-class-current": {
        sermonId: "sermon-class-current",
        title: "Life Builders - Tonight",
        status: "developing",
        tags: ["life-builders", "life-builders-class"]
      },
      "sermon-retreat": {
        sermonId: "sermon-retreat",
        title: "Life Builders Retreat - Time Management",
        status: "preached",
        tags: ["life-builders", "life-builders-retreat"]
      }
    }
  });
  deps.embeddingModel = "test-embedding-model";
  deps.embedText = async () => [0.1, 0.2, 0.3];
  deps.findNearestChunks = async () => [
    {
      id: "chunk-class-history",
      data: {
        chunkId: "chunk-class-history",
        sermonId: "sermon-class-history",
        tags: [],
        sourceKind: "source",
        chunkType: "source_logos_export_material",
        title: "Prioritizing Life",
        text: "Biblical priorities require believers to distinguish the urgent from the important.",
        vectorDistance: 0.1
      }
    },
    {
      id: "chunk-retreat",
      data: {
        chunkId: "chunk-retreat",
        sermonId: "sermon-retreat",
        tags: ["life-builders-retreat"],
        sourceKind: "source",
        chunkType: "source_logos_export_material",
        title: "Time Management",
        text: "Use time wisely.",
        vectorDistance: 0.2
      }
    }
  ];

  const review = await reviewSermonMinistryArchive({
    tag: "life-builders-class",
    excludeTags: ["life-builders-retreat"],
    semanticQuery: "Recurring applications and underdeveloped directions",
    semanticLimit: 10
  }, deps);

  assert.deepEqual(review.counts, {
    matchedByCanonicalTag: 2,
    excludedByCanonicalTag: 0,
    selected: 2,
    historical: 1,
    current: 1,
    legacyMetadataConflicts: 1
  });
  assert.equal(review.legacyMetadataConflicts[0].resolution, "retained_by_canonical_tag");
  assert.equal(review.semanticEvidence.chunkCount, 1);
  assert.equal(review.semanticEvidence.chunks[0].sermonId, "sermon-class-history");
  assert.equal(review.recommendationReadiness.ready, true);
  assert.equal(review.recommendationReadiness.retrievedEvidenceSermonCount, 1);

  const metadataOnly = await reviewSermonMinistryArchive({
    tag: "life-builders-class",
    excludeTags: ["life-builders-retreat"]
  }, deps);
  assert.equal(metadataOnly.recommendationReadiness.ready, false);
  assert.match(metadataOnly.recommendationReadiness.reason, /Metadata and titles alone/);
});

test("filters and sorts sermons by preaching dates, target dates, occasion, and passage", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-living-free": {
        sermonId: "sermon-living-free",
        title: "Living Free",
        status: "preached",
        scriptureText: "John 8:31-36",
        preachedDate: "2025-10-12",
        occasion: "Faith Baptist Church Sunday Evening",
        updatedAt: "2025-10-13T01:00:00.000Z"
      },
      "sermon-freedom-ahead": {
        sermonId: "sermon-freedom-ahead",
        title: "Freedom Ahead",
        status: "ready",
        scriptureText: "Galatians 5:1",
        targetDate: "2025-10-19",
        occasion: "Faith Baptist Church Sunday Morning",
        updatedAt: "2025-10-10T01:00:00.000Z"
      },
      "sermon-outside-range": {
        sermonId: "sermon-outside-range",
        title: "Dates on Either Side",
        status: "preached",
        preachedDate: "2025-01-01",
        targetDate: "2025-12-31",
        updatedAt: "2025-10-09T01:00:00.000Z"
      }
    }
  });

  const exact = await listSermons({ date: "2025-10-12" }, deps);
  assert.deepEqual(exact.sermons.map(({ sermonId }) => sermonId), ["sermon-living-free"]);

  const filtered = await listSermons({
    dateFrom: "2025-10-01",
    dateTo: "2025-10-31",
    occasion: "Sunday",
    scriptureText: "John 8"
  }, deps);
  assert.deepEqual(filtered.sermons.map(({ sermonId }) => sermonId), ["sermon-living-free"]);

  const sorted = await listSermons({ sort: "date_desc" }, deps);
  assert.deepEqual(sorted.sermons.map(({ sermonId }) => sermonId), [
    "sermon-freedom-ahead",
    "sermon-living-free",
    "sermon-outside-range"
  ]);

  await assert.rejects(
    () => listSermons({ dateFrom: "2025-11-01", dateTo: "2025-10-01" }, deps),
    (error) => error.code === "invalid_sermon_date_range"
  );
});

test("stores multiple preaching occasions and prioritizes the nearest upcoming service", async () => {
  const deps = createDeps({
    now: "2026-07-01T17:00:00.000Z",
    sermons: {
      "sermon-repeated": {
        sermonId: "sermon-repeated",
        title: "Grace for the Journey",
        status: "ready",
        scriptureText: "2 Corinthians 12:9",
        updatedAt: "2026-06-30T17:00:00.000Z"
      },
      "sermon-next": {
        sermonId: "sermon-next",
        title: "The Near Service",
        status: "developing",
        updatedAt: "2026-06-29T17:00:00.000Z"
      }
    },
    sermonOccasions: {
      "occasion-past": {
        occasionId: "occasion-past",
        sermonId: "sermon-repeated",
        status: "preached",
        date: "2026-06-01",
        time: "10:00",
        timeZone: "America/Los_Angeles",
        venue: "Faith Baptist Church",
        service: "Sunday Morning"
      },
      "occasion-future": {
        occasionId: "occasion-future",
        sermonId: "sermon-repeated",
        status: "planned",
        date: "2026-07-12",
        time: "19:00",
        timeZone: "America/Los_Angeles",
        venue: "Tacoma Rescue Mission",
        service: "Evening Chapel"
      },
      "occasion-next": {
        occasionId: "occasion-next",
        sermonId: "sermon-next",
        status: "planned",
        date: "2026-07-05",
        time: "10:30",
        timeZone: "America/Los_Angeles",
        venue: "Faith Baptist Church",
        service: "Sunday Morning"
      }
    }
  });

  const upcoming = await listSermons({ upcomingOnly: true }, deps);
  assert.deepEqual(upcoming.sermons.map(({ sermonId }) => sermonId), ["sermon-next", "sermon-repeated"]);
  assert.equal(upcoming.sermons[1].occasionCount, 2);
  assert.equal(upcoming.sermons[1].nextOccasion.venue, "Tacoma Rescue Mission");

  const byVenue = await listSermons({ venue: "Rescue Mission" }, deps);
  assert.deepEqual(byVenue.sermons.map(({ sermonId }) => sermonId), ["sermon-repeated"]);

  const historical = await listSermons({ preachedDate: "2026-06-01" }, deps);
  assert.deepEqual(historical.sermons.map(({ sermonId }) => sermonId), ["sermon-repeated"]);

  const occasions = await listSermonOccasions({ sermonId: "sermon-repeated" }, deps);
  assert.equal(occasions.count, 2);
  assert.deepEqual(occasions.occasions.map(({ status }) => status), ["preached", "planned"]);
});

test("treats structured occasion status as authoritative for upcoming sermons", async () => {
  const deps = createDeps({
    now: "2026-07-01T17:00:00.000Z",
    sermons: {
      "sermon-cancelled-slot": {
        sermonId: "sermon-cancelled-slot",
        title: "Cancelled Placeholder",
        status: "developing",
        targetDate: "2026-07-12"
      },
      "sermon-legacy-slot": {
        sermonId: "sermon-legacy-slot",
        title: "Legacy Upcoming Sermon",
        status: "developing",
        targetDate: "2026-07-12"
      },
      "sermon-archived-slot": {
        sermonId: "sermon-archived-slot",
        title: "Archived Placeholder",
        status: "archived",
        targetDate: "2026-07-12"
      }
    },
    sermonOccasions: {
      "occasion-cancelled": {
        occasionId: "occasion-cancelled",
        sermonId: "sermon-cancelled-slot",
        status: "cancelled",
        date: "2026-07-12",
        time: "11:00",
        timeZone: "America/Los_Angeles"
      }
    }
  });

  const upcoming = await listSermons({ upcomingOnly: true }, deps);
  assert.deepEqual(upcoming.sermons.map(({ sermonId }) => sermonId), ["sermon-legacy-slot"]);
});

test("creates and updates preaching occasions while preserving compatibility fields", async () => {
  const deps = createDeps({
    now: "2026-07-01T17:00:00.000Z",
    sermons: {
      "sermon-scheduled": {
        sermonId: "sermon-scheduled",
        title: "Scheduled Sermon",
        status: "developing",
        createdAt: "2026-06-01T17:00:00.000Z",
        updatedAt: "2026-06-01T17:00:00.000Z"
      }
    }
  });

  const created = await createSermonOccasion({
    sermonId: "sermon-scheduled",
    date: "2026-07-12",
    time: "7:00 pm",
    venue: "Faith Baptist Church",
    service: "Sunday Evening",
    status: "planned"
  }, deps);

  assert.equal(created.occasion.time, "19:00");
  assert.equal(created.sermon.targetDate, "2026-07-12");
  assert.match(created.sermon.occasion, /Faith Baptist Church/);

  const updated = await updateSermonOccasion({
    occasionId: created.occasion.occasionId,
    changes: { status: "preached" }
  }, deps);
  assert.equal(updated.occasion.status, "preached");
  assert.equal(updated.sermon.preachedDate, "2026-07-12");
  assert.equal(updated.sermon.latestPreachedOccasion.occasionId, created.occasion.occasionId);
});

test("promotes a scheduled placeholder into a numbered series sermon without losing its occasion", async () => {
  const deps = createDeps({
    now: "2026-07-11T17:00:00.000Z",
    sermons: {
      "sermon-sunday-night-placeholder": {
        sermonId: "sermon-sunday-night-placeholder",
        title: "Sunday Night - July 12, 2026",
        status: "developing",
        targetDate: "2026-07-12",
        createdAt: "2026-07-01T17:00:00.000Z",
        updatedAt: "2026-07-01T17:00:00.000Z"
      }
    },
    sermonOccasions: {
      "occasion-sunday-night": {
        occasionId: "occasion-sunday-night",
        sermonId: "sermon-sunday-night-placeholder",
        status: "planned",
        date: "2026-07-12",
        time: "18:00",
        timeZone: "America/Los_Angeles",
        venue: "Faith Baptist Church, Tacoma",
        service: "Sunday Night"
      }
    }
  });

  const result = await selectSermonForOccasion({
    occasionId: "occasion-sunday-night",
    expectedCurrentSermonId: "sermon-sunday-night-placeholder",
    title: "Living Faith",
    status: "developing",
    scriptureText: "James 2:14-26",
    seriesId: "series-james-living-our-faith",
    seriesTitle: "James - Living Our Faith",
    seriesSlug: "james-living-our-faith",
    seriesNumber: 12,
    tags: ["james", "living-faith"],
    confirmed: true
  }, deps);

  assert.equal(result.action, "promoted_placeholder");
  assert.equal(result.sermon.sermonId, "sermon-sunday-night-placeholder");
  assert.equal(result.sermon.title, "Living Faith");
  assert.equal(result.sermon.seriesId, "series-james-living-our-faith");
  assert.equal(result.sermon.seriesNumber, 12);
  assert.equal(result.sermon.nextOccasion.occasionId, "occasion-sunday-night");
  assert.equal(result.sermon.nextOccasion.time, "18:00");
  assert.equal(deps.sermonSnapshotsCollection.store.size, 1);
});

test("moves a placeholder occasion to an existing sermon and archives the empty placeholder", async () => {
  const deps = createDeps({
    now: "2026-07-11T17:00:00.000Z",
    sermons: {
      "sermon-placeholder": {
        sermonId: "sermon-placeholder",
        title: "Sunday Night - July 12, 2026",
        status: "developing",
        targetDate: "2026-07-12",
        updatedAt: "2026-07-01T17:00:00.000Z"
      },
      "sermon-existing": {
        sermonId: "sermon-existing",
        title: "Fruit of the Christian Life",
        status: "draft",
        scriptureText: "John 15",
        updatedAt: "2026-07-02T17:00:00.000Z"
      }
    },
    sermonOccasions: {
      "occasion-slot": {
        occasionId: "occasion-slot",
        sermonId: "sermon-placeholder",
        status: "planned",
        date: "2026-07-12",
        time: "18:00",
        timeZone: "America/Los_Angeles",
        venue: "Faith Baptist Church, Tacoma",
        service: "Sunday Night"
      }
    }
  });

  const result = await selectSermonForOccasion({
    occasionId: "occasion-slot",
    targetSermonId: "sermon-existing",
    confirmed: true
  }, deps);

  assert.equal(result.action, "assigned_existing_sermon");
  assert.equal(result.occasion.sermonId, "sermon-existing");
  assert.equal(result.sermon.nextOccasion.occasionId, "occasion-slot");
  assert.equal(result.replacedPlaceholder.status, "archived");
  assert.equal(result.placeholderArchived, true);
});

test("refuses to replace a substantive scheduled sermon as though it were a placeholder", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-real": {
        sermonId: "sermon-real",
        title: "Season in Egypt",
        status: "developing",
        scriptureText: "Exodus 1-2",
        outline: "1. God declared the season",
        updatedAt: "2026-07-01T17:00:00.000Z"
      }
    },
    sermonOccasions: {
      "occasion-real": {
        occasionId: "occasion-real",
        sermonId: "sermon-real",
        status: "planned",
        date: "2026-07-12",
        time: "11:00",
        timeZone: "America/Los_Angeles",
        service: "Sunday Morning"
      }
    }
  });

  await assert.rejects(
    () => selectSermonForOccasion({
      occasionId: "occasion-real",
      title: "Replacement",
      confirmed: true
    }, deps),
    { code: "scheduled_sermon_not_placeholder" }
  );
});

test("builds one preaching dashboard in schedule order with placeholders prioritized", async () => {
  const deps = createDeps({
    now: "2026-07-11T17:00:00.000Z",
    sermons: {
      "sermon-school": {
        sermonId: "sermon-school",
        title: "From Me to We",
        status: "draft",
        scriptureText: "Ephesians 4:29",
        bigIdea: "Words should build others up.",
        outline: "1. Listen\n2. Speak\n3. Confirm",
        notes: "Application: speak with grace."
      },
      "sermon-morning": {
        sermonId: "sermon-morning",
        title: "Season in Egypt",
        status: "developing",
        scriptureText: "Exodus 1-2",
        bigIdea: "God is present in hard seasons.",
        outline: "1. Declared\n2. Experienced\n3. Responded",
        notes: "Application: keep looking to God."
      },
      "sermon-night": {
        sermonId: "sermon-night",
        title: "Sunday Night - July 12, 2026",
        status: "developing"
      }
    },
    sermonOccasions: {
      "occasion-school": {
        occasionId: "occasion-school",
        sermonId: "sermon-school",
        status: "planned",
        date: "2026-07-12",
        time: "10:00",
        timeZone: "America/Los_Angeles",
        service: "Sunday School"
      },
      "occasion-morning": {
        occasionId: "occasion-morning",
        sermonId: "sermon-morning",
        status: "planned",
        date: "2026-07-12",
        time: "11:00",
        timeZone: "America/Los_Angeles",
        service: "Sunday Morning"
      },
      "occasion-night": {
        occasionId: "occasion-night",
        sermonId: "sermon-night",
        status: "planned",
        date: "2026-07-12",
        time: "18:00",
        timeZone: "America/Los_Angeles",
        service: "Sunday Night"
      }
    }
  });

  const dashboard = await buildPreachingPreparationDashboard({
    date: "2026-07-12",
    limit: 10
  }, deps);

  assert.deepEqual(
    dashboard.schedule.map((item) => item.occasion.time),
    ["10:00", "11:00", "18:00"]
  );
  assert.equal(dashboard.summary.upcomingCount, 3);
  assert.equal(dashboard.summary.placeholderCount, 1);
  assert.equal(dashboard.priority[0].sermon.sermonId, "sermon-night");
  assert.equal(dashboard.bestNextAction.occasionId, "occasion-night");
  assert.equal(dashboard.bestNextAction.placeholder, true);
  assert.deepEqual(dashboard.dataProvenance, {
    sourceOfTruth: "firestore",
    accessPath: "sermon_workspace_dispatcher",
    authoritative: true,
    description: "The sermon workspace dispatcher reads the live Firestore sermon records."
  });
  assert.equal(dashboard.scope.kind, "upcoming_from_date");
  assert.equal(dashboard.scope.effectiveDateFrom, "2026-07-12");
  assert.equal(dashboard.scope.legacyDateInterpretedAs, "asOfDate");
});

test("treats a legacy dashboard date as an as-of date and supports an exact-day range", async () => {
  const deps = createDeps({
    now: "2026-07-15T17:00:00.000Z",
    sermons: {
      "sermon-july-19": {
        sermonId: "sermon-july-19",
        title: "July 19 Message",
        status: "developing",
        scriptureText: "Psalm 86:17"
      },
      "sermon-july-26": {
        sermonId: "sermon-july-26",
        title: "July 26 Message",
        status: "developing",
        scriptureText: "Romans 8:28"
      }
    },
    sermonOccasions: {
      "occasion-july-19": {
        occasionId: "occasion-july-19",
        sermonId: "sermon-july-19",
        status: "planned",
        date: "2026-07-19",
        time: "11:00",
        timeZone: "America/Los_Angeles",
        service: "Sunday Morning"
      },
      "occasion-july-26": {
        occasionId: "occasion-july-26",
        sermonId: "sermon-july-26",
        status: "planned",
        date: "2026-07-26",
        time: "18:00",
        timeZone: "America/Los_Angeles",
        service: "Sunday Night"
      }
    }
  });

  const legacyCurrentDate = await buildPreachingPreparationDashboard({
    date: "2026-07-15",
    limit: 12
  }, deps);
  assert.equal(legacyCurrentDate.summary.upcomingCount, 2);
  assert.deepEqual(
    legacyCurrentDate.schedule.map((item) => item.occasion.date),
    ["2026-07-19", "2026-07-26"]
  );
  assert.equal(legacyCurrentDate.scope.kind, "upcoming_from_date");
  assert.equal(legacyCurrentDate.scope.effectiveDateFrom, "2026-07-15");

  const exactDay = await buildPreachingPreparationDashboard({
    dateFrom: "2026-07-19",
    dateTo: "2026-07-19",
    limit: 12
  }, deps);
  assert.equal(exactDay.summary.upcomingCount, 1);
  assert.equal(exactDay.schedule[0].sermon.sermonId, "sermon-july-19");
  assert.equal(exactDay.scope.kind, "exact_date");
});

test("previews and applies migration of flattened legacy preaching occasions", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-legacy": {
        sermonId: "sermon-legacy",
        title: "Legacy Sermon",
        status: "preached",
        preachedDate: "2025-10-12",
        occasion: "Faith Baptist Church - Sunday Evening Service 7pm"
      },
      "sermon-placeholder": {
        sermonId: "sermon-placeholder",
        title: "Placeholder Date Sermon",
        status: "preached",
        preachedDate: "2001-01-01",
        occasion: ""
      },
      "sermon-service-label": {
        sermonId: "sermon-service-label",
        title: "Upcoming Sunday Night",
        status: "developing",
        targetDate: "2026-07-12",
        occasion: "Sunday Night"
      }
    }
  });

  const preview = await migrateLegacySermonOccasions({}, deps);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.candidateCount, 3);
  assert.equal(preview.newCandidateCount, 2);
  assert.equal(preview.skippedCandidateCount, 1);
  assert.equal(preview.warningCounts.placeholderLegacyDate, 1);
  const serviceCandidate = preview.candidates.find(({ sermonId }) => sermonId === "sermon-service-label");
  assert.equal(serviceCandidate.occasion.venue, "");
  assert.equal(serviceCandidate.occasion.service, "Sunday Night");
  assert.equal(deps.sermonOccasionsCollection.store.size, 0);

  const applied = await migrateLegacySermonOccasions({
    sermonId: "sermon-legacy",
    confirmed: true
  }, deps);
  assert.equal(applied.migratedCount, 1);

  const occasions = await listSermonOccasions({ sermonId: "sermon-legacy" }, deps);
  assert.equal(occasions.occasions[0].time, "19:00");
  assert.equal(occasions.occasions[0].venue, "Faith Baptist Church");
  assert.equal(occasions.occasions[0].status, "preached");
});

test("evaluates sermon readiness against its next preaching occasion", async () => {
  const deps = createDeps({
    now: "2026-07-01T17:00:00.000Z",
    sermons: {
      "sermon-evaluate": {
        sermonId: "sermon-evaluate",
        title: "A Sermon in Study",
        status: "developing",
        scriptureText: "Romans 8:1",
        occasion: "Faith Baptist Church - Sunday Morning",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-study": {
        sourceId: "source-study",
        sermonId: "sermon-evaluate",
        sourceType: "study_notes",
        sourceLabel: "Study notes",
        material: "Substantial study material for Romans 8:1."
      }
    },
    sermonOccasions: {
      "occasion-soon": {
        occasionId: "occasion-soon",
        sermonId: "sermon-evaluate",
        status: "planned",
        date: "2026-07-05",
        time: "10:30",
        timeZone: "America/Los_Angeles",
        venue: "Faith Baptist Church",
        service: "Sunday Morning"
      }
    }
  });

  const evaluation = await evaluateSermonReadiness({ sermonId: "sermon-evaluate" }, deps);
  assert.equal(evaluation.stage, "study");
  assert.equal(evaluation.schedule.urgency, "this_week");
  assert.equal(evaluation.recommendedNextStep.priority, "high");
  assert.ok(evaluation.nextSteps.some(({ suggestedOperation }) =>
    suggestedOperation === "proposeSermonCanonicalRepair"));
  assert.ok(evaluation.blockers.some(({ code }) => code === "deadline_readiness_risk"));
});

test("calibrates readiness monotonically from idea through ready", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-idea": {
        sermonId: "sermon-idea",
        title: "Early Idea",
        status: "idea"
      },
      "sermon-study": {
        sermonId: "sermon-study",
        title: "Study Sermon",
        status: "developing",
        scriptureText: "Romans 8:1"
      },
      "sermon-draft": {
        sermonId: "sermon-draft",
        title: "Draft Sermon",
        status: "draft",
        scriptureText: "Romans 8:1-4",
        bigIdea: "Life in the Spirit answers condemnation.",
        outline: "1. No condemnation\n2. New power\n3. A changed walk",
        notes: "Application: walk according to the Spirit."
      },
      "sermon-ready": {
        sermonId: "sermon-ready",
        title: "Ready Sermon",
        status: "ready",
        scriptureText: "Romans 8:1-4",
        bigIdea: "Life in the Spirit answers condemnation.",
        outline: "1. No condemnation\n2. New power\n3. A changed walk",
        notes: "Application: walk according to the Spirit."
      }
    },
    sermonSources: {
      "source-study": {
        sourceId: "source-study",
        sermonId: "sermon-study",
        sourceType: "study_notes",
        sourceLabel: "Study",
        material: "Romans 8 study material"
      },
      "source-draft": {
        sourceId: "source-draft",
        sermonId: "sermon-draft",
        sourceType: "study_notes",
        sourceLabel: "Study",
        material: "Romans 8 study material"
      },
      "source-ready": {
        sourceId: "source-ready",
        sermonId: "sermon-ready",
        sourceType: "study_notes",
        sourceLabel: "Study",
        material: "Romans 8 study material"
      }
    },
    sermonOccasions: {
      "occasion-draft": {
        occasionId: "occasion-draft",
        sermonId: "sermon-draft",
        status: "planned",
        date: "2026-07-12",
        timeZone: "America/Los_Angeles"
      },
      "occasion-ready": {
        occasionId: "occasion-ready",
        sermonId: "sermon-ready",
        status: "planned",
        date: "2026-07-12",
        timeZone: "America/Los_Angeles"
      }
    }
  });

  const idea = await evaluateSermonReadiness({ sermonId: "sermon-idea" }, deps);
  const study = await evaluateSermonReadiness({ sermonId: "sermon-study" }, deps);
  const draft = await evaluateSermonReadiness({ sermonId: "sermon-draft" }, deps);
  const ready = await evaluateSermonReadiness({ sermonId: "sermon-ready" }, deps);

  assert.equal(idea.stage, "idea");
  assert.equal(study.stage, "study");
  assert.equal(draft.stage, "draft");
  assert.equal(ready.stage, "ready");
  assert.ok(idea.readiness.score < study.readiness.score);
  assert.ok(study.readiness.score < draft.readiness.score);
  assert.ok(draft.readiness.score < ready.readiness.score);
  assert.equal(ready.readiness.score, 100);
});

test("resolves duplicate sermon titles only after a distinguishing date is supplied", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-living-free-2024": {
        sermonId: "sermon-living-free-2024",
        title: "Living Free",
        status: "preached",
        scriptureText: "Galatians 5:1",
        preachedDate: "2024-05-05",
        updatedAt: "2024-05-06T01:00:00.000Z"
      },
      "sermon-living-free-2025": {
        sermonId: "sermon-living-free-2025",
        title: "Living Free",
        status: "preached",
        scriptureText: "John 8:31-36",
        preachedDate: "2025-10-12",
        updatedAt: "2025-10-13T01:00:00.000Z"
      }
    }
  });

  const ambiguous = await resolveSermon({ title: "Living Free" }, deps);
  assert.equal(ambiguous.resolution, "ambiguous");
  assert.equal(ambiguous.selected, null);
  assert.equal(ambiguous.count, 2);

  const resolved = await resolveSermon({ title: "Living Free", date: "2025-10-12" }, deps);
  assert.equal(resolved.resolution, "resolved");
  assert.equal(resolved.selected.sermonId, "sermon-living-free-2025");
  assert.ok(resolved.selected.matchedBy.includes("date_exact"));
});

test("resolves a thin sermon hub from saved source evidence without returning source material", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-imported-1": {
        sermonId: "sermon-imported-1",
        title: "Imported sermon",
        status: "preached",
        updatedAt: "2025-10-13T01:00:00.000Z"
      }
    },
    sermonSources: {
      "source-living-free": {
        sourceId: "source-living-free",
        sermonId: "sermon-imported-1",
        sourceType: "logos_export",
        sourceLabel: "Living Free",
        summary: "A sermon from John 8:31-36 about freedom in Christ.",
        material: "Full private sermon manuscript material.",
        updatedAt: "2025-10-13T01:00:00.000Z"
      }
    }
  });

  const resolved = await resolveSermon({ query: "Living Free" }, deps);
  assert.equal(resolved.resolution, "resolved");
  assert.equal(resolved.selected.sermonId, "sermon-imported-1");
  assert.equal(resolved.selected.sourceMatchCount, 1);
  assert.equal(resolved.selected.sourceMatches[0].sourceLabel, "Living Free");
  assert.equal(Object.prototype.hasOwnProperty.call(resolved.selected.sourceMatches[0], "material"), false);
});

test("audits thin canonical sermon records and identifies repair evidence", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-thin": {
        sermonId: "sermon-thin",
        title: "Living Free",
        status: "preached",
        updatedAt: "2025-10-13T01:00:00.000Z"
      }
    },
    sermonSources: {
      "source-thin": {
        sourceId: "source-thin",
        sermonId: "sermon-thin",
        sourceType: "logos_export",
        sourceLabel: "Living Free manuscript",
        summary: "John 8:31-36 teaches true freedom through the Son.",
        material: "Main text: John 8:31-36.",
        updatedAt: "2025-10-13T01:00:00.000Z"
      }
    }
  });

  const audit = await auditSermonCompleteness({ sermonId: "sermon-thin" }, deps);
  assert.equal(audit.completeness.status, "thin");
  assert.deepEqual(audit.completeness.missingFields, [
    "scriptureText",
    "bigIdea",
    "outline",
    "occasion",
    "preachedDate"
  ]);
  assert.equal(audit.sourceCoverage.count, 1);
  assert.ok(audit.sourceCoverage.likelyScriptureReferences.includes("John 8:31-36"));
  assert.match(audit.recommendations[0], /likely references include John 8:31-36/);
});

test("proposes source-grounded canonical repairs without modifying the sermon", async () => {
  let generatorInput = null;
  const deps = createDeps({
    sermons: {
      "sermon-repair": {
        sermonId: "sermon-repair",
        title: "Living Free",
        status: "preached",
        preachedDate: "2025-10-12",
        occasion: "Sunday Evening",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-repair": {
        sourceId: "source-repair",
        sermonId: "sermon-repair",
        sourceType: "logos_export",
        sourceLabel: "Living Free",
        summary: "Primary text: John 8:31-36",
        material: "Main idea: The Son makes sinners truly free.\nI. Continue in the Word\nII. Know the truth\nIII. Live in the Son's freedom",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    },
    generateCanonicalRepairProposal: async (input) => {
      generatorInput = input;
      return {
        proposedChanges: {
          scriptureText: "John 8:31-36",
          bigIdea: "The Son makes sinners truly free.",
          outline: "I. Continue in the Word\nII. Know the truth\nIII. Live in the Son's freedom"
        },
        evidence: {
          scriptureText: ["The source labels John 8:31-36 as the primary text."],
          bigIdea: ["The manuscript states the main idea directly."],
          outline: ["The source contains three numbered movements."]
        },
        confidence: "high",
        warnings: []
      };
    }
  });

  const result = await proposeSermonCanonicalRepair({ sermonId: "sermon-repair" }, deps);
  assert.equal(result.status, "proposed");
  assert.match(result.proposal.proposalId, /^sermon-repair-/);
  assert.equal(result.proposal.proposedChanges.scriptureText, "John 8:31-36");
  assert.deepEqual(result.proposal.sourceIds, ["source-repair"]);
  assert.match(generatorInput.contextText, /Son makes sinners truly free/);
  assert.deepEqual(generatorInput.requestedFields, ["scriptureText", "bigIdea", "outline"]);

  const unchanged = await getSermon({ sermonId: "sermon-repair" }, deps);
  assert.equal(unchanged.sermon.scriptureText, "");
  assert.equal(unchanged.sermon.bigIdea, "");
  assert.equal(unchanged.sermon.outline, "");
});

test("applies only a confirmed, unchanged canonical repair proposal and creates a snapshot", async () => {
  const proposedChanges = {
    scriptureText: "John 8:31-36",
    bigIdea: "The Son makes sinners truly free."
  };
  const deps = createDeps({
    sermons: {
      "sermon-apply-repair": {
        sermonId: "sermon-apply-repair",
        title: "Living Free",
        status: "preached",
        preachedDate: "2025-10-12",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-apply-repair": {
        sourceId: "source-apply-repair",
        sermonId: "sermon-apply-repair",
        sourceType: "logos_export",
        material: "John 8:31-36. The Son makes sinners truly free."
      }
    },
    generateCanonicalRepairProposal: async () => ({
      proposedChanges,
      confidence: "high"
    })
  });
  const proposalResult = await proposeSermonCanonicalRepair({
    sermonId: "sermon-apply-repair",
    fields: ["scriptureText", "bigIdea"]
  }, deps);
  const applyArguments = proposalResult.applyInstructions.arguments;

  await assert.rejects(
    () => applySermonCanonicalRepair({ ...applyArguments, confirmed: false }, deps),
    (error) => error.code === "canonical_repair_confirmation_required"
  );
  await assert.rejects(
    () => applySermonCanonicalRepair({
      ...applyArguments,
      proposedChanges: { ...proposedChanges, bigIdea: "Altered after proposal" }
    }, deps),
    (error) => error.code === "canonical_repair_proposal_mismatch"
  );

  const applied = await applySermonCanonicalRepair(applyArguments, deps);
  assert.equal(applied.status, "applied");
  assert.deepEqual(applied.appliedFields, ["scriptureText", "bigIdea"]);
  assert.equal(applied.sermon.scriptureText, "John 8:31-36");
  assert.equal(applied.sermon.bigIdea, "The Son makes sinners truly free.");
  assert.equal(applied.snapshot.snapshotType, "before_update");
});

test("rejects a canonical repair proposal after the sermon changes", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-stale-repair": {
        sermonId: "sermon-stale-repair",
        title: "Living Free",
        status: "preached",
        updatedAt: "2026-06-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-stale-repair": {
        sourceId: "source-stale-repair",
        sermonId: "sermon-stale-repair",
        sourceType: "logos_export",
        material: "Primary text John 8:31-36"
      }
    },
    generateCanonicalRepairProposal: async () => ({
      proposedChanges: { scriptureText: "John 8:31-36" },
      confidence: "high"
    })
  });
  const proposalResult = await proposeSermonCanonicalRepair({ sermonId: "sermon-stale-repair" }, deps);

  await updateSermon({
    sermonId: "sermon-stale-repair",
    changes: { notes: "A new note arrived after the proposal." }
  }, deps);

  await assert.rejects(
    () => applySermonCanonicalRepair(proposalResult.applyInstructions.arguments, deps),
    (error) => error.code === "stale_canonical_repair_proposal"
  );
});

test("creates editable sermon presentations and reuses the series template", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-romans-8": {
        sermonId: "sermon-romans-8",
        title: "No Condemnation",
        status: "ready",
        scriptureText: "Romans 8:1-4",
        bigIdea: "In Christ, condemnation is no longer the believer's identity.",
        outline: "1. The verdict has changed\n2. The Spirit gives life",
        seriesId: "series-life-in-the-spirit",
        seriesTitle: "Life in the Spirit",
        seriesSlug: "life-in-the-spirit",
        seriesNumber: 1,
        series: {
          seriesId: "series-life-in-the-spirit",
          title: "Life in the Spirit",
          slug: "life-in-the-spirit",
          number: 1
        },
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const created = await createSermonPresentation(
    {
      sermonId: "sermon-romans-8",
      compact: false
    },
    deps
  );

  assert.equal(created.presentation.status, "rendered");
  assert.equal(created.presentation.aspectRatio, "16:9");
  assert.equal(created.presentation.slideCount, 6);
  assert.equal(created.presentation.templateId, created.template.templateId);
  assert.equal(created.template.seriesId, "series-life-in-the-spirit");
  assert.match(created.presentation.storagePath, /sermon-presentations\/sermon-romans-8/);

  const templates = await listSermonPresentationTemplates(
    { seriesId: "series-life-in-the-spirit" },
    deps
  );
  assert.equal(templates.count, 1);

  const second = await createSermonPresentation(
    {
      sermonId: "sermon-romans-8",
      title: "No Condemnation Teaching Deck",
      slides: [
        {
          type: "title",
          title: "No Condemnation",
          subtitle: "Romans 8:1"
        }
      ]
    },
    {
      ...deps,
      randomUUID: () => "87654321-aaaa-bbbb-cccc-123456789012"
    }
  );

  assert.equal(second.template.templateId, created.template.templateId);
  assert.equal(second.presentation.slideCount, 1);

  const presentations = await listSermonPresentations({ sermonId: "sermon-romans-8" }, deps);
  assert.equal(presentations.count, 2);

  const detail = await getSermonPresentation(
    { presentationId: created.presentation.presentationId },
    deps
  );
  assert.equal(detail.presentation.slidePlan.slides[0].type, "title");
});

test("builds a paced default deck from presentation-ready development checkpoints", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-rich-slides": {
        sermonId: "sermon-rich-slides",
        title: "Mercy Gets the Final Word",
        status: "ready",
        scriptureText: "James 2:10-13",
        bigIdea: "Received mercy must shape how believers treat others.",
        outline: [
          "The law exposes universal guilt",
          "The law of liberty governs speech",
          "Mercy shapes those who received mercy",
          "Compassion replaces comparison",
          "Mercy moves us toward people"
        ].join("\n")
      }
    },
    sermonDevelopmentCheckpoints: {
      "checkpoint-line": {
        checkpointId: "checkpoint-line",
        sermonId: "sermon-rich-slides",
        checkpointType: "verbatim",
        heading: "Key line",
        content: "When God’s mercy is at work in a heart, mercy gets the final word.",
        materialStatus: "placed",
        placementTarget: "Closing movement",
        createdAt: "2026-07-10T18:00:00.000Z"
      },
      "checkpoint-illustration": {
        checkpointId: "checkpoint-illustration",
        sermonId: "sermon-rich-slides",
        checkpointType: "illustration",
        heading: "The vessel",
        content: "A vessel reveals what it has been shaped to carry when pressure tips it over.",
        materialStatus: "placed",
        placementTarget: "Movement 3",
        createdAt: "2026-07-10T17:00:00.000Z"
      },
      "checkpoint-application-one": {
        checkpointId: "checkpoint-application-one",
        sermonId: "sermon-rich-slides",
        checkpointType: "application",
        heading: "Look with compassion",
        content: "Stop measuring yourself against others and remember the mercy you received.",
        materialStatus: "placed",
        placementTarget: "Application",
        createdAt: "2026-07-10T16:00:00.000Z"
      },
      "checkpoint-application-two": {
        checkpointId: "checkpoint-application-two",
        sermonId: "sermon-rich-slides",
        checkpointType: "application",
        heading: "Move toward people",
        content: "Carry the gospel toward people who need the same mercy that saved you.",
        materialStatus: "placed",
        placementTarget: "Application",
        createdAt: "2026-07-10T15:00:00.000Z"
      },
      "checkpoint-private-context": {
        checkpointId: "checkpoint-private-context",
        sermonId: "sermon-rich-slides",
        checkpointType: "pastoral_context",
        heading: "Private context",
        content: "A family in the church is in a painful private situation.",
        materialStatus: "unplaced",
        createdAt: "2026-07-10T14:00:00.000Z"
      },
      "checkpoint-cut-line": {
        checkpointId: "checkpoint-cut-line",
        sermonId: "sermon-rich-slides",
        checkpointType: "key_line",
        heading: "Rejected line",
        content: "This discarded line must never enter the presentation.",
        materialStatus: "intentionally_cut",
        cutReason: "It distracts from the sermon burden.",
        createdAt: "2026-07-10T13:00:00.000Z"
      }
    }
  });

  const result = await createSermonPresentation({
    sermonId: "sermon-rich-slides",
    compact: false
  }, deps);

  assert.equal(result.presentation.slideCount, 13);
  assert.equal(result.presentation.slidePlan.planning.developmentSlideCount, 4);
  assert.equal(result.presentation.slidePlan.planning.placedMaterialCount, 4);
  assert.equal(result.presentation.slidePlan.planning.excludedUnplacedMaterialCount, 1);
  assert.equal(result.presentation.slidePlan.planning.excludedCutMaterialCount, 1);
  assert.equal(result.presentation.placedMaterialCount, 4);
  assert.match(result.presentation.materialFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.presentation.slidePlan.planning.warnings.length, 0);
  assert.ok(result.presentation.slidePlan.slides.some((slide) => slide.type === "quote"));
  assert.equal(result.presentation.slidePlan.slides.filter((slide) => slide.type === "application").length, 2);
  assert.equal(result.presentation.slidePlan.slides.some((slide) =>
    /painful private situation/.test(slide.body || slide.text)), false);
  assert.equal(result.presentation.slidePlan.slides.some((slide) =>
    /discarded line/.test(slide.body || slide.text)), false);
});

test("prioritizes presentation-ready checkpoints when a deck reaches the slide cap", async () => {
  const outlineLines = Array.from({ length: 10 }, (_, index) =>
    index === 9
      ? "Don’t just focus on getting out of Egypt—let God get Egypt out of you."
      : `Outline movement ${index + 1}`
  );
  const deps = createDeps({
    sermons: {
      "sermon-season-cap": {
        sermonId: "sermon-season-cap",
        title: "Season in Egypt",
        status: "developing",
        scriptureText: "Ecclesiastes 2; Exodus 1-12",
        bigIdea: "God is present and purposeful in every season.",
        outline: outlineLines.join("\n")
      }
    },
    sermonDevelopmentCheckpoints: {
      "checkpoint-season-line": {
        checkpointId: "checkpoint-season-line",
        sermonId: "sermon-season-cap",
        checkpointType: "verbatim",
        content: outlineLines[9],
        materialStatus: "placed",
        placementTarget: "Closing",
        createdAt: "2026-07-11T17:00:00.000Z"
      },
      "checkpoint-season-application": {
        checkpointId: "checkpoint-season-application",
        sermonId: "sermon-season-cap",
        checkpointType: "application",
        content: "Take a breath—God is in control. You don’t have to carry what only He can carry.",
        materialStatus: "placed",
        placementTarget: "Application",
        createdAt: "2026-07-11T16:00:00.000Z"
      }
    }
  });

  const result = await createSermonPresentation({
    sermonId: "sermon-season-cap",
    compact: false
  }, deps);
  const slides = result.presentation.slidePlan.slides;

  assert.equal(result.presentation.slideCount, 15);
  assert.equal(result.presentation.slidePlan.planning.developmentSlideCount, 2);
  assert.equal(result.presentation.slidePlan.planning.outlineMovementCount, 9);
  assert.equal(result.presentation.slidePlan.planning.availableOutlineMovementCount, 10);
  assert.equal(slides.some((slide) => slide.type === "quote" &&
    /Egypt out of you/.test(slide.text)), true);
  assert.equal(slides.some((slide) => slide.type === "application" &&
    /Take a breath/.test(slide.body)), true);
  assert.equal(slides.some((slide) => slide.type === "main_point" &&
    /Egypt out of you/.test(slide.heading)), false);
});

test("resolves and creates an editable sermon presentation in one artifact operation", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-living-free": {
        sermonId: "sermon-living-free",
        title: "Living Free",
        status: "preached",
        scriptureText: "John 8:31-36",
        bigIdea: "The Son changes our status and makes us truly free.",
        outline: "Christ changes our status\nReal freedom is relational\nLive in the freedom Christ gives",
        preachedDate: "2025-10-12",
        occasion: "Sunday Evening",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const created = await createSermonPresentationFromLookup(
    {
      title: "Living Free",
      date: "2025-10-12",
      dateField: "preachedDate",
      compact: true
    },
    deps
  );

  assert.equal(created.resolvedSermon.sermonId, "sermon-living-free");
  assert.equal(created.resolvedSermon.confidence, "high");
  assert.equal(created.presentation.status, "rendered");
  assert.equal(created.presentation.aspectRatio, "16:9");
  assert.equal(created.presentation.slideCount, 7);
  assert.equal(created.template.name, "Default Sermon Slides");
  assert.match(created.presentation.downloadUrl, /\.pptx$/);
});

test("one-call presentation creation refuses ambiguous sermon matches before rendering", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-living-free-2024": {
        sermonId: "sermon-living-free-2024",
        title: "Living Free",
        status: "preached",
        preachedDate: "2024-05-05",
        updatedAt: "2024-05-06T01:00:00.000Z"
      },
      "sermon-living-free-2025": {
        sermonId: "sermon-living-free-2025",
        title: "Living Free",
        status: "preached",
        preachedDate: "2025-10-12",
        updatedAt: "2025-10-13T01:00:00.000Z"
      }
    }
  });

  await assert.rejects(
    () => createSermonPresentationFromLookup({ title: "Living Free" }, deps),
    (error) => error.code === "sermon_presentation_lookup_ambiguous" &&
      error.details.candidates.length === 2
  );
  assert.equal(deps.sermonPresentationsCollection.store.size, 0);
});

test("resolves unique sermon id prefixes for context and presentations", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-logos-1eb0722e54d609443486e2fd41dc4d42": {
        sermonId: "sermon-logos-1eb0722e54d609443486e2fd41dc4d42",
        title: "Living Free",
        status: "preached",
        scriptureText: "John 8:31-36",
        bigIdea: "The Son makes believers free indeed.",
        outline: "1. Continue in truth\n2. Know the truth\n3. Live free",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const context = await getSermonContext(
    {
      sermonId: "sermon-logos-1eb0722e54d609443486e2fd41dc4"
    },
    deps
  );

  assert.equal(context.sermon.sermonId, "sermon-logos-1eb0722e54d609443486e2fd41dc4d42");

  const presentation = await createSermonPresentation(
    {
      sermonId: "sermon-logos-1eb0722e54d609443486e2fd41dc4",
      title: "Living Free"
    },
    deps
  );

  assert.equal(presentation.presentation.sermonId, "sermon-logos-1eb0722e54d609443486e2fd41dc4d42");
  assert.equal(presentation.presentation.status, "rendered");
  assert.equal(Object.prototype.hasOwnProperty.call(presentation.presentation, "slidePlan"), false);

  const fullPresentation = await createSermonPresentation(
    {
      sermonId: "sermon-logos-1eb0722e54d609443486e2fd41dc4",
      title: "Living Free Full Response",
      compact: false
    },
    {
      ...deps,
      randomUUID: () => "87654321-aaaa-bbbb-cccc-123456789012"
    }
  );

  assert.equal(fullPresentation.presentation.sermonId, "sermon-logos-1eb0722e54d609443486e2fd41dc4d42");
  assert.equal(Object.prototype.hasOwnProperty.call(fullPresentation.presentation, "slidePlan"), true);
});

test("creates and updates sermon presentation templates", async () => {
  const deps = createDeps();

  const created = await createSermonPresentationTemplate(
    {
      name: "James Series",
      seriesTitle: "James - Living Our Faith",
      theme: {
        colors: {
          background: "#111111",
          primary: "#C9A227"
        }
      }
    },
    deps
  );

  assert.equal(created.template.aspectRatio, "16:9");
  assert.equal(created.template.seriesId, "series-james-living-our-faith");
  assert.equal(created.template.theme.colors.background, "111111");

  const updated = await updateSermonPresentationTemplate(
    {
      templateId: created.template.templateId,
      changes: {
        description: "Updated series deck style",
        theme: {
          colors: {
            background: "#202020",
            primary: "#F2C14E"
          }
        }
      }
    },
    deps
  );

  assert.equal(updated.template.description, "Updated series deck style");
  assert.equal(updated.template.theme.colors.background, "202020");

  const fetched = await getSermonPresentationTemplate(
    { templateId: created.template.templateId },
    deps
  );
  assert.equal(fetched.template.theme.colors.primary, "F2C14E");
});

test("imports an edited PPTX as a new active series template version", async () => {
  const deps = createDeps({
    sermonPresentationTemplates: {
      "template-seasons-v1": {
        templateId: "template-seasons-v1",
        name: "Seasons of Life",
        seriesId: "series-seasons-of-life",
        seriesTitle: "Seasons of Life",
        seriesSlug: "seasons-of-life",
        status: "active",
        version: 1,
        aspectRatio: "16:9"
      }
    }
  });

  const imported = await importSermonPresentationTemplate({
    templateId: "template-seasons-v1",
    openaiFileIdRefs: [{ name: "edited-template.pptx", download_link: "https://files.test/pptx" }]
  }, deps);

  assert.equal(imported.action, "imported");
  assert.equal(imported.previousTemplate.templateId, "template-seasons-v1");
  assert.equal(imported.template.version, 2);
  assert.equal(imported.template.status, "active");
  assert.equal(imported.template.theme.fonts.heading, "Georgia");
  assert.equal(imported.template.layouts.title.titleSize, 50);
  assert.equal(imported.template.sourceFilename, "imported-template.pptx");

  const oldTemplate = deps.sermonPresentationTemplatesCollection.store.get("template-seasons-v1");
  assert.equal(oldTemplate.status, "archived");
  assert.equal(oldTemplate.replacedByTemplateId, imported.template.templateId);

  const active = await listSermonPresentationTemplates({
    seriesId: "series-seasons-of-life",
    status: "active"
  }, deps);
  assert.deepEqual(active.templates.map(({ templateId }) => templateId), [imported.template.templateId]);
});

test("rejects creating a sermon in a missing folder", async () => {
  const deps = createDeps();

  await assert.rejects(
    () => createSermon(
      {
        title: "Orphaned Sermon",
        folderId: "folder-missing"
      },
      deps
    ),
    {
      code: "sermon_folder_not_found",
      statusCode: 404
    }
  );
});

test("appends development notes and returns detail", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-1": {
        sermonId: "sermon-1",
        title: "God's Faithfulness",
        status: "idea",
        developmentNotes: [],
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const result = await addSermonDevelopmentNote(
    {
      sermonId: "sermon-1",
      content: "Open with the contrast between human forgetfulness and God's covenant memory.",
      noteType: "illustration"
    },
    deps
  );

  assert.equal(result.note.noteType, "illustration");
  assert.equal(result.snapshot.snapshotType, "before_development_note");

  const detail = await getSermon({ sermonId: "sermon-1" }, deps);
  assert.equal(detail.sermon.developmentNotes.length, 1);
});

test("starts a tracked session by durably capturing its initiating exchange", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-start-capture": {
        sermonId: "sermon-start-capture",
        title: "Season in Egypt",
        status: "developing"
      }
    }
  });
  const initialTranscript = "Start development mode for this Sunday morning sermon.";
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-start-capture",
    mode: "voice",
    label: "Sunday morning development",
    requireInitialExchange: true,
    initialTranscript,
    assistantTranscript: "Tracked session started for {{sermonTitle}}. Session ID: {{sessionId}}"
  }, deps);

  assert.equal(started.sermon.title, "Season in Egypt");
  assert.equal(started.session.danTurnCount, 1);
  assert.equal(started.session.assistantTurnCount, 1);
  assert.match(started.storedAssistantTranscript, /Season in Egypt/);
  assert.match(started.storedAssistantTranscript, new RegExp(started.session.sessionId));
  const turns = await listSermonDevelopmentTurns({
    sessionId: started.session.sessionId,
    sort: "asc"
  }, deps);
  assert.deepEqual(turns.turns.map((turn) => turn.speaker), ["dan", "assistant"]);
  assert.equal(turns.turns[0].transcript, initialTranscript);

  await assert.rejects(
    () => startSermonDevelopmentSession({
      sermonId: "sermon-start-capture",
      mode: "voice",
      requireInitialExchange: true
    }, deps),
    { code: "missing_sermon_development_initial_exchange", statusCode: 400 }
  );
});

test("rejects standalone checkpoints while a tracked session is active", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-active-checkpoint": {
        sermonId: "sermon-active-checkpoint",
        title: "Raw Capture First",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-active-checkpoint",
    mode: "chat"
  }, deps);

  await assert.rejects(
    () => saveSermonDevelopmentCheckpoint({
      sermonId: "sermon-active-checkpoint",
      sessionId: started.session.sessionId,
      checkpointType: "key_line",
      content: "A derived note must never replace the current raw turn."
    }, deps),
    (error) => {
      assert.equal(error.code, "sermon_development_turn_capture_required");
      assert.equal(error.details.requiredOperation, "captureSermonDevelopmentTurn");
      return true;
    }
  );
  assert.equal(deps.sermonDevelopmentCheckpointsCollection.store.size, 0);
});

test("preserves walk-session checkpoints and audits whether they were integrated", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-mercy-walk": {
        sermonId: "sermon-mercy-walk",
        title: "Mercy Rejoiceth Against Judgment",
        status: "developing",
        scriptureText: "James 2:10-13",
        notes: "James addresses partiality in the local church.",
        outline: "1. The law exposes guilt",
        createdAt: "2026-07-01T16:00:00.000Z",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-mercy-walk",
    mode: "walk",
    label: "Mercy development walk",
    context: "Preparing the next James sermon after a church family lost its home."
  }, deps);
  assert.equal(started.session.status, "active");

  const captured = await captureSermonDevelopmentTurn({
    sermonId: "sermon-mercy-walk",
    sessionId: started.session.sessionId,
    transcript: "Save these two ideas from this walk.",
    assistantTranscript: "Both ideas are captured and remain unplaced.",
    checkpoints: [
      {
        checkpointType: "verbatim",
        heading: "What wins in us",
        content: "When God’s mercy is at work in a heart, mercy gets the final word."
      },
      {
        checkpointType: "pastoral_context",
        heading: "Current church burden",
        content: "The church is hurting with a family whose home burned, so the sermon should move toward mercy without exploiting their loss."
      }
    ]
  }, deps);
  const saved = { count: captured.checkpoints.length, checkpoints: captured.checkpoints };
  assert.equal(saved.count, 2);
  assert.equal(saved.checkpoints[0].exactWording, true);

  const beforeIntegration = await auditSermonDevelopmentPreservation({
    sermonId: "sermon-mercy-walk",
    sessionId: started.session.sessionId
  }, deps);
  assert.equal(beforeIntegration.preservation.durablyPreservedCount, 2);
  assert.equal(beforeIntegration.preservation.unintegratedCount, 2);

  await updateSermon({
    sermonId: "sermon-mercy-walk",
    changes: {
      notes: "James addresses partiality in the local church. When God’s mercy is at work in a heart, mercy gets the final word."
    }
  }, deps);
  const afterIntegration = await auditSermonDevelopmentPreservation({
    sermonId: "sermon-mercy-walk",
    sessionId: started.session.sessionId
  }, deps);
  assert.equal(afterIntegration.preservation.integratedCount, 1);
  assert.equal(afterIntegration.unintegratedCheckpoints[0].checkpointType, "pastoral_context");

  const closed = await closeSermonDevelopmentSession({
    sessionId: started.session.sessionId,
    summary: "Mercy, not judgment, must get the final word in the local church.",
    rawTranscript: [
      "When God’s mercy is at work in a heart, mercy gets the final word.",
      "A separate unresolved thought about connecting this movement to Romans 8 and Spirit-enabled obedience that has not been developed yet."
    ].join("\n\n")
  }, deps);
  assert.equal(closed.session.status, "closed");
  assert.ok(closed.transcriptSource.sourceId);

  const sessions = await listSermonDevelopmentSessions({ sermonId: "sermon-mercy-walk" }, deps);
  const checkpoints = await listSermonDevelopmentCheckpoints({
    sermonId: "sermon-mercy-walk",
    sessionId: started.session.sessionId
  }, deps);
  assert.equal(sessions.count, 1);
  assert.equal(checkpoints.count, 3);

  const sourceAudit = await auditSermonDevelopmentPreservation({
    sermonId: "sermon-mercy-walk",
    sessionId: started.session.sessionId
  }, deps);
  assert.equal(sourceAudit.sourceCoverage.uncoveredExcerptCount, 1);
  assert.match(sourceAudit.sourceCoverage.uncoveredExcerpts[0].excerpt, /Romans 8/);
});

test("captures every Dan development turn before derivation and builds the closing transcript from raw turns", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-voice-capture": {
        sermonId: "sermon-voice-capture",
        title: "Voice Capture",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-voice-capture",
    mode: "voice",
    label: "Evening sermon walk"
  }, deps);
  const transcript = "I need this exact thought preserved.\nThe second sentence carries the reason it matters.";
  const input = {
    sermonId: "sermon-voice-capture",
    sessionId: started.session.sessionId,
    turnId: "sermon-turn-dan-1",
    sequence: 1,
    speaker: "dan",
    transcript,
    checkpoints: [
      {
        checkpointType: "key_line",
        heading: "Exact thought",
        content: "I need this exact thought preserved.",
        exactWording: true
      }
    ]
  };

  const captured = await captureSermonDevelopmentTurn(input, deps);
  assert.equal(captured.action, "created");
  assert.equal(captured.turn.transcript, transcript);
  assert.equal(captured.checkpoints.length, 1);
  assert.equal(captured.checkpoints[0].exactWording, true);

  const replayed = await captureSermonDevelopmentTurn(input, deps);
  assert.equal(replayed.action, "replayed");
  assert.equal(deps.sermonDevelopmentTurnsCollection.store.size, 1);
  assert.equal(deps.sermonDevelopmentCheckpointsCollection.store.size, 1);

  const turns = await listSermonDevelopmentTurns({
    sessionId: started.session.sessionId,
    speaker: "dan"
  }, deps);
  assert.equal(turns.count, 1);
  assert.equal(turns.turns[0].transcript, transcript);

  const closed = await closeSermonDevelopmentSession({
    sessionId: started.session.sessionId,
    summary: "Dan developed one exact thought."
  }, deps);
  assert.equal(closed.session.turnCount, 1);
  assert.equal(closed.session.danTurnCount, 1);
  assert.ok(closed.transcriptSource);
  assert.match(closed.transcriptSource.material, /DAN TURN 1/);
  assert.match(closed.transcriptSource.material, /The second sentence carries the reason it matters/);
});

test("supports first-action Dan capture followed by exact assistant completion", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-two-phase-capture": {
        sermonId: "sermon-two-phase-capture",
        title: "Two Phase Capture",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-two-phase-capture",
    mode: "voice"
  }, deps);
  const transcript = "Search my archive, but preserve this request before doing the search.";
  const danCapture = await captureSermonDevelopmentTurn({
    sermonId: "sermon-two-phase-capture",
    sessionId: started.session.sessionId,
    transcript
  }, deps);

  assert.equal(danCapture.captureComplete, false);
  assert.equal(danCapture.turn.transcript, transcript);
  assert.equal(danCapture.assistantTurn, null);
  assert.match(danCapture.requiredNextAction, /Replay captureSermonDevelopmentTurn/);

  const assistantTranscript = "I searched the archive and found the saved records.";
  const completed = await captureSermonDevelopmentTurn({
    sermonId: "sermon-two-phase-capture",
    sessionId: started.session.sessionId,
    transcript,
    assistantTranscript
  }, deps);

  assert.equal(completed.action, "replayed");
  assert.equal(completed.captureComplete, true);
  assert.equal(completed.storedAssistantTranscript, assistantTranscript);
  assert.equal(completed.assistantTurn.sequence, 2);
  assert.equal(deps.sermonDevelopmentTurnsCollection.store.size, 2);
});

test("captures Chat's planned reply and preserves it exactly when Dan approves it by voice", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-assistant-approval": {
        sermonId: "sermon-assistant-approval",
        title: "Assistant Approval",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-assistant-approval",
    mode: "voice"
  }, deps);
  const proposedWording = [
    "When God gives you a token, it does not always change what you are going through.",
    "It settles your heart and gives you strength to keep walking."
  ].join(" ");
  const firstInput = {
    sermonId: "sermon-assistant-approval",
    sessionId: started.session.sessionId,
    transcript: "A token should stabilize faith within the season.",
    assistantTranscript: proposedWording
  };

  const first = await captureSermonDevelopmentTurn(firstInput, deps);
  assert.equal(first.turn.sequence, 1);
  assert.equal(first.assistantTurn.sequence, 2);
  assert.equal(first.assistantTurn.transcript, proposedWording);
  assert.equal(first.nextSequence, 3);

  const replay = await captureSermonDevelopmentTurn(firstInput, deps);
  assert.equal(replay.action, "replayed");
  assert.equal(replay.assistantAction, "replayed");
  assert.equal(deps.sermonDevelopmentTurnsCollection.store.size, 2);

  const approved = await captureSermonDevelopmentTurn({
    sermonId: "sermon-assistant-approval",
    sessionId: started.session.sessionId,
    transcript: "Exactly what you just said needs to be a note. Please save what you said.",
    assistantTranscript: "Saved. We can keep developing from there."
  }, deps);
  assert.equal(approved.turn.sequence, 3);
  assert.equal(approved.assistantTurn.sequence, 4);
  assert.equal(approved.assistantApproval.detected, true);
  assert.equal(approved.assistantApproval.preserved, true);
  assert.equal(approved.checkpoints.length, 1);
  assert.equal(approved.checkpoints[0].content, proposedWording);
  assert.equal(approved.checkpoints[0].checkpointType, "verbatim");
  assert.equal(approved.checkpoints[0].exactWording, true);
  assert.equal(approved.checkpoints[0].materialStatus, "unplaced");
  assert.deepEqual(approved.checkpoints[0].canonicalTargets, []);
  assert.deepEqual(
    approved.checkpoints[0].sourceRefs.map((sourceRef) => sourceRef.speaker),
    ["assistant", "dan"]
  );

  const finalized = await finalizeSermonDevelopmentSession({
    sessionId: started.session.sessionId,
    expectedDanTurnCount: 3,
    finalTranscript: "Close this session and verify the complete record.",
    assistantTranscript: "The session is closed and verified.",
    summary: "Dan approved one exact Chat proposal."
  }, deps);
  assert.equal(finalized.session.turnCount, 6);
  assert.equal(finalized.session.danTurnCount, 3);
  assert.equal(finalized.session.assistantTurnCount, 3);
  assert.match(finalized.transcriptSource.material, /A token should stabilize faith/);
  assert.match(finalized.transcriptSource.material, /Exactly what you just said/);
  assert.doesNotMatch(finalized.transcriptSource.material, /gives you strength to keep walking/);
  assert.equal(finalized.transcriptSource.sourceRefs[0].capturedTurnCount, 3);
  assert.equal(finalized.transcriptSource.sourceRefs[0].capturedAssistantTurnCount, 3);
  assert.equal(finalized.completionReceipt.transcriptSourceId, finalized.transcriptSource.sourceId);
  assert.equal(finalized.completionReceipt.unplacedCheckpointCount, 2);
});

test("recognizes Dan's concise voice phrases for approving Chat wording", async () => {
  const phrases = [
    "Save that exact wording.",
    "Save exactly how you just said that.",
    "That's good, make sure we save that.",
    "Keep that exact wording.",
    "I really like the exact way you said that."
  ];

  for (const [index, approval] of phrases.entries()) {
    const deps = createDeps();
    const sermon = await createSermon({ title: `Voice approval ${index + 1}` }, deps);
    const session = await startSermonDevelopmentSession({ sermonId: sermon.sermon.sermonId }, deps);
    const exactWording = `Exact assistant wording ${index + 1}.`;

    await captureSermonDevelopmentTurn({
      sermonId: sermon.sermon.sermonId,
      sessionId: session.session.sessionId,
      transcript: "Help me clarify that thought.",
      assistantTranscript: exactWording
    }, deps);
    const result = await captureSermonDevelopmentTurn({
      sermonId: sermon.sermon.sermonId,
      sessionId: session.session.sessionId,
      transcript: approval,
      assistantTranscript: "Saved."
    }, deps);

    assert.equal(result.assistantApproval.detected, true, approval);
    assert.equal(result.assistantApproval.preserved, true, approval);
    const checkpoint = result.checkpoints.find((item) => item.heading === "Approved Chat wording");
    assert.equal(checkpoint?.content, exactWording, approval);
    assert.equal(checkpoint?.exactWording, true, approval);
    assert.equal(checkpoint?.materialStatus, "unplaced", approval);
  }
});

test("preserves approved Chat draft blocks as shapeable material without saving planning chatter", async () => {
  const deps = createDeps();
  const sermon = await createSermon({ title: "Approved assistant material" }, deps);
  const session = await startSermonDevelopmentSession({ sermonId: sermon.sermon.sermonId }, deps);
  const opening = "Job's friends saw the pain, but they did not understand what God was doing.";
  const definition = "A token is recognizable confirmation that strengthens faith inside the believer.";
  const assistantDraft = [
    "Here are the two sections I recommend:",
    ":::writing{variant=\"document\" id=\"opening\"}",
    opening,
    ":::",
    "This second section belongs before the illustration:",
    ":::writing{variant=\"document\" id=\"definition\"}",
    definition,
    ":::",
    "Do you want both included?"
  ].join("\n");

  await captureSermonDevelopmentTurn({
    sermonId: sermon.sermon.sermonId,
    sessionId: session.session.sessionId,
    transcript: "Show me the unused opening and definition material.",
    assistantTranscript: assistantDraft
  }, deps);
  const approved = await captureSermonDevelopmentTurn({
    sermonId: sermon.sermon.sermonId,
    sessionId: session.session.sessionId,
    transcript: "I love all that and think we should move forward with it, so include both.",
    assistantTranscript: "Both approved sections are preserved for shaping."
  }, deps);

  assert.equal(approved.assistantApproval.detected, true);
  assert.equal(approved.assistantApproval.approvalType, "approved_material");
  assert.equal(approved.assistantApproval.preserved, true);
  assert.equal(approved.assistantApproval.checkpointIds.length, 2);
  assert.deepEqual(approved.checkpoints.map((checkpoint) => checkpoint.content), [opening, definition]);
  assert.deepEqual(approved.checkpoints.map((checkpoint) => checkpoint.checkpointType), ["insight", "insight"]);
  assert.ok(approved.checkpoints.every((checkpoint) => checkpoint.exactWording === false));
  assert.ok(approved.checkpoints.every((checkpoint) => !checkpoint.content.includes("Here are the two sections")));
  assert.ok(approved.checkpoints.every((checkpoint) =>
    checkpoint.sourceRefs.some((sourceRef) => sourceRef.speaker === "assistant") &&
    checkpoint.sourceRefs.some((sourceRef) => sourceRef.speaker === "dan")));
});

test("treats save that movement as general approval and reuses the clean supplied checkpoint", async () => {
  const deps = createDeps();
  const sermon = await createSermon({ title: "Save movement approval" }, deps);
  const session = await startSermonDevelopmentSession({ sermonId: sermon.sermon.sermonId }, deps);
  const movement = [
    "Be thankful for what God is building in the season.",
    "God calls us to give thanks in the season because He is present and purposeful.",
    "You may not be thankful for the pain itself, but you can thank God that the pain will not be wasted."
  ].join("\n\n");

  await captureSermonDevelopmentTurn({
    sermonId: sermon.sermon.sermonId,
    sessionId: session.session.sessionId,
    transcript: "Build that movement with biblical understanding.",
    assistantTranscript: `Good. Here is the movement:\n\n${movement}\n\nDoes that landing sound right?`
  }, deps);
  const approved = await captureSermonDevelopmentTurn({
    sermonId: sermon.sermon.sermonId,
    sessionId: session.session.sessionId,
    transcript: "Can you save that movement for this message?",
    checkpoints: [{
      checkpointType: "structure",
      heading: "Be thankful for what God is building in the season",
      content: movement,
      context: "Approved assistant-authored movement for this sermon.",
      exactWording: false
    }],
    assistantTranscript: "The movement is preserved as shapeable sermon material."
  }, deps);

  assert.equal(approved.assistantApproval.detected, true);
  assert.equal(approved.assistantApproval.approvalType, "approved_material");
  assert.equal(approved.assistantApproval.preserved, true);
  assert.equal(approved.checkpoints.length, 1);
  assert.equal(approved.checkpoints[0].content, movement);
  assert.equal(approved.checkpoints[0].checkpointType, "structure");
  assert.equal(approved.checkpoints[0].exactWording, false);
  assert.doesNotMatch(approved.checkpoints[0].content, /Does that landing/);
  assert.equal(
    deps.sermonDevelopmentSessionsCollection.store.get(session.session.sessionId).checkpointCount,
    1
  );
});

test("finalization reuses an already placed checkpoint linked to the replayed closing turn", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-final-replay-checkpoint": {
        sermonId: "sermon-final-replay-checkpoint",
        title: "Final Replay Checkpoint",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-final-replay-checkpoint",
    mode: "voice"
  }, deps);
  const movement = [
    "Be thankful for what God is building in the season.",
    "You may not be thankful for the pain itself, but you can thank God that the pain will not be wasted."
  ].join("\n\n");
  await captureSermonDevelopmentTurn({
    sermonId: "sermon-final-replay-checkpoint",
    sessionId: started.session.sessionId,
    transcript: "Build the gratitude movement.",
    assistantTranscript: `Here is the movement:\n\n${movement}\n\nDoes that landing sound right?`
  }, deps);
  const closingDanTranscript = "Can you save that movement for this message?";
  const closingAssistantTranscript = "The movement is preserved as shapeable sermon material.";
  const captured = await captureSermonDevelopmentTurn({
    sermonId: "sermon-final-replay-checkpoint",
    sessionId: started.session.sessionId,
    transcript: closingDanTranscript,
    checkpoints: [{
      checkpointType: "structure",
      heading: "Be thankful for what God is building in the season",
      content: movement,
      context: "Approved assistant-authored movement for this sermon."
    }],
    assistantTranscript: closingAssistantTranscript
  }, deps);
  await updateSermonDevelopmentCheckpointPlacement({
    checkpointId: captured.checkpoints[0].checkpointId,
    materialStatus: "placed",
    placementTarget: "After God's delay"
  }, deps);

  const finalized = await finalizeSermonDevelopmentSession({
    sessionId: started.session.sessionId,
    expectedDanTurnCount: 2,
    finalTranscript: closingDanTranscript,
    assistantTranscript: closingAssistantTranscript
  }, deps);

  assert.equal(finalized.action, "closed");
  assert.equal(finalized.session.turnCount, 4);
  assert.equal(finalized.session.danTurnCount, 2);
  assert.equal(finalized.session.assistantTurnCount, 2);
  assert.equal(finalized.session.checkpointCount, 1);
  assert.equal(finalized.finalTurn.sequence, 3);
  assert.equal(finalized.finalAssistantTurn.sequence, 4);
  assert.equal(finalized.finalCheckpoints.length, 0);
  assert.equal(deps.sermonDevelopmentCheckpointsCollection.store.size, 1);
  assert.equal(
    deps.sermonDevelopmentCheckpointsCollection.store.get(captured.checkpoints[0].checkpointId).materialStatus,
    "placed"
  );
});

test("finalizes a live development session by capturing the final turn before closing", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-final-turn": {
        sermonId: "sermon-final-turn",
        title: "Final Turn Capture",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-final-turn",
    mode: "voice",
    label: "Final turn walk"
  }, deps);
  await captureSermonDevelopmentTurn({
    sermonId: "sermon-final-turn",
    sessionId: started.session.sessionId,
    sequence: 1,
    transcript: "The first complete thought is already captured."
  }, deps);

  const finalized = await finalizeSermonDevelopmentSession({
    sessionId: started.session.sessionId,
    expectedDanTurnCount: 2,
    finalSequence: 2,
    finalTranscript: "Save this final exact line, and then close the development session.",
    assistantTranscript: "The final line is saved and this session is now closed.",
    finalCheckpoints: [
      {
        checkpointType: "key_line",
        heading: "Final exact line",
        content: "Save this final exact line.",
        exactWording: true
      }
    ],
    summary: "Captured both substantive Dan turns."
  }, deps);

  assert.equal(finalized.action, "closed");
  assert.equal(finalized.session.danTurnCount, 2);
  assert.equal(finalized.finalTurn.sequence, 2);
  assert.equal(finalized.finalAssistantTurn.sequence, 3);
  assert.equal(finalized.finalCheckpoints.length, 1);
  assert.equal(finalized.finalCheckpoints[0].sourceRefs[0].type, "development_turn");
  assert.match(finalized.transcriptSource.material, /DAN TURN 2/);
  assert.match(finalized.transcriptSource.material, /then close the development session/);
});

test("refuses to close a live session from a count without the exact closing exchange", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-final-exchange-required": {
        sermonId: "sermon-final-exchange-required",
        title: "Final Exchange Required",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-final-exchange-required",
    mode: "voice"
  }, deps);
  await captureSermonDevelopmentTurn({
    sermonId: "sermon-final-exchange-required",
    sessionId: started.session.sessionId,
    transcript: "This substantive turn is captured.",
    assistantTranscript: "This reply is captured too."
  }, deps);

  await assert.rejects(
    () => finalizeSermonDevelopmentSession({
      sessionId: started.session.sessionId,
      expectedDanTurnCount: 1
    }, deps),
    { code: "missing_sermon_development_final_exchange", statusCode: 400 }
  );
  await assert.rejects(
    () => closeSermonDevelopmentSession({
      sessionId: started.session.sessionId,
      expectedDanTurnCount: 1,
      requireNonLiveSession: true
    }, deps),
    { code: "sermon_development_final_exchange_required", statusCode: 409 }
  );
  const sessions = await listSermonDevelopmentSessions({
    sermonId: "sermon-final-exchange-required"
  }, deps);
  assert.equal(sessions.sessions[0].status, "active");
  assert.equal(deps.sermonSourcesCollection.store.size, 0);
});

test("leaves a development session open when the expected Dan-turn count does not match", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-count-check": {
        sermonId: "sermon-count-check",
        title: "Count Check",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-count-check",
    mode: "voice"
  }, deps);
  await captureSermonDevelopmentTurn({
    sermonId: "sermon-count-check",
    sessionId: started.session.sessionId,
    sequence: 1,
    transcript: "Only one turn has reached the backend."
  }, deps);

  await assert.rejects(
    () => finalizeSermonDevelopmentSession({
      sessionId: started.session.sessionId,
      expectedDanTurnCount: 3,
      finalTranscript: "Close this session after preserving this exact request.",
      assistantTranscript: "The session is closed and verified."
    }, deps),
    {
      code: "sermon_development_turn_count_mismatch",
      statusCode: 409
    }
  );

  const sessions = await listSermonDevelopmentSessions({ sermonId: "sermon-count-check" }, deps);
  assert.equal(sessions.sessions[0].status, "active");
  assert.equal(deps.sermonSourcesCollection.store.size, 0);
});

test("reuses a captured final turn when correcting a mismatched finalization count", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-final-retry": {
        sermonId: "sermon-final-retry",
        title: "Final Retry",
        status: "developing"
      }
    }
  });
  const started = await startSermonDevelopmentSession({
    sermonId: "sermon-final-retry",
    mode: "voice"
  }, deps);
  await captureSermonDevelopmentTurn({
    sermonId: "sermon-final-retry",
    sessionId: started.session.sessionId,
    transcript: "First turn."
  }, deps);

  await assert.rejects(
    () => finalizeSermonDevelopmentSession({
      sessionId: started.session.sessionId,
      expectedDanTurnCount: 3,
      finalTranscript: "Final turn that must not be duplicated.",
      assistantTranscript: "Closing receipt that must not be duplicated."
    }, deps),
    { code: "sermon_development_turn_count_mismatch" }
  );
  assert.equal(deps.sermonDevelopmentTurnsCollection.store.size, 3);

  const finalized = await finalizeSermonDevelopmentSession({
    sessionId: started.session.sessionId,
    expectedDanTurnCount: 2,
    finalTranscript: "Final turn that must not be duplicated.",
    assistantTranscript: "Closing receipt that must not be duplicated."
  }, deps);
  assert.equal(finalized.action, "closed");
  assert.equal(finalized.finalTurn.sequence, 2);
  assert.equal(finalized.finalAssistantTurn.sequence, 3);
  assert.equal(deps.sermonDevelopmentTurnsCollection.store.size, 3);
});

test("tracks every development checkpoint as unplaced, placed, or intentionally cut", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-material": {
        sermonId: "sermon-material",
        title: "Material Tracking",
        status: "developing"
      }
    }
  });
  const saved = await saveSermonDevelopmentCheckpoint({
    sermonId: "sermon-material",
    checkpoints: [
      { checkpointType: "key_line", content: "Grace carries what effort cannot." },
      { checkpointType: "illustration", content: "Use the bridge illustration." },
      { checkpointType: "insight", content: "A true but distracting side observation." }
    ]
  }, deps);
  assert.deepEqual(saved.checkpoints.map((checkpoint) => checkpoint.materialStatus), ["unplaced", "unplaced", "unplaced"]);

  const placed = await updateSermonDevelopmentCheckpointPlacement({
    checkpointId: saved.checkpoints[0].checkpointId,
    materialStatus: "placed",
    placementTarget: "Movement 2 - Grace carries us"
  }, deps);
  assert.equal(placed.checkpoint.materialStatus, "placed");
  assert.equal(placed.checkpoint.placementTarget, "Movement 2 - Grace carries us");

  await assert.rejects(
    updateSermonDevelopmentCheckpointPlacement({
      checkpointId: saved.checkpoints[2].checkpointId,
      materialStatus: "intentionally_cut",
      cutReason: "True, but it distracts from the controlling idea."
    }, deps),
    (error) => error.code === "dan_cut_authorization_required"
  );

  const cut = await updateSermonDevelopmentCheckpointPlacement({
    checkpointId: saved.checkpoints[2].checkpointId,
    materialStatus: "intentionally_cut",
    cutReason: "True, but it distracts from the controlling idea.",
    danAuthorizedCut: true,
    danApprovalEvidence: "Dan said: Cut that thought from this sermon."
  }, deps);
  assert.equal(cut.checkpoint.materialStatus, "intentionally_cut");
  assert.match(cut.checkpoint.cutReason, /distracts/);
  assert.equal(cut.checkpoint.cutAuthorizedBy, "dan");
  assert.match(cut.checkpoint.cutApprovalEvidence, /Dan said/);
  assert.equal(cut.checkpoint.materialStatusHistory.length, 1);

  const inventory = await getSermonMaterialInventory({ sermonId: "sermon-material" }, deps);
  assert.equal(inventory.summary.total, 3);
  assert.equal(inventory.summary.placed, 1);
  assert.equal(inventory.summary.unplaced, 1);
  assert.equal(inventory.summary.intentionallyCut, 1);
  assert.equal(inventory.summary.unplacedIllustrations, 1);
});

test("clears canonical targets from unplaced development checkpoints", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-unplaced-targets": {
        sermonId: "sermon-unplaced-targets",
        title: "Unplaced Targets",
        status: "developing"
      }
    }
  });
  const saved = await saveSermonDevelopmentCheckpoint({
    sermonId: "sermon-unplaced-targets",
    canonicalTargets: ["outline", "notes"],
    checkpoints: [
      {
        checkpointType: "insight",
        content: "Preserve this thought until Dan places it.",
        materialStatus: "unplaced"
      }
    ]
  }, deps);

  assert.equal(saved.checkpoints[0].materialStatus, "unplaced");
  assert.deepEqual(saved.checkpoints[0].canonicalTargets, []);
  assert.deepEqual(
    deps.sermonDevelopmentCheckpointsCollection.store.get(saved.checkpoints[0].checkpointId).canonicalTargets,
    []
  );

  const legacyRecord = deps.sermonDevelopmentCheckpointsCollection.store.get(saved.checkpoints[0].checkpointId);
  deps.sermonDevelopmentCheckpointsCollection.store.set(saved.checkpoints[0].checkpointId, {
    ...legacyRecord,
    canonicalTargets: ["outline", "notes"]
  });
  const listed = await listSermonDevelopmentCheckpoints({ sermonId: "sermon-unplaced-targets" }, deps);
  assert.deepEqual(listed.checkpoints[0].canonicalTargets, []);

  const placed = await updateSermonDevelopmentCheckpointPlacement({
    checkpointId: saved.checkpoints[0].checkpointId,
    materialStatus: "placed",
    canonicalTargets: ["outline"]
  }, deps);
  assert.deepEqual(placed.checkpoint.canonicalTargets, ["outline"]);

  const unplaced = await updateSermonDevelopmentCheckpointPlacement({
    checkpointId: saved.checkpoints[0].checkpointId,
    materialStatus: "unplaced"
  }, deps);
  assert.deepEqual(unplaced.checkpoint.canonicalTargets, []);
  assert.deepEqual(
    deps.sermonDevelopmentCheckpointsCollection.store.get(saved.checkpoints[0].checkpointId).canonicalTargets,
    []
  );
});

test("previews and applies a complete material-placement plan with stale protection", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-batch-material": {
        sermonId: "sermon-batch-material",
        title: "Batch Material",
        status: "developing"
      }
    }
  });
  const saved = await saveSermonDevelopmentCheckpoint({
    sermonId: "sermon-batch-material",
    checkpoints: [
      { checkpointType: "key_line", content: "Grace keeps us standing." },
      { checkpointType: "insight", content: "A true point that does not serve this sermon." }
    ]
  }, deps);
  const decisions = [
    {
      checkpointId: saved.checkpoints[0].checkpointId,
      materialStatus: "placed",
      placementTarget: "Conclusion"
    },
    {
      checkpointId: saved.checkpoints[1].checkpointId,
      materialStatus: "intentionally_cut",
      cutReason: "It does not serve the controlling idea."
    }
  ];
  const preview = await proposeSermonMaterialPlacement({
    sermonId: "sermon-batch-material",
    decisions,
    requireAllUnplaced: true
  }, deps);

  assert.equal(preview.before.unplaced, 2);
  assert.deepEqual(preview.after, { placed: 1, unplaced: 0, intentionallyCut: 1 });
  assert.match(preview.planHash, /^[a-f0-9]{64}$/);
  const unchanged = await getSermonMaterialInventory({ sermonId: "sermon-batch-material" }, deps);
  assert.equal(unchanged.summary.unplaced, 2);

  const applied = await applySermonMaterialPlacementPlan({
    sermonId: "sermon-batch-material",
    decisions,
    expectedPlanHash: preview.planHash,
    confirmed: true,
    requireAllUnplaced: true,
    danAuthorizedCuts: true,
    danApprovalEvidence: "Dan approved the displayed placement and cut plan."
  }, deps);
  assert.equal(applied.appliedCount, 2);
  assert.equal(applied.inventory.summary.placed, 1);
  assert.equal(applied.inventory.summary.intentionallyCut, 1);
  assert.equal(applied.inventory.summary.unplaced, 0);
  assert.equal(applied.inventory.materialFingerprint, preview.proposedMaterialFingerprint);

  const secondPreview = await proposeSermonMaterialPlacement({
    sermonId: "sermon-batch-material",
    decisions,
    requireAllUnplaced: true
  }, deps);
  await updateSermonDevelopmentCheckpointPlacement({
    checkpointId: saved.checkpoints[0].checkpointId,
    materialStatus: "placed",
    placementTarget: "Movement 3"
  }, deps);
  await assert.rejects(
    applySermonMaterialPlacementPlan({
      sermonId: "sermon-batch-material",
      decisions,
      expectedPlanHash: secondPreview.planHash,
      confirmed: true,
      requireAllUnplaced: true,
      danAuthorizedCuts: true,
      danApprovalEvidence: "Dan approved the displayed placement and cut plan."
    }, deps),
    (error) => error.code === "stale_sermon_material_placement_plan"
  );
});

test("uses occasion-relative structure, muse, finalization, and loading phases", async () => {
  const records = {
    sermons: {
      "sermon-rhythm": {
        sermonId: "sermon-rhythm",
        title: "A Sermon with Rhythm",
        status: "developing",
        scriptureText: "Mark 14:32-36",
        bigIdea: "We can trust the Father in seasons of heaviness.",
        outline: "Introduction: the weight of Gethsemane\n1. Bring the sorrow\n2. Trust the Father\nConclusion: nevertheless, Thy will be done",
        notes: "Tone: comforting and steady. Application: bring your heaviness to the Father."
      }
    },
    sermonSources: {
      "source-rhythm": {
        sourceId: "source-rhythm",
        sermonId: "sermon-rhythm",
        sourceType: "study_notes",
        material: "Mark 14 study material"
      }
    },
    sermonOccasions: {
      "occasion-rhythm": {
        occasionId: "occasion-rhythm",
        sermonId: "sermon-rhythm",
        status: "planned",
        date: "2026-07-05",
        time: "11:00",
        timeZone: "America/Los_Angeles"
      }
    },
    sermonDevelopmentCheckpoints: {
      "checkpoint-line": {
        checkpointId: "checkpoint-line",
        sermonId: "sermon-rhythm",
        checkpointType: "key_line",
        content: "The Father is not indifferent to your heaviness.",
        materialStatus: "placed",
        placementTarget: "Movement 2"
      },
      "checkpoint-illustration": {
        checkpointId: "checkpoint-illustration",
        sermonId: "sermon-rhythm",
        checkpointType: "illustration",
        content: "A child bringing a burden to a loving father.",
        materialStatus: "unplaced"
      }
    }
  };
  const structure = await evaluateSermonReadiness({ sermonId: "sermon-rhythm" }, createDeps({ ...records, now: "2026-07-01T17:00:00.000Z" }));
  const muse = await evaluateSermonReadiness({ sermonId: "sermon-rhythm" }, createDeps({ ...records, now: "2026-07-02T17:00:00.000Z" }));
  const finalization = await evaluateSermonReadiness({ sermonId: "sermon-rhythm" }, createDeps({ ...records, now: "2026-07-03T17:00:00.000Z" }));
  const loading = await evaluateSermonReadiness({ sermonId: "sermon-rhythm" }, createDeps({ ...records, now: "2026-07-05T17:00:00.000Z" }));

  assert.equal(structure.workflow.phase, "structure");
  assert.equal(muse.workflow.phase, "muse");
  assert.ok(muse.developmentTracks.museNeeds.includes("place_illustration"));
  assert.ok(muse.nextSteps.some((step) => step.code === "use_muse_window"));
  assert.equal(finalization.workflow.phase, "finalization");
  assert.equal(loading.workflow.phase, "pre_service_loading");
  assert.ok(loading.nextSteps.some((step) => step.code === "load_sermon_for_preaching"));
});

test("searches development note content from full sermon records", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-note-search": {
        sermonId: "sermon-note-search",
        title: "A Hidden Note Search",
        status: "developing",
        developmentNotes: [
          {
            noteId: "note-1",
            content: "Use the courtroom illustration for justification.",
            noteType: "illustration",
            createdAt: "2026-07-01T16:00:00.000Z"
          }
        ],
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const search = await listSermons({ query: "courtroom" }, deps);

  assert.equal(search.count, 1);
  assert.equal(search.sermons[0].sermonId, "sermon-note-search");
});

test("searches sermon records beyond the first thousand archive documents", async () => {
  const sermons = {};

  for (let index = 0; index < 1005; index += 1) {
    sermons[`sermon-filler-${index}`] = {
      sermonId: `sermon-filler-${index}`,
      title: `Filler sermon ${index}`,
      status: "preached",
      updatedAt: "2026-07-01T16:00:00.000Z"
    };
  }

  sermons["sermon-mercy-that-shapes"] = {
    sermonId: "sermon-mercy-that-shapes",
    title: "Mercy That Shapes, Fills, and Flows",
    status: "developing",
    scriptureText: "James 2:13",
    updatedAt: "2026-07-08T16:00:00.000Z"
  };

  const deps = createDeps({ sermons });
  const search = await listSermons({ query: "Mercy That Shapes", limit: 10 }, deps);

  assert.equal(search.count, 1);
  assert.equal(search.sermons[0].sermonId, "sermon-mercy-that-shapes");
});

test("appends sermon content with a snapshot", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-append": {
        sermonId: "sermon-append",
        title: "Receive the Word",
        status: "developing",
        outline: "1. Receive",
        developmentNotes: [],
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const result = await appendSermonContent(
    {
      sermonId: "sermon-append",
      appendType: "outline",
      heading: "Second movement",
      content: "2. Respond with obedience"
    },
    deps
  );

  assert.match(result.sermon.outline, /Second movement/);
  assert.equal(result.sermon.developmentNotes.length, 1);
  assert.equal(result.snapshot.snapshotType, "before_append");

  const snapshots = await listSermonSnapshots({ sermonId: "sermon-append" }, deps);
  assert.equal(snapshots.count, 1);
  assert.equal(snapshots.snapshots[0].sermonTitle, "Receive the Word");

  const snapshotDetail = await getSermonSnapshot({ snapshotId: snapshots.snapshots[0].snapshotId }, deps);
  assert.equal(snapshotDetail.snapshot.sermon.outline, "1. Receive");
});

test("source material append also saves a searchable source record", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-mercy": {
        sermonId: "sermon-mercy",
        folderId: "folder-james",
        title: "Mercy Triumphs",
        status: "developing",
        scriptureText: "James 2:1-13",
        notes: "",
        developmentNotes: [],
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const result = await appendSermonContent(
    {
      sermonId: "sermon-mercy",
      appendType: "source_material",
      sourceType: "old_chat",
      sourceLabel: "ChatGPT sermon development checkpoint",
      heading: "Mercy checkpoint",
      content: "Mercy rejoiceth against judgment in James 2:13."
    },
    deps
  );

  assert.equal(result.sourceSaved, true);
  assert.equal(result.source.sourceType, "old_chat");
  assert.match(result.sermon.notes, /Mercy checkpoint/);

  const sources = await listSermonSources({ sermonId: "sermon-mercy", query: "mercy rejoiceth" }, deps);
  assert.equal(sources.count, 1);
  assert.equal(sources.sources[0].sourceLabel, "ChatGPT sermon development checkpoint");
});

test("builds a workspace overview", async () => {
  const deps = createDeps({
    folders: {
      "folder-1": {
        folderId: "folder-1",
        name: "Romans",
        folderType: "series",
        status: "active",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermons: {
      "sermon-1": {
        sermonId: "sermon-1",
        folderId: "folder-1",
        title: "No Condemnation",
        status: "developing",
        targetDate: "2026-07-12",
        updatedAt: "2026-07-01T16:00:00.000Z"
      },
      "sermon-2": {
        sermonId: "sermon-2",
        title: "Loose idea",
        status: "idea",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const overview = await buildSermonWorkspaceOverview({}, deps);

  assert.equal(overview.summary.activeFolderCount, 1);
  assert.equal(overview.summary.openSermonCount, 2);
  assert.equal(overview.folders[0].openSermonCount, 1);
  assert.equal(overview.upcomingSermons[0].sermonId, "sermon-1");
  assert.equal(overview.unfiledSermons[0].sermonId, "sermon-2");
});

test("builds exact archive stats across sermons, sources, and chunks", async () => {
  const deps = createDeps({
    folders: {
      "folder-james": {
        folderId: "folder-james",
        name: "James - Living Our Faith",
        folderType: "series",
        status: "active",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermons: {
      "sermon-james-1": {
        sermonId: "sermon-james-1",
        folderId: "folder-james",
        title: "Let Patience Have Her Perfect Work",
        status: "preached",
        scriptureText: "James 1:2-4",
        searchText: "let patience have her perfect work james",
        updatedAt: "2026-07-01T16:00:00.000Z"
      },
      "sermon-romans-1": {
        sermonId: "sermon-romans-1",
        title: "No Condemnation",
        status: "draft",
        scriptureText: "Romans 8:1",
        searchText: "no condemnation romans",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-logos-james-1": {
        sourceId: "source-logos-james-1",
        sermonId: "sermon-james-1",
        folderId: "folder-james",
        sourceType: "logos_export",
        sourceLabel: "Let Patience Have Her Perfect Work",
        searchText: "logos export james trials patience",
        updatedAt: "2026-07-01T16:00:00.000Z"
      },
      "source-old-chat-romans-1": {
        sourceId: "source-old-chat-romans-1",
        sermonId: "sermon-romans-1",
        sourceType: "old_chat",
        sourceLabel: "Romans chat",
        searchText: "romans no condemnation",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonChunks: {
      "chunk-james-1": {
        chunkId: "chunk-james-1",
        sermonId: "sermon-james-1",
        folderId: "folder-james",
        sourceId: "source-logos-james-1",
        sourceKind: "source",
        title: "Let Patience Have Her Perfect Work",
        text: "James teaches believers to count trials joy.",
        textHash: "hash-james",
        embeddingTextHash: "hash-james",
        embeddingModel: "text-embedding-005"
      },
      "chunk-romans-1": {
        chunkId: "chunk-romans-1",
        sermonId: "sermon-romans-1",
        sourceId: "source-old-chat-romans-1",
        sourceKind: "source",
        title: "No Condemnation",
        text: "Romans 8 declares no condemnation.",
        textHash: "hash-romans"
      }
    }
  });

  const stats = await getSermonArchiveStats({ scriptureBook: "James", status: "preached" }, deps);

  assert.equal(stats.totals.sermons, 2);
  assert.equal(stats.totals.sources, 2);
  assert.equal(stats.totals.uniqueLogosSermons, 1);
  assert.equal(stats.totals.logosEmbeddedChunks, 1);
  assert.equal(stats.chunks.pending, 1);
  assert.equal(stats.sermons.byStatus.preached, 1);
  assert.equal(stats.folders[0].sermonCount, 1);
  assert.equal(stats.queryStats.matchingPreachedDistinctSermonCount, 0);
  assert.equal(stats.scriptureStats.matchingPreachedDistinctSermonCount, 1);
});

test("imports sermon material into a new sermon", async () => {
  const deps = createDeps({
    folders: {
      "folder-james": {
        folderId: "folder-james",
        name: "James - Living Our Faith",
        folderType: "series",
        status: "active",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const result = await importSermonMaterial(
    {
      folderId: "folder-james",
      title: "Receiving the Word Rightly",
      scriptureText: "James 1:21-25",
      importedSummary: "Old chat focused on meekly receiving and doing the Word.",
      importedMaterial: "Raw notes from old chat about receiving, hearing, and doing.",
      developmentNotes: [
        {
          content: "The mirror image should move from exposure to obedience.",
          noteType: "application"
        }
      ],
      sourceLabel: "Old ChatGPT James chat"
    },
    deps
  );

  assert.equal(result.action, "created");
  assert.equal(result.sermon.folderId, "folder-james");
  assert.equal(result.sermon.scriptureText, "James 1:21-25");
  assert.match(result.sermon.notes, /Old ChatGPT James chat/);
  assert.equal(result.sermon.developmentNotes.length, 1);
  assert.equal(result.sourceSaved, true);
  assert.equal(result.source.sourceType, "old_chat");
  assert.equal(result.source.sermonId, result.sermon.sermonId);
  assert.match(result.source.material, /Raw notes from old chat/);

  const sources = await listSermonSources({ sermonId: result.sermon.sermonId }, deps);
  assert.equal(sources.count, 1);
  assert.equal(sources.sources[0].sourceLabel, "Old ChatGPT James chat");
});

test("imports old chat into a sermon hub with searchable series metadata", async () => {
  const deps = createDeps();

  const result = await importSermonMaterial(
    {
      title: "Mercy That Shapes, Fills, and Flows",
      seriesTitle: "James — Living Our Faith",
      seriesNumber: 11,
      tags: ["mercy", "james"],
      scriptureText: "James 2:13",
      importedSummary: "Old chat about mercy getting the final word.",
      importedMaterial: "Mercy is what is supposed to come out.",
      sourceType: "old_chat",
      sourceLabel: "ChatGPT Mercy development"
    },
    deps
  );

  assert.equal(result.action, "created");
  assert.equal(result.sermon.folderId, "");
  assert.equal(result.sermon.seriesSlug, "james-living-our-faith");
  assert.equal(result.source.seriesSlug, "james-living-our-faith");
  assert.deepEqual(result.source.tags, ["mercy", "james"]);

  const sources = await listSermonSources({ seriesSlug: "james-living-our-faith", query: "final word" }, deps);
  assert.equal(sources.count, 1);
  assert.equal(sources.sources[0].sermonId, result.sermon.sermonId);
});

test("imports sermon material into an existing sermon without overwriting outline", async () => {
  const deps = createDeps({
    folders: {
      "folder-james": {
        folderId: "folder-james",
        name: "James - Living Our Faith",
        folderType: "series",
        status: "active",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermons: {
      "sermon-james-1-21": {
        sermonId: "sermon-james-1-21",
        folderId: "folder-james",
        title: "Receiving the Word Rightly",
        status: "developing",
        scriptureText: "James 1:21-25",
        bigIdea: "The received Word must become the obeyed Word.",
        outline: "1. Receive the Word\n2. Do the Word",
        notes: "Existing notes.",
        developmentNotes: [],
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const result = await importSermonMaterial(
    {
      folderId: "folder-james",
      title: "Receiving the Word Rightly",
      scriptureText: "James 1:21-25",
      outline: "Imported alternate outline",
      importedSummary: "Additional old chat material.",
      developmentNotes: ["Add a transition from implanted Word to obedient life."],
      sourceType: "study_notes"
    },
    deps
  );

  assert.equal(result.action, "updated");
  assert.match(result.sermon.outline, /Receive the Word/);
  assert.match(result.sermon.outline, /Imported alternate outline/);
  assert.match(result.sermon.notes, /Additional old chat material/);
  assert.equal(result.sermon.developmentNotes.length, 1);
  assert.equal(result.snapshot.snapshotType, "before_import");
  assert.equal(result.sourceSaved, true);
  assert.equal(result.source.sourceType, "study_notes");
});

test("batch imports Logos sermon material and rebuilds chunks", async () => {
  const deps = createDeps({
    folders: {
      "folder-logos": {
        folderId: "folder-logos",
        name: "Logos Archive",
        folderType: "archive",
        status: "active",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const result = await importSermonMaterialBatch(
    {
      items: [
        {
          folderId: "folder-logos",
          title: "A Faith That Works",
          scriptureText: "James 2:14-26",
          preachedDate: "2024-05-12",
          status: "preached",
          occasions: [
            {
              date: "2024-05-12",
              time: "10:30",
              venue: "Faith Baptist Church",
              service: "Sunday Morning"
            },
            {
              date: "2025-02-02",
              time: "18:00",
              venue: "Tacoma Rescue Mission",
              service: "Evening Chapel"
            }
          ],
          sourceLabel: "Logos export - A Faith That Works",
          importedMaterial: "Full manuscript from Logos about faith working through love."
        },
        {
          folderId: "folder-logos",
          title: "The Tongue and the Fire",
          scriptureText: "James 3:1-12",
          sourceLabel: "Logos export - The Tongue and the Fire",
          importedMaterial: "Full manuscript from Logos about disciplined speech."
        }
      ],
      rebuildChunks: true
    },
    deps
  );

  assert.equal(result.importedCount, 2);
  assert.equal(result.errorCount, 0);
  assert.equal(result.results[0].source.sourceType, "logos_export");
  assert.equal(result.results[0].occasions.length, 2);
  assert.equal(result.results[0].sermon.occasionCount, 2);
  assert.ok(result.results[0].rebuild.chunkCount >= 1);

  const sources = await listSermonSources({ sourceType: "logos_export", limit: 10 }, deps);
  assert.equal(sources.count, 2);
});

test("creates, lists, and fetches sermon source records", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-source": {
        sermonId: "sermon-source",
        folderId: "folder-james",
        title: "The Implanted Word",
        status: "developing",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const created = await createSermonSource(
    {
      sermonId: "sermon-source",
      sourceType: "transcript",
      sourceLabel: "Sunday evening transcript",
      summary: "Transcript emphasizes meekness before the Word.",
      material: "Full transcript material with mirror imagery."
    },
    deps
  );

  assert.equal(created.source.sourceType, "transcript");
  assert.equal(created.source.folderId, "folder-james");

  const listed = await listSermonSources({ sermonId: "sermon-source", query: "mirror" }, deps);
  assert.equal(listed.count, 1);
  assert.equal(listed.sources[0].sourceId, created.source.sourceId);

  const fetched = await getSermonSource({ sourceId: created.source.sourceId }, deps);
  assert.match(fetched.source.material, /mirror imagery/);
});

test("refreshes the downloadable DOCX URL when fetching a generated manuscript source", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-manuscript-download": {
        sermonId: "sermon-manuscript-download",
        title: "Downloadable Manuscript",
        status: "draft"
      }
    }
  });
  const storagePath = "sermon-manuscripts/sermon-manuscript-download/manuscript.docx";
  const created = await createSermonSource({
    sermonId: "sermon-manuscript-download",
    sourceType: "doc",
    sourceLabel: "Generated manuscript draft",
    material: "Complete manuscript text.",
    sourceRefs: [{
      type: "cloud_storage_docx",
      role: "manuscript_draft",
      storagePath,
      filename: "manuscript.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 1234,
      downloadUrlExpiresAt: "2026-07-01T00:00:00.000Z"
    }]
  }, deps);
  deps.createSermonSourceDownload = async ({ source, sourceRef }) => {
    assert.equal(source.sourceId, created.source.sourceId);
    assert.equal(sourceRef.storagePath, storagePath);
    return {
      ...sourceRef,
      downloadUrl: "https://storage.example.test/fresh-manuscript.docx",
      downloadUrlExpiresAt: "2026-07-26T00:00:00.000Z"
    };
  };

  const fetched = await getSermonSource({ sourceId: created.source.sourceId }, deps);

  assert.equal(fetched.filename, "manuscript.docx");
  assert.equal(fetched.downloadUrl, "https://storage.example.test/fresh-manuscript.docx");
  assert.equal(fetched.download.downloadUrlExpiresAt, "2026-07-26T00:00:00.000Z");
  assert.equal(fetched.source.downloadUrl, fetched.downloadUrl);
  assert.equal(fetched.source.sourceRefs[0].downloadUrl, fetched.downloadUrl);
});

test("saves Personal Scripture Commentary as a first-class sermon source", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-commentary": {
        sermonId: "sermon-commentary",
        title: "The Lord Upholdeth the Righteous",
        status: "developing"
      }
    },
    scriptureNotes: {
      "scripture-note-psalm-37-17": {
        scriptureNoteId: "scripture-note-psalm-37-17",
        reference: "Psalm 37:17",
        sermonIds: []
      }
    }
  });

  const created = await createSermonSource({
    sermonId: "sermon-commentary",
    sourceType: "scripture_notes",
    sourceLabel: "Personal Scripture Commentary - Psalm 37:17",
    material: "The same grace that made me righteous is the grace that keeps me standing.",
    sourceRefs: [{ type: "personal_scripture_note", scriptureNoteId: "scripture-note-psalm-37-17" }]
  }, deps);

  assert.equal(created.source.sourceType, "scripture_commentary");
  assert.equal(created.source.sourceRefs[0].scriptureNoteId, "scripture-note-psalm-37-17");
  assert.equal(created.commentaryLinks.linked, 1);
  const linkedNote = deps.scriptureNotesCollection.store.get("scripture-note-psalm-37-17");
  assert.deepEqual(linkedNote.sermonIds, ["sermon-commentary"]);
  assert.deepEqual(linkedNote.sermonSourceIds, [created.source.sourceId]);
});

test("preserves normal long sermon transcript source records without the old 24k cap", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-long-transcript": {
        sermonId: "sermon-long-transcript",
        title: "Long Transcript Sermon",
        status: "preached",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });
  const longTranscript = `${"This is a preached transcript paragraph about mercy and hope.\n".repeat(600)}FINAL TRANSCRIPT SENTENCE`;

  const created = await createSermonSource(
    {
      sermonId: "sermon-long-transcript",
      sourceType: "preached_transcript",
      sourceLabel: "Long preached transcript",
      material: longTranscript
    },
    deps
  );

  const fetched = await getSermonSource({ sourceId: created.source.sourceId }, deps);

  assert.ok(longTranscript.length > 24000);
  assert.equal(fetched.source.material, longTranscript);
  assert.match(fetched.source.material, /FINAL TRANSCRIPT SENTENCE$/);
});

test("searches source records across the sermon archive", async () => {
  const deps = createDeps({
    sermonSources: {
      "source-faith": {
        sourceId: "source-faith",
        sermonId: "sermon-faith",
        folderId: "folder-james",
        sourceType: "old_chat",
        sourceLabel: "Faith and works chat",
        summary: "Material about living faith and obedience.",
        material: "Faith works through obedient love.",
        createdAt: "2026-07-01T17:00:00.000Z",
        updatedAt: "2026-07-01T17:00:00.000Z"
      },
      "source-trials": {
        sourceId: "source-trials",
        sermonId: "sermon-trials",
        folderId: "folder-james",
        sourceType: "transcript",
        sourceLabel: "Trials transcript",
        summary: "Material about patience in trials.",
        material: "Let patience have her perfect work.",
        createdAt: "2026-07-02T17:00:00.000Z",
        updatedAt: "2026-07-02T17:00:00.000Z"
      }
    }
  });

  const results = await listSermonSources({ query: "obedient", limit: 10 }, deps);

  assert.equal(results.count, 1);
  assert.equal(results.sources[0].sourceId, "source-faith");
  assert.equal(results.sources[0].sermonId, "sermon-faith");
});

test("creates, lists, fetches, and updates sermon media records", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-media": {
        sermonId: "sermon-media",
        folderId: "folder-james",
        title: "Ask God for Wisdom",
        status: "preached",
        preachedDate: "2026-01-28",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const created = await createSermonMedia(
    {
      sermonId: "sermon-media",
      mediaType: "youtube",
      title: "Ask God for Wisdom - YouTube",
      url: "https://www.youtube.com/live/TTiWO88Tjm8?si=X4UxhrBmXtyM6jro&t=6274"
    },
    deps
  );

  assert.equal(created.media.mediaType, "youtube");
  assert.equal(created.media.folderId, "folder-james");
  assert.equal(created.media.recordedAt, "2026-01-28");
  assert.equal(created.media.externalId, "TTiWO88Tjm8");
  assert.equal(created.media.startSeconds, 6274);

  const listed = await listSermonMedia({ sermonId: "sermon-media", query: "youtube" }, deps);
  assert.equal(listed.count, 1);
  assert.equal(listed.media[0].mediaId, created.media.mediaId);

  const updated = await updateSermonMedia(
    {
      mediaId: created.media.mediaId,
      changes: {
        transcriptStatus: "pending",
        durationSeconds: 2700
      }
    },
    deps
  );
  assert.equal(updated.media.transcriptStatus, "pending");
  assert.equal(updated.media.durationSeconds, 2700);

  const fetched = await getSermonMedia({ mediaId: created.media.mediaId }, deps);
  assert.equal(fetched.media.externalId, "TTiWO88Tjm8");
});

test("creates sermon source material from a media transcript", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-transcript": {
        sermonId: "sermon-transcript",
        folderId: "folder-james",
        title: "Sorrow and Grief Feedback",
        status: "preached",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonMedia: {
      "media-1": {
        mediaId: "media-1",
        sermonId: "sermon-transcript",
        folderId: "folder-james",
        mediaType: "audio",
        platform: "audio",
        title: "Voice memo",
        label: "Voice memo",
        storagePath: "sermon-media/sermon-transcript/media-1/audio.m4a",
        transcriptStatus: "none",
        createdAt: "2026-07-01T16:00:00.000Z",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const result = await createSermonMediaTranscriptSource(
    {
      mediaId: "media-1",
      transcriptKind: "raw",
      transcriptText: "This is the preached transcript about sorrow and grief.",
      summary: "Raw transcript from preached audio."
    },
    deps
  );

  assert.equal(result.source.sourceType, "preached_transcript");
  assert.equal(result.media.transcriptStatus, "raw_saved");
  assert.equal(result.media.transcriptSourceIds.raw, result.source.sourceId);
  assert.equal(result.source.sourceRefs[0].mediaId, "media-1");

  const sources = await listSermonSources({ sermonId: "sermon-transcript", sourceType: "preached_transcript" }, deps);
  assert.equal(sources.count, 1);
});

test("retrieves full sermon context for continuing development", async () => {
  const deps = createDeps({
    folders: {
      "folder-james": {
        folderId: "folder-james",
        name: "James - Living Our Faith",
        folderType: "series",
        status: "active",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermons: {
      "sermon-context": {
        sermonId: "sermon-context",
        folderId: "folder-james",
        title: "Doers of the Word",
        status: "developing",
        scriptureText: "James 1:22-25",
        bigIdea: "True hearing becomes obedient doing.",
        developmentNotes: [
          {
            noteId: "note-1",
            content: "Use the mirror image carefully.",
            noteType: "illustration",
            createdAt: "2026-07-01T16:00:00.000Z"
          }
        ],
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-1": {
        sourceId: "source-1",
        sermonId: "sermon-context",
        folderId: "folder-james",
        sourceType: "old_chat",
        sourceLabel: "Old chat",
        summary: "Old chat summary about obedience.",
        material: "Long old chat material.",
        createdAt: "2026-07-01T17:00:00.000Z",
        updatedAt: "2026-07-01T17:00:00.000Z"
      }
    },
    sermonSnapshots: {
      "snapshot-1": {
        snapshotId: "snapshot-1",
        sermonId: "sermon-context",
        snapshotType: "before_update",
        reason: "Before update",
        createdAt: "2026-07-01T18:00:00.000Z",
        sermon: {
          sermonId: "sermon-context",
          title: "Doers of the Word",
          status: "idea",
          updatedAt: "2026-07-01T16:00:00.000Z"
        }
      }
    },
    preachingProfiles: {
      default: {
        profileId: "default",
        summary: "Dan preaches with a pastoral, direct tone.",
        tone: ["pastoral"],
        observations: [],
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    preachingAnalyses: {
      "analysis-1": {
        analysisId: "analysis-1",
        sermonId: "sermon-context",
        title: "Transcript analysis",
        summary: "Strong application.",
        analyzedAt: "2026-07-01T19:00:00.000Z"
      }
    }
  });

  const context = await getSermonContext({ sermonId: "sermon-context" }, deps);

  assert.equal(context.sermon.title, "Doers of the Word");
  assert.equal(context.folder.name, "James - Living Our Faith");
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].sourceLabel, "Old chat");
  assert.equal(Object.prototype.hasOwnProperty.call(context.sources[0], "material"), false);
  assert.equal(context.recentSnapshots.length, 1);
  assert.equal(context.preachingAnalyses.length, 1);
  assert.match(context.preachingProfile.summary, /pastoral/);
  assert.equal(context.counts.sourceCount, 1);

  const contextWithMaterial = await getSermonContext(
    {
      sermonId: "sermon-context",
      includeSourceMaterial: true
    },
    deps
  );
  assert.match(contextWithMaterial.sources[0].material, /Long old chat material/);
});

test("prioritizes the primary manuscript source in sermon context", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-refined": {
        sermonId: "sermon-refined",
        title: "Mercy in Motion",
        status: "preached",
        primaryManuscriptSourceId: "source-refined",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-original": {
        sourceId: "source-original",
        sermonId: "sermon-refined",
        sourceType: "old_chat",
        sourceLabel: "Original preparation notes",
        material: "Original notes for the first version.",
        createdAt: "2026-07-10T18:00:00.000Z",
        updatedAt: "2026-07-10T18:00:00.000Z"
      },
      "source-refined": {
        sourceId: "source-refined",
        sermonId: "sermon-refined",
        sourceType: "doc",
        sourceLabel: "Refined future preaching manuscript",
        material: "Refined manuscript for future preaching.",
        createdAt: "2026-07-01T18:00:00.000Z",
        updatedAt: "2026-07-01T18:00:00.000Z"
      }
    }
  });

  const context = await getSermonContext(
    {
      sermonId: "sermon-refined",
      includeSourceMaterial: true
    },
    deps
  );

  assert.equal(context.sermon.primaryManuscriptSourceId, "source-refined");
  assert.equal(context.sources[0].sourceId, "source-refined");
  assert.equal(context.sources[0].sourceLabel, "Refined future preaching manuscript");
  assert.match(context.sources[0].material, /Refined manuscript/);
});

test("rejects a primary manuscript source from another sermon", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-a": {
        sermonId: "sermon-a",
        title: "First sermon",
        updatedAt: "2026-07-01T16:00:00.000Z"
      },
      "sermon-b": {
        sermonId: "sermon-b",
        title: "Second sermon",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-b": {
        sourceId: "source-b",
        sermonId: "sermon-b",
        sourceType: "doc",
        sourceLabel: "Second sermon manuscript",
        material: "Second sermon material.",
        createdAt: "2026-07-01T18:00:00.000Z",
        updatedAt: "2026-07-01T18:00:00.000Z"
      }
    }
  });

  await assert.rejects(
    () => updateSermon(
      {
        sermonId: "sermon-a",
        changes: { primaryManuscriptSourceId: "source-b" }
      },
      deps
    ),
    /Primary manuscript source must belong to this sermon/
  );
});

test("rebuilds and searches sermon chunks", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-chunks": {
        sermonId: "sermon-chunks",
        folderId: "folder-james",
        title: "Faith That Works",
        status: "developing",
        scriptureText: "James 2:14-26",
        bigIdea: "Living faith shows itself through obedient works.",
        outline: "1. Empty claims\n2. Visible faith",
        notes: "Connect faith and obedience without confusing root and fruit.",
        developmentNotes: [
          {
            noteId: "note-works",
            content: "Use Abraham as the main biblical illustration.",
            noteType: "illustration",
            createdAt: "2026-07-01T16:00:00.000Z"
          }
        ],
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    },
    sermonSources: {
      "source-faith": {
        sourceId: "source-faith",
        sermonId: "sermon-chunks",
        folderId: "folder-james",
        sourceType: "old_chat",
        sourceLabel: "Old faith and works chat",
        summary: "Old chat summary about obedient faith.",
        material: "Faith is not made alive by works, but living faith is never alone.",
        createdAt: "2026-07-01T17:00:00.000Z",
        updatedAt: "2026-07-01T17:00:00.000Z"
      }
    },
    sermonChunks: {
      "chunk-stale": {
        chunkId: "chunk-stale",
        sermonId: "sermon-chunks",
        text: "stale text",
        updatedAt: "2026-06-01T17:00:00.000Z"
      }
    }
  });

  const rebuilt = await rebuildSermonChunks({ sermonId: "sermon-chunks" }, deps);

  assert.equal(rebuilt.sermonId, "sermon-chunks");
  assert.equal(rebuilt.deletedChunkCount, 1);
  assert.ok(rebuilt.chunkCount >= 5);
  assert.equal(rebuilt.chunks.some((chunk) => chunk.chunkId === "chunk-stale"), false);

  const results = await searchSermonChunks({ query: "abraham", sermonId: "sermon-chunks" }, deps);
  assert.equal(results.count, 1);
  assert.equal(results.chunks[0].sourceKind, "sermon");
  assert.match(results.chunks[0].text, /Abraham/);

  const sourceResults = await searchSermonChunks({ query: "living faith", sourceKind: "source" }, deps);
  assert.equal(sourceResults.count, 1);
  assert.equal(sourceResults.chunks[0].sourceId, "source-faith");
});

test("searches sermon chunks beyond the first two thousand archive documents", async () => {
  const sermonChunks = {};

  for (let index = 0; index < 2005; index += 1) {
    sermonChunks[`chunk-filler-${index}`] = {
      chunkId: `chunk-filler-${index}`,
      sermonId: `sermon-filler-${index}`,
      sourceKind: "sermon",
      chunkType: "notes",
      title: `Filler chunk ${index}`,
      text: `Filler text ${index}`,
      updatedAt: "2026-07-01T16:00:00.000Z"
    };
  }

  sermonChunks["chunk-mercy"] = {
    chunkId: "chunk-mercy",
    sermonId: "sermon-mercy",
    sourceKind: "source",
    chunkType: "material",
    title: "Mercy That Shapes, Fills, and Flows",
    text: "Mercy gets the final word over judgment.",
    updatedAt: "2026-07-08T16:00:00.000Z"
  };

  const deps = createDeps({ sermonChunks });
  const results = await searchSermonChunks({ sermonId: "sermon-mercy", query: "final word", limit: 10 }, deps);

  assert.equal(results.count, 1);
  assert.equal(results.chunks[0].chunkId, "chunk-mercy");
});

test("embeds pending sermon chunks and skips current embeddings", async () => {
  let embedCallCount = 0;
  const deps = createDeps({
    sermonChunks: {
      "chunk-one": {
        chunkId: "chunk-one",
        sermonId: "sermon-embed",
        sourceKind: "sermon",
        chunkType: "notes",
        title: "Embedded Notes",
        text: "Obedience flows from faith.",
        textHash: "hash-one",
        updatedAt: "2026-07-01T16:00:00.000Z"
      },
      "chunk-current": {
        chunkId: "chunk-current",
        sermonId: "sermon-embed",
        sourceKind: "sermon",
        chunkType: "outline",
        title: "Current Outline",
        text: "Already embedded.",
        textHash: "hash-current",
        embedding: [0.1, 0.2, 0.3],
        embeddingVector: { vector: [0.1, 0.2, 0.3] },
        embeddingModel: "test-embedding-model",
        embeddingTextHash: "hash-current",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });
  deps.embeddingModel = "test-embedding-model";
  deps.embedText = async (text, options) => {
    embedCallCount += 1;
    assert.equal(options.model, "test-embedding-model");
    assert.equal(options.taskType, "RETRIEVAL_DOCUMENT");
    return [text.length, 1, 0];
  };
  deps.toVectorValue = (embedding) => ({ vector: embedding });

  const embedded = await embedSermonChunks({ sermonId: "sermon-embed", limit: 10 }, deps);

  assert.equal(embedded.matchingChunkCount, 2);
  assert.equal(embedded.pendingChunkCount, 1);
  assert.equal(embedded.embeddedCount, 1);
  assert.equal(embedCallCount, 1);
  assert.deepEqual(
    deps.sermonChunksCollection.store.get("chunk-one").embeddingVector,
    { vector: [27, 1, 0] }
  );

  const secondRun = await embedSermonChunks({ sermonId: "sermon-embed", limit: 10 }, deps);
  assert.equal(secondRun.pendingChunkCount, 0);
  assert.equal(secondRun.embeddedCount, 0);
  assert.equal(embedCallCount, 1);
});

test("semantically searches embedded sermon chunks with a query vector", async () => {
  let embedOptions = null;
  let nearestOptions = null;
  const deps = createDeps();
  deps.embeddingModel = "test-embedding-model";
  deps.embedText = async (text, options) => {
    assert.equal(text, "faithful obedience");
    embedOptions = options;
    return [0.2, 0.4, 0.8];
  };
  deps.findNearestChunks = async (queryEmbedding, options) => {
    assert.deepEqual(queryEmbedding, [0.2, 0.4, 0.8]);
    nearestOptions = options;
    return [
      {
        id: "chunk-near",
        data: {
          chunkId: "chunk-near",
          sermonId: "sermon-james",
          folderId: "folder-james",
          sourceKind: "source",
          sourceId: "source-old-chat",
          chunkType: "source_old_chat_material",
          title: "Old Chat",
          scriptureText: "James 1:22",
          text: "Real hearing becomes practiced obedience.",
          vectorDistance: 0.11,
          updatedAt: "2026-07-01T17:00:00.000Z"
        }
      },
      {
        id: "chunk-other",
        data: {
          chunkId: "chunk-other",
          sermonId: "sermon-other",
          folderId: "folder-other",
          sourceKind: "sermon",
          chunkType: "notes",
          title: "Other",
          text: "A less relevant chunk.",
          vectorDistance: 0.9
        }
      }
    ];
  };

  const results = await semanticSearchSermonChunks(
    {
      query: "faithful obedience",
      sermonId: "sermon-james",
      sourceKind: "source",
      limit: 5
    },
    deps
  );

  assert.equal(embedOptions.model, "test-embedding-model");
  assert.equal(embedOptions.taskType, "RETRIEVAL_QUERY");
  assert.equal(nearestOptions.limit, 25);
  assert.equal(nearestOptions.distanceMeasure, "COSINE");
  assert.equal(results.count, 1);
  assert.equal(results.candidateCount, 2);
  assert.equal(results.chunks[0].chunkId, "chunk-near");
  assert.equal(results.chunks[0].vectorDistance, 0.11);
});

test("answers sermon questions from retrieved chunk context with citations", async () => {
  const deps = createDeps();
  let generatedInput = null;
  deps.embeddingModel = "test-embedding-model";
  deps.embedText = async () => [0.3, 0.2, 0.1];
  deps.findNearestChunks = async () => [
    {
      id: "chunk-obedience",
      data: {
        chunkId: "chunk-obedience",
        sermonId: "sermon-james",
        folderId: "folder-james",
        sourceKind: "sermon",
        chunkType: "bigIdea",
        title: "Faith That Works",
        scriptureText: "James 1:22",
        text: "Real reception of the Word becomes visible in practiced obedience.",
        vectorDistance: 0.2
      }
    }
  ];
  deps.generateRagAnswer = async (input) => {
    generatedInput = input;
    return "The saved material says obedience is the visible fruit of receiving the Word [S1].";
  };

  const result = await answerSermonQuestion(
    {
      question: "What have I saved about obedience?",
      sermonId: "sermon-james",
      limit: 3
    },
    deps
  );

  assert.match(result.answer, /visible fruit/);
  assert.equal(result.retrieval.count, 1);
  assert.equal(result.citations[0].citationId, "S1");
  assert.equal(result.citations[0].chunkId, "chunk-obedience");
  assert.match(result.contextText, /Real reception/);
  assert.equal(generatedInput.question, "What have I saved about obedience?");
  assert.match(generatedInput.contextText, /\[S1\]/);
});

test("rejects invalid sermon source types", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-source": {
        sermonId: "sermon-source",
        title: "The Implanted Word",
        status: "developing"
      }
    }
  });

  await assert.rejects(
    () => createSermonSource(
      {
        sermonId: "sermon-source",
        sourceType: "audio",
        sourceLabel: "Audio",
        summary: "Unsupported type."
      },
      deps
    ),
    {
      code: "invalid_sermon_source_type",
      statusCode: 400
    }
  );
});

test("rejects moving a sermon to a missing folder without creating a snapshot", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-folder-move": {
        sermonId: "sermon-folder-move",
        title: "Folder Move",
        status: "developing",
        folderId: "",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  await assert.rejects(
    () => updateSermon(
      {
        sermonId: "sermon-folder-move",
        changes: {
          folderId: "folder-missing"
        }
      },
      deps
    ),
    {
      code: "sermon_folder_not_found",
      statusCode: 404
    }
  );

  const snapshots = await listSermonSnapshots({ sermonId: "sermon-folder-move" }, deps);
  assert.equal(snapshots.count, 0);
});

test("rejects importing sermon material into a missing folder", async () => {
  const deps = createDeps();

  await assert.rejects(
    () => importSermonMaterial(
      {
        folderId: "folder-missing",
        title: "Missing Folder Import",
        importedSummary: "This should not be saved."
      },
      deps
    ),
    {
      code: "sermon_folder_not_found",
      statusCode: 404
    }
  );
});

test("creates and updates the default preaching profile", async () => {
  const deps = createDeps();

  const emptyProfile = await getPreachingProfile({}, deps);
  assert.equal(emptyProfile.profile.profileId, "default");
  assert.equal(emptyProfile.profile.observations.length, 0);

  const updated = await updatePreachingProfile(
    {
      summary: "Dan preaches with a pastoral, text-driven, practical tone.",
      tone: ["pastoral", "direct", "warm"],
      strengths: ["clear applications"],
      observations: [
        {
          category: "illustration",
          observation: "Uses everyday illustrations to make abstract truths concrete.",
          confidence: "observed_once",
          evidence: "Basketball referee illustration in James 1:2-4."
        }
      ]
    },
    deps
  );

  assert.match(updated.profile.summary, /pastoral/);
  assert.equal(updated.profile.tone.length, 3);
  assert.equal(updated.profile.observations.length, 1);
});

test("saves preaching analysis and can apply profile candidates", async () => {
  const deps = createDeps({
    sermons: {
      "sermon-james-1-2": {
        sermonId: "sermon-james-1-2",
        title: "Let Patience Have Her Perfect Work",
        status: "preached",
        scriptureText: "James 1:2-4",
        updatedAt: "2026-07-01T16:00:00.000Z"
      }
    }
  });

  const created = await createPreachingAnalysis(
    {
      sermonId: "sermon-james-1-2",
      title: "Style analysis from YouTube transcript",
      sourceLabel: "Midweek Service 01/14/2026 transcript",
      summary: "Strong text-driven exhortation with practical trial applications.",
      strengths: ["Connects doctrine to concrete responses in trials."],
      improvements: ["Tighten transitions between illustrations and main movements."],
      styleObservations: ["Uses testimony and everyday scenes to carry application."],
      profileCandidates: [
        {
          category: "tone",
          observation: "Frequently presses for lived faith rather than merely claimed faith.",
          confidence: "recurring",
          evidence: "Repeated living our faith emphasis in James introduction."
        }
      ],
      applyProfileCandidates: true
    },
    deps
  );

  assert.equal(created.analysis.sermonId, "sermon-james-1-2");
  assert.equal(created.profileUpdated, true);
  assert.equal(created.profile.observations.length, 1);

  const listed = await listPreachingAnalyses({ sermonId: "sermon-james-1-2" }, deps);
  assert.equal(listed.count, 1);
  assert.match(listed.analyses[0].summary, /text-driven/);
});
