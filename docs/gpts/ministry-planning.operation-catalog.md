# Ministry Planning Operation Catalog

This generated file is a local review artifact. The Custom GPT reads the live catalog through `listMinistryPlanningOperations`; do not upload this file as GPT Knowledge.

## Routing Rules

1. Use `runMinistryPlanningQuery` for every read-only operation.
2. Use `runMinistryPlanningCommand` for requested durable changes and spreadsheet syncs.
3. Send the catalog name in `operation` and inputs in `arguments`.
4. Do not ask for separate permission before queries, creates, merges, updates, feedback saves, or an explicitly requested sync.
5. Ask once only before a permanent delete or full-document replacement, then send `confirmed: true`.
6. Send one stable `idempotencyKey` per command intent and reuse it only to retry that intent.
7. Never ask Dan to read back a generated `sourceImportId`; `syncMusicPlanningSpreadsheet` resolves it internally.

Catalog version: `1-8799584ded41`

Catalog hash: `8799584ded41d277e5e33ac548111fb7caf9823052db11bdb7e2666abb5d3f10`

The registry currently exposes 26 operations.

## Query Operations

Use `runMinistryPlanningQuery` for every operation in this section.

### listDataCollections

List the Firestore collections available to ministry planning queries and commands.

Required: none

Optional: none

Confirmation policy: `none`

```json
{
  "operation": "listDataCollections",
  "arguments": {}
}
```

### getMinistryPlanningConfig

Retrieve the current Firestore-backed workflow, song-planning model, or service-order model.

Required: none

Optional: `configId`, `section`, `sections`

Confirmation policy: `none`

Argument guidance: Load operatorGuidance once at the first substantive ministry request in a conversation, then request only relevant domain sections as needed. Omit sections to retrieve all runtime documents. The live operation list remains authoritative for operation names and arguments.

```json
{
  "operation": "getMinistryPlanningConfig",
  "arguments": {
    "sections": [
      "operatorGuidance",
      "songPlanning"
    ]
  }
}
```

### queryData

Read ministry records with document IDs, filters, text search, sorting, and field selection.

Required: `collection`

Optional: `docId`, `docIds`, `dataFilters`, `query`, `fields`, `orderBy`, `limit`, `scanLimit`

Confirmation policy: `none`

```json
{
  "operation": "queryData",
  "arguments": {
    "collection": "services",
    "orderBy": [
      {
        "fieldPath": "serviceDate",
        "direction": "desc"
      }
    ],
    "limit": 10
  }
}
```

### searchSongs

Search the canonical song catalog by title, hymn number, topic, source, or planning metadata.

Required: none

Optional: `query`, `filters`, `sort`, `limit`

Confirmation policy: `none`

```json
{
  "operation": "searchSongs",
  "arguments": {
    "query": "Footsteps of Jesus",
    "limit": 10
  }
}
```

### getSong

Retrieve one complete canonical song record.

Required: `songId`

Optional: none

Confirmation policy: `none`

```json
{
  "operation": "getSong",
  "arguments": {
    "songId": "rejoice-262-footsteps-of-jesus"
  }
}
```

### searchServices

Search committed past or upcoming service schedules using natural language or date and service filters.

Required: none

Optional: `query`, `filters`, `limit`

Confirmation policy: `none`

Argument guidance: Use this first for schedule questions. It returns related song rows with each service.

```json
{
  "operation": "searchServices",
  "arguments": {
    "query": "last Sunday night",
    "limit": 5
  }
}
```

### getService

Retrieve one complete service and its ordered song rows.

Required: `serviceId`

Optional: none

Confirmation policy: `none`

```json
{
  "operation": "getService",
  "arguments": {
    "serviceId": "svc-plan-2026-07-12-sunday-evening"
  }
}
```

### buildActiveCongregationalPool

Build the current ordinary-service congregational song pool from canonical planning rules.

Required: none

Optional: `limit`, `leaderId`, `usageRole`, `includeExcluded`

