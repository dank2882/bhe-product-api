# Slice 6 Breeze API Capability Discovery

Date: 2026-04-24

Slice name: Breeze API Capability Discovery for Service History Import

Status: Discovery only

Recommendation: Breeze service-plan PDF/download artifacts appear to contain the service-song rows needed for normalized import. The exact programmatic download endpoint is still unknown, so the next slice should discover whether these PDFs can be fetched from an authenticated event/service-plan route.

## Summary Recommendation

Breeze appears to expose calendar-style event data through its public API, and Breeze support documentation confirms that Breeze Service Planning can store ordered service-plan items, including songs. However, the public API reference inspected for this slice does not expose a clear Service Planning, Worship Team, song library, set list, song usage, or service-plan item endpoint.

Dan provided a downloaded Breeze order-of-service PDF for Event ID `409212043`. That artifact contains the service title, service date/time, theme, section structure, music rows, note rows, song titles, hymn numbers, keys, leaders/performers, start times, and implied song order. This is the strongest source discovered so far for service-history song usage.

For future service-history import, the safest path is hybrid:

1. Use the Breeze API for event shells if the church's worship services are represented as Breeze Events.
2. Use Breeze service-plan PDF/download extraction for ordered song/service-plan rows if the PDF can be fetched programmatically.
3. Normalize the imported result into internal `services`, `serviceSongEvents`, and `breezeImports` records before GPT-facing service-history reads.

Do not build a full API-only importer until we confirm that song rows, order, and service-plan item details are accessible in the actual Breeze tenant. The next discovery step should focus on the authenticated PDF/download route, not on planning logic.

## Authenticated Tenant/Export Probe

Probe date: 2026-04-24

Probe status: incomplete for authenticated Breeze, useful for export-shaped service-song rows.

Read-only sources checked:

* Current shell environment for Breeze/CHMS-related variables.
* GCP Secret Manager names matching Breeze/CHMS.
* Local repo files.
* Local Downloads/Desktop/Documents files with Breeze, service-planning, worship, setlist, song-usage, CSV, or spreadsheet-like names.
* Connected Dropbox search for likely Breeze/service-planning export terms.

No Breeze API key, Breeze tenant subdomain, or Breeze/CHMS secret name was available in the current environment. No file clearly named as a Breeze Service Planning export was found in the repo, Downloads/Desktop/Documents search, or Dropbox search.

The only available file containing service-song rows was:

* `~/Downloads/Music Ministry - Master Data - PROPOSED SCHEDULES (2).csv`

Related local files also existed:

* `~/Downloads/Music Ministry - Master Data - PROPOSED SCHEDULES.csv`
* `~/Downloads/Music Ministry - Master Data - PROPOSED SCHEDULES (1).csv`
* `~/Downloads/Music Ministry - Master Data.xlsx`

These appear to be music ministry planning/master-data spreadsheets rather than Breeze exports. They are still useful because they show an export-file-shaped service-song source that can map into the existing normalized collections.

### Source Inspected

Actual inspected source: local CSV/spreadsheet export.

Actual Breeze source path: not confirmed.

Recommended source-path conclusion:

* For true Breeze import, more discovery is required. Dan should provide either authenticated Breeze API credentials for a read-only probe or a tenant-generated Breeze Service Planning export/report/print sample.
* If the local Music Ministry schedule is accepted as the source of truth for early service-song history, the next build slice should be an export-file import, not an API import.
* If future Breeze credentials prove that Events API shells can be paired with this spreadsheet/export song data, the eventual production path can become hybrid.

### Sample Shape

The inspected CSV is month-sectioned. It repeats a header row like:

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

Rows contain one service per row. `Date/Service` values use forms such as:

* `Jan 11th AM`
* `Jan 11th PM`
* `Jan 14th (Prayer Service)`
* `Jan 25th AM (Missions Conference)`

Song/usage columns are populated left to right. Some values are plain song titles, some include hymnal numbers, and some include notes or performer/context text in parentheses.

