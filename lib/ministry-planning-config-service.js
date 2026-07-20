"use strict";

const MINISTRY_PLANNING_CONFIG_SECTIONS = Object.freeze([
  "operatorGuidance",
  "workflow",
  "songPlanning",
  "serviceOrder",
  "pianoPlanning"
]);

function createConfigError(message, statusCode = 400, code = "ministry_planning_config_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSections(value) {
  const requested = Array.isArray(value) ? value : value ? [value] : [];
  if (requested.length === 0) return [...MINISTRY_PLANNING_CONFIG_SECTIONS];

  const sections = Array.from(new Set(requested.map(normalizeString).filter(Boolean)));
  const unsupported = sections.filter((section) => !MINISTRY_PLANNING_CONFIG_SECTIONS.includes(section));
  if (unsupported.length > 0) {
    throw createConfigError(
      "Unsupported ministry planning config section",
      400,
      "unsupported_ministry_planning_config_section",
      { unsupported, allowedSections: MINISTRY_PLANNING_CONFIG_SECTIONS }
    );
  }
  return sections;
}

async function getMinistryPlanningConfig(input = {}, deps = {}) {
  const configId = normalizeString(input.configId) || "default";
  const sections = normalizeSections(input.sections || input.section);
  const collection = deps.ministryPlanningConfigCollection;

  if (!collection || typeof collection.doc !== "function") {
    throw createConfigError(
      "Ministry planning config collection is not configured",
      500,
      "ministry_planning_config_not_configured"
    );
  }

  const doc = await collection.doc(configId).get();
  if (!doc.exists) {
    throw createConfigError(
      "Ministry planning config was not found",
      404,
      "ministry_planning_config_not_found",
      { configId }
    );
  }

  const config = doc.data() || {};
  const documents = config.documents && typeof config.documents === "object" ? config.documents : {};
  const selectedDocuments = {};

  for (const section of sections) {
    if (documents[section]) selectedDocuments[section] = documents[section];
  }

  return {
    configId,
    schemaVersion: normalizeString(config.schemaVersion),
    configVersion: normalizeString(config.configVersion),
    catalogVersion: normalizeString(config.catalogVersion),
    catalogHash: normalizeString(config.catalogHash),
    availableSections: [...MINISTRY_PLANNING_CONFIG_SECTIONS],
    returnedSections: Object.keys(selectedDocuments),
    documents: selectedDocuments,
    updatedAt: normalizeString(config.updatedAt),
    updatedBy: normalizeString(config.updatedBy)
  };
}

module.exports = {
  MINISTRY_PLANNING_CONFIG_SECTIONS,
  createConfigError,
  getMinistryPlanningConfig,
  normalizeSections
};
