const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");

process.env.BHE_API_KEY ||= "test-bhe-api-key";
process.env.OPENAI_API_KEY ||= "test-openai-api-key";

const { renderSermonPresentationPptx } = require("../index");

test("renderer honors imported template type scale while keeping text editable", async () => {
  const buffer = await renderSermonPresentationPptx({
    sermon: {
      title: "Season in Egypt",
      scriptureText: "Exodus 1-2",
      seriesTitle: "Seasons of Life"
    },
    template: {
      name: "Seasons of Life",
      theme: {
        fonts: { heading: "Georgia", body: "Arial" },
        colors: {
          background: "112233",
          surface: "223344",
          primary: "D4AF37",
          text: "FFFFFF",
          muted: "CCCCCC",
          accent: "4A8F8F"
        }
      },
      layouts: {
        title: { titleSize: 55, subtitleSize: 25 }
      }
    },
    presentation: {
      title: "Season in Egypt Slides",
      slidePlan: {
        slides: [{
          type: "title",
          title: "Season in Egypt",
          subtitle: "Exodus 1-2"
        }]
      }
    }
  });
  const zip = await JSZip.loadAsync(buffer);
  const slideXml = await zip.file("ppt/slides/slide1.xml").async("string");

  assert.match(slideXml, /Season in Egypt/);
  assert.match(slideXml, /typeface="Georgia"/);
  assert.match(slideXml, /sz="5500"/);
  assert.match(slideXml, /Exodus 1-2/);
});
