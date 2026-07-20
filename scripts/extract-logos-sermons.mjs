#!/usr/bin/env node

import fs from "node:fs";
import { getLogosSermonTags, mergeLogosTags } from "./lib/logos-sermon-import.mjs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import puppeteer from "puppeteer";

const DEFAULT_START_URL = "https://app.logos.com/tools/sermon-manager?layout=one";
const DEFAULT_PROFILE_DIR = path.join(os.homedir(), ".bhe-logos-puppeteer-profile");
const DEFAULT_OUT = "tmp/logos-sermons.jsonl";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MIN_POST_CHARS = 50;
const LIST_SELECTORS = [
  "[role='row']",
  "tr",
  "[data-testid*='sermon' i]",
  "[class*='sermon' i]"
];
const TITLE_SELECTORS = [
  "h1",
  "[data-testid*='title' i]",
  "[aria-label*='title' i]",
  "input[aria-label*='title' i]",
  "textarea[aria-label*='title' i]"
];
const MANUSCRIPT_SELECTORS = [
  "[data-testid*='manuscript' i]",
  "[aria-label*='manuscript' i]",
  "[class*='manuscript' i]",
  "[contenteditable='true']",
  "textarea"
];
const NON_SERMON_TITLES = new Set([
  "all",
  "week",
  "week grid",
  "radial calendar",
  "service",
  "date",
  "title",
  "series",
  "passages",
  "topics",
  "add",
  "blank sermon",
  "no date"
]);

function parseArgs(argv) {
  const args = {
    limit: 3,
    out: DEFAULT_OUT,
    profileDir: process.env.LOGOS_PUPPETEER_PROFILE_DIR || DEFAULT_PROFILE_DIR,
    startUrl: process.env.LOGOS_SERMON_MANAGER_URL || DEFAULT_START_URL,
    apiUrl: process.env.BHE_API_URL || "http://localhost:8080",
    apiKey: process.env.BHE_API_KEY || "",
    batchSize: DEFAULT_BATCH_SIZE,
    minChars: DEFAULT_MIN_POST_CHARS,
    skipExistingFiles: [],
    skipExistingMatch: "title",
    startScrollTop: 0,
    targetQueue: "",
    targetStartIndex: 0,
    targetMaxAttempts: 0,
    post: false,
    rebuild: false,
    embed: false,
    headless: false,
    keepOpen: false,
    series: "",
    folderId: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--post") args.post = true;
    else if (token === "--rebuild") args.rebuild = true;
    else if (token === "--embed") args.embed = true;
    else if (token === "--headless") args.headless = true;
    else if (token === "--keep-open") args.keepOpen = true;
    else if (token === "--limit") args.limit = Number.parseInt(next, 10);
    else if (token === "--out") args.out = next;
    else if (token === "--profile-dir") args.profileDir = next;
    else if (token === "--start-url") args.startUrl = next;
    else if (token === "--api-url") args.apiUrl = next;
    else if (token === "--api-key") args.apiKey = next;
    else if (token === "--batch-size") args.batchSize = Number.parseInt(next, 10);
    else if (token === "--min-chars") args.minChars = Number.parseInt(next, 10);
    else if (token === "--skip-existing-file") args.skipExistingFiles.push(next);
    else if (token === "--skip-existing-match") args.skipExistingMatch = next;
    else if (token === "--start-scroll-top") args.startScrollTop = Number.parseInt(next, 10);
    else if (token === "--target-queue") args.targetQueue = next;
    else if (token === "--target-start-index") args.targetStartIndex = Number.parseInt(next, 10);
    else if (token === "--target-max-attempts") args.targetMaxAttempts = Number.parseInt(next, 10);
    else if (token === "--series") args.series = next;
    else if (token === "--folder-id") args.folderId = next;

    if (token.startsWith("--") && next && !next.startsWith("--") && !["--post", "--rebuild", "--embed", "--headless", "--keep-open"].includes(token)) {
      index += 1;
    }
  }

  args.limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 3;
  args.batchSize = Number.isInteger(args.batchSize) && args.batchSize > 0 ? Math.min(args.batchSize, 50) : DEFAULT_BATCH_SIZE;
  args.minChars = Number.isInteger(args.minChars) && args.minChars >= 0 ? args.minChars : DEFAULT_MIN_POST_CHARS;
  args.skipExistingMatch = args.skipExistingMatch === "title-date" ? "title-date" : "title";
  args.startScrollTop = Number.isInteger(args.startScrollTop) && args.startScrollTop > 0 ? args.startScrollTop : 0;
  args.targetStartIndex = Number.isInteger(args.targetStartIndex) && args.targetStartIndex > 0 ? args.targetStartIndex : 0;
  return args;
}

function normalizeText(value) {
  return typeof value === "string"
    ? value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : "";
}

function isLikelySermonTitle(value) {
  const title = normalizeText(value);

  return title.length >= 4 &&
    title.length <= 180 &&
    !NON_SERMON_TITLES.has(title.toLowerCase());
}

