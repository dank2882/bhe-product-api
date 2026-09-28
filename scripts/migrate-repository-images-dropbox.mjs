#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {Firestore} from '@google-cloud/firestore';
import {Storage} from '@google-cloud/storage';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import storageModule from '../lib/repository-dropbox-storage.js';
const {DropboxStorage,ROOT,segment}=storageModule;
const db=new Firestore({projectId:'location-map-985',databaseId:'chatgptstorage'});
const all=(await db.collection('repositoryLibraryEntries').get()).docs.map(d=>d.data());
const images=all.filter(e=>e.kind==='image');
const byId=new Map(all.map(e=>[e.entryId,e]));
const apply=process.argv.includes('--apply'),copy=process.argv.includes('--copy');
if(!apply&&!copy){console.log(JSON.stringify({mode:'dry-run',images:images.map(e=>({entryId:e.entryId,title:e.title,sizeBytes:e.sizeBytes,provider:e.storage?.provider||'gcs'}))},null,2));process.exit(0);}
const token=execFileSync('gcloud',['secrets','versions','access','1','--secret=bhe-repository-dropbox-refresh-token','--project=location-map-985'],{encoding:'utf8'}).trim();
const client=new DropboxStorage({refreshToken:token});await client.checkRoot();
const deployment=JSON.parse(execFileSync('gcloud',['run','services','describe','bhe-product-api','--region=us-west1','--project=location-map-985','--format=json'],{encoding:'utf8'}));
const bucketName=deployment.spec.template.spec.containers[0].env.find(v=>v.name==='BUCKET_NAME').value;
const bucket=new Storage({projectId:'location-map-985'}).bucket(bucketName),manifest=[];
for(const e of images){
 if(e.storage?.provider==='dropbox'){await client.read(e.storage);manifest.push({entryId:e.entryId,status:'already-migrated'});continue;}
 if(!e.storagePath?.startsWith(`repository/library/${e.entryId}/`))throw Error('Unexpected cloud object path');
 const [bytes]=await bucket.file(e.storagePath).download();
 if(createHash('sha256').update(bytes).digest('hex')!==e.checksumSha256)throw Error('Source checksum mismatch');
 const folders=[],seen=new Set();let cursor=e.folderId;
 while(cursor){if(seen.has(cursor)||seen.size>=30)throw Error('Invalid folder hierarchy');seen.add(cursor);const f=byId.get(cursor);if(f?.kind!=='folder')throw Error('Missing folder');folders.unshift(f);cursor=f.folderId;}
 const extension=e.contentType==='image/jpeg'?'jpg':e.contentType?.split('/')[1];
 if(!['png','jpg','webp'].includes(extension))throw Error('Unexpected image format');
 const storage=await client.saveImage({bytes,checksumSha256:e.checksumSha256,extension},e,folders);delete storage.folderBindings;
 if(apply){
  let folderPath=ROOT;
  for(const f of folders){folderPath+='/'+segment(f.title)+'--'+f.entryId;const meta=await client.metadata(folderPath);const ref=db.collection('repositoryLibraryEntries').doc(f.entryId);await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current.dropboxFolderId===meta.id)return;tx.update(ref,{dropboxFolderId:meta.id,dropboxPathLower:meta.path_lower,availability:'available',activeKind:'folder',activeFolderKey:'folder|'+(current.folderId||''),version:current.version+1});tx.create(db.collection('repositoryLibraryAudit').doc(f.entryId+'-dropbox-folder-v1'),{entryId:f.entryId,action:'bind_dropbox_folder',createdAt:new Date().toISOString()});});}
  const ref=db.collection('repositoryLibraryEntries').doc(e.entryId);
  await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current.storage?.fileId===storage.fileId)return;if(current.version!==e.version||current.checksumSha256!==e.checksumSha256)throw Error('Migration version conflict');
   tx.update(ref,{storage,availability:'available',activeKind:'image',activeFolderKey:'image|'+(e.folderId||''),dropboxFileId:storage.fileId,dropboxPathLower:storage.path.toLowerCase(),imageAncestorIds:folders.map(f=>f.entryId),version:e.version+1});
   tx.create(db.collection('repositoryLibraryAudit').doc(e.entryId+'-dropbox-v1'),{entryId:e.entryId,action:'migrate_to_dropbox',fromChecksum:e.checksumSha256,toFileId:storage.fileId,sourceVersion:e.version,createdAt:new Date().toISOString(),authorization:'Dan approved Dropbox migration in September 28 session'});
  });
  const current=(await ref.get()).data();if(current.storage?.fileId!==storage.fileId)throw Error('Migration readback failed');
 }
 manifest.push({entryId:e.entryId,title:e.title,sourcePath:e.storagePath,sourceChecksum:e.checksumSha256,storage,status:apply?'migrated':'copied-and-verified'});
 console.log(JSON.stringify({entryId:e.entryId,status:manifest.at(-1).status}));
}
if(apply)for(const e of all){const ref=db.collection('repositoryLibraryEntries').doc(e.entryId);await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current.activeKind)return;tx.update(ref,{availability:'available',activeKind:current.kind,activeFolderKey:current.kind+'|'+(current.folderId||''),version:current.version+1});tx.create(db.collection('repositoryLibraryAudit').doc(e.entryId+'-browse-index-v1'),{entryId:e.entryId,action:'backfill_browse_index',createdAt:new Date().toISOString()});});}
const target='/tmp/bhe-repository-dropbox-migration-'+(apply?'applied':'copied')+'.json';
fs.writeFileSync(target,JSON.stringify({bucket:bucketName,createdAt:new Date().toISOString(),entries:manifest},null,2),{mode:0o600});
console.log(JSON.stringify({manifest:target,count:manifest.length}));
