# Slice 9 Spreadsheet Planning Import Preview Review

## Summary

This review summarizes the generated dry-run preview at `tmp/music-planning-import-preview.json`. It is intended for human review before designing Firestore writes.

The preview parser treated `PROPOSED SCHEDULES` as a forward-looking planning source. All detected services and music slots default to `planningStatus: planned`; none are treated as actually sung or completed.

## Summary Counts

| Item | Count |
| --- | ---: |
| Workbook rows inspected | 203 |
| Non-empty rows inspected | 181 |
| Services detected | 157 |
| Services with at least one planned music slot | 39 |
| Services without populated music slots | 118 |
| Planned music slots detected | 135 |
| Warnings | 33 |

Service types detected:

| Service type | Count |
| --- | ---: |
| `prayer_service` | 51 |
| `sunday_morning` | 51 |
| `sunday_evening` | 51 |
| `special_event` | 4 |

Warning categories:

| Warning code | Count | Meaning |
| --- | ---: | --- |
| `ambiguous_special_music_cell` | 32 | Special/offertory-style cell may be performer/group text rather than a song title. |
| `services_without_music_slots` | 1 | Aggregate warning that 118 detected service rows have no populated music slots. |

The preview detected 34 hymn-numbered song slots.

## Sample Services With Music Slots

| Service | Source | Parsed slots |
| --- | --- | --- |
| `preview-svc-2026-01-07-prayer-service-r3`, Prayer Service, 2026-01-07 | Row 3, service cell `B3`, raw date/service `Jan 7th (Prayer Service)` | `C3` Congregational #1: `I am thine own Lord` |
| `preview-svc-2026-01-11-sunday-morning-r4`, Morning Service, 2026-01-11 | Row 4, service cell `B4`, raw date/service `Jan 11th AM` | `C4` Jesus Saves; `D4` Anywhere with Jesus; `E4` Saved by the Blood; `F4` New Name in Glory; `H4` Gabe & Abby D; `I4` Jessica S |
| `preview-svc-2026-01-11-sunday-evening-r5`, Evening Service, 2026-01-11 | Row 5, service cell `B5`, raw date/service `Jan 11th PM` | `C5` So Send I You (Dan solo first); `D5` Send the light; `E5` The Light of the World is Jesus; `I5` Williams family |
| `preview-svc-2026-01-21-special-event-r9`, Missions Conference, 2026-01-21 | Row 9, service cell `B9`, raw date/service `Jan 21st (Missions Conference)` | `C9` Bring them In; `D9` So Send I You; `H9` parsed as `K-2` from `FBCA Elementary (K-2)`; `I9` World We Never Touch from `Kara (World We Never Touch)` |
| `preview-svc-2026-03-01-sunday-morning-r36`, Morning Service, 2026-03-01, theme `Praise to God` | Row 36, service cell `B36`, raw date/service `March 1st AM` | `C36` #79 To God Be the Glory; `D36` #38 Blessed Be the Name; `E36` #32 Crown Him with Many Crowns; `F36` Honored, Glorified, Exalted |

## Sample Services With No Music Slots

| Service | Source | Notes |
| --- | --- | --- |
| `preview-svc-2026-04-01-prayer-service-r54`, Prayer Service, 2026-04-01 | Row 54, service cell `B54`, raw date/service `April 1th (Prayer Service)` | No populated music slots. Parser tolerated the ordinal typo. |
| `preview-svc-2026-04-05-sunday-morning-r55`, Morning Service, 2026-04-05 | Row 55, service cell `B55`, raw date/service `April 5th AM` | No populated music slots. |
| `preview-svc-2026-04-12-sunday-morning-r58`, Morning Service, 2026-04-12 | Row 58, service cell `B58`, raw date/service `April 12th AM` | No populated music slots. |

## Music Slot Breakdown

| Slot role | Count | Source columns |
| --- | ---: | --- |
| `congregational` | 89 | Congregational #1: 39; Congregational #2: 27; Congregational #3: 23 |
| `choir_opener` | 9 | Choir Opener |
| `special_music` | 32 | Special #1: 23; Special #2: 9 |
| `choir_special` | 5 | Choir Special |
| Offertory | 0 | No populated offertory slots were detected in this preview output. |

