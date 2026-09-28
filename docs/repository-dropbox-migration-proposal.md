# BHE repository photos in Dropbox

Status: Storage direction and folder layout accepted by Dan, September 28, 2026.
Dropbox is the only permanent photo/preview store; retain only a small catalog
in the repository. Dan also accepted automatic indexing provided it is lightweight
and does not consume AI tokens. Dan approved reuse of the existing Dropbox app,
subject to code/security review. Live backend authorization and migration remain
pending. Destination folders have been created; no images have been migrated.

Verified destination:
- `/BHE/Knowledge Repository`, Dropbox ID `id:GYjHJT2OzPAAAAAAABT5jQ`.
- `/BHE/Knowledge Repository/Images`, Dropbox ID `id:GYjHJT2OzPAAAAAAABT5jg`.
- BHE team-folder namespace: `10251589472`.
- The user's phrase "core BHE" resolves to the existing `/BHE` team folder;
  no separate folder named Core BHE was found.

The Dropbox app console has an existing `ChatGPT Connections` scoped app
(client ID `1uc5jjc72th381b`) with metadata read and file-content read/write
permissions already enabled, as well as sharing permissions. This is a reuse
candidate, not a verified backend connection. No app settings, permissions,
credentials, or grants were changed. Any repository grant should request only
required scopes, omitting its enabled sharing permissions.

## Verified starting point

- The live repository image search reports 8 images across 15 library entries.
- `lib/repository-library-service.js` saves originals and generated WebP
  thumbnails in the existing Google Cloud Storage bucket. Firestore owns the
  library catalog, nested folders, provenance, staff authorization, and audit.
- Gallery and download responses contain expiring Google Cloud URLs. The MCP
  gallery resource currently allows images from storage.googleapis.com only.
- Cloud Run revision observed: `bhe-product-api-00297-dhh`. Its runtime
  configuration has no Dropbox variables or secret references. No
  Dropbox-named secret was found in the current Google Cloud project. This
  does not establish whether an unused Dropbox application exists elsewhere.
- All 8 existing repository-library tests pass before changes.
- Developer Tools connector operations were unavailable in this session;
  current code, the accepted constitution, ADR 0032, and read-only live
  repository and Google Cloud inspection supplied the evidence above.

## Recommended boundary

Dropbox owns original photo bytes and generated preview files. The existing BHE
Knowledge Repository continues to own the catalog, original prompts, generated
image labels, titles, descriptions, tags, logical folders, staff permissions,
stable entry IDs, and audit history. Existing Cloud Run services, Firestore,
Entra identities, MCP tool names, and PDF/OCR workflows remain in place.

Extend the current backend with a Dropbox storage adapter. No separate service
or database is needed. Preserve support for existing GCS records during rollout.
Keep Dropbox file IDs, revisions, namespace, and checksums as internal storage
references; do not save expiring links as permanent file identities.

Use readable folder and file names with stable ID suffixes beneath the selected
Dropbox root. Retain the original byte checksum. Resolve files by Dropbox ID so
renaming a file does not immediately break its repository record.
Automatically index new/changed image files beneath the selected root using
Dropbox change cursors. Persist cursor progress only after idempotent page
processing. Process bounded pages and resume without rereading the whole library.
Use filenames/folders and image headers for basic metadata, without LLM calls,
embeddings, OCR, or AI captions. Exclude generated-preview folders from intake.
Account for renames, moves outside the root, edits, deletes, and cursor resets;
mark unavailable files without discarding their provenance or deleting Dropbox
content. Reconcile against Dropbox IDs to avoid duplicates with backend uploads.
Indexing/preview generation uses ordinary API and compute resources, not AI tokens.
Scheduling should reuse existing authenticated job infrastructure if suitable;
choose an explicit low-frequency schedule during implementation.

## Connection and display

Reuse a suitable organization-owned Dropbox application if one exists;
otherwise register one after approval. Use offline OAuth and keep credentials
in Secret Manager. Never reuse or extract the chat connector's credentials.
Scope API permissions to the required metadata read and content read/write
operations; do not request sharing administration or team-wide impersonation.

The approved destination is an existing team folder rather than `/Apps`.
Confirm the reuse candidate supports Full Dropbox content access and a user grant
that can access the BHE namespace. Dropbox's grant may cover more of the user's
accessible files than the selected repository folder; enforce the selected root
in backend code, and explain that this is an application restriction rather
than a Dropbox-enforced per-folder OAuth permission. Obtain explicit consent
before issuing a persistent backend grant. No team-wide impersonation is planned.

Serve preview/original bytes through a short-lived, signed media route in an
existing backend service, bound to the entry, file revision, media variant, and
expiry. Issue links only after current repository authorization. Validate the
signature, expiry, and bounded byte size before accessing Dropbox; never accept
an arbitrary caller-supplied Dropbox path. Redact capability URLs from logs.
Use private caching and update the gallery CSP for the exact media origin.
Dropbox documents that its temporary streaming links expire after four hours
and should not be used directly for browser display; validate the actual MCP
gallery surface before cutover.

## Migration and rollback

