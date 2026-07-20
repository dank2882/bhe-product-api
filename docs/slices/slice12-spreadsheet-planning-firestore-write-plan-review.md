# Slice 12 Spreadsheet Planning Firestore Write Plan Review

Date: 2026-04-25

Source plan:

* `tmp/music-planning-firestore-write-plan.json`

Status: Human review summary only. No Firestore writes were performed.

## Summary Counts

| Item | Count |
| --- | ---: |
| Source import action | create |
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
| Total warnings | 34 |
| Blocking conflicts | 0 |
| Eligible for commit | yes |

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

Planned source import ID:

```text
srcimp-spreadsheet-export-music-ministry-master-data-proposed-schedules-bf3ca27bb9e4-spreadsheet-planning-v1
```

## Sample Planned Service Creates

| Service ID | Date | Type | Title / theme | Source |
| --- | --- | --- | --- | --- |
| `svc-plan-2026-01-07-prayer-service` | 2026-01-07 | `prayer_service` | Prayer Service | Row 3, cell `B3` |
| `svc-plan-2026-01-11-sunday-morning` | 2026-01-11 | `sunday_morning` | Morning Service | Row 4, cell `B4` |
| `svc-plan-2026-01-11-sunday-evening` | 2026-01-11 | `sunday_evening` | Evening Service | Row 5, cell `B5` |
| `svc-plan-2026-01-21-special-event-missions-conference` | 2026-01-21 | `special_event` | Missions Conference | Row 9, cell `B9` |
| `svc-plan-2026-02-01-sunday-morning` | 2026-02-01 | `sunday_morning` | Morning Service / theme `God's Greatness` | Row 20, cell `B20` |
| `svc-plan-2026-01-14-prayer-service` | 2026-01-14 | `prayer_service` | Prayer Service | Row 6, cell `B6` |
| `svc-plan-2026-01-18-sunday-morning` | 2026-01-18 | `sunday_morning` | Morning Service | Row 7, cell `B7` |
| `svc-plan-2026-01-18-sunday-evening` | 2026-01-18 | `sunday_evening` | Evening Service | Row 8, cell `B8` |

These examples show the deterministic service ID strategy working across prayer service, Sunday morning, Sunday evening, special event, and themed service rows.

## Sample Planned Service Song Event Creates

| Service ID | Event ID | Role | Title candidate | Assignee/group | Hymn # | Source |
| --- | --- | --- | --- | --- | ---: | --- |
| `svc-plan-2026-01-07-prayer-service` | `sse-plan-svc-plan-2026-01-07-prayer-service-10-congregational-1` | `congregational` | I am thine own Lord |  |  | `C3` |
| `svc-plan-2026-01-11-sunday-morning` | `sse-plan-svc-plan-2026-01-11-sunday-morning-10-congregational-1` | `congregational` | Jesus Saves |  |  | `C4` |
| `svc-plan-2026-01-11-sunday-morning` | `sse-plan-svc-plan-2026-01-11-sunday-morning-20-congregational-2` | `congregational` | Anywhere with Jesus |  |  | `D4` |
| `svc-plan-2026-01-11-sunday-morning` | `sse-plan-svc-plan-2026-01-11-sunday-morning-30-congregational-3` | `congregational` | Saved by the Blood |  |  | `E4` |
| `svc-plan-2026-01-11-sunday-morning` | `sse-plan-svc-plan-2026-01-11-sunday-morning-40-choir-opener` | `choir_opener` | New Name in Glory |  |  | `F4` |
| `svc-plan-2026-01-11-sunday-morning` | `sse-plan-svc-plan-2026-01-11-sunday-morning-60-special-1` | `special_music` |  | Gabe & Abby D |  | `H4` |
| `svc-plan-2026-01-11-sunday-morning` | `sse-plan-svc-plan-2026-01-11-sunday-morning-70-special-2` | `special_music` |  | Jessica S |  | `I4` |
| `svc-plan-2026-01-11-sunday-evening` | `sse-plan-svc-plan-2026-01-11-sunday-evening-10-congregational-1` | `congregational` | So Send I You (Dan solo first) |  |  | `C5` |
| `svc-plan-2026-01-11-sunday-evening` | `sse-plan-svc-plan-2026-01-11-sunday-evening-70-special-2` | `special_music` |  | Williams family |  | `I5` |
| `svc-plan-2026-01-18-sunday-evening` | `sse-plan-svc-plan-2026-01-18-sunday-evening-60-special-1` | `special_music` | Around the Corner | Gendro family |  | `H8` |
| `svc-plan-2026-01-21-special-event-missions-conference` | `sse-plan-svc-plan-2026-01-21-special-event-missions-conference-60-special-1` | `special_music` |  | FBCA Elementary |  | `H9`; detail note `K-2` |
| `svc-plan-2026-03-01-sunday-morning` | `sse-plan-svc-plan-2026-03-01-sunday-morning-10-congregational-1` | `congregational` | To God Be the Glory |  | 79 | `C36` |
| `svc-plan-2026-01-18-sunday-morning` | `sse-plan-svc-plan-2026-01-18-sunday-morning-50-choir-special` | `choir_special` | A Burning Light |  |  | `G7` |

