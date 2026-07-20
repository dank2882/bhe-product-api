"use strict";

const SONG_MINISTRY_PLANNING_SCHEMA_VERSION = "song-ministry-planning-v1";

const SONG_USE_STATUS_VALUES = Object.freeze([
  "active",
  "do_not_use",
  "inactive",
  "unknown"
]);

const PLANNING_USAGE_ROLE_VALUES = Object.freeze([
  "congregational",
  "invitation",
  "choir_opener",
  "choir_special",
  "special_music",
  "offertory",
  "instrumental",
  "prelude",
  "postlude",
  "chorus_append"
]);

const SEASONAL_USE_VALUES = Object.freeze([
  "christmas",
  "easter",
  "thanksgiving",
  "patriotic",
  "revival",
  "missions",
  "children",
  "military",
  "funeral",
  "wedding",
  "new_year",
  "communion",
  "mother_day",
  "father_day",
  "dedication_of_children",
  "baptism"
]);

const PLANNING_LEADER_READINESS_VALUES = Object.freeze([
  "ready_now",
  "learnable_soon",
  "not_ready",
  "unknown"
]);

const LEARNING_INTEREST_VALUES = Object.freeze([
  "interested",
  "maybe",
  "not_interested",
  "unknown"
]);

const CONGREGATION_FIT_VALUES = Object.freeze([
  "strong",
  "usable",
  "situational",
  "weak",
  "unknown"
]);

const SONG_ENERGY_VALUES = Object.freeze([
  "upbeat",
  "bright",
  "steady",
  "reflective",
  "solemn",
  "triumphant",
  "tender",
  "unknown"
]);

const SONG_TEMPO_VALUES = Object.freeze([
  "fast",
  "moderate",
  "slow",
  "mixed",
  "unknown"
]);

const SERVICE_FIT_VALUES = Object.freeze([
  "sunday_morning",
  "sunday_evening",
  "midweek",
  "special_service"
]);

const ROTATION_STRENGTH_VALUES = Object.freeze([
  "core",
  "solid_rotation",
  "situational",
  "rare",
  "unknown"
]);

const LEADER_READINESS_ALIASES = Object.freeze({
  ready: "ready_now",
  know: "ready_now",
  known: "ready_now",
  knows: "ready_now",
  know_it: "ready_now",
  ready_to_lead: "ready_now",
  dont_know: "not_ready",
  do_not_know: "not_ready",
  not_known: "not_ready",
  not_learned: "not_ready",
  need_to_learn: "not_ready"
});

const LEARNING_INTEREST_ALIASES = Object.freeze({
  yes: "interested",
  want_to_learn: "interested",
  would_learn: "interested",
  willing: "interested",
  no: "not_interested",
  dont_want_to_learn: "not_interested",
  do_not_want_to_learn: "not_interested",
  would_not_learn: "not_interested",
  probably_would_not_learn: "not_interested",
  not_worth_learning: "not_interested",
  unsure: "maybe"
});

const ROTATION_STRENGTH_ALIASES = Object.freeze({
  regular: "solid_rotation",
  normal: "solid_rotation",
  occasional: "situational",
  sometimes: "situational",
  very_rare: "rare",
  rarely: "rare"
});

const SERVICE_FIT_ALIASES = Object.freeze({
  good_sunday_morning: "sunday_morning",
  sunday_morning: "sunday_morning",
  morning_service: "sunday_morning",
  sunday_am: "sunday_morning",
  sunday_evening: "sunday_evening",
  evening_service: "sunday_evening",
  sunday_pm: "sunday_evening",
  midweek_service: "midweek",
  wednesday: "midweek",
  wednesday_night: "midweek",
  special: "special_service"
});

const SEASONAL_USE_ALIASES = Object.freeze({
  missions_and_evangelism: "missions",
  childrens_songs: "children",
  children_s_songs: "children",
  child_dedication: "dedication_of_children",
  baby_dedication: "dedication_of_children",
  mother_s_day: "mother_day",
  mothers_day: "mother_day",
  father_s_day: "father_day",
  fathers_day: "father_day",
  military_theme: "military"
});

