import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPremiumFlowBySymbol,
  buildPremiumFlowSummary,
  buildPremiumFlowTimeline,
  resolvePremiumFlowDisplayState,
} from "./premiumFlowIndicator.js";

const event = (overrides) => ({
  ticker: "AAPL",
  cp: "C",
  premium: 100_000,
  occurredAt: "2026-04-24T14:00:00.000Z",
  isUnusual: false,
  ...overrides,
});

test("buildPremiumFlowSummary computes call, put, net, and shares", () => {
  const summary = buildPremiumFlowSummary("aapl", [
    event({ cp: "C", premium: 200_000 }),
    event({ cp: "P", premium: 50_000 }),
    event({ ticker: "MSFT", cp: "P", premium: 900_000 }),
  ]);

  assert.equal(summary.symbol, "AAPL");
  assert.equal(summary.calls, 200_000);
  assert.equal(summary.puts, 50_000);
  assert.equal(summary.totalPremium, 250_000);
  assert.equal(summary.netPremium, 150_000);
  assert.equal(summary.direction, "call");
  assert.equal(summary.callShare, 0.8);
  assert.equal(summary.putShare, 0.2);
});

test("buildPremiumFlowSummary handles put-dominant and unusual flow", () => {
  const summary = buildPremiumFlowSummary("TSLA", [
    event({ ticker: "TSLA", cp: "C", premium: 100_000 }),
    event({ ticker: "TSLA", cp: "P", premium: 350_000, isUnusual: true }),
  ]);

  assert.equal(summary.netPremium, -250_000);
  assert.equal(summary.direction, "put");
  assert.equal(summary.unusualCount, 1);
  assert.equal(summary.eventCount, 2);
});

test("buildPremiumFlowBySymbol keeps duplicate symbols stable and emits empty summaries", () => {
  const bySymbol = buildPremiumFlowBySymbol(
    [event({ ticker: "QQQ", cp: "C", premium: 125_000 })],
    ["qqq", "QQQ", "IWM"],
  );

  assert.deepEqual(Object.keys(bySymbol), ["QQQ", "IWM"]);
  assert.equal(bySymbol.QQQ.totalPremium, 125_000);
  assert.equal(bySymbol.IWM.totalPremium, 0);
  assert.equal(bySymbol.IWM.direction, "neutral");
});

test("buildPremiumFlowBySymbol accepts raw underlying event shape", () => {
  const bySymbol = buildPremiumFlowBySymbol(
    [event({ ticker: undefined, underlying: "MSFT", cp: "P", premium: 225_000 })],
    ["MSFT"],
  );

  assert.equal(bySymbol.MSFT.puts, 225_000);
  assert.equal(bySymbol.MSFT.direction, "put");
});

test("buildPremiumFlowSummary ignores unknown option sides", () => {
  const summary = buildPremiumFlowSummary("AAPL", [
    event({ cp: "C", premium: 100_000 }),
    event({ cp: "X", premium: 900_000 }),
  ]);

  assert.equal(summary.calls, 100_000);
  assert.equal(summary.puts, 0);
  assert.equal(summary.netPremium, 100_000);
  assert.deepEqual(
    summary.timeline.map((point) => point.value),
    [100_000],
  );
});

test("resolvePremiumFlowDisplayState requires fetching and current batch for scanning", () => {
  const summary = buildPremiumFlowSummary("AAPL", []);

  assert.equal(
    resolvePremiumFlowDisplayState({
      symbol: "AAPL",
      summary,
      flowStatus: "empty",
      providerSummary: {
        coverage: {
          isFetching: false,
          currentBatch: ["AAPL"],
          lastScannedAt: { AAPL: Date.now() },
        },
      },
    }).label,
    "No options flow",
  );

  const active = resolvePremiumFlowDisplayState({
    symbol: "AAPL",
    summary,
    flowStatus: "loading",
    providerSummary: {
      coverage: {
        isFetching: true,
        currentBatch: ["AAPL"],
        lastScannedAt: {},
      },
    },
  });

  assert.equal(active.label, "Scanning");
  assert.equal(active.isScanning, true);
});

test("resolvePremiumFlowDisplayState distinguishes queued, error, and stale states", () => {
  const empty = buildPremiumFlowSummary("TSLA", []);
  const live = buildPremiumFlowSummary("TSLA", [
    event({ ticker: "TSLA", cp: "C", premium: 150_000, sourceLabel: "IBKR SNAPSHOT" }),
  ]);

  assert.equal(
    resolvePremiumFlowDisplayState({
      symbol: "TSLA",
      summary: empty,
      flowStatus: "loading",
      providerSummary: { coverage: { isFetching: false, currentBatch: [] } },
    }).label,
    "Queued flow",
  );
  assert.equal(
    resolvePremiumFlowDisplayState({
      symbol: "TSLA",
      summary: empty,
      flowStatus: "offline",
      providerSummary: {
        failures: [{ symbol: "TSLA", error: "Provider unavailable" }],
        coverage: { isFetching: false, currentBatch: [] },
      },
    }).label,
    "Flow error",
  );

  const stale = resolvePremiumFlowDisplayState({
    symbol: "TSLA",
    summary: live,
    flowStatus: "offline",
    providerSummary: {
      failures: [{ symbol: "TSLA", error: "Provider unavailable" }],
      coverage: { isFetching: false, currentBatch: [] },
    },
  });

  assert.equal(stale.label, "Stale flow");
  assert.equal(stale.isStale, true);
});

test("buildPremiumFlowTimeline creates chronological cumulative net points", () => {
  const timeline = buildPremiumFlowTimeline([
    event({ cp: "P", premium: 40_000, occurredAt: "2026-04-24T15:00:00.000Z" }),
    event({ cp: "C", premium: 100_000, occurredAt: "2026-04-24T14:00:00.000Z" }),
    event({ cp: "C", premium: 25_000, occurredAt: "2026-04-24T16:00:00.000Z" }),
  ]);

  assert.deepEqual(
    timeline.map((point) => point.value),
    [100_000, 60_000, 85_000],
  );
});
