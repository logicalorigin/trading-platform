import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  clearOptionHydrationDiagnosticsHistory,
  OPTION_HYDRATION_DIAGNOSTICS_STORAGE_KEY,
  useOptionHydrationDiagnostics,
} from "./optionHydrationDiagnostics.ts";

const originalWindow = globalThis.window;

test.afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

const readHistoryThroughHook = () => {
  let history = null;
  const Probe = () => {
    history = useOptionHydrationDiagnostics(false).history;
    return null;
  };
  renderToString(createElement(Probe));
  return history;
};

test("malformed persisted option diagnostics are rejected and cleared", () => {
  let stored = JSON.stringify([
    {
      id: "bad-session",
      updatedAt: Date.now(),
      failureCount: 1,
      transportStates: "not-an-array",
    },
  ]);
  let removeCalls = 0;
  globalThis.window = {
    localStorage: {
      getItem: (key) =>
        key === OPTION_HYDRATION_DIAGNOSTICS_STORAGE_KEY ? stored : null,
      removeItem: () => {
        removeCalls += 1;
        stored = null;
      },
      setItem: () => {},
    },
  };

  assert.deepEqual(readHistoryThroughHook(), []);
  assert.equal(removeCalls, 1);
});

test("well-formed persisted option diagnostics remain readable", () => {
  const history = [
    {
      id: "valid-session",
      startedAt: Date.now() - 1_000,
      updatedAt: Date.now(),
      rollups: {
        activeChainMs: {
          count: 1,
          min: 25,
          max: 25,
          p50: 25,
          p95: 25,
        },
      },
      transportStates: ["live"],
      failureCount: 0,
    },
  ];
  let removeCalls = 0;
  globalThis.window = {
    localStorage: {
      getItem: () => JSON.stringify(history),
      removeItem: () => {
        removeCalls += 1;
      },
      setItem: () => {},
    },
  };

  assert.deepEqual(readHistoryThroughHook(), history);
  assert.equal(removeCalls, 0);
});

test("clearing option diagnostics never interrupts the UI", () => {
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      removeItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {},
    },
  };

  assert.doesNotThrow(() => clearOptionHydrationDiagnosticsHistory());
});
