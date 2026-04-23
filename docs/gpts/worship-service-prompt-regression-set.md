# Worship Service Prompt Regression Set

This file defines a small real-world prompt set for milestone validation.

The purpose is to catch integration drift early between:

* backend behavior
* Custom GPT instructions
* OpenAPI action schema
* real GPT prompt handling

## Rule

Rerun this prompt set at each major milestone for any GPT-facing slice.

A slice is not complete until:

* the backend behavior is correct
* the action schema is current
* these prompts run successfully through the Custom GPT

## Slice Applicability

Not every prompt applies to every slice.

For Slice 1 live validation, use only this narrowed prompt set:

* `Find songs on assurance.`
* `Find songs on the love of Christ.`
* `Get details for hymn 381.`
* `Find songs with source status needs_review.`

The broader service-planning prompts remain in this file as future-slice prompts and should not be treated as Slice 1 blockers.

## What To Check Each Run

For each prompt, verify:

* the GPT selects the right action or actions
* request payloads match the live backend contract
* response fields are actually usable by the GPT
* missing-context situations are handled cleanly
* ambiguous results do not cause guessing
* errors are surfaced clearly and recoverably

## Initial Prompt Set

### 1. Song Search By Theme

Prompt:

* `Find songs for a Sunday morning service on trust and God's faithfulness.`

Verify:

* song search action is used correctly
* filters and query behavior are sensible
* results are returned as structured candidates, not invented recommendations

### 2. Existing Service Lookup

Prompt:

* `Find the Sunday morning service from 2026-04-19 and show me the current plan.`

Verify:

* service search works cleanly for exact-date retrieval
* ambiguous matches do not get auto-selected silently
* the GPT can summarize the returned service record accurately

### 3. Create Service Draft

Prompt:

* `Create a draft for this Sunday morning service with theme 'The Faithfulness of God'.`

Verify:

* the GPT creates a service only when retrieval did not resolve an existing one
* returned `serviceId` is captured and reused correctly
* follow-up reasoning references the created service record rather than inventing local state

### 4. Suggest Setlist With Strong Context

Prompt:

* `For this Sunday morning service on Psalm 100, suggest a setlist with a strong opener, a deeper second song, and a reflective pre-message moment.`

Verify:

* suggestion action is used with the correct `serviceId`
* response shape supports rationale, alternates, warnings, and confidence
* the GPT uses structured results rather than rewriting the contract mentally

### 5. Suggest Setlist With Thin Context

Prompt:

* `Suggest songs for Sunday night.`

Verify:

* low-context handling works
* the GPT surfaces missing context instead of pretending confidence
* multiple viable directions appear when the backend indicates low confidence

### 6. Ambiguous Service Search

Prompt:

* `Open the Easter service plan.`

Verify:

* if multiple Easter services exist, the GPT summarizes candidates instead of guessing
* ambiguity warnings stay visible in the user-facing answer

### 7. Contract Error Recovery

Prompt:

* `Find songs with no constraints.`

Verify:

* if the backend rejects an empty search request, the GPT recovers gracefully
* the user gets a useful next step instead of a cryptic failure

### 8. Get Canonical Song Detail

Prompt:

* `Show me the canonical details for hymn 24.`

Verify:

* the GPT can find the correct song first if the `songId` is not known yet
* the GPT can then retrieve the canonical song detail cleanly
* review flags and `sourceStatus` are handled without confusion

## Slice 1 Narrow Live Validation Set

Use this exact set for current live Slice 1 validation:

### A. Theme Search: Assurance

Prompt:

* `Find songs on assurance.`

Verify:

* the GPT uses song search only
* the query or filter payload stays within the Slice 1 schema
* results come back as canonical catalog matches

### B. Theme Search: Love Of Christ

Prompt:

* `Find songs on the love of Christ.`

Verify:

* the GPT stays inside catalog-search behavior
* no service-planning behavior is implied
* if the results are thin, the GPT says so without inventing metadata

### C. Canonical Detail Lookup

Prompt:

* `Get details for hymn 381.`

Verify:

* the GPT searches first when needed
* the GPT then retrieves the canonical record
* aliases, topics, and source status are reported clearly

### D. Review Status Filter

Prompt:

* `Find songs with source status needs_review.`

Verify:

* the GPT uses the `sourceStatus` filter correctly
* returned review flags remain visible
* the GPT does not claim the songs are fully verified

## Milestone Logging

For each milestone, record:

* date tested
* schema version used
* backend commit or branch tested
* prompts passed
* prompts failed
* follow-up fixes required

## Notes

Keep this set intentionally small.

The goal is not exhaustive coverage.
The goal is to catch early mismatch between the Custom GPT and the backend while fixes are still cheap.
