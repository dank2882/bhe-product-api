"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {fakeFirestore} = require("./helpers/maintenance-firestore");
const {runMinistryOverviewOperation:run} = require("../lib/ministry-overview-operation-registry");
const {definitions} = require("../lib/ministry-missions");
async function setup() {
  const db = fakeFirestore(); let seq = 0;
  const deps = {firestoreDb:db,danOwnerSubjects:["dan"],taskAccess:{subject:"dan",subjects:["dan"],role:"admin"},now:()=>new Date("2026-10-06T22:00:00Z")};
  const call = async (operation,args={},key=`missions-test-${++seq}`,d=deps) => (await run({operation,mode:definitions.find(x=>x[0]===operation)?.[1] || (operation.startsWith("get")?"query":"command"),arguments:args,idempotencyKey:key},d)).result;
  await call("createMinistry",{ministryId:"missions",name:"FBC Missions"});
  const row = (key,name,amountCents=null,extra={}) => ({key,exactText:`${name}: ${amountCents}`,recipient:{name,category:"missionary",location:"Example"},support:{amountCents},...extra});
  const rows = [row("g","Example group",180000,{support:{amountCents:180000,kind:"group",questions:["Missing eighth name"]}}),row("a","Example pastor",null,{coveredByRowKey:"g"}),row("b","Unknown amount"),row("c","Split support",25000,{support:{amountCents:25000,breakdown:[{label:"person",amountCents:10000},{label:"agency",amountCents:15000}]}})];
  const args = {ministryId:"missions",source:{reference:"test-only",exactText:rows.map(r=>r.exactText).join("\n"),basisConfirmation:"Monthly USD confirmed by test owner"},rows};
  const preview = await call("previewMissionImport",args);
  const input = {...args,expectedVersion:0,previewHash:preview.previewHash};
  return {db,deps,call,args,input,preview};
}
test("atomic import, unknowns and group/breakdown totals; fresh exact source reads",async()=>{
  const s=await setup(); assert.equal(s.preview.summary.listedAmountCents,205000);
  assert.equal((await s.call("listMissionRecipients",{ministryId:"missions"})).totalCount,0);
  const saved=await s.call("importMissionRoster",s.input,"import-once");
  assert.equal(saved.summary.recipientCount,4); assert.equal(saved.summary.unknownRootAmountCount,1);assert.equal(saved.summary.unknownAllocationCount,1);
  const list=await s.call("listMissionRecipients",{ministryId:"missions",limit:2});assert.equal(list.complete,false);
  const next=await s.call("listMissionRecipients",{ministryId:"missions",limit:2,cursor:list.nextCursor});assert.equal(next.items.length,2);
  const all=[...list.items,...next.items], group=all.find(r=>r.support.kind==="group");
  const exact=await s.call("getMissionRecipient",{ministryId:"missions",recipientId:group.recipientId});assert.equal(exact.includedRecipients.length,1);
  const src=await s.call("getMissionSource",{ministryId:"missions",sourceId:group.sourceId});assert.equal(src.source.evidence.exactText,s.args.source.exactText);
  assert.equal((await s.call("getMinistry",{ministryId:"missions"})).ministry.missions,undefined);
  assert.equal([...s.db.rows.keys()].some(p=>/tasks|finance/i.test(p)),false);
});
test("owner only across all operations, including aliases, delegated admin and replay",async()=>{
  const s=await setup();await s.call("importMissionRoster",s.input,"import-once");
  const ref=s.db.collection("fbcMinistryRecords").doc("missions"), p=(await ref.get()).data();p.grants=[{subject:"staff",role:"editor"}];await ref.set(p);
  const staff={...s.deps,taskAccess:{subject:"staff",subjects:["staff","dan"],role:"admin"}};
  for(const [op,mode,,required] of definitions) {
    const args=Object.fromEntries(required.map(k=>[k,k==="ministryId"?"missions":"placeholder"]));
    await assert.rejects(s.call(op,args,"denied-action",staff),e=>e.code==="missions_access_denied",op);
  }
  await assert.rejects(s.call("importMissionRoster",s.input,"import-once",staff),/only to Dan/);
});
test("concurrent retries, changed keys and stale versions do not duplicate imports",async()=>{
  const s=await setup();await Promise.all([s.call("importMissionRoster",s.input,"same-import"),s.call("importMissionRoster",s.input,"same-import")]);
  assert.equal((await s.call("getMissionSupportSummary",{ministryId:"missions"})).version,1);
  await assert.rejects(s.call("importMissionRoster",{...s.input,rows:[]},"same-import"),/reused/);
  await assert.rejects(s.call("importMissionRoster",s.input,"different-key"),/changed/);
  const preview=await s.call("previewMissionImport",s.args);assert.equal(preview.addedCount,0);assert.equal(preview.unchangedCount,4);
  await s.call("importMissionRoster",{...s.args,previewHash:preview.previewHash,expectedVersion:1});
  assert.equal((await s.call("getMissionSupportSummary",{ministryId:"missions"})).recipientCount,4);
});
test("partial imports resume from source row IDs without resetting later corrections",async()=>{
  const s=await setup();const partial={...s.args,rows:s.args.rows.slice(0,2)}, p=await s.call("previewMissionImport",partial);
  await s.call("importMissionRoster",{...partial,expectedVersion:0,previewHash:p.previewHash});
  const list=await s.call("listMissionRecipients",{ministryId:"missions"}),group=list.items.find(r=>r.support.kind==="group");
  await s.call("updateMissionSupport",{ministryId:"missions",expectedVersion:1,supportId:group.support.supportId,changes:{amountCents:190000},evidence:"Owner confirmed correction"});
  const resumed=await s.call("previewMissionImport",s.args);assert.equal(resumed.addedCount,2);assert.equal(resumed.unchangedCount,2);
  await s.call("importMissionRoster",{...s.args,expectedVersion:2,previewHash:resumed.previewHash});
  assert.equal((await s.call("getMissionSupportSummary",{ministryId:"missions"})).listedAmountCents,215000);
  const bad=structuredClone(s.args);bad.rows[0].support.amountCents=120000;
  await assert.rejects(s.call("previewMissionImport",bad),/Source row changed/);
});
test("invalid allocations and previews roll back completely; no source, receipt or partial rows",async()=>{
  const s=await setup(),before=JSON.stringify([...s.db.rows]);
  await assert.rejects(s.call("importMissionRoster",{...s.input,previewHash:"wrong"}),/preview changed/);
  assert.equal(JSON.stringify([...s.db.rows]),before);
  const bad=structuredClone(s.args);bad.rows[1].coveredByRowKey="missing";
  await assert.rejects(s.call("previewMissionImport",bad),/root group/);
  bad.rows[1].coveredByRowKey="g";bad.rows[1].support.amountCents=190000;
  await assert.rejects(s.call("previewMissionImport",bad),/exceed/);
  const dup=structuredClone(s.args);dup.rows[1].recipient=dup.rows[0].recipient;
  await assert.rejects(s.call("previewMissionImport",dup),/duplicate recipient/);
  assert.equal(JSON.stringify([...s.db.rows]),before);
});
test("evidenced edits preserve source and history, validate amounts and cursor freshness",async()=>{
  const s=await setup();await s.call("importMissionRoster",s.input);
  const list=await s.call("listMissionRecipients",{ministryId:"missions",limit:1}),r=list.items[0];
  await assert.rejects(s.call("updateMissionSupport",{ministryId:"missions",expectedVersion:1,supportId:r.support.supportId,changes:{amountCents:0.5},evidence:"test"}),/integer/);
  await s.call("updateMissionRecipient",{ministryId:"missions",expectedVersion:1,recipientId:r.recipientId,changes:{location:"Confirmed location"},evidence:"Owner correction"});
  await assert.rejects(s.call("listMissionRecipients",{ministryId:"missions",cursor:list.nextCursor}),/restart pagination/);
  const exact=await s.call("getMissionRecipient",{ministryId:"missions",recipientId:r.recipientId});assert.equal(exact.recipient.exactText,r.exactText);
  const history=await s.call("getMissionRosterHistory",{ministryId:"missions"});assert.equal(history.items.length,2);assert.equal(history.items[1].input.evidence,"Owner correction");
  await assert.rejects(s.call("updateMissionRecipient",{ministryId:"missions",expectedVersion:1,recipientId:r.recipientId,changes:{location:"Stale"},evidence:"test"}),/changed/);
  await s.call("updateMissionSupport",{ministryId:"missions",expectedVersion:2,supportId:r.support.supportId,changes:{status:"paused"},evidence:"Owner paused"});
  assert.equal((await s.call("getMissionSupportSummary",{ministryId:"missions"})).listedAmountCents,25000);
});
test("wrong organization cannot host FBC support records",async()=>{
  const s=await setup();await s.call("createMinistry",{ministryId:"gom",name:"GO Missions",profile:{owner:"gom"}});
  await assert.rejects(s.call("previewMissionImport",{...s.args,ministryId:"gom"}),/existing FBC/);
});
