const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildActiveCongregationalPool,
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
    ministryMetadata: {
      leaderReadiness: "unknown",
      strength: "unknown",
      feelsDated: "unknown",
      situationalUse: [],
      developmentPotential: "unknown"
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

test("searchSongs supports Slice 2 ministry metadata filtering", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong({
      songId: "rejoice-0381",
      hymnalNumber: 381,
      canonicalTitle: "Blessed Assurance",
      topics: ["Assurance and Confidence", "Testimony"],
      ministryMetadata: {
        leaderReadiness: "ready_now",
        strength: "core",
        feelsDated: "no",
        situationalUse: ["invitation", "reflective"],
        developmentPotential: "medium"
      }
    }),
    "rejoice-0405": buildSong({
      songId: "rejoice-0405",
      hymnalNumber: 405,
      canonicalTitle: "Take My Life, and Let It Be Consecrated",
      topics: ["Invitation", "Prayer"],
      ministryMetadata: {
        leaderReadiness: "learnable_soon",
        strength: "solid_rotation",
        feelsDated: "no",
        situationalUse: ["invitation", "reflective"],
        developmentPotential: "high"
      }
    }),
    "rejoice-0636": buildSong({
      songId: "rejoice-0636",
      hymnalNumber: 636,
      canonicalTitle: "Revive Us Again",
      topics: ["Adoration and Praise", "Revival"],
      ministryMetadata: {
        leaderReadiness: "ready_now",
        strength: "core",
        feelsDated: "yes",
        situationalUse: ["revival"],
        developmentPotential: "low"
      }
    })
  });

  const result = await searchSongs(
    {
      filters: {
        leaderReadiness: "learnable_soon",
        developmentPotential: "high",
        situationalUse: "invitation"
      }
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.songs[0].songId, "rejoice-0405");
  assert.deepEqual(result.appliedFilters, {
    leaderReadiness: "learnable_soon",
    situationalUse: ["invitation"],
    developmentPotential: "high"
  });
  assert.equal(result.songs[0].ministryMetadata.leaderReadiness, "learnable_soon");
});

