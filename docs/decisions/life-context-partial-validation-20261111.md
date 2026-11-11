# Life Context partial validation

Accepted by Dan November 11, 2026: "Keep valid summaries; flag omissions."
This supersedes whole-snapshot rejection for recognized observation-local
validation failures. Existing authorization, original-evidence ownership,
source bounds, version checks, expiry, budgets and no-automatic-retry policy
remain. No new service, store, credentials or schedule.

Each generated observation passes the same exact-quote, citation, shape,
length, purpose, certainty, narrative-pronoun, family-relationship and year
checks. A rejected observation is omitted, never rewritten or accepted.
The remaining observations retain their text, citations and original ordinal
IDs. If all generated observations are rejected the run still fails, preserves
previous context through its unchanged expiry and follows the November 10
failure recovery policy. An explicitly empty generated array is distinct from
all-rejected output. Malformed envelopes, provider/alias errors and unexpected
exceptions remain whole-run failures. There is no inference retry.

Successful receipts, immutable revisions and compact current retrieval expose
`validation`: status passed/partial, candidateCount, acceptedCount,
rejectedCount and bounded rejections with original zero-based observation index
and fixed reason/detail categories. No rejected prose, source quotes, identity
or arbitrary exception text appears in these diagnostics. Counts describe the
whole snapshot even when retrieval selects one purpose. Legacy snapshots return
null validation rather than inventing historical verification.

Partial means incomplete summary coverage. Clients must report omissions and
never interpret them as absence, completion or cancellation. A partial result
does not advance complete-source checkpoints. A newly published partial result
replaces the bounded snapshot; it does not silently append old observations.
Reuse retains omission metadata and original observation expiry. Successful
publication resets consecutive failed-refresh counts. Independent semantic
review remains required; accepted mechanics do not prove faithful meaning.

Prompt v13 removes a conflicting pronoun exception and adds the narrative rule
to the response field description. Gendered source quotations remain exact.
Pronoun diagnostics now locate the observation and count offending terms.

Tests cover mixed-validity publication, unchanged accepted wording, stable
ordinal IDs, all-invalid retention/repeated failure, unsupported quotes and
relationships, malformed/unexpected/provider errors, metadata in receipts,
selective retrieval and reuse, no checkpoint advance, expiry, no retries and
existing authorization/version/budget invariants. One real-model fictional v13
evaluation generated ten observations: zero prohibited narrative pronouns and
one family-phrase rejection. Revalidation of this same output exercises partial
publication without another model call; it is not a second independent model
trial. Live recovery is separately verified against original source evidence.

Dan's repair authorization includes one controlled November 11 recovery using
the retained original 34-entry morning sample, run
`life-context-v13-recovery-20261111`, expected current version14 after recheck.
This is manual recovery, not scheduled success or a new normal daily ID.
Temporarily permit only one extra daily attempt under the unchanged monthly
ceiling and restore normal daily1 in all outcomes. Preserve the failed normal
receipt. Reuse existing authenticated publication; do not substitute old
summaries, populate approved profiles or change source records.

Deployment and live acceptance are recorded separately. Keep the existing
08:30America/Los_Angeles timer with the same timing gate, bounded source reads
and semantic review. Cold-start/token refresh/sleep reliability are not proved.
