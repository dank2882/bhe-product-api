"use strict";
const M = require("./ministry-overview-model");
const tasks = require("./project-task-service");
const { getStaffAuthorizationProfileId } = require("./staff-authorization-service");
const col = (deps, suffix) => deps.firestoreDb.collection(`fbcMinistry${suffix}`);
const ref = (deps, ministryId) => col(deps, "Records").doc(M.id(ministryId));
function record(snap, deps, write = false, owner = false) {
  if (!snap.exists) M.fail("Ministry not found", "ministry_overview_not_found", 404);
  const r = snap.data(); M.authorize(r, deps, write, owner); return r;
}
function matter(r, matterId) {
  const m = r.matters.find(x => x.matterId === M.id(matterId));
  if (!m) M.fail("Matter not found", "ministry_overview_matter_not_found", 404); return m;
}
async function inventory(deps, tx) {
  M.actor(deps); const query = col(deps, "Records").limit(1001), snapshot = await (tx ? tx.get(query) : query.get());
  if (snapshot.docs.length > 1000) M.fail("Ministry inventory exceeds complete-read budget", "ministry_overview_read_limit", 422);
  return snapshot.docs.map(d => d.data());
}
function visible(r, deps) {
  const copy = structuredClone(r);
  if (!M.actor(deps).owner) { delete copy.grants; delete copy.calendarActions; }
  return copy;
}
async function getMinistry(input, deps) { return { ministry: visible(record(await ref(deps, input.ministryId).get(), deps), deps) }; }
async function listMinistries(input, deps) {
  const a = M.actor(deps), rows = (await inventory(deps)).filter(r => M.canRead(r, deps))
    .filter(r => input.includeArchived || r.status !== "archived")
    .filter(r => !input.query || `${r.name} ${r.purpose}`.toLowerCase().includes(input.query.toLowerCase()))
    .sort((a,b) => a.name.localeCompare(b.name) || a.ministryId.localeCompare(b.ministryId));
  return M.page(rows.map(r => ({ ministryId: r.ministryId, name: r.name, purpose: r.purpose, leader: r.leader,
    parentMinistryId: r.parentMinistryId, version: r.version, status: r.status, nextReviewDate: r.nextReviewDate,
    openMatterCount: r.matters.filter(m => m.status !== "resolved").length })), input,
  { subject: a.subject, query: input.query || "", rows: rows.map(r => [r.ministryId, r.version]) });
}
async function getMinistryHistory(input, deps) {
  record(await ref(deps, input.ministryId).get(), deps);
  const snap = await ref(deps, input.ministryId).collection("history").orderBy("__name__").limit(5001).get();
  if (snap.docs.length > 5000) M.fail("History exceeds complete-read budget", "ministry_overview_read_limit", 422);
  const rows = snap.docs.map(d => d.data()).map(e => {
    if (!M.actor(deps).owner && (["setMinistryAccess", "createMinistry", "updateMinistry", "linkMinistryAppointment"].includes(e.operation) || e.operation.includes("ChurchCalendar"))) {
      const { input, ...safe } = e; return safe;
    }
    return e;
  });
  return M.page(rows, input, { ministryId: input.ministryId, subject: M.actor(deps).subject, versions: rows.map(r => r.version) });
}

