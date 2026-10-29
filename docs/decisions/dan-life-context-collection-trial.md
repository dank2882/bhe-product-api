# Life Context desktop collection trial

Date: 2026-10-28 Pacific. Status: manual trial verified; unattended/GCP pipeline
proposed, not implemented or approved by this document.

The existing MVP is released; see [its release record](dan-life-context.md).
Dan approved proceeding with a small manual desktop collection trial. This
document contains engineering observations only, not private source contents.

## Verified trial

- Messages: three recent chats, 13 message entries including reactions, bounded
  to October 28 Pacific. More chats and one thread continuation remained.
- WhatsApp: native app chat list plus two conversations readable on the current
  Mac; long messages had collapsed/truncated text. Archives/media not reviewed.
- Outlook: five date-filtered email results with more available; six primary
  calendar events for October 29, no continuation for that calendar/window.
- Task Management: one exact current task read to reconcile a communication
  finding with an existing record. No new obligation was created.
- This was not a full Daily Brief. Care, sermons, shared mailboxes, Dropbox,
  Shopify and the full task inventory were outside this sample.
- No source sends, task/calendar mutations, profile writes, cloud inference,
  collector deployment or scheduler changes. Native WhatsApp viewing may have
  normal read-receipt effects.

The sample supports the usefulness of temporary personal context, acknowledged
availability changes, tentative commitments and cross-source deduplication.
Interpretations were review-only and were not promoted into approved profiles.

## Reuse and gaps

Reuse the Life Context owner in core, Correspondence Voice Profile, established
source-check and comparison patterns, existing Cloud Run/Firestore/authentication,
and current local execution capabilities. Do not introduce a competing task,
voice, care or sermon store.

The Correspondence `src/models/pastorDailyBrief.js` schema accepts six source
types, omitting WhatsApp, care and sermons. Its `itemStateFingerprint` hashes
metadata rather than source text. Reuse its pattern, not its unchanged schema,
as the automatic context store. It remains a separate owning daily-brief feature.

`lib/capacity-planning-policy.js` accepts a constrained capacity input and requires
fresh Outlook evidence. It does not accept Life Context. Context should inform
explained proposals, with deterministic capacity/conflict validation retained.
Do not invent effort/capacity from inferred personal conditions.

Observed Messages responses provide stable chat GUIDs but no message-level IDs;
WhatsApp UI observations provide neither dependable native message IDs nor a
complete unattended export contract. Hashes can assist provisional deduplication,
but do not establish native identity, edit detection, deletion or complete scans.

The inspected core has Vertex embedding infrastructure, not an established
text-contextualization adapter. Embeddings are outside this scope. Existing
cloud credentials/IAM must be checked for the selected generation model before
implementation; this trial did not verify them.

## Proposed next slice

1. Prove the same bounded source access inside the intended noninteractive local
   runtime before creating a new daemon or enabling a schedule.
2. Extend the existing core service with an authenticated source-packet intake,
   idempotent run receipts and one bounded GCP contextualization operation.
   Assess existing queue patterns only if request/runtime limits require them.
3. Return a compact provisional observation revision through the existing Life
   OS connection, then demonstrate a read-only planning explanation.

Proposed packets carry run ID, owner, collection date/timezone, per-source window,
coverage/continuation state, source ID/version when available, minimal excerpt
and content fingerprint. Credentials, tokenized links, full conversation archives
and attachments do not belong in packets or logs by default.

Generated observations must remain distinct from approved profile sections.
Each has source references, source/processing timestamps, uncertainty, expiry or
review date and superseded revision. Corrections invalidate dependent summaries;
recompute from cited evidence, not recursively from old summaries. Promotion to
approved Life Context and selection of Voice Profile examples remain explicit.
This schema extension is proposed and requires Dan's architecture review.

## Proposed orchestration

Target 06:25 America/Los_Angeles. One logical run per owner/local date, per-source
locks, bounded retries, and checkpoints advanced only after acknowledged intake.
Unavailable sources produce partial/unavailable receipts and last-success age.
The next run catches up from the last acknowledged boundary with bounded overlap
and a visible backlog; it does not replay every missed daily brief. Proposed
starting budget: five-minute local run, at most two retries, skip unchanged
content, one ordinary daily synthesis, bounded repair allowance and a configurable
monthly spending hard stop. Verify model pricing and measured volume before any
dollar estimate. No schedule or spending limit is enabled by this document.

An open chat is not a scheduler. `codex exec` supports noninteractive execution,
but host Messages/WhatsApp tools and locked/sleeping Mac behavior still require
testing in that exact runtime. Cloud continuation cannot replace an unavailable
computer's local tools. Sources:

- https://learn.chatgpt.com/docs/developer-commands#codex-exec
- https://learn.chatgpt.com/docs/get-started-with-work#continue-work-across-devices

## Acceptance gates before enabling

- Exact runtime source access, including pagination and long WhatsApp messages.
- Same-input idempotency and no unnecessary model call; source edits/corrections
  supersede affected observations without rewriting original evidence.
- Offline, locked/asleep, denied access, token expiry, partial source and retry
  tests; no false complete/empty-source claims or silent missed collection.
- GCP output preserves source attribution, answered/unanswered state and
  tentative/confirmed distinctions; approved profiles remain unchanged.
- Fresh client retrieves only relevant current observations and freshness;
  no automatic task/calendar/message mutation follows from retrieval.

Sol remains appropriate for this unresolved runtime/schema decision. Use Terra
for implementation after the next slice and success criteria are accepted.
