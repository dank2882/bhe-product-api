# Piano Planning Data Model

This document defines pianist profiles, regular availability, whole-service assignments, and workload monitoring for the Ministry Planning GPT.

## Operating Model

There are four piano positions:

* `piano_1` is required for complete service coverage. It handles prelude, every congregational song, invitation, and postlude.
* `piano_2` is optional. It accompanies every congregational song only.
* `piano_3` and `piano_4` are optional developmental positions. Either developing pianist may fill either position, and each plays every congregational song.
* Choir and special music use their own pianists and are outside this assignment model.
* A pianist holds one position for the whole service. Do not switch positions or create song-level piano assignments.
* If optional positions are empty, the occupied positions remain the only active pianos.

## Pianist Profiles

Profiles are stored at `pianists/{pianistId}`.

Capability levels and fixed eligibility:

* `piano_1` -> `piano_1` only
* `piano_2` -> `piano_2` only
* `developing` -> `piano_3` or `piano_4`
* `not_schedulable` -> no position

Profiles also store:

* `status`: `active` or `inactive`
* `defaultAvailability`: `available` or `unavailable`
* `recurringRules`: structured regular-schedule rules
* `availabilityExceptions`: exact-date overrides
* `regularScheduleNotes`: Dan's original natural-language scheduling logic
* `monthlyServiceLimit`: defaults to `6`
* `notes`: other useful planning context

The GPT should translate Dan's natural-language schedule into structured rules while preserving his wording in `regularScheduleNotes`.

Example first-and-third-Sunday rule:

```json
{
  "ruleId": "first-third-sunday-am",
  "available": true,
  "serviceTypes": ["sunday_morning"],
  "weeksOfMonth": [1, 3]
}
```

Example alternating-week rule:

```json
{
  "ruleId": "alternating-sunday-night",
  "available": true,
  "serviceTypes": ["sunday_night"],
  "intervalWeeks": 2,
  "anchorDate": "2026-07-05"
}
```

Exact-date exceptions override recurring rules and defaults:

```json
{
  "serviceDate": "2026-08-09",
  "serviceTypes": ["sunday_morning"],
  "available": false,
  "reason": "Vacation"
}
```

## Service Piano Plans

Plans are stored at `servicePianoPlans/{serviceId}` and use the existing ministry service as their calendar source.

Each plan contains at most one assignment for each Piano 1-4 position. A pianist may occupy only one position in a service. Assignment history remains on past service plans so workload and development history can report how often someone served in each position.

Availability and workload problems produce warnings, not hard scheduling blocks. Position eligibility and duplicate assignments are hard validation rules.

## Workload

The default workload limit is six services in one calendar month. The seventh service and beyond produce `monthly_service_limit_exceeded` warnings. A profile may set a different personal limit.

Workload reports include:

* total services in the requested period
* counts for Piano 1, Piano 2, Piano 3, and Piano 4
* monthly counts and limits
* the underlying service assignments

Choir and special-music accompaniment does not count toward this monthly Piano 1-4 workload limit. A person may hold a regular Piano 1-4 position and also accompany choir or a special in the same service.

## Service Ministry Assignments

Service-level ministry roles are stored at `serviceMinistryAssignments/{serviceId}`:

* `preacher`
* `congregationalLeader`
* `choirAccompanist`
* `specialAccompanists`, linked to individual `serviceSongEventId` values

The preacher and congregational leader must be different people. Saving the preacher also updates the service message speaker so normal service queries can report who is preaching.

Choir uses one service-level accompanist. Every special-music or offertory item may have its own accompanist. These assignments are informational and do not change the Piano 1-4 workload count.

The system writes assignments back to the existing live Google Sheet service row. Standard columns are Preacher, Congregational Leader, Piano 1-4, Choir Pianist, Special #1 Pianist, Special #2 Pianist, and Offertory Pianist.

Every assignment write first duplicates the full `PROPOSED SCHEDULES` tab as a hidden timestamped backup. `listGoogleSheetBackups` lists those copies. `restoreGoogleSheetBackup` restores a selected copy and first creates a safety backup of the current tab.

## Dispatcher Use

Use these query operations:

* `listPianists`
* `getPianoServicePlan`
* `getPianistWorkload`
* `getServiceMinistryAssignments`
* `listGoogleSheetBackups`

Use these command operations:

* `savePianistProfile`
* `saveServicePianoAssignments`
* `saveServiceCongregationalPlan`
* `saveServiceMinistryAssignments`
* `syncServiceAssignmentsToSpreadsheet`
* `restoreGoogleSheetBackup`

Creating profiles, updating schedules, assigning pianists, and clearing planned positions are normal planning operations. Dan's request authorizes them without a second confirmation.
