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

## Production verification and cleanup

Core PR #11 and platform PR #8 merged after successful GitHub checks. Runtime
commits are `9ae625f19b6f3577926ce0e0c3f7fdc07df46c95` (core and worker) and
`aa11a4344a85fd2d8f4a31c454383dd8eb2d38f2` (three gateways).

All five services serve 100% on their `<service>-maint-1120` revisions:
`bhe-product-api`, `dan-life-os-mcp`, `fbc-staff-tools-mcp-entra-prod`,
`dan-developer-tools-mcp`, and `fbc-maintenance-messaging-worker`.
Independent Cloud Run readback verified ready revision, source label, traffic,
and unchanged runtime configuration excluding the image. Canonical HTTPS health
checks passed for each service. No workflow message was sent by verification.

Twelve candidate HTTP checks passed, including authenticated current context,
completed recovery receipt, finance settings, Decision Desk, appointment policy,
catalogs, unrelated-actor denial and unauthenticated denial. Two fresh local SDK
sessions against both candidate and production confirmed finance discovery,
settings and read-only forecast without version changes. Connected Life OS read
current context v25. The three connected gateways returned identical ministry
guidance and directory hashes; FBC exposed the forecast operation in its catalog.
These checks do not establish fresh conversational acceptance of every workflow.

An initial promotion check encountered a local Python certificate-store error
and automatically restored the prior core revision. Curl with normal OS trust
verified HTTPS, and the subsequent promotion and readback passed. TLS verification
was never disabled. Prior production revisions and images remain for rollback.

Cleanup removed 25 fully merged remote branches, 17 unattached merged local
branches and 12 stale worktree registrations. Existing worktrees with files were
preserved. Retired 59 historical review URLs and five temporary maintenance URLs;
normal production traffic remained unchanged. No outgoing runtime configuration
referenced tagged service endpoints; existing allow-host settings were preserved.

Three local Codex packages were updated and independently compared byte-for-byte:
Life OS 1.0.22, FBC Staff Tools and Developer Tools 0.1.0+codex.20261120124500.
ChatGPT workspace package publication is not verified: browser access host was
unavailable and computer use refused access to the ChatGPT application. The same
control limitation prevents resuming the existing scanner. No automation file
was edited and no replacement timer was created.

Sanitized receipts and rollback tag mappings are in
`system-maintenance-20261120/`. Registry evidence:
`system-maintenance-live-20261120`; remaining workstream:
`system-maintenance-20261120`.
