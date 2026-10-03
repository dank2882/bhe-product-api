// Isolated real-Firestore acceptance: no ministry records or default profile writes.
const assert = require('node:assert/strict');
const { Firestore } = require('@google-cloud/firestore');
const { randomUUID } = require('node:crypto');
const reflection = require('../lib/sermon-post-preaching-reflection-service');
const { saveReviewedPostPreachingScriptureNotes } = require('../lib/scripture-note-service');
const { removeDuplicatePreachingAnalysis } = require('../lib/sermon-workspace-service');
const db = new Firestore({ projectId: 'location-map-985', databaseId: 'chatgptstorage' });
const root = db.collection('sermonOperationExecutions').doc(`verification-reflection-${randomUUID()}`);
(async () => {
  const deps = { firestoreDb: db };
  for (const name of ['sermons', 'sermonOccasions', 'sermonSources', 'sermonDevelopmentCheckpoints', 'sermonDevelopmentSessions', 'preachingProfiles', 'preachingAnalyses', 'sermonChunks', 'scriptureNotes', 'scriptureNoteImports', 'scriptureNoteImportSegments', 'sermonOperationExecutions']) {
    deps[`${name}Collection`] = root.collection(name);
  }
  await root.set({ purpose: 'isolated reflection transaction acceptance', createdAt: new Date().toISOString() });
  const line = 'The grace of God teaches us to live soberly and righteously today.';
  await deps.sermonsCollection.doc('fixture').set({ sermonId: 'fixture', title: 'Transaction verification fixture', outline: 'Titus 2:11-14', updatedAt: '2026-10-03T00:00:00Z' });
  await deps.sermonSourcesCollection.doc('transcript').set({ sourceId: 'transcript', sermonId: 'fixture', sourceType: 'preached_transcript', material: line });
  await deps.sermonDevelopmentSessionsCollection.doc('active').set({ sermonId: 'fixture', status: 'active' });
  deps.generatePostPreachingReflection = async () => ({ summary: 'Isolated test', strongestLiveLanguage: [{ text: line, context: 'Test fixture', reason: 'Test fixture' }], profileCandidates: [{ category: 'test', observation: 'Test observation', confidence: 'observed_once', evidence: line }], scriptureNoteCandidates: [{ reference: 'Titus 2:12', content: line, evidenceQuote: line, confidence: 0.95, authorship: 'dan_verbatim' }] });
  const proposal = await reflection.proposeSermonPostPreachingReflection({ sermonId: 'fixture' }, deps);
  const args = { ...proposal.applyInstructions.arguments, applyProfileCandidates: true, rebuildChunks: false };
  deps.saveReviewedPostPreachingScriptureNotes = async () => { throw new Error('injected interruption'); };
  await assert.rejects(reflection.applySermonPostPreachingReflection(args, deps), /injected interruption/);
  assert.equal((await deps.preachingAnalysesCollection.get()).size, 0);
  assert.equal((await deps.preachingProfilesCollection.get()).size, 0);
  assert.equal((await deps.sermonOperationExecutionsCollection.get()).size, 0);
  deps.saveReviewedPostPreachingScriptureNotes = saveReviewedPostPreachingScriptureNotes;
  const results = await Promise.all([reflection.applySermonPostPreachingReflection(args, deps), reflection.applySermonPostPreachingReflection(args, deps)]);
  assert.equal(results.filter(r => r.reflectionReplayed).length, 1);
  assert.equal((await deps.preachingAnalysesCollection.get()).size, 1);
  assert.equal((await deps.scriptureNotesCollection.get()).size, 1);
  const kept = results[0].analysis;
  await deps.preachingAnalysesCollection.doc('duplicate-fixture').create({ ...kept, analysisId: 'duplicate-fixture' });
  await removeDuplicatePreachingAnalysis({ sermonId: 'fixture', analysisId: 'duplicate-fixture', keepAnalysisId: kept.analysisId, expectedUpdatedAt: kept.updatedAt, expectedKeepUpdatedAt: kept.updatedAt, confirmed: true }, deps);
  assert((await deps.preachingAnalysesCollection.doc('duplicate-fixture').get()).data().removedAt);
  console.log(JSON.stringify({ status: 'passed', checks: ['real transaction rollback after staged writes', 'concurrent proposal replay', 'one analysis and one set of learning', 'active development session compatibility', 'guarded duplicate removal'] }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await db.recursiveDelete(root);
  console.log(JSON.stringify({ isolatedFixtureRemoved: !(await root.get()).exists }));
});
