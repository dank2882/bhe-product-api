"use strict";

const sharp = require("sharp");
const { fail } = require("../../lib/maintenance-fields");
const { isSendingAllowed } = require("./sending-policy");
const MAX_MEDIA = 20 * 1024 * 1024;

async function boundedBody(response, maxBytes) {
  if (!response.ok) throw Object.assign(new Error("Provider request failed"), { code: "provider_http_error", statusCode: response.status });
  if (Number(response.headers.get("content-length")) > maxBytes) fail("Provider response exceeds size limit", 413);
  if (!response.body) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) { await response.body.cancel?.().catch(() => {}); fail("Provider response exceeds size limit", 413); } chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}

function createProviders({ config, bucket, twilioClient, fetchImpl = fetch }) {
  const mailboxPath = `/v1.0/users/${encodeURIComponent(config.mailbox)}/`;
  let cachedToken, expiresAt = 0;
  async function graphToken() {
    if (cachedToken && expiresAt > Date.now() + 60000) return cachedToken;
    if (!config.tenantId || !config.clientId || !config.clientSecret) fail("Microsoft connection is not configured", 503);
    const response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" })
    });
    const data = JSON.parse((await boundedBody(response, 100000)).toString());
    if (!data.access_token) fail("Microsoft token unavailable", 503);
    cachedToken = data.access_token; expiresAt = Date.now() + Number(data.expires_in) * 1000;
    return cachedToken;
  }
  function graphUrl(path) {
    const url = new URL(path, "https://graph.microsoft.com");
    if (url.origin !== "https://graph.microsoft.com" || !decodeURIComponent(url.pathname).startsWith(decodeURIComponent(mailboxPath)) || url.username || url.password || url.hash) fail("Graph URL outside Maintenance mailbox", 403);
    return url.toString();
  }
  async function graphRequest(path, options = {}, maxBytes = 8 * 1024 * 1024) {
    const response = await fetchImpl(graphUrl(path), { ...options, redirect: "error", signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${await graphToken()}`, Prefer: 'IdType="ImmutableId", outlook.body-content-type="text", odata.maxpagesize=50', "Content-Type": "application/json", ...(options.headers || {}) } });
    const buffer = await boundedBody(response, maxBytes);
    return buffer.length ? JSON.parse(buffer.toString()) : {};
  }
  async function mediaLoader(provider, descriptor) {
    let buffer;
    if (provider === "twilio") {
      const url = new URL(descriptor.url);
      const prefix = `/2010-04-01/Accounts/${config.twilioAccountSid}/Messages/`;
      if (url.origin !== "https://api.twilio.com" || !url.pathname.startsWith(prefix) || !/^(SM|MM)[0-9a-f]{32}\/Media\/ME[0-9a-f]{32}$/.test(url.pathname.slice(prefix.length)) || url.username || url.password || url.search || url.hash) fail("Invalid Twilio media URL", 403);
      // Never forward Basic credentials to redirect targets.
      const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(30000), headers: { Authorization: `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64")}` } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = new URL(response.headers.get("location"));
        if (target.protocol !== "https:" || !/^[a-z0-9.-]+\.twiliocdn\.com$/.test(target.hostname) || target.username || target.password || target.port) fail("Untrusted media redirect", 403);
        buffer = await boundedBody(await fetchImpl(target, { redirect: "error", signal: AbortSignal.timeout(30000) }), MAX_MEDIA);
      } else buffer = await boundedBody(response, MAX_MEDIA);
    } else if (provider === "graph") {
      const attachment = await graphRequest(`${mailboxPath}messages/${encodeURIComponent(descriptor.messageId)}/attachments/${encodeURIComponent(descriptor.attachmentId)}`, {}, MAX_MEDIA * 1.4);
      if (attachment["@odata.type"] !== "#microsoft.graph.fileAttachment" || !attachment.contentBytes) throw Object.assign(new Error("Unsupported attachment"), { code: "unsupported_media" });
      buffer = Buffer.from(attachment.contentBytes, "base64");
      if (buffer.length > MAX_MEDIA) fail("Photo too large", 413);
    } else fail("Unsupported provider");
    try {
      // Decode actual image bytes, limit pixels, strip metadata (including GPS), normalize phone photos.
      const image = sharp(buffer, { limitInputPixels: 40000000, animated: false });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp", "gif", "heif"].includes(metadata.format)) throw new Error("Not an allowed image");
      return { buffer: await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer() };
    } catch { throw Object.assign(new Error("Unsupported or invalid image"), { code: "unsupported_media" }); }
  }
  async function send(draft, photos) {
    if (!isSendingAllowed(config, draft.channel)) fail("Outbound channel is disabled", 503);
    if (draft.channel === "sms") {
      if (!config.twilioNumber || !config.twilioMessagingServiceSid || !twilioClient) fail("Twilio sending is not configured", 503);
      const mediaUrl = [];
      for (const photo of photos) mediaUrl.push((await bucket.file(photo.storagePath).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 900000 }))[0]);
      const sent = await twilioClient.messages.create({ to: draft.recipient, from: config.twilioNumber, messagingServiceSid: config.twilioMessagingServiceSid, body: draft.body, statusCallback: `${config.url}/twilio/status/${draft.draftId}`, ...(mediaUrl.length ? { mediaUrl } : {}) });
      return { providerId: sent.sid, status: sent.status };
    }
    const attachments = [];
    for (const photo of photos) {
      const [buffer] = await bucket.file(photo.storagePath).download();
      attachments.push({ "@odata.type": "#microsoft.graph.fileAttachment", name: photo.fileName, contentType: photo.contentType, contentBytes: buffer.toString("base64") });
    }
    await graphRequest(`${mailboxPath}sendMail`, { method: "POST", body: JSON.stringify({ message: { subject: draft.subject || "FBC Maintenance", body: { contentType: "Text", content: draft.body }, toRecipients: [{ emailAddress: { address: draft.recipient } }], attachments, internetMessageHeaders: [{ name: "x-fbc-maintenance-outbox", value: draft.draftId }] }, saveToSentItems: true }) });
    return { providerId: "", status: "accepted" };
  }
  return { graphRequest, graphUrl, mailboxPath, mediaLoader, send };
}

