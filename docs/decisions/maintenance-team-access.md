# Maintenance team collaboration

Accepted by Dan on September 9, 2026: Dan owns Maintenance; Pastor Smith,
Schuyler McIlroy, Andy Lee and Shawna Blue have read/write/archive access;
members may delete only records they created.

Reuse Task Management projects, the Maintenance team ID, branch membership and
existing tasks.read/comment/write permissions. The Maintenance root is a church
project owned by Dan. Its four editor grants inherit through subprojects.
Existing private tasks retain their private access boundary.

A new root may opt into `collaborationPolicy: editor_archive_creator_delete`.
The outermost policy root governs descendants. Editors may edit, archive and
restore shared work. Only the area owner manages branch sharing and moves.
The policy cannot be changed through ordinary updates. Other branches retain
existing behavior. Staff roles and unrelated domain permissions are preserved.

Existing updateProject/updateTask commands accept a separate deletion intent:
`changes: {permanentlyDelete: true, confirmDelete: true}` with current
`expectedVersion`. Do not combine deletion with edits. Only the authenticated
record creator (including verified identity aliases) or the area owner may
delete, including when the caller has manager or administrator status. Archive
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
