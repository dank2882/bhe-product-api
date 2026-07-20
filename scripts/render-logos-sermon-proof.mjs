#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {
    input: "",
    output: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if ((token === "--in" || token === "--input") && next) {
      args.input = next;
      index += 1;
    } else if ((token === "--out" || token === "--output") && next) {
      args.output = next;
      index += 1;
    }
  }

  if (!args.input) {
    throw new Error("Missing --in path");
  }

  if (!args.output) {
    const parsed = path.parse(args.input);
    args.output = path.join(parsed.dir, `${parsed.name}.full-proof.md`);
  }

  return args;
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatList(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "";
}

function formatOccasions(record) {
  if (!Array.isArray(record.occasions) || record.occasions.length === 0) {
    return [
      [record.preachedDate, record.venue, record.service].filter(Boolean).join(" - ")
    ].filter(Boolean);
  }

  return record.occasions
    .map((occasion) => [
      occasion.date || occasion.rawDate || "",
      occasion.venue || "",
      occasion.service || ""
    ].filter(Boolean).join(" - "))
    .filter(Boolean);
}

function renderProof(records, input) {
  const fence = "```";
  const chunks = [];

  chunks.push("# Logos Sermon Import Proof\n");
  chunks.push(`Source: ${input}`);
  chunks.push(`Records: ${records.length}`);
  chunks.push(`Generated: ${new Date().toISOString()}\n`);

  records.forEach((record, index) => {
    const occasions = formatOccasions(record);

    chunks.push("---\n");
    chunks.push(`## ${index + 1}. ${normalizeText(record.title) || "(untitled)"}\n`);
    chunks.push(`- Date: ${normalizeText(record.preachedDate) || "(blank)"}`);
    chunks.push(`- Speaker: ${normalizeText(record.speaker) || "(blank)"}`);
    chunks.push(`- Venue: ${normalizeText(record.venue) || "(blank)"}`);
    chunks.push(`- Service: ${normalizeText(record.service) || "(blank)"}`);
    chunks.push(`- Series: ${normalizeText(record.series) || "(blank)"}`);
    chunks.push(`- Series number: ${normalizeText(record.seriesNumber) || "(blank)"}`);
    chunks.push(`- Scripture/passages: ${normalizeText(record.scriptureText) || "(blank)"}`);
    chunks.push(`- Topics: ${formatList(record.topics) || "(blank)"}`);
    chunks.push(`- Tags: ${formatList(record.tags) || "(blank)"}`);
    chunks.push(`- URL: ${normalizeText(record.url) || "(blank)"}`);
    chunks.push(`- Manuscript characters: ${record.manuscriptText?.length || 0}`);

    if (occasions.length > 0) {
      chunks.push("- Preaching occasions:");
      occasions.forEach((occasion, occasionIndex) => {
        chunks.push(`  ${occasionIndex + 1}. ${occasion}`);
      });
    }

    chunks.push("\n### Manuscript\n");
    chunks.push(`${fence}text\n${normalizeText(record.manuscriptText).replace(/```/g, "\\`\\`\\`")}\n${fence}\n`);
  });

  return chunks.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = fs.readFileSync(args.input, "utf8")
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, renderProof(records, args.input));
  console.log(JSON.stringify({
    input: args.input,
    output: path.resolve(args.output),
    records: records.length
  }, null, 2));
}

main();
