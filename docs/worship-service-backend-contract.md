# Worship Service Backend Contract

This document defines the recommended backend contract for the first four live endpoints:

* `searchSongs`
* `searchServices`
* `createService`
* `suggestServiceSetlist`

The goal is to make the GPT reliable before write-heavy workflows are added.

## Principles

* Backend generates `serviceId`
* search supports free text, filters, or both
* responses return raw structured data, not narrated prose
* suggestion responses always include rationale, warnings, and missing-context signals
* low-confidence planning should return multiple viable directions

## Data Collections

Recommended collections:

* `songs`
* `services`

Recommended `songs` fields:

* `songId`
* `title`
* `artist`
* `themes`
* `scriptureTags`
* `defaultKey`
* `alternateKeys`
* `tempo`
* `energy`
* `familiarityScore`
* `lastUsedDate`
* `usageCountLast90Days`
* `vocalRange`
* `serviceRoleSuitability`
* `arrangementComplexity`
* `congregationFit`
* `defaultNotes`
* `active`

Recommended `services` fields:

* `serviceId`
* `title`
* `serviceDate`
* `series`
* `season`
* `theme`
* `scripture`
* `sermonTitle`
* `serviceType`
* `campus`
* `congregationProfile`
* `audienceNotes`
* `specialElements`
* `planningStatus`
* `serviceNotes`
* `setlist`
* `orderOfService`
* `teamNotes`
* `createdAt`
* `updatedAt`

## Endpoint Contract

### `POST /songs/search`

Purpose:
Return song candidates for planning decisions.

Request behavior:

* accept `query`, `filters`, or both
* reject the request only if both are absent
* support limit and simple sort modes

Response behavior:

* return ranked songs
* return the filters actually applied
* return warnings if the request was partially satisfied

Recommended backend notes:

* implement a lightweight ranking score from theme match, scripture match, freshness, familiarity, and service-role fit
* never let unavailable songs or archived songs outrank active songs

### `POST /services/search`

Purpose:
Resolve the target service before planning or saving.

Request behavior:

* accept `query`, `filters`, or both
* support direct date searches cleanly
* prefer exact date and title matches over loose text similarity

Response behavior:

* return concise service summaries
* include `planningStatus` and `specialElements`
* include warnings when results are ambiguous

Recommended backend notes:

* this endpoint should help the GPT avoid creating duplicate services
* if multiple services match closely, the GPT should summarize candidates instead of guessing

### `POST /services`

Purpose:
Create a new planning shell only when retrieval did not find the right service.

Request behavior:

* backend generates `serviceId`
* title and service date are required
* all other planning fields are optional

Response behavior:

* return the full created service record
* include generated `serviceId`

Recommended backend notes:

* use a stable ID pattern such as `svc_...` or a UUID
* optionally enforce uniqueness on `serviceDate + campus + serviceType`

### `POST /services/{serviceId}/setlist/suggest`

Purpose:
Return a draft recommendation, not a saved plan.

Request behavior:

* merge existing service context with any request overrides
* support constraints like freshness, keys, team skill, and service length

Response behavior:

* always return:
  * `recommendedSetlist`
  * `alternates`
  * `planningRationale`
  * `warnings`
  * `missingContext`
* optionally return:
  * `planningDirections`
  * `confidence`

Recommended backend notes:

* if context is strong, return one primary recommendation with medium or high confidence
* if context is thin, return 2 to 3 planning directions and mark confidence low
* suggestion generation should use explicit structured output so the backend validates what the model returns before passing it on

## Validation Rules

Recommended validation:

* reject empty search requests with no `query` and no `filters`
* normalize scripture references and date fields before search
* constrain enums for energy, tempo, planning status, and arrangement complexity
* trim empty strings to null where possible

## File Upload Verification

The GPT schema now allows `openaiFileIdRefs` items to be strings or objects.

Backend recommendation:

* log the real incoming payload shape in early testing
* normalize both forms into one internal file reference shape
* fail clearly if the payload arrives without usable file references

Do not treat chat-visible files as saved until the backend confirms persisted assets.