function normalizeDate(value) {
  const text = normalizeText(value);
  const isoMatch = text.match(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return isoMatch[0];

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeTitleKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readJsonlRecords(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function readJsonRecords(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  if (text.startsWith("[")) return JSON.parse(text);
  return readJsonlRecords(filePath);
}

function estimateScrollTopForExportRow(rowNumber) {
  const row = Number(rowNumber) || 1;
  return Math.max(Math.floor((row - 8) * 38.9), 0);
}

function targetMatchesCandidate(target, candidate) {
  const targetTitle = normalizeTitleKey(target.title);
  const candidateTitle = normalizeTitleKey(candidate.titleText || candidate.text);
  const targetDate = normalizeText(target.preachedDate || target.date);

  return Boolean(
    targetTitle &&
    candidateTitle === targetTitle &&
    (!targetDate || !candidate.rowDate || candidate.rowDate === targetDate)
  );
}

function recordMatchesTarget(record, target) {
  const targetTitle = normalizeTitleKey(target.title);
  const recordTitle = normalizeTitleKey(record.title);
  const targetDate = normalizeText(target.preachedDate || target.date);
  const occasionDates = Array.isArray(record.occasions)
    ? record.occasions.map((occasion) => occasion.date).filter(Boolean)
    : [];

  return Boolean(
    targetTitle &&
    recordTitle === targetTitle &&
    (
      !targetDate ||
      record.preachedDate === targetDate ||
      occasionDates.includes(targetDate)
    )
  );
}

function buildExistingSkipState(files) {
  const state = {
    titles: new Set(),
    titleDates: new Set(),
    logosIds: new Set(),
    urls: new Set(),
    count: 0
  };

  for (const file of files) {
    for (const record of readJsonlRecords(file)) {
      const title = normalizeText(record.title).toLowerCase();
      const date = normalizeText(record.preachedDate);
      const logosId = normalizeText(record.logosId);
      const url = normalizeText(record.url).split("?")[0];

      if (title) state.titles.add(title);
      if (title && date) state.titleDates.add(`${title}|${date}`);
      if (logosId) state.logosIds.add(logosId);
      if (url) state.urls.add(url);
      state.count += 1;
    }
  }

  return state;
}

function getCandidateSkipKey(item, mode) {
  const title = normalizeText(item.titleText || item.text).toLowerCase();
  if (!title) return "";

  if (mode === "title-date" && item.rowDate) {
    return `${title}|${item.rowDate}`;
  }

  return title;
}

function isExistingCandidate(item, skipState, mode) {
  if (!skipState || skipState.count === 0) {
    return false;
  }

  const title = normalizeText(item.titleText || item.text).toLowerCase();
  if (!title) return false;

  if (mode === "title-date" && item.rowDate) {
    return skipState.titleDates.has(`${title}|${item.rowDate}`) || skipState.titles.has(title);
  }

  return skipState.titles.has(title);
}

function isExistingRecord(record, skipState) {
  if (!skipState || skipState.count === 0) {
    return false;
  }

  const title = normalizeText(record.title).toLowerCase();
  const date = normalizeText(record.preachedDate);
  const logosId = normalizeText(record.logosId);
  const url = normalizeText(record.url).split("?")[0];

  return Boolean(
    (logosId && skipState.logosIds.has(logosId)) ||
    (url && skipState.urls.has(url)) ||
    (title && date && skipState.titleDates.has(`${title}|${date}`)) ||
    (title && skipState.titles.has(title))
  );
}

function buildSummary(record) {
  const tags = getLogosSermonTags(record);
  const occasionLines = Array.isArray(record.occasions)
    ? record.occasions
      .map((occasion, index) => {
        const details = [
          occasion.date ? `date: ${occasion.date}` : "",
          occasion.venue ? `venue: ${occasion.venue}` : "",
          occasion.service ? `service: ${occasion.service}` : ""
        ].filter(Boolean).join(", ");

        return details ? `${index + 1}. ${details}` : "";
      })
      .filter(Boolean)
    : [];

  return [
    record.preachedDate ? `Preached date: ${record.preachedDate}` : "",
    record.series ? `Series: ${record.series}` : "",
    record.seriesNumber ? `Series number: ${record.seriesNumber}` : "",
    record.venue ? `Venue: ${record.venue}` : "",
    record.service ? `Service: ${record.service}` : "",
    record.speaker ? `Speaker: ${record.speaker}` : "",
    record.duration ? `Duration: ${record.duration}` : "",
    record.wordCount ? `Word count: ${record.wordCount}` : "",
    record.topics?.length ? `Topics: ${record.topics.join(", ")}` : "",
    tags.length ? `Tags: ${tags.join(", ")}` : "",
    occasionLines.length ? `Preaching occasions:\n${occasionLines.join("\n")}` : ""
  ].filter(Boolean).join("\n");
}

function toImportItem(record, defaults = {}) {
  const tags = getLogosSermonTags(record);
  const sourceRefs = [
    record.url ? { type: "logos_url", url: record.url } : null,
    record.logosId ? { type: "logos_id", id: record.logosId } : null,
    record.links?.length ? { type: "logos_links", links: record.links } : null,
    record.logosMetadata ? { type: "logos_metadata", metadata: record.logosMetadata } : null
  ].filter(Boolean);
  const metadata = buildSummary(record);

  return {
    folderId: defaults.folderId || "",
    sermonId: defaults.sermonId || "",
    title: record.title || record.scriptureText || "Imported Logos Sermon",
    tags,
    scriptureText: record.scriptureText || "",
    preachedDate: record.preachedDate || "",
    occasion: Array.isArray(record.occasions) && record.occasions.length > 0
      ? record.occasions
        .map((occasion) => [occasion.date, occasion.venue, occasion.service].filter(Boolean).join(" - "))
        .filter(Boolean)
        .join("\n")
      : [record.venue, record.service].filter(Boolean).join(" - "),
    status: "preached",
    sourceType: "logos_export",
    sourceLabel: record.title ? `Logos export - ${record.title}` : "Logos export",
    importedSummary: metadata,
    importedMaterial: [metadata, record.manuscriptText].filter(Boolean).join("\n\n"),
    sourceRefs,
    developmentNotes: []
  };
}

async function waitForUserLogin(page) {
  console.log("Logos opened. If you are not signed in, sign in in the browser window.");
  console.log("When Sermon Manager is visible, return here and press Enter.");
  await new Promise((resolve) => process.stdin.once("data", resolve));
  await page.bringToFront();
}

async function scrollSermonGridToTitleColumn(page) {
  await page.evaluate(() => {
    const centerViewport = document.querySelector(".ag-center-cols-viewport");

    if (centerViewport && centerViewport.scrollWidth - centerViewport.clientWidth > 100) {
      centerViewport.scrollLeft = Math.max(centerViewport.scrollLeft, 620);
      return;
    }

    for (const element of document.querySelectorAll("*")) {
      if (element.scrollWidth - element.clientWidth > 100) {
        element.scrollLeft = Math.max(element.scrollLeft, 650);
      }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function scrollSermonGridVertically(page, scrollTop) {
  await page.evaluate((targetScrollTop) => {
    const gridViewport = document.querySelector(".ag-body-viewport");

    if (gridViewport) {
      gridViewport.scrollTop = targetScrollTop;
      return;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const candidates = Array.from(document.querySelectorAll("*"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return element.scrollHeight - element.clientHeight > 100 &&
          rect.left > 200 &&
          rect.left < viewportWidth - 50 &&
          rect.top > 80 &&
          rect.height > 250;
      })
      .sort((left, right) =>
        (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight)
      );

    for (const element of candidates.slice(0, 3)) {
      element.scrollTop = targetScrollTop;
    }
  }, scrollTop);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await scrollSermonGridToTitleColumn(page);
}

async function waitForSermonManagerRows(page) {
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/i.test(text);
  }, { timeout: 30000 });
}

async function returnToSermonManager(page, listUrl, listScrollTop) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForSermonManagerRows(page);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await scrollSermonGridToTitleColumn(page);
      if (listScrollTop > 0) {
        await scrollSermonGridVertically(page, listScrollTop);
      }
      return true;
    } catch (error) {
      lastError = error;
      console.log(`Retrying Sermon Manager list load (${attempt}/3): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  console.log(`Unable to return to Sermon Manager after retries: ${lastError?.message || "unknown error"}`);
  return false;
}

async function applySermonManagerSearch(page, query) {
  const cleanQuery = normalizeText(query);
  if (!cleanQuery) return;

  await scrollSermonGridToTitleColumn(page);
  await page.mouse.click(300, 126);
  await page.keyboard.down("Meta");
  await page.keyboard.press("A");
  await page.keyboard.up("Meta");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(cleanQuery, { delay: 5 });
  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await scrollSermonGridToTitleColumn(page);
}

async function clearSermonManagerSearch(page) {
  await page.mouse.click(300, 126);
  await page.keyboard.down("Meta");
  await page.keyboard.press("A");
  await page.keyboard.up("Meta");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

async function sortSermonGridByDateAscending(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => {
      const centerViewport = document.querySelector(".ag-center-cols-viewport");
      if (centerViewport) centerViewport.scrollLeft = 0;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.evaluate(() => {
      const dateButton = Array.from(document.querySelectorAll("button"))
        .find((element) => (element.innerText || element.textContent || "").trim() === "Date");
      dateButton?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const firstYear = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll(".ag-row"))
        .find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.height > 0 && rect.width > 0 && rect.top > 130;
        });
      const text = row ? (row.innerText || row.textContent || "") : "";
      const match = text.match(/\b(20\d{2}|19\d{2})\b/);
      return match ? Number.parseInt(match[1], 10) : 0;
    }).catch(() => 0);

    if (firstYear > 0 && firstYear < 2020) {
      return;
    }
  }
}

async function closeBrowser(browser) {
  let closed = false;
  await Promise.race([
    browser.close().then(() => {
      closed = true;
    }),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]).catch(() => {});

  if (!closed) {
    browser.process()?.kill("SIGTERM");
  }
}

async function getVisibleText(page, selector) {
  const value = await page.evaluate((candidateSelector) => {
    const element = document.querySelector(candidateSelector);
    if (!element) return "";
    if ("value" in element && element.value) return element.value;
    return element.innerText || element.textContent || "";
  }, selector).catch(() => "");

  return normalizeText(value);
}

async function getFirstVisibleText(page, selectors) {
  for (const selector of selectors) {
    const text = await getVisibleText(page, selector);
    if (text) return text;
  }

  return "";
}

async function findListItems(page, { series = "" } = {}) {
  return page.evaluate((selectors, seriesFilter) => {
    const normalize = (value) => typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
    const parseRowTitle = (text) => {
      const dateMatch = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/i);
      if (!dateMatch) return "";
      return normalize(text.slice(dateMatch.index + dateMatch[0].length));
    };
    const parseRowDate = (text) => {
      const dateMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\b/i);
      if (!dateMatch) return "";

      const monthMap = {
        jan: "01",
        feb: "02",
        mar: "03",
        apr: "04",
        may: "05",
        jun: "06",
        jul: "07",
        aug: "08",
        sep: "09",
        sept: "09",
        oct: "10",
        nov: "11",
        dec: "12"
      };
      const month = monthMap[dateMatch[1].toLowerCase()];
      const day = dateMatch[2].padStart(2, "0");
      return month ? `${dateMatch[3]}-${month}-${day}` : "";
    };
    const nonSermonTitles = new Set([
      "all",
      "week",
      "week grid",
      "radial calendar",
      "service",
      "date",
      "title",
      "series",
      "passages",
      "topics",
      "add",
      "blank sermon",
      "no date"
    ]);
    const isCandidateSermonTitle = (value) => {
      const title = normalize(value);
      return title.length >= 4 &&
        title.length <= 180 &&
        !nonSermonTitles.has(title.toLowerCase());
    };
    const getElementBox = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
    };
    const seen = new Set();
    const lowerSeries = normalize(seriesFilter).toLowerCase();
    const items = [];

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const rowScope = document.querySelector(".ag-body-viewport") || document;
    for (const row of rowScope.querySelectorAll("[role='row']")) {
      const rowText = normalize(row.innerText || row.textContent || "");
      const titleText = parseRowTitle(rowText);
      const rowDate = parseRowDate(rowText);

      if (!isCandidateSermonTitle(titleText)) continue;
      if (lowerSeries && !rowText.toLowerCase().includes(lowerSeries)) continue;

      const key = rowText.slice(0, 220);
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({
        text: rowText,
        titleText,
        rowDate,
        href: "",
        selector: "[role='row']",
        index: items.length,
        clickX: 0,
        clickY: 0
      });
    }

    if (items.length > 0) {
      return items;
    }

    const titleButtons = Array.from(document.querySelectorAll("button"))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const buttonText = normalize(button.innerText || button.textContent || "");
        const row = button.closest("[role='row']");
        const rowText = normalize(row?.innerText || row?.textContent || "");

        return {
          buttonText,
          rowText,
          rowDate: parseRowDate(rowText),
          rect
        };
      })
      .filter((candidate) =>
        candidate.buttonText.length >= 4 &&
        candidate.buttonText.length <= 180 &&
        isCandidateSermonTitle(candidate.buttonText) &&
        candidate.rowText.includes(candidate.buttonText) &&
        candidate.rect.top > 100 &&
        candidate.rect.width > 20 &&
        candidate.rect.height > 8 &&
        (!lowerSeries || candidate.rowText.toLowerCase().includes(lowerSeries))
      );

    for (const candidate of titleButtons) {
      const key = `${candidate.buttonText} ${candidate.rowText.slice(0, 120)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({
        text: candidate.rowText || candidate.buttonText,
        titleText: candidate.buttonText,
        rowDate: candidate.rowDate,
        href: "",
        selector: "button",
        index: items.length,
        clickX: candidate.rect.left + candidate.rect.width / 2,
        clickY: candidate.rect.top + candidate.rect.height / 2
      });
    }

    if (items.length > 0) {
      return items;
    }

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
        const element = elements[elementIndex];
        const rect = element.getBoundingClientRect();
        const text = normalize(element.innerText || element.textContent || "");
        if (text.length < 8 || text.length > 1200) continue;
        if (text === "Venue Service Date" || text.includes("No sermon selected")) continue;
        if (rect.width < 250 || rect.height < 12) continue;
        if (rect.top < 250 || rect.left < 430 || rect.left > viewportWidth - 250) continue;
        if (lowerSeries && !text.toLowerCase().includes(lowerSeries)) continue;

        const link = element.querySelector("a[href]") || (element.matches("a[href]") ? element : null);
        const href = link ? link.href : "";
        const titleText = parseRowTitle(text);
        const rowDate = parseRowDate(text);
        const descendants = Array.from(element.querySelectorAll("*"))
          .map((child) => ({
            element: child,
            text: normalize(child.innerText || child.textContent || ""),
            box: getElementBox(child)
          }))
          .filter((candidate) =>
            candidate.text &&
            candidate.box.width > 4 &&
            candidate.box.height > 4 &&
            candidate.box.left >= 0 &&
            candidate.box.left < viewportWidth - 5
          );
        const titleCandidate = titleText
          ? descendants.find((candidate) => candidate.text === titleText) ||
            descendants.find((candidate) => candidate.text.includes(titleText) && candidate.text.length <= titleText.length + 40)
          : null;
        const fallbackCandidate = descendants
          .filter((candidate) => candidate.text.length > 10)
          .sort((left, right) => right.box.left - left.box.left)[0];
        const clickTarget = titleCandidate || fallbackCandidate;
        const clickBox = clickTarget ? clickTarget.box : rect;
        const clickX = Math.min(
          Math.max(clickBox.left + clickBox.width / 2, 5),
          viewportWidth - 5
        );
        const key = href || text.slice(0, 200);
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
          text,
          titleText,
          rowDate,
          href,
          selector,
          index: elementIndex,
          clickX,
          clickY: clickBox.top + clickBox.height / 2
        });
      }
    }

    return items;
  }, LIST_SELECTORS, series);
}

