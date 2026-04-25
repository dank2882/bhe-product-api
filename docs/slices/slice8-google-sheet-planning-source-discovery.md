# Slice 8 Google Sheet Planning Source Discovery

Date: 2026-04-25

Slice name: Google Sheet Planning Source Discovery

Status: Discovery only

Source inspected:

* Local workbook export: `/Users/danielkirchner/Downloads/Music Ministry - Master Data.xlsx`
* File size: 26,603 bytes
* File modified time: January 14, 2026, 1:59:49 PM
* SHA-256: `bf3ca27bb9e45a116a8bd622639d3c6a89c46007e2e186cd20922f9949e6ff4c`

The workbook was inspected read-only. The spreadsheet was not modified, copied into the repo, or imported into Firestore.

## Summary Recommendation

The Music Ministry planning workbook can serve as a practical planning source for service-song planning rows. The primary importable sheet is `PROPOSED SCHEDULES`.

Recommended next build slice: create a spreadsheet planning import proof of concept that reads `PROPOSED SCHEDULES`, normalizes service rows into `services`, normalizes planned music slots into `serviceSongEvents`, and records source provenance in a generic `sourceImports` collection. It should not treat planned rows as confirmed history.

Important boundary:

* This source is forward-looking planning data.
* Do not assume a planned song was actually sung.
* Import status should default to `planned`.
* A later confirmation workflow or post-service review should promote rows to `completed` or mark them changed/canceled.

## Workbook Inventory

Actual sheets found:

| Sheet | Rows x columns observed | Role | Import recommendation |
| --- | ---: | --- | --- |
| `PROPOSED SCHEDULES` | 203 x 27 | Primary planning grid | Import service rows and planned music slots |
| `THEMES` | 73 x 1 | Theme vocabulary/reference | Use as optional controlled theme list |
| `CONGREGATIONALS` | 31 x 26 | Congregational planning helper/partial duplicate | Do not import separately unless explicitly chosen |
| `SPECIALS` | 21 x 3 | Soloist/duet reference and service availability | Reference only, not service-history rows |
| `CHOIR` | 129 x 8 | Choir song repertoire/category reference | Reference/catalog metadata candidate, not service rows |
| `SUGGESTED GROUPS TO START` | empty | Placeholder | No import |

The expected `SCHEDULE ROTATIONS` tab was not present in this workbook export.

## Sheet Findings

### `PROPOSED SCHEDULES`

Purpose:

* Main shared planning grid for services and music assignments.
* Organized by month sections.
* Rows represent planned service occurrences.
* Columns represent planned music slots.

Sheet type:

* Source sheet for planned service-song data.
* Forward-looking planning source, with some rows now in the past depending on import date.

Observed columns:

* `THEME`
* `Date/Service`
* `Congregational #1`
* `Congregational #2`
* `Congregational #3`
* `Choir Opener`
* `Choir Special`
* `Special #1`
* `Special #2`
* `Offertory`

Observed structure:

* Month header rows such as `January`, `February`, `March`, etc.
* Repeated column header rows under each month.
* Service rows such as AM, PM, Prayer Service, Missions Conference, Missions Banquet, and Lord's Supper-adjacent entries.
* January through March contain many populated planning rows.
* April through October mostly contain dated service rows with many blank music slots.
* November and December contain theme placeholders such as Thanksgiving, Christmas, and Revival.

Contains:

* service dates: yes, inside text such as `Jan 11th AM`, `February 1st PM`, `March 4th (Prayer Service)`, `April 12th AM`
* service types: yes, embedded in `Date/Service`
* song titles: yes
* hymn numbers: yes, sometimes embedded with `#`, such as `#79 To God Be the Glory`
* themes: yes, in `THEME`
* choir planning: yes, `Choir Opener` and `Choir Special`
* special music planning: yes, `Special #1`, `Special #2`, and `Offertory`
* exact service start times: no
* exact item start times: no
* exact item durations: no
* actual completion confirmation: no

Import suitability:

* Strong source for planned `services`.
* Strong source for planned `serviceSongEvents`.
* Not sufficient by itself for confirmed historical usage.

### `THEMES`

Purpose:

* Reference list of ministry planning themes.

Sheet type:

* Reference vocabulary.

Observed fields:

* Single-column theme names.

Contains:

* service dates: no
* service types: no
* song titles: no
* hymn numbers: no
* themes: yes

Import suitability:

* Use as optional validation/normalization source for `services.theme` or `serviceLabels`.
* Do not import as service history.

### `CONGREGATIONALS`

Purpose:

