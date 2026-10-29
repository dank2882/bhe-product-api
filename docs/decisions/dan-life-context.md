# Life Context and Voice Profile MVP

Date: October 28, 2026. Current status: deployed and fresh ChatGPT read acceptance
verified after Dan approved release. Profiles remain uninitialized; no production
profile content was written. The discovery and local-review sections below retain
the evidence available at that earlier review stop. See the release receipt at end.

## Authority and accepted scope

Dan requested discovery followed by the smallest useful vertical slice through
the existing Life OS connection, with no inferred profile population or production
profile writes. His explicit privacy clarification was: “Life Context Dan-only;
preserve Voice Profile delegation.” This does not approve any profile content.

Sources reviewed: live Developer Tools context for Correspondence and the core
repository; the engineering constitution and context index; platform ADRs 0003,
0018/0019, 0021, 0025, 0031, and the accepted Correspondence Desk decision
`docs/adr/0035-dan-correspondence-desk.md`. Registry release observations were old;
direct Cloud Run inspection separately identified current ready revisions
`bhe-product-api-00337-wj2`, `bhe-correspondence-api-00028-cuw`, and
`dan-life-os-mcp-00043-s4v`. These observations do not prove this change is live.
The connected Life OS Voice Profile read returned `profile:null, setupRequired:true`.

## Reuse and minimal additions

| Concern | Owner and implementation |
| --- | --- |
| Life Context | `owner: dan`, `serves: [dan]`, domain `life-context`; existing core API and Firestore, additive `danLifeContext/profile` document |
| Voice Profile | Existing Correspondence API/database and subject-keyed `VoiceProfiles` collection; no second voice store |
| Client | Existing single Life OS MCP and its existing Entra `access_as_user` scope |
| Authorization | Life Context follows the established Finance Forecast primary-subject Dan-only pattern; Voice Profile retains existing delegation |
| Durable changes | Existing transaction, expected-version, immutable revision, and idempotency receipt patterns |

The capability gap is structured approved personal context, separate from voice
and operational records. A bounded document in the existing core database is
smaller than a new service/database and avoids putting a biography in tasks,
notebooks, correspondence, relationships, or sermons. It is a separate owning
module, not a merged Life OS database. No new OAuth client, scope, credential,
cloud resource, index, queue, model inference, embedding, or transcript intake.

Life Context sections are `roles`, `convictions`, `leadershipPhilosophy`,
`communicationPreferences`, `longTermGoals`, and `currentLifeContext`. Each
entry has a stable ID, exact text, a source reference, and one provenance kind:
`original_statement`, `confirmed_fact`, or `ai_summary`. Confirmed facts mean
Dan confirmed them; the service does not independently verify external facts.
AI summaries must reference existing original/fact entry IDs and remain labeled.
Source references are provenance pointers, not authority to fetch or copy another
domain's private record. No personal content ships in this implementation.

All six arrays are supplied for an approved replacement. Empty arrays mean unknown
or explicitly cleared. Text is preserved exactly. Bounds: 20 entries per section,
4,000 characters per entry, 200KB per document. The command requires explicit
approval, approval note, current version, and stable idempotency key. The
transaction writes the profile, immutable revision, actor/timestamp and receipt
atomically. The fingerprint binds actor, prior version, content and approval note.
No drafts are automatically saved; proposals are reviewed before an approved save.

Voice Profile adds optional `teachingTone` and example `context` values personal,
pastoral, business, teaching. Older input and fingerprints remain supported.
Old examples remain unclassified; they are never silently assigned a context.
Older clients that omit the optional teaching tone or tags on unchanged exact
example references retain those approved additions. An explicit empty teaching
tone clears it; changing an example's record/version/field never inherits a tag.
Selected examples remain references to existing exact record IDs/fields/versions.
Explicit profile approval is still mandatory. No sample is automatically learned.
Revision reads reuse the existing immutable revision subcollection. Existing
delegates can still read and edit with their own attribution; no grant is added.

## ChatGPT operations and demonstration

`life_context_get` accepts explicitly selected `sections` and optional
`voiceContext`. It first calls core `POST /life-context/query` to authorize Dan
and retrieve only selected sections, then optionally retrieves the requested
context from the existing Correspondence endpoint. Denial stops before the voice
call. Upstream failure is an error, never an empty/uninitialized profile. There is
no cross-domain stored copy. `sections:[]` supports voice-only selection through
this Dan-only combined tool. Sarah keeps using the existing Voice Profile tools.

Example request: “Help draft a pastoral note using my approved preferences.”

```json
{"sections":["communicationPreferences"],"voiceContext":"pastoral"}
```

With uninitialized profiles the response indicates `setupRequired:true` for each
source. ChatGPT says approved context is not set up and asks Dan to choose the
wording/examples he wants reviewed. It must not present chat memory as an approved
profile. With approved data, only the selected life section, shared voice rules,
pastoral tone and explicitly pastoral example references are returned. Roles,
convictions, goals, unrelated tones, and example bodies are excluded. Source
records must be read separately with their existing permissions and exact version.
The resulting note is a review draft; profile retrieval grants no send permission.

Management: read all six sections; show the complete proposed replacement and
removals; obtain Dan's natural-language approval; call `life_context_update` with
the current version, approval note/confirmation and stable key; independently call
`life_context_get`. `life_context_get_revision` reads selected sections of one
exact old revision. Approval notes remain in immutable backend history and are
excluded from selective context responses. Voice management reuses
`correspondence_update_voice_profile` and `correspondence_get_voice_profile`, now
with optional `context` and exact `version` on reads. No production writes were run.

## Acceptance and release gates

