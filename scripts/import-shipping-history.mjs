#!/usr/bin/env node
// Offline administrator migration. Uses the explicitly selected Google Cloud
// account and IAM, never a fabricated end-user actor or a backend API key.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
const require = createRequire(import.meta.url);
const M = require('../lib/shipping-model');
const flags = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--commit') flags.commit = true;
  else if (['--file', '--receipt', '--account', '--preview-hash'].includes(k)) flags[k.slice(2)] = process.argv[++i];
  else throw Error('Unknown option: ' + k);
}
if (!flags.file || !flags.receipt || !flags.account) throw Error('Use --file <private batch> --receipt <private receipt> --account <Google Cloud account>; review preview before --commit --preview-hash <hash>');
const data = JSON.parse(readFileSync(flags.file, 'utf8'));
if (data.owner !== 'fbc' || !Array.isArray(data.candidates) || !data.candidates.length || data.candidates.length > 50) throw Error('Expected 1–50 FBC candidates');
const rows = data.candidates.map(r => ({ sourceKey: M.string(r.sourceKey, 'sourceKey', 200), shipment: M.newShipment(r.shipment) }));
if (new Set(rows.map(r => r.sourceKey)).size !== rows.length) throw Error('Duplicate source keys');
for (const r of rows) if (!r.shipment.sources.length || r.shipment.recordKind === 'operational') throw Error('Only sourced history/proposals can be imported');
const attachments = data.attachments || [];
const files = attachments.map(a => {
  const row = rows.find(r => r.sourceKey === a.sourceKey), doc = row?.shipment.documents.find(d => d.id === a.documentId);
  if (!doc || !['application/pdf', 'image/png', 'image/jpeg'].includes(a.mimeType)) throw Error('Unknown attachment document or MIME type');
  const bytes = readFileSync(a.path), sha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const valid = a.mimeType === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : a.mimeType === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
  if (!valid || sha256 !== a.sha256 || bytes.length > 10 * 1024 * 1024) throw Error('Attachment hash, signature or size mismatch');
  return { ...a, bytes, sha256 };
});
if (new Set(files.map(a => a.sourceKey + ':' + a.documentId)).size !== files.length) throw Error('Duplicate attachment mapping');
const previewHash = M.hash({ rows, attachments: files.map(({ bytes, path, ...a }) => a) });
if (flags.commit && flags['preview-hash'] !== previewHash) throw Error('Commit must match reviewed preview hash');
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: execFileSync('gcloud', ['auth', 'print-access-token', '--account', flags.account], { encoding: 'utf8' }).trim() });
const auth = new GoogleAuth({ authClient });
const db = new Firestore({ projectId: 'location-map-985', databaseId: 'chatgptstorage', auth });
const storage = new Storage({ projectId: 'location-map-985', authClient });
const bucket = storage.bucket('bhe-product-assets'), actor = 'google-cloud:' + flags.account;
const receipt = { owner: 'fbc', mode: flags.commit ? 'commit' : 'preview', actor, previewHash, candidateCount: rows.length, fileCount: files.length, sourceInstructionsAreData: true, results: [] };
const persist = () => writeFileSync(flags.receipt, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
for (const row of rows) {
  const markerRef = db.collection('fbcShippingImports').doc(M.hash(row.sourceKey)), previous = await markerRef.get();
  if (previous.exists && (previous.data().status !== 'committed' || previous.data().fingerprint !== M.hash(row))) throw Error('Existing source key conflicts: ' + row.sourceKey);
  receipt.results.push({ sourceKey: row.sourceKey, title: row.shipment.title, existing: previous.exists, issues: M.qualityIssues(row.shipment) });
}
persist();
if (!flags.commit) { console.log(JSON.stringify({ dryRun: true, previewHash, candidates: rows.length, files: files.length, existing: receipt.results.filter(r => r.existing).length, receipt: flags.receipt })); process.exit(0); }
const [policy] = await bucket.iam.getPolicy();
if ((policy.bindings || []).some(b => (b.members || []).some(m => ['allUsers', 'allAuthenticatedUsers'].includes(m)))) throw Error('Refusing originals in a publicly readable bucket');
receipt.results = [];
for (const row of rows) {
  const sourceHash = M.hash(row.sourceKey), shipmentId = 'ship-' + sourceHash.slice(0, 28), revisionId = shipmentId + '-v1';
  const marker = db.collection('fbcShippingImports').doc(sourceHash), fingerprint = M.hash(row);
  const already = await marker.get();
  if (already.exists) {
    const saved = await db.collection('fbcShippingShipments').doc(already.data().shipmentId).get();
    if (!saved.exists || saved.data().owner !== 'fbc') throw Error('Imported record missing');
    receipt.results.push({ sourceKey: row.sourceKey, shipmentId: saved.id, version: saved.data().version, replayed: true, readBackVerified: true }); persist(); continue;
  }
  const timestamp = new Date().toISOString();
  const shipment = { ...structuredClone(row.shipment), shipmentId, owner: 'fbc', status: row.shipment.recordKind === 'historical' ? 'historical-incomplete' : 'proposed', createdAt: timestamp, updatedAt: timestamp, updatedBy: actor, version: 1, approval: null, needsReapproval: false };
  for (const file of files.filter(f => f.sourceKey === row.sourceKey)) {
    const storagePath = 'fbc-shipping/' + shipmentId + '/' + file.sha256;
    await bucket.file(storagePath).save(file.bytes, { resumable: false, contentType: file.mimeType, metadata: { cacheControl: 'private, no-store' }, preconditionOpts: { ifGenerationMatch: 0 } }).catch(e => { if (Number(e.code) !== 412) throw e; });
    const doc = shipment.documents.find(d => d.id === file.documentId);
    Object.assign(doc, { storagePath, sha256: file.sha256, bytes: file.bytes.length, filename: require('node:path').basename(file.path), mimeType: file.mimeType });
  }
  M.sourceCheck(shipment);
  const receiptId = M.hash(actor + '|administrative-import|' + row.sourceKey);
  await db.runTransaction(async tx => {
    const current = await tx.get(marker); if (current.exists) throw Error('Source imported concurrently; replay reviewed batch');
    tx.create(db.collection('fbcShippingShipments').doc(shipmentId), shipment);
    tx.create(db.collection('fbcShippingRevisions').doc(revisionId), shipment);
    tx.create(marker, { owner: 'fbc', sourceKey: row.sourceKey, fingerprint, status: 'committed', actorSub: actor, shipmentId, version: 1, previewHash });
    tx.create(db.collection('fbcShippingReceipts').doc(receiptId), { owner: 'fbc', actorSub: actor, operation: 'administrative-import', fingerprint, result: { shipmentId, version: 1, revisionId, receiptId }, createdAt: timestamp });
    tx.create(db.collection('fbcShippingAudit').doc(receiptId), { owner: 'fbc', actorSub: actor, operation: 'administrative-import', shipmentId, version: 1, previewHash, createdAt: timestamp });
  });
  const readBack = await db.collection('fbcShippingRevisions').doc(revisionId).get();
  if (!readBack.exists || M.hash(readBack.data()) !== M.hash(shipment)) throw Error('Saved revision read-back mismatch; replay same batch');
  for (const doc of shipment.documents.filter(d => d.storagePath)) {
    const [download] = await bucket.file(doc.storagePath).download();
    if (require('node:crypto').createHash('sha256').update(download).digest('hex') !== doc.sha256) throw Error('Original file read-back mismatch');
  }
  receipt.results.push({ sourceKey: row.sourceKey, shipmentId, version: 1, revisionId, readBackVerified: true }); persist();
}
receipt.readBackVerified = true; receipt.completedAt = new Date().toISOString(); persist();
console.log(JSON.stringify({ imported: receipt.results.length, files: files.length, readBackVerified: true, actor, receipt: flags.receipt }));
