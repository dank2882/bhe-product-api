# Nested projects

A project may contain other projects. For example:

- Philippines 2027
  - Containers
    - January shipment
    - February shipment
  - Travel
  - Mission Teams
  - Conferences

Every project retains its own lead, outcome, dates, status, notes, milestones, and tasks. A task belongs to exactly one project. A program is an ordinary project at the top of a hierarchy, so no parallel program database is needed.

## Everyday operations

Use the existing FBC Staff Tools `tasks_run_query` and `tasks_run_command` tools:

| Request | Operation and arguments |
| --- | --- |
| Create a top-level program | `createProject`, with `name` and normal project fields |
| Add a branch | `createProject`, with `parentProjectId` |
| Show the whole Philippines effort | `getProject`, with the program's `projectId`, `includeDescendants: true`, and today's date |
| Show only Containers | The same overview, using the Containers project ID |
| List direct subprojects | `listProjects`, with `parentProjectId` |
| List top-level projects | `listProjects`, with `parentProjectId: ""` |
| Search within an entire branch | `listProjects`, with `ancestorProjectId` plus ordinary filters |
| List all tasks in a branch | `listTasks`, with `projectId` and `includeDescendants: true`; follow `nextCursor` |
| Move a branch | `updateProject`, with current `expectedVersion` and `changes.parentProjectId` |
| Make a branch a top-level project | The same update with `changes.parentProjectId: ""` |

A move retains project and task IDs, descendants, attachments, notes, history, and direct members. Inherited branch access follows the new parent. Team/department changes must be separate commands because those changes cascade to directly linked tasks. Creating/moving beneath a project requires permission to edit that parent. Restricted branch moves and sharing changes require an owner of that project or an ancestor branch, or an administrator.

## Reading an overview

The selected branch's total counts each task once. Each project also shows its direct task counts and its counts including descendants. Never add parent and child branch totals together. The overview includes project paths, overdue/waiting/next counts, and up to five direct next tasks per project. `moreNextTasks` identifies where a full task query is needed.

Only accessible projects and tasks appear in an overview; `coverage: accessible_records_only` states that boundary. A parent's manually recorded status does not automatically close its children. If a completed parent still has open work, the overview shows that work.

## Current boundaries

Choose `visibility: "branch"` for a restricted program or branch. Set `branchMembers` to an array such as `[{"subject":"<resolved staff identity>","role":"editor"}]`. Resolve names to authenticated staff subjects using the existing staff directory before saving. Supported roles are `viewer` and `editor`; organization-wide staff role limits still apply.

Membership at the program level covers its branch-visible descendants. Membership on Containers covers Containers and its descendants, not Travel or the parent program. Child projects created beneath a branch default to branch visibility. Child projects keep their own direct members in addition to inherited grants. A project owner (including an ancestor-branch owner) or administrator manages membership through `updateProject.changes.branchMembers` with the current expected version. Editors can create subprojects/tasks and edit work; viewers can read projects, tasks, notes, and files. Viewers cannot edit, comment, or upload files.

All list, detail, overview, task-note, attachment, and leadership paths use the current project graph for the same access decision. Removing membership affects subsequent requests. Previously issued attachment URLs retain their existing short expiration. Project/task owners, administrators, and explicitly assigned task recipients retain their existing access; assigning one task does not grant the recipient the rest of the branch. Explicitly private tasks remain private even inside a shared branch.

Existing flat projects keep their prior access until explicitly changed. Converting a flat project to branch visibility also restricts directly linked staff-visible tasks through their current project; private tasks stay private. A hierarchy containing legacy private/staff child projects must be converted explicitly before linking it beneath a restricted branch. No organization-wide team-enforcement flag is changed.

There is no budget ledger or automatic accounting rollup in this slice. No real Philippines program, dates, people, or budgets have been populated by the implementation tests.

Up to eight levels and 250 visible projects per overview are supported. Choose a smaller branch for a larger program. Existing flat projects remain roots without a data migration. The existing complete-read limit of 10,000 records per collection applies. Structural changes use a Firestore transaction to reject cycles even when two users move projects simultaneously.
