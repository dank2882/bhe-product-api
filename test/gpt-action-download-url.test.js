const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGptActionArtifactDownloadUrl,
  buildGptActionDownloadUrl,
  verifyGptActionArtifactDownloadSignature,
  verifyGptActionDownloadSignature
} = require("../lib/gpt-action-download-url");

const NOW_MS = Date.parse("2026-07-11T17:00:00.000Z");

test("builds and verifies a short same-domain GPT Action download URL", () => {
  const result = buildGptActionDownloadUrl({
    baseUrl: "https://bhe-product-api.example.test/",
    presentationId: "presentation-season-in-egypt",
    secret: "download-secret",
    nowMs: NOW_MS
  });
  const url = new URL(result.downloadUrl);

  assert.equal(url.origin, "https://bhe-product-api.example.test");
  assert.equal(
    url.pathname,
    "/gpt-action-files/sermon-presentations/presentation-season-in-egypt"
  );
  assert.ok(result.downloadUrl.length < 300);
  assert.equal(verifyGptActionDownloadSignature({
    presentationId: "presentation-season-in-egypt",
    expiresAtSeconds: url.searchParams.get("expires"),
    signature: url.searchParams.get("signature"),
    secret: "download-secret",
    nowMs: NOW_MS
  }), true);
});

test("builds and verifies a same-domain preaching packet URL", () => {
  const result = buildGptActionArtifactDownloadUrl({
    baseUrl: "https://bhe-product-api.example.test",
    artifactType: "sermon-preaching-packets",
    artifactId: "packet-1",
    secret: "download-secret",
    nowMs: NOW_MS
  });
  const url = new URL(result.downloadUrl);
  assert.equal(url.pathname, "/gpt-action-files/sermon-preaching-packets/packet-1");
  assert.equal(verifyGptActionArtifactDownloadSignature({
    artifactType: "sermon-preaching-packets",
    artifactId: "packet-1",
    expiresAtSeconds: url.searchParams.get("expires"),
    signature: url.searchParams.get("signature"),
    secret: "download-secret",
    nowMs: NOW_MS
  }), true);
  assert.equal(verifyGptActionArtifactDownloadSignature({
    artifactType: "sermon-preaching-packets",
    artifactId: "packet-2",
    expiresAtSeconds: url.searchParams.get("expires"),
    signature: url.searchParams.get("signature"),
    secret: "download-secret",
    nowMs: NOW_MS
  }), false);
});

test("rejects expired, altered, and excessively long-lived download signatures", () => {
  const result = buildGptActionDownloadUrl({
    baseUrl: "https://bhe-product-api.example.test",
    presentationId: "presentation-1",
    secret: "download-secret",
    nowMs: NOW_MS
  });
  const url = new URL(result.downloadUrl);
  const common = {
    presentationId: "presentation-1",
    expiresAtSeconds: url.searchParams.get("expires"),
    signature: url.searchParams.get("signature"),
    secret: "download-secret"
  };

  assert.equal(verifyGptActionDownloadSignature({
    ...common,
    presentationId: "presentation-2",
    nowMs: NOW_MS
  }), false);
  assert.equal(verifyGptActionDownloadSignature({
    ...common,
    nowMs: Date.parse(result.expiresAt) + 1000
  }), false);
  assert.equal(verifyGptActionDownloadSignature({
    ...common,
    nowMs: NOW_MS - 2 * 24 * 60 * 60 * 1000
  }), false);
});
