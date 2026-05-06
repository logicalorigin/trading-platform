import assert from "node:assert/strict";
import test from "node:test";
import {
  IBKR_BRIDGE_SESSION_KEYS,
  clearIbkrBridgeSessionValues,
  readIbkrBridgeSessionValue,
  removeIbkrBridgeSessionValue,
  writeIbkrBridgeSessionValue,
} from "./ibkrBridgeSession.js";

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

test("IBKR bridge session values survive reload fallback through local storage", () => {
  const originalWindow = globalThis.window;
  const sessionStorage = createMemoryStorage();
  const localStorage = createMemoryStorage();
  globalThis.window = {
    sessionStorage,
    localStorage,
  };

  try {
    writeIbkrBridgeSessionValue(
      IBKR_BRIDGE_SESSION_KEYS.managementToken,
      "management-token",
    );

    sessionStorage.removeItem(IBKR_BRIDGE_SESSION_KEYS.managementToken);

    assert.equal(
      readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken),
      "management-token",
    );

    removeIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken);
    assert.equal(
      readIbkrBridgeSessionValue(IBKR_BRIDGE_SESSION_KEYS.managementToken),
      null,
    );
  } finally {
    globalThis.window = originalWindow;
  }
});

test("IBKR bridge session clear removes launcher values from both storage scopes", () => {
  const originalWindow = globalThis.window;
  const sessionStorage = createMemoryStorage();
  const localStorage = createMemoryStorage();
  globalThis.window = {
    sessionStorage,
    localStorage,
  };

  try {
    Object.values(IBKR_BRIDGE_SESSION_KEYS).forEach((key) => {
      sessionStorage.setItem(key, `session-${key}`);
      localStorage.setItem(key, `local-${key}`);
    });

    clearIbkrBridgeSessionValues();

    Object.values(IBKR_BRIDGE_SESSION_KEYS).forEach((key) => {
      assert.equal(sessionStorage.getItem(key), null);
      assert.equal(localStorage.getItem(key), null);
    });
  } finally {
    globalThis.window = originalWindow;
  }
});
