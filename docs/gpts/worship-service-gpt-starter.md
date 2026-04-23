# Worship Service GPT Starter

This repo is already very close to what a church service-planning GPT needs.

You do not need a brand-new stack. The fastest path is:

1. keep the current pattern of `instructions + OpenAPI schema + backend actions`
2. swap the domain from `products` to `services`
3. simplify the data model around songs, service plans, and supporting notes

## What We Can Reuse

From the current BHE build:

* [docs/gpts/product-builder.instructions.md](/Users/danielkirchner/Documents/bhe-product-api/docs/gpts/product-builder.instructions.md) gives us the current source-of-truth pattern for a domain-specific system prompt
* [docs/gpts/product-builder.schema.json](/Users/danielkirchner/Documents/bhe-product-api/docs/gpts/product-builder.schema.json) gives us the current source-of-truth pattern for GPT Actions via OpenAPI
* `index.js` already shows the backend structure for:
  * record lookup
  * search
  * draft generation
  * save-after-approval workflows
  * file upload handoff via `openaiFileIdRefs`
  * OCR and source-text prep when uploaded documents need to be parsed

## Domain Mapping

Suggested mapping from the existing product workflow to service planning:

* `product` -> `service`
* `product search` -> `service search` or `song search`
* `source files` -> sermon notes, theme notes, Planning Center exports, song charts, lyric sheets
* `OCR/source text` -> extracted text from sermon notes or planning documents
* `generate draft` -> propose a setlist and order of service
* `draft save` -> save the approved service plan
* `content save` -> save finalized notes, transitions, and arrangement details

## Recommended V2 Data Model

Keep the first implementation focused, but add enough metadata to support real planning judgment. A service record can look like this:

* `serviceId`
* `title`
* `serviceDate`
* `series`
* `season`
* `theme`
* `scripture`
* `sermonTitle`
* `serviceType`
* `planningNotes`
* `constraints`
* `setlist`
* `orderOfService`
* `teamNotes`
* `planningStatus`
* `campus`
* `congregationProfile`
* `audienceNotes`
* `specialElements`
* `serviceNotes`

Each setlist item can include:

* `songId`
* `title`
* `artist`
* `key`
* `tempo`
* `energy`
* `slot`
* `reason`
* `notes`

Each song record should also carry planning signals such as:

* `familiarityScore`
* `lastUsedDate`
* `usageCountLast90Days`
* `vocalRange`
* `serviceRoleSuitability`
* `arrangementComplexity`
* `congregationFit`

## Recommended GPT Workflow

The GPT should usually work like this:

1. identify the target service or create a draft service shell
2. gather the theme, scripture, sermon direction, and practical constraints
3. search the song library and recent usage history
4. suggest a setlist with reasons for each choice
5. suggest an order of service with transitions and timing
6. wait for approval before saving

## V2 Actions To Build

The archived example schema in [worship-service-gpt.schema.json](/Users/danielkirchner/Documents/bhe-product-api/docs/archive/legacy-root-files/worship-service-gpt.schema.json) includes a cleaner contract:

* `searchSongs`
* `getSong`
* `searchServices`
* `createService`
* `getService`
* `suggestServiceSetlist`
* `saveServiceSetlist`
* `saveOrderOfService`
* `uploadServicePlanningFiles`

That is enough for a useful first GPT without rebuilding everything.

The backend contract draft is here:

* [docs/worship-service-backend-contract.md](/Users/danielkirchner/Documents/bhe-product-api/docs/worship-service-backend-contract.md)

The prompt regression set is here:

* [docs/gpts/worship-service-prompt-regression-set.md](/Users/danielkirchner/Documents/bhe-product-api/docs/gpts/worship-service-prompt-regression-set.md)

The current Slice 1 GPT artifacts are here:

* [docs/gpts/worship-service-slice1.instructions.md](/Users/danielkirchner/Documents/bhe-product-api/docs/gpts/worship-service-slice1.instructions.md)
* [docs/gpts/worship-service-slice1.schema.json](/Users/danielkirchner/Documents/bhe-product-api/docs/gpts/worship-service-slice1.schema.json)

## Operating Rule

Do not treat backend completion as feature completion.

For this project, a major feature slice is only done when it works end to end through the Custom GPT interface.

That means each major slice must move in this order:

1. implement the backend endpoint or backend behavior
2. test the backend behavior directly
3. wire or update the Custom GPT action schema
4. test the feature through real GPT prompts
5. only then mark the slice complete

No major backend layer should be built without validating that the Custom GPT can actually use it successfully.

## Vertical Slice Policy

Build in vertical slices, not backend-first and GPT-last.

Recommended rule:

* create the Custom GPT early, even if it is primitive
* freeze the action contract for the current slice before broad backend expansion
* keep the OpenAPI schema synchronized with backend behavior as part of the slice
* treat payload shape, error behavior, and GPT usability as acceptance criteria

If the backend works in isolation but the GPT cannot use it reliably, the slice is not done.

## Contract Discipline

For each GPT-facing slice:

* define the request and response shape early
* keep schema field names, enums, nullability, and error responses aligned with live backend behavior
* test the real payload shape coming from the GPT, not only idealized local payloads
* prefer small contract changes over drifting backend behavior

The action contract should be stable within a slice.
If it changes, the GPT schema and prompt tests should be updated immediately in the same milestone.

## ChatGPT Setup Notes

Current OpenAI help and docs indicate:

* GPTs are created and edited in the ChatGPT web GPT editor
* a GPT can use either apps or actions, but not both at the same time
* actions use OpenAPI JSON or YAML schemas
* action endpoints should stay fast and small, with request and response payloads under platform limits
* for file handoff in GPT Actions, the POST parameter name must be `openaiFileIdRefs`

## Recommended GPT Editor Fields

Suggested GPT name:

* `Service Planning Assistant`

Suggested description:

* `Helps worship leaders choose songs, balance the set, and build a clear order of service using church-specific planning context and song library data.`

Suggested conversation starters:

* `Plan this Sunday service around John 15 and communion.`
* `Suggest 4 songs for an Easter service with a strong response moment.`
* `Review last week's service and suggest a fresher opening set.`
* `Lay out a full order of service for a 70-minute gathering.`

## Recommended Build Order

1. define and approve the canonical song import rules in [worship-service-song-catalog-spec.md](/Users/danielkirchner/Documents/bhe-product-api/docs/gpts/worship-service-song-catalog-spec.md)
2. create the earliest usable Custom GPT shell using [worship-service-slice1.instructions.md](/Users/danielkirchner/Documents/bhe-product-api/docs/gpts/worship-service-slice1.instructions.md) and [worship-service-slice1.schema.json](/Users/danielkirchner/Documents/bhe-product-api/docs/gpts/worship-service-slice1.schema.json)
3. build the next feature as a vertical slice: backend behavior, schema update, GPT prompt validation, then completion
4. keep the prompt regression set current and rerun it at every milestone
5. start with retrieval and suggestion actions before adding write-heavy mutations
6. only add OCR if your team will actually upload sermon PDFs or scanned planning notes

## Suggested Next Slice

If we turn this into code next, the best GPT-facing slice would be:

* freeze the action contract for the first GPT-visible read workflow
* implement the smallest live backend endpoint that supports it
* wire the Custom GPT schema to that endpoint immediately
* test it through real prompts
* only then extend to the next endpoint

That keeps the planning stack honest early, when mismatches are still cheap to fix.
