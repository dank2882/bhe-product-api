"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  addContactMethod,
  createOrganization,
  createPerson,
  getPerson,
  linkPersonToOrganization,
  updatePerson
} = require("../lib/dan-relationships-service");
const {
  MAX_PHOTO_BYTES,
  adjustRelationshipPhotoCrop,
  approveRelationshipProfilePhoto,
  assertSafeDownloadUrl,
  getRelationshipPhoto,
  uploadRelationshipPhoto
} = require("../lib/dan-relationship-photo-service");
const {
  observeOutlookContact,
  prepareOutlookContactPublish,
  prepareOutlookPhotoPublish,
  recordOutlookContactPublish,
  recordOutlookPhotoPublish,
  resolveOutlookMerge
} = require("../lib/dan-outlook-projection-service");
const {
  addItineraryItem,
  buildDueTravelBriefings,
  createPackingList,
  createTrip,
  prepareItineraryCalendarExport,
  recordItineraryCalendarExport,
  updateTrip,
  updatePackingItem
} = require("../lib/dan-travel-companion-service");
const { runIdempotentDanTravelOperation } = require("../lib/dan-travel-operation-execution");

class FakeDocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    const value = this.collection.records.get(this.id);
    return { id: this.id, exists: value !== undefined, data: () => structuredClone(value) };
  }

  async create(value) {
    if (this.collection.records.has(this.id)) {
      const error = new Error("already exists");
      error.code = 6;
      throw error;
    }
    this.collection.records.set(this.id, structuredClone(value));
  }

  async set(value) {
    this.collection.records.set(this.id, structuredClone(value));
  }
}

class FakeCollection {
  constructor(records = []) {
    this.records = new Map(records.map((record) => [record.id, structuredClone(record.data)]));
  }

  doc(id) {
    return new FakeDocRef(this, id);
  }

  async get() {
    return {
      docs: [...this.records.entries()].map(([id, value]) => ({ id, data: () => structuredClone(value) }))
    };
  }
}

class FakeBucketFile {
  constructor(bucket, key) {
    this.bucket = bucket;
    this.key = key;
  }

  async save(buffer, options = {}) {
    this.bucket.files.set(this.key, { buffer: Buffer.from(buffer), options: structuredClone(options) });
  }

  async download() {
    const file = this.bucket.files.get(this.key);
    if (!file) throw new Error("not found");
    return [Buffer.from(file.buffer)];
  }

  async getSignedUrl() {
    return [`https://private.example/${encodeURIComponent(this.key)}`];
  }

  async getMetadata() {
    const file = this.bucket.files.get(this.key);
    return [{ size: String(file?.buffer.length || 0) }];
  }
}

class FakeBucket {
  constructor() {
    this.files = new Map();
  }

  file(key) {
    return new FakeBucketFile(this, key);
  }
}

function buildDeps(overrides = {}) {
  return {
    danOwnerSubjects: ["waad|dan"],
    taskAccess: {
      role: "member",
      subject: "waad|dan",
      subjects: ["waad|dan"],
      name: "Dan",
      email: "dan@example.com"
    },
    relationshipPeopleCollection: new FakeCollection(),
    relationshipOrganizationsCollection: new FakeCollection(),
    relationshipAffiliationsCollection: new FakeCollection(),
    relationshipContactMethodsCollection: new FakeCollection(),
    relationshipInteractionsCollection: new FakeCollection(),
    relationshipPhotosCollection: new FakeCollection(),
    outlookProjectionsCollection: new FakeCollection(),
    travelTripsCollection: new FakeCollection(),
    travelItineraryItemsCollection: new FakeCollection(),
    travelPackingListsCollection: new FakeCollection(),
    travelBriefingsCollection: new FakeCollection(),
    tripMemoriesCollection: new FakeCollection(),
    danTravelOperationExecutionsCollection: new FakeCollection(),
    danTravelAuditEventsCollection: new FakeCollection(),
    relationshipPhotoBucket: new FakeBucket(),
    now: () => new Date("2026-08-12T17:00:00.000Z"),
    ...overrides
  };
}

async function createImageBuffer(width = 1000, height = 700, options = {}) {
  let pipeline = sharp({ create: { width, height, channels: 3, background: options.background || "#2b7a78" } });
  if (options.orientation) pipeline = pipeline.withMetadata({ orientation: options.orientation });
  return pipeline.jpeg().toBuffer();
}

