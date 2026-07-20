const { createHmac, timingSafeEqual } = require("node:crypto");

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function createSermonWalkAccessToken({ sessionId, sermonId, expiresAtSeconds } = {}, secret = "") {
  if (!secret) throw new Error("Sermon walk access token secret is required");
  if (!sessionId || !sermonId) throw new Error("Sermon walk access token requires sessionId and sermonId");
  const payload = {
    v: 1,
    sessionId: String(sessionId),
    sermonId: String(sermonId),
    exp: Number(expiresAtSeconds)
  };
  if (!Number.isInteger(payload.exp) || payload.exp <= 0) {
    throw new Error("Sermon walk access token requires a valid expiration");
  }
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

function verifySermonWalkAccessToken(token = "", secret = "", nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    if (!secret || typeof token !== "string") return null;
    const [encodedPayload, providedSignature, extra] = token.split(".");
    if (!encodedPayload || !providedSignature || extra) return null;
    const expectedSignature = signPayload(encodedPayload, secret);
    const provided = Buffer.from(providedSignature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    const payload = JSON.parse(decodeBase64Url(encodedPayload));
    if (payload?.v !== 1 || !payload.sessionId || !payload.sermonId) return null;
    if (!Number.isInteger(payload.exp) || payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  createSermonWalkAccessToken,
  verifySermonWalkAccessToken
};
