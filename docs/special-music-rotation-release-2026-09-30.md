# Special-music last-sang rotation — September 30, 2026

Implemented in `355e42f` with Builder schema parity in `740a4c7`. Deployed
`740a4c7ff6183a606834f7e6a1b513f1541e4607` as
`bhe-product-api-00303-h7s`, verified at 100 percent traffic. All 717 backend
tests and required schema checks passed. Existing query/save operations and
permissions are reused; no new MCP operation enum or workspace refresh is needed.

Every roster profile now exposes nullable `lastSangDate`, and table output adds
Last sang. The list operation supports oldest-first rotation across the full
eligible roster before pagination, with unknown dates last and clearly labeled.
Tests cover date validation, future-date rejection in ministry time, preservation,
clearing, pagination past 200 records, status/tier/date restrictions, and stale
rotation cursors. Runtime guidance was synchronized and read back as config
`1-2ec545988796`, catalog `1-12cfd9a6faca`.

Dan directed use of the existing spreadsheet for history. Read the live 2026
PROPOSED SCHEDULES tab, then saved 29 clearly identifiable past dates through
versioned, idempotent profile saves. Each note retains the sheet ID, exact cell,
date and original cell text. Did not infer dates for ambiguous profile identities,
copy group activity onto solo profiles, change tiers/status/names, or count the
September 30 evening booking as already performed. No spreadsheet cells changed.
Operational names and source snapshots remain outside Git.

Independent connected-tool read-back returned all 76 profiles: 29 dates recorded,
47 unknown, including two archived profiles. Request:
`8d90927a-33df-441b-8cb4-693298a2a1eb`. A date-specific Wednesday query for October
7 returned 73 active, eligible, available profiles in rotation order, request
`968bc52f-01f1-4c91-bc62-9e37dd08c950`. The table snapshot was refreshed.

This is a starting history from past schedule entries accepted as the source by
Dan, not an independently audited performance log. Staff must record subsequent
actual performances, review unknown history, and check upcoming bookings before
scheduling. There is no automatic completion or alias/member propagation.
Andy and Shawna's individual sessions were not used for acceptance.
