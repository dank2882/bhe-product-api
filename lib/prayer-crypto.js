"use strict";

const { GoogleAuth } = require("google-auth-library");

const ALGORITHM = "GOOGLE_CLOUD_KMS";
const AAD_VERSION = 1;

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function buildAad(context = {}) {
  return Buffer.from(stableStringify({
    domain: "prayer_management",
    aadVersion: AAD_VERSION,
    recordType: String(context.recordType || ""),
    recordId: String(context.recordId || ""),
    ownerSub: String(context.ownerSub || "")
  }), "utf8").toString("base64");
}

function createKmsPrayerCrypto({ keyName = process.env.PRAYER_KMS_KEY_NAME, auth } = {}) {
  const normalizedKeyName = String(keyName || "").trim();
  const googleAuth = auth || new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

  function assertConfigured() {
    if (!normalizedKeyName) {
      const error = new Error("Prayer encryption is not configured");
      error.statusCode = 503;
      error.code = "prayer_encryption_not_configured";
      throw error;
    }
  }

  async function request(method, body) {
    assertConfigured();
    const client = await googleAuth.getClient();
    const url = `https://cloudkms.googleapis.com/v1/${normalizedKeyName}:${method}`;
    const response = await client.request({ url, method: "POST", data: body });
    return response.data || {};
  }

  return {
    async encryptJson(value, context) {
      const plaintext = Buffer.from(JSON.stringify(value ?? {}), "utf8").toString("base64");
      const additionalAuthenticatedData = buildAad(context);
      const result = await request("encrypt", { plaintext, additionalAuthenticatedData });
      if (!result.ciphertext) throw new Error("Cloud KMS did not return ciphertext");
      return {
        algorithm: ALGORITHM,
        keyName: normalizedKeyName,
        aadVersion: AAD_VERSION,
        ciphertext: result.ciphertext
      };
    },

    async decryptJson(envelope, context) {
      if (!envelope || envelope.algorithm !== ALGORITHM || !envelope.ciphertext) {
        const error = new Error("Prayer content is not a valid encrypted envelope");
        error.statusCode = 500;
        error.code = "invalid_prayer_envelope";
        throw error;
      }
      if (envelope.keyName !== normalizedKeyName) {
        const error = new Error("Prayer content was encrypted with an unexpected key");
        error.statusCode = 500;
        error.code = "prayer_key_mismatch";
        throw error;
      }
      const additionalAuthenticatedData = buildAad(context);
      const result = await request("decrypt", {
        ciphertext: envelope.ciphertext,
        additionalAuthenticatedData
      });
      return JSON.parse(Buffer.from(result.plaintext || "", "base64").toString("utf8"));
    }
  };
}

module.exports = { AAD_VERSION, ALGORITHM, buildAad, createKmsPrayerCrypto, stableStringify };
