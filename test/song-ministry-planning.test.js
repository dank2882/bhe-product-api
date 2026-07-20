const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateSongActiveCongregationalPool,
  evaluateSongPlanningGuardrails,
  normalizeSongMinistryPlanning
} = require("../lib/song-ministry-planning");

test("normalizeSongMinistryPlanning normalizes hard planning guardrails", () => {
  const result = normalizeSongMinistryPlanning({
    useStatus: "Do Not Use",
    allowedUsageRoles: ["Congregational", "Invitation", "not-a-real-role"],
    blockedUsageRoles: "Offertory",
    seasonalUse: ["Christmas", "Children", "Military", "Mother's Day", "unknown season"],
    worshipFunctions: ["Gospel Invitation", "Assurance"],
    leaderReadiness: {
      Dan: "Not Ready",
      " Guest Leader ": "ready now"
    },
    learningInterest: {
      Dan: "Would Not Learn",
      " Guest Leader ": "Maybe"
    },
    congregationFit: "Strong",
    energy: "Upbeat",
    tempo: "Moderate Tempo",
    rotationStrength: "Solid Rotation",
    blockReason: "Local ministry decision.",
    notes: {
      dan: "  Preserve this note.  "
    }
  });

  assert.deepEqual(result, {
    schemaVersion: "song-ministry-planning-v1",
    useStatus: "do_not_use",
    occasionOnly: false,
    allowedUsageRoles: ["congregational", "invitation"],
    blockedUsageRoles: ["offertory"],
    seasonalUse: ["children", "christmas", "military", "mother_day"],
    worshipFunctions: ["assurance", "gospel_invitation"],
    serviceFit: [],
    leaderReadiness: {
      dan: "not_ready",
      guest_leader: "ready_now"
    },
    learningInterest: {
      dan: "not_interested",
      guest_leader: "maybe"
    },
    congregationFit: "strong",
    energy: "upbeat",
    tempo: "moderate",
    rotationStrength: "solid_rotation",
    blockReason: "Local ministry decision.",
    notes: "Preserve this note."
  });
});

test("normalizeSongMinistryPlanning accepts GPT-entered song entry aliases", () => {
  const result = normalizeSongMinistryPlanning({
    leaderReadiness: {
      dan: "ready"
    },
    learningInterest: {
      dan: "interested"
    },
    localUseFrequency: "very_rare",
    energy: "Triumphant",
    tempo: "Slower",
    notes: {
      dan: "Use sparingly."
    }
  });

  assert.equal(result.leaderReadiness.dan, "ready_now");
  assert.equal(result.learningInterest.dan, "interested");
  assert.equal(result.rotationStrength, "rare");
  assert.equal(result.energy, "triumphant");
  assert.equal(result.tempo, "slow");
  assert.equal(result.notes, "Use sparingly.");
});

test("normalizeSongMinistryPlanning maps service-context comments into serviceFit", () => {
  const result = normalizeSongMinistryPlanning({
    localUseFrequency: "good_sunday_morning",
    serviceFit: ["Midweek"]
  });

  assert.deepEqual(result.serviceFit, ["midweek", "sunday_morning"]);
  assert.equal(result.rotationStrength, "unknown");
});

test("evaluateSongActiveCongregationalPool accepts standard ready congregational songs", () => {
  const result = evaluateSongActiveCongregationalPool({
    songId: "rejoice-0130",
    topics: ["Grace"],
    ministryPlanning: {
      useStatus: "active",
      leaderReadiness: {
        dan: "ready_now"
      },
      energy: "upbeat",
      tempo: "moderate",
      congregationFit: "strong"
    }
  });

  assert.equal(result.active, true);
  assert.deepEqual(result.blockedReasons, []);
});

test("evaluateSongActiveCongregationalPool keeps Rejoice 680 active when occasion topics are descriptive", () => {
  const result = evaluateSongActiveCongregationalPool({
    songId: "rejoice-0680",
    topics: ["Joy", "Temptation and Trials", "Funeral and Memorial"],
    ministryPlanning: {
      leaderReadiness: {
        dan: "ready_now"
      },
      congregationFit: "strong",
      energy: "reflective",
      rotationStrength: "solid_rotation"
    }
  });

  assert.equal(result.active, true);
  assert.deepEqual(result.blockedReasons, []);
  assert.deepEqual(result.warnings, ["use_status_unknown", "tempo_unknown"]);
});

test("evaluateSongActiveCongregationalPool excludes explicit occasion-only songs", () => {
  const result = evaluateSongActiveCongregationalPool({
    songId: "rejoice-0400",
    topics: ["Joy", "Wedding"],
    ministryPlanning: {
      useStatus: "active",
      occasionOnly: true,
      leaderReadiness: {
        dan: "ready_now"
      }
    }
  });

  assert.equal(result.active, false);
  assert.deepEqual(result.blockedReasons, ["occasion_only"]);
});

test("evaluateSongActiveCongregationalPool excludes non-active or occasion-only songs", () => {
  const result = evaluateSongActiveCongregationalPool({
    songId: "rejoice-0228",
    topics: ["Christmas"],
    ministryPlanning: {
      useStatus: "active",
      allowedUsageRoles: ["special_music"],
      seasonalUse: ["Christmas"],
      leaderReadiness: {
        dan: "not_ready"
      },
      worshipFunctions: ["chorus_append"]
    }
  });

  assert.equal(result.active, false);
  assert.deepEqual(result.blockedReasons, [
    "leader_not_ready",
    "usage_role_not_allowed",
    "chorus_or_append",
    "seasonal_or_occasion_only"
  ]);
});

test("evaluateSongPlanningGuardrails blocks disallowed role, season, and leader readiness", () => {
  const result = evaluateSongPlanningGuardrails(
    {
      ministryPlanning: {
        useStatus: "active",
        allowedUsageRoles: ["invitation"],
        seasonalUse: ["christmas"],
        leaderReadiness: {
          dan: "not_ready"
        }
      }
    },
    {
      usageRole: "congregational",
      season: "easter",
      leaderId: "dan"
    }
  );

  assert.equal(result.allowed, false);
  assert.deepEqual(result.blockedReasons, [
    "usage_role_not_allowed",
    "season_not_allowed",
    "leader_not_ready"
  ]);
});

test("evaluateSongPlanningGuardrails warns when a song is learnable but not blocked", () => {
  const result = evaluateSongPlanningGuardrails(
    {
      useStatus: "active",
      leaderReadiness: {
        dan: "learnable_soon"
      }
    },
    {
      leaderId: "dan"
    }
  );

  assert.equal(result.allowed, true);
  assert.deepEqual(result.warnings, ["leader_learnable_soon"]);
});
