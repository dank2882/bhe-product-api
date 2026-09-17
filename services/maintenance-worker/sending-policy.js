"use strict";

function isSendingAllowed(config, channel) {
  if (config.sendingEnabled !== true) return false;
  if (channel === "email") return config.emailSendingEnabled === true;
  if (channel === "sms") return config.smsSendingEnabled === true;
  return false;
}

module.exports = { isSendingAllowed };
