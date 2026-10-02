"use strict";
const M=require("./ministry-overview-model");
const S=require("./ministry-overview-service");
const {normalizeEvent}=require("./ministry-breeze-client");
function client(deps){if(!deps.ministryBreeze)M.fail("Breeze calendar connection unavailable","ministry_breeze_unavailable",503);return deps.ministryBreeze;}
async function allowedAreas(deps) {
  if(M.actor(deps).owner)return null;
  return new Set((await S.inventory(deps)).filter(r=>M.canRead(r,deps)&&r.status==="active").flatMap(r=>r.calendarAreaIds));
}
async function participatingEvents(deps) {
  const rows=await S.inventory(deps),visible=new Set(rows.filter(r=>M.canRead(r,deps)&&r.status==="active").map(r=>r.ministryId));
  const ids=new Set();
  for(const r of rows)for(const a of S.effectiveCalendarActions(r))if(a.status==="verified"&&a.proposal.operation!=="cancel"&&a.proposal.participatingMinistryIds?.some(id=>visible.has(id))) {
    for(const id of a._currentInstanceIds)if(id)ids.add(id);
  }
  return ids;
}
async function listChurchCalendarAreas(input,deps) {
  const allowed=await allowedAreas(deps),raw=await client(deps).read("/api/events/calendars/list");
  if(!Array.isArray(raw))M.fail("Calendar catalog unavailable","ministry_breeze_invalid_response",502);
  const areas=raw.filter(r=>allowed===null||allowed.has(String(r.id))).map(r=>({calendarAreaId:String(r.id),name:String(r.name),color:String(r.color||"")}));
  return {areas,checkedAt:M.now(deps),coverage:"checked",scope:allowed===null?"dan_all_breeze_areas":"explicit_ministry_calendar_mappings",sourceMayLagMinutes:15};
}
async function getChurchEvent(input,deps) {
  const c=client(deps),raw=await c.read("/api/events/list_event",{instance_id:M.id(input.instanceId),details:1});
  const event=normalizeEvent(raw),allowed=await allowedAreas(deps);
  if(allowed!==null&&!allowed.has(event.calendarAreaId)&&!(await participatingEvents(deps)).has(event.instanceId))M.fail("Event area is not available to this identity","ministry_overview_access_denied",403);
  return {event:{...event,url:c.eventUrl(event.instanceId)},checkedAt:M.now(deps),coverage:"checked",sourceMayLagMinutes:15};
}
async function readChurchEventWindow(input,deps) {
  const dateFrom=M.date(input.dateFrom),dateTo=M.date(input.dateTo);
  if(dateTo<dateFrom||Date.parse(dateTo)-Date.parse(dateFrom)>366*86400000)M.fail("Use a forward window of at most 366 days");
  const catalog=await listChurchCalendarAreas({},deps),known=new Set(catalog.areas.map(a=>a.calendarAreaId));
  if(input.calendarAreaIds&&input.calendarAreaIds.some(id=>!known.has(id)))M.fail("Requested calendar area is not authorized","ministry_overview_access_denied",403);
  const selected=input.calendarAreaIds?catalog.areas.filter(a=>input.calendarAreaIds.includes(a.calendarAreaId)):catalog.areas;
  const c=client(deps),events=new Map(),areaCoverage=[];
  async function scan(area,start,end,depth=0) {
    const rows=await c.read("/api/events",{start,end,category_id:area.calendarAreaId,details:1,limit:1000});
    if(!Array.isArray(rows))M.fail("Event list is not an array","ministry_breeze_invalid_response",502);
    if(rows.length>=1000) {
      if(start===end||depth>=9)M.fail("Breeze event window is truncated","ministry_breeze_truncated",422);
      const split=new Date((Date.parse(start)+Date.parse(end))/2).toISOString().slice(0,10),next=new Date(Date.parse(split)+86400000).toISOString().slice(0,10);
      await scan(area,start,split,depth+1);await scan(area,next,end,depth+1);return;
    }
    for(const raw of rows){const e=normalizeEvent(raw);if(e.calendarAreaId!==area.calendarAreaId)M.fail("Breeze returned a different calendar area","ministry_breeze_area_mismatch",502);events.set(e.instanceId,{...e,calendarAreaName:area.name,url:c.eventUrl(e.instanceId)});}
  }
  for(const area of selected) {
    try{await scan(area,dateFrom,dateTo);areaCoverage.push({...area,status:"checked"});}
    catch(error){areaCoverage.push({...area,status:"unavailable",code:error.code||"ministry_breeze_failed"});}
  }
  if(!input.calendarAreaIds)for(const id of await participatingEvents(deps))if(!events.has(id)) {
    try{const {event}=await getChurchEvent({instanceId:id},deps);if(event.startDate<=dateTo&&event.endDate>=dateFrom)events.set(id,event);}
    catch(error){areaCoverage.push({instanceId:id,status:"unavailable",code:error.code||"ministry_breeze_failed"});}
  }
  const rows=[...events.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.instanceId.localeCompare(b.instanceId));
  return {items:rows,dateFrom,dateTo,areaCoverage,coverage:areaCoverage.every(a=>a.status==="checked")?"checked":"partial",checkedAt:M.now(deps),sourceMayLagMinutes:15,
    guidance:"Breeze owns church scheduling. Calendar presence is not confirmed attendance or Dan's commitment. Check multi-day boundary coverage; do not infer missing events are cancelled."};
}
async function listChurchEvents(input,deps) {
  const result=await readChurchEventWindow(input,deps);
  const page=M.page(result.items,input,{subject:M.actor(deps).subject,dateFrom:result.dateFrom,dateTo:result.dateTo,
    areas:result.areaCoverage.map(a=>[a.calendarAreaId,a.status]),events:result.items.map(e=>[e.instanceId,M.hash(e)])});
  return {...result,...page};
}
module.exports={client,allowedAreas,listChurchCalendarAreas,getChurchEvent,listChurchEvents,readChurchEventWindow};
