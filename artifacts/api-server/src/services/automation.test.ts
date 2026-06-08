import assert from "node:assert/strict";
import test from "node:test";

import { __algoAutomationInternalsForTests } from "./automation";

test("strategy settings accept 2m signal timeframe", () => {
  assert.equal(
    __algoAutomationInternalsForTests.readSignalTimeframe("2m"),
    "2m",
  );
});

test("strategy settings reject unsupported signal timeframe", () => {
  assert.throws(
    () => __algoAutomationInternalsForTests.readSignalTimeframe("30m"),
    /Unsupported signal timeframe/,
  );
});
