"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { buildLogosImportPreview } = require("./logos-prayer-import");

const PRAYER_STATUSES = Object.freeze(["active", "answered", "archived"]);
const PRAYER_PRESENTATION_AREAS = Object.freeze(["upward", "inward", "outward"]);
const PRAYER_PRESENTATION_GROUPS = Object.freeze(["christ", "personal", "companion", "family", "church", "community", "country", "world"]);
const MAX_SCAN = 2000;

const PRAYER_PRESENTATION_TEMPLATE = Object.freeze([
  {
    number: "1", key: "upward", title: "Upward", description: "My personal need and relationship with God.",
    groups: [{ number: "1.1", key: "christ", title: "Christ — Relationship with God", subheaders: [
      { number: "1.1.1", key: "relationship-with-god", title: "Relationship with God", listNumbers: [1] }
    ] }]
  },
  {
    number: "2", key: "inward", title: "Inward", description: "The things I need, need to face, and need to fix.",
    groups: [{ number: "2.1", key: "personal", title: "Personal Needs and Growth", subheaders: [
      { number: "2.1.1", key: "personal-needs-and-growth", title: "Personal Needs and Growth", listNumbers: [1] }
    ] }]
  },
  {
    number: "3", key: "outward", title: "Outward", description: "Those closest to me first, then church, community, country, and the world.",
    groups: [
      { number: "3.1", key: "companion", title: "Companion", subheaders: [
        { number: "3.1.1", key: "sarah", title: "Sarah", listNumbers: [2] },
        { number: "3.1.2", key: "dan-and-sarah", title: "Dan & Sarah", listNumbers: [3] }
      ] },
      { number: "3.2", key: "family", title: "Family and Friends", subheaders: [
        { number: "3.2.1", key: "friends-and-family", title: "Friends and Family", listNumbers: [4] }
      ] },
      { number: "3.3", key: "church", title: "Church", subheaders: [
        { number: "3.3.1", key: "church-staff", title: "Church Staff", listNumbers: [5] },
        { number: "3.3.2", key: "church-ministries", title: "Church Ministries", listNumbers: [6] },
        { number: "3.3.3", key: "salvation", title: "Salvation", listNumbers: [7] },
        { number: "3.3.4", key: "church-events-and-projects", title: "Upcoming Events & Projects", listNumbers: [15] }
      ] },
      { number: "3.4", key: "community", title: "Community", subheaders: [
        { number: "3.4.1", key: "health-cancer", title: "Health — Cancer", listNumbers: [8] },
        { number: "3.4.2", key: "health-miscellaneous", title: "Health — Miscellaneous", listNumbers: [9] },
        { number: "3.4.3", key: "health-pregnancy", title: "Health — Pregnancy", listNumbers: [10] },
        { number: "3.4.4", key: "health-alzheimers-and-dementia", title: "Health — Alzheimer’s & Dementia", listNumbers: [11] },
        { number: "3.4.5", key: "college-students", title: "College Students", listNumbers: [13] },
        { number: "3.4.6", key: "miscellaneous-requests", title: "Miscellaneous Prayer Requests", listNumbers: [14] }
      ] },
      { number: "3.5", key: "country", title: "Country", subheaders: [
        { number: "3.5.1", key: "military", title: "Military", listNumbers: [12] }
      ] },
      { number: "3.6", key: "world", title: "World and Missions", subheaders: [
        { number: "3.6.1", key: "missionaries", title: "Missionaries", listNumbers: [16] },
        { number: "3.6.2", key: "missions-agencies", title: "Missions Agencies", listNumbers: [17] },
        { number: "3.6.3", key: "missions-projects", title: "Missions Projects", listNumbers: [18] }
      ] }
    ]
  }
]);

