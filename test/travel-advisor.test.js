"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {runTravelAdvisorOperation: run, listTravelAdvisorOperations: catalog} = require('../lib/travel-advisor-service');
const {getStaffAuthorizationProfileId: profileId, buildAuthorizationFromRoleNames} = require('../lib/staff-authorization-service');
const {runIdempotentDanTravelOperation} = require('../lib/dan-travel-operation-execution');

class DB {
  constructor() { this.records = new Map(); this.queue = Promise.resolve(); }
  collection(path) { return new Collection(this, path); }
  runTransaction(fn) {
    const result = this.queue.then(async () => {
      const writes = [];
      const result = await fn({get: ref => ref.get(), set: (ref, data) => writes.push(() => ref.set(data)), create: (ref, data) => writes.push(() => ref.create(data))});
      for (const write of writes) await write();
      return result;
    });
    this.queue = result.catch(() => {}); return result;
  }
}
class Collection {
  constructor(db, path) { this.firestore = db; this.path = path; }
  doc(id) {
    const db = this.firestore, path = `${this.path}/${id}`;
    return {
      id, path, collection: name => db.collection(`${path}/${name}`),
      get: async () => ({id, exists: db.records.has(path), data: () => structuredClone(db.records.get(path))}),
      create: async data => {if (db.records.has(path)) throw Object.assign(new Error('already exists'), {code: 6}); db.records.set(path, structuredClone(data));},
      set: async (data, opts) => { if (db.failReceipt && path.includes("/executions/") && data.status === "succeeded") throw new Error("receipt outage"); return db.records.set(path, structuredClone(opts?.merge ? {...db.records.get(path), ...data} : data)); }
    };
  }
  limit() { return this; }
  async get() { return {docs: [...this.firestore.records.entries()].filter(([key]) => key.startsWith(`${this.path}/`) && !key.slice(this.path.length + 1).includes('/')).map(([key, data]) => ({id: key.split('/').at(-1), data: () => structuredClone(data)}))}; }
}
async function setup() {
  const db = new DB();
  const base = {firestoreDb: db, staffAuthorizationProfilesCollection: db.collection('staffAuthorizationProfiles'), tasksCollection: db.collection('tasks'), projectsCollection: db.collection('projects'), now: () => new Date('2026-09-30T12:00:00Z')};
  for (const subject of ['mark', 'other']) await base.staffAuthorizationProfilesCollection.doc(profileId(subject)).create({subject, identitySubjects: [subject], status: 'active', taskRole: 'manager', displayName: subject, permissions: ['travel.read', 'travel.write', 'tasks.read', 'tasks.write']});
  const deps = subject => ({...base, taskAccess: {subject, subjects: ['mark'], role: 'admin', email: 'marks@foundedonfaith.com'}});
  const command = (op, args, key = `test-${op}-${Math.random()}`, subject = 'mark') => run({mode: 'command', operation: op, arguments: args, idempotencyKey: key}, deps(subject));
  const query = (op, args = {}, subject = 'mark') => run({mode: 'query', operation: op, arguments: args}, deps(subject));
  const trip = await command('createTrip', {tripId: 'trip-one', name: 'Philippines', destinations: [{name: 'Baguio', country: 'Philippines'}]});
  return {db, base, deps, command, query, trip};
}

test('owner partitions protect lists, exact IDs, cross-links, cached replays, and Dan legacy paths', async () => {
  const {command, query, deps, db} = await setup();
  const person = await command('createPerson', {personId: 'person-one', displayName: 'Pastor James'}, 'same-key');
  assert.equal(person.result.person.displayName, 'Pastor James');
  assert.equal((await query('listTrips', {}, 'other')).result.count, 0);
  await assert.rejects(query('getTrip', {tripId: 'trip-one'}, 'other'), /not found/);
  await assert.rejects(command('recordInteraction', {summary: 'secret', personIds: ['person-one']}, 'cross-link', 'other'), /not found/);
  await assert.rejects(command('recordInteraction', {summary: 'bad trip', personIds: ['person-one'], tripId: 'missing'}, 'cross-trip'), /not found/);
  await assert.rejects(command('createOrganization', {name: 'Child', parentOrganizationId: 'other-owner-church'}), /not found/);
  const otherPerson = await command('createPerson', {personId: 'person-one', displayName: 'Different'}, 'same-key', 'other');
  assert.equal(otherPerson.idempotency.replayed, false);
  assert.equal((await query('getPerson', {personId: 'person-one'})).result.person.displayName, 'Pastor James');
  await assert.rejects(runIdempotentDanTravelOperation({mode: 'query', operation: 'listTrips', arguments: {}}, {...deps('mark'), taskAccess: {subject: 'mark'}, danOwnerSubjects: ['dan']}), /not available/);
  await assert.rejects(query('getTrip', {tripId: 'trip-one'}, 'dan'), /not enabled/);
  await assert.rejects(query('getTrip', {tripId: 'trip-one', ownerId: profileId('mark')}, 'other'), /authenticated identity/);
  await assert.rejects(query('getTrip', {tripId: '../trip-one'}), /Invalid record ID/);
  assert.ok([...db.records.keys()].some(key => key.startsWith(`travelWorkspaces/${profileId('mark')}/`)));
  assert.ok(![...db.records.keys()].some(key => key.startsWith('danTravelTrips')));
});

