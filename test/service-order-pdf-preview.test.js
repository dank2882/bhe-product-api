const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const {
  buildServiceOrderPreviewFromTextRuns,
  extractTextRunsFromPdfBuffer
} = require("../lib/service-order-pdf-preview");

function run(pageIndex, x, y, text) {
  return { pageIndex, x, y, text };
}

test("buildServiceOrderPreviewFromTextRuns extracts service flow, songs, and moments", () => {
  const preview = buildServiceOrderPreviewFromTextRuns({
    sourceFileName: "morning-service-2026-05-10.pdf",
    sourceFileHash: "abc123",
    sourcePath: "/tmp/morning-service-2026-05-10.pdf",
    textRuns: [
      run(0, 27, 795, "Morning Service"),
      run(0, 27, 776, "Start time: May, 10, 2026 | 11:00 am"),
      run(0, 490, 776, "Duration: 1h 6m"),
      run(0, 37, 589, "Congregational Singing"),
      run(0, 389, 590, "Led By"),
      run(0, 507, 590, "11:02 am"),
      run(0, 89, 562, "Great Is Thy Faithfulness (#119)"),
      run(0, 89, 548, "Choir dismisses after first verse"),
      run(0, 389, 541, "Pianist: Natalia Parmly"),
      run(0, 507, 541, "11:02 am"),
      run(0, 89, 519, "Key: D"),
      run(0, 37, 490, "Opening Prayer"),
      run(0, 389, 491, "Led By"),
      run(0, 507, 491, "11:04 am"),
      run(0, 89, 458, "Opening Prayer - Matt Voss"),
      run(0, 389, 458, "Pastor Lee"),
      run(0, 507, 458, "11:04 am"),
      run(1, 37, 732, "Message"),
      run(1, 389, 733, "Led By"),
      run(1, 507, 733, "11:21 am"),
      run(1, 89, 700, "Pastor Smith"),
      run(1, 389, 700, "Pastoral"),
      run(1, 507, 700, "11:21 am")
    ]
  });

  assert.equal(preview.service.serviceId, "svc-plan-2026-05-10-sunday-morning");
  assert.equal(preview.service.serviceDate, "2026-05-10");
  assert.equal(preview.service.duration, "1h 6m");
  assert.equal(preview.serviceOrderItems.length, 3);

  const songItem = preview.serviceOrderItems[0];
  assert.equal(songItem.itemType, "song");
  assert.equal(songItem.usageRole, "congregational");
  assert.equal(songItem.title, "Great Is Thy Faithfulness");
  assert.equal(songItem.hymnalNumber, 119);
  assert.equal(songItem.key, "D");
  assert.deepEqual(songItem.assignedPeople, [
    { role: "pianist", name: "Natalia Parmly" }
  ]);

  const prayerItem = preview.serviceOrderItems[1];
  assert.equal(prayerItem.itemType, "prayer");
  assert.deepEqual(prayerItem.assignedPeople, [
    { role: "leader", name: "Pastor Lee" },
    { role: "prayer", name: "Matt Voss" }
  ]);

  assert.equal(preview.serviceSongEvents.length, 1);
  assert.equal(preview.serviceSongEvents[0].songTitleCandidate, "Great Is Thy Faithfulness");
  assert.equal(preview.serviceMoments.length, 1);
  assert.equal(preview.serviceMoments[0].momentType, "verse_dynamic");
  assert.equal(preview.serviceMoments[0].status, "detected_for_review");
});

