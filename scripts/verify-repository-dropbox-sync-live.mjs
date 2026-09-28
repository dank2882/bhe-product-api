#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {Firestore} from '@google-cloud/firestore';
import sharp from 'sharp';
import storageModule from '../lib/repository-dropbox-storage.js';
import syncModule from '../lib/repository-dropbox-sync.js';
const token=execFileSync('gcloud',['secrets','versions','access','1','--secret=bhe-repository-dropbox-refresh-token','--project=location-map-985'],{encoding:'utf8'}).trim();
const client=new storageModule.DropboxStorage({refreshToken:token}),db=new Firestore({projectId:'location-map-985',databaseId:'chatgptstorage'});
const deps={db,dropbox:client,entries:db.collection('repositoryLibraryEntries'),audit:db.collection('repositoryLibraryAudit')};
const bytes=await sharp({create:{width:4,height:4,channels:3,background:'#174635'}}).png().toBuffer();
const path=storageModule.ROOT+'/Repository connection verification '+Date.now()+'.png';
const original=await client.put(path,bytes);let entry;
try{
 for(let n=0;n<25;n++){const result=await syncModule.sync(deps,{force:true});if(result.status==='current')break;if(n===24)throw Error('Index did not finish in bounded verification window');}
 const matches=await deps.entries.where('dropboxFileId','==',original.fileId).get();if(matches.size!==1)throw Error('Expected one imported image');entry=matches.docs[0].data();
 if(entry.checksumSha256!==storageModule.digest(bytes)||entry.activeKind!=='image'||entry.sourceType!=='unspecified'||entry.width!==4)throw Error('Imported image mismatch');
 await client.read(entry.storage.preview);
 console.log(JSON.stringify({externalFileImportVerified:true,entryId:entry.entryId,previewVerified:true}));
}finally{
 for(const ref of [entry?.storage?.preview,original].filter(Boolean)){
  const current=await client.metadata(ref.fileId);if(current.rev!==ref.rev)throw Error('Verification fixture changed; cleanup stopped');
  await client.request('files/delete_v2',{path:ref.fileId,parent_rev:ref.rev});
 }
}
for(let n=0;n<25;n++){const result=await syncModule.sync(deps,{force:true});if(result.status==='current')break;if(n===24)throw Error('Deletion indexing did not finish');}
const after=(await deps.entries.doc(entry.entryId).get()).data();if(after.availability!=='unavailable'||after.activeKind!=='unavailable')throw Error('Deleted fixture still active');
console.log(JSON.stringify({fixtureRemoved:true,deletionIndexed:true,activeImageCount:(await deps.entries.where('activeKind','==','image').count().get()).data().count}));
