'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp');
const {save,query,safeUrl}=require('../lib/repository-library-service');
function setup(){
 const data=new Map(),blobs=new Map();let uploads=0;
 function collection(prefix){return {doc(id){const key=prefix+'/'+id;return {key,async get(){return {exists:data.has(key),data:()=>data.get(key)};}};},limit(){return this;},where(field,valueOp,value){return {...this,filter:[field,value]};},async get(){return {docs:[...data].filter(([k,v])=>k.startsWith(prefix+'/')&&(!this.filter||v[this.filter[0]]===this.filter[1])).map(([k,v])=>({id:k.split('/')[1],data:()=>v}))};}};}
 const deps={entries:collection('entries'),audit:collection('audit'),profiles:{doc(subject){return {async get(){return {exists:true,data:()=>({status:'active',permissions:subject===require('../lib/staff-authorization-service').getStaffAuthorizationProfileId('viewer')?['repository.read']:subject===require('../lib/staff-authorization-service').getStaffAuthorizationProfileId('denied')?[]:['repository.read','repository.write'],displayName:'Test'})};}};}},db:{async runTransaction(fn){return fn({get:ref=>ref.get(),create(ref,value){assert(!data.has(ref.key));data.set(ref.key,value);}});}},bucket:{file(path){return {async exists(){return [blobs.has(path)];},async save(bytes){uploads++;blobs.set(path,bytes);},async download(){return [blobs.get(path)];},async getSignedUrl(){return ['https://storage.googleapis.com/test/signed'];}};}},fetchImpl:async()=>new Response(await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer())};
 return {deps,data,blobs,uploads:()=>uploads};
}
const note={kind:'note',title:'Printing press',content:'Exact information\n  with spacing.',idempotencyKey:'note-save-0001'};
test('exact note, folder deduplication, keyword recall and pagination',async()=>{
 const {deps}=setup();
 const f=await save({kind:'folder',title:'Museum',idempotencyKey:'folder-0001'},'editor',deps);
 const same=await save({kind:'folder',title:'museum',idempotencyKey:'folder-0002'},'editor',deps);assert.equal(same.entry.entryId,f.entry.entryId);
 const r=await save({...note,folderId:f.entry.entryId},'editor',deps);
 assert.equal((await query({operation:'get',entryId:r.entry.entryId},'viewer',deps)).entry.content,note.content);
 assert.equal((await query({operation:'search',query:'spacing',folderId:f.entry.entryId},'viewer',deps)).count,1);
 await save({...note,idempotencyKey:'note-save-0002',title:'Second'},'editor',deps);
 const page=await query({operation:'search',kind:'note',limit:1},'viewer',deps);assert(page.nextAfter);
 assert.equal((await query({operation:'search',kind:'note',limit:1,after:page.nextAfter},'viewer',deps)).count,1);
});
test('idempotent writes preserve first record and reject changed intent',async()=>{
 const {deps,data}=setup();const a=await save(note,'editor',deps),b=await save(note,'editor',deps);assert.equal(a.entry.entryId,b.entry.entryId);assert.equal(b.action,'existing');assert.equal(data.size,2);
 await assert.rejects(save({...note,content:'changed'},'editor',deps),e=>e.statusCode===409);
});
test('live role checks deny unprivileged users and writes by viewers',async()=>{
 const {deps}=setup();await assert.rejects(save(note,'viewer',deps),e=>e.statusCode===403);
 await assert.rejects(query({operation:'search'},'denied',deps),e=>e.statusCode===403);
 await assert.rejects(save(note,'',deps),e=>e.statusCode===403);
});
test('image saves original bytes and prompt, verifies storage, recalls signed link, retries without refetch',async()=>{
 const {deps,uploads}=setup();const input={kind:'image',title:'Generated press',prompt:'A printing press',sourceType:'generated',file:{id:'file-test',download_link:'https://files.oaiusercontent.com/image.png'},idempotencyKey:'image-save-0001'};
 const r=await save(input,'editor',deps);assert.equal(r.entry.width,2);assert.equal(r.entry.sourceType,'generated');assert.equal(r.entry.prompt,input.prompt);assert(!r.entry.storagePath);
 const link=await query({operation:'download',entryId:r.entry.entryId},'viewer',deps);assert(link.download.url);assert(link.download.expiresAt);
 deps.fetchImpl=()=>{throw Error('must not refetch');};assert.equal((await save(input,'editor',deps)).action,'existing');assert.equal(uploads(),1);
});
test('missing handoff, unsafe links, redirect to internal URL, false image and excessive body are rejected without records',async()=>{
 const {deps,data}=setup(),base={kind:'image',title:'Image',idempotencyKey:'image-save-0001',file:{id:'file-test'}};
 await assert.rejects(save(base,'editor',deps));
 for(const url of ['http://files.oaiusercontent.com/a','https://169.254.169.254/','https://files.oaiusercontent.com.evil.test/a','sandbox:/mnt/data/a.png'])assert.throws(()=>safeUrl(url));
 const input={...base,file:{id:'file-test',download_link:'https://files.oaiusercontent.com/a'}};
 deps.fetchImpl=async()=>new Response(null,{status:302,headers:{location:'https://169.254.169.254/'}});await assert.rejects(save(input,'editor',deps));
 deps.fetchImpl=async()=>new Response('not an image');await assert.rejects(save(input,'editor',deps));
 deps.fetchImpl=async()=>new Response('x',{headers:{'content-length':'999999999'}});await assert.rejects(save(input,'editor',deps),e=>e.statusCode===413);
 assert.equal(data.size,0);
});
test('missing folder, invalid related entries and information download fail',async()=>{
 const {deps}=setup();await assert.rejects(save({...note,folderId:'missing'},'editor',deps),e=>e.statusCode===404);
 const r=await save(note,'editor',deps);await assert.rejects(query({operation:'download',entryId:r.entry.entryId},'viewer',deps));
});

