# Provisional Life Context processing slice

Date: October 29, 2026 Pacific. Accepted implementation scope: Dan's “ok go ahead”
after the manual collection report and recommendation to test the desktop runtime
and build a minimal GCP processing/retrieval flow. Implementation is local; this
record does not authorize production population, deployment, or scheduling.

## Reuse and ownership

Dan owns the current observations in the existing core Firestore database under
`danLifeContext/observations`. Approved `danLifeContext/profile` and Correspondence
Voice Profile are untouched. This is a bounded derived context snapshot with
immutable revisions, not a replacement for tasks, messages, calendar, care or
sermon records. The existing core API, exact primary-Dan authorization, Google auth
client, runtime identity and Life OS gateway are reused. No new service, credential,
OAuth registration, queue, vector database or general agent framework.

Reviewed the engineering constitution/index, stable identity ADR 0003, Life OS
connection ADR 0019, original profile release record, manual collection trial,
core/gateway implementation, Developer Tools workstream and current Cloud Run/IAM
metadata. Developer Tools briefly returned 500 and recovered on one retry; this
does not establish a broader reliability or OAuth fix.

## Runtime evidence

Codex CLI 0.165.0-alpha.1.2 exposes the existing Messages MCP. A standalone MCP
client, with only HOME/PATH rather than desktop session/pipe variables, connected,
discovered tools, found one chat and read one message in a bounded October 28 window.
It emitted counts only and retained no source content. More chats remained and the
message response had no native message ID. Script lives in platform:
`scripts/probe-life-context-messages.mjs FROM TO`.

This proves a noninteractive source process on the same awake, logged-in Mac,
not a launch-at-login/scheduled/locked/asleep/offline test. No second AI agent was
started. WhatsApp still lacks a verified unattended collection and complete long-text
contract. CLI Life OS authentication also differs from this app connection and was
reported not logged in. Do not copy app tokens or private session pipes into a job.
No collector daemon or scheduler was installed to conceal these gaps.

## Contract and state

Core endpoints: POST `/life-context/current/collect`, `/query`, `/run`. The gateway
adds `life_context_collect`, `life_context_current_get`, `life_context_collection_run`.
Collection accepts an explicit whole bounded snapshot, expectedVersion, stable runId,
reason, up to seven source checks and 80 minimal evidence excerpts, total 64KB.
Each source has status, bounded window, checkedAt and hasMore. Each excerpt has ID,
source reference/time, native versus provisional identity, optional source version,
exact text and a server-computed content fingerprint. No client owner/actor fields.

The model receives original evidence, not earlier generated summaries. Its output
is validated: at most 20 observations, 600 characters each, supported purposes,
explicit certainty and 1–6 real citations. The backend labels everything provisional,
attaches source metadata, and sets expiry at the earlier of 24 hours after processing
or seven days after the newest cited source. This is a review freshness bound, not
proof that a real-world situation expires then. Empty and expired are explicit.

Retrieval omits raw excerpts, filters by purposes, defaults to eight observations,
reports truncation, missing source coverage, failures/invalidation, and expiry.
Exact old revisions are marked audit-only. Revision lineage and the replacement
reason preserve corrections; omitted input is not interpreted as source deletion.

Transactions bind run IDs to exact actor/input, reserve budget before inference,
and acquire a two-minute lease. Model calls occur outside transactions. A replay
returns its original receipt and never calls the model again. A new changed run
requires the current revision; concurrent runs are rejected while the lease lives.
An expired lease allows an explicitly reviewed new run; late output cannot publish
over that newer run. A processing receipt after process termination stays visibly
stalled. Failed attempts are terminal, with no automatic retry/refund. Backend logs
contain only request ID and safe error code, not excerpts/provider responses.

Changed evidence immediately invalidates the older current interpretation, including
on model failure or budget exhaustion. Immutable old revisions remain audit-only.
Unchanged content reuses interpretations without refreshing their generation/expiry
timestamps. Freshness cannot be extended merely by reading the same old message.

