"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  archivePrayer, commitLogosImport, createPrayer, createPrayerList, getPrayer,
  getPrayerHistory, getPrayerImport, getTodaysPrayers, listPrayers, markPrayerAnswered,
  previewLogosImport, recordPrayed, reopenPrayer, searchPrayers, updatePrayer
} = require("../lib/prayer-management-service");
const { runIdempotentPrayerManagementOperation } = require("../lib/prayer-management-operation-execution");
const { STAFF_AUTHORIZATION_ROLE_BUNDLES } = require("../lib/staff-authorization-service");
const { extractDocxParagraphs, parseParagraphs } = require("../lib/logos-prayer-import");
const { createKmsPrayerCrypto } = require("../lib/prayer-crypto");

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
class FakeCollection {
  constructor() { this.store = new Map(); }
  doc(id) { return {
    get: async () => ({ exists: this.store.has(id), data: () => clone(this.store.get(id)) }),
    create: async (value) => { if (this.store.has(id)) throw Object.assign(new Error("already exists"), { code: 6 }); this.store.set(id, clone(value)); },
    set: async (value) => { this.store.set(id, clone(value)); }
  }; }
  limit(max) { return { get: async () => ({ docs: [...this.store.entries()].slice(0, max).map(([id, value]) => ({ id, data: () => clone(value) })) }) }; }
}
function crypto() { return {
  encryptJson: async (value, context) => ({ algorithm: "TEST_KMS", ciphertext: Buffer.from(JSON.stringify({ value, context })).toString("base64") }),
  decryptJson: async (envelope, context) => { const parsed = JSON.parse(Buffer.from(envelope.ciphertext, "base64").toString("utf8")); assert.deepEqual(parsed.context, context); return parsed.value; }
}; }
function deps(subject = "entra|dan", scopes = ["prayer.read", "prayer.write"]) {
  let seq = 0;
  return {
    prayerListsCollection: new FakeCollection(), prayersCollection: new FakeCollection(), prayerEventsCollection: new FakeCollection(),
    prayerImportsCollection: new FakeCollection(), prayerOperationExecutionsCollection: new FakeCollection(), prayerAuditEventsCollection: new FakeCollection(),
    prayerCrypto: crypto(), prayerOwnerSubjects: ["entra|dan"], taskAccess: { subject, subjects: [subject], name: "Dan", scopes },
    now: () => "2026-08-21T17:00:00.000Z", randomUUID: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`
  };
}
async function seed(d = deps(), schedule = { kind: "daily", timeZone: "America/Los_Angeles" }) {
  const { list } = await createPrayerList({ title: "People", description: "Private list" }, d);
  const { prayer } = await createPrayer({ listId: list.id, title: "Missionary family", prayerText: "Lord, strengthen them.", privateContext: "Sensitive context", tags: ["missions"], people: ["A Family"], topics: ["health"], schedule }, d);
  return { d, list, prayer };
}

test("content is encrypted at rest and owner-only even for an administrator", async () => {
  const { d, prayer } = await seed();
  const stored = JSON.stringify(d.prayersCollection.store.get(prayer.id));
  assert.equal(stored.includes("Missionary family"), false);
  assert.equal(stored.includes("Sensitive context"), false);
  assert.equal((await getPrayer({ prayerId: prayer.id }, d)).prayer.prayerText, "Lord, strengthen them.");
  const admin = { ...d, taskAccess: { subject: "entra|admin", subjects: ["entra|admin"], role: "admin", scopes: ["prayer.read", "prayer.write"] } };
  await assert.rejects(() => getPrayer({ prayerId: prayer.id }, admin), { code: "prayer_owner_only", statusCode: 403 });
  assert.equal(STAFF_AUTHORIZATION_ROLE_BUNDLES["FBC Staff Tools Administrator"].permissions.includes("prayer.read"), false);
  assert.deepEqual(STAFF_AUTHORIZATION_ROLE_BUNDLES["Dan Prayer Management Owner"].permissions, ["prayer.read", "prayer.write"]);
});

test("owner allowlist fails closed when missing even if prayer scopes are present", async () => {
  const d = deps();
  d.prayerOwnerSubjects = [];
  await assert.rejects(() => createPrayerList({ title: "Denied" }, d), { code: "prayer_owner_not_configured", statusCode: 503 });
});

test("verified identity aliases resolve to one canonical prayer owner", async () => {
  const d = deps("google|dan");
  d.taskAccess.subjects = ["google|dan", "entra|dan"];
  const { list } = await createPrayerList({ title: "Canonical" }, d);
  assert.equal(d.prayerListsCollection.store.get(list.id).ownerSub, "entra|dan");
  d.taskAccess = { ...d.taskAccess, subject: "entra|dan", subjects: ["entra|dan", "google|dan"] };
  assert.equal((await createPrayer({ listId: list.id, title: "Alias", prayerText: "Same owner." }, d)).prayer.ownerSub, "entra|dan");
});

test("Cloud KMS encryption binds ciphertext to record type, ID, and owner through authenticated data", async () => {
  const calls = [];
  const auth = { getClient: async () => ({ request: async (request) => {
    calls.push(request);
    if (request.url.endsWith(":encrypt")) return { data: { ciphertext: "kms-ciphertext" } };
    return { data: { plaintext: Buffer.from(JSON.stringify({ title: "Private" })).toString("base64") } };
  } }) };
  const kms = createKmsPrayerCrypto({ keyName: "projects/p/locations/us/keyRings/r/cryptoKeys/k", auth });
  const context = { recordType: "prayer", recordId: "prayer-1", ownerSub: "entra|dan" };
  const envelope = await kms.encryptJson({ title: "Private" }, context);
  assert.equal(envelope.ciphertext, "kms-ciphertext");
  assert.equal(JSON.stringify(envelope).includes("Private"), false);
  assert.equal((await kms.decryptJson(envelope, context)).title, "Private");
  assert.equal(calls[0].data.additionalAuthenticatedData, calls[1].data.additionalAuthenticatedData);
  assert.match(Buffer.from(calls[0].data.additionalAuthenticatedData, "base64").toString("utf8"), /prayer-1/);
});

test("today view, search, schedules, and time zones work without a plaintext index", async () => {
  const { d, prayer } = await seed(deps(), { kind: "weekly", weekdays: [5], timeZone: "America/Los_Angeles" });
  const today = await getTodaysPrayers({ at: "2026-08-21T17:00:00.000Z" }, d);
  assert.equal(today.prayers.length, 1);
  await recordPrayed({ prayerId: prayer.id, expectedVersion: prayer.version }, d);
  const tomorrow = await getTodaysPrayers({ at: "2026-08-22T17:00:00.000Z" }, d);
  assert.equal(tomorrow.prayers.length, 0);
  const found = await searchPrayers({ query: "sensitive" }, d);
  assert.equal(found.prayers[0].id, prayer.id);
  assert.equal(found.plaintextIndexCreated, false);
});

test("today view always returns Dan's stable upward, inward, and outward prayer format with notes", async () => {
  const d = deps();
  const { list: personal } = await createPrayerList({ title: "01. Personal", description: "Imported from Logos" }, d);
  const { list: sarah } = await createPrayerList({ title: "02. Sarah", description: "Imported from Logos" }, d);
  await createPrayer({
    listId: personal.id,
    title: "Fill me with your Holy Spirit",
    prayerText: "Fill me with your Holy Spirit",
    privateContext: "Help me listen.",
    schedule: { kind: "daily", timeZone: "America/Los_Angeles" },
    presentation: { area: "upward", group: "christ", subheader: "relationship-with-god", order: 1 }
  }, d);
  await createPrayer({ listId: personal.id, title: "Physical Fitness", prayerText: "Physical Fitness", schedule: { kind: "daily" } }, d);
  await createPrayer({ listId: sarah.id, title: "Sarah's needs", prayerText: "Sarah's needs", schedule: { kind: "daily" } }, d);

  const today = await getTodaysPrayers({ at: "2026-08-21T17:00:00.000Z" }, d);
  assert.equal(today.presentation.formatVersion, "dan-upward-inward-outward-v1");
  assert.deepEqual(today.presentation.sections.map(({ number, key }) => ({ number, key })), [
    { number: "1", key: "upward" }, { number: "2", key: "inward" }, { number: "3", key: "outward" }
  ]);
  const upward = today.presentation.sections[0].groups[0].subheaders[0];
  const inward = today.presentation.sections[1].groups[0].subheaders[0];
  const companion = today.presentation.sections[2].groups[0].subheaders[0];
  assert.equal(today.prayers.find((prayer) => prayer.id === upward.prayerIds[0]).number, "1.1.1.1");
  assert.equal(today.prayers.find((prayer) => prayer.id === upward.prayerIds[0]).note, "Help me listen.");
  assert.equal(today.prayers.find((prayer) => prayer.id === upward.prayerIds[0]).sourceList.title, "01. Personal");
  assert.equal(today.prayers.find((prayer) => prayer.id === inward.prayerIds[0]).title, "Physical Fitness");
  assert.equal(today.prayers.find((prayer) => prayer.id === companion.prayerIds[0]).title, "Sarah's needs");
  assert.deepEqual(today.prayers.map((prayer) => prayer.number), ["1.1.1.1", "2.1.1.1", "3.1.1.1"]);
  assert.equal(today.presentation.sections[2].groups.find((group) => group.key === "world").subheaders.length, 3);
});

test("prayer presentation validation is explicit and versioned updates preserve private prayer text", async () => {
  const { d, prayer } = await seed();
  await assert.rejects(
    () => updatePrayer({ prayerId: prayer.id, expectedVersion: prayer.version, changes: { presentation: { area: "sideways", group: "personal" } } }, d),
    { code: "invalid_prayer_presentation" }
  );
  const updated = await updatePrayer({
    prayerId: prayer.id,
    expectedVersion: prayer.version,
    changes: { presentation: { area: "outward", group: "world", subheader: "missionaries", order: 7 } }
  }, d);
  assert.equal(updated.prayer.prayerText, "Lord, strengthen them.");
  assert.deepEqual(updated.prayer.presentation, { area: "outward", group: "world", subheader: "missionaries", order: 7 });
});

test("monthly prayer schedules preserve Logos day-of-month rotations", async () => {
  const d = deps();
  d.now = () => "2026-08-16T19:00:00.000Z";
  const { prayer } = await seed(d, { kind: "monthly", dayOfMonth: 16, timeZone: "America/Los_Angeles" });
  assert.equal((await getTodaysPrayers({ at: "2026-08-16T19:00:00.000Z" }, d)).prayers.length, 1);
  assert.equal((await getTodaysPrayers({ at: "2026-08-17T19:00:00.000Z" }, d)).prayers.length, 1);
  await recordPrayed({ prayerId: prayer.id, expectedVersion: prayer.version }, d);
  assert.equal((await getTodaysPrayers({ at: "2026-08-22T19:00:00.000Z" }, d)).prayers.length, 0);
  assert.equal((await getTodaysPrayers({ at: "2026-09-16T19:00:00.000Z" }, d)).prayers.length, 1);
  await assert.rejects(
    () => updatePrayer({ prayerId: prayer.id, expectedVersion: prayer.version + 1, changes: { schedule: { kind: "monthly", dayOfMonth: 32 } } }, d),
    { code: "invalid_prayer_schedule" }
  );
});

test("a new rotation ignores occurrences before activation and then carries missed prayer forward", async () => {
  const d = deps();
  d.now = () => "2026-08-24T19:00:00.000Z";
  await seed(d, { kind: "weekly", weekdays: [0], timeZone: "America/Los_Angeles" });
  assert.equal((await getTodaysPrayers({ at: "2026-08-24T19:00:00.000Z" }, d)).prayers.length, 0);
  assert.equal((await getTodaysPrayers({ at: "2026-08-30T19:00:00.000Z" }, d)).prayers.length, 1);
  assert.equal((await getTodaysPrayers({ at: "2026-08-31T19:00:00.000Z" }, d)).prayers.length, 1);
});

test("updates reject stale versions and preserve exact prayer text", async () => {
  const { d, prayer } = await seed();
  const updated = await updatePrayer({ prayerId: prayer.id, expectedVersion: 1, changes: { schedule: { kind: "weekly", weekdays: [5], timeZone: "America/Los_Angeles" } } }, d);
  assert.equal(updated.prayer.prayerText, "Lord, strengthen them.");
  assert.equal(updated.prayer.version, 2);
  await assert.rejects(() => updatePrayer({ prayerId: prayer.id, expectedVersion: 1, changes: { title: "Stale" } }, d), { code: "prayer_version_conflict", statusCode: 409 });
});

test("prayed, answered, reopened, and archived history is append-only", async () => {
  const { d, prayer } = await seed();
  const prayed = await recordPrayed({ prayerId: prayer.id, expectedVersion: 1, reflection: "Prayed with gratitude." }, d);
  const answered = await markPrayerAnswered({ prayerId: prayer.id, expectedVersion: prayed.prayer.version, answerText: "God provided." }, d);
  assert.equal(answered.prayer.status, "answered");
  const reopened = await reopenPrayer({ prayerId: prayer.id, expectedVersion: answered.prayer.version, note: "Continue praying." }, d);
  const archived = await archivePrayer({ prayerId: prayer.id, expectedVersion: reopened.prayer.version }, d);
  assert.equal(archived.prayer.status, "archived");
  const history = await getPrayerHistory({ prayerId: prayer.id }, d);
  assert.deepEqual(history.events.map((event) => event.eventType), ["prayed", "answered", "reopened", "archived"]);
  assert.equal(JSON.stringify([...d.prayerEventsCollection.store.values()]).includes("God provided"), false);
  assert.equal((await searchPrayers({ query: "God provided" }, d)).prayers[0].id, prayer.id);
});

test("production mutation path commits the prayer version and append-only event in one transaction", async () => {
  const { d, prayer } = await seed();
  let transactions = 0;
  d.firestoreDb = { runTransaction: async (callback) => {
    transactions += 1;
    const writes = [];
    const result = await callback({
      get: (ref) => ref.get(),
      set: (ref, value) => writes.push(() => ref.set(value)),
      create: (ref, value) => writes.push(() => ref.create(value))
    });
    for (const write of writes) await write();
    return result;
  } };
  const result = await recordPrayed({ prayerId: prayer.id, expectedVersion: 1, reflection: "Atomic reflection" }, d);
  assert.equal(transactions, 1);
  assert.equal(result.prayer.version, 2);
  assert.equal((await getPrayerHistory({ prayerId: prayer.id }, d)).events.length, 1);
});

test("command idempotency stores and replays only encrypted responses", async () => {
  const d = deps();
  const input = { mode: "command", operation: "createPrayerList", arguments: { title: "Private" }, idempotencyKey: "stable-list-create" };
  const first = await runIdempotentPrayerManagementOperation(input, d);
  const replay = await runIdempotentPrayerManagementOperation(input, d);
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(replay.result.list.title, "Private");
  const execution = [...d.prayerOperationExecutionsCollection.store.values()][0];
  assert.equal("responseJson" in execution, false);
  assert.equal("encryptedResponse" in execution, true);
  assert.equal(JSON.stringify(execution).includes('"title":"Private"'), false);
  const audit = [...d.prayerAuditEventsCollection.store.values()][0];
  assert.equal(audit.contentRedacted, true);
  assert.equal(JSON.stringify(audit).includes("Private"), false);
  await assert.rejects(() => runIdempotentPrayerManagementOperation({ ...input, arguments: { title: "Different" } }, d), { code: "idempotency_key_reused" });
  const revoked = { ...d, taskAccess: { ...d.taskAccess, scopes: [] } };
  await assert.rejects(() => runIdempotentPrayerManagementOperation(input, revoked), { code: "prayer_owner_only" });
  assert.equal(first.idempotency.protected, true);
});

test("Logos preview is approval-gated, encrypted, idempotent, and reconciled", async () => {
  const d = deps();
  const rawText = "Prayer List: Church\nPastor transition\nTags: leadership, church\nSchedule: Fridays\nAnswer: The transition was confirmed\nPrayer List: Missions\nPhilippines team";
  const first = await previewLogosImport({ importId: "logos-2026", rawText }, d);
  assert.equal(first.preview.counts.lists, 2);
  assert.equal(first.preview.counts.prayers, 2);
  assert.equal(first.preview.counts.withSchedules, 1);
  assert.equal(JSON.stringify(d.prayerImportsCollection.store.get("logos-2026")).includes("Pastor transition"), false);
  const replay = await previewLogosImport({ importId: "logos-2026", rawText }, d);
  assert.equal(replay.replayed, true);
  await assert.rejects(() => commitLogosImport({ importId: "logos-2026", approved: false }, d), { code: "prayer_import_approval_required" });
  const committed = await commitLogosImport({ importId: "logos-2026", approved: true }, d);
  assert.equal(committed.inventory.reconciled, true);
  assert.equal(committed.import.status, "committed");
  assert.equal(committed.import.version, 2);
  const committedReadback = await getPrayerImport({ importId: "logos-2026" }, d);
  assert.equal(committedReadback.import.status, "committed");
  assert.equal(committedReadback.import.version, 2);
  const inventory = await listPrayers({ statuses: ["active", "answered", "archived"] }, d);
  assert.equal(inventory.totalCount, 2);
  assert.equal(inventory.prayers.find((prayer) => prayer.title === "Pastor transition").status, "answered");
  assert.deepEqual(inventory.prayers.find((prayer) => prayer.title === "Pastor transition").schedule.weekdays, [5]);
  const replayedCommit = await commitLogosImport({ importId: "logos-2026", approved: true }, d);
  assert.equal(replayedCommit.replayed, true);
  assert.equal(replayedCommit.import.status, "committed");
});

test("malformed and partially structured Logos exports fail or surface manual review without dropping text", async () => {
  await assert.rejects(() => extractDocxParagraphs(Buffer.from("not-a-docx")), { code: "malformed_logos_export" });
  const parsed = parseParagraphs([
    { text: "Tags: urgent", style: "" },
    { text: "Preserve this otherwise unstructured prayer exactly.", style: "" },
    { text: "Schedule: every other someday", style: "" }
  ]);
  assert.equal(parsed.prayers[0].prayerText, "Preserve this otherwise unstructured prayer exactly.");
  assert.equal(parsed.manualReview.length, 3);
  assert.ok(parsed.manualReview.some((item) => item.text === "Tags: urgent"));
  assert.ok(parsed.manualReview.some((item) => item.text === "Schedule: every other someday"));
});

test("Logos parser recognizes monthly day-of-month schedules", () => {
  const parsed = parseParagraphs([
    { text: "Prayer List: Monthly", style: "" },
    { text: "Dwight Fleck", style: "" },
    { text: "Schedule: every month on day 16", style: "" }
  ]);
  assert.deepEqual(parsed.prayers[0].schedule, { kind: "monthly", dayOfMonth: 16, timeZone: "America/Los_Angeles" });
  assert.equal(parsed.manualReview.length, 0);
});

test("Logos parser preserves abbreviated weekdays and flags unanchored multi-week rotations", () => {
  const abbreviated = parseParagraphs([
    { text: "Prayer List: Weekly", style: "" },
    { text: "Connection", style: "" },
    { text: "Schedule: every week on Tue/Thu", style: "" }
  ]);
  assert.deepEqual(abbreviated.prayers[0].schedule, { kind: "weekly", weekdays: [2, 4], timeZone: "America/Los_Angeles" });
  assert.equal(abbreviated.manualReview.length, 0);

  const unanchored = parseParagraphs([
    { text: "Prayer List: Fortnightly", style: "" },
    { text: "Listen before writing", style: "" },
    { text: "Schedule: every 2 weeks on Thursday", style: "" }
  ]);
  assert.equal(unanchored.prayers[0].schedule, null);
  assert.equal(unanchored.manualReview.length, 1);
});
