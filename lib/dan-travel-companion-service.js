"use strict";

const { randomUUID } = require("node:crypto");
const { getDanActorFields, requireDanPrivateAccess } = require("./dan-private-access");
const { runDanFirestoreTransaction } = require("./dan-firestore-transaction");
const {
  assertExpectedVersion,
  buildPersonSummary,
  createRelationshipError,
  getCollection,
  getNowIso,
  getRequiredRecord,
  loadCollection,
  normalizeKey,
  normalizeLimit,
  normalizeLocationKeys,
  normalizeString,
  normalizeStrings
} = require("./dan-relationships-service");

const TRIP_STATUSES = Object.freeze(["idea", "planned", "active", "completed", "cancelled", "archived"]);
const ITINERARY_TYPES = Object.freeze(["flight", "lodging", "meeting", "church", "activity", "transport", "meal", "other"]);

function normalizeDate(value, field) {
  const clean = normalizeString(value);
  if (!clean) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw createRelationshipError(`${field} must use YYYY-MM-DD`, 400, `invalid_${field}`);
  }
  return clean;
}

function normalizeDateTime(value, field) {
  const clean = normalizeString(value);
  if (!clean) return "";
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) {
    throw createRelationshipError(`${field} must be an ISO-8601 date/time`, 400, `invalid_${field}`);
  }
  return date.toISOString();
}

function normalizeDestinations(value) {
  const items = Array.isArray(value) ? value : [];
  if (items.length === 0) {
    throw createRelationshipError("At least one trip destination is required", 400, "trip_destination_required");
  }
  return items.slice(0, 25).map((destination, index) => {
    const name = normalizeString(destination?.name);
    if (!name) throw createRelationshipError("Every destination needs a name", 400, "trip_destination_name_required", { index });
    return {
      destinationId: normalizeString(destination.destinationId) || `destination-${randomUUID()}`,
      name,
      country: normalizeString(destination.country),
      region: normalizeString(destination.region),
      locationKeys: normalizeLocationKeys([name, destination.country, destination.region, ...(destination.locationKeys || [])]),
      arrivalOn: normalizeDate(destination.arrivalOn, "destination_arrival_on"),
      departureOn: normalizeDate(destination.departureOn, "destination_departure_on")
    };
  });
}

