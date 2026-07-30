const assert = require("node:assert/strict");
const test = require("node:test");

test("extractLogosSchedulerRecords deduplicates delivery rows and preserves structured metadata", async () => {
  const { extractLogosSchedulerRecords } = await import("../scripts/lib/logos-sermon-scheduler.mjs");
  const info = {
    author: { name: "Pastor Daniel Kirchner" },
    series: { title: "The Greatness of our God" },
    seriesNumber: 3,
    tagsInfo: {
      referenceTags: [{ text: "Titus 2:11" }, { text: "Titus 2:14" }],
      topicTags: [{ text: "Grace" }, { text: "Salvation" }],
      miscellaneousTags: [{ text: "Again" }, { text: "transcript" }]
    },
    audiences: ["general"],
    description: [{ content: [{ text: "Grace bringeth salvation." }] }],
    notes: [{ content: [{ text: "Preach this again." }] }],
    targetDuration: 45,
    fileLinks: [{ id: "file-1", name: "sermon.docx" }],
    occasions: [
      {
        date: "2025-04-16",
        venue: "Faith Baptist Church (Tacoma)",
        service: "Prayer Service 7pm"
      },
      {
        date: "2026-04-15",
        venue: "Faith Baptist Church (Tacoma)",
        service: "Prayer Service 7pm"
      }
    ]
  };
  const document = {
    title: "The grace of God",
    content: {
      info,
      blocks: [{ content: [{ text: "For the grace of God that bringeth salvation." }] }]
    }
  };

  const records = extractLogosSchedulerRecords({
    sermons: [
      {
        externalId: "abc123",
        occasionDate: "2025-04-16",
        occasionVenue: "Faith Baptist Church (Tacoma)",
        occasionService: "Prayer Service 7pm",
        document
      },
      {
        externalId: "abc123",
        occasionDate: "2026-04-15",
        occasionVenue: "Faith Baptist Church (Tacoma)",
        occasionService: "Prayer Service 7pm",
        document
      }
    ]
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].logosId, "abc123");
  assert.equal(records[0].series, "The Greatness of our God");
  assert.equal(records[0].seriesNumber, "3");
  assert.equal(records[0].scriptureText, "Titus 2:11; Titus 2:14");
  assert.deepEqual(records[0].tags, ["Again", "transcript"]);
  assert.deepEqual(records[0].topics, ["Grace", "Salvation"]);
  assert.deepEqual(records[0].audience, ["general"]);
  assert.equal(records[0].description, "Grace bringeth salvation.");
  assert.equal(records[0].privateNotes, "Preach this again.");
  assert.equal(records[0].targetDuration, "45");
  assert.equal(records[0].manuscriptText, "For the grace of God that bringeth salvation.");
  assert.equal(records[0].occasions.length, 2);
  assert.equal(records[0].logosMetadata.rowCount, 2);
  assert.deepEqual(records[0].logosMetadata.fileLinks, [{ id: "file-1", name: "sermon.docx" }]);
});

test("extractLogosSchedulerRecords keeps a row-level occasion when document occasions are blank", async () => {
  const { extractLogosSchedulerRecords } = await import("../scripts/lib/logos-sermon-scheduler.mjs");
  const records = extractLogosSchedulerRecords({
    sermons: [{
      externalId: "row-only",
      occasionDate: "2018-01-13",
      occasionVenue: "Faith Baptist Church (Tacoma)",
      occasionService: "Sunday Morning Service 11am",
      document: {
        title: "Yet they believed not on him",
        content: { info: {}, blocks: [] }
      }
    }]
  });

  assert.deepEqual(records[0].occasions, [{
    date: "2018-01-13",
    venue: "Faith Baptist Church (Tacoma)",
    service: "Sunday Morning Service 11am"
  }]);
});

