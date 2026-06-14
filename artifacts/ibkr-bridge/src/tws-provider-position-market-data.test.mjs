import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./tws-provider.ts", import.meta.url), "utf8");

test("TWS position snapshots do not fabricate market price from average cost", () => {
  const snapshotBuilder = source.match(
    /private toBrokerPositionSnapshot\([\s\S]*?\n  private toBrokerOrderSnapshot/,
  )?.[0];

  assert.ok(snapshotBuilder, "Missing toBrokerPositionSnapshot");
  assert.doesNotMatch(
    snapshotBuilder,
    /marketPrice\s*=\s*position\.marketPrice\s*\?\?\s*averagePrice/,
  );
  assert.match(
    snapshotBuilder,
    /marketPrice > 0\s*\?\s*marketPrice \* position\.pos \* multiplier\s*:\s*0/,
  );
  assert.match(snapshotBuilder, /averagePrice && position\.pos && marketPrice > 0/);
});
