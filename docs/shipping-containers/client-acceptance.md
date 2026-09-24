# Shipping Containers: signed-in acceptance

Run from a freshly refreshed FBC Staff Tools connection under Dan's individual
identity. Do not substitute a service API key, Cloud IAM administrator migration,
public tool discovery, or an invented actor header for this test.

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
