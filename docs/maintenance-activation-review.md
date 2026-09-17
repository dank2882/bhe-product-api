# Maintenance activation review — September 16, 2026

Status: implementation built; provider activation and production deployment pending.

Dan approved continuing at the quoted Twilio price and postponing nonprofit
pricing. The dedicated number selected is +1 360 858 8149, quoted at $0.8625
immediately and monthly, plus usage. It has **not been purchased**: checkout
requires acceptance of Twilio's Emergency Calling Terms. An action-time
confirmation is pending. Existing church/prayer routing is unchanged.

## Prepared build

- API implementation commit: `35448eb`.
- Cloud Build: `a8fd31b9-a9c3-4961-bb48-7649d4625ac6`, us-west1, SUCCESS.
- Worker image: `us-west1-docker.pkg.dev/location-map-985/cloud-run-source-deploy/fbc-maintenance-messaging-worker@sha256:2c10d13ef31ff92cb5784e7f05a857e7a0ca580294f67973d61cb2accace8d9c`.
- Platform branch reconciled with GitHub main `6539548`; 171 tests pass and
  `npm run check` passes after reconciliation.
- Existing live API remains `bhe-product-api-00279-cpw`; existing FBC MCP
  remains `fbc-staff-tools-mcp-entra-prod-00042-96q`. No deployment performed.
- Developer Tools connector currently requires OAuth reauthorization. This
  file is Git evidence; no registry update has been claimed.

## Access changes to approve before provisioning

Project: `location-map-985`; region: `us-west1`.

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

Inspected the live tenant's 17 app registrations as Dan. No Maintenance mailbox
application is listed. Existing FBC Staff Tools MCP Production currently has
only delegated `User.Read` in its configured API permissions. Recommend keeping
that working login identity separate from a new **FBC Maintenance Mail Worker**
single-tenant app (no redirect URI), preserving isolation of mailbox credentials.
The new registration form is prepared but **not submitted**. Its final action
also accepts the Microsoft Platform Policies and needs action-time approval.

The required background application access is `Mail.Read` and `Mail.Send`, scoped in Exchange application
RBAC to **maintenance@foundedonfaith.com only**, with no additive tenant-wide
mail permissions. A separate app, if needed, requires an explicit decision.
The initial poll starts at activation time unless Dan requests historical mail.

Twilio authentication and Microsoft app credentials belong in Google Secret
Manager. No provider secrets exist in this project yet. Never place values in
Git, chat, logs, or shell arguments. Browser credential-creation steps require
user handoff. Verify mailbox allow and unrelated-mailbox deny before activation.

## Remaining activation gates

1. Accept required number terms, purchase once, and independently read back.
2. Review exact Maintenance campaign registration charge and content, then
   register; provider approval may not be immediate.
3. Approve/provision scoped runtime access and provider secret storage; approve
   the dedicated Microsoft app and its Platform Policies before registration.
4. Deploy from reconciled, tested release code using the existing release
   process; preserve current live revisions for rollback.
5. Configure provider routes and approve actual workers/opt-in.
6. Verify authenticated access, unknown-sender quarantine, SMS/MMS and mailbox
   ingestion; send only specifically approved acceptance messages.
7. Verify Shawna's actual staff session and turn on recurring intake.

Reference runbook: [maintenance-launch.md](maintenance-launch.md).
