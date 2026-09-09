# Maintenance team collaboration

Accepted by Dan on September 9, 2026: Dan owns Maintenance; Pastor Smith,
Schuyler McIlroy, Andy Lee and Shawna Blue have read/write/archive access;
Initial request allowed creator deletion. Superseded by Dan later on September 9: members may archive and restore all shared work, see who archived it, and must never permanently delete records.

Reuse Task Management projects, the Maintenance team ID, branch membership and
existing tasks.read/comment/write permissions. The Maintenance root is a church
project owned by Dan. Its four editor grants inherit through subprojects.
Existing private tasks retain their private access boundary.

Maintenance uses `collaborationPolicy: editor_archive_owner_delete`. The earlier creator-delete policy remains available for other explicitly configured branches.
The outermost policy root governs descendants. Editors may edit, archive and
restore shared work. Only the area owner manages branch sharing and moves.
Only the area owner may change the policy. Other branches retain
existing behavior. Staff roles and unrelated domain permissions are preserved.

Existing updateProject/updateTask commands accept a separate deletion intent:
`changes: {permanentlyDelete: true, confirmDelete: true}` with current
`expectedVersion`. Do not combine deletion with edits. Under the Maintenance policy, only the authenticated area owner may delete. Members are denied even for records they created, including callers with manager or administrator status. Archive
is distinct and reversible. The area root cannot be deleted.

Deletion checks a current project graph, permissions, version and references
inside a Firestore transaction. It atomically saves a durable deletion receipt;
replay cannot delete a new record using the same ID. Projects with linked work
are protected from deletion. Tasks with files or calendar links must be archived;
small task-note and notification histories are removed with their task. Task
creation and project-linked updates recheck parent existence transactionally.
No new endpoint, OAuth scope, service, database or client tool is required.

Verification: automated permission and transaction tests, complete backend test
suite and contract checks, followed by live synthetic checks and root readback.
Individual staff-client acceptance is a separate final gate. Rollback uses the
previous Cloud Run revision; root/profile records are additive, preserved data.

Archive behavior: ordinary collaborative project/task lists exclude archived/dropped records. Explicit status filters or includeArchived:true expose the authorized archive. archivedBySub, archivedByName and lastArchivedAt are written from the authenticated actor and retained across restoration. Historical blanks are not guessed.
