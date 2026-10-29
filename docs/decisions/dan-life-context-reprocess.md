# Reprocess saved Life Context evidence inside the owning backend

Accepted October 29, 2026: Dan approved adding the proposed operation and finishing live verification. Extend the existing Life Context backend and Life OS MCP; no new store, service, authentication flow or collector.

`reprocessContext` / `POST /life-context/current/reprocess` / `life_context_reprocess` accept only `runId`, positive `expectedVersion` and bounded `reason`. Authorize the primary Dan subject before evidence access. Collection must be enabled under the existing controls. Load original excerpts and source coverage from the immutable source revision identified by expectedVersion; never feed old summaries to the model or return source excerpts to the caller.

Reuse the existing collection transaction, model, validators, budget reservation and atomic current-version check. Bind the idempotency fingerprint to authenticated actor, full packet and reprocess origin, so collect and reprocess IDs cannot collide. Record the originating source revision in receipts and the new revision. Exact replays after current advances read the same immutable source and return the original receipt without inference. Failed/processing runs remain explicit and are never retried automatically.

Same model/prompt/evidence can reuse existing output without refreshing its expiry. A changed model or prompt creates a new content fingerprint and invokes Google. Preserve original evidence timestamps and partial coverage; reprocessing is not fresh collection. No approved-profile or source-record writes.

## Validation

Core tests exercise original-evidence preservation, sourceVersion null handling, no excerpt disclosure, authorization before reads, disabled collection, missing/empty evidence, strict inputs, stale versions, budget exhaustion, failed/successful/concurrent replay and operation-ID collision. MCP tests exercise fresh SDK discovery, narrow schema, write/open-world annotations, existing OAuth scope, actor forwarding, route/body parity and safe failures.

Live acceptance must use the authenticated Life OS connection, current expectedVersion and a fixed run ID, then independently read the receipt, current summaries, purpose views and unchanged approved profiles. Use counts and non-content receipts only for engineering evidence. This approval does not enable daily scheduling.
