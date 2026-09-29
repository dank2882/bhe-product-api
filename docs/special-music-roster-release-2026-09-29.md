# Special-music roster release — September 29, 2026

Implemented in backend commit `c5ccd6a` and platform commit `d78b097`.
Production releases: `bhe-product-api-00301-4rq` and
`fbc-staff-tools-mcp-entra-prod-00058-rxd`, each verified at 100% traffic with
the corresponding source-commit label. See [contract](special-music-roster.md).

## Verification

- 712 backend tests and 201 platform tests passed, with schema checks.
- The supplied 76 profiles were created in `location-map-985`, database
  `chatgptstorage`, collection `specialMusicProfiles` using authenticated focused
  commands, version zero, and content-derived idempotency keys.
- All records were independently read through the API and directly from
  Firestore. Every imported source field matched. Each record was version one.
- Source distribution: 20 individuals, 24 duos/small combinations, 32
  families/larger groups; tiers 1/2/3 contain 5/25/46 profiles.
- Optional group names, unknown memberships, and supplied partial names/TBD
  were preserved. All 76 accompanist arrays are empty, as requested.
- Live table query returned 76 rows; Sunday morning eligibility returned 46.
  A repeated create intent replayed its original receipt without changing the
  profile. Unauthenticated backend access was denied.
- Authenticated Staff Tools discovery returned all four roster operations and
  omitted the blocked generic `mutateData` operation.
- The local HTML snapshot was browser-checked: 76 rows, 46 with the Tier 3
  filter, and one result for Faith Trio. It supports search and printing.
- The two expressly requested staff accounts received `ministry.read` and
  `ministry.write`; profile versions advanced 3→4 and 1→2. Independent reads
  confirmed existing permissions, identities, task roles, and teams were
  preserved. No other domain access was added.

Import source SHA-256:
`5a344d201047665aa5babc34e73103d80bc2139ad008ba9fd8b8aa9e5777fb4e`.
Private roster inputs, per-profile receipts, and the HTML snapshot are outside
Git. Firestore owns the roster; the Sheet remains the schedule.

## Remaining acceptance boundaries

Andy and Shawna's own interactive sessions have not been exercised. Existing
chat sessions may retain an older operation enum until tools are refreshed.
Their permission grants and the deployed allowlists have been verified, but
that is distinct from their personal sign-in acceptance. No schedule rows or
service-specific accompanist bookings were changed.