1. Destination created and independently verified. Approve and establish the backend Dropbox connection.
2. Implement adapter, media delivery, configuration, and focused tests with
   Dropbox disabled by default. Test authorization, expiry, retries, duplicate
   uploads, conflicts, unavailable previews, and mixed GCS/Dropbox records.
3. Authorize the selected account; verify root access and an isolated upload,
   download, and preview using the intended staff surface.
4. Produce a dry-run manifest of existing image IDs, versions, source checksums,
   destinations, and expected sizes. Refresh the image count before migration.
5. Copy each original, download it from Dropbox, and verify its SHA-256 checksum.
   Generate/verify its preview. Change the storage reference only with a version
   check and transactional audit receipt after both files are verified.
6. Independently reread records and exercise gallery, full image/download,
   refresh, new upload, and permission denial through FBC Staff Tools.
7. Enable Dropbox for new uploads only after acceptance. Retain GCS originals
   only during verification, not as a permanent second library. Prepare an exact
   original/thumbnail deletion manifest after successful cutover; obtain explicit
   approval for irreversible cloud deletion before removing those objects. Then
   retire the temporary GCS image path. PDF/OCR and other domains are unaffected.

Before cleanup, rollback can restore prior storage references with concurrency
checks. After GCS cleanup, recovery uses Dropbox; there is no permanent cloud image
mirror. Never revert to a GCS-only binary once Dropbox-only records exist.

## Decision needed

Dan approved app reuse: "yes but that was created prior to Astra so you might
just double check the code and make sure its the level you want."
The local setup helper now requests only account identification, metadata read,
and content read/write. It verifies the exact approved BHE Images folder and
PKCE refresh behavior before writing a credential directly to Secret Manager.
User completion of the Dropbox authorization is pending. No app secret needs to
be revealed, and no existing app settings or grants have been changed.

References: [Dropbox OAuth](https://www.dropbox.com/developers/reference/oauth-guide),
[temporary links](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/get-temporary-link),
and platform ADR 0032 (`bhe-agent-platform/docs/adr/0032-repository-images-and-information.md`).


## September 28 implementation review

The checked product/platform repositories contain no existing Dropbox storage
client; the older app registration is not evidence of reviewed integration code.
Existing image-library tests pass, but the implementation is unsuitable for the
planned large library without the following changes:

- `query` and `gallery` use `readCompleteQuery` to load full matching catalogs;
  `gallery` reads every library entry for counts and ancestry on every request.
  The helper hard-stops beyond 10,000 documents. Replace this with bounded,
  database-backed browsing/search and stored folder counts. Preserve explicit
  pagination/coverage; do not silently truncate a large library.
- Storage, preview generation, and download links are directly coupled to GCS.
  Gallery CSP also allows only the GCS image origin. Both backend and MCP gallery
  must change and be tested on the actual user surface.
- No cursor-based Dropbox indexing exists. Page processing must be idempotent,
  survive cursor resets, and handle folder deletion descendants and moves in/out
  of scope. Preserve user descriptions/provenance when external filenames change.
- Existing upload validation, staff permission checks, checksums, and immutable
  provenance provide useful behavior to retain. Neither successful unit tests
  nor app reuse establish production readiness for Dropbox.
- App sharing scopes are enabled but not needed. Do not remove them globally
  because other consumers may depend on them; request a narrower repository grant.
- Reused the repository's local-setup/Secret-Manager pattern, but did not copy the
  YouTube helper's secret arguments, raw OAuth response logging, or unvalidated
  callback handling. New helper uses PKCE, loopback-only binding, exact Host and
  Origin checks, CSRF protection, input/time limits, generic errors, and read-back.

New files: `scripts/lib/dropbox-connection.mjs`,
`scripts/setup-repository-dropbox.mjs`, `test/dropbox-connection.test.mjs`.
Validation: 5 connection tests plus 8 existing image-library tests pass; syntax
and whitespace checks pass. Helper is operator setup, not deployed runtime code.
No migration, GCS deletion, automatic indexing, or Dropbox gallery is live yet.

## Implementation and connection checkpoint

- The user completed authorization; Secret Manager version 1 of
  `bhe-repository-dropbox-refresh-token` was independently verified against the
  exact Images folder. Only the existing product API runtime service account was
  granted access to that secret.
- All 8 image originals and their previews were copied and downloaded back for
  checksum verification. The copy manifest is an operator artifact under `/tmp`;
  release evidence will record the final state after cutover.
- Backend upload, signed media delivery, bounded catalog browsing, and Dropbox
  cursor indexing are implemented. Gallery origin allowlisting is updated in
  the platform repository. No AI API participates in indexing.
- Indexing runs on library search/gallery refresh, no more than once per minute,
  with a distributed lease and bounded resumable work. A large import may need
  additional refreshes. This avoids introducing a scheduler or a new service.
- Keyword search retains substring matching but scans at most 300 catalog entries
  per page and returns a continuation even when that page has no matches. An
  exact total is omitted during filtered search. Folder browsing also paginates.
- New uploads keep the original 25 MB / PNG, JPEG, WebP safety limits. Invalid or
  unsupported Dropbox files are not imported. External descriptions are not
  inferred. Moving originals outside the approved root invalidates their links.
- Source GCS objects remain only for the verification window. Deletion requires
  a verified exact-object manifest after successful deployment and acceptance.
