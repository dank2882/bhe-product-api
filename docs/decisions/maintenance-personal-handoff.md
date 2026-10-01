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

## Verified release — October 1, 2026

Implementation `6b5921c`; read-only service acceptance `0ad9c3a`.
All 753 tests and `npm run check` passed. Root lead and appended handoff notes
independently reread at version 9; manager/member grants unchanged.

Candidate and production revision `bhe-product-api-00321-vev`; 100 percent of
traffic verified after promotion. Environment and runtime service identity match
the prior revision. Rollback: `bhe-product-api-00319-jug`.

[Service acceptance](../maintenance-handoff-service-20261001.json) checks every
weekly/monthly section, complete default lists, daily/notification exclusion,
non-Maintenance action preservation, and Shawna's authorized internal board read.
All shared task and routine bytes matched before/after the read-only acceptance.
This did not simulate a Shawna interactive login; existing grant and service
boundary acceptance are the evidence for preserved access.

[Connected Life OS acceptance](../maintenance-handoff-connected-20261001.json)
confirms the promoted production behavior through Dan's actual connection:
46 personal next actions, preserving every non-Maintenance action from the
pre-deployment brief; 120 Maintenance next items removed. The shared board retains
122 unarchived tasks and 23 recurring duties; 169 Maintenance projects are out of
personal reviews. The broader accessible next inventory has 54 items: its eight
additional tasks are separate from personal relevance, not evidence of a race.
Counts are observations at verification time, not permanent expected values.

Only the Maintenance root's operational lead and appended handoff note changed
in production data. Existing technical ownership/audit fields and individual
work assignments remain source history and permissions, not Dan's responsibility.
