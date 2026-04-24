const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSongById,
  searchSongs,
  updateSongIdentity
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
    songId: "rejoice-0381",
    hymnalId: "rejoice",
    hymnalNumber: 381,
    canonicalTitle: "Blessed Assurance",
    topics: ["Assurance and Confidence", "Testimony"],
    titleAliases: [],
    normalizedLookupKeys: [
      "number-title:381:blessed assurance",
      "number:0381",
      "number:381",
      "title-strict:blessed assurance",
      "title:blessed assurance"
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
      rowRefs: [],
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

function createDeps(songRecords = {}) {
  return {
    songsCollection: new FakeCollection(songRecords),
    songMetadataAuditCollection: new FakeCollection()
  };
}

test("updateSongIdentity updates canonicalTitle and derives normalized lookup keys", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  const result = await updateSongIdentity(
    {
      songId: "rejoice-0381",
      changes: {
        canonicalTitle: "Blessed Assurance of Jesus"
      },
      changeReason: "Corrected title for import matching."
    },
    {
      ...deps,
      now: () => "2026-04-24T00:00:00.000Z",
      createAuditId: () => "identity-audit-381-1"
    }
  );

  assert.equal(result.songId, "rejoice-0381");
  assert.equal(result.canonicalTitle, "Blessed Assurance of Jesus");
  assert.deepEqual(result.titleAliases, []);
  assert.equal(result.updatedAt, "2026-04-24T00:00:00.000Z");
  assert.ok(result.normalizedLookupKeys.includes("number-title:381:blessed assurance of jesus"));
  assert.ok(result.normalizedLookupKeys.includes("title-strict:blessed assurance of jesus"));
  assert.ok(result.normalizedLookupKeys.includes("title:blessed assurance of jesus"));
  assert.ok(!result.normalizedLookupKeys.includes("title:blessed assurance"));
  assert.equal(result.auditEntry.auditType, "song_identity");
  assert.deepEqual(result.auditEntry.changesApplied, [
    "canonicalTitle",
    "normalizedLookupKeys"
  ]);

  const savedSong = await deps.songsCollection.doc("rejoice-0381").get();
  assert.equal(savedSong.data().canonicalTitle, "Blessed Assurance of Jesus");
  assert.equal(savedSong.data().songId, "rejoice-0381");
  assert.equal(savedSong.data().hymnalId, "rejoice");
  assert.equal(savedSong.data().hymnalNumber, 381);
  assert.deepEqual(savedSong.data().sourceEvidence, buildSong().sourceEvidence);

  const savedAudit = await deps.songMetadataAuditCollection.doc("identity-audit-381-1").get();
  assert.deepEqual(savedAudit.data(), result.auditEntry);
});

test("updateSongIdentity updates and dedupes titleAliases", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  const result = await updateSongIdentity(
    {
      songId: "rejoice-0381",
      changes: {
        titleAliases: [
          "  Blessed Assurance  ",
          "Blessed Assurance",
          "Bless'd Assurance",
          "Bless'd   Assurance"
        ]
      }
    },
    {
      ...deps,
      now: () => "2026-04-24T01:00:00.000Z",
      createAuditId: () => "identity-audit-381-2"
    }
  );

  assert.deepEqual(result.titleAliases, ["Bless'd Assurance"]);
  assert.ok(result.normalizedLookupKeys.includes("title:bless d assurance"));
  assert.ok(result.normalizedLookupKeys.includes("title-strict:bless'd assurance"));
});

test("updateSongIdentity updates canonicalTitle and titleAliases together", async () => {
  const deps = createDeps({
    "rejoice-0100": buildSong({
      songId: "rejoice-0100",
      hymnalNumber: 100,
      canonicalTitle: "Old Display Title",
      titleAliases: ["Old Alias"],
      normalizedLookupKeys: ["number:100"]
    })
  });

  const result = await updateSongIdentity(
    {
      songId: "rejoice-0100",
      changes: {
        canonicalTitle: "Fairest Lord Jesus",
        titleAliases: ["Beautiful Savior", " Fairest Lord Jesus "]
      }
    },
    {
      ...deps,
      now: () => "2026-04-24T02:00:00.000Z",
      createAuditId: () => "identity-audit-100-1"
    }
  );

  assert.equal(result.canonicalTitle, "Fairest Lord Jesus");
  assert.deepEqual(result.titleAliases, ["Beautiful Savior"]);
  assert.ok(result.normalizedLookupKeys.includes("number-title:100:fairest lord jesus"));
  assert.ok(result.normalizedLookupKeys.includes("title:beautiful savior"));
  assert.ok(!result.normalizedLookupKeys.includes("title:old alias"));
});

test("updateSongIdentity makes updated aliases searchable and visible in detail", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await updateSongIdentity(
    {
      songId: "rejoice-0381",
      changes: {
        titleAliases: ["This Is My Story"]
      }
    },
    {
      ...deps,
      now: () => "2026-04-24T03:00:00.000Z",
      createAuditId: () => "identity-audit-381-3"
    }
  );

  const searchResult = await searchSongs(
    {
      query: "story"
    },
    deps
  );
  const detailResult = await getSongById(
    {
      songId: "rejoice-0381"
    },
    deps
  );

  assert.equal(searchResult.count, 1);
  assert.equal(searchResult.songs[0].songId, "rejoice-0381");
  assert.deepEqual(detailResult.song.titleAliases, ["This Is My Story"]);
});

