#!/usr/bin/env node
// Removes only the exact, version-pinned objects in a verified migration manifest.
// Never changes bucket retention or touches other repository domains.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Firestore,FieldValue} from '@google-cloud/firestore';
import {Storage} from '@google-cloud/storage';
import storageModule from '../lib/repository-dropbox-storage.js';
const manifestPath=process.argv.find(a=>a.startsWith('--manifest='))?.slice(11);
if(!manifestPath)throw Error('Pass an exact cleanup manifest');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const apply=process.argv.includes('--apply'),db=new Firestore({projectId:'location-map-985',databaseId:'chatgptstorage'});
const bucket=new Storage({projectId:'location-map-985'}).bucket(manifest.bucket),[bucketMetadata]=await bucket.getMetadata();
if(Number(bucketMetadata.softDeletePolicy?.retentionDurationSeconds)<86400)throw Error('Expected recoverable bucket deletion policy is not enabled');
const token=execFileSync('gcloud',['secrets','versions','access','1','--secret=bhe-repository-dropbox-refresh-token','--project=location-map-985'],{encoding:'utf8'}).trim();
const dropbox=new storageModule.DropboxStorage({refreshToken:token}),entries=new Map();
for(const o of manifest.objects){
 if(!/^entry-[a-f0-9]{32}$/.test(o.entryId)||!o.name.startsWith(`repository/library/${o.entryId}/`)||!/^\d+$/.test(o.generation))throw Error('Invalid cleanup object identity');
 if(!entries.has(o.entryId)){
  const ref=db.collection('repositoryLibraryEntries').doc(o.entryId),snapshot=await ref.get(),entry=snapshot.data();
  if(entry?.storage?.provider!=='dropbox'||entry.availability==='unavailable'||!entry.storage.preview)throw Error('An image has not been migrated');
  await dropbox.read(entry.storage);await dropbox.read(entry.storage.preview);entries.set(o.entryId,{ref,entry});
 }
 const entry=entries.get(o.entryId).entry;
 const extension=entry.contentType==='image/jpeg'?'jpg':entry.contentType.split('/')[1];
 if(o.name!==`repository/library/${o.entryId}/${entry.checksumSha256}.${extension}`&&!o.name.startsWith(`repository/library/${o.entryId}/thumbnails/`))throw Error('Unexpected object in cleanup scope');
 const object=bucket.file(o.name);if(!(await object.exists())[0])continue;const [current]=await object.getMetadata();
 if(current.generation!==o.generation||Number(current.size)!==o.size)throw Error('Cloud object changed since manifest');
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',verifiedImages:entries.size,objects:manifest.objects.length,bytes:manifest.totalBytes,recoveryDays:Number(bucketMetadata.softDeletePolicy.retentionDurationSeconds)/86400}));
if(!apply)process.exit(0);
for(const o of manifest.objects){if((await bucket.file(o.name).exists())[0])await bucket.file(o.name).delete({ifGenerationMatch:o.generation});if((await bucket.file(o.name).exists())[0])throw Error('Cloud object remains active');}
for(const [entryId,{ref,entry}]of entries){await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(!current.storagePath)return;if(current.version!==entry.version||current.storage.fileId!==entry.storage.fileId)throw Error('Catalog changed; cleanup readback needs review');tx.update(ref,{storagePath:FieldValue.delete(),version:current.version+1});tx.create(db.collection('repositoryLibraryAudit').doc(entryId+'-gcs-cleanup-v1'),{entryId,action:'remove_verified_legacy_gcs_images',createdAt:new Date().toISOString(),objects:manifest.objects.filter(o=>o.entryId===entryId).map(o=>({name:o.name,generation:o.generation})),recoveryDays:Number(bucketMetadata.softDeletePolicy.retentionDurationSeconds)/86400});});const saved=(await ref.get()).data();if(saved.storagePath||saved.storage.provider!=='dropbox')throw Error('Cleanup catalog readback failed');}
console.log(JSON.stringify({activeCloudObjectsRemoved:manifest.objects.length,catalogsVerified:entries.size}));
