# FBC Missions roster within Ministry Overview

Accepted by Dan October 6, 2026 through explicit implementation of the reviewed
plan. Registry decision: `fbc-missions-roster-20261006`.

## Ownership and scope

FBC owns the missions recipients and monthly USD support commitments. Extend
existing Ministry Overview, core Firestore/API and both existing gateways.
No new service, database, OAuth application, dashboard or autonomous process.
GO Missions remains a separate organization and ministry profile. Official
accounting owns payments; forecast integration is deferred. Import does not
create tasks, payments, forecasts, messages or access grants.

Initial access is Dan-only, enforced against the authenticated primary subject,
not aliases, staff roles or inherited ministry grants. The roster lives beneath
its FBC ministry at `fbcMinistryRecords/{ministryId}/missions/roster`, separate
from ordinary ministry profile fields and history. Thus ordinary profile,
picture, review, history and linked-matter reads do not expose roster content.

## Records and contracts

A bounded aggregate holds recipients, their stable support identities and import
source IDs. Each recipient has name, category, location, affiliation, director,
distributor, exact source row and clarification questions. Support has integer
USD cents or null, monthly frequency, active/paused/ended status, optional actual
start/end dates, group coverage and optional breakdown. Unknown historical dates
remain empty. Unknown amounts never become zero. Source spelling is preserved.

A root group is counted once. Included allocations reference its stable support
ID, never increase totals, and cannot exceed the group amount. Breakdown lines
also never add to the parent amount. Reported disputed amounts remain in the
listed total with visible questions; no payment verification is implied.

Existing `/ministry-overview/operations`, `/query` and `/command` expose:
- listMissionRecipients, getMissionRecipient, getMissionSupportSummary;
- getMissionSource, getMissionRosterHistory, previewMissionImport;
- importMissionRoster, updateMissionRecipient, updateMissionSupport.

Exact schemas are in the runtime catalog. Updates require the roster version
(not ministry version), a stable idempotency key and source evidence. Original
rows are immutable; corrections live in the current record and append-only
history. No delete operation is exposed.

## Import and recovery

Read-only preview validates all normalized rows against the existing aggregate
and returns a hash bound to its version, exact source, basis confirmation and
input rows. Import commits the entire aggregate, new immutable source, history
and receipt in one transaction. Failed validation cannot leave partial rows.
A timeout is reconciled by replaying the exact intent and reading current state.
Source-content hash plus stable row keys prevent reimport duplicates; changed
source rows conflict rather than overwrite. Partial batches from the same source
can resume, preserving later evidenced corrections. Possible duplicate recipient
identities across sources require resolution before ingestion.

Aggregate and individual source evidence each have a 650 KB budget; the roster
is capped at 1,000 recipients/supports. Failure is explicit, never truncated.
Lists paginate with version-bound cursors. Source and operational import data
stay in the backend and are excluded from Git and release logs.

## Acceptance

Focused tests cover owner/alias/staff denial, stale versions, idempotency,
changed-intent conflicts, atomic failure, partial import recovery, immutable
source evidence, unknown amounts, group allocations, breakdowns, totals and
pagination. Existing core and gateway suites remain required.

Capture current serving revisions and preserve unrelated traffic tags before
candidate deployment. Independently verify records and totals after import.
Fresh SDK/backend acceptance and actual installed-client acceptance must be
reported separately. Deployment, import, package publication and verification
are distinct evidence states; this ADR alone establishes none of them.