function fileRefFor(buffer, overrides = {}) {
  return {
    name: overrides.name || "normal-photo.jpg",
    mime_type: overrides.mimeType || "image/jpeg",
    download_link: "https://files.example/photo"
  };
}

function fetchFor(buffer, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, arrayBuffer: async () => buffer });
}

test("Dan Relationships supports name-only people, church affiliations, and later contact enrichment", async () => {
  const deps = buildDeps();
  const created = await createPerson({ displayName: "Pastor Juan", locationKeys: ["Mexico City"] }, deps);
  assert.equal(created.person.completeness, "name_only");

  const church = await createOrganization({ name: "Iglesia Bautista Esperanza", type: "church", locationKeys: ["Mexico City"] }, deps);
  await linkPersonToOrganization({ personId: created.person.personId, organizationId: church.organization.organizationId, role: "Pastor" }, deps);
  assert.equal((await getPerson({ personId: created.person.personId }, deps)).person.completeness, "affiliated");

  await addContactMethod({ personId: created.person.personId, type: "whatsapp", value: "+52 (55) 1234-5678", preferred: true }, deps);
  const enriched = await getPerson({ personId: created.person.personId }, deps);
  assert.equal(enriched.person.completeness, "contactable");
  assert.equal(enriched.contactMethods[0].value, "+525512345678");
  assert.equal(enriched.affiliations[0].role, "Pastor");
});

test("possible duplicate people require explicit review and updates require the current version", async () => {
  const deps = buildDeps();
  const first = await createPerson({ displayName: "Maria Santos" }, deps);
  await assert.rejects(createPerson({ displayName: "Maria Santos" }, deps), (error) => error.code === "possible_person_duplicate");
  await assert.rejects(
    updatePerson({ personId: first.person.personId, expectedVersion: 99, changes: { title: "Coordinator" } }, deps),
    (error) => error.code === "dan_relationship_version_conflict"
  );
});

test("Dan-only access denies another authenticated member and fails closed without owner configuration", async () => {
  const other = buildDeps({ taskAccess: { role: "admin", subject: "waad|other", subjects: ["waad|other"] } });
  await assert.rejects(createPerson({ displayName: "Private Person" }, other), (error) => error.code === "dan_private_access_denied");
  const unconfigured = buildDeps({ danOwnerSubjects: [] });
  await assert.rejects(createPerson({ displayName: "Private Person" }, unconfigured), (error) => error.code === "dan_private_owner_not_configured");
});

