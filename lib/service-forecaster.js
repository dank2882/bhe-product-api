"use strict";
const { createHash } = require("node:crypto");
const { stableStringify } = require("./workspace-operation-execution");
const WRITES = new Set(["saveServicePlan", "saveServicePlanItem", "recordServiceFeedback"]);
const statuses = ["open", "proposed", "invited", "confirmed", "completed", "cancelled"];
function fail(message, code = "invalid_service_plan", statusCode = 400) { throw Object.assign(new Error(message), { code, statusCode }); }
function str(value, name, max = 2000) { if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${name} must be nonempty text (maximum ${max})`); return value.trim(); }
function id(value) { const s = str(value, "ID", 200); if (!/^[a-zA-Z0-9_-]+$/.test(s)) fail("Invalid ID"); return s; }
function date(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail("Use a valid YYYY-MM-DD date"); return value; }
function fields(obj, allowed) { if (!obj || typeof obj !== "object" || Array.isArray(obj)) fail("Expected an object"); for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`Unsupported field: ${k}`); }
function number(value, name, max) { if (!Number.isInteger(value) || value < 0 || value > max) fail(`${name} must be an integer from 0 to ${max}`); return value; }
function status(value) { if (!statuses.includes(value)) fail("Invalid assignment status"); return value; }
function validateItem(patch, previous = {}) {
  fields(patch, ["title", "itemType", "sequence", "durationMinutes", "status", "assignedPeople", "notes", "preparation", "missionRecipientId", "format", "linkedServiceSongEventId"]);
  const out = { ...previous, ...patch };
  out.title = str(out.title, "title", 300);
  if (!["song", "prayer", "message", "offering", "baptism", "service_element", "missions_update", "graduation", "testimony", "recognition", "transition"].includes(out.itemType)) fail("Invalid service item type");
  out.sequence = number(out.sequence, "sequence", 10000);
  if (out.durationMinutes !== undefined && out.durationMinutes !== null) number(out.durationMinutes, "durationMinutes", 600);
  out.status = status(out.status || "proposed");
  if (out.notes !== undefined && (typeof out.notes !== "string" || out.notes.length > 5000)) fail("Invalid notes");
  for (const key of ["missionRecipientId", "linkedServiceSongEventId"]) if (out[key]) id(out[key]);
  if (out.format !== undefined && !["letter", "video", "live_call", "in_person", "other", ""].includes(out.format)) fail("Invalid presentation format");
  if (out.assignedPeople !== undefined) {
    if (!Array.isArray(out.assignedPeople) || out.assignedPeople.length > 20) fail("At most 20 assigned people");
    out.assignedPeople = out.assignedPeople.map(p => { fields(p, ["displayName", "personId", "role", "status"]); return { displayName: str(p.displayName, "person name", 200), ...(p.personId ? { personId: id(p.personId) } : {}), role: str(p.role, "role", 100), status: status(p.status || "proposed") }; });
  }
  if (out.preparation !== undefined) {
    if (!Array.isArray(out.preparation) || out.preparation.length > 30) fail("At most 30 preparation items");
    out.preparation = out.preparation.map(p => { fields(p, ["title", "responsible", "dueDate", "ready"]); if (typeof p.ready !== "boolean") fail("Preparation ready must be true or false"); return { title: str(p.title, "preparation title", 300), responsible: p.responsible ? str(p.responsible, "responsible", 200) : "", dueDate: p.dueDate ? date(p.dueDate) : "", ready: p.ready }; });
  }
  if (out.itemType === "song" && (!out.linkedServiceSongEventId || out.assignedPeople?.length)) fail("Music agenda items must link an existing service song event; manage performers through the music workflow");
  return out;
}
async function rows(collection, serviceId, limit = 301) {
  const s = await collection.where("serviceId", "==", serviceId).limit(limit).get();
  if (s.docs.length === limit) fail("Service exceeds supported read size; no partial plan returned", "service_plan_too_large", 409);
  return s.docs.map(d => ({ ...d.data(), docId: d.id }));
}
async function getServicePlan(input, deps) {
  const serviceId = id(input.serviceId);
  const ref = deps.servicesCollection.doc(serviceId);
  const before = await ref.get();
  if (!before.exists) fail("Service not found", "service_not_found", 404);
  const [items, songs, moments, assignment] = await Promise.all([
    rows(deps.serviceOrderItemsCollection, serviceId), rows(deps.serviceSongEventsCollection, serviceId), rows(deps.serviceMomentsCollection, serviceId), deps.serviceMinistryAssignmentsCollection.doc(serviceId).get()
  ]);
  const after = await ref.get();
  if (!after.exists || (after.data().plannerVersion || 0) !== (before.data().plannerVersion || 0)) fail("Plan changed while reading; retry", "version_conflict", 409);
  const service = { ...after.data(), serviceId };
  const active = items.filter(i => i.status !== "cancelled").sort((a,b) => a.sequence - b.sequence || a.docId.localeCompare(b.docId));
  const issues = [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(deps.now ? deps.now() : Date.now()));
  const assignments = assignment.exists ? assignment.data() : null;
  const message = active.find(i => i.itemType === "message");
  if (!message && !assignments?.preacher && !service.message?.speakerName) issues.push({ code: "speaker_missing", message: "Speaker not recorded" });
  else if (!message) issues.push({ code: "speaker_confirmation_unknown", message: "Legacy speaker record has no confirmation status" });
  if (!active.length) issues.push({ code: "order_missing", message: "Service order has not been planned" });
  let knownMinutes = 0, untimedItems = 0;
  for (const item of active) {
    if (Number.isInteger(item.durationMinutes)) knownMinutes += item.durationMinutes; else untimedItems++;
    if (!["confirmed", "completed"].includes(item.status)) issues.push({ code: "item_unconfirmed", itemId: item.docId, message: `${item.title}: ${item.status || "confirmation unknown"}` });
    if (["message", "missions_update", "graduation", "testimony"].includes(item.itemType) && !item.assignedPeople?.length) issues.push({ code: "person_missing", itemId: item.docId, message: `${item.title}: responsible person missing` });
    for (const p of item.assignedPeople || []) if (!["confirmed", "completed"].includes(p.status)) issues.push({ code: "person_unconfirmed", itemId: item.docId, message: `${p.displayName}: ${p.status || "confirmation unknown"}` });
    for (const p of item.preparation || []) if (!p.ready) issues.push({ code: "preparation_needed", itemId: item.docId, ...p, overdue: Boolean(p.dueDate && p.dueDate < today) });
  }
  const linkedSongs = new Set(active.map(i => i.linkedServiceSongEventId).filter(Boolean));
  const unplacedSongs = songs.filter(s => s.historyVisibility !== "superseded" && !linkedSongs.has(s.serviceSongEventId || s.docId));
  if (unplacedSongs.length) issues.push({ code: "music_not_in_order", message: `${unplacedSongs.length} recorded music items are not yet placed in the agenda` });
  const legacySpeaker = assignments?.preacher?.displayName || service.message?.speakerName;
  if (message && legacySpeaker && !message.assignedPeople?.some(p => p.displayName === legacySpeaker)) issues.push({ code: "speaker_source_difference", message: "Agenda speaker differs from the existing assignment; reconcile before relying on either" });
  const target = service.servicePlan?.targetMinutes ?? null;
  if (target !== null && knownMinutes > target) issues.push({ code: "over_target", message: `Known elements exceed target by ${knownMinutes - target} minutes` });
  if (untimedItems) issues.push({ code: "timing_incomplete", message: `${untimedItems} elements have no time estimate` });
  return { service, version: service.plannerVersion || 0, items: active, cancelledItems: items.filter(i => i.status === "cancelled"), songs: songs.filter(s => s.historyVisibility !== "superseded"), moments, assignments, timing: { knownMinutes, untimedItems, targetMinutes: target, remainingKnownMinutes: target === null ? null : target - knownMinutes, complete: active.length > 0 && !untimedItems && !unplacedSongs.length }, issues, coverage: { complete: true, sheetReconciled: false, availabilityChecked: false, musicRotationChecked: false }, sourceNote: "Backend records only. Imported names do not establish confirmation, availability or actual performance. Spreadsheet changes require separate reconciliation." };
}
async function buildServiceForecast(input, deps) {
  const dateFrom = date(input.dateFrom), dateTo = date(input.dateTo);
  if (dateTo < dateFrom || (Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000 > 366) fail("Choose an ordered date range of at most 366 days");
  const snapshot = await deps.servicesCollection.where("serviceDate", ">=", dateFrom).where("serviceDate", "<=", dateTo).limit(201).get();
  if (snapshot.docs.length > 200) fail("More than 200 services; narrow the date range", "forecast_too_large", 409);
  const type = v => ["prayer_service", "wednesday_night", "wednesday_evening", "midweek"].includes(v) ? "wednesday_night" : v;
  const selected = snapshot.docs.filter(d => !input.serviceType || type(d.data().serviceType) === type(input.serviceType));
  const plans = [];
  for (const d of selected) plans.push(await getServicePlan({ serviceId: d.id }, deps));
  const participation = new Map();
  for (const p of plans) for (const item of p.items) for (const person of item.assignedPeople || []) {
    if (person.status === "cancelled") continue;
    const key = `${p.service.serviceDate}|${person.personId || person.displayName.toLowerCase()}`;
    if (!participation.has(key)) participation.set(key, new Set());
    participation.get(key).add(p.service.serviceId);
  }
  for (const p of plans) {
    const seen = new Set();
    for (const item of p.items) for (const person of item.assignedPeople || []) {
      const key = `${p.service.serviceDate}|${person.personId || person.displayName.toLowerCase()}`;
      if (person.status !== "cancelled" && participation.get(key)?.size > 1 && !seen.has(key)) {
        p.issues.push({ code: "same_day_participation", message: `${person.displayName} is planned in multiple services that day; review timing and workload`, serviceIds: [...participation.get(key)], identityBasis: person.personId ? "personId" : "name_only_needs_verification" });
        seen.add(key);
      }
    }
  }
  plans.sort((a,b) => a.service.serviceDate.localeCompare(b.service.serviceDate) || a.service.serviceId.localeCompare(b.service.serviceId));
  return { dateFrom, dateTo, count: plans.length, services: plans.map(p => ({ serviceId: p.service.serviceId, date: p.service.serviceDate, serviceType: p.service.serviceType, title: p.service.title, version: p.version, emphasis: p.service.servicePlan?.emphasis || "", elements: p.items.map(i => ({ itemId: i.docId, title: i.title, itemType: i.itemType, status: i.status || "unknown", assignedPeople: i.assignedPeople || [] })), music: p.songs.map(s => ({ eventId: s.serviceSongEventId || s.docId, title: s.title || s.songTitleCandidate || "", performer: s.assignedPersonOrGroupRaw || "", confirmation: "unknown" })), legacySpeaker: p.assignments?.preacher || p.service.message?.speakerName || null, timing: p.timing, issues: p.issues })), coverage: { completeForSavedServices: true, missingServiceDatesNotInferred: true, sheetReconciled: false, availabilityChecked: false, musicRotationChecked: false }, note: "Missing dates are not proof of no service. No automatic invitations, calendar changes, or music eligibility recommendations." };
}
async function writeServicePlan(operation, input, deps) {
  if (!WRITES.has(operation)) fail("Unknown planner command");
  fields(input, operation === "saveServicePlan" ? ["serviceId", "expectedVersion", "plan"] : operation === "saveServicePlanItem" ? ["serviceId", "expectedVersion", "itemId", "item"] : ["serviceId", "expectedVersion", "feedback", "impact"]);
  const serviceId = id(input.serviceId), actor = str(deps.actorSubject, "authenticated actor", 500), key = str(deps.idempotencyKey, "idempotency key", 200);
  if (key.length < 8) fail("Idempotency key must contain at least 8 characters");
  number(input.expectedVersion, "expectedVersion", Number.MAX_SAFE_INTEGER);
  const hash = s => createHash("sha256").update(s).digest("hex");
  const fingerprint = hash(stableStringify({ operation, input }));
  const serviceRef = deps.servicesCollection.doc(serviceId);
  const receiptRef = deps.ministryPlanningOperationExecutionsCollection.doc(`service-plan-${hash(`${actor}\0${key}`)}`);
  return deps.db.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) { const saved = receipt.data(); if (saved.fingerprint !== fingerprint) fail("Idempotency key already used", "idempotency_key_reused", 409); return { ...saved.response, idempotency: { ...saved.response.idempotency, replayed: true } }; }
    const snap = await tx.get(serviceRef);
    if (!snap.exists) fail("Service not found", "service_not_found", 404);
    const service = snap.data();
    if ((service.plannerVersion || 0) !== input.expectedVersion) fail("Service plan changed; retrieve current version", "version_conflict", 409);
    const now = new Date(deps.now ? deps.now() : Date.now()).toISOString();
    const patch = { plannerVersion: input.expectedVersion + 1, plannerUpdatedAt: now, plannerUpdatedBy: actor };
    let itemRef, item;
    if (operation === "saveServicePlan") {
      fields(input.plan, ["emphasis", "targetMinutes", "notes"]);
      const p = { ...(service.servicePlan || {}), ...input.plan };
      for (const k of ["emphasis", "notes"]) if (p[k] !== undefined && (typeof p[k] !== "string" || p[k].length > 5000)) fail(`Invalid ${k}`);
      if (p.targetMinutes !== undefined && p.targetMinutes !== null) number(p.targetMinutes, "targetMinutes", 600);
      patch.servicePlan = p;
    } else if (operation === "saveServicePlanItem") {
      const itemId = id(input.itemId);
      itemRef = deps.serviceOrderItemsCollection.doc(itemId);
      const old = await tx.get(itemRef);
      if (old.exists && old.data().serviceId !== serviceId) fail("Item belongs to another service", "item_service_conflict", 409);
      item = validateItem(input.item, old.exists ? old.data() : {});
      if (item.linkedServiceSongEventId) {
        const song = await tx.get(deps.serviceSongEventsCollection.doc(item.linkedServiceSongEventId));
        if (!song.exists || song.data().serviceId !== serviceId) fail("Linked music event is not part of this service");
      }
      Object.assign(item, { serviceOrderItemId: itemId, serviceId, serviceDate: service.serviceDate, serviceType: service.serviceType, updatedAt: now, updatedBy: actor });
    } else {
      if (!["positive", "mixed", "needs_improvement", "neutral"].includes(input.impact)) fail("Invalid feedback impact");
      itemRef = deps.serviceMomentsCollection.doc(`feedback-${hash(`${actor}\0${key}`)}`);
      item = { serviceId, serviceDate: service.serviceDate, serviceType: service.serviceType, momentType: "whole_service_feedback", status: "reviewed", postService: { impact: input.impact, notes: (str(input.feedback, "feedback", 10000), input.feedback) }, createdAt: now, createdBy: actor };
    }
    const result = { serviceId, version: patch.plannerVersion, ...(itemRef ? { itemId: itemRef.id } : {}), spreadsheetWrite: { skipped: true, reason: "Planner changes remain in the owning backend; no sheet overwrite." } };
    const response = { operation, mode: "command", result, idempotency: { protected: true, replayed: false, executionId: receiptRef.id } };
    tx.update(serviceRef, patch);
    if (itemRef) tx.set(itemRef, item);
    tx.set(receiptRef, { operation, fingerprint, actor, createdAt: now, status: "succeeded", response, change: item || patch });
    return response;
  });
}
module.exports = { WRITES, getServicePlan, buildServiceForecast, writeServicePlan, validateItem };
