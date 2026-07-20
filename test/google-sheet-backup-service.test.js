"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildBackupTitle,
  createGoogleSheetBackup,
  listGoogleSheetBackups,
  parseBoundedA1Range,
  readGoogleSheetRange,
  restoreGoogleSheetBackup,
  restoreGoogleSheetRange
} = require("../lib/google-sheet-backup-service");

const SHEETS = {
  sheets: [
    { properties: { sheetId: 10, title: "PROPOSED SCHEDULES", index: 0, gridProperties: { rowCount: 200, columnCount: 30 } } },
    { properties: { sheetId: 20, title: "_BACKUP_PROPOSED_SCHEDULES_20260714T120000000Z", index: 1, hidden: true, gridProperties: { rowCount: 180, columnCount: 28 } } }
  ]
};

test("backup titles include milliseconds so rapid writes remain distinct", () => {
  assert.equal(
    buildBackupTitle("PROPOSED SCHEDULES", new Date("2026-07-15T12:34:56.789Z"), "before write"),
    "_BACKUP_PROPOSED_SCHEDULES_20260715T123456789Z_before_write"
  );
});

test("creating a backup copies, renames, and hides the full planning tab", async () => {
  const requests = [];
  const result = await createGoogleSheetBackup(
    { serviceId: "service-1", reason: "before_service_assignment_write" },
    {
      now: () => new Date("2026-07-15T12:34:56.789Z"),
      googleSheetsRequest: async (request) => {
        requests.push(request);
        if (request.method === "GET") return SHEETS;
        if (request.path.endsWith(":copyTo")) return { sheetId: 30 };
        return {};
      }
    }
  );

  assert.equal(result.backupSheetId, 30);
  assert.equal(result.hidden, true);
  assert.equal(requests[1].data.destinationSpreadsheetId, result.googleSheetId);
  assert.equal(requests[2].data.requests[0].updateSheetProperties.properties.hidden, true);
});

test("listing backups excludes the active planning tab", async () => {
  const result = await listGoogleSheetBackups(
    {},
    { googleSheetsRequest: async () => SHEETS }
  );

  assert.equal(result.count, 1);
  assert.equal(result.backups[0].backupSheetId, 20);
});

test("direct range reads bypass spreadsheet export caching", async () => {
  const result = await readGoogleSheetRange(
    { range: "A130:F135" },
    { googleSheetsRequest: async () => ({ range: "'PROPOSED SCHEDULES'!A130:F135", values: [["2026"]] }) }
  );

  assert.equal(result.requestedRange, "A130:F135");
  assert.deepEqual(result.values, [["2026"]]);
});

test("bounded A1 ranges convert to zero-based Sheets API grid indexes", () => {
  assert.deepEqual(parseBoundedA1Range("D31:F31"), {
    range: "D31:F31",
    startColumnIndex: 3,
    startRowIndex: 30,
    endColumnIndex: 6,
    endRowIndex: 31
  });
});

test("restoring a backup requires confirmed true", async () => {
  await assert.rejects(
    () => restoreGoogleSheetBackup(
      { backupSheetId: 20 },
      { googleSheetsRequest: async () => SHEETS }
    ),
    { code: "spreadsheet_restore_confirmation_required" }
  );
});

test("restoring copies the selected backup after creating a safety backup", async () => {
  const requests = [];
  const result = await restoreGoogleSheetBackup(
    { backupSheetId: 20, confirmed: true },
    {
      now: () => new Date("2026-07-15T13:00:00.000Z"),
      googleSheetsRequest: async (request) => {
        requests.push(request);
        if (request.method === "GET") return SHEETS;
        if (request.path.endsWith(":copyTo")) return { sheetId: 31 };
        return {};
      }
    }
  );

  assert.equal(result.restoredFrom.backupSheetId, 20);
  assert.equal(result.safetyBackup.backupSheetId, 31);
  const restoreRequest = requests.at(-1).data.requests.at(-1).copyPaste;
  assert.equal(restoreRequest.source.sheetId, 20);
  assert.equal(restoreRequest.destination.sheetId, 10);
});

test("restoring a range makes a safety backup and verifies exact copied values", async () => {
  const requests = [];
  const result = await restoreGoogleSheetRange(
    { backupSheetId: 20, range: "D31:F31", confirmed: true },
    {
      now: () => new Date("2026-07-15T13:10:00.000Z"),
      googleSheetsRequest: async (request) => {
        requests.push(request);
        if (request.method === "GET" && request.path.includes("/values/")) {
          return { values: [["Take my Life and Let it be"]] };
        }
        if (request.method === "GET") return SHEETS;
        if (request.path.endsWith(":copyTo")) return { sheetId: 32 };
        return {};
      }
    }
  );

  assert.equal(result.restored, true);
  assert.equal(result.verified, true);
  assert.deepEqual(result.values, [["Take my Life and Let it be"]]);
  assert.equal(result.safetyBackup.backupSheetId, 32);
  const copyPaste = requests.find((request) => request.data?.requests?.[0]?.copyPaste)?.data.requests[0].copyPaste;
  assert.deepEqual(copyPaste.source, {
    sheetId: 20,
    startRowIndex: 30,
    endRowIndex: 31,
    startColumnIndex: 3,
    endColumnIndex: 6
  });
  assert.equal(copyPaste.destination.sheetId, 10);
});
