"use strict";

const { createHash } = require("node:crypto");
const { recordTaskManagementAuditEvent } = require("./task-management-audit");
const {
  attachTaskFile,
  getTaskAttachmentDownload,
  listTaskAttachments
} = require("./task-attachment-service");
const {
  addTaskNote,
  buildDailyReview,
  buildLeadershipBrief,
  createProject,
  createRoutine,
  createTask,
  getMyStaffProfile,
  getProject,
  getTask,
  listProjects,
  listMyNotifications,
  listRoutines,
  listStaffProfiles,
  listTaskNotes,
  listTasks,
  listTeams,
  markNotificationRead,
  respondToAssignment,
  restoreTaskRecord,
  updateProject,
  updateMyStaffProfile,
  updateStaffProfile,
  updateRoutine,
  updateTask
} = require("./project-task-service");
const {
  appendThinkTankReflection,
  buildThinkTankReview,
  captureThinkTankEntry,
  getThinkTankEntry,
  linkThinkTankOutcome,
  listThinkTankEntries,
  listThinkTankReflections,
  updateThinkTankEntry
} = require("./think-tank-service");
const {
  addMeetingFrontLoadEntry,
  buildMeetingFrontLoad,
  linkMeetingFrontLoadReference,
  prepareMeetingFrontLoad
} = require("./meeting-front-load-service");

const OPERATION_MODES = ["query", "command"];

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
    confirmationPolicy: "none",
    handler
  });
}