function buildBase(kind, id, deps) {
  const actor = getDanActorFields(deps);
  const now = getNowIso(deps);
  return {
    [`${kind}Id`]: id,
    owner: "dan",
    serves: ["dan"],
    visibility: "private",
    ownerSub: actor.actorSub,
    createdBySub: actor.actorSub,
    createdByName: actor.actorName,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function tripSummary(trip = {}) {
  return {
    tripId: trip.tripId || "",
    name: trip.name || "",
    purpose: trip.purpose || "",
    destinations: Array.isArray(trip.destinations) ? trip.destinations : [],
    startDate: trip.startDate || "",
    endDate: trip.endDate || "",
    timeZone: trip.timeZone || "",
    status: trip.status || "planned",
    legacyProjectId: trip.legacyProjectId || "",
    version: Number(trip.version || 0),
    createdAt: trip.createdAt || "",
    updatedAt: trip.updatedAt || ""
  };
}

async function createTrip(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const name = normalizeString(input.name);
  if (!name) throw createRelationshipError("Trip name is required", 400, "trip_name_required");
  const startDate = normalizeDate(input.startDate, "trip_start_date");
  const endDate = normalizeDate(input.endDate, "trip_end_date");
  if (startDate && endDate && endDate < startDate) {
    throw createRelationshipError("Trip endDate cannot precede startDate", 400, "trip_date_range_invalid");
  }
  const status = normalizeString(input.status).toLowerCase() || "planned";
  if (!TRIP_STATUSES.includes(status)) {
    throw createRelationshipError("Invalid trip status", 400, "invalid_trip_status", { allowed: TRIP_STATUSES });
  }
  const tripId = normalizeString(input.tripId) || `trip-${randomUUID()}`;
  const record = {
    ...buildBase("trip", tripId, deps),
    name,
    purpose: normalizeString(input.purpose),
    destinations: normalizeDestinations(input.destinations),
    startDate,
    endDate,
    timeZone: normalizeString(input.timeZone) || "America/Los_Angeles",
    status,
    travelers: normalizeStrings(input.travelers, 25),
    notes: normalizeString(input.notes),
    legacyProjectId: normalizeString(input.legacyProjectId),
    calendarProjectionIds: [],
    searchText: normalizeKey([name, input.purpose, input.destinations?.map((item) => item.name), input.notes].flat().join(" "))
  };
  await getCollection(deps, "travelTripsCollection").doc(tripId).create(record);
  const briefings = [];
  for (const destination of record.destinations) {
    briefings.push((await buildDestinationRefresher({ tripId, destinationId: destination.destinationId, trigger: "destination_added" }, deps)).briefing);
  }
  return { trip: tripSummary(record), destinationBriefings: briefings };
}

async function getTrip(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const trip = await getRequiredRecord(getCollection(deps, "travelTripsCollection"), input.tripId, "trip");
  const [itinerary, packingLists, briefings] = await Promise.all([
    loadCollection(getCollection(deps, "travelItineraryItemsCollection")),
    loadCollection(getCollection(deps, "travelPackingListsCollection")),
    loadCollection(getCollection(deps, "travelBriefingsCollection"))
  ]);
  return {
    trip: tripSummary(trip),
    itinerary: itinerary.filter((item) => item.tripId === trip.tripId).sort((a, b) => (a.startsAt || "").localeCompare(b.startsAt || "")),
    packingLists: packingLists.filter((item) => item.tripId === trip.tripId),
    briefings: briefings.filter((item) => item.tripId === trip.tripId).sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""))
  };
}

async function updateTrip(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const collection = getCollection(deps, "travelTripsCollection");
  const changes = input.changes && typeof input.changes === "object" ? input.changes : {};
  const docRef = collection.doc(input.tripId);
  const { next, existingDestinationIds } = await runDanFirestoreTransaction(deps, collection, async (transaction) => {
    const document = await transaction.get(docRef);
    if (!document.exists) throw createRelationshipError("trip not found", 404, "trip_not_found", { id: input.tripId });
    const existing = { ...(document.data() || {}), tripId: input.tripId };
    assertExpectedVersion(existing, input.expectedVersion, "trip");
    const updated = { ...existing };
    const destinationIds = new Set((existing.destinations || []).map((item) => item.destinationId));
    for (const field of ["name", "purpose", "timeZone", "status", "notes"]) {
      if (Object.prototype.hasOwnProperty.call(changes, field)) updated[field] = normalizeString(changes[field]);
    }
    if (Object.prototype.hasOwnProperty.call(changes, "destinations")) updated.destinations = normalizeDestinations(changes.destinations);
    if (Object.prototype.hasOwnProperty.call(changes, "startDate")) updated.startDate = normalizeDate(changes.startDate, "trip_start_date");
    if (Object.prototype.hasOwnProperty.call(changes, "endDate")) updated.endDate = normalizeDate(changes.endDate, "trip_end_date");
    if (Object.prototype.hasOwnProperty.call(changes, "travelers")) updated.travelers = normalizeStrings(changes.travelers, 25);
    if (!TRIP_STATUSES.includes(updated.status)) throw createRelationshipError("Invalid trip status", 400, "invalid_trip_status");
    if (updated.startDate && updated.endDate && updated.endDate < updated.startDate) throw createRelationshipError("Invalid trip date range", 400, "trip_date_range_invalid");
    updated.searchText = normalizeKey([updated.name, updated.purpose, updated.destinations.map((item) => item.name), updated.notes].flat().join(" "));
    updated.version = Number(existing.version || 0) + 1;
    updated.updatedAt = getNowIso(deps);
    transaction.set(docRef, updated);
    return { next: updated, existingDestinationIds: destinationIds };
  });
  const destinationBriefings = [];
  for (const destination of next.destinations.filter((item) => !existingDestinationIds.has(item.destinationId))) {
    destinationBriefings.push((await buildDestinationRefresher({
      tripId: next.tripId,
      destinationId: destination.destinationId,
      trigger: "destination_added"
    }, deps)).briefing);
  }
  return { trip: tripSummary(next), destinationBriefings };
}

