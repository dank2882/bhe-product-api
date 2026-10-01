#!/usr/bin/env node
// Read-only internal service acceptance; connected Life OS acceptance is separate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const base = process.env.MAINTENANCE_ACCEPTANCE_BASE_URL;
const baseline = process.env.MAINTENANCE_ACCEPTANCE_BASELINE_URL;
const key = process.env.BHE_API_KEY;
if (!base || !key) throw new Error('Explicit URL and existing service credential required');
const rootId = 'proj-fbc-maintenance';
const dan = 'entra|8645ddd9-9cc8-4b1b-9d95-1eddf5df7492|1bfc55ff-1f97-4263-beb1-609e7a3c963e';
const shawna = 'entra|8645ddd9-9cc8-4b1b-9d95-1eddf5df7492|bbaec250-1a42-4ddc-aae7-3b5d3d1773b8';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
async function query(operation, args = {}, actor = dan, url = base) {
  const response = await fetch(`${url}/task-management/query`, { method: 'POST', signal: AbortSignal.timeout(45000),
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'x-bhe-actor-sub': actor,
      'x-bhe-actor-name': actor === dan ? 'Dan Kirchner' : 'Shawna Blue', 'x-bhe-task-role': actor === dan ? 'admin' : 'member',
      'x-bhe-actor-subjects': JSON.stringify(actor === dan ? [dan, 'google-oauth2|106948814779912948467', 'waad|bhe-microsoft-entra|1bfc55ff-1f97-4263-beb1-609e7a3c963e'] : [actor]) },
    body: JSON.stringify({ operation, arguments: args }) });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`${operation}: ${response.status} ${body.error?.code || ''}`);
  return body.result;
}
async function all(operation, args, field, actor = dan) {
  let cursor, rows = [];
  do { const p = await query(operation, { ...args, limit: 100, ...(cursor ? { cursor } : {}) }, actor); rows.push(...p[field]); cursor = p.nextCursor; } while (cursor);
  return rows;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const root = (await query('getProject', { projectId: rootId })).project;
assert.equal(root.leadSub, shawna);
const projects = await all('listProjects', { ancestorProjectId: rootId, includeArchived: true }, 'projects');
const tasksBefore = await all('listTasks', { projectId: rootId, includeDescendants: true, includeArchived: true }, 'tasks');
const routinesBefore = await query('listMaintenanceRoutines', { includeArchived: true, limit: 100, detailLevel: 'full' });
assert.equal(routinesBefore.hasMore, false);
const ids = new Set([...projects.map(p => p.projectId), ...tasksBefore.map(t => t.taskId), ...routinesBefore.routines.map(r => r.routineId)]);
function noMaintenance(value) {
  if (!value || typeof value !== 'object') return;
  for (const [k,v] of Object.entries(value)) {
    if (['projectId','taskId','routineId'].includes(k)) assert(!ids.has(v), `Maintenance leaked through ${k}`);
    if (k === 'teamId') assert.notEqual(v, 'maintenance');
    if (v && typeof v === 'object') noMaintenance(v);
  }
}
const daily = await query('buildDailyReview', { today }); noMaintenance(daily);
assert.equal(daily.scope, 'dan_personal_excludes_maintenance');
assert.equal(daily.summary.activeNextCount, daily.activeNext.length);
let preservedNext = null;
if (baseline) {
  const old = await query('buildDailyReview', { today }, dan, baseline);
  const expected = old.activeNext.filter(t => !ids.has(t.taskId) && t.teamId !== 'maintenance');
  assert(expected.every(t => daily.activeNext.some(n => n.taskId === t.taskId)), 'Non-Maintenance next action missing');
  preservedNext = expected.length;
}
for (const [operation, field] of [['listTasks','tasks'], ['listProjects','projects']]) noMaintenance(await all(operation, {}, field));
noMaintenance(await query('listRoutines', { limit: 100 }));
noMaintenance(await query('listMyNotifications', { limit: 100, unreadOnly: false }));
let reviewPages = 0;
for (const period of ['weekly','monthly']) for (const section of ['overview','outcomes','areas','attention','setup','waiting']) {
  let cursor;
  do { const review = await query('buildPlanningReview', { asOfDate: today, period, section, limit: 100, ...(cursor ? {cursor} : {}) }); noMaintenance(review); cursor = review.nextCursor; reviewPages++; } while(cursor);
}
const board = await query('listMaintenanceBoard', { limit: 100 }, shawna);
const boardRows = [...board.rows];
let cursor = board.nextCursor;
while(cursor) { const p = await query('listMaintenanceBoard', { limit: 100, cursor }, shawna); boardRows.push(...p.rows); cursor = p.nextCursor; }
assert.equal(boardRows.length, board.totalCount);
assert.deepEqual(new Set(boardRows.map(r => r.taskId)), new Set(tasksBefore.filter(t => t.status !== 'dropped').map(t => t.taskId)));
const shawnaRoutines = await query('listMaintenanceRoutines', { limit: 100 }, shawna);
assert.equal(shawnaRoutines.totalCount, routinesBefore.routines.filter(r => r.status !== 'archived').length);
const tasksAfter = await all('listTasks', { projectId: rootId, includeDescendants: true, includeArchived: true }, 'tasks');
const routinesAfter = await query('listMaintenanceRoutines', { includeArchived: true, limit: 100, detailLevel: 'full' });
assert.equal(digest(tasksAfter), digest(tasksBefore), 'Maintenance task records changed during read-only acceptance');
assert.equal(digest(routinesAfter.routines), digest(routinesBefore.routines), 'Maintenance routine records changed during acceptance');
console.log(JSON.stringify({ state: 'verified_internal_service_acceptance', observedAt: new Date().toISOString(), base,
  rootVersion: root.version, lead: root.leadName, dailyActiveNextCount: daily.summary.activeNextCount, nonMaintenanceNextPreserved: preservedNext,
  defaultScope: daily.scope, reviewPages, maintenanceProjectCount: projects.length,
  maintenanceBoardCount: board.totalCount, maintenanceRoutineCount: shawnaRoutines.totalCount,
  sharedRecordsUnchanged: true, tasksDigest: digest(tasksBefore), routinesDigest: digest(routinesBefore.routines),
  checks: ['default task/project/routine lists', 'daily review and notifications', 'all weekly/monthly sections', 'non-Maintenance next preservation', 'Shawna internal authorized board read', 'shared source records unchanged'],
  notChecked: ['Shawna interactive client session'] }, null, 2));
