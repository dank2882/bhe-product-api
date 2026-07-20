const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSermonWalkAccessToken,
  verifySermonWalkAccessToken
} = require("../lib/sermon-walk-access");

test("creates and verifies a scoped sermon walk token", () => {
  const token = createSermonWalkAccessToken({
    sessionId: "session-1",
    sermonId: "sermon-1",
    expiresAtSeconds: 2000
  }, "test-secret");

  assert.deepEqual(verifySermonWalkAccessToken(token, "test-secret", 1000), {
    v: 1,
    sessionId: "session-1",
    sermonId: "sermon-1",
    exp: 2000
  });
  assert.equal(verifySermonWalkAccessToken(token, "wrong-secret", 1000), null);
  assert.equal(verifySermonWalkAccessToken(token, "test-secret", 2000), null);
});

test("rejects a modified sermon walk token", () => {
  const token = createSermonWalkAccessToken({
    sessionId: "session-1",
    sermonId: "sermon-1",
    expiresAtSeconds: 2000
  }, "test-secret");
  const [payload, signature] = token.split(".");
  const changedPayload = Buffer.from(JSON.stringify({
    v: 1,
    sessionId: "session-2",
    sermonId: "sermon-1",
    exp: 2000
  })).toString("base64url");

  assert.equal(verifySermonWalkAccessToken(`${changedPayload}.${signature}`, "test-secret", 1000), null);
  assert.equal(verifySermonWalkAccessToken(`${payload}.${signature}x`, "test-secret", 1000), null);
});
