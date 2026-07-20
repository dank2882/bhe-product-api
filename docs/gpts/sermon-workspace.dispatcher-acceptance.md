# Sermon Workspace Dispatcher Acceptance

Run this checklist in Custom GPT Preview after changing the Action schema, instructions, knowledge files, authentication, dispatcher, or operation registry.

## Installed Files

- Action schema: `sermon-workspace.schema.dispatcher-upload.json`
- Instructions: `sermon-workspace.instructions.upload.md`
- Knowledge: `sermon-workspace.operation-catalog.md`
- Knowledge: `sermon-workspace.supplemental.md`
- Authentication: API key in custom header `x-api-key`

## 1. Live Catalog

Prompt:

> Show me the live sermon workspace catalog version and the number of available operations.

Expected:

- Calls `listSermonWorkspaceOperations`.
- Returns the same catalog version shown in `sermon-workspace.operation-catalog.md`.
- Returns the same operation count shown in `sermon-workspace.operation-catalog.md`.

## 2. Successful Query

Prompt:

> Search the sermon archive for "Living Free" using the sermon workspace.

Expected:

- Calls `runSermonWorkspaceQuery` with operation `listSermons`.
- Returns the preached sermon and its complete sermon ID.
- Does not use web search.

## 3. Clean Zero Results

Prompt:

> Search the sermon archive for "Dispatcher No Match 9f76b1".

Expected:

- Returns `ok: true`, `count: 0`, and an empty sermons list.
- Does not report a backend error.

## 4. Structured Logical Error

Prompt:

> Retrieve sermon ID `sermon-does-not-exist` and show me the exact structured result.

Expected:

- HTTP Action succeeds.
- Body returns `ok: false` with `error.code: sermon_not_found`, logical status 404, and a request ID.
- No raw `ClientResponseError` is shown.

## 5. PowerPoint Artifact

Prompt:

> No artifact_handoff. Call runSermonSlides: Living Free | 2025-10-12

Expected:

- Calls direct Action `runSermonSlides` exactly once.
- Supplies the stable idempotency key for the PowerPoint intent.
- Does not call `getSermonContext`.
- Always returns presentation ID, template ID, slide count, and one Markdown PPTX download link using the exact `downloadUrl`.
- Does not claim the file is "displayed above"; an automatic attachment is optional and the explicit link is authoritative.

## 6. Retry Safety

Repeat the same artifact call with the same operation, arguments, and idempotency key.

Expected:

- Returns the same presentation ID.
- Returns `idempotency.protected: true` and `idempotency.replayed: true`.
- Does not create another presentation record or PPTX.

## 7. Idempotency Misuse

Reuse the preceding idempotency key but change the presentation title.

Expected:

- Returns `ok: false` with `error.code: idempotency_key_reused` and logical status 409.
- Does not create a presentation.

## 8. Successful Command

Prompt:

> Create a sermon idea titled "Dispatcher Acceptance Test" tagged `dispatcher-acceptance`, using a stable idempotency key. Then retry the exact same command with the same key.

Expected:

- First call creates one sermon.
- Retry returns the same sermon ID with `idempotency.replayed: true`.
- Search returns exactly one matching test sermon.
- Archive the test sermon after verification.

## 9. Specialized Direct Workflow

Choose a known sermon and request a manuscript selection dry run.

Expected:

- Calls direct Action `createSermonManuscriptDraft` with `dryRun: true`.
- Returns selection/context statistics without generating a duplicate manuscript.

## 10. Upcoming Preaching Occasion

Prompt:

> What am I preaching next? Use the sermon workspace schedule.

Expected:

- Calls query operation `listSermons` with `upcomingOnly: true`.
- Returns the nearest structured occasion with sermon title, date, time when known, venue,
  and service.
- Does not invent a missing time or venue.

## 11. Sermon Readiness

Prompt:

> Where is "Season in Egypt" in development, and what should I work on next?

Expected:

- Resolves the sermon without guessing.
- Calls `evaluateSermonReadiness` with its sermon ID.
- Reports stage, score, next occasion, blockers, and recommended next step.
- Makes no changes.

## 12. Series Progression

Prompt:

> Review the progression of the James — Living Our Faith series. What was last, and what textual movement is likely next?

Expected:

- Calls `reviewSermonSeriesProgression`.
- Reports the current canonical series metadata without inventing gaps.
- Identifies Message 11 as the last completed numbered sermon when the live archive is unchanged.
- Treats James 2:14 as a mechanical next start, not a selected sermon.
- Labels the suggested next Scripture start as mechanical and requires literary/pastoral review.

## 13. Preaching Preparation Dashboard

Prompt:

> Show my preaching-preparation dashboard. Use the sermon workspace and make no changes.

Expected:

- Calls `buildPreachingPreparationDashboard` once.
- Sends only `{ "limit": 12 }`; it does not add the current date or time zone.
- Returns upcoming sermons in chronological occasion order and a separate priority order.
- Reports unidentified placeholders and the best next action.
- Identifies Firestore as the authoritative source and the dispatcher as its API access path.
- Includes time, venue, and service when saved without inventing missing details.
- Makes no changes.

## 14. Scheduled Sermon Selection

Use only after Dan explicitly selects a sermon for a real scheduled placeholder.

Expected:

