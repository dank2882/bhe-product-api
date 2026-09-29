# Repository engineering guidance

## Engineering context retrieval

Before diagnosing, planning, reviewing, or changing FBC, GO Missions, BHE, Dan,
or shared-platform systems, retrieve the relevant Developer Tools context and
read the linked accepted decisions and incident notes. This applies to repairs
and recurring symptoms, not only new components.

Use `/Users/danielkirchner/Documents/bhe-agent-platform/docs/engineering-context-index.md`
to select sources by topic and repository. If registry tools are absent or
unauthenticated, state that limitation and read the indexed Git sources before
forming a diagnosis. Do not treat an installed skill as a working connection.
Briefly identify the sources reviewed, applicable constraints, and open
verification gates before proposing changes. Verify current state separately.
Do not call a reconnect or immediate successful request a durable OAuth fix;
verify after token expiry and again the following day. Record implementation
and verification separately in the owning records, with independent read-back.