function normalizeString(value) { return typeof value === "string" ? value.trim() : ""; }
function fail(message, statusCode, code, details = {}) { throw Object.assign(new Error(message), { statusCode, code, details }); }
function nowIso(deps) { const value = typeof deps.now === "function" ? deps.now() : new Date(); return value instanceof Date ? value.toISOString() : String(value); }
function newId(prefix, deps) { return `${prefix}-${(typeof deps.randomUUID === "function" ? deps.randomUUID() : randomUUID()).toLowerCase()}`; }
function owner(deps = {}) {
  const access = deps.taskAccess || {};
  const subject = normalizeString(access.subject);
  const subjects = [...new Set([subject, ...(Array.isArray(access.subjects) ? access.subjects : [])].map(normalizeString).filter(Boolean))];
  if (!subject) fail("Prayer Management requires a verified individual identity", 401, "prayer_identity_required");
  const allowedSubjects = [...new Set((Array.isArray(deps.prayerOwnerSubjects) ? deps.prayerOwnerSubjects : []).map(normalizeString).filter(Boolean))];
  if (!allowedSubjects.length) fail("Prayer Management owner identity is not configured", 503, "prayer_owner_not_configured");
  const ownerSubject = allowedSubjects.find((candidate) => subjects.includes(candidate));
  if (!ownerSubject) fail("Prayer Management access is restricted to its verified owner", 403, "prayer_owner_only");
  return { subject: ownerSubject, actorSubject: subject, subjects, name: normalizeString(access.name), email: normalizeString(access.email), scopes: Array.isArray(access.scopes) ? access.scopes : [] };
}
function requireScope(deps, scope) {
  const identity = owner(deps);
  if (!identity.scopes.includes(scope)) fail("Prayer Management access is restricted to its verified owner", 403, "prayer_owner_only");
  return identity;
}
function assertPrayerAccess(deps, scope) { return requireScope(deps, scope); }
function owns(record, identity) { return Boolean(record && identity.subjects.includes(record.ownerSub)); }
function context(recordType, recordId, ownerSub) { return { recordType, recordId, ownerSub }; }
function cleanArray(value, max = 100) { return [...new Set((Array.isArray(value) ? value : []).map(normalizeString).filter(Boolean))].slice(0, max); }
function normalizePrayerPresentation(value = {}) {
  if (value === undefined || value === null || value === "") return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Prayer presentation must be an object", 400, "invalid_prayer_presentation");
  const area = normalizeString(value.area).toLowerCase();
  const group = normalizeString(value.group).toLowerCase();
  const subheader = normalizeString(value.subheader).toLowerCase();
  const order = value.order === undefined || value.order === null || value.order === "" ? null : Number(value.order);
  if (area && !PRAYER_PRESENTATION_AREAS.includes(area)) fail("Prayer presentation area must be upward, inward, or outward", 400, "invalid_prayer_presentation");
  if (group && !PRAYER_PRESENTATION_GROUPS.includes(group)) fail("Prayer presentation group is not supported", 400, "invalid_prayer_presentation");
  if ((area && !group) || (!area && group)) fail("Prayer presentation area and group must be provided together", 400, "invalid_prayer_presentation");
  if (order !== null && (!Number.isInteger(order) || order < 1 || order > 10000)) fail("Prayer presentation order must be an integer from 1 through 10000", 400, "invalid_prayer_presentation");
  return { ...(area ? { area, group } : {}), ...(subheader ? { subheader } : {}), ...(order !== null ? { order } : {}) };
}
function parseExpectedVersion(value) { const n = Number(value); if (!Number.isInteger(n) || n < 1) fail("A current expectedVersion is required", 400, "prayer_expected_version_required"); return n; }
function validateTimeZone(value) {
  const timeZone = normalizeString(value) || "America/Los_Angeles";
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date()); } catch { fail("Schedule timeZone must be a valid IANA time zone", 400, "invalid_prayer_time_zone"); }
  return timeZone;
}
function normalizeSchedule(value = {}) {
  const kind = normalizeString(value.kind || "unscheduled").toLowerCase();
  if (!["unscheduled", "daily", "weekly", "monthly", "interval", "date"].includes(kind)) fail("Unsupported prayer schedule kind", 400, "invalid_prayer_schedule");
  const schedule = { kind, timeZone: validateTimeZone(value.timeZone) };
  if (kind === "weekly") {
    schedule.weekdays = [...new Set((Array.isArray(value.weekdays) ? value.weekdays : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    if (!schedule.weekdays.length) fail("Weekly prayer schedules require weekdays from 0 through 6", 400, "invalid_prayer_schedule");
  }
  if (kind === "monthly") {
    schedule.dayOfMonth = Number(value.dayOfMonth);
    if (!Number.isInteger(schedule.dayOfMonth) || schedule.dayOfMonth < 1 || schedule.dayOfMonth > 31) fail("Monthly prayer schedules require dayOfMonth from 1 through 31", 400, "invalid_prayer_schedule");
  }
  if (kind === "interval") {
    schedule.intervalDays = Number(value.intervalDays);
    if (!Number.isInteger(schedule.intervalDays) || schedule.intervalDays < 1 || schedule.intervalDays > 365) fail("Interval schedules require intervalDays from 1 through 365", 400, "invalid_prayer_schedule");
    schedule.startDate = normalizeString(value.startDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.startDate)) fail("Interval schedules require startDate in YYYY-MM-DD format", 400, "invalid_prayer_schedule");
  }
  if (kind === "date") {
    schedule.date = normalizeString(value.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.date)) fail("Date schedules require date in YYYY-MM-DD format", 400, "invalid_prayer_schedule");
  }
  return schedule;
}
function dateInZone(iso, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function weekdayInZone(iso, timeZone) {
  const token = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(iso));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(token);
}
function daysBetween(a, b) { return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000); }
function addCalendarDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function latestMonthlyOccurrence(localDate, dayOfMonth) {
  const [year, month] = localDate.split("-").map(Number);
  for (let offset = 0; offset < 24; offset += 1) {
    const monthStart = new Date(Date.UTC(year, month - 1 - offset, 1));
    const candidate = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayOfMonth));
    if (candidate.getUTCMonth() !== monthStart.getUTCMonth()) continue;
    const candidateDate = candidate.toISOString().slice(0, 10);
    if (candidateDate <= localDate) return candidateDate;
  }
  return "";
}
function latestScheduledOccurrence(schedule, iso) {
  const localDate = dateInZone(iso, schedule.timeZone);
  if (schedule.kind === "daily") return localDate;
  if (schedule.kind === "weekly") {
    for (let offset = 0; offset < 7; offset += 1) {
      const candidate = addCalendarDays(localDate, -offset);
      const weekday = new Date(`${candidate}T00:00:00Z`).getUTCDay();
      if (schedule.weekdays.includes(weekday)) return candidate;
    }
    return "";
  }
  if (schedule.kind === "monthly") return latestMonthlyOccurrence(localDate, schedule.dayOfMonth);
  if (schedule.kind === "date") return schedule.date <= localDate ? schedule.date : "";
  if (schedule.kind === "interval") {
    const elapsed = daysBetween(schedule.startDate, localDate);
    return elapsed >= 0 ? addCalendarDays(schedule.startDate, Math.floor(elapsed / schedule.intervalDays) * schedule.intervalDays) : "";
  }
  return "";
}
function isDue(schedule, iso, lastPrayedAt = "", activatedAt = "") {
  if (!schedule || schedule.kind === "unscheduled") return true;
  const occurrence = latestScheduledOccurrence(schedule, iso);
  if (!occurrence) return false;
  const lastPrayedDate = lastPrayedAt ? dateInZone(lastPrayedAt, schedule.timeZone) : "";
  if (lastPrayedDate) return lastPrayedDate < occurrence;
  const activationDate = activatedAt ? dateInZone(activatedAt, schedule.timeZone) : "";
  return !activationDate || activationDate <= occurrence;
}
async function scan(collection, limit = MAX_SCAN + 1) {
  const snapshot = await collection.limit(Math.min(Math.max(Number(limit) || MAX_SCAN + 1, 1), MAX_SCAN + 1)).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}
