"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAssignmentValues,
  writeServiceAssignmentsToGoogleSheet
} = require("../lib/google-sheet-service-assignment-writer");

test("assignment values keep piano and ministry write groups separate", () => {
  const input = {
    pianoPlan: {
      assignments: [
        { position: "piano_1", displayName: "Primary" },
        { position: "piano_3", displayName: "Learner" }
      ]
    },
    ministryAssignments: {
      preacher: { displayName: "Preacher" },
      congregationalLeader: { displayName: "Leader" }
    }
  };

  assert.deepEqual(buildAssignmentValues({ ...input, writeGroups: ["pianos"] }), {
    "Piano 1": "Primary",
    "Piano 2": "",
    "Piano 3": "Learner",
    "Piano 4": ""
  });
  assert.equal(buildAssignmentValues({ ...input, writeGroups: ["ministry"] }).Preacher, "Preacher");
});

test("Google Sheet writer creates assignment headers and updates the service source row", async () => {
  const requests = [];
  const backups = [];
  const result = await writeServiceAssignmentsToGoogleSheet(
    {
      service: {
        serviceId: "service-1",
        sourceSheetName: "PROPOSED SCHEDULES",
        sourceRowNumber: 8
      },
      ministryAssignments: {
        preacher: { displayName: "Pastor Example" },
        congregationalLeader: { displayName: "Song Leader" },
        choirAccompanist: { displayName: "Choir Pianist" },
        specialAccompanists: [{ sourceColumnName: "Special #1", displayName: "Special Pianist" }]
      },
      writeGroups: ["ministry"]
    },
    {
      createGoogleSheetBackup: async (input) => {
        backups.push(input);
        return { created: true, backupSheetId: 99, backupTitle: "_BACKUP_test" };
      },
      googleSheetsRequest: async (request) => {
        requests.push(request);
        if (request.method === "GET") {
          return { values: [
            ["", "", "July"],
            ["Theme", "", "Date/Service", "Congregational #1"]
          ] };
        }
        return { totalUpdatedCells: request.data.data.length };
      }
    }
  );

  assert.equal(result.written, true);
  assert.equal(result.sourceRowNumber, 8);
  assert.equal(result.backup.backupSheetId, 99);
  assert.equal(backups[0].serviceId, "service-1");
  assert.ok(result.updatedHeaders.includes("Preacher"));
  const updates = requests[1].data.data;
  assert.ok(updates.some((entry) => entry.range.endsWith("L2") && entry.values[0][0] === "Preacher"));
  assert.ok(updates.some((entry) => entry.range.endsWith("L8") && entry.values[0][0] === "Pastor Example"));
  assert.ok(updates.some((entry) => entry.values[0][0] === "Special Pianist"));
});

test("Google Sheet writer requires the service source row", async () => {
  await assert.rejects(
    () => writeServiceAssignmentsToGoogleSheet(
      { service: { serviceId: "service-1" }, writeGroups: ["pianos"] },
      { googleSheetsRequest: async () => ({}) }
    ),
    { code: "service_sheet_row_not_found" }
  );
});
