import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const indexes=JSON.parse(readFileSync(new URL('../infra/repository-sources/indexes.json',import.meta.url)));
const apply=process.argv.includes('--apply');
const common=['--project=location-map-985','--database=chatgptstorage'];
for(const index of indexes){
 const args=['firestore','indexes','composite','create',...common,'--collection-group='+index.collectionGroup,'--query-scope=COLLECTION','--async',...index.fields.map(f=>'--field-config='+JSON.stringify(f)),'--quiet'];
 if(!apply){console.log(JSON.stringify({action:'create-index',index}));continue;}
 try{console.log(execFileSync('gcloud',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim());}
 catch(e){if(!String(e.stderr).includes('ALREADY_EXISTS'))throw Error('Index provisioning failed: '+String(e.stderr));console.log(index.collectionGroup+': already exists');}
}
// Large exact text and cached numeric arrays are not searched as scalar fields.
for(const [group,field] of [['repositorySourceRevisions','text'],['repositorySourceRevisions','source'],['repositorySourceChunks','text'],['repositorySourceEmbeddingCache','values']]){
 if(!apply){console.log(JSON.stringify({action:'disable-unused-scalar-index',group,field}));continue;}
 execFileSync('gcloud',['firestore','indexes','fields','update',field,...common,'--collection-group='+group,'--disable-indexes','--async','--quiet'],{stdio:['ignore','pipe','pipe']});
}
