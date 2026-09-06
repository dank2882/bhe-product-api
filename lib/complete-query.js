"use strict";

// Small collections can be searched in memory, but never silently search only
// their first page. Stop explicitly if the service's read budget is exceeded.
async function readCompleteQuery(query, { pageSize = 500, maxDocuments = 10000 } = {}) {
  if (typeof query.orderBy !== "function") {
    const snapshot = await query.limit(maxDocuments + 1).get();
    if (snapshot.docs.length > maxDocuments) throw readLimitError(maxDocuments);
    return snapshot.docs;
  }
  const ordered = query.orderBy("__name__");
  const documents = [];
  let after;
  for (;;) {
    const page = after ? ordered.startAfter(after) : ordered;
    const limit = Math.min(pageSize, maxDocuments + 1 - documents.length);
    const snapshot = await page.limit(limit).get();
    documents.push(...snapshot.docs);
    if (documents.length > maxDocuments) throw readLimitError(maxDocuments);
    if (snapshot.docs.length < limit) return documents;
    after = snapshot.docs.at(-1);
  }
}

function readLimitError(maxDocuments) {
  return Object.assign(new Error("This query exceeds the complete-read limit; narrow the query. No complete result was returned."), {
    statusCode: 422, code: "query_requires_narrower_scope", details: { maxDocuments }
  });
}

module.exports = { readCompleteQuery };
