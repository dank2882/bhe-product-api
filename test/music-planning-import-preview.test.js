const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPlanningPreviewFromWorksheetRows,
  MUSIC_SLOT_DEFINITIONS,
  parseDateService,
  parseMusicSlotValue
} = require("../lib/music-planning-import-preview");

function cell(rowNumber, columnIndex, value) {
  const columnName = String.fromCharCode(64 + columnIndex);
  return {
    value,
    sourceCell: `${columnName}${rowNumber}`,
    columnIndex,
    columnName
  };
}

test("parseDateService derives Sunday morning services from AM rows", () => {
  const result = parseDateService("April 12th AM", {
    currentMonthNumber: 4,
    planningYear: 2026
  });

  assert.equal(result.serviceDate, "2026-04-12");
  assert.equal(result.serviceType, "sunday_morning");
  assert.equal(result.title, "Morning Service");
  assert.deepEqual(result.serviceLabels, ["AM"]);
  assert.deepEqual(result.warnings, []);
});

test("parseDateService derives prayer services from parenthetical labels", () => {
  const result = parseDateService("March 4th (Prayer Service)", {
    currentMonthNumber: 3,
    planningYear: 2026
  });

  assert.equal(result.serviceDate, "2026-03-04");
  assert.equal(result.serviceType, "prayer_service");
  assert.equal(result.title, "Prayer Service");
  assert.deepEqual(result.serviceLabels, ["Prayer Service"]);
});

test("parseMusicSlotValue parses leading hymn numbers conservatively", () => {
  const result = parseMusicSlotValue("#381 Blessed Assurance", {
    usageRole: "congregational",
    titleConfidence: "high"
  });

  assert.equal(result.hymnalNumber, 381);
  assert.equal(result.songTitle, "Blessed Assurance");
  assert.equal(result.songTitleCandidate, "Blessed Assurance");
  assert.equal(result.titleConfidence, "high");
  assert.equal(result.songTitleConfidence, "high");
  assert.deepEqual(result.warnings, []);
});

test("parseMusicSlotValue preserves performer-only special music as assignment, not title", () => {
  const result = parseMusicSlotValue("Gabe & Abby D", {
    usageRole: "special_music",
    titleConfidence: "low"
  });

  assert.equal(result.rawValue, "Gabe & Abby D");
  assert.equal(result.assignedPersonOrGroupRaw, "Gabe & Abby D");
  assert.equal(result.songTitleCandidate, "");
  assert.equal(result.songTitle, "");
  assert.equal(result.detailNote, "");
  assert.equal(result.songTitleConfidence, "low");
  assert.deepEqual(result.warnings.map((warning) => warning.code), ["special_music_assignment_only"]);
  assert.deepEqual(result.warnings.map((warning) => warning.severity), ["review"]);
});

test("parseMusicSlotValue splits performer plus song-title parenthetical", () => {
  const result = parseMusicSlotValue("Faith Trio (Lord Here's My Life)", {
    usageRole: "special_music",
    titleConfidence: "low"
  });

  assert.equal(result.assignedPersonOrGroupRaw, "Faith Trio");
  assert.equal(result.songTitleCandidate, "Lord Here's My Life");
  assert.equal(result.songTitle, "Lord Here's My Life");
  assert.equal(result.songTitleConfidence, "medium");
  assert.equal(result.detailNote, "");
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, "ambiguous_special_music_cell");
  assert.equal(result.warnings[0].severity, "review");
});

test("parseMusicSlotValue treats grade-band parentheticals as detail notes", () => {
  const result = parseMusicSlotValue("FBCA Elementary (K-2)", {
    usageRole: "special_music",
    titleConfidence: "low"
  });

  assert.equal(result.assignedPersonOrGroupRaw, "FBCA Elementary");
  assert.equal(result.songTitleCandidate, "");
  assert.equal(result.songTitle, "");
  assert.equal(result.detailNote, "K-2");
  assert.equal(result.songTitleConfidence, "low");
  assert.equal(result.warnings[0].code, "special_music_detail_note_only");
  assert.equal(result.warnings[0].severity, "review");
});

test("parseMusicSlotValue keeps choir opener title-first while preserving raw value fields", () => {
  const choirOpener = MUSIC_SLOT_DEFINITIONS.find((slot) => slot.key === "choir_opener");
  const result = parseMusicSlotValue("Honored, Glorified, Exalted", choirOpener);

  assert.equal(result.rawValue, "Honored, Glorified, Exalted");
  assert.equal(result.songTitleCandidate, "Honored, Glorified, Exalted");
  assert.equal(result.assignedPersonOrGroupRaw, "");
  assert.equal(result.detailNote, "");
  assert.equal(result.songTitleConfidence, "high");
  assert.deepEqual(result.warnings, []);
});

test("parseMusicSlotValue treats choir opener parenthetical as assignment detail, not title", () => {
  const choirOpener = MUSIC_SLOT_DEFINITIONS.find((slot) => slot.key === "choir_opener");
  const result = parseMusicSlotValue("Lift Him Up (Schuyler)", choirOpener);

  assert.equal(result.rawValue, "Lift Him Up (Schuyler)");
  assert.equal(result.songTitleCandidate, "Lift Him Up");
  assert.equal(result.songTitle, "Lift Him Up");
  assert.equal(result.assignedPersonOrGroupRaw, "Schuyler");
  assert.equal(result.detailNote, "");
  assert.equal(result.songTitleConfidence, "high");
  assert.deepEqual(result.warnings, []);
});

