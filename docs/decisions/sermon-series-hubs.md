# First-class Sermon Series Hubs

Accepted for consolidated release by Dan, September 21, 2026.

Sermon Workspace owns a Series Hub's exact initiating idea, burden, intended
response, preaching approach, boundaries, dates, provisional message map, and
exact development turns. Reuse existing series-folder storage and stable IDs;
individual sermons retain their own passages, preparation, and occasions.
Dedicated series operations create/adopt, retrieve, list, update and append
turns. No operational series is seeded by this release.

Updates and legacy adoption compare versions inside the existing Firestore
transaction boundary. Concurrent edits reject the stale write. Original source
ideas and identities are immutable; later wording is appended as development
turns. Message numbers must be positive integers, linked sermons must exist,
and serialized Hub data stays below the Firestore document budget. Complete
series reads fail explicitly at the read budget rather than silently omitting
records. Reconciliation reports provisional-map differences without rewriting
sermons or assigning preaching dates.

Verification includes exact source preservation, legacy compatibility, stale
versions, simultaneous edits, invalid links/numbers and operation-catalog
consistency. Client publication and live read acceptance remain separate from
local tests.
