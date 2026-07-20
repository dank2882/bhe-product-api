"use strict";

const { createHash, randomUUID } = require("node:crypto");

const SCRIPTURE_NOTE_STATUSES = ["active", "unresolved", "superseded"];
const SCRIPTURE_NOTE_TYPES = [
  "observation",
  "interpretation",
  "word_study",
  "theology",
  "cross_reference",
  "application",
  "illustration",
  "question",
  "quotation",
  "other"
];
const SCRIPTURE_NOTE_AUTHORSHIP = [
  "dan_verbatim",
  "dan_developed",
  "ai_synthesis",
  "external_source",
  "mixed",
  "unknown"
];
const SCRIPTURE_IMPORT_CLASSIFICATIONS = [
  "scripture_note",
  "external_quotation",
  "topical_material",
  "sermon_material",
  "noise",
  "unresolved"
];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 3;
const MAX_CLASSIFIER_SEGMENT_CHARS = 16000;

const BOOK_ALIASES = new Map(Object.entries({
  ge: "Genesis", gen: "Genesis", genesis: "Genesis",
  ex: "Exodus", exod: "Exodus", exodus: "Exodus",
  le: "Leviticus", lev: "Leviticus", leviticus: "Leviticus",
  nu: "Numbers", num: "Numbers", numbers: "Numbers",
  de: "Deuteronomy", deut: "Deuteronomy", deuteronomy: "Deuteronomy",
  jos: "Joshua", josh: "Joshua", joshua: "Joshua",
  jdg: "Judges", judg: "Judges", judges: "Judges", ruth: "Ruth",
  "1sa": "1 Samuel", "1sam": "1 Samuel", "1 samuel": "1 Samuel",
  "2sa": "2 Samuel", "2sam": "2 Samuel", "2 samuel": "2 Samuel",
  "1ki": "1 Kings", "1kgs": "1 Kings", "1 kings": "1 Kings",
  "2ki": "2 Kings", "2kgs": "2 Kings", "2 kings": "2 Kings",
  "1ch": "1 Chronicles", "1chr": "1 Chronicles", "1 chronicles": "1 Chronicles",
  "2ch": "2 Chronicles", "2chr": "2 Chronicles", "2 chronicles": "2 Chronicles",
  ezr: "Ezra", ezra: "Ezra", ne: "Nehemiah", neh: "Nehemiah", nehemiah: "Nehemiah",
  es: "Esther", est: "Esther", esther: "Esther", job: "Job",
  ps: "Psalm", psa: "Psalm", psalm: "Psalm", psalms: "Psalm",
  pr: "Proverbs", prov: "Proverbs", proverbs: "Proverbs",
  ec: "Ecclesiastes", ecc: "Ecclesiastes", eccl: "Ecclesiastes", ecclesiastes: "Ecclesiastes",
  so: "Song of Solomon", song: "Song of Solomon", "song of solomon": "Song of Solomon",
  isa: "Isaiah", isaiah: "Isaiah", jer: "Jeremiah", jeremiah: "Jeremiah",
  la: "Lamentations", lam: "Lamentations", lamentations: "Lamentations",
  eze: "Ezekiel", ezek: "Ezekiel", ezekiel: "Ezekiel", da: "Daniel", dan: "Daniel", daniel: "Daniel",
  ho: "Hosea", hos: "Hosea", hosea: "Hosea", joe: "Joel", joel: "Joel", am: "Amos", amos: "Amos",
  ob: "Obadiah", obad: "Obadiah", obadiah: "Obadiah", jon: "Jonah", jonah: "Jonah",
  mic: "Micah", micah: "Micah", na: "Nahum", nah: "Nahum", nahum: "Nahum",
  hab: "Habakkuk", habakkuk: "Habakkuk", zep: "Zephaniah", zeph: "Zephaniah", zephaniah: "Zephaniah",
  hag: "Haggai", haggai: "Haggai", zec: "Zechariah", zech: "Zechariah", zechariah: "Zechariah",
  mal: "Malachi", malachi: "Malachi", mt: "Matthew", matt: "Matthew", matthew: "Matthew",
  mk: "Mark", mrk: "Mark", mark: "Mark", lk: "Luke", luk: "Luke", luke: "Luke",
  jn: "John", joh: "John", john: "John", ac: "Acts", acts: "Acts",
  ro: "Romans", rom: "Romans", romans: "Romans",
  "1co": "1 Corinthians", "1cor": "1 Corinthians", "1 corinthians": "1 Corinthians",
  "2co": "2 Corinthians", "2cor": "2 Corinthians", "2 corinthians": "2 Corinthians",
  ga: "Galatians", gal: "Galatians", galatians: "Galatians",
  eph: "Ephesians", ephesians: "Ephesians", php: "Philippians", phil: "Philippians", philippians: "Philippians",
  col: "Colossians", colossians: "Colossians",
  "1th": "1 Thessalonians", "1thess": "1 Thessalonians", "1 thessalonians": "1 Thessalonians",
  "2th": "2 Thessalonians", "2thess": "2 Thessalonians", "2 thessalonians": "2 Thessalonians",
  "1ti": "1 Timothy", "1tim": "1 Timothy", "1 timothy": "1 Timothy",
  "2ti": "2 Timothy", "2tim": "2 Timothy", "2 timothy": "2 Timothy",
  tit: "Titus", titus: "Titus", phm: "Philemon", phlm: "Philemon", philemon: "Philemon",
  heb: "Hebrews", hebrews: "Hebrews", jas: "James", james: "James",
  "1pe": "1 Peter", "1pet": "1 Peter", "1 peter": "1 Peter",
  "2pe": "2 Peter", "2pet": "2 Peter", "2 peter": "2 Peter",
  "1jn": "1 John", "1john": "1 John", "1 john": "1 John",
  "2jn": "2 John", "2john": "2 John", "2 john": "2 John",
  "3jn": "3 John", "3john": "3 John", "3 john": "3 John",
  jude: "Jude", re: "Revelation", rev: "Revelation", revelation: "Revelation"
}));

