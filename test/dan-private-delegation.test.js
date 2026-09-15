const test = require('node:test');
const assert = require('node:assert/strict');
const { delegatedOwnerSubjects } = require('../lib/dan-private-delegation');
test('explicit delegation is exact, one-way, revocable, and fails closed', () => {
  const env = { DAN_PRIVATE_OWNER_SUBJECTS: 'dan,old-dan', DAN_PRIVATE_DELEGATE_SUBJECTS: 'sarah' };
  assert.deepEqual(delegatedOwnerSubjects('sarah', env), ['dan', 'old-dan']);
  for (const subject of ['dan', 'other-admin', '', 'sarah@example.test']) assert.deepEqual(delegatedOwnerSubjects(subject, env), []);
  assert.deepEqual(delegatedOwnerSubjects('sarah', {}), []);
  assert.deepEqual(delegatedOwnerSubjects('sarah', { ...env, DAN_PRIVATE_DELEGATE_SUBJECTS: '' }), []);
});


const { getDanActorFields, requireDanPrivateAccess } = require('../lib/dan-private-access');
test('travel delegation retains the real actor and denies unrelated administrators', () => {
  const deps = { danOwnerSubjects: ['dan'], privateDelegationEnv: { DAN_PRIVATE_OWNER_SUBJECTS: 'dan', DAN_PRIVATE_DELEGATE_SUBJECTS: 'sarah' }, taskAccess: { subject: 'sarah', subjects: ['sarah'], role: 'admin', name: 'Sarah' } };
  assert.equal(getDanActorFields(deps).actorSub, 'sarah');
  assert.equal(requireDanPrivateAccess(deps).matchedSubject, 'dan');
  assert.deepEqual(deps.taskAccess.subjects, ['sarah']);
  assert.throws(() => requireDanPrivateAccess({ ...deps, taskAccess: { subject: 'other-admin', role: 'admin' } }), { code: 'dan_private_access_denied' });
});
