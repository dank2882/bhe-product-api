"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {fakeFirestore}=require("./helpers/maintenance-firestore");
const {runMinistryOverviewOperation:run}=require("../lib/ministry-overview-operation-registry");
const {midnight,local}=require("../lib/ministry-calendar-workflow");
const {getStaffAuthorizationProfileId}=require("../lib/staff-authorization-service");
function setup(){
  const db=fakeFirestore(),calls=[],events=new Map();let seq=0;
  const deps={firestoreDb:db,danOwnerSubjects:["dan"],taskAccess:{subject:"dan",subjects:["dan"],role:"admin"},now:()=>new Date("2026-10-02T17:00:00Z"),
    tasksCollection:db.collection("tasks"),staffAuthorizationProfilesCollection:db.collection("staff"),ministryBreeze:{
      read:async(path,args)=>{calls.push({path,args});if(path.includes("calendars"))return [{id:0,name:"Main",subscription_url:"secret"},{id:10,name:"Youth"}];
        if(path.endsWith("list_event")){if(!events.has(args.instance_id))throw Error("missing");return events.get(args.instance_id);}
        return [...events.values()].filter(e=>String(e.category_id)===args.category_id&&e.start_datetime.slice(0,10)>=args.start&&e.start_datetime.slice(0,10)<=args.end);},
      eventUrl:id=>`https://example.test/events/${id}`,
      add:async args=>{calls.push({add:args});const raw={id:"new1",event_id:"series1",category_id:args.category_id,name:args.name,start_datetime:local(new Date(args.starts_on*1000).toISOString()),end_datetime:local(new Date(args.ends_on*1000).toISOString()),details:{input_all_day:args.all_day,input_description:args.description}};events.set(raw.id,raw);return raw;},
      remove:async id=>{calls.push({remove:id});events.delete(id);return {success:true};}
    }};
  const call=async(op,args={},key=`calendar-test-${++seq}`,d=deps)=>(await run({operation:op,mode:/^(get|list|build)/.test(op)?"query":"command",arguments:args,idempotencyKey:key},d)).result;
  const check={observedAt:"2026-10-02T17:00:00Z",calendarAreaIds:["0","10"],knownConflicts:[]};
  return {db,deps,calls,events,call,check};
}
async function create(s){return (await s.call("createMinistry",{ministryId:"youth",name:"Youth",profile:{calendarAreaIds:["10"]}})).ministry;}
async function propose(s,r,proposal,extra={}){return s.call("proposeChurchCalendarAction",{ministryId:r.ministryId,expectedVersion:r.version,proposal,...extra});}
async function approve(s,result){return s.call("approveChurchCalendarAction",{ministryId:result.ministry.ministryId,expectedVersion:result.ministry.version,actionId:result.action.actionId,proposalHash:result.action.proposalHash,userApproved:true,approvalNote:"Dan approved this exact arrangement"});}
const proposed={operation:"create",calendarAreaId:"10",title:"Training",start:"2026-10-05T10:00:00-07:00",end:"2026-10-05T11:00:00-07:00"};
test("Breeze reads every area explicitly, hides subscription secrets and enforces selected ministry access",async()=>{
 const s=setup(),r=await create(s);s.events.set("e1",{id:"e1",event_id:"s",category_id:0,name:"Main event",start_datetime:"2026-10-03 10:00:00",end_datetime:"2026-10-03 11:00:00",details:{input_all_day:0}});
 const rows=await s.call("listChurchEvents",{dateFrom:"2026-10-02",dateTo:"2026-10-10"});assert.equal(rows.coverage,"checked");assert.equal(rows.totalCount,1);
 assert.deepEqual(s.calls.filter(c=>c.path==="/api/events").map(c=>c.args.category_id),["0","10"]);assert.ok(!JSON.stringify(rows).includes("secret"));
 await s.deps.staffAuthorizationProfilesCollection.doc(getStaffAuthorizationProfileId("leader")).set({status:"active"});
 await s.call("setMinistryAccess",{ministryId:r.ministryId,expectedVersion:r.version,grants:[{subject:"leader",role:"viewer"}]});
 const leader={...s.deps,taskAccess:{subject:"leader",role:"member"}};
 assert.deepEqual((await s.call("listChurchCalendarAreas",{},undefined,leader)).areas.map(a=>a.calendarAreaId),["10"]);
 await assert.rejects(s.call("getChurchEvent",{instanceId:"e1"},undefined,leader),/not available/);
 await assert.rejects(s.call("listChurchEvents",{dateFrom:"2026-10-02",dateTo:"2026-10-10",calendarAreaIds:["0"]},undefined,leader),/not authorized/);
});
test("exact approval precedes provider write; ambiguous create never dispatches twice",async()=>{
 const s=setup();let result=await propose(s,await create(s),proposed);
 await assert.rejects(s.call("executeChurchCalendarAction",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,conflictCheck:s.check}),/unattempted approved/);
 result=await approve(s,result);let attempts=0;s.deps.ministryBreeze.add=async()=>{attempts++;throw Error("transport uncertain");};
 const args={ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,conflictCheck:s.check};
 await assert.rejects(s.call("executeChurchCalendarAction",args,"uncertain-create-key"),/transport uncertain/);
 const current=(await s.call("getMinistry",{ministryId:"youth"})).ministry;assert.equal(current.calendarActions[0].status,"unknown");
 await assert.rejects(s.call("executeChurchCalendarAction",{...args,expectedVersion:current.version},"another-create-key"),/reconcile/);assert.equal(attempts,1);
});
test("all-day API create spans DST days correctly and verified ID survives retries",async()=>{
 const s=setup();let result=await approve(s,await propose(s,await create(s),{operation:"create",calendarAreaId:"10",title:"Retreat",allDay:true,startDate:"2026-11-01",endDate:"2026-11-01"}));
 result=await s.call("executeChurchCalendarAction",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,conflictCheck:s.check},"dst-create-once");
 assert.equal(result.action.status,"verified");assert.equal(result.action.result.instanceId,"new1");
 const args=s.calls.find(c=>c.add).add;assert.equal(args.ends_on-args.starts_on,25*3600-60);assert.equal(midnight("2026-03-09")-midnight("2026-03-08"),23*3600);
});
test("browser dispatch replay only reconciles; changed arrangements invalidate approval",async()=>{
 const s=setup();let result=await approve(s,await propose(s,await create(s),proposed));
 const args={ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,conflictCheck:s.check};
 result=await s.call("beginChurchCalendarAction",args,"browser-dispatch-once");assert.ok(result.dispatch);
 const replay=await s.call("beginChurchCalendarAction",args,"browser-dispatch-once");assert.equal(replay.dispatch,undefined);assert.equal(replay.reconciliationRequired,true);
 await assert.rejects(propose(s,result.ministry,{...proposed,title:"Other"},{actionId:result.action.actionId}),/reconciled/);
 await assert.rejects(s.call("recordChurchCalendarResult",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,outcome:"browser_read_back",observedAt:s.check.observedAt,events:[{instanceId:"new1",calendarAreaId:"10",title:"Wrong",start:"2026-10-05 10:00:00",end:"2026-10-05 11:00:00",allDay:false}]}),/differs/);
});
test("in-place edits protect source changes and verify clearing fields; recurrence requires every occurrence",async()=>{
 const s=setup(),r=await create(s),before={instanceId:"e1",seriesId:"s",calendarAreaId:"10",title:"Training",start:"2026-10-05 09:00:00",end:"2026-10-05 10:00:00",allDay:false,description:"Remove this"};
 let result=await approve(s,await propose(s,r,{...proposed,operation:"update",instanceId:"e1"},{beforeEvents:[before]}));
 const args={ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,conflictCheck:{...s.check,currentEvent:{...before,title:"Edited elsewhere"}}};
 await assert.rejects(s.call("beginChurchCalendarAction",args),/Source event changed/);
 result=await s.call("beginChurchCalendarAction",{...args,conflictCheck:{...s.check,currentEvent:before}});
 const readback={...before,start:"2026-10-05 10:00:00",end:"2026-10-05 11:00:00"};
 await assert.rejects(s.call("recordChurchCalendarResult",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,outcome:"browser_read_back",observedAt:s.check.observedAt,events:[readback]}),/differs/);
 result=await s.call("recordChurchCalendarResult",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,outcome:"browser_read_back",observedAt:s.check.observedAt,events:[{...readback,description:""}]});assert.equal(result.action.status,"verified");assert.equal(result.action.result.backendVerified,false);
 await assert.rejects(propose(s,result.ministry,{...proposed,operation:"update",instanceId:"e1",seriesId:"s",recurrenceScope:"series",affectedInstanceIds:["e1","e2"],occurrences:[{...proposed,operation:"update",instanceId:"e1"}]}),/Each affected/);
});
test("event return dates read source changes, unavailable areas stay explicit, and leader handoffs are not Dan tasks",async()=>{
 const s=setup();let r=await create(s);s.events.set("e1",{id:"e1",event_id:"s",category_id:10,name:"Retreat",start_datetime:"2026-10-07 10:00:00",end_datetime:"2026-10-07 11:00:00",details:{input_all_day:0}});
 r=(await s.call("captureMinistryMatter",{ministryId:r.ministryId,expectedVersion:r.version,title:"Drivers",exactText:"Michael is checking for a driver.",sensitivity:"general",nextMove:{kind:"person",person:{name:"Michael"},action:"Check for driver"},returnCondition:{kind:"event",eventInstanceId:"e1",daysBefore:7}})).ministry;
 const picture=(await s.call("getMinistryPicture",{ministryId:"youth"})).picture;assert.equal(picture.openMatters[0].returns.date,"2026-09-30");assert.equal(picture.openMatters[0].returns.due,true);assert.equal(picture.needsDan.length,0);
 const brief=await s.call("buildMinistryReview",{});assert.ok(brief.items.some(i=>i.title==="Drivers"&&!i.needsDan));assert.equal((await s.deps.tasksCollection.get()).docs.length,0);
 const original=s.deps.ministryBreeze.read;s.deps.ministryBreeze.read=async(path,args)=>{if(path==="/api/events"&&args.category_id==="0")throw Error("area unavailable");return original(path,args);};
 assert.equal((await s.call("buildMinistryReview",{})).coverage.events,"partial");
});
test("new recurring series binds distinct occurrences and rejects a partial or mixed-series browser result",async()=>{
 const s=setup(),second={...proposed,start:"2026-10-12T10:00:00-07:00",end:"2026-10-12T11:00:00-07:00"};
 let result=await approve(s,await propose(s,await create(s),{...proposed,recurrenceScope:"series",occurrences:[proposed,second]}));
 result=await s.call("beginChurchCalendarAction",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,conflictCheck:s.check});
 assert.equal(result.dispatch.method,"supervised_browser");
 const events=[proposed,second].map((p,i)=>({instanceId:`created-${i}`,seriesId:"new-series",calendarAreaId:"10",title:p.title,start:local(p.start),end:local(p.end),allDay:false}));
 const input={ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,outcome:"browser_read_back",observedAt:s.check.observedAt};
 await assert.rejects(s.call("recordChurchCalendarResult",{...input,events:[events[0]]}),/every approved/);
 await assert.rejects(s.call("recordChurchCalendarResult",{...input,events:[events[0],{...events[1],seriesId:"wrong"}]}),/every approved/);
 result=await s.call("recordChurchCalendarResult",{...input,events});assert.equal(result.action.status,"verified");assert.equal(result.action.result.seriesId,"new-series");
});
test("private appointment linkage reads its actual family safeguards without exposing them in leader history",async()=>{
 const s=setup();s.deps.privateDelegationEnv={DAN_PRIVATE_OWNER_SUBJECTS:"dan",DAN_PRIVATE_DELEGATE_SUBJECTS:"sarah"};let n=0;
 const {runAppointmentOperation}=require("../lib/appointments-operation-registry");
 const cmd=async(operation,args)=>(await runAppointmentOperation({operation,mode:"command",arguments:args,idempotencyKey:`appointment-link-${++n}`},s.deps)).result;
 await cmd("configureAppointmentFamilyPolicy",{expectedVersion:0,userApproved:true,policy:{enabled:true,windows:[{day:1,start:"08:00",end:"12:00"}],channel:"text",recipient:"+15555550123",approverSubject:"sarah"}});
 let appointment=await cmd("createAppointment",{contentClassification:"general_or_neutral"});
 appointment=await cmd("proposeAppointmentAction",{appointmentId:appointment.appointmentId,expectedVersion:appointment.version,proposal:{kind:"calendar",calendar:{role:"meeting",operation:"create",start:"2026-10-05T19:00:00-07:00",end:"2026-10-05T20:00:00-07:00",subject:"Pastoral appointment",location:"Church",attendees:[]}}});
 let result=await propose(s,await create(s),proposed);
 result=await s.call("linkMinistryAppointment",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,appointmentId:appointment.appointmentId});
 const p=(await s.call("getMinistryPicture",{ministryId:"youth"})).picture;assert.equal(p.calendarActions[0].appointment.familyApprovalRequired,true);
 await s.deps.staffAuthorizationProfilesCollection.doc(getStaffAuthorizationProfileId("leader")).set({status:"active"});
 result=await s.call("setMinistryAccess",{ministryId:"youth",expectedVersion:result.ministry.version,grants:[{subject:"leader",role:"editor"}]});
 const leader={...s.deps,taskAccess:{subject:"leader",role:"member"}};
 const view=await s.call("getMinistry",{ministryId:"youth"},undefined,leader);assert.equal(view.ministry.calendarActions,undefined);
 const history=await s.call("getMinistryHistory",{ministryId:"youth"},undefined,leader);assert.ok(!JSON.stringify(history).includes(appointment.appointmentId));
 await assert.rejects(s.call("linkMinistryAppointment",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.ministry.calendarActions[0].actionId,appointmentId:appointment.appointmentId},undefined,leader),/Dan must/);
});
test("missing provider all-day metadata cannot become a verified timed event",async()=>{
 const s=setup();let result=await approve(s,await propose(s,await create(s),proposed));
 const add=s.deps.ministryBreeze.add;s.deps.ministryBreeze.add=async args=>{const e=await add(args);delete e.details.input_all_day;return e;};
 result=await s.call("executeChurchCalendarAction",{ministryId:"youth",expectedVersion:result.ministry.version,actionId:result.action.actionId,conflictCheck:s.check});
 assert.equal(result.verificationPending,true);assert.equal(result.action.status,"verification_pending");assert.equal(result.action.result.instanceId,"new1");
});
