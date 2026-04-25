# Slice 11 Spreadsheet Planning Firestore Write Design

Date: 2026-04-25

Slice name: Spreadsheet Planning Firestore Write Design

Status: Design only

## Summary

This slice designs the Firestore write contract for a future spreadsheet planning import. It does not implement writes.

The future writer should commit approved Slice 10 preview records into normalized internal collections while preserving source provenance, keeping spreadsheet data in a `planned` state, and avoiding destructive changes to confirmed or manually corrected history.

Recommended next implementation slice: Spreadsheet Planning Firestore Write Plan Command.

## Collections

### `services`

Stores normalized service occurrence records.

Spreadsheet-derived service records should represent planned service shells only when they are in `importableServices`. Date/service-only blank rows from `skippedServiceShells` should not be written by default.

Recommended spreadsheet fields:

* `serviceId`
* `serviceDate`
* `serviceType`
* `title`
* `theme`
* `serviceLabels`
* `planningStatus`
* `actualStatus`
* `changedAfterPlan`
* `source`
* `sourceType`
* `sourceName`
* `sourceWorkbookHash`
* `sourceSpreadsheetId`
* `sourceSheetName`
* `sourceRowNumber`
* `sourceCell`
* `sourceImportId`
* `sourceImportedAt`
* `sourcePreviewServiceId`
* `createdAt`
* `updatedAt`

### `serviceSongEvents`

Stores planned music-slot records linked to `services`.

Spreadsheet-derived records should preserve ambiguity from special/offertory-style cells. A row may have performer/group assignment data without a catalog-matchable song title candidate.

Recommended spreadsheet fields:

* `serviceSongEventId`
* `serviceId`
* `serviceDate`
* `serviceType`
* `slotIndex`
* `plannedSequence`
* `usageRole`
* `sourceColumnName`
* `sourceColumnKey`
* `sourceRowNumber`
* `sourceCell`
* `rawValue`
* `songTitleCandidate`
* `songTitleConfidence`
* `hymnalNumber`
* `assignedPersonOrGroupRaw`
* `detailNote`
* `songId`
* `planningStatus`
* `actualStatus`
* `changedAfterPlan`
* `source`
* `sourceType`
* `sourceName`
* `sourceWorkbookHash`
* `sourceSpreadsheetId`
* `sourceSheetName`
* `sourceImportId`
* `sourceImportedAt`
* `sourcePreviewServiceSongEventId`
* `createdAt`
* `updatedAt`

Keep `title` optional or derived from `songTitleCandidate` only when a future reader needs the existing service-history shape. Do not use performer-only values as song titles.

### `sourceImports`

Recommended generic collection for future import provenance.

`sourceImports` should be used for spreadsheet, Google Sheets, Breeze, and any future source. It gives us one place to record import-run metadata without tying new imports to Breeze-specific naming.

Recommended fields:

* `sourceImportId`
* `sourceType`
* `sourceName`
* `sourceWorkbookHash`
* `sourceSpreadsheetId`
* `sourceSheetName`
* `sourceVersion`
* `importContractVersion`
* `parserVersion`
* `mode`
* `status`
* `startedAt`
* `completedAt`
* `committedAt`
* `sourceImportedAt`
* `rowCounts`
* `warningCounts`
* `warningsSummary`
* `previewSummary`
* `createdBy`
* `notes`

### Relationship To `breezeImports`

Keep `breezeImports` for existing Breeze-specific normalized history and backward compatibility. Current service-history reads already understand `sourceImportId` with `breezeImports`.

For new spreadsheet imports, introduce `sourceImports` rather than extending `breezeImports`. A later compatibility slice can teach service-history reads to look up import context from both `sourceImports` and `breezeImports`, or migrate Breeze provenance into `sourceImports` if that becomes useful.

## Deterministic IDs

The write contract should support repeatable imports without duplicates.

### Normalization Helpers

Use stable slug/hash helpers:

* slug lowercases text, removes apostrophes/quotes, replaces non-alphanumeric runs with `-`, and trims dashes.
* short hash means the first 10-12 characters of a SHA-256 over a canonical JSON object.
* canonical JSON must sort object keys before hashing.

### Service IDs

Preferred service ID:

```text
svc-plan-{serviceDate}-{serviceTypeSlug}
```

Examples:

```text
svc-plan-2026-01-11-sunday-morning
svc-plan-2026-01-11-sunday-evening
svc-plan-2026-01-21-special-event-missions-conference
```

