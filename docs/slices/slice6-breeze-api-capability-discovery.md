# Slice 6 Breeze API Capability Discovery

Date: 2026-04-24

Slice name: Breeze API Capability Discovery for Service History Import

Status: Discovery only

Recommendation: The authenticated Breeze Service Plan page at `/events/409212043/plan` visibly contains the order-of-service rows needed for normalized import. The initial read-only API probe returned event-shaped data but did not identify clearly recognizable Service Planning song/setlist fields; this does not prove those rows are absent from Breeze's backend or unreachable by authenticated web routes. The next slice should discover how the authenticated plan page source gets those rows.

## Summary Recommendation

Breeze appears to expose calendar-style event data through its public API, and Breeze support documentation confirms that Breeze Service Planning can store ordered service-plan items, including songs. However, the public API reference inspected for this slice does not expose a clear Service Planning, Worship Team, song library, set list, song usage, or service-plan item endpoint.

The authenticated Service Plan page at `/events/409212043/plan` visibly renders structured order-of-service rows, including sections, music items, note items, song titles, hymn numbers, keys, leaders, start times, and order. This proves the data exists somewhere in Breeze's authenticated service-plan source path.

Dan also provided a downloaded Breeze order-of-service PDF for Event ID `409212043`. That artifact is useful evidence that the visible service-plan data can be exported, but it should not make PDF download/parsing the preferred next path if the page source, embedded data, or internal web route can be accessed directly.

For future service-history import, the safest path is hybrid:

1. Use the Breeze API for event shells if the church's worship services are represented as Breeze Events.
2. Use authenticated service-plan page source, embedded data, internal web routes, or generic plan/schedule item structures for ordered song/service-plan rows if accessible.
3. Use service-plan PDF/download extraction only as a fallback if the direct authenticated page source path is not viable.
4. Normalize the imported result into internal `services`, `serviceSongEvents`, and `breezeImports` records before GPT-facing service-history reads.

Do not build a full API-only importer until we understand where the visible plan rows are loaded from. The next discovery step should focus on authenticated service-plan page source discovery, not PDF parsing and not planning logic.

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

This early spreadsheet probe is superseded by later authenticated Breeze findings. The current next slice recommendation is Slice 7 - Authenticated Breeze Service Plan Page Source Discovery.

If Dan later decides the local Music Ministry spreadsheet should also be imported as a separate historical source, that should be a separate export-file import proof of concept.

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
| `/api/events/list_event?instance_id={event_instance_id}&schedule=1&schedule_limit=5&eligible=0` | GET | tested when an event instance ID was available; response did not identify clearly recognizable Service Planning song/setlist fields |

### Response Shapes

High-level shape findings:

* Events endpoints return JSON suitable for event/service shell discovery.
* Calendar and location endpoints return JSON shell/context data.
* Event detail-style access can provide service/event context, but the observed official API shapes did not identify clearly recognizable Service Planning song/setlist fields.
* The public docs and tenant probe did not reveal a stable official API response shape explicitly named around Service Planning songs, set lists, song order, or usage roles.
* This does not prove service-plan rows are absent from Breeze's backend or unreachable by authenticated web routes. They may be stored as generic plan items, schedule items, details, blocks, or nested metadata rather than fields named `songs`, `setlist`, or `usage`.

### Event/Service Shell Availability

Event/service shells are available from official events-related endpoints. This confirms the Breeze API can support the service-shell side of a future import where worship services are represented as Breeze Events.

### Service Planning Song Rows, Set Lists, Song Order, and Usage Roles

The official API probe did not identify clearly recognizable fields named around:

* Service Planning song rows
* set lists
* song order
* usage roles
* Worship Team song library usage

The authenticated Service Plan page at `/events/409212043/plan` visibly renders these rows, and the downloaded service-plan PDF artifact preserves them. Therefore the data exists in Breeze's authenticated service-plan path even though the initial official API probe did not identify it by obvious field names.

### API Sufficiency for Service-History Import

The official Breeze API appears sufficient for service/event shell metadata. The initial probe is not sufficient by itself to confirm the service-song row source.

Current import recommendation:

* use official Breeze API event shells where useful
* investigate the authenticated Service Plan page source at `/events/{eventId}/plan`
* prefer direct page HTML, embedded page data, internal AJAX/web routes, or generic plan/schedule item structures for song rows if they are accessible
* keep PDF/download extraction as evidence and fallback, not as the preferred first build path

### Remaining Unknowns

