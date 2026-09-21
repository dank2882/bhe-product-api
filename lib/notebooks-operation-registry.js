"use strict";
const service = require("./notebooks-service");
const { requireDanPrivateAccess } = require("./dan-private-access");
const definitions = [
  ["browseNotebooks", "query", "Browse children of a notebook or root; name optionally resolves an exact sibling name.", [], ["parentId", "name", "includeArchived", "limit", "cursor"]],
  ["getNotebook", "query", "Read one notebook and its current path.", ["notebookId"], []],
  ["listNotes", "query", "List note summaries in one notebook.", ["notebookId"], ["includeArchived", "limit", "cursor"]],
  ["getNote", "query", "Retrieve exact saved note text, links, tags and current revision.", ["noteId"], []],
  ["getNoteHistory", "query", "List revision summaries or retrieve one exact historical revision.", ["noteId"], ["revisionId", "limit", "cursor"]],
  ["searchNotes", "query", "Search by words and meaning. Results are bounded; follow cursors and coverage. Never imply exhaustive semantic retrieval.", ["query"], ["mode", "notebookId", "tags", "updatedFrom", "updatedTo", "includeArchived", "limit", "cursor"]],
  ["getIndexingStatus", "query", "Inspect the current note indexing job.", ["noteId"], []],
  ["createNotebook", "command", "Create a notebook at root or inside parentId; duplicate names can be disambiguated by stable ID.", ["name"], ["parentId"]],
  ["updateNotebook", "command", "Rename, move, archive or restore a notebook. changes: name, parentId (empty for root), archived. Archiving hides the branch without changing descendant flags.", ["notebookId", "expectedVersion", "changes"], []],
  ["createNote", "command", "Preserve text exactly. Missing notebookId saves to Unfiled. Summaries are separate. Web links are not fetched.", ["title", "text"], ["notebookId", "tags", "links", "assistantSummary", "recordLinks"]],
  ["updateNote", "command", "Edit, move, archive or restore a note with a new revision. changes: title, text, tags, links, assistantSummary, recordLinks, notebookId, archived.", ["noteId", "expectedVersion", "changes"], []],
  ["restoreNoteRevision", "command", "Restore historical content as a new revision; retain the current notebook and archive state.", ["noteId", "expectedVersion", "revisionId"], []],
  ["linkNoteRecord", "command", "Link a verified owning-domain record by domain and recordId without copying its contents.", ["noteId", "expectedVersion", "domain", "recordId"], []],
  ["retryIndexing", "command", "Redeliver the current durable embedding job without creating another note or revision.", ["noteId", "expectedVersion"], []]
];
const operations = definitions.map(([name, mode, summary, required, optional]) => ({ name, mode, summary, required, optional }));
function listNotebookOperations(input = {}) {
  return { catalogVersion: "1.0.0", owner: "dan", domain: "notebooks", operations: operations.filter((o) => (!input.mode || o.mode === input.mode) && (!input.query || `${o.name} ${o.summary}`.toLowerCase().includes(input.query.toLowerCase()))) };
}
async function runNotebookOperation(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const operation = operations.find((o) => o.name === input.operation && o.mode === input.mode);
  const args = input.arguments || {};
  const invalid = (message) => { throw Object.assign(new Error(message), { statusCode: 400, code: "notebooks_invalid_operation" }); };
  if (!operation) invalid("Unknown notebook operation or incorrect mode");
  if (!args || typeof args !== "object" || Array.isArray(args)) invalid("arguments must be an object");
  if (operation.required.some((k) => args[k] === undefined || args[k] === null)) invalid("Missing required operation argument");
  if (Object.keys(args).some((k) => !operation.required.includes(k) && !operation.optional.includes(k))) invalid("Unknown operation argument");
  const result = input.mode === "command"
    ? await service.runNotebookCommand(input.operation, args, input.idempotencyKey, deps)
    : await service[input.operation](args, deps);
  return { operation: input.operation, mode: input.mode, result };
}
module.exports = { listNotebookOperations, runNotebookOperation };
