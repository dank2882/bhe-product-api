'use strict';
const {createHash}=require('node:crypto');
const sharp=require('sharp');
const {readCompleteQuery}=require('./complete-query');
const {getStaffAuthorizationProfileId}=require('./staff-authorization-service');
const MAX_BYTES=25*1024*1024;
function fail(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
function text(v,max=500,required=false){if(v===undefined||v===null)v='';if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail('Invalid or missing text field');return v;}
function id(v){const s=text(v,100,true);if(!/^[a-zA-Z0-9_-]+$/.test(s))fail('Invalid repository entry ID');return s;}
function hash(v){return createHash('sha256').update(v).digest('hex');}
function publicEntry(e){const {storagePath,requestHash,...safe}=e;return safe;}
async function authorize(subject,write,deps){
 if(!subject)fail('Individual staff identity required',403);
 const s=await deps.profiles.doc(getStaffAuthorizationProfileId(subject)).get();
 const p=s.exists?s.data():null;
 if(!p||p.status!=='active'||!p.permissions?.includes('repository.read')||(write&&!p.permissions.includes('repository.write')))fail('Knowledge Repository permission required',403);
 return {subject,name:p.displayName||'',email:p.email||''};
}
async function required(entryId,deps,kind){const s=await deps.entries.doc(id(entryId)).get();if(!s.exists)fail('Repository entry not found',404);const e=s.data();if(kind&&e.kind!==kind)fail(`Expected a repository ${kind}`);return e;}
function safeUrl(value){let u;try{u=new URL(value);}catch{fail('No usable image file was handed off. Attach the original image file and try again.');}
 const host=u.hostname.toLowerCase();
 const allowed=host==='storage.googleapis.com'||host==='files.openai.com'||host==='oaiusercontent.com'||host.endsWith('.oaiusercontent.com')||host.endsWith('.blob.core.windows.net');
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!allowed)fail('Image upload requires a host-authorized file download, not a chat, sandbox, or arbitrary web link');return u.href;
}
async function download(file,deps){
 if(!file||!file.download_link)fail('Image bytes were not handed off. Attach the original image file and try again.');
 let url=safeUrl(file.download_link),r;
 for(let n=0;n<4;n++){
  r=await (deps.fetchImpl||fetch)(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
  if(![301,302,303,307,308].includes(r.status))break;
  if(n===3||!r.headers.get('location'))fail('Image download redirected too many times');
  url=safeUrl(new URL(r.headers.get('location'),url).href);
 }
 if(!r.ok)fail('Image file link expired or could not be downloaded; attach the original file again');
 if(Number(r.headers.get('content-length'))>MAX_BYTES){await r.body?.cancel();fail('Image exceeds 25 MB',413);}
 const parts=[];let size=0;
 for await(const part of r.body){size+=part.length;if(size>MAX_BYTES)fail('Image exceeds 25 MB',413);parts.push(part);}
 if(!size)fail('Image file is empty');
 const bytes=Buffer.concat(parts);
 let metadata;try{metadata=await sharp(bytes,{limitInputPixels:40000000}).metadata();await sharp(bytes,{limitInputPixels:40000000}).stats();}catch{fail('The uploaded file is not a supported, valid image');}
 if(!['png','jpeg','webp'].includes(metadata.format)||metadata.pages>1)fail('Use a single PNG, JPEG, or WebP image');
 return {bytes,checksumSha256:hash(bytes),width:metadata.width,height:metadata.height,contentType:'image/'+metadata.format,extension:metadata.format==='jpeg'?'jpg':metadata.format};
}
async function save(input,subject,deps){
 const actor=await authorize(subject,true,deps);
 if(!['image','note','folder'].includes(input.kind))fail('kind must be image, note, or folder');
 const title=text(input.title,500,true).trim(),folderId=input.folderId?id(input.folderId):'';
 if(folderId)await required(folderId,deps,'folder');
 const tags=input.tags||[];if(!Array.isArray(tags)||tags.length>30)fail('Use up to 30 tags');tags.forEach(t=>text(t,100,true));
 const relatedEntryIds=input.relatedEntryIds||[];if(!Array.isArray(relatedEntryIds)||relatedEntryIds.length>20)fail('Use up to 20 related entries');
 for(const entryId of relatedEntryIds)await required(entryId,deps);
 const key=text(input.idempotencyKey,200,true);if(key.length<8)fail('Use an idempotency key of at least 8 characters');
 const fields={kind:input.kind,title,folderId,description:text(input.description,10000),tags,relatedEntryIds,
  content:input.kind==='note'?text(input.content,100000,true):'',prompt:input.kind==='image'?text(input.prompt,20000):'',
  sourceType:input.kind==='image'?(input.sourceType||'unspecified'):'user_information',sourceNotes:text(input.sourceNotes,10000)};
 if(!['generated','source','edited','unspecified','user_information'].includes(fields.sourceType))fail('Invalid sourceType');
 const fileIdentity=input.kind==='image'?text(input.file?.id||input.file?.file_id,500,true):'';
 const requestHash=hash(JSON.stringify({...fields,fileIdentity}));
 const entryId=input.kind==='folder'?'folder-'+hash(folderId+'\n'+title.toLowerCase()).slice(0,32):'entry-'+hash(subject+'\n'+key).slice(0,32);
 const ref=deps.entries.doc(entryId),existing=await ref.get();
 if(existing.exists){const e=existing.data();if(input.kind!=='folder'&&e.requestHash!==requestHash)fail('Idempotency key was already used for different content',409);return {action:'existing',entry:publicEntry(e)};}
 let image={};
 if(input.kind==='image'){
  const prepared=await download(input.file,deps),storagePath=`repository/library/${entryId}/${prepared.checksumSha256}.${prepared.extension}`;
  const object=deps.bucket.file(storagePath);
  try{await object.save(prepared.bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:prepared.contentType,cacheControl:'private, max-age=0',metadata:{checksumSha256:prepared.checksumSha256}}});}catch(e){if(Number(e.code)!==412)throw e;}
  const [stored]=await object.download();if(hash(stored)!==prepared.checksumSha256)fail('Stored image checksum did not match',500);
  image={storagePath,checksumSha256:prepared.checksumSha256,sizeBytes:prepared.bytes.length,width:prepared.width,height:prepared.height,contentType:prepared.contentType,fileName:entryId+'.'+prepared.extension};
 }
 const record={entryId,...fields,...image,owner:'bhe',visibility:'repository_staff',createdBy:actor,createdAt:new Date().toISOString(),version:1,requestHash};
 const result=await deps.db.runTransaction(async tx=>{
  const current=await tx.get(ref);
  if(current.exists){const e=current.data();if(input.kind!=='folder'&&e.requestHash!==requestHash)fail('Idempotency conflict',409);return {action:'existing',entry:publicEntry(e)};}
  tx.create(ref,record);tx.create(deps.audit.doc(entryId),{entryId,action:'create',actor,createdAt:record.createdAt,requestHash});return {action:'created',entry:publicEntry(record)};
 });
 const verified=await ref.get();if(!verified.exists||verified.data().requestHash!==record.requestHash&&input.kind!=='folder')fail('Repository save readback failed',500);
 return result;
}
async function query(input,subject,deps){
 await authorize(subject,false,deps);
 if(input.operation==='gallery')return gallery(input,deps);
 if(input.operation==='get')return {entry:publicEntry(await required(input.entryId,deps))};
 if(input.operation==='download'){
  const entry=await required(input.entryId,deps,'image'),expires=Date.now()+15*60*1000;
  const [url]=await deps.bucket.file(entry.storagePath).getSignedUrl({version:'v4',action:'read',expires,responseDisposition:`inline; filename="${entry.fileName}"`});
  return {entry:publicEntry(entry),download:{url,expiresAt:new Date(expires).toISOString()}};
 }
 if(input.operation!=='search')fail('Unknown repository library query');
 const term=text(input.query,500).toLowerCase().trim(),limit=input.limit??30;
 if(!Number.isInteger(limit)||limit<1||limit>100)fail('limit must be 1–100');
 if(input.kind&&!['image','note','folder'].includes(input.kind))fail('Invalid kind');
 let q=deps.entries;
 if(input.folderId!==undefined){if(input.folderId)await required(input.folderId,deps,'folder');q=q.where('folderId','==',input.folderId);}
 const docs=await readCompleteQuery(q);
 const matches=docs.map(d=>d.data()).filter(e=>(!input.kind||e.kind===input.kind)&&(!term||[e.title,e.description,e.content,e.prompt,e.sourceNotes,...(e.tags||[])].join('\n').toLowerCase().includes(term))).sort((a,b)=>a.entryId.localeCompare(b.entryId));
 const after=input.after?id(input.after):'';const remaining=matches.filter(e=>e.entryId>after),page=remaining.slice(0,limit);
 return {entries:page.map(publicEntry),count:page.length,totalMatches:matches.length,nextAfter:remaining.length>limit?page.at(-1).entryId:null,searchType:'keyword',coverage:{complete:true,scanned:docs.length}};
}
async function thumbnail(entry,deps) {
 const path=`repository/library/${entry.entryId}/thumbnails/${entry.checksumSha256}-480-v1.webp`;
 const file=deps.bucket.file(path);
 if(!(await file.exists())[0]) {
  const [bytes]=await deps.bucket.file(entry.storagePath).download();
  const preview=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:480,height:360,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();
  try { await file.save(preview,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'image/webp',cacheControl:'private, max-age=900'}}); }
  catch(error) { if(Number(error.code)!==412)throw error; }
 }
 const expires=Date.now()+15*60*1000;
 const [url]=await file.getSignedUrl({version:'v4',action:'read',expires});
 return {url,expiresAt:new Date(expires).toISOString()};
}
async function gallery(input,deps) {
 const folderId=input.folderId?id(input.folderId):'',term=text(input.query,500).trim().toLowerCase();
 const scope=input.scope||'folder',limit=input.limit??24,after=input.after?id(input.after):'';
 if(!['folder','all'].includes(scope))fail('scope must be folder or all');
 if(!Number.isInteger(limit)||limit<1||limit>48)fail('Gallery limit must be 1–48');
 const entries=(await readCompleteQuery(deps.entries)).map(d=>d.data());
 const byId=new Map(entries.map(e=>[e.entryId,e]));
 if(folderId&&byId.get(folderId)?.kind!=='folder')fail('Repository folder not found',404);
 function ancestors(entry) {
  const result=[],seen=new Set();let cursor=entry?.folderId;
  while(cursor){if(seen.has(cursor))fail('Repository folder hierarchy is invalid',409);seen.add(cursor);const f=byId.get(cursor);if(!f||f.kind!=='folder')fail('Repository folder hierarchy is incomplete',409);result.unshift({entryId:f.entryId,title:f.title});cursor=f.folderId;}
  return result;
 }
 const folders=entries.filter(e=>e.kind==='folder'),images=entries.filter(e=>e.kind==='image');
 const counts=new Map(folders.map(f=>[f.entryId,{imageCount:0,totalImageCount:0}]));
 for(const image of images){const parent=counts.get(image.folderId);if(parent)parent.imageCount++;for(const f of ancestors(image))counts.get(f.entryId).totalImageCount++;}
 const selectedFolder=folderId?byId.get(folderId):null;
 const breadcrumbs=[{entryId:'',title:'All folders'},...(selectedFolder?[...ancestors(selectedFolder),{entryId:folderId,title:selectedFolder.title}]:[])];
 const visibleFolders=folders.filter(f=>(scope==='all'||f.folderId===folderId)&&(!term||f.title.toLowerCase().includes(term))).sort((a,b)=>a.title.localeCompare(b.title)||a.entryId.localeCompare(b.entryId)).map(f=>({entryId:f.entryId,title:f.title,folderId:f.folderId,...counts.get(f.entryId),path:ancestors(f)}));
 const matches=images.filter(e=>(scope==='all'||e.folderId===folderId)&&(!term||[e.title,e.description,e.prompt,e.sourceNotes,...(e.tags||[])].join('\n').toLowerCase().includes(term))).sort((a,b)=>a.entryId.localeCompare(b.entryId));
 const remaining=matches.filter(e=>e.entryId>after),page=remaining.slice(0,limit),results=[];
 // Bound storage work to four images at a time. A missing image must not hide the rest.
 for(let i=0;i<page.length;i+=4){results.push(...await Promise.all(page.slice(i,i+4).map(async e=>{
  const card={entryId:e.entryId,title:e.title,folderId:e.folderId,folderPath:ancestors(e),description:e.description,sourceType:e.sourceType,width:e.width,height:e.height,tags:e.tags,createdAt:e.createdAt};
  try{return {...card,thumbnail:await thumbnail(e,deps)};}catch{return {...card,thumbnail:null,thumbnailError:'Preview unavailable; open the image to retry.'};}
 })));}
 return {folderId,scope,query:input.query||'',breadcrumbs,folders:visibleFolders,images:results,totalImages:images.length,totalMatches:matches.length,nextAfter:remaining.length>limit?page.at(-1).entryId:null,coverage:{complete:true,scanned:entries.length},generatedAt:new Date().toISOString()};
}
module.exports={save,query,authorize,download,safeUrl};
