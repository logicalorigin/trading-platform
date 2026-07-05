import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  clearIbkrBridgeSessionValues,
  IBKR_BRIDGE_SESSION_KEYS,
  IBKR_RECONNECT_REQUEST_EVENT,
  readIbkrBridgeSessionValue,
  removeIbkrBridgeSessionValue,
  requestIbkrReconnect,
  writeIbkrBridgeSessionValue,
} from "./ibkrBridgeSession.js";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window",
);

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    delete globalThis.window;
  }
});

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function installFakeWindow() {
  const events = [];
  const sessionStorage = createStorage();
  const localStorage = createStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      CustomEvent: globalThis.CustomEvent,
      Event: globalThis.Event,
      dispatchEvent(event) {
        events.push(event);
        return true;
      },
      localStorage,
      sessionStorage,
    },
  });
  return { events, localStorage, sessionStorage };
}

test("bridge session storage helpers write, read, remove, and clear stale local state", () => {
  const { localStorage, sessionStorage } = installFakeWindow();
  const key = IBKR_BRIDGE_SESSION_KEYS.activationId;

  writeIbkrBridgeSessionValue(key, "activation-1");
  assert.equal(readIbkrBridgeSessionValue(key), "activation-1");

  removeIbkrBridgeSessionValue(key);
  assert.equal(readIbkrBridgeSessionValue(key), null);

  sessionStorage.setItem(IBKR_BRIDGE_SESSION_KEYS.managementToken, "token-1");
  localStorage.setItem(IBKR_BRIDGE_SESSION_KEYS.launchUrl, "retired-launch");
  clearIbkrBridgeSessionValues();

  assert.equal(sessionStorage.getItem(IBKR_BRIDGE_SESSION_KEYS.managementToken), null);
  assert.equal(localStorage.getItem(IBKR_BRIDGE_SESSION_KEYS.launchUrl), null);
});

test("requestIbkrReconnect emits the broker reconnect event without launcher dependencies", () => {
  const { events } = installFakeWindow();

  assert.equal(requestIbkrReconnect(), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, IBKR_RECONNECT_REQUEST_EVENT);
});
