# FBC Service Forecaster and Planner

Accepted October 29, 2026 by Dan: “I like it move forward with the build please.”
Registry decision: `fbc-service-forecaster-20261029`.

Extend Ministry Planning, owned by FBC, using existing services, serviceOrderItems,
serviceMoments, serviceSongEvents and assignments. No new service, database,
authentication, calendar or autonomous agent. Wednesday services through year-end
are the first pilot; all existing service types can use the same operations.

## Workflow

- `buildServiceForecast(dateFrom,dateTo,serviceType?)`: saved services, agenda,
  imported music/speaker facts, known timing and readiness issues. Wednesday
  aliases include prayer_service. Missing service dates are explicitly unknown.
- `getServicePlan(serviceId)`: full order, music, assignments, service moments,
  preparation, whole-service feedback, version and coverage limits.
- `saveServicePlan`: patch emphasis, targetMinutes and notes on an existing service.
- `saveServicePlanItem`: patch a stable ordered element, including missions update,
  message, graduation, testimony, recognition or transition. Assigned people carry
  explicit open/proposed/invited/confirmed/completed/cancelled states. Preparation
  carries responsible person, due date and readiness. Cancel rather than delete.
- `recordServiceFeedback`: append exact whole-service feedback, including positive
  feedback, to serviceMoments without downweighting individual songs.

Writes use an authenticated actor, a stable intent key and the current service
plannerVersion. Service patch, item and audit receipt commit in one transaction.
Replay checks precede versions; changed intent with the same key fails. Existing
legacy assignment writers remain separate; discrepancies are surfaced rather than
silently copying or overwriting either source. A plan read checks plannerVersion
before/after reading, but this does not claim atomic consistency for legacy writes.

## Ownership and current boundaries

Music agenda elements link existing song events and cannot change performers.
Music eligibility, policy review and roster workflows remain authoritative.
Missions recipient IDs reference Ministry Overview; this release does not expose
support amounts, duplicate recipient records or infer recipient identity.
Preparation is inline service readiness, not a duplicate task system. No tasks,
invitations or calendar events are sent automatically.

No automatic sheet writes. Reconcile source values against a fresh sheet before
pilot population. Neither imported values nor a named booking implies confirmed.
Backend records own new agenda elements; the existing sheet continues its current
music workflow until a guarded projection with content/format conflict checking
is implemented. Do not present this first release as full two-way synchronization.

Forecast counts known agenda minutes, explicitly marks missing timing and music
not yet placed in the agenda, and highlights same-day participation for review.
It does not claim full person-level availability, roster rotation, exact overlap,
or completion. Legacy speaker differences are explicit. Source date and provenance
remain available in the service record.

## Verification gates

Automated: transaction replay, stale edits, cross-service item/link rejection,
validation, positive feedback, time uncertainty, cancellations, gateway allowlists.
Release: repository checks, full suites, candidate deployment, authenticated reads
and denied writes, independent pilot read-back, fresh installed tool discovery.
No deployment or human usability acceptance is established by this document.