For special events, append a title or label slug:

```text
svc-plan-{serviceDate}-special-event-{titleSlug}
```

If a preview contains duplicate services with the same natural service ID, append a deterministic row suffix:

```text
svc-plan-{serviceDate}-{serviceTypeSlug}-r{sourceRowNumber}
```

Do not include workbook hash in the primary service ID. The same planned service should remain the same service when a newer spreadsheet export is imported. Keep source hash and row provenance as fields.

### Service Song Event IDs

Preferred event ID:

```text
sse-plan-{serviceId}-{slotIndex}-{sourceColumnKey}
```

Examples:

```text
sse-plan-svc-plan-2026-01-11-sunday-morning-10-congregational-1
sse-plan-svc-plan-2026-01-11-sunday-morning-60-special-1
```

If a single service can contain repeated same-column slots in future spreadsheet shapes, append a short hash of source cell plus raw value:

```text
sse-plan-{serviceId}-{slotIndex}-{sourceColumnKey}-{valueHash}
```

Do not use source row number as the primary identity for song events unless needed as a duplicate disambiguator. Row numbers are provenance, not stable identity.

### Source Import IDs

Use a deterministic snapshot/run ID:

```text
srcimp-{sourceTypeSlug}-{sourceNameSlug}-{sheetSlug}-{sourceVersionHash}-{importContractVersion}
```

For local spreadsheet exports, `sourceVersionHash` should be the workbook file hash already produced by the preview. For live Google Sheets later, prefer a sheet revision/export hash if available; otherwise use a generated source snapshot hash from the fetched values.

Example:

```text
srcimp-spreadsheet-export-music-ministry-master-data-proposed-schedules-bf3ca27bb9e4-v1
```

This means re-running the same exact source snapshot reuses the same `sourceImportId`; a changed workbook creates a new source import record.

## Idempotent Create/Update Behavior

Future write behavior should be deterministic and conservative.

### Create If Missing

If a target `services/{serviceId}` or `serviceSongEvents/{serviceSongEventId}` document does not exist, create it with the normalized preview fields.

Set:

* `createdAt`
* `updatedAt`
* `sourceImportedAt`
* `sourceImportId`

### Update If Same Source Provenance

If the document exists and is still spreadsheet-planned, update spreadsheet-owned fields when the incoming record has the same source family.

Treat a record as spreadsheet-owned when:

* `sourceType` is `spreadsheet_export` or `google_sheet_export`
* `planningStatus` is `planned`
* `actualStatus` is `unknown`

Refreshable fields include:

* `theme`
* `serviceLabels`
* `rawValue`
* `songTitleCandidate`
* `songTitleConfidence`
* `hymnalNumber`
* `assignedPersonOrGroupRaw`
* `detailNote`
* source provenance fields
* `updatedAt`

### Preserve Manual Corrections

Do not overwrite fields that appear manually curated unless the future command explicitly supports an approved override.

Manual/curated fields include:

* `songId`
* canonical matched title fields
* manually adjusted `serviceType`
* manually adjusted `theme`
* any field marked with `manualOverride: true`
* any record with `lastEditedBy` outside the import system

Recommended pattern:

* Store import-owned raw fields separately from curated fields.
* Add `manualOverrideFields` as an optional array when a future UI or admin script modifies imported records.

### Preserve Completed Or Confirmed History

Do not refresh planned spreadsheet data over records that have been completed or confirmed.

Block automatic update when:

* `actualStatus` is `completed`
* `planningStatus` is `confirmed`
* `planningStatus` is `completed`
* `completionStatus` is `completed`
* `changedAfterPlan` is `true`

The write plan may report these as conflicts requiring explicit review.

### Refresh Planned Records

Records that remain:

* `planningStatus: planned`
* `actualStatus: unknown`
* `changedAfterPlan: false`

may be refreshed from the spreadsheet during re-import.

## Provenance Requirements

Every written `services` and `serviceSongEvents` record should include:

* `source: spreadsheet_import`
* `sourceType`
* `sourceName`
* `sourceWorkbookHash`
* `sourceSpreadsheetId`
* `sourceSheetName`
* `sourceRowNumber`
* `sourceCell`
* `sourceImportedAt`
* `sourceImportId`

For song events, also include:

* `sourceColumnName`
* `sourceColumnKey`

