"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  commitTripGoogleSheetImport,
  getTripImport,
  getTripMemory,
  getTripReference,
  previewTripGoogleSheetImport,
  saveTripMemory,
  searchTripMemories
} = require("../lib/trip-service");

class FakeDocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    const value = this.collection.records.get(this.id);
    return {
      id: this.id,
      exists: value !== undefined,
      data: () => value
    };
  }

  async create(value) {
    if (this.collection.records.has(this.id)) throw new Error("already exists");
    this.collection.records.set(this.id, structuredClone(value));
  }

  async set(value) {
    this.collection.records.set(this.id, structuredClone(value));
  }
}

class FakeCollection {
  constructor(records = []) {
    this.records = new Map(records.map((record) => [record.id, structuredClone(record.data)]));
  }

  doc(id) {
    return new FakeDocRef(this, id);
  }

  async get() {
    return {
      docs: [...this.records.entries()].map(([id, value]) => ({
        id,
        data: () => structuredClone(value)
      }))
    };
  }
}

function buildSheetRequest() {
  const calls = [];
  const request = async ({ path }) => {
    calls.push(path);
    if (path.includes("values:batchGet")) {
      return {
        valueRanges: [
          {
            values: [
              ["Forms", "Passport", "First Name", "Last Name"],
              ["Complete", "Ready", "Alex", "Traveler"],
              ["", "Ready", "Jordan", "Guest"]
            ]
          },
          {
            values: [
              ["TEAM #"],
              ["1"],
              ["2"]
            ]
          },
          {
            values: [
              ["SEAT #1", "SEAT #2", "SEAT #3", "SEAT #4", "CARRY-ON", "CHECKED BAG"],
              ["12A", "", "", "", "1", "1"],
              ["12B", "", "", "", "1", "2"]
            ]
          },
          {
            values: [
              ["Apparel Order"],
              ["Participant Name", "Shirt Size", "Jacket Size"],
              ["Alex Traveler", "M", "M"],
              ["Jordan Guest", "L", "L"]
            ]
          }
        ]
      };
    }
    return { properties: { title: "2026 Philippines Trip" } };
  };
  request.calls = calls;
  return request;
}

function buildDeps(overrides = {}) {
  return {
    projectsCollection: new FakeCollection([{
      id: "project-philippines-2026",
      data: {
        projectId: "project-philippines-2026",
        visibility: "private",
        ownerSub: "dan-sub"
      }
    }]),
    tripMemoriesCollection: new FakeCollection(),
    tripImportsCollection: new FakeCollection(),
    tripParticipantsCollection: new FakeCollection(),
    tripApparelCollection: new FakeCollection(),
    googleSheetsRequest: buildSheetRequest(),
    taskAccess: {
      role: "member",
      subject: "dan-sub",
      subjects: ["dan-sub"],
      name: "Dan"
    },
    now: () => new Date("2026-08-03T06:00:00.000Z"),
    ...overrides
  };
}

test("trip memory preserves exact text, defaults private, and reads back", async () => {
  const deps = buildDeps();
  const exactText = "We landed, and the first small kindness mattered.";
  const saved = await saveTripMemory({
    exactText,
    category: "moment",
    idempotencyKey: "memory-flight-kindness-001"
  }, deps);
  assert.equal(saved.memory.exactText, exactText);
  assert.equal(saved.memory.privacy, "private_only");
  assert.match(saved.memory.philippineLocalTimestamp, /Asia\/Manila$/);
  assert.equal(saved.idempotency.replayed, false);

  const replayed = await saveTripMemory({
    exactText,
    category: "moment",
    idempotencyKey: "memory-flight-kindness-001"
  }, deps);
  assert.equal(replayed.idempotency.replayed, true);

  const readBack = await getTripMemory({ memoryId: saved.memory.memoryId }, deps);
  assert.equal(readBack.memory.exactText, exactText);
  const history = await searchTripMemories({ query: "small kindness" }, deps);
  assert.equal(history.count, 1);
  assert.equal(history.memories[0].memoryId, saved.memory.memoryId);
});

