# Slice 14 Spreadsheet Planning Import Verification and GPT Readiness Review

Date: 2026-04-25

Slice name: Spreadsheet Planning Import Verification and GPT Readiness Review

Status: Read-only verification and readiness review

## Summary

The Slice 13 spreadsheet planning import was verified with read-only Firestore reads.

The expected records exist:

| Collection | Expected | Verified |
| --- | ---: | ---: |
| `sourceImports` | 1 | 1 |
| `services` | 55 | 55 |
| `serviceSongEvents` | 135 | 135 |

Source import ID:

```text
srcimp-spreadsheet-export-music-ministry-master-data-proposed-schedules-bf3ca27bb9e4-spreadsheet-planning-v1
```

Important readiness conclusion:

The imported spreadsheet records are structurally valid planned records, but they should not be exposed to the Custom GPT as completed service history yet. The current `POST /services/search` and `GET /services/{serviceId}` read path can see them because it treats any service with `sourceImportId` as normalized service history, but the action response does not expose `planningStatus`, `actualStatus`, or `changedAfterPlan`.

## Verification Results

### `sourceImports`

The expected `sourceImports` record exists.

Source summary:

| Field | Value |
| --- | --- |
| `sourceType` | `spreadsheet_export` |
| `sourceName` | `Music Ministry - Master Data` |
| `status` | `planned` |
| `rowCounts.importableServices` | 55 |
| `rowCounts.serviceSongEvents` | 135 |
| `warningCounts.review` | 33 |
| `warningCounts.info` | 1 |

### `services`

Read-only verification found exactly 55 `services` records for the source import.

Status check:

| Status tuple | Count |
| --- | ---: |
| `planningStatus: planned`, `actualStatus: unknown`, `changedAfterPlan: false` | 55 |

Required provenance fields were present on all 55 service records:

* `sourceType`
* `sourceName`
* `sourceSheetName`
* `sourceRowNumber`
* `sourceCell`
* `sourceImportId`

### `serviceSongEvents`

Read-only verification found exactly 135 `serviceSongEvents` records for the source import.

Status check:

| Status tuple | Count |
| --- | ---: |
| `planningStatus: planned`, `actualStatus: unknown`, `changedAfterPlan: false` | 135 |

Required provenance fields were present on all 135 service-song-event records:

* `sourceType`
* `sourceName`
* `sourceSheetName`
* `sourceRowNumber`
* `sourceCell`
* `sourceColumnName`
* `sourceImportId`

## Sample Service Records

| Kind | Service ID | Date | Type | Title / labels | Status | Provenance |
| --- | --- | --- | --- | --- | --- | --- |
| Sunday morning | `svc-plan-2026-01-11-sunday-morning` | 2026-01-11 | `sunday_morning` | Morning Service, `AM` | planned / unknown / false | Row 4, cell `B4` |
| Sunday evening | `svc-plan-2026-01-11-sunday-evening` | 2026-01-11 | `sunday_evening` | Evening Service, `PM` | planned / unknown / false | Row 5, cell `B5` |
| Prayer service | `svc-plan-2026-01-07-prayer-service` | 2026-01-07 | `prayer_service` | Prayer Service | planned / unknown / false | Row 3, cell `B3` |
| Special event | `svc-plan-2026-01-21-special-event-missions-conference` | 2026-01-21 | `special_event` | Missions Conference | planned / unknown / false | Row 9, cell `B9` |

## Sample Service Song Event Records

| Kind | Event ID | Service ID | Role | Planned title / assignment | Status | Provenance |
| --- | --- | --- | --- | --- | --- | --- |
| Congregational hymn | `sse-plan-svc-plan-2026-03-01-sunday-morning-10-congregational-1` | `svc-plan-2026-03-01-sunday-morning` | `congregational` | `#79 To God Be the Glory` | planned / unknown / false | Row 36, cell `C36` |
| Special assignment only | `sse-plan-svc-plan-2026-01-11-sunday-morning-60-special-1` | `svc-plan-2026-01-11-sunday-morning` | `special_music` | assignee `Gabe & Abby D`, no title candidate | planned / unknown / false | Row 4, cell `H4` |
| Performer plus title | `sse-plan-svc-plan-2026-01-18-sunday-evening-60-special-1` | `svc-plan-2026-01-18-sunday-evening` | `special_music` | assignee `Gendro family`, title candidate `Around the Corner` | planned / unknown / false | Row 8, cell `H8` |
| Grade-band detail note | `sse-plan-svc-plan-2026-01-21-special-event-missions-conference-60-special-1` | `svc-plan-2026-01-21-special-event-missions-conference` | `special_music` | assignee `FBCA Elementary`, detail note `K-2`, no title candidate | planned / unknown / false | Row 9, cell `H9` |

The sample records match the Slice 10/12 contracts:

* Congregational slots preserve title candidates and hymn numbers.
* Performer-only special music slots do not invent song titles.
* Performer-plus-title special slots preserve both assignee and candidate title.
* Grade-band parentheticals are stored as detail notes rather than song titles.

