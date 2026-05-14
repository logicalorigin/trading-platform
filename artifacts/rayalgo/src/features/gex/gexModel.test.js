import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateMetrics,
  chunkGexExpirations,
  computeSqueeze,
  contractGex,
  gexByExpiry,
  maxPainStrike,
  normalizeGexOptionChain,
  normalizeGexResponseOptions,
  selectGexExpirations,
} from "./gexModel.js";

const quote = ({
  right,
  strike,
  expirationDate = "2026-05-15",
  gamma = 0.01,
  openInterest = 100,
  impliedVolatility = 0.2,
} = {}) => ({
  contract: {
    ticker: `O:SPY260515${right === "put" ? "P" : "C"}${String(
      Math.round(strike * 1000),
    ).padStart(8, "0")}`,
    underlying: "SPY",
    expirationDate,
    strike,
    right,
    multiplier: 100,
  },
  gamma,
  openInterest,
  impliedVolatility,
  updatedAt: "2026-05-08T14:30:00.000Z",
});

test("normalizes option-chain quotes into signed GEX rows with coverage", () => {
  const { rows, coverage } = normalizeGexOptionChain([
    quote({ right: "call", strike: 100 }),
    quote({ right: "put", strike: 95, gamma: null, openInterest: null }),
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].cp, "C");
  assert.equal(rows[1].cp, "P");
  assert.equal(rows[1].gamma, 0);
  assert.equal(rows[1].openInterest, 0);
  assert.equal(coverage.total, 2);
  assert.equal(coverage.usable, 2);
  assert.equal(coverage.withGamma, 1);
  assert.equal(coverage.withOpenInterest, 1);
});

test("normalizes API GEX response options without option-chain contract wrappers", () => {
  const { rows, coverage } = normalizeGexResponseOptions([
    {
      strike: 100,
      expireYear: 2026,
      expireMonth: 5,
      expireDay: 15,
      cp: "C",
      gamma: 0.02,
      delta: 0.5,
      openInterest: 10,
      impliedVol: 0.2,
      bid: 1,
      ask: 1.05,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].expirationDate, "2026-05-15");
  assert.equal(rows[0].cp, "C");
  assert.equal(rows[0].multiplier, 100);
  assert.equal(coverage.total, 1);
  assert.equal(coverage.usable, 1);
  assert.equal(coverage.withGamma, 1);
});

test("GEX normalization rejects impossible expiration dates", () => {
  const chain = normalizeGexOptionChain([
    quote({ right: "call", strike: 100, expirationDate: "2026-02-31" }),
  ]);
  assert.equal(chain.coverage.total, 1);
  assert.equal(chain.coverage.usable, 0);
  assert.equal(chain.rows.length, 0);

  const response = normalizeGexResponseOptions([
    {
      strike: 100,
      expireYear: 2026,
      expireMonth: 2,
      expireDay: 31,
      cp: "C",
      gamma: 0.02,
      openInterest: 10,
    },
  ]);
  assert.equal(response.coverage.total, 1);
  assert.equal(response.coverage.usable, 0);
  assert.equal(response.rows.length, 0);
});

test("contractGex signs calls positive and puts negative", () => {
  const { rows } = normalizeGexOptionChain([
    quote({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
    quote({ right: "put", strike: 100, gamma: 0.02, openInterest: 10 }),
  ]);

  assert.equal(contractGex(rows[0], 100), 2_000);
  assert.equal(contractGex(rows[1], 100), -2_000);
});

test("aggregateMetrics finds walls, totals, OI, and peak GEX", () => {
  const { rows } = normalizeGexOptionChain([
    quote({ right: "call", strike: 100, gamma: 0.03, openInterest: 100 }),
    quote({ right: "call", strike: 105, gamma: 0.01, openInterest: 100 }),
    quote({ right: "put", strike: 95, gamma: 0.04, openInterest: 100 }),
    quote({ right: "put", strike: 90, gamma: 0.01, openInterest: 100 }),
  ]);
  const metrics = aggregateMetrics(rows, 100);

  assert.equal(metrics.callWall, 100);
  assert.equal(metrics.putWall, 95);
  assert.equal(metrics.peakGexStrike, 95);
  assert.equal(metrics.callOi, 200);
  assert.equal(metrics.putOi, 200);
  assert.equal(metrics.netGex, -10_000);
});

test("expiry aggregation and max pain use normalized option rows", () => {
  const { rows } = normalizeGexOptionChain([
    quote({ right: "call", strike: 100, expirationDate: "2026-05-08" }),
    quote({ right: "put", strike: 95, expirationDate: "2026-05-15" }),
    quote({ right: "call", strike: 105, expirationDate: "2026-05-15" }),
  ]);
  const expiryRows = gexByExpiry(rows, 100, new Date("2026-05-08T15:00:00Z"));

  assert.equal(expiryRows.length, 2);
  assert.equal(expiryRows[0].label, "0DTE");
  assert.equal(expiryRows[1].sublabel, "7d");
  assert.equal(maxPainStrike(rows), 95);
});

test("squeeze scoring uses real flow direction and conservative volume when baseline is unavailable", () => {
  const metrics = {
    netGex: -1,
    callWall: 102,
    putWall: 98,
  };
  const squeeze = computeSqueeze(metrics, 100, {
    bullishShare: 0.75,
    todayVol: 100,
    avg30dVol: 0,
    netDelta: 50,
    refDelta: 100,
    eventCount: 2,
    volumeBaselineReady: false,
  });

  assert.equal(squeeze.flowPending, false);
  assert.equal(squeeze.flowEventCount, 2);
  assert.equal(squeeze.factors.volumeConfirm, 5);
  assert.equal(squeeze.bias, "BULLISH");
});

test("expiration selection is bounded and chunked", () => {
  const expirations = Array.from({ length: 12 }, (_, index) => ({
    expirationDate: `2026-05-${String(index + 1).padStart(2, "0")}`,
  }));

  assert.equal(selectGexExpirations(expirations, "all").length, 10);
  assert.deepEqual(selectGexExpirations(expirations, "2026-05-03"), [
    "2026-05-03",
  ]);
  assert.deepEqual(chunkGexExpirations(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
});
