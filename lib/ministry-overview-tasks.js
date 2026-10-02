"use strict";
const M = require("./ministry-overview-model");
const S = require("./ministry-overview-service");
const tasks = require("./project-task-service");
const { normalizeOwnerSubjects } = require("./dan-private-access");

function desiredTask(m, ministry) {
  const desired = m.taskLink.desired;
  const result = { title: `Decision: ${m.decision.question}`, status: desired, dueDate: m.decision.dueDate || "",
    notes: `Ministry: ${ministry.name}\nSource: ministry:${ministry.ministryId}:${m.matterId}\n${m.decision.question}`,
    workOnDate: "", waitingOn: "", followUpDate: "", followUpExceptionReason: "" };
  if (desired === "scheduled") result.workOnDate = m.returnCondition.date;
  if (desired === "waiting") {
    result.waitingOn = m.nextMove?.person?.name || "Information needed; responsible person not agreed";
    if (m.returnCondition.kind === "date") result.followUpDate = m.returnCondition.date;
    else result.followUpExceptionReason = "Return at the next ministry review; no exact follow-up date agreed";
  }
  return result;
}
async function syncMinistryDecisionTask(input, key, deps) {
  M.text(key, "idempotencyKey", 180); if (key.length < 8) M.fail("Idempotency key too short");
  const target = S.ref(deps, input.ministryId), a = M.actor(deps);
  let r = S.record(await target.get(), deps, true), m = S.matter(r, input.matterId);
  if (!m.taskLink || m.kind !== "decision") M.fail("No decision task to synchronize");
  if (!a.owner && m.taskLink.desired !== "next") M.fail("Only Dan may synchronize decision outcomes", "ministry_overview_owner_required", 403);
  const syncReceipt=S.col(deps,"Receipts").doc(M.hash({subject:a.subject,key})),fingerprint=M.hash({operation:"syncMinistryDecisionTask",input});
  const oldReceipt=await syncReceipt.get();
  if(oldReceipt.exists){if(oldReceipt.data().fingerprint!==fingerprint)M.fail("Idempotency key reused","idempotency_key_reused",409);
    return {...await S.getMinistry({ministryId:r.ministryId},deps),taskId:m.taskLink.taskId,replayed:true,reconciliationRequired:m.taskLink.status!=="verified",readBackVerified:true};}
  M.expected(r,input.expectedVersion);
  if (m.taskLink.status === "verified") return reconcileMinistryDecisionTask(input,key,deps);
  const expected = desiredTask(m, r), expectedHash = M.hash(expected);
  await deps.firestoreDb.runTransaction(async tx => {
    const [saved,receipt]=await Promise.all([tx.get(target),tx.get(syncReceipt)]);
    const current = S.record(saved, deps, true), item = S.matter(current, input.matterId);
    if(receipt.exists)M.fail("Task synchronization already claimed; read current state","ministry_task_reconcile_required",409);
    M.expected(current, input.expectedVersion);
    if (M.hash(desiredTask(item,current)) !== expectedHash) M.fail("Decision changed", "ministry_overview_version_conflict",409);
    if (item.taskLink.status === "dispatching") {
      // A second caller may inspect the existing target but never race a write.
      M.fail("Task synchronization is already in progress; reconcile its target", "ministry_task_reconcile_required",409);
    }
    item.taskLink = { ...item.taskLink, status: "dispatching", expectedHash, attemptedAt: M.now(deps), actorSub: a.subject };
    current.version++; current.updatedAt = M.now(deps); tx.set(target,current);
    tx.create(syncReceipt,{fingerprint,ministryId:r.ministryId,version:current.version,at:M.now(deps)});
    tx.create(target.collection("history").doc(String(current.version).padStart(10,"0")), { version: current.version, operation: "beginDecisionTask", at: M.now(deps), actorSub:a.subject, matterId: m.matterId, taskId:m.taskLink.taskId });
  });
  try {
    const taskRef = deps.tasksCollection.doc(m.taskLink.taskId), existing = await taskRef.get();
    if (existing.exists) {
      const found = await tasks.getTask({taskId:m.taskLink.taskId},deps);
      if (found.task.sourceType !== "ministry_decision" || found.task.sourceMessageId !== `${r.ministryId}:${m.matterId}`) M.fail("Task identity does not match ministry decision", "ministry_task_identity_mismatch",409);
      await tasks.updateTask({taskId:m.taskLink.taskId,expectedVersion:found.task.version,changes:expected},deps);
    } else {
      await tasks.createTask({ taskId:m.taskLink.taskId, ...expected, lifeArea:M.organization(r)==="fbc"?"church":"work", visibility:"private",
        assignedTo:"Dan", assignedToSub:normalizeOwnerSubjects(deps.danOwnerSubjects)[0], sourceType:"ministry_decision", sourceMessageId:`${r.ministryId}:${m.matterId}` },deps);
    }
    return await reconcileMinistryDecisionTask({ministryId:r.ministryId,matterId:m.matterId,expectedVersion:r.version+1},`reconcile-${M.hash(key)}`,deps);
  } catch(error) {
    // Keep the attempt intact. A subsequent reconciliation must read the target.
    throw error;
  }
}
async function reconcileMinistryDecisionTask(input,key,deps) {
  M.text(key,"idempotencyKey",180);if(key.length<8)M.fail("Idempotency key too short");
  const receipt=S.col(deps,"Receipts").doc(M.hash({subject:M.actor(deps).subject,key})),fingerprint=M.hash({operation:"reconcileMinistryDecisionTask",input});
  const target=S.ref(deps,input.ministryId), r=S.record(await target.get(),deps,true), m=S.matter(r,input.matterId);
  if (!m.taskLink || m.kind!=="decision") M.fail("No decision task to reconcile");
  const savedReceipt=await receipt.get();
  if(savedReceipt.exists){if(savedReceipt.data().fingerprint!==fingerprint)M.fail("Idempotency key reused","idempotency_key_reused",409);
    return {...await S.getMinistry({ministryId:r.ministryId},deps),replayed:true,readBackVerified:true};}
  M.expected(r,input.expectedVersion);
  const wanted=desiredTask(m,r), existing=await deps.tasksCollection.doc(m.taskLink.taskId).get();
  let matched=false, observedVersion=null;
  if(existing.exists) {
    const t=(await tasks.getTask({taskId:m.taskLink.taskId},deps)).task;
    if(t.sourceType!=="ministry_decision"||t.sourceMessageId!==`${r.ministryId}:${m.matterId}`) M.fail("Task identity mismatch","ministry_task_identity_mismatch",409);
    observedVersion=t.version;
    matched=Object.entries(wanted).every(([k,v])=>(t[k]||"")===v);
  }
  await deps.firestoreDb.runTransaction(async tx=>{
    const [saved,prior]=await Promise.all([tx.get(target),tx.get(receipt)]);
    const current=S.record(saved,deps,true);
    if(prior.exists){if(prior.data().fingerprint!==fingerprint)M.fail("Idempotency key reused","idempotency_key_reused",409);return;}
    M.expected(current,r.version);
    const item=S.matter(current,input.matterId);
    item.taskLink={...item.taskLink,status:matched?"verified":"pending",observedVersion,observedAt:M.now(deps)};
    current.version++; current.updatedAt=M.now(deps); tx.set(target,current);
    tx.create(receipt,{fingerprint,ministryId:r.ministryId,version:current.version,at:M.now(deps)});
    tx.create(target.collection("history").doc(String(current.version).padStart(10,"0")),{version:current.version,operation:"reconcileDecisionTask",at:M.now(deps),actorSub:M.actor(deps).subject,matterId:m.matterId,matched});
  });
  return {...await S.getMinistry({ministryId:r.ministryId},deps),taskId:m.taskLink.taskId,taskVerified:matched,readBackVerified:true};
}
module.exports={syncMinistryDecisionTask,reconcileMinistryDecisionTask,desiredTask};