* Whether the `/events/{eventId}/plan` rows are present in fetched HTML.
* Whether separate internal requests load the plan rows after the page shell renders.
* Whether row data is stored generically rather than as `song` fields.
* Whether row order, music/note row type, hymn numbers, keys, leaders, times, and sections can be extracted reliably.
* What authentication/session method is required for page source and internal routes.
* Risks of relying on authenticated Breeze web routes rather than documented public API endpoints.

### Recommended Next Step for API Probe

The next slice should discover the authenticated Service Plan page source for a known Event ID, starting with Event ID `409212043` and `/events/409212043/plan`.

## Authenticated Service Plan Page and Download Artifact Probe

Probe date: 2026-04-24

Sources inspected:

* Authenticated Breeze Service Plan page at `/events/409212043/plan`.
* Downloaded Breeze order-of-service PDF.
* Event ID: `409212043`.
* Service: Morning Service.
* Date/time: April 12, 2026, 11:00 am.
* Theme: Assurance.

The PDF itself was not copied into the repo, and raw service-plan payload content was not stored. The note below records only structural findings and brief examples needed to evaluate import viability.

The authenticated Service Plan page visibly renders structured order-of-service rows. This is the key source-path observation: the row data exists somewhere behind Breeze's authenticated service-plan page, even if the initial read-only API probe did not show obvious `song` or `setlist` fields.

### Artifact Findings

The authenticated Service Plan page and downloaded PDF artifact contain the service-song rows needed for normalized import.

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

The observed page/PDF content includes enough structure to derive service-song rows with stable ordering for a future proof of concept. The next proof should investigate the authenticated page source and any internal data-loading routes before attempting PDF parsing.

### Mapping Recommendation

The authenticated service-plan page data can map into the current normalized model. The PDF confirms the same visible structure can be exported, but PDF parsing should be treated as fallback unless the page source path proves unavailable.

`services` mapping:

* `serviceId`: derive from Breeze event ID plus date/service title, or from a confirmed Breeze service-plan ID if the page source exposes one
* `serviceDate`: from service-plan page/PDF service date
* `serviceType`: derive from service title, event name, or configured mapping such as Morning Service -> `sunday_morning`
* `title`: from service-plan title
* `theme`: from service-plan theme
* `serviceLabels`: derive from service title, theme, or configured label rules when appropriate
* `source`: `breeze_import`
* `sourceImportId`: import run ID
* `rawBreezeReference`: event/page/source pointer, avoiding raw payload storage
* `createdAt` and `updatedAt`: internal timestamps

`serviceSongEvents` mapping:

* `serviceSongEventId`: generated stable ID from source service reference plus row index
* `serviceId`: parent normalized service ID
* `songId`: matched later through canonical catalog/alias matching
* `hymnalNumber`: parsed from service-plan row when present
* `title`: parsed source song title
* `serviceDate`: copied from parent service
* `serviceType`: copied from parent service
* `slotIndex`: implied row order from the service plan
* `usageRole`: derive from row type, section, or leader/context such as choir, congregational, special, invitation, or note-derived role
* `source`: `breeze_import`
* `sourceImportId`: import run ID
* `rawBreezeReference`: compact service-plan row pointer
* `createdAt`: internal timestamp

`breezeImports` mapping:

* `importId`: generated import run ID
* `sourceSystem`: `breeze`
* `sourceMode`: `service_plan_page`, `internal_route`, `pdf_download`, or `hybrid`
* `importedAt`: import timestamp
* `status`: completed, partial, or failed
* `rowCounts.services`: number of services parsed
* `rowCounts.serviceSongEvents`: number of music rows parsed
* `warnings`: missing fields, extraction anomalies, unmatched songs, or ambiguous roles
* `unmatchedSongs`: source song rows that cannot be confidently matched later
* `sourceFiles`: metadata pointer only, not raw private PDF content
* `apiEndpointsUsed`: event shell endpoint plus page/internal/download route if programmatic access is confirmed

### What the Page and PDF Prove

The authenticated Service Plan page proves that Breeze renders the core service-history song usage data needed by this project. The PDF proves that the visible page data can also be exported as an order-of-service artifact.

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

The page/artifact evidence is sufficient to justify a source discovery proof of concept for `/events/{eventId}/plan`.

### What the Page and PDF Do Not Prove

The page/PDF observation does not by itself prove:

* the exact authenticated programmatic source route
* whether a stable service-plan ID is available
* whether a stable service-plan row/item ID is available
* whether rows are present directly in fetched HTML
* whether rows are loaded by internal AJAX/web requests
* whether row data is stored as generic plan items, schedule items, details, blocks, or nested metadata
* whether browser-session authentication is required
* whether all service plans use the same page structure
* whether all historical services have populated service-plan rows

