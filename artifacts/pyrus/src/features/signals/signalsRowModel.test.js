import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNALS_ROW_STATUS,
  buildSignalsRows,
  filterSignalsRows,
  summarizeSignalsRows,
} from "./signalsRowModel.js";

const state = (symbol, patch = {}) => ({
  id: `state-${symbol}-${patch.timeframe || "5m"}`,
  profileId: "profile-paper",
  symbol,
  timeframe: patch.timeframe || "5m",
  currentSignalDirection: patch.currentSignalDirection ?? null,
  currentSignalAt: patch.currentSignalAt ?? null,
  currentSignalPrice: patch.currentSignalPrice ?? null,
  latestBarAt: patch.latestBarAt ?? "2026-05-31T14:30:00.000Z",
  barsSinceSignal: patch.barsSinceSignal ?? null,
  fresh: patch.fresh ?? false,
  status: patch.status || "ok",
  active: patch.active ?? true,
  lastEvaluatedAt: patch.lastEvaluatedAt ?? "2026-05-31T14:31:00.000Z",
  lastError: patch.lastError ?? null,
});

const event = (symbol, patch = {}) => ({
  id: `event-${symbol}-${patch.emittedAt || "now"}`,
  profileId: "profile-paper",
  environment: "paper",
  symbol,
  timeframe: patch.timeframe || "5m",
  direction: patch.direction || "buy",
  signalAt: patch.signalAt || "2026-05-31T14:00:00.000Z",
  signalPrice: patch.signalPrice ?? 101,
  close: patch.close ?? 101,
  emittedAt: patch.emittedAt || "2026-05-31T14:01:00.000Z",
  source: "signal-monitor",
  payload: {},
});

const response = (patch = {}) => ({
  profile: { timeframe: "5m" },
  states: [],
  universeSymbols: [],
  skippedSymbols: [],
  universe: {},
  evaluatedAt: "2026-05-31T14:32:00.000Z",
  truncated: false,
  ...patch,
});

test("signals rows preserve universe symbols without stored state", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["spy", "aapl", "msft"],
      skippedSymbols: ["msft"],
      states: [
        state("SPY", {
          currentSignalDirection: "buy",
          currentSignalAt: "2026-05-31T14:25:00.000Z",
          fresh: true,
          barsSinceSignal: 1,
        }),
      ],
    }),
  });

  assert.deepEqual(rows.map((row) => row.symbol), ["SPY", "MSFT", "AAPL"]);
  assert.equal(rows[0].status, SIGNALS_ROW_STATUS.activeFresh);
  assert.equal(rows[1].status, SIGNALS_ROW_STATUS.skipped);
  assert.equal(rows[1].coverageReason, "Outside current monitor scan cap");
  assert.equal(rows[2].status, SIGNALS_ROW_STATUS.pending);
});

test("signals rows merge matrix states by timeframe", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["NVDA"],
      states: [state("NVDA", { status: "ok" })],
    }),
    matrixStates: [
      state("NVDA", {
        timeframe: "2m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-05-31T14:20:00.000Z",
      }),
      state("NVDA", {
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-05-31T14:27:00.000Z",
        fresh: true,
      }),
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].matrixStatesByTimeframe["2m"].currentSignalDirection, "sell");
  assert.equal(rows[0].matrixStatesByTimeframe["5m"].currentSignalDirection, "buy");
  assert.deepEqual(rows[0].activeTimeframes, ["2m", "5m"]);
  assert.deepEqual(rows[0].freshTimeframes, ["5m"]);
});

test("signals rows attach the latest event per symbol", () => {
  const rows = buildSignalsRows({
    stateResponse: response({ universeSymbols: ["PLTR"] }),
    events: [
      event("PLTR", { direction: "buy", emittedAt: "2026-05-31T14:10:00.000Z" }),
      event("PLTR", { direction: "sell", emittedAt: "2026-05-31T14:40:00.000Z" }),
    ],
  });

  assert.equal(rows[0].latestEvent.direction, "sell");
  assert.equal(rows[0].direction, "sell");
  assert.equal(rows[0].currentSignalPrice, 101);
});

test("signals row summary and filters use normalized row metadata", () => {
  const rows = buildSignalsRows({
    stateResponse: response({
      universeSymbols: ["SPY", "TSLA", "AMD", "QQQ"],
      skippedSymbols: ["QQQ"],
      states: [
        state("SPY", {
          currentSignalDirection: "buy",
          currentSignalAt: "2026-05-31T14:25:00.000Z",
          fresh: true,
          barsSinceSignal: 1,
        }),
        state("TSLA", {
          currentSignalDirection: "sell",
          currentSignalAt: "2026-05-31T13:30:00.000Z",
          barsSinceSignal: 8,
          fresh: false,
        }),
        state("AMD", {
          status: "error",
          lastError: "provider unavailable",
        }),
      ],
    }),
  });

  assert.deepEqual(rows.map((row) => row.symbol), ["SPY", "TSLA", "AMD", "QQQ"]);
  assert.deepEqual(summarizeSignalsRows(rows), {
    total: 4,
    fresh: 1,
    active: 2,
    buy: 1,
    sell: 1,
    problem: 1,
    skipped: 1,
    pending: 0,
  });
  assert.deepEqual(
    filterSignalsRows(rows, { status: SIGNALS_ROW_STATUS.problem }).map((row) => row.symbol),
    ["AMD"],
  );
  assert.deepEqual(
    filterSignalsRows(rows, { query: "s", direction: "sell" }).map((row) => row.symbol),
    ["TSLA"],
  );
});
