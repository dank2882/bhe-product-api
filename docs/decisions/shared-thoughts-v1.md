# Shared Thoughts V1

Status: implemented; release and client acceptance tracked separately below.
Requested by Dan, October 25, 2026: implement the smallest two-account thought
sharing workflow using existing Life OS infrastructure, explicit approval,
private retrieval, immutable original wording, contributions and revocation.

Owner: `dan`. Serves: Dan and Sarah. System of record: the existing Task
Management backend, `danSharedThoughts` in the existing core Firestore database.
Life OS remains the conversational doorway, not a database.

## Implementation boundary

Reuse core Cloud Run, Firestore, task query/command endpoints, the Life OS MCP
connection, Entra subjects and scopes, task audit and receipt collections.
No app, service, OAuth client, dashboard, notifications or conversation archive.
Think Tank already preserves wording but its existing broad delegation does not
meet explicit sharing. Shared Thoughts therefore uses a bounded separate record
collection within the same backend. It never scans or exposes private Think
Tank entries, notebooks, tasks, prayer or care records.

`SHARED_THOUGHTS_DAN_SUBJECT` and `SHARED_THOUGHTS_SARAH_SUBJECT` bind the two
existing individual Entra identities. Configuration is backend-owned; no caller
can supply recipients, authors, timestamps or identity aliases. Empty/matching
configuration fails closed. Staff, admin and broad private delegation grants do
not grant access to this collection. Existing broader Sarah delegation is not
changed by this feature. This is feature-local privacy, not a revocation of her
previously approved access to other Life OS domains.

## Record and workflow

Dan prepares a private immutable draft with selected original text and separate
AI title/summary. Read it back and show its exact content and Sarah as recipient.
Only after Dan approves may the client share its current version and content
digest. The digest includes recipient and all wording/history. Draft revisions
use a new private draft; the small V1 has no mutable source-text operation.

Sarah sees only currently shared records through these operations. Both people
can append contributions when authorized by the signed-in person. The backend
sets individual author and date and serializes a monotonically increasing
sequence. No contribution can edit or impersonate another contribution.

Dan may revoke sharing. All subsequent reads, search and writes deny Sarah,
including command replay. Previously viewed text cannot be recalled from her
chat. Re-sharing exposes the retained history and requires renewed approval.

Mutations, actor-bound fingerprinted receipts and content-free audit events
commit in a single Firestore transaction. Current permissions are checked before
receipt replay; receipts contain IDs, state and version, never text. Versions
prevent stale approvals, lost contributions and races with revocation. Exact
source text preserves whitespace and Unicode. The record is bounded to 100
contributions, 200 KB total, 10,000 characters per original passage. Search
returns bounded pages from an identity-filtered query; cursors bind actor and
query and cannot cross identities. Follow empty filtered pages when a cursor
remains. No vector index, queue or asynchronous processing is needed.

## Operating authority

`getSharedThoughtContext` returns versioned owning-backend guidance.
Maintained Life OS `SKILL.md` and `references/shared-thoughts.md`, gateway startup
instructions and task catalog route natural language to it. Existing task MCP
query/command schemas expose seven operations; no magic phrase is required.

## Verification and rollback

Automated tests cover the full collaboration flow, exact wording, attribution,
chronology, private drafts, unrelated/alias/admin denial, approval digests,
revocation, re-sharing, receipt replay, concurrency, atomic failure and cursors.
Authenticated service-boundary tests are separate from two real ChatGPT logins.
A successful internal test must never be called Sarah's client acceptance.

Release backend before gateway; verify both ready revisions and traffic. Retain
prior revisions. Roll back gateway and core traffic if necessary; retain saved
thoughts, audits and receipts. Do not delete user records during rollback.

Release evidence: see `docs/shared-thoughts-release-2026-10-25.md` when created.
