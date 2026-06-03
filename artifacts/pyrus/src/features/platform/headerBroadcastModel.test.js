import assert from "node:assert/strict";
import test from "node:test";
import {
  HEADER_BROADCAST_SCROLL_MIN_SECONDS,
  HEADER_BROADCAST_SPEED_PRESETS,
  HEADER_UNUSUAL_MAX_ITEMS,
  buildHeaderAlgoTapeItems,
  buildHeaderSignalContextSymbols,
  buildHeaderSignalTapeItems,
  buildHeaderUnusualTapeItems,
  getHeaderBroadcastScrollDurationSeconds,
  resolveHeaderBroadcastSpeedPreset,
} from "./headerBroadcastModel.js";

test("header broadcast speed presets default to shared visual pace", () => {
  assert.equal(resolveHeaderBroadcastSpeedPreset("missing"), "slow");
  assert.equal(resolveHeaderBroadcastSpeedPreset("fast"), "fast");
  assert.deepEqual(HEADER_BROADCAST_SPEED_PRESETS.slow, {
    label: "Slow",
    pixelsPerSecond: 18,
  });
  assert.equal(
    getHeaderBroadcastScrollDurationSeconds("slow", { scrollDistancePx: 1440 }),
    80,
  );
  assert.equal(
    getHeaderBroadcastScrollDurationSeconds("normal", { scrollDistancePx: 1440 }),
    60,
  );
  assert.equal(
    getHeaderBroadcastScrollDurationSeconds("fast", { scrollDistancePx: 1440 }),
    40,
  );
  assert.equal(
    getHeaderBroadcastScrollDurationSeconds("fast", { scrollDistancePx: 1 }),
    HEADER_BROADCAST_SCROLL_MIN_SECONDS,
  );
});

