# ADR 0032: Dan Notebooks

Status: Accepted; implementation in progress
Accepted by: Dan Kirchner, 2026-09-21, explicit instruction to implement the reviewed Notebooks plan.
Owner: dan
Serves: dan (and authorized delegates)
Domain: notebooks
System of record: dedicated collections in the existing core Firestore database

## Decision

Add a Notebooks module to the existing core API and expose three intent-based
operations through the existing Dan Life OS MCP connection. No separate app,
OAuth client, database, or web UI. Preserve exact text and immutable revisions;
assistant summaries are separate. Think Tank remains a distinct owner of
incubating thoughts. Other source-owned domains are linked, never copied.

Each notebook has one stable parent ID; notes belong to exactly one notebook.
Moving or renaming a notebook does not rewrite descendant records. Archive
state is inherited dynamically; independently archived descendants stay
archived on branch restoration. Unfiled is created transactionally on first
unfiled capture and cannot be moved, renamed or archived. Parent cycles are
rejected inside transactions. Names are display labels, never identifiers.

## Persistence and retrieval

Use danNotebookBooks, Notes, Revisions, Chunks, Jobs, Receipts, and Audit
collections (each with the danNotebook prefix). Canonical ownerSubject comes
from existing Dan owner configuration; authenticated actorSub is independent.
Reuse the private-access/delegation checks before reads, writes, history,
search, and job inspection. Internal workers use durable job ownership and
the existing authenticated service-to-service boundary.

Note mutation, immutable revision, tokenized overlapping chunks, job, command
receipt and audit entry commit atomically. Compare expectedVersion in that
transaction. Receipts bind actor, owner, key and exact command fingerprint;
retries cannot duplicate mutations after a crash. Receipts are retained in v1.

Lexical retrieval uses indexed owner/token queries; meaning retrieval uses
owner/notebook/model-filtered Firestore nearest-neighbor queries and existing
Vertex embeddings. Re-check current versions, permissions and paths before
returning results. Fuse exact-match priority, token coverage and reciprocal
ranks; deduplicate note results. Cursor bindings detect changed queries and
ranked result pages. Return explicit bounded coverage and indexing status.

Durable per-version embedding jobs use a dedicated dan-notebook-indexing queue
on existing Cloud Tasks infrastructure and an internal endpoint on the core
service. A queue isolates retries and embedding load from sermon transcription.
Failure leaves source text and lexical retrieval intact. Queue exhaustion or
enqueue failure is recoverable with retryIndexing. An obsolete worker cannot
publish embeddings over a newer revision. No automatic web fetching.

## Acceptance and rollback

Test hierarchy changes, archive inheritance, revision restore, concurrent edits,
idempotent replay, delegated owner preservation, unauthorized access, lexical
pagination, semantic scoping, and failure/recovery. Verify actual Firestore
indexes and real embeddings separately from unit-test doubles. Accept only
after a fresh Life OS client can discover tools and save/find/edit/read a note.

Deploy backend before gateway. Retain prior Cloud Run revisions for rollback;
new collections are additive and need no migration of existing records. Roll
back gateway and core traffic, pause the indexing queue if needed, and retain
notebook data. Never delete user notes as part of rollback.
