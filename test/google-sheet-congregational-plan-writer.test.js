"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  writeServiceCongregationalPlanToGoogleSheet
} = require("../lib/google-sheet-congregational-plan-writer");

test("congregational writer backs up and changes only requested service cells", async () => {
  const requests = [];
  const backups = [];
  const result = await writeServiceCongregationalPlanToGoogleSheet(
    {
      service: {
        serviceId: "service-1",
        serviceDate: "2026-08-30",
        serviceType: "sunday_night",
        sourceSheetName: "PROPOSED SCHEDULES",
        sourceRowNumber: 31
      },
      changes: [
        { slot: "congregational_1", sourceColumnName: "Congregational #1", displayValue: "276 - Jesus Paid It All" },
        { slot: "congregational_2", sourceColumnName: "Congregational #2", displayValue: "311 - In the Cross of Christ I Glory" }
      ]
    },
    {
      createGoogleSheetBackup: async (input) => {
        backups.push(input);
        return { created: true, backupSheetId: 99 };
      },
      googleSheetsRequest: async (request) => {
        requests.push(request);
        if (request.path.includes("values:batchGet")) {
          return { valueRanges: [
            { values: [["276 - Jesus Paid It All"]] },
            { values: [["311 - In the Cross of Christ I Glory"]] }
          ] };
        }
        if (request.method === "GET") {
          const rows = Array.from({ length: 134 }, () => []);
          rows[0] = ["", "", "August"];
          rows[1] = ["Theme", "", "Date/Service", "Congregational #1", "Congregational #2", "Congregational #3"];
          rows[133] = ["", "", "August 30th PM"];
          return { values: rows };
        }
        return { totalUpdatedCells: request.data.data.length };
      }
    }
  );

  assert.equal(result.written, true);
  assert.equal(result.backup.backupSheetId, 99);
  assert.equal(result.verified, true);
  assert.equal(backups[0].reason, "before_service_song_plan_write");
  assert.deepEqual(result.changes.map(({ sourceCell }) => sourceCell), ["D134", "E134"]);
  assert.equal(result.rowResolution.storedSourceRowNumber, 31);
  assert.equal(result.rowResolution.provenanceCorrected, true);
  assert.equal(requests[1].data.data.length, 2);
  assert.equal(requests[1].data.data[0].values[0][0], "276 - Jesus Paid It All");
  assert.equal(requests[2].method, "GET");
});

test("congregational writer fails when the exact Sheet reread does not match", async () => {
  await assert.rejects(
    () => writeServiceCongregationalPlanToGoogleSheet(
      {
        service: { serviceId: "service-1", sourceSheetName: "PROPOSED SCHEDULES", sourceRowNumber: 31 },
        changes: [{ slot: "congregational_1", sourceColumnName: "Congregational #1", displayValue: "New Song" }]
      },
      {
        createGoogleSheetBackup: async () => ({ created: true, backupSheetId: 99 }),
        googleSheetsRequest: async (request) => {
          if (request.path.includes("values:batchGet")) return { valueRanges: [{ values: [["Old Song"]] }] };
          if (request.method === "GET") {
            return { values: [["", "", "Date/Service", "Congregational #1"]] };
          }
          return { totalUpdatedCells: 1 };
        }
      }
    ),
    { code: "google_sheet_song_plan_verification_failed" }
  );
});

test("congregational writer requires a source row before backing up", async () => {
  await assert.rejects(
    () => writeServiceCongregationalPlanToGoogleSheet(
      { service: { serviceId: "service-1" }, changes: [{ sourceColumnName: "Congregational #1" }] },
      { googleSheetsRequest: async () => ({}), createGoogleSheetBackup: async () => ({}) }
    ),
    { code: "service_sheet_row_not_found" }
  );
});
