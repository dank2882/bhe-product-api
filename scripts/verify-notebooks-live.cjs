"use strict";
// Explicit opt-in integration acceptance. Creates only labeled verification
// records and archives the verification notebook when checks finish.
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
if (!process.argv.includes("--write-acceptance")) throw new Error("Pass --write-acceptance to create labeled verification records");
const project = "location-map-985", region = "us-west1";
const config = JSON.parse(execFileSync("gcloud", ["run", "services", "describe", "bhe-product-api", `--project=${project}`, `--region=${region}`, "--format=json"], { encoding: "utf8" }));
const env = Object.fromEntries(config.spec.template.spec.containers[0].env.map((e) => [e.name, e]));
const secretRef = env.BHE_API_KEY.valueFrom.secretKeyRef;
const key = execFileSync("gcloud", ["secrets", "versions", "access", secretRef.key, `--secret=${secretRef.name}`, `--project=${project}`], { encoding: "utf8" }).trim();
const owner = env.DAN_TRAVEL_OWNER_SUBJECTS.value.split(",")[0].trim();
const delegate = env.DAN_PRIVATE_DELEGATE_SUBJECTS?.value.split(",")[0].trim();
const base = process.env.NOTEBOOK_TEST_BASE_URL || config.status.url;
const runId = `notebooks-acceptance-${randomUUID()}`;
const evidence = { runId, base, startedAt: new Date().toISOString(), checks: [], recordIds: {} };
const check = (name) => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function request(mode, operation, args = {}, { actor = owner, idempotencyKey = `${runId}-${randomUUID()}` } = {}) {
  const response = await fetch(`${base}/notebooks/${mode}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key,
    "x-bhe-actor-sub": actor, "x-bhe-actor-subjects": JSON.stringify([actor]), "x-bhe-task-role": "admin" },
    body: JSON.stringify({ operation, arguments: args, ...(mode === "command" ? { idempotencyKey } : {}) }), signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.error?.message || "Notebook request failed"), { code: data.error?.code, status: data.error?.status });
  return data.result;
}
const query = (op, args, options) => request("query", op, args, options);
const command = (op, args, options) => request("command", op, args, options);
(async () => {
  let root;
  try {
    root = await command("createNotebook", { name: `[System verification] Notebooks ${new Date().toISOString().slice(0, 10)}` });
    evidence.recordIds.notebookId = root.notebookId;
    const child = await command("createNotebook", { name: "Leadership", parentId: root.notebookId });
    const source = "Give volunteers responsibility gradually, coach them through mistakes, and help them become capable leaders.\n\nThis is system verification text, not a personal note from Dan.";
    const args = { notebookId: child.notebookId, title: "System verification: developing leaders", text: source, tags: ["system-verification"], links: ["https://example.com/notebook-verification"] };
    const n = await command("createNote", args, { idempotencyKey: `${runId}-capture` });
    evidence.recordIds.noteId = n.noteId;
    assert.equal(n.readBackVerified, true); assert.equal((await query("getNote", { noteId: n.noteId })).note.text, source);
    check("saved and independently retrieved exact source text");
    const replay = await command("createNote", args, { idempotencyKey: `${runId}-capture` });
    assert.equal(replay.noteId, n.noteId); assert.equal(replay.replayed, true);
    check("idempotent capture replay");
    const lex = await query("searchNotes", { query: "responsibility gradually", mode: "words", notebookId: root.notebookId });
    assert(lex.results.some((r) => r.noteId === n.noteId)); check("Firestore lexical search in nested branch");
    const listed = await query("listNotes", { notebookId: child.notebookId }); assert(listed.notes.some((r) => r.noteId === n.noteId));
    const browsed = await query("browseNotebooks", { parentId: root.notebookId }); assert(browsed.notebooks.some((r) => r.notebookId === child.notebookId));
    check("indexed browsing and note listing");
    let status;
    for (let i = 0; i < 24; i++) {
      status = await query("getIndexingStatus", { noteId: n.noteId });
      if (status.indexingStatus === "ready") break;
      if (i === 4 && status.indexingStatus === "failed") await command("retryIndexing", { noteId: n.noteId, expectedVersion: 1 });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    assert.equal(status.indexingStatus, "ready", `indexing status ${status.indexingStatus}; job ${status.job.status}`);
    check("Cloud Tasks delivered real Vertex embedding job");
    const semantic = await query("searchNotes", { query: "mentoring and delegating to future ministry leaders", mode: "meaning", notebookId: root.notebookId });
    assert.equal(semantic.coverage.semanticAvailable, true);
    assert(semantic.results.some((r) => r.noteId === n.noteId)); check("Firestore vector search with real Vertex query embedding");
    const edited = await command("updateNote", { noteId: n.noteId, expectedVersion: 1, changes: { text: source + "\nVerified edit." } });
    assert.equal(edited.version, 2);
    assert.equal((await query("getNoteHistory", { noteId: n.noteId, revisionId: n.revisionId })).revision.text, source);
    assert.equal((await query("getNoteHistory", { noteId: n.noteId })).revisions.length, 2); check("revision history preserves original wording");
    const restored = await command("restoreNoteRevision", { noteId: n.noteId, expectedVersion: 2, revisionId: n.revisionId });
    assert.equal(restored.note.text, source); check("restoration creates new revision");
    if (delegate) {
      const delegated = await command("updateNote", { noteId: n.noteId, expectedVersion: 3, changes: { assistantSummary: "System verification of authorized delegate editing." } }, { actor: delegate });
      assert.equal(delegated.note.ownerSubject, owner); assert.equal(delegated.note.actorSub, delegate); check("configured delegate edits preserve owner and attribute actor");
    }
    for (const [op, a] of [["getNote", { noteId: n.noteId }], ["getNoteHistory", { noteId: n.noteId }], ["getIndexingStatus", { noteId: n.noteId }], ["searchNotes", { query: "leadership" }]]) {
      await assert.rejects(query(op, a, { actor: "notebooks-unlisted-verification-identity" }), { code: "dan_private_access_denied" });
    }
    check("unlisted administrator denied across reads, history, jobs and search");
    const current = (await query("getNote", { noteId: n.noteId })).note;
    await assert.rejects(command("updateNote", { noteId: n.noteId, expectedVersion: 1, changes: { title: "stale" } }), { code: "notebooks_version_conflict" });
    assert(current.version >= 3); check("stale writes rejected");
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed"; evidence.failure = { code: error.code || "assertion", message: error.message };
    process.exitCode = 1;
  } finally {
    if (root) {
      try {
        const current = (await query("getNotebook", { notebookId: root.notebookId })).notebook;
        await command("updateNotebook", { notebookId: root.notebookId, expectedVersion: current.version, changes: { archived: true } });
        const after = await query("searchNotes", { query: "responsibility gradually", mode: "words", notebookId: root.notebookId });
        assert.equal(after.results.length, 0); check("verification branch archived and excluded from normal search");
      } catch (error) { evidence.cleanup = { status: "needs-review", code: error.code || "assertion" }; process.exitCode = 1; }
    }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(process.env.NOTEBOOK_EVIDENCE_PATH || "/tmp/notebooks-live-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks.length, failure: evidence.failure || null }));
  }
})();
