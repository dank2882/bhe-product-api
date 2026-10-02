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

## Live candidate acceptance, October 2

Candidate core `bhe-product-api-00329-zex` read all seven Breeze areas and all 73
October events. The Staff-only October 3 check also returned an event spanning
into the window from September, demonstrating overlap inclusion rather than
start-date-only filtering. The live synthetic ministry preserved its original
concern, reused one decision task through pending/deferred/declined, and did not
resolve the broader matter on decision completion. An unrelated authenticated
administrator was denied access. The fixture ministry was archived and its task
verified done.

One temporary Staff calendar event, instance `434292165`, series `5508465`, was
created for October 3, 06:00–06:05 Pacific, without attendees. Its title was edited
through Breeze's normal settings UI; an independent reload confirmed the same
instance, time, calendar, non-repeating schedule, unchecked All Day, empty
location/description. Breeze required a valid check-in eligibility setting to
save this API-created fixture; it was set to No One. Do not silently change a
real event's eligibility merely to bypass that validation.

The single API deletion returned a non-JSON response. The workflow retained an
unknown outcome, did not repeat the deletion, and was reconciled using the
normal authenticated Breeze UI: reloading the exact event URL redirected to
Event Not Found. All three durable actions were then independently reread as
verified; edit/cancel evidence remains explicitly client-browser evidence.

Live testing exposed missing All Day metadata on newly API-created events.
The adapter now preserves event_description and requires an explicit all-day
value before API-only verification; otherwise the bound event waits for browser
readback. This correction and source-text fallback were added after the first
candidate. Cross-ministry participation now grants only the exact shared event,
not its whole calendar area; verified later edits/cancellations supersede older
calendar actions in the current picture while retaining history.

Normal core and Life OS traffic stayed on their recorded prior revisions during
these candidate checks. The narrower Breeze-secret accessor binding was added
for the existing core runtime and independently read back. No new credential,
service, OAuth app, database or autonomous process was created. Pilot selection,
selected-leader live acceptance, final revision promotion and fresh-client
usability acceptance remain open.

## Release checkpoint

Committed core `3200bb1` is live on `bhe-product-api-00331-cuy`; gateway code from
`1675de7` (image built at `36ada5f`) is live on `dan-life-os-mcp-00038-buc` and
`fbc-staff-tools-mcp-entra-prod-00069-pep`. Independent Cloud Run reads confirm
Ready and 100 percent normal traffic on all three. Core environment differences
from `00327-cog` are only BREEZE_SUBDOMAIN and the existing BREEZE_API_KEY secret
reference. Gateway environments and all runtime service accounts are unchanged.
Both gateways still return OAuth metadata and reject unauthenticated MCP access.
Rollback is traffic-only to core `00327-cog`, Life OS `00036-waw`, and Staff
`00067-did`; preserve all unrelated traffic tags.

All 787 core tests and 214 gateway tests pass. The fresh MCP SDK acceptance
script (`bhe-agent-platform:scripts/verify-ministry-mcp-live.mjs`) passed against
normal production: two fresh client/server instances discover the new tools,
read the same exact concern and task identity, and leave the fixture archived.
This proves MCP contract continuity with authenticated backend access. It does
not prove ChatGPT's OAuth tool rediscovery, mobile interaction, or Dan's experience.

Maintained instructions and both distribution trees are prepared in Git. No new
marketplace or app registration was created. In-place publication of the current
ChatGPT instruction package and fresh ChatGPT discovery still need verification.
Three actual ministries, their selected editors and the real shared-event pilot
remain unselected. These remaining gates prevent full decision verification.

## Requirement audit and publication follow-up, October 2

Current source and test assertions were inspected, rather than treating the test
count as proof of every requirement. Cloud Run was independently reread: the
three release revisions above still serve 100 percent normal traffic. This
audit does not declare the full goal achieved.

| Requirement | Evidence and its scope | Remaining acceptance |
| --- | --- | --- |
| Ministry purpose, goals, leaders, workers, oversight, hierarchy and needs | Model/profile validation and protected updates exist; hierarchy-cycle and owner-only update tests pass. Estimates remain distinct from accounting. | Dan-selected real profiles and confirmation of their current picture. |
| Durable matters, original wording, source history, next move and return | Service and tests preserve exact capture across fresh reads, create no implicit task, and keep immutable command history. Production synthetic concern was reread through fresh MCP clients. | Ordinary Chat capture/retrieval and human usability. |
| Unresolved matters return; stale/unknown stays explicit | Date, next-review, change-condition and event returns exist; tests cover deferred dates, event-relative return, missing ownership and old reports after review. | Real review with a leader-owned unresolved matter. |
| Decisions and actions use owning tasks | Deterministic decision task sync and version/idempotency handling exist; tests check one task and manual completion without approval. Live pending/deferred/declined reused one task and left the matter open. Ordinary action links retain Task Management ownership. | Real decision and follow-through in Dan's task list. |
| Explicit selected-editor access and private boundaries | Tests cover no roster/hierarchy inheritance, revocation/replay denial, protected leadership, foreign calendar-area denial and private appointment redaction. Unrelated live administrator was denied. | Actual selected editor allow/deny with the editor's identity. |
| All Breeze areas and source limitations | Seven live areas and October events read explicitly; overlap event verified. Tests cover partial areas, source field checks, DST and exact event sharing. | Real ministry/calendar mappings and shared-event pilot. |
| Full create/edit/cancel workflow and recovery | Live temporary create, same-identity browser edit and uncertain-delete reconciliation verified. Tests cover no repeated ambiguous create, changed source snapshots, approval and finite recurrence completeness. | Real event workflow and browser/series usability; synthetic evidence does not establish every real arrangement. |
| Outlook, preparation/travel and family safeguards | Existing appointment workflow is linked, not duplicated. Integration test reads actual family-approval state and excludes private references from leader views/history. Maintained instructions require Outlook source checks and exact approval. | Real, explicitly authorized personal arrangement; no appointment inferred for testing. |
| Daily/weekly/monthly reviews | Review code uses 14/90/365-day windows, defaults to five items with pagination/counts, returns changes/gaps/encouragements and excludes handed-off ministries. Daily and planning review retrieval requests exist. Task/event grouping is part of the maintained client instructions. | Published instructions and fresh Chat brief, including grouping across sources. |
| Release, rollback, simple conversation and three-ministry pilot | Backend/gateways deployed and rollback revisions retained. Fresh SDK contract acceptance passed. New in-place packages prepared and package validation passes. | ChatGPT publication/tool discovery, three ministries, editor identities, shared event and Dan's usability check. |

Publication evidence and exact archive hashes are in platform
`docs/ministry-chatgpt-publication-2026-10-02.md`. The current ChatGPT download
controls did not yield a new archive; Life OS workspace management returned
Internal Server Error. No package was uploaded. The retired marketplace builder
was disabled to prevent reintroducing the superseded connection. Packages were
prepared from retained baselines with exact app bindings, but require current
rollback downloads and independent post-upload comparison before publication can
be claimed. Pilot selections were requested; none were inferred.
