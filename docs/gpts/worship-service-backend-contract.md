# Worship Service Backend Contract

This document defines the recommended backend contract for the first four live endpoints:

* `searchSongs`
* `searchServices`
* `createService`
* `suggestServiceSetlist`

The goal is to make the GPT reliable before write-heavy workflows are added.

## Principles

* Backend generates `serviceId`
* action contract compatibility is part of feature completion
* search supports free text, filters, or both
* responses return raw structured data, not narrated prose
* suggestion responses always include rationale, warnings, and missing-context signals
* low-confidence planning should return multiple viable directions

## Vertical Slice Rule

This contract should not be treated as backend-only planning.

For each GPT-facing slice:

1. implement the backend endpoint
2. test the backend directly
3. wire or update the Custom GPT action schema
4. test the feature through real GPT prompts
5. only then mark the slice complete

A slice is not complete if the backend works but the Custom GPT cannot use it reliably.

## Contract Freeze Rule

Freeze the action contract early within each slice and keep it synchronized with the backend.

Acceptance criteria should include:

* request payload shape matches what the GPT actually sends
* response payload shape is easy for the GPT to reason over
* error payloads are consistent and usable in GPT recovery flows
* nullability, enums, and required fields stay aligned between schema and backend

If the backend behavior changes, the action schema should be updated in the same milestone, not later.

## Prompt Regression Rule

Maintain a small real-world prompt test set and rerun it at each milestone.

Use prompt regression checks to catch:

* schema drift
* payload mismatch
* weak error handling
* overly chatty or ambiguous response shapes
* planning behavior that looks correct in backend tests but fails in the Custom GPT

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
* validate the response shape through real GPT prompts before treating the endpoint as done

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
* test ambiguous-result handling through the Custom GPT, not only backend unit tests

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
* verify that the GPT can successfully create and then reference the returned `serviceId`

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
* validate that the GPT can consume warnings, missing-context fields, and alternates without response-shape confusion

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