- Calls `selectSermonForOccasion` once with the exact `occasionId`, `confirmed: true`, and a
  stable idempotency key.
- Preserves the existing occasion and its date, time, venue, and service.
- For a series sermon, saves the canonical series id/title/slug and confirmed series number.
- Updates the empty placeholder hub in place, or safely moves the occasion to an existing hub.
- Refuses to displace a substantive sermon.
- Does not leave a second active placeholder for the same occasion.

## 15. Development Session Preservation

Use a real sermon Dan is actively developing.

Prompts:

> Let's get into development mode for this sermon while I walk.

> I keep coming back to this: mercy does not merely interrupt judgment; in Christ, mercy gets the final word. Save that exact final wording. Also preserve my application thought separately.

After Chat offers one concise sermon line, say:

> That's it. Save exactly what you just said and carry it into shaping.

> One final thought: mercy changes what gets the last word. Save that, close the development
> session with a concise summary, and tell me whether anything remains checkpointed but not integrated.

Expected:

- Calls `startSermonDevelopmentSession` once with the complete initiating Dan turn and planned first
  reply. The stored first reply uses the backend sermon title and real session ID, and both initial
  turns appear in the ledger.
- Before each substantive reply, calls `captureSermonDevelopmentTurn` with the complete preceding
  Dan turn and the exact planned reply as `assistantTranscript`, then speaks that stored reply
  verbatim. The backend assigns sequence numbers.
- On Dan's natural approval, preserves the preceding stored assistant turn exactly as an
  assistant-authored, `unplaced` checkpoint linked to both the assistant proposal and Dan approval.
- Keeps unapproved assistant turns as audit evidence only and excludes them from the Dan transcript
  source used by shaping/manuscript workflows.
- Saves a separate `application` checkpoint without manufacturing near-duplicate category records.
- Never calls standalone `saveSermonDevelopmentCheckpoint` while the session is active. A direct
  attempt returns `sermon_development_turn_capture_required` and leaves the checkpoint unsaved.
- Calls `finalizeSermonDevelopmentSession` with the complete closing utterance as `finalTranscript`,
  the planned closing receipt as `assistantTranscript`, and the expected Dan-turn count including
  the close request, then calls `auditSermonDevelopmentPreservation`.
- A dispatcher finalizer call without that exact closing pair returns `missing_operation_arguments`
  listing `finalTranscript` and `assistantTranscript`, and leaves the session active. Direct service
  calls are also guarded by `missing_sermon_development_final_exchange`.
- The closed session has a raw transcript source assembled from captured turns without requiring
  Chat to reconstruct and send the conversation.
- Reports `completionReceipt`, including session ID, verified Dan/assistant counts, checkpoint count,
  transcript source ID, and final turn IDs, plus the unplaced count.
- Distinguishes durably preserved checkpoints from canonical integration.

## 16. Dan-Only Cut Enforcement

Using one unplaced test checkpoint, call `updateSermonDevelopmentCheckpointPlacement` with
`materialStatus: intentionally_cut` but without Dan authorization fields.

Expected:

- Returns `ok: false` with `error.code: dan_cut_authorization_required`.
- Leaves the checkpoint unplaced.

Then have Dan explicitly authorize the cut and call again with `danAuthorizedCut: true`, a specific
`cutReason`, and `danApprovalEvidence` preserving his authorization.

Expected:

- Marks the checkpoint intentionally cut.
- Returns `cutAuthorizedBy: dan`, approval evidence, and prior status history.

## 17. Server Logs

For each dispatcher call, Cloud Run logs should contain:

- `sermon_workspace_operation_started`
- `sermon_workspace_operation_succeeded` or `sermon_workspace_operation_failed`
- request ID
- operation and mode
- duration in milliseconds
- response size in bytes
- logical error status when applicable
- idempotency protection and replay status when applicable

Logs must contain argument names only, never sermon text, API keys, or raw idempotency keys.

## 18. Personal Scripture Commentary

Prompt:

> Show my personal commentary on Psalm 37:17. Preserve authorship and source attribution.

Expected:

- Calls `getPersonalScriptureCommentary`.
- Returns only active notes anchored to the requested passage.
- Distinguishes Dan's wording, AI synthesis, and external quotation when present.
- Makes no changes.

For a real attached Logos export, verify `importScriptureNotes` is called once with one stable
idempotency key. The result must report segment, active-note, unresolved, duplicate, reference-
correction, and routing counts. Do not ask Dan to review each candidate.

## 19. Unified Preaching Packet

Use a sermon with an accepted `primaryManuscriptSourceId`.

Prompt:

> Create the complete preaching packet for this sermon. Reuse the accepted manuscript and latest slides. Do not regenerate either unless one is missing.

Expected:

- Calls `createSermonPreachingPacket` once through `runSermonWorkspaceArtifact` with a stable idempotency key.
- Reuses the primary manuscript and latest rendered presentation.
- Creates a presentation only when no rendered deck exists.
- Returns and attaches one ZIP containing the editable DOCX, editable 16:9 PPTX, manuscript text, packet metadata, source manifest, and README.
- Returns `packetId`, `presentationId`, `manuscriptSourceId`, slide count, template ID, and download details.
- A retry with the same idempotency key replays the same packet rather than creating duplicates.
