"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_TASK_ATTACHMENT_BYTES,
  attachTaskFile,
  getTaskAttachmentDownload,
  listTaskAttachments
} = require("../lib/task-attachment-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }
  async get() {
    return { exists: this.collection.store.has(this.id), data: () => clone(this.collection.store.get(this.id)) };
  }
  async create(value) {
    if (this.collection.store.has(this.id)) throw new Error("already exists");
    this.collection.store.set(this.id, clone(value));
  }
}

class FakeCollection {
  constructor(records = {}) {
    this.store = new Map(Object.entries(clone(records)));
  }
  doc(id) {
    return new FakeDocRef(this, id);
  }
  limit(maxDocs) {
    return { get: async () => this.snapshot(Array.from(this.store.entries()).slice(0, maxDocs)) };
  }
  where(field, operator, value) {
    assert.equal(operator, "==");
    return {
      limit: (maxDocs) => ({
        get: async () => this.snapshot(
          Array.from(this.store.entries()).filter(([, record]) => record[field] === value).slice(0, maxDocs)
        )
      })
    };
  }
  snapshot(entries) {
    return { docs: entries.map(([id, value]) => ({ id, data: () => clone(value) })) };
  }
}

function createBucket() {
  const calls = [];
  return {
    calls,
    file(storagePath) {
      return {
        async save(buffer, options) {
          calls.push(["save", storagePath, Buffer.from(buffer), options]);
        },
        async delete(options) {
          calls.push(["delete", storagePath, options]);
        },
        async getSignedUrl(options) {
          calls.push(["signed-url", storagePath, options]);
          return [`https://storage.test/read/${encodeURIComponent(storagePath)}`];
        }
      };
    }
  };
}

function createDeps() {
  return {
    tasksCollection: new FakeCollection({
      "task-1": {
        taskId: "task-1",
        title: "Prepare update",
        lifeArea: "work",
        visibility: "staff",
        ownerSub: "dan"
      }
    }),
    projectsCollection: new FakeCollection(),
    taskAttachmentsCollection: new FakeCollection(),
    taskAttachmentBucket: createBucket(),
    taskAccess: { role: "manager", subject: "dan", name: "Dan", email: "dan@example.com" },
    now: () => "2026-07-22T16:00:00.000Z",
    nowMs: () => 1784736000000,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: (name) => name === "content-type" ? "application/pdf" : "8" },
      arrayBuffer: async () => Buffer.from("PDF file")
    })
  };
}

test("attaches, deduplicates, lists, and signs one task file", async () => {
  const deps = createDeps();
  const input = {
    recordType: "task",
    recordId: "task-1",
    description: "Source briefing",
    openaiFileIdRefs: [{
      name: "briefing.pdf",
      mime_type: "application/pdf",
      download_link: "https://files.test/briefing.pdf"
    }]
  };
  const attached = await attachTaskFile(input, deps);
  assert.equal(attached.action, "attached");
  assert.equal(attached.attachment.fileName, "briefing.pdf");
  assert.equal(attached.attachment.uploadedByName, "Dan");
  assert.equal(deps.taskAttachmentBucket.calls[0][0], "save");
  assert.equal(deps.taskAttachmentBucket.calls[0][3].metadata.contentType, "application/pdf");

  const duplicate = await attachTaskFile(input, deps);
  assert.equal(duplicate.action, "existing");
  assert.equal(deps.taskAttachmentBucket.calls.filter(([action]) => action === "save").length, 1);

  const listed = await listTaskAttachments({ recordType: "task", recordId: "task-1" }, deps);
  assert.equal(listed.count, 1);
  assert.equal(listed.attachments[0].description, "Source briefing");

  const download = await getTaskAttachmentDownload({ attachmentId: attached.attachment.attachmentId }, deps);
  assert.match(download.download.url, /^https:\/\/storage\.test\/read\//);
  assert.equal(download.attachment.fileName, "briefing.pdf");
});

test("rejects unsupported and oversized attachments", async () => {
  const deps = createDeps();
  await assert.rejects(
    () => attachTaskFile({
      recordType: "task",
      recordId: "task-1",
      openaiFileIdRefs: [{ name: "installer.exe", download_link: "https://files.test/installer.exe" }]
    }, deps),
    { code: "task_attachment_file_type_unsupported" }
  );

  deps.fetchImpl = async () => ({
    ok: true,
    headers: { get: (name) => name === "content-length" ? String(MAX_TASK_ATTACHMENT_BYTES + 1) : "application/pdf" },
    arrayBuffer: async () => Buffer.from("unused")
  });
  await assert.rejects(
    () => attachTaskFile({
      recordType: "task",
      recordId: "task-1",
      openaiFileIdRefs: [{ name: "large.pdf", download_link: "https://files.test/large.pdf" }]
    }, deps),
    { code: "task_attachment_too_large", statusCode: 413 }
  );
});

test("private task attachments remain unreadable to unrelated staff", async () => {
  const deps = createDeps();
  deps.tasksCollection.store.get("task-1").visibility = "private";
  deps.taskAccess = { role: "manager", subject: "other", name: "Other" };
  await assert.rejects(
    () => listTaskAttachments({ recordType: "task", recordId: "task-1" }, deps),
    { code: "task_access_denied", statusCode: 403 }
  );
});
