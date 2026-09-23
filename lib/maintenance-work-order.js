"use strict";
const { string, fail } = require("./maintenance-fields");
const { createHash } = require("node:crypto");
const WORK_ORDER_TEMPLATE = Object.freeze({
  id: "maintenance_work_order_v1", name: "FBC Maintenance Work Order", from: "maintenance@foundedonfaith.com",
  subject: "FBC Work Order {reference} — {title}",
  body: "Hello {recipientName},\n\nPlease review the following maintenance work order.\n\nWork order: {reference}\nRequested work: {title}\nLocation: {building} / {area}\nPriority: {priority}\nRequested completion: {targetDate}\n\nWork instructions:\n{instructions}\n\nAccess / scheduling:\n{accessNotes}\n\nPlease reply to confirm whether you can take this work and when you expect to complete it. If a quote, materials purchase, or additional work is needed, please check with us before proceeding.\n\nWhen finished, reply with what was done, any remaining issues, and completion photos when helpful. Please keep the work order reference in your reply.\n\nThank you,\nShawna\nFaith Baptist Church Maintenance\nmaintenance@foundedonfaith.com",
  guidance: "Draft only. Populate from the current task and Shawna's instructions; never include internal task notes automatically or invent scope, costs, deadlines or commitments. Recipient approval/actual consent and exact outgoing draft approval remain required."
});
function workOrder(task, input = {}) {
  if (["dropped", "done"].includes(task.status)) fail("Reopen this task before drafting a new work order", 409);
  const reference = `M-${createHash("sha256").update(JSON.stringify(task.taskId)).digest("hex").slice(0, 8)}`;
  const data = { reference, title: task.title, building: task.maintenance?.building || "Location to be confirmed", area: task.maintenance?.area || "Area to be confirmed", priority: task.priority || "Not set", targetDate: task.dueDate || "To be agreed", recipientName: string(input.recipientName, 200) || "there", instructions: string(input.instructions, 6000) || task.title, accessNotes: string(input.accessNotes, 2000) || "Please coordinate access and timing with Maintenance before arriving." };
  const fill = template => template.replace(/\{(\w+)\}/g, (_, key) => data[key]);
  return { templateId: WORK_ORDER_TEMPLATE.id, reference, subject: fill(WORK_ORDER_TEMPLATE.subject), body: fill(WORK_ORDER_TEMPLATE.body) };
}
module.exports = { WORK_ORDER_TEMPLATE, workOrder };
