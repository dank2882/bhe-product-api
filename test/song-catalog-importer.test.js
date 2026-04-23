const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCanonicalSongsFromCsv,
  buildSongId,
  importCanonicalSongsToCollection,
  looseNormalizeTitle,
  parseSongCatalogCsv,
  strictNormalizeTitle
} = require("../lib/song-catalog-importer");
const {
  seedSlice2MinistryMetadataToCollection
} = require("../lib/song-ministry-metadata");

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

  async set(value) {
    this.store.set(this.id, clone(value));
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

function buildCsv(rows) {
  return [
    "Song #,Title,Topics",
    ...rows
  ].join("\n");
}

test("parseSongCatalogCsv reads the expected header and rows", () => {
  const rows = parseSongCatalogCsv(
    buildCsv([
      '24,"O God, Our Help in Ages Past","Adoration and Praise, Faith and Hope"',
      '25,O Magnify the Lord,Adoration and Praise'
    ])
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[0].hymnalNumber, 24);
  assert.equal(rows[0].title, "O God, Our Help in Ages Past");
  assert.deepEqual(rows[0].topics, ["Adoration and Praise", "Faith and Hope"]);
  assert.equal(rows[1].rowNumber, 3);
});

test("buildSongId creates deterministic rejoice IDs", () => {
  assert.equal(buildSongId("rejoice", 24), "rejoice-0024");
  assert.equal(buildSongId("rejoice", 712), "rejoice-0712");
});

test("title normalization stays conservative", () => {
  assert.equal(
    strictNormalizeTitle("O God, Our Help in Ages-Past"),
    "o god, our help in ages-past"
  );
  assert.equal(
    looseNormalizeTitle("O God, Our Help in Ages-Past"),
    "o god our help in ages past"
  );
});

test("repeated hymn numbers with different topics aggregate into one canonical song", () => {
  const { songs, importSummary } = buildCanonicalSongsFromCsv({
    csvText: buildCsv([
      '24,"O God, Our Help in Ages-Past",Adoration and Praise',
      '24,"O God, Our Help in Ages Past","Faith and Hope, Spiritual Warfare"'
    ]),
    importedAt: "2026-04-23T00:00:00.000Z"
  });

  assert.equal(songs.length, 1);
  assert.equal(importSummary.totalRowsRead, 2);
  assert.equal(importSummary.rowsAggregated, 1);
  assert.equal(importSummary.reviewItemsCreated, 0);

  const song = songs[0];
  assert.equal(song.songId, "rejoice-0024");
  assert.equal(song.hymnalNumber, 24);
  assert.deepEqual(song.topics, [
    "Adoration and Praise",
    "Faith and Hope",
    "Spiritual Warfare"
  ]);
  assert.deepEqual(song.titleAliases, ["O God, Our Help in Ages-Past"]);
  assert.deepEqual(song.reviewFlags, []);
  assert.equal(song.sourceStatus, "verified");
  assert.deepEqual(song.ministryMetadata, {
    leaderReadiness: "unknown",
    strength: "unknown",
    feelsDated: "unknown",
    situationalUse: [],
    developmentPotential: "unknown"
  });
  assert.equal(song.sourceEvidence.rowCount, 2);
  assert.deepEqual(
    song.sourceEvidence.rowRefs.map((row) => row.rowNumber),
    [2, 3]
  );
});

test("real title conflicts trigger review on the canonical song", () => {
  const { songs, importSummary } = buildCanonicalSongsFromCsv({
    csvText: buildCsv([
      "30,Heaven,Adoration and Praise",
      '30,"Praise, My Soul, the King of Heaven","Healing, Salvation"'
    ]),
    importedAt: "2026-04-23T00:00:00.000Z"
  });

  assert.equal(songs.length, 1);
  assert.equal(importSummary.reviewItemsCreated, 1);
  assert.deepEqual(songs[0].reviewFlags, [
    "duplicate_number_material_title_conflict",
    "pdf_audit_required"
  ]);
  assert.equal(songs[0].sourceStatus, "needs_review");
});

test("malformed title variants are preserved as aliases and flagged for review", () => {
  const { songs, importSummary } = buildCanonicalSongsFromCsv({
    csvText: buildCsv([
      '26,"I Worship You, Almighty God",Adoration and Praise',
      '26,"I Worship You, AJmjghty God",Choruses'
    ]),
    importedAt: "2026-04-23T00:00:00.000Z"
  });

  assert.equal(songs.length, 1);
  assert.equal(importSummary.reviewItemsCreated, 1);
  assert.equal(songs[0].sourceStatus, "needs_review");
  assert.deepEqual(songs[0].reviewFlags, [
    "malformed_title_variant",
    "pdf_audit_required"
  ]);
  assert.deepEqual(songs[0].titleAliases, ["I Worship You, AJmjghty God"]);
  assert.deepEqual(
    songs[0].sourceEvidence.rowRefs.map((row) => row.rawTitle),
    ["I Worship You, Almighty God", "I Worship You, AJmjghty God"]
  );
});

test("same canonical title under different hymn numbers flags each song for review", () => {
  const { songs, importSummary } = buildCanonicalSongsFromCsv({
    csvText: buildCsv([
      '101,"He Leadeth Me",Trust',
      '205,"He Leadeth Me","Comfort and Care"'
    ]),
    importedAt: "2026-04-23T00:00:00.000Z"
  });

  assert.equal(songs.length, 2);
  assert.equal(importSummary.reviewItemsCreated, 2);
  assert.match(importSummary.nonFatalWarnings[0], /appeared under multiple hymn numbers/i);

  for (const song of songs) {
    assert.equal(song.sourceStatus, "needs_review");
    assert.ok(song.reviewFlags.includes("duplicate_title_conflicting_numbers"));
    assert.ok(song.reviewFlags.includes("pdf_audit_required"));
  }
});

test("malformed rows create row errors without breaking the rest of the import", () => {
  const { songs, importSummary } = buildCanonicalSongsFromCsv({
    csvText: buildCsv([
      ",Missing Number,Adoration and Praise",
      "44,,Prayer",
      "45,Still Valid,"
    ]),
    importedAt: "2026-04-23T00:00:00.000Z"
  });

  assert.equal(songs.length, 1);
  assert.equal(importSummary.totalRowsRead, 3);
  assert.equal(importSummary.validRowsRead, 1);
  assert.equal(importSummary.rowErrors.length, 2);
  assert.deepEqual(
    importSummary.rowErrors.map((error) => error.flag),
    ["missing_hymnal_number", "missing_title"]
  );
  assert.deepEqual(songs[0].reviewFlags, ["missing_topics"]);
  assert.equal(songs[0].sourceStatus, "needs_review");
});

test("importCanonicalSongsToCollection is idempotent across unchanged re-imports", async () => {
  const songsCollection = new FakeCollection();
  const csvText = buildCsv([
    '24,"O God, Our Help in Ages Past","Faith and Hope, Spiritual Warfare"',
    '25,O Magnify the Lord,Adoration and Praise'
  ]);

  const firstResult = await importCanonicalSongsToCollection(
    {
      csvText,
      importedAt: "2026-04-23T00:00:00.000Z"
    },
    { songsCollection }
  );

  assert.equal(firstResult.importSummary.canonicalSongsCreated, 2);
  assert.equal(firstResult.importSummary.canonicalSongsUpdated, 0);
  assert.equal(firstResult.importSummary.canonicalSongsUnchanged, 0);

  const secondResult = await importCanonicalSongsToCollection(
    {
      csvText,
      importedAt: "2026-04-23T00:00:00.000Z"
    },
    { songsCollection }
  );

  assert.equal(secondResult.importSummary.canonicalSongsCreated, 0);
  assert.equal(secondResult.importSummary.canonicalSongsUpdated, 0);
  assert.equal(secondResult.importSummary.canonicalSongsUnchanged, 2);

  const savedSong = (await songsCollection.doc("rejoice-0024").get()).data();
  assert.equal(savedSong.songId, "rejoice-0024");
  assert.equal(savedSong.createdAt, "2026-04-23T00:00:00.000Z");
});

test("importCanonicalSongsToCollection preserves existing ministry metadata on re-import", async () => {
  const songsCollection = new FakeCollection({
    "rejoice-0381": {
      songId: "rejoice-0381",
      hymnalId: "rejoice",
      hymnalNumber: 381,
      canonicalTitle: "Blessed Assurance",
      topics: ["Assurance and Confidence", "Testimony"],
      titleAliases: [],
      normalizedLookupKeys: ["number:381"],
      ministryMetadata: {
        leaderReadiness: "ready_now",
        strength: "core",
        feelsDated: "no",
        situationalUse: ["invitation", "reflective"],
        developmentPotential: "medium"
      },
      sourceStatus: "verified",
      sourceEvidence: {
        catalogSource: "song_topics_index_verified.csv",
        catalogVersion: "working",
        rowCount: 1,
        rowRefs: []
      },
      reviewFlags: [],
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z"
    }
  });

  await importCanonicalSongsToCollection(
    {
      csvText: buildCsv([
        '381,"Blessed Assurance","Assurance and Confidence, Testimony"'
      ]),
      importedAt: "2026-04-23T00:00:00.000Z"
    },
    { songsCollection }
  );

  const savedSong = (await songsCollection.doc("rejoice-0381").get()).data();
  assert.deepEqual(savedSong.ministryMetadata, {
    leaderReadiness: "ready_now",
    strength: "core",
    feelsDated: "no",
    situationalUse: ["invitation", "reflective"],
    developmentPotential: "medium"
  });
  assert.equal(savedSong.createdAt, "2026-04-01T00:00:00.000Z");
});

test("seedSlice2MinistryMetadataToCollection merges the sample metadata onto existing songs", async () => {
  const songsCollection = new FakeCollection({
    "rejoice-0381": {
      songId: "rejoice-0381",
      canonicalTitle: "Blessed Assurance",
      updatedAt: "2026-04-01T00:00:00.000Z"
    },
    "rejoice-0405": {
      songId: "rejoice-0405",
      canonicalTitle: "Take My Life, and Let It Be Consecrated",
      updatedAt: "2026-04-01T00:00:00.000Z"
    }
  });

  const result = await seedSlice2MinistryMetadataToCollection(
    {
      metadataBySongId: {
        "rejoice-0381": {
          leaderReadiness: "ready_now",
          strength: "core",
          feelsDated: "no",
          situationalUse: ["reflective", "invitation"],
          developmentPotential: "medium"
        },
        "rejoice-9999": {
          leaderReadiness: "ready_now",
          strength: "core",
          feelsDated: "no",
          situationalUse: ["revival"],
          developmentPotential: "high"
        }
      },
      updatedAt: "2026-04-23T00:00:00.000Z"
    },
    { songsCollection }
  );

  assert.deepEqual(result.updatedSongIds, ["rejoice-0381"]);
  assert.deepEqual(result.skippedMissingSongIds, ["rejoice-9999"]);
  assert.equal(result.totalUpdated, 1);
  assert.equal(result.totalMissing, 1);

  const savedSong = (await songsCollection.doc("rejoice-0381").get()).data();
  assert.deepEqual(savedSong.ministryMetadata, {
    leaderReadiness: "ready_now",
    strength: "core",
    feelsDated: "no",
    situationalUse: ["invitation", "reflective"],
    developmentPotential: "medium"
  });
  assert.equal(savedSong.updatedAt, "2026-04-23T00:00:00.000Z");
});
