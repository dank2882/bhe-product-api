// Authenticated backend acceptance; not a substitute for the user's live pilot.
import assert from 'node:assert/strict';
const base=process.env.MINISTRY_ACCEPTANCE_BASE_URL, key=process.env.BHE_API_KEY, actor=process.env.MINISTRY_ACCEPTANCE_ACTOR;
if(!base||!key||!actor)throw Error('Explicit URL, API key and authorized actor required');
const headers={'content-type':'application/json','x-api-key':key,'x-bhe-actor-sub':actor,'x-bhe-task-role':'admin'};
const run='ministry-portfolio-acceptance-20261002';
async function query(operation,args={},subject=actor){
 const response=await fetch(`${base}/ministry-overview/query`,{method:'POST',headers:{...headers,'x-bhe-actor-sub':subject},body:JSON.stringify({operation,arguments:args})});
 const body=await response.json();return {response,body};
}
async function command(operation,args,suffix){
 const response=await fetch(`${base}/ministry-overview/command`,{method:'POST',headers,body:JSON.stringify({operation,arguments:args,idempotencyKey:`${run}-${suffix}`})});
 const body=await response.json();assert(response.ok&&body.ok!==false,`${operation}: ${body.error?.code}`);return body.result;
}
const catalog=await(await fetch(`${base}/ministry-overview/operations`,{headers})).json();
assert.equal(catalog.catalogVersion,'1.1.0');
const ids=[];
for(const owner of ['bhe','gom']){
 const ministryId=`ministry-acceptance-portfolio-${owner}-20261002`;ids.push(ministryId);
 const initial=await command('createMinistry',{ministryId,name:`Synthetic ${owner} portfolio acceptance`,profile:{owner,status:'provisional',purpose:'Synthetic acceptance only; not a real ministry.'}},`${owner}-create`);
 let r=(await query('getMinistry',{ministryId})).body.result.ministry;
 assert.equal(r.owner,owner);assert.deepEqual(r.serves,[owner]);assert.deepEqual(r.grants,[]);
 const denied=await query('getMinistry',{ministryId},'synthetic-ungranted-portfolio-identity');assert.equal(denied.response.status,403);
 if(r.status==='provisional'){
  const review=(await query('buildMinistryReview',{owner,asOfDate:'2026-10-02'})).body.result;
  assert.equal(review.coverage.events,'not_configured');assert(!review.items.some(x=>x.ministryId===ministryId));
  await command('updateMinistry',{ministryId,expectedVersion:r.version,changes:{status:'archived'}},`${owner}-archive`);
 }
 r=(await query('getMinistry',{ministryId})).body.result.ministry;assert.equal(r.status,'archived');assert.equal(r.owner,owner);
 assert.equal(r.matters.length,0);assert.equal(r.calendarActions.length,0);
}
const legacy=(await query('getMinistry',{ministryId:'ministry-acceptance-20261002'})).body.result.ministry;
assert.equal(legacy.owner,'fbc');assert.equal(legacy.status,'archived');
console.log(JSON.stringify({status:'passed',ids,checks:['organization persisted independently','ungranted identity denied','provisional inventory creates no review demands','non-FBC calendar not configured by default','fresh reads preserve owner','legacy FBC record unchanged','synthetic records archived without tasks or calendar actions']}));
