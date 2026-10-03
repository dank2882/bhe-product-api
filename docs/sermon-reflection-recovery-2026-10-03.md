# Sermon reflection recovery

Accepted repair, October 3, 2026: Dan approved fixing the interrupted reflection
save, safe retries, and removal of the confirmed duplicate.

## Incident

Production request `cd4412c0-2b8e-48fb-8915-1f3f07358dc0` failed at
17:17:38 UTC with `sermon_development_turn_capture_required`, after creating an
analysis. Request `2b768825-9cb3-4f78-9b28-2b73cf97d2b9` completed at 17:18:30
UTC but created another analysis for the same reviewed proposal. The original
operation-key cache could not resume a failed operation; a new key repeated
non-atomic writes. No exact duplicate profile observations were found.

## Implemented behavior

- Reuse the existing Firestore transaction helper and collections. Stage domain
  writes and commit the reflection, selected profile observations, exact lines,
  Scripture notes and proposal-scoped receipt in one transaction.
- An identical proposal replay returns its stored result, including across
  different operation keys. Failed/interrupted attempts can resume with the
  original key. Changed selections conflict rather than silently expanding a
  previous approval. Legacy saved proposals fail closed for explicit review.
- Transcript excerpts approved through reflection belong to post-preaching
  learning; an active development session does not block their preservation.
  Ordinary live-development turn capture remains required.
- Search indexing runs after the durable save. Failure reports saved content
  with indexing pending and directs the caller to rebuildSermonChunks.
- removeDuplicatePreachingAnalysis requires explicit confirmation, the sermon,
  both IDs, both current timestamps, and identical reflected content from the
  same proposal. It removes the duplicate from normal results but retains its
  content, ID, removal time and replacement link for recovery/provenance.
- Keep the existing endpoints, ownership, credentials and gateway scopes. The
  command dispatcher now accurately advertises destructive capability.

## Verification

Local: 813 backend tests, 218 gateway tests, backend contract checks, and isolated
real-Firestore acceptance passed. Tests cover rollback after staged writes,
active-session compatibility, same/new-key retry, concurrent proposal replay,
selection conflicts, indexing failure, legacy duplicates, and guarded removal.
The disposable Firestore fixture was independently verified removed.

Deployment and live cleanup verification are recorded separately below after
release. Prior production rollback revisions: bhe-product-api-00321-952 and
dan-life-os-mcp-00042-raf.

## Live verification

- Backend revision `bhe-product-api-00343-xac` (`fb8516a`) and Life OS gateway
  `dan-life-os-mcp-00044-ven` (`a097730`) are Ready and each serve 100% traffic.
  Existing configuration, endpoints and credentials were retained.
- Candidate checks and fresh MCP SDK discovery verified the cleanup operation,
  destructive annotation and refusal without confirmation. Connected Life OS
  OAuth catalog retrieval independently reports catalog `1-74976fe3ac3e` and the
  new operation. The SDK test is distinct from a new ChatGPT conversation.
- Approved cleanup receipt:
  `sermon-operation-88c355a67d9b268fbaac75276dc4c976b109ce46`.
  The duplicate ending `57c2771d` is recoverably removed; retained analysis
  ending `2a3f2879` is unchanged. Connected Life OS query independently returns
  exactly one analysis for the sermon.
- Before/after content hashes match for the retained reflection, sermon, source
  records, all nine checkpoints, four Scripture notes, note import and preaching
  profiles. No new reflections, learning or profile observations were generated
  for the user's sermon during acceptance.
- Scripts: `scripts/verify-sermon-reflection-transaction.cjs` uses disposable,
  isolated Firestore records and verifies their cleanup;
  `scripts/verify-sermon-duplicate-cleanup.cjs` is limited to this exact incident,
  and requires `--apply` for removal. Gateway SDK acceptance is in
  `bhe-agent-platform/scripts/verify-sermon-recovery-mcp-live.mjs`.