const TASK_MANAGEMENT_OPERATIONS = Object.freeze([
  defineOperation({
    name: "listTeams",
    mode: "query",
    summary: "List the stable FBC staff team registry and schema versions.",
    handler: listTeams
  }),
  defineOperation({
    name: "buildDailyReview",
    mode: "query",
    summary: "Build a read-only personal review with every currently actionable next task plus projects, waiting items, routines, and requested work for one date.",
    optional: ["today", "detailLevel"],
    exampleArguments: { today: "2026-07-21", detailLevel: "compact" },
    argumentGuidance: "This operation never creates, updates, or completes records. activeNext is the complete actionable list returned by the review; priority ranks that list but does not hide tasks. Each activeNext item has a displayNumber for this review only; use taskId for durable writes. Combine it with Outlook Calendar for timed commitments.",
    handler: buildDailyReview
  }),
  defineOperation({
    name: "buildLeadershipBrief",
    mode: "query",
    summary: "Build a read-only leadership view of staff-visible work grouped by assignee, including today's plans, overdue work, waiting items, and stale tasks.",
    optional: ["today", "horizonDays"],
    exampleArguments: { today: "2026-07-22", horizonDays: 7 },
    argumentGuidance: "Private task titles and details are always excluded. A person may opt in to anonymous private-work counts and planned-minute totals. Merge Outlook busy time only as availability, and never use this brief for employee surveillance or performance scoring.",
    handler: buildLeadershipBrief
  }),
  defineOperation({
    name: "getMyStaffProfile",
    mode: "query",
    summary: "Get the signed-in staff member's task identity, role, capacity preference, and manager relationship.",
    handler: getMyStaffProfile
  }),
  defineOperation({
    name: "listStaffProfiles",
    mode: "query",
    summary: "List the active or disabled BHE task-management staff directory for managers and administrators.",
    optional: ["status", "query", "limit"],
    exampleArguments: { status: "active", limit: 50 },
    handler: listStaffProfiles
  }),
  defineOperation({
    name: "listMyNotifications",
    mode: "query",
    summary: "List the signed-in person's assignment and assignment-response notifications.",
    optional: ["unreadOnly", "limit"],
    exampleArguments: { unreadOnly: true, limit: 25 },
    handler: listMyNotifications
  }),
  defineOperation({
    name: "listProjects",
    mode: "query",
    summary: "List projects by status, life area, optional BHE department, priority, target date, or search text.",
    optional: ["includeArchived","parentProjectId", "ancestorProjectId", "status", "lifeArea", "department", "teamId", "priority", "targetOnOrBefore", "query", "limit", "cursor"],
    exampleArguments: { status: "active", lifeArea: "work", department: "education", limit: 25 },
    argumentGuidance: "Collaborative branch archives are hidden by default. Use status:archived to open the archive, or includeArchived:true for all work. Request full detail to show archivedByName and lastArchivedAt. Use parentProjectId for direct children (empty string lists roots), or ancestorProjectId for a whole branch including its root. Follow nextCursor while hasMore is true. Restricted branches inherit ancestor grants; legacy projects retain existing access.",
    handler: listProjects
  }),
  defineOperation({
    name: "getProject",
    mode: "query",
    summary: "Get one project by its stable project ID.",
    required: ["projectId"],
    optional: ["includeArchived", "includeDescendants", "today"],
    argumentGuidance: "Set includeDescendants:true for a program or branch overview with nested projects, direct and rolled-up task counts, paths, and next actions. Totals include only accessible records; parent and child totals overlap.",
    exampleArguments: { projectId: "proj-bhe-vision" },
    handler: getProject
  }),
  defineOperation({
    name: "listTasks",
    mode: "query",
    summary: "List tasks by status, priority, project, life area, optional BHE department, requester, assignee, work-on date, deadline, or search text.",
    optional: ["includeArchived", "includeDescendants", "status", "priority", "projectId", "lifeArea", "department", "teamId", "requestedBy", "assignedTo", "assignedToSub", "sourceMessageId", "workOnDate", "workOnOnOrBefore", "query", "dueBefore", "dueOnOrBefore", "followUpOnOrBefore", "limit", "detailLevel", "cursor"],
    exampleArguments: { lifeArea: "home", detailLevel: "compact", limit: 100 },
    argumentGuidance: "Collaborative branch archives are hidden by default. Use status:dropped to open the archive, or includeArchived:true for all work. Request full detail to show archivedByName and lastArchivedAt. With projectId, set includeDescendants:true to include tasks in nested projects. Otherwise projectId selects direct tasks only. Follow nextCursor while hasMore is true for complete inventories. Use detailLevel compact for inventories and reviews; it retains teamId while omitting notes, source metadata, audit fields, and sync details. Omit it only when the complete task record is required. Team IDs are the staff authorization boundary; departments remain optional work classifications such as facsimiles, displays, retail, or education. Sermon identity, preparation, readiness, and preaching dates belong in Sermon Workspace and should not be represented as ordinary tasks.",
    handler: listTasks
  }),
  defineOperation({
    name: "getTask",
    mode: "query",
    summary: "Get one complete task, including its task-note summary.",
    required: ["taskId"],
    exampleArguments: { taskId: "task-example" },
    handler: getTask
  }),
  defineOperation({
    name: "listTaskNotes",
    mode: "query",
    summary: "Read the ordered append-only note conversation for one task.",
    required: ["taskId"],
    optional: ["limit"],
    exampleArguments: { taskId: "task-example", limit: 25 },
    handler: listTaskNotes
  }),
  defineOperation({
    name: "listAttachments",
    mode: "query",
    summary: "List file attachments on one accessible task or project.",
    required: ["recordType", "recordId"],
    optional: ["limit"],
    exampleArguments: { recordType: "task", recordId: "task-example", limit: 25 },
    handler: listTaskAttachments
  }),
  defineOperation({
    name: "getAttachmentDownload",
    mode: "query",
    summary: "Create a short-lived download link for one accessible task or project attachment.",
    required: ["attachmentId"],
    exampleArguments: { attachmentId: "attachment-example" },
    argumentGuidance: "Use or share the returned URL only before its expiration; never store a signed URL on the task.",
    handler: getTaskAttachmentDownload
  }),
  defineOperation({
    name: "listRoutines",
    mode: "query",
    summary: "List recurring routines by status, life area, or search text.",
    optional: ["status", "lifeArea", "query", "limit"],
    exampleArguments: { status: "active", limit: 25 },
    handler: listRoutines
  }),
  defineOperation({
    name: "listThinkTankEntries",
    mode: "query",
    summary: "List the signed-in owner's private Think Tank entries with bounded pagination and explicit completeness metadata.",
    optional: ["status", "statuses", "lifeArea", "topic", "query", "limit", "cursor"],
    exampleArguments: { statuses: ["inbox", "incubating", "ready"], limit: 50 },
    argumentGuidance: "Think Tank is owner-only, including from task administrators. Exact source wording remains immutable and assistant interpretation stays in separate fields.",
    handler: listThinkTankEntries
  }),
  defineOperation({
    name: "getThinkTankEntry",
    mode: "query",
    summary: "Get one private Think Tank entry by stable thought ID.",
    required: ["thoughtId"],
    exampleArguments: { thoughtId: "thought-example" },
    handler: getThinkTankEntry
  }),
  defineOperation({
    name: "listThinkTankReflections",
    mode: "query",
    summary: "List append-only reflections for one owned Think Tank entry with bounded pagination.",
    required: ["thoughtId"],
    optional: ["limit", "cursor"],
    exampleArguments: { thoughtId: "thought-example", limit: 50 },
    handler: listThinkTankReflections
  }),
  defineOperation({
    name: "buildThinkTankReview",
    mode: "query",
    summary: "Build the signed-in owner's weekly Think Tank triage board grouped by status with counts, age, topics, and candidate destinations.",
    optional: ["asOfDate", "includeParked", "limit", "cursor"],
    exampleArguments: { asOfDate: "2026-08-10", includeParked: false, limit: 100 },
    argumentGuidance: "This is a triage board, not a narrative digest. Follow nextCursor until moreAvailable is false before calling the inventory complete.",
    handler: buildThinkTankReview
  }),
  defineOperation({
    name: "buildMeetingFrontLoad",
    mode: "query",
    summary: "Assemble one private pre-meeting pastoral review from its preparation entries, linked source references, and still-open related project tasks.",
    optional: ["taskId", "outlookEventId"],
    exampleArguments: { taskId: "task-front-load-staff-meeting" },
    argumentGuidance: "Pass taskId or outlookEventId. This read never copies prayer or pastoral-care content into Task Management; follow retrievalRequests through each owning system before presenting the final review.",
    handler: buildMeetingFrontLoad
  }),
  defineOperation({
    name: "createProject",
    mode: "command",
    summary: "Create one project with an outcome, life area, optional BHE department, priority, and optional target date.",
    required: ["name"],
    optional: ["collaborationPolicy", "projectId", "parentProjectId", "branchMembers", "outcome", "lifeArea", "department", "teamId", "status", "priority", "targetDate", "requestedBy", "leadSub", "leadName", "leadEmail", "health", "healthNote", "nextReviewDate", "milestones", "dependencies", "notes", "visibility"],
    exampleArguments: { name: "Prepare Psalms book", outcome: "Produce a proofed printable book block", lifeArea: "work", department: "facsimiles" },
    argumentGuidance: "For a team area whose members may archive/restore but never delete, use collaborationPolicy:editor_archive_owner_delete with branch visibility. The area owner alone may change this policy. Set parentProjectId to create a child project; omit it for a root. Each project keeps its own lead, dates, status, and department. Use visibility:branch with branchMembers:[{subject,role:viewer|editor}] for restricted sharing. Resolve people to authenticated staff subjects first. Child projects inherit branch visibility and ancestor grants; direct members receive only that branch and descendants. Department is optional and must be facsimiles, displays, retail, or education. Every task linked directly to this project inherits this department.",
    handler: createProject
  }),
  defineOperation({
    name: "prepareMeetingFrontLoad",
    mode: "command",
    summary: "Create one private 10-60 minute Meeting Front Load preparation task linked to an existing Outlook event.",
    required: ["meetingTitle", "meetingStartsAt", "timeZone", "outlookEventId"],
    optional: ["taskId", "outlookCalendarId", "outlookEventWebUrl", "projectId", "lifeArea", "priority", "prepMinutes"],
    exampleArguments: { meetingTitle: "Staff Meeting", meetingStartsAt: "2026-09-03T10:00:00-07:00", timeZone: "America/Los_Angeles", outlookEventId: "outlook-event-id", prepMinutes: 20 },
    argumentGuidance: "Outlook remains the meeting authority. Use the occurrence event ID for recurring meetings. The new task is always private and contains no prayer or pastoral-care content.",
    handler: prepareMeetingFrontLoad
  }),
  defineOperation({
    name: "addMeetingFrontLoadEntry",
    mode: "command",
    summary: "Append one preparation entry to a Meeting Front Load section without replacing earlier note history.",
    required: ["taskId", "section", "body"],
    optional: ["noteId", "author"],
    exampleArguments: { taskId: "task-front-load-staff-meeting", section: "listen", body: "Ask what is making the current schedule difficult." },
    argumentGuidance: "Sections are purpose, people, previous_decisions, open_loops, communicate, listen, and after_meeting. Do not place durable prayer requests or confidential pastoral-care details here.",
    handler: addMeetingFrontLoadEntry
  }),
  defineOperation({
    name: "linkMeetingFrontLoadReference",
    mode: "command",
    summary: "Link an owning-system record to a Meeting Front Load task without copying its sensitive content.",
    required: ["taskId", "system", "recordType", "recordId"],
    optional: ["noteId", "label", "author"],
    exampleArguments: { taskId: "task-front-load-staff-meeting", system: "prayer_management", recordType: "prayer", recordId: "prayer-id" },
    argumentGuidance: "Systems are prayer_management, pastoral_care, task_management, ministry_planning, sermon_workspace, and correspondence. Prayer and pastoral-care references must use opaque IDs without labels.",
    handler: linkMeetingFrontLoadReference
  }),
  defineOperation({
    name: "updateProject",
    mode: "command",
    summary: "Update selected fields on one existing project; team and BHE department changes cascade to every linked task.",
    required: ["projectId", "changes"],
    optional: ["expectedVersion"],
    exampleArguments: { projectId: "proj-example", changes: { department: "retail", priority: "high", targetDate: "2026-07-31" } },
    argumentGuidance: "For an explicit permanent-delete request only, use changes:{permanentlyDelete:true,confirmDelete:true} and the current expectedVersion; do not combine with other edits. This is limited to a configured creator-delete branch and requires the area owner when policy is editor_archive_owner_delete; members can never delete under that policy, including their own records. Projects must have no linked work; tasks with files or calendar links must be archived. Otherwise, department is optional and must be facsimiles, displays, retail, or education. Changing or clearing it cascades to every directly linked task. changes.parentProjectId moves the project with its descendants; an empty string makes it a root. Moves preserve tasks, identity, history, status, and direct members; inherited branch access follows the new parent. Only an owner of the project or an ancestor branch, or an administrator, may move restricted branches or change changes.branchMembers. Change team/department in a separate command. Cycles and more than eight project levels are rejected. Managers may archive staff-visible work or church projects. In either editor_archive_creator_delete or editor_archive_owner_delete branches, all editors may archive/restore any project. Outside those branches, members may archive only their own staff-visible projects. Archiving is recoverable; changing visibility, transferring ownership, and administering private records remain administrator-only.",
    handler: updateProject
  }),
  defineOperation({
    name: "createTask",
    mode: "command",
    summary: "Create one concrete task or waiting item with an optional standalone BHE department or an inherited project department.",
    required: ["title"],
    optional: ["taskId", "projectId", "lifeArea", "department", "teamId", "status", "priority", "dueDate", "workOnDate", "workOnStartTime", "workOnEndTime", "workOnTimeZone", "estimatedMinutes", "timeWindow", "waitingOn", "followUpDate", "requestedBy", "assignedTo", "assignedToSub", "assignedToEmail", "context", "notes", "visibility", "sourceType", "sourceMessageId", "sourceThreadId", "sourceSubject", "sourceSender", "sourceReceivedAt", "sourceWebUrl", "outlookCalendarId", "outlookEventId", "outlookEventWebUrl", "outlookSyncStatus", "scheduledDate", "scheduledTime"],
    exampleArguments: { title: "Prepare BHE inventory update", department: "retail", assignedTo: "Dan", workOnDate: "2026-07-22", workOnStartTime: "13:00", workOnEndTime: "14:00", workOnTimeZone: "America/Los_Angeles" },
    argumentGuidance: "A standalone task may optionally use facsimiles, displays, retail, or education. A project task always inherits the project's department, and conflicting input is rejected. Use workOnDate and optional workOnStartTime/workOnEndTime for when the assignee plans to work. dueDate remains a real deadline. scheduledDate and scheduledTime are compatibility aliases only. When an Outlook connector is available, create the time block there and save its returned IDs and link on the task. Do not create sermon-writing, sermon-preparation, preaching, or automatic sermon-completion tasks; use Sermon Workspace for that lifecycle.",
    handler: createTask
  }),
  defineOperation({
    name: "updateTask",
    mode: "command",
    summary: "Update selected task fields or status while preserving project department inheritance and the note conversation.",
    required: ["taskId", "changes"],
    optional: ["expectedVersion"],
    exampleArguments: { taskId: "task-example", changes: { status: "done" } },
    argumentGuidance: "For an explicit permanent-delete request only, use changes:{permanentlyDelete:true,confirmDelete:true} and the current expectedVersion; do not combine with other edits. This is limited to a configured creator-delete branch and requires the area owner when policy is editor_archive_owner_delete; members can never delete under that policy, including their own records. Projects must have no linked work; tasks with files or calendar links must be archived. Otherwise, department is optional only for standalone tasks. A project task always inherits its project's department; moving it to another project adopts the destination department. Use done for completed work and dropped for a recoverable soft removal. Managers may drop staff-visible work or church tasks. In either editor_archive_creator_delete or editor_archive_owner_delete branches, editors may archive/restore any shared task. Outside those branches, members may drop only their own staff-visible tasks; assignment alone is insufficient. Private-record administration, visibility changes and ownership transfer remain administrator-only.",
    handler: updateTask
  }),
  defineOperation({
    name: "respondToAssignment",
    mode: "command",
    summary: "Let the assigned person accept, decline, or request clarification on one proposed task assignment.",
    required: ["taskId", "response", "expectedVersion"],
    optional: ["note"],
    exampleArguments: { taskId: "task-example", response: "accepted", expectedVersion: 2 },
    argumentGuidance: "Only the authenticated assignee may respond. Use needs_clarification when ownership, scope, deadline, or work-on timing is unclear.",
    handler: respondToAssignment
  }),
  defineOperation({
    name: "markNotificationRead",
    mode: "command",
    summary: "Mark one of the signed-in person's task notifications read.",
    required: ["notificationId"],
    exampleArguments: { notificationId: "notification-example" },
    handler: markNotificationRead
  }),
  defineOperation({
    name: "updateMyStaffProfile",
    mode: "command",
    summary: "Update the signed-in person's display details, weekly capacity, and private-capacity sharing preference.",
    required: ["changes", "expectedVersion"],
    exampleArguments: { changes: { weeklyCapacityMinutes: 2100, sharePrivateCapacity: true }, expectedVersion: 1 },
    argumentGuidance: "Private task titles remain private. sharePrivateCapacity exposes only anonymous counts and planned minutes in leadership workload summaries.",
    handler: updateMyStaffProfile
  }),
  defineOperation({
    name: "updateStaffProfile",
    mode: "command",
    summary: "Let an administrator update a registered staff member's role, status, manager, leadership areas, identity details, or capacity settings.",
    required: ["subject", "changes", "expectedVersion"],
    exampleArguments: { subject: "auth0|pastor", changes: { role: "manager" }, expectedVersion: 1 },
    argumentGuidance: "The staff member must sign in once before this operation can promote or disable the profile. leadershipAreas may contain bhe and missions; these describe responsibility and never grant access.",
    handler: updateStaffProfile
  }),
  defineOperation({
    name: "restoreRecord",
    mode: "command",
    summary: "Restore one dropped task or archived project/routine to its prior status without losing history.",
    required: ["recordType", "recordId"],
    optional: ["expectedVersion"],
    exampleArguments: { recordType: "task", recordId: "task-example", expectedVersion: 4 },
    argumentGuidance: "Editors in a branch with either editor_archive_creator_delete or editor_archive_owner_delete may archive and restore any branch project or shared task. Managers may restore staff-visible records and their own private records. Administrators may restore any accessible record. Completed tasks are not deleted; reopen them with updateTask instead.",
    handler: restoreTaskRecord
  }),
  defineOperation({
    name: "addTaskNote",
    mode: "command",
    summary: "Append a dated note from an authorized BHE collaborator to one task without overwriting prior notes.",
    required: ["taskId", "body", "author"],
    optional: ["noteId", "source"],
    exampleArguments: { taskId: "task-example", body: "August 21 works for me.", author: "Sarah", source: "chat" },
    argumentGuidance: "Preserve the actual speaker as author. Use task.notes for durable description and addTaskNote for the back-and-forth history.",
    handler: addTaskNote
  }),
  defineOperation({
    name: "attachFile",
    mode: "command",
    summary: "Preserve one attached file on an accessible task or project with uploader attribution and checksum deduplication.",
    required: ["recordType", "recordId", "openaiFileIdRefs"],
    optional: ["description"],
    exampleArguments: { recordType: "task", recordId: "task-example", openaiFileIdRefs: ["attached-file"] },
    argumentGuidance: "Attach exactly one supported office document, PDF, text/CSV file, or image up to 25 MB.",
    handler: attachTaskFile
  }),
  defineOperation({
    name: "createRoutine",
    mode: "command",
    summary: "Create one recurring routine without generating a new task for each occurrence.",
    required: ["title"],
    optional: ["routineId", "lifeArea", "status", "recurrence", "recurrenceNotes", "preferredTime", "assignedTo", "requestedBy", "notes", "visibility"],
    exampleArguments: { title: "Check mail and packages", lifeArea: "home", recurrence: "daily", preferredTime: "after work" },
    handler: createRoutine
  }),
  defineOperation({
    name: "captureThinkTankEntry",
    mode: "command",
    summary: "Capture one private undeveloped thought in the owner's exact words without forcing classification.",
    required: ["exactText"],
    optional: ["thoughtId", "assistantTitle", "assistantSummary", "lifeArea", "topics", "candidateDestinations", "status", "source", "sourceMode"],
    exampleArguments: { exactText: "I need to think about how our ministry structure should grow.", source: "codex", sourceMode: "voice" },
    argumentGuidance: "Preserve exactText verbatim. Titles, summaries, topics, and destination suggestions are assistant interpretation and must remain separate. Do not capture confidential care history or actual budgets, giving, accounts, or transactions.",
    handler: captureThinkTankEntry
  }),
  defineOperation({
    name: "appendThinkTankReflection",
    mode: "command",
    summary: "Append another immutable source reflection to one owned Think Tank entry.",
    required: ["thoughtId", "exactText"],
    optional: ["reflectionId", "assistantSummary", "author", "source", "sourceMode"],
    exampleArguments: { thoughtId: "thought-example", exactText: "A second part I want to remember is...", author: "Dan" },
    argumentGuidance: "Preserve the speaker's exact wording in exactText. Reflections are append-only and never replace the original thought.",
    handler: appendThinkTankReflection
  }),
  defineOperation({
    name: "updateThinkTankEntry",
    mode: "command",
    summary: "Update assistant interpretation or triage status on one owned Think Tank entry while preserving exact source text.",
    required: ["thoughtId", "changes", "expectedVersion"],
    exampleArguments: { thoughtId: "thought-example", changes: { status: "incubating", topics: ["ministry structure"] }, expectedVersion: 1 },
    argumentGuidance: "exactText cannot be updated. Refresh the entry before writing and pass its current version.",
    handler: updateThinkTankEntry
  }),
  defineOperation({
    name: "linkThinkTankOutcome",
    mode: "command",
    summary: "Link a successfully created and independently read-back destination record to an owned Think Tank entry.",
    required: ["thoughtId", "destinationSystem", "destinationType", "destinationId", "destinationVerified", "verificationReference", "expectedVersion"],
    optional: ["label", "closeThought"],
    exampleArguments: { thoughtId: "thought-example", destinationSystem: "task_management", destinationType: "routine", destinationId: "routine-example", destinationVerified: true, verificationReference: "readback-request-id", expectedVersion: 2 },
    argumentGuidance: "Create the outcome through its owning tool and read it back before this command. If destination creation or read-back fails, do not call this operation. The thought closes by default; pass closeThought false to keep developing it.",
    handler: linkThinkTankOutcome
  }),
  defineOperation({
    name: "updateRoutine",
    mode: "command",
    summary: "Update selected fields or status on one existing routine.",
    required: ["routineId", "changes"],
    optional: ["expectedVersion"],
    exampleArguments: { routineId: "routine-example", changes: { status: "paused" } },
    handler: updateRoutine
  })
]);

