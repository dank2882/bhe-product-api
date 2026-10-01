#!/usr/bin/env node
// Internal service acceptance only. No calendar entries, outgoing messages or
// fabricated care/prayer histories. Provider and fresh-client gates are separate.
import assert from 'node:assert/strict';
const base = process.env.APPOINTMENTS_ACCEPTANCE_BASE_URL;
const key = process.env.BHE_API_KEY, actor = process.env.APPOINTMENTS_ACCEPTANCE_ACTOR;
const run = process.env.APPOINTMENTS_ACCEPTANCE_RUN;
if (!base || !key || !actor || !run) throw new Error('Explicit candidate URL, verified actor, runtime key and unique run are required');
const headers = { 'content-type': 'application/json', 'x-api-key': key, 'x-bhe-actor-sub': actor, 'x-bhe-task-role': 'admin', 'x-bhe-actor-name': 'Dan Kirchner' };
async function call(domain, mode, operation, args, suffix = operation, exactKey) {
  const response = await fetch(`${base}/${domain}/${mode}`, { method: 'POST', headers,
    body: JSON.stringify({ operation, arguments: args, ...(mode === 'command' ? { idempotencyKey: exactKey || `${run}-${suffix}` } : {}) }) });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(`${operation}: HTTP ${response.status} ${body.error?.code || 'failed'}`);
  return body.result;
}
const q = (op, args) => call('appointments', 'query', op, args);
let r;
const cmd = async (op, args, suffix) => { r = await call('appointments', 'command', op, { ...(r ? { appointmentId: r.appointmentId, expectedVersion: r.version } : {}), ...args }, suffix); return r; };
const catalog = await fetch(`${base}/appointments/operations`, { headers }).then(r => r.json());
assert(catalog.ok && catalog.operations.some(o => o.name === 'bindAppointmentHandoff'));
const denied = await fetch(`${base}/appointments/operations`, { headers: { ...headers, 'x-bhe-actor-sub': 'acceptance-outsider' } });
assert.equal(denied.status, 403);
await cmd('createAppointment', { contentClassification: 'general_or_neutral', privacy: 'general', title: '[Acceptance] Appointment follow-through', purpose: 'Synthetic implementation acceptance; no external contact.' });
const appointmentId = r.appointmentId;
await cmd('setAppointmentDecision', { recommendation: 'no_action', waitingOn: 'none' });
await cmd('recordAppointmentOutcome', { outcome: 'resolved_without_meeting', userConfirmed: true });
await cmd('proposeAppointmentAction', { proposal: { kind: 'domain_handoff', phase: 'follow_up', targetSystem: 'task_management' } });
const action = r.appointment.actions[0];
await cmd('approveAppointmentActions', { items: [{ actionId: action.actionId, proposalHash: action.proposalHash }], userApproved: true });
await cmd('beginAppointmentAction', { actionId: action.actionId });
const dispatchKey = r.appointment.actions[0].dispatchKey;
const taskId = `task-${run}`;
const taskInput = { taskId, title: '[Acceptance] Verify appointment follow-up', visibility: 'private', sourceType: 'appointment', sourceMessageId: `${appointmentId}:${action.actionId}` };
await call('task-management', 'command', 'createTask', taskInput, '', dispatchKey);
// Resume from durable state after an owning write whose result the workflow has
// not yet recorded. Idempotent replay cannot produce a second task.
r = { ...(await q('getAppointment', { appointmentId })), appointmentId };
r.version = r.appointment.version;
await call('task-management', 'command', 'createTask', taskInput, '', dispatchKey);
const task = (await call('task-management', 'query', 'getTask', { taskId })).task;
assert.equal(task.title, taskInput.title);
await cmd('bindAppointmentHandoff', { actionId: action.actionId, reference: { system: 'task_management', recordId: taskId, expectedVersion: task.version } });
// This mirrors the trusted gateway boundary after an independent authorized
// owning-domain read. It does not claim end-user MCP/OAuth acceptance.
const verify = await fetch(`${base}/appointments/verify-domain-reference`, { method: 'POST', headers, body: JSON.stringify({
  arguments: { appointmentId, expectedVersion: r.version, actionId: action.actionId, receipt: { system: 'task_management', recordId: taskId, version: task.version } }, idempotencyKey: `${run}-owning-readback`
}) }).then(r => r.json());
assert.equal(verify.ok, true); r = verify.result;
await cmd('finishAppointmentDebrief', { result: 'complete', userConfirmed: true });
assert.equal((await q('getAppointment', { appointmentId })).appointment.complete, true);
assert.equal((await call('task-management', 'query', 'getTask', { taskId })).task.status, task.status); // Debrief did not complete task.
await call('task-management', 'command', 'updateTask', { taskId, expectedVersion: task.version, changes: { status: 'done' } }, 'cleanup-task');
assert.equal((await call('task-management', 'query', 'getTask', { taskId })).task.status, 'done');
const open = await q('listAppointments', { view: 'open', limit: 100 });
assert(!open.appointments.some(a => a.appointmentId === appointmentId));
console.log(JSON.stringify({ state: 'verified_internal_service_acceptance', base, run, appointmentId, taskId,
  checked: ['authenticated catalog', 'outsider denied', 'durable workflow', 'approved handoff', 'independent exact task readback', 'interruption recovery without duplicate', 'trusted reference receipt', 'debrief completion does not complete task', 'synthetic work cleanup'],
  notChecked: ['real Outlook writes', 'real outgoing message', 'fresh-client MCP and OAuth', 'pastoral-care or prayer writes'] }, null, 2));
