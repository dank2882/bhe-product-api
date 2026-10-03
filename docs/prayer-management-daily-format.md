# Dan's daily prayer-list format

Status: Accepted and implemented

Dan's daily prayer list has one stable presentation even though the prayers due
inside it change according to their schedules.

## Order

1. **Upward** — Dan's personal need and relationship with God.
   - Relationship with God
2. **Inward** — the things Dan needs, needs to face, and needs to fix.
   - Personal Needs and Growth
3. **Outward** — those closest to Dan first, then church, community, country,
   and the world.
   - Companion: Sarah; Dan & Sarah
   - Family and Friends
   - Church: staff; ministries; salvation; upcoming events and projects
   - Community: the existing health categories; college students; miscellaneous
     requests
   - Country: military
   - World and Missions: missionaries; missions agencies; missions projects

The numeric prefixes on the imported Logos lists remain the fallback mapping
for those subheaders. Prayer-specific encrypted `presentation` metadata may
override that fallback with `area`, `group`, `subheader`, and optional `order`.
This is required for prayers in `01. Personal` that belong Upward instead of the
default Inward placement, and for otherwise uncategorized current requests.

## Response contract

`getTodaysPrayers` continues to return the flat `prayers` array used by existing
record-prayed workflows. Each due prayer is enriched with:

- `number`: its continuous display reference for this response: `01`, `02`,
  `03`, etc., across all headings, without decimals or restarting. Above 99,
  continue with `100`, `101`, etc. Resolve these references against the current
  response to obtain durable prayer IDs before any numbered action;
- `note`: the exact `privateContext`, without rewriting;
- `sourceList`: the owning prayer-list heading and description;
- `presentation`: the resolved placement.

Dan approved this numbering correction on October 3, 2026.

The response uses `presentation.formatVersion: dan-upward-inward-outward-v2`
and live numbering/heading instructions. Headings are unnumbered; section,
group and subheader keys and ordering remain unchanged. The response includes the complete
section, group, and subheader template. Empty subheaders remain present so a
client can render the same structure every day. Each subheader carries ordered
`prayerIds` rather than duplicating private prayer content in the response.

The schedule remains authoritative for which prayers are due. Presentation
metadata must never change daily, interval, weekly, monthly, or one-date
rotation behavior.


## Release verification — October 3, 2026

- Implementation commit: `7c20d08`. All 806 backend tests, `npm run check`,
  and `git diff --check` passed. Coverage includes continuous numbering across
  sections, renumbering after prayed items clear, unnumbered headings, and
  the 09/10 and 99/100 boundaries through 200 prayers.
- Cloud Build `abed8056-7591-4e3b-87d3-c57dc6e7cdf5` completed. Revision
  `bhe-product-api-00321-952` is independently verified at 100% traffic.
  Rollback: `bhe-product-api-00339-tef`. Runtime configuration excluding the
  container image matched the prior revision; existing traffic tags remain.
- Life OS request `180eb47f-0328-42be-9a1d-9482a727bce1` and FBC request
  `b4fe0704-d88d-4202-b661-53ffb70ae3d5` both returned v2, continuous `01`
  through `52`, and no numeric fields on section/group/subheader headings.
- The 50 prayers captured before the release matched after release in every
  returned record field except display number. Two newly created records
  appeared during the work; no prayer mutations were issued by this repair.
- Maintained Life OS and FBC skills and their installed copies were checked:
  they contain no competing prayer-numbering rule. Rendering guidance is
  supplied by the owning backend with each response, requiring no plugin or
  gateway release. This verifies connected tool responses, not a separate
  fresh ChatGPT conversation's final rendering.
