# Maintenance numbered items and church email submissions

Dan requested short numbered commands such as “delete 1, 3, 5” and authorized
requests from anyone with a foundedonfaith.com email address on September 23.

## Implementation

- The existing task/routine table now shows view-local item numbers within the
  Task cell, retaining all ten columns and permanent M/R references.
- A response selection map binds displayed numbers to IDs, versions and a
  snapshot. Clients resolve every selection before writes, use existing
  versioned commands, report individual outcomes, and refresh after the batch.
  Missing/ambiguous displayed mappings require clarification; numbers are never
  recovered by recomputing current positions. “Delete” means reversible archive.
- The existing Graph intake admits exact foundedonfaith.com From addresses to
  pending review without individual reporter setup. Explicit revocations remain
  effective. Other unknown domains stay quarantined. No messages are sent and
  no tasks, reporter consent, or staff grants are created by intake.
- The versioned Shawna Quick Guide explains these controls; its shared copy is
  distributed through the existing Maintenance project notes.

## Verification

Focused tests cover continuous numbering across groups/pages, filtered snapshot
changes, batch archiving the original IDs despite row shifts, recoverable
history, routine mappings, exact-domain matching and lookalikes, replay history,
explicit revocation, external reporter approval, and unchanged outbound consent.
Live deployment and guide read-back receipts will be recorded after release.
Natural-language execution in Shawna’s own ChatGPT account remains a client
acceptance check; automated tests do not prove that client behavior.
