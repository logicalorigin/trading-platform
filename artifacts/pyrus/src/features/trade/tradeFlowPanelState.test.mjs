import assert from "node:assert/strict";
import test from "node:test";

import { resolveTradeFlowPanelState } from "./tradeFlowPanelState.js";

test("Trade flow panels preserve activity while distinguishing live, stale, and offline data", () => {
  assert.deepEqual(
    resolveTradeFlowPanelState({
      status: "live",
      events: [{ id: "print-1" }],
    }),
    {
      kind: "live",
      metaLabel: "LIVE",
      showEvents: true,
      notice: null,
      detail: null,
    },
  );
  assert.deepEqual(
    resolveTradeFlowPanelState({
      status: "stale",
      events: [{ id: "print-1" }],
    }),
    {
      kind: "stale",
      metaLabel: "STALE",
      showEvents: true,
      notice: "Showing last captured flow",
      detail: "Live refresh is unavailable; values may be out of date.",
    },
  );
  assert.deepEqual(
    resolveTradeFlowPanelState({
      status: "offline",
      events: [],
    }),
    {
      kind: "offline",
      metaLabel: "OFFLINE",
      showEvents: false,
      notice: "Flow unavailable",
      detail: "The current flow source could not be read.",
    },
  );
  assert.deepEqual(resolveTradeFlowPanelState({ status: "loading" }), {
    kind: "loading",
    metaLabel: "LOADING",
    showEvents: false,
    notice: null,
    detail: null,
  });
  assert.deepEqual(
    resolveTradeFlowPanelState({ enabled: false, status: "loading" }),
    {
      kind: "waiting",
      metaLabel: "WAITING",
      showEvents: false,
      notice: "Flow waiting for chart data",
      detail: "Flow starts after the primary chart is ready.",
    },
  );
  assert.deepEqual(
    resolveTradeFlowPanelState({
      enabled: false,
      status: "live",
      events: [{ id: "print-1" }],
    }),
    {
      kind: "waiting",
      metaLabel: "WAITING",
      showEvents: true,
      notice: "Showing last captured flow",
      detail: "Live flow resumes after the primary chart is ready.",
    },
  );
  assert.deepEqual(resolveTradeFlowPanelState({ status: "empty" }), {
    kind: "empty",
    metaLabel: "NO FLOW",
    showEvents: false,
    notice: null,
    detail: null,
  });
});
