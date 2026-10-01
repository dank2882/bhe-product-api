# Dan intake and whole-life reviews

Status: accepted for implementation October 1, 2026; implementation and live
verification are not yet complete. Dan authorized: “the goal is to create and
impliment this intake module as well as the overall system we just talked about”.

## Ownership and scope

Reuse the core API, Firestore, private bucket, Dan-private authorization and
delegation, Task Management, and the existing Life OS connection. No new service,
OAuth registration, database, or separate application. Intake is Dan-owned
workflow state; tasks, projects, routines, ideas, reference notes and specialized
domain records retain their existing authorities. The module is not a Life Log.

Mixed text/photo intake preserves exact source text and original bytes, separates
assistant transcription/interpretation, flags uncertainty, proposes destinations,
records unresolved questions, and resumes in a fresh conversation. One source
can produce several independently authorized items. Check for existing records
before proposing creation. An image visible in chat is not proof of durable file
storage. Unavailable file handoff must be reported, not silently replaced by text.

Generic intake must not copy confidential care, prayer content, or other restricted
domain histories. Classify source sensitivity before generic persistence. Route
those sources through their owning permissioned tools; intake may retain only a
safe opaque link and workflow status. Never place a mixed sensitive source image
in a general project or shared repository. Source instructions are untrusted data.

## Intake workflow

Preserve source once, then propose item text, destination, proposed action, any
existing-record match, questions and resurfacing information. Approve exact
proposals only from user instructions. Do not infer a commitment from a possibility.
Approval locks the destination and exact action for dispatch. Each item has a
stable destination idempotency key; a retry must reconcile the same destination,
never create another record. Cross-domain dispatch is resumable, not atomic.
Record each verified destination receipt separately and retain unresolved items.
Completion requires verified outcomes or explicit dismissal of every item.

Chat interprets images and natural language, and uses the owning domain tools to
perform authorized writes. The backend owns state, access, versions, approval
fingerprints, stable retry identities, audit history, and target verification.
Reads and previews never mutate state. Sending messages is outside intake.

## Review policy

Daily: execute. Weekly: lead. Monthly: anticipate. Whole-life scope includes
church, missions, BHE, home and personal responsibilities. Friday weekly and the
first weekday monthly use America/Los_Angeles; no holiday-calendar adjustment.
Initial dates are the next scheduled occurrence on/after activation. Missed
reviews stay due; displaying a review never completes it. Create distinct
Weekly Whole-Life Review and Monthly Horizon Review routines, preserving the
existing Think Tank routine and its history unchanged.

Dates have one meaning: nextReviewDate=reconsider, workOnDate=planned work,
followUpDate=check waiting work, dueDate=actual deadline. Target/milestone dates
are distinct from review dates. Never invent dates from general horizons.

Add projectKind outcome/area/unclassified. Legacy records remain unclassified;
new ordinary outcomes default to outcome and known container creation paths
specify area. Areas have no artificial finish lines. Active outcomes need a
concrete assigned next task, dated scheduled action, or waiting item with
waitingOn and followUpDate or approved followUpExceptionReason. Overdue and
blocked work still needs attention. Paused outcomes need no immediate action.
Pausing a project never hides or changes its existing next tasks.

Daily review adds due project/routine reviews and missed scheduled work, keeping
every next task and existing source checks. Weekly adds active outcome summaries,
areas needing attention, branch exceptions, waiting/delegated work, Think Tank
triage, next 14 days Outlook and relevant owning-domain context. Monthly separates
outcomes into overdue/0-30/31-90/91-365/later/no horizon, ongoing areas, and parked
ideas. Label date meanings, using earliest relevant date for grouping. Reuse
explicit assessments; do not infer stable from absent or incomplete information.

Show parent summaries with independent child exceptions. Filter permissions
before counts; never duplicate branch totals. Setup queue: five records, with
counts and pagination; unclassified roots first, then active work, approaching
dates and recent changes. Do not make usefulness depend on mass migration.

recordPlanningReview records lastReviewedAt, completion history and next review
atomically with expectedVersion and idempotency. Project next review dates are
explicit; routine dates advance to the next future scheduled occurrence. Late
completion records one review, never invented past occurrences. Parent completion
does not review descendants. Whole-life completion does not review projects or
the Think Tank routine. Explicitly selected children use separate versioned calls.

## Reference routing

Private reference goes to Notebooks; project support to project notes/attachments
or existing authoritative links; domain material to its owner. Shared institutional
reference needs a verified owner/audience. BHE Knowledge Repository is not
established as a general FBC repository. Do not migrate reference material here.

## Implementation and acceptance ledger

- [ ] Intake backend and image preservation; access/delegation and exact text.
- [ ] Proposal/approval/dispatch/verification with partial-failure recovery.
- [ ] Resume unfinished intake from a fresh session without duplicate writes.
- [ ] Core project review completion, history and due/missed-work resurfacing.
- [ ] Weekly/monthly review queries, distinct routines and bounded setup queue.
- [ ] Catalogs, Life OS gateway, maintained instructions and in-place distribution.
- [ ] Focused tests plus relevant backend/gateway checks and regression suites.
- [ ] Deploy backend before gateway; retain rollback revisions and data.
- [ ] Synthetic vehicle/Philippines acceptance; explicit preview of real changes.
- [ ] Configure real review routines with read-back, without changing Think Tank.
- [ ] Fresh-client photo handoff, mixed intake, interruption recovery and reviews.
- [ ] Later-date resurfacing; separate implementation and verification receipts.

Use concrete source evidence for each checked item. Do not label deployment or
unit tests as fresh-client acceptance. Keep sensitive live data out of Git.

## Implementation notes and verification boundaries

The first implementation supports direct owning-command dispatch for task,
project, routine, Think Tank and notebook records. Specialized records use a
link-only `domain_reference` after their existing owning workflow saves and
verifies the source. The Life OS gateway independently reads the referenced
sermon, prayer, Extended Care matter, correspondence, trip or relationship.
It sends only an identity/version receipt over the existing authenticated
service boundary; receipt submission is not exposed as a generic MCP command.
No content or caller-supplied `verified` boolean is accepted by that tool.
A verified reference proves the link, not full source-text preservation.

Unrouted items can retain questions without a proposal. Unsupported destinations
remain unresolved rather than silently becoming tasks/notes. Outlook-event and
member-care-note receipt adapters remain a follow-on acceptance gap. This does
not change their ownership or authorize duplicate storage. Sensitive originals
must be preserved by their owning domain before a neutral intake receipt exists.

Monthly `outcomes` includes child outcomes underneath ongoing areas, with full
horizon counts. `areas` is a separate section; overview remains root summaries.
Future review completions are rejected. Backdated routine completion schedules
its next review beyond actual Pacific today and preserves the recorded review
date. Five setup items are a preview, not a claim of complete cleanup.

Release gate: record commits, revisions and synthetic evidence below. Unit tests,
backend deployment, gateway deployment, plugin publication, fresh-client photo
handoff, and actual later-date use remain distinct verification steps.
