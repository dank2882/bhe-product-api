# FBC Maintenance handoff and Dan personal scope

Accepted by Dan, October 1, 2026. Registry decision:
`maintenance-personal-handoff-20261001`.

Shawna oversees FBC Maintenance. Its projects, tasks and recurring duties no
longer belong in Dan's personal lists, daily brief, notifications, oversight or
weekly/monthly reviews. This is a completed operational handoff, not delegated
work Dan still needs to supervise. Other tasks Dan delegates must remain visible.

Reuse Task Management and the existing Maintenance root and manager grant.
Update the root's operational lead to Shawna's verified individual identity.
Preserve original source wording, work assignments, status, audit authorship,
attachments, history, and access/deletion permissions. Historical creator,
importer or administrative owner fields do not imply personal responsibility.
The root handoff applies to its entire branch, including descendants with legacy
Dan lead/owner values; rewriting audit records is neither needed nor appropriate.

Backend personal-scope policy excludes the Maintenance root, all descendants
(including those missing a team label), and maintenance-team records before
sorting, pagination, counts or review computation. Use configured Dan identity
aliases and existing private delegation grants, never names or administrator
role as identity. Apply the same policy to tasks, projects, routines and their
notifications. Retain non-Maintenance `assignedBySub` relationships in daily and
planning relevance, even when the worker owns the task.

Generic reads report `scope: dan_personal_excludes_maintenance`. A deliberate
Maintenance team/project lookup or dedicated Maintenance board stays an
explicit view of the shared system under unchanged authorization. The default
list is not a claim to be the entire accessible organizational inventory.
Shawna's normal task and Maintenance workflows retain all authorized records.
No new service, schema, identity provider, permission grant or chat-only filter.

This amends the earlier rule to keep all active personal tasks visible: all
remaining personal tasks and delegation stay visible; handed-off Maintenance
is outside that personal responsibility scope regardless of task status.

## Verification gates

- Regression tests: nested/unclassified Maintenance, legacy identities, Sarah's
  private delegation, next/waiting/scheduled tasks, recurring duties, assignment
  notifications, count/pagination consistency, and non-Maintenance delegation.
- Shared board completeness and denied outsider access; no mutations on reads.
- Independent live read of root lead/notes and unchanged manager/member grants.
- Deploy existing backend, verify revision/traffic and connected daily/list and
  all weekly/monthly review sections. Check preserved shared board/routine data.

Deployment and live evidence will be recorded separately after these gates pass.
