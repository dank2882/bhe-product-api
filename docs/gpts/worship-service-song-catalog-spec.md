# Worship Service Song Catalog Spec

This document defines the Phase 1 foundation for the church music-service planning system:

* canonical `songs` schema
* CSV import rules
* title normalization rules
* conflict-review rules
* Phase 1 acceptance criteria

The goal is to make song identity deterministic before planning logic, tagging, Breeze normalization, or recommendation workflows are built on top of it.

## Scope

This spec covers the canonical catalog for the Rejoice hymnal only.

It assumes:

* the verified CSV is the working import source
* the Rejoice hymnal PDF is the visual audit and tie-breaker source
* repeated hymn numbers are expected when the same hymn appears under multiple topical entries

This spec does not yet cover:

* Breeze normalization
* service planning endpoints
* post-service feedback
* cross-hymnal identity matching

## Phase 1 Deliverables

Phase 1 should produce:

* one canonical `songs` record per hymn
* aggregated topics from repeated CSV rows
* stable `songId` values
* traceable source evidence back to CSV rows
* review flags only for real identity or import-quality problems

## Canonical Collections

Phase 1 requires one primary collection:

* `songs`

Phase 1 may also generate one derived helper collection if exact lookup needs to be materialized early:

* `songLookupKeys`

The `songs` collection is the source of truth.
The `songLookupKeys` collection, if used, is only a lookup helper derived from `songs`.

## Canonical Song Identity

### Identity rule

For the Rejoice hymnal, the canonical identity basis is:

* `hymnalId`
* `hymnalNumber`

The import pipeline should assume that a valid hymnal number corresponds to one canonical hymn record unless a real conflict is detected.

### Stable `songId`

Use a deterministic `songId` so re-imports do not create drift.

Recommended format:

* `rejoice-0001`
* `rejoice-0024`
* `rejoice-0712`

Rule:

* `songId = "{hymnalId}-{zero-padded hymnalNumber to 4 digits}"`

For this catalog:

* `hymnalId = "rejoice"`

Do not generate random IDs for canonical songs.

## `songs` Schema

Each `songs/{songId}` document should follow this shape.

### Required fields

* `songId: string`
* `hymnalId: string`
* `hymnalNumber: integer`
* `canonicalTitle: string`
* `topics: string[]`
* `titleAliases: string[]`
* `normalizedLookupKeys: string[]`
* `sourceStatus: string`
* `sourceEvidence: object`
* `reviewFlags: string[]`
* `createdAt: string`
* `updatedAt: string`

### Recommended document shape

```json
{
  "songId": "rejoice-0024",
  "hymnalId": "rejoice",
  "hymnalNumber": 24,
  "canonicalTitle": "O God, Our Help in Ages Past",
  "topics": [
    "Adoration and Praise",
    "Faith and Hope",
    "Funeral and Memorial",
    "New Year",
    "Spiritual Warfare"
  ],
  "titleAliases": [
    "O God, Our Help in Ages-Past"
  ],
  "normalizedLookupKeys": [
    "number:24",
    "number:0024",
    "title:o god our help in ages past",
    "title:o god our help in ages-past",
    "number-title:24:o god our help in ages past"
  ],
  "sourceStatus": "verified",
  "sourceEvidence": {
    "catalogSource": "song_topics_index_verified.csv",
    "catalogVersion": "working",
    "rowCount": 2,
    "rowRefs": [
      {
        "rowNumber": 25,
        "rawTitle": "O God, Our Help in Ages-Past",
        "rawTopics": [
          "Adoration and Praise"
        ]
      },
      {
        "rowNumber": 26,
        "rawTitle": "O God, Our Help in Ages Past",
        "rawTopics": [
          "Faith and Hope",
          "Funeral and Memorial",
          "New Year",
          "Spiritual Warfare"
        ]
      }
    ],
    "pdfAudit": {
      "status": "not_reviewed",
      "notes": ""
    }
  },
  "reviewFlags": [],
  "createdAt": "2026-04-23T00:00:00.000Z",
  "updatedAt": "2026-04-23T00:00:00.000Z"
}
```

### Field definitions

#### `songId`

Deterministic canonical identifier.
Immutable after creation.

#### `hymnalId`

String identifier for the catalog source.
For Phase 1 this should always be `rejoice`.

#### `hymnalNumber`

Positive integer from the CSV `Song #` column.

#### `canonicalTitle`

Best canonical display title for the hymn.
This should be chosen conservatively from imported rows.
Do not rewrite titles into a preferred style that is not supported by source evidence.

#### `topics`

Deduplicated, sorted list of imported topics aggregated across all matching CSV rows for the hymn.

#### `titleAliases`

Non-canonical raw title variants associated with the same hymn number.

Use this for:

* punctuation variants
* spacing variants
* minor OCR variants that still point to the same hymn

Do not include the canonical title in `titleAliases`.

#### `normalizedLookupKeys`

Derived exact-match or near-exact-match keys for lookups.
These should be deterministic and regenerated from title and number fields during import.

#### `sourceStatus`