async function openListItem(page, item) {
  if (item.href) {
    await page.goto(item.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    return;
  }

  const clickTitle = () => item.titleText
    ? page.evaluate(({ titleText, rowText }) => {
      const normalize = (value) => typeof value === "string"
        ? value.replace(/\s+/g, " ").trim()
        : "";
      const target = Array.from(document.querySelectorAll("button"))
        .map((button) => {
          const rect = button.getBoundingClientRect();
          const row = button.closest("[role='row']");
          return {
            button,
            rect,
            buttonText: normalize(button.innerText || button.textContent || ""),
            rowText: normalize(row?.innerText || row?.textContent || "")
          };
        })
        .find((candidate) =>
          candidate.buttonText === titleText &&
          candidate.rowText.includes(titleText) &&
          (!rowText || candidate.rowText === rowText || candidate.rowText.includes(titleText)) &&
          candidate.rect.top > 100 &&
          candidate.rect.width > 20 &&
          candidate.rect.height > 8
        )?.button;

      if (target) {
        target.scrollIntoView({ block: "center", inline: "center" });
        target.click();
        return true;
      }

      const targetRow = Array.from(document.querySelectorAll("[role='row']"))
        .find((row) => {
          const candidateRowText = normalize(row.innerText || row.textContent || "");
          return candidateRowText.includes(titleText) &&
            (!rowText || candidateRowText === rowText || candidateRowText.includes(titleText));
        });

      if (!targetRow) {
        return false;
      }

      targetRow.scrollIntoView({ block: "center", inline: "center" });
      targetRow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      targetRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      return true;
    }, { titleText: item.titleText, rowText: item.text })
    : false;
  const clickedTitle = await clickTitle();

  if (!clickedTitle) {
    await page.mouse.click(item.clickX, item.clickY);
  }

  await page.waitForNetworkIdle({ idleTime: 750, timeout: 15000 }).catch(() => {});
  if (!page.url().includes("/documents/sermon/") && item.titleText) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await clickTitle();
    await page.waitForNetworkIdle({ idleTime: 750, timeout: 15000 }).catch(() => {});
  }
  await page.waitForFunction(
    () => location.href.includes("/documents/sermon/") || document.body.innerText.includes("Edit Text"),
    { timeout: 15000 }
  ).catch(() => {});
  await page.waitForFunction(
    () => !document.body.innerText.includes("No sermon selected"),
    { timeout: 5000 }
  ).catch(() => {});
}