async function listTrips(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const query = normalizeKey(input.query);
  const status = normalizeString(input.status).toLowerCase();
  const trips = (await loadCollection(getCollection(deps, "travelTripsCollection")))
    .filter((trip) => !status || trip.status === status)
    .filter((trip) => !query || normalizeKey(trip.searchText || trip.name).includes(query))
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""))
    .slice(0, normalizeLimit(input.limit, 25, 100))
    .map(tripSummary);
  return { count: trips.length, trips };
}

async function addItineraryItem(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const trip = await getRequiredRecord(getCollection(deps, "travelTripsCollection"), input.tripId, "trip");
  const title = normalizeString(input.title);
  if (!title) throw createRelationshipError("Itinerary title is required", 400, "itinerary_title_required");
  const type = normalizeString(input.type).toLowerCase() || "other";
  if (!ITINERARY_TYPES.includes(type)) throw createRelationshipError("Invalid itinerary type", 400, "invalid_itinerary_type");
  const startsAt = normalizeDateTime(input.startsAt, "itinerary_starts_at");
  const endsAt = normalizeDateTime(input.endsAt, "itinerary_ends_at");
  if (startsAt && endsAt && endsAt < startsAt) throw createRelationshipError("Invalid itinerary time range", 400, "itinerary_time_range_invalid");
  const itineraryItemId = normalizeString(input.itineraryItemId) || `itinerary-${randomUUID()}`;
  const record = {
    ...buildBase("itineraryItem", itineraryItemId, deps),
    tripId: trip.tripId,
    destinationId: normalizeString(input.destinationId),
    type,
    title,
    startsAt,
    endsAt,
    timeZone: normalizeString(input.timeZone) || trip.timeZone,
    location: normalizeString(input.location),
    confirmationNumber: normalizeString(input.confirmationNumber),
    notes: normalizeString(input.notes),
    sourceRecordIds: normalizeStrings(input.sourceRecordIds, 25),
    outlookCalendarId: normalizeString(input.outlookCalendarId),
    outlookEventId: normalizeString(input.outlookEventId),
    outlookSyncStatus: normalizeString(input.outlookSyncStatus) || "not_exported"
  };
  await getCollection(deps, "travelItineraryItemsCollection").doc(itineraryItemId).create(record);
  return { itineraryItem: record };
}

async function prepareItineraryCalendarExport(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const item = await getRequiredRecord(
    getCollection(deps, "travelItineraryItemsCollection"),
    input.itineraryItemId,
    "itineraryItem"
  );
  const trip = await getRequiredRecord(getCollection(deps, "travelTripsCollection"), item.tripId, "trip");
  if (!item.startsAt || !item.endsAt) {
    throw createRelationshipError("Only timed itinerary items can be exported to Outlook Calendar", 409, "itinerary_item_not_timed");
  }
  return {
    trip: tripSummary(trip),
    itineraryItem: item,
    calendarEvent: {
      subject: item.title,
      start: { dateTime: item.startsAt, timeZone: item.timeZone || trip.timeZone },
      end: { dateTime: item.endsAt, timeZone: item.timeZone || trip.timeZone },
      location: item.location ? { displayName: item.location } : undefined,
      body: input.includeNotes === true && item.notes
        ? { contentType: "text", content: item.notes }
        : undefined
    },
    existingProjection: item.outlookEventId
      ? { calendarId: item.outlookCalendarId, eventId: item.outlookEventId, status: item.outlookSyncStatus }
      : null,
    requiredExternalSteps: [
      "Ask Dan to approve creating or updating this timed commitment in Outlook Calendar.",
      "Use the Outlook Calendar connector and fetch the saved event back.",
      "Record the verified IDs and read-back with recordItineraryCalendarExport."
    ]
  };
}

