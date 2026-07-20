import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const instructionsPath = "docs/gpts/ministry-planner.instructions.upload.md";
const maximumCharacters = 8000;
const content = fs.readFileSync(path.join(rootDir, instructionsPath), "utf8");
const requiredText = [
  "listMinistryPlanningOperations",
  "getMinistryPlanningConfig",
  "operatorGuidance",
  "runMinistryPlanningQuery",
  "runMinistryPlanningCommand",
  "saveServiceCongregationalPlan",
  "sourceRowNumber",
  "readGoogleSheetRange",
  "restoreGoogleSheetRange",
  "recordServiceSongFeedback",
  "saveServicePianoAssignments",
  "preacher cannot lead congregationals"
];

if (content.length > maximumCharacters) {
  console.error(`Ministry Planner Builder instructions exceed ${maximumCharacters} characters: ${content.length}`);
  process.exit(1);
}

const missing = requiredText.filter((value) => !content.includes(value));
if (missing.length > 0) {
  console.error(`Ministry Planner Builder instructions are missing required routing rules: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(
  `Ministry Planner Builder instructions verified: ${content.length}/${maximumCharacters} characters, ` +
  `${Buffer.byteLength(content, "utf8")} bytes`
);
