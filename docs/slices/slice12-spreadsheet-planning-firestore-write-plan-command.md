# Slice 12 Spreadsheet Planning Firestore Write Plan Command

Date: 2026-04-25

Slice name: Spreadsheet Planning Firestore Write Plan Command

Status: Read-only Firestore comparison command

## Summary

Slice 12 adds a read-only command that consumes the Slice 10 spreadsheet planning preview, reads existing Firestore state, and produces a proposed write plan.

The command does not write to Firestore. It has no commit mode.

## Command

Default usage:

```bash
node scripts/plan-music-planning-firestore-import.mjs
```

Default input:

* `tmp/music-planning-import-preview.json`

Default output:

* `tmp/music-planning-firestore-write-plan.json`

Options:

```bash
node scripts/plan-music-planning-firestore-import.mjs \
  --preview tmp/music-planning-import-preview.json \
  --out tmp/music-planning-firestore-write-plan.json
```

Additional safe test modes:

```bash
node scripts/plan-music-planning-firestore-import.mjs --mock-empty
node scripts/plan-music-planning-firestore-import.mjs --fixture path/to/existing-state.json
```

`--mock-empty` avoids Firestore reads and compares against an empty state.

`--fixture` avoids Firestore reads and compares against a local JSON fixture with optional `services`, `serviceSongEvents`, and `sourceImports` arrays.

## Firestore Reads

Default mode reads these collections:

* `services`
* `serviceSongEvents`
* `sourceImports`

The command performs collection `get()` reads only. It does not create missing collections, documents, or indexes.

## Deterministic IDs

Services use:

```text
svc-plan-{serviceDate}-{serviceTypeSlug}
```

Special events include title context:

```text
svc-plan-{serviceDate}-special-event-{titleSlug}
```

Service song events use:

```text
sse-plan-{serviceId}-{slotIndex}-{sourceColumnKey}
```

Source imports use:

```text
srcimp-{sourceTypeSlug}-{sourceNameSlug}-{sheetSlug}-{sourceVersionHash}-{importContractVersion}
```

Duplicate proposed deterministic IDs are blocking conflicts. The command does not silently disambiguate duplicates in this slice.

## Output Structure

The generated plan JSON contains:

```json
{
  "sourceImportPlan": {},
  "services": {
    "create": [],
    "update": [],
    "preserve": [],
    "conflict": [],
    "missingFromSource": []
  },
  "serviceSongEvents": {
    "create": [],
    "update": [],
    "preserve": [],
    "conflict": [],
    "missingFromSource": []
  },
  "summary": {},
  "warnings": [],
  "conflicts": [],
  "eligibleForCommit": true
}
```

`sourceImportPlan` previews the future `sourceImports` record.

`services` and `serviceSongEvents` group planned actions:

* `create`
* `update`
* `preserve`
* `conflict`
* `missingFromSource`

`eligibleForCommit` is `false` when blocking conflicts exist.

## Comparison Rules

### Create

If a proposed record does not exist in Firestore, the action is `create`.

### Update

If a proposed record exists and remains spreadsheet-owned/planned, the action is `update`.

Spreadsheet-owned/planned means:

* `sourceType` is `spreadsheet_export` or `google_sheet_export`, or `source` is `spreadsheet_import`
* `planningStatus` is `planned`
* `actualStatus` is `unknown`
* `changedAfterPlan` is not `true`

### Preserve

Manual or curated records are preserved rather than overwritten.

Preserve cases include:

* `manualOverride: true`
* non-empty `manualOverrideFields`
* non-import `lastEditedBy` or `updatedBy`
* existing curated song match fields such as `songId` on service song events

### Conflict

Blocking conflicts include:

* completed records
* confirmed records
* records changed after plan
* records that are not spreadsheet-owned/planned
* duplicate proposed deterministic IDs
* preview warnings with `severity: error`

### Missing From Source

If an existing spreadsheet-imported record is not present in the latest preview, the command reports `missingFromSource`.

It does not:

* delete the record
* cancel the record
* mark it stale
* mark it completed

## Safety Rules

The command:

* never writes to Firestore
* never deletes Firestore records
* never marks records completed
* never imports skipped service shells
* fails closed for error-level preview warnings
* blocks automatic update for completed, confirmed, changed, or manually curated records
* does not expose GPT actions
* does not update GPT schema, builder instructions, or workflow files
* does not deploy anything

## Local Run Result

The command was run in default Firestore-read mode:

```bash
node scripts/plan-music-planning-firestore-import.mjs
```

Result:

| Item | Count |
| --- | ---: |
| Service creates | 55 |
| Service updates | 0 |
| Service preserves | 0 |
| Service conflicts | 0 |
| Service missing from source | 0 |
| Service song event creates | 135 |
| Service song event updates | 0 |
| Service song event preserves | 0 |
| Service song event conflicts | 0 |
| Service song event missing from source | 0 |
| Warnings | 34 |
| Conflicts | 0 |

Warnings by severity:

| Severity | Count |
| --- | ---: |
| `review` | 33 |
| `info` | 1 |

The generated write-plan output is under ignored `tmp/`.

## What This Does Not Do

This slice does not:

* write to Firestore
* create a commit mode
* modify the spreadsheet
* call Google Sheets API
* update GPT artifacts
* expose GPT actions
* deploy anything

## Known Limitations

* The command reads entire collections up to a fixed per-collection limit.
* It does not yet perform field-level merge planning beyond listing changed import-owned fields.
* It does not create a human approval artifact separate from the JSON plan.
* It does not teach service-history reads to use `sourceImports`.
* It does not support committing a reviewed plan.

## Recommended Next Slice

Recommended next slice: Spreadsheet Planning Firestore Commit Command.

That slice should implement the reviewed commit behavior for applying an approved write plan safely. It should require explicit confirmation, preserve the same safety rules, and keep deletion/completion behavior out of the first commit implementation.
