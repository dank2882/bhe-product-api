"use strict";

const {
  addTaskNote,
  createProjectTaskError,
  createTask,
  getTask,
  listTaskNotes,
  listTasks
} = require("./project-task-service");

const MEETING_FRONT_LOAD_CONTEXT = "meeting_front_load:v1";
const MEETING_FRONT_LOAD_SOURCE_TYPE = "outlook_calendar";
const MEETING_FRONT_LOAD_SECTIONS = Object.freeze([
  "purpose",
  "people",
  "previous_decisions",
  "open_loops",
  "communicate",
  "listen",
  "after_meeting"
]);
const MEETING_FRONT_LOAD_REFERENCE_SYSTEMS = Object.freeze([
  "prayer_management",
  "pastoral_care",
  "task_management",
  "ministry_planning",
  "sermon_workspace",
  "correspondence"
]);
const SENSITIVE_REFERENCE_SYSTEMS = new Set(["prayer_management", "pastoral_care"]);
const SECTION_SOURCE_PREFIX = "meeting_front_load_section:";
const REFERENCE_SOURCE_PREFIX = "meeting_front_load_reference:";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fail(message, code, details = {}, statusCode = 400) {
  throw createProjectTaskError(message, statusCode, details, code);
}

function validateEnum(value, allowed, fieldName) {
  const normalized = clean(value).toLowerCase();
  if (!allowed.includes(normalized)) {
    fail(`Invalid ${fieldName}`, `invalid_${fieldName}`, {
      fieldName,
      value: normalized,
      allowedValues: allowed
    });
  }
  return normalized;
}

function parsePrepMinutes(value) {
  const parsed = value === undefined || value === null || value === "" ? 20 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 60) {
    fail("prepMinutes must be an integer from 10 through 60", "invalid_meeting_front_load_prep_minutes", {
      value,
      min: 10,
      max: 60
    });
  }
  return parsed;
}

function zonedDateAndTime(date, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
  } catch (error) {
    fail("Invalid meeting time zone", "invalid_meeting_front_load_time_zone", {
      timeZone,
      reason: error?.message || "unsupported time zone"
    });
  }
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

function calculatePrepWindow(meetingStartsAt, timeZone, prepMinutes) {
  const startsAt = clean(meetingStartsAt);
  const zone = clean(timeZone);
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
    fail("meetingStartsAt must be a valid ISO-8601 date and time", "invalid_meeting_front_load_start", {
      meetingStartsAt
    });
  }
  if (!zone) {
    fail("timeZone is required", "missing_meeting_front_load_time_zone");
  }
  const meetingDate = new Date(startsAt);
  const prepStart = new Date(meetingDate.getTime() - prepMinutes * 60 * 1000);
  const localStart = zonedDateAndTime(prepStart, zone);
  const localMeeting = zonedDateAndTime(meetingDate, zone);
  if (localStart.date !== localMeeting.date) {
    fail(
      "A meeting front-load window cannot cross midnight in the current task work-on model",
      "meeting_front_load_crosses_midnight",
      { meetingStartsAt: startsAt, timeZone: zone, prepMinutes }
    );
  }
  return {
    workOnDate: localStart.date,
    workOnStartTime: localStart.time,
    workOnEndTime: localMeeting.time,
    workOnTimeZone: zone
  };
}

function isMeetingFrontLoadTask(task = {}) {
  return task.context === MEETING_FRONT_LOAD_CONTEXT &&
    task.sourceType === MEETING_FRONT_LOAD_SOURCE_TYPE;
}

function assertMeetingFrontLoadTask(task = {}) {
  if (!isMeetingFrontLoadTask(task)) {
    fail("Task is not a Meeting Front Load preparation record", "not_meeting_front_load_task", {
      taskId: task.taskId || ""
    }, 409);
  }
  return task;
}

function getActorName(deps = {}) {
  return clean(deps.taskAccess?.name) || clean(deps.taskAccess?.displayName) || "Dan";
}

