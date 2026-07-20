# Slice 7 Legacy Breeze API Boundary Discovery

Date: 2026-04-25

Slice name: Legacy Breeze API Boundary Discovery for Service/Event Import

Status: Discovery/probe only

Target service plan:

* URL: `https://faithbaptistapp.breezechms.com/events/409212043/plan`
* Event ID: `409212043`
* Service: Morning Service
* Date: April 12, 2026
* Theme: Assurance

## Current Goal

The future production system must not depend on Dan's active browser session, personal cookies, or interactive Breeze login state.

Desired production architecture:

1. ChatGPT talks only to our backend API.
2. Our backend/import job talks to Breeze using a stable automation-friendly credential.
3. Breeze data is normalized into internal collections.
4. The GPT reads normalized internal data only.

Dan has decided to skip API-v2 for now and proceed only with what can be accessed using the existing working Breeze API key and documented/legacy Breeze API behavior.

Slice 7's current question is the practical boundary of the working legacy Breeze API:

1. What event/service data can be reliably retrieved using the existing Breeze API key?
2. Can the legacy API expose or reconstruct any service-plan/order-of-service rows?
3. If not, what first import slice can still be built from the confirmed legacy API data?

## Summary Finding

The existing Breeze API key works for documented/legacy Breeze API routes. For Event ID `409212043`, the legacy API can retrieve event/service shell data, schedule-instance shell data, event detail/configuration metadata, calendars/locations, and volunteer endpoint responses.

The legacy API does not expose the visible Service Planning/order-of-service rows for the target service. No tested legacy endpoint returned the visible song titles, hymn numbers, theme, row order, sections, keys, leaders, row durations, or a generic ordered plan-row structure.

Current Slice 7 boundary:

* legacy Breeze API is usable for service/event shell import
* legacy Breeze API is not enough for song-history or service-plan-row import
* API-v2 is intentionally skipped for now
* no API-v2 credentials should be requested
* Breeze support should not be contacted for this slice
* browser sessions/cookies and PDF-first import are not production paths for this slice

Recommended next build slice based only on confirmed data: build a legacy Breeze event-shell import into normalized internal `services` and `breezeImports` records, explicitly leaving `serviceSongEvents` empty/unavailable until an approved song-row source is chosen.

## Legacy API Boundary Decision

Credentials were loaded from `~/.config/bhe-product-api/breeze.env`, outside the repo. The probe used only safe read-only documented/legacy Breeze `/api` calls with the existing Breeze API key. It printed structural summaries only: endpoint labels, HTTP status, JSON yes/no, top-level keys, nested key paths, array/object shapes, generic row/order signals, and whether allowlisted visible service-plan strings appeared. No API key, raw Breeze payload, private values, cookies, tokens, or response bodies were printed or written to disk.

API-v2 decision:

* API-v2 is intentionally skipped for now.
* The existing Breeze API key is the only current credential path.
* Do not request API-v2 credentials.
* Do not contact Breeze support.
* Do not rely on Dan's browser session, cookies, or personal login state.

Target:

* Event instance: `409212043`
* Visible page: `/events/409212043/plan`
* Known visible service plan: Morning Service, April 12, 2026, Theme: Assurance
* Expected visible plan strings checked from an allowlist: known song titles and hymn-number strings from the page/PDF sample

Endpoints tested:

| Endpoint | Status | JSON | Structural result |
| --- | ---: | --- | --- |
| `/api/events/list_event?instance_id={eventId}` | `200` | yes | single event shell object |
| `/api/events/list_event?instance_id={eventId}&details=1` | `200` | yes | event shell plus `details` configuration object |
| `/api/events/list_event?instance_id={eventId}&eligible=1` | `200` | yes | event shell plus `eligible.tags` array |
| `/api/events/list_event?instance_id={eventId}&details=1&eligible=1` | `200` | yes | event shell plus `details` and `eligible.tags` |
| `/api/events/list_event?instance_id={eventId}&schedule=1&schedule_limit=20` | `200` | yes | recurring schedule array of 14 shells with `id` and `start_datetime` |
| `/api/events/list_event?instance_id={eventId}&details=1&schedule=1&schedule_limit=20` | `200` | yes | recurring schedule array of 14 shells with event `details` configuration |
| `/api/events?start=2026-04-12&end=2026-04-12&details=1&limit=1000` | `200` | yes | event list array of 3 shell records for the date |
| `/api/events?start=2026-04-01&end=2026-04-30&details=1&limit=1000` | `200` | yes | event list array of 26 shell records for the month |
| `/api/events/calendars` | `200` | no in this probe | context endpoint, not service-plan rows |
| `/api/events/locations` | `200` | yes | location list array with `id` and `name` keys |
| `/api/volunteers/list?instance_id={eventId}` | `200` | yes | empty array |
| `/api/volunteers/list_roles?instance_id={eventId}` | `200` | yes | empty array |

What the legacy API can retrieve:

