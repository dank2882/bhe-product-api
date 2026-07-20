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
