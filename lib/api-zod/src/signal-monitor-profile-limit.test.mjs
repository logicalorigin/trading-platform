import assert from "node:assert/strict";
import test from "node:test";

import { UpdateSignalMonitorProfileBody } from "./generated/api.ts";

test("signal monitor profile accepts the supported 2,000-symbol universe", () => {
  for (const maxSymbols of [501, 2_000]) {
    assert.equal(
      UpdateSignalMonitorProfileBody.safeParse({ maxSymbols }).success,
      true,
      `rejected supported maxSymbols=${maxSymbols}`,
    );
  }

  assert.equal(
    UpdateSignalMonitorProfileBody.safeParse({ maxSymbols: 2_001 }).success,
    false,
    "accepted maxSymbols above the service ceiling",
  );
});
