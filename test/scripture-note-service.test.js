const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractScriptureNotesFromSermon,
  getPersonalScriptureCommentary,
  importScriptureNotes,
  listScriptureNoteImportSegments,
  listScriptureNoteImports,
  listScriptureNotes,
  parseScriptureReference,
  splitScriptureNoteSource,
  updateScriptureNote
} = require("../lib/scripture-note-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }
  async get() {
    return { exists: this.store.has(this.id), data: () => clone(this.store.get(this.id)) };
  }
  async set(data) {
    this.store.set(this.id, clone(data));
  }
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
  }
  doc(id) {
    return new FakeDocRef(this.store, id);
  }
  limit(maximum) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries()).slice(0, maximum).map(([id, data]) => ({
          id,
          data: () => clone(data)
        }))
      })
    };
  }
}

function createDeps(overrides = {}) {
  return {
    scriptureNotesCollection: new FakeCollection(),
    scriptureNoteImportsCollection: new FakeCollection(),
    scriptureNoteImportSegmentsCollection: new FakeCollection(),
    sermonsCollection: new FakeCollection(),
    sermonDevelopmentCheckpointsCollection: new FakeCollection(),
    classifyScriptureNoteSegments: async ({ segments }) => ({
      results: segments.map((segment) => ({
        segmentIndex: segment.index,
        classification: "scripture_note",
        reference: segment.heading,
        anchorType: "verse",
        noteType: "observation",
        summary: "Imported observation",
        authorship: "dan_developed",
        confidence: 0.95,
        relatedReferences: [],
        tags: [],
        warnings: []
      }))
    }),
    now: () => "2026-07-11T21:00:00.000Z",
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    ...overrides
  };
}

test("normalizes common Scripture reference forms and ranges", () => {
  assert.equal(parseScriptureReference("Ps 37:17").reference, "Psalm 37:17");
  assert.equal(parseScriptureReference("James 2:14-26").reference, "James 2:14-26");
  assert.equal(parseScriptureReference("1 Cor. 13:1-7").reference, "1 Corinthians 13:1-7");
  assert.equal(parseScriptureReference("Eccl 3").reference, "Ecclesiastes 3");
  assert.equal(parseScriptureReference("not a reference"), null);
});

test("splits a Logos text export while preserving every source block", () => {
  const segments = splitScriptureNoteSource(`Notes\n\nPsalm 50:15\n\n---\n\nPsalm 37:17\n\nThe Lord upholdeth the righteous.\n\n---\n\nSeries Outline\n\nThree sermon ideas.\n\nExported from Logos Bible Study, today.`);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].heading, "Psalm 50:15");
  assert.equal(segments[1].body, "The Lord upholdeth the righteous.");
  assert.equal(segments[2].heading, "Series Outline");
});

test("automatically corrects references, removes residue, routes material, and deduplicates", async () => {
  const deps = createDeps({
    classifyScriptureNoteSegments: async ({ segments }) => ({
      results: segments.map((segment) => {
        if (segment.heading === "Psalm 4:3") {
          return {
            segmentIndex: segment.index,
            classification: "scripture_note",
            reference: "Psalm 3:3",
            anchorType: "verse",
            noteType: "interpretation",
            summary: "God is David's shield, glory, and restorer.",
            authorship: "ai_synthesis",
            confidence: 0.99,
            warnings: ["Heading conflicts with the quoted verse."],
            relatedReferences: ["Psalm 3:2"],
            tags: ["identity", "protection"]
          };
        }
        if (segment.heading === "Series Outline") {
          return {
            segmentIndex: segment.index,
            classification: "sermon_material",
            reference: "",
            confidence: 0.95
          };
        }
        return {
          segmentIndex: segment.index,
          classification: "scripture_note",
          reference: "Psalm 37:17",
          anchorType: "verse",
          noteType: "theology",
          summary: "Grace makes and keeps the believer righteous in Christ.",
          authorship: "mixed",
          confidence: 0.96,
          relatedReferences: ["Romans 3:22"],
          tags: ["grace"]
        };
      })
    })
  });
  const source = [
    "Psalm 4:3\n\nPsalm 3:3 says the LORD is my shield and the lifter of my head.",
    "Psalm 37:17\n\nThe same grace that made me righteous\u200c keeps me standing.\nIf you want, I can make an outline.",
    "Psalm 37:17\n\nThe same grace that made me righteous keeps me standing.\nIf you want, I can make an outline.",
    "Series Outline\n\nThree messages for next month."
  ].join("\n\n---\n\n");

  const result = await importScriptureNotes({
    rawText: source,
    sourceLabel: "Logos notes",
    compact: true
  }, deps);

  assert.equal(result.action, "imported");
  assert.equal(result.import.segmentCount, 4);
  assert.equal(result.import.counts.referenceCorrections, 1);
  assert.equal(result.import.counts.duplicates, 1);
  assert.equal(result.import.counts.sermon_material, 1);
  assert.equal(result.import.counts.residueRemoved, 2);
  assert.equal(deps.scriptureNoteImportSegmentsCollection.store.size, 4);
  assert.equal(deps.scriptureNotesCollection.store.size, 2);

  const psalmThree = await getPersonalScriptureCommentary({ reference: "Psalm 3:3" }, deps);
  assert.equal(psalmThree.count, 1);
  assert.equal(psalmThree.notes[0].originalReference, "Psalm 4:3");
  assert.doesNotMatch(psalmThree.notes[0].content, /If you want/i);
  const psalmThirtySeven = await getPersonalScriptureCommentary({ reference: "Psalm 37:17" }, deps);
  assert.doesNotMatch(psalmThirtySeven.notes[0].content, /[\u00AD\u200B-\u200D\u2060\uFEFF\uFFFC]/);

  const imports = await listScriptureNoteImports({}, deps);
  assert.equal(imports.imports[0].duplicateCount, 1);
  const segments = await listScriptureNoteImportSegments({ importId: result.import.importId }, deps);
  assert.equal(segments.count, 4);
});

