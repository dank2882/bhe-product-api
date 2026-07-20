"use strict";

const { writeServiceAssignmentsToGoogleSheet } = require("./google-sheet-service-assignment-writer");

const PIANIST_PROFILE_SCHEMA_VERSION = "pianist-profile-v1";
const SERVICE_PIANO_PLAN_SCHEMA_VERSION = "service-piano-plan-v1";
const DEFAULT_MONTHLY_SERVICE_LIMIT = 6;

const PIANIST_CAPABILITY_LEVELS = Object.freeze([
  "piano_1",
  "piano_2",
  "developing",
  "not_schedulable"
]);

const PIANIST_STATUS_VALUES = Object.freeze(["active", "inactive"]);
const AVAILABILITY_VALUES = Object.freeze(["available", "unavailable"]);

const PIANO_POSITION_DEFINITIONS = Object.freeze({
  piano_1: Object.freeze({
    position: "piano_1",
    label: "Piano 1",
    required: true,
    capabilityLevel: "piano_1",
    duties: Object.freeze(["prelude", "congregational", "invitation", "postlude"])
  }),
  piano_2: Object.freeze({
    position: "piano_2",
    label: "Piano 2",
    required: false,
    capabilityLevel: "piano_2",
    duties: Object.freeze(["congregational"])
  }),
  piano_3: Object.freeze({
    position: "piano_3",
    label: "Piano 3",
    required: false,
    capabilityLevel: "developing",
    duties: Object.freeze(["congregational"])
  }),
  piano_4: Object.freeze({
    position: "piano_4",
    label: "Piano 4",
    required: false,
    capabilityLevel: "developing",
    duties: Object.freeze(["congregational"])
  })
});

const CAPABILITY_ELIGIBLE_POSITIONS = Object.freeze({
  piano_1: Object.freeze(["piano_1"]),
  piano_2: Object.freeze(["piano_2"]),
  developing: Object.freeze(["piano_3", "piano_4"]),
  not_schedulable: Object.freeze([])
});

