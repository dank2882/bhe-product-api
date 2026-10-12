# Knowledge Repository sources and passage retrieval — October 12, 2026

Status: Implemented and deployed. Backend verification and a fresh signed-in ChatGPT source search passed. Workspace instructions published as 1.0.5. Admin catalog confirmation and actual article/lesson acceptance remain pending.

## Released code

- API commit `afab54f8ba796a8b3395b8f2d8ff9eae77c9b587`; revision `bhe-product-api-00331-js4`, 100% production traffic.
- FBC MCP commit `8691caa6cadf83d8c4ff1699c019e611c7d49ab2`; revision `fbc-staff-tools-mcp-entra-prod-00067-h2c`, 100% production traffic.
- Additive source metadata/lexical/vector indexes: all five READY in `chatgptstorage`.
- Large exact text, revision source snapshots and numeric embedding caches have unused scalar indexes disabled.
- Existing Cloud Run services, backend credential, staff permissions, Firestore database, Vertex embedding model and Cloud Tasks queue were reused. Image originals remain in Dropbox.
- Source control baseline matched the serving source labels before changes. Both releases ran the existing clean-checkout/GitHub-main release procedure and independently recorded deployment evidence.

## Verification

Backend suite: **841 passed**. Gateway/platform suite: **228 passed**. Checks passed in both repositories. Focused source tests cover exact text and Unicode offsets, distinct article/lesson identity, history, conflicts, concurrency, permissions, stale imported evidence, queue failures, embedding failure/fallback, cache reuse, cursor completeness, response limits, source diversity and imported-source classification.

Live checks on the final API revision:

- unknown actor and missing backend credential denied.
- library note automatically indexed with exact source text.
- existing source classification preserves owning record and original text.
- separate article and lesson recall; exact text read-back.
- Cloud Tasks and real Vertex indexing completed.
- real Firestore vector search; bounded response; exact source citation.
- idempotent save; stale update rejected; old revision retained; unchanged text reused embeddings.

The live sample search took 474 ms inside the backend, read 2 candidate documents and 1 source metadata record, used one query embedding and returned 1084 bytes. This is one small synthetic-fixture measurement, not a corpus benchmark, end-to-end chat latency, or billing estimate. Metadata-only updates reused the embedding cache: **zero new embedding calls**. Test source/library records and their derived text/index/cache records were removed after checking their fixture prefixes; audit evidence was retained.

A new unauthenticated discovery-only MCP client found 123 tools, including `repository_source_query` (read-only) and `repository_source_command`. This verifies deployed discovery, not a refreshed workspace app or authorized end-user execution.

## Existing material

Backend backfill independently read back exact text and indexed **1 existing non-test document**. Its text layer is AI-corrected OCR, not human-reviewed historical proof. Two records explicitly labeled `debug-test` were excluded from the research index. Seven records without usable text were skipped. No original records/files were edited or removed. Indexing of the imported source completed using one embedding call. The Tyndale article and lesson notes have not been located/provided; the imported handwritten-note PDF must not be represented as either work.

## ChatGPT publication and client read — 21:52 UTC continuation

Published **1.0.5** to the existing FBC Staff Tools Production v2 listing using its in-place Upload new version action. Started from the downloaded 1.0.4 package; changed only the version and Knowledge Repository skill, preserving all other files and the exact `.app.json` binding. The independently downloaded 1.0.5 package matched all **39 files byte for byte**. Submitted ZIP SHA256: `ce314ff4374fc81f6b7f85e59052bd13f299fba736603616c844cc8b72fd781e`.

A [fresh signed-in ChatGPT conversation](https://chatgpt.com/c/6acd568f-7148-83e8-a9c2-66b1496770a1) used `repository_source_query` / `searchSources` with query Tyndale and limit 3. It returned `tyndale_handwritten_note`, source `source-a199b3ed8860fce04022b01dd6bcc93f`, document/ocr_text, version 1, indexing completed. The activity displayed “Searched Tyndale Knowledge Repository sources”; the independent Cloud Run request log recorded HTTP 200 for `/repository/sources/query` at `2026-10-12T21:52:25.104713Z`. No source writes were requested. This verifies Dan's fresh-client source search, not actual article/lesson comparison or Pastor acceptance.

The same fresh client also reported `repository_source_command` discoverable with saveSource, importSource and retryIndexing; it was explicitly instructed not to execute any command. This is client-reported definition discovery, not a verified client mutation. The public MCP endpoint independently still advertised 123 tools, including both source tools. The admin catalog discrepancy is tracked below; working client retrieval is not evidence of a saved admin-switch change.

## Remaining gates

1. Reconcile the ChatGPT admin catalog: after sign-in and refresh, a fresh chat successfully executed `repository_source_query`, but admin Tools still displayed 119 enabled tools and no `repository_source` matches. Admin Refresh reported “Tool refresh could not be confirmed. Close and reopen Tools to inspect the current catalog before trying again.” Reopening did not resolve the discrepancy. No permission switches were changed. Previously disabled `trip_coach_get_journal` and `trip_coach_journal` remained off. Do not claim both admin switches were verified or create a replacement app/change OAuth.
2. Use a fresh intended-user session with the actual Tyndale article and lesson notes: save/import each with accurate identity/content kind, independently read back, find each by natural wording, retrieve/cite relevant passages, and compare without merging attribution. No actual-source or Pastor-client acceptance has been claimed.

See [accepted decision](../decisions/repository-source-retrieval.md). Developer Tools decision/workstream: `repository-source-retrieval-20261012`.

## Recovery and operations

Sources have exact immutable revisions; ordinary updates require the current expectedVersion. Imported snapshots refresh from the owner, with metadata override version checks. Inspect getSource/getIndexingStatus for freshness and job status; retryIndexing uses the current source version. Backfill defaults to dry-run. Never silently truncate sources over the 100,000-character intake limit.

Before this feature the serving API was `bhe-product-api-whatsapp-1009a` and FBC gateway was `fbc-staff-tools-mcp-entra-prod-whatsapp-1009a`. Traffic can return to those revisions if necessary; additive source records remain intact. Existing image migration requires Dropbox-aware revisions. Queued indexing work requires a compatible source endpoint and may need retry after rollback/recovery.