async function pollMailbox({ db, providers, domain, config }) {
  if (!config.mailSince || Number.isNaN(Date.parse(config.mailSince))) fail("An explicit mailbox ingestion start time is required", 503);
  const cursors = db.collection("maintenanceProviderCursors");
  const summaries = [];
  for (const folder of config.mailFolders) {
    const ref = cursors.doc(`graph-${Buffer.from(folder).toString("base64url")}`);
    // Single durable lease avoids cursor rollback under overlapping scheduler calls.
    const lease = require("node:crypto").randomUUID();
    const state = await db.runTransaction(async tx => {
      const doc = await tx.get(ref), prior = doc.data() || {};
      if (prior.leaseUntil > Date.now()) return null;
      tx.set(ref, { ...prior, lease, leaseUntil: Date.now() + 240000 }); return prior;
    });
    if (!state) continue;
    const initial = `${providers.mailboxPath}mailFolders/${encodeURIComponent(folder)}/messages/delta?$select=id,subject,from,body,receivedDateTime,conversationId,hasAttachments&$filter=receivedDateTime ge ${encodeURIComponent(config.mailSince)}`;
    let next = state.cursor || initial, count = 0;
    try {
      for (let page = 0; page < 10; page++) {
        const data = await providers.graphRequest(next);
        for (const message of data.value || []) {
          if (message["@removed"] || !message.from?.emailAddress?.address || Date.parse(message.receivedDateTime) < Date.parse(config.mailSince)) continue;
          const media = []; let attachmentOverflow = 0; let attachmentsUrl = message.hasAttachments ? `${providers.mailboxPath}messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,isInline` : "";
          while (attachmentsUrl) {
            const attachments = await providers.graphRequest(attachmentsUrl);
            for (const attachment of attachments.value || []) {
              if (media.length >= 10) { attachmentOverflow++; continue; }
              media.push({ messageId: message.id, attachmentId: attachment.id, name: attachment.name || "", contentType: attachment.contentType || "" });
            }
            attachmentsUrl = attachments["@odata.nextLink"] || "";
          }
          await domain.ingest({ provider: "graph", providerId: message.id, channel: "email", sender: message.from.emailAddress.address.toLowerCase(), recipient: config.mailbox, body: String(message.body?.content || "").slice(0, 100000), subject: String(message.subject || "").slice(0, 2000), receivedAt: message.receivedDateTime, threadId: message.conversationId || "", bodyTruncated: String(message.body?.content || "").length > 100000, attachmentOverflow, media });
          count++;
        }
        next = data["@odata.nextLink"] || data["@odata.deltaLink"];
        if (!next) fail("Microsoft delta response lacks continuation", 502);
        providers.graphUrl(next);
        await db.runTransaction(async tx => {
          const current = (await tx.get(ref)).data();
          if (current.lease !== lease || current.leaseUntil < Date.now()) fail("Mailbox polling lease expired", 409);
          tx.update(ref, { cursor: next, checkedAt: new Date().toISOString() });
        });
        if (!data["@odata.nextLink"]) break;
      }
      summaries.push({ folder, count });
    } finally {
      await db.runTransaction(async tx => { const current = (await tx.get(ref)).data(); if (current.lease === lease) tx.update(ref, { leaseUntil: 0 }); });
    }
  }
  return { folders: summaries };
}

module.exports = { boundedBody, createProviders, pollMailbox };