test("updateSongIdentity rejects unsupported fields", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongIdentity(
      {
        songId: "rejoice-0381",
        changes: {
          topics: ["Trust"]
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "unsupported_identity_fields");
      assert.deepEqual(error.details, {
        unsupportedFields: ["topics"],
        allowedFields: ["canonicalTitle", "titleAliases"]
      });
      return true;
    }
  );
});

test("updateSongIdentity rejects protected hymnal, source, and derived identity fields", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongIdentity(
      {
        songId: "rejoice-0381",
        changes: {
          hymnalNumber: 382,
          sourceStatus: "needs_review",
          sourceEvidence: {},
          normalizedLookupKeys: ["title:unsafe"]
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "protected_identity_fields");
      assert.deepEqual(error.details, {
        protectedFields: ["hymnalNumber", "sourceStatus", "sourceEvidence", "normalizedLookupKeys"],
        allowedFields: ["canonicalTitle", "titleAliases"]
      });
      return true;
    }
  );
});

test("updateSongIdentity rejects missing or invalid songId", async () => {
  const deps = createDeps({});

  await assert.rejects(
    () => updateSongIdentity(
      {
        songId: " ",
        changes: {
          canonicalTitle: "A Valid Title"
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "missing_or_invalid_song_id");
      return true;
    }
  );
});

test("updateSongIdentity fails clearly when the song does not exist", async () => {
  const deps = createDeps({});

  await assert.rejects(
    () => updateSongIdentity(
      {
        songId: "rejoice-9999",
        changes: {
          canonicalTitle: "A Valid Title"
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "song_not_found");
      return true;
    }
  );
});

test("updateSongIdentity rejects empty updates", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongIdentity(
      {
        songId: "rejoice-0381",
        changes: {}
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "empty_changes");
      return true;
    }
  );
});

test("updateSongIdentity rejects invalid canonicalTitle", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongIdentity(
      {
        songId: "rejoice-0381",
        changes: {
          canonicalTitle: "   "
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "invalid_identity_value");
      assert.deepEqual(error.details, {
        field: "canonicalTitle"
      });
      return true;
    }
  );
});

test("updateSongIdentity rejects invalid titleAliases", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongIdentity(
      {
        songId: "rejoice-0381",
        changes: {
          titleAliases: "Valid Alias"
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "invalid_identity_value");
      assert.deepEqual(error.details, {
        field: "titleAliases"
      });
      return true;
    }
  );

  await assert.rejects(
    () => updateSongIdentity(
      {
        songId: "rejoice-0381",
        changes: {
          titleAliases: ["Valid Alias", "  "]
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "invalid_identity_value");
      assert.deepEqual(error.details, {
        field: "titleAliases"
      });
      return true;
    }
  );
});

test("updateSongIdentity supports correcting hymn 405 title without changing source identity", async () => {
  const originalSong = buildSong({
    songId: "rejoice-0405",
    hymnalNumber: 405,
    canonicalTitle: "Take My Life and Let It Be Consecrated",
    titleAliases: [],
    normalizedLookupKeys: [
      "number-title:405:take my life and let it be consecrated",
      "number:0405",
      "number:405",
      "title-strict:take my life and let it be consecrated",
      "title:take my life and let it be consecrated"
    ],
    sourceEvidence: {
      catalogSource: "song_topics_index_verified.csv",
      rowRefs: [
        {
          rowNumber: 412,
          rawTitle: "Take My Life, and Let It Be Consecrated"
        }
      ]
    }
  });
  const deps = createDeps({
    "rejoice-0405": originalSong
  });

  const result = await updateSongIdentity(
    {
      songId: "rejoice-0405",
      changes: {
        canonicalTitle: "Take My Life, and Let It Be Consecrated"
      },
      changeReason: "Correct punctuation in canonical title for hymn 405."
    },
    {
      ...deps,
      now: () => "2026-04-24T04:00:00.000Z",
      createAuditId: () => "identity-audit-405-1"
    }
  );

  const savedSong = await deps.songsCollection.doc("rejoice-0405").get();

  assert.equal(result.songId, "rejoice-0405");
  assert.equal(result.canonicalTitle, "Take My Life, and Let It Be Consecrated");
  assert.equal(savedSong.data().songId, "rejoice-0405");
  assert.equal(savedSong.data().hymnalId, "rejoice");
  assert.equal(savedSong.data().hymnalNumber, 405);
  assert.deepEqual(savedSong.data().sourceEvidence, originalSong.sourceEvidence);
  assert.equal(savedSong.data().sourceStatus, "verified");
  assert.deepEqual(savedSong.data().reviewFlags, []);
  assert.ok(result.normalizedLookupKeys.includes("title-strict:take my life, and let it be consecrated"));
});
