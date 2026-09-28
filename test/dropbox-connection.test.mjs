import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connection, scopes, newSession, sameSecret, exchangeAndVerify } from '../scripts/lib/dropbox-connection.mjs';

function mock(overrides = {}) {
  const calls = [];
  const responses = [
    { access_token: 'test-access', refresh_token: 'test-refresh', account_id: 'test-account', scope: scopes.join(' '), ...overrides.token },
    { account_id: 'test-account', email_verified: true, disabled: false, ...overrides.account },
    { '.tag': 'folder', id: connection.rootId, path_lower: connection.rootPath.toLowerCase(), ...overrides.root },
    { access_token: 'test-refreshed', ...overrides.refreshed },
  ];
  return { calls, fetch: async (url, init) => { calls.push({ url, init }); return Response.json(responses.shift()); } };
}
test('authorization uses fresh PKCE, offline access, and only required scopes', () => {
  const s = newSession(), url = new URL(s.authorizationUrl);
  assert.equal(url.origin, 'https://www.dropbox.com');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(s.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('token_access_type'), 'offline');
  assert.deepEqual(url.searchParams.get('scope').split(' '), scopes);
  assert(!url.searchParams.has('redirect_uri'));
  assert(!url.href.includes(s.verifier));
  assert.notEqual(newSession().csrf, s.csrf);
  assert(sameSecret(s.csrf, s.csrf)); assert(!sameSecret(s.csrf, '')); assert(!sameSecret(null, s.csrf));
});
test('verifies account, exact namespace/root, and refresh before returning credential', async () => {
  const m = mock(), session = newSession();
  const result = await exchangeAndVerify('one-use-code', session, m.fetch);
  assert.equal(result.rootId, connection.rootId); assert.equal(m.calls.length, 4);
  assert.equal(m.calls[0].init.body.get('code_verifier'), session.verifier);
  assert(!m.calls[0].init.body.has('client_secret'));
  assert.deepEqual(JSON.parse(m.calls[2].init.headers['Dropbox-API-Path-Root']), { '.tag': 'namespace_id', namespace_id: connection.namespaceId });
  assert.equal(m.calls[3].init.body.get('grant_type'), 'refresh_token');
  for (const call of m.calls) assert.equal(call.init.redirect, 'error');
});
test('rejects missing or excessive scopes and incomplete offline tokens', async () => {
  for (const token of [{scope:'files.content.read'}, {scope:scopes.join(' ')+' sharing.write'}, {refresh_token:''}]) {
    const m = mock({token}); await assert.rejects(exchangeAndVerify('code', newSession(), m.fetch));
    assert.equal(m.calls.length, 1);
  }
});
test('rejects wrong account, unverified email, wrong folder, and failed refresh', async () => {
  for (const overrides of [
    {account:{account_id:'someone-else'}}, {account:{email_verified:false}}, {account:{disabled:true}},
    {root:{id:'another-folder'}}, {root:{'.tag':'file'}}, {root:{path_lower:'/outside'}},
    {refreshed:{access_token:''}},
  ]) await assert.rejects(exchangeAndVerify('code', newSession(), mock(overrides).fetch));
});
test('expired sessions never contact Dropbox; upstream payloads are not exposed', async () => {
  const m = mock(); await assert.rejects(exchangeAndVerify('code', {...newSession(),expiresAt:0},m.fetch));
  assert.equal(m.calls.length, 0);
  await assert.rejects(exchangeAndVerify('code',newSession(),async()=>Response.json({error:'private payload'},{status:400})),
    e => !e.message.includes('private payload'));
});
