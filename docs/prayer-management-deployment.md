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
4. Only after approval, call `commitLogosImport` with the same import ID and `approved: true`.
5. Read back the complete imported inventory and reconcile it with the preview. Keep Logos frozen for at least two weeks.

## Acceptance gates

- Automated backend and MCP suites pass.
- Fresh desktop session: add, retrieve, record prayed, reschedule, answer, reopen/archive, search, and find one migrated prayer.
- Actual iPhone Voice session repeats add, retrieve, pray, reschedule, answer, and migrated-prayer lookup.
- Only after both surfaces pass does Prayer Management become authoritative. Do not delete the Logos backup automatically.