Automated acceptance covers empty reads without seeding, exact text/provenance,
selection/privacy, missing approval, invalid shapes, invalid summary references,
transactional versions/history, concurrent stale writes, replay/key mismatch,
denial to delegates/admins/injected aliases, preserved voice delegation and actor
attribution, legacy voice compatibility, teaching/context selection, MCP discovery,
annotations, transport, and failure handling. Fixtures are synthetic.

Run core, Correspondence, and platform checks/tests; inspect diffs; commit exact
reviewable changes in each owning repository. The established release process
requires a clean checkout already on GitHub main, backend releases before gateway,
explicit traffic verification, durable evidence/readback, maintained instruction
distribution, and fresh intended-user ChatGPT acceptance. No production deployment
is part of this review stop. Correspondence began with ten pre-existing local
commits ahead of its tracking branch; reconcile that history before release.

After review, verify deployed allow/deny reads and uninitialized state without
profile writes. Any real sample/profile save needs separate content approval.
Fresh ChatGPT discovery and demonstrated use remain independent gates; local SDK
clients are not proof of installed ChatGPT availability. Roll back code by routing
to the prior service revisions; additive documents/revisions remain intact. No
destructive migration or automatic restore is needed.

## Local verification receipt

All three `npm run check` commands passed. Full suites passed: core **906**,
Correspondence **54**, platform **244** tests (**1,204 total**). A compatibility
follow-up preserves approved optional voice fields when older clients omit them;
Correspondence checks and its full suite were rerun after that change.

Run the local synthetic demonstration from `bhe-agent-platform`:

```sh
node scripts/demo-life-context.mjs
```

It uses the actual Life Context functions, Correspondence profile model/repository,
and a fresh MCP SDK client over an in-memory transactional test store. Optional
arguments specify the core and Correspondence checkout paths. It first verifies
uninitialized reads create nothing, then uses explicitly fictional fixtures and
shows selected retrieval at version 1 while asserting unrelated sections/tones
are absent. This is local module/MCP verification, not live HTTP, OAuth, Firestore,
or installed ChatGPT acceptance. No credentials or external backend calls occur.

## Approved release receipt — October 28, 2026 Pacific

Dan approved proceeding with the existing MVP release. This did not authorize
profile population or implementation of the proposed 6:25 a.m. collection pipeline.
Released from clean checkouts whose exact commits were first pushed to GitHub main:

| Service | Deployed source commit | Serving revision |
| --- | --- | --- |
| Core API | `fb0f41692c4df4ef8fc7abfbe83d1777222833df` | `bhe-product-api-00338-72n` |
| Correspondence | `e34a63784ec3cb04e9139490580b0ebe7046d83c` | `bhe-correspondence-api-00028-nh2` |
| Life OS MCP | `f693143a41fabc2fedb1679efbd64af7ec94792c` | `dan-life-os-mcp-00044-vsj` |

All three serve 100 percent of production traffic. Release helper records were
independently read back. Runtime configuration hashes excluding container image
matched before/after, including existing service identities and environment.
Previous serving revisions for rollback are `bhe-product-api-00337-wj2`,
`bhe-correspondence-api-00028-cuw`, and `dan-life-os-mcp-00043-s4v`. No rollback was
performed. The earlier Correspondence branch-history concern was reconciled:
the prior deployed source label was `4536e2a`, the immediate parent of this MVP
commit; the ten pre-existing commits were already part of the deployed lineage.
This is source-label evidence, not a byte-level extraction of the prior container.

The clean release checks and all 1,204 tests passed again. Eleven production
read-only backend checks passed: selected empty Life Context, missing historical
revision, unrelated actor denial, identity-alias denial, all four empty voice
contexts, unrelated voice-owner denial, preserved configured voice delegation,
and Life Context denial for that delegate. These backend checks use the existing
service credential and actor headers; they are separate from actual OAuth client
acceptance. No production write tests or profile saves were performed.

The existing ChatGPT listing was updated in place from 1.0.15 to 1.0.16, preserving
the original app binding and package identity. The downloaded saved ZIP matched
all 17 submitted files. Codex Life OS was updated through its existing local
marketplace to 1.0.20; all 15 installed skill/reference files matched the source.
Platform commit `2c114a8` is package-version metadata only, after the deployed
runtime source commit; it does not represent another runtime deployment.

Fresh intended-user ChatGPT Work acceptance succeeded in
[Life Context Read Result](https://chatgpt.com/c/6ae2bdf2-b3e0-83e8-bdf6-c7a4802f5110).
It used `life_context_get` with `sections:["communicationPreferences"]` and
`voiceContext:"pastoral"`. Both profiles returned null and setupRequired:true;
Life Context returned version 0 and exactly the selected section. ChatGPT stated
that no approved profile content was available and inferred nothing. Independent
Cloud Run request logs corroborated HTTP 200 reads at 03:31:28.869915Z (core) and
03:31:29.055511Z (Correspondence) on October 29 UTC. The combined operation does
not expose the backend request ID; ChatGPT correctly reported none returned.

Developer Tools evidence, each independently read back:

- `life-context-live-reads-20261028`
- `life-context-chatgpt-acceptance-20261028`
- `life-context-instructions-20261028`

Coverage limits: populated retrieval, transactional saves, corrections, approval
and revision behavior are proven with synthetic automated tests; production
acceptance intentionally covers empty reads only. Existing dependency audit
findings remain in unchanged lockfiles and need separate maintenance. GitHub
hosted workflow status was not independently checked; the required repository
checks and full test suites ran in the clean release checkouts and release helper.
This release changes neither OAuth configuration nor its long-term refresh claim.

Next work remains the separately reviewed desktop collection proof: a manual,
bounded source collection and proposed GCP contextualization contract before
scheduling 6:25 a.m. Pacific. No collector, new cloud processor, automation,
embedding store, inferred profile, or automatic voice learning was introduced.
