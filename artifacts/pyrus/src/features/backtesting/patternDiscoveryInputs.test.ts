import assert from "node:assert/strict";
import test from "node:test";

import { normalizePatternDiscoveryRunSelection } from "./patternDiscoveryInputs";

test("normalizePatternDiscoveryRunSelection deduplicates symbols and keeps the base timeframe selected", () => {
  assert.deepEqual(
    normalizePatternDiscoveryRunSelection({
      symbolsRaw: "spy, QQQ SPY",
      timeframeSet: ["5m", "1m"],
      baseTimeframe: "15m",
      startsOn: "2026-07-01",
      endsOn: "2026-07-03",
    }),
    {
      symbols: ["SPY", "QQQ"],
      timeframeSet: ["5m", "1m"],
      baseTimeframe: "5m",
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-07-03T23:59:59.999Z",
    },
  );
});

test("normalizePatternDiscoveryRunSelection preserves a selected base timeframe", () => {
  assert.equal(
    normalizePatternDiscoveryRunSelection({
      symbolsRaw: "SPY",
      timeframeSet: ["1m", "5m"],
      baseTimeframe: "5m",
      startsOn: "2026-07-01",
      endsOn: "2026-07-03",
    })?.baseTimeframe,
    "5m",
  );
});

test("normalizePatternDiscoveryRunSelection rejects empty selections and invalid ranges", () => {
  const base = {
    symbolsRaw: "SPY",
    timeframeSet: ["1m"],
    baseTimeframe: "1m",
    startsOn: "2026-07-01",
    endsOn: "2026-07-03",
  };

  assert.equal(normalizePatternDiscoveryRunSelection({ ...base, symbolsRaw: "" }), null);
  assert.equal(normalizePatternDiscoveryRunSelection({ ...base, timeframeSet: [] }), null);
  assert.equal(
    normalizePatternDiscoveryRunSelection({ ...base, startsOn: "2026-02-30" }),
    null,
  );
  assert.equal(
    normalizePatternDiscoveryRunSelection({ ...base, startsOn: "2026-07-04" }),
    null,
  );
});
