const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addTaskNote,
  BHE_DEPARTMENTS,
  buildDailyReview,
  buildLeadershipBrief,
  completeTasksForPastEvents,
  createCalendarEvent,
  createProject,
  createRoutine,
  createTask,
  getMyStaffProfile,
  getTask,
  listCalendarEvents,
  listProjects,
  listMyNotifications,
  listStaffProfiles,
  listRoutines,
  listTasks,
  listTaskNotes,
  markNotificationRead,
  respondToAssignment,
  resolveStaffIdentity,
  restoreTaskRecord,
  updateProject,
  updateMyStaffProfile,
  updateStaffProfile,
  updateTask
} = require("../lib/project-task-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }

  async get() {
    return {
      exists: this.store.has(this.id),
      data: () => clone(this.store.get(this.id))
    };
  }

  async create(data) {
    if (this.store.has(this.id)) {
      throw new Error("already exists");
    }

    this.store.set(this.id, clone(data));
  }

  async set(data) {
    this.store.set(this.id, clone(data));
  }
}

class FakeCollection {
  constructor(initialRecords = {}) {
    this.store = new Map(Object.entries(clone(initialRecords)));
  }

  doc(id) {
    return new FakeDocRef(this.store, id);
  }

  limit(maxDocs) {
    return {
      get: async () => ({
        docs: Array.from(this.store.entries())
          .slice(0, maxDocs)
          .map(([id, data]) => ({
            id,
            data: () => clone(data)
          }))
      })
    };
  }
}

function createDeps({
  projects = {},
  tasks = {},
  calendarEvents = {},
  taskNotes = {},
  routines = {},
  staffProfiles = {},
  notifications = {},
  randomId = "12345678-aaaa-bbbb-cccc-123456789012",
  now = "2026-07-01T16:00:00.000Z"
} = {}) {
  return {
    projectsCollection: new FakeCollection(projects),
    tasksCollection: new FakeCollection(tasks),
    taskNotesCollection: new FakeCollection(taskNotes),
    calendarEventsCollection: new FakeCollection(calendarEvents),
    routinesCollection: new FakeCollection(routines),
    taskStaffProfilesCollection: new FakeCollection(staffProfiles),
    taskNotificationsCollection: new FakeCollection(notifications),
    randomUUID: () => randomId,
    now: () => now
  };
}

test("creates and lists projects", async () => {
  const deps = createDeps();

  const created = await createProject(
    {
      name: "Launch personal task GPT",
      outcome: "Use a Custom GPT as the daily project/task system",
      lifeArea: "work",
      priority: "high",
      targetDate: "2026-07-05"
    },
    deps
  );

  assert.equal(created.project.projectId, "proj-launch-personal-task-gpt-12345678");
  assert.equal(created.project.status, "active");
  assert.equal(created.project.lifeArea, "work");
  assert.equal(created.project.priority, "high");
  assert.equal(created.project.targetDate, "2026-07-05");

  const listed = await listProjects({ status: "active", priority: "high", targetOnOrBefore: "2026-07-06" }, deps);
  assert.equal(listed.count, 1);
  assert.equal(listed.projects[0].name, "Launch personal task GPT");
});

test("BHE departments are optional, controlled, and inherited from projects", async () => {
  assert.deepEqual(BHE_DEPARTMENTS, ["facsimiles", "displays", "retail", "education"]);
  const deps = createDeps();

  const project = await createProject({
    name: "Facsimile release",
    department: "fascimiles"
  }, deps);
  assert.equal(project.project.department, "facsimiles");

  const inherited = await createTask({
    title: "Proof the facsimile",
    projectId: project.project.projectId
  }, deps);
  assert.equal(inherited.task.department, "facsimiles");

  await assert.rejects(
    () => createTask({
      title: "Conflicting department",
      projectId: project.project.projectId,
      department: "retail"
    }, deps),
    { code: "task_project_department_conflict", statusCode: 409 }
  );

  const standalone = await createTask({
    title: "Update display inventory",
    department: "display"
  }, deps);
  assert.equal(standalone.task.department, "displays");
  assert.equal((await listTasks({ department: "displays" }, deps)).count, 1);
  assert.equal((await listProjects({ department: "facsimiles" }, deps)).count, 1);

  await assert.rejects(
    () => createProject({ name: "Invalid department", department: "shipping" }, deps),
    { code: "invalid_department", statusCode: 400 }
  );
});

test("changing a project department cascades to all linked tasks", async () => {
  const deps = createDeps();
  const project = await createProject({
    name: "Education launch",
    department: "education"
  }, deps);
  const first = await createTask({
    title: "Prepare lesson",
    projectId: project.project.projectId
  }, deps);
  const second = await createTask({
    title: "Archive finished lesson",
    projectId: project.project.projectId,
    status: "done"
  }, deps);
  const unrelated = await createTask({
    title: "Retail stock check",
    department: "retail"
  }, deps);

  const updated = await updateProject({
    projectId: project.project.projectId,
    expectedVersion: project.project.version,
    changes: { department: "displays" }
  }, deps);
  assert.equal(updated.project.department, "displays");
  assert.equal(updated.departmentCascade.updatedTaskCount, 2);
  assert.equal((await getTask({ taskId: first.task.taskId }, deps)).task.department, "displays");
  assert.equal((await getTask({ taskId: second.task.taskId }, deps)).task.department, "displays");
  assert.equal((await getTask({ taskId: unrelated.task.taskId }, deps)).task.department, "retail");

  const cleared = await updateProject({
    projectId: project.project.projectId,
    expectedVersion: updated.project.version,
    changes: { department: "" }
  }, deps);
  assert.equal(cleared.project.department, "");
  assert.equal(cleared.departmentCascade.updatedTaskCount, 2);
  assert.equal((await getTask({ taskId: first.task.taskId }, deps)).task.department, "");
});

