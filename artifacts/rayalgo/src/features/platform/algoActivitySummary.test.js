import assert from "node:assert/strict";
import test from "node:test";

import {
  __internalsForTests,
  summarizeCockpitDelta,
} from "./algoActivitySummary";

const fixedNow = Date.parse("2026-05-18T14:31:30.000Z");
const prevAt = "2026-05-18T14:30:00.000Z";

test("summary on first render reports total fresh signal count", () => {
  const result = summarizeCockpitDelta({
    prevSnapshot: null,
    nextSnapshot: {
      evaluatedAt: prevAt,
      signals: [
        { symbol: "SPY", timeframe: "5m", fresh: true, status: "ok" },
        { symbol: "NVDA", timeframe: "5m", fresh: false, status: "ok" },
      ],
    },
    recentEvents: [],
    nowMs: fixedNow,
  });
  assert.ok(result.segments.some((segment) => segment.kind === "fresh"));
  const fresh = result.segments.find((segment) => segment.kind === "fresh");
  assert.match(fresh.text, /tracking 1 fresh signal/);
});

test("summary surfaces newly fresh signals with sample symbols", () => {
  const result = summarizeCockpitDelta({
    prevSnapshot: {
      evaluatedAt: prevAt,
      signals: [
        { symbol: "SPY", timeframe: "5m", fresh: false, status: "ok" },
        { symbol: "NVDA", timeframe: "5m", fresh: false, status: "ok" },
      ],
    },
    nextSnapshot: {
      evaluatedAt: prevAt,
      signals: [
        { symbol: "SPY", timeframe: "5m", direction: "buy", fresh: true, status: "ok" },
        { symbol: "NVDA", timeframe: "5m", direction: "buy", fresh: true, status: "ok" },
      ],
    },
    recentEvents: [],
    nowMs: fixedNow,
  });
  const freshSignals = result.segments.find(
    (segment) => segment.kind === "freshSignals",
  );
  assert.ok(freshSignals);
  assert.equal(freshSignals.count, 2);
  assert.match(freshSignals.text, /SPY/);
  assert.match(freshSignals.text, /NVDA/);
});

test("summary rolls up blocked + filled events within the window", () => {
  const result = summarizeCockpitDelta({
    prevSnapshot: {
      evaluatedAt: prevAt,
      signals: [],
    },
    nextSnapshot: {
      evaluatedAt: prevAt,
      signals: [],
    },
    recentEvents: [
      {
        id: 1,
        eventType: "signal_options_entry",
        symbol: "SPY",
        occurredAt: "2026-05-18T14:30:30.000Z",
      },
      {
        id: 2,
        eventType: "signal_options_blocked",
        symbol: "TSLA",
        summary: "blocked — liquidity",
        occurredAt: "2026-05-18T14:30:45.000Z",
      },
    ],
    nowMs: fixedNow,
  });
  const fills = result.segments.find((segment) => segment.kind === "fills");
  const blocks = result.segments.find((segment) => segment.kind === "blocked");
  assert.equal(fills.count, 1);
  assert.equal(blocks.count, 1);
  assert.match(blocks.text, /liquidity/);
});

test("summary reports profit factor moves when the change is meaningful", () => {
  const result = summarizeCockpitDelta({
    prevSnapshot: { evaluatedAt: prevAt, signals: [] },
    nextSnapshot: { evaluatedAt: prevAt, signals: [] },
    recentEvents: [],
    prevPerformance: { profitFactor: 1.8 },
    nextPerformance: { profitFactor: 1.84 },
    nowMs: fixedNow,
  });
  const pf = result.segments.find(
    (segment) => segment.kind === "profitFactor",
  );
  assert.ok(pf);
  assert.match(pf.text, /up 0.04/);
});

test("summary suppresses sub-percent profit factor wiggles", () => {
  const result = summarizeCockpitDelta({
    prevSnapshot: { evaluatedAt: prevAt, signals: [] },
    nextSnapshot: { evaluatedAt: prevAt, signals: [] },
    recentEvents: [],
    prevPerformance: { profitFactor: 1.84 },
    nextPerformance: { profitFactor: 1.844 },
    nowMs: fixedNow,
  });
  assert.equal(
    result.segments.find((segment) => segment.kind === "profitFactor"),
    undefined,
  );
});

test("summary degrades to 'no change' when nothing happened", () => {
  const result = summarizeCockpitDelta({
    prevSnapshot: { evaluatedAt: prevAt, signals: [] },
    nextSnapshot: { evaluatedAt: prevAt, signals: [] },
    recentEvents: [],
    nowMs: fixedNow,
  });
  const noop = result.segments.find((segment) => segment.kind === "noop");
  assert.ok(noop);
});

test("newlyFreshSignals ignores symbols that were already fresh", () => {
  const result = __internalsForTests.newlyFreshSignals(
    [{ symbol: "SPY", timeframe: "5m", fresh: true, status: "ok" }],
    [{ symbol: "SPY", timeframe: "5m", fresh: true, status: "ok" }],
  );
  assert.equal(result.length, 0);
});

test("formatBlockList tags spread/budget/regime reasons", () => {
  const result = __internalsForTests.formatBlockList([
    {
      symbol: "TSLA",
      eventType: "signal_options_skipped",
      summary: "blocked — liquidity (spread too wide)",
    },
    {
      symbol: "NVDA",
      eventType: "signal_options_blocked",
      summary: "premium budget exceeded",
    },
  ]);
  assert.match(result, /TSLA — liquidity/);
  assert.match(result, /NVDA — budget/);
});
