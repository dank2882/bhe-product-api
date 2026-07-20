const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_GPT_ACTION_FILE_BYTES,
  applyPresentationActionFileResponse,
  buildAttachmentContentDisposition,
  createPreachingPacketActionFileResponse,
  createPresentationActionFileResponse,
  sanitizeAttachmentFilename
} = require("../lib/gpt-action-file-response");

test("presentation Action file response signs a stored PPTX with attachment metadata", async () => {
  const signedRequests = [];
  const fileResponse = await createPresentationActionFileResponse(
    {
      result: {
        presentation: {
          presentationId: "presentation-1",
          filename: "cached-name.pptx",
          downloadUrl: "https://old.example.com/file"
        }
      }
    },
    {
      getPresentation: async () => ({
        presentationId: "presentation-1",
        storagePath: "sermon-presentations/sermon-1/living-free.pptx",
        filename: "living-free.pptx",
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: 139567
      }),
      createSignedUrl: async (request) => {
        signedRequests.push(request);
        return {
          downloadUrl: "https://storage.example.com/signed-presentation",
          expiresAt: "2026-07-18T00:00:00.000Z"
        };
      }
    }
  );

  assert.deepEqual(signedRequests, [{
    presentationId: "presentation-1",
    storagePath: "sermon-presentations/sermon-1/living-free.pptx",
    filename: "living-free.pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    contentDisposition: "attachment; filename=\"living-free.pptx\""
  }]);
  assert.deepEqual(fileResponse.openaiFileResponse, [
    "https://storage.example.com/signed-presentation"
  ]);
  assert.equal(fileResponse.sizeBytes, 139567);
});

test("preaching packet Action response attaches a stored ZIP", async () => {
  const fileResponse = await createPreachingPacketActionFileResponse(
    { result: { packet: { packetId: "packet-1" } } },
    {
      getPacket: async () => ({
        storagePath: "sermon-preaching-packets/sermon-1/packet.zip",
        filename: "packet.zip",
        contentType: "application/zip",
        sizeBytes: 2048
      }),
      createSignedUrl: async () => ({
        downloadUrl: "https://example.test/gpt-action-files/packet-1",
        expiresAt: "2026-07-18T00:00:00.000Z"
      })
    }
  );
  const response = applyPresentationActionFileResponse(
    { result: { packet: { packetId: "packet-1", downloadUrl: "old" } } },
    fileResponse
  );
  assert.deepEqual(response.openaiFileResponse, ["https://example.test/gpt-action-files/packet-1"]);
  assert.equal(response.result.packet.downloadUrl, "https://example.test/gpt-action-files/packet-1");
  assert.equal(fileResponse.contentType, "application/zip");
});

test("Action file response updates direct and dispatcher download fields", () => {
  const direct = applyPresentationActionFileResponse(
    { ok: true, downloadUrl: "old", downloadUrlExpiresAt: "old-expiry" },
    {
      downloadUrl: "new",
      downloadUrlExpiresAt: "new-expiry",
      openaiFileResponse: ["new"]
    }
  );
  const dispatched = applyPresentationActionFileResponse(
    { result: { presentation: { downloadUrl: "old" } } },
    {
      downloadUrl: "new",
      downloadUrlExpiresAt: "new-expiry",
      openaiFileResponse: ["new"]
    }
  );

  assert.deepEqual(direct.openaiFileResponse, ["new"]);
  assert.equal(direct.downloadUrl, "new");
  assert.equal(direct.downloadUrlExpiresAt, "new-expiry");
  assert.deepEqual(dispatched.openaiFileResponse, ["new"]);
  assert.equal(dispatched.result.presentation.downloadUrl, "new");
});

test("files over the GPT Action limit are not attached", async () => {
  const fileResponse = await createPresentationActionFileResponse(
    { result: { presentation: { presentationId: "presentation-large" } } },
    {
      getPresentation: async () => ({
        storagePath: "large.pptx",
        filename: "large.pptx",
        sizeBytes: MAX_GPT_ACTION_FILE_BYTES + 1
      }),
      createSignedUrl: async () => {
        throw new Error("should not sign an oversized file");
      }
    }
  );

  assert.equal(fileResponse.skipped, true);
  assert.equal(fileResponse.reason, "file_too_large");
});

test("attachment filenames are safe for signed response headers", () => {
  assert.equal(sanitizeAttachmentFilename("Living Free.pptx"), "Living Free.pptx");
  assert.equal(sanitizeAttachmentFilename("bad\r\n\"name.pptx"), "bad___name.pptx");
  assert.equal(
    buildAttachmentContentDisposition("Living Free.pptx"),
    "attachment; filename=\"Living Free.pptx\""
  );
});
