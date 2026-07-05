import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./useChartPositionOverlays.ts", import.meta.url),
  "utf8",
);

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
