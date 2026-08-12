# Dan Travel Companion deployment gates

The implementation reuses the existing product API and Firestore deployment. Do not deploy until these configuration gates are satisfied.

## Required backend configuration

- Run `scripts/configure-dan-relationship-photo-bucket.sh` to create or verify the Dan-owned bucket with public-access prevention, uniform bucket-level access, versioning, and the documented lifecycle policy.
- Grant only the verified API runtime service account object access.
- The same script grants that runtime identity `signBlob` on itself so it can create short-lived private preview URLs; do not grant this role to a user or broader principal.
- Set `DAN_RELATIONSHIP_PHOTO_BUCKET_NAME` to the exact created bucket name.
- Set `DAN_TRAVEL_OWNER_SUBJECTS` to Dan's verified OAuth subject aliases, comma-separated. The API deliberately fails closed when this is absent.
- Leave `DAN_RELATIONSHIP_HEIC_ENABLED` unset until a real iPhone HEIC upload passes in the deployed image runtime; then set it to `true`. JPEG, PNG, and WebP do not depend on this gate.
- Preserve the existing `tripMemories` collection and legacy Philippines routes.

## MCP and OAuth configuration

- Deploy the `dan-travel-companion` MCP profile from `bhe-agent-platform` as a separate service.
- Use a dedicated public client/resource API pair and the scopes `travel.read`, `travel.write`, and `travel.media`.
- Register the exact client, audience, service URL, scope IDs, and revision in Dan Developer Tools after its OAuth connection is restored.
- Reuse the installed Outlook connector's contact-folder and contact list/create/fetch/update operations. Compare duplicate hints locally and create the `Dan Relationships` folder only after an approved first publish.
- Extend that same Outlook connector with the one missing narrow capability: contact-photo PUT/read-back against the returned Graph path. The Travel Companion backend returns a short-lived JPEG URL and exact path; it never stores an Outlook token. After Graph read-back, record `recordOutlookPhotoPublish`; an attempted upload alone is not success.

## Scheduler

Call command operation `buildDueTravelBriefings` once daily with Dan's local date using a trusted internal identity. The backend deduplicates destination/T-14/active-trip daily briefings by date, destination, and trigger.

## Migration

- Create `trip-philippines-2026` in `danTravelTrips` with `legacyProjectId: project-philippines-2026`.
- Preserve existing `tripMemories` IDs; do not rewrite or duplicate them.
- Import people, churches, affiliations, contact methods, and interactions only after duplicate review.
- Convert the supplied packing document with `scripts/import-master-packing-list.mjs`, review the generated JSON, then create the live packing list with its source path and SHA-256 checksum. System notes are imported as rules, not packable items.
- Keep legacy Trip Coach and Packing GPT access available for 30 days after production and iPhone acceptance.

## Acceptance

- Run automated API and MCP suites.
- Verify one allowed and one denied OAuth identity.
- In a fresh ChatGPT session, create a name-only person, enrich it, upload a normal photo, adjust and approve the crop, and retrieve it later.
- Create/link/update one Outlook contact, read it back, publish its approved photo, then verify the fields and portrait on Dan's iPhone.
- Verify one Outlook-side edit becomes a merge proposal rather than an automatic overwrite.
- Verify destination-added, T-14, and active-trip daily refreshers.
