import assert from "node:assert/strict";
import test from "node:test";

import {
  SHELL_STATE_LABELS,
  buildShellStateLabel,
  normalizeShellState,
} from "./shellStatusModel.js";

test("shell state labels expose the required trading status vocabulary", () => {
  assert.deepEqual(Object.keys(SHELL_STATE_LABELS), [
    "live",
    "delayed",
    "stale",
    "simulated",
    "shadow",
    "disconnected",
    "degraded",
    "loading",
  ]);
});

test("shell state labels normalize common provider and broker aliases", () => {
  assert.equal(normalizeShellState("realtime"), "live");
  assert.equal(normalizeShellState("paper"), "simulated");
  assert.equal(normalizeShellState("offline"), "disconnected");
  assert.equal(normalizeShellState("hydrating"), "loading");
});

test("shell state label builder preserves context and safe fallback state", () => {
  assert.deepEqual(buildShellStateLabel("unknown", { context: "IBKR" }), {
    state: "loading",
    label: "LOADING",
    tone: "pending",
    description: "IBKR: State is still being loaded or hydrated.",
  });
});
