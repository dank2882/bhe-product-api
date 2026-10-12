import {createHash} from 'node:crypto';
import {repositoryLiveClient} from './lib/repository-live-client.mjs';
const {db,request}=repositoryLiveClient(),apply=process.argv.includes('--apply');
const result={apply,eligible:0,indexed:0,skipped:[],failed:[]};
for(const [name,field] of [['repositoryDocuments','documentId'],['repositoryLibraryEntries','entryId']]){
 let after='';
 do{
  let q=db.collection(name).orderBy('__name__').limit(100);if(after)q=q.startAfter(db.collection(name).doc(after));
  const docs=(await q.get()).docs;
  for(const doc of docs){
   const r=doc.data();if(field==='entryId'&&(r.kind!=='note'||r.availability==='unavailable'))continue;
   if(r.originalFolderLabel==='debug-test'){result.skipped.push({recordId:doc.id,reason:'labeled_debug_test'});continue;}
   const text=field==='documentId'?r.ocr?.bestText:r.content;
   if(!text?.trim()||text.length>100000){result.skipped.push({recordId:doc.id,reason:!text?.trim()?'no_text':'over_100000_characters'});continue;}
   result.eligible++;
   if(apply){const key='backfill-source-'+createHash('sha256').update(JSON.stringify({id:doc.id,record:r})).digest('hex');
    const response=await request('command','importSource',{[field]:doc.id,idempotencyKey:key});
    if(!response.body.ok){result.failed.push({recordId:doc.id,status:response.status});continue;}
    const check=await request('query','getSource',{sourceId:response.body.sourceId,includeText:true});
    if(check.body.text!==text)throw Error('Imported text read-back mismatch for '+doc.id);
    result.indexed++;
   }
  }
  after=docs.length===100?docs.at(-1).id:'';
 }while(after);
}
console.log(JSON.stringify(result,null,2));if(result.failed.length)process.exitCode=1;
