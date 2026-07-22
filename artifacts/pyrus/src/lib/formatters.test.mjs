import assert from "node:assert/strict";
import test from "node:test";

import { fmtM, formatEnumLabel } from "./formatters.js";

test("fmtM chooses units from the signed value magnitude", () => {
  assert.equal(fmtM(1_500_000), "$1.5M");
  assert.equal(fmtM(-1_500_000), "$-1.5M");
});

test("legacy runner exit codes render as trailing-stop language", () => {
  assert.equal(formatEnumLabel("runner_trail_stop"), "Trailing Stop");
  assert.equal(formatEnumLabel("overnight_runner_stop"), "Trailing Stop");
});
