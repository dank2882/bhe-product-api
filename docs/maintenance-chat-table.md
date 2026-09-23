# Maintenance working table

The existing `listMaintenanceBoard` query returns `markdown` for direct display
in chat, a structured `rows` array, exact ten-column order, record IDs/versions,
stable `reference` values, matching and authorized totals, building counts, range,
`hasMore` and `nextCursor`. It performs the complete permission-filtered read
before sorting/filtering/paging. No spreadsheet or UI hosting is required.

Examples through the existing Task Management query tool:

```json
{"operation":"listMaintenanceBoard","arguments":{"building":"B Building","limit":20}}
{"operation":"listMaintenanceBoard","arguments":{"unassigned":true}}
{"operation":"listMaintenanceBoard","arguments":{"query":"plumbing"}}
{"operation":"listMaintenanceRoutines","arguments":{"building":"A Building"}}
```

Supported filters: `building` (B/A aliases accepted), `area` (exact), `status`
(record or displayed status), `priority`, `assignedTo` (exact), `unassigned`,
`query` (task/project/location/reference text), and `reference` (exact).
`includeArchived` retains its existing opt-in behavior. The one-time board
defaults to 20 rows, recurring duties to 100; either accepts `limit` from 1–100.
On subsequent pages resend the same filters and `nextCursor`. Changed results or
filters reject the cursor with 409 rather than silently skipping rows. Counts
never include records the actor cannot read. `complete` is true only when the
current response contains every matching row; the last page alone is not a full
list. Keep the page count visible and offer continuation in chat.

`detailLevel: compact` is the default. Notes are verbatim excerpts up to 240
characters, with a truncation flag and visible marker. `detailLevel: full`
preserves full notes in the response; no stored data is rewritten. The recurring
query now projects compact `routines` as well as `rows`; clients needing all raw
routine fields must request `detailLevel: full`. The original ten columns remain
available in both views. Actual costs and estimates stay distinct; source photo
placeholders never count as attachments. Proposed assignments are labeled.

## Numbered selections

Each displayed row has a `number`, continuous across groups and pages of the same filtered snapshot. Numbers appear in the Task cell to retain the ten-column layout. `selection` includes the snapshot, record type, and each displayed number’s immutable record ID, reference and version. Numbers are view-local, not new stored task identities.

Resolve every number from the latest working table actually shown to the user before the first write; freeze that set of IDs throughout the batch. A hidden detail query must not replace the displayed mapping. Never refresh and recalculate positions between archives. If the mapping is unavailable, the requested number was not displayed, snapshots differ, or tasks/routines are ambiguous, show a fresh table and clarify before mutations. Existing current-version commands still enforce access and concurrency; report partial outcomes individually and refresh after the batch.

“Delete 1, 3, 5” means recoverable archive (`updateTask` status `dropped`, or `updateRoutine` status `archived`). It never invokes permanent deletion. No new command, service, or persistent numbering schema is introduced.

When a user requests a change by number, task title or reference:

1. Resolve the exact record from the displayed row or a `reference` query. Ask
   only when the target/change is ambiguous; use the displayed selection mapping for numbers, never newly computed positions.
2. Read current task details/version (`getTask`), or retrieve the full referenced
   routine through `listMaintenanceRoutines`.
3. Use existing commands, expected versions and an idempotency key. Preserve
   source notes. Append task notes through the existing note command when asked
   to add an update. Resolve authenticated staff identities for assignments;
   proposed source names do not establish acceptance.
4. Read back the saved record and refresh the referenced row. A historical chat
   table does not update itself.

Use `recordMaintenanceRoutineCompletion` with a stable occurrence key for a duty
completion; it must remain active. Retrieve private photos through the existing
authorized attachment flow. Outgoing message approval remains a separate action.

Verification covers permission boundaries, complete filtering/pagination, stable
references and stale cursors, Markdown escaping, unassigned/proposed assignments,
unknown versus zero costs, unchanged source notes, versioned task completion and
append-only recurring completion. Live deployment and client acceptance are
recorded separately in Dan's Developer Tools.

## Photo indicators and previews

The Images column shows a camera icon and exact photo count or `No photos`.
The first photo has private Open photo and Download links. Keep this column
visible when presenting the table.

For requested previews, use `tasks_open_maintenance_photos` in FBC Staff Tools
with the exact `M-xxxxxxxx` reference from the board. Pass `includeArchived:true`
only when archived tasks were requested. The embedded MCP Apps component shows
12 photos per page, enlargement, original download and Refresh to renew links.
It uses the existing authorized Maintenance board and task attachment queries;
no new storage, public bucket, login, or operational database is introduced.

Markdown image previews failed actual ChatGPT acceptance on September 23 despite
valid HTTP 200 inline JPEG URLs. They are no longer the display contract. The
signed `preview` field remains available for the embedded viewer and direct
opening. Text-only clients retain photo counts and open/download links.

The component follows the existing BHE gallery bridge pattern but reads only
Maintenance-owned task attachments. Its two read-only actions must be refreshed,
enabled and saved in the workspace app before fresh-client acceptance. Tests
and a valid signed link do not establish actual ChatGPT rendering.
