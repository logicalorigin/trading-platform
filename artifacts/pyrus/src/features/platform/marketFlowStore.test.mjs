import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PYRUS_STORAGE_KEY } from "../../lib/workspaceStorage.ts";
import {
  DEFAULT_FLOW_SCANNER_CONFIG,
  FLOW_SCANNER_CONFIG_VERSION,
} from "./marketFlowScannerConfig.js";
import {
  getFlowScannerControlState,
  resetFlowScannerControlForTests,
  setFlowScannerControlState,
} from "./marketFlowStore.js";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const installWindow = (entries = {}) => {
  const store = new Map(Object.entries(entries));

  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      removeItem: (key) => {
        store.delete(key);
      },
      setItem: (key, value) => {
        store.set(key, String(value));
      },
    },
  };

  return { store };
};

test.afterEach(() => {
  delete globalThis.window;
  resetFlowScannerControlForTests();
});

test("flow scanner config reads and migrates the current workspace state", () => {
  const { store } = installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({
      screen: "flow",
      flowScannerConfig: {
        ...DEFAULT_FLOW_SCANNER_CONFIG,
        batchSize: 7,
        concurrency: 2,
      },
      flowScannerConfigVersion: 1,
    }),
  });

  resetFlowScannerControlForTests({ readPersisted: true });

  const config = getFlowScannerControlState().config;
  assert.equal(config.batchSize, 7);
  assert.equal(config.concurrency, DEFAULT_FLOW_SCANNER_CONFIG.concurrency);

  const persisted = JSON.parse(store.get(PYRUS_STORAGE_KEY));
  assert.equal(persisted.screen, "flow");
  assert.equal(persisted.flowScannerConfigVersion, FLOW_SCANNER_CONFIG_VERSION);
  assert.equal(
    persisted.flowScannerConfig.concurrency,
    DEFAULT_FLOW_SCANNER_CONFIG.concurrency,
  );
});

test("flow scanner config persists through the current workspace key", () => {
  const { store } = installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ screen: "settings" }),
  });

  resetFlowScannerControlForTests();
  setFlowScannerControlState({
    config: {
      batchSize: 11,
      concurrency: 3,
      maxSymbols: 40,
    },
  });

  const persisted = JSON.parse(store.get(PYRUS_STORAGE_KEY));
  assert.equal(persisted.screen, "settings");
  assert.equal(persisted.flowScannerConfigVersion, FLOW_SCANNER_CONFIG_VERSION);
  assert.equal(persisted.flowScannerConfig.batchSize, 11);
  assert.equal(persisted.flowScannerConfig.concurrency, 3);
  assert.equal(persisted.flowScannerConfig.maxSymbols, 40);
});

test("flow scanner config preserves invalid workspace JSON write behavior", () => {
  const { store } = installWindow({
    [PYRUS_STORAGE_KEY]: "{",
  });

  resetFlowScannerControlForTests({ readPersisted: true });
  assert.deepEqual(getFlowScannerControlState().config, DEFAULT_FLOW_SCANNER_CONFIG);

  setFlowScannerControlState({
    config: {
      batchSize: 13,
    },
  });

  assert.equal(store.get(PYRUS_STORAGE_KEY), "{");
});

test("flow scanner config uses a local current-key reader", () => {
  const source = readLocalSource("./marketFlowStore.js");

  assert.match(source, /const readCurrentWorkspaceState = \(\) => \{/);
  assert.doesNotMatch(
    source,
    /readPyrusWorkspaceState/,
    "Expected market flow scanner config to preserve direct current-key read behavior",
  );
  assert.doesNotMatch(
    source,
    /window\.localStorage\.getItem\(PYRUS_STORAGE_KEY\)/,
    "Expected scanner config paths to avoid duplicate direct workspace reads",
  );
});
