# Life Context quotation failure investigation — November 9, 2026

Status: locally implemented and tested candidate; not deployed or semantically accepted.

The production run `life-context-2026-11-09` failed with validation reason
`unsupported_quote`. Its receipt does not identify the rejected observation,
support position, or particular condition. Rejected model output is not retained;
the exact historical mismatch cannot be reconstructed from that receipt. Do not
claim that this was a whitespace error, fabricated quotation, or citation typo.

The existing validator combines uncited source, duplicate support, missing source,
empty/nontext quote, over-400-character quote and nonexact text into one error.
This candidate adds zero-based observation/support/evidence indices, quote length
when applicable, and a fixed issue category. No quote, observation text, source
reference, arbitrary exception property, or provider response is logged. A local
WeakMap admits only validation details created by the validator itself.

The existing Vertex adapter now presents short packet-local IDs (`e1`, etc.) and
maps those back to original source IDs before validation. This removes repeated
long-hash transcription from model output. Unknown aliases are rejected; no
citations, observations, or quotes are silently repaired or dropped. Original
evidence and durable references remain unchanged. Prompt v9 explicitly retains
whitespace/newlines and prohibits stitching passages. Exact substring validation
and the 400-character limit remain unchanged. This reduces an identified risk;
it does not establish the cause of today's historical failure or guarantee that
future generated quotations will pass.

## Verification

- Repository checks and all 968 tests passed; 37 focused Life Context tests passed.
- Regressions exercise exact long-ID round trips, unknown aliases, duplicate or
  uncited support, empty/oversized/nonexact quotes, no private failure payloads,
  failed-run replay without another inference, and no publication on failure.
- One Google invocation on fictional evidence only completed successfully:
  10 observations, quotation validation passed, 6,968 tokens, no production writes.
  Five existing time-role distinctions and reply/uncertainty cases were reviewed.
- Broader semantic acceptance **failed**: fictional observation 9 uses “she” for
  Mira without source support for that pronoun. This is separate from the
  successful quotation/alias check. The older reference fixture also uses that
  unsupported pronoun and needs correction during the next accuracy repair.
  No further model attempt was made.

## Release gates and current state

Live traffic read November 9 points to `bhe-product-api-pf-1107q`, not the earlier
November 7 Life Context revision. Image digest:
`sha256:3fc44d606a21d3439b50dbbe92110fb0889dd7d5c8cd038340c1b5f830e7f408`.
The newer finance baseline must be preserved when integrating this candidate.
No production deployment, configuration change, profile write, scanner resume,
or private-evidence retry was performed. Today's failed run is immutable and
must not be replayed under another ID as an automatic workaround.

Next: repair and verify the attribution failure, integrate against current live
source, then follow the existing staged release and explicitly reviewed recovery
procedure. Scheduled early delivery remains a separate unresolved gate. The
scanner stays paused. Live owning-source reads remain available for daily work.
