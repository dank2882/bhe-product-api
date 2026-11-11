"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {fakeFirestore}=require("./helpers/maintenance-firestore");
const {collectContext:collect,getCurrentContext:get,getContextRun:run,normalizeOutput}=require("../lib/life-context-observations");
function fixture(){
 let at="2026-11-10T17:00:00.000Z",calls=0;
 const db=fakeFirestore(),entry={id:"fiction",source:"messages",identity:"provisional",sourceReference:"fictional:1",sourceTime:"2026-11-10T16:00:00.000Z",text:"Nora: The arrangement is tentative."};
 const input={runId:"initial",expectedVersion:0,reason:"Fictional refresh test",entries:[entry],sources:[{source:"messages",status:"partial",windowStart:"2026-11-09T17:00:00.000Z",windowEnd:at,checkedAt:at,hasMore:true}]};
 const output={observations:[{text:"Nora reports a tentative arrangement.",purposes:["planning"],sourceIds:[entry.id],support:[{sourceId:entry.id,quote:entry.text}],certainty:"tentative"}]};
 const deps={firestoreDb:db,danOwnerSubjects:["dan"],taskAccess:{subject:"dan"},contextEnabled:true,contextDailyLimit:10,contextMonthlyLimitMicros:1000000,now:()=>at,generateContext:async()=>{calls++;return{output};}};
 return {db,input,output,deps,time:v=>at=v,calls:()=>calls};
}
test("exact 408 and 2000 character quotes pass; altered quotes and 2001 characters fail without truncation",()=>{
 for(const length of [408,2000]){
  const f=fixture();f.input.entries[0].text="Nora: "+"a".repeat(length-6);f.output.observations[0].support[0].quote=f.input.entries[0].text;
  assert.equal(normalizeOutput(f.output,f.input,"2026-11-10T17:00:00Z").length,1);
  f.output.observations[0].support[0].quote="X"+f.input.entries[0].text.slice(1);
  assert.throws(()=>normalizeOutput(f.output,f.input,"2026-11-10T17:00:00Z"),/Unsupported evidence/);
 }
 const f=fixture();f.output.observations[0].support[0].quote="a".repeat(2001);
 assert.throws(()=>normalizeOutput(f.output,f.input,"2026-11-10T17:00:00Z"));
});
test("failed refresh preserves original observations, timestamps and expiry; replay cannot increase failure count",async()=>{
 const f=fixture();await collect(f.input,f.deps);const before=await get({purposes:["planning"]},f.deps);
 f.output.observations[0].support[0].quote="invented";
 const next={...f.input,runId:"day-two",expectedVersion:1,entries:[{...f.input.entries[0],text:"Nora: Updated tentative arrangement."}]};
 await assert.rejects(collect(next,f.deps));const after=await get({purposes:["planning"]},f.deps);
 assert.deepEqual(after.observations,before.observations);assert.equal(after.observedAt,before.observedAt);assert.equal(after.invalidatedBy,null);assert.equal(after.refreshStatus,"failed");
 assert.equal((await run({runId:next.runId},f.deps)).recovery.action,"next_scheduled_day");
 await collect(next,f.deps);assert.equal(f.calls(),2);assert.equal((await get({purposes:["planning"]},f.deps)).consecutiveRefreshFailures,1);
 f.time("2026-11-11T17:00:01Z");assert.equal((await get({purposes:["planning"]},f.deps)).observations.length,0);
 assert.equal((await get({purposes:["planning"]},f.deps)).expiredCount,1);
});
test("two consecutive rejected refreshes require review; success resets count and unknown failures pause immediately",async()=>{
 const f=fixture();await collect(f.input,f.deps);f.output.observations[0].support[0].quote="invented";
 const next={...f.input,expectedVersion:1,entries:[{...f.input.entries[0],text:"Nora: Updated tentative arrangement."}]};
 for(const runId of ["failed-one","failed-two"])await assert.rejects(collect({...next,runId},f.deps));
 assert.deepEqual((await run({runId:"failed-two"},f.deps)).recovery,{action:"pause_for_review",consecutiveFailures:2,sameDayRetry:false});
 f.output.observations[0].support[0].quote=next.entries[0].text;
 await collect({...next,runId:"reviewed-recovery"},f.deps);assert.equal((await get({purposes:["planning"]},f.deps)).consecutiveRefreshFailures,0);
 f.deps.generateContext=async()=>{throw Error("private provider error");};
 await assert.rejects(collect({...next,runId:"provider-fail",expectedVersion:2,entries:[{...next.entries[0],text:"changed"}]},f.deps));
 assert.equal((await run({runId:"provider-fail"},f.deps)).recovery.action,"pause_for_review");
});
test("budget rejection preserves good refresh state; correction invalidates even when budget prevents generation",async()=>{
 const f=fixture();await collect(f.input,f.deps);f.deps.contextMonthlyLimitMicros=100000;
 const next={...f.input,expectedVersion:1,entries:[{...f.input.entries[0],text:"Nora: Changed arrangement."}]};
 assert.equal((await collect({...next,runId:"budget-refresh"},f.deps)).code,"context_budget_exhausted");
 assert.equal((await get({purposes:["planning"]},f.deps)).observations.length,1);
 await collect({...next,runId:"budget-correction",intent:"correction"},f.deps);
 assert.equal((await get({purposes:["planning"]},f.deps)).invalidatedBy,"budget-correction");
 await collect({...next,runId:"later-refresh"},f.deps);
 assert.equal((await get({purposes:["planning"]},f.deps)).invalidatedBy,"budget-correction");
 assert.equal(f.calls(),1);
});

test("invalidated snapshots cannot be revived through content reuse",async()=>{
 const f=fixture();await collect(f.input,f.deps);
 const ref=f.db.collection("danLifeContext").doc("observations"),state=(await ref.get()).data();
 await ref.set({...state,invalidatedBy:"reviewed-semantic-failure"});
 f.deps.generateContext=async()=>{throw Error("provider unavailable");};
 await assert.rejects(collect({...f.input,runId:"refresh-same-evidence",expectedVersion:1},f.deps));
 const after=await get({purposes:["planning"]},f.deps);assert.equal(after.invalidatedBy,"reviewed-semantic-failure");assert.equal(after.observations.length,0);
});
