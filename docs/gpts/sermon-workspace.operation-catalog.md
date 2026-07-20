# Sermon Workspace Operation Catalog

Upload this file as Custom GPT knowledge. It documents backend operations routed through four stable OpenAPI Actions. The knowledge file describes operations; the dispatcher Actions execute them.

## Routing Rules

1. Use `listSermonWorkspaceOperations` when the correct operation or arguments are unclear.
2. Use `runSermonWorkspaceQuery` for read-only retrieval and analysis.
3. Use `runSermonWorkspaceArtifact` for downloadable generated artifacts.
4. Use `runSermonWorkspaceCommand` for creates, imports, appends, updates, indexing, and other durable changes.
5. Send the catalog operation name in `operation` and its inputs inside `arguments`.
6. Never invent operation names. If an operation is unknown, retrieve the live catalog.
7. For artifact and command operations, send a stable `idempotencyKey` for one user intent and reuse it only when retrying that same intent.

Dispatcher request shape:

```json
{
  "operation": "listSermons",
  "arguments": {
    "query": "Living Free",
    "limit": 10
  }
}
```

Catalog version: `1-212020f3be3a`

Catalog hash: `212020f3be3ac92a16f42338ac68a86fb16acd8d846026aca64568b9ec15cc25`

The registry currently exposes 89 operations. Adding registry operations does not add OpenAPI operations.

## Query Operations

Use `runSermonWorkspaceQuery` for every operation in this section.

### listSermons

Search or list compact sermon records with date, passage, occasion, series, and sort filters.

Required: none

Optional: `query`, `status`, `seriesId`, `seriesSlug`, `seriesTitle`, `tag`, `folderId`, `occasion`, `venue`, `service`, `occasionStatus`, `upcomingOnly`, `scriptureText`, `date`, `dateFrom`, `dateTo`, `dateField`, `preachedDate`, `targetDate`, `sort`, `limit`

```json
{
  "operation": "listSermons",
  "arguments": {
    "query": "Living Free",
    "limit": 10
  }
}
```

### listSermonOccasions

List structured preaching occasions across sermons by date, time, venue, service, status, or upcoming schedule.

Required: none

Optional: `sermonId`, `status`, `venue`, `service`, `query`, `date`, `dateFrom`, `dateTo`, `upcomingOnly`, `sort`, `limit`

```json
{
  "operation": "listSermonOccasions",
  "arguments": {
    "upcomingOnly": true,
    "limit": 10
  }
}
```

### resolveSermon

Resolve a sermon from title, date, passage, occasion, series, ID, or saved source evidence without guessing across ambiguous matches.

Required: none

Optional: `sermonId`, `query`, `title`, `scriptureText`, `occasion`, `folderId`, `seriesId`, `seriesSlug`, `seriesTitle`, `tag`, `status`, `date`, `dateFrom`, `dateTo`, `dateField`, `preachedDate`, `targetDate`, `includeSourceMatches`, `limit`

```json
{
  "operation": "resolveSermon",
  "arguments": {
    "title": "Living Free",
    "date": "2025-10-12",
    "includeSourceMatches": true
  }
}
```

### reviewSermonSeriesProgression

Review ordered series coverage, repeated passages and themes, numbering gaps, the last completed sermon, and the likely next textual starting point.

Required: none

Optional: `seriesId`, `seriesSlug`, `seriesTitle`, `includeArchived`, `limit`

```json
{
  "operation": "reviewSermonSeriesProgression",
  "arguments": {
    "seriesSlug": "james-living-our-faith",
    "limit": 100
  }
}
```

### reviewSermonMinistryArchive

Review a class, group, or event archive from canonical tags and retrieve sermon-text evidence before recommending a direction.

Required: `tag`

Optional: `excludeTags`, `semanticQuery`, `semanticLimit`, `limit`

Argument guidance: Canonical sermon tags control membership. Conflicting legacy venue or occasion text is reported but never overrides the selected tag. Do not recommend a lesson direction unless recommendationReadiness.ready is true and cite the returned semanticEvidence.

```json
{
  "operation": "reviewSermonMinistryArchive",
  "arguments": {
    "tag": "life-builders-class",
    "excludeTags": [
      "life-builders-retreat"
    ],
    "semanticQuery": "Recurring burdens, applications, and underdeveloped directions for the Life Builders class",
    "semanticLimit": 20,
    "limit": 100
  }
}
```

### auditSermonCompleteness

Audit a sermon hub for missing canonical fields and summarize saved source coverage without changing the sermon.

Required: `sermonId`

Optional: none

