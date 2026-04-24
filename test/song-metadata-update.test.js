const test = require("node:test");
const assert = require("node:assert/strict");

const {
  updateSongMinistryMetadata
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

test("updateSongMinistryMetadata applies a partial metadata update and records an audit entry", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  const result = await updateSongMinistryMetadata(
    {
      songId: "rejoice-0381",
      changes: {
        leaderReadiness: "ready_now",
        situationalUse: ["reflective", "invitation"]
      },
      changeReason: "Leader has now used this successfully several times."
    },
    {
      ...deps,
      now: () => "2026-04-24T00:00:00.000Z",
      createAuditId: () => "audit-381-1"
    }
  );

  assert.deepEqual(result.ministryMetadata, {
    leaderReadiness: "ready_now",
    strength: "unknown",
    feelsDated: "unknown",
    situationalUse: ["invitation", "reflective"],
    developmentPotential: "unknown"
  });
  assert.equal(result.updatedAt, "2026-04-24T00:00:00.000Z");
  assert.deepEqual(result.auditEntry, {
    auditId: "audit-381-1",
    songId: "rejoice-0381",
    changedAt: "2026-04-24T00:00:00.000Z",
    changedBy: "custom-gpt",
    changeReason: "Leader has now used this successfully several times.",
    previousValues: {
      leaderReadiness: "unknown",
      situationalUse: []
    },
    newValues: {
      leaderReadiness: "ready_now",
      situationalUse: ["invitation", "reflective"]
    },
    changesApplied: ["leaderReadiness", "situationalUse"]
  });

  const savedSong = await deps.songsCollection.doc("rejoice-0381").get();
  assert.equal(savedSong.data().canonicalTitle, "Blessed Assurance");
  assert.equal(savedSong.data().hymnalNumber, 381);
  assert.equal(savedSong.data().createdAt, "2026-04-23T00:00:00.000Z");
  assert.equal(savedSong.data().updatedAt, "2026-04-24T00:00:00.000Z");
  assert.deepEqual(savedSong.data().ministryMetadata, result.ministryMetadata);

  const savedAuditEntry = await deps.songMetadataAuditCollection.doc("audit-381-1").get();
  assert.deepEqual(savedAuditEntry.data(), result.auditEntry);
});

test("updateSongMinistryMetadata rejects unsupported fields", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongMinistryMetadata(
      {
        songId: "rejoice-0381",
        changes: {
          canonicalTitle: "Changed Title"
        },
        changeReason: "Should not be allowed"
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "unsupported_metadata_fields");
      assert.deepEqual(error.details, {
        unsupportedFields: ["canonicalTitle"],
        allowedFields: [
          "leaderReadiness",
          "strength",
          "feelsDated",
          "situationalUse",
          "developmentPotential"
        ]
      });
      return true;
    }
  );
});

test("updateSongMinistryMetadata rejects missing changeReason", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongMinistryMetadata(
      {
        songId: "rejoice-0381",
        changes: {
          strength: "core"
        },
        changeReason: "   "
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "missing_change_reason");
      return true;
    }
  );
});

test("updateSongMinistryMetadata rejects empty changes", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongMinistryMetadata(
      {
        songId: "rejoice-0381",
        changes: {},
        changeReason: "Should fail"
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

test("updateSongMinistryMetadata rejects invalid metadata values", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong()
  });

  await assert.rejects(
    () => updateSongMinistryMetadata(
      {
        songId: "rejoice-0381",
        changes: {
          feelsDated: "sometimes"
        },
        changeReason: "Should fail"
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "invalid_filter_value");
      assert.deepEqual(error.details, {
        field: "feelsDated",
        value: "sometimes",
        allowedValues: ["yes", "no", "mixed", "unknown"]
      });
      return true;
    }
  );
});

test("updateSongMinistryMetadata rejects when no actual metadata values change", async () => {
  const deps = createDeps({
    "rejoice-0381": buildSong({
      ministryMetadata: {
        leaderReadiness: "ready_now",
        strength: "core",
        feelsDated: "no",
        situationalUse: ["invitation"],
        developmentPotential: "medium"
      }
    })
  });

  await assert.rejects(
    () => updateSongMinistryMetadata(
      {
        songId: "rejoice-0381",
        changes: {
          strength: "core"
        },
        changeReason: "No actual change"
      },
      deps
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "no_metadata_changes_applied");
      return true;
    }
  );
});

test("updateSongMinistryMetadata fails clearly when the song does not exist", async () => {
  const deps = createDeps({});

  await assert.rejects(
    () => updateSongMinistryMetadata(
      {
        songId: "rejoice-9999",
        changes: {
          developmentPotential: "high"
        },
        changeReason: "Test missing song"
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
