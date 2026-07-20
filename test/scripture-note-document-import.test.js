const test = require("node:test");
const assert = require("node:assert/strict");
const { Document, Packer, Paragraph } = require("docx");

const {
  DOCX_CONTENT_TYPE,
  extractTextFromDocx,
  prepareScriptureNoteImportFile
} = require("../lib/scripture-note-document-import");

async function buildDocx() {
  const document = new Document({
    sections: [{
      children: [
        new Paragraph("Bible Commentary"),
        new Paragraph(""),
        new Paragraph("Psalm 37:17"),
        new Paragraph("The LORD upholdeth the righteous.")
      ]
    }]
  });
  return Packer.toBuffer(document);
}

test("extracts paragraph text from an attached Word commentary export", async () => {
  const buffer = await buildDocx();
  const text = await extractTextFromDocx(buffer);
  assert.match(text, /Bible Commentary/);
  assert.match(text, /Psalm 37:17/);
  assert.match(text, /upholdeth the righteous/);
});

test("downloads and validates one DOCX Scripture notes file", async () => {
  const buffer = await buildDocx();
  const result = await prepareScriptureNoteImportFile({
    openaiFileIdRefs: [{
      name: "Bible Commentary.docx",
      mime_type: DOCX_CONTENT_TYPE,
      download_link: "https://files.example.test/commentary"
    }],
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => String(buffer.length) },
      arrayBuffer: async () => buffer
    })
  });
  assert.equal(result.originalFilename, "Bible Commentary.docx");
  assert.match(result.checksumSha256, /^[0-9a-f]{64}$/);
  assert.match(result.text, /Psalm 37:17/);
});
