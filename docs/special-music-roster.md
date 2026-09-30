# FBC special-music roster

Owner and serves: `fbc`. System of record: the existing Ministry Planning
Firestore database, collection `specialMusicProfiles`. The Google Sheet remains
the schedule. This extension adds no service, database, or authentication client.

Each stable document ID is also its `specialMusicProfileId`. Profiles contain
exact display names, an optional `groupName`, profile type, named members (optional person/Breeze IDs),
aliases, notes, status, tier, explicit `tierAvailability`, version, creation/update
timestamps, and authenticated updating subject. Supported types are individual,
group, duo, small_group, family, ensemble, choir, and school_group. Generic group
is retained for groups whose more specific category is not yet established.

`displayName` is the scheduling label; `groupName` is an optional formal name for
non-individual profiles. An unnamed duo or group keeps its member combination as
the display label and stores an empty group name. Omission on update preserves
the group name; an empty string clears it. Named families/choirs may have empty
membership when no member list was supplied. Do not invent members or expand
partial names. Keep distinct master-list entries distinct even if their known
members overlap. User-supplied TBD labels remain unresolved source text.

`accompanists` holds zero or more `{ pianistId, displayName }` references for
each soloist/group. Save using IDs from the existing `listPianists` roster; names
are resolved by the backend, and unknown/duplicate IDs are rejected. An empty
array means unassigned, not that accompaniment is unnecessary. Omit the field
to preserve assignments; send `[]` to clear them. These standing relationships
do not book a pianist for a date or replace service-specific assignments.

Use `listSpecialMusicProfiles` with `format: table` for a table containing the
scheduling label, optional group name, type, tier, service eligibility, members,
pianists, and status. Filters and pagination apply to both records and table rows.

## Date availability

Every profile supports `defaultAvailability` (`available` or `unavailable`) and
`availabilityWindows`: `{ startDate, endDate, available, reason? }` records.
Dates are valid `YYYY-MM-DD` calendar dates, inclusive at both ends, with no
time-of-day conversion. Open availability defaults to `available` and `[]`.
Missing fields on older records read with those defaults without a write.

For an absence, keep the default available and add an `available: false` range.
For someone who is only available when in town, set the default unavailable and
add `available: true` ranges. Multiple ranges are allowed. An unavailable range
wins any overlap, regardless of array order. With default unavailable and no
available windows, the profile is unavailable on every date. Date windows cannot
override an inactive profile or a service-type tier restriction.

Save through `saveSpecialMusicProfile` with the current version. Omitted fields
are preserved; supplying the window array replaces it, and `[]` clears it.
Do not invent dates or personal reasons. Availability is for this scheduling
profile; partial member names do not establish links to other profiles. These
rules do not cancel existing service bookings or change Google Sheet cells.

Pass `serviceDate` and `serviceType` to the list query for scheduling options.
Date-unavailable profiles are excluded by default. `includeUnavailable: true`
keeps them for review, still subject to the other requested filters. It requires
a service date. A get query can also evaluate a supplied date/service type.
Without a date, the roster includes all profiles matching the other filters;
it makes no date-specific availability claim. Table output includes availability
and date windows. An open date means no recorded restriction, not a booking.

Tier rules are backend-owned: 1 permits Wednesday night, 2 permits Sunday night
and Wednesday night, and 3 permits any service, including special services. Each
save regenerates the stored availability rule from the tier. Callers cannot
write a conflicting rule. Eligibility indicates permission to schedule, not
date-specific availability or a confirmed booking.

The four focused operations are `listSpecialMusicProfiles`,
`getSpecialMusicProfile`, `saveSpecialMusicProfile`, and
`archiveSpecialMusicProfile`. Listing defaults to active and supports exact tier,
type, status, and service eligibility filters. Follow every `nextCursor` using
`afterId`, even after an empty filtered page. `status: all` includes archived
records. Archive preserves the document and any future schedule references;
restoration requires an explicit save with `status: active` or `inactive`.

Create with `expectedVersion: 0`; update/archive with the freshly read version.
Writes require the trusted actor header and a top-level idempotency key. The
profile and durable receipt in the existing
`ministryPlanningOperationExecutions` collection are committed in one Firestore
transaction. A retry returns its original receipt; reuse for a different intent
fails. Receipt identity is actor-scoped. Caller-provided audit fields are rejected.
Independent get/list reads remain the verification gate after writes.

The backend catalog retains legacy operator operations for existing clients.
The MCP catalog filters those operations to its actual allowlists; broad
`mutateData` and restores remain blocked there. Both backend and MCP must ship
before the new operations work through Staff Tools. Older direct API-key Builder
clients without trusted actor propagation cannot perform roster writes.

## Import and release gates

- The September 29 master list supplies 76 profiles; keep operational names
  outside Git. Do not seed example names or infer memberships.
- Validate all records before import, resolve stable IDs, and compare any
  existing records before updates. Use a stable per-record import key.
- Read all pages with `status: all` after import and compare IDs, exact names,
  members, aliases, tiers, types, and statuses against the approved master list.
  Expected source counts: 20 individuals, 24 duos/small combinations, 32 larger
  groups/families. These reporting groups may contain multiple profile types.
- Deploy committed backend and MCP changes; verify authorized reads/writes,
  denied unauthorized access, retry behavior, and catalog discovery through a
  fresh FBC Staff Tools client.

Import through `scripts/import-special-music-profiles.mjs FILE`, then repeat with
`--commit` after the dry run. The caller supplies the existing API credential and
verified actor through environment variables; never put credentials on the command
line. This script validates all input, rejects differing existing profiles,
creates only missing records, and independently reads back every source field.
The private receipt is written next to the private input file, outside Git.

Schedule-to-roster ID assignment is a later integration. This change neither
guesses IDs from existing schedule text nor rewrites imported schedule rows.
Firestore creates the collection on the first authorized profile write; local
code and tests do not create a production collection or populate the roster.

## Last sang and rotation

`lastSangDate` stores the latest confirmed performance date as YYYY-MM-DD, or
null when not recorded. Older documents read as null without a migration write.
Save through the existing versioned, idempotent profile operation; omit to
preserve, or explicitly pass null to clear an incorrect date. Reject invalid
calendar dates and future dates using America/Los_Angeles ministry time.
Scheduling and spreadsheet imports do not automatically count as performances.
A staff-confirmed date may correct either direction; when recording an older
performance, retain the newer confirmed date unless correcting a mistake.

Use `sortBy: "lastSangDate"` on `listSpecialMusicProfiles` with service type and
date. It ranks the full eligible set before pagination: oldest known date first,
unknown dates last, profile ID breaks ties. Keep filters and sort order unchanged
when passing nextCursor as afterId. A missing cursor profile requires restarting.
The existing 5,000-record scan bound fails explicitly for rotation instead of
returning a misleading partial ranking. Default ID ordering is unchanged.

Table output includes Last sang. Unknown is not never sung, and recommendations
must identify the history gap. Each scheduling profile has its own date; member
names and overlapping groups do not silently transfer a performance. No actual
dates were supplied with the September 30 feature request, so initial values
remain unknown until confirmed. Existing schedule entries can aid review but
are not proof of a completed performance.
