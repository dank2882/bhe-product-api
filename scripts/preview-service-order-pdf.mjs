#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import previewTools from "../lib/service-order-pdf-preview.js";

const {
  buildServiceOrderPreviewFromPdf
} = previewTools;

const DEFAULT_PDF_PATH = "/Users/danielkirchner/Downloads/morning-service-2026-05-10-da39a....pdf";
const DEFAULT_OUTPUT_PATH = "tmp/service-order-pdf-preview.json";

function parseArgs(argv) {
  const options = {
    pdf: DEFAULT_PDF_PATH,
    out: DEFAULT_OUTPUT_PATH,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--pdf" && next) {
      options.pdf = next;
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

  return options;
}

function printHelp() {
  console.log("Usage: node scripts/preview-service-order-pdf.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --pdf <path>  Order-of-service PDF path. Default: ${DEFAULT_PDF_PATH}`);
  console.log(`  --out <path>  Preview JSON output path. Default: ${DEFAULT_OUTPUT_PATH}`);
  console.log("  --help, -h    Show this help.");
  console.log("");
  console.log("This command never writes to Firestore.");
}

function printSummary(preview, outputPath) {
  console.log("Service order PDF preview");
  console.log(`Source: ${preview.sourceImportPreview.sourceFileName}`);
  console.log(`Service: ${preview.service.serviceDate} | ${preview.service.serviceType} | ${preview.service.title}`);
  console.log(`Service ID: ${preview.service.serviceId}`);
  console.log(`Order items: ${preview.sourceImportPreview.orderItemsDetected}`);
  console.log(`Music events: ${preview.sourceImportPreview.serviceSongEventsDetected}`);
  console.log(`Detected moments: ${preview.sourceImportPreview.serviceMomentsDetected}`);
  console.log(`Warnings: ${preview.sourceImportPreview.warningsCount}`);
  console.log(`Preview JSON: ${outputPath}`);

  console.log("");
  console.log("First order items:");
  for (const item of preview.serviceOrderItems.slice(0, 12)) {
    const hymn = item.hymnalNumber ? ` #${item.hymnalNumber}` : "";
    const key = item.key ? ` key ${item.key}` : "";
    console.log(
      `- ${item.sequence} | ${item.startTime || "no time"} | ${item.itemType} | ` +
        `${item.sectionTitle} -> ${item.title}${hymn}${key}`
    );
  }

  if (preview.serviceMoments.length > 0) {
    console.log("");
    console.log("Detected moments for review:");
    for (const moment of preview.serviceMoments.slice(0, 8)) {
      console.log(`- ${moment.sequence} | ${moment.momentType} | ${moment.title}`);
    }
  }

  if (preview.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of preview.warnings) {
      console.log(`- ${warning.severity}:${warning.code}: ${warning.message}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const pdfPath = path.resolve(options.pdf);
  const outputPath = path.resolve(options.out);
  const preview = buildServiceOrderPreviewFromPdf({ pdfPath });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(preview, null, 2)}\n`);
  printSummary(preview, outputPath);
}

main().catch((error) => {
  console.error(`Preview failed: ${error.message}`);
  process.exitCode = 1;
});
