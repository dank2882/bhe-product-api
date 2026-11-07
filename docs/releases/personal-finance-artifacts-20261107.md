# Private finance durable reviews — November 7, 2026

Dan requested all finance information be retained in Google Cloud. Core financial
records were already in Firestore; source-review holds, decisions, reports and
illustrative calculation inputs were local. The existing private domain now owns
immutable artifacts with explicit provisional/reviewed/historical status, source
and snapshot version, bounded content and a server-computed SHA-256.

Implementation: core `17e753b` (release source `4ae7ad7`), gateway `960dcd9`.
Production: `bhe-product-api-pf-1107a` and `dan-life-os-mcp-pf-1107a`, both 100%.
Catalog 1.3.0; cash engine remains 1.1.0. Existing runtime configuration and all
prior traffic tags were independently compared and preserved. No new service,
database, OAuth application, sharing grant, source-system write or Staff Tools
deployment. The gateway still exposes exactly three personal-finance tools.

Before release, the current production archive differed from the finance checkout
only in `lib/life-context-vertex.js`. Its already-deployed v8 prompt was preserved
in `d276e69`; the version assertion was aligned in `4ae7ad7`. Source archive:
`gs://run-sources-location-map-985-us-west1/services/bhe-product-api/1794070663.741036-557c9758a06c4620bfc18deaf1a15b39.zip#1794070664411940`.
This release does not change collection scheduling or inference policy.

950 backend and 257 gateway tests passed, along with repository checks. Tests
cover exact-owner denial, immutable identities, content bounds, hash integrity,
retry/version behavior, stable metadata pagination and cash-engine isolation.
Candidate checks denied staff/delegate reads and writes and compared cash output
with production. Authorized archive records were independently read back and
hashed; the identical retry returned its prior receipt. A transient failed write
was retried with the original intent/key and independently verified; no duplicate
record or claimed infrastructure fix. Core records/settings and cash output were
unchanged. Reconstruction using archived inputs reproduced the reviewed monthly,
daily, event and gap outputs exactly.

Two fresh local MCP SDK sessions retrieved the cloud manifest through Life OS
tools against the production core API. This is not installed-client tool-cache or
OAuth-refresh acceptance. Current documents and held observations remain private
operational content in Firestore, never in Git or the engineering registry.
The manifest distinguishes the current provisional review from historical reports
and links source holds, decisions, input chunks and the calculation method.

Rollback: core `bhe-product-api-lc-daily-1107a`, gateway
`dan-life-os-mcp-pf-1106a`; older versions ignore the artifact collection without
deleting data or changing cash semantics. Complete household coverage,
reconciliation and affirmative affordability acceptance remain unresolved.
