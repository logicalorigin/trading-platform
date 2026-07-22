import assert from "node:assert/strict";
import test from "node:test";

process.env.TZ = "Asia/Tokyo";

const { accountDateFilterBoundaryIso, accountMarketDateNoonMs } = await import(
  "./accountCalendarData.js"
);
const { buildAccountAnalysisQueryParams, buildRangeDateBounds } = await import(
  "./tradingAnalysisFilters.js"
);

test("trading analysis lookbacks use the New York calendar day regardless of host zone", () => {
  const sundayEveningInNewYork = Date.parse("2026-03-09T01:30:00.000Z");

  for (const hostTimeZone of ["Asia/Tokyo", "America/Los_Angeles"]) {
    process.env.TZ = hostTimeZone;
    assert.deepEqual(buildRangeDateBounds("1W", sundayEveningInNewYork), {
      from: "2026-03-02",
      to: "",
    });
  }
  process.env.TZ = "Asia/Tokyo";
});

test("YTD starts from the New York year near a UTC year boundary", () => {
  const newYearsEveInNewYork = Date.parse("2026-01-01T02:00:00.000Z");

  for (const hostTimeZone of ["Asia/Tokyo", "America/Los_Angeles"]) {
    process.env.TZ = hostTimeZone;
    assert.deepEqual(buildRangeDateBounds("YTD", newYearsEveInNewYork), {
      from: "2025-01-01",
      to: "",
    });
  }
  process.env.TZ = "Asia/Tokyo";
});

test("account date filters resolve New York day boundaries across spring DST", () => {
  assert.equal(
    accountDateFilterBoundaryIso("2026-03-08"),
    "2026-03-08T05:00:00.000Z",
  );
  assert.equal(
    accountDateFilterBoundaryIso("2026-03-08", { endOfDay: true }),
    "2026-03-09T03:59:59.999Z",
  );
});

test("account date filters resolve New York day boundaries across fall DST", () => {
  assert.equal(
    accountDateFilterBoundaryIso("2026-11-01"),
    "2026-11-01T04:00:00.000Z",
  );
  assert.equal(
    accountDateFilterBoundaryIso("2026-11-01", { endOfDay: true }),
    "2026-11-02T04:59:59.999Z",
  );
});

test("account analysis queries use inclusive New York day boundaries", () => {
  assert.deepEqual(
    buildAccountAnalysisQueryParams({
      filters: { from: "2026-07-04", to: "2026-07-04" },
    }),
    {
      symbol: undefined,
      assetClass: undefined,
      pnlSign: undefined,
      holdDuration: undefined,
      from: "2026-07-04T04:00:00.000Z",
      to: "2026-07-05T03:59:59.999Z",
    },
  );
});

test("named market-date anchors stay on that New York day in any host zone", () => {
  for (const hostTimeZone of ["Asia/Tokyo", "America/Los_Angeles"]) {
    process.env.TZ = hostTimeZone;
    assert.equal(
      accountMarketDateNoonMs("2026-07-09"),
      Date.parse("2026-07-09T16:00:00.000Z"),
    );
  }
  process.env.TZ = "Asia/Tokyo";
});
