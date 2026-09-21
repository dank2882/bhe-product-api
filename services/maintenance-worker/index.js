"use strict";

const express = require("express");
const twilio = require("twilio");
const { Firestore } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const { GoogleAuth, OAuth2Client } = require("google-auth-library");
const { randomUUID } = require("node:crypto");
const { createDomain } = require("./domain");
const { createProviders, pollMailbox } = require("./providers");
const { fail } = require("../../lib/maintenance-fields");
const { isSendingAllowed } = require("./sending-policy");

function configFromEnv(env = process.env) {
  return {
    project: env.GOOGLE_CLOUD_PROJECT || "location-map-985", region: env.GOOGLE_CLOUD_REGION || "us-west1",
    taskDatabase: "chatgptstorage", communicationsDatabase: "correspondence",
    bucket: env.MAINTENANCE_BUCKET || "bhe-product-assets", mailbox: "maintenance@foundedonfaith.com",
    url: env.MAINTENANCE_WORKER_URL || "", apiServiceAccount: env.MAINTENANCE_API_SERVICE_ACCOUNT || "",
    queueServiceAccount: env.MAINTENANCE_QUEUE_SERVICE_ACCOUNT || "", schedulerServiceAccount: env.MAINTENANCE_SCHEDULER_SERVICE_ACCOUNT || "",
    queue: env.MAINTENANCE_QUEUE || "fbc-maintenance-messaging", sendingEnabled: env.MAINTENANCE_SENDING_ENABLED === "true",
    emailSendingEnabled: env.MAINTENANCE_EMAIL_SENDING_ENABLED === "true", smsSendingEnabled: env.MAINTENANCE_SMS_SENDING_ENABLED === "true",
    twilioEnabled: env.MAINTENANCE_TWILIO_ENABLED === "true", twilioAccountSid: env.TWILIO_ACCOUNT_SID || "",
    twilioAuthToken: env.TWILIO_AUTH_TOKEN || "", twilioNumber: env.TWILIO_MAINTENANCE_NUMBER || "",
    twilioMessagingServiceSid: env.TWILIO_MAINTENANCE_MESSAGING_SERVICE_SID || "",
    tenantId: env.MICROSOFT_TENANT_ID || "", clientId: env.MICROSOFT_CLIENT_ID || "", clientSecret: env.MICROSOFT_CLIENT_SECRET || "",
    mailSince: env.MAINTENANCE_MAIL_SINCE || "", mailFolders: (env.MAINTENANCE_MAIL_FOLDERS || "inbox").split(",").map(s => s.trim()).filter(Boolean)
  };
}
function createApp({ config, domain, poll, verifyToken }) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (req, res) => res.json({ ok: true, component: "fbc-maintenance-messaging-worker", sendingEnabled: config.sendingEnabled, emailSendingEnabled: isSendingAllowed(config, "email"), smsSendingEnabled: isSendingAllowed(config, "sms") }));
  app.post("/twilio/inbound", express.urlencoded({ extended: false, limit: "256kb" }), async (req, res, next) => {
    try {
      if (!config.twilioEnabled || !config.twilioAuthToken || !config.url || !config.twilioNumber) return res.sendStatus(503);
      if (!twilio.validateRequest(config.twilioAuthToken, req.get("X-Twilio-Signature") || "", `${config.url}/twilio/inbound`, req.body)) return res.sendStatus(403);
      const b = req.body;
      if (b.AccountSid !== config.twilioAccountSid || b.To !== config.twilioNumber || !/^(SM|MM)[0-9a-f]{32}$/.test(b.MessageSid || "")) return res.sendStatus(403);
      const count = Number(b.NumMedia || 0);
      if (!Number.isInteger(count) || count < 0 || count > 10) fail("Invalid photo count");
      const keyword = String(b.OptOutType || "").toUpperCase();
      if (["STOP", "START"].includes(keyword)) await domain.optOut("sms", b.From, keyword);
      const text = String(b.Body || "");
      if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(text.trim())) await domain.optOut("sms", b.From, "STOP");
      const media = Array.from({ length: count }, (_, i) => ({ url: b[`MediaUrl${i}`] || "", contentType: b[`MediaContentType${i}`] || "" }));
      await domain.ingest({ provider: "twilio", providerId: b.MessageSid, channel: "sms", sender: b.From, recipient: b.To, body: text, subject: "", receivedAt: new Date().toISOString(), threadId: "", media });
      res.type("text/xml").send("<Response></Response>");
    } catch (error) { next(error); }
  });
  app.post("/twilio/status/:draftId", express.urlencoded({ extended: false, limit: "64kb" }), async (req, res, next) => {
    try {
      if (!config.twilioEnabled || !config.twilioAuthToken || !config.url) return res.sendStatus(503);
      if (!/^[0-9a-f]{64}$/.test(req.params.draftId) || !twilio.validateRequest(config.twilioAuthToken, req.get("X-Twilio-Signature") || "", `${config.url}/twilio/status/${req.params.draftId}`, req.body)) return res.sendStatus(403);
      if (req.body.AccountSid !== config.twilioAccountSid || !/^(SM|MM)[0-9a-f]{32}$/.test(req.body.MessageSid || "")) return res.sendStatus(403);
      await domain.delivery(req.params.draftId, req.body.MessageSid, req.body.MessageStatus);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });
  app.use("/internal", express.json({ limit: "256kb" }));
  const authorize = serviceAccount => async (req, res, next) => {
    try {
      if (!serviceAccount || !config.url) return res.sendStatus(503);
      const token = /^Bearer (.+)$/.exec(req.get("Authorization") || "")?.[1];
      if (!token) return res.sendStatus(401);
      const claims = await verifyToken(token, config.url);
      if (claims.email !== serviceAccount || claims.email_verified !== true) return res.sendStatus(403);
      next();
    } catch { res.sendStatus(401); }
  };
  app.post("/internal/operation", authorize(config.apiServiceAccount), async (req, res, next) => {
    try {
      if (req.body.action === "approveMessage" && !config.sendingEnabled) fail("Sending is disabled until connection testing and launch approval", 503);
      res.json(await domain.invoke(req.body));
    } catch (error) { next(error); }
  });
  app.post("/internal/work", authorize(config.queueServiceAccount), async (req, res, next) => {
    try {
      if (req.body.kind === "media") await domain.processMedia(req.body.id);
      else if (req.body.kind === "send") { if (!config.sendingEnabled) fail("Sending disabled", 503); await domain.dispatch(req.body.id); }
      else fail("Invalid queued operation");
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.post("/internal/poll", authorize(config.schedulerServiceAccount), async (req, res, next) => {
    try { await domain.recover(); res.json(await poll()); } catch (error) { next(error); }
  });
  app.use((error, req, res, next) => {
    const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    // Never log tokens, provider response bodies, phone numbers or message contents.
    console.error(JSON.stringify({ event: "maintenance_worker_error", path: req.path, status, code: error.code || "internal_error" }));
    res.status(status).json({ ok: false, code: error.code || "internal_error", message: status < 500 ? error.message : "Maintenance provider operation unavailable" });
  });
  return app;
}
function runtime(config) {
  const communicationsDb = new Firestore({ projectId: config.project, databaseId: config.communicationsDatabase });
  const taskDb = new Firestore({ projectId: config.project, databaseId: config.taskDatabase });
  const bucket = new Storage({ projectId: config.project }).bucket(config.bucket);
  const google = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }), verifier = new OAuth2Client();
  const twilioClient = config.twilioAccountSid && config.twilioAuthToken ? twilio(config.twilioAccountSid, config.twilioAuthToken, { autoRetry: false, timeout: 30000 }) : null;
  const providers = createProviders({ config, bucket, twilioClient });
  async function enqueue(kind, recordId, recovery = false) {
    if (!config.url || !config.queueServiceAccount) fail("Queue is not configured", 503);
    const parent = `projects/${config.project}/locations/${config.region}/queues/${config.queue}`;
    const taskId = `${kind}-${recordId}${recovery ? `-${randomUUID()}` : ""}`;
    const client = await google.getClient();
    try {
      await client.request({ url: `https://cloudtasks.googleapis.com/v2/${parent}/tasks`, method: "POST", data: { task: { name: `${parent}/tasks/${taskId}`, httpRequest: { httpMethod: "POST", url: `${config.url}/internal/work`, headers: { "Content-Type": "application/json" }, body: Buffer.from(JSON.stringify({ kind, id: recordId })).toString("base64"), oidcToken: { serviceAccountEmail: config.queueServiceAccount, audience: config.url } } } } });
    } catch (error) { if (error.response?.status !== 409) throw error; }
  }
  const domain = createDomain({ communicationsDb, taskDb, bucket, enqueue, send: providers.send, mediaLoader: providers.mediaLoader, isSendingAllowed: channel => isSendingAllowed(config, channel) });
  return createApp({ config, domain, poll: () => pollMailbox({ db: communicationsDb, providers, domain, config }), verifyToken: async (token, audience) => (await verifier.verifyIdToken({ idToken: token, audience })).getPayload() });
}
if (require.main === module) runtime(configFromEnv()).listen(Number(process.env.PORT || 8080));
module.exports = { createApp, configFromEnv, runtime };
