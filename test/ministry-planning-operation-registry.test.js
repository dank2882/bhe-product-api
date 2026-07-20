"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  CATALOG_HASH,
  CATALOG_VERSION,
  MINISTRY_PLANNING_OPERATIONS,
  listMinistryPlanningOperations,
  runMinistryPlanningOperation
} = require("../lib/ministry-planning-operation-registry");

const ROOT_DIR = path.resolve(__dirname, "..");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    return {
      exists: this.collection.store.has(this.id),
      data: () => clone(this.collection.store.get(this.id))
    };
  }

  async update(value) {
    this.collection.store.set(this.id, { ...this.collection.store.get(this.id), ...clone(value) });
  }

  async set(value) {
    this.collection.store.set(this.id, clone(value));
  }
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
  }

  doc(id) {
    return new FakeDocRef(this, id);
  }

  limit(maxDocs) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries()).slice(0, maxDocs).map(([id, value]) => ({
          id,
          data: () => clone(value)
        }))
      })
    };
  }
}

function createDeps() {
  return {
    servicesCollection: new FakeCollection({
      "svc-plan-2026-07-12-sunday-evening": {
        serviceId: "svc-plan-2026-07-12-sunday-evening",
        serviceDate: "2026-07-12",
        serviceType: "sunday_evening",
        title: "Evening Service",
        source: "spreadsheet_import",
        sourceImportId: "source-import"
      }
    }),
    serviceSongEventsCollection: new FakeCollection({
      "event-1": {
        serviceSongEventId: "event-1",
        serviceId: "svc-plan-2026-07-12-sunday-evening",
        title: "262 - Footsteps of Jesus",
        songTitleCandidate: "262 - Footsteps of Jesus",
        slotIndex: 10,
        usageRole: "congregational"
      }
    }),
    breezeImportsCollection: new FakeCollection(),
    sourceImportsCollection: new FakeCollection(),
    songsCollection: new FakeCollection({
      "rejoice-262-footsteps-of-jesus": {
        songId: "rejoice-262-footsteps-of-jesus",
        hymnalNumber: 262,
        canonicalTitle: "Footsteps of Jesus",
        ministryPlanning: { rotationStrength: "situational", notes: "" }
      }
    }),
    songMetadataAuditCollection: new FakeCollection(),
    pianistsCollection: new FakeCollection(),
    servicePianoPlansCollection: new FakeCollection(),
    serviceMinistryAssignmentsCollection: new FakeCollection(),
    now: () => "2026-07-15T20:00:00.000Z",
    createAuditId: () => "audit-1"
  };
}

test("ministry catalog separates normal commands from destructive confirmation", () => {
  const catalog = listMinistryPlanningOperations();
  assert.equal(catalog.count, MINISTRY_PLANNING_OPERATIONS.length);
  assert.deepEqual(catalog.modes, ["query", "command"]);
  assert.equal(
    catalog.operations.find(({ operation }) => operation === "searchServices").confirmationPolicy,
    "none"
  );
  assert.equal(
    catalog.operations.find(({ operation }) => operation === "mutateData").confirmationPolicy,
    "destructive_only"
  );
  assert.ok(catalog.operations.some(({ operation }) => operation === "syncMusicPlanningSpreadsheet"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "recordServiceSongFeedback"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "getMinistryPlanningConfig"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "savePianistProfile"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "saveServicePianoAssignments"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "saveServiceCongregationalPlan"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "saveServiceMinistryAssignments"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "syncServiceAssignmentsToSpreadsheet"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "listGoogleSheetBackups"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "readGoogleSheetRange"));
  assert.ok(catalog.operations.some(({ operation }) => operation === "restoreGoogleSheetBackup"));
});

