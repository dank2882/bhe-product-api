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
separation and quote expiry. Deployment and authenticated acceptance evidence
will be recorded separately after those checks complete.

Rollback: route core traffic to the pre-deployment revision, preserving traffic
tags and durable `fbcShippingCountryEstimates`, `fbcShippingCountryEstimateRevisions`,
receipts and audit. Earlier code does not read or mutate these new records.