* event instance ID
* series/event ID
* event title/name
* start datetime
* end datetime
* category/calendar/settings identifiers
* created/modified shell metadata
* event/check-in configuration-style `details`
* schedule instance shells with IDs and start times
* location context
* eligibility tag structures when requested

What the legacy API cannot retrieve from the tested documented routes:

* service-plan sections
* service-plan rows/items/blocks/elements
* song/music rows
* song titles
* hymn numbers
* keys
* leaders/performers assigned to service-plan rows
* row start times
* row durations
* row order
* theme
* song usage roles

Generic row/order structure decision:

* No tested legacy response contained a generic ordered row/item/block/section structure that matched the visible service plan.
* The only arrays observed were event lists, recurring schedule shells, eligibility tags, locations, and empty volunteer arrays.
* No allowlisted visible service-plan strings appeared in the legacy API responses.
* The legacy API is not enough for song-history import.

Recommended next build slice:

* Build a legacy Breeze event-shell import only.
* Map confirmed legacy event data into normalized `services`.
* Record source/import provenance in `breezeImports`.
* Do not populate `serviceSongEvents` from legacy Breeze API data.
* Do not claim song-history import is live from Breeze until an approved service-plan row source exists.
* Keep GPT-facing service-history reads on normalized internal data only.

## Sources Inspected

Read-only sources inspected:

* official Breeze API reference at `https://app.breezechms.com/api`
* legacy Breeze Events endpoints for Event ID `409212043`
* legacy Breeze Events date-range endpoints for April 12, 2026 and April 2026
* legacy Breeze calendars and locations endpoints
* legacy Breeze volunteer and volunteer-role endpoints for Event ID `409212043`
* prior Slice 6 page/PDF observations only as a comparison target for visible service-plan rows

No API keys, cookies, session tokens, raw private payloads, or downloaded private files were stored in the repo.

## Deferred Non-Legacy Findings

Previous Slice 7 exploration showed that the Breeze web app visibly renders Service Planning rows on `/events/409212043/plan`, and earlier API-v2 probes found protected API-v2 route names related to event instances, service plans, segments, and song-library resources.

Those findings are now deferred. The current Slice 7 decision is to skip API-v2, not request API-v2 credentials, not contact Breeze support, not rely on browser session state, and not make PDF parsing the primary path.

## Questions Answered

### 1. What event/service data can we reliably retrieve using the existing Breeze API key?

Confirmed through documented/legacy Breeze API routes:

* event instance ID
* series/event ID
* event title/name
* event start datetime
* event end datetime
* category/calendar/settings identifiers
* created/modified shell metadata
* event detail/configuration metadata
* schedule-instance shells with IDs and start times
* locations
* eligibility tag structures when requested
* empty volunteer/role arrays for the target event

This is enough to build a service/event shell import, assuming the future importer can identify which Breeze events should become normalized worship services.

### 2. Can the legacy API expose or reconstruct service-plan/order-of-service rows?

Not from the documented/legacy routes tested.

The probe did not find:

* visible song titles
* hymn numbers
* theme
* service-plan sections
* row order
* row start times
* row durations
* keys
* leaders/performers
* note rows
* generic item/block/row/section structures that could reconstruct the visible service plan

The legacy API is therefore not enough for Breeze song-history import or `serviceSongEvents` population.

### 3. If not, what first import slice can still be built from confirmed legacy API data?

Recommended next build slice: legacy Breeze event-shell import.

Scope for that next slice:

* read Breeze Events using the existing API key
* select/import candidate worship service event shells
* normalize confirmed shell fields into `services`
* record import provenance and run metadata in `breezeImports`
* leave `serviceSongEvents` empty/unavailable for Breeze imports until an approved song-row source exists
* preserve current GPT behavior that service history comes only from normalized internal data

Out of scope for that next slice:

* API-v2 credential discovery
* Breeze support contact
* browser-session scraping
* PDF/download parser as the primary source path
* song-history import
* service-plan row import
* GPT-facing Breeze actions

## Mapping Implications

For a legacy API event-shell import:

* `services.serviceId`: derive from Breeze event instance ID or a stable internal prefix plus Breeze ID.
* `services.serviceDate`: derive from `start_datetime`.
* `services.serviceType`: derive conservatively from event title/name, category/calendar, or a configured mapping.
* `services.title`: derive from event title/name.
* `services.source`: mark as Breeze import/internal normalized history.
* `services.rawBreezeReference`: compact pointer such as `breeze:event-instance:{id}`.
* `breezeImports`: record import run metadata, endpoint/query provenance, source IDs, and parser/import version.
* `serviceSongEvents`: do not create from legacy API event-shell data.

The GPT should continue to read only normalized internal service-history data and should not infer songs from Breeze event shells.

## Explicit Non-Scope

No importer was built.

No browser-session scraping was built.

No production parser, database writes, GPT-facing Breeze actions, planning/recommendation logic, scheduled sync, UI/dashboard, deployment, live GPT validation, or checkpoint work is included in this slice.