function assertRecord(record, identity, code = "prayer_not_found") {
  if (!record || !owns(record, identity)) fail("Prayer record was not found", 404, code);
}
async function decryptRecord(record, recordType, deps) {
  const content = await deps.prayerCrypto.decryptJson(record.encryptedContent, context(recordType, record.id, record.ownerSub));
  const { encryptedContent, ...metadata } = record;
  // Record lifecycle fields are authoritative metadata. This also prevents an
  // older encrypted import preview from masking its later committed receipt.
  return { ...content, ...metadata };
}
async function writeEncrypted(collection, id, recordType, metadata, content, deps, create = true) {
  const encryptedContent = await deps.prayerCrypto.encryptJson(content, context(recordType, id, metadata.ownerSub));
  const value = { ...metadata, encryptedContent };
  if (create) await collection.doc(id).create(value); else await collection.doc(id).set(value);
  return { id, ...value };
}
async function buildEncryptedValue(id, recordType, metadata, content, deps) {
  return { ...metadata, encryptedContent: await deps.prayerCrypto.encryptJson(content, context(recordType, id, metadata.ownerSub)) };
}
async function persistVersionedPrayer(record, expectedVersion, metadata, content, deps, eventSpec = null) {
  const prayerValue = await buildEncryptedValue(record.id, "prayer", metadata, content, deps);
  const prayerRef = deps.prayersCollection.doc(record.id);
  let eventValue = null;
  let eventRef = null;
  if (eventSpec) {
    eventValue = await buildEncryptedValue(eventSpec.id, "event", eventSpec.metadata, eventSpec.content, deps);
    eventRef = deps.prayerEventsCollection.doc(eventSpec.id);
  }
  if (deps.firestoreDb && typeof deps.firestoreDb.runTransaction === "function") {
    await deps.firestoreDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(prayerRef);
      const current = snapshot.exists ? snapshot.data() || {} : null;
      if (!current || current.ownerSub !== record.ownerSub) fail("Prayer record was not found", 404, "prayer_not_found");
      if (current.version !== expectedVersion) fail("Prayer changed since it was read", 409, "prayer_version_conflict", { expectedVersion, currentVersion: current.version });
      transaction.set(prayerRef, prayerValue);
      if (eventRef) transaction.create(eventRef, eventValue);
    });
  } else {
    await prayerRef.set(prayerValue);
    if (eventRef) await eventRef.create(eventValue);
  }
  return {
    prayer: { id: record.id, ...prayerValue },
    event: eventValue ? { id: eventSpec.id, ...eventValue } : null
  };
}
async function readDoc(collection, id) { const snapshot = await collection.doc(id).get(); return snapshot.exists ? { id, ...(snapshot.data() || {}) } : null; }

