import assert from "node:assert/strict";
import test from "node:test";
import { GetBarsResponse } from "@workspace/api-zod";

function baseResponse(bar: Record<string, unknown>) {
  return {
    symbol: "SPY",
    timeframe: "1m",
    bars: [
      {
        timestamp: "2024-01-02T14:30:00.000Z",
        open: 1.1,
        high: 1.2,
        low: 1,
        close: 1.15,
        volume: 100,
        transport: "tws",
        delayed: false,
        ...bar,
      },
    ],
    transport: "tws",
    delayed: false,
    gapFilled: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: null,
    ageMs: null,
    emptyReason: null,
    historySource: "test",
    studyFallback: false,
  };
}

test("GetBarsResponse accepts old OHLCV bars", () => {
  const parsed = GetBarsResponse.parse(baseResponse({}));

  assert.equal(parsed.bars[0]?.bid, undefined);
  assert.equal(parsed.bars[0]?.quoteAsOf, undefined);
});

test("GetBarsResponse accepts quote-enriched option bars", () => {
  const quoteAsOf = "2024-01-02T14:29:58.000Z";
  const parsed = GetBarsResponse.parse(
    baseResponse({
      bid: 1.05,
      ask: 1.15,
      mid: 1.1,
      quoteAsOf,
      providerContractId: "contract-1",
    }),
  );

  assert.equal(parsed.bars[0]?.bid, 1.05);
  assert.equal(parsed.bars[0]?.ask, 1.15);
  assert.equal(parsed.bars[0]?.mid, 1.1);
  assert.deepEqual(parsed.bars[0]?.quoteAsOf, new Date(quoteAsOf));
  assert.equal(parsed.bars[0]?.providerContractId, "contract-1");
});
