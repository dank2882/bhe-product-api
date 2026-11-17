"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../lib/think-tank-service');
const {runTaskManagementOperation, listTaskManagementOperations} = require('../lib/task-management-operation-registry');
class Collection {
 constructor() { this.store = new Map(); }
 doc(id) { return { get: async()=>({exists:this.store.has(id),data:()=>structuredClone(this.store.get(id))}),create:async v=>{if(this.store.has(id))throw Error('exists');this.store.set(id,structuredClone(v));},set:async v=>this.store.set(id,structuredClone(v)) }; }
 limit(n) { return {get:async()=>({docs:[...this.store].slice(0,n).map(([id,v])=>({id,data:()=>structuredClone(v)}))})}; }
}
function deps(){let id=0;return {thinkTankEntriesCollection:new Collection(),thinkTankReflectionsCollection:new Collection(),taskAccess:{subject:'test|dan',subjects:['test|dan'],name:'Dan',role:'admin'},randomUUID:()=>String(++id),now:()=> '2026-11-17T22:00:00.000Z'};}
test('dedicated list uses metadata, preserves source and separates dates',async()=>{
 const x=deps();await d.captureThinkTankEntry({exactText:'not a decision',topics:['Decision Desk']},x);
 const {thought}=await d.captureDecision({exactText:'  Original\nwords ',phase:'shaping',reviewDate:'2026-11-20',deadline:'2026-12-01'},x);
 const list=await d.listDecisions({},x);assert.equal(list.totalCount,1);assert.equal(list.entries[0].exactText,'  Original\nwords ');
 assert.deepEqual((await d.getDecision({thoughtId:thought.thoughtId},x)).thought.decisionDesk,{phase:'shaping',reviewDate:'2026-11-20',deadline:'2026-12-01'});
});
test('enrollment preserves identity, original source, notes and triage status',async()=>{
 const x=deps();const {thought}=await d.captureThinkTankEntry({exactText:'old source'},x);
 await d.appendThinkTankReflection({thoughtId:thought.thoughtId,exactText:'old note'},x);
 const r=await d.updateDecision({thoughtId:thought.thoughtId,expectedVersion:1,changes:{phase:'shaping',reviewDate:'2026-11-20'}},x);
 assert.equal(x.thinkTankEntriesCollection.store.size,1);assert.equal(r.thought.status,'inbox');assert.equal(r.thought.exactText,'old source');
 assert.equal((await d.listDecisionNotes({thoughtId:thought.thoughtId},x)).reflections[0].exactText,'old note');
});
test('all phase transitions are labels with no approvals and no task side effects',async()=>{
 const x=deps();let {thought}=await d.captureDecision({exactText:'idea'},x);
 for(const phase of ['decided','blue_sky','sarah_review','parked','ready_to_decide','shaping']){
  ({thought}=await d.updateDecision({thoughtId:thought.thoughtId,expectedVersion:thought.version,changes:{phase}},x));assert.equal(thought.decisionDesk.phase,phase);assert.equal(thought.status,'inbox');
 }
 assert.equal(x.thinkTankEntriesCollection.store.size,1);assert.equal(x.thinkTankReflectionsCollection.store.size,0);
});
test('invalid dates, stale versions and unsupported changes fail without mutation',async()=>{
 const x=deps();for(const reviewDate of ['2026-02-30','tomorrow',123]) await assert.rejects(()=>d.captureDecision({exactText:'x',reviewDate},x));
 const {thought}=await d.captureDecision({exactText:'source',reviewDate:'2026-11-20'},x);
 await assert.rejects(()=>d.updateDecision({thoughtId:thought.thoughtId,expectedVersion:9,changes:{phase:'decided'}},x),{code:'think_tank_version_conflict'});
 await assert.rejects(()=>d.updateDecision({thoughtId:thought.thoughtId,expectedVersion:1,changes:{exactText:'replacement'}},x));
 const cleared=await d.updateDecision({thoughtId:thought.thoughtId,expectedVersion:1,changes:{reviewDate:null}},x);assert.equal(cleared.thought.decisionDesk.reviewDate,'');
});
test('private decisions and notes remain inaccessible to unrelated administrators',async()=>{
 const x=deps();const {thought}=await d.captureDecision({exactText:'private'},x);
 const stranger={...x,taskAccess:{subject:'test|other',subjects:['test|other'],role:'admin'}};
 assert.equal((await d.listDecisions({},stranger)).totalCount,0);
 for(const fn of [d.getDecision,d.listDecisionNotes,d.appendDecisionNote])await assert.rejects(()=>fn({thoughtId:thought.thoughtId,exactText:'intrusion'},stranger),{statusCode:403});
 await assert.rejects(()=>d.updateDecision({thoughtId:thought.thoughtId,expectedVersion:1,changes:{phase:'decided'}},stranger),{statusCode:403});
});
test('pagination and due-date filtering operate on decision membership before paging',async()=>{
 const x=deps();await d.captureThinkTankEntry({exactText:'ordinary'},x);
 for(let i=0;i<3;i++)await d.captureDecision({exactText:'decision '+i,phase:i===2?'parked':'shaping',reviewDate:i===0?'2026-11-20':'2026-11-21'},x);
 const a=await d.listDecisions({limit:2},x);const b=await d.listDecisions({limit:2,cursor:a.nextCursor},x);
 assert.equal(a.totalCount,3);assert.equal(a.moreAvailable,true);assert.equal(b.complete,true);assert.equal(new Set([...a.entries,...b.entries].map(x=>x.thoughtId)).size,3);
 assert.equal((await d.listDecisions({reviewDueBy:'2026-11-20'},x)).totalCount,1);
 assert.equal((await d.listDecisions({phase:'parked'},x)).totalCount,1);
});
test('notes retain exact words and authenticated attribution',async()=>{
 const x=deps();const {thought}=await d.captureDecision({exactText:'source'},x);
 await d.appendDecisionNote({thoughtId:thought.thoughtId,exactText:'  note\n ',author:'Sarah'},x);
 const notes=await d.listDecisionNotes({thoughtId:thought.thoughtId},x);assert.equal(notes.reflections[0].exactText,'  note\n ');assert.equal(notes.reflections[0].author,'Dan');
});
test('live operation registry exposes Decision Desk guidance and operations',async()=>{
 const r=await runTaskManagementOperation({operation:'getDecisionDeskContext',mode:'query',arguments:{}},deps());
 assert.match(JSON.stringify(r),/listDecisions/);
});
