# Shared-work-block correction — 2026-10-28

Dan approved the narrow correctness repair after acceptance request
`4bfd5b59-5fcc-450d-a3d3-4159a6fd3ea5`. No approval-and-apply, optimization,
new data model, task mutation or Outlook mutation is included.

## Implementation and checks

Core commit `e475bfb28af077222dd8241185a4758ee928c9bf`:

- Preserve verified calendar/occurrence identity independently of movement
  permission. A shared event stays one protected reservation. Linked tasks do
  not conflict with that event or with each other; overlaps between different
  events and unverified task reservations are still detected.
- Shared events cannot be released to move one linked task, even when estimates
  are known. Existing task IDs, versions, priorities, deadlines, assignments and
  synchronization records are unchanged.
- Shared-task effort comes from the task's own explicit estimate. Unknown effort
  stays unknown; the entire group duration is not assigned to every task.
  `sharedBlockMinutes` retains the saved block duration separately.
- Known work/follow-up effort exceeding the verified block is a capacity failure.
  Delegated execution effort is not charged to Dan. Other risks remain visible.
- The tests retain the three sanitized acceptance shapes: two tasks in a
  150-minute block, four in a 45-minute block, and six waiting follow-ups in a
  30-minute block. They cover unknown/known effort, overflow, assignment states,
  different event/occurrence/calendar overlaps, stale/limited coverage,
  unverified links and rejection of shared-block movement.

All **31 focused tests** and **881 core tests** passed, along with repository
checks. Developer Tools evidence `capacity-shared-block-tests-e475bfb-20261028`
was recorded and independently read back.

## Approved release

The clean detached checkout matched GitHub main. The approved
`bhe-agent-platform/scripts/release-service.mjs` ran checks/tests, deployed,
verified traffic and wrote/read back registry receipts.

- Revision: `bhe-product-api-00335-lfx`, **100% traffic**.
- Release observation: `2026-10-28T21:15:21.899Z`.
- Evidence: `release-task-management-bhe-product-api-00335-lfx-1793222121899`.
- Independent comparison with `bhe-product-api-00334-jd2` confirmed unchanged
  environment, runtime service account and volumes.
- Gateway remains `dan-life-os-mcp-00042-fbl`; no route, permission, scope or
  gateway source change was required.

## Connected Life OS live check

Request `7680594f-3d7a-4219-ab9c-b957843440eb` used the actual connected Life OS
query, not a local SDK substitute. Dan's primary-calendar-only scope and
provisional 13:00–16:00 Pacific windows were retained, with today starting at
14:19 (future at invocation). The horizon ends Friday October 30 at 16:30.

- Primary calendar: 17 events, including four expanded recurrence occurrences;
  no remaining event pages. Observation `21:16:12.369Z`, query generation
  `21:16:14.508Z`: **2.139 seconds old**.
- Coverage: `complete_authorized_personal_inventory`,
  `fresh_client_observation`, `calendarBackendVerified:false` (client-attested
  provider observations, as designed).
- All 45 open task IDs/versions and returned status/priority/deadline/estimate
  fields matched an independent six-page, 581-record inventory.
- **Zero conflicts**, compared with 34 before the fix. All 17 observed events
  remain protected. The 12 task rows in the three accepted groups remain present
  with unknown effort and zero inferred per-task minutes.
- **90 free minutes**, independently confirmed: Thursday 13:30–14:00 and
  15:00–16:00 Pacific. No work moved; zero proposed or applied changes.
- Result remains **`not_feasible`**, not an all-clear.

Remaining distinct-task risks: 23 unknown shared-task estimates (12 within this
horizon and 11 in later saved blocks), two other missing estimates, eight saved
blocks outside the discretionary windows, one missed work-on date, one late
deadline (reported twice by the existing policy), one delegated deadline needing
follow-up, one past block not proving completion, and one estimate exceeding its
saved block. Existing Wednesday/Friday departure-buffer commitments are preserved.
This fix does not resolve those records or alter outside-window semantics.

## Fresh ChatGPT acceptance

A newly created signed-in Life OS conversation performed the read-only attempt:
https://chatgpt.com/c/6ae26605-d290-83e8-b6ce-497312408554

The UI showed the live operation was available, calendar/task retrieval activity,
and a completed 1 minute 48 second response. However, the final body displays
**“This response couldn’t load”**, including after a reload; Copy returns only
that error. Sources exposes the skill, not a tool receipt. No exact request ID or
result could be independently recovered from the visible fresh-client response.
Activity labels alone are not proof of a successful planner result.

Therefore this fresh-client acceptance attempt is **unverified**, not passed.
This does not revoke Dan's earlier discovery/callability acceptance, and it does
not replace the successful connected-tool check above. The cause of the ChatGPT
response-display failure is undiagnosed; no authentication or gateway changes
were made to work around it. A readable fresh-client receipt remains required.

## Next-phase gate

No approval-and-apply implementation was started. The shared-reservation defect
is resolved in automated and connected live checks. Approval-and-apply is **not
ready to begin implementation yet**: obtain a readable fresh-client result and
review the remaining risks with Dan first. This correction does not implement
the previously unsupported additional-90-minutes proposal, and no live displaced
work scenario was exercised. Those limits remain separate from this repair.
