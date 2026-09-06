const test=require('node:test');
const assert=require('node:assert/strict');
const service=require('../lib/project-task-service');
const attachments=require('../lib/task-attachment-service');
function collection(values=[]){
 const rows=new Map(values.map(v=>[v.taskId||v.projectId||v.noteId||v.attachmentId||v.subject,structuredClone(v)]));
 return {rows,doc:id=>({get:async()=>({id,exists:rows.has(id),data:()=>structuredClone(rows.get(id))}),create:async v=>{if(rows.has(id))throw Error('exists');rows.set(id,structuredClone(v));},set:async v=>rows.set(id,structuredClone(v))}),limit:n=>({get:async()=>({docs:[...rows].slice(0,n).map(([id,v])=>({id,data:()=>structuredClone(v)}))})})};
}
function fixture(){
 const p=(projectId,parentProjectId,branchMembers=[])=>({projectId,parentProjectId,name:projectId,visibility:'branch',branchMembers,lifeArea:'work',ownerSub:'dan',status:'active',version:1});
 const t=(taskId,projectId)=>({taskId,projectId,title:taskId,visibility:'branch',status:'next',lifeArea:'work',ownerSub:'dan',version:1});
 const deps={projectsCollection:collection([p('program','',[{subject:'pastor',role:'editor'}]),p('containers','program',[{subject:'helper',role:'editor'},{subject:'reader',role:'viewer'}]),p('january','containers'),p('travel','program',[{subject:'traveler',role:'editor'}])]),tasksCollection:collection([t('shipment','january'),t('flight','travel')]),taskNotesCollection:collection([{noteId:'shipping-note',taskId:'shipment',body:'Container note',author:'Dan'}]),taskAttachmentsCollection:collection([{attachmentId:'shipping-file',recordId:'shipment',recordType:'task',fileName:'shipping.pdf',storagePath:'synthetic'}]),taskStaffProfilesCollection:collection(),staffAuthorizationProfilesCollection:collection(),routinesCollection:collection(),taskNotificationsCollection:collection(),taskAccess:{subject:'dan',role:'admin'},taskAttachmentBucket:{file:()=>({getSignedUrl:async()=>['https://example.invalid/synthetic']})},now:()=> '2026-09-06T12:00:00Z'};
 return {deps,as:(subject,role='member',extra={})=>({...deps,taskAccess:{subject,role,...extra}})};
}

test('program grants cover descendants while Containers grants never expose Travel or the parent program',async()=>{
 const {deps,as}=fixture();
 assert.equal((await service.getProject({projectId:'program',includeDescendants:true},as('pastor','manager'))).hierarchy.projectCount,4);
 assert.equal((await service.getProject({projectId:'program',includeDescendants:true},as('pastor','manager'))).hierarchy.taskCounts.total,2);
 assert.deepEqual((await service.listProjects({},as('helper'))).projects.map(p=>p.projectId).sort(),['containers','january']);
 assert.deepEqual((await service.listTasks({},as('helper'))).tasks.map(t=>t.taskId),['shipment']);
 const branch=(await service.getProject({projectId:'containers',includeDescendants:true},as('helper'))).hierarchy;
 assert.equal(branch.taskCounts.total,1);assert.equal(JSON.stringify(branch).includes('flight'),false);
 assert.equal(branch.projects[0].path.some(p=>p.projectId==='program'),false);
 for(const projectId of ['program','travel']) await assert.rejects(service.getProject({projectId},as('helper')),{code:'task_access_denied'});
 await assert.rejects(service.getTask({taskId:'flight'},as('helper')),{code:'task_access_denied'});
 assert.equal((await service.listProjects({},as('unrelated','manager'))).count,0);
 assert.equal((await service.listTasks({},as('unrelated','manager'))).count,0);
 // Role aliases resolve the same grant; a title or a team alone never grants access.
 assert.equal((await service.listTasks({},as('new-helper','member',{subjects:['helper']}))).count,1);
 assert.equal((await service.listTasks({},as('unrelated','manager',{teamIds:['bhe'],teamEnforcementEnabled:false}))).count,0);
});

test('viewers can read notes/files but cannot edit, comment, create tasks or grant access',async()=>{
 const {as}=fixture();const reader=as('reader','manager');
 assert.equal((await service.listTaskNotes({taskId:'shipment'},reader)).count,1);
 assert.equal((await attachments.listTaskAttachments({recordType:'task',recordId:'shipment'},reader)).count,1);
 assert.match((await attachments.getTaskAttachmentDownload({attachmentId:'shipping-file'},reader)).download.url,/synthetic/);
 await assert.rejects(service.updateTask({taskId:'shipment',expectedVersion:1,changes:{title:'changed'}},reader),{code:'task_access_denied'});
 await assert.rejects(service.addTaskNote({taskId:'shipment',noteId:'new',body:'Changed',author:'Reader'},reader),{code:'task_access_denied'});
 await assert.rejects(service.createTask({taskId:'new',title:'New',projectId:'containers'},reader),{code:'task_access_denied'});
 await assert.rejects(attachments.attachTaskFile({recordType:'task',recordId:'shipment'},reader),{code:'task_access_denied'});
 await assert.rejects(service.updateProject({projectId:'containers',expectedVersion:1,changes:{branchMembers:[{subject:'reader',role:'editor'}]}},reader),{code:'task_access_denied'});
 for(const op of [()=>service.listTaskNotes({taskId:'shipment'},as('traveler')),()=>attachments.listTaskAttachments({recordType:'task',recordId:'shipment'},as('traveler')),()=>attachments.getTaskAttachmentDownload({attachmentId:'shipping-file'},as('traveler'))]) await assert.rejects(op(),{code:'task_access_denied'});
});

