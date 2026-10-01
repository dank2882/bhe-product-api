# Pastoral Appointments

Status: implemented and verified October 1, 2026, within the evidence boundaries below.
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

- [x] Backend and gateway implementation; catalogs and distribution instructions.
- [x] Tests: approval change, access, privacy, conflict, sequences, external edits,
  response/agreement states, unknown sends, partial writes, debrief and recovery.
- [x] Required core and platform checks; commit implementation evidence.
- [x] Backend then gateway deployment with rollback revisions and unchanged auth.
- [x] Existing plugin updated in place; downloaded package independently checked.
- [x] Complete appointment acceptance across connector and fresh-client checks with approved external test recipient,
  interruption, direct Outlook change, debrief and verified owning follow-up.
- [x] Remaining follow-up adapters checked against owning contracts and rejection tests;
  available email channel tested live. Text/manual channels retain explicit user-reported evidence.
- [x] Durable acceptance receipts and requirement-by-requirement completion audit.

## Release evidence and practical limits

Core implementation commit `54cbdbe`; gateway/instructions commit `bd8d5c9`.
Core full suite: 764 passed. Platform full suite: 211 passed; the subsequent
expanded owning-adapter regression suite passed all 5 focused tests. Required
checks passed in both repositories.

Production core revision `bhe-product-api-00323-mov` and gateway revision
`dan-life-os-mcp-00034-ruv` each serve 100% of normal traffic. Previous rollback
revisions are `bhe-product-api-00321-vev` and `dan-life-os-mcp-00032-zol`.
Runtime environment/service-account comparisons were unchanged. No OAuth,
scope, audience, app-binding or identity migration was performed.

The existing ChatGPT Life OS listing was updated in place to 1.0.5 (its version
sequence is independent of the repository package). All nine downloaded files
matched the submitted package. The existing app catalog was refreshed and a new
chat successfully used the appointment tools, including a verified task handoff.

| Requirement | Acceptance evidence |
| --- | --- |
| Discernment before booking; gentle clarification | Published workflow instructions; versioned response decisions and explicit waiting/review rules |
| Advisory energy and preparation/travel ordering | Policy tests for demand basis, unknown coverage, sequences, overlap and timezone offsets |
| Held versus agreed; simple itemized approval | State/approval tests; real calendar booking held before explicit test agreement |
| Confidentiality and domain ownership | Restricted capture/audit tests; wrong-identity/stale-version adapter rejection; no care/prayer text stored in appointments |
| Booking, rescheduling, reconciliation and cleanup | Two real Outlook blocks created, moved 15 minutes, reconciled, removed; individual 404s and empty bounded calendar verified |
| Confirmation with honest evidence | One exact approved self-addressed email; Sent Items readback and correspondence version 2; delivery remains unverified |
| Interruption and duplicate protection | Internal handoff interrupted after owning save, stable-key replay, one task; ambiguous email result reconciled without resend |
| Debrief and follow-through | Fresh chat created and verified a private task; debrief left task open; separate test cleanup marked it done |
| Recovery in a new conversation | Fresh OAuth client read appointment/history/preparation; independent final reads confirmed appointment version 36 and task version 2 |
| Existing agendas and follow-up destinations | Existing Meeting Agendas retained; all owning adapters checked, care/prayer identities and privacy tested without inventing live care histories |

Receipts: [internal acceptance](pastoral-appointments-internal-acceptance-20261001.json),
[Outlook acceptance](pastoral-appointments-outlook-acceptance-20261001.json),
[plugin publication](pastoral-appointments-plugin-publication-20261001.json),
[fresh client](pastoral-appointments-fresh-client-20261001.json).

Evidence is layered: Outlook observations are client connector readbacks; source
references are owning-gateway identity/version readbacks; automated tests cover
edge cases. Live care/prayer writes were deliberately not fabricated. The fresh
client initially overstated email delivery from a sent-copy timestamp and then
corrected that statement; the durable workflow never asserted delivery. A sent
copy's receivedDateTime is not delivery proof. These checks do not establish
post-expiry OAuth durability or autonomous inbox monitoring.
