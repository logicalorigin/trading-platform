import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildIntradaySeries,
  intradayMarketSessionPctElapsed,
} from "./IntradayPnlPanel.jsx";

test("intraday account P&L includes only valid regular-session points", () => {
  const points = buildIntradaySeries({
    points: [
      { timestamp: "2026-07-21T13:00:00.000Z", netLiquidation: 90 },
      { timestamp: "2026-07-21T13:30:00.000Z", netLiquidation: 100 },
      { timestamp: "2026-07-21T15:00:00.000Z", netLiquidation: null },
      { timestamp: "2026-07-21T20:00:00.000Z", netLiquidation: 110 },
      { timestamp: "2026-07-21T20:01:00.000Z", netLiquidation: 120 },
    ],
  });

  assert.deepEqual(points, [
    { timestampMs: Date.parse("2026-07-21T13:30:00.000Z"), pnl: 0 },
    { timestampMs: Date.parse("2026-07-21T20:00:00.000Z"), pnl: 10 },
  ]);
});

test("continuous accounts retain overnight and weekend intraday points", () => {
  const points = buildIntradaySeries(
    {
      points: [
        { timestamp: "2026-07-19T06:00:00.000Z", netLiquidation: 100 },
        { timestamp: "2026-07-19T12:00:00.000Z", netLiquidation: 110 },
      ],
    },
    "continuous",
  );

  assert.deepEqual(points, [
    { timestampMs: Date.parse("2026-07-19T06:00:00.000Z"), pnl: 0 },
    { timestampMs: Date.parse("2026-07-19T12:00:00.000Z"), pnl: 10 },
  ]);
});

test("intraday progress respects NYSE early closes and holidays", () => {
  assert.equal(
    intradayMarketSessionPctElapsed(
      Date.parse("2026-11-27T18:00:00.000Z"),
    ),
    100,
  );
  assert.equal(
    intradayMarketSessionPctElapsed(
      Date.parse("2026-07-03T16:00:00.000Z"),
    ),
    0,
  );
});

test("intraday P&L chart has an accessible image description", () => {
  const source = readFileSync(
    new URL("./IntradayPnlPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /role="img"/);
  assert.match(source, /aria-label=\{`Intraday account P&L chart/);
  assert.match(source, /marketCalendar = \"nyse\"/);
});
