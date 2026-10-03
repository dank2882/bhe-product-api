# Daily brief accuracy repair, October 3, 2026

Dan authorized the repair after the supplied brief showed 42 active tasks and
three overdue items. Live investigation found 34 personal active tasks and zero
overdue tasks in `buildDailyReview`; an unqualified `listTasks` returned eight
additional Pastor Smith records. Visibility had been mistaken for responsibility.

## Implementation

- Core `ca0cc04`: unqualified Dan task lists now use the daily review's personal
  ownership rules. Explicit `view: personal` is the fallback contract; deliberate
  staff/project/assignee inventories remain available, labeled as authorized
  visibility. Existing read authorization remains independent. Trusted historical
  owner identities and approved delegates retain their personal view. A conflicting
  subject ID takes precedence over a legacy display-name fallback.
- Live review guidance supplies the personal fallback query and the confirmed
  `info@biblicalheritageexhibit.com` and `orders@biblicalheritageexhibit.com` addresses.
- Sermon readiness and the preaching dashboard expose counts and session references
  for preserved conversation development. The field score is explicitly not a
  percentage of preparation completed. Existing conversation plus empty canonical
  fields prompts review and assembly; it does not automatically select a passage,
  approve an outline, or rewrite Dan's words.
- Platform `e99711f`: maintained Life OS daily-brief instructions reflect these
  contracts. Existing bounded email scan limits remain unchanged. No new service,
  identity, permission, or domain record was introduced.

## Verification

Backend: 815 tests and all catalog/config checks passed. Platform: 218 tests and
syntax checks passed. Codex Life OS 1.0.12 was installed through the existing
marketplace; all skill files compared byte-for-byte with maintained source.

The read-only acceptance script is `scripts/verify-daily-brief-accuracy.cjs`.
It compares default/fallback task IDs with the daily review, retains the explicit
staff inventory, verifies mailbox guidance and dashboard evidence, and hashes the
sermon and development turns before and after the reads.

Candidate and production acceptance passed on revision `bhe-product-api-00345-gas`,
independently confirmed at 100 percent traffic. Rollback revision:
`bhe-product-api-00343-xac`. Both returned 34 personal active tasks, 42 explicitly
authorized staff/personal tasks, zero personal overdue tasks, and guidance version
`2026-10-03`. The dashboard retained 34 discussion turns (17 from Dan) for
`sermon-what-god-knows-9c4f556e`, recommending `assemble_preserved_development`.
The sermon/turn content hash remained
`69c8c862953935a6c786437b3f32b084fefcb6c98f00998e6c2df85ff1e30603`.

Independent connected Life OS reads verified personal scope and preserved sermon
development. Request IDs: tasks `87e5b115-7ad0-4b82-8b21-095706ed2bb8`, sermon
`31cddd94-6540-46f3-bcde-f9fc31093cf1`. The existing gateway required no deployment.

ChatGPT's separate existing plugin update is pending browser sign-in; the available
Chrome profile is signed out. Local installation does not prove ChatGPT publication.
No fresh ordinary-chat daily-brief acceptance has been claimed. Live backend
guidance already carries all three corrections for current connected clients.

Developer Tools workstream: `dan-daily-brief-accuracy-20261003`.
