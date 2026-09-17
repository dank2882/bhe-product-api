# FBC Maintenance module and messaging

Status: architecture accepted by Dan, September 16, 2026 ("ok lets build it").
Implementation is in progress; this decision is not a production receipt.

## Ownership and reuse

- Owner: `fbc`; serves: `[fbc]`; domain: facilities maintenance.
- Task Management in existing `chatgptstorage` Firestore owns tasks, projects,
  recurring duties and completion history. Root: `proj-fbc-maintenance`.
- Existing Task Management MCP query/command tools expose the module. No new
  OAuth audience, login flow, MCP server, or web management UI.
- Correspondence's existing `correspondence` Firestore owns message evidence,
  reporter consent, review state, outbox and provider cursors. The new worker is
  its FBC Maintenance transport component, not a second task authority.
- Private media lives in existing `bhe-product-assets`. Reviewed photos link to
  existing task attachments; the bytes are not copied to a second bucket.

## Accepted behavior

The master display preserves exactly: Project, Task, Priority, Third Party,
Cost, Target Date, Status, Assigned To, Notes, Images. Group by confirmed
building and area. Store estimates and actual costs separately; unknown is null.
Retain original source status/priority, uncertain dates and provenance rather
than silently converting source assertions into confirmed work.

Recurring duties use the existing routines collection with inherited project
access and append-only occurrence receipts. Completion does not end the duty.

Shawna can manage work, approved reporters, messages and Maintenance membership.
Only Dan, the root owner, appoints/removes Maintenance managers and permanently
deletes work. Editors archive/restore and retain attribution. Reporter approval
does not grant staff record access or imply outbound messaging consent.

Incoming messages are durably collected without chat running. Unknown senders
are quarantined for managers. Chat proposes changes from retrieved evidence;
Shawna approves task updates through existing versioned Task Management commands.
Review/linking never silently completes a task. Evidence remains in Correspondence.
Outgoing messages require immutable draft review and approval of exact content,
recipient and photos. Sending/unknown outcomes are never automatically resent.
Provider acceptance and delivery are distinct. Opt-outs block future sends.

## New component and tradeoff

Add one `fbc-maintenance-messaging-worker` Cloud Run service, a dedicated Cloud
Tasks queue, and a scheduled Microsoft mailbox poll. Existing services lack
headless Microsoft/Twilio intake. Keeping provider credentials in an isolated
worker is preferred to extending the main API with public provider webhooks.
This adds deployment/monitoring work and metered Google/Twilio charges.

The worker verifies Twilio signatures against a configured canonical URL and
account/number. Internal routes verify Google OIDC audience and specific caller
service accounts. The existing product API forwards the authenticated individual;
the worker independently checks current Maintenance manager authority.

Mailbox permission must be scoped to `maintenance@foundedonfaith.com` with
Exchange application RBAC. Inspect/reuse an existing appropriate application
before creating one. Do not leave additive tenant-wide Entra mail grants. Store
credentials only in Secret Manager. Entra staff sign-in does not grant this
background mailbox permission.

Twilio's existing number and prayer campaign remain separate. Use a dedicated
Maintenance number, service and appropriate campaign under the existing account.
No numbers were purchased and no existing routing was changed during this build.

## Import and activation gates

- Resolve conflicting building labels before import; omission is not deletion.
- Reconcile the final master, worksheet corrections and keys addendum, preserving
  assignments as requested/proposed unless confirmed. The existing back-door
  security task is not automatically merged with general door repairs.
- Photo placeholders do not establish actual available files.
- Keep BHE-owned work distinct from FBC; donated-work letters are later scope.
- Purchase/registration costs, scoped Microsoft access and credential setup,
  live identity/permission checks, and real email/SMS/photo acceptance remain
  launch gates. Local tests do not close those gates.

## Rollback

Disable outbound sending, pause Scheduler and the dedicated queue, and restore
the previous API/MCP/worker revisions. Do not delete receipts, photos or work.
Structured task fields and routine histories are additive. Preserve the existing
Twilio integration throughout. No migration of existing IDs or endpoints.
