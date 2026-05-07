import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSignalFrameColor,
  resolveSignalFrameState,
} from "./signalFrameState.js";

const theme = {
  blue: "#2563eb",
  cyan: "#0891b2",
  green: "#059669",
  red: "#dc2626",
  border: "#e2e8f0",
};

test("signal frame state renders buy signals as active blue frames", () => {
  const state = resolveSignalFrameState(
    {
      currentSignalDirection: "buy",
      fresh: true,
      status: "ok",
      timeframe: "5m",
      barsSinceSignal: 1,
    },
    theme,
  );

  assert.equal(state.active, true);
  assert.equal(state.direction, "buy");
  assert.equal(state.color, theme.blue);
  assert.match(state.label, /BUY signal/);
});

test("signal frame state normalizes long and short aliases", () => {
  assert.equal(
    resolveSignalFrameState(
      {
        currentSignalDirection: "long",
        fresh: true,
        status: "ok",
      },
      theme,
    ).direction,
    "buy",
  );
  assert.equal(
    resolveSignalFrameState(
      {
        currentSignalDirection: "short",
        fresh: true,
        status: "ok",
      },
      theme,
    ).direction,
    "sell",
  );
});

test("signal frame color falls back to a blue-family buy color before green", () => {
  assert.equal(
    resolveSignalFrameColor("buy", {
      cyan: theme.cyan,
      green: theme.green,
      red: theme.red,
      border: theme.border,
    }),
    theme.cyan,
  );
  assert.equal(resolveSignalFrameColor("sell", theme), theme.red);
});
