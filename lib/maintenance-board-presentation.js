"use strict";

const { createHash } = require("node:crypto");
const { COLUMNS, fail, string } = require("./maintenance-fields");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lower = value => String(value || "").trim().toLowerCase();
const buildingKey = value => lower(value).replace(/ building$/, "");
const escapeCell = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_\[\]])/g, "\\$1").replace(/\|/g, "&#124;").replace(/[\r\n]+/g, " ").trim() || "—";
// Only service-signed HTTPS links become Markdown; record text stays escaped.
function markdownUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    return url.href.replace(/[()|<>\s]/g, char => encodeURIComponent(char));
  } catch { return ""; }
}

function photoCell(images) {
  if (!images.length) return "No photos";
  const count = `📷 **${images.length} ${images.length === 1 ? "photo" : "photos"}**`;
  const preview = markdownUrl(images[0].preview?.url), download = markdownUrl(images[0].download?.url);
  if (!preview) return `${count} · ${images[0].previewStatus === "unavailable" ? "Preview unavailable" : "Ask to view"}`;
  return `${count} · [Open photo](${preview})${download ? ` · [Download](${download})` : ""}`;
}

function workingNotes(notes, full) {
  const original = String(notes || "");
  return { text: full || original.length <= 240 ? original : `${original.slice(0, 240).trimEnd()}…`, truncated: !full && original.length > 240 };
}

function projectRow(record, deps, images = [], full = false, routine = false) {
  const m = record.maintenance || {}, id = routine ? record.routineId : record.taskId;
  const notes = workingNotes(record.notes, full);
  return {
    [routine ? "routineId" : "taskId"]: id, version: record.version,
    reference: `${routine ? "R" : "M"}-${digest(id).slice(0, 8)}`,
    building: m.building || "Unconfirmed", area: m.area || "Unconfirmed",
    recordStatus: record.status, assignmentStatus: record.assignmentStatus || "",
    notesTruncated: notes.truncated,
    ...(routine ? { recurrence: record.recurrence, recurrenceNotes: record.recurrenceNotes || "", lastCompletedAt: record.lastCompletedAt || "" } : {}),
    columns: {
      Project: deps.projectGraph.get(record.projectId)?.name || "Maintenance", Task: record.title,
      Priority: record.priority || m.sourcePriority || "Unconfirmed", "Third Party": m.thirdParty || "",
      Cost: m.cost || { estimate: null, actual: null, currency: "USD" },
      "Target Date": record.dueDate || m.targetDateText || (routine ? record.recurrence : "") || "",
      Status: routine ? record.status : record.status === "dropped" ? "Archived" : record.status === "done" ? "Completed" : m.workflowStatus || ({ next: "Not Started", waiting: "Waiting", scheduled: "Scheduled" }[record.status] || record.status),
      "Assigned To": record.assignedTo || "", Notes: notes.text, Images: images
    }, sourceStatus: m.sourceStatus || "", sourcePriority: m.sourcePriority || ""
  };
}

function renderTable(rows, range, total, hasMore, routine) {
  const output = [`${routine ? "Recurring duties" : "Maintenance tasks"}: ${range.from}–${range.to} of ${total} matching.`, ""];
  let group;
  for (const [index, row] of rows.entries()) {
    const nextGroup = `${row.building} / ${row.area}`;
    if (nextGroup !== group) {
      output.push(`**${escapeCell(nextGroup)}**`, "", `| ${COLUMNS.join(" | ")} |`, `| ${COLUMNS.map(() => "---").join(" | ")} |`);
      group = nextGroup;
    }
    const cells = { ...row.columns };
    cells.Task = `${row.reference} · ${cells.Task}`;
    const cost = cells.Cost;
    cells.Cost = cost.estimate == null && cost.actual == null ? "Unknown" : `Estimate: ${cost.estimate == null ? "unknown" : `${cost.currency} ${cost.estimate}`}; actual: ${cost.actual == null ? "unknown" : `${cost.currency} ${cost.actual}`}`;
    cells["Assigned To"] = !cells["Assigned To"] || cells["Assigned To"] === "TBD" ? "Unassigned" : `${cells["Assigned To"]}${row.assignmentStatus === "proposed" ? " (proposed)" : ""}`;
    cells.Images = photoCell(cells.Images);
    if (row.notesTruncated) cells.Notes += " [full notes available]";
    output.push(`| ${COLUMNS.map(column => column === "Images" ? cells.Images : escapeCell(cells[column])).join(" | ")} |`);
    // Blank line before the next group keeps Markdown tables separate.
    if (rows[index + 1]?.area !== row.area || rows[index + 1]?.building !== row.building) output.push("");
  }
  if (!rows.length) output.push("No matching records.");
  if (hasMore) output.push("More rows are available. Ask for the next page or choose a building or area.");
  const photoRows = rows.filter(row => row.columns.Images.length);
  const previews = photoRows.filter(row => markdownUrl(row.columns.Images[0].preview?.url));
  if (previews.length) {
    output.push("", "**Photo previews**", "");
    for (const row of previews) {
      const photo = row.columns.Images[0];
      output.push(`**${escapeCell(row.reference)} · ${escapeCell(row.columns.Task)}** — photo 1 of ${row.columns.Images.length}`, "",
        `![Photo for ${escapeCell(row.reference)}](${markdownUrl(photo.preview.url)})`, "");
    }
    output.push("Photo links expire after 15 minutes. Refresh this view for new links. Ask for a task’s photos to see additional images.", "");
  }
  if (photoRows.length > previews.length) output.push("Some previews are not shown here. Ask for the task reference to view its photos.", "");
  output.push("Use a task name or reference to request an update or view its details and photos. This table is a retrieved view; saved changes appear when it is refreshed.");
  return output.join("\n");
}

