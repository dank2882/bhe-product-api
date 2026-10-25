# Shared Thoughts V1 release — October 25, 2026

Implemented, deployed, and service-boundary verified. Dan's fresh ChatGPT
read-only discovery passed. Sarah's own ChatGPT share/read/contribute acceptance
remains open; no claim of full two-account acceptance is made.

## Scope and code

Developer Tools was connected and consulted before changes. Reviewed the
engineering constitution, indexed Life OS/Think Tank/notebook/delegation ADRs,
instruction-authority rules, current source and live catalog. Relevant deployed
runtime files matched pre-change HEAD in both repositories, verified against
Cloud Build source archives. Existing broader Sarah delegation remains unchanged;
Shared Thoughts has its own explicit per-record permission boundary.

- Core implementation: `df62886`; live test evidence: `f601443`.
- Platform tool/guidance commits: `2eb1919`, `8fd60ba`.
- Reproducible MCP verification: platform `d2206d8`.
- Codex instruction-package release: platform `17fa531` (1.0.19).
- Design: [Shared Thoughts V1](decisions/shared-thoughts-v1.md).

## Verified release

| Service | Previous production revision | New revision | Traffic |
| --- | --- | --- | --- |
| Core | `bhe-product-api-00332-7t9` | `bhe-product-api-thoughts-1025a` | 100% |
| Life OS gateway | `dan-life-os-mcp-sermon-1017a` | `dan-life-os-mcp-thoughts-1025a` | 100% |

Both revisions are Ready; traffic was independently read back after promotion.
Existing Entra identities, scopes and endpoint are unchanged. The two
Shared Thoughts participant settings bind Dan and Sarah's existing exact
subjects; live gateway allowlist membership was independently verified.

850 core tests and 236 platform tests passed. Required checks and generated
guidance verification passed. Focused tests also passed after adding explicit
catalog approval metadata. Coverage includes private drafts, alias/admin denial,
approval gates, original wording, authenticated authorship, ordered contributions,
atomic failure, idempotency, stale versions, cursor isolation and revocation races.

The opt-in live fixture exercised prepare/read → approved share → Sarah
read/search → Sarah addition → Dan independent read/reply → Sarah history →
revocation. It verified unapproved sharing denial, stale-write rejection,
unrelated-admin denial, exact whitespace/Unicode, replay deduplication, and
post-revocation read/search/replay denial. The fixture is clearly labeled as
system verification, contains no personal thinking, and remains revoked.
See [saved live evidence](verification/shared-thoughts-live-20261025.json).
This used the authenticated internal service boundary with configured individual
actor subjects, not Sarah's independent OAuth session.

A fresh MCP SDK verified all seven operation schemas, approval instructions,
canonical task-domain guidance and authenticated backend workflow identity.
Connected Life OS catalog returned seven operations, catalog
`1-215924ea4221`, request `21c96563-84fe-4e33-a9c5-121cf2e09aab`.
Connected canonical guide returned `shared-thoughts` under task-management,
guidance hash `eb1795eae9d8fcc85bbc0e52417cdf26fb009b4b679fee83bf7ee397497bda8d`.

## Published instructions and client verification

Updated the existing ChatGPT plugin in place:
`plugin_asdk_app_6abe50f62c548191b49081448379e268`, 1.0.14 → 1.0.15.
Preserved its internal identity and app binding. Downloaded the saved ZIP and
compared all 16 files byte-for-byte to the upload. Package SHA-256:
`db10e2e4e5dea316fabf45fb4495357e3ca80ca0090c595f4424f9a363d7c202`.
The displayed skill includes Shared Thoughts and its reference. Refreshed the
existing app's tool schema; no connection replacement or credentials changed.

A fresh ordinary ChatGPT session requested live, read-only discovery in natural
language. It correctly retrieved one revoked test record, distinguished its
synthetic contributions from real personal wording, reported zero currently
shared thoughts, and explained attributed chronological collaboration.
Chat: https://chatgpt.com/c/6ade269c-a484-83e8-9f7c-4b0871dea31d
This verifies Dan's fresh read path and natural routing, not fresh sharing approval
or Sarah's account. Local screenshot evidence in platform `output/shared-thoughts/`:
`life-os-published.png` and `fresh-chat-verification.png`.

## Remaining account acceptance

From Dan's account, ask to share one harmless test thought with Sarah. Review the
original and summary, approve the exact draft, and verify read-back. In Sarah's
own signed-in account, ask what Dan shared, retrieve it, and add one exact test
sentence. Back in Dan's account ask what Sarah added, verify her exact wording
and authorship, reply, and revoke when finished. Verify Sarah cannot reopen or
add after revocation. Do not pretend an internal actor test proves these logins.

## Rollback

Restore the previous revision named above for each service with
`gcloud run services update-traffic SERVICE --to-revisions REVISION=100
--project location-map-985 --region us-west1`. Retain all thought records, audit
and receipts. Prior plugin download is `Downloads/plugin (32).zip`; the verified
new download is `Downloads/plugin (33).zip`. No user record migration or deletion
is required. Git commits are local; no unrelated existing backlog was pushed.