async function prepareMeetingFrontLoad(input = {}, deps = {}) {
  const meetingTitle = clean(input.meetingTitle);
  const outlookEventId = clean(input.outlookEventId);
  if (!meetingTitle) fail("meetingTitle is required", "missing_meeting_front_load_title");
  if (!outlookEventId) fail("outlookEventId is required", "missing_meeting_front_load_event_id");

  const prepMinutes = parsePrepMinutes(input.prepMinutes);
  const prepWindow = calculatePrepWindow(input.meetingStartsAt, input.timeZone, prepMinutes);
  const result = await createTask({
    ...(clean(input.taskId) ? { taskId: clean(input.taskId) } : {}),
    title: `Front-load: ${meetingTitle}`,
    projectId: clean(input.projectId),
    lifeArea: clean(input.lifeArea) || "church",
    status: "scheduled",
    priority: clean(input.priority) || "medium",
    ...prepWindow,
    estimatedMinutes: prepMinutes,
    timeWindow: "Immediately before the linked Outlook meeting",
    context: MEETING_FRONT_LOAD_CONTEXT,
    notes: [
      "Meeting Front Load preparation record.",
      "Capture purpose, people, previous decisions, open loops, what to communicate, what to hear, and after-meeting outcomes as append-only entries.",
      "Keep durable prayers in Prayer Management and confidential care in Pastoral Care; link those records here without copying their content."
    ].join("\n"),
    visibility: "private",
    sourceType: MEETING_FRONT_LOAD_SOURCE_TYPE,
    sourceMessageId: outlookEventId,
    sourceThreadId: clean(input.outlookCalendarId),
    sourceSubject: meetingTitle,
    sourceReceivedAt: clean(input.meetingStartsAt),
    sourceWebUrl: clean(input.outlookEventWebUrl)
  }, deps);

  return {
    ...result,
    frontLoad: {
      taskId: result.task.taskId,
      meetingTitle,
      outlookEventId,
      prepMinutes,
      ...prepWindow,
      privacy: "private"
    },
    nextStep: "Add preparation entries, then use buildMeetingFrontLoad immediately before the meeting."
  };
}

async function addMeetingFrontLoadEntry(input = {}, deps = {}) {
  const taskId = clean(input.taskId);
  const body = clean(input.body);
  if (!body) fail("body is required", "missing_meeting_front_load_entry_body");
  const section = validateEnum(input.section, MEETING_FRONT_LOAD_SECTIONS, "meeting_front_load_section");
  const { task } = await getTask({ taskId }, deps);
  assertMeetingFrontLoadTask(task);
  const result = await addTaskNote({
    taskId,
    ...(clean(input.noteId) ? { noteId: clean(input.noteId) } : {}),
    body,
    author: clean(input.author) || getActorName(deps),
    source: `${SECTION_SOURCE_PREFIX}${section}`
  }, deps);
  return { ...result, section };
}

async function linkMeetingFrontLoadReference(input = {}, deps = {}) {
  const taskId = clean(input.taskId);
  const system = validateEnum(
    input.system,
    MEETING_FRONT_LOAD_REFERENCE_SYSTEMS,
    "meeting_front_load_reference_system"
  );
  const recordType = clean(input.recordType);
  const recordId = clean(input.recordId);
  const label = clean(input.label);
  if (!recordType) fail("recordType is required", "missing_meeting_front_load_reference_type");
  if (!recordId) fail("recordId is required", "missing_meeting_front_load_reference_id");
  if (recordType.length > 100 || recordId.length > 500 || label.length > 200) {
    fail("Meeting Front Load reference is too long", "meeting_front_load_reference_too_long");
  }
  if (SENSITIVE_REFERENCE_SYSTEMS.has(system) && label) {
    fail(
      "Do not copy prayer or pastoral-care labels into Task Management; link the opaque record ID only",
      "sensitive_meeting_front_load_label_denied",
      { system }
    );
  }
  const { task } = await getTask({ taskId }, deps);
  assertMeetingFrontLoadTask(task);
  const result = await addTaskNote({
    taskId,
    ...(clean(input.noteId) ? { noteId: clean(input.noteId) } : {}),
    body: JSON.stringify({ recordId, ...(label ? { label } : {}) }),
    author: clean(input.author) || getActorName(deps),
    source: `${REFERENCE_SOURCE_PREFIX}${system}:${recordType}`
  }, deps);
  return {
    ...result,
    reference: { system, recordType, recordId, ...(label ? { label } : {}) }
  };
}

async function resolveMeetingFrontLoadTask(input = {}, deps = {}) {
  const taskId = clean(input.taskId);
  if (taskId) {
    const response = await getTask({ taskId }, deps);
    return assertMeetingFrontLoadTask(response.task);
  }
  const outlookEventId = clean(input.outlookEventId);
  if (!outlookEventId) {
    fail("taskId or outlookEventId is required", "missing_meeting_front_load_lookup");
  }
  const response = await listTasks({ sourceMessageId: outlookEventId, limit: 100 }, deps);
  const task = response.tasks.find(isMeetingFrontLoadTask);
  if (!task) {
    fail("Meeting Front Load preparation record not found", "meeting_front_load_not_found", {
      outlookEventId
    }, 404);
  }
  return task;
}

