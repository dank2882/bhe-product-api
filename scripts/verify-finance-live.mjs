import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Existing service credential is read only into process memory; never printed.
// This checks the authenticated owning API, not end-user OAuth acceptance.
const runtime=JSON.parse(execFileSync('gcloud',['run','services','describe','bhe-product-api','--project=location-map-985','--region=us-west1','--format=json']));
const env=Object.fromEntries(runtime.spec.template.spec.containers[0].env.map(e=>[e.name,e]));
const secret=env.BHE_API_KEY.valueFrom.secretKeyRef;
const apiKey=execFileSync('gcloud',['secrets','versions','access',secret.key,`--secret=${secret.name}`,'--project=location-map-985'],{encoding:'utf8'}).trim();
const subject=env.DAN_TRAVEL_OWNER_SUBJECTS.value.split(',')[0].trim();
const baseUrl=process.env.FINANCE_VERIFY_BASE_URL||runtime.status.url;
const headers=actor=>({'content-type':'application/json','x-api-key':apiKey,'x-bhe-actor-sub':actor,'x-bhe-actor-subjects':JSON.stringify([actor]),'x-bhe-task-role':'admin'});
const catalog=await fetch(`${baseUrl}/finance-forecast/operations`,{headers:headers(subject)});
assert.equal(catalog.status,200);const operations=await catalog.json();assert.equal(operations.catalogVersion,'1.0.0');assert.equal(operations.operations.length,14);
const before=await fetch(`${baseUrl}/finance-forecast/query`,{method:'POST',headers:headers(subject),body:JSON.stringify({operation:'listFinanceRecords',arguments:{kind:'funds'}})}).then(r=>r.json());
assert(before.ok);assert(Number.isInteger(before.result.version));
for(const path of ['operations','query','command']){
 const r=await fetch(`${baseUrl}/finance-forecast/${path}`,{method:path==='operations'?'GET':'POST',headers:{...headers('finance-ungranted-administrator'),'x-bhe-actor-subjects':JSON.stringify(['finance-ungranted-administrator',subject])},...(path!=='operations'?{body:JSON.stringify({operation:path==='query'?'getFinanceHistory':'saveFund',arguments:{expectedVersion:before.result.version,fund:{}},idempotencyKey:'finance-denied-live-test'})}:{})});
 assert.equal(r.status,403);assert.equal((await r.json()).error.code,'finance_access_denied');
}
const after=await fetch(`${baseUrl}/finance-forecast/query`,{method:'POST',headers:headers(subject),body:JSON.stringify({operation:'buildFinanceForecast',arguments:{limit:5}})}).then(r=>r.json());
assert(after.ok);assert.equal(after.result.version,before.result.version);
assert.equal(after.result.saved,false);
console.log(JSON.stringify({status:'passed',baseUrl,version:after.result.version,checks:['live catalog','exact owner query','ungranted administrator and owner-alias injection denied on all endpoints','denied command and forecast reads leave version unchanged'],boundary:'authenticated owning API; user OAuth and usability are separate'}));