async function createPrayerList(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.write");
  const title = normalizeString(input.title); if (!title) fail("Prayer list title is required", 400, "prayer_list_title_required");
  const listId = normalizeString(input.listId) || newId("prayer-list", deps); const timestamp = nowIso(deps);
  const record = await writeEncrypted(deps.prayerListsCollection, listId, "list", {
    ownerSub: identity.subject, status: "active", version: 1, createdAt: timestamp, updatedAt: timestamp
  }, { title, description: normalizeString(input.description) }, deps);
  return { list: await decryptRecord(record, "list", deps) };
}

async function listPrayerLists(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.read");
  const status = normalizeString(input.status);
  const records = (await scan(deps.prayerListsCollection)).filter((r) => owns(r, identity) && (!status || r.status === status));
  return { lists: await Promise.all(records.slice(0, MAX_SCAN).map((r) => decryptRecord(r, "list", deps))), totalCount: records.length, complete: records.length <= MAX_SCAN };
}

async function createPrayer(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.write");
  const title = normalizeString(input.title); const prayerText = typeof input.prayerText === "string" ? input.prayerText : "";
  if (!title || !prayerText.trim()) fail("Prayer title and full prayer text are required", 400, "prayer_content_required");
  const listId = normalizeString(input.listId); if (!listId) fail("listId is required", 400, "prayer_list_required");
  assertRecord(await readDoc(deps.prayerListsCollection, listId), identity, "prayer_list_not_found");
  const prayerId = normalizeString(input.prayerId) || newId("prayer", deps); const timestamp = nowIso(deps);
  const record = await writeEncrypted(deps.prayersCollection, prayerId, "prayer", {
    ownerSub: identity.subject, listId, status: "active", schedule: normalizeSchedule(input.schedule), version: 1,
    prayedCount: 0, lastPrayedAt: "", answeredAt: "", archivedAt: "", statusBeforeArchive: "", source: normalizeString(input.source), sourceRef: normalizeString(input.sourceRef), createdAt: timestamp, updatedAt: timestamp
  }, { title, prayerText, privateContext: typeof input.privateContext === "string" ? input.privateContext : "", tags: cleanArray(input.tags), people: cleanArray(input.people), topics: cleanArray(input.topics), presentation: normalizePrayerPresentation(input.presentation) }, deps);
  return { prayer: await decryptRecord(record, "prayer", deps) };
}

async function getPrayer(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.read"); const prayerId = normalizeString(input.prayerId);
  const record = await readDoc(deps.prayersCollection, prayerId); assertRecord(record, identity);
  return { prayer: await decryptRecord(record, "prayer", deps) };
}

