import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountRiskDisplayModel,
  getOpenPositionRows,
  isOpenPositionRow,
} from "../../features/account/accountPositionRows.js";

test("open position rows exclude explicit zero quantities", () => {
  assert.equal(isOpenPositionRow({ quantity: 10 }), true);
  assert.equal(isOpenPositionRow({ quantity: -3 }), true);
  assert.equal(isOpenPositionRow({ quantity: 0 }), false);
  assert.equal(isOpenPositionRow({ quantity: "0" }), false);
  assert.equal(isOpenPositionRow({ symbol: "LEGACY" }), true);
});

test("risk display model rebuilds current-position lanes from open positions", () => {
  const riskData = {
    concentration: {
      topPositions: [
        { symbol: "AAL", marketValue: 1250, weightPercent: 12, unrealizedPnl: 90, sector: "Airlines" },
        { symbol: "FCEL", marketValue: 300, weightPercent: 3, unrealizedPnl: -12, sector: "Energy" },
      ],
      sectors: [{ sector: "Airlines", value: 1250, weightPercent: 12 }],
    },
    winnersLosers: {
      todayWinners: [{ symbol: "AAL", marketValue: 1250, weightPercent: 12, unrealizedPnl: 90, sector: "Airlines" }],
      todayLosers: [],
      allTimeWinners: [{ symbol: "AAL", marketValue: 100, weightPercent: null, unrealizedPnl: 100, sector: "Airlines" }],
      allTimeLosers: [],
    },
    greeks: {
      perUnderlying: [
        { underlying: "AAL", exposure: 1250 },
        { underlying: "FCEL", exposure: 300 },
        { underlying: "INDI", exposure: 600 },
      ],
    },
    expiryConcentration: {
      thisWeek: 99,
      thisMonth: 99,
      next90Days: 99,
    },
  };
  const positionsResponse = {
    positions: [
      { symbol: "AAL", quantity: 0, marketValue: 0, weightPercent: 0, unrealizedPnl: 0, sector: "Airlines" },
      { symbol: "FCEL", quantity: 30, marketValue: 300, weightPercent: 3, unrealizedPnl: -12, sector: "Energy" },
      { symbol: "INDI", quantity: 200, marketValue: 600, weightPercent: 6, unrealizedPnl: 15, sector: "Technology" },
    ],
  };

  const model = buildAccountRiskDisplayModel(riskData, positionsResponse);

  assert.deepEqual(
    model.concentration.topPositions.map((row) => row.symbol),
    ["INDI", "FCEL"],
  );
  assert.deepEqual(
    model.winnersLosers.todayWinners.map((row) => row.symbol),
    ["INDI"],
  );
  assert.deepEqual(
    model.winnersLosers.todayLosers.map((row) => row.symbol),
    ["FCEL"],
  );
  assert.deepEqual(
    model.greeks.perUnderlying.map((row) => row.underlying),
    ["FCEL", "INDI"],
  );
  assert.deepEqual(
    model.concentration.sectors.map((row) => row.sector),
    ["Technology", "Energy"],
  );
  assert.deepEqual(model.winnersLosers.allTimeWinners, riskData.winnersLosers.allTimeWinners);
});

test("risk display model clears current risk rows when every streamed position is closed", () => {
  const model = buildAccountRiskDisplayModel(
    {
      concentration: {
        topPositions: [{ symbol: "AAL", marketValue: 0, weightPercent: 0, unrealizedPnl: 0, sector: "Unknown" }],
        sectors: [{ sector: "Unknown", value: 0, weightPercent: 0 }],
      },
      winnersLosers: {
        todayWinners: [],
        todayLosers: [],
        allTimeWinners: [],
        allTimeLosers: [],
      },
      greeks: {
        perUnderlying: [{ underlying: "AAL", exposure: 0 }],
      },
      expiryConcentration: {
        thisWeek: 500,
        thisMonth: 500,
        next90Days: 500,
      },
    },
    {
      positions: [{ symbol: "AAL", quantity: 0, marketValue: 0, unrealizedPnl: 0 }],
    },
  );

  assert.deepEqual(getOpenPositionRows([{ quantity: 0 }]), []);
  assert.deepEqual(model.concentration.topPositions, []);
  assert.deepEqual(model.concentration.sectors, []);
  assert.deepEqual(model.greeks.perUnderlying, []);
  assert.deepEqual(model.expiryConcentration, {
    thisWeek: 0,
    thisMonth: 0,
    next90Days: 0,
  });
});