async function waitForSermonEditorContent(page) {
  await page.waitForFunction(() => {
    const normalize = (value) => typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
    const candidates = Array.from(document.querySelectorAll("[contenteditable='true'], textarea, [class*='manuscript' i], [data-testid*='manuscript' i]"))
      .map((element) => normalize(element.innerText || element.textContent || element.value || ""))
      .filter(Boolean);

    return candidates.some((candidate) => candidate.length > 200) ||
      document.body.innerText.includes("Edit\nText") ||
      document.body.innerText.includes("Edit Text");
  }, { timeout: 15000 }).catch(() => {});
}

async function extractFieldMap(page) {
  return page.evaluate(() => {
    const normalize = (value) => typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
    const fields = {};
    const labelNodes = Array.from(document.querySelectorAll("label, [role='term'], dt, th, [aria-label]"));

    for (const label of labelNodes) {
      const labelText = normalize(label.innerText || label.textContent || label.getAttribute("aria-label") || "");
      if (!labelText || labelText.length > 80) continue;

      let value = "";
      const forId = label.getAttribute("for");
      if (forId) {
        const field = document.getElementById(forId);
        value = normalize(field?.value || field?.innerText || field?.textContent || "");
      }

      if (!value) {
        const parent = label.closest("div, li, tr, section") || label.parentElement;
        value = normalize(parent?.innerText || parent?.textContent || "").replace(labelText, "").trim();
      }

      if (value && value !== labelText) {
        fields[labelText.toLowerCase()] = value;
      }
    }

    return fields;
  });
}

