import assert from "node:assert/strict";
import test from "node:test";

process.env.TZ = "Asia/Tokyo";

const { buildDailyPnlSeries } = await import("./accountPnlCalendarModel.js");

test("equity-history P&L buckets by New York market date, not browser-local day", () => {
  const series = buildDailyPnlSeries({
    equityPoints: [
      {
        timestamp: "2026-06-25T20:00:00.000Z",
        netLiquidation: 1000,
      },
      {
        timestamp: "2026-06-26T20:00:00.000Z",
        netLiquidation: 900,
      },
    ],
    startDate: new Date("2026-06-25T00:00:00.000Z"),
    endDate: new Date("2026-06-30T00:00:00.000Z"),
  });

  const activeDays = series
    .filter((day) => day.pnl !== 0)
    .map((day) => ({
      iso: day.iso,
      pnl: day.pnl,
      pnlSource: day.pnlSource,
    }));

  assert.deepEqual(activeDays, [
    { iso: "2026-06-26", pnl: -100, pnlSource: "total" },
  ]);
});
