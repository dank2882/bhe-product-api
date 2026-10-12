import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {repositoryLiveClient} from './lib/repository-live-client.mjs';
const {db,request,service,subject}=repositoryLiveClient();
const prefix='Repository verification '+Date.now(),ids=[],libraryIds=[],revisions=[],cacheIds=new Set(),checks=[];
const hash=s=>createHash('sha256').update(s).digest('hex');
const model=service.spec.template.spec.containers[0].env.find(e=>e.name==='VERTEX_TEXT_EMBEDDING_MODEL')?.value||'text-embedding-005';
async function call(mode,op,args){const r=await request(mode,op,args);assert.equal(r.body.ok,true,JSON.stringify({op,status:r.status,error:r.body.error}));return r.body;}
async function indexed(sourceId){for(let i=0;i<90;i++){const s=await call('query','getIndexingStatus',{sourceId});if(s.indexingStatus==='completed')return s;if(s.indexingStatus==='failed')throw Error('Live indexing failed');await new Promise(r=>setTimeout(r,2000));}throw Error('Live indexing did not finish within verification window');}
try{
 assert.equal((await request('query','searchSources',{query:prefix},'unregistered-source-test')).status,403);
 const noKey=await request('query','searchSources',{query:prefix},subject,false);assert([401,403].includes(noKey.status));checks.push('unknown actor and missing backend credential denied');
 const noteText='Exact synthetic note for automatic source indexing.  Preserve spacing.';
 const note=await request('save','',{kind:'note',title:prefix+' automatic note',content:noteText,idempotencyKey:prefix+'-note'},subject,true,'library');
 assert(note.body.ok);libraryIds.push(note.body.entry.entryId);
 assert(note.body.sourceIndexing?.sourceId);ids.push(note.body.sourceIndexing.sourceId);
 assert.equal((await call('query','getSource',{sourceId:note.body.sourceIndexing.sourceId,includeText:true})).text,noteText);
 checks.push('library note automatically indexed with exact source text');
 await indexed(note.body.sourceIndexing.sourceId);
 const classified=await call('command','importSource',{entryId:note.body.entry.entryId,sourceType:'article',contentKind:'exact_text',expectedVersion:1,idempotencyKey:prefix+'-classify'});
 const classifiedRead=await call('query','getSource',{sourceId:classified.sourceId,includeText:true});
 assert.equal(classifiedRead.source.sourceType,'article');assert.equal(classifiedRead.source.origin.recordId,note.body.entry.entryId);assert.equal(classifiedRead.text,noteText);
 checks.push('existing source classification preserves owning record and original text');

 const articleText='Fixture only, not historical evidence.\n\n# Captivity\n  Tyndale imprisonment appears in this synthetic article.  ';
 const lessonText='Fixture only, not historical evidence.\n\n# Faithfulness\nTyndale imprisonment appears in these synthetic teaching notes.';
 const a=await call('command','saveSource',{title:prefix+' Tyndale article',sourceType:'article',contentKind:'exact_text',text:articleText,idempotencyKey:prefix+'-article'});ids.push(a.sourceId);
 const b=await call('command','saveSource',{title:prefix+' Tyndale lesson',sourceType:'lesson',contentKind:'lesson_notes',speaker:'Verification fixture',sourceDate:'2026-10-11',text:lessonText,idempotencyKey:prefix+'-lesson'});ids.push(b.sourceId);
 for(const [r,text] of [[a,articleText],[b,lessonText]]){
  const got=await call('query','getSource',{sourceId:r.sourceId,includeText:true});assert.equal(got.text,text);revisions.push(r.revisionId);
 }
 const results=await call('query','searchSources',{query:prefix,sourceType:'lesson',speaker:'Verification fixture'});assert(results.results.some(r=>r.sourceId===b.sourceId));assert(!results.results.some(r=>r.sourceId===a.sourceId));checks.push('separate article and lesson recall; exact text read-back');
 const jobs=await Promise.all(ids.map(indexed));checks.push('Cloud Tasks and real Vertex indexing completed');
 const retrieved=await call('query','searchPassages',{query:'captivity',sourceId:a.sourceId,maxCharacters:2000});
 assert.equal(retrieved.coverage.semanticStatus,'available');assert(retrieved.results.length>0);assert(retrieved.coverage.returnedCharacters<=2000);
 for(const p of retrieved.results){assert.equal(articleText.slice(p.citation.startOffset,p.citation.endOffset),p.text);assert.equal(p.citation.sourceId,a.sourceId);}
 checks.push('real Firestore vector search; bounded response; exact source citation');
 const duplicate=await call('command','saveSource',{title:prefix+' Tyndale article',sourceType:'article',contentKind:'exact_text',text:articleText,idempotencyKey:prefix+'-article'});assert(duplicate.replayed);assert.equal(duplicate.sourceId,a.sourceId);
 const update=await call('command','saveSource',{sourceId:a.sourceId,expectedVersion:1,title:prefix+' Tyndale article',sourceType:'article',contentKind:'exact_text',text:articleText,sourceNotes:'Fixture metadata correction',idempotencyKey:prefix+'-revision'});revisions.push(update.revisionId);
 const job=await indexed(a.sourceId);assert(job.cacheHits>0);assert.equal(job.embeddingCalls,0);
 const old=await call('query','getSource',{sourceId:a.sourceId,version:1,includeText:true});assert.equal(old.text,articleText);
 const stale=await request('command','saveSource',{sourceId:a.sourceId,expectedVersion:1,title:'Changed',sourceType:'article',contentKind:'exact_text',text:'Changed',idempotencyKey:prefix+'-stale'});assert.equal(stale.status,409);
 checks.push('idempotent save; stale update rejected; old revision retained; unchanged text reused embeddings');
 console.log(JSON.stringify({ok:true,releaseVersion:service.status.traffic.find(t=>t.percent===100)?.revisionName,checks,
  indexing:jobs.map(j=>({embeddingCalls:j.embeddingCalls,cacheHits:j.cacheHits})),metadataUpdate:{embeddingCalls:job.embeddingCalls,cacheHits:job.cacheHits},
  retrievalMetrics:retrieved.metrics,responseBytes:Buffer.byteLength(JSON.stringify(retrieved)),clientAcceptance:'Not tested; trusted backend identity verification only'},null,2));
}finally{
 // Delete only this run's synthetic fixtures, after checking their exact title prefix.
 for(const sourceId of ids){
  const ref=db.collection('repositorySources').doc(sourceId),snap=await ref.get();if(!snap.exists||!snap.data().title.startsWith(prefix))continue;
  const revisionDocs=(await db.collection('repositorySourceRevisions').where('sourceId','==',sourceId).get()).docs;
  for(const rev of revisionDocs){
   const s=rev.data().source;
   const chunks=(await db.collection('repositorySourceChunks').where('revisionId','==',rev.id).get()).docs;
   for(const c of chunks){const data=c.data();cacheIds.add(hash(model+'\n'+s.title+'\n'+data.sectionTitle+'\n'+data.text));await c.ref.delete();}
   await db.collection('repositorySourceJobs').doc(rev.id).delete();await rev.ref.delete();
  }
  const executions=await db.collection('repositorySourceExecutions').where('receipt.sourceId','==',sourceId).get();for(const d of executions.docs)await d.ref.delete();
  await db.collection('repositorySourceAudit').doc(sourceId+'-fixture-cleanup').create({sourceId,action:'verification_fixture_cleanup',createdAt:new Date().toISOString()});
  await ref.delete();assert.equal((await ref.get()).exists,false);
 }
 for(const cacheId of cacheIds)await db.collection('repositorySourceEmbeddingCache').doc(cacheId).delete();
 for(const entryId of libraryIds){const ref=db.collection('repositoryLibraryEntries').doc(entryId),snap=await ref.get();if(snap.exists&&snap.data().title.startsWith(prefix))await ref.delete();}
}
