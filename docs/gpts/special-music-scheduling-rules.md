# Special-Music Scheduling Rules and Preferences

Accepted direction from Dan, September 30, 2026. This is the canonical scheduling
policy, included in live operatorGuidance. It supersedes the earlier general
instruction to put families on Sunday nights wherever a special is needed.

## Spreadsheet status

These colors apply to **Special #1 and Special #2**:

- **Gray:** No special is needed. Do not fill this slot.
- **White with an entry:** Confirmed and ready to go.
- **Yellow and blank:** A special is needed; suggest someone and obtain confirmation.
- **Yellow with an entry:** A tentative suggestion, not a confirmed assignment.
- Do not infer the meaning of other colors or treat an unhighlighted blank as an opening.

## Service composition

- Try not to have **two solos in the same service**.
- When a service has **only one special**, do not use a flute or other instrumental solo. The special must be vocal.
- On **Sunday evenings with only one special**, do not use a family. Choose an eligible vocal soloist or non-family vocal group.
- On **Sunday evenings with two specials**, **Special #1 should be a family**. Place the other specialist in Special #2.
- A duet is not automatically classified as a family special. Use the established group classification and Dan’s direction.
- Do not assume an ensemble qualifies as a family, or rename an ensemble as a family to make it fit.

## Rotation and workload

- Prioritize eligible people and groups who have **not sung in a while**, especially those overlooked while others are repeatedly scheduled.
- Merely allowing a few weeks between appearances is not enough if other eligible specialists have been skipped.
- Check the schedule both **before and after** the proposed date.
- Count each person’s participation across **solos, duets, ensembles, family groups, and named choir features**. Different group names do not mean different people.
- Count both **confirmed assignments and named yellow suggestions** when evaluating potential workload.
- Check for morning-and-evening duplication on the same Sunday and other closely spaced appearances.
- Do not recommend someone already singing nearby and then leave Dan to discover the conflict.
- No fixed minimum interval between appearances has been approved.
- Historical schedule entries show recorded assignments, not proof that someone actually performed. Missing group membership or unnamed entries can limit rotation analysis.

## Specialist restrictions and corrections

- **Michaela Hogan:** Unavailable through **December 31, 2026**; roster availability resumes **January 1, 2027**.
- Michaela is in the **Reynolds Family**. Do not suggest that family or another lineup requiring her during her unavailability.
- **Dani Wolfe:** Correct spelling; **Tier 1—Wednesday nights only**.
- **Andy Lee:** Removed from the active specialist roster for now. Do not suggest him or a lineup requiring him.
- **Rick C / Steve M / Rich W:** Removed from the active roster; do not suggest this group.
- **Ladies of Liberty:** Do not schedule before **November 2026**.
- Use the current specialist roster’s service eligibility. A historical appearance does not override a current tier restriction.
- Confirm actual group members rather than guessing from surnames or group names. Do not assume a group remains usable without an unavailable member.

## Proposal and update workflow

- Recheck the live spreadsheet before each revision or authorized update; others may be editing it.
- Preserve confirmed entries and collaborators’ changes.
- Present a complete proposed lineup for each affected service so family order, solo/group balance, and individual overlap can be reviewed together.
- Keep proposals in chat for approval unless Dan explicitly asks to update the spreadsheet.
- When authorized to enter an unconfirmed suggestion, retain the yellow background. Do not mark it confirmed without confirmation.
- Independently reread changes before reporting success. If a collaborator changes a target cell, flag the conflict rather than overwriting it.
- If no suitable candidate has been verified, leave the opening unresolved rather than inventing eligibility, membership, availability, or repertoire.

## Pending direction

- Dan requested **Luke and his daughter** instead of **Daniel & Esmeralda** for the proposed November 4 special. Do not infer Luke’s identity or his daughter’s name.
- That proposal conflicts with a different entry subsequently found in the sheet and remains unresolved.
- Earlier suggested lineups in this chat are drafts, not blanket approval to schedule them. Reassess them against all the rules above.

## Additional accepted availability

- Audrey Foeller is unavailable October 1–31, 2026. A November booking is upcoming, not a completed performance. Use the live roster for the date window.
- The Tate and Lane families participate when in town. Check their windows and confirm in-town dates when unset. An open default is not proof they are in town.

## Required reasoning for each proposal

1. Read the live sheet and establish each special slot's color and contents. State the exact source and date range checked. If color cannot be retrieved, slot status and the number of required specials are unresolved; values alone cannot establish an opening.
2. Resolve the canonical profile, family/non-family classification, vocal/instrumental format, and actual members. Mark unknown identities or membership explicitly. Do not infer an instrument or format merely from profileType.
3. Apply current tier, status, profile availability and each known member's restrictions. A group cannot bypass a required member's unavailability. The Reynolds Family restriction does not establish that the separately named Reynolds Ladies is the same lineup; verify membership before recommending it.
4. Review recorded history and both earlier and later scheduled participation for every known member, including named choir features and tentative entries. Report actual dates and same-day overlaps, not an invented minimum interval. Do not claim complete coverage when the checked range or missing membership limits it.
5. Compare other eligible candidates, including those with unknown history, so a recent repeat is not preferred merely because that person's records are more complete. For a multiweek proposal, count the proposal's own assignments in subsequent choices.
6. Present the entire service lineup with Special #1 and Special #2 status, candidate, last recorded assignment, nearby person-level appearances, reason for selection, and unresolved checks. Explain exceptions to the preference against two solos. Do not silently override a restriction.
7. Approval to discuss a lineup is not approval to write it. Before an authorized write, compare the current target contents AND formatting with the reviewed snapshot. If the tool cannot preserve yellow or guard against a collaborator's change, leave the write unresolved; do not imitate a protected write with broad mutation.

## Current implementation boundary

The roster API enforces profile tier/status/date availability and supports
lastSangDate sorting. It does not yet implement a complete person-level workload
engine, canonical member identity resolution, vocal/instrumental classification,
or automatic propagation of a member's restrictions into every group. The
current readGoogleSheetRange operation returns values, not effective cell colors.
There is no focused special-performer write operation with a contents-and-format
concurrency check. These rules are durable operator policy, not evidence that
those missing automated checks exist. Report the missing checks and leave unsafe
recommendations or writes unresolved.
