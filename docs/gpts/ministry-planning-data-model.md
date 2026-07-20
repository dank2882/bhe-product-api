# Ministry Planning Data Model

This document defines the next planning layer for the Music Ministry Planning GPT.

The goal is to record local ministry wisdom as structured data before building recommendation or scoring logic. The GPT reads and edits these fields through the ministry planning dispatcher. Dan's request authorizes ordinary creates and updates; only permanent deletion or full-document replacement needs a separate confirmation.

## Current Scope

This slice supports:

* hard song-use guardrails
* leader readiness for Dan or another leader key
* local/non-hymnal special-music repertoire records
* leader learning interest for songs that are not ready yet
* seasonal and role-only usage
* chorus append/blend pairings
* local energy, tempo, and rotation judgments for future planning
* service-context fit such as Sunday morning, Sunday evening, or midweek
* active congregational pool filtering for ordinary service planning

This slice does not implement:

* automatic setlist recommendations
* scoring
* service-order generation
* post-service analytics

## Song Planning Guardrails

Store local song planning facts on canonical song records under:

```text
songs/{songId}.ministryPlanning
```

Recommended shape:

```json
{
  "schemaVersion": "song-ministry-planning-v1",
  "useStatus": "active",
  "allowedUsageRoles": ["congregational"],
  "blockedUsageRoles": [],
  "seasonalUse": [],
  "worshipFunctions": ["assurance", "testimony"],
  "serviceFit": ["sunday_morning"],
  "leaderReadiness": {
    "dan": "ready_now"
  },
  "learningInterest": {
    "dan": "interested"
  },
  "congregationFit": "strong",
  "energy": "upbeat",
  "tempo": "moderate",
  "rotationStrength": "core",
  "blockReason": "",
  "notes": "Works well after gospel-centered preaching."
}
```

### Field Meanings

`useStatus`:

* `active`: usable unless another guardrail blocks it
* `do_not_use`: never suggest or plan this song
* `inactive`: out of rotation unless Dan intentionally restores it
* `unknown`: no local decision recorded yet

`allowedUsageRoles`:

When non-empty, the song should only be used in those roles.

Examples:

* `["invitation"]`
* `["special_music", "choir_special"]`
* `["congregational"]`

`blockedUsageRoles`:

Specific roles where the song should not be used.

`seasonalUse`:

When non-empty, the song should only be used for those seasons or service categories.

Examples:

* `["christmas"]`
* `["thanksgiving"]`
* `["missions"]`
* `["children"]`
* `["military"]`
* `["mother_day"]`
* `["father_day"]`
* `["dedication_of_children"]`

`worshipFunctions`:

Open planning tags for how the song functions in a service.

Examples:

* `adoration`
* `assurance`
* `consecration`
* `invitation`
* `prayer`
* `reflection`
* `testimony`

`serviceFit`:

Service contexts where the song is especially appropriate. This is a positive-fit tag, not a hard allowlist. Use `seasonalUse` or `allowedUsageRoles` for hard restrictions.

Allowed values:

* `sunday_morning`
* `sunday_evening`
* `midweek`
* `special_service`

`leaderReadiness`:

Readiness by leader key. Use `dan` for Dan.

Allowed values:

* `ready_now`
* `learnable_soon`
* `not_ready`
* `unknown`

`learningInterest`:

Interest by leader key for songs the leader does not currently know. Use `dan` for Dan.

Allowed values:

* `interested`
* `maybe`
* `not_interested`
* `unknown`

`congregationFit`:

Allowed values:

* `strong`
* `usable`
* `situational`
* `weak`
* `unknown`

`energy`:

Allowed values:

* `upbeat`
* `bright`
* `steady`
* `reflective`
* `solemn`
* `triumphant`
* `tender`
* `unknown`

`tempo`:

Allowed values:

* `fast`
* `moderate`
* `slow`
* `mixed`
* `unknown`

`rotationStrength`:

Allowed values:

* `core`
* `solid_rotation`
* `situational`
* `rare`
* `unknown`

Use `rotationStrength`, not `localUseFrequency`, when recording how often a song belongs in local rotation. If Dan says "normal", treat that as `solid_rotation`. If Dan says "rare" or "very rare", treat that as `rare`.

Use `serviceFit`, not `localUseFrequency`, when Dan says a song is especially good for Sunday morning, Sunday evening, midweek, or a special service.

Use `notes` as a plain string. Do not save notes as `{ "dan": "..." }`.

## Local Special-Music Songs

Local, non-hymnal special-music repertoire may live in the `songs` collection alongside Rejoice hymnal songs. These records should still use the canonical song identity fields so song search and planning tools can find them.

Recommended ID:

```text
church-special-{normalized-title}
```

Recommended base shape:

