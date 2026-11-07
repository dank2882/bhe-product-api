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

## Accepted brokerage extension — November 6, 2026

Dan explicitly approved adding brokerage import during source onboarding.
Reuse the same accounts, immutable balances, import previews and receipts. New
brokerage accounts are always excluded from spendable cash. Balance amount is
observed total account value; optional separately dated details preserve cash,
securities value, settled funds and cash available to withdraw. Unknown details
remain null. Borrowing power is not cash. Do not assume date equality between a
summary and its detail panel, or infer withdrawal availability from account value.

The existing import input accepts bounded brokerage accounts and balances,
including atomic account creation. Duplicate observations are unchanged;
conflicting immutable IDs block commit. Reports return brokerage observations
separately from cash projections. This extension imports balance snapshots only;
trade/lot accounting, investment-return assumptions and brokerage cash movement
projections remain unsupported and are rejected. Checking transfers still need
reconciliation, never relabeling as income. This is an additive schema change,
with no authentication, database, service or gateway changes.

## Accepted noncash assets extension — November 6, 2026

Dan explicitly requested asset records and continued budget preparation. Reuse
the private workspace with an assets collection, existing catalog and record
commands, exact-owner gate, global version checks, receipts and revision history.
Store owner-reported estimates with valuation dates and provenance; unknown
values remain null. Vehicle details preserve model year and observed mileage.
Debt status describes the asset only; debts remain separate loan accounts. Assets
never become cash accounts, collateral borrowing assumptions or forecast inflows.
No new infrastructure, authentication or source-system writes. Earlier revisions
ignore this additive collection; restoring them hides assets but preserves data
and does not change cash calculations. Do not represent that as full asset support.

## Durable source and forecast reviews — November 7, 2026

Dan explicitly requested that all finance information be retained in Google Cloud.
Core financial records were already durable, but unresolved source observations,
review reports and the local illustrative forecast assumptions were not. Extend
the existing domain with immutable `artifacts` documents, using the same exact
owner authorization, global version, command receipts and append-only history.
No new service, database, storage bucket, OAuth application or sharing boundary.

The catalog exposes save/get/list artifact operations through the existing three
Life OS tools. Artifacts contain bounded JSON, Markdown or text, a type, status,
source/date, based-on version and backend-computed SHA-256. Lists return metadata;
exact reads return content. They stay outside cash-engine state, so recording a
held source observation cannot duplicate spending or turn uncertainty into cash.
Manifests link versioned input chunks, assumptions, method and report. Revisions
use new immutable identities. Operational content never belongs in Git/registry.
Rollback hides artifact operations while preserving documents and cash behavior.

## Ranked purchase wish list — November 7, 2026

Dan explicitly requested a durable top-to-bottom purchase wish list for future
extra income. Extend the existing private finance workspace, not Task Management.
Individual wishlist records hold name, optional USD estimated cost, notes, source,
status and backend-assigned rank. Unknown prices remain null. New wanted items
append; explicit moves change ordering atomically. Deferred, purchased and dropped
items remain retrievable; restoring an item appends it. Maximum 200 total items.
Use listPersonalWishlist, savePersonalWish and movePersonalWish through the same
three Life OS tools, exact-owner gate, global version, audit and retry receipts.
No new infrastructure, auth, sharing, or automatic money movement. Wishes do not
reserve money, affect cash calculations or add coverage gaps; purchased status
does not import an expense. Testing affordability uses a separate, explicitly
requested scenario with known amount/date/account and existing reserve checks.
Older revisions ignore this additive collection and preserve its documents.
Implementation and live/client acceptance remain separately verified.

## Quarterly recurrence — November 7, 2026

Dan requested an existing purchase recur every three months. Add quarterly to
the existing schedule frequency enum; anchor calendar-month offsets to the original
start date and clamp short months without drifting subsequent dates. Existing
schedule identity is updated rather than adding a duplicate first occurrence.
Known occurrences consume their category allowance normally. Unknown frequencies
fail explicitly. No source payment, new infrastructure or permissions change.
Before rolling back to pre-quarterly engine versions, convert quarterly records
to equivalent bounded once occurrences or restore a compatible engine; older
engines do not understand the new frequency. Never send quarterly state to an
older cash engine.
