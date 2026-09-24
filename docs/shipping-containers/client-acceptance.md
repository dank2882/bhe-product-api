# Shipping Containers: signed-in acceptance

Run from a freshly refreshed FBC Staff Tools connection under Dan's individual
identity. Do not substitute a service API key, Cloud IAM administrator migration,
public tool discovery, or an invented actor header for this test.

## Connection publication prerequisite

A fresh Codex task on September 24 still lacked the Shipping and Developer Tools
actions. Starting another task without correcting the exposed actions is not a
remediation. A subsequent direct server discovery returned 109 FBC tools including
all three Shipping tools, and four Developer Tools actions, each advertising its
existing external access_as_user scope. This establishes a server/client catalog
mismatch; the workspace's saved Actions panel still requires direct inspection.

For the workspace-managed FBC connection, open Workspace apps
(https://chatgpt.com/admin/ca), select FBC Staff Tools Production v2, and inspect
Actions / Action control. Refresh the catalog where offered, enable only
shipping_list_operations, shipping_run_query and shipping_run_command, and save.
Reload the panel and independently confirm those three remain enabled, preserving
unrelated action settings and existing role access. Do not broaden staff access.

For Dan's Developer Tools, inspect its intended Codex connection separately. It
must expose developer_get_context, developer_list_operations,
developer_run_query and developer_run_command. Do not add it to general FBC staff
access. Developer-mode connections support metadata Refresh; published plugins
have a separate review/publication flow. If the connection type or controls are
unclear, inspect the actual panel before prescribing reconnect or reinstall.

Only after the saved exposure is confirmed should a new intended-client session
run the acceptance steps below. Do not treat directory search, generic plugin
permissions, successful release-status reads, or public server discovery as proof
that these actions are callable under Dan's identity.

Official guidance:
- https://learn.chatgpt.com/docs/enterprise/apps-and-connectors#step-2-manage-capabilities
- https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata

## Signed-in checks

1. Confirm shipping_list_operations, shipping_run_query and shipping_run_command
   are callable. Read catalog 1.1.0 (or newer); it must include createDocumentUpload
   and finalizeDocumentUpload.
2. listShipments, then getSchedule with recordKind proposal. Follow cursors.
   Retrieve Isabela/Manila and Bicol by their returned IDs. Isabela's need-by is
   January 25, 2027. Bicol's notes preserve Dan's January 22-25 conference window;
   the exact pre-conference in-hand date remains unconfirmed.
3. getReadiness and getDocumentChecklist for both plans. Display missing parties,
   route, current quote/funding and the four Philippines documents. Do not mark
   checks confirmed without evidence or infer a booking from a planned date.
4. Run one authorized durable edit with current expectedVersion and a stable
   idempotency key; read back current shipment and the returned revision. An
   identical replay must return the original receipt without a duplicate write.
   For a synthetic two-container create/update test, label it clearly as an
   acceptance test and cancel it afterward with the same test source. Never
   turn synthetic content into a real shipping commitment.
5. Retrieve the Baguio 2025 record (BL 10864403) and its restricted original broker
   PDF using getDocument; confirm authorized download. Do not log the signed URL.
6. Exercise createDocumentUpload for a specifically authorized original file:
   compute exact bytes/SHA-256, create intent, PUT original using returned headers,
   finalize at unchanged version, retrieve document and compare hash. Do not copy
   megabytes of base64 into the chat. Save only metadata and receipts, not URLs.
7. Permission-denial unit tests cover other identities and restricted scope. A
   real other-user denial test is separate; never fabricate another user's token.
8. Record the actual client surface, intended identity verification, operation
   receipts, results and outstanding limitations. Phone acceptance is separate.

Developer Tools registry reconciliation is also pending. Use its authenticated
controlled operations to record linked deployment/test evidence and the Shipping
workstream. Preserve other FBC modules' release history and pending gates. Do not
claim the global registry is current merely because a Git release note exists.
