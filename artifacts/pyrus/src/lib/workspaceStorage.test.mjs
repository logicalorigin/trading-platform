import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