```json
{
  "songId": "church-special-this-blood",
  "canonicalTitle": "This Blood",
  "titleAliases": [],
  "topics": [],
  "normalizedLookupKeys": ["this blood"],
  "sourceStatus": "local_repertoire",
  "sourceEvidence": {
    "source": "church_special_music",
    "notes": "Entered from local special-music repertoire."
  },
  "reviewFlags": [],
  "ministryPlanning": {
    "schemaVersion": "song-ministry-planning-v1",
    "useStatus": "active",
    "allowedUsageRoles": ["special_music"],
    "blockedUsageRoles": [],
    "rotationStrength": "core",
    "notes": "Favorite and powerful special. Sung by Daniel Kirchner, Shawna Blue, and Andrea Sterling trio."
  },
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

For special music, prefer `ministryPlanning.allowedUsageRoles: ["special_music"]` over generic top-level `status`, `documentType`, or `description` fields. Put performer/group details in `ministryPlanning.notes` until a dedicated performer scheduling model is added.

## Active Congregational Pool

The active congregational pool is the normal planning pool for ordinary congregational singing. It is computed from the song data rather than hand-maintained as a separate list.

A song is in the active congregational pool when all of these are true:

* the song is a Rejoice hymnal song
* `ministryPlanning.leaderReadiness.dan` is `ready_now`
* `ministryPlanning.useStatus` is not `do_not_use` or `inactive`
* `ministryPlanning.allowedUsageRoles` is empty or contains `congregational`
* `ministryPlanning.blockedUsageRoles` does not contain `congregational`
* `ministryPlanning.worshipFunctions` does not contain `chorus_append`
* the song is not in the hymnal `Choruses` topic
* `ministryPlanning.seasonalUse` is empty for ordinary services
* the song is not an occasion-only topic such as Christmas, Easter, Thanksgiving, Patriotic, Missions, Children, Wedding, Funeral/Memorial, Communion, New Year, Mother's Day, Father's Day, Dedication of Children, or Baptism

Use the active pool as a starting point, not as the whole planning decision. Songs marked `rotationStrength: rare` may still be used, but the GPT should downweight them unless Dan asks for one or the theme strongly warrants it.

Use the dispatcher operation `buildActiveCongregationalPool` to compute the count and candidate list. Do not manually approximate this pool from `queryData`; manual filtering is too easy to drift from the canonical backend rule.

For special services, start from the same guardrails but intentionally allow matching `seasonalUse` or occasion topics. For example, Christmas planning may include `seasonalUse: christmas` and Christmas-topic songs.

## Common Song Rule Examples

Never use:

```json
{
  "useStatus": "do_not_use",
  "blockReason": "Local ministry decision."
}
```

Invitation only:

```json
{
  "useStatus": "active",
  "allowedUsageRoles": ["invitation"],
  "worshipFunctions": ["invitation"]
}
```

Christmas only:

```json
{
  "useStatus": "active",
  "seasonalUse": ["christmas"]
}
```

Special music only:

```json
{
  "useStatus": "active",
  "allowedUsageRoles": ["special_music", "choir_special"]
}
```

Dan does not know how to lead it yet:

```json
{
  "leaderReadiness": {
    "dan": "not_ready"
  }
}
```

Dan does not know it and probably would not learn it:

```json
{
  "leaderReadiness": {
    "dan": "not_ready"
  },
  "learningInterest": {
    "dan": "not_interested"
  },
  "notes": "Probably would not learn; repetitive and shallow."
}
```

Energetic, usable congregational song:

```json
{
  "leaderReadiness": {
    "dan": "ready_now"
  },
  "congregationFit": "strong",
  "serviceFit": ["sunday_morning"],
  "energy": "upbeat",
  "tempo": "moderate",
  "rotationStrength": "solid_rotation"
}
```

## Chorus Append Pairings

Store approved song-to-song blends in:

```text
songPairings/{pairingId}
```

Recommended ID:

```text
pair-{primarySongId}-{appendedSongId}
```

Recommended shape:

```json
{
  "pairingId": "pair-rejoice-0381-chorus-thank-you-lord",
  "primarySongId": "rejoice-0381",
  "appendedSongId": "chorus-thank-you-lord",
  "pairingType": "append_chorus",
  "status": "approved",
  "usageRoles": ["congregational"],
  "defaultKey": "",
  "transitionNote": "Move directly after the final verse.",
  "notes": ""
}
```

The GPT should only suggest chorus append/blend dynamics from approved `songPairings` records. Do not infer new pairings from topic similarity alone.

## Dispatcher Workflow

Read examples:

* Search songs with `ministryPlanning.useStatus == do_not_use`.
* Search songs with `ministryPlanning.allowedUsageRoles array-contains invitation`.
* Search `songPairings` with `primarySongId == rejoice-0381`.

Write examples:

* Update `songs/{songId}.ministryPlanning.useStatus`.
* Update `songs/{songId}.ministryPlanning.leaderReadiness.dan`.
* Update `songs/{songId}.ministryPlanning.learningInterest.dan`.
* Update `songs/{songId}.ministryPlanning.serviceFit`.
* Update `songs/{songId}.ministryPlanning.energy`.
* Update `songs/{songId}.ministryPlanning.tempo`.
* Update `songs/{songId}.ministryPlanning.rotationStrength`.
* Create a `songPairings/{pairingId}` record.

Use `mutateData` with precise `fieldPatches` for these writes. Read the target first when its identity is unclear. Do not ask Dan to approve an ordinary create or update a second time. Ask once only before a permanent delete or a full-document replacement, then send `confirmed: true`.
