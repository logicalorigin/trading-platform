import assert from "node:assert/strict";
import test from "node:test";

import { buildAlgoEventToast } from "./algoEventToasts.js";

const baseEvent = {
  id: "event-1",
  summary: "AAPL shadow CALL 225 2026-06-19 x3",
  payload: {},
};

test("buildAlgoEventToast maps shadow entries to success toasts", () => {
  assert.deepEqual(
    buildAlgoEventToast({
      ...baseEvent,
      eventType: "signal_options_shadow_entry",
    }),
    {
      kind: "success",
      title: baseEvent.summary,
      body: "Algo entry filled",
      duration: 5000,
    },
  );
});

test("buildAlgoEventToast formats profitable exits as success toasts", () => {
  assert.deepEqual(
    buildAlgoEventToast({
      ...baseEvent,
      eventType: "signal_options_shadow_exit",
      summary: "AAPL shadow exit target at 4.20",
      payload: { pnl: 125.5 },
    }),
    {
      kind: "success",
      title: "AAPL shadow exit target at 4.20",
      body: "Algo exit · PnL +$125.50",
      duration: 5000,
    },
  );
});

test("buildAlgoEventToast formats losing exits as error toasts", () => {
  assert.deepEqual(
    buildAlgoEventToast({
      ...baseEvent,
      eventType: "signal_options_shadow_exit",
      summary: "MSFT shadow exit stop at 1.15",
      payload: { pnl: -87 },
    }),
    {
      kind: "error",
      title: "MSFT shadow exit stop at 1.15",
      body: "Algo exit · PnL -$87.00",
      duration: 5000,
    },
  );
});

test("buildAlgoEventToast keeps flat or unknown exits informational", () => {
  assert.equal(
    buildAlgoEventToast({
      ...baseEvent,
      eventType: "signal_options_shadow_mark",
    }),
    null,
  );
  assert.deepEqual(
    buildAlgoEventToast({
      ...baseEvent,
      eventType: "signal_options_shadow_exit",
      summary: "SPY shadow exit manual at 2.10",
      payload: {},
    }),
    {
      kind: "info",
      title: "SPY shadow exit manual at 2.10",
      body: "Algo exit filled",
      duration: 5000,
    },
  );
  assert.deepEqual(
    buildAlgoEventToast({
      ...baseEvent,
      eventType: "signal_options_shadow_exit",
      summary: "QQQ shadow exit flat at 1.00",
      payload: { pnl: 0 },
    }),
    {
      kind: "info",
      title: "QQQ shadow exit flat at 1.00",
      body: "Algo exit · PnL +$0.00",
      duration: 5000,
    },
  );
});