test("Builder dispatcher schema and generated catalog match the live ministry registry", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(ROOT_DIR, "docs/gpts/ministry-planner.schema.dispatcher-upload.json"),
    "utf8"
  ));
  const catalog = fs.readFileSync(
    path.join(ROOT_DIR, "docs/gpts/ministry-planning.operation-catalog.md"),
    "utf8"
  );
  const operationIds = Object.values(schema.paths)
    .flatMap((pathItem) => Object.values(pathItem))
    .map((operation) => operation.operationId)
    .filter(Boolean);

  assert.deepEqual(operationIds, [
    "listMinistryPlanningOperations",
    "runMinistryPlanningQuery",
    "runMinistryPlanningCommand"
  ]);
  assert.match(catalog, new RegExp(CATALOG_VERSION));
  assert.match(catalog, new RegExp(CATALOG_HASH));
  const requestSchemaByMode = {
    query: schema.components.schemas.QueryDispatchRequest,
    command: schema.components.schemas.CommandDispatchRequest
  };
  const argumentSchemaByMode = {
    query: schema.components.schemas.QueryDispatchArguments,
    command: schema.components.schemas.CommandDispatchArguments
  };

  for (const operation of MINISTRY_PLANNING_OPERATIONS) {
    const requestSchema = requestSchemaByMode[operation.mode];
    const argumentSchema = argumentSchemaByMode[operation.mode];
    assert.ok(requestSchema.required.includes("arguments"));
    assert.ok(requestSchema.properties.operation.enum.includes(operation.name));

    for (const argumentName of [...operation.required, ...operation.optional]) {
      assert.ok(
        argumentSchema.properties[argumentName],
        `${operation.mode} Action schema is missing ${operation.name}.${argumentName}`
      );
    }
  }

  assert.equal(schema.components.schemas.CommandDispatchRequest.properties.idempotencyKey.maxLength, 200);
  assert.equal(schema.components.schemas.QueryDispatchArguments.properties.query.type, "string");
  assert.equal(schema.components.schemas.CommandDispatchArguments.properties.feedback.type, "string");
  assert.equal(schema.paths["/ministry-planning/query"].post["x-openai-isConsequential"], false);
  assert.equal(schema.paths["/ministry-planning/command"].post["x-openai-isConsequential"], false);
});

test("query dispatcher reads last Sunday night without a refresh or confirmation", async () => {
  const response = await runMinistryPlanningOperation(
    {
      mode: "query",
      operation: "searchServices",
      arguments: { query: "last Sunday night" }
    },
    { ...createDeps(), now: () => new Date("2026-07-15T20:00:00.000Z") }
  );

  assert.equal(response.result.count, 1);
  assert.equal(response.result.services[0].serviceDate, "2026-07-12");
  assert.equal(response.result.services[0].songs[0].title, "262 - Footsteps of Jesus");
});

test("service feedback resolves an imported hymn number and updates planning data immediately", async () => {
  const deps = createDeps();
  const response = await runMinistryPlanningOperation(
    {
      mode: "command",
      operation: "recordServiceSongFeedback",
      arguments: {
        serviceId: "svc-plan-2026-07-12-sunday-evening",
        feedback: "These songs dragged out; avoid this group together for now."
      }
    },
    deps
  );

  assert.equal(response.result.updatedCount, 1);
  assert.equal(response.result.unresolvedCount, 0);
  const song = deps.songsCollection.store.get("rejoice-262-footsteps-of-jesus");
  assert.equal(song.ministryPlanning.rotationStrength, "rare");
  assert.match(song.ministryPlanning.notes, /dragged out/);
  assert.equal(deps.songMetadataAuditCollection.store.size, 1);
});

test("pianist profile command is a normal dispatcher write", async () => {
  const deps = createDeps();
  const response = await runMinistryPlanningOperation(
    {
      mode: "command",
      operation: "savePianistProfile",
      arguments: {
        displayName: "Learning Player",
        capabilityLevel: "developing",
        defaultAvailability: "available"
      }
    },
    deps
  );

  assert.equal(response.result.created, true);
  assert.deepEqual(response.result.profile.eligiblePositions, ["piano_3", "piano_4"]);
  assert.equal(deps.pianistsCollection.store.has("pianist-learning_player"), true);
});

test("dispatcher rejects a mode mismatch", async () => {
  await assert.rejects(
    () => runMinistryPlanningOperation(
      { mode: "command", operation: "searchServices", arguments: { query: "Sunday" } },
      createDeps()
    ),
    { code: "operation_mode_mismatch", statusCode: 400 }
  );
});
