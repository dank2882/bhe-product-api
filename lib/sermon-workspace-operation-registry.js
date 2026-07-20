const { createHash } = require("node:crypto");

const sermonWorkspace = require("./sermon-workspace-service");
const scriptureNotes = require("./scripture-note-service");
const preachingPackets = require("./sermon-preaching-packet-service");
const sermonTranscription = require("./sermon-transcription-job-service");
const recordingInbox = require("./sermon-recording-inbox-service");
const postPreachingReflection = require("./sermon-post-preaching-reflection-service");

const OPERATION_MODES = ["query", "artifact", "command"];

function defineOperation({
  name,
  mode,
  summary,
  required = [],
  optional = [],
  exampleArguments = {},
  argumentGuidance = "",
  handler
}) {
  return Object.freeze({
    name,
    mode,
    summary,
    required: Object.freeze([...required]),
    optional: Object.freeze([...optional]),
    exampleArguments: Object.freeze({ ...exampleArguments }),
    argumentGuidance,
    handler
  });
}

const SERMON_WORKSPACE_OPERATIONS = Object.freeze([
  defineOperation({
    name: "listSermons",
    mode: "query",
    summary: "Search or list compact sermon records with date, passage, occasion, series, and sort filters.",
    optional: ["query", "status", "seriesId", "seriesSlug", "seriesTitle", "tag", "folderId", "occasion", "venue", "service", "occasionStatus", "upcomingOnly", "scriptureText", "date", "dateFrom", "dateTo", "dateField", "preachedDate", "targetDate", "sort", "limit"],
    exampleArguments: { query: "Living Free", limit: 10 },
    handler: sermonWorkspace.listSermons
  }),
  defineOperation({
    name: "listSermonOccasions",
    mode: "query",
    summary: "List structured preaching occasions across sermons by date, time, venue, service, status, or upcoming schedule.",
    optional: ["sermonId", "status", "venue", "service", "query", "date", "dateFrom", "dateTo", "upcomingOnly", "sort", "limit"],
    exampleArguments: { upcomingOnly: true, limit: 10 },
    handler: sermonWorkspace.listSermonOccasions
  }),
  defineOperation({
    name: "resolveSermon",
    mode: "query",
    summary: "Resolve a sermon from title, date, passage, occasion, series, ID, or saved source evidence without guessing across ambiguous matches.",
    optional: ["sermonId", "query", "title", "scriptureText", "occasion", "folderId", "seriesId", "seriesSlug", "seriesTitle", "tag", "status", "date", "dateFrom", "dateTo", "dateField", "preachedDate", "targetDate", "includeSourceMatches", "limit"],
    exampleArguments: { title: "Living Free", date: "2025-10-12", includeSourceMatches: true },
    handler: sermonWorkspace.resolveSermon
  }),
  defineOperation({
    name: "reviewSermonSeriesProgression",
    mode: "query",
    summary: "Review ordered series coverage, repeated passages and themes, numbering gaps, the last completed sermon, and the likely next textual starting point.",
    optional: ["seriesId", "seriesSlug", "seriesTitle", "includeArchived", "limit"],
    exampleArguments: { seriesSlug: "james-living-our-faith", limit: 100 },
    handler: sermonWorkspace.reviewSermonSeriesProgression
  }),
  defineOperation({
    name: "reviewSermonMinistryArchive",
    mode: "query",
    summary: "Review a class, group, or event archive from canonical tags and retrieve sermon-text evidence before recommending a direction.",
    required: ["tag"],
    optional: ["excludeTags", "semanticQuery", "semanticLimit", "limit"],
    exampleArguments: {
      tag: "life-builders-class",
      excludeTags: ["life-builders-retreat"],
      semanticQuery: "Recurring burdens, applications, and underdeveloped directions for the Life Builders class",
      semanticLimit: 20,
      limit: 100
    },
    argumentGuidance: "Canonical sermon tags control membership. Conflicting legacy venue or occasion text is reported but never overrides the selected tag. Do not recommend a lesson direction unless recommendationReadiness.ready is true and cite the returned semanticEvidence.",
    handler: sermonWorkspace.reviewSermonMinistryArchive
  }),
  defineOperation({
    name: "auditSermonCompleteness",
    mode: "query",
    summary: "Audit a sermon hub for missing canonical fields and summarize saved source coverage without changing the sermon.",
    required: ["sermonId"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: sermonWorkspace.auditSermonCompleteness
  }),
  defineOperation({
    name: "evaluateSermonReadiness",
    mode: "query",
    summary: "Evaluate a sermon’s current development stage, deadline readiness, blockers, gaps, and prioritized next steps without changing it.",
    required: ["sermonId"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: sermonWorkspace.evaluateSermonReadiness
  }),
  defineOperation({
    name: "buildPreachingPreparationDashboard",
    mode: "query",
    summary: "Build one read-only Firestore-backed dashboard of upcoming preaching occasions, sermon readiness, placeholders, conflicts, and prioritized next actions.",
    optional: ["asOfDate", "dateFrom", "dateTo", "timeZone", "venue", "service", "limit"],
    exampleArguments: { limit: 12 },
    argumentGuidance: "For an unqualified sermon dashboard, send only limit: 12. Never add the current date or timeZone unless Dan requests a date or zone. Use asOfDate for all upcoming occasions on or after a date; use equal dateFrom and dateTo values for one exact day. The dispatcher reads the live authoritative Firestore data; never describe the dispatcher or workspace as an alternative to Firestore.",
    handler: sermonWorkspace.buildPreachingPreparationDashboard
  }),
  defineOperation({
    name: "listSermonDevelopmentSessions",
    mode: "query",
    summary: "List durable voice, walk, chat, study, or imported development sessions for a sermon.",
    optional: ["sermonId", "status", "mode", "limit"],
    exampleArguments: { sermonId: "sermon-id", limit: 10 },
    handler: sermonWorkspace.listSermonDevelopmentSessions
  }),
  defineOperation({
    name: "listSermonDevelopmentTurns",
    mode: "query",
    summary: "List the exact Dan or assistant turns durably captured during a sermon development session.",
    optional: ["sermonId", "sessionId", "speaker", "sort", "limit"],
    exampleArguments: { sessionId: "sermon-session-id", speaker: "dan", sort: "asc", limit: 500 },
    handler: sermonWorkspace.listSermonDevelopmentTurns
  }),
  defineOperation({
    name: "listSermonDevelopmentCheckpoints",
    mode: "query",
    summary: "List preserved insights, exact preaching lines, illustrations, applications, decisions, and questions.",
    optional: ["sermonId", "sessionId", "checkpointType", "materialStatus", "query", "sort", "limit"],
    exampleArguments: { sermonId: "sermon-id", limit: 25 },
    handler: sermonWorkspace.listSermonDevelopmentCheckpoints
  }),
  defineOperation({
    name: "getSermonMaterialInventory",
    mode: "query",
    summary: "Inventory every preserved sermon-development item by placed, unplaced, or intentionally-cut status, type, and placement target.",
    required: ["sermonId"],
    optional: ["materialStatus", "checkpointType", "limit"],
    exampleArguments: { sermonId: "sermon-id", materialStatus: "unplaced", limit: 100 },
    handler: sermonWorkspace.getSermonMaterialInventory
  }),
  defineOperation({
    name: "proposeSermonMaterialPlacement",
    mode: "query",
    summary: "Preview a complete batch of checkpoint placement or cut decisions and return a stale-safe plan hash without changing the sermon.",
    required: ["sermonId", "decisions"],
    optional: ["requireAllUnplaced"],
    exampleArguments: {
      sermonId: "sermon-id",
      requireAllUnplaced: true,
      decisions: [
        { checkpointId: "checkpoint-id", materialStatus: "placed", placementTarget: "Movement 2" }
      ]
    },
    handler: sermonWorkspace.proposeSermonMaterialPlacement
  }),
  defineOperation({
    name: "auditSermonDevelopmentPreservation",
    mode: "query",
    summary: "Audit whether development checkpoints are integrated and optionally find uncovered excerpts in a saved session transcript.",
    required: ["sermonId"],
    optional: ["sessionId", "sourceId"],
    exampleArguments: { sermonId: "sermon-id", sessionId: "sermon-session-id" },
    handler: sermonWorkspace.auditSermonDevelopmentPreservation
  }),
  defineOperation({
    name: "proposeSermonCanonicalRepair",
    mode: "query",
    summary: "Prepare a read-only, source-grounded proposal for missing scriptureText, bigIdea, or outline fields.",
    required: ["sermonId"],
    optional: ["fields"],
    exampleArguments: { sermonId: "sermon-id", fields: ["scriptureText", "bigIdea", "outline"] },
    handler: sermonWorkspace.proposeSermonCanonicalRepair
  }),
  defineOperation({
    name: "getSermon",
    mode: "query",
    summary: "Retrieve one complete sermon record.",
    required: ["sermonId"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: sermonWorkspace.getSermon
  }),
  defineOperation({
    name: "getSermonContext",
    mode: "query",
    summary: "Retrieve a sermon with its saved development context and optional source material.",
    required: ["sermonId"],
    optional: ["includeSourceMaterial", "includePreachingProfile", "sourceLimit", "snapshotLimit", "analysisLimit", "sessionLimit", "checkpointLimit", "profileId"],
    exampleArguments: { sermonId: "sermon-id", includeSourceMaterial: false },
    handler: sermonWorkspace.getSermonContext
  }),
  defineOperation({
    name: "getSermonArchiveStats",
    mode: "query",
    summary: "Return exact sermon archive, source, chunk, status, query, or Bible-book counts.",
    optional: ["query", "scriptureBook", "status", "sourceType"],
    exampleArguments: { scriptureBook: "Romans" },
    handler: sermonWorkspace.getSermonArchiveStats
  }),
  defineOperation({
    name: "listScriptureNotes",
    mode: "query",
    summary: "List or search Dan's automatically classified personal Scripture notes by reference, type, authorship, status, or text.",
    optional: ["reference", "query", "status", "noteType", "authorship", "limit"],
    exampleArguments: { reference: "James 2:14-26", status: "active", limit: 50 },
    handler: scriptureNotes.listScriptureNotes
  }),
  defineOperation({
    name: "getScriptureNote",
    mode: "query",
    summary: "Retrieve one complete personal Scripture note with provenance, attribution, warnings, and original wording.",
    required: ["scriptureNoteId"],
    exampleArguments: { scriptureNoteId: "scripture-note-id" },
    handler: scriptureNotes.getScriptureNote
  }),
  defineOperation({
    name: "getPersonalScriptureCommentary",
    mode: "query",
    summary: "Assemble Dan's active personal commentary notes for a verse or passage while preserving authorship and attribution labels.",
    required: ["reference"],
    optional: ["includeUnresolved", "limit"],
    exampleArguments: { reference: "Psalm 37:17", limit: 100 },
    handler: scriptureNotes.getPersonalScriptureCommentary
  }),
  defineOperation({
    name: "listScriptureNoteImports",
    mode: "query",
    summary: "List automatic Scripture-note imports with classification, duplicate, correction, and unresolved counts.",
    optional: ["status", "limit"],
    exampleArguments: { limit: 20 },
    handler: scriptureNotes.listScriptureNoteImports
  }),
  defineOperation({
    name: "listScriptureNoteImportSegments",
    mode: "query",
    summary: "Inspect compact classification results for every preserved block in a Scripture-note import.",
    optional: ["importId", "classification", "limit"],
    exampleArguments: { importId: "scripture-note-import-id", classification: "unresolved", limit: 100 },
    handler: scriptureNotes.listScriptureNoteImportSegments
  }),
  defineOperation({
    name: "listSermonSnapshots",
    mode: "query",
    summary: "List sermon change snapshots.",
    optional: ["sermonId", "limit"],
    exampleArguments: { sermonId: "sermon-id", limit: 10 },
    handler: sermonWorkspace.listSermonSnapshots
  }),
  defineOperation({
    name: "getSermonSnapshot",
    mode: "query",
    summary: "Retrieve one sermon snapshot.",
    required: ["snapshotId"],
    exampleArguments: { snapshotId: "snapshot-id" },
    handler: sermonWorkspace.getSermonSnapshot
  }),
  defineOperation({
    name: "listSermonSources",
    mode: "query",
    summary: "List saved sermon source records with optional filters.",
    optional: ["sermonId", "folderId", "seriesId", "seriesSlug", "tag", "sourceType", "query", "limit"],
    exampleArguments: { sermonId: "sermon-id", limit: 25 },
    handler: sermonWorkspace.listSermonSources
  }),
  defineOperation({
    name: "searchSermonSources",
    mode: "query",
    summary: "Search saved source records across the sermon archive.",
    required: ["query"],
    optional: ["sermonId", "seriesId", "seriesSlug", "tag", "sourceType", "limit"],
    exampleArguments: { query: "freedom in Christ", limit: 10 },
    handler: sermonWorkspace.listSermonSources
  }),
  defineOperation({
    name: "getSermonSource",
    mode: "query",
    summary: "Retrieve one full sermon source record.",
    required: ["sourceId"],
    exampleArguments: { sourceId: "source-id" },
    handler: sermonWorkspace.getSermonSource
  }),
  defineOperation({
    name: "listSermonMedia",
    mode: "query",
    summary: "List sermon audio, video, and linked media records.",
    optional: ["sermonId", "mediaType", "transcriptStatus", "query", "limit"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: sermonWorkspace.listSermonMedia
  }),
  defineOperation({
    name: "getSermonMedia",
    mode: "query",
    summary: "Retrieve one sermon media record.",
    required: ["mediaId"],
    exampleArguments: { mediaId: "media-id" },
    handler: sermonWorkspace.getSermonMedia
  }),
  defineOperation({
    name: "getSermonTranscriptionJob",
    mode: "query",
    summary: "Get durable background transcription status and source identifiers.",
    required: ["jobId"],
    exampleArguments: { jobId: "sermon-transcription-job-id" },
    handler: sermonTranscription.getSermonTranscriptionJob
  }),
  defineOperation({
    name: "listSermonTranscriptionJobs",
    mode: "query",
    summary: "List transcription jobs by sermon, media record, or status.",
    optional: ["sermonId", "mediaId", "status", "limit"],
    exampleArguments: { sermonId: "sermon-id", limit: 10 },
    handler: sermonTranscription.listSermonTranscriptionJobs
  }),
  defineOperation({
    name: "listUnmatchedSermonRecordings",
    mode: "query",
    summary: "List the unmatched recording inbox with parsed filename dates and top sermon candidates.",
    optional: ["status", "matchStatus", "query", "limit"],
    exampleArguments: { status: "unmatched", limit: 25 },
    handler: recordingInbox.listUnmatchedSermonRecordings
  }),
  defineOperation({
    name: "getUnmatchedSermonRecording",
    mode: "query",
    summary: "Retrieve one unmatched recording with all ranked sermon and occasion candidates.",
    required: ["inboxId"],
    optional: ["refreshMatches"],
    exampleArguments: { inboxId: "sermon-recording-inbox-id", refreshMatches: true },
    handler: recordingInbox.getUnmatchedSermonRecording
  }),
  defineOperation({
    name: "searchSermonChunks",
    mode: "query",
    summary: "Search indexed sermon chunks by exact words, phrases, or passages.",
    required: ["query"],
    optional: ["sermonId", "seriesId", "seriesSlug", "tag", "sourceKind", "chunkType", "limit"],
    exampleArguments: { query: "no condemnation", limit: 10 },
    handler: sermonWorkspace.searchSermonChunks
  }),
  defineOperation({
    name: "semanticSearchSermonChunks",
    mode: "query",
    summary: "Search embedded sermon chunks by meaning or pastoral concept.",
    required: ["query"],
    optional: ["sermonId", "seriesId", "seriesSlug", "tag", "sourceKind", "chunkType", "limit", "distanceMeasure", "embeddingModel"],
    exampleArguments: { query: "assurance for a guilty conscience", limit: 10 },
    handler: sermonWorkspace.semanticSearchSermonChunks
  }),
  defineOperation({
    name: "answerSermonQuestion",
    mode: "query",
    summary: "Answer a question from retrieved sermon knowledge with citations.",
    required: ["question"],
    optional: ["sermonId", "sourceKind", "chunkType", "limit", "answerStyle", "distanceMeasure", "embeddingModel"],
    exampleArguments: { question: "What have I preached about freedom in Christ?" },
    handler: sermonWorkspace.answerSermonQuestion
  }),
  defineOperation({
    name: "getPreachingProfile",
    mode: "query",
    summary: "Retrieve the durable preaching style profile.",
    optional: ["profileId"],
    exampleArguments: {},
    handler: sermonWorkspace.getPreachingProfile
  }),
  defineOperation({
    name: "listPreachingAnalyses",
    mode: "query",
    summary: "List preaching analyses for a sermon or the archive.",
    optional: ["sermonId", "limit"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: sermonWorkspace.listPreachingAnalyses
  }),
  defineOperation({
    name: "getSermonPostPreachingReflectionReadiness",
    mode: "query",
    summary: "Check whether a sermon has a planned baseline and preached transcript ready for evidence-grounded post-sermon reflection.",
    required: ["sermonId"],
    optional: ["manuscriptSourceId", "transcriptSourceId", "profileId"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: postPreachingReflection.getSermonPostPreachingReflectionReadiness
  }),
  defineOperation({
    name: "proposeSermonPostPreachingReflection",
    mode: "query",
    summary: "Compare the planned sermon with its preached transcript and return a read-only, evidence-grounded reflection proposal.",
    required: ["sermonId"],
    optional: ["manuscriptSourceId", "transcriptSourceId", "profileId"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: postPreachingReflection.proposeSermonPostPreachingReflection
  }),
  defineOperation({
    name: "listSermonPresentationTemplates",
    mode: "query",
    summary: "List reusable series PowerPoint templates.",
    optional: ["seriesId", "seriesSlug", "status", "query", "limit"],
    exampleArguments: { seriesSlug: "life-in-the-spirit" },
    handler: sermonWorkspace.listSermonPresentationTemplates
  }),
  defineOperation({
    name: "getSermonPresentationTemplate",
    mode: "query",
    summary: "Retrieve one reusable PowerPoint template.",
    required: ["templateId"],
    exampleArguments: { templateId: "template-id" },
    handler: sermonWorkspace.getSermonPresentationTemplate
  }),
  defineOperation({
    name: "listSermonPresentations",
    mode: "query",
    summary: "List generated sermon PowerPoint decks.",
    optional: ["sermonId", "seriesId", "seriesSlug", "templateId", "status", "query", "limit"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: sermonWorkspace.listSermonPresentations
  }),
  defineOperation({
    name: "getSermonPresentation",
    mode: "query",
    summary: "Retrieve one generated PowerPoint record and download details.",
    required: ["presentationId"],
    exampleArguments: { presentationId: "presentation-id" },
    handler: sermonWorkspace.getSermonPresentation
  }),
  defineOperation({
    name: "listSermonPreachingPackets",
    mode: "query",
    summary: "List previously generated unified preaching packets for one sermon or the archive.",
    optional: ["sermonId", "limit"],
    exampleArguments: { sermonId: "sermon-id", limit: 10 },
    handler: preachingPackets.listSermonPreachingPackets
  }),
  defineOperation({
    name: "getSermonPreachingPacket",
    mode: "query",
    summary: "Retrieve one preaching packet record and its download details.",
    required: ["packetId"],
    exampleArguments: { packetId: "preaching-packet-id" },
    handler: preachingPackets.getSermonPreachingPacket
  }),
  defineOperation({
    name: "createSermonPresentation",
    mode: "artifact",
    summary: "Create an editable 16:9 PPTX and reuse the sermon series template.",
    required: ["sermonId"],
    optional: ["title", "templateId", "theme", "slidePlan", "slides", "compact"],
    exampleArguments: { sermonId: "sermon-id", compact: true },
    handler: sermonWorkspace.createSermonPresentation
  }),
  defineOperation({
    name: "createSermonPresentationFromLookup",
    mode: "artifact",
    summary: "Resolve a sermon by title, date, passage, occasion, series, or ID and create its editable 16:9 PPTX in one backend operation.",
    optional: ["sermonId", "query", "title", "sermonTitle", "scriptureText", "occasion", "folderId", "seriesId", "seriesSlug", "seriesTitle", "tag", "status", "date", "dateFrom", "dateTo", "dateField", "preachedDate", "targetDate", "includeSourceMatches", "limit", "presentationTitle", "templateId", "theme", "slidePlan", "slides", "compact"],
    exampleArguments: { title: "Living Free", date: "2025-10-12", dateField: "preachedDate", compact: true },
    handler: sermonWorkspace.createSermonPresentationFromLookup
  }),
  defineOperation({
    name: "createSermonPreachingPacket",
    mode: "artifact",
    summary: "Package the accepted primary manuscript, editable 16:9 PowerPoint, portable manuscript text, sermon metadata, and source provenance into one downloadable ZIP.",
    required: ["sermonId"],
    optional: ["manuscriptSourceId", "presentationId", "regenerateSlides", "presentationTitle", "templateId", "compact"],
    exampleArguments: { sermonId: "sermon-id", compact: true },
    argumentGuidance: "Requires an accepted primary manuscript. Call the specialized createSermonManuscriptDraft Action first when primaryManuscriptSourceId is empty. Reuses the latest rendered presentation unless regenerateSlides is true.",
    handler: preachingPackets.createSermonPreachingPacket
  }),
  defineOperation({
    name: "createSermon",
    mode: "command",
    summary: "Create a durable sermon hub.",
    required: ["title"],
    optional: ["status", "scriptureText", "bigIdea", "notes", "outline", "targetDate", "preachedDate", "occasion", "seriesId", "seriesTitle", "seriesSlug", "seriesNumber", "tags", "sourceRefs"],
    exampleArguments: { title: "New Sermon", status: "idea" },
    handler: sermonWorkspace.createSermon
  }),
  defineOperation({
    name: "createSermonOccasion",
    mode: "command",
    summary: "Add one scheduled or completed preaching occasion to a sermon hub.",
    required: ["sermonId", "date"],
    optional: ["time", "timeZone", "scheduledAt", "venue", "service", "status", "notes", "sourceRefs", "mediaIds"],
    exampleArguments: {
      sermonId: "sermon-id",
      date: "2026-07-12",
      time: "19:00",
      timeZone: "America/Los_Angeles",
      venue: "Faith Baptist Church",
      service: "Sunday Evening Service",
      status: "planned"
    },
    handler: sermonWorkspace.createSermonOccasion
  }),
  defineOperation({
    name: "selectSermonForOccasion",
    mode: "command",
    summary: "Promote an empty scheduled placeholder into the selected sermon or safely assign its occasion to an existing sermon hub.",
    required: ["occasionId", "confirmed"],
    optional: ["expectedCurrentSermonId", "targetSermonId", "title", "status", "scriptureText", "bigIdea", "notes", "outline", "seriesId", "seriesTitle", "seriesSlug", "seriesNumber", "tags", "sourceRefs", "changes"],
    exampleArguments: {
      occasionId: "sermon-occasion-id",
      expectedCurrentSermonId: "sermon-sunday-night-placeholder",
      title: "Living Faith",
      status: "developing",
      scriptureText: "James 2:14-26",
      seriesId: "series-james-living-our-faith",
      seriesTitle: "James - Living Our Faith",
      seriesSlug: "james-living-our-faith",
      seriesNumber: 12,
      confirmed: true
    },
    handler: sermonWorkspace.selectSermonForOccasion
  }),
  defineOperation({
    name: "startSermonDevelopmentSession",
    mode: "command",
    summary: "Start a durable sermon development session and capture the initiating Dan/Chat exchange before speaking.",
    required: ["sermonId", "initialTranscript", "assistantTranscript"],
    optional: ["sessionId", "mode", "label", "context"],
    exampleArguments: {
      sermonId: "sermon-id",
      mode: "walk",
      label: "Friday evening walk",
      initialTranscript: "Let's begin developing Sunday's sermon.",
      assistantTranscript: "Tracked session started for {{sermonTitle}}. Session ID: {{sessionId}}"
    },
    argumentGuidance: "Send Dan's complete initiating turn and the exact planned reply. Use {{sermonTitle}} and {{sessionId}} placeholders; output storedAssistantTranscript verbatim after success.",
    handler: (input, deps) => sermonWorkspace.startSermonDevelopmentSession({
      ...input,
      mode: ["voice", "chat", "walk", "study"].includes(input.mode) ? input.mode : "chat",
      requireInitialExchange: true
    }, deps)
  }),
  defineOperation({
    name: "saveSermonDevelopmentCheckpoint",
    mode: "command",
    summary: "Preserve one or more typed sermon-development checkpoints without compressing exact wording into a general summary.",
    required: ["sermonId"],
    optional: ["sessionId", "checkpointType", "heading", "content", "context", "exactWording", "canonicalTargets", "materialStatus", "placementTarget", "placementNotes", "cutReason", "sourceRefs", "checkpoints", "danAuthorizedCut", "danApprovalEvidence"],
    exampleArguments: {
      sermonId: "sermon-id",
      sessionId: "sermon-session-id",
      checkpoints: [
        { checkpointType: "verbatim", heading: "Preach this", content: "Mercy gets the final word." }
      ]
    },
    handler: sermonWorkspace.saveSermonDevelopmentCheckpoint
  }),
  defineOperation({
    name: "updateSermonDevelopmentCheckpointPlacement",
    mode: "command",
    summary: "Move one preserved sermon-development item to unplaced, placed, or intentionally-cut without deleting it.",
    required: ["checkpointId", "materialStatus"],
    optional: ["placementTarget", "placementNotes", "cutReason", "canonicalTargets", "danAuthorizedCut", "danApprovalEvidence"],
    exampleArguments: {
      checkpointId: "sermon-checkpoint-id",
      materialStatus: "placed",
      placementTarget: "Movement 2 - Grace sustains us"
    },
    handler: sermonWorkspace.updateSermonDevelopmentCheckpointPlacement
  }),
  defineOperation({
    name: "applySermonMaterialPlacementPlan",
    mode: "command",
    summary: "Apply one previously reviewed material-placement plan only when its plan hash is current and confirmation is explicit.",
    required: ["sermonId", "decisions", "expectedPlanHash", "confirmed"],
    optional: ["requireAllUnplaced", "danAuthorizedCuts", "danApprovalEvidence"],
    exampleArguments: {
      sermonId: "sermon-id",
      decisions: [
        { checkpointId: "checkpoint-id", materialStatus: "placed", placementTarget: "Movement 2" }
      ],
      expectedPlanHash: "sha256-from-proposal",
      confirmed: true
    },
    handler: sermonWorkspace.applySermonMaterialPlacementPlan
  }),
  defineOperation({
    name: "captureSermonDevelopmentTurn",
    mode: "command",
    summary: "Two-phase live capture: save Dan's complete turn as the first action, then replay it with Chat's exact planned reply before speaking.",
    required: ["sermonId", "sessionId", "transcript"],
    optional: ["turnId", "speaker", "sequence", "sourceMode", "checkpoints", "assistantTranscript", "assistantTurnId", "danAuthorizedCut", "danApprovalEvidence"],
    exampleArguments: {
      sermonId: "sermon-id",
      sessionId: "sermon-session-id",
      speaker: "dan",
      transcript: "This is the complete user turn without summarization.",
      assistantTranscript: "This is the exact concise reply Chat will speak after capture succeeds.",
      checkpoints: [
        { checkpointType: "key_line", heading: "Approved wording", content: "Mercy gets the final word.", exactWording: true }
      ]
    },
    argumentGuidance: "Phase 1 must be the first action after every Dan turn: send Dan's complete transcript without assistantTranscript, before retrieval or reasoning. Phase 2: after other actions, replay the identical Dan transcript with the exact concise assistantTranscript, using a different idempotency key, then output storedAssistantTranscript verbatim. Omit sequence. Include checkpoints in phase 1 only. Explicit exact-wording approval preserves the preceding assistant wording verbatim; general requests such as 'save that movement' preserve its substantive material as shapeable and unplaced. Derived checkpoints never replace raw capture.",
    handler: sermonWorkspace.captureSermonDevelopmentTurn
  }),
  defineOperation({
    name: "finalizeSermonDevelopmentSession",
    mode: "command",
    summary: "Capture the exact closing Dan/Chat exchange, verify the complete Dan-turn count, close the session, and build its transcript source.",
    required: ["sessionId", "expectedDanTurnCount", "finalTranscript", "assistantTranscript"],
    optional: ["finalTurnId", "finalAssistantTurnId", "finalSequence", "finalCheckpoints", "sourceMode", "summary", "summaryHeading", "sourceLabel", "sourceRefs", "danAuthorizedCut", "danApprovalEvidence"],
    exampleArguments: {
      sessionId: "sermon-session-id",
      expectedDanTurnCount: 12,
      finalTranscript: "This is my complete final substantive turn, including the request to close.",
      assistantTranscript: "The session is closed and verified. Here is the backend receipt.",
      summary: "Session summary"
    },
    argumentGuidance: "Use this directly in response to Dan's close request. Always send that exact current turn as finalTranscript and the exact planned closing receipt as assistantTranscript, even after a retry. expectedDanTurnCount includes the closing Dan turn. Report completionReceipt verbatim; a mismatch leaves the session open.",
    handler: sermonWorkspace.finalizeSermonDevelopmentSession
  }),
  defineOperation({
    name: "closeSermonDevelopmentSession",
    mode: "command",
    summary: "Close a non-live or legacy development session and optionally verify its expected Dan-turn count.",
    required: ["sessionId"],
    optional: ["expectedDanTurnCount", "summary", "summaryHeading", "rawTranscript", "sourceLabel", "sourceRefs"],
    exampleArguments: { sessionId: "sermon-session-id", summary: "Session summary" },
    argumentGuidance: "For live voice/chat development use finalizeSermonDevelopmentSession. rawTranscript remains only for backward-compatible imports; do not reconstruct a live conversation at close.",
    handler: (input, deps) => sermonWorkspace.closeSermonDevelopmentSession({
      ...input,
      requireNonLiveSession: true
    }, deps)
  }),
  defineOperation({
    name: "updateSermonOccasion",
    mode: "command",
    summary: "Update the schedule, venue, service, status, or notes for one preaching occasion.",
    required: ["occasionId", "changes"],
    exampleArguments: { occasionId: "sermon-occasion-id", changes: { status: "preached" } },
    handler: sermonWorkspace.updateSermonOccasion
  }),
  defineOperation({
    name: "migrateLegacySermonOccasions",
    mode: "command",
    summary: "Preview or explicitly confirm migration of legacy sermon date and occasion text into structured preaching occasions.",
    optional: ["sermonId", "confirmed", "limit"],
    exampleArguments: { confirmed: false, limit: 100 },
    handler: sermonWorkspace.migrateLegacySermonOccasions
  }),
  defineOperation({
    name: "updateSermon",
    mode: "command",
    summary: "Replace or correct canonical sermon fields and create a snapshot.",
    required: ["sermonId", "changes"],
    optional: ["snapshotReason", "extractScriptureNotes"],
    exampleArguments: { sermonId: "sermon-id", changes: { bigIdea: "Updated big idea" } },
    handler: sermonWorkspace.updateSermon
  }),
  defineOperation({
    name: "importScriptureNotes",
    mode: "command",
    summary: "Automatically preserve, classify, anchor, deduplicate, attribute, and import Logos or sermon Scripture notes from text or one attached DOCX/TXT file.",
    optional: ["rawText", "openaiFileIdRefs", "sourceLabel", "sourceType", "importId", "activeConfidenceThreshold", "batchSize", "concurrency", "compact", "force"],
    exampleArguments: { sourceLabel: "Logos Bible Commentary export", openaiFileIdRefs: ["attached-docx"], compact: true },
    handler: scriptureNotes.importScriptureNotes
  }),
  defineOperation({
    name: "extractScriptureNotesFromSermon",
    mode: "command",
    summary: "Automatically extract reusable verse-level commentary from a sermon and its non-private development checkpoints without creating duplicates.",
    required: ["sermonId"],
    optional: ["compact", "force"],
    exampleArguments: { sermonId: "sermon-id", compact: true },
    handler: scriptureNotes.extractScriptureNotesFromSermon
  }),
  defineOperation({
    name: "updateScriptureNote",
    mode: "command",
    summary: "Correct or refine one personal Scripture note while returning its previous state.",
    required: ["scriptureNoteId", "changes"],
    exampleArguments: { scriptureNoteId: "scripture-note-id", changes: { reference: "Psalm 3:3" } },
    handler: scriptureNotes.updateScriptureNote
  }),
  defineOperation({
    name: "applySermonCanonicalRepair",
    mode: "command",
    summary: "Apply an explicitly confirmed, unchanged canonical repair proposal without overwriting existing sermon content.",
    required: ["sermonId", "proposalId", "baseUpdatedAt", "proposedChanges", "confirmed"],
    exampleArguments: {
      sermonId: "sermon-id",
      proposalId: "sermon-repair-id",
      baseUpdatedAt: "2026-07-10T00:00:00.000Z",
      proposedChanges: { scriptureText: "John 8:31-36" },
      confirmed: true
    },
    handler: sermonWorkspace.applySermonCanonicalRepair
  }),
  defineOperation({
    name: "importSermonMaterial",
    mode: "command",
    summary: "Import old chats, notes, transcripts, Logos exports, or documents into a sermon hub.",
    optional: ["sermonId", "title", "scriptureText", "bigIdea", "outline", "notes", "developmentNotes", "importedSummary", "importedMaterial", "sourceType", "sourceLabel", "sourceRefs", "occasions", "updateMode", "replaceExisting", "status", "targetDate", "preachedDate", "occasion", "snapshotReason", "seriesId", "seriesTitle", "seriesSlug", "seriesNumber", "tags"],
    exampleArguments: { title: "Imported Sermon", importedMaterial: "Saved material", sourceType: "old_chat" },
    handler: sermonWorkspace.importSermonMaterial
  }),
  defineOperation({
    name: "importSermonMaterialBatch",
    mode: "command",
    summary: "Import a batch of sermon material records.",
    required: ["items"],
    optional: ["defaults", "rebuildChunks", "embedChunks", "stopOnError"],
    exampleArguments: { items: [] },
    handler: sermonWorkspace.importSermonMaterialBatch
  }),
  defineOperation({
    name: "appendSermonContent",
    mode: "command",
    summary: "Append development material without replacing canonical sermon fields.",
    required: ["sermonId", "appendType", "content"],
    optional: ["heading", "snapshotReason", "sourceType", "sourceLabel", "sourceRefs", "seriesId", "seriesTitle", "seriesSlug", "seriesNumber", "tags"],
    exampleArguments: { sermonId: "sermon-id", appendType: "application", content: "Application thought" },
    handler: sermonWorkspace.appendSermonContent
  }),
  defineOperation({
    name: "addSermonDevelopmentNote",
    mode: "command",
    summary: "Add a focused development note to a sermon.",
    required: ["sermonId", "content"],
    optional: ["noteType"],
    exampleArguments: { sermonId: "sermon-id", content: "Illustration idea", noteType: "illustration" },
    handler: sermonWorkspace.addSermonDevelopmentNote
  }),
  defineOperation({
    name: "createSermonSource",
    mode: "command",
    summary: "Save a distinct source-material layer for a sermon.",
    required: ["sermonId"],
    optional: ["sourceType", "sourceLabel", "summary", "material", "sourceRefs", "seriesId", "seriesTitle", "seriesSlug", "seriesNumber", "tags"],
    exampleArguments: {
      sermonId: "sermon-id",
      sourceType: "scripture_commentary",
      material: "Commentary material used in this sermon.",
      sourceRefs: [{ type: "personal_scripture_note", scriptureNoteId: "scripture-note-id" }]
    },
    argumentGuidance: "Allowed sourceType values: old_chat, transcript, preached_transcript, cleaned_transcript, youtube_caption, vimeo_transcript, media_audio, pdf, doc, logos_export, study_notes, scripture_commentary, other. Use scripture_commentary when Personal Scripture Commentary materially shapes a sermon, and include the originating scriptureNoteId values in sourceRefs.",
    handler: sermonWorkspace.createSermonSource
  }),
  defineOperation({
    name: "createSermonMedia",
    mode: "command",
    summary: "Attach audio, video, or linked preached media to a sermon.",
    required: ["sermonId"],
    optional: ["mediaType", "platform", "url", "externalId", "title", "label", "recordedAt", "startSeconds", "endSeconds", "notes", "seriesId", "seriesTitle", "seriesSlug", "seriesNumber", "tags"],
    exampleArguments: { sermonId: "sermon-id", mediaType: "video", url: "https://example.com/video" },
    handler: sermonWorkspace.createSermonMedia
  }),
  defineOperation({
    name: "updateSermonMedia",
    mode: "command",
    summary: "Update an existing sermon media record.",
    required: ["mediaId", "changes"],
    exampleArguments: { mediaId: "media-id", changes: { transcriptStatus: "ready" } },
    handler: sermonWorkspace.updateSermonMedia
  }),
  defineOperation({
    name: "createSermonMediaTranscriptSource",
    mode: "command",
    summary: "Save provided transcript text as a separate source layer for sermon media.",
    required: ["mediaId", "transcriptText"],
    optional: ["transcriptKind", "sourceLabel", "summary", "rebuildChunks"],
    exampleArguments: { mediaId: "media-id", transcriptText: "Transcript text", rebuildChunks: true },
    handler: sermonWorkspace.createSermonMediaTranscriptSource
  }),
  defineOperation({
    name: "startSermonTranscription",
    mode: "command",
    summary: "Import or select one sermon recording and queue durable raw/cleaned transcription.",
    optional: ["sermonId", "mediaId", "occasionId", "openaiFileIdRefs", "url", "filename", "contentType", "title", "label", "recordedAt", "notes", "prompt", "cleanupInstructions", "cleanTranscript", "rebuildChunks", "force"],
    exampleArguments: {
      sermonId: "sermon-id",
      occasionId: "occasion-id",
      openaiFileIdRefs: [{ name: "sermon.m4a", download_link: "attached-file-url", mime_type: "audio/mp4" }],
      cleanTranscript: true,
      rebuildChunks: true
    },
    argumentGuidance: "Provide either an existing mediaId or an exact sermonId plus one attached audio/video file or public URL. Use occasionId whenever the sermon has multiple preaching occasions. This queues background work and returns a jobId; poll getSermonTranscriptionJob instead of retrying the start command.",
    handler: sermonTranscription.startSermonTranscription
  }),
  defineOperation({
    name: "importUnmatchedSermonRecording",
    mode: "command",
    summary: "Import one attached or publicly linked recording into the unmatched inbox without guessing a sermon.",
    optional: ["openaiFileIdRefs", "url", "filename", "contentType", "notes"],
    exampleArguments: { url: "https://www.dropbox.com/scl/fi/example/2026-07-12-1800.m4a?dl=0" },
    argumentGuidance: "Use for recordings whose sermon is unknown. Pass a ChatGPT attachment through top-level openaiFileIdRefs or provide one public Dropbox/file URL. The backend deduplicates by file checksum and parses date/time clues from the filename.",
    handler: recordingInbox.importUnmatchedSermonRecording
  }),
  defineOperation({
    name: "importUnmatchedSermonRecordings",
    mode: "command",
    summary: "Batch-import up to 50 public recording links into the unmatched inbox.",
    required: ["items"],
    optional: ["defaults", "stopOnError"],
    exampleArguments: { items: [{ url: "https://www.dropbox.com/scl/fi/example/2026-07-12-1800.m4a?dl=0" }] },
    argumentGuidance: "Each item should contain one public Dropbox or direct audio/video URL and may include filename, contentType, or notes. Duplicate audio is reported rather than stored twice.",
    handler: recordingInbox.importUnmatchedSermonRecordings
  }),
  defineOperation({
    name: "startUnmatchedSermonRecordingIdentification",
    mode: "command",
    summary: "Queue a staging-only transcript and identity analysis for an unmatched recording, then refresh likely sermon matches without attaching it.",
    required: ["inboxId"],
    optional: ["prompt"],
    exampleArguments: { inboxId: "sermon-recording-inbox-id" },
    argumentGuidance: "Use when filename/date clues cannot identify the recording. Poll getSermonTranscriptionJob with the returned jobId, then call getUnmatchedSermonRecording. This does not create sermon media or canonical sermon sources.",
    handler: recordingInbox.startUnmatchedSermonRecordingIdentification
  }),
  defineOperation({
    name: "createSermonFromUnmatchedRecording",
    mode: "command",
    summary: "Create a preached sermon hub and faithful archive notes from an identified recording when no existing sermon hub matches, then attach and finish transcript processing.",
    required: ["inboxId", "confirmedNoMatch"],
    optional: ["transcribe", "cleanTranscript", "rebuildChunks", "cleanupInstructions", "notes"],
    exampleArguments: { inboxId: "sermon-recording-inbox-id", confirmedNoMatch: true, cleanTranscript: true },
    argumentGuidance: "Use only after identification and a final archive search find no credible existing sermon. The raw transcript remains the source of truth; generated title, Scripture, big idea, outline, and notes are transcript-derived archive fields.",
    handler: recordingInbox.createSermonFromUnmatchedRecording
  }),
  defineOperation({
    name: "confirmUnmatchedSermonRecordingMatch",
    mode: "command",
    summary: "Confirm an inbox recording's exact sermon and occasion, then queue durable transcription.",
    required: ["inboxId", "sermonId"],
    optional: ["occasionId", "title", "label", "recordedAt", "notes", "transcribe", "cleanTranscript", "rebuildChunks", "prompt", "cleanupInstructions"],
    exampleArguments: {
      inboxId: "sermon-recording-inbox-id",
      sermonId: "sermon-id",
      occasionId: "occasion-id",
      transcribe: true,
      cleanTranscript: true
    },
    argumentGuidance: "Never call until Dan confirms the proposed match or the filename/date/time evidence identifies one unambiguously. Use occasionId whenever available, especially for sermons preached more than once.",
    handler: recordingInbox.confirmUnmatchedSermonRecordingMatch
  }),
  defineOperation({
    name: "rebuildSermonChunks",
    mode: "command",
    summary: "Rebuild derived search chunks for one sermon.",
    required: ["sermonId"],
    exampleArguments: { sermonId: "sermon-id" },
    handler: sermonWorkspace.rebuildSermonChunks
  }),
  defineOperation({
    name: "embedSermonChunks",
    mode: "command",
    summary: "Embed pending sermon chunks for semantic retrieval.",
    optional: ["sermonId", "sourceKind", "chunkType", "limit", "force", "embeddingModel", "taskType"],
    exampleArguments: { sermonId: "sermon-id", limit: 100 },
    handler: sermonWorkspace.embedSermonChunks
  }),
  defineOperation({
    name: "createPreachingAnalysis",
    mode: "command",
    summary: "Save preaching analysis and optionally apply durable profile observations.",
    required: ["sermonId"],
    optional: ["title", "summary", "strengths", "improvements", "deliveryNotes", "structureNotes", "applicationNotes", "styleObservations", "profileCandidates", "applyProfileCandidates", "sourceLabel"],
    exampleArguments: { sermonId: "sermon-id", summary: "Preaching analysis" },
    handler: sermonWorkspace.createPreachingAnalysis
  }),
  defineOperation({
    name: "applySermonPostPreachingReflection",
    mode: "command",
    summary: "After confirmation, save a reviewed post-sermon analysis, exact live lines, Scripture notes, and optional profile observations from an unchanged proposal.",
    required: ["sermonId", "proposalId", "sourceFingerprint", "transcriptSourceId", "reflection", "confirmed"],
    optional: ["manuscriptSourceId", "profileId", "saveLiveLanguage", "saveScriptureNotes", "applyProfileCandidates", "rebuildChunks"],
    exampleArguments: {
      sermonId: "sermon-id",
      proposalId: "sermon-reflection-proposal-id",
      sourceFingerprint: "sha256-from-proposal",
      transcriptSourceId: "source-transcript-id",
      reflection: { summary: "Reviewed reflection proposal" },
      confirmed: true,
      saveLiveLanguage: true,
      saveScriptureNotes: true,
      applyProfileCandidates: false
    },
    handler: postPreachingReflection.applySermonPostPreachingReflection
  }),
  defineOperation({
    name: "updatePreachingProfile",
    mode: "command",
    summary: "Update durable preaching style and development observations.",
    required: ["changes"],
    optional: ["profileId"],
    exampleArguments: { changes: { pastoralTone: "Warm and direct" } },
    handler: sermonWorkspace.updatePreachingProfile
  }),
  defineOperation({
    name: "createSermonPresentationTemplate",
    mode: "command",
    summary: "Create a reusable editable 16:9 series presentation template.",
    optional: ["name", "templateId", "seriesId", "seriesTitle", "seriesSlug", "description", "aspectRatio", "theme", "layouts"],
    exampleArguments: { name: "Romans Series", seriesTitle: "Romans" },
    handler: sermonWorkspace.createSermonPresentationTemplate
  }),
  defineOperation({
    name: "updateSermonPresentationTemplate",
    mode: "command",
    summary: "Update or version a reusable presentation template.",
    required: ["templateId", "changes"],
    exampleArguments: { templateId: "template-id", changes: { description: "Updated style" } },
    handler: sermonWorkspace.updateSermonPresentationTemplate
  }),
  defineOperation({
    name: "importSermonPresentationTemplate",
    mode: "command",
    summary: "Import one attached editable 16:9 PPTX as a new active series template version.",
    required: ["openaiFileIdRefs"],
    optional: ["templateId", "newTemplateId", "name", "description", "seriesId", "seriesTitle", "seriesSlug", "createdFromPresentationId"],
    exampleArguments: { seriesTitle: "Seasons of Life", openaiFileIdRefs: ["attached-pptx"] },
    handler: sermonWorkspace.importSermonPresentationTemplate
  })
]);

const OPERATION_BY_NAME = new Map(
  SERMON_WORKSPACE_OPERATIONS.map((operation) => [operation.name, operation])
);

function createRegistryError(message, statusCode, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeMode(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOperationName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArguments(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw createRegistryError(
      "Operation arguments must be an object",
      400,
      "invalid_operation_arguments"
    );
  }
  return value;
}

function buildCatalogEntry(operation) {
  return {
    operation: operation.name,
    mode: operation.mode,
    summary: operation.summary,
    required: [...operation.required],
    optional: [...operation.optional],
    exampleArguments: { ...operation.exampleArguments },
    argumentGuidance: operation.argumentGuidance || ""
  };
}

const CATALOG_HASH = createHash("sha256")
  .update(JSON.stringify(SERMON_WORKSPACE_OPERATIONS.map(buildCatalogEntry)))
  .digest("hex");
const CATALOG_VERSION = `1-${CATALOG_HASH.slice(0, 12)}`;

function listSermonWorkspaceOperations(input = {}) {
  const mode = normalizeMode(input.mode);
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
  const requestedLimit = Number(input.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
    : 100;

  if (mode && !OPERATION_MODES.includes(mode)) {
    throw createRegistryError(
      "Invalid sermon workspace operation mode",
      400,
      "invalid_operation_mode",
      { mode, allowedModes: OPERATION_MODES }
    );
  }

  const operations = SERMON_WORKSPACE_OPERATIONS
    .filter((operation) => !mode || operation.mode === mode)
    .filter((operation) => {
      if (!query) return true;
      return [operation.name, operation.mode, operation.summary]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .slice(0, limit)
    .map(buildCatalogEntry);

  return {
    catalogVersion: CATALOG_VERSION,
    catalogHash: CATALOG_HASH,
    modes: [...OPERATION_MODES],
    count: operations.length,
    operations
  };
}

async function runSermonWorkspaceOperation(input = {}, deps = {}) {
  const mode = normalizeMode(input.mode);
  const operationName = normalizeOperationName(input.operation);

  if (!OPERATION_MODES.includes(mode)) {
    throw createRegistryError(
      "Invalid sermon workspace operation mode",
      400,
      "invalid_operation_mode",
      { mode, allowedModes: OPERATION_MODES }
    );
  }

  if (!operationName) {
    throw createRegistryError(
      "Operation is required",
      400,
      "missing_operation"
    );
  }

  const operation = OPERATION_BY_NAME.get(operationName);
  if (!operation) {
    throw createRegistryError(
      "Unknown sermon workspace operation",
      404,
      "unknown_operation",
      { operation: operationName }
    );
  }

  if (operation.mode !== mode) {
    throw createRegistryError(
      `Operation ${operationName} must use ${operation.mode} mode`,
      400,
      "operation_mode_mismatch",
      { operation: operationName, expectedMode: operation.mode, receivedMode: mode }
    );
  }

  const operationArguments = normalizeArguments(input.arguments ?? input.args);
  const missing = operation.required.filter((field) => {
    const value = operationArguments[field];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw createRegistryError(
      "Required operation arguments are missing",
      400,
      "missing_operation_arguments",
      { operation: operationName, missing }
    );
  }

  const result = await operation.handler(operationArguments, deps);
  return {
    operation: operationName,
    mode,
    result
  };
}

function buildSermonWorkspaceOperationError(error, context = {}) {
  return {
    ok: false,
    requestId: context.requestId || "",
    operation: normalizeOperationName(context.operation),
    mode: normalizeMode(context.mode),
    error: {
      code: error?.code || "sermon_workspace_operation_failed",
      message: error?.message || "Sermon workspace operation failed",
      status: Number(error?.statusCode) || 500,
      details: error?.details || {},
      requestId: context.requestId || ""
    }
  };
}

module.exports = {
  CATALOG_HASH,
  CATALOG_VERSION,
  OPERATION_MODES,
  SERMON_WORKSPACE_OPERATIONS,
  buildSermonWorkspaceOperationError,
  listSermonWorkspaceOperations,
  runSermonWorkspaceOperation
};
