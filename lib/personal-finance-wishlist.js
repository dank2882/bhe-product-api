"use strict";
const M = require("./personal-finance-model");
const statuses = ["wanted", "deferred", "purchased", "dropped"];
const ordered = rows => rows.filter(x => x.status === "wanted").sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
function normalize(v, deps) {
  M.shape(v, ["id", "name", "estimatedCostCents", "currency", "notes", "status", "source"]);
  return { id: M.id(v.id), name: M.text(v.name, "wish name", 200), estimatedCostCents: v.estimatedCostCents == null ? null : M.amount(v.estimatedCostCents), currency: M.choice(v.currency, ["USD"], "currency"), notes: M.text(v.notes, "wish notes", 2000, true), status: M.choice(v.status || "wanted", statuses, "wish status"), source: M.source(v.source, deps) };
}
function changes(state, operation, args, deps) {
  const original = state.wishlist || [], rows = structuredClone(original);
  let order = ordered(rows).map(x => x.id), targetId;
  if (operation === "savePersonalWish") {
    const item = normalize(args.item, deps); targetId = item.id;
    const i = rows.findIndex(x => x.id === item.id);
    if (i < 0) { if (rows.length >= 200) M.fail("Wish list capacity reached", "personal_finance_capacity", 413); rows.push(item); }
    else rows[i] = item;
    order = order.filter(id => rows.find(x => x.id === id).status === "wanted");
    if (item.status === "wanted" && !order.includes(item.id)) order.push(item.id);
  } else {
    targetId = M.id(args.id);
    if (!order.includes(targetId)) M.fail("Only wanted items can be prioritized");
    const before = args.beforeId ? M.id(args.beforeId) : "";
    if (before === targetId) M.fail("Cannot move an item before itself");
    if (before && !order.includes(before)) M.fail("Priority target must be a wanted item");
    order = order.filter(id => id !== targetId);
    order.splice(before ? order.indexOf(before) : order.length, 0, targetId);
  }
  return rows.map(row => {
    const { revision, updatedAt, ...fields } = row;
    return { ...fields, rank: row.status === "wanted" ? order.indexOf(row.id) + 1 : null };
  }).filter(row => {
    const old = original.find(x => x.id === row.id);
    return !old || old.rank !== row.rank || row.id === targetId;
  }).map(record => ({ kind: "wishlist", record }));
}
function list(state, args) {
  const status = M.choice(args.status || "wanted", [...statuses, "all"], "wish status");
  const rows = (state.wishlist || []).filter(x => status === "all" || x.status === status).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id));
  return { version: state.version, status, ...M.page(rows, args, M.hash({ version: state.version, kind: "wishlist", status })), forecastEffect: "none" };
}
module.exports = { changes, list };
