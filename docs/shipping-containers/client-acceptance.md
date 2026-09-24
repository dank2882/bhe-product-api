# Shipping Containers: signed-in acceptance

Run from a freshly refreshed FBC Staff Tools connection under Dan's individual
identity. Do not substitute a service API key, Cloud IAM administrator migration,
public tool discovery, or an invented actor header for this test.

## September 24 Chrome verification update

Dan provided the actual workspace plugin URL. Its refreshed catalog contained
Shipping, but the three individual switches were off. Enabled only those three,
saved, reloaded and independently verified them on. The existing listing was
also updated in place to package version 1.0.1 with all eleven maintained skills;
the saved download matched every submitted file byte. No second app was created.

A fresh signed-in ChatGPT Work conversation returned both proposal records and
their schedule/readiness gaps using the selected FBC plugin:
https://chatgpt.com/c/WEB:a69faf7f-c468-49c6-a26a-b4edf16ec20f

Isabela returned `ship-93dada3e66634e0fcb1b25df4394`, need-by January 25, 2027;
Bicol returned `ship-e0c120b99a73672e5c3320d9fc48`, January 22–25 conference and
no confirmed need-by. Both remained unbooked proposals with missing parties,
route, quote/funding confirmations and the four Philippines documents.

This passes the fresh ChatGPT read experience; it does not establish a raw OAuth
subject, mutation/idempotency, original-file upload/download, denial or phone
acceptance. Those tests below remain open. Developer Tools registry actions remain
unavailable in this Codex session. The full packaging/evidence receipt is in the
platform repository, `docs/fbc-chatgpt-in-place-update-2026-09-24.md`.

The prerequisite narrative below records the earlier state before this update.

## Connection publication prerequisite

A fresh Codex task on September 24 still lacked the Shipping and Developer Tools
actions. Starting another task without correcting the exposed actions is not a
remediation. A subsequent direct server discovery returned 109 FBC tools including
all three Shipping tools, and four Developer Tools actions, each advertising its
existing external access_as_user scope. This establishes a server/client catalog
mismatch; the workspace's saved Actions panel still requires direct inspection.

For the workspace-managed FBC connection, Dan confirmed the current path on
September 24: **Apps → FBC Staff Tools Production v2 → Tools → See details →
Refresh**. His screenshot showed 106 saved tools; direct discovery returned 109.
He reports completing Refresh. No top-level Actions button was visible, so do
not keep prescribing the older Actions / Action control path. Inspect the tool
details and confirm shipping_list_operations, shipping_run_query and
shipping_run_command are present, preserving unrelated settings and role access.
Do not broaden staff access. Refresh is user-reported; this conversation still
does not expose those actions, so signed-in acceptance remains unverified.

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