const TEMPO_ALIASES = Object.freeze({
  upbeat: "fast",
  up_tempo: "fast",
  uptempo: "fast",
  quick: "fast",
  brisk: "fast",
  medium: "moderate",
  med: "moderate",
  moderate_tempo: "moderate",
  slower: "slow",
  slow_tempo: "slow",
  meditative: "slow"
});

const STANDARD_ACTIVE_POOL_TOPIC_ALIASES = Object.freeze({
  christmas: "christmas",
  easter: "easter",
  thanksgiving: "thanksgiving",
  patriotic: "patriotic",
  missions_and_evangelism: "missions",
  children_s_songs: "children",
  childrens_songs: "children",
  wedding: "wedding",
  funeral_and_memorial: "funeral",
  communion: "communion",
  new_year: "new_year",
  father_s_day: "father_day",
  fathers_day: "father_day",
  mother_s_day: "mother_day",
  mothers_day: "mother_day",
  dedication_of_children: "dedication_of_children",
  baptism: "baptism",
  choruses: "chorus",
  chorus: "chorus"
});

const STANDARD_ACTIVE_POOL_OCCASION_VALUES = Object.freeze([
  "christmas",
  "easter",
  "thanksgiving",
  "patriotic",
  "missions",
  "children",
  "military",
  "funeral",
  "wedding",
  "new_year",
  "communion",
  "mother_day",
  "father_day",
  "dedication_of_children",
  "baptism"
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeEnumValue(value, allowedValues, fallbackValue = "unknown", aliases = {}) {
  const normalized = normalizeToken(value);
  const aliased = aliases[normalized] || normalized;
  return allowedValues.includes(aliased) ? aliased : fallbackValue;
}

function normalizeTokenList(value, allowedValues = null, aliases = {}) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = new Set();

  for (const item of values) {
    const rawToken = normalizeToken(item);
    const token = aliases[rawToken] || rawToken;
    if (!token) {
      continue;
    }

    if (Array.isArray(allowedValues) && !allowedValues.includes(token)) {
      continue;
    }

    normalized.add(token);
  }

  return Array.from(normalized).sort();
}

function normalizeLeaderReadinessMap(value) {
  return normalizeLeaderValueMap(
    value,
    PLANNING_LEADER_READINESS_VALUES,
    LEADER_READINESS_ALIASES
  );
}

function normalizeLearningInterestMap(value) {
  return normalizeLeaderValueMap(
    value,
    LEARNING_INTEREST_VALUES,
    LEARNING_INTEREST_ALIASES
  );
}

function normalizeLeaderValueMap(value, allowedValues, aliases = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};

  for (const [leaderKey, readinessValue] of Object.entries(value)) {
    const cleanLeaderKey = normalizeToken(leaderKey);
    if (!cleanLeaderKey) {
      continue;
    }

    normalized[cleanLeaderKey] = normalizeEnumValue(
      readinessValue,
      allowedValues,
      "unknown",
      aliases
    );
  }

  return Object.fromEntries(
    Object.entries(normalized).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    )
  );
}

function normalizePlanningNotes(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const entries = Object.entries(value)
    .map(([noteKey, noteValue]) => [
      normalizeToken(noteKey),
      normalizeString(noteValue)
    ])
    .filter(([, noteValue]) => noteValue);

  if (entries.length === 0) {
    return "";
  }

  if (entries.length === 1 && entries[0][0] === "dan") {
    return entries[0][1];
  }

  return entries
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([noteKey, noteValue]) => noteKey ? `${noteKey}: ${noteValue}` : noteValue)
    .join(" ");
}

function normalizeRotationStrength(planning) {
  return normalizeEnumValue(
    planning.rotationStrength || planning.localUseFrequency,
    ROTATION_STRENGTH_VALUES,
    "unknown",
    ROTATION_STRENGTH_ALIASES
  );
}

function normalizeServiceFitList(planning) {
  const normalized = new Set(normalizeTokenList(planning.serviceFit, SERVICE_FIT_VALUES));
  const legacyToken = normalizeToken(planning.localUseFrequency);
  const legacyServiceFit = SERVICE_FIT_ALIASES[legacyToken];

  if (legacyServiceFit) {
    normalized.add(legacyServiceFit);
  }

  return Array.from(normalized).sort();
}

