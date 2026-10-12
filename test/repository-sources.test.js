'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./helpers/source-firestore');
const {getStaffAuthorizationProfileId}=require('../lib/staff-authorization-service');
const {run,processIndexingJob,makeChunks}=require('../lib/repository-source-service');
function setup(){
 const db=new Store(),profiles=db.collection('staffAuthorizationProfiles');
 const deps={db,profiles,embeddingModel:'test-model',toVectorValue:v=>v,embedText:async text=>Array.from({length:768},(_,i)=>i===0?(/prison|captiv|confine/i.test(text)?1:0):i===1?1:0),enqueueIndexingJob:async()=>{},now:()=>new Date('2026-10-12T12:00:00Z')};
 profiles.doc(getStaffAuthorizationProfileId('writer')).set({subject:'writer',status:'active',permissions:['repository.read','repository.write']});
 profiles.doc(getStaffAuthorizationProfileId('reader')).set({subject:'reader',status:'active',permissions:['repository.read']});
 let n=0;
 const call=(operation,args={},subject='writer')=>run({operation,mode:['saveSource','importSource','retryIndexing'].includes(operation)?'command':'query',arguments:args},subject,deps);
 const save=(args={})=>call('saveSource',{title:'Life of William Tyndale',sourceType:'article',contentKind:'exact_text',text:'# Imprisonment\nTyndale was imprisoned.\n  Preserve this spacing.  ',idempotencyKey:'source-test-'+(++n),...args});
 return {db,deps,call,save};
}
test('articles and taught lessons remain separate with exact source-version citations',async()=>{
 const {save,call}=setup();
 const article=await save(),lesson=await save({sourceType:'lesson',contentKind:'lesson_notes',speaker:'Pastor',sourceDate:'2026-10-11',text:'# Faithfulness\nLesson notes about Tyndale and imprisonment.'});
 const found=await call('searchSources',{query:'Tyndale',sourceType:'lesson'});
 assert.equal(found.results.length,1);assert.equal(found.results[0].sourceId,lesson.sourceId);
 const passage=(await call('searchPassages',{query:'imprisoned',sourceId:article.sourceId,mode:'words'})).results[0];
 assert.equal(passage.citation.contentKind,'exact_text');assert.equal(passage.citation.version,1);
 const exact=await call('getSource',{sourceId:article.sourceId,includeText:true});
 assert.equal(exact.text.slice(passage.citation.startOffset,passage.citation.endOffset),passage.text);
 assert.equal((await call('getSource',{sourceId:article.sourceId})).text,undefined);
 const old=await call('getPassage',{chunkId:passage.citation.chunkId});assert.equal(old.passages[0].text,passage.text);
});
test('updates preserve old versions, reject stale writes and changed retry intent, and retire old search passages',async()=>{
 const {save,call}=setup();const first=await save({idempotencyKey:'fixed-key-1'});
 assert.equal((await save({idempotencyKey:'fixed-key-1'})).replayed,true);
 await assert.rejects(save({idempotencyKey:'fixed-key-1',text:'Different'}),{statusCode:409});
 const old=(await call('searchPassages',{query:'imprisoned',sourceId:first.sourceId,mode:'words'})).results[0];
 await save({sourceId:first.sourceId,expectedVersion:1,text:'A new approved article about translation.'});
 await assert.rejects(save({sourceId:first.sourceId,expectedVersion:1}),{statusCode:409});
 assert.equal((await call('getSource',{sourceId:first.sourceId,version:1,includeText:true})).text,old.text);
 assert.equal((await call('getPassage',{chunkId:old.citation.chunkId})).isCurrentVersion,false);
 assert.equal((await call('searchPassages',{query:'imprisoned',sourceId:first.sourceId,mode:'words'})).results.length,0);
});
test('backend permissions deny unknown actors and reader writes; commands cannot use query endpoint',async()=>{
 const {save,call,deps}=setup();const a=await save();
 await assert.rejects(call('getSource',{sourceId:a.sourceId},'unknown'),{statusCode:403});
 await assert.rejects(call('saveSource',{},'reader'),{statusCode:403});
 assert.equal((await call('getSource',{sourceId:a.sourceId},'reader')).source.sourceId,a.sourceId);
 await assert.rejects(run({mode:'query',operation:'saveSource',arguments:{}},'writer',deps),{statusCode:400});
});
test('backend import uses best OCR only, preserves provenance, detects stale originals and protects imported sources',async()=>{
 const {db,call,save}=setup();const ref=db.collection('repositoryDocuments').doc('doc-1');
 await ref.set({title:'Tyndale document',originalFilename:'original.pdf',originalFolderLabel:'Folder A',ocr:{bestText:'Approved Tyndale evidence',bestTextSource:'humanReviewedText',extractedText:'Noisy text'}});
 const a=await call('importSource',{documentId:'doc-1',idempotencyKey:'import-key-1'});
 const source=await call('getSource',{sourceId:a.sourceId,includeText:true});
 assert.equal(source.text,'Approved Tyndale evidence');assert.equal(source.source.origin.textLayer,'humanReviewedText');
 await assert.rejects(save({sourceId:a.sourceId,expectedVersion:1}),{statusCode:409});
 await ref.update({ocr:{bestText:'Revised Tyndale evidence',bestTextSource:'humanReviewedText'}});
 assert.equal((await call('getSource',{sourceId:a.sourceId})).freshness,'upstream_changed');
 const stale=await call('searchPassages',{query:'evidence',mode:'words'});assert.equal(stale.results.length,0);assert.equal(stale.coverage.staleSkipped,1);
 const b=await call('importSource',{documentId:'doc-1',idempotencyKey:'import-key-2'});assert.equal(b.sourceId,a.sourceId);assert.equal(b.version,2);
});
test('chunking preserves complete Unicode text and offsets without gaps',()=>{
 const text='  Intro\n\n# Chapter\n'+('A paragraph with an emoji 😀 and original spacing.\n\n'.repeat(300));
 const chunks=makeChunks({sourceId:'s',revisionId:'s-v1',version:1,title:'Test'},text);
 assert.equal(chunks.map(c=>c.text).join(''),text);
 for(const c of chunks){assert.equal(text.slice(c.startOffset,c.endOffset),c.text);assert.ok(c.text.length<=1800);assert.ok(!/^[\uDC00-\uDFFF]/.test(c.text));}
});
test('durable indexing retries, cache reuse and completed jobs avoid repeated embeddings',async()=>{
 const {save,deps,call}=setup();let calls=0;const embedding=deps.embedText;deps.embedText=async(...a)=>{calls++;return embedding(...a);};
 const a=await save();await processIndexingJob(a.jobId,deps);const firstCalls=calls;
 await processIndexingJob(a.jobId,deps);assert.equal(calls,firstCalls);
 const b=await save({sourceId:a.sourceId,expectedVersion:1,sourceNotes:'Metadata correction'});await processIndexingJob(b.jobId,deps);assert.equal(calls,firstCalls);
 assert.equal((await call('getIndexingStatus',{sourceId:a.sourceId})).cacheHits,1);
 const found=await call('searchPassages',{query:'captivity',sourceId:a.sourceId});assert.equal(found.coverage.semanticStatus,'available');assert.equal(found.results.length,1);
 deps.embedText=async()=>{throw Error('Transient');};const c=await save({text:'Changed passage.'});await assert.rejects(processIndexingJob(c.jobId,deps));
 assert.equal((await call('getIndexingStatus',{sourceId:c.sourceId})).indexingStatus,'failed');
 deps.embedText=embedding;await call('retryIndexing',{sourceId:c.sourceId,expectedVersion:1});await processIndexingJob(c.jobId,deps);
 assert.equal((await call('getIndexingStatus',{sourceId:c.sourceId})).indexingStatus,'completed');
});
test('failed queue delivery preserves source and explicit pending dispatch; semantic failures preserve keyword retrieval',async()=>{
 const {deps,save,call}=setup();deps.enqueueIndexingJob=async()=>{throw Error('Queue down');};const s=await save();
 assert.equal(s.dispatchStatus,'pending_dispatch');assert.equal((await call('getSource',{sourceId:s.sourceId})).source.version,1);
 deps.embedText=async()=>{throw Error('Embedding unavailable');};
 const r=await call('searchPassages',{query:'imprisoned'});assert.equal(r.coverage.semanticStatus,'unavailable');assert.equal(r.results.length,1);
});
test('source pagination does not lose matches and binds cursors to filters',async()=>{
 const {save,call}=setup();for(let i=0;i<7;i++)await save({title:'Tyndale '+i});
 const seen=new Set();let cursor='';do{const p=await call('searchSources',{query:'Tyndale',limit:2,cursor});p.results.forEach(s=>{assert(!seen.has(s.sourceId));seen.add(s.sourceId);});cursor=p.nextCursor;if(cursor)await assert.rejects(call('searchSources',{query:'different',cursor}),{statusCode:400});}while(cursor);
 assert.equal(seen.size,7);
});
test('bounded evidence and notes/transcript validation',async()=>{
 const {save,call}=setup();await assert.rejects(save({sourceType:'lesson',contentKind:'exact_text'}),{statusCode:400});
 await save({text:'Imprisonment. '.repeat(1000)});
 const r=await call('searchPassages',{query:'imprisonment',mode:'words',maxCharacters:2000});assert.ok(r.coverage.returnedCharacters<=2000);assert.equal(r.coverage.exhaustive,false);
});

