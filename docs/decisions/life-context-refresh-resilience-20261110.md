# Daily Life Context refresh resilience

Accepted by Dan November 10, 2026: implement all three proposed changes, test,
deploy, recover today's context once, and resume the existing daily08:30Pacific
scanner. This supersedes pause-on-every-validation-failure and invalidation on
every refresh. Existing ownership, authorization, evidence bounds and release
requirements remain.

Supporting quotations may contain up to2000 characters, the existing source
excerpt bound. They must still be exact contiguous source substrings with valid
citation identity. No truncation or quote rewriting. Summaries remain600
characters,20 observations,6 citations each; provider output/token bounds stay.
Prompt v12 updates the length instruction and retains attribution safeguards.

Collection's optional intent is refresh (default) or correction. Ordinary
refresh leaves the prior snapshot usable only until its original expiry,
without changing timestamps, observations, source checkpoints, or existing
invalidation. Explicit correction and the existing reprocess operation invalidate
the superseded snapshot before inference, including budget refusal. Existing
invalidations are never cleared by failure. Successful publication replaces the
snapshot atomically. Existing request fingerprints remain stable when intent
is omitted. No migration automatically revives historical context.

Failed refreshes persist a bounded counter and recovery action in the owning
current record/run receipt. First recognized unpublished validation rejection:
next_scheduled_day; never same-day retry. Second consecutive failure:
pause_for_review. Provider/unknown failures, correction failures, transport
ambiguity, stalled runs, version conflict, authentication/permission/budget
failures, and semantically inaccurate published output require review. Success
resets the counter; replay cannot increment it. This is bounded recovery, not
approval of rejected observations. Client follows the durable receipt.

For November10 only, Dan approved one fresh bounded recovery after the failed
normal run. Original evidence was not retained after the failed attempt; do
not substitute the previous day's saved revision and call it today's context.
Use life-context-v12-recovery-20261110, temporarily permit only one additional
daily inference under the unchanged monthly ceiling, and restore daily1 in
all outcomes. Original failed receipt remains audit history. Independently
verify current state, citations, meanings and approved profiles before resume.

Tests cover exact408/2000 and altered/2001 quotes, failed refresh retention and
expiry, repeated-failure pause, success reset, replay, correction invalidation
on failure/budget refusal, MCP intent validation and authorization boundaries.
Deployment and live recovery evidence are recorded separately in Developer
Tools. Future scheduled delivery, cold-start/token refresh and sleep recovery
remain separate acceptance gates; awake/connected Mac and Codex open required.