Allowed values:

* `verified`
* `needs_review`
* `blocked`

Meaning:

* `verified`: imported cleanly with no unresolved identity issues
* `needs_review`: canonical record exists, but a reviewer should inspect one or more flags
* `blocked`: record could not be safely finalized without manual resolution

Phase 1 should prefer `verified` or `needs_review`.
Use `blocked` only when a canonical record cannot be trusted.

#### `sourceEvidence`

Traceability metadata for the imported record.

Minimum recommended fields:

* `catalogSource`
* `catalogVersion`
* `rowCount`
* `rowRefs[]`
* `pdfAudit`

Each `rowRefs[]` item should capture:

* `rowNumber`
* `rawTitle`
* `rawTopics[]`

#### `reviewFlags`

Deduplicated array of machine-assigned review reasons.

Allowed initial values:

* `missing_hymnal_number`
* `missing_title`
* `missing_topics`
* `duplicate_number_material_title_conflict`
* `duplicate_title_conflicting_numbers`
* `malformed_title_variant`
* `malformed_topic_value`
* `unresolved_import_ambiguity`
* `pdf_audit_required`

### Mutable vs immutable fields

Immutable after initial import:

* `songId`
* `hymnalId`
* `hymnalNumber`

Mutable during import refresh or admin review:

* `canonicalTitle`
* `topics`
* `titleAliases`
* `normalizedLookupKeys`
* `sourceStatus`
* `sourceEvidence`
* `reviewFlags`
* `updatedAt`

Later ministry-enrichment fields should be added in Phase 2, but they must attach to this same canonical record.

## Optional `songLookupKeys` Schema

If exact lookup materialization is needed before broader search is built, derive a helper collection from `songs`.

Recommended shape:

```json
{
  "lookupKey": "title:o god our help in ages past",
  "songId": "rejoice-0024",
  "hymnalId": "rejoice",
  "hymnalNumber": 24,
  "matchType": "title"
}
```

Recommended rule:

* never edit `songLookupKeys` directly
* always regenerate it from canonical song data

## CSV Import Contract

### Expected input columns

The Phase 1 importer should read:

* `Song #`
* `Title`
* `Topics`

### Raw row validation rules

Each row should be parsed into:

* `rowNumber`
* `hymnalNumber`
* `rawTitle`
* `rawTopics[]`

Validation behavior:

* trim leading and trailing whitespace on all fields
* parse `Song #` as an integer
* split `Topics` on commas
* trim and deduplicate topic values
* preserve the original raw title exactly in evidence storage

### Required field rules

Hard validation rules:

* missing or non-numeric `Song #` -> row flagged, cannot be imported as verified
* blank `Title` -> row flagged, cannot be imported as verified

Soft validation rules:

* blank `Topics` -> row imports with `missing_topics` review flag

## Title Normalization Rules

Title normalization must be conservative.
The importer should normalize enough to merge obvious duplicate topical rows, but not so aggressively that distinct songs collapse into one.

### Strict title normalization

Use strict normalization for safe grouping checks:

* Unicode normalize to NFKC
* lowercase
* trim outer whitespace
* collapse repeated internal whitespace to one space
* normalize curly apostrophes and quotes to straight equivalents
* normalize en dash and em dash to hyphen

Do not remove meaningful words.
Do not reorder words.
Do not expand abbreviations.

### Loose title normalization

Use loose normalization only for review assistance, not for automatic trust decisions:

* start from strict normalization
* remove punctuation except alphanumeric and spaces
* collapse whitespace again

Loose normalization may help identify probable OCR variants, but it must not by itself prove identity.

## Row Aggregation Rules

### Primary grouping rule

Group imported rows by `hymnalNumber`.

Each hymnal number group should attempt to produce one canonical song record.

### Topic aggregation rule

For all rows in a hymnal number group:

* collect every parsed topic value
* trim and deduplicate them
* sort them alphabetically for stable imports

Repeated topical rows should increase evidence count, not create duplicate songs.

### Canonical title selection rule

Within a hymnal number group:

1. collect distinct raw titles
2. compute strict-normalized forms
3. if all strict-normalized titles are equal, treat them as one title family
4. choose the best display title from the raw variants using the following priority:
   * exact majority spelling
   * variant with the fewest obvious OCR artifacts
   * variant confirmed by PDF audit if already reviewed

If there is no safe winner, set `sourceStatus = "needs_review"` and add `unresolved_import_ambiguity`.

### Title alias rule

Add non-canonical variants to `titleAliases` when they appear to refer to the same hymn number but differ in presentation.

Examples:

* punctuation variant
* spacing variant
* hyphenation variant

If a variant looks malformed rather than merely alternate, also add:

* `malformed_title_variant`

## Conflict-Review Rules

Only flag records for review when there is a real identity or data-quality problem.

### Do not flag

Do not flag a hymn number just because:

* it appears more than once
* it has different topic rows
* it has harmless punctuation variation

Those are expected import conditions.

### Flag as `duplicate_number_material_title_conflict`

