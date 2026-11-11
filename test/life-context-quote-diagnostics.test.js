"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const {generateContextWithVertex}=require("../lib/life-context-vertex");
const {collectContext,getContextRun,normalizeOutput}=require("../lib/life-context-observations");
const {fakeFirestore}=require("./helpers/maintenance-firestore");
const at="2026-11-09T17:00:00.000Z";
function fixture() {
  const entries=[{id:"src-"+"a".repeat(64),text:"Nora (received): Not before 9:30.\nArrival is unknown."},
    {id:"src-"+"b".repeat(64),text:"Dan (sent): Thank you; no arrival time is confirmed."}]
    .map(e=>({...e,source:"messages",sourceReference:"fictional:"+e.id,sourceTime:"2026-11-09T16:00:00Z",identity:"provisional"}));
  const packet={runId:"fictional-quotes",expectedVersion:0,reason:"Fictional quote diagnostics",entries,
    sources:[{source:"messages",status:"partial",hasMore:true,windowStart:"2026-11-08T17:00:00Z",windowEnd:at,checkedAt:at}]};
  const output={observations:[{text:"Nora reports a lower bound; arrival remains unconfirmed.",purposes:["brief","planning"],certainty:"tentative",sourceIds:entries.map(e=>e.id),support:entries.map(e=>({sourceId:e.id,quote:e.text}))}]};
  return {packet,output};
}
test("short provider IDs resolve to original long source IDs without changing quotes or input",async()=>{
  const {packet,output}=fixture(), before=structuredClone(packet);
  const result=await generateContextWithVertex(packet,{at,projectId:"fictional-project",auth:{getClient:async()=>({request:async request=>{
    const p=JSON.parse(request.data.contents[0].parts[0].text);
    assert.deepEqual(p.entries.map(e=>e.id),["e1","e2"]);
    assert.deepEqual(p.entries.map(e=>e.text),packet.entries.map(e=>e.text));
    const provider={observations:output.observations.map(o=>({...o,sourceIds:["e1","e2"],support:o.support.map((s,i)=>({...s,sourceId:`e${i+1}`}))}))};
    return {data:{candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(provider)}]}}]}};}})}});
  assert.deepEqual(result.output,output);assert.deepEqual(packet,before);
  assert.equal(normalizeOutput(result.output,packet,at)[0].citations[0].id,packet.entries[0].id);
});
test("invented or original IDs from the model cannot bypass alias resolution",async()=>{
  for(const alias of ["e3","e01","src-"+"a".repeat(64),{},null]) {
    const {packet}=fixture();
    const auth={getClient:async()=>({request:async()=>({data:{candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({observations:[{sourceIds:[alias]}]})}]}}]}})})};
    await assert.rejects(generateContextWithVertex(packet,{at,projectId:"fictional-project",auth}),/Unknown model evidence alias/);
  }
});
test("receipts locate quote failures without exposing quotes, summaries, identities or provider errors",async()=>{
  const cases=[
    [o=>o.support[0].quote="x".repeat(2001),"quote_too_long"],
    [o=>o.support[0].quote="Nora (received): Not before 9:30. Arrival is unknown.","quote_not_exact"],
    [o=>o.support[0].quote="Nora will arrive at 9:30.","quote_not_exact"],
    [o=>o.support[0].quote=" ","empty_or_nontext_quote"],
    [o=>o.support[0].quote=123,"empty_or_nontext_quote"],
    [o=>o.support[1]={...o.support[0]},"duplicate_support"],
    [o=>o.support[0].sourceId="fictional-uncited","source_not_cited"]
  ];
  for(const [mutate,issue] of cases) {
    const {packet,output}=fixture();mutate(output.observations[0]);const db=fakeFirestore();let calls=0;
    const deps={firestoreDb:db,danOwnerSubjects:["fictional-owner"],taskAccess:{subject:"fictional-owner"},contextEnabled:true,contextMonthlyLimitMicros:100000,now:()=>at,generateContext:async()=>{calls++;return {output};}};
    await assert.rejects(collectContext(packet,deps),e=>e.code==="context_processing_failed");
    const receipt=await getContextRun({runId:packet.runId},deps);
    assert.equal(receipt.failure.issue,issue);assert.equal(receipt.failure.observationIndex,0);
    assert.equal(receipt.failure.supportIndex,issue==="duplicate_support"?1:0);
    assert.equal(receipt.version,null);assert.equal(receipt.status,"failed");
    assert(!JSON.stringify(receipt).includes("Nora"));assert(!JSON.stringify(receipt).includes("src-"));
    assert(!db.rows.has("danLifeContext/observations/revisions/1"));
    assert.equal((await collectContext(packet,deps)).status,"failed");assert.equal(calls,1);
  }
});
test("provider-supplied diagnostic fields are never persisted",async()=>{
  const {packet}=fixture(), db=fakeFirestore();
  const deps={firestoreDb:db,danOwnerSubjects:["fictional-owner"],taskAccess:{subject:"fictional-owner"},contextEnabled:true,contextMonthlyLimitMicros:100000,now:()=>at,generateContext:async()=>{throw Object.assign(new Error("Unsupported evidence quotation"),{issue:"private-provider-data",observationIndex:"private-provider-data"});}};
  await assert.rejects(collectContext(packet,deps));
  const receipt=await getContextRun({runId:packet.runId},deps);
  assert.deepEqual(receipt.failure,{stage:"generation",reason:"unsupported_quote"});
  assert(!JSON.stringify([...db.rows]).includes("private-provider-data"));
});
test("gendered narrative pronouns fail while exact source wording and neutral summaries remain intact",()=>{
  const {packet,output}=fixture();
  packet.entries[0].text="Mira: She has an injury. I do not know who can help.";
  output.observations[0].support[0].quote=packet.entries[0].text;
  for(const text of ["Mira says she needs help.","Dan says he can help.","Her appointment is tomorrow.","His time is uncertain."]) {
    output.observations[0].text=text;
    assert.throws(()=>normalizeOutput(output,packet,at),/source names or neutral pronouns/);
  }
  output.observations[0].text="Mira reports someone has an injury; the person is unidentified.";
  assert.equal(normalizeOutput(output,packet,at).length,1);
  assert.equal(packet.entries[0].text,"Mira: She has an injury. I do not know who can help.");
});
test("pronoun failure receipt identifies the observation without retaining rejected wording",async()=>{
  const {packet,output}=fixture(), db=fakeFirestore();
  output.observations.push({...structuredClone(output.observations[0]),text:"Nora says she cannot confirm her arrival."});
  const deps={firestoreDb:db,danOwnerSubjects:["fictional-owner"],taskAccess:{subject:"fictional-owner"},contextEnabled:true,contextMonthlyLimitMicros:100000,now:()=>at,generateContext:async()=>({output})};
  await collectContext(packet,deps);
  const receipt=await getContextRun({runId:packet.runId},deps);
  assert.equal(receipt.status,"completed");
  assert.deepEqual(receipt.validation.rejections,[{stage:"validation",reason:"narrative_pronoun",observationIndex:1,issue:"gendered_narrative",pronounCount:2}]);
  assert(!JSON.stringify([...db.rows]).includes("Nora says"));
  assert(!JSON.stringify(receipt).includes("arrival"));
});
test("bare family titles cannot become named relationships without quoted support",async()=>{
  const {packet,output}=fixture();
  packet.entries[0].text="Nora: I asked Jules and Alex to work with Dad on purchases.";
  output.observations[0].support[0].quote=packet.entries[0].text;
  for(const name of ["Dan's dad","Nora’s dad"]) {
    output.observations[0].text=`Nora reports asking Jules and Alex to work with ${name}.`;
    assert.throws(()=>normalizeOutput(output,packet,at),/Family relationship absent/);
  }
  const db=fakeFirestore(),deps={firestoreDb:db,danOwnerSubjects:["fictional-owner"],taskAccess:{subject:"fictional-owner"},contextEnabled:true,contextMonthlyLimitMicros:100000,now:()=>at,generateContext:async()=>({output})};
  await assert.rejects(collectContext(packet,deps));
  assert.deepEqual((await getContextRun({runId:packet.runId},deps)).failure,{stage:"validation",reason:"unsupported_relationship"});
  output.observations[0].text="Nora reports asking Jules and Alex to work with the person referred to as Dad on purchases.";
  assert.equal(normalizeOutput(output,packet,at).length,1);
  packet.entries[0].text="Nora: I asked Jules and Alex to work with Dan's dad on purchases.";
  output.observations[0].support[0].quote=packet.entries[0].text;
  output.observations[0].text="Nora reports asking Jules and Alex to work with Dan’s dad on purchases.";
  assert.equal(normalizeOutput(output,packet,at).length,1);
});
