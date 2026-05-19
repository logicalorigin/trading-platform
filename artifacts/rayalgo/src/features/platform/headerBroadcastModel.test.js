import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHeaderSignalContextSymbols,
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

test("buildHeaderSignalTapeItems attaches interval context to 5m signal pills", () => {
  const nowMs = Date.parse("2026-04-27T16:00:00Z");
  const items = buildHeaderSignalTapeItems(
    {
      states: [
        {
          id: "spy-5m-state",
          symbol: "SPY",
          timeframe: "5m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-04-27T15:55:00Z",
          currentSignalPrice: 510.25,
          barsSinceSignal: 0,
          fresh: true,
          active: true,
        },
      ],
    },
    {
      nowMs,
      signalMatrixStates: [
        {
          symbol: "spy",
          timeframe: "2m",
          currentSignalDirection: "sell",
          currentSignalAt: "2026-04-27T15:54:00Z",
          barsSinceSignal: 1,
          fresh: true,
        },
        {
          symbol: "SPY",
          timeframe: "15m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-04-27T15:45:00Z",
          barsSinceSignal: 2,
          fresh: false,
        },
      ],
    },
  );

  assert.equal(items.length, 1);
  assert.deepEqual(items[0].intervalTimeframes, ["2m", "5m", "15m"]);
  assert.equal(items[0].intervalStates["2m"].currentSignalDirection, "sell");
  assert.equal(items[0].intervalStates["5m"].currentSignalDirection, "buy");
  assert.equal(items[0].intervalStates["5m"].barsSinceSignal, 0);
  assert.equal(items[0].intervalStates["15m"].currentSignalDirection, "buy");
});

test("buildHeaderSignalTapeItems does not promote matrix-only intervals into pills", () => {
  const items = buildHeaderSignalTapeItems(
    {},
    {
      nowMs: Date.parse("2026-04-27T16:00:00Z"),
      signalMatrixStates: [
        {
          symbol: "SPY",
          timeframe: "2m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-04-27T15:58:00Z",
          fresh: true,
        },
        {
          symbol: "QQQ",
          timeframe: "15m",
          currentSignalDirection: "sell",
          currentSignalAt: "2026-04-27T15:45:00Z",
          fresh: true,
        },
      ],
    },
  );

  assert.deepEqual(items, []);
});

test("buildHeaderSignalTapeItems uses pill state as the 5m dot fallback", () => {
  const items = buildHeaderSignalTapeItems(
    {
      events: [
        {
          id: "nvda-event",
          symbol: "NVDA",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-04-27T15:55:00Z",
          signalPrice: 910.12,
        },
      ],
    },
    {
      nowMs: Date.parse("2026-04-27T16:00:00Z"),
      signalMatrixStates: [
        {
          symbol: "NVDA",
          timeframe: "5m",
          currentSignalDirection: null,
          status: "ok",
        },
      ],
    },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].intervalStates["5m"].currentSignalDirection, "sell");
  assert.equal(items[0].intervalStates["5m"].currentSignalPrice, 910.12);
  assert.equal(items[0].intervalStates["5m"].fresh, false);
});

test("buildHeaderSignalContextSymbols includes every visible signal pill symbol", () => {
  const symbols = buildHeaderSignalContextSymbols(
    {
      states: [
        {
          id: "older-state",
          symbol: "SPY",
          timeframe: "5m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-04-27T15:10:00Z",
          active: true,
        },
      ],
      events: [
        {
          id: "latest-event",
          symbol: "NVDA",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-04-27T15:55:00Z",
        },
        {
          id: "different-timeframe",
          symbol: "QQQ",
          timeframe: "15m",
          direction: "buy",
          signalAt: "2026-04-27T15:58:00Z",
        },
      ],
    },
    {
      nowMs: Date.parse("2026-04-27T16:00:00Z"),
      maxSymbols: 4,
    },
  );

  assert.deepEqual(symbols, ["QQQ", "NVDA", "SPY"]);
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