Flag when the same `hymnalNumber` has title variants that are materially different after strict normalization.

Examples:

* different significant words
* one title clearly names a different hymn
* the importer cannot safely decide whether the rows refer to the same song

Default behavior:

* still create the canonical song record if one title family is clearly dominant
* set `sourceStatus = "needs_review"`
* preserve all row evidence

Escalate to `blocked` only if no canonical title can be chosen safely.

### Flag as `duplicate_title_conflicting_numbers`

Flag when the same strict-normalized title appears under different hymn numbers in the imported catalog.

Default behavior:

* keep separate song records by hymnal number
* add the flag to each affected song
* set `sourceStatus = "needs_review"`

This is a catalog-review issue, not an automatic merge rule.

### Flag as `missing_hymnal_number`

Flag when the row is missing a usable hymn number.

Default behavior:

* do not import the row into a verified canonical song
* include the row in an import error summary

### Flag as `missing_title`

Flag when the row is missing a usable title.

Default behavior:

* do not import the row into a verified canonical song
* include the row in an import error summary

### Flag as `missing_topics`

Flag when the row has no parseable topics.

Default behavior:

* import the canonical song if title and number are valid
* leave `topics` empty if no other rows provide them
* set `sourceStatus = "needs_review"` only if the song has no usable topics across the full group

### Flag as `malformed_title_variant`

Flag when a row title looks like a probable OCR or transcription corruption of the same hymn rather than a true alternate title.

Examples already present in the working CSV include:

* `All Glory, Laud, iwd Honor`
* `I Worship You, AJmjghty God`
* `Crown Hirn with Many Crowns`

Default behavior:

* preserve the raw variant in evidence
* keep it in `titleAliases` only if it still aids lookup
* set `sourceStatus = "needs_review"`

### Flag as `unresolved_import_ambiguity`

Flag when the importer cannot safely resolve the canonical record with confidence.

Examples:

* two competing titles with no clear winner
* inconsistent row patterns that suggest mixed-source corruption

Default behavior:

* set `sourceStatus = "blocked"` if the canonical identity is not trustworthy
* require manual review before downstream use

## PDF Audit Rules

The hymnal PDF is the visual audit and tie-breaker source.

Use PDF review when:

* a record has `duplicate_number_material_title_conflict`
* a record has `malformed_title_variant`
* a reviewer needs to confirm the preferred display title

Recommended `pdfAudit.status` values:

* `not_reviewed`
* `confirmed`
* `corrected`

Recommended rule:

* do not require PDF review for clean imports
* do require it for unresolved or suspicious title cases

## Import Pipeline Behavior

Phase 1 import should run in this order:

1. load CSV rows
2. parse and validate raw fields
3. group rows by `hymnalNumber`
4. aggregate topics within each group
5. evaluate title consistency within each group
6. choose `canonicalTitle`
7. build `titleAliases`
8. generate `normalizedLookupKeys`
9. assign `sourceStatus` and `reviewFlags`
10. write deterministic `songs/{songId}` records
11. optionally regenerate `songLookupKeys`
12. emit an import summary with counts for:
   * created
   * updated
   * needs review
   * blocked
   * row errors

## Re-import Rules

Re-imports must be idempotent against the same source data.

Rules:

* upsert by deterministic `songId`
* do not create duplicate records for the same hymnal number
* preserve stable `songId`s across re-runs
* recompute derived fields from source data each run
* do not silently overwrite reviewer-confirmed corrections without an explicit rule

Recommended rule for later review-aware imports:

* if `pdfAudit.status` is `confirmed` or `corrected`, preserve reviewer-confirmed `canonicalTitle` unless a human explicitly resets it

## Phase 1 Acceptance Criteria

Phase 1 is complete when all of the following are true:

* every valid hymnal number imports to exactly one canonical `songs` record
* repeated topical rows aggregate into one song record instead of multiple song records
* topics are deduplicated and stable across re-imports
* `songId`s are deterministic and stable
* source evidence points back to original CSV row numbers
* only real identity or data-quality issues receive review flags
* harmless duplicate-topic rows do not generate review noise
* malformed rows appear in import summaries instead of disappearing silently

## Minimum Test Cases

Phase 1 tests should cover at least these cases:

* repeated hymn number with same title and different topics aggregates into one song
* repeated hymn number with punctuation-only title differences aggregates cleanly
* same hymn number with malformed OCR-like title variant imports with `needs_review`
* same hymn number with materially different titles gets `duplicate_number_material_title_conflict`
* same title under different hymn numbers gets `duplicate_title_conflicting_numbers`
* missing hymn number blocks verified import
* missing title blocks verified import
* blank topics do not block import when title and number are valid
* re-import of unchanged CSV produces the same `songId`s and same canonical record count

## Implementation Notes For Phase 1

Keep the importer conservative.
When in doubt:

* preserve raw evidence
* create the canonical record only if identity is still trustworthy
* prefer `needs_review` over silent auto-correction
* prefer `blocked` over guessing when identity is genuinely unclear

That tradeoff protects the planning system from identity drift later.