The file includes future month scaffolding with many blank rows, so an importer must skip empty service-song rows and should distinguish planned future rows from historical/importable rows.

### Fields Present in the Sample

Present or derivable:

* `theme`: from `THEME`
* service date text: from `Date/Service`
* service type text: from `Date/Service` markers such as `AM`, `PM`, or `Prayer Service`
* service title: generated from `Date/Service` or retained as the source service label
* service labels: partly derivable from parenthetical labels such as `Missions Conference`, plus theme values such as `Christmas` or `Thanksgiving`
* song title: from each populated song/usage cell, after stripping optional hymn numbers and notes
* song order / slot index: from column position, left to right
* usage role: from the column header, such as congregational, choir opener, choir special, special, or offertory
* import source metadata: file name, sheet/source label, row number, column name, import timestamp, and parser version

Present but messy:

* hymnal number: sometimes embedded in the song cell, such as `#351 ...`
* notes/context: sometimes embedded in parentheses
* performer names or groups: sometimes mixed into special/offertory cells instead of song titles

### Fields Missing From the Sample

Missing or not reliable:

* explicit year in each service row
* Breeze event ID
* Breeze service-plan ID
* Breeze service-plan item ID
* Breeze song library ID
* CCLI song ID
* stable source row ID outside file name and row number
* explicit timezone
* event start/end time
* authoritative Breeze calendar/location
* reliable distinction between actual past usage and proposed future schedule
* reliable distinction between song title and performer/person name in special/offertory columns
* direct canonical catalog `songId`

### Can We Derive the Needed Normalized Fields?

`serviceDate`: yes, if the import run supplies an explicit year and timezone. The file does not carry a year per row. The 2026 calendar pattern appears consistent with the dates in the file, but an importer should require the user/import config to provide the year instead of guessing silently.

`serviceType`: yes, with rules:

* `AM` -> likely `sunday_morning`
* `PM` -> likely `sunday_night`
* `Prayer Service` -> likely `wednesday_night`
* other parenthetical service names -> labels or special service titles

`title`: yes. Use the raw `Date/Service` value or generate a normalized title from date plus service type.

`theme`: yes, from the `THEME` column when populated.

`serviceLabels`: partly. Labels can be derived from parenthetical service text and some theme values, but this should be rule-driven and auditable.

Song title: partly. Congregational columns are likely song titles. Special, choir, and offertory columns need cleanup because some cells mix performer names, notes, and song titles.

Song order / slot index: yes, from role column order and position. The importer should preserve column order, while also retaining role.

Usage role: yes, from column header.

Import source metadata: yes, from file name, row number, column name, import run ID, and parser version. It will not include Breeze IDs unless paired with API data later.

### Mapping Recommendation

The inspected sample can map into the normalized internal model.

`breezeImports` mapping:

* one import record per uploaded/imported file
* `sourceSystem`: use `music_ministry_spreadsheet` or `breeze_export` depending on the confirmed source
* `sourceMode`: `export`
* include file name, file hash, import year, parser version, importedAt, row counts, warnings, and unmatched rows

`services` mapping:

* one normalized service row per non-empty `Date/Service` row
* `serviceDate` from parsed date plus required import year
* `serviceType` from `AM`, `PM`, or `Prayer Service`
* `title` from raw `Date/Service` or normalized service type/date
* `theme` from `THEME`
* `serviceLabels` from parenthetical labels/theme rules
* `sourceImportId` from the import run
* `rawBreezeReference` should be a file/row pointer unless a Breeze ID is later available

`serviceSongEvents` mapping:

* one row per populated song/usage cell
* `slotIndex` from column order
* `usageRole` from the column header
* `title` from cleaned cell text
* `hymnalNumber` from embedded `#NNN` values when present
* `songId` left blank/null until later matching, unless a confident catalog match is implemented in a later slice
* source metadata from file name, row number, and column name

### Visible Normalization and Matching Problems

