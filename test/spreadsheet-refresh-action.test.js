const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.BHE_API_KEY ||= "test-api-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.GCP_PROJECT_ID ||= "test-project";
process.env.FIRESTORE_DATABASE_ID ||= "test-db";

const {
  buildSpreadsheetRefreshArgs,
  buildSpreadsheetRefreshResponse,
  normalizeSpreadsheetRefreshRequest
} = require("../index");

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss/edit?usp=sharing";

test("normalizeSpreadsheetRefreshRequest defaults to a safe plan-only refresh", () => {
  const request = normalizeSpreadsheetRefreshRequest({
    googleSheetUrl: SHEET_URL,
    mode: "plan",
    planningYear: 2026
  });

  assert.equal(request.mode, "plan-only");
  assert.equal(request.googleSheetId, "1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss");
  assert.equal(request.sheet, "PROPOSED SCHEDULES");
  assert.equal(request.planningYear, 2026);
  assert.equal(request.humanConfirmed, false);
  assert.equal(request.allowPlannedUpdates, false);
  assert.equal(request.allowPartialConflicts, false);
});

test("normalizeSpreadsheetRefreshRequest rejects commit without human confirmation", () => {
  assert.throws(
    () => normalizeSpreadsheetRefreshRequest({ mode: "commit" }),
    /explicit human confirmation/
  );
});

test("buildSpreadsheetRefreshArgs passes commit confirmation through to the CLI", () => {
  const args = buildSpreadsheetRefreshArgs(
    normalizeSpreadsheetRefreshRequest({
      mode: "commit",
      humanConfirmed: true,
      allowPlannedUpdates: true,
      allowPartialConflicts: true,
      confirmSourceImportId: "srcimp-example",
      planningYear: 2026
    }),
    "/tmp/refresh-out"
  );

  assert.ok(args.includes("--commit"));
  assert.ok(args.includes("--allow-planned-updates"));
  assert.ok(args.includes("--allow-partial-conflicts"));
  assert.deepEqual(
    args.slice(args.indexOf("--confirm-source-import-id"), args.indexOf("--confirm-source-import-id") + 2),
    ["--confirm-source-import-id", "srcimp-example"]
  );
  assert.deepEqual(
    args.slice(args.indexOf("--database"), args.indexOf("--database") + 2),
    ["--database", "test-db"]
  );
});

test("buildSpreadsheetRefreshResponse returns focused date plan details", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "spreadsheet-refresh-test-"));
  const sourceImportId = "srcimp-example";

  fs.writeFileSync(
    path.join(outDir, "music-planning-refresh-summary-latest.json"),
    JSON.stringify({
      plan: {
        serviceSongEvents: { create: 1 }
      }
    })
  );
  fs.writeFileSync(
    path.join(outDir, "music-planning-firestore-write-plan-latest.json"),
    JSON.stringify({
      sourceImportPlan: { id: sourceImportId },
      eligibleForCommit: false,
      conflicts: [],
      services: {
        create: [
          {
            action: "create",
            id: "svc-plan-2026-06-07-sunday-morning",
            reason: "record_missing",
            proposed: {
              serviceId: "svc-plan-2026-06-07-sunday-morning",
              serviceDate: "2026-06-07",
              serviceType: "sunday_morning",
              title: "Morning Service",
              theme: "Pastor's Favorites"
            }
          }
        ]
      },
      serviceSongEvents: {
        create: [
          {
            action: "create",
            id: "sse-plan-svc-plan-2026-06-07-sunday-morning-10-congregational-1",
            reason: "record_missing",
            proposed: {
              serviceSongEventId: "sse-plan-svc-plan-2026-06-07-sunday-morning-10-congregational-1",
              serviceId: "svc-plan-2026-06-07-sunday-morning",
              serviceDate: "2026-06-07",
              serviceType: "sunday_morning",
              slotIndex: 10,
              usageRole: "congregational",
              sourceColumnName: "Congregational #1",
              sourceCell: "D20",
              rawValue: "525 - All that Thrills my Soul is Jesus",
              title: "525 - All that Thrills my Soul is Jesus",
              songTitle: "525 - All that Thrills my Soul is Jesus",
              warningCodes: []
            }
          },
          {
            action: "create",
            id: "sse-plan-svc-plan-2026-06-07-sunday-evening-10-congregational-1",
            proposed: {
              serviceSongEventId: "sse-plan-svc-plan-2026-06-07-sunday-evening-10-congregational-1",
              serviceId: "svc-plan-2026-06-07-sunday-evening",
              serviceDate: "2026-06-07",
              serviceType: "sunday_evening",
              usageRole: "congregational",
              rawValue: "602 - When We All Get to Heaven"
            }
          }
        ]
      }
    })
  );

  const result = buildSpreadsheetRefreshResponse({
    options: {
      mode: "plan-only",
      googleSheetId: "sheet-id",
      sheet: "PROPOSED SCHEDULES",
      planningYear: 2026,
      focusDate: "2026-06-07",
      focusServiceType: "sunday_morning"
    },
    outDir
  });

  assert.equal(result.sourceImportId, sourceImportId);
  assert.equal(result.focus.serviceDate, "2026-06-07");
  assert.equal(result.focus.serviceType, "sunday_morning");
  assert.equal(result.focus.services.create.length, 1);
  assert.equal(result.focus.serviceSongEvents.create.length, 1);
  assert.equal(
    result.focus.serviceSongEvents.create[0].rawValue,
    "525 - All that Thrills my Soul is Jesus"
  );
});
