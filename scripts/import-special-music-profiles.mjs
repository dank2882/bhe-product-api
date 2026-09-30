#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateProfile } = require("../lib/special-music-profile-service");
const { stableStringify } = require("../lib/workspace-operation-execution");

const args = process.argv.slice(2);
const file = args.find(value => !value.startsWith("--"));
const commit = args.includes("--commit");
if (!file) throw new Error("Usage: node scripts/import-special-music-profiles.mjs FILE [--commit]");
const source = JSON.parse(fs.readFileSync(file, "utf8"));
if (!Array.isArray(source) || !source.length) throw new Error("Expected a nonempty array of profiles");
const profiles = source.map(profile => {
  if (!/^[a-z0-9][a-z0-9_-]{0,199}$/.test(profile.specialMusicProfileId)) throw new Error("Invalid profile ID");
  return validateProfile({ ...profile, expectedVersion: 0 });
});
if (new Set(profiles.map(p => p.specialMusicProfileId)).size !== profiles.length) throw new Error("Duplicate profile IDs");
const hash = value => createHash("sha256").update(stableStringify(value)).digest("hex");
const sourceHash = hash(profiles);
const baseUrl = process.env.MINISTRY_BASE_URL || "https://bhe-product-api-mwhc25pkra-uw.a.run.app";
if (!process.env.BHE_API_KEY || !process.env.MINISTRY_ACTOR_SUBJECT) throw new Error("BHE_API_KEY and MINISTRY_ACTOR_SUBJECT are required");
let policyVersion;
async function call(mode, operation, arguments_, idempotencyKey) {
  if (operation !== "getMinistryPlanningConfig") arguments_ = { ...arguments_, policyVersion };
  const response = await fetch(`${baseUrl}/ministry-planning/${mode}`, {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.BHE_API_KEY, "x-bhe-actor-sub": process.env.MINISTRY_ACTOR_SUBJECT },
    body: JSON.stringify({ operation, arguments: arguments_, ...(idempotencyKey ? { idempotencyKey } : {}) })
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`${operation} failed: ${body.error?.code || response.status}`);
  return body.result;
}
async function readAll() {
  const records = [];
  let afterId;
  do {
    const page = await call("query", "listSpecialMusicProfiles", { status: "all", limit: 200, ...(afterId ? { afterId } : {}) });
    records.push(...page.profiles);
    afterId = page.nextCursor;
  } while (afterId);
  return records;
}
function matches(expected, actual) {
  return actual && Object.keys(expected).every(key => stableStringify(expected[key]) === stableStringify(actual[key]));
}
const guidance = await call("query", "getMinistryPlanningConfig", { sections: ["operatorGuidance"] });
if (!guidance.documents?.operatorGuidance?.content) throw new Error("Current ministry policy unavailable");
if (process.env.MINISTRY_REVIEWED_POLICY_VERSION !== guidance.configVersion) {
  console.log(guidance.documents.operatorGuidance.content);
  throw new Error(`Review the policy above, then set MINISTRY_REVIEWED_POLICY_VERSION=${guidance.configVersion} to acknowledge it before importing.`);
}
policyVersion = guidance.configVersion;
const existing = new Map((await readAll()).map(profile => [profile.specialMusicProfileId, profile]));
for (const profile of profiles) {
  const current = existing.get(profile.specialMusicProfileId);
  if (current && !matches(profile, current)) throw new Error(`Existing profile differs: ${profile.specialMusicProfileId}; review before updating`);
}
const pending = profiles.filter(profile => !existing.has(profile.specialMusicProfileId));
if (!commit) {
  console.log(JSON.stringify({ dryRun: true, sourceHash, count: profiles.length, create: pending.length, alreadyMatch: profiles.length - pending.length }));
} else {
  for (const profile of pending) {
    const { tierAvailability, ...input } = profile;
    await call("command", "saveSpecialMusicProfile", { ...input, expectedVersion: 0 }, `special-music-import-${hash(profile)}`);
  }
  const readBack = await readAll();
  const actualById = new Map(readBack.map(profile => [profile.specialMusicProfileId, profile]));
  for (const profile of profiles) if (!matches(profile, actualById.get(profile.specialMusicProfileId))) throw new Error(`Read-back mismatch: ${profile.specialMusicProfileId}`);
  const receipt = { verifiedAt: new Date().toISOString(), sourceHash, count: profiles.length, created: pending.length,
    collectionCount: readBack.length, verified: true, profiles: profiles.map(p => actualById.get(p.specialMusicProfileId)) };
  fs.writeFileSync(`${file}.receipt.json`, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ verified: true, count: receipt.count, created: receipt.created, collectionCount: receipt.collectionCount, sourceHash }));
}
