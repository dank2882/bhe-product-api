# Personal Finance brokerage observations — November 6, 2026 Pacific

Dan approved the brokerage import extension and then approved its concrete source
preview. Financial contents and receipts remain only in the private finance
workspace, not this engineering record.

Implementation commits: `472c7bc`, `bea56a7`. Core production revision
`bhe-product-api-pf-1106c` is Ready and serves 100% normal traffic. The earlier
review build was superseded before promotion to include a brokerage-debt guard.
No gateway deployment, identity, scope, service or database changes were needed.
Runtime configuration and all prior traffic tags were compared independently and
preserved. The immediate rollback revision is `bhe-product-api-pf-1106a`.

Catalog/engine version 1.1.0 adds brokerage-only account/balance import arrays to
the existing preview/commit path. Account values and separately dated cash,
securities, settlement and cash-withdrawal details remain immutable observations.
They never contribute to usable cash or investment-return forecasts. Unknowns
stay null. Negative brokerage value or cash requires debt review. Unsupported
trade accounting, brokerage transfer projections and budget use fail explicitly.

Verification:

- 946 backend tests and repository checks passed, including duplicate imports,
  immutable conflicts, atomic account creation, missing/stale observations,
  scenario isolation and exclusion from reserves and cashflow.
- Live candidate and normal-production checks passed: versioned catalog, exact
  owner allow, unrelated-admin and delegate denial, read-only preview, and
  unchanged household cash projection. No synthetic financial records saved.
- Dan-approved source imports were committed with version checks and stable
  keys. Every saved record was independently read back; brokerage retry replay
  and subsequent duplicate preview passed. Before/after cash projections were
  identical. The incomplete household forecast remains unresolved.
- Two fresh local Life OS MCP SDK clients discovered the existing three finance
  tools and retrieved live settings/forecast. This is not proof of refreshed
  installed-client discovery or its OAuth lifecycle; that gate remains open.

Remaining household acceptance: source history, pending activity, debt and bill
timing, working-budget coverage, reconciliation, and a real affordability result.
Rollback preserves private data but the prior release does not understand
brokerage semantics: keep forecasting unavailable until 1.1-compatible code is
restored. Never serve the old forecast engine against brokerage records as though
it were equivalent. No destructive data rollback is authorized or required.