* Congregational-song planning helper.
* Appears to duplicate or subset the congregational columns from `PROPOSED SCHEDULES`.

Sheet type:

* Planning helper or older source sheet.

Observed columns:

* `Date/Service`
* `Congregational #1`
* `Congregational #2`
* `Congregational #3`
* `Theme` appears in later rows

Contains:

* service dates: yes
* service types: yes
* song titles: yes
* hymn numbers: not clearly in the inspected populated rows, but possible by free text
* themes: yes, in later rows
* choir/special music planning: no

Import suitability:

* Do not import separately by default because it overlaps `PROPOSED SCHEDULES` and would create duplicate service/song rows.
* Could be used as a fallback if `PROPOSED SCHEDULES` is unavailable or if Dan designates it as authoritative for congregational slots.

### `SPECIALS`

Purpose:

* Roster/reference for soloists and duets with service availability notes.

Sheet type:

* Reference/rotation helper.

Observed columns:

* `SOLOISTS`
* `Service`
* `DUETS`

Contains:

* service dates: no
* service types: yes, as availability labels such as AM, PM, Wed
* song titles: generally no
* hymn numbers: no
* choir/special planning: people/group reference only

Import suitability:

* Not a service-history source.
* Could later support people/group metadata, rotation planning, or validation for special-music assignments.

### `CHOIR`

Purpose:

* Choir repertoire and category/reference list.

Sheet type:

* Reference/catalog helper.

Observed columns:

* `ALL CHOIR SONGS`
* `EASY CHOIR SONGS (little to no practice)`
* `HYMN OPENERS`
* `UNFAMILIAR/UNKNOWN SONGS`
* `SLOWER/MEDITATIVE SONGS`
* `CHRISTMAS`
* `EASTER`
* `PATRIOTIC`

Contains:

* service dates: no
* service types: no
* song titles: yes
* hymn numbers: occasionally embedded in notes
* themes/categories: yes, as column categories
* choir planning: repertoire/reference only

Import suitability:

* Not a service-history source.
* Could later inform canonical song catalog metadata, choir repertoire tags, seasonal tags, or readiness notes.
* Keep out of the first planning importer unless explicitly included as catalog enrichment.

### `SUGGESTED GROUPS TO START`

Purpose:

* Empty placeholder.

Import suitability:

* No import.

## Source-of-Truth Model

Recommended source of truth for Slice 8 planning import:

1. `PROPOSED SCHEDULES` is authoritative for planned service music rows.
2. `THEMES` is an optional reference vocabulary.
3. `CONGREGATIONALS` is a duplicate/helper and should not be imported by default.
4. `SPECIALS` and `CHOIR` are reference/helper sheets, not service occurrence sources.

The importer should treat this workbook as a planning source, not as completed service history.

## Proposed Firestore Mapping

### `services`

Create one service record per non-header service row in `PROPOSED SCHEDULES`.

Suggested fields:

* `serviceId`: stable generated ID from source spreadsheet, sheet name, planning year, and row number
* `serviceDate`: parsed from `Date/Service` plus configured planning year
* `serviceType`: parsed from `Date/Service`, such as `sunday_morning`, `sunday_evening`, `prayer_service`, `conference`, or `special_event`
* `title`: normalized human title, such as `Morning Service`, `Evening Service`, `Prayer Service`, or event-specific text
* `theme`: value from `THEME`
* `serviceLabels`: derived labels such as `AM`, `PM`, `Prayer Service`, `Missions Conference`, `Christmas`, `Revival`
* `planningStatus`: default `planned`
* `sourceType`: `google_sheet`
* `sourceImportId`: pointer to a generic import-run record
* `sourceSheetName`: `PROPOSED SCHEDULES`
* `sourceRowNumber`: workbook row number
* `rawSourceReference`: compact non-private pointer, such as `xlsx:Music Ministry - Master Data.xlsx:PROPOSED SCHEDULES:58`

### `serviceSongEvents`

Create one planned event per populated music slot in a service row.

Suggested slot mapping:

| Column | Suggested role | Suggested slot order |
| --- | --- | ---: |
| `Congregational #1` | `congregational` | 10 |
| `Congregational #2` | `congregational` | 20 |
| `Congregational #3` | `congregational` | 30 |
| `Choir Opener` | `choir_opener` | 40 |
| `Choir Special` | `choir_special` | 50 |
| `Special #1` | `special_music` | 60 |
| `Special #2` | `special_music` | 70 |
| `Offertory` | `offertory` | 80 |

Suggested fields:

* `serviceSongEventId`: stable generated ID from service source row plus column key
* `serviceId`: parent normalized service record
* `songId`: nullable until catalog matching succeeds
* `songTitleRaw`: raw cell text
* `hymnalNumber`: parsed when present, such as `#381`
* `usageRole`: derived from column
* `slotIndex`: derived from column order
* `plannedSequence`: derived from column order
* `assignedPersonOrGroupRaw`: for special/offertory columns when cell text appears to name performers
* `planningStatus`: default `planned`
* `sourceType`: `google_sheet`
* `sourceSheetName`: `PROPOSED SCHEDULES`
* `sourceRowNumber`: workbook row number
* `sourceColumnName`: original column header
* `sourceImportId`: pointer to generic import-run record

Parsing caution:

* Congregational and choir columns usually contain song titles.
* Special/offertory columns often contain person/group names and may optionally include a song title in parentheses.
* Do not force every special/offertory value into a canonical song match.
* Preserve raw text even when the cell cannot be confidently split into performer and song title.

## Generic Import Provenance

Recommendation: introduce a generic `sourceImports` collection and keep `breezeImports` either as a legacy/backward-compatible source-specific collection or migrate future imports to the generic pattern.

Reason:

* Slice 4/5 service-history code currently knows about normalized Breeze history.
* Slice 8 introduces a non-Breeze planning source.
* A generic import-run model avoids creating one provenance collection per source.

Suggested `sourceImports` fields:

* `sourceImportId`
* `sourceType`: `google_sheet`, `xlsx_upload`, `breeze_legacy_api`, etc.
* `sourceName`
* `sourceSpreadsheetId`: for live Google Sheets
* `sourceWorkbookName`: for uploaded/exported XLSX files
* `sourceFileHash`: for XLSX imports
* `sourceSheetName`
* `sourceImportedAt`
* `sourceVersion`
* `parserVersion`
* `importMode`: `dry_run`, `preview`, `commit`
* `importStatus`: `succeeded`, `partial`, `failed`
* `rowCount`
* `createdServiceCount`
* `createdServiceSongEventCount`
* `warnings`

Row-level provenance should be stored on normalized records:

* `sourceType`
* `sourceImportId`
* `sourceSpreadsheetId`
* `sourceSheetName`
* `sourceRowNumber`
* `sourceColumnName`
* `sourceImportedAt`
* `sourceVersion`

## Planning Status Model

Recommended status fields:

* `planningStatus`: planning lifecycle state for spreadsheet-derived data
* `actualStatus`: optional later lifecycle state for post-service confirmation
* `changedAfterPlan`: boolean
* `confirmedAt`: timestamp when a human confirms actual usage
* `completedAt`: timestamp when a service is marked completed

Suggested status values:

* `planned`: imported from spreadsheet planning source, not yet verified
* `confirmed`: reviewed and confirmed as intended plan before service
* `completed`: confirmed after service as actually used/sung
* `changed`: known to differ from the spreadsheet plan
* `canceled`: service or item canceled
* `unknown`: imported row cannot be interpreted confidently

Default for spreadsheet imports:

* `services.planningStatus = planned`
* `serviceSongEvents.planningStatus = planned`
* `serviceSongEvents.actualStatus = unknown`
* `changedAfterPlan = false`

Do not use spreadsheet rows alone to answer "what was actually sung" unless the record has been confirmed/completed.

## Risks and Unknowns

* The workbook has implicit year information. The inspected dates align with 2026, but import code should require a configured planning year or explicit sheet metadata.
* Date/service values are free text and require robust parsing for AM, PM, Prayer Service, conferences, banquets, and typo variants.
* Month/header rows must be skipped.
* Blank future rows should create service shells only if Dan wants empty planned services imported.
* Special/offertory cells may mix performer names and song titles.
* Hymn numbers are embedded inconsistently, commonly as `#123`.
* `PROPOSED SCHEDULES` and `CONGREGATIONALS` overlap, so importing both would duplicate data.
* The local file is an XLSX export. A future live Google Sheets integration will need spreadsheet ID, tab IDs, range strategy, and auth.
* Planned rows may change after import, so idempotency and update detection are required.

## Recommended Next Slice

Recommended next slice: Spreadsheet Planning Import Preview.

Goal:

1. Build a read-only parser/preview for `PROPOSED SCHEDULES`.
2. Parse service rows, dates, service types, themes, and planned music slots.
3. Produce a dry-run summary of services and planned `serviceSongEvents`.
4. Include row/column provenance and warnings.
5. Do not write to Firestore until Dan reviews the preview output.

Do not update GPT artifacts or claim live planning/history import until normalized records are actually written and validated in a later slice.