async function recordItineraryCalendarExport(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  if (input.approved !== true) {
    throw createRelationshipError("Explicit Outlook Calendar export approval is required", 400, "calendar_export_approval_required");
  }
  const collection = getCollection(deps, "travelItineraryItemsCollection");
  const calendarId = normalizeString(input.outlookCalendarId);
  const eventId = normalizeString(input.outlookEventId);
  const refreshed = input.refreshedEvent && typeof input.refreshedEvent === "object" ? input.refreshedEvent : {};
  if (!calendarId || !eventId || !normalizeString(refreshed.subject) || !refreshed.start || !refreshed.end) {
    throw createRelationshipError("A refreshed Outlook event read-back is required", 400, "calendar_export_readback_required");
  }
  const docRef = collection.doc(input.itineraryItemId);
  return runDanFirestoreTransaction(deps, collection, async (transaction) => {
    const document = await transaction.get(docRef);
    if (!document.exists) throw createRelationshipError("itineraryItem not found", 404, "itineraryItem_not_found", { id: input.itineraryItemId });
    const item = { ...(document.data() || {}), itineraryItemId: input.itineraryItemId };
    assertExpectedVersion(item, input.expectedVersion, "itineraryItem");
    const next = {
      ...item,
      outlookCalendarId: calendarId,
      outlookEventId: eventId,
      outlookSyncStatus: "connected",
      outlookReadBack: {
        subject: normalizeString(refreshed.subject),
        start: refreshed.start,
        end: refreshed.end,
        changeKey: normalizeString(refreshed.changeKey)
      },
      lastOutlookSyncAt: getNowIso(deps),
      version: Number(item.version || 0) + 1,
      updatedAt: getNowIso(deps)
    };
    transaction.set(docRef, next);
    return { itineraryItem: next };
  });
}

async function createPackingList(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const tripId = normalizeString(input.tripId);
  if (tripId) await getRequiredRecord(getCollection(deps, "travelTripsCollection"), tripId, "trip");
  const name = normalizeString(input.name);
  if (!name) throw createRelationshipError("Packing-list name is required", 400, "packing_list_name_required");
  const packingListId = normalizeString(input.packingListId) || `packing-list-${randomUUID()}`;
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 500).map((item, index) => ({
    packingItemId: normalizeString(item?.packingItemId) || `packing-item-${randomUUID()}`,
    label: normalizeString(item?.label),
    category: normalizeString(item?.category) || "general",
    quantity: Math.max(1, Math.trunc(Number(item?.quantity) || 1)),
    packed: item?.packed === true,
    notes: normalizeString(item?.notes),
    order: index + 1,
    updatedAt: getNowIso(deps)
  })).filter((item) => item.label);
  const record = {
    ...buildBase("packingList", packingListId, deps),
    tripId,
    name,
    source: normalizeString(input.source) || "manual",
    sourceReference: normalizeString(input.sourceReference),
    sourceChecksumSha256: /^[a-f0-9]{64}$/i.test(normalizeString(input.sourceChecksumSha256))
      ? normalizeString(input.sourceChecksumSha256).toLowerCase()
      : "",
    categories: normalizeStrings(input.categories, 100),
    rules: normalizeStrings(input.rules, 100),
    status: "active",
    items
  };
  await getCollection(deps, "travelPackingListsCollection").doc(packingListId).create(record);
  return { packingList: record };
}

