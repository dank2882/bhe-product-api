#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

const DEFAULT_PROFILE_DIR = path.join(os.homedir(), ".bhe-logos-puppeteer-profile");

function parseArgs(argv) {
  const args = {
    out: "tmp/logos-sermons.manual-found.raw.jsonl",
    profileDir: process.env.LOGOS_PUPPETEER_PROFILE_DIR || DEFAULT_PROFILE_DIR,
    schedulerJson: "tmp/logos-sermon-scheduler.raw.json",
    targetTitle: "",
    targetDate: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--out") args.out = next;
    else if (token === "--profile-dir") args.profileDir = next;
    else if (token === "--scheduler-json") args.schedulerJson = next;
    else if (token === "--target-title") args.targetTitle = next;
    else if (token === "--target-date") args.targetDate = next;

    if (token.startsWith("--") && next && !next.startsWith("--")) {
      index += 1;
    }
  }

  return args;
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function titleKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readSchedulerItems(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(raw.sermons) ? raw.sermons : [];
}

function findSchedulerItem(items, record, args) {
  const logosId = normalizeText(record.logosId);
  const targetTitle = titleKey(args.targetTitle || record.title);
  const targetDate = normalizeText(args.targetDate);
  const matches = items.filter((item) => item.externalId === logosId);

  if (targetTitle && targetDate) {
    const exact = matches.find((item) =>
      titleKey(item.document?.title) === targetTitle &&
      normalizeText(item.occasionDate) === targetDate
    );
    if (exact) return exact;
  }

  if (targetTitle) {
    const titleMatch = matches.find((item) => titleKey(item.document?.title) === targetTitle);
    if (titleMatch) return titleMatch;
  }

  return matches[0] || null;
}

async function connectToExistingBrowser(profileDir) {
  const devToolsPortFile = path.join(profileDir, "DevToolsActivePort");
  if (!fs.existsSync(devToolsPortFile)) {
    throw new Error(`No DevToolsActivePort file found at ${devToolsPortFile}`);
  }

  const port = fs.readFileSync(devToolsPortFile, "utf8").trim().split(/\n/)[0];
  return puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
}

async function extractOpenSermonDocument(page) {
  await page.waitForFunction(
    () => location.href.includes("/documents/sermon/") && document.body.innerText.length > 200,
    { timeout: 15000 }
  ).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1000));

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
        capturedFrom: "open_document",
        visibleInputs: inputs
      }
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await connectToExistingBrowser(args.profileDir);

  try {
    const pages = await browser.pages();
    const sermonPages = pages.filter((page) => page.url().includes("app.logos.com/documents/sermon/"));
    const page = sermonPages.at(-1);
    if (!page) {
      throw new Error("No open Logos sermon document tab found.");
    }

    const record = await extractOpenSermonDocument(page);
    const schedulerItem = findSchedulerItem(readSchedulerItems(args.schedulerJson), record, args);

    if (!record.logosId || record.manuscriptText.length === 0) {
      throw new Error(`Could not extract manuscript text from ${page.url()}`);
    }

    if (schedulerItem) {
      record.title = record.title || schedulerItem.document?.title || args.targetTitle || "";
      record.preachedDate = schedulerItem.occasionDate || args.targetDate || "";
      record.venue = schedulerItem.occasionVenue || "";
      record.service = schedulerItem.occasionService || "";
      record.occasions = [{ date: record.preachedDate, venue: record.venue, service: record.service }]
        .filter((occasion) => occasion.date || occasion.venue || occasion.service);
      record.logosMetadata = {
        ...record.logosMetadata,
        schedulerExternalId: schedulerItem.externalId,
        schedulerOccasionIndex: schedulerItem.occasionIndex
      };
    }

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.appendFileSync(args.out, `${JSON.stringify(record)}\n`);
    console.log(JSON.stringify({
      out: args.out,
      title: record.title,
      preachedDate: record.preachedDate || "",
      venue: record.venue || "",
      service: record.service || "",
      logosId: record.logosId,
      manuscriptChars: record.manuscriptText.length
    }, null, 2));
  } finally {
    await browser.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
