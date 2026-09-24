# Country cost planning — September 24, 2026

Dan requested estimated shipping costs by country inside the container module.
This extends the existing FBC-owned Shipping domain and its existing authenticated
tools. No additional app, plugin, endpoint or OAuth registration is introduced.

The first slice provides reusable, versioned country/route/container budget sheets,
low/expected/high line amounts, missing-cost checklists, source invoice references,
currency-specific totals, refundable deposits and separate delay-risk costs.
Catalog version is 1.2.0. The existing shipment invoice/payment ledger and booking
readiness remain independent of planning estimates.

Initial research found nine destination countries in the saved non-canceled
shipment records. Philippines and Honduras have itemized invoices; Peru has a
reimbursement. Other destinations need sourced costs. Initial sheets must be
drafts with partial coverage and current quotes still needed. Historical dates,
counts and scope must remain explicit; no historical amount is advertised as a
current country shipping rate. Nicaragua's source route label includes Honduras;
the country sheet may say Nicaragua via Honduras without changing the shipment.

Validation covers owner/scope denial, concurrent versions, replay conflicts,
immutable revisions, filtered pagination, unknown and mixed-currency amounts,
overflow, deposits, delay risk, source matching, excluded sublines, reimbursement
separation and quote expiry. Backend checks and all 680 tests passed.

Implementation `8328a34` is deployed as `bhe-product-api-00295-n5m` at 100%
traffic. Previous revision was `bhe-product-api-00294-67g`; all existing tags
remain. Gateway `fbc-staff-tools-mcp-entra-prod-00054-7qk` remains at 100%.
The signed-in installed Shipping tools returned catalog 1.2.0 and verified
creation and independent read-back of nine country drafts, a versioned update,
and idempotent replay. Philippines is version 2; the other eight are version 1.
All nine explicitly remain partial budgets requiring current pricing.

Developer Tools workstream `fbc-shipping-country-cost-planning` was read back as
completed at version 2. Separate immutable tests, deployment and Codex acceptance
evidence were saved and read back. The original Shipping workstream and unrelated
Maintenance workstream were preserved. See `country-cost-acceptance-2026-09-24.json`
for secret-free receipts. This does not claim new ChatGPT UI, phone or real
other-user acceptance; automated owner/scope denial checks passed.

Rollback: route core traffic to the pre-deployment revision, preserving traffic
tags and durable `fbcShippingCountryEstimates`, `fbcShippingCountryEstimateRevisions`,
receipts and audit. Earlier code does not read or mutate these new records.
