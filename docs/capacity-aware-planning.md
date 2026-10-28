# Capacity-aware planning: first increment

Implemented October 28, 2026. See [release evidence](capacity-planning-release-2026-10-28.md)
for separate deployment, client and correctness results. The shared-block
correction below is approved; subsequent phases remain outside this increment.

## Ownership and reuse

Task Management owns tasks, priorities, deadlines, effort, assignment and
work-on planning. Outlook owns calendar commitments. `buildCapacityPlan` is a
read-only operation in the existing task registry, reached through the existing
Life OS `tasks_run_query`. The shared gateway query allowlist exposes it without
new scopes; the backend independently requires Dan/private-delegate access and
ordinary record authorization. No service, database, persistent plan record,
OAuth integration, embedding, prediction or background scheduler was added.

Sources reviewed: live Developer Tools Task Management context and capacity
registry search; live canonical task guidance and task catalog; engineering
constitution; ADRs 0003 (identity/bounded orchestration), 0019 (Life OS doorway),
0022 (team authorization), 0031 (delegation) and 0039 (shared guidance); existing
task, planning-review and appointment implementation, including the accepted
approve-once/finish-booking decision. Registry deployment summaries are not
treated as current deployment evidence.

Existing calendar integration is a connected-client handoff. The backend does
not hold Dan's Outlook tokens or fetch his calendar directly. This increment
retains that boundary: the operator reads Outlook through its existing connector
and supplies transient event occurrences, with coverage and observation time.
These are explicitly **client observations**, not backend-verified provider data.
Sarah's Life OS delegation does not confer access to Dan's Outlook connection.

## Contract

Call `tasks_list_operations` with query `buildCapacityPlan` for the maintained
argument contract. The query accepts:

- `horizon: {start,end}` with explicit ISO offsets, starting at or after the
  query's clock and lasting at most 14 days; `timezone` is a required IANA zone.
- `workWindows: [{start,end}]`: up to 56 explicit, non-overlapping work periods
  inside that horizon, split at local midnight. Supply realistic capacity after
  breaks, travel, recovery and other non-work time. No default workweek is
  invented; an empty list means zero work capacity.
- `calendar: {status, observedAt, start, end, events}`. Status is `checked`,
  `limited`, or `unavailable`. Each event contains `calendarId`, `eventId`,
  `start`, `end`, optional `showAs` and boolean `cancelled`. Use occurrence IDs,
  expand recurring events, include all-day events as actual start/end intervals,
  and finish pagination across all relevant calendars. Omit subjects and bodies.
  A checked snapshot must cover the horizon and be no older than five minutes.
- Optional `proposal`: either `{kind:"new_task", title, estimatedMinutes,
  priority, dueDate?}` or `{kind:"reschedule", taskId, expectedVersion, start}`.
  A new task proposal is not persisted. Rescheduling retains saved effort,
  priority and deadline and requires a current task version.
- Optional `flexibleTaskIds`: up to ten existing timed tasks explicitly selected
  for considering movement. This is not execution approval. Unselected task
  blocks and ordinary Outlook commitments remain protected.

Task inventory is read fresh through the existing complete-query and permission
filters; pagination is completed internally, and excessive inventories fail
explicitly instead of returning a truncated plan. The planner includes every
open personal responsibility within the existing Maintenance handoff boundary.
Done/dropped work is excluded. Delegated work, pending assignments, waiting
items and unresolved identities remain visible and are not assigned new time
on Dan's calendar. Delegates do not mix their own tasks into Dan's plan.

## Deterministic behavior

The first alternative retains existing timed work and schedules other work by
deadline, then priority, then stable task ID. Date-only work-on plans constrain
that date. Exact saved start/end times provide planned duration; when an effort
estimate exceeds that block, the discrepancy is a risk, not silently discarded
remaining effort. No completion is inferred from elapsed scheduled time.

At most one additional alternative considers moving one explicitly selected
flexible task. It preserves other blocks, tries to accommodate the proposal,
and accounts for the displaced task before other unplanned work. It is returned
only if it improves the constraint/risk/proposal-placement comparison; unnecessary
reshuffling is suppressed. This bounds disruption rather than searching arbitrary
multi-task rearrangements. Priorities and deadlines never change.

