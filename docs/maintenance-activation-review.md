# Maintenance activation review — September 16, 2026

Status: API, MCP and worker deployed; Twilio inbound connected. Outbound disabled.
Microsoft credential is connected; actual-user/message acceptance remains pending.

Dan approved continuing at the quoted Twilio price and postponing nonprofit
pricing. Dan then selected a 253 area code and completed the purchase himself.
Independently verified **+1 253 319 3260** in Twilio's Active Numbers inventory;
phone number SID `PN5ad79d225b3ddb342ffd94b5001e58c0`. Checkout quoted $0.8625
immediately and monthly, plus usage. The earlier 360 candidate was not purchased.
Created and independently read back **FBC Maintenance**, Messaging Service SID
`MG78fdba38f69ceae19120dcd49a7b1305`, Discussion use case, with only the 253
number assigned. During setup, inbound handling was set to **Receive the
message**: retain messages in Twilio API/logs without invoking the demo webhook.
No backend webhook is active and no A2P campaign is connected. Purchase and
service assignment are verified; Maintenance backend integration is not active.
Advanced Opt-Out was enabled and independently read back as Enabled, retaining
Twilio's standard STOP/START/HELP keywords and responses. No live message was sent.
Existing
church/prayer number +1 360 972 3296 and its service are unchanged.

## Prepared build

- API implementation commit: `35448eb`.
- Cloud Build: `a8fd31b9-a9c3-4961-bb48-7649d4625ac6`, us-west1, SUCCESS.
- Worker image: `us-west1-docker.pkg.dev/location-map-985/cloud-run-source-deploy/fbc-maintenance-messaging-worker@sha256:2c10d13ef31ff92cb5784e7f05a857e7a0ca580294f67973d61cb2accace8d9c`.
- Platform branch reconciled with GitHub main `6539548`; 171 tests pass and
  `npm run check` passes after reconciliation.
- Existing live API remains `bhe-product-api-00279-cpw`; existing FBC MCP
  remains `fbc-staff-tools-mcp-entra-prod-00042-96q`. These two services have not yet been released.
- Developer Tools connector requires OAuth reauthorization. The established release
  helper can access the registry using the independently verified Dan individual
  subject and existing service credential in memory.

## Approved and provisioned access

Project: `location-map-985`; region: `us-west1`. Dan explicitly approved these
grants, the dedicated Microsoft app and its registration terms. Applied grants
were independently read back. See `scripts/provision-maintenance-cloud.py`.

| Principal | Target | Access and purpose |
| --- | --- | --- |
| New `fbc-maintenance-worker` service account | Firestore `chatgptstorage` and `correspondence` only | `roles/datastore.user` with database-name IAM conditions; checks current staff/project authorization, links evidence, stores messages/outbox |
| Worker | `bhe-product-assets/maintenance/incoming/` only | Conditional object create/read, no deletion; private normalized photos |
| Worker | Its own service account | Sign private, expiring media URLs; do not issue service-account keys |
| Worker | Dedicated `fbc-maintenance-messaging` queue | Enqueue only |
| Worker | New `fbc-maintenance-jobs` identity | Act-as for OIDC queue calls only |
| Worker | Named Maintenance provider secrets only | Secret-version access for Twilio and scoped Microsoft credentials |
| New jobs identity | Worker internal poll/work routes | OIDC identity checked in application; no direct database, media, or mailbox permissions |
| Existing product API identity | Worker operation route | OIDC identity checked in application; provider secrets remain isolated |

Firestore IAM conditions limit database access, not individual collections.
The worker therefore remains a trusted backend with access to both named
databases, while its code enforces the Maintenance branch and manager boundary.
Do not describe this as collection-level IAM isolation.

Twilio needs public HTTPS reachability. Public requests still require valid
Twilio signatures, account and number checks; all internal routes independently
verify OIDC audience and the exact caller identity. Keep intake/sending disabled
until provider configuration and allow/deny tests pass.

## Microsoft and credentials

The reuse review found no existing Maintenance mailbox application; the working
FBC Staff Tools login app remains unchanged. Created **FBC Maintenance Mail Worker**,
single tenant, no redirects:

- Application ID: `97aca4e1-1d64-4b8c-8fd1-ba5737e9f120`.
- App registration object ID: `ac62cd98-b826-4150-b8e4-015bccd00acb`.
- Enterprise service principal ID: `8594f3a9-2d9d-49c4-9033-b514d34f74fa`.
- Tenant ID: `8645ddd9-9cc8-4b1b-9d95-1eddf5df7492`.

`configure-maintenance-mail.ps1` provisioned Exchange application roles
`Application Mail.Read` and `Application Mail.Send` under **FBC Maintenance
Mailbox Only** (`PrimarySmtpAddress -eq 'maintenance@foundedonfaith.com'`).
The recipient filter resolved to exactly one mailbox. At
`2026-09-17T05:32:25.3818490Z`, Test-ServicePrincipalAuthorization returned both
roles in scope for Maintenance and both out of scope for Dan's mailbox.
The app's Entra API permissions page independently showed only delegated User.Read;
no additive application/tenant-wide mail grants. Actual Graph allow/deny acceptance
still requires the new client credential and permission propagation.

