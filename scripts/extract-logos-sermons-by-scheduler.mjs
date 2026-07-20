#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

const DEFAULT_PROFILE_DIR = path.join(os.homedir(), ".bhe-logos-puppeteer-profile");

function parseArgs(argv) {
  const args = {
    targetQueue: "tmp/logos-export-missing-rows.after-targeted.json",
    schedulerJson: "tmp/logos-sermon-scheduler.raw.json",
    out: "tmp/logos-sermons.scheduler-direct.raw.jsonl",
    profileDir: process.env.LOGOS_PUPPETEER_PROFILE_DIR || DEFAULT_PROFILE_DIR,
    startIndex: 0,
    limit: 10,
    skipExistingFiles: [],
    headless: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--target-queue") args.targetQueue = next;
    else if (token === "--scheduler-json") args.schedulerJson = next;
    else if (token === "--out") args.out = next;
    else if (token === "--profile-dir") args.profileDir = next;
    else if (token === "--start-index") args.startIndex = Number.parseInt(next, 10);
    else if (token === "--limit") args.limit = Number.parseInt(next, 10);
    else if (token === "--skip-existing-file") args.skipExistingFiles.push(next);
    else if (token === "--headless") args.headless = true;

    if (token.startsWith("--") && next && !next.startsWith("--") && token !== "--headless") {
      index += 1;
    }
  }

  args.startIndex = Number.isInteger(args.startIndex) && args.startIndex > 0 ? args.startIndex : 0;
  args.limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 10;
  return args;
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function titleKey(value) {
  return normalizeText(value).toLowerCase();
}

function readJsonRecords(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  if (text.startsWith("[")) return JSON.parse(text);
  return text.split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function buildSkipState(files = []) {
  const keys = new Set();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const record of readJsonRecords(file)) {
      if (record.logosId) keys.add(`logos:${record.logosId}`);
      if (record.title && record.preachedDate) keys.add(`td:${titleKey(record.title)}|${record.preachedDate}`);
      if (record.url) keys.add(`url:${String(record.url).split("?")[0]}`);
    }
  }
  return keys;
}

function buildSchedulerIndex(schedulerJsonPath) {
  const scheduler = JSON.parse(fs.readFileSync(schedulerJsonPath, "utf8")).sermons || [];
  const byTitleDate = new Map();

  for (const item of scheduler) {
    const title = titleKey(item.document?.title);
    const date = normalizeText(item.occasionDate);
    if (title && date) {
      byTitleDate.set(`${title}|${date}`, item);
    }
  }

  return byTitleDate;
}

async function connectOrLaunch(args) {
  const devToolsPortFile = path.join(args.profileDir, "DevToolsActivePort");
  if (fs.existsSync(devToolsPortFile)) {
    const port = fs.readFileSync(devToolsPortFile, "utf8").trim().split(/\n/)[0];
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
    return { browser, connectedToExisting: true };
  }

  const browser = await puppeteer.launch({
    headless: args.headless,
    userDataDir: args.profileDir,
    defaultViewport: { width: 1440, height: 1000 }
  });
  return { browser, connectedToExisting: false };
}

