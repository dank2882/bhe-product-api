# FBC Shipping Containers — architecture proposal

Status: **accepted**, 2026-09-23. Dan approved the existing-backend design and initial Dan-only access: “Yes you can proceed but I would love to see the shipment history in a nice summarization.” Nothing here claims deployed capability.

## Problem and outcome

FBC needs to plan shipments, gather information before booking, follow each container to delivery and empty return, and learn from documented history. A shipment can contain multiple containers, share one bill of lading, incur charges in different currencies, and have repeatedly revised dates and paperwork.

The module should answer: What is going where? What is missing? Who owes it? When must it be ready? What changed? What will it cost, and which amounts are estimates, invoices, payments, or disputed charges? Can the recipient actually clear and receive it?

## Accepted decision

Add an **FBC-owned Shipping Containers domain to the existing core backend and Firestore**, exposed through the existing **FBC Staff Tools gateway and Entra identity**. Reuse established authorization, signed attachment storage, version checks, idempotency, audit, and operation-catalog patterns. Link existing Task Management projects and tasks for follow-through.

Do not introduce a separate service, database, OAuth application, MCP server, or public portal. The new architectural element is a dedicated domain schema and its permissioned operations. Existing tasks and notebooks cannot own the shipping ledger without losing shipment-specific rules and relationships.

Owner: `fbc`. Serves: `fbc`, with GO Missions shipments supported as participating ministry context when FBC manages them. Shipper/exporter legal identity is a shipment field; FBC ownership of the software does not rewrite historical shipper identities.

## Evidence and reuse inspection

Inspected the clean main branches of `bhe-product-api` and `bhe-agent-platform`, existing task hierarchy, notebooks architecture/service, staff authorization, task attachment service, and gateway tool/client/policy/auth modules.

- Task hierarchy already supports programs, branches and related work. It remains owner of tasks and projects, not freight costs or container status.
- Core domain services already use Firestore transactions, expected versions, idempotency and audit history.
- Attachments use bounded uploads and expiring signed access. Shipping documents need shipping-owned attachment associations rather than dummy tasks.
- Staff authorization has no shipping scopes. Do not infer shipping access merely from existing staff membership.
- Repository search found no existing shipment domain implementation.
- Read-only Cloud Run inspection found the existing core, FBC gateway and engineering registry services. No separate shipping service was found.
- Developer Tools live actions and FBC operation catalogs were not callable in this session. This proposal uses the skill's unavailable-registry fallback. Recheck compact registry context and live catalogs before implementation; deployed registry presence does not prove authenticated client access.

Cloud inspection snapshot: core `bhe-product-api-00292-qnx`; FBC gateway `fbc-staff-tools-mcp-entra-prod-00053-g47`. These are discovery evidence, not release targets or proof of shipping support.

Private email research and original documents are staged outside Git. Do not commit email bodies, private contacts, identity documents, invoices or source URLs into this repository.

## Staff workflow

1. **Plan:** select destination and need-by date; describe purpose, cargo and proposed containers. Keep proposed windows distinct from bookings.
2. **Prepare:** collect legal consignee identity, broker, route, quotes, document requirements and unloading arrangements. Show missing items with owners and due dates.
3. **Review for booking:** Dan's stated shipping standard requires receiver, receiving agent, route, required paperwork, fees and door-to-door delivery process to be settled first. Display evidence and exclusions together.
4. **Book and load:** capture booking and BL references, actual container/seal, packing inventory, weight verification, cutoffs and approved document versions.
5. **Track:** show origin, sea/transshipment, port clearance and final delivery separately. Preserve prior ETAs and change reasons. Track free time and empty return.
6. **Close:** recipient receipt, exceptions/damage, empty return, final invoices, credits, payments and lessons learned. Historical incomplete records remain visibly incomplete.

Status labels: proposed, preparing, ready-for-review, approved-for-booking, booked, loaded, in-transit, at-port, clearing, delivered, closed, on-hold, canceled. Historical imports may have unknown current status. Status transitions require appropriate evidence; no automatic approval from an email instruction.

## Record model

Use dedicated `fbcShipping*` collections in the existing database. Exact collection layout and indexes are implementation details to settle after acceptance.