const OPERATION_BY_NAME = new Map(TASK_MANAGEMENT_OPERATIONS.map((operation) => [operation.name, operation]));

function createRegistryError(message, statusCode = 400, code = "task_management_operation_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildCatalogEntry(operation) {
  return {
    operation: operation.name,
    mode: operation.mode,
    summary: operation.summary,
    required: [...operation.required],
    optional: [...operation.optional],
    exampleArguments: { ...operation.exampleArguments },
    argumentGuidance: operation.argumentGuidance || "",
    confirmationPolicy: operation.confirmationPolicy
  };
}

const CATALOG_HASH = createHash("sha256")
  .update(JSON.stringify(TASK_MANAGEMENT_OPERATIONS.map(buildCatalogEntry)))
  .digest("hex");
const CATALOG_VERSION = `1-${CATALOG_HASH.slice(0, 12)}`;

function listTaskManagementOperations(input = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const query = normalizeString(input.query).toLowerCase();
  const parsedLimit = Number(input.limit);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 200) : 100;

  if (mode && !OPERATION_MODES.includes(mode)) {
    throw createRegistryError("Invalid task management operation mode", 400, "invalid_operation_mode", {
      mode,
      allowedModes: OPERATION_MODES
    });
  }

  const operations = TASK_MANAGEMENT_OPERATIONS
    .filter((operation) => !mode || operation.mode === mode)
    .filter((operation) => !query || [operation.name, operation.summary].join(" ").toLowerCase().includes(query))
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

