# Slice 16 - Live Google Sheet Refresh Command Hardening

## Summary

Slice 16 makes the live Google Sheet planning import repeatable through one operator-friendly command:

```bash
node scripts/refresh-music-planning-from-google-sheet.mjs --plan-only
```

For writes, the command requires explicit confirmation:

```bash
node scripts/refresh-music-planning-from-google-sheet.mjs \
  --commit \
  --allow-planned-updates \
  --confirm-source-import-id <sourceImportId>
```

The command pulls the latest shared Google Sheet CSV export, builds the Slice 10 preview, builds the Slice 12 Firestore write plan, optionally commits safe create/update actions, verifies the committed target documents, and writes ignored artifacts under `tmp/`.

## Default Source

- Google Sheet ID: `1vwLCdHrlZpwRkiezJtQWxAvhtSq_vlp70k0k0-FN4ss`
- Source sheet: `PROPOSED SCHEDULES`
- Planning year: `2026`
- Firestore project/database defaults: `location-map-985` / `chatgptstorage`

The command accepts overrides:

```bash
node scripts/refresh-music-planning-from-google-sheet.mjs \
  --google-sheet-id <sheetId> \
  --sheet "PROPOSED SCHEDULES" \
  --year 2026 \
  --out-dir tmp
```

## Modes

### Preview Only

```bash
node scripts/refresh-music-planning-from-google-sheet.mjs --preview-only
```

This mode fetches the live Sheet and writes only:

- `tmp/music-planning-google-sheet-preview-latest.json`
- `tmp/music-planning-refresh-summary-latest.json`

It does not read or write Firestore.

### Plan Only

```bash
node scripts/refresh-music-planning-from-google-sheet.mjs --plan-only
```

This is the default mode when no mode flag is supplied. It fetches the live Sheet, reads current Firestore state, and writes:

- `tmp/music-planning-google-sheet-preview-latest.json`
- `tmp/music-planning-firestore-write-plan-latest.json`
- `tmp/music-planning-refresh-summary-latest.json`

It does not write Firestore.

### Commit

```bash
node scripts/refresh-music-planning-from-google-sheet.mjs \
  --commit \
  --allow-planned-updates \
  --confirm-source-import-id <sourceImportId>
```

Commit mode fetches, plans, validates, writes safe create/update actions, and verifies the target documents after commit.

The command refuses to write unless:

- `--commit` is present.
- `--confirm-source-import-id` exactly matches the generated plan.
- The plan is eligible for commit.
- The plan has no blocking conflicts.
- The plan has no `error` warnings.
- Planned updates are explicitly allowed when update actions are present.
- Existing target documents are safe planned spreadsheet-owned records or exact expected existing records.

## Safety Behavior

The refresh command never:

- deletes Firestore records
- marks services completed
- performs catalog matching
- creates songs or aliases
- writes back to the Google Sheet
- updates GPT artifacts
- deploys backend code

Commit mode is idempotent. Existing expected records are skipped; safe planned records may be refreshed only when `--allow-planned-updates` is present.

## Output Artifacts

All generated artifacts are written under ignored `tmp/` paths:

- `music-planning-google-sheet-preview-latest.json`
- `music-planning-firestore-write-plan-latest.json`
- `music-planning-firestore-commit-result-latest.json`
- `music-planning-refresh-summary-latest.json`

These artifacts should not be committed.

## Console Summary

The command prints:

- source Sheet ID and tab
- Firestore project/database
- importable service count
- planned music slot count
- service create/update counts
- service song event create/update counts
- preserve/conflict/missing-from-source counts
- warning counts
- whether commit was performed
- post-commit verification counts when commit mode runs
- artifact paths

## Known Limitations

- The command reads the shared Sheet through Google's CSV export URL, not through a Google Sheets API service account.
- The command does not schedule automatic sync.
- The command does not delete or stale-mark records that disappeared from the Sheet.
- The command does not distinguish source mistakes from ministry changes; Firestore reflects the current spreadsheet source.
- The command does not perform canonical song matching.

## Recommended Next Slice

Recommended next slice: **Spreadsheet Planning Refresh Review and Operator Runbook**.

That slice should review the new refresh artifacts after a real run, decide whether any update-noise should be reduced, and document the normal operator cadence before considering scheduled automation.
