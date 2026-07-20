#!/usr/bin/env node

import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const PROJECT_ID = "location-map-985";
const REGION = "us-west1";
const SERVICE = "bhe-product-api";
const REDIRECT_URI = "http://localhost:53682";
const SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const SECRET_MAPPINGS = [
  "BHE_API_KEY=BHE_API_KEY:latest",
  "OPENAI_API_KEY=OPENAI_API_KEY:latest",
  "YOUTUBE_COOKIES_BASE64=youtube-cookies-base64:latest",
  "YOUTUBE_OAUTH_CLIENT_ID=youtube-oauth-client-id:latest",
  "YOUTUBE_OAUTH_CLIENT_SECRET=youtube-oauth-client-secret:latest",
  "YOUTUBE_OAUTH_REFRESH_TOKEN=youtube-oauth-refresh-token:latest"
];

function parseArgs(argv) {
  const args = {
    clientId: process.env.YOUTUBE_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET || "",
    refreshService: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? argv[index + 1];

    switch (key) {
      case "--client-id":
        args.clientId = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--client-secret":
        args.clientSecret = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--refresh-service":
        args.refreshService = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function run(command, args, options = {}) {
  const hasInput = Object.prototype.hasOwnProperty.call(options, "input");
  const result = spawnSync(command, args, {
    input: options.input || undefined,
    stdio: options.capture ? ["pipe", "pipe", "pipe"] : (
      hasInput ? ["pipe", "inherit", "inherit"] : "inherit"
    ),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    if (options.capture && result.stderr) {
      console.error(result.stderr.trim());
    }
    process.exit(result.status || 1);
  }

  return result.stdout || "";
}

function saveSecret(name, value) {
  const exists = spawnSync(
    "gcloud",
    ["secrets", "describe", name, "--project", PROJECT_ID],
    { stdio: "ignore" }
  ).status === 0;

  if (exists) {
    run("gcloud", ["secrets", "versions", "add", name, "--data-file=-", "--project", PROJECT_ID], {
      input: value
    });
  } else {
    run("gcloud", [
      "secrets",
      "create",
      name,
      "--data-file=-",
      "--replication-policy=automatic",
      "--project",
      PROJECT_ID
    ], {
      input: value
    });
  }
}

function waitForOAuthCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url || "/", REDIRECT_URI);

        if (url.pathname !== "/") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(`OAuth failed: ${error}`);
          server.close();
          reject(new Error(`OAuth failed: ${error}`));
          return;
        }

        const code = url.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing authorization code.");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("YouTube OAuth authorization complete. You can return to the terminal.");
        server.close();
        resolve(code);
      } catch (error) {
        server.close();
        reject(error);
      }
    });

    server.on("error", reject);
    server.listen(53682, "127.0.0.1");
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const rl = readline.createInterface({ input, output });

  if (!args.clientId) {
    args.clientId = await rl.question("YouTube OAuth client ID: ");
  }

  if (!args.clientSecret) {
    args.clientSecret = await rl.question("YouTube OAuth client secret: ");
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", args.clientId.trim());
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("");
  console.log("Open this URL and approve access with the Google account that can manage the YouTube channel:");
  console.log(authUrl.toString());
  console.log("");

  const codePromise = waitForOAuthCode();
  console.log("Waiting for browser authorization callback...");
  rl.close();
  const code = await codePromise;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: args.clientId.trim(),
      client_secret: args.clientSecret.trim(),
      code: code.trim(),
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI
    })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.refresh_token) {
    console.error("OAuth token exchange failed.");
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  saveSecret("youtube-oauth-client-id", args.clientId.trim());
  saveSecret("youtube-oauth-client-secret", args.clientSecret.trim());
  saveSecret("youtube-oauth-refresh-token", data.refresh_token);

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
    for (const secret of [
      "youtube-oauth-client-id",
      "youtube-oauth-client-secret",
      "youtube-oauth-refresh-token"
    ]) {
      run("gcloud", [
        "secrets",
        "add-iam-policy-binding",
        secret,
        "--project",
        PROJECT_ID,
        `--member=serviceAccount:${serviceAccount}`,
        "--role=roles/secretmanager.secretAccessor"
      ]);
    }
  }

  if (args.refreshService) {
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
      SECRET_MAPPINGS.join(",")
    ]);
  }

  console.log("YouTube OAuth secrets saved.");
  console.log(args.refreshService ? "Cloud Run service refreshed." : "Run again with --refresh-service to attach the secrets to Cloud Run.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
