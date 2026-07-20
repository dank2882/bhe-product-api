#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    exportFile: "",
    match: "",
    conversationId: "",
    out: "",
    apiUrl: process.env.BHE_API_URL || "https://bhe-product-api-mwhc25pkra-uw.a.run.app",
    apiKey: process.env.BHE_API_KEY || "",
    post: false,
    sermonId: "",
    folderId: "",
    title: "",
    sourceLabel: "",
    sourceType: "old_chat"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--export") args.exportFile = next;
    else if (token === "--match") args.match = next;
    else if (token === "--conversation-id") args.conversationId = next;
    else if (token === "--out") args.out = next;
    else if (token === "--api-url") args.apiUrl = next;
    else if (token === "--api-key") args.apiKey = next;
    else if (token === "--post") args.post = true;
    else if (token === "--sermon-id") args.sermonId = next;
    else if (token === "--folder-id") args.folderId = next;
    else if (token === "--title") args.title = next;
    else if (token === "--source-label") args.sourceLabel = next;
    else if (token === "--source-type") args.sourceType = next;

    if (token.startsWith("--") && next && !next.startsWith("--") && token !== "--post") {
      index += 1;
    }
  }

  if (!args.exportFile) throw new Error("Missing --export <conversations.json>");
  if (!args.match && !args.conversationId) throw new Error("Pass --match <text> or --conversation-id <id>.");
  return args;
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function getMessageText(message = {}) {
  const content = message.content || {};
  if (Array.isArray(content.parts)) {
    return content.parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return part.text || JSON.stringify(part);
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof content.text === "string") return content.text;
  if (typeof message.text === "string") return message.text;
  return "";
}

function readConversations(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.conversations)) return data.conversations;
  throw new Error("Export JSON did not look like conversations.json.");
}

function findConversation(conversations, args) {
  if (args.conversationId) {
    const byId = conversations.find((conversation) => conversation.id === args.conversationId);
    if (!byId) throw new Error(`No conversation found with id ${args.conversationId}`);
    return byId;
  }

  const needle = normalizeText(args.match).toLowerCase();
  const matches = conversations
    .map((conversation) => ({
      conversation,
      haystack: [
        conversation.title,
        conversation.id,
        ...Object.values(conversation.mapping || {}).map((node) => getMessageText(node.message || node))
      ].join("\n").toLowerCase()
    }))
    .filter((item) => item.haystack.includes(needle));

  if (matches.length === 0) throw new Error(`No conversation matched "${args.match}".`);
  if (matches.length > 1) {
    console.log("Multiple conversations matched; using the first:");
    for (const { conversation } of matches.slice(0, 10)) {
      console.log(`- ${conversation.id || ""} ${conversation.title || "(untitled)"}`);
    }
  }
  return matches[0].conversation;
}

function linearizeConversation(conversation) {
  const nodes = Object.values(conversation.mapping || {})
    .filter((node) => node?.message || node?.id)
    .map((node) => {
      const message = node.message || node;
      return {
        id: node.id || message.id || "",
        parent: node.parent || "",
        createTime: message.create_time || message.createTime || 0,
        role: message.author?.role || message.role || "",
        text: getMessageText(message)
      };
    })
    .filter((item) => item.role && item.text)
    .sort((left, right) => {
      const byTime = Number(left.createTime || 0) - Number(right.createTime || 0);
      return byTime || left.id.localeCompare(right.id);
    });

  return [
    `# ${conversation.title || "ChatGPT Conversation"}`,
    "",
    `Conversation ID: ${conversation.id || ""}`,
    "",
    ...nodes.flatMap((item, index) => [
      `## ${index + 1}. ${item.role}`,
      "",
      item.text.trim(),
      ""
    ])
  ].join("\n").trim() + "\n";
}

function splitTranscript(transcript, maxChars = 22000) {
  if (transcript.length <= maxChars) return [transcript];

  const parts = [];
  const sections = transcript.split(/\n(?=## \d+\. )/);
  let current = sections.shift() || "";

  for (const section of sections) {
    const next = current ? `${current}\n${section}` : section;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) parts.push(current.trim() + "\n");
      current = section;
    }
  }

  if (current) parts.push(current.trim() + "\n");
  return parts;
}

async function postImport(args, material, { sermonId = "", sourceLabel = "" } = {}) {
  if (!args.apiKey) throw new Error("Missing API key. Set BHE_API_KEY or pass --api-key.");
  const endpoint = `${args.apiUrl.replace(/\/+$/, "")}/sermons/import`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey
    },
    body: JSON.stringify({
      sermonId,
      folderId: args.folderId,
      title: args.title,
      sourceType: args.sourceType,
      sourceLabel,
      importedSummary: "Full ChatGPT sermon-development conversation transcript imported for preservation.",
      importedMaterial: material,
      updateMode: "create_or_update"
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Import failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function postConversation(args, transcript) {
  const parts = splitTranscript(transcript);
  const results = [];
  let sermonId = args.sermonId;

  for (let index = 0; index < parts.length; index += 1) {
    const sourceLabelBase = args.sourceLabel || args.title || "ChatGPT sermon development conversation";
    const sourceLabel = parts.length > 1
      ? `${sourceLabelBase} - transcript part ${index + 1} of ${parts.length}`
      : sourceLabelBase;
    const data = await postImport(args, parts[index], { sermonId, sourceLabel });
    sermonId = sermonId || data.sermon?.sermonId || "";
    results.push({
      part: index + 1,
      chars: parts[index].length,
      action: data.action,
      sermonId: data.sermon?.sermonId || sermonId,
      sourceId: data.source?.sourceId || ""
    });
  }

  return {
    partCount: parts.length,
    sermonId,
    results
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const conversation = findConversation(readConversations(args.exportFile), args);
  const transcript = linearizeConversation(conversation);
  const out = args.out || path.join("tmp", `${conversation.id || "chatgpt-conversation"}.txt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, transcript);

  const result = {
    conversationId: conversation.id || "",
    title: conversation.title || "",
    out,
    chars: transcript.length
  };

  if (args.post) {
    result.importResult = await postConversation(args, transcript);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
