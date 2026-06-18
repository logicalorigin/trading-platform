import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PYRUS_STORAGE_KEY, PYRUS_WORKSPACE_SETTINGS_EVENT } from "../../lib/workspaceStorage.ts";
import {
  readAccountSection,
  writeAccountSection,
} from "./useAccountSection.js";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

class TestCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

const installWindow = (entries = {}) => {
  const store = new Map(Object.entries(entries));
  const events = [];

  globalThis.CustomEvent = TestCustomEvent;
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(key, String(value));
      },
    },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
  };

  return { events, store };
};

test.afterEach(() => {
  delete globalThis.window;
  delete globalThis.CustomEvent;
});

test("account section defaults to real without browser storage", () => {
  delete globalThis.window;

  assert.equal(readAccountSection(), "real");
});

test("account section reads and normalizes the current workspace state", () => {
  installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ accountSection: "shadow" }),
  });

  assert.equal(readAccountSection(), "shadow");

  installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ accountSection: "paper" }),
  });

  assert.equal(readAccountSection(), "real");
});

test("account section writes through the current workspace key and dispatches once", () => {
  const { events, store } = installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ screen: "account" }),
  });

  writeAccountSection("shadow");

  const nextState = JSON.parse(store.get(PYRUS_STORAGE_KEY));
  assert.deepEqual(nextState, { screen: "account", accountSection: "shadow" });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, PYRUS_WORKSPACE_SETTINGS_EVENT);
  assert.deepEqual(events[0].detail, nextState);
});

test("account section preserves invalid workspace JSON write behavior", () => {
  const { events, store } = installWindow({
    [PYRUS_STORAGE_KEY]: "{",
  });

  assert.equal(readAccountSection(), "real");
  writeAccountSection("shadow");

  assert.equal(store.get(PYRUS_STORAGE_KEY), "{");
  assert.equal(events.length, 0);
});

test("account section keeps storage imports on the workspace storage boundary", () => {
  const source = readLocalSource("./useAccountSection.js");

  assert.match(source, /from ["']\.\.\/\.\.\/lib\/workspaceStorage["']/);
  assert.doesNotMatch(source, /from ["']\.\.\/\.\.\/lib\/uiTokens(?:\.jsx)?["']/);
  assert.doesNotMatch(
    source,
    /readPyrusWorkspaceState/,
    "Expected account section to preserve direct current-key read behavior",
  );
});
