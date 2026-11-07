# Private finance assets — November 6, 2026 Pacific

Dan explicitly approved adding asset records and continuing budget preparation.
Implementation: `3ef063e`; production `bhe-product-api-pf-1106d`, 100% traffic.
Catalog 1.2.0; cash engine unchanged at 1.1.0. No gateway, identity, scope,
database or service additions. Existing runtime specification and prior traffic
tags independently compared and preserved.

Noncash assets use existing owner-only record operations, global versions,
idempotent receipts and append-only history. Estimated values require dates;
unknown values stay null. Debt status never settles a loan. No asset value enters
cashflow or reserve calculations. Financial contents stay out of Git/registry.

Verification: 947 backend tests and repository checks passed. Focused tests cover
unknown/invalid valuations, history, retry/conflict, owner/delegate denial and
identical cash forecasts. Candidate and production live checks passed for catalog,
authorization, brokerage compatibility and cash projections. Two fresh local MCP
SDK clients read the live backend. Actual user-approved asset records and an
inactive budget proposal were saved and independently read back. An initial
verification assertion was corrected to account for normalized null category
fields; no writes were repeated. Budget source coverage remains incomplete.

Rollback is pf-1106c: asset collection remains intact but is not surfaced by that
version; cash semantics remain compatible. No destructive rollback required.
Installed-client tool-cache discovery and full household forecast/affordability
acceptance remain open. SDK checks are not proof of installed OAuth refresh.
