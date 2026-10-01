# Family approval for pastoral appointments

Accepted October 1, 2026. Dan requested approval from his wife for meetings
outside his normal schedule, then notification when confirmed. He authorized
implementation with “ok create that please”. His normal hours are Monday–Friday,
08:30–11:30 and 13:30–16:30, America/Los_Angeles. Dan selected text and confirmed Sarah's mobile number; policy version 2 has complete setup, independently read back.

## Scope and ownership

Extend existing Dan-owned appointment records/settings, the existing Life OS
connection, private delegation, and approved Correspondence sends. No new
service, authentication grant, polling worker or autonomous sender. Settings
use one private owner record with version checks and idempotent receipts.
Only Dan can change the policy; Sarah's existing delegation allows her own
attributed approval, without impersonating Dan or borrowing his connector login.

The rule checks each preparation, earlier-reading, travel, meeting and recovery
block against explicit weekly local-time windows. Lunch, evenings and weekends
are outside the supplied hours. Interval ends are exclusive; DST is evaluated
against actual instants. Split overnight windows at midnight. Missing setup
blocks booking; no hours, spouse identity or contact is guessed.

Approval binds the exact time/location sequence and policy version. Changing
any of these invalidates approval. Calendar IDs acquired during creation do not.
Dan's action approval is separate from his wife's decision. Silence, a calendar
entry, a pending request, and Dan reporting approval cannot substitute for her
explicit decision. There is no automatic emergency bypass.

Wife approval evidence is either her configured authenticated subject or a fresh
connector read of her explicit reply, with exact configured sender/channel and
a source-message ID. The latter is client evidence, not independent backend
provider verification. Reply text and confidential meeting details stay in their
owning systems. A decline or revocation blocks the arrangement.

The backend refuses to begin a calendar create/update or regular arrangement
message without the required approval. Confirmation requires all calendar blocks
verified. Cancellation stays available. External Outlook edits cannot be
prevented; reconcile them before further action and obtain renewed approval.

## Notifications and recovery

Confirmation of an approved out-of-hours arrangement creates a durable pending
wife notice. Changes and cancellations create updated notices; obsolete pending
notices are superseded. A notice contains neutral scheduling details only.
The client drafts exact text in Correspondence, presents it for approval, then
uses an ordinary versioned appointment message action with familyPurpose,
arrangementHash and familyNoticeId. Approval requests use familyPurpose
approval_request and the current proposed arrangementHash.

Messages use the configured contact/channel. Only a verified sent readback (or
explicitly labeled manual-send report) satisfies a notice. Unknown sends stay
pending and must be reconciled, never blindly retried. Sending does not assert
recipient delivery. Unsent obsolete message actions must be explicitly dismissed;
attempted actions still need reconciliation. Pending notices appear in reviews
and prevent the appointment from being reported fully complete.

This remains foreground work initiated by Dan or Sarah. No background inbox
monitor or automatic text/email delivery is introduced. Email/text availability
is checked through the existing connector before promising delivery.

## Acceptance

Test owner-only setup, incomplete setup, boundaries and DST, prep/travel outside
hours, exact approvals, invalid sender, declines, changes and policy invalidation,
confirmation notice lifecycle, unknown sends, cancellation and duplicate recovery.
Run both repository checks and suites; verify candidate/production deployments,
policy readback, and published instructions. Real messages to Sarah need their
exact wording reviewed; no unsolicited live test message is sent.

## October 1 release evidence

Core revision `bhe-product-api-00327-cog` and gateway revision
`dan-life-os-mcp-00036-waw` serve 100 percent of normal traffic. Runtime
environment and service accounts match the pre-feature revisions. Core checks
and 770 tests pass; platform checks and 212 tests pass. The final cancellation
regression prevents stale confirmed notices and new approvals after closure.

Policy version 2 is enabled and fully configured with Dan-confirmed text contact.
Production readback and a fresh Life OS chat both show the supplied hours and
text preference. Live negative tests denied booking without wife approval and
Dan acting as the wife; their synthetic appointment was closed without calendar
writes or sends. Published ChatGPT plugin 1.0.6 independently matched all nine
submitted files (repository/Codex package version 1.0.8).

Text delivery remains unverified: Messages lookup returns `bootstrapTimedOut`.
No test message was sent to Sarah. End-to-end approval request, actual reply and
confirmation acceptance remains open; pending notices remain visible. See
[`appointments-family-acceptance-20261001.json`](../appointments-family-acceptance-20261001.json)
for bounded evidence and the fresh-client reference.
