"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runIdempotentMinistryPlanningOperation: run } = require("../lib/ministry-planning-operation-execution");
const { listSpecialMusicProfiles, getSpecialMusicProfile } = require("../lib/special-music-profile-service");

function fixture() {
  const store = new Map();
  const snapshot = (path) => ({ id: path.split("/").at(-1), exists: store.has(path), data: () => structuredClone(store.get(path)) });
  const collection = (name) => ({
    doc: (id) => ({ id, path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }),
    orderBy: () => {
      let after = "", limit = 200;
      const query = { startAfter(value) { after = value; return query; }, limit(value) { limit = value; return query; }, async get() {
        return { docs: [...store.keys()].filter((key) => key.startsWith(`${name}/`) && key.slice(name.length + 1) > after).sort().slice(0, limit).map(snapshot) };
      } };
      return query;
    }
  });
  let queue = Promise.resolve();
  const deps = { actorSubject: "test-actor", pianistsCollection: collection("pianists"), specialMusicProfilesCollection: collection("profiles"), ministryPlanningOperationExecutionsCollection: collection("receipts"), db: {
    runTransaction(fn) {
      const result = queue.then(async () => {
        const writes = [];
        const value = await fn({ get: async (ref) => snapshot(ref.path), set: (ref, data) => writes.push([ref.path, structuredClone(data)]) });
        for (const [key, data] of writes) store.set(key, data);
        return value;
      });
      queue = result.catch(() => {});
      return result;
    }
  } };
  return { deps, store };
}
function request(id, tier = 3, extra = {}) {
  return { mode: "command", operation: "saveSpecialMusicProfile", idempotencyKey: `create-${id}`, arguments: {
    specialMusicProfileId: id, expectedVersion: 0, displayName: "Exact Name ", profileType: "individual", tier, members: [{ displayName: "Exact Name " }], ...extra
  } };
}
test("tiers, explicit availability, exact names, filters and full paginated read-back", async () => {
  const { deps } = fixture();
  for (let tier = 1; tier <= 3; tier++) await run(request(`singer-${tier}`, tier), deps);
  assert.equal((await listSpecialMusicProfiles({ serviceType: "Sunday Morning" }, deps)).count, 1);
  assert.equal((await listSpecialMusicProfiles({ serviceType: "sunday_evening" }, deps)).count, 2);
  assert.equal((await listSpecialMusicProfiles({ serviceType: "Wednesday Night" }, deps)).count, 3);
  assert.equal((await listSpecialMusicProfiles({ serviceType: "special_service" }, deps)).count, 1);
  const first = await listSpecialMusicProfiles({ limit: 2 }, deps);
  const second = await listSpecialMusicProfiles({ afterId: first.nextCursor, limit: 2 }, deps);
  assert.equal(first.count + second.count, 3);
  assert.equal(second.nextCursor, null);
  const { profile } = await getSpecialMusicProfile({ specialMusicProfileId: "singer-2" }, deps);
  assert.equal(profile.displayName, "Exact Name ");
  assert.deepEqual(profile.tierAvailability.serviceTypes, ["sunday_night", "wednesday_night"]);
});
test("atomic receipts, replay, concurrency conflict, archive, and restore", async () => {
  const { deps, store } = fixture();
  const input = request("singer");
  await run(input, deps);
  assert.equal((await run(input, deps)).idempotency.replayed, true);
  await assert.rejects(run({ ...input, arguments: { ...input.arguments, tier: 1 } }, deps), { code: "idempotency_key_reused" });
  const update = (key) => ({ ...input, idempotencyKey: key, arguments: { specialMusicProfileId: "singer", expectedVersion: 1, tier: 2 } });
  const results = await Promise.allSettled([run(update("update-a"), deps), run(update("update-b"), deps)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "version_conflict");
  await run({ mode: "command", operation: "archiveSpecialMusicProfile", idempotencyKey: "archive-singer", arguments: { specialMusicProfileId: "singer", expectedVersion: 2 } }, deps);
  assert.equal((await listSpecialMusicProfiles({}, deps)).count, 0);
  assert.equal((await listSpecialMusicProfiles({ status: "archived" }, deps)).count, 1);
  await run({ ...input, idempotencyKey: "restore-singer", arguments: { specialMusicProfileId: "singer", expectedVersion: 3, status: "active" } }, deps);
  assert.equal((await getSpecialMusicProfile({ specialMusicProfileId: "singer" }, deps)).profile.version, 4);
  assert.equal([...store.keys()].filter((key) => key.startsWith("receipts/")).length, 4);
});
test("reject invalid input and missing actor/key without writes", async () => {
  const { deps, store } = fixture();
  for (const extra of [{ tier: 4 }, { profileType: "other" }, { members: [] }, { tierAvailability: {} }, { expectedVersion: -1 }, { members: [{ personId: "123" }] }]) {
    await assert.rejects(run(request("invalid", 3, extra), deps));
  }
  await assert.rejects(run(request("invalid"), { ...deps, actorSubject: "" }));
  await assert.rejects(run({ ...request("invalid"), idempotencyKey: "" }, deps));
  assert.equal(store.size, 0);
});

test("eligibility filters search beyond the first storage page and preserve group membership", async () => {
  const { deps, store } = fixture();
  for (let i = 0; i < 205; i++) store.set(`profiles/a-${String(i).padStart(3, "0")}`, { tier: 1, status: "active", profileType: "individual" });
  await run(request("z-group", 3, { profileType: "duo", members: [{ displayName: "Member One", breezePersonId: "123" }, { displayName: "Member Two" }], aliases: ["Exact Alias"] }), deps);
  const result = await listSpecialMusicProfiles({ serviceType: "sunday_morning", profileType: "duo" }, deps);
  assert.equal(result.count, 1);
  assert.equal(result.profiles[0].specialMusicProfileId, "z-group");
  assert.equal(result.profiles[0].members.length, 2);
  assert.deepEqual(result.profiles[0].aliases, ["Exact Alias"]);
});

test("optional group name can be added, preserved, and cleared; unknown family members are allowed", async () => {
  const { deps } = fixture();
  const initial = await run(request("family", 2, { profileType: "family", members: [] }), deps);
  assert.equal(initial.result.profile.groupName, "");
  const update = async (expectedVersion, changes) => run({ mode: "command", operation: "saveSpecialMusicProfile", idempotencyKey: `family-v${expectedVersion}`, arguments: { specialMusicProfileId: "family", expectedVersion, ...changes } }, deps);
  await update(1, { groupName: "Example Family" });
  assert.equal((await update(2, { tier: 3 })).result.profile.groupName, "Example Family");
  assert.equal((await update(3, { groupName: "" })).result.profile.groupName, "");
});

test("accompanists use canonical pianist IDs, preserve on update, and show in table", async () => {
  const { deps, store } = fixture();
  store.set("pianists/pianist-a", { displayName: "Pianist A" });
  store.set("pianists/pianist-b", { displayName: "Pianist B" });
  const result = await run(request("solo", 3, { accompanists: [{ pianistId: "pianist-a", displayName: "Wrong caller name" }, { pianistId: "pianist-b" }] }), deps);
  assert.deepEqual(result.result.profile.accompanists.map(p => p.displayName), ["Pianist A", "Pianist B"]);
  const table = await listSpecialMusicProfiles({ format: "table" }, deps);
  assert.equal(table.table.rows[0][6], "Pianist A / Pianist B");
  const update = (expectedVersion, changes) => run({ mode: "command", operation: "saveSpecialMusicProfile", idempotencyKey: `solo-update-v${expectedVersion}`, arguments: { specialMusicProfileId: "solo", expectedVersion, ...changes } }, deps);
  assert.equal((await update(1, { notes: "Keep accompanists" })).result.profile.accompanists.length, 2);
  await update(2, { accompanists: [] });
  assert.equal((await listSpecialMusicProfiles({ format: "table" }, deps)).table.rows[0][6], "Unassigned");
  await assert.rejects(run(request("bad-reference", 3, { accompanists: [{ pianistId: "missing" }] }), deps), { code: "pianist_not_found" });
  await assert.rejects(run(request("duplicate-reference", 3, { accompanists: [{ pianistId: "pianist-a" }, { pianistId: "pianist-a" }] }), deps));
  assert.equal(store.has("profiles/bad-reference"), false);
});