Secret Manager containers `fbc-maintenance-twilio-auth-token` and
`fbc-maintenance-microsoft-client-secret` now exist with worker-only accessor grants,
but have no secret versions yet. Never place values in Git, chat, logs or shell
arguments. Browser credential creation requires user handoff. Initial polling
starts at activation time unless Dan requests historical mail.

## Disabled worker deployment

- Revision: `fbc-maintenance-messaging-worker-00002-fwk`, serving 100 percent.
- URL: `https://fbc-maintenance-messaging-worker-265001256563.us-west1.run.app`.
- Runtime: dedicated worker identity, max 2 instances, concurrency 10, 512 MiB.
- `/health`: HTTP 200, `sendingEnabled:false`.
- Unauthenticated POSTs to `/internal/operation`, `/internal/work`, `/internal/poll`:
  HTTP 401 each.
- Dedicated task queue created and paused; no Scheduler job yet.
- Photo bucket has uniform access and public access prevention enforced.
- Twilio intake and provider sending remain disabled. No test message was sent.
- IAM bindings were read back; live runtime database/media allow/deny acceptance
  remains separate and pending.

## Remaining activation gates

1. Number purchase and independent inventory read-back: complete, +1 253 319 3260.
2. Review exact Maintenance campaign registration charge and content, then
   register; provider approval may not be immediate.
3. Scoped runtime access, secret containers, and Microsoft registration: complete.
   Populate credentials securely and verify actual Graph allow/deny behavior.
4. Deploy from reconciled, tested release code using the existing release
   process; preserve current live revisions for rollback.
5. Configure provider routes and approve actual workers/opt-in.
6. Verify authenticated access, unknown-sender quarantine, SMS/MMS and mailbox
   ingestion; send only specifically approved acceptance messages.
7. Verify Shawna's actual staff session and turn on recurring intake.

Reference runbook: [maintenance-launch.md](maintenance-launch.md).

## Subsequent activation receipt — 2026-09-17 UTC

- Merged API PR #1 at `16ca4082a16d313bcc9e2d3633a5d19276bf4f31` and
  platform PR #4 at `8668ffa475295dfbd6b2f7153420181f04061ab5`.
- Existing release helper reran all checks: **618 API tests, 171 platform tests**,
  zero failures. Main API deployed as `bhe-product-api-00280-bz8`, then worker URL
  configuration produced `bhe-product-api-00281-f44`; MCP revision
  `fbc-staff-tools-mcp-entra-prod-00043-kkq`. Both serve 100 percent. Deployment
  receipts were independently recorded/read back in Developer Tools.
- Worker revision `fbc-maintenance-messaging-worker-00004-zfg` serves 100 percent.
  Twilio intake is enabled; provider sending remains disabled. Internal
  unauthenticated routes reject with 401; unsigned Twilio intake rejects with 403.
- Existing Twilio auth token transferred directly into the approved Secret Manager
  secret, version 1, without placing the value in chat/files/Git. Read-only Twilio
  REST authentication succeeded and verified the 253 number's SMS/MMS capabilities.
- Maintenance-only messaging service inbound URL was set to the worker's
  `/twilio/inbound`, POST, `UseInboundWebhookOnNumber=false`, and independently
  read back. Dedicated queue is RUNNING. No earlier inbound messages existed on
  the 253 number at the preactivation inventory check.
- A2P outbound registration remains pending. Twilio documents that inbound
  traffic is not affected by unregistered outbound filtering:
  https://help.twilio.com/articles/14910496447771-Shutdown-of-Unregistered-10DLC-Messaging-FAQ
- Live authenticated API checks succeeded for access, the exact ten-column board,
  routines and the worker inbox. Inbox success verifies API-to-worker OIDC and
  worker reads of both named databases. It does not verify image decoding,
  object storage or real SMS/MMS delivery. Board currently has the existing
  back-door task only, routines zero; the full master has **not** been imported.
- Shawna's active individual profile was resolved by exact email. As verified Dan,
  `setMaintenanceAccess` appointed her manager with version 2 -> 3 and an
  idempotency key. Independent `getMaintenanceAccess` confirmed the grant;
  permanent deletion remains owner-only. Shawna's actual client session is untested.
- This chat's connector schema still caches the pre-release operation enum and
  rejects the new Maintenance query names. The live operation catalog advertises
  all 17 operations; backend checks use the established authenticated backend
  client with Dan's current profile. Fresh FBC connection discovery is still needed.
- Microsoft secret container still has no versions. Entra's new-client-secret
  dialog is prepared with description `FBC Maintenance Cloud Run`, default
  recommended 180-day expiration. Google Secret Manager's matching new-version
  dialog is prepared. Dan must create the Microsoft credential and paste its
  **Value** directly into Secret Manager, not chat. New browser credentials require
  user handoff. No Scheduler exists; mailbox polling remains inactive.

Next: secure Microsoft credential; actual Graph scoped allow/deny test; actual
text/photo ingestion and Shawna session; approved workers/consent and A2P campaign;
reconciled master import. No real outgoing messages have been sent.

## Microsoft connection receipt — September 17, 2026

