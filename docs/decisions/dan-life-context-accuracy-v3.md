# Life Context accuracy follow-up, prompt v3

October 29, 2026. Status: implemented locally and offline-verified; not deployed or live-model accepted. Dan authorized the focused accuracy fix and fictional tests after the scheduled pilot identified event/date conflation and unsupported relationships/year inference. No production inference, budget increase, profile write or schedule activation is part of this change.

## Changes

The existing Vertex adapter uses prompt `life-context-observations-v3`. It keeps distinct events and their dates separate, prohibits invented relationships and inferred event years, preserves speaker attribution, and keeps a request with its reply without interpreting agreement as completion. Short fictional calibration examples demonstrate the intended behavior. No model, auth, store, tool or public request schema changes.

New generated observations must include one short exact supporting quote per cited source ID. The existing output normalizer rejects missing, duplicate, mismatched, fabricated, stitched or oversized quotes. It also rejects a four-digit 19xx/20xx year in an observation when that year is absent from its supporting quotes. Supporting quotes are used during validation and stripped from compact retrieval; raw evidence already belongs to the existing revision. Public observation shape and historical revision reads are unchanged.

The content reuse fingerprint now includes the prompt version. A new authorized run cannot silently reuse a v2 interpretation after the v3 upgrade; an exact replay still returns its immutable original receipt. The next generation remains subject to existing expected-version, budget and daily limits. Existing production interpretations are not rewritten by this code change.

## What the checks prove

Six new tests exercise exact-quote rejection, cross-source quote swapping, year leakage from timestamps/uncited adjacent evidence, failed-publication behavior, prompt-version-aware reuse, and synthetic adapter-to-store-to-selective-retrieval compatibility. They also explicitly document that exact quotation does not prove semantic entailment: a conflated event can still cite real text. No regex or second model is presented as a complete semantic verifier.

`test/fixtures/life-context-accuracy.json` contains fictional evidence, human-authored reference outputs and a semantic review rubric. The provider is stubbed in offline tests. Reference outputs are examples of intended behavior, not evidence of what the real model generated. The updated platform `scripts/demo-current-life-context.mjs` passes in default fully synthetic mode; no `--vertex` invocation was made.

Checks passed: backend check and all **924 tests**; platform check and all **254 tests**; synthetic MCP collection, receipt, selective retrieval and replay demonstration. Total **1,178 tests**. Real Vertex response-schema acceptance, exact-quotation generation reliability, output-budget sufficiency and semantic improvement remain live acceptance gates.

## Review examples (fictional, human-authored)

- A retreat proposed for June 2-4 and a separate celebration proposed for June 9 remain separate observations.
- A report about an injured person keeps that person's identity and relationship unspecified.
- A tentative January 12 workshop receives no year from adjacent discussion of a 2031 building budget.
- An accepted Friday review request retains both request/reply citations and is not marked completed.

## Release boundary

Do not enable collection or raise limits to test this change. Review and deploy the committed code through the established release process, then authorize a bounded fictional model evaluation when budget is available. Review the model's output against the rubric before any real-source retry or daily activation. Sol is appropriate for this final release/semantic review; ordinary implementation is the Terra phase.

Read-only cloud inspection during this work found collection flags absent. The serving revision had independently moved to `bhe-product-api-00381-nuv` with the `service-forecaster-review` tag; no deployment, traffic or configuration changes were made here. Refresh the actual serving revision before a later release; do not restore an older pilot revision over unrelated work.

Production provisional version 2 remains as previously published, including its documented review flags. Approved Life Context and Voice Profile remain untouched. This implementation does not claim to correct existing stored observations.
