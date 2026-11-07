# Personal Finance technical release — November 6, 2026 Pacific

Backend implementation: `5888e49`; Life OS implementation: `786512d`.
Production revisions `bhe-product-api-pf-1106a` and
`dan-life-os-mcp-pf-1106a` are Ready and each serves 100% normal traffic.
Configuration fingerprints, service identities, existing environment/secret
references and prior traffic tags were independently verified unchanged.

Baseline preservation was necessary: the primary checkouts lacked some deployed
Life Context and ministry-service code. Exact production archives were recovered
and committed separately (`51a9a0e` core, `ec950df` platform); reference schemas
and test expectations were aligned. A final archive comparison found only the
intended new finance routes/tools and their routing metadata differed from live
runtime source. No Life Context collection or other background process was run.

Verification:

- 942 backend and 257 gateway tests passed; both repository checks passed.
- Review revision: live catalog, exact-owner read/write, unrelated-admin and
  configured-delegate denial despite owner-alias injection, preview immutability,
  version conflict, identical retry, and independent exact-record read-back passed.
- Write test created one zero-row technical import receipt, with no financial
  accounts, balances, transactions, budgets or schedules invented.
- Two fresh MCP SDK clients discovered three personal-finance tools and read the
  same live version; repeated against the normal backend after promotion.
- The existing user-authenticated Life OS routing tool returned Personal Finance
  as registered on the new production gateway. This open chat's cached tool list
  has not yet exposed the three new direct tool names. Local SDK discovery is not
  equivalent to refreshed user-client discovery or OAuth lifecycle verification.

Remaining acceptance: refresh/discover the installed client tool list; complete
supervised source imports and reconciliation; capture full income/bill/debt/budget
coverage; answer one actual affordability question. User financial preferences and
bank/YNAB observations belong only in the private backend, never this release log.
The source review has begun but no real bank/YNAB records have been imported.

Rollback: route core traffic to `bhe-product-api-00366-q7c` and gateway traffic to
`dan-life-os-mcp-sarah-1103a`, retaining existing tags. Rollback does not delete the
new private collection. No separate database/index migration is required.
