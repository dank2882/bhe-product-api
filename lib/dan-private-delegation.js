"use strict";

// Backend-owned grants are deliberately separate from identity aliases.
// The authenticated actor and historical record owners never change.
function delegatedOwnerSubjects(subject, env = process.env) {
  const split = (value) => [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];
  const actor = typeof subject === "string" ? subject.trim() : "";
  if (!actor || !split(env.DAN_PRIVATE_DELEGATE_SUBJECTS).includes(actor)) return [];
  return split(env.DAN_PRIVATE_OWNER_SUBJECTS);
}

module.exports = { delegatedOwnerSubjects };
