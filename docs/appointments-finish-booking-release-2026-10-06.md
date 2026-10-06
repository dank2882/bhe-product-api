# Approve once, finish booking — October 6, 2026

Decision: `appointments-finish-booking-20261006`; accepted plan in
[the ADR](decisions/appointments-finish-booking.md).

## Implementation

- Core commits `65eac08`, `0375500`; gateway/plugin commit `87230b8` in
  bhe-agent-platform. Both repositories preserve the release on
  `codex/appointments-finish-booking-20261006`.
- Existing appointment reads and command readbacks now project booking progress,
  next action and concrete blockers. Existing saved approvals remain valid.
- Missing review timestamps cannot block calendar booking or result recording.
  Calendar booking, participant agreement and notifications remain distinct.
- Life OS finishes exact approved actions in the active conversation unless the
  user requests approval-only. Missing Outlook access preserves approval for a
  connected session. No background scheduler, identity migration or new grants.
- A legacy `waitingOn: dan` flag does not reappear during recovery of an approved
  write. Changed calendar arrangements still require review.

## Automated verification

Core: `npm run check`, 821 passing tests, including 23 appointment tests.
Gateway/platform: check and 221 passing tests. Git whitespace checks passed.
Coverage includes both approval orders, actor/session resumption, ordinary hours,
changed arrangements, conflicting/stale availability, dependencies, interrupted
dispatch with reconciliation-only replay, optional review timestamps, pending
messages and participant agreement independent of booking.

## Published client acceptance

- Existing ChatGPT listing `plugin_asdk_app_6abe50f62c548191b49081448379e268`
  published as 1.0.12. Downloaded saved ZIP matched every submitted file byte.
  Submitted ZIP SHA-256:
  `bebb5e320bb0e911eb0a72c26178f8e042e42f2142f495ad82274e4f2cb3fdd4`.
- Local Codex plugin 1.0.15 exactly matched the repository plugin tree.
- Fresh interactive ChatGPT acceptance:
  `https://chatgpt.com/c/6ac56d02-664c-83e8-bfad-5cc701e96a10`.
  It read the live appointment and independently fetched Outlook, reported
  Scheduled with exactly one event, preserved approvals across chats, separated
  missing participant agreement, and correctly described Sarah's missing-calendar
  fallback. The acceptance chat performed no writes or sends.
- This verifies fresh Dan-client behavior and the missing-connection guidance;
  it does not assert a new Sarah-device OAuth test or message delivery.

## Authorized calendar acceptance

The already-approved appointment was completed through the existing foreground
Outlook connector: fresh conflict-free read, begin once, create once, fetch exact
event, record matching result, independent appointment and bounded calendar reads.
The bounded calendar window returned exactly one matching event and no next page.
Appointment version 10 reports booked, next action none, zero pending messages
and family notices, and participant agreement false. No agreement was invented;
no messages or invitations were sent. No review timestamp was required.

Readback request `19385f1a-3a12-47ff-86bc-59e2a91f72b6`; result-recording request
`4d5edba9-3e2c-42ff-a8dc-2d9abf36e462`. Operational details remain in appointments
and Outlook, not this engineering record.

## Deployment

Existing Cloud Run services in `location-map-985`, `us-west1`; tagged candidate
reads precede promotion. Environment bindings, runtime service identities and
existing revision tags are preserved. Gateway revision
`dan-life-os-mcp-00048-coj` and core revision `bhe-product-api-00353-qob`
serve 100 percent. The initial calendar acceptance ran on core
`bhe-product-api-00351-jog`; the final core revision adds only the legacy waiting
status correction. Its candidate read verified the same saved approvals and
booked appointment at version 10 without additional writes.

Rollback targets: core `bhe-product-api-00349-qaf`, gateway
`dan-life-os-mcp-00046-teh`. Rollback is an exact traffic update, not a credentials
or data migration. Existing approvals and calendar receipts require no migration.
