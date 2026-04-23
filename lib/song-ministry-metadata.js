"use strict";

const LEADER_READINESS_VALUES = Object.freeze([
  "ready_now",
  "learnable_soon",
  "not_ready",
  "unknown"
]);

const STRENGTH_VALUES = Object.freeze([
  "core",
  "solid_rotation",
  "situational",
  "unknown"
]);

const FEELS_DATED_VALUES = Object.freeze([
  "yes",
  "no",
  "mixed",
  "unknown"
]);

const DEVELOPMENT_POTENTIAL_VALUES = Object.freeze([
  "high",
  "medium",
  "low",
  "unknown"
]);

const SITUATIONAL_USE_VALUES = Object.freeze([
  "invitation",
  "reflective",
  "revival"
]);

function normalizeMetadataString(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeEnumValue(value, allowedValues, fallbackValue = "unknown") {
  const normalized = normalizeMetadataString(value);
  return allowedValues.includes(normalized) ? normalized : fallbackValue;
}

function normalizeSituationalUse(value) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = new Set();

  for (const item of values) {
    const cleanValue = normalizeMetadataString(item);
    if (SITUATIONAL_USE_VALUES.includes(cleanValue)) {
      normalized.add(cleanValue);
    }
  }

  return Array.from(normalized).sort();
}

function buildDefaultMinistryMetadata() {
  return {
    leaderReadiness: "unknown",
    strength: "unknown",
    feelsDated: "unknown",
    situationalUse: [],
    developmentPotential: "unknown"
  };
}

function normalizeSongMinistryMetadata(value = {}) {
  const metadata = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    leaderReadiness: normalizeEnumValue(
      metadata.leaderReadiness,
      LEADER_READINESS_VALUES
    ),
    strength: normalizeEnumValue(metadata.strength, STRENGTH_VALUES),
    feelsDated: normalizeEnumValue(metadata.feelsDated, FEELS_DATED_VALUES),
    situationalUse: normalizeSituationalUse(metadata.situationalUse),
    developmentPotential: normalizeEnumValue(
      metadata.developmentPotential,
      DEVELOPMENT_POTENTIAL_VALUES
    )
  };
}

const SLICE2_MINISTRY_METADATA_SAMPLE = Object.freeze({
  "rejoice-0095": {
    leaderReadiness: "ready_now",
    strength: "solid_rotation",
    feelsDated: "mixed",
    situationalUse: ["invitation"],
    developmentPotential: "medium"
  },
  "rejoice-0169": {
    leaderReadiness: "learnable_soon",
    strength: "situational",
    feelsDated: "no",
    situationalUse: ["reflective"],
    developmentPotential: "high"
  },
  "rejoice-0381": {
    leaderReadiness: "ready_now",
    strength: "core",
    feelsDated: "no",
    situationalUse: ["invitation", "reflective"],
    developmentPotential: "medium"
  },
  "rejoice-0405": {
    leaderReadiness: "learnable_soon",
    strength: "solid_rotation",
    feelsDated: "no",
    situationalUse: ["invitation", "reflective"],
    developmentPotential: "high"
  },
  "rejoice-0519": {
    leaderReadiness: "ready_now",
    strength: "solid_rotation",
    feelsDated: "no",
    situationalUse: ["reflective", "revival"],
    developmentPotential: "medium"
  },
  "rejoice-0636": {
    leaderReadiness: "ready_now",
    strength: "core",
    feelsDated: "yes",
    situationalUse: ["revival"],
    developmentPotential: "low"
  }
});

async function seedSlice2MinistryMetadataToCollection(
  {
    metadataBySongId = SLICE2_MINISTRY_METADATA_SAMPLE,
    updatedAt = new Date().toISOString()
  } = {},
  {
    songsCollection
  } = {}
) {
  if (!songsCollection || typeof songsCollection.doc !== "function") {
    throw new Error("songsCollection with doc() is required");
  }

  const updatedSongIds = [];
  const skippedMissingSongIds = [];

  for (const [songId, metadata] of Object.entries(metadataBySongId)) {
    const docRef = songsCollection.doc(songId);
    const existingDoc = await docRef.get();

    if (!existingDoc.exists) {
      skippedMissingSongIds.push(songId);
      continue;
    }

    const existingSong = existingDoc.data() || {};
    await docRef.set({
      ...existingSong,
      ministryMetadata: normalizeSongMinistryMetadata(metadata),
      updatedAt
    });
    updatedSongIds.push(songId);
  }

  return {
    updatedSongIds,
    skippedMissingSongIds,
    totalRequested: Object.keys(metadataBySongId).length,
    totalUpdated: updatedSongIds.length,
    totalMissing: skippedMissingSongIds.length
  };
}

module.exports = {
  buildDefaultMinistryMetadata,
  DEVELOPMENT_POTENTIAL_VALUES,
  FEELS_DATED_VALUES,
  LEADER_READINESS_VALUES,
  normalizeSongMinistryMetadata,
  normalizeSituationalUse,
  seedSlice2MinistryMetadataToCollection,
  SITUATIONAL_USE_VALUES,
  SLICE2_MINISTRY_METADATA_SAMPLE,
  STRENGTH_VALUES
};
