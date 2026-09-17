"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const twilio = require("../services/maintenance-worker/node_modules/twilio");
const sharp = require("../services/maintenance-worker/node_modules/sharp");
const { createApp } = require("../services/maintenance-worker");
const { createProviders, pollMailbox, boundedBody } = require("../services/maintenance-worker/providers");
const { fakeFirestore } = require("./helpers/maintenance-firestore");

const config = { url: "https://maintenance.example.run.app", twilioEnabled: true, twilioAccountSid: `AC${"1".repeat(32)}`, twilioAuthToken: "test-only-token", twilioNumber: "+12065550101", apiServiceAccount: "api@example.iam.gserviceaccount.com", queueServiceAccount: "queue@example.iam.gserviceaccount.com", schedulerServiceAccount: "scheduler@example.iam.gserviceaccount.com", sendingEnabled: false, mailbox: "maintenance@foundedonfaith.com" };
async function server(t, domain = {}, verifyToken = async token => ({ email: token, email_verified: true })) {
  const app = createApp({ config, domain, poll: async () => ({}), verifyToken });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise(resolve => listener.once("listening", resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  return `http://127.0.0.1:${listener.address().port}`;
}
test("Twilio webhook rejects forged signatures and wrong destination; accepts signed MMS without replying", async t => {
  const received = [], url = await server(t, { ingest: async body => received.push(body), optOut: async () => {} });
  const payload = { AccountSid: config.twilioAccountSid, MessageSid: `MM${"2".repeat(32)}`, To: config.twilioNumber, From: "+12065550100", Body: "Photo", NumMedia: "1", MediaUrl0: "https://api.twilio.com/media", MediaContentType0: "image/jpeg" };
  const post = (body, signature) => fetch(`${url}/twilio/inbound`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature }, body: new URLSearchParams(body) });
  assert.equal((await post(payload, "fake")).status, 403);
  const signature = twilio.getExpectedTwilioSignature(config.twilioAuthToken, `${config.url}/twilio/inbound`, payload);
  const accepted = await post(payload, signature); assert.equal(accepted.status, 200); assert.equal(await accepted.text(), "<Response></Response>"); assert.equal(received.length, 1);
  const other = { ...payload, To: "+12065550999" };
  assert.equal((await post(other, twilio.getExpectedTwilioSignature(config.twilioAuthToken, `${config.url}/twilio/inbound`, other))).status, 403);
});
test("internal endpoints require the correct verified service identity; outbound launch switch is fail-closed", async t => {
  let commands = 0; const url = await server(t, { invoke: async () => { commands++; return {}; } });
  const post = (token, action = "guide") => fetch(`${url}/internal/operation`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, actor: { subject: "shawna" } }) });
  assert.equal((await post(config.schedulerServiceAccount)).status, 403);
  assert.equal((await post(config.apiServiceAccount)).status, 200);
  assert.equal((await post(config.apiServiceAccount, "approveMessage")).status, 503);
  assert.equal(commands, 1);
});
test("media rejects arbitrary hosts and redirects before leaking credentials; real photos are decoded and normalized", async () => {
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
  const calls = [];
  const providers = createProviders({ config, fetchImpl: async (url, opts) => { calls.push({ url: String(url), opts }); return new Response(png); } });
  await assert.rejects(providers.mediaLoader("twilio", { url: "http://169.254.169.254/metadata" }), /Invalid/);
  assert.equal(calls.length, 0);
  const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages/MM${"2".repeat(32)}/Media/ME${"3".repeat(32)}`;
  const result = await providers.mediaLoader("twilio", { url: mediaUrl });
  assert.equal((await sharp(result.buffer).metadata()).format, "jpeg");
  const redirects = createProviders({ config, fetchImpl: async () => new Response("", { status: 302, headers: { location: "https://attacker.example/photo" } }) });
  await assert.rejects(redirects.mediaLoader("twilio", { url: mediaUrl }), /Untrusted/);
  await assert.rejects(boundedBody(new Response(Buffer.alloc(20)), 10), /size limit/);
  await assert.rejects(providers.graphRequest("https://graph.microsoft.com/v1.0/users/other@example.com/messages"), /outside/);
});
test("Graph delta cursor advances only after durable ingestion and includes an explicit history cutoff", async () => {
  const db = fakeFirestore(), calls = [], nextLink = "https://graph.microsoft.com/v1.0/users/maintenance%40foundedonfaith.com/mailFolders/inbox/messages/delta?$deltatoken=test";
  const providers = { mailboxPath: "/v1.0/users/maintenance%40foundedonfaith.com/", graphUrl: url => url, graphRequest: async url => { calls.push(url); return { value: [{ id: "m1", receivedDateTime: "2026-09-17T00:00:00Z", from: { emailAddress: { address: "worker@example.com" } }, body: { content: "Done" } }], "@odata.deltaLink": nextLink }; } };
  let fail = true, captured = 0;
  const args = { db, providers, config: { ...config, mailSince: "2026-09-16T00:00:00Z", mailFolders: ["inbox"] }, domain: { ingest: async () => { if (fail) throw new Error("storage unavailable"); captured++; } } };
  await assert.rejects(pollMailbox(args), /storage/);
  const ref = db.collection("maintenanceProviderCursors").doc("graph-aW5ib3g");
  assert.equal((await ref.get()).data().cursor, undefined);
  fail = false; await pollMailbox(args);
  assert.equal((await ref.get()).data().cursor, nextLink); assert.equal(captured, 1); assert.match(calls[0], /receivedDateTime ge/);
});
