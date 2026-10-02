"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { runMinistryOverviewOperation: run } = require("../lib/ministry-overview-operation-registry");
const { getStaffAuthorizationProfileId } = require("../lib/staff-authorization-service");
function setup() {
  const db=fakeFirestore();let sequence=0;
  const deps={firestoreDb:db,danOwnerSubjects:["dan"],taskAccess:{subject:"dan",subjects:["dan"],role:"admin",name:"Dan"},now:()=>new Date("2026-10-02T17:00:00Z")};
  for(const [key,name] of Object.entries({projectsCollection:"projects",tasksCollection:"tasks",taskNotesCollection:"notes",taskNotificationsCollection:"notifications",taskManagementAuditEventsCollection:"taskAudit",staffAuthorizationProfilesCollection:"staff",taskStaffProfilesCollection:"taskStaff"}))deps[key]=db.collection(name);
  const call=async(operation,args={},d=deps,key=`ministry-test-${++sequence}`)=>(await run({operation,mode:operation.startsWith("get")||operation.startsWith("list")||operation.startsWith("build")?"query":"command",arguments:args,idempotencyKey:key},d)).result;
  return {db,deps,call};
}
async function create(s,id="nursery",profile={}){return (await s.call("createMinistry",{ministryId:id,name:id,profile})).ministry;}
async function capture(s,r,args={}){return (await s.call("captureMinistryMatter",{ministryId:r.ministryId,expectedVersion:r.version,title:"Coverage",exactText:"I'm concerned about nursery coverage.",sensitivity:"general",...args})).ministry;}
test("concern survives a fresh session; reads never create tasks or change review state",async()=>{
  const s=setup();let r=await create(s);r=await capture(s,r);
  const before=JSON.stringify([...s.db.rows]);
  const fresh={...s.deps};const {picture}=await s.call("getMinistryPicture",{ministryId:r.ministryId},fresh);
  assert.equal(picture.openMatters.length,1);assert.equal(picture.openMatters[0].returns.reason,"next_ministry_review");
  assert.equal(picture.openMatters[0].nextMove,null);assert.equal(picture.assessment,"review_or_information_needed");
  assert.equal(JSON.stringify([...s.db.rows]),before);assert.equal((await s.deps.tasksCollection.get()).docs.length,0);
  assert.equal((await s.call("getMinistry",{ministryId:r.ministryId})).ministry.matters[0].exactText,"I'm concerned about nursery coverage.");
});
test("explicit grants only, no inherited access, no roster grants; revoked users cannot replay writes",async()=>{
  const s=setup();let parent=await create(s,"parent"),r=await create(s,"nursery",{parentMinistryId:"parent",workers:[{name:"Leader",subject:"leader"}]});
  const leader={...s.deps,taskAccess:{subject:"leader",role:"member"}};
  await assert.rejects(s.call("getMinistry",{ministryId:r.ministryId},leader),/not available/);
  await s.deps.staffAuthorizationProfilesCollection.doc(getStaffAuthorizationProfileId("leader")).set({status:"active"});
  parent=(await s.call("setMinistryAccess",{ministryId:"parent",expectedVersion:parent.version,grants:[{subject:"leader",role:"editor"}]})).ministry;
  await assert.rejects(s.call("getMinistry",{ministryId:r.ministryId},leader),/not available/);
  r=(await s.call("setMinistryAccess",{ministryId:r.ministryId,expectedVersion:r.version,grants:[{subject:"leader",role:"editor"}]})).ministry;
  const args={ministryId:r.ministryId,expectedVersion:r.version,changes:{purpose:"Serve families"}};
  await s.call("updateMinistry",args,leader,"leader-routine-change");
  r=(await s.call("getMinistry",{ministryId:r.ministryId})).ministry;
  await assert.rejects(s.call("updateMinistry",{ministryId:r.ministryId,expectedVersion:r.version,changes:{leader:{name:"Me"}}},leader),/require Dan/);
  r=(await s.call("setMinistryAccess",{ministryId:r.ministryId,expectedVersion:r.version,grants:[]})).ministry;
  await assert.rejects(s.call("updateMinistry",args,leader,"leader-routine-change"),/not available/);
});
test("atomic version/idempotency protection and hierarchy cycles",async()=>{
  const s=setup();let a=await create(s,"a"),b=await create(s,"b",{parentMinistryId:"a"});
  await assert.rejects(s.call("updateMinistry",{ministryId:"a",expectedVersion:a.version,changes:{parentMinistryId:"b"}}),/hierarchy/);
  const args={ministryId:"a",expectedVersion:a.version,title:"Question",exactText:"What next?",sensitivity:"general"};
  await Promise.all([s.call("captureMinistryMatter",args,s.deps,"same-intent-key"),s.call("captureMinistryMatter",args,s.deps,"same-intent-key")]);
  a=(await s.call("getMinistry",{ministryId:"a"})).ministry;assert.equal(a.matters.length,1);
  await assert.rejects(s.call("captureMinistryMatter",{...args,exactText:"Different"},s.deps,"same-intent-key"),/reused/);
  await assert.rejects(s.call("updateMinistry",{ministryId:"a",expectedVersion:1,changes:{purpose:"stale"}}),/changed/);
});
test("decision outcomes keep broad matter open and deferral returns without resolution",async()=>{
  const s=setup();let r=await capture(s,await create(s)),m=r.matters[0];
  r=(await s.call("requestMinistryDecision",{ministryId:r.ministryId,expectedVersion:r.version,matterId:m.matterId,question:"Approve training?",userAuthorized:true})).ministry;
  assert.equal(r.matters[0].taskLink.desired,"next");
  r=(await s.call("recordMinistryDecision",{ministryId:r.ministryId,expectedVersion:r.version,matterId:m.matterId,outcome:"deferred",exactAnswer:"Ask me next month",userConfirmed:true,returnCondition:{kind:"date",date:"2026-11-02"}})).ministry;
  assert.equal(r.matters[0].status,"waiting");assert.equal(r.matters[0].taskLink.desired,"scheduled");
  const early=(await s.call("getMinistryPicture",{ministryId:r.ministryId,asOfDate:"2026-10-15"})).picture;assert.equal(early.needsDan.length,0);
  const due=(await s.call("getMinistryPicture",{ministryId:r.ministryId,asOfDate:"2026-11-02"})).picture;assert.equal(due.needsDan.length,1);
  await assert.rejects(s.call("resolveMinistryMatter",{ministryId:r.ministryId,expectedVersion:r.version,matterId:m.matterId,reason:"We discussed it",userConfirmed:true}),/unresolved decision/);
  r=(await s.call("recordMinistryDecision",{ministryId:r.ministryId,expectedVersion:r.version,matterId:m.matterId,outcome:"approved",exactAnswer:"Yes",userConfirmed:true})).ministry;
  assert.equal(r.matters[0].status,"open");assert.equal(r.matters[0].taskLink.desired,"done");
});
test("missing information yields specific gaps without invented assignments or sends",async()=>{
  const s=setup();let r=await capture(s,await create(s));const matterId=r.matters[0].matterId;
  r=(await s.call("requestMinistryDecision",{ministryId:r.ministryId,expectedVersion:r.version,matterId,question:"What does training cost?",userAuthorized:true})).ministry;
  r=(await s.call("recordMinistryDecision",{ministryId:r.ministryId,expectedVersion:r.version,matterId,outcome:"information_requested",exactAnswer:"I need an estimate",userConfirmed:true})).ministry;
  const p=(await s.call("getMinistryPicture",{ministryId:r.ministryId})).picture;
  assert.equal(p.openMatters[0].nextMove,null);assert.ok(p.informationGaps.includes("next_move_not_agreed"));
  assert.equal(r.matters[0].taskLink.desired,"waiting");
});
test("old reports remain old after review and handed-off ministries stay out of personal brief",async()=>{
  const s=setup();let r=await capture(s,await create(s),{source:{reportedAt:"2026-08-01T12:00:00Z"},nextMove:{kind:"person",person:{name:"Michael"},action:"Get estimate"},returnCondition:{kind:"date",date:"2026-10-09"}});
  r=(await s.call("recordMinistryReview",{ministryId:r.ministryId,expectedVersion:r.version,asOfDate:"2026-10-02",assessment:"Awaiting estimate",userConfirmed:true})).ministry;
  const p=(await s.call("getMinistryPicture",{ministryId:r.ministryId})).picture;
  assert.ok(p.informationGaps.includes("information_old"));assert.equal(p.leaderCarrying[0].nextMove.person.name,"Michael");
  await create(s,"maintenance",{personalScope:"handed_off"});
  const brief=await s.call("buildMinistryReview",{});assert.equal(brief.ministryCount,1);assert.equal(brief.summaries[0].name,"nursery");
});
test("decision task sync verifies one destination; manual task completion is not approval",async()=>{
  const s=setup();let r=await capture(s,await create(s));const matterId=r.matters[0].matterId;
  r=(await s.call("requestMinistryDecision",{ministryId:r.ministryId,expectedVersion:r.version,matterId,question:"Approve training?",userAuthorized:true})).ministry;
  const result=await s.call("syncMinistryDecisionTask",{ministryId:r.ministryId,expectedVersion:r.version,matterId});
  assert.equal(result.taskVerified,true);r=result.ministry;
  await s.call("syncMinistryDecisionTask",{ministryId:r.ministryId,expectedVersion:r.version,matterId});
  assert.equal((await s.deps.tasksCollection.get()).docs.length,1);
  await s.deps.tasksCollection.doc(result.taskId).update({status:"done"});
  const p=(await s.call("getMinistryPicture",{ministryId:r.ministryId})).picture;
  assert.ok(p.openMatters[0].gaps.includes("decision_not_recorded"));assert.equal(p.openMatters[0].decision.outcome,"pending");
});
