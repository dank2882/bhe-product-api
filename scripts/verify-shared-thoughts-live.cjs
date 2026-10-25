"use strict";
// Explicit test fixtures through the existing authenticated service boundary.
// This is NOT evidence of Sarah's own OAuth or ChatGPT session.
const { execFileSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
if (!process.argv.includes("--write-acceptance")) throw new Error("Pass --write-acceptance for labeled verification fixtures");
const config = JSON.parse(execFileSync("gcloud", ["run", "services", "describe", "bhe-product-api", "--project=location-map-985", "--region=us-west1", "--format=json"], { encoding: "utf8" }));
const env = Object.fromEntries(config.spec.template.spec.containers[0].env.map(e => [e.name, e]));
const secret = env.BHE_API_KEY.valueFrom.secretKeyRef;
const key = execFileSync("gcloud", ["secrets", "versions", "access", secret.key, `--secret=${secret.name}`, "--project=location-map-985"], { encoding: "utf8" }).trim();
const dan = env.SHARED_THOUGHTS_DAN_SUBJECT.value, sarah = env.SHARED_THOUGHTS_SARAH_SUBJECT.value;
const base = process.env.SHARED_THOUGHTS_TEST_URL || config.status.url;
const runId = `shared-thoughts-verification-${randomUUID()}`;
const evidence = { runId, base, boundary: "Authenticated internal service actor tests, not independent ChatGPT/OAuth client acceptance", checks: [], records: [], startedAt: new Date().toISOString() };
const pass = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function call(actor, mode, operation, args = {}, idempotencyKey = `${runId}-${randomUUID()}`) {
  const res = await fetch(`${base}/task-management/${mode}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key,
    "x-bhe-actor-sub": actor, "x-bhe-actor-subjects": JSON.stringify([actor]), "x-bhe-task-role": "admin", "x-bhe-task-scopes": "tasks.read tasks.write" },
    body: JSON.stringify({ operation, arguments: args, ...(mode === "command" ? { idempotencyKey } : {}) }), signal: AbortSignal.timeout(60000) });
  const result = await res.json();
  if (!result.ok) throw Object.assign(new Error(result.error?.message || "Live request failed"), { code: result.error?.code });
  return result.result;
}
const read = (actor, thoughtId) => call(actor, "query", "getSharedThought", { thoughtId });
(async () => {
  try {
    const exact = "  [System verification fixture, not Dan's personal thought]\nPreserve these words — café.  ";
    const args = { title: `[System verification] Shared Thoughts ${runId}`, exactText: exact, assistantSummary: "A separate AI interpretation for verification only." };
    const draft = await call(dan, "command", "prepareSharedThought", args, `${runId}-prepare`);
    evidence.records.push(draft.thoughtId);
    const thoughtId = draft.thoughtId;
    let saved = await read(dan, thoughtId);
    assert.equal(saved.thought.exactText, exact);
    assert.equal(saved.thought.state, "draft");
    await assert.rejects(read(sarah, thoughtId), { code: "shared_thought_not_found" });
    assert.equal((await call(sarah, "query", "listSharedThoughts", { query: runId })).thoughts.length, 0);
    pass("private draft exact readback; Sarah cannot read or discover it");
    await assert.rejects(call(dan, "command", "shareSharedThought", { thoughtId, expectedVersion: 1, approved: false, approvalDigest: saved.approvalDigest }), { code: "shared_thought_approval_required" });
    await assert.rejects(call(sarah, "command", "shareSharedThought", { thoughtId, expectedVersion: 1, approved: true, approvalDigest: saved.approvalDigest }), { code: "shared_thought_owner_only" });
    await call(dan, "command", "shareSharedThought", { thoughtId, expectedVersion: 1, approved: true, approvalDigest: saved.approvalDigest });
    saved = await read(sarah, thoughtId);
    assert.equal(saved.thought.exactText, exact);
    assert((await call(sarah, "query", "listSharedThoughts", { query: runId })).thoughts.some(t => t.thoughtId === thoughtId));
    pass("Dan approval gate; Sarah reads and discovers explicitly shared record");
    const contribution = "  [System verification fixture, not Sarah's personal words]\nSarah actor contribution — keep exact.  ";
    const addition = { thoughtId, expectedVersion: 2, exactText: contribution, assistantSummary: "Separate test interpretation." };
    await call(sarah, "command", "appendSharedThought", addition, `${runId}-sarah`);
    saved = await read(dan, thoughtId);
    assert.equal(saved.thought.contributions[0].exactText, contribution);
    assert.equal(saved.thought.contributions[0].author.subject, sarah);
    assert.equal(saved.thought.contributions[0].sequence, 1);
    await call(dan, "command", "appendSharedThought", { thoughtId, expectedVersion: 3, exactText: "[System verification fixture] Dan actor reply." });
    saved = await read(sarah, thoughtId);
    assert.deepEqual(saved.thought.contributions.map(c => c.author.subject), [sarah, dan]);
    assert.deepEqual(saved.thought.contributions.map(c => c.sequence), [1, 2]);
    pass("Sarah contributes; Dan independently retrieves and replies; wording, authorship and sequence preserved");
    const replay = await call(sarah, "command", "appendSharedThought", addition, `${runId}-sarah`);
    assert.equal(replay.replayed, true);
    assert.equal((await read(dan, thoughtId)).thought.contributions.length, 2);
    await assert.rejects(call(dan, "command", "appendSharedThought", { thoughtId, expectedVersion: 1, exactText: "stale" }), { code: "shared_thought_version_conflict" });
    for (const operation of ["getSharedThought", "listSharedThoughts", "getSharedThoughtContext"]) {
      await assert.rejects(call("shared-thoughts-unlisted-test-actor", "query", operation, operation === "getSharedThought" ? { thoughtId } : {}), { code: "shared_thought_access_denied" });
    }
    pass("replay deduplicates; stale writes and unrelated admin identity denied");
    await call(dan, "command", "revokeSharedThought", { thoughtId, expectedVersion: 4 });
    await assert.rejects(read(sarah, thoughtId), { code: "shared_thought_not_found" });
    await assert.rejects(call(sarah, "command", "appendSharedThought", addition, `${runId}-sarah`), { code: "shared_thought_not_found" });
    assert.equal((await call(sarah, "query", "listSharedThoughts", { query: runId })).thoughts.length, 0);
    saved = await read(dan, thoughtId);
    assert.equal(saved.thought.state, "revoked"); assert.equal(saved.thought.contributions[0].exactText, contribution);
    pass("revocation blocks Sarah read/search/replay; Dan retains exact history");
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed"; evidence.failure = { code: error.code || "assertion", message: error.message }; process.exitCode = 1;
  } finally {
    for (const thoughtId of evidence.records) {
      try {
        const current = await read(dan, thoughtId);
        if (current.thought.state === "shared") await call(dan, "command", "revokeSharedThought", { thoughtId, expectedVersion: current.thought.version });
      } catch (error) { evidence.cleanupFailure = error.code || "unknown"; process.exitCode = 1; }
    }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(process.env.SHARED_THOUGHTS_EVIDENCE_PATH || "/tmp/shared-thoughts-live-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks.length, failure: evidence.failure }));
  }
})();
