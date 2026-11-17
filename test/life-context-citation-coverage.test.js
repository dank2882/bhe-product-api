"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {validateOutput,collectContext,getContextRun,getCurrentContext}=require("../lib/life-context-observations");
const {fakeFirestore}=require("./helpers/maintenance-firestore");
const at="2026-11-17T16:30:00.000Z";
function fixture(){
 const entries=[
  {id:"roster",text:"Riley: Rowan will play on Sunday."},
  {id:"omitted",text:"Riley: I confirmed that Ellis is unavailable Sunday."},
  {id:"reply",text:"Quinn: I can play the opener."}
 ].map(e=>({...e,source:"messages",sourceReference:`messages:fictional#${e.id}`,sourceTime:"2026-11-17T15:00:00Z",identity:"provisional"}));
 const claim=(sourceIds,text)=>({text,purposes:["planning"],certainty:"reported",sourceIds,support:sourceIds.map(id=>({sourceId:id,quote:entries.find(e=>e.id===id).text}))});
 const good=claim(["reply"],"Quinn agreed to play the opener.");
 const bad=claim(["roster","reply"],"Rowan will play, Ellis is unavailable, and Quinn agreed to the opener.");
 const input={runId:"fiction-citation",expectedVersion:0,reason:"Fictional citation coverage test",entries,sources:[{source:"messages",status:"complete",windowStart:"2026-11-16T16:30:00Z",windowEnd:at,checkedAt:at,hasMore:false}]};
 return {entries,claim,good,bad,input};
}
test("uncited roster detail is omitted before publication while valid summaries survive",()=>{
 const f=fixture(),out={observations:[f.bad,f.good]},before=structuredClone(out);
 const r=validateOutput(out,f,at);
 assert.deepEqual(r.validation,{status:"partial",candidateCount:2,acceptedCount:1,rejectedCount:1,rejections:[{stage:"validation",reason:"uncited_named_detail",observationIndex:0}]});
 assert.deepEqual(r.observations.map(x=>x.id),["observation-2"]);
 assert.equal(r.observations[0].text,f.good.text);assert.deepEqual(out,before);
 assert(!JSON.stringify(r.validation).includes("Ellis"));
});
test("explicit missing citation with exact support passes; citation without support still fails",()=>{
 const f=fixture();
 assert.equal(validateOutput({observations:[f.claim(["roster","omitted","reply"],f.bad.text)]},f,at).validation.status,"passed");
 assert.throws(()=>validateOutput({observations:[{...f.bad,sourceIds:["roster","omitted","reply"]}]},f,at),/Supporting excerpts/);
});
test("name at narrative start, reversed packet, changed certainty and possessive cannot evade coverage",()=>{
 for(const certainty of ["reported","tentative","confirmed_in_source","resolved_in_source"]){
  const f=fixture();f.entries.reverse();
  for(const text of ["Ellis is unavailable.","Ellis’s availability changed."])
   assert.throws(()=>validateOutput({observations:[{...f.bad,text,certainty}]},f,at),/Named detail/);
 }
});
test("ordinary sentence starters and supported sender attribution remain valid",()=>{
 const f=fixture();f.entries.push({...f.entries[0],id:"ordinary",text:"The office closes soon. Reports are ready."});
 const o=f.claim(["reply"],"The opener will be played by Quinn.");
 o.support[0].quote="I can play the opener.";
 assert.equal(validateOutput({observations:[o]},f,at).validation.status,"passed");
});
test("narrow guard does not claim to detect invented names absent from the whole packet",()=>{
 const f=fixture();
 assert.equal(validateOutput({observations:[{...f.good,text:"Avery agreed to the opener."}]},f,at).validation.status,"passed");
 // Independent semantic review is still mandatory; this limitation is explicit.
});
test("partial omission persists in receipts without checkpoint advance or another model call",async()=>{
 const f=fixture();let calls=0;
 const deps={firestoreDb:fakeFirestore(),danOwnerSubjects:["owner"],taskAccess:{subject:"owner"},contextEnabled:true,contextDailyLimit:1,contextMonthlyLimitMicros:1000000,now:()=>at,generateContext:async()=>{calls++;return{output:{observations:[f.bad,f.good]}};}};
 const r=await collectContext(f.input,deps),read=await getCurrentContext({purposes:["planning"]},deps);
 assert.equal(r.status,"completed");assert.equal(r.validation.rejections[0].reason,"uncited_named_detail");
 assert.deepEqual((await getContextRun({runId:f.input.runId},deps)).validation,r.validation);
 assert.deepEqual(read.lastCompleteSources,{});assert.equal(read.consecutiveRefreshFailures,0);
 assert.equal(read.observations.length,1);await collectContext(f.input,deps);assert.equal(calls,1);
});
test("all rejected stays a failed refresh with the existing next-day recovery action",async()=>{
 const f=fixture();const deps={firestoreDb:fakeFirestore(),danOwnerSubjects:["owner"],taskAccess:{subject:"owner"},contextEnabled:true,contextDailyLimit:1,contextMonthlyLimitMicros:1000000,now:()=>at,generateContext:async()=>({output:{observations:[f.bad]}})};
 await assert.rejects(collectContext(f.input,deps),{code:"context_processing_failed"});
 const r=await getContextRun({runId:f.input.runId},deps);
 assert.equal(r.status,"failed");assert.equal(r.failure.reason,"uncited_named_detail");assert.equal(r.recovery.action,"next_scheduled_day");
});
