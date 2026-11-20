# System maintenance — November 20, 2026

Dan requested current improvements be posted and obsolete material removed.
Scope: this core backend and the connected publishing platform; this is not a
claim that every portfolio application or user workflow has passed acceptance.

## Consolidated source

The production citation repair (`5007284`) and the service-forecaster read
acceptance note (`7598413`) are included in this baseline. The platform companion
change preserves the deployed personal-finance restoration, Decision Desk,
scanner preflight/timing policy, advisory Sarah-contact guidance and previously
released service-planner operations. Do not deploy older branches over this work.

## Dependencies and build hygiene

Remove 5,324 generated `node_modules` files from Git. The lockfile remains the
dependency authority; `npm ci` recreates dependencies. Existing local output
artifacts are ignored and preserved, not deleted. Docker now also excludes local
dependencies, private environment/key files and temporary output, preventing
`COPY . .` from replacing container-installed dependencies.

Move the core image from unsupported Node 20 to Node 22, matching CI and the
existing platform/worker runtime. Update Google clients and sharp to supported
versions and refresh compatible packages. A scoped `pptxgenjs` override resolves
its unused vulnerable `image-size` dependency to 2.1.x; PPTX generation with an
embedded PNG was verified with exact image bytes and slide XML. No data schema,
credential, OAuth identity, permissions or owning-system changes.

Validation: 1,014 core and 267 companion-platform tests pass on Node 22; repository
configuration checks pass. `npm audit` reports zero vulnerabilities for the core,
maintenance worker and platform lockfiles at this observation. This is a point-in-time
dependency report, not a security guarantee. Deployments and live readback must
be recorded separately below or in linked immutable engineering evidence.

Runtime reference: https://nodejs.org/en/about/previous-releases

## Preserved open gates

- Delegation PR #10 remains a draft pending its documented intended-user gate.
- Scanner control remains paused in the last owning-system evidence; changing
  source does not resume the existing automation or prove scheduled delivery.
- Fresh installed-client discovery and actual workflow acceptance remain
  distinct from backend, SDK and deployment verification.
- Historical decisions and release receipts remain as audit/rollback history.
- Golf dashboard PR in the platform repository is outside this core release.

Production release receipts and cleanup observations will be linked after live
verification. Retain prior production revisions and images for rollback.