Confirmation policy: `none`

```json
{
  "operation": "buildActiveCongregationalPool",
  "arguments": {
    "leaderId": "dan",
    "limit": 100
  }
}
```

### inspectMusicPlanningSpreadsheet

Read and compare the live planning spreadsheet without changing Firestore.

Required: none

Optional: `googleSheetId`, `googleSheetUrl`, `sheet`, `year`, `focusDate`, `focusServiceType`

Confirmation policy: `none`

Argument guidance: Use only when the user asks to inspect or compare the live sheet, or a committed schedule lookup is missing expected data.

```json
{
  "operation": "inspectMusicPlanningSpreadsheet",
  "arguments": {
    "focusDate": "2026-07-12",
    "focusServiceType": "sunday_night"
  }
}
```

### listGoogleSheetBackups

List hidden full-sheet backups available for the live ministry planning spreadsheet.

Required: none

Optional: `googleSheetId`, `googleSheetUrl`, `limit`

Confirmation policy: `none`

Argument guidance: Assignment writes create these backups automatically before changing the sheet.

```json
{
  "operation": "listGoogleSheetBackups",
  "arguments": {
    "limit": 10
  }
}
```

### readGoogleSheetRange

Read a bounded A1 range directly from the live planning spreadsheet without cached exports.

Required: `range`

Optional: `googleSheetId`, `googleSheetUrl`, `sheet`

Confirmation policy: `none`

Argument guidance: Use this to verify exact live cells or diagnose stale source-row provenance.

```json
{
  "operation": "readGoogleSheetRange",
  "arguments": {
    "range": "A125:K140"
  }
}
```

### listPianists

List pianist profiles, capability levels, regular schedules, limits, and optional availability for one service.

Required: none

Optional: `pianistId`, `capabilityLevel`, `status`, `includeInactive`, `serviceId`, `serviceDate`, `serviceType`

Confirmation policy: `none`

Argument guidance: Provide serviceId, or serviceDate plus serviceType, to evaluate each pianist's recurring availability and exact-date exceptions.

```json
{
  "operation": "listPianists",
  "arguments": {
    "serviceDate": "2026-07-19",
    "serviceType": "sunday_morning"
  }
}
```

### getPianoServicePlan

Get all Piano 1-4 assignments, duties, availability warnings, and required-position coverage for one service.

Required: `serviceId`

Optional: none

Confirmation policy: `none`

```json
{
  "operation": "getPianoServicePlan",
  "arguments": {
    "serviceId": "svc-plan-2026-07-19-sunday-morning"
  }
}
```

### getPianistWorkload

Report pianist service counts and Piano 1-4 history, warning when a pianist exceeds their monthly service limit.

Required: none

Optional: `pianistId`, `month`, `dateFrom`, `dateTo`

Confirmation policy: `none`

Argument guidance: The default monthly limit is six services. Exceeding the limit warns but does not block an assignment.

```json
{
  "operation": "getPianistWorkload",
  "arguments": {
    "month": "2026-07"
  }
}
```

### getServiceMinistryAssignments

Get the preacher, congregational leader, choir accompanist, and per-special accompanists for one service.

Required: `serviceId`

Optional: none

Confirmation policy: `none`

Argument guidance: The response includes stable serviceSongEventId values for each choir, special-music, and offertory item.

```json
{
  "operation": "getServiceMinistryAssignments",
  "arguments": {
    "serviceId": "svc-plan-2026-07-19-sunday-morning"
  }
}
```

## Command Operations

Use `runMinistryPlanningCommand` for every operation in this section.

### syncMusicPlanningSpreadsheet

Plan and commit a safe live spreadsheet sync, resolving the current source import ID internally.

Required: none

Optional: `googleSheetId`, `googleSheetUrl`, `sheet`, `year`, `focusDate`, `focusServiceType`

Confirmation policy: `none`

Argument guidance: The user's request to sync is sufficient authorization. Do not ask them to repeat a generated sourceImportId.

