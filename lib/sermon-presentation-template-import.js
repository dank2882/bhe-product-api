const { createHash } = require("node:crypto");
const JSZip = require("jszip");

const PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_TEMPLATE_PPTX_BYTES = 10 * 1024 * 1024;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeXmlEntities(value = "") {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function getAttribute(value = "", name = "") {
  const match = String(value).match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeXmlEntities(match?.[1] ?? match?.[2] ?? "");
}

function getTagBlock(xml = "", tagName = "") {
  return String(xml).match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i"))?.[1] || "";
}

function getHexColor(value = "") {
  const clean = normalizeString(value).replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(clean) ? clean : "";
}

function extractColorFromBlock(block = "") {
  const srgb = String(block).match(/<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1];
  if (srgb) return getHexColor(srgb);
  const system = String(block).match(/<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/i)?.[1];
  return getHexColor(system);
}

function extractThemeColors(themeXml = "") {
  const colors = {};
  for (const key of ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]) {
    colors[key] = extractColorFromBlock(getTagBlock(themeXml, `a:${key}`));
  }
  return colors;
}

function extractColorMap(masterXml = "") {
  const tag = String(masterXml).match(/<p:clrMap\b([^>]*)\/?\s*>/i)?.[1] || "";
  const result = {};
  for (const key of ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]) {
    result[key] = getAttribute(tag, key);
  }
  return result;
}

function resolveSchemeColor(name = "", themeColors = {}, colorMap = {}) {
  const mapped = colorMap[name] || name;
  return getHexColor(themeColors[mapped]);
}

function extractSlideBackgroundColor(slideXml = "", themeColors = {}, colorMap = {}) {
  const background = getTagBlock(slideXml, "p:bg");
  if (!background) return "";
  const direct = extractColorFromBlock(background);
  if (direct) return direct;
  const scheme = background.match(/<a:schemeClr\b[^>]*\bval="([^"]+)"/i)?.[1] || "";
  return resolveSchemeColor(scheme, themeColors, colorMap);
}

