#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { extractLogosSchedulerRecords } from "./lib/logos-sermon-scheduler.mjs";

function parseArgs(argv) {
  const options = {
    inFile: "",
    outFile: "tmp/logos-sermon-scheduler.current.extracted.jsonl"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--in") options.inFile = argv[++index] || "";
    else if (token === "--out") options.outFile = argv[++index] || "";
    else if (token === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/extract-logos-sermon-scheduler-file.mjs --in RAW_JSON [--out JSONL]");
    return;
  }
  if (!options.inFile) throw new Error("Missing --in <raw-json>.");

  const payload = JSON.parse(fs.readFileSync(options.inFile, "utf8"));
  const records = extractLogosSchedulerRecords(payload);
  fs.mkdirSync(path.dirname(options.outFile), { recursive: true });
  fs.writeFileSync(
    options.outFile,
    records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "")
  );
  console.log(JSON.stringify({
    rawRows: Array.isArray(payload.sermons) ? payload.sermons.length : 0,
    extractedSermons: records.length,
    extractedOccasions: records.reduce((total, record) => total + record.occasions.length, 0),
    outFile: options.outFile
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message
  }, null, 2));
  process.exitCode = 1;
}

