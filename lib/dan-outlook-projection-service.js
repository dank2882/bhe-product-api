"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { getDanActorFields, requireDanPrivateAccess } = require("./dan-private-access");
const {
  assertExpectedVersion,
  buildPersonSummary,
  createRelationshipError,
  getCollection,
  getNowIso,
  getRequiredRecord,
  loadCollection,
  normalizeKey,
  normalizeString
} = require("./dan-relationships-service");
const { getOutlookPhotoPayload } = require("./dan-relationship-photo-service");
const { runDanFirestoreTransaction } = require("./dan-firestore-transaction");

const OUTLOOK_CONTACT_FOLDER_NAME = "Dan Relationships";
const MANAGED_OUTLOOK_FIELDS = Object.freeze([
  "displayName",
  "givenName",
  "middleName",
  "surname",
  "title",
  "jobTitle",
  "companyName",
  "emailAddresses",
  "mobilePhone",
  "businessPhones",
  "businessHomePage"
]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hashSnapshot(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeOutlookSnapshot(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const snapshot = {};
  for (const field of MANAGED_OUTLOOK_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    if (field === "emailAddresses") {
      snapshot[field] = (Array.isArray(input[field]) ? input[field] : [])
        .map((entry) => ({ name: normalizeString(entry?.name), address: normalizeString(entry?.address).toLowerCase() }))
        .filter((entry) => entry.address);
    } else if (field === "businessPhones") {
      snapshot[field] = (Array.isArray(input[field]) ? input[field] : []).map(normalizeString).filter(Boolean);
    } else {
      snapshot[field] = normalizeString(input[field]);
    }
  }
  return snapshot;
}

async function buildOutlookContactForPerson(personId, deps = {}) {
  const person = await getRequiredRecord(getCollection(deps, "relationshipPeopleCollection"), personId, "person");
  const [methods, affiliations, organizations] = await Promise.all([
    loadCollection(getCollection(deps, "relationshipContactMethodsCollection")),
    loadCollection(getCollection(deps, "relationshipAffiliationsCollection")),
    loadCollection(getCollection(deps, "relationshipOrganizationsCollection"))
  ]);
  const activeMethods = methods.filter((item) => item.personId === person.personId && (item.status || "active") === "active");
  const activeAffiliation = affiliations.find((item) => item.personId === person.personId && (item.status || "current") === "current");
  const organization = activeAffiliation
    ? organizations.find((item) => item.organizationId === activeAffiliation.organizationId)
    : null;
  const emails = activeMethods.filter((item) => item.type === "email");
  const phones = activeMethods.filter((item) => item.type === "phone");
  const whatsapp = activeMethods.find((item) => item.type === "whatsapp");
  const website = activeMethods.find((item) => item.type === "website");
  const preferredPhone = phones.find((item) => item.preferred) || phones[0];
  const remainingPhones = phones.filter((item) => item.contactMethodId !== preferredPhone?.contactMethodId);
  return {
    person,
    contact: normalizeOutlookSnapshot({
      displayName: person.displayName,
      givenName: person.givenName,
      middleName: person.middleName,
      surname: person.surname,
      title: person.honorific,
      jobTitle: activeAffiliation?.role || person.title,
      companyName: organization?.name || "",
      emailAddresses: emails.map((item) => ({ name: person.displayName, address: item.value })),
      mobilePhone: preferredPhone?.value || whatsapp?.value || "",
      businessPhones: remainingPhones.map((item) => item.value),
      businessHomePage: website?.value || organization?.website || ""
    }),
    profilePhotoId: person.profilePhotoId || "",
    searchHints: {
      displayName: person.displayName,
      organizationName: organization?.name || "",
      emails: emails.map((item) => item.value),
      phones: [preferredPhone?.value, whatsapp?.value, ...remainingPhones.map((item) => item.value)].filter(Boolean)
    }
  };
}

async function prepareOutlookContactPublish(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const built = await buildOutlookContactForPerson(input.personId, deps);
  const projectionDocument = await getCollection(deps, "outlookProjectionsCollection").doc(built.person.personId).get();
  const projection = projectionDocument.exists ? projectionDocument.data() || {} : null;
  if (!built.contact.emailAddresses?.length && !built.contact.mobilePhone && !built.contact.businessPhones?.length) {
    if (input.allowWithoutContactMethod !== true) {
      throw createRelationshipError(
        "Outlook publishing normally requires an email address or phone number",
        409,
        "outlook_publish_contact_method_required"
      );
    }
  }
  return {
    person: buildPersonSummary(built.person),
    folder: { displayName: OUTLOOK_CONTACT_FOLDER_NAME, folderId: projection?.contactFolderId || "" },
    contact: built.contact,
    searchHints: built.searchHints,
    profilePhotoId: built.profilePhotoId,
    existingProjection: projection,
    requiredExternalSteps: [
      "Reuse the Outlook connector to list the Dan Relationships folder and saved contacts; compare the returned hints locally.",
      "Ask Dan to approve create, link, or update.",
      "Create the Dan Relationships contact folder on the first approved publish, if it does not exist.",
      "Perform the Outlook create_contact or update_contact write.",
      "Fetch the saved contact back with fetch_contact.",
      "Record the returned IDs and refreshed contact with recordOutlookContactPublish."
    ]
  };
}

async function recordOutlookContactPublish(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  if (input.approved !== true) {
    throw createRelationshipError("Explicit Outlook publish approval is required", 400, "outlook_publish_approval_required");
  }
  const action = normalizeString(input.action).toLowerCase();
  if (!["create", "link", "update"].includes(action)) {
    throw createRelationshipError("Outlook publish action must be create, link, or update", 400, "invalid_outlook_publish_action");
  }
  const built = await buildOutlookContactForPerson(input.personId, deps);
  const contactId = normalizeString(input.contactId);
  const contactFolderId = normalizeString(input.contactFolderId);
  if (!contactId || !contactFolderId) {
    throw createRelationshipError("Outlook contact and folder IDs are required", 400, "outlook_publish_receipt_incomplete");
  }
  const refreshedContact = normalizeOutlookSnapshot(input.refreshedContact);
  if (!refreshedContact.displayName) {
    throw createRelationshipError("A refreshed Outlook contact read-back is required", 400, "outlook_publish_readback_required");
  }
  const collection = getCollection(deps, "outlookProjectionsCollection");
  const actor = getDanActorFields(deps);
  const now = getNowIso(deps);
  const docRef = collection.doc(built.person.personId);
  return runDanFirestoreTransaction(deps, collection, async (transaction) => {
    const existingDoc = await transaction.get(docRef);
    const existing = existingDoc.exists ? existingDoc.data() || {} : null;
    if (existing) assertExpectedVersion(existing, input.expectedVersion, "outlookProjection");
    const projection = {
      projectionId: built.person.personId,
      personId: built.person.personId,
      owner: "dan",
      serves: ["dan"],
      visibility: "private",
      ownerSub: actor.actorSub,
      contactFolderName: OUTLOOK_CONTACT_FOLDER_NAME,
      contactFolderId,
      contactId,
      changeKey: normalizeString(input.changeKey),
      action,
      status: "connected",
      managedSnapshot: built.contact,
      managedSnapshotHash: hashSnapshot(built.contact),
      outlookSnapshot: refreshedContact,
      outlookSnapshotHash: hashSnapshot(refreshedContact),
      relationshipVersion: Number(built.person.version || 0),
      photoStatus: normalizeString(input.photoStatus) || (built.profilePhotoId ? "pending" : "not_applicable"),
      lastSyncedAt: now,
      lastObservedAt: now,
      version: existing ? Number(existing.version || 0) + 1 : 1,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    transaction.set(docRef, projection);
    return { projection };
  });
}

function compareSnapshots(relationship, outlook) {
  const differences = [];
  for (const field of MANAGED_OUTLOOK_FIELDS) {
    const relationshipValue = relationship[field] ?? (Array.isArray(outlook[field]) ? [] : "");
    const outlookValue = outlook[field] ?? (Array.isArray(relationship[field]) ? [] : "");
    if (stableStringify(relationshipValue) !== stableStringify(outlookValue)) {
      differences.push({ field, relationshipValue, outlookValue });
    }
  }
  return differences;
}

async function observeOutlookContact(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  const collection = getCollection(deps, "outlookProjectionsCollection");
  const built = await buildOutlookContactForPerson(input.personId, deps);
  const outlookSnapshot = normalizeOutlookSnapshot(input.refreshedContact);
  const now = getNowIso(deps);
  const docRef = collection.doc(input.personId);
  return runDanFirestoreTransaction(deps, collection, async (transaction) => {
    const document = await transaction.get(docRef);
    if (!document.exists) throw createRelationshipError("outlookProjection not found", 404, "outlookProjection_not_found", { id: input.personId });
    const projection = { ...(document.data() || {}), projectionId: input.personId };
    assertExpectedVersion(projection, input.expectedVersion, "outlookProjection");
    if (input.deleted === true || !outlookSnapshot.displayName) {
      const next = {
        ...projection,
        status: "disconnected",
        disconnectedReason: input.deleted === true ? "outlook_contact_deleted" : "outlook_contact_unavailable",
        lastObservedAt: now,
        version: Number(projection.version || 0) + 1,
        updatedAt: now
      };
      transaction.set(docRef, next);
      return { projection: next, mergeProposal: null };
    }
    const differences = compareSnapshots(built.contact, outlookSnapshot);
    const mergeProposal = differences.length > 0
      ? {
          mergeProposalId: `outlook-merge-${randomUUID()}`,
          personId: projection.personId,
          projectionVersion: Number(projection.version || 0) + 1,
          status: "pending",
          differences,
          createdAt: now
        }
      : null;
    const next = {
      ...projection,
      status: "connected",
      contactFolderId: normalizeString(input.contactFolderId) || projection.contactFolderId,
      contactId: normalizeString(input.contactId) || projection.contactId,
      changeKey: normalizeString(input.changeKey) || projection.changeKey,
      lastObservedAt: now,
      observedOutlookSnapshot: outlookSnapshot,
      pendingMergeProposal: mergeProposal,
      version: Number(projection.version || 0) + 1,
      updatedAt: now
    };
    transaction.set(docRef, next);
    return { projection: next, mergeProposal };
  });
}

async function resolveOutlookMerge(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  if (input.approved !== true) {
    throw createRelationshipError("Explicit merge approval is required", 400, "outlook_merge_approval_required");
  }
  const projections = getCollection(deps, "outlookProjectionsCollection");
  const people = getCollection(deps, "relationshipPeopleCollection");
  const contactMethods = getCollection(deps, "relationshipContactMethodsCollection");
  const decisions = input.decisions && typeof input.decisions === "object" ? input.decisions : {};
  const projectionRef = projections.doc(input.personId);
  const personRef = people.doc(input.personId);
  const actor = getDanActorFields(deps);
  return runDanFirestoreTransaction(deps, projections, async (transaction) => {
    const [projectionDoc, personDoc, methodsSnapshot] = await Promise.all([
      transaction.get(projectionRef),
      transaction.get(personRef),
      transaction.get(contactMethods)
    ]);
    if (!projectionDoc.exists) throw createRelationshipError("outlookProjection not found", 404, "outlookProjection_not_found", { id: input.personId });
    if (!personDoc.exists) throw createRelationshipError("person not found", 404, "person_not_found", { id: input.personId });
    const projection = { ...(projectionDoc.data() || {}), projectionId: input.personId, personId: input.personId };
    const person = { ...(personDoc.data() || {}), personId: input.personId };
    assertExpectedVersion(projection, input.expectedVersion, "outlookProjection");
    const proposal = projection.pendingMergeProposal;
    if (!proposal || proposal.status !== "pending") {
      throw createRelationshipError("No pending Outlook merge proposal exists", 409, "outlook_merge_not_pending");
    }
    const missing = proposal.differences.map((item) => item.field).filter((field) => !["relationship", "outlook"].includes(decisions[field]));
    if (missing.length > 0) {
      throw createRelationshipError("Every differing field needs a relationship or outlook decision", 400, "outlook_merge_decisions_incomplete", { missing });
    }
    const nextPerson = { ...person };
    const outlookUpdates = {};
    let replaceEmailsFromOutlook = false;
    let replacePhonesFromOutlook = false;
    for (const difference of proposal.differences) {
      if (decisions[difference.field] === "relationship") {
        outlookUpdates[difference.field] = difference.relationshipValue;
        continue;
      }
      if (["displayName", "givenName", "middleName", "surname"].includes(difference.field)) {
        nextPerson[difference.field] = normalizeString(difference.outlookValue);
      } else if (difference.field === "title") {
        nextPerson.honorific = normalizeString(difference.outlookValue);
      } else if (difference.field === "jobTitle") {
        nextPerson.title = normalizeString(difference.outlookValue);
      } else if (difference.field === "emailAddresses") {
        replaceEmailsFromOutlook = true;
      } else if (difference.field === "mobilePhone" || difference.field === "businessPhones") {
        replacePhonesFromOutlook = true;
      }
    }
    const chosenValue = (field) => {
      const difference = proposal.differences.find((item) => item.field === field);
      if (!difference) return projection.observedOutlookSnapshot?.[field] ?? projection.managedSnapshot?.[field];
      return decisions[field] === "outlook" ? difference.outlookValue : difference.relationshipValue;
    };
    const allMethods = methodsSnapshot.docs.map((doc) => ({ ...(doc.data() || {}), contactMethodId: doc.id }));
    const now = getNowIso(deps);
    const replaceMethods = (type, values) => {
      for (const item of allMethods.filter((method) => method.personId === projection.personId && method.type === type && (method.status || "active") === "active")) {
        transaction.set(contactMethods.doc(item.contactMethodId), {
          ...item,
          status: "archived",
          version: Number(item.version || 0) + 1,
          updatedAt: now
        });
      }
      for (const [index, value] of values.map(normalizeString).filter(Boolean).entries()) {
        const contactMethodId = `contact-method-${randomUUID()}`;
        transaction.create(contactMethods.doc(contactMethodId), {
          contactMethodId,
          personId: projection.personId,
          organizationId: "",
          owner: "dan",
          serves: ["dan"],
          visibility: "private",
          ownerSub: actor.actorSub,
          type,
          value,
          normalizedValue: normalizeKey(value),
          label: type === "phone" && index === 0 ? "mobile" : "Outlook",
          preferred: index === 0,
          verifiedAt: "",
          source: "outlook_approved_merge",
          notes: "",
          status: "active",
          version: 1,
          createdAt: now,
          updatedAt: now
        });
      }
    };
    if (replaceEmailsFromOutlook) replaceMethods("email", (chosenValue("emailAddresses") || []).map((item) => item.address));
    if (replacePhonesFromOutlook) replaceMethods("phone", [chosenValue("mobilePhone"), ...(chosenValue("businessPhones") || [])]);
    if (stableStringify(nextPerson) !== stableStringify(person)) {
      nextPerson.searchText = normalizeKey([nextPerson.displayName, nextPerson.alternateNames || [], nextPerson.title, nextPerson.locationKeys || []].flat().join(" "));
      nextPerson.version = Number(person.version || 0) + 1;
      nextPerson.updatedAt = now;
      transaction.set(personRef, nextPerson);
    }
    const nextProjection = {
      ...projection,
      pendingMergeProposal: { ...proposal, status: "resolved", decisions, resolvedAt: now },
      version: Number(projection.version || 0) + 1,
      updatedAt: now
    };
    transaction.set(projectionRef, nextProjection);
    return {
      projection: nextProjection,
      relationshipPerson: buildPersonSummary(nextPerson),
      outlookUpdates,
      requiresOutlookWrite: Object.keys(outlookUpdates).length > 0
    };
  });
}

async function prepareOutlookPhotoPublish(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  if (input.approved !== true) {
    throw createRelationshipError("Explicit Outlook photo approval is required", 400, "outlook_photo_approval_required");
  }
  const projection = await getRequiredRecord(getCollection(deps, "outlookProjectionsCollection"), input.personId, "outlookProjection");
  if (projection.status !== "connected") {
    throw createRelationshipError("The Outlook contact projection is not connected", 409, "outlook_projection_not_connected");
  }
  const person = await getRequiredRecord(getCollection(deps, "relationshipPeopleCollection"), input.personId, "person");
  if (!person.profilePhotoId) {
    throw createRelationshipError("The person has no approved profile photo", 409, "profile_photo_missing");
  }
  const payload = await getOutlookPhotoPayload({ photoId: person.profilePhotoId }, deps);
  return {
    projectionId: projection.projectionId,
    contactId: projection.contactId,
    contactFolderId: projection.contactFolderId,
    method: "PUT",
    graphPath: `/me/contactFolders/${encodeURIComponent(projection.contactFolderId)}/contacts/${encodeURIComponent(projection.contactId)}/photo/$value`,
    contentType: payload.contentType,
    byteSize: payload.byteSize,
    downloadUrl: payload.downloadUrl,
    expiresInSeconds: payload.expiresInSeconds,
    requiredReceipt: ["contactId", "contactFolderId", "photoStatus", "readBackVerified"]
  };
}

async function recordOutlookPhotoPublish(input = {}, deps = {}) {
  requireDanPrivateAccess(deps);
  if (input.approved !== true || input.readBackVerified !== true) {
    throw createRelationshipError(
      "Approved Outlook photo publish and verified read-back are required",
      400,
      "outlook_photo_readback_required"
    );
  }
  const projections = getCollection(deps, "outlookProjectionsCollection");
  const person = await getRequiredRecord(getCollection(deps, "relationshipPeopleCollection"), input.personId, "person");
  if (!person.profilePhotoId) {
    throw createRelationshipError("The person has no approved profile photo", 409, "profile_photo_missing");
  }
  const now = getNowIso(deps);
  const docRef = projections.doc(input.personId);
  return runDanFirestoreTransaction(deps, projections, async (transaction) => {
    const document = await transaction.get(docRef);
    if (!document.exists) throw createRelationshipError("outlookProjection not found", 404, "outlookProjection_not_found", { id: input.personId });
    const projection = { ...(document.data() || {}), projectionId: input.personId };
    assertExpectedVersion(projection, input.expectedVersion, "outlookProjection");
    if (projection.status !== "connected") {
      throw createRelationshipError("The Outlook contact projection is not connected", 409, "outlook_projection_not_connected");
    }
    if (normalizeString(input.contactId) !== projection.contactId || normalizeString(input.contactFolderId) !== projection.contactFolderId) {
      throw createRelationshipError(
        "The Outlook photo receipt does not match the connected contact",
        409,
        "outlook_photo_receipt_target_mismatch"
      );
    }
    const next = {
      ...projection,
      photoStatus: "published",
      outlookPhotoSourceId: person.profilePhotoId,
      photoPublishedAt: now,
      photoReadBackVerifiedAt: now,
      photoPublishReceipt: {
        graphRequestId: normalizeString(input.graphRequestId),
        contactId: projection.contactId,
        contactFolderId: projection.contactFolderId
      },
      version: Number(projection.version || 0) + 1,
      updatedAt: now
    };
    transaction.set(docRef, next);
    return { projection: next };
  });
}

module.exports = {
  MANAGED_OUTLOOK_FIELDS,
  OUTLOOK_CONTACT_FOLDER_NAME,
  buildOutlookContactForPerson,
  compareSnapshots,
  normalizeOutlookSnapshot,
  observeOutlookContact,
  prepareOutlookContactPublish,
  prepareOutlookPhotoPublish,
  recordOutlookContactPublish,
  recordOutlookPhotoPublish,
  resolveOutlookMerge
};
