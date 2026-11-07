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

## Live repair acceptance

Release commit `bccf152` deployed as `bhe-product-api-lc-time-1107a`, preserving prior runtime configuration and traffic tags. One explicitly authorized existing-evidence correction `life-context-v8-correction-20261107` produced version11 using prompt v8, without reuse or recollection. Independent native Life OS receipt/current reads returned five observations and seven matching citations; the affected time now remains departure, with no arrival/event-start inference. Other speaker/reply/tentative distinctions were reviewed against original in-memory evidence. Relative dates still require source-anchored Pacific rendering. Approved Life Context/Voice Profile remain versions0/1.

Temporary daily allowance2 was restored to1 on final revision `bhe-product-api-lc-daily-1107a`, serving100% with the same repaired image and unchanged monthly ceiling. Existing timer was updated/read back ACTIVE for daily08:30 local time on the Pacific host; old pause instruction removed, time-role checks retained. Next nominal run November8,08:30PST. Actual scheduled delivery, fresh-process authentication and sleep recovery remain open gates; they are not established by this manual repair.

Engineering evidence: `life-context-time-roles-v8-tests-20261107`, `life-context-time-roles-v8-deploy-20261107`, `life-context-time-roles-v8-acceptance-20261107`. Counts-only operational report: controlling workspace `outputs/life-context-v8-repair-2026-11-07.md`. No private source content is copied to engineering records.