* Some titles have typos or informal capitalization.
* Some rows include hymn numbers, while others do not.
* Some cells include notes such as parenthetical performance instructions.
* Some special/offertory cells appear to contain performer names, group names, or mixed performer/song text.
* Some labels are service labels, while others are themes.
* The year is not explicit in the row data.
* Blank future schedule rows must be ignored or treated as planned-but-empty, not imported as service history.
* The sample does not provide stable Breeze IDs, so repeated imports need file hash plus row/column source references and idempotency rules.

### Remaining Unknowns

Authenticated Breeze-specific unknowns remain:

* Whether Breeze Events API can return the exact worship event shells for the same services.
* Whether Breeze Service Planning has a tenant export/report that is cleaner than the local spreadsheet.
* Whether a Breeze Service Planning export includes plan item IDs, song library IDs, CCLI IDs, or reliable roles.
* Whether the local spreadsheet is an operational planning source, a manually maintained replacement for Breeze, or a downstream export from another workflow.
* Whether Dan wants import history from this spreadsheet source, from Breeze Service Planning, or from both.

### Recommended Next Slice After Probe

Recommended next slice: more discovery if the goal remains Breeze-specific import.

That next slice should acquire one of:

1. A read-only Breeze API key plus tenant subdomain for authenticated Events API probing.
2. A tenant-generated Breeze Service Planning export/report/print sample for one known historical service.
3. Confirmation that the local Music Ministry spreadsheet is the accepted source of truth for service-song history.

If Dan confirms the local Music Ministry spreadsheet is the accepted source, then the next build slice should be an export-file import proof of concept for that CSV/XLSX shape.

## Read-Only Tenant API Probe

Probe date: 2026-04-24

Probe status: completed from Dan's local VS Code terminal environment.

Credential handling:

* Credentials were provided only through `BREEZE_SUBDOMAIN` and `BREEZE_API_KEY`.
* No secret values were printed, logged, stored, or committed.
* The reusable local probe script prints only endpoint labels, HTTP status, JSON/shape summaries, top-level keys, and field-name signals.
* Raw response bodies, member/person data, private payload details, cookies, and API secrets are not stored in the repo.

Local environment note:

* The Codex agent shell did not inherit Dan's VS Code terminal environment, so Codex did not run authenticated requests directly.
* Dan's VS Code terminal did have the required variables and was able to run the read-only probe locally.

### Endpoints Tested

Authenticated read-only endpoints tested from Dan's local terminal:

Status code summary:

| Endpoint | Method | Status |
| --- | --- | --- |
| `/api/events` | GET | successful read-only response from tenant; numeric status not retained in repo |
| `/api/events?start={year}-01-01&end={year}-12-31&limit=5&details=1` | GET | successful read-only response from tenant; numeric status not retained in repo |
| `/api/events/calendars` | GET | successful read-only response from tenant; numeric status not retained in repo |
| `/api/events/locations` | GET | successful read-only response from tenant; numeric status not retained in repo |
| `/api/events/list_event?instance_id={event_instance_id}&schedule=1&schedule_limit=5&eligible=0` | GET | tested when an event instance ID was available; response did not prove Service Planning song-row availability |

### Response Shapes

High-level shape findings:

* Events endpoints return JSON suitable for event/service shell discovery.
* Calendar and location endpoints return JSON shell/context data.
* Event detail-style access can provide service/event context, but the observed official API shapes did not expose Service Planning song rows.
* The public docs and tenant probe did not reveal a stable official API response shape for Service Planning songs, set lists, song order, or usage roles.

### Event/Service Shell Availability

Event/service shells are available from official events-related endpoints. This confirms the Breeze API can support the service-shell side of a future import where worship services are represented as Breeze Events.

### Service Planning Song Rows, Set Lists, Song Order, and Usage Roles

The official API probe did not expose:

* Service Planning song rows
* set lists
* song order
* usage roles
* Worship Team song library usage

Those fields are visible in authenticated Service Plan pages and in the downloaded service-plan PDF artifact, but not through the official events API responses observed in this probe.

