#!/usr/bin/env node
"use strict";
// Source-preserving preview only. Deliberately has no cloud or write API client.
const fs = require("node:fs");
const crypto = require("node:crypto");
const { COLUMNS } = require("../lib/maintenance-fields");
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const cells = line => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(s => s.trim().replace(/\\\|/g, "|"));
function preview(sources) {
  const rows = [], exact = new Map();
  for (const source of sources) {
    const lines = source.text.split(/\r?\n/), headings = [];
    let table = false;
    for (let i = 0; i < lines.length; i++) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
      if (heading) { headings.length = heading[1].length - 1; headings.push(heading[2]); table = false; }
      if (!lines[i].trim().startsWith("|")) { if (lines[i].trim()) table = false; continue; }
      const values = cells(lines[i]);
      if (JSON.stringify(values) === JSON.stringify(COLUMNS)) { table = true; continue; }
      if (!table || values.every(v => /^:?-+:?$/.test(v))) continue;
      if (values.length !== COLUMNS.length) throw new Error(`Malformed maintenance table: ${source.name}:${i + 1}`);
      const sourceFields = Object.fromEntries(COLUMNS.map((c, j) => [c, values[j]]));
      const fingerprint = hash(JSON.stringify([headings, values]));
      const appearance = { source: source.name, line: i + 1, headings: [...headings], sourceFields };
      const existing = exact.get(fingerprint);
      if (existing) { existing.appearances.push(appearance); continue; }
      const row = { sourceRowId: `source-${fingerprint.slice(0, 24)}`, appearances: [appearance], sourceFields,
        proposedTaskId: `maintenance-import-${fingerprint.slice(0, 24)}`,
        reviewRequired: ["Confirm building and area", "Reconcile against final master and existing live work", "Resolve assignment as proposed or accepted", "Confirm dates, costs and status", "Locate actual photo files"],
        migrationStatus: "unreviewed", writesPerformed: false };
      rows.push(row); exact.set(fingerprint, row);
    }
  }
  return { columns: COLUMNS, sourceCount: sources.length, uniqueExactRows: rows.length, rowAppearances: rows.reduce((n, row) => n + row.appearances.length, 0), completeMaster: false, writesPerformed: false, note: "No fuzzy merging, assignment acceptance, building inference or placeholder-photo import. Vendor tables and non-table addenda require separate source reconciliation.", rows };
}
if (require.main === module) {
  const args = process.argv.slice(2), outputIndex = args.indexOf("--output");
  if (outputIndex < 1 || outputIndex !== args.length - 2) throw new Error("Usage: node scripts/preview-maintenance-import.cjs source.md [source2.md] --output preview.json");
  const paths = args.slice(0, outputIndex), output = args[outputIndex + 1];
  const result = preview(paths.map(name => ({ name, text: fs.readFileSync(name, "utf8") })));
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, uniqueExactRows: result.uniqueExactRows, rowAppearances: result.rowAppearances, writesPerformed: false, completeMaster: false }));
}
module.exports = { preview };