function createScriptureNoteError(message, statusCode = 400, details = {}, code = "scripture_note_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : DEFAULT_LIMIT;
}

function normalizeStringArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(normalizeString)
    .filter(Boolean)));
}

function hashValue(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function createId(prefix, seed, deps = {}) {
  if (seed) return `${prefix}-${hashValue(seed).slice(0, 32)}`;
  const factory = typeof deps.randomUUID === "function" ? deps.randomUUID : randomUUID;
  return `${prefix}-${factory()}`;
}

function getCollection(deps, name) {
  const collection = deps[name];
  if (!collection || typeof collection.doc !== "function") {
    throw createScriptureNoteError(`${name} is not configured`, 500, {}, "scripture_note_collection_not_configured");
  }
  return collection;
}

async function loadCollection(collection, maximum = 20000) {
  const snapshot = await collection.limit(maximum).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function normalizeBook(value) {
  const clean = normalizeString(value).toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  return BOOK_ALIASES.get(clean) || BOOK_ALIASES.get(clean.replace(/^([1-3])\s+/, "$1")) || "";
}

function parseScriptureReference(value) {
  const clean = normalizeString(value)
    .replace(/\./g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*([:-])\s*/g, "$1")
    .replace(/\.$/, "");
  const match = clean.match(/^((?:[1-3]\s*)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+|\s+[A-Za-z]+)?)\s+(\d+)(?::(\d+))?(?:-(?:(\d+):)?(\d+))?$/i);
  if (!match) return null;
  const book = normalizeBook(match[1]);
  if (!book) return null;
  const chapterStart = Number(match[2]);
  const verseStart = match[3] ? Number(match[3]) : 0;
  const chapterEnd = match[4] ? Number(match[4]) : chapterStart;
  const verseEnd = match[5] ? Number(match[5]) : verseStart;
  if (chapterStart < 1 || chapterEnd < 1 || verseStart < 0 || verseEnd < 0) return null;
  const reference = verseStart
    ? `${book} ${chapterStart}:${verseStart}${chapterEnd !== chapterStart || verseEnd !== verseStart
      ? `-${chapterEnd !== chapterStart ? `${chapterEnd}:` : ""}${verseEnd}`
      : ""}`
    : `${book} ${chapterStart}`;
  return { reference, book, chapterStart, verseStart, chapterEnd, verseEnd };
}

function extractExplicitReference(value = "") {
  const firstLine = String(value).split(/\r?\n/).map(normalizeString).find(Boolean) || "";
  return parseScriptureReference(firstLine);
}

function stripConversationalResidue(value = "") {
  const lines = String(value)
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF\uFFFC]/g, "")
    .split(/\r?\n/);
  const residueIndex = lines.findIndex((line) =>
    /^(?:if you want|would you like|tell me the scenario|let me know if you want)\b/i.test(normalizeString(line)));
  const kept = residueIndex >= 0 ? lines.slice(0, residueIndex) : lines;
  return kept
    .filter((line, index) => !(index === 0 && /^here is the text from the image:?$/i.test(normalizeString(line))))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitScriptureNoteSource(rawText = "") {
  const clean = String(rawText)
    .replace(/^\uFEFF/, "")
    .replace(/^\s*Notes\s*/i, "")
    .replace(/\n\s*Exported from Logos Bible Study,[\s\S]*$/i, "")
    .trim();
  if (!clean) return [];
  const delimiterMatches = clean.match(/^\s*---\s*$/gm) || [];
  const rawSegments = delimiterMatches.length >= 2
    ? clean.split(/^\s*---\s*$/gm)
    : clean.split(/\n\s*\n\s*\n+/g);
  return rawSegments.map((segment, index) => {
    const contentOriginal = segment.trim();
    const lines = contentOriginal.split(/\r?\n/);
    const firstContentIndex = lines.findIndex((line) => normalizeString(line));
    const heading = firstContentIndex >= 0 ? normalizeString(lines[firstContentIndex]) : "";
    const body = firstContentIndex >= 0 ? lines.slice(firstContentIndex + 1).join("\n").trim() : "";
    return {
      index,
      heading,
      body,
      contentOriginal,
      content: stripConversationalResidue(body || heading),
      sourceHash: hashValue(contentOriginal)
    };
  }).filter((segment) => segment.contentOriginal);
}

function normalizeClassification(value) {
  const clean = normalizeString(value).toLowerCase();
  return SCRIPTURE_IMPORT_CLASSIFICATIONS.includes(clean) ? clean : "unresolved";
}

function normalizeNoteType(value) {
  const clean = normalizeString(value).toLowerCase();
  return SCRIPTURE_NOTE_TYPES.includes(clean) ? clean : "other";
}

function normalizeAuthorship(value) {
  const clean = normalizeString(value).toLowerCase();
  return SCRIPTURE_NOTE_AUTHORSHIP.includes(clean) ? clean : "unknown";
}

function normalizeConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, Number(numeric.toFixed(2))));
}

function normalizeForSimilarity(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(normalizeForSimilarity(left).split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(normalizeForSimilarity(right).split(" ").filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function buildSearchText(note = {}) {
  return [
    note.reference,
    note.anchorText,
    note.noteType,
    note.summary,
    note.content,
    note.attribution,
    ...(note.relatedReferences || []),
    ...(note.tags || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildNoteSummary(note = {}, fallbackId = "") {
  return {
    scriptureNoteId: note.scriptureNoteId || fallbackId,
    reference: note.reference || "",
    book: note.book || "",
    chapterStart: Number(note.chapterStart) || 0,
    verseStart: Number(note.verseStart) || 0,
    chapterEnd: Number(note.chapterEnd) || 0,
    verseEnd: Number(note.verseEnd) || 0,
    anchorType: note.anchorType || "passage",
    anchorText: note.anchorText || "",
    noteType: note.noteType || "other",
    summary: note.summary || "",
    authorship: note.authorship || "unknown",
    attribution: note.attribution || "",
    confidence: Number(note.confidence) || 0,
    status: note.status || "unresolved",
    sermonIds: normalizeStringArray(note.sermonIds),
    tags: normalizeStringArray(note.tags),
    createdAt: note.createdAt || "",
    updatedAt: note.updatedAt || ""
  };
}

function buildNoteDetail(note = {}, fallbackId = "") {
  return {
    ...buildNoteSummary(note, fallbackId),
    content: note.content || "",
    contentOriginal: note.contentOriginal || "",
    originalReference: note.originalReference || "",
    relatedReferences: normalizeStringArray(note.relatedReferences),
    warnings: normalizeStringArray(note.warnings),
    sourceImportIds: normalizeStringArray(note.sourceImportIds),
    sourceSegmentIds: normalizeStringArray(note.sourceSegmentIds),
    sermonSourceIds: normalizeStringArray(note.sermonSourceIds),
    sessionIds: normalizeStringArray(note.sessionIds),
    checkpointIds: normalizeStringArray(note.checkpointIds),
    contentHash: note.contentHash || ""
  };
}

function buildClassifierBatches(segments, batchSize = DEFAULT_BATCH_SIZE) {
  const batches = [];
  let current = [];
  let currentChars = 0;
  for (const segment of segments) {
    const inputChars = Math.min(segment.contentOriginal.length, MAX_CLASSIFIER_SEGMENT_CHARS);
    if (current.length && (current.length >= batchSize || currentChars + inputChars > 50000)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(segment);
    currentChars += inputChars;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function classifySegments(segments, input, deps) {
  if (typeof deps.classifyScriptureNoteSegments !== "function") {
    throw createScriptureNoteError(
      "Scripture note AI classifier is not configured",
      500,
      {},
      "scripture_note_classifier_not_configured"
    );
  }
  const batches = buildClassifierBatches(segments, Number(input.batchSize) || DEFAULT_BATCH_SIZE);
  const responses = await mapWithConcurrency(
    batches,
    Math.max(1, Math.min(Number(input.concurrency) || DEFAULT_CONCURRENCY, 5)),
    (batch) => deps.classifyScriptureNoteSegments({
      sourceLabel: normalizeString(input.sourceLabel),
      segments: batch.map((segment) => ({
        index: segment.index,
        heading: segment.heading,
        body: segment.body.slice(0, MAX_CLASSIFIER_SEGMENT_CHARS),
        truncated: segment.body.length > MAX_CLASSIFIER_SEGMENT_CHARS
      }))
    })
  );
  const byIndex = new Map();
  for (const response of responses) {
    const items = Array.isArray(response) ? response : response?.results;
    for (const item of Array.isArray(items) ? items : []) {
      if (Number.isInteger(Number(item.segmentIndex))) byIndex.set(Number(item.segmentIndex), item);
    }
  }
  const segmentsByHash = new Map();
  for (const segment of segments) {
    if (!segmentsByHash.has(segment.sourceHash)) segmentsByHash.set(segment.sourceHash, []);
    segmentsByHash.get(segment.sourceHash).push(segment);
  }
  for (const duplicateSegments of segmentsByHash.values()) {
    if (duplicateSegments.length < 2) continue;
    const classified = duplicateSegments
      .map((segment) => ({ segment, result: byIndex.get(segment.index) }))
      .filter(({ result }) => result);
    const informative = classified
      .filter(({ result }) => normalizeClassification(result.classification) !== "noise")
      .sort((left, right) => normalizeConfidence(right.result.confidence) - normalizeConfidence(left.result.confidence));
    if (!informative.length) continue;
    const informativeCategories = new Set(informative.map(({ result }) => normalizeClassification(result.classification)));
    if (informativeCategories.size !== 1) continue;
    const winner = informative[0].result;
    for (const { segment, result } of classified) {
      if (normalizeClassification(result.classification) !== "noise") continue;
      byIndex.set(segment.index, {
        ...winner,
        segmentIndex: segment.index,
        warnings: normalizeStringArray([
          ...(winner.warnings || []),
          "Routing reconciled with an identical source block."
        ])
      });
    }
  }
  return byIndex;
}

function buildCandidate(segment, classification, context = {}) {
  const category = normalizeClassification(classification?.classification);
  const explicitReference = extractExplicitReference(segment.heading);
  const parsedReference = parseScriptureReference(classification?.reference) || explicitReference;
  const confidence = normalizeConfidence(classification?.confidence);
  const originalReference = explicitReference?.reference || "";
  const status = parsedReference && confidence >= (context.activeConfidenceThreshold ?? 0.72)
    ? "active"
    : "unresolved";
  return {
    category,
    parsedReference,
    originalReference,
    status,
    confidence,
    anchorType: normalizeString(classification?.anchorType) || (parsedReference?.verseStart ? "verse" : "passage"),
    anchorText: normalizeString(classification?.anchorText),
    noteType: normalizeNoteType(classification?.noteType),
    summary: normalizeString(classification?.summary).slice(0, 1000),
    authorship: normalizeAuthorship(classification?.authorship),
    attribution: normalizeString(classification?.attribution).slice(0, 1000),
    relatedReferences: normalizeStringArray(classification?.relatedReferences)
      .map((reference) => parseScriptureReference(reference)?.reference || reference),
    tags: normalizeStringArray(classification?.tags),
    warnings: normalizeStringArray(classification?.warnings)
  };
}

function shouldCreateNote(candidate) {
  return ["scripture_note", "external_quotation", "unresolved"].includes(candidate.category);
}

function findDuplicateNote(candidate, content, notes) {
  const reference = candidate.parsedReference?.reference || "";
  const normalizedContent = normalizeForSimilarity(content);
  const exactHash = hashValue(`${reference}\u0000${normalizedContent}`);
  const exact = notes.find(({ data }) => data.contentHash === exactHash);
  if (exact) return { record: exact, similarity: 1, exact: true, contentHash: exactHash };
  const exactUnanchored = notes.find(({ data }) =>
    normalizeForSimilarity(data.content) === normalizedContent && (!reference || !normalizeString(data.reference)));
  if (exactUnanchored) {
    return { record: exactUnanchored, similarity: 1, exact: true, contentHash: exactHash };
  }
  const near = notes
    .filter(({ data }) => normalizeString(data.reference) === reference && reference)
    .map((record) => ({ record, similarity: tokenSimilarity(content, record.data.content) }))
    .sort((left, right) => right.similarity - left.similarity)[0];
  return near?.similarity >= 0.9
    ? { ...near, exact: false, contentHash: exactHash }
    : { record: null, similarity: near?.similarity || 0, exact: false, contentHash: exactHash };
}

async function importScriptureNotes(input = {}, deps = {}) {
  let rawText = normalizeString(input.rawText);
  let preparedSource = null;
  if (!rawText && Array.isArray(input.openaiFileIdRefs) && input.openaiFileIdRefs.length) {
    if (typeof deps.prepareScriptureNoteImportSource !== "function") {
      throw createScriptureNoteError("Scripture note file import is not configured", 500, {}, "scripture_note_file_import_not_configured");
    }
    preparedSource = await deps.prepareScriptureNoteImportSource({
      openaiFileIdRefs: input.openaiFileIdRefs,
      sourceLabel: input.sourceLabel
    });
    rawText = normalizeString(preparedSource.text);
  }
  if (!rawText) {
    throw createScriptureNoteError("Scripture note import requires rawText or one attached file", 400, {}, "scripture_note_import_source_required");
  }

  const sourceLabel = normalizeString(input.sourceLabel) || preparedSource?.originalFilename || "Imported Scripture notes";
  const sourceHash = hashValue(rawText);
  const importId = normalizeString(input.importId) || createId("scripture-note-import", `${sourceLabel}\u0000${sourceHash}`, deps);
  const imports = getCollection(deps, "scriptureNoteImportsCollection");
  const importRef = imports.doc(importId);
  const existingImportDoc = await importRef.get();
  if (existingImportDoc.exists && existingImportDoc.data()?.status === "completed" && input.force !== true) {
    return { action: "existing", import: existingImportDoc.data() };
  }

  const segments = splitScriptureNoteSource(rawText);
  if (!segments.length) {
    throw createScriptureNoteError("No Scripture note blocks were found", 400, {}, "scripture_note_import_empty");
  }
  const nowIso = getNowIso(deps);
  const importRecord = {
    importId,
    sourceLabel,
    sourceType: normalizeString(input.sourceType) || "logos_notes",
    sourceHash,
    sourceStoragePath: preparedSource?.storagePath || normalizeString(input.sourceStoragePath),
    originalFilename: preparedSource?.originalFilename || normalizeString(input.originalFilename),
    status: "processing",
    segmentCount: segments.length,
    createdAt: existingImportDoc.exists ? existingImportDoc.data()?.createdAt || nowIso : nowIso,
    updatedAt: nowIso
  };
  await importRef.set(importRecord);

  const classifications = await classifySegments(segments, { ...input, sourceLabel }, deps);
  const noteCollection = getCollection(deps, "scriptureNotesCollection");
  const segmentCollection = getCollection(deps, "scriptureNoteImportSegmentsCollection");
  const existingNotes = await loadCollection(noteCollection, 50000);
  const workingNotes = [...existingNotes];
  const counts = Object.fromEntries(SCRIPTURE_IMPORT_CLASSIFICATIONS.map((name) => [name, 0]));
  Object.assign(counts, { active: 0, unresolvedNotes: 0, duplicates: 0, referenceCorrections: 0, residueRemoved: 0 });
  const createdNoteIds = [];
  const unresolvedNoteIds = [];

  for (const segment of segments) {
    const rawClassification = classifications.get(segment.index) || {};
    const candidate = buildCandidate(segment, rawClassification, {
      activeConfidenceThreshold: Number(input.activeConfidenceThreshold) || 0.72
    });
    counts[candidate.category] += 1;
    const segmentId = createId("scripture-note-segment", `${importId}\u0000${segment.index}`, deps);
    const uncleanedContent = (segment.body || segment.heading).trim();
    const content = segment.content;
    if (content !== uncleanedContent) counts.residueRemoved += 1;
    const segmentRecord = {
      segmentId,
      importId,
      segmentIndex: segment.index,
      heading: segment.heading,
      contentOriginal: segment.contentOriginal,
      content,
      sourceHash: segment.sourceHash,
      classification: candidate.category,
      suggestedReference: candidate.parsedReference?.reference || "",
      originalReference: candidate.originalReference,
      confidence: candidate.confidence,
      warnings: candidate.warnings,
      status: "classified",
      createdAt: nowIso,
      updatedAt: nowIso
    };

    if (shouldCreateNote(candidate) && content) {
      const duplicate = findDuplicateNote(candidate, content, workingNotes);
      if (duplicate.record) {
        counts.duplicates += 1;
        segmentRecord.duplicateOfNoteId = duplicate.record.data.scriptureNoteId || duplicate.record.id;
        segmentRecord.duplicateSimilarity = Number(duplicate.similarity.toFixed(2));
        const merged = {
          ...duplicate.record.data,
          sourceImportIds: normalizeStringArray([...(duplicate.record.data.sourceImportIds || []), importId]),
          sourceSegmentIds: normalizeStringArray([...(duplicate.record.data.sourceSegmentIds || []), segmentId]),
          sermonIds: normalizeStringArray([...(duplicate.record.data.sermonIds || []), ...(input.sermonIds || [])]),
          updatedAt: nowIso
        };
        await noteCollection.doc(duplicate.record.id).set(merged);
        duplicate.record.data = merged;
      } else {
        const parsed = candidate.parsedReference;
        const noteId = createId("scripture-note", `${parsed?.reference || "unresolved"}\u0000${duplicate.contentHash}`, deps);
        const note = {
          scriptureNoteId: noteId,
          reference: parsed?.reference || "",
          book: parsed?.book || "",
          chapterStart: parsed?.chapterStart || 0,
          verseStart: parsed?.verseStart || 0,
          chapterEnd: parsed?.chapterEnd || 0,
          verseEnd: parsed?.verseEnd || 0,
          anchorType: candidate.anchorType,
          anchorText: candidate.anchorText,
          noteType: candidate.category === "external_quotation" ? "quotation" : candidate.noteType,
          content,
          contentOriginal: segment.contentOriginal,
          summary: candidate.summary,
          authorship: candidate.category === "external_quotation" ? "external_source" : candidate.authorship,
          attribution: candidate.attribution,
          confidence: candidate.confidence,
          status: candidate.status,
          originalReference: candidate.originalReference,
          relatedReferences: candidate.relatedReferences,
          warnings: candidate.warnings,
          tags: candidate.tags,
          sourceImportIds: [importId],
          sourceSegmentIds: [segmentId],
          sermonIds: normalizeStringArray(input.sermonIds),
          sessionIds: normalizeStringArray(input.sessionIds),
          checkpointIds: normalizeStringArray(input.checkpointIds),
          contentHash: duplicate.contentHash,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        note.searchText = buildSearchText(note);
        await noteCollection.doc(noteId).set(note);
        workingNotes.push({ id: noteId, data: note });
        segmentRecord.scriptureNoteId = noteId;
        if (note.status === "active") {
          counts.active += 1;
          createdNoteIds.push(noteId);
        } else {
          counts.unresolvedNotes += 1;
          unresolvedNoteIds.push(noteId);
        }
        if (candidate.originalReference && parsed?.reference && candidate.originalReference !== parsed.reference) {
          counts.referenceCorrections += 1;
        }
      }
    }
    await segmentCollection.doc(segmentId).set(segmentRecord);
  }

  const completed = {
    ...importRecord,
    status: "completed",
    counts,
    createdNoteCount: createdNoteIds.length,
    unresolvedNoteCount: unresolvedNoteIds.length,
    duplicateCount: counts.duplicates,
    createdNoteIds: input.compact === false ? createdNoteIds : createdNoteIds.slice(0, 25),
    unresolvedNoteIds: input.compact === false ? unresolvedNoteIds : unresolvedNoteIds.slice(0, 25),
    completedAt: getNowIso(deps),
    updatedAt: getNowIso(deps)
  };
  await importRef.set(completed);
  return { action: "imported", import: completed };
}

async function listScriptureNotes(input = {}, deps = {}) {
  const records = await loadCollection(getCollection(deps, "scriptureNotesCollection"), 50000);
  const reference = parseScriptureReference(input.reference)?.reference || normalizeString(input.reference);
  const query = normalizeString(input.query).toLowerCase();
  const status = normalizeString(input.status);
  const noteType = normalizeString(input.noteType);
  const authorship = normalizeString(input.authorship);
  const limit = normalizeLimit(input.limit);
  const requestedReference = parseScriptureReference(reference);
  const notes = records
    .filter(({ data }) => {
      if (!requestedReference) return !reference || normalizeString(data.reference).toLowerCase() === reference.toLowerCase();
      if (normalizeString(data.book) !== requestedReference.book) return false;
      const chapterStart = Number(data.chapterStart) || 0;
      const chapterEnd = Number(data.chapterEnd) || chapterStart;
      if (requestedReference.chapterStart < chapterStart || requestedReference.chapterEnd > chapterEnd) {
        if (chapterEnd < requestedReference.chapterStart || chapterStart > requestedReference.chapterEnd) return false;
      }
      if (!requestedReference.verseStart) return chapterStart <= requestedReference.chapterStart && chapterEnd >= requestedReference.chapterEnd;
      const verseStart = Number(data.verseStart) || 0;
      const verseEnd = Number(data.verseEnd) || verseStart;
      return chapterStart === requestedReference.chapterStart &&
        (!verseStart || verseEnd >= requestedReference.verseStart) &&
        (!requestedReference.verseEnd || verseStart <= requestedReference.verseEnd);
    })
    .filter(({ data }) => !status || data.status === status)
    .filter(({ data }) => !noteType || data.noteType === noteType)
    .filter(({ data }) => !authorship || data.authorship === authorship)
    .filter(({ data }) => !query || normalizeString(data.searchText || buildSearchText(data)).includes(query))
    .sort((left, right) => normalizeString(right.data.updatedAt).localeCompare(normalizeString(left.data.updatedAt)))
    .slice(0, limit)
    .map(({ id, data }) => buildNoteSummary(data, id));
  return { count: notes.length, notes };
}

async function listScriptureNoteImports(input = {}, deps = {}) {
  const records = await loadCollection(getCollection(deps, "scriptureNoteImportsCollection"), 10000);
  const status = normalizeString(input.status);
  const limit = normalizeLimit(input.limit);
  const imports = records
    .filter(({ data }) => !status || data.status === status)
    .sort((left, right) => normalizeString(right.data.updatedAt).localeCompare(normalizeString(left.data.updatedAt)))
    .slice(0, limit)
    .map(({ id, data }) => ({
      importId: data.importId || id,
      sourceLabel: data.sourceLabel || "",
      sourceType: data.sourceType || "",
      status: data.status || "",
      segmentCount: Number(data.segmentCount) || 0,
      createdNoteCount: Number(data.createdNoteCount) || 0,
      unresolvedNoteCount: Number(data.unresolvedNoteCount) || 0,
      duplicateCount: Number(data.duplicateCount) || 0,
      counts: data.counts || {},
      createdAt: data.createdAt || "",
      completedAt: data.completedAt || "",
      updatedAt: data.updatedAt || ""
    }));
  return { count: imports.length, imports };
}

async function listScriptureNoteImportSegments(input = {}, deps = {}) {
  const importId = normalizeString(input.importId);
  const classification = normalizeString(input.classification);
  const limit = normalizeLimit(input.limit);
  const records = await loadCollection(getCollection(deps, "scriptureNoteImportSegmentsCollection"), 50000);
  const segments = records
    .filter(({ data }) => !importId || data.importId === importId)
    .filter(({ data }) => !classification || data.classification === classification)
    .sort((left, right) => Number(left.data.segmentIndex) - Number(right.data.segmentIndex))
    .slice(0, limit)
    .map(({ id, data }) => ({
      segmentId: data.segmentId || id,
      importId: data.importId || "",
      segmentIndex: Number(data.segmentIndex) || 0,
      heading: data.heading || "",
      classification: data.classification || "unresolved",
      suggestedReference: data.suggestedReference || "",
      originalReference: data.originalReference || "",
      confidence: Number(data.confidence) || 0,
      scriptureNoteId: data.scriptureNoteId || "",
      duplicateOfNoteId: data.duplicateOfNoteId || "",
      warnings: normalizeStringArray(data.warnings)
    }));
  return { count: segments.length, segments };
}

async function getScriptureNote(input = {}, deps = {}) {
  const noteId = normalizeString(input.scriptureNoteId);
  if (!noteId) throw createScriptureNoteError("scriptureNoteId is required", 400, {}, "scripture_note_id_required");
  const doc = await getCollection(deps, "scriptureNotesCollection").doc(noteId).get();
  if (!doc.exists) throw createScriptureNoteError("Scripture note not found", 404, { scriptureNoteId: noteId }, "scripture_note_not_found");
  return { note: buildNoteDetail(doc.data() || {}, noteId) };
}

async function getPersonalScriptureCommentary(input = {}, deps = {}) {
  const parsed = parseScriptureReference(input.reference);
  if (!parsed) throw createScriptureNoteError("A valid Scripture reference is required", 400, {}, "scripture_reference_required");
  const result = await listScriptureNotes({
    reference: parsed.reference,
    status: input.includeUnresolved === true ? "" : "active",
    limit: input.limit || 100
  }, deps);
  const notes = await Promise.all(result.notes.map(async (summary) => {
    const detail = await getScriptureNote({ scriptureNoteId: summary.scriptureNoteId }, deps);
    return detail.note;
  }));
  return {
    reference: parsed.reference,
    count: notes.length,
    notes,
    attributionNotice: "AI-assisted and external-source notes retain authorship and attribution labels."
  };
}

async function updateScriptureNote(input = {}, deps = {}) {
  const noteId = normalizeString(input.scriptureNoteId);
  const collection = getCollection(deps, "scriptureNotesCollection");
  const ref = collection.doc(noteId);
  const doc = await ref.get();
  if (!doc.exists) throw createScriptureNoteError("Scripture note not found", 404, { scriptureNoteId: noteId }, "scripture_note_not_found");
  const current = { ...(doc.data() || {}), scriptureNoteId: noteId };
  const changes = input.changes && typeof input.changes === "object" ? input.changes : {};
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(changes, "reference")) {
    const parsed = parseScriptureReference(changes.reference);
    if (!parsed) throw createScriptureNoteError("Invalid Scripture reference", 400, {}, "invalid_scripture_reference");
    Object.assign(next, parsed);
    next.originalReference = current.originalReference || current.reference;
  }
  for (const field of ["anchorText", "summary", "content", "attribution"]) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) next[field] = normalizeString(changes[field]);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    const status = normalizeString(changes.status);
    if (!SCRIPTURE_NOTE_STATUSES.includes(status)) throw createScriptureNoteError("Invalid Scripture note status", 400, {}, "invalid_scripture_note_status");
    next.status = status;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "noteType")) next.noteType = normalizeNoteType(changes.noteType);
  if (Object.prototype.hasOwnProperty.call(changes, "tags")) next.tags = normalizeStringArray(changes.tags);
  next.contentHash = hashValue(`${next.reference || "unresolved"}\u0000${normalizeForSimilarity(next.content)}`);
  next.searchText = buildSearchText(next);
  next.updatedAt = getNowIso(deps);
  await ref.set(next);
  return { note: buildNoteDetail(next, noteId), previous: buildNoteDetail(current, noteId) };
}

async function extractScriptureNotesFromSermon(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  if (!sermonId) throw createScriptureNoteError("sermonId is required", 400, {}, "sermon_id_required");
  const sermonDoc = await getCollection(deps, "sermonsCollection").doc(sermonId).get();
  if (!sermonDoc.exists) throw createScriptureNoteError("Sermon not found", 404, { sermonId }, "sermon_not_found");
  const sermon = sermonDoc.data() || {};
  const checkpointRecords = await loadCollection(getCollection(deps, "sermonDevelopmentCheckpointsCollection"), 20000);
  const checkpoints = checkpointRecords
    .filter(({ data }) => data.sermonId === sermonId && data.checkpointType !== "pastoral_context")
    .map(({ id, data }) => ({ id, ...data }));
  const sections = [
    sermon.scriptureText ? `Primary passage: ${sermon.scriptureText}` : "",
    sermon.bigIdea ? `Big idea: ${sermon.bigIdea}` : "",
    sermon.outline ? `Outline:\n${sermon.outline}` : "",
    sermon.notes ? `Sermon notes:\n${sermon.notes}` : "",
    ...checkpoints.map((checkpoint) => [
      `Checkpoint ${checkpoint.checkpointType || "other"}`,
      checkpoint.heading || "",
      checkpoint.content || ""
    ].filter(Boolean).join("\n"))
  ].filter(Boolean);
  if (!sections.length) {
    return { action: "no_material", sermonId, import: null };
  }
  return importScriptureNotes({
    rawText: sections.join("\n\n---\n\n"),
    sourceLabel: `Sermon commentary extraction: ${sermon.title || sermonId}`,
    sourceType: "sermon_extraction",
    importId: createId("scripture-note-import", `sermon\u0000${sermonId}\u0000${hashValue(sections.join("\n"))}`, deps),
    sermonIds: [sermonId],
    checkpointIds: checkpoints.map((checkpoint) => checkpoint.id),
    compact: input.compact !== false,
    force: input.force === true
  }, deps);
}

async function saveReviewedPostPreachingScriptureNotes(input = {}, deps = {}) {
  const sermonId = normalizeString(input.sermonId);
  const analysisId = normalizeString(input.analysisId);
  const transcriptSourceId = normalizeString(input.transcriptSourceId);
  const proposalId = normalizeString(input.proposalId);
  const candidates = Array.isArray(input.candidates) ? input.candidates.slice(0, 25) : [];
  if (!sermonId || !analysisId || !transcriptSourceId || !proposalId) {
    throw createScriptureNoteError(
      "Post-sermon Scripture notes require sermon, analysis, transcript, and proposal identifiers",
      400,
      {},
      "post_preaching_scripture_note_provenance_required"
    );
  }
  if (!candidates.length) {
    return { action: "no_candidates", createdNoteCount: 0, duplicateCount: 0, noteIds: [] };
  }
  const noteCollection = getCollection(deps, "scriptureNotesCollection");
  const imports = getCollection(deps, "scriptureNoteImportsCollection");
  const segments = getCollection(deps, "scriptureNoteImportSegmentsCollection");
  const importId = createId("scripture-note-import", `post-preaching\u0000${proposalId}`, deps);
  const importRef = imports.doc(importId);
  const existingImport = await importRef.get();
  if (existingImport.exists && existingImport.data()?.status === "completed") {
    return { action: "existing", ...existingImport.data() };
  }
  const nowIso = getNowIso(deps);
  const existingNotes = await loadCollection(noteCollection, 50000);
  const workingNotes = [...existingNotes];
  const noteIds = [];
  let duplicateCount = 0;
  let unresolvedNoteCount = 0;
  await importRef.set({
    importId,
    sourceLabel: normalizeString(input.sourceLabel) || "Confirmed post-sermon reflection",
    sourceType: "post_preaching_reflection",
    sourceHash: hashValue(JSON.stringify(candidates)),
    status: "processing",
    segmentCount: candidates.length,
    sermonId,
    analysisId,
    transcriptSourceId,
    proposalId,
    createdAt: nowIso,
    updatedAt: nowIso
  });

  for (let index = 0; index < candidates.length; index += 1) {
    const rawCandidate = candidates[index] || {};
    const content = normalizeString(rawCandidate.content);
    const parsed = parseScriptureReference(rawCandidate.reference);
    if (!content) continue;
    const reference = parsed?.reference || "";
    const confidence = normalizeConfidence(rawCandidate.confidence);
    const contentHash = hashValue(`${reference}\u0000${normalizeForSimilarity(content)}`);
    const segmentId = createId("scripture-note-segment", `${importId}\u0000${index}`, deps);
    const duplicate = workingNotes.find(({ data }) => data.contentHash === contentHash);
    const segmentRecord = {
      segmentId,
      importId,
      segmentIndex: index,
      heading: reference,
      contentOriginal: content,
      content,
      sourceHash: contentHash,
      classification: parsed ? "scripture_note" : "unresolved",
      suggestedReference: reference,
      confidence,
      warnings: parsed ? [] : ["The reviewed note could not be anchored to a canonical Scripture reference."],
      status: "classified",
      evidenceQuote: normalizeString(rawCandidate.evidenceQuote),
      reason: normalizeString(rawCandidate.reason),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    if (duplicate) {
      duplicateCount += 1;
      const duplicateId = duplicate.data.scriptureNoteId || duplicate.id;
      const merged = {
        ...duplicate.data,
        sourceImportIds: normalizeStringArray([...(duplicate.data.sourceImportIds || []), importId]),
        sourceSegmentIds: normalizeStringArray([...(duplicate.data.sourceSegmentIds || []), segmentId]),
        sermonIds: normalizeStringArray([...(duplicate.data.sermonIds || []), sermonId]),
        sermonSourceIds: normalizeStringArray([...(duplicate.data.sermonSourceIds || []), transcriptSourceId]),
        preachingAnalysisIds: normalizeStringArray([...(duplicate.data.preachingAnalysisIds || []), analysisId]),
        updatedAt: nowIso
      };
      await noteCollection.doc(duplicateId).set(merged);
      duplicate.data = merged;
      segmentRecord.duplicateOfNoteId = duplicateId;
      noteIds.push(duplicateId);
    } else {
      const noteId = createId("scripture-note", `${reference || "unresolved"}\u0000${contentHash}`, deps);
      const status = parsed && confidence >= 0.72 ? "active" : "unresolved";
      const note = {
        scriptureNoteId: noteId,
        reference,
        book: parsed?.book || "",
        chapterStart: parsed?.chapterStart || 0,
        verseStart: parsed?.verseStart || 0,
        chapterEnd: parsed?.chapterEnd || 0,
        verseEnd: parsed?.verseEnd || 0,
        anchorType: parsed?.verseStart ? (parsed.verseEnd ? "range" : "verse") : "passage",
        anchorText: "",
        noteType: normalizeNoteType(rawCandidate.noteType),
        content,
        contentOriginal: content,
        summary: normalizeString(rawCandidate.reason).slice(0, 1000),
        authorship: normalizeAuthorship(rawCandidate.authorship),
        attribution: "",
        confidence,
        status,
        originalReference: normalizeString(rawCandidate.reference),
        relatedReferences: [],
        warnings: segmentRecord.warnings,
        tags: ["post-sermon-reflection"],
        sourceImportIds: [importId],
        sourceSegmentIds: [segmentId],
        sermonIds: [sermonId],
        sermonSourceIds: [transcriptSourceId],
        preachingAnalysisIds: [analysisId],
        checkpointIds: [],
        contentHash,
        evidenceQuote: normalizeString(rawCandidate.evidenceQuote),
        reflectionProposalId: proposalId,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      note.searchText = buildSearchText(note);
      await noteCollection.doc(noteId).set(note);
      workingNotes.push({ id: noteId, data: note });
      segmentRecord.scriptureNoteId = noteId;
      noteIds.push(noteId);
      if (status === "unresolved") unresolvedNoteCount += 1;
    }
    await segments.doc(segmentId).set(segmentRecord);
  }

  const completed = {
    importId,
    sourceLabel: normalizeString(input.sourceLabel) || "Confirmed post-sermon reflection",
    sourceType: "post_preaching_reflection",
    sourceHash: hashValue(JSON.stringify(candidates)),
    status: "completed",
    sermonId,
    analysisId,
    transcriptSourceId,
    proposalId,
    segmentCount: candidates.length,
    createdNoteCount: noteIds.length - duplicateCount,
    unresolvedNoteCount,
    duplicateCount,
    noteIds,
    completedAt: getNowIso(deps),
    createdAt: existingImport.exists ? existingImport.data()?.createdAt || nowIso : nowIso,
    updatedAt: getNowIso(deps)
  };
  await importRef.set(completed);
  return { action: "saved", ...completed };
}

module.exports = {
  SCRIPTURE_IMPORT_CLASSIFICATIONS,
  SCRIPTURE_NOTE_AUTHORSHIP,
  SCRIPTURE_NOTE_STATUSES,
  SCRIPTURE_NOTE_TYPES,
  extractScriptureNotesFromSermon,
  getPersonalScriptureCommentary,
  getScriptureNote,
  importScriptureNotes,
  listScriptureNoteImportSegments,
  listScriptureNoteImports,
  listScriptureNotes,
  parseScriptureReference,
  saveReviewedPostPreachingScriptureNotes,
  splitScriptureNoteSource,
  stripConversationalResidue,
  tokenSimilarity,
  updateScriptureNote
};
