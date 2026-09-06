const test = require('node:test');
const assert = require('node:assert/strict');
const { createProject, updateProject, getProject, listProjects, listTasks } = require('../lib/project-task-service');
const { validateHierarchy } = require('../lib/project-hierarchy');

function collection(records = []) {
  const rows = new Map(records.map(record => [record.taskId || record.projectId, structuredClone(record)]));
  return {
    rows,
    doc: id => ({
      get: async () => ({ id, exists: rows.has(id), data: () => structuredClone(rows.get(id)) }),
      create: async value => { if(rows.has(id)) throw Error('exists'); rows.set(id, structuredClone(value)); },
      set: async value => rows.set(id, structuredClone(value))
    }),
    limit: n => ({ get: async () => ({ docs: [...rows].slice(0,n).map(([id,value]) => ({ id, data: () => structuredClone(value) })) }) })
  };
}
function fixture() {
  const project = (projectId, name, parentProjectId='') => ({ projectId, name, parentProjectId, status:'active', visibility:'staff', ownerSub:'pastor', lifeArea:'work', version:1 });
  return {
    projectsCollection: collection([project('philippines','Philippines 2027'),project('containers','Containers','philippines'),project('january','January container','containers'),project('travel','Travel','philippines'),project('other','Unrelated program')]),
    tasksCollection: collection([
      {taskId:'overall',projectId:'philippines',title:'Coordinate program',status:'next',visibility:'staff'},
      {taskId:'shipping',projectId:'january',title:'Book shipment',status:'waiting',dueDate:'2026-09-01',visibility:'staff'},
      {taskId:'flight',projectId:'travel',title:'Book flight',status:'done',visibility:'staff'},
      {taskId:'unrelated',projectId:'other',title:'Other',status:'next',visibility:'staff'}
    ]),
    taskAccess: { subject:'pastor',role:'manager' },
    now:()=> '2026-09-06T12:00:00Z'
  };
}

test('Philippines overall and Containers views count each task once and show useful paths', async () => {
  const deps=fixture();
  const {hierarchy: all}=await getProject({projectId:'philippines',includeDescendants:true,today:'2026-09-06'},deps);
  assert.equal(all.projectCount,4);assert.equal(all.taskCounts.total,3);assert.equal(all.taskCounts.open,2);assert.equal(all.taskCounts.overdue,1);
  const container=all.projects.find(p=>p.projectId==='containers');
  assert.equal(container.directTaskCounts.total,0);assert.equal(container.branchTaskCounts.total,1);
  assert.deepEqual(all.projects.find(p=>p.projectId==='january').path.map(p=>p.name),['Philippines 2027','Containers','January container']);
  const {hierarchy: branch}=await getProject({projectId:'containers',includeDescendants:true},deps);
  assert.equal(branch.projectCount,2);assert.equal(branch.taskCounts.total,1);
  assert.equal(branch.projects.some(p=>p.projectId==='travel'),false);
  assert.deepEqual((await listTasks({projectId:'containers'},deps)).tasks,[]);
  assert.deepEqual((await listTasks({projectId:'containers',includeDescendants:true},deps)).tasks.map(t=>t.taskId),['shipping']);
  assert.deepEqual((await listProjects({parentProjectId:''},deps)).projects.map(p=>p.projectId).sort(),['other','philippines']);
  assert.deepEqual((await listProjects({parentProjectId:'philippines'},deps)).projects.map(p=>p.projectId).sort(),['containers','travel']);
  assert.equal((await listProjects({ancestorProjectId:'containers'},deps)).count,2);
});

test('moving a branch preserves task identity, descendants, history and access', async () => {
  const deps=fixture();const before=structuredClone([...deps.tasksCollection.rows]);
  const moved=await updateProject({projectId:'containers',expectedVersion:1,changes:{parentProjectId:'other'}},deps);
  assert.equal(moved.project.parentProjectId,'other');assert.equal(moved.project.version,2);
  assert.deepEqual([...deps.tasksCollection.rows],before);
  assert.equal(deps.projectsCollection.rows.get('january').parentProjectId,'containers');
  assert.equal((await getProject({projectId:'philippines',includeDescendants:true},deps)).hierarchy.taskCounts.total,2);
  assert.equal((await getProject({projectId:'other',includeDescendants:true},deps)).hierarchy.taskCounts.total,2);
  await updateProject({projectId:'containers',expectedVersion:2,changes:{parentProjectId:''}},deps);
  assert.equal((await listProjects({parentProjectId:''},deps)).count,3);
});

