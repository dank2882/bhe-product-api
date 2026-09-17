# Maintenance local verification — September 16, 2026

State: implemented and tested locally; not deployed or accepted live.

- Product API: `node --test` — 618 passed, 0 failed.
- Product API: `npm run check` — passed (syntax, operation catalogs, stable GPT contract).
- Platform companion: `npm test` — 169 passed, 0 failed; `npm run check` passed.
- Maintenance coverage includes scoped grants, owner-only deletion, recurring
  occurrence replay, unknown sender quarantine, duplicate ingestion, immutable
  draft approval, one send under concurrency, uncertain-send no-retry behavior,
  staff offboarding, competing photo reviews, forged webhook rejection, service
  identity checks, media-host restrictions, actual image decoding, bounded reads,
  mailbox cursor recovery, and source-preserving import previews.
- Pasted worksheet preview: 77 rows preserved; no Firestore writes. This is not
  the complete master and does not resolve building labels or photo availability.
- Worker production dependency audit: 0 high/critical, 2 moderate (gaxios and its
  uuid dependency). The advisory concerns uuid v3/v5/v6 buffer bounds. Inspected
  installed gaxios uses uuid v4 for multipart boundaries; this path does not
  exercise the affected functions. Keep this dependency review open for release.
- Existing product/platform dependency advisories are not silently fixed as part
  of this feature; a release must account for their current baseline separately.

These tests use local transactional doubles and mocked provider HTTP responses.
They do not establish live Firestore IAM, actual Microsoft mailbox scope, Twilio
billing/carrier acceptance, HEIC support on worker phones, message delivery,
Shawna's client-session access, or production deployment.

See maintenance-launch.md for activation gates and rollback. The account's
Twilio purchase screen currently reports suspension for lack of funds. No live
messages, purchases, role grants, secret writes or production deployments were
performed in this implementation pass.
