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

- `number`: its numbered location in the current day's stable hierarchy;
- `note`: the exact `privateContext`, without rewriting;
- `sourceList`: the owning prayer-list heading and description;
- `presentation`: the resolved placement.

The response also includes `presentation.formatVersion` and the complete
section, group, and subheader template. Empty subheaders remain present so a
client can render the same structure every day. Each subheader carries ordered
`prayerIds` rather than duplicating private prayer content in the response.

The schedule remains authoritative for which prayers are due. Presentation
metadata must never change daily, interval, weekly, monthly, or one-date
rotation behavior.