async function listPrayers(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.read"); const statuses = cleanArray(input.statuses || (input.status ? [input.status] : []));
  const records = (await scan(deps.prayersCollection)).filter((r) => owns(r, identity) && (!input.listId || r.listId === input.listId) && (!statuses.length || statuses.includes(r.status)));
  const prayers = await Promise.all(records.slice(0, MAX_SCAN).map((r) => decryptRecord(r, "prayer", deps)));
  prayers.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { prayers, totalCount: prayers.length, complete: records.length <= MAX_SCAN };
}

async function getTodaysPrayers(input = {}, deps = {}) {
  const at = normalizeString(input.at) || nowIso(deps); const result = await listPrayers({ statuses: ["active"] }, deps);
  const prayers = result.prayers.filter((p) => isDue(p.schedule, at, p.lastPrayedAt, p.createdAt));
  const lists = await listPrayerLists({ status: "active" }, deps);
  const formatted = buildTodaysPrayerPresentation(prayers, lists.lists);
  return { at, prayers: formatted.prayers, presentation: formatted.presentation, totalCount: prayers.length, complete: result.complete && lists.complete };
}

function prayerListNumber(title) {
  const match = normalizeString(title).match(/^(\d{1,2})(?:\.|\s)/);
  return match ? Number(match[1]) : null;
}

function findTemplateLocation({ area, group, subheader } = {}) {
  for (const section of PRAYER_PRESENTATION_TEMPLATE) {
    if (area && section.key !== area) continue;
    for (const candidateGroup of section.groups) {
      if (group && candidateGroup.key !== group) continue;
      const candidateSubheader = subheader ? candidateGroup.subheaders.find((item) => item.key === subheader) : candidateGroup.subheaders[0];
      if (candidateSubheader) return { section, group: candidateGroup, subheader: candidateSubheader };
    }
  }
  return null;
}

function defaultPresentationForPrayer(prayer, list) {
  const listNumber = prayerListNumber(list?.title);
  if (listNumber === 1) return { area: "inward", group: "personal", subheader: "personal-needs-and-growth" };
  for (const section of PRAYER_PRESENTATION_TEMPLATE) for (const group of section.groups) for (const subheader of group.subheaders) {
    if (subheader.listNumbers.includes(listNumber)) return { area: section.key, group: group.key, subheader: subheader.key };
  }
  return { area: "outward", group: "community", subheader: "current-requests" };
}

function buildTodaysPrayerPresentation(prayers = [], lists = []) {
  const listById = new Map(lists.map((list) => [list.id, list]));
  const sections = PRAYER_PRESENTATION_TEMPLATE.map((section) => ({
    number: section.number, key: section.key, title: section.title, description: section.description,
    groups: section.groups.map((group) => ({
      number: group.number, key: group.key, title: group.title,
      subheaders: group.subheaders.map((subheader) => ({ number: subheader.number, key: subheader.key, title: subheader.title, prayers: [] }))
    }))
  }));
  const sectionByKey = new Map(sections.map((section) => [section.key, section]));
  for (const prayer of prayers) {
    const list = listById.get(prayer.listId);
    const explicit = normalizePrayerPresentation(prayer.presentation);
    const resolved = explicit.area ? { ...defaultPresentationForPrayer(prayer, list), ...explicit } : defaultPresentationForPrayer(prayer, list);
    let location = findTemplateLocation(resolved) || findTemplateLocation({ area: resolved.area, group: resolved.group });
    if (!location) location = findTemplateLocation({ area: "outward", group: "community" });
    const section = sectionByKey.get(location.section.key);
    const group = section.groups.find((item) => item.key === location.group.key);
    let subheader = group.subheaders.find((item) => item.key === resolved.subheader);
    if (!subheader) {
      subheader = { number: `${group.number}.${group.subheaders.length + 1}`, key: resolved.subheader || "current-requests", title: "Current Requests", prayers: [] };
      group.subheaders.push(subheader);
    }
    subheader.prayers.push({
      prayer,
      note: prayer.privateContext || "",
      sourceList: list ? { id: list.id, title: list.title, description: list.description || "" } : { id: prayer.listId, title: "", description: "" },
      presentation: resolved
    });
  }
  for (const section of sections) for (const group of section.groups) for (const subheader of group.subheaders) {
    subheader.prayers.sort((a, b) => (Number(a.presentation?.order) || Number.MAX_SAFE_INTEGER) - (Number(b.presentation?.order) || Number.MAX_SAFE_INTEGER) || String(a.prayer.createdAt).localeCompare(String(b.prayer.createdAt)) || a.prayer.id.localeCompare(b.prayer.id));
    subheader.prayers = subheader.prayers.map((item, index) => ({ ...item, number: `${subheader.number}.${index + 1}` }));
    subheader.prayerCount = subheader.prayers.length;
  }
  const orderedPrayers = [];
  for (const section of sections) for (const group of section.groups) for (const subheader of group.subheaders) {
    subheader.prayerIds = subheader.prayers.map(({ prayer }) => prayer.id);
    for (const item of subheader.prayers) orderedPrayers.push({
      ...item.prayer,
      note: item.note,
      number: item.number,
      sourceList: item.sourceList,
      presentation: item.presentation
    });
    delete subheader.prayers;
  }
  return {
    prayers: orderedPrayers,
    presentation: {
      formatVersion: "dan-upward-inward-outward-v1",
      title: "Dan’s Daily Prayer List",
      numbering: "Stable section and subheader numbers; due prayers are numbered within their subheader each day.",
      notes: "Each prayer note is included from its privateContext field without rewriting.",
      sections
    }
  };
}

