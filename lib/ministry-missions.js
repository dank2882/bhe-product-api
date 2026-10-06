"use strict";
// FBC-owned support roster. Deliberately separate from ordinary ministry
// aggregates/history so ministry grants never expose the Dan-only source.
const M = require("./ministry-overview-model");
const { getTaskAccess } = require("./task-management-access");
const { normalizeOwnerSubjects } = require("./dan-private-access");
const MAX_BYTES = 650000;
function access(deps) {
  const a = getTaskAccess(deps);
  if (!a.subject || !normalizeOwnerSubjects(deps.danOwnerSubjects).includes(a.subject)) M.fail("Missions roster is available only to Dan", "missions_access_denied", 403);
  return a;
}
const ministryRef = (deps, id) => deps.firestoreDb.collection("fbcMinistryRecords").doc(M.id(id));
const root = (deps, id) => ministryRef(deps, id).collection("missions").doc("roster");
const empty = () => ({ version: 0, recipients: [], supports: [], imports: [] });
function parent(snap) {
  if (!snap.exists || M.organization(snap.data()) !== "fbc" || M.recordKind(snap.data()) !== "ministry") M.fail("An existing FBC ministry is required", "missions_ministry_required", 422);
}
async function read(input, deps) {
  access(deps);
  parent(await ministryRef(deps, input.ministryId).get());
  const snap = await root(deps, input.ministryId).get();
  return snap.exists ? snap.data() : empty();
}
function money(v) {
  if (v === null) return null;
  if (!Number.isSafeInteger(v) || v < 0 || v > 1e12) M.fail("Amount must be nonnegative integer USD cents or null");
  return v;
}
const strings = v => M.list(v || [], x => M.text(x, "clarification", 2000), 50);
const optional = (v, field, max = 1000) => M.text(v, field, max, true);
function recipient(v) {
  M.shape(v, ["name", "category", "location", "affiliation", "director", "distributor", "questions"]);
  return { name: M.text(v.name, "recipient name", 300), category: M.choice(v.category, ["agency_ministry", "missionary", "national_pastor", "other"], "category"),
    location: optional(v.location, "location"), affiliation: optional(v.affiliation, "affiliation"), director: optional(v.director, "director"),
    distributor: optional(v.distributor, "distributor"), questions: strings(v.questions) };
}
function support(v) {
  M.shape(v, ["amountCents", "kind", "status", "startDate", "endDate", "coveredBySupportId", "breakdown", "questions"]);
  const s = { amountCents: money(v.amountCents), currency: "USD", frequency: "monthly", kind: M.choice(v.kind || "individual", ["individual", "group"], "support kind"),
    status: M.choice(v.status || "active", ["active", "paused", "ended"], "support status"), startDate: M.date(v.startDate || "", true), endDate: M.date(v.endDate || "", true),
    coveredBySupportId: v.coveredBySupportId ? M.id(v.coveredBySupportId) : "", questions: strings(v.questions),
    breakdown: M.list(v.breakdown || [], b => { M.shape(b, ["label", "amountCents"]); return { label: M.text(b.label, "breakdown label", 300), amountCents: money(b.amountCents) }; }, 100) };
  if (s.startDate && s.endDate && s.endDate < s.startDate) M.fail("Support end precedes start");
  if (s.breakdown.length && s.amountCents !== null && s.breakdown.reduce((n,b) => n + (b.amountCents || 0), 0) > s.amountCents) M.fail("Breakdown exceeds support total");
  return s;
}
function validate(state) {
  if (state.recipients.length > 1000 || state.supports.length > 1000 || Buffer.byteLength(JSON.stringify(state)) > MAX_BYTES) M.fail("Missions roster exceeds complete storage budget", "missions_size_limit", 422);
  const ids = new Set(state.recipients.map(r => r.recipientId));
  for (const s of state.supports) {
    if (!ids.has(s.recipientId)) M.fail("Support recipient is missing");
    if (s.coveredBySupportId) {
      const group = state.supports.find(g => g.supportId === s.coveredBySupportId);
      if (!group || group.kind !== "group" || group.coveredBySupportId || group.supportId === s.supportId || s.kind !== "individual") M.fail("Allocation must reference one root group support");
    }
    if (s.kind === "group" && s.amountCents !== null) {
      const allocated = state.supports.filter(x => x.coveredBySupportId === s.supportId).reduce((n,x) => n + (x.amountCents || 0), 0);
      if (allocated > s.amountCents) M.fail("Allocations exceed group support total");
    }
  }
}
function source(v) {
  M.shape(v, ["reference", "exactText", "basisConfirmation"]);
  return { reference: M.text(v.reference, "source reference", 1000), exactText: M.text(v.exactText, "source text", 300000),
    basisConfirmation: M.text(v.basisConfirmation, "monthly USD confirmation", 2000) };
}
const identity = r => M.hash([r.name.trim().toLowerCase(), r.category, r.location.trim().toLowerCase()]);
function prepare(input, current) {
  const evidence = source(input.source);
  if (Buffer.byteLength(JSON.stringify(evidence)) > MAX_BYTES) M.fail("Source exceeds storage budget", "missions_size_limit", 422);
  const sourceId = `source-${M.hash(evidence.exactText).slice(0,32)}`;
  const state = structuredClone(current), rows = M.list(input.rows, row => {
    M.shape(row, ["key", "exactText", "recipient", "support", "coveredByRowKey"]);
    const key = M.id(row.key), recipientId = `recipient-${M.hash([sourceId,key]).slice(0,32)}`;
    return { key, exactText: M.text(row.exactText, "original row", 10000), recipient: recipient(row.recipient), support: support(row.support),
      coveredByRowKey: row.coveredByRowKey ? M.id(row.coveredByRowKey) : "", recipientId, supportId: `support-${recipientId.slice(10)}` };
  }, 1000);
  if (!rows.length || new Set(rows.map(r => r.key)).size !== rows.length) M.fail("Import requires distinct source rows");
  const added = [], unchanged = [];
  for (const row of rows) {
    if (row.support.coveredBySupportId) M.fail("Import allocations must use coveredByRowKey");
    if (row.coveredByRowKey) row.support.coveredBySupportId = `support-${M.hash([sourceId,row.coveredByRowKey]).slice(0,32)}`;
    const fingerprint = M.hash(row), old = state.recipients.find(r => r.recipientId === row.recipientId);
    if (old) {
      if (old.importFingerprint !== fingerprint) M.fail("Source row changed; use an evidenced update", "missions_import_conflict", 409);
      unchanged.push(row.recipientId); continue;
    }
    if (state.recipients.some(r => identity(r) === identity(row.recipient))) M.fail("Possible duplicate recipient; resolve the existing identity before importing", "missions_duplicate_recipient", 409);
    state.recipients.push({ ...row.recipient, recipientId: row.recipientId, sourceId, sourceRowKey: row.key, exactText: row.exactText, importFingerprint: fingerprint });
    state.supports.push({ ...row.support, supportId: row.supportId, recipientId: row.recipientId, sourceId });
    added.push(row.recipientId);
  }
  validate(state);
  return { state, evidence, sourceId, added, unchanged, previewHash: M.hash({ version: current.version, source: evidence, rows: input.rows }) };
}
function summary(state) {
  const active = state.supports.filter(s => s.status === "active" && !s.coveredBySupportId);
  const known = active.filter(s => s.amountCents !== null);
  return { label: "Listed monthly support; not verified payments", currency: "USD", frequency: "monthly", version: state.version,
    recipientCount: state.recipients.length, supportCount: state.supports.length, knownAmountCount: known.length,
    listedAmountCents: known.reduce((n,s) => n + s.amountCents, 0), unknownRootAmountCount: active.filter(s => s.amountCents === null).length,
    unknownAllocationCount: state.supports.filter(s => s.coveredBySupportId && s.amountCents === null).length,
    clarificationCount: state.recipients.filter(r => gaps(r,state).length).length,
    guidance: "Root group commitments count once. Included allocations and breakdowns do not add to the total. Unknown amounts are not zero; disputed listed amounts retain their clarification flags." };
}
function gaps(r, state) {
  const s = state.supports.find(s => s.recipientId === r.recipientId);
  return [...r.questions, ...s.questions, ...(!r.location ? ["Location not supplied"] : []), ...(s.amountCents === null ? ["Support amount not supplied"] : [])];
}
function view(r,state) { return { ...r, support: state.supports.find(s => s.recipientId === r.recipientId), clarifications: gaps(r,state) }; }
const queries = {
  async listMissionRecipients(input,deps) {
    const state = await read(input,deps);
    if (input.needsClarification !== undefined && typeof input.needsClarification !== "boolean") M.fail("Invalid clarification filter");
    if (input.category) M.choice(input.category,["agency_ministry","missionary","national_pastor","other"],"category");
    for (const k of ["query","location"]) if (input[k] !== undefined) M.text(input[k],k,300);
    const rows = state.recipients.map(r => view(r,state)).filter(r => (!input.category || r.category === input.category) &&
      (!input.location || r.location.toLowerCase().includes(input.location.toLowerCase())) &&
      (!input.query || [r.name,r.location,r.affiliation,r.director,r.distributor].join(" ").toLowerCase().includes(input.query.toLowerCase())) &&
      (input.needsClarification === undefined || Boolean(r.clarifications.length) === input.needsClarification)).sort((a,b) => a.name.localeCompare(b.name) || a.recipientId.localeCompare(b.recipientId));
    return { version: state.version, ...M.page(rows,input,{ ministryId: input.ministryId, version: state.version, query: input.query || "", location: input.location || "", category: input.category || "", needsClarification: input.needsClarification ?? null }) };
  },
  async getMissionRecipient(input,deps) {
    const state = await read(input,deps), r = state.recipients.find(r => r.recipientId === M.id(input.recipientId));
    if (!r) M.fail("Recipient not found","missions_not_found",404);
    const result = view(r,state);
    return { version: state.version, recipient: result, includedRecipients: state.supports.filter(s => s.coveredBySupportId === result.support.supportId).map(s => view(state.recipients.find(r => r.recipientId === s.recipientId),state)) };
  },
  async getMissionSupportSummary(input,deps) { return summary(await read(input,deps)); },
  async previewMissionImport(input,deps) {
    const current = await read(input,deps), p = prepare(input,current);
    return { version: current.version, previewHash: p.previewHash, sourceId: p.sourceId, addedCount: p.added.length, unchangedCount: p.unchanged.length, summary: summary(p.state) };
  },
  async getMissionSource(input,deps) {
    await read(input,deps);
    const snap = await root(deps,input.ministryId).collection("sources").doc(M.id(input.sourceId)).get();
    if (!snap.exists) M.fail("Source not found","missions_not_found",404);
    return { source: snap.data() };
  },
  async getMissionRosterHistory(input,deps) {
    await read(input,deps);
    const q = root(deps,input.ministryId).collection("history").orderBy("__name__");
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) M.fail("limit must be 1-100");
    const snap = await (input.cursor ? q.startAfter(M.id(input.cursor)) : q).limit(limit+1).get();
    return { items: snap.docs.slice(0,limit).map(d => d.data()), complete: snap.docs.length <= limit, nextCursor: snap.docs.length > limit ? snap.docs[limit-1].id : "" };
  }
};
async function command(operation,input,key,deps) {
  const actor = access(deps); M.text(key,"idempotency key",180); if(key.length < 8) M.fail("Idempotency key too short");
  const target = root(deps,input.ministryId), intent = M.hash({subject:actor.subject,key}), fingerprint = M.hash({operation,input});
  const receiptRef = target.collection("commands").doc(intent);
  await deps.firestoreDb.runTransaction(async tx => {
    const [p,saved,receipt] = await Promise.all([tx.get(ministryRef(deps,input.ministryId)),tx.get(target),tx.get(receiptRef)]);
    parent(p);
    if(receipt.exists) { if(receipt.data().fingerprint !== fingerprint) M.fail("Idempotency key reused","idempotency_key_reused",409); return; }
    let state = saved.exists ? saved.data() : empty(); M.expected(state,input.expectedVersion);
    const at = M.now(deps); let evidence = null, sourceId = "", added = [], unchanged = [];
    if(operation === "importMissionRoster") {
      const prepared = prepare(input,state);
      if(input.previewHash !== prepared.previewHash) M.fail("Import preview changed; preview again","missions_preview_changed",409);
      ({state,evidence,sourceId,added,unchanged} = prepared);
      const sourceRef = target.collection("sources").doc(sourceId), existing = await tx.get(sourceRef);
      if(existing.exists && M.hash(existing.data().evidence) !== M.hash(evidence)) M.fail("Existing source evidence is immutable","missions_source_conflict",409);
      if(!existing.exists) tx.create(sourceRef,{sourceId,evidence,recordedAt:at,recordedBy:actor.subject});
      if(!state.imports.includes(sourceId)) state.imports.push(sourceId);
    } else {
      M.text(input.evidence,"update evidence",10000);
      if(operation === "updateMissionRecipient") {
        const r = state.recipients.find(r => r.recipientId === M.id(input.recipientId));
        if(!r) M.fail("Recipient not found","missions_not_found",404);
        const fields = ["name","category","location","affiliation","director","distributor","questions"];
        M.shape(input.changes,fields);
        const updated = recipient({...Object.fromEntries(fields.map(k=>[k,r[k]])),...input.changes});
        if(state.recipients.some(x=>x.recipientId!==r.recipientId && identity(x)===identity(updated))) M.fail("Possible duplicate recipient","missions_duplicate_recipient",409);
        Object.assign(r,updated);
      } else if(operation === "updateMissionSupport") {
        const s = state.supports.find(s => s.supportId === M.id(input.supportId));
        if(!s) M.fail("Support not found","missions_not_found",404);
        const fields = ["amountCents","kind","status","startDate","endDate","coveredBySupportId","breakdown","questions"];
        M.shape(input.changes,fields);
        Object.assign(s,support({...Object.fromEntries(fields.map(k=>[k,s[k]])),...input.changes}));
      } else M.fail("Unknown missions command");
    }
    state.version++; state.updatedAt = at; validate(state);
    const record = {operation,version:state.version,at,actor:actor.subject,fingerprint,added,unchanged,sourceId,
      ...(evidence ? {} : {input})};
    tx.set(target,state); tx.create(receiptRef,record);
    tx.create(target.collection("history").doc(String(state.version).padStart(12,"0")),record);
  });
  // Independent readback; receipt distinguishes committed version from later state.
  const receipt = (await receiptRef.get()).data(), state = await read(input,deps);
  return {receipt,summary:summary(state)};
}
const definitions = [
  ["listMissionRecipients","query","Dan-only FBC Missions roster. Filter category, location, query or needsClarification; follow pagination. Historical start-date gaps are preserved.",["ministryId"],["query","category","location","needsClarification","limit","cursor"]],
  ["getMissionRecipient","query","Dan-only exact recipient, monthly support, immutable source row, clarifications and included group recipients.",["ministryId","recipientId"],[]],
  ["getMissionSupportSummary","query","Dan-only listed monthly USD support, unknown counts and caveats. Group support counted once; this is not payment verification.",["ministryId"],[]],
  ["getMissionSource","query","Dan-only original imported evidence and explicit monthly USD confirmation.",["ministryId","sourceId"],[]],
  ["getMissionRosterHistory","query","Dan-only append-only roster change history; cursor is last history ID.",["ministryId"],["limit","cursor"]],
  ["previewMissionImport","query","Read-only preview. source {reference,exactText,basisConfirmation}. rows [{key,exactText,recipient:{name,category:agency_ministry|missionary|national_pastor|other,location?,affiliation?,director?,distributor?,questions?:string[]},support:{amountCents:integer|null,kind?:individual|group,status?:active|paused|ended,startDate?:YYYY-MM-DD,endDate?:YYYY-MM-DD,breakdown?:[{label,amountCents}],questions?:string[]},coveredByRowKey?}]. Monthly USD only. Missing locations use empty string; amounts use null. Stable row keys within immutable source; imports never overwrite. Group allocations reference root row keys. Up to 1000 rows, bounded aggregate.",["ministryId","source","rows"],[]],
  ["importMissionRoster","command","Dan-only atomic import using exact preview source/rows and previewHash, current roster expectedVersion (0 if empty), stable idempotency key. Preserve unknowns. No tasks, payments or forecast writes.",["ministryId","expectedVersion","previewHash","source","rows"],[]],
  ["updateMissionRecipient","command","Dan-only evidenced update. changes: name/category/location/affiliation/director/distributor/questions. Original source row immutable; expectedVersion is roster version.",["ministryId","expectedVersion","recipientId","changes","evidence"],[]],
  ["updateMissionSupport","command","Dan-only evidenced support update. changes: amountCents (integer|null), kind individual|group, status active|paused|ended, startDate/endDate (YYYY-MM-DD or empty), coveredBySupportId (root group or empty), breakdown [{label,amountCents}], questions string[]. Monthly USD; expectedVersion is roster version. Allocations never add to group total.",["ministryId","expectedVersion","supportId","changes","evidence"],[]]
];
module.exports = {definitions,queries,command};
