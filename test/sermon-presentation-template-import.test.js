const test = require("node:test");
const assert = require("node:assert/strict");
const PptxGenJS = require("pptxgenjs");

const {
  PPTX_CONTENT_TYPE,
  extractSermonPresentationTemplateStyle,
  prepareSermonPresentationTemplateImport
} = require("../lib/sermon-presentation-template-import");

async function buildPptx({ layout = "LAYOUT_WIDE", background = "112233" } = {}) {
  const pptx = new PptxGenJS();
  if (layout === "CUSTOM_4X3") {
    pptx.defineLayout({ name: layout, width: 10, height: 7.5 });
  }
  pptx.layout = layout;
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US"
  };
  const slide = pptx.addSlide();
  slide.background = { color: background };
  slide.addText("Series Title", { x: 1, y: 1, w: 10, h: 1, fontSize: 42 });
  return pptx.write({ outputType: "nodebuffer" });
}

test("extracts reusable style tokens from an editable 16:9 PowerPoint", async () => {
  const buffer = await buildPptx({ background: "112233" });
  const result = await extractSermonPresentationTemplateStyle(buffer, {
    fallbackName: "Seasons of Life"
  });

  assert.equal(result.aspectRatio, "16:9");
  assert.equal(result.theme.colors.background, "112233");
  assert.ok(result.theme.fonts.heading);
  assert.ok(result.theme.fonts.body);
  assert.ok(result.layouts.title.titleSize >= 28);
  assert.equal(result.extraction.backgroundSource, "first_slide");
});

test("downloads exactly one PPTX and returns its checksum and extracted style", async () => {
  const buffer = await buildPptx();
  const result = await prepareSermonPresentationTemplateImport({
    openaiFileIdRefs: [{
      name: "edited-series-template.pptx",
      mime_type: PPTX_CONTENT_TYPE,
      download_link: "https://files.example.test/template"
    }],
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => String(buffer.length) },
      arrayBuffer: async () => buffer
    })
  });

  assert.equal(result.originalFilename, "edited-series-template.pptx");
  assert.equal(result.sizeBytes, buffer.length);
  assert.match(result.checksumSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.aspectRatio, "16:9");
});

test("rejects a non-widescreen PowerPoint template", async () => {
  const buffer = await buildPptx({ layout: "CUSTOM_4X3" });

  await assert.rejects(
    () => extractSermonPresentationTemplateStyle(buffer),
    (error) => error.code === "presentation_template_aspect_ratio_invalid"
  );
});