test("normal landscape photo becomes a private preview, adjustable crop, and approved 240/648 derivatives", async () => {
  const buffer = await createImageBuffer(1200, 800);
  const deps = buildDeps({ fetchImpl: fetchFor(buffer) });
  const person = (await createPerson({ displayName: "Ana Reyes" }, deps)).person;
  const uploaded = await uploadRelationshipPhoto({
    personId: person.personId,
    openaiFileIdRefs: [fileRefFor(buffer)]
  }, deps);
  assert.equal(uploaded.photo.status, "preview_ready");
  assert.equal(uploaded.photo.crop.mode, "attention");
  assert.match(uploaded.previewUrl, /^https:\/\/private\.example\//);
  assert.equal(deps.relationshipPhotoBucket.files.get(uploaded.photo.originalStorageKey).options.metadata.cacheControl, "private, max-age=0, no-store");

  const adjusted = await adjustRelationshipPhotoCrop({
    photoId: uploaded.photo.photoId,
    expectedVersion: 1,
    focalPoint: { x: 0.75, y: 0.45, zoom: 1.4 }
  }, deps);
  assert.equal(adjusted.photo.crop.mode, "focal_point");

  const approved = await approveRelationshipProfilePhoto({ photoId: uploaded.photo.photoId, expectedVersion: 2, approved: true }, deps);
  assert.equal(approved.photo.status, "approved");
  const thumbnail = deps.relationshipPhotoBucket.files.get(approved.photo.thumbnailStorageKey).buffer;
  const outlook = deps.relationshipPhotoBucket.files.get(approved.photo.outlookStorageKey).buffer;
  assert.deepEqual(await sharp(thumbnail).metadata().then(({ width, height }) => ({ width, height })), { width: 240, height: 240 });
  assert.deepEqual(await sharp(outlook).metadata().then(({ width, height }) => ({ width, height })), { width: 648, height: 648 });
  assert.equal((await sharp(outlook).metadata()).exif, undefined);
  assert.equal((await getRelationshipPhoto({ photoId: approved.photo.photoId }, deps)).photo.status, "approved");
});

test("photo pipeline flags low resolution and rejects corrupt or unsupported input", async () => {
  assert.throws(() => assertSafeDownloadUrl("http://127.0.0.1/photo.jpg"), (error) => error.code === "relationship_photo_download_url_not_allowed");
  const low = await createImageBuffer(120, 90);
  const deps = buildDeps({ fetchImpl: fetchFor(low) });
  const person = (await createPerson({ displayName: "Low Resolution" }, deps)).person;
  const uploaded = await uploadRelationshipPhoto({ personId: person.personId, openaiFileIdRefs: [fileRefFor(low)] }, deps);
  assert.deepEqual(uploaded.photo.warnings, ["source_resolution_below_240"]);

  const corruptDeps = buildDeps({ fetchImpl: fetchFor(Buffer.from("not an image")) });
  const corruptPerson = (await createPerson({ displayName: "Corrupt Source" }, corruptDeps)).person;
  await assert.rejects(
    uploadRelationshipPhoto({ personId: corruptPerson.personId, openaiFileIdRefs: [fileRefFor(Buffer.alloc(1))] }, corruptDeps),
    (error) => error.code === "relationship_photo_corrupt_or_unsupported"
  );
  await assert.rejects(
    uploadRelationshipPhoto({ personId: person.personId, openaiFileIdRefs: [fileRefFor(low, { mimeType: "image/gif" })] }, deps),
    (error) => error.code === "unsupported_relationship_photo_type"
  );
  await assert.rejects(
    uploadRelationshipPhoto({ personId: person.personId, openaiFileIdRefs: [fileRefFor(low, { mimeType: "image/heic" })] }, deps),
    (error) => error.code === "relationship_photo_heic_runtime_unsupported"
  );
  const oversizedDeps = buildDeps({ fetchImpl: fetchFor(Buffer.alloc(MAX_PHOTO_BYTES + 1)) });
  const oversizedPerson = (await createPerson({ displayName: "Oversized Source" }, oversizedDeps)).person;
  await assert.rejects(
    uploadRelationshipPhoto({ personId: oversizedPerson.personId, openaiFileIdRefs: [fileRefFor(Buffer.alloc(1))] }, oversizedDeps),
    (error) => error.code === "relationship_photo_size_invalid"
  );
});

test("photo pipeline supports portrait, rotated, group-crop, replacement, and rollback workflows", async () => {
  const portrait = await createImageBuffer(700, 1200);
  const rotated = await createImageBuffer(700, 1200, { orientation: 6 });
  const group = await createImageBuffer(1600, 800);
  const deps = buildDeps();
  const person = (await createPerson({ displayName: "Photo Workflow" }, deps)).person;

  deps.fetchImpl = fetchFor(portrait);
  const first = await uploadRelationshipPhoto({ personId: person.personId, openaiFileIdRefs: [fileRefFor(portrait, { name: "portrait.jpg" })] }, deps);
  assert.deepEqual(first.photo.sourceMetadata, { width: 700, height: 1200, format: "jpeg", orientationApplied: true });
  await approveRelationshipProfilePhoto({ photoId: first.photo.photoId, expectedVersion: 1, approved: true }, deps);

  deps.fetchImpl = fetchFor(rotated);
  const second = await uploadRelationshipPhoto({ personId: person.personId, openaiFileIdRefs: [fileRefFor(rotated, { name: "rotated.jpg" })] }, deps);
  assert.equal(second.photo.sourceMetadata.width, 1200);
  assert.equal(second.photo.sourceMetadata.height, 700);

  deps.fetchImpl = fetchFor(group);
  const third = await uploadRelationshipPhoto({
    personId: person.personId,
    openaiFileIdRefs: [fileRefFor(group, { name: "group.jpg" })],
    cropBox: { left: 800, top: 0, width: 800, height: 800 }
  }, deps);
  assert.equal(third.photo.crop.mode, "manual_box");
  await approveRelationshipProfilePhoto({ photoId: third.photo.photoId, expectedVersion: 1, approved: true }, deps);
  assert.equal((await getPerson({ personId: person.personId }, deps)).person.profilePhotoId, third.photo.photoId);

  await approveRelationshipProfilePhoto({ photoId: first.photo.photoId, expectedVersion: 2, approved: true }, deps);
  assert.equal((await getPerson({ personId: person.personId }, deps)).person.profilePhotoId, first.photo.photoId);
});

test("Outlook remains an approval-based projection and private notes never enter its fields", async () => {
  const buffer = await createImageBuffer();
  const deps = buildDeps({ fetchImpl: fetchFor(buffer) });
  const person = (await createPerson({ displayName: "Dr. Reuben", notes: "Private trip memory", title: "Director" }, deps)).person;
  await addContactMethod({ personId: person.personId, type: "email", value: "reuben@example.com" }, deps);
  const photo = await uploadRelationshipPhoto({ personId: person.personId, openaiFileIdRefs: [fileRefFor(buffer)] }, deps);
  await approveRelationshipProfilePhoto({ photoId: photo.photo.photoId, expectedVersion: 1, approved: true }, deps);

  const prepared = await prepareOutlookContactPublish({ personId: person.personId }, deps);
  assert.equal(JSON.stringify(prepared.contact).includes("Private trip memory"), false);
  assert.equal(prepared.folder.displayName, "Dan Relationships");
  await assert.rejects(
    recordOutlookContactPublish({ personId: person.personId, approved: false }, deps),
    (error) => error.code === "outlook_publish_approval_required"
  );
  const recorded = await recordOutlookContactPublish({
    personId: person.personId,
    approved: true,
    action: "create",
    contactId: "outlook-contact-1",
    contactFolderId: "outlook-folder-1",
    changeKey: "change-1",
    refreshedContact: prepared.contact
  }, deps);
  assert.equal(recorded.projection.status, "connected");
  const photoPublish = await prepareOutlookPhotoPublish({ personId: person.personId, approved: true }, deps);
  assert.equal(photoPublish.method, "PUT");
  assert.match(photoPublish.graphPath, /photo\/\$value$/);
  await assert.rejects(
    recordOutlookPhotoPublish({
      personId: person.personId,
      expectedVersion: recorded.projection.version,
      approved: true,
      contactId: "outlook-contact-1",
      contactFolderId: "outlook-folder-1",
      readBackVerified: false
    }, deps),
    (error) => error.code === "outlook_photo_readback_required"
  );
  const photoReceipt = await recordOutlookPhotoPublish({
    personId: person.personId,
    expectedVersion: recorded.projection.version,
    approved: true,
    contactId: "outlook-contact-1",
    contactFolderId: "outlook-folder-1",
    readBackVerified: true,
    graphRequestId: "graph-request-1"
  }, deps);
  assert.equal(photoReceipt.projection.photoStatus, "published");
  assert.equal(photoReceipt.projection.outlookPhotoSourceId, photo.photo.photoId);
});

test("Outlook differences become merge proposals and approved field choices are applied explicitly", async () => {
  const deps = buildDeps();
  const person = (await createPerson({ displayName: "Samuel Cruz", title: "Pastor" }, deps)).person;
  await addContactMethod({ personId: person.personId, type: "phone", value: "+63 900 111 2222" }, deps);
  const prepared = await prepareOutlookContactPublish({ personId: person.personId }, deps);
  const projection = (await recordOutlookContactPublish({
    personId: person.personId,
    approved: true,
    action: "create",
    contactId: "contact-2",
    contactFolderId: "folder-2",
    refreshedContact: prepared.contact
  }, deps)).projection;
  const observedContact = { ...prepared.contact, displayName: "Pastor Samuel Cruz", mobilePhone: "+63 900 999 8888" };
  const observed = await observeOutlookContact({
    personId: person.personId,
    expectedVersion: projection.version,
    refreshedContact: observedContact
  }, deps);
  assert.equal(observed.mergeProposal.status, "pending");
  const decisions = Object.fromEntries(observed.mergeProposal.differences.map(({ field }) => [field, field === "displayName" ? "outlook" : "relationship"]));
  const resolved = await resolveOutlookMerge({
    personId: person.personId,
    expectedVersion: observed.projection.version,
    approved: true,
    decisions
  }, deps);
  assert.equal(resolved.relationshipPerson.displayName, "Pastor Samuel Cruz");
  assert.equal(resolved.outlookUpdates.mobilePhone, prepared.contact.mobilePhone);
});

test("Travel Companion owns trips, automatic destination/T-14 briefings, and live packing state", async () => {
  const deps = buildDeps();
  const person = (await createPerson({ displayName: "Pastor Ben", locationKeys: ["Baguio"] }, deps)).person;
  const created = await createTrip({
    name: "Return to Baguio",
    destinations: [{ name: "Baguio", country: "Philippines" }],
    startDate: "2026-08-26",
    endDate: "2026-08-30",
    timeZone: "Asia/Manila"
  }, deps);
  assert.equal(created.destinationBriefings[0].people[0].personId, person.personId);
  const addedDestination = await updateTrip({
    tripId: created.trip.tripId,
    expectedVersion: created.trip.version,
    changes: {
      destinations: [
        ...created.trip.destinations,
        { name: "Manila", country: "Philippines" }
      ]
    }
  }, deps);
  assert.equal(addedDestination.destinationBriefings.length, 1);
  assert.equal(addedDestination.destinationBriefings[0].destination.name, "Manila");
  const itinerary = await addItineraryItem({
    tripId: created.trip.tripId,
    title: "Preach at Lighthouse",
    startsAt: "2026-08-27T10:00:00+08:00",
    endsAt: "2026-08-27T11:30:00+08:00",
    timeZone: "Asia/Manila",
    location: "Lighthouse Bible Baptist Church",
    notes: "Private preparation notes"
  }, deps);
  const calendarExport = await prepareItineraryCalendarExport({ itineraryItemId: itinerary.itineraryItem.itineraryItemId }, deps);
  assert.equal(JSON.stringify(calendarExport.calendarEvent).includes("Private preparation notes"), false);
  const recordedCalendar = await recordItineraryCalendarExport({
    itineraryItemId: itinerary.itineraryItem.itineraryItemId,
    expectedVersion: itinerary.itineraryItem.version,
    approved: true,
    outlookCalendarId: "calendar-1",
    outlookEventId: "event-1",
    refreshedEvent: {
      subject: "Preach at Lighthouse",
      start: calendarExport.calendarEvent.start,
      end: calendarExport.calendarEvent.end
    }
  }, deps);
  assert.equal(recordedCalendar.itineraryItem.outlookSyncStatus, "connected");
  const due = await buildDueTravelBriefings({ today: "2026-08-12" }, deps);
  assert.equal(due.generatedCount, 2);
  assert.equal(due.briefings[0].trigger, "t_minus_14_days");

  const packing = await createPackingList({
    tripId: created.trip.tripId,
    name: "Baguio",
    source: "docx_import",
    sourceChecksumSha256: "a".repeat(64),
    categories: ["Critical"],
    rules: ["Pack critical items early"],
    items: [{ label: "Passport", category: "Critical" }]
  }, deps);
  assert.deepEqual(packing.packingList.rules, ["Pack critical items early"]);
  assert.equal(packing.packingList.sourceChecksumSha256, "a".repeat(64));
  const updated = await updatePackingItem({
    packingListId: packing.packingList.packingListId,
    packingItemId: packing.packingList.items[0].packingItemId,
    expectedVersion: 1,
    changes: { packed: true }
  }, deps);
  assert.equal(updated.packingItem.packed, true);
});

test("command operations are audit-backed and replay-safe", async () => {
  const deps = buildDeps();
  const input = {
    mode: "command",
    operation: "createPerson",
    arguments: { displayName: "Replay Safe Person" },
    idempotencyKey: "create-replay-safe-person-001"
  };
  const first = await runIdempotentDanTravelOperation(input, deps);
  const replay = await runIdempotentDanTravelOperation(input, deps);
  assert.equal(first.idempotency.replayed, false);
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(first.result.person.personId, replay.result.person.personId);
  assert.equal(deps.danTravelAuditEventsCollection.records.size, 1);
});