### API Sufficiency for Service-History Import

The official Breeze API appears sufficient for service/event shell metadata, but not sufficient by itself for full service-history song usage import.

Current import recommendation:

* use official Breeze API event shells where useful
* use authenticated service-plan PDF/download extraction for song rows if the download endpoint can be discovered
* use authenticated plan-page HTML extraction as the fallback if programmatic PDF download is not available

### Remaining Unknowns

* Exact authenticated service-plan PDF/download URL or route.
* Whether the PDF/download route accepts API-key auth, browser-session auth, or another authenticated route.
* Whether the event API response exposes enough identifiers to discover the service-plan download URL.
* Whether every service with song history has a service-plan PDF/download artifact.
* Whether service-plan page HTML is easier and more stable to parse than the PDF.

### Recommended Next Step for API Probe

The next slice should discover the programmatic service-plan PDF/download endpoint for a known Event ID, starting with Event ID `409212043`.

## Authenticated Service Plan Download Artifact Probe

Probe date: 2026-04-24

Source inspected:

* Downloaded Breeze order-of-service PDF.
* Event ID: `409212043`.
* Service: Morning Service.
* Date/time: April 12, 2026, 11:00 am.
* Theme: Assurance.

The PDF itself was not copied into the repo, and raw service-plan payload content was not stored. The note below records only structural findings and brief examples needed to evaluate import viability.

### Artifact Findings

The Breeze service-plan PDF contains the service-song rows needed for normalized import.

Observed top-level service fields:

* service title
* service date and start time
* duration
* theme
* event/source identifier from the download context

Observed plan structure:

* section names
* music rows
* note rows
* start times
* implied row order

Observed music-row fields:

* song title
* hymnal number when present
* key
* leader/performer or role/context when present
* usage context such as choir, congregational hymn, special, or invitation

Brief structural examples observed in the PDF:

* choir/opening music row with title and key
* congregational hymn rows with title, hymnal number, and key
* special music rows with title, leader/context, and key
* invitation row with title and key

The observed PDF includes enough structure to derive service-song rows with stable ordering for a parser proof of concept. The parser proof should still verify the extraction method because the local shell does not currently have command-line PDF text extraction tools available.

### Mapping Recommendation

The service-plan PDF can map into the current normalized model.

`services` mapping:

* `serviceId`: derive from Breeze event ID plus date/service title, or from a confirmed Breeze service-plan ID if the download route exposes one
* `serviceDate`: from PDF service date
* `serviceType`: derive from service title, event name, or configured mapping such as Morning Service -> `sunday_morning`
* `title`: from PDF service title
* `theme`: from PDF theme
* `serviceLabels`: derive from service title, theme, or configured label rules when appropriate
* `source`: `breeze_import`
* `sourceImportId`: import run ID
* `rawBreezeReference`: event/download pointer, avoiding raw payload storage
* `createdAt` and `updatedAt`: internal timestamps

`serviceSongEvents` mapping:

* `serviceSongEventId`: generated stable ID from source service reference plus row index
* `serviceId`: parent normalized service ID
* `songId`: matched later through canonical catalog/alias matching
* `hymnalNumber`: parsed from PDF row when present
* `title`: parsed source song title
* `serviceDate`: copied from parent service
* `serviceType`: copied from parent service
* `slotIndex`: implied row order from the PDF service plan
* `usageRole`: derive from row type, section, or leader/context such as choir, congregational, special, invitation, or note-derived role
* `source`: `breeze_import`
* `sourceImportId`: import run ID
* `rawBreezeReference`: compact service-plan row pointer
* `createdAt`: internal timestamp

`breezeImports` mapping:

* `importId`: generated import run ID
* `sourceSystem`: `breeze`
* `sourceMode`: `pdf_download` or `hybrid`
* `importedAt`: import timestamp
* `status`: completed, partial, or failed
* `rowCounts.services`: number of services parsed
* `rowCounts.serviceSongEvents`: number of music rows parsed
* `warnings`: missing fields, extraction anomalies, unmatched songs, or ambiguous roles
* `unmatchedSongs`: source song rows that cannot be confidently matched later
* `sourceFiles`: metadata pointer only, not raw private PDF content
* `apiEndpointsUsed`: event shell endpoint and download endpoint if programmatic fetch is confirmed

