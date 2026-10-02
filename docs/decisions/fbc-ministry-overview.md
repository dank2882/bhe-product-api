# FBC Ministry Overview and connected planning

Accepted by Dan, October 2, 2026: “ok go ahead and build it”.
Registry decision: `fbc-ministry-overview-20261002`.

## Promise and user experience

When Pastor sets a ministry aside, unresolved matters remain accounted for.
The next review explains what changed, what needs him, and what remains with
someone else. A current picture must not require reconstructing a note stream.
Use ordinary conversation: remember this, help me think, what needs attention.
Preserve exact wording separately from interpretation. Ask only questions that
change responsibility, commitment, access, or consequential action; harmless
unknowns stay open. No new dashboard, mandatory reports, scores, or background
autonomous agent.

## Ownership and access

Extend existing core Firestore/API and FBC Staff Tools/Life OS gateways. FBC
ministry profiles own purpose, goals, explicit hierarchy/oversight, leader,
workers, escalation rules, review cadence and calendar mappings. Tracked matters
own present disposition, history, source evidence, next move and return condition.
Breeze owns people identity and church events. Tasks/projects, Outlook personal
commitments, Notebooks private reflections and Pastoral Care retain their owners.
Only needs, requests and estimated costs belong here, not accounting data.

Dan controls leadership, explicit per-ministry viewer/editor grants and reserved
decisions. Selected editors maintain routine information. No inherited grants,
tag-derived leadership, roster-derived access, or linked-record permission leaks.
Ministry roles are distinct from access grants. Sensitive sources go directly to
their existing owner; this module holds ordinary shareable ministry information.

## Matters, decisions and reviews

Concerns do not automatically create tasks. Every unresolved matter has an
agreed return condition or an explicit missing-return-condition indicator and
remains in the next ministry review. Track dates, approaching events, expected
answers, reported changes and reconsideration conditions. Do not invent owners.
Fresh retrieval does not refresh the date information was last confirmed.

Approval/decline resolves the decision task, not necessarily the underlying
need. Deferral preserves the unresolved decision and return date. More-information
records the specific gap, known responsible person and follow-up without sending.
Task completion alone cannot record a decision or resolve a broader concern.
Create/link one task per agreed action, preserving assignment acceptance and
durable duplicate protection. Unknown or partial writes remain reconcilable.

Daily ministry review shows five priority items plus counts: changes, decisions,
due follow-ups/reviews, preparation gaps, encouragements and evidence limitations.
Avoid repeating the same linked task/event. Horizons: 14 days daily, 90 weekly,
365 monthly; default ministry review monthly. Review reads never complete work.
Respect the accepted handed-off Maintenance exclusion from Dan personal views.

## Calendar workflow

Discover and read all authorized Breeze calendar areas explicitly. Live October
inspection found Main, Children's Ministries, Español, FBCA, Holidays &
Observances, Staff, Youth Ministry; the default event query returned Main only.
Store stable area, instance and series IDs. Multiple ministries may contribute
to one event, but keep one authoritative Breeze entry.

Prepare exact actions; check conflicts; authorize current arrangement; record
attempt before dispatch; independently reread each result. Never replay an
ambiguous non-idempotent create. Respect account rate limits and API cache delay.
Use supported API calls; in-place changes use supervised normal Breeze UI when
needed. Browser unavailability leaves pending work. Never delete/recreate to
imitate editing. Recurrence scope and cancellation effects are explicit.

Personal Outlook blocks reuse Pastoral Appointments, including preparation,
travel, exact arrangement, existing family scheduling approval/notifications and
conflict safeguards. These apply to Dan's commitments, not every church event.
Check existing/subscribed events before creating personal blocks. Calendar
presence does not establish attendance or agreement. Messages/invites require
explicit authorization. Do not silently propagate direct source changes.

## Verification gates (all remain open until evidence is recorded)

- Durable concern capture; fresh-session current picture; context preserved.
- Due/conditional returns, stale information, missing ownership, no invented action.
- Explicit decision outcomes and one linked task; retries and conflict recovery.
- Selected leader allow/deny; grants, hierarchy, private/source boundaries.
- All Breeze areas, incomplete reads, recurrence, multi-day and DST handling.
- Create/edit/cancel with source identity preservation and readback; unavailable
  browser, ambiguous writes, direct edits, partial action recovery.
- Outlook existing-event checks and complete appointment/family safeguard reuse.
- Daily/weekly/monthly integration, counts, deduplication, Maintenance exclusion.
- Backend/gateway checks, committed deployment, rollback, fresh-client acceptance.
- Three Dan-selected ministries/leaders and one cross-ministry event pilot;
  no inferred production appointments, access grants or test messages.

Implementation and verification are separate states. Never call this complete
while an explicit gate lacks authoritative evidence.

## Implementation checkpoint, October 2

Core records, per-ministry authorization, matters and decision-task recovery,
explicit-source calendar reads, guarded single-event API dispatch, existing-series
browser workflow, ordinary task/project links, appointment references and review
composition are implemented in the existing repositories. Finite recurring-series creation now requires 2-250 exact approved occurrences,
one verified series identity and independent browser readback for each occurrence.
Unbounded series require an explicitly bounded scope first. The live pilot and
fresh-client acceptance remain open. No production ministry or leader grants have
been inferred.

The calendar adapter reuses `location-map-985/BREEZE_API_KEY` version 2 for tenant
`faithbaptistapp`, matching the existing Pastoral Care runtime reference. Only
calendar endpoints are exposed. Its Firestore throttle serializes Ministry
Overview calls across core instances at 3.5-second spacing. Other existing Breeze
consumers still share the provider's account-wide limit; a 429 is an explicit
coverage/write-outcome limitation, never a retry of an ambiguous mutation.

Pre-release rollback targets: core `bhe-product-api-00327-cog`; gateway revisions
must be captured independently before deploying. Candidate deployment uses no
traffic; restore normal traffic to the captured revision if validation fails.
A candidate may add the core runtime's accessor binding on this one existing
Breeze secret and the BREEZE_SUBDOMAIN/BREEZE_API_KEY runtime references. Removing
that new binding and restoring the prior revision reverses this integration;
never remove Pastoral Care's existing access or rotate the shared key.

Synthetic checks at this checkpoint: 785 core tests pass and required core
configuration checks pass. The platform suite passes its existing 212 tests;
two new gateway tests pass after correcting their OAuth fixture. The checks cover
explicit area access, source redaction, changed event approval, ambiguous-create
recovery, deferred decisions, owner/grant boundaries, API and browser readback,
event-relative returns and 23/25-hour all-day ranges. These are test evidence,
not live acceptance.
