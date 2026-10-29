"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { collectContext:collect,getCurrentContext:get,getContextRun:run } = require("../lib/life-context-observations");
const { generateContextWithVertex } = require("../lib/life-context-vertex");
function fixture() {
  let calls = 0, time = "2026-10-29T15:00:00.000Z";
  const db = fakeFirestore(), input = { runId:"synthetic-20261029",expectedVersion:0,reason:"Fictional bounded source trial",sources:[{ source:"messages",status:"partial",windowStart:"2026-10-28T07:00:00Z",windowEnd:"2026-10-29T15:00:00Z",checkedAt:time,hasMore:true }],entries:[{ id:"sample",source:"messages",sourceReference:"synthetic:conversation:1",sourceTime:"2026-10-29T14:00:00Z",identity:"provisional",text:"Fictional colleague: I may work remotely Friday. Reply: That works." }] };
  const output = { observations:[{ text:"Fictional remote-work arrangement was acknowledged; no unanswered reply is evident.", purposes:["brief","planning"],sourceIds:["sample"],support:[{sourceId:"sample",quote:input.entries[0].text}],certainty:"resolved_in_source" }] };
  const deps = { firestoreDb:db, danOwnerSubjects:["dan"],taskAccess:{subject:"dan"},contextEnabled:true,contextMonthlyLimitMicros:2000000,now:()=>time,generateContext:async()=>{ calls++; return { output,model:{id:"synthetic"},usage:{totalTokenCount:100} }; } };
  return { db,input,output,deps,calls:()=>calls,time:t=>{time=t;} };
}
test("uninitialized reads are empty and side effect free; authorization precedes every storage/provider access",async()=>{
  const f=fixture(); assert.equal((await get({purposes:["planning"]},f.deps)).setupRequired,true); assert.equal(f.db.rows.size,0);
  for(const subject of ["","sarah","admin"]) {
    const d={...f.deps,taskAccess:{subject,subjects:["dan"],role:"admin"},firestoreDb:{collection(){throw Error("must not access");}}};
    for(const op of [()=>collect(f.input,d),()=>get({purposes:["brief"]},d),()=>run({runId:f.input.runId},d)]) await assert.rejects(op,e=>e.code==="life_context_access_denied");
  }
  await assert.rejects(collect(f.input,{...f.deps,contextEnabled:false}),e=>e.code==="context_disabled");
  assert.equal(f.calls(),0);assert.equal(f.db.rows.size,0);
});
test("one run publishes provisional cited observations, retrieves selectively, and never creates a profile",async()=>{
  const f=fixture(), result=await collect(f.input,f.deps); assert.equal(result.version,1);
  const read=await get({purposes:["planning"]},f.deps);
  assert.equal(read.observations[0].approvalState,"provisional"); assert.equal(read.observations[0].citations[0].identity,"provisional");
  assert.equal(read.sources[0].status,"partial"); assert(read.uncheckedSources.includes("care"));
  assert.equal((await get({purposes:["preaching"]},f.deps)).observations.length,0);
  assert(!JSON.stringify(read).includes(f.input.entries[0].text));
  assert(![...f.db.rows.keys()].some(k=>k.startsWith("danLifeContext/profile")));
  assert.equal((await run({runId:f.input.runId},f.deps)).status,"completed");
});
test("idempotency binds actor and complete intent; same content across new runs skips generation without refreshing expiry",async()=>{
  const f=fixture();await collect(f.input,f.deps);
  assert.equal((await collect(f.input,f.deps)).replayed,true);assert.equal(f.calls(),1);
  await assert.rejects(collect({...f.input,reason:"changed"},f.deps),e=>e.code==="context_idempotency_conflict");
  f.time("2026-10-30T15:01:00Z");
  const same=await collect({...f.input,runId:"synthetic-next",expectedVersion:1},f.deps);
  assert.equal(same.reused,true);assert.equal(f.calls(),1);
  const read=await get({purposes:["brief"]},f.deps);assert.equal(read.expiredCount,1);assert.equal(read.observations.length,0);
});
test("concurrent requests and in-flight replays call the model only once",async()=>{
  const f=fixture();let release,entered;
  const waiting=new Promise(r=>entered=r), provider=new Promise(r=>release=r);
  f.deps.generateContext=async()=>{entered();await provider;return {output:f.output};};
  const first=collect(f.input,f.deps);await waiting;
  assert.equal((await collect(f.input,f.deps)).status,"processing");
  await assert.rejects(collect({...f.input,runId:"competitor"},f.deps),e=>e.code==="context_busy");
  release();await first;
  await assert.rejects(collect({...f.input,runId:"stale-version"},f.deps),e=>e.code==="context_version_conflict");
});
test("correction recomputes from evidence and immediately invalidates old observations even if processing fails",async()=>{
  const f=fixture();await collect(f.input,f.deps);
  f.deps.generateContext=async packet=>{assert.equal(packet.entries[0].text,"Correction: arrangement canceled.");assert(!JSON.stringify(packet).includes("AI interpretation"));throw Error("private provider payload");};
  const corrected={...f.input,runId:"correction",expectedVersion:1,reason:"Explicit correction",entries:[{...f.input.entries[0],text:"Correction: arrangement canceled."}]};
  await assert.rejects(collect(corrected,f.deps),e=>e.code==="context_processing_failed"&&!e.message.includes("private"));
  const read=await get({purposes:["planning"]},f.deps);assert.equal(read.invalidatedBy,"correction");assert.equal(read.observations.length,0);
  assert.equal((await collect(corrected,f.deps)).status,"failed");
  const history=await get({purposes:["planning"],version:1},f.deps);assert.equal(history.auditOnly,true);assert.equal(history.observations.length,1);
  f.time("2026-10-30T15:00:00Z"); // The failed repair consumed the second daily allowance.
  f.deps.generateContext=async()=>({output:{observations:[]}});
  await collect({...corrected,runId:"correction-reviewed-retry"},f.deps);
  assert.equal((await get({purposes:["brief"]},f.deps)).version,2);
});
test("budget reservations persist on failures, daily limits and monthly hard stop prevent extra inference",async()=>{
  const f=fixture();f.deps.contextMonthlyLimitMicros=100000;f.deps.generateContext=async()=>{throw Error("timeout");};
  await assert.rejects(collect(f.input,f.deps));
  assert.equal((await collect({...f.input,runId:"another"},f.deps)).code,"context_budget_exhausted");
  const g=fixture();await collect(g.input,g.deps);
  const change=n=>({...g.input,runId:`change-${n}`,expectedVersion:n,entries:[{...g.input.entries[0],text:`changed-${n}`}]});
  g.output.observations[0].support[0].quote="changed-1";
  await collect(change(1),g.deps);assert.equal((await collect(change(2),g.deps)).code,"context_budget_exhausted");
  assert.equal((await get({purposes:["planning"]},g.deps)).observations.length,0);
});
test("invalid citations and malformed output cannot be published; model instructions do not grant writes",async()=>{
  const f=fixture();f.output.observations[0].sourceIds=["invented"];
  await assert.rejects(collect(f.input,f.deps),e=>e.code==="context_processing_failed");
  assert.equal((await get({purposes:["brief"]},f.deps)).version,0);
  assert.equal((await run({runId:f.input.runId},f.deps)).status,"failed");
});
test("explicit daily allowance permits reviewed extra attempts without resetting counters or bypassing monthly budget",async()=>{
  const f=fixture();f.deps.contextDailyLimit=3;
  f.deps.generateContext=async()=>{throw Error("bounded failure");};
  for(let i=0;i<3;i++) await assert.rejects(collect({...f.input,runId:`reviewed-${i}`},f.deps),e=>e.code==="context_processing_failed");
  assert.equal((await collect({...f.input,runId:"fourth-denied"},f.deps)).code,"context_budget_exhausted");
  assert.equal((await f.db.collection("danLifeContext").doc("observations").collection("days").doc("2026-10-29").get()).data().calls,3);
  const g=fixture();g.deps.contextDailyLimit=3;g.deps.contextMonthlyLimitMicros=100000;
  g.deps.generateContext=async()=>{throw Error("bounded failure");};
  await assert.rejects(collect(g.input,g.deps));
  assert.equal((await collect({...g.input,runId:"monthly-denied"},g.deps)).code,"context_budget_exhausted");
});
test("invalid daily allowances fail before writing receipts or calling a provider",async()=>{
  for(const value of [0,-1,1.5,11,NaN,"3"]){const f=fixture();f.deps.contextDailyLimit=value;
    await assert.rejects(collect(f.input,f.deps),e=>e.code==="context_budget_unconfigured");assert.equal(f.calls(),0);assert.equal(f.db.rows.size,0);
  }
});
test("packet validation rejects unknown owners, oversized sources, ambiguous timestamps, false completeness and unavailable evidence",async()=>{
  const f=fixture();
  for(const change of [{owner:"dan"},{expectedVersion:-1},{entries:Array(81).fill(f.input.entries[0])},{sources:[{...f.input.sources[0],status:"complete"}]},{sources:[{...f.input.sources[0],status:"unavailable"}]},{entries:[{...f.input.entries[0],sourceTime:"2026-10-29"}]},{entries:[{...f.input.entries[0],sourceTime:"2027-01-01T00:00:00Z"}]}]) await assert.rejects(collect({...f.input,...change},f.deps),e=>e.code==="context_invalid_input");
  assert.equal(f.db.rows.size,0);assert.equal(f.calls(),0);
});
test("empty partial snapshots preserve coverage and do not infer resolution or call a model",async()=>{
  const f=fixture();await collect({...f.input,entries:[]},f.deps);
  const r=await get({purposes:["brief"]},f.deps);assert.equal(r.observations.length,0);assert.equal(r.sources[0].status,"partial");assert.equal(f.calls(),0);
});
test("complete source windows persist across partial/failing runs and never move backward",async()=>{
  const f=fixture();
  const full={...f.input,entries:[],sources:[{...f.input.sources[0],status:"complete",hasMore:false}]};
  await collect(full,f.deps);
  const first=(await get({purposes:["brief"]},f.deps)).lastCompleteSources.messages;
  assert.equal(first.windowEnd,"2026-10-29T15:00:00.000Z");assert.equal(first.runId,full.runId);
  await collect({...f.input,runId:"partial-followup",expectedVersion:1,entries:[]},f.deps);
  assert.deepEqual((await get({purposes:["brief"]},f.deps)).lastCompleteSources.messages,first);
  await collect({...full,runId:"older-window",expectedVersion:2,sources:[{...full.sources[0],windowEnd:"2026-10-29T14:00:00Z"}]},f.deps);
  assert.deepEqual((await get({purposes:["brief"]},f.deps)).lastCompleteSources.messages,first);
  f.deps.generateContext=async()=>{throw Error("offline");};
  const failed={...full,entries:f.input.entries,expectedVersion:3,runId:"failed-checkpoint"};
  await assert.rejects(collect(failed,f.deps));
  assert.deepEqual((await get({purposes:["brief"]},f.deps)).lastCompleteSources.messages,first);
  const attempt=await run({runId:failed.runId},f.deps);assert.equal(attempt.status,"failed");assert.equal(attempt.sources[0].status,"complete");
  assert(!JSON.stringify(attempt).includes(f.input.entries[0].text));
});
test("a lease timeout is explicit; late model output cannot overwrite a newer run",async()=>{
  const f=fixture();let release,entered;const waiting=new Promise(r=>entered=r),old=new Promise(r=>release=r);
  f.deps.generateContext=async()=>{entered();await old;return {output:f.output};};
  const first=collect(f.input,f.deps);const rejected=assert.rejects(first,e=>e.code==="context_processing_failed");await waiting;
  f.time("2026-10-29T15:03:00Z");assert.equal((await run({runId:f.input.runId},f.deps)).stalled,true);
  f.deps.generateContext=async()=>({output:{observations:[]}});
  await collect({...f.input,runId:"explicit-recovery"},f.deps);release();await rejected;
  assert.equal((await get({purposes:["brief"]},f.deps)).observations.length,0);
});
test("Vertex adapter uses fixed bounded JSON generation, no tools or automatic provider retries, and rejects incomplete output",async()=>{
  const f=fixture();let request;
  const auth={getClient:async()=>({request:async r=>{request=r;return {data:{candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(f.output)}]}}],usageMetadata:{totalTokenCount:100,secret:"ignored"}}};}})};
  const args={auth,projectId:"synthetic-project",at:"2026-10-29T15:00:00Z"};
  const result=await generateContextWithVertex(f.input,args);
  assert.equal(request.retry,false);assert.equal(request.timeout,45000);assert.equal(request.data.generationConfig.maxOutputTokens,4096);assert.equal(request.data.tools,undefined);
  assert.match(request.data.systemInstruction.parts[0].text,/untrusted data/);assert.deepEqual(result.usage,{totalTokenCount:100});
  await assert.rejects(generateContextWithVertex(f.input,{...args,at:"2026-11-30T00:00:00Z"}),/pricing/);
  await assert.rejects(generateContextWithVertex(f.input,{...args,auth:{getClient:async()=>({request:async()=>({data:{candidates:[{finishReason:"MAX_TOKENS"}]}})})}}),/Incomplete/);
});
