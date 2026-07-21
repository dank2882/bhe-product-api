const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addTaskNote,
  buildDailyReview,
  completeTasksForPastEvents,
  createCalendarEvent,
  createProject,
  createRoutine,
  createTask,
  getTask,
  listCalendarEvents,
  listProjects,
  listRoutines,
  listTasks,
  listTaskNotes,
  updateProject,
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
  randomId = "12345678-aaaa-bbbb-cccc-123456789012",
  now = "2026-07-01T16:00:00.000Z"
} = {}) {
  return {
    projectsCollection: new FakeCollection(projects),
    tasksCollection: new FakeCollection(tasks),
    taskNotesCollection: new FakeCollection(taskNotes),
    calendarEventsCollection: new FakeCollection(calendarEvents),
    routinesCollection: new FakeCollection(routines),
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

test("shared task visibility hides private records from non-admin users", async () => {
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

test("managers can manage shared work but cannot create private records or drop tasks", async () => {
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
  await assert.rejects(
    () => createTask({ title: "Private home task", lifeArea: "home", visibility: "private" }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
  await assert.rejects(
    () => updateTask({ taskId: "task-staff", expectedVersion: 2, changes: { status: "dropped" } }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
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
