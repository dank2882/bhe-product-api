# Ministry Finance Forecast: practical first release

Accepted October 2, 2026. Dan explicitly requested implementation of the full
Practical First Release plan. Registry decision `dan-finance-forecast-20261002`.

## Ownership and reuse

Dan-owned private planning records serve Dan's work for FBC, GO Missions and BHE.
Every fund and finance plan has a distinct organization. Existing Ministry
Overview and Task Management retain identity; official accounting retains actual
financial authority. Sources and exact reports are preserved as planning evidence,
not promoted to independent accounting verification.

Use existing core API, Firestore and Life OS gateway; no new cloud service,
OAuth registration, credential, database or autonomous process. Storage:
`danFinanceForecast/workspace` with append-only `history` and idempotent `commands`
subcollections. The small workspace is atomic across fund/advance legs and uses
one global optimistic version, avoiding partly applied financial relationships.
It is bounded at 650 KB and 1,000 records per type; exceedance is explicit, never
partial coverage. Revisit storage granularity only when actual usage requires it.

Exact authenticated primary Dan subject required at every operation. The broader
private delegation helper intentionally does not apply. Staff/editor/admin roles,
subject aliases and delegation do not grant access. Finance tools are registered
only in Life OS, not Staff Tools. Logs carry request ID and error code only.

## Contracts and calculation rules

`GET /finance-forecast/operations`; `POST /finance-forecast/query` and `/command`.
Life OS exposes finance_forecast_list_operations, finance_forecast_run_query and
finance_forecast_run_command. Catalog defines nested arguments and operation
modes. Commands require current workspace expectedVersion, stable idempotencyKey,
transactional receipt and independent exact-record readback. No payments,
communications, tasks, prayer records or approvals are dispatched.

Funds own dated balance checkpoints, explicit permitted plan links, outstanding
internal allocations, donor restrictions and optional cushions. Plans link an
existing ministry or task project; linking does not activate a provisional record.
Organization cannot be silently reassigned. Cash-backed, accounting-balance and
budget-allowance inputs stay distinct. Reported and confirmed sources stay distinct.

Items own exact wording, source, timing, amount and intent. Income may be possible,
committed or withdrawn; costs expected, committed, proposed or cancelled.
Append-only settlements derive partial/full received/paid state. Correction voids
retain evidence. Cost estimates transition using the same identity. An aggregate
expected cost can name included committed item IDs; its total includes their
original amounts, and only the residual is counted beyond those commitments.
Covered items cannot overlap two aggregate estimates. Payments to the residual
cannot exceed that residual. Monthly recurring cost schedules are explicitly
bounded (maximum five years) and settlements bind an exact occurrence.

Cash checkpoints require explicit included/excluded treatment for recorded
movements on/before their date. Missing treatments make usable cash unresolved.
Later movements are added once. Corrections can invalidate checkpoints. A new
balance never settles an obligation or promise. Checkpoint effective dates and
source confirmation dates are never changed by reads.

Forecasts use today's Pacific date and a rolling 12 months, calculate individual
movements before weekly/monthly aggregation, and retain unscheduled and overdue
exposure. Costs precede receipts on the same day as a labelled conservative
assumption. Windows use latest receipt/earliest expense; relative dates retain
planned/actual anchor evidence. Overdue gifts require reassessment and do not
support future cash. Available, expected and potential views distinguish funding
certainty; committed plus expected costs form the operating forecast. Optional
proposals require a scenario. Temporary scenarios are never persisted.

Shared cash counts once. Allocation and cushion reservation are separate from
cashflow expenses. Unallocated cash and uncommitted cash are different measures;
clients must not subtract the same commitment twice. Organization totals do not
make funds interchangeable or prove whole-organization capacity. Funding need
excludes financing; net actual principal transfers are removed from funding
resources. Internal advances project linked legs and require repayment source,
timing and lender coverage. Restricted funds need explicit confirmed permitted
advance use. Actual repayments cannot exceed principal advanced by that date.

External vendor financing does not require a synthetic lender fund: preserve the
lender and terms on the remaining repayment cost, separately from the upfront
cash cost. No cash receipt is invented for direct vendor credit. Unknown interest,
fees and schedules remain coverage gaps. No full loan-servicing workflow.

## Light review and non-goals

Requested weekly/monthly planning reviews retrieve finance attention for Dan
only. Review defaults to five funds plus counts/pagination and 25 history changes
with continuation. Completion saves a history watermark, not financial source
confirmation. Monthly cash refresh is default. Inactive fund display state never
silently removes obligations. No snapshot archive, historical forecast rebuild,
matching engine, bank/accounting integration, FX, tax receipts or staff access.

## Verification gates

- Focused financial and permission tests; backend/gateway suites and checks.
- Committed candidate deploy, live exact-owner read/write/readback, denial,
  current version/retry behavior and safe rollback to captured revisions.
- Fresh SDK tool discovery with live owning backend; separate ChatGPT discovery
  and installed instruction publication evidence.
- Dan-selected actual pilot and a real decision; five-minute weekly usability
  target remains human acceptance, never inferred from synthetic tests.

Dan supplied three pilot cases during implementation. Their exact facts and
figures belong in the private live records, not this Git document. They do not
establish shared availability between the two FBC projects. Shared-fund behavior
is tested synthetically until an actual shared pool is confirmed.

Pre-release rollback: core `bhe-product-api-00337-yap`; Life OS
`dan-life-os-mcp-00040-xam`. Preserve every existing traffic tag, runtime identity,
secret reference and environment. No staff gateway rollout is needed.

## Release evidence — October 2, 2026 Pacific

Implementation commits: core `1b9e51d`, platform `d0b2d1f`. Production revisions
`bhe-product-api-00339-tef` and `dan-life-os-mcp-00042-raf` independently observed
Ready and serving 100% traffic. Existing environment, secret references, runtime
identities and traffic tags retained. Full suites: 806 core and 218 platform tests
passed; both repository checks passed.

Authenticated live verification allowed the exact owner and denied an unrelated
admin with an injected owner alias on catalog, query and command. Three selected
pilot plans, three funds and five items plus a cash checkpoint were independently
read back at workspace version 12. A delayed-income what-if retained the saved
date and workspace version. Unknown costs, cash sources and schedules remain
explicit. Private source figures and receipts are excluded from Git.

Two fresh SDK clients discovered the finance tools and independently read the
same live fund. The existing ChatGPT connection was refreshed and a fresh normal
chat retrieved all three plans through live finance tools on October 2. Its
read-only answer separated cash, possible income and vendor principal. A later
API read confirmed version 12 unchanged. This verifies current authenticated
client access, not a new OAuth lifecycle claim or human usability acceptance.

Maintained/local Life OS instructions are version 1.0.11. Existing ChatGPT listing
retains its original app binding and is version 1.0.9. ChatGPT Refresh tools reset
listing metadata to defaults; the exact verified package was uploaded again
after refresh, and the restored listing independently showed 1.0.9. Source package
SHA256: `aced629c5a005472d9085d344d930eed1a2ddf13a17df5af004292de92ac46b5`.

Implementation and technical verification are complete. Dan's real decision and
roughly five-minute weekly-update acceptance remain open. Do not mark the pilot
accepted from automated tests or the agent-operated fresh chat. Continue with
the missing pilot facts and Dan's normal workflow; do not enlarge scope yet.
