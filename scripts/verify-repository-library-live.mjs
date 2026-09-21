import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Firestore} from '@google-cloud/firestore';
import {Storage} from '@google-cloud/storage';
const project='location-map-985',db=new Firestore({projectId:project,databaseId:'chatgptstorage'});
const service=JSON.parse(execFileSync('gcloud',['run','services','describe','bhe-product-api','--project='+project,'--region=us-west1','--format=json'],{encoding:'utf8'}));
const base=process.argv[2]||service.status.url;
const env=service.spec.template.spec.containers[0].env;
const secret=env.find(e=>e.name==='BHE_API_KEY')?.valueFrom?.secretKeyRef||env.find(e=>e.name==='API_KEY')?.valueFrom?.secretKeyRef;
if(!secret)throw Error('Existing backend secret reference not found');
const key=execFileSync('gcloud',['secrets','versions','access',secret.key,'--secret='+secret.name,'--project='+project],{encoding:'utf8'}).trim();
const markDocs=await db.collection('staffAuthorizationProfiles').where('email','==','marks@foundedonfaith.com').get();
if(markDocs.size!==1)throw Error('Ambiguous Mark identity');
const mark=markDocs.docs[0].data();
const prefix='repository-verification-'+Date.now();
const bucketName=env.find(e=>e.name==='BUCKET_NAME')?.value||'bhe-product-assets';
const bucket=new Storage({projectId:project}).bucket(bucketName),sourcePath=`repository/verification/${prefix}.png`;
const ids=[];let savedPath='';
function check(v,msg){if(!v)throw Error(msg);}
async function request(mode,body,actor=mark.subject,withKey=true){const headers={'content-type':'application/json','x-bhe-actor-sub':actor};if(withKey)headers['x-api-key']=key;const r=await fetch(base+'/repository/library/'+mode,{method:'POST',headers,body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
try{
 const denied=await request('query',{operation:'search'},'repository-verification-unregistered');check(denied.status===403,'Unknown actor must be denied');
 const noKey=await request('query',{operation:'search'},mark.subject,false);check(noKey.status===401||noKey.status===403,'API key required');
 const folder=await request('save',{kind:'folder',title:prefix,idempotencyKey:prefix+'-folder'});check(folder.body.ok,'Folder save failed: '+JSON.stringify(folder.body));ids.push(folder.body.entry.entryId);
 const note=await request('save',{kind:'note',title:prefix+' information',folderId:ids[0],content:'Exact verification information\n  Preserve spacing.',idempotencyKey:prefix+'-note'});check(note.body.ok,'Note failed');ids.push(note.body.entry.entryId);
 const exact=await request('query',{operation:'get',entryId:ids[1]});check(exact.body.entry.content==='Exact verification information\n  Preserve spacing.','Exact note changed');
 const sourceUrl='https://storage.googleapis.com/cloud-samples-data/vision/ocr/sign.jpg';
 const sourceResponse=await fetch(sourceUrl);check(sourceResponse.ok,'Public test fixture unavailable');
 const bytes=Buffer.from(await sourceResponse.arrayBuffer());
 const upload={kind:'image',title:prefix+' image',folderId:ids[0],description:'Temporary system verification fixture, not historical evidence.',sourceType:'source',sourceNotes:'Public Google Cloud vision OCR sample used only for temporary system verification.',file:{file_id:prefix,download_link:sourceUrl},idempotencyKey:prefix+'-image'};
 const image=await request('save',upload);check(image.body.ok,'Image save failed: '+JSON.stringify(image.body));ids.push(image.body.entry.entryId);
 const stored=(await db.collection('repositoryLibraryEntries').doc(ids[2]).get()).data();savedPath=stored.storagePath;
 const checksum=createHash('sha256').update(bytes).digest('hex');check(image.body.entry.checksumSha256===checksum,'Original checksum failed');check(image.body.entry.createdBy.subject===mark.subject,'Actor attribution failed');
 const retry=await request('save',upload);check(retry.body.action==='existing'&&retry.body.entry.entryId===ids[2],'Retry duplicated');
 const conflict=await request('save',{...upload,title:'Different'});check(conflict.status===409,'Changed idempotency intent not rejected');
 const found=await request('query',{operation:'search',query:prefix,folderId:ids[0]});check(found.body.count===2,'Search failed');
 const link=await request('query',{operation:'download',entryId:ids[2]});check(link.body.ok&&link.body.download?.url,'Signed download failed: '+JSON.stringify(link.body));
 const downloaded=await fetch(link.body.download.url);check(downloaded.ok,'Download unavailable');check(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex')===checksum,'Downloaded bytes differ');
 console.log(JSON.stringify({ok:true,base,actorEmail:mark.email,verification:'trusted backend identity test, not Pastor client OAuth',checks:['missing API key denied','unknown actor denied','Mark folder create','exact information save/read','host-reference image upload','stored checksum','actor attribution','duplicate-safe retry','changed intent denied','keyword search','signed download byte equality'],entryIds:ids},null,2));
}finally{
 // Remove only this run's explicitly named test fixtures. Preserve append-only audit records.
 for(const entryId of ids){const ref=db.collection('repositoryLibraryEntries').doc(entryId);const s=await ref.get();if(s.exists&&s.data().title.startsWith(prefix)){await db.collection('repositoryLibraryAudit').doc(entryId+'-test-cleanup').create({entryId,action:'verification_fixture_cleanup',createdAt:new Date().toISOString()});await ref.delete();}}
 await bucket.file(sourcePath).delete({ignoreNotFound:true});if(savedPath)await bucket.file(savedPath).delete({ignoreNotFound:true});
}