function createPianistPlanningError(message, statusCode = 400, code = "pianist_planning_error", details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

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

function normalizeServiceType(value) {
  const token = normalizeToken(value);
  if (["sunday_evening", "sunday_pm"].includes(token)) return "sunday_night";
  if (["wednesday_evening", "midweek"].includes(token)) return "wednesday_night";
  return token;
}

function normalizeDate(value, fieldName = "date", { optional = false } = {}) {
  const cleanValue = normalizeString(value);
  if (!cleanValue && optional) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    throw createPianistPlanningError(`Invalid ${fieldName}`, 400, "invalid_pianist_planning_date", {
      field: fieldName,
      value
    });
  }
  const parsed = new Date(`${cleanValue}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== cleanValue) {
    throw createPianistPlanningError(`Invalid ${fieldName}`, 400, "invalid_pianist_planning_date", {
      field: fieldName,
      value
    });
  }
  return cleanValue;
}

function normalizeMonth(value, { optional = false } = {}) {
  const cleanValue = normalizeString(value);
  if (!cleanValue && optional) return "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanValue)) {
    throw createPianistPlanningError("Invalid month", 400, "invalid_pianist_planning_month", { value });
  }
  return cleanValue;
}

function normalizeEnum(value, allowedValues, fieldName, fallback = "") {
  const token = normalizeToken(value);
  if (!token && fallback) return fallback;
  if (!allowedValues.includes(token)) {
    throw createPianistPlanningError(`Invalid ${fieldName}`, 400, "invalid_pianist_planning_value", {
      field: fieldName,
      value,
      allowedValues
    });
  }
  return token;
}

function normalizeCapabilityLevel(value, fallback = "not_schedulable") {
  const aliases = {
    piano1: "piano_1",
    piano_1_ready: "piano_1",
    piano2: "piano_2",
    piano_2_ready: "piano_2",
    piano_3: "developing",
    piano_4: "developing",
    learner: "developing",
    learning: "developing",
    inactive: "not_schedulable"
  };
  const token = normalizeToken(value);
  return normalizeEnum(aliases[token] || token || fallback, PIANIST_CAPABILITY_LEVELS, "capabilityLevel");
}

function normalizePosition(value) {
  const token = normalizeToken(value).replace(/^piano([1-4])$/, "piano_$1");
  if (!PIANO_POSITION_DEFINITIONS[token]) {
    throw createPianistPlanningError("Invalid piano position", 400, "invalid_piano_position", {
      value,
      allowedPositions: Object.keys(PIANO_POSITION_DEFINITIONS)
    });
  }
  return token;
}

function normalizeIntegerList(value, { min, max, fieldName }) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const normalized = [];
  for (const item of values) {
    const parsed = Number(item);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw createPianistPlanningError(`Invalid ${fieldName}`, 400, "invalid_availability_rule", {
        field: fieldName,
        value: item,
        min,
        max
      });
    }
    if (!normalized.includes(parsed)) normalized.push(parsed);
  }
  return normalized.sort((left, right) => left - right);
}

function normalizeTokenList(value, normalizer = normalizeToken) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return Array.from(new Set(values.map(normalizer).filter(Boolean))).sort();
}

function normalizeRecurringRule(rule = {}, index = 0) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw createPianistPlanningError("Invalid recurring availability rule", 400, "invalid_availability_rule", { index });
  }
  const intervalWeeks = rule.intervalWeeks === undefined || rule.intervalWeeks === null
    ? null
    : Number(rule.intervalWeeks);
  if (intervalWeeks !== null && (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 52)) {
    throw createPianistPlanningError("Invalid recurring intervalWeeks", 400, "invalid_availability_rule", {
      index,
      intervalWeeks: rule.intervalWeeks
    });
  }
  const anchorDate = normalizeDate(rule.anchorDate, "anchorDate", { optional: true });
  if (intervalWeeks !== null && !anchorDate) {
    throw createPianistPlanningError(
      "anchorDate is required when intervalWeeks is used",
      400,
      "missing_availability_anchor_date",
      { index }
    );
  }
  return {
    ruleId: normalizeString(rule.ruleId) || `rule-${index + 1}`,
    available: rule.available !== false,
    serviceTypes: normalizeTokenList(rule.serviceTypes || rule.serviceType, normalizeServiceType),
    weeksOfMonth: normalizeIntegerList(rule.weeksOfMonth, { min: 1, max: 5, fieldName: "weeksOfMonth" }),
    weekdays: normalizeIntegerList(rule.weekdays, { min: 0, max: 6, fieldName: "weekdays" }),
    months: normalizeIntegerList(rule.months, { min: 1, max: 12, fieldName: "months" }),
    intervalWeeks,
    anchorDate,
    effectiveFrom: normalizeDate(rule.effectiveFrom, "effectiveFrom", { optional: true }),
    effectiveTo: normalizeDate(rule.effectiveTo, "effectiveTo", { optional: true }),
    notes: normalizeString(rule.notes)
  };
}

function normalizeAvailabilityException(exception = {}, index = 0) {
  if (!exception || typeof exception !== "object" || Array.isArray(exception)) {
    throw createPianistPlanningError("Invalid availability exception", 400, "invalid_availability_exception", { index });
  }
  return {
    serviceDate: normalizeDate(exception.serviceDate || exception.date, "serviceDate"),
    serviceTypes: normalizeTokenList(exception.serviceTypes || exception.serviceType, normalizeServiceType),
    available: exception.available === true,
    reason: normalizeString(exception.reason)
  };
}

function profileIdFromName(displayName) {
  const token = normalizeToken(displayName);
  if (!token) {
    throw createPianistPlanningError("displayName is required", 400, "missing_pianist_display_name");
  }
  return `pianist-${token}`;
}

function getNowIso(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeProfileRecord(profile = {}, docId = "") {
  const capabilityLevel = normalizeCapabilityLevel(profile.capabilityLevel);
  const monthlyServiceLimit = Number(profile.monthlyServiceLimit ?? DEFAULT_MONTHLY_SERVICE_LIMIT);
  return {
    schemaVersion: PIANIST_PROFILE_SCHEMA_VERSION,
    pianistId: normalizeString(profile.pianistId || docId),
    displayName: normalizeString(profile.displayName),
    status: normalizeEnum(profile.status || "active", PIANIST_STATUS_VALUES, "status"),
    capabilityLevel,
    eligiblePositions: [...CAPABILITY_ELIGIBLE_POSITIONS[capabilityLevel]],
    defaultAvailability: normalizeEnum(
      profile.defaultAvailability || "unavailable",
      AVAILABILITY_VALUES,
      "defaultAvailability"
    ),
    recurringRules: (Array.isArray(profile.recurringRules) ? profile.recurringRules : [])
      .map(normalizeRecurringRule),
    availabilityExceptions: (Array.isArray(profile.availabilityExceptions) ? profile.availabilityExceptions : [])
      .map(normalizeAvailabilityException),
    regularScheduleNotes: normalizeString(profile.regularScheduleNotes),
    monthlyServiceLimit: Number.isInteger(monthlyServiceLimit) && monthlyServiceLimit >= 1 && monthlyServiceLimit <= 31
      ? monthlyServiceLimit
      : DEFAULT_MONTHLY_SERVICE_LIMIT,
    notes: normalizeString(profile.notes),
    createdAt: normalizeString(profile.createdAt),
    updatedAt: normalizeString(profile.updatedAt),
    changedBy: normalizeString(profile.changedBy)
  };
}

function getDateParts(serviceDate) {
  const date = new Date(`${serviceDate}T12:00:00.000Z`);
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    weekday: date.getUTCDay(),
    weekOfMonth: Math.ceil(date.getUTCDate() / 7),
    timeMs: date.getTime()
  };
}

function ruleMatchesService(rule, serviceDate, serviceType) {
  const parts = getDateParts(serviceDate);
  if (rule.serviceTypes.length > 0 && !rule.serviceTypes.includes(serviceType)) return false;
  if (rule.weeksOfMonth.length > 0 && !rule.weeksOfMonth.includes(parts.weekOfMonth)) return false;
  if (rule.weekdays.length > 0 && !rule.weekdays.includes(parts.weekday)) return false;
  if (rule.months.length > 0 && !rule.months.includes(parts.month)) return false;
  if (rule.effectiveFrom && serviceDate < rule.effectiveFrom) return false;
  if (rule.effectiveTo && serviceDate > rule.effectiveTo) return false;
  if (rule.intervalWeeks !== null) {
    const anchorMs = getDateParts(rule.anchorDate).timeMs;
    const elapsedDays = Math.round((parts.timeMs - anchorMs) / 86400000);
    if (elapsedDays < 0 || elapsedDays % 7 !== 0 || (elapsedDays / 7) % rule.intervalWeeks !== 0) return false;
  }
  return true;
}

function evaluatePianistAvailability(profileInput, serviceDateInput, serviceTypeInput) {
  const profile = normalizeProfileRecord(profileInput, profileInput?.pianistId);
  const serviceDate = normalizeDate(serviceDateInput, "serviceDate");
  const serviceType = normalizeServiceType(serviceTypeInput);
  if (!serviceType) {
    throw createPianistPlanningError("serviceType is required", 400, "missing_service_type");
  }
  if (profile.status !== "active" || profile.capabilityLevel === "not_schedulable") {
    return { available: false, source: "profile_status", matchedRuleIds: [], reason: "Pianist is not currently schedulable." };
  }

  const matchingExceptions = profile.availabilityExceptions.filter((exception) =>
    exception.serviceDate === serviceDate &&
    (exception.serviceTypes.length === 0 || exception.serviceTypes.includes(serviceType))
  );
  if (matchingExceptions.length > 0) {
    const selected = matchingExceptions.find((exception) => exception.available === false) || matchingExceptions[0];
    return {
      available: selected.available,
      source: "date_exception",
      matchedRuleIds: [],
      reason: selected.reason
    };
  }

  const matchingRules = profile.recurringRules.filter((rule) => ruleMatchesService(rule, serviceDate, serviceType));
  if (matchingRules.length > 0) {
    const available = !matchingRules.some((rule) => rule.available === false);
    return {
      available,
      source: "recurring_rule",
      matchedRuleIds: matchingRules.map((rule) => rule.ruleId),
      reason: matchingRules.map((rule) => rule.notes).filter(Boolean).join("; ")
    };
  }

  return {
    available: profile.defaultAvailability === "available",
    source: "default",
    matchedRuleIds: [],
    reason: ""
  };
}

async function savePianistProfile(input = {}, deps = {}) {
  const collection = deps.pianistsCollection;
  if (!collection?.doc) {
    throw createPianistPlanningError("Pianist storage is not configured", 500, "pianist_storage_not_configured");
  }
  const requestedId = normalizeString(input.pianistId);
  const initialDisplayName = normalizeString(input.displayName);
  const pianistId = requestedId || profileIdFromName(initialDisplayName);
  const docRef = collection.doc(pianistId);
  const existingDoc = await docRef.get();
  const existing = existingDoc.exists ? normalizeProfileRecord(existingDoc.data() || {}, pianistId) : null;
  const displayName = initialDisplayName || existing?.displayName || "";
  if (!displayName) {
    throw createPianistPlanningError("displayName is required", 400, "missing_pianist_display_name");
  }
  const monthlyServiceLimit = input.monthlyServiceLimit === undefined
    ? existing?.monthlyServiceLimit ?? DEFAULT_MONTHLY_SERVICE_LIMIT
    : Number(input.monthlyServiceLimit);
  if (!Number.isInteger(monthlyServiceLimit) || monthlyServiceLimit < 1 || monthlyServiceLimit > 31) {
    throw createPianistPlanningError(
      "monthlyServiceLimit must be an integer from 1 to 31",
      400,
      "invalid_monthly_service_limit",
      { monthlyServiceLimit: input.monthlyServiceLimit }
    );
  }
  const now = getNowIso(deps);
  const profile = normalizeProfileRecord({
    ...existing,
    pianistId,
    displayName,
    status: input.status ?? existing?.status ?? "active",
    capabilityLevel: input.capabilityLevel ?? existing?.capabilityLevel ?? "not_schedulable",
    defaultAvailability: input.defaultAvailability ?? existing?.defaultAvailability ?? "unavailable",
    recurringRules: input.recurringRules ?? existing?.recurringRules ?? [],
    availabilityExceptions: input.availabilityExceptions ?? existing?.availabilityExceptions ?? [],
    regularScheduleNotes: input.regularScheduleNotes ?? existing?.regularScheduleNotes ?? "",
    monthlyServiceLimit,
    notes: input.notes ?? existing?.notes ?? "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    changedBy: normalizeString(input.changedBy) || "ministry-planning-dispatcher"
  }, pianistId);

  await docRef.set(profile);
  return { created: !existingDoc.exists, profile };
}

async function getServiceRecord(serviceId, deps) {
  const cleanServiceId = normalizeString(serviceId);
  if (!cleanServiceId) {
    throw createPianistPlanningError("serviceId is required", 400, "missing_service_id");
  }
  const doc = await deps.servicesCollection.doc(cleanServiceId).get();
  if (!doc.exists) {
    throw createPianistPlanningError("Service not found", 404, "service_not_found", { serviceId: cleanServiceId });
  }
  const service = doc.data() || {};
  return {
    serviceId: cleanServiceId,
    serviceDate: normalizeDate(service.serviceDate, "serviceDate"),
    serviceType: normalizeServiceType(service.serviceType),
      title: normalizeString(service.title),
      sourceSheetName: normalizeString(service.sourceSheetName),
      sourceRowNumber: Number.isInteger(service.sourceRowNumber) ? service.sourceRowNumber : null,
      sourceCell: normalizeString(service.sourceCell),
      planningStatus: normalizeString(service.planningStatus),
    actualStatus: normalizeString(service.actualStatus)
  };
}

async function loadProfiles(deps) {
  const snapshot = await deps.pianistsCollection.limit(1000).get();
  return snapshot.docs.map((doc) => normalizeProfileRecord(doc.data() || {}, doc.id));
}

async function listPianists(input = {}, deps = {}) {
  let profiles = await loadProfiles(deps);
  const pianistId = normalizeString(input.pianistId);
  const capabilityLevel = input.capabilityLevel ? normalizeCapabilityLevel(input.capabilityLevel) : "";
  const status = input.status ? normalizeEnum(input.status, PIANIST_STATUS_VALUES, "status") : "";
  if (pianistId) profiles = profiles.filter((profile) => profile.pianistId === pianistId);
  if (capabilityLevel) profiles = profiles.filter((profile) => profile.capabilityLevel === capabilityLevel);
  if (status) profiles = profiles.filter((profile) => profile.status === status);
  if (input.includeInactive !== true && !status) profiles = profiles.filter((profile) => profile.status === "active");

  let serviceDate = normalizeDate(input.serviceDate, "serviceDate", { optional: true });
  let serviceType = normalizeServiceType(input.serviceType);
  let service = null;
  if (input.serviceId) {
    service = await getServiceRecord(input.serviceId, deps);
    serviceDate = service.serviceDate;
    serviceType = service.serviceType;
  }
  if ((serviceDate && !serviceType) || (!serviceDate && serviceType)) {
    throw createPianistPlanningError(
      "serviceDate and serviceType must be provided together",
      400,
      "incomplete_availability_context"
    );
  }
  const resultProfiles = profiles
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((profile) => serviceDate
      ? { ...profile, availability: evaluatePianistAvailability(profile, serviceDate, serviceType) }
      : profile);
  return {
    count: resultProfiles.length,
    service,
    positionDefinitions: Object.values(PIANO_POSITION_DEFINITIONS),
    profiles: resultProfiles
  };
}

function monthRange(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { dateFrom: `${month}-01`, dateTo: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function monthFromIsoDate(value) {
  return value.slice(0, 7);
}

async function getPianistWorkload(input = {}, deps = {}) {
  const now = getNowIso(deps);
  const month = normalizeMonth(input.month || now.slice(0, 7));
  const defaultRange = monthRange(month);
  const dateFrom = normalizeDate(input.dateFrom || defaultRange.dateFrom, "dateFrom");
  const dateTo = normalizeDate(input.dateTo || defaultRange.dateTo, "dateTo");
  if (dateFrom > dateTo) {
    throw createPianistPlanningError("dateFrom must be on or before dateTo", 400, "invalid_workload_date_range");
  }
  const [profiles, plansSnapshot] = await Promise.all([
    loadProfiles(deps),
    deps.servicePianoPlansCollection.limit(5000).get()
  ]);
  const requestedPianistId = normalizeString(input.pianistId);
  const profileById = new Map(profiles.map((profile) => [profile.pianistId, profile]));
  const aggregateById = new Map();

  for (const planDoc of plansSnapshot.docs) {
    const plan = planDoc.data() || {};
    const serviceDate = normalizeString(plan.serviceDate);
    if (serviceDate < dateFrom || serviceDate > dateTo) continue;
    for (const assignment of Array.isArray(plan.assignments) ? plan.assignments : []) {
      const pianistId = normalizeString(assignment.pianistId);
      if (!pianistId || (requestedPianistId && requestedPianistId !== pianistId)) continue;
      const position = normalizePosition(assignment.position);
      if (!aggregateById.has(pianistId)) {
        aggregateById.set(pianistId, {
          pianistId,
          displayName: normalizeString(assignment.displayName),
          totalServices: 0,
          positionCounts: { piano_1: 0, piano_2: 0, piano_3: 0, piano_4: 0 },
          monthCounts: {},
          assignments: []
        });
      }
      const aggregate = aggregateById.get(pianistId);
      aggregate.totalServices += 1;
      aggregate.positionCounts[position] += 1;
      const assignmentMonth = monthFromIsoDate(serviceDate);
      aggregate.monthCounts[assignmentMonth] = (aggregate.monthCounts[assignmentMonth] || 0) + 1;
      aggregate.assignments.push({
        serviceId: normalizeString(plan.serviceId || planDoc.id),
        serviceDate,
        serviceType: normalizeServiceType(plan.serviceType),
        position,
        duties: [...PIANO_POSITION_DEFINITIONS[position].duties]
      });
    }
  }

  if (requestedPianistId && !aggregateById.has(requestedPianistId) && profileById.has(requestedPianistId)) {
    aggregateById.set(requestedPianistId, {
      pianistId: requestedPianistId,
      displayName: profileById.get(requestedPianistId).displayName,
      totalServices: 0,
      positionCounts: { piano_1: 0, piano_2: 0, piano_3: 0, piano_4: 0 },
      monthCounts: {},
      assignments: []
    });
  }

  const warnings = [];
  const pianists = Array.from(aggregateById.values()).map((aggregate) => {
    const profile = profileById.get(aggregate.pianistId);
    const monthlyServiceLimit = profile?.monthlyServiceLimit || DEFAULT_MONTHLY_SERVICE_LIMIT;
    const months = Object.entries(aggregate.monthCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([monthKey, serviceCount]) => {
        const overLimit = serviceCount > monthlyServiceLimit;
        if (overLimit) {
          warnings.push({
            code: "monthly_service_limit_exceeded",
            pianistId: aggregate.pianistId,
            displayName: profile?.displayName || aggregate.displayName,
            month: monthKey,
            serviceCount,
            monthlyServiceLimit
          });
        }
        return { month: monthKey, serviceCount, monthlyServiceLimit, overLimit };
      });
    return {
      pianistId: aggregate.pianistId,
      displayName: profile?.displayName || aggregate.displayName,
      capabilityLevel: profile?.capabilityLevel || "unknown",
      status: profile?.status || "unknown",
      monthlyServiceLimit,
      totalServices: aggregate.totalServices,
      positionCounts: aggregate.positionCounts,
      months,
      assignments: aggregate.assignments.sort((left, right) => left.serviceDate.localeCompare(right.serviceDate))
    };
  }).sort((left, right) => left.displayName.localeCompare(right.displayName));

  return { dateFrom, dateTo, count: pianists.length, pianists, warnings };
}

function buildCoverage(assignments) {
  const assignedPositions = assignments.map((assignment) => assignment.position);
  const missingRequiredPositions = Object.values(PIANO_POSITION_DEFINITIONS)
    .filter((definition) => definition.required && !assignedPositions.includes(definition.position))
    .map((definition) => definition.position);
  return {
    complete: missingRequiredPositions.length === 0,
    assignedPositions,
    missingRequiredPositions,
    optionalOpenPositions: Object.values(PIANO_POSITION_DEFINITIONS)
      .filter((definition) => !definition.required && !assignedPositions.includes(definition.position))
      .map((definition) => definition.position)
  };
}

async function getPianoServicePlan(input = {}, deps = {}) {
  const service = await getServiceRecord(input.serviceId, deps);
  const [planDoc, profiles] = await Promise.all([
    deps.servicePianoPlansCollection.doc(service.serviceId).get(),
    loadProfiles(deps)
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.pianistId, profile]));
  const rawPlan = planDoc.exists ? planDoc.data() || {} : {};
  const assignments = (Array.isArray(rawPlan.assignments) ? rawPlan.assignments : []).map((assignment) => {
    const position = normalizePosition(assignment.position);
    const profile = profileById.get(normalizeString(assignment.pianistId));
    return {
      position,
      pianistId: normalizeString(assignment.pianistId),
      displayName: profile?.displayName || normalizeString(assignment.displayName),
      capabilityLevel: profile?.capabilityLevel || normalizeString(assignment.capabilityLevel),
      duties: [...PIANO_POSITION_DEFINITIONS[position].duties],
      availability: profile
        ? evaluatePianistAvailability(profile, service.serviceDate, service.serviceType)
        : { available: false, source: "missing_profile", matchedRuleIds: [], reason: "Pianist profile was not found." }
    };
  }).sort((left, right) => left.position.localeCompare(right.position));
  const warnings = assignments
    .filter((assignment) => assignment.availability.available === false)
    .map((assignment) => ({
      code: "assigned_pianist_unavailable",
      position: assignment.position,
      pianistId: assignment.pianistId,
      displayName: assignment.displayName,
      reason: assignment.availability.reason
    }));
  return {
    service,
    plan: {
      schemaVersion: SERVICE_PIANO_PLAN_SCHEMA_VERSION,
      serviceId: service.serviceId,
      assignments,
      coverage: buildCoverage(assignments),
      createdAt: normalizeString(rawPlan.createdAt),
      updatedAt: normalizeString(rawPlan.updatedAt),
      changedBy: normalizeString(rawPlan.changedBy)
    },
    positionDefinitions: Object.values(PIANO_POSITION_DEFINITIONS),
    warnings
  };
}

async function saveServicePianoAssignments(input = {}, deps = {}) {
  const service = await getServiceRecord(input.serviceId, deps);
  const planRef = deps.servicePianoPlansCollection.doc(service.serviceId);
  const [existingDoc, profiles] = await Promise.all([planRef.get(), loadProfiles(deps)]);
  const profileById = new Map(profiles.map((profile) => [profile.pianistId, profile]));
  const assignmentMap = new Map();
  if (input.replaceAssignments !== true && existingDoc.exists) {
    for (const assignment of existingDoc.data()?.assignments || []) {
      assignmentMap.set(normalizePosition(assignment.position), assignment);
    }
  }
  for (const positionValue of Array.isArray(input.clearPositions) ? input.clearPositions : []) {
    assignmentMap.delete(normalizePosition(positionValue));
  }
  const requestedAssignments = Array.isArray(input.assignments) ? input.assignments : [];
  const seenRequestedPositions = new Set();
  for (const assignment of requestedAssignments) {
    const position = normalizePosition(assignment?.position);
    if (seenRequestedPositions.has(position)) {
      throw createPianistPlanningError("A piano position was assigned more than once", 400, "duplicate_piano_position", { position });
    }
    seenRequestedPositions.add(position);
    const pianistId = normalizeString(assignment?.pianistId);
    const profile = profileById.get(pianistId);
    if (!profile) {
      throw createPianistPlanningError("Pianist profile not found", 404, "pianist_not_found", { pianistId, position });
    }
    if (profile.status !== "active") {
      throw createPianistPlanningError("Inactive pianist cannot be assigned", 400, "pianist_inactive", { pianistId, position });
    }
    if (!profile.eligiblePositions.includes(position)) {
      throw createPianistPlanningError(
        `${profile.displayName} is not eligible for ${PIANO_POSITION_DEFINITIONS[position].label}`,
        400,
        "pianist_position_not_eligible",
        { pianistId, capabilityLevel: profile.capabilityLevel, position, eligiblePositions: profile.eligiblePositions }
      );
    }
    assignmentMap.set(position, {
      position,
      pianistId,
      displayName: profile.displayName,
      capabilityLevel: profile.capabilityLevel,
      duties: [...PIANO_POSITION_DEFINITIONS[position].duties]
    });
  }
  const assignments = Array.from(assignmentMap.values()).sort((left, right) => left.position.localeCompare(right.position));
  const pianistIds = assignments.map((assignment) => assignment.pianistId);
  if (new Set(pianistIds).size !== pianistIds.length) {
    throw createPianistPlanningError(
      "A pianist cannot occupy more than one piano position in the same service",
      400,
      "duplicate_service_pianist"
    );
  }
  const now = getNowIso(deps);
  const existing = existingDoc.exists ? existingDoc.data() || {} : {};
  const plan = {
    schemaVersion: SERVICE_PIANO_PLAN_SCHEMA_VERSION,
    serviceId: service.serviceId,
    serviceDate: service.serviceDate,
    serviceType: service.serviceType,
    serviceTitle: service.title,
    assignments,
    createdAt: normalizeString(existing.createdAt) || now,
    updatedAt: now,
    changedBy: normalizeString(input.changedBy) || "ministry-planning-dispatcher"
  };
  await planRef.set(plan);

  const warnings = [];
  for (const assignment of assignments) {
    const availability = evaluatePianistAvailability(
      profileById.get(assignment.pianistId),
      service.serviceDate,
      service.serviceType
    );
    if (!availability.available) {
      warnings.push({
        code: "assigned_pianist_unavailable",
        position: assignment.position,
        pianistId: assignment.pianistId,
        displayName: assignment.displayName,
        reason: availability.reason
      });
    }
  }
  const workload = await getPianistWorkload({ month: monthFromIsoDate(service.serviceDate) }, deps);
  const assignedIdSet = new Set(pianistIds);
  warnings.push(...workload.warnings.filter((warning) => assignedIdSet.has(warning.pianistId)));
  let spreadsheetWrite = { written: false, skipped: true };
  if (input.writeToSpreadsheet !== false) {
    try {
      const ministryDoc = deps.serviceMinistryAssignmentsCollection?.doc
        ? await deps.serviceMinistryAssignmentsCollection.doc(service.serviceId).get()
        : null;
      spreadsheetWrite = await writeServiceAssignmentsToGoogleSheet({
        ...input,
        service,
        pianoPlan: plan,
        ministryAssignments: ministryDoc?.exists ? ministryDoc.data() || {} : {},
        writeGroups: ["pianos"]
      }, deps);
    } catch (error) {
      spreadsheetWrite = {
        written: false,
        error: {
          code: error?.code || "google_sheet_assignment_write_failed",
          message: error?.message || "Google Sheet assignment write failed",
          status: Number(error?.statusCode) || 500,
          details: error?.details || {}
        }
      };
      warnings.push({
        code: spreadsheetWrite.error.code,
        message: spreadsheetWrite.error.message,
        details: spreadsheetWrite.error.details
      });
    }
  }
  return {
    service,
    plan: { ...plan, coverage: buildCoverage(assignments) },
    spreadsheetWrite,
    warnings
  };
}

module.exports = {
  AVAILABILITY_VALUES,
  CAPABILITY_ELIGIBLE_POSITIONS,
  DEFAULT_MONTHLY_SERVICE_LIMIT,
  evaluatePianistAvailability,
  getPianistWorkload,
  getPianoServicePlan,
  listPianists,
  PIANIST_CAPABILITY_LEVELS,
  PIANIST_PROFILE_SCHEMA_VERSION,
  PIANIST_STATUS_VALUES,
  PIANO_POSITION_DEFINITIONS,
  savePianistProfile,
  saveServicePianoAssignments,
  SERVICE_PIANO_PLAN_SCHEMA_VERSION
};