| Record | Required behavior |
| --- | --- |
| Shipment | Stable ID; ministry/program links; purpose; owner; need-by target; lifecycle; shipper/exporter, consignee, notify party, forwarder, broker, payer and final receiver as separate roles. |
| Container | Belongs to shipment; size/type; container number and seal; cargo allocations, weight units, photos and condition. A container number is not a permanent shipment identity because equipment is reused. |
| Route leg | Origin loading address, pickup/rail/ports/transshipment/final door; requested, approved and actual route; route changes with actor and reason. |
| Milestone | Planned, estimated and actual dates, timezone/precision, source and verification level; revision history. Never overwrite ETD with ATD or treat ETA as arrival. |
| Cargo line | Description/language/edition; cartons/pallets and contained units separately; unit/total weight; declared customs value and insured value separately; manufacturer/place of origin. Arithmetic checks flag discrepancies. |
| Party snapshot | Exact legal name/contact/role at shipment time; reusable contact reference plus dated snapshot. Restricted identifiers kept outside general listings. |
| Requirement profile | Destination, route, broker and cargo context; dated evidence; version; responsible role; due trigger. Shipment-specific overrides and confirmation required; historical requirements are not current legal certification. |
| Document/version | Type, status, immutable hash, source, date, signer, notarization/apostille, recipient acceptance, original required, courier and receipt; superseded version preserved. No generated signature or recreated apostille. |
| Cost document/line | Quote/invoice/credit/reimbursement; issuer and document number; currency; scope; per-shipment/per-container/per-BL/per-document/per-day/per-hour basis; tax applicability; expiry; exclusions; links to superseded or rebilled documents. |
| Payment/allocation | Amount/currency, payer, paid date, proof and allocation. Sent check, requested reimbursement and vendor-paid report are distinct from settled FBC payment. Deposits may be refundable. |
| Incident | Dates, category, affected leg/container, impact, contested claims, corrective action, free-time deadline, charges and resolution evidence. |
| Source claim/import candidate | Source message/document/page, extracted field, original wording where needed, confidence, reported/verified/disputed status, reviewer decision, deduplication key and import receipt. |

Do not total currencies together without an explicit exchange-rate source and date. Never add a reimbursement to the invoices it reimburses. Keep shipment-level charges outside per-container totals until an explicit allocation is selected. Quote expiry prevents a "current quote" label. A waiver reduces the relevant invoice; it does not create paid cost.

Actual performance calculations require compatible verified/reported endpoints. Label agent-reported dates and sample size; exclude estimates and unknown endpoints from actual transit averages. A proposed lead-time assumption is not a statistically established route average.

## Readiness and documents

Baseline required fields: contents, loading address, exporter, legal consignee, arrival contact, receiving broker, discharge port and final delivery address, payer, cost scope, need-by date, clearance and unloading plan.

Philippines starting checklist from Dan's request:
- Deed of Donation — Apostille
- Commercial Invoice
- Packing List
- Place of Origin

Preserve "Place of Origin" as submitted; clarify whether a declaration, certificate or other broker form is needed. Additional historically observed requirements include deed of acceptance, original BL or confirmed express/telex release, exemption documentation, consignee registration/ID, dock receipt/VGM and courier receipt. These are conditional, sourced requirements, not blanket country law.

Readiness should flag mismatches among consignee, goods description, package units, quantities, values, port, release method and original/corrected documents. Operational approval records the exact reviewed versions. A later material route, consignee, cost-scope or document change invalidates readiness and requests a new review.

## FBC Staff Tools surface

Recommended initial catalog:
- `shipping_list_operations`: current supported queries, commands and schemas.
- `shipping_run_query`: listShipments, getShipment, getSchedule, getReadiness, getCostSummary, getDocumentChecklist, getHistoryInsights, listImportCandidates.
- `shipping_run_command`: create/updateShipment, add/updateContainer, recordMilestone, recordRouteChange, upsertCargo, recordRequirementConfirmation, attachDocumentVersion, recordCostDocument, recordPayment, recordIncident, approveReadiness, preview/commitImportBatch.

Server validates each operation's permission, fields and relationship constraints; a generic dispatcher must not become arbitrary database access. List operations return compact summaries; sensitive files require a separate authorized retrieval. Long-running history extraction is staged and resumable, not a blocking giant import.