async function extractEditorFields(page) {
  return page.evaluate(() => {
    const normalize = (value) => typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
    const fields = {};

    for (const element of document.querySelectorAll("input, textarea")) {
      const key = normalize(element.getAttribute("aria-label") || element.getAttribute("placeholder") || "").toLowerCase();
      const value = normalize(element.value || element.innerText || element.textContent || "");

      if (key && value) {
        fields[key] = value;
      }

      if (!fields.date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
        fields.date = value;
      }
    }

    return fields;
  });
}

async function ensureSermonMetadataPanel(page) {
  const hasPanelFields = async () => page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea"))
      .some((element) => {
        const label = element.getAttribute("aria-label") || "";
        return /title|series|speaker|venue|service|passages|topics|tags|audience/i.test(label);
      })
  );

  if (await hasPanelFields()) {
    return;
  }

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const button = buttons.find((candidate) => {
      const label = candidate.getAttribute("title") || candidate.getAttribute("aria-label") || candidate.textContent || "";
      return /information sidebar|info/i.test(label);
    });

    if (button) {
      button.click();
    }
  });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("input, textarea"))
      .some((element) => /title|series|speaker|venue|service|passages|topics|tags|audience/i.test(element.getAttribute("aria-label") || "")),
    { timeout: 5000 }
  ).catch(() => {});
}

