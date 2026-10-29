# Life Context summary v4

October 29, 2026. Dan requested the next summary improvements and previously authorized completing testing without repeated per-attempt cap approvals. Reuse the existing Vertex adapter, authenticated Life OS publication, provisional store and original evidence. No new service, auth flow or approved-profile inference.

## Changes

Prompt v4 distinguishes questioner from confirming speaker; preserves suggested/uncertain app identities; disallows invented recipients and gendered pronouns; retains unresolved reply results in prose; defines certainty for the matter rather than message existence; and defines overlapping Daily Brief/planning/care/preaching/correspondence purposes. Original-event/date/relationship and exact-quote requirements remain.

Two live fictional tests showed that Flash-Lite still changed speakers despite the revised instructions. The existing adapter therefore uses `gemini-3.8-flash` with LOW thinking. The medium-thinking comparison exhausted a 4096-token output allowance and published nothing. LOW passed the combined fictional evidence and a focused third-party/uncertain-identity check. Production output allowance is 8192 to leave room for both reasoning and full source support; the 30KB response and 80KB serialized-request checks, 45-second timeout and no automatic retry remain. Unsupported temperature/candidate-count parameters were removed per Google's migration guide.

The same 0.10-dollar reservation covers the conservative bound: 80000 input tokens at $0.75/M plus 8192 output tokens at $3.75/M is about $0.091. Typical earlier production usage at those rates would be about $0.019, not an invoice. The existing November 29 price-review stop precedes the introductory price expiry. No arbitrary model override is exposed. The reuse fingerprint now includes model and prompt version so a new authorized correction cannot reuse older interpretations; exact-run replays remain immutable.

Official references reviewed October 29:
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash
- https://cloud.google.com/model-garden/pricing

## Evidence and limits

The new fictional fixture covers both speaker directions, an uncertain app surname, replied-but-unresolved arrangements, personal context and irrelevant chatter. Its expected outputs are human-authored references, not model-generated evidence. A backend regression verifies multi-purpose retrieval and paired citations from that reference.

Live LOW results: combined sample 4184 input /1282 output tokens, nine supported observations; focused sample 2497 input /358 output tokens, two supported observations. Confirming speakers were correct, uncertain identity was qualified, dates/relationships were not invented, unresolved matters stayed tentative, important brief entries appeared, and routine chatter was omitted. The combined sample omitted one older third-party exchange; the focused sample exercised that exchange successfully. Purpose selection is prioritization, not guaranteed exhaustive recall.

Next release verification reprocesses the complete original 36-entry version-3 source packet, not its generated summaries, with expectedVersion3 and a distinct reviewed-correction run ID. Preserve the original evidence timestamps and partial coverage. Verify actual output and independent purpose retrieval before claiming correction accepted. Daily schedule and approved profiles remain untouched.
