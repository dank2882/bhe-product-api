# FBC Missions release — October 6, 2026

Implemented and deployed in the existing core, FBC Staff Tools and Life OS.
The approved source roster is imported in `ministry-fbc-missions`, roster
version 1. Every recipient, support record, source row and distribution link
was independently reread. Source text and operational financial details remain
in the owning backend, not Git. Registry decision: `fbc-missions-roster-20261006`.

## Behavior

FBC Missions owns recipients and monthly USD support commitments. Dan's exact
primary authenticated identity is required; staff roles, delegated aliases and
ordinary ministry grants do not expose the roster, its sources or its history.
GO Missions retains its original identity and was independently verified unchanged.
Group commitments count once; included allocations and breakdowns do not add
to the listed support total. Unknown amounts remain null and disputed amounts
retain clarification flags. No accounting, payment, forecast, task or message
writes occur during ingestion.

The existing Ministry Overview tools now offer list/search, exact recipient,
support summary, source/history retrieval, read-only import preview, atomic
import, and evidenced recipient/support edits. Writes require the roster version,
a stable idempotency key and exact preview hash for imports. New operations are
listed in runtime catalog 1.2.0. Existing ministry contracts remain compatible.

## Verification

- 828 core tests and 222 gateway tests pass; required configuration checks pass.
- Atomic failure, retry, stale version, changed-key rejection, partial-source
  recovery, immutable evidence, unknown amounts, group totals and pagination
  are covered. Staff/admin/alias denial is tested across every new operation.
- Candidate import and normal-production verification independently read all
  101 recipient/support records and original source bytes. Import replay returns
  its original receipt without a duplicate write; roster version remains 1.
- Two fresh MCP SDK clients, one for each gateway implementation, retrieved
  country-filtered records, listed support, clarifications and stable exact IDs.
- Both deployed gateway endpoints advertise the new operation enum and deny
  unauthenticated data reads with HTTP 401. Existing auth/configuration is unchanged.
- ChatGPT packages were updated in their existing listings and downloaded back:
  FBC 1.0.3 (38 files), Life OS 1.0.13 (13 files), every file byte-equal to its
  submission and existing app bindings preserved. Tool refresh again reset the
  package ZIPs to two-file shells; complete packages were restored after refresh.
- Local marketplace plugins were updated in place and all source files verified:
  Life OS 1.0.16 and FBC 0.1.0+codex.20261006155500. MCP configurations are byte-equal.

See `import-readback.json`, `production-readback.json`, `fresh-sdk.json`,
`gateway-discovery.json`, `chatgpt-packages.json` and `local-plugins.json`.
## Fresh ChatGPT acceptance — failed, release incomplete

The fresh FBC Staff Tools chat discovered catalog 1.2.0 and the FBC profile,
but its dispatcher rejected `getMissionSupportSummary` using the old operation
enum before reaching the backend. Refreshing workspace tools and downloading
the complete published packages did not prove updated client schemas. Do not
mark this decision verified or reset working OAuth connections to hide the gap.

The fresh Life OS chat returned a separate pre-existing Missions notebook
instead of the structured roster. Independent notebook read confirmed that
source predates this import and contains different transcription and correction
history. No amounts were changed from that secondary source: the approved
October 6 import remains intact. Reconcile the source conflict explicitly;
do not silently substitute notebook totals for the structured listed total.
Private operational discrepancies remain in the backend notebook, outside Git.

Next gates: resolve the ChatGPT dispatcher schema cache, rerun all three
requested queries through both installed clients, and ensure Life OS routes
roster questions to Ministry Overview while identifying conflicting notes.
Backend/SDK success is separate from these failed client checks.

## Release and rollback

Core runtime commit: `3deb433`; gateway runtime commit: `a642932`.
All three existing services serve their `-missions-1006a` revisions at 100%.
Independent deployment checks preserve runtime identities, exact environment
hashes and all pre-existing traffic tags. No new cloud infrastructure or grants.

Rollback is traffic-only to the revisions in `pre-release.json`:
- core: `bhe-product-api-00353-qob`;
- FBC gateway: `fbc-staff-tools-mcp-entra-prod-00071-foy`;
- Life OS gateway: `dan-life-os-mcp-00048-coj`.

Retain imported records on rollback; the old core simply does not expose the
new roster operations. Do not delete or reimport the source to simulate rollback.
ChatGPT package rollback uses retained baseline downloads, preserving the current
app bindings and enabled/disabled tools. Do not reset connections or auth settings.