## Existing Read-Path Behavior

### Current Code Path

The existing service-history routes are:

* `POST /services/search`
* `GET /services/{serviceId}`

Both use `lib/service-history-service.js`.

Current source filtering is implemented by `isNormalizedBreezeService`:

```js
return source === "breeze_import" || source === "breeze" || Boolean(sourceImportId);
```

Because spreadsheet-planned records have `sourceImportId`, they pass this filter even though `source` is `spreadsheet_import`.

### Search Behavior

Read-only function verification showed that `searchServices` can find spreadsheet-planned records.

Example filter:

```json
{
  "serviceDate": "2026-01-11",
  "serviceType": "sunday_morning"
}
```

Returned:

* `svc-plan-2026-01-11-sunday-morning`
* `source: spreadsheet_import`
* six planned music slots

But the returned service summary does not include:

* `planningStatus`
* `actualStatus`
* `changedAfterPlan`
* `sourceType`
* `sourceSheetName`
* `sourceImports` context

### Detail Behavior

Read-only function verification showed that `getServiceById` can retrieve:

```text
svc-plan-2026-01-11-sunday-morning
```

But the returned detail has the same issue: it includes songs and source import ID, but it does not label the service or slots as planned.

It also looks for import metadata only in `breezeImports`, not `sourceImports`, so spreadsheet import context is reduced to just the import ID.

## GPT Readiness Assessment

### Current Slice 5 GPT Risk

The current Slice 5 GPT-facing workflow describes service-history actions as read-only past service history. It also says to treat service history as past usage evidence only.

Because the current backend response does not expose planning status, the GPT could accidentally answer a prompt like:

```text
What songs were used on January 11 Sunday morning?
```

with spreadsheet-planned songs as if they were completed/sung history.

That would be wrong. These records are planning records only:

* `planningStatus: planned`
* `actualStatus: unknown`
* `changedAfterPlan: false`

### Recommendation

Recommendation: do not expose spreadsheet-planned records to the GPT yet.

More precisely:

1. Existing service-history actions should be patched or configured so completed/past-history queries do not return spreadsheet-planned records by accident.
2. Planned spreadsheet records should only be exposed after the API response includes explicit status fields and the GPT instructions require planned-language answers.
3. Future GPT behavior should distinguish:
   * completed service history: actually used/sung
   * planned services: scheduled/planned, not confirmed
   * unknown actual status: do not describe as sung

The likely future GPT exposure model is option 2:

Expose planned records only through clearly planned-language queries, such as:

* “What is planned?”
* “What songs are scheduled?”
* “What is on the spreadsheet plan?”

Do not mix planned records into “what was used” history answers until a completion/confirmation workflow exists.

## Required Changes Before GPT Exposure

Before exposing spreadsheet-planned records to the live GPT, update backend and GPT-facing artifacts so planned records cannot be confused with history.

Recommended backend changes:

1. Split service read behavior by source/status:
   * completed history reads
   * planned service reads
2. Add explicit fields to service summaries/details:
   * `planningStatus`
   * `actualStatus`
   * `changedAfterPlan`
   * `sourceType`
   * `sourceName`
3. Load `sourceImports` context in addition to `breezeImports`.
4. Add filters such as:
   * `recordStatus: completed | planned | any`
   * or `includePlanned: false` by default
5. Ensure “past usage” searches default to completed/confirmed history only.

Recommended GPT artifact changes later:

1. Update schema only after backend behavior is explicit.
2. Add instructions that planned spreadsheet records are scheduled/planned only.
3. Require the GPT to say “planned” or “scheduled” for planned records.
4. For “what was sung/used” prompts, require completed/confirmed records only.
5. Keep recommendation and setlist-generation refusal boundaries unless a later planning slice explicitly changes them.

## Risks If Planned Records Are Confused With Completed History

Risks:

* The GPT may report planned songs as if they were actually sung.
* Song usage history may become inaccurate.
* Future recommendation or repetition analysis could be polluted by unconfirmed plans.
* Performer-only special music assignments could be mistaken for songs if the status and title-candidate fields are not exposed carefully.
* Source import context is incomplete in the current read path because it only reads `breezeImports`, not `sourceImports`.

## Recommended Next Slice

Recommended next slice: Planned vs Completed Service Read Boundary.

Goal:

Patch the backend service-history read path so spreadsheet-planned records do not leak into completed service-history answers. The slice should add explicit status/source fields and either exclude planned records by default or expose them only behind planned-service filters.

Suggested scope:

* update service-history read filtering
* include `planningStatus`, `actualStatus`, `changedAfterPlan`, and `sourceType` in returned service summaries/details
* optionally read `sourceImports` for spreadsheet import context
* add tests proving:
  * “used/sung/history” reads exclude planned spreadsheet records by default
  * planned-service queries can include planned records only when explicitly requested
  * returned records are clearly labeled

Do not update GPT artifacts until that backend boundary is implemented and tested.
