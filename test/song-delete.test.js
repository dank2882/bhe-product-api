const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deleteSong,
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

function buildSong(overrides = {}) {
  return {
    songId: "rejoice-0030",
    hymnalId: "rejoice",
    hymnalNumber: 30,
    canonicalTitle: "Praise, My Soul, the King of Heaven",
    topics: ["Adoration and Praise"],
    titleAliases: [],
    normalizedLookupKeys: [
      "number-title:30:praise my soul the king of heaven",
      "number:0030",
      "number:30",
      "title:praise my soul the king of heaven"
    ],
    ministryMetadata: {
      leaderReadiness: "unknown",
      strength: "unknown",
      feelsDated: "unknown",
      situationalUse: [],
      developmentPotential: "unknown"
    },
    sourceStatus: "verified",
    sourceEvidence: {
      catalogSource: "song_topics_index_verified.csv",
      catalogVersion: "working",
      rowCount: 1,
      rowRefs: []
    },
    reviewFlags: [],
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    ...clone(overrides)
  };
}

function createDeps(records = {}) {
  return {
    songsCollection: new FakeCollection(records)
  };
}

test("deleteSong deletes an existing song by exact songId", async () => {
  const deps = createDeps({
    "rejoice-0030": buildSong()
  });

  const result = await deleteSong({ songId: "rejoice-0030" }, deps);

  assert.deepEqual(result, {
    deleted: true,
    songId: "rejoice-0030",
    hymnalNumber: 30,
    canonicalTitle: "Praise, My Soul, the King of Heaven"
  });
  const doc = await deps.songsCollection.doc("rejoice-0030").get();
  assert.equal(doc.exists, false);
});

test("deleteSong returns structured 404 for a missing song", async () => {
  const deps = createDeps();

  await assert.rejects(
    () => deleteSong({ songId: "rejoice-9999" }, deps),
    (error) => {
      assert.equal(error.message, "Song not found");
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "song_not_found");
      assert.deepEqual(error.details, { songId: "rejoice-9999" });
      return true;
    }
  );
});

test("deleteSong returns structured 400 for missing or invalid songId", async () => {
  const deps = createDeps();

  await assert.rejects(
    () => deleteSong({ songId: "   " }, deps),
    (error) => {
      assert.equal(error.message, "Missing or invalid songId");
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "missing_or_invalid_song_id");
      return true;
    }
  );
});

test("deleted song no longer appears in search", async () => {
  const deps = createDeps({
    "rejoice-0030": buildSong(),
    "rejoice-0031": buildSong({
      songId: "rejoice-0031",
      hymnalNumber: 31,
      canonicalTitle: "Praise Him! Praise Him!",
      topics: ["Adoration and Praise"],
      normalizedLookupKeys: ["number:31", "title:praise him praise him"]
    })
  });

  await deleteSong({ songId: "rejoice-0030" }, deps);
  const result = await searchSongs({
    query: "praise",
    limit: 10,
    sort: "hymnal_number_asc"
  }, deps);

  assert.equal(result.count, 1);
  assert.equal(result.songs[0].songId, "rejoice-0031");
});

test("deleted song no longer returns from getSongById", async () => {
  const deps = createDeps({
    "rejoice-0030": buildSong()
  });

  await deleteSong({ songId: "rejoice-0030" }, deps);

  await assert.rejects(
    () => getSongById({ songId: "rejoice-0030" }, deps),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "song_not_found");
      return true;
    }
  );
});

test("deleting one song does not affect other songs", async () => {
  const deps = createDeps({
    "rejoice-0030": buildSong(),
    "rejoice-0405": buildSong({
      songId: "rejoice-0405",
      hymnalNumber: 405,
      canonicalTitle: "Take My Life, and Let It Be Consecrated",
      topics: ["Consecration"],
      normalizedLookupKeys: ["number:405", "title:take my life and let it be consecrated"]
    })
  });

  await deleteSong({ songId: "rejoice-0030" }, deps);
  const remaining = await getSongById({ songId: "rejoice-0405" }, deps);

  assert.equal(remaining.song.songId, "rejoice-0405");
  assert.equal(remaining.song.hymnalNumber, 405);
  assert.equal(remaining.song.canonicalTitle, "Take My Life, and Let It Be Consecrated");
});