async function extractLogosMetadata(page) {
  await ensureSermonMetadataPanel(page);

  return page.evaluate(async () => {
    const normalize = (value) => typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const fields = {};
    const fieldEntries = [];
    const seenFieldElements = new WeakSet();
    const links = [];
    const seenLinks = new Set();
    const panelTexts = new Set();

    const collect = () => {
      for (const element of document.querySelectorAll("input, textarea, select")) {
        const rect = element.getBoundingClientRect();
        if (rect.left < viewportWidth * 0.5 && !(element.getAttribute("aria-label") || "").match(/sermon title/i)) {
          continue;
        }

        const key = normalize(element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.name || "");
        const value = normalize(element.value || element.textContent || "");

        if (key && value) {
          fields[key] = value;
          if (!seenFieldElements.has(element)) {
            seenFieldElements.add(element);
            fieldEntries.push({
              key,
              value,
              ariaLabel: normalize(element.getAttribute("aria-label") || ""),
              placeholder: normalize(element.getAttribute("placeholder") || ""),
              name: normalize(element.name || "")
            });
          }
        }

        if (!fields.Date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
          fields.Date = value;
        }
      }

      for (const link of document.querySelectorAll("a[href]")) {
        const rect = link.getBoundingClientRect();
        if (rect.left < viewportWidth * 0.5) {
          continue;
        }

        const href = link.href || "";
        const text = normalize(link.innerText || link.textContent || link.getAttribute("aria-label") || "");
        const key = `${text}|${href}`;

        if (href && !seenLinks.has(key)) {
          seenLinks.add(key);
          links.push({ text, href });
        }
      }

      const rightText = Array.from(document.querySelectorAll("section, aside, [role='region'], div"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.left < viewportWidth * 0.55 || rect.width < 120 || rect.height < 40) {
            return "";
          }
          return normalize(element.innerText || element.textContent || "");
        })
        .filter((value) => value && value.length > 20 && value.length < 3000)
        .sort((left, right) => right.length - left.length)[0] || "";

      if (rightText) {
        panelTexts.add(rightText);
      }
    };

    const scrollContainers = Array.from(document.querySelectorAll("*"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left > viewportWidth * 0.5 &&
          rect.width > 120 &&
          rect.height > 120 &&
          element.scrollHeight > element.clientHeight + 20;
      })
      .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));
    const containers = scrollContainers.length > 0 ? scrollContainers.slice(0, 3) : [document.scrollingElement || document.documentElement];

    for (const container of containers) {
      const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 0);
      const steps = maxScroll > 0
        ? [0, Math.floor(maxScroll * 0.33), Math.floor(maxScroll * 0.66), maxScroll]
        : [0];

      for (const top of steps) {
        container.scrollTop = top;
        await new Promise((resolve) => setTimeout(resolve, 100));
        collect();
      }
    }

    collect();

    return {
      fields,
      fieldEntries,
      links,
      panelText: Array.from(panelTexts).sort((left, right) => right.length - left.length)[0] || ""
    };
  });
}

function pickField(fields, names) {
  for (const [key, value] of Object.entries(fields)) {
    if (names.some((name) => key.includes(name))) {
      return normalizeText(value);
    }
  }

  return "";
}

function pickPanelValue(panelText, label, nextLabels = []) {
  const text = normalizeText(panelText);
  const start = text.indexOf(label);

  if (start === -1) {
    return "";
  }

  const afterLabel = text.slice(start + label.length).trim();
  const nextIndexes = nextLabels
    .map((nextLabel) => afterLabel.indexOf(nextLabel))
    .filter((index) => index >= 0);
  const end = nextIndexes.length > 0 ? Math.min(...nextIndexes) : afterLabel.length;

  return afterLabel
    .slice(0, end)
    .replace(/\s+×/g, "")
    .replace(/\+ Add .*/i, "")
    .trim();
}

function splitMetadataList(value) {
  const text = normalizeText(value);

  if (!text) {
    return [];
  }

  return text
    .split(/[,;]\s*|\s{2,}/)
    .map((item) => normalizeText(item.replace(/×/g, "")))
    .filter(Boolean);
}

function extractOccasionsFromMetadata(metadata = {}) {
  const entries = Array.isArray(metadata.fieldEntries) ? metadata.fieldEntries : [];
  const occasions = [];
  let current = null;

  const pushCurrent = () => {
    if (!current || (!current.date && !current.rawDate && !current.venue && !current.service)) {
      return;
    }

    const key = [current.date || current.rawDate || "", current.venue || "", current.service || ""].join("|").toLowerCase();
    if (!occasions.some((occasion) => [occasion.date || occasion.rawDate || "", occasion.venue || "", occasion.service || ""].join("|").toLowerCase() === key)) {
      occasions.push(current);
    }
  };

  for (const entry of entries) {
    const key = normalizeText(entry.key).toLowerCase();
    const value = normalizeText(entry.value);
    if (!key || !value) continue;

    if (key === "date" || key.includes("occasion date")) {
      pushCurrent();
      current = {
        date: normalizeDate(value),
        rawDate: value
      };
      continue;
    }

    if (key.includes("venue")) {
      current ||= {};
      current.venue = value;
      continue;
    }

    if (key.includes("service/time") || key.includes("service time") || key === "service") {
      current ||= {};
      current.service = value;
    }
  }

  pushCurrent();

  if (occasions.length > 0) {
    return occasions;
  }

  const fields = metadata.fields || {};
  const date = normalizeDate(fields.Date || fields.date || "");
  const venue = normalizeText(fields["Venue (Church or other setting)"] || fields.venue || "");
  const service = normalizeText(fields["Service/Time"] || fields.service || "");

  return date || venue || service ? [{ date, rawDate: fields.Date || fields.date || "", venue, service }] : [];
}

function getPrimaryOccasion(occasions) {
  if (!Array.isArray(occasions) || occasions.length === 0) {
    return {};
  }

  return occasions
    .slice()
    .sort((left, right) => (right.date || "").localeCompare(left.date || ""))[0];
}

