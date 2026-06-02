import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGexProjection,
  type GexProjectionOptionRow,
  type GexProjectionRatesInput,
} from "./gex-projection";

const rates: GexProjectionRatesInput = {
  status: "ok",
  source: "treasury_daily_par_yield_curve",
  asOf: "2026-05-29",
  points: [
    { tenorYears: 1 / 12, rate: 0.052 },
    { tenorYears: 0.5, rate: 0.049 },
    { tenorYears: 1, rate: 0.047 },
  ],
};

function option(
  strike: number,
  cp: "C" | "P",
  expirationDate: string,
  overrides: Partial<GexProjectionOptionRow> = {},
): GexProjectionOptionRow {
  return {
    strike,
    cp,
    expirationDate,
    gamma: 0.02,
    delta: cp === "C" ? 0.5 : -0.5,
    openInterest: 100,
    impliedVol: 0.28,
    bid: 1,
    ask: 1.2,
    multiplier: 100,
    volume: 10,
    ...overrides,
  };
}

test("buildGexProjection returns monotonic listed-expiration cone bands", () => {
  const projection = buildGexProjection({
    ticker: "SPY",
    spot: 100,
    asOf: "2026-05-31T15:30:00.000Z",
    rates,
    dividendYield: { status: "unavailable", value: 0, source: "none" },
    source: {
      provider: "massive",
      status: "ok",
      expirationCoverage: {
        requestedCount: 1,
        returnedCount: 1,
        loadedCount: 1,
        failedCount: 0,
        complete: true,
        capped: false,
      },
      optionCount: 18,
      usableOptionCount: 18,
      withGamma: 18,
      withOpenInterest: 18,
      withImpliedVolatility: 18,
      flowStatus: "unavailable",
      flowEventCount: 0,
      classifiedFlowEventCount: 0,
      flowClassificationCoverage: 0,
      flowClassificationConfidenceCounts: {
        high: 0,
        medium: 0,
        low: 0,
        none: 0,
      },
    },
    options: [80, 85, 90, 95, 100, 105, 110, 115, 120].flatMap((strike) => [
      option(strike, "C", "2026-06-19"),
      option(strike, "P", "2026-06-19"),
    ]),
  });

  assert.equal(projection.ticker, "SPY");
  assert.equal(
    projection.model.surfaceWeighting,
    "oi_volume_premium_spread_weighted_iv",
  );
  assert.equal(projection.expirations.length, 1);
  assert.equal(projection.overlayPoints.length, 1);

  const expiry = projection.expirations[0];
  assert.equal(expiry?.expirationDate, "2026-06-19");
  assert.equal(expiry?.quality.status, "ok");
  assert.equal(expiry?.dealerPositioning.mode, "best_available");
  assert.equal(expiry?.dealerPositioning.appliedSignBasis, "baseline_open_interest");
  assert.ok(expiry?.bands.lower2 < expiry!.bands.lower1);
  assert.ok(expiry?.bands.lower1 < expiry!.adjustedCenter);
  assert.ok(expiry?.adjustedCenter < expiry!.bands.upper1);
  assert.ok(expiry?.bands.upper1 < expiry!.bands.upper2);
  assert.ok(expiry?.bands.upper1 > 100);
  assert.ok(expiry?.bands.lower1 < 100);
});