This slice is intentionally a bounded snapshot replacement, not a completed
incremental collector. Durable source checkpoints, pagination/export adapters,
missed-run catch-up, correction discovery and retention/TTL enforcement remain
release gates for sustained collection. Revisions currently retain their evidence;
24-hour observation expiry is not deletion. No automated inference of message edits
or deletes is possible from provisional IDs.

## GCP and cost controls

The existing service identity has `roles/aiplatform.user`. The adapter uses the
existing Google auth client and global Vertex `generateContent`, fixed
`gemini-3.1-flash-lite`, JSON response schema, 80KB total serialized input,
4,096 output tokens, 45-second timeout and no automatic provider retries or tools.
An allowlisted fixed model prevents an arbitrary expensive model override.

Collection defaults OFF (`LIFE_CONTEXT_COLLECTION_ENABLED`). Enabling requires an
explicit `LIFE_CONTEXT_MONTHLY_LIMIT_MICROS` between 100,000 and 10,000,000 USD
microdollars. Reserve $0.10 per attempted generation without refund, at most two
attempts per Pacific day. A transaction enforces the configured UTC-month ceiling,
including concurrent calls/failures. This conservative reservation exceeds the
bounded model call estimate using current input/output rates; it is not actual
billing. Model pricing must be reviewed by November 29, after which the adapter
fails closed. No production settings were changed. Firestore/Cloud Run/storage
costs are outside this inference-only ceiling; full collection needs retention.

Official pricing inspected October 29: global input $0.25/M tokens, output $1.50/M
tokens. No minimum reservation is billed by this application; it is internal
budget accounting. Real token usage is retained per successful revision.

## Demonstration and limits

Platform `scripts/demo-current-life-context.mjs` runs actual core functions through
a fresh local MCP client and isolated in-memory storage. Optional `--vertex` uses
the existing runtime identity; `--developer-identity` explicitly tests with the
current gcloud developer instead. No automatic credential fallback.

Service-account impersonation was denied for the current developer. No IAM change
was attempted. A real GCP inference under the developer identity succeeded with
fictional examples; this does not prove deployed service IAM/runtime behavior.
The first output split an acknowledgement away from its planning observation.
Prompt version 2 and explicit semantic acceptance assertions fixed that example:
planning retrieval must cite both request and reply together, and the tentative
visit must retain tentative status. One successful example is not broad model
quality acceptance. Duplicate replay made no second model call; receipt and
selective read were independently exercised. No production data was written.

Remaining release gates: full checks/tests, exact clean committed release following
existing process, deployed service identity/Firestore/OAuth tests, fresh installed
ChatGPT discovery/use, WhatsApp completeness, source pagination/checkpoints, actual
locked/asleep/denied/offline/token-expiry tests and missed-run orchestration. Keep
06:25 America/Los_Angeles scheduling disabled until those pass. Production profile
population still requires Dan's exact-content approval.

## Local verification receipt

Core `npm run check` and all **917 tests** passed. Platform `npm run check` and all
**245 tests** passed, **1,162 total**. The five affected gateway tests passed again
after refining the collection tool's external-service annotation. Syntax and diff
checks passed. Correspondence code was unchanged; its suite was not rerun.

Final live model trial (prompt v2): **1,029 input + 146 output = 1,175 tokens**.
At the cited list rates this is approximately **$0.00047625** for that model call,
not an invoice or an estimate for a complete daily workload. Two model trials ran
in this turn; the first exposed the acknowledgement-filtering issue described
above. Final retrieved examples retained both request/reply citations together
and marked the museum visit tentative. All stores in the demonstration were
in-memory; there were zero production writes and no schedule change.

The full automated coverage includes auth denial before access, revisions,
idempotency/conflicts, concurrency, late completion after lease expiry, failed
and budget-blocked correction invalidation, budget reservation and daily cap,
unavailable/partial/empty coverage, expiry without renewal on identical content,
invalid citations, source bounds, provider timeout/no-retry settings, gateway
transport/actor propagation, annotations and profile-store separation.

Sources:
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output
- https://cloud.google.com/model-garden/pricing