```json
{
  "operation": "auditSermonCompleteness",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### evaluateSermonReadiness

Evaluate a sermon’s current development stage, deadline readiness, blockers, gaps, and prioritized next steps without changing it.

Required: `sermonId`

Optional: none

```json
{
  "operation": "evaluateSermonReadiness",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### buildPreachingPreparationDashboard

Build one read-only Firestore-backed dashboard of upcoming preaching occasions, sermon readiness, placeholders, conflicts, and prioritized next actions.

Required: none

Optional: `asOfDate`, `dateFrom`, `dateTo`, `timeZone`, `venue`, `service`, `limit`

Argument guidance: For an unqualified sermon dashboard, send only limit: 12. Never add the current date or timeZone unless Dan requests a date or zone. Use asOfDate for all upcoming occasions on or after a date; use equal dateFrom and dateTo values for one exact day. The dispatcher reads the live authoritative Firestore data; never describe the dispatcher or workspace as an alternative to Firestore.

```json
{
  "operation": "buildPreachingPreparationDashboard",
  "arguments": {
    "limit": 12
  }
}
```

### listSermonDevelopmentSessions

List durable voice, walk, chat, study, or imported development sessions for a sermon.

Required: none

Optional: `sermonId`, `status`, `mode`, `limit`

```json
{
  "operation": "listSermonDevelopmentSessions",
  "arguments": {
    "sermonId": "sermon-id",
    "limit": 10
  }
}
```

### listSermonDevelopmentTurns

List the exact Dan or assistant turns durably captured during a sermon development session.

Required: none

Optional: `sermonId`, `sessionId`, `speaker`, `sort`, `limit`

```json
{
  "operation": "listSermonDevelopmentTurns",
  "arguments": {
    "sessionId": "sermon-session-id",
    "speaker": "dan",
    "sort": "asc",
    "limit": 500
  }
}
```

### listSermonDevelopmentCheckpoints

List preserved insights, exact preaching lines, illustrations, applications, decisions, and questions.

Required: none

Optional: `sermonId`, `sessionId`, `checkpointType`, `materialStatus`, `query`, `sort`, `limit`

```json
{
  "operation": "listSermonDevelopmentCheckpoints",
  "arguments": {
    "sermonId": "sermon-id",
    "limit": 25
  }
}
```

### getSermonMaterialInventory

Inventory every preserved sermon-development item by placed, unplaced, or intentionally-cut status, type, and placement target.

Required: `sermonId`

Optional: `materialStatus`, `checkpointType`, `limit`

```json
{
  "operation": "getSermonMaterialInventory",
  "arguments": {
    "sermonId": "sermon-id",
    "materialStatus": "unplaced",
    "limit": 100
  }
}
```

### proposeSermonMaterialPlacement

Preview a complete batch of checkpoint placement or cut decisions and return a stale-safe plan hash without changing the sermon.

Required: `sermonId`, `decisions`

Optional: `requireAllUnplaced`

```json
{
  "operation": "proposeSermonMaterialPlacement",
  "arguments": {
    "sermonId": "sermon-id",
    "requireAllUnplaced": true,
    "decisions": [
      {
        "checkpointId": "checkpoint-id",
        "materialStatus": "placed",
        "placementTarget": "Movement 2"
      }
    ]
  }
}
```

### auditSermonDevelopmentPreservation

Audit whether development checkpoints are integrated and optionally find uncovered excerpts in a saved session transcript.

Required: `sermonId`

Optional: `sessionId`, `sourceId`

```json
{
  "operation": "auditSermonDevelopmentPreservation",
  "arguments": {
    "sermonId": "sermon-id",
    "sessionId": "sermon-session-id"
  }
}
```

### proposeSermonCanonicalRepair

Prepare a read-only, source-grounded proposal for missing scriptureText, bigIdea, or outline fields.

Required: `sermonId`

Optional: `fields`

```json
{
  "operation": "proposeSermonCanonicalRepair",
  "arguments": {
    "sermonId": "sermon-id",
    "fields": [
      "scriptureText",
      "bigIdea",
      "outline"
    ]
  }
}
```

### getSermon

Retrieve one complete sermon record.

Required: `sermonId`

Optional: none

```json
{
  "operation": "getSermon",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### getSermonContext

Retrieve a sermon with its saved development context and optional source material.

Required: `sermonId`

Optional: `includeSourceMaterial`, `includePreachingProfile`, `sourceLimit`, `snapshotLimit`, `analysisLimit`, `sessionLimit`, `checkpointLimit`, `profileId`

```json
{
  "operation": "getSermonContext",
  "arguments": {
    "sermonId": "sermon-id",
    "includeSourceMaterial": false
  }
}
```

### getSermonArchiveStats

Return exact sermon archive, source, chunk, status, query, or Bible-book counts.

Required: none

Optional: `query`, `scriptureBook`, `status`, `sourceType`

```json
{
  "operation": "getSermonArchiveStats",
  "arguments": {
    "scriptureBook": "Romans"
  }
}
```

### listScriptureNotes

List or search Dan's automatically classified personal Scripture notes by reference, type, authorship, status, or text.

Required: none

Optional: `reference`, `query`, `status`, `noteType`, `authorship`, `limit`

```json
{
  "operation": "listScriptureNotes",
  "arguments": {
    "reference": "James 2:14-26",
    "status": "active",
    "limit": 50
  }
}
```

### getScriptureNote

Retrieve one complete personal Scripture note with provenance, attribution, warnings, and original wording.

Required: `scriptureNoteId`

Optional: none

```json
{
  "operation": "getScriptureNote",
  "arguments": {
    "scriptureNoteId": "scripture-note-id"
  }
}
```

### getPersonalScriptureCommentary

Assemble Dan's active personal commentary notes for a verse or passage while preserving authorship and attribution labels.

Required: `reference`

Optional: `includeUnresolved`, `limit`

```json
{
  "operation": "getPersonalScriptureCommentary",
  "arguments": {
    "reference": "Psalm 37:17",
    "limit": 100
  }
}
```

### listScriptureNoteImports

List automatic Scripture-note imports with classification, duplicate, correction, and unresolved counts.

Required: none

Optional: `status`, `limit`

```json
{
  "operation": "listScriptureNoteImports",
  "arguments": {
    "limit": 20
  }
}
```

### listScriptureNoteImportSegments

Inspect compact classification results for every preserved block in a Scripture-note import.

Required: none

Optional: `importId`, `classification`, `limit`

```json
{
  "operation": "listScriptureNoteImportSegments",
  "arguments": {
    "importId": "scripture-note-import-id",
    "classification": "unresolved",
    "limit": 100
  }
}
```

### listSermonSnapshots

List sermon change snapshots.

Required: none

Optional: `sermonId`, `limit`

```json
{
  "operation": "listSermonSnapshots",
  "arguments": {
    "sermonId": "sermon-id",
    "limit": 10
  }
}
```

### getSermonSnapshot

Retrieve one sermon snapshot.

Required: `snapshotId`

Optional: none

```json
{
  "operation": "getSermonSnapshot",
  "arguments": {
    "snapshotId": "snapshot-id"
  }
}
```

### listSermonSources

List saved sermon source records with optional filters.

Required: none

Optional: `sermonId`, `folderId`, `seriesId`, `seriesSlug`, `tag`, `sourceType`, `query`, `limit`

```json
{
  "operation": "listSermonSources",
  "arguments": {
    "sermonId": "sermon-id",
    "limit": 25
  }
}
```

### searchSermonSources

Search saved source records across the sermon archive.

Required: `query`

Optional: `sermonId`, `seriesId`, `seriesSlug`, `tag`, `sourceType`, `limit`

```json
{
  "operation": "searchSermonSources",
  "arguments": {
    "query": "freedom in Christ",
    "limit": 10
  }
}
```

### getSermonSource

Retrieve one full sermon source record.

Required: `sourceId`

Optional: none

```json
{
  "operation": "getSermonSource",
  "arguments": {
    "sourceId": "source-id"
  }
}
```

### listSermonMedia

List sermon audio, video, and linked media records.

Required: none

Optional: `sermonId`, `mediaType`, `transcriptStatus`, `query`, `limit`

```json
{
  "operation": "listSermonMedia",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### getSermonMedia

Retrieve one sermon media record.

Required: `mediaId`

Optional: none

```json
{
  "operation": "getSermonMedia",
  "arguments": {
    "mediaId": "media-id"
  }
}
```

### getSermonTranscriptionJob

Get durable background transcription status and source identifiers.

Required: `jobId`

Optional: none

```json
{
  "operation": "getSermonTranscriptionJob",
  "arguments": {
    "jobId": "sermon-transcription-job-id"
  }
}
```

### listSermonTranscriptionJobs

List transcription jobs by sermon, media record, or status.

Required: none

Optional: `sermonId`, `mediaId`, `status`, `limit`

```json
{
  "operation": "listSermonTranscriptionJobs",
  "arguments": {
    "sermonId": "sermon-id",
    "limit": 10
  }
}
```

### listUnmatchedSermonRecordings

List the unmatched recording inbox with parsed filename dates and top sermon candidates.

Required: none

Optional: `status`, `matchStatus`, `query`, `limit`

```json
{
  "operation": "listUnmatchedSermonRecordings",
  "arguments": {
    "status": "unmatched",
    "limit": 25
  }
}
```

### getUnmatchedSermonRecording

Retrieve one unmatched recording with all ranked sermon and occasion candidates.

Required: `inboxId`

Optional: `refreshMatches`

```json
{
  "operation": "getUnmatchedSermonRecording",
  "arguments": {
    "inboxId": "sermon-recording-inbox-id",
    "refreshMatches": true
  }
}
```

### searchSermonChunks

Search indexed sermon chunks by exact words, phrases, or passages.

Required: `query`

Optional: `sermonId`, `seriesId`, `seriesSlug`, `tag`, `sourceKind`, `chunkType`, `limit`

```json
{
  "operation": "searchSermonChunks",
  "arguments": {
    "query": "no condemnation",
    "limit": 10
  }
}
```

### semanticSearchSermonChunks

Search embedded sermon chunks by meaning or pastoral concept.

Required: `query`

Optional: `sermonId`, `seriesId`, `seriesSlug`, `tag`, `sourceKind`, `chunkType`, `limit`, `distanceMeasure`, `embeddingModel`

```json
{
  "operation": "semanticSearchSermonChunks",
  "arguments": {
    "query": "assurance for a guilty conscience",
    "limit": 10
  }
}
```

### answerSermonQuestion

Answer a question from retrieved sermon knowledge with citations.

Required: `question`

Optional: `sermonId`, `sourceKind`, `chunkType`, `limit`, `answerStyle`, `distanceMeasure`, `embeddingModel`

```json
{
  "operation": "answerSermonQuestion",
  "arguments": {
    "question": "What have I preached about freedom in Christ?"
  }
}
```

### getPreachingProfile

Retrieve the durable preaching style profile.

Required: none

Optional: `profileId`

```json
{
  "operation": "getPreachingProfile",
  "arguments": {}
}
```

### listPreachingAnalyses

List preaching analyses for a sermon or the archive.

Required: none

Optional: `sermonId`, `limit`

```json
{
  "operation": "listPreachingAnalyses",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### getSermonPostPreachingReflectionReadiness

Check whether a sermon has a planned baseline and preached transcript ready for evidence-grounded post-sermon reflection.

Required: `sermonId`

Optional: `manuscriptSourceId`, `transcriptSourceId`, `profileId`

```json
{
  "operation": "getSermonPostPreachingReflectionReadiness",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### proposeSermonPostPreachingReflection

Compare the planned sermon with its preached transcript and return a read-only, evidence-grounded reflection proposal.

Required: `sermonId`

Optional: `manuscriptSourceId`, `transcriptSourceId`, `profileId`

```json
{
  "operation": "proposeSermonPostPreachingReflection",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### listSermonPresentationTemplates

List reusable series PowerPoint templates.

Required: none

Optional: `seriesId`, `seriesSlug`, `status`, `query`, `limit`

```json
{
  "operation": "listSermonPresentationTemplates",
  "arguments": {
    "seriesSlug": "life-in-the-spirit"
  }
}
```

### getSermonPresentationTemplate

Retrieve one reusable PowerPoint template.

Required: `templateId`

Optional: none

```json
{
  "operation": "getSermonPresentationTemplate",
  "arguments": {
    "templateId": "template-id"
  }
}
```

### listSermonPresentations

List generated sermon PowerPoint decks.

Required: none

Optional: `sermonId`, `seriesId`, `seriesSlug`, `templateId`, `status`, `query`, `limit`

```json
{
  "operation": "listSermonPresentations",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### getSermonPresentation

Retrieve one generated PowerPoint record and download details.

Required: `presentationId`

Optional: none

```json
{
  "operation": "getSermonPresentation",
  "arguments": {
    "presentationId": "presentation-id"
  }
}
```

### listSermonPreachingPackets

List previously generated unified preaching packets for one sermon or the archive.

Required: none

Optional: `sermonId`, `limit`

```json
{
  "operation": "listSermonPreachingPackets",
  "arguments": {
    "sermonId": "sermon-id",
    "limit": 10
  }
}
```

### getSermonPreachingPacket

Retrieve one preaching packet record and its download details.

Required: `packetId`

Optional: none

```json
{
  "operation": "getSermonPreachingPacket",
  "arguments": {
    "packetId": "preaching-packet-id"
  }
}
```

## Artifact Operations

Use `runSermonWorkspaceArtifact` for every operation in this section.

### createSermonPresentation

Create an editable 16:9 PPTX and reuse the sermon series template.

Required: `sermonId`

Optional: `title`, `templateId`, `theme`, `slidePlan`, `slides`, `compact`

```json
{
  "operation": "createSermonPresentation",
  "arguments": {
    "sermonId": "sermon-id",
    "compact": true
  }
}
```

### createSermonPresentationFromLookup

Resolve a sermon by title, date, passage, occasion, series, or ID and create its editable 16:9 PPTX in one backend operation.

Required: none

Optional: `sermonId`, `query`, `title`, `sermonTitle`, `scriptureText`, `occasion`, `folderId`, `seriesId`, `seriesSlug`, `seriesTitle`, `tag`, `status`, `date`, `dateFrom`, `dateTo`, `dateField`, `preachedDate`, `targetDate`, `includeSourceMatches`, `limit`, `presentationTitle`, `templateId`, `theme`, `slidePlan`, `slides`, `compact`

```json
{
  "operation": "createSermonPresentationFromLookup",
  "arguments": {
    "title": "Living Free",
    "date": "2025-10-12",
    "dateField": "preachedDate",
    "compact": true
  }
}
```

### createSermonPreachingPacket

Package the accepted primary manuscript, editable 16:9 PowerPoint, portable manuscript text, sermon metadata, and source provenance into one downloadable ZIP.

Required: `sermonId`

Optional: `manuscriptSourceId`, `presentationId`, `regenerateSlides`, `presentationTitle`, `templateId`, `compact`

Argument guidance: Requires an accepted primary manuscript. Call the specialized createSermonManuscriptDraft Action first when primaryManuscriptSourceId is empty. Reuses the latest rendered presentation unless regenerateSlides is true.

```json
{
  "operation": "createSermonPreachingPacket",
  "arguments": {
    "sermonId": "sermon-id",
    "compact": true
  }
}
```

## Command Operations

Use `runSermonWorkspaceCommand` for every operation in this section.

### createSermon

Create a durable sermon hub.

Required: `title`

Optional: `status`, `scriptureText`, `bigIdea`, `notes`, `outline`, `targetDate`, `preachedDate`, `occasion`, `seriesId`, `seriesTitle`, `seriesSlug`, `seriesNumber`, `tags`, `sourceRefs`

```json
{
  "operation": "createSermon",
  "arguments": {
    "title": "New Sermon",
    "status": "idea"
  }
}
```

### createSermonOccasion

Add one scheduled or completed preaching occasion to a sermon hub.

Required: `sermonId`, `date`

Optional: `time`, `timeZone`, `scheduledAt`, `venue`, `service`, `status`, `notes`, `sourceRefs`, `mediaIds`

```json
{
  "operation": "createSermonOccasion",
  "arguments": {
    "sermonId": "sermon-id",
    "date": "2026-07-12",
    "time": "19:00",
    "timeZone": "America/Los_Angeles",
    "venue": "Faith Baptist Church",
    "service": "Sunday Evening Service",
    "status": "planned"
  }
}
```

### selectSermonForOccasion

Promote an empty scheduled placeholder into the selected sermon or safely assign its occasion to an existing sermon hub.

Required: `occasionId`, `confirmed`

Optional: `expectedCurrentSermonId`, `targetSermonId`, `title`, `status`, `scriptureText`, `bigIdea`, `notes`, `outline`, `seriesId`, `seriesTitle`, `seriesSlug`, `seriesNumber`, `tags`, `sourceRefs`, `changes`

```json
{
  "operation": "selectSermonForOccasion",
  "arguments": {
    "occasionId": "sermon-occasion-id",
    "expectedCurrentSermonId": "sermon-sunday-night-placeholder",
    "title": "Living Faith",
    "status": "developing",
    "scriptureText": "James 2:14-26",
    "seriesId": "series-james-living-our-faith",
    "seriesTitle": "James - Living Our Faith",
    "seriesSlug": "james-living-our-faith",
    "seriesNumber": 12,
    "confirmed": true
  }
}
```

### startSermonDevelopmentSession

Start a durable sermon development session and capture the initiating Dan/Chat exchange before speaking.

Required: `sermonId`, `initialTranscript`, `assistantTranscript`

Optional: `sessionId`, `mode`, `label`, `context`

Argument guidance: Send Dan's complete initiating turn and the exact planned reply. Use {{sermonTitle}} and {{sessionId}} placeholders; output storedAssistantTranscript verbatim after success.

```json
{
  "operation": "startSermonDevelopmentSession",
  "arguments": {
    "sermonId": "sermon-id",
    "mode": "walk",
    "label": "Friday evening walk",
    "initialTranscript": "Let's begin developing Sunday's sermon.",
    "assistantTranscript": "Tracked session started for {{sermonTitle}}. Session ID: {{sessionId}}"
  }
}
```

### saveSermonDevelopmentCheckpoint

Preserve one or more typed sermon-development checkpoints without compressing exact wording into a general summary.

Required: `sermonId`

Optional: `sessionId`, `checkpointType`, `heading`, `content`, `context`, `exactWording`, `canonicalTargets`, `materialStatus`, `placementTarget`, `placementNotes`, `cutReason`, `sourceRefs`, `checkpoints`, `danAuthorizedCut`, `danApprovalEvidence`

```json
{
  "operation": "saveSermonDevelopmentCheckpoint",
  "arguments": {
    "sermonId": "sermon-id",
    "sessionId": "sermon-session-id",
    "checkpoints": [
      {
        "checkpointType": "verbatim",
        "heading": "Preach this",
        "content": "Mercy gets the final word."
      }
    ]
  }
}
```

### updateSermonDevelopmentCheckpointPlacement

Move one preserved sermon-development item to unplaced, placed, or intentionally-cut without deleting it.

Required: `checkpointId`, `materialStatus`

Optional: `placementTarget`, `placementNotes`, `cutReason`, `canonicalTargets`, `danAuthorizedCut`, `danApprovalEvidence`

```json
{
  "operation": "updateSermonDevelopmentCheckpointPlacement",
  "arguments": {
    "checkpointId": "sermon-checkpoint-id",
    "materialStatus": "placed",
    "placementTarget": "Movement 2 - Grace sustains us"
  }
}
```

### applySermonMaterialPlacementPlan

Apply one previously reviewed material-placement plan only when its plan hash is current and confirmation is explicit.

Required: `sermonId`, `decisions`, `expectedPlanHash`, `confirmed`

Optional: `requireAllUnplaced`, `danAuthorizedCuts`, `danApprovalEvidence`

```json
{
  "operation": "applySermonMaterialPlacementPlan",
  "arguments": {
    "sermonId": "sermon-id",
    "decisions": [
      {
        "checkpointId": "checkpoint-id",
        "materialStatus": "placed",
        "placementTarget": "Movement 2"
      }
    ],
    "expectedPlanHash": "sha256-from-proposal",
    "confirmed": true
  }
}
```

### captureSermonDevelopmentTurn

Two-phase live capture: save Dan's complete turn as the first action, then replay it with Chat's exact planned reply before speaking.

Required: `sermonId`, `sessionId`, `transcript`

Optional: `turnId`, `speaker`, `sequence`, `sourceMode`, `checkpoints`, `assistantTranscript`, `assistantTurnId`, `danAuthorizedCut`, `danApprovalEvidence`

Argument guidance: Phase 1 must be the first action after every Dan turn: send Dan's complete transcript without assistantTranscript, before retrieval or reasoning. Phase 2: after other actions, replay the identical Dan transcript with the exact concise assistantTranscript, using a different idempotency key, then output storedAssistantTranscript verbatim. Omit sequence. Include checkpoints in phase 1 only. Explicit exact-wording approval preserves the preceding assistant wording verbatim; general requests such as 'save that movement' preserve its substantive material as shapeable and unplaced. Derived checkpoints never replace raw capture.

```json
{
  "operation": "captureSermonDevelopmentTurn",
  "arguments": {
    "sermonId": "sermon-id",
    "sessionId": "sermon-session-id",
    "speaker": "dan",
    "transcript": "This is the complete user turn without summarization.",
    "assistantTranscript": "This is the exact concise reply Chat will speak after capture succeeds.",
    "checkpoints": [
      {
        "checkpointType": "key_line",
        "heading": "Approved wording",
        "content": "Mercy gets the final word.",
        "exactWording": true
      }
    ]
  }
}
```

### finalizeSermonDevelopmentSession

Capture the exact closing Dan/Chat exchange, verify the complete Dan-turn count, close the session, and build its transcript source.

Required: `sessionId`, `expectedDanTurnCount`, `finalTranscript`, `assistantTranscript`

Optional: `finalTurnId`, `finalAssistantTurnId`, `finalSequence`, `finalCheckpoints`, `sourceMode`, `summary`, `summaryHeading`, `sourceLabel`, `sourceRefs`, `danAuthorizedCut`, `danApprovalEvidence`

Argument guidance: Use this directly in response to Dan's close request. Always send that exact current turn as finalTranscript and the exact planned closing receipt as assistantTranscript, even after a retry. expectedDanTurnCount includes the closing Dan turn. Report completionReceipt verbatim; a mismatch leaves the session open.

```json
{
  "operation": "finalizeSermonDevelopmentSession",
  "arguments": {
    "sessionId": "sermon-session-id",
    "expectedDanTurnCount": 12,
    "finalTranscript": "This is my complete final substantive turn, including the request to close.",
    "assistantTranscript": "The session is closed and verified. Here is the backend receipt.",
    "summary": "Session summary"
  }
}
```

### closeSermonDevelopmentSession

Close a non-live or legacy development session and optionally verify its expected Dan-turn count.

Required: `sessionId`

Optional: `expectedDanTurnCount`, `summary`, `summaryHeading`, `rawTranscript`, `sourceLabel`, `sourceRefs`

Argument guidance: For live voice/chat development use finalizeSermonDevelopmentSession. rawTranscript remains only for backward-compatible imports; do not reconstruct a live conversation at close.

```json
{
  "operation": "closeSermonDevelopmentSession",
  "arguments": {
    "sessionId": "sermon-session-id",
    "summary": "Session summary"
  }
}
```

### updateSermonOccasion

Update the schedule, venue, service, status, or notes for one preaching occasion.

Required: `occasionId`, `changes`

Optional: none

```json
{
  "operation": "updateSermonOccasion",
  "arguments": {
    "occasionId": "sermon-occasion-id",
    "changes": {
      "status": "preached"
    }
  }
}
```

### migrateLegacySermonOccasions

Preview or explicitly confirm migration of legacy sermon date and occasion text into structured preaching occasions.

Required: none

Optional: `sermonId`, `confirmed`, `limit`

```json
{
  "operation": "migrateLegacySermonOccasions",
  "arguments": {
    "confirmed": false,
    "limit": 100
  }
}
```

### updateSermon

Replace or correct canonical sermon fields and create a snapshot.

Required: `sermonId`, `changes`

Optional: `snapshotReason`, `extractScriptureNotes`

```json
{
  "operation": "updateSermon",
  "arguments": {
    "sermonId": "sermon-id",
    "changes": {
      "bigIdea": "Updated big idea"
    }
  }
}
```

### importScriptureNotes

Automatically preserve, classify, anchor, deduplicate, attribute, and import Logos or sermon Scripture notes from text or one attached DOCX/TXT file.

Required: none

Optional: `rawText`, `openaiFileIdRefs`, `sourceLabel`, `sourceType`, `importId`, `activeConfidenceThreshold`, `batchSize`, `concurrency`, `compact`, `force`

```json
{
  "operation": "importScriptureNotes",
  "arguments": {
    "sourceLabel": "Logos Bible Commentary export",
    "openaiFileIdRefs": [
      "attached-docx"
    ],
    "compact": true
  }
}
```

### extractScriptureNotesFromSermon

Automatically extract reusable verse-level commentary from a sermon and its non-private development checkpoints without creating duplicates.

Required: `sermonId`

Optional: `compact`, `force`

```json
{
  "operation": "extractScriptureNotesFromSermon",
  "arguments": {
    "sermonId": "sermon-id",
    "compact": true
  }
}
```

### updateScriptureNote

Correct or refine one personal Scripture note while returning its previous state.

Required: `scriptureNoteId`, `changes`

Optional: none

```json
{
  "operation": "updateScriptureNote",
  "arguments": {
    "scriptureNoteId": "scripture-note-id",
    "changes": {
      "reference": "Psalm 3:3"
    }
  }
}
```

### applySermonCanonicalRepair

Apply an explicitly confirmed, unchanged canonical repair proposal without overwriting existing sermon content.

Required: `sermonId`, `proposalId`, `baseUpdatedAt`, `proposedChanges`, `confirmed`

Optional: none

```json
{
  "operation": "applySermonCanonicalRepair",
  "arguments": {
    "sermonId": "sermon-id",
    "proposalId": "sermon-repair-id",
    "baseUpdatedAt": "2026-07-10T00:00:00.000Z",
    "proposedChanges": {
      "scriptureText": "John 8:31-36"
    },
    "confirmed": true
  }
}
```

### importSermonMaterial

Import old chats, notes, transcripts, Logos exports, or documents into a sermon hub.

Required: none

Optional: `sermonId`, `title`, `scriptureText`, `bigIdea`, `outline`, `notes`, `developmentNotes`, `importedSummary`, `importedMaterial`, `sourceType`, `sourceLabel`, `sourceRefs`, `occasions`, `updateMode`, `replaceExisting`, `status`, `seriesId`, `seriesTitle`, `seriesSlug`, `seriesNumber`, `tags`

```json
{
  "operation": "importSermonMaterial",
  "arguments": {
    "title": "Imported Sermon",
    "importedMaterial": "Saved material",
    "sourceType": "old_chat"
  }
}
```

### importSermonMaterialBatch

Import a batch of sermon material records.

Required: `items`

Optional: `defaults`, `rebuildChunks`, `embedChunks`, `stopOnError`

```json
{
  "operation": "importSermonMaterialBatch",
  "arguments": {
    "items": []
  }
}
```

### appendSermonContent

Append development material without replacing canonical sermon fields.

Required: `sermonId`, `appendType`, `content`

Optional: `heading`, `snapshotReason`, `sourceType`, `sourceLabel`, `sourceRefs`, `seriesId`, `seriesTitle`, `seriesSlug`, `seriesNumber`, `tags`

```json
{
  "operation": "appendSermonContent",
  "arguments": {
    "sermonId": "sermon-id",
    "appendType": "application",
    "content": "Application thought"
  }
}
```

### addSermonDevelopmentNote

Add a focused development note to a sermon.

Required: `sermonId`, `content`

Optional: `noteType`

```json
{
  "operation": "addSermonDevelopmentNote",
  "arguments": {
    "sermonId": "sermon-id",
    "content": "Illustration idea",
    "noteType": "illustration"
  }
}
```

### createSermonSource

Save a distinct source-material layer for a sermon.

Required: `sermonId`

Optional: `sourceType`, `sourceLabel`, `summary`, `material`, `sourceRefs`, `seriesId`, `seriesTitle`, `seriesSlug`, `seriesNumber`, `tags`

Argument guidance: Allowed sourceType values: old_chat, transcript, preached_transcript, cleaned_transcript, youtube_caption, vimeo_transcript, media_audio, pdf, doc, logos_export, study_notes, scripture_commentary, other. Use scripture_commentary when Personal Scripture Commentary materially shapes a sermon, and include the originating scriptureNoteId values in sourceRefs.

```json
{
  "operation": "createSermonSource",
  "arguments": {
    "sermonId": "sermon-id",
    "sourceType": "scripture_commentary",
    "material": "Commentary material used in this sermon.",
    "sourceRefs": [
      {
        "type": "personal_scripture_note",
        "scriptureNoteId": "scripture-note-id"
      }
    ]
  }
}
```

### createSermonMedia

Attach audio, video, or linked preached media to a sermon.

Required: `sermonId`

Optional: `mediaType`, `platform`, `url`, `externalId`, `title`, `label`, `recordedAt`, `startSeconds`, `endSeconds`, `notes`, `seriesId`, `seriesTitle`, `seriesSlug`, `seriesNumber`, `tags`

```json
{
  "operation": "createSermonMedia",
  "arguments": {
    "sermonId": "sermon-id",
    "mediaType": "video",
    "url": "https://example.com/video"
  }
}
```

### updateSermonMedia

Update an existing sermon media record.

Required: `mediaId`, `changes`

Optional: none

```json
{
  "operation": "updateSermonMedia",
  "arguments": {
    "mediaId": "media-id",
    "changes": {
      "transcriptStatus": "ready"
    }
  }
}
```

### createSermonMediaTranscriptSource

Save provided transcript text as a separate source layer for sermon media.

Required: `mediaId`, `transcriptText`

Optional: `transcriptKind`, `sourceLabel`, `summary`, `rebuildChunks`

```json
{
  "operation": "createSermonMediaTranscriptSource",
  "arguments": {
    "mediaId": "media-id",
    "transcriptText": "Transcript text",
    "rebuildChunks": true
  }
}
```

### startSermonTranscription

Import or select one sermon recording and queue durable raw/cleaned transcription.

Required: none

Optional: `sermonId`, `mediaId`, `occasionId`, `openaiFileIdRefs`, `url`, `filename`, `contentType`, `title`, `label`, `recordedAt`, `notes`, `prompt`, `cleanupInstructions`, `cleanTranscript`, `rebuildChunks`, `force`

Argument guidance: Provide either an existing mediaId or an exact sermonId plus one attached audio/video file or public URL. Use occasionId whenever the sermon has multiple preaching occasions. This queues background work and returns a jobId; poll getSermonTranscriptionJob instead of retrying the start command.

```json
{
  "operation": "startSermonTranscription",
  "arguments": {
    "sermonId": "sermon-id",
    "occasionId": "occasion-id",
    "openaiFileIdRefs": [
      {
        "name": "sermon.m4a",
        "download_link": "attached-file-url",
        "mime_type": "audio/mp4"
      }
    ],
    "cleanTranscript": true,
    "rebuildChunks": true
  }
}
```

### importUnmatchedSermonRecording

Import one attached or publicly linked recording into the unmatched inbox without guessing a sermon.

Required: none

Optional: `openaiFileIdRefs`, `url`, `filename`, `contentType`, `notes`

Argument guidance: Use for recordings whose sermon is unknown. Pass a ChatGPT attachment through top-level openaiFileIdRefs or provide one public Dropbox/file URL. The backend deduplicates by file checksum and parses date/time clues from the filename.

```json
{
  "operation": "importUnmatchedSermonRecording",
  "arguments": {
    "url": "https://www.dropbox.com/scl/fi/example/2026-07-12-1800.m4a?dl=0"
  }
}
```

### importUnmatchedSermonRecordings

Batch-import up to 50 public recording links into the unmatched inbox.

Required: `items`

Optional: `defaults`, `stopOnError`

Argument guidance: Each item should contain one public Dropbox or direct audio/video URL and may include filename, contentType, or notes. Duplicate audio is reported rather than stored twice.

```json
{
  "operation": "importUnmatchedSermonRecordings",
  "arguments": {
    "items": [
      {
        "url": "https://www.dropbox.com/scl/fi/example/2026-07-12-1800.m4a?dl=0"
      }
    ]
  }
}
```

### startUnmatchedSermonRecordingIdentification

Queue a staging-only transcript and identity analysis for an unmatched recording, then refresh likely sermon matches without attaching it.

Required: `inboxId`

Optional: `prompt`

Argument guidance: Use when filename/date clues cannot identify the recording. Poll getSermonTranscriptionJob with the returned jobId, then call getUnmatchedSermonRecording. This does not create sermon media or canonical sermon sources.

```json
{
  "operation": "startUnmatchedSermonRecordingIdentification",
  "arguments": {
    "inboxId": "sermon-recording-inbox-id"
  }
}
```

### createSermonFromUnmatchedRecording

Create a preached sermon hub and faithful archive notes from an identified recording when no existing sermon hub matches, then attach and finish transcript processing.

Required: `inboxId`, `confirmedNoMatch`

Optional: `transcribe`, `cleanTranscript`, `rebuildChunks`, `cleanupInstructions`, `notes`

Argument guidance: Use only after identification and a final archive search find no credible existing sermon. The raw transcript remains the source of truth; generated title, Scripture, big idea, outline, and notes are transcript-derived archive fields.

```json
{
  "operation": "createSermonFromUnmatchedRecording",
  "arguments": {
    "inboxId": "sermon-recording-inbox-id",
    "confirmedNoMatch": true,
    "cleanTranscript": true
  }
}
```

### confirmUnmatchedSermonRecordingMatch

Confirm an inbox recording's exact sermon and occasion, then queue durable transcription.

Required: `inboxId`, `sermonId`

Optional: `occasionId`, `title`, `label`, `recordedAt`, `notes`, `transcribe`, `cleanTranscript`, `rebuildChunks`, `prompt`, `cleanupInstructions`

Argument guidance: Never call until Dan confirms the proposed match or the filename/date/time evidence identifies one unambiguously. Use occasionId whenever available, especially for sermons preached more than once.

```json
{
  "operation": "confirmUnmatchedSermonRecordingMatch",
  "arguments": {
    "inboxId": "sermon-recording-inbox-id",
    "sermonId": "sermon-id",
    "occasionId": "occasion-id",
    "transcribe": true,
    "cleanTranscript": true
  }
}
```

### rebuildSermonChunks

Rebuild derived search chunks for one sermon.

Required: `sermonId`

Optional: none

```json
{
  "operation": "rebuildSermonChunks",
  "arguments": {
    "sermonId": "sermon-id"
  }
}
```

### embedSermonChunks

Embed pending sermon chunks for semantic retrieval.

Required: none

Optional: `sermonId`, `sourceKind`, `chunkType`, `limit`, `force`, `embeddingModel`, `taskType`

```json
{
  "operation": "embedSermonChunks",
  "arguments": {
    "sermonId": "sermon-id",
    "limit": 100
  }
}
```

### createPreachingAnalysis

Save preaching analysis and optionally apply durable profile observations.

Required: `sermonId`

Optional: `title`, `summary`, `strengths`, `improvements`, `deliveryNotes`, `structureNotes`, `applicationNotes`, `styleObservations`, `profileCandidates`, `applyProfileCandidates`, `sourceLabel`

```json
{
  "operation": "createPreachingAnalysis",
  "arguments": {
    "sermonId": "sermon-id",
    "summary": "Preaching analysis"
  }
}
```

### applySermonPostPreachingReflection

After confirmation, save a reviewed post-sermon analysis, exact live lines, Scripture notes, and optional profile observations from an unchanged proposal.

Required: `sermonId`, `proposalId`, `sourceFingerprint`, `transcriptSourceId`, `reflection`, `confirmed`

Optional: `manuscriptSourceId`, `profileId`, `saveLiveLanguage`, `saveScriptureNotes`, `applyProfileCandidates`, `rebuildChunks`

```json
{
  "operation": "applySermonPostPreachingReflection",
  "arguments": {
    "sermonId": "sermon-id",
    "proposalId": "sermon-reflection-proposal-id",
    "sourceFingerprint": "sha256-from-proposal",
    "transcriptSourceId": "source-transcript-id",
    "reflection": {
      "summary": "Reviewed reflection proposal"
    },
    "confirmed": true,
    "saveLiveLanguage": true,
    "saveScriptureNotes": true,
    "applyProfileCandidates": false
  }
}
```

### updatePreachingProfile

Update durable preaching style and development observations.

Required: `changes`

Optional: `profileId`

```json
{
  "operation": "updatePreachingProfile",
  "arguments": {
    "changes": {
      "pastoralTone": "Warm and direct"
    }
  }
}
```

### createSermonPresentationTemplate

Create a reusable editable 16:9 series presentation template.

Required: none

Optional: `name`, `templateId`, `seriesId`, `seriesTitle`, `seriesSlug`, `description`, `aspectRatio`, `theme`, `layouts`

```json
{
  "operation": "createSermonPresentationTemplate",
  "arguments": {
    "name": "Romans Series",
    "seriesTitle": "Romans"
  }
}
```

### updateSermonPresentationTemplate

Update or version a reusable presentation template.

Required: `templateId`, `changes`

Optional: none

```json
{
  "operation": "updateSermonPresentationTemplate",
  "arguments": {
    "templateId": "template-id",
    "changes": {
      "description": "Updated style"
    }
  }
}
```

### importSermonPresentationTemplate

Import one attached editable 16:9 PPTX as a new active series template version.

Required: `openaiFileIdRefs`

Optional: `templateId`, `newTemplateId`, `name`, `description`, `seriesId`, `seriesTitle`, `seriesSlug`, `createdFromPresentationId`

```json
{
  "operation": "importSermonPresentationTemplate",
  "arguments": {
    "seriesTitle": "Seasons of Life",
    "openaiFileIdRefs": [
      "attached-pptx"
    ]
  }
}
```

## Specialized Direct Actions

These workflows remain direct OpenAPI Actions because they include specialized voice launch, storage, download, transcription, or server-side manuscript orchestration:

- `createSermonWalkSession`
- `runSermonSlides`
- `createSermonManuscriptDraft`
- `transcribeSermonMedia`
- `createSermonMediaUploadUrl`
- `importSermonMediaFromUrl`

