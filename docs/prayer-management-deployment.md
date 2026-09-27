# Prayer Management deployment and acceptance

Prayer Management reuses `bhe-product-api`, Firestore database `chatgptstorage`, and the unified FBC Staff Tools connection. It does not create a Logos integration or a separate application.

## Required production configuration

1. Run `scripts/configure-prayer-kms.sh` after reviewing its project, region, service, key-ring, and key defaults. It creates or reuses one symmetric Cloud KMS key, grants only the verified `bhe-product-api` runtime service account encrypt/decrypt access, and sets `PRAYER_KMS_KEY_NAME` on the service.
2. Set `PRAYER_OWNER_SUBJECTS` to Dan's verified OAuth subject aliases, comma-separated. The backend fails closed when this allowlist is absent and rejects every identity that does not match it, even if a role or gateway header incorrectly includes prayer scopes.
3. Deploy the backend revision containing the Prayer Management collections and routes.
4. Deploy the matching FBC Staff Tools revision. In backend-held authorization mode, the public Entra scope remains `access_as_user`; `prayer.read` and `prayer.write` are internal application permissions.
5. Add the `Dan Prayer Management Owner` role to Dan's current authorization profile without removing his existing roles, identity subjects, or permissions. Use the current profile version and read the profile back. Never add this role to the administrator bundle or a break-glass staff identity.

## Privacy verification

- Create a canary prayer and confirm Firestore holds only KMS ciphertext for its title, prayer text, context, tags, people, topics, reflections, and answers.
- Confirm the API runtime identity can encrypt/decrypt and an unrelated service identity cannot.
- Verify Dan can list and retrieve the canary; verify one staff identity and one administrator identity receive denial and cannot infer whether its ID exists.
- Inspect Cloud Run request/application logs for the canary words. They must not appear. Audit and idempotency records must contain metadata and ciphertext only.
- Confirm task searches, leadership briefs, notifications, and analytics do not include Prayer Management collections.

## Logos migration

1. In Logos, Print/Export the prayer list to Microsoft Word and save the DOCX. Do not edit or delete the Logos list.
2. Attach the DOCX to `prayer_import_logos_docx` with one stable import ID.
3. Review list and prayer counts, recovered titles/notes/tags/schedules/answers, duplicates, uncertain mappings, and every manual-review item.
   Prayer schedules may be daily, weekly, monthly by day of month,
   fixed-day intervals, or one-date reminders. Preserve the explicit Logos rule;
   do not infer recurrence from the next due date alone.
   Missing or explicitly unscheduled prayers default to daily, including in the
   preview. Unrecognized explicit schedule text still requires manual review.
   An occurrence before the prayer was created or imported does not count as
   missed. After activation, a missed scheduled occurrence remains due until
   it is recorded as prayed, matching Logos's carry-forward behavior.
4. Only after approval, call `commitLogosImport` with the same import ID and `approved: true`.
5. Read back the complete imported inventory and reconcile it with the preview. Keep Logos frozen for at least two weeks.

## Daily default decision — September 25, 2026

Dan approved replacing unscheduled prayers with daily prayers so a request
clears after being recorded as prayed and returns the next local calendar day.
He can then choose a different rotation if it appears too often.

- New prayers default to daily in their configured IANA time zone (Pacific when omitted).
- Legacy `unscheduled` input remains accepted as an alias for `daily`; it is
  no longer a distinct schedule choice. Reads and due calculations apply the
  same interpretation to older records without mutating them during a query.
- Existing unscheduled records are converted with versioned `updatePrayer`
  commands and independent read-back, including archived records without
  changing their archived state. Prayer content and history are preserved.
- Explicit weekly, monthly, interval, and one-date schedules are unchanged.
- Imported prayers without a schedule default to daily; unknown explicit
  source schedules retain their manual-review warning.

### Release verification — September 25, 2026

- Implementation: `2519e00e387e7a1fab196a22cf0f3585e68bc51c`.
- Validation: all 684 backend tests passed, including 23 prayer tests;
  `npm run check` and `git diff --check` passed. Coverage includes daily
  defaults, legacy input/read compatibility, local midnight and daylight-saving
  boundaries, imports, and preservation of archived state and prayer history.
- Migration: the complete 355-record owner inventory contained four unscheduled
  records (three active, one archived). All four were updated through versioned,
  idempotent Prayer Management commands and independently read back. Content,
  history, counts, and lifecycle states were preserved; the other 351 records
  were unchanged. A fresh inventory contained zero unscheduled records.
- Production: Cloud Build `7ddbc70e-ff93-43c4-a394-d667f138f6a0` succeeded;
  Cloud Run revision `bhe-product-api-00296-6jg` was Ready at 100% traffic.
  Previous revision: `bhe-product-api-00295-n5m` (rollback target).
- Connected-tool verification: the live create-prayer catalog reports version
  `2026-09-25` and the daily default. At `2026-09-25T14:17:10.119Z`, today's
  query was complete with zero due prayers. A schedule query at Pacific midnight
  September 26 returned the three converted active requests and excluded the
  archived request. No additional prayed events were created.
