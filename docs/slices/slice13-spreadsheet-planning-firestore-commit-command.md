# Slice 13 Spreadsheet Planning Firestore Commit Command

Date: 2026-04-25

Slice name: Spreadsheet Planning Firestore Commit Command

Status: First guarded Firestore write completed

## Summary

Slice 13 adds the first real Firestore commit command for spreadsheet planning import.

The command applies only safe create actions from an approved write plan. It does not support updates, deletes, stale marking, completion changes, catalog matching, song creation, alias creation, GPT artifact changes, or deployment.

## Command

Approved command shape:

```bash
node scripts/commit-music-planning-firestore-import.mjs \
  --plan tmp/music-planning-firestore-write-plan.json \
  --confirm-source-import-id srcimp-spreadsheet-export-music-ministry-master-data-proposed-schedules-bf3ca27bb9e4-spreadsheet-planning-v1 \
  --commit
```

Default input:

* `tmp/music-planning-firestore-write-plan.json`

Default output:

* `tmp/music-planning-firestore-commit-result.json`

The generated result file is under ignored `tmp/`.

## Confirmation Requirements

The command refuses to run unless:

* `--commit` is present
* `--confirm-source-import-id` exactly matches the plan source import ID
* `eligibleForCommit` is `true`
* the plan has zero conflicts
* the plan has no `error` warnings
* the plan has no service or service-song-event `update`, `preserve`, `conflict`, or `missingFromSource` actions
* target documents are missing or match the same expected source import

## What It Writes

The first implementation writes only:

* one `sourceImports` record when missing
* planned `services` create actions
* planned `serviceSongEvents` create actions

All records preserve spreadsheet provenance from the approved plan.

## What It Refuses To Do

The command does not:

* update existing documents
* overwrite existing unexpected documents
* delete documents
* mark records stale
* mark anything completed or sung
* perform catalog matching
* create songs
* create aliases
* update GPT schema, builder instructions, or workflow files
* deploy anything

## Idempotency

The command preflights every target document before writing.

If a target document already exists and matches the same expected `sourceImportId` and source-owned identity, it is reported as skipped existing.

If a target document already exists with unexpected source/import identity, the command aborts before writing.

This makes the command safe to rerun after a successful commit.

## Commit Result

The approved command was run against Firestore database:

```text
location-map-985/chatgptstorage
```

Source import ID:

```text
srcimp-spreadsheet-export-music-ministry-master-data-proposed-schedules-bf3ca27bb9e4-spreadsheet-planning-v1
```

Result:

| Item | Count |
| --- | ---: |
| Source imports created | 1 |
| Source imports skipped existing | 0 |
| Services created | 55 |
| Services skipped existing | 0 |
| Service song events created | 135 |
| Service song events skipped existing | 0 |
| Conflicts | 0 |

Warnings summary from the approved plan:

| Severity/code | Count |
| --- | ---: |
| `review` warnings | 33 |
| `info` warnings | 1 |
| `special_music_assignment_only` | 20 |
| `ambiguous_special_music_cell` | 11 |
| `special_music_detail_note_only` | 2 |
| `skipped_service_shells` | 1 |

Post-commit read-only verification confirmed:

| Collection | Matching records |
| --- | ---: |
| `sourceImports` | 1 expected record exists |
| `services` | 55 records for this `sourceImportId` |
| `serviceSongEvents` | 135 records for this `sourceImportId` |

## Safety Confirmation

The commit performed:

* zero updates
* zero deletes
* zero completion changes
* zero catalog matches
* zero GPT artifact changes
* zero deployments

## Tests

Focused safety tests cover:

* refusal without `--commit`
* refusal when source import confirmation does not match
* refusal when the plan is ineligible
* refusal when conflicts exist
* refusal when update actions exist
* acceptance of create-only plans
* skipping expected existing target records without overwrite

## Recommended Next Slice

Recommended next slice: Spreadsheet Planning Import Verification and GPT Readiness Review.

That slice should verify the newly written planned service records through existing internal read paths, decide whether GPT-facing service-history reads should include spreadsheet-planned records or continue showing only Breeze-imported history, and define any schema/instruction changes needed before exposing planned spreadsheet data to the Custom GPT.