test("trip memory rejects reuse of an idempotency key for changed text", async () => {
  const deps = buildDeps();
  await saveTripMemory({ exactText: "First", idempotencyKey: "memory-reuse-001" }, deps);
  await assert.rejects(
    saveTripMemory({ exactText: "Changed", idempotencyKey: "memory-reuse-001" }, deps),
    (error) => error.code === "trip_memory_idempotency_key_reused"
  );
});

test("private trip data cannot be read or written by another member", async () => {
  const deps = buildDeps({
    taskAccess: {
      role: "member",
      subject: "other-sub",
      subjects: ["other-sub"],
      name: "Other"
    }
  });
  await assert.rejects(
    searchTripMemories({}, deps),
    (error) => error.code === "task_access_denied"
  );
  await assert.rejects(
    saveTripMemory({ exactText: "No", idempotencyKey: "memory-other-001" }, deps),
    (error) => error.code === "task_access_denied"
  );
});

test("Sheet preview requests only privacy-approved disjoint ranges", async () => {
  const deps = buildDeps();
  const result = await previewTripGoogleSheetImport({
    googleSheetUrl: "https://docs.google.com/spreadsheets/d/12345678901234567890/edit"
  }, deps);
  assert.equal(result.preview.summary.participantCount, 2);
  assert.equal(result.preview.summary.apparelOrderCount, 2);
  assert.equal(result.preview.summary.missingFormsStatus, 1);
  assert.deepEqual(result.preview.summary.participantsByTeam, { "1": 1, "2": 1 });
  assert.ok(result.preview.privacyBoundary.excludedWorkbookContent.some((item) => item.includes("passport number")));

  const batchPath = deps.googleSheetsRequest.calls.find((path) => path.includes("values:batchGet"));
  assert.match(batchPath, /Traveller\+Information/);
  assert.match(batchPath, /Apparel\+Order/);
  assert.doesNotMatch(batchPath, /Account\+Balance/);
  assert.doesNotMatch(batchPath, /%21E%3AI|%21K%3AM|%21T%3A/);
  assert.equal(JSON.stringify(result).includes("123-45-6789"), false);
});

test("Sheet import commits only safe records and supports verified read-back", async () => {
  const deps = buildDeps();
  const input = {
    googleSheetId: "12345678901234567890",
    idempotencyKey: "trip-sheet-import-2026-08-03-001"
  };
  const preview = await previewTripGoogleSheetImport(input, deps);
  const committed = await commitTripGoogleSheetImport({
    ...input,
    expectedFingerprint: preview.preview.fingerprint
  }, deps);
  assert.equal(committed.import.summary.participantCount, 2);
  assert.equal(committed.idempotency.replayed, false);

  const receipt = await getTripImport({ importId: committed.import.importId }, deps);
  assert.equal(receipt.import.fingerprint, preview.preview.fingerprint);
  const reference = await getTripReference({ query: "Alex" }, deps);
  assert.equal(reference.summary.participantCount, 1);
  assert.equal(reference.summary.apparelOrderCount, 1);
  assert.equal(reference.participants[0].displayName, "Alex Traveler");
  assert.deepEqual(reference.participants[0].seatAssignments, ["12A"]);
  assert.equal(reference.apparel[0].shirtSize, "M");
  assert.equal(reference.latestImport.importId, committed.import.importId);

  const stored = [...deps.tripParticipantsCollection.records.values()][0];
  assert.deepEqual(Object.keys(stored).filter((key) => [
    "legalName", "dateOfBirth", "passportNumber", "bookingNumber", "ticketNumber", "tsaPrecheck"
  ].includes(key)), []);

  const replayed = await commitTripGoogleSheetImport({
    ...input,
    expectedFingerprint: preview.preview.fingerprint
  }, deps);
  assert.equal(replayed.idempotency.replayed, true);
});

test("Sheet import stops when a whitelisted header changes", async () => {
  const request = buildSheetRequest();
  const original = request;
  const changedRequest = async (args) => {
    const result = await original(args);
    if (args.path.includes("values:batchGet")) result.valueRanges[0].values[0][1] = "Passport Number";
    return result;
  };
  const deps = buildDeps({ googleSheetsRequest: changedRequest });
  await assert.rejects(
    previewTripGoogleSheetImport({ googleSheetId: "12345678901234567890" }, deps),
    (error) => error.code === "trip_sheet_header_mismatch"
  );
});
