import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readPyrusWorkspaceState } from "./workspaceStorage.ts";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("storage-only workspace modules import storage constants from the shared helper", () => {
  const modules = [
    ["workspace state", "./workspaceState.js"],
    ["chart timeframe favorites", "../features/charting/useChartTimeframeFavorites.js"],
    ["flow filter store", "../features/platform/flowFilterStore.js"],
    ["market flow store", "../features/platform/marketFlowStore.js"],
  ];

  for (const [label, filename] of modules) {
    const source = readLocalSource(filename);

    assert.match(
      source,
      /from ["'](?:\.\.?\/)*.*workspaceStorage["']/,
      `Expected ${label} to import storage constants from workspaceStorage`,
    );
    assert.doesNotMatch(
      source,
      /from ["'](?:\.\.?\/)*.*uiTokens(?:\.jsx)?["']/,
      `Expected ${label} to avoid importing uiTokens for storage-only constants`,
    );
  }
});

test("workspace storage accepts only record-shaped JSON", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let storedValue = null;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => storedValue,
        removeItem: () => undefined,
        setItem: () => undefined,
      },
    },
  });

  try {
    for (const raw of ["null", "[]", "true", "42", '"text"']) {
      storedValue = raw;
      assert.deepEqual(readPyrusWorkspaceState(), {}, raw);
    }

    storedValue = '{"screen":"market"}';
    assert.deepEqual(readPyrusWorkspaceState(), { screen: "market" });
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  }
});
