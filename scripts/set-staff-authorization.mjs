import { createRequire } from "node:module";
import { Firestore } from "@google-cloud/firestore";

const require = createRequire(import.meta.url);
const {
  buildAuthorizationFromRoleNames,
  saveStaffAuthorizationProfile
} = require("../lib/staff-authorization-service");

function parseArgs(argv) {
  const result = {
    roles: [],
    identitySubjects: [],
    commit: false,
    status: "active",
    expectedVersion: undefined
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--commit") {
      result.commit = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    index += 1;
    if (token === "--subject") result.subject = value;
    else if (token === "--name") result.displayName = value;
    else if (token === "--email") result.email = value;
    else if (token === "--role") result.roles.push(value);
    else if (token === "--identity-subject") result.identitySubjects.push(value);
    else if (token === "--status") result.status = value;
    else if (token === "--expected-version") result.expectedVersion = Number(value);
    else if (token === "--updated-by-sub") result.updatedBySub = value;
    else if (token === "--updated-by-name") result.updatedByName = value;
    else if (token === "--project") result.projectId = value;
    else if (token === "--database") result.databaseId = value;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.subject) throw new Error("--subject is required");
if (!args.roles.length && args.status === "active") {
  throw new Error("At least one --role is required for an active profile");
}

const authorization = buildAuthorizationFromRoleNames(args.roles);
const proposal = {
  subject: args.subject,
  changes: {
    displayName: args.displayName || "",
    email: args.email || "",
    status: args.status,
    identitySubjects: args.identitySubjects,
    ...authorization
  },
  expectedVersion: args.expectedVersion,
  updatedBySub: args.updatedBySub || "",
  updatedByName: args.updatedByName || ""
};

if (!args.commit) {
  console.log(JSON.stringify({
    dryRun: true,
    message: "No changes written. Add --commit after reviewing this proposal.",
    proposal
  }, null, 2));
  process.exit(0);
}

const projectId = args.projectId || process.env.GCP_PROJECT_ID || "location-map-985";
const databaseId = args.databaseId || process.env.FIRESTORE_DATABASE_ID || "chatgptstorage";
const db = new Firestore({ projectId, databaseId });
const result = await saveStaffAuthorizationProfile(proposal, {
  staffAuthorizationProfilesCollection: db.collection("staffAuthorizationProfiles")
});
console.log(JSON.stringify({
  dryRun: false,
  projectId,
  databaseId,
  profile: result.profile
}, null, 2));