For source imports, include enough metadata to recreate the import context without storing private raw workbook rows in Firestore:

* source identifiers
* parser/import contract version
* counts
* warning summaries
* status
* timestamps

Do not store the private spreadsheet file itself in Firestore.

## Status Model

Recommended starting fields:

### `planningStatus`

Tracks the planning lifecycle.

Allowed starting values:

* `planned`
* `confirmed`
* `canceled`
* `completed`

Default for spreadsheet imports:

```text
planned
```

### `actualStatus`

Tracks whether the planned item is known to have actually happened.

Allowed starting values:

* `unknown`
* `completed`
* `not_sung`
* `changed`

Default for spreadsheet imports:

```text
unknown
```

### `changedAfterPlan`

Boolean indicating whether the completed service differed from the imported plan.

Default:

```text
false
```

### `completionStatus`

Do not add this yet unless the next slice needs a single rollup field. `planningStatus` plus `actualStatus` should be enough for the first spreadsheet write design.

## Conflict Handling

### Spreadsheet Row Changes Between Imports

Because service IDs should be based on service date/type/title rather than row number, row movement should update provenance without creating duplicates.

The write plan should report row moves when an existing record has the same `serviceId` but a different `sourceRowNumber` or `sourceCell`.

### Deleted Or Blanked Spreadsheet Rows

Do not delete Firestore records in the first write slice.

If a previously imported record is missing from the latest preview:

* report it as `missing_from_source`
* leave Firestore unchanged
* optionally mark as `staleFromSource: true` only in a later approved slice

### Services Removed From The Spreadsheet

Same as deleted rows: report only. Do not delete or cancel services automatically.

### Song Slot Changes

If the same `serviceSongEventId` exists and remains planned, update import-owned fields from the latest spreadsheet value.

If a slot is now blank or missing:

* report as `slot_missing_from_source`
* do not delete in the first write slice
* do not mark `not_sung` automatically

If a slot changes from one raw value to another:

* report old and new normalized values in the write plan
* update only if the record remains planned and unconfirmed

### Source Row Moves

Source row moves should be handled as provenance updates when the natural service/event ID is the same.

If source row movement produces duplicate natural keys, the write plan should stop and require review.

### Manually Edited Firestore Records

If a record has `manualOverride: true`, `manualOverrideFields`, or a non-import `updatedBy`, do not overwrite those fields.

The write plan should report:

* field-level preserve decisions
* incoming values
* existing values

### Previously Completed Services

Never overwrite completed or confirmed records from a spreadsheet import without explicit future approval.

The write plan should report these as blocked conflicts.

## Review Gate

Future command should support three modes:

### `preview`

Current behavior. Reads spreadsheet and produces normalized preview JSON only.

No Firestore reads.

No Firestore writes.

### `plan`

Future Slice 12 behavior. Reads preview records and existing Firestore records, then produces a write plan.

No Firestore writes.

Plan output should include:

* records to create
* records to update
* records to preserve
* records blocked by conflicts
* records missing from source
* warning summary
* source import record preview

### `commit`

Future later behavior. Applies a reviewed write plan.

Commit should require explicit confirmation, such as:

```text
--commit --source-import-id {id} --confirm
```

Do not build `commit` in the next slice.

## Safety Rules

The future writer must enforce:

* No write if any warning has `severity: error`.
* Review warnings must be summarized before commit.
* `skippedServiceShells` are not imported by default.
* Spreadsheet imports do not mark records completed.
* Spreadsheet imports do not delete records in the first write slice.
* Spreadsheet imports do not call GPT-facing write actions.
* No GPT-facing spreadsheet write action is exposed.
* No import may overwrite completed, confirmed, or manually corrected records without an explicit future override workflow.
* No source workbook, raw spreadsheet export, credentials, or private payload files are committed to the repo.

## Recommended Next Slice

Recommended next slice: Spreadsheet Planning Firestore Write Plan Command.

Goal:

Build a read-only Firestore comparison command that consumes the Slice 10 preview output, reads existing `services`, `serviceSongEvents`, and future `sourceImports` state, and produces a write plan without committing anything.

The plan command should answer:

* which service records would be created
* which service records would be updated
* which service song event records would be created
* which service song event records would be updated
* which existing records would be preserved
* which records are blocked by conflicts
* which prior imported records are missing from the latest source
* whether the preview is eligible for a later commit

Still do not write to Firestore in that slice.
