"use strict";
const M=require("./ministry-overview-model");
const S=require("./ministry-overview-service");
const C=require("./ministry-church-calendar");
const {getAppointment}=require("./appointments-service");
const COMMANDS=["proposeChurchCalendarAction","approveChurchCalendarAction","beginChurchCalendarAction","recordChurchCalendarResult","verifyChurchCalendarAction","dismissChurchCalendarAction","linkMinistryAppointment"];
const done=a=>["verified","dismissed"].includes(a.status);
function action(r,id){const a=r.calendarActions.find(a=>a.actionId===M.id(id));if(!a)M.fail("Calendar action not found");return a;}
function time(value){if(typeof value!=="string"||!/(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))M.fail("Use an ISO datetime with offset");return value;}
function proposal(v){
  M.shape(v,["operation","instanceId","seriesId","calendarAreaId","title","start","end","allDay","startDate","endDate","description","location","recurrenceScope","affectedInstanceIds","participatingMinistryIds","occurrences"]);
  const out={operation:M.choice(v.operation,["create","update","cancel"],"calendar operation"),calendarAreaId:M.id(v.calendarAreaId),
    instanceId:v.instanceId?M.id(v.instanceId):"",seriesId:v.seriesId?M.id(v.seriesId):"",recurrenceScope:M.choice(v.recurrenceScope||"instance",["instance","series"],"recurrence scope"),
    affectedInstanceIds:M.list(v.affectedInstanceIds||[],M.id,250),participatingMinistryIds:M.list(v.participatingMinistryIds||[],M.id,30)};
  if(out.operation!=="create"&&!out.instanceId)M.fail("Existing event identity required");
  if(out.recurrenceScope==="series"&&out.operation!=="create"&&(!out.seriesId||!out.affectedInstanceIds.length))M.fail("Series changes require the exact affected occurrence IDs");
  if(out.recurrenceScope==="series"&&out.operation!=="cancel"){
    out.occurrences=M.list(v.occurrences,x=>proposal({...x,recurrenceScope:"instance"}),250);
    if(out.operation==="create") {
      if(out.occurrences.length<2||out.affectedInstanceIds.length||out.instanceId||out.seriesId||out.occurrences.some(o=>o.operation!=="create"||o.instanceId||o.seriesId||o.calendarAreaId!==out.calendarAreaId)||new Set(out.occurrences.map(o=>M.hash(o))).size!==out.occurrences.length)M.fail("Approve a finite list of distinct exact new occurrences in one calendar area");
    } else if(out.occurrences.length!==out.affectedInstanceIds.length||new Set(out.affectedInstanceIds).size!==out.affectedInstanceIds.length||out.affectedInstanceIds.some(id=>!out.occurrences.some(o=>o.instanceId===id&&o.operation===out.operation)))M.fail("Each affected occurrence needs its own exact arrangement");
  }
  if(out.operation!=="cancel"){
    out.title=M.text(v.title,"event title",300);out.allDay=v.allDay===true;
    if(out.allDay){out.startDate=M.date(v.startDate);out.endDate=M.date(v.endDate||v.startDate);if(out.endDate<out.startDate)M.fail("Invalid all-day range");}
    else{out.start=time(v.start);out.end=time(v.end);if(Date.parse(out.end)<=Date.parse(out.start))M.fail("Event end must follow start");}
    out.description=M.text(v.description,"description",10000,true);out.location=M.text(v.location,"location",1000,true);
  }
  return out;
}
function fresh(v,deps){if(!Number.isFinite(Date.parse(v))||Date.parse(v)>Date.parse(M.now(deps))||Date.parse(M.now(deps))-Date.parse(v)>300000)M.fail("A current observation within five minutes is required");return v;}
function local(iso){const f=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));return `${f.year}-${f.month}-${f.day} ${f.hour}:${f.minute}:${f.second}`;}
function matches(p,e){
  if(p.operation==="cancel")return e.cancelled===true&&e.instanceId===p.instanceId;
  return e.calendarAreaId===p.calendarAreaId&&e.title===p.title&&(p.operation==="create"||e.instanceId===p.instanceId)&&
    (p.allDay?e.allDay===true&&e.startDate===p.startDate&&e.endDate===p.endDate:e.allDay===false&&e.start===local(p.start)&&e.end===local(p.end))&&
    (e.description||"")===p.description&&(e.location||"")===p.location;
}
function observedEvent(v){
  M.shape(v,["instanceId","seriesId","calendarAreaId","title","start","end","startDate","endDate","allDay","description","location","cancelled"]);
  return {...v,instanceId:M.id(v.instanceId),calendarAreaId:M.id(v.calendarAreaId)};
}
function nextDay(day){return new Date(Date.parse(`${M.date(day)}T12:00:00Z`)+86400000).toISOString().slice(0,10);}
function midnight(day){
  const nominal=Date.parse(`${M.date(day)}T00:00:00Z`);let stamp=nominal;
  for(let i=0;i<3;i++){const wall=Date.parse(local(new Date(stamp).toISOString()).replace(" ","T")+"Z");stamp+=nominal-wall;}
  return Math.floor(stamp/1000);
}
async function executeChurchCalendarAction(input,key,deps){
  M.requireOwner(deps);
  const r=S.record(await S.ref(deps,input.ministryId).get(),deps,true),a=action(r,input.actionId),c=C.client(deps);
  if(a.status!=="approved")M.fail("Only an unattempted approved action may be dispatched; reconcile prior attempts","ministry_calendar_reconcile_required",409);
  const p=a.proposal;
  if(p.operation==="update"||p.recurrenceScope==="series"||p.location)M.fail("Use beginChurchCalendarAction and supervised Breeze browser editing for this arrangement","ministry_calendar_browser_required",422);
  let state=await runCalendarCommand("beginChurchCalendarAction",input,`${key}:begin`,deps);
  try{
    if(p.operation==="create"){
      const raw=await c.add({name:p.title,category_id:p.calendarAreaId,starts_on:p.allDay?midnight(p.startDate):Math.floor(Date.parse(p.start)/1000),
        ends_on:p.allDay?midnight(nextDay(p.endDate))-60:Math.floor(Date.parse(p.end)/1000),all_day:p.allDay?1:0,description:p.description});
      const returned=Array.isArray(raw)?raw[0]:raw;if(!returned?.id)M.fail("Breeze did not return a created event identity","ministry_breeze_ambiguous_write",502);
      state=await runCalendarCommand("recordChurchCalendarResult",{ministryId:r.ministryId,expectedVersion:state.ministry.version,actionId:a.actionId,outcome:"bound",instanceId:String(returned.id)},`${key}:bind`,deps);
      try{return await runCalendarCommand("verifyChurchCalendarAction",{ministryId:r.ministryId,expectedVersion:state.ministry.version,actionId:a.actionId},`${key}:verify`,deps);}
      catch{return {...state,providerWriteAttempted:true,verificationPending:true,guidance:"Creation returned an ID. API readback is not yet verified; do not create another event. Verify the bound event in Breeze or retry readback after cache delay."};}
    }
    await c.remove(p.instanceId);
    return {...state,providerWriteAttempted:true,verificationPending:true,guidance:"Deletion request returned. Verify cancellation in Breeze's normal interface, then record exact client browser evidence; cached API absence is not proof."};
  }catch(error){
    // Do not reissue a provider operation when the transport outcome is unclear.
    const current=await S.getMinistry({ministryId:r.ministryId},deps);
    await runCalendarCommand("recordChurchCalendarResult",{ministryId:r.ministryId,expectedVersion:current.ministry.version,actionId:a.actionId,outcome:"unknown",note:"Provider call or result persistence failed; reconcile the actual Breeze calendar before any retry."},`${key}:unknown`,deps);
    throw error;
  }
}
async function runCalendarCommand(operation,input,key,deps){
  M.requireOwner(deps);M.text(key,"idempotencyKey",180);if(key.length<8)M.fail("Idempotency key too short");
  const target=S.ref(deps,input.ministryId),actor=M.actor(deps),intent=M.hash({subject:actor.subject,key}),receipt=S.col(deps,"Receipts").doc(intent),fingerprint=M.hash({operation,input});
  let verification,appointment,replayed=false;
  if(operation==="verifyChurchCalendarAction"){
    const r=S.record(await target.get(),deps,true),a=action(r,input.actionId);
    if(!["attempted","unknown","verification_pending","verified"].includes(a.status))M.fail("Begin the authorized calendar action before verification");
    if(a.proposal.recurrenceScope==="series")M.fail("Series changes require readback of every affected occurrence");
    if(a.proposal.operation==="cancel")M.fail("Cancellation requires exact browser evidence; API absence may be cached or incomplete");
    const id=a.result?.instanceId||a.proposal.instanceId;if(!id)M.fail("Bind the returned event ID before verification");
    verification=await C.getChurchEvent({instanceId:id},deps);
    if(!matches(a.proposal,verification.event))M.fail("Breeze readback does not yet match the approved arrangement","ministry_calendar_verification_pending",409);
  }
  if(operation==="linkMinistryAppointment")appointment=await getAppointment({appointmentId:M.id(input.appointmentId)},deps);
  await deps.firestoreDb.runTransaction(async tx=>{
    const [snap,saved]=await Promise.all([tx.get(target),tx.get(receipt)]),r=S.record(snap,deps,true);
    if(saved.exists){if(saved.data().fingerprint!==fingerprint)M.fail("Idempotency key reused","idempotency_key_reused",409);replayed=true;return;}
    M.expected(r,input.expectedVersion);const at=M.now(deps);
    if(operation==="proposeChurchCalendarAction"){
      const p=proposal(input.proposal),aid=input.actionId||`calendar-${intent.slice(0,24)}`,old=r.calendarActions.find(a=>a.actionId===aid);
      if(old&&!['proposed','approved'].includes(old.status))M.fail("Attempted actions must be reconciled, not rewritten");
      const all=await S.inventory(deps,tx);for(const id of p.participatingMinistryIds)M.authorize(all.find(r=>r.ministryId===id),deps);
      const beforeEvents=p.operation==="create"?[]:M.list(input.beforeEvents,observedEvent,250);
      const expectedIds=p.recurrenceScope==="series"?p.affectedInstanceIds:[p.instanceId];
      if(p.operation!=="create"&&(beforeEvents.length!==expectedIds.length||expectedIds.some(id=>!beforeEvents.some(e=>e.instanceId===id))))M.fail("Read every existing occurrence before proposing its exact change");
      const next={actionId:M.id(aid),proposal:p,beforeEvents,proposalHash:M.hash({proposal:p,beforeEvents}),status:"proposed",createdAt:old?.createdAt||at,updatedAt:at,approval:null,result:null};
      if(old)r.calendarActions[r.calendarActions.indexOf(old)]=next;else r.calendarActions.push(next);
    }else if(operation==="linkMinistryAppointment"){
      if(!appointment?.appointment)M.fail("Appointment reference not verified");
      const a=action(r,input.actionId);
      a.appointmentReference={appointmentId:appointment.appointment.appointmentId,version:appointment.appointment.version,checkedAt:at};
    }else{
      const a=action(r,input.actionId);
      if(operation==="approveChurchCalendarAction"){
        if(!['proposed','approved'].includes(a.status)||input.proposalHash!==a.proposalHash||input.userApproved!==true)M.fail("Approval must match the exact unattempted arrangement");
        a.approval={proposalHash:a.proposalHash,actorSub:actor.subject,at,note:M.text(input.approvalNote,"approval note",3000)};a.status="approved";
      }else if(operation==="beginChurchCalendarAction"){
        if(a.status!=="approved"||a.approval?.proposalHash!==a.proposalHash)M.fail("Approve the exact arrangement before execution; reconcile previous attempts","ministry_calendar_approval_required",409);
        const check=input.conflictCheck;M.shape(check,["observedAt","calendarAreaIds","knownConflicts","resolution","currentEvent","currentEvents"]);fresh(check.observedAt,deps);
        M.list(check.calendarAreaIds,M.id);if(!check.calendarAreaIds.includes(a.proposal.calendarAreaId))M.fail("Conflict check must include the destination area");
        M.list(check.knownConflicts,x=>M.text(x,"conflict",1000));if(check.knownConflicts.length&&!check.resolution)M.fail("Resolve or explicitly accept known conflicts before dispatch");
        if(a.proposal.operation!=="create"){
          const current=check.currentEvents?M.list(check.currentEvents,observedEvent,250):[observedEvent(check.currentEvent)];
          if(current.length!==a.beforeEvents.length||a.beforeEvents.some(before=>!current.some(e=>e.instanceId===before.instanceId&&M.hash(e)===M.hash(before))))M.fail("Source event changed after proposal; review and approve the revised arrangement","ministry_calendar_source_changed",409);
          a.before=current;
        }
        if(a.proposal.operation==="cancel"&&input.userConfirmedDestructive!==true)M.fail("Explicit cancellation confirmation is required");
        a.conflictCheck=check;a.status="attempted";a.attemptedAt=at;a.dispatchKey=`ministry-calendar-${M.hash({ministryId:r.ministryId,actionId:a.actionId,hash:a.proposalHash}).slice(0,32)}`;
      }else if(operation==="recordChurchCalendarResult"){
        if(!["attempted","unknown","verification_pending"].includes(a.status)&&!(a.status==="verified"&&input.outcome==="browser_read_back"))M.fail("Only an attempted action can have a result");
        const outcome=M.choice(input.outcome,["unknown","bound","browser_read_back"],"outcome");
        if(outcome==="unknown"){a.status="unknown";a.result={...a.result,note:M.text(input.note,"uncertainty",3000)};}
        else if(outcome==="bound"){
          const id=M.id(input.instanceId);if(a.result?.instanceId&&a.result.instanceId!==id)M.fail("Cannot rebind an existing event identity");
          a.status="verification_pending";a.result={instanceId:id,note:"Event ID returned; independent verification pending"};
        }else{
          fresh(input.observedAt,deps);if(Date.parse(input.observedAt)<Date.parse(a.attemptedAt))M.fail("Readback must follow the attempt");
          const events=M.list(input.events,observedEvent,250),ids=a.proposal.recurrenceScope==="series"?a.proposal.affectedInstanceIds:[a.proposal.instanceId||a.result?.instanceId];
          const creatingSeries=a.proposal.operation==="create"&&a.proposal.recurrenceScope==="series";
          if(new Set(events.map(e=>e.instanceId)).size!==events.length)M.fail("Readback occurrence IDs must be unique");
          if(creatingSeries) {
            const series=events[0]?.seriesId;
            if(!series||events.some(e=>e.seriesId!==series)||events.length!==a.proposal.occurrences.length||a.proposal.occurrences.some(p=>events.filter(e=>matches(p,e)).length!==1))M.fail("Read back every approved new occurrence with one shared series identity");
          } else {
            if(a.proposal.operation==="create"&&!ids[0]){if(events.length!==1)M.fail("One created event readback required");ids[0]=events[0].instanceId;}
            if(events.length!==ids.length||ids.some(id=>!events.some(e=>e.instanceId===id)))M.fail("Read back every affected occurrence exactly once");
            for(const e of events){const p=a.proposal.recurrenceScope==="series"?(a.proposal.operation==="cancel"?{...a.proposal,instanceId:e.instanceId}:a.proposal.occurrences.find(o=>o.instanceId===e.instanceId)):a.proposal;if(!matches(p,e))M.fail("Browser readback differs from approved proposal");}
          }
          a.status="verified";a.result={instanceId:events[0].instanceId,seriesId:events[0].seriesId||"",events,observedAt:input.observedAt,evidence:"client_browser_read_back",backendVerified:false};
        }
      }else if(operation==="verifyChurchCalendarAction"){
        if(!verification||!matches(a.proposal,verification.event))M.fail("Proposal changed before readback","ministry_overview_version_conflict",409);
        a.status="verified";a.result={instanceId:verification.event.instanceId,event:verification.event,observedAt:verification.checkedAt,evidence:"backend_breeze_api_read_back",sourceMayLagMinutes:15};
      }else if(operation==="dismissChurchCalendarAction"){
        if(!["proposed","approved"].includes(a.status)||input.userConfirmed!==true)M.fail("Only an unattempted action can be dismissed");a.status="dismissed";
      }else M.fail("Unknown calendar operation");
      a.updatedAt=at;
    }
    r.version++;r.updatedAt=at;r.updatedBy=actor.subject;if(Buffer.byteLength(JSON.stringify(r))>500000)M.fail("Ministry exceeds size budget");
    tx.set(target,r);tx.create(target.collection("history").doc(String(r.version).padStart(10,"0")),{version:r.version,operation,actorSub:actor.subject,at,input,fingerprint});
    tx.create(receipt,{fingerprint,ministryId:r.ministryId,version:r.version,at});
  });
  const result=await S.getMinistry({ministryId:input.ministryId},deps),a=input.actionId?result.ministry.calendarActions.find(a=>a.actionId===input.actionId):result.ministry.calendarActions.at(-1);
  return {...result,action:a,readBackVerified:true,...(replayed?{replayed:true,reconciliationRequired:!done(a)}:{}),...(operation==="beginChurchCalendarAction"&&!replayed&&a?.status==="attempted"?{dispatch:{system:"breeze",operation:a.proposal.operation,dispatchKey:a.dispatchKey,
    method:a.proposal.operation==="update"||a.proposal.recurrenceScope==="series"||a.proposal.location?"supervised_browser":"supported_api_or_browser",
    instructions:"Use the exact approved proposal; in-place edit only. Do not retry after an ambiguous outcome. If browser is unavailable record unknown/pending and resume later. Read back all changed fields and occurrences. Personal Outlook blocks must use the linked Pastoral Appointments workflow and its current family policy."}}:{})};
}
module.exports={COMMANDS,proposal,matches,local,midnight,runCalendarCommand,executeChurchCalendarAction,done};