### Recommended Source Path

Likely future import strategy if the authenticated page source path is accessible:

1. Use Breeze API event shells where useful for date, title, event ID, and calendar context.
2. Fetch or inspect the authenticated Service Plan page at `/events/{eventId}/plan`.
3. Prefer page HTML, embedded page data, internal AJAX/web routes, or generic plan/schedule item structures for song rows, order, keys, and usage-role signals.
4. Normalize into `services`, `serviceSongEvents`, and `breezeImports`.
5. Leave canonical song matching and unmatched-song review for later slices.

Fallback if the authenticated page source path is not viable:

1. Discover whether a programmatic PDF/download route exists for the same service-plan data.
2. If automated download is unsuitable, use manually downloaded service-plan PDFs as an export-file import source.

### Remaining Unknowns

* Whether the plan rows are present in fetched HTML.
* Whether separate internal requests load the rows.
* Whether row data is stored generically rather than as `song` fields.
* Whether row order can be derived from page/internal route structure.
* Whether music rows can be distinguished from note rows.
* Whether hymn numbers, keys, leaders, times, and sections can be extracted.
* What authentication/session method is required.
* Risks of relying on authenticated Breeze web routes.
* Whether row order and section names remain stable across services.
* Whether note rows should be ignored, preserved as non-song service plan items, or used only as context.
* Whether leaders/performers should be retained in source metadata or normalized into a separate field later.

### Recommended Next Slice After Page/PDF Probe

Recommended next slice: Slice 7 - Authenticated Breeze Service Plan Page Source Discovery.

Goal: determine whether the visible order-of-service rows on `/events/{eventId}/plan` can be retrieved programmatically from the authenticated HTML response, embedded page data, an internal AJAX/web route, a generic plan-item/schedule-item structure, or another repeatable authenticated route.

For Event ID `409212043`, Slice 7 should inspect whether:

* plan rows are present in fetched HTML
* separate internal requests load the rows
* row data is stored generically rather than as `song` fields
* row order can be derived
* music rows can be distinguished from note rows
* hymn numbers, keys, leaders, times, and sections can be extracted
* the required authentication is API-key based, browser-session based, or another authenticated method
* authenticated Breeze web routes are stable enough to support import

Do not build the importer in Slice 7. Do not build PDF parsing unless page/internal route discovery fails and Dan explicitly chooses the PDF fallback path.

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

Official support documentation confirms that Breeze Service Planning can add songs to events and that service-plan items can be reordered. The public API reference inspected for this slice does not show an endpoint explicitly named for Service Planning songs, set lists, plan items, song library entries, or song usage history.

The initial read-only tenant API probe returned event-shaped data but did not identify clearly recognizable Service Planning song/setlist fields. That does not prove the rows are absent from Breeze's backend or unreachable by authenticated web routes. They may be stored as generic plan items, schedule items, details, blocks, or nested metadata rather than fields named `songs`, `setlist`, or `usage`.

The authenticated Service Plan page at `/events/409212043/plan` visibly renders service-song rows, so the next question is where that page source gets them.

### 3. If songs are not directly available through API endpoints, are they available through exports/reports instead?

Available in the authenticated Service Plan page and PDF artifact; direct API/export path still not fully characterized.

The service-planning support docs show that Breeze can print service plans and that Worship Team Tools can maintain a song library and support CCLI usage reporting. Dan's authenticated Service Plan page and downloaded PDF sample confirm that the order-of-service data is available through Breeze's authenticated service-plan path.

The next slice should inspect the authenticated `/events/{eventId}/plan` page source and related internal requests before treating PDF/export parsing as the main path.

### 4. What Breeze data object appears to be the authoritative source for our service-history import?

For service shell metadata, Breeze Events appear to be the most likely authoritative API object.

For song usage, order, and service-plan roles, Breeze Service Planning plan rows/items appear to be the authoritative product object. The current public API reference does not prove that those rows are API-readable through official public endpoints, but the authenticated plan page proves they exist in Breeze's authenticated service-plan source path.

Practical import model:

* Breeze Event: authoritative for date, time, event name, calendar, location, volunteer/attendance context when needed.
* Breeze Service Plan page/plan items: authoritative for songs, item order, keys, notes, and service-plan sequence if obtainable.
* Export/PDF/report row: fallback source for song usage if page source/internal routes are not accessible.

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
* Whether the visible `/events/{eventId}/plan` rows are present in fetched HTML, embedded page data, internal AJAX/web routes, or generic plan/schedule item structures.
* Whether Service Planning page/PDF/export output includes stable row order and enough fields for matching across many services.
* Whether Worship Team Tools are enabled, and whether they change song-library or usage-report availability.
* Whether service names/calendars cleanly identify Sunday morning, Sunday night, Lord's Supper, Easter, and other planning labels.
* Whether song rows include canonical titles, CCLI IDs, keys, notes, or only free text.
* Whether song order is stable and extractable across authenticated page, internal route, and fallback artifact paths.
* Whether repeated services, templates, or copied service plans create duplicate source IDs.
* Whether deleted or edited Breeze services need tombstone/update handling.
* Breeze rate limits and recommended polling cadence are not confirmed.

Implementation risks:

* A pure official-API importer may produce service records without songs if it only uses events-related endpoints.
* A PDF-first importer may do unnecessary work if the authenticated page source or internal routes expose cleaner structured data.
* Authenticated Breeze web routes may be less stable than official API endpoints and may require browser-session authentication.
* Song matching will need canonical catalog lookup plus alias support from Slice 5; it should remain a later slice.
* Import provenance must be preserved so service-history reads never depend on raw Breeze rows.

### 10. Recommended future import strategy

Recommended strategy: hybrid import, with authenticated service-plan page source discovery next.

The next slice should not jump straight to a production importer. It should first prove the source path behind the visible Service Plan page in the live tenant:

1. Inspect `/events/409212043/plan` through a safe authenticated route.
2. Determine whether plan rows are present in fetched HTML, embedded page data, internal AJAX/web routes, generic plan-item/schedule-item structures, or another repeatable authenticated source.
3. Verify row order, music-vs-note row type, hymn numbers, keys, leaders, times, and sections.
4. Record the authentication/session method and risks of relying on authenticated Breeze web routes.
5. Produce a final source-field-to-normalized-field import contract.

If the page source/internal route reveals stable service-plan item structures, the future importer can use API/event shells plus authenticated page/internal route extraction. If not, PDF/download extraction remains a fallback.

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
2. Authenticated Breeze Service Plan page source, embedded page data, internal web route, or generic plan/schedule item source for songs and order.
3. Service Plan PDF/download artifact only as fallback if the direct page/internal route path is not viable.
4. Internal normalization step into `services`, `serviceSongEvents`, and `breezeImports`.
5. Later song matching step against the canonical song catalog using `songId`, `hymnalNumber`, `canonicalTitle`, and `titleAliases`.

Do not let GPT-facing service-history actions query Breeze directly. Breeze data should land in normalized internal collections first.

## Proposed Mapping

### `breezeImports`

Map each import run to one `breezeImports` record:

* `importId`: generated internal import run ID
* `sourceSystem`: `breeze`
* `sourceMode`: `api`, `service_plan_page`, `internal_route`, `pdf_download`, `export`, or `hybrid`
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

Recommended next slice: Slice 7 - Authenticated Breeze Service Plan Page Source Discovery.

Goal: determine whether the visible order-of-service rows on `/events/{eventId}/plan` can be retrieved programmatically from the authenticated HTML response, embedded page data, an internal AJAX/web route, a generic plan-item/schedule-item structure, or another repeatable authenticated route.

Slice 7 should still be discovery/proof oriented, not a full import pipeline. For Event ID `409212043`, it should:

1. Inspect whether plan rows are present in fetched HTML.
2. Inspect whether separate internal requests load the rows.
3. Determine whether row data is stored generically rather than as `song` fields.
4. Verify whether row order can be derived.
5. Verify whether music rows can be distinguished from note rows.
6. Verify whether hymn numbers, keys, leaders, times, and sections can be extracted.
7. Identify what authentication/session method would be required.
8. Record risks of relying on authenticated Breeze web routes.

After that, choose a build slice:

* hybrid import proof of concept if page/internal route extraction is repeatable
* authenticated plan-page HTML parser proof of concept if row data is in server-rendered HTML
* PDF parser proof of concept only if page/internal route extraction is not viable and Dan approves the fallback

## Explicit Non-Scope for Slice 6

No import pipeline was designed or implemented in this slice.

No live Breeze sync was added.

No GPT-facing Breeze actions were added.

No planning, recommendation, scoring, service-history write, song matching, unmatched-song review, scheduled job, UI, deployment, live GPT validation, or checkpoint work is included here.
