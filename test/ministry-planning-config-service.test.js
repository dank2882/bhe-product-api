"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getMinistryPlanningConfig,
  normalizeSections
} = require("../lib/ministry-planning-config-service");

function createCollection(record = null) {
  return {
    doc: () => ({
      get: async () => ({
        exists: Boolean(record),
        data: () => record
      })
    })
  };
}

test("runtime config returns only requested Firestore-backed sections", async () => {
  const result = await getMinistryPlanningConfig(
    { sections: ["workflow", "serviceOrder"] },
    {
      ministryPlanningConfigCollection: createCollection({
        schemaVersion: "ministry-planning-runtime-config-v1",
        configVersion: "1-example",
        catalogVersion: "1-catalog",
        catalogHash: "hash",
        documents: {
          workflow: { content: "workflow" },
          songPlanning: { content: "songs" },
          serviceOrder: { content: "order" }
        },
        updatedAt: "2026-07-15T20:00:00.000Z",
        updatedBy: "test"
      })
    }
  );

  assert.deepEqual(result.returnedSections, ["workflow", "serviceOrder"]);
  assert.equal(result.documents.workflow.content, "workflow");
  assert.equal(result.documents.serviceOrder.content, "order");
  assert.equal(result.documents.songPlanning, undefined);
});

test("runtime config defaults to all sections", () => {
  assert.deepEqual(normalizeSections(), ["operatorGuidance", "workflow", "songPlanning", "serviceOrder", "pianoPlanning"]);
});

test("runtime config rejects unknown sections", () => {
  assert.throws(
    () => normalizeSections(["workflow", "mystery"]),
    { code: "unsupported_ministry_planning_config_section" }
  );
});
