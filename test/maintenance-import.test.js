"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { preview } = require("../scripts/preview-maintenance-import.cjs");
const heading = "| Project | Task | Priority | Third Party | Cost | Target Date | Status | Assigned To | Notes | Images |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
test("import preview preserves uncertain wording, only merges exact same-context rows, and performs no writes", () => {
  const row = "| Doors | Repair | High | Maybe | TBD | August | Asked | Steve? | Keep \\| original | Existing walkthrough |";
  const result = preview([{ name: "master", text: "# B Building\n" + heading + row + "\n" + row + "\n# A Building\n" + heading + row }]);
  assert.equal(result.rowAppearances, 3); assert.equal(result.uniqueExactRows, 2);
  assert.equal(result.rows[0].sourceFields.Cost, "TBD"); assert.equal(result.rows[0].sourceFields.Notes, "Keep | original");
  assert.equal(result.rows[0].sourceFields["Assigned To"], "Steve?");
  assert.equal(result.writesPerformed, false); assert.equal(result.completeMaster, false);
});
