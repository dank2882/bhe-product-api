# Optional Sarah contact for appointments

Accepted November 3, 2026. Dan: “I need to remove the Sarah confirmation
requirement to schedule appointments and just make it a suggestion to contact her.”

Reuse the existing Dan-owned appointment policy with `approvalMode: suggestion`.
Keep the saved normal hours and contact. Outside-hours preparation, travel and
meetings produce a concise suggestion to contact Sarah, without requiring a reply,
approval evidence or complete contact setup to book or confirm. No automatic
message or required family notice is created. Existing pending notices remain
historical, explicitly optional and do not prevent completion. Attempted message
actions still require reconciliation; no history or send evidence is fabricated.

Dan's exact action approvals, fresh calendar conflict checks, participant
agreement, idempotency, private access and readback remain enforced. Messages
still require explicit authorization. No new service, identity or data store.

Legacy policies without a mode retain required behavior until Dan changes them.
Omitting the mode during later settings edits preserves the saved mode, so older
clients cannot silently restore the gate. Only Dan can change the policy.

Verification: regression tests cover scheduling and confirmation without Sarah's
approval, stale legacy decisions/notices, missing contact setup, normal-hours
suggestions, policy version/replay protection and unchanged calendar safeguards.
Deployment and live policy readback are recorded separately in the release note.