async function readTask(m, deps) {
  if (!m.taskLink?.taskId) return { state: "not_linked" };
  try {
    const result = await tasks.getTask({ taskId: m.taskLink.taskId }, deps), t = result.task;
    return { state: "checked", taskId: t.taskId, version: t.version, status: t.status, dueDate: t.dueDate,
      followUpDate: t.followUpDate, workOnDate: t.workOnDate, assignmentStatus: t.assignmentStatus };
  } catch (error) { return { state: error.statusCode === 403 ? "restricted" : "unavailable" }; }
}
function returnState(m, r, asOfDate, events) {
  const c = m.returnCondition, due = date => Boolean(date && date <= asOfDate);
  if (c.kind === "date") return { due: due(c.date), date: c.date, reason: "agreed_return_date" };
  if (c.kind === "event") {
    const e = events?.find(e => e.instanceId === c.eventInstanceId);
    if (!e) return { due: due(r.nextReviewDate), date: r.nextReviewDate, reason: "event_source_unavailable", unknown: true };
    const start = e.startDate || e.start?.slice(0,10), day = new Date(`${start}T12:00:00Z`);
    if (!Number.isFinite(day.getTime())) return { due: false, reason: "event_date_unknown", unknown: true };
    day.setUTCDate(day.getUTCDate() - c.daysBefore); const date = day.toISOString().slice(0,10);
    return { due: due(date), date, reason: "event_approaching" };
  }
  return { due: due(r.nextReviewDate), date: r.nextReviewDate,
    reason: c.kind === "change" ? "condition_check_at_review" : c.kind === "missing" ? "return_condition_not_set" : "next_ministry_review",
    ...(c.condition ? { condition: c.condition } : {}) };
}
async function calendarContext(rows, asOfDate, period, deps) {
  const days={daily:14,weekly:90,monthly:365}[period||"daily"];
  const dateTo=new Date(Date.parse(`${asOfDate}T12:00:00Z`)+(days-1)*86400000).toISOString().slice(0,10);
  const C=require("./ministry-church-calendar");
  let result;
  try { result=await C.readChurchEventWindow({dateFrom:asOfDate,dateTo},deps); }
  catch(error) { return {events:[],coverage:"unavailable",dateFrom:asOfDate,dateTo,code:error.code||"ministry_breeze_unavailable",unavailableInstanceIds:[]}; }
  const ids=[...new Set(rows.flatMap(r=>[...r.matters.filter(m=>m.status!=="resolved"&&m.returnCondition.kind==="event").map(m=>m.returnCondition.eventInstanceId),
    ...r.calendarActions.filter(a=>a.status!=="dismissed"&&a.proposal.operation!=="cancel").flatMap(a=>a.proposal.recurrenceScope==="series"?(a.result?.events?.map(e=>e.instanceId)||a.proposal.affectedInstanceIds):[a.result?.instanceId||a.proposal.instanceId]).filter(Boolean)]))];
  const events=result.items, unavailableInstanceIds=[];
  // Bound extra exact reads. An out-of-window event never silently disappears.
  let remaining=8;
  for(const id of ids) if(!events.some(e=>e.instanceId===id)) {
    if(remaining--<=0){unavailableInstanceIds.push(id);continue;}
    try {events.push((await C.getChurchEvent({instanceId:id},deps)).event);}catch{unavailableInstanceIds.push(id);}
  }
  return {...result,events,coverage:unavailableInstanceIds.length?"partial":result.coverage,unavailableInstanceIds};
}
async function linkedSources(r, deps, context) {
  const projects=[];
  for(const projectId of r.projectIds) try {
    const {project}=await tasks.getProject({projectId},deps);projects.push({projectId,state:"checked",title:project.name||project.title,status:project.status,version:project.version});
  } catch {projects.push({state:"unavailable"});}
  const calendar=[];
  if(M.actor(deps).owner) for(const a of r.calendarActions.filter(a=>a.status!=="dismissed")) {
    const item={actionId:a.actionId,title:a.proposal.title||"Church calendar cancellation",status:a.status,operation:a.proposal.operation,
      instanceId:a.result?.instanceId||a.proposal.instanceId,participatingMinistryIds:a.proposal.participatingMinistryIds,gaps:[]};
    if(a.status!=="verified")item.gaps.push("calendar_action_pending");
    else if(a.proposal.operation!=="cancel") {
      const expected=a.proposal.recurrenceScope==="series"?a.proposal.occurrences.map(p=>({...p,instanceId:p.instanceId||a.result?.events?.find(e=>require("./ministry-calendar-workflow").matches(p,e))?.instanceId})):[{...a.proposal,instanceId:item.instanceId}];
      for(const p of expected){const e=context?.events.find(e=>e.instanceId===p.instanceId);
        if(!e)item.gaps.push("linked_event_not_checked");
        else if(!require("./ministry-calendar-workflow").matches({...p,operation:"update"},e))item.gaps.push("church_event_changed_or_readback_incomplete");
      }
    }
    if(a.appointmentReference) try {
      const {appointment}=await require("./appointments-service").getAppointment({appointmentId:a.appointmentReference.appointmentId},deps);
      item.appointment={appointmentId:appointment.appointmentId,state:"checked",status:appointment.status,attentionReasons:appointment.attentionReasons,
        familyApprovalRequired:appointment.family?.required===true&&appointment.family?.approved!==true};
      if(appointment.attentionReasons?.length)item.gaps.push("personal_arrangements_need_attention");
    } catch {item.appointment={state:"unavailable"};item.gaps.push("personal_arrangements_not_checked");}
    item.gaps=[...new Set(item.gaps)];calendar.push(item);
  }
  return {projects,calendar};
}
async function picture(r, input, deps, context) {
  const events=context?.events;
  const asOfDate = M.date(input.asOfDate || M.today(deps));
  const open = [], settled = [], changes = [];
  for (const m of r.matters) {
    if (m.updatedAt > (input.since || r.lastReviewedAt || "")) changes.push({ matterId: m.matterId, title: m.title, status: m.status, updatedAt: m.updatedAt });
    if (m.status === "resolved") { settled.push({ matterId: m.matterId, title: m.title, resolution: m.resolution, decision: m.decision }); continue; }
    const source = m.source, confirmed = source.confirmedAt || source.reportedAt;
    const stale = Date.parse(`${asOfDate}T23:59:59Z`) - Date.parse(confirmed) > 31 * 86400000;
    const returns = returnState(m, r, asOfDate, events), task = await readTask(m, deps);
    const gaps = [];
    if (!m.nextMove && !["idea", "encouragement"].includes(m.kind)) gaps.push("next_move_not_agreed");
    if (m.returnCondition.kind === "missing") gaps.push("return_condition_not_set");
    if (stale) gaps.push("information_old");
    if (["unknown", "disputed"].includes(source.certainty)) gaps.push(`information_${source.certainty}`);
    if (returns.unknown) gaps.push(returns.reason);
    if (["unavailable", "restricted"].includes(task.state)) gaps.push("linked_task_not_checked");
    if (task.status === "done" && m.kind === "decision" && !["approved", "declined"].includes(m.decision?.outcome)) gaps.push("decision_not_recorded");
    const followThroughTasks=await Promise.all((m.followThroughTasks||[]).map(link=>readTask({taskLink:link},deps)));
    if (followThroughTasks.some(t=>t.status==="done")) gaps.push("task_done_matter_unresolved");
    if (followThroughTasks.some(t=>["unavailable","restricted"].includes(t.state))) gaps.push("linked_task_not_checked");
    if (["pending", "dispatching"].includes(m.taskLink?.status)) gaps.push("task_update_pending");
    const activeDecision = m.kind === "decision" && (!m.decision || ["pending", "reopened"].includes(m.decision.outcome) ||
      (m.decision.outcome === "deferred" && returns.due));
    const danNext = m.nextMove?.kind === "dan";
    const needsDan = r.personalScope !== "handed_off" && (activeDecision || (danNext && (returns.due || m.status === "open")) ||
      (m.attention === "dan" && (returns.due || gaps.includes("decision_not_recorded"))));
    open.push({ matterId: m.matterId, title: m.title, kind: m.kind, status: m.status, currentSituation: m.currentSituation,
      nextMove: m.nextMove, returns, needsDan, reason: needsDan ? activeDecision ? "decision_requested" : "agreed_next_move_or_review" : "",
      source, informationOld: stale, gaps, task, followThroughTasks, decision: m.decision, needs: m.needs });
  }
  const reviewDue = r.nextReviewDate <= asOfDate;
  const links=await linkedSources(r,deps,context);
  const limitations = [...new Set([...open.flatMap(m => m.gaps), ...links.calendar.flatMap(c=>c.gaps), ...(links.projects.some(p=>p.state!=="checked")?["linked_project_not_checked"]:[])])];
  if (!r.lastReviewedAt) limitations.push("ministry_not_yet_reviewed");
  return { ministryId: r.ministryId, name: r.name, version: r.version, asOfDate, purpose: r.purpose, goals: r.goals,
    linkedProjects:links.projects,calendarActions:links.calendar,upcomingEvents:(events||[]).filter(e=>r.calendarAreaIds.includes(e.calendarAreaId)),
    leader: r.leader, oversight: r.oversight, currentAssessment: r.currentAssessment, lastReviewedAt: r.lastReviewedAt,
    nextReviewDate: r.nextReviewDate, reviewDue, personalScope: r.personalScope, openMatters: open, settledMatters: settled, changes,
    needsDan: open.filter(m => m.needsDan), leaderCarrying: open.filter(m => !m.needsDan && m.nextMove?.kind === "person"),
    informationGaps: limitations, assessment: open.some(m => m.needsDan) ? "needs_your_attention" : limitations.length || reviewDue ? "review_or_information_needed" : "no_recorded_action_for_you",
    coverage: { ministry: "checked", linkedTasks: open.some(m => ["unavailable", "restricted"].includes(m.task.state)) ? "partial" : "checked",
      events: context?.coverage || "not_checked", areaCoverage:context?.areaCoverage||[], sourceMayLagMinutes:15, caveat: "Based on recorded reports and checked sources; unreported changes are unknown." } };
}
async function getMinistryPicture(input, deps) {
  const r = record(await ref(deps, input.ministryId).get(), deps);
  const context=await calendarContext([r],M.date(input.asOfDate||M.today(deps)),"daily",deps);
  return { picture: await picture(r, input, deps,context) };
}
async function buildMinistryReview(input, deps) {
  const a = M.actor(deps), asOfDate = M.date(input.asOfDate || M.today(deps));
  const period = M.choice(input.period || "daily", ["daily", "weekly", "monthly"], "review period");
  const rows = (await inventory(deps)).filter(r => M.canRead(r, deps) && r.status === "active")
    .filter(r => !a.owner || r.personalScope !== "handed_off");
  const context=await calendarContext(rows,asOfDate,period,deps);
  const pictures = await Promise.all(rows.map(r => picture(r, { ...input, asOfDate }, deps,context)));
  const attention = pictures.flatMap(p => [
    ...p.openMatters.filter(m => m.needsDan || m.returns.due || (!a.owner && m.gaps.length)).map(m => ({ ministryId: p.ministryId,
      ministryName: p.name, matterId: m.matterId, title: m.title, reason: m.reason || m.returns.reason,
      returnDate: m.returns.date || "", needsDan: m.needsDan, nextMove: m.nextMove, gaps: m.gaps, source: m.source,
      ...(m.task.state === "checked" ? { taskId: m.task.taskId } : {}) })),
    ...p.calendarActions.filter(c=>c.gaps.length).map(c=>({ministryId:p.ministryId,ministryName:p.name,title:c.title,
      actionId:c.actionId,eventInstanceId:c.instanceId,reason:c.gaps[0],gaps:c.gaps,needsDan:true})),
    ...(p.reviewDue || !p.lastReviewedAt ? [{ ministryId: p.ministryId, ministryName: p.name, title: `Review ${p.name}`,
      reason: p.reviewDue ? "ministry_review_due" : "ministry_not_yet_reviewed", returnDate: p.nextReviewDate }] : [])
  ]).sort((a,b) => Number(Boolean(b.needsDan))-Number(Boolean(a.needsDan)) || (a.returnDate || "9999").localeCompare(b.returnDate || "9999") || a.title.localeCompare(b.title));
  const result = M.page(attention, { ...input, limit: input.limit ?? 5 }, { subject: a.subject, asOfDate, period, rows: rows.map(r => [r.ministryId, r.version]) });
  return { ...result, asOfDate, period, ministryCount: rows.length,
    summaries: pictures.map(p => ({ ministryId: p.ministryId, name: p.name, assessment: p.assessment,
      openMatterCount: p.openMatters.length, needsDanCount: p.needsDan.length, leaderCarryingCount: p.leaderCarrying.length,
      informationGaps: p.informationGaps, lastReviewedAt: p.lastReviewedAt, nextReviewDate: p.nextReviewDate })),
    coverage: { ministry: "checked", scope: a.owner ? "dan_personal_excludes_handed_off" : "explicit_ministry_grants", events: context.coverage,areaCoverage:context.areaCoverage||[],sourceMayLagMinutes:15 },
    upcomingEvents:context.events.filter(e=>e.startDate>=asOfDate&&e.startDate<=context.dateTo),
    changes:pictures.flatMap(p=>p.changes.map(c=>({...c,ministryId:p.ministryId}))),
    encouragements:pictures.flatMap(p=>p.openMatters.filter(m=>m.kind==="encouragement").map(m=>({ministryId:p.ministryId,title:m.title,currentSituation:m.currentSituation,source:m.source}))),
    retrievalRequests: [...(context.coverage!=="checked"?[{ source: "Breeze", operation: "listChurchEvents", windowDays: { daily: 14, weekly: 90, monthly: 365 }[period],reason:"incomplete_source_coverage" }]:[]),
      ...(a.owner ? [{ source: "Outlook", guidance: "Read Dan personal commitments; use existing appointment preparation, travel, family and approval safeguards. FYI events are not commitments." }] : [])],
    guidance: "Show changes, next moves, due returns and gaps; group identical task/event links. No messages, assignments or review completion occurred." };
}
function move(v) {
  if (v === null) return null;
  M.shape(v, ["kind", "person", "action"]);
  const out = { kind: M.choice(v.kind, ["dan", "person"], "next move kind"), action: M.text(v.action, "next move") };
  if (v.kind === "person") out.person = M.person(v.person);
  return out;
}