test('cycles, missing/inactive parents, excessive depth and combined classification moves are rejected', async () => {
  const deps=fixture();
  await assert.rejects(updateProject({projectId:'philippines',expectedVersion:1,changes:{parentProjectId:'january'}},deps),{code:'project_hierarchy_cycle'});
  await assert.rejects(createProject({projectId:'new',name:'New',parentProjectId:'missing'},deps),{code:'project_not_found'});
  deps.projectsCollection.rows.get('other').status='archived';
  await assert.rejects(updateProject({projectId:'travel',expectedVersion:1,changes:{parentProjectId:'other'}},deps),{code:'project_parent_inactive'});
  await assert.rejects(updateProject({projectId:'travel',expectedVersion:1,changes:{parentProjectId:'containers',department:'retail'}},deps),{code:'invalid_project_hierarchy'});
  const graph=new Map(Array.from({length:8},(_,i)=>[String(i),{projectId:String(i),parentProjectId:i?String(i-1):''}]));
  assert.throws(()=>validateHierarchy({projectId:'9',parentProjectId:'7'},graph),{code:'project_hierarchy_too_deep'});
  assert.equal(deps.projectsCollection.rows.get('philippines').parentProjectId,'');
});

test('existing access remains enforced in nested overviews, totals, searches and parent selection', async () => {
  const deps=fixture();deps.projectsCollection.rows.get('travel').visibility='private';deps.projectsCollection.rows.get('travel').ownerSub='someone-else';
  deps.tasksCollection.rows.get('flight').visibility='private';deps.tasksCollection.rows.get('flight').ownerSub='someone-else';
  const view=(await getProject({projectId:'philippines',includeDescendants:true},deps)).hierarchy;
  assert.equal(view.coverage,'accessible_records_only');assert.equal(view.projectCount,3);assert.equal(view.taskCounts.total,2);
  assert.equal(JSON.stringify(view).includes('Book flight'),false);
  await assert.rejects(getProject({projectId:'travel',includeDescendants:true},deps),{code:'task_access_denied'});
  await assert.rejects(listTasks({projectId:'travel',includeDescendants:true},deps),{code:'task_access_denied'});
  await assert.rejects(createProject({name:'Sneak child',parentProjectId:'travel'},deps),{code:'task_access_denied'});
  const member={...deps,taskAccess:{subject:'helper',role:'member'}};
  await assert.rejects(createProject({name:'Unauthorized child',parentProjectId:'containers'},member),{code:'task_access_denied'});
});

test('closing a parent does not silently close or archive its descendants', async () => {
  const deps=fixture();await updateProject({projectId:'philippines',expectedVersion:1,changes:{status:'done'}},deps);
  const result=await getProject({projectId:'philippines',includeDescendants:true},deps);
  assert.equal(result.project.status,'done');assert.equal(result.hierarchy.projectCounts.active,3);assert.equal(result.hierarchy.taskCounts.open,2);
});


test('existing operation dispatcher accepts nested-project arguments and rejects invalid parent values', async () => {
  const { runTaskManagementOperation } = require('../lib/task-management-operation-registry');
  const deps=fixture();
  const created=await runTaskManagementOperation({mode:'command',operation:'createProject',arguments:{projectId:'february',name:'February shipment',parentProjectId:'containers'}},deps);
  assert.equal(created.result.project.parentProjectId,'containers');
  const read=await runTaskManagementOperation({mode:'query',operation:'getProject',arguments:{projectId:'containers',includeDescendants:true}},deps);
  assert.equal(read.result.hierarchy.projectCount,3);
  await assert.rejects(updateProject({projectId:'containers',expectedVersion:1,changes:{parentProjectId:42}},deps),{code:'invalid_project_hierarchy'});
  assert.equal(deps.projectsCollection.rows.get('containers').parentProjectId,'philippines');
});
