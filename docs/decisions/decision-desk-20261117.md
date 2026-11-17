# Decision Desk: descriptive phases and durable retrieval

Accepted by Dan November 17, 2026 in the working conversation. Dan explicitly
rejected approval gates and required steps; phases are descriptive labels only.

Owner dan; existing Task Management backend remains the system of record.
Extend existing thought records with decisionDesk {phase, reviewDate, deadline}.
The same stable thoughtId, immutable exact wording, append-only reflections,
identity/delegation rules, version checks and idempotent command execution remain.
Provide dedicated list/get/capture/update/note operations and live canonical
guidance. Membership is explicit metadata, never inferred from tags. This avoids
copying existing source history or introducing a service/database/OAuth client.

Phases: blue_sky, shaping, sarah_review, ready_to_decide, decided, parked.
Transitions are unrestricted and have no external effects. Review dates and
real deadlines are distinct Pacific calendar dates. No automatic reminder service
is introduced. Prayer stays in Prayer Management; sharing uses Shared Thoughts.
No automatic sharing, notification, spending, scheduling, task creation or review
requirement. Original Think Tank status stays independent.

Preserve existing Philippines Preacher's Delight record in place, label shaping,
review November 20, 2026, no decision deadline. Do not infer a final decision.

Verification: unit/contract tests, source/gateway checks, production readback,
then fresh signed-in client recognition. Local implementation is not deployment
or fresh-client acceptance. No secret or private decision wording in Git.
