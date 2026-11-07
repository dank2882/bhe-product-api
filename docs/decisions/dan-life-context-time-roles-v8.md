# Life Context action/time fidelity — November 7, 2026

Dan authorized fixing the summary defect, verifying it, and resuming the existing daily 08:30 Pacific scanner. Version10 observation-2 transferred a source departure time to attendance. Source text is deliberately absent from this engineering record.

Extend the existing Vertex instruction to preserve the actor, action and qualifier associated with every time: departure, arrival, attendance, event start, preparation, deadline and estimated delivery are distinct. Unknown time roles stay unknown; supporting quotes must retain action and qualifiers. Prompt version advances to v8 so an explicitly authorized correction cannot reuse v7 output. No model, schema, storage, authentication, gateway or approved-profile changes.

The fictional `test/fixtures/life-context-event-times.json` tests departure/attendance conflation, separate travel and event times, an arrival-only negative control, ambiguous time roles and time transfer between speakers. A real Google evaluation is required; canned reference-output tests are not semantic proof. Existing quotation and version/replay tests remain required. No finite model test proves universal semantic correctness; scheduled runs retain independent source comparison and pause on inaccurate output.

Release preserves the live personal-finance source baseline from `bhe-product-api-pf-1106d`, independently compared with its source archive before editing. Daily collection normally remains one inference/day with the existing monthly reservation ceiling. Correct existing version10 using the authenticated reprocess operation, with one temporary additional daily reservation for this explicit repair only if needed; restore the daily limit before resuming. Reprocessing uses existing evidence inside GCP, without recollection or source export. Keep immutable old revisions for audit.

The existing timer uses an ordinary daily local wall-clock rule without DTSTART; verified host timezone is America/Los_Angeles. Actual next scheduled delivery remains an acceptance gate. Resume only after real-model and corrected-context acceptance. No new timers or chats.

## Pre-release verification

One real Google invocation on fictional time-role cases plus prior speaker/reply cases returned ten source-grounded observations. All five targeted time-role cases preserved the required distinction, including the arrival-only negative control and the unknown departure of a second speaker. Existing quotation/publication validation passed. This evaluation used developer authentication and in-memory storage, not production data or the deployed runtime identity. Result: `outputs` workspace evidence `work/accuracy-v8-time-roles-evaluation.json`; model `gemini-3.8-flash`, prompt v8, HTTP200/STOP, 6,814 tokens.

Repository checks and all 964 tests passed. An initial sandboxed suite could not bind loopback test servers; the same suite passed with local test-server permission. Existing main's audit documents and regression tests were reconciled with the deployed finance baseline. Comparison against the live source archive found no runtime differences before editing; after reconciliation, the only runtime source change is `lib/life-context-vertex.js`. No application binary, client plugin, or source-record changes.

Remaining gates at this commit: staged deployment/configuration comparison, existing-evidence correction and independent semantic readback, daily-limit restoration, timer activation/readback, then the next actual 08:30 Pacific scheduled delivery.
