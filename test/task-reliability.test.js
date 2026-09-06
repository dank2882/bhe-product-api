const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyReview, listTasks, listProjects, updateTask, updateProject } = require('../lib/project-task-service');
const { readCompleteQuery } = require('../lib/complete-query');

function collection(rows = []) {
  const records = new Map(rows.map((r, i) => [r.taskId || r.projectId || String(i), { value: r, tick: 1 }]));
  const snapshot = id => { const r = records.get(id); const value = structuredClone(r?.value); return { id, exists: !!r, updateTime: r?.tick, data: () => value }; };
  const ref = id => ({
    get: async () => snapshot(id),
    update: async (value, condition) => {
      if (records.get(id)?.tick !== condition.lastUpdateTime) throw Object.assign(new Error('Changed'), { code: 9 });
      records.set(id, { value: structuredClone(value), tick: condition.lastUpdateTime + 1 });
    }
  });
  const query = (after = '', limit = 500) => ({
    orderBy: () => query(after, limit), startAfter: doc => query(doc.id, limit),
    limit: n => query(after, n), get: async () => ({ docs: [...records.keys()].sort().filter(id => id > after).slice(0, limit).map(snapshot) })
  });
  return { ...query(), doc: ref };
}

test('personal brief includes late-sorting work beyond another person’s first 100 tasks', async () => {
  const tasks = Array.from({ length: 1100 }, (_, i) => ({ taskId: `other-${String(i).padStart(4, '0')}`, title: 'Other', status: 'next', visibility: 'staff', ownerSub: 'other', dueDate: '2026-01-01' }));
  tasks.push({ taskId: 'z-mine', title: 'Mine', status: 'next', visibility: 'private', ownerSub: 'pastor' });
  const deps = { tasksCollection: collection(tasks), projectsCollection: collection(), routinesCollection: collection(), taskNotificationsCollection: collection(), taskAccess: { subject: 'pastor', role: 'manager' } };
  const result = await buildDailyReview({ today: '2026-09-05' }, deps);
  assert.deepEqual(result.activeNext.map(r => r.taskId), ['z-mine']);
  const direct = await listTasks({ query: 'Mine' }, deps);
  assert.equal(direct.count, 1);
});

test('task and project result pages have stable ties and disclose continuation', async () => {
  const deps = { tasksCollection: collection(Array.from({ length: 103 }, (_, i) => ({ taskId: `t${i}`, title: 'Task', status: 'next' }))), projectsCollection: collection([{ projectId: 'a' }, { projectId: 'b' }]) };
  const first = await listTasks({ limit: 100 }, deps);
  const second = await listTasks({ limit: 100, cursor: first.nextCursor }, deps);
  assert.equal(first.hasMore, true); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.tasks, ...second.tasks].map(t => t.taskId)).size, 103);
  await assert.rejects(listTasks({ limit: 100, status: 'done', cursor: first.nextCursor }, deps), { code: 'query_cursor_stale' });
  const projects = await listProjects({ limit: 1 }, deps);
  assert.equal(projects.hasMore, true);
});

for (const kind of ['task', 'project']) test(`simultaneous ${kind} writes produce one success and one conflict`, async () => {
  const rows = collection([{ [`${kind}Id`]: 'race', title: 'Original', name: 'Original', version: 1, status: kind === 'task' ? 'next' : 'active' }]);
  const deps = { [`${kind}sCollection`]: rows };
  const update = kind === 'task' ? updateTask : updateProject;
  const input = { [`${kind}Id`]: 'race', expectedVersion: 1 };
  const results = await Promise.allSettled([update({ ...input, changes: { [kind === 'task' ? 'title' : 'name']: 'Changed' } }, deps), update({ ...input, changes: { priority: 'high' } }, deps)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 409);
});

test('complete query refuses an incomplete answer beyond its configured budget', async () => {
  await assert.rejects(readCompleteQuery(collection([{ taskId: 'a' }, { taskId: 'b' }, { taskId: 'c' }]), { pageSize: 1, maxDocuments: 2 }), { code: 'query_requires_narrower_scope' });
});
