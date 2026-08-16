function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function mergeLogosTags(...tagLists) {
  const tags = [];
  const seen = new Set();

  for (const value of tagLists.flat()) {
    const tag = normalizeText(value);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

export function extractLegacyLogosTags(manuscriptText) {
  const lines = String(manuscriptText || "")
    .split(/\r?\n/)
    .slice(0, 80);
  const tagsIndex = lines.findIndex((line) => /^Tags?:$/i.test(line.trim()));

  if (tagsIndex < 0) return [];

  const followingLines = lines.slice(tagsIndex + 1);
  const documentBoundaryIndex = followingLines.findIndex((line) => line.includes("\uFEFF"));
  if (documentBoundaryIndex < 0) return [];

  const tagLine = followingLines
    .slice(0, documentBoundaryIndex)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return tagLine
    .split(/[,;]\s*/)
    .map(normalizeText)
    .filter(Boolean);
}

export function getLogosSermonTags(record = {}) {
  const sourceTags = mergeLogosTags(
    Array.isArray(record.tags) ? record.tags : [],
    extractLegacyLogosTags(record.manuscriptText)
  );
  const directContext = [record.title, record.service, sourceTags.join(" ")]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
  const venue = normalizeText(record.venue);
  const lifeBuildersPattern = /\blife\s*builders?\b|\blife\s*builder['’]s\b/i;
  const directLifeBuildersMatch = lifeBuildersPattern.test(directContext);
  const venueLifeBuildersMatch = lifeBuildersPattern.test(venue);

  if (!directLifeBuildersMatch && !venueLifeBuildersMatch) {
    return sourceTags;
  }

  const categoryTag = directLifeBuildersMatch && !/\bretreat\b/i.test(directContext)
    ? "life-builders-class"
    : "life-builders-retreat";

  return mergeLogosTags(sourceTags, "life-builders", categoryTag);
}

function normalizeDocIdPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function buildStableSermonId(record = {}) {
  if (record.logosId) return `sermon-logos-${normalizeDocIdPart(record.logosId)}`;
  return `sermon-logos-${normalizeDocIdPart(record.title)}-${normalizeDocIdPart(record.preachedDate)}`;
}

function buildStableSourceId(record = {}) {
  if (record.logosId) return `source-logos-${normalizeDocIdPart(record.logosId)}`;
  return `source-logos-${normalizeDocIdPart(record.title)}-${normalizeDocIdPart(record.preachedDate)}`;
}

export function buildLogosSourceSummary(record = {}) {
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
    record.targetDuration ? `Target duration: ${record.targetDuration} minutes` : "",
    record.wordCount ? `Word count: ${record.wordCount}` : "",
    record.scriptureText ? `Passages: ${record.scriptureText}` : "",
    record.topics?.length ? `Topics: ${record.topics.join(", ")}` : "",
    tags.length ? `Tags: ${tags.join(", ")}` : "",
    record.audience?.length
      ? `Audience: ${record.audience.join(", ")}`
      : (record.audience ? `Audience: ${record.audience}` : ""),
    record.description ? `Description: ${record.description}` : "",
    record.privateNotes ? `Private notes: ${record.privateNotes}` : "",
    occasionLines.length ? `Preaching occasions:\n${occasionLines.join("\n")}` : ""
  ].filter(Boolean).join("\n");
}

export function buildStructuredLogosMetadata(record = {}) {
  return {
    ...(record.logosMetadata && typeof record.logosMetadata === "object"
      ? record.logosMetadata
      : {}),
    title: normalizeText(record.title),
    preachedDate: normalizeText(record.preachedDate),
    series: normalizeText(record.series),
    seriesNumber: record.seriesNumber === undefined || record.seriesNumber === null
      ? ""
      : String(record.seriesNumber),
    venue: normalizeText(record.venue),
    service: normalizeText(record.service),
    speaker: normalizeText(record.speaker),
    scriptureText: normalizeText(record.scriptureText),
    topics: mergeLogosTags(record.topics || []),
    tags: getLogosSermonTags(record),
    audience: mergeLogosTags(Array.isArray(record.audience) ? record.audience : [record.audience]),
    description: normalizeText(record.description),
    targetDuration: normalizeText(record.targetDuration),
    privateNotes: normalizeText(record.privateNotes),
    occasions: Array.isArray(record.occasions)
      ? record.occasions.map((occasion) => ({
        date: normalizeText(occasion.date),
        time: normalizeText(occasion.time),
        timeZone: normalizeText(occasion.timeZone),
        venue: normalizeText(occasion.venue),
        service: normalizeText(occasion.service)
      }))
      : []
  };
}

export function toLogosImportItem(record = {}, defaults = {}) {
  const tags = getLogosSermonTags(record);
  const reconciliation = record.reconciliation && typeof record.reconciliation === "object"
    ? record.reconciliation
    : {};
  const sourceRefs = [
    record.url ? { type: "logos_url", url: record.url } : null,
    record.logosId ? { type: "logos_id", id: record.logosId } : null,
    record.links?.length ? { type: "logos_links", links: record.links } : null,
    { type: "logos_metadata", metadata: buildStructuredLogosMetadata(record) },
    record.logosExportTarget ? { type: "logos_export_target", target: record.logosExportTarget } : null
  ].filter(Boolean);

  return {
    folderId: defaults.folderId || "",
    sermonId: buildStableSermonId(record),
    sourceId: buildStableSourceId(record),
    title: record.title || record.scriptureText || "Imported Logos Sermon",
    tags,
    scriptureText: record.scriptureText || "",
    preachedDate: record.preachedDate || "",
    seriesTitle: record.series || "",
    seriesNumber: record.seriesNumber || 0,
    occasions: Array.isArray(record.occasions)
      ? record.occasions.map((occasion) => ({
        date: occasion.date || "",
        time: occasion.time || "",
        timeZone: occasion.timeZone || "America/Los_Angeles",
        venue: occasion.venue || "",
        service: occasion.service || "",
        status: "preached"
      }))
      : [],
    occasion: Array.isArray(record.occasions) && record.occasions.length > 0
      ? record.occasions
        .map((occasion) => [occasion.date, occasion.venue, occasion.service].filter(Boolean).join(" - "))
        .filter(Boolean)
        .join("\n")
      : [record.venue, record.service].filter(Boolean).join(" - "),
    status: "preached",
    sourceType: "logos_export",
    sourceTitle: record.title || "Logos Sermon",
    sourceLabel: record.title || "Logos Sermon",
    importedMaterial: record.manuscriptText || "",
    importedSummary: buildLogosSourceSummary(record),
    sourceRefs,
    refreshExistingSource: true,
    expectedSermonUpdatedAt: reconciliation.expectedSermonUpdatedAt || "",
    expectedSourceUpdatedAt: reconciliation.expectedSourceUpdatedAt || ""
  };
}
