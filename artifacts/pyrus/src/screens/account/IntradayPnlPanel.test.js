import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIntradaySeries,
  formatIntradayMarketTime,
  intradayMarketSessionPctElapsed,
} from "./IntradayPnlPanel.jsx";

test("intraday panel formats timestamps in New York market time", () => {
  assert.equal(
    formatIntradayMarketTime(Date.parse("2026-05-14T13:30:00.000Z")),
    "09:30",
  );
});

test("intraday panel session progress uses New York market hours", () => {
  assert.equal(
    intradayMarketSessionPctElapsed(Date.parse("2026-05-14T13:30:00.000Z")),
    0,
  );
  assert.equal(
    intradayMarketSessionPctElapsed(Date.parse("2026-05-14T19:00:00.000Z")),
    (330 / 390) * 100,
  );
  assert.equal(
    intradayMarketSessionPctElapsed(Date.parse("2026-05-14T20:30:00.000Z")),
    100,
  );
});

test("intraday panel derives P&L from equity history points", () => {
  assert.deepEqual(
    buildIntradaySeries({
      points: [
        {
          timestamp: "2026-05-14T13:30:00.000Z",
          netLiquidation: 48000,
        },
        {
          timestamp: "2026-05-14T15:00:00.000Z",
          netLiquidation: 48625.5,
        },
      ],
    }),
    [
      { timestampMs: Date.parse("2026-05-14T13:30:00.000Z"), pnl: 0 },
      { timestampMs: Date.parse("2026-05-14T15:00:00.000Z"), pnl: 625.5 },
    ],
  );
});
