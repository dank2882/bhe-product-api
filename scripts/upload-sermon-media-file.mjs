#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_API_URL = process.env.BHE_API_URL || "https://bhe-product-api-265001256563.us-west1.run.app";

const CONTENT_TYPES = new Map([
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".aac", "audio/aac"],
  [".ogg", "audio/ogg"],
  [".webm", "video/webm"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"]
]);

function parseArgs(argv) {
  const args = {
    sermonId: "",
    file: "",
    apiUrl: DEFAULT_API_URL,
    apiKey: process.env.BHE_API_KEY || "",
    contentType: "",
    title: "",
    label: "",
    recordedAt: "",
    notes: "",
    transcribe: false,
    rebuildChunks: true,
    embedChunks: false,
    embedLimit: 50
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? argv[index + 1];

    switch (key) {
      case "--sermon-id":
        args.sermonId = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--file":
        args.file = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--api-url":
        args.apiUrl = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--api-key":
        args.apiKey = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--content-type":
        args.contentType = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--title":
        args.title = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--label":
        args.label = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--recorded-at":
        args.recordedAt = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--notes":
        args.notes = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--transcribe":
        args.transcribe = true;
        break;
      case "--no-rebuild":
        args.rebuildChunks = false;
        break;
      case "--embed":
        args.embedChunks = true;
        break;
      case "--embed-limit":
        args.embedLimit = Number(value) || 50;
        if (inlineValue === undefined) index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.sermonId || !args.file) {
    throw new Error("Usage: npm run sermon:upload-media -- --sermon-id SERMON_ID --file /path/to/audio.m4a [--transcribe]");
  }

  if (!args.apiKey) {
    throw new Error("Missing API key. Set BHE_API_KEY or pass --api-key.");
  }

  return args;
}

function inferContentType(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

async function apiFetch(apiUrl, apiKey, route, options = {}) {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${route}`, {
    ...options,
    headers: {
      "X-API-Key": apiKey,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

const args = parseArgs(process.argv);
const filePath = path.resolve(args.file);
const stat = await fs.stat(filePath);

if (!stat.isFile()) {
  throw new Error(`Not a file: ${filePath}`);
}

const filename = path.basename(filePath);
const contentType = args.contentType || inferContentType(filePath);

if (!contentType.startsWith("audio/") && !contentType.startsWith("video/")) {
  throw new Error(`Unsupported media content type: ${contentType}`);
}

const uploadTarget = await apiFetch(
  args.apiUrl,
  args.apiKey,
  `/sermons/${encodeURIComponent(args.sermonId)}/media/upload-url`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filename,
      contentType,
      title: args.title,
      label: args.label,
      recordedAt: args.recordedAt,
      notes: args.notes
    })
  }
);

const buffer = await fs.readFile(filePath);
const uploadResponse = await fetch(uploadTarget.upload.uploadUrl, {
  method: uploadTarget.upload.method || "PUT",
  headers: {
    "Content-Type": contentType
  },
  body: buffer
});

if (!uploadResponse.ok) {
  throw new Error(`Media upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
}

console.log(`Uploaded media: ${uploadTarget.media.mediaId}`);
console.log(`Storage path: ${uploadTarget.upload.storagePath}`);

if (args.transcribe) {
  const transcription = await apiFetch(
    args.apiUrl,
    args.apiKey,
    `/sermon-media/${encodeURIComponent(uploadTarget.media.mediaId)}/transcribe`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rebuildChunks: args.rebuildChunks,
        embedChunks: args.embedChunks,
        embedLimit: args.embedLimit
      })
    }
  );

  console.log(`Transcript source: ${transcription.source?.sourceId || "(unknown)"}`);
  console.log(`Transcript characters: ${transcription.transcription?.textLength || 0}`);
  console.log(`Chunks rebuilt: ${transcription.rebuild?.rebuiltCount ?? "(not reported)"}`);
  console.log(`Chunks embedded: ${transcription.embed?.embeddedCount ?? 0}`);
}
