"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { SECTIONS, getLifeContext: get, saveLifeContext: save } = require("../lib/life-context");
const empty = () => Object.fromEntries(SECTIONS.map(s => [s, []]));
function fixture() {
  const db = fakeFirestore();
  const deps = { firestoreDb: db, danOwnerSubjects: ["dan", "dan-alias"], taskAccess: { subject: "dan", role: "admin" }, now: () => "2026-10-28T20:00:00Z" };
  const sections = empty();
  sections.communicationPreferences = [{ id: "sample", kind: "original_statement", text: "  Fictional test preference.\n", sourceReference: "Synthetic fixture supplied for tests" }];
  sections.roles = [{ id: "fact", kind: "confirmed_fact", text: "Fictional role", sourceReference: "Synthetic user confirmation" }];
  sections.leadershipPhilosophy = [{ id: "summary", kind: "ai_summary", text: "Fictional interpretation", sourceReference: "User reviewed synthetic summary", basedOnEntryIds: ["sample"] }];
  const input = { sections, expectedVersion: 0, idempotencyKey: "fixture-save-001", approvalConfirmation: "SAVE DAN LIFE CONTEXT", approvalNote: "Synthetic explicit approval; not Dan profile content" };
  return { db, deps, input };
}
test("empty retrieval never seeds; only selected sections are returned with exact provenance", async () => {
  const { db, deps, input } = fixture();
  assert.equal((await get({ sections: ["roles"] }, deps)).setupRequired, true);
  assert.equal(db.rows.size, 0);
  await save(input, deps);
  const result = await get({ sections: ["communicationPreferences"] }, { ...deps });
  assert.equal(result.profile.sections.communicationPreferences[0].text, "  Fictional test preference.\n");
  assert.deepEqual(Object.keys(result.profile.sections), ["communicationPreferences"]);
  assert(!JSON.stringify(result).includes("Fictional role"));
  assert(!JSON.stringify(result).includes(input.approvalNote));
  assert.equal(result.profile.approvedBySub, "dan");
  assert.deepEqual((await get({ sections: [] }, deps)).profile.sections, {});
  assert.equal((await get({ sections: ["roles"] }, { ...deps, taskAccess: { subject: "dan-alias" } })).version, 1);
});
test("denies delegates, administrators, missing identity and forged aliases before storage access", async () => {
  const { deps, input } = fixture();
  for (const subject of ["sarah", "staff", "", "administrator"]) {
    const denied = { ...deps, firestoreDb: { collection: () => { throw Error("Storage must not be reached"); } }, taskAccess: { subject, subjects: ["dan"], role: "admin" }, privateDelegationEnv: { DAN_PRIVATE_DELEGATE_SUBJECTS: subject, DAN_PRIVATE_OWNER_SUBJECTS: "dan" } };
    for (const operation of [() => get({ sections: ["roles"] }, denied), () => get({ sections: [], version: 1 }, denied), () => save(input, denied)]) await assert.rejects(operation, e => e.code === "life_context_access_denied");
  }
  await assert.rejects(get({ sections: [] }, { ...deps, danOwnerSubjects: [] }), /only to Dan/);
});
test("exact approval, bounded shapes and explicit provenance are required with no partial writes", async () => {
  const { db, deps, input } = fixture();
  for (const changed of [
    { approvalConfirmation: "" }, { approvalNote: "" }, { expectedVersion: -1 }, { idempotencyKey: "short" },
    { ownerSub: "dan" }, { sections: { roles: [] } },
    { sections: { ...empty(), roles: [{ ...input.sections.roles[0], kind: "inferred_fact" }] } },
    { sections: { ...empty(), roles: [{ ...input.sections.roles[0], sourceReference: "" }] } },
    { sections: { ...empty(), roles: [{ ...input.sections.roles[0], text: "x".repeat(4001) }] } },
    { sections: { ...input.sections, leadershipPhilosophy: [{ ...input.sections.leadershipPhilosophy[0], basedOnEntryIds: ["missing"] }] } }
  ]) await assert.rejects(save({ ...input, ...changed }, deps), e => e.code === "life_context_invalid_input");
  assert.equal(db.rows.size, 0);
  for (const sections of [undefined, ["roles", "roles"], ["privateCare"]]) await assert.rejects(get({ sections }, deps), /sections/);
});
test("atomic revisions, actor-bound idempotency and concurrency preserve approved history", async () => {
  const { db, deps, input } = fixture();
  assert.equal((await save(input, deps)).version, 1);
  assert.equal((await save(input, deps)).replayed, true);
  for (const changed of [{ expectedVersion: 1 }, { approvalNote: "Changed approval" }, { sections: empty() }]) await assert.rejects(save({ ...input, ...changed }, deps), e => e.code === "life_context_idempotency_conflict");
  await assert.rejects(save(input, { ...deps, taskAccess: { subject: "dan-alias" } }), e => e.code === "life_context_idempotency_conflict");
  const writes = await Promise.allSettled(["a", "b"].map(n => save({ ...input, expectedVersion: 1, sections: empty(), idempotencyKey: `concurrent-${n}` }, deps)));
  assert.equal(writes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(writes.find(r => r.status === "rejected").reason.code, "life_context_version_conflict");
  assert.equal((await get({ sections: SECTIONS }, deps)).version, 2);
  assert.equal((await get({ sections: ["communicationPreferences"], version: 1 }, deps)).profile.sections.communicationPreferences[0].text, input.sections.communicationPreferences[0].text);
  assert.equal([...db.rows.keys()].filter(p => p.includes("/revisions/")).length, 2);
  await assert.rejects(get({ sections: [], version: 3 }, deps), e => e.code === "life_context_not_found");
  assert.equal((await save(input, deps)).version, 1); // Retry reports its original receipt, not current state.
});