test("buildServiceOrderPreviewFromTextRuns splits multiple songs in one service slot", () => {
  const preview = buildServiceOrderPreviewFromTextRuns({
    sourceFileName: "morning-service-2026-02-01.pdf",
    sourceFileHash: "abc123",
    sourcePath: "/tmp/morning-service-2026-02-01.pdf",
    textRuns: [
      run(0, 27, 795, "Morning Service"),
      run(0, 27, 776, "Start time: February, 1, 2026 | 11:00 am"),
      run(0, 490, 776, "Duration: 1h 6m"),
      run(0, 37, 589, "Congregational Singing"),
      run(0, 389, 590, "Led By"),
      run(0, 507, 590, "11:05 am"),
      run(0, 89, 562, "To God Be The Glory (#79)"),
      run(0, 389, 562, "Pastor Lee"),
      run(0, 507, 562, "11:05 am"),
      run(0, 89, 540, "Key: G"),
      run(0, 89, 518, "How Great Thou Art (#28)"),
      run(0, 389, 518, "Pastor Lee"),
      run(0, 507, 518, "11:08 am"),
      run(0, 89, 496, "Key: Bb")
    ]
  });

  assert.equal(preview.serviceOrderItems.length, 1);
  assert.equal(preview.serviceOrderItems[0].songTitleCandidate, "To God Be The Glory");
  assert.equal(preview.serviceOrderItems[0].songEntries.length, 2);
  assert.equal(preview.serviceSongEvents.length, 2);

  assert.deepEqual(
    preview.serviceSongEvents.map((event) => ({
      title: event.songTitleCandidate,
      hymnalNumber: event.hymnalNumber,
      key: event.key,
      plannedSequence: event.plannedSequence
    })),
    [
      {
        title: "To God Be The Glory",
        hymnalNumber: 79,
        key: "G",
        plannedSequence: 10
      },
      {
        title: "How Great Thou Art",
        hymnalNumber: 28,
        key: "Bb",
        plannedSequence: 11
      }
    ]
  );
});

test("buildServiceOrderPreviewFromTextRuns normalizes Sunday PM service labels", () => {
  const preview = buildServiceOrderPreviewFromTextRuns({
    sourceFileName: "lords-memorial-supper-2026-01-04.pdf",
    sourceFileHash: "abc123",
    sourcePath: "/tmp/lords-memorial-supper-2026-01-04.pdf",
    textRuns: [
      run(0, 27, 795, "Sunday PM Service"),
      run(0, 27, 776, "Start time: January, 4, 2026 | 6:00 pm"),
      run(0, 490, 776, "Duration: 59m"),
      run(0, 37, 589, "Congregational Singing"),
      run(0, 89, 562, "Burdens Are Lifted at Calvary (#305)"),
      run(0, 89, 540, "Key: F")
    ]
  });

  assert.equal(preview.service.serviceType, "sunday_evening");
  assert.equal(preview.service.serviceId, "svc-plan-2026-01-04-sunday-evening");
  assert.deepEqual(preview.service.serviceLabels, ["PM", "Lord's Supper"]);
});

test("buildServiceOrderPreviewFromTextRuns keeps theme blocks out of song events", () => {
  const preview = buildServiceOrderPreviewFromTextRuns({
    sourceFileName: "midweek-service-2026-05-06.pdf",
    sourceFileHash: "abc123",
    sourcePath: "/tmp/midweek-service-2026-05-06.pdf",
    textRuns: [
      run(0, 27, 795, "Midweek Service"),
      run(0, 27, 776, "Start time: May, 6, 2026 | 7:00 pm"),
      run(0, 490, 776, "Duration: 1h 17m"),
      run(0, 37, 589, "FINAL Theme - Baptism"),
      run(0, 507, 590, "7:00 pm"),
      run(0, 37, 562, "Congregational Singing"),
      run(0, 89, 540, "All the Way My Savior Leads Me (#136)"),
      run(0, 89, 518, "Key: G")
    ]
  });

  assert.equal(preview.serviceOrderItems[0].itemType, "theme");
  assert.equal(preview.serviceOrderItems[0].songTitleCandidate, "");
  assert.equal(preview.serviceSongEvents.length, 1);
  assert.equal(preview.serviceSongEvents[0].songTitleCandidate, "All the Way My Savior Leads Me");
});

test("extractTextRunsFromPdfBuffer reads flate-compressed PDF text streams", () => {
  const content = Buffer.from(
    "BT 27.000 795.402 Td (\x00M\x00o\x00r\x00n\x00i\x00n\x00g\x00 \x00S\x00e\x00r\x00v\x00i\x00c\x00e) Tj ET",
    "binary"
  );
  const compressed = zlib.deflateSync(content);
  const pdfBuffer = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<</Filter /FlateDecode /Length "),
    Buffer.from(String(compressed.length)),
    Buffer.from(">>\nstream\n"),
    compressed,
    Buffer.from("\nendstream\nendobj\n%%EOF")
  ]);

  const runs = extractTextRunsFromPdfBuffer(pdfBuffer);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, "Morning Service");
  assert.equal(runs[0].x, 27);
  assert.equal(runs[0].y, 795.402);
});