### What the PDF Proves

The PDF proves that Breeze can produce a service-plan artifact containing the core service-history song usage data needed by this project:

* service date/time
* service title/type signal
* theme
* section/order structure
* song title
* hymn number when present
* key
* leader/context when present
* implied song order
* usage-role signals

The artifact is sufficient to justify a parser proof of concept once the download/acquisition path is decided.

### What the PDF Does Not Prove

The PDF does not by itself prove:

* the exact authenticated programmatic download endpoint
* whether a stable service-plan ID is available
* whether a stable service-plan row/item ID is available
* whether the PDF can be fetched by event ID alone
* whether all service plans use the same PDF layout
* whether historical services always have populated service-plan PDFs
* whether PDF extraction will be plain-text, positional PDF parsing, or browser/HTML-derived

### Recommended Source Path

Likely future import strategy if programmatic PDF download is possible:

1. Use Breeze API event shells where useful for date, title, event ID, and calendar context.
2. Fetch the Breeze service-plan PDF/download artifact for each target event/service plan.
3. Parse the PDF/download artifact for song rows, order, keys, and usage-role signals.
4. Normalize into `services`, `serviceSongEvents`, and `breezeImports`.
5. Leave canonical song matching and unmatched-song review for later slices.

Fallback if programmatic PDF download is not possible:

1. Use authenticated plan-page HTML extraction if the service plan page exposes the same row structure.
2. If HTML extraction is also unsuitable, use manually downloaded service-plan PDFs as an export-file import source.

### Remaining Unknowns

* Exact authenticated download URL or route for service-plan PDFs.
* Whether download can be discovered from Events API, event detail, or authenticated page links.
* Whether the download route requires browser session cookies rather than API key auth.
* Whether all service-plan PDFs share the same layout and labels.
* Whether row order and section names remain stable across services.
* Whether note rows should be ignored, preserved as non-song service plan items, or used only as context.
* Whether leaders/performers should be retained in source metadata or normalized into a separate field later.

### Recommended Next Slice After PDF Probe

Recommended next slice: programmatic service-plan download endpoint discovery.

That slice should determine whether Event ID `409212043` can lead to the same PDF through a safe authenticated route. It should test only read-only access paths and should not build the importer yet.

If the PDF download route is confirmed, the following slice should be a PDF parser proof of concept. If no programmatic PDF route is available, the next best build path is an authenticated plan-page HTML parser proof of concept or a manual PDF/export-file import proof of concept.

## Sources Inspected

Official Breeze sources:

* Breeze API Reference Guide: https://app.breezechms.com/api
* Understanding Service Planning and Worship Team Tools in Breeze: https://support.breezechms.com/hc/en-us/articles/25674546533527-Understanding-Service-Planning-and-Worship-Team-Tools-in-Breeze
* Breeze for Service Planning: https://support.breezechms.com/hc/en-us/articles/21637118758551-Breeze-for-Service-Planning
* How to Use Breeze Service Planning: https://support.breezechms.com/hc/en-us/articles/17481063475735-How-to-Use-Breeze-Service-Planning

Local repo sources:

* `lib/service-history-service.js`
* `test/service-history-service.test.js`
* `docs/gpts/worship-service-slice5.workflow.md`

## Research Questions

### 1. Does Breeze provide an API endpoint or endpoint combination that exposes past services/events relevant to worship planning?

Partially.

The public Breeze API reference includes Events endpoints such as event listing, single event detail, calendars, locations, attendance, and volunteers. These can likely provide past event shells if Sunday worship services are modeled as Breeze Events.

The public API reference does not clearly expose Service Planning plans or plan items as separate API resources. Breeze support documentation says service plans are accessed from Events, but that does not prove the public API returns service-plan content.

