# Approved Schedule Adjustment: first increment

Dan authorized this implementation on October 28, 2026, after accepting the
read-only planner. This authorization does **not** approve any live schedule
change. Deployment and read-only client acceptance are separate from the first
user-approved real write.

## Existing architecture

Task Management remains the sole task owner. Outlook remains the sole calendar
owner, accessed through Dan's authorized client connector. The existing Life OS
task query/command tools expose this workflow; no new application, authentication
flow, task database, calendar credential, scheduler or worker is introduced.
The read-only planner's scheduling logic is unchanged.

The approve-once / lock / readback / reconcile pattern follows the accepted
[appointment booking decision](decisions/appointments-finish-booking.md).
Task Management stores small workflow records in `taskScheduleAdjustments`,
actor-bound receipts in `taskScheduleAdjustmentReceipts`, and exclusive task/event
attempt locks in `taskScheduleAdjustmentLocks`. Records hold exact IDs, task
version and fingerprints, before/after times, approved assumptions, state and
readback evidence. Event subject/body/location and complete task snapshots are
hashed rather than copied into workflow records. Per-version content-free
history is written atomically with the workflow and receipt.

## Narrow contract

Read `getScheduleAdjustmentGuide` for the live input contract. The supported move
preserves duration and timezone, fits one local day and an explicit work window,
and cannot exceed the selected task's deadline. It requires Dan's ownership and
accepted assignment, a scheduled task, one uniquely linked busy single-instance
event, organizer status, no attendees/recurrence, one task marker in the event
body, matching current task/event times, and no additional calendar sessions
in task context. Complete primary-calendar observations and independently fetched
event details are required. Shared links are checked across the owning task
collection, including completed and otherwise invisible tasks, without exposing
their contents.

The preview preserves all personal task accounting and inventory risks. Missing
or excessive effort for the selected task is disclosed: moving its existing
reservation does not promise completion. Missing estimates elsewhere are not a
global veto. Protected calendar events and existing timed task reservations
remain protected; unresolved timing on the selected day requires clarification.
Historical schedule text stays intact; structured task/event times and updated
task `timeWindow` are the current schedule.

1. `previewScheduleAdjustment` reads only and returns the exact proposal/digest.
2. Display the complete adjustment and relevant risks; obtain Dan's explicit
   approval. `approveScheduleAdjustment` rechecks the preview and saves only that
   approval. It expires after 15 minutes before dispatch.
3. Fresh task/event and fully paginated calendar observations must match the
   approved proposal. `beginScheduleAdjustment` requires observations after
   approval, at most 60 seconds old, and transactionally locks the task/event.
   Only its first `execute_once` response permits the exact returned start/end
   connector call, within 30 seconds. Replays never authorize dispatch.
4. Independently fetch Outlook after the call. `recordScheduleAdjustmentResult`
   saves unknown/mismatched outcomes, or matching fresh event evidence before
   one task attempt. It refreshes capacity, rereads the task, and uses the
   existing expected-version/idempotent `updateTask` path. No other task fields
   are requested; ownership, effort, priorities, deadlines, assignment and links
   remain intact. Task version and system audit timestamps advance normally.
5. Fetch Outlook again after the task leg. `verifyScheduleAdjustment` reads the
   task independently and checks exact schedules and preserved fields. Only a
   match marks `verified` and releases the attempt locks.

## Partial results and limitations

The connector exposes neither `If-Match` nor an idempotency argument. Available
ETag/changeKey/lastModified values are bound if supplied; their absence is
represented as null. Semantic event content is fingerprinted. Preflight/readback
reduce risk but **cannot provide atomic provider compare-and-swap** or an atomic
two-system transaction. Calendar evidence remains client-attested and
`calendarBackendVerified:false`.

Never repeat a calendar write after dispatch or interruption. Read the saved
workflow and exact event first. `getScheduleAdjustment` accepts `taskId` to
discover saved workflow IDs after a lost response or a fresh chat; it never
advances state. Lookup is complete up to 100 workflows per task and fails
explicitly beyond that budget rather than hiding unfinished work.
A confirmed approved calendar after-state may
finish the still-unattempted task leg. An attempted task is observation-only on
recovery; independent reads can confirm success despite a lost response.
Unexpected task edits, conflicting events or mismatched readback preserve
`reconciliation_required` and evidence, with locks held. No automatic rollback.
If fresh reads cannot establish the exact approved state, present the actual
two-system state for a separately approved manual repair through the existing
owning workflows. Different-state repairs and administrative lock release
require engineering review; this increment does not offer a general-purpose
reconciliation editor or retry button.

## Verification gates

Focused simulations cover the successful two-stage readback, exact approval,
owner-only access, shared/recurring/attendee exclusions, incomplete/stale sources,
constraints, preserved risks/fields, duplicate approvals and locks, calendar
uncertainty, task version changes, lost task responses and failed task writes.
A fresh MCP transport test checks discovery, query/command separation, full
accounting and JSON representations. Release uses the approved helper from clean
GitHub main, checks/tests, explicit traffic routing, registry receipt and readback.
Live read-only preview acceptance and a real approved write are distinct gates.

Bulk replanning, changed effort/duration, shared/recurring block movement,
autonomous scheduling, predictive estimates and unrelated features are excluded.
