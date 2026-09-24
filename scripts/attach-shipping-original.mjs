#!/usr/bin/env node
// IAM administrator backfill for an already-recorded, metadata-only original.
// No end-user identity or API-key actor headers are synthesized.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
const require = createRequire(import.meta.url), M = require('../lib/shipping-model');
const { MAX_BYTES } = require('../lib/shipping-upload-service');
const args = {};
for (let i=2;i<process.argv.length;i++) { const k=process.argv[i]; if(k==='--commit')args.commit=true; else if(['--account','--file','--shipment','--document','--version','--receipt','--preview-hash'].includes(k))args[k.slice(2)]=process.argv[++i];else throw Error('Unknown option '+k); }
if(!args.account||!args.file||!args.shipment||!args.document||!args.version||!args.receipt)throw Error('Required: --account --file --shipment --document --version --receipt; preview before --commit --preview-hash');
const bytes=fs.readFileSync(args.file), sha256=createHash('sha256').update(bytes).digest('hex');
if(bytes.length>MAX_BYTES||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Expected original PDF through 25 MiB');
const authClient=new OAuth2Client();authClient.setCredentials({access_token:execFileSync('gcloud',['auth','print-access-token','--account',args.account],{encoding:'utf8'}).trim()});
const db=new Firestore({projectId:'location-map-985',databaseId:'chatgptstorage',auth:new GoogleAuth({authClient})}),bucket=new Storage({projectId:'location-map-985',authClient}).bucket('bhe-product-assets');
const ref=db.collection('fbcShippingShipments').doc(M.id(args.shipment)),snapshot=await ref.get(),s=snapshot.data();
if(!s||s.owner!=='fbc')throw Error('Shipment missing');
const old=s.documents.find(d=>d.id===args.document);
if(!old||old.storagePath)throw Error('Expected existing metadata-only document');
if(!s.sources.some(source=>old.sources.includes(source.id)&&source.documentHash===sha256))throw Error('File hash does not match the recorded source original');
const docId=old.id+'-original-'+sha256.slice(0,8),actor='google-cloud:'+args.account;
const previewHash=M.hash({shipmentId:s.shipmentId,expectedVersion:Number(args.version),oldDocumentId:old.id,docId,sha256,bytes:bytes.length,actor});
const receiptId=M.hash('original-backfill|'+previewHash),receiptRef=db.collection('fbcShippingReceipts').doc(receiptId),prior=await receiptRef.get();
if(prior.exists){const saved=(await db.collection('fbcShippingRevisions').doc(prior.data().result.revisionId).get()).data();if(!saved?.documents.some(d=>d.id===docId&&d.sha256===sha256))throw Error('Replay readback mismatch');console.log(JSON.stringify({replayed:true,...prior.data().result,readBackVerified:true}));process.exit(0);}
if(s.version!==Number(args.version))throw Error('Shipment changed; preview current version');
const document=M.shapes.documents({...old,id:docId,supersedes:old.id});
const preview={owner:'fbc',actor,shipmentId:s.shipmentId,expectedVersion:s.version,docId,sha256,bytes:bytes.length,previewHash};
fs.writeFileSync(args.receipt,JSON.stringify(preview,null,2),{mode:0o600});
if(!args.commit){console.log(JSON.stringify({...preview,dryRun:true}));process.exit(0);}
if(args['preview-hash']!==previewHash)throw Error('Commit must match the reviewed preview hash');
const [policy]=await bucket.iam.getPolicy();if((policy.bindings||[]).some(b=>(b.members||[]).some(m=>['allUsers','allAuthenticatedUsers'].includes(m))))throw Error('Bucket must be private');
const storagePath='fbc-shipping/'+s.shipmentId+'/'+sha256;
await bucket.file(storagePath).save(bytes,{resumable:false,contentType:'application/pdf',metadata:{cacheControl:'private, no-store'},preconditionOpts:{ifGenerationMatch:0}}).catch(e=>{if(Number(e.code)!==412)throw e;});
const [download]=await bucket.file(storagePath).download();if(createHash('sha256').update(download).digest('hex')!==sha256)throw Error('File readback mismatch');
const timestamp=new Date().toISOString();let next;
await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current.version!==s.version)throw Error('Concurrent shipment edit');next={...current,documents:[...current.documents,{...document,storagePath,sha256,filename:path.basename(args.file),mimeType:'application/pdf',bytes:bytes.length}],version:current.version+1,updatedAt:timestamp,updatedBy:actor};if(next.approval){next.approval=null;next.needsReapproval=true;if(next.status==='approved-for-booking')next.status='preparing';}M.sourceCheck(next);const revisionId=s.shipmentId+'-v'+next.version;tx.set(ref,next);tx.create(db.collection('fbcShippingRevisions').doc(revisionId),next);tx.create(receiptRef,{owner:'fbc',actorSub:actor,operation:'administrative-original-backfill',fingerprint:previewHash,result:{shipmentId:s.shipmentId,version:next.version,revisionId,receiptId},createdAt:timestamp});tx.create(db.collection('fbcShippingAudit').doc(receiptId),{owner:'fbc',actorSub:actor,operation:'administrative-original-backfill',shipmentId:s.shipmentId,version:next.version,createdAt:timestamp});});
const saved=(await ref.get()).data();if(M.hash(saved)!==M.hash(next))throw Error('Record readback mismatch');
const result={...preview,version:saved.version,readBackVerified:true,originalHashVerified:true};fs.writeFileSync(args.receipt,JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
