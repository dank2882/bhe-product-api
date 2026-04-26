#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

import previewTools from "../lib/music-planning-import-preview.js";

const {
  DEFAULT_PLANNING_YEAR,
  DEFAULT_SOURCE_SHEET_NAME,
  buildPlanningPreviewFromWorksheetRows,
  hashFile,
  readXlsxWorksheet,
  worksheetFromCsvText
} = previewTools;

const DEFAULT_WORKBOOK_PATH = "/Users/danielkirchner/Downloads/Music Ministry - Master Data.xlsx";
const DEFAULT_OUTPUT_PATH = "tmp/music-planning-import-preview.json";

function parseArgs(argv) {
  const options = {
    workbook: DEFAULT_WORKBOOK_PATH,
    googleSheetId: "",
    sheet: DEFAULT_SOURCE_SHEET_NAME,
    year: DEFAULT_PLANNING_YEAR,
    out: DEFAULT_OUTPUT_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--workbook" && next) {
      options.workbook = next;
      index += 1;
      continue;
    }

    if (arg === "--google-sheet-id" && next) {
      options.googleSheetId = next;
      index += 1;
      continue;
    }

    if (arg === "--sheet" && next) {
      options.sheet = next;
      index += 1;
      continue;
    }

    if (arg === "--year" && next) {
      options.year = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === "--out" && next) {
      options.out = next;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!Number.isInteger(options.year) || options.year < 2000 || options.year > 2100) {
    throw new Error("--year must be a four-digit planning year.");
  }

  return options;
}

function printHelp() {
  console.log("Usage: node scripts/preview-music-planning-import.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --workbook <path>  XLSX workbook path. Default: ${DEFAULT_WORKBOOK_PATH}`);
  console.log("  --google-sheet-id <id>  Read a shared Google Sheet CSV export instead of a local workbook.");
  console.log(`  --sheet <name>     Sheet name. Default: ${DEFAULT_SOURCE_SHEET_NAME}`);
  console.log(`  --year <year>      Planning year. Default: ${DEFAULT_PLANNING_YEAR}`);
  console.log(`  --out <path>       Preview JSON output path. Default: ${DEFAULT_OUTPUT_PATH}`);
}

function printSummary(preview, outputPath) {
  const {
    sourceImportPreview,
    importableServices,
    skippedServiceShells,
    serviceSongEvents,
    warnings,
    summary
  } = preview;

  console.log("Music planning import preview");
  console.log(`Source: ${sourceImportPreview.sourceWorkbookName}`);
  console.log(`Sheet: ${sourceImportPreview.sourceSheetName}`);
  console.log(`Planning year: ${sourceImportPreview.planningYear}`);
  console.log(`Rows inspected: ${sourceImportPreview.rowCountInspected}`);
  console.log(`Service rows detected: ${sourceImportPreview.serviceRowsDetected}`);
  console.log(`Importable services: ${sourceImportPreview.importableServicesDetected}`);
  console.log(`Skipped service shells: ${sourceImportPreview.skippedServiceShellsDetected}`);
  console.log(`Planned music slots detected: ${sourceImportPreview.songMusicSlotsDetected}`);
  console.log(`Importable services without music slots: ${sourceImportPreview.importableServicesWithoutMusicSlots}`);
  console.log(`Warnings: ${sourceImportPreview.warningsCount}`);
  console.log(`Warnings by severity: ${JSON.stringify(summary.warningsBySeverity)}`);
  console.log(`Preview JSON: ${outputPath}`);

  console.log("");
  console.log("First importable services:");
  for (const service of importableServices.slice(0, 8)) {
    console.log(
      `- ${service.previewServiceId} | ${service.serviceDate || "unknown-date"} | ${service.serviceType} | ` +
        `${service.title} | row ${service.sourceRowNumber} | slots ${
          serviceSongEvents.filter((event) => event.previewServiceId === service.previewServiceId).length
        }`
    );
  }

  if (skippedServiceShells.length > 0) {
    console.log("");
    console.log("First skipped service shells:");
    for (const service of skippedServiceShells.slice(0, 8)) {
      console.log(
        `- ${service.previewServiceId} | ${service.serviceDate || "unknown-date"} | ${service.serviceType} | ` +
          `${service.title} | row ${service.sourceRowNumber} | ${service.skipReason}`
      );
    }
  }

  console.log("");
  console.log("First planned music slots:");
  for (const event of serviceSongEvents.slice(0, 12)) {
    const hymn = event.hymnalNumber ? ` #${event.hymnalNumber}` : "";
    const title = event.songTitleCandidate || event.rawValue || event.songTitleRaw || "(no title candidate)";
    console.log(
      `- ${event.previewServiceSongEventId} | ${event.usageRole} | ${title}${hymn} | ` +
        `${event.sourceCell}`
    );
  }

  if (warnings.length > 0) {
    console.log("");
    console.log("First warnings:");
    for (const warning of warnings.slice(0, 12)) {
      const where = warning.sourceCell || (warning.sourceRowNumber ? `row ${warning.sourceRowNumber}` : "workbook");
      console.log(`- ${warning.severity}:${warning.code} at ${where}: ${warning.message}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const workbookPath = path.resolve(options.workbook);
  const outputPath = path.resolve(options.out);
  const isGoogleSheet = Boolean(options.googleSheetId);
  const workbookName = isGoogleSheet ? "Music Ministry - Master Data" : path.basename(workbookPath, path.extname(workbookPath));
  const workbookFileName = isGoogleSheet ? `Google Sheet ${options.googleSheetId}` : path.basename(workbookPath);
  let worksheet;
  let sourceType = "spreadsheet_export";
  let sourceFileHash = "";

  if (isGoogleSheet) {
    const sheetParam = encodeURIComponent(options.sheet);
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(options.googleSheetId)}/gviz/tq?tqx=out:csv&sheet=${sheetParam}`;
    const response = await fetch(url, { redirect: "follow" });
    const csvText = await response.text();

    if (!response.ok) {
      throw new Error(`Google Sheet CSV export failed: ${response.status}`);
    }

    worksheet = worksheetFromCsvText({
      csvText,
      sheetName: options.sheet,
      workbookPath: url,
      sheetNames: [options.sheet]
    });
    sourceType = "google_sheet_export";
    sourceFileHash = createHash("sha256").update(csvText).digest("hex");
  } else {
    worksheet = readXlsxWorksheet({
      workbookPath,
      sheetName: options.sheet
    });
    sourceFileHash = hashFile(workbookPath);
  }

  const preview = buildPlanningPreviewFromWorksheetRows({
    worksheet,
    planningYear: options.year,
    sourceName: workbookName,
    sourceType,
    sourceWorkbookName: workbookFileName,
    sourceFileHash
  });

  if (isGoogleSheet) {
    preview.sourceImportPreview.sourceSpreadsheetId = options.googleSheetId;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(preview, null, 2)}\n`);
  printSummary(preview, outputPath);
}

main().catch((error) => {
  console.error(`Preview failed: ${error.message}`);
  process.exitCode = 1;
});
