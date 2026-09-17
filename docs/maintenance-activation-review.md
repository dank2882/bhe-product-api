# Maintenance activation review — September 16, 2026

Status: worker deployed with intake/sending disabled; API/MCP release and provider activation pending.

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
