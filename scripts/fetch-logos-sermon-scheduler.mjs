#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import { extractLogosSchedulerRecords } from "./lib/logos-sermon-scheduler.mjs";

const DEFAULT_PROFILE_DIR = path.join(os.homedir(), ".bhe-logos-puppeteer-profile");
const DEFAULT_OUT = "tmp/logos-sermon-scheduler.raw.json";
const DEFAULT_JSONL_OUT = "tmp/logos-sermon-scheduler.extracted.jsonl";
const START_URL = "https://app.logos.com/tools/sermon-manager?layout=one";

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    jsonlOut: DEFAULT_JSONL_OUT,
    profileDir: process.env.LOGOS_PUPPETEER_PROFILE_DIR || DEFAULT_PROFILE_DIR,
    headless: false,
    keepOpen: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--out") args.out = next;
    else if (token === "--jsonl-out") args.jsonlOut = next;
    else if (token === "--profile-dir") args.profileDir = next;
    else if (token === "--headless") args.headless = true;
    else if (token === "--keep-open") args.keepOpen = true;

    if (token.startsWith("--") && next && !next.startsWith("--") && !["--headless", "--keep-open"].includes(token)) {
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.mkdirSync(path.dirname(args.jsonlOut), { recursive: true });

  let connectedToExisting = false;
  let browser;
  const devToolsPortFile = path.join(args.profileDir, "DevToolsActivePort");
  if (fs.existsSync(devToolsPortFile)) {
    const port = fs.readFileSync(devToolsPortFile, "utf8").trim().split(/\n/)[0];
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
    connectedToExisting = true;
  } else {
    browser = await puppeteer.launch({
      headless: args.headless,
      userDataDir: args.profileDir,
      defaultViewport: { width: 1440, height: 1000 }
    });
  }
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  for (const extra of pages.slice(1)) {
    await extra.close().catch(() => {});
  }

  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.innerText.includes("Sermon Manager") || document.body.innerText.includes("Sign in"),
    { timeout: 60000 }
  ).catch(() => {});

  const data = await page.evaluate(async () => {
    const response = await fetch("/api/app/sermon-scheduler/sermons", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "x-requested-with": "fetch"
      },
      body: JSON.stringify({
        tzoMinutes: new Date().getTimezoneOffset(),
        query: "",
        language: "en-US",
        startDate: null,
        endDate: null,
        filters: [],
        facetRequests: [
          { field: "Series", termLimit: 10 },
          { field: "Venue", termLimit: 10 },
          { field: "Service", termLimit: 10 },
          { field: "KeyTopics", termLimit: 10 },
          { field: "KeyPassages", termLimit: 10 },
          { field: "MiscellaneousTags", termLimit: 10 },
          { field: "Author", termLimit: 10 },
          { field: "Audience", termLimit: 10 },
          { field: "Status", termLimit: 10 },
          { field: "LectionarySeason", termLimit: 10 }
        ],
        facetFindText: null,
        limit: 10000,
        excludeTemplates: true,
        sort: { field: "occasionDate", order: "ascending" }
      })
    });

    if (!response.ok) {
      throw new Error(`Logos sermon scheduler request failed: ${response.status}`);
    }

    return response.json();
  });

  fs.writeFileSync(args.out, JSON.stringify(data, null, 2));

  const records = extractLogosSchedulerRecords(data);
  fs.writeFileSync(args.jsonlOut, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));

  const uniqueDocs = new Set(records.map((record) => record.logosId).filter(Boolean));
  const importReady50 = records.filter((record) => record.manuscriptText.length >= 50).length;
  console.log(JSON.stringify({
    rawSermonRows: data.sermons?.length || 0,
    extractedRows: records.length,
    uniqueDocs: uniqueDocs.size,
    importReady50,
    rawOut: args.out,
    jsonlOut: args.jsonlOut
  }, null, 2));

  if (args.keepOpen) {
    console.log("Keeping browser open. Press Ctrl+C when finished.");
    await new Promise(() => {});
  }

  if (connectedToExisting) {
    await browser.disconnect();
  } else {
    await browser.close().catch(() => browser.process()?.kill("SIGTERM"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
