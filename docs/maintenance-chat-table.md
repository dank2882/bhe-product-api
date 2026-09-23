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

When a user requests a change by task title or reference:

1. Resolve the exact record from the displayed row or a `reference` query. Ask
   only when the target/change is ambiguous; row position is not an identity.
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

The Images column must remain visible even when summarizing the table. It shows
`No photos` or a prominent camera icon and exact attachment count. For up to 20
photo-bearing rows on the current page, the first photo has Open photo and
Download links and an inline Markdown preview below the table, labeled by task
reference and title. Additional photos are retrieved conversationally with
`listAttachments` and `getAttachmentDownload`. That query now returns `preview`
for JPEG, PNG, GIF and WebP alongside the unchanged `download` response.

Preview URLs use inline content disposition and the existing 15-minute private
signed-link mechanism. These are previews of existing stored images, not new
thumbnail files. Client rendering determines their displayed size. No public
bucket, new endpoint or copied media is introduced. Render the returned Markdown
including its Photo previews section; do not replace it with a download-only
answer. Refresh the query when links expire.

Only the authorized, filtered page is signed, after computing the stable cursor
snapshot. Each attachment's parent authorization is checked again before URL
creation. A storage/signing failure preserves the count with Preview unavailable;
authorization failure fails closed. Non-raster attachments are never embedded.
