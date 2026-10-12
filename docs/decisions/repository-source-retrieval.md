# Source-aware Knowledge Repository retrieval

Status: Accepted by Dan October 12, 2026: “yes go ahead and build this” following the source identity, passage retrieval and cost review. Implementation and live verification are recorded separately in the release record.

## Decision and ownership

Extend the existing BHE Knowledge Repository, Cloud Run API, authenticated FBC gateway, Firestore `chatgptstorage`, Vertex embedding adapter, and existing Cloud Tasks indexing queue. No new service, database, identity, connection, or permanent file store. The shared notebook queue transports repository jobs to a separate endpoint; repository records and permissions remain separate from private notebooks.

Preserve three levels: existing concept items, identifiable sources, and exact passages. Sources distinguish articles, lessons, research notes and documents. Lessons must identify notes, manuscript or transcript; notes never prove exactly what was spoken. Authors/speaker/date are supplied facts, not inferred from the uploader. Dates are date-only; unknown values stay empty. Optional item links require existing item IDs. External references are pointers only: they confer no permission and never import private records automatically. Any existing owning system remains authoritative.

New articles/lessons have stable source IDs and immutable revisions containing the exact original wording. Updates require an expected version. Existing documents/notes remain authoritative; `importSource` reads their best OCR/exact note text directly in the backend and creates a derived, versioned search snapshot with the upstream ID, text layer, provenance and fingerprint. These snapshots cannot be edited as standalone sources. Refresh imports from their owner. Import may supply verified bibliographic metadata to classify an existing PDF/note as an article or lesson; subsequent refreshes retain those overrides. Changing existing overrides requires the current version. Existing legacy tools/IDs and file storage remain unchanged.

## Retrieval and cost controls

- `searchSources` retrieves compact metadata using token indexes and bounded cursor pages. Title/author/speaker/type/date/item filters support particular-work recall. Ranking is within a page; follow continuation for complete candidate coverage.
- `searchPassages` combines indexed words and Vertex/Firestore vector retrieval. A source ID narrows a question to one article/lesson. Responses default to five passages and an 8,000-character evidence budget; hard maxima are ten passages and 20,000 characters. Candidate bounds and semantic availability are explicit. This is ranked retrieval, never a claim of exhaustive historical coverage.
- `getSource` defaults to metadata; full exact text and old versions are opt-in. `getPassage` retrieves cited text with optional neighboring passages. Citations include source identity/type, content kind, version, section heading and exact UTF-16 offsets. Offsets are not invented page numbers.
- Chunking is deterministic, paragraph/newline-aware, bounded at 1,800 characters and preserves text without gaps. No generative model writes source text, summaries, dates or historical conclusions.
- Revisions, current lexical chunks, indexing jobs, audit and idempotency receipts are committed atomically. Old chunks become inactive but remain available for historical citations. Search rechecks the current revision and upstream fingerprint before returning evidence; stale imported evidence is excluded and counted.
- Background indexing reuses content/model-keyed embedding cache entries. Query embeddings occur only for hybrid search. Metadata and lexical queries do not invoke AI. Failures retain durable jobs and explicit status; staff can retry with a current version. Queue deliveries use named tasks and a job lease. Original save success is independent of dispatch success.
- New library notes and successful OCR steps attempt backend indexing under the authenticated staff identity. Legacy calls without an individual identity retain their original behavior and report that an individual import is required. Existing source text can be backfilled with the bounded deployment script, without passing the text through chat.
- Telemetry logs only request ID, latency, candidate/source read counts, returned characters and query embedding calls. Jobs retain embedding calls/cache hits. These are operational counters, not a dollar-cost claim or complete Firestore bill.

## Limits, alternatives and safeguards

Initial intake accepts 100,000 UTF-16 characters per source, matching exact library notes. Larger material must be handled explicitly rather than truncated. Source discovery processes at most 100 indexed candidates per page. Passage search considers 100 lexical and 40 semantic candidates and reports bounded coverage. A separate enterprise search service could improve very large-corpus ranking, but adds infrastructure and is not justified by current evidence. Revisit using measured quality and latency.

All source tools require live repository read permission; commands require write permission. Worker endpoints retain existing backend authentication. Originals and derivative indexes contain shared BHE research only. Generated imagery, private prayers and care records do not enter this text index.

Old collection-scan document/item tools remain for compatibility and archive completeness. Clients should prefer the new indexed source path for research; the migration receipt identifies anything not indexed. No canonical summary is automatically approved. No deletion or destructive legacy migration is introduced.

Rollback is traffic rollback to the previous API/MCP revisions; additive source records remain dormant and intact. Queue jobs may fail until the compatible API returns and can be retried. Do not roll back image storage to GCS-only versions.

## Acceptance

Tests must cover independent article/lesson recall, exact citations and full text, old-version retrieval, stale updates, idempotency conflicts, concurrent edits, stale upstream OCR, permissions, queue/embedding failures, incremental cache reuse and response budgets. Verify indexes READY, production traffic, real embedding execution and backend permission checks. Then publish the two tools through the existing workspace app and run a fresh intended-user test. The actual Tyndale article and lesson were not supplied during design; synthetic test text is not their content and must not be represented as such.
