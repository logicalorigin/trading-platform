import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGexZeroGammaDataFromDashboard,
  type GexOptionRow,
  type GexResponse,
} from "./gex";
import { buildGexZeroGammaSimulation } from "./gex-zero-gamma-simulation";

const option = ({
  strike,
  cp,
  openInterest,
  impliedVol = 0.2,
  gamma = 0,
}: {
  strike: number;
  cp: "C" | "P";
  openInterest: number;
  impliedVol?: number;
  gamma?: number;
}) => ({
  strike,
  cp,
  expirationDate: "2026-07-17",
  expireYear: 2026,
  expireMonth: 7,
  expireDay: 17,
  gamma,
  delta: 0,
  openInterest,
  impliedVol,
  bid: 1,
  ask: 1.1,
  multiplier: 100,
});

const dashboard = (options: GexOptionRow[]): GexResponse => ({
  ticker: "TEST",
  tickerDetails: {
    ticker: "TEST",
    name: "Test Co",
    sector: "",
    industry: "",
    marketCap: null,
    exchangeShortName: "",
    country: "",
    isEtf: false,
    isFund: false,
  },
  profile: {
    price: 100,
    dayLow: 99,
    dayHigh: 101,
    yearLow: null,
    yearHigh: null,
    mktCap: null,
  },
  spot: 100,
  timestamp: "2026-06-18T19:00:00.000Z",
  isStale: false,
  options,
  snapshots: [],
  flowContext: null,
  flowContextStatus: "unavailable",
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
    quoteUpdatedAt: null,
    chainUpdatedAt: "2026-06-18T19:00:00.000Z",
    flowStatus: "unavailable",
    flowEventCount: 0,
    classifiedFlowEventCount: 0,
    flowClassificationCoverage: 0,
    flowClassificationBasisCounts: { quoteMatch: 0, tickTest: 0, none: 0 },
    flowClassificationConfidenceCounts: { high: 0, medium: 0, low: 0, none: 0 },
    message: null,
  },
});

test("zero-gamma simulation finds the nearest spot-sweep crossing", () => {
  const simulation = buildGexZeroGammaSimulation({
    ticker: "TEST",
    spot: 100,
    asOf: "2026-06-18T19:00:00.000Z",
    options: [
      option({ strike: 95, cp: "P", openInterest: 1500 }),
      option({ strike: 105, cp: "C", openInterest: 1500 }),
    ],
    scan: { lower: 85, upper: 115, pointCount: 121 },
  });

  assert.equal(simulation.quality.status, "partial");
  assert.ok(simulation.zeroGamma);
  assert.ok(simulation.zeroGamma > 95);
  assert.ok(simulation.zeroGamma < 105);
  assert.ok(simulation.crossings.length >= 1);
});

test("zero-gamma simulation returns null when net gamma never crosses", () => {
  const simulation = buildGexZeroGammaSimulation({
    ticker: "TEST",
    spot: 100,
    asOf: "2026-06-18T19:00:00.000Z",
    options: [
      option({ strike: 100, cp: "C", openInterest: 1000 }),
      option({ strike: 105, cp: "C", openInterest: 500 }),
    ],
    scan: { lower: 85, upper: 115, pointCount: 121 },
  });

  assert.equal(simulation.zeroGamma, null);
  assert.deepEqual(simulation.crossings, []);
  assert.ok(simulation.netGexAtSpot > 0);
});

test("zero-gamma response reports zeroGammaMethod=simulation when the sweep crosses", () => {
  const data = buildGexZeroGammaDataFromDashboard(
    dashboard([
      option({ strike: 95, cp: "P", openInterest: 1500 }),
      option({ strike: 105, cp: "C", openInterest: 1500 }),
    ]),
  );

  assert.equal(data.zeroGammaMethod, "simulation");
  assert.ok(data.zeroGamma != null);
  assert.equal(data.zeroGamma, data.simulation?.zeroGamma);
});

test("zero-gamma response reports zeroGammaMethod=legacy when the simulation cannot resolve", () => {
  // impliedVol=0 makes every option unusable for the BS spot-sweep, so the
  // simulation yields no zeroGamma; the provided gamma fields still give the
  // legacy strike-cumulative interpolation a sign flip between 95 and 105.
  const data = buildGexZeroGammaDataFromDashboard(
    dashboard([
      option({ strike: 95, cp: "P", openInterest: 1000, impliedVol: 0, gamma: 0.05 }),
      option({ strike: 105, cp: "C", openInterest: 1000, impliedVol: 0, gamma: 0.05 }),
    ]),
  );

  assert.equal(data.simulation?.zeroGamma ?? null, null);
  assert.equal(data.zeroGammaMethod, "legacy");
  assert.ok(data.zeroGamma != null);
});

test("zero-gamma response reports zeroGammaMethod=null when neither methodology resolves", () => {
  const data = buildGexZeroGammaDataFromDashboard(dashboard([]));

  assert.equal(data.zeroGamma, null);
  assert.equal(data.zeroGammaMethod, null);
});
