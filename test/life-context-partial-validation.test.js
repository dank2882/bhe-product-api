"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {fakeFirestore}=require("./helpers/maintenance-firestore");
const {collectContext:collect,getContextRun:run,getCurrentContext:get,validateOutput}=require("../lib/life-context-observations");
const at="2026-11-11T17:00:00.000Z";
function fixture(){
 const entry={id:"fiction",source:"messages",sourceReference:"fictional:1",sourceTime:"2026-11-11T16:00:00.000Z",identity:"provisional",text:"Mira: The visit is tentative. She has not set a time. Dad might join."};
 const input={runId:"partial-fiction",expectedVersion:0,reason:"Fictional partial-validation test",sources:[{source:"messages",status:"complete",windowStart:"2026-11-10T17:00:00Z",windowEnd:at,checkedAt:at,hasMore:false}],entries:[entry]};
 const good={text:"Mira reports a tentative visit with no time set.",purposes:["brief","planning"],sourceIds:[entry.id],support:[{sourceId:entry.id,quote:entry.text}],certainty:"tentative"};
 const output={observations:[structuredClone(good)]};let calls=0,time=at;
 const db=fakeFirestore(),deps={firestoreDb:db,danOwnerSubjects:["owner"],taskAccess:{subject:"owner"},contextEnabled:true,contextDailyLimit:10,contextMonthlyLimitMicros:1000000,now:()=>time,generateContext:async()=>{calls++;return{output};}};
 return {input,output,good,db,deps,calls:()=>calls,time:t=>time=t};
}
test("mixed validity publishes only unchanged valid observations with durable omission metadata",async()=>{
 const f=fixture();
 f.output.observations=[{...f.good,text:"Mira says she has no time set."},structuredClone(f.good),{...f.good,support:[{sourceId:"fiction",quote:"invented private wording"}]}];
 const before=structuredClone(f.output),receipt=await collect(f.input,f.deps);
 assert.equal(receipt.status,"completed");assert.equal(f.calls(),1);
 assert.deepEqual(f.output,before);
 assert.deepEqual(receipt.validation,{status:"partial",candidateCount:3,acceptedCount:1,rejectedCount:2,rejections:[
  {stage:"validation",reason:"narrative_pronoun",observationIndex:0,issue:"gendered_narrative",pronounCount:1},
  {stage:"validation",reason:"unsupported_quote",observationIndex:2,supportIndex:0,issue:"quote_not_exact",evidenceIndex:0,quoteLength:24}
 ]});
 const read=await get({purposes:["planning"]},f.deps);
 assert.deepEqual(read.validation,receipt.validation);assert.deepEqual((await run({runId:f.input.runId},f.deps)).validation,receipt.validation);
 assert.equal(read.observations.length,1);assert.equal(read.observations[0].id,"observation-2");assert.equal(read.observations[0].text,f.good.text);
 assert.deepEqual(read.lastCompleteSources,{}); // Summary omissions cannot advance a complete checkpoint.
 assert.equal(read.refreshStatus,"current");assert.equal(read.consecutiveRefreshFailures,0);
 assert(!JSON.stringify([...f.db.rows]).includes("invented private wording"));
 assert(!JSON.stringify(read.validation).includes("Mira"));
 assert.equal((await get({purposes:["preaching"]},f.deps)).validation.rejectedCount,2);
 assert.equal((await collect(f.input,f.deps)).replayed,true);assert.equal(f.calls(),1);
 const reused=await collect({...f.input,runId:"reuse-partial",expectedVersion:1},f.deps);
 assert.equal(reused.reused,true);assert.deepEqual(reused.validation,receipt.validation);assert.equal(f.calls(),1);
 assert.deepEqual((await get({purposes:["planning"]},f.deps)).observations,read.observations);
 f.time("2026-11-12T17:00:01Z");assert.equal((await get({purposes:["planning"]},f.deps)).observations.length,0);
});
test("all rejected still fails, retains previous expiry, and obeys repeated failure policy",async()=>{
 const f=fixture();await collect(f.input,f.deps);const prior=await get({purposes:["planning"]},f.deps);
 f.output.observations=[{...f.good,text:"Mira says she will come."}];
 const changed={...f.input,expectedVersion:1,entries:[{...f.input.entries[0],text:f.input.entries[0].text+" Update."}]};
 for(const [i,action] of [[1,"next_scheduled_day"],[2,"pause_for_review"]]){
  const runId="rejected-"+i;await assert.rejects(collect({...changed,runId},f.deps));
  const receipt=await run({runId},f.deps);assert.equal(receipt.status,"failed");assert.equal(receipt.recovery.action,action);
  assert.deepEqual((await get({purposes:["planning"]},f.deps)).observations,prior.observations);
 }
 assert.equal(f.calls(),3);assert(!f.db.rows.has("danLifeContext/observations/revisions/2"));
});
test("each local validation check remains enforced in mixed output",()=>{
 const f=fixture();
 for(const bad of [null,{...f.good,extra:"ignored"},{...f.good,purposes:["invented"]},{...f.good,certainty:"approved"},{...f.good,text:"x".repeat(601)},{...f.good,sourceIds:["unknown"]},{...f.good,support:[]},{...f.good,text:"Mira's dad will join."},{...f.good,text:"The visit is in 2031."}]){
  const r=validateOutput({observations:[bad,f.good]},f.input,at);
  assert.equal(r.validation.rejectedCount,1);assert.equal(r.observations.length,1);assert.equal(r.observations[0].text,f.good.text);
 }
 for(const malformed of [null,{}, {observations:{}},{observations:[f.good],extra:true},{observations:Array(21).fill(f.good)}])assert.throws(()=>validateOutput(malformed,f.input,at));
});
test("unexpected validator errors and missing provider output are never converted to partial success",async()=>{
 const f=fixture();const bad={...f.good};Object.defineProperty(bad,"text",{get(){throw Error("unexpected-private-detail");},enumerable:true});
 assert.throws(()=>validateOutput({observations:[f.good,bad]},f.input,at),/unexpected-private-detail/);
 f.deps.generateContext=async()=>null;
 await assert.rejects(collect(f.input,f.deps));const receipt=await run({runId:f.input.runId},f.deps);
 assert.equal(receipt.failure.reason,"invalid_response");assert.equal(receipt.recovery.action,"pause_for_review");
});
test("empty model output is a valid empty snapshot, distinct from all candidates rejected",async()=>{
 const f=fixture();f.output.observations=[];const receipt=await collect(f.input,f.deps);
 assert.deepEqual(receipt.validation,{status:"passed",candidateCount:0,acceptedCount:0,rejectedCount:0,rejections:[]});
 assert.equal(receipt.status,"completed");assert.equal(f.calls(),1);
});
test("malformed envelopes fail the entire run and require review even with a valid member",async()=>{
 for(const output of [{observations:[] , extra:"private-provider-extra"},{observations:{}},{observations:Array(21).fill(fixture().good)}]){
  const f=fixture();f.deps.generateContext=async()=>({output});
  await assert.rejects(collect(f.input,f.deps));
  const receipt=await run({runId:f.input.runId},f.deps);
  assert.equal(receipt.status,"failed");assert.equal(receipt.recovery.action,"pause_for_review");
  assert(!JSON.stringify([...f.db.rows]).includes("private-provider-extra"));
 }
});