### 2. Does Breeze expose songs attached to those services/events through the API?

Not confirmed.

Official support documentation confirms that Breeze Service Planning can add songs to events and that service-plan items can be reordered. The public API reference inspected for this slice does not show an endpoint for Service Planning songs, set lists, plan items, song library entries, or song usage history.

API-only song import should be treated as unproven until we run an authenticated tenant probe or get confirmation from Breeze support.

### 3. If songs are not directly available through API endpoints, are they available through exports/reports instead?

Not confirmed from public API documentation.

The service-planning support docs show that Breeze can print service plans and that Worship Team Tools can maintain a song library and support CCLI usage reporting. That strongly suggests there may be report/export paths in the product, but the exact downloadable/exportable fields need to be confirmed in the live tenant.

The next slice should collect one representative export, printed plan output, or report sample that includes song rows before committing to an importer shape.

### 4. What Breeze data object appears to be the authoritative source for our service-history import?

For service shell metadata, Breeze Events appear to be the most likely authoritative API object.

For song usage, order, and service-plan roles, Breeze Service Planning plan items appear to be the authoritative product object. The current public API reference does not prove that those plan items are API-readable.

Practical import model:

* Breeze Event: authoritative for date, time, event name, calendar, location, volunteer/attendance context when needed.
* Breeze Service Plan / Plan Items: authoritative for songs, item order, keys, notes, and service-plan sequence if obtainable.
* Export/report row: acceptable source for song usage if plan items are not API-accessible.

### 5. What fields can we get for each service?

Confirmed or likely from Breeze Events API:

* service date/time from event start and end fields
* service type or name from event name and/or calendar/category
* title from event name
* calendar/location context from event calendar/location endpoints
* attendance and volunteer context through related Events, Attendance, and Volunteers endpoints, if needed later
* source/import metadata from API endpoint, Breeze event IDs, and import run metadata

Confirmed in Service Planning UI/support docs, but not confirmed via public API:

* songs used
* song order
* service-plan item sections
* song title
* duration
* description/notes
* key
* attachments or links

Not confirmed:

* dedicated labels/tags for service history
* usage role such as congregational, offertory, special music, opening, closing
* stable service-plan item IDs via API
* direct CCLI song identifiers or Breeze song library IDs via API

### 6. How does Breeze authentication work?

The official API examples use a tenant subdomain base URL and an API key. Example shape:

* `https://{subdomain}.breezechms.com/api/...`
* API key supplied through the Breeze API client/wrapper examples

Future import code should treat the Breeze API key as a secret and should not expose it through GPT actions.

### 7. What rate limits apply?

A global public rate-limit value was not found in the official API reference during this discovery.

The API reference documents list endpoints with `limit` and `offset` style pagination parameters in several places. Some endpoint examples allow a high per-request `limit`, but that should not be treated as permission for aggressive import polling.

Future import code should use conservative throttling, retry with backoff for transient failures, and confirm any formal rate limits with Breeze support before scheduled automation.

### 8. What environment variables or secrets would future import code need?

Likely secrets:

* `BREEZE_API_KEY`

Likely configuration:

* `BREEZE_SUBDOMAIN` or `BREEZE_API_BASE_URL`
* `BREEZE_IMPORT_MODE` with values such as `api`, `export`, or `hybrid`
* `BREEZE_IMPORT_TIMEZONE`
* `BREEZE_SERVICE_CALENDAR_IDS` if worship services are isolated by Breeze calendar
* `BREEZE_SERVICE_EVENT_NAME_PATTERNS` if service type must be inferred from event names
* `BREEZE_SERVICE_EXPORT_BUCKET` or equivalent storage setting if export files are used

Optional future configuration:

* `BREEZE_IMPORT_DATE_FROM`
* `BREEZE_IMPORT_DATE_TO`
* `BREEZE_DRY_RUN`
* `BREEZE_SOURCE_TENANT_LABEL`

