import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHeaderSignalTapeItems,
  buildHeaderUnusualTapeItems,
  getHeaderBroadcastSpeedDurations,
  resolveHeaderBroadcastSpeedPreset,
} from "./headerBroadcastModel.js";

test("header broadcast speed presets default to slower lanes", () => {
  assert.equal(resolveHeaderBroadcastSpeedPreset("missing"), "slow");
  assert.equal(resolveHeaderBroadcastSpeedPreset("fast"), "fast");
  assert.deepEqual(getHeaderBroadcastSpeedDurations("slow"), {
    label: "Slow",
    signalDurationSeconds: 64,
    unusualDurationSeconds: 84,
  });
});

test("buildHeaderSignalTapeItems merges active state and recent events", () => {
  const nowMs = Date.parse("2026-04-27T16:00:00Z");
  const items = buildHeaderSignalTapeItems(
    {
      states: [
        {
          id: "spy-state",
          symbol: "spy",
          timeframe: "15m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-04-27T15:55:00Z",
          currentSignalPrice: 510.25,
          fresh: true,
          active: true,
        },
        {
          id: "old-state",
          symbol: "msft",
          timeframe: "15m",
          currentSignalDirection: "sell",
          currentSignalAt: "2026-04-25T15:55:00Z",
          active: true,
        },
      ],
      events: [
        {
          id: "spy-event",
          symbol: "SPY",
          timeframe: "15m",
          direction: "buy",
          signalAt: "2026-04-27T15:55:00Z",
          signalPrice: 510.25,
        },
        {
          id: "old-event",
          symbol: "QQQ",
          timeframe: "15m",
          direction: "sell",
          signalAt: "2026-04-25T15:55:00Z",
        },
      ],
    },
    { nowMs },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].symbol, "SPY");
  assert.equal(items[0].source, "state");
  assert.equal(items[0].fresh, true);
});

test("buildHeaderSignalTapeItems sorts newest signal first", () => {
  const items = buildHeaderSignalTapeItems(
    {
      events: [
        {
          id: "a",
          symbol: "AAPL",
          timeframe: "5m",
          direction: "buy",
          signalAt: "2026-04-27T15:00:00Z",
        },
        {
          id: "n",
          symbol: "NVDA",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-04-27T15:30:00Z",
        },
      ],
    },
    { nowMs: Date.parse("2026-04-27T16:00:00Z") },
  );

  assert.deepEqual(
    items.map((item) => item.symbol),
    ["NVDA", "AAPL"],
  );
});

test("buildHeaderUnusualTapeItems ranks scanner-selected flow events", () => {
  const items = buildHeaderUnusualTapeItems([
    {
      id: "routine",
      ticker: "SPY",
      isUnusual: false,
      unusualScore: 0.8,
      premium: 800_000,
      occurredAt: "2026-04-27T15:58:00Z",
    },
    {
      id: "older-higher-score",
      ticker: "NVDA",
      isUnusual: true,
      unusualScore: 5.2,
      premium: 300_000,
      occurredAt: "2026-04-27T15:45:00Z",
      cp: "C",
    },
    {
      id: "newer",
      ticker: "QQQ",
      isUnusual: true,
      unusualScore: 2.4,
      premium: 120_000,
      occurredAt: "2026-04-27T15:55:00Z",
      cp: "P",
    },
  ]);

  assert.deepEqual(
    items.map((item) => item.symbol),
    ["SPY", "QQQ", "NVDA"],
  );
  assert.equal(items[1].right, "P");
});
