# Approved Schedule Adjustment release and verification — October 28, 2026

The first narrow implementation is deployed. Simulation and live read-only query
verification passed. No real adjustment was approved or dispatched, and no task
or Outlook event was modified. Stop for Dan's review before a live write.

## Released sources and safeguards

| Service | Source | Serving revision | Traffic |
| --- | --- | --- | --- |
| Core API | `111e43e696ceb5adf612b18245c184c09600230d` | `bhe-product-api-00337-wj2` | 100% |
| Life OS MCP | `f6b5348cad7acd6c780144433a510d273499e31a` | `dan-life-os-mcp-00043-s4v` | 100% |

Both releases used the existing approved `release-service.mjs` helper from clean
checkouts matching GitHub main, with checks/tests, environment preservation,
explicit traffic routing, registry receipts and independent receipt readback.
The core release supersedes initial adjustment revision `00336-r2g` and adds
read-only task-scoped recovery of saved workflow IDs after a lost response.

Core: 902 passing tests, including 21 focused adjustment regressions. Platform:
240 passing tests, including fresh MCP transport discovery and serialized result
coverage. These are local/release-helper results, not a claim of GitHub CI status.

Durable Developer Tools evidence:

- `schedule-adjustment-simulations-111e43e-20261028`
- `release-task-management-bhe-product-api-00337-wj2-1793226061909`
- `release-task-management-dan-life-os-mcp-00043-s4v-1793225859422`
- `schedule-adjustment-readonly-111e43e-20261028`

## Live read-only verification

A real accepted Dan-owned task with one uniquely linked single-instance Outlook
focus event, no attendees and a matching task marker was checked. The hypothetical
move kept its 60-minute duration, moving November 16, 1:30–2:30 p.m. Pacific to
October 29, 3–4 p.m. Pacific. It was a test proposal, not a recommendation to
advance its priority or approval to change its schedule.

Direct live preview request `22b5cb1a-ff8b-4ea6-a74a-46c910344f80` returned:

- 45 distinct tasks accounted for; complete authorized personal task inventory.
- Full primary Calendar pagination for October 29 through October 30 at 4:30 p.m.:
  14 events, including 4 recurring occurrences, plus an independent fetch of the
  selected November event. Source observation age: 23.028 seconds.
- Provisional eligible windows: 1–4 p.m. on both days. Existing events were
  protected; morning sermon preparation, lunch and the departure buffer were
  excluded from eligible capacity.
- `fits_verified_reservation_constraints`, no displaced task IDs, 60 minutes
  reserved, and 30 minutes of capacity remaining after the hypothetical move.
- Selected effort remains unknown. The result does not promise completion.
- Overall inventory remains `not_feasible`. Missing/shared-block effort,
  deadlines, past work blocks, out-of-window work and a short reservation remain
  visible. Calendar evidence is client-attested, `calendarBackendVerified:false`.
- Exact task version, full provider IDs, source fingerprints, before/after times
  and assumptions are bound to the proposal hash. Provider concurrency fields
  were unavailable and explicitly null.
- `readOnly:true`, `approvalRequired:true`, `mutationsApplied:false`.

Independent task/event reads after the fresh-client test confirmed the original
schedule and task version unchanged. Task-scoped workflow lookup request
`2c164f17-eefc-430a-a437-de9abcd8ea08` returned complete, empty saved adjustments.
Full private preview details are retained locally outside Git; they are stale
evidence and must not be reused as an executable approval without a fresh preview.

## Fresh-client integration and presentation

The installed ChatGPT connector initially cached the old tool enum. Its existing
**Refresh tools** action resolved discovery/callability without changing OAuth,
permissions or endpoint configuration. A new ChatGPT conversation then invoked:

- guide: `d26bfc70-9aa9-4034-af3f-b50913172a08`;
- task-scoped recovery: `8317e9ed-b98f-456a-9bd4-7bd53a9457b4`;
- preview: `884814b2-7167-47be-8392-4f8b2bee1b86`.

Production logs confirm successful preview execution at 22:29:59 UTC, 2,488 ms,
25,140 backend JSON bytes. Fresh discovery and read-only callability passed.
However, Chrome still displayed “This response couldn't load” for its final
response. The previously reproduced tool-free control failure and successful
desktop conversation are separate evidence; this run does not establish a
planner/gateway cause or successful final presentation in a new client.
No scheduling or payload truncation change was made to mask that browser issue.

## Review and remaining gates

The [workflow contract](approved-schedule-adjustment.md) documents exact approval,
fresh preflight, one-time connector dispatch, existing versioned task update,
independent readback, lost-response recovery and durable partial-result evidence.

Before the first real adjustment: display a fresh exact preview in a functioning
client, obtain Dan's separate approval of that specific change and disclosed
risks, then rerun the required fresh preflight. The current Outlook connector has
no conditional `If-Match` update or idempotency parameter, so an intervening
provider edit cannot be atomically excluded. A live successful write and live
two-system readback remain untested by design. Simulated partial failures passed;
different-state manual repair and lock release require separate engineering
review, with no automatic rollback or blind retry.

No bulk replanning, shared/recurring event movement, optimization or unrelated
functionality was implemented. The read-only planner's scheduling logic is
unchanged.