### 9. What risks or unknowns remain?

Key unknowns:

* Whether the live tenant has Service Planning enabled and consistently used for worship services.
* Whether Breeze exposes service-plan song rows through an undocumented or authenticated API path.
* Whether Service Planning print/report/export output includes stable song order and enough fields for matching.
* Whether Worship Team Tools are enabled, and whether they change song-library or usage-report availability.
* Whether service names/calendars cleanly identify Sunday morning, Sunday night, Lord's Supper, Easter, and other planning labels.
* Whether song rows include canonical titles, CCLI IDs, keys, notes, or only free text.
* Whether song order is stable and exportable.
* Whether repeated services, templates, or copied service plans create duplicate source IDs.
* Whether deleted or edited Breeze services need tombstone/update handling.
* Breeze rate limits and recommended polling cadence are not confirmed.

Implementation risks:

* A pure API importer may produce service records without songs.
* A pure export importer may require manual operational steps and stricter file validation.
* Song matching will need canonical catalog lookup plus alias support from Slice 5; it should remain a later slice.
* Import provenance must be preserved so service-history reads never depend on raw Breeze rows.

### 10. Recommended future import strategy

Recommended strategy: hybrid import.

The next slice should not jump straight to a production importer. It should first prove the source path in the live tenant:

1. Run an authenticated, read-only Breeze API probe for event shells over a small historical date range.
2. Determine whether the API response contains service-plan/song rows.
3. If song rows are absent, collect a representative Service Planning print/export/report sample for the same service.
4. Produce a final import contract showing exact input fields and how they normalize into `services`, `serviceSongEvents`, and `breezeImports`.

If the tenant/API probe reveals a stable service-plan item endpoint, the future importer can lean API-first. If not, build an export-file importer with API enrichment for event shells.

## Relevant Breeze API Findings

The official API reference lists public endpoints for People, Tags, Events, Forms, Volunteers, Families, and Account areas, with attendance and calendar functionality under Events. The service-history-relevant public area is Events.

Events API findings:

* Event endpoints can list events and retrieve event detail.
* Calendar and location endpoints exist.
* Attendance endpoints can list attendance for an event.
* Volunteer endpoints can list volunteers for a specific event instance.
* Event data appears suitable for service shell metadata if worship services are represented as Events.

Service Planning findings from official support docs:

* Service Planning is accessed from the Events area.
* Service plans can include sections and items.
* Songs are a supported service-plan item type.
* Song entries can include title, duration, description, key, attachments, and links.
* Items and sections can be reordered.
* Worship Team Tools can maintain a song library and support CCLI usage reporting.

Unconfirmed in official API docs:

* API endpoint for service plans.
* API endpoint for service-plan items.
* API endpoint for songs attached to an event.
* API endpoint for Worship Team song library.
* API endpoint for CCLI usage history or song usage rows.

## Local Repo Findings

The current Slice 4/5 read model already expects normalized internal service history, not raw Breeze data.

`lib/service-history-service.js` reads from:

* `servicesCollection`
* `serviceSongEventsCollection`
* `breezeImportsCollection`

It treats records as normalized Breeze history when `source` is `breeze_import`, `source` is `breeze`, or `sourceImportId` is present.

Current normalized service fields include:

* `serviceId`
* `serviceDate`
* `serviceType`
* `title`
* `theme`
* `source`
* `sourceImportId`
* `serviceLabels`
* `rawBreezeReference`
* `createdAt`
* `updatedAt`

Current normalized song usage fields include:

* `serviceSongEventId`
* `serviceId`
* `songId`
* `hymnalNumber`
* `title`
* `serviceDate`
* `serviceType`
* `slotIndex`
* `usageRole`
* `source`
* `sourceImportId`
* `createdAt`

Current import metadata fields include:

* `importId`
* `sourceSystem`
* `importedAt`
* `status`
* `rowCounts`
* `warnings`
* `unmatchedSongs`

This architecture is a good fit for Breeze import, as long as the future import step writes normalized records and preserves source provenance separately.