test('gallery shows nested folder counts, searchable images, and private cached thumbnails',async()=>{
 const {deps,data,blobs,uploads}=setup();
 const folder=await save({kind:'folder',title:'Exhibits',idempotencyKey:'folder-gallery1'},'editor',deps);
 const child=await save({kind:'folder',title:'Printing',folderId:folder.entry.entryId,idempotencyKey:'folder-gallery2'},'editor',deps);
 const input={kind:'image',title:'Gutenberg',folderId:child.entry.entryId,prompt:'A printing press',sourceType:'generated',file:{id:'file-img',download_link:'https://files.oaiusercontent.com/a'},idempotencyKey:'gallery-image-1'};
 const image=await save(input,'editor',deps);
 const root=await query({operation:'gallery'},'viewer',deps);assert.equal(root.folders[0].totalImageCount,1);assert.equal(root.folders[0].imageCount,0);assert.equal(root.images.length,0);
 const nested=await query({operation:'gallery',folderId:child.entry.entryId},'viewer',deps);assert.equal(nested.images.length,1);assert.equal(nested.breadcrumbs.length,3);assert(nested.images[0].thumbnail.url);assert(!nested.images[0].storagePath);
 const thumb=[...blobs].find(([k])=>k.includes('/thumbnails/'));assert(thumb);assert.equal((await sharp(thumb[1]).metadata()).format,'webp');
 const beforeUploads=uploads(),beforeRecords=data.size;
 const all=await query({operation:'gallery',scope:'all',query:'printing press'},'viewer',deps);assert.equal(all.images[0].entryId,image.entry.entryId);assert.equal(uploads(),beforeUploads);assert.equal(data.size,beforeRecords);
 await assert.rejects(query({operation:'gallery'},'denied',deps),e=>e.statusCode===403);
 await assert.rejects(query({operation:'gallery',folderId:'missing'},'viewer',deps),e=>e.statusCode===404);
});
test('gallery pagination, empty search and missing preview remain explicit',async()=>{
 const {deps}=setup();
 for(let i=0;i<3;i++)await save({kind:'image',title:'Image '+i,file:{id:'file-'+i,download_link:'https://files.oaiusercontent.com/a'},idempotencyKey:'gallery-page-'+i},'editor',deps);
 const one=await query({operation:'gallery',limit:2},'viewer',deps);assert.equal(one.images.length,2);assert(one.nextAfter);
 const two=await query({operation:'gallery',limit:2,after:one.nextAfter},'viewer',deps);assert.equal(two.images.length,1);assert.equal(two.nextAfter,null);
 assert.equal((await query({operation:'gallery',query:'no-match'},'viewer',deps)).totalMatches,0);
 deps.bucket.file=()=>({exists:async()=>{throw Error('Storage unavailable');}});
 const broken=await query({operation:'gallery'},'viewer',deps);assert.equal(broken.images.length,3);assert.equal(broken.images[0].thumbnail,null);assert(broken.images[0].thumbnailError);
});
