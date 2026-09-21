"use strict";
const { GoogleAuth } = require("google-auth-library");
function createMaintenanceMessagingClient(url, auth = new GoogleAuth()) {
  if (!url) return null;
  const origin = new URL(url);
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".run.app") || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("Maintenance worker must be an HTTPS Cloud Run origin");
  return async input => {
    const client = await auth.getIdTokenClient(origin.origin);
    const response = await client.request({ url: `${origin.origin}/internal/operation`, method: "POST", data: input, timeout: 30000, retry: false });
    return response.data;
  };
}
module.exports = { createMaintenanceMessagingClient };