async function searchPrayers(input = {}, deps = {}) {
  const query = normalizeString(input.query).toLowerCase(); if (!query) fail("Prayer search query is required", 400, "prayer_search_required");
  const identity = requireScope(deps, "prayer.read");
  const result = await listPrayers({ statuses: input.statuses }, deps);
  const eventRecords = (await scan(deps.prayerEventsCollection)).filter((record) => owns(record, identity));
  const events = await Promise.all(eventRecords.slice(0, MAX_SCAN).map((record) => decryptRecord(record, "event", deps)));
  const eventPrayerIds = new Set(events.filter((event) => [event.reflection, event.answerText, event.note].filter(Boolean).join("\n").toLowerCase().includes(query)).map((event) => event.prayerId));
  const prayers = result.prayers.filter((p) => eventPrayerIds.has(p.id) || [p.title, p.prayerText, p.privateContext, ...(p.tags || []), ...(p.people || []), ...(p.topics || [])].join("\n").toLowerCase().includes(query));
  return { prayers, totalCount: prayers.length, complete: result.complete && eventRecords.length <= MAX_SCAN, plaintextIndexCreated: false };
}

async function updatePrayer(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.write"); const prayerId = normalizeString(input.prayerId); const expected = parseExpectedVersion(input.expectedVersion);
  const record = await readDoc(deps.prayersCollection, prayerId); assertRecord(record, identity); if (record.version !== expected) fail("Prayer changed since it was read", 409, "prayer_version_conflict", { expectedVersion: expected, currentVersion: record.version });
  const current = await decryptRecord(record, "prayer", deps); const changes = input.changes && typeof input.changes === "object" ? input.changes : {};
  if (changes.listId) assertRecord(await readDoc(deps.prayerListsCollection, changes.listId), identity, "prayer_list_not_found");
  const content = {
    title: changes.title !== undefined ? normalizeString(changes.title) : current.title,
    prayerText: changes.prayerText !== undefined ? String(changes.prayerText) : current.prayerText,
    privateContext: changes.privateContext !== undefined ? String(changes.privateContext) : current.privateContext,
    tags: changes.tags !== undefined ? cleanArray(changes.tags) : current.tags,
    people: changes.people !== undefined ? cleanArray(changes.people) : current.people,
    topics: changes.topics !== undefined ? cleanArray(changes.topics) : current.topics,
    presentation: changes.presentation !== undefined ? normalizePrayerPresentation(changes.presentation) : (current.presentation || {})
  };
  if (!content.title || !content.prayerText.trim()) fail("Prayer title and full prayer text are required", 400, "prayer_content_required");
  const metadata = { ...record, listId: changes.listId || record.listId, schedule: changes.schedule ? normalizeSchedule(changes.schedule) : record.schedule, version: record.version + 1, updatedAt: nowIso(deps) };
  delete metadata.id; delete metadata.encryptedContent;
  const persisted = await persistVersionedPrayer(record, expected, metadata, content, deps);
  return { prayer: await decryptRecord(persisted.prayer, "prayer", deps) };
}
async function mutateState(input, deps, eventType) {
  const identity = requireScope(deps, "prayer.write"); const prayerId = normalizeString(input.prayerId); const expected = parseExpectedVersion(input.expectedVersion);
  const record = await readDoc(deps.prayersCollection, prayerId); assertRecord(record, identity); if (record.version !== expected) fail("Prayer changed since it was read", 409, "prayer_version_conflict", { currentVersion: record.version });
  const content = await deps.prayerCrypto.decryptJson(record.encryptedContent, context("prayer", prayerId, record.ownerSub)); const timestamp = nowIso(deps);
  const metadata = { ...record, version: record.version + 1, updatedAt: timestamp }; delete metadata.id; delete metadata.encryptedContent;
  let eventContent = { note: typeof input.note === "string" ? input.note : "" };
  if (eventType === "prayed") { metadata.prayedCount = (record.prayedCount || 0) + 1; metadata.lastPrayedAt = timestamp; eventContent = { reflection: typeof input.reflection === "string" ? input.reflection : "" }; }
  if (eventType === "answered") { metadata.status = "answered"; metadata.answeredAt = timestamp; eventContent = { answerText: typeof input.answerText === "string" ? input.answerText : "" }; }
  if (eventType === "reopened") { metadata.status = "active"; metadata.answeredAt = ""; metadata.archivedAt = ""; }
  if (eventType === "archived") { metadata.statusBeforeArchive = record.status; metadata.status = "archived"; metadata.archivedAt = timestamp; }
  const eventId = newId("prayer-event", deps);
  const persisted = await persistVersionedPrayer(record, expected, metadata, content, deps, {
    id: eventId,
    metadata: { ownerSub: record.ownerSub, prayerId, eventType, occurredAt: timestamp, createdAt: timestamp },
    content: eventContent
  });
  return { prayer: await decryptRecord(persisted.prayer, "prayer", deps), event: await decryptRecord(persisted.event, "event", deps) };
}
const recordPrayed = (input, deps) => mutateState(input, deps, "prayed");
const markPrayerAnswered = (input, deps) => mutateState(input, deps, "answered");
const reopenPrayer = (input, deps) => mutateState(input, deps, "reopened");
const archivePrayer = (input, deps) => mutateState(input, deps, "archived");

