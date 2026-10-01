#!/usr/bin/env node
// Internal authenticated service acceptance. Not fresh-client/OAuth acceptance.
import assert from 'node:assert/strict';
const base = process.env.INTAKE_ACCEPTANCE_BASE_URL;
const key = process.env.BHE_API_KEY, actor = process.env.INTAKE_ACCEPTANCE_ACTOR;
if (!base || !key || !actor) throw new Error('Explicit acceptance URL, API key and verified actor are required');
const run = process.env.INTAKE_ACCEPTANCE_RUN || 'intake-review-20261001-v1';
const headers = { 'content-type': 'application/json', 'x-api-key': key, 'x-bhe-actor-sub': actor,
  'x-bhe-task-role': 'admin', 'x-bhe-actor-name': 'Dan Kirchner' };
async function call(domain, mode, operation, args, suffix, exactKey) {
  const r = await fetch(`${base}/${domain}/${mode}`, { method: 'POST', headers,
    body: JSON.stringify({ operation, arguments: args, ...(mode === 'command' ? { idempotencyKey: exactKey || `${run}-${suffix || operation}` } : {}) }) });
  const body = await r.json();
  if (!r.ok || body.ok === false) throw new Error(`${operation}: HTTP ${r.status} ${body.error?.code || 'failed'} ${body.error?.message || ''}`);
  return body.result;
}
const tq = (op, args) => call('task-management', 'query', op, args);
const tc = (op, args, suffix) => call('task-management', 'command', op, args, suffix);
const iq = (op, args) => call('intake', 'query', op, args);
const ic = (op, args, suffix) => call('intake', 'command', op, args, suffix);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const next = new Date(`${today}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 30);
const nextDate = next.toISOString().slice(0,10);
const parentId = `project-${run}-philippines`, childId = `project-${run}-containers`, vanId = `project-${run}-vans`;
const project = (id, extra = {}) => tc('createProject', { projectId: id, name: `[Acceptance] ${id}`, visibility: 'private',
  projectKind: 'outcome', outcome: 'Synthetic acceptance only', nextReviewDate: today, ...extra }, id);
await project(parentId);
await project(childId, { parentProjectId: parentId });
await project(vanId, { status: 'paused' });
const before = await tq('getProject', { projectId: parentId });
let review = await tq('buildPlanningReview', { asOfDate: today, period: 'monthly', section: 'outcomes', limit: 100 });
const all = [...review.items];
while (review.nextCursor) { review = await tq('buildPlanningReview', { asOfDate: today, period: 'monthly', section: 'outcomes', limit: 100, cursor: review.nextCursor }); all.push(...review.items); }
assert(all.some(p => p.projectId === vanId)); assert(all.some(p => p.projectId === childId));
assert.equal((await tq('getProject', { projectId: parentId })).project.version, before.project.version);
await tc('recordPlanningReview', { recordType: 'project', recordId: parentId, expectedVersion: before.project.version, asOfDate: today, nextReviewDate: nextDate }, 'parent-review');
assert.equal((await tq('getProject', { projectId: childId })).project.nextReviewDate, today);
let capture = await ic('createIntake', { title: '[Acceptance] mixed meeting source', sourceType: 'text', sensitivity: 'general',
  exactText: '  Ask for estimates.\nMaybe vehicles later.  ' });
const intakeId = capture.intakeId;
capture = await ic('proposeIntakeItem', { intakeId, expectedVersion: capture.intake.version, exactText: 'Ask for estimates.',
  proposal: { destination: 'task', action: 'create', arguments: { title: '[Acceptance] Ask for estimates', projectId: childId }, duplicateCheck: 'New synthetic acceptance intent' } });
const item = capture.intake.items[0];
capture = await ic('approveIntakeItem', { intakeId, expectedVersion: capture.intake.version, itemId: item.itemId, proposalHash: item.proposalHash, approvalNote: 'Authorized synthetic acceptance of intake implementation' });
capture = await ic('prepareIntakeDispatch', { intakeId, expectedVersion: capture.intake.version, itemId: item.itemId });
// Simulate an interruption after the owning write and before intake verification.
const dispatch = capture.intake.items[0].dispatch;
await call('task-management', 'command', dispatch.operation, dispatch.arguments, 'manual-dispatch', dispatch.idempotencyKey);
const fresh = (await iq('getIntake', { intakeId })).intake;
capture = await ic('dispatchIntakeItem', { intakeId, expectedVersion: fresh.version, itemId: item.itemId }, 'resume');
assert.equal(capture.intake.items[0].status, 'verified');
const target = (await tq('getTask', { taskId: dispatch.recordId })).task;
assert.equal(target.title, '[Acceptance] Ask for estimates');
capture = await ic('proposeIntakeItem', { intakeId, expectedVersion: capture.intake.version, exactText: 'Maybe vehicles later.', questions: ['Synthetic routing decision unresolved'] }, 'unresolved-item');
const held = capture.intake.items[1];
capture = await ic('dismissIntakeItem', { intakeId, expectedVersion: capture.intake.version, itemId: held.itemId, reason: 'Synthetic idea explicitly dismissed for acceptance cleanup' }, 'dismiss-synthetic-idea');
capture = await ic('finishIntakeExtraction', { intakeId, expectedVersion: capture.intake.version });
assert.equal(capture.intake.status, 'complete');
const replay = await ic('dispatchIntakeItem', { intakeId, expectedVersion: capture.intake.version, itemId: item.itemId }, 'resume-complete');
assert.equal(replay.alreadyVerified, true);
const daily = await tq('buildDailyReview', { today });
assert(daily.projectReviewsDue.some(p => p.projectId === vanId));
assert(daily.activeNext.some(t => t.taskId === dispatch.recordId));
// Retain audit/source evidence but remove synthetic work from operational reviews.
await tc('updateTask', { taskId: dispatch.recordId, expectedVersion: target.version, changes: { status: 'done' } }, 'cleanup-task');
for (const projectId of [childId, parentId, vanId]) {
  const current = (await tq('getProject', { projectId })).project;
  await tc('updateProject', { projectId, expectedVersion: current.version, changes: { status: 'done' } }, `cleanup-${projectId}`);
  assert.equal((await tq('getProject', { projectId })).project.status, 'done');
}
console.log(JSON.stringify({ state: 'verified_internal_service_acceptance', run, base, intakeId, syntheticProjectIds: [parentId, childId, vanId],
  syntheticTaskId: dispatch.recordId, checked: ['nested monthly outcomes', 'paused due review', 'read-only review', 'parent-child completion isolation', 'exact source', 'owning task write', 'interruption recovery', 'repeat without duplicate', 'synthetic work closed'],
  notChecked: ['actual photo host handoff', 'fresh ChatGPT client', 'later calendar day', 'real project choices'] }, null, 2));