test("buildPlanningPreviewFromWorksheetRows separates importable services from skipped shells", () => {
  const worksheet = {
    sheetName: "PROPOSED SCHEDULES",
    maxRow: 4,
    rows: [
      {
        rowNumber: 1,
        cells: {
          2: cell(1, 2, "April")
        }
      },
      {
        rowNumber: 2,
        cells: {
          1: cell(2, 1, "THEME"),
          2: cell(2, 2, "Date/Service"),
          3: cell(2, 3, "Congregational #1")
        }
      },
      {
        rowNumber: 3,
        cells: {
          2: cell(3, 2, "April 5th AM")
        }
      },
      {
        rowNumber: 4,
        cells: {
          1: cell(4, 1, "Assurance"),
          2: cell(4, 2, "April 12th AM")
        }
      }
    ]
  };

  const preview = buildPlanningPreviewFromWorksheetRows({
    worksheet,
    planningYear: 2026,
    sourceName: "Music Ministry - Master Data"
  });

  assert.equal(preview.importableServices.length, 1);
  assert.equal(preview.skippedServiceShells.length, 1);
  assert.equal(preview.importableServices[0].planningSignals.includes("theme"), true);
  assert.equal(preview.skippedServiceShells[0].skipReason, "date_service_only_no_planning_signal");
  assert.equal(preview.summary.serviceRowsDetected, 2);
  assert.equal(preview.summary.importableServicesDetected, 1);
  assert.equal(preview.summary.skippedServiceShellsDetected, 1);
});

test("buildPlanningPreviewFromWorksheetRows creates planned services and music slots with provenance", () => {
  const worksheet = {
    sheetName: "PROPOSED SCHEDULES",
    maxRow: 4,
    rows: [
      {
        rowNumber: 1,
        cells: {
          2: cell(1, 2, "April")
        }
      },
      {
        rowNumber: 2,
        cells: {
          1: cell(2, 1, "THEME"),
          2: cell(2, 2, "Date/Service"),
          3: cell(2, 3, "Congregational #1"),
          4: cell(2, 4, "Choir Special"),
          5: cell(2, 5, "Special #1")
        }
      },
      {
        rowNumber: 3,
        cells: {
          1: cell(3, 1, "Assurance"),
          2: cell(3, 2, "April 12th AM"),
          3: cell(3, 3, "#381 Blessed Assurance"),
          4: cell(3, 4, "I Stand Redeemed"),
          5: cell(3, 5, "Faith Trio (Lord Here's My Life)")
        }
      }
    ]
  };

  const preview = buildPlanningPreviewFromWorksheetRows({
    worksheet,
    planningYear: 2026,
    sourceName: "Music Ministry - Master Data",
    sourceWorkbookName: "Music Ministry - Master Data.xlsx",
    sourceFileHash: "abc123"
  });

  assert.equal(preview.sourceImportPreview.importMode, "preview");
  assert.equal(preview.sourceImportPreview.planningStatusDefault, "planned");
  assert.equal(preview.importableServices.length, 1);
  assert.equal(preview.skippedServiceShells.length, 0);
  assert.equal(preview.serviceSongEvents.length, 3);
  assert.equal(preview.importableServices[0].serviceDate, "2026-04-12");
  assert.equal(preview.importableServices[0].theme, "Assurance");
  assert.equal(preview.importableServices[0].sourceCell, "B3");
  assert.deepEqual(preview.importableServices[0].planningSignals, ["planned_music_slot", "theme"]);

  const congregational = preview.serviceSongEvents[0];
  assert.equal(congregational.rawValue, "#381 Blessed Assurance");
  assert.equal(congregational.songTitleCandidate, "Blessed Assurance");
  assert.equal(congregational.songTitle, "Blessed Assurance");
  assert.equal(congregational.hymnalNumber, 381);
  assert.equal(congregational.sourceCell, "C3");
  assert.equal(congregational.planningStatus, "planned");
  assert.equal(congregational.actualStatus, "unknown");

  const special = preview.serviceSongEvents[2];
  assert.equal(special.assignedPersonOrGroupRaw, "Faith Trio");
  assert.equal(special.songTitleCandidate, "Lord Here's My Life");
  assert.equal(special.songTitleConfidence, "medium");
  assert.ok(preview.warnings.some((warning) =>
    warning.code === "ambiguous_special_music_cell" && warning.severity === "review"
  ));
});

test("buildPlanningPreviewFromWorksheetRows classifies warning severities", () => {
  const worksheet = {
    sheetName: "PROPOSED SCHEDULES",
    maxRow: 4,
    rows: [
      {
        rowNumber: 1,
        cells: {
          2: cell(1, 2, "April")
        }
      },
      {
        rowNumber: 2,
        cells: {
          2: cell(2, 2, "Date/Service"),
          3: cell(2, 3, "Special #1")
        }
      },
      {
        rowNumber: 3,
        cells: {
          2: cell(3, 2, "April 5th AM")
        }
      },
      {
        rowNumber: 4,
        cells: {
          2: cell(4, 2, "Bad Date AM"),
          3: cell(4, 3, "Faith Trio")
        }
      }
    ]
  };

  const preview = buildPlanningPreviewFromWorksheetRows({
    worksheet,
    planningYear: 2026,
    sourceName: "Music Ministry - Master Data"
  });

  assert.equal(preview.summary.warningsBySeverity.info, 1);
  assert.equal(preview.summary.warningsBySeverity.review, 1);
  assert.equal(preview.summary.warningsBySeverity.error, 1);
  assert.ok(preview.warnings.some((warning) => warning.code === "skipped_service_shells"));
  assert.ok(preview.warnings.some((warning) => warning.code === "special_music_assignment_only"));
  assert.ok(preview.warnings.some((warning) => warning.code === "service_date_parse_warning"));
});
