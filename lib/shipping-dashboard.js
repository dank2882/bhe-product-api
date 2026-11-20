"use strict";
const M = require("./shipping-model");

// A read projection of the owning records, never a second shipment ledger.
function windowFor(timestamp) {
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
  const [year, month, day] = asOf.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 7, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return { asOf, from: first.toISOString().slice(0, 10), timeZone: "America/Los_Angeles" };
}
function project(s, window) {
  const milestones = M.activeMilestones(s).sort((a, b) => a.date.localeCompare(b.date));
  const conflicts = new Set();
  for (const m of milestones.filter(m => m.dateType === "actual")) {
    if (milestones.some(other => other.dateType === "actual" && other.kind === m.kind && other.containerId === m.containerId && other.date !== m.date)) conflicts.add(m.kind + ":" + (m.containerId || ""));
  }
  const actual = milestones.filter(m => m.dateType === "actual" && ["reported", "verified"].includes(m.verification) && m.date <= window.asOf && !conflicts.has(m.kind + ":" + (m.containerId || "")));
  const recent = actual.filter(m => ["departed", "delivered"].includes(m.kind) && m.precision !== "month" && m.date >= window.from);
  const covers = kind => {
    const rows = actual.filter(m => m.kind === kind);
    return rows.some(m => !m.containerId) || (s.containers.length > 0 && s.containers.every(c => rows.some(m => m.containerId === c.id)));
  };
  const moving = actual.some(m => ["loaded", "departed", "transshipment", "portArrival", "customsReleased"].includes(m.kind));
  const finished = ["delivered", "closed"].includes(s.status) || covers("delivered");
  const current = !finished && ((moving && s.recordKind !== "historical" && s.status !== "historical-incomplete") || ["loaded", "in-transit", "at-port", "clearing"].includes(s.status));
  const upcoming = !finished && !current && ["proposed", "preparing", "ready-for-review", "approved-for-booking", "booked"].includes(s.status);
  const groups = s.status === "canceled" ? ["canceled"] : [
    ...(recent.length ? ["recent"] : []), ...(current ? ["current"] : []), ...(upcoming ? ["upcoming"] : [])
  ];
  if (!groups.length) groups.push(finished && actual.some(m => m.kind === "delivered" && m.date < window.from) ? "older" : "unconfirmed");
  const requirements = s.requirements.filter(r => r.required && !["accepted", "waived"].includes(r.status)).sort((a,b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const latestActivity = actual.filter(m => ["loaded", "departed", "transshipment", "portArrival", "customsReleased", "delivered", "emptyReturned"].includes(m.kind)).at(-1) || null;
  const arrivals = milestones.filter(m => ["portArrival", "delivered"].includes(m.kind) && m.dateType !== "actual");
  const scheduled = milestones.filter(m => ["loaded", "departed", "booked"].includes(m.kind) && m.dateType !== "actual");
  const readiness = M.readiness(s, window.asOf), costs = M.costSummary(s, window.asOf);
  return {
    shipmentId: s.shipmentId, title: s.title, destinationCountry: s.destinationCountry, destinationCity: s.destinationCity || "", status: s.status,
    recordKind: s.recordKind, version: s.version, updatedAt: s.updatedAt, groups, containerCount: s.containers.length, containerNumbers: s.containers.map(c => c.number).filter(Boolean),
    needBy: s.needBy || null, recentActivity: recent, latestActivity, arrivals, scheduled,
    // No field in the existing model asserts current physical location. Keep the
    // original milestone note and source instead of inferring it from an ETA.
    location: null, requirements, nextAction: requirements[0] || null, readiness,
    incidents: s.incidents.filter(i => i.status !== "resolved"), payers: s.parties.filter(p => p.role === "payer"),
    costs, costEvidence: { invoiceCount: s.costs.filter(c => c.type === "invoice" && c.status === "active").length,
      paymentCount: s.payments.length, financialClosed: actual.filter(m => m.kind === "financialClosed") },
    sources: s.sources,
    warnings: [
      ...readiness.issues,
      ...(milestones.some(m => m.dateType === "actual" && (m.date > window.asOf || ["disputed", "unverified"].includes(m.verification) || m.precision === "month")) ? ["Some actual dates need review; uncertain dates do not establish recent activity."] : []),
      ...(s.status === "on-hold" ? ["Shipment is on hold."] : [])
    ]
  };
}
module.exports = { windowFor, project };
