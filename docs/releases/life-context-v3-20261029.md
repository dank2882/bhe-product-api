# Life Context accuracy v3 — released October 29, 2026

The accuracy update is deployed and independently read back. The daily collector remains off. Existing provisional observations were not regenerated, and approved profiles were not populated.

## Verified

- Production: `bhe-product-api-00346-bkf`, serving 100% of normal traffic, source `1f8eda9fd5d5b277fca6c062639d00d1e2ef7a3c`, observed at 11:17 a.m. Pacific. Revision numbers are not chronological across independent releases; the source label and traffic were checked directly.
- All 931 backend tests and configuration/catalog checks passed in the release process. The unchanged platform had separately passed 254 tests.
- Real Vertex test: HTTP 200 / STOP, six fictional observations, 2,027 input + 621 output tokens. Exact support quotes passed validation; in-memory publication, receipt, and selective retrieval succeeded.
- All five semantic checks passed for that sample: separate events/dates, no invented relationship, no inferred workshop year, paired request/reply without a completion claim, and source-supported clauses. The model retained proposal wording even where certainty was `reported`; it did not mark proposed events confirmed.
- Independent connected Life OS reads returned provisional version 2, seven cited provisional observations, no pending or invalidated state, and the original completed pilot receipt. Messages and WhatsApp coverage remain partial. Read request: `530e6852-a586-41c7-833b-a40556b4d21c`; receipt request: `796f2b87-8f52-4be7-b161-15d812b2b4f3`.
- Approved Life Context remains null/version 0; Voice Profile remains null.
- Concurrent Service Forecaster work was preserved in the combined Git history and deployment. Live read-only forecast returned all nine Wednesday services; the November 4 plan remained readable. Forecast request: `b4a386a2-0c1f-41aa-a6a8-3ba26d59dfe9`; plan request: `e88c0e4e-0fb5-4168-b3a1-83e9c5f0c454`.
- Collection environment flags are absent. No production collection, budget increase, profile write, source edit or schedule activation occurred in this release.

## Compatibility repair

The initial v3 request was rejected with HTTP 400 `INVALID_ARGUMENT`. Removing provider-side nested array bounds allowed the same model and fictional evidence to succeed. The backend still enforces 20 observations, six citations, exact supporting quotes, supported years, output size, timeout and cost controls. No fallback model or automatic inference retry was added.

## Remaining work

This is one fictional semantic acceptance test using the existing developer identity, plus production deployment and read verification. It is not a new deployed-runtime end-to-end collection or fresh-session authentication test. The older stored version 2 retains the previously reported semantic concerns; the release does not silently rewrite it.

Next: validate a fresh real-source collection with v3, review actual interpretations, and complete fresh-session/next-day desktop access and missed-run checks before enabling the 06:25 Pacific daily pilot. Profile initialization remains a separate Dan-approved step. No additional permission is needed merely to continue debugging the approved accuracy/release work; Dan removed the per-attempt approval cap.