```json
{
  "operation": "syncMusicPlanningSpreadsheet",
  "arguments": {
    "googleSheetUrl": "https://docs.google.com/spreadsheets/d/1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss/edit"
  }
}
```

### savePianistProfile

Create or update a pianist's capability, recurring availability logic, exact-date exceptions, and monthly workload limit.

Required: none

Optional: `pianistId`, `displayName`, `status`, `capabilityLevel`, `defaultAvailability`, `recurringRules`, `availabilityExceptions`, `regularScheduleNotes`, `monthlyServiceLimit`, `notes`, `changedBy`

Confirmation policy: `none`

Argument guidance: A new profile needs displayName. An update may use pianistId. Store Dan's wording in regularScheduleNotes and translate it into recurringRules; exact dates belong in availabilityExceptions.

```json
{
  "operation": "savePianistProfile",
  "arguments": {
    "displayName": "Example Pianist",
    "capabilityLevel": "developing",
    "defaultAvailability": "unavailable",
    "recurringRules": [
      {
        "ruleId": "first-third-sunday-am",
        "available": true,
        "serviceTypes": [
          "sunday_morning"
        ],
        "weeksOfMonth": [
          1,
          3
        ]
      }
    ],
    "monthlyServiceLimit": 6
  }
}
```

### saveServicePianoAssignments

Assign pianists to whole-service Piano 1-4 positions, or clear positions, with eligibility and workload warnings.

Required: `serviceId`

Optional: `assignments`, `clearPositions`, `replaceAssignments`, `writeToSpreadsheet`, `googleSheetId`, `googleSheetUrl`, `sheet`, `changedBy`

Confirmation policy: `none`

Argument guidance: Piano 1 is required for complete coverage. Piano 2, 3, and 4 are optional. Piano 1 handles prelude, congregationals, invitation, and postlude; all other positions handle congregationals only.

```json
{
  "operation": "saveServicePianoAssignments",
  "arguments": {
    "serviceId": "svc-plan-2026-07-19-sunday-morning",
    "assignments": [
      {
        "position": "piano_1",
        "pianistId": "pianist-example-primary"
      },
      {
        "position": "piano_3",
        "pianistId": "pianist-example-learner"
      }
    ]
  }
}
```

### saveServiceCongregationalPlan

Change one or more congregational song slots in both Firestore and the visible live Google Sheet row.

Required: `serviceId`, `songChanges`

Optional: `googleSheetId`, `googleSheetUrl`, `sheet`, `changedBy`

Confirmation policy: `none`

Argument guidance: Use this for requested congregational song changes instead of mutateData. It always backs up and updates the live Sheet; 'do not refresh' means do not re-import the Sheet and does not suppress this requested write.

```json
{
  "operation": "saveServiceCongregationalPlan",
  "arguments": {
    "serviceId": "svc-plan-2026-08-30-sunday-evening",
    "songChanges": [
      {
        "slot": "congregational_1",
        "songId": "rejoice-0276"
      },
      {
        "slot": "congregational_2",
        "songId": "rejoice-0311"
      }
    ]
  }
}
```

### saveServiceMinistryAssignments

Save the preacher, congregational leader, choir accompanist, and one accompanist for each special-music item.

Required: `serviceId`

Optional: `preacher`, `congregationalLeader`, `choirAccompanist`, `specialAccompanists`, `clearFields`, `writeToSpreadsheet`, `googleSheetId`, `googleSheetUrl`, `sheet`, `changedBy`

Confirmation policy: `none`

Argument guidance: The preacher and congregational leader must be different people. Choir and special accompaniment do not count toward monthly Piano 1-4 workload. Spreadsheet write-back is attempted by default.

