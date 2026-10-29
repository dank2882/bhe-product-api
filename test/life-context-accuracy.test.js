"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const cases=require("./fixtures/life-context-accuracy.json");
const {fakeFirestore}=require("./helpers/maintenance-firestore");
const {stableStringify}=require("../lib/workspace-operation-execution");
const {normalizeOutput,collectContext,getCurrentContext,getContextRun}=require("../lib/life-context-observations");
const {generateContextWithVertex,PROMPT_VERSION}=require("../lib/life-context-vertex");
const at="2026-10-29T18:00:00.000Z";
function fixture(){
  const packet={runId:"fictional-accuracy",expectedVersion:0,reason:"Fictional offline validation",sources:[{source:"messages",status:"partial",windowStart:"2026-10-28T18:00:00.000Z",windowEnd:at,checkedAt:at,hasMore:true}],entries:cases.entries.map(e=>({...e,source:"messages",sourceReference:`fictional:${e.id}`,sourceTime:"2026-10-29T17:00:00.000Z",identity:"provisional"}))};
  const output=structuredClone(cases.expected),db=fakeFirestore();let calls=0;
  const deps={firestoreDb:db,danOwnerSubjects:["fixture-owner"],taskAccess:{subject:"fixture-owner"},contextEnabled:true,contextMonthlyLimitMicros:200000,now:()=>at,generateContext:async()=>{calls++;return {output,model:{id:"fixture-provider",promptVersion:PROMPT_VERSION}};}};
  return {packet,output,db,deps,calls:()=>calls};
}
test("fictional reference output survives adapter, publication and selective retrieval without exposing support quotes",async()=>{
  const f=fixture();let providerRequest;
  const auth={getClient:async()=>({request:async request=>{providerRequest=request;return {data:{candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(f.output)}]}}]}};}})};
  f.deps.generateContext=packet=>generateContextWithVertex(packet,{auth,projectId:"fictional-project",at});
  const receipt=await collectContext(f.packet,f.deps);assert.equal(receipt.status,"completed");
  const requestPacket=JSON.parse(providerRequest.data.contents[0].parts[0].text);
  assert.deepEqual(requestPacket.entries.map(e=>e.text),cases.entries.map(e=>e.text).sort((a,b)=>cases.entries.find(x=>x.text===a).id.localeCompare(cases.entries.find(x=>x.text===b).id)));
  const read=await getCurrentContext({purposes:["planning"]},f.deps);
  assert.deepEqual(read.observations.map(o=>o.text),f.output.observations.filter(o=>o.purposes.includes("planning")).map(o=>o.text));
  assert(read.observations.some(o=>o.citations.some(c=>c.id==="request")&&o.citations.some(c=>c.id==="reply")));
  assert(!JSON.stringify(read).includes('"quote"'));assert(!JSON.stringify(read).includes('"support"'));
  assert.equal((await getCurrentContext({purposes:["brief"]},f.deps)).observations.length,1);
  assert.equal((await f.db.collection("danLifeContext").doc("observations").get()).data().model.promptVersion,"life-context-observations-v3");
  assert(!f.db.rows.has("danLifeContext/profile"));
});
test("invented relationship quotations fail publication and leave no new observation revision",async()=>{
  const f=fixture();f.output.observations[2].text="Jules reports her daughter has an injured ankle.";
  f.output.observations[2].support[0].quote="My daughter has an injured ankle.";
  await assert.rejects(collectContext(f.packet,f.deps),e=>e.code==="context_processing_failed");
  assert.equal((await getContextRun({runId:f.packet.runId},f.deps)).status,"failed");
  assert.equal((await getCurrentContext({purposes:["brief"]},f.deps)).version,0);
  assert(!f.db.rows.has("danLifeContext/observations/revisions/1"));
});
test("every cited source needs its own exact quote; quotes cannot be swapped, stitched or borrowed",()=>{
  for(const mutate of [
    o=>{delete o.support;},
    o=>{o.support.pop();},
    o=>{o.support[1]={...o.support[0]};},
    o=>{o.support[0].sourceId="budget";},
    o=>{o.support[0].quote="Yes, Friday works.";},
    o=>{o.support[0].quote="Could you review ... Friday?";},
    o=>{o.support[0].quote=" ";},
    o=>{o.support[0].quote="x".repeat(401);}
  ]){const f=fixture(),o=f.output.observations[4];mutate(o);assert.throws(()=>normalizeOutput({observations:[o]},f.packet,at));}
});
test("a year in timestamps or uncited adjacent evidence cannot supply a generated observation year",()=>{
  const f=fixture(),o=f.output.observations[3];
  for(const year of ["2031","2026"]){o.text=`Mira's tentative workshop is January 12, ${year}.`;assert.throws(()=>normalizeOutput({observations:[o]},f.packet,at),e=>e.code==="context_invalid_output");}
  const budget={text:"Jules reports a tight building budget for 2031.",purposes:["planning"],certainty:"reported",sourceIds:["budget"],support:[{sourceId:"budget",quote:f.packet.entries.find(e=>e.id==="budget").text}]};
  assert.equal(normalizeOutput({observations:[budget]},f.packet,at).length,1);
});
test("a prompt upgrade bypasses legacy content reuse only for a newly authorized run, not exact replay",async()=>{
  const f=fixture();await collectContext(f.packet,f.deps);
  const ref=f.db.collection("danLifeContext").doc("observations"),state=(await ref.get()).data();
  state.contentFingerprint=createHash("sha256").update(stableStringify({entries:state.entries,coverage:state.sources.map(s=>({source:s.source,status:s.status,hasMore:s.hasMore}))})).digest("hex");
  state.model.promptVersion="life-context-observations-v2";await ref.set(state);
  assert.equal((await collectContext(f.packet,f.deps)).replayed,true);assert.equal(f.calls(),1);
  const next=await collectContext({...f.packet,runId:"fictional-reviewed-upgrade",expectedVersion:1},f.deps);
  assert.equal(next.reused,false);assert.equal(f.calls(),2);
  const reuse=await collectContext({...f.packet,runId:"fictional-v3-reuse",expectedVersion:2},f.deps);
  assert.equal(reuse.reused,true);assert.equal(f.calls(),2);
});
test("exact excerpts alone are not a semantic verifier: faithful event/date association still needs model evaluation",()=>{
  const f=fixture();const conflated={...f.output.observations[0],text:"Mira proposes a retreat June 2-4 including the celebration.",support:[{sourceId:"trip",quote:f.packet.entries.find(e=>e.id==="trip").text}]};
  // Deliberately document the guard's limit instead of claiming canned model
  // output demonstrates that v3 has solved semantic generation errors.
  assert.equal(normalizeOutput({observations:[conflated]},f.packet,at).length,1);
});
test("backend rejects oversized model arrays independently of provider schema bounds",()=>{
  const f=fixture();
  assert.throws(()=>normalizeOutput({observations:Array.from({length:21},()=>structuredClone(f.output.observations[0]))},f.packet,at),e=>e.code==="context_invalid_output");
  const entries=Array.from({length:7},(_,i)=>({...f.packet.entries[0],id:`extra-${i}`}));
  const observation={...f.output.observations[0],sourceIds:entries.map(e=>e.id),support:entries.map(e=>({sourceId:e.id,quote:e.text}))};
  assert.throws(()=>normalizeOutput({observations:[observation]},{...f.packet,entries},at),e=>e.code==="context_invalid_output");
});
