import assert from "node:assert/strict";
import test from "node:test";

import { fmtM } from "./formatters.js";

test("fmtM chooses units from the signed value magnitude", () => {
  assert.equal(fmtM(1_500_000), "$1.5M");
  assert.equal(fmtM(-1_500_000), "$-1.5M");
});