test("keeps unresolved notes out of normal commentary but retains them for search", async () => {
  const deps = createDeps({
    classifyScriptureNoteSegments: async ({ segments }) => ({
      results: segments.map((segment) => ({
        segmentIndex: segment.index,
        classification: "unresolved",
        reference: "",
        anchorType: "phrase",
        anchorText: segment.heading,
        noteType: "observation",
        summary: "Potentially useful phrase note",
        authorship: "dan_verbatim",
        confidence: 0.4
      }))
    })
  });
  await importScriptureNotes({ rawText: "thou knowest not\n\nIt is critical to know what you do not know." }, deps);
  const unresolved = await listScriptureNotes({ status: "unresolved" }, deps);
  assert.equal(unresolved.count, 1);
  const commentary = await getPersonalScriptureCommentary({ reference: "Ecclesiastes 11:5" }, deps);
  assert.equal(commentary.count, 0);
});

test("reconciles exact duplicate routing and does not create an unanchored copy", async () => {
  const deps = createDeps({
    classifyScriptureNoteSegments: async ({ segments }) => ({
      results: segments.map((segment) => {
        if (segment.heading === "Topical duplicate") {
          return {
            segmentIndex: segment.index,
            classification: segment.index === 0 ? "topical_material" : "noise",
            confidence: 0.9
          };
        }
        return {
          segmentIndex: segment.index,
          classification: segment.heading === "John 16:31" ? "scripture_note" : "unresolved",
          reference: segment.heading === "John 16:31" ? "John 16:31" : "",
          noteType: "observation",
          summary: "God reveals where we truly are.",
          authorship: "dan_developed",
          confidence: segment.heading === "John 16:31" ? 0.95 : 0.4
        };
      })
    })
  });
  const source = [
    "Topical duplicate\n\nA reusable topical paragraph.",
    "Topical duplicate\n\nA reusable topical paragraph.",
    "John 16:31\n\nGod reveals where we truly are.",
    "Ambiguous heading\n\nGod reveals where we truly are."
  ].join("\n\n---\n\n");

  const result = await importScriptureNotes({ rawText: source }, deps);

  assert.equal(result.import.counts.topical_material, 2);
  assert.equal(result.import.counts.noise, 0);
  assert.equal(result.import.counts.duplicates, 1);
  assert.equal(deps.scriptureNotesCollection.store.size, 1);
  const segments = await listScriptureNoteImportSegments({ importId: result.import.importId }, deps);
  assert.equal(segments.segments[1].classification, "topical_material");
  assert.equal(segments.segments[3].duplicateOfNoteId, segments.segments[2].scriptureNoteId);
});

test("extracts sermon commentary without private pastoral-context checkpoints", async () => {
  let classifierInput = [];
  const deps = createDeps({
    sermonsCollection: new FakeCollection({
      "sermon-james": {
        sermonId: "sermon-james",
        title: "Living Faith",
        scriptureText: "James 2:14-26",
        bigIdea: "Living faith becomes visible through action.",
        outline: "1. A claim tested\n2. Faith displayed"
      }
    }),
    sermonDevelopmentCheckpointsCollection: new FakeCollection({
      public: { sermonId: "sermon-james", checkpointType: "key_line", content: "Faith has a pulse." },
      private: { sermonId: "sermon-james", checkpointType: "pastoral_context", content: "Private counseling detail." }
    }),
    classifyScriptureNoteSegments: async ({ segments }) => {
      classifierInput.push(...segments);
      return {
        results: segments.map((segment) => ({
          segmentIndex: segment.index,
          classification: "scripture_note",
          reference: "James 2:14-26",
          anchorType: "range",
          noteType: "interpretation",
          summary: "Living faith acts.",
          authorship: "dan_developed",
          confidence: 0.95
        }))
      };
    }
  });

  const result = await extractScriptureNotesFromSermon({ sermonId: "sermon-james" }, deps);
  assert.equal(result.action, "imported");
  assert.ok(classifierInput.some((segment) => segment.body.includes("Faith has a pulse")));
  assert.ok(!classifierInput.some((segment) => segment.body.includes("Private counseling detail")));
});

test("corrects a saved note while returning the previous state", async () => {
  const deps = createDeps({
    scriptureNotesCollection: new FakeCollection({
      note1: {
        scriptureNoteId: "note1",
        reference: "Psalm 4:3",
        book: "Psalm",
        chapterStart: 4,
        verseStart: 3,
        chapterEnd: 4,
        verseEnd: 3,
        content: "The LORD is my shield.",
        status: "active"
      }
    })
  });
  const result = await updateScriptureNote({
    scriptureNoteId: "note1",
    changes: { reference: "Psalm 3:3" }
  }, deps);
  assert.equal(result.previous.reference, "Psalm 4:3");
  assert.equal(result.note.reference, "Psalm 3:3");
  assert.equal(result.note.originalReference, "Psalm 4:3");
});
