# Slice 9 Spreadsheet Planning Import Preview

Date: 2026-04-25

Slice name: Spreadsheet Planning Import Preview

Status: Local read-only parser/dry-run

Slice 10 note: the initial Slice 9 output contract was refined in
`docs/slices/slice10-spreadsheet-import-contract-and-parser-adjustment.md`.
The Slice 10 preview separates `importableServices` from
`skippedServiceShells` and adds warning severities.

## Summary

Slice 9 adds a local preview command for the Music Ministry planning workbook.

Command:

```bash
node scripts/preview-music-planning-import.mjs
```

Default source:

* Workbook: `/Users/danielkirchner/Downloads/Music Ministry - Master Data.xlsx`
* Sheet: `PROPOSED SCHEDULES`
* Planning year: `2026`
* Output: `tmp/music-planning-import-preview.json`

The command reads the workbook, parses planned service rows and planned music slots, prints a console summary, and writes a generated preview JSON file under `tmp/`.

No Firestore writes are performed.

## Preview Run Result

The command was run against the provided workbook with default options.

Output file:

* `tmp/music-planning-import-preview.json`

Run summary:

* rows inspected: 203
* non-empty rows inspected: 181
* month rows skipped: 12
* header rows skipped: 12
* services detected: 157
* planned music slots detected: 135
* services without populated music slots: 118
* warnings: 33

The generated output path is ignored by Git via `tmp/`.

## What It Does

The preview command produces:

* `sourceImportPreview`: proposed import-run summary
* `services`: normalized planned service preview records
* `serviceSongEvents`: normalized planned music-slot preview records
* `warnings`: parser and ambiguity warnings

All records default to:

* `planningStatus: planned`
* `actualStatus: unknown` for planned music slots
* `changedAfterPlan: false`

The preview preserves provenance:

* source type
* source name
* source sheet name
* source row number
* source column name
* source cell
* workbook file hash

## What It Does Not Do

This slice does not:

* write to Firestore
* create or update `services`
* create or update `serviceSongEvents`
* create or update `sourceImports`
* update canonical songs or aliases
* match songs to canonical catalog records
* update GPT schema, builder instructions, or workflow files
* call Breeze
* call Google Sheets API
* deploy anything

## Workbook Assumptions

The parser is built around the workbook structure discovered in Slice 8:

* `PROPOSED SCHEDULES` is the primary source sheet.
* Month header rows contain a single month name.
* Header rows contain `Date/Service`.
* Service rows contain a date/service value below the active header row.
* Music slot columns are:
  * `Congregational #1`
  * `Congregational #2`
  * `Congregational #3`
  * `Choir Opener`
  * `Choir Special`
  * `Special #1`
  * `Special #2`
  * `Offertory`

The workbook has an implicit planning year. The preview defaults to `2026`; use `--year` to override it.

## Preview Output Structure

Example CLI options:

```bash
node scripts/preview-music-planning-import.mjs \
  --workbook "/Users/danielkirchner/Downloads/Music Ministry - Master Data.xlsx" \
  --sheet "PROPOSED SCHEDULES" \
  --year 2026 \
  --out tmp/music-planning-import-preview.json
```

The JSON output contains:

```json
{
  "sourceImportPreview": {},
  "services": [],
  "serviceSongEvents": [],
  "warnings": []
}
```

The generated `tmp/` directory is ignored by Git.

## Known Parsing Limitations

* The parser reads XLSX worksheet XML directly and expects the local `unzip` command to be available.
* The parser does not use Google Sheets live API access yet.
* Date/service parsing is conservative and depends on the configured planning year.
* Special/offertory cells often mix performer names and song titles.
* Special/offertory title extraction is marked with warnings and lower confidence.
* Blank future service rows are included as planned service previews, but they carry no planned music slots.
* No canonical song matching is attempted.
* Planned spreadsheet rows are not actual completed service history.

## Recommended Next Slice

Recommended next slice: Spreadsheet Planning Import Review and Commit Design.

Goals:

1. Review the generated preview JSON and warning patterns.
2. Decide whether blank future service rows should be imported.
3. Decide how to handle special/offertory performer-vs-title ambiguity.
4. Design the Firestore commit step for `services`, `serviceSongEvents`, and `sourceImports`.
5. Keep the commit step explicit and reviewable before any Firestore writes.