A linked Outlook event can be released hypothetically only when its calendar ID,
event ID and exact times match a unique synced task block. Stale or missing
links require reconciliation. A verified shared event remains one protected
reservation even when several task rows reference it. Those rows do not conflict
with their own event or each other. Different overlapping events still conflict;
unverified task links are never silently deduplicated. Shared blocks cannot be
selected for movement, even when all estimates are known.

For shared tasks, `plannedMinutes` comes only from that task's explicit estimate;
zero means unknown, not no work. `sharedBlockMinutes` is the common reservation
duration, not independently allocated effort for each task. Missing estimates
produce `shared_block_effort_unknown` and prevent an all-clear. Known Dan-work
and timed waiting-follow-up estimates that together exceed the verified block
produce `shared_block_effort_exceeds_capacity`; delegated execution effort does
not consume Dan's budget. All individual task rows, states, deadlines and other
risks remain visible. Reserving the group block never proves task completion.

A matching task/event occupies time once.
All other busy, tentative, out-of-office or unknown events remain protected;
only explicitly free or cancelled events are nonblocking. Overlaps are half-open
intervals; busy intervals are unioned before subtracting them from work windows.
DST arithmetic uses real instants. Ambiguous or nonexistent saved local task
times produce unresolved information, never an invented timezone offset.

Each alternative returns `accounting`, `changes`, `conflicts`, `risks` and
remaining windows/minutes. Changes retain task versions and Outlook links.
Conflict details are capped at 50 with `conflictCount` and `conflictsTruncated`;
the feasibility decision uses the full conflict count. Task accounting is not
truncated.
Feasibility means:

- `fits_supplied_constraints`: the modeled work fits the supplied windows and
  observations without a known conflict or unresolved risk.
- `not_feasible`: this candidate has unplaced work or a known constraint failure.
  It is not proof that every possible schedule is infeasible.
- `undetermined`: source coverage or task information prevents an all-clear.

The output is a snapshot, not a reservation or an enduring guarantee. Future
work beyond the horizon is explicitly accounted for but not capacity-validated.
It covers task timing, not every Life OS domain, energy, project dependency
execution, ongoing routine, sermon preparation or psychological workload.
Operators must not turn the narrow fit label into a claim that all life work is
feasible. AI may interpret and explain the returned tradeoffs; it does not perform
constraint arithmetic or invent estimates.

## Approval and next increment

The query performs no writes and has no apply command, including when passed
an approval. Existing task/calendar workflows and synchronization behavior remain
unchanged. Never interpret a proposal or selected flexible task as permission to
write. Present exact changes to Dan; after explicit approval, refresh both owning
sources, use their existing version/idempotency controls and preserve event IDs,
then independently read back any authorized changes.

Next recommended increment, after review: a small version-bound approval and
application workflow for one selected alternative. Reuse existing command,
idempotency and calendar handoff patterns; detect intervening task/calendar
changes and reconcile interrupted writes before retry. That workflow, broader
replanning and persistent capacity preferences are outside this slice.

## Verification

`test/capacity-planning.test.js` exercises interval union/subtraction, complete
inventories, priority/deadline ordering, missing estimates, task/event deduplication,
single-task displacement and overflow, protected commitments, version conflicts,
stale/mismatched/shared links, local deadlines and DST, all-day observations,
partial/stale coverage, exact owner/delegate access and zero database mutation.
A deterministic duration sweep independently checks that feasible placements
fit windows, avoid calendar/task overlaps and account for every task.

`bhe-agent-platform/test/capacity-planning-tools.test.js` verifies reuse of the
query route and existing scope, read-only annotation, absence from the command
allowlist and explicit approval instructions. Production Outlook recurrence,
pagination and client evidence quality still require fresh-client acceptance.

Local verification on October 28: all 875 core tests and 237 platform tests
passed, including 25 focused planner tests and the gateway integration test.
Both repositories' `npm run check` and whitespace checks passed. No production
task or Outlook event was changed. Existing untracked `output/` directories in
both repositories were left untouched.
