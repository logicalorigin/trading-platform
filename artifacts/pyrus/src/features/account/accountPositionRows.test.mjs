import assert from "node:assert/strict";
import test from "node:test";

import {
  accountExpirationConcentrationMs,
  buildAccountRiskDisplayModel,
} from "./accountPositionRows.js";

test("date-only expirations use a timezone-independent calendar-day ordinal", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    assert.equal(
      accountExpirationConcentrationMs("2026-03-09"),
      Date.UTC(2026, 2, 9),
    );
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("expiration concentration excludes expired open options", () => {
  const originalNow = Date.now;
  Date.now = () => new Date(2026, 6, 21, 12).getTime();

  try {
    const position = (expirationDate, marketValue) => ({
      quantity: 1,
      marketValue,
      optionContract: { expirationDate, underlying: "SPY" },
      symbol: `SPY ${expirationDate}`,
    });
    const result = buildAccountRiskDisplayModel(
      { concentration: {}, greeks: {}, winnersLosers: {} },
      {
        positions: [
          position("2026-07-20", 100),
          position("2026-07-21", 2),
          position("2026-07-27", 3),
          position("2026-08-10", 5),
          position("2026-11-01", 7),
        ],
      },
    );

    assert.deepEqual(result.expiryConcentration, {
      thisWeek: 5,
      thisMonth: 10,
      next90Days: 10,
    });
  } finally {
    Date.now = originalNow;
  }
});

test("incomplete position money preserves authoritative risk aggregates", () => {
  const authoritative = {
    concentration: {
      topPositions: [{ symbol: "SERVER", marketValue: 900 }],
      sectors: [{ sector: "Server", value: 900 }],
    },
    winnersLosers: {
      todayWinners: [{ symbol: "SERVER", unrealizedPnl: 25 }],
      todayLosers: [{ symbol: "SERVER", unrealizedPnl: -10 }],
    },
    greeks: { perUnderlying: [] },
    expiryConcentration: { thisWeek: 7, thisMonth: 8, next90Days: 9 },
  };

  const result = buildAccountRiskDisplayModel(authoritative, {
    positions: [
      {
        symbol: "AAPL",
        quantity: 1,
        marketValue: null,
        unrealizedPnl: null,
        optionContract: { expirationDate: null },
      },
    ],
  });

  assert.deepEqual(result.concentration, authoritative.concentration);
  assert.deepEqual(result.winnersLosers, authoritative.winnersLosers);
  assert.deepEqual(
    result.expiryConcentration,
    authoritative.expiryConcentration,
  );
});

test("missing position weights preserve authoritative sector concentration", () => {
  const authoritative = {
    concentration: {
      topPositions: [{ symbol: "SERVER", marketValue: 900 }],
      sectors: [{ sector: "Server", value: 900, weightPercent: 90 }],
    },
    greeks: {},
    winnersLosers: {},
  };

  const result = buildAccountRiskDisplayModel(authoritative, {
    positions: [
      {
        symbol: "AAPL",
        sector: "Technology",
        quantity: 1,
        marketValue: 100,
        weightPercent: 10,
        unrealizedPnl: 5,
      },
      {
        symbol: "MSFT",
        sector: "Technology",
        quantity: 1,
        marketValue: 200,
        weightPercent: null,
        unrealizedPnl: 10,
      },
    ],
  });

  assert.deepEqual(result.concentration, authoritative.concentration);
});

test("an unidentifiable open position cannot erase authoritative Greek rows", () => {
  const authoritative = {
    greeks: {
      portfolio: { delta: 12 },
      perUnderlying: [{ underlying: "SERVER", delta: 12 }],
    },
  };

  const result = buildAccountRiskDisplayModel(authoritative, {
    positions: [{ symbol: "", quantity: 1, marketValue: 10, unrealizedPnl: 1 }],
  });

  assert.deepEqual(result.greeks, authoritative.greeks);
});
