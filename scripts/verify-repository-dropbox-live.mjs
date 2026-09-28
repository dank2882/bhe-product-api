#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {Firestore} from '@google-cloud/firestore';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const project='location-map-985',db=new Firestore({projectId:project,databaseId:'chatgptstorage'});
const service=JSON.parse(execFileSync('gcloud',['run','services','describe','bhe-product-api','--project='+project,'--region=us-west1','--format=json'],{encoding:'utf8'}));
const base=process.argv.includes('--staged')?service.status.traffic.find(t=>t.tag==='dropbox-review')?.url:service.status.url;
if(!base)throw Error('Verification endpoint unavailable');
const env=service.spec.template.spec.containers[0].env;
const secret=env.find(e=>e.name==='BHE_API_KEY').valueFrom.secretKeyRef;
const key=execFileSync('gcloud',['secrets','versions','access',secret.key,'--secret='+secret.name,'--project='+project],{encoding:'utf8'}).trim();
const profiles=await db.collection('staffAuthorizationProfiles').where('email','==','dank@foundedonfaith.com').get();
const currentProfiles=profiles.docs.map(d=>d.data()).filter(p=>p.status==='active'&&p.subject?.startsWith('entra|8645ddd9-9cc8-4b1b-9d95-1eddf5df7492|'));
if(currentProfiles.length!==1)throw Error('Ambiguous current Entra operator identity');const profile=currentProfiles[0];
const subject=profile.subject||profile.actorSubject; if(!subject)throw Error('Operator subject unavailable');
async function call(body,actor=subject){const r=await fetch(base+'/repository/library/query',{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'x-bhe-actor-sub':actor},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};}
const result=await call({operation:'gallery',scope:'all',limit:48});if(result.status!==200||!result.value.ok)throw Error('Gallery query failed: '+JSON.stringify(result.value));
const records=(await db.collection('repositoryLibraryEntries').where('activeKind','==','image').get()).docs.map(d=>d.data());
if(result.value.images.length!==records.length)throw Error('Gallery count mismatch');
for(const entry of records){
 const card=result.value.images.find(i=>i.entryId===entry.entryId);if(!card?.thumbnail?.url)throw Error('Missing preview');
 for(const variant of ['preview','original']){
  const response=variant==='original'?await call({operation:'download',entryId:entry.entryId}):null;
  const source=variant==='original'?response.value.download.url:card.thumbnail.url;
  const path=new URL(source).pathname;const r=await fetch(base+path);if(!r.ok)throw Error('Media response failed '+r.status);
  const bytes=Buffer.from(await r.arrayBuffer());await sharp(bytes).metadata();
  if(variant==='original'&&createHash('sha256').update(bytes).digest('hex')!==entry.checksumSha256)throw Error('Original checksum mismatch');
 }
}
const denied=await call({operation:'gallery',scope:'all'},'unauthorized-verification-actor');if(denied.status!==403)throw Error('Unauthorized gallery access was not denied');
const signed=new URL(result.value.images[0].thumbnail.url).pathname;
const bad=await fetch(base+signed.slice(0,-1)+(signed.endsWith('a')?'b':'a'));if(bad.status!==403)throw Error('Tampered media capability was not denied');
console.log(JSON.stringify({verified:true,endpoint:base,images:records.length,previews:records.length,originalChecksums:true,unauthorizedDenied:true,tamperingDenied:true,sync:result.value.sync||null}));