async function runTaskManagementOperation(input = {}, deps = {}) {
  const mode = normalizeString(input.mode).toLowerCase();
  const operationName = normalizeString(input.operation);
  const operationArguments = input.arguments ?? input.args ?? {};

  if (!OPERATION_MODES.includes(mode)) {
    throw createRegistryError("Invalid task management operation mode", 400, "invalid_operation_mode", {
      mode,
      allowedModes: OPERATION_MODES
    });
  }
  if (!operationName) throw createRegistryError("Operation is required", 400, "missing_operation");
  if (!operationArguments || typeof operationArguments !== "object" || Array.isArray(operationArguments)) {
    throw createRegistryError("Operation arguments must be an object", 400, "invalid_operation_arguments");
  }

  const operation = OPERATION_BY_NAME.get(operationName);
  if (!operation) {
    throw createRegistryError("Unknown task management operation", 404, "unknown_operation", { operation: operationName });
  }
  if (operation.mode !== mode) {
    throw createRegistryError(`Operation ${operationName} must use ${operation.mode} mode`, 400, "operation_mode_mismatch", {
      operation: operationName,
      expectedMode: operation.mode,
      receivedMode: mode
    });
  }

  const missing = operation.required.filter((field) => {
    const value = operationArguments[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw createRegistryError("Required operation arguments are missing", 400, "missing_operation_arguments", {
      operation: operationName,
      missing
    });
  }

  const result = await operation.handler(operationArguments, deps);
  if (mode === "command") {
    await recordTaskManagementAuditEvent({
      operation: operationName,
      arguments: operationArguments,
      result
    }, deps);
  }
  return { operation: operationName, mode, result };
}

function buildTaskManagementOperationError(error, context = {}) {
  return {
    ok: false,
    requestId: context.requestId || "",
    operation: normalizeString(context.operation),
    mode: normalizeString(context.mode).toLowerCase(),
    error: {
      code: error?.code || "task_management_operation_failed",
      message: error?.message || "Task management operation failed",
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
  TASK_MANAGEMENT_OPERATIONS,
  buildTaskManagementOperationError,
  listTaskManagementOperations,
  runTaskManagementOperation
};
