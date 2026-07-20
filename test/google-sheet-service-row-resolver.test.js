"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveGoogleSheetServiceRow
} = require("../lib/google-sheet-service-row-resolver");

function makeRows() {
  const rows = Array.from({ length: 134 }, () => []);
  rows[0] = ["", "", "January"];
  rows[1] = ["Theme", "", "Date/Service"];
  rows[30] = ["", "", "February 25th (Prayer Service)"];
  rows[132] = ["", "", "August"];
  rows[133] = ["", "", "August 30th PM"];
  return rows;
}

test("resolves August 30 PM to live row 134 instead of stale stored row 31", () => {
  const result = resolveGoogleSheetServiceRow({
    rows: makeRows(),
    headerRowIndex: 1,
    headerColumnByName: new Map([["date service", 2]]),
    service: {
      serviceDate: "2026-08-30",
      serviceType: "sunday_evening",
      sourceRowNumber: 31
    }
  });

  assert.deepEqual(result, {
    sourceRowNumber: 134,
    matchedDateService: "August 30th PM",
    storedSourceRowNumber: 31,
    provenanceCorrected: true
  });
});

test("fails closed when the live date and service type are absent", () => {
  assert.throws(
    () => resolveGoogleSheetServiceRow({
      rows: makeRows(),
      headerRowIndex: 1,
      headerColumnByName: new Map([["date service", 2]]),
      service: { serviceDate: "2026-09-06", serviceType: "sunday_night", sourceRowNumber: 31 }
    }),
    { code: "service_sheet_live_row_not_found" }
  );
});