## Likely Data-Source Path

Preferred source path for future import:

1. Breeze Events API for event shells, calendars, and stable event references.
2. Breeze Service Planning plan item source for songs and order, if accessible through authenticated API.
3. Service Planning export/print/report file for song rows if the API does not expose plan items.
4. Internal normalization step into `services`, `serviceSongEvents`, and `breezeImports`.
5. Later song matching step against the canonical song catalog using `songId`, `hymnalNumber`, `canonicalTitle`, and `titleAliases`.

Do not let GPT-facing service-history actions query Breeze directly. Breeze data should land in normalized internal collections first.

## Proposed Mapping

### `breezeImports`

Map each import run to one `breezeImports` record:

* `importId`: generated internal import run ID
* `sourceSystem`: `breeze`
* `sourceMode`: `api`, `export`, or `hybrid`
* `tenantLabel`: non-secret tenant identifier, if useful
* `dateFrom`: import window start
* `dateTo`: import window end
* `importedAt`: import completion timestamp
* `status`: `completed`, `partial`, or `failed`
* `rowCounts.services`: number of service records written
* `rowCounts.serviceSongEvents`: number of song usage records written
* `warnings`: validation, missing field, duplicate, and unmatched source warnings
* `unmatchedSongs`: song rows that could not be confidently matched to canonical songs
* `sourceFiles`: export file references, if export mode is used
* `apiEndpointsUsed`: endpoint names or paths used in the run

### `services`

Map one Breeze service/event instance to one normalized service record:

* `serviceId`: generated internal stable ID, likely derived from Breeze event/instance ID plus service date/type
* `serviceDate`: date-only local service date
* `serviceType`: normalized value such as `sunday_morning`, `sunday_night`, or `wednesday_night`
* `title`: Breeze event/service-plan title
* `theme`: optional, from service-plan title/description if available
* `serviceLabels`: derived labels such as `easter` or `lords_supper` when source fields support it
* `source`: `breeze_import`
* `sourceImportId`: import run ID
* `rawBreezeReference`: compact source pointer such as `breeze:event:{id}` or `breeze:service-plan:{id}`
* `createdAt`: first internal write timestamp
* `updatedAt`: latest internal update timestamp

### `serviceSongEvents`

Map each song/service-plan row to one normalized song usage record:

* `serviceSongEventId`: generated internal stable ID
* `serviceId`: parent normalized service ID
* `songId`: matched canonical song ID, or blank/null until a later matching workflow resolves it
* `hymnalNumber`: matched hymnal number when available
* `title`: source song title as imported
* `serviceDate`: copied from parent service for query efficiency
* `serviceType`: copied from parent service for query efficiency
* `slotIndex`: service-plan order
* `usageRole`: source role/section-derived role if available
* `source`: `breeze_import`
* `sourceImportId`: import run ID
* `rawBreezeReference`: compact pointer to source plan item or export row
* `createdAt`: internal write timestamp

## Recommended Next Slice

Recommended next slice: Slice 7 authenticated Breeze source probe and sample import contract.

Slice 7 should still be discovery/proof oriented, not a full import pipeline. It should:

1. Add a small read-only probe script or documented manual probe for Breeze Events API using tenant secrets.
2. Capture sample event JSON for a small historical worship-service range.
3. Check whether service-plan songs are present anywhere in authenticated API responses.
4. Capture one representative Service Planning export, print, or report sample if API song rows are absent.
5. Produce a final source-field-to-normalized-field import contract.

After that, build either:

* an API-first importer if service-plan item rows are confirmed through API, or
* an export-file importer with optional API enrichment if song rows are only available through product exports/reports.

## Explicit Non-Scope for Slice 6

No import pipeline was designed or implemented in this slice.

No live Breeze sync was added.

No GPT-facing Breeze actions were added.

No planning, recommendation, scoring, service-history write, song matching, unmatched-song review, scheduled job, UI, deployment, live GPT validation, or checkpoint work is included here.
