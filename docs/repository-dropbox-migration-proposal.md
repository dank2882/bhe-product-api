# BHE repository image storage in Dropbox

Status: Accepted by Dan; implemented and deployed September 28, 2026.

Dan requested one permanent image store, approved `/BHE/Knowledge Repository/Images`,
approved lightweight automatic indexing without AI tokens, and approved reuse of
the existing ChatGPT Connections Dropbox app subject to code/security review.

## Ownership and destination

Dropbox is the permanent home of original images and generated previews. The BHE
Knowledge Repository remains the owner of the small catalog: entry IDs, logical
folders, titles, descriptions, original prompts, provenance, permissions, and audit.
Firestore and the existing Cloud Run services remain in use. Legacy PDF/OCR,
product assets, and other ministry domains were outside this migration.

- Dropbox folder: `/BHE/Knowledge Repository/Images`
- Folder ID: `id:GYjHJT2OzPAAAAAAABT5jg`
- BHE namespace: `10251589472`
- Existing Dropbox app: ChatGPT Connections (`1uc5jjc72th381b`)
- Secret reference: `bhe-repository-dropbox-refresh-token`, version 1
- Runtime access: only the existing product API service account was added to
  this secret's accessor policy. No app secret was revealed or copied.

The repository grant requests account identification, metadata read, and content
read/write. It omits sharing-management and team-administration scopes. Dropbox's
consent covers accessible account files; code enforces the chosen namespace/root
and validates stable file IDs, revisions, and checksums. This is an application
boundary, not a Dropbox-enforced folder-only OAuth grant.

## Behavior

- New repository uploads save originals and previews to Dropbox and verify bytes
  by downloading them again before committing the catalog record.
- Existing entry IDs, title wording, prompts, and source notes are preserved.
  Readable Dropbox names include stable ID suffixes to avoid collisions.
- Gallery/download links expire after 15 minutes. Delivery rechecks staff access,
  catalog version, file revision, root membership, and checksum. Public permanent
  Dropbox sharing links are not used.
- The gallery accepts images only from the exact configured backend origins
  (and the legacy GCS origin during compatibility). It retains folder navigation,
  original-image details, download links, and generated-image labels.
- Automatic indexing runs when the library is searched/opened/refreshed, no more
  than once a minute. Dropbox cursors, resumable batches, a distributed lease,
  and version checks prevent full rescans and duplicate processing. Large imports
  can require additional refreshes; progress is returned explicitly.
- Direct additions are indexed from filenames/folders and validated image bytes.
  No LLM, embedding, OCR, or AI-caption calls participate in this process.
- Moves, edits, deleted folders, and cursor resets are handled without discarding
  existing descriptions or provenance. Unavailable files are retained as hidden
  catalog records for history, not counted as available images.
- Supported originals remain single PNG, JPEG, or WebP images up to 25 MB and
  the existing 40-million-pixel safety limit. Unsupported files are not imported.
- Search preserves substring matching while reading at most 300 catalog entries
  per page. Follow `nextAfter`, including empty pages. Filtered totals are unknown
  until the scan is complete; browsing and folder lists are also paginated.

## Deployment and verification

- Product API: `bhe-product-api-00304-yug`, 100% production traffic.
- FBC Staff Tools MCP: `fbc-staff-tools-mcp-entra-prod-00062-how`, 100% traffic.
- Runtime implementation commits: product API `60cee5c`, `a244b2c`; platform
  `86621dd`, `dc7bed2`. Subsequent verification scripts/docs do not change runtime.
- Backend suite: 706 tests passed; platform suite: 198 tests passed, with focused
  gallery contract tests rerun after the final tool-description changes.
- All 8 originals and 8 previews were downloaded through the staged service.
  Original checksums matched, and unauthorized users and tampered links were denied.
- Live Dropbox direct-file import produced one correct catalog record and preview.
  Removing that disposable fixture made it unavailable; fixture files were removed.
- The connected FBC Staff Tools gallery returned all 8 active images with new
  backend preview URLs after cutover. Browser verification of the gallery HTML
  against the live backend displayed all 8 thumbnails and an original with its
  exact saved prompt/source notes. The browser check used a local test host, not
  a claim of fresh-session acceptance inside every chat client.

## Single-store cleanup and recovery

The 15 old GCS originals/thumbnail objects (24,365,008 bytes) were removed with
exact object-generation preconditions after Dropbox verification. Every object
was independently checked absent from active storage. Each of the 8 catalog
records was read back without a GCS storage path. Per-image audit receipts retain
object names/generations for recovery. No bucket-wide deletion was performed.

The existing bucket soft-delete policy retains recoverable copies for 30 days;
it was not changed. They are not active files or an application-maintained mirror.
There is no ongoing GCS image write or preview-cache path in the configured
production flow. Dropbox preview files are small derivatives of their originals.

After cleanup, do not roll back to GCS-only revision `00297-dhh` or earlier.
A Dropbox-aware revision such as `00303-niq` can serve migrated records; verify
configuration and traffic before rollback. Recovery beyond the cloud soft-delete
window depends on Dropbox recovery/history and the repository's durable audit.

## Maintenance and evidence

- `scripts/verify-repository-dropbox-live.mjs`: gallery/original/checksum/denial checks.
- `scripts/verify-repository-dropbox-sync-live.mjs`: explicit disposable import and
  deletion test; creates and removes a small fixture in the approved Dropbox root.
- `scripts/migrate-repository-images-dropbox.mjs`: dry-run by default; copy/apply
  require explicit flags and verify storage before changing versioned records.
- `scripts/cleanup-repository-gcs-images.mjs`: dry-run by default; exact manifest,
  generation checks, Dropbox read-back, and recoverable bucket policy required.
- The old GCS-only fixture verifier is guarded against use on this deployment.

Developer Tools connector operations were unavailable in this session. The
accepted constitution, platform ADR 0032, Git, authenticated FBC Staff Tools,
Dropbox API responses, and live Google Cloud state supplied the evidence.

References: [Dropbox OAuth](https://www.dropbox.com/developers/reference/oauth-guide),
[Dropbox file changes](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/list-folder),
and [file download](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/download).

Final post-cleanup acceptance: the production endpoint served all 8 original
images and 8 previews after the GCS objects were removed. All original checksums
matched again; unauthorized actors and tampered media links remained denied.
The connected FBC Staff Tools gallery and a fresh browser gallery refresh both
returned all 8 active images. Cleanup and catalog receipts were independently
read back. No image-migration step remains pending.