test("moving a task between projects adopts the destination department", async () => {
  const deps = createDeps();
  const source = await createProject({ name: "Retail work", department: "retail" }, deps);
  const destination = await createProject({ name: "Education work", department: "education" }, deps);
  const task = await createTask({
    title: "Reclassify project work",
    projectId: source.project.projectId
  }, deps);

  const moved = await updateTask({
    taskId: task.task.taskId,
    expectedVersion: task.task.version,
    changes: { projectId: destination.project.projectId }
  }, deps);
  assert.equal(moved.task.projectId, destination.project.projectId);
  assert.equal(moved.task.department, "education");

  await assert.rejects(
    () => updateTask({
      taskId: moved.task.taskId,
      expectedVersion: moved.task.version,
      changes: { department: "retail" }
    }, deps),
    { code: "task_project_department_conflict", statusCode: 409 }
  );
});

test("creates, filters, and completes tasks", async () => {
  const deps = createDeps({
    projects: {
      "proj-1": {
        projectId: "proj-1",
        name: "Launch personal task GPT",
        status: "active",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });

  const created = await createTask(
    {
      title: "Paste the action schema into the GPT builder",
      projectId: "proj-1",
      eventId: "event-launch",
      lifeArea: "work",
      priority: "high",
      dueDate: "2026-07-01",
      autoCompleteAfterEvent: true
    },
    deps
  );

  assert.equal(created.task.taskId, "task-paste-the-action-schema-into-the-gpt-builder-12345678");
  assert.equal(created.task.status, "next");
  assert.equal(created.task.eventId, "event-launch");
  assert.equal(created.task.autoCompleteAfterEvent, true);

  const highNext = await listTasks({ status: "next", priority: "high", eventId: "event-launch" }, deps);
  assert.equal(highNext.count, 1);

  const updated = await updateTask(
    {
      taskId: created.task.taskId,
      changes: { status: "done" }
    },
    deps
  );

  assert.equal(updated.task.status, "done");
  assert.equal(updated.task.completedAt, "2026-07-01T16:00:00.000Z");
});

test("adds and lists append-only task notes from Dan and Sarah", async () => {
  let randomCounter = 0;
  const deps = createDeps({
    tasks: {
      "task-home": {
        taskId: "task-home",
        title: "Choose Reynolds dinner dates",
        status: "next",
        priority: "medium",
        lifeArea: "home",
        requestedBy: "Sarah",
        assignedTo: "Dan",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });
  deps.randomUUID = () => `0000000${++randomCounter}-aaaa-bbbb-cccc-123456789012`;

  const first = await addTaskNote({
    taskId: "task-home",
    body: "August 7 or August 21 would work for me.",
    author: "Sarah"
  }, deps);
  deps.now = () => "2026-07-01T16:05:00.000Z";
  await addTaskNote({
    taskId: "task-home",
    body: "I will check the church calendar tonight.",
    author: "Dan"
  }, deps);

  assert.equal(first.note.author, "Sarah");
  const listed = await listTaskNotes({ taskId: "task-home" }, deps);
  assert.equal(listed.count, 2);
  assert.deepEqual(listed.notes.map((note) => note.author), ["Sarah", "Dan"]);
  assert.equal(listed.task.noteCount, 2);
  assert.equal(listed.task.lastNoteBy, "Dan");
  assert.equal(listed.task.lastNotePreview, "I will check the church calendar tonight.");

  const fetched = await getTask({ taskId: "task-home" }, deps);
  assert.equal(fetched.task.noteCount, 2);
});

test("auto-completes event-bound tasks after the linked event has passed", async () => {
  const deps = createDeps({
    now: "2026-07-03T03:00:00.000Z",
    calendarEvents: {
      "event-sermon": {
        eventId: "event-sermon",
        title: "Wednesday Service",
        status: "scheduled",
        lifeArea: "church",
        startDateTime: "2026-07-02T18:00:00-07:00",
        endDateTime: "2026-07-02T19:00:00-07:00",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    },
    tasks: {
      "task-sermon": {
        taskId: "task-sermon",
        title: "Preach James sermon",
        status: "next",
        priority: "high",
        lifeArea: "church",
        eventId: "event-sermon",
        autoCompleteAfterEvent: true,
        updatedAt: "2026-07-01T15:00:00.000Z"
      },
      "task-non-event": {
        taskId: "task-non-event",
        title: "Still open",
        status: "next",
        priority: "medium",
        lifeArea: "work",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });

  const result = await completeTasksForPastEvents({}, deps);
  assert.equal(result.completedCount, 1);
  assert.equal(result.completedTasks[0].taskId, "task-sermon");
  assert.equal(result.completedTasks[0].status, "done");
  assert.equal(result.completedTasks[0].completedByEventId, "event-sermon");

  const openTasks = await listTasks({ status: "next" }, deps);
  assert.equal(openTasks.count, 1);
  assert.equal(openTasks.tasks[0].taskId, "task-non-event");
});

test("daily review surfaces overdue, high-priority, waiting, and project gaps", async () => {
  const deps = createDeps({
    projects: {
      "proj-with-next": {
        projectId: "proj-with-next",
        name: "Has next action",
        status: "active",
        priority: "high",
        targetDate: "2026-07-01",
        updatedAt: "2026-07-01T15:00:00.000Z"
      },
      "proj-without-next": {
        projectId: "proj-without-next",
        name: "Needs next action",
        status: "active",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    },
    tasks: {
      "task-overdue": {
        taskId: "task-overdue",
        title: "Overdue thing",
        projectId: "proj-with-next",
        status: "next",
        priority: "high",
        dueDate: "2026-06-30",
        updatedAt: "2026-07-01T15:00:00.000Z"
      },
      "task-waiting": {
        taskId: "task-waiting",
        title: "Waiting thing",
        status: "waiting",
        priority: "medium",
        waitingOn: "Vendor",
        followUpDate: "2026-07-01",
        updatedAt: "2026-07-01T15:00:00.000Z"
      },
      "task-sarah": {
        taskId: "task-sarah",
        title: "Take check to the post office",
        status: "next",
        priority: "high",
        lifeArea: "home",
        dueDate: "2026-07-01",
        requestedBy: "Sarah",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    },
    calendarEvents: {
      "event-1": {
        eventId: "event-1",
        title: "Family dinner",
        lifeArea: "home",
        status: "scheduled",
        startDateTime: "2026-07-01T18:00:00-07:00",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    },
    routines: {
      "routine-1": {
        routineId: "routine-1",
        title: "Pack lunch",
        lifeArea: "home",
        status: "active",
        recurrence: "daily",
        preferredTime: "07:00",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });

  const review = await buildDailyReview({ today: "2026-07-01" }, deps);

  assert.equal(review.summary.activeProjectCount, 2);
  assert.equal(review.summary.overdueCount, 1);
  assert.equal(review.summary.needsReviewCount, 1);
  assert.equal(review.needsReview[0].reviewReason, "overdue");
  assert.equal(review.needsReview[0].daysOverdue, 1);
  assert.equal(review.summary.highPriorityNextCount, 2);
  assert.equal(review.summary.waitingCount, 1);
  assert.equal(review.summary.followUpDueCount, 1);
  assert.equal(review.summary.highPriorityProjectCount, 1);
  assert.equal(review.summary.projectTargetDueCount, 1);
  assert.equal(review.summary.eventCount, 0);
  assert.equal(review.summary.routineCount, 1);
  assert.equal(review.summary.sarahRequestedOpenCount, 1);
  assert.deepEqual(review.eventsToday, []);
  assert.equal(review.routines[0].title, "Pack lunch");
  assert.equal(review.followUpDue[0].taskId, "task-waiting");
  assert.equal(review.highPriorityProjects[0].projectId, "proj-with-next");
  assert.equal(review.projectTargetsDue[0].projectId, "proj-with-next");
  assert.equal(review.sarahRequested[0].title, "Take check to the post office");
  assert.equal(review.summary.projectsWithoutNextActionCount, 1);
  assert.equal(review.projectsWithoutNextAction[0].projectId, "proj-without-next");
});

test("overdue tasks enter needs review without overwriting their priority", async () => {
  const deps = createDeps({
    tasks: {
      "task-low-overdue": {
        taskId: "task-low-overdue",
        title: "Review an old low-priority follow-up",
        status: "next",
        priority: "low",
        dueDate: "2026-06-20",
        updatedAt: "2026-06-20T16:00:00.000Z"
      }
    }
  });

  const review = await buildDailyReview({ today: "2026-07-01" }, deps);
  assert.equal(review.needsReview.length, 1);
  assert.equal(review.needsReview[0].daysOverdue, 11);
  assert.equal(review.needsReview[0].reviewUrgency, "urgent");
  assert.equal(review.needsReview[0].priority, "low");
  assert.equal(review.needsReview[0].priorityChanged, false);
  assert.equal(deps.tasksCollection.store.get("task-low-overdue").priority, "low");
});

test("leadership brief groups only staff-visible work by assignee", async () => {
  const deps = createDeps({
    projects: {
      "proj-staff": { projectId: "proj-staff", name: "Staff rollout", status: "active", visibility: "staff" },
      "proj-private": { projectId: "proj-private", name: "Private planning", status: "active", visibility: "private", ownerSub: "dan" }
    },
    tasks: {
      "task-alex-today": {
        taskId: "task-alex-today",
        title: "Prepare handout",
        status: "next",
        priority: "high",
        visibility: "staff",
        assignedTo: "Alex",
        assignedToSub: "alex",
        workOnDate: "2026-07-22",
        dueDate: "2026-07-24",
        updatedAt: "2026-07-21T10:00:00.000Z"
      },
      "task-jordan-overdue": {
        taskId: "task-jordan-overdue",
        title: "Confirm vendor",
        status: "waiting",
        priority: "medium",
        visibility: "staff",
        assignedTo: "Jordan",
        assignedToSub: "jordan",
        dueDate: "2026-07-20",
        updatedAt: "2026-07-01T10:00:00.000Z"
      },
      "task-private": {
        taskId: "task-private",
        title: "Private matter",
        status: "next",
        visibility: "private",
        ownerSub: "dan",
        assignedTo: "Dan"
      }
    },
    now: "2026-07-22T16:00:00.000Z"
  });
  deps.taskAccess = { role: "manager", subject: "pastor", name: "Pastor" };

  const brief = await buildLeadershipBrief({ today: "2026-07-22" }, deps);
  assert.deepEqual(brief.summary, {
    staffActiveProjectCount: 1,
    staffOpenTaskCount: 2,
    peopleWithOpenWorkCount: 2,
    staffDirectoryCount: 0,
    plannedTodayCount: 1,
    overdueCount: 1,
    needsReviewCount: 1,
    waitingCount: 1,
    unassignedCount: 0,
    staleCount: 1,
    pendingAssignmentCount: 0,
    atRiskProjectCount: 1
  });
  assert.equal(brief.byPerson[0].name, "Alex");
  assert.equal(brief.byPerson[0].tasksPlannedToday[0].title, "Prepare handout");
  assert.equal(brief.activeProjects[0].name, "Staff rollout");
  assert.equal(JSON.stringify(brief).includes("Private matter"), false);
});

test("leadership brief rejects ordinary members", async () => {
  const deps = createDeps();
  deps.taskAccess = { role: "member", subject: "alex", name: "Alex" };
  await assert.rejects(
    () => buildLeadershipBrief({ today: "2026-07-22" }, deps),
    { code: "task_leadership_brief_denied", statusCode: 403 }
  );
});

test("daily review is read-only and does not auto-complete past-event tasks", async () => {
  const deps = createDeps({
    now: "2026-07-03T03:00:00.000Z",
    calendarEvents: {
      "event-sermon": {
        eventId: "event-sermon",
        title: "Wednesday Service",
        status: "scheduled",
        lifeArea: "church",
        endDateTime: "2026-07-02T19:00:00-07:00"
      }
    },
    tasks: {
      "task-sermon": {
        taskId: "task-sermon",
        title: "Preach Wednesday sermon",
        status: "next",
        priority: "high",
        lifeArea: "church",
        eventId: "event-sermon",
        autoCompleteAfterEvent: true,
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });

  const review = await buildDailyReview({ today: "2026-07-03" }, deps);
  const task = await getTask({ taskId: "task-sermon" }, deps);

  assert.equal(review.summary.eventCompletedTaskCount, 0);
  assert.deepEqual(review.eventCompletedTasks, []);
  assert.equal(task.task.status, "next");
});

test("personal daily reviews exclude other staff work even for an administrator", async () => {
  const deps = createDeps({
    tasks: {
      "task-dan": {
        taskId: "task-dan",
        title: "Dan overdue item",
        status: "next",
        priority: "medium",
        dueDate: "2026-06-30",
        assignedTo: "Dan",
        assignedToSub: "auth0|dan",
        visibility: "private"
      },
      "task-alex": {
        taskId: "task-alex",
        title: "Alex staff item",
        status: "next",
        priority: "high",
        assignedTo: "Alex",
        assignedToSub: "auth0|alex",
        visibility: "staff"
      }
    }
  });
  deps.taskAccess = { role: "admin", subject: "auth0|dan", name: "Dan" };

  const review = await buildDailyReview({ today: "2026-07-01" }, deps);
  assert.equal(review.summary.openTaskCount, 1);
  assert.equal(review.summary.needsReviewCount, 1);
  assert.ok(JSON.stringify(review).includes("Dan overdue item"));
  assert.ok(!JSON.stringify(review).includes("Alex staff item"));
});

test("creates and lists calendar events", async () => {
  const deps = createDeps();

  const created = await createCalendarEvent(
    {
      title: "Post office run",
      lifeArea: "home",
      startDateTime: "2026-07-01T17:15:00-07:00",
      endDateTime: "2026-07-01T17:45:00-07:00",
      notes: "Take the check Sarah mentioned.",
      requestedBy: "Sarah"
    },
    deps
  );

  assert.equal(created.event.eventId, "event-post-office-run-12345678");
  assert.equal(created.event.requestedBy, "Sarah");

  const listed = await listCalendarEvents({ date: "2026-07-01", lifeArea: "home" }, deps);
  assert.equal(listed.count, 1);
  assert.equal(listed.events[0].title, "Post office run");
});

test("creates and lists recurring routines", async () => {
  const deps = createDeps();

  const created = await createRoutine(
    {
      title: "Take medicine",
      lifeArea: "personal",
      recurrence: "daily",
      preferredTime: "06:30",
      notes: "Morning routine item"
    },
    deps
  );

  assert.equal(created.routine.routineId, "routine-take-medicine-12345678");
  assert.equal(created.routine.recurrence, "daily");

  const listed = await listRoutines({ status: "active", lifeArea: "personal" }, deps);
  assert.equal(listed.count, 1);
  assert.equal(listed.routines[0].title, "Take medicine");
});

test("updates project completion state", async () => {
  const deps = createDeps({
    projects: {
      "proj-1": {
        projectId: "proj-1",
        name: "Launch",
        status: "active",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });

  const result = await updateProject(
    {
      projectId: "proj-1",
      changes: { status: "done" }
    },
    deps
  );

  assert.equal(result.project.status, "done");
  assert.equal(result.project.completedAt, "2026-07-01T16:00:00.000Z");
});

test("updates project priority and target date", async () => {
  const deps = createDeps({
    projects: {
      "proj-1": {
        projectId: "proj-1",
        name: "BHE Vision",
        status: "active",
        priority: "medium",
        targetDate: "",
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });

  const result = await updateProject(
    {
      projectId: "proj-1",
      changes: { priority: "high", targetDate: "2026-07-15" }
    },
    deps
  );

  assert.equal(result.project.priority, "high");
  assert.equal(result.project.targetDate, "2026-07-15");
});

test("allows an administrator to backfill legacy project ownership metadata", async () => {
  const deps = createDeps({
    projects: {
      "proj-1": {
        projectId: "proj-1",
        name: "BHE Vision",
        status: "active",
        ownerSub: "",
        ownerName: "",
        ownerEmail: "",
        version: 1,
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });
  deps.taskAccess = {
    role: "admin",
    subject: "google-oauth2|dan",
    name: "Dan Kirchner",
    email: "dank@example.com"
  };

  const result = await updateProject(
    {
      projectId: "proj-1",
      changes: {
        ownerSub: "google-oauth2|dan",
        ownerName: "Dan Kirchner",
        ownerEmail: "dank@example.com"
      }
    },
    deps
  );

  assert.equal(result.project.ownerSub, "google-oauth2|dan");
  assert.equal(result.project.ownerName, "Dan Kirchner");
  assert.equal(result.project.ownerEmail, "dank@example.com");
});

test("rejects legacy project ownership changes by non-administrators", async () => {
  const deps = createDeps({
    projects: {
      "proj-1": {
        projectId: "proj-1",
        name: "Shared work",
        status: "active",
        lifeArea: "work",
        visibility: "staff",
        version: 1,
        updatedAt: "2026-07-01T15:00:00.000Z"
      }
    }
  });
  deps.taskAccess = {
    role: "manager",
    subject: "auth0|manager",
    name: "Manager"
  };

  await assert.rejects(
    () => updateProject(
      {
        projectId: "proj-1",
        expectedVersion: 1,
        changes: { ownerSub: "auth0|manager" }
      },
      deps
    ),
    { code: "project_owner_update_denied", statusCode: 403 }
  );
});

test("shared task visibility hides private records from unrelated users", async () => {
  const deps = createDeps({
    tasks: {
      "task-private": {
        taskId: "task-private",
        title: "Dan private task",
        status: "next",
        lifeArea: "home",
        visibility: "private"
      },
      "task-staff": {
        taskId: "task-staff",
        title: "Shared staff task",
        status: "next",
        lifeArea: "work",
        visibility: "staff"
      }
    }
  });
  deps.taskAccess = { role: "viewer", subject: "auth0|viewer", name: "Viewer" };

  const listed = await listTasks({}, deps);
  assert.deepEqual(listed.tasks.map((task) => task.taskId), ["task-staff"]);
  await assert.rejects(
    () => getTask({ taskId: "task-private" }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
});

test("private records remain visible to their owner without administrator scope", async () => {
  const deps = createDeps({
    tasks: {
      "task-private": {
        taskId: "task-private",
        title: "My private task",
        status: "next",
        lifeArea: "home",
        visibility: "private",
        ownerSub: "auth0|member"
      }
    }
  });
  deps.taskAccess = { role: "member", subject: "auth0|member", name: "Team Member" };

  const listed = await listTasks({}, deps);
  assert.deepEqual(listed.tasks.map((task) => task.taskId), ["task-private"]);
});

test("collaborators may comment on shared tasks but cannot update them", async () => {
  const deps = createDeps({
    tasks: {
      "task-staff": {
        taskId: "task-staff",
        title: "Shared staff task",
        status: "next",
        lifeArea: "work",
        visibility: "staff"
      }
    }
  });
  deps.taskAccess = { role: "collaborator", subject: "auth0|staff", name: "Staff Member" };

  const added = await addTaskNote({
    taskId: "task-staff",
    body: "I have the information Pastor requested.",
    author: "Staff Member"
  }, deps);
  assert.equal(added.note.authorSub, "auth0|staff");
  await assert.rejects(
    () => updateTask({ taskId: "task-staff", changes: { status: "done" } }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
});

test("managers can soft-drop staff tasks but cannot drop their private tasks", async () => {
  const deps = createDeps({
    tasks: {
      "task-staff": {
        taskId: "task-staff",
        title: "Shared staff task",
        status: "next",
        lifeArea: "work",
        visibility: "staff"
      }
    }
  });
  deps.taskAccess = { role: "manager", subject: "auth0|pastor", name: "Pastor" };

  const created = await createTask({ title: "Review BHE plan", lifeArea: "work" }, deps);
  assert.equal(created.task.visibility, "staff");
  const completed = await updateTask({ taskId: "task-staff", expectedVersion: 1, changes: { status: "done" } }, deps);
  assert.equal(completed.task.status, "done");
  const dropped = await updateTask({
    taskId: "task-staff",
    expectedVersion: 2,
    changes: { status: "dropped" }
  }, deps);
  assert.equal(dropped.task.status, "dropped");
  assert.equal(dropped.task.statusBeforeDrop, "done");
  const privateTask = await createTask({
    title: "Private work task",
    lifeArea: "work",
    visibility: "private"
  }, deps);
  assert.equal(privateTask.task.ownerSub, "auth0|pastor");
  await assert.rejects(
    () => updateTask({
      taskId: privateTask.task.taskId,
      expectedVersion: 1,
      changes: { status: "dropped" }
    }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
});

test("managers can archive staff projects but cannot archive private projects", async () => {
  const deps = createDeps({
    projects: {
      "proj-staff": {
        projectId: "proj-staff",
        name: "Shared staff project",
        status: "active",
        lifeArea: "church",
        visibility: "staff",
        version: 1
      },
      "proj-private": {
        projectId: "proj-private",
        name: "Private work project",
        status: "active",
        lifeArea: "work",
        visibility: "private",
        ownerSub: "auth0|pastor",
        version: 1
      }
    }
  });
  deps.taskAccess = { role: "manager", subject: "auth0|pastor", name: "Pastor" };

  const archived = await updateProject({
    projectId: "proj-staff",
    expectedVersion: 1,
    changes: { status: "archived" }
  }, deps);
  assert.equal(archived.project.status, "archived");
  assert.equal(archived.project.statusBeforeArchive, "active");

  await assert.rejects(
    () => updateProject({
      projectId: "proj-private",
      expectedVersion: 1,
      changes: { status: "archived" }
    }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
});

test("members can soft-remove shared records they created but not records created by someone else", async () => {
  const deps = createDeps({
    projects: {
      "proj-member-created": {
        projectId: "proj-member-created",
        name: "Member-created shared project",
        status: "active",
        lifeArea: "work",
        visibility: "staff",
        ownerSub: "auth0|member",
        createdBySub: "auth0|member",
        version: 1
      },
      "proj-other-created": {
        projectId: "proj-other-created",
        name: "Other-created shared project",
        status: "active",
        lifeArea: "work",
        visibility: "staff",
        ownerSub: "auth0|pastor",
        createdBySub: "auth0|pastor",
        version: 1
      },
      "proj-private-created": {
        projectId: "proj-private-created",
        name: "Member-created private project",
        status: "active",
        lifeArea: "work",
        visibility: "private",
        ownerSub: "auth0|member",
        createdBySub: "auth0|member",
        version: 1
      }
    },
    tasks: {
      "task-member-created": {
        taskId: "task-member-created",
        title: "Member-created shared task",
        status: "next",
        lifeArea: "work",
        visibility: "staff",
        ownerSub: "auth0|member",
        createdBySub: "auth0|member",
        assignedToSub: "auth0|other",
        version: 1
      },
      "task-other-created": {
        taskId: "task-other-created",
        title: "Other-created shared task",
        status: "next",
        lifeArea: "work",
        visibility: "staff",
        ownerSub: "auth0|pastor",
        createdBySub: "auth0|pastor",
        assignedToSub: "auth0|member",
        version: 1
      },
      "task-private-created": {
        taskId: "task-private-created",
        title: "Member-created private task",
        status: "next",
        lifeArea: "work",
        visibility: "private",
        ownerSub: "auth0|member",
        createdBySub: "auth0|member",
        assignedToSub: "auth0|member",
        version: 1
      }
    }
  });
  deps.taskAccess = { role: "member", subject: "auth0|member", name: "Team Member" };

  const dropped = await updateTask({
    taskId: "task-member-created",
    expectedVersion: 1,
    changes: { status: "dropped" }
  }, deps);
  assert.equal(dropped.task.status, "dropped");

  const archived = await updateProject({
    projectId: "proj-member-created",
    expectedVersion: 1,
    changes: { status: "archived" }
  }, deps);
  assert.equal(archived.project.status, "archived");

  await assert.rejects(
    () => updateTask({
      taskId: "task-other-created",
      expectedVersion: 1,
      changes: { status: "dropped" }
    }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
  await assert.rejects(
    () => updateProject({
      projectId: "proj-other-created",
      expectedVersion: 1,
      changes: { status: "archived" }
    }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
  await assert.rejects(
    () => updateTask({
      taskId: "task-private-created",
      expectedVersion: 1,
      changes: { status: "dropped" }
    }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
  await assert.rejects(
    () => updateProject({
      projectId: "proj-private-created",
      expectedVersion: 1,
      changes: { status: "archived" }
    }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
});

test("members can complete assigned tasks and completed work leaves the daily brief", async () => {
  const deps = createDeps({
    tasks: {
      "task-assigned": {
        taskId: "task-assigned",
        title: "Prepare bulletin insert",
        status: "next",
        priority: "medium",
        lifeArea: "church",
        visibility: "staff",
        assignedTo: "Alex",
        assignedToSub: "auth0|alex",
        version: 1,
        updatedAt: "2026-07-22T14:00:00.000Z"
      }
    },
    now: "2026-07-22T16:00:00.000Z"
  });
  deps.taskAccess = { role: "member", subject: "auth0|alex", name: "Alex" };

  const completed = await updateTask({
    taskId: "task-assigned",
    expectedVersion: 1,
    changes: { status: "done" }
  }, deps);
  assert.equal(completed.task.status, "done");
  assert.equal(completed.task.completedAt, "2026-07-22T16:00:00.000Z");

  const review = await buildDailyReview({ today: "2026-07-22" }, deps);
  assert.equal(review.summary.openTaskCount, 0);
  assert.equal(JSON.stringify(review).includes("Prepare bulletin insert"), false);
});

test("managers can restore staff work dropped by an administrator", async () => {
  const deps = createDeps({
    tasks: {
      "task-restore": {
        taskId: "task-restore",
        title: "Restore me",
        status: "next",
        priority: "medium",
        lifeArea: "work",
        visibility: "staff",
        assignedTo: "Alex",
        version: 1
      }
    },
    now: "2026-07-22T16:00:00.000Z"
  });
  deps.taskAccess = { role: "admin", subject: "auth0|dan", name: "Dan" };
  const dropped = await updateTask({
    taskId: "task-restore",
    changes: { status: "dropped" }
  }, deps);
  assert.equal(dropped.task.statusBeforeDrop, "next");

  deps.taskAccess = { role: "manager", subject: "auth0|pastor", name: "Pastor" };
  const restored = await restoreTaskRecord({
    recordType: "task",
    recordId: "task-restore",
    expectedVersion: 2
  }, deps);
  assert.equal(restored.action, "restored");
  assert.equal(restored.restoredStatus, "next");
  assert.equal(restored.task.status, "next");
  assert.equal(restored.task.restoredByName, "Pastor");
});

test("allows an administrator to backfill legacy task ownership metadata", async () => {
  const deps = createDeps({
    tasks: {
      "task-legacy": {
        taskId: "task-legacy",
        title: "Legacy task",
        status: "next",
        lifeArea: "work",
        visibility: "private",
        assignedTo: "Dan",
        ownerSub: "",
        ownerName: "",
        ownerEmail: "",
        version: 1
      }
    }
  });
  deps.taskAccess = {
    role: "admin",
    subject: "google-oauth2|dan",
    name: "Dan Kirchner",
    email: "dank@example.com"
  };

  const result = await updateTask({
    taskId: "task-legacy",
    changes: {
      ownerSub: "google-oauth2|dan",
      ownerName: "Dan Kirchner",
      ownerEmail: "dank@example.com",
      assignedTo: "Dan Kirchner",
      assignedToSub: "google-oauth2|dan",
      assignedToEmail: "dank@example.com"
    }
  }, deps);

  assert.equal(result.task.ownerSub, "google-oauth2|dan");
  assert.equal(result.task.assignedToSub, "google-oauth2|dan");
  assert.equal(result.task.assignmentStatus, "accepted");
});

test("rejects legacy task ownership changes by non-administrators", async () => {
  const deps = createDeps({
    tasks: {
      "task-shared": {
        taskId: "task-shared",
        title: "Shared task",
        status: "next",
        lifeArea: "work",
        visibility: "staff",
        version: 1
      }
    }
  });
  deps.taskAccess = {
    role: "manager",
    subject: "auth0|manager",
    name: "Manager"
  };

  await assert.rejects(
    () => updateTask({
      taskId: "task-shared",
      expectedVersion: 1,
      changes: { ownerSub: "auth0|manager" }
    }, deps),
    { code: "task_owner_update_denied", statusCode: 403 }
  );
});

test("email task provenance prevents duplicate capture of the same Outlook message", async () => {
  const deps = createDeps();
  deps.taskAccess = { role: "member", subject: "auth0|alex", name: "Alex", email: "alex@example.com" };
  const source = {
    sourceType: "outlook_email",
    sourceMessageId: "message-123",
    sourceThreadId: "thread-456",
    sourceSubject: "Please update the order",
    sourceSender: "vendor@example.com",
    sourceReceivedAt: "2026-07-22T15:30:00.000Z",
    sourceWebUrl: "https://outlook.office.com/mail/message-123"
  };
  const created = await createTask({ title: "Update the vendor order", ...source }, deps);
  assert.equal(created.task.sourceMessageId, "message-123");
  const found = await listTasks({ sourceMessageId: "message-123" }, deps);
  assert.equal(found.count, 1);
  await assert.rejects(
    () => createTask({ title: "Duplicate vendor follow-up", ...source }, deps),
    { code: "task_source_already_captured", statusCode: 409 }
  );
});

test("records work-on time, assignment provenance, and Outlook synchronization metadata", async () => {
  const deps = createDeps();
  deps.taskAccess = {
    role: "admin",
    subject: "google-oauth2|dan",
    name: "Dan",
    email: "dan@example.com"
  };

  const created = await createTask({
    title: "Prepare inventory update",
    assignedTo: "Pastor",
    assignedToSub: "google-oauth2|pastor",
    assignedToEmail: "pastor@example.com",
    workOnDate: "2026-07-22",
    workOnStartTime: "13:00",
    workOnEndTime: "14:00",
    workOnTimeZone: "America/Los_Angeles",
    outlookCalendarId: "calendar-1",
    outlookEventId: "event-1",
    outlookEventWebUrl: "https://outlook.example/event-1",
    outlookSyncStatus: "synced"
  }, deps);

  assert.equal(created.task.workOnDate, "2026-07-22");
  assert.equal(created.task.workOnStartTime, "13:00");
  assert.equal(created.task.workOnEndTime, "14:00");
  assert.equal(created.task.assignedByName, "Dan");
  assert.equal(created.task.assignedToSub, "google-oauth2|pastor");
  assert.equal(created.task.outlookSyncStatus, "synced");

  const reassigned = await updateTask({
    taskId: created.task.taskId,
    changes: {
      assignedTo: "Shawna",
      assignedToSub: "google-oauth2|shawna",
      assignedToEmail: "shawna@example.com"
    }
  }, deps);
  assert.equal(reassigned.task.assignedTo, "Shawna");
  assert.equal(reassigned.task.assignedBySub, "google-oauth2|dan");
});

test("manager edits require the current record version", async () => {
  const deps = createDeps({
    tasks: {
      "task-staff": {
        taskId: "task-staff",
        title: "Shared staff task",
        status: "next",
        lifeArea: "work",
        visibility: "staff",
        version: 3
      }
    }
  });
  deps.taskAccess = { role: "manager", subject: "auth0|pastor", name: "Pastor" };

  await assert.rejects(
    () => updateTask({ taskId: "task-staff", changes: { priority: "high" } }, deps),
    { code: "task_version_required", statusCode: 409 }
  );
  await assert.rejects(
    () => updateTask({ taskId: "task-staff", expectedVersion: 2, changes: { priority: "high" } }, deps),
    { code: "task_version_conflict", statusCode: 409 }
  );
  const result = await updateTask({
    taskId: "task-staff",
    expectedVersion: 3,
    changes: { priority: "high" }
  }, deps);
  assert.equal(result.task.version, 4);
});

test("managers cannot attach tasks to private projects", async () => {
  const deps = createDeps({
    projects: {
      "project-private": {
        projectId: "project-private",
        name: "Private project",
        lifeArea: "work",
        visibility: "private"
      }
    }
  });
  deps.taskAccess = { role: "manager", subject: "auth0|pastor", name: "Pastor" };

  await assert.rejects(
    () => createTask({ title: "Attach to private", projectId: "project-private", lifeArea: "work" }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
});

test("first sign-in registers staff and administrators can promote a manager without redeploying", async () => {
  const deps = createDeps();
  const firstSeen = await resolveStaffIdentity({
    subject: "auth0|pastor",
    displayName: "Pastor",
    email: "pastor@example.com",
    bootstrapRole: "member"
  }, deps);
  assert.equal(firstSeen.registered, true);
  assert.equal(firstSeen.created, true);
  assert.equal(firstSeen.effectiveRole, "member");

  deps.taskAccess = { role: "admin", subject: "auth0|dan", name: "Dan" };
  const promoted = await updateStaffProfile({
    subject: "auth0|pastor",
    expectedVersion: 1,
    changes: { role: "manager", managerSub: "auth0|dan" }
  }, deps);
  assert.equal(promoted.profile.role, "manager");

  const resolved = await resolveStaffIdentity({
    subject: "auth0|pastor",
    displayName: "Pastor",
    bootstrapRole: "member"
  }, deps);
  assert.equal(resolved.registered, true);
  assert.equal(resolved.created, false);
  assert.equal(resolved.effectiveRole, "manager");
  const directory = await listStaffProfiles({ status: "active" }, deps);
  assert.equal(directory.count, 1);
  assert.equal(directory.profiles[0].displayName, "Pastor");
});

test("assignees receive an in-system notification and can request clarification", async () => {
  const deps = createDeps();
  deps.taskAccess = { role: "admin", subject: "auth0|dan", name: "Dan" };
  const created = await createTask({
    title: "Confirm fall ministry schedule",
    lifeArea: "church",
    visibility: "staff",
    assignedTo: "Alex",
    assignedToSub: "auth0|alex",
    assignedToEmail: "alex@example.com"
  }, deps);
  assert.equal(created.task.assignmentStatus, "proposed");
  assert.equal(created.notification.recipientSub, "auth0|alex");

  deps.taskAccess = { role: "member", subject: "auth0|alex", name: "Alex", email: "alex@example.com" };
  const inbox = await listMyNotifications({ unreadOnly: true }, deps);
  assert.equal(inbox.count, 1);
  const response = await respondToAssignment({
    taskId: created.task.taskId,
    response: "needs_clarification",
    note: "Which service should this cover?",
    expectedVersion: 1
  }, deps);
  assert.equal(response.task.assignmentStatus, "needs_clarification");
  assert.equal(response.task.assignmentResponseNote, "Which service should this cover?");
  assert.equal(response.notification.recipientSub, "auth0|dan");

  const read = await markNotificationRead({ notificationId: inbox.notifications[0].notificationId }, deps);
  assert.ok(read.notification.readAt);
  assert.equal((await listMyNotifications({ unreadOnly: true }, deps)).count, 0);
});

test("terminal tasks do not create or retain pending assignment state", async () => {
  const deps = createDeps();
  deps.taskAccess = { role: "admin", subject: "auth0|dan", name: "Dan" };

  const completedAtCreation = await createTask({
    title: "Completed onboarding check",
    status: "done",
    visibility: "staff",
    assignedTo: "Alex",
    assignedToSub: "auth0|alex",
    assignedToEmail: "alex@example.com"
  }, deps);
  assert.equal(completedAtCreation.task.assignmentStatus, "accepted");
  assert.equal(completedAtCreation.notification, null);

  const proposed = await createTask({
    title: "Proposed setup check",
    visibility: "staff",
    assignedTo: "Alex",
    assignedToSub: "auth0|alex",
    assignedToEmail: "alex@example.com"
  }, deps);
  assert.equal(proposed.task.assignmentStatus, "proposed");

  const completed = await updateTask({
    taskId: proposed.task.taskId,
    expectedVersion: proposed.task.version,
    changes: { status: "done" }
  }, deps);
  assert.equal(completed.task.assignmentStatus, "accepted");
  assert.equal(completed.notification, null);
});

test("leadership brief combines staff plans with opt-in anonymous private capacity and project health", async () => {
  let randomCounter = 0;
  const deps = createDeps({ now: "2026-07-22T16:00:00.000Z" });
  deps.randomUUID = () => `0000000${++randomCounter}-aaaa-bbbb-cccc-123456789012`;
  await resolveStaffIdentity({
    subject: "auth0|alex",
    displayName: "Alex",
    email: "alex@example.com",
    bootstrapRole: "member"
  }, deps);
  deps.taskAccess = { role: "member", subject: "auth0|alex", name: "Alex", email: "alex@example.com" };
  await updateMyStaffProfile({
    expectedVersion: 1,
    changes: { weeklyCapacityMinutes: 2400, sharePrivateCapacity: true }
  }, deps);
  await createTask({
    title: "Private personal preparation",
    lifeArea: "work",
    workOnDate: "2026-07-23",
    estimatedMinutes: 30
  }, deps);

  deps.taskAccess = { role: "admin", subject: "auth0|dan", name: "Dan" };
  const project = await createProject({
    name: "Fall ministry launch",
    lifeArea: "church",
    visibility: "staff",
    targetDate: "2026-07-21",
    leadSub: "auth0|alex",
    leadName: "Alex",
    milestones: [{ title: "Confirm volunteers", status: "in_progress", targetDate: "2026-07-21" }],
    dependencies: [{ description: "Final room assignment", status: "open" }]
  }, deps);
  await createTask({
    title: "Publish fall ministry plan",
    projectId: project.project.projectId,
    lifeArea: "church",
    visibility: "staff",
    assignedTo: "Alex",
    assignedToSub: "auth0|alex",
    workOnDate: "2026-07-23",
    estimatedMinutes: 60
  }, deps);

  const brief = await buildLeadershipBrief({ today: "2026-07-22", horizonDays: 7 }, deps);
  const alex = brief.byPerson.find((person) => person.subject === "auth0|alex");
  assert.equal(alex.staffPlannedMinutesInHorizon, 60);
  assert.equal(alex.privateOpenTaskCount, 1);
  assert.equal(alex.privatePlannedMinutesInHorizon, 30);
  assert.equal(alex.plannedMinutesInHorizon, 90);
  assert.equal(alex.weeklyCapacityMinutes, 2400);
  assert.equal(brief.summary.atRiskProjectCount, 1);
  assert.equal(brief.atRiskProjects[0].derivedHealth, "at_risk");
  assert.ok(!JSON.stringify(brief).includes("Private personal preparation"));
});
