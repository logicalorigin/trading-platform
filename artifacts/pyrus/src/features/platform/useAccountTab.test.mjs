import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PYRUS_STORAGE_KEY, PYRUS_WORKSPACE_SETTINGS_EVENT } from "../../lib/workspaceStorage.ts";
import { readAccountTab, writeAccountTab } from "./useAccountTab.js";

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

test("account tab defaults to all without browser storage", () => {
  delete globalThis.window;

  assert.equal(readAccountTab(), "all");
});

test("account tab reads an account-id tab verbatim and defaults blanks to all", () => {
  installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ accountTab: "acct-123" }),
  });
  assert.equal(readAccountTab(), "acct-123");

  installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ accountTab: "  " }),
  });
  assert.equal(readAccountTab(), "all");
});

test("account tab migrates a saved shadow section when no tab is stored", () => {
  installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ accountSection: "shadow" }),
  });
  assert.equal(readAccountTab(), "shadow");

  installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ accountSection: "real" }),
  });
  assert.equal(readAccountTab(), "all");
});

test("account tab writes the tab and mirrors shadow/real onto the legacy field, dispatching once", () => {
  const { events, store } = installWindow({
    [PYRUS_STORAGE_KEY]: JSON.stringify({ screen: "account" }),
  });

  writeAccountTab("shadow");
  let nextState = JSON.parse(store.get(PYRUS_STORAGE_KEY));
  assert.deepEqual(nextState, {
    screen: "account",
    accountTab: "shadow",
    accountSection: "shadow",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, PYRUS_WORKSPACE_SETTINGS_EVENT);

  writeAccountTab("acct-9");
  nextState = JSON.parse(store.get(PYRUS_STORAGE_KEY));
  assert.equal(nextState.accountTab, "acct-9");
  assert.equal(nextState.accountSection, "real");
});

test("account tab preserves invalid workspace JSON write behavior", () => {
  const { events, store } = installWindow({
    [PYRUS_STORAGE_KEY]: "{",
  });

  assert.equal(readAccountTab(), "all");
  writeAccountTab("shadow");

  assert.equal(store.get(PYRUS_STORAGE_KEY), "{");
  assert.equal(events.length, 0);
});

test("account tab keeps storage imports on the workspace storage boundary", () => {
  const source = readLocalSource("./useAccountTab.js");

  assert.match(source, /from ["']\.\.\/\.\.\/lib\/workspaceStorage["']/);
  assert.doesNotMatch(source, /from ["']\.\.\/\.\.\/lib\/uiTokens(?:\.jsx)?["']/);
});