function normalizeSeasonalUseList(value) {
  return normalizeTokenList(value, SEASONAL_USE_VALUES, SEASONAL_USE_ALIASES);
}

function normalizeSongTempo(value) {
  return normalizeEnumValue(value, SONG_TEMPO_VALUES, "unknown", TEMPO_ALIASES);
}

function normalizeTopicPlanningToken(value) {
  const token = normalizeToken(value);
  return STANDARD_ACTIVE_POOL_TOPIC_ALIASES[token] || token;
}

function buildDefaultSongMinistryPlanning() {
  return {
    schemaVersion: SONG_MINISTRY_PLANNING_SCHEMA_VERSION,
    useStatus: "unknown",
    allowedUsageRoles: [],
    blockedUsageRoles: [],
    seasonalUse: [],
    worshipFunctions: [],
    serviceFit: [],
    leaderReadiness: {},
    learningInterest: {},
    congregationFit: "unknown",
    energy: "unknown",
    tempo: "unknown",
    rotationStrength: "unknown",
    blockReason: "",
    notes: ""
  };
}

function normalizeSongMinistryPlanning(value = {}) {
  const planning = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

  return {
    schemaVersion: normalizeString(planning.schemaVersion) || SONG_MINISTRY_PLANNING_SCHEMA_VERSION,
    useStatus: normalizeEnumValue(planning.useStatus, SONG_USE_STATUS_VALUES),
    allowedUsageRoles: normalizeTokenList(
      planning.allowedUsageRoles,
      PLANNING_USAGE_ROLE_VALUES
    ),
    blockedUsageRoles: normalizeTokenList(
      planning.blockedUsageRoles,
      PLANNING_USAGE_ROLE_VALUES
    ),
    seasonalUse: normalizeSeasonalUseList(planning.seasonalUse),
    worshipFunctions: normalizeTokenList(planning.worshipFunctions),
    serviceFit: normalizeServiceFitList(planning),
    leaderReadiness: normalizeLeaderReadinessMap(planning.leaderReadiness),
    learningInterest: normalizeLearningInterestMap(planning.learningInterest),
    congregationFit: normalizeEnumValue(
      planning.congregationFit,
      CONGREGATION_FIT_VALUES
    ),
    energy: normalizeEnumValue(planning.energy, SONG_ENERGY_VALUES),
    tempo: normalizeSongTempo(planning.tempo),
    rotationStrength: normalizeRotationStrength(planning),
    blockReason: normalizeString(planning.blockReason),
    notes: normalizePlanningNotes(planning.notes)
  };
}

function evaluateSongActiveCongregationalPool(song = {}, options = {}) {
  const planning = normalizeSongMinistryPlanning(song.ministryPlanning || song);
  const usageRole = normalizeToken(options.usageRole) || "congregational";
  const leaderId = normalizeToken(options.leaderId || options.leaderKey) || "dan";
  const requireRejoiceHymnal = options.requireRejoiceHymnal !== false;
  const excludeOccasionOnly = options.excludeOccasionOnly !== false;
  const blockedReasons = [];
  const warnings = [];

  if (
    requireRejoiceHymnal &&
    song.songId &&
    !normalizeString(song.songId).startsWith("rejoice-")
  ) {
    blockedReasons.push("not_rejoice_hymnal");
  }

  if (planning.useStatus === "do_not_use") {
    blockedReasons.push("use_status_do_not_use");
  }

  if (planning.useStatus === "inactive") {
    blockedReasons.push("use_status_inactive");
  }

  if (planning.leaderReadiness[leaderId] !== "ready_now") {
    blockedReasons.push("leader_not_ready");
  }

  if (
    planning.allowedUsageRoles.length > 0 &&
    !planning.allowedUsageRoles.includes(usageRole)
  ) {
    blockedReasons.push("usage_role_not_allowed");
  }

  if (planning.blockedUsageRoles.includes(usageRole)) {
    blockedReasons.push("usage_role_blocked");
  }

  const topicTokens = (Array.isArray(song.topics) ? song.topics : [])
    .map(normalizeTopicPlanningToken)
    .filter(Boolean);
  const seasonalTokens = planning.seasonalUse.map(normalizeTopicPlanningToken);

  if (
    planning.worshipFunctions.includes("chorus_append") ||
    topicTokens.includes("chorus")
  ) {
    blockedReasons.push("chorus_or_append");
  }

  if (excludeOccasionOnly) {
    if (seasonalTokens.some((value) => STANDARD_ACTIVE_POOL_OCCASION_VALUES.includes(value))) {
      blockedReasons.push("seasonal_or_occasion_only");
    } else if (topicTokens.some((value) => STANDARD_ACTIVE_POOL_OCCASION_VALUES.includes(value))) {
      blockedReasons.push("occasion_topic");
    }
  }

  if (planning.useStatus === "unknown") {
    warnings.push("use_status_unknown");
  }

  if (planning.rotationStrength === "rare") {
    warnings.push("rare_rotation");
  }

  if (planning.energy === "unknown") {
    warnings.push("energy_unknown");
  }

  if (planning.tempo === "unknown") {
    warnings.push("tempo_unknown");
  }

  if (planning.congregationFit === "unknown") {
    warnings.push("congregation_fit_unknown");
  }

  return {
    active: blockedReasons.length === 0,
    blockedReasons: Array.from(new Set(blockedReasons)),
    warnings: Array.from(new Set(warnings)),
    planning
  };
}

