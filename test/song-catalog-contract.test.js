const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BHE_API_KEY = process.env.BHE_API_KEY || "test-bhe-key";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key";

const {
  buildStructuredErrorResponse
} = require("../index.js");

test("buildStructuredErrorResponse returns the Slice 1 structured error shape", () => {
  const error = new Error("Song not found");
  error.code = "song_not_found";
  error.details = { songId: "rejoice-9999" };

  const result = buildStructuredErrorResponse(error, {
    fallbackCode: "song_fetch_failed",
    fallbackMessage: "Song fetch failed"
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "song_not_found",
      message: "Song not found",
      details: {
        songId: "rejoice-9999"
      }
    }
  });
});

test("buildStructuredErrorResponse falls back cleanly for unexpected errors", () => {
  const result = buildStructuredErrorResponse(
    new Error(""),
    {
      fallbackCode: "internal_error",
      fallbackMessage: "Internal server error"
    }
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "internal_error",
      message: "Internal server error"
    }
  });
});