function parseReference(note = {}) {
  const descriptor = note.source.slice(REFERENCE_SOURCE_PREFIX.length);
  const separator = descriptor.indexOf(":");
  if (separator < 1) return null;
  const system = descriptor.slice(0, separator);
  const recordType = descriptor.slice(separator + 1);
  try {
    const parsed = JSON.parse(note.body);
    if (!clean(parsed.recordId)) return null;
    return {
      system,
      recordType,
      recordId: clean(parsed.recordId),
      ...(clean(parsed.label) ? { label: clean(parsed.label) } : {}),
      linkedAt: note.createdAt || ""
    };
  } catch {
    return null;
  }
}

async function buildMeetingFrontLoad(input = {}, deps = {}) {
  const task = await resolveMeetingFrontLoadTask(input, deps);
  const noteResponse = await listTaskNotes({ taskId: task.taskId, limit: 100 }, deps);
  const sections = Object.fromEntries(MEETING_FRONT_LOAD_SECTIONS.map((section) => [section, []]));
  const references = [];
  const generalNotes = [];
  for (const note of noteResponse.notes) {
    if (note.source.startsWith(SECTION_SOURCE_PREFIX)) {
      const section = note.source.slice(SECTION_SOURCE_PREFIX.length);
      if (MEETING_FRONT_LOAD_SECTIONS.includes(section)) {
        sections[section].push({
          body: note.body,
          author: note.author,
          createdAt: note.createdAt,
          noteId: note.noteId
        });
        continue;
      }
    }
    if (note.source.startsWith(REFERENCE_SOURCE_PREFIX)) {
      const reference = parseReference(note);
      if (reference && MEETING_FRONT_LOAD_REFERENCE_SYSTEMS.includes(reference.system)) {
        references.push(reference);
        continue;
      }
    }
    generalNotes.push(note);
  }

  let relatedOpenTasks = [];
  if (task.projectId) {
    const response = await listTasks({
      projectId: task.projectId,
      detailLevel: "compact",
      limit: 100
    }, deps);
    relatedOpenTasks = response.tasks.filter((candidate) =>
      candidate.taskId !== task.taskId && !["done", "dropped"].includes(candidate.status)
    );
  }

  const missingSections = MEETING_FRONT_LOAD_SECTIONS.filter((section) => sections[section].length === 0);
  return {
    frontLoad: {
      taskId: task.taskId,
      version: task.version,
      status: task.status,
      meeting: {
        title: task.sourceSubject || task.title.replace(/^Front-load:\s*/i, ""),
        startsAt: task.sourceReceivedAt,
        outlookCalendarId: task.sourceThreadId,
        outlookEventId: task.sourceMessageId,
        outlookEventWebUrl: task.sourceWebUrl
      },
      preparationWindow: {
        date: task.workOnDate,
        startTime: task.workOnStartTime,
        endTime: task.workOnEndTime,
        timeZone: task.workOnTimeZone,
        estimatedMinutes: task.estimatedMinutes
      },
      sections,
      references,
      relatedOpenTasks,
      generalNotes,
      missingSections,
      retrievalRequests: references.map((reference) => ({
        system: reference.system,
        recordType: reference.recordType,
        recordId: reference.recordId,
        instruction: `Retrieve this record from ${reference.system}; do not copy its durable content into Task Management.`
      })),
      reviewSequence: [
        "purpose",
        "people",
        "previous_decisions",
        "open_loops",
        "communicate",
        "listen",
        "linked prayer and care records",
        "after_meeting"
      ],
      privacyBoundary: "Private Task Management holds meeting preparation. Prayer Management and Pastoral Care retain their own sensitive content. Outlook retains the meeting itself."
    }
  };
}

module.exports = {
  MEETING_FRONT_LOAD_CONTEXT,
  MEETING_FRONT_LOAD_REFERENCE_SYSTEMS,
  MEETING_FRONT_LOAD_SECTIONS,
  addMeetingFrontLoadEntry,
  buildMeetingFrontLoad,
  calculatePrepWindow,
  isMeetingFrontLoadTask,
  linkMeetingFrontLoadReference,
  prepareMeetingFrontLoad
};