test("buildGexProjection weights IV surface by premium, open interest, volume, and spread quality", () => {
  const options = [80, 85, 90, 95, 100, 105, 110, 115, 120].flatMap(
    (strike) => [
      option(strike, "C", "2026-06-19", {
        impliedVol: 0.22,
        openInterest: 2_000,
        bid: 3,
        ask: 3.2,
        volume: 800,
      }),
      option(strike, "P", "2026-06-19", {
        impliedVol: 1.8,
        openInterest: 0,
        bid: 0.01,
        ask: 0.02,
        volume: 0,
      }),
    ],
  );
  const projection = buildGexProjection({
    ticker: "SPY",
    spot: 100,
    asOf: "2026-05-31T15:30:00.000Z",
    rates,
    dividendYield: { status: "unavailable", value: 0, source: "none" },
    source: {
      provider: "massive",
      status: "ok",
      expirationCoverage: {
        requestedCount: 1,
        returnedCount: 1,
        loadedCount: 1,
        failedCount: 0,
        complete: true,
        capped: false,
      },
      optionCount: options.length,
      usableOptionCount: options.length,
      withGamma: options.length,
      withOpenInterest: options.length,
      withImpliedVolatility: options.length,
      flowStatus: "unavailable",
      flowEventCount: 0,
      classifiedFlowEventCount: 0,
      flowClassificationCoverage: 0,
      flowClassificationConfidenceCounts: { high: 0, medium: 0, low: 0, none: 0 },
    },
    options,
  });

  const expiry = projection.expirations[0];
  assert.equal(expiry?.quality.status, "ok");
  assert.equal(expiry?.gexLevels.callWall, 100);
  assert.equal(expiry?.gexLevels.putWall, null);
  assert.equal(expiry?.gexLevels.peakGammaStrike, 100);
  assert.ok((expiry?.rawCenter ?? 0) > 99);
  assert.ok((expiry?.rawCenter ?? 0) < 101);
  assert.ok((expiry?.bands.upper1 ?? Infinity) <= 105);
  assert.ok((expiry?.bands.lower1 ?? 0) >= 95);
  assert.ok(Math.abs((expiry?.adjustedCenter ?? 0) - (expiry?.rawCenter ?? 0)) < 1);
});

test("buildGexProjection skips unsupported expirations with quality reasons", () => {
  const projection = buildGexProjection({
    ticker: "SPY",
    spot: 100,
    asOf: "2026-05-31T15:30:00.000Z",
    rates,
    dividendYield: { status: "ok", value: 0.01, source: "provider" },
    source: {
      provider: "massive",
      status: "partial",
      expirationCoverage: {
        requestedCount: 1,
        returnedCount: 1,
        loadedCount: 1,
        failedCount: 0,
        complete: false,
        capped: true,
      },
      optionCount: 2,
      usableOptionCount: 2,
      withGamma: 2,
      withOpenInterest: 2,
      withImpliedVolatility: 0,
      flowStatus: "unavailable",
      flowEventCount: 0,
      classifiedFlowEventCount: 0,
      flowClassificationCoverage: 0,
      flowClassificationConfidenceCounts: { high: 0, medium: 0, low: 0, none: 0 },
    },
    options: [
      option(100, "C", "2026-06-19", { impliedVol: 0 }),
      option(100, "P", "2026-06-19", { impliedVol: 0 }),
    ],
  });

  assert.equal(projection.expirations.length, 1);
  assert.equal(projection.overlayPoints.length, 0);
  assert.equal(projection.quality.status, "unavailable");
  assert.equal(projection.expirations[0]?.quality.status, "unavailable");
  assert.match(projection.expirations[0]?.quality.reasons.join(" "), /valid IV/);
});

test("buildGexProjection applies adjusted dealer signs when flow confidence is usable", () => {
  const projection = buildGexProjection({
    ticker: "SPY",
    spot: 100,
    asOf: "2026-05-31T15:30:00.000Z",
    rates,
    dividendYield: { status: "unavailable", value: 0, source: "none" },
    flowContext: {
      bullishShare: 0.72,
      todayVol: 900_000,
      avg30dVol: 500_000,
      netDelta: 250_000,
      refDelta: 100_000,
      eventCount: 42,
      volumeBaselineReady: true,
    },
    source: {
      provider: "massive",
      status: "ok",
      expirationCoverage: {
        requestedCount: 1,
        returnedCount: 1,
        loadedCount: 1,
        failedCount: 0,
        complete: true,
        capped: false,
      },
      optionCount: 18,
      usableOptionCount: 18,
      withGamma: 18,
      withOpenInterest: 18,
      withImpliedVolatility: 18,
      flowStatus: "ok",
      flowEventCount: 42,
      classifiedFlowEventCount: 36,
      flowClassificationCoverage: 0.86,
      flowClassificationConfidenceCounts: { high: 24, medium: 8, low: 4, none: 6 },
    },
    options: [80, 85, 90, 95, 100, 105, 110, 115, 120].flatMap((strike) => [
      option(strike, "C", "2026-06-19"),
      option(strike, "P", "2026-06-19"),
    ]),
  });

  const expiry = projection.expirations[0];
  assert.equal(expiry?.dealerPositioning.appliedSignBasis, "flow_adjusted");
  assert.ok((expiry?.dealerPositioning.confidence ?? 0) >= 0.5);
  assert.ok(expiry?.gexLevels.totalAbsGex != null && expiry.gexLevels.totalAbsGex > 0);
});
