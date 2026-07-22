import assert from "node:assert/strict";
import test from "node:test";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

test("shadow position weight totals preserve incomplete populations as unknown", () => {
  assert.equal(
    internals.totalShadowPositionWeightPercentForTests([
      { weightPercent: 40 },
      { weightPercent: null },
    ]),
    null,
  );
});

test("shadow position weight totals preserve an empty invested population as zero", () => {
  assert.equal(internals.totalShadowPositionWeightPercentForTests([]), 0);
});