function presentBoard(allRows, input = {}, routine = false) {
  if (input.detailLevel !== undefined && !["compact", "full"].includes(input.detailLevel)) fail("detailLevel must be compact or full");
  const limit = input.limit === undefined ? 20 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("limit must be between 1 and 100");
  const filters = Object.fromEntries(["building", "area", "status", "priority", "assignedTo", "query", "reference"].map(key => [key, string(input[key], 500)]));
  if (input.unassigned !== undefined && typeof input.unassigned !== "boolean") fail("unassigned must be true or false");
  filters.unassigned = input.unassigned === true;
  const matches = row => (!filters.building || buildingKey(row.building) === buildingKey(filters.building)) &&
    (!filters.area || lower(row.area) === lower(filters.area)) &&
    (!filters.status || [row.recordStatus, row.columns.Status].some(value => lower(value) === lower(filters.status))) &&
    (!filters.priority || lower(row.columns.Priority) === lower(filters.priority)) &&
    (!filters.assignedTo || lower(row.columns["Assigned To"]) === lower(filters.assignedTo)) &&
    (!filters.unassigned || !row.columns["Assigned To"] || row.columns["Assigned To"] === "TBD") &&
    (!filters.reference || lower(row.reference) === lower(filters.reference)) &&
    (!filters.query || lower([row.building, row.area, row.columns.Project, row.columns.Task, row.reference].join(" ")).includes(lower(filters.query)));
  const rank = row => ({ b: 0, a: 1, "campus-wide": 2, fleet: 3, unconfirmed: 5 }[buildingKey(row.building)] ?? 4);
  const rows = allRows.filter(matches).sort((a, b) => rank(a) - rank(b) || a.building.localeCompare(b.building) || a.area.localeCompare(b.area) || a.columns.Project.localeCompare(b.columns.Project) || a.columns.Task.localeCompare(b.columns.Task) || a.reference.localeCompare(b.reference));
  if (new Set(allRows.map(row => row.reference)).size !== allRows.length) fail("Maintenance reference collision; use record IDs", 409);
  // Bind pagination to the authorized result, its presentation and query. Changes
  // between pages restart the view instead of silently skipping or repeating rows.
  const snapshot = digest({ rows, filters, routine, includeArchived: input.includeArchived === true });
  let start = 0;
  if (input.cursor) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(string(input.cursor, 2000), "base64url").toString()); } catch { /* fail below */ }
    if (!cursor || cursor.snapshot !== snapshot || !Number.isInteger(cursor.offset) || cursor.offset < 1 || cursor.offset >= rows.length) fail("Maintenance table changed or cursor is invalid; restart the query", 409);
    start = cursor.offset;
  }
  const page = rows.slice(start, start + limit), hasMore = start + page.length < rows.length;
  const range = { from: page.length ? start + 1 : 0, to: start + page.length };
  const byBuilding = {};
  for (const row of rows) byBuilding[row.building] = (byBuilding[row.building] || 0) + 1;
  return {
    columns: COLUMNS, rows: page, count: page.length, totalCount: rows.length, authorizedTotalCount: allRows.length,
    summary: { byBuilding, unassigned: rows.filter(row => !row.columns["Assigned To"] || row.columns["Assigned To"] === "TBD").length, unconfirmedLocation: rows.filter(row => row.building === "Unconfirmed").length },
    filters, range, hasMore, complete: !hasMore && start === 0,
    nextCursor: hasMore ? Buffer.from(JSON.stringify({ snapshot, offset: start + page.length })).toString("base64url") : null,
    markdown: renderTable(page, range, rows.length, hasMore, routine),
    guidance: "Display markdown directly as an in-chat working table, not a download or code block. Preserve all ten columns including Images, photo counts, links, and the inline Photo previews section; do not omit them when summarizing. Preserve grouping, references and page counts. Default to one readable page; fetch more when requested, and follow all pages only for an explicit complete list. Never call a page the complete list. Query by reference to recover the exact record; never use row position as its identity. Before an authorized update, retrieve current details/version, use existing versioned Task Management commands with an idempotency key, then read back and refresh the affected row. Assignment proposals are not accepted assignments. Compact Notes are excerpts; retrieve getTask or listMaintenanceRoutines with detailLevel full and reference for source history. Photo counts reflect actual attachments, not source placeholders. Signed photo URLs expire; refresh the query for fresh links. For additional photos use listAttachments and getAttachmentDownload, display preview.url inline and retain a download link. Recurring completion uses recordMaintenanceRoutineCompletion, not task completion. No automatic messages or spreadsheet exports. Markdown cells are not directly editable; accept changes through chat."
  };
}

module.exports = { projectRow, presentBoard, renderTable };
