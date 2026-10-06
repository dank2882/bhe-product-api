# Approve once, finish the booking

Accepted by Dan October 6, 2026: “PLEASE IMPLEMENT THIS PLAN”.

Extend existing appointments and Life OS; Outlook retains calendar ownership.
Approval of the presented calendar action means finish in the active chat unless
Dan explicitly requests approval-only. Preserve exact action and family approvals
across chats. Missing calendar access preserves approval for Dan's connected
session, without granting Sarah Dan's external credentials. No background work.

## Additive contract

Appointment summaries and command readbacks include `booking`: state, nextAction,
blockers, actionId, approvalActionIds, calendarBooked, participantAgreed,
pendingMessageCount, pendingFamilyNoticeCount, connectorAccess. States are
needs_arrangement, approvals_needed, ready_to_book, reconciliation_needed,
blocked (unverified dependencies), booked and closed. Read-only projection never
claims connector availability. ready_to_book still requires fresh calendar
preflight and beginAppointmentAction before the external write.

Review timestamps are optional for both waiting and booked appointments. Reviews
surface response_pending and participant_agreement_pending. Recording a matching
provider result cannot fail solely because no reminder was set. Booking does not
invent participant agreement; notices and messages remain separately tracked.

No migration: existing records and approvals project current progress on read.
No new service, credentials, scopes or autonomous sends. Missing connections,
conflicts and uncertain outcomes are concrete blockers, not reasons to repeat
approval. Reconcile attempted writes rather than replaying them.

## Acceptance

Verify both approval orders, changed arrangement, in-hours booking, optional
review times, unresolved replies in reviews, dependencies, unavailable calendar
connection guidance and interrupted-write recovery. Deploy existing core and
gateway, publish the same plugin listing, verify fresh-client behavior, then
finish only remaining authorized work on the October 7 appointment. Record
implementation, deployment and client/calendar acceptance separately.
