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

1. use [worship-service-gpt.instructions.txt](/Users/danielkirchner/Documents/bhe-product-api/docs/archive/legacy-root-files/worship-service-gpt.instructions.txt) as the first system prompt
2. use [worship-service-gpt.schema.json](/Users/danielkirchner/Documents/bhe-product-api/docs/archive/legacy-root-files/worship-service-gpt.schema.json) as the first action schema
3. fork the current backend patterns into service-specific routes
4. start with retrieval and suggestion actions before adding write-heavy mutations
5. only add OCR if your team will actually upload sermon PDFs or scanned planning notes

## Suggested Next Backend Slice

If we turn this into code next, the best first implementation would be:

* add a `services` collection
* add a `songs` collection
* implement search and retrieval endpoints first
* add one suggestion endpoint that calls OpenAI using structured JSON output
* delay save endpoints until retrieval and draft quality are stable

That gets you a usable internal planning GPT quickly, while preserving the architecture we already proved out here.