function colorLuminance(hex = "") {
  const clean = getHexColor(hex);
  if (!clean) return 255;
  const red = parseInt(clean.slice(0, 2), 16);
  const green = parseInt(clean.slice(2, 4), 16);
  const blue = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function adjustHexColor(hex = "", amount = 0) {
  const clean = getHexColor(hex) || "FFFFFF";
  return [0, 2, 4].map((index) => {
    const value = Math.max(0, Math.min(255, parseInt(clean.slice(index, index + 2), 16) + amount));
    return value.toString(16).padStart(2, "0");
  }).join("").toUpperCase();
}

function extractTypeface(themeXml = "", family = "majorFont") {
  const block = getTagBlock(themeXml, `a:${family}`);
  const latinTag = block.match(/<a:latin\b([^>]*)\/?\s*>/i)?.[1] || "";
  return getAttribute(latinTag, "typeface");
}

function normalizePointSize(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

function extractStylePointSize(masterXml = "", styleTag = "") {
  const block = getTagBlock(masterXml, `p:${styleTag}`);
  const sizes = Array.from(block.matchAll(/<a:(?:defRPr|rPr)\b[^>]*\bsz="(\d+)"/gi))
    .map((match) => Number(match[1]) / 100)
    .filter((value) => Number.isFinite(value));
  return sizes.length ? Math.max(...sizes) : 0;
}

async function readZipText(zip, path) {
  const file = zip.file(path);
  return file ? file.async("string") : "";
}

async function extractSermonPresentationTemplateStyle(buffer, options = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  const sizeTag = presentationXml.match(/<p:sldSz\b([^>]*)\/?\s*>/i)?.[1] || "";
  const width = Number(getAttribute(sizeTag, "cx"));
  const height = Number(getAttribute(sizeTag, "cy"));
  const ratio = width > 0 && height > 0 ? width / height : 0;
  if (!ratio || Math.abs(ratio - (16 / 9)) > 0.03) {
    const error = new Error("The imported PowerPoint must use the 16:9 widescreen aspect ratio");
    error.statusCode = 400;
    error.code = "presentation_template_aspect_ratio_invalid";
    error.details = { width, height, ratio: Number(ratio.toFixed(4)) };
    throw error;
  }

  const themeXml = await readZipText(zip, "ppt/theme/theme1.xml");
  const masterXml = await readZipText(zip, "ppt/slideMasters/slideMaster1.xml");
  const firstSlideXml = await readZipText(zip, "ppt/slides/slide1.xml");
  const themeColors = extractThemeColors(themeXml);
  const colorMap = extractColorMap(masterXml);
  const mappedBackground = resolveSchemeColor("bg1", themeColors, colorMap);
  const background = extractSlideBackgroundColor(firstSlideXml, themeColors, colorMap) ||
    mappedBackground || themeColors.lt1 || "FFFFFF";
  const isDark = colorLuminance(background) < 130;
  const text = resolveSchemeColor("tx1", themeColors, colorMap) ||
    (isDark ? themeColors.lt1 : themeColors.dk1) || (isDark ? "FFFFFF" : "111111");
  const surface = resolveSchemeColor("bg2", themeColors, colorMap) ||
    (isDark ? adjustHexColor(background, 18) : adjustHexColor(background, -12));
  const muted = resolveSchemeColor("tx2", themeColors, colorMap) ||
    (isDark ? adjustHexColor(text, -45) : adjustHexColor(text, 65));
  const headingSize = normalizePointSize(extractStylePointSize(masterXml, "titleStyle"), 44, 28, 60);
  const bodySize = normalizePointSize(extractStylePointSize(masterXml, "bodyStyle"), 26, 18, 36);
  const themeName = getAttribute(themeXml.match(/<a:theme\b([^>]*)>/i)?.[1] || "", "name") ||
    normalizeString(options.fallbackName) || "Imported PowerPoint Theme";

  return {
    aspectRatio: "16:9",
    theme: {
      name: themeName,
      fonts: {
        heading: extractTypeface(themeXml, "majorFont") || "Aptos Display",
        body: extractTypeface(themeXml, "minorFont") || "Aptos"
      },
      colors: {
        background,
        surface,
        primary: themeColors.accent1 || "4472C4",
        text,
        muted,
        accent: themeColors.accent2 || themeColors.accent3 || "70AD47"
      }
    },
    layouts: {
      title: { titleSize: headingSize, subtitleSize: Math.max(18, bodySize - 2) },
      scripture: { referenceSize: Math.max(22, bodySize), textSize: Math.min(34, bodySize + 4) },
      big_idea: { headingSize: Math.max(22, bodySize), bodySize: Math.min(38, bodySize + 8) },
      section: { headingSize: Math.min(48, headingSize), bodySize },
      main_point: { headingSize: Math.min(40, Math.max(30, headingSize - 6)), bodySize },
      quote: { bodySize: Math.min(38, bodySize + 6), citationSize: Math.max(16, bodySize - 6) },
      application: { headingSize: Math.min(38, Math.max(28, headingSize - 8)), bodySize },
      closing: { headingSize: Math.min(42, Math.max(32, headingSize - 4)), bodySize },
      blank: {}
    },
    extraction: {
      themeName,
      slideWidthEmu: width,
      slideHeightEmu: height,
      ratio: Number(ratio.toFixed(4)),
      backgroundSource: extractSlideBackgroundColor(firstSlideXml, themeColors, colorMap)
        ? "first_slide"
        : "theme",
      headingSize,
      bodySize
    }
  };
}

async function prepareSermonPresentationTemplateImport({
  openaiFileIdRefs,
  fetchImpl = fetch,
  maximumBytes = MAX_TEMPLATE_PPTX_BYTES,
  fallbackName = ""
} = {}) {
  if (!Array.isArray(openaiFileIdRefs) || openaiFileIdRefs.length !== 1) {
    const error = new Error("Attach exactly one editable PPTX file to import as a presentation template");
    error.statusCode = 400;
    error.code = "presentation_template_file_required";
    throw error;
  }
  const fileRef = openaiFileIdRefs[0] || {};
  const downloadLink = normalizeString(fileRef.download_link || fileRef.downloadLink);
  const originalFilename = normalizeString(fileRef.name) || "sermon-presentation-template.pptx";
  const contentType = normalizeString(fileRef.mime_type || fileRef.mimeType) || PPTX_CONTENT_TYPE;
  const filenameIsPptx = /\.pptx$/i.test(originalFilename);
  if (!downloadLink || (!filenameIsPptx && contentType !== PPTX_CONTENT_TYPE)) {
    const error = new Error("The attached template file must be an editable .pptx PowerPoint");
    error.statusCode = 400;
    error.code = "presentation_template_file_invalid";
    throw error;
  }

  const response = await fetchImpl(downloadLink);
  if (!response.ok) {
    const error = new Error("The attached PowerPoint could not be downloaded before its temporary link expired");
    error.statusCode = 400;
    error.code = "presentation_template_file_download_failed";
    throw error;
  }
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    const error = new Error("The attached PowerPoint exceeds the 10 MB template import limit");
    error.statusCode = 413;
    error.code = "presentation_template_file_too_large";
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maximumBytes) {
    const error = new Error("The attached PowerPoint exceeds the 10 MB template import limit");
    error.statusCode = 413;
    error.code = "presentation_template_file_too_large";
    throw error;
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
    const error = new Error("The attached file is not a valid editable PowerPoint package");
    error.statusCode = 400;
    error.code = "presentation_template_file_invalid";
    throw error;
  }

  let style;
  try {
    style = await extractSermonPresentationTemplateStyle(buffer, { fallbackName });
  } catch (error) {
    if (error.statusCode) throw error;
    const invalidError = new Error("The attached file is not a readable editable PowerPoint package");
    invalidError.statusCode = 400;
    invalidError.code = "presentation_template_file_invalid";
    throw invalidError;
  }

  return {
    buffer,
    originalFilename,
    contentType: PPTX_CONTENT_TYPE,
    sizeBytes: buffer.length,
    checksumSha256: createHash("sha256").update(buffer).digest("hex"),
    ...style
  };
}

module.exports = {
  MAX_TEMPLATE_PPTX_BYTES,
  PPTX_CONTENT_TYPE,
  extractSermonPresentationTemplateStyle,
  prepareSermonPresentationTemplateImport
};