async function getPrayerHistory(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.read"); const prayerId = normalizeString(input.prayerId);
  assertRecord(await readDoc(deps.prayersCollection, prayerId), identity);
  const records = (await scan(deps.prayerEventsCollection)).filter((r) => owns(r, identity) && r.prayerId === prayerId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return { events: await Promise.all(records.slice(0, MAX_SCAN).map((r) => decryptRecord(r, "event", deps))), totalCount: records.length, complete: records.length <= MAX_SCAN };
}

async function previewLogosImport(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.write"); const importId = normalizeString(input.importId); if (!importId) fail("A stable importId is required", 400, "prayer_import_id_required");
  const existing = await readDoc(deps.prayerImportsCollection, importId);
  const preview = await buildLogosImportPreview(input, deps); const timestamp = nowIso(deps);
  if (existing) {
    assertRecord(existing, identity, "prayer_import_not_found");
    if (existing.sourceHash !== preview.sourceHash) fail("This importId is already bound to a different Logos export", 409, "prayer_import_id_reused");
    return { preview: await decryptRecord(existing, "import", deps), replayed: true };
  }
  const currentLists = await listPrayerLists({}, deps);
  const listTitles = new Map(currentLists.lists.map((list) => [list.id, list.title]));
  const currentPrayers = await listPrayers({ statuses: ["active", "answered", "archived"] }, deps);
  const existingFingerprints = new Set(currentPrayers.prayers.map((prayer) => createHash("sha256").update(`${listTitles.get(prayer.listId) || ""}\u0000${prayer.prayerText}`.toLowerCase()).digest("hex")));
  const existingDuplicates = preview.prayers.filter((prayer) => existingFingerprints.has(prayer.fingerprint)).map((prayer) => ({ title: prayer.title, listTitle: prayer.listTitle, sourceParagraph: prayer.sourceParagraph, type: "existing_prayer" }));
  preview.duplicates.push(...existingDuplicates);
  preview.counts.duplicates = preview.duplicates.length;
  const record = await writeEncrypted(deps.prayerImportsCollection, importId, "import", { ownerSub: identity.subject, status: "previewed", sourceHash: preview.sourceHash, version: 1, createdAt: timestamp, updatedAt: timestamp }, preview, deps);
  return { preview: await decryptRecord(record, "import", deps), replayed: false };
}

async function getPrayerImport(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.read");
  const importId = normalizeString(input.importId);
  const record = await readDoc(deps.prayerImportsCollection, importId);
  assertRecord(record, identity, "prayer_import_not_found");
  return { import: await decryptRecord(record, "import", deps) };
}

async function commitLogosImport(input = {}, deps = {}) {
  const identity = requireScope(deps, "prayer.write"); const importId = normalizeString(input.importId); if (input.approved !== true) fail("The Logos import preview must be explicitly approved", 409, "prayer_import_approval_required");
  const importRecord = await readDoc(deps.prayerImportsCollection, importId); assertRecord(importRecord, identity, "prayer_import_not_found");
  const preview = await decryptRecord(importRecord, "import", deps);
  if (importRecord.status === "committed") return { import: preview, inventory: { importedPrayerCount: importRecord.importedPrayerCount || 0, expectedPrayerCount: preview.prayers.length, reconciled: (importRecord.importedPrayerCount || 0) === preview.prayers.length }, replayed: true };
  if (preview.prayers.length > MAX_SCAN || preview.lists.length > MAX_SCAN) fail("The Logos export exceeds the supported 2,000-record import", 400, "prayer_import_too_large");
  const listIds = new Map();
  for (const list of preview.lists) {
    const listId = `prayer-list-import-${createHash("sha256").update(`${importId}\u0000${list.title}`).digest("hex").slice(0, 24)}`;
    const result = await createPrayerList({ listId, title: list.title, description: "Imported from Logos" }, deps).catch(async (error) => {
      if (!/already exists/i.test(error.message)) throw error; return getPrayerListById(listId, deps);
    });
    listIds.set(list.title, result.list.id || listId);
  }
  let created = 0;
  for (const [index, prayer] of preview.prayers.entries()) {
    const prayerId = `prayer-import-${createHash("sha256").update(`${importId}\u0000${index}\u0000${prayer.fingerprint}`).digest("hex").slice(0, 32)}`;
    try {
      const createdPrayer = await createPrayer({ prayerId, listId: listIds.get(prayer.listTitle), title: prayer.title, prayerText: prayer.prayerText, privateContext: prayer.context, tags: prayer.tags, people: prayer.people, topics: prayer.topics, schedule: prayer.schedule || { kind: "unscheduled", timeZone: "America/Los_Angeles" }, source: "logos_docx_import", sourceRef: importId }, deps);
      if (prayer.status === "answered") await markPrayerAnswered({ prayerId, expectedVersion: createdPrayer.prayer.version, answerText: prayer.answerText || "" }, deps);
      created += 1;
    } catch (error) { if (!/already exists/i.test(error.message)) throw error; }
  }
  const completed = { ...importRecord, status: "committed", version: importRecord.version + 1, importedListCount: listIds.size, importedPrayerCount: preview.prayers.length, createdPrayerCount: created, committedAt: nowIso(deps), updatedAt: nowIso(deps) };
  delete completed.id; delete completed.encryptedContent;
  const saved = await writeEncrypted(deps.prayerImportsCollection, importId, "import", completed, preview, deps, false);
  const inventory = await listPrayers({ statuses: ["active", "answered", "archived"] }, deps);
  return { import: await decryptRecord(saved, "import", deps), inventory: { importedPrayerCount: inventory.prayers.filter((p) => p.sourceRef === importId).length, expectedPrayerCount: preview.prayers.length, reconciled: inventory.prayers.filter((p) => p.sourceRef === importId).length === preview.prayers.length }, replayed: false };
}
async function getPrayerListById(listId, deps) { const identity = requireScope(deps, "prayer.read"); const record = await readDoc(deps.prayerListsCollection, listId); assertRecord(record, identity, "prayer_list_not_found"); return { list: await decryptRecord(record, "list", deps) }; }

module.exports = { PRAYER_STATUSES, archivePrayer, assertPrayerAccess, commitLogosImport, createPrayer, createPrayerList, getPrayer, getPrayerHistory, getPrayerImport, getTodaysPrayers, isDue, listPrayerLists, listPrayers, markPrayerAnswered, normalizeSchedule, previewLogosImport, recordPrayed, reopenPrayer, searchPrayers, updatePrayer };
