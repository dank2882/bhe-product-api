import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const connection = Object.freeze({
  clientId: '1uc5jjc72th381b',
  namespaceId: '10251589472',
  rootPath: '/Knowledge Repository/Images',
  rootId: 'id:GYjHJT2OzPAAAAAAABT5jg',
  projectId: 'location-map-985',
  secretName: 'bhe-repository-dropbox-refresh-token',
});
export const scopes = ['account_info.read', 'files.metadata.read', 'files.content.read', 'files.content.write'];
export function newSession() {
  const verifier = randomBytes(48).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: connection.clientId, response_type: 'code', token_access_type: 'offline',
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    scope: scopes.join(' '), state: csrf,
  }).toString();
  // No redirect URI: Dropbox displays a one-use code for the person to enter
  // into the loopback form. Existing app redirect configuration is untouched.
  return { verifier, csrf, authorizationUrl: url.href, expiresAt: Date.now() + 20 * 60 * 1000 };
}
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
async function jsonRequest(url, init, fetchImpl, stage) {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Dropbox connection check failed. No credential was saved.');
    return await response.json();
  } catch {
    // Stage names are fixed by code; never expose provider bodies or errors.
    throw Object.assign(new Error('Dropbox connection check failed. No credential was saved.'), { setupStage: stage });
  }
}
export async function exchangeAndVerify(code, session, fetchImpl = fetch) {
  if (Date.now() > session.expiresAt || typeof code !== 'string' || !code.trim() || code.length > 2048)
    throw new Error('Connection session or authorization code is invalid.');
  const token = await jsonRequest('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code.trim(),
      code_verifier: session.verifier, client_id: connection.clientId }),
  }, fetchImpl, 'token_exchange');
  if (!token.refresh_token || !token.access_token || !token.account_id)
    throw new Error('Dropbox did not return the required offline authorization.');
  const granted = new Set((token.scope || '').split(' ').filter(Boolean));
  if (scopes.some(scope => !granted.has(scope)) || [...granted].some(scope => !scopes.includes(scope)))
    throw new Error('Dropbox returned unexpected permissions. No credential was saved.');
  const headers = { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' };
  const account = await jsonRequest('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST', headers, body: 'null',
  }, fetchImpl, 'account_check');
  if (account.account_id !== token.account_id || account.disabled || account.email_verified !== true)
    throw new Error('Use an active, verified Dropbox account. No credential was saved.');
  const root = await jsonRequest('https://api.dropboxapi.com/2/files/get_metadata', {
    method: 'POST', headers: { ...headers, 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: connection.namespaceId }) },
    body: JSON.stringify({ path: connection.rootPath }),
  }, fetchImpl, 'folder_check');
  if (root['.tag'] !== 'folder' || root.id !== connection.rootId || root.path_lower !== connection.rootPath.toLowerCase())
    throw new Error('Dropbox destination does not match the approved Images folder. No credential was saved.');
  // Test refresh independently before persisting a long-lived credential.
  const refreshed = await jsonRequest('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: connection.clientId }),
  }, fetchImpl, 'token_refresh');
  if (!refreshed.access_token) throw new Error('Dropbox token refresh did not succeed.');
  return { refreshToken: token.refresh_token, accountId: token.account_id, rootId: root.id };
}
