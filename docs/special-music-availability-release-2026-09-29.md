# Special-music date availability — September 29, 2026

Implemented in `64623df`; deployed as `bhe-product-api-00302-fpf` at 100% traffic
with the matching source-commit label. The existing Staff Tools gateway required
no new tool or permission: the roster operations accept the additional arguments.

The [roster contract](special-music-roster.md) defines inclusive date ranges,
open/unavailable defaults, overlap precedence, date filtering and table output.
All 715 backend tests and schema checks passed, including boundary dates, leap
days, invalid ranges, overlapping blackout precedence, tier/status enforcement,
empty in-town windows, default compatibility, and preservation on partial edits.

Dan requested the feature for everyone with availability left open. All 76
profiles were updated through the focused, idempotent, version-checked save
operation to store `defaultAvailability: available` and `availabilityWindows: []`.
Independent Firestore reads verified both fields and the expected version changes;
all prior source fields were unchanged. No dates or reasons were inferred.

A live date-aware Sunday-morning table query for October 4 returned the expected
46 Tier 3 profiles. Staff Tools discovery exposes `serviceDate`,
`includeUnavailable`, `defaultAvailability`, and `availabilityWindows` in the
relevant operation contracts. No schedule bookings or spreadsheet cells changed.

The local table snapshot was refreshed with Availability and Date windows
columns. Operational names, snapshots, and per-profile receipts remain outside
Git. Tests exercise nonempty ranges; no artificial date restrictions were inserted
into the production roster merely for testing.
