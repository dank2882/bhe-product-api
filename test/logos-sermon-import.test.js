const assert = require("node:assert/strict");
const test = require("node:test");

test("extractLegacyLogosTags reads tags embedded in a Logos manuscript header", async () => {
  const { extractLegacyLogosTags } = await import("../scripts/lib/logos-sermon-import.mjs");
  const manuscriptText = [
    "Created:",
    "",
    "8/23/2015 4:13:20 PM",
    "",
    "Author:",
    "",
    "Daniel Kirchner",
    "",
    "Tags:",
    "",
    "Life Builder's Lesson; Discipleship",
    "",
    "\uFEFF",
    "The lesson begins here."
  ].join("\n");

  assert.deepEqual(extractLegacyLogosTags(manuscriptText), [
    "Life Builder's Lesson",
    "Discipleship"
  ]);
});

test("getLogosSermonTags merges editor and manuscript tags without duplicates", async () => {
  const { getLogosSermonTags } = await import("../scripts/lib/logos-sermon-import.mjs");

  assert.deepEqual(getLogosSermonTags({
    tags: ["Prayer", "life builder's lesson"],
    manuscriptText: "Tags:\n\nLife Builder's Lesson, Growth\n\n\uFEFF\n\nMessage"
  }), [
    "Prayer",
    "life builder's lesson",
    "Growth",
    "life-builders",
    "life-builders-class"
  ]);
});

test("getLogosSermonTags distinguishes Life Builders class and retreat records", async () => {
  const { getLogosSermonTags } = await import("../scripts/lib/logos-sermon-import.mjs");

  assert.deepEqual(getLogosSermonTags({
    title: "Life Builders Class - Prioritizing Life",
    venue: "Life Builder's Retreat"
  }), ["life-builders", "life-builders-class"]);
  assert.deepEqual(getLogosSermonTags({
    title: "Trusting God with your Future",
    venue: "Life Builder's Retreat"
  }), ["life-builders", "life-builders-retreat"]);
});

test("extractLegacyLogosTags ignores ordinary manuscripts without a header", async () => {
  const { extractLegacyLogosTags } = await import("../scripts/lib/logos-sermon-import.mjs");

  assert.deepEqual(extractLegacyLogosTags("A sermon without imported metadata."), []);
  assert.deepEqual(extractLegacyLogosTags([
    "Tags:",
    "",
    "\uFEFF",
    "",
    "The first sentence of the sermon is not a tag."
  ].join("\n")), []);
});
