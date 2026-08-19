"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  archivePrayer, commitLogosImport, createPrayer, createPrayerList, getPrayer,
  getPrayerHistory, getTodaysPrayers, listPrayers, markPrayerAnswered,
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
  const tomorrow = await getTodaysPrayers({ at: "2026-08-22T17:00:00.000Z" }, d);
  assert.equal(tomorrow.prayers.length, 0);
  const found = await searchPrayers({ query: "sensitive" }, d);
  assert.equal(found.prayers[0].id, prayer.id);
  assert.equal(found.plaintextIndexCreated, false);
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
  const inventory = await listPrayers({ statuses: ["active", "answered", "archived"] }, d);
  assert.equal(inventory.totalCount, 2);
  assert.equal(inventory.prayers.find((prayer) => prayer.title === "Pastor transition").status, "answered");
  assert.deepEqual(inventory.prayers.find((prayer) => prayer.title === "Pastor transition").schedule.weekdays, [5]);
  const replayedCommit = await commitLogosImport({ importId: "logos-2026", approved: true }, d);
  assert.equal(replayedCommit.replayed, true);
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
