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
  return (Array.isArray(blocks) ? blocks : [])
    .map((block) => collectText(block, []).join(" "))
    .map(normalizeText)
    .filter(Boolean)
    .join("\n");
}

function extractTagText(tags = []) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => normalizeText(tag?.text || tag?.value || tag))
    .filter(Boolean);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = normalizeText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function uniqueOccasions(values = []) {
  const seen = new Set();
  const occasions = [];
  for (const value of values) {
    const occasion = {
      date: normalizeText(value?.date),
      venue: normalizeText(value?.venue),
      service: normalizeText(value?.service)
    };
    if (!occasion.date && !occasion.venue && !occasion.service) continue;
    const key = [occasion.date, occasion.venue.toLowerCase(), occasion.service.toLowerCase()].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    occasions.push(occasion);
  }
  return occasions;
}

function getSeriesTitle(info = {}) {
  return normalizeText(info.seriesTitle || info.series?.title || info.series);
}

function toLogosSermonRecord(rows = []) {
  const primary = rows.find((row) => row?.document) || rows[0] || {};
  const document = primary.document || {};
  const info = document.content?.info || {};
  const fallbackOccasions = rows.map((row) => ({
    date: row.occasionDate,
    venue: row.occasionVenue,
    service: row.occasionService
  }));
  const occasions = uniqueOccasions([
    ...(Array.isArray(info.occasions) ? info.occasions : []),
    ...fallbackOccasions
  ]);
  const tags = uniqueStrings(extractTagText(info.tagsInfo?.miscellaneousTags));
  const topics = uniqueStrings(extractTagText(info.tagsInfo?.topicTags));
  const passages = uniqueStrings(extractTagText(info.tagsInfo?.referenceTags));
  const audience = uniqueStrings(info.audiences || []);
  const description = blocksToText(info.description || []);
  const privateNotes = blocksToText(info.notes || []);
  const manuscriptText = blocksToText(document.content?.blocks || document.blocks || []);
  const logosId = normalizeText(primary.externalId);
  const series = getSeriesTitle(info);
  const seriesNumber = info.seriesNumber == null ? "" : String(info.seriesNumber);

  return {
    title: normalizeText(document.title),
    logosId,
    url: logosId
      ? `https://app.logos.com/documents/sermon/${logosId}?title=${encodeURIComponent(document.title || "")}&layout=one`
      : "",
    preachedDate: normalizeText(occasions[0]?.date || primary.occasionDate),
    venue: normalizeText(occasions[0]?.venue || primary.occasionVenue),
    service: normalizeText(occasions[0]?.service || primary.occasionService),
    occasions,
    series,
    seriesNumber,
    speaker: normalizeText(info.author?.name),
    scriptureText: passages.join("; "),
    topics,
    tags,
    audience,
    description,
    targetDuration: info.targetDuration == null ? "" : String(info.targetDuration),
    privateNotes,
    manuscriptText,
    links: Array.isArray(info.fileLinks) ? info.fileLinks : [],
    logosMetadata: {
      capturedFrom: "sermon_scheduler_api",
      rawExternalId: logosId,
      rowCount: rows.length,
      audience,
      status: normalizeText(info.status),
      language: normalizeText(info.language),
      notebookId: normalizeText(info.notebookId),
      isTemplate: info.isTemplate === true,
      uiVersion: info.uiVersion ?? null,
      exports: Array.isArray(info.exports) ? info.exports : [],
      fileLinks: Array.isArray(info.fileLinks) ? info.fileLinks : [],
      autoPublish: info.autoPublish && typeof info.autoPublish === "object" ? info.autoPublish : null
    }
  };
}

export function extractLogosSchedulerRecords(payload = {}) {
  const groups = new Map();
  for (const row of Array.isArray(payload.sermons) ? payload.sermons : []) {
    const externalId = normalizeText(row?.externalId);
    if (!externalId) continue;
    const rows = groups.get(externalId) || [];
    rows.push(row);
    groups.set(externalId, rows);
  }

  return Array.from(groups.values()).map(toLogosSermonRecord);
}

