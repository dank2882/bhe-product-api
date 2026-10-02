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
const sourceEntry = (id="folder_1") => ({system:"breeze",tenant:"faithbaptistapp",sourceId:id,sourceType:"folder",name:"Original source name",path:"All Tags",url:"https://faithbaptistapp.breezechms.com/r/tags",observedAt:"2026-10-01T12:00:00Z",listedPeople:null});
test("portfolio ownership preserves old records and does not inherit access or cross organization hierarchy",async()=>{
  const s=setup();let f=await create(s,"fbc"),b=await create(s,"bhe",{owner:"bhe"}),g=await create(s,"gom",{owner:"gom"});
  assert.equal(f.owner,"fbc");assert.deepEqual(b.serves,["bhe"]);assert.deepEqual(g.serves,["gom"]);
  assert.deepEqual((await s.call("listMinistries",{owner:"bhe"})).items.map(r=>r.ministryId),["bhe"]);
  await assert.rejects(s.call("updateMinistry",{ministryId:"fbc",expectedVersion:f.version,changes:{owner:"bhe"}}),/cannot be transferred/);
  await assert.rejects(create(s,"child",{owner:"gom",parentMinistryId:"bhe"}),/hierarchy/);
  await s.deps.staffAuthorizationProfilesCollection.doc(getStaffAuthorizationProfileId("editor")).set({status:"active"});
  b=(await s.call("setMinistryAccess",{ministryId:"bhe",expectedVersion:b.version,grants:[{subject:"editor",role:"editor"}]})).ministry;
  const editor={...s.deps,taskAccess:{subject:"editor",role:"member"}};
  assert.deepEqual((await s.call("listMinistries",{},editor)).items.map(r=>r.ministryId),["bhe"]);
  await assert.rejects(s.call("getMinistry",{ministryId:"gom"},editor),/not available/);
  await assert.rejects(s.call("updateMinistry",{ministryId:"bhe",expectedVersion:b.version,changes:{sourceEntries:[sourceEntry()]}},editor),/require Dan/);
  const legacy={...f};delete legacy.owner;delete legacy.recordKind;delete legacy.sourceEntries;
  await s.db.collection("fbcMinistryRecords").doc("fbc").set(legacy);
  const reread=(await s.call("getMinistry",{ministryId:"fbc"})).ministry;
  assert.equal(reread.owner,"fbc");assert.equal(reread.recordKind,"ministry");assert.deepEqual(reread.sourceEntries,[]);
});
test("provisional source inventory is quiet but real concerns still resurface with their context",async()=>{
  const s=setup();let r=await create(s,"inventory",{owner:"gom",status:"provisional",sourceEntries:[sourceEntry()]});
  const before=(await s.call("buildMinistryReview",{owner:"gom"}));
  assert.equal(before.totalCount,0);assert.equal(before.inventory.provisionalCount,1);assert.equal(before.coverage.events,"not_configured");
  assert.equal((await s.call("listMinistries",{query:"Original source"})).totalCount,1);
  r=await capture(s,r,{exactText:"We need a driver for the next trip."});
  const review=await s.call("buildMinistryReview",{owner:"gom",asOfDate:"2026-11-02"});
  assert.equal(review.totalCount,1);assert.equal(review.items[0].owner,"gom");assert.equal(review.items[0].reason,"next_ministry_review");
  assert.equal(review.summaries[0].status,"provisional");assert.equal((await s.deps.tasksCollection.get()).docs.length,0);
  const p=(await s.call("getMinistryPicture",{ministryId:r.ministryId})).picture;
  assert.equal(p.sourceEntries[0].name,"Original source name");assert.ok(p.informationGaps.includes("imported_profile_unconfirmed"));
  assert.equal(p.openMatters[0].currentSituation,"We need a driver for the next trip.");
});
test("source evidence cannot be overwritten or duplicated, and unresolved ownership cannot activate or grant access",async()=>{
  const s=setup();let r=await create(s,"unknown",{owner:"unassigned",recordKind:"source_group",status:"provisional",sourceEntries:[sourceEntry()]});
  await assert.rejects(create(s,"duplicate",{sourceEntries:[sourceEntry()]}),/already belongs/);
  await assert.rejects(s.call("updateMinistry",{ministryId:r.ministryId,expectedVersion:r.version,changes:{sourceEntries:[]}}),/preserved/);
  await assert.rejects(s.call("updateMinistry",{ministryId:r.ministryId,expectedVersion:r.version,changes:{status:"active"}}),/before activation/);
  await assert.rejects(s.call("setMinistryAccess",{ministryId:r.ministryId,expectedVersion:r.version,grants:[]}),/Confirm organization/);
  r=(await s.call("updateMinistry",{ministryId:r.ministryId,expectedVersion:r.version,changes:{owner:"gom",recordKind:"ministry",status:"active"}})).ministry;
  assert.equal(r.owner,"gom");assert.equal(r.status,"active");assert.equal(r.sourceEntries.length,1);
});
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
