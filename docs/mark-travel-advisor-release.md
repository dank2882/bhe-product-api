# Mark Travel Advisor release

Status: Deployed and enabled; backend and public tool discovery verified.
Mark's actual Microsoft sign-in and phone/voice acceptance remain pending.
Owner: platform implementation, individually owned private content.
Account: `marks@foundedonfaith.com`.
Decision: `mark-travel-advisor-private-workspace-20260930` (accepted).

## What Mark can do

Use Travel Advisor in FBC Staff Tools to save typed or dictated reports with
original wording, trips and destinations, people and churches, contact details,
meetings, and firm or tentative commitments. Firm commitments can become
linked Task Management actions. Ask for trip context or a return briefing in
a new chat to retrieve saved reports and current follow-up status.

Example prompt:

> Save a report from my trip. I visited [place] on [dates], met [people and
> churches], and committed to [actions and any promised dates]. Keep my original
> notes, identify the follow-up, and tell me what information is still missing.

Later:

> Brief me before I visit [place] again: who did I meet, what did we discuss,
> and which commitments still need attention?

Notes stay in Mark's private workspace. A task contains only the action and
source link; Task Management administrators retain their existing task access.
No automatic sharing, invitations, outgoing messages, calendar writes, or
access to Dan's travel data is enabled.

## Source and validation

- API implementation: `3f50fed`.
- Gateway implementation: `daccd9e`.
- Backend full suite: 726 passed.
- Gateway full suite: 204 passed.
- Both repositories' required checks passed.
- Focused tests cover owner partitions, exact original capture, guessed IDs,
  cross-owner links and replay, disabled users and permissions, private task
  ownership, duplicate-safe task creation, concurrent versions, current task
  completion in later briefings, and post-commit receipt failure.

## Rollback baseline

- API: `bhe-product-api-00304-8zn`, serving 100 percent before rollout.
- FBC MCP: `fbc-staff-tools-mcp-entra-prod-00058-rxd`, serving 100 percent.
- Mark profile: version 6 before enabling travel; preserve every existing
  permission and identity field when adding/removing only travel scopes.
- Remove only this rollout's travel grants before rolling API traffic back,
  because the previous API does not recognize those two staff permissions.
- Preserve captured records and append-only audit evidence on rollback.

## Acceptance gates

Candidate and production backend acceptance must verify saved records through
fresh reads, denial for Dan/unregistered users, Mark's denial on Dan-private
routes, replay, version races, and current linked task status. The verification
script creates labeled synthetic fixtures and removes only its own fixtures.

Mark must separately use his actual Microsoft account in a fresh FBC Staff
Tools chat, save a report, and retrieve it in another chat. Phone/voice testing
and any requested Outlook connection remain separate client gates. Trusted
backend tests and public MCP discovery do not close those gates.


## Production evidence — September 30, 2026

- API `bhe-product-api-00311-niy`: 100 percent traffic, source `3f50fed`.
- Gateway `fbc-staff-tools-mcp-entra-prod-00067-did`: 100 percent traffic,
  source `daccd9e`. The candidate hostname was added to the existing host
  allowlist for direct candidate discovery; normal endpoint and OAuth identity
  are unchanged.
- Mark's existing profile was updated transactionally from version 6 to 7,
  adding only `travel.read` and `travel.write`. Independent read-back verified
  the exact profile, grants, and version; all other permissions preserved.
- The production `https://staff-tools-api.foundedonfaith.com/mcp` discovery
  returned 112 tools, including all three Travel Advisor tools, under the
  existing `access_as_user` delegated scope and updated live instructions.
- `node scripts/verify-travel-advisor-live.mjs` passed: trip/person/church/
  contact/meeting writes and read-back, exact summary text, duplicate-safe
  replay, changed-intent rejection, private owned task with source link,
  current completed task status in a fresh context and destination briefing,
  exact saved-report denial for Dan, Mark denial on Dan's legacy route,
  unknown-user and missing-key denial, preserved Dan legacy reads, and a
  concurrent same-version race with one success and one conflict.
- Ten synthetic domain/task records were removed with independent absence
  checks. Audit and idempotency receipts remain. Fixture run:
  `travel-verification-1790804862355`.
- These are trusted backend tests and public tool discovery. They do not
  establish Mark's actual OAuth or phone acceptance.
