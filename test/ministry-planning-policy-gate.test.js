"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runWithMinistryPlanningPolicy: gate } = require("../lib/ministry-planning-policy-gate");
function fixture() {
  const state = { configVersion: "policy-v1", documents: { operatorGuidance: { content: "Current rules" } } };
  const deps = { ministryPlanningConfigCollection: { doc: () => ({ get: async () => ({ exists: true, data: () => structuredClone(state) }) }) } };
  return { state, deps };
}
test("missing or stale policy blocks both reads and writes before any domain action", async () => {
  const { deps } = fixture();
  for (const mode of ["query", "command"]) for (const policyVersion of [undefined, "old", "", 1]) {
    let calls = 0;
    await assert.rejects(gate({ mode, operation: "listSpecialMusicProfiles", arguments: { policyVersion } }, deps, async () => { calls++; }), { code: "ministry_policy_review_required" });
    assert.equal(calls, 0);
  }
});
test("current acknowledgement is removed before domain validation and replay fingerprints", async () => {
  const { state, deps } = fixture();
  const input = { mode: "command", operation: "saveSpecialMusicProfile", idempotencyKey: "same-intent", arguments: { policyVersion: "policy-v1", specialMusicProfileId: "profile", expectedVersion: 2 } };
  const first = await gate(input, deps, async value => value);
  assert.equal(first.arguments.policyVersion, undefined);
  assert.equal(first.idempotencyKey, "same-intent");
  state.configVersion = "policy-v2";
  await assert.rejects(gate(input, deps, async () => {}), { code: "ministry_policy_review_required" });
  const second = await gate({ ...input, arguments: { ...input.arguments, policyVersion: "policy-v2" } }, deps, async value => value);
  assert.deepEqual(first, second);
});
test("guidance remains accessible, but commands cannot claim the guidance exemption", async () => {
  const { deps } = fixture();
  const input = { mode: "query", operation: "getMinistryPlanningConfig", arguments: { sections: ["operatorGuidance"] } };
  assert.deepEqual(await gate(input, {}, async value => value), input);
  await assert.rejects(gate({ ...input, mode: "command" }, deps, async () => {}), { code: "ministry_policy_review_required" });
});
test("absent policy content fails closed even with a matching version", async () => {
  const { deps, state } = fixture();
  state.documents = {};
  await assert.rejects(gate({ mode: "query", operation: "searchServices", arguments: { policyVersion: "policy-v1" } }, deps, async () => {}), { code: "ministry_policy_unavailable" });
});
