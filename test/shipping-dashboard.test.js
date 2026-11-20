"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { windowFor, project } = require("../lib/shipping-dashboard");
const M = require("../lib/shipping-model");
const { fakeFirestore } = require("./helpers/maintenance-firestore");
const { runShippingOperation } = require("../lib/shipping-operation-registry");
const window = windowFor("2026-11-20T20:00:00Z");
const milestone = (kind, date, more = {}) => ({ id: kind, kind, date, dateType: "actual", verification: "reported", sources: ["s"], ...more });
const shipment = (more = {}) => ({ ...M.newShipment({ title: "Synthetic shipment", destinationCountry: "Philippines", recordKind: "proposal", sources: [{ id: "s", kind: "user", title: "Synthetic source" }] }), shipmentId: "ship-test", version: 1, status: "proposed", ...more });
test("six calendar months uses Pacific date and clamps month ends", () => {
  assert.equal(window.from, "2026-05-20");
  assert.equal(windowFor("2026-11-21T02:00:00Z").asOf, "2026-11-20");
  assert.equal(windowFor("2026-08-31T20:00:00Z").from, "2026-02-28");
});
test("actual activity overlaps current; ETA is never arrival and proposal kind cannot hide loaded shipment", () => {
  const s = shipment({ status: "loaded", milestones: [milestone("loaded", "2026-11-11"), milestone("departed", "2026-11-19"), milestone("portArrival", "2027-01-17", { dateType: "estimated" })] });
  const row = project(s, window);
  assert.deepEqual(row.groups, ["recent", "current"]);assert.equal(row.latestActivity.kind, "departed");assert.equal(row.location, null);
  assert.equal(row.arrivals[0].dateType, "estimated");assert.equal(row.costEvidence.invoiceCount, 0);assert.equal(row.costEvidence.paymentCount, 0);
});
test("old incomplete history, canceled plans, month-only and disputed dates never become recent confirmed trips", () => {
  assert.deepEqual(project(shipment({ recordKind: "historical", status: "historical-incomplete", milestones: [milestone("departed", "2020-01-01")] }),window).groups, ["unconfirmed"]);
  assert.deepEqual(project(shipment({ status: "canceled", milestones: [milestone("departed", "2026-11-01")] }),window).groups, ["canceled"]);
  for (const extra of [{precision:"month"},{verification:"disputed"},{verification:"unverified"},{date:"2027-01-01"}]) assert(!project(shipment({ milestones:[milestone("departed","2026-11-01",extra)] }),window).groups.includes("recent"));
});
test("recent boundary inclusive; superseded/conflicting dates and partial delivery do not establish full completion", () => {
  assert(project(shipment({ milestones: [milestone("departed", window.from)] }),window).groups.includes("recent"));
  assert(!project(shipment({ milestones: [milestone("departed", "2026-05-19")] }),window).groups.includes("recent"));
  const s=shipment({ status:"in-transit", containers:[{id:"a",size:"20"},{id:"b",size:"20"}], milestones:[milestone("delivered","2026-11-19",{containerId:"a"})] });
  assert(project(s,window).groups.includes("current"));assert.equal(project(s,window).recentActivity[0].containerId,"a");
  const bad=shipment({milestones:[milestone("departed","2026-11-01"),milestone("departed","2026-11-02",{id:"correction"})]});
  assert(!project(bad,window).groups.includes("recent"));assert(project(bad,window).warnings.length);
  bad.milestones[1].supersedes="departed";assert.equal(project(bad,window).recentActivity.length,1);
});
test("dashboard uses owner authorization, filter-bound pagination and exposes no document storage", async () => {
  const db=fakeFirestore(), deps={firestoreDb:db,shippingOwnerSubjects:["dan"],taskAccess:{subject:"dan",scopes:["shipping.read"]},now:()=>Date.parse("2026-11-20T20:00:00Z")};
  for(let i=0;i<3;i++) await db.collection("fbcShippingShipments").doc("ship-"+i).set(shipment({shipmentId:"ship-"+i,destinationCountry:i===2?"Philippines":"Mexico",owner:"fbc",documents:[{id:"restricted",sensitivity:"restricted",storagePath:"never-expose"}]}));
  const call=(args={},override={})=>runShippingOperation({mode:"query",operation:"getDashboard",arguments:args},{...deps,...override});
  const first=(await call({country:"Philippines",limit:2})).result;assert.equal(first.shipments.length,0);assert.equal(first.complete,false);assert(first.nextCursor);
  const second=(await call({country:"Philippines",limit:2,cursor:first.nextCursor})).result;assert.equal(second.shipments.length,1);assert.equal(second.complete,true);assert.equal(JSON.stringify(second).includes("never-expose"),false);
  await assert.rejects(call({country:"Mexico",cursor:first.nextCursor}),{code:"shipping_invalid_cursor"});
  await assert.rejects(call({}, {taskAccess:{subject:"other",scopes:["shipping.read"],role:"admin"}}),{code:"shipping_access_denied"});
});