Dan created the client secret in Entra. The one-time visible Value was transferred
directly to `fbc-maintenance-microsoft-client-secret` version 1, and its enabled
state was independently verified. No credential value was printed or stored in Git,
chat, logs, or local files. Token authentication returned HTTP 200. Actual Graph
message-read probes returned HTTP 200 for `maintenance@foundedonfaith.com` and
HTTP 403 `ErrorAccessDenied` for `dank@foundedonfaith.com`. These are live read
allow/deny checks; no email was sent as a test.

Worker revision `fbc-maintenance-messaging-worker-00005-4q2` serves 100 percent
with the Microsoft secret reference bound. Mail ingestion begins at
`2026-09-17T16:09:01Z`, Inbox only; no historical-mail import. Twilio intake remains
enabled and all provider sending remains disabled.

Created `fbc-maintenance-mail-poll`, us-west1, every five minutes, using the
existing dedicated jobs identity and OIDC audience equal to the worker origin.
No automatic retry is configured; the next scheduled poll resumes from its
persisted cursor. Two initial worker poll requests returned HTTP 200. Scheduler's last attempt
at `2026-09-17T16:11:43.628474Z` succeeded; the persisted Inbox cursor was
independently read back with checkedAt `2026-09-17T16:11:44.369Z` and its lease
released. This verifies Scheduler OIDC, worker credential access, Graph polling
and durable cursor updates, without asserting a real test email was received.
The Google-managed Scheduler service agent role was read back. Google documents
that the first job in a project may need a few minutes for initial setup:
https://docs.cloud.google.com/scheduler/docs/schedule-run-cron-job

The Entra creation dialog used its default recommended 180-day expiration;
credential rotation must be completed before expiry. Actual phone text/photo,
mail attachment, worker approval/opt-in, Shawna session and outgoing-delivery
acceptance remain pending, together with A2P registration and full-list import.

## Email photo-to-task acceptance — September 23, 2026

This receipt supersedes earlier pending statements only for the checks below.
Dan authorized a clearly labeled test task, photo linking, verification and archive.

- Email subject `Test task to be done` arrived at 16:04:32 UTC; the Maintenance
  worker ingested it at 16:04:43 UTC and normalized its one photo successfully.
- Message: `3d3f81d9507b58020bbb4490e5b907857b85f22316084510bb3b8629637d864f`.
- Created `task-maintenance-photo-test-20260923`, titled
  `TEST — Maintenance photo intake`, under `proj-fbc-maintenance`. This is a
  test fixture, not a real repair request.
- Versioned `reviewMaintenanceMessage` linked the message to the task;
  independent retrieval confirmed message version 2 and `reviewStatus: linked`.
- `listAttachments` confirmed exactly one JPEG attachment:
  `maintenance-48ba59e4cf59128a5cbe66139ecb2c6b` (861353 bytes).
- Board reference `M-dcb96955` displayed `1 photo(s)`. The task-authorized
  `getAttachmentDownload` URL returned the image, which was visually inspected.
  No expiring signed URL or photo bytes are stored in this report.
- Archived the task using `updateTask` with expected version 1. Independent
  retrieval confirmed version 2, `dropped`, and Dan's archive attribution.
  The normal board query excluded it; `includeArchived:true` retained the row
  and its one attachment. No operational repair was marked complete.

Verified: email intake, private cloud photo storage, reviewed Firestore task
attachment, board photo count, task-authorized image retrieval, and recoverable
archive. Intake was expedited using the existing Scheduler job; this does not
measure ordinary unattended polling latency. Dan previously confirmed table
rendering in his chat. Today's write/retrieval verification used Dan's Codex
connection, not Shawna's client. The table still renders counts rather than
clickable photo links or thumbnails; photo retrieval is conversational.

Remaining: Shawna's own write/link/photo/archive acceptance; direct photo-link
presentation if desired; unresolved source locations/assignments; SMS outbound
consent and A2P gates. Existing Developer Tools workstream
`fbc-maintenance-module` is the durable engineering handoff. Retrieve it directly:
`searchRegistry` searches systems/components/decisions, not workstreams.

## Shawna acceptance and photo presentation — September 23, 2026

Dan reports all four Shawna-account checks passed: archived task retrieval,
photo download/viewing, restore plus note, and archive. Independent backend
read-back confirms task `task-maintenance-photo-test-20260923` version 5,
Shawna's restore at 16:17:13 UTC, note `Shawna account test successful` at
16:17:19 UTC, and Shawna's archive at 16:19:30 UTC. Her photo viewing is
user-reported; this session did not operate her client. Inbox-to-task linking
and reporter administration in her account remain separate untested workflows.

Dan reported no visible photo indicator in her table and a download-only image
experience. The live backend still returned one photo and `1 photo(s)` for the
fixture, so the missing indicator's exact client cause was not established.
The presentation fix adds a prominent Images count, short-lived inline preview
and separate open/download links, with an instruction to preserve the Images
column and Photo previews section. Automated checks cover parent authorization,
page-only URL signing, stable pagination and failure fallback. Deployment and
fresh-chat image rendering must be verified separately from these code changes.