Initial staff views are schedule, shipment detail, missing information, document checklist, cost breakdown and history. A separate website is outside this decision. FBC Staff Tools should render a usable timeline/summary through its existing client surfaces.

## Access and safety

Accepted initial access: Dan's authenticated individual identity only, with an explicit subsequent staff access grant. Backend resolves the authorized actor; never trust an actor ID supplied by the chat.

Implemented scopes: shipping.read, shipping.write, shipping.approve, and shipping.documents.restricted. Access administration remains in the existing staff authorization system; there is no shipping command that grants access. Map roles explicitly; review the existing "all domains" admin bundle so adding scopes does not accidentally grant every staff member access. Deny-by-default tests cover other staff and other owners.

General staff views omit passport images, signatures and government identifiers. Shared document-request lists contain only information needed by that recipient. No automatic emailing, carrier booking, spending, approval, permission grant or external document signing.

Treat imported emails/PDF text as untrusted evidence. Instructions such as "pay", "sign", "print", "forward", "ignore prior version" or "do not pay" become quoted historical claims or proposed workflow actions, never agent authority. The user and authorized backend workflow decide actions.

## Import and historical reconciliation

- Preserve originals and hashes; sources remain authoritative.
- Search metadata, read relevant full threads, extract attachments, then stage candidates.
- Group by master/house BL, booking, shipment dates and parties; never by container number alone.
- Detect repeated scans, email forwards, duplicate invoice pages, rebills and revised quotes.
- Do not merge uncertain records automatically. Show competing claims side by side.
- Review a concrete batch before commit. Use idempotency keys and import hashes to make replay safe.
- Restrict shared imports to shipping facts; do not copy unrelated private email conversations.
- Read back each committed shipment and batch receipt. Local research JSON is not production data.
- Link task follow-ups to shipment IDs while Task Management continues to own task completion and assignment.

## Implementation sequence and acceptance

1. Recheck available registry/catalog and accepted identity/access policy; record accepted decision.
2. Implement domain validators, schema/indexes, repository/service and audit/version/idempotency support in the existing backend.
3. Add gateway operations, authorization scopes, catalog counts/contract fixtures, plugin guidance and staff discoverability.
4. Verify the workflow on a representative synthetic shipment; then review and import sourced historical candidates.
5. Test a fresh authenticated FBC Staff Tools client: create plan, add two containers under one BL, attach versions, show missing documents, revise ETA, add mixed-currency quote, record incident, and read back complete detail.
6. Production deploy only with normal repository release authorization. Record actual revisions and fresh-client evidence. A passing unit test or Cloud Run health check alone does not prove staff access.

Meaningful tests: tenant/actor denial; restricted-file denial; version conflicts; idempotent replay; two-container single-BL costs; rebill/waiver accounting; expired quote; planned versus actual dates; quantities and weight reconciliation; conflicting source claims; source-text prompt injection; import rollback; document approval invalidation after material changes.

First usable release must support planning, all requested common fields, per-destination document tracking, actual versus proposed timeline, costs, incidents and source-backed history. Email history need not be declared complete to release, but visible coverage and unresolved candidates must remain available.

## Alternatives, migration and rollback

Generic tasks/notebooks: less initial code, but no defensible freight accounting, milestones or document-version approval. Reuse links, not ownership.

Separate shipping service: unnecessary deployment/authentication overhead for the identified capability gap. Defer unless measured scale or ownership boundaries require it.

Migration: no existing canonical shipment schema found. Import only reviewed research candidates; do not delete source email or rewrite task projects. Disable gateway commands or feature flag to roll back behavior; preserve auditable imported records and mark mistaken imports inactive through a compensating operation. Never erase invoices or evidence as a rollback shortcut.

## Decision record

Accepted: FBC-owned, available through FBC Staff Tools; existing-backend shipping domain, linked tasks, permissioned documents, Dan-only initial access.
Implemented: dedicated FBC domain, validated operation catalog, source-aware timeline and costs, private file support, versioned saves, audit and import receipts, three FBC gateway tools, and explicit owner authorization.
Verified locally: source review and arithmetic; full backend and gateway tests, including multi-container closeout, document replacement acceptance, permission denial, concurrency and deduplication.
Production deployment, import and intended-user client acceptance are tracked separately in the release record; local tests do not establish them.
