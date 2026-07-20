#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const PROJECT_ID = "location-map-985";
const REGION = "us-west1";
const SERVICE = "bhe-product-api";
const SECRET = "youtube-cookies-base64";
const REQUIRED_SECRET_MAPPINGS = [
  "BHE_API_KEY=BHE_API_KEY:latest",
  "OPENAI_API_KEY=OPENAI_API_KEY:latest",
  `YOUTUBE_COOKIES_BASE64=${SECRET}:latest`
];

function usage() {
  console.error(`Usage: node ${basename(process.argv[1])} /path/to/cookies.txt [--refresh-service]`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8"
  });

  if (result.status !== 0) {
    if (options.capture) {
      const stderr = result.stderr?.trim();
      if (stderr) console.error(stderr);
    }
    process.exit(result.status || 1);
  }

  return result.stdout || "";
}

const cookiePathArg = process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[1] && arg !== process.argv[0]);
const refreshService = process.argv.includes("--refresh-service");

if (!cookiePathArg) {
  usage();
}

const cookiePath = resolve(cookiePathArg);

if (!existsSync(cookiePath)) {
  console.error(`Cookie file not found: ${cookiePath}`);
  process.exit(1);
}

const cookieText = readFileSync(cookiePath, "utf8");

if (!cookieText.includes("Netscape HTTP Cookie File") || !cookieText.includes(".youtube.com")) {
  console.error("Expected a Netscape-format cookies.txt export containing YouTube cookies.");
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), "youtube-cookies-secret-"));
const base64Path = join(tempDir, "cookies.base64");

try {
  writeFileSync(base64Path, Buffer.from(cookieText, "utf8").toString("base64"));

  const secretExists = spawnSync(
    "gcloud",
    ["secrets", "describe", SECRET, "--project", PROJECT_ID],
    { stdio: "ignore" }
  ).status === 0;

  if (secretExists) {
    run("gcloud", ["secrets", "versions", "add", SECRET, `--data-file=${base64Path}`, "--project", PROJECT_ID]);
  } else {
    run("gcloud", [
      "secrets",
      "create",
      SECRET,
      `--data-file=${base64Path}`,
      "--replication-policy=automatic",
      "--project",
      PROJECT_ID
    ]);
  }

  const serviceAccount = run("gcloud", [
    "run",
    "services",
    "describe",
    SERVICE,
    "--region",
    REGION,
    "--project",
    PROJECT_ID,
    "--format=value(spec.template.spec.serviceAccountName)"
  ], { capture: true }).trim();

  if (serviceAccount) {
    run("gcloud", [
      "secrets",
      "add-iam-policy-binding",
      SECRET,
      "--project",
      PROJECT_ID,
      `--member=serviceAccount:${serviceAccount}`,
      "--role=roles/secretmanager.secretAccessor"
    ]);
  }

  if (refreshService) {
    run("gcloud", [
      "run",
      "services",
      "update",
      SERVICE,
      "--region",
      REGION,
      "--project",
      PROJECT_ID,
      "--update-secrets",
      REQUIRED_SECRET_MAPPINGS.join(",")
    ]);
  }

  console.log("YouTube cookie secret updated.");
  console.log(refreshService ? "Cloud Run service refreshed." : "Run again with --refresh-service to force new Cloud Run instances to load it.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