function normalizePlanningContext(context = {}) {
  const planningContext = context && typeof context === "object" && !Array.isArray(context)
    ? context
    : {};

  return {
    usageRole: normalizeToken(planningContext.usageRole),
    season: normalizeToken(planningContext.season),
    leaderId: normalizeToken(planningContext.leaderId || planningContext.leaderKey)
  };
}

function evaluateSongPlanningGuardrails(songOrPlanning = {}, context = {}) {
  const planning = normalizeSongMinistryPlanning(
    songOrPlanning.ministryPlanning || songOrPlanning
  );
  const planningContext = normalizePlanningContext(context);
  const blockedReasons = [];
  const warnings = [];

  if (planning.useStatus === "do_not_use") {
    blockedReasons.push("use_status_do_not_use");
  }

  if (planning.useStatus === "inactive") {
    blockedReasons.push("use_status_inactive");
  }

  if (
    planningContext.usageRole &&
    planning.allowedUsageRoles.length > 0 &&
    !planning.allowedUsageRoles.includes(planningContext.usageRole)
  ) {
    blockedReasons.push("usage_role_not_allowed");
  }

  if (
    planningContext.usageRole &&
    planning.blockedUsageRoles.includes(planningContext.usageRole)
  ) {
    blockedReasons.push("usage_role_blocked");
  }

  if (
    planningContext.season &&
    planning.seasonalUse.length > 0 &&
    !planning.seasonalUse.includes(planningContext.season)
  ) {
    blockedReasons.push("season_not_allowed");
  }

  const leaderReadiness = planning.leaderReadiness[planningContext.leaderId];
  if (leaderReadiness === "not_ready") {
    blockedReasons.push("leader_not_ready");
  } else if (leaderReadiness === "learnable_soon") {
    warnings.push("leader_learnable_soon");
  }

  if (planning.useStatus === "unknown") {
    warnings.push("use_status_unknown");
  }

  return {
    allowed: blockedReasons.length === 0,
    blockedReasons,
    warnings,
    planning
  };
}

module.exports = {
  buildDefaultSongMinistryPlanning,
  CONGREGATION_FIT_VALUES,
  evaluateSongActiveCongregationalPool,
  evaluateSongPlanningGuardrails,
  LEARNING_INTEREST_VALUES,
  normalizePlanningContext,
  normalizeSongMinistryPlanning,
  PLANNING_LEADER_READINESS_VALUES,
  PLANNING_USAGE_ROLE_VALUES,
  ROTATION_STRENGTH_VALUES,
  SERVICE_FIT_VALUES,
  SEASONAL_USE_VALUES,
  SONG_ENERGY_VALUES,
  SONG_MINISTRY_PLANNING_SCHEMA_VERSION,
  SONG_TEMPO_VALUES,
  SONG_USE_STATUS_VALUES
};