test("header broadcast scroll duration scales with lane distance", () => {
  assert.equal(
    getHeaderBroadcastScrollDurationSeconds("normal", { scrollDistancePx: 720 }),
    30,
  );
  assert.equal(
    getHeaderBroadcastScrollDurationSeconds("normal", { scrollDistancePx: 1440 }),
    60,
  );
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

test("buildHeaderSignalTapeItems ignores stale current-state directions", () => {
  const items = buildHeaderSignalTapeItems(
    {
      states: [
        {
          id: "stale-spy-state",
          symbol: "SPY",
          timeframe: "5m",
          status: "stale",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-04-27T15:55:00Z",
          active: true,
        },
      ],
    },
    { nowMs: Date.parse("2026-04-27T16:00:00Z") },
  );

  assert.deepEqual(items, []);
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
          timeframe: "5m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-04-27T15:55:00Z",
          currentSignalPrice: 510.25,
          barsSinceSignal: 0,
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
  assert.deepEqual(items[0].intervalTimeframes, ["1m", "2m", "5m", "15m", "1h"]);
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

test("buildHeaderSignalTapeItems does not use pill state as the 5m dot fallback", () => {
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
  assert.equal(items[0].intervalStates["5m"].currentSignalDirection, null);
  assert.equal(items[0].intervalStates["5m"].currentSignalPrice, undefined);
  assert.equal(items[0].intervalStates["5m"].fresh, undefined);
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

test("buildHeaderUnusualTapeItems keeps the latest 100 scanner events", () => {
  const events = Array.from({ length: 120 }, (_, index) => ({
    id: `flow-${index}`,
    ticker: index % 2 === 0 ? "SPY" : "QQQ",
    premium: 50_000 + index,
    occurredAt: new Date(Date.parse("2026-04-27T14:00:00Z") + index * 1000).toISOString(),
  }));

  const items = buildHeaderUnusualTapeItems(events);

  assert.equal(HEADER_UNUSUAL_MAX_ITEMS, 100);
  assert.equal(items.length, 100);
  assert.equal(items[0].key, "flow-119");
  assert.equal(items.at(-1)?.key, "flow-20");
});

test("buildHeaderUnusualTapeItems drops radar fallback activity labels", () => {
  const items = buildHeaderUnusualTapeItems([
    {
      id: "radar-spy",
      underlying: "SPY",
      optionTicker: "SPY CALL ACTIVITY",
      providerContractId: null,
      sourceBasis: "fallback_estimate",
      confidence: "fallback_estimate",
      strike: 500,
      right: "call",
      expirationDate: "2026-05-21T17:00:00.000Z",
      premium: 500_000,
      size: 10,
      openInterest: 0,
      unusualScore: 10,
      isUnusual: true,
      occurredAt: "2026-05-21T17:00:00.000Z",
    },
  ]);

  assert.deepEqual(items, []);
});

test("buildHeaderAlgoTapeItems keeps all recent algo event types newest first", () => {
  const items = buildHeaderAlgoTapeItems([
    {
      id: "skip-1",
      symbol: "msft",
      eventType: "signal_options_skipped",
      summary: "MSFT skipped liquidity",
      occurredAt: "2026-04-27T15:45:00Z",
    },
    {
      id: "entry-1",
      symbol: "spy",
      eventType: "signal_options_shadow_entry",
      summary: "SPY shadow CALL 500 2026-05-01 x2",
      occurredAt: "2026-04-27T15:55:00Z",
    },
    {
      id: "profile-1",
      eventType: "signal_options_profile_updated",
      summary: "Signal options profile updated",
      occurredAt: "2026-04-27T15:50:00Z",
    },
  ]);

  assert.deepEqual(
    items.map((item) => item.actionLabel),
    ["ENTRY", "CONFIG", "SKIP"],
  );
  assert.deepEqual(
    items.map((item) => item.iconKind),
    ["entry", "config", "skip"],
  );
  assert.deepEqual(
    items.map((item) => item.symbol),
    ["SPY", "ALGO", "MSFT"],
  );
  assert.equal(items[1].toneKind, "accent");
});

test("buildHeaderAlgoTapeItems dedupes event ids and classifies exits and blocks", () => {
  const items = buildHeaderAlgoTapeItems([
    {
      id: "exit-1",
      symbol: "qqq",
      eventType: "signal_options_shadow_exit",
      summary: "QQQ shadow exit stop at 1.10",
      occurredAt: "2026-04-27T15:55:00Z",
    },
    {
      id: "exit-1",
      symbol: "qqq",
      eventType: "signal_options_shadow_exit",
      summary: "QQQ shadow exit stop at 1.20",
      occurredAt: "2026-04-27T15:56:00Z",
    },
    {
      id: "blocked-1",
      eventType: "signal_options_gateway_blocked",
      summary: "Gateway blocked algo order",
      occurredAt: "2026-04-27T15:54:00Z",
    },
    {
      id: "mark-1",
      payload: { position: { symbol: "aapl" } },
      eventType: "signal_options_shadow_mark",
      summary: "AAPL mark update",
      occurredAt: "2026-04-27T15:53:00Z",
    },
  ]);

  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => [item.actionLabel, item.iconKind, item.symbol, item.toneKind]),
    [
      ["EXIT", "exit", "QQQ", "danger"],
      ["BLOCK", "blocked", "ALGO", "warning"],
      ["MARK", "mark", "AAPL", "info"],
    ],
  );
  assert.equal(items[0].detail, "QQQ shadow exit stop at 1.20");
});

test("buildHeaderAlgoTapeItems derives entry trade context icons", () => {
  const [item] = buildHeaderAlgoTapeItems([
    {
      id: "entry-context",
      symbol: "SPY",
      eventType: "signal_options_shadow_entry",
      summary: "SPY shadow CALL 500 2026-05-01 x3",
      occurredAt: "2026-04-27T15:55:00Z",
      payload: {
        selectedContract: { right: "call" },
        selectedExpiration: { dte: 4 },
        orderPlan: { quantity: 3, premiumAtRisk: 2450 },
      },
    },
  ]);

  assert.deepEqual(
    item.contextIcons.map((context) => [
      context.kind,
      context.iconKind,
      context.toneKind,
      context.valueLabel || "",
    ]),
    [
      ["contract", "call", "success", ""],
      ["status", "opened", "success", ""],
      ["money", "money", "accent", "$2.5K"],
      ["quantity", "quantity", "info", "x3"],
    ],
  );
});

test("buildHeaderAlgoTapeItems derives exit pnl context icons", () => {
  const [item] = buildHeaderAlgoTapeItems([
    {
      id: "exit-context",
      symbol: "QQQ",
      eventType: "signal_options_shadow_exit",
      summary: "QQQ shadow exit stop at 1.10",
      occurredAt: "2026-04-27T15:55:00Z",
      payload: {
        pnl: -87.2,
        selectedContract: { right: "put" },
        position: { quantity: 2 },
      },
    },
  ]);

  assert.deepEqual(
    item.contextIcons.map((context) => [
      context.kind,
      context.iconKind,
      context.toneKind,
      context.valueLabel || "",
    ]),
    [
      ["contract", "put", "danger", ""],
      ["status", "loss_exit", "danger", "-$87"],
      ["quantity", "quantity", "info", "x2"],
    ],
  );
});

test("buildHeaderAlgoTapeItems prioritizes skip and block reasons in context icons", () => {
  const items = buildHeaderAlgoTapeItems([
    {
      id: "skip-context",
      symbol: "MSFT",
      eventType: "signal_options_skipped",
      summary: "MSFT skipped liquidity",
      occurredAt: "2026-04-27T15:55:00Z",
      payload: {
        reason: "liquidity_gate_failed",
        candidate: { optionRight: "put" },
        position: { quantity: 5 },
      },
    },
    {
      id: "blocked-context",
      symbol: "AAPL",
      eventType: "signal_options_gateway_blocked",
      summary: "Gateway blocked algo order",
      occurredAt: "2026-04-27T15:54:00Z",
      payload: {
        readiness: { reason: "algo_gateway_not_ready" },
      },
    },
  ]);

  assert.deepEqual(
    items[0].contextIcons.map((context) => [
      context.kind,
      context.iconKind,
      context.toneKind,
      context.valueLabel || "",
    ]),
    [
      ["contract", "put", "danger", ""],
      ["status", "skipped", "warning", ""],
      ["reason", "reason", "warning", "LIQ"],
      ["quantity", "quantity", "info", "x5"],
    ],
  );
  assert.deepEqual(
    items[1].contextIcons.map((context) => [
      context.kind,
      context.iconKind,
      context.toneKind,
      context.valueLabel || "",
    ]),
    [
      ["status", "blocked", "warning", ""],
      ["reason", "reason", "warning", "GATEWAY"],
    ],
  );
});

test("buildHeaderAlgoTapeItems uses readable operational reason labels", () => {
  const items = buildHeaderAlgoTapeItems([
    {
      id: "position-mark",
      symbol: "AAPL",
      eventType: "signal_options_skipped",
      occurredAt: "2026-04-27T15:55:00Z",
      payload: { reason: "position_mark_unavailable" },
    },
    {
      id: "option-chain",
      symbol: "MSFT",
      eventType: "signal_options_skipped",
      occurredAt: "2026-04-27T15:54:00Z",
      payload: { reason: "option_chain_backoff" },
    },
    {
      id: "missing-bid",
      symbol: "CLSK",
      eventType: "signal_options_skipped",
      occurredAt: "2026-04-27T15:53:00Z",
      payload: { reason: "missing_bid" },
    },
    {
      id: "market-session",
      eventType: "signal_options_gateway_blocked",
      occurredAt: "2026-04-27T15:52:00Z",
      payload: { readiness: { reason: "market_session_quiet" } },
    },
  ]);

  assert.deepEqual(
    items.map((item) =>
      item.contextIcons.find((context) => context.kind === "reason")
        ?.valueLabel,
    ),
    ["NO MARK", "CHAIN", "NO BID", "SESSION"],
  );
});
