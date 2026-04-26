# Slice 15 Date-Based Service Read Boundary

Date: 2026-04-25

Slice name: Date-Based Service Read Boundary

Status: Backend read-path patch

## Summary

This slice patches the backend service read path so service history and planning are separated by service date.

Rule:

* `serviceDate` before today is treated as history or past service data.
* `serviceDate` today or later is treated as planned or upcoming service data.

The boundary uses the ministry-local `America/Chicago` date.

The default service read behavior now returns past services only. Planned or upcoming services are available only when callers explicitly request them with `dateScope`.

This slice does not add a confirmation or completion workflow.

## Date Scope

`POST /services/search` now accepts:

```json
{
  "filters": {
    "dateScope": "past"
  }
}
```

Supported values:

| `dateScope` | Behavior |
| --- | --- |
| omitted | Defaults to `past` |
| `past` | Includes services with `serviceDate` before today |
| `upcoming` | Includes services with `serviceDate` today or later |
| `any` | Includes both past and upcoming services |

Invalid values are rejected with a validation error.

## Source Quality Policy

Firestore reflects the imported spreadsheet source.

If a past spreadsheet-imported service is wrong, the correction path is to fix the source/imported data. Firestore should not require a separate confirmation workflow before a past service can count as history.

The backend still returns status/source fields so callers can speak carefully about imported records:

* `planningStatus`
* `actualStatus`
* `changedAfterPlan`
* `source`
* `sourceType`
* `sourceName`
* `sourceImportId`

## Source Import Context

Service read context now supports both:

* `breezeImports`
* `sourceImports`

This keeps existing Breeze support intact while allowing spreadsheet import provenance to appear in service responses.

## Spreadsheet Song Event Fields

Returned service song rows now preserve spreadsheet planning fields where present:

* `usageRole`
* `songTitleCandidate`
* `songTitleConfidence`
* `assignedPersonOrGroupRaw`
* `detailNote`
* `sourceColumnName`
* `sourceCell`
* `planningStatus`
* `actualStatus`
* `changedAfterPlan`

This is especially important for special music and offertory-style cells, where a value may be an assignment or detail note rather than a song title.

## Verification

Focused tests cover:

* Default search returns past services and excludes today/future services.
* `dateScope: upcoming` returns today/future services.
* `dateScope: any` returns both past and upcoming services.
* Past spreadsheet-imported services can appear in history results.
* Future spreadsheet-imported services do not appear in default history results.
* Returned summaries/details include status and source fields.
* Upcoming service song events preserve special-music fields.
* Existing Breeze service-history behavior remains intact.

Read-only Firestore sanity checks also confirmed that imported future spreadsheet records are reachable with `dateScope: upcoming` and excluded from default history searches.

## Recommended Next Slice

Recommended next step: deploy and verify the date-based service read boundary, then update GPT-facing artifacts so the Custom GPT can use `dateScope` intentionally and describe planned records with planned-language only.

Do not expose planned/upcoming spreadsheet services to the live GPT until the deployed backend and GPT instructions/schema both support this boundary clearly.
