# Mark Travel Advisor

Status: Accepted by Dan on September 30, 2026; implemented and deployed.
See [release evidence](mark-travel-advisor-release.md) for verified scope and
remaining Mark-client acceptance.
Approval: "yes go ahead with that".
Requested by: Dan Kirchner, September 30, 2026.
Intended user: `marks@foundedonfaith.com`.

## Outcome

Mark can dictate or type a trip summary and later retrieve the trip, people
and churches he met, what was discussed, and what he committed to do. Before
a return visit he can ask for the relevant history and outstanding follow-up.
Saved information survives a new chat.

## Recommended first release

- Give Mark Travel Advisor through the existing FBC Staff Tools connection.
- Reuse Travel Companion and Relationships code in the existing product API
  and Firestore deployment. Extend authorization and storage resolution for
  an explicitly enabled individual workspace; do not add Mark to Dan's
  private subject allowlist or delegation configuration.
- Resolve ownership from the authenticated, backend-approved staff identity.
  A request-supplied email or owner ID cannot grant access. Preserve current
  Dan endpoints, identifiers, historical records, and accepted delegation.
- Keep Mark's trips, relationships, original summaries, and interactions
  private by default. Sharing remains an explicit future action; no automatic shared access is
  authorized.
- Preserve the original summary alongside structured facts. Capture dates,
  destinations, people, churches, affiliations, contact details, discussion
  summaries, and commitments only when supplied. Preserve uncertainty and
  distinguish a firm promise from an idea. Review possible duplicate people
  using more than a name.
- Keep trip and relationship history in their owning domains. Put actionable
  follow-up in existing Task Management with links to the originating trip
  and interaction. Review that system's actual owner/admin visibility before
  describing a task as visible only to Mark. Keep sensitive narrative in the
  travel record. Do not guess due dates or create duplicate tasks on retries.
- Use Mark's own Outlook connection for explicitly requested timed calendar
  commitments, with read-back and a source link. Calendar access is a separate
  user acceptance check.
- Build a return-visit refresher on request from relevant locations, people,
  prior meetings, and task status. Automatic scheduled briefings, photo
  publishing, and historical imports are outside this first release.

## Example acceptance flow

Mark says: "On this trip I met Pastor James at Grace Baptist Church. I
promised to send the lesson material by Friday. We also discussed a possible
visit next spring."

The advisor preserves those words, resolves the trip and church without
guessing, records the meeting, captures the promised material as follow-up,
and leaves the possible visit as tentative. If Friday cannot be resolved
from the trip context, it asks for the date. A new chat can retrieve the
meeting and the linked follow-up's current status. Another user's request
cannot retrieve Mark's private travel notes.

## Verified baseline on September 30, 2026

- Developer Tools context and decision
  `adr-0011-dan-travel-companion-and-relationships` retrieved successfully.
  The accepted decision defines Dan-only ownership.
- Current code calls `requireDanPrivateAccess`, stamps `owner: dan`, and
  uses global Dan travel/relationship collections. Simply allowing Mark's
  subject would not create an independent workspace.
- Mark's exact staff profile is active at version 6 and has a verified
  Entra subject mapping. Its returned permission list has no travel scopes.
  This is backend profile verification, not Mark's fresh-client acceptance.
- Live product API revision `bhe-product-api-00304-8zn` and travel MCP
  revision `dan-travel-companion-mcp-00005-vbk` each serve 100 percent of
  production traffic. Deployment metadata alone does not verify behavior.
- No production access, records, OAuth configuration, or code changed during
  this investigation.

## Implementation and release gates

1. Accepted: per-user ownership, with Mark's notes private unless he chooses to share.
2. Inspect the current FBC gateway authorization and live operation contract
   before adding travel routing; reuse its existing identity and connection.
3. Scope collection access, exact-ID lookup, cross-record links, search,
   briefings, media, command replay, audit, and exports to the same verified
   owner. Preserve Dan's legacy records without broad migration.
4. Test Mark allow, Dan/Mark isolation in both directions, unrelated-user
   denial, disabled access, guessed IDs, cross-owner links, replay isolation,
   stale-version conflicts, and duplicate-safe follow-up creation.
5. Verify deployed revisions, representative allowed/denied backend actions,
   and independent read-back after each material write.
6. Under Mark's actual Microsoft sign-in, capture a summary and retrieve it
   in a fresh chat; verify linked follow-up. Test actual phone/voice use if
   that is his intended client. Never substitute a trusted backend actor
   test for this gate.
7. Record implementation and acceptance separately in Developer Tools.

## Sources and decision authority

- `bhe-agent-platform/docs/dan-engineering-constitution.md`
- `bhe-agent-platform/docs/engineering-context-index.md`
- `bhe-agent-platform/docs/adr/0011-dan-travel-companion-and-relationships.md`
- `bhe-agent-platform/docs/adr/0003-stable-identity-and-bounded-orchestration.md`
- `bhe-agent-platform/docs/adr/0022-team-scoped-task-authorization.md`
- `lib/dan-private-access.js`, `lib/dan-travel-companion-service.js`,
  `lib/dan-relationships-service.js`, and `lib/dan-travel-operation-registry.js`
- Live staff authorization profile and Cloud Run service metadata reads.

The repository working agreement requires involving Dan in consequential
architecture decisions. This proposal changes a single-owner domain into
reusable per-user workspaces; Dan accepted this specific implementation boundary after reviewing the proposal.
