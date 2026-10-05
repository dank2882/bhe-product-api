# Church People, Care and Ministry Follow-through

Accepted October 5, 2026. Dan explicitly requested implementation of the complete
plan following the October 4 design. Registry: `fbc-church-people-20261005`.
Owner: FBC. Serves FBC and Dan. Status: accepted; implementation and live/user
verification are recorded separately in the release evidence.

## Decision and ownership

Extend the existing Pastoral Care API/database with ordinary relationship
records, external outreach identities, groups, interactions and follow-through.
Breeze owns directory fields, households and classifications. Ordinary context
uses `careRelationships`; unique Breeze links use `careRelationshipIdentities`;
groups reuse `careGroups`. These do not read or copy restricted care collections.
Existing member notes, Extended Care and NoteBird history remain unchanged.

Ministry Overview owns shared ministry needs. One coordinating matter may be
referenced by another ministry and a care group; source permissions are checked
independently. A task link never resolves the broader need. Task Management owns
agreed assignments, acceptance, timing and completion. Breeze and Outlook retain
church events and personal commitments. No new service, database, OAuth app,
scheduler, autonomous process or dashboard is introduced.

## Permissions and continuity

Existing `tasks.read`/`tasks.write` permissions admit ordinary relationship tools,
then backend record grants enforce access. They do not map to care worker/leader
roles or care-record scopes. Exact configured Dan identities and his existing
explicit delegate may manage ordinary grants, group leadership and identity links.
Other authors may capture ordinary outreach context and edit only explicitly
permitted records. Linking a new directory person requires the manager or an
existing directory-search permission. Group membership and leadership do not
grant person or restricted-note access. Linked sources retain their own checks.

Writes preserve exact source separately from interpretation and transactionally
commit the record, immutable history, content-free audit and actor-scoped receipt.
Retries authorize current access before replay; changed requests and stale
versions conflict. Source dates never refresh on reads. Breeze links require
explicit identity evidence, current source verification and a unique binding.
An existing conflicting relationship fails for deliberate reconciliation rather
than silently merging access or losing history. External identity history stays
in its original relationship record after linking. No Breeze record is written.

## Interfaces and reviews

The care API exposes `/pastoral-care/church-people/operations`, `/query`, and
`/command`, through three tools on the existing Life OS and FBC Staff gateways.
The live catalog describes exact required/optional arguments. Supported behavior:
people/household/group reads, ordinary capture/update and interactions, explicit
person/group access, leadership and participation, confirmed Breeze linking,
follow-through capture/update and links to existing tasks/ministry matters.

Review output is compact and paginated; it includes source limitations and gaps,
keeps leader-owned items as awareness, and never changes state. It feeds existing
daily and weekly/monthly reviews. Meeting Front Load supports opaque church_people
references and ministry_overview references. Weekly/monthly ministry reviews
include unresolved matters even before their dated return; daily priority still
uses due conditions. No notification service is added.

For agreed ordinary tasks use `sourceType: church_people_action` and
`sourceMessageId: personId:followThroughId`. Search/reconcile that key before
creating again, independently retrieve the actual task, then link it. Failed
linking leaves the original need and task recoverable; never duplicate the task.
Confidential instructions continue to use restricted care, not this workflow.

## Pilot

Use the existing Women's Ministries profile, record Shawna's reported leadership,
and establish Member Care with Sarah's reported leadership. Save the original
October 4 wording once as the Women's Ministries matter "Widows fellowship and
mutual care"; link Member Care and the ordinary group to that exact matter.
Give selected explicit ordinary grants, leave organizer/participants/schedule
unconfirmed, and return the concern through the existing review. Participants do
not need accounts. No messages, invitations or appointments are authorized.

## Acceptance and rollback

Require unit/contract tests for identity, exact wording, access/revocation,
restricted-note separation, concurrency/replay, stale/unavailable directory,
review pagination, dates, shared-matter continuity and task-link failure recovery.
Deploy candidates to existing services, exercise synthetic records with allowed
and denied actors, archive fixtures, then verify exact production pilot records.
Record installed/published tool and skill evidence separately from backend tests.
Dan, Shawna and Sarah must each complete fresh signed-in client acceptance;
service-to-service actor tests cannot substitute for those sessions.

Roll back gateway traffic before core/care traffic to recorded prior revisions.
New collections and additive fields remain valid; do not delete operational data.
Preserve existing dirty worktrees and all unrelated deployment settings/tags.