The samples confirm that the Slice 10 special-music contract is carried into the write plan:

* Performer-only special cells have no `songTitleCandidate`.
* Performer plus title parentheticals preserve both assignee and candidate title.
* Grade-band parentheticals become detail notes rather than title candidates.
* Congregational hymn numbers remain parseable.

## Warning Review

The plan has no blocking conflicts and no `error` warnings.

The 33 `review` warnings should not block building the next commit command, but they should be visible before the first real commit because they identify fields that should not be treated as canonical song matches yet.

### `special_music_assignment_only`

Count: 20

These are cells where the spreadsheet appears to record only a performer or group, such as `Gabe & Abby D`, `Jessica S`, or `Williams family`.

Recommended treatment for first commit:

* safe to commit as planned assignment data
* do not create a song title from these values
* do not attempt catalog matching from these values

### `ambiguous_special_music_cell`

Count: 11

These are cells where the parser split `Performer (Song Title)` into performer/group plus a title candidate, such as `Gendro family (Around the Corner)`.

Recommended treatment for first commit:

* safe to commit as planned data
* title candidates should remain lower-confidence
* future matching should require review or conservative confidence rules

### `special_music_detail_note_only`

Count: 2

These are cells where parenthetical text looked like a detail note rather than a song title, such as `FBCA Elementary (K-2)`.

Recommended treatment for first commit:

* safe to commit as performer/group plus detail note
* do not treat `K-2` or `3-6` as songs

### `skipped_service_shells`

Count: 1 info warning

This summarizes 102 date/service-only rows skipped from the importable set.

Recommended treatment for first commit:

* should not block commit
* do not import skipped service shells by default

## Commit-Readiness Assessment

Based on this plan, it is safe to build the next commit command. The plan is clean enough for a guarded commit implementation because:

* all planned Firestore actions are creates
* there are no updates to existing records
* there are no preserves
* there are no conflicts
* there are no missing-from-source records
* there are no `error` warnings
* `eligibleForCommit` is true

This is not yet approval to write the data. It means the next slice can build a commit command that requires explicit confirmation and applies this plan safely.

## First Commit Slice Must Not Do

The first commit slice should explicitly not:

* delete Firestore records
* mark anything completed or sung
* import skipped service shells
* overwrite completed, confirmed, changed, or manually corrected records
* perform song catalog matching
* create new songs or aliases
* treat performer-only special music cells as song titles
* resolve review warnings automatically
* expose any GPT-facing write action
* update GPT artifacts
* deploy automatically

## Recommended Next Slice

Recommended next slice: Spreadsheet Planning Firestore Commit Command.

Recommended safety refinements for that slice:

* require an explicit `--commit --confirm-source-import-id <id>` style confirmation
* refuse to run if the write plan has changed since review
* refuse to run if `eligibleForCommit` is false
* require zero `error` warnings
* print the same summary immediately before writing
* write only `create` actions in the first commit implementation
* leave update, delete, stale, completion, and catalog-match behavior for later slices