test('concurrent source updates permit only one revision and superseded workers cannot publish stale vectors',async()=>{
 const {save,deps,call}=setup();const a=await save();
 const race=await Promise.allSettled([save({sourceId:a.sourceId,expectedVersion:1,text:'First update'}),save({sourceId:a.sourceId,expectedVersion:1,text:'Second update'})]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(race.find(r=>r.status==='rejected').reason.statusCode,409);
 await processIndexingJob(a.jobId,deps);assert.equal((await call('getSource',{sourceId:a.sourceId})).source.version,2);
 const current=race.find(r=>r.status==='fulfilled').value;
 const embed=deps.embedText;let changed=false;deps.embedText=async(...args)=>{if(!changed){changed=true;await save({sourceId:a.sourceId,expectedVersion:2,text:'Newest version'});}return embed(...args);};
 await assert.rejects(processIndexingJob(current.jobId,deps),{code:'repository_source_superseded'});
 assert.equal((await call('getSource',{sourceId:a.sourceId})).source.version,3);
 assert.equal((await call('searchPassages',{query:'update',mode:'words',sourceId:a.sourceId})).results.length,0);
});
test('global research returns distinct sources before repeated passages from one work',async()=>{
 const {save,call}=setup();await save({text:'Tyndale imprisonment. '.repeat(500)});const b=await save({sourceType:'lesson',contentKind:'transcript',text:'Tyndale imprisonment in this separate lesson.'});
 const r=await call('searchPassages',{query:'imprisonment',mode:'words',limit:2});assert.equal(new Set(r.results.map(x=>x.citation.sourceId)).size,2);assert(r.results.some(x=>x.citation.sourceId===b.sourceId));
});