- Developer Tools registry was unavailable in this session; evidence is retained
  here in Git. Fresh phone-session acceptance was not exercised for this change.

## Whole-list prayed recording — September 27, 2026

Implemented `recordPrayedBatch` within the existing Prayer Management service.
The prior catalog exposed only single-prayer `recordPrayed`, requiring a separate
chat tool call and read-backs for every item in a displayed list. The reported
client interruption did not include its underlying error, so its exact limit
remains unconfirmed.

- Input: `items: [{ prayerId, expectedVersion }]`, 1–200 unique selected active
  prayers, plus the command's existing stable idempotency key. The client
  refreshes versions while preserving the user's displayed selection. It must
  not expand a displayed daily list to the whole archive. Split larger lists
  into batches and report any unfinished batches explicitly.
- Each batch is one Firestore transaction: all versions and ownership are
  validated before any writes. A conflict, missing prayer, or inactive prayer
  rejects the entire batch. No partial batch is committed.
- A prayer already recorded on its current local date (or later) is reported
  as `already_prayed`, without another event or version change. This supports
  recovery from an interrupted single-prayer run. Intentional repeat prayers
  or reflections still use the existing single-prayer `recordPrayed` operation.
- Prayer ciphertext, wording, schedules, and lifecycle state stay unchanged;
  only prayed counts, timestamps, versions, and encrypted history events change.
- Receipts contain IDs, counts, versions, outcomes, timestamps, and event IDs.
  `getPrayedBatchStatus` independently reads selected metadata and checks event
  ownership/type/linkage without returning prayer content. The shared MCP tool
  verifies the whole receipt in one query before claiming success.
- Successful identical requests replay the existing encrypted command receipt.
  The existing execution wrapper can leave a failed/in-progress receipt if a
  request is interrupted. Do not blindly replay with new arguments or a new
  key: inspect fresh selected-record status first, then reconcile under a new
  key if needed. Same-local-day protection prevents recounting saved prayers.
- Local validation: 29 prayer tests pass, including 200 items, partial-run
  recovery, idempotent replay, version conflicts/concurrent edits, local-day
  rollover, private ownership, and preservation of unselected records/content.
  All 690 backend tests and `npm run check` pass.
- Release state: deployed and connected-tool recovery verified; see the receipt
  below. A new prayed event was not created during live acceptance, and a fresh
  phone conversation was not exercised.

### Whole-list release verification — September 27, 2026

Dan authorized deployment in this session. Implementation commits:
backend `df432f8`, gateway `932cf4e`.

- Cloud Build `dabf309f-3f8c-47b8-a71d-c8366e632222` succeeded for the backend;
  `4f1b5776-9e55-4dbc-af3a-4725ef75d79a` succeeded for the shared gateway image.
- Ready revisions at 100% traffic: `bhe-product-api-00297-dhh`,
  `dan-life-os-mcp-00023-wt6`, and
  `fbc-staff-tools-mcp-entra-prod-00055-pf6`.
- Rollback revisions: `bhe-product-api-00296-6jg`,
  `dan-life-os-mcp-00022-8x8`, and
  `fbc-staff-tools-mcp-entra-prod-00054-7qk` respectively. Existing candidate
  tags were preserved. Runtime service accounts, environment/secret references,
  resource settings, concurrency, ports, and timeouts matched the prior revisions.
- Connected catalog returned `2026-09-27` with `recordPrayedBatch` (request
  `0b2e5a74-40f7-4ff2-bbd7-9dcb74226310`). Both ChatGPT app schemas initially
  rejected the new operation enum. Refreshing each existing app's Tools catalog
  through workspace administration resolved the rejection. Existing prayer
  command switches remained enabled; no tool permissions were manually expanded.
- Life OS command `d6e47b53-1c2e-44cf-b76f-7a7de037685b` selected two prayers
  already recorded that local day: `recordedCount: 0`, `alreadyPrayedCount: 2`,
  `complete: true`, `atomic: true`, `verification.readBack: true`.
  Identical retry `de0e15b5-801f-4077-b15f-2a9ff683648a` returned
  `idempotency.replayed: true`. Independent status read
  `fe1dc6a1-480a-4d3a-81f9-28abcea4dffe` matched both pre-test versions,
  counts, and timestamps exactly.
- FBC Staff Tools command `8f083fd3-7d3e-4fd5-a38c-9477d91ed167` replayed the
  same encrypted receipt and independently verified both selected records
  (read-back `d36ee585-f2fa-4a7c-972c-76f8053f0e8a`). No new prayed events
  were created. This verifies connected-tool routing, same-day duplicate
  prevention, replay, and read-back, not a live fresh-event write or phone UI.
- Developer Tools registry actions were unavailable in this session. Git holds
  the release evidence; no registry write or fresh-phone acceptance is claimed.

## Acceptance gates

- Automated backend and MCP suites pass.
- Fresh desktop session: add, retrieve, record prayed, reschedule, answer, reopen/archive, search, and find one migrated prayer.
- Actual iPhone Voice session repeats add, retrieve, pray, reschedule, answer, and migrated-prayer lookup.
- Only after both surfaces pass does Prayer Management become authoritative. Do not delete the Logos backup automatically.
