import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import {
  LEGACY_MARKET_GRID_CARD_SCALE_SESSION_KEY,
  LEGACY_MARKET_GRID_CARD_SIZE_SESSION_KEY,
  MARKET_GRID_TRACK_SESSION_KEY,
  readMarketGridTrackSession,
  writeMarketGridTrackSession,
} from "./marketGridTrackState.js";

const createSessionStorage = () => {
  const entries = new Map();

  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    removeItem(key) {
      entries.delete(key);
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
};

beforeEach(() => {
  globalThis.window = {
    sessionStorage: createSessionStorage(),
  };
});

afterEach(() => {
  delete globalThis.window;
});

test("writeMarketGridTrackSession preserves current state and removes legacy card sizing", () => {
  const nextState = {
    AAPL: {
      cols: [0.4, 0.6],
      rows: [1],
      rowHeights: [320],
    },
  };

  window.sessionStorage.setItem(
    LEGACY_MARKET_GRID_CARD_SIZE_SESSION_KEY,
    JSON.stringify({ size: "lg" }),
  );
  window.sessionStorage.setItem(
    LEGACY_MARKET_GRID_CARD_SCALE_SESSION_KEY,
    JSON.stringify({ scale: 1.2 }),
  );

  writeMarketGridTrackSession(nextState);

  assert.equal(
    window.sessionStorage.getItem(MARKET_GRID_TRACK_SESSION_KEY),
    JSON.stringify(nextState),
  );
  assert.equal(
    window.sessionStorage.getItem(LEGACY_MARKET_GRID_CARD_SIZE_SESSION_KEY),
    null,
  );
  assert.equal(
    window.sessionStorage.getItem(LEGACY_MARKET_GRID_CARD_SCALE_SESSION_KEY),
    null,
  );
});

test("readMarketGridTrackSession returns parsed current state", () => {
  const state = {
    TSLA: {
      cols: [1],
      rows: [0.5, 0.5],
      rowHeights: [280, 300],
    },
  };

  window.sessionStorage.setItem(
    MARKET_GRID_TRACK_SESSION_KEY,
    JSON.stringify(state),
  );

  assert.deepEqual(readMarketGridTrackSession(), state);
});

test("readMarketGridTrackSession returns empty state for invalid or missing storage", () => {
  assert.deepEqual(readMarketGridTrackSession(), {});

  window.sessionStorage.setItem(MARKET_GRID_TRACK_SESSION_KEY, "{");

  assert.deepEqual(readMarketGridTrackSession(), {});

  delete globalThis.window;

  assert.deepEqual(readMarketGridTrackSession(), {});
});

test("readMarketGridTrackSession returns empty state when storage is unavailable", () => {
  globalThis.window = {
    get sessionStorage() {
      throw new Error("sessionStorage unavailable");
    },
  };

  assert.deepEqual(readMarketGridTrackSession(), {});
});
