# Maintenance launch and acceptance

This is an implementation runbook, not evidence of deployment.

## Components

| Component | Configuration |
| --- | --- |
| Existing product API | `MAINTENANCE_WORKER_URL` points to worker's HTTPS Cloud Run origin |
| Worker | `fbc-maintenance-messaging-worker`, `location-map-985`, `us-west1` |
| Runtime identity | `fbc-maintenance-worker@location-map-985.iam.gserviceaccount.com` |
| Job caller identity | `fbc-maintenance-jobs@location-map-985.iam.gserviceaccount.com` |
| API caller | Existing `gpt-firestore-api@location-map-985.iam.gserviceaccount.com`; verify live before binding |
| Queue | Dedicated `fbc-maintenance-messaging`, rate/concurrency limits; authenticated OIDC jobs |
| Scheduler | Dedicated poll every five minutes; OIDC POST `/internal/poll` |
| Message collections | `maintenanceMessages`, `maintenanceMedia`, `maintenanceReporters`, `maintenanceOutbox`, `maintenanceProviderCursors` in **correspondence** |
| Work collections | Existing projects/tasks/routines/taskAttachments in **chatgptstorage**, never default database |
| Private media prefix | `maintenance/incoming/` in `bhe-product-assets` |

Review exact IAM bindings before provisioning. Worker needs the named Firestore
databases, object create/read and signing, queue enqueue, and its named secrets.
Use database and bucket/prefix conditions where supported; do not grant project
Owner/Editor. Job caller has no task or mailbox data access. Product API invokes
the worker; it does not receive provider secrets. Public reachability is required
only for signature-verified Twilio routes; every internal route also independently
verifies OIDC issuer/audience/email. Do not rely on the caller-supplied actor alone.

## Configuration

Copy nonsecret settings from `services/maintenance-worker/env.example.yaml`.
Outbound requires the master `MAINTENANCE_SENDING_ENABLED` switch and the
applicable `MAINTENANCE_EMAIL_SENDING_ENABLED` or `MAINTENANCE_SMS_SENDING_ENABLED`
switch. Missing channel switches deny sending. Check both approval and dispatch
so queued work cannot bypass a disabled channel. Email acceptance can proceed
while SMS remains disabled pending A2P registration. These switches never replace
recipient opt-in or explicit approval of each immutable draft.
Secret Manager references must supply `TWILIO_AUTH_TOKEN` and
`MICROSOFT_CLIENT_SECRET`; never put values in Git, commands captured in chat,
registry records or logs. Inspect/reuse the appropriate Microsoft application;
verify Exchange scoped Mail.Read/Mail.Send allow for Maintenance and deny for an
unrelated mailbox. Verify there are no additive tenant-wide mail permissions.

`MAINTENANCE_MAIL_SINCE` must be chosen explicitly. Initial implementation tracks
configured folders (default Inbox), not all mailbox folders. Verify mailbox rules;
include any destination folders in `MAINTENANCE_MAIL_FOLDERS`. Sent messages are
saved to Sent Items. Email delivery is not asserted from Graph's HTTP acceptance.
Message headers include the outbox ID for read-only reconciliation of uncertain
sends. Missing/expired delta cursors need operator review, not silent history reset.

Only image attachments are decoded/normalized for this version. Unsupported
files, failed downloads and attachment overflow are visible for review; they do
not block other messages. The first ten attachments are processed, overflow is
reported. Oversized email text is explicitly flagged. HEIC depends on runtime
decoder support and must be tested with actual worker phones; unsupported photos
remain visible as failed media. Originals remain in the provider system. Stored
photos are normalized JPEGs with metadata removed.

Shawna must approve actual workers and document actual opt-in before outbound
messages. Twilio STOP keywords are honored, but reporter approval alone never
restores consent. Enable advanced opt-out on the dedicated Messaging Service so
Twilio provides `OptOutType` for START/STOP; test before activating outbound.

## Build and rollout order

1. Reconcile this branch with current product/API and platform release branches;
   unrelated work existed in both original checkouts and was left untouched.
2. Run `npm ci`, `npm ci --prefix services/maintenance-worker`, `npm test`,
   `npm run check`; run platform tests/checks in its accompanying branch.
3. Build worker with `cloudbuild.maintenance.yaml`. Review IAM/secrets and
   provision the dedicated queue and scheduler with scheduler initially paused.
4. Deploy worker with sending and Twilio intake disabled. Test authenticated
   allow/deny routes. Deploy API with its worker URL, then MCP operation policy.
5. Resolve Shawna to her authenticated individual subject and appoint her with
   `setMaintenanceAccess` as Dan; read back the current root version and grants.
6. Configure dedicated Twilio number/campaign and webhook URLs only after
   approved purchase/registration. Bind Microsoft credentials and scoped access.
7. Enable intake; test one email, one SMS and one MMS from a known worker and an
   unknown sender. Confirm one durable message on replay and restricted photos.
8. Test Shawna's actual FBC Staff Tools session: board, archive/restore,
   routine completion, review, and membership management. Deny permanent delete,
   unrelated branch/private-task access and nonmanager inbox access.
9. Enable outbound only after these gates; send one explicitly approved email
   and SMS/photo test to approved recipients. Never resend on ambiguity. Check
   Sent Items/Twilio logs and outbox receipts. Then enable the recurring poll.

There is no automatic bulk import. Use `scripts/preview-maintenance-import.cjs`
to preserve source table rows and identify exact duplicates without mutating
Firestore. Reconcile the complete source set and building mapping first.

## Monitoring and recovery

- Alert on worker 5xx, Scheduler failures and old pending/partial_failure media.
- Alert on outbox `unknown`, prolonged `sending`, and provider failures.
- Inbox/draft/query operations fail closed if the worker is not connected.
- Polling recovers pending media/approved sends, never attempted/unknown sends.
- `retryMaintenanceMedia` retries only photo processing, never messages.
- Review/link is resumable after an attachment failure. The chosen task is locked
  before linking files so concurrent reviews cannot attach to different tasks.
- Audit events preserve authenticated actor; state history is not a substitute
  for checking the live provider if sending is ambiguous.

## Provider references

- https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
- https://learn.microsoft.com/en-us/graph/api/message-delta
- https://learn.microsoft.com/en-us/graph/api/user-sendmail
- https://www.twilio.com/docs/usage/webhooks/webhooks-security
- https://www.twilio.com/docs/messaging/guides/webhook-request

## September 16 account observation

During the activation check, Twilio's number-purchase page explicitly reported
that the account was suspended for lack of funds. Billing was opened for Dan;
no recharge, purchase, registration, webhook change or live send was performed.
Verify the live billing state again before activation. This observation is not
proof of the delivery state of any earlier church messages.

Subsequent activation work resolved funding; Dan purchased +1 253 319 3260.
See [maintenance-activation-review.md](maintenance-activation-review.md) for the
current service, cloud deployment and mailbox-scope receipts. The suspension
observation above is historical.