async function extractSermon(page, listItem) {
  const title = await getFirstVisibleText(page, TITLE_SELECTORS);
  const manuscriptText = await getFirstVisibleText(page, MANUSCRIPT_SELECTORS);
  const fields = await extractFieldMap(page);
  const metadata = await extractLogosMetadata(page);
  const editorFields = Object.fromEntries(
    Object.entries({
      ...await extractEditorFields(page),
      ...metadata.fields
    }).map(([key, value]) => [key.toLowerCase(), value])
  );
  const url = page.url();
  const urlIdMatch = url.match(/(?:sermon|document|doc)[=/]([^/?#&]+)/i);
  const panelText = metadata.panelText || "";
  const panelTopics = pickPanelValue(panelText, "Topics", ["Passages", "Tags", "Description"]);
  const panelPassages = pickPanelValue(panelText, "Passages", ["Tags", "Description", "Target Duration"]);
  const panelTags = pickPanelValue(panelText, "Tags", ["Description", "Target Duration", "Private Notes"]);
  const panelAudience = pickPanelValue(panelText, "Audience", ["Liturgy"]);
  const topics = splitMetadataList(editorFields.topics || panelTopics || pickField(fields, ["topic"]));
  const occasions = extractOccasionsFromMetadata(metadata);
  const primaryOccasion = getPrimaryOccasion(occasions);

  return {
    title: editorFields["sermon title"] || editorFields.title || title || normalizeText(listItem.titleText) || normalizeText(listItem.text.split(/\n/)[0]),
    manuscriptText,
    preachedDate: primaryOccasion.date || normalizeDate(editorFields.date || pickField(fields, ["date", "preached"])),
    venue: primaryOccasion.venue || editorFields["venue (church or other setting)"] || pickField(fields, ["venue", "location"]),
    service: primaryOccasion.service || editorFields["service/time"] || pickField(fields, ["service"]),
    occasions,
    series: editorFields.series || pickField(fields, ["series"]),
    seriesNumber: editorFields["number (in series)"] || pickField(fields, ["number"]),
    scriptureText: editorFields.passages || panelPassages || "",
    speaker: editorFields.speaker || pickField(fields, ["speaker", "preacher"]),
    duration: pickField(fields, ["duration", "length"]),
    wordCount: pickField(fields, ["word count", "words"]),
    topics,
    tags: mergeLogosTags(
      splitMetadataList(editorFields.tags || panelTags),
      getLogosSermonTags({ manuscriptText })
    ),
    audience: editorFields.audience || panelAudience || "",
    description: editorFields.description || pickPanelValue(panelText, "Description", ["Target Duration", "Private Notes", "Links"]),
    targetDuration: editorFields["target duration"] || "",
    privateNotes: editorFields["private notes"] || "",
    links: metadata.links,
    logosMetadata: metadata,
    url,
    logosId: urlIdMatch ? decodeURIComponent(urlIdMatch[1]) : ""
  };
}

async function postBatch({ apiUrl, apiKey, items, rebuild, embed, batchSize }) {
  if (!apiKey) {
    throw new Error("Missing API key. Set BHE_API_KEY or pass --api-key.");
  }

  const endpoint = `${apiUrl.replace(/\/+$/, "")}/sermons/import/batch`;
  const responses = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        items: batch,
        rebuildChunks: rebuild,
        embedChunks: embed
      })
    });
    const data = await response.json().catch(() => ({}));
    responses.push({ status: response.status, data });

    if (!response.ok && response.status !== 207) {
      throw new Error(`Batch POST failed: ${response.status} ${JSON.stringify(data)}`);
    }
  }

  return responses;
}

