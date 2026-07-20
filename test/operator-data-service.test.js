const test = require("node:test");
const assert = require("node:assert/strict");

const {
  commitOperatorDataChange,
  listOperatorCollections,
  queryOperatorDocuments
} = require("../lib/operator-data-service");

const DELETE_FIELD = "__DELETE_FIELD__";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getByPath(record, fieldPath) {
  return fieldPath.split(".").reduce((current, part) => current?.[part], record);
}

function setByPath(record, fieldPath, value) {
  const parts = fieldPath.split(".");
  let current = record;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    current[part] = current[part] && typeof current[part] === "object" ? current[part] : {};
    current = current[part];
  }

  current[parts[parts.length - 1]] = clone(value);
}

function deleteByPath(record, fieldPath) {
  const parts = fieldPath.split(".");
  let current = record;

  for (let index = 0; index < parts.length - 1; index += 1) {
    current = current?.[parts[index]];
    if (!current || typeof current !== "object") {
      return;
    }
  }

  delete current[parts[parts.length - 1]];
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

  async set(data, options = {}) {
    if (options.merge && this.store.has(this.id)) {
      this.store.set(this.id, {
        ...clone(this.store.get(this.id)),
        ...clone(data)
      });
      return;
    }

    this.store.set(this.id, clone(data));
  }

  async update(payload) {
    if (!this.store.has(this.id)) {
      throw new Error("not found");
    }

    const next = clone(this.store.get(this.id));
    for (const [fieldPath, value] of Object.entries(payload)) {
      if (value === DELETE_FIELD) {
        deleteByPath(next, fieldPath);
      } else {
        setByPath(next, fieldPath, value);
      }
    }

    this.store.set(this.id, next);
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

function createDeps(collections) {
  return {
    collections,
    deleteFieldValue: DELETE_FIELD,
    now: () => "2026-04-26T12:00:00.000Z"
  };
}

test("queryOperatorDocuments lists the first songs by arbitrary sort without requiring a query", async () => {
  const deps = createDeps({
    songs: new FakeCollection({
      "rejoice-0007": { songId: "rejoice-0007", hymnalNumber: 7, canonicalTitle: "Abba, Father" },
      "rejoice-0001": { songId: "rejoice-0001", hymnalNumber: 1, canonicalTitle: "Joyful, Joyful" },
      "rejoice-0003": { songId: "rejoice-0003", hymnalNumber: 3, canonicalTitle: "Holy, Holy, Holy" }
    })
  });

  const result = await queryOperatorDocuments(
    {
      collection: "songs",
      orderBy: [{ fieldPath: "hymnalNumber", direction: "asc" }],
      limit: 2
    },
    deps
  );

  assert.equal(result.count, 2);
  assert.deepEqual(
    result.documents.map((document) => document.docId),
    ["rejoice-0001", "rejoice-0003"]
  );
});

test("queryOperatorDocuments searches free text across arbitrary nested fields", async () => {
  const deps = createDeps({
    services: new FakeCollection({
      "svc-1": {
        serviceDate: "2026-04-19",
        title: "Morning Service",
        theme: "Consecration",
        songs: [{ title: "Take My Life" }, { title: "Blessed Assurance" }]
      },
      "svc-2": {
        serviceDate: "2026-04-26",
        title: "Evening Service",
        theme: "Prayer",
        songs: [{ title: "Sweet Hour of Prayer" }]
      }
    })
  });

  const result = await queryOperatorDocuments(
    {
      collection: "services",
      freeText: { query: "blessed assurance" },
      limit: 10
    },
    deps
  );

  assert.equal(result.count, 1);
  assert.equal(result.documents[0].docId, "svc-1");
});

test("commitOperatorDataChange requires human confirmation before writes", async () => {
  const deps = createDeps({
    songs: new FakeCollection({
      "rejoice-0001": { songId: "rejoice-0001", canonicalTitle: "Joyful, Joyful" }
    })
  });

  await assert.rejects(
    () => commitOperatorDataChange(
      {
        collection: "songs",
        docId: "rejoice-0001",
        operation: "update",
        data: {
          "canonicalTitle": "Joyful, Joyful, We Adore Thee"
        }
      },
      deps
    ),
    (error) => {
      assert.equal(error.code, "missing_human_confirmation");
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});

test("commitOperatorDataChange updates arbitrary fields and deletes field paths", async () => {
  const songs = new FakeCollection({
    "rejoice-0001": {
      songId: "rejoice-0001",
      canonicalTitle: "Joyful, Joyful",
      ministryMetadata: {
        strength: "unknown",
        temporaryNote: "remove me"
      }
    }
  });
  const deps = createDeps({ songs });

  const result = await commitOperatorDataChange(
    {
      collection: "songs",
      docId: "rejoice-0001",
      operation: "update",
      fieldPatches: [
        {
          fieldPath: "ministryMetadata.strength",
          value: "core"
        },
        {
          fieldPath: "ministryMetadata.temporaryNote",
          action: "delete"
        }
      ],
      humanConfirmed: true,
      confirmationSummary: "Dan confirmed updating the strength and deleting the temporary note."
    },
    deps
  );

  assert.equal(result.committed, true);
  assert.equal(result.newData.ministryMetadata.strength, "core");
  assert.equal(getByPath(result.newData, "ministryMetadata.temporaryNote"), undefined);

  const saved = (await songs.doc("rejoice-0001").get()).data();
  assert.equal(saved.ministryMetadata.strength, "core");
  assert.equal(saved.ministryMetadata.temporaryNote, undefined);
});

test("commitOperatorDataChange creates and permanently deletes arbitrary records", async () => {
  const services = new FakeCollection();
  const deps = createDeps({ services });

  const created = await commitOperatorDataChange(
    {
      collection: "services",
      docId: "svc-custom",
      operation: "create",
      data: {
        serviceId: "svc-custom",
        serviceDate: "2026-05-03",
        title: "Custom Service"
      },
      humanConfirmed: true,
      confirmationSummary: "Dan confirmed creating svc-custom."
    },
    deps
  );

  assert.equal(created.path, "services/svc-custom");
  assert.equal((await services.doc("svc-custom").get()).exists, true);

  const deleted = await commitOperatorDataChange(
    {
      collection: "services",
      docId: "svc-custom",
      operation: "delete",
      humanConfirmed: true,
      confirmationSummary: "Dan confirmed permanently deleting svc-custom."
    },
    deps
  );

  assert.equal(deleted.deleted, true);
  assert.equal((await services.doc("svc-custom").get()).exists, false);
});

test("commitOperatorDataChange applies field patches during create", async () => {
  const songs = new FakeCollection();
  const deps = createDeps({ songs });

  const created = await commitOperatorDataChange(
    {
      collection: "songs",
      docId: "church-special-this-blood",
      operation: "create",
      data: {
        songId: "church-special-this-blood",
        canonicalTitle: "This Blood"
      },
      fieldPatches: [
        {
          fieldPath: "ministryPlanning.allowedUsageRoles",
          value: ["special_music"]
        },
        {
          fieldPath: "ministryPlanning.notes",
          value: "Favorite and powerful special."
        }
      ],
      humanConfirmed: true,
      confirmationSummary: "Dan confirmed creating the This Blood special music record."
    },
    deps
  );

  assert.equal(created.path, "songs/church-special-this-blood");
  assert.deepEqual(created.newData.ministryPlanning.allowedUsageRoles, ["special_music"]);
  assert.equal(created.newData.ministryPlanning.notes, "Favorite and powerful special.");

  const saved = (await songs.doc("church-special-this-blood").get()).data();
  assert.deepEqual(saved.ministryPlanning.allowedUsageRoles, ["special_music"]);
  assert.equal(saved.ministryPlanning.notes, "Favorite and powerful special.");
});

test("operator can create approved song pairing records", async () => {
  const songPairings = new FakeCollection();
  const deps = createDeps({ songPairings });

  const result = await commitOperatorDataChange(
    {
      collection: "songPairings",
      docId: "pair-rejoice-0381-thank-you-lord",
      operation: "create",
      data: {
        pairingId: "pair-rejoice-0381-thank-you-lord",
        primarySongId: "rejoice-0381",
        appendedSongId: "chorus-thank-you-lord",
        pairingType: "append_chorus",
        status: "approved",
        usageRoles: ["congregational"],
        transitionNote: "Move directly after the final verse."
      },
      humanConfirmed: true,
      confirmationSummary: "Dan confirmed creating the Blessed Assurance chorus pairing."
    },
    deps
  );

  assert.equal(result.path, "songPairings/pair-rejoice-0381-thank-you-lord");
  assert.equal((await songPairings.doc("pair-rejoice-0381-thank-you-lord").get()).exists, true);
});

test("listOperatorCollections exposes the broad operator surface", () => {
  const result = listOperatorCollections();

  assert.ok(result.collections.some((entry) => entry.collection === "songs"));
  assert.ok(result.collections.some((entry) => entry.collection === "songPairings"));
  assert.ok(result.collections.some((entry) => entry.collection === "services"));
  assert.ok(result.collections.some((entry) => entry.collection === "serviceOrderItems"));
  assert.ok(result.collections.some((entry) => entry.collection === "serviceMoments"));
  assert.equal(result.collections.find((entry) => entry.collection === "songs").canDelete, true);
});
