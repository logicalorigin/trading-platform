import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./useChartPositionOverlays.ts", import.meta.url),
  "utf8",
);

const sourceBetween = (start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end));

test("chart position overlays do not use quote snapshot fallback in Massive realtime mode", () => {
  assert.match(source, /useMarketDataProviderConfiguration/);
  assert.match(
    source,
    /const quoteSnapshotFallbackEnabled = Boolean\([\s\S]*marketDataProviderConfigurationReady && !massiveStockRealtimeConfigured,[\s\S]*\);/,
  );
  assert.match(
    source,
    /quoteSnapshotFallbackEnabled[\s\S]*enabled[\s\S]*!isOption[\s\S]*runtimeMark == null/,
  );
});

test("position overlay visibility tolerates unavailable local storage", () => {
  const readSource = sourceBetween(
    "const readStoredVisibility",
    "const writeStoredVisibility",
  );
  const writeSource = sourceBetween(
    "const writeStoredVisibility",
    "export const useChartPositionOverlays",
  );

  assert.match(readSource, /try\s*{/);
  assert.match(readSource, /catch\s*{/);
  assert.match(writeSource, /try\s*{/);
  assert.match(writeSource, /catch\s*{/);
});