async function runTargetQueueExtraction({ page, args, listUrl, skipState, records }) {
  const queue = readJsonRecords(args.targetQueue).slice(args.targetStartIndex);
  let skippedExistingCount = 0;
  let notFoundCount = 0;
  let mismatchCount = 0;
  let attemptedTargetCount = 0;

  console.log(`Target queue mode: ${queue.length} queued rows from ${args.targetQueue}.`);

  for (const target of queue) {
    if (records.length >= args.limit) {
      break;
    }
    if (args.targetMaxAttempts > 0 && attemptedTargetCount >= args.targetMaxAttempts) {
      break;
    }
    attemptedTargetCount += 1;

    const targetLabel = `${target.preachedDate || "(no date)"} - ${target.title || "(untitled)"}`;
    let listScrollTop = estimateScrollTopForExportRow(target.rowNumber);
    const listLoaded = await returnToSermonManager(page, listUrl, 0);
    if (!listLoaded) {
      notFoundCount += 1;
      console.log(`Target not loaded ${targetLabel}`);
      continue;
    }
    await sortSermonGridByDateAscending(page);

    let item = null;
    let candidates = [];

    const scrollOffsets = [0];
    for (let offset = 360; offset <= 5400; offset += 360) {
      scrollOffsets.push(-offset, offset);
    }

    for (const offset of scrollOffsets) {
      if (item) break;
      listScrollTop = Math.max(estimateScrollTopForExportRow(target.rowNumber) + offset, 0);
      await scrollSermonGridVertically(page, listScrollTop);
      await new Promise((resolve) => setTimeout(resolve, 650));
      candidates = await findListItems(page, { series: args.series });
      item = candidates.find((candidate) => targetMatchesCandidate(target, candidate));
    }

    if (!item) {
      notFoundCount += 1;
      console.log(`Target not found ${targetLabel}`);
      continue;
    }

    await scrollSermonGridToTitleColumn(page);
    await openListItem(page, item);
    await waitForSermonEditorContent(page);
    const record = await extractSermon(page, item);

    if (!record.url.includes("/documents/sermon/") || record.manuscriptText.length === 0) {
      notFoundCount += 1;
      console.log(`Skipped target ${targetLabel} - did not open a sermon manuscript`);
      continue;
    }

    if (!recordMatchesTarget(record, target)) {
      mismatchCount += 1;
      console.log(`Skipped target ${targetLabel} - opened ${record.preachedDate || "(no date)"} - ${record.title || "(untitled)"}`);
      continue;
    }

    if (isExistingRecord(record, skipState)) {
      skippedExistingCount += 1;
      console.log(`Skipped existing target ${targetLabel}`);
      continue;
    }

    record.logosExportTarget = target;
    records.push(record);
    fs.appendFileSync(args.out, `${JSON.stringify(record)}\n`);
    console.log(`[${records.length}/${args.limit}] ${record.title || "(untitled)"} - ${record.manuscriptText.length} chars`);
  }

  console.log(JSON.stringify({
    targetQueue: args.targetQueue,
    attemptedTargetCount,
    extracted: records.length,
    skippedExistingCount,
    notFoundCount,
    mismatchCount
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, "");
  const skipState = buildExistingSkipState(args.skipExistingFiles);

  const browser = await puppeteer.launch({
    headless: args.headless,
    userDataDir: args.profileDir,
    defaultViewport: { width: 1440, height: 1000 }
  });
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  for (const extra of pages.slice(1)) {
    await extra.close().catch(() => {});
  }
  page.setDefaultTimeout(30000);
  await page.goto(args.startUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForUserLogin(page);
  await waitForSermonManagerRows(page);
  await scrollSermonGridToTitleColumn(page);

  const listUrl = page.url();
  const records = [];
  const attemptedKeys = new Set();
  let listScrollTop = args.startScrollTop;
  let skippedExistingCount = 0;

  console.log(`Extracting up to ${args.limit} sermon rows.`);
  if (skipState.count > 0) {
    console.log(`Skipping ${skipState.count} existing records from ${args.skipExistingFiles.join(", ")} using ${args.skipExistingMatch} matching.`);
  }
  if (listScrollTop > 0) {
    await scrollSermonGridVertically(page, listScrollTop);
    console.log(`Starting Sermon Manager grid at scrollTop ${listScrollTop}.`);
  }

  if (args.targetQueue) {
    await runTargetQueueExtraction({ page, args, listUrl, skipState, records });
  } else {

    const maxAttempts = Math.max(args.limit * 20, 2000);
    for (let attempt = 0; records.length < args.limit && attempt < maxAttempts; attempt += 1) {
    if (attempt > 0 || !page.url().includes("/tools/sermon-manager")) {
      const listLoaded = await returnToSermonManager(page, listUrl, listScrollTop);
      if (!listLoaded) {
        break;
      }
    }

    let candidates = await findListItems(page, { series: args.series });
    let skippedVisibleExisting = 0;
    let item = candidates.find((candidate) => {
      const key = getCandidateSkipKey(candidate, args.skipExistingMatch);
      if (!key || attemptedKeys.has(key)) {
        return false;
      }

      if (isExistingCandidate(candidate, skipState, args.skipExistingMatch)) {
        attemptedKeys.add(key);
        skippedExistingCount += 1;
        skippedVisibleExisting += 1;
        return false;
      }

      return true;
    });

    if (!item && skippedVisibleExisting > 0) {
      console.log(`Skipped ${skippedVisibleExisting} visible existing rows; scrolling for new rows.`);
    }

    for (let scrollAttempt = 0; !item && scrollAttempt < 20; scrollAttempt += 1) {
      listScrollTop += 840;
      await scrollSermonGridVertically(page, listScrollTop);
      candidates = await findListItems(page, { series: args.series });
      item = candidates.find((candidate) => {
        const key = getCandidateSkipKey(candidate, args.skipExistingMatch);
        if (!key || attemptedKeys.has(key)) {
          return false;
        }

        if (isExistingCandidate(candidate, skipState, args.skipExistingMatch)) {
          attemptedKeys.add(key);
          skippedExistingCount += 1;
          return false;
        }

        return true;
      });
    }

    if (!item) {
      console.log(`No unprocessed sermon rows found after ${records.length} records.`);
      break;
    }

    attemptedKeys.add(getCandidateSkipKey(item, args.skipExistingMatch));
    await openListItem(page, item);
    await waitForSermonEditorContent(page);
    const record = await extractSermon(page, item);

    if (!record.url.includes("/documents/sermon/") || record.manuscriptText.length === 0) {
      console.log(`Skipped ${record.title || item.titleText || "(untitled)"} - did not open a sermon manuscript`);
      continue;
    }

    if (isExistingRecord(record, skipState)) {
      skippedExistingCount += 1;
      console.log(`Skipped existing ${record.title || "(untitled)"} - already captured`);
      continue;
    }

    records.push(record);
    fs.appendFileSync(args.out, `${JSON.stringify(record)}\n`);
    console.log(`[${records.length}/${args.limit}] ${record.title || "(untitled)"} - ${record.manuscriptText.length} chars`);
  }
  }

  if (args.post) {
    const postableRecords = records.filter((record) => record.manuscriptText.length >= args.minChars);
    const skippedRecords = records
      .filter((record) => record.manuscriptText.length < args.minChars)
      .map((record) => ({
        title: record.title,
        chars: record.manuscriptText.length
      }));

    if (skippedRecords.length > 0) {
      console.log(JSON.stringify({
        skippedPostCount: skippedRecords.length,
        minChars: args.minChars,
        skippedRecords
      }, null, 2));
    }

    const items = postableRecords.map((record) => toImportItem(record, { folderId: args.folderId }));
    const responses = await postBatch({
      apiUrl: args.apiUrl,
      apiKey: args.apiKey,
      items,
      rebuild: args.rebuild,
      embed: args.embed,
      batchSize: args.batchSize
    });
    console.log(JSON.stringify({ postedBatches: responses.length, responses }, null, 2));
  }

  if (args.keepOpen) {
    console.log("Keeping browser open. Press Ctrl+C when finished.");
    await new Promise(() => {});
  }

  await closeBrowser(browser);
  console.log(`Wrote ${records.length} records to ${args.out}`);
  if (skipState.count > 0) {
    console.log(`Skipped ${skippedExistingCount} existing rows or records.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
