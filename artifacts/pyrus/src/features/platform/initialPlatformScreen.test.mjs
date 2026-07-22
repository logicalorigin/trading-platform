import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeInitialPlatformScreen,
  readPlatformScreenFromSearch,
  readInitialPlatformScreen,
  writePlatformScreenHistory,
} from "./initialPlatformScreen.ts";
import { PYRUS_STORAGE_KEY } from "../../lib/workspaceStorage.ts";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const withLocalStorageState = (state, callback) => {
  const previousWindow = globalThis.window;
  const store = new Map([
    [PYRUS_STORAGE_KEY, JSON.stringify(state)],
  ]);

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => store.get(key) ?? null,
      },
    },
  });

  try {
    callback();
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
};

test("initial platform screen normalizes legacy and unknown screen ids", () => {
  assert.equal(normalizeInitialPlatformScreen("unusual"), "flow");
  assert.equal(normalizeInitialPlatformScreen("settings"), "settings");
  assert.equal(normalizeInitialPlatformScreen("unknown-screen"), "market");
  assert.equal(normalizeInitialPlatformScreen(null), "market");
});

test("initial platform screen reads the shared Pyrus workspace storage key", () => {
  withLocalStorageState({ screen: "algo" }, () => {
    assert.equal(readInitialPlatformScreen(), "algo");
  });

  withLocalStorageState({ screen: "unusual" }, () => {
    assert.equal(readInitialPlatformScreen(), "flow");
  });
});

test("platform screen history preserves route context and supports browser restoration", () => {
  assert.equal(readPlatformScreenFromSearch("?screen=research"), "research");
  assert.equal(readPlatformScreenFromSearch("?screen=unusual"), "flow");
  assert.equal(readPlatformScreenFromSearch("?screen=unknown"), null);

  const calls = [];
  const history = {
    state: { retained: true },
    pushState: (...args) => calls.push(["push", ...args]),
    replaceState: (...args) => calls.push(["replace", ...args]),
  };
  const location = {
    pathname: "/terminal",
    search: "?screen=research&latency=1",
    hash: "#company-detail",
  };

  assert.equal(
    writePlatformScreenHistory("trade", { history, location }),
    true,
  );
  assert.deepEqual(calls, [
    [
      "push",
      { retained: true },
      "",
      "/terminal?screen=trade&latency=1#company-detail",
    ],
  ]);

  assert.equal(
    writePlatformScreenHistory("trade", {
      history,
      location: { ...location, search: "?screen=trade&latency=1" },
    }),
    false,
  );
  assert.equal(calls.length, 1, "the active route must not duplicate history");
});

test("initial platform screen storage key comes from the shared helper", () => {
  const source = readLocalSource("./initialPlatformScreen.ts");

  assert.match(
    source,
    /import \{ PYRUS_STORAGE_KEY \} from "\.\.\/\.\.\/lib\/workspaceStorage";/,
  );
  assert.doesNotMatch(source, /PYRUS_WORKSPACE_STATE_STORAGE_KEY/);
  assert.doesNotMatch(source, /"pyrus:state:v1"/);
});
