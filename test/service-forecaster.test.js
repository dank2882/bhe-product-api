"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getServicePlan, buildServiceForecast, writeServicePlan } = require("../lib/service-forecaster");
const { runIdempotentMinistryPlanningOperation } = require("../lib/ministry-planning-operation-execution");
const clone = v => structuredClone(v);
class Collection {
  constructor(records = {}) { this.data = new Map(Object.entries(records)); }
  doc(id) { const c = this; return { id, c, get: async () => ({ exists: c.data.has(id), data: () => clone(c.data.get(id)) }) }; }
  where(...filter) { return this.query([filter]); }
  query(filters, limit = 1000) { return { where: (...f) => this.query([...filters, f], limit), limit: n => this.query(filters, n), get: async () => ({ docs: [...this.data].filter(([,v]) => filters.every(([k, op, val]) => op === "==" ? v[k] === val : op === ">=" ? v[k] >= val : v[k] <= val)).slice(0, limit).map(([id,v]) => ({ id, data: () => clone(v) })) }) }; }
}
function deps() {
  const d = { actorSubject: "test-actor", idempotencyKey: "test-intent-0001", now: () => "2026-10-29T18:00:00Z", servicesCollection: new Collection({ s1: { serviceDate: "2026-11-04", serviceType: "prayer_service", title: "Prayer Service" }, s2: { serviceDate: "2026-11-11", serviceType: "prayer_service" } }), serviceOrderItemsCollection: new Collection(), serviceSongEventsCollection: new Collection(), serviceMomentsCollection: new Collection(), serviceMinistryAssignmentsCollection: new Collection(), ministryPlanningOperationExecutionsCollection: new Collection() };
  d.db = { runTransaction: async fn => { const writes = []; const result = await fn({ get: ref => ref.get(), set: (ref,v) => writes.push(() => ref.c.data.set(ref.id,clone(v))), update: (ref,v) => writes.push(() => ref.c.data.set(ref.id, { ...ref.c.data.get(ref.id), ...clone(v) })) }); writes.forEach(f => f()); return result; } };
  return d;
}
const item = { title: "Missions update", itemType: "missions_update", sequence: 20, durationMinutes: 8, status: "proposed", assignedPeople: [{ displayName: "Presenter", role: "presenter", status: "invited" }], preparation: [{ title: "Video", ready: false, dueDate: "2026-11-03" }] };
test("planner dispatcher saves atomically, replays exact intent, and rejects changed key reuse", async () => {
  const d = deps(), request = { mode: "command", operation: "saveServicePlanItem", idempotencyKey: "unique-request-001", arguments: { serviceId: "s1", expectedVersion: 0, itemId: "missions-1", item } };
  const saved = await runIdempotentMinistryPlanningOperation(request, d);
  assert.equal(saved.result.version, 1);
  assert.equal((await runIdempotentMinistryPlanningOperation(request, d)).idempotency.replayed, true);
  assert.equal(d.ministryPlanningOperationExecutionsCollection.data.size, 1);
  await assert.rejects(runIdempotentMinistryPlanningOperation({ ...request, arguments: { ...request.arguments, item: { ...item, title: "Different" } } }, d), { code: "idempotency_key_reused" });
  const plan = await getServicePlan({ serviceId: "s1" }, d);
  assert.equal(plan.items[0].assignedPeople[0].status, "invited");
  assert.equal(plan.timing.knownMinutes, 8);
  assert.ok(plan.issues.some(i => i.code === "preparation_needed"));
  assert.ok(plan.issues.some(i => i.code === "person_unconfirmed"));
});
test("stale edits and cross-service item hijacking leave state unchanged", async () => {
  const d = deps();
  await writeServicePlan("saveServicePlanItem", { serviceId: "s1", expectedVersion: 0, itemId: "item-1", item }, d);
  d.idempotencyKey = "second-intent";
  await assert.rejects(writeServicePlan("saveServicePlan", { serviceId: "s1", expectedVersion: 0, plan: { notes: "stale" } }, d), { code: "version_conflict" });
  await assert.rejects(writeServicePlan("saveServicePlanItem", { serviceId: "s2", expectedVersion: 0, itemId: "item-1", item }, d), { code: "item_service_conflict" });
  assert.equal(d.servicesCollection.data.get("s2").plannerVersion, undefined);
});
test("positive whole-service feedback preserves exact words without changing song metadata", async () => {
  const d = deps();
  await writeServicePlan("recordServiceFeedback", { serviceId: "s1", expectedVersion: 0, feedback: "Great music—it went really well together.", impact: "positive" }, d);
  const plan = await getServicePlan({ serviceId: "s1" }, d);
  assert.equal(plan.moments[0].postService.notes, "Great music—it went really well together.");
  assert.equal(d.serviceSongEventsCollection.data.size, 0);
});
test("forecast supports Wednesday aliases and exposes incomplete timing and legacy confirmations", async () => {
  const d = deps();
  d.serviceMinistryAssignmentsCollection.data.set("s1", { preacher: { displayName: "Speaker" } });
  await writeServicePlan("saveServicePlanItem", { serviceId: "s1", expectedVersion: 0, itemId: "item-1", item: { ...item, durationMinutes: null } }, d);
  const forecast = await buildServiceForecast({ dateFrom: "2026-11-01", dateTo: "2026-12-31", serviceType: "wednesday_night" }, d);
  assert.equal(forecast.count, 2);
  assert.equal(forecast.services[0].timing.complete, false);
  assert.ok(forecast.services[0].issues.some(i => i.code === "speaker_confirmation_unknown"));
  assert.equal(forecast.coverage.sheetReconciled, false);
  await assert.rejects(buildServiceForecast({ dateFrom: "2026-02-30", dateTo: "2026-12-31" }, d), { code: "invalid_service_plan" });
});
test("invalid nested data and cross-service music links never write partial plans", async () => {
  const d = deps();
  d.serviceSongEventsCollection.data.set("song-1", { serviceId: "s2" });
  for (const invalid of [{ ...item, linkedServiceSongEventId: "song-1" }, { ...item, assignedPeople: [{ displayName: "Name", role: "lead", status: "booked" }] }, { ...item, preparation: [{ title: "video", ready: "yes" }] }]) await assert.rejects(writeServicePlan("saveServicePlanItem", { serviceId: "s1", expectedVersion: 0, itemId: "item-1", item: invalid }, d));
  assert.equal(d.serviceOrderItemsCollection.data.size, 0);
  assert.equal(d.ministryPlanningOperationExecutionsCollection.data.size, 0);
});
test("cancelled elements retain history but do not consume service time", async () => {
  const d = deps();
  await writeServicePlan("saveServicePlanItem", { serviceId: "s1", expectedVersion: 0, itemId: "item-1", item: { ...item, status: "cancelled" } }, d);
  const plan = await getServicePlan({ serviceId: "s1" }, d);
  assert.equal(plan.items.length, 0); assert.equal(plan.cancelledItems.length, 1); assert.equal(plan.timing.knownMinutes, 0);
});
