const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSongById,
  searchSongs
} = require("../lib/song-catalog-service");

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

function createDeps(records = {}) {
  return {
    songsCollection: new FakeCollection(records)
  };
}

function buildSong(overrides = {}) {
  return {
    songId: "rejoice-0001",
    hymnalId: "rejoice",
    hymnalNumber: 1,
    canonicalTitle: "Joyful, Joyful, We Adore Thee",
    topics: ["Adoration and Praise", "Joy"],
    titleAliases: [],
    normalizedLookupKeys: [
      "number:1",
      "number:0001",
      "title:joyful joyful we adore thee"
    ],
    sourceStatus: "verified",
    sourceEvidence: {
      catalogSource: "song_topics_index_verified.csv",
      catalogVersion: "working",
      rowCount: 1,
      rowRefs: [
        {
          rowNumber: 2,
          rawTitle: "Joyful, Joyful, We Adore Thee",
          rawTopics: ["Adoration and Praise", "Joy"]
        }
      ],
      pdfAudit: {
        status: "not_reviewed",
        notes: ""
      }
    },
    reviewFlags: [],
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    ...clone(overrides)
  };
}

test("searchSongs matches query terms against titles and topics", async () => {
  const deps = createDeps({
    "rejoice-0001": buildSong(),
    "rejoice-0007": buildSong({
      songId: "rejoice-0007",
      hymnalNumber: 7,
      canonicalTitle: "Abba, Father (PRITCHARD)",
      topics: ["Trust", "Prayer"]
    })
  });

  const result = await searchSongs(
    {
      query: "trust"
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.songs[0].songId, "rejoice-0007");
  assert.deepEqual(result.appliedFilters, {});
});

test("searchSongs supports theme filtering without a query", async () => {
  const deps = createDeps({
    "rejoice-0001": buildSong(),
    "rejoice-0007": buildSong({
      songId: "rejoice-0007",
      hymnalNumber: 7,
      canonicalTitle: "Abba, Father (PRITCHARD)",
      topics: ["Trust", "Prayer"],
      sourceStatus: "needs_review",
      reviewFlags: ["pdf_audit_required"]
    })
  });

  const result = await searchSongs(
    {
      filters: {
        theme: "Trust"
      }
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.songs[0].songId, "rejoice-0007");
  assert.deepEqual(result.appliedFilters, {
    theme: "Trust"
  });
  assert.deepEqual(result.warnings, [
    "Some returned songs still need manual catalog review."
  ]);
});

test("searchSongs rejects requests with no query and no filters", async () => {
  const deps = createDeps({
    "rejoice-0001": buildSong()
  });

  await assert.rejects(
    () => searchSongs({}, deps),
    (error) => {
      assert.equal(error.message, "Missing query or filters");
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "missing_query_or_filters");
      return true;
    }
  );
});

test("getSongById returns the canonical song detail", async () => {
  const deps = createDeps({
    "rejoice-0001": buildSong({
      titleAliases: ["Joyful Joyful We Adore Thee"]
    })
  });

  const result = await getSongById(
    {
      songId: "rejoice-0001"
    },
    deps
  );

  assert.equal(result.song.songId, "rejoice-0001");
  assert.equal(result.song.canonicalTitle, "Joyful, Joyful, We Adore Thee");
  assert.deepEqual(result.song.titleAliases, ["Joyful Joyful We Adore Thee"]);
});

test("getSongById fails clearly when the song does not exist", async () => {
  const deps = createDeps({});

  await assert.rejects(
    () => getSongById({ songId: "rejoice-0999" }, deps),
    (error) => {
      assert.equal(error.message, "Song not found");
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "song_not_found");
      return true;
    }
  );
});
