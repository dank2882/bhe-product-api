#!/usr/bin/env node
// Local operator setup only. Does not deploy, change IAM, or touch image files.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { connection, newSession, sameSecret, exchangeAndVerify } from './lib/dropbox-connection.mjs';

const host = '127.0.0.1:53683';
const origin = `http://${host}`;
const session = newSession();
let busy = false, complete = false;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect BHE Repository</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:18px system-ui;max-width:680px;margin:64px auto;padding:24px;color:#17312c;background:#f6f8f5}a,button{color:#fff;background:#235b4b;padding:14px 20px;border:0;border-radius:8px;display:inline-block;text-decoration:none}input{display:block;width:90%;padding:14px;margin:18px 0}p{line-height:1.6}small{display:block;margin-top:28px}</style>
<h1>Connect BHE Repository to Dropbox</h1>
<p>Use your Dropbox account with access to the <strong>BHE</strong> team folder. The repository will use <strong>/BHE/Knowledge Repository/Images</strong>.</p>
<p>Dropbox will grant file read/write access and basic account identification. Its consent covers accessible Dropbox files; the repository will restrict its operations to the Images folder. No sharing-management permission is requested.</p>
<p><a href="${escape(session.authorizationUrl)}" target="_blank" rel="noopener noreferrer">1. Authorize in Dropbox</a></p>
<p>Dropbox will display a one-use code. Copy it into this local form, then select Connect. Do not paste it into chat.</p>
<form method="post" action="/connect"><input type="hidden" name="csrf" value="${escape(session.csrf)}">
<label>2. Dropbox authorization code<input type="password" name="code" required maxlength="2048" autocomplete="off"></label>
<button type="submit">Connect and verify</button></form>
<small>The credential goes directly to Google Secret Manager. This step does not move images or activate the new storage system.</small></html>`;

function gcloud(args, input) {
  try { return execFileSync('gcloud', [...args, `--project=${connection.projectId}`, '--quiet'],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }).trim(); }
  catch { throw new Error('Secret Manager operation failed. Check cloud access; no credential details are logged.'); }
}
function saveSecret(value) {
  // Exact-name inventory distinguishes a missing secret from permission failure.
  const names = gcloud(['secrets', 'list', '--format=value(name)']).split('\n').map(name => name.split('/').at(-1));
  const args = names.includes(connection.secretName)
    ? ['secrets', 'versions', 'add', connection.secretName, '--data-file=-', '--format=value(name)']
    : ['secrets', 'create', connection.secretName, '--data-file=-', '--replication-policy=automatic', '--format=value(name)'];
  const receipt = gcloud(args, value);
  // Creation returns the secret name; version-add returns a version name.
  const version = receipt.includes('/versions/') ? receipt.split('/').at(-1) : '1';
  const readback = gcloud(['secrets', 'versions', 'access', version, `--secret=${connection.secretName}`]);
  if (!sameSecret(value, readback)) throw new Error('Credential was written but read-back verification failed.');
  return version;
}
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // Preserve Origin on the same-origin POST. no-referrer makes browser
  // navigation POSTs send Origin: null, defeating the explicit origin check.
  // same-origin still sends no referrer to Dropbox or any external site.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  const reply = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(message); };
  if (req.headers.host !== host) return reply(403, 'Invalid host.');
  if (Date.now() > session.expiresAt) return reply(410, 'Setup session expired. Restart setup.');
  if (req.method === 'GET' && req.url === '/') return reply(200, complete ? 'Connection saved and verified. You may close this tab.' : html);
  if (req.method !== 'POST' || req.url !== '/connect') return reply(404, 'Not found.');
  if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded')
    return reply(403, 'Invalid form origin.');
  if (busy || complete) return reply(409, complete ? 'Connection already saved.' : 'Connection verification is in progress.');
  try {
    const parts = []; let size = 0;
    for await (const part of req) { size += part.length; if (size > 8192) return reply(413, 'Form too large.'); parts.push(part); }
    const form = new URLSearchParams(Buffer.concat(parts).toString('utf8'));
    if (!sameSecret(form.get('csrf'), session.csrf)) return reply(403, 'Invalid session.');
    busy = true;
    const verified = await exchangeAndVerify(form.get('code'), session);
    const version = saveSecret(verified.refreshToken);
    complete = true;
    console.log(JSON.stringify({ status: 'verified', secretName: connection.secretName, version, rootId: verified.rootId }));
    reply(200, '<h1>Dropbox connection verified</h1><p>The credential is saved in Google Secret Manager. Return to Codex to continue the migration. No images have moved yet.</p>');
    server.close();
  } catch (error) {
    // Never print network errors, OAuth payloads, codes, tokens, or child-process objects.
    reply(400, '<h1>Connection was not verified</h1><p>No migration was started. Return to Codex to check account, permissions, and Secret Manager access. Do not send the authorization code.</p>');
    const stage = ['token_exchange', 'account_check', 'folder_check', 'token_refresh'].includes(error.setupStage) ? error.setupStage : 'validation_or_secret_storage';
    console.log(`Dropbox setup failed at ${stage}; credential status must be checked before retry.`);
  } finally { busy = false; }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.on('error', () => { console.error('Local setup server could not start.'); process.exitCode = 1; });
server.listen(53683, '127.0.0.1', () => console.log(`Dropbox setup ready at ${origin}`));
setTimeout(() => server.close(), 20 * 60 * 1000).unref();
