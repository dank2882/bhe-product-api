"use strict";
// Read-only acceptance for the October 3 daily-brief incident. No record writes.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { Firestore } = require("@google-cloud/firestore");
const config = JSON.parse(execFileSync("gcloud", ["run", "services", "describe", "bhe-product-api", "--project=location-map-985", "--region=us-west1", "--format=json"]));
const env = Object.fromEntries(config.spec.template.spec.containers[0].env.map(e => [e.name, e]));
const secret = env.BHE_API_KEY.valueFrom.secretKeyRef;
const key = execFileSync("gcloud", ["secrets", "versions", "access", secret.key, `--secret=${secret.name}`, "--project=location-map-985"], { encoding: "utf8" }).trim();
const subjects = env.DAN_TRAVEL_OWNER_SUBJECTS.value.split(",").map(s => s.trim()).filter(Boolean);
const base = process.env.BRIEF_VERIFY_BASE_URL || config.status.url;
const headers = { "content-type": "application/json", "x-api-key": key, "x-bhe-actor-sub": subjects[0], "x-bhe-actor-subjects": JSON.stringify(subjects), "x-bhe-task-role": "admin", "x-bhe-actor-name": "Dan Kirchner" };
const sermonId = "sermon-what-god-knows-9c4f556e";
const db = new Firestore({ projectId: "location-map-985", databaseId: "chatgptstorage" });
const digest = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function preservedHash() {
  const sermon = (await db.collection("sermons").doc(sermonId).get()).data();
  const turns = (await db.collection("sermonDevelopmentTurns").where("sermonId", "==", sermonId).get()).docs.map(d => ({ id: d.id, data: d.data() })).sort((a,b) => a.id.localeCompare(b.id));
  return digest({ sermon, turns });
}
async function query(domain, operation, args) {
  const response = await fetch(`${base}/${domain}/query`, { method: "POST", headers, body: JSON.stringify({ operation, arguments: args }), signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  assert(data.ok, JSON.stringify(data.error));
  return data.result;
}
(async () => {
  const before = await preservedHash();
  const review = await query("task-management", "buildDailyReview", { today: "2026-10-03" });
  const personal = await query("task-management", "listTasks", { status: "next", limit: 100 });
  const fallback = await query("task-management", "listTasks", review.guidance.fallbackTaskQuery.arguments);
  const authorized = await query("task-management", "listTasks", { view: "authorized", status: "next", limit: 100 });
  const ids = tasks => tasks.map(t => t.taskId).sort();
  assert.equal(personal.hasMore, false);
  assert.equal(fallback.hasMore, false);
  assert.equal(personal.ownershipScope, "personal");
  assert.deepEqual(ids(personal.tasks), ids(review.activeNext));
  assert.deepEqual(ids(fallback.tasks), ids(review.activeNext));
  assert(authorized.count >= personal.count);
  assert.equal(authorized.ownershipScope, "authorized");
  assert(review.guidance.sharedMailboxes.includes("orders@biblicalheritageexhibit.com"));
  const evaluation = await query("sermon-workspace", "evaluateSermonReadiness", { sermonId });
  assert.equal(evaluation.preservedDevelopment.complete, true);
  assert.equal(evaluation.preservedDevelopment.turnCount, 34);
  assert.equal(evaluation.preservedDevelopment.danTurnCount, 17);
  assert.equal(evaluation.readiness.scoreMeaning, "saved_preparation_fields");
  assert.equal(evaluation.recommendedNextStep.code, "assemble_preserved_development");
  const dashboard = await query("sermon-workspace", "buildPreachingPreparationDashboard", { limit: 12, asOfDate: "2026-10-03" });
  assert.equal(dashboard.dataProvenance.sourceOfTruth, "firestore");
  assert(JSON.stringify(dashboard).includes('"assemble_preserved_development"'));
  assert.equal(await preservedHash(), before, "Sermon or preserved wording changed");
  console.log(JSON.stringify({ status: "verified", base, personalActive: personal.count, authorizedActive: authorized.count, overdue: review.summary.overdueCount, guidanceVersion: review.guidance.version, preservedDevelopment: evaluation.preservedDevelopment, recommendedNextStep: evaluation.recommendedNextStep.code, preservedContentHash: before, checks: ["default and fallback equal personal review", "staff inventory remains explicit", "full mailbox address retained", "dashboard recognizes preserved discussion", "sermon and exact turns unchanged"] }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
