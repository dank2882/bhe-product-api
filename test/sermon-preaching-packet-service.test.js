const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { buildSermonMaterialFingerprint } = require("../lib/sermon-workspace-service");

const {
  createSermonPreachingPacket,
  getSermonPreachingPacket,
  listSermonPreachingPackets
} = require("../lib/sermon-preaching-packet-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(store, id) { this.store = store; this.id = id; }
  async get() { return { exists: this.store.has(this.id), data: () => clone(this.store.get(this.id)) }; }
  async create(data) {
    if (this.store.has(this.id)) throw new Error("already exists");
    this.store.set(this.id, clone(data));
  }
  async set(data) { this.store.set(this.id, clone(data)); }
}

class FakeCollection {
  constructor(records = {}) { this.store = new Map(Object.entries(clone(records))); }
  doc(id) { return new FakeDocRef(this.store, id); }
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

function createDeps({ primaryManuscriptSourceId = "source-manuscript" } = {}) {
  const uploaded = [];
  return {
    sermonsCollection: new FakeCollection({
      "sermon-1": {
        sermonId: "sermon-1",
        title: "The Lord Upholdeth the Righteous",
        status: "developing",
        scriptureText: "Psalm 37:17",
        bigIdea: "Christ gives and keeps our righteous standing.",
        outline: "I. No righteousness of our own\nII. Christ gives righteousness\nIII. The Lord upholds",
        primaryManuscriptSourceId
      }
    }),
    sermonOccasionsCollection: new FakeCollection(),
    sermonDevelopmentCheckpointsCollection: new FakeCollection(),
    sermonSourcesCollection: new FakeCollection({
      "source-commentary": {
        sourceId: "source-commentary",
        sermonId: "sermon-1",
        sourceType: "scripture_commentary",
        sourceLabel: "Psalm 37:17 commentary",
        summary: "Grace makes and keeps the believer righteous.",
        createdAt: "2026-07-11T20:00:00.000Z"
      },
      "source-manuscript": {
        sourceId: "source-manuscript",
        sermonId: "sermon-1",
        sourceType: "doc",
        sourceLabel: "Accepted manuscript",
        material: "The same grace that made me righteous is the grace that keeps me standing.",
        sourceRefs: [{
          type: "cloud_storage_docx",
          role: "manuscript_draft",
          storagePath: "sermon-manuscripts/sermon-1/manuscript.docx",
          filename: "manuscript.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: 12
        }],
        createdAt: "2026-07-11T21:00:00.000Z"
      }
    }),
    sermonPresentationsCollection: new FakeCollection({
      "presentation-1": {
        presentationId: "presentation-1",
        sermonId: "sermon-1",
        title: "The Lord Upholdeth the Righteous",
        status: "rendered",
        aspectRatio: "16:9",
        slideCount: 12,
        templateId: "template-default",
        filename: "slides.pptx",
        storagePath: "sermon-presentations/sermon-1/slides.pptx",
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: 11,
        createdAt: "2026-07-11T22:00:00.000Z"
      }
    }),
    sermonPreachingPacketsCollection: new FakeCollection(),
    downloadSermonArtifact: async ({ storagePath }) => Buffer.from(storagePath.endsWith(".docx") ? "docx-content" : "pptx-content"),
    uploadSermonPreachingPacket: async (input) => {
      uploaded.push(input);
      return {
        filename: "packet.zip",
        storagePath: "sermon-preaching-packets/sermon-1/packet.zip",
        contentType: "application/zip",
        sizeBytes: input.buffer.length,
        downloadUrl: "https://example.test/packet.zip",
        downloadUrlExpiresAt: "2026-07-18T22:00:00.000Z"
      };
    },
    uploaded,
    randomUUID: () => "12345678-aaaa-bbbb-cccc-123456789012",
    now: () => "2026-07-11T22:00:00.000Z"
  };
}

test("creates one preaching packet with editable artifacts and provenance manifests", async () => {
  const deps = createDeps();
  const result = await createSermonPreachingPacket({ sermonId: "sermon-1" }, deps);

  assert.equal(result.packet.status, "ready");
  assert.equal(result.packet.slideCount, 12);
  assert.equal(result.packet.sourceCount, 2);
  assert.equal(deps.uploaded.length, 1);
  const zip = await JSZip.loadAsync(deps.uploaded[0].buffer);
  assert.ok(zip.file("manuscript.docx"));
  assert.ok(zip.file("slides.pptx"));
  assert.ok(zip.file("the-lord-upholdeth-the-righteous-manuscript.txt"));
  assert.ok(zip.file("packet-manifest.json"));
  assert.ok(zip.file("source-manifest.json"));
  assert.ok(zip.file("README.txt"));
  const manifest = JSON.parse(await zip.file("packet-manifest.json").async("string"));
  assert.equal(manifest.sermon.scriptureText, "Psalm 37:17");
  assert.equal(manifest.manuscript.sourceId, "source-manuscript");
  assert.equal(manifest.presentation.aspectRatio, "16:9");

  const listed = await listSermonPreachingPackets({ sermonId: "sermon-1" }, deps);
  assert.equal(listed.count, 1);
  const fetched = await getSermonPreachingPacket({ packetId: result.packet.packetId }, deps);
  assert.equal(fetched.packet.filename, "packet.zip");
});

test("reloads a newly rendered presentation when its compact response omits the storage path", async () => {
  const deps = createDeps();
  deps.sermonPresentationsCollection = new FakeCollection();
  deps.createSermonPresentation = async () => ({
    presentation: {
      presentationId: "presentation-new",
      status: "rendered",
      filename: "slides.pptx"
    }
  });
  deps.getSermonPresentation = async ({ presentationId }) => ({
    presentation: {
      presentationId,
      sermonId: "sermon-1",
      title: "The Lord Upholdeth the Righteous",
      status: "rendered",
      aspectRatio: "16:9",
      slideCount: 13,
      templateId: "template-default",
      filename: "slides.pptx",
      storagePath: "sermon-presentations/sermon-1/slides.pptx"
    }
  });

  const result = await createSermonPreachingPacket({
    sermonId: "sermon-1",
    regenerateSlides: true,
    compact: true
  }, deps);

  assert.equal(result.presentation.presentationId, "presentation-new");
  assert.equal(result.presentation.slideCount, 13);
  assert.equal(deps.uploaded.length, 1);
});

test("requires an accepted primary manuscript before packaging", async () => {
  const deps = createDeps({ primaryManuscriptSourceId: "" });
  await assert.rejects(
    () => createSermonPreachingPacket({ sermonId: "sermon-1" }, deps),
    { code: "primary_manuscript_required", statusCode: 409 }
  );
  assert.equal(deps.uploaded.length, 0);
});

test("refuses to certify a preaching packet while development material is unplaced", async () => {
  const deps = createDeps();
  deps.sermonDevelopmentCheckpointsCollection = new FakeCollection({
    "checkpoint-unplaced": {
      checkpointId: "checkpoint-unplaced",
      sermonId: "sermon-1",
      checkpointType: "key_line",
      content: "This line still needs a placement decision.",
      materialStatus: "unplaced"
    }
  });

  await assert.rejects(
    () => createSermonPreachingPacket({ sermonId: "sermon-1" }, deps),
    { code: "sermon_material_plan_incomplete", statusCode: 409 }
  );
  assert.equal(deps.uploaded.length, 0);
});

test("requires settled packet artifacts to match the current material fingerprint", async () => {
  const deps = createDeps();
  const checkpoint = {
    checkpointId: "checkpoint-placed",
    sermonId: "sermon-1",
    checkpointType: "key_line",
    content: "The same grace that saved me sustains me.",
    materialStatus: "placed",
    placementTarget: "Conclusion"
  };
  deps.sermonDevelopmentCheckpointsCollection = new FakeCollection({
    [checkpoint.checkpointId]: checkpoint
  });

  await assert.rejects(
    () => createSermonPreachingPacket({ sermonId: "sermon-1" }, deps),
    { code: "sermon_manuscript_material_plan_stale", statusCode: 409 }
  );

  const materialFingerprint = buildSermonMaterialFingerprint([checkpoint]);
  const manuscript = deps.sermonSourcesCollection.store.get("source-manuscript");
  manuscript.sourceRefs.push({
    type: "sermon_material_plan",
    role: "manuscript_material_plan",
    materialFingerprint
  });
  deps.sermonSourcesCollection.store.set("source-manuscript", manuscript);
  const presentation = deps.sermonPresentationsCollection.store.get("presentation-1");
  presentation.materialFingerprint = materialFingerprint;
  deps.sermonPresentationsCollection.store.set("presentation-1", presentation);

  const result = await createSermonPreachingPacket({ sermonId: "sermon-1" }, deps);
  const zip = await JSZip.loadAsync(deps.uploaded[0].buffer);
  const manifest = JSON.parse(await zip.file("packet-manifest.json").async("string"));
  assert.equal(result.packet.status, "ready");
  assert.equal(manifest.materialPlan.materialFingerprint, materialFingerprint);
  assert.equal(manifest.materialPlan.manuscriptVerified, true);
  assert.equal(manifest.materialPlan.presentationVerified, true);
});