test('editors can work within their branch; sharing and moving branches require an owner',async()=>{
 const {deps,as}=fixture();const editor=as('helper');
 const task=await service.createTask({taskId:'new-task',title:'Another shipment',projectId:'january',visibility:'staff'},editor);
 assert.equal(task.task.visibility,'branch');
 assert.equal((await service.updateTask({taskId:'shipment',expectedVersion:1,changes:{title:'Shipment edited'}},editor)).task.title,'Shipment edited');
 assert.equal((await service.createProject({projectId:'february',name:'February',parentProjectId:'containers'},editor)).project.visibility,'branch');
 assert.equal((await service.updateProject({projectId:'january',expectedVersion:1,changes:{health:'on_track'}},editor)).project.health,'on_track');
 await assert.rejects(service.updateProject({projectId:'containers',expectedVersion:1,changes:{branchMembers:[]}},editor),{code:'project_sharing_denied'});
 await assert.rejects(service.updateProject({projectId:'containers',expectedVersion:1,changes:{parentProjectId:'travel'}},editor),{code:'project_sharing_denied'});
 await assert.rejects(service.createProject({name:'New private child',parentProjectId:'containers',visibility:'private'},editor),{code:'project_branch_visibility_conflict'});
 assert.equal((await service.listTasks({},as('traveler'))).tasks.some(t=>t.taskId==='new-task'),false);
});

test('grant removal takes effect on the next request and branch moves recalculate inherited grants',async()=>{
 const {deps,as}=fixture();
 await service.updateProject({projectId:'containers',expectedVersion:1,changes:{branchMembers:[]}},deps);
 assert.equal((await service.listTasks({},as('helper'))).count,0);
 await assert.rejects(attachments.getTaskAttachmentDownload({attachmentId:'shipping-file'},as('helper')),{code:'task_access_denied'});
 await service.updateProject({projectId:'january',expectedVersion:1,changes:{parentProjectId:'travel'}},deps);
 assert.equal((await service.listTasks({},as('traveler'))).count,2);
 assert.equal((await service.listTasks({},as('pastor','manager'))).count,2);
 const leadership=await service.buildLeadershipBrief({},as('traveler','manager'));
 assert.equal(leadership.summary.staffOpenTaskCount,2);
});

test('private tasks stay private and explicitly assigned outsiders get task-only access',async()=>{
 const {deps,as}=fixture();deps.tasksCollection.rows.set('private',{taskId:'private',projectId:'january',title:'Personal reminder',visibility:'private',ownerSub:'dan',version:1,status:'next',lifeArea:'work'});
 deps.tasksCollection.rows.get('shipment').assignedToSub='outsider';
 assert.equal((await service.listTasks({},as('pastor','manager'))).tasks.some(t=>t.taskId==='private'),false);
 assert.equal((await service.getTask({taskId:'shipment'},as('outsider'))).task.taskId,'shipment');
 assert.equal((await service.updateTask({taskId:'shipment',expectedVersion:1,changes:{status:'done'}},as('outsider'))).task.status,'done');
 await assert.rejects(service.getProject({projectId:'january'},as('outsider')),{code:'task_access_denied'});
});


test('opting a flat project into branch sharing restricts linked staff tasks without exposing its private tasks',async()=>{
 const {deps,as}=fixture();
 deps.projectsCollection.rows.set('legacy',{projectId:'legacy',name:'Legacy',visibility:'staff',ownerSub:'dan',lifeArea:'work',status:'active',version:1});
 deps.tasksCollection.rows.set('legacy-task',{taskId:'legacy-task',projectId:'legacy',title:'Former staff task',visibility:'staff',ownerSub:'dan',lifeArea:'work',status:'next',version:1});
 assert.equal((await service.listTasks({projectId:'legacy'},as('unrelated'))).count,1);
 await service.updateProject({projectId:'legacy',expectedVersion:1,changes:{visibility:'branch',branchMembers:[{subject:'helper',role:'editor'}]}},deps);
 assert.equal((await service.listTasks({projectId:'legacy'},as('unrelated'))).count,0);
 assert.equal((await service.listTasks({projectId:'legacy'},as('helper'))).count,1);
 delete deps.tasksCollection.rows.get('legacy-task').taskId;
 await assert.rejects(service.getTask({taskId:'legacy-task'},as('unrelated')),{code:'task_access_denied'});
});
