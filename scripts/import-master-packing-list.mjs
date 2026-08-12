#!/usr/bin/env node

"use strict";

import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractParagraphs(xml) {
  return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((match) => ({
      xml: match[1],
      text: decodeXml(
        match[1]
        .replace(/<w:tab[^>]*\/>/g, " ")
        .replace(/<w:br[^>]*\/>/g, " ")
        .replace(/<[^>]+>/g, "")
      ).replace(/\s+/g, " ").trim()
    }))
    .filter(({ text }) => text)
    .map(({ xml: paragraphXml, text }) => ({
      text,
      outlineLevel: Number(paragraphXml.match(/<w:outlineLvl\b[^>]*w:val="(\d+)"/)?.[1] ?? NaN),
      listLevel: Number(paragraphXml.match(/<w:ilvl\b[^>]*w:val="(\d+)"/)?.[1] ?? NaN)
    }))
    .map((paragraph) => ({
      ...paragraph,
      outlineLevel: Number.isInteger(paragraph.outlineLevel) ? paragraph.outlineLevel : null,
      listLevel: Number.isInteger(paragraph.listLevel) ? paragraph.listLevel : null
    }));
}

function cleanHeading(value) {
  return value
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:$/, "");
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

async function main() {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) {
    throw new Error("Usage: node scripts/import-master-packing-list.mjs <source.docx> <output.json>");
  }
  const sourceBuffer = fs.readFileSync(sourcePath);
  const zip = await JSZip.loadAsync(sourceBuffer);
  const documentXml = await zip.file("word/document.xml").async("string");
  const paragraphs = extractParagraphs(documentXml);
  let section = "general";
  let subsection = "";
  let nestedGroup = "";
  const categories = [];
  const items = [];
  const rules = [];
  for (const paragraph of paragraphs.slice(1)) {
    const { text, outlineLevel, listLevel } = paragraph;
    if (outlineLevel !== null) {
      if (outlineLevel <= 1) {
        section = cleanHeading(text);
        subsection = "";
      } else {
        subsection = cleanHeading(text);
      }
      nestedGroup = "";
      continue;
    }
    if (listLevel === null) continue;
    if (cleanHeading(section).toLowerCase() === "system notes") {
      rules.push(text);
      continue;
    }
    if (listLevel === 0 && text.endsWith(":")) {
      nestedGroup = cleanHeading(text);
      continue;
    }
    if (listLevel === 0) nestedGroup = "";
    const category = [section, subsection, listLevel > 0 ? nestedGroup : ""]
      .map(cleanHeading)
      .filter(Boolean)
      .join(" / ");
    categories.push(category);
    items.push({
      packingItemId: `packing-item-${String(items.length + 1).padStart(3, "0")}-${slug(text)}`,
      label: text,
      category,
      quantity: 1,
      packed: false,
      notes: "",
      order: items.length + 1
    });
  }
  const output = {
    schemaVersion: 1,
    name: "Dan Master Travel Packing List",
    source: "docx_import",
    sourceReference: path.resolve(sourcePath),
    sourceChecksumSha256: createHash("sha256").update(sourceBuffer).digest("hex"),
    categories: [...new Set(categories)],
    rules,
    items
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath: path.resolve(outputPath), itemCount: items.length, categoryCount: output.categories.length })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
