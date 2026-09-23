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
Full validation passed: `npm run check`, all 653 tests, and focused Maintenance tests.

Production API `bhe-product-api-00290-mqc` and worker
`fbc-maintenance-messaging-worker-00007-4sv` serve 100% traffic from runtime
commit `c0e0399`. Worker environment/secrets references and service identity were
independently compared with the prior revision and are unchanged. Authenticated
FBC Staff Tools queries returned item numbers 1–5, ten columns, and a selection
snapshot; the live worker guide returned the new exact-domain admission policy.
The revised Quick Guide was independently read back byte-for-byte from shared
Maintenance project notes version 6 with Shawna’s existing editor membership.
Natural-language execution in Shawna’s own ChatGPT account remains a client
acceptance check; automated tests do not prove that client behavior.

Actual ChatGPT read-only acceptance in Dan’s existing FBC workspace conversation
showed all ten columns and rows 1–5. A hypothetical “delete 1, 3, 5” correctly
selected M-e158bb38, M-b95f7cc1 and M-20cb1085 and explicitly described recoverable
archive. No edits were requested or performed; independent API read-back showed
the same five IDs, versions and snapshot. Evidence conversation:
https://chatgpt.com/c/6ab404f2-6f04-83e8-8f00-246f76db972b

A new real domain-sender email has not been sent as part of this release.
Domain routing is covered by automated ingestion tests and the deployed guide;
Shawna’s actual numbered mutation and new domain-sender mail remain operational
acceptance checks. No real tasks were archived for this test.
