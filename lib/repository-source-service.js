'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { authorize } = require('./repository-library-service');
const { stableStringify } = require('./workspace-operation-execution');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const now = deps => new Date(deps.now ? deps.now() : Date.now()).toISOString();
const col = (deps, name) => deps.db.collection('repositorySource' + name);
const TYPES = ['article', 'lesson', 'research_note', 'document'];
const KINDS = ['exact_text', 'lesson_notes', 'manuscript', 'transcript', 'ocr_text'];
const QUERY_OPERATIONS = ['searchSources', 'getSource', 'getPassage', 'searchPassages', 'getIndexingStatus'];
const COMMAND_OPERATIONS = ['saveSource', 'importSource', 'retryIndexing'];
function fail(message, statusCode = 400, code = 'repository_source_invalid') {
  throw Object.assign(new Error(message), { statusCode, code });
}
function str(v, field, max = 500, optional = false) {
  if (optional && (v === undefined || v === '')) return '';
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`Invalid ${field}`);
  return v; // Preserve supplied wording.
}
function id(v, field = 'sourceId') {
  const s = str(v, field, 200);
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) fail(`Invalid ${field}`);
  return s;
}
function number(v, fallback, max) {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || v < 1 || v > max) fail(`Expected integer 1–${max}`);
  return v;
}
const words = value => [...new Set(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].filter(w => w.length <= 100);
const stops = new Set(['a','an','the','on','of','in','and','or','to','we','i','that','what','did','about','find','me','our','he','his','her','it','was']);
const searchWords = value => words(value).filter(w => !stops.has(w)).slice(0, 30);
function date(v) {
  if (v === undefined || v === '') return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v+'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) fail('Invalid sourceDate');
  return v;
}
function list(v, field, max = 25) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) fail(`Invalid ${field}`);
  return [...new Set(v.map(x => str(x, field, 200)))];
}
function metadata(input) {
  if (!TYPES.includes(input.sourceType)) fail('Choose article, lesson, research_note, or document');
  if (!KINDS.includes(input.contentKind)) fail('Choose exact_text, lesson_notes, manuscript, transcript, or ocr_text');
  if (input.sourceType === 'lesson' && !['lesson_notes','manuscript','transcript'].includes(input.contentKind)) fail('A lesson must identify notes, manuscript, or transcript');
  const references = input.references || [];
  if (!Array.isArray(references) || references.length > 20) fail('Use at most 20 references');
  return { title: str(input.title, 'title'), sourceType: input.sourceType, contentKind: input.contentKind,
    authors: list(input.authors, 'authors'), speaker: str(input.speaker, 'speaker', 300, true), sourceDate: date(input.sourceDate),
    tags: list(input.tags, 'tags'), relatedItemIds: list(input.relatedItemIds, 'relatedItemIds').map(x => id(x, 'itemId')),
    sourceNotes: str(input.sourceNotes, 'sourceNotes', 5000, true),
    references: references.map(r => ({ domain: str(r?.domain, 'reference domain', 100), recordId: str(r?.recordId, 'reference recordId', 200) })) };
}
function card(s) {
  const { tokens, fingerprint, createdBy, ...safe } = s;
  return safe;
}
function summary(s) {
  return { sourceId:s.sourceId, revisionId:s.revisionId, version:s.version, title:s.title, sourceType:s.sourceType,
    contentKind:s.contentKind, authors:s.authors.slice(0,5), speaker:s.speaker, sourceDate:s.sourceDate,
    tags:s.tags.slice(0,5), indexingStatus:s.indexingStatus, passageCount:s.passageCount,
    origin:s.origin?{kind:s.origin.kind,recordId:s.origin.recordId,textLayer:s.origin.textLayer}:null,
    metadataTruncated:s.authors.length>5||s.tags.length>5||Boolean(s.sourceNotes)||s.references.length>0 };
}
async function read(deps, kind, key, tx) {
  const ref = col(deps, kind).doc(key);
  const s = await (tx ? tx.get(ref) : ref.get());
  if (!s.exists) fail('Repository source record not found', 404, 'repository_source_not_found');
  return s.data();
}
function revisionId(sourceId, version) { return `${sourceId}-v${version}`; }
function makeChunks(source, text) {
  const chunks = [];
  let start = 0, section = '';
  while (start < text.length) {
    let end = Math.min(start + 1800, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      if (boundary > start + 900) end = boundary + 1;
      // Never cut a UTF-16 surrogate pair.
      if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
    }
    const exact = text.slice(start, end);
    const headings = [...exact.matchAll(/^#{1,6}\s+(.+)$/gm)];
    const sectionTitle = headings[0]?.[1] || section;
    if (headings.length) section = headings.at(-1)[1];
    const ordinal = chunks.length;
    chunks.push({ chunkId: `${source.revisionId}-p${String(ordinal).padStart(4, '0')}`, sourceId: source.sourceId,
      revisionId: source.revisionId, version: source.version, ordinal, startOffset: start, endOffset: end,
      offsetUnit: 'UTF-16 code units', sectionTitle, text: exact, textHash: hash(exact), active: true,
      tokens: words(`${source.title} ${sectionTitle} ${exact}`).slice(0, 800) });
    start = end;
  }
  return chunks;
}
async function dispatch(jobId, generation, deps) {
  try { await deps.enqueueIndexingJob({ jobId, retryGeneration: generation }); return 'queued'; }
  catch { return 'pending_dispatch'; } // Durable job remains retryable; never lose a successful save.
}
async function saveSource(input, actor, deps, origin = null) {
  const meta = metadata(input), text = str(input.text, 'text', 100000);
  const key = str(input.idempotencyKey, 'idempotencyKey', 200);
  if (key.length < 8) fail('idempotencyKey must contain at least 8 characters');
  const sourceId = origin ? `source-${hash(origin.kind + ':' + origin.recordId).slice(0, 32)}`
    : input.sourceId ? id(input.sourceId) : `source-${hash(actor.subject + ':' + key).slice(0, 32)}`;
  const fingerprint = hash(stableStringify({ ...meta, text, origin }));
  const intent = hash(stableStringify({ sourceId, fingerprint, expectedVersion: input.expectedVersion ?? null }));
  const executionRef = col(deps, 'Executions').doc(hash(actor.subject + ':' + key));
  const sourceRef = col(deps, 's').doc(sourceId);
  const receipt = await deps.db.runTransaction(async tx => {
    const execution = await tx.get(executionRef);
    if (execution.exists) {
      if (execution.data().intent !== intent) fail('Idempotency key reused with different input', 409);
      return { ...execution.data().receipt, replayed: true };
    }
    if (origin) {
      const upstream = await tx.get(deps.db.collection(origin.kind === 'document' ? 'repositoryDocuments' : 'repositoryLibraryEntries').doc(origin.recordId));
      if (!upstream.exists || upstreamFingerprint(upstream.data(),origin.kind)!==origin.upstreamFingerprint) fail('Original changed during import; retry from the current record',409);
    }
    const current = await tx.get(sourceRef), previous = current.exists ? current.data() : null;
    if (!previous && input.sourceId && !origin) fail('Source not found; omit sourceId to create a new source',404);
    if (previous && !origin && previous.origin) fail('Imported sources are refreshed from their owning record', 409);
    if (previous && !origin && input.expectedVersion !== previous.version) fail('Source changed; read it again before updating', 409);
    if (!previous && input.expectedVersion !== undefined && input.expectedVersion !== 0) fail('New sources require expectedVersion 0', 409);
    // Imports are protected by the upstream content fingerprint and may safely replay.
    if (previous?.fingerprint === fingerprint) {
      const unchanged = { sourceId, revisionId: previous.revisionId, version: previous.version, unchanged: true, jobId: previous.revisionId };
      tx.create(executionRef, { intent, receipt: unchanged, createdAt: now(deps) });
      return unchanged;
    }
    const oldRevision = previous ? await read(deps, 'Revisions', previous.revisionId, tx) : null;
    for (const itemId of meta.relatedItemIds) {
      if (!(await tx.get(deps.db.collection('repositoryItems').doc(itemId))).exists) fail('Linked knowledge item not found', 404);
    }
    const version = (previous?.version || 0) + 1, rev = revisionId(sourceId, version);
    const source = { sourceId, version, revisionId: rev, ...meta, origin,
      owner: 'bhe', visibility: 'repository_staff', createdAt: previous?.createdAt || now(deps), updatedAt: now(deps),
      createdBy: previous?.createdBy || actor, textHash: hash(text), fingerprint, indexingStatus: 'pending',
      tokens: words([meta.title, ...meta.authors, meta.speaker, meta.sourceType, meta.contentKind, ...meta.tags].join(' ')) };
    const chunks = makeChunks(source, text);
    source.passageCount = chunks.length;
    if (oldRevision) for (const old of makeChunks(oldRevision.source, oldRevision.text)) tx.update(col(deps, 'Chunks').doc(old.chunkId), { active: false });
    tx.set(sourceRef, source);
    tx.create(col(deps, 'Revisions').doc(rev), { source: card(source), text, sourceId, revisionId: rev, version, createdAt: now(deps) });
    for (const chunk of chunks) tx.create(col(deps, 'Chunks').doc(chunk.chunkId), chunk);
    tx.create(col(deps, 'Jobs').doc(rev), { jobId: rev, sourceId, revisionId: rev, status: 'pending', retryGeneration: 0, createdAt: now(deps) });
    tx.create(col(deps, 'Audit').doc(rev), { action: origin ? 'index_source_snapshot' : 'save_source', actor, sourceId, revisionId: rev, textHash: source.textHash, createdAt: now(deps) });
    const result = { sourceId, revisionId: rev, version, passageCount: chunks.length, jobId: rev };
    tx.create(executionRef, { intent, receipt: result, createdAt: now(deps) });
    return result;
  });
  const persisted = await read(deps, 'Revisions', receipt.revisionId);
  if (persisted.source.textHash !== hash(text)) fail('Source read-back mismatch', 500);
  const job = await read(deps, 'Jobs', receipt.jobId);
  return { ...receipt, readBackVerified: true, indexingStatus: job.status,
    dispatchStatus: job.status === 'completed' ? 'completed' : await dispatch(job.jobId, job.retryGeneration, deps) };
}
function upstreamFingerprint(record, kind) {
  return hash(stableStringify({ title:record.title || '', text:kind==='document'?record.ocr?.bestText || '':record.content || '',
    textLayer:kind==='document'?record.ocr?.bestTextSource || 'bestText':'content', reviewStatus:record.reviewStatus || 'unreviewed',
    originalFilename:record.originalFilename || '',originalFolderLabel:record.originalFolderLabel || '',binLabel:record.binLabel || '',scanBatchLabel:record.scanBatchLabel || '',
    sourceNotes:record.sourceNotes || record.sourceLocationNotes || '',tags:record.tags || [],linkedItemIds:record.linkedItemIds || [],availability:record.availability || '' }));
}
async function importSource(input, actor, deps) {
  if (Boolean(input.documentId) === Boolean(input.entryId)) fail('Supply exactly one documentId or entryId');
  const kind = input.documentId ? 'document' : 'library_note', recordId = id(input.documentId || input.entryId, 'recordId');
  const ref = deps.db.collection(kind === 'document' ? 'repositoryDocuments' : 'repositoryLibraryEntries').doc(recordId);
  const snap = await ref.get();
  if (!snap.exists) fail('Original repository record not found', 404);
  const record = snap.data();
  if (kind === 'library_note' && (record.kind !== 'note' || record.availability === 'unavailable')) fail('Only available library notes can be indexed');
  const text = kind === 'document' ? record.ocr?.bestText : record.content;
  if (!text?.trim()) fail('The source has no usable text yet; complete OCR before indexing');
  const contentKind = kind === 'document' ? 'ocr_text' : 'exact_text';
  const origin = { kind, recordId, textLayer: kind === 'document' ? record.ocr.bestTextSource || 'bestText' : 'content',
    originalFilename: record.originalFilename || '', originalFolderLabel: record.originalFolderLabel || '',
    binLabel: record.binLabel || '', scanBatchLabel: record.scanBatchLabel || '', reviewStatus: record.reviewStatus || 'unreviewed',
    upstreamVersion: record.version || null, upstreamTextHash: hash(text), upstreamFingerprint: upstreamFingerprint(record,kind) };
  return saveSource({ title: record.title || record.originalFilename, sourceType: kind === 'document' ? 'document' : 'research_note',
    contentKind, text, tags: record.tags || [], sourceNotes: record.sourceNotes || record.sourceLocationNotes || '',
    relatedItemIds: record.linkedItemIds || [], idempotencyKey: input.idempotencyKey }, actor, deps, origin);
}
async function sourceFreshness(source, deps) {
  if (!source.origin) return 'current';
  const o = source.origin, snap = await deps.db.collection(o.kind === 'document' ? 'repositoryDocuments' : 'repositoryLibraryEntries').doc(o.recordId).get();
  if (!snap.exists || snap.data().availability === 'unavailable') return 'unavailable';
  const r = snap.data(), text = o.kind === 'document' ? r.ocr?.bestText : r.content;
  return upstreamFingerprint(r,o.kind) === o.upstreamFingerprint ? 'current' : 'upstream_changed';
}
async function getSource(input, deps) {
  const current = await read(deps, 's', id(input.sourceId));
  const rev = input.version === undefined ? current.revisionId : revisionId(current.sourceId, number(input.version, 1, 1000000));
  const snapshot = input.includeText === true || rev !== current.revisionId ? await read(deps, 'Revisions', rev) : null;
  return { source: card(rev===current.revisionId?current:snapshot.source), currentVersion: current.version,
    freshness: await sourceFreshness(snapshot?.source || current, deps), ...(input.includeText === true ? { text: snapshot.text } : {}) };
}
function citation(source, chunk) {
  return { sourceId: source.sourceId, revisionId: chunk.revisionId, version: chunk.version, title: source.title,
    sourceType: source.sourceType, contentKind: source.contentKind, authors: source.authors, speaker: source.speaker,
    sourceDate: source.sourceDate, origin: source.origin, chunkId: chunk.chunkId, sectionTitle: chunk.sectionTitle,
    startOffset: chunk.startOffset, endOffset: chunk.endOffset, offsetUnit: chunk.offsetUnit };
}
async function getPassage(input, deps) {
  const chunk = await read(deps, 'Chunks', id(input.chunkId, 'chunkId'));
  const revision = await read(deps, 'Revisions', chunk.revisionId);
  const neighbors = input.includeNeighbors === true ? makeChunks(revision.source, revision.text).filter(c => Math.abs(c.ordinal - chunk.ordinal) <= 1) : [chunk];
  const current = await read(deps, 's', chunk.sourceId);
  return { passages: neighbors.map(c => ({ text: c.text, citation: citation(revision.source, c) })),
    currentVersion: current.version, isCurrentVersion: current.version === chunk.version, freshness: await sourceFreshness(revision.source, deps) };
}
function matches(s, input) {
  return (!input.sourceType || s.sourceType === input.sourceType) && (!input.contentKind || s.contentKind === input.contentKind)
    && (!input.speaker || s.speaker.toLowerCase() === input.speaker.toLowerCase())
    && (!input.sourceDate || s.sourceDate === input.sourceDate)
    && (!input.itemId || s.relatedItemIds.includes(input.itemId));
}
async function searchSources(input, deps) {
  const query = str(input.query, 'query', 500, true), terms = searchWords(query), limit = number(input.limit, 5, 20);
  if (input.sourceType && !TYPES.includes(input.sourceType)) fail('Invalid sourceType');
  if (input.sourceDate) date(input.sourceDate);
  const binding = hash(stableStringify({ query, sourceType: input.sourceType || '', contentKind: input.contentKind || '', speaker: input.speaker || '', sourceDate: input.sourceDate || '', itemId: input.itemId || '' }));
  let q = col(deps, 's');
  if (terms.length) q = q.where('tokens', 'array-contains-any', terms);
  q = q.orderBy('sourceId');
  if (input.cursor) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(str(input.cursor, 'cursor', 1000), 'base64url').toString()); } catch { fail('Invalid cursor'); }
    if (cursor.binding !== binding) fail('Cursor belongs to another query');
    q = q.startAfter(id(cursor.after));
  }
  const docs = (await q.limit(101).get()).docs, candidates = docs.slice(0, 100);
  const selected = []; let scanned = 0, last = '';
  for (const d of candidates) {
    scanned++; last = d.id;
    if (matches(d.data(), input)) selected.push(d.data());
    if (selected.length === limit) break;
  }
  const more = scanned < docs.length;
  selected.sort((a,b) => {
    const score = s => (query && s.title.toLowerCase().includes(query.toLowerCase()) ? 20 : 0) + terms.filter(t=>s.tokens.includes(t)).length;
    return score(b)-score(a) || b.sourceDate.localeCompare(a.sourceDate);
  });
  return { results: selected.map(summary), nextCursor: more ? Buffer.from(JSON.stringify({ binding, after:last })).toString('base64url') : '',
    coverage: { candidateCount: scanned, candidatePageComplete: !more, ranking: 'within returned page; follow nextCursor for more matches',
      scope: 'indexed repository sources; legacy PDFs and library notes require importSource', searchType: 'metadata_keywords' } };
}
async function searchPassages(input, deps) {
  const started = Date.now(), query = str(input.query, 'query', 500), terms = searchWords(query);
  const limit = number(input.limit, 5, 10), maxCharacters = number(input.maxCharacters, 8000, 20000);
  const mode = input.mode || 'hybrid';
  if (!['words', 'hybrid'].includes(mode)) fail('mode must be words or hybrid');
  const sourceId = input.sourceId ? id(input.sourceId) : '';
  if (sourceId) await read(deps, 's', sourceId);
  let base = col(deps, 'Chunks').where('active', '==', true);
  if (sourceId) base = base.where('sourceId', '==', sourceId);
  const lexical = terms.length ? (await base.where('tokens', 'array-contains-any', terms).limit(101).get()).docs : [];
  let semantic = [], semanticStatus = mode === 'words' ? 'not_requested' : 'available';
  if (mode === 'hybrid') {
    try {
      const embedding = await deps.embedText(query, { taskType: 'RETRIEVAL_QUERY', model: deps.embeddingModel });
      semantic = (await base.where('embeddingModel', '==', deps.embeddingModel).findNearest({ vectorField: 'embeddingVector',
        queryVector: embedding, limit: 40, distanceMeasure: 'COSINE', distanceResultField: 'vectorDistance' }).get()).docs;
    } catch { semanticStatus = 'unavailable'; }
  }
  const found = new Map();
  lexical.slice(0,100).forEach(d => found.set(d.id, { chunk: d.data(), score: 0 }));
  semantic.forEach((d,i) => { const entry = found.get(d.id) || { chunk:d.data(), score:0 }; entry.score += 1/(60+i+1); found.set(d.id,entry); });
  for (const e of found.values()) e.score += terms.filter(t=>e.chunk.tokens.includes(t)).length / Math.max(terms.length,1) + (e.chunk.text.toLowerCase().includes(query.toLowerCase()) ? 3 : 0);
  const sorted = [...found.values()].sort((a,b)=>b.score-a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId));
  const seenSources=new Set(), primary=[], secondary=[];
  for(const entry of sorted){if(seenSources.has(entry.chunk.sourceId))secondary.push(entry);else{primary.push(entry);seenSources.add(entry.chunk.sourceId);}}
  const ranked=sourceId?sorted:[...primary,...secondary];
  const sources = new Map(), freshness = new Map(), results = []; let used = 0, staleSkipped = 0, outdatedSkipped = 0;
  for (const {chunk} of ranked) {
    if (!sources.has(chunk.sourceId)) sources.set(chunk.sourceId, await read(deps,'s',chunk.sourceId));
    const source = sources.get(chunk.sourceId);
    if (source.revisionId !== chunk.revisionId) { outdatedSkipped++; continue; }
    if (!matches(source,input)) continue;
    if (!freshness.has(chunk.sourceId)) freshness.set(chunk.sourceId,await sourceFreshness(source,deps));
    if (freshness.get(chunk.sourceId) !== 'current') { staleSkipped++; continue; }
    if (used + chunk.text.length > maxCharacters) continue;
    results.push({ text:chunk.text, citation:citation(source,chunk), indexingStatus:source.indexingStatus }); used += chunk.text.length;
    if (results.length >= limit) break;
  }
  return { results, coverage: { lexicalCandidates: Math.min(lexical.length,100), lexicalTruncated:lexical.length>100,
    semanticCandidates:semantic.length, semanticStatus, staleSkipped, outdatedSkipped, exhaustive:false,
    scope:'current indexed repository source passages', returnedCharacters:used, maxCharacters },
    metrics: { durationMs:Date.now()-started, candidateDocumentsRead:lexical.length+semantic.length, sourceDocumentsRead:sources.size,
      queryEmbeddingCalls:mode==='hybrid'?1:0, returnedCharacters:used } };
}
async function retryIndexing(input, deps) {
  const sourceId = id(input.sourceId);
  const result = await deps.db.runTransaction(async tx => {
    const source = await read(deps,'s',sourceId,tx);
    if (source.version !== input.expectedVersion) fail('Source changed; read it again',409);
    const job = await read(deps,'Jobs',source.revisionId,tx);
    if(job.status==='completed') return {jobId:job.jobId,retryGeneration:job.retryGeneration,status:'completed'};
    if(job.status==='running'&&job.leaseUntil>Date.now()) fail('Indexing is already running',409);
    const retryGeneration=job.retryGeneration+1;
    tx.update(col(deps,'Jobs').doc(job.jobId),{status:'pending',retryGeneration});
    return {jobId:job.jobId,retryGeneration,status:'pending'};
  });
  return {...result,dispatchStatus:result.status==='completed'?'completed':await dispatch(result.jobId,result.retryGeneration,deps)};
}
async function processIndexingJob(jobId, deps) {
  id(jobId,'jobId');
  const lease = randomUUID(), jobRef = col(deps,'Jobs').doc(jobId);
  const acquired = await deps.db.runTransaction(async tx=>{
    const job=await read(deps,'Jobs',jobId,tx),source=await read(deps,'s',job.sourceId,tx);
    if (source.revisionId!==job.revisionId) {tx.update(jobRef,{status:'superseded'});return false;}
    if(job.status==='completed') return false;
    if(job.status==='running'&&job.leaseUntil>Date.now()) fail('Indexing lease busy',409);
    tx.update(jobRef,{status:'running',lease,leaseUntil:Date.now()+15*60*1000});return true;
  });
  if(!acquired)return {jobId,status:'already_finished'};
  let calls=0,cacheHits=0;
  try {
    const revision=await read(deps,'Revisions',jobId);
    for(const chunk of makeChunks(revision.source,revision.text)) {
      if ((await read(deps,'s',chunk.sourceId)).revisionId!==jobId) fail('Indexing superseded',409,'repository_source_superseded');
      const content=`${revision.source.title}\n${chunk.sectionTitle}\n${chunk.text}`;
      const cacheRef=col(deps,'EmbeddingCache').doc(hash(deps.embeddingModel+'\n'+content));
      const cache=await cacheRef.get();let embedding;
      if(cache.exists){embedding=cache.data().values;cacheHits++;}
      else {
        embedding=await deps.embedText(content,{taskType:'RETRIEVAL_DOCUMENT',model:deps.embeddingModel});calls++;
        if(!Array.isArray(embedding)||embedding.length!==768||!embedding.every(Number.isFinite)) fail('Invalid embedding response',502);
        await cacheRef.set({values:embedding,model:deps.embeddingModel,createdAt:now(deps)});
      }
      await deps.db.runTransaction(async tx=>{
        const job=await read(deps,'Jobs',jobId,tx),source=await read(deps,'s',chunk.sourceId,tx);
        if(job.lease!==lease||source.revisionId!==chunk.revisionId) fail('Indexing superseded',409,'repository_source_superseded');
        tx.update(col(deps,'Chunks').doc(chunk.chunkId),{embeddingVector:deps.toVectorValue(embedding),embeddingModel:deps.embeddingModel});
      });
    }
    await deps.db.runTransaction(async tx=>{
      const job=await read(deps,'Jobs',jobId,tx),source=await read(deps,'s',job.sourceId,tx);
      if(job.lease!==lease||source.revisionId!==jobId) fail('Indexing superseded',409,'repository_source_superseded');
      tx.update(jobRef,{status:'completed',completedAt:now(deps),embeddingCalls:calls,cacheHits,leaseUntil:0});
      tx.update(col(deps,'s').doc(job.sourceId),{indexingStatus:'completed'});
    });
    return {jobId,status:'completed',embeddingCalls:calls,cacheHits};
  } catch(error) {
    await deps.db.runTransaction(async tx=>{
      const job=await read(deps,'Jobs',jobId,tx),source=await read(deps,'s',job.sourceId,tx);
      if(job.lease!==lease)return;
      const current=source.revisionId===jobId;
      tx.update(jobRef,{status:current?'failed':'superseded',leaseUntil:0,errorCode:'repository_source_indexing_failed'});
      if(current)tx.update(col(deps,'s').doc(job.sourceId),{indexingStatus:'failed'});
    });
    throw error;
  }
}
async function run(input, subject, deps) {
  const commands=COMMAND_OPERATIONS.includes(input.operation),queries=QUERY_OPERATIONS.includes(input.operation);
  if(!commands&&!queries)fail('Unknown repository source operation');
  if(input.mode!==(commands?'command':'query'))fail('Operation mode mismatch');
  const actor=await authorize(subject,commands,deps),args=input.arguments||{};
  switch(input.operation){
    case 'saveSource': return saveSource(args,actor,deps);
    case 'importSource': return importSource(args,actor,deps);
    case 'retryIndexing': return retryIndexing(args,deps);
    case 'getSource': return getSource(args,deps);
    case 'getPassage': return getPassage(args,deps);
    case 'searchSources': return searchSources(args,deps);
    case 'searchPassages': return searchPassages(args,deps);
    case 'getIndexingStatus': {const s=await read(deps,'s',id(args.sourceId));const j=await read(deps,'Jobs',s.revisionId);return {sourceId:s.sourceId,version:s.version,indexingStatus:s.indexingStatus,jobStatus:j.status,embeddingCalls:j.embeddingCalls||0,cacheHits:j.cacheHits||0};}
  }
}
module.exports={run,processIndexingJob,makeChunks,QUERY_OPERATIONS,COMMAND_OPERATIONS};
