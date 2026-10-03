// Exact, approved incident cleanup. Without --apply this only checks the candidate.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore({ projectId: 'location-map-985', databaseId: 'chatgptstorage' });
const runtime = JSON.parse(execFileSync('gcloud', ['run','services','describe','bhe-product-api','--project=location-map-985','--region=us-west1','--format=json']));
const env = Object.fromEntries(runtime.spec.template.spec.containers[0].env.map(e => [e.name,e]));
const secret = env.BHE_API_KEY.valueFrom.secretKeyRef;
const key = execFileSync('gcloud', ['secrets','versions','access',secret.key,`--secret=${secret.name}`,'--project=location-map-985'], { encoding:'utf8' }).trim();
const base = process.env.SERMON_VERIFY_BASE_URL || runtime.status.url;
const sermonId = 'sermon-ladies-day-out-october-2-2026-497dd3da';
const analysisId = 'analysis-sermon-ladies-day-out-october-2-2026-497dd3da-la-57c2771d';
const keepAnalysisId = 'analysis-sermon-ladies-day-out-october-2-2026-497dd3da-la-2a3f2879';
const headers = { 'content-type':'application/json', 'x-api-key':key };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function snapshot() {
  const groups = {};
  for (const name of ['sermonDevelopmentCheckpoints','scriptureNotes','scriptureNoteImports','sermonSources']) {
    const field = name === 'scriptureNotes' ? 'sermonIds' : 'sermonId';
    const result = await db.collection(name).where(field, name === 'scriptureNotes' ? 'array-contains' : '==', sermonId).get();
    groups[name] = result.docs.map(d => ({ id:d.id, data:d.data() })).sort((a,b)=>a.id.localeCompare(b.id));
  }
  groups.profiles = (await db.collection('preachingProfiles').get()).docs.map(d=>({id:d.id,data:d.data()})).sort((a,b)=>a.id.localeCompare(b.id));
  groups.sermon = (await db.collection('sermons').doc(sermonId).get()).data();
  groups.retained = (await db.collection('preachingAnalyses').doc(keepAnalysisId).get()).data();
  return groups;
}
async function call(mode, operation, args, idempotencyKey) {
  return fetch(`${base}/sermon-workspace/${mode}`, { method:'POST', headers, body:JSON.stringify({operation,arguments:args,idempotencyKey}) }).then(r=>r.json());
}
(async()=>{
  const catalog = await fetch(`${base}/sermon-workspace/operations?query=removeDuplicatePreachingAnalysis`, {headers}).then(r=>r.json());
  assert(catalog.ok && catalog.operations.some(o=>o.operation==='removeDuplicatePreachingAnalysis'));
  const before = await snapshot();
  const duplicate = (await db.collection('preachingAnalyses').doc(analysisId).get()).data();
  assert(duplicate && before.retained);
  assert.equal(before.scriptureNotes.length, 4);
  assert(before.scriptureNotes.every(n=>n.data.preachingAnalysisIds.includes(keepAnalysisId)));
  const args = {sermonId,analysisId,keepAnalysisId,expectedUpdatedAt:duplicate.updatedAt,expectedKeepUpdatedAt:before.retained.updatedAt,confirmed:true};
  const denial = await call('command','removeDuplicatePreachingAnalysis',{sermonId:'unconfirmed-check',analysisId:'duplicate',keepAnalysisId:'keep',expectedUpdatedAt:'check',expectedKeepUpdatedAt:'check',confirmed:false},'sermon-duplicate-unconfirmed-check-20261003');
  assert.equal(denial.error.code,'duplicate_analysis_confirmation_required');
  if (!process.argv.includes('--apply')) {
    assert.equal(digest(await snapshot()),digest(before));
    console.log(JSON.stringify({status:'candidate-verified',base,checks:['catalog exposes cleanup','unconfirmed removal rejected','retained reflection and four note links verified','read-only checks preserved learning']}));
    return;
  }
  const result = duplicate.removedAt && duplicate.duplicateOfAnalysisId === keepAnalysisId
    ? {ok:true,result:{status:'removed'},idempotency:{executionId:'already-removed'}}
    : await call('command','removeDuplicatePreachingAnalysis',args,'sermon-remove-exact-57c2771d-keep-2a3f2879-20261003');
  assert(result.ok, JSON.stringify(result.error));
  assert.equal(result.result.status,'removed');
  const after = await snapshot();
  assert.equal(digest(after),digest(before),'Retained sermon, sources, checkpoints, notes or profile changed');
  const removed = (await db.collection('preachingAnalyses').doc(analysisId).get()).data();
  assert(removed.removedAt);
  assert.equal(removed.duplicateOfAnalysisId,keepAnalysisId);
  assert.equal(removed.summary,duplicate.summary);
  const list = await call('query','listPreachingAnalyses',{sermonId,limit:100});
  assert(list.ok);
  assert.deepEqual(list.result.analyses.map(a=>a.analysisId),[keepAnalysisId]);
  console.log(JSON.stringify({status:'cleanup-verified',base,removedAnalysisId:analysisId,keepAnalysisId,activeReflectionCount:list.result.count,scriptureNotes:after.scriptureNotes.length,checkpoints:after.sermonDevelopmentCheckpoints.length,retainedContentHash:digest(after),unchanged:['sermon','sources','checkpoints','Scripture notes/imports','preaching profiles','retained reflection'],recoverable:true,receipt:result.idempotency.executionId}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