test("searchSongs returns and filters local ministry planning guardrails", async () => {
  const deps = createDeps({
    "rejoice-0100": buildSong({
      songId: "rejoice-0100",
      hymnalNumber: 100,
      canonicalTitle: "Christmas Hymn",
      topics: ["Christmas"],
      ministryPlanning: {
        useStatus: "active",
        allowedUsageRoles: ["congregational"],
        seasonalUse: ["christmas"],
        worshipFunctions: ["adoration"],
        leaderReadiness: {
          dan: "ready_now"
        },
        congregationFit: "strong",
        rotationStrength: "core"
      }
    }),
    "rejoice-0200": buildSong({
      songId: "rejoice-0200",
      hymnalNumber: 200,
      canonicalTitle: "Invitation Hymn",
      topics: ["Invitation"],
      ministryPlanning: {
        useStatus: "active",
        allowedUsageRoles: ["invitation"],
        worshipFunctions: ["invitation"],
        leaderReadiness: {
          dan: "not_ready"
        }
      }
    }),
    "rejoice-0300": buildSong({
      songId: "rejoice-0300",
      hymnalNumber: 300,
      canonicalTitle: "Blocked Hymn",
      topics: ["Prayer"],
      ministryPlanning: {
        useStatus: "do_not_use",
        blockReason: "Local ministry decision."
      }
    })
  });

  const result = await searchSongs(
    {
      filters: {
        useStatus: "active",
        allowedUsageRole: "congregational",
        seasonalUse: "Christmas"
      }
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.songs[0].songId, "rejoice-0100");
  assert.deepEqual(result.appliedFilters, {
    useStatus: "active",
    allowedUsageRole: "congregational",
    seasonalUse: "christmas"
  });
  assert.equal(result.songs[0].ministryPlanning.leaderReadiness.dan, "ready_now");
});

test("buildActiveCongregationalPool returns backend-computed ordinary-service pool", async () => {
  const deps = createDeps({
    "rejoice-0001": buildSong({
      ministryPlanning: {
        useStatus: "active",
        leaderReadiness: {
          dan: "ready_now"
        },
        energy: "upbeat",
        tempo: "moderate",
        congregationFit: "strong"
      }
    }),
    "rejoice-0002": buildSong({
      songId: "rejoice-0002",
      hymnalNumber: 2,
      canonicalTitle: "Rare Song",
      ministryPlanning: {
        useStatus: "active",
        leaderReadiness: {
          dan: "ready_now"
        },
        rotationStrength: "rare"
      }
    }),
    "rejoice-0228": buildSong({
      songId: "rejoice-0228",
      hymnalNumber: 228,
      canonicalTitle: "Christmas Song",
      topics: ["Christmas"],
      ministryPlanning: {
        useStatus: "active",
        seasonalUse: ["christmas"],
        leaderReadiness: {
          dan: "ready_now"
        }
      }
    }),
    "rejoice-0680": buildSong({
      songId: "rejoice-0680",
      hymnalNumber: 680,
      canonicalTitle: "Rejoice in the Lord",
      topics: ["Joy", "Temptation and Trials", "Funeral and Memorial"],
      ministryPlanning: {
        leaderReadiness: {
          dan: "ready_now"
        },
        congregationFit: "strong",
        energy: "reflective",
        rotationStrength: "solid_rotation"
      }
    }),
    "rejoice-0300": buildSong({
      songId: "rejoice-0300",
      hymnalNumber: 300,
      canonicalTitle: "Special Only",
      ministryPlanning: {
        useStatus: "active",
        allowedUsageRoles: ["special_music"],
        leaderReadiness: {
          dan: "ready_now"
        }
      }
    }),
    "breeze-foo": buildSong({
      songId: "breeze-foo",
      hymnalNumber: 0,
      canonicalTitle: "Breeze Song",
      ministryPlanning: {
        useStatus: "active",
        leaderReadiness: {
          dan: "ready_now"
        }
      }
    })
  });

  const result = await buildActiveCongregationalPool({ limit: 10 }, deps);

  assert.equal(result.count, 3);
  assert.deepEqual(
    result.songs.map((song) => song.songId),
    ["rejoice-0001", "rejoice-0002", "rejoice-0680"]
  );
  assert.deepEqual(result.songs[1].activePool.warnings, [
    "rare_rotation",
    "energy_unknown",
    "tempo_unknown",
    "congregation_fit_unknown"
  ]);
  assert.equal(result.exclusionCounts.seasonal_or_occasion_only, 1);
  assert.equal(result.exclusionCounts.usage_role_not_allowed, 1);
});

test("searchSongs rejects invalid Slice 2 filter values clearly", async () => {
  const deps = createDeps({
    "rejoice-0001": buildSong()
  });

  await assert.rejects(
    () => searchSongs(
      {
        filters: {
          strength: "powerhouse"
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.message, "Invalid filter value for strength");
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "invalid_filter_value");
      assert.deepEqual(error.details, {
        field: "strength",
        value: "powerhouse",
        allowedValues: ["core", "solid_rotation", "situational", "unknown"]
      });
      return true;
    }
  );
});

test("searchSongs lists songs with no query and no filters", async () => {
  const deps = createDeps({
    "rejoice-0007": buildSong({
      songId: "rejoice-0007",
      hymnalNumber: 7,
      canonicalTitle: "Abba, Father (PRITCHARD)"
    }),
    "rejoice-0001": buildSong(),
    "rejoice-0003": buildSong({
      songId: "rejoice-0003",
      hymnalNumber: 3,
      canonicalTitle: "Holy, Holy, Holy"
    })
  });

  const result = await searchSongs({ limit: 2 }, deps);

  assert.equal(result.count, 2);
  assert.deepEqual(
    result.songs.map((song) => song.songId),
    ["rejoice-0001", "rejoice-0003"]
  );
  assert.deepEqual(result.appliedFilters, {});
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
  assert.deepEqual(result.song.ministryMetadata, {
    leaderReadiness: "unknown",
    strength: "unknown",
    feelsDated: "unknown",
    situationalUse: [],
    developmentPotential: "unknown"
  });
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
