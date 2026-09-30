// Trusted backend acceptance only. This does not prove Mark's client OAuth.
import {execFileSync} from 'node:child_process';
import {Firestore} from '@google-cloud/firestore';
import assert from 'node:assert/strict';
const db = new Firestore({projectId: 'location-map-985', databaseId: 'chatgptstorage'});
const service = JSON.parse(execFileSync('gcloud', ['run','services','describe','bhe-product-api','--project=location-map-985','--region=us-west1','--format=json'], {encoding: 'utf8'}));
const env = service.spec.template.spec.containers[0].env;
const keyRef = (env.find(e => e.name === 'BHE_API_KEY') || env.find(e => e.name === 'API_KEY'))?.valueFrom?.secretKeyRef;
assert.ok(keyRef, 'Existing API secret reference required');
const key = execFileSync('gcloud', ['secrets','versions','access', keyRef.key, '--secret='+keyRef.name, '--project=location-map-985'], {encoding:'utf8'}).trim();
const base = process.argv[2] || service.status.url;
const docs = await db.collection('staffAuthorizationProfiles').where('email','==','marks@foundedonfaith.com').get();
assert.equal(docs.size, 1);
const mark = docs.docs[0].data(), profileId = docs.docs[0].id;
assert.equal(mark.status, 'active');
assert.ok(mark.permissions.includes('travel.read') && mark.permissions.includes('travel.write'));
const dan = env.find(e => e.name === 'DAN_TRAVEL_OWNER_SUBJECTS').value.split(',')[0].trim();
const prefix = `travel-verification-${Date.now()}`;
const root = db.collection('travelWorkspaces').doc(profileId);
const cleanup = [];
const checks = [];
async function request(path, body, subject = mark.subject, withKey = true) {
  const headers = {'content-type':'application/json', 'x-bhe-actor-sub':subject, 'x-bhe-task-role':mark.taskRole, 'x-bhe-task-scopes':mark.permissions.join(' '), 'x-bhe-actor-name':mark.displayName, 'x-bhe-actor-email':mark.email};
  if (withKey) headers['x-api-key'] = key;
  const response = await fetch(base + path, {method: body ? 'POST' : 'GET', headers, ...(body ? {body:JSON.stringify(body)} : {})});
  return {status:response.status, body:await response.json()};
}
async function command(operation, args, keySuffix = operation) {
  const result = await request('/travel-advisor/command', {operation, arguments:args, idempotencyKey:prefix+'-'+keySuffix});
  assert.equal(result.body.ok, true, JSON.stringify(result.body)); return result.body;
}
async function query(operation, args) {
  const result = await request('/travel-advisor/query', {operation, arguments:args});
  assert.equal(result.body.ok, true, JSON.stringify(result.body)); return result.body.result;
}
try {
  const catalog = await request('/travel-advisor/operations');
  assert.equal(catalog.body.ok, true); assert.ok(catalog.body.operations.some(op => op.operation === 'recordTripSummary'));
  checks.push('Mark live catalog');
  for (const actor of ['travel-verification-unregistered', dan]) {
    const denied = await request('/travel-advisor/query', {operation:'getTrip', arguments:{tripId:prefix}}, actor);
    assert.equal(denied.body.ok, false); assert.equal(denied.body.error.status, 403);
  }
  const noKey = await request('/travel-advisor/operations', null, mark.subject, false);
  assert.ok([401,403].includes(noKey.status));
  const legacy = await request('/dan-travel/query', {operation:'listTrips',arguments:{}});
  assert.equal(legacy.body.ok,false); assert.equal(legacy.body.error.status,403);
  const danLegacy = await request('/dan-travel/query', {operation:'listTrips',arguments:{limit:1}}, dan);
  assert.equal(danLegacy.body.ok, true);
  checks.push('Dan and unregistered denied Mark workspace', 'Mark denied Dan legacy workspace', 'Dan legacy read preserved', 'Missing backend key denied');
  const tripArgs = {tripId:prefix, name:'Temporary Travel Advisor verification', destinations:[{name:'Verification City', country:'Verification Country'}], notes:prefix};
  const trip = await command('createTrip',tripArgs);
  cleanup.push(root.collection('trips').doc(prefix));
  for (const briefing of trip.result.destinationBriefings) cleanup.push(root.collection('briefings').doc(briefing.briefingId));
  assert.equal((await query('getTrip',{tripId:prefix})).trip.tripId,prefix);
  const personId = prefix+'-person', orgId = prefix+'-church';
  await command('createPerson',{personId,displayName:'Temporary verification person'}); cleanup.push(root.collection('people').doc(personId));
  await command('createOrganization',{organizationId:orgId,name:'Temporary verification church',type:'church'}); cleanup.push(root.collection('organizations').doc(orgId));
  const affiliation = await command('linkPersonToOrganization',{personId,organizationId:orgId,role:'Pastor'});
  cleanup.push(root.collection('affiliations').doc(affiliation.result.affiliation.affiliationId));
  const contact = await command('addContactMethod',{personId,type:'email',value:'travel-verification@example.invalid'});
  cleanup.push(root.collection('contactMethods').doc(contact.result.contactMethod.contactMethodId));
  const meeting = await command('recordInteraction',{personIds:[personId],organizationIds:[orgId],tripId:prefix,summary:'Temporary verification meeting',exactText:' Exact meeting words. '});
  cleanup.push(root.collection('interactions').doc(meeting.result.interaction.interactionId));
  assert.ok((await query('getPerson',{personId})).person.personId === personId);
  checks.push('Trip/person/church/contact/meeting create and read-back');
  const exactText = '  Temporary verification summary.\n  Preserve spacing and wording.  ';
  const reportArgs = {tripId:prefix,exactText,personIds:[personId],organizationIds:[orgId],commitments:[{title:'Temporary travel verification follow-up',certainty:'committed',dueDate:'2026-10-02'}]};
  const saved = await command('recordTripSummary',reportArgs);
  const report = saved.result.summary;
  cleanup.push(root.collection('memories').doc(report.summaryId));
  assert.equal((await query('getTripSummary',{summaryId:report.summaryId})).summary.exactText,exactText);
  assert.equal((await command('recordTripSummary',reportArgs)).idempotency.replayed,true);
  const changed = await request('/travel-advisor/command',{operation:'recordTripSummary',arguments:{...reportArgs,exactText:'changed'},idempotencyKey:prefix+'-recordTripSummary'});
  assert.equal(changed.body.error.status,409);
  checks.push('Exact original preservation', 'Duplicate-safe capture replay', 'Changed replay rejected');
  const followupArgs = {summaryId:report.summaryId,commitmentId:report.commitments[0].commitmentId,expectedVersion:1};
  const followup = await command('createFollowUpTask',followupArgs);
  const task = followup.result.task;
  cleanup.push(db.collection('tasks').doc(task.taskId));
  assert.equal(followup.result.linkStatus,'linked'); assert.equal(task.ownerSub,mark.subject); assert.equal(task.visibility,'private');
  assert.equal((await command('createFollowUpTask',followupArgs)).result.task.taskId,task.taskId);
  const changedTask = await request('/task-management/command',{operation:'updateTask',arguments:{taskId:task.taskId,expectedVersion:task.version,changes:{status:'done'}},idempotencyKey:prefix+'-task-done'});
  assert.equal(changedTask.body.ok,true,JSON.stringify(changedTask.body));
  const context = await query('getTripContext',{tripId:prefix});
  assert.equal(context.summaries[0].commitments[0].task.status,'done');
  assert.equal(context.interactions.length,1);
  const briefing = await command('buildReturnBriefing',{tripId:prefix});
  cleanup.push(root.collection('briefings').doc(briefing.result.briefing.briefingId));
  assert.ok(briefing.result.priorReports.some(r => r.summaryId===report.summaryId && r.commitments[0].task.status==='done'));
  checks.push('Owned private task and source link', 'Task replay without duplicate', 'Fresh context and briefing use current task completion');
  const deniedActual = await request('/travel-advisor/query',{operation:'getTripSummary',arguments:{summaryId:report.summaryId}},dan);
  assert.equal(deniedActual.body.error.status,403);
  const race = await Promise.all(['A','B'].map(name => request('/travel-advisor/command',{operation:'updateTrip',arguments:{tripId:prefix,expectedVersion:1,changes:{name:'Temporary verification '+name}},idempotencyKey:prefix+'-race-'+name})));
  assert.equal(race.filter(r=>r.body.ok).length,1); assert.equal(race.filter(r=>r.body.error?.status===409).length,1);
  checks.push('Dan denied exact saved Mark report', 'Concurrent version race: one success, one conflict');
  console.log(JSON.stringify({ok:true,verification:'trusted backend only; Mark client OAuth remains pending',base,profileId,profileVersion:mark.version,checks,fixturePrefix:prefix},null,2));
} finally {
  for (const ref of cleanup.reverse()) {await ref.delete(); assert.equal((await ref.get()).exists,false);}
  console.log(JSON.stringify({cleanupVerified:true,removedFixtureRecords:cleanup.length,auditAndIdempotencyReceipts:'retained'}));
}
