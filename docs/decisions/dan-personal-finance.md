# Personal Finance Forecast — first version

Accepted by Dan November 6, 2026 with the explicit instruction to implement the
complete proposed plan. Registry decision: `dan-personal-finance-20261106`.
Owner and serves: `dan`. The registry's existing platform-system link identifies
reused infrastructure, not financial ownership or permission for FBC staff.

## Boundaries and contracts

Use existing core API, Firestore and Life OS; no new service, database, OAuth
application or automatic collector. YNAB owns the working budget. Banks retain
authority for their reported financial activity. The module owns imported
observations, reconciliation, budget proposals and forecast assumptions.

`/personal-finance/operations`, `/personal-finance/query` and
`/personal-finance/command` use the existing authenticated actor path. Every
operation requires the exact configured primary Dan subject. Delegates, staff,
admins and owner aliases do not confer access. The collection is not in the
generic operator-data allowlist. Logs expose only request ID and fixed error code.
The gateway publishes only `personal_finance_*` in Life OS, using its existing
scope. No tools are added to Staff Tools.

`danPersonalFinance/workspace` stores version/settings metadata. Individual
documents live in accounts, transactions, balances, budgets, schedules, scenarios
and imports. Append-only history stores financial revisions; command receipts
bind exact actor, intent and idempotency key. A global metadata version serializes
changes while coherent Firestore transactions bind reads to a workspace version.
Reads scan bounded collections (20,000 records per type); overflow fails explicitly
rather than producing partial reports. This deliberate household-scale bound
must be revisited before capacity is reached. No source records are deleted.

The live catalog documents all fields, required/optional arguments and operations.
Imports use normalized USD integer cents, immutable source IDs, observation dates,
and preview hashes bound to current version and exact input. Batches are at most
100 transactions and 20 budgets, bounded below Firestore document/write limits.
Chrome and exports supply reviewed data; format normalization must reconcile
export row counts and totals. No bank/YNAB credentials enter records or Git.

## Calculation and reconciliation

Credit balances owed are negative. Transfers/card payments have two linked legs
and do not count as category expenses. Refunds are positive expense-kind entries.
YNAB categories can enrich matched bank events, never duplicate them. Potential
duplicates require explicit matching or confirmation of a distinct event;
source disagreement blocks an import. Source observations and revisions survive.

Checkpoints explicitly mark every earlier imported movement included/excluded.
Corrections invalidate affected checkpoints by fingerprint. Pending movements
remain distinct and require reconciliation after posting. Actual movements link
to exact schedule occurrences, with partial settlements reducing remaining plans.

Forecasts run for twelve rolling months from today's Pacific date. Daily detail
is available for ninety days; monthly/account summaries are default. Expenses
precede receipts on a date; remaining category spending occurs at month start.
Boundary months use the full remaining monthly allowance conservatively. Savings
are spendable only when explicitly included. Budget allocations are not expenses;
explicit proposed planned spending supplies category ceilings. Actual/pending
spending and scheduled expenses reduce the remaining allowance.

Missing reserve (including failure to explicitly select zero), missing/stale
balances, unknown amounts/dates, overdue unmatched occurrences, unpaired transfers,
unreconciled movements and incomplete confirmed coverage produce `unresolved`.
Conditional numbers remain visible, never an affirmative affordability claim.
Balances older than seven days or coverage confirmations older than thirty days
require refresh. Known account overdrafts and reserve breaches are reported even
when other gaps exist. `within_plan` is not payment/spending approval.

Interest, fees and debt payment dates/amounts must be explicit schedules. There is
no inferred loan amortization, FX, bank execution, YNAB write, automatic import,
dashboard or sharing. Scenarios add planned movements and optionally substitute a
proposed budget; queries never save. Forecast responses include workspace and
engine versions; history retains inputs for investigating a prior result.

## Release and acceptance

Before this release, deployed source differed from the primary checkout. Preserve
the actual production baseline from the Cloud Run source archives, in separate
commits, before adding finance. Core source archive:
`gs://run-sources-location-map-985-us-west1/services/bhe-product-api/1793718574.681401-6ca18f2885d147a386dd5265c372b8dd.zip#1793718575354497`.
This includes already-live Life Context guards and ministry service forecasting;
the finance release neither activates nor changes them. Preserve runtime settings,
including the paused collection policy. Baseline rollback revision is
`bhe-product-api-00366-q7c`; gateway rollback is `dan-life-os-mcp-sarah-1103a`.
Preserve all unrelated traffic tags.

Technical gates: financial edge cases, exact-owner allow/deny, conflict/retry
behavior, independent readback, source-baseline comparison, full suites/checks,
committed candidate deployment and fresh SDK discovery against live owning API.
Initialize only a zero-row technical import receipt for write verification;
never invent financial records. Actual Chrome/source collection, account
reconciliation, installed-client discovery and one real affordability decision
remain distinct acceptance gates. Release evidence is recorded separately.
