import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./signal-options-automation.ts", import.meta.url),
  "utf8",
);

test("signal-options contract selection does not reserve an IBKR equity quote line", () => {
  assert.doesNotMatch(source, /option-underlier-support/);
  assert.doesNotMatch(source, /acquireSignalOptionsContractSelectionLease/);
  assert.doesNotMatch(source, /admitMarketDataLeases/);
  assert.doesNotMatch(source, /releaseMarketDataLeases/);
  assert.doesNotMatch(source, /ibkr-live-demand-coordinator/);
  assert.doesNotMatch(source, /IbkrLiveDemand/);
});
