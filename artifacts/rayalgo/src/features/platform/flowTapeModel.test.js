import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFlowSentiment,
  compareFlowEvents,
  formatFlowTradeAge,
  getDefaultFlowSortDir,
  normalizeFlowSortBy,
  normalizeFlowSortDir,
  summarizeFlowSentiment,
} from "./flowTapeModel.js";

const baseTime = Date.parse("2026-04-29T14:30:00.000Z");

const flowEvent = (overrides) => ({
  ticker: "AAPL",
  cp: "C",
  side: "BUY",
  strike: 200,
  expirationDate: "2026-05-15",
  premium: 100_000,
  occurredAt: "2026-04-29T14:29:30.000Z",
  unusualScore: 1.2,
  score: 70,
  vol: 100,
  oi: 50,
  ...overrides,
});

test("formatFlowTradeAge uses compact relative buckets", () => {
  assert.equal(formatFlowTradeAge("2026-04-29T14:29:58.000Z", baseTime), "now");
  assert.equal(formatFlowTradeAge("2026-04-29T14:29:42.000Z", baseTime), "18s");
  assert.equal(formatFlowTradeAge("2026-04-29T14:24:00.000Z", baseTime), "6m");
  assert.equal(formatFlowTradeAge("2026-04-29T11:30:00.000Z", baseTime), "3h");
  assert.equal(formatFlowTradeAge("2026-04-27T14:30:00.000Z", baseTime), "2d");
  assert.equal(formatFlowTradeAge(null, baseTime), "N/A");
});

test("classifyFlowSentiment uses side-adjusted option direction", () => {
  assert.equal(classifyFlowSentiment(flowEvent({ cp: "C", side: "BUY" })), "bull");
  assert.equal(classifyFlowSentiment(flowEvent({ cp: "P", side: "SELL" })), "bull");
  assert.equal(classifyFlowSentiment(flowEvent({ cp: "P", side: "BUY" })), "bear");
  assert.equal(classifyFlowSentiment(flowEvent({ cp: "C", side: "SELL" })), "bear");
  assert.equal(classifyFlowSentiment(flowEvent({ cp: "C", side: "MID" })), "neutral");
});

test("summarizeFlowSentiment returns premium shares and net premium", () => {
  const summary = summarizeFlowSentiment([
    flowEvent({ cp: "C", side: "BUY", premium: 200_000 }),
    flowEvent({ cp: "P", side: "BUY", premium: 50_000 }),
    flowEvent({ cp: "C", side: "MID", premium: 50_000 }),
  ]);

  assert.equal(summary.bullPremium, 200_000);
  assert.equal(summary.bearPremium, 50_000);
  assert.equal(summary.neutralPremium, 50_000);
  assert.equal(summary.netPremium, 150_000);
  assert.equal(summary.bullShare, 2 / 3);
});

test("flow sort normalization keeps legacy values compatible", () => {
  assert.equal(normalizeFlowSortBy("age"), "time");
  assert.equal(normalizeFlowSortBy("not-real"), "time");
  assert.equal(getDefaultFlowSortDir("ticker"), "asc");
  assert.equal(getDefaultFlowSortDir("premium"), "desc");
  assert.equal(getDefaultFlowSortDir("mark"), "desc");
  assert.equal(getDefaultFlowSortDir("otmPercent"), "asc");
  assert.equal(normalizeFlowSortDir(undefined, "ticker"), "asc");
});

test("compareFlowEvents sorts by headers and respects direction", () => {
  const older = flowEvent({
    ticker: "AAPL",
    strike: 200,
    premium: 100_000,
    occurredAt: "2026-04-29T14:00:00.000Z",
  });
  const newer = flowEvent({
    ticker: "PLTR",
    strike: 30,
    premium: 500_000,
    occurredAt: "2026-04-29T14:10:00.000Z",
  });

  assert.deepEqual(
    [older, newer].sort((left, right) => compareFlowEvents(left, right, "time", "desc")),
    [newer, older],
  );
  assert.deepEqual(
    [older, newer].sort((left, right) => compareFlowEvents(left, right, "ticker", "asc")),
    [older, newer],
  );
  assert.deepEqual(
    [older, newer].sort((left, right) => compareFlowEvents(left, right, "premium", "desc")),
    [newer, older],
  );
  assert.deepEqual(
    [older, newer].sort((left, right) => compareFlowEvents(left, right, "strike", "asc")),
    [newer, older],
  );
});

test("compareFlowEvents sorts flow mark and out-of-money percent", () => {
  const near = flowEvent({
    ticker: "AAPL",
    mark: 1.2,
    otmPercent: 0.8,
    occurredAt: "2026-04-29T14:00:00.000Z",
  });
  const far = flowEvent({
    ticker: "PLTR",
    mark: 0.35,
    otmPercent: 7.4,
    occurredAt: "2026-04-29T14:10:00.000Z",
  });

  assert.deepEqual(
    [far, near].sort((left, right) => compareFlowEvents(left, right, "mark", "desc")),
    [near, far],
  );
  assert.deepEqual(
    [far, near].sort((left, right) => compareFlowEvents(left, right, "otmPercent", "asc")),
    [near, far],
  );
});

test("compareFlowEvents sorts spot price", () => {
  const lowSpot = flowEvent({
    ticker: "AAPL",
    spot: 185,
    occurredAt: "2026-04-29T14:00:00.000Z",
  });
  const highSpot = flowEvent({
    ticker: "SPY",
    spot: 515,
    occurredAt: "2026-04-29T14:10:00.000Z",
  });

  assert.deepEqual(
    [lowSpot, highSpot].sort((left, right) =>
      compareFlowEvents(left, right, "spot", "desc"),
    ),
    [highSpot, lowSpot],
  );
});
