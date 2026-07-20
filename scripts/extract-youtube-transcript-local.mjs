#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import puppeteer from "puppeteer";

const DEFAULT_API_URL = "https://bhe-product-api-265001256563.us-west1.run.app";

function parseArgs(argv) {
  const args = {
    url: "",
    out: "",
    mediaId: "",
    apiUrl: process.env.BHE_API_URL || DEFAULT_API_URL,
    apiKey: process.env.BHE_API_KEY || "",
    profileDir: path.resolve("tmp/youtube-transcript-profile"),
    startSeconds: null,
    endSeconds: null,
    rebuildChunks: true
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--") && !args.url) {
      args.url = arg;
      continue;
    }

    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];

    switch (key) {
      case "--out":
        args.out = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case "--media-id":
        args.mediaId = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case "--api-url":
        args.apiUrl = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case "--api-key":
        args.apiKey = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case "--profile-dir":
        args.profileDir = path.resolve(nextValue);
        if (inlineValue === undefined) index += 1;
        break;
      case "--start-seconds":
        args.startSeconds = Number(nextValue);
        if (inlineValue === undefined) index += 1;
        break;
      case "--end-seconds":
        args.endSeconds = Number(nextValue);
        if (inlineValue === undefined) index += 1;
        break;
      case "--no-rebuild":
        args.rebuildChunks = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.url) {
    throw new Error("Usage: npm run youtube:transcript -- <youtube-url> [--out tmp/transcript.txt] [--media-id media-...]");
  }

  return args;
}

function parseTimestampSeconds(value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return 0;
  if (/^\d+$/.test(cleanValue)) return Number(cleanValue);

  const match = cleanValue.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (!match || !match[0]) return 0;

  return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
}

function inferStartSeconds(url) {
  try {
    const parsed = new URL(url);
    return parseTimestampSeconds(
      parsed.searchParams.get("t") ||
      parsed.searchParams.get("start") ||
      parsed.searchParams.get("time_continue")
    );
  } catch {
    return 0;
  }
}

function safeOutputPath(url) {
  let id = "youtube-transcript";

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    id = parsed.searchParams.get("v") || parts.at(-1) || id;
  } catch {
    // Keep fallback.
  }

  return path.resolve("tmp", `${id.replace(/[^a-zA-Z0-9_-]+/g, "-")}.transcript.txt`);
}

async function scrapeTranscriptSegments(page) {
  return page.evaluate(() => {
    const parseTime = (value) => {
      const parts = String(value || "")
        .trim()
        .split(":")
        .map((part) => Number(part));

      if (parts.some((part) => !Number.isFinite(part))) return 0;
      if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      if (parts.length === 2) return (parts[0] * 60) + parts[1];
      return parts[0] || 0;
    };

    const segmentNodes = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
    const segments = segmentNodes.map((node) => {
      const timestamp = node.querySelector(".segment-timestamp, yt-formatted-string[class*='timestamp']")?.textContent || "";
      const text = node.querySelector(".segment-text, yt-formatted-string.segment-text")?.textContent ||
        node.textContent?.replace(timestamp, "") ||
        "";

      return {
        startSeconds: parseTime(timestamp),
        timestamp: timestamp.trim(),
        text: text.replace(/\s+/g, " ").trim()
      };
    }).filter((segment) => segment.text);

    if (segments.length) {
      return segments;
    }

    const fallbackText = document.body.innerText || "";
    return fallbackText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ startSeconds: 0, timestamp: "", text }));
  });
}

function buildTranscript(segments, { startSeconds = 0, endSeconds = 0 }) {
  const lines = [];
  let previous = "";

  for (const segment of segments) {
    if (startSeconds && segment.startSeconds && segment.startSeconds < startSeconds) {
      continue;
    }

    if (endSeconds && segment.startSeconds && segment.startSeconds > endSeconds) {
      continue;
    }

    if (!segment.text || segment.text === previous) {
      continue;
    }

    lines.push(segment.text);
    previous = segment.text;
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function postTranscript({ apiUrl, apiKey, mediaId, transcriptText, rebuildChunks }) {
  if (!mediaId) {
    return null;
  }

  if (!apiKey) {
    throw new Error("Posting to backend requires BHE_API_KEY in env or --api-key.");
  }

  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/sermon-media/${encodeURIComponent(mediaId)}/transcript-source`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey
    },
    body: JSON.stringify({
      transcriptKind: "raw",
      transcriptText,
      rebuildChunks,
      sourceLabel: "Raw YouTube transcript"
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Backend transcript save failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

const args = parseArgs(process.argv);
const startSeconds = Number.isFinite(args.startSeconds) ? args.startSeconds : inferStartSeconds(args.url);
const endSeconds = Number.isFinite(args.endSeconds) ? args.endSeconds : 0;
const outPath = path.resolve(args.out || safeOutputPath(args.url));

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.mkdir(args.profileDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  userDataDir: args.profileDir,
  defaultViewport: null,
  args: ["--start-maximized"]
});

try {
  const [page] = await browser.pages();
  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 90_000 });

  const rl = readline.createInterface({ input, output });
  await rl.question([
    "",
    "In the browser:",
    "1. Sign in if needed.",
    "2. Open the YouTube transcript panel.",
    "3. Make sure transcript text is visible.",
    "Then press Enter here to capture it. "
  ].join("\n"));
  rl.close();

  const segments = await scrapeTranscriptSegments(page);
  const transcriptText = buildTranscript(segments, { startSeconds, endSeconds });

  if (transcriptText.length < 50) {
    throw new Error("Transcript capture was too short. Make sure the transcript panel is open and visible.");
  }

  await fs.writeFile(outPath, transcriptText, "utf8");
  await fs.writeFile(
    outPath.replace(/\.txt$/i, ".json"),
    JSON.stringify({ url: args.url, startSeconds, endSeconds, segmentCount: segments.length, transcriptText }, null, 2),
    "utf8"
  );

  const posted = await postTranscript({
    apiUrl: args.apiUrl,
    apiKey: args.apiKey,
    mediaId: args.mediaId,
    transcriptText,
    rebuildChunks: args.rebuildChunks
  });

  console.log(`Saved transcript: ${outPath}`);
  console.log(`Characters: ${transcriptText.length}`);

  if (posted) {
    console.log(`Backend source saved: ${posted.source?.sourceId || "(unknown source id)"}`);
    console.log(`Chunks rebuilt: ${posted.rebuild?.rebuiltCount ?? "(not reported)"}`);
  }
} finally {
  await browser.close();
}
