const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteTaskRecord } = require('../lib/task-record-deletion');
function fixture() {
  const stores = new Map();
  const db = { runTransaction: async fn => {
    const writes=[];
    const result=await fn({get:ref=>ref.get(),delete:ref=>writes.push(()=>ref.store.delete(ref.id)),create:(ref,data)=>writes.push(()=>ref.store.set(ref.id,data))});
    writes.forEach(write=>write()); return result;
  }};
  function collection(name) {
    const store=new Map(); stores.set(name,store);
    const ref=id=>({id,store,get:async()=>({exists:store.has(id),data:()=>store.get(id)})});
    function query(field,value,limit=10001) { return {limit:n=>query(field,value,n),get:async()=>({docs:[...store].filter(([,d])=>!field||d[field]===value).slice(0,limit).map(([id,d])=>({id,ref:ref(id),data:()=>d}))})}; }
    return {firestore:db,doc:ref,where:(f,op,v)=>query(f,v),orderBy:()=>query()};
  }
  const deps={taskAccess:{role:'member',subject:'andy'}};
  for(const key of ['projects','tasks','taskNotes','taskNotifications','taskAttachments','calendarEvents','routines','taskManagementAuditEvents']) deps[key+'Collection']=collection(key);
  stores.get('projects').set('maintenance',{projectId:'maintenance',visibility:'branch',ownerSub:'dan',collaborationPolicy:'editor_archive_creator_delete',branchMembers:[{subject:'andy',role:'editor'}]});
  stores.get('tasks').set('repair',{taskId:'repair',projectId:'maintenance',visibility:'staff',lifeArea:'church',createdBySub:'andy',version:3});
  return {deps,stores};
}
const request={recordType:'task',recordId:'repair',expectedVersion:3,confirmDelete:true};
test('atomic delete removes task history and saves replay receipt',async()=>{
  const {deps,stores}=fixture();stores.get('taskNotes').set('note',{taskId:'repair'});
  const result=await deleteTaskRecord(request,deps);
  assert.equal(result.action,'deleted');assert.equal(stores.get('tasks').size,0);assert.equal(stores.get('taskNotes').size,0);
  stores.get('tasks').set('repair',{version:1});
  assert.equal((await deleteTaskRecord(request,deps)).replayed,true);
  assert.equal(stores.get('tasks').get('repair').version,1);
});
test('wrong creator, stale version, missing confirmation, and attachments fail without writes',async()=>{
  for(const scenario of ['creator','version','confirmation','attachment']) {
    const {deps,stores}=fixture();const args={...request};
    if(scenario==='creator') stores.get('tasks').get('repair').createdBySub='pastor';
    if(scenario==='version') args.expectedVersion=2;
    if(scenario==='confirmation') args.confirmDelete=false;
    if(scenario==='attachment') stores.get('taskAttachments').set('file',{taskId:'repair'});
    await assert.rejects(deleteTaskRecord(args,deps));
    assert.equal(stores.get('tasks').size,1);assert.equal(stores.get('taskManagementAuditEvents').size,0);
  }
});
test('empty child project deletion succeeds; populated project is blocked',async()=>{
  for(const populated of [true,false]) {
    const {deps,stores}=fixture();stores.get('projects').set('child',{projectId:'child',parentProjectId:'maintenance',visibility:'branch',lifeArea:'church',createdBySub:'andy',version:1});
    if(populated) stores.get('tasks').get('repair').projectId='child';
    const promise=deleteTaskRecord({recordType:'project',recordId:'child',expectedVersion:1,confirmDelete:true},deps);
    if(populated) await assert.rejects(promise,{code:'task_record_has_references'});
    else assert.equal((await promise).action,'deleted');
    assert.equal(stores.get('projects').has('child'),populated);
  }
});