// Every intent commits the changed aggregate, immutable change evidence, and
// receipt together. No destination write occurs inside a Firestore transaction.
async function runMinistryCommand(operation, input, key, deps) {
  const a = M.actor(deps); M.text(key, "idempotencyKey", 180); if (key.length < 8) M.fail("Idempotency key too short");
  const intent = M.hash({ subject: a.subject, key }), fingerprint = M.hash({ operation, input });
  const creating = operation === "createMinistry", ministryId = creating ? input.ministryId || `ministry-${intent.slice(0,24)}` : input.ministryId;
  const target = ref(deps, ministryId), receiptRef = col(deps, "Receipts").doc(intent);
  // Permission-check the authoritative task before linking; its content stays there.
  let linkedTask;
  if(operation==="linkMinistryTask") {
    record(await target.get(),deps,true);
    if(input.userAuthorized!==true)M.fail("An agreed action is required before linking a task");
    linkedTask=(await tasks.getTask({taskId:M.id(input.taskId)},deps)).task;
  }
  await deps.firestoreDb.runTransaction(async tx => {
    const [saved, receipt] = await Promise.all([tx.get(target), tx.get(receiptRef)]);
    if (receipt.exists) {
      record(saved, deps, true);
      if (receipt.data().fingerprint !== fingerprint) M.fail("Idempotency key reused", "idempotency_key_reused", 409); return;
    }
    const at = M.now(deps); let r;
    if (creating) {
      M.requireOwner(deps); if (saved.exists) M.fail("Ministry already exists", "ministry_overview_exists", 409);
      r = { ministryId, owner: "fbc", serves: ["fbc"], name: M.text(input.name, "name", 200), purpose: "", goals: [], leader: null,
        oversight: null, parentMinistryId: "", workers: [], decisionResponsibilities: "", grants: [], calendarAreaIds: [], projectIds: [],
        personalScope: "included", status: "active", nextReviewDate: M.nextMonth(M.today(deps)), lastReviewedAt: "", currentAssessment: "",
        matters: [], calendarActions: [], version: 0, createdAt: at, createdBy: a.subject };
      Object.assign(r, M.profile(input.profile || {}, true));
    } else {
      r = record(saved, deps, true); M.expected(r, input.expectedVersion);
      if (input.matterId && matter(r,input.matterId).taskLink?.status === "dispatching") M.fail("Reconcile the attempted task before changing its matter", "ministry_task_reconcile_required",409);
    }
    if (operation === "updateMinistry") Object.assign(r, M.profile(input.changes, a.owner));
    if (["createMinistry", "updateMinistry"].includes(operation)) {
      const records = await inventory(deps, tx); const graph = new Map(records.map(x => [x.ministryId, x])); graph.set(ministryId, r);
      const seen = new Set([ministryId]); let parent = r.parentMinistryId;
      while (parent) { const p = graph.get(parent); if (!p || p.status !== "active" || seen.has(parent)) M.fail("Invalid ministry hierarchy"); M.authorize(p, deps); seen.add(parent); parent = p.parentMinistryId; }
    } else if (operation === "setMinistryAccess") {
      M.requireOwner(deps);
      const grants = M.list(input.grants, g => { M.shape(g, ["subject", "role"]); return { subject: M.text(g.subject, "subject", 300), role: M.choice(g.role, ["viewer", "editor"], "grant role") }; });
      if (new Set(grants.map(g => g.subject)).size !== grants.length) M.fail("Duplicate grant");
      for (const g of grants) {
        const p = await tx.get(deps.staffAuthorizationProfilesCollection.doc(getStaffAuthorizationProfileId(g.subject)));
        if (!p.exists || p.data().status !== "active") M.fail("Select an active verified staff identity before granting access", "ministry_overview_identity_unverified", 422);
      }
      r.grants = grants;
    } else if (operation === "captureMinistryMatter") {
      if (input.sensitivity !== "general") M.fail("Sensitive sources belong in their owning system");
      const matterId = input.matterId || `matter-${intent.slice(0,24)}`; M.id(matterId);
      if (r.matters.some(m => m.matterId === matterId)) M.fail("Matter already exists; update it", "ministry_overview_matter_exists", 409);
      const kind = M.choice(input.kind || "concern", ["concern", "idea", "need", "question", "decision", "encouragement"], "matter kind");
      if (kind === "decision") M.fail("Use requestMinistryDecision for an agreed decision request");
      r.matters.push({ matterId, kind, title: M.text(input.title, "title", 300), exactText: M.text(input.exactText, "exactText", 20000),
        currentSituation: M.text(input.currentSituation, "currentSituation", 10000, true), status: "open", nextMove: input.nextMove ? move(input.nextMove) : null,
        returnCondition: M.returnCondition(input.returnCondition || { kind: "next_review" }), attention: M.choice(input.attention || "leader", ["leader", "dan"], "attention"),
        source: M.source(input.source || {}, at, a.subject), needs: input.needs ? M.need(input.needs) : null,
        decision: null, taskLink: null, resolution: null, createdAt: at, updatedAt: at });
    } else if (operation === "updateMinistryMatter") {
      const m = matter(r, input.matterId), c = input.changes;
      M.shape(c, ["title", "currentSituation", "nextMove", "returnCondition", "attention", "source", "needs"]);
      if (m.status === "resolved") M.fail("Reopen the matter explicitly before updating it");
      if (c.title !== undefined) m.title = M.text(c.title, "title", 300);
      if (c.currentSituation !== undefined) m.currentSituation = M.text(c.currentSituation, "currentSituation", 10000, true);
      if (c.nextMove !== undefined) m.nextMove = move(c.nextMove);
      if (c.returnCondition !== undefined) m.returnCondition = M.returnCondition(c.returnCondition);
      if (c.attention !== undefined) m.attention = M.choice(c.attention, ["leader", "dan"], "attention");
      if (c.source !== undefined) m.source = M.source(c.source, at, a.subject);
      if (c.needs !== undefined) m.needs = c.needs === null ? null : M.need(c.needs);
      m.updatedAt = at;
    } else if (operation === "linkMinistryTask") {
      const m=matter(r,input.matterId);if(m.status==="resolved")M.fail("Reopen the matter before linking an action");
      if(!linkedTask)M.fail("Task reference not verified");
      m.followThroughTasks=m.followThroughTasks||[];
      if(m.taskLink?.taskId===linkedTask.taskId)M.fail("Decision task is already linked");
      if(!m.followThroughTasks.some(t=>t.taskId===linkedTask.taskId))m.followThroughTasks.push({taskId:linkedTask.taskId,linkedAt:at,linkedBy:a.subject});
      if(m.followThroughTasks.length>100)M.fail("Too many linked actions");m.updatedAt=at;
    } else if (operation === "requestMinistryDecision") {
      if (input.userAuthorized !== true) M.fail("An agreed decision request is required");
      const m = matter(r, input.matterId); if (m.status === "resolved") M.fail("Reopen the matter first");
      m.kind = "decision"; m.status = "open"; m.attention = "dan"; m.nextMove = { kind: "dan", action: M.text(input.question, "question", 2000) };
      m.decision = { outcome: "pending", question: input.question, dueDate: M.date(input.dueDate, true), rationale: "", at };
      m.taskLink = { taskId: m.taskLink?.taskId || `task-ministry-${M.hash({ ministryId, matterId: m.matterId }).slice(0,28)}`, status: "pending", desired: "next" };
      m.updatedAt = at;
    } else if (operation === "recordMinistryDecision") {
      M.requireOwner(deps); const m = matter(r, input.matterId);
      if (m.kind !== "decision") M.fail("This matter is not a decision request");
      const outcome = M.choice(input.outcome, ["approved", "declined", "deferred", "information_requested"], "decision outcome");
      if (input.userConfirmed !== true) M.fail("Record Dan's actual decision, not an inferred answer");
      m.decision = { ...m.decision, outcome, exactAnswer: M.text(input.exactAnswer, "exactAnswer", 10000), rationale: M.text(input.rationale, "rationale", 10000, true), at, actorSub: a.subject };
      if (["deferred", "information_requested"].includes(outcome)) {
        m.status = "waiting"; m.returnCondition = input.returnCondition ? M.returnCondition(input.returnCondition) : { kind: "next_review" };
        if (outcome === "deferred" && m.returnCondition.kind !== "date") M.fail("Deferral requires the agreed return date");
        m.nextMove = outcome === "deferred" ? { kind: "dan", action: "Reconsider the deferred decision" } : input.nextMove ? move(input.nextMove) : null;
      } else { m.status = "open"; m.nextMove = input.nextMove ? move(input.nextMove) : null; }
      m.taskLink = { ...m.taskLink, status: "pending", desired: ["approved", "declined"].includes(outcome) ? "done" : outcome === "deferred" ? "scheduled" : "waiting" };
      m.updatedAt = at;
    } else if (operation === "resolveMinistryMatter" || operation === "reopenMinistryMatter") {
      const m = matter(r, input.matterId); if (m.kind === "decision") M.requireOwner(deps);
      if (input.userConfirmed !== true) M.fail("Explicit resolution or reopening is required");
      if (operation === "resolveMinistryMatter" && m.kind === "decision" && !["approved", "declined"].includes(m.decision?.outcome)) M.fail("An unresolved decision cannot be closed");
      m.status = operation === "resolveMinistryMatter" ? "resolved" : "open";
      m.resolution = operation === "resolveMinistryMatter" ? { exactText: M.text(input.reason, "reason", 10000), at, actorSub: a.subject } : null;
      if (operation === "reopenMinistryMatter") { M.text(input.reason, "reason", 10000); m.returnCondition = { kind: "next_review" }; }
      m.updatedAt = at;
    } else if (operation === "recordMinistryReview") {
      if (input.userConfirmed !== true) M.fail("Displaying a review does not complete it");
      const day = M.date(input.asOfDate); if (day > M.today(deps)) M.fail("Cannot complete a future review");
      r.currentAssessment = M.text(input.assessment, "assessment", 10000); r.lastReviewedAt = at; r.lastReviewedDate = day;
      r.nextReviewDate = input.nextReviewDate ? M.date(input.nextReviewDate) : M.nextMonth(day);
      if (r.nextReviewDate <= M.today(deps)) M.fail("Next review must be in the future");
      // Review completion does not confirm every source or resolve any matter.
    } else if (!["createMinistry", "updateMinistry"].includes(operation)) M.fail("Unknown ministry command");
    r.version++; r.updatedAt = at; r.updatedBy = a.subject;
    if (Buffer.byteLength(JSON.stringify(r)) > 500000) M.fail("Ministry record exceeds safe size; archive resolved history before adding more", "ministry_overview_size_limit", 422);
    const event = { version: r.version, operation, actorSub: a.subject, at, input, fingerprint };
    tx.set(target, r); tx.create(target.collection("history").doc(String(r.version).padStart(10,"0")), event);
    tx.create(receiptRef, { fingerprint, ministryId, version: r.version, at });
  });
  return { ...(await getMinistry({ ministryId }, deps)), readBackVerified: true };
}

module.exports = { col, ref, record, matter, inventory, visible, picture, move, getMinistry, listMinistries, getMinistryHistory,
  getMinistryPicture, buildMinistryReview, runMinistryCommand };