async function waitForSermonDocument(page) {
  await page.waitForFunction(
    () => location.href.includes("/documents/sermon/") &&
      (document.body.innerText.includes("Edit Text") || document.body.innerText.includes("Sermon")),
    { timeout: 30000 }
  ).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

async function extractOpenSermonDocument(page) {
  return page.evaluate(() => {
    const norm = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    const titleElement = Array.from(document.querySelectorAll("textarea,input,[contenteditable='true']"))
      .find((element) => (element.getAttribute("aria-label") || "").toLowerCase().includes("sermon title"));
    const title = norm(titleElement?.value || titleElement?.innerText || titleElement?.textContent || document.title.replace(/ - Logos.*$/, ""));
    const manuscriptCandidates = Array.from(document.querySelectorAll("[contenteditable='true'], textarea"))
      .map((element) => ({
        text: norm(element.value || element.innerText || element.textContent || ""),
        aria: element.getAttribute("aria-label") || ""
      }))
      .filter((candidate) => candidate.text && !candidate.aria.toLowerCase().includes("sermon title"))
      .sort((left, right) => right.text.length - left.text.length);
    const inputs = Array.from(document.querySelectorAll("input,textarea"))
      .map((element) => ({
        aria: element.getAttribute("aria-label") || "",
        placeholder: element.getAttribute("placeholder") || "",
        value: norm(element.value || "")
      }))
      .filter((item) => item.value || item.aria || item.placeholder);
    const fieldValue = (label) => inputs.find((item) => item.aria.toLowerCase() === label.toLowerCase())?.value || "";
    const url = location.href;
    const logosId = url.match(/\/documents\/sermon\/([^?/#]+)/)?.[1] || "";

    return {
      title,
      url,
      logosId,
      manuscriptText: manuscriptCandidates[0]?.text || "",
      series: fieldValue("Series"),
      seriesNumber: fieldValue("Number (in series)"),
      topics: fieldValue("Topics") ? [fieldValue("Topics")] : [],
      scriptureText: fieldValue("Passages"),
      logosMetadata: {
        capturedFrom: "scheduler_direct_document",
        visibleInputs: inputs
      }
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, "");

  const queue = readJsonRecords(args.targetQueue).slice(args.startIndex);
  const schedulerIndex = buildSchedulerIndex(args.schedulerJson);
  const skipState = buildSkipState(args.skipExistingFiles);
  const { browser, connectedToExisting } = await connectOrLaunch(args);
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().includes("app.logos.com")) || pages[0] || await browser.newPage();
  page.setDefaultTimeout(30000);

  const records = [];
  let notMappedCount = 0;
  let skippedExistingCount = 0;
  let failedCount = 0;

  for (const target of queue) {
    if (records.length >= args.limit) break;
    const schedulerItem = schedulerIndex.get(`${titleKey(target.title)}|${target.date || target.preachedDate || ""}`);
    if (!schedulerItem?.externalId) {
      notMappedCount += 1;
      console.log(`No scheduler id: ${target.date || ""} - ${target.title}`);
      continue;
    }

    const directUrl = `https://app.logos.com/documents/sermon/${schedulerItem.externalId}?title=${encodeURIComponent(schedulerItem.document?.title || target.title)}&layout=one`;
    const skipKeys = [
      `logos:${schedulerItem.externalId}`,
      `td:${titleKey(target.title)}|${target.date || target.preachedDate || ""}`,
      `url:${directUrl.split("?")[0]}`
    ];
    if (skipKeys.some((key) => skipState.has(key))) {
      skippedExistingCount += 1;
      continue;
    }

    await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForSermonDocument(page);
    const record = await extractOpenSermonDocument(page);

    if (!record.logosId || record.manuscriptText.length === 0) {
      failedCount += 1;
      console.log(`Failed direct extract: ${target.date || ""} - ${target.title}`);
      continue;
    }

    record.title = record.title || target.title || schedulerItem.document?.title || "";
    record.preachedDate = target.date || target.preachedDate || schedulerItem.occasionDate || "";
    record.venue = target.venue || schedulerItem.occasionVenue || "";
    record.service = target.service || schedulerItem.occasionService || "";
    record.occasions = [{ date: record.preachedDate, venue: record.venue, service: record.service }]
      .filter((occasion) => occasion.date || occasion.venue || occasion.service);
    record.logosExportTarget = target;
    record.logosMetadata = {
      ...record.logosMetadata,
      schedulerExternalId: schedulerItem.externalId,
      schedulerOccasionIndex: schedulerItem.occasionIndex
    };

    records.push(record);
    fs.appendFileSync(args.out, `${JSON.stringify(record)}\n`);
    console.log(`[${records.length}/${args.limit}] ${record.title} - ${record.manuscriptText.length} chars`);
  }

  console.log(JSON.stringify({
    targetQueue: args.targetQueue,
    extracted: records.length,
    skippedExistingCount,
    notMappedCount,
    failedCount,
    out: args.out
  }, null, 2));

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
