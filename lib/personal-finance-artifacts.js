"use strict";
const M = require("./personal-finance-model");
const TYPES = ["source_review", "forecast_review", "decision_record", "calculation_inputs", "calculation_method", "import_review", "manifest"];
function normalize(v, deps) {
  M.shape(v, ["id", "name", "type", "date", "basedOnVersion", "format", "content", "source", "status"]);
  if (!Number.isSafeInteger(v.basedOnVersion) || v.basedOnVersion < 0) M.fail("Artifact requires a workspace version");
  const date = M.day(v.date), origin = M.source(v.source, deps);
  if (date > origin.observedOn) M.fail("Artifact date cannot follow its observation");
  const format = M.choice(v.format, ["json", "markdown", "text"], "artifact format");
  if (typeof v.content !== "string" || !v.content.trim() || Buffer.byteLength(v.content, "utf8") > 250000) M.fail("Artifact content must be 1 to 250000 UTF-8 bytes");
  if (format === "json") { try { JSON.parse(v.content); } catch { M.fail("Artifact content must be valid JSON"); } }
  return { id: M.id(v.id), name: M.text(v.name, "artifact name", 200), type: M.choice(v.type, TYPES, "artifact type"), date, basedOnVersion: v.basedOnVersion,
    format, content: v.content, source: origin, status: M.choice(v.status, ["provisional", "reviewed", "historical"], "artifact status"),
    contentSha256: require("node:crypto").createHash("sha256").update(v.content, "utf8").digest("hex"), contentBytes: Buffer.byteLength(v.content, "utf8") };
}
function metadata(record) { const { content, ...rest } = record; return rest; }
// Archive content stays outside cash-engine state and routine record retrieval.
async function query(operation, args, deps, root) {
  M.access(deps);
  return deps.firestoreDb.runTransaction(async tx => {
    const header = await tx.get(root), version = header.exists ? header.data().version : 0;
    if (args.expectedVersion !== undefined && args.expectedVersion !== version) M.fail("Workspace changed; restart artifact listing", "personal_finance_version_conflict", 409);
    if (operation === "getPersonalArtifact") {
      const doc = await tx.get(root.collection("artifacts").doc(M.id(args.id)));
      if (!doc.exists) M.fail("Artifact not found", "personal_finance_not_found", 404);
      return { version, artifact: doc.data() };
    }
    const limit = args.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) M.fail("Artifact limit must be 1 to 20");
    let query = root.collection("artifacts").orderBy("__name__");
    if (args.afterId) query = query.startAfter(M.id(args.afterId));
    const docs = (await tx.get(query.limit(limit + 1))).docs;
    const items = docs.slice(0, limit).map(d => metadata(d.data()));
    return { version, items, complete: docs.length <= limit, nextAfterId: docs.length > limit ? items.at(-1).id : "" };
  });
}
module.exports = { normalize, metadata, query };
