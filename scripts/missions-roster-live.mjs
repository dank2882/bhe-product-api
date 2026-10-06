// Explicit operator utility for the approved FBC roster. Input/source data must
// be outside Git. Credentials remain in memory; logs contain counts only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [mode,inputPath,overrideUrl] = process.argv.slice(2);
if(!['import','verify'].includes(mode)||!inputPath)throw Error('Usage: node scripts/missions-roster-live.mjs import|verify /private/input.json [candidate-url]');
const input=JSON.parse(readFileSync(inputPath,'utf8'));
const runtime=JSON.parse(execFileSync('gcloud',['run','services','describe','bhe-product-api','--project=location-map-985','--region=us-west1','--format=json']));
const env=Object.fromEntries(runtime.spec.template.spec.containers[0].env.map(e=>[e.name,e]));
const secret=env.BHE_API_KEY.valueFrom.secretKeyRef;
const apiKey=execFileSync('gcloud',['secrets','versions','access',secret.key,`--secret=${secret.name}`,'--project=location-map-985'],{encoding:'utf8'}).trim();
const subject=env.DAN_TRAVEL_OWNER_SUBJECTS.value.split(',')[0].trim();
const base=overrideUrl||runtime.status.url;
async function call(operation,args={},key,actor=subject){
 const response=await fetch(`${base}/ministry-overview/${key?'command':'query'}`,{method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey,'x-bhe-actor-sub':actor,'x-bhe-actor-subjects':JSON.stringify([actor]),'x-bhe-task-role':'admin'},body:JSON.stringify({operation,arguments:args,...(key?{idempotencyKey:key}:{})})});
 const data=await response.json();if(!response.ok||!data.ok)throw Object.assign(Error(`${operation}: ${data.error?.code||response.status}`),{code:data.error?.code});return data.result;
}
let cursor='',matches=[];
do{const r=await call('listMinistries',{query:'mission',owner:'fbc',includeArchived:true,limit:100,...(cursor?{cursor}:{})});matches.push(...r.items);cursor=r.nextCursor;}while(cursor);
if(matches.length>1)throw Error('Resolve multiple FBC ministry matches before import');
let ministryId=matches[0]?.ministryId;
if(!ministryId){
 if(mode!=='import')throw Error('FBC Missions does not exist');
 const r=await call('createMinistry',{ministryId:'ministry-fbc-missions',name:'FBC Missions',profile:{owner:'fbc',purpose:'Church missions recipient roster and monthly support commitments.'}},'fbc-missions-profile-20261006-v1');ministryId=r.ministry.ministryId;
}
const ministry=(await call('getMinistry',{ministryId})).ministry;assert.equal(ministry.owner,'fbc');assert.deepEqual(ministry.grants,[]);
const before=(await call('getMinistry',{ministryId:'ministry-gom-planning'})).ministry;
const preview=await call('previewMissionImport',{ministryId,...input});
if(mode==='import'&&preview.addedCount){
 const args={ministryId,...input,expectedVersion:preview.version,previewHash:preview.previewHash};
 const key=`fbc-missions-import-${preview.previewHash.slice(0,40)}`;
 const saved=await call('importMissionRoster',args,key);
 const replay=await call('importMissionRoster',args,key);assert.deepEqual(replay.receipt,saved.receipt);
}
if(mode==='verify'&&preview.addedCount)throw Error('Roster import is incomplete');
const rows=[];cursor='';let version;
do{const r=await call('listMissionRecipients',{ministryId,limit:100,...(cursor?{cursor}:{})});version??=r.version;assert.equal(r.version,version);rows.push(...r.items);cursor=r.nextCursor;}while(cursor);
assert.equal(rows.length,input.rows.length);
for(const expected of input.rows){
 const r=rows.find(r=>r.sourceRowKey===expected.key);assert(r);
 const exact=(await call('getMissionRecipient',{ministryId,recipientId:r.recipientId})).recipient;
 assert.deepEqual(exact,r);assert.equal(exact.exactText,expected.exactText);
 for(const [key,value] of Object.entries(expected.recipient))assert.deepEqual(exact[key],value);
 for(const [key,value] of Object.entries(expected.support))assert.deepEqual(exact.support[key],value);
 if(expected.coveredByRowKey){const parent=rows.find(x=>x.sourceRowKey===expected.coveredByRowKey);assert.equal(exact.support.coveredBySupportId,parent.support.supportId);}
}
const source=(await call('getMissionSource',{ministryId,sourceId:preview.sourceId})).source;
assert.deepEqual(source.evidence,input.source);
const summary=await call('getMissionSupportSummary',{ministryId});assert.equal(summary.recipientCount,input.rows.length);
const expectedTotal=input.rows.filter(r=>!r.coveredByRowKey&&r.support.status!=='paused'&&r.support.status!=='ended').reduce((n,r)=>n+(r.support.amountCents||0),0);
assert.equal(summary.listedAmountCents,expectedTotal);
await assert.rejects(call('getMissionSupportSummary',{ministryId},undefined,'missions-acceptance-outsider'),e=>e.code==='missions_access_denied');
const after=(await call('getMinistry',{ministryId:'ministry-gom-planning'})).ministry;assert.deepEqual(after,before);
console.log(JSON.stringify({status:'passed',ministryId,version,recipientCount:rows.length,sourceRowCount:input.rows.length,sourceHash:createHash('sha256').update(input.source.exactText).digest('hex'),checks:['every recipient and support independently reread','source bytes and basis preserved','group relationships verified','listed total reconciled','Dan-only denial','GO Missions unchanged','no ministry grants'],boundary:'Authenticated owning backend; installed ChatGPT acceptance remains separate'}));
