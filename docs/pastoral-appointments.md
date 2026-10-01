# Pastoral Appointments

Status: accepted October 1, 2026; implementation and live acceptance tracked separately.
Dan authorized: “ok lets build it/impiment it!” after the full design, five review
refinements and natural-conversation usability requirement.

## Ownership and experience

Extend the existing core API, Firestore and Dan Life OS gateway. Owner `dan`,
serves `dan,fbc`; reuse private authorization and existing explicit delegation.
No new service, identity, database, inbox monitor or autonomous sender.

The experience is three requests: “help me handle this request”, “help me prepare”
and “let me debrief”. Ask only questions requiring Dan's judgment. Present a
short recommendation and an itemized arrangement; one approval can cover exact
calendar blocks and a message. Never require users to manage IDs or statuses.

Appointment records own neutral workflow state and source references. Outlook
owns timed commitments; Notebooks owns ordinary agendas and notes; tasks, care,
prayers and correspondence retain their owners. Keep existing agendas at Faith
Baptist Church / Meeting Agendas. No migration or duplicate domain records.
Confidential purposes, urgency explanations, debriefs and prayer requests go to
their owning tools from first contact. Restricted appointments use fixed neutral
titles; audit events contain identities, operation and time, never source text.
Unapproved sensitive drafts are not durably preserved by appointments.

## Workflow

Discern whether Dan, another leader, a message, call or meeting is appropriate.
Use verified responsibility information, never invent an assignee. Offer a kind
request for a general purpose if needed; urgency and emotional demand are
judgments to discuss, not automated rejection rules.

Review live availability, relevant scheduled work and known completed work,
including Dan's report. Planned work is not completed work. Capacity advice is
explainable and advisory; unknown history does not mean free energy.

Propose 30 private minutes for review/prayer before demanding meetings. For
off-site meetings use preparation, outbound travel, meeting, return travel as
needed. Significant research happens earlier. Confirm meeting length/location.
Check the entire sequence, then recheck each action immediately before writing.
Default Pacific time, original-channel confirmations, no invitation unless
approved; private preparation/travel blocks never have attendees.

Calendar presence means held, not confirmed. Record agreement to actual current
time and location separately. Waiting and holds have explicit review times;
review is manual through daily/weekly workflows, never background expiration.
Dan brings replies back. Read current Outlook events before preparation, changes
and communication; direct changes trigger reconciliation, never silently move
other blocks. Record cancelled/no-show/met/no-debrief-needed explicitly.

## Approval, evidence and recovery

Versioned proposals are approved by exact hashes. Each action retains its own
status/result; revision invalidates only affected unattempted approval. Record
an attempt before invoking external tools. Stable keys are only useful when the
destination supports them. Never replay a non-idempotent send/create after an
ambiguous result: read the calendar or sent messages first. Unknown stays open.

Calendar and message observations are explicitly client connector evidence;
they never claim backend provider verification or recipient delivery. Domain
references are verified by an authenticated gateway read, storing only opaque
identity/version receipts. A verified link does not prove exact source wording;
the owning workflow must independently check the saved content.

Debrief ordinary material through existing Intake; route care/prayers directly
to owning tools, with stable per-item keys and readback. Distinguish discussion
from commitments, check duplicates and resolve identities. Proposed tasks,
care notes, prayers, messages, notes and follow-on appointments require review.
Every item is independently tracked; completion does not complete downstream
tasks. Lists expose total counts and pagination; reads never mutate state.

## Release gates

- [ ] Backend and gateway implementation; catalogs and distribution instructions.
- [ ] Tests: approval change, access, privacy, conflict, sequences, external edits,
  response/agreement states, unknown sends, partial writes, debrief and recovery.
- [ ] Required core and platform checks; commit implementation evidence.
- [ ] Backend then gateway deployment with rollback revisions and unchanged auth.
- [ ] Existing plugin updated in place; downloaded package independently checked.
- [ ] Fresh-client complete appointment with approved external test recipient,
  interruption, direct Outlook change, debrief and verified owning follow-up.
- [ ] Remaining follow-up destinations and available delivery channels verified.
- [ ] Durable acceptance receipts and requirement-by-requirement completion audit.
