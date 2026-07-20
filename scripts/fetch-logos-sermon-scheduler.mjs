#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

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

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function collectText(value, parts = []) {
  if (value == null) return parts;
  if (typeof value === "string") {
    const text = normalizeText(value);
    if (text) parts.push(text);
    return parts;
  }
  if (typeof value !== "object") return parts;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return parts;
  }

  if (typeof value.text === "string") {
    const text = normalizeText(value.text);
    if (text) parts.push(text);
  }

  for (const key of ["content", "children", "items", "blocks"]) {
    if (value[key]) collectText(value[key], parts);
  }

  return parts;
}

function blocksToText(blocks = []) {
  return blocks
    .map((block) => collectText(block, []).join(" "))
    .map(normalizeText)
    .filter(Boolean)
    .join("\n");
}

function extractDocumentText(document = {}) {
  const info = document.content?.info || {};
  const sections = [
    blocksToText(info.notes || []),
    blocksToText(info.description || [])
  ].filter(Boolean);

  return normalizeText(sections.join("\n\n"));
}

function extractTopics(document = {}) {
  const topicTags = document.content?.info?.tagsInfo?.topicTags || [];
  return topicTags.map((tag) => normalizeText(tag.text)).filter(Boolean);
}

function extractPassages(document = {}) {
  const referenceTags = document.content?.info?.tagsInfo?.referenceTags || [];
  return referenceTags.map((tag) => normalizeText(tag.text)).filter(Boolean).join("; ");
}

function toRecord(item) {
  const document = item.document || {};
  const info = document.content?.info || {};
  const occasions = Array.isArray(info.occasions) && info.occasions.length > 0
    ? info.occasions.map((occasion) => ({
      date: normalizeText(occasion.date),
      venue: normalizeText(occasion.venue),
      service: normalizeText(occasion.service)
    })).filter((occasion) => occasion.date || occasion.venue || occasion.service)
    : [{
      date: normalizeText(item.occasionDate),
      venue: normalizeText(item.occasionVenue),
      service: normalizeText(item.occasionService)
    }].filter((occasion) => occasion.date || occasion.venue || occasion.service);

  return {
    title: normalizeText(document.title),
    logosId: normalizeText(item.externalId),
    url: item.externalId ? `https://app.logos.com/documents/sermon/${item.externalId}?title=${encodeURIComponent(document.title || "")}&layout=one` : "",
    preachedDate: normalizeText(item.occasionDate || occasions[0]?.date),
    venue: normalizeText(item.occasionVenue || occasions[0]?.venue),
    service: normalizeText(item.occasionService || occasions[0]?.service),
    occasions,
    series: normalizeText(info.seriesTitle || info.series),
    seriesNumber: info.seriesNumber == null ? "" : String(info.seriesNumber),
    speaker: normalizeText(info.author?.name),
    scriptureText: extractPassages(document),
    topics: extractTopics(document),
    manuscriptText: extractDocumentText(document),
    logosMetadata: {
      capturedFrom: "sermon_scheduler_api",
      occasionIndex: item.occasionIndex,
      status: info.status || "",
      audience: info.audiences || [],
      rawExternalId: item.externalId
    }
  };
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

  const records = (data.sermons || []).map(toRecord);
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