```json
{
  "operation": "saveServiceMinistryAssignments",
  "arguments": {
    "serviceId": "svc-plan-2026-07-19-sunday-morning",
    "preacher": {
      "displayName": "Pastor Example"
    },
    "congregationalLeader": {
      "displayName": "Song Leader Example"
    },
    "choirAccompanist": {
      "displayName": "Choir Pianist Example"
    },
    "specialAccompanists": [
      {
        "serviceSongEventId": "sse-plan-example-special-1",
        "displayName": "Special Pianist Example"
      }
    ]
  }
}
```

### syncServiceAssignmentsToSpreadsheet

Write the current preacher, leader, Piano 1-4, choir, and per-special assignments to the service's row in the live Google Sheet.

Required: `serviceId`

Optional: `googleSheetId`, `googleSheetUrl`, `sheet`

Confirmation policy: `none`

Argument guidance: Use this to retry or explicitly refresh Google Sheet write-back from the current Firestore assignment records.

```json
{
  "operation": "syncServiceAssignmentsToSpreadsheet",
  "arguments": {
    "serviceId": "svc-plan-2026-07-19-sunday-morning"
  }
}
```

### restoreGoogleSheetBackup

Restore the active planning tab from a selected hidden backup after first backing up its current state.

Required: none

Optional: `googleSheetId`, `googleSheetUrl`, `sheet`, `backupSheetId`, `backupTitle`, `confirmed`

Confirmation policy: `destructive_only`

Argument guidance: Use backupSheetId or backupTitle from listGoogleSheetBackups. A clear user request to restore that backup is confirmation; pass confirmed true without asking them to approve the same request again.

```json
{
  "operation": "restoreGoogleSheetBackup",
  "arguments": {
    "backupSheetId": 123456789,
    "confirmed": true
  }
}
```

### restoreGoogleSheetRange

Restore only a selected A1 range from a hidden backup and verify the copied values.

Required: `range`

Optional: `googleSheetId`, `googleSheetUrl`, `sheet`, `backupSheetId`, `backupTitle`, `confirmed`

Confirmation policy: `destructive_only`

Argument guidance: Use this for surgical recovery without replacing the whole tab. A clear request to repair the named range is confirmation; pass confirmed true.

```json
{
  "operation": "restoreGoogleSheetRange",
  "arguments": {
    "backupSheetId": 123456789,
    "range": "D31:F31",
    "confirmed": true
  }
}
```

### recordServiceSongFeedback

Apply planning feedback to the canonical songs used in one service, resolving hymn numbers and titles automatically.

Required: `serviceId`, `feedback`

Optional: `treatment`, `changedBy`

Confirmation policy: `none`

Argument guidance: Default treatment is soft_downweight. Use hard_block only when Dan clearly wants every resolved song marked do_not_use.

```json
{
  "operation": "recordServiceSongFeedback",
  "arguments": {
    "serviceId": "svc-plan-2026-07-12-sunday-evening",
    "feedback": "These songs dragged out; avoid using this group together for now.",
    "treatment": "soft_downweight"
  }
}
```

### updateSongIdentity

Update one canonical song title or title aliases and write its audit record.

Required: `songId`, `changes`

Optional: `changeReason`, `changedBy`

Confirmation policy: `none`

```json
{
  "operation": "updateSongIdentity",
  "arguments": {
    "songId": "rejoice-262-footsteps-of-jesus",
    "changes": {
      "titleAliases": [
        "Footsteps"
      ]
    }
  }
}
```

### mutateData

Create, update, merge, replace, or delete one approved ministry data record.

Required: `collection`, `operation`

Optional: `docId`, `data`, `fieldPatches`, `merge`, `confirmed`, `changedBy`

Confirmation policy: `destructive_only`

Argument guidance: Create, merge, and update run from the user's request without another confirmation. Set with merge false and delete require confirmed: true after explicit confirmation.

```json
{
  "operation": "mutateData",
  "arguments": {
    "collection": "songs",
    "docId": "rejoice-262-footsteps-of-jesus",
    "operation": "update",
    "fieldPatches": [
      {
        "fieldPath": "ministryPlanning.rotationStrength",
        "action": "set",
        "value": "rare"
      }
    ]
  }
}
```

