"use strict";
const { string, fail } = require("./maintenance-fields");
const { createHash } = require("node:crypto");
function requestFields(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["title", "building", "area"].includes(k))) fail("Use title, building and area for request details");
  return { title: string(value.title, 300), building: string(value.building, 200), area: string(value.area, 300) };
}
function suggestedFields(message) {
  if (message.approval) return message.approval.fields;
  const label = name => new RegExp(`^${name}\\s*:\\s*(.+)$`, "im").exec(message.body || "")?.[1]?.trim() || "";
  return requestFields({ title: (label("(?:Task|Problem|Work)") || message.subject || "").slice(0, 300), building: label("Building").slice(0, 200), area: label("(?:Area|Room|Location)").slice(0, 300) });
}
const missingFields = fields => ["title", "building", "area"].filter(k => !fields[k] || /^(unknown|unconfirmed|tbd|n\/?a|not specified)$/i.test(fields[k]));
const requestTaskId = messageId => `task-maintenance-request-${createHash("sha256").update(messageId).digest("hex").slice(0, 32)}`;
module.exports = { requestFields, suggestedFields, missingFields, requestTaskId };
