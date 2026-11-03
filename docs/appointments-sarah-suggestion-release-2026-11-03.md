# Optional Sarah contact — November 3, 2026

Accepted decision: [optional contact](decisions/appointments-family-suggestion.md).
Implementation: core `3c71688`; platform `5708ce3`, packaging scope `b40382d`.

## Verified implementation and deployment

- Core `npm run check` and all 927 tests passed; gateway check and all 254 tests
  passed. Focused appointments/ministry-calendar run: 36 passed.
- Tests include outside-hours booking and participant confirmation without Sarah,
  retained Dan approval/conflict checks, contact setup missing, normal-hours and
  travel suggestions, legacy declines, optional legacy notices, and preserving
  the mode during older-client settings edits.
- Deployed from the current production source archives, replacing only three
  appointment backend files and the gateway appointment tool file. Their baseline
  bytes matched repository HEAD before editing. Unrelated newer repository work
  was not included. Existing runtime specifications matched exactly apart from
  container image, including environment, secret bindings and service identity.
- Tagged core candidate exposed catalog 1.0.3 and read the existing version 2
  policy before activation. Both `bhe-product-api-sarah-1103a` and
  `dan-life-os-mcp-sarah-1103a` independently report 100 percent normal traffic.

## Live policy and readback

The connected owner-authorized command changed policy version 2 to 3 with
`approvalMode: suggestion`, preserving enabled state, normal windows, timezone,
channel, contact and configured identity byte-for-byte. Stable command key:
`dan-sarah-optional-contact-20261103-v2`.

Write receipt: `bf2abeab-5414-44ce-87e4-06bda58508ab`.
Independent policy read: `6c9c496e-705f-4ae2-9c44-490a8b8a2b97`.
The read confirms suggestion mode and no required setup.

Connected appointment-list read returned eight records. All project
`required: false` and no family booking blocker. One existing outside-hours
arrangement projects `contactSuggested: true` and `booking.state: ready_to_book`.
This was read-only: no real appointment, Outlook event, message or approval
evidence was created or changed for verification.

## Limits and recovery

This verifies the deployed backend, connected operation catalog, saved policy
and existing-record projection. A separate fresh ChatGPT conversation and a real
external booking under the changed policy were not exercised. Gateway tool
guidance and repository plugin guidance are updated; a ChatGPT static plugin
package republication was not performed in this release.

Previous traffic revisions: core `bhe-product-api-00364-gkk`, gateway
`dan-life-os-mcp-00047-ss6`. Do not blindly roll back core: the old code ignores
approvalMode and would restore the requirement. Prefer a forward repair that
preserves Dan's accepted optional-contact policy. Reinstating mandatory approval
requires Dan's explicit instruction.