async function updatePackingItem(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const collection = getCollection(deps, "travelPackingListsCollection");
  const changes = input.changes && typeof input.changes === "object" ? input.changes : {};
  const docRef = collection.doc(input.packingListId);
  return runDanFirestoreTransaction(deps, collection, async (transaction) => {
    const document = await transaction.get(docRef);
    if (!document.exists) throw createRelationshipError("packingList not found", 404, "packingList_not_found", { id: input.packingListId });
    const list = { ...(document.data() || {}), packingListId: input.packingListId };
    assertExpectedVersion(list, input.expectedVersion, "packingList");
    const index = (list.items || []).findIndex((item) => item.packingItemId === input.packingItemId);
    if (index < 0) throw createRelationshipError("Packing item not found", 404, "packing_item_not_found");
    const item = { ...list.items[index] };
    for (const field of ["label", "category", "notes"]) {
      if (Object.prototype.hasOwnProperty.call(changes, field)) item[field] = normalizeString(changes[field]);
    }
    if (Object.prototype.hasOwnProperty.call(changes, "packed")) item.packed = changes.packed === true;
    if (Object.prototype.hasOwnProperty.call(changes, "quantity")) item.quantity = Math.max(1, Math.trunc(Number(changes.quantity) || 1));
    item.updatedAt = getNowIso(deps);
    const items = [...list.items];
    items[index] = item;
    const next = { ...list, items, version: Number(list.version || 0) + 1, updatedAt: getNowIso(deps) };
    transaction.set(docRef, next);
    return { packingListId: list.packingListId, packingItem: item, version: next.version };
  });
}

function locationMatches(recordKeys, destination = {}) {
  const record = (recordKeys || []).map(normalizeKey).filter(Boolean);
  const country = normalizeKey(destination.country);
  const destinationSpecific = (destination.locationKeys || [])
    .map(normalizeKey)
    .filter((key) => key && key !== country);
  const recordSpecific = record.filter((key) => key !== country);
  if (recordSpecific.some((left) => destinationSpecific.some((right) => left.includes(right) || right.includes(left)))) {
    return true;
  }
  return Boolean(country && record.includes(country) && recordSpecific.length === 0);
}

