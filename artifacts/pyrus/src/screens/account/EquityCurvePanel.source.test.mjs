import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./EquityCurvePanel.jsx", import.meta.url),
  "utf8",
);

test("Equity Curve never retains a prior or mismatched range response", () => {
  assert.doesNotMatch(
    source,
    /fallbackRef|allowMismatchedFallback|resolveStableEquityRangeResponse|useStableEquityRangeResponse/,
  );
  assert.match(
    source,
    /const chartData = selectedRangeReady \? query\.data : null;/,
  );
  assert.match(
    source,
    /const currentRangeResponse = \(candidateQuery, selectedRange\) =>/,
  );
});
