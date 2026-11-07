# Ambiguous-reply fix and next step

The ambiguity fix is deployed. Final verification on the saved real sample is pending an approved source-handling path.

## Completed

- Commit `93dfc9a`, prompt `life-context-observations-v7`, normal service revision `bhe-product-api-00359-j7r` at 100% traffic.
- Google evaluation: 17 fictional excerpts, eight summaries, 4,809 input and 1,367 output tokens. Clear agreements and explicit refusals were retained; ambiguous extra topics were not promoted to decisions; an unclear choice of day remained unsettled.
- All 935 backend tests and required repository checks passed.
- Collection remains disabled. No daily schedule was enabled and no approved profile was populated.

The existing real context remains version5 from the prior v6 run. Its previously flagged ambiguous extra clause has not yet been corrected. Deployment alone does not establish that saved summaries have changed.

## Why the final live correction paused

The original source packet is durable in GCP but was not retained in this operator session. The connected Life OS tools can submit new evidence and retrieve summaries; they do not currently expose a command to reprocess saved evidence internally.

Automatic approval review rejected printing the full source packet through command output because it would expose private message text in tool/session logs, contrary to the earlier in-memory-only boundary. The private IPC receiver was unavailable under current session permissions. No source packet was printed by the rejected action; no raw excerpts were written to files or engineering reports. The rejected helper was removed.

## Recommended addition for review

Add a narrow **reprocess saved context** operation to the existing Life OS connection and backend. It takes only a run ID, expected context version and reason. The authenticated backend loads the existing saved source snapshot and calls the same collection/Google pipeline. Chat receives only the receipt and compact cited summaries.

Reuse `lib/life-context-observations.js`, existing context routes in `index.js`, and `mcp-server/src/life-context-tools.js`. No new service, database, credentials or source collector. Preserve source timestamps and coverage, version checks, budget reservations, authorization, immutable revisions and exact-run replay. Keep failed and superseded runs explicit. Do not touch approved Life Context or Voice Profile.

Acceptance tests:

1. Unauthorized callers cannot read saved evidence or invoke the model.
2. Stale versions fail without spending inference budget; replaying a completed run does not call Google again.
3. Only original retained evidence is processed, never prior summaries; original timestamps and partial coverage remain intact.
4. Raw excerpts and credentials never appear in responses or diagnostics.
5. The real ambiguity case retains the supported agreement without inventing an extra refusal; independent receipt/current/purpose reads agree.
6. Normal disabled traffic is restored after the trial, with approved profiles unchanged.

After that, test retrieval from a genuinely fresh ChatGPT session and complete unattended desktop/next-day checks before enabling the 6:25 a.m. pilot. This current chat is not fresh-session acceptance.