async function buildDestinationRefresher(input = {}, deps = {}) {
  requireDanPrivateAccess(deps, { allowAutomation: true });
  const trip = await getRequiredRecord(getCollection(deps, "travelTripsCollection"), input.tripId, "trip");
  const destination = trip.destinations.find((item) => item.destinationId === input.destinationId)
    || (input.destinationId ? null : trip.destinations[0]);
  if (!destination) throw createRelationshipError("Trip destination not found", 404, "trip_destination_not_found");
  const [people, organizations, affiliations, contactMethods, interactions, photos, memories] = await Promise.all([
    loadCollection(getCollection(deps, "relationshipPeopleCollection")),
    loadCollection(getCollection(deps, "relationshipOrganizationsCollection")),
    loadCollection(getCollection(deps, "relationshipAffiliationsCollection")),
    loadCollection(getCollection(deps, "relationshipContactMethodsCollection")),
    loadCollection(getCollection(deps, "relationshipInteractionsCollection")),
    loadCollection(getCollection(deps, "relationshipPhotosCollection")),
    loadCollection(getCollection(deps, "tripMemoriesCollection"))
  ]);
  const matchingOrganizations = organizations.filter((item) => locationMatches(item.locationKeys, destination));
  const organizationIds = new Set(matchingOrganizations.map((item) => item.organizationId));
  const affiliatedPersonIds = new Set(affiliations.filter((item) => organizationIds.has(item.organizationId)).map((item) => item.personId));
  const matchingPeople = people.filter((person) => locationMatches(person.locationKeys, destination) || affiliatedPersonIds.has(person.personId));
  const personIds = new Set(matchingPeople.map((person) => person.personId));
  const relevantInteractions = interactions
    .filter((item) => {
      const hasLocation = Array.isArray(item.locationKeys) && item.locationKeys.length > 0;
      if (hasLocation) return locationMatches(item.locationKeys, destination);
      return item.tripId === trip.tripId || (item.personIds || []).some((id) => personIds.has(id));
    })
    .sort((a, b) => (b.happenedAt || "").localeCompare(a.happenedAt || ""))
    .slice(0, 25);
  const relevantMemories = memories
    .filter((item) => item.tripId === trip.tripId && (item.stream || "story") === "story")
    .sort((a, b) => (b.happenedAt || b.createdAt || "").localeCompare(a.happenedAt || a.createdAt || ""))
    .slice(0, 15)
    .map((item) => ({ memoryId: item.memoryId, exactText: item.exactText, happenedAt: item.happenedAt, privacy: item.privacy }));
  const peopleBrief = matchingPeople.map((person) => {
    const personAffiliations = affiliations.filter((item) => item.personId === person.personId);
    return {
      ...buildPersonSummary(person),
      affiliations: personAffiliations.map((affiliation) => ({
        ...affiliation,
        organization: organizations.find((item) => item.organizationId === affiliation.organizationId) || null
      })),
      contactMethods: contactMethods.filter((item) => item.personId === person.personId && (item.status || "active") === "active"),
      profilePhoto: photos.find((item) => item.photoId === person.profilePhotoId && item.status === "approved") || null
    };
  });
  const briefingId = `briefing-${trip.tripId}-${destination.destinationId}-${randomUUID()}`;
  const now = getNowIso(deps);
  const record = {
    ...buildBase("briefing", briefingId, deps),
    tripId: trip.tripId,
    destinationId: destination.destinationId,
    destination,
    trigger: normalizeString(input.trigger) || "on_demand",
    generatedAt: now,
    people: peopleBrief,
    organizations: matchingOrganizations,
    interactions: relevantInteractions,
    storyMemories: relevantMemories,
    counts: {
      people: peopleBrief.length,
      organizations: matchingOrganizations.length,
      interactions: relevantInteractions.length,
      memories: relevantMemories.length
    }
  };
  await getCollection(deps, "travelBriefingsCollection").doc(briefingId).create(record);
  return { briefing: record };
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function buildDueTravelBriefings(input = {}, deps = {}) {
  requireDanPrivateAccess(deps, { allowAutomation: true });
  const today = normalizeDate(input.today || getNowIso(deps).slice(0, 10), "briefing_today");
  const trips = (await loadCollection(getCollection(deps, "travelTripsCollection")))
    .filter((trip) => ["planned", "active"].includes(trip.status));
  const existing = await loadCollection(getCollection(deps, "travelBriefingsCollection"));
  const generated = [];
  for (const trip of trips) {
    const trigger = trip.startDate && addDays(trip.startDate, -14) === today
      ? "t_minus_14_days"
      : trip.startDate && trip.endDate && today >= trip.startDate && today <= trip.endDate
        ? "active_trip_daily"
        : "";
    if (!trigger) continue;
    for (const destination of trip.destinations || []) {
      const alreadyBuilt = existing.some((item) => item.tripId === trip.tripId && item.destinationId === destination.destinationId && item.trigger === trigger && String(item.generatedAt).startsWith(today));
      if (alreadyBuilt) continue;
      generated.push((await buildDestinationRefresher({ tripId: trip.tripId, destinationId: destination.destinationId, trigger }, deps)).briefing);
    }
  }
  return { today, generatedCount: generated.length, briefings: generated };
}

module.exports = {
  ITINERARY_TYPES,
  TRIP_STATUSES,
  addItineraryItem,
  buildDestinationRefresher,
  buildDueTravelBriefings,
  createPackingList,
  createTrip,
  getTrip,
  listTrips,
  locationMatches,
  prepareItineraryCalendarExport,
  recordItineraryCalendarExport,
  tripSummary,
  updatePackingItem,
  updateTrip
};
