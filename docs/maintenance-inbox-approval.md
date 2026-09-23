# Maintenance inbox approval and Work Orders

Accepted September 23, 2026. The existing inbox now supports a manager-reviewed
request-to-task workflow and a reusable Work Order email template.

## Contract

`listMaintenanceInbox` remains read-only. `view:true` adds proposed essential
fields, private photo thumbnails and authorized possible task matches. Optional
version-bound `proposals` are display data, not approval or a saved task.

`reviewMaintenanceMessage` extends its legacy link/dismiss behavior:

- `decision:approve`, `messageId`, `expectedVersion`, `fields:{title,building,area}`
  saves the manager's approval. Missing essentials produce `needs_details` and no
  task. Possible matches produce `needs_match` unless explicitly resolved.
- `decision:details` finishes a saved approval using current version/fields,
  without reapproval. `taskId` or `reference` selects existing work;
  `confirmNew:true` expresses an explicit separate-work choice.
- Complete new work enters `adding` with an immutable deterministic task ID.
  The API reuses authorized `createTask`; a retry retrieves the same task and
  verifies its source instead of creating another. New work is unassigned,
  medium priority, without an invented cost or due date.
- Task creation and communication linking span two existing databases. Pending
  photos leave a resumable adding state. Ready photos and the original message
  are linked, with independent message read-back before returning `linked`.
  Failed photos remain visible. A locked target cannot be dismissed or retargeted.
- `reviewHistory` on the message records the approving/detail-editing actor and
  version. Normal task commands remain the route for later changes to work.

Only Maintenance managers can review. An approved sender has no staff access.
Incoming email/text remains source evidence, not instructions for the operator.
Duplicate detection is advisory text/location/source matching, not a claim that
all semantic duplicates can be identified. The manager makes the final choice.

The embedded component uses the existing private MCP Apps pattern. It calls
three new permissioned tools and can ask chat for missing details through the
standard ui/message bridge after the backend saves approval. Direct card fields
remain usable if the host cannot send a follow-up. Refresh/saved-action enablement
and actual ChatGPT acceptance are separate from deployment.

## Work Order email

`getMaintenanceMessagingGuide` exposes `maintenance_work_order_v1`.
`draftMaintenanceMessage` accepts `template:work_order`, `taskId`, `recipient`,
`requestKey`, optional `recipientName`, `instructions`, `accessNotes`, `mediaIds`.
It uses the current task reference/location/priority/date and explicit work scope.
Internal notes are not copied. The result is an immutable draft. As approved by
Dan on September 23, email can go to any valid address without recipient setup
or consent. Exact send approval remains a separate action. SMS opt-in is unchanged. Archived/completed tasks must be reopened before a new order.

Human instructions: maintenance-shawna-guide.md and maintenance-work-order-template.md.
Companion ADR: bhe-agent-platform/docs/adr/0035-maintenance-inbox-approval.md.