test('exact report capture, linked tasks, fresh context and current return-briefing status', async () => {
  const {command, query, db} = await setup();
  const exactText = '  I met Pastor James.\nSend the material Friday.  ';
  const args = {tripId: 'trip-one', exactText, commitments: [{title: 'Send the material', dueDate: '2026-10-02', certainty: 'committed'}, {title: 'Maybe return', certainty: 'tentative'}]};
  const saved = await command('recordTripSummary', args, 'report-key');
  const report = saved.result.summary;
  assert.equal((await command('recordTripSummary', args, 'report-key')).idempotency.replayed, true);
  await assert.rejects(command('recordTripSummary', {...args, exactText: 'changed'}, 'report-key'), /different arguments/);
  assert.equal((await query('getTripSummary', {summaryId: report.summaryId})).result.summary.exactText, exactText);
  await assert.rejects(command('createFollowUpTask', {summaryId: report.summaryId, commitmentId: report.commitments[1].commitmentId, expectedVersion: 1}), /tentative/);
  const taskInput = {summaryId: report.summaryId, commitmentId: report.commitments[0].commitmentId, expectedVersion: 1};
  const [a, b] = await Promise.all([command('createFollowUpTask', taskInput, 'followup-a'), command('createFollowUpTask', taskInput, 'followup-b')]);
  assert.equal(a.result.task.taskId, b.result.task.taskId);
  assert.equal(a.result.linkStatus, 'linked');
  assert.equal((await db.collection('tasks').get()).docs.length, 1);
  const taskRef = db.collection('tasks').doc(a.result.task.taskId);
  const task = (await taskRef.get()).data();
  assert.equal(task.visibility, 'private'); assert.equal(task.ownerSub, 'mark'); assert.equal(task.notes, '');
  assert.equal(task.sourceThreadId, report.summaryId);
  await taskRef.set({...task, status: 'done', version: 2});
  const context = (await query('getTripContext', {tripId: 'trip-one'})).result;
  assert.equal(context.summaries[0].commitments[0].task.status, 'done');
  const brief = await command('buildReturnBriefing', {tripId: 'trip-one'});
  assert.equal(brief.result.priorReports[0].commitments[0].task.status, 'done');
  await assert.rejects(command('createFollowUpTask', taskInput), /changed since/);
});

test('disabled identities and removed scopes cannot replay or use private/media operations', async () => {
  const {command, query, base, deps} = await setup();
  const ops = await catalog({}, deps('mark'));
  assert.ok(ops.operations.some(op => op.operation === 'recordTripSummary'));
  assert.ok(!ops.operations.some(op => /Photo|DueTravel|OutlookContact/.test(op.operation)));
  await assert.rejects(command('uploadRelationshipPhoto', {personId: 'x'}), /Unknown Travel/);
  const ref = base.staffAuthorizationProfilesCollection.doc(profileId('mark'));
  const profile = (await ref.get()).data();
  await ref.set({...profile, status: 'disabled'});
  await assert.rejects(query('listTrips'), /not enabled/);
  await assert.rejects(command('createPerson', {displayName: 'test'}, 'same-key'), /not enabled/);
  await ref.set({...profile, permissions: ['travel.read']});
  assert.equal((await query('listTrips')).result.count, 1);
  await assert.rejects(command('createPerson', {displayName: 'test'}), /not enabled/);
  assert.ok(!buildAuthorizationFromRoleNames(['FBC Staff Tools Administrator']).permissions.includes('travel.read'));
});

test('same-version updates conflict and malformed summary data does not write', async () => {
  const {command, query} = await setup();
  const results = await Promise.allSettled([command('updateTrip', {tripId: 'trip-one', expectedVersion: 1, changes: {name: 'One'}}), command('updateTrip', {tripId: 'trip-one', expectedVersion: 1, changes: {name: 'Two'}})]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(command('recordTripSummary', {tripId: 'trip-one', exactText: 'bad', commitments: [{title: 'bad date', certainty: 'committed', dueDate: '2026-02-30'}]}), /real YYYY/);
  assert.equal((await query('listTripSummaries')).result.total, 0);
});


test('committed capture remains successful when receipt completion fails', async () => {
  const {command, query, db} = await setup();
  db.failReceipt = true;
  const input = {tripId: 'trip-one', exactText: 'Preserve this once.'};
  const saved = await command('recordTripSummary', input, 'outage-key');
  assert.equal(saved.idempotency.receiptStatus, 'completion_pending');
  assert.equal((await query('getTripSummary', {summaryId: saved.result.summary.summaryId})).result.summary.exactText, input.exactText);
  await assert.rejects(command('recordTripSummary', input, 'outage-key'), /already in progress/);
  assert.equal((await query('listTripSummaries')).result.total, 1);
});
