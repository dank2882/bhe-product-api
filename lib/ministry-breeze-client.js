"use strict";
const M=require("./ministry-overview-model");
const READ_PATHS=new Set(["/api/events/calendars/list","/api/events","/api/events/list_event"]);

// Deliberately bounded calendar adapter. No arbitrary URL, people, giving or
// account operation is exposed. Credentials never enter records or responses.
function createMinistryBreezeClient({subdomain,apiKey,firestoreDb,fetchImpl=fetch,now=()=>Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
  if(!/^[a-z0-9-]+$/i.test(subdomain||"")||!apiKey)M.fail("Breeze calendar connection is not configured","ministry_breeze_unavailable",503);
  const base=`https://${subdomain}.breezechms.com`;
  async function reserve() {
    const at=await firestoreDb.runTransaction(async tx=>{
      const ref=firestoreDb.collection("fbcMinistryProviderLimits").doc(`breeze-${subdomain}`),snap=await tx.get(ref);
      const current=Number(now()),next=Math.max(current,snap.exists?snap.data().nextAt:0);
      if(next-current>45000)M.fail("Breeze read budget is busy; retry later","ministry_breeze_rate_limited",429);
      tx.set(ref,{nextAt:next+3500});return next;
    });
    const delay=at-Number(now());if(delay>0)await wait(delay);
  }
  async function request(path,params={}) {
    await reserve();const url=new URL(base+path);
    for(const [k,v]of Object.entries(params))if(v!==undefined&&v!=="")url.searchParams.set(k,String(v));
    let response;
    try {response=await fetchImpl(url,{method:"GET",headers:{Accept:"application/json","Api-Key":apiKey},redirect:"error",signal:AbortSignal.timeout(20000)});}catch{M.fail("Breeze request outcome unavailable","ministry_breeze_transport",503);}
    if(!response.ok)M.fail("Breeze request failed","ministry_breeze_request_failed",response.status===429?429:502);
    try{return await response.json();}catch{M.fail("Breeze response was not valid JSON","ministry_breeze_invalid_response",502);}
  }
  return {
    read:async(path,params)=>{if(!READ_PATHS.has(path))M.fail("Unsupported Breeze read");return request(path,params);},
    add:params=>request("/api/events/add",params),
    remove:instanceId=>request("/api/events/delete",{instance_id:instanceId}),
    eventUrl:instanceId=>`${base}/events/view/${encodeURIComponent(M.id(instanceId))}`,
    settingsUrl:instanceId=>`${base}/events/settings/${encodeURIComponent(M.id(instanceId))}`,
    calendarUrl:()=>`${base}/events`,
    timezone:"America/Los_Angeles"
  };
}
function normalizeEvent(e) {
  if(!e||typeof e!=="object"||!e.id||!e.start_datetime)M.fail("Breeze event lacks identity or date","ministry_breeze_invalid_event",502);
  const details=e.details||{},flag=details.input_all_day??e.all_day;
  return {instanceId:String(e.id),seriesId:String(e.event_id||""),calendarAreaId:String(e.category_id??""),title:String(e.name||""),
    start:String(e.start_datetime),end:e.end_datetime==="0000-00-00 00:00:00"?"":String(e.end_datetime||""),
    startDate:String(e.start_datetime).slice(0,10),endDate:String(e.end_datetime||"").slice(0,10),
    allDay:flag===undefined?null:[true,1,"1","on"].includes(flag),timezone:"America/Los_Angeles",
    description:String(details.description||details.input_description||""),locationIds:String(details.location_ids_json||""),
    source:"breeze",sourceMayLagMinutes:15};
}
module.exports={createMinistryBreezeClient,normalizeEvent};
