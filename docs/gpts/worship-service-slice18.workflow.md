# Ministry Planning Dispatcher Workflow

This is the implementation companion to `worship-service-slice18.builder-instructions.md`.

Active Builder schema: `ministry-planner.schema.dispatcher-upload.json`.

Runtime workflow and data-model knowledge: `getMinistryPlanningConfig`.

Live operation names and arguments: `listMinistryPlanningOperations`.

No Knowledge-file uploads are required.

## Dispatch

Use the catalog operation's declared mode:

- `query` -> `runMinistryPlanningQuery`
- `command` -> `runMinistryPlanningCommand`

Queries never require confirmation. Commands use an idempotency key. Ordinary creates, merges, updates, feedback saves, and requested spreadsheet syncs run from the user's stated intent without another conversational checkpoint.

Only these operations require a separate confirmation:

- permanent `delete`
- full-document `set` with `merge: false`

After Dan confirms one of those, call `mutateData` with `confirmed: true`.

For a spreadsheet restore, Dan's clear request to restore a specific listed backup is the confirmation. Call `restoreGoogleSheetBackup` or `restoreGoogleSheetRange` with `confirmed: true`; do not ask him to repeat it. The backend creates a pre-restore safety backup automatically.

## Common Flows

Schedule lookup:

1. `searchServices` with the natural-language request or structured filters.
2. Return the matching service and ordered songs.
3. If expected recent data is missing, call `inspectMusicPlanningSpreadsheet` for the same date/type.
4. Do not sync unless Dan asked to sync.

Spreadsheet sync:

1. Call command `syncMusicPlanningSpreadsheet` with the sheet URL/ID only when needed.
2. The backend discovers the source ID, commits safe changes, and verifies them.
3. Return final counts and warnings. There is no source-ID confirmation round trip.

Service feedback:

1. Resolve the service using `searchServices`.
2. Call command `recordServiceSongFeedback` with the exact `serviceId`, Dan's feedback, and usually `soft_downweight`.
3. Report updated canonical songs and any unresolved sheet rows.
4. Use `hard_block` only for a clear individual-song ban.

Congregational song changes:

1. Resolve the exact service with `searchServices` and each requested canonical song with `searchSongs`.
2. Call `saveServiceCongregationalPlan` with only the slots Dan is changing.
3. The command resolves the live row from service date/type, creates a hidden spreadsheet backup, writes and rereads the visible cells, repairs stale row provenance, and updates the matching Firestore events.
4. Never use `mutateData` for this workflow. "Do not refresh" prevents a Sheet-to-Firestore import; it does not prevent the requested write.

Precise metadata update:

1. Read the record if its identity is not already clear.
2. Call command `mutateData` with `operation: update` and narrow `fieldPatches`.
3. Report the saved fields. Do not ask Dan to approve his own update request again.

Pianist profile setup:

1. Translate Dan's regular scheduling logic into `recurringRules`, retaining his original wording in `regularScheduleNotes`.
2. Call `savePianistProfile` with the fixed capability level and default monthly limit of six unless Dan gives another limit.
3. Use exact-date `availabilityExceptions` for vacations and one-off changes.

Piano assignment planning:

1. Resolve the service with `searchServices`.
2. Call `getPianoServicePlan` and `listPianists` for that service.
3. Call `saveServicePianoAssignments` with whole-service positions. Piano 1 is required; Piano 2-4 are optional.
4. Report availability and monthly workload warnings without blocking Dan's requested assignment.
5. Never include choir or special-music pianists in the Piano 1-4 plan.

Service ministry assignments:

1. Call `getServiceMinistryAssignments` to read the current preacher, congregational leader, choir accompanist, and stable IDs for each special.
2. Call `saveServiceMinistryAssignments` with only the fields Dan is changing. The preacher may not also be the congregational leader.
3. Link each special accompanist to its exact `serviceSongEventId`.
4. Choir/special accompaniment does not count toward Piano 1-4 monthly workload, and the same person may also hold a regular piano position.
5. Report whether Google Sheet write-back succeeded. If permissions were unavailable, use `syncServiceAssignmentsToSpreadsheet` after access is fixed.

Spreadsheet backup recovery:

1. Call `listGoogleSheetBackups` and identify the requested timestamped backup.
2. Describe the selected backup if Dan has not already selected one.
3. On his clear restore request, call `restoreGoogleSheetBackup` with its `backupSheetId` and `confirmed: true`.
4. Report both the restored backup and the new pre-restore safety backup.

Spreadsheet range recovery:

1. Use `readGoogleSheetRange` to identify the exact live cells and values.
2. Select the pre-error backup with `listGoogleSheetBackups`.
3. Call `restoreGoogleSheetRange` with the bounded A1 range, selected `backupSheetId`, and `confirmed: true`.
4. Report the verified restored values and the new safety backup.

## Error Recovery

- Unknown operation: call `listMinistryPlanningOperations` and retry once with the exact name.
- Missing service result: broaden the service query once, then inspect the live sheet if the service should be recent.
- Command transport failure: retry once with the same idempotency key.
- Structured command failure: do not retry unless the error says it is retryable or Dan changes the input.
- Unresolved imported song: show the title/hymn number returned by `recordServiceSongFeedback`; do not invent a canonical ID.
