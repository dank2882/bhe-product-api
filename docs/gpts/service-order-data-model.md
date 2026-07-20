# Service Order Data Model

This document defines the order-of-service layer for the Music Ministry Planning GPT.

The goal is to preserve the actual service flow separately from song-usage history. A service order PDF may contain songs, prayers, messages, offerings, people assignments, keys, timing, transitions, and ministry dynamics. Those should not be squeezed into `serviceSongEvents` alone.

## Collections

Use these collections together:

* `services`: one service shell for the date and service type
* `serviceOrderItems`: ordered flow items from the service plan or order PDF
* `serviceSongEvents`: song usage records for history and analytics
* `serviceMoments`: intentional or detected dynamics that affect flow and impact

For imported PDF services, preserve `serviceLabels` when they can be inferred. Examples: `AM`, `PM`, `Lord's Supper`, and `Easter`. These labels help history searches answer natural questions like "Lord's Supper evening service songs" without creating one-off service types.

## `serviceOrderItems`

Each major visible order block should become a `serviceOrderItems` record.

Recommended fields:

```json
{
  "serviceOrderItemId": "soi-svc-plan-2026-05-10-sunday-morning-0040-great-is-thy-faithfulness",
  "serviceId": "svc-plan-2026-05-10-sunday-morning",
  "serviceDate": "2026-05-10",
  "serviceType": "sunday_morning",
  "sequence": 40,
  "itemType": "song",
  "sectionTitle": "Congregational Singing",
  "title": "Great Is Thy Faithfulness",
  "startTime": "11:02 am",
  "usageRole": "congregational",
  "songTitleCandidate": "Great Is Thy Faithfulness",
  "songId": "rejoice-0119",
  "hymnalNumber": 119,
  "key": "D",
  "songEntries": [
    {
      "songTitle": "Great Is Thy Faithfulness",
      "hymnalNumber": 119,
      "key": "D",
      "notes": [
        "Choir dismisses after first verse"
      ],
      "rawValue": "Great Is Thy Faithfulness (#119)"
    }
  ],
  "assignedPeople": [
    {
      "role": "pianist",
      "name": "Natalia Parmly"
    }
  ],
  "notes": [
    "Choir dismisses after first verse"
  ],
  "detailLines": [
    "Great Is Thy Faithfulness (#119)",
    "Choir dismisses after first verse",
    "Key: D"
  ],
  "linkedServiceSongEventId": "sse-order-svc-plan-2026-05-10-sunday-morning-0040-great-is-thy-faithfulness",
  "planningStatus": "planned",
  "actualStatus": "unknown",
  "source": "order_of_service_pdf",
  "sourceImportId": ""
}
```

### Item Types

Use practical, lowercase item types:

* `song`
* `prayer`
* `message`
* `offering`
* `baptism`
* `transportation`
* `theme`
* `service_element`

This list can grow as real service orders require.

### Music Fields

For music items, preserve:

* `usageRole`
* `songTitleCandidate`
* `songId`, when matched
* `hymnalNumber`, when present
* `key`, when present
* `songEntries`, when one visible order block contains one or more planned songs
* `assignedPeople`
* `notes`

Create or link corresponding `serviceSongEvents` records when the item is a song.

If one visible order block contains multiple songs, keep one `serviceOrderItems` record for the visible block and add one `songEntries` entry per song. Then create one `serviceSongEvents` record per song entry, preserving order with adjacent `slotIndex` / `plannedSequence` values such as `50`, `51`, and `52`.

## `serviceMoments`

Use `serviceMoments` for intentional ministry dynamics tied to the service flow.

These should include both planned dynamics and detected moments that need review.

Recommended fields:

```json
{
  "serviceMomentId": "sm-svc-plan-2026-05-10-sunday-morning-0040-great-is-thy-faithfulness-01",
  "serviceId": "svc-plan-2026-05-10-sunday-morning",
  "serviceDate": "2026-05-10",
  "sequence": 40,
  "momentType": "verse_dynamic",
  "title": "Choir dismisses after first verse",
  "linkedOrderItemIds": [
    "soi-svc-plan-2026-05-10-sunday-morning-0040-great-is-thy-faithfulness"
  ],
  "linkedSongEventIds": [],
  "primarySongId": "rejoice-0119",
  "primarySongTitleCandidate": "Great Is Thy Faithfulness",
  "scriptureRefs": [],
  "assignedPeople": [],
  "planningIntent": "Change the flow and focus of the congregational song.",
  "executionNotes": "Choir dismisses after first verse.",
  "status": "planned",
  "postService": {
    "impact": "unknown",
    "notes": ""
  }
}
```

### Moment Types

Initial moment types:

* `song_story`
* `solo_verse`
* `scripture_before_song`
* `scripture_between_verses`
* `scripture_after_song`
* `scripture_connection`
* `chorus_append`
* `spoken_transition`
* `service_transition`
* `verse_dynamic`
* `testimony_setup`
* `instrumental_turnaround`
* `reprise`
* `invitation_moment`

Detected moments from a PDF parser should use:

```json
{
  "status": "detected_for_review"
}
```

Dan can later approve, revise, or delete them.

## PDF Preview Workflow

The PDF parser should first create a preview only:

* `service`
* `serviceOrderItems`
* linked candidate `serviceSongEvents`
* detected `serviceMoments`
* warnings

Treat parsed PDF records as preview data until Dan asks to import or save them. That request authorizes the corresponding safe command; do not add a second conversational confirmation unless the operation would permanently delete or fully replace a document.

If multiple PDFs exist for the same service date/type and their parsed content differs, do not auto-commit one silently. Present the candidate files and parsed counts, then ask Dan whether to use one primary file or merge song history from one file with moments/dynamics from another.

## Firestore Import Safety

Before saving parsed PDF history, build a dry-run write plan that compares the preview bundle against:

* `services`
* `serviceOrderItems`
* `serviceSongEvents`
* `serviceMoments`
* `sourceImports`

The commit plan should create missing order records, refresh safe planned service shells, and preserve manual or completed records. Do not delete records during a service-order import.

When PDF-derived `serviceSongEvents` replace older spreadsheet-planning `serviceSongEvents` for the same imported service, keep the older spreadsheet records but mark them as superseded:

```json
{
  "historyVisibility": "superseded",
  "supersededBySourceImportId": "srcimp-order-of-service-pdf-...",
  "supersededBySourceType": "order_of_service_pdf",
  "supersededAt": "2026-05-08T18:30:00.000Z",
  "supersededReason": "Replaced in service history by order-of-service PDF import."
}
```

Service-history reads should ignore superseded song events so the richer PDF-derived song rows become the visible history while the older spreadsheet rows remain auditable.

## GPT Dispatcher Workflow

The GPT may read and write `serviceOrderItems` and `serviceMoments` through ministry planning dispatcher operations.

Use `mutateData` with narrow field patches for ordinary creates and updates. Dan's request is sufficient authorization. Ask once only before a permanent delete or full-document replacement, then send `confirmed: true`.
