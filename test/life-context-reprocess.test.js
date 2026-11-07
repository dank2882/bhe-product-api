"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {fakeFirestore}=require("./helpers/maintenance-firestore");
const {collectContext,reprocessContext,getContextRun,getCurrentContext}=require("../lib/life-context-observations");
async function fixture(){
  const db=fakeFirestore(),at="2026-10-29T15:00:00.000Z",calls=[];
  const input={runId:"initial",expectedVersion:0,reason:"Fictional evidence",sources:[{source:"messages",status:"partial",windowStart:"2026-10-28T00:00:00.000Z",windowEnd:at,checkedAt:at,hasMore:true}],entries:[{id:"fixture",source:"messages",sourceReference:"fictional:1",sourceTime:"2026-10-29T14:00:00.000Z",identity:"provisional",text:"Mira: Is Friday okay? Dan: Yes, Friday."}]};
  const output={observations:[{text:"Dan agreed to Friday.",purposes:["brief","planning"],sourceIds:["fixture"],support:[{sourceId:"fixture",quote:input.entries[0].text}],certainty:"resolved_in_source"}]};
  const deps={firestoreDb:db,danOwnerSubjects:["dan"],taskAccess:{subject:"dan"},contextEnabled:true,contextMonthlyLimitMicros:1000000,contextDailyLimit:10,now:()=>at,generateContext:async p=>{calls.push(p);return{output};}};
  await collectContext(input,deps);
  const root=db.collection("danLifeContext").doc("observations"),saved=(await root.get()).data();
  await root.set({...saved,contentFingerprint:"older-prompt",observations:[{...saved.observations[0],text:"Older inaccurate interpretation"}]});
  return{db,deps,input,calls,root,saved,args:{runId:"reprocess-one",expectedVersion:1,reason:"Authorized prompt correction"}};
}
test("reprocess uses immutable original evidence, preserves coverage, returns no excerpts and supports exact replay",async()=>{
  const f=await fixture();const r=await reprocessContext(f.args,f.deps);
  assert.equal(r.status,"completed");assert.equal(r.version,2);assert.equal(r.reused,false);
  assert.deepEqual(r.origin,{operation:"reprocess",sourceVersion:1});
  assert.deepEqual(f.calls[1].entries,f.saved.entries);assert.deepEqual(f.calls[1].sources,f.saved.sources);
  assert(!JSON.stringify(f.calls[1]).includes("Older inaccurate interpretation"));
  assert.equal(f.calls[1].entries[0].sourceVersion,null);
  assert(!JSON.stringify(r).includes(f.input.entries[0].text));
  assert.equal((await reprocessContext(f.args,f.deps)).replayed,true);assert.equal(f.calls.length,2);
  assert.deepEqual((await getContextRun({runId:f.args.runId},f.deps)).origin,r.origin);
  assert(!JSON.stringify(await getCurrentContext({purposes:["brief"]},f.deps)).includes(f.input.entries[0].text));
  assert(![...f.db.rows.keys()].some(k=>k.startsWith("danLifeContext/profile")));
  const newer=await reprocessContext({...f.args,runId:"same-prompt",expectedVersion:2},f.deps);assert.equal(newer.reused,true);assert.equal(f.calls.length,2);
  // Original replay remains stable even after another current revision exists.
  assert.equal((await reprocessContext(f.args,f.deps)).version,2);
  for(const changes of [{reason:"different"},{expectedVersion:2}])await assert.rejects(reprocessContext({...f.args,...changes},f.deps),e=>e.code==="context_idempotency_conflict");
  await assert.rejects(collectContext({...f.args,entries:f.input.entries,sources:f.input.sources},f.deps),e=>e.code==="context_idempotency_conflict");
});
test("reprocess enforces authorization, disabled state, bounded intent and saved evidence before generation",async()=>{
  const f=await fixture(),blockedDb={collection(){throw Error("must not read evidence");}};
  await assert.rejects(reprocessContext(f.args,{...f.deps,taskAccess:{subject:"other"},firestoreDb:blockedDb}),e=>e.code==="life_context_access_denied");
  await assert.rejects(reprocessContext(f.args,{...f.deps,contextEnabled:false,firestoreDb:blockedDb}),e=>e.code==="context_disabled");
  for(const bad of [{...f.args,entries:[]},{...f.args,sources:[]},{...f.args,expectedVersion:0},{...f.args,reason:""}])await assert.rejects(reprocessContext(bad,f.deps));
  await assert.rejects(reprocessContext({...f.args,expectedVersion:99},f.deps),e=>e.code==="context_evidence_unavailable");
  await f.root.collection("revisions").doc("2").set({entries:[]});
  await assert.rejects(reprocessContext({...f.args,expectedVersion:2},f.deps),e=>e.code==="context_evidence_unavailable");
  assert.equal(f.calls.length,1);
});
test("stale versions and exhausted budgets do not trigger inference; failed replay never retries the provider",async()=>{
  const f=await fixture();await f.root.set({...f.saved,version:2});
  await assert.rejects(reprocessContext(f.args,f.deps),e=>e.code==="context_version_conflict");assert.equal(f.calls.length,1);
  const limited=await fixture();limited.deps.contextMonthlyLimitMicros=100000;
  assert.equal((await reprocessContext(limited.args,limited.deps)).code,"context_budget_exhausted");assert.equal(limited.calls.length,1);
  const failed=await fixture();let attempts=0;failed.deps.generateContext=async()=>{attempts++;throw Error("private provider payload");};
  await assert.rejects(reprocessContext(failed.args,failed.deps),e=>e.code==="context_processing_failed");
  const replay=await reprocessContext(failed.args,failed.deps);assert.equal(replay.status,"failed");assert.equal(attempts,1);assert(!JSON.stringify(replay).includes("private provider payload"));
  assert.equal((await getCurrentContext({purposes:["brief"]},failed.deps)).invalidatedBy,failed.args.runId);
});
test("concurrent reprocess replays do not duplicate inference or replace another run",async()=>{
  const f=await fixture();let entered,finish,calls=0;
  const started=new Promise(r=>entered=r),waiting=new Promise(r=>finish=r);
  f.deps.generateContext=async()=>{calls++;entered();await waiting;return{output:{observations:[]}};};
  const first=reprocessContext(f.args,f.deps);await started;
  assert.equal((await reprocessContext(f.args,f.deps)).status,"processing");
  await assert.rejects(reprocessContext({...f.args,runId:"competitor"},f.deps),e=>e.code==="context_busy");
  finish();assert.equal((await first).version,2);assert.equal(calls,1);
});