Title confidence:

| Confidence | Count | Interpretation |
| --- | ---: | --- |
| `high` | 103 | Song-like value from congregational, choir opener, or choir special columns. |
| `medium` | 12 | Special cell where a parenthetical value was parsed as a possible title. |
| `low` | 20 | Special cell that appears to be only a person/group assignment. |

## Warning Analysis

The 33 warnings look like a mix of acceptable planning gaps and parser/modeling questions, not a sign that the preview failed.

Most warnings are `ambiguous_special_music_cell`. These are concentrated in Special #1 and Special #2 columns where the spreadsheet often records who is singing, and sometimes records both performer and song in a pattern like `Performer (Song Title)`.

Examples that look like performer-only assignments:

| Source | Raw value | Current preview behavior |
| --- | --- | --- |
| `H4` | Gabe & Abby D | Creates a low-confidence special music slot with the same text as title and assignee. |
| `I4` | Jessica S | Creates a low-confidence special music slot with the same text as title and assignee. |
| `I5` | Williams family | Creates a low-confidence special music slot with the same text as title and assignee. |

Examples where parenthetical parsing appears useful:

| Source | Raw value | Current preview behavior |
| --- | --- | --- |
| `H8` | Gendro family (Around the Corner) | Assignee `Gendro family`, possible title `Around the Corner`. |
| `I8` | Jessica S (Heart For Souls) | Assignee `Jessica S`, possible title `Heart For Souls`. |
| `I9` | Kara (World We Never Touch) | Assignee `Kara`, possible title `World We Never Touch`. |

Examples where parenthetical parsing is probably wrong:

| Source | Raw value | Current preview behavior |
| --- | --- | --- |
| `H9` | FBCA Elementary (K-2) | Assignee `FBCA Elementary`, possible title `K-2`. |
| `H10` | FBCA Elementary (3-6) | Assignee `FBCA Elementary`, possible title `3-6`. |

The `services_without_music_slots` warning is an aggregate warning. It reflects 118 detected service rows with no populated music slots. These appear mostly to be valid service shell rows in the planning calendar, not parser errors. The import policy needs to decide whether those shell rows should become Firestore service records.

## Questions For Dan

1. Should date/service rows with no populated music slots import as service shell records, or should they be skipped until at least one planned music slot exists?
2. Should rows with a date but no theme and no music still import, or should the importer require either theme, music, or another planning signal?
3. Should Special #1, Special #2, Choir Special, and Choir Opener all become `serviceSongEvents`, or should performer-only special rows become a different kind of planned assignment?
4. For special music cells like `Performer (Song Title)`, should the importer split assignee and title automatically?
5. For values like `FBCA Elementary (K-2)`, should the parser treat the parenthetical as a group/detail note instead of a song title?
6. Should future planned services import before the schedule is finalized?
7. Should past spreadsheet rows remain `planned`, become `completed`, or import as `needs_confirmation` until someone confirms what was actually sung?
8. Should typo-tolerant date parsing be allowed for values like `April 1th`, or should those rows produce a stronger warning?

## Recommended Parser Adjustments Before Slice 10

1. Add an explicit service-row inclusion policy: include all detected service shells, include only services with music/theme, or include no-slot services only as placeholders.
2. Split special music fields into `assignedPersonOrGroupRaw`, `songTitleCandidate`, and `songTitleConfidence` instead of always treating the value as a song title.
3. Add special-case handling so grade-band values like `K-2` and `3-6` are not treated as song titles.
4. Add warning severities, such as `info`, `review`, and `error`, so acceptable blank planning rows do not look as concerning as parser ambiguity.
5. Keep hymn-number extraction as-is for congregational rows; the sampled hymn-numbered rows look clean.
6. Add an import-window option before Firestore writes so Dan can preview a limited month/range during early testing.

## Recommended Next Step

Before building Firestore writes, Dan should decide the service-row inclusion policy and special-music classification rules. The next implementation slice should be a parser adjustment and import-contract pass, still without Firestore writes, unless Dan decides the current preview behavior is acceptable enough to design the write model directly.
