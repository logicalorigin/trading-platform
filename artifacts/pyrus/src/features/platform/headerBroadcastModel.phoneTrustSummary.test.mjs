import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHeaderSignalTapeItems,
  buildPhoneBroadcastTrustSummary,
  retainEquivalentHeaderSignalContextStates,
} from "./headerBroadcastModel.js";

test("trend-only signal tape items ignore evaluation timestamp churn", () => {
  const buildItem = (lastEvaluatedAt) =>
    buildHeaderSignalTapeItems(
      {
        states: [
          {
            active: true,
            symbol: "SPY",
            timeframe: "5m",
            trendDirection: "bullish",
            status: "ok",
            lastEvaluatedAt,
          },
        ],
      },
      { nowMs: Date.parse("2026-07-16T14:30:00.000Z") },
    )[0];

  const first = buildItem("2026-07-16T14:29:00.000Z");
  const second = buildItem("2026-07-16T14:29:05.000Z");

  assert.ok(first);
  assert.equal(second.id, first.id);
  assert.equal(second.key, first.key);
  assert.equal(second.time, first.time);
  assert.equal(second.timeMs, first.timeMs);
});

test("header context state retention ignores rendered value churn", () => {
  const current = [
    {
      active: true,
      symbol: "SPY",
      timeframe: "5m",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-07-16T14:25:00.000Z",
      currentSignalPrice: 620,
      fresh: true,
      status: "ok",
    },
  ];
  const priceOnly = [
    {
      ...current[0],
      currentSignalPrice: 620.25,
      latestBarAt: "2026-07-16T14:30:00.000Z",
      lastEvaluatedAt: "2026-07-16T14:30:01.000Z",
    },
  ];
  const noLongerEligibleForContext = [
    {
      ...priceOnly[0],
      status: "error",
    },
  ];

  assert.equal(
    retainEquivalentHeaderSignalContextStates(current, priceOnly),
    current,
  );
  assert.equal(
    retainEquivalentHeaderSignalContextStates(
      current,
      noLongerEligibleForContext,
    ),
    noLongerEligibleForContext,
  );
});

test("the phone trust summary preserves lane order and surfaces only actionable lanes", () => {
  assert.deepEqual(
    buildPhoneBroadcastTrustSummary([
      { id: "signals", label: "SIGNALS LIVE", priority: "passive" },
      { id: "flow", label: "FLOW STALE", priority: "attention" },
      { id: "algo", label: "ALGO BLOCKED", priority: "danger" },
    ]),
    {
      label: "SIGNALS LIVE · FLOW STALE · ALGO BLOCKED",
      toneKind: "danger",
      actionableLaneIds: ["flow", "algo"],
    },
  );
});

test("checking and passive states stay summarized without expanding a lane", () => {
  assert.deepEqual(
    buildPhoneBroadcastTrustSummary([
      { id: "signals", label: "SIGNALS SYNCING", priority: "checking" },
      { id: "flow", label: "FLOW QUIET", priority: "passive" },
      { id: "algo", label: "ALGO CLEAR", priority: "passive" },
    ]),
    {
      label: "SIGNALS SYNCING · FLOW QUIET · ALGO CLEAR",
      toneKind: "checking",
      actionableLaneIds: [],
    },
  );
});
