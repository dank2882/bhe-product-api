# Slice 10 Spreadsheet Import Contract and Parser Adjustment

Date: 2026-04-25

Slice name: Spreadsheet Import Contract and Parser Adjustment

Status: Local read-only preview/import-contract update

## Summary

Slice 10 tightens the spreadsheet planning import preview before any Firestore write work.

The preview now separates service rows into:

* `importableServices`: service rows with at least one meaningful planning signal.
* `skippedServiceShells`: date/service-only rows that are visible in the planning sheet but should not be imported by default.

No Firestore writes are performed.

## Importable Service Policy

A service row is included in `importableServices` when it has at least one meaningful planning signal:

* at least one planned music slot
* a populated theme
* an explicit non-default service label, such as a special event label

Date/service-only rows are excluded from the default importable set and reported in `skippedServiceShells` with:

* `importable: false`
* `skipReason: date_service_only_no_planning_signal`
* row/cell provenance

This keeps blank future planning rows visible without treating them as Firestore-ready service records.

## Special Music Contract

Non-congregational music cells now preserve raw source data more carefully.

Each planned music slot includes:

* `rawValue`
* `songTitleCandidate`
* `songTitleConfidence`
* `assignedPersonOrGroupRaw`
* `detailNote`
* `sourceColumnName`
* `sourceCell`

Congregational rows remain song-title-first and continue extracting hymn numbers.

For assignment-first columns such as `Special #1`, `Special #2`, and `Offertory`:

* performer-only values become `assignedPersonOrGroupRaw`
* `songTitleCandidate` remains empty
* warning severity is `review`

For values like `Performer (Song Title)`:

* performer/group becomes `assignedPersonOrGroupRaw`
* parenthetical value becomes `songTitleCandidate`
* `songTitleConfidence` is `medium`
* warning severity is `review`

For grade-band or descriptive parentheticals like `K-2` and `3-6`:

* performer/group becomes `assignedPersonOrGroupRaw`
* parenthetical value becomes `detailNote`
* `songTitleCandidate` remains empty
* warning severity is `review`

Choir opener and choir special rows remain title-first when they contain plain song-like values, while still preserving the new raw/candidate/detail fields.

## Warning Severity

Warnings now include:

* `severity: info`
* `severity: review`
* `severity: error`

Current severity policy:

| Situation | Severity |
| --- | --- |
| Skipped date/service-only shell rows | `info` |
| Special music performer/title ambiguity | `review` |
| Service type ambiguity | `review` |
| Service date parse failure | `error` |

## Preview Output Contract

The preview JSON now contains:

```json
{
  "sourceImportPreview": {},
  "importableServices": [],
  "skippedServiceShells": [],
  "serviceSongEvents": [],
  "warnings": [],
  "summary": {}
}
```

`sourceImportPreview` keeps the import-run metadata.

`summary` adds count breakdowns for review:

* service rows detected
* importable services detected
* skipped service shells detected
* importable services with music slots
* importable services without music slots
* music slots by role and column
* warning counts by severity and code
* skipped shell reasons

## Preview Run Result

The preview command was rerun against the local workbook:

```bash
node scripts/preview-music-planning-import.mjs
```

Result:

| Item | Count |
| --- | ---: |
| Rows inspected | 203 |
| Service rows detected | 157 |
| Importable services | 55 |
| Skipped service shells | 102 |
| Importable services with music slots | 39 |
| Importable services without music slots | 16 |
| Planned music slots detected | 135 |
| Warnings | 34 |

Warnings by severity:

| Severity | Count |
| --- | ---: |
| `review` | 33 |
| `info` | 1 |

Warnings by code:

| Code | Count |
| --- | ---: |
| `special_music_assignment_only` | 20 |
| `ambiguous_special_music_cell` | 11 |
| `special_music_detail_note_only` | 2 |
| `skipped_service_shells` | 1 |

## What Changed From Slice 9

Slice 9 included all detected date/service rows as service previews. Slice 10 keeps those rows visible, but only the rows with meaningful planning signals are in the default importable service set.

Slice 9 used `songTitle` for ambiguous special music cells. Slice 10 separates performer/group text from song title candidates so future catalog matching does not accidentally treat a person or group name as a song title.

## What This Does Not Do

This slice does not:

* write to Firestore
* create or update `services`
* create or update `serviceSongEvents`
* create or update `sourceImports`
* match songs to the canonical catalog
* update song aliases or identity fields
* call Google Sheets API
* modify the source spreadsheet
* update GPT schema, builder instructions, or workflow files
* deploy anything

## Recommended Next Slice

Recommended next slice: Spreadsheet Planning Firestore Write Design.

The next slice should design the Firestore write contract without committing writes immediately. It should specify deterministic IDs, create/update behavior, idempotency, source provenance in `sourceImports`, and a final review gate before any real Firestore mutation.
